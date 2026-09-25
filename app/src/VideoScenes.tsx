/**
 * The Remotion composition that draws a `Video`: the scenes in order, joined
 * by transitions, in the video's style, language and frame shape.
 *
 * The storyboard is data the model wrote and `video.ts` repaired; everything
 * that turns it into pictures is here and in the files this one uses —
 * `videotheme.ts` (the six styles, fonts, colour and text fitting),
 * `videoscenebits.tsx` (motion, text reveals, backgrounds, pictures) and
 * `videoscenekinds.tsx` (one layout per scene kind). Nothing the model wrote
 * is ever run.
 *
 * The same component is shown by `@remotion/player` in the panel and rendered
 * to MP4 by `@remotion/web-renderer`, which paints the DOM onto a canvas with
 * its own subset of CSS — see videoscenebits.tsx for the rules this keeps.
 *
 * The video's look (videolook.ts) is applied per scene here: each scene gets
 * its effective look, its theme with the scene's colours over the video's,
 * its clock at the look's pace, and a box that keeps clear of the corner
 * mark and of the brand a scene asked to show.
 */

import { useEffect, useMemo, useState } from 'react';
import { VideoAudioLayer } from './videoaudio';
import type React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, useCurrentFrame, useDelayRender, useVideoConfig } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import type { TransitionPresentation, TransitionPresentationComponentProps } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { Thumbnail } from '@remotion/player';
import { FORMATS, FPS } from './videotypes';
import type { Scene, Transition, Video } from './videotypes';
import { TRANSITION_FRAMES, durationInFrames, isRtl, sceneFrames } from './video';
import { SWATCHES, alpha, boxOf, fontKeyOf, fontsReady, loadFonts, numeralsOf, sceneTheme, themeOf } from './videotheme';
import type { Theme } from './videotheme';
import { SceneBody } from './videoscenemore';
import { watermarkOn, watermarkSpot } from './videoscenebits';
import type { SceneInfo } from './videoscenebits';
import { lookFor } from './videolook';

/** Background, text and accent of each style, for the panel's style picker. */
export const STYLE_SWATCH = SWATCHES;

/**
 * Resolves when the video's fonts for its script are loaded — its style's
 * pair, or the one its `look.font` chose (the export waits for this).
 */
export function loadVideoFonts(v: Pick<Video, 'lang' | 'style' | 'look'>): Promise<void> {
  return loadFonts(v);
}

/**
 * Loads the fonts and re-renders once they are ready; holds the web
 * renderer's frame until then, so no frame is drawn in a fallback face.
 */
