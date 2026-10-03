import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { LANGS, fill } from './i18n';
import { FORMATS, FORMAT_IDS, FPS_CHOICES, LIMITS, TONES, type Format, type Tone } from './motiontypes';
import type { InspectorProps, T } from './motionui';
import { setBackdrop, setFields, setFormat, setFps, setLang, setPalette, setSeconds, setTitle } from './motionedit';
import { readTitle } from './motionread';
import { META, PALETTES, type Field } from './motionrecipe';
import { withSound } from './motionsound';
import { MotionSoundPanel } from './MotionSoundPanel';
import { MotionBrandKit } from './MotionBrandKit';

/**
 * The Design tab: the graphic as a whole, not one layer of it — its words,
 * its title, its shape, how long it runs and how smoothly, the language its
 * words are in, its colours and whether its frame is solid.
 *
 * ## One door
 *
 * Every control hands the panel a change from motionedit.ts (`onEdit`), so
 * the panel records it for undo and keeps it; nothing here writes into the
 * graphic. Typing and dragging pass a key (`field:title`, `seconds`,
 * `palette:accent`), so a word typed a letter at a time, or a slider dragged
 * across, is one undo step. The length slider is the exception: see
 * `LengthSlider`.
 *
 * ## The words are the template's
 *
 * A graphic made from a template remembers the template and its words, and a
 * change of words builds it again (`setFields`), laid out afresh — so the
 * form is the template's own fields (motionrecipe.ts `META`), each edited the
 * way its kind says. Once a layer has been edited by hand the link is gone:
 * rebuilding would throw that edit away, so the form says so and points to
 * Layers.
 *
 * ## What is typed stays as typed
 *
 * The graphic keeps its words cleaned — trimmed, capped — and is rebuilt on
 * every key, so a box showing the graphic's copy would swallow the space
 * typed at the end of a word, under the caret. A box shows what was typed
 * while it has the focus, and takes the graphic's copy when that says
 * something else (an undo, a change made elsewhere) and when it is left.
 *
 * ## Sound and the brand (pro pass)
 *
 * Two lines, no more: the graphic's sound as one row of its own after the
 * length (MotionSoundPanel.tsx — Off until somebody chooses; the moods and the
 * level appear only once it sounds), and the brand kit's button beside the
 * Colours heading (MotionBrandKit.tsx), where it can also re-skin this
 * graphic. Both change the graphic through `onEdit` like everything else: the
 * sound is applied to the newest copy (`withSound`) under one key, so a level
 * dragged across is one undo step.
 */

/** The length chips: a sting, a title, a lower third, a chart, a long loop. */
const PRESETS = [3, 5, 8, 12, 20] as const;

const secs = (n: number) => String(Math.round((Number.isFinite(n) ? n : 0) * 100) / 100);

/** The same words, however they were spaced: what the graphic keeps of what was typed. */
function norm(s: string): string {
  return s.replace(/\r\n?/g, '\n').normalize('NFC').split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean).join('\n');
}

/** Eastern Arabic and Persian digits, and the Arabic decimal point, as the digits a number is kept in. */
const DIGIT: Readonly<Record<string, string>> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٫': '.',
};

/** A number field's text: digits, a sign in front, one point; anything else is dropped, and ١٢٣ is 123. */
function cleanNumber(s: string, max: number): string {
  let out = '';
  let point = false;
  for (const raw of Array.from(s)) {
    const c = DIGIT[raw] ?? raw;
    if (c >= '0' && c <= '9') out += c;
    else if ((c === '-' || c === '+') && out === '') out += c;
    else if (c === '.' && !point) {
      point = true;
      out += c;
    }
  }
  return out.slice(0, Math.max(1, max));
}

/** A list field's text, cut to its most lines. */
function capLines(s: string, max: number): string {
  const lines = s.split('\n');
  return lines.length > max ? lines.slice(0, max).join('\n') : s;
}

/** `#rrggbb`, which a colour input needs, from whatever colour the palette holds; black when it is not one. */
function hexOf(c: string): string {
  const s = String(c).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{8}$/.test(s)) return s.slice(0, 7);
  if (/^#[0-9a-f]{3,4}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return '#000000';
}

/** A hex colour as typed — `#1a5fdf`, `1A5FDF`, `#abc` — or null while it is not one yet. */
function parseHex(s: string): string | null {
  const v = s.trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(v)) return `#${v.toLowerCase()}`;
  if (/^[0-9a-f]{3}$/i.test(v)) return hexOf(`#${v}`);
  return null;
}

function formatName(f: Format, t: T): string {
  if (f === 'portrait') return t('Vertical 9:16');
  if (f === 'square') return t('Square 1:1');
  if (f === 'feed') return t('Feed 4:5');
  return t('Wide 16:9');
}

