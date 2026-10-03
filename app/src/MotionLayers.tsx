import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { Icon } from './Icon';
import { ContextMenu } from './ContextMenu';
import type { Item } from './menu';
import { fill } from './i18n';
import {
  BLENDS, EFFECTS, LAYER_KINDS, LIMITS, LOOPS, SPLITS, isRtlLang,
  type Anim, type Blend, type Dir4, type Effect, type Layer, type LayerKind, type Loop, type Motion, type Split,
} from './motiontypes';
import { addLayer, duplicateLayer, moveLayer, removeLayer, setLayer } from './motionedit';
import { newLayerId, textShadowMax } from './motionread';
import { scriptOf } from './motionfonts';
import { layerOf, shownName, type InspectorProps, type T } from './motionui';
import { useReorder } from './useReorder';
import {
  ColorField, EaseField, Glyph, NumberBox, NumberField, PinGrid, Row, Section, SegField, SelectField, SliderField, Sub, SubToggle,
  fmtNum, pinName, type Choice,
} from './MotionControls';
import { KIND_GLYPH, KindContent, kindName, kindSummary, secUnit, uTitle } from './MotionKinds';

/**
 * The Layers tab of the Motion studio: the graphic's layers, front first, and
 * under them everything about the one selected.
 *
 * ## The list
 *
 * One row a layer, the front-most at the top as every layer panel draws them
 * (`doc.layers` is back to front, so the rows are it reversed). A row is its
 * kind, its name, and three quiet actions that stay lit when they are on:
 * hidden, locked, and a menu of the rest. Rows are dragged to reorder
 * (useReorder.ts — the row is the handle), or moved with the menu, or with
 * Alt and the arrow keys. The list is one tab stop: the arrow keys move
 * through it and select as they go, Delete removes, F2 renames, ⌘D copies.
 *
 * ## The inspector
 *
 * Below the list rather than inside it. A layer's properties are taller than
 * a column, and opened inside the list they pushed every row after the
 * selected one out of sight; below it, the list stays a short index that is
 * always in reach, and the properties start at the same place whichever layer
 * is chosen. Five sections — what the layer shows (by its kind), where it is,
 * when it is on, how it moves, how it is drawn — each folded or open as it
 * was last left for that kind of layer, and each saying, folded, what is in it.
 *
 * ## Every change is one function
 *
 * Nothing here writes into the graphic. A control calls `onEdit` with a change
 * built from motionedit.ts, keyed `layer:<id>:<field>` so typing a word or
 * dragging a value is one undo step (motionui.ts). A change that depends on
 * the layer as it is — a field inside the entrance, a row of a chart — is
 * worked out inside the change, from the graphic it is applied to, so two
 * quick edits never undo each other.
 */

// ── words ─────────────────────────────────────────────────────────────────

export function effectName(e: Effect, t: T): string {
  switch (e) {
    case 'fade': return t('Fade');
    case 'rise': return t('Rise');
    case 'drop': return t('Drop in');
    case 'slide': return t('Slide');
    case 'pop': return t('Pop');
    case 'zoom': return t('Zoom');
    case 'wipe': return t('Wipe');
    case 'mask': return t('Mask reveal');
    case 'type': return t('Typing');
    case 'blur': return t('Blur');
    case 'spin': return t('Spin');
    case 'flip': return t('Flip');
    case 'grow': return t('Grow');
    case 'draw': return t('Draw on');
    default: return t('None');
  }
}

/** What an effect does, in a line — as an entrance; an exit plays it backwards. From motionanim.ts's numbers. */
export function effectAbout(e: Effect, t: T): string {
  switch (e) {
    case 'fade': return t('Fades up from nothing.');
    case 'rise': return t('Rises a short way into place as it fades in.');
    case 'drop': return t('Drops a short way into place as it fades in.');
    case 'slide': return t('Slides in from one side, solid before it lands.');
    case 'pop': return t('Springs up from small, a little past its size.');
    case 'zoom': return t('Settles from larger to its size as it fades in.');
    case 'wipe': return t('A clean edge uncovers it from one side.');
    case 'mask': return t('Rises from behind its own line: the classic title reveal.');
    case 'type': return t('Its letters appear one after another.');
    case 'blur': return t('Comes into focus from a soft blur.');
    case 'spin': return t('Turns a quarter turn into place, growing as it comes.');
    case 'flip': return t('Flips open about its middle.');
    case 'grow': return t('Extends from its base, like a bar or a rule.');
    case 'draw': return t('Its outline draws itself along its path.');
    default: return '';
  }
}

export function loopName(l: Loop, t: T): string {
  switch (l) {
    case 'float': return t('Float');
    case 'pulse': return t('Pulse');
    case 'spin': return t('Spin');
    case 'sway': return t('Sway');
    case 'breathe': return t('Breathe');
    case 'shimmer': return t('Shimmer');
    default: return t('None');
  }
}

