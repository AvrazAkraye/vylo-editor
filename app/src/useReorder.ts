import { useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  type Axis, type Box, began, centres, contains, dropIndex, insertionAt,
} from './reorder';

/**
 * Dragging a row to a different place in a list, for the three lists that have
 * one: the editor tabs, the terminal sessions and the chats.
 *
 * One hook rather than three copies. The copy is the one that forgets to
 * release the pointer capture — and the three lists differ only in which way
 * they run and what they do with the answer.
 *
 * ## Pointer events, not HTML5 drag-and-drop
 *
 * `draggable` + `dragstart` cannot show what is happening without a drag image,
 * which has to be a rendered element or a picture of one; the events fire in a
 * different order on each platform; and in some webviews a trackpad press-and-
 * drag never starts a drag at all, which would make the whole feature invisible
 * on the machines this app is mostly used on. `setPointerCapture` is the same
 * code on every platform and a dozen lines shorter.
 *
 * ## The three things that decide whether it feels right
 *
 * **A drop outside the strip is a cancel, not a close.** Nothing here removes
 * anything: the worst outcome of a bad drag is that the list is exactly as it
 * was. Losing a tab because a drag ended over the wrong part of the window is
 * not forgiven, so the gesture is not given the ability to do it. The pointer
 * leaving the strip is also *shown* — the insertion line goes away before the
 * pointer comes up, so "let go here and nothing happens" is on screen while
 * there is still time to move back.
 *
 * **A drag that never moved is a click.** The row is a button in all three
 * lists, so a press has to stay a press until the pointer has travelled
 * `THRESHOLD` pixels. Capture is taken at that moment and not before: capturing
 * on pointerdown would redirect the click to the container and every tab would
 * stop selecting its file.
 *
 * **The insertion point is shown while dragging.** Nothing is reordered until
 * the pointer comes up, so a line drawn against the row the item will land on
 * is the only thing saying where it is going.
 *
 * ## Why the carried row follows the pointer without a re-render
 *
 * The offset is written to a custom property on the container and the transform
 * lives in the stylesheet. React state would be a re-render of the whole tab
 * strip — which is inside `App.tsx` — sixty times a second for the length of
 * the drag. State changes here only when the *answer* changes, which is a
 * handful of times per gesture.
 *
 * ## Rows are found in the DOM rather than counted by the caller
 *
 * `.reorder-item` is the marker, and the index is the row's position among its
 * siblings that carry it. The tab strip's container also holds the back/forward
 * pair and the Chat button, so "the nth child" is not the nth tab; and reading
 * the rows back means the measurements are of what is on screen rather than of
 * what the caller believed was on screen.
 *
 * That is also why `enabled` exists. When a list is showing a *filtered* view —
 * the terminal panel's search, the chat search — the rows on screen are not the
 * list, and a drop between two of them is a promise about a position the person
 * cannot see. Reordering is off while a filter is on, rather than guessing.
 */

/** The class the call site puts on every row, and how this finds them. */
const ITEM = 'reorder-item';

/**
 * Written out rather than built from `axis` and the edge, because
 * `scripts/orphans.mjs` matches class names as text: a name assembled at
 * runtime is a rule in `styles.css` that nothing appears to use.
 */
const AXIS: Record<Axis, string> = { x: 'reorder-x', y: 'reorder-y' };
const EDGE = { before: 'drop-before', after: 'drop-after' } as const;

export interface ReorderOptions {
  /** Which way the list runs: `x` for a tab strip, `y` for a sidebar list. */
  axis: Axis;
  /** Off while the rows on screen are a filtered view of the real list. */
  enabled?: boolean;
  /** `from` and `to` are indices in the list as it will be. See `move`. */
  onMove: (from: number, to: number) => void;
}

export interface Reorder {
  /** Spread onto the element the rows live in. */
  strip: {
    ref: (el: HTMLElement | null) => void;
    className: string;
    onPointerDown: (e: ReactPointerEvent) => void;
    onPointerMove: (e: ReactPointerEvent) => void;
    onPointerUp: (e: ReactPointerEvent) => void;
    onPointerCancel: (e: ReactPointerEvent) => void;
    onClickCapture: (e: ReactMouseEvent) => void;
  };
  /** Added to the class of the row at `index`. Always includes the marker. */
  itemClass: (index: number) => string;
  /** True while a row is being carried, for a caller that wants to know. */
  dragging: boolean;
}

/** The gesture in flight, in a ref because most of it never reaches a render. */
interface Live {
  pointer: number;
  from: number;
  origin: { x: number; y: number };
  /** Measured once, when the drag begins. See `reorder.ts`. */
  mids: number[];
  strip: Box;
  rows: number;
  dragging: boolean;
  to: number;
}

/** What the render needs, which is three numbers and changes rarely. */
interface Shown { from: number; to: number; dragging: boolean }

const IDLE: Shown = { from: -1, to: -1, dragging: false };

const rowsIn = (host: HTMLElement): HTMLElement[] =>
  Array.from(host.querySelectorAll<HTMLElement>(`.${ITEM}`));

