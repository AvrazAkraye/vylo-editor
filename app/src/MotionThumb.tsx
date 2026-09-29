import { useEffect, useLayoutEffect, useRef } from 'react';
import { stillTime } from './motionanim';
import { paint, preload } from './motiondraw';
import { FORMATS, type Layer, type Motion } from './motiontypes';
import type { ThumbProps } from './motionui';

/**
 * A graphic, small and live: the gallery's cards, a graphic's cover, the
 * banner's screen (MotionHome.tsx).
 *
 * It is the graphic itself rather than a picture of it: a canvas the studio's
 * own renderer paints into with the same `paint` the stage and the MP4 use, so
 * a card cannot drift from what its template makes.
 *
 * ## Still, or playing
 *
 * Still, it is one frame — the one `stillTime` picks, after the entrances have
 * landed and before anything leaves, because frame zero is the emptiest frame
 * there is. It is painted once the graphic's pictures are decoded and its
 * fonts are in (`preload`, then `document.fonts.ready`), so a card is never
 * seen in a stand-in typeface, and painted again whenever a font arrives late.
 *
 * Playing (`animate`), it runs a `requestAnimationFrame` loop of its own, not
 * the studio's clock (motionplay.ts): a card being pointed at must never move
 * the playhead of the graphic being edited. The loop measures real time,
 * draws at most thirty frames a second, and holds the last frame a moment
 * before it begins again, so there is a breath between the end and the start
 * — except for a graphic in which nothing arrives or leaves, a background,
 * which repeats without a seam and gets no pause. It stops while the canvas is
 * off screen or the window is hidden, and never runs when the person has asked
 * for less motion: then the still is all there is.
 *
 * ## Light
 *
 * Nothing is painted into a canvas that is not on screen, and stills are
 * painted a few at a time (`later`), so a gallery opening does not paint every
 * card in one long task. One observer watches every thumbnail.
 *
 * ## Never throws
 *
 * A graphic the renderer cannot draw leaves the canvas empty, and is not tried
 * again thirty times a second: a bad graphic is a blank card, not a broken
 * gallery.
 */

/** Backing pixels per CSS pixel, at most. A thumbnail is small, and a 3x canvas is more than twice the work of a 2x one. */
const MAX_DPR = 2;
/** Milliseconds between painted frames: thirty a second, whatever the display's rate. */
const FRAME_MS = 1000 / 30;
/** A display's frames are not exact: one this early for its slot counts as on time. */
const EARLY_MS = 2;
/** Seconds the last frame is held before the loop starts again. */
const HOLD = 0.6;
/** The longest gap between two animation frames that still counts as time passing, as motionplay.ts has it. */
const MAX_STEP = 0.25;
const REDUCE = '(prefers-reduced-motion: reduce)';

// ── one observer for every thumbnail ──────────────────────────────────────

const onScreen = new Map<Element, (seen: boolean) => void>();
let observer: IntersectionObserver | null = null;

/** Tell `seen` whenever `el` comes onto the screen or leaves it. Returns the way to stop. */
function watch(el: Element, seen: (on: boolean) => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    seen(true);
    return () => undefined;
  }
  observer ??= new IntersectionObserver((entries) => {
    for (const e of entries) onScreen.get(e.target)?.(e.isIntersecting);
  });
  onScreen.set(el, seen);
  observer.observe(el);
  return () => {
    onScreen.delete(el);
    observer?.unobserve(el);
  };
}

// ── stills, a few at a time ───────────────────────────────────────────────

const waiting: (() => void)[] = [];
let pumping = false;
let port: MessagePort | null = null;

/**
 * A task of its own for `pump`. A message rather than a timer: a page the
 * system has hidden or covered stretches timers to a second or more, and the
 * stills would come in one a second.
 */
function soon() {
  if (typeof MessageChannel === 'undefined') {
    setTimeout(pump, 0);
    return;
  }
  if (!port) {
    const channel = new MessageChannel();
    channel.port1.onmessage = pump;
    port = channel.port2;
  }
  port.postMessage(0);
}

/** Run `job` soon, with as many others as fit in a few milliseconds. Returns the way to take it back. */
function later(job: () => void): () => void {
  waiting.push(job);
  if (!pumping) {
    pumping = true;
    soon();
  }
  return () => {
    const i = waiting.indexOf(job);
    if (i >= 0) waiting.splice(i, 1);
  };
}

function pump() {
  const until = performance.now() + 10;
  try {
    while (waiting.length && performance.now() < until) waiting.shift()?.();
  } finally {
    if (waiting.length) soon();
    else pumping = false;
  }
}

// ── the graphic's own times ───────────────────────────────────────────────

const seconds = (doc: Motion) => (Number.isFinite(doc.seconds) && doc.seconds > 0 ? doc.seconds : 1);

/** The still's moment. */
function stillOf(doc: Motion): number {
  try {
    const t = stillTime(doc.layers, seconds(doc));
    return Number.isFinite(t) ? t : 0;
  } catch {
    return 0;
  }
}

/** The final frame's time: a layer that runs to the end is not drawn *at* the end. */
function lastOf(doc: Motion): number {
  const fps = Number.isFinite(doc.fps) && doc.fps > 0 ? doc.fps : 30;
  return Math.max(0, seconds(doc) - 1 / fps);
}

/**
 * Seconds to hold the last frame. None when the graphic's end is its
 * beginning — every layer there throughout, nothing arriving, leaving or
 * counting — because a pause there would be the only seam in the loop.
 */