export function loopAbout(l: Loop, t: T): string {
  switch (l) {
    case 'float': return t('Drifts gently up and down.');
    case 'pulse': return t('Swells a little and settles, again and again.');
    case 'spin': return t('Turns round and round.');
    case 'sway': return t('Rocks gently from side to side.');
    case 'breathe': return t('Fades a little and back, slowly.');
    case 'shimmer': return t('A glint of light passes across it.');
    default: return '';
  }
}

function blendName(b: Blend, t: T): string {
  if (b === 'screen') return t('Screen');
  if (b === 'multiply') return t('Multiply');
  if (b === 'overlay') return t('Overlay');
  if (b === 'lighter') return t('Additive');
  return t('Normal');
}

function splitName(s: Split, t: T): string {
  if (s === 'line') return t('Line by line');
  if (s === 'word') return t('Word by word');
  if (s === 'char') return t('Letter by letter');
  return t('All at once');
}

/** Which way an effect comes from. The arrow is the way it moves, drawn in the graphic's direction. */
function dirChoice(d: Dir4, t: T, rtl: boolean): Choice<Dir4> {
  if (d === 'up') return { value: d, label: t('From below'), glyph: 'up' };
  if (d === 'down') return { value: d, label: t('From above'), glyph: 'down' };
  if (d === 'start') return { value: d, label: t('From the reading side'), glyph: rtl ? 'left' : 'right' };
  return { value: d, label: t('From the far side'), glyph: rtl ? 'right' : 'left' };
}

/** The four ways, in the order the segments show them: the two sides of the reading, then below and above. */
const DIR_ORDER: readonly Dir4[] = ['start', 'end', 'up', 'down'];

/** The effects a direction means something to (motionanim.ts). */
const DIRECTED: ReadonlySet<Effect> = new Set<Effect>(['slide', 'wipe', 'grow']);

// ── edits ─────────────────────────────────────────────────────────────────

/**
 * A new layer's id is chosen here, so the new layer can be selected at once.
 * `addLayer` and `duplicateLayer` choose their own; when theirs is not this
 * one, the new layer is given this one.
 */
function withId(r: { motion: Motion; id: string }, want: string): Motion {
  if (!r.id || r.id === want || r.motion.layers.some((l) => l.id === want)) return r.motion;
  return { ...r.motion, layers: r.motion.layers.map((l) => (l.id === r.id ? { ...l, id: want } : l)) };
}

/** What a layer starts as beyond its kind's design defaults (motionread.ts's `blankLayer`). */
function startingFields(kind: LayerKind, t: T): Partial<Layer> {
  if (kind === 'text') return { text: t('Your words') } as Partial<Layer>;
  if (kind === 'icon') return { icon: 'sparkle' } as Partial<Layer>;
  return {};
}

/** A name for a new layer: its kind, with a number when that is taken. */
function freshName(kind: LayerKind, doc: Motion, t: T): string {
  const base = kindName(kind, t);
  const taken = new Set(doc.layers.map((l) => l.name));
  if (!taken.has(base)) return base;
  for (let n = 2; n <= LIMITS.layers + 1; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
  return base;
}

// ── the sections, remembered ─────────────────────────────────────────────

type SectionId = 'content' | 'position' | 'timing' | 'animation' | 'style';
const OPEN_FIRST: Readonly<Record<SectionId, boolean>> = { content: true, position: true, timing: true, animation: false, style: false };
/** Which sections were last left open, by kind: kept for as long as the window is, across tabs. */
let remembered: Partial<Record<LayerKind, Partial<Record<SectionId, boolean>>>> = {};

// ── add ───────────────────────────────────────────────────────────────────

/** The eight kinds as tiles, each its glyph and its name: the add menu, and the empty list. */
function KindTiles({ t, onPick, menu, disabled }: { t: T; onPick: (k: LayerKind) => void; menu?: boolean; disabled?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (menu) box.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [menu]);
  const key = (e: ReactKeyboardEvent, i: number) => {
    const n = LAYER_KINDS.length;
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    let j = -1;
    if (e.key === 'ArrowRight') j = i + (rtl ? -1 : 1);
    else if (e.key === 'ArrowLeft') j = i + (rtl ? 1 : -1);
    else if (e.key === 'ArrowDown') j = i + 2;
    else if (e.key === 'ArrowUp') j = i - 2;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = n - 1;
    else return;
    e.preventDefault();
    box.current?.querySelectorAll<HTMLButtonElement>('button')[(j + n) % n]?.focus();
  };
  return (
    <div ref={box} className="mo-kinds" role={menu ? 'menu' : undefined} aria-label={menu ? t('Add a layer') : undefined}>
      {LAYER_KINDS.map((k, i) => (
        <button key={k} type="button" className="mo-kind" role={menu ? 'menuitem' : undefined} disabled={disabled}
                onClick={() => onPick(k)} onKeyDown={(e) => key(e, i)}>
          <span className="mo-kind-glyph"><Glyph name={KIND_GLYPH[k]} size={18} /></span>
          <span>{kindName(k, t)}</span>
        </button>
      ))}
    </div>
  );
}

/** The add button and its menu of kinds, closed by a press outside, Escape, or a choice. */
function AddButton({ t, full, onPick }: { t: T; full: boolean; onPick: (k: LayerKind) => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const at = e.target as Node | null;
      if (at && (pop.current?.contains(at) || btn.current?.contains(at))) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [open]);
  const shut = () => { setOpen(false); btn.current?.focus(); };
  return (
    <div className="mo-pop-anchor">
      <button ref={btn} type="button" className="ghost mo-add" aria-haspopup="menu" aria-expanded={open} disabled={full}
              title={full ? fill(t('A graphic holds at most {n} layers.'), { n: LIMITS.layers }) : undefined}
              onClick={() => setOpen(!open)}>
        <Icon name="plus" size={12} />{t('Add a layer')}
      </button>
      {open && (
        <div ref={pop} className="mo-add-menu"
             onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); shut(); } }}>
          <KindTiles t={t} menu onPick={(k) => { setOpen(false); onPick(k); }} />
        </div>
      )}
    </div>
  );
}

