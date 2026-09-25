import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { save as savePanel } from '@tauri-apps/plugin-dialog';
import { Icon } from './Icon';
import * as ask from './ask';
import { fill, type Lang } from './i18n';
import { explain } from './errors';
import { BUILT_IN, armed, route as routeOf, type Chosen, type Provider } from './providers';
import { allows, type PlanSummary } from './account';
import { MODELS, modelName } from './models';
import { EFFORTS, effortLabel, effortOf, effortsFor, type Effort, type EffortBook } from './effort';
import { generate, type Target } from './generate';
import {
  COUNTS, DECK_KINDS, THEMES, WRITTEN_KINDS, blankSlide, countFor, countIn, deckLangOf, fileNameFor, fromResearch,
  isRtl, kindIn, newDeck, parsePlan, parseSlide, planPrompt, slidePrompt, themeIn,
  type Deck, type DeckKind, type DeckLang, type DeckMeta, type Pair, type Slide, type SlideKind, type Theme,
} from './slides';
import { PALETTES } from './slideslayout';
import { pptxBase64 } from './slidespptx';
import { deleteDeck, loadDecks, saveDeck } from './slidestore';
import { loadDocs } from './researchstore';
import { LOGO_KEY, PROFILE_KEY, logoFor, readLogos, readProfile, type Doc } from './research';
import { brandFromLogo, paletteOfImage, type Swatch } from './videopalette';
import { SlideCanvas, SlideView } from './SlideView';
import { kindAbout, kindName, langName, slideKindName, themeName } from './slidesnames';
import { deckHistory } from './slideshistory';
import { SlidesChat } from './SlidesChat';
import { IS_MAC } from './Welcome';
import './slides.css';

/**
 * Slides, in the sidebar: describe a presentation — or pick a document the
 * Research module wrote — and get slides you edit, present and save as a
 * PowerPoint file or a PDF.
 *
 * The same shape as Video (VideoPanel.tsx), on purpose: a request box whose
 * words switch things on and say so, the same model and intelligence
 * controls, runs that live outside React so they survive the sidebar being
 * closed, and a full window for the work that does not fit in a column.
 *
 * ## The model writes words, never code
 *
 * What comes back is slides in JSON, read and repaired by slides.ts and drawn
 * by the app (SlideView.tsx, slidespptx.ts). Nothing the model wrote is run,
 * and nothing it wrote reaches a file except through Save, at a path the
 * person chose in the save panel. That is SAFETY.md's rule, kept here.
 */

interface Props {
  t: (s: string) => string;
  /** The interface language: the deck's language when a request has no letters to tell it by. */
  lang: Lang;
  /** Where requests go — App's `wired` route, the same one the composer sends to. */
  gw: Target;
  efforts: EffortBook;
  providers: readonly Provider[];
  choice: Chosen;
  gateway: { baseUrl: string; apiKey: string };
  plan: PlanSummary | null;
  onProviders: () => void;
  onError: (message: string) => void;
}

type T = (s: string) => string;

// ── runs, outside React ───────────────────────────────────────────────────

type Work = { how: 'plan' } | { how: 'slide'; id: string; instruction: string };

interface Job {
  ctl: AbortController;
  how: Work['how'];
  started: number;
  /** Characters of the model's answer so far, so a long wait visibly moves. */
  chars: number;
  /** The slide being written again. */
  slideId?: string;
  retry?: { attempt: number; of: number };
}

const jobs = new Map<string, Job>();
/** The newest copy of every deck this session has seen, by id. */
const known = new Map<string, Deck>();
const watchers = new Set<() => void>();
let loaded = false;
let unkept = false;
/** Decks deleted this session, which a run still unwinding must not put back. */
const gone = new Set<string>();

function notify() {
  for (const w of watchers) w();
}

let queued = false;
function notifySoon() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; notify(); });
}

function keep(d: Deck) {
  if (gone.has(d.id)) return;
  known.set(d.id, d);
  void saveDeck(d).then((ok) => { if (!ok && !unkept) { unkept = true; notify(); } });
  notify();
}

/** Change the newest copy of a deck, whoever holds an older one. */
function update(id: string, change: (d: Deck) => Deck) {
  const d = known.get(id);
  if (d) keep({ ...change(d), updated: Date.now() });
}

/**
 * A change the person made, by hand or through the Chat tab: kept, and
 * remembered for undo (slideshistory.ts). A run's own changes — the slides
 * written, one slide rewritten — go through `update` and are not; the history
 * notices them and starts again from what they left. `alone` makes the change
 * its own step, never joined to typing: a whole chat message is one undo.
 */
function edit(id: string, next: Partial<Deck>, alone = false) {
  const before = known.get(id);
  if (!before) return;
  update(id, (d) => ({ ...d, ...next }));
  const after = known.get(id);
  if (after && after !== before) deckHistory.record(id, before, after, alone);
}

/** One step back or forward, when no run is changing the deck. */
function stepHistory(id: string, back: boolean) {
  const d = known.get(id);
  if (!d || jobs.has(id)) return;
  const snap = back ? deckHistory.undo(id, d) : deckHistory.redo(id, d);
  if (snap) update(id, (x) => ({ ...x, ...snap }));
}

const UNDO_GLYPH = 'M9.5 6.5 5 11l4.5 4.5M5.5 11H15a4.5 4.5 0 0 1 0 9h-3';
const REDO_GLYPH = 'M14.5 6.5 19 11l-4.5 4.5M18.5 11H9a4.5 4.5 0 0 0 0 9h3';

function Glyph({ d }: { d: string }) {
  return (
    <svg className="ic" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

const newId = () => {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** Said by the run as codes, so the sentence is chosen where `t` is. */
const UNREADABLE_PLAN = 'slides:unreadable-plan';
const UNREADABLE_SLIDE = 'slides:unreadable-slide';

function start(deck: Deck, gw: Target, efforts: EffortBook, work: Work, say: (e: unknown) => string, report: (m: string) => void) {
  if (jobs.has(deck.id)) return;
  const ctl = new AbortController();
  const job: Job = { ctl, how: work.how, started: Date.now(), chars: 0, ...(work.how === 'slide' ? { slideId: work.id } : {}) };
  jobs.set(deck.id, job);
  const id = deck.id;
  const call = (system: string, user: string, maxTokens: number) => generate(gw, {
    system, user, maxTokens, efforts, signal: ctl.signal,
    onText: (d) => { job.chars += d.length; job.retry = undefined; notifySoon(); },
    onRestart: () => { job.chars = 0; },
    onRetry: (attempt, of) => { job.retry = { attempt, of }; notifySoon(); },
  });

  const going = (async () => {
    if (work.how === 'plan') {
      update(id, (x) => ({ ...x, stage: 'planning', error: undefined, model: gw.model }));
      const cur = known.get(id) ?? deck;
      const p = planPrompt(cur);
      // Twenty slides with their notes, in Arabic script, is most of this.
      const out = await call(p.system, p.user, 16000);
      const now = known.get(id) ?? cur;
      const plan = parsePlan(out.text, now, newId);
      if (!plan) throw new Error(UNREADABLE_PLAN);
      keep({ ...now, title: now.title || plan.title, slides: plan.slides, stage: 'ready', updated: Date.now() });
    } else {
      const cur = known.get(id);
      const index = cur ? cur.slides.findIndex((s) => s.id === work.id) : -1;
      if (!cur || index < 0) return;
      const old = cur.slides[index];
      const p = slidePrompt(cur, index, work.instruction);
      const out = await call(p.system, p.user, 3000);
      const next = parseSlide(out.text, old, known.get(id) ?? cur, newId);
      if (!next) throw new Error(UNREADABLE_SLIDE);
      update(id, (x) => ({ ...x, slides: x.slides.map((s) => (s.id === old.id ? next : s)) }));
    }
  })();

  going
    .catch((e: unknown) => {
      if ((e as { name?: string })?.name === 'AbortError' || ctl.signal.aborted) return;
      const m = say(e);
      // Slides that could not be made are said on the deck, where they are
      // looked for; one slide is said where the person is.
      if (work.how === 'plan' && !known.get(id)?.slides.length) update(id, (x) => ({ ...x, error: m }));
      else report(m);
    })
    .finally(() => {
      jobs.delete(id);
      // Never left "planning" in storage: a restart would show a run that is not there.
      const cur = known.get(id);
      if (cur && cur.stage === 'planning') keep({ ...cur, stage: cur.slides.length ? 'ready' : 'new', updated: Date.now() });
      else notify();
    });
}

function stop(id: string) {
  jobs.get(id)?.ctl.abort();
}

// ── the full window ───────────────────────────────────────────────────────

let full = false;
let fullError: string | null = null;

/** Open the Slides workspace over the whole window, or close it. */
export function toggleSlidesFull(on = !full) {
  full = on;
  fullError = null;
  notify();
}

/** The request form as it was left, kept across the moves between the sidebar and the full window. */
interface Draft {
  request: string;
  kind: DeckKind | null;
  count: number | null;
  theme: Theme | null;
  lang: DeckLang | null;
  set: Partial<Pick<Deck, 'choice' | 'effort'>>;
  more: boolean;
  /** Start from words, or from a Research document. */
  from: 'words' | 'doc';
  docId: string | null;
}

const draft: Draft = { request: '', kind: null, count: null, theme: null, lang: null, set: {}, more: false, from: 'words', docId: null };

function useDraft<K extends keyof Draft>(k: K): [Draft[K], (v: Draft[K]) => void] {
  const [v, setV] = useState<Draft[K]>(draft[k]);
  return [v, (next) => { draft[k] = next; setV(next); }];
}

// ── the cover, kept for the next deck ─────────────────────────────────────

/** Who presents, who supervised, where, and the logo: the same on the next deck, so kept. */
interface Cover { meta: DeckMeta; logo?: string; logoRatio?: number }

const COVER_KEY = 'vylo.slides.cover.v1';

/**
 * The cover as it was last filled in; failing that, what the Research
 * module's profile and logo library hold — a student who wrote their thesis
 * there has already told the app their name, their supervisor and their
 * university.
 */
function readCover(): Cover {
  const empty: DeckMeta = { presenter: '', supervisor: '', university: '', college: '', date: '' };
  const str = (x: unknown) => (typeof x === 'string' ? x.slice(0, 200) : '');
  try {
    const v = JSON.parse(localStorage.getItem(COVER_KEY) ?? 'null');
    if (v && typeof v === 'object' && v.meta && typeof v.meta === 'object') {
      return {
        meta: { presenter: str(v.meta.presenter), supervisor: str(v.meta.supervisor), university: str(v.meta.university), college: str(v.meta.college), date: str(v.meta.date) },
        ...(typeof v.logo === 'string' && /^data:image\/(png|jpeg);base64,/.test(v.logo) ? { logo: v.logo } : {}),
        ...(typeof v.logoRatio === 'number' && v.logoRatio > 0 ? { logoRatio: v.logoRatio } : {}),
      };
    }
  } catch { /* not ours, or not JSON: start from the profile */ }
  try {
    const p = readProfile(localStorage.getItem(PROFILE_KEY));
    const logo = p.university ? logoFor(readLogos(localStorage.getItem(LOGO_KEY), p.university), p.university) : '';
    return {
      meta: { ...empty, presenter: p.author, supervisor: p.supervisor, university: p.university, college: p.college },
      ...(logo ? { logo } : {}),
    };
  } catch {
    return { meta: empty };
  }
}

/** A picture's width over its height, or undefined when it cannot be read. */
function ratioOf(src: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : undefined);
    img.onerror = () => resolve(undefined);
    img.src = src;
  });
}

