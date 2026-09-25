import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save as savePanel } from '@tauri-apps/plugin-dialog';
import { Icon } from './Icon';
import { IS_MAC } from './Welcome';
import { fill } from './i18n';
import { explain } from './errors';
import type { Format, Video } from './videotypes';
import { kindName } from './VideoStoryboard';
import {
  BITRATES, RESOLUTIONS, SHAPE_TAG, canEncode, canExport, downloadsPath, fileNameFor, hasAudio, hasWords, openExported,
  posterFrame, renderPoster, renderVideo, resolutionName, sizeAt, srtOf, storyboardOf, textBytes, writeVideoFile,
  type Bitrate, type CanEncode, type Container, type Resolution, type Silence,
} from './videoexport';

/**
 * Every way to take a video away: **Download MP4**, straight into the
 * Downloads folder, and under it the rest — Save as…, the resolution and the
 * bitrate, WebM, a poster, all three shapes at once, subtitles and the
 * storyboard. Then where it went, with Show in Finder, Open and Copy the path.
 *
 * Nothing here writes unless the person pressed the button for that exact
 * file, and what is written is the video as it was on screen at that moment
 * (SAFETY.md's rule). Downloads never replace a file: Rust saves at the first
 * free name of `Title.mp4`, `Title (2).mp4`… and says which.
 *
 * Renders live outside React, like the panel's runs, so leaving the video or
 * closing the sidebar does not stop one; the list's rows show it, and each row
 * has its own download button (`RowDownload`) that renders at the last-used
 * resolution and bitrate.
 */

type T = (s: string) => string;

// ── settings, remembered ──────────────────────────────────────────────────

interface Prefs { resolution: Resolution; bitrate: Bitrate; sound: boolean }

const PREFS_KEY = 'vylo.video.download';

function loadPrefs(): Prefs {
  const base: Prefs = { resolution: '1080p', bitrate: 'high', sound: true };
  try {
    const got = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    if (!got || typeof got !== 'object') return base;
    return {
      resolution: RESOLUTIONS.includes(got.resolution as Resolution) ? got.resolution as Resolution : base.resolution,
      bitrate: BITRATES.includes(got.bitrate as Bitrate) ? got.bitrate as Bitrate : base.bitrate,
      sound: typeof got.sound === 'boolean' ? got.sound : base.sound,
    };
  } catch {
    return base;
  }
}

let prefs: Prefs = loadPrefs();

function setPrefs(next: Partial<Prefs>) {
  prefs = { ...prefs, ...next };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Remembered for this session only.
  }
  notify();
}

// ── downloads, outside React ──────────────────────────────────────────────

type Task = 'mp4' | 'saveas' | 'webm' | 'poster' | 'shapes' | 'srt' | 'json';

interface Saved { path: string; open: boolean }

interface Run {
  ctl: AbortController;
  task: Task;
  phase: 'render' | 'write';
  /** Of the whole task, 0..1; `null` while it cannot be known (a poster). */
  fraction: number | null;
  /** The renderer's own estimate, when one render is the whole task. */
  eta?: number;
  started: number;
  /** Which of the three shapes, for "all three". */
  step?: { n: number; of: number; format: Format };
  /** What is being made: `1080p · MP4`. */
  spec: string;
  files: Saved[];
}

interface Outcome { task: Task; files: Saved[]; silence?: Silence; at: number; cancelled?: boolean }

const runs = new Map<string, Run>();
const outcomes = new Map<string, Outcome>();
const failures = new Map<string, string>();
const watchers = new Set<() => void>();

function notify() {
  for (const w of watchers) w();
}

let queued = false;
function notifySoon() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; notify(); });
}

/** Re-render when a download starts, moves, ends or its settings change. */
function useDownloads() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const w = () => setTick((n) => n + 1);
    watchers.add(w);
    return () => { watchers.delete(w); };
  }, []);
}

/**
 * Whether a video is being rendered or saved right now — re-rendering the
 * caller only when that changes, not on every tick of the progress bar, so
 * the panel around a download (its preview, its storyboard) stays still.
 */
