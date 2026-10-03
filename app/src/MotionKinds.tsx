import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Icon } from './Icon';
import {
  BACKDROPS, CHARTS, ICON_IDS, LIMITS, PARTICLES, SHAPES, VOICES, isRtlLang,
  type Backdrop, type BackdropLayer, type Chart, type ChartLayer, type CounterLayer, type IconId, type IconLayer, type ImageLayer,
  type Layer, type LayerKind, type Motion, type Particles, type ParticlesLayer, type Shape, type ShapeLayer, type TextLayer, type Voice,
} from './motiontypes';
import type { T } from './motionui';
import { fontStack, scriptOf } from './motionfonts';
import { ICON_PATHS } from './videoicons';
import { PICTURE_ACCEPT, PICTURE_LONG_U, boxFor, readPicture, type PictureProblem } from './motionpicture';
import {
  ColorBox, EaseField, Glyph, NumberBox, NumberField, PaintField, Row, SegField, SelectField, SliderField, Sub, SubToggle, TextArea,
  TextBox, TextField, ToggleField, type Choice, type GlyphName,
} from './MotionControls';

/**
 * What a layer shows, kind by kind: the words of a text, the outline of a
 * shape, which icon, which picture, the numbers of a counter and a chart, the
 * look of a background or of particles. The inspector (MotionLayers.tsx) puts
 * one of these at the top of the selected layer, under the kind's name, and
 * gives it two ways to change the layer — `set` for a value, and `update` for
 * a change worked out from the layer as it is at that moment (a row added to
 * a chart's data must be added to the data as it is then, not as it was drawn).
 *
 * Every field is one the reader (motionread.ts) knows and clamps, so a value
 * typed out of range comes back in range; these controls only have to offer
 * sensible steps.
 */

export interface KindProps<L extends Layer> {
  t: T;
  layer: L;
  doc: Motion;
  /** Change fields. `field` names the undo step, so typing in one box is one step. */
  set: (patch: Partial<L>, field: string) => void;
  /** Change fields worked out from the layer as it is when the change lands. */
  update: (field: string, fn: (l: L) => Partial<L>) => void;
}

// ── names ─────────────────────────────────────────────────────────────────

/** A kind of layer, named. */
export function kindName(k: LayerKind, t: T): string {
  if (k === 'text') return t('Text');
  if (k === 'shape') return t('Shape');
  if (k === 'icon') return t('Icon');
  if (k === 'image') return t('Picture');
  if (k === 'counter') return t('Counter');
  if (k === 'chart') return t('Chart');
  if (k === 'backdrop') return t('Background');
  return t('Particles');
}

export const KIND_GLYPH: Readonly<Record<LayerKind, GlyphName>> = {
  text: 'text', shape: 'shape', icon: 'icon', image: 'image', counter: 'counter', chart: 'chart', backdrop: 'backdrop', particles: 'particles',
};

/** A voice (a typeface's feel), named. */
export function voiceName(v: Voice, t: T): string {
  if (v === 'sans') return t('Sans');
  if (v === 'bold') return t('Heavy');
  if (v === 'serif') return t('Serif');
  if (v === 'round') return t('Rounded');
  if (v === 'mono') return t('Mono');
  return t('Condensed');
}

export function shapeName(s: Shape, t: T): string {
  switch (s) {
    case 'rect': return t('Rectangle');
    case 'ellipse': return t('Ellipse');
    case 'arc': return t('Arc');
    case 'polygon': return t('Polygon');
    case 'star': return t('Star');
    case 'line': return t('Straight line');
    case 'arrow': return t('Arrow');
    case 'burst': return t('Burst');
    case 'wave': return t('Wave');
    case 'blob': return t('Blob');
    default: return t('Path');
  }
}

export function chartName(c: Chart, t: T): string {
  switch (c) {
    case 'bars': return t('Bars');
    case 'hbars': return t('Bars across');
    case 'line': return t('Line chart');
    case 'donut': return t('Donut');
    case 'race': return t('Race');
    default: return t('Ring');
  }
}

export function backdropName(b: Backdrop, t: T): string {
  switch (b) {
    case 'aurora': return t('Aurora');
    case 'grid': return t('Grid');
    case 'dots': return t('Dots');
    case 'rays': return t('Rays');
    case 'waves': return t('Waves');
    case 'bokeh': return t('Bokeh');
    case 'grain': return t('Grain');
    case 'vignette': return t('Vignette');
    case 'lightleak': return t('Light leak');
    case 'scanlines': return t('Scan lines');
    case 'halftone': return t('Halftone');
    default: return t('Stripes');
  }
}

/**
 * What a background's Density and Speed sliders do, in the words of its style.
 * The five finishes (motionbackdrop.ts: grain, vignette, light leak, scan
 * lines, halftone — made to lie over a picture, where the seven grounds lie
 * under words) each read the two their own way, so the inspector names them as
 * that finish means them; a ground keeps Density and Speed.
 */
function backdropSliders(b: Backdrop, t: T): { density: string; speed: string } {
  switch (b) {
    case 'grain': return { density: t('Coarseness'), speed: t('Flicker') };
    case 'vignette': return { density: t('Reach'), speed: t('Breathing') };
    case 'lightleak': return { density: t('Strength'), speed: t('Blooms') };
    case 'scanlines': return { density: t('Fineness'), speed: t('Rolls') };
    case 'halftone': return { density: t('Fineness'), speed: t('Flow') };
    default: return { density: t('Density'), speed: t('Speed') };
  }
}

