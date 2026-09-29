import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from './Icon';
import { fill } from './i18n';
import { hitTest, layerBox, makeEnv, paint, preload } from './motiondraw';
import { fontsNeeded } from './motionfonts';
import { SPEEDS, bind, lastFrame, pause, read, seek, setBlur, setLoop, setSpeed, step, toggle, usePlay } from './motionplay';
import { FORMATS, LIMITS, frameCount, isRtlLang, type Layer, type Motion } from './motiontypes';
import { layerOf, type StageProps } from './motionui';

/**
 * The stage: the open graphic, large, exactly as it will be exported, and the
 * transport bar under it.
 *
 * ## One picture, drawn by the engine
 *
 * The frame is `motiondraw.ts`'s `paint` at the playback clock's time
 * (`motionplay.ts`), into a canvas whose own pixels are the CSS box times the
 * screen's density — at most 2, never more than the graphic's own size, and
 * in steps, so dragging a window edge does not reallocate the canvas on every
 * frame of the drag. Nothing here draws the graphic itself: the selection
 * outline, the safe-area guide and the transparency checkerboard are DOM and
 * CSS around and over the canvas, so the canvas holds only what an export
 * would.
 *
 * This is the one component that repaints with the clock. The panel around it
 * never re-renders to move the playhead (see motionplay.ts), and nothing here
 * allocates per frame beyond what `paint` needs: the options object is reused
 * and the outline is placed by writing a style, not by rendering again.
 *
 * ## Fonts before the first frame
 *
 * A frame drawn in the fallback face and then re-laid in the right one is a
 * preview that jumps, and an Arabic line that fits in one face may not in the
 * other. So `preload` runs before the first frame of each graphic, keyed on
 * the fonts and pictures it uses rather than on every edit, and the frame is
 * drawn again when it resolves.
 *
 * ## Moving a layer
 *
 * Click the canvas to choose the top-most layer under the pointer; drag to
 * move it. A drag reports its offsets as it goes (`commit` false) and once on
 * release (`commit` true), so the panel keeps one undo step; Escape puts the
 * layer back and reports that too, so the step it leaves is no change at all.
 * Offsets are the document's: `x` toward the graphic's end and `y` down, in u,
 * so a drag to the right in an Arabic graphic is a negative `x`. The arrow
 * keys nudge the chosen layer the same way, and a burst of them is one step.
 *
 * ## Time runs left to right
 *
 * The transport bar is `dir="ltr"` in every language, like the Video
 * timeline and every editor people already use: a scrubber that ran right to
 * left would disagree with the timeline under it. Its words are translated;
 * its direction is not. The frame is `dir="ltr"` too, for a different reason:
 * the outline is placed in the canvas's own, physical, pixels.
 */

// ── the numbers the stage works in (pure; test/motionstage.test.mjs) ─────

export interface Offset {
  x: number;
  y: number;
}

/**
 * Seconds as the transport shows them, `m:ss.cc`. Cut to the hundredth rather
 * than rounded, so a playhead at 0.999 reads 0:00.99 and never shows a second
 * it has not reached; anything that is not a number reads as the start.
 */
export function timecode(seconds: number): string {
  const cs = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds * 100 + 1e-6) : 0;
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** The frame a time falls on: the scrubber's value. */
export function frameAt(seconds: number, fps: number): number {
  return Number.isFinite(seconds) && fps > 0 ? Math.max(0, Math.round(seconds * fps)) : 0;
}

/** The time a frame is drawn at: the scrubber's value, back to the clock. */
export function timeAt(frame: number, fps: number): number {
  return Number.isFinite(frame) && fps > 0 ? Math.max(0, Math.round(frame)) / fps : 0;
}

/**
 * CSS pixels on a frame drawn `w` x `h` CSS pixels, as u (1% of its short
 * side): `x` toward the graphic's end — so flipped when it reads right to
 * left — and `y` down.
 */
