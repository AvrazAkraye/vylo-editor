/**
 * Frames to an MP4 with the webview's own H.264 encoder. The caller draws each
 * frame into a canvas; it becomes a `VideoFrame`, WebCodecs' `VideoEncoder`
 * turns it into an H.264 sample, and `motionmp4.ts` puts the samples in a
 * file. No library, and no media element: this webview once deadlocked
 * playing sound through one, so only a canvas and WebCodecs are touched here.
 *
 * ## Which H.264
 *
 * `avcCodecFor` names H.264 at the lowest level whose limits (the standard's
 * Table A-1: macroblocks per frame, per second, and bits per second) cover
 * the frame, in High, then Main, then Baseline. An encoder asked for a level
 * too low for the frame refuses the configuration (Chrome checks all three
 * limits), and one far above it makes a file some decoders refuse, so the
 * level is computed rather than fixed. `canEncode` offers each to
 * `isConfigSupported`, hardware first.
 *
 * ## The loop
 *
 * For each frame: draw, wrap the canvas in a `VideoFrame`, encode, close the
 * frame. Drawing waits while the encoder holds more than a few frames, so
 * memory stays flat however long the graphic is, and the loop yields to the
 * event loop every few frames, and at least every 50 ms however slow a frame
 * is, so the window repaints its progress and answers a click on Cancel.
 * Neither wait uses a timer: WebKit stretches timers to a second in a window
 * that is hidden or covered, which is where a window sits while someone
 * waits for a long export (see `tick`).
 *
 * The samples come back in decode order with presentation timestamps, which
 * is exactly what the writer takes. An engine that ignores the `avc` format
 * request sends Annex B instead (no `description` with the first sample);
 * that stream is kept whole and converted at the end.
 *
 * ## Frames that cannot have changed
 *
 * `unchanged(i)` says frame `i` would paint exactly what frame `i - 1`
 * painted (`motionexportops.ts` works that out from the document). Then
 * `draw` is not called: the canvas still holds the previous frame, untouched,
 * and it is wrapped and encoded again with frame `i`'s own time. The file
 * keeps one sample per frame at a steady rate, its key frames where they
 * were, and the pixels are the ones a repaint would have made, because they
 * are the same pixels; only the painting — most of an export's time, eight
 * paints a frame with motion blur — is saved.
 *
 * ## Sound
 *
 * With `audio`, the bed is fitted to the film's length (`fitBed`: cut, or
 * made up with silence, to `frames / fps` seconds) and encoded to AAC
 * (`motionaudioenc.ts`) before the first frame is drawn, then written as the
 * file's second track. Sound is never the reason an export fails: when this
 * window has no AAC encoder, or encoding fails, the film is made without it
 * and the result says `audio: 'dropped'` so the panel can say so. Cancel
 * during the sound is Cancel. The result is the file's bytes, as before,
 * carrying `audio` (`'kept'`, `'dropped'`, or `'none'` when none was given)
 * and `painted` (the frames actually drawn) beside them.
 *
 * Both engines were checked for real (Chrome 154, and macOS 26.2's WKWebView,
 * the app's own): each hands back an avcC with its first sample, no
 * parameter sets inside the samples, timestamps in order (no B-frames), and
 * BT.709 limited-range pixels — which is what `motionmp4.ts`'s `colr` box
 * says, and not what WebKit's `decoderConfig.colorSpace` claims (full range).
 *
 * ## Errors
 *
 * Codes, which the panel turns into sentences: `motion:no-encoder` (this
 * window has no H.264 encoder for the size), `motion:encode-failed: <the
 * engine's words>`, `motion:too-large` (past 4 GiB, from the writer). Cancel
 * rejects with a `DOMException` named `AbortError`, as `fetch` does, so every
 * cancellation in the app is told apart the same way. On every way out the
 * encoder and any open frame are closed: a leaked encoder can hold a hardware
 * session until the page reloads.
 */

import { Mp4Writer, annexBToAvcc } from './motionmp4';
import type { Mp4Sample } from './motionmp4';
import { encodeAac, fitBed } from './motionaudioenc';
import type { AacTrack } from './motionaudioenc';
import type { SoundBed } from './motionsound';

// ── choosing the encoder ──────────────────────────────────────────────────

/** How many bits a frame may spend; see `bitrateFor`. */
export type EncodeQuality = 'medium' | 'high' | 'very-high';

