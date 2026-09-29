import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save as savePanel } from '@tauri-apps/plugin-dialog';
import { Icon } from './Icon';
import { IS_MAC } from './Welcome';
import { fill } from './i18n';
import { explain } from './errors';
import { canEncode } from './motionencode';
import { read as readPlay, usePlay } from './motionplay';
import { frameCount } from './motiontypes';
import type { Format, Motion } from './motiontypes';
import {
  FORMAT_TAG, QUALITIES, SIZES, downloadsPath, estimateBytes, fileNameFor, frameAt, openExported, pixelsFor,
  renderMp4, renderPng, sizeName, writeMotionFile, type Quality, type Size,
} from './motionexportops';

/**
 * The Motion studio's Export tab: the graphic as an MP4 film or a PNG still,
 * saved on this computer.
 *
 * The choices come first — what kind of file, how large, how good, motion
 * blur for a film, transparency for a still — then **Download**, which renders
 * the graphic here and saves it in the Downloads folder, and **Save as…**,
 * which asks the OS save panel where. While it runs, the progress (frame by
 * frame) and Cancel take the buttons' place; when it is done, where the file
 * went, with Open.
 *
 * Nothing here writes unless the person pressed the button for that exact
 * file, and what is written is the graphic as it was when they pressed it
 * (SAFETY.md's rule, the same as Video's downloads). Download never replaces a
 * file: Rust saves at the first free name and says which. No request leaves
 * the machine: rendering and encoding are this window's own canvas and
 * WebCodecs (motionexportops.ts). And no `<video>` element, ever — this webview
 * once deadlocked in one — so a finished film is opened in the system's
 * player (`openExported`), never played in the page.
 *
 * Exports live outside React, keyed by the graphic's id, like VideoDownloads'
 * runs: switching tabs, closing the sidebar or opening another graphic does not
 * stop one, and coming back shows it where it had got to. One at a time per
 * graphic. The last choices are remembered for next time.
 */

type T = (s: string) => string;

/** The two kinds of file. */
type Kind = 'mp4' | 'png';
const KINDS: readonly Kind[] = ['mp4', 'png'];

// ── choices, remembered ───────────────────────────────────────────────────

interface Prefs { format: Kind; size: Size; quality: Quality; blur: boolean }

const PREFS_KEY = 'vylo.motion.export.v1';
const FIRST: Prefs = { format: 'mp4', size: '1080p', quality: 'high', blur: false };

/**
 * What was chosen last time. Storage may be missing, blocked (a private
 * window throws on access) or hold something another version wrote, so every
 * field is checked and every failure means the defaults.
 */
function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const got = raw ? (JSON.parse(raw) as Partial<Prefs> | null) : null;
    if (!got || typeof got !== 'object') return { ...FIRST };
    return {
      format: KINDS.includes(got.format as Kind) ? (got.format as Kind) : FIRST.format,
      size: SIZES.includes(got.size as Size) ? (got.size as Size) : FIRST.size,
      quality: QUALITIES.includes(got.quality as Quality) ? (got.quality as Quality) : FIRST.quality,
      blur: typeof got.blur === 'boolean' ? got.blur : FIRST.blur,
    };
  } catch {
    return { ...FIRST };
  }
}

let prefs: Prefs | null = null;

function getPrefs(): Prefs {
  prefs ??= loadPrefs();
  return prefs;
}

function setPrefs(next: Partial<Prefs>) {
  prefs = { ...getPrefs(), ...next };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Remembered for this session only.
  }
  notify();
}

// ── exports, outside React ────────────────────────────────────────────────

interface Run {
  ctl: AbortController;
  kind: Kind;
  /** Drawing and encoding (fonts and pictures load first), then writing the file. */
  phase: 'render' | 'write';
  /** Frames handed to the encoder, of `total`. A still is one frame. */
  done: number;
  total: number;
  started: number;
  /** What is being made: `1080p · MP4`. */
  spec: string;
}

interface Outcome { kind: Kind; path: string }

const runs = new Map<string, Run>();
const outcomes = new Map<string, Outcome>();
const failures = new Map<string, string>();
const watchers = new Set<() => void>();

function notify() {
  for (const w of watchers) w();
}

/**
 * Progress arrives once a frame; the tab needs it a few times a second. A
 * timer rather than an animation frame, which a hidden window never gets.
 * It paces only this tab's re-render: the export never waits on it, so a
 * hidden window (whose timers WebKit stretches to about a second) shows the
 * bar move less often and saves the file just as fast.
 */
