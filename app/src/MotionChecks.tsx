import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { fill } from './i18n';
import { autofix, checkMotion, summarize, type Finding } from './motioncheck';
import type { Motion } from './motiontypes';
import { layerOf, shownName, type T } from './motionui';

/**
 * The quality check's one line by the stage: "Looks good", or "3 tips" and,
 * on a click, the tips themselves, each with its layer, a way to fix it when
 * there is a safe one, and Fix all.
 *
 * ## Quiet
 *
 * The check is advice, never a gate (docs/PRO.md's simplicity contract): it
 * says "tips", not "errors", nothing waits for it, and a clean graphic shows
 * a small green "Looks good" that is not even a button. It runs 250 ms after
 * the graphic stops changing — a check is a few milliseconds, but a person
 * typing a title changes the graphic on every key, and the list should not
 * flicker under them — and never with the playhead: the check is about the
 * whole graphic, not a frame of it. It runs again when a face finishes
 * loading, because the words were measured in the fallback until then.
 *
 * ## A fix is an edit like any other
 *
 * Fix and Fix all hand the panel the graphic with the repair made
 * (`autofix`, through motionedit.ts), so it is one undo step, and a template
 * stops being one as it would after a hand edit. A repair that the check, run
 * again, finds would cause another problem is not made; the tip then says it
 * needs a change by hand rather than pretending.
 *
 * ## Keys
 *
 * The chip is a button that opens a menu (`aria-haspopup="menu"`). In it the
 * arrow keys move between the tips and their fixes, Home and End go to either
 * end, Enter or Space takes the one with the focus — a tip selects its layer
 * on the stage, a fix makes it — Escape closes the menu and gives the focus
 * back to the chip, and Tab leaves it. The menu opens upward when there is no
 * room below, and sits on the end side of the chip in either direction.
 */

export interface ChecksProps {
  t: T;
  doc: Motion;
  /** The graphic with a repair made: applied by the panel as one edit. */
  onApply: (next: Motion) => void;
  /** Select a layer on the stage. */
  onSelect: (layerId: string) => void;
}

/** Milliseconds after the last change before the check runs. */
const SETTLE = 250;

function run(doc: Motion): Finding[] {
  try {
    return checkMotion(doc);
  } catch {
    return [];
  }
}

