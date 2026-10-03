import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save as savePanel } from '@tauri-apps/plugin-dialog';
import { Icon } from './Icon';
import { IS_MAC } from './Welcome';
import { fill } from './i18n';
import { explain } from './errors';
import { canEncode } from './motionencode';
import { read as readPlay, usePlay } from './motionplay';
import { MotionThumb } from './MotionThumb';
import type { Format, Motion } from './motiontypes';
import {
  FORMAT_TAG, QUALITIES, SIZES, downloadsPath, filmSound, frameAt, openExported, pixelsFor, renderMp4, renderPng, sizeName,
  writeMotionFile, type Quality, type RenderDeps, type Size,
} from './motionexportops';
import { SOUND_MOODS, moodOf, readSound } from './motionsound';
import { GIF, GIF_RATES, GIF_SIDES, gifSizeFor, renderGif, type GifDeps, type GifMade } from './motiongifops';
import {
  DESTINATIONS, FIRST_PREFS, bestDestination, destinationLine, destinationName, destinationStep, fileNameOf, fitBox,
  fittedPaint, outputOf, ratioOf, readPrefs, settingsFor, shapeFor, surroundOf, type Destination, type ShareChoices,
  type ShareKind, type SharePrefs, type ShareSettings,
} from './motionshare';

/**
 * The Motion studio's Export tab: where the graphic is going, and the file
 * for it, saved on this computer.
 *
 * ## The first screen
 *
 * One question — **Where is it going?** — as six cards: Story or Reel, Post,
 * YouTube (MP4s in 9:16, 4:5 or 1:1, and 16:9), Web loop (a GIF), Picture (a
 * PNG of the graphic's best moment) and Custom. The card for the graphic's own
 * shape is already chosen (`bestDestination`), so the shortest path is the
 * one it always was: open the tab, press **Download**. Under the cards, one
 * line says what will be made — the size, the kind, about how large and how
 * long — and the destination's settings come from `motionshare.ts`, which
 * also decides everything below that is not a click.
 *
 * Today's dialog asked for the kind, the size, the quality and motion blur
 * before Download, with Save as… beside it; this one asks one question. Every
 * one of those choices is still here, under **More options**, closed until it
 * is opened (and open at once for Custom, whose point is to choose): the size,
 * the MP4's quality and motion blur, the GIF's size and frames a second, the
 * picture's moment, transparency, the kind of file for Custom, and **Save
 * as…**. What is chosen there is remembered for next time, as before.
 *
 * ## Another shape is a copy
 *
 * A destination of another shape — a wide title sent to a story — makes the
 * file from a copy of the graphic in that shape (`outputOf`): the template
 * built again for it, or, for a graphic edited by hand, the graphic fitted
 * whole inside the frame on its own background (`fittedPaint`). The graphic is
 * not changed. The tab says so, with the file drawn small beside the
 * sentence, so nobody is surprised by it.
 *
 * ## What it keeps from before
 *
 * The notices (an MP4 has no transparency; this window cannot make an MP4, so
 * the picture is chosen and the films cannot be), the size that falls back to
 * one the encoder can make, the progress, Cancel, where the file went, Open
 * and Show in Finder — all as they were.
 *
 * ## Sound
 *
 * A graphic that has sound (the Sound row in Design, anything but Off) gets
 * one more line, under the cards, saying what the file will carry
 * (`soundLineOf`): an MP4 its effects, its music and the music's mood; a GIF
 * or a picture none, said rather than left to be discovered. A graphic without
 * sound gets no line, and its film is made exactly as it was before there was
 * sound: `renderMp4` is asked for sound only when `filmSound` says so. The
 * sound is made before the first frame ("Preparing the sound…" on the bar),
 * and a window that cannot encode it still saves the film, silent, and says
 * so quietly under the saved file — never as an error, because the film is
 * good. `soundNote`, when the panel passes one, takes the MP4's line's place.
 *
 * ## The rules it keeps
 *
 * Nothing here writes unless the person pressed the button for that exact
 * file, and what is written is the graphic as it was when they pressed it
 * (SAFETY.md's rule, the same as Video's downloads). Download never replaces a
 * file: Rust saves at the first free name and says which. No request leaves
 * the machine: rendering and encoding are this window's own canvas, WebCodecs
 * and `motiongif.ts`. And no `<video>` element, ever — this webview once
 * deadlocked in one — so a finished film is opened in the system's player
 * (`openExported`), never played in the page.
 *
 * Exports live outside React, keyed by the graphic's id, like VideoDownloads'
 * runs: switching tabs, closing the sidebar or opening another graphic does not
 * stop one, and coming back shows it where it had got to. One at a time per
 * graphic. The destination chosen for a graphic is kept while the app is open.
 */

