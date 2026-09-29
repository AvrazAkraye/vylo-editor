import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type {
  ChangeEvent, CSSProperties, FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent,
  ReactNode, RefObject,
} from 'react';
import { Icon } from './Icon';
import { EASES, TONES, isTone, type Gradient, type Paint, type Palette, type Pin, type Tone } from './motiontypes';
import { easeOf } from './motionmath';
import type { T } from './motionui';

/**
 * The small controls the Motion inspector is built from (MotionLayers.tsx,
 * MotionKinds.tsx): a row with its label, a number with its unit, a slider, a
 * select, a set of segments, a switch, a line of words, a colour, a paint, the
 * nine-point anchor and a timing curve.
 *
 * ## One shape for every row
 *
 * A label on the start side, the control on the end side, the labels in one
 * column (`--mo-label`), so a section reads down the labels and across to a
 * value — the way a property panel reads. Two short values share a row by
 * sitting in it as bare boxes (`NumberBox`), each marked with a glyph that is
 * also its drag handle.
 *
 * ## Controlled, with a draft only while typing
 *
 * Every control shows the value it is given and reports a change; none keeps
 * the value. The one thing held locally is what is being typed: a number
 * half-written ("1.", "-") or words the reader will tidy (a trailing space)
 * would otherwise be replaced under the caret by the value they were read as.
 * The draft is dropped when the field loses focus, and replaced when the value
 * is changed from somewhere else while it has it — an undo, the stage.
 *
 * ## Numbers
 *
 * Typed, stepped with the arrow keys (Shift ten times, Alt a tenth), or
 * dragged: the label, or a box's glyph, scrubs the value left and right.
 * Arabic-Indic digits and the Arabic decimal separator are read as what they
 * are. A box is always laid out left to right — a number and its unit are one
 * run of text in every language.
 */

// ── glyphs ────────────────────────────────────────────────────────────────

/**
 * Line drawings on the app's 24 grid (Icon.tsx's hand), for what that set has
 * no word for: the eye and the lock of a layer row, the eight kinds of layer,
 * the chart types, the arrows of a direction, a die. A `d` beginning with `.`
 * is a set of dots, drawn thicker.
 */
const GLYPHS = {
  eye: 'M2.8 12s3.4-6.3 9.2-6.3 9.2 6.3 9.2 6.3-3.4 6.3-9.2 6.3S2.8 12 2.8 12zM12 9.3a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4z',
  eyeOff: 'M4 4l16 16M10.2 5.9a9 9 0 0 1 1.8-.2c5.8 0 9.2 6.3 9.2 6.3a16 16 0 0 1-2.6 3.4M6.7 6.9C4.2 8.6 2.8 12 2.8 12s3.4 6.3 9.2 6.3c1.5 0 2.9-.4 4.1-1M10 10.1a2.7 2.7 0 0 0 3.9 3.8',
  lock: 'M7.2 10.6h9.6a1.4 1.4 0 0 1 1.4 1.4v6.8a1.4 1.4 0 0 1-1.4 1.4H7.2a1.4 1.4 0 0 1-1.4-1.4V12a1.4 1.4 0 0 1 1.4-1.4zM8.6 10.6V8a3.4 3.4 0 0 1 6.8 0v2.6',
  unlock: 'M7.2 10.6h9.6a1.4 1.4 0 0 1 1.4 1.4v6.8a1.4 1.4 0 0 1-1.4 1.4H7.2a1.4 1.4 0 0 1-1.4-1.4V12a1.4 1.4 0 0 1 1.4-1.4zM8.6 10.6V8a3.4 3.4 0 0 1 6.6-1.1',
  grip: '.M9 6.5h.01M15 6.5h.01M9 12h.01M15 12h.01M9 17.5h.01M15 17.5h.01',
  shuffle: 'M4 7.5h2.8c1.9 0 3 .8 4.1 2.4l2.2 3.3c1.1 1.6 2.2 2.3 4.1 2.3H20M17.3 12.8 20 15.5l-2.7 2.7M4 16.5h2.8c1.2 0 2-.3 2.8-1M13.4 8.5c.8-.7 1.6-1 2.8-1H20M17.3 4.8 20 7.5l-2.7 2.7',
  up: 'M12 19V5M6.5 10.5 12 5l5.5 5.5',
  down: 'M12 5v14M6.5 13.5 12 19l5.5-5.5',
  left: 'M19 12H5M10.5 6.5 5 12l5.5 5.5',
  right: 'M5 12h14M13.5 6.5 19 12l-5.5 5.5',
  across: 'M4 12h16M7.5 8.5 4 12l3.5 3.5M16.5 8.5 20 12l-3.5 3.5',
  updown: 'M12 4v16M8.5 7.5 12 4l3.5 3.5M8.5 16.5 12 20l3.5-3.5',
  rotate: 'M19.2 12.8a7.3 7.3 0 1 1-2.4-6.3M19.4 4.6v3.8h-3.8',
  time: 'M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM12 8v4.2l2.6 1.6',
  end: 'M5 12h11M11.5 7 16.5 12l-5 5M19.5 6v12',
  text: 'M5.5 7V5.5h13V7M12 5.5v13M9.2 18.5h5.6',
  shape: 'M4.5 10h8.5v9.5H4.5zM15.8 14a4.7 4.7 0 1 0 0-9.4 4.7 4.7 0 0 0 0 9.4z',
  icon: 'M12 3.5 13.9 9.4 20 11.3l-6.1 1.9L12 19l-1.9-5.8L4 11.3l6.1-1.9z',
  image: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5zM4.6 17.8l4.6-4.6a1.5 1.5 0 0 1 2.1 0l3.5 3.5M13.4 15.1l1.8-1.8a1.5 1.5 0 0 1 2.1 0l2.1 2.1M9.2 9.4v.01',
  counter: 'M9.6 4.5 8 19.5M16 4.5l-1.6 15M5 9.2h14.5M4.5 14.8H19',
  chart: 'M4.5 19.5h15M7.5 19.5V13M12 19.5V7M16.5 19.5V10.5',
  backdrop: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5zM4 10.2c2.7-2 5.3 2 8 0s5.3-2 8 0M4 15c2.7-2 5.3 2 8 0s5.3-2 8 0',
  particles: '.M6 6.5h.01M12.5 4.8h.01M18 7.5h.01M8.8 11.8h.01M15.4 11.5h.01M20 13h.01M5 16.2h.01M11.6 17.6h.01M17.6 18.4h.01',
  bars: 'M4.5 19.5h15M8 19.5V12M12 19.5V6.5M16 19.5V9.5',
  hbars: 'M4.5 4.5v15M4.5 8h8.5M4.5 12h13M4.5 16h6',
  line: 'M4.5 19.5h15M5 16l4.4-4.4 3.4 2.9L19 8',
  donut: 'M12 4.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15zM12 8.8a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4zM12 4.5v4.3M18.4 15.9l-3.6-2.3',
  ring: 'M12 4.5a7.5 7.5 0 1 1-7.5 7.5',
  pick: 'M4.8 19.2l1-3.3 8.9-8.9 2.3 2.3-8.9 8.9zM13.4 5.7l1.8-1.8a1.7 1.7 0 0 1 2.4 0l2.5 2.5a1.7 1.7 0 0 1 0 2.4l-1.8 1.8z',
} as const;
export type GlyphName = keyof typeof GLYPHS;

