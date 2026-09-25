/**
 * The video's sound inside the composition: the music and the voice, and the
 * narration burned in as captions.
 *
 * ## One mix, heard in the player and written into the file
 *
 * `videomix.ts` mixes the film's sound as plain arithmetic over decoded
 * samples — the music looped, faded and ducked under each line, each line at
 * its scene's start as the composition places scenes (transitions
 * overlapping). This file only decides who hears that mix and how:
 *
 * - **In the player** it is one WAV, from a blob: URL, under one
 *   `<Html5Audio>` for the whole film — the player seeks and plays it with
 *   the frames. A blob: URL because the app's CSP has `media-src 'self'
 *   blob:` and no `data:`.
 * - **In an export** (`renderMediaOnWeb`) there is no audio element to
 *   capture. The web renderer builds its audio track from `inline-audio`
 *   render assets — the samples each frame contributes — which only
 *   `@remotion/media`'s `<Audio>` registers, and that package is not in
 *   this app. So this layer registers them itself, through the same
 *   `RenderAssetManager` context: every frame, that frame's slice of the
 *   mix, 16-bit stereo at the renderer's sample rate. The render waits (a
 *   `delayRender`) until the mix is ready. When the export is `muted`, the
 *   renderer says audio is off and nothing is decoded or registered.
 *
 * Nothing here fetches: the music and the voice are data: URLs kept in the
 * video, decoded from their bytes (the CSP's `connect-src` refuses a fetch of
 * `data:` or `blob:` in both engines).
 *
 * ## Captions
 *
 * The line being said, a page of whole words at a time, each word lighting
 * up as the voice reaches it and the newest in the accent; the words still to
 * come keep their place, faint, so the line never re-flows. In the style's body face, right to left for
 * Arabic and Kurdish with the direction set explicitly, never letter-spaced
 * (the web renderer draws each word where the DOM laid it, and spacing
 * Arabic letters apart breaks their joins), and above the part of a vertical
 * frame where phone apps draw their own buttons.
 */

import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { Html5Audio, Internals, useCurrentFrame, useDelayRender, useRemotionEnvironment, useVideoConfig } from 'remotion';
import type { Format, Video } from './videotypes';
import { isRtl } from './video';
import { boxOf, contrast, fitText, fontsReady, themeOf } from './videotheme';
import { dirOf } from './videoscenebits';
import { captionAt, captionPages, encodeWav, frameSamples, mixVideo, planKey, soundPlan, type SoundPlan } from './videomix';

/** Whether a plan has anything to hear (captions alone are silent). */
const audible = (p: SoundPlan) => Boolean(p.music) || p.lines.some((l) => l.src);

/**
 * The player's mix rate: the renderer's default, so the player and the file
 * are mixed from the same decoded samples (decoded once, videomix.ts caches
 * them by rate).
 */
const PREVIEW_RATE = 48000;

// ── the player's mix ──────────────────────────────────────────────────────

/** Mixed WAVs as blob: URLs, newest last. A few are kept so two players and an undo do not mix again. */
const previews = new Map<string, Promise<string>>();
const KEEP_PREVIEWS = 4;

function previewUrl(plan: SoundPlan, key: string): Promise<string> {
  const hit = previews.get(key);
  if (hit) {
    previews.delete(key);
    previews.set(key, hit);
    return hit;
  }
  const made = mixVideo(plan, PREVIEW_RATE).then((mix) => {
    const wav = encodeWav(mix, PREVIEW_RATE);
    return URL.createObjectURL(new Blob([wav.buffer as ArrayBuffer], { type: 'audio/wav' }));
  });
  previews.set(key, made);
  made.catch(() => previews.delete(key));
  while (previews.size > KEEP_PREVIEWS) {
    const oldest = previews.keys().next().value as string;
    const gone = previews.get(oldest);
    previews.delete(oldest);
    // Revoked a little later, so a player still holding it can let go first.
    gone?.then((u) => setTimeout(() => URL.revokeObjectURL(u), 10_000), () => undefined);
  }
  return made;
}

/**
 * The mix under `<Html5Audio>`, remade a moment after the sound changes —
 * a slider being dragged, a scene being lengthened — and swapped in when it
 * is ready. Until the first one is, the preview is silent.
 */