let queued = 0;
function notifySoon() {
  if (queued) return;
  queued = window.setTimeout(() => { queued = 0; notify(); }, 100);
}

/** Re-render when an export starts, moves or ends, or a choice changes. */
function useExports() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const w = () => setTick((n) => n + 1);
    watchers.add(w);
    return () => { watchers.delete(w); };
  }, []);
}

function abortError(): Error {
  return typeof DOMException === 'function'
    ? new DOMException('Aborted', 'AbortError')
    : Object.assign(new Error('Aborted'), { name: 'AbortError' });
}

/** A failure as the sentence the person reads. The engine's codes are ours; anything else is explained. */
function sentence(e: unknown, t: T): string {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  if (msg === 'motion:no-encoder') return t('This window cannot make an MP4 here. Save a PNG instead.');
  if (msg === 'motion:too-large') return t('The video is too large to save. Choose a smaller size, or make it shorter.');
  if (msg === 'motion:no-canvas') return t('This window cannot draw a frame this large. Choose a smaller size.');
  if (msg === 'motion:png-failed') return t('The picture could not be made in this window.');
  if (msg.startsWith('motion:encode-failed')) {
    const why = msg.slice('motion:encode-failed'.length).replace(/^:\s*/, '').trim();
    return fill(t('The video could not be encoded: {why}'), { why: why || msg });
  }
  return explain(e, t('save the file'));
}

interface Job { size: Size; quality: Quality; blur: boolean; transparent: boolean; at: number; path?: string }

/**
 * Make one file and keep what came of it. The graphic is `doc` — the one on
 * screen when the button was pressed, not whatever it becomes while this runs.
 */
function start(doc: Motion, kind: Kind, job: Job, t: T, onError: (m: string) => void) {
  if (runs.has(doc.id)) return;
  const ctl = new AbortController();
  const run: Run = {
    ctl, kind, phase: 'render', done: 0, total: kind === 'mp4' ? frameCount(doc) : 1, started: Date.now(),
    spec: `${sizeName(job.size)} · ${kind.toUpperCase()}`,
  };
  runs.set(doc.id, run);
  failures.delete(doc.id);
  outcomes.delete(doc.id);
  notify();

  const going = (async (): Promise<string> => {
    const bytes = kind === 'mp4'
      ? await renderMp4(doc, {
        size: job.size, quality: job.quality, blur: job.blur, signal: ctl.signal,
        onProgress: (done, total) => {
          run.done = done;
          run.total = total;
          notifySoon();
        },
      })
      : await renderPng(doc, { size: job.size, at: job.at, transparent: job.transparent });
    if (ctl.signal.aborted) throw abortError();
    run.phase = 'write';
    notify();
    const path = job.path ?? await downloadsPath(fileNameFor(doc, kind, FORMAT_TAG[doc.format]));
    return writeMotionFile(path, bytes, { unique: !job.path });
  })();

  const mine = () => runs.get(doc.id) === run;
  going
    .then((path) => {
      if (mine()) outcomes.set(doc.id, { kind, path });
    })
    .catch((e: unknown) => {
      if (!mine() || ctl.signal.aborted || (e as { name?: string })?.name === 'AbortError') return;
      const m = sentence(e, t);
      failures.set(doc.id, m);
      onError(m);
    })
    .finally(() => {
      if (mine()) runs.delete(doc.id);
      notify();
    });
}

/**
 * The graphic was deleted: an export of it still rendering is stopped, and
 * what came of the last one is forgotten. A file already being written is
 * written — there is nothing left to stop — as Cancel says.
 */
export function dropExports(id: string) {
  runs.get(id)?.ctl.abort();
  outcomes.delete(id);
  failures.delete(id);
  notify();
}

// ── what this window can encode ───────────────────────────────────────────

/** Whether an MP4 can be made at each size and quality. */
type Abilities = Record<Size, Record<Quality, boolean>>;

const probes = new Map<string, Promise<Abilities>>();

/**
 * Asked once per shape and frame rate in a session — nine quick questions to
 * the encoder, all at once — and kept: what the window's encoder can do does
 * not change while it is open.
 */
