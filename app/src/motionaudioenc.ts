/**
 * A graphic's sound as AAC, with the webview's own encoder: WebCodecs'
 * `AudioEncoder`, `mp4a.40.2` (AAC-LC), 128 kbit/s stereo. What comes out is
 * what `motionmp4.ts` puts in the film's second track. No library and no
 * media element: PCM in, AAC frames out, and nothing touches the speakers.
 *
 * ## The bed
 *
 * `motionsound.ts` hands over a `SoundBed`: planar Float32 PCM, a channel per
 * array, at a rate it chose. `fitBed` makes it what the encoder takes and the
 * film needs: two channels (a mono bed is played on both; a third channel and
 * beyond are not used), exactly the film's length (cut, or made up with
 * silence), every sample a number between -1 and 1. The rate is the bed's own
 * when the encoder takes it, else 48 kHz, else 44.1 kHz — Chrome's encoder
 * takes only those two, WebKit's many more — and `resample` converts it when
 * it must (a windowed-sinc filter, below).
 *
 * ## Priming, measured
 *
 * An AAC encoder's output starts with priming: decoded, the first samples
 * are the encoder warming up, and the input comes after them. The film's
 * edit list skips exactly that many (see `motionmp4.ts`), so the number has
 * to be right, and neither engine says what it is: WebKit's and Chrome's
 * encoders both stamp the first frame 0 and give no delay (checked on macOS
 * 26.2's WKWebView and Chrome 154, both of which use Apple's encoder, whose
 * priming is 2112 samples). An encoder that does report it stamps the
 * priming frames before 0, and that is believed. Otherwise the delay is
 * *measured*, once per configuration and window: a short burst of noise is
 * encoded with the same settings and decoded back with `AudioDecoder`, and
 * the lag at which the decoded sound best matches the burst is the priming
 * (`lagOf`). Both engines measure 2112 exactly. Where there is no decoder to
 * measure with, 1024 is assumed: the priming of most other encoders, and an
 * error in the safe direction elsewhere, since sound a little late is far
 * less noticeable than sound early (ITU-R BT.1359).
 *
 * ## What engines get wrong, and what is done about it
 *
 * WebKit's `decoderConfig.description` is not the AudioSpecificConfig
 * WebCodecs specifies but the whole ES_Descriptor of an `esds` box (03 … 04
 * … 05 11 90 … 06 …): the config is dug out of it (`ascOf`). An engine that
 * gives no description and sends ADTS frames (a header before each) has its
 * headers read for the config and stripped from the frames. One that gives
 * neither gets the config built from its own settings, as every other muxer
 * does for WebKit.
 *
 * ## Errors
 *
 * `motion:no-aac` (this window has no AAC encoder, or none for any rate it
 * could be given), `motion:aac-failed: <the engine's words>`,
 * `motion:no-sound` (a bed with no channel or no usable rate). Cancel
 * rejects with an `AbortError`, as everywhere in the app. Every encoder and
 * decoder opened is closed on every way out. `motionencode.ts` turns any of
 * these but Cancel into a film without sound, and says so.
 */

import { ascFor, readAsc } from './motionmp4';
import type { SoundBed } from './motionsound';

/** One AAC access unit: raw, as the MP4 stores it; `timestamp` and `duration` in microseconds, as the encoder stamped them. */
export interface AacFrame {
  data: Uint8Array;
  timestamp: number;
  duration: number;
}

/**
 * A bed encoded: the AudioSpecificConfig the frames are decoded with, their
 * rate and channels, the frames in order, the priming before the sound
 * (`delaySamples`) and the sound's own length (`totalSamples`), both in
 * samples at `sampleRate`. Exactly what `Mp4Writer.addAudioTrack` takes.
 */
export interface AacTrack {
  asc: Uint8Array;
  sampleRate: number;
  channels: number;
  frames: AacFrame[];
  delaySamples: number;
  totalSamples: number;
}

/** WebCodecs' name for AAC-LC. */
export const AAC_CODEC = 'mp4a.40.2';
/** What a stereo music bed under a graphic needs to be transparent, and what every platform recompresses from comfortably. */
export const AAC_BITRATE = 128_000;
/** The rate a film's sound is made at when it can be: video's own. */
export const AAC_RATE = 48000;
/** Rates tried after the bed's own: video's, then the CD's. */
const RATES = [48000, 44100];
/** The priming assumed when it can be neither read nor measured. */
export const DEFAULT_DELAY = 1024;
const CHANNELS = 2;