export function particlesName(p: Particles, t: T): string {
  if (p === 'confetti') return t('Confetti');
  if (p === 'sparks') return t('Sparks');
  if (p === 'bubbles') return t('Bubbles');
  if (p === 'stars') return t('Stars');
  return t('Snow');
}

/**
 * An icon's name — the words the Video studio already has for the same sixty
 * drawings (VideoStoryboard.tsx), written out again here as calls, so this
 * panel does not pull the video editor in with it.
 */
const ICON_NAME: Readonly<Record<IconId, (t: T) => string>> = {
  star: (t) => t('Star'), heart: (t) => t('Heart'), check: (t) => t('Tick'), clock: (t) => t('Clock'), calendar: (t) => t('Calendar'),
  phone: (t) => t('Phone'), mail: (t) => t('Envelope'), pin: (t) => t('Map pin'), globe: (t) => t('Globe'), home: (t) => t('House'),
  building: (t) => t('Building'), school: (t) => t('School'), book: (t) => t('Book'), graduation: (t) => t('Graduation cap'), users: (t) => t('Group of people'),
  user: (t) => t('One person'), chat: (t) => t('Speech bubble'), shield: (t) => t('Shield'), lock: (t) => t('Padlock'), leaf: (t) => t('Leaf'),
  sun: (t) => t('Sun'), moon: (t) => t('Moon'), bolt: (t) => t('Lightning'), flame: (t) => t('Flame'), drop: (t) => t('Drop'),
  tooth: (t) => t('Tooth'), stethoscope: (t) => t('Stethoscope'), pulse: (t) => t('Heartbeat'), car: (t) => t('Car'), truck: (t) => t('Truck'),
  plane: (t) => t('Plane'), cart: (t) => t('Shopping cart'), bag: (t) => t('Shopping bag'), gift: (t) => t('Gift'), tag: (t) => t('Price tag'),
  money: (t) => t('Money'), chart: (t) => t('Bar chart'), trend: (t) => t('Rising line'), target: (t) => t('Target'), rocket: (t) => t('Rocket'),
  bulb: (t) => t('Light bulb'), gear: (t) => t('Gear'), wrench: (t) => t('Wrench'), camera: (t) => t('Camera'), music: (t) => t('Music'),
  play: (t) => t('Play button'), wifi: (t) => t('Wi-Fi'), code: (t) => t('Code'), coffee: (t) => t('Coffee'), food: (t) => t('Food'),
  sparkle: (t) => t('Sparkle'), trophy: (t) => t('Trophy'), handshake: (t) => t('Handshake'), medal: (t) => t('Medal'), search: (t) => t('Search'),
  doc: (t) => t('Document'), pen: (t) => t('Pen'), palette: (t) => t('Palette'), ruler: (t) => t('Ruler'), smile: (t) => t('Smile'),
};

export const iconName = (id: IconId, t: T): string => (ICON_NAME[id] ?? ICON_NAME.sparkle)(t);

/** What a length in u is, for its unit's tooltip. */
export const uTitle = (t: T) => t('1 u is a hundredth of the frame’s shorter side.');
/**
 * Seconds as a number box writes them after the number, in the interface's
 * language — `s`, `ث`, `چ` — taken from the sentence every length is written
 * with (`{n} s`), so the inspector and the rest of the studio say it alike.
 */
export const secUnit = (t: T) => t('{n} s').replace('{n}', '').trim() || 's';

// ── shared rows ───────────────────────────────────────────────────────────

const WEIGHTS: readonly Choice<string>[] = [100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: String(w), label: String(w) }));

/** The six voices, each written in its own face: a specimen in its Latin face and its name as the interface writes it. */
function VoiceField({ t, value, onChange }: { t: T; value: Voice; onChange: (v: Voice) => void }) {
  const choices: Choice<Voice>[] = VOICES.map((v) => {
    const name = voiceName(v, t);
    return {
      value: v,
      label: name,
      content: (
        <>
          <b className="mo-voice-spec" style={{ fontFamily: fontStack(v, 'latin') }} aria-hidden="true">Ag</b>
          <span className="mo-voice-name" style={{ fontFamily: fontStack(v, scriptOf(name)) }}>{name}</span>
        </>
      ),
    };
  });
  return <SegField label={t('Font')} value={value} choices={choices} columns={3} className="mo-voices" onChange={onChange} />;
}

/** Where the words sit in their box: the reading side, the centre, the far side — in the graphic's own direction. */
function AlignField({ t, value, rtl, onChange }: { t: T; value: TextLayer['align']; rtl: boolean; onChange: (a: TextLayer['align']) => void }) {
  const choices: Choice<TextLayer['align']>[] = [
    { value: 'start', label: t('Reading side') },
    { value: 'center', label: t('Centre') },
    { value: 'end', label: t('Far side') },
  ];
  return <SegField label={t('Alignment')} value={value} choices={choices} dir={rtl ? 'rtl' : 'ltr'} onChange={onChange} />;
}

/** A width and a height in one row, each a box marked with the way it runs. */
function SizeRow({ t, label, w, h, onW, onH, max = LIMITS.size }: {
  t: T;
  label?: string;
  w: number;
  h: number;
  onW: (v: number) => void;
  onH: (v: number) => void;
  max?: number;
}) {
  return (
    <Row label={label ?? t('Size')}>
      <NumberBox label={t('Width')} glyph="across" value={w} min={0} max={max} step={0.5} digits={1} unit="u" unitTitle={uTitle(t)} onChange={onW} />
      <NumberBox label={t('Height')} glyph="updown" value={h} min={0} max={max} step={0.5} digits={1} unit="u" unitTitle={uTitle(t)} onChange={onH} />
    </Row>
  );
}

