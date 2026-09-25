/**
 * Taking a `Video` away: rendering it to a film or a poster, writing its
 * subtitles and its storyboard, and putting each on the person's disk.
 *
 * ## Two steps, two sides
 *
 * The film is rendered **in this page**, by Remotion's web renderer
 * (`renderMediaOnWeb`, and `renderStillOnWeb` for a poster): each frame of the
 * app's own composition is drawn to a canvas and encoded with WebCodecs — H.264
 * in an MP4, or VP9/VP8 in a WebM where this window can encode them. Nothing is
 * uploaded to render it — the pictures are already data: URLs in the video and
 * the fonts are already loaded. The one request the renderer makes of its own
 * is Remotion's licence telemetry: one event per render, film or poster, to
 * remotion.pro, carrying the licence key ("free-license", which it sends as
 * none), the page's origin and whether the render succeeded — never a frame, a
 * word or a title. SAFETY.md says so in its network section.
 *
 * Subtitles (`srtOf`) and the storyboard backup (`storyboardOf`) are text made
 * here from the storyboard's own fields; nothing is rendered for them.
 *
 * The bytes then go to Rust's `export_write_video`, which writes them at the
 * path the OS save panel returned, or — for **Download** — in the Downloads
 * folder, under a name made from the title and never over a file already
 * there (`Title.mp4`, then `Title (2).mp4`…: Rust picks the first free one and
 * says which). That command is absent from the model's tool schema
 * (`test/modes.test.mjs` names it); its inputs come from the human side — the
 * path from the save panel or the Downloads folder, the bytes from what the
 * person started by pressing the button. It refuses any name but `.mp4`,
 * `.webm`, `.png`, `.srt` and `.json`, and bytes that are not what the name
 * says. `open_exported`, for **Open**, only opens a file it wrote.
 *
 * ## Why the bytes travel as a raw IPC body
 *
 * A thirty-second 1080p film is tens of megabytes. `export_write_docx` sends
 * base64 in JSON, which is fine for a few hundred kilobytes and wasteful here:
 * a third larger, then parsed as a string. Tauri v2's `invoke` takes a
 * `Uint8Array` as the whole request body, delivered to Rust as
 * `InvokeBody::Raw(Vec<u8>)` untouched, with anything else carried in request
 * headers — here the destination path, URI-encoded because a header is ASCII
 * and a path can be Arabic or Kurdish.
 */

import { invoke } from '@tauri-apps/api/core';
import { downloadDir, join } from '@tauri-apps/api/path';
import { canRenderMediaOnWeb, renderMediaOnWeb, renderStillOnWeb } from '@remotion/web-renderer';
import type { RenderMediaOnWebProgress, WebRendererQuality, WebRendererVideoCodec } from '@remotion/web-renderer';
import { compositionOf, loadVideoFonts } from './VideoScenes';
import { FORMATS, FPS } from './videotypes';
import type { Format, Scene, Video } from './videotypes';
import { TRANSITION_FRAMES, durationInFrames, isRtl, sceneFrames } from './video';
import { hasSound, soundPlan } from './videomix';

// ── what can be made ──────────────────────────────────────────────────────

/** The two containers a film is saved in. */
export type Container = 'mp4' | 'webm';

/**
 * The film's size, by its short side: 720, 1080 or 2160 pixels. Every shape's
 * composition is 1080 on its short side (`FORMATS`), so each is a scale of it —
 * the renderer draws the same layout at ⅔, 1 or 2 times.
 */
export type Resolution = '720p' | '1080p' | '2160p';
export const RESOLUTIONS: readonly Resolution[] = ['720p', '1080p', '2160p'];

/** How a resolution is called on a button: `4K` for 2160p, as everyone does. */
export function resolutionName(r: Resolution): string {
  return r === '2160p' ? '4K' : r;
}

/** The renderer's scale for a resolution. */
export function scaleOf(r: Resolution): number {
  return r === '720p' ? 720 / 1080 : r === '2160p' ? 2 : 1;
}

/** A shape's pixel size at a resolution — what the saved file will be. */
export function sizeAt(format: Format, r: Resolution): { width: number; height: number } {
  const size = FORMATS[format] ?? FORMATS.landscape;
  const s = scaleOf(r);
  return { width: Math.round(size.width * s), height: Math.round(size.height * s) };
}

