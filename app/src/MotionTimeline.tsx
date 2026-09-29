import { memo, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject, PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from './Icon';
import { fill } from './i18n';
import type { Layer, LayerKind } from './motiontypes';
import { shownName, type T, type TimelineProps } from './motionui';
import { setLayer } from './motionedit';
import { pause, read, seek, toggle, usePlay } from './motionplay';
import {
  DRAG_SLOP, PAD, dragTo, labelStep, nudge, partsOf, rowsOf, scaleOf, secs, snapTargets, stepRow, ticksOf, timeAt,
  timingOf, trimEnd, trimStart, xOf, type DragMode, type Span,
} from './motiontrack';

/**
 * The timeline: one row a layer, the front one first, each with its name and
 * the two switches every design tool has (shown, locked), and a bar on a
 * ruler for when it is on screen.
 *
 * ## What a bar says
 *
 * A bar runs from the layer's start to its end. Its entrance is the lighter
 * ramp at its head — from when the entrance begins (after its delay) to when
 * the last word or bar of it has landed — and its exit the ramp at its tail;
 * the paler stretches before an entrance and after an exit are time the
 * layer is there but not yet (or no longer) seen. Dots across it mean it
 * loops. The numbers come from `motiontrack.ts`, which takes them from the
 * engine's own `inDone` and `outStart`, so a bar can never disagree with what
 * the stage draws.
 *
 * ## Editing
 *
 * Drag a bar to move it, its ends to change when it starts or stops. Edges
 * snap to the twentieth of a second and to the playhead and the other
 * layers' edges nearby; Alt lets go of every snap. Each move is handed to the
 * panel under one key (`time:<id>`), so a whole drag is one undo step, and is
 * computed from where the bar was when the pointer went down. Escape puts it
 * back. A locked layer can be chosen and not moved.
 *
 * With the keys: ↑ ↓ go from layer to layer, ← → move the chosen one (Shift
 * half a second, Alt one frame), Home and End take it to either end, and
 * `[` `]` set its start or its end at the playhead.
 *
 * ## Time runs left to right
 *
 * In every language, as in the Video timeline and the stage's transport: the
 * rows' heads follow the interface to its reading side, the track does not
 * turn round. The playhead is three tiny components of its own that follow
 * the clock, so the rows are not drawn again sixty times a second.
 */

type Part = 'name' | 'eye' | 'lock' | 'bar';

/** A drag in progress, as it began. */
interface Drag {
  id: string;
  mode: DragMode;
  pointer: number;
  x0: number;
  from: Span;
  /** The layer's entrance, exit (and a counter's roll) at pointer-down, written back with every move. */
  keep: Partial<Layer>;
  pps: number;
  moved: boolean;
  last: Span | null;
}

/** What the drawing needs to know about a drag: where it is, and the snap it found. */
interface Live extends Span {
  id: string;
  mode: DragMode;
  guide: number | null;
}

/** A layer's kind, named: the glyph's title, and what a screen reader hears after the name. */
function kindName(k: LayerKind, t: T): string {
  if (k === 'text') return t('Text');
  if (k === 'shape') return t('Shape');
  if (k === 'icon') return t('Icon');
  if (k === 'image') return t('Picture');
  if (k === 'counter') return t('Counter');
  if (k === 'chart') return t('Chart');
  if (k === 'backdrop') return t('Background');
  return t('Particles');
}

/** Drawn on Icon.tsx's grid (24, round joins), for the pictures the set has no word for. */
const G = {
  text: 'M6.5 6.5h11M12 6.5v11',
  shape: 'M4.5 5.5h7.5v7.5H4.5zM16 11a4.25 4.25 0 1 1 0 8.5 4.25 4.25 0 0 1 0-8.5z',
  counter: 'M9.6 4.5 8 19.5M16 4.5l-1.6 15M5 9.2h14.5M4.5 14.8H19',
  chart: 'M6 18.5v-4.5M10 18.5v-10M14 18.5v-7M18 18.5V5.5',
  backdrop: 'M4.5 6.5a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1zM4.5 14.5c2.4-2 4.6-2 7 0s4.6 2 8 0',
  particles: 'M6.5 7.5h.01M16 5.5h.01M11.5 11.5h.01M18.5 12.5h.01M7 17h.01M14 18.5h.01',
  eye: 'M2.8 12S6 6 12 6s9.2 6 9.2 6-3.2 6-9.2 6-9.2-6-9.2-6zM12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z',
  eyeOff: 'M4.5 4.5l15 15M10 6.3A8.6 8.6 0 0 1 12 6c6 0 9.2 6 9.2 6a16 16 0 0 1-2.5 3.3M6.8 7.6C4.2 9.3 2.8 12 2.8 12S6 18 12 18a8.7 8.7 0 0 0 4.2-1.1M10.2 10.3a2.6 2.6 0 0 0 3.5 3.5',
  lock: 'M8 10.5V8a4 4 0 0 1 8 0v2.5M7 10.5h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
  unlock: 'M8 10.5V8a4 4 0 0 1 7.7-1.5M7 10.5h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
} as const;

function Glyph({ d, size = 14, weight = 1.5 }: { d: string; size?: number; weight?: number }) {
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={weight}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

/** A small picture of what a layer is. A text layer is a T. */
function KindGlyph({ kind }: { kind: LayerKind }) {
  if (kind === 'icon') return <Icon name="star" size={13} />;
  if (kind === 'image') return <Icon name="image" size={13} />;
  if (kind === 'text') return <Glyph d={G.text} size={13} weight={2.2} />;
  if (kind === 'particles') return <Glyph d={G.particles} size={13} weight={3} />;
  if (kind === 'chart') return <Glyph d={G.chart} size={13} weight={2.2} />;
  return <Glyph d={kind === 'shape' ? G.shape : kind === 'counter' ? G.counter : G.backdrop} size={13} />;
}

// ── the playhead: three tiny components that follow the clock ────────────

/** The playhead's knob on the ruler, which is also the ruler's slider for the keyboard. */
function Knob({ t, pps, seconds, onKey }: {
  t: T;
  pps: number;
  seconds: number;
  onKey: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
}) {
  const now = Math.min(usePlay().t, seconds);
  return (
    <div className="mo-tl-knob" role="slider" tabIndex={0} aria-label={t('Position in the graphic')}
         aria-valuemin={0} aria-valuemax={Math.round(seconds * 100) / 100} aria-valuenow={Math.round(now * 100) / 100}
         aria-valuetext={fill(t('{n} s'), { n: secs(now) })}
         style={{ transform: `translateX(${xOf(now, pps)}px)` }} onKeyDown={onKey} />
  );
}

/** The playhead's line, down through the rows. */
function NowLine({ pps, seconds }: { pps: number; seconds: number }) {
  const now = Math.min(usePlay().t, seconds);
  return <i className="mo-tl-now" style={{ transform: `translateX(${xOf(now, pps)}px)` }} />;
}

/** Where the playhead is, in the corner over the names. */
function Clock({ t, seconds }: { t: T; seconds: number }) {
  const now = Math.min(usePlay().t, seconds);
  return (
    <span className="mo-tl-clock" dir="ltr">
      <b>{now.toFixed(2)}</b>
      <span>{` / ${fill(t('{n} s'), { n: secs(seconds) })}`}</span>
    </span>
  );
}

// ── one row ───────────────────────────────────────────────────────────────

interface Api {
  select(id: string): void;
  flip(id: string, what: 'hidden' | 'locked'): void;
  rowKey(e: ReactKeyboardEvent<HTMLElement>, id: string, part: Part): void;
  laneDown(e: ReactPointerEvent<HTMLDivElement>): void;
  barDown(e: ReactPointerEvent<HTMLDivElement>, id: string): void;
  barMove(e: ReactPointerEvent<HTMLDivElement>): void;
  barUp(e: ReactPointerEvent<HTMLDivElement>): void;
  barKey(e: ReactKeyboardEvent<HTMLDivElement>, id: string): void;
  rowRef(id: string, el: HTMLDivElement | null): void;
}

interface RowProps {
  t: T;
  layer: Layer;
  on: boolean;
  /** The row the keyboard enters the list at: the chosen one, or the first. */
  entry: boolean;
  pps: number;
  seconds: number;
  dragging: boolean;
  help: string;
  api: MutableRefObject<Api>;
}

/** Narrower than this, a bar's handles sit outside it, so its middle can still be taken hold of. */
const NARROW = 26;
/** Narrower than this, a bar leaves its name to the row's head. */
const NAMED = 46;

const Row = memo(function Row({ t, layer: l, on, entry, pps, seconds, dragging, help, api }: RowProps) {
  const name = l.name.trim() ? shownName(l.name.trim(), t) : kindName(l.kind, t);
  const kind = kindName(l.kind, t);
  const tab = entry ? 0 : -1;
  const x = xOf(l.start, pps);
  const w = Math.max(3, (l.end - l.start) * pps);
  const at = (s: number) => (s - l.start) * pps;
  const parts = partsOf(l);
  const cls = ['mo-tl-row', on ? 'mo-tl-on' : '', l.hidden ? 'mo-tl-hidden' : '', l.locked ? 'mo-tl-locked' : ''].filter(Boolean).join(' ');
  const bar = ['mo-tl-bar', dragging ? 'mo-tl-dragging' : '', w < NARROW ? 'mo-tl-narrow' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls} role="listitem" ref={(el) => api.current.rowRef(l.id, el)}>
      <div className="mo-tl-head" onPointerDown={(e) => { if (e.button === 0) api.current.select(l.id); }}>
        <button type="button" className="mo-tl-name" data-part="name" tabIndex={tab} aria-pressed={on} title={name}
                onClick={() => api.current.select(l.id)} onKeyDown={(e) => api.current.rowKey(e, l.id, 'name')}>
          <span className="mo-tl-kind" title={kind}><KindGlyph kind={l.kind} /></span>
          <span className="mo-tl-text" dir="auto">{name}</span>
          <span className="vid-tl-sr">{`, ${kind}`}</span>
        </button>
        <span className="mo-tl-togs">
          <button type="button" className={l.hidden ? 'mo-tl-tog mo-tl-on' : 'mo-tl-tog'} data-part="eye" tabIndex={tab}
                  aria-pressed={!!l.hidden} aria-label={t('Hidden')} title={l.hidden ? t('Show the layer') : t('Hide the layer')}
                  onPointerDown={(e) => e.stopPropagation()} onClick={() => api.current.flip(l.id, 'hidden')}
                  onKeyDown={(e) => api.current.rowKey(e, l.id, 'eye')}>
            <Glyph d={l.hidden ? G.eyeOff : G.eye} size={15} />
          </button>
          <button type="button" className={l.locked ? 'mo-tl-tog mo-tl-on' : 'mo-tl-tog'} data-part="lock" tabIndex={tab}
                  aria-pressed={!!l.locked} aria-label={t('Locked')} title={l.locked ? t('Unlock the layer') : t('Lock the layer')}
                  onPointerDown={(e) => e.stopPropagation()} onClick={() => api.current.flip(l.id, 'locked')}
                  onKeyDown={(e) => api.current.rowKey(e, l.id, 'lock')}>
            <Glyph d={l.locked ? G.lock : G.unlock} size={14} />
          </button>
        </span>
      </div>
      <div className="mo-tl-lane" dir="ltr" onPointerDown={(e) => api.current.laneDown(e)}>
        {pps > 0 && (
          <div className={bar} role="slider" data-part="bar" tabIndex={tab}
               aria-label={fill(t('Timing of {name}'), { name })} aria-describedby={help}
               aria-valuemin={0} aria-valuemax={Math.round(seconds * 100) / 100} aria-valuenow={Math.round(l.start * 100) / 100}
               aria-valuetext={fill(t('From {start} s to {end} s'), { start: secs(l.start), end: secs(l.end) })}
               aria-readonly={l.locked ? true : undefined}
               style={{ insetInlineStart: x, inlineSize: w }}
               onPointerDown={(e) => api.current.barDown(e, l.id)} onPointerMove={(e) => api.current.barMove(e)}
               onPointerUp={(e) => api.current.barUp(e)} onPointerCancel={(e) => api.current.barUp(e)}
               onLostPointerCapture={(e) => api.current.barUp(e)} onKeyDown={(e) => api.current.barKey(e, l.id)}>
            <span className="mo-tl-body">
              {parts.in && parts.in.start > l.start && <i className="mo-tl-wait" style={{ insetInlineStart: 0, inlineSize: at(parts.in.start) }} />}
              {parts.in && <i className="mo-tl-in" style={{ insetInlineStart: at(parts.in.start), inlineSize: at(parts.in.end) - at(parts.in.start) }} />}
              {parts.out && <i className="mo-tl-out" style={{ insetInlineStart: at(parts.out.start), inlineSize: at(parts.out.end) - at(parts.out.start) }} />}
              {parts.out && parts.out.end < l.end && <i className="mo-tl-wait" style={{ insetInlineStart: at(parts.out.end), inlineSize: w - at(parts.out.end) }} />}
              {l.loop && <i className="mo-tl-loop" />}
              {w >= NAMED && <span className="mo-tl-label" dir="auto">{name}</span>}
            </span>
            {!l.locked && (
              <>
                <span className="mo-tl-grip mo-tl-grip-start" data-grip="start" aria-hidden="true" />
                <span className="mo-tl-grip mo-tl-grip-end" data-grip="end" aria-hidden="true" />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

// ── the timeline ──────────────────────────────────────────────────────────

export function MotionTimeline(p: TimelineProps) {
  const { t, doc, selected, onSelect, onEdit } = p;
  const seconds = Math.max(0.05, doc.seconds);
  const rows = rowsOf(doc.layers);
  const ids = rows.map((l) => l.id);
  const sel = selected && ids.includes(selected) ? selected : null;
  const entry = sel ?? ids[0] ?? null;
  const help = useId();

  const scroller = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const drag = useRef<Drag | null>(null);
  const scrub = useRef<number | null>(null);
  const [width, setWidth] = useState(0);
  const [live, setLive] = useState<Live | null>(null);

  // The track's width is the ruler's: the column the rows' bars are drawn in.
  useLayoutEffect(() => {
    const el = ruler.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const pps = scaleOf(width, seconds);

  /** What the handlers read: always this render's, though they were handed to the rows earlier. */
  const cur = useRef({ doc, seconds, pps, sel, ids, onEdit, onSelect });
  cur.current = { doc, seconds, pps, sel, ids, onEdit, onSelect };

  const go = (id: string, by: number, part: Part) => {
    const next = stepRow(cur.current.ids, id, by);
    if (!next || next === id) return;
    // Drawn as chosen before the focus moves: a row's switches only show once it is.
    flushSync(() => cur.current.onSelect(next));
    rowEls.current.get(next)?.querySelector<HTMLElement>(`[data-part="${part}"]`)?.focus();
  };
  const layer = (id: string) => cur.current.doc.layers.find((l) => l.id === id);
  const time = (id: string, span: Span, keep: Partial<Layer> = {}) => {
    const patch = { ...keep, start: span.start, end: span.end };
    cur.current.onEdit((m) => setLayer(m, id, patch), `time:${id}`);
  };
  const release = (el: HTMLElement, pointer: number) => {
    try {
      if (el.hasPointerCapture(pointer)) el.releasePointerCapture(pointer);
    } catch {
      /* a pointer the browser no longer knows */
    }
  };

  const api = useRef<Api>(null as unknown as Api);
  api.current = {
    select(id) {
      if (cur.current.sel !== id) cur.current.onSelect(id);
    },
    flip(id, what) {
      cur.current.onEdit((m) => {
        const l = m.layers.find((x) => x.id === id);
        return l ? setLayer(m, id, what === 'hidden' ? { hidden: !l.hidden } : { locked: !l.locked }) : m;
      });
    },
    rowKey(e, id, part) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const count = cur.current.ids.length;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') go(id, e.key === 'ArrowUp' ? -1 : 1, part);
      else if (e.key === 'Home') go(id, -count, part);
      else if (e.key === 'End') go(id, count, part);
      else return;
      e.preventDefault();
    },
    laneDown(e) {
      // Only the empty track: a press on a bar bubbles here too.
      if (e.button === 0 && e.target === e.currentTarget && cur.current.sel !== null) cur.current.onSelect(null);
    },
    barDown(e, id) {
      const l = layer(id);
      if (!l || e.button !== 0) return;
      api.current.select(id);
      e.currentTarget.focus({ preventScroll: true });
      const pps0 = cur.current.pps;
      if (l.locked || !(pps0 > 0)) return;
      e.preventDefault();
      const grip = (e.target as HTMLElement).closest<HTMLElement>('[data-grip]')?.dataset.grip;
      const mode: DragMode = grip === 'start' ? 'start' : grip === 'end' ? 'end' : 'move';
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic pointer has nothing to capture */
      }
      drag.current = {
        id, mode, pointer: e.pointerId, x0: e.clientX, from: { start: l.start, end: l.end }, keep: timingOf(l), pps: pps0, moved: false, last: null,
      };
      if (mode !== 'move') setLive({ id, mode, start: l.start, end: l.end, guide: null });
    },
    barMove(e) {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointer) return;
      // A release the bar never heard (outside the window, with no capture): the drag is over, not following the pointer.
      if (!(e.buttons & 1)) {
        api.current.barUp(e);
        return;
      }
      const dx = e.clientX - d.x0;
      if (!d.moved) {
        if (Math.abs(dx) < DRAG_SLOP) return;
        d.moved = true;
      }
      const c = cur.current;
      const r = dragTo(d.mode, d.from, dx / d.pps, {
        seconds: c.seconds, pps: d.pps, targets: snapTargets(c.doc.layers, d.id, read().t, c.seconds), snap: !e.altKey,
      });
      if (d.last && d.last.start === r.start && d.last.end === r.end) return;
      d.last = { start: r.start, end: r.end };
      setLive({ id: d.id, mode: d.mode, start: r.start, end: r.end, guide: r.guide });
      time(d.id, d.last, d.keep);
    },
    barUp(e) {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointer) return;
      drag.current = null;
      setLive(null);
      release(e.currentTarget, e.pointerId);
    },
    barKey(e, id) {
      const l = layer(id);
      if (!l || e.metaKey || e.ctrlKey) return;
      const k = e.key;
      if ((k === 'ArrowUp' || k === 'ArrowDown') && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        go(id, k === 'ArrowUp' ? -1 : 1, 'bar');
        return;
      }
      const c = cur.current;
      const from = { start: l.start, end: l.end };
      const step = e.altKey ? 1 / c.doc.fps : e.shiftKey ? 0.5 : 0.05;
      let next: Span;
      if (k === 'ArrowLeft' || k === 'ArrowRight') next = nudge(from, k === 'ArrowRight' ? step : -step, c.seconds);
      else if (k === 'Home') next = nudge(from, -from.start, c.seconds);
      else if (k === 'End') next = nudge(from, c.seconds - from.end, c.seconds);
      // By the key's place as well as its letter: on an Arabic keyboard `[` types ج.
      else if (k === '[' || e.code === 'BracketLeft') next = trimStart(from, read().t);
      else if (k === ']' || e.code === 'BracketRight') next = trimEnd(from, read().t, c.seconds);
      else return;
      e.preventDefault();
      if (l.locked || (next.start === l.start && next.end === l.end)) return;
      time(id, next);
    },
    rowRef(id, el) {
      if (el) rowEls.current.set(id, el);
      else rowEls.current.delete(id);
    },
  };

  // Escape lets go of a drag and puts the layer back where it was.
  const dragging = live !== null;
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => {
      const d = drag.current;
      if (e.key !== 'Escape' || !d) return;
      e.preventDefault();
      e.stopPropagation();
      drag.current = null;
      setLive(null);
      if (d.last) time(d.id, d.from, d.keep);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dragging]); // eslint-disable-line react-hooks/exhaustive-deps

  // A layer chosen elsewhere — on the stage, in Layers — is scrolled into view here.
  useEffect(() => {
    const sc = scroller.current;
    const row = sel ? rowEls.current.get(sel) : undefined;
    if (!sc || !row) return;
    const r = row.getBoundingClientRect();
    const box = sc.getBoundingClientRect();
    const head = top.current?.offsetHeight ?? 0;
    if (r.top < box.top + head) sc.scrollTop -= box.top + head - r.top;
    else if (r.bottom > box.bottom) sc.scrollTop += r.bottom - box.bottom;
  }, [sel]);

  // ── the ruler: press or drag to scrub ──
  const seekAt = (clientX: number) => {
    const r = ruler.current?.getBoundingClientRect();
    if (r && pps > 0) seek(timeAt(clientX - r.left, pps, seconds));
  };
  const onRulerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    pause();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic pointer has nothing to capture */
    }
    scrub.current = e.pointerId;
    seekAt(e.clientX);
  };
  const onRulerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (scrub.current !== e.pointerId) return;
    if (e.buttons & 1) seekAt(e.clientX);
    else scrub.current = null;
  };
  const onRulerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (scrub.current !== e.pointerId) return;
    scrub.current = null;
    release(e.currentTarget, e.pointerId);
  };
  const onKnobKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const clock = read();
    const frame = 1 / Math.max(1, doc.fps);
    let to: number | null = null;
    // Up and Down as a slider has them, the same as Right and Left: the ruler runs left to right in every language.
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') to = clock.t + (e.shiftKey ? 1 : frame);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') to = clock.t - (e.shiftKey ? 1 : frame);
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = seconds;
    else if (e.key === ' ') {
      e.preventDefault();
      toggle();
      return;
    }
    if (to === null) return;
    e.preventDefault();
    pause();
    seek(to);
  };

  const step = labelStep(pps);
  const ticks = ticksOf(seconds, pps);
  const vars = { ['--mo-tl-step' as string]: `${pps > 0 ? step * pps : 0}px`, ['--mo-tl-pad' as string]: `${PAD}px` };

  let badge: { x: number; text: string } | null = null;
  if (live && pps > 0) {
    const at = live.mode === 'start' ? live.start : live.mode === 'end' ? live.end : (live.start + live.end) / 2;
    const n = live.mode === 'start' ? secs(live.start) : live.mode === 'end' ? secs(live.end) : `${secs(live.start)}–${secs(live.end)}`;
    badge = { x: Math.min(Math.max(xOf(at, pps), 34), Math.max(34, width - 34)), text: fill(t('{n} s'), { n }) };
  }

  return (
    <section className="mo-tl" aria-label={t('Timeline')} style={vars}>
      <div className="mo-tl-scroll" ref={scroller}>
        <div className="mo-tl-top" ref={top}>
          <div className="mo-tl-corner"><Clock t={t} seconds={seconds} /></div>
          <div className="mo-tl-ruler" ref={ruler} dir="ltr" onPointerDown={onRulerDown} onPointerMove={onRulerMove}
               onPointerUp={onRulerUp} onPointerCancel={onRulerUp} onLostPointerCapture={onRulerUp}>
            {ticks.map((k) => (
              <span key={k.at} className={k.label ? (xOf(k.at, pps) > width - PAD - 8 ? 'mo-tl-tick mo-tl-numbered mo-tl-lastnum' : 'mo-tl-tick mo-tl-numbered') : k.half ? 'mo-tl-tick mo-tl-halfsec' : 'mo-tl-tick'}
                    style={{ insetInlineStart: xOf(k.at, pps) }}>
                {k.label && <b>{k.at}</b>}
              </span>
            ))}
            {pps > 0 && <Knob t={t} pps={pps} seconds={seconds} onKey={onKnobKey} />}
            {badge && <span className="mo-tl-badge" role="status" style={{ insetInlineStart: badge.x }}>{badge.text}</span>}
          </div>
        </div>

        <div className="mo-tl-rows" onPointerDown={(e) => { if (e.button === 0 && e.target === e.currentTarget && sel) onSelect(null); }}>
          {pps > 0 && rows.length > 0 && (
            <div className="mo-tl-over" aria-hidden="true">
              <div className="mo-tl-over-in" dir="ltr">
                {live && live.guide !== null && <i className="mo-tl-guide" style={{ transform: `translateX(${xOf(live.guide, pps)}px)` }} />}
                <NowLine pps={pps} seconds={seconds} />
              </div>
            </div>
          )}
          {rows.length === 0
            ? <p className="mo-tl-empty">{t('No layers yet')}</p>
            : (
              <div role="list" aria-label={t('Layers')}>
                {rows.map((l) => (
                  <Row key={l.id} t={t} layer={l} on={l.id === sel} entry={l.id === entry} pps={pps} seconds={seconds}
                       dragging={live?.id === l.id} help={help} api={api} />
                ))}
              </div>
            )}
        </div>
      </div>
      <p id={help} className="vid-tl-sr">
        {t('Up and down arrows go from layer to layer. Left and right arrows move the layer by a twentieth of a second, half a second with Shift, one frame with Alt. Home and End move it to the start or the end. [ and ] set its start or its end at the playhead. Drag a bar to move it, or its ends to change when it starts and stops; hold Alt to stop it snapping.')}
      </p>
    </section>
  );
}