/** A palette colour by its role, in the words the rest of the studio uses for it. */
function toneName(tone: Tone, t: T): string {
  if (tone === 'bg') return t('Background');
  if (tone === 'fg') return t('Text colour');
  if (tone === 'accent') return t('Accent colour');
  if (tone === 'accent2') return t('Second accent');
  return t('Muted colour');
}

/** A choice field's option, named: the backgrounds a loop can be. Written out, so the catalogue sees each. */
function optionName(o: string, t: T): string {
  if (o === 'aurora') return t('Aurora');
  if (o === 'grid') return t('Grid');
  if (o === 'dots') return t('Dots');
  if (o === 'rays') return t('Rays');
  if (o === 'waves') return t('Waves');
  if (o === 'bokeh') return t('Bokeh');
  if (o === 'stripes') return t('Stripes');
  return o.charAt(0).toUpperCase() + o.slice(1);
}

/**
 * What a box shows while it is typed in (see the header). `same` says whether
 * the graphic's copy is only a cleaned version of what was typed.
 */
function useDraft(value: string, same: (typed: string, kept: string) => boolean) {
  const [draft, setDraft] = useState(value);
  const typing = useRef(false);
  const live = useRef(same);
  live.current = same;
  useEffect(() => {
    setDraft((d) => (typing.current && live.current(d, value) ? d : value));
  }, [value]);
  return {
    draft,
    type: (v: string) => setDraft(v),
    onFocus: () => { typing.current = true; },
    onBlur: () => {
      typing.current = false;
      setDraft(value);
    },
  };
}

/**
 * The length slider. A drag is one change, made when it is let go — not one
 * per step. Shortening a graphic moves every layer inside the new length
 * (motionedit.ts `setSeconds`), so a drag from 6 s down to 1 s and back,
 * applied a step at a time to each result, would leave every late layer
 * squeezed into the first second. The thumb and the number follow the drag;
 * the graphic changes once, from what it was.
 */
function LengthSlider({ t, id, seconds, onCommit }: { t: T; id: string; seconds: number; onCommit: (n: number) => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => {
    const el = input.current;
    if (!el) return undefined;
    // React's onChange is the `input` event, sent at every step of a drag; the browser's own `change` is the release
    // (and each step of a key press or of an assistive technology's adjustment).
    const released = () => {
      setDrag(null);
      commit.current(Number(el.value));
    };
    el.addEventListener('change', released);
    return () => el.removeEventListener('change', released);
  }, []);
  // The length changed some other way (an undo, a chat change): show that, not a drag that is over.
  useEffect(() => setDrag(null), [seconds]);
  const shown = drag ?? seconds;
  return (
    <div className="vid-look-slider mo-de-len">
      <input ref={input} type="range" min={LIMITS.minSeconds} max={LIMITS.seconds} step={0.5} value={shown} aria-labelledby={id}
             aria-valuetext={fill(t('{n} s'), { n: secs(shown) })}
             onChange={(e) => setDrag(Number(e.target.value))} />
      <output>{fill(t('{n} s'), { n: secs(shown) })}</output>
    </div>
  );
}

/**
 * The brand kit's button, and its sheet brought into view when it opens: it hangs below the Colours heading, in the
 * middle of a column that scrolls, and would otherwise open half under the column's edge.
 */
function BrandSlot({ children }: { children: ReactNode }) {
  const box = useRef<HTMLSpanElement>(null);
  const reveal = () => requestAnimationFrame(() => box.current?.querySelector('.mb-sheet')?.scrollIntoView({ block: 'nearest' }));
  return <span className="mo-de-brand" ref={box} onClickCapture={reveal}>{children}</span>;
}

/** A section of the tab under its heading; `aside` is a quiet control on the heading's line, at its end. */
function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <section className="mo-de-sec" aria-labelledby={id}>
      {aside
        ? (
          <div className="mo-de-head">
            <h3 className="mo-de-h" id={id}>{title}</h3>
            {aside}
          </div>
        )
        : <h3 className="mo-de-h" id={id}>{title}</h3>}
      {children(id)}
    </section>
  );
}

