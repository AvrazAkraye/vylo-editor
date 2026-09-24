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
 */

import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { AbsoluteFill, Easing, useDelayRender, useVideoConfig } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import type { TransitionPresentation, TransitionPresentationComponentProps } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { Thumbnail } from '@remotion/player';
import { FORMATS, FPS } from './videotypes';
import type { Scene, Transition, Video } from './videotypes';
import { TRANSITION_FRAMES, durationInFrames, isRtl, sceneFrames } from './video';
import { SWATCHES, boxOf, fontKeyOf, fontsReady, loadFonts, themeOf } from './videotheme';
import { SceneBody } from './videoscenekinds';
import type { SceneInfo } from './videoscenebits';

/** Background, text and accent of each style, for the panel's style picker. */
export const STYLE_SWATCH = SWATCHES;

/** Resolves when the style's fonts for the video's script are loaded (the export waits for this). */
export function loadVideoFonts(v: Pick<Video, 'lang' | 'style'>): Promise<void> {
  return loadFonts(v);
}

/**
 * Loads the fonts and re-renders once they are ready; holds the web
 * renderer's frame until then, so no frame is drawn in a fallback face.
 */
function useVideoFonts(v: Pick<Video, 'lang' | 'style'>): boolean {
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

function infoFor(v: Video, index: number, width: number, height: number, starts: number[], total: number, ready: boolean): SceneInfo {
  const scene = v.scenes[index];
  return {
    video: v,
    theme: themeOf(v, index),
    box: boxOf(width, height),
    frames: scene ? sceneFrames(scene) : FPS,
    index,
    count: v.scenes.length,
    start: starts[index] ?? 0,
    total,
    ready,
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
    </AbsoluteFill>
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