/** A new seed, for a new variation of a shape or a background. */
const freshSeed = () => Math.floor(Math.random() * 2147483647);

/** "Shuffle": another variation of what is drawn from a seed. */
function ShuffleRow({ t, seed, onShuffle }: { t: T; seed: number; onShuffle: () => void }) {
  return (
    <Row label={t('Variation')}>
      <button type="button" className="ghost mo-shuffle" onClick={onShuffle}>
        <Glyph name="shuffle" size={14} />{t('Shuffle')}
      </button>
      <span className="mo-seed" dir="ltr">{`#${seed}`}</span>
    </Row>
  );
}

/** A list of colours, one chip each: press one to change it or take it out, the plus to add one. */
function ColoursField({ t, label, colors, doc, max, onChange }: {
  t: T;
  label: string;
  colors: string[];
  doc: Motion;
  max: number;
  onChange: (next: (cur: string[]) => string[]) => void;
}) {
  const id = useId();
  // A colour not yet in the list, the palette's first, so a new one is seen to be new.
  const next = (cur: string[]) => (['accent', 'accent2', 'fg', 'muted', 'bg'] as const).find((c) => !cur.includes(c)) ?? 'accent';
  return (
    <Row label={label} id={id}>
      <div className="mo-colours" role="group" aria-labelledby={id}>
        {colors.map((c, i) => (
          <ColorBox key={i} t={t} label={label} value={c} palette={doc.palette} compact
                    onChange={(v) => onChange((cur) => cur.map((x, j) => (j === i ? v : x)))}
                    onRemove={colors.length > 1 ? () => onChange((cur) => cur.filter((_, j) => j !== i)) : undefined} />
        ))}
        {colors.length < max && (
          <button type="button" className="mo-icon-btn mo-colour-add" title={t('Add a colour')} aria-label={t('Add a colour')}
                  onClick={() => onChange((cur) => [...cur, next(cur)])}>
            <Icon name="plus" size={12} />
          </button>
        )}
      </div>
    </Row>
  );
}

// ── text ──────────────────────────────────────────────────────────────────

/** A highlight's phrase: kept by the reader only while it is in the words, so what is typed stays in the box and a phrase that is not in them is said. */
function HighlightField({ t, layer, set }: KindProps<TextLayer>) {
  const [typed, setTyped] = useState('');
  const missing = typed.trim() !== '' && !layer.text.includes(typed) && layer.hi !== typed;
  return (
    <TextField label={t('Phrase')} value={layer.hi ?? ''} keep maxLength={LIMITS.text} invalid={missing}
               hint={missing ? <small className="mo-hint is-bad">{t('Not in the text, so not kept.')}</small> : undefined}
               onChange={(hi) => { setTyped(hi); set({ hi: hi || undefined }, 'hi'); }} />
  );
}

export function TextContent(p: KindProps<TextLayer>) {
  const { t, layer, doc, set, update } = p;
  const rtl = isRtlLang(doc.lang);
  const hiStyles: Choice<NonNullable<TextLayer['hiStyle']>>[] = [
    { value: 'color', label: t('Colour') },
    { value: 'box', label: t('Box') },
    { value: 'underline', label: t('Underline') },
  ];
  return (
    <>
      <TextArea label={t('Text')} bare value={layer.text} maxLength={LIMITS.text} rows={3} onChange={(text) => set({ text }, 'text')} />
      <VoiceField t={t} value={layer.voice} onChange={(voice) => set({ voice }, 'voice')} />
      <NumberField label={t('Size')} value={layer.size} min={0} max={LIMITS.size} step={0.5} digits={1} unit="u" unitTitle={uTitle(t)}
                   onChange={(size) => set({ size }, 'size')} />
      <SelectField label={t('Weight')} value={String(layer.weight)} choices={WEIGHTS} onChange={(w) => set({ weight: Number(w) }, 'weight')} />
      <PaintField t={t} label={t('Colour')} value={layer.color} palette={doc.palette} onChange={(color) => set({ color: color ?? 'fg' }, 'color')} />
      <AlignField t={t} value={layer.align} rtl={rtl} onChange={(align) => set({ align }, 'align')} />
      <NumberField label={t('Line height')} value={layer.lead} min={0.7} max={2.5} step={0.05} digits={2} unit="×"
                   onChange={(lead) => set({ lead }, 'lead')} />
      <NumberField label={t('Letter spacing')} value={layer.track} min={-0.2} max={1} step={0.01} digits={2} unit="em"
                   onChange={(track) => set({ track }, 'track')} />
      <ToggleField label={t('Capitals')} checked={layer.caps} onChange={(caps) => set({ caps }, 'caps')} />
      <NumberField label={t('Wrap width')} value={layer.max} min={0} max={LIMITS.size} step={1} digits={1} unit="u" unitTitle={uTitle(t)}
                   zero={t('None')} onChange={(max) => set({ max }, 'max')} />
      <ToggleField label={t('Shrink to fit')} checked={layer.fit} disabled={layer.max === 0} onChange={(fit) => set({ fit }, 'fit')}
                   hint={layer.max === 0 ? t('Needs a wrap width.') : undefined} />

      <Sub>{t('Highlight')}</Sub>
      <HighlightField {...p} />
      {layer.hi && (
        <>
          <SegField label={t('Style')} value={layer.hiStyle ?? 'color'} choices={hiStyles} onChange={(hiStyle) => set({ hiStyle }, 'hiStyle')} />
          <PaintField t={t} label={t('Colour')} value={layer.hiColor ?? 'accent'} palette={doc.palette}
                      onChange={(hiColor) => set({ hiColor: hiColor ?? 'accent' }, 'hiColor')} />
        </>
      )}

      <SubToggle label={t('Stroke')} checked={!!layer.outline}
                 onChange={(on) => update('outline', (l) => ({ outline: on ? l.outline ?? { color: 'bg', width: 0.3 } : undefined }))} />
      {layer.outline && (
        <>
          <PaintField t={t} label={t('Colour')} value={layer.outline.color} palette={doc.palette}
                      onChange={(color) => update('outline', (l) => ({ outline: { width: l.outline?.width ?? 0.3, color: color ?? 'bg' } }))} />
          <NumberField label={t('Width')} value={layer.outline.width} min={0} max={20} step={0.1} digits={2} unit="u" unitTitle={uTitle(t)}
                       onChange={(width) => update('outline', (l) => ({ outline: { color: l.outline?.color ?? 'bg', width } }))} />
        </>
      )}
    </>
  );
}