/** One glyph, coloured by what it sits in. Decoration beside a label, like Icon.tsx's. */
export function Glyph({ name, size = 16, className }: { name: GlyphName; size?: number; className?: string }) {
  const d: string = GLYPHS[name];
  const dots = d.startsWith('.');
  return (
    <svg className={className ? `mo-glyph ${className}` : 'mo-glyph'} width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth={dots ? 2.8 : 1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={dots ? d.slice(1) : d} />
    </svg>
  );
}

// ── numbers ───────────────────────────────────────────────────────────────

/** A number as a box shows it: `digits` after the point at most — exactly, when `fixed` — and never "-0". */
export function fmtNum(v: number, digits: number, fixed = false): string {
  if (!Number.isFinite(v)) return '';
  const r = Number(v.toFixed(digits)) || 0;
  const s = r.toFixed(digits);
  return fixed || !s.includes('.') ? s : s.replace(/\.?0+$/, '');
}

/**
 * What was typed, as a number, or null while it is not one yet. Arabic-Indic
 * and Persian digits, the Arabic decimal separator, a comma as the point and a
 * typographic minus are all read.
 */
export function parseNum(s: string): number | null {
  const plain = s
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/[\u066B,]/g, '.')
    .replace(/[\u2212\u2013]/g, '-')
    .replace(/\s+/g, '');
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(plain)) return null;
  const n = Number(plain);
  return Number.isFinite(n) ? n : null;
}

const snap = (v: number, q: number) => (q > 0 ? Math.round(v / q) * q : v);
const within = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface NumberProps {
  /** What the value is: the row's label, or a bare box's accessible name. */
  label: string;
  value: number;
  /** Called with the stored value (the shown one divided by `scale`), held in `min`..`max`. */
  onChange: (v: number) => void;
  /** In shown units, like `step`. */
  min?: number;
  max?: number;
  step?: number;
  /** Most digits after the point. */
  digits?: number;
  /** Always show `digits` of them: times, which read as a column. */
  fixed?: boolean;
  unit?: string;
  /** What the unit means, for its tooltip. */
  unitTitle?: string;
  /** The value is shown multiplied by this: an opacity of 0..1 as 0..100 %. */
  scale?: number;
  /** Words shown in place of 0, which means something here ("Auto"). */
  zero?: string;
  /** A bare box's mark, which is also its drag handle. */
  glyph?: GlyphName;
  disabled?: boolean;
  /** The row label's id, when the label is written elsewhere. */
  labelledBy?: string;
  className?: string;
}

/** A number's box and its label's drag, shared by the bare box and the row. */
function useNumber(p: NumberProps) {
  const { min = -Infinity, max = Infinity, step = 1, digits = 2, scale = 1 } = p;
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const atFocus = useRef(p.value);
  const shown = p.value * scale;
  const pretty = (v: number) => fmtNum(v, digits, p.fixed);
  const text = draft ?? (p.zero !== undefined && p.value === 0 ? '' : pretty(shown));

  /** Send a shown value, held in range; returns what was sent, as shown. */
  const commit = (v: number): number => {
    const held = within(v, min, max);
    const stored = Number((held / scale).toFixed(digits + (scale === 1 ? 0 : 2)));
    if (stored !== p.value) p.onChange(stored);
    return held;
  };

  const drag = useRef<{ id: number; x: number; v: number; moved: boolean } | null>(null);
  const scrub = {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (p.disabled || e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { id: e.pointerId, x: e.clientX, v: shown, moved: false };
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      if (!d.moved && Math.abs(dx) < 3) return;
      d.moved = true;
      const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      // Two pixels a step: a drag across a narrow column still reaches far.
      const v = commit(snap(d.v + Math.round(dx / 2) * step * k, step * k));
      if (draft !== null) setDraft(pretty(v));
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      const d = drag.current;
      drag.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      // A press that never moved is a click on the label: it goes to the box.
      if (d && !d.moved) input.current?.focus();
    },
    onPointerCancel: () => { drag.current = null; },
  };

  const inputProps = {
    ref: input,
    type: 'text',
    inputMode: 'decimal' as const,
    spellCheck: false,
    autoComplete: 'off',
    dir: 'ltr' as const,
    role: 'spinbutton',
    value: text,
    placeholder: p.zero,
    disabled: p.disabled,
    'aria-valuenow': Number.isFinite(shown) ? Number(shown.toFixed(digits)) : undefined,
    'aria-valuemin': Number.isFinite(min) ? min : undefined,
    'aria-valuemax': Number.isFinite(max) ? max : undefined,
    'aria-valuetext': p.zero !== undefined && p.value === 0 ? p.zero : `${pretty(shown)}${p.unit ? ` ${p.unit}` : ''}`,
    onFocus: (e: ReactFocusEvent<HTMLInputElement>) => {
      atFocus.current = p.value;
      setDraft(text);
      const el = e.currentTarget;
      requestAnimationFrame(() => { if (document.activeElement === el) el.select(); });
    },
    onBlur: () => setDraft(null),
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const s = e.target.value;
      setDraft(s);
      if (!s.trim() && p.zero !== undefined) { commit(0); return; }
      const n = parseNum(s);
      if (n !== null) commit(n);
    },
    onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
        const base = parseNum(draft ?? '') ?? shown;
        const v = commit(snap(base + (e.key === 'ArrowUp' ? 1 : -1) * step * k, step * k));
        setDraft(pretty(v));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const n = parseNum(draft ?? '');
        const v = n === null ? shown : commit(n);
        setDraft(p.zero !== undefined && v === 0 ? '' : pretty(v));
        e.currentTarget.select();
      } else if (e.key === 'Escape') {
        // The value goes back to what it was; the Escape goes on to what holds the box — a colour's popover closes
        // and gives the focus to its swatch, the full window takes the focus from the field — so it is never left
        // on nothing, where the studio's keys no longer reach.
        if (atFocus.current !== p.value) p.onChange(atFocus.current);
        setDraft(null);
      }
    },
  };
  return { inputProps, scrub };
}