function PreviewSound({ plan }: { plan: SoundPlan }): JSX.Element | null {
  const key = audible(plan) ? planKey(plan) : '';
  const [url, setUrl] = useState<{ key: string; url: string } | null>(null);
  const planRef = useRef(plan);
  planRef.current = plan;
  useEffect(() => {
    if (!key) {
      setUrl(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      previewUrl(planRef.current, key).then(
        (u) => { if (live) setUrl({ key, url: u }); },
        () => { if (live) setUrl(null); },
      );
    }, previews.has(key) ? 0 : 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);
  if (!key || !url) return null;
  return <Html5Audio src={url.url} pauseWhenBuffering={false} />;
}

// ── the file's mix ────────────────────────────────────────────────────────

/**
 * Each frame's samples, handed to the web renderer as an `inline-audio`
 * asset — the shape `@remotion/media` gives it: interleaved 16-bit stereo,
 * as many samples as the renderer's mixer takes for that frame.
 */
function RenderedMix({ plan, planKeyed }: { plan: SoundPlan; planKeyed: string }): null {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shared = useContext(Internals.SharedAudioContext);
  const rate = shared?.sampleRate ?? 48000;
  const assets = useContext(Internals.RenderAssetManager);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  // Held by this render only: three minutes of 48 kHz stereo is some 70 MB, let go when the render ends.
  const [mix, setMix] = useState<Float32Array[] | null>(null);
  const id = useMemo(() => `vylo-sound-${Math.random().toString(36).slice(2, 10)}`, []);

  useLayoutEffect(() => {
    const handle = delayRender('Mixing the video’s sound', { timeoutInMilliseconds: 120_000 });
    let live = true;
    mixVideo(plan, rate).then(
      (m) => {
        // Set synchronously, so this frame's samples are registered before the render goes on.
        if (live) flushSync(() => setMix(m));
        continueRender(handle);
      },
      (e: unknown) => {
        cancelRender(e instanceof Error ? e : new Error(`The sound could not be mixed: ${String(e)}`));
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKeyed, rate]);

  useLayoutEffect(() => {
    if (!mix) return;
    const audio = frameSamples(mix, frame, fps, rate);
    assets.registerRenderAsset({
      type: 'inline-audio',
      id,
      audio,
      frame,
      startInVideo: frame,
      timestamp: Math.round((frame / fps) * 1e6),
      duration: Math.round((audio.length / 2 / rate) * 1e6),
      toneFrequency: 1,
    });
    return () => assets.unregisterRenderAsset(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mix, frame, fps, rate, id]);

  return null;
}

/** The sound of an export, when the export has sound. */
function RenderedSound({ plan }: { plan: SoundPlan }): JSX.Element | null {
  const enabled = Internals.useAudioEnabled();
  const key = useMemo(() => (audible(plan) ? planKey(plan) : ''), [plan]);
  if (!enabled || !key) return null;
  return <RenderedMix plan={plan} planKeyed={key} />;
}

// ── captions ──────────────────────────────────────────────────────────────

/** Caption size by frame shape, in 1080-units, and how much of a line a page holds. */
const CAPTION: Readonly<Record<Format, { size: number; min: number; words: number; chars: number; width: number }>> = {
  landscape: { size: 50, min: 30, words: 8, chars: 48, width: 0.8 },
  portrait: { size: 56, min: 34, words: 5, chars: 28, width: 0.94 },
  square: { size: 50, min: 30, words: 6, chars: 34, width: 0.9 },
};

/** Fades a caption in and out over this, in seconds. */
const CAPTION_FADE = 0.15;

function Captions({ video, plan }: { video: Video; plan: SoundPlan }): JSX.Element | null {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const box = boxOf(width, height);
  const spec = CAPTION[box.format] ?? CAPTION.landscape;
  const now = captionAt(plan.lines, frame, fps, (text) => captionPages(text, spec.words, spec.chars));
  if (!now) return null;
  const line = plan.lines[now.lineIndex];
  const th = themeOf(video, line.index);
  const u = box.u;
  const ready = fontsReady(video);
  const rtl = isRtl(video.lang);
  const dir = dirOf(line.text, rtl ? 'rtl' : 'ltr');
  const face = th.body;
  const padX = 30 * u;
  const padY = 14 * u;
  const text = now.page.join(' ');
  const fit = fitText(text, {
    face,
    bold: true,
    maxSize: spec.size * u,
    minSize: spec.min * u,
    maxWidth: box.w * spec.width - 2 * padX,
    maxHeight: spec.size * u * face.leading * 2,
    maxLines: 2,
    ready,
  });

  // A panel that reads over any picture: dark glass on dark styles, light on light ones.
  const panel = th.dark ? 'rgba(8, 9, 14, 0.68)' : 'rgba(255, 255, 255, 0.9)';
  const ink = th.dark ? '#FFFFFF' : '#0C0C0E';
  const solid = th.dark ? '#08090E' : '#FFFFFF';
  const hot = contrast(th.accent, solid) >= 3 ? th.accent : ink;
  // Words still to come are there, faint, so the page never re-flows as they arrive.
  const unseen = th.dark ? 'rgba(255, 255, 255, 0.36)' : 'rgba(12, 12, 14, 0.34)';

  const t = (frame - line.start) / fps;
  const shownFor = Math.min(line.seconds + 0.5, (line.end - line.start) / fps);
  const opacity = Math.max(0, Math.min(1, t / CAPTION_FADE, (shownFor - t) / CAPTION_FADE));

  const lineStyle: CSSProperties = {
    fontFamily: face.family,
    fontWeight: face.strong,
    fontSize: fit.size,
    lineHeight: `${fit.size * face.leading}px`,
    whiteSpace: 'nowrap',
    textAlign: 'center',
    direction: dir,
  };
  let k = 0;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: box.bottom, display: 'flex', justifyContent: 'center', opacity }}>
      <div
        dir={dir}
        style={{
          direction: dir,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: `${padY}px ${padX}px`,
          borderRadius: Math.min(22 * u, th.radius > 0 ? 18 * u : 6 * u),
          backgroundColor: panel,
          maxWidth: box.w * spec.width,
        }}
      >
        {fit.lines.map((l, i) => (
          <div key={i} dir={dir} style={lineStyle}>
            {l.split(' ').map((w, j, all) => {
              const n = k++;
              const color = n >= now.shown ? unseen : n === now.shown - 1 ? hot : ink;
              return (
                <span key={j} style={{ color }}>{w}{j < all.length - 1 ? ' ' : ''}</span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── the layer ─────────────────────────────────────────────────────────────

/** The video's sound, and its narration as captions, on top of the scenes. */
export function VideoAudioLayer({ video }: { video: Video }): JSX.Element | null {
  const env = useRemotionEnvironment();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => soundPlan(video), [video.scenes, video.audio]);
  const captions = video.audio?.captions === true && plan.lines.length > 0;
  if (!audible(plan) && !captions) return null;
  return (
    <>
      {env.isRendering ? <RenderedSound plan={plan} /> : <PreviewSound plan={plan} />}
      {captions ? <Captions video={video} plan={plan} /> : null}
    </>
  );
}