/** One of a template's fields, edited the way its kind says. */
function FieldBox({ t, field, value, chart, onChange }: {
  t: T;
  field: Field;
  value: string;
  /** A list of a chart's data, written `Label: value`. */
  chart: boolean;
  onChange: (v: string) => void;
}) {
  const d = useDraft(value, (a, b) => norm(a) === norm(b));
  const id = useId();
  const label = t(field.label);
  const put = (v: string) => {
    if (v === d.draft) return;
    d.type(v);
    onChange(v);
  };
  if (field.kind === 'choice') {
    return (
      <div className="vid-f">
        <span id={id}>{label}</span>
        <span className="vid-seg" role="group" aria-labelledby={id}>
          {(field.options ?? []).map((o) => (
            <button key={o} type="button" className={value === o ? 'on' : ''} aria-pressed={value === o}
                    onClick={() => { if (value !== o) onChange(o); }}>
              {optionName(o, t)}
            </button>
          ))}
        </span>
      </div>
    );
  }
  let box: JSX.Element;
  if (field.kind === 'text') {
    box = <textarea rows={3} value={d.draft} dir="auto" maxLength={field.max} onFocus={d.onFocus} onBlur={d.onBlur} onChange={(e) => put(e.target.value)} />;
  } else if (field.kind === 'list') {
    box = (
      <textarea rows={5} value={d.draft} dir="auto" maxLength={LIMITS.fieldChars} placeholder={chart ? t('One per line — Label: value') : t('One per line')}
                onFocus={d.onFocus} onBlur={d.onBlur} onChange={(e) => put(capLines(e.target.value, field.max))} />
    );
  } else if (field.kind === 'number') {
    // A number reads left to right in every language; its digits are kept as 0–9 whatever the keyboard typed.
    box = (
      <input value={d.draft} dir="ltr" inputMode="decimal" spellCheck={false} maxLength={field.max} className="mo-de-num"
             onFocus={d.onFocus} onBlur={d.onBlur} onChange={(e) => put(cleanNumber(e.target.value, field.max))} />
    );
  } else {
    box = <input value={d.draft} dir="auto" maxLength={field.max} onFocus={d.onFocus} onBlur={d.onBlur} onChange={(e) => put(e.target.value)} />;
  }
  return (
    <label className="vid-f">
      <span>{label}</span>
      {box}
    </label>
  );
}

/** One of the five colours: the swatch the system picker opens from, and its hex code to type or paste. */
function ToneRow({ t, tone, value, onChange }: { t: T; tone: Tone; value: string; onChange: (hex: string) => void }) {
  const id = useId();
  const hex = hexOf(value);
  const d = useDraft(hex.toUpperCase(), (a, b) => parseHex(a) === b.toLowerCase());
  const name = toneName(tone, t);
  return (
    <div className="vid-look-line mo-de-tone">
      <label htmlFor={id}>{name}</label>
      <span className="vid-look-swatch">
        <input id={id} type="color" value={hex} onChange={(e) => { if (e.target.value.toLowerCase() !== hex) onChange(e.target.value.toLowerCase()); }} />
        <input className="mo-de-hex" value={d.draft} dir="ltr" spellCheck={false} maxLength={7} aria-label={fill(t('{name} as a hex code'), { name })}
               onFocus={d.onFocus} onBlur={d.onBlur}
               onChange={(e) => {
                 d.type(e.target.value);
                 const next = parseHex(e.target.value);
                 if (next && next !== hex) onChange(next);
               }} />
      </span>
    </div>
  );
}