/** The box itself: the number, its unit, and the glyph that drags it. */
function Box({ p, n, id }: { p: NumberProps; n: ReturnType<typeof useNumber>; id?: string }) {
  return (
    <div className={`mo-num${p.disabled ? ' is-off' : ''}${p.className ? ` ${p.className}` : ''}`} dir="ltr">
      {p.glyph && (
        <span className="mo-num-glyph mo-scrub" title={p.label} {...n.scrub}>
          <Glyph name={p.glyph} size={13} />
        </span>
      )}
      <input id={id} {...n.inputProps} aria-label={p.labelledBy ? undefined : p.label} aria-labelledby={p.labelledBy} />
      {p.unit && <span className="mo-num-unit" title={p.unitTitle}>{p.unit}</span>}
    </div>
  );
}

/** A number as a bare box, to sit beside another in one row. */
export function NumberBox(p: NumberProps) {
  const n = useNumber(p);
  return <Box p={p} n={n} />;
}

/** A number in a row of its own: its label drags it. */
export function NumberField(p: NumberProps & { hint?: ReactNode }) {
  const n = useNumber(p);
  const id = useId();
  return (
    <div className="mo-row">
      <span className="mo-label mo-scrub" id={`${id}l`} {...n.scrub}>{p.label}</span>
      <div className="mo-ctl">
        <Box p={{ ...p, labelledBy: `${id}l` }} n={n} id={id} />
        {p.hint}
      </div>
    </div>
  );
}

/** A number with a slider beside it, for a value whose range is the point: opacity, speed, density. */
export function SliderField(p: NumberProps & { min: number; max: number }) {
  const n = useNumber(p);
  const id = useId();
  const scale = p.scale ?? 1;
  const step = p.step ?? 1;
  return (
    <div className="mo-row">
      <span className="mo-label mo-scrub" id={`${id}l`} {...n.scrub}>{p.label}</span>
      <div className="mo-ctl">
        <input type="range" className="mo-range" min={p.min} max={p.max} step={step} value={p.value * scale} disabled={p.disabled}
               aria-labelledby={`${id}l`} aria-valuetext={`${fmtNum(p.value * scale, p.digits ?? 2)}${p.unit ? ` ${p.unit}` : ''}`}
               onChange={(e) => {
                 const v = Number(e.target.value);
                 if (Number.isFinite(v)) p.onChange(Number((v / scale).toFixed((p.digits ?? 2) + 2)));
               }} />
        <Box p={{ ...p, labelledBy: `${id}l`, className: 'mo-num-short' }} n={n} />
      </div>
    </div>
  );
}

// ── rows ──────────────────────────────────────────────────────────────────

/** A label and whatever controls it names. */
export function Row({ label, children, htmlFor, id, className, title }: {
  label: ReactNode;
  children: ReactNode;
  /** The one control the label names, so a click on it goes there. */
  htmlFor?: string;
  id?: string;
  className?: string;
  title?: string;
}) {
  return (
    <div className={className ? `mo-row ${className}` : 'mo-row'}>
      {htmlFor
        ? <label className="mo-label" htmlFor={htmlFor} id={id} title={title}>{label}</label>
        : <span className="mo-label" id={id} title={title}>{label}</span>}
      <div className="mo-ctl">{children}</div>
    </div>
  );
}

/** A heading inside a section, for a group of rows that belong together: the highlight, the roll. */
export function Sub({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="mo-sub">
      <span>{children}</span>
      {extra}
    </div>
  );
}

/** A heading with a switch: a group of rows that exists only while it is on — a stroke, a shadow. */
export function SubToggle({ label, checked, onChange, disabled }: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="mo-sub mo-sub-toggle">
      <span>{label}</span>
      <span className="vid-sound-switch">
        <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <i aria-hidden="true" />
      </span>
    </label>
  );
}

/** One section of the inspector, folded or open. The header says, folded, what is in it. */
export function Section({ title, open, onToggle, summary, children }: {
  title: string;
  open: boolean;
  onToggle: () => void;
  /** A few words shown on the header while it is folded. */
  summary?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className={`mo-sec${open ? ' is-open' : ''}`}>
      <h3 className="mo-sec-h">
        <button type="button" className="mo-sec-btn" aria-expanded={open} aria-controls={id} onClick={onToggle}>
          <Icon name="chevron" size={11} className="mo-sec-caret" />
          <span className="mo-sec-title">{title}</span>
          {!open && summary && <span className="mo-sec-sum"><bdi>{summary}</bdi></span>}
        </button>
      </h3>
      {open && <div className="mo-sec-body" id={id}>{children}</div>}
    </section>
  );
}