/**
 * The encoder's bitrate, as the web renderer names its presets; they scale
 * with the frame size, so one name serves every shape and resolution. Motion
 * graphics are flat colour and sharp text, which a low bitrate smears first:
 * "medium" is still clean at 1080p, "high" is for a file a platform will
 * compress again on upload, "very-high" for an editor that will cut it.
 */
export type Bitrate = 'medium' | 'high' | 'very-high';
export const BITRATES: readonly Bitrate[] = ['medium', 'high', 'very-high'];
const QUALITY: Readonly<Record<Bitrate, WebRendererQuality>> = { medium: 'medium', high: 'high', 'very-high': 'very-high' };

/**
 * The licence this project renders under. Remotion's free licence asks for
 * exactly this string; passing nothing renders the same but logs a warning on
 * every export. Either way the renderer sends its one telemetry event.
 */
const LICENSE_KEY = 'free-license';

/** The codecs tried for each container, best first. */
const CODECS: Readonly<Record<Container, readonly WebRendererVideoCodec[]>> = {
  mp4: ['h264'],
  // VP9 is smaller at the same quality; VP8 is what an older encoder has.
  webm: ['vp9', 'vp8'],
};

/**
 * Whether a video has sound to put in the file: music, or a narration voice
 * that is switched on — `videomix.ts`'s answer, so the file has a sound track
 * exactly when the player has something to play. A voice kept while narration
 * is off is not sound; rendering it would make a silent track.
 */
export function hasAudio(v: Pick<Video, 'scenes' | 'audio'>): boolean {
  return hasSound(v);
}

/**
 * Whether this window has its own encoder for the sound of a container — AAC
 * for MP4, Opus for WebM. Without one the web renderer would fall back to a
 * WebAssembly encoder, which the app's content policy does not let run, and
 * the render would fail at its last step; so the film is made silent instead,
 * and the person is told.
 */
async function nativeAudio(container: Container): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined') return false;
  try {
    const r = await AudioEncoder.isConfigSupported({
      codec: container === 'webm' ? 'opus' : 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000,
    });
    return !!r.supported;
  } catch {
    return false;
  }
}

/**
 * A WebCodecs codec string for a size, close to the one the renderer will ask
 * for — the level is what a frame size needs, and 4K needs a higher one than
 * the renderer's own check assumes (it checks 1280 × 720).
 */
function codecString(codec: WebRendererVideoCodec, width: number, height: number): string {
  if (codec === 'h264') {
    const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
    const level = mbs <= 3600 ? '1f' : mbs <= 8192 ? '28' : mbs <= 22080 ? '32' : mbs <= 36864 ? '33' : '3c';
    return `avc1.6400${level}`;
  }
  if (codec === 'vp9') {
    const px = width * height;
    return `vp09.00.${px <= 2228224 ? '40' : px <= 8912896 ? '50' : '60'}.08`;
  }
  return 'vp8';
}

/** Whether this window's encoder takes a codec at a size bigger than 1080p. */
async function bigEncodes(codec: WebRendererVideoCodec, width: number, height: number): Promise<boolean> {
  if (width * height <= 1920 * 1080) return true;
  if (typeof VideoEncoder === 'undefined') return false;
  try {
    const r = await VideoEncoder.isConfigSupported({
      codec: codecString(codec, width, height), width, height, bitrate: width * height * 4, framerate: FPS,
    });
    return !!r.supported;
  } catch {
    return false;
  }
}

/** What `canEncode` answers: whether, with which codec, and if not, why (the renderer's English). */
export interface CanEncode { ok: boolean; codec?: WebRendererVideoCodec; why?: string }

/**
 * Whether this webview can encode the video in a container at a resolution
 * and bitrate, and with which codec: WebCodecs, an encoder for the codec at
 * that frame size. WebKit gained what the renderer needs in Safari 26, so an
 * older macOS answers no here rather than failing halfway through an export,
 * and a window without a VP8 or VP9 encoder is simply not offered WebM.
 */