export function MotionDesign(p: InspectorProps) {
  const { t, doc, onEdit } = p;
  const recipe = doc.recipe;
  const meta = recipe ? META[recipe.id] : undefined;
  const title = useDraft(doc.title, (a, b) => readTitle(a) === b);
  const active = PALETTES.find((pal) => TONES.every((k) => hexOf(pal.colors[k]) === hexOf(doc.palette[k])));
  const clear = doc.backdrop === null;
  const fpsId = useId();

  return (
    <div className="mo-de">
      {/* Not the catalogue's "Words": that one is a word count. */}
      <Section title={t('Words on screen')}>
        {() => (recipe && meta
          ? meta.fields.map((f) => (
            <FieldBox key={`${recipe.id}:${f.key}`} t={t} field={f} value={recipe.fields[f.key] ?? ''} chart={meta.group === 'data'}
                      onChange={(v) => onEdit((m) => setFields(m, { [f.key]: v }), `field:${f.key}`)} />
          ))
          : <p className="mo-de-off">{t('This graphic has no template words to change here. Change its words in Layers.')}</p>)}
      </Section>

      <Section title={t('Title')}>
        {(id) => (
          <>
            <div className="vid-f">
              <input value={title.draft} dir="auto" maxLength={LIMITS.title} aria-labelledby={id}
                     onFocus={title.onFocus} onBlur={title.onBlur}
                     onChange={(e) => {
                       const v = e.target.value;
                       title.type(v);
                       onEdit((m) => setTitle(m, v), 'title');
                     }} />
            </div>
            <p className="vid-note">{t('What the graphic is called in your list, and the name it is saved with.')}</p>
          </>
        )}
      </Section>

      <Section title={t('Shape')}>
        {(id) => (
          <div className="vid-formats mo-de-shapes" role="group" aria-labelledby={id}>
            {FORMAT_IDS.map((f) => {
              const on = doc.format === f;
              const { width, height, ratio } = FORMATS[f];
              const k = 18 / Math.max(width, height);
              return (
                <button key={f} type="button" className={on ? 'on' : ''} aria-pressed={on} title={formatName(f, t)} aria-label={formatName(f, t)}
                        onClick={() => { if (!on) onEdit((m) => setFormat(m, f)); }}>
                  <i className="mo-de-frame" aria-hidden="true" style={{ inlineSize: Math.round(width * k), blockSize: Math.round(height * k) }} />
                  <b dir="ltr">{ratio}</b>
                </button>
              );
            })}
          </div>
        )}
      </Section>

      <Section title={t('Length')}>
        {(id) => (
          <>
            <LengthSlider t={t} id={id} seconds={doc.seconds} onCommit={(n) => onEdit((m) => setSeconds(m, n), 'seconds')} />
            <div className="mo-de-chips" role="group" aria-labelledby={id}>
              {PRESETS.map((n) => (
                <button key={n} type="button" className={doc.seconds === n ? 'gal-chip on' : 'gal-chip'} aria-pressed={doc.seconds === n}
                        onClick={() => { if (doc.seconds !== n) onEdit((m) => setSeconds(m, n), 'seconds'); }}>
                  {fill(t('{n} s'), { n })}
                </button>
              ))}
            </div>
            <div className="vid-look-line">
              <span id={fpsId}>{t('Frame rate')}</span>
              <span className="vid-seg" role="group" aria-labelledby={fpsId}>
                {FPS_CHOICES.map((f) => (
                  <button key={f} type="button" className={doc.fps === f ? 'on' : ''} aria-pressed={doc.fps === f}
                          onClick={() => { if (doc.fps !== f) onEdit((m) => setFps(m, f)); }}>
                    {f}
                  </button>
                ))}
              </span>
            </div>
          </>
        )}
      </Section>

      {/* One row, its own label for a heading: Off, Effects, Music, Both. */}
      <div className="mo-de-sec mo-de-sound">
        <MotionSoundPanel t={t} doc={doc} onChange={(next) => onEdit((m) => withSound(m, next.sound), 'sound')} />
      </div>

      <Section title={t('Language of the words')}>
        {(id) => (
          <>
            <span className="vid-seg vid-langs" role="group" aria-labelledby={id}>
              {LANGS.map((l) => (
                <button key={l.code} type="button" lang={l.code} dir="auto" className={doc.lang === l.code ? 'on' : ''} aria-pressed={doc.lang === l.code}
                        onClick={() => { if (doc.lang !== l.code) onEdit((m) => setLang(m, l.code)); }}>
                  {l.label}
                </button>
              ))}
            </span>
            <p className="vid-note">{t('Sets the direction, the digits and the typefaces.')}</p>
          </>
        )}
      </Section>

      <Section title={t('Colours')} aside={<BrandSlot><MotionBrandKit t={t} doc={doc} onChange={(next) => onEdit(() => next)} /></BrandSlot>}>
        {(id) => (
          <>
            <div className="vid-styles mo-de-pals" role="group" aria-labelledby={id}>
              {PALETTES.map((pal) => {
                const on = active?.id === pal.id;
                return (
                  <button key={pal.id} type="button" className={on ? 'on' : ''} aria-pressed={on}
                          onClick={() => { if (!on) onEdit((m) => setPalette(m, pal.colors)); }}>
                    <span className="mo-de-dots" aria-hidden="true">
                      {TONES.map((k) => <i key={k} style={{ background: pal.colors[k] }} />)}
                    </span>
                    <b>{t(pal.name)}</b>
                  </button>
                );
              })}
            </div>
            <div className="mo-de-tones">
              {TONES.map((k) => (
                <ToneRow key={k} t={t} tone={k} value={doc.palette[k]}
                         onChange={(hex) => onEdit((m) => setPalette(m, { ...m.palette, [k]: hex }), `palette:${k}`)} />
              ))}
            </div>
          </>
        )}
      </Section>

      <Section title={t('Frame')}>
        {(id) => (
          <>
            <span className="vid-seg" role="group" aria-labelledby={id}>
              <button type="button" className={clear ? '' : 'on'} aria-pressed={!clear}
                      onClick={() => { if (clear) onEdit((m) => setBackdrop(m, 'bg')); }}>
                {t('Solid')}
              </button>
              <button type="button" className={clear ? 'on' : ''} aria-pressed={clear}
                      onClick={() => { if (!clear) onEdit((m) => setBackdrop(m, null)); }}>
                {t('Transparent')}
              </button>
            </span>
            {clear && <p className="vid-note">{t('An MP4 cannot keep transparency. Save a PNG to keep it.')}</p>}
          </>
        )}
      </Section>
    </div>
  );
}
