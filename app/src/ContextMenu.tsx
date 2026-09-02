import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { first, place, step, tidy, type Item, type Point } from './menu';
import { TAGS, type Tag } from './tags';

/**
 * A context menu.
 *
 * `ContextMenu`, not `Menu`, because `menu.ts` holds the placement and a
 * component differing from it only in case resolves to the wrong file on a
 * case-insensitive filesystem. `TodoPanel` sits beside `todo.ts` for the same
 * reason, and that one was found the same way: the compiler refusing two names
 * that differ only in casing.
 *
 * One component, opened from anywhere with a point and a list of items. It
 * exists because the alternative was a fourth hover-only row of icon buttons:
 * a tab already carries a close button and a split button, and every action
 * added after that competes for about eleven pixels.
 *
 * Three things it does that a `<div>` full of buttons would not:
 *
 *   - It is measured and then placed, so a menu opened at the bottom of the
 *     window opens upward instead of running off it. `place` in `menu.ts`.
 *   - The keyboard works. Arrow keys, Home and End move, Enter chooses, Escape
 *     closes, and focus goes back where it came from. A set of actions only
 *     reachable by right-click is a set of actions some people cannot reach.
 *   - It closes on anything that means "I am doing something else now" —
 *     a click outside, a scroll, a resize, another menu opening.
 */

export interface MenuProps {
  at: Point;
  items: Item[];
  t: (s: string) => string;
  onPick: (id: string) => void;
  onClose: () => void;
  /** The current colour, when the list has a swatch row. */
  tag?: Tag;
  onTag?: (tag: Tag) => void;
  /** Named for a screen reader: "Actions for main.ts". */
  label: string;
}

export function ContextMenu({ at, items: raw, t, onPick, onClose, tag, onTag, label }: MenuProps) {
  const items = tidy(raw);
  const box = useRef<HTMLDivElement>(null);
  const came = useRef<Element | null>(null);
  const [where, setWhere] = useState<Point | null>(null);
  const [on, setOn] = useState(-1);

  // Measured, then placed. Rendering at the pointer and correcting afterwards
  // shows the menu in the wrong place for one frame, which reads as a flicker
  // at exactly the moment somebody is looking at it.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setWhere(place(at, { w: r.width, h: r.height },
      { w: window.innerWidth, h: window.innerHeight }));
  }, [at.x, at.y, items.length]);

  useEffect(() => {
    came.current = document.activeElement;
    box.current?.focus();
    return () => { (came.current as HTMLElement | null)?.focus?.(); };
  }, []);

  useEffect(() => {
    // Anything that means "I am doing something else now". `scroll` is captured
    // because it does not bubble from the element that scrolled.
    const shut = () => onClose();
    window.addEventListener('resize', shut);
    window.addEventListener('blur', shut);
    document.addEventListener('scroll', shut, true);
    return () => {
      window.removeEventListener('resize', shut);
      window.removeEventListener('blur', shut);
      document.removeEventListener('scroll', shut, true);
    };
  }, [onClose]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOn(step(items, on, e.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (e.key === 'Home') { e.preventDefault(); setOn(first(items)); return; }
    if (e.key === 'End') { e.preventDefault(); setOn(step(items, -1, -1)); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      const item = items[on];
      if (item?.kind === 'action') { e.preventDefault(); onPick(item.id); onClose(); }
    }
  }

  if (!items.length) return null;

  return (
    <div className="mn-back" onMouseDown={(e) => { e.stopPropagation(); onClose(); }}
         onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div ref={box} className="mn" role="menu" aria-label={label} tabIndex={-1}
           onKeyDown={onKey}
           onMouseDown={(e) => e.stopPropagation()}
           style={where
             ? { insetInlineStart: 0, insetBlockStart: 0, transform: `translate(${where.x}px, ${where.y}px)` }
             // Off-screen for the measuring pass, so the wrong position is
             // never painted.
             : { insetInlineStart: 0, insetBlockStart: 0, transform: 'translate(-9999px, -9999px)' }}>
        {items.map((item, i) => {
          if (item.kind === 'divider') return <hr key={i} className="mn-div" />;
          if (item.kind === 'swatches') {
            return (
              <div key={i} className={`mn-sw ${on === i ? 'on' : ''}`} role="group"
                   aria-label={t('Colour')} onMouseEnter={() => setOn(i)}>
                {TAGS.map((x) => (
                  <button key={x} className={`mn-dot ${x === 'none' ? 'off' : ''} ${tag === x ? 'is' : ''}`}
                          style={x === 'none' ? undefined : { background: `var(--tag-${x})` }}
                          aria-pressed={tag === x} aria-label={t(x)}
                          onClick={() => { onTag?.(x); onClose(); }}>
                    {x === 'none' && <Icon name="close" size={9} />}
                  </button>
                ))}
              </div>
            );
          }
          return (
            <button key={item.id} role="menuitem" disabled={item.disabled}
                    className={`mn-item ${item.danger ? 'danger' : ''} ${on === i ? 'on' : ''}`}
                    onMouseEnter={() => setOn(i)}
                    onClick={() => { onPick(item.id); onClose(); }}>
              <span>{t(item.label)}</span>
              {item.hint && <em>{item.hint}</em>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default ContextMenu;