export function useReorder({ axis, enabled = true, onMove }: ReorderOptions): Reorder {
  const host = useRef<HTMLElement | null>(null);
  const live = useRef<Live | null>(null);
  // Set when a drag actually happened, so the click it turns into is swallowed
  // rather than opening the file the tab was dropped on.
  const swallow = useRef(false);
  const [shown, setShown] = useState<Shown>(IDLE);

  // An inline arrow from the call site is a new function every render. Read
  // through a ref so nothing here has to depend on it.
  const move = useRef(onMove);
  move.current = onMove;

  /** Put everything back, whatever the drag ended as. */
  function finish(pointer: number): void {
    const el = host.current;
    live.current = null;
    if (el) {
      if (el.hasPointerCapture(pointer)) el.releasePointerCapture(pointer);
      el.style.removeProperty('--drag-x');
      el.style.removeProperty('--drag-y');
    }
    setShown((s) => (s.dragging ? IDLE : s));
  }

  function down(e: ReactPointerEvent): void {
    // A previous gesture that never reported an end — the pointer left the
    // window before it travelled far enough to be captured — is replaced here
    // rather than blocking this one.
    live.current = null;
    swallow.current = false;
    if (!enabled || e.button !== 0) return;

    const el = host.current;
    const target = e.target as Element | null;
    if (!el || !target) return;
    // The close button and the row's own actions are not handles. Without this,
    // pressing the × and shifting a few pixels starts a drag, the click is
    // swallowed, and the tab does not close.
    if (target.closest('[data-nodrag]')) return;

    const row = target.closest<HTMLElement>(`.${ITEM}`);
    if (!row) return;
    const rows = rowsIn(el);
    const from = rows.indexOf(row);
    if (from < 0 || rows.length < 2) return;

    live.current = {
      pointer: e.pointerId,
      from,
      origin: { x: e.clientX, y: e.clientY },
      mids: [],
      strip: { left: 0, top: 0, right: 0, bottom: 0 },
      rows: rows.length,
      dragging: false,
      to: from,
    };
  }

  function moveTo(e: ReactPointerEvent): void {
    const l = live.current;
    const el = host.current;
    if (!l || !el || e.pointerId !== l.pointer) return;
    const at = { x: e.clientX, y: e.clientY };

    if (!l.dragging) {
      if (!began(l.origin, at)) return;
      const rows = rowsIn(el);
      // Something opened or closed between the press and the first move.
      if (rows.length !== l.rows) { live.current = null; return; }
      l.mids = centres(rows.map((r) => r.getBoundingClientRect()), axis);
      l.strip = el.getBoundingClientRect();
      l.dragging = true;
      el.setPointerCapture(e.pointerId);
      setShown({ from: l.from, to: l.from, dragging: true });
    }

    // Stops the press turning into a text selection across the rows it crosses.
    e.preventDefault();
    el.style.setProperty('--drag-x', `${axis === 'x' ? at.x - l.origin.x : 0}px`);
    el.style.setProperty('--drag-y', `${axis === 'y' ? at.y - l.origin.y : 0}px`);

    // Outside the strip the answer is "where it started", which is also what
    // makes the insertion line disappear: the cancel is visible before it
    // happens.
    const to = contains(l.strip, at)
      ? dropIndex(l.mids, axis === 'x' ? at.x : at.y, l.from)
      : l.from;
    if (to !== l.to) {
      l.to = to;
      setShown({ from: l.from, to, dragging: true });
    }
  }

  function up(e: ReactPointerEvent): void {
    const l = live.current;
    if (!l || e.pointerId !== l.pointer) return;
    const el = host.current;
    const rows = el ? rowsIn(el).length : -1;
    const inside = contains(l.strip, { x: e.clientX, y: e.clientY });
    const dragged = l.dragging;
    const { from, to } = l;
    finish(e.pointerId);
    if (!dragged) return;

    // The click this press would otherwise become is not a click any more.
    swallow.current = true;
    // A row that arrived or left mid-drag makes every index stale, and there is
    // no honest way to guess what the person meant. `inside` is the cancel.
    if (rows === l.rows && inside && to !== from) move.current(from, to);
  }

  function cancel(e: ReactPointerEvent): void {
    const l = live.current;
    if (!l || e.pointerId !== l.pointer) return;
    // The gesture was taken away — a scroll claimed it, or the OS did. That is
    // a cancel like any other, and never a reorder.
    const dragged = l.dragging;
    finish(e.pointerId);
    if (dragged) swallow.current = true;
  }

  function click(e: ReactMouseEvent): void {
    if (!swallow.current) return;
    swallow.current = false;
    e.preventDefault();
    e.stopPropagation();
  }

  return {
    strip: {
      ref: (el) => { host.current = el; },
      className: `reorder ${AXIS[axis]}${shown.dragging ? ' reordering' : ''}`,
      onPointerDown: down,
      onPointerMove: moveTo,
      onPointerUp: up,
      onPointerCancel: cancel,
      onClickCapture: click,
    },
    itemClass: (index) => {
      if (!shown.dragging) return ITEM;
      const edge = insertionAt(index, shown.from, shown.to);
      return `${ITEM}${index === shown.from ? ' moving' : ''}${edge ? ` ${EDGE[edge]}` : ''}`;
    },
    dragging: shown.dragging,
  };
}