// ── choices ───────────────────────────────────────────────────────────────

export interface Choice<V extends string> {
  value: V;
  label: string;
  /** One line about it, as a tooltip. */
  title?: string;
  glyph?: GlyphName;
  /** Drawn instead of the label (the label stays its accessible name). */
  content?: ReactNode;
  style?: CSSProperties;
}

/** A native select of choices. A value that is not among them is kept and shown as `other`. */
export function SelectField<V extends string>({ label, value, choices, onChange, other, disabled, after }: {
  label: string;
  value: string;
  choices: readonly Choice<V>[];
  onChange: (v: V) => void;
  other?: string;
  disabled?: boolean;
  /** Something beside the select: a curve's picture. */
  after?: ReactNode;
}) {
  const id = useId();
  const current = choices.find((c) => c.value === value);
  return (
    <Row label={label} htmlFor={id}>
      <select id={id} className="mo-sel" value={value} disabled={disabled} title={current?.title}
              onChange={(e) => onChange(e.target.value as V)}>
        {!current && <option value={value}>{other ?? value}</option>}
        {choices.map((c) => <option key={c.value} value={c.value} title={c.title}>{c.label}</option>)}
      </select>
      {after}
    </Row>
  );
}

/**
 * Segments: the choices side by side, because comparing them is the choice.
 * A radio group — one tab stop, the arrow keys move and choose — laid out in
 * `dir` (the graphic's, for choices that are sides of its frame).
 */
export function Seg<V extends string>({ label, labelledBy, value, choices, onChange, columns, dir, disabled, className }: {
  /** The group's accessible name, when no row label names it. */
  label?: string;
  labelledBy?: string;
  value: string;
  choices: readonly Choice<V>[];
  onChange: (v: V) => void;
  columns?: number;
  dir?: 'ltr' | 'rtl';
  disabled?: boolean;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const at = choices.findIndex((c) => c.value === value);
  const move = (e: ReactKeyboardEvent, i: number) => {
    const n = choices.length;
    const rtl = (dir ?? (getComputedStyle(e.currentTarget).direction as 'ltr' | 'rtl')) === 'rtl';
    const cols = columns ?? n;
    let j = -1;
    if (e.key === 'ArrowRight') j = i + (rtl ? -1 : 1);
    else if (e.key === 'ArrowLeft') j = i + (rtl ? 1 : -1);
    else if (e.key === 'ArrowDown') j = cols < n ? i + cols : i + 1;
    else if (e.key === 'ArrowUp') j = cols < n ? i - cols : i - 1;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = n - 1;
    else return;
    e.preventDefault();
    j = (j + n) % n;
    onChange(choices[j].value);
    box.current?.querySelectorAll<HTMLButtonElement>('button')[j]?.focus();
  };
  return (
    <div ref={box} className={`mo-seg${columns ? ' is-grid' : ''}${className ? ` ${className}` : ''}`} role="radiogroup" aria-label={label} aria-labelledby={labelledBy}
         dir={dir} style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
      {choices.map((c, i) => (
        <button key={c.value} type="button" role="radio" aria-checked={c.value === value} className={c.value === value ? 'on' : ''}
                tabIndex={i === (at < 0 ? 0 : at) ? 0 : -1} disabled={disabled} title={c.title ?? (c.glyph || c.content ? c.label : undefined)}
                aria-label={c.glyph || c.content ? c.label : undefined} style={c.style}
                onClick={() => onChange(c.value)} onKeyDown={(e) => move(e, i)}>
          {c.glyph ? <Glyph name={c.glyph} size={15} /> : c.content ?? c.label}
        </button>
      ))}
    </div>
  );
}

/** Segments in a row with their label. */
export function SegField<V extends string>(p: {
  label: string;
  value: string;
  choices: readonly Choice<V>[];
  onChange: (v: V) => void;
  columns?: number;
  dir?: 'ltr' | 'rtl';
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <Row label={p.label} id={id}>
      <Seg labelledBy={id} value={p.value} choices={p.choices} onChange={p.onChange} columns={p.columns} dir={p.dir}
           disabled={p.disabled} className={p.className} />
    </Row>
  );
}

/** A yes or a no, as a switch. The whole row is the switch's label. */
export function ToggleField({ label, checked, onChange, disabled, hint }: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className={`mo-row mo-toggle${disabled ? ' is-off' : ''}`} title={hint}>
      <span className="mo-label">{label}</span>
      <span className="mo-ctl">
        <span className="vid-sound-switch">
          <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
          <i aria-hidden="true" />
        </span>
        {hint && <small className="mo-hint">{hint}</small>}
      </span>
    </label>
  );
}

// ── words ─────────────────────────────────────────────────────────────────

const loose = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * What a field shows while it has the focus: what was typed. Replaced when the
 * value is changed from elsewhere meanwhile (unless `keep`: a highlight that
 * is not in the words yet reads back as nothing, and must not wipe the box).
 */
function useDraft(value: string, keep = false) {
  const [draft, setDraft] = useState<string | null>(null);
  const sent = useRef('');
  const last = useRef(value);
  useEffect(() => {
    if (last.current === value) return;
    last.current = value;
    if (!keep && draft !== null && loose(value) !== loose(sent.current)) setDraft(value);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    shown: draft ?? value,
    focus: () => { sent.current = value; setDraft(value); },
    blur: () => setDraft(null),
    type: (s: string) => { sent.current = s; setDraft(s); },
  };
}

/** A line of words. */
export function TextField({ label, value, onChange, maxLength, placeholder, dir = 'auto', keep, hint, invalid, mono }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  placeholder?: string;
  dir?: 'auto' | 'ltr';
  keep?: boolean;
  hint?: ReactNode;
  invalid?: boolean;
  mono?: boolean;
}) {
  const id = useId();
  const d = useDraft(value, keep);
  return (
    <Row label={label} htmlFor={id}>
      <input id={id} className={`mo-text${mono ? ' is-mono' : ''}`} value={d.shown} dir={dir} maxLength={maxLength} placeholder={placeholder}
             spellCheck={false} aria-invalid={invalid || undefined} onFocus={d.focus} onBlur={d.blur}
             onChange={(e) => { d.type(e.target.value); onChange(e.target.value); }} />
      {hint}
    </Row>
  );
}