// ── the bed ───────────────────────────────────────────────────────────────

/** Seconds a bed cut short is faded over at its new end: long enough not to click, too short to hear as a fade. */
const CUT_FADE = 0.01;

/**
 * A bed as the encoder takes it: two channels, new arrays (the caller's are
 * never changed), every sample finite and inside [-1, 1], and — given
 * `seconds` — exactly `round(seconds × rate)` samples long; one cut short is
 * faded out over its last 10 ms (`CUT_FADE`). Null for a bed with no
 * Float32Array channel or a rate that is not between 3 and 384 kHz.
 */
export function fitBed(bed: SoundBed | null | undefined, seconds?: number): SoundBed | null {
  const rate = bed?.sampleRate;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 3000 || rate > 384000) return null;
  const own = Array.isArray(bed?.channels) ? bed.channels.filter((c): c is Float32Array => c instanceof Float32Array) : [];
  if (!own.length) return null;
  const pair = [own[0], own[1] ?? own[0]];
  const length = seconds !== undefined && Number.isFinite(seconds) && seconds >= 0
    ? Math.round(seconds * rate)
    : Math.max(pair[0].length, pair[1].length);
  const channels = pair.map((src) => {
    const out = new Float32Array(length);
    const n = Math.min(length, src.length);
    for (let i = 0; i < n; i++) {
      const v = src[i];
      // NaN is silence; an infinity, or anything past full scale, is full scale.
      out[i] = Number.isNaN(v) ? 0 : Math.max(-1, Math.min(1, v));
    }
    // Cut short, the sound would stop on whatever sample the cut fell on: a
    // click. A film is a whole number of frames, so a graphic 4.39 s long at
    // 24 a second is 4.375 s of film, and its bed loses its last 15 ms — in
    // the middle of the bed's own fade-out. The new end is faded instead.
    if (src.length > length) {
      const fade = Math.min(length, Math.round(CUT_FADE * rate));
      for (let i = 0; i < fade; i++) out[length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
    }
    return out;
  });
  return { channels, sampleRate: rate };
}


// ── resampling ────────────────────────────────────────────────────────────

/**
 * Zero crossings of the sinc on each side of a sample, and the Kaiser
 * window's shape: together a filter about 75 taps long which, taking 48 kHz
 * to 44.1 kHz, passes 18 kHz untouched and holds 21.4 kHz 74 dB down and
 * 23.5 kHz 85 dB down (measured). The cost — about 75 multiplications a
 * sample, a second for a 30-second stereo bed — is paid only for a bed the
 * encoder will not take at its own rate.
 */
const ZEROS = 32;
const BETA = 8;
/** Kernel values per input sample in the lookup table; between them it is interpolated. */
const RESOLUTION = 512;
/** Where the filter's cut sits, as a share of the lower rate's Nyquist frequency: 19.8 kHz of a 44.1 kHz bed. */
const ROLLOFF = 0.9;

/** The zeroth-order modified Bessel function of the first kind, by its series: what the Kaiser window is made of. */
function bessel0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 50 && term > sum * 1e-12; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
  }
  return sum;
}

/**
 * `x` at rate `from` as the same sound at rate `to`: a band-limited
 * (windowed-sinc, Kaiser window) interpolation, so a tone stays the tone it
 * was and nothing above the lower rate's Nyquist frequency folds back as a
 * whistle. Output sample `j` is the input at time `j / to`, so the first
 * samples coincide and the length scales with the rates, rounded.
 */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (!(from > 0) || !(to > 0) || !Number.isFinite(from) || !Number.isFinite(to)) throw new RangeError(`resample: bad rates ${from} → ${to}`);
  if (from === to) return x.slice();
  const out = new Float32Array(Math.max(0, Math.round((x.length * to) / from)));
  const step = from / to;
  // Downsampling lowers the cutoff to the new rate's Nyquist frequency and widens the kernel to match.
  const fc = Math.min(1, to / from) * ROLLOFF;
  const half = ZEROS / fc;
  const size = Math.ceil(half * RESOLUTION) + 2;
  const table = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const t = i / RESOLUTION;
    if (t > half) continue;
    const u = Math.PI * fc * t;
    const sinc = t === 0 ? 1 : Math.sin(u) / u;
    const w = bessel0(BETA * Math.sqrt(Math.max(0, 1 - (t / half) ** 2))) / bessel0(BETA);
    table[i] = fc * sinc * w;
  }
  const kernel = (t: number): number => {
    const p = Math.abs(t) * RESOLUTION;
    const i = Math.floor(p);
    if (i + 1 >= size) return 0;
    return table[i] + (table[i + 1] - table[i]) * (p - i);
  };
  for (let j = 0; j < out.length; j++) {
    const c = j * step;
    const k0 = Math.ceil(c - half);
    const k1 = Math.floor(c + half);
    let sum = 0;
    let weight = 0;
    for (let k = k0; k <= k1; k++) {
      const h = kernel(c - k);
      weight += h;
      if (k >= 0 && k < x.length) sum += x[k] * h;
    }
    // Divided by every weight the kernel gave, in range or not: unity gain
    // for a steady signal, and silence beyond the ends, as there is.
    out[j] = weight > 0 ? sum / weight : 0;
  }
  return out;
}