export async function canEncode(
  v: Pick<Video, 'format'>,
  o: { container?: Container; resolution?: Resolution; bitrate?: Bitrate; format?: Format } = {},
): Promise<CanEncode> {
  const container = o.container ?? 'mp4';
  const { width, height } = sizeAt(o.format ?? v.format, o.resolution ?? '1080p');
  let why = '';
  for (const codec of CODECS[container]) {
    try {
      const r = await canRenderMediaOnWeb({
        container, videoCodec: codec, width, height, muted: true, videoBitrate: QUALITY[o.bitrate ?? 'high'],
      });
      if (r.canRender && await bigEncodes(codec, width, height)) return { ok: true, codec };
      const errors = r.issues.filter((i) => i.severity === 'error');
      why = (errors.length ? errors : r.issues).map((i) => i.message).join(' ')
        || `This window cannot encode ${codec.toUpperCase()} video at ${width} × ${height}.`;
    } catch (e) {
      why = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, why: why || 'This window cannot encode video.' };
}

/** `canEncode` for an MP4 at 1080p — the question the panel asks first. */
export async function canExport(v: Video): Promise<{ ok: boolean; why?: string }> {
  const r = await canEncode(v, { container: 'mp4', resolution: '1080p', bitrate: 'high' });
  return r.ok ? { ok: true } : { ok: false, why: r.why };
}

// ── rendering ─────────────────────────────────────────────────────────────

function abortError(): Error {
  // What `fetch` throws on abort, so callers can test `name === 'AbortError'`
  // for every cancellation in the app the same way.
  return typeof DOMException === 'function'
    ? new DOMException('The export was cancelled.', 'AbortError')
    : Object.assign(new Error('The export was cancelled.'), { name: 'AbortError' });
}

/** An encoder's complaint about sound, as opposed to a frame that would not draw. */
const AUDIO_TROUBLE = /audio|aac|opus|sample|encod|codec/i;

export interface RenderOptions {
  signal?: AbortSignal;
  /** The overall fraction (0..1, rendering and encoding weighted together) and, once a few frames are timed, the milliseconds left. */
  onProgress?: (fraction: number, etaMs?: number) => void;
  /** `mp4` unless said. */
  container?: Container;
  /** The codec `canEncode` chose; the container's first when not given. */
  codec?: WebRendererVideoCodec;
  /** `1080p` unless said. */
  resolution?: Resolution;
  /** `high` unless said. */
  bitrate?: Bitrate;
  /** Leave the sound out. Unless said, a video is silent only when it has no sound (`hasAudio`). */
  muted?: boolean;
  /** Render the video in another shape than its own — for "all three shapes". */
  format?: Format;
}

/**
 * Why a video that has sound was saved without it: this window has no encoder
 * for its container's audio codec (`unsupported`), or the encoder failed and
 * the film was rendered again without sound (`failed`). A note for the person,
 * not an error: the film itself is fine.
 */
export type Silence = 'unsupported' | 'failed';

export interface Rendered { bytes: Uint8Array; silence?: Silence }

/**
 * Render the whole film.
 *
 * Fonts are loaded first: a frame drawn before its font has arrived is drawn
 * in a fallback, and a video cannot be re-flowed afterwards. Aborting `signal`
 * stops between frames and rejects with an `AbortError`.
 *
 * Sound: a video with music or a narration voice is rendered with it, unless
 * `muted` — the audio layer in the composition hands the renderer its mix,
 * frame by frame (videoaudio.tsx). When the window has no encoder of its own
 * for the container's audio codec (AAC for MP4, Opus for WebM) the film is
 * rendered silent from the start; when the render with sound fails on an
 * encoder error, it is rendered once more, silent. Either way `silence` says
 * so, for the panel to tell the person.
 */
export async function renderVideo(v: Video, o: RenderOptions = {}): Promise<Rendered> {
  const { signal } = o;
  if (signal?.aborted) throw abortError();
  await loadVideoFonts(v);
  if (signal?.aborted) throw abortError();

  const container = o.container ?? 'mp4';
  const codec = o.codec ?? CODECS[container][0];
  const resolution = o.resolution ?? '1080p';
  const bitrate = o.bitrate ?? 'high';
  const film: Video = o.format && o.format !== v.format ? { ...v, format: o.format } : v;
  let muted = o.muted ?? !hasAudio(v);
  let silence: Silence | undefined;

  if (!muted && !(await nativeAudio(container))) {
    muted = true;
    silence = 'unsupported';
  }

  const once = (silent: boolean) => renderOnce(film, { ...o, container, codec, resolution, bitrate }, silent);
  let bytes: Uint8Array;
  try {
    bytes = await once(muted);
  } catch (e) {
    if (signal?.aborted || (e as { name?: string })?.name === 'AbortError') throw abortError();
    const message = e instanceof Error ? e.message : String(e);
    if (muted || !AUDIO_TROUBLE.test(message)) throw e;
    bytes = await once(true);
    silence = 'failed';
  }
  return { bytes, silence };
}

async function renderOnce(
  v: Video,
  o: RenderOptions & { container: Container; codec: WebRendererVideoCodec; resolution: Resolution; bitrate: Bitrate },
  muted: boolean,
): Promise<Uint8Array> {
  const { signal, onProgress } = o;
  const c = compositionOf(v);
  onProgress?.(0);
  let result;
  try {
    result = await renderMediaOnWeb({
      composition: {
        id: c.id,
        component: c.component,
        durationInFrames: c.durationInFrames,
        fps: c.fps,
        width: c.width,
        height: c.height,
        // Required by the type when the component has props; the render uses
        // `inputProps` below, which are the same video.
        defaultProps: c.inputProps,
      },
      inputProps: c.inputProps,
      container: o.container,
      videoCodec: o.codec,
      videoBitrate: QUALITY[o.bitrate] ?? QUALITY.high,
      scale: scaleOf(o.resolution),
      muted,
      signal: signal ?? null,
      licenseKey: LICENSE_KEY,
      // Frees the event loop between frames so the panel's progress bar and
      // Cancel button stay live; the default, named so it is a choice.
      pageResponsiveness: 'medium',
      // Pictures are data: URLs and fonts are loaded above, so a frame that
      // is still not ready after a minute is a bug, not a slow network.
      delayRenderTimeoutInMilliseconds: 60_000,
      onProgress: onProgress
        ? (p: RenderMediaOnWebProgress) => {
          const fraction = Math.min(1, Math.max(0, Number.isFinite(p.progress) ? p.progress : 0));
          const eta = p.renderEstimatedTime > 0 && Number.isFinite(p.renderEstimatedTime) ? p.renderEstimatedTime : undefined;
          onProgress(fraction, eta);
        }
        : null,
    });
  } catch (e) {
    if (signal?.aborted) throw abortError();
    throw e;
  }
  if (signal?.aborted) throw abortError();
  const blob = await result.getBlob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  onProgress?.(1, 0);
  return bytes;
}

/** Where each scene starts in the film, in frames, allowing for the overlap of transitions — VideoScenes' own sum. */
export function sceneStarts(scenes: readonly Scene[]): number[] {
  const out: number[] = [];
  let at = 0;
  scenes.forEach((s, i) => {
    out.push(at);
    at += sceneFrames(s);
    if (i < scenes.length - 1 && s.transition !== 'none') at -= TRANSITION_FRAMES;
  });
  return out;
}

/**
 * The frame a poster shows: the middle of a scene — of the title scene unless
 * another is chosen, of the first scene when there is no title — which is
 * where its words have arrived and nothing has begun to leave.
 */
export function posterFrame(v: Pick<Video, 'scenes'>, sceneIndex?: number): number {
  const scenes = v?.scenes ?? [];
  if (!scenes.length) return 0;
  const title = scenes.findIndex((s) => s.kind === 'title');
  const i = sceneIndex !== undefined && sceneIndex >= 0 && sceneIndex < scenes.length ? sceneIndex : Math.max(0, title);
  const frame = sceneStarts(scenes)[i] + Math.floor(sceneFrames(scenes[i]) / 2);
  return Math.min(Math.max(0, frame), durationInFrames(v) - 1);
}

/**
 * One frame of the film as a PNG — a poster, or a thumbnail for YouTube, which
 * asks for 1280 × 720 (720p here). The frame is `posterFrame`'s unless given.
 */
export async function renderPoster(
  v: Video,
  o: { frame?: number; resolution?: Resolution; signal?: AbortSignal; format?: Format } = {},
): Promise<Uint8Array> {
  const { signal } = o;
  if (signal?.aborted) throw abortError();
  await loadVideoFonts(v);
  if (signal?.aborted) throw abortError();
  const film: Video = o.format && o.format !== v.format ? { ...v, format: o.format } : v;
  const c = compositionOf(film);
  const frame = Math.min(Math.max(0, Math.round(o.frame ?? posterFrame(film))), c.durationInFrames - 1);
  let still;
  try {
    still = await renderStillOnWeb({
      composition: {
        id: c.id,
        component: c.component,
        durationInFrames: c.durationInFrames,
        fps: c.fps,
        width: c.width,
        height: c.height,
        defaultProps: c.inputProps,
      },
      inputProps: c.inputProps,
      frame,
      scale: scaleOf(o.resolution ?? '1080p'),
      signal: signal ?? null,
      licenseKey: LICENSE_KEY,
      delayRenderTimeoutInMilliseconds: 60_000,
    });
  } catch (e) {
    if (signal?.aborted) throw abortError();
    throw e;
  }
  if (signal?.aborted) throw abortError();
  const blob = await still.blob({ format: 'png' });
  return new Uint8Array(await blob.arrayBuffer());
}

// ── subtitles and the storyboard ──────────────────────────────────────────

/** The longest subtitle line, and two of them to a cue: the usual broadcast rule. */
const LINE = 42;
const CUE = LINE * 2;

const str = (x: unknown): string => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : typeof x === 'number' && Number.isFinite(x) ? String(x) : '');
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const joined = (...parts: unknown[]) => parts.map(str).filter(Boolean).join(' ');