// ── shape ─────────────────────────────────────────────────────────────────

/** What the reader keeps as a path: path letters and numbers, and no more than `LIMITS.path` of them. */
const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]*$/;

export function ShapeContent({ t, layer, doc, set, update }: KindProps<ShapeLayer>) {
  const shapes = SHAPES.map((s) => ({ value: s, label: shapeName(s, t) }));
  const caps: Choice<NonNullable<ShapeLayer['stroke']>['cap']>[] = [
    { value: 'round', label: t('Rounded') },
    { value: 'butt', label: t('Flat') },
    { value: 'square', label: t('Square') },
  ];
  const s = layer.shape;
  const count = s === 'polygon' ? t('Sides') : s === 'star' || s === 'burst' ? t('Points') : s === 'wave' ? t('Waves') : null;
  const [path, setPath] = useState(layer.d ?? '');
  const badPath = s === 'path' && path.trim() !== '' && (!PATH.test(path) || path.length > LIMITS.path);
  const stroke = layer.stroke;
  const setStroke = (patch: Partial<NonNullable<ShapeLayer['stroke']>>) =>
    update('stroke', (l) => ({ stroke: { color: 'fg', width: 0.5, cap: 'round', ...l.stroke, ...patch } }));
  return (
    <>
      <SelectField label={t('Shape')} value={s} choices={shapes} onChange={(shape) => set({ shape }, 'shape')} />
      <SizeRow t={t} w={layer.w} h={layer.h} onW={(w) => set({ w }, 'w')} onH={(h) => set({ h }, 'h')} />
      {s === 'rect' && (
        <NumberField label={t('Corner radius')} value={layer.radius} min={0} max={LIMITS.size} step={0.5} digits={1} unit="u" unitTitle={uTitle(t)}
                     onChange={(radius) => set({ radius }, 'radius')} />
      )}
      {count && <NumberField label={count} value={layer.sides} min={3} max={24} step={1} digits={0} onChange={(sides) => set({ sides }, 'sides')} />}
      {(s === 'star' || s === 'burst') && (
        <SliderField label={t('Inner size')} value={layer.inner} scale={100} min={5} max={95} step={1} digits={0} unit="%"
                     onChange={(inner) => set({ inner }, 'inner')} />
      )}
      {s === 'arc' && (
        <>
          <NumberField label={t('From')} value={layer.from} min={-360} max={360} step={1} digits={0} unit="°" onChange={(from) => set({ from }, 'from')} />
          <NumberField label={t('Sweep')} value={layer.sweep} min={-360} max={360} step={1} digits={0} unit="°" onChange={(sweep) => set({ sweep }, 'sweep')} />
        </>
      )}
      {s === 'path' && (
        <TextArea label={t('Path')} value={layer.d ?? ''} maxLength={LIMITS.path} rows={3} dir="ltr" mono keep invalid={badPath}
                  placeholder="M10 90 L50 10 L90 90 Z"
                  hint={<small className={`mo-hint${badPath ? ' is-bad' : ''}`}>
                    {badPath ? t('Only path letters and numbers can be drawn.') : t('SVG path in a 100 × 100 box')}
                  </small>}
                  onChange={(d) => { setPath(d); set({ d: d.trim() || undefined }, 'd'); }} />
      )}
      <PaintField t={t} label={t('Fill')} value={layer.fill} palette={doc.palette} nullable onChange={(fill) => set({ fill }, 'fill')} />

      <SubToggle label={t('Stroke')} checked={!!stroke}
                 onChange={(on) => update('stroke', (l) => ({ stroke: on ? l.stroke ?? { color: 'fg', width: 0.5, cap: 'round' } : undefined }))} />
      {stroke && (
        <>
          <PaintField t={t} label={t('Colour')} value={stroke.color} palette={doc.palette} onChange={(color) => setStroke({ color: color ?? 'fg' })} />
          <NumberField label={t('Width')} value={stroke.width} min={0} max={100} step={0.1} digits={2} unit="u" unitTitle={uTitle(t)}
                       onChange={(width) => setStroke({ width })} />
          <SegField label={t('Line ends')} value={stroke.cap} choices={caps} onChange={(cap) => setStroke({ cap })} />
          <ToggleField label={t('Dashed')} checked={!!stroke.dash}
                       onChange={(on) => update('stroke', (l) => {
                         const cur = l.stroke ?? { color: 'fg', width: 0.5, cap: 'round' as const };
                         if (on) return { stroke: { ...cur, dash: cur.dash ?? [2, 1.5] } };
                         const { dash: _gone, ...rest } = cur;
                         return { stroke: rest };
                       })} />
          {stroke.dash && (
            <>
              <NumberField label={t('Dash')} value={stroke.dash[0]} min={0} max={LIMITS.size} step={0.5} digits={1} unit="u" unitTitle={uTitle(t)}
                           onChange={(v) => update('stroke', (l) => (l.stroke ? { stroke: { ...l.stroke, dash: [v, l.stroke.dash?.[1] ?? 1.5] } } : {}))} />
              <NumberField label={t('Gap')} value={stroke.dash[1]} min={0} max={LIMITS.size} step={0.5} digits={1} unit="u" unitTitle={uTitle(t)}
                           onChange={(v) => update('stroke', (l) => (l.stroke ? { stroke: { ...l.stroke, dash: [l.stroke.dash?.[0] ?? 2, v] } } : {}))} />
            </>
          )}
        </>
      )}
      {(s === 'blob' || s === 'wave') && <ShuffleRow t={t} seed={layer.seed} onShuffle={() => set({ seed: freshSeed() }, 'seed')} />}
    </>
  );
}