export function useDownloading(id: string): boolean {
  const [on, setOn] = useState(() => runs.has(id));
  useEffect(() => {
    const w = () => setOn(runs.has(id));
    watchers.add(w);
    w();
    return () => { watchers.delete(w); };
  }, [id]);
  return on;
}

/** Stop a video's download and forget what it saved — for when the video is deleted. The files stay. */
export function forgetDownloads(id: string) {
  runs.get(id)?.ctl.abort();
  runs.delete(id);
  outcomes.delete(id);
  failures.delete(id);
  notify();
}

/** An error whose message is already the sentence to show. */
class Said extends Error {}

function doing(task: Task, t: T): string {
  if (task === 'poster') return t('render the poster');
  if (task === 'srt') return t('save the subtitles');
  if (task === 'json') return t('save the storyboard');
  return t('export the video');
}

function shapeName(f: Format, t: T): string {
  if (f === 'portrait') return t('Vertical 9:16');
  if (f === 'square') return t('Square 1:1');
  return t('Wide 16:9');
}

interface Settings { resolution: Resolution; bitrate: Bitrate; sound: boolean }

/**
 * Make one download and keep what came of it. The video is the one on screen
 * when the button was pressed — `v`, not whatever it becomes while this runs.
 */
function start(v: Video, task: Task, o: { t: T; settings: Settings; path?: string; frame?: number; onError?: (m: string) => void }) {
  if (runs.has(v.id) || !v.scenes.length) return;
  const { t, settings } = o;
  const ctl = new AbortController();
  const container: Container = task === 'webm' ? 'webm' : 'mp4';
  const rendered = task === 'mp4' || task === 'saveas' || task === 'webm' || task === 'shapes' || task === 'poster';
  const run: Run = {
    ctl, task, phase: rendered ? 'render' : 'write', fraction: task === 'poster' || !rendered ? null : 0, started: Date.now(),
    spec: task === 'srt' ? 'SRT' : task === 'json' ? 'JSON'
      : `${resolutionName(settings.resolution)} · ${task === 'poster' ? 'PNG' : container.toUpperCase()}`,
    files: [],
  };
  runs.set(v.id, run);
  failures.delete(v.id);
  outcomes.delete(v.id);
  notify();

  const progress = (base: number, span: number) => (f: number, eta?: number) => {
    run.fraction = base + span * f;
    run.eta = span === 1 ? eta : undefined;
    notifySoon();
  };
  const cannot = (can: CanEncode) => new Said(can.why
    ? fill(t('The video cannot be rendered here: {why}'), { why: can.why })
    : t('This computer cannot render the video here.'));
  const save = async (bytes: Uint8Array, name: string, open = true): Promise<string> => {
    if (ctl.signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
    run.phase = 'write';
    notify();
    const path = await writeVideoFile(o.path ?? await downloadsPath(name), bytes, { unique: !o.path });
    run.files.push({ path, open });
    return path;
  };
  const film = { resolution: settings.resolution, bitrate: settings.bitrate, muted: settings.sound ? undefined : true, signal: ctl.signal };

  const going = (async (): Promise<Silence | undefined> => {
    if (task === 'mp4' || task === 'saveas' || task === 'webm') {
      const can = await canEncode(v, { container, resolution: settings.resolution, bitrate: settings.bitrate });
      if (!can.ok) throw cannot(can);
      const r = await renderVideo(v, { ...film, container, codec: can.codec, onProgress: progress(0, 1) });
      await save(r.bytes, fileNameFor(v, container));
      return r.silence;
    }
    if (task === 'shapes') {
      const shapes: Format[] = ['landscape', 'portrait', 'square'];
      let silence: Silence | undefined;
      for (const [i, format] of shapes.entries()) {
        run.step = { n: i + 1, of: shapes.length, format };
        run.phase = 'render';
        notify();
        const can = await canEncode(v, { container: 'mp4', resolution: settings.resolution, bitrate: settings.bitrate, format });
        if (!can.ok) throw cannot(can);
        const r = await renderVideo(v, { ...film, format, codec: can.codec, onProgress: progress(i / shapes.length, 1 / shapes.length) });
        silence ??= r.silence;
        await save(r.bytes, fileNameFor(v, 'mp4', SHAPE_TAG[format]));
      }
      return silence;
    }
    if (task === 'poster') {
      const bytes = await renderPoster(v, { frame: o.frame, resolution: settings.resolution, signal: ctl.signal });
      await save(bytes, fileNameFor(v, 'png'));
      return undefined;
    }
    if (task === 'srt') {
      const text = srtOf(v);
      if (!text) throw new Said(t('This video has no words to put in subtitles.'));
      await save(textBytes(text), fileNameFor(v, 'srt'));
      return undefined;
    }
    await save(textBytes(storyboardOf(v)), fileNameFor(v, 'json'), false);
    return undefined;
  })();

  // A video deleted meanwhile (`forgetDownloads`) has no run any more, and gets no result either.
  const mine = () => runs.get(v.id) === run;
  going
    .then((silence) => {
      if (mine()) outcomes.set(v.id, { task, files: run.files, silence, at: Date.now() });
    })
    .catch((e: unknown) => {
      if (!mine()) return;
      const cancelled = ctl.signal.aborted || (e as { name?: string })?.name === 'AbortError';
      // Of all three shapes, the ones saved before Cancel are still there, and said so.
      if (run.files.length) outcomes.set(v.id, { task, files: run.files, at: Date.now(), cancelled });
      if (cancelled) return;
      const m = e instanceof Said ? e.message : explain(e, doing(task, t));
      failures.set(v.id, m);
      o.onError?.(m);
    })
    .finally(() => {
      if (runs.get(v.id) === run) runs.delete(v.id);
      notify();
      // The row's tick turns back into the download arrow.
      window.setTimeout(notify, DONE_MS + 100);
    });
}

/** How long a row shows its tick after a download. */
const DONE_MS = 6000;

// ── small pieces ──────────────────────────────────────────────────────────

function useTick(on: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const i = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(i);
  }, [on]);
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The download arrow, drawn on the icon set's grid: 24, a 1.5 stroke, round joins. */
function DownloadGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 4.5v10.5M7.5 11 12 15.5 16.5 11M5 19.5h14" />
    </svg>
  );
}

