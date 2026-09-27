import { useEffect, useMemo, useState, type RefObject } from 'react';
import { FPS, type Video } from './videotypes';
import { decodeSrc, fingerprint, soundPlan } from './videomix';

/**
 * The film's sound on the timeline, under the scenes: the music as a
 * waveform the length of the film — looped where the track is shorter,
 * faded in and out as the mix fades it, at its volume — and each narration
 * line as a block where it is spoken. The part already played is lit, the
 * way a player's progress bar is; VideoTimeline.tsx moves that edge with the
 * playhead through `played`, without drawing the lane again.
 *
 * The waveform is measured from the music itself, decoded once at a low rate
 * (videomix.ts caches it); until it is, the lane is drawn flat.
 */

/** The rate the music is decoded at for its shape: plenty for a waveform, a sliver of the memory. */
const SHAPE_RATE = 8000;
/** Seconds of music per measured peak. */
const PEAK_SECONDS = 0.05;

/** The music's loudest sample in each PEAK_SECONDS, scaled so the loudest is 1. */
const peaksCache = new Map<string, Promise<Float32Array>>();
function peaksOf(src: string): Promise<Float32Array> {
  const key = fingerprint(src);
  const hit = peaksCache.get(key);
  if (hit) return hit;
  const p = decodeSrc(src, SHAPE_RATE).then((pcm) => {
    const ch = pcm.channels[0] ?? new Float32Array(0);
    const step = Math.max(1, Math.round(pcm.rate * PEAK_SECONDS));
    const out = new Float32Array(Math.ceil(ch.length / step));
    let max = 0;
    for (let i = 0; i < out.length; i++) {
      let m = 0;
      for (let j = i * step, end = Math.min(ch.length, j + step); j < end; j++) {
        const v = Math.abs(ch[j]);
        if (v > m) m = v;
      }
      out[i] = m;
      if (m > max) max = m;
    }
    if (max > 0) for (let i = 0; i < out.length; i++) out[i] /= max;
    return out;
  });
  peaksCache.set(key, p);
  p.catch(() => peaksCache.delete(key));
  while (peaksCache.size > 6) peaksCache.delete(peaksCache.keys().next().value as string);
  return p;
}

const ease = (t: number, a: number, b: number) => (t <= a ? 0 : t >= b ? 1 : ((t - a) / (b - a)) ** 2 * (3 - 2 * (t - a) / (b - a)));

export function AudioLane({ video, pps, pad, played }: {
  video: Video;
  /** Pixels per second of the strip. */
  pps: number;
  /** Where second 0 is on the strip. */
  pad: number;
  /** The lit part's box, which the timeline widens with the playhead. */
  played: RefObject<HTMLDivElement>;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => soundPlan(video), [video.scenes, video.audio]);
  const music = plan.music;
  const [peaks, setPeaks] = useState<{ src: string; p: Float32Array } | null>(null);
  useEffect(() => {
    if (!music) return;
    let live = true;
    peaksOf(music.src).then((p) => { if (live) setPeaks({ src: music.src, p }); }, () => undefined);
    return () => { live = false; };
  }, [music?.src]);

  const lines = plan.lines;
  if (!music && !lines.length) return null;
  const film = plan.frames / FPS;
  const width = Math.max(1, film * pps);
  const h = 30;

  // One bar every few pixels, each the loudest moment of the music under it.
  let path = '';
  if (music) {
    const p = peaks && peaks.src === music.src ? peaks.p : null;
    const srcSeconds = p ? p.length * PEAK_SECONDS : 0;
    const every = 3;
    const fadeOut = Math.min(2, film / 4);
    for (let x = 0; x < width; x += every) {
      const t = x / pps;
      let a = 0.25;
      if (p && srcSeconds > 0) {
        const at = (t % srcSeconds) / PEAK_SECONDS;
        const i0 = Math.floor(at);
        let m = 0;
        for (let i = i0, end = Math.min(p.length, Math.floor(at + (every / pps) / PEAK_SECONDS) + 1); i < end; i++) if (p[i] > m) m = p[i];
        a = m;
      }
      const env = ease(t, 0, 0.8) * (1 - ease(t, film - fadeOut, film)) * (0.35 + 0.65 * Math.min(1, music.volume));
      const bar = Math.max(1, a * env * (h - 6));
      path += `M${(x + 1).toFixed(1)} ${((h - bar) / 2).toFixed(1)}v${bar.toFixed(1)}`;
    }
  }
  const title = video.audio?.music?.title ?? '';

  return (
    <div className="vid-tl-audio" aria-hidden="true">
      {music && (
        <div className="vid-tl-music" style={{ insetInlineStart: pad, inlineSize: width, blockSize: h }}>
          <svg className="vid-tl-wave" width={width} height={h} viewBox={`0 0 ${width} ${h}`}><path d={path} /></svg>
          <div className="vid-tl-played" ref={played}>
            <svg className="vid-tl-wave is-played" width={width} height={h} viewBox={`0 0 ${width} ${h}`}><path d={path} /></svg>
          </div>
          {title && (
            <span className="vid-tl-audio-label" dir="auto">
              <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M6 12.5a2 2 0 1 1-2-2 2 2 0 0 1 2 2Zm0 0V3.5l7-1.5v8.5a2 2 0 1 1-2-2" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
              <bdi>{title}</bdi>
            </span>
          )}
        </div>
      )}
      {lines.length > 0 && (
        <div className="vid-tl-voice" style={{ insetInlineStart: pad, inlineSize: width }}>
          {lines.map((l) => (
            <span key={l.id} className={`vid-tl-line ${l.src ? '' : 'is-unvoiced'}`} dir="auto"
                  style={{ insetInlineStart: (l.start / FPS) * pps, inlineSize: Math.max(4, Math.min(l.seconds, (l.end - l.start) / FPS) * pps - 2) }}>
              <bdi>{l.text}</bdi>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