/** A line of words as a bare box, for a table's cell. */
export function TextBox({ label, value, onChange, maxLength, placeholder, className }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  placeholder?: string;
  className?: string;
}) {
  const d = useDraft(value);
  return (
    <input className={`mo-text${className ? ` ${className}` : ''}`} value={d.shown} dir="auto" maxLength={maxLength} placeholder={placeholder}
           aria-label={label} spellCheck={false} onFocus={d.focus} onBlur={d.blur}
           onChange={(e) => { d.type(e.target.value); onChange(e.target.value); }} />
  );
}

/** Several lines of words, across the whole width, with how many are left when that is getting close. */
export function TextArea({ label, value, onChange, maxLength, rows = 3, dir = 'auto', mono, hint, invalid, placeholder, keep, bare }: {
  label: string;
  /** No label above: the section's title already says what it is. */
  bare?: boolean;
  value: string;
  onChange: (v: string) => void;
  maxLength: number;
  rows?: number;
  dir?: 'auto' | 'ltr';
  mono?: boolean;
  hint?: ReactNode;
  invalid?: boolean;
  placeholder?: string;
  keep?: boolean;
}) {
  const id = useId();
  const d = useDraft(value, keep);
  const used = Array.from(d.shown).length;
  return (
    <div className="mo-area">
      {(!bare || used > maxLength * 0.8) && (
        <div className="mo-area-top">
          {bare ? <span /> : <label className="mo-label" htmlFor={id}>{label}</label>}
          {used > maxLength * 0.8 && <span className="mo-count" dir="ltr">{`${used} / ${maxLength}`}</span>}
        </div>
      )}
      <textarea id={id} className={`mo-textarea${mono ? ' is-mono' : ''}`} rows={rows} value={d.shown} dir={dir} maxLength={maxLength * 2}
                aria-label={bare ? label : undefined}
                placeholder={placeholder} spellCheck={!mono} aria-invalid={invalid || undefined} onFocus={d.focus} onBlur={d.blur}
                onChange={(e) => {
                  const s = Array.from(e.target.value).slice(0, maxLength).join('');
                  d.type(s);
                  onChange(s);
                }} />
      {hint}
    </div>
  );
}

// ── colour ────────────────────────────────────────────────────────────────

/** A palette colour's name, as the swatch and its tooltip say it — the Design tab's words for the five (motionstate.ts). */
export function toneName(tone: Tone, t: T): string {
  if (tone === 'bg') return t('Background');
  if (tone === 'fg') return t('Text colour');
  if (tone === 'accent') return t('Accent colour');
  if (tone === 'accent2') return t('Second accent');
  return t('Muted colour');
}

/** A colour — a palette token or a hex value — as CSS draws it. */
export function cssColour(c: string, palette: Palette): string {
  return isTone(c) ? palette[c] : c;
}

/** A paint as a CSS background: a colour, or a gradient drawn the way the renderer draws it. */
export function cssPaint(p: Paint | null, palette: Palette): string {
  if (p === null) return 'transparent';
  if (typeof p === 'string') return cssColour(p, palette);
  const stops = p.stops.map((s) => `${cssColour(s.color, palette)} ${Math.round(s.at * 1000) / 10}%`).join(', ');
  // The renderer's angle is clockwise from +x; CSS's is clockwise from the top.
  if (p.kind === 'radial') return `radial-gradient(circle, ${stops})`;
  if (p.kind === 'conic') return `conic-gradient(from ${p.angle + 90}deg, ${stops})`;
  return `linear-gradient(${p.angle + 90}deg, ${stops})`;
}

/** A colour's name as the swatch shows it: the palette's word, or the hex value. */
function colourName(c: string, t: T): string {
  return isTone(c) ? toneName(c, t) : c.toUpperCase();
}

/** The six hex digits a native colour input takes, alpha dropped. */
function hex6(c: string): string {
  const m = /^#([0-9a-f]{6})/i.exec(c);
  if (m) return `#${m[1].toLowerCase()}`;
  const s = /^#([0-9a-f])([0-9a-f])([0-9a-f])/i.exec(c);
  return s ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase() : '#000000';
}

/** A hex colour as typed, written the one way the reader writes it; null while it is not one. */
export function readHex(s: string): string | null {
  const m = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s.trim());
  if (!m) return null;
  const d = m[1].length <= 4 ? m[1].replace(/./g, '$&$&') : m[1];
  return `#${(d.length === 8 && /ff$/i.test(d) ? d.slice(0, 6) : d).toLowerCase()}`;
}

/** A square of colour, over the transparency checkerboard. */
function Chip({ paint, none }: { paint: string; none?: boolean }) {
  return (
    <span className={`mo-chip${none ? ' is-none' : ''}`} aria-hidden="true">
      <i style={{ background: paint }} />
    </span>
  );
}

/**
 * A floating panel under its button: a colour's choices. Closed by a press
 * outside it, by Escape (focus back on its button), or by Tab leaving it.
 * It opens upward when there is no room below.
 */