type T = (s: string) => string;

// ── choices, remembered ───────────────────────────────────────────────────

/**
 * The key SAFETY.md names. Version 1 kept `{ format, size, quality, blur }`;
 * the same key now keeps those and the GIF's two, written with the kind as
 * `format` still, so what an older version wrote is read, and what this one
 * writes is still a version-1 record to an older one.
 */
const PREFS_KEY = 'vylo.motion.export.v1';

/**
 * What was chosen last time. Storage may be missing, blocked (a private
 * window throws on access) or hold something another version wrote, so every
 * field is checked (`readPrefs`) and every failure means the defaults.
 */
function loadPrefs(): SharePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return readPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...FIRST_PREFS };
  }
}

let prefs: SharePrefs | null = null;

function getPrefs(): SharePrefs {
  prefs ??= loadPrefs();
  return prefs;
}

function setPrefs(next: Partial<SharePrefs>) {
  prefs = { ...getPrefs(), ...next };
  try {
    const { kind, ...rest } = prefs;
    localStorage.setItem(PREFS_KEY, JSON.stringify({ format: kind, ...rest }));
  } catch {
    // Remembered for this session only.
  }
  notify();
}

/** The destination each graphic has, once the person has chosen one. */
const chosen = new Map<string, Destination>();

// ── exports, outside React ────────────────────────────────────────────────

interface Run {
  ctl: AbortController;
  kind: ShareKind;
  /** Drawing and encoding (fonts and pictures load first), then writing the file. */
  phase: 'render' | 'write';
  /** A film's sound being made and encoded, before its first frame: true until a frame arrives. */
  sound: boolean;
  /** Frames painted, of `total`. A still is one frame; a GIF counts the frames its colours are chosen from too. */
  done: number;
  total: number;
  /** A GIF being made again, smaller, is on its second attempt or later. */
  attempt: number;
  started: number;
  /** When this attempt began: what the time left is reckoned from. */
  since: number;
  /** What is being made: `1080p · MP4`. */
  spec: string;
}

interface Outcome { kind: ShareKind; path: string; note: string }

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
  if (msg === 'motion:gif-failed') return t('The GIF could not be made in this window.');
  if (msg.startsWith('motion:encode-failed')) {
    const why = msg.slice('motion:encode-failed'.length).replace(/^:\s*/, '').trim();
    return fill(t('The video could not be encoded: {why}'), { why: why || msg });
  }
  return explain(e, t('save the file'));
}

/** Megabytes as the estimate shows them: `0.4`, `6.2`, `48`. */
function megabytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  return mb >= 10 ? String(Math.round(mb)) : Math.max(0.1, mb).toFixed(1);
}

/** The file in a few technical words, the same in every language: `1080p · 1080 × 1920 · MP4`. */
function specOf(s: ShareSettings): string {
  const kind = s.kind.toUpperCase();
  return s.size ? `${sizeName(s.size)} · ${s.width} × ${s.height} · ${kind}` : `${s.width} × ${s.height} · ${kind}`;
}

/** What a GIF gave up to fit, or that it is still over, as one sentence; empty when it gave up nothing. */
function gifNote(made: GifMade, t: T): string {
  const cap = Math.round(GIF.maxBytes / 1_000_000);
  if (made.over) return fill(t('It is still larger than {n} MB: make the graphic shorter, or choose a smaller size under More options.'), { n: cap });
  if (!made.reduced.length) return '';
  const what = made.reduced.map((c) => (c.what === 'colors' ? fill(t('{n} colours'), { n: c.to })
    : c.what === 'size' ? fill(t('{w} × {h} pixels'), { w: made.width, h: made.height })
    : fill(t('{n} frames a second'), { n: c.to }))).join(' · ');
  return fill(t('Made smaller to stay under {n} MB: {what}.'), { n: cap, what });
}

interface Job { s: ShareSettings; out: Motion; path?: string }

/** A canvas for the graphic a file is fitted around (`fittedPaint` asks for one). */
function scratchCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

/** What the renderers draw with: the real ones, unless a test hands in the fakes they are tested with. */
export type FileDeps = Partial<RenderDeps & GifDeps>;