// ── icon ──────────────────────────────────────────────────────────────────

/**
 * The sixty icons as a grid to choose from, with a search over their names
 * (in the interface's language, and the English word the model writes). One
 * tab stop; the arrow keys move through the grid and choose.
 */
function IconGrid({ t, value, onPick }: { t: T; value: IconId; onPick: (id: IconId) => void }) {
  const [q, setQ] = useState('');
  const grid = useRef<HTMLDivElement>(null);
  const needle = q.trim().toLowerCase();
  const shown = ICON_IDS.filter((id) => !needle || id.includes(needle) || iconName(id, t).toLowerCase().includes(needle));
  const at = Math.max(0, shown.indexOf(value));
  useEffect(() => {
    // Keep the chosen icon in view when the grid opens on a layer.
    const el = grid.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (el && grid.current) grid.current.scrollTop = Math.max(0, el.offsetTop - grid.current.clientHeight / 2 + el.clientHeight / 2);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const key = (e: ReactKeyboardEvent, i: number) => {
    const cells = grid.current ? Array.from(grid.current.querySelectorAll<HTMLButtonElement>('button')) : [];
    if (!cells.length) return;
    const cols = Math.max(1, cells.filter((c) => c.offsetTop === cells[0].offsetTop).length);
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    let j = -1;
    if (e.key === 'ArrowRight') j = i + (rtl ? -1 : 1);
    else if (e.key === 'ArrowLeft') j = i + (rtl ? 1 : -1);
    else if (e.key === 'ArrowDown') j = i + cols;
    else if (e.key === 'ArrowUp') j = i - cols;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = cells.length - 1;
    else return;
    e.preventDefault();
    if (j < 0 || j >= cells.length) return;
    onPick(shown[j]);
    cells[j].focus();
  };
  return (
    <div className="mo-icons">
      <div className="mo-num mo-icon-search">
        <Icon name="search" size={12} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search')} aria-label={t('Search')} dir="auto" spellCheck={false} />
        {q && (
          <button type="button" className="mo-icon-btn mo-icon-clear" onClick={() => setQ('')} title={t('Clear the search')} aria-label={t('Clear the search')}>
            <Icon name="close" size={10} />
          </button>
        )}
      </div>
      {shown.length
        ? (
          <div ref={grid} className="mo-icon-grid" role="radiogroup" aria-label={t('Choose an icon')}>
            {shown.map((id, i) => (
              <button key={id} type="button" role="radio" aria-checked={id === value} className={id === value ? 'on' : ''} tabIndex={i === at ? 0 : -1}
                      title={iconName(id, t)} aria-label={iconName(id, t)} onClick={() => onPick(id)} onKeyDown={(e) => key(e, i)}>
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d={ICON_PATHS[id]} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ))}
          </div>
        )
        : <p className="mo-hint">{t('Nothing found. Try other words.')}</p>}
    </div>
  );
}

export function IconContent({ t, layer, doc, set, update }: KindProps<IconLayer>) {
  type BadgeMode = 'none' | 'circle' | 'squircle';
  const badges: Choice<BadgeMode>[] = [
    { value: 'none', label: t('None') },
    { value: 'circle', label: t('Circle') },
    { value: 'squircle', label: t('Rounded') },
  ];
  const badge = layer.badge;
  return (
    <>
      <IconGrid t={t} value={layer.icon} onPick={(icon) => set({ icon }, 'icon')} />
      <NumberField label={t('Size')} value={layer.size} min={0} max={LIMITS.size} step={0.5} digits={1} unit="u" unitTitle={uTitle(t)}
                   onChange={(size) => set({ size }, 'size')} />
      <PaintField t={t} label={t('Colour')} value={layer.color} palette={doc.palette} onChange={(color) => set({ color: color ?? 'fg' }, 'color')} />
      <NumberField label={t('Line weight')} value={layer.weight} min={0.25} max={6} step={0.25} digits={2}
                   onChange={(weight) => set({ weight }, 'weight')} />
      <SegField label={t('Badge')} value={badge?.shape ?? 'none'} choices={badges}
                onChange={(m) => update('badge', (l) => ({ badge: m === 'none' ? undefined : { fill: 'accent', pad: 2, ...l.badge, shape: m } }))} />
      {badge && (
        <>
          <PaintField t={t} label={t('Fill')} value={badge.fill} palette={doc.palette}
                      onChange={(f) => update('badge', (l) => ({ badge: l.badge && { ...l.badge, fill: f ?? 'accent' } }))} />
          <NumberField label={t('Padding')} value={badge.pad} min={0} max={100} step={0.5} digits={1} unit="u" unitTitle={uTitle(t)}
                       onChange={(pad) => update('badge', (l) => ({ badge: l.badge && { ...l.badge, pad } }))} />
        </>
      )}
    </>
  );
}

// ── picture ───────────────────────────────────────────────────────────────

function pictureProblem(why: PictureProblem, t: T): string {
  if (why === 'type') return t('This file is not a picture. Choose a PNG, JPEG, WebP, GIF or SVG.');
  if (why === 'size') return t('This picture is larger than 12 MB.');
  if (why === 'budget') return t('This picture is too large to keep, even made smaller.');
  return t('This picture could not be read.');
}

export function ImageContent({ t, layer, update, set }: KindProps<ImageLayer>) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<PictureProblem | null>(null);
  const [px, setPx] = useState<{ w: number; h: number } | null>(null);
  const alive = useRef(true);
  // Set again on every mount: React's development mode mounts, unmounts and mounts once more, and a flag only
  // ever cleared left every picture "Preparing…" for good.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const take = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    const r = await readPicture(file);
    if (!alive.current) return;
    setBusy(false);
    if (!r.ok) { setProblem(r.why); return; }
    // A first picture is 40 u on its long side; a picture put in place of another keeps the size of its box.
    update('src', (l) => ({ src: r.src, ...boxFor(r.w, r.h, l.src ? Math.max(l.w, l.h) || PICTURE_LONG_U : PICTURE_LONG_U) }));
  };
  const fits: Choice<ImageLayer['fit']>[] = [
    { value: 'cover', label: t('Fill the frame') },
    { value: 'contain', label: t('Show all of it') },
  ];
  return (
    <>
      <div className={`mo-pic${layer.src ? '' : ' is-empty'}`}>
        <div className="mo-pic-frame" aria-hidden={!layer.src}>
          {layer.src
            ? <img src={layer.src} alt="" style={{ objectFit: layer.fit }} onLoad={(e) => setPx({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
            : <Glyph name="image" size={22} />}
          {busy && <span className="mo-pic-busy vid-shimmer" />}
        </div>
        <div className="mo-pic-side">
          <button type="button" className="ghost mo-pic-choose" disabled={busy} onClick={() => input.current?.click()}>
            <Icon name="image" size={12} />{layer.src ? t('Change the picture') : t('Choose a picture')}
          </button>
          {layer.src && (
            <button type="button" className="ghost mo-pic-remove" disabled={busy} onClick={() => { setPx(null); set({ src: '' }, 'src'); }}>
              <Icon name="close" size={11} />{t('Remove this picture')}
            </button>
          )}
          {busy && <small className="mo-hint">{t('Preparing the picture…')}</small>}
          {!busy && px && layer.src && <small className="mo-hint" dir="ltr">{`${px.w} × ${px.h}`}</small>}
        </div>
        <input ref={input} type="file" accept={PICTURE_ACCEPT} hidden tabIndex={-1}
               onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void take(f); }} />
      </div>
      {problem && <p className="mo-hint is-bad" role="alert">{pictureProblem(problem, t)}</p>}
      <SizeRow t={t} w={layer.w} h={layer.h} onW={(w) => set({ w }, 'w')} onH={(h) => set({ h }, 'h')} />
      <SegField label={t('Picture fit')} value={layer.fit} choices={fits} onChange={(fit) => set({ fit }, 'fit')} />
      <NumberField label={t('Corner radius')} value={layer.radius} min={0} max={LIMITS.size} step={0.5} digits={1} unit="u" unitTitle={uTitle(t)}
                   onChange={(radius) => set({ radius }, 'radius')} />
    </>
  );
}

// ── counter ───────────────────────────────────────────────────────────────

export function CounterContent({ t, layer, doc, set, update }: KindProps<CounterLayer>) {
  const rtl = isRtlLang(doc.lang);
  const span = Math.max(0.05, layer.end - layer.start);
  const decimals: Choice<string>[] = ['0', '1', '2', '3'].map((d) => ({ value: d, label: d }));
  const setCount = (patch: Partial<CounterLayer['count']>, field: string) => update(field, (l) => ({ count: { ...l.count, ...patch } }));
  return (
    <>
      <Row label={t('From')}>
        <NumberBox label={t('From')} value={layer.from} min={-1e12} max={1e12} step={1} digits={3} onChange={(from) => set({ from }, 'from')} />
      </Row>
      <Row label={t('To')}>
        <NumberBox label={t('To')} value={layer.to} min={-1e12} max={1e12} step={1} digits={3} onChange={(to) => set({ to }, 'to')} />
      </Row>
      <SegField label={t('Decimals')} value={String(layer.decimals)} choices={decimals} onChange={(d) => set({ decimals: Number(d) }, 'decimals')} />
      <TextField label={t('Before the number')} value={layer.prefix} maxLength={LIMITS.suffix} onChange={(prefix) => set({ prefix }, 'prefix')} />
      <TextField label={t('After the number')} value={layer.suffix} maxLength={LIMITS.suffix} onChange={(suffix) => set({ suffix }, 'suffix')} />
      <ToggleField label={t('Thousands separator')} checked={layer.group} onChange={(group) => set({ group }, 'group')} />
      <VoiceField t={t} value={layer.voice} onChange={(voice) => set({ voice }, 'voice')} />
      <NumberField label={t('Size')} value={layer.size} min={0} max={LIMITS.size} step={0.5} digits={1} unit="u" unitTitle={uTitle(t)}
                   onChange={(size) => set({ size }, 'size')} />
      <SelectField label={t('Weight')} value={String(layer.weight)} choices={WEIGHTS} onChange={(w) => set({ weight: Number(w) }, 'weight')} />
      <PaintField t={t} label={t('Colour')} value={layer.color} palette={doc.palette} onChange={(color) => set({ color: color ?? 'fg' }, 'color')} />
      <AlignField t={t} value={layer.align} rtl={rtl} onChange={(align) => set({ align }, 'align')} />
      <NumberField label={t('Letter spacing')} value={layer.track} min={-0.2} max={1} step={0.01} digits={2} unit="em"
                   onChange={(track) => set({ track }, 'track')} />

      <Sub>{t('Roll')}</Sub>
      <NumberField label={t('Duration')} value={layer.count.d} min={0.05} max={span} step={0.05} digits={2} fixed unit={secUnit(t)}
                   onChange={(d) => setCount({ d }, 'count.d')} />
      <NumberField label={t('Delay')} value={layer.count.delay} min={0} max={span} step={0.05} digits={2} fixed unit={secUnit(t)}
                   onChange={(delay) => setCount({ delay }, 'count.delay')} />
      <EaseField t={t} label={t('Curve')} value={layer.count.ease} onChange={(ease) => setCount({ ease }, 'count.ease')} />
    </>
  );
}

// ── chart ─────────────────────────────────────────────────────────────────

/** A chart's numbers: a label and a value a row, reordered with the arrows, twelve at most. */
function DataTable({ t, layer, update }: { t: T; layer: ChartLayer; update: KindProps<ChartLayer>['update'] }) {
  const put = (fn: (d: ChartLayer['data']) => ChartLayer['data']) => update('data', (l) => ({ data: fn(l.data) }));
  const swap = (i: number, j: number) => put((d) => {
    if (j < 0 || j >= d.length) return d;
    const next = d.slice();
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const data = layer.data;
  return (
    <div className="mo-data">
      <div className="mo-area-top">
        <span className="mo-label">{t('Data')}</span>
        <span className="mo-count" dir="ltr">{`${data.length} / ${LIMITS.dataPoints}`}</span>
      </div>
      {data.length > 0 && (
        <ul className="mo-data-rows">
          {data.map((d, i) => (
            <li key={i} className="mo-data-row">
              <TextBox label={t('Label')} value={d.label} maxLength={LIMITS.label} placeholder={t('Label')}
                       onChange={(label) => put((cur) => cur.map((x, j) => (j === i ? { ...x, label } : x)))} />
              <NumberBox label={t('Value')} value={d.value} min={-1e12} max={1e12} step={1} digits={3} className="mo-num-value"
                         onChange={(value) => put((cur) => cur.map((x, j) => (j === i ? { ...x, value } : x)))} />
              <span className="mo-data-acts">
                <button type="button" className="mo-icon-btn" disabled={i === 0} onClick={() => swap(i, i - 1)} title={t('Move up')} aria-label={t('Move up')}>
                  <Icon name="chevron" size={11} turn={-90} />
                </button>
                <button type="button" className="mo-icon-btn" disabled={i === data.length - 1} onClick={() => swap(i, i + 1)}
                        title={t('Move down')} aria-label={t('Move down')}>
                  <Icon name="chevron" size={11} turn={90} />
                </button>
                <button type="button" className="mo-icon-btn" onClick={() => put((cur) => cur.filter((_, j) => j !== i))}
                        title={t('Remove')} aria-label={t('Remove')}>
                  <Icon name="close" size={11} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {data.length < LIMITS.dataPoints && (
        <button type="button" className="ghost mo-add-row" onClick={() => put((cur) => [...cur, { label: '', value: 0 }])}>
          <Icon name="plus" size={11} />{t('Add a row')}
        </button>
      )}
    </div>
  );
}

export function ChartContent({ t, layer, doc, set, update }: KindProps<ChartLayer>) {
  const types: Choice<Chart>[] = CHARTS.map((c) => ({ value: c, label: chartName(c, t), glyph: c }));
  const round = layer.chart === 'line' || layer.chart === 'donut' || layer.chart === 'ring';
  // A race keeps its earlier periods in each label, after a bar (motioncharts.ts, "The race"), and its scale is always
  // the leader's: it has no top of its own to set.
  const race = layer.chart === 'race';
  return (
    <>
      <SegField label={t('Kind')} value={layer.chart} choices={types} onChange={(chart) => set({ chart }, 'chart')} />
      <SizeRow t={t} w={layer.w} h={layer.h} onW={(w) => set({ w }, 'w')} onH={(h) => set({ h }, 'h')} />
      <DataTable t={t} layer={layer} update={update} />
      {race && <p className="mo-hint">{t('Earlier values go in the label after a |, like Rome|12 18 25. The value is the last one.')}</p>}
      <ColoursField t={t} label={t('Colours')} colors={layer.colors} doc={doc} max={LIMITS.colors}
                    onChange={(fn) => update('colors', (l) => ({ colors: fn(l.colors) }))} />
      {!race && (
        <NumberField label={t('Max')} value={layer.max} min={0} max={1e12} step={1} digits={3} zero={t('Auto')} onChange={(max) => set({ max }, 'max')} />
      )}
      <TextField label={t('Unit')} value={layer.unit} maxLength={LIMITS.suffix} onChange={(unit) => set({ unit }, 'unit')} />
      <ToggleField label={t('Labels')} checked={layer.labels} onChange={(labels) => set({ labels }, 'labels')} />
      <ToggleField label={t('Values')} checked={layer.values} onChange={(values) => set({ values }, 'values')} />
      {round && (
        <NumberField label={t('Thickness')} value={layer.thick} min={0} max={100} step={0.1} digits={1} unit="u" unitTitle={uTitle(t)}
                     onChange={(thick) => set({ thick }, 'thick')} />
      )}
      <NumberField label={t('Stagger')} value={layer.gap} min={0} max={1} step={0.01} digits={2} fixed unit={secUnit(t)} onChange={(gap) => set({ gap }, 'gap')} />
      {(layer.labels || layer.values) && (
        <>
          <Sub>{t('Labels')}</Sub>
          <VoiceField t={t} value={layer.voice} onChange={(voice) => set({ voice }, 'voice')} />
          <NumberField label={t('Text size')} value={layer.size} min={0} max={LIMITS.size} step={0.1} digits={1} unit="u" unitTitle={uTitle(t)}
                       onChange={(size) => set({ size }, 'size')} />
          <PaintField t={t} label={t('Text colour')} value={layer.color} palette={doc.palette} onChange={(color) => set({ color: color ?? 'fg' }, 'color')} />
        </>
      )}
    </>
  );
}

// ── background and particles ──────────────────────────────────────────────

export function BackdropContent({ t, layer, doc, set, update }: KindProps<BackdropLayer>) {
  const styles = BACKDROPS.map((b) => ({ value: b, label: backdropName(b, t) }));
  const words = backdropSliders(layer.style, t);
  return (
    <>
      <SelectField label={t('Style')} value={layer.style} choices={styles} onChange={(style) => set({ style }, 'style')} />
      <ColoursField t={t} label={t('Colours')} colors={layer.colors} doc={doc} max={4} onChange={(fn) => update('colors', (l) => ({ colors: fn(l.colors) }))} />
      <SliderField label={words.speed} value={layer.speed} min={0} max={3} step={0.05} digits={2} unit="×" onChange={(speed) => set({ speed }, 'speed')} />
      <SliderField label={words.density} value={layer.density} scale={100} min={0} max={100} step={1} digits={0} unit="%"
                   onChange={(density) => set({ density }, 'density')} />
      <ShuffleRow t={t} seed={layer.seed} onShuffle={() => set({ seed: freshSeed() }, 'seed')} />
    </>
  );
}

export function ParticlesContent({ t, layer, doc, set, update }: KindProps<ParticlesLayer>) {
  const styles = PARTICLES.map((p) => ({ value: p, label: particlesName(p, t) }));
  return (
    <>
      <SelectField label={t('Style')} value={layer.style} choices={styles} onChange={(style) => set({ style }, 'style')} />
      <ColoursField t={t} label={t('Colours')} colors={layer.colors} doc={doc} max={LIMITS.colors}
                    onChange={(fn) => update('colors', (l) => ({ colors: fn(l.colors) }))} />
      <SliderField label={t('Count')} value={layer.count} min={0} max={LIMITS.particles} step={1} digits={0} onChange={(count) => set({ count }, 'count')} />
      <NumberField label={t('Size')} value={layer.size} min={0} max={LIMITS.size} step={0.1} digits={1} unit="u" unitTitle={uTitle(t)}
                   onChange={(size) => set({ size }, 'size')} />
      <SliderField label={t('Speed')} value={layer.speed} min={0} max={3} step={0.05} digits={2} unit="×" onChange={(speed) => set({ speed }, 'speed')} />
      <NumberField label={t('Spread')} value={layer.spread} min={0} max={LIMITS.reach} step={1} digits={1} unit="u" unitTitle={uTitle(t)}
                   zero={t('Whole frame')} onChange={(spread) => set({ spread }, 'spread')} />
      <ToggleField label={t('One burst')} checked={layer.burst} onChange={(burst) => set({ burst }, 'burst')} />
      <ShuffleRow t={t} seed={layer.seed} onShuffle={() => set({ seed: freshSeed() }, 'seed')} />
    </>
  );
}

/** A few words for a folded Content section: what the layer is, at a glance. */
export function kindSummary(l: Layer, t: T): string {
  switch (l.kind) {
    case 'text': return l.text.split('\n')[0];
    case 'shape': return shapeName(l.shape, t);
    case 'icon': return iconName(l.icon, t);
    case 'image': return '';
    case 'counter': return `${l.prefix}${l.to}${l.suffix}`;
    case 'chart': return chartName(l.chart, t);
    case 'backdrop': return backdropName(l.style, t);
    default: return particlesName(l.style, t);
  }
}

/** The Content section of a layer, by its kind. */
export function KindContent(p: { t: T; layer: Layer; doc: Motion; set: (patch: Partial<Layer>, field: string) => void; update: (field: string, fn: (l: Layer) => Partial<Layer>) => void }) {
  const { layer } = p;
  // Each editor is handed functions typed to its own kind; the layer is that kind, so the casts only say what is already true.
  const as = <L extends Layer>() => ({
    t: p.t, doc: p.doc, layer: layer as L,
    set: p.set as KindProps<L>['set'],
    update: p.update as unknown as KindProps<L>['update'],
  });
  switch (layer.kind) {
    case 'text': return <TextContent {...as<TextLayer>()} />;
    case 'shape': return <ShapeContent {...as<ShapeLayer>()} />;
    case 'icon': return <IconContent {...as<IconLayer>()} />;
    case 'image': return <ImageContent {...as<ImageLayer>()} />;
    case 'counter': return <CounterContent {...as<CounterLayer>()} />;
    case 'chart': return <ChartContent {...as<ChartLayer>()} />;
    case 'backdrop': return <BackdropContent {...as<BackdropLayer>()} />;
    default: return <ParticlesContent {...as<ParticlesLayer>()} />;
  }
}