/**
 * What a scene shows in words, a phrase at a time: the heading, then each
 * point, step, bar, event or person. A kind this file does not know yet gives
 * whatever words it has under the usual names, rather than nothing.
 */
export function wordsOf(s: Scene, v: Pick<Video, 'brand'>): string[] {
  const x = s as unknown as Record<string, unknown>;
  let out: unknown[];
  switch (s.kind) {
    case 'title': out = [s.title, s.subtitle]; break;
    case 'kinetic': out = [s.text]; break;
    case 'bullets': out = [s.heading, ...list(s.points)]; break;
    case 'stat': {
      const n = typeof s.value === 'number' && Number.isFinite(s.value) ? s.value.toLocaleString('en-US') : str(s.value);
      out = [joined(`${str(s.prefix)}${n}${str(s.suffix)}`, s.label)];
      break;
    }
    case 'chart': out = [s.heading, ...list(s.bars).map((b) => {
      const bar = (b ?? {}) as { label?: unknown; value?: unknown };
      return joined(`${str(bar.label)}:`, bar.value, s.unit);
    })]; break;
    case 'quote': out = [s.quote, str(s.author) && `— ${str(s.author)}`]; break;
    case 'image': out = [s.caption]; break;
    case 'split': out = [s.heading, s.text]; break;
    case 'steps': out = [s.heading, ...list(s.steps).map((step, i) => str(step) && `${i + 1}. ${str(step)}`)]; break;
    case 'outro': out = [s.headline, s.cta, s.url]; break;
    case 'gallery': out = [s.heading]; break;
    case 'timeline': out = [s.heading, ...list(s.events).map((e) => {
      const ev = (e ?? {}) as { when?: unknown; text?: unknown };
      return str(ev.when) ? joined(`${str(ev.when)}:`, ev.text) : str(ev.text);
    })]; break;
    case 'compare': out = [s.heading, ...[s.left, s.right].map((side) => {
      const sd = (side ?? {}) as { title?: unknown; points?: unknown };
      const points = list(sd.points).map(str).filter(Boolean).join(' · ');
      return str(sd.title) && points ? `${str(sd.title)} — ${points}` : str(sd.title) || points;
    })]; break;
    case 'people': out = [s.heading, ...list(s.people).map((p) => {
      const person = (p ?? {}) as { name?: unknown; role?: unknown };
      return str(person.role) ? `${str(person.name)} — ${str(person.role)}` : str(person.name);
    })]; break;
    case 'logo': out = [v?.brand?.name, s.tagline]; break;
    case 'qr': out = [s.heading, s.url]; break;
    default: out = ['title', 'heading', 'headline', 'text', 'caption', 'subtitle', 'tagline'].map((k) => x[k]);
  }
  return out.map(str).filter(Boolean);
}