// ── configs, descriptions, ADTS ───────────────────────────────────────────

/**
 * The AudioSpecificConfig in an encoder's `description`: the description
 * itself when it is one, the DecoderSpecificInfo (tag 5) inside it when it
 * is an ES_Descriptor (tag 3) as WebKit's is, null otherwise.
 */
export function ascOf(description: Uint8Array | null | undefined): Uint8Array | null {
  if (!(description instanceof Uint8Array) || description.length < 2) return null;
  if (description[0] !== 0x03 && readAsc(description)) return description.slice();
  // Descriptors: a tag, a length in 7-bit pieces, then the body; tags 3 and 4
  // hold others after a fixed header (ES_ID and flags; the decoder config's 13 bytes).
  const find = (from: number, to: number, depth: number): Uint8Array | null => {
    let at = from;
    while (at < to && depth < 4) {
      const tag = description[at++];
      let size = 0;
      let n = 0;
      while (at < to && n < 4) {
        const b = description[at++];
        size = size * 128 + (b & 0x7f);
        n++;
        if (!(b & 0x80)) break;
      }
      const end = at + size;
      if (end > to) return null;
      if (tag === 0x05) return readAsc(description.subarray(at, end)) ? description.slice(at, end) : null;
      if (tag === 0x03 && size >= 3) {
        const flags = description[at + 2];
        // The optional fields after the flags: a dependency, a URL, an OCR stream.
        let skip = 3 + (flags & 0x80 ? 2 : 0) + (flags & 0x20 ? 2 : 0);
        if (flags & 0x40) skip += 1 + (description[at + skip] ?? 0);
        const hit = find(at + skip, end, depth + 1);
        if (hit) return hit;
      } else if (tag === 0x04 && size >= 13) {
        const hit = find(at + 13, end, depth + 1);
        if (hit) return hit;
      }
      at = end;
    }
    return null;
  };
  return find(0, description.length, 0);
}

/** ADTS's sampling indexes, the same table as the AudioSpecificConfig's. */
const ADTS_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/**
 * An ADTS frame (14496-3, 1.A.2): its header read — AAC-LC only, the rate
 * and channels it names — and the raw frame after it. Null when `data` does
 * not start with a whole ADTS header of an AAC-LC frame that fits in it.
 */
export function adtsFrame(data: Uint8Array): { sampleRate: number; channels: number; payload: Uint8Array } | null {
  if (!(data instanceof Uint8Array) || data.length < 7 || data[0] !== 0xff || (data[1] & 0xf6) !== 0xf0) return null;
  const protectionAbsent = data[1] & 1;
  const profile = data[2] >> 6;
  const rate = ADTS_RATES[(data[2] >> 2) & 0x0f] ?? 0;
  const config = ((data[2] & 1) << 2) | (data[3] >> 6);
  const length = ((data[3] & 3) << 11) | (data[4] << 3) | (data[5] >> 5);
  const header = protectionAbsent ? 7 : 9;
  const channels = [0, 1, 2, 3, 4, 5, 6, 8][config] ?? 0;
  if (profile !== 1 || !rate || !channels || length <= header || length > data.length) return null;
  return { sampleRate: rate, channels, payload: data.slice(header, length) };
}