function Popover({ label, anchor, onClose, children, wide }: {
  label: string;
  anchor: RefObject<HTMLElement>;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [up, setUp] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const a = anchor.current?.getBoundingClientRect();
    if (a && r.bottom > window.innerHeight - 8 && a.top - r.height - 8 > 0) setUp(true);
    // The chosen colour first, then the chosen mode, then whatever comes first.
    const first = el.querySelector<HTMLElement>('[aria-pressed="true"]') ?? el.querySelector<HTMLElement>('[aria-checked="true"]')
      ?? el.querySelector<HTMLElement>('input, button');
    first?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target || box.current?.contains(target) || anchor.current?.contains(target)) return;
      close.current();
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [anchor]);
  return (
    <div ref={box} className={`mo-pop${up ? ' is-up' : ''}${wide ? ' is-wide' : ''}`} role="dialog" aria-label={label}
         onKeyDown={(e) => {
           if (e.key !== 'Escape') return;
           e.preventDefault();
           e.stopPropagation();
           close.current();
           anchor.current?.focus();
         }}
         onBlur={(e) => {
           const next = e.relatedTarget as Node | null;
           if (next && !box.current?.contains(next) && !anchor.current?.contains(next)) close.current();
         }}>
      {children}
    </div>
  );
}

/** The five palette colours, a hex value and the system's picker. */
function ColourPicker({ t, value, palette, onChange }: { t: T; value: string; palette: Palette; onChange: (c: string) => void }) {
  const [hex, setHex] = useState<string | null>(null);
  const resolved = cssColour(value, palette);
  const shownHex = hex ?? resolved.replace(/^#/, '').toUpperCase();
  return (
    <div className="mo-picker">
      <div className="mo-tones" role="group" aria-label={t('Palette')}>
        {TONES.map((tone) => (
          <button key={tone} type="button" className="mo-tone" aria-pressed={value === tone} title={toneName(tone, t)} aria-label={toneName(tone, t)}
                  onClick={() => onChange(tone)}>
            <Chip paint={palette[tone]} />
          </button>
        ))}
      </div>
      <div className="mo-hexrow">
        <div className="mo-num mo-hex" dir="ltr">
          <span className="mo-num-unit" aria-hidden="true">#</span>
          <input value={shownHex} spellCheck={false} autoComplete="off" maxLength={9} aria-label={t('Hex colour')}
                 onFocus={() => setHex(shownHex)}
                 onBlur={() => { const c = hex === null ? null : readHex(hex); if (c && c !== value) onChange(c); setHex(null); }}
                 onKeyDown={(e) => { if (e.key === 'Enter') { const c = hex === null ? null : readHex(hex); if (c) onChange(c); } }}
                 onChange={(e) => {
                   const s = e.target.value.replace(/^#/, '');
                   setHex(s);
                   // Six or eight digits while typing; the short forms only when the typing is done, or "4C8" would flash a colour on the way to "4C8DFF".
                   if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s.trim())) { const c = readHex(s); if (c) onChange(c); }
                 }} />
        </div>
        <label className="mo-native" title={t('Custom colour')}>
          <input type="color" value={hex6(resolved)} aria-label={t('Custom colour')} onChange={(e) => onChange(e.target.value.toLowerCase())} />
          <Glyph name="pick" size={14} />
        </label>
      </div>
    </div>
  );
}

/** The button a colour's popover hangs from: the colour, and its name. */
function Swatch({ bref, paint, name, none, open, onClick, labelledBy, disabled }: {
  bref: RefObject<HTMLButtonElement>;
  paint: string;
  name: string;
  none?: boolean;
  open: boolean;
  onClick: () => void;
  labelledBy: string;
  disabled?: boolean;
}) {
  const nameId = useId();
  return (
    <button ref={bref} type="button" className="mo-swatch" aria-haspopup="dialog" aria-expanded={open} disabled={disabled}
            aria-labelledby={`${labelledBy} ${nameId}`} onClick={onClick}>
      <Chip paint={paint} none={none} />
      <span className="mo-swatch-name" id={nameId}><bdi>{name}</bdi></span>
    </button>
  );
}

/**
 * A colour's swatch and its popover, without a row: one of a list of
 * colours, drawn as a chip alone (`compact`), with a way to take it out of the
 * list when it can be (`onRemove`).
 */