const MAX_LOGO_BYTES = 400_000;

function pickLogo(onPicked: (url: string) => void, onTooBig: () => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg';
  input.onchange = () => {
    const f = input.files?.[0];
    if (!f) return;
    if (f.size > MAX_LOGO_BYTES || !/^image\/(png|jpeg)$/.test(f.type)) { onTooBig(); return; }
    const r = new FileReader();
    r.onload = () => { if (typeof r.result === 'string') onPicked(r.result); };
    r.readAsDataURL(f);
  };
  input.click();
}

// ── routes: the model a deck is written with ──────────────────────────────

interface Routes {
  providers: readonly Provider[];
  gateway: { baseUrl: string; apiKey: string };
  fallback: Target;
  choice: Chosen;
}

/**
 * A deck's own choice, while the provider it names is still there at the
 * address it was chosen at; otherwise none, and the deck follows the composer
 * — VideoPanel's rule, for its reason: a removed provider's id is the next
 * one's, and following it would send the request to a host nobody chose.
 */
function choiceOf(d: Partial<Pick<Deck, 'choice'>>, r: Routes): Deck['choice'] | undefined {
  const c = d.choice;
  if (!c || c.provider === BUILT_IN) return c;
  const p = r.providers.find((x) => x.id === c.provider);
  return p && (!c.at || c.at === p.baseUrl) ? c : undefined;
}

function targetOf(d: Partial<Pick<Deck, 'choice'>>, r: Routes): Target {
  const c = choiceOf(d, r);
  if (!c) return r.fallback;
  const x = routeOf(c, r.providers, { ...r.gateway, model: r.fallback.model });
  return { baseUrl: x.baseUrl, apiKey: x.key, wire: x.wire, model: x.model };
}

function bookFor(d: Partial<Pick<Deck, 'effort'>>, target: Target, book: EffortBook): EffortBook {
  return d.effort ? { ...book, [target.model]: d.effort } : book;
}

interface MenuItem { provider: string; model: string; label: string; at?: string }

function menuOf(providers: readonly Provider[]): MenuItem[] {
  return [
    ...MODELS.map((m) => ({ provider: BUILT_IN, model: m.id, label: m.short })),
    ...providers.flatMap((p) => p.models.map((pm) => ({ provider: p.id, model: pm, label: `${pm} · ${p.name}`, at: p.baseUrl }))),
  ];
}

function useWatch() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const w = () => setTick((n) => n + 1);
    watchers.add(w);
    return () => { watchers.delete(w); };
  }, []);
}

function useTick(on: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const i = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(i);
  }, [on]);
}

// ── names ─────────────────────────────────────────────────────────────────

function errorText(e: string, t: T): string {
  if (e === UNREADABLE_PLAN) return t('The slides could not be read from the model’s reply. Try again, or try another model.');
  if (e === UNREADABLE_SLIDE) return t('The new slide could not be read from the model’s reply. Try again, or say it differently.');
  return e;
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

const whenOf = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** What the model is doing before its first words arrive; a line that changes says it is working. */
function thinkingVerb(ms: number, t: T): string {
  const n = Math.floor(ms / 4000) % 3;
  if (n === 1) return t('Planning the slides');
  if (n === 2) return t('Choosing a layout for each one');
  return t('Reading your request');
}

// ── small pieces ──────────────────────────────────────────────────────────

/** The model, and how hard it thinks — the composer's menu, as Research and Video offer it. */
function ModelSettings({ t, value, onChange, routes, efforts, plan, disabled }: {
  t: T;
  value: Partial<Pick<Deck, 'choice' | 'effort'>>;
  onChange: (next: Partial<Pick<Deck, 'choice' | 'effort'>>) => void;
  routes: Routes;
  efforts: EffortBook;
  plan: PlanSummary | null;
  disabled?: boolean;
}) {
  const menu = useMemo(() => menuOf(routes.providers), [routes.providers]);
  const chosen = choiceOf(value, routes) ?? routes.choice;
  const at = menu.findIndex((m) => m.provider === chosen.provider && m.model === chosen.model);
  const target = targetOf(value, routes);
  const levels = target.wire === 'anthropic' ? effortsFor(target.model) : [];
  const level = effortOf(bookFor(value, target, efforts), target.model);
  return (
    <div className="vid-form">
      <label className="vid-f vid-wide">
        <span>{t('Model')}</span>
        <select value={at >= 0 ? String(at) : 'x'} disabled={disabled}
                onChange={(e) => {
                  const m = menu[Number(e.target.value)];
                  if (m) onChange({ choice: { provider: m.provider, model: m.model, ...(m.at ? { at: m.at } : {}) }, effort: undefined });
                }}>
          {menu.map((m, i) => {
            const ok = m.provider !== BUILT_IN || allows(plan, m.model);
            return <option key={`${m.provider}/${m.model}`} value={String(i)} disabled={!ok}>{ok ? m.label : `${m.label} — ${t('not on your plan')}`}</option>;
          })}
          {at < 0 && <option value="x">{chosen.model}</option>}
        </select>
      </label>
      {levels.length > 0 && (
        <label className="vid-f vid-wide" title={t('How hard the model thinks before answering. Higher is slower and uses more of your plan’s tokens.')}>
          <span>{t('Intelligence')}</span>
          <span className="vid-seg" role="radiogroup" aria-label={t('Intelligence')}>
            {EFFORTS.filter((l) => levels.includes(l)).map((l) => (
              <button key={l} type="button" role="radio" aria-checked={level === l} disabled={disabled}
                      className={level === l ? 'on' : ''} onClick={() => onChange({ effort: l as Effort })}>
                {effortLabel(l, t)}
              </button>
            ))}
          </span>
        </label>
      )}
    </div>
  );
}

function KindPicker({ t, value, onChange, disabled }: { t: T; value: DeckKind; onChange: (k: DeckKind) => void; disabled?: boolean }) {
  return (
    <div className="sl-kinds" role="radiogroup" aria-label={t('What it is for')}>
      {DECK_KINDS.map((k) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} disabled={disabled}
                className={value === k ? 'on' : ''} onClick={() => onChange(k)} title={kindAbout(k, t)}>
          <b>{kindName(k, t)}</b>
          <small>{kindAbout(k, t)}</small>
        </button>
      ))}
    </div>
  );
}

