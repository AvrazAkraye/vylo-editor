import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Icon } from './Icon';
import { GalleryChips, GalleryHero, hue, type Slide } from './Gallery';
import { Ground } from './GalleryArt';
import { dateText } from './fmt';
import { fill, type Lang } from './i18n';
import { MotionBrandKit } from './MotionBrandKit';
import { META, paletteOf } from './motionrecipe';
import { GALLERY_ORDER, GROUP_NAMES, recentRecipes, searchRecipes } from './motionsearch';
import { RECIPES, buildMotion } from './motiontemplates';
import { FORMATS, RECIPE_GROUPS, type Motion, type RecipeGroup, type RecipeId } from './motiontypes';
import type { HomeProps, T } from './motionui';
import { MotionThumb } from './MotionThumb';

/**
 * Motion's home in the full window, before a graphic is open — the same
 * gallery as Video's and Research's (Gallery.tsx): a banner that turns
 * through what the studio does, chips that filter the templates by kind, a
 * card for each template, and the graphics so far as covers.
 *
 * What is its own is that every picture is the real thing. A card's art is
 * its template built with the interface's words and drawn by the studio's
 * renderer (MotionThumb.tsx) — still, at the moment it reads best, until it is
 * pointed at or focused, and then playing; a cover is the graphic as it is;
 * and each banner slide has a template playing on a screen.
 *
 * ## Finding one
 *
 * Under the banner, in place of a heading: a search box, the brand kit's
 * button, and the kinds as chips. What is typed narrows the cards as it is typed
 * (`motionsearch.ts`: names, tags, descriptions, in English and the
 * interface's language), best match first; the chips then count and filter
 * what the search found. Escape empties the box; the arrow down goes to the
 * first card. Templates used lately sit in a line of their own under it, a
 * click from starting again — only once there are some, and not while
 * searching. There is no heading over the templates: the box says how many
 * there are, and the line saying how a template is used shows only until the
 * person has a graphic of their own.
 *
 * ## Light on its feet
 *
 * A card's graphic is built when the card comes near the view, not when the
 * gallery opens, and kept per template and language for the next time. One
 * card plays at a time — the one under the pointer, else the one focused from
 * the keyboard — and nothing plays when the person has asked for less motion.
 *
 * ## Templates still being written
 *
 * The recipes land one file at a time. A template whose recipe is not there
 * yet, or does not build, simply has no card, and its group no chip; nothing
 * here assumes all eighteen exist.
 */

type Group = RecipeGroup | 'all';

function groupName(g: Group, t: T): string {
  return g === 'all' ? t('All') : t(GROUP_NAMES[g]);
}

/** A card's badge: the group's name, the data group's cut short so it shares a line with the card's name. */
function badgeName(g: RecipeGroup, t: T): string {
  return g === 'data' ? t('Data') : groupName(g, t);
}

const GROUP_HUE: Readonly<Record<RecipeGroup, number>> = { titles: 262, overlays: 200, data: 38, brand: 330, backgrounds: 160 };

/** What each banner slide would like to play, best first. */
const HERO_PICKS: readonly (readonly RecipeId[])[] = [
  ['kinetic', 'big-title', 'split-title', 'intro'],
  ['bar-chart', 'big-number', 'donut', 'line-chart', 'stats', 'steps'],
  ['logo-reveal', 'intro', 'countdown', 'quote', 'split-title'],
];

// ── the gallery's graphics ────────────────────────────────────────────────

/**
 * Each template as its card draws it, per language, built once. `null` is a
 * template that failed to build: it gets no card.
 */
const built = new Map<string, Motion | null>();

function galleryDoc(id: RecipeId, lang: Lang): Motion | null {
  const key = `${id}|${lang}`;
  const have = built.get(key);
  if (have !== undefined) return have;
  let doc: Motion | null = null;
  try {
    const made = buildMotion({ id: `gallery-${id}`, recipe: id, lang, format: 'landscape', palette: META[id].palette, now: 0 });
    doc = made.layers.length ? made : null;
  } catch {
    doc = null;
  }
  built.set(key, doc);
  return doc;
}