/**
 * What the encoder emitted, as an MP4 holds it: the config (from the
 * description, from ADTS headers, or built from `rate` and `channels`) and
 * raw frames. Null when that cannot be made right: a config that does not
 * say `rate` and `channels`, or a frame with no bytes.
 */
export function normalise(description: Uint8Array | null, frames: AacFrame[], rate: number, channels: number):
  { asc: Uint8Array; frames: AacFrame[] } | null {
  let asc = ascOf(description);
  let out = frames;
  if (!asc && frames.length && adtsFrame(frames[0].data)) {
    const head = adtsFrame(frames[0].data);
    asc = head ? ascFor(head.sampleRate, head.channels) : null;
    out = [];
    for (const f of frames) {
      const a = adtsFrame(f.data);
      if (!a) return null;
      out.push({ ...f, data: a.payload });
    }
  }
  asc ??= ascFor(rate, channels);
  const read = asc ? readAsc(asc) : null;
  if (!asc || !read || read.sampleRate !== rate || read.channels !== channels) return null;
  if (out.some((f) => !(f.data instanceof Uint8Array) || f.data.length === 0)) return null;
  return { asc, frames: out };
}

// ── the encoder ───────────────────────────────────────────────────────────

/** `AudioEncoderConfig` with WebCodecs' AAC field, which TypeScript's DOM types do not have yet. */
type AacEncoderConfig = AudioEncoderConfig & { aac?: { format: 'aac' | 'adts' } };

const hasCodecs = () => typeof AudioEncoder !== 'undefined' && typeof AudioEncoder.isConfigSupported === 'function'
  && typeof AudioData !== 'undefined';

async function supports(config: AacEncoderConfig): Promise<boolean> {
  try {
    return !!(await AudioEncoder.isConfigSupported(config)).supported;
  } catch {
    // A field the engine refuses: as good as no.
    return false;
  }
}

/**
 * Whether this window can encode AAC-LC at `sampleRate` (48 kHz unless
 * said) with `channels` (2), at 128 kbit/s: what an export with sound needs.
 * False where there is no `AudioEncoder` at all.
 */
export async function canEncodeAac(sampleRate = AAC_RATE, channels = CHANNELS): Promise<boolean> {
  if (!hasCodecs()) return false;
  return supports({ codec: AAC_CODEC, sampleRate, numberOfChannels: channels, bitrate: AAC_BITRATE });
}

/**
 * The encoder configuration for a rate, asking for raw AAC frames when the
 * engine knows the field (both engines do; ADTS is still read if one sends
 * it). Null when the rate is not taken at all.
 */
async function configFor(sampleRate: number, bitrate: number): Promise<AacEncoderConfig | null> {
  const plain: AacEncoderConfig = { codec: AAC_CODEC, sampleRate, numberOfChannels: CHANNELS, bitrate };
  if (!(await supports(plain))) return null;
  const raw: AacEncoderConfig = { ...plain, aac: { format: 'aac' } };
  return (await supports(raw)) ? raw : plain;
}

/** The rate to encode at: the bed's own when the encoder takes it, else 48 kHz, else 44.1 kHz. */
async function chooseRate(own: number, bitrate: number): Promise<{ rate: number; config: AacEncoderConfig } | null> {
  const candidates = [Number.isInteger(own) && own >= 8000 && own <= 96000 ? own : 0, ...RATES].filter((r, i, all) => r > 0 && all.indexOf(r) === i);
  for (const rate of candidates) {
    const config = await configFor(rate, bitrate);
    if (config) return { rate, config };
  }
  return null;
}

/** PCM frames handed to the encoder at a time: a tenth of a second, so progress and Cancel are prompt. */
const FEED = 4800;
/** Inputs the encoder may hold before feeding waits. */
const MAX_QUEUE = 8;

/**
 * `channels` (planar, all the same length) through one `AudioEncoder` made
 * for `config`: the frames it emits, in order, and its description. Reports
 * `onProgress(samples fed, samples)`; aborting `signal` stops it. The
 * encoder is closed on every way out.
 */