function CountPicker({ t, value, onChange, disabled }: { t: T; value: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <div className="vid-seg" role="radiogroup" aria-label={t('Number of slides')}>
      {COUNTS.map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} disabled={disabled}
                className={value === n ? 'on' : ''} onClick={() => onChange(n)}>
          {fill(t('{n} slides'), { n })}
        </button>
      ))}
      {!COUNTS.includes(value) && (
        <button type="button" role="radio" aria-checked className="on" disabled={disabled}>{fill(t('{n} slides'), { n: value })}</button>
      )}
    </div>
  );
}

/** The looks as swatches: the band and its accent are most of what a look is. */
function ThemePicker({ t, value, onChange, disabled }: { t: T; value: Theme; onChange: (th: Theme) => void; disabled?: boolean }) {
  return (
    <div className="vid-styles" role="radiogroup" aria-label={t('Look')}>
      {THEMES.map((th) => {
        const p = PALETTES[th];
        return (
          <button key={th} type="button" role="radio" aria-checked={value === th} disabled={disabled}
                  className={value === th ? 'on' : ''} onClick={() => onChange(th)}>
            <span className="vid-swatch" style={{ background: p.band, color: p.onBand }} aria-hidden="true">
              Aa<i style={{ background: p.accent }} />
            </span>
            <span>{themeName(th, t)}</span>
          </button>
        );
      })}
    </div>
  );
}

function LangPicker({ t, value, onChange, disabled }: { t: T; value: DeckLang; onChange: (l: DeckLang) => void; disabled?: boolean }) {
  return (
    <div className="vid-seg vid-langs" role="radiogroup" aria-label={t('Language of the slides')}>
      {(['ar', 'ckb', 'kmr', 'en'] as const).map((l) => (
        <button key={l} type="button" role="radio" aria-checked={value === l} disabled={disabled}
                className={value === l ? 'on' : ''} onClick={() => onChange(l)} lang={l}>
          {langName(l, t)}
        </button>
      ))}
    </div>
  );
}

/** Who presents, who supervised, where and when, and the logo: the title slide's words and picture. */
function CoverFields({ t, value, onChange, disabled }: { t: T; value: Cover; onChange: (c: Cover) => void; disabled?: boolean }) {
  const [bad, setBad] = useState(false);
  const field = (label: string, key: keyof DeckMeta, placeholder?: string) => (
    <label className="vid-f vid-wide">
      <span>{label}</span>
      <input value={value.meta[key]} dir="auto" disabled={disabled} placeholder={placeholder}
             onChange={(e) => onChange({ ...value, meta: { ...value.meta, [key]: e.target.value } })} />
    </label>
  );
  return (
    <div className="vid-form">
      {field(t('Presented by'), 'presenter')}
      {field(t('Supervised by'), 'supervisor')}
      {field(t('University'), 'university')}
      {field(t('College or department'), 'college')}
      {field(t('Date'), 'date', '2026')}
      <div className="vid-logo vid-wide">
        {value.logo ? <img src={value.logo} alt="" /> : <span className="vid-pic-none"><Icon name="image" size={16} /></span>}
        <span className="vid-pic-what">
          <b>{t('Logo')}</b>
          <span>{t('On the title slide, the closing slide and the corner of the others.')}</span>
        </span>
        <button type="button" className="ghost" disabled={disabled}
                onClick={() => pickLogo((logo) => { setBad(false); void ratioOf(logo).then((logoRatio) => onChange({ ...value, logo, logoRatio })); }, () => setBad(true))}>
          {value.logo ? t('Change the logo') : t('Add a logo')}
        </button>
        {value.logo && <button type="button" className="ghost" disabled={disabled} onClick={() => onChange({ ...value, logo: undefined, logoRatio: undefined })}>{t('Remove')}</button>}
      </div>
      {bad && <p className="vid-bad vid-wide">{t('Use a PNG or JPEG picture under 400 KB.')}</p>}
    </div>
  );
}

/** The brand's colours over the look's, with the logo's own offered. */
function BrandColours({ t, deck, onChange, disabled }: { t: T; deck: Deck; onChange: (next: Partial<Deck>) => void; disabled?: boolean }) {
  const p = PALETTES[deck.theme] ?? PALETTES.academic;
  const brand = deck.brand ?? {};
  const [swatches, setSwatches] = useState<Swatch[] | null>(null);
  useEffect(() => {
    if (!deck.logo) { setSwatches(null); return; }
    let live = true;
    paletteOfImage(deck.logo).then((x) => { if (live) setSwatches(x); }, () => { if (live) setSwatches(null); });
    return () => { live = false; };
  }, [deck.logo]);
  // Colours for the band behind the titles: read against white, which is what sits on it.
  const offer = swatches ? brandFromLogo(swatches, '#FFFFFF') : null;
  const inUse = !!offer && brand.primary?.toUpperCase() === offer.primary && brand.accent?.toUpperCase() === offer.accent;
  const colour = (label: string, key: 'primary' | 'accent', fallback: string) => (
    <div className="vid-colour">
      <label>
        <input type="color" value={brand[key] ?? fallback} disabled={disabled}
               onChange={(e) => onChange({ brand: { ...brand, [key]: e.target.value } })} />
        <span>{label}</span>
      </label>
      {brand[key]
        ? <button type="button" className="sb-act" disabled={disabled} onClick={() => onChange({ brand: { ...brand, [key]: undefined } })}
                  title={t('Use the look’s colour')} aria-label={t('Use the look’s colour')}><Icon name="close" size={11} /></button>
        : <small>{t('the look’s')}</small>}
    </div>
  );
  return (
    <div className="vid-form">
      {colour(t('Main colour'), 'primary', p.band)}
      {colour(t('Accent colour'), 'accent', p.accent)}
      {offer && (
        <div className="vid-tpl-palette vid-wide">
          <span className="vid-tpl-dots" aria-hidden="true">
            <i style={{ background: offer.primary }} title={offer.primary} />
            {offer.accent && <i style={{ background: offer.accent }} title={offer.accent} />}
          </span>
          <span className="vid-tpl-palette-what"><b>{t('Colours from the logo')}</b></span>
          {inUse
            ? <small className="vid-tpl-inuse"><Icon name="check" size={11} />{t('In use')}</small>
            : (
              <button type="button" className="ghost" disabled={disabled}
                      onClick={() => onChange({ brand: { primary: offer.primary, accent: offer.accent } })}>
                {t('Use the logo’s colours')}
              </button>
            )}
        </div>
      )}
    </div>
  );
}

/** Where a run is: a bar, a clock, and a sentence. */
function JobStatus({ t, deck, job }: { t: T; deck: Deck; job: Job }) {
  useTick(true);
  const elapsed = Date.now() - job.started;
  const line = job.how === 'slide'
    ? fill(t('Writing slide {n} again…'), { n: deck.slides.findIndex((s) => s.id === job.slideId) + 1 })
    : job.chars ? t('Writing the slides…') : `${thinkingVerb(elapsed, t)}…`;
  return (
    <div className="vid-status" role="status">
      <p className="vid-status-line">
        <span className="vid-glyph" aria-hidden="true">✻</span>
        <b>{line}</b>
      </p>
      <div className="vid-bar is-early" role="progressbar" aria-label={t('Progress')}><i /></div>
      <p className="vid-clock">
        <span>{fill(t('Running for {time}'), { time: clock(elapsed) })}</span>
        {job.chars > 0 && <span>{fill(t('{n} characters'), { n: job.chars.toLocaleString() })}</span>}
        {job.retry && <span>{fill(t('Trying again ({n} of {of})…'), { n: job.retry.attempt, of: job.retry.of })}</span>}
      </p>
    </div>
  );
}

// ── the panel ─────────────────────────────────────────────────────────────