const waiting: (() => void)[] = [];
let pumping = false;
let port: MessagePort | null = null;

/** A task of its own for `pump`: a message, which a hidden or covered page does not slow the way it slows timers. */
function post() {
  if (typeof MessageChannel === 'undefined') {
    setTimeout(pump, 0);
    return;
  }
  if (!port) {
    const channel = new MessageChannel();
    channel.port1.onmessage = pump;
    port = channel.port2;
  }
  port.postMessage(0);
}

/**
 * Run `job` in a task of its own, after those already waiting: the cards that
 * come near the view together build one graphic per task, so the gallery
 * opening never builds them all in one. Returns the way to take it back.
 */
function soon(job: () => void): () => void {
  waiting.push(job);
  if (!pumping) {
    pumping = true;
    post();
  }
  return () => {
    const i = waiting.indexOf(job);
    if (i >= 0) waiting.splice(i, 1);
  };
}

function pump() {
  try {
    waiting.shift()?.();
  } finally {
    if (waiting.length) post();
    else pumping = false;
  }
}

/**
 * Three templates for the banner, one per slide and none twice, from those
 * whose recipe exists — built here, since the banner shows them at once, so
 * one that fails is passed over for the next.
 */
function heroPicks(exist: readonly RecipeId[], lang: Lang): (RecipeId | null)[] {
  const taken = new Set<RecipeId>();
  const fits = (id: RecipeId) => !taken.has(id) && galleryDoc(id, lang) !== null;
  return HERO_PICKS.map((wants) => {
    const id = wants.find((w) => exist.includes(w) && fits(w)) ?? exist.find(fits) ?? null;
    if (id) taken.add(id);
    return id;
  });
}

// ── words ─────────────────────────────────────────────────────────────────

/** 0:05, 0:30 — a graphic's length as a player shows it. */
function clock(s: number): string {
  const r = Math.max(0, Math.round(Number.isFinite(s) ? s : 0));
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
}

/** "5 minutes ago" within the day, then the date. */
function whenText(at: number, t: T): string {
  if (!Number.isFinite(at) || at <= 0) return '';
  const mins = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (mins < 1) return t('Just now');
  if (mins < 60) return mins === 1 ? t('1 minute ago') : fill(t('{n} minutes ago'), { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? t('1 hour ago') : fill(t('{n} hours ago'), { n: hours });
  return dateText(at);
}

/** The hue of a colour written #rgb or #rrggbb, for a graphic that came from no template. */
function hueOf(color: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d < 0.04) return null;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}

function coverHue(m: Motion): number {
  const meta = m.recipe ? META[m.recipe.id] : undefined;
  return meta ? meta.hue : hueOf(m.palette?.accent ?? '') ?? 262;
}

const reduced = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** Whether the element just focused was reached from the keyboard, where focus should show — and play. */
function keyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

// ── measuring and watching ────────────────────────────────────────────────

/** An element's size in CSS pixels, kept current. */
function useSize(ref: RefObject<HTMLElement>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = (w: number, h: number) => setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    const r = el.getBoundingClientRect();
    read(r.width, r.height);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) read(box.width, box.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

type Watch = (el: Element, on: (near: boolean) => void) => () => void;

/** How far outside the view a card counts as near: most of a row of cards. */
const NEAR = '160px 0px';

/**
 * One IntersectionObserver for every card and cover. Its root is the gallery
 * itself, the element that scrolls — with the window as the root, the margin
 * would stop at the gallery's edge and "near" would mean "in view".
 */
function useWatch(root: RefObject<HTMLElement>): Watch {
  const io = useRef<IntersectionObserver | null>(null);
  const calls = useRef(new Map<Element, (near: boolean) => void>());
  useEffect(() => () => {
    io.current?.disconnect();
    io.current = null;
  }, []);
  return useCallback<Watch>((el, on) => {
    if (typeof IntersectionObserver === 'undefined') {
      on(true);
      return () => undefined;
    }
    io.current ??= new IntersectionObserver((entries) => {
      for (const e of entries) calls.current.get(e.target)?.(e.isIntersecting);
    }, { root: root.current, rootMargin: NEAR });
    calls.current.set(el, on);
    io.current.observe(el);
    return () => {
      calls.current.delete(el);
      io.current?.unobserve(el);
    };
  }, [root]);
}

/** Whether an element is near the view. `sticky`: once it has been, it stays so. */
function useNear(ref: RefObject<Element>, watch: Watch, sticky: boolean): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let stop: (() => void) | null = null;
    stop = watch(el, (on) => {
      if (sticky && !on) return;
      setNear(on);
      if (sticky) {
        stop?.();
        stop = null;
      }
    });
    return () => stop?.();
  }, [ref, watch, sticky]);
  return near;
}