/** The codec string a window can encode, and whether its encoder is hardware (faster, and what the progress bar should expect). */
export interface EncodeSupport {
  codec: string;
  hardware: boolean;
}

/**
 * H.264 levels (Table A-1) from the one 720p30 needs to the highest any
 * browser encoder takes: the largest frame and macroblock rate each allows,
 * and its bitrate ceiling in kbit/s for Baseline and Main (High may use 1.25
 * times as much).
 */
const LEVELS: readonly { id: number; fs: number; mbps: number; br: number }[] = [
  { id: 31, fs: 3600, mbps: 108000, br: 14000 },
  { id: 32, fs: 5120, mbps: 216000, br: 20000 },
  { id: 40, fs: 8192, mbps: 245760, br: 20000 },
  { id: 41, fs: 8192, mbps: 245760, br: 50000 },
  { id: 42, fs: 8704, mbps: 522240, br: 50000 },
  { id: 50, fs: 22080, mbps: 589824, br: 135000 },
  { id: 51, fs: 36864, mbps: 983040, br: 240000 },
  { id: 52, fs: 36864, mbps: 2073600, br: 240000 },
];

/** High, Main and Constrained Baseline, as the codec string's profile and constraint bytes, with each one's bitrate allowance. */
const PROFILES: readonly { id: string; bitrate: number }[] = [
  { id: '6400', bitrate: 1.25 },
  { id: '4d00', bitrate: 1 },
  { id: '42e0', bitrate: 1 },
];

/**
 * Codec strings to try, best first: High, Main, then Baseline, each at the
 * lowest level that covers the frame size and rate (and `bitrate`, when
 * given, since Chrome refuses a configuration whose bitrate is over its
 * level's ceiling). A frame past every level gets level 5.2, and the encoder
 * decides.
 */
export function avcCodecFor(width: number, height: number, fps: number, bitrate = 0): string[] {
  const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : 1);
  const across = Math.ceil(pos(width) / 16);
  const down = Math.ceil(pos(height) / 16);
  const frame = across * down;
  const perSecond = frame * pos(fps);
  return PROFILES.map((p) => {
    const level = LEVELS.find((l) => frame <= l.fs && perSecond <= l.mbps
      && Math.max(across, down) <= Math.sqrt(8 * l.fs) && bitrate <= l.br * 1000 * p.bitrate) ?? LEVELS[LEVELS.length - 1];
    return `avc1.${p.id}${level.id.toString(16).padStart(2, '0')}`;
  });
}

/**
 * The size an encoder can take: H.264's 4:2:0 colour has one sample per two
 * pixels each way, so both sides must be even. Rounded down, never up: the
 * frame is cropped by a pixel rather than asked for a pixel nobody drew.
 */
export function evenSize(width: number, height: number): { width: number; height: number } {
  const even = (n: number) => Math.max(2, 2 * Math.floor((Number.isFinite(n) ? n : 0) / 2));
  return { width: even(width), height: even(height) };
}

/**
 * Bits per pixel per frame. Motion graphics are flat colour, hard edges and
 * small text, which an encoder smears long before it would soften film, so
 * these are well above what a camera clip of the same size needs: "medium" is
 * clean at 1080p, "high" survives a platform compressing it again, and
 * "very-high" is for an editor that will cut it.
 */
const BITS_PER_PIXEL: Readonly<Record<EncodeQuality, number>> = { medium: 0.12, high: 0.2, 'very-high': 0.35 };
const MIN_BITRATE = 2_000_000;
const MAX_BITRATE = 80_000_000;

/**
 * The bitrate for a frame size, rate and quality, in bits per second, kept
 * between 2 Mbit/s (below which even a small frame of text blocks up) and
 * 80 Mbit/s (above which files grow and no one sees a difference).
 */
export function bitrateFor(width: number, height: number, fps: number, quality: EncodeQuality): number {
  const bpp = BITS_PER_PIXEL[quality] ?? BITS_PER_PIXEL.high;
  const bits = width * height * fps * bpp;
  if (!Number.isFinite(bits) || bits <= 0) return MIN_BITRATE;
  return Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, bits)));
}

/** A configuration an engine said yes to, and what it means for the panel. */
interface Choice {
  support: EncodeSupport;
  config: VideoEncoderConfig;
}