function useVideoFonts(v: Pick<Video, 'lang' | 'style' | 'look'>): boolean {
  const key = fontKeyOf(v);
  const [readyKey, setReadyKey] = useState<string | null>(() => (fontsReady(v) ? key : null));
  const { delayRender, continueRender } = useDelayRender();
  const ready = readyKey === key || fontsReady(v);
  useEffect(() => {
    if (fontsReady(v)) {
      setReadyKey(key);
      return;
    }
    let live = true;
    const handle = delayRender(`Loading the video's fonts (${key})`, { timeoutInMilliseconds: 60000 });
    loadFonts(v).then(
      () => {
        if (live) setReadyKey(key);
        continueRender(handle);
      },
      () => continueRender(handle), // a missing font falls back rather than failing the render
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ready;
}

// ---------------------------------------------------------------------------
// Transitions

/** A gentle push in: the new scene grows from slightly small, the old one grows past and fades. */
function ZoomPresentation({ children, presentationDirection, presentationProgress }: TransitionPresentationComponentProps<Record<string, unknown>>) {
  const p = presentationProgress;
  const entering = presentationDirection === 'entering';
  const style: React.CSSProperties = entering
    ? { opacity: Math.min(1, p * 1.6), transform: `scale(${0.86 + 0.14 * p})` }
    : { opacity: 1 - p, transform: `scale(${1 + 0.12 * p})` };
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
}

const zoom = (): TransitionPresentation<Record<string, unknown>> => ({ component: ZoomPresentation, props: {} });

function presentationOf(t: Transition, rtl: boolean): TransitionPresentation<Record<string, unknown>> {
  // Things move the way the language reads: a new scene comes from the end side.
  switch (t) {
    case 'slide':
      return slide({ direction: rtl ? 'from-left' : 'from-right' }) as TransitionPresentation<Record<string, unknown>>;
    case 'wipe':
      return wipe({ direction: rtl ? 'from-left' : 'from-right' }) as TransitionPresentation<Record<string, unknown>>;
    case 'zoom':
      return zoom();
    default:
      return fade({ shouldFadeOutExitingScene: true }) as TransitionPresentation<Record<string, unknown>>;
  }
}

const timing = linearTiming({ durationInFrames: TRANSITION_FRAMES, easing: Easing.bezier(0.65, 0, 0.35, 1) });

// ---------------------------------------------------------------------------
// The film

/** Where each scene starts in the film, allowing for the overlap of transitions. */
function startsOf(scenes: Scene[]): number[] {
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
 * Kinds that place the brand themselves when a scene's look asks for it: the
 * three that always show it, and the two whose words sit beside or over
 * pictures (a picture scene with its picture does too, with its caption).
 */
const OWN_MARK = new Set<Scene['kind']>(['title', 'logo', 'outro', 'split', 'gallery']);

/** The brand's height in the band above a scene that asked for it, per format, in units, before `logoScale`. */
const MARK_BAND = { landscape: 64, portrait: 76, square: 60 } as const;

function infoFor(v: Video, index: number, width: number, height: number, starts: number[], total: number, ready: boolean): SceneInfo {
  const scene = v.scenes[index];
  const look = lookFor(v, scene);
  let box = boxOf(width, height);
  // Scenes under the corner mark keep a band clear for it: always in a vertical frame, and in the
  // others as far as a larger mark reaches past the margin.
  if (scene && !showsBrand(v, scene) && watermarkOn(v)) {
    const spot = watermarkSpot(v, box);
    if (spot.band > 0) {
      box = spot.edge === 'top'
        ? { ...box, top: box.top + spot.band, h: box.h - spot.band }
        : { ...box, bottom: box.bottom + spot.band, h: box.h - spot.band };
    }
  }
  // The brand at the head of a scene that asked for it, where the kind has no place of its own for it.
  let mark: SceneInfo['mark'] = null;
  const brand = !!(v.brand?.logo || v.brand?.name?.trim());
  const ownPlace = !scene || OWN_MARK.has(scene.kind) || (scene.kind === 'image' && !!scene.picture?.src) || (scene.kind === 'qr' && !!v.brand?.logo);
  if (look.logo === true && brand && !ownPlace) {
    const h = Math.min(MARK_BAND[box.format] * box.u * look.logoScale, box.h * 0.2);
    const gap = 36 * box.u;
    mark = { top: box.top, height: h };
    box = { ...box, top: box.top + h + gap, h: box.h - h - gap };
  }
  return {
    video: v,
    theme: sceneTheme(v, index),
    box,
    // The scene's own clock: its frames at the look's pace (videoscenebits.tsx `useSceneFrame`).
    frames: (scene ? sceneFrames(scene) : FPS) * look.motion,
    index,
    count: v.scenes.length,
    start: starts[index] ?? 0,
    total,
    ready,
    digits: numeralsOf(v),
    look,
    mark,
  };
}

/** The whole film at the video's frame size. */
export function VideoComposition({ video }: { video: Video }): JSX.Element {
  const { width, height } = useVideoConfig();
  const ready = useVideoFonts(video);
  const rtl = isRtl(video.lang);
  const starts = useMemo(() => startsOf(video.scenes), [video.scenes]);
  const total = durationInFrames(video);
  const base = themeOf(video, 0, false);
  if (!video.scenes.length) {
    return <AbsoluteFill style={{ background: `linear-gradient(160deg, ${base.bg} 0%, ${base.bg2} 100%)` }} />;
  }
  const items: JSX.Element[] = [];
  video.scenes.forEach((s, i) => {
    items.push(
      <TransitionSeries.Sequence key={s.id} durationInFrames={sceneFrames(s)}>
        <SceneBody info={infoFor(video, i, width, height, starts, total, ready)} />
      </TransitionSeries.Sequence>,
    );
    if (i < video.scenes.length - 1 && s.transition !== 'none') {
      items.push(<TransitionSeries.Transition key={`${s.id}-t`} timing={timing} presentation={presentationOf(s.transition, rtl)} />);
    }
  });
  return (
    <AbsoluteFill style={{ background: base.bg }}>
      <TransitionSeries>{items}</TransitionSeries>
      <Watermark video={video} starts={starts} />
      <StoryProgress video={video} starts={starts} />
      <VideoAudioLayer video={video} />
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// Over the whole film: the story bar and the watermark

/**
 * How much of scene `i` is on screen at `frame`, 0 to 1: all of it inside
 * the scene, fading across the transition that brings it in and the one that
 * takes it out. The film's overlays weigh themselves by it, so they change
 * with the scenes and never jump at a cut.
 */
function presence(video: Video, starts: number[], i: number, frame: number): number {
  const s = video.scenes[i];
  if (!s) return 0;
  const from = starts[i] ?? 0;
  const to = from + sceneFrames(s);
  if (frame < from || frame >= to) return 0;
  const prev = video.scenes[i - 1];
  const fadeIn = i > 0 && prev && prev.transition !== 'none' ? Math.min(1, (frame - from) / TRANSITION_FRAMES) : 1;
  const next = video.scenes[i + 1];
  const outFrom = to - TRANSITION_FRAMES;
  const fadeOut = next && s.transition !== 'none' && frame >= outFrom ? 1 - (frame - outFrom) / TRANSITION_FRAMES : 1;
  return Math.max(0, Math.min(fadeIn, fadeOut));
}

/**
 * A vertical video's story bar: one thin segment a scene along the top,
 * filling as the scene plays, the way a phone shows a story — drawn in the
 * style's own manner (a gold hairline for elegant, a glowing one for neon,
 * square blocks for bold) and kept just above the band where words start.
 * Wide and square videos have none.
 */
function StoryProgress({ video, starts }: { video: Video; starts: number[] }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const box = boxOf(width, height);
  const n = video.scenes.length;
  if (box.format !== 'portrait' || n < 2) return null;
  const th = themeOf(video, 0, false);
  const u = box.u;
  const total = durationInFrames(video);
  const segs = n <= 12 ? n : 1;
  const gap = segs > 1 ? (th.style === 'bold' ? 10 : 8) * u : 0;
  const bar = (th.style === 'elegant' || th.style === 'minimal' ? 3 : th.style === 'bold' ? 8 : 6) * u;
  const w = (box.w - gap * (segs - 1)) / segs;
  const top = box.top - 64 * u;
  const track = th.style === 'bold' ? alpha(th.fg, 0.18) : alpha(th.fg, th.dark ? 0.2 : 0.14);
  const fillColor = th.style === 'modern' ? th.fg : th.style === 'minimal' ? th.fg : th.accent;
  const round = th.style === 'bold' || th.style === 'minimal' ? 0 : bar / 2;
  // In with the film, out with the close's own fade.
  const shown = Math.min(1, frame / 12) * (1 - Math.max(0, Math.min(1, (frame - (total - 14)) / 12)));
  const fillOf = (i: number): number => {
    if (segs === 1) return Math.min(1, frame / Math.max(1, total - 1));
    const s = video.scenes[i];
    const from = starts[i] ?? 0;
    const len = sceneFrames(s) - (i < n - 1 && s.transition !== 'none' ? TRANSITION_FRAMES : 0);
    return Math.max(0, Math.min(1, (frame - from) / Math.max(1, len)));
  };
  return (
    <div style={{ position: 'absolute', left: box.x, top, width: box.w, height: bar, display: 'flex', flexDirection: th.rtl ? 'row-reverse' : 'row', gap, opacity: shown }}>
      {Array.from({ length: segs }, (_, i) => {
        const f = fillOf(i);
        return (
          <div key={i} style={{ position: 'relative', width: w, height: bar, borderRadius: round, background: track, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', [th.rtl ? 'right' : 'left']: 0, top: 0, width: w * f, height: bar, borderRadius: round, background: fillColor, boxShadow: th.style === 'neon' && f > 0 ? `0 0 ${10 * u}px ${th.accent}` : undefined }} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Scenes the watermark steps aside for: the ones that show the brand large
 * already, and the montage, whose pictures run to the frame's edge.
 */
const SHOWS_BRAND = new Set<Scene['kind']>(['title', 'logo', 'outro', 'gallery']);

/** Whether a scene shows the brand itself — by its kind, or because its look asks for it — so the corner mark steps aside. */
function showsBrand(v: Video, s: Scene): boolean {
  return SHOWS_BRAND.has(s.kind) || lookFor(v, s).logo === true;
}

/** Scenes whose whole frame is a picture, where the mark is always light. */
function onPicture(s: Scene | undefined): boolean {
  if (!s) return false;
  if (s.kind === 'image' || s.kind === 'title') return !!s.picture?.src;
  return s.kind === 'gallery';
}

/**
 * The brand, small, in the top corner on the end side — its logo, or its
 * name as a quiet wordmark — on every scene that does not already show it.
 * It fades out for the title, the logo reveal and the close, and back in
 * after them, across the same transitions the scenes take. Off when the
 * person turned it off (`video.watermark === false`).
 */
function Watermark({ video, starts }: { video: Video; starts: number[] }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  if (!watermarkOn(video)) return null;
  const box = boxOf(width, height);
  const th: Theme = themeOf(video, 0, false);
  const u = box.u;
  let weight = 0;
  let lead = -1;
  let best = 0;
  for (let i = 0; i < video.scenes.length; i++) {
    const p = presence(video, starts, i, frame);
    if (p <= 0) continue;
    if (!showsBrand(video, video.scenes[i])) weight += p;
    if (p > best) { best = p; lead = i; }
  }
  // Settles in over a few frames after its first appearance, like the rest of the film.
  const opacity = Math.min(1, weight) * interpolate(frame, [0, 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (opacity <= 0.001) return null;
  const leadScene = video.scenes[lead];
  // Ink for the scene under it: bold's accent scenes and a scene with its own background have their own.
  const leadTh = sceneTheme(video, lead);
  const own = leadTh.inverted || leadTh.groundSet;
  const light = onPicture(leadScene) || (leadTh.groundSet ? leadTh.dark : th.dark || leadTh.inverted);
  const ink = onPicture(leadScene) ? '#FFFFFF' : own ? leadTh.fg : th.fg;
  const logo = video.brand?.logo;
  const name = video.brand?.name?.trim() ?? '';
  // The corner and size the look chose; the style's own spot and size otherwise.
  const spot = watermarkSpot(video, box);
  const h = spot.height;
  const k = h / ((box.format === 'landscape' ? 50 : box.format === 'portrait' ? 60 : 46) * u);
  const place: React.CSSProperties = { position: 'absolute', top: spot.top, [spot.right ? 'right' : 'left']: spot.side, height: h, display: 'flex', alignItems: 'center', opacity: opacity * (light ? 0.92 : 0.85) };
  if (logo) {
    return (
      <div style={place}>
        <Img src={logo} style={{ height: h, width: 'auto', maxWidth: 260 * u * k, objectFit: 'contain' }} />
      </div>
    );
  }
  const size = (box.format === 'landscape' ? 24 : 26) * u * k;
  const latin = !/[\u0600-\u06FF]/.test(name);
  return (
    <div style={{ ...place, gap: 12 * u * k, flexDirection: 'row', direction: th.rtl ? 'rtl' : 'ltr' }}>
      <div style={{ width: 10 * u * k, height: 10 * u * k, borderRadius: th.radius ? '50%' : 0, background: onPicture(leadScene) ? '#FFFFFF' : th.accent }} />
      <div style={{ fontFamily: th.body.family, fontWeight: th.body.strong, fontSize: size, lineHeight: `${size * 1.3}px`, color: ink, whiteSpace: 'nowrap', letterSpacing: latin ? '0.14em' : undefined, textTransform: latin ? 'uppercase' : undefined, direction: latin ? 'ltr' : 'rtl', textShadow: onPicture(leadScene) ? `0 ${u}px ${8 * u}px rgba(0, 0, 0, 0.5)` : undefined }}>{name}</div>
    </div>
  );
}

const VideoFilm: React.FC<{ video: Video }> = VideoComposition;

/** What `<Player>` and `renderMediaOnWeb()` need to show or render a video. */
export function compositionOf(v: Video): {
  id: string;
  component: React.FC<{ video: Video }>;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  inputProps: { video: Video };
} {
  const size = FORMATS[v.format] ?? FORMATS.landscape;
  return {
    id: `vylo-video-${String(v.id).replace(/[^a-zA-Z0-9-]/g, '') || 'film'}`,
    component: VideoFilm,
    durationInFrames: durationInFrames(v),
    fps: FPS,
    width: size.width,
    height: size.height,
    inputProps: { video: v },
  };
}

// ---------------------------------------------------------------------------
// One scene, for the storyboard

/** One scene alone, as its own little composition. */
function SingleScene({ video, index }: { video: Video; index: number }): JSX.Element {
  const { width, height } = useVideoConfig();
  const ready = useVideoFonts(video);
  const starts = useMemo(() => startsOf(video.scenes), [video.scenes]);
  const total = durationInFrames(video);
  return <SceneBody info={infoFor(video, index, width, height, starts, total, ready)} />;
}

const SingleSceneFC: React.FC<{ video: Video; index: number }> = SingleScene;

/** A still of one scene — its middle frame — sized to the width it is given. */
export function SceneThumb({ scene, video }: { scene: Scene; video: Video }): JSX.Element {
  const size = FORMATS[video.format] ?? FORMATS.landscape;
  const found = video.scenes.findIndex((s) => s.id === scene.id);
  // A scene not (yet) in the video is drawn as if it were the first.
  const v = found >= 0 ? video : { ...video, scenes: [scene, ...video.scenes] };
  const index = found >= 0 ? found : 0;
  const frames = sceneFrames(scene);
  const inputProps = useMemo(() => ({ video: v, index }), [v, index]);
  // Remotion places its frame from the left; inside the app's right-to-left
  // layout it would be pushed out of its box. Each scene sets its own text
  // direction, so the frame itself is always laid out left to right.
  return (
    <div dir="ltr">
    <Thumbnail
      component={SingleSceneFC}
      inputProps={inputProps}
      compositionWidth={size.width}
      compositionHeight={size.height}
      durationInFrames={frames}
      fps={FPS}
      frameToDisplay={Math.floor(frames / 2)}
      style={{ width: '100%', aspectRatio: `${size.width} / ${size.height}` }}
    />
    </div>
  );
}