export function SlidesPanel({ t, lang, gw, efforts, plan, providers, choice, gateway, onProviders, onError }: Props) {
  useWatch();
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [presenting, setPresenting] = useState<{ id: string; at: number } | null>(null);
  const [printing, setPrinting] = useState<string | null>(null);
  const fullBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loaded) return;
    loaded = true;
    void loadDecks().then((list) => {
      for (const d of list) {
        if (known.has(d.id)) continue;
        // A run the app was closed in the middle of is not running now.
        known.set(d.id, d.stage === 'planning' ? { ...d, stage: d.slides.length ? 'ready' : 'new' } : d);
      }
      notify();
    });
  }, []);

  // The full window is a window: it takes the focus, keeps Tab inside, gives
  // the focus back when it closes, and Escape leaves it — a field first.
  const isFull = full;
  useEffect(() => {
    if (!isFull) return;
    const from = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    fullBox.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const box = fullBox.current;
      const act = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (e.key === 'Escape' && !e.defaultPrevented) {
        if (act && box?.contains(act) && (act.matches('textarea, select, input:not([type="checkbox"]):not([type="radio"])') || act.isContentEditable)) { act.blur(); box.focus(); return; }
        toggleSlidesFull(false);
        return;
      }
      if (e.key !== 'Tab' || !box) return;
      if (act && !box.contains(act) && act.closest('[role="dialog"], [role="alertdialog"]')) return;
      const all = [...box.querySelectorAll<HTMLElement>('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])')]
        .filter((x) => !x.matches(':disabled') && x.getClientRects().length > 0);
      if (!all.length) return;
      const first = all[0];
      const last = all[all.length - 1];
      if (!act || !box.contains(act) || act === box) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && act === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && act === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (from?.isConnected) from.focus();
    };
  }, [isFull]);

  // The printed sheets are in the page only while a PDF is being made of them.
  useEffect(() => {
    if (!printing) return;
    document.documentElement.classList.add('sl-printing');
    return () => document.documentElement.classList.remove('sl-printing');
  }, [printing]);

  const routes: Routes = useMemo(() => ({ providers, gateway, fallback: gw, choice }), [providers, gateway, gw, choice]);
  const decks = [...known.values()].sort((a, b) => b.created - a.created);
  const open = openId ? known.get(openId) ?? null : null;
  const current = open ? open.slides.find((s) => s.id === selected) ?? open.slides[0] ?? null : null;

  const report = (m: string) => {
    if (full) { fullError = m; notify(); } else onError(m);
  };
  const begin = (d: Deck, work: Work) => {
    const target = targetOf(d, routes);
    const doing = work.how === 'plan' ? t('write the slides') : t('write the slide again');
    start(d, target, bookFor(d, target, efforts), work, (e) => explain(e, doing), report);
  };

  /**
   * Print the deck to `path`: its sheets go into the page, the webview prints
   * them — one slide to a page the shape of a slide — and they come out again.
   */
  const pdfDeck = async (d: Deck, path: string) => {
    setPrinting(d.id);
    try {
      // Drawn, fonts loaded, the logo decoded: then printed.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await document.fonts?.ready;
      await Promise.all([...document.querySelectorAll<HTMLImageElement>('#sl-print img')].map((img) => img.decode().catch(() => undefined)));
      await invoke('save_pdf', { path, page: 'slides' });
    } finally {
      setPrinting(null);
    }
  };

  const target = targetOf(open ?? draft.set, routes);
  const ready = armed({ baseUrl: target.baseUrl, key: target.apiKey });
  const printed = printing ? known.get(printing) : undefined;
  const shown = presenting ? known.get(presenting.id) : undefined;

  const body = (
    <div className="vid sl">
      {!ready && (
        <div className="sb-cta">
          <p className="ft-empty">{t('Add an API key in Settings first.')}</p>
          <button className="ghost bordered" onClick={onProviders}>
            <Icon name="settings" size={13} />
            <span className="cta-label">{t('Open Settings')}</span>
          </button>
        </div>
      )}
      {unkept && <p className="vid-warn">{t('Presentations cannot be kept on this machine right now. Save them before you close the app.')}</p>}
      {open
        ? <DeckView key={open.id} t={t} lang={lang} deck={open} current={current} routes={routes} efforts={efforts} plan={plan} ready={ready} inFull={full}
                    onSelect={setSelected} onBack={() => setOpenId(null)} begin={begin} onError={report} onSettings={onProviders}
                    onPresent={(at) => setPresenting({ id: open.id, at })} onPdf={(path) => pdfDeck(open, path)} />
        : <Home t={t} lang={lang} routes={routes} efforts={efforts} plan={plan} ready={ready} decks={decks}
                onOpen={(id) => { setSelected(null); setOpenId(id); }}
                onStart={(d) => { keep(d); setSelected(null); setOpenId(d.id); begin(d, { how: 'plan' }); }} />}
    </div>
  );

  const extras = (
    <>
      {shown && presenting && <Presenter t={t} deck={shown} at={presenting.at} onClose={() => setPresenting(null)} />}
      {printed && createPortal(
        <div id="sl-print" aria-hidden="true">
          {printed.slides.map((s, i) => <div key={s.id} className="sl-sheet"><SlideCanvas deck={printed} slide={s} index={i} /></div>)}
        </div>,
        document.body,
      )}
    </>
  );

  if (full) {
    return (
      <>
        <div className="sb-cta vid-away">
          <p className="ft-empty">{t('Slides is open over the whole window.')}</p>
          <button className="ghost bordered" onClick={() => toggleSlidesFull(false)}>
            <Icon name="restore" size={13} />
            <span className="cta-label">{t('Back to the sidebar')}</span>
          </button>
        </div>
        {createPortal(
          <div className="vid-full" role="dialog" aria-modal="true" aria-label={t('Slides')} ref={fullBox} tabIndex={-1}>
            <header className="vid-full-head" data-tauri-drag-region>
              <Icon name="slides" size={16} />
              <b>{t('Slides')}</b>
              {open && <span dir="auto">{open.title || open.request}</span>}
              <button className="sb-act" onClick={() => toggleSlidesFull(false)}
                      title={t('Back to the sidebar')} aria-label={t('Back to the sidebar')}>
                <Icon name="restore" size={14} />
              </button>
            </header>
            {fullError && (
              <p className="vid-full-error" role="alert">
                <span dir="auto">{fullError}</span>
                <button className="sb-act" onClick={() => { fullError = null; notify(); }} title={t('Close')} aria-label={t('Close')}>
                  <Icon name="close" size={12} />
                </button>
              </p>
            )}
            <div className="vid-full-main">
              <aside className="vid-full-side">{body}</aside>
              <main className="vid-full-stage sl-stage">
                {open && current
                  ? <Stage t={t} deck={open} current={current} onSelect={setSelected} />
                  : <FullWelcome t={t} decks={decks} onOpen={(id) => { setSelected(null); setOpenId(id); }} />}
              </main>
            </div>
          </div>,
          document.body,
        )}
        {extras}
      </>
    );
  }
  return <>{body}{extras}</>;
}

/** Focus the editor's field for a part of the slide that was clicked in the preview. */
function focusField(field: string) {
  const el = document.querySelector<HTMLElement>(`[data-edit="${field}"]`);
  el?.focus();
  el?.scrollIntoView({ block: 'nearest' });
}

// ── the full window's large side ──────────────────────────────────────────

/** The slide being edited, large, and every slide under it to jump to. */
function Stage({ t, deck, current, onSelect }: { t: T; deck: Deck; current: Slide; onSelect: (id: string) => void }) {
  const at = deck.slides.findIndex((s) => s.id === current.id);
  return (
    <div className="sl-stage-in">
      <SlideView deck={deck} slide={current} index={at} className="sl-big" onField={focusField} />
      <Strip t={t} deck={deck} current={current.id} onSelect={onSelect} grid />
    </div>
  );
}

function FullWelcome({ t, decks, onOpen }: { t: T; decks: Deck[]; onOpen: (id: string) => void }) {
  return (
    <div className="vid-welcome">
      <h2>{t('Describe a presentation')}</h2>
      <p>{t('Say what it is for, how many slides, and in which language — or start from a document you wrote in Research. You edit every word, present it here, and save it as PowerPoint or PDF.')}</p>
      {decks.length > 0 && (
        <>
          <h3>{t('Your presentations')}</h3>
          <ul className="vid-list">{decks.map((d) => <DeckRow key={d.id} t={t} deck={d} onOpen={() => onOpen(d.id)} />)}</ul>
        </>
      )}
    </div>
  );
}

// ── asking for a deck ─────────────────────────────────────────────────────