/**
 * The file a press asks for, as bytes, and the sentence to say under it once
 * it is saved (empty when there is nothing to say). `s` is the file's
 * settings and `out` the graphic it is made from (`outputOf`): the graphic on
 * screen when the button was pressed, or its copy in the file's shape. A
 * graphic fitted inside another shape is painted by its own painter, over
 * `deps`' (`fittedPaint`).
 *
 * A film carries the graphic's sound exactly when it has some that is not off
 * (`filmSound`); one without is rendered as it was before there was sound.
 * When the sound had to be left out — this window has no AAC encoder, or the
 * sound would not render — the film is still the film, and the sentence says
 * it was saved without sound.
 */
export async function makeFile(
  doc: Motion, s: ShareSettings, out: Motion, t: T,
  o: { signal?: AbortSignal; onProgress?: (done: number, total: number, attempt?: number) => void; onSound?: () => void },
  deps: FileDeps = {},
): Promise<{ bytes: Uint8Array; note: string }> {
  const d: FileDeps = s.reshape === 'fit' ? { ...deps, paint: fittedPaint(doc, fitBox(s.from, s.width, s.height), scratchCanvas, deps.paint) } : deps;
  if (s.kind === 'mp4') {
    const film = await renderMp4(out, {
      size: s.size ?? '1080p', quality: s.quality ?? 'high', blur: s.blur, sound: filmSound(out), signal: o.signal, onProgress: o.onProgress,
      onSound: o.onSound,
    }, d);
    // The film is good; only its sound was left out.
    return { bytes: film, note: film.audio === 'dropped' ? t('Saved without sound: this computer cannot make the audio track.') : '' };
  }
  if (s.kind === 'gif') {
    const made = await renderGif(out, { side: s.side ?? GIF.side, fps: s.fps, transparent: s.transparent, signal: o.signal, onProgress: o.onProgress }, d);
    return { bytes: made.bytes, note: gifNote(made, t) };
  }
  return { bytes: await renderPng(out, { size: s.size ?? '1080p', at: s.at ?? 0, transparent: s.transparent }, d), note: '' };
}

/**
 * Make one file and keep what came of it. The graphic is `job.out` — the one
 * on screen when the button was pressed (or its copy in the file's shape), not
 * whatever it becomes while this runs.
 */