/** A ring that fills as a row's download goes. */
function Ring({ value }: { value: number | null }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <svg className={`vid-dl-ring${value === null ? ' is-spin' : ''}`} width={18} height={18} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <circle cx={9} cy={9} r={r} fill="none" strokeWidth={2} className="vid-dl-ring-track" />
      <circle cx={9} cy={9} r={r} fill="none" strokeWidth={2} strokeLinecap="round" className="vid-dl-ring-fill"
              strokeDasharray={c} strokeDashoffset={c * (1 - (value ?? 0.25))} transform="rotate(-90 9 9)" />
    </svg>
  );
}

/** `Saved to {path}` with the path kept left to right inside a right-to-left sentence. */
function WithPath({ template, path }: { template: string; path: string }) {
  const at = template.indexOf('{path}');
  if (at < 0) return <>{template}</>;
  return (
    <>
      {template.slice(0, at)}
      <bdi dir="ltr" className="vid-dl-path">{path}</bdi>
      {template.slice(at + '{path}'.length)}
    </>
  );
}

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

/**
 * A saved file's name, running the way its title does, with the tail the app
 * added — ` 16x9 (2).mp4` — kept together left to right, so an Arabic or
 * Kurdish name does not come out as `mp4.(2) 16x9`.
 */
function FileName({ path }: { path: string }) {
  const name = baseName(path);
  // From the first printable ASCII character, so the space before it stays with the title.
  const tail = /[!-~][ -~]*$/.exec(name);
  return (
    <bdi className="vid-dl-name" title={path}>
      {tail && tail.index > 0 ? <>{name.slice(0, tail.index)}<bdi dir="ltr">{tail[0]}</bdi></> : name}
    </bdi>
  );
}

