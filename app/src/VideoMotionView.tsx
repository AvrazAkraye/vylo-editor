/**
 * A graphic from the Motion studio inside the film: a scene that is the
 * graphic (`MotionSceneView`), and a graphic laid on top of any scene
 * (`MotionOverlay`). videoscenemore.tsx `SceneBody` draws both; videomotion.ts
 * holds the rules (which graphic, at which of its moments).
 *
 * ## Motion's own picture, not a copy of it
 *
 * The graphic is painted by Motion's own renderer — `paint(ctx, doc, t)`, the
 * call its stage, its gallery cards and its MP4 make — onto a `<canvas>` here,
 * so the film shows exactly what the person made, at the film's frame: Motion
 * lays everything out in `u` (1% of the short side) from pins, so a portrait
 * graphic in a landscape film is placed by the same rules and never stretched.
 *
 * ## Why a canvas reaches the file
 *
 * The preview is `@remotion/player`, which shows this DOM; the export is
 * `@remotion/web-renderer`, which walks the DOM after every frame and draws
 * each element onto its own canvas — a `<canvas>` element with `drawImage`,
 * as it draws the clip scene's video frames (`@remotion/media` decodes onto a
 * canvas). It sets each frame with `flushSync`, so React has committed — and
 * this file's `useLayoutEffect` has painted — before it looks; and it waits
 * for every `delayRender` before it does. So the canvas is painted
 * synchronously in `useLayoutEffect` on every frame, and the first frame is
 * held (`useDelayRender`) until the graphic's pictures are decoded and its
 * faces loaded (`preload`), then painted once more before it is let go. The
 * app's own WebKit export was checked frame by frame (docs/vm/video.md).
 *
 * The canvas is never 0 × 0 when it is drawn (`drawImage` of an empty canvas
 * throws in the renderer): its size is set in the same effect, just before
 * the paint, as Motion's own thumbnails do. Its backing store is the size it
 * is shown at times the pixel density — the export's scale (`usePixelDensity`
 * is the renderer's `scale`: a 4K export paints at 4K), the screen's in the
 * player — so a storyboard of small cards does not paint full frames.
 *
 * Unlike Motion's thumbnails it paints whether or not it is on screen: the
 * export's page is hidden by design.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import { AbsoluteFill, useCurrentFrame, useDelayRender, usePixelDensity, useVideoConfig } from 'remotion';
import { paint, preload } from './motiondraw';
import type { Motion } from './motiontypes';
import type { MotionScene, Scene, Video } from './videotypes';
import { heldDoc, heldIn, overTime, sceneTime } from './videomotion';
import { Backdrop, useScene } from './videoscenebits';

/** The least a backing store is drawn at, as a share of the film's frame: a thumbnail a few dozen pixels wide still reads. */
const MIN_SCALE = 0.1;

/**
 * Paint `doc` at `t` into `canvas`, its backing store `w` × `h`; `t` null
 * clears it. A frame the renderer cannot draw leaves the canvas cleared — a
 * graphic that fails is a blank layer, never a broken film.
 */
function drawInto(canvas: HTMLCanvasElement, doc: Motion, t: number | null, w: number, h: number): void {
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (t === null) {
    ctx.clearRect(0, 0, w, h);
    return;
  }
  try {
    paint(ctx, doc, t, { width: w, height: h, clear: true });
  } catch {
    // Setting the width clears the canvas and whatever state the renderer left behind.
    canvas.width = w;
  }
}

/**
 * One graphic on a canvas the size of the film's frame, at `t` seconds into
 * it (`null`: nothing, for an overlay that is not on yet). Holds the
 * renderer's frame until the graphic is ready to be drawn.
 */
function GraphicCanvas({ doc, t }: { doc: Motion; t: number | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { width, height } = useVideoConfig();
  const density = usePixelDensity();
  const { delayRender, continueRender } = useDelayRender();
  // What the latest render asked for, for the paint that follows the graphic becoming ready.
  const now = useRef({ doc, t });
  now.current = { doc, t };

  const draw = () => {
    const canvas = ref.current;
    if (!canvas) return;
    const d = Number.isFinite(density) && density > 0 ? density : 1;
    // Shown size over the frame's: 1 in the export's page, a fraction inside the player's scaled frame.
    const shown = canvas.getBoundingClientRect().width;
    const share = shown > 0 && width > 0 ? Math.min(1, Math.max(MIN_SCALE, shown / width)) : 1;
    const k = share * d;
    drawInto(canvas, now.current.doc, now.current.t, Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k)));
  };

  // Every frame, before the renderer or the screen sees it.
  useLayoutEffect(draw);

  // Pictures decoded and faces loaded before the first frame counts; painted again then, before the frame is let go.
  useEffect(() => {
    let live = true;
    let held = true;
    const handle = delayRender('Loading a graphic from Motion', { timeoutInMilliseconds: 60000 });
    const release = () => {
      if (!held) return;
      held = false;
      continueRender(handle);
    };
    preload(doc).catch(() => undefined).then(() => {
      if (live) draw();
      release();
    });
    return () => {
      live = false;
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  return <canvas ref={ref} style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} />;
}

/**
 * A scene that is a graphic: the graphic across the frame, on its own clock
 * from the scene's start (videomotion.ts `sceneTime`: held at its last frame
 * past its end, or played again with Repeat). A see-through graphic is laid
 * over the film's own background; one the film no longer holds shows that
 * background alone, as a clip scene without its clip does.
 */
export function MotionSceneView({ scene }: { scene: MotionScene }) {
  const { video } = useScene();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const doc = heldDoc(heldIn(video, scene.motion));
  return (
    <AbsoluteFill>
      {!doc || doc.backdrop === null ? <Backdrop shape={false} /> : null}
      {doc ? <GraphicCanvas doc={doc} t={sceneTime(frame, fps, doc, scene.loop === true)} /> : null}
    </AbsoluteFill>
  );
}

/**
 * A graphic on top of a scene — a lower third over a clip — from `over.at`
 * seconds into the scene, once (videomotion.ts `overTime`). Drawn after the
 * scene's body and outside its camera, so it sits still on the frame as
 * Motion placed it. Mounted for the whole scene, so its pictures and faces
 * are loaded before it starts.
 */
export function MotionOverlay({ scene, video }: { scene: Scene; video: Video }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const over = scene.kind === 'motion' ? undefined : scene.over;
  const doc = over ? heldDoc(heldIn(video, over.motion)) : null;
  if (!over || !doc) return null;
  return (
    <AbsoluteFill>
      <GraphicCanvas doc={doc} t={overTime(frame, fps, over.at, doc, scene.seconds)} />
    </AbsoluteFill>
  );
}