// ── rename ────────────────────────────────────────────────────────────────

/**
 * A name being written: Enter or leaving keeps it, Escape keeps the old one,
 * an empty one is not kept. `byKey` says it was Enter or Escape, when the
 * keyboard goes back where it came from; a click elsewhere keeps its focus.
 */
function RenameInput({ t, name, onDone, className }: {
  t: T;
  name: string;
  onDone: (name: string | null, byKey: boolean) => void;
  className?: string;
}) {
  const [text, setText] = useState(name);
  const done = useRef(false);
  const finish = (v: string | null, byKey: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(v !== null && v.trim() && v.trim() !== name ? v.trim() : null, byKey);
  };
  return (
    <input className={`mo-rename${className ? ` ${className}` : ''}`} value={text} dir="auto" maxLength={LIMITS.name} aria-label={t('Name')}
           data-nodrag="" autoFocus spellCheck={false}
           onFocus={(e) => e.currentTarget.select()}
           onChange={(e) => setText(e.target.value)}
           onBlur={() => finish(text, false)}
           onKeyDown={(e) => {
             e.stopPropagation();
             if (e.key === 'Enter') { e.preventDefault(); finish(text, true); }
             else if (e.key === 'Escape') { e.preventDefault(); finish(null, true); }
           }} />
  );
}

// ── the inspector's own sections ─────────────────────────────────────────

interface EditProps {
  t: T;
  layer: Layer;
  doc: Motion;
  set: (patch: Partial<Layer>, field: string) => void;
  update: (field: string, fn: (l: Layer) => Partial<Layer>) => void;
}

function PositionFields({ t, layer, doc, set }: EditProps) {
  const rtl = isRtlLang(doc.lang);
  const opacity = (
    <SliderField label={t('Opacity')} value={layer.opacity} scale={100} min={0} max={100} step={1} digits={0} unit="%"
                 onChange={(opacity) => set({ opacity }, 'opacity')} />
  );
  if (layer.kind === 'backdrop') {
    return (
      <>
        <p className="mo-hint mo-note">{t('A background always fills the frame.')}</p>
        {opacity}
      </>
    );
  }
  return (
    <>
      <div className="mo-place">
        <Row label={t('Anchor')} id={`mo-anchor-${layer.id}`}>
          <PinGrid t={t} value={layer.pin} rtl={rtl} labelledBy={`mo-anchor-${layer.id}`} onChange={(pin) => set({ pin }, 'pin')} />
          <div className="mo-place-xy">
            <NumberBox label={t('Horizontal')} glyph="across" value={layer.x} min={-LIMITS.reach} max={LIMITS.reach} step={0.5} digits={1} unit="u"
                       unitTitle={uTitle(t)} onChange={(x) => set({ x }, 'x')} />
            <NumberBox label={t('Vertical')} glyph="updown" value={layer.y} min={-LIMITS.reach} max={LIMITS.reach} step={0.5} digits={1} unit="u"
                       unitTitle={uTitle(t)} onChange={(y) => set({ y }, 'y')} />
          </div>
        </Row>
      </div>
      <NumberField label={t('Scale')} value={layer.scale} min={0} max={8} step={0.05} digits={2} unit="×" onChange={(scale) => set({ scale }, 'scale')} />
      <NumberField label={t('Rotation')} value={layer.rot} min={-3600} max={3600} step={1} digits={1} unit="°" onChange={(rot) => set({ rot }, 'rot')} />
      {opacity}
    </>
  );
}