function start(doc: Motion, job: Job, t: T, onError: (m: string) => void) {
  if (runs.has(doc.id)) return;
  const { s, out } = job;
  const ctl = new AbortController();
  const run: Run = {
    ctl, kind: s.kind, phase: 'render', sound: false, done: 0, total: s.kind === 'png' ? 1 : s.frames, attempt: 1,
    started: Date.now(), since: Date.now(), spec: specOf(s),
  };
  runs.set(doc.id, run);
  failures.delete(doc.id);
  outcomes.delete(doc.id);
  notify();

  const moved = (done: number, total: number, attempt = 1) => {
    run.done = done;
    run.total = total;
    if (attempt !== run.attempt) {
      run.attempt = attempt;
      run.since = Date.now();
    }
    // The sound is made: the time left is reckoned from the first frame, not from before the sound.
    if (run.sound && done > 0) {
      run.sound = false;
      run.since = Date.now();
    }
    notifySoon();
  };
  // The sound stage is said, not measured: rendering the music has no steps to count, and the whole of it takes a second or two.
  const sounding = () => {
    if (run.done > 0 || run.sound) return;
    run.sound = true;
    notifySoon();
  };

  const going = (async (): Promise<{ path: string; note: string }> => {
    const { bytes, note } = await makeFile(doc, s, out, t, { signal: ctl.signal, onProgress: moved, onSound: sounding });
    if (ctl.signal.aborted) throw abortError();
    run.phase = 'write';
    notify();
    const path = job.path ?? await downloadsPath(fileNameOf(doc, s.kind, FORMAT_TAG[s.format]));
    return { path: await writeMotionFile(path, bytes, { unique: !job.path }), note };
  })();

  const mine = () => runs.get(doc.id) === run;
  going
    .then(({ path, note }) => {
      if (mine()) outcomes.set(doc.id, { kind: s.kind, path, note });
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
  chosen.delete(id);
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

/** What the encoder said about one shape, asked when the shape is shown. Null until it has answered. */
function useAbilities(format: Format, fps: number): Abilities | null {
  const [can, setCan] = useState<{ key: string; a: Abilities } | null>(null);
  const key = `${format}@${fps}`;
  useEffect(() => {
    let live = true;
    void abilities(format, fps).then((a) => { if (live) setCan({ key, a }); });
    return () => { live = false; };
  }, [format, fps, key]);
  return can && can.key === key ? can.a : null;
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

/**
 * A sentence with parts put in as elements — a path, a time or a ratio kept
 * left to right inside Arabic or Kurdish. A `{name}` the parts do not have is
 * left as it is written.
 */
function Fill({ template, parts }: { template: string; parts: Record<string, ReactNode> }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    if (!(m[1] in parts) || m.index === undefined) continue;
    out.push(template.slice(last, m.index), <Fragment key={m.index}>{parts[m[1]]}</Fragment>);
    last = m.index + m[0].length;
  }
  out.push(template.slice(last));
  return <>{out}</>;
}

/** What a run is doing, and how far it has got in whole percent (null before the first frame, and for a still). */
function runState(run: Run, t: T): { what: string; pct: number | null } {
  const f = run.kind !== 'png' && run.done > 0 ? Math.min(1, run.done / Math.max(1, run.total)) : null;
  const what = run.phase === 'write' ? t('Saving the file…')
    : run.kind === 'png' ? t('Rendering the picture…')
    : run.kind === 'gif' ? (run.attempt > 1 ? t('Making the GIF smaller to fit…') : t('Rendering the GIF…'))
    : run.sound ? t('Preparing the sound…')
    : t('Rendering the video…');
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
 * A destination's picture, on the same grid: the shape of the file — a tall
 * phone, a 4:5 post, a wide screen with a play mark (a generic one, no
 * platform's own) — a loop, a picture, and the settings sliders for Custom.
 */
const GLYPHS: Readonly<Record<Destination, string>> = {
  story: 'M8.5 3.5h7a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 19V5a1.5 1.5 0 0 1 1.5-1.5zM11 17.5h2',
  post: 'M7 4.5h10a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM8.5 15.5l2.6-2.6 1.9 1.9 1.4-1.4 1.6 1.6',
  youtube: 'M5 5.5h14A1.5 1.5 0 0 1 20.5 7v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17V7A1.5 1.5 0 0 1 5 5.5zM10.5 9.4v5.2l4.2-2.6z',
  loop: 'M7.6 9a3 3 0 1 0 0 6c2 0 3-1.5 4.4-3s2.4-3 4.4-3a3 3 0 1 1 0 6c-2 0-3-1.5-4.4-3S9.6 9 7.6 9z',
  picture: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5zM4.6 17.8l4.6-4.6a1.5 1.5 0 0 1 2.1 0l3.5 3.5M13.4 15.1l1.8-1.8a1.5 1.5 0 0 1 2.1 0l2.1 2.1M9.2 9.4v.01',
  custom: 'M4 7.5h6.5M15 7.5h5M4 16.5h4.5M13 16.5h7M12.75 5.2v4.6M10.75 14.2v4.6',
};

function DestGlyph({ d, size = 20 }: { d: Destination; size?: number }) {
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={GLYPHS[d]} />
    </svg>
  );
}

/**
 * Which frame a still is, when it is the playhead's. Its own component, so
 * the playhead moving sixty times a second while the graphic plays re-renders
 * this line and not the tab.
 */
function Playhead({ t, doc }: { t: T; doc: Motion }) {
  const play = usePlay();
  return (
    <p className="mo-ex-frame">
      <Fill template={t('The frame at the playhead: {time}. Move the playhead to choose another.')}
            parts={{ time: <bdi dir="ltr">{moment(frameAt(doc, play.t) / doc.fps)}</bdi> }} />
    </p>
  );
}

/** The long side of the little file drawn beside "built again at 9:16". */
const THUMB = 64;

/**
 * What sound the file will carry, as one line, or null when the graphic has
 * none to speak of (no line, so a graphic without sound shows what it always
 * did). An MP4 carries the sound chosen: its effects, its music and the
 * music's mood (the one chosen, else the template's: `moodOf`). A GIF and a
 * picture carry none, and say so, so nobody is surprised by a silent file.
 */
export function soundLineOf(doc: Motion, kind: ShareKind, t: T): string | null {
  const spec = readSound(doc?.sound);
  if (!spec || spec.mode === 'off') return null;
  if (kind === 'gif') return t('Without sound: a GIF cannot carry it.');
  if (kind === 'png') return t('Without sound: a picture has none.');
  if (spec.mode === 'fx') return t('With sound: effects made from the animation.');
  const id = moodOf(doc);
  const mood = t(SOUND_MOODS.find((m) => m.id === id)?.label ?? 'Uplifting');
  return fill(spec.mode === 'music' ? t('With sound: music ({mood}).') : t('With sound: effects and music ({mood}).'), { mood });
}

// ── the tab ───────────────────────────────────────────────────────────────

export function MotionExport({ t, doc, onError, soundNote }: {
  t: (s: string) => string;
  doc: Motion;
  onError: (m: string) => void;
  /**
   * The sound line for an MP4, when the panel wants to say it itself. Without
   * one the tab says what the file will carry (`soundLineOf`); a GIF's and a
   * picture's line is always the tab's own.
   */
  soundNote?: ReactNode;
}) {
  useExports();
  const run = runs.get(doc.id);
  useTick(!!run);
  const [keep, setKeep] = useState(true);
  const [frame, setFrame] = useState<'best' | 'playhead'>('best');
  const [more, setMore] = useState(false);

  // A transparent graphic keeps its transparency, a picture is its best moment, and the options are closed, each time one is opened.
  useEffect(() => {
    setKeep(true);
    setFrame('best');
    setMore(chosen.get(doc.id) === 'custom');
  }, [doc.id]);

  const p = getPrefs();
  const can = useAbilities(doc.format, doc.fps);
  // Until the encoder has answered, everything is offered; a film it then
  // refuses fails with a sentence, not halfway through.
  const anyMp4 = !can || SIZES.some((s) => QUALITIES.some((q) => can[s][q]));
  const picked = chosen.get(doc.id) ?? bestDestination(doc, anyMp4);
  const filmCard = (d: Destination) => d === 'story' || d === 'post' || d === 'youtube';
  const dest: Destination = !anyMp4 && filmCard(picked) ? 'picture' : picked;
  const choices: Partial<ShareChoices> = { ...p, kind: p.kind === 'mp4' && !anyMp4 ? 'png' : p.kind, transparent: keep, frame };
  const draft = settingsFor(dest, doc, choices);

  // A size this window cannot encode (4K, on some machines) falls back to the nearest it can, rather than disabling Download.
  const canOut = useAbilities(draft.format, doc.fps);
  const works = (s: Size, q: Quality) => !canOut || canOut[s][q];
  const sizeWorks = (s: Size) => QUALITIES.some((q) => works(s, q));
  const size: Size = draft.kind === 'mp4' ? nearest(SIZES, p.size, sizeWorks) : p.size;
  const quality: Quality = draft.kind === 'mp4' ? nearest(QUALITIES, p.quality, (q) => works(size, q)) : p.quality;
  const settle = (playhead: number) => settingsFor(dest, doc, { ...choices, size, quality, playhead });
  const s = size === p.size && quality === p.quality ? draft : settle(0);
  const out = useMemo(() => outputOf(doc, s), [doc, s.format, s.reshape]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = s.transparent || s.alphaLost;
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

  const choose = (next: Partial<SharePrefs>) => {
    // A failure was about the choices it was made with.
    failures.delete(doc.id);
    setPrefs(next);
  };

  const pick = (d: Destination) => {
    if (busy) return;
    failures.delete(doc.id);
    chosen.set(doc.id, d);
    // Custom is a choice of settings: they are shown at once.
    if (d === 'custom') setMore(true);
    notify();
  };

  const enabled = DESTINATIONS.map((d) => !busy && (anyMp4 || !filmCard(d)));
  const onCardKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    const to = destinationStep(DESTINATIONS.indexOf(dest), e.key, rtl, enabled);
    if (to === null) return;
    e.preventDefault();
    pick(DESTINATIONS[to]);
    document.getElementById(`mo-share-${doc.id}-${DESTINATIONS[to]}`)?.focus();
  };

  const job = (path?: string): Job => {
    const now = settle(readPlay().t);
    return { s: now, out: outputOf(doc, now), path };
  };

  const download = () => {
    if (busy) return;
    setMore(false);
    start(doc, job(), t, onError);
  };

  const saveAs = async () => {
    if (busy) return;
    // The moment the button was pressed, not the moment the panel closed.
    const { s: now, out: copy } = job();
    let path: string | null;
    try {
      path = await savePanel({
        title: now.kind === 'mp4' ? t('Export MP4') : now.kind === 'gif' ? t('Export GIF') : t('Export PNG'),
        defaultPath: fileNameOf(doc, now.kind, FORMAT_TAG[now.format]),
        filters: [{ name: now.kind.toUpperCase(), extensions: [now.kind] }],
      });
    } catch (e) {
      onError(explain(e, t('save the file')));
      return;
    }
    // Closing the panel is choosing not to save: nothing happens.
    if (path) {
      setMore(false);
      start(doc, { s: now, out: copy, path }, t, onError);
    }
  };

  const open = (path: string) => openExported(path).catch((e: unknown) => onError(explain(e, t('open the file'))));
  const reveal = (path: string) => invoke('reveal_path', { path }).catch((e: unknown) => onError(explain(e, t('show the file'))));
  const dismiss = () => {
    outcomes.delete(doc.id);
    notify();
  };

  const qId = `mo-share-q-${doc.id}`;
  const moreId = `mo-share-more-${doc.id}`;
  const cap = Math.round(GIF.maxBytes / 1_000_000);
  const goLabel = s.kind === 'mp4' ? t('Download MP4') : s.kind === 'gif' ? t('Download GIF') : t('Download PNG');
  // The file drawn small: the rebuilt copy itself, or the graphic in its box with the colour around it.
  const thumbW = s.width >= s.height ? THUMB : Math.max(1, Math.round((THUMB * s.width) / s.height));
  const thumbH = s.width >= s.height ? Math.max(1, Math.round((THUMB * s.height) / s.width)) : THUMB;
  const fitted = fitBox(s.from, thumbW, thumbH);
  const soundLine = s.kind === 'mp4' && soundNote ? soundNote : soundLineOf(out, s.kind, t);

  return (
    <section className="mo-ex mo-share">
      <div className="vid-dl-set">
        <span className="vid-group-label" id={qId}>{t('Where is it going?')}</span>
        <div className="mo-share-dests" role="radiogroup" aria-labelledby={qId} onKeyDown={onCardKey}>
          {DESTINATIONS.map((d, i) => {
            const on = d === dest;
            return (
              <button key={d} type="button" role="radio" id={`mo-share-${doc.id}-${d}`} aria-checked={on} tabIndex={on ? 0 : -1}
                      className={on ? 'mo-share-dest on' : 'mo-share-dest'} disabled={!enabled[i]}
                      title={!anyMp4 && filmCard(d) ? t('This window cannot make an MP4 here. Save a PNG instead.') : undefined}
                      onClick={() => pick(d)}>
                <DestGlyph d={d} />
                <b>{destinationName(d, t)}</b>
                <small><Fill template={destinationLine(d, t)} parts={{ ratio: <bdi dir="ltr">{ratioOf(shapeFor(d, doc.format))}</bdi> }} /></small>
              </button>
            );
          })}
        </div>
        {!anyMp4 && <p className="mo-ex-note">{t('This window cannot make an MP4 here. Save a PNG instead.')}</p>}
      </div>

      {s.reshape !== 'none' && (
        <div className="mo-share-shape">
          <span className="mo-share-thumb" aria-hidden="true">
            {s.reshape === 'rebuild' ? <MotionThumb doc={out} width={thumbW} /> : (
              <span className="mo-share-fit" style={{ inlineSize: thumbW, blockSize: thumbH, background: s.transparent ? undefined : surroundOf(doc) }}>
                <MotionThumb doc={doc} width={fitted.w} />
              </span>
            )}
          </span>
          <p>
            <Fill template={s.reshape === 'rebuild'
              ? t('Built again from its template at {to} for this file. Your graphic stays {from}.')
              : t('Fitted whole inside a {to} frame for this file, on its own background. Your graphic stays {from}.')}
                  parts={{ to: <bdi dir="ltr">{ratioOf(s.format)}</bdi>, from: <bdi dir="ltr">{ratioOf(s.from)}</bdi> }} />
          </p>
        </div>
      )}
      {s.kind === 'mp4' && s.alphaLost && (
        <p className="mo-ex-note">
          <i className="mo-ex-alpha" aria-hidden="true" />
          <span>{t('An MP4 cannot keep transparency; the background colour is used. Save a PNG to keep it.')}</span>
        </p>
      )}
      {s.trimmed && (
        <p className="mo-ex-note">{fill(t('A GIF runs {n} seconds at most: the first {n} are saved.'), { n: GIF.seconds })}</p>
      )}
      {soundLine ? <div className="mo-share-sound">{soundLine}</div> : null}

      {run ? <Progress t={t} run={run} /> : (
        <>
          <div className="mo-ex-acts">
            <button ref={goBtn} type="button" className="sb-cta-go mo-ex-go" onClick={download} disabled={busy}>
              <DownloadGlyph size={15} />{goLabel}
            </button>
          </div>
          <p className="vid-dl-spec">
            <span>
              <bdi dir="ltr">{specOf(s)}</bdi>
              {s.kind === 'gif' ? ` · ${fill(t('{n} frames a second'), { n: s.fps })}` : ''}
              {/* "Up to" for a film: the encoder spends less on flat colour than it is allowed (a 3-second 720p
                  title measured 0.5 to 0.9 MB against 2.1), and the question this answers is whether the file will
                  fit where it is going. A GIF's and a picture's are guesses, so "about". */}
              {` · ${fill(s.upTo ? t('up to about {n} MB') : t('about {n} MB'), { n: megabytes(s.bytes) })}`}
              {s.ms >= 5000 ? ` · ${fill(t('about {time} to make'), { time: clock(s.ms) })}` : ''}
            </span>
            <span>{t('Into your Downloads folder, never over a file that is there.')}</span>
          </p>
          {s.capped && <p className="mo-share-hint">{fill(t('It may be made smaller to stay under {n} MB.'), { n: cap })}</p>}
        </>
      )}

      <button type="button" className="mo-share-more" aria-expanded={more && !run} aria-controls={moreId} disabled={!!run}
              onClick={() => setMore(!more)}>
        <Icon name="chevron" size={12} />
        <span>{t('More options')}</span>
      </button>
      {more && !run && (
        <div className="vid-dl-more" id={moreId}>
          {dest === 'custom' && (
            <div className="vid-dl-set">
              <span className="vid-group-label">{t('Format')}</span>
              <div className="vid-seg mo-ex-kinds" role="group" aria-label={t('Format')}>
                <button type="button" className={s.kind === 'mp4' ? 'on' : ''} aria-pressed={s.kind === 'mp4'} disabled={busy || !anyMp4}
                        onClick={() => choose({ kind: 'mp4' })}>
                  <Icon name="film" size={14} />
                  <span>{t('Video')}</span>
                  <bdi dir="ltr" className="vid-dl-ext">MP4</bdi>
                </button>
                <button type="button" className={s.kind === 'gif' ? 'on' : ''} aria-pressed={s.kind === 'gif'} disabled={busy}
                        onClick={() => choose({ kind: 'gif' })}>
                  <DestGlyph d="loop" size={14} />
                  <span>{t('Web loop')}</span>
                  <bdi dir="ltr" className="vid-dl-ext">GIF</bdi>
                </button>
                <button type="button" className={s.kind === 'png' ? 'on' : ''} aria-pressed={s.kind === 'png'} disabled={busy}
                        onClick={() => choose({ kind: 'png' })}>
                  <Icon name="image" size={14} />
                  <span>{t('Picture')}</span>
                  <bdi dir="ltr" className="vid-dl-ext">PNG</bdi>
                </button>
              </div>
            </div>
          )}

          {s.kind === 'gif' ? (
            <div className="vid-dl-set">
              <span className="vid-group-label">{t('Size')}</span>
              <div className="vid-seg vid-dl-seg mo-ex-sizes" role="group" aria-label={t('Size')}>
                {GIF_SIDES.map((side) => {
                  const dims = gifSizeFor(s.format, side);
                  return (
                    <button type="button" key={side} className={side === s.side ? 'on' : ''} aria-pressed={side === s.side} disabled={busy}
                            onClick={() => choose({ gifSide: side })}>
                      <bdi dir="ltr">{side}</bdi>
                      <bdi dir="ltr" className="mo-ex-px">{dims.width} × {dims.height}</bdi>
                    </button>
                  );
                })}
              </div>
              <small>{t('The longest side, in pixels. A smaller GIF opens sooner in a chat.')}</small>
            </div>
          ) : (
            <div className="vid-dl-set">
              <span className="vid-group-label">{t('Size')}</span>
              <div className="vid-seg vid-dl-seg mo-ex-sizes" role="group" aria-label={t('Size')}>
                {SIZES.map((z) => {
                  const able = s.kind === 'png' || sizeWorks(z);
                  const dims = pixelsFor(s.format, z);
                  return (
                    <button type="button" key={z} className={z === s.size ? 'on' : ''} aria-pressed={z === s.size} disabled={busy || !able}
                            title={able ? undefined : tooLarge} onClick={() => choose({ size: z })}>
                      <span>{sizeName(z)}</span>
                      <bdi dir="ltr" className="mo-ex-px">{dims.width} × {dims.height}</bdi>
                    </button>
                  );
                })}
              </div>
              <small>
                {s.kind === 'mp4' && size !== p.size && `${tooLarge} `}
                {s.size === '720p' ? t('What YouTube asks for in a thumbnail, and plenty for a phone.')
                  : s.size === '4k' ? t('Four times the pixels of Full HD: sharpest on a large screen, and a longer wait.')
                  : t('Full HD: what most platforms show.')}
              </small>
            </div>
          )}

          {s.kind === 'mp4' && (
            <>
              <div className="vid-dl-set">
                <span className="vid-group-label">{t('Quality')}</span>
                <div className="vid-seg vid-dl-seg" role="group" aria-label={t('Quality')}>
                  {QUALITIES.map((q) => (
                    <button type="button" key={q} className={q === s.quality ? 'on' : ''} aria-pressed={q === s.quality}
                            disabled={busy || !works(size, q)} onClick={() => choose({ quality: q })}>
                      {q === 'medium' ? t('Smaller file') : q === 'high' ? t('Balanced') : t('Best quality')}
                    </button>
                  ))}
                </div>
                <small>{t('A higher bitrate keeps words crisp when a platform compresses the video again; the file is larger.')}</small>
              </div>
              <label className="vid-check mo-ex-check">
                <input type="checkbox" checked={s.blur} disabled={busy} onChange={(e) => choose({ blur: e.target.checked })} />
                <span>
                  <b>{t('Motion blur')}</b>
                  <small>{t('Smoother movement, as a camera would see it; saving takes several times as long.')}</small>
                </span>
              </label>
            </>
          )}

          {s.kind === 'gif' && (
            <div className="vid-dl-set">
              <span className="vid-group-label">{t('Frame rate')}</span>
              <div className="vid-seg vid-dl-seg" role="group" aria-label={t('Frame rate')}>
                {GIF_RATES.map((r) => (
                  <button type="button" key={r} className={r === s.fps ? 'on' : ''} aria-pressed={r === s.fps} disabled={busy}
                          onClick={() => choose({ gifFps: r })}>
                    {r}
                  </button>
                ))}
              </div>
              <small>{t('Fewer frames a second make a smaller file; 15 is smooth for most loops.')}</small>
            </div>
          )}

          {s.kind === 'png' && (
            <div className="vid-dl-set">
              <span className="vid-group-label">{t('Frame')}</span>
              <div className="vid-seg vid-dl-seg mo-share-two" role="group" aria-label={t('Frame')}>
                <button type="button" className={s.frame === 'best' ? 'on' : ''} aria-pressed={s.frame === 'best'} disabled={busy}
                        onClick={() => setFrame('best')}>
                  {t('Its best moment')}
                </button>
                <button type="button" className={s.frame === 'playhead' ? 'on' : ''} aria-pressed={s.frame === 'playhead'} disabled={busy}
                        onClick={() => setFrame('playhead')}>
                  {t('At the playhead')}
                </button>
              </div>
              {s.frame === 'playhead' ? <Playhead t={t} doc={out} /> : (
                <p className="mo-ex-frame">
                  <Fill template={t('The moment it reads best: {time}.')}
                        parts={{ time: <bdi dir="ltr">{moment(frameAt(out, s.at ?? 0) / out.fps)}</bdi> }} />
                </p>
              )}
            </div>
          )}

          {s.kind !== 'mp4' && clear && (
            <label className="vid-check mo-ex-check">
              <input type="checkbox" checked={keep} disabled={busy} onChange={(e) => setKeep(e.target.checked)} />
              <span>
                <b>{t('Keep transparency')}</b>
                <i className="mo-ex-alpha" aria-hidden="true" />
                {s.kind === 'gif' && <small>{t('A GIF has no soft edges: each pixel is either shown or not.')}</small>}
              </span>
            </label>
          )}

          <div className="mo-ex-acts">
            <button type="button" className="mo-ex-saveas" onClick={() => void saveAs()} disabled={busy}
                    title={t('Choose the folder and the name')}>
              {t('Save as…')}
            </button>
          </div>
        </div>
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
            <Fill template={t('Saved to {path}')} parts={{ path: <bdi dir="ltr" className="vid-dl-path">{folderOf(outcome.path)}</bdi> }} />
          </p>
          {outcome.note && <p className="mo-ex-where mo-share-note" dir="auto">{outcome.note}</p>}
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
  const f = run.kind !== 'png' && run.done > 0 ? Math.min(1, run.done / Math.max(1, run.total)) : null;
  const left = f !== null && f > 0.03 ? ((Date.now() - run.since) / f) * (1 - f) : 0;
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
        {run.kind === 'mp4' && !run.sound && <span>{fill(t('Frame {n} of {of}'), { n: run.done, of: run.total })}</span>}
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