export function MotionChecks({ t, doc, onApply, onSelect }: ChecksProps) {
  const [found, setFound] = useState<Finding[]>(() => run(doc));
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  // Repairs the check refused for this graphic: their buttons say so instead of doing nothing.
  const [refused, setRefused] = useState<ReadonlySet<string>>(() => new Set());
  const [fonts, setFonts] = useState(0);
  // Bumped when a repair has been made with the menu open: the focus goes back to the first tip once the list is drawn again.
  const [refocus, setRefocus] = useState(0);
  const chip = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const latest = useRef(doc);
  latest.current = doc;
  const menuId = useId();
  const baseId = useId();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFound(run(latest.current));
      setRefused(new Set());
    }, SETTLE);
    return () => window.clearTimeout(timer);
  }, [doc, fonts]);

  // A face that arrives after the words were measured changes their widths: measure again.
  useEffect(() => {
    const set = typeof document === 'undefined' ? undefined : document.fonts;
    if (!set || typeof set.addEventListener !== 'function') return;
    const again = () => setFonts((n) => n + 1);
    set.addEventListener('loadingdone', again);
    return () => set.removeEventListener('loadingdone', again);
  }, []);

  const summary = summarize(found);
  const count = summary.warn + summary.tip;
  useEffect(() => {
    if (open && count === 0) setOpen(false);
  }, [open, count]);

  // Opened: the first tip takes the focus, and the menu goes above the chip when there is no room below it.
  useLayoutEffect(() => {
    if (!open) return;
    const box = menu.current;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const a = chip.current?.getBoundingClientRect();
    setUp(!!a && r.bottom > window.innerHeight - 8 && a.top - r.height - 8 > 0);
    box.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  useLayoutEffect(() => {
    if (refocus && open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [refocus]); // eslint-disable-line react-hooks/exhaustive-deps

  // A press anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target || menu.current?.contains(target) || chip.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [open]);

  const close = (focusChip: boolean) => {
    setOpen(false);
    if (focusChip) chip.current?.focus();
  };

  /** Make a repair, or note that the check refused it. The list is checked again at once, so the menu never shows a fixed tip. */
  const apply = (ids?: string[]) => {
    const before = latest.current;
    let next = before;
    try {
      next = autofix(before, found, ids);
    } catch {
      next = before;
    }
    if (next === before) {
      setRefused(new Set([...refused, ...(ids ?? found.filter((f) => f.fix).map((f) => f.id))]));
      return;
    }
    onApply(next);
    const after = run(next);
    setFound(after);
    setRefused(new Set());
    if (!after.length) close(true);
    else setRefocus((n) => n + 1);
  };

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    if (e.key === 'Escape') {
      // Taken here, so the full window's own Escape (leave the window) does not also run.
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Tab') setOpen(false);
  };

  const label = summary.clean ? t('Looks good') : count === 1 ? t('1 tip') : fill(t('{n} tips'), { n: count });
  // Said when it changes, and only then: a live region of its own, so opening the menu is not read out as news.
  const status = <span className="mk-check-sr" aria-live="polite">{label}</span>;

  if (summary.clean) {
    return (
      <span className="mk-check">
        <span className="mk-check-chip is-clean" title={t('Quality check')} aria-hidden="true">
          <span className="mk-check-dot" />
          {label}
        </span>
        {status}
      </span>
    );
  }

  const fixable = found.filter((f) => f.fix && !refused.has(f.id));
  const nameOf = (f: Finding) => {
    const layer = layerOf(doc, f.layerId ?? null);
    return layer ? shownName(layer.name, t) : t('The whole graphic');
  };
  const sentence = (f: Finding) => {
    const vars: Record<string, string | number> = { ...(f.vars ?? {}) };
    if (typeof vars.other === 'string') vars.other = shownName(vars.other, t);
    return fill(t(f.message), vars);
  };

  return (
    <span className="mk-check">
      {status}
      <button ref={chip} type="button" className={`mk-check-chip ${summary.warn ? 'is-warn' : 'is-tips'}`} title={t('Quality check')}
              aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
              onClick={() => setOpen(!open)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && !open) {
                  e.preventDefault();
                  setOpen(true);
                }
              }}>
        <span className="mk-check-dot" aria-hidden="true" />
        {label}
      </button>
      {open && (
        <div ref={menu} id={menuId} className={`mo-pop mk-check-pop${up ? ' is-up' : ''}`} role="menu" aria-label={t('Tips for this graphic')}
             onKeyDown={onMenuKey}>
          <ul className="mk-check-list" role="none">
            {found.map((f, n) => {
              const textId = `${baseId}-${n}`;
              const blocked = refused.has(f.id);
              return (
                <li key={f.id} className={`mk-check-item${f.severity === 'warn' ? ' is-warn' : ''}`} role="none">
                  <button type="button" role="menuitem" tabIndex={-1} className="mk-check-tip" aria-disabled={f.layerId ? undefined : true}
                          onClick={() => {
                            if (!f.layerId) return;
                            onSelect(f.layerId);
                            close(false);
                          }}>
                    <span className="mk-check-dot" aria-hidden="true" />
                    <span className="mk-check-words">
                      {f.severity === 'warn' && <span className="mk-check-sr">{t('Worth fixing:')} </span>}
                      <span id={textId}>{sentence(f)}</span>
                      <span className="mk-check-layer"><bdi>{nameOf(f)}</bdi></span>
                    </span>
                  </button>
                  {f.fix && (
                    <button type="button" role="menuitem" tabIndex={-1} className="ghost mk-check-fix" aria-describedby={textId}
                            aria-disabled={blocked || undefined} title={blocked ? t('This one needs a change by hand.') : undefined}
                            onClick={() => {
                              if (!blocked) apply([f.id]);
                            }}>
                      {t(f.fix.label)}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {fixable.length > 1 && (
            <button type="button" role="menuitem" tabIndex={-1} className="ghost mk-check-all" onClick={() => apply()}>
              {t('Fix all')}
            </button>
          )}
        </div>
      )}
    </span>
  );
}