/** A narration, a sentence at a time. */
function sentences(text: string): string[] {
  return str(text).split(/(?<=[.!?؟۔…])\s+/u).map((s) => s.trim()).filter(Boolean);
}

/**
 * Phrases laid out as cues of at most two lines. A phrase longer than a cue
 * holds is cut between words; a short one shares a cue with the next short one,
 * each on its own line — a heading over its first point, a title over its
 * subtitle, two short sentences — so no line is two phrases run together.
 */
function cuesOf(phrases: string[]): string[][] {
  const pieces: string[] = [];
  for (const phrase of phrases) {
    let cur = '';
    for (const word of phrase.split(' ')) {
      if (cur && cur.length + 1 + word.length > CUE) {
        pieces.push(cur);
        cur = word;
      } else {
        cur = cur ? `${cur} ${word}` : word;
      }
    }
    if (cur) pieces.push(cur);
  }
  const out: string[][] = [];
  let pair: string[] = [];
  for (const piece of pieces) {
    if (piece.length <= LINE) {
      pair.push(piece);
      if (pair.length === 2) {
        out.push(pair);
        pair = [];
      }
    } else {
      if (pair.length) out.push(pair);
      pair = [];
      out.push(lines(piece));
    }
  }
  if (pair.length) out.push(pair);
  return out;
}