/**
 * The first configuration this window's encoder accepts: hardware before
 * software, High before Main before Baseline, and for each the full request
 * before plainer ones, because an engine may refuse a field it does not know
 * (the `avc` format, a latency or bitrate mode) rather than ignore it.
 */
async function choose(width: number, height: number, fps: number, bitrate: number): Promise<Choice | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoEncoder.isConfigSupported !== 'function') return null;
  for (const hardwareAcceleration of ['prefer-hardware', 'no-preference'] as const) {
    for (const codec of avcCodecFor(width, height, fps, bitrate)) {
      const plain: VideoEncoderConfig = { codec, width, height, bitrate, framerate: fps, hardwareAcceleration };
      const tuned: VideoEncoderConfig = { ...plain, latencyMode: 'quality', bitrateMode: 'variable' };
      for (const config of [{ ...tuned, avc: { format: 'avc' as const } }, tuned, plain]) {
        try {
          const r = await VideoEncoder.isConfigSupported(config);
          if (r.supported) return { support: { codec, hardware: hardwareAcceleration === 'prefer-hardware' }, config };
        } catch {
          // A field this engine refuses: the next, plainer request.
        }
      }
    }
  }
  return null;
}

/**
 * Whether this window can encode H.264 at a size and rate, and with what;
 * null when it has no `VideoEncoder` or no configuration works. Asks at the
 * size `encodeMp4` will use (`evenSize`) and the bitrate of `quality`.
 */
export async function canEncode(width: number, height: number, fps: number, quality: EncodeQuality = 'high'): Promise<EncodeSupport | null> {
  const size = evenSize(width, height);
  const c = await choose(size.width, size.height, fps, bitrateFor(size.width, size.height, fps, quality));
  return c ? c.support : null;
}

// ── encoding ──────────────────────────────────────────────────────────────

/**
 * An export. `draw(frame)` paints frame `frame` into `canvas`, which must be
 * `width` x `height` (or larger: an odd size is rounded down to even and the
 * frame cropped, never scaled). `unchanged(frame)`, when given, is asked
 * before every frame but the first; true means the frame is the one before
 * it again, and `draw` is not called for it. `onProgress` hears after each
 * frame is handed to the encoder, `onSound` as the sound is encoded (samples
 * done of samples, before any frame); aborting `signal` cancels either.
 */