// ── the banner's art ──────────────────────────────────────────────────────

/**
 * Where the banner's screen fits: `width`, and `end`, its distance from the
 * banner's far edge — clear of the arrow there and of the words' column on the
 * near side, as tall as the banner allows. A banner too narrow for a screen
 * worth seeing beside its words gets none, and shows its ground alone.
 */
function roomIn(art: HTMLElement): { width: number; end: number } {
  const none = { width: 0, end: 0 };
  const hero = art.closest('.gal-hero');
  const words = hero?.querySelector('.gal-hero-text');
  const box = art.getBoundingClientRect();
  if (!hero || !words || box.width < 1) return none;
  const rtl = getComputedStyle(hero).direction === 'rtl';
  const column = words.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(words).paddingInlineEnd) || 0;
  // How far into the art the words' column reaches, from the art's near edge.
  const reach = Math.max(0, rtl ? box.right - (column.left + pad) : column.right - pad - box.left);
  const end = Math.min(104, Math.max(64, box.width * 0.08));
  const width = Math.floor(Math.min(box.width - end - reach - 28, ((box.height - 64) * 16) / 9, box.width * 0.62, 560));
  return width >= 150 ? { width, end } : none;
}

/** `roomIn`, kept current as the banner and its words change size. */
function useRoom(ref: RefObject<HTMLElement>): { width: number; end: number } {
  const [room, setRoom] = useState({ width: 0, end: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const next = roomIn(el);
      setRoom((r) => (r.width === next.width && r.end === next.end ? r : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const words = el.closest('.gal-hero')?.querySelector('.gal-hero-text');
    if (words) ro.observe(words);
    return () => ro.disconnect();
  }, [ref]);
  return room;
}

/** The gallery's ground in the template's hue, and the template playing on a screen at the far side from the words. */
function HeroArt({ id, lang }: { id: RecipeId | null; lang: Lang }) {
  const box = useRef<HTMLSpanElement>(null);
  const room = useRoom(box);
  const doc = id ? galleryDoc(id, lang) : null;
  return (
    <span className="mo-hero-art" ref={box}>
      <Ground h={id ? META[id].hue : 262} id={`mo-hero-${id ?? 'none'}`} w={600} hgt={240}>{null}</Ground>
      {id && doc && room.width > 0 && (
        <span className={`mo-hero-screen${META[id].overlay ? ' is-clear' : ''}`} style={{ insetInlineEnd: room.end }}>
          <MotionThumb doc={doc} width={room.width} animate />
        </span>
      )}
    </span>
  );
}

// ── a template's card ─────────────────────────────────────────────────────

function Card({ id, t, lang, live, watch, onPick, onLive, onBroken }: {
  id: RecipeId;
  t: T;
  lang: Lang;
  live: boolean;
  watch: Watch;
  onPick: (id: RecipeId) => void;
  onLive: (id: RecipeId, how: 'hover' | 'focus', on: boolean) => void;
  onBroken: () => void;
}) {
  const meta = META[id];
  const art = useRef<HTMLSpanElement>(null);
  const near = useNear(art, watch, true);
  const { w } = useSize(art);
  // Undefined until built: at once when it was built before, else in its turn once the card is near.
  const [doc, setDoc] = useState<Motion | null | undefined>(() => built.get(`${id}|${lang}`));
  useEffect(() => {
    if (!near) return undefined;
    const have = built.get(`${id}|${lang}`);
    if (have !== undefined) {
      setDoc(have);
      return undefined;
    }
    return soon(() => setDoc(galleryDoc(id, lang)));
  }, [near, id, lang]);
  useEffect(() => {
    if (doc === null) onBroken();
  }, [doc, onBroken]);
  return (
    <button type="button" className={`gal-card mo-card${live ? ' is-live' : ''}`} style={hue(meta.hue)} onClick={() => onPick(id)}
            onPointerEnter={() => onLive(id, 'hover', true)} onPointerLeave={() => onLive(id, 'hover', false)}
            onFocus={(e) => onLive(id, 'focus', keyboardFocus(e.currentTarget))} onBlur={() => onLive(id, 'focus', false)}>
      {/* Until it is drawn, the art is the template's own ground; an overlay's is the checkerboard it is transparent over. */}
      <span ref={art} className={`gal-card-art mo-card-art${meta.overlay ? ' is-clear' : ''}`}
            style={meta.overlay ? undefined : { background: paletteOf(meta.palette).colors.bg }}>
        {doc && w > 0 && <MotionThumb doc={doc} width={w} animate={live} />}
        {/* The name and the group share one line, away from the top, where templates put their titles. */}
        <span className="mo-card-label">
          <b className="gal-card-name">{t(meta.name)}</b>
          <span className="mo-card-tags">
            <span className="gal-badge"><i />{badgeName(meta.group, t)}</span>
            {meta.overlay && <span className="mo-over"><Icon name="film" size={10} />{t('Over video')}</span>}
          </span>
        </span>
      </span>
      <span className="gal-card-body">
        <span className="gal-card-about">{t(meta.about)}</span>
      </span>
    </button>
  );
}

// ── a graphic's cover ─────────────────────────────────────────────────────

function Cover({ m, t, watch, onOpen }: { m: Motion; t: T; watch: Watch; onOpen: (id: string) => void }) {
  const art = useRef<HTMLSpanElement>(null);
  const slot = useRef<HTMLSpanElement>(null);
  // Not sticky: a long list of graphics keeps canvases only near the view.
  const near = useNear(art, watch, false);
  const box = useSize(slot);
  const shape = FORMATS[m.format] ?? FORMATS.landscape;
  const fit = Math.min(box.w, (box.h * shape.width) / shape.height);
  const width = fit >= 24 ? fit : 0;
  const clear = m.backdrop === null;
  const meta = m.recipe ? META[m.recipe.id] : undefined;
  const title = m.title || m.request || (meta ? t(meta.name) : '');
  const state = m.error ? 'is-bad' : m.stage === 'planning' ? 'is-live' : m.stage === 'ready' ? 'is-done' : '';
  const said = m.error ? t('Failed') : m.stage === 'planning' ? t('Planning') : m.stage === 'ready' ? t('Ready') : '';
  return (
    <button type="button" className="gal-cover mo-cover" style={hue(coverHue(m))} onClick={() => onOpen(m.id)}>
      <span className="gal-cover-art mo-cover-art" ref={art}>
        <span className="mo-cover-slot" ref={slot}>
          {width > 0 && (
            <span className={`mo-cover-frame${clear ? ' is-clear' : ''}`}
                  style={{ width, height: (width * shape.height) / shape.width, background: clear ? undefined : m.palette?.bg }}>
              {near && <MotionThumb doc={m} width={width} />}
            </span>
          )}
        </span>
        <span className="gal-badge"><i />{shape.ratio}</span>
        <span className="mo-cover-time">{clock(m.seconds)}</span>
      </span>
      <span className="gal-cover-foot">
        <span className={state ? `mo-dot ${state}` : 'mo-dot'} role={said ? 'img' : undefined} aria-label={said || undefined} title={said || undefined}
              aria-hidden={said ? undefined : true} />
        <span dir="auto">{title}</span>
        <small>{whenText(m.updated, t)}</small>
      </span>
    </button>
  );
}

// ── the home ──────────────────────────────────────────────────────────────

export function MotionHome({ t, lang, motions, onOpen, onTemplate, onAsk }: HomeProps) {
  const root = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const find = useRef<HTMLInputElement>(null);
  const watch = useWatch(root);
  const [group, setGroup] = useState<Group>('all');
  const [query, setQuery] = useState('');
  const [hovered, setHovered] = useState<RecipeId | null>(null);
  const [focused, setFocused] = useState<RecipeId | null>(null);
  // Bumped when a card finds its template does not build, so the card and its count go.
  const [, setBroken] = useState(0);
  const onBroken = useCallback(() => setBroken((n) => n + 1), []);
  const onLive = useCallback((id: RecipeId, how: 'hover' | 'focus', on: boolean) => {
    (how === 'hover' ? setHovered : setFocused)((cur) => (on ? id : cur === id ? null : cur));
  }, []);

  const exist = GALLERY_ORDER.filter((id) => !!RECIPES[id]);
  const [ask, moving, local] = heroPicks(exist, lang);
  // A card for every template that exists and has not failed to build; those
  // not built yet are built as their cards come near the view.
  const ready = exist.filter((id) => built.get(`${id}|${lang}`) !== null);
  // What the search found, best first; everything, in the gallery's order, when nothing is typed.
  const searching = query.trim() !== '';
  const found = searching ? searchRecipes(query, lang).filter((id) => ready.includes(id)) : ready;
  const groups = RECIPE_GROUPS.filter((g) => found.some((id) => META[id].group === g));
  const active: Group = group !== 'all' && groups.includes(group) ? group : 'all';
  const shown = found.filter((id) => active === 'all' || META[id].group === active);
  const recent = searching ? [] : recentRecipes(motions).filter((id) => ready.includes(id));
  const live = hovered ?? focused;

  const firstCard = () => grid.current?.querySelector<HTMLButtonElement>('.gal-card');
  // A clear button goes with what it clears, so the focus goes back to the box rather than to nowhere.
  const clearSearch = () => {
    setQuery('');
    find.current?.focus();
  };
  const showTemplates = () => {
    head.current?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    firstCard()?.focus({ preventScroll: true });
  };

  const slides: Slide[] = [
    { key: 'ask', hue: ask ? META[ask].hue : 262, art: <HeroArt id={ask} lang={lang} />, mirror: false, icon: 'motion', tag: t('Motion'),
      title: t('A motion graphic from one sentence'),
      text: t('Say what it should show — a title, a name over a video, a number that counts up — in Arabic, Kurdish or English. The model builds it, and you can change every word, colour and timing.'),
      go: t('Describe a graphic'), to: onAsk },
  ];
  if (moving) {
    slides.push({ key: 'templates', hue: META[moving].hue, art: <HeroArt id={moving} lang={lang} />, mirror: false, icon: 'grid', tag: t('Templates'),
      title: t('Templates that move'),
      text: fill(t('{n} templates — titles, lower thirds, charts, logo reveals and moving backgrounds — already in your language. Point at one to watch it play.'), { n: ready.length }),
      go: t('See the templates'), to: showTemplates });
  }
  if (local) {
    slides.push({ key: 'local', hue: META[local].hue, art: <HeroArt id={local} lang={lang} />, mirror: false, icon: 'shield', tag: t('On this machine'),
      title: t('No libraries, no uploads'),
      text: t('Drawn and saved on this machine: the app’s own code draws every frame and writes the MP4 or the PNG. Nothing is sent anywhere unless you ask the model.'),
      go: t('Start from a template'), to: () => onTemplate(local) });
  }

  return (
    <div className="gal-home" ref={root}>
      <GalleryHero slides={slides} label={t('Motion')} prev={t('Previous')} next={t('Next')} />

      {ready.length > 0 && (
        <>
          {/* In place of a heading: find, filter, and the brand new graphics start in. */}
          <div className="mg-bar mo-head" ref={head}>
            <label className="mg-find">
              <Icon name="search" size={13} />
              <input ref={find} type="search" value={query} spellCheck={false} autoComplete="off" dir="auto"
                     placeholder={fill(t('Search {n} templates'), { n: ready.length })} aria-label={t('Search the templates')}
                     onChange={(e) => setQuery(e.target.value)}
                     onKeyDown={(e) => {
                       if (e.key === 'Escape' && query) {
                         e.preventDefault();
                         e.stopPropagation();
                         setQuery('');
                       } else if (e.key === 'ArrowDown' || (e.key === 'Enter' && searching)) {
                         const card = firstCard();
                         if (card) {
                           e.preventDefault();
                           card.focus();
                         }
                       }
                     }} />
              {query && (
                <button type="button" className="mg-find-clear" onClick={clearSearch} title={t('Clear the search')} aria-label={t('Clear the search')}>
                  <Icon name="close" size={11} />
                </button>
              )}
            </label>
            {found.length > 0 && (
              <GalleryChips label={t('Kinds')} value={active} onChange={setGroup}
                            chips={(['all', ...groups] as Group[]).map((g) => ({
                              id: g, label: groupName(g, t), hue: g === 'all' ? undefined : GROUP_HUE[g],
                              count: g === 'all' ? found.length : found.filter((id) => META[id].group === g).length,
                            }))} />
            )}
            <MotionBrandKit t={t} />
          </div>
          <span className="mg-sr" role="status">{searching ? fill(t('{n} templates found'), { n: found.length }) : ''}</span>
          {/* How templates work, said once: until there is a graphic of one's own. */}
          {!motions.length && !searching && (
            <p className="mg-hint">{t('Start from one and change the words, the colours and the timing — or name one in your request and the model fills it in.')}</p>
          )}
          {recent.length > 0 && (
            <div className="mg-recent" role="group" aria-label={t('Recently used')}>
              <span className="gal-chips-label">{t('Recently used')}</span>
              {recent.map((id) => (
                <button key={id} type="button" className="gal-chip" style={hue(META[id].hue)} onClick={() => onTemplate(id)}>
                  <i />{t(META[id].name)}
                </button>
              ))}
            </div>
          )}
          {shown.length > 0 ? (
            <div className="gal-grid" ref={grid}>
              {shown.map((id) => (
                <Card key={id} id={id} t={t} lang={lang} live={live === id} watch={watch}
                      onPick={onTemplate} onLive={onLive} onBroken={onBroken} />
              ))}
            </div>
          ) : (
            <p className="mg-none">
              <span dir="auto">{fill(t('No template matches “{words}”.'), { words: query.trim() })}</span>
              <button type="button" className="ghost bordered mg-none-clear" onClick={clearSearch}>
                <span className="cta-label">{t('Clear the search')}</span>
              </button>
            </p>
          )}
        </>
      )}

      {motions.length > 0 && (
        <>
          <div className="gal-head">
            <h3>{t('Your graphics')} <small>{motions.length}</small></h3>
          </div>
          <div className="gal-covers">
            {motions.map((m) => <Cover key={m.id} m={m} t={t} watch={watch} onOpen={onOpen} />)}
          </div>
        </>
      )}
    </div>
  );
}