// ── the row's button ──────────────────────────────────────────────────────

/**
 * The download arrow on a row of the video list: **Download MP4** at the
 * last-used resolution and bitrate, without opening the video. While it runs
 * it is a ring that fills, and pressing it cancels; afterwards a tick for a
 * moment, or a warning whose tooltip says what went wrong.
 */
export function RowDownload({ t, video, locked = false }: { t: T; video: Video; locked?: boolean }) {
  useDownloads();
  if (!video.scenes.length) return null;
  const run = runs.get(video.id);
  const failure = failures.get(video.id);
  const done = outcomes.get(video.id);
  const title = video.title || video.request;
  if (run) {
    const pct = run.fraction === null ? null : Math.round(run.fraction * 100);
    const label = `${t('Cancel')} · ${title}${pct === null ? '' : ` · ${pct}%`}`;
    return (
      <button className="vid-dl-row is-live" onClick={() => run.ctl.abort()} title={label} aria-label={label}>
        <Ring value={run.fraction} />
      </button>
    );
  }
  const recent = !!done && !done.cancelled && Date.now() - done.at < DONE_MS;
  const what = fill(t('Download MP4 at {quality}'), { quality: resolutionName(prefs.resolution) });
  return (
    <button className={`vid-dl-row${failure ? ' is-bad' : recent ? ' is-done' : ''}`} disabled={locked}
            onClick={() => start(video, 'mp4', { t, settings: prefs })}
            title={failure ? `${failure}\n\n${what}` : what} aria-label={`${what} · ${title}`}>
      {failure ? <Icon name="warning" size={14} /> : recent ? <Icon name="check" size={14} /> : <DownloadGlyph />}
    </button>
  );
}

// ── the panel's block ─────────────────────────────────────────────────────

/** What this window can encode, asked once per video, shape, resolution and bitrate. */
interface Abilities { mp4: CanEncode; webm: CanEncode; at: Record<Resolution, CanEncode> }