function TimingFields({ t, layer, doc, set }: EditProps) {
  const len = Math.max(0, layer.end - layer.start);
  const whole = Math.max(0.05, doc.seconds);
  const atEnd = layer.end >= doc.seconds - 1e-6;
  return (
    <>
      <NumberField label={t('Starts at')} value={layer.start} min={0} max={Math.max(0, layer.end - 0.05)} step={0.05} digits={2} fixed unit={secUnit(t)}
                   onChange={(start) => set({ start }, 'start')} />
      <NumberField label={t('Ends at')} value={layer.end} min={Math.min(doc.seconds, layer.start + 0.05)} max={doc.seconds} step={0.05} digits={2}
                   fixed unit={secUnit(t)} onChange={(end) => set({ end }, 'end')}
                   hint={(
                     <button type="button" className="ghost mo-to-end" disabled={atEnd} onClick={() => set({ end: doc.seconds }, 'end')}
                             title={fill(t('{n} s'), { n: fmtNum(doc.seconds, 2) })}>
                       <Glyph name="end" size={13} />{t('To the end')}
                     </button>
                   )} />
      <Row label={t('Length')}>
        <span className="mo-readout" dir="ltr">{fill(t('{n} s'), { n: fmtNum(len, 2, true) })}</span>
        <span className="mo-span" dir="ltr" aria-hidden="true">
          <i style={{ insetInlineStart: `${(layer.start / whole) * 100}%`, inlineSize: `${(len / whole) * 100}%` }} />
        </span>
      </Row>
    </>
  );
}