/** A piece longer than a line, on two, broken at the space nearest its middle. */
function lines(cue: string): string[] {
  if (cue.length <= LINE) return [cue];
  const mid = cue.length / 2;
  let best = -1;
  for (let i = cue.indexOf(' '); i !== -1; i = cue.indexOf(' ', i + 1)) {
    if (best === -1 || Math.abs(i - mid) < Math.abs(best - mid)) best = i;
  }
  return best === -1 ? [cue] : [cue.slice(0, best), cue.slice(best + 1)];
}

/** `00:01:02,500` for a frame. */
function stamp(frame: number): string {
  const ms = Math.max(0, Math.round((frame * 1000) / FPS));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

/**
 * The video's subtitles, as SubRip (.srt): each scene's narration when it has
 * one (and narration has not been switched off), else the words it shows. A
 * scene's words are on screen from the frame it starts — transitions overlap,
 * so that is `TRANSITION_FRAMES` before the one before it has gone — until the
 * next scene starts, and the last until the film ends. A line the voice speaks
 * is timed as `videomix.ts` places it instead — from where the voice starts,
 * for as long as it speaks — and says what the voice says. A scene with more to
 * say than one cue holds is cut into several, each timed by its share of the
 * letters.
 *
 * CRLF line ends and a byte-order mark, which every player reads and some
 * older ones need to tell UTF-8 from a local code page; in a right-to-left
 * language each line opens with a right-to-left mark, so a line that starts
 * with a number or a Latin name still runs the way the language does. Empty
 * when no scene has any words.
 */
export function srtOf(v: Video): string {
  const scenes = v?.scenes ?? [];
  const starts = sceneStarts(scenes);
  const total = durationInFrames(v);
  const mark = isRtl(v.lang) ? '\u200F' : '';
  const narrated = v.audio?.narrate !== false;
  let spoken = new Map<number, { text: string; start: number; end: number; seconds: number }>();
  try {
    spoken = new Map(soundPlan(v).lines.filter((l) => l.src && str(l.text)).map((l) => [l.index, l]));
  } catch {
    // No plan, no voice: every scene is timed by its own window.
  }
  const out: string[] = [];
  scenes.forEach((s, i) => {
    const voice = spoken.get(i);
    const narration = voice ? str(voice.text) : narrated ? str(s.narration) : '';
    const cues = cuesOf(narration ? sentences(narration) : wordsOf(s, v));
    const from = voice ? voice.start : starts[i];
    const to = voice ? Math.min(voice.end, voice.start + Math.ceil(voice.seconds * FPS)) : i < scenes.length - 1 ? starts[i + 1] : total;
    if (!cues.length || to <= from) return;
    const size = (cue: string[]) => cue.reduce((n, l) => n + l.length, 0);
    const letters = cues.reduce((n, c) => n + size(c), 0);
    let at = from;
    let seen = 0;
    cues.forEach((cue, k) => {
      seen += size(cue);
      const end = k === cues.length - 1 ? to : Math.max(at + 1, Math.round(from + ((to - from) * seen) / letters));
      out.push(`${out.length + 1}\r\n${stamp(at)} --> ${stamp(end)}\r\n${cue.map((l) => mark + l).join('\r\n')}\r\n`);
      at = end;
    });
  });
  return out.length ? `\uFEFF${out.join('\r\n')}` : '';
}

/** Whether a video has any words to put in subtitles. */
export function hasWords(v: Video): boolean {
  return (v?.scenes ?? []).some((s) => str(s.narration) || wordsOf(s, v).length > 0);
}

/** A copy of a value with every data: URL left out — pictures, the logo, the sound. */
function withoutData(x: unknown): unknown {
  if (typeof x === 'string') return /^data:/i.test(x) ? undefined : x;
  if (Array.isArray(x)) return x.map(withoutData).filter((y) => y !== undefined);
  if (x && typeof x === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(x)) {
      const y = withoutData(val);
      if (y !== undefined) o[k] = y;
    }
    return o;
  }
  return x;
}