function abilities(format: Format, fps: number): Promise<Abilities> {
  const key = `${format}@${fps}`;
  let p = probes.get(key);
  if (!p) {
    const ask = (s: Size, q: Quality) => {
      const { width, height } = pixelsFor(format, s);
      return canEncode(width, height, fps, q).then((r) => !!r, () => false);
    };
    p = Promise.all(SIZES.map((s) => Promise.all(QUALITIES.map((q) => ask(s, q))))).then((rows) => {
      const out = {} as Abilities;
      SIZES.forEach((s, i) => {
        out[s] = {} as Record<Quality, boolean>;
        QUALITIES.forEach((q, j) => { out[s][q] = rows[i][j]; });
      });
      return out;
    });
    probes.set(key, p);
  }
  return p;
}

/** `want` when it fits, else the nearest choice that does — a smaller one before a larger. */
function nearest<X>(list: readonly X[], want: X, fits: (x: X) => boolean): X {
  if (fits(want)) return want;
  const at = list.indexOf(want);
  for (let d = 1; d < list.length; d++) {
    for (const i of [at - d, at + d]) {
      if (i >= 0 && i < list.length && fits(list[i])) return list[i];
    }
  }
  return want;
}

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

/** A moment in the graphic as `0:02.50`. */
function moment(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  return `${Math.floor(cs / 6000)}:${String(Math.floor((cs % 6000) / 100)).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** Megabytes as the estimate shows them: `0.4`, `6.2`, `48`. */
function megabytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  return mb >= 10 ? String(Math.round(mb)) : Math.max(0.1, mb).toFixed(1);
}

/** A sentence with one part put in as an element — a path or a time kept left to right inside Arabic or Kurdish. */
function Slot({ template, name, children }: { template: string; name: string; children: ReactNode }) {
  const key = `{${name}}`;
  const at = template.indexOf(key);
  if (at < 0) return <>{template}</>;
  return <>{template.slice(0, at)}{children}{template.slice(at + key.length)}</>;
}

/** What a run is doing, and how far it has got in whole percent (null before the first frame, and for a still). */
function runState(run: Run, t: T): { what: string; pct: number | null } {
  const f = run.kind === 'mp4' && run.done > 0 ? Math.min(1, run.done / Math.max(1, run.total)) : null;
  const what = run.phase === 'write' ? t('Saving the file…') : run.kind === 'png' ? t('Rendering the picture…') : t('Rendering the video…');
  return { what, pct: f === null || run.phase === 'write' ? null : Math.round(f * 100) };
}

/** The download arrow, drawn on the icon set's grid: 24, a 1.5 stroke, round joins — VideoDownloads' own. */
function DownloadGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 4.5v10.5M7.5 11 12 15.5 16.5 11M5 19.5h14" />
    </svg>
  );
}

/**
 * Which frame a still is: the playhead's. Its own component, so the playhead
 * moving sixty times a second while the graphic plays re-renders this line
 * and not the tab.
 */
function Playhead({ t, doc }: { t: T; doc: Motion }) {
  const play = usePlay();
  return (
    <p className="mo-ex-frame">
      <Slot template={t('The frame at the playhead: {time}. Move the playhead to choose another.')} name="time">
        <bdi dir="ltr">{moment(frameAt(doc, play.t) / doc.fps)}</bdi>
      </Slot>
    </p>
  );
}

// ── the tab ───────────────────────────────────────────────────────────────

export function MotionExport({ t, doc, onError }: { t: (s: string) => string; doc: Motion; onError: (m: string) => void }) {
  useExports();
  const run = runs.get(doc.id);
  useTick(!!run);
  const [keep, setKeep] = useState(true);
  const [can, setCan] = useState<Abilities | null>(null);

  // A transparent graphic keeps its transparency in a still unless told otherwise, each time one is opened.
  useEffect(() => { setKeep(true); }, [doc.id]);

  useEffect(() => {
    let live = true;
    setCan(null);
    void abilities(doc.format, doc.fps).then((a) => { if (live) setCan(a); });
    return () => { live = false; };
  }, [doc.format, doc.fps]);

  const p = getPrefs();
  // Until the encoder has answered, everything is offered; a film it then
  // refuses fails with a sentence, not halfway through.
  const works = (s: Size, q: Quality) => !can || can[s][q];
  const sizeWorks = (s: Size) => QUALITIES.some((q) => works(s, q));
  const anyMp4 = SIZES.some(sizeWorks);
  const kind: Kind = p.format === 'mp4' && !anyMp4 ? 'png' : p.format;
  // A size this window cannot encode (4K, on some machines) falls back to the nearest it can, rather than disabling Download.
  const size: Size = kind === 'mp4' ? nearest(SIZES, p.size, sizeWorks) : p.size;
  const quality: Quality = kind === 'mp4' ? nearest(QUALITIES, p.quality, (q) => works(size, q)) : p.quality;
  const px = pixelsFor(doc.format, size);
  const clear = doc.backdrop === null;
  const busy = !!run || doc.stage === 'planning';
  const outcome = outcomes.get(doc.id);
  // The file just saved is shown where the buttons were: in the sidebar that is at the column's foot, and the card
  // saying where it went is taller than the buttons, so it is brought into view — once, as it appears.
  const doneBox = useRef<HTMLDivElement>(null);
  const goBtn = useRef<HTMLButtonElement>(null);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (run) {
      wasRunning.current = true;
      return;
    }
    if (wasRunning.current) {
      if (outcome) doneBox.current?.scrollIntoView?.({ block: 'nearest' });
      // The progress card had the keyboard (its Cancel) and is gone: it goes back to Download, where it began.
      if (!document.activeElement || document.activeElement === document.body) goBtn.current?.focus();
    }
    wasRunning.current = false;
  });
  const failure = failures.get(doc.id);
  const tooLarge = t('This window cannot make an MP4 this large.');
  // What a screen reader hears, from one region that is always there: a region put in with its words already in it
  // is often not read at all. The progress is said every tenth, not every frame.
  const state = run ? runState(run, t) : null;
  const heard = state ? (state.pct === null ? state.what : `${state.what} ${Math.floor(state.pct / 10) * 10}%`)
    : outcome ? fill(t('Saved to {path}'), { path: outcome.path }) : '';

  const choose = (next: Partial<Prefs>) => {
    // A failure was about the choices it was made with.
    failures.delete(doc.id);
    setPrefs(next);
  };

  const job = (at: number, path?: string): Job => ({ size, quality, blur: p.blur, transparent: clear && keep, at, path });

  const download = () => {
    if (busy) return;
    start(doc, kind, job(readPlay().t), t, onError);
  };

  const saveAs = async () => {
    if (busy) return;
    const at = readPlay().t;
    let path: string | null;
    try {
      path = await savePanel({
        title: kind === 'mp4' ? t('Export MP4') : t('Export PNG'),
        defaultPath: fileNameFor(doc, kind, FORMAT_TAG[doc.format]),
        filters: [{ name: kind.toUpperCase(), extensions: [kind] }],
      });
    } catch (e) {
      onError(explain(e, t('save the file')));
      return;
    }
    // Closing the panel is choosing not to save: nothing happens.
    if (path) start(doc, kind, job(at, path), t, onError);
  };

  const open = (path: string) => openExported(path).catch((e: unknown) => onError(explain(e, t('open the file'))));
  const reveal = (path: string) => invoke('reveal_path', { path }).catch((e: unknown) => onError(explain(e, t('show the file'))));
  const dismiss = () => {
    outcomes.delete(doc.id);
    notify();
  };

  return (
    <section className="mo-ex">
      <div className="vid-dl-set">
        <span className="vid-group-label">{t('Format')}</span>
        <div className="vid-seg mo-ex-kinds" role="group" aria-label={t('Format')}>
          <button type="button" className={kind === 'mp4' ? 'on' : ''} aria-pressed={kind === 'mp4'} disabled={busy || !anyMp4}
                  onClick={() => choose({ format: 'mp4' })}>
            <Icon name="film" size={14} />
            <span>{t('Video')}</span>
            <bdi dir="ltr" className="vid-dl-ext">MP4</bdi>
          </button>
          <button type="button" className={kind === 'png' ? 'on' : ''} aria-pressed={kind === 'png'} disabled={busy}
                  onClick={() => choose({ format: 'png' })}>
            <Icon name="image" size={14} />
            <span>{t('Picture')}</span>
            <bdi dir="ltr" className="vid-dl-ext">PNG</bdi>
          </button>
        </div>
        {!anyMp4 && <p className="mo-ex-note">{t('This window cannot make an MP4 here. Save a PNG instead.')}</p>}
      </div>

      <div className="vid-dl-set">
        <span className="vid-group-label">{t('Size')}</span>
        <div className="vid-seg vid-dl-seg mo-ex-sizes" role="group" aria-label={t('Size')}>
          {SIZES.map((s) => {
            const able = kind === 'png' || sizeWorks(s);
            const dims = pixelsFor(doc.format, s);
            return (
              <button type="button" key={s} className={s === size ? 'on' : ''} aria-pressed={s === size} disabled={busy || !able}
                      title={able ? undefined : tooLarge} onClick={() => choose({ size: s })}>
                <span>{sizeName(s)}</span>
                <bdi dir="ltr" className="mo-ex-px">{dims.width} × {dims.height}</bdi>
              </button>
            );
          })}
        </div>
        <small>
          {kind === 'mp4' && size !== p.size && `${tooLarge} `}
          {size === '720p' ? t('What YouTube asks for in a thumbnail, and plenty for a phone.')
            : size === '4k' ? t('Four times the pixels of Full HD: sharpest on a large screen, and a longer wait.')
            : t('Full HD: what most platforms show.')}
        </small>
      </div>

      {kind === 'mp4' ? (
        <>
          <div className="vid-dl-set">
            <span className="vid-group-label">{t('Quality')}</span>
            <div className="vid-seg vid-dl-seg" role="group" aria-label={t('Quality')}>
              {QUALITIES.map((q) => (
                <button type="button" key={q} className={q === quality ? 'on' : ''} aria-pressed={q === quality}
                        disabled={busy || !works(size, q)} onClick={() => choose({ quality: q })}>
                  {q === 'medium' ? t('Smaller file') : q === 'high' ? t('Balanced') : t('Best quality')}
                </button>
              ))}
            </div>
            <small>{t('A higher bitrate keeps words crisp when a platform compresses the video again; the file is larger.')}</small>
          </div>
          <label className="vid-check mo-ex-check">
            <input type="checkbox" checked={p.blur} disabled={busy} onChange={(e) => choose({ blur: e.target.checked })} />
            <span>
              <b>{t('Motion blur')}</b>
              <small>{t('Smoother movement, as a camera would see it; saving takes several times as long.')}</small>
            </span>
          </label>
          {clear && (
            <p className="mo-ex-note">
              <i className="mo-ex-alpha" aria-hidden="true" />
              <span>{t('An MP4 cannot keep transparency; the background colour is used. Save a PNG to keep it.')}</span>
            </p>
          )}
        </>
      ) : (
        <>
          <div className="vid-dl-set">
            <span className="vid-group-label">{t('Frame')}</span>
            <Playhead t={t} doc={doc} />
          </div>
          {clear && (
            <label className="vid-check mo-ex-check">
              <input type="checkbox" checked={keep} disabled={busy} onChange={(e) => setKeep(e.target.checked)} />
              <span>
                <b>{t('Keep transparency')}</b>
                <i className="mo-ex-alpha" aria-hidden="true" />
              </span>
            </label>
          )}
        </>
      )}

      {run ? <Progress t={t} run={run} /> : (
        <>
          <div className="mo-ex-acts">
            <button ref={goBtn} type="button" className="sb-cta-go mo-ex-go" onClick={download} disabled={busy || (kind === 'mp4' && !anyMp4)}>
              <DownloadGlyph size={15} />{kind === 'mp4' ? t('Download MP4') : t('Download PNG')}
            </button>
            <button type="button" className="mo-ex-saveas" onClick={() => void saveAs()} disabled={busy || (kind === 'mp4' && !anyMp4)}
                    title={t('Choose the folder and the name')}>
              {t('Save as…')}
            </button>
          </div>
          <p className="vid-dl-spec">
            <span>
              <bdi dir="ltr">{sizeName(size)} · {px.width} × {px.height} · {kind.toUpperCase()}</bdi>
              {/* "Up to": the encoder spends less on flat colour than it is
                  allowed (a 3-second 720p title measured 0.5 to 0.9 MB against
                  2.1), and the question this answers is whether the file will
                  fit where it is going. */}
              {kind === 'mp4' ? ` · ${fill(t('up to about {n} MB'), { n: megabytes(estimateBytes(doc, size, quality)) })}` : ''}
            </span>
            <span>{t('Into your Downloads folder, never over a file that is there.')}</span>
          </p>
        </>
      )}

      {outcome && !run && (
        <div className="vid-dl-done" ref={doneBox}>
          <p className="vid-dl-done-head">
            <Icon name="check" size={14} />
            <span><FileName path={outcome.path} /></span>
            <button type="button" className="sb-act vid-dl-x" onClick={dismiss} title={t('Dismiss')} aria-label={t('Dismiss')}>
              <Icon name="close" size={12} />
            </button>
          </p>
          <p className="mo-ex-where">
            <Slot template={t('Saved to {path}')} name="path">
              <bdi dir="ltr" className="vid-dl-path">{folderOf(outcome.path)}</bdi>
            </Slot>
          </p>
          <div className="vid-dl-acts">
            <button type="button" className="ghost" onClick={() => void open(outcome.path)}>
              <Icon name={outcome.kind === 'mp4' ? 'play' : 'image'} size={12} />{t('Open')}
            </button>
            <button type="button" className="ghost" onClick={() => void reveal(outcome.path)}>
              <Icon name="folder" size={12} />{IS_MAC ? t('Show in Finder') : t('Show in Explorer')}
            </button>
          </div>
        </div>
      )}

      {failure && !run && !outcome && <p className="vid-bad" dir="auto">{failure}</p>}
      <p className="mo-stage-sr" role="status">{heard}</p>
    </section>
  );
}

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

/** The folder a file is in: its path without the name, and without the separator before it. */
const folderOf = (p: string) => p.slice(0, p.length - baseName(p).length).replace(/[\\/]+$/, '') || p;

/**
 * A saved file's name, running the way its title does, with the tail the app
 * added — ` 16x9 (2).png` — kept together left to right: VideoDownloads'
 * `FileName`. Left to the bidi algorithm, the digits beside an Arabic or
 * Kurdish title's last word join its run, and the name comes out as
 * `png.(2) 9… 16`.
 */
function FileName({ path }: { path: string }) {
  const name = baseName(path);
  // From the first printable ASCII character, so the space before it stays with the title.
  const tail = /[!-~][ -~]*$/.exec(name);
  return (
    <bdi className="mo-ex-name" title={path}>
      {tail && tail.index > 0 ? <>{name.slice(0, tail.index)}<bdi dir="ltr">{tail[0]}</bdi></> : name}
    </bdi>
  );
}

/** An export under way: what is being made, frame by frame, roughly how long is left, and Cancel. */
function Progress({ t, run }: { t: T; run: Run }) {
  // In view as it starts: it takes the buttons' place and is taller than they were. The button pressed went with
  // them, and the keyboard with it: it is given Cancel, the one thing to press now. (Said by the tab's live region.)
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    box.current?.scrollIntoView?.({ block: 'nearest' });
    if (!document.activeElement || document.activeElement === document.body) cancel.current?.focus();
  }, []);
  const elapsed = Date.now() - run.started;
  const f = run.kind === 'mp4' && run.done > 0 ? Math.min(1, run.done / Math.max(1, run.total)) : null;
  const left = f !== null && f > 0.03 ? (elapsed / f) * (1 - f) : 0;
  const writing = run.phase === 'write';
  const { what, pct } = runState(run, t);
  return (
    <div className="vid-status vid-export" ref={box}>
      <p className="vid-status-line">
        <span className="vid-glyph" aria-hidden="true">✻</span>
        <b>{what}</b>
        {pct !== null && <span className="vid-pct">{pct}%</span>}
      </p>
      <div className={`vid-bar${pct === null && !writing ? ' is-early' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100}
           aria-valuenow={writing ? 100 : pct ?? undefined} aria-label={t('Progress')}>
        <i style={{ inlineSize: `${writing ? 100 : pct ?? 0}%` }} />
      </div>
      <p className="vid-clock">
        {run.kind === 'mp4' && <span>{fill(t('Frame {n} of {of}'), { n: run.done, of: run.total })}</span>}
        <span>{fill(t('Running for {time}'), { time: clock(elapsed) })}</span>
        {!writing && left > 1000 && <span>{fill(t('about {time} left'), { time: clock(left) })}</span>}
        <span className="vid-dl-spec-tag" dir="ltr">{run.spec}</span>
      </p>
      <div className="vid-dl-run-foot">
        {/* WebKit draws a page whose window is hidden far more slowly, and the
            frames are drawn by this page, so the person is told. */}
        <small>{t('Keep the app open until it is saved.')} {t('It renders fastest while this window is in front.')}</small>
        {/* A file being written is written: there is nothing left to cancel. */}
        <button ref={cancel} type="button" className="ghost" onClick={() => run.ctl.abort()} disabled={writing}>
          <Icon name="stop" size={12} />{t('Cancel')}
        </button>
      </div>
    </div>
  );
}