/** Every way to take a video away — the downloads part of the Video module. */
export function VideoDownloads({ t, video, locked, onError }: {
  t: (s: string) => string;
  video: Video;
  locked: boolean;
  onError: (m: string) => void;
}): JSX.Element | null {
  useDownloads();
  const run = runs.get(video.id);
  useTick(!!run);
  const [open, setOpen] = useState(false);
  const [scene, setScene] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [can, setCan] = useState<Abilities | null>(null);

  useEffect(() => {
    let live = true;
    setCan(null);
    const ask = (container: Container, resolution: Resolution) =>
      canEncode(video, { container, resolution, bitrate: prefs.bitrate }).catch((e: unknown) => ({ ok: false, why: String(e) }));
    // 1080p MP4 is the question every export asks first (`canExport`); the
    // other two resolutions and WebM decide what the menu offers.
    const base = canExport(video).catch((e: unknown) => ({ ok: false, why: String(e) }));
    void Promise.all([ask('mp4', '720p'), base, ask('mp4', '2160p'), ask('webm', prefs.resolution)]).then(([p720, p1080, p2160, webm]) => {
      if (!live) return;
      const at = { '720p': p720, '1080p': p1080, '2160p': p2160 } as Record<Resolution, CanEncode>;
      setCan({ mp4: at[prefs.resolution], webm, at });
    });
    return () => { live = false; };
  }, [video.id, video.format, prefs.resolution, prefs.bitrate]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!video.scenes.length) return null;

  const outcome = outcomes.get(video.id);
  const failure = failures.get(video.id);
  // A resolution this window cannot encode (4K, on some machines) falls back to 1080p rather than disabling Download.
  const resolution: Resolution = can?.at[prefs.resolution]?.ok === false && can.at['1080p']?.ok ? '1080p' : prefs.resolution;
  const settings: Settings = { resolution, bitrate: prefs.bitrate, sound: prefs.sound };
  const size = sizeAt(video.format, resolution);
  const sound = hasAudio(video);
  const cannot = can && !can.at['1080p'].ok && !can.mp4.ok ? can.mp4 : null;
  const busy = locked || !!run;
  const titleScene = Math.max(0, video.scenes.findIndex((s) => s.kind === 'title'));
  const posterScene = scene !== null && scene < video.scenes.length ? scene : titleScene;

  const go = (task: Task, extra: { path?: string; frame?: number } = {}) => {
    if (busy) return;
    // The menu folds away, so the progress and then "Saved to …" sit under the button.
    setOpen(false);
    start(video, task, { t, settings, onError, ...extra });
  };

  const saveAs = async () => {
    if (busy) return;
    const path = await savePanel({ title: t('Export MP4'), defaultPath: fileNameFor(video, 'mp4'), filters: [{ name: 'MP4', extensions: ['mp4'] }] });
    if (path) go('saveas', { path });
  };

  const reveal = (path: string) => invoke('reveal_path', { path }).catch((e: unknown) => onError(explain(e, t('show the file'))));
  const play = (path: string) => openExported(path).catch((e: unknown) => onError(explain(e, t('open the file'))));
  const copy = (path: string) => navigator.clipboard.writeText(path).then(
    () => { setCopied(path); window.setTimeout(() => setCopied((c) => (c === path ? null : c)), 1600); },
    () => onError(t('Could not copy that.')),
  );

  return (
    <section className="vid-dl" aria-label={t('Download MP4')}>
      {cannot && (
        <p className="vid-bad" dir="auto">
          {cannot.why ? fill(t('The video cannot be rendered here: {why}'), { why: cannot.why }) : t('This computer cannot render the video here.')}
        </p>
      )}

      {run ? <Progress t={t} run={run} /> : (
        <>
          <div className="vid-dl-main">
            <button className="sb-cta-go vid-dl-go" onClick={() => go('mp4')} disabled={busy || !!cannot}
                    title={t('Renders the video on this computer and saves it in your Downloads folder.')}>
              <DownloadGlyph size={15} />{t('Download MP4')}
            </button>
            <button className="sb-cta-go vid-dl-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={`vid-dl-more-${video.id}`}
                    title={t('More ways to save')} aria-label={t('More ways to save')}>
              <Icon name="chevron" size={12} turn={open ? -90 : 90} />
            </button>
          </div>
          <p className="vid-dl-spec">
            <span>
              <bdi dir="ltr">{resolutionName(resolution)} · {size.width} × {size.height} · MP4</bdi>
              {sound && prefs.sound ? ` · ${t('with sound')}` : ''}
            </span>
            <span>{t('Into your Downloads folder, never over a file that is there.')}</span>
          </p>
        </>
      )}

      {open && !run && (
        <div className="vid-dl-more" id={`vid-dl-more-${video.id}`}>
          <div className="vid-dl-set">
            <span className="vid-group-label">{t('Resolution')}</span>
            <div className="vid-seg vid-dl-seg" role="group" aria-label={t('Resolution')}>
              {RESOLUTIONS.map((r) => {
                const ok = can?.at[r]?.ok !== false;
                const px = sizeAt(video.format, r);
                return (
                  <button key={r} className={r === resolution ? 'on' : ''} aria-pressed={r === resolution} disabled={!ok || locked}
                          title={ok ? `${px.width} × ${px.height}` : can?.at[r]?.why} onClick={() => setPrefs({ resolution: r })}>
                    {resolutionName(r)}
                  </button>
                );
              })}
            </div>
            <small>
              <bdi dir="ltr">{size.width} × {size.height}</bdi>
              {' · '}
              {resolution === '720p' ? t('What YouTube asks for in a thumbnail, and plenty for a phone.')
                : resolution === '2160p' ? t('Four times the pixels of Full HD: sharpest on a large screen, and a longer wait.')
                : t('Full HD: what most platforms show.')}
            </small>
          </div>

          <div className="vid-dl-set">
            <span className="vid-group-label">{t('Bitrate')}</span>
            <div className="vid-seg vid-dl-seg" role="group" aria-label={t('Bitrate')}>
              {BITRATES.map((b) => (
                <button key={b} className={b === prefs.bitrate ? 'on' : ''} aria-pressed={b === prefs.bitrate} disabled={locked}
                        onClick={() => setPrefs({ bitrate: b })}>
                  {b === 'medium' ? t('Smaller file') : b === 'high' ? t('Balanced') : t('Best quality')}
                </button>
              ))}
            </div>
            <small>{t('A higher bitrate keeps words crisp when a platform compresses the video again; the file is larger.')}</small>
          </div>

          {sound && (
            <label className="vid-check">
              <input type="checkbox" checked={prefs.sound} onChange={(e) => setPrefs({ sound: e.target.checked })} />
              <span>{t('Include the music and narration')}</span>
            </label>
          )}

          <ul className="vid-dl-list">
            <li>
              <button className="vid-dl-item" onClick={() => void saveAs()} disabled={busy || !!cannot}
                      title={t('Renders the video on this computer and saves it where you choose.')}>
                <Icon name="folder" size={15} />
                <span><b>{t('Save as MP4…')}</b><small>{t('Choose the folder and the name')}</small></span>
              </button>
            </li>
            {can?.webm.ok && (
              <li>
                <button className="vid-dl-item" onClick={() => go('webm')} disabled={busy}>
                  <Icon name="film" size={15} />
                  <span><b>{t('WebM video')}</b><small>{fill(t('Smaller, for web pages · {codec}'), { codec: (can.webm.codec ?? 'vp9').toUpperCase() })}</small></span>
                </button>
              </li>
            )}
            <li className="vid-dl-poster">
              <button className="vid-dl-item" onClick={() => go('poster', { frame: posterFrame(video, posterScene) })} disabled={busy}>
                <Icon name="image" size={15} />
                <span><b>{t('Poster')}<bdi dir="ltr" className="vid-dl-ext">PNG</bdi></b><small>{t('One still, for a YouTube thumbnail or a cover')}</small></span>
              </button>
              <select className="vid-dl-frame" value={posterScene} disabled={busy} onChange={(e) => setScene(Number(e.target.value))}
                      aria-label={t('The scene the poster shows')} title={t('The scene the poster shows')}>
                {video.scenes.map((s, i) => (
                  <option key={s.id} value={i}>{fill(t('Scene {n}: {kind}'), { n: i + 1, kind: kindName(s.kind, t) })}</option>
                ))}
              </select>
            </li>
            <li>
              <button className="vid-dl-item" onClick={() => go('shapes')} disabled={busy || !!cannot}>
                <Icon name="grid" size={15} />
                <span><b>{t('All three shapes')}<bdi dir="ltr" className="vid-dl-ext">3 × MP4</bdi></b><small>{t('Wide, vertical and square — one MP4 each, one after another')}</small></span>
              </button>
            </li>
            <li>
              <button className="vid-dl-item" onClick={() => go('srt')} disabled={busy || !hasWords(video)}>
                <Icon name="list" size={15} />
                <span><b>{t('Subtitles')}<bdi dir="ltr" className="vid-dl-ext">SRT</bdi></b><small>{t('From the narration, or the words on screen, timed to the scenes')}</small></span>
              </button>
            </li>
            <li>
              <button className="vid-dl-item" onClick={() => go('json')} disabled={busy}>
                <Icon name="archive" size={15} />
                <span><b>{t('Storyboard')}<bdi dir="ltr" className="vid-dl-ext">JSON</bdi></b><small>{t('A backup of every word and setting, without the pictures')}</small></span>
              </button>
            </li>
          </ul>
        </div>
      )}

      {outcome && !run && (
        <div className="vid-dl-done" role="status">
          <p className="vid-dl-done-head">
            <Icon name={outcome.cancelled ? 'warning' : 'check'} size={14} />
            <span>
              {outcome.files.length === 1
                ? <WithPath template={t('Saved to {path}')} path={outcome.files[0].path} />
                : fill(t('{n} files saved'), { n: outcome.files.length })}
            </span>
            <button className="sb-act vid-dl-x" onClick={() => { outcomes.delete(video.id); notify(); }} title={t('Close')} aria-label={t('Close')}>
              <Icon name="close" size={12} />
            </button>
          </p>
          <ul className="vid-dl-files">
            {outcome.files.map((f) => (
              <li key={f.path}>
                {outcome.files.length > 1 && <FileName path={f.path} />}
                <div className="vid-dl-acts">
                  <button className="ghost" onClick={() => void reveal(f.path)}>
                    <Icon name="folder" size={12} />{IS_MAC ? t('Show in Finder') : t('Show in Explorer')}
                  </button>
                  {f.open && (
                    <button className="ghost" onClick={() => void play(f.path)}>
                      <Icon name="play" size={12} />{t('Open')}
                    </button>
                  )}
                  <button className="ghost" onClick={() => void copy(f.path)}>
                    <Icon name={copied === f.path ? 'check' : 'clipboard'} size={12} />{copied === f.path ? t('Copied') : t('Copy the path')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {outcome.silence && (
            <p className="vid-note">
              {outcome.silence === 'unsupported'
                ? t('This window cannot encode sound, so the video was saved without it.')
                : t('The sound could not be encoded, so the video was saved again without it.')}
            </p>
          )}
          {outcome.cancelled && <p className="vid-note">{t('Cancelled. The files above were saved before that.')}</p>}
        </div>
      )}

      {failure && !run && !outcome && <p className="vid-bad" dir="auto">{failure}</p>}
    </section>
  );
}

/** A download under way: what is being made, how far, roughly how long is left, and Cancel. */
function Progress({ t, run }: { t: T; run: Run }) {
  const elapsed = Date.now() - run.started;
  const f = run.fraction;
  const pct = f === null ? null : Math.round(Math.min(1, Math.max(0, f)) * 100);
  const left = run.eta ?? (f !== null && f > 0.03 ? (elapsed / f) * (1 - f) : 0);
  const what = run.phase === 'write' ? t('Saving the file…')
    : run.step ? fill(t('Rendering {n} of {of}: {shape}…'), { n: run.step.n, of: run.step.of, shape: shapeName(run.step.format, t) })
    : run.task === 'poster' ? t('Rendering the poster…')
    : t('Rendering the video…');
  return (
    <div className="vid-status vid-export vid-dl-run" role="status">
      <p className="vid-status-line">
        <span className="vid-glyph" aria-hidden="true">✻</span>
        <b>{what}</b>
        {pct !== null && run.phase === 'render' && <span className="vid-pct">{pct}%</span>}
      </p>
      <div className={`vid-bar${pct === null ? ' is-early' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100}
           aria-valuenow={pct ?? undefined} aria-label={t('Progress')}>
        <i style={{ inlineSize: `${run.phase === 'write' && run.task !== 'shapes' ? 100 : pct ?? 0}%` }} />
      </div>
      <p className="vid-clock">
        <span>{fill(t('Running for {time}'), { time: clock(elapsed) })}</span>
        {run.phase === 'render' && left > 1000 && <span>{fill(t('about {time} left'), { time: clock(left) })}</span>}
        <span className="vid-dl-spec-tag" dir="ltr">{run.spec}</span>
      </p>
      <div className="vid-dl-run-foot">
        {/* WebKit stops drawing a page whose window is hidden behind others; the
            renderer keeps going, but many times slower (measured: 1.6 s in front,
            20 s hidden, for five seconds of 720p). So the person is told. */}
        <small>{t('Keep the app open until it is saved.')} {t('It renders fastest while this window is in front.')}</small>
        <button className="ghost" onClick={() => run.ctl.abort()}>
          <Icon name="stop" size={12} />{t('Cancel')}
        </button>
      </div>
    </div>
  );
}