export function ColorBox({ t, label, labelledBy, value, palette, onChange, onRemove, compact, disabled }: {
  t: T;
  label: string;
  labelledBy?: string;
  value: string;
  palette: Palette;
  onChange: (c: string) => void;
  onRemove?: () => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const name = colourName(value, t);
  return (
    <div className="mo-pop-anchor">
      {compact
        ? (
          <button ref={btn} type="button" className="mo-tone mo-colour-chip" aria-haspopup="dialog" aria-expanded={open} disabled={disabled}
                  aria-label={`${label}: ${name}`} title={name} onClick={() => setOpen(!open)}>
            <Chip paint={cssColour(value, palette)} />
          </button>
        )
        : <Swatch bref={btn} paint={cssColour(value, palette)} name={name} open={open} labelledBy={labelledBy ?? ''} disabled={disabled}
                  onClick={() => setOpen(!open)} />}
      {open && (
        <Popover label={label} anchor={btn} onClose={() => setOpen(false)}>
          <ColourPicker t={t} value={value} palette={palette} onChange={onChange} />
          {onRemove && (
            <button type="button" className="ghost mo-pop-remove" onClick={() => { setOpen(false); onRemove(); }}>
              <Icon name="close" size={11} />{t('Remove this colour')}
            </button>
          )}
        </Popover>
      )}
    </div>
  );
}

/** A colour: one of the palette's five, or a hex value. */
export function ColorField({ t, label, value, palette, onChange, disabled }: {
  t: T;
  label: string;
  value: string;
  palette: Palette;
  onChange: (c: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Row label={label} id={id}>
      <ColorBox t={t} label={label} labelledBy={id} value={value} palette={palette} onChange={onChange} disabled={disabled} />
    </Row>
  );
}

type PaintMode = 'none' | 'solid' | 'gradient';

/** A gradient from one colour, to start the editor with: that colour into another of the palette's. */
function gradientFrom(c: string): Gradient {
  return { kind: 'linear', angle: 90, stops: [{ at: 0, color: c }, { at: 1, color: c === 'accent2' ? 'accent' : 'accent2' }] };
}

/** A paint: a colour, a gradient, or — where the layer may have none — nothing. */
export function PaintField({ t, label, value, palette, onChange, nullable, disabled }: {
  t: T;
  label: string;
  value: Paint | null;
  palette: Palette;
  onChange: (p: Paint | null) => void;
  nullable?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  // What "Colour" or "Gradient" comes back to after "None".
  const last = useRef<Paint>(value ?? 'accent');
  if (value !== null) last.current = value;
  const mode: PaintMode = value === null ? 'none' : typeof value === 'string' ? 'solid' : 'gradient';
  const name = value === null ? t('None') : typeof value === 'string' ? colourName(value, t) : t('Gradient');
  const choose = (m: PaintMode) => {
    if (m === mode) return;
    if (m === 'none') onChange(null);
    else if (m === 'solid') onChange(typeof last.current === 'string' ? last.current : last.current.stops[0]?.color ?? 'accent');
    else onChange(typeof last.current === 'string' ? gradientFrom(last.current) : last.current);
  };
  const modes: Choice<PaintMode>[] = [
    ...(nullable ? [{ value: 'none' as const, label: t('None') }] : []),
    { value: 'solid', label: t('Colour') },
    { value: 'gradient', label: t('Gradient') },
  ];
  return (
    <Row label={label} id={id}>
      <div className="mo-pop-anchor">
        <Swatch bref={btn} paint={cssPaint(value, palette)} name={name} none={value === null} open={open} labelledBy={id} disabled={disabled}
                onClick={() => setOpen(!open)} />
        {open && (
          <Popover label={label} anchor={btn} onClose={() => setOpen(false)} wide={mode === 'gradient'}>
            <Seg label={label} value={mode} choices={modes} onChange={choose} className="mo-seg-modes" />
            {mode === 'solid' && typeof value === 'string' && <ColourPicker t={t} value={value} palette={palette} onChange={onChange} />}
            {mode === 'gradient' && value !== null && typeof value !== 'string' && (
              <GradientEditor t={t} value={value} palette={palette} onChange={onChange} />
            )}
          </Popover>
        )}
      </div>
    </Row>
  );
}

/**
 * A gradient: its kind and angle, and its stops on a bar — press one to
 * colour it, drag it (or use the arrow keys on it) to move it. Two to four
 * stops. The bar runs left to right in every language, as the angle does.
 */
function GradientEditor({ t, value, palette, onChange }: { t: T; value: Gradient; palette: Palette; onChange: (g: Gradient) => void }) {
  const [sel, setSel] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const stops = value.stops;
  const at = Math.min(sel, stops.length - 1);
  const stop = stops[at];

  /** Stops in order, with the one at `i` changed, and the choice following it to its new place. */
  const put = (i: number, patch: Partial<Gradient['stops'][number]>) => {
    const next = stops.map((s, k) => ({ s: k === i ? { ...s, ...patch } : s, k }));
    next.sort((a, b) => a.s.at - b.s.at);
    setSel(next.findIndex((x) => x.k === i));
    onChange({ ...value, stops: next.map((x) => x.s) });
  };
  const posAt = (clientX: number) => {
    const r = bar.current?.getBoundingClientRect();
    return r && r.width > 0 ? Math.round(within((clientX - r.left) / r.width, 0, 1) * 100) / 100 : 0;
  };
  const add = () => {
    const other = stops[at + 1] ?? stops[at - 1];
    const mid = other ? Math.round(((stop.at + other.at) / 2) * 100) / 100 : 0.5;
    const next = [...stops, { at: mid, color: stop.color }].sort((a, b) => a.at - b.at);
    setSel(next.findIndex((s) => s.at === mid));
    onChange({ ...value, stops: next });
  };
  const remove = () => {
    if (stops.length <= 2) return;
    setSel(Math.max(0, at - 1));
    onChange({ ...value, stops: stops.filter((_, k) => k !== at) });
  };
  const flat = `linear-gradient(to right, ${stops.map((s) => `${cssColour(s.color, palette)} ${s.at * 100}%`).join(', ')})`;
  const kinds: Choice<Gradient['kind']>[] = [
    { value: 'linear', label: t('Linear') },
    { value: 'radial', label: t('Radial') },
    { value: 'conic', label: t('Conic') },
  ];
  return (
    <div className="mo-grad">
      <div className="mo-grad-top">
        <Seg label={t('Gradient')} value={value.kind} choices={kinds} onChange={(kind) => onChange({ ...value, kind })} />
        {value.kind !== 'radial' && (
          <NumberBox label={t('Angle')} glyph="rotate" value={value.angle} min={-360} max={360} step={1} digits={0} unit="°"
                     className="mo-num-short" onChange={(angle) => onChange({ ...value, angle })} />
        )}
      </div>
      <div className="mo-grad-track" dir="ltr">
        <div ref={bar} className="mo-grad-bar"><i style={{ background: flat }} /></div>
        {stops.map((s, i) => (
          <button key={i} type="button" className={`mo-stop${i === at ? ' is-on' : ''}`} aria-pressed={i === at}
                  aria-label={`${colourName(s.color, t)} · ${Math.round(s.at * 100)}%`} title={`${colourName(s.color, t)} · ${Math.round(s.at * 100)}%`}
                  style={{ insetInlineStart: `${s.at * 100}%` }}
                  onClick={() => setSel(i)}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    setSel(i);
                    drag.current = e.pointerId;
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => { if (drag.current === e.pointerId) put(i, { at: posAt(e.clientX) }); }}
                  onPointerUp={(e) => {
                    drag.current = null;
                    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                    e.preventDefault();
                    const k = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 0.1 : 0.01);
                    put(i, { at: Math.round(within(s.at + k, 0, 1) * 100) / 100 });
                  }}>
            <i style={{ background: cssColour(s.color, palette) }} />
          </button>
        ))}
      </div>
      <ColourPicker t={t} value={stop.color} palette={palette} onChange={(color) => put(at, { color })} />
      <div className="mo-grad-foot">
        <NumberBox label={t('Position')} glyph="across" value={stop.at} scale={100} min={0} max={100} step={1} digits={0} unit="%"
                   className="mo-num-short" onChange={(v) => put(at, { at: v })} />
        <button type="button" className="mo-icon-btn" disabled={stops.length <= 2} onClick={remove}
                title={t('Remove this stop')} aria-label={t('Remove this stop')}>
          <Icon name="close" size={12} />
        </button>
        <button type="button" className="ghost mo-add-stop" disabled={stops.length >= 4} onClick={add}>
          <Icon name="plus" size={11} />{t('Add a stop')}
        </button>
      </div>
    </div>
  );
}

// ── where and when ────────────────────────────────────────────────────────

const PIN_ROWS = ['t', 'm', 'b'] as const;
const PIN_COLS = ['s', 'c', 'e'] as const;

/** A pin's name, in the words the Video studio already uses for the corners of a frame. */
export function pinName(pin: Pin, t: T): string {
  if (pin === 'ts') return t('Top corner, reading side');
  if (pin === 'tc') return t('Top centre');
  if (pin === 'te') return t('Top corner, far side');
  if (pin === 'ms') return t('Middle, reading side');
  if (pin === 'mc') return t('Centre');
  if (pin === 'me') return t('Middle, far side');
  if (pin === 'bs') return t('Bottom corner, reading side');
  if (pin === 'bc') return t('Bottom centre');
  return t('Bottom corner, far side');
}

/**
 * The nine points of the frame a layer is pinned to, as a small frame of
 * nine dots — the chosen one filled. Laid out in the graphic's direction, so
 * the reading side is where it is in the picture: on the right for Arabic.
 */
export function PinGrid({ t, value, onChange, rtl, labelledBy }: {
  t: T;
  value: Pin;
  onChange: (p: Pin) => void;
  rtl: boolean;
  labelledBy?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const pins = PIN_ROWS.flatMap((r) => PIN_COLS.map((c) => `${r}${c}` as Pin));
  const at = Math.max(0, pins.indexOf(value));
  const key = (e: ReactKeyboardEvent) => {
    const row = Math.floor(at / 3);
    const col = at % 3;
    let r = row;
    let c = col;
    if (e.key === 'ArrowUp') r = (row + 2) % 3;
    else if (e.key === 'ArrowDown') r = (row + 1) % 3;
    else if (e.key === 'ArrowRight') c = (col + (rtl ? 2 : 1)) % 3;
    else if (e.key === 'ArrowLeft') c = (col + (rtl ? 1 : 2)) % 3;
    else return;
    e.preventDefault();
    const j = r * 3 + c;
    onChange(pins[j]);
    box.current?.querySelectorAll<HTMLButtonElement>('button')[j]?.focus();
  };
  return (
    <div ref={box} className="mo-pin" role="radiogroup" aria-labelledby={labelledBy} dir={rtl ? 'rtl' : 'ltr'}>
      {pins.map((pin, i) => (
        <button key={pin} type="button" role="radio" aria-checked={i === at} tabIndex={i === at ? 0 : -1} className={i === at ? 'on' : ''}
                title={pinName(pin, t)} aria-label={pinName(pin, t)} onClick={() => onChange(pin)} onKeyDown={key}>
          <i />
        </button>
      ))}
    </div>
  );
}

/** A timing curve's name. */
export function easeName(e: string, t: T): string {
  switch (e) {
    case 'linear': return t('Linear');
    case 'in': return t('Ease in');
    case 'out': return t('Ease out');
    case 'inout': return t('Ease in and out');
    case 'soft': return t('Soft');
    case 'cubic-out': return t('Cubic out');
    case 'quart-out': return t('Quart out');
    case 'expo-out': return t('Expo out');
    case 'expo-inout': return t('Expo in and out');
    case 'circ-out': return t('Circular out');
    case 'back-out': return t('Overshoot');
    case 'back-inout': return t('Overshoot both ways');
    case 'elastic-out': return t('Elastic');
    case 'bounce-out': return t('Bounce');
    case 'spring': return t('Spring');
    case 'snappy': return t('Snappy');
    default: return t('Custom curve');
  }
}

/**
 * A curve, drawn: progress up, time across, sampled from the maths the
 * renderer times with (motionmath.ts), so an overshoot is seen to overshoot.
 * The two faint lines are where it starts and where it rests.
 */
export function EaseCurve({ name }: { name: string }) {
  const f = easeOf(name);
  const W = 44;
  const H = 28;
  const pad = 4;
  const ys: number[] = [];
  let lo = 0;
  let hi = 1;
  for (let i = 0; i <= 40; i++) {
    const y = f(i / 40);
    const v = Number.isFinite(y) ? y : 0;
    ys.push(v);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const sx = (i: number) => pad + (i / 40) * (W - pad * 2);
  const sy = (y: number) => H - pad - ((y - lo) / (hi - lo || 1)) * (H - pad * 2);
  const pts = ys.map((y, i) => `${sx(i).toFixed(1)},${sy(y).toFixed(1)}`).join(' ');
  return (
    <svg className="mo-curve" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
      <path className="mo-curve-guide" d={`M${pad} ${sy(0).toFixed(1)}H${W - pad}M${pad} ${sy(1).toFixed(1)}H${W - pad}`} />
      <polyline points={pts} />
    </svg>
  );
}

/** A timing curve: a select of the named ones, and the curve itself beside it. */
export function EaseField({ t, label, value, onChange, disabled }: {
  t: T;
  label: string;
  value: string;
  onChange: (e: string) => void;
  disabled?: boolean;
}) {
  const choices = EASES.map((e) => ({ value: e, label: easeName(e, t) }));
  return (
    <SelectField label={label} value={value} choices={choices} onChange={onChange} other={easeName(value, t)} disabled={disabled}
                 after={<EaseCurve name={value} />} />
  );
}