async function runEncoder(
  config: AacEncoderConfig, channels: Float32Array[],
  o: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ description: Uint8Array | null; frames: AacFrame[] }> {
  const { signal } = o;
  if (signal?.aborted) throw aborted();
  const rate = config.sampleRate;
  const total = channels[0]?.length ?? 0;
  const frames: AacFrame[] = [];
  let description: Uint8Array | null = null;
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
  let encoder = null as AudioEncoder | null;
  let data = null as AudioData | null;
  try {
    encoder = new AudioEncoder({
      output: (chunk, meta) => {
        if (failure !== null) return;
        try {
          const bytes = new Uint8Array(chunk.byteLength);
          chunk.copyTo(bytes);
          const step = (1024 * 1e6) / rate;
          frames.push({ data: bytes, timestamp: chunk.timestamp, duration: chunk.duration ?? Math.round(step) });
          const d = meta?.decoderConfig?.description;
          if (d && !description) description = bytesOf(d).slice();
        } catch (e) {
          fail(e);
        }
      },
      error: (e) => fail(new Error(`motion:aac-failed: ${messageOf(e)}`)),
    });
    encoder.configure(config);
    for (let at = 0; at < total; at += FEED) {
      if (failure !== null) throw failure;
      const n = Math.min(FEED, total - at);
      const planar = new Float32Array(n * channels.length);
      channels.forEach((c, i) => planar.set(c.subarray(at, at + n), i * n));
      data = new AudioData({
        format: 'f32-planar', sampleRate: rate, numberOfFrames: n, numberOfChannels: channels.length,
        timestamp: Math.round((at * 1e6) / rate), data: planar,
      });
      try {
        encoder.encode(data);
      } finally {
        data.close();
        data = null;
      }
      o.onProgress?.(at + n, total);
      while (encoder.encodeQueueSize > MAX_QUEUE && failure === null) await until(tick(), stopped);
      if ((at / FEED) % 4 === 3) await until(tick(), stopped);
    }
    await until(encoder.flush(), stopped);
    if (failure !== null) throw failure;
    return { description, frames };
  } catch (e) {
    throw failure ?? e;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    data?.close();
    if (encoder && encoder.state !== 'closed') encoder.close();
  }
}

// ── measuring the priming ─────────────────────────────────────────────────

/** Samples of noise in the measuring burst, and the most priming looked for: past every encoder's (Apple 2112, Nero 2624, FDK 2048). */
const BURST = 2048;
const MAX_LAG = 6144;
/**
 * When a measured lag is believed: the decoded burst must match the burst at
 * that lag at least this well (a normalised correlation; WebKit's codec gives
 * 0.67 at the true lag, Chrome's 0.93) …
 */
const MATCH = 0.4;
/** … and at least this many times better than at any lag more than `NEAR` samples away (0.1 in both engines), so a peak is a peak and not noise. */
const CLEAR = 3;
const NEAR = 16;

/**
 * Measured primings, by encoder and configuration: an engine's encoder does
 * not change while the window is open, so each is measured once. Keyed first
 * by the `AudioEncoder` class itself, so a different encoder (a test's) is
 * never answered with another's number.
 */
const measured = new WeakMap<object, Map<string, number>>();

/**
 * The burst the priming is measured with: seeded noise (the same every
 * time), softened a little so the codec keeps its shape, then silence long
 * enough for any priming to pass.
 */
export function burst(): Float32Array {
  const out = new Float32Array(BURST + MAX_LAG + 1024);
  let seed = 0x5eed1234;
  let last = 0;
  for (let i = 0; i < BURST; i++) {
    // mulberry32
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    const v = r * 2 - 1;
    out[i] = 0.25 * (v + last);
    last = v;
  }
  return out;
}

/**
 * The lag, in samples, at which `decoded` best matches `reference` (its
 * first `BURST` samples): the normalised cross-correlation's peak over 0 to
 * `maxLag`. Null when the peak is not clearly one — a poor match, or one
 * hardly better than at lags far from it (the codec mangled the burst, or the
 * decoder returned something else) — so a guess is not taken for a
 * measurement.
 */