/**
 * The storyboard as JSON, for a backup: every word, timing, colour and choice
 * in the video, and each picture's credit, source and search words — but not
 * the pictures, the logo or the sound themselves, which are data: URLs that
 * would make a few kilobytes of words into megabytes. The pictures can be found
 * again from what is kept.
 */
export function storyboardOf(v: Video, now = Date.now()): string {
  return `${JSON.stringify({
    app: 'Vylo Editor',
    kind: 'video storyboard',
    version: 1,
    saved: new Date(now).toISOString(),
    note: 'Pictures, the logo and the sound are left out; each picture keeps its credit, source and search words.',
    video: withoutData(v),
  }, null, 2)}\n`;
}

// ── names and places ──────────────────────────────────────────────────────

/** Names Windows keeps for devices, which no file may have. */
const DEVICE = /^(?:con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * A name for a saved file, from the title: `researchdocx.ts`'s `fileNameFor`
 * rule. Its letters in whatever script they are in — Arabic, Sorani's ڕ ڵ ێ ۆ
 * ە, Badini's ڤ — its digits, spaces, `-`, `_` and the zero-width non-joiner
 * Persian-script words need, and nothing a file system could read as a path or
 * refuse: no `/ \ : * ? " < > |`, no control characters, no other punctuation.
 * `tag` follows the title — `16x9` for one of the three shapes. At most eighty
 * characters with the extension, cut where a word ends. `video.mp4` when the
 * title leaves nothing.
 *
 * Only a wish: when the name is taken in the Downloads folder, Rust saves at
 * `Title (2).mp4`, `Title (3).mp4`… and says which.
 */
export function fileNameFor(v: Pick<Video, 'title'>, ext: string, tag = ''): string {
  const title = (typeof v?.title === 'string' ? v.title : '').normalize('NFC');
  const kept = title.replace(/[^\p{L}\p{M}\p{N}\u200C _-]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const end = `${tag ? ` ${tag}` : ''}.${ext}`;
  const max = 80 - end.length;
  const chars = Array.from(kept);
  let base = kept;
  if (chars.length > max) {
    const head = chars.slice(0, max + 1).join('');
    const at = head.lastIndexOf(' ');
    base = (at > 0 ? head.slice(0, at) : chars.slice(0, max).join('')).trim();
  }
  if (!base) base = 'video';
  return `${DEVICE.test(base) ? `${base}_` : base}${end}`;
}

/** What each shape is called in a file name. */
export const SHAPE_TAG: Readonly<Record<Format, string>> = { landscape: '16x9', portrait: '9x16', square: '1x1' };

/** The Downloads folder joined to a name — where **Download** saves. */
export async function downloadsPath(name: string): Promise<string> {
  return join(await downloadDir(), name);
}

/** Text as the UTF-8 bytes the writer takes. */
export function textBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * Write a file the panel made at `path` and return where it landed.
 *
 * `path` is what the save panel returned, and a file already there is
 * replaced — the panel asked. With `unique` it is a wish in the Downloads
 * folder, and nothing there is ever replaced: Rust writes the first free name
 * of `Title.mp4`, `Title (2).mp4`… and returns it. Rust refuses anything that
 * is not an absolute `.mp4`, `.webm`, `.png`, `.srt` or `.json` path in an
 * existing folder, bytes that are not what the name says, or too many of them;
 * the refusal comes back as the rejection's message.
 */
export async function writeVideoFile(path: string, bytes: Uint8Array, o: { unique?: boolean } = {}): Promise<string> {
  const headers: Record<string, string> = { 'x-path': encodeURIComponent(path) };
  if (o.unique) headers['x-unique'] = '1';
  const written = await invoke<string>('export_write_video', bytes, { headers });
  return typeof written === 'string' && written ? written : path;
}

/** Open a file `writeVideoFile` wrote, in the app the system plays or shows it with. Rust refuses any other. */
export async function openExported(path: string): Promise<void> {
  await invoke('open_exported', { path });
}