export function pxToU(dx: number, dy: number, w: number, h: number, rtl: boolean): Offset {
  const short = Math.min(w, h);
  if (!(short > 0)) return { x: 0, y: 0 };
  const u = 100 / short;
  return { x: dx * u * (rtl ? -1 : 1), y: dy * u };
}

/** An offset as it is kept: within the reach a reader allows, without float dust, never -0. */
function kept(v: number): number {
  const r = Math.round(Math.min(LIMITS.reach, Math.max(-LIMITS.reach, v)) * 1e4) / 1e4;
  return r === 0 ? 0 : r;
}

/** `from` moved by `by` u; an axis that did not move keeps its exact value. */
function moved(from: Offset, by: Offset): Offset {
  return { x: by.x ? kept(from.x + by.x) : from.x, y: by.y ? kept(from.y + by.y) : from.y };
}

/**
 * Where a drag puts a layer: its offsets at the press plus the pointer's
 * travel in u, in tenths of a u (finer than a pointer can place anything at
 * this size), held to its longer axis when `axis` (Shift) is down.
 */
export function dragTo(from: Offset, dx: number, dy: number, w: number, h: number, rtl: boolean, axis: boolean): Offset {
  const alongX = Math.abs(dx) >= Math.abs(dy);
  const d = pxToU(axis && !alongX ? 0 : dx, axis && alongX ? 0 : dy, w, h, rtl);
  return moved(from, { x: Math.round(d.x * 10) / 10, y: Math.round(d.y * 10) / 10 });
}

/** How far an arrow key moves a layer, in u: 1, 5 with Shift, a fifth with Alt. */
export function nudgeStep(shift: boolean, alt: boolean): number {
  return shift ? 5 : alt ? 0.2 : 1;
}

/**
 * A layer's offsets after an arrow key, or null for any other key. The arrows
 * follow the picture: → moves the layer right, which is toward the end of a
 * left-to-right graphic and toward the start of a right-to-left one.
 */
export function nudged(from: Offset, key: string, by: number, rtl: boolean): Offset | null {
  const right = key === 'ArrowRight' ? by : key === 'ArrowLeft' ? -by : 0;
  const down = key === 'ArrowDown' ? by : key === 'ArrowUp' ? -by : 0;
  if (!right && !down) return null;
  return moved(from, { x: rtl ? -right : right, y: down });
}

/** The largest box of the graphic's shape inside `w` x `h`, in whole CSS pixels. */
export function fitFrame(w: number, h: number, fw: number, fh: number): { width: number; height: number } {
  if (!(w > 0 && h > 0 && fw > 0 && fh > 0)) return { width: 0, height: 0 };
  const s = Math.min(w / fw, h / fh);
  // The side that fills the room comes out a hair short of it in floating point, and must not lose a pixel for it.
  return { width: Math.max(1, Math.floor(fw * s + 1e-6)), height: Math.max(1, Math.floor(fh * s + 1e-6)) };
}

/**
 * The canvas's own pixels for a frame `cssW` CSS pixels wide: that times the
 * screen's density (at most 2), never more than the graphic's own `fw` x `fh`.
 * The scale moves in steps of an eighth of an octave (about 9%), rounded up, so
 * the picture is never stretched up and a resize reallocates only when it
 * crosses a step. Both sides come from one scale, so the shape is kept.
 */
export function backingOf(cssW: number, fw: number, fh: number, dpr: number): { width: number; height: number } {
  const want = (Math.max(0, cssW) * Math.min(dpr > 0 ? dpr : 1, 2)) / fw;
  const scale = want >= 1 ? 1 : Math.pow(2, Math.ceil(Math.log2(Math.max(want, 1 / 256)) * 8 - 1e-9) / 8);
  return { width: Math.max(1, Math.round(fw * scale)), height: Math.max(1, Math.round(fh * scale)) };
}

// ── the stage ─────────────────────────────────────────────────────────────