export function lagOf(reference: Float32Array, decoded: Float32Array, maxLag = MAX_LAG): number | null {
  const n = Math.min(BURST, reference.length);
  const last = Math.min(maxLag, decoded.length - n);
  if (n < 64 || last < 0) return null;
  let ref = 0;
  for (let k = 0; k < n; k++) ref += reference[k] * reference[k];
  if (!(ref > 0)) return null;
  const scores = new Float64Array(last + 1);
  // The energy of the decoded stretch under the burst, slid along.
  let energy = 0;
  for (let k = 0; k < n; k++) energy += decoded[k] * decoded[k];
  let at = -1;
  for (let lag = 0; lag <= last; lag++) {
    if (lag > 0) {
      const gone = decoded[lag - 1];
      const come = decoded[lag + n - 1];
      energy += come * come - gone * gone;
    }
    if (energy <= 1e-12) continue;
    let dot = 0;
    for (let k = 0; k < n; k++) dot += reference[k] * decoded[lag + k];
    scores[lag] = dot / Math.sqrt(ref * energy);
    if (at < 0 || scores[lag] > scores[at]) at = lag;
  }
  if (at < 0) return null;
  let elsewhere = 0;
  for (let lag = 0; lag <= last; lag++) if (Math.abs(lag - at) > NEAR) elsewhere = Math.max(elsewhere, scores[lag]);
  return scores[at] >= MATCH && scores[at] >= CLEAR * elsewhere ? at : null;
}

/**
 * The priming of this window's encoder for `config`, measured (see the top
 * of this file), or null when it cannot be: no `AudioDecoder`, a decoder that
 * refuses the stream, or a burst that does not come back recognisably.
 */
async function measureDelay(config: AacEncoderConfig, signal?: AbortSignal): Promise<number | null> {
  const key = `${config.sampleRate}x${config.numberOfChannels}@${config.bitrate}/${config.aac?.format ?? ''}`;
  let known = measured.get(AudioEncoder);
  if (!known) {
    known = new Map();
    measured.set(AudioEncoder, known);
  }
  const before = known.get(key);
  if (before !== undefined) return before;
  if (typeof AudioDecoder === 'undefined' || typeof EncodedAudioChunk === 'undefined') return null;
  const reference = burst();
  let lag: number | null = null;
  try {
    const run = await runEncoder(config, Array.from({ length: config.numberOfChannels }, () => reference), { signal });
    const made = normalise(run.description, run.frames, config.sampleRate, config.numberOfChannels);
    if (made) lag = lagOf(reference, await decode(made.asc, made.frames, config, signal));
  } catch (e) {
    if (isAbort(e)) throw e;
    lag = null;
  }
  // Only a measurement is kept: a decoder that failed once is asked again next time.
  if (lag !== null) known.set(key, lag);
  return lag;
}

/** AAC frames decoded with this window's `AudioDecoder`: the first channel, every sample it gave, in order. */
async function decode(asc: Uint8Array, frames: AacFrame[], config: AacEncoderConfig, signal?: AbortSignal): Promise<Float32Array> {
  return (await decodePlanes(asc, frames, config.sampleRate, 1, config.numberOfChannels, signal))[0];
}

/**
 * AAC frames decoded with this window's `AudioDecoder`: the first `planes`
 * channels of a stream of `channels`, every sample it gave, in order.
 */
async function decodePlanes(
  asc: Uint8Array, frames: AacFrame[], sampleRate: number, planes: number, channels: number, signal?: AbortSignal,
): Promise<Float32Array[]> {
  if (signal?.aborted) throw aborted();
  const parts: Float32Array[][] = [];
  let failure = null as unknown;
  const decoder = new AudioDecoder({
    output: (d) => {
      try {
        const got: Float32Array[] = [];
        for (let c = 0; c < planes; c++) {
          const plane = new Float32Array(d.numberOfFrames);
          d.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
          got.push(plane);
        }
        parts.push(got);
      } catch (e) {
        failure ??= e;
      } finally {
        d.close();
      }
    },
    error: (e) => { failure ??= e; },
  });
  try {
    decoder.configure({ codec: AAC_CODEC, sampleRate, numberOfChannels: channels, description: asc });
    for (const f of frames) {
      if (signal?.aborted) throw aborted();
      decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: f.timestamp, duration: f.duration, data: f.data }));
    }
    await decoder.flush();
    if (failure !== null) throw failure;
  } finally {
    if (decoder.state !== 'closed') decoder.close();
  }
  return Array.from({ length: planes }, (_, c) => {
    let size = 0;
    for (const p of parts) size += p[c].length;
    const out = new Float32Array(size);
    let at = 0;
    for (const p of parts) {
      out.set(p[c], at);
      at += p[c].length;
    }
    return out;
  });
}