function holdOf(doc: Motion): number {
  const settled = (l: Layer | null | undefined) => !l || l.hidden || (
    l.kind !== 'counter' && l.start <= 0 && l.end >= seconds(doc)
    && (!l.in || l.in.fx === 'none') && (!l.out || l.out.fx === 'none')
  );
  return Array.isArray(doc.layers) && doc.layers.every(settled) ? 0 : HOLD;
}

/**
 * Paint `doc` at `t` into `canvas`, `w` x `h` CSS pixels. False when the
 * renderer failed, and then the canvas is left empty.
 */
function drawFrame(canvas: HTMLCanvasElement, doc: Motion, t: number, w: number, h: number): boolean {
  const dpr = Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  // Resized here, just before the paint, rather than by React: a canvas is
  // cleared when its size is set, and here nothing can be shown in between.
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    paint(ctx, doc, t, { width: bw, height: bh, clear: true });
    return true;
  } catch {
    // Half a frame is not a picture of anything. Setting the width clears the
    // canvas and resets whatever state the renderer left behind.
    canvas.width = bw;
    return false;
  }
}

export function MotionThumb({ doc, width, animate = false }: ThumbProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const shape = FORMATS[doc.format] ?? FORMATS.landscape;
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = (w * shape.height) / shape.width;
  // What the loop reads without being restarted: whether to play, and the size to paint at.
  const want = useRef({ animate, w, h });
  // Set by the loop below: tell it `want` changed; `restart` plays from the top.
  const poke = useRef<((restart: boolean) => void) | null>(null);

  useLayoutEffect(() => {
    const was = want.current.animate;
    want.current = { animate, w, h };
    poke.current?.(animate && !was);
  }, [animate, w, h]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    let alive = true;
    let ready = false;
    let seen = false;
    let broken = false;
    /** What the canvas holds: nothing yet, the still, or a frame of the loop. */
    let shows: 'nothing' | 'still' | 'frame' = 'nothing';
    let painted = { w: 0, h: 0 };
    let queued: (() => void) | null = null;
    const media = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCE) : null;
    let reduce = media?.matches ?? false;
    const still = stillOf(doc);
    const end = lastOf(doc);
    const period = seconds(doc) + holdOf(doc);
    let raf = 0;
    let clock = 0;
    let last = 0;
    /** The 30 Hz slot the last frame was painted in, or -1 before the first. */
    let slot = -1;

    const draw = (t: number) => {
      const size = want.current;
      if (!size.w) return;
      painted = { w: size.w, h: size.h };
      if (!drawFrame(canvas, doc, t, size.w, size.h)) broken = true;
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // Real time, so a dropped frame never slows the graphic; a long gap is
      // the window coming back, and counts as none.
      if (last) clock += Math.min(MAX_STEP, Math.max(0, now - last) / 1000);
      last = now;
      // Painted on a 30 Hz grid rather than 33 ms after the last paint, so
      // uneven frames can never add up to more than thirty a second.
      if (slot >= 0 && now - slot < FRAME_MS - EARLY_MS) return;
      slot = slot < 0 ? now : slot + FRAME_MS * Math.max(1, Math.floor((now - slot + EARLY_MS) / FRAME_MS));
      draw(Math.min(clock % period, end));
      shows = 'frame';
      if (broken) stop();
    };
    const sync = () => {
      if (!alive || !ready || broken) return;
      const plays = want.current.animate && !reduce;
      if (plays && seen && !document.hidden && want.current.w) {
        queued?.();
        queued = null;
        if (!raf) {
          slot = -1;
          raf = requestAnimationFrame(tick);
        }
        return;
      }
      stop();
      // Nothing is painted off screen; a loop scrolled away or hidden keeps
      // the frame it was on, to carry on from when it is back.
      if (!seen || (plays && shows !== 'nothing') || shows === 'still' || queued) return;
      queued = later(() => {
        queued = null;
        if (!alive || broken) return;
        draw(still);
        shows = 'still';
      });
    };
    const onReduce = () => {
      reduce = media?.matches ?? false;
      sync();
    };
    // A font that arrives after the still was painted: paint it again, in the right face.
    const onFonts = () => {
      if (shows === 'still') shows = 'nothing';
      sync();
    };

    poke.current = (restart) => {
      if (restart) clock = 0;
      const size = want.current;
      if (shows === 'still' && (size.w !== painted.w || size.h !== painted.h)) shows = 'nothing';
      sync();
    };
    const unwatch = watch(canvas, (on) => {
      seen = on;
      sync();
    });
    document.addEventListener('visibilitychange', sync);
    media?.addEventListener?.('change', onReduce);
    const fonts = typeof document.fonts === 'object' ? document.fonts : null;
    fonts?.addEventListener?.('loadingdone', onFonts);
    void (async () => {
      try {
        await preload(doc);
      } catch {
        // Drawn without whatever did not load.
      }
      try {
        await fonts?.ready;
      } catch {
        // The same.
      }
      if (!alive) return;
      ready = true;
      sync();
    })();

    return () => {
      alive = false;
      stop();
      queued?.();
      unwatch();
      document.removeEventListener('visibilitychange', sync);
      media?.removeEventListener?.('change', onReduce);
      fonts?.removeEventListener?.('loadingdone', onFonts);
      poke.current = null;
    };
  }, [doc]);

  return <canvas ref={ref} className="mo-thumb" style={{ width: w, height: h }} aria-hidden="true" />;
}