function Home({ t, lang, routes, efforts, plan, ready, decks, onOpen, onStart }: {
  t: T;
  lang: Lang;
  routes: Routes;
  efforts: EffortBook;
  plan: PlanSummary | null;
  ready: boolean;
  decks: Deck[];
  onOpen: (id: string) => void;
  onStart: (d: Deck) => void;
}) {
  const [request, setRequest] = useDraft('request');
  const [kindSet, setKindSet] = useDraft('kind');
  const [countSet, setCountSet] = useDraft('count');
  const [themeSet, setThemeSet] = useDraft('theme');
  const [langSet, setLangSet] = useDraft('lang');
  const [set, putSet] = useDraft('set');
  const [more, setMore] = useDraft('more');
  const [from, setFrom] = useDraft('from');
  const [docId, setDocId] = useDraft('docId');
  const [cover, setCoverNow] = useState<Cover>(readCover);
  const [coverUnkept, setCoverUnkept] = useState(false);
  const [docs, setDocs] = useState<Doc[] | null>(null);

  useEffect(() => {
    if (from !== 'doc' || docs) return;
    let live = true;
    void loadDocs().then((list) => { if (live) setDocs(list.filter((d) => d.sections.some((s) => s.text.trim()))); });
    return () => { live = false; };
  }, [from, docs]);

  const doc = from === 'doc' && docId ? docs?.find((d) => d.id === docId) ?? null : null;
  // What the document gives a deck, worked out once per document rather than on every keystroke.
  const fromDoc = useMemo(() => (doc ? fromResearch(doc) : null), [doc]);
  const found = useMemo(() => ({ kind: kindIn(request), count: countIn(request), theme: themeIn(request) }), [request]);
  const kind: DeckKind = kindSet ?? (fromDoc ? fromDoc.kind : found.kind) ?? 'general';
  const count: number = countSet ?? (from === 'words' ? found.count : null) ?? countFor(kind);
  const theme: Theme = themeSet ?? (from === 'words' ? found.theme : null) ?? (kind === 'defense' || kind === 'conference' ? 'academic' : 'modern');
  const dlang: DeckLang = langSet ?? (doc ? doc.lang : deckLangOf(request, lang));
  const target = targetOf(set, routes);
  const book = bookFor(set, target, efforts);
  const chosen = choiceOf(set, routes) ?? routes.choice;
  const onPlan = chosen.provider !== BUILT_IN || allows(plan, target.model);
  const level = target.wire === 'anthropic' && effortsFor(target.model).length ? effortOf(book, target.model) : null;
  const canGo = ready && onPlan && (from === 'doc' ? !!doc : !!request.trim());

  const setCover = (c: Cover) => {
    setCoverNow(c);
    try { localStorage.setItem(COVER_KEY, JSON.stringify(c)); setCoverUnkept(false); } catch { setCoverUnkept(true); }
  };

  const go = () => {
    if (!canGo) return;
    const base = { id: newId(), now: Date.now(), kind, theme, count, lang: dlang };
    let d: Deck;
    if (doc && fromDoc) {
      const r = fromDoc;
      // The document's own cover wins where it says something; the kept one fills the rest.
      const meta: DeckMeta = {
        presenter: r.meta.presenter || cover.meta.presenter, supervisor: r.meta.supervisor || cover.meta.supervisor,
        university: r.meta.university || cover.meta.university, college: r.meta.college || cover.meta.college, date: r.meta.date || cover.meta.date,
      };
      const logo = r.logo || cover.logo;
      d = {
        ...newDeck({ ...base, request: request.trim() ? `${r.request}\n\n${request.trim()}` : r.request, meta, logo, logoRatio: logo === cover.logo ? cover.logoRatio : undefined }),
        title: r.title, source: r.source, refs: r.refs, from: { id: doc.id, title: r.title }, ...(r.digits ? { digits: r.digits } : {}),
      };
    } else {
      d = newDeck({ ...base, request: request.trim(), meta: cover.meta, logo: cover.logo, logoRatio: cover.logoRatio });
    }
    const made = { ...d, ...set };
    onStart(made);
    // A logo from the document has not been measured yet.
    if (made.logo && !made.logoRatio) void ratioOf(made.logo).then((logoRatio) => { if (logoRatio) update(made.id, (x) => ({ ...x, logoRatio })); });
    setRequest('');
    setKindSet(null);
    setCountSet(null);
    setThemeSet(null);
    setLangSet(null);
    setDocId(null);
  };

  // What the words switched on, and what is only the default, side by side.
  const chip = (icon: 'grid' | 'list' | 'sparkle' | 'chat', label: string, by: 'you' | 'words' | 'default') => (
    <span className={`vid-chip ${by === 'default' ? '' : 'on'}`}
          title={by === 'you' ? t('Chosen by you') : by === 'words' ? t('Found in your request') : t('The default — say it, or choose below')}>
      <Icon name={by === 'default' ? icon : 'check'} size={11} />
      {label}
    </span>
  );
  const byOf = (setHere: unknown, fromWords: unknown) => (setHere !== null ? 'you' : fromWords !== null && from === 'words' ? 'words' : 'default');
  const langBy = langSet !== null ? 'you' : request.trim() || doc ? 'words' : 'default';

  const label = [
    (menuOf(routes.providers).find((m) => m.provider === chosen.provider && m.model === target.model)?.label) ?? modelName(target.model),
    level ? effortLabel(level, t) : '',
  ].filter(Boolean).join(' · ');

  return (
    <>
      <div className="vid-ask">
        <div className="vid-seg sl-from" role="radiogroup" aria-label={t('Start from')}>
          <button type="button" role="radio" aria-checked={from === 'words'} className={from === 'words' ? 'on' : ''} onClick={() => setFrom('words')}>
            <Icon name="pencil" size={12} />{t('Describe it')}
          </button>
          <button type="button" role="radio" aria-checked={from === 'doc'} className={from === 'doc' ? 'on' : ''} onClick={() => setFrom('doc')}>
            <Icon name="book" size={12} />{t('From a Research document')}
          </button>
        </div>

        {from === 'doc' && (
          <div className="vid-group">
            <span className="vid-group-label">{t('Your documents')}</span>
            {docs === null
              ? <p className="vid-note">{t('Opening…')}</p>
              : docs.length === 0
                ? <p className="vid-note">{t('No document has been written in Research yet. Write one there, or describe the presentation instead.')}</p>
                : (
                  <ul className="sl-docs" role="radiogroup" aria-label={t('Your documents')}>
                    {docs.map((d) => (
                      <li key={d.id}>
                        <button type="button" role="radio" aria-checked={docId === d.id} className={docId === d.id ? 'on' : ''} onClick={() => setDocId(d.id)}>
                          <Icon name={docId === d.id ? 'check' : 'book'} size={13} />
                          <span>
                            <b dir="auto">{d.meta?.title || d.request}</b>
                            <small>{fill(t('{n} parts written'), { n: d.sections.filter((s) => s.text.trim()).length })} · {langName(d.lang, t)}</small>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
            {doc && <p className="vid-note">{t('The slides present what the document says, with its own figures, and end with its own references. Nothing is added that it does not contain.')}</p>}
          </div>
        )}

        <label className="vid-ask-label" htmlFor="sl-request">{from === 'doc' ? t('Anything to add? (optional)') : t('What is the presentation about?')}</label>
        <textarea id="sl-request" className="vid-request" dir="auto" rows={from === 'doc' ? 2 : 4}
                  value={request} onChange={(e) => setRequest(e.target.value)}
                  placeholder={from === 'doc'
                    ? t('For example: focus on the results, and keep it to fifteen minutes')
                    : t('For example: a 12-slide lecture on photosynthesis for first-year students, in Sorani')}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); } }} />

        <div className="vid-chips" aria-label={t('What your request asks for')}>
          {chip('sparkle', kindName(kind, t), kindSet !== null ? 'you' : doc || found.kind !== null ? 'words' : 'default')}
          {chip('list', fill(t('{n} slides'), { n: count }), byOf(countSet, found.count))}
          {chip('grid', themeName(theme, t), byOf(themeSet, found.theme))}
          {chip('chat', langName(dlang, t), langBy)}
        </div>

        <div className="vid-group">
          <span className="vid-group-label">{t('What it is for')}</span>
          <KindPicker t={t} value={kind} onChange={setKindSet} />
        </div>
        <div className="vid-group">
          <span className="vid-group-label">{t('Number of slides')}</span>
          <CountPicker t={t} value={count} onChange={setCountSet} />
        </div>
        <div className="vid-group">
          <span className="vid-group-label">{t('Look')}</span>
          <ThemePicker t={t} value={theme} onChange={setThemeSet} />
        </div>
        <div className="vid-group">
          <span className="vid-group-label">{t('Language of the slides')}</span>
          <LangPicker t={t} value={dlang} onChange={setLangSet} />
        </div>

        <ModelSettings t={t} value={set} onChange={(v) => putSet({ ...draft.set, ...v })} routes={routes} efforts={efforts} plan={plan} />

        <button className="vid-more" onClick={() => setMore(!more)} aria-expanded={more}>
          <Icon name="chevron" size={11} />
          {cover.meta.presenter.trim() ? fill(t('Title slide: {name}'), { name: cover.meta.presenter.trim() }) : t('Title slide: names and logo')}
        </button>
        {more && <CoverFields t={t} value={cover} onChange={setCover} />}
        {more && coverUnkept && <p className="vid-bad">{t('The names and logo could not be kept on this machine. They go on this presentation only.')}</p>}

        {!onPlan && <p className="vid-warn vid-in">{fill(t('Your plan does not include {model}. Choose another model above.'), { model: modelName(target.model) })}</p>}
        <button className="sb-cta-go vid-go" disabled={!canGo} onClick={go}>
          <Icon name="slides" size={13} />
          {fill(t('Make it with {model}'), { model: label })}
        </button>
        <p className="vid-note">{t('The model writes the words and the speaker notes. The app lays out every slide; you check and change everything before you present it.')}</p>
      </div>

      {decks.length > 0 && (
        <>
          <div className="sb-sub">{t('Your presentations')}</div>
          <ul className="vid-list">{decks.map((d) => <DeckRow key={d.id} t={t} deck={d} onOpen={() => onOpen(d.id)} />)}</ul>
        </>
      )}
    </>
  );
}

function DeckRow({ t, deck, onOpen }: { t: T; deck: Deck; onOpen: () => void }) {
  const job = jobs.get(deck.id);
  return (
    <li>
      <button className="vid-row" onClick={onOpen}>
        <span className={`vid-dot ${job ? 'is-live' : deck.error ? 'is-bad' : deck.slides.length ? 'is-done' : ''}`} aria-hidden="true" />
        <span className="vid-row-what">
          <b dir="auto">{deck.title || deck.request}</b>
          <span>
            {kindName(deck.kind, t)}
            {' · '}
            {job ? t('Writing') : deck.slides.length ? fill(t('{n} slides'), { n: deck.slides.length }) : t('Not written')}
            {' · '}
            {whenOf(deck.created)}
          </span>
        </span>
      </button>
    </li>
  );
}

// ── one deck ──────────────────────────────────────────────────────────────

type Tab = 'slide' | 'chat' | 'deck';

/** The slides as small pictures to click through; a grid under the preview in the full window. */
function Strip({ t, deck, current, onSelect, grid }: { t: T; deck: Deck; current: string; onSelect: (id: string) => void; grid?: boolean }) {
  const width = grid ? 188 : 132;
  return (
    <ol className={`sl-strip ${grid ? 'is-grid' : ''}`} aria-label={t('Slides')}>
      {deck.slides.map((s, i) => (
        <li key={s.id}>
          <button type="button" className={`sl-thumb ${s.id === current ? 'on' : ''}`} aria-current={s.id === current}
                  onClick={() => onSelect(s.id)} title={`${i + 1}. ${slideKindName(s.kind, t)}`}>
            <SlideView deck={deck} slide={s} index={i} width={width} />
            <small>{i + 1}</small>
          </button>
        </li>
      ))}
    </ol>
  );
}

function DeckView({ t, lang, deck, current, routes, efforts, plan, ready, inFull, onSelect, onBack, begin, onError, onPresent, onPdf, onSettings }: {
  t: T;
  lang: Lang;
  deck: Deck;
  current: Slide | null;
  routes: Routes;
  efforts: EffortBook;
  plan: PlanSummary | null;
  ready: boolean;
  inFull: boolean;
  onSelect: (id: string) => void;
  onBack: () => void;
  begin: (d: Deck, work: Work) => void;
  onError: (m: string) => void;
  onPresent: (at: number) => void;
  onPdf: (path: string) => Promise<void>;
  onSettings: () => void;
}) {
  const [tab, setTab] = useState<Tab>('slide');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const job = jobs.get(deck.id);
  const busy = !!job;
  // Every change made here by hand is remembered for undo; a run's own changes are not (see `edit`).
  const change = (next: Partial<Deck>) => edit(deck.id, next);
  const at = current ? deck.slides.findIndex((s) => s.id === current.id) : -1;
  const target = targetOf(deck, routes);
  const level = effortOf(bookFor(deck, target, efforts), target.model);

  const setSlide = (id: string, patch: Partial<Slide>) => {
    const d = known.get(deck.id);
    if (d) edit(deck.id, { slides: d.slides.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  };
  const canUndo = !busy && deckHistory.canUndo(deck.id, deck);
  const canRedo = !busy && deckHistory.canRedo(deck.id, deck);
  // ⌘Z and ⇧⌘Z (Ctrl+Z, Ctrl+Y) anywhere in the deck's view but a field, which keeps its own undo.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = IS_MAC ? e.metaKey : e.ctrlKey;
    if (!mod || e.altKey) return;
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); stepHistory(deck.id, true); }
    else if ((k === 'z' && e.shiftKey) || (k === 'y' && !IS_MAC)) { e.preventDefault(); stepHistory(deck.id, false); }
  };
  const setSlides = (slides: Slide[]) => change({ slides });

  const remove = async () => {
    const yes = await ask.confirm({
      title: t('Delete this presentation?'),
      body: `${deck.title || deck.request}\n\n${t('Its slides are removed from this machine. A PowerPoint or PDF you saved is not touched.')}`,
      confirmLabel: t('Delete'),
      danger: true,
    });
    if (!yes) return;
    gone.add(deck.id);
    stop(deck.id);
    known.delete(deck.id);
    deckHistory.forget(deck.id);
    void deleteDeck(deck.id);
    notify();
    onBack();
  };

  const rewrite = async (s: Slide) => {
    const how = await ask.text({
      title: fill(t('Write slide {n} again'), { n: deck.slides.indexOf(s) + 1 }),
      value: '',
      placeholder: t('What should change? For example: shorter, with an example from Kurdistan'),
      confirmLabel: t('Write it again'),
      optional: true,
    });
    if (how === null) return;
    begin(deck, { how: 'slide', id: s.id, instruction: how.trim() });
  };

  const replan = async () => {
    if (deck.slides.length) {
      const yes = await ask.confirm({
        title: t('Write the slides again?'),
        body: t('The slides you have now, and your changes to them, are replaced by new ones.'),
        confirmLabel: t('Write them again'),
        danger: true,
      });
      if (!yes) return;
    }
    begin(deck, { how: 'plan' });
  };

  const add = (kind: SlideKind) => {
    const s = blankSlide(kind, deck, newId);
    const slides = [...deck.slides];
    // After the one selected, and before the closing slide, which should stay last.
    let i = at >= 0 ? at + 1 : slides.length;
    if (i >= slides.length && slides.length && slides[slides.length - 1].kind === 'end') i = slides.length - 1;
    slides.splice(i, 0, s);
    setSlides(slides);
    onSelect(s.id);
  };

  const savePptx = async () => {
    if (busy || saving) return;
    setSaving(true);
    setSaved('');
    try {
      const path = await savePanel({ title: t('Save as PowerPoint'), defaultPath: fileNameFor(deck, 'pptx'), filters: [{ name: 'PowerPoint', extensions: ['pptx'] }] });
      // Cancelling the save panel is an answer, not a failure.
      if (!path) return;
      await invoke('export_write_pptx', { path, data: pptxBase64(deck) });
      setSaved(path);
    } catch (e) {
      onError(explain(e, t('save the PowerPoint file')));
    } finally {
      setSaving(false);
    }
  };

  const savePdf = async () => {
    if (busy || saving) return;
    setSaving(true);
    setSaved('');
    try {
      const path = await savePanel({ title: t('Save as PDF'), defaultPath: fileNameFor(deck, 'pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (!path) return;
      await onPdf(path);
      setSaved(path);
    } catch (e) {
      onError(explain(e, t('save the PDF')));
    } finally {
      setSaving(false);
    }
  };

  return (
    // Focusable, so a click anywhere in the deck's view puts ⌘Z to work.
    <div className="vid-view sl-view" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="vid-top">
        <button className="sb-act vid-back" onClick={onBack} title={t('Back')} aria-label={t('Back')}>
          <Icon name="chevron" size={14} />
        </button>
        <div className="vid-title">
          <b dir="auto">{deck.title || deck.request}</b>
          <span>{kindName(deck.kind, t)} · {themeName(deck.theme, t)} · {langName(deck.lang, t)}{deck.slides.length ? ` · ${fill(t('{n} slides'), { n: deck.slides.length })}` : ''}</span>
        </div>
        {deck.slides.length > 0 && (
          <span className="sl-undo">
            <button type="button" className="sb-act" disabled={!canUndo} onClick={() => stepHistory(deck.id, true)}
                    title={`${t('Undo')} (${IS_MAC ? '⌘Z' : 'Ctrl+Z'})`} aria-label={t('Undo')}>
              <Glyph d={UNDO_GLYPH} />
            </button>
            <button type="button" className="sb-act" disabled={!canRedo} onClick={() => stepHistory(deck.id, false)}
                    title={`${t('Redo')} (${IS_MAC ? '⇧⌘Z' : 'Ctrl+Y'})`} aria-label={t('Redo')}>
              <Glyph d={REDO_GLYPH} />
            </button>
          </span>
        )}
        {!inFull && (
          <button className="sb-act" onClick={() => toggleSlidesFull(true)} title={t('Full screen')} aria-label={t('Full screen')}>
            <Icon name="maximise" size={14} />
          </button>
        )}
        <button className="sb-act" onClick={() => void remove()} title={t('Delete this presentation')} aria-label={t('Delete this presentation')}>
          <Icon name="close" size={14} />
        </button>
      </div>

      {job && <JobStatus t={t} deck={deck} job={job} />}
      {job && (
        <div className="vid-acts">
          <button className="ghost" onClick={() => stop(deck.id)}><Icon name="stop" size={12} />{t('Stop now')}</button>
        </div>
      )}
      {!job && deck.error && <p className="vid-bad vid-pad">{errorText(deck.error, t)}</p>}
      {!deck.slides.length && !job && (
        <div className="vid-acts">
          <button className="sb-cta-go" disabled={!ready} onClick={() => begin(deck, { how: 'plan' })}>
            <Icon name="play" size={12} />{deck.error ? t('Try again') : t('Write the slides')}
          </button>
        </div>
      )}

      {deck.slides.length > 0 && current && (
        <>
          {!inFull && <SlideView deck={deck} slide={current} index={at} className="sl-preview" onField={focusField} />}
          <div className="vid-acts sl-out">
            <button className="sb-cta-go" onClick={() => onPresent(Math.max(0, at))} disabled={busy}>
              <Icon name="play" size={12} />{t('Present')}
            </button>
            <button className="ghost" onClick={() => void savePptx()} disabled={busy || saving}>
              <Icon name="slides" size={12} />{t('Save as PowerPoint')}
            </button>
            <button className="ghost" onClick={() => void savePdf()} disabled={busy || saving}>
              <Icon name="file" size={12} />{t('Save as PDF')}
            </button>
          </div>
          {saved && (
            <p className="vid-note sl-saved">
              <Icon name="check" size={12} />
              <span dir="auto">{fill(t('Saved to {path}'), { path: saved })}</span>
              <button className="ghost" onClick={() => invoke('reveal_path', { path: saved }).catch((e: unknown) => onError(explain(e, t('show the file'))))}>
                {t('Show in folder')}
              </button>
            </p>
          )}
          {!inFull && <Strip t={t} deck={deck} current={current.id} onSelect={onSelect} />}

          <div className="vid-tabs" role="tablist">
            {(['slide', 'chat', 'deck'] as const).map((x) => (
              <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>
                {x === 'slide' ? fill(t('Slide {n}'), { n: at + 1 }) : x === 'chat' ? t('Chat') : t('Presentation')}
              </button>
            ))}
          </div>

          {tab === 'slide' && (
            <SlideEditor t={t} deck={deck} slide={current} index={at} locked={busy} ready={ready}
                         rewriting={job?.how === 'slide' && job.slideId === current.id}
                         onChange={(patch) => setSlide(current.id, patch)}
                         onSlides={setSlides} onSelect={onSelect} onRewrite={() => void rewrite(current)} onAdd={add} />
          )}
          {tab === 'chat' && (
            <SlidesChat t={t} lang={lang} deck={deck} locked={busy} ready={ready} target={target}
                        efforts={bookFor(deck, target, efforts)} providers={routes.providers}
                        onChange={(next) => edit(deck.id, next, true)} onSelect={onSelect} onPresent={onPresent}
                        onSavePptx={() => void savePptx()} onSavePdf={() => void savePdf()} saving={saving}
                        onSettings={onSettings} current={() => known.get(deck.id)} />
          )}
          {tab === 'deck' && (
            <div className="vid-look">
              <label className="vid-f vid-pad">
                <span>{t('Title of the presentation')}</span>
                <input value={deck.title} dir="auto" onChange={(e) => change({ title: e.target.value })} />
              </label>
              <div className="vid-group vid-pad">
                <span className="vid-group-label">{t('Look')}</span>
                <ThemePicker t={t} value={deck.theme} onChange={(theme) => change({ theme })} />
              </div>
              <div className="vid-group vid-pad">
                <span className="vid-group-label">{t('Colours')}</span>
                <BrandColours t={t} deck={deck} onChange={change} />
              </div>
              <div className="vid-group vid-pad">
                <span className="vid-group-label">{t('Title slide')}</span>
                <CoverFields t={t} value={{ meta: deck.meta, logo: deck.logo, logoRatio: deck.logoRatio }}
                             onChange={(c) => change({ meta: c.meta, logo: c.logo, logoRatio: c.logoRatio })} />
              </div>
              {isRtl(deck.lang) && (
                <label className="vid-check vid-pad">
                  <input type="checkbox" checked={deck.digits !== 'western'} onChange={(e) => change({ digits: e.target.checked ? 'eastern' : 'western' })} />
                  <span>{t('Write numbers as ١٢٣')}<small>{t('Off, they are written 123.')}</small></span>
                </label>
              )}
              <div className="vid-f vid-pad">
                <span>{t('What you asked for')}</span>
                <p className="vid-asked" dir="auto">{deck.from ? fill(t('Made from “{title}”'), { title: deck.from.title }) : deck.request}</p>
              </div>
              <div className="vid-pad">
                <ModelSettings t={t} value={deck} onChange={(v) => change(v)} routes={routes} efforts={efforts} plan={plan} disabled={busy} />
              </div>
              <div className="vid-acts">
                <button className="ghost" disabled={busy || !ready} onClick={() => void replan()}>
                  <Icon name="sparkle" size={12} />{t('Write the slides again…')}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <div className="vid-honest">
        <p><Icon name="warning" size={12} />{deck.from
          ? t('The words were written by an AI model from your document. Check every figure against it before you present.')
          : t('The words were written by an AI model. Read every line — and check every name, number and claim — before you present it.')}</p>
        {deck.model && (
          <p className="vid-model">
            {fill(t('Written with {model}.'), { model: modelName(deck.model) })}
            {level ? ` · ${effortLabel(level, t)}` : ''}
          </p>
        )}
      </div>
    </div>
  );
}

// ── editing one slide ─────────────────────────────────────────────────────

/** A list as lines: one point to a line, the way it reads on the slide. */
function LinesField({ label, value, onChange, disabled, edit, rows = 5 }: {
  label: string; value: string[]; onChange: (v: string[]) => void; disabled?: boolean; edit: string; rows?: number;
}) {
  return (
    <label className="vid-f vid-pad">
      <span>{label}</span>
      <textarea dir="auto" rows={rows} value={value.join('\n')} disabled={disabled} data-edit={edit}
                onChange={(e) => onChange(e.target.value.split('\n'))} />
    </label>
  );
}

function SlideEditor({ t, deck, slide, index, locked, ready, rewriting, onChange, onSlides, onSelect, onRewrite, onAdd }: {
  t: T;
  deck: Deck;
  slide: Slide;
  index: number;
  locked: boolean;
  ready: boolean;
  rewriting: boolean;
  onChange: (patch: Partial<Slide>) => void;
  onSlides: (slides: Slide[]) => void;
  onSelect: (id: string) => void;
  onRewrite: () => void;
  onAdd: (kind: SlideKind) => void;
}) {
  const k = slide.kind;
  const input = (label: string, key: 'title' | 'subtitle' | 'head' | 'head2', placeholder?: string) => (
    <label className="vid-f vid-pad">
      <span>{label}</span>
      <input value={slide[key]} dir="auto" disabled={locked} data-edit={key} placeholder={placeholder}
             onChange={(e) => onChange({ [key]: e.target.value })} />
    </label>
  );
  const move = (by: -1 | 1) => {
    const slides = [...deck.slides];
    const j = index + by;
    if (j < 0 || j >= slides.length) return;
    [slides[index], slides[j]] = [slides[j], slides[index]];
    onSlides(slides);
  };
  const duplicate = () => {
    const copy = { ...slide, id: newId(), points: [...slide.points], points2: [...slide.points2], pairs: slide.pairs.map((p) => ({ ...p })), rows: slide.rows.map((r) => [...r]) };
    const slides = [...deck.slides];
    slides.splice(index + 1, 0, copy);
    onSlides(slides);
    onSelect(copy.id);
  };
  const removeSlide = () => {
    if (deck.slides.length <= 1) return;
    const slides = deck.slides.filter((s) => s.id !== slide.id);
    onSlides(slides);
    onSelect(slides[Math.min(index, slides.length - 1)].id);
  };
  const setPair = (i: number, patch: Partial<Pair>) => onChange({ pairs: slide.pairs.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const setCell = (r: number, c: number, v: string) => onChange({ rows: slide.rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)) });
  const cols = Math.max(1, ...slide.rows.map((r) => r.length));

  return (
    <div className="vid-look sl-edit">
      <div className="sl-edit-bar vid-pad">
        <label className="vid-f">
          <span>{t('Layout')}</span>
          <select value={k} disabled={locked} onChange={(e) => onChange({ kind: e.target.value as SlideKind })}>
            {[...WRITTEN_KINDS, ...(k === 'references' ? ['references' as const] : [])].map((x) => <option key={x} value={x}>{slideKindName(x, t)}</option>)}
          </select>
        </label>
        <span className="sl-edit-acts">
          <button className="sb-act" disabled={locked || index <= 0} onClick={() => move(-1)} title={t('Move up')} aria-label={t('Move up')}><Icon name="chevron" size={13} turn={-90} /></button>
          <button className="sb-act" disabled={locked || index >= deck.slides.length - 1} onClick={() => move(1)} title={t('Move down')} aria-label={t('Move down')}><Icon name="chevron" size={13} turn={90} /></button>
          <button className="sb-act" disabled={locked} onClick={duplicate} title={t('Duplicate this slide')} aria-label={t('Duplicate this slide')}><Icon name="plus" size={13} /></button>
          <button className="sb-act" disabled={locked || deck.slides.length <= 1} onClick={removeSlide} title={t('Remove this slide')} aria-label={t('Remove this slide')}><Icon name="close" size={13} /></button>
        </span>
      </div>

      {k !== 'quote' && input(t('Title'), 'title')}
      {k === 'quote' && (
        <label className="vid-f vid-pad">
          <span>{t('The quotation')}</span>
          <textarea dir="auto" rows={3} value={slide.body} disabled={locked} data-edit="body" onChange={(e) => onChange({ body: e.target.value })} />
        </label>
      )}
      {(k === 'title' || k === 'section' || k === 'end') && input(t('Under the title'), 'subtitle')}
      {k === 'quote' && input(t('Whose words'), 'subtitle')}
      {k === 'quote' && input(t('Heading (optional)'), 'title')}
      {(k === 'bullets' || k === 'references') && (
        <LinesField label={t('Points, one to a line')} value={slide.points} onChange={(points) => onChange({ points })} disabled={locked} edit="points" />
      )}
      {k === 'two' && (
        <>
          {input(t('First column heading'), 'head')}
          <LinesField label={t('First column, one point to a line')} value={slide.points} onChange={(points) => onChange({ points })} disabled={locked} edit="points" rows={4} />
          {input(t('Second column heading'), 'head2')}
          <LinesField label={t('Second column, one point to a line')} value={slide.points2} onChange={(points2) => onChange({ points2 })} disabled={locked} edit="points2" rows={4} />
        </>
      )}
      {(k === 'stat' || k === 'timeline') && (
        <div className="vid-f vid-pad sl-pairs" data-edit="pairs" tabIndex={-1}>
          <span>{k === 'stat' ? t('Figures and what they are') : t('Steps: when, and what happens')}</span>
          {slide.pairs.map((p, i) => (
            <div key={i} className="sl-pair">
              <input value={p.a} dir="auto" disabled={locked} placeholder={k === 'stat' ? '78%' : '2024'} aria-label={k === 'stat' ? t('Figure') : t('When')}
                     onChange={(e) => setPair(i, { a: e.target.value })} />
              <input value={p.b} dir="auto" disabled={locked} aria-label={k === 'stat' ? t('What it is') : t('What happens')}
                     onChange={(e) => setPair(i, { b: e.target.value })} />
              <button className="sb-act" disabled={locked} onClick={() => onChange({ pairs: slide.pairs.filter((_, j) => j !== i) })}
                      title={t('Remove')} aria-label={t('Remove')}><Icon name="close" size={11} /></button>
            </div>
          ))}
          {slide.pairs.length < (k === 'stat' ? 3 : 6) && (
            <button className="ghost" disabled={locked} onClick={() => onChange({ pairs: [...slide.pairs, { a: '', b: '' }] })}>
              <Icon name="plus" size={11} />{k === 'stat' ? t('Add a figure') : t('Add a step')}
            </button>
          )}
        </div>
      )}
      {k === 'table' && (
        <div className="vid-f vid-pad sl-grid" data-edit="rows" tabIndex={-1}>
          <span>{t('Table — the first row is the header')}</span>
          <div className="sl-grid-cells" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {slide.rows.flatMap((r, ri) => Array.from({ length: cols }, (_, ci) => (
              <input key={`${ri}.${ci}`} value={r[ci] ?? ''} dir="auto" disabled={locked} className={ri === 0 ? 'is-head' : ''}
                     aria-label={fill(t('Row {r}, column {c}'), { r: ri + 1, c: ci + 1 })}
                     onChange={(e) => setCell(ri, ci, e.target.value)} />
            )))}
          </div>
          <span className="sl-grid-acts">
            <button className="ghost" disabled={locked || slide.rows.length >= 8} onClick={() => onChange({ rows: [...slide.rows, Array(cols).fill('')] })}><Icon name="plus" size={11} />{t('Row')}</button>
            <button className="ghost" disabled={locked || cols >= 5} onClick={() => onChange({ rows: slide.rows.map((r) => [...r, ...Array(cols - r.length).fill(''), '']) })}><Icon name="plus" size={11} />{t('Column')}</button>
            <button className="ghost" disabled={locked || slide.rows.length <= 2} onClick={() => onChange({ rows: slide.rows.slice(0, -1) })}><Icon name="close" size={11} />{t('Row')}</button>
            <button className="ghost" disabled={locked || cols <= 1} onClick={() => onChange({ rows: slide.rows.map((r) => r.slice(0, cols - 1)) })}><Icon name="close" size={11} />{t('Column')}</button>
          </span>
        </div>
      )}

      <label className="vid-f vid-pad">
        <span>{t('Speaker notes')}</span>
        <textarea dir="auto" rows={4} value={slide.notes} disabled={locked} placeholder={t('What you say while this slide is on screen')}
                  onChange={(e) => onChange({ notes: e.target.value })} />
      </label>

      <div className="vid-acts">
        {k !== 'references' && (
          <button className="ghost" disabled={locked || !ready} onClick={onRewrite} title={t('Ask the model to write this slide again, with an instruction of yours.')}>
            <Icon name="sparkle" size={12} />{rewriting ? t('Writing this slide again…') : t('Write this slide again…')}
          </button>
        )}
        <span className="vid-f sl-add">
          <select value="" disabled={locked} aria-label={t('Add a slide')}
                  onChange={(e) => { if (e.target.value) onAdd(e.target.value as SlideKind); }}>
            <option value="">{t('Add a slide…')}</option>
            {WRITTEN_KINDS.map((x) => <option key={x} value={x}>{slideKindName(x, t)}</option>)}
          </select>
        </span>
      </div>
    </div>
  );
}

// ── presenting ────────────────────────────────────────────────────────────

/**
 * The deck, one slide filling the screen. The keys a clicker sends move it —
 * →, ↓, Space, Page Down forward; ←, ↑, Page Up back — whatever the deck's
 * direction, because a clicker's "next" is the same key in every language.
 * N shows the notes under the slide; Escape ends it.
 */
function Presenter({ t, deck, at, onClose }: { t: T; deck: Deck; at: number; onClose: () => void }) {
  const [i, setI] = useState(Math.min(Math.max(0, at), Math.max(0, deck.slides.length - 1)));
  const [notes, setNotes] = useState(false);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const box = useRef<HTMLDivElement>(null);
  const last = deck.slides.length - 1;

  useEffect(() => {
    const el = box.current;
    el?.focus();
    el?.requestFullscreen?.().catch(() => { /* the window is the screen, then */ });
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    const onFs = () => { if (!document.fullscreenElement && el && document.activeElement === el) el.focus(); };
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    const next = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key);
    const back = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key);
    if (next) setI((x) => Math.min(last, x + 1));
    else if (back) setI((x) => Math.max(0, x - 1));
    else if (e.key === 'Home') setI(0);
    else if (e.key === 'End') setI(last);
    else if (e.key === 'n' || e.key === 'N') setNotes((x) => !x);
    else if (e.key === 'Escape') onClose();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const slide = deck.slides[i];
  const room = notes ? size.h * 0.72 : size.h - 44;
  const w = Math.min(size.w, (room * 16) / 9);
  return createPortal(
    <div className="sl-present" ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t('Present')} onKeyDown={onKey}>
      <div className="sl-present-stage" onClick={() => setI((x) => Math.min(last, x + 1))}>
        {slide && <SlideView deck={deck} slide={slide} index={i} width={w} />}
      </div>
      {notes && slide && <div className="sl-present-notes" dir="auto">{slide.notes || t('No notes for this slide.')}</div>}
      <div className="sl-present-bar">
        <button onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i <= 0} aria-label={t('Previous slide')} title={t('Previous slide')}>
          <Icon name="chevron" size={14} turn={deck.lang === 'en' ? 180 : 0} />
        </button>
        <span>{fill(t('{n} of {of}'), { n: i + 1, of: deck.slides.length })}</span>
        <button onClick={() => setI((x) => Math.min(last, x + 1))} disabled={i >= last} aria-label={t('Next slide')} title={t('Next slide')}>
          <Icon name="chevron" size={14} turn={deck.lang === 'en' ? 0 : 180} />
        </button>
        <button onClick={() => setNotes((x) => !x)} aria-pressed={notes} title={t('Speaker notes (N)')}>{t('Notes')}</button>
        <button onClick={onClose} title={t('End the presentation (Esc)')}>{t('End')}</button>
      </div>
    </div>,
    document.body,
  );
}