/** A layer's box in canvas pixels, turned `rot` about (cx, cy), as `layerBox` gives it. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  cx: number;
  cy: number;
}

interface Drag {
  id: string;
  pointer: number;
  /** The press, in client pixels, and the size the frame was drawn at then. */
  x0: number;
  y0: number;
  w: number;
  h: number;
  rtl: boolean;
  from: Offset;
  at: Offset;
  /** The pointer's travel at the last move, so Shift pressed mid-drag can re-read the axis. */
  dx: number;
  dy: number;
  moved: boolean;
  raf: number;
}

interface Nudge {
  id: string;
  at: Offset;
  timer: number;
}

/** Motion blur in the preview: six paints a frame across half a frame's time. */
const BLUR = { samples: 6, shutter: 0.5 };

/** Pixels a press may wander and still be a click. */
const SLOP = 3;

/** A burst of arrow presses closer together than this is one undo step. */
const NUDGE_MS = 400;

/** A preload that has not answered by now is not waited for. */
const PRELOAD_CAP_MS = 3000;

/**
 * What Space presses rather than plays: a button — the transport's own, a
 * toggle, a layer's row, Download — a link, a tab, a choice. Pressing the
 * focused control with Space is how the keyboard works everywhere else, and on
 * a Mac with Keyboard navigation on it is the way a button is pressed. The
 * same rule as the Video timeline's (VideoTimeline.tsx).
 */
const PRESSED_BY_SPACE = 'button, a[href], summary, [role="button"], [role="menuitem"], [role="tab"], [role="radio"], [role="option"], [role="checkbox"], [role="switch"]';

/** What keeps the arrow keys, Home and End: a tab, a slider, a choice, a number. The chosen layer does not move under them. */
const OWNS_ARROWS = '[role="tab"], [role="slider"], [role="radio"], [role="option"], [role="menuitem"], [role="spinbutton"]';

/** Drawn on Icon.tsx's grid (24, a 1.5 stroke, round joins), for the two toggles it has no picture for. */
const GLYPHS = {
  // A ball, and the streaks a fast one leaves behind it.
  blur: 'M15.5 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM3 12h6.5M4.5 8.5h4.2M4.5 15.5h4.2',
  // The frame, the inset guide's corners, and the centre.
  safe: 'M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h14a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5zM7 9.8V8h1.8M17 9.8V8h-1.8M7 14.2V16h1.8M17 14.2V16h-1.8M12 10.6v2.8M10.6 12h2.8',
} as const;

function Glyph({ name }: { name: keyof typeof GLYPHS }) {
  return (
    <svg className="ic" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={GLYPHS[name]} />
    </svg>
  );
}

/** Whether a layer may be picked, dragged or nudged here. A backdrop fills the frame wherever it is put. */
function movable(l: Layer | undefined): l is Layer {
  return !!l && !l.locked && !l.hidden && l.kind !== 'backdrop';
}

/** The graphic as the pointer sees it: a locked layer is not there, so a click goes through it to what is under it. */
function pickable(m: Motion): Motion {
  return m.layers.some((l) => l.locked) ? { ...m, layers: m.layers.map((l) => (l.locked ? { ...l, hidden: true } : l)) } : m;
}

/** Whether a canvas point is on a box, turned as the layer is, give or take `pad` pixels. */
function onBox(b: Box, px: number, py: number, pad: number): boolean {
  const a = (-b.rot * Math.PI) / 180;
  const dx = px - b.cx;
  const dy = py - b.cy;
  const x = b.cx + dx * Math.cos(a) - dy * Math.sin(a);
  const y = b.cy + dx * Math.sin(a) + dy * Math.cos(a);
  return x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
}

/** A short, cheap fingerprint of a picture's data: its length and a few samples through it. */
function fingerprint(src: string): string {
  const s = typeof src === 'string' ? src : '';
  let out = String(s.length);
  for (let i = 1; i <= 8; i++) out += s.charAt(Math.floor((s.length * i) / 9) + 24);
  return out + s.slice(-12);
}

/**
 * What `preload` depends on: the fonts the words are set in and the pictures.
 * An edit to a word's colour, a layer's place or the length leaves it alone,
 * so the stage does not wait on fonts for those.
 */