export interface EncodeOptions {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
  fps: number;
  frames: number;
  quality?: EncodeQuality;
  draw: (frame: number) => void | Promise<void>;
  unchanged?: (frame: number) => boolean;
  /** The film's sound, if it has any: planar PCM, fitted to the film's length here. */
  audio?: SoundBed;
  onProgress?: (done: number, total: number) => void;
  onSound?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/** What became of the sound: in the file, left out because it could not be encoded, or never given. */
export type AudioOutcome = 'kept' | 'dropped' | 'none';

/** What an export reports beside its bytes. */
export interface EncodeReport {
  audio: AudioOutcome;
  /** Frames `draw` was called for; the rest were the frame before them again. */
  painted: number;
  /** Frames in the film. */
  frames: number;
}

/**
 * An MP4's bytes, with the report on them as read-only properties that are
 * not enumerated: everything that took a `Uint8Array` — Rust's write, a
 * test's byte comparison — takes this unchanged, and a caller that wants to
 * know reads `bytes.audio`.
 */
export type Mp4Bytes = Uint8Array & Readonly<EncodeReport>;

/** `bytes` with `report` on it (see `Mp4Bytes`); the same object, so its identity is kept. */
export function withReport(bytes: Uint8Array, report: EncodeReport): Mp4Bytes {
  for (const [key, value] of Object.entries(report)) {
    Object.defineProperty(bytes, key, { value, enumerable: false, writable: false, configurable: true });
  }
  return bytes as Mp4Bytes;
}

/** Frames the encoder may hold before drawing waits: enough to keep a hardware encoder busy, few enough that memory stays flat. */
const MAX_QUEUE = 6;
/** Frames between yields to the event loop, so the window repaints and answers clicks during a long export. */
const YIELD_EVERY = 8;
/**
 * And never longer than this without one, however slow a frame is to draw:
 * a 4K frame with motion blur is eight paints, about 130 ms in WebKit, and
 * eight of them held the window — its progress bar and Cancel — for a second.
 */
const YIELD_MS = 50;

const clock = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

/**
 * The sound of a film `seconds` long as AAC, or null when it cannot be made
 * (a bed with nothing usable in it, no AAC encoder, the encoder failing):
 * then the film is made without it. Cancel is the one failure passed on.
 */
async function encodeSound(
  bed: SoundBed, seconds: number, signal: AbortSignal | undefined, onSound: EncodeOptions['onSound'],
): Promise<AacTrack | null> {
  const fitted = fitBed(bed, seconds);
  if (!fitted) return null;
  try {
    return await encodeAac(fitted, { signal, onProgress: onSound });
  } catch (e) {
    if (signal?.aborted || (e as { name?: unknown })?.name === 'AbortError') throw aborted();
    return null;
  }
}

/**
 * The file, with the sound in it when there is sound and the writer takes
 * it. A track `motionaudioenc.ts` made is one the writer takes (both read
 * the config the same way), so `kept` is false only for a config that
 * reading somehow let through; a sample the writer refuses past that is a
 * real failure (`motion:too-large`) and is thrown.
 */
function finishFile(w: Mp4Writer, track: AacTrack | null): { bytes: Uint8Array; kept: boolean } {
  let kept = false;
  if (track) {
    try {
      w.addAudioTrack(track);
      kept = true;
    } catch {
      kept = false;
    }
    if (kept) for (const f of track.frames) w.addAudioSample(f);
  }
  return { bytes: w.finish(), kept };
}

/**
 * The frames `draw` paints, as an MP4's bytes, with the report on them
 * (`Mp4Bytes`). Rejects with the codes above, or with whatever `draw` or
 * `unchanged` throws; either way nothing is left open.
 */
export async function encodeMp4(o: EncodeOptions): Promise<Mp4Bytes> {
  const { canvas, fps, signal } = o;
  if (signal?.aborted) throw aborted();
  const frames = Math.floor(o.frames);
  if (!(fps > 0) || !Number.isFinite(fps)) throw new RangeError(`encodeMp4: bad frame rate ${fps}`);
  if (!(frames >= 1)) throw new RangeError(`encodeMp4: bad frame count ${o.frames}`);
  const { width, height } = evenSize(o.width, o.height);
  if (canvas.width < width || canvas.height < height) {
    throw new RangeError(`encodeMp4: the canvas is ${canvas.width}x${canvas.height}, smaller than ${width}x${height}`);
  }
  const choice = await choose(width, height, fps, bitrateFor(width, height, fps, o.quality ?? 'high'));
  if (!choice) throw new Error('motion:no-encoder');
  if (signal?.aborted) throw aborted();

  // The sound before the pictures: it takes a fraction of their time, and
  // the file needs all of it at the end either way.
  const sound = o.audio ? await encodeSound(o.audio, frames / fps, signal, o.onSound) : null;
  if (signal?.aborted) throw aborted();

  const step = Math.round(1e6 / fps);
  const keyEvery = Math.max(1, Math.round(2 * fps));
  const crop = canvas.width !== width || canvas.height !== height ? { x: 0, y: 0, width, height } : null;

  // The first failure wins: from the encoder, the writer, or Cancel. Every
  // wait below races it, so a failure ends the export at once.
  let failure = null as unknown;
  let stop: (e: unknown) => void = () => undefined;
  const stopped = new Promise<never>((_, reject) => { stop = reject; });
  stopped.catch(() => undefined);
  const fail = (e: unknown) => {
    if (failure !== null) return;
    failure = e;
    stop(e);
  };
  const onAbort = () => fail(aborted());
  signal?.addEventListener('abort', onAbort);

  let writer = null as Mp4Writer | null;
  let annexB = null as Mp4Sample[] | null;
  let encoder = null as VideoEncoder | null;
  let frame = null as VideoFrame | null;
  try {
    encoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (failure !== null) return;
        try {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          const sample: Mp4Sample = { data, timestamp: chunk.timestamp, duration: chunk.duration ?? step, key: chunk.type === 'key' };
          if (!writer && !annexB) {
            const description = meta?.decoderConfig?.description;
            if (description) writer = new Mp4Writer({ width, height, fps, avcC: bytesOf(description) });
            else annexB = [];
          }
          if (writer) writer.add(sample);
          else annexB?.push(sample);
        } catch (e) {
          fail(e);
        }
      },
      error: (e) => fail(new Error(`motion:encode-failed: ${messageOf(e)}`)),
    });
    encoder.configure(choice.config);

    let turned = clock();
    let painted = 0;
    for (let i = 0; i < frames; i++) {
      // A frame that is the one before it again is not drawn: the canvas
      // still holds that frame, untouched, and is encoded again at this
      // frame's time.
      if (!(i > 0 && o.unchanged?.(i) === true)) {
        await until(o.draw(i), stopped);
        painted++;
      }
      if (failure !== null) throw failure;
      const time = { timestamp: Math.round((i * 1e6) / fps), duration: step };
      frame = new VideoFrame(canvas, crop ? { ...time, visibleRect: crop } : time);
      try {
        encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
      } finally {
        frame.close();
        frame = null;
      }
      o.onProgress?.(i + 1, frames);
      while (encoder.encodeQueueSize > MAX_QUEUE) await until(dequeued(encoder), stopped);
      if ((i + 1) % YIELD_EVERY === 0 || clock() - turned >= YIELD_MS) {
        await until(tick(), stopped);
        turned = clock();
      }
    }
    await until(encoder.flush(), stopped);
    if (failure !== null) throw failure;

    let made: { bytes: Uint8Array; kept: boolean };
    if (writer) made = finishFile(writer, sound);
    else if (annexB && annexB.length) made = fromAnnexB(annexB, width, height, fps, sound);
    else throw new Error('motion:encode-failed: the encoder returned no frames');
    const audio: AudioOutcome = !o.audio ? 'none' : made.kept ? 'kept' : 'dropped';
    return withReport(made.bytes, { audio, painted, frames });
  } catch (e) {
    throw failure ?? e;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    frame?.close();
    if (encoder && encoder.state !== 'closed') encoder.close();
  }
}

