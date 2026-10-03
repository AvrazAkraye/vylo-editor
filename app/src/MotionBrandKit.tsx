import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { fill } from './i18n';
import * as ask from './ask';
import { BRAND_LIMITS, applyBrand, readBrand, type BrandKit } from './motionbrand';
import { toneName } from './MotionControls';
import { fontStack, scriptOf } from './motionfonts';
import { voiceName } from './MotionKinds';
import { contrast } from './motionmath';
import { PICTURE_ACCEPT, readPicture, type PictureProblem } from './motionpicture';
import { PALETTES, type PaletteId } from './motionrecipe';
import { currentBrand, loadBrand, onBrand, saveBrand } from './motionstore';
import { DISPLAY_VOICE } from './motiontemplates';
import { TONES, VOICES, type Motion, type Palette, type Voice } from './motiontypes';
import type { T } from './motionui';

/**
 * The brand kit's button and its sheet (`motionbrand.ts` is what a kit is
 * and does).
 *
 * One button — the brand's colours and name once there is one, "Brand kit"
 * until then — that opens one small sheet: the name, the account, the web
 * address, the logo, five colours, the headline face, a preview of them
 * together, and Save. Nothing is in a tab or behind another click. Home shows
 * the button beside the search, where it sets what new graphics start in;
 * Design shows it with the graphic open (`doc`, `onChange`), where the sheet
 * also offers to apply the brand to that graphic.
 *
 * The sheet edits a draft. It opens on the kit as it is kept, Save keeps the
 * draft (`saveBrand`), and closing without saving — Escape, a press outside —
 * drops it. Every button showing the kit changes when any of them saves
 * (`onBrand`).
 */

export interface BrandKitProps {
  t: T;
  /** The graphic open in Design: the sheet can apply the brand to it. */
  doc?: Motion;
  /** The graphic re-skinned in the brand (`applyBrand`), for the panel to record and keep. */
  onChange?(next: Motion): void;
  /** Called after the brand was applied to `doc`. */
  onApplied?(): void;
}

/** How the colours are chosen: each template's own, one of the nine palettes, or five of the person's. */
type Colours = 'own' | 'custom' | PaletteId;

interface Draft {
  name: string;
  handle: string;
  url: string;
  logo: string;
  colours: Colours;
  palette: Palette;
  voice: Voice;
}

/** The colours a draft starts from when it has none: the open graphic's, else the first palette's. */
function startPalette(doc?: Motion): Palette {
  return doc ? { ...doc.palette } : { ...PALETTES[0].colors };
}

function draftOf(kit: BrandKit | null, doc?: Motion): Draft {
  return {
    name: kit?.name ?? '',
    handle: kit?.handle ?? '',
    url: kit?.url ?? '',
    logo: kit?.logo ?? '',
    colours: kit?.paletteId ?? (kit?.palette ? 'custom' : 'own'),
    palette: kit?.palette ? { ...kit.palette } : startPalette(doc),
    voice: kit?.voice ?? DISPLAY_VOICE,
  };
}

/** The kit a draft makes, read as a stored one would be; null when it holds nothing. */
function kitOf(d: Draft): BrandKit | null {
  return readBrand({
    name: d.name, handle: d.handle, url: d.url, logo: d.logo || undefined, voice: d.voice,
    paletteId: d.colours !== 'own' && d.colours !== 'custom' ? d.colours : null,
    palette: d.colours === 'own' ? null : d.palette,
  });
}

/** `#rrggbb` for a colour input, from a colour the reader kept. */
function hex6(c: string): string {
  const m = /^#([0-9a-f]{6})/i.exec(c);
  return m ? `#${m[1].toLowerCase()}` : '#000000';
}

function pictureProblem(why: PictureProblem, t: T): string {
  if (why === 'type') return t('This file is not a picture. Choose a PNG, JPEG, WebP, GIF or SVG.');
  if (why === 'size') return t('This picture is larger than 12 MB.');
  if (why === 'budget') return t('This picture is too large to keep, even made smaller.');
  return t('This picture could not be read.');
}

/** The kit as the button shows it: its colours, or a star when it has none. */
function Dots({ kit }: { kit: BrandKit | null }) {
  if (!kit?.palette) return <Icon name="star" size={13} />;
  const p = kit.palette;
  return (
    <span className="mb-dots" aria-hidden="true">
      {(['bg', 'accent', 'accent2'] as const).map((k) => <i key={k} style={{ background: p[k] }} />)}
    </span>
  );
}