function preloadKey(m: Motion): string {
  let pictures = '';
  for (const l of m.layers) if (l.kind === 'image') pictures += `|${l.id}:${fingerprint(l.src)}`;
  return `${fontsNeeded(m).join('\n')}${pictures}`;
}

/** The key pressed, read from the key's place when the layout puts a letter of another script there (the comma key is و on an Arabic keyboard). */
function keyOf(e: KeyboardEvent): string {
  const k = e.key;
  if (k.length === 1 && k.charCodeAt(0) > 127) {
    if (e.code === 'Comma') return ',';
    if (e.code === 'Period') return '.';
  }
  return k;
}

const complained = new Set<string>();

/** A paint that throws draws nothing; it is said once in the console, not sixty times a second. */
function complain(e: unknown) {
  const what = e instanceof Error ? e.message : String(e);
  if (complained.has(what) || complained.size > 20) return;
  complained.add(what);
  console.error('Motion: the frame could not be drawn:', e);
}

export function MotionStage(p: StageProps) {
  const { t, doc, selected, onSelect, compact = false } = p;
  const play = usePlay();
  const now = play.t;

  const root = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selRef = useRef<HTMLDivElement>(null);

  const [area, setArea] = useState({ w: 0, h: 0, vh: 800, dpr: 1 });
  const [loaded, setLoaded] = useState<string | null>(null);
  const [fonts, setFonts] = useState(0);
  const [shown, setShown] = useState(0);
  const [safe, setSafe] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [say, setSay] = useState('');

  // What the listeners registered once read: the latest props.
  const live = useRef(p);
  live.current = p;
  const drag = useRef<Drag | null>(null);
  const nudge = useRef<Nudge | null>(null);
  const box = useRef<Box | null>(null);
  const stale = useRef(false);
  const sayTimer = useRef(0);
  const opts = useRef({ width: 0, height: 0, clear: true, blur: undefined as typeof BLUR | undefined });

  const fmt = FORMATS[doc.format] ?? FORMATS.landscape;
  const rtl = isRtlLang(doc.lang);
  const ready = loaded === doc.id;
  // In the sidebar the column decides the width, and the height follows the
  // shape, held short enough that a tall graphic leaves room for the rest.
  // The margin left around the frame is where its focus ring and shadow go.
  const edge = compact ? 3 : 12;
  const room = compact ? Math.min(area.w * 1.25, Math.max(180, area.vh * 0.5)) : area.h;
  const css = fitFrame(area.w - 2 * edge, room - 2 * edge, fmt.width, fmt.height);
  const back = backingOf(css.width, fmt.width, fmt.height, area.dpr);

  // ── size ──
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const vh = window.innerHeight;
      const dpr = window.devicePixelRatio || 1;
      setArea((a) => (a.w === w && a.h === h && a.vh === vh && a.dpr === dpr ? a : { w, h, vh, dpr }));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // The density changes without the box changing when the window moves to another screen.
    window.addEventListener('resize', measure);
    measure();
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // ── the clock knows the graphic's length ──
  // Before the frame is drawn: a playhead left past the end of a shorter
  // graphic is brought back to it before anything is painted there.
  useLayoutEffect(() => {
    bind(doc.seconds, doc.fps);
  }, [doc.seconds, doc.fps]);

  // ── fonts and pictures, before the first frame ──
  const key = useMemo(() => preloadKey(doc), [doc.layers, doc.lang]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let on = true;
    const id = doc.id;
    const done = () => {
      if (!on) return;
      on = false;
      window.clearTimeout(cap);
      setLoaded(id);
      setFonts((n) => n + 1);
    };
    const cap = window.setTimeout(done, PRELOAD_CAP_MS);
    let wait: Promise<void>;
    try {
      wait = preload(doc);
    } catch {
      wait = Promise.resolve();
    }
    wait.then(done, done);
    return () => {
      on = false;
      window.clearTimeout(cap);
    };
  }, [key, doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── not drawn while nobody can see it ──
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden && stale.current) {
        stale.current = false;
        setShown((n) => n + 1);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // ── the frame, and the outline over it ──
  useLayoutEffect(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const sel = selRef.current;
    if (!ready) {
      ctx.clearRect(0, 0, c.width, c.height);
      box.current = null;
      if (sel) sel.hidden = true;
      return;
    }
    if (document.hidden) {
      stale.current = true;
      return;
    }
    const W = c.width;
    const H = c.height;
    const o = opts.current;
    o.width = W;
    o.height = H;
    o.blur = play.blur ? BLUR : undefined;
    try {
      paint(ctx, doc, now, o);
    } catch (e) {
      // Resizing the canvas to its own size clears it and resets the context,
      // unbalanced saves included, so the next frame starts clean.
      c.width = W;
      complain(e);
    }
    if (!sel) return;
    const layer = layerOf(doc, selected);
    let b: Box | null = null;
    if (layer && !layer.hidden) {
      try {
        b = layerBox(makeEnv(ctx, doc, now, W, H), layer);
      } catch {
        b = null;
      }
    }
    if (!b || !Number.isFinite(b.x + b.y + b.w + b.h + b.rot + b.cx + b.cy)) {
      box.current = null;
      sel.hidden = true;
      return;
    }
    box.current = b;
    const k = css.width / W;
    sel.hidden = false;
    sel.classList.toggle('mo-is-locked', !!layer?.locked);
    sel.style.width = `${Math.max(0, b.w * k)}px`;
    sel.style.height = `${Math.max(0, b.h * k)}px`;
    sel.style.transform = `translate(${b.cx * k}px,${b.cy * k}px) rotate(${b.rot}deg) translate(${(b.x - b.cx) * k}px,${(b.y - b.cy) * k}px)`;
  }, [ready, doc, now, play.blur, back.width, back.height, css.width, selected, fonts, shown]);

  // ── the live region: play and pause, said when they happen ──
  const was = useRef(play.playing);
  useEffect(() => {
    if (was.current === play.playing) return;
    was.current = play.playing;
    // A time still waiting to be said is older than this, and would contradict it.
    window.clearTimeout(sayTimer.current);
    setSay(play.playing ? t('Playing') : fill(t('Paused at {time}'), { time: timecode(read().t) }));
  }, [play.playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── a nudge burst ends as one step ──
  const flushNudge = () => {
    const n = nudge.current;
    if (!n) return;
    nudge.current = null;
    window.clearTimeout(n.timer);
    live.current.onMove(n.id, n.at.x, n.at.y, true);
  };

  // ── dragging ──
  const report = (d: Drag) => {
    if (d.raf) return;
    d.raf = requestAnimationFrame(() => {
      d.raf = 0;
      if (drag.current === d) live.current.onMove(d.id, d.at.x, d.at.y, false);
    });
  };
  /** Let go of a drag without reporting anything more. */
  const release = (d: Drag) => {
    if (drag.current === d) drag.current = null;
    if (d.raf) cancelAnimationFrame(d.raf);
    d.raf = 0;
    const f = frameRef.current;
    try {
      if (f?.hasPointerCapture(d.pointer)) f.releasePointerCapture(d.pointer);
    } catch {
      /* the pointer is already gone */
    }
    setDragging(false);
  };
  /** Put the layer back where it was and say so, so the panel's step ends as no change. */
  const cancelDrag = () => {
    const d = drag.current;
    if (!d) return;
    release(d);
    if (!d.moved) return;
    live.current.onMove(d.id, d.from.x, d.from.y, false);
    live.current.onMove(d.id, d.from.x, d.from.y, true);
  };

  /** A client point as canvas pixels, with the frame's CSS size. */
  const canvasPoint = (clientX: number, clientY: number) => {
    const c = canvasRef.current;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return null;
    return { px: ((clientX - r.left) * c.width) / r.width, py: ((clientY - r.top) * c.height) / r.height, w: r.width, h: r.height };
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (compact || e.button !== 0 || !ready || drag.current) return;
    const f = frameRef.current;
    const onFrame = !!f && f.contains(e.target as Node);
    if (!onFrame) {
      // The margin around the frame is the pasteboard: a click there chooses nothing.
      if (selected !== null) onSelect(null);
      return;
    }
    f?.focus({ preventScroll: true });
    const at = canvasPoint(e.clientX, e.clientY);
    const ctx = canvasRef.current?.getContext('2d');
    if (!at || !ctx) return;
    // The chosen layer keeps the pointer while it is under it, even beneath
    // another, so a layer chosen in the list can be dragged out from under.
    const current = layerOf(doc, selected);
    let id: string | null = null;
    if (movable(current) && box.current && onBox(box.current, at.px, at.py, 4)) {
      id = current.id;
    } else {
      try {
        id = hitTest(ctx, pickable(doc), read().t, at.px, at.py);
      } catch {
        id = null;
      }
    }
    const layer = layerOf(doc, id);
    if (!layer || layer.locked || layer.hidden) {
      if (selected !== null) onSelect(null);
      return;
    }
    if (layer.id !== selected) onSelect(layer.id);
    if (!movable(layer)) return;
    flushNudge();
    try {
      f?.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic or finished pointer cannot be captured; the drag still works inside the frame */
    }
    drag.current = {
      id: layer.id, pointer: e.pointerId, x0: e.clientX, y0: e.clientY, w: at.w, h: at.h, rtl,
      from: { x: layer.x, y: layer.y }, at: { x: layer.x, y: layer.y }, dx: 0, dy: 0, moved: false, raf: 0,
    };
  };

  const onMovePointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) {
      // Over the chosen layer the pointer says it can be moved.
      const f = frameRef.current;
      if (compact || !f) return;
      const at = box.current && movable(layerOf(doc, selected)) ? canvasPoint(e.clientX, e.clientY) : null;
      const over = !!at && !!box.current && onBox(box.current, at.px, at.py, 4);
      if (f.classList.contains('mo-is-over') !== over) f.classList.toggle('mo-is-over', over);
      return;
    }
    if (e.pointerId !== d.pointer) return;
    d.dx = e.clientX - d.x0;
    d.dy = e.clientY - d.y0;
    if (!d.moved) {
      if (Math.hypot(d.dx, d.dy) < SLOP) return;
      d.moved = true;
      setDragging(true);
    }
    d.at = dragTo(d.from, d.dx, d.dy, d.w, d.h, d.rtl, e.shiftKey);
    report(d);
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    release(d);
    if (!d.moved) return;
    d.at = dragTo(d.from, e.clientX - d.x0, e.clientY - d.y0, d.w, d.h, d.rtl, e.shiftKey);
    live.current.onMove(d.id, d.at.x, d.at.y, true);
  };

  const onLost = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Capture lost with the button still down (the window lost focus): keep where it got to.
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    release(d);
    if (d.moved) live.current.onMove(d.id, d.at.x, d.at.y, true);
  };

  // ── keys ──
  useEffect(() => {
    /** Escape and Shift during a drag, before anything else hears them: Escape must not close the window a drag is in. */
    const onDragKey = (e: KeyboardEvent) => {
      const d = drag.current;
      if (!d) return;
      if (e.type === 'keydown' && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelDrag();
      } else if (e.key === 'Shift' && d.moved) {
        d.at = dragTo(d.from, d.dx, d.dy, d.w, d.h, d.rtl, e.type === 'keydown');
        report(d);
      }
    };

    const sayTime = () => {
      window.clearTimeout(sayTimer.current);
      sayTimer.current = window.setTimeout(() => {
        const l = live.current;
        setSay(fill(l.t('{n} of {of}'), { n: timecode(read().t), of: timecode(l.doc.seconds) }));
      }, 450);
    };

    const ignored = (e: KeyboardEvent): boolean => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey) return true;
      const el = e.target instanceof Element ? e.target : null;
      const own = root.current;
      if (el) {
        if (el.closest('input, textarea, select, [role="switch"]')) return true;
        if (el instanceof HTMLElement && el.isContentEditable) return true;
        // A dialog over the studio has the keys to itself.
        const modal = el.closest('[aria-modal="true"], [role="alertdialog"]');
        if (modal && own && !modal.contains(own)) return true;
      }
      // In the sidebar the rest of the app is beside the stage, and Space there
      // belongs to whatever has focus: the stage answers only when it has it.
      if (live.current.compact && !(el && own?.contains(el))) return true;
      return false;
    };

    const onKey = (e: KeyboardEvent) => {
      if (drag.current || ignored(e)) return;
      const k = keyOf(e);
      const arrow = k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown';
      if (e.altKey && !arrow) return;
      const { doc: m, selected: sel, compact: small, onMove } = live.current;
      const el = e.target instanceof Element ? e.target : null;
      if (k === ' ') {
        if (el?.closest(PRESSED_BY_SPACE)) return;
        e.preventDefault();
        if (!e.repeat) toggle();
        return;
      }
      if ((arrow || k === 'Home' || k === 'End') && el?.closest(OWNS_ARROWS)) return;
      if (k === ',' || k === '.') {
        e.preventDefault();
        step(k === ',' ? -1 : 1);
        sayTime();
        return;
      }
      if (k === 'Home' || k === 'End') {
        e.preventDefault();
        seek(k === 'Home' ? 0 : lastFrame(read()));
        sayTime();
        return;
      }
      if (!arrow) return;
      const layer = small ? undefined : layerOf(m, sel);
      if (movable(layer)) {
        e.preventDefault();
        let n = nudge.current;
        if (n && n.id !== layer.id) {
          flushNudge();
          n = null;
        }
        const to = nudged(n ? n.at : { x: layer.x, y: layer.y }, k, nudgeStep(e.shiftKey, e.altKey), isRtlLang(m.lang));
        if (!to) return;
        onMove(layer.id, to.x, to.y, false);
        if (n) window.clearTimeout(n.timer);
        nudge.current = { id: layer.id, at: to, timer: window.setTimeout(flushNudge, NUDGE_MS) };
        return;
      }
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        e.preventDefault();
        // Shift steps a second's worth of frames.
        step((k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? Math.max(1, Math.round(m.fps)) : 1));
        sayTime();
      }
    };

    window.addEventListener('keydown', onDragKey, true);
    window.addEventListener('keyup', onDragKey, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onDragKey, true);
      window.removeEventListener('keyup', onDragKey, true);
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(sayTimer.current);
      // Leaving mid-gesture keeps what was done, as one step.
      const d = drag.current;
      if (d) {
        release(d);
        if (d.moved) live.current.onMove(d.id, d.at.x, d.at.y, true);
      }
      flushNudge();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A layer chosen elsewhere ends a nudge burst on the one before it.
  useEffect(() => {
    if (nudge.current && nudge.current.id !== selected) flushNudge();
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── the transport ──
  const frames = frameCount(doc);
  const frame = Math.min(frames - 1, frameAt(now, doc.fps));
  const nowText = timecode(now);
  const endText = timecode(doc.seconds);
  const position = fill(t('{n} of {of}'), { n: nowText, of: endText });
  const speedAt = SPEEDS.indexOf(play.speed);
  const nextSpeed = SPEEDS[(speedAt + 1) % SPEEDS.length] ?? 1;
  const playLabel = play.playing ? t('Pause') : t('Play the preview');
  const hintId = useId();
  const title = doc.title.trim();
  const blurLabel = t('Motion blur (smoother, slower to preview)');
  const safeLabel = t('Safe area guides');
  const loopLabel = t('Play in a loop');

  const onScrub = (value: string) => {
    pause();
    seek(timeAt(Number(value), doc.fps));
  };
  const onScrubKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // The window's keys skip inputs; Space on the scrubber still plays.
    if (e.key !== ' ') return;
    e.preventDefault();
    if (!e.repeat) toggle();
  };

  return (
    <div ref={root} className={compact ? 'mo-stage mo-is-compact' : 'mo-stage'}>
      <div ref={areaRef} className="mo-stage-area"
           onPointerDown={onDown} onPointerMove={onMovePointer} onPointerUp={onUp}
           onPointerCancel={(e) => { if (drag.current?.pointer === e.pointerId) cancelDrag(); }}
           onLostPointerCapture={onLost}>
        <div ref={frameRef} dir="ltr" tabIndex={0} role="img"
             className={`mo-stage-frame${doc.backdrop === null ? ' mo-is-clear' : ''}${dragging ? ' mo-is-drag' : ''}`}
             style={{ inlineSize: css.width, blockSize: css.height }}
             aria-label={title ? fill(t('Preview of {title}'), { title }) : t('Preview of the graphic')}
             aria-describedby={compact ? undefined : hintId}>
          <canvas ref={canvasRef} className="mo-stage-canvas" width={back.width} height={back.height} aria-hidden="true" />
          {safe && !compact && <div className="mo-stage-safe" aria-hidden="true" />}
          <div ref={selRef} className="mo-stage-sel" hidden aria-hidden="true">
            {!compact && <><i /><i /><i /><i /></>}
          </div>
        </div>
      </div>

      <div className="mo-stage-bar" dir="ltr" role="toolbar" aria-label={t('Playback')}>
        {!compact && (
          <button type="button" className="mo-stage-btn" onClick={() => step(-1)}
                  aria-label={t('Previous frame')} title={`${t('Previous frame')} (,)`}>
            <Icon name="chevron" size={14} turn={180} />
          </button>
        )}
        <button type="button" className="mo-stage-btn mo-stage-play" onClick={toggle}
                aria-label={playLabel} title={`${playLabel} (${t('Space')})`}>
          <Icon name={play.playing ? 'pause' : 'play'} size={compact ? 14 : 16} />
        </button>
        {!compact && (
          <button type="button" className="mo-stage-btn" onClick={() => step(1)}
                  aria-label={t('Next frame')} title={`${t('Next frame')} (.)`}>
            <Icon name="chevron" size={14} />
          </button>
        )}
        <input type="range" className="mo-stage-scrub" min={0} max={Math.max(0, frames - 1)} step={1} value={frame}
               onChange={(e) => onScrub(e.currentTarget.value)} onPointerDown={() => pause()} onKeyDown={onScrubKey}
               style={{ '--mo-played': `${frames > 1 ? (frame / (frames - 1)) * 100 : 0}%` } as CSSProperties}
               aria-label={t('Position in the graphic')} aria-valuetext={position} />
        <span className="mo-stage-time" title={position}>
          {nowText}<span className="mo-stage-of"> / {endText}</span>
        </span>
        {!compact && (
          <>
            <span className="mo-stage-rule" aria-hidden="true" />
            <button type="button" className="mo-stage-btn" onClick={() => setLoop(!play.loop)}
                    aria-pressed={play.loop} aria-label={loopLabel} title={loopLabel}>
              <Icon name="refresh" size={15} />
            </button>
            <button type="button" className="mo-stage-btn mo-stage-speed" onClick={() => setSpeed(nextSpeed)} title={t('Speed')}>
              <span className="mo-stage-sr">{t('Speed')} </span>{`${play.speed}×`}
            </button>
            <button type="button" className="mo-stage-btn" onClick={() => setBlur(!play.blur)}
                    aria-pressed={play.blur} aria-label={blurLabel} title={blurLabel}>
              <Glyph name="blur" />
            </button>
            <button type="button" className="mo-stage-btn" onClick={() => setSafe((s) => !s)}
                    aria-pressed={safe} aria-label={safeLabel} title={safeLabel}>
              <Glyph name="safe" />
            </button>
          </>
        )}
      </div>

      {!compact && (
        <p id={hintId} className="mo-stage-sr">
          {t('Click a layer to choose it, and drag it to move it. The arrow keys move the chosen layer; Space plays; comma and full stop step one frame.')}
        </p>
      )}
      <p className="mo-stage-sr" role="status">{say}</p>
    </div>
  );
}