/**
 * An Annex-B encode as a file: the samples joined back into one stream, split
 * and converted by `annexBToAvcc`, and given the encoder's timestamps again,
 * which only works if the split found exactly one picture per sample.
 */
function fromAnnexB(samples: Mp4Sample[], width: number, height: number, fps: number, sound: AacTrack | null): { bytes: Uint8Array; kept: boolean } {
  let size = 0;
  for (const s of samples) size += s.data.byteLength;
  const stream = new Uint8Array(size);
  let at = 0;
  for (const s of samples) {
    stream.set(s.data, at);
    at += s.data.byteLength;
  }
  const avc = annexBToAvcc(stream);
  if (!avc || avc.samples.length !== samples.length) {
    throw new Error('motion:encode-failed: the encoder\'s H.264 stream could not be read');
  }
  const w = new Mp4Writer({ width, height, fps, avcC: avc.avcC });
  avc.samples.forEach((data, i) => w.add({ ...samples[i], data }));
  return finishFile(w, sound);
}

/** `p`, unless the export fails first; `p` failing after that is then ignored instead of left unhandled. */
function until<T>(p: T | Promise<T>, stopped: Promise<never>): Promise<T> {
  const settled = Promise.resolve(p);
  settled.catch(() => undefined);
  return Promise.race([settled, stopped]);
}

/**
 * One turn of the event loop, by a message rather than a timer. WebKit and
 * Chrome stretch timers to a second in a hidden, minimized or covered window;
 * waiting on `setTimeout(0)` made an export in a WKWebView left in the
 * background run at 9 frames a second instead of hundreds. Messages are not
 * throttled, and a turn of the loop still lets the window repaint and take a
 * click on Cancel.
 */
function tick(): Promise<void> {
  if (typeof MessageChannel !== 'function') return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/**
 * Settles when the encoder takes a frame off its queue: at its `dequeue`
 * event (WebKit and Chrome both have it), so a full encoder is waited on
 * without polling and without a timer. A timer stays as a safety net against
 * an event that never comes, and an engine without the event is asked again
 * after a turn of the event loop.
 */
function dequeued(encoder: VideoEncoder): Promise<void> {
  if (!('ondequeue' in encoder)) return tick();
  return new Promise((resolve) => {
    const done = () => {
      encoder.removeEventListener('dequeue', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 100);
    encoder.addEventListener('dequeue', done);
  });
}

const aborted = () => new DOMException('Aborted', 'AbortError');

function messageOf(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string' && e.message) return e.message;
  return String(e);
}

function bytesOf(d: AllowSharedBufferSource): Uint8Array {
  return ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d);
}