/**
 * The sound a player hears from `track`: its frames decoded by this
 * window's own `AudioDecoder`, the priming skipped and the padding left off,
 * exactly as the film's edit list plays it — every channel, `totalSamples`
 * long (shorter only if the decoder gave less). Null where there is no
 * decoder, or it refuses the stream or fails: nothing could be checked.
 * Cancel is an `AbortError`.
 *
 * What it is for: an AAC encoder does not give back the wave it was given.
 * Its quantisation noise rides on the peaks, so the decoded sound can crest
 * above anything in the bed — by up to 1.9 dB, measured on the app's
 * templates through WebKit's encoder at 128 kbit/s (the R2 review, 2026-10-03)
 * — and a bed held at −2.5 dBTP came out at −0.6 dBTP. Only the decoded
 * sound can say where the film's peaks are (`motionencode.ts` checks them).
 */
export async function decodeAac(track: AacTrack, signal?: AbortSignal): Promise<Float32Array[] | null> {
  if (signal?.aborted) throw aborted();
  if (typeof AudioDecoder === 'undefined' || typeof EncodedAudioChunk === 'undefined') return null;
  if (!track?.frames?.length) return null;
  try {
    const all = await decodePlanes(track.asc, track.frames, track.sampleRate, track.channels, track.channels, signal);
    const from = Math.max(0, Math.round(track.delaySamples));
    return all.map((c) => c.slice(Math.min(from, c.length), Math.min(c.length, from + Math.max(0, track.totalSamples))));
  } catch (e) {
    if (isAbort(e) || signal?.aborted) throw aborted();
    return null;
  }
}

// ── encoding a bed ────────────────────────────────────────────────────────

/**
 * A bed as AAC: fitted (`fitBed`), at the bed's own rate or the nearest the
 * encoder takes (resampled), 128 kbit/s unless `bitrate` says (held between
 * 32 and 320), with the priming read or measured. Reports
 * `onProgress(samples encoded, samples)`; aborting `signal` stops it with an
 * `AbortError`. Rejects with the codes at the top of this file.
 */
export async function encodeAac(
  bed: SoundBed,
  o: { bitrate?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<AacTrack> {
  const { signal } = o;
  if (signal?.aborted) throw aborted();
  const fitted = fitBed(bed);
  if (!fitted) throw new Error('motion:no-sound');
  if (!hasCodecs()) throw new Error('motion:no-aac');
  const bitrate = Math.round(Math.min(320_000, Math.max(32_000, Number.isFinite(o.bitrate) ? Number(o.bitrate) : AAC_BITRATE)));
  const chosen = await chooseRate(fitted.sampleRate, bitrate);
  if (!chosen) throw new Error('motion:no-aac');
  if (signal?.aborted) throw aborted();
  const { rate, config } = chosen;
  const channels = rate === fitted.sampleRate ? fitted.channels : fitted.channels.map((c) => resample(c, fitted.sampleRate, rate));
  const totalSamples = channels[0].length;

  const run = await runEncoder(config, channels, o);
  const made = normalise(run.description, run.frames, rate, CHANNELS);
  if (!made || !made.frames.length) throw new Error('motion:aac-failed: the encoder\'s stream could not be read');
  // An encoder that stamps its priming before 0 has said how long it is.
  const first = made.frames[0].timestamp;
  const reported = Number.isFinite(first) && first < 0 ? Math.round((-first * rate) / 1e6) : 0;
  const delaySamples = reported || ((await measureDelay(config, signal)) ?? DEFAULT_DELAY);
  return { asc: made.asc, sampleRate: rate, channels: CHANNELS, frames: made.frames, delaySamples, totalSamples };
}

// ── small things ──────────────────────────────────────────────────────────

/** `p`, unless the run fails first; `p` failing after that is then ignored instead of left unhandled. */
function until<T>(p: T | Promise<T>, stopped: Promise<never>): Promise<T> {
  const settled = Promise.resolve(p);
  settled.catch(() => undefined);
  return Promise.race([settled, stopped]);
}

/** One turn of the event loop by a message, which a hidden window does not throttle as it does timers (`motionencode.ts`'s `tick`). */
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

const aborted = () => new DOMException('Aborted', 'AbortError');

function isAbort(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'name' in e && (e as { name?: unknown }).name === 'AbortError';
}

function messageOf(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string' && e.message) return e.message;
  return String(e);
}

function bytesOf(d: AllowSharedBufferSource): Uint8Array {
  return ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d);
}