/** One entrance or exit: its effect, and — when it has one — how long, when, on what curve, how strong, which way, in what pieces. */
function AnimGroup({ t, layer, doc, update, which }: EditProps & { which: 'in' | 'out' }) {
  const a = layer[which];
  const rtl = isRtlLang(doc.lang);
  const span = Math.max(0.05, layer.end - layer.start);
  const field = (name: string) => `${which}.${name}`;
  const patch = (p: Partial<Anim>, name: string) => update(field(name), (l) => {
    const cur = l[which];
    return cur ? { [which]: { ...cur, ...p } } : {};
  });
  const choose = (fx: Effect) => update(field('fx'), (l) => {
    const cur = l[which];
    if (fx === 'none') return { [which]: undefined };
    const base: Anim = cur ?? (which === 'in'
      ? { fx, d: 0.6, delay: 0, ease: 'expo-out', amount: 1 }
      : { fx, d: 0.45, delay: 0, ease: 'out', amount: 1 });
    return { [which]: { ...base, fx } };
  });
  const effects: Choice<Effect>[] = EFFECTS.map((e) => ({ value: e, label: effectName(e, t), title: effectAbout(e, t) || undefined }));
  const splits: Choice<Split>[] = SPLITS.map((s) => ({ value: s, label: splitName(s, t) }));
  const dirs: Choice<Dir4>[] = DIR_ORDER.map((d) => dirChoice(d, t, rtl));
  const arabic = layer.kind === 'text' && scriptOf(layer.text) === 'arabic';
  return (
    <div className="mo-anim">
      <Sub>{which === 'in' ? t('Entrance') : t('Exit')}</Sub>
      <SelectField label={t('Effect')} value={a?.fx ?? 'none'} choices={effects} onChange={choose} />
      {a && (
        <>
          <p className="mo-hint mo-about">
            {effectAbout(a.fx, t)}
            {which === 'out' && <> {t('An exit is its entrance played backwards.')}</>}
          </p>
          <NumberField label={t('Duration')} value={a.d} min={0.05} max={span} step={0.05} digits={2} fixed unit={secUnit(t)} onChange={(d) => patch({ d }, 'd')} />
          <NumberField label={t('Delay')} value={a.delay} min={0} max={span} step={0.05} digits={2} fixed unit={secUnit(t)} onChange={(delay) => patch({ delay }, 'delay')} />
          <EaseField t={t} label={t('Curve')} value={a.ease} onChange={(ease) => patch({ ease }, 'ease')} />
          <SliderField label={t('Strength')} value={a.amount} min={0} max={3} step={0.05} digits={2} unit="×" onChange={(amount) => patch({ amount }, 'amount')} />
          {DIRECTED.has(a.fx) && (
            <SegField label={t('Comes from')} value={a.dir ?? 'start'} choices={dirs} dir={rtl ? 'rtl' : 'ltr'} onChange={(dir) => patch({ dir }, 'dir')} />
          )}
          {layer.kind === 'text' && (
            <>
              <SegField label={t('Split')} value={a.by ?? 'all'} choices={splits} columns={2} onChange={(by) => patch({ by }, 'by')} />
              {a.by && a.by !== 'all' && (
                <NumberField label={t('Stagger')} value={a.gap ?? 0.04} min={0} max={1} step={0.01} digits={2} fixed unit={secUnit(t)}
                             onChange={(gap) => patch({ gap }, 'gap')} />
              )}
              {a.by === 'char' && arabic && <p className="mo-hint">{t('Arabic script runs word by word: a letter alone would lose its joins.')}</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}

function LoopGroup({ t, layer, update }: EditProps) {
  const loop = layer.loop;
  const loops: Choice<Loop>[] = LOOPS.map((l) => ({ value: l, label: loopName(l, t), title: loopAbout(l, t) || undefined }));
  return (
    <div className="mo-anim">
      <Sub>{t('Loop')}</Sub>
      <SelectField label={t('Effect')} value={loop?.fx ?? 'none'} choices={loops}
                   onChange={(fx) => update('loop.fx', (l) => ({ loop: fx === 'none' ? undefined : { d: 2, amount: 1, ...l.loop, fx } }))} />
      {loop && (
        <>
          <p className="mo-hint mo-about">{loopAbout(loop.fx, t)}</p>
          <NumberField label={t('Cycle')} value={loop.d} min={0.4} max={60} step={0.1} digits={2} unit={secUnit(t)}
                       onChange={(d) => update('loop.d', (l) => (l.loop ? { loop: { ...l.loop, d } } : {}))} />
          <SliderField label={t('Strength')} value={loop.amount} min={0} max={3} step={0.05} digits={2} unit="×"
                       onChange={(amount) => update('loop.amount', (l) => (l.loop ? { loop: { ...l.loop, amount } } : {}))} />
        </>
      )}
    </div>
  );
}

function StyleFields({ t, layer, doc, set, update }: EditProps) {
  const shadow = layer.shadow;
  const blends: Choice<Blend>[] = BLENDS.map((b) => ({ value: b, label: blendName(b, t) }));
  const setShadow = (p: Partial<NonNullable<Layer['shadow']>>, name: string) =>
    update(`shadow.${name}`, (l) => (l.shadow ? { shadow: { ...l.shadow, ...p } } : {}));
  return (
    <>
      {layer.kind !== 'backdrop' && (
        <>
          <SubToggle label={t('Shadow')} checked={!!shadow}
                     onChange={(on) => update('shadow', (l) => ({ shadow: on ? l.shadow ?? { color: '#00000080', blur: 2, x: 0, y: 0.6 } : undefined }))} />
          {shadow && (
            <>
              <ColorField t={t} label={t('Colour')} value={shadow.color} palette={doc.palette} onChange={(color) => setShadow({ color }, 'color')} />
              <NumberField label={t('Blur')} value={shadow.blur} min={0} max={layer.kind === 'text' ? textShadowMax(layer.size) : 100} step={0.1} digits={1} unit="u" unitTitle={uTitle(t)}
                           onChange={(blur) => setShadow({ blur }, 'blur')} />
              <Row label={t('Offset')}>
                <NumberBox label={t('Horizontal')} glyph="across" value={shadow.x} min={-100} max={100} step={0.1} digits={1} unit="u"
                           onChange={(x) => setShadow({ x }, 'x')} />
                <NumberBox label={t('Vertical')} glyph="updown" value={shadow.y} min={-100} max={100} step={0.1} digits={1} unit="u"
                           onChange={(y) => setShadow({ y }, 'y')} />
              </Row>
            </>
          )}
        </>
      )}
      <SelectField label={t('Blend')} value={layer.blend ?? 'normal'} choices={blends}
                   onChange={(blend) => set({ blend: blend === 'normal' ? undefined : blend }, 'blend')} />
    </>
  );
}

/** Everything about one layer, in five sections. */
function Inspector({ t, layer, doc, set, update, naming, onRename, onNamed }: EditProps & {
  /** The name is being written, in the header. */
  naming: boolean;
  onRename: () => void;
  onNamed: (name: string | null) => void;
}) {
  const kind = layer.kind;
  const pencil = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(() => remembered);
  const isOpen = (s: SectionId) => open[kind]?.[s] ?? OPEN_FIRST[s];
  const toggle = (s: SectionId) => {
    const next = { ...open, [kind]: { ...open[kind], [s]: !isOpen(s) } };
    remembered = next;
    setOpen(next);
  };
  const edit: EditProps = { t, layer, doc, set, update };
  const span = `${fmtNum(layer.start, 2, true)}–${fmtNum(layer.end, 2, true)}`;
  const moves = [
    layer.in || layer.out ? [layer.in, layer.out].map((a) => (a ? effectName(a.fx, t) : '—')).join(' / ') : '',
    layer.loop ? loopName(layer.loop.fx, t) : '',
  ].filter(Boolean).join(' · ');
  const looks = [layer.shadow ? t('Shadow') : '', layer.blend && layer.blend !== 'normal' ? blendName(layer.blend, t) : ''].filter(Boolean).join(' · ');
  const section = (id: SectionId, title: string, summary: string, body: ReactNode) => (
    <Section title={title} open={isOpen(id)} onToggle={() => toggle(id)} summary={summary}>{body}</Section>
  );
  return (
    <div className="mo-insp" role="region" aria-label={layer.name ? shownName(layer.name, t) : kindName(kind, t)}>
      <div className="mo-insp-head">
        <span className="mo-insp-glyph"><Glyph name={KIND_GLYPH[kind]} size={16} /></span>
        <span className="mo-insp-what">
          {naming
            ? (
              <RenameInput t={t} name={layer.name} className="mo-rename-head"
                           onDone={(v, byKey) => { onNamed(v); if (byKey) requestAnimationFrame(() => pencil.current?.focus()); }} />
            )
            : <b><bdi>{layer.name ? shownName(layer.name, t) : kindName(kind, t)}</bdi></b>}
          <small>
            {kindName(kind, t)}
            {layer.hidden && <> · {t('Hidden')}</>}
            {layer.locked && <> · {t('Locked')}</>}
          </small>
        </span>
        <button ref={pencil} type="button" className="mo-icon-btn" onClick={onRename} disabled={naming} title={t('Rename')} aria-label={t('Rename')}>
          <Icon name="pencil" size={13} />
        </button>
      </div>
      {section('content', kindName(kind, t), kindSummary(layer, t), <KindContent t={t} layer={layer} doc={doc} set={set} update={update} />)}
      {section('position', t('Position'), kind === 'backdrop' ? '' : pinName(layer.pin, t), <PositionFields {...edit} />)}
      {section('timing', t('Timing'), fill(t('{n} s'), { n: span }), <TimingFields {...edit} />)}
      {section('animation', t('Animation'), moves, (
        <>
          <AnimGroup {...edit} which="in" />
          <AnimGroup {...edit} which="out" />
          <LoopGroup {...edit} />
        </>
      ))}
      {section('style', t('Style'), looks, <StyleFields {...edit} />)}
    </div>
  );
}

// ── the tab ───────────────────────────────────────────────────────────────

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function MotionLayers(p: InspectorProps) {
  const { t, doc, selected } = p;
  const n = doc.layers.length;
  // Front first: the last layer drawn is the top row.
  const rows = doc.layers.slice().reverse();
  const layer = layerOf(doc, selected);
  const list = useRef<HTMLUListElement | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; where: 'row' | 'head' } | null>(null);
  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const focusNext = useRef<string | null>(null);
  /** The last layer went from the list with the keyboard on it: the keyboard goes to the tiles that add the first. */
  const focusTiles = useRef(false);
  const tab = useRef<HTMLDivElement>(null);

  const key = (id: string, field: string) => `layer:${id}:${field}`;
  const setOn = (id: string) => (patch: Partial<Layer>, field: string) => p.onEdit((m) => setLayer(m, id, patch), key(id, field));
  // A change worked out to nothing is no change: setLayer would still stamp the graphic and end its template.
  const updateOn = (id: string) => (field: string, fn: (l: Layer) => Partial<Layer>) =>
    p.onEdit((m) => {
      const l = layerOf(m, id);
      const patch = l ? fn(l) : {};
      return l && Object.keys(patch).length ? setLayer(m, id, patch) : m;
    }, key(id, field));

  /** Put the keyboard on a row once it is drawn. */
  const focusRow = (id: string) => { focusNext.current = id; };
  useLayoutEffect(() => {
    if (focusTiles.current) {
      focusTiles.current = false;
      tab.current?.querySelector<HTMLElement>('.mo-empty .mo-kind')?.focus();
    }
    const id = focusNext.current;
    if (!id) return;
    focusNext.current = null;
    list.current?.querySelector<HTMLElement>(`[data-row="${id}"] .mo-layer-main`)?.focus();
  });

  // A layer chosen elsewhere — on the stage, on the timeline — is brought into view in the list.
  useEffect(() => {
    if (!selected) return;
    list.current?.querySelector<HTMLElement>(`[data-row="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const add = (kind: LayerKind) => {
    if (n >= LIMITS.layers) return;
    const id = newLayerId(new Set(doc.layers.map((l) => l.id)));
    const patch = { ...startingFields(kind, t), id, name: freshName(kind, doc, t) } as Partial<Layer>;
    p.onEdit((m) => withId(addLayer(m, kind, patch), id));
    p.onSelect(id);
    focusRow(id);
  };
  const duplicate = (id: string) => {
    if (n >= LIMITS.layers) return;
    const copy = newLayerId(new Set(doc.layers.map((l) => l.id)));
    p.onEdit((m) => withId(duplicateLayer(m, id), copy));
    p.onSelect(copy);
    focusRow(copy);
  };
  const remove = (id: string) => {
    const i = rows.findIndex((r) => r.id === id);
    const next = rows[i + 1] ?? rows[i - 1];
    p.onEdit((m) => removeLayer(m, id));
    p.onSelect(next ? next.id : null);
    if (next) focusRow(next.id);
    else focusTiles.current = true;
  };
  /** Move a layer to a place in the stack, 0 being the back. */
  const moveTo = (id: string, to: number) => {
    p.onEdit((m) => moveLayer(m, id, to));
    focusRow(id);
  };
  const stackIndex = (id: string) => doc.layers.findIndex((l) => l.id === id);
  const rename = (id: string, name: string | null) => {
    setRenaming(null);
    if (name !== null) p.onEdit((m) => setLayer(m, id, { name }), key(id, 'name'));
  };

  const reorder = useReorder({
    axis: 'y',
    enabled: !renaming,
    // Rows are front first and the stack back first: row `to` is stack place `n - 1 - to`.
    onMove: (from, to) => {
      const row = rows[from];
      if (row) moveTo(row.id, n - 1 - to);
    },
  });

  const openMenu = (id: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const rtl = document.documentElement.dir === 'rtl';
    setMenu({ id, at: { x: rtl ? r.right : r.left, y: r.bottom + 2 } });
  };
  const menuItems = (id: string): Item[] => {
    const at = stackIndex(id);
    return [
      { kind: 'action', id: 'rename', label: 'Rename', hint: 'F2' },
      { kind: 'action', id: 'duplicate', label: 'Duplicate', hint: isMac ? '⌘D' : 'Ctrl+D', disabled: n >= LIMITS.layers },
      { kind: 'divider' },
      { kind: 'action', id: 'up', label: 'Move up', hint: isMac ? '⌥↑' : 'Alt+↑', disabled: at >= n - 1 },
      { kind: 'action', id: 'down', label: 'Move down', hint: isMac ? '⌥↓' : 'Alt+↓', disabled: at <= 0 },
      { kind: 'action', id: 'front', label: 'Bring to front', disabled: at >= n - 1 },
      { kind: 'action', id: 'back', label: 'Send to back', disabled: at <= 0 },
      { kind: 'divider' },
      { kind: 'action', id: 'delete', label: 'Delete', hint: isMac ? '⌫' : 'Del', danger: true },
    ];
  };
  const act = (id: string, what: string) => {
    const at = stackIndex(id);
    if (what === 'rename') setRenaming({ id, where: 'row' });
    else if (what === 'duplicate') duplicate(id);
    else if (what === 'up') moveTo(id, at + 1);
    else if (what === 'down') moveTo(id, at - 1);
    else if (what === 'front') moveTo(id, n - 1);
    else if (what === 'back') moveTo(id, 0);
    else if (what === 'delete') remove(id);
  };

  const rowKey = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    const l = rows[i];
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const up = e.key === 'ArrowUp';
      if (e.altKey) {
        const at = stackIndex(l.id);
        if (up ? at < n - 1 : at > 0) moveTo(l.id, at + (up ? 1 : -1));
        return;
      }
      const next = rows[i + (up ? -1 : 1)];
      if (next) { p.onSelect(next.id); focusRow(next.id); }
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const next = e.key === 'Home' ? rows[0] : rows[rows.length - 1];
      p.onSelect(next.id);
      focusRow(next.id);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(l.id);
    } else if (e.key === 'F2') {
      e.preventDefault();
      p.onSelect(l.id);
      setRenaming({ id: l.id, where: 'row' });
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicate(l.id);
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      p.onSelect(l.id);
      openMenu(l.id, e.currentTarget);
    }
  };

  // One tab stop in the list: the row with the keyboard, else the selected one, else the first.
  const active = rows.some((r) => r.id === focused) ? focused : rows.some((r) => r.id === selected) ? selected : rows[0]?.id ?? null;

  return (
    <div className="mo-layers" ref={tab}>
      <div className="mo-bar">
        <span className="mo-bar-title">{t('Layers')}</span>
        {n > 0 && <AddButton t={t} full={n >= LIMITS.layers} onPick={add} />}
      </div>

      {n === 0
        ? (
          <div className="mo-empty">
            <p>{t('No layers yet. Add the first:')}</p>
            <KindTiles t={t} onPick={add} />
          </div>
        )
        : (
          <ul ref={(el) => { list.current = el; reorder.strip.ref(el); }} className={`mo-list ${reorder.strip.className}`} aria-label={t('Layers')}
              onPointerDown={reorder.strip.onPointerDown} onPointerMove={reorder.strip.onPointerMove} onPointerUp={reorder.strip.onPointerUp}
              onPointerCancel={reorder.strip.onPointerCancel} onClickCapture={reorder.strip.onClickCapture}>
            {rows.map((l, i) => {
              const on = l.id === selected;
              const tab = l.id === active ? 0 : -1;
              const name = l.name ? shownName(l.name, t) : kindName(l.kind, t);
              const naming = renaming?.id === l.id && renaming.where === 'row';
              return (
                <li key={l.id} data-row={l.id}
                    className={`mo-layer ${reorder.itemClass(i)}${on ? ' is-on' : ''}${l.hidden ? ' is-hidden' : ''}${l.locked ? ' is-locked' : ''}`}
                    onContextMenu={(e) => { e.preventDefault(); p.onSelect(l.id); setMenu({ id: l.id, at: { x: e.clientX, y: e.clientY } }); }}>
                  {naming
                    ? (
                      <div className="mo-layer-main is-naming">
                        <span className="mo-layer-glyph"><Glyph name={KIND_GLYPH[l.kind]} size={15} /></span>
                        <RenameInput t={t} name={l.name} onDone={(v, byKey) => { rename(l.id, v); if (byKey) focusRow(l.id); }} />
                      </div>
                    )
                    : (
                      <button type="button" className="mo-layer-main" tabIndex={tab} aria-current={on ? 'true' : undefined}
                              title={l.kind === 'text' ? l.text : undefined}
                              onClick={() => p.onSelect(l.id)} onDoubleClick={() => setRenaming({ id: l.id, where: 'row' })}
                              onFocus={() => setFocused(l.id)} onBlur={() => setFocused((f) => (f === l.id ? null : f))}
                              onKeyDown={(e) => rowKey(e, i)}>
                        <span className="mo-layer-grip" aria-hidden="true"><Glyph name="grip" size={12} /></span>
                        <span className="mo-layer-glyph"><Glyph name={KIND_GLYPH[l.kind]} size={15} /></span>
                        <span className="mo-layer-name"><bdi>{name}</bdi></span>
                      </button>
                    )}
                  <span className="mo-layer-acts">
                    <button type="button" className={`mo-layer-act${l.hidden ? ' is-set' : ''}`} data-nodrag="" tabIndex={tab}
                            aria-pressed={!!l.hidden} aria-label={t('Hidden')} title={l.hidden ? t('Show the layer') : t('Hide the layer')}
                            onClick={() => setOn(l.id)({ hidden: !l.hidden || undefined }, 'hidden')}>
                      <Glyph name={l.hidden ? 'eyeOff' : 'eye'} size={15} />
                    </button>
                    <button type="button" className={`mo-layer-act${l.locked ? ' is-set' : ''}`} data-nodrag="" tabIndex={tab}
                            aria-pressed={!!l.locked} aria-label={t('Locked')} title={l.locked ? t('Unlock the layer') : t('Lock the layer')}
                            onClick={() => setOn(l.id)({ locked: !l.locked || undefined }, 'locked')}>
                      <Glyph name={l.locked ? 'lock' : 'unlock'} size={15} />
                    </button>
                    <button type="button" className="mo-layer-act mo-layer-more" data-nodrag="" tabIndex={tab} aria-haspopup="menu"
                            aria-expanded={menu?.id === l.id} title={t('More')} aria-label={`${t('Actions')} — ${name}`}
                            onClick={(e) => { p.onSelect(l.id); openMenu(l.id, e.currentTarget); }}>
                      <Icon name="ellipsis" size={15} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

      {layer
        ? (
          <Inspector key={layer.id} t={t} layer={layer} doc={doc} set={setOn(layer.id)} update={updateOn(layer.id)}
                     naming={renaming?.id === layer.id && renaming.where === 'head'}
                     onRename={() => setRenaming({ id: layer.id, where: 'head' })} onNamed={(v) => rename(layer.id, v)} />
        )
        : n > 0 && <p className="mo-hint mo-pick">{t('Choose a layer to edit it.')}</p>}

      {menu && layerOf(doc, menu.id) && (
        <ContextMenu at={menu.at} items={menuItems(menu.id)} t={t} label={`${t('Actions')} — ${shownName(layerOf(doc, menu.id)?.name ?? '', t)}`}
                     onPick={(what) => act(menu.id, what)} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
