/**
 * The Video module's sound out: one Web Audio context for everything the
 * panel lets a person hear — the film's mix under the preview, a track or a
 * voice line tried in the Sound tab.
 *
 * Why not `<audio>`: in the app's webview (WKWebView on macOS 26) an
 * `HTMLMediaElement` plays through AVFoundation in WebKit's GPU process, and
 * that process can deadlock inside AVFoundation while the page asks it to
 * start playing — the page then waits on it forever and the whole window
 * stops answering (seen 2026-09-27: `HTMLMediaElement::play` blocked in
 * `RemoteAudioSession::tryToSetActive`, the GPU process's main thread parked
 * in `AVPlayerItem currentTime`). The preview's player seeks its audio
 * element again and again to keep it in step, which is exactly what brings
 * it on. Web Audio plays decoded samples through an audio unit, with no
 * AVFoundation player in between.
 */

import { decodeAudio } from './videomix';

let ctx: AudioContext | null = null;

/** The shared context, made on first use; `null` where the window has no Web Audio. */
export function speaker(): AudioContext | null {
  if (ctx) return ctx;
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/** Let the context run: called in a click, where WebKit allows sound to start. */
export function wake(): void {
  const c = speaker();
  if (c && c.state !== 'running') void c.resume().catch(() => undefined);
}

/** Samples as an AudioBuffer for the context. */
export function bufferOf(channels: readonly Float32Array[], rate: number): AudioBuffer | null {
  const c = speaker();
  const len = channels[0]?.length ?? 0;
  if (!c || !len) return null;
  const buf = c.createBuffer(Math.max(1, Math.min(2, channels.length)), len, rate);
  for (let i = 0; i < buf.numberOfChannels; i++) buf.copyToChannel(channels[i] as Float32Array<ArrayBuffer>, i);
  return buf;
}

// ── one sound at a time, for the Sound tab ────────────────────────────────

/** Decoded sounds by key, a few kept so pressing play again starts at once. */
const decoded = new Map<string, Promise<AudioBuffer | null>>();
let current: { key: string; src: AudioBufferSourceNode } | null = null;
let onEnd: (() => void) | null = null;

/** What is playing, by its key, or ''. */
export function playingKey(): string {
  return current?.key ?? '';
}

/** Stop whatever the Sound tab is playing. */
export function stopSound(): void {
  const c = current;
  current = null;
  if (c) {
    c.src.onended = null;
    try { c.src.stop(); } catch { /* not started */ }
    c.src.disconnect();
  }
}

/**
 * Play encoded audio (MP3 or WAV bytes) once, from the start, stopping what
 * was playing. Resolves when it starts; `ended` is called when it finishes by
 * itself (not when it is stopped).
 */
export async function playSound(key: string, bytes: () => Uint8Array | null, ended: () => void): Promise<void> {
  const c = speaker();
  if (!c) throw new Error('This window cannot play audio.');
  stopSound();
  let p = decoded.get(key);
  if (!p) {
    const b = bytes();
    if (!b) return;
    p = decodeAudio(b, c.sampleRate).then((pcm) => bufferOf(pcm.channels, pcm.rate));
    decoded.set(key, p);
    p.catch(() => decoded.delete(key));
    while (decoded.size > 8) decoded.delete(decoded.keys().next().value as string);
  }
  const buf = await p;
  if (!buf) return;
  if (c.state !== 'running') await c.resume().catch(() => undefined);
  stopSound();
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(c.destination);
  onEnd = ended;
  src.onended = () => {
    if (current?.src !== src) return;
    current = null;
    onEnd?.();
  };
  current = { key, src };
  src.start();
}