/** The kit together as a graphic would show it: its ground, its logo, its name in its face, its account and address, its accents. */
function Preview({ t, d }: { t: T; d: Draft }) {
  const own = d.colours === 'own';
  const p = own ? PALETTES[0].colors : d.palette;
  const name = d.name.trim() || t('Your name');
  return (
    <div className={`mb-preview${own ? ' is-own' : ''}`} style={{ background: p.bg, color: p.fg }} aria-hidden="true">
      {d.logo ? <img className="mb-preview-logo" src={d.logo} alt="" /> : <span className="mb-preview-mark" style={{ background: p.accent }} />}
      <span className="mb-preview-words">
        <b dir="auto" style={{ fontFamily: fontStack(d.voice, scriptOf(name)) }}>{name}</b>
        {(d.handle || d.url) && (
          <small dir="auto" style={{ color: p.muted }}>{[d.handle && `@${d.handle.replace(/^@+/, '')}`, d.url].filter(Boolean).join('  ·  ')}</small>
        )}
      </span>
      <span className="mb-preview-bar" style={{ background: `linear-gradient(90deg, ${p.accent}, ${p.accent2})` }} />
    </div>
  );
}

export function MotionBrandKit({ t, doc, onChange, onApplied }: BrandKitProps) {
  const [kit, setKit] = useState<BrandKit | null>(() => currentBrand());
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<Draft>(() => draftOf(currentBrand(), doc));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<PictureProblem | null>(null);
  const [unkept, setUnkept] = useState(false);
  /** Said once the brand is applied: the sheet closes and the graphic changes, which a screen reader does not see. */
  const [said, setSaid] = useState('');
  /** Where the sheet hangs: from the button's start edge when its end would run out of the window, and above it when below has no room. */
  const [place, setPlace] = useState({ start: false, up: false });
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const id = useId();

  useEffect(() => {
    alive.current = true;
    const stop = onBrand((b) => { if (alive.current) setKit(b); });
    void loadBrand().then((b) => { if (alive.current) setKit(b); });
    return () => {
      alive.current = false;
      stop();
    };
  }, []);

  const show = () => {
    setPlace({ start: false, up: false });
    setD(draftOf(kit, doc));
    setProblem(null);
    setUnkept(false);
    setSaid('');
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };

  // The sheet stays in the window; the first box takes the focus; a press outside the sheet closes it.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const r = box.current?.getBoundingClientRect();
    const b = btn.current?.getBoundingClientRect();
    if (r && b) {
      const out = r.left < 8 || r.right > window.innerWidth - 8;
      const up = r.bottom > window.innerHeight - 8 && b.top - r.height - 8 > 0;
      if (out || up) setPlace({ start: out, up });
    }
    box.current?.querySelector<HTMLInputElement>('input')?.focus();
    const down = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target || box.current?.contains(target) || btn.current?.contains(target)) return;
      // The question Clear asks is answered in a box of its own, which is not outside the sheet.
      if (target instanceof Element && target.closest('.askbox')) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [open]);

  const put = (patch: Partial<Draft>) => setD((cur) => ({ ...cur, ...patch }));

  const takeLogo = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setProblem(null);
    const r = await readPicture(f);
    if (!alive.current) return;
    setBusy(false);
    if (!r.ok) setProblem(r.why);
    else put({ logo: r.src });
  };

  const keep = async (next: BrandKit | null): Promise<boolean> => {
    const ok = await saveBrand(next);
    if (alive.current) setUnkept(!ok);
    return ok;
  };

  const save = async () => {
    const ok = await keep(kitOf(d));
    if (ok) close(true);
  };

  const apply = async () => {
    const next = kitOf(d);
    await keep(next);
    if (doc && onChange && next) {
      const branded = applyBrand(doc, next);
      if (branded !== doc) onChange(branded);
      setSaid(next.name ? fill(t('Applied the brand kit: {name}'), { name: next.name }) : t('Applied the brand kit'));
      onApplied?.();
    }
    close(true);
  };

  const clear = async () => {
    const yes = await ask.confirm({
      title: t('Clear the brand kit?'),
      body: t('New graphics will start in each template’s own colours and words again. Graphics already made keep theirs.'),
      confirmLabel: t('Clear'),
      danger: true,
    });
    if (!yes) return;
    await keep(null);
    setD(draftOf(null, doc));
  };

  const draftKit = kitOf(d);
  const lowContrast = d.colours !== 'own' && contrast(d.palette.fg, d.palette.bg) < 4.5;
  const label = kit?.name ? fill(t('Brand kit: {name}'), { name: kit.name }) : t('Brand kit');

  return (
    <div className="mb-anchor">
      <button ref={btn} type="button" className={`ghost mb-btn${kit ? ' is-set' : ''}`} aria-haspopup="dialog" aria-expanded={open}
              aria-label={label} title={label} onClick={() => (open ? close(false) : show())}>
        <Dots kit={kit} />
        <span className="mb-btn-name" dir="auto">{kit?.name || t('Brand kit')}</span>
      </button>
      <span className="vid-tl-sr" role="status">{said}</span>
      {open && (
        <div ref={box} className={`mb-sheet${place.start ? ' is-start' : ''}${place.up ? ' is-up' : ''}`} role="dialog" aria-labelledby={`${id}-h`}
             onKeyDown={(e) => {
               if (e.key !== 'Escape') return;
               e.preventDefault();
               e.stopPropagation();
               close(true);
             }}>
          <div className="mb-head">
            <b id={`${id}-h`}>{t('Brand kit')}</b>
            <small>{t('New graphics start in your colours, font and name.')}</small>
          </div>

          <label className="mb-row">
            <span>{t('Name')}</span>
            <input className="mo-text" value={d.name} dir="auto" maxLength={BRAND_LIMITS.name} spellCheck={false}
                   placeholder={t('Your organisation')} onChange={(e) => put({ name: e.target.value })} />
          </label>
          <label className="mb-row">
            <span>{t('Handle')}</span>
            {/* Left to right like the handle itself, so in Arabic and Kurdish the @ still stands just before it. */}
            <span className="mb-at" dir="ltr">
              <i aria-hidden="true">@</i>
              <input className="mo-text" value={d.handle} dir="ltr" maxLength={BRAND_LIMITS.handle + 1} spellCheck={false} autoComplete="off"
                     onChange={(e) => put({ handle: e.target.value.replace(/^[@\uff20]+/, '') })} />
            </span>
          </label>
          <label className="mb-row">
            <span>{t('Website')}</span>
            <input className="mo-text" value={d.url} dir="ltr" maxLength={BRAND_LIMITS.url + 8} spellCheck={false} autoComplete="off"
                   placeholder="example.com" onChange={(e) => put({ url: e.target.value })} />
          </label>

          <div className="mb-row">
            <span id={`${id}-logo`}>{t('Logo')}</span>
            <span className="mb-logo" role="group" aria-labelledby={`${id}-logo`}>
              <span className={`mb-logo-frame${d.logo ? '' : ' is-empty'}`} aria-hidden="true">
                {d.logo ? <img src={d.logo} alt="" /> : <Icon name="image" size={16} />}
              </span>
              <button type="button" className="ghost mo-pic-choose" disabled={busy} onClick={() => file.current?.click()}>
                {busy ? t('Preparing the picture…') : d.logo ? t('Change the picture') : t('Choose a picture')}
              </button>
              {d.logo && !busy && (
                <button type="button" className="ghost mb-icon" onClick={() => put({ logo: '' })} title={t('Remove this picture')} aria-label={t('Remove this picture')}>
                  <Icon name="close" size={11} />
                </button>
              )}
              <input ref={file} type="file" accept={PICTURE_ACCEPT} hidden tabIndex={-1}
                     onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void takeLogo(f); }} />
            </span>
          </div>
          {problem && <p className="mo-hint is-bad" role="alert">{pictureProblem(problem, t)}</p>}

          <label className="mb-row">
            <span>{t('Colours')}</span>
            <select className="mo-sel" value={d.colours}
                    onChange={(e) => {
                      const v = e.target.value as Colours;
                      const pal = PALETTES.find((p) => p.id === v);
                      put(pal ? { colours: v, palette: { ...pal.colors } } : { colours: v });
                    }}>
              <option value="own">{t('Each template’s own')}</option>
              {PALETTES.map((p) => <option key={p.id} value={p.id}>{t(p.name)}</option>)}
              <option value="custom">{t('Your own colours')}</option>
            </select>
          </label>
          {d.colours !== 'own' && (
            <div className="mb-tones" role="group" aria-label={t('Colours')}>
              {TONES.map((k) => (
                <label key={k} className="mb-tone" title={toneName(k, t)}>
                  <input type="color" value={hex6(d.palette[k])} aria-label={toneName(k, t)}
                         onChange={(e) => {
                           const c = e.target.value.toLowerCase();
                           setD((cur) => ({ ...cur, colours: 'custom', palette: { ...cur.palette, [k]: c } }));
                         }} />
                  <small>{toneName(k, t)}</small>
                </label>
              ))}
            </div>
          )}

          <label className="mb-row">
            <span>{t('Headline font')}</span>
            <select className="mo-sel" value={d.voice} onChange={(e) => put({ voice: e.target.value as Voice })}>
              {VOICES.map((v) => <option key={v} value={v}>{voiceName(v, t)}</option>)}
            </select>
          </label>

          <Preview t={t} d={d} />
          {d.colours === 'own' && <p className="mo-hint">{t('Each template keeps the colours it was designed in.')}</p>}
          {lowContrast && <p className="mo-hint is-bad">{t('The text colour is hard to read on this background.')}</p>}
          {unkept && <p className="mo-hint is-bad" role="alert">{t('The brand kit could not be kept on this machine. It lasts until the app closes.')}</p>}

          <div className="mb-acts">
            {kit && (
              <button type="button" className="ghost mb-clear" onClick={() => void clear()}>{t('Clear')}</button>
            )}
            <span className="mb-gap" />
            {doc && onChange && (
              <button type="button" className="ghost bordered mb-apply" disabled={!draftKit || busy} onClick={() => void apply()}>
                <span className="cta-label">{t('Apply to this graphic')}</span>
              </button>
            )}
            <button type="button" className="sb-cta-go" disabled={busy || (!draftKit && !kit)} onClick={() => void save()}>{t('Save')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
