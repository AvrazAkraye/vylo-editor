import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { save as savePanel } from '@tauri-apps/plugin-dialog';
import { Icon } from './Icon';
import { IS_MAC } from './Welcome';
import * as ask from './ask';
import { fill, type Lang } from './i18n';
import { explain } from './errors';
import { BUILT_IN, armed, route as routeOf, type Chosen, type Provider } from './providers';
import { allows, type PlanSummary } from './account';
import { MODELS, modelName } from './models';
import { EFFORTS, effortLabel, effortOf, effortsFor, type Effort, type EffortBook } from './effort';
import { generate, type Target } from './generate';
import {
  FPS, SCENE_KINDS, type Brand, type Format, type Picture, type Scene, type SceneKind, type Style, type Video, type VideoLang,
} from './videotypes';
import {
  LENGTHS, TRANSITION_FRAMES, blankScene, durationInFrames, formatIn, isRtl, newVideo, parsePlan, parseScene,
  planPrompt, sceneFrames, scenePrompt, secondsIn, styleIn, videoLangOf,
} from './video';
import { deleteVideo, loadVideos, saveVideo } from './videostore';
import { creditsOf, fillPictures } from './videomedia';
import { canExport, renderVideo, videoFileName, writeVideoFile } from './videoexport';
import { STYLE_SWATCH } from './VideoScenes';
import { PICTURED, Storyboard, gistOf, kindAbout, kindName } from './VideoStoryboard';

/**
 * Video, in the sidebar: describe a short film, and get a storyboard you can
 * edit, preview and export as an MP4.
 *
 * The same shape as Research (ResearchPanel.tsx), on purpose — a request box
 * whose words switch things on and say so, the same model and intelligence
 * controls, runs that live outside React so they survive the sidebar being
 * closed, and a full window for the work that does not fit in a column.
 *
 * ## The model writes words, never code
 *
 * What comes back from the model is a storyboard in JSON: scenes of fixed
 * kinds with plain fields. video.ts reads and repairs it; the app's own
 * components draw it (VideoScenes.tsx). Nothing the model wrote is run, and
 * nothing it wrote reaches a file except through **Export MP4**, which the
 * person presses, at a path they choose in the save panel, rendering what is
 * on screen at that moment. That is SAFETY.md's rule, kept here.
 *
 * ## Pictures
 *
 * Found in Openverse and Wikimedia Commons, only under licences that allow
 * reuse, each kept with its credit and listed in a closing card. The person
 * sees every one and can change or remove it.
 */

interface Props {
  t: (s: string) => string;
  /** The interface language: the video's language when a request has no letters to tell it by. */
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

// ── runs, outside React ───────────────────────────────────────────────────

type Work =
  | { how: 'plan' }
  | { how: 'scene'; id: string; instruction: string }
  | { how: 'pictures' };

interface Job {
  ctl: AbortController;
  how: Work['how'];
  /** What it is doing now. */
  stage: 'planning' | 'pictures' | 'scene';
  started: number;
  /** Characters of the model's answer so far, so a long wait visibly moves. */
  chars: number;
  /** Pictures found, of those wanted. */
  pics: { done: number; of: number };
  /** The scene being written again. */
  sceneId?: string;
  /** A request being tried again, and of how many. */
  retry?: { attempt: number; of: number };
}

/** An export in progress. */
interface Out {
  ctl: AbortController;
  phase: 'render' | 'write';
  fraction: number;
  eta?: number;
  started: number;
}

const jobs = new Map<string, Job>();
const outs = new Map<string, Out>();
/** Where each video was last exported this session, for "Show in Finder". */
const savedTo = new Map<string, string>();
/** The newest copy of every video this session has seen, by id. */
const known = new Map<string, Video>();
const watchers = new Set<() => void>();
let loaded = false;
let unkept = false;
/** Videos deleted this session, which a run still unwinding must not put back. */
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

function keep(v: Video) {
  if (gone.has(v.id)) return;
  known.set(v.id, v);
  void saveVideo(v).then((ok) => { if (!ok && !unkept) { unkept = true; notify(); } });
  notify();
}

/** Change the newest copy of a video, whoever holds an older one. */
function update(id: string, change: (v: Video) => Video) {
  const v = known.get(id);
  if (v) keep({ ...change(v), updated: Date.now() });
}

const putPicture = (id: string, sceneId: string, picture: Picture) =>
  update(id, (v) => ({ ...v, scenes: v.scenes.map((s) => (s.id === sceneId ? { ...s, picture } : s)) }));

const newId = () => {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** Said by the run as codes, so the sentence is chosen where `t` is. */
const UNREADABLE_PLAN = 'video:unreadable-plan';
const UNREADABLE_SCENE = 'video:unreadable-scene';

/**
 * Fetch the pictures the scenes asked for and have not got, one at a time,
 * each kept as it arrives — a scene edited meanwhile keeps its edit, because
 * only the picture is written into it, by the scene's id.
 */
async function picturesFor(id: string, job: Job, only?: string) {
  const v = known.get(id);
  if (!v) return;
  const want = v.scenes.filter((s) => s.imageQuery && !s.picture && PICTURED.has(s.kind) && (!only || s.id === only));
  job.stage = only ? 'scene' : 'pictures';
  job.pics = { done: 0, of: want.length };
  notify();
  if (!want.length) return;
  // The scenes that already have a picture go too, and are skipped: they are
  // what keeps the same photograph from being chosen for two scenes.
  const got = await fillPictures(v.scenes.filter((s) => s.picture || want.includes(s)), {
    format: v.format,
    signal: job.ctl.signal,
    onScene: (_i, scene) => {
      job.pics.done = Math.min(job.pics.of, job.pics.done + 1);
      if (scene.picture) putPicture(id, scene.id, scene.picture);
      notifySoon();
    },
  });
  for (const s of got) if (s.picture && !known.get(id)?.scenes.find((x) => x.id === s.id)?.picture) putPicture(id, s.id, s.picture);
}

function start(v: Video, gw: Target, efforts: EffortBook, work: Work, say: (e: unknown) => string, report: (m: string) => void) {
  if (jobs.has(v.id)) return;
  const ctl = new AbortController();
  const job: Job = {
    ctl, how: work.how, stage: work.how === 'plan' ? 'planning' : work.how === 'scene' ? 'scene' : 'pictures',
    started: Date.now(), chars: 0, pics: { done: 0, of: 0 }, sceneId: work.how === 'scene' ? work.id : undefined,
  };
  jobs.set(v.id, job);
  const id = v.id;
  const call = (system: string, user: string, maxTokens: number) => generate(gw, {
    system, user, maxTokens, efforts, signal: ctl.signal,
    onText: (d) => { job.chars += d.length; job.retry = undefined; notifySoon(); },
    onRestart: () => { job.chars = 0; },
    onRetry: (attempt, of) => { job.retry = { attempt, of }; notifySoon(); },
  });

  const going = (async () => {
    if (work.how === 'plan') {
      update(id, (x) => ({ ...x, stage: 'planning', error: undefined, model: gw.model }));
      const p = planPrompt(known.get(id) ?? v);
      const out = await call(p.system, p.user, 8000);
      const cur = known.get(id) ?? v;
      const plan = parsePlan(out.text, cur, newId);
      if (!plan || !plan.scenes.length) throw new Error(UNREADABLE_PLAN);
      keep({ ...cur, title: plan.title || cur.title, scenes: plan.scenes, stage: 'pictures', updated: Date.now() });
      await picturesFor(id, job);
    } else if (work.how === 'scene') {
      const cur = known.get(id);
      const index = cur ? cur.scenes.findIndex((s) => s.id === work.id) : -1;
      if (!cur || index < 0) return;
      const old = cur.scenes[index];
      const p = scenePrompt(cur, index, work.instruction);
      const out = await call(p.system, p.user, 3000);
      const now = known.get(id) ?? cur;
      const next = parseScene(out.text, old, now, newId);
      if (!next) throw new Error(UNREADABLE_SCENE);
      // The picture stays when the scene still wants the same one.
      const same = old.picture && PICTURED.has(next.kind) && (!next.imageQuery || next.imageQuery === old.imageQuery || next.imageQuery === old.picture.query);
      const kept: Scene = next.picture || !same ? next : { ...next, picture: old.picture };
      update(id, (x) => ({ ...x, scenes: x.scenes.map((s) => (s.id === old.id ? kept : s)) }));
      job.sceneId = kept.id;
      await picturesFor(id, job, kept.id);
    } else {
      await picturesFor(id, job);
    }
  })();

  going
    .catch((e: unknown) => {
      if ((e as { name?: string })?.name === 'AbortError' || ctl.signal.aborted) return;
      const m = say(e);
      // A storyboard that could not be made is said on the video, where it
      // is looked for; a scene or a picture is said where the person is.
      if (work.how === 'plan' && !known.get(id)?.scenes.length) update(id, (x) => ({ ...x, error: m }));
      else report(m);
    })
    .finally(() => {
      jobs.delete(id);
      // Never left "planning" in storage: a restart would show a run that is not there.
      const cur = known.get(id);
      if (cur && cur.stage !== 'ready' && cur.stage !== 'new') keep({ ...cur, stage: cur.scenes.length ? 'ready' : 'new', updated: Date.now() });
      else notify();
    });
}

function stop(id: string) {
  jobs.get(id)?.ctl.abort();
}

// ── the full window ───────────────────────────────────────────────────────

let full = false;
let fullError: string | null = null;

/** Open the Video workspace over the whole window, or close it. */
export function toggleVideoFull(on = !full) {
  full = on;
  fullError = null;
  notify();
}

/** The request form as it was left, kept across the moves between the sidebar and the full window. */
interface Draft {
  request: string;
  format: Format | null;
  seconds: number | null;
  style: Style | null;
  lang: VideoLang | null;
  set: Partial<Pick<Video, 'choice' | 'effort'>>;
  more: boolean;
}

const draft: Draft = { request: '', format: null, seconds: null, style: null, lang: null, set: {}, more: false };

function useDraft<K extends keyof Draft>(k: K): [Draft[K], (v: Draft[K]) => void] {
  const [v, setV] = useState<Draft[K]>(draft[k]);
  return [v, (next) => { draft[k] = next; setV(next); }];
}

/** The brand, kept for the next video: somebody making their clinic's videos makes more than one. */
const BRAND_KEY = 'vylo.video.brand.v1';

function readBrand(): Brand {
  try {
    const v = JSON.parse(localStorage.getItem(BRAND_KEY) ?? 'null');
    if (!v || typeof v !== 'object') return {};
    const hex = (x: unknown) => (typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x) ? x : undefined);
    return {
      name: typeof v.name === 'string' ? v.name.slice(0, 80) : undefined,
      primary: hex(v.primary),
      accent: hex(v.accent),
      logo: typeof v.logo === 'string' && v.logo.startsWith('data:image/') ? v.logo : undefined,
    };
  } catch {
    return {};
  }
}

// ── routes: the model a video is planned with ─────────────────────────────

interface Routes {
  providers: readonly Provider[];
  gateway: { baseUrl: string; apiKey: string };
  fallback: Target;
  choice: Chosen;
}

/**
 * A video's own choice, while the provider it names is still there at the
 * address it was chosen at; otherwise none, and the video follows the
 * composer. A provider removed in Settings frees its id for the next one, and
 * following the id would send the request to a host nobody chose for it.
 */
function choiceOf(v: Partial<Pick<Video, 'choice'>>, r: Routes): Video['choice'] | undefined {
  const c = v.choice;
  if (!c || c.provider === BUILT_IN) return c;
  const p = r.providers.find((x) => x.id === c.provider);
  return p && (!c.at || c.at === p.baseUrl) ? c : undefined;
}

function targetOf(v: Partial<Pick<Video, 'choice'>>, r: Routes): Target {
  const c = choiceOf(v, r);
  if (!c) return r.fallback;
  const x = routeOf(c, r.providers, { ...r.gateway, model: r.fallback.model });
  return { baseUrl: x.baseUrl, apiKey: x.key, wire: x.wire, model: x.model };
}

function bookFor(v: Partial<Pick<Video, 'effort'>>, target: Target, book: EffortBook): EffortBook {
  return v.effort ? { ...book, [target.model]: v.effort } : book;
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

type T = (s: string) => string;

function formatName(f: Format, t: T): string {
  if (f === 'portrait') return t('Vertical 9:16');
  if (f === 'square') return t('Square 1:1');
  return t('Wide 16:9');
}

function formatUse(f: Format, t: T): string {
  if (f === 'portrait') return t('Reels, TikTok, Stories');
  if (f === 'square') return t('Feeds and posts');
  return t('YouTube, websites, screens');
}

function styleName(s: Style, t: T): string {
  if (s === 'bold') return t('Bold');
  if (s === 'elegant') return t('Elegant');
  if (s === 'neon') return t('Neon');
  if (s === 'minimal') return t('Minimal');
  if (s === 'warm') return t('Warm');
  return t('Modern');
}

function langName(l: VideoLang, t: T): string {
  if (l === 'ar') return t('Arabic');
  if (l === 'ckb') return t('Kurdish — Sorani');
  if (l === 'kmr') return t('Kurdish — Badini');
  return t('English');
}

const FORMATS_LIST: readonly Format[] = ['landscape', 'portrait', 'square'];
const STYLES_LIST: readonly Style[] = ['modern', 'bold', 'elegant', 'neon', 'minimal', 'warm'];

function errorText(e: string, t: T): string {
  if (e === UNREADABLE_PLAN) return t('The storyboard could not be read from the model’s reply. Try again, or try another model.');
  if (e === UNREADABLE_SCENE) return t('The new scene could not be read from the model’s reply. Try again, or say it differently.');
  return e;
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const whenOf = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** Seconds, as the length a video will play for. */
const lengthOf = (v: Video) => (v.scenes.length ? durationInFrames(v) / FPS : v.seconds);

/** The first frame of scene `i` with the transition into it finished. */
function frameOf(v: Video, i: number): number {
  let at = 0;
  for (let j = 0; j < i && j < v.scenes.length; j++) {
    at += sceneFrames(v.scenes[j]) - (v.scenes[j].transition !== 'none' && j < v.scenes.length - 1 ? TRANSITION_FRAMES : 0);
  }
  return i > 0 ? at + TRANSITION_FRAMES : 0;
}

/** What the model is doing before its first words arrive; a line that changes says it is working. */
function thinkingVerb(ms: number, t: T): string {
  const n = Math.floor(ms / 4000) % 4;
  if (n === 1) return t('Choosing the scenes');
  if (n === 2) return t('Writing the words');
  if (n === 3) return t('Timing the cuts');
  return t('Reading your request');
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

const Preview = lazy(() => import('./VideoPreview'));

// ── small pieces ──────────────────────────────────────────────────────────

/** The model, and how hard it thinks — the composer's menu, as Research offers it. */
function ModelSettings({ t, value, onChange, routes, efforts, plan, disabled }: {
  t: T;
  value: Partial<Pick<Video, 'choice' | 'effort'>>;
  onChange: (next: Partial<Pick<Video, 'choice' | 'effort'>>) => void;
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

/** Three frames, drawn at their own proportions, because the shape is the choice. */
function FormatPicker({ t, value, onChange, disabled }: { t: T; value: Format; onChange: (f: Format) => void; disabled?: boolean }) {
  return (
    <div className="vid-formats" role="radiogroup" aria-label={t('Shape of the video')}>
      {FORMATS_LIST.map((f) => (
        <button key={f} type="button" role="radio" aria-checked={value === f} disabled={disabled}
                className={value === f ? 'on' : ''} onClick={() => onChange(f)} title={formatUse(f, t)}>
          <i className={f === 'portrait' ? 'vid-shape is-tall' : f === 'square' ? 'vid-shape is-square' : 'vid-shape'} aria-hidden="true" />
          <b>{formatName(f, t)}</b>
          <small>{formatUse(f, t)}</small>
        </button>
      ))}
    </div>
  );
}

/** The styles as swatches: the palette is most of what a style is. */
function StylePicker({ t, value, onChange, disabled }: { t: T; value: Style; onChange: (s: Style) => void; disabled?: boolean }) {
  return (
    <div className="vid-styles" role="radiogroup" aria-label={t('Style')}>
      {STYLES_LIST.map((s) => {
        const sw = STYLE_SWATCH[s];
        return (
          <button key={s} type="button" role="radio" aria-checked={value === s} disabled={disabled}
                  className={value === s ? 'on' : ''} onClick={() => onChange(s)}>
            <span className="vid-swatch" style={{ background: sw.bg, color: sw.fg }} aria-hidden="true">
              Aa<i style={{ background: sw.accent }} />
            </span>
            <span>{styleName(s, t)}</span>
          </button>
        );
      })}
    </div>
  );
}

function LangPicker({ t, value, onChange, disabled }: { t: T; value: VideoLang; onChange: (l: VideoLang) => void; disabled?: boolean }) {
  return (
    <div className="vid-seg vid-langs" role="radiogroup" aria-label={t('Language of the words')}>
      {(['ar', 'ckb', 'kmr', 'en'] as const).map((l) => (
        <button key={l} type="button" role="radio" aria-checked={value === l} disabled={disabled}
                className={value === l ? 'on' : ''} onClick={() => onChange(l)} lang={l}>
          {langName(l, t)}
        </button>
      ))}
    </div>
  );
}

function LengthPicker({ t, value, onChange, disabled }: { t: T; value: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <div className="vid-seg" role="radiogroup" aria-label={t('Length')}>
      {LENGTHS.map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} disabled={disabled}
                className={value === n ? 'on' : ''} onClick={() => onChange(n)}>
          {fill(t('{n} s'), { n })}
        </button>
      ))}
      {!LENGTHS.includes(value) && (
        <button type="button" role="radio" aria-checked className="on" disabled={disabled}>{fill(t('{n} s'), { n: value })}</button>
      )}
    </div>
  );
}

/** The brand's name, colours and logo. Colours override the style's; the logo is on the title and the close. */
function BrandFields({ t, value, style, onChange, disabled }: {
  t: T;
  value: Brand;
  style: Style;
  onChange: (b: Brand) => void;
  disabled?: boolean;
}) {
  const [bad, setBad] = useState(false);
  const sw = STYLE_SWATCH[style];
  const colour = (label: string, key: 'primary' | 'accent', fallback: string) => (
    <div className="vid-colour">
      <label>
        <input type="color" value={value[key] ?? fallback} disabled={disabled}
               onChange={(e) => onChange({ ...value, [key]: e.target.value })} />
        <span>{label}</span>
      </label>
      {value[key]
        ? <button type="button" className="sb-act" disabled={disabled} onClick={() => onChange({ ...value, [key]: undefined })}
                  title={t('Use the style’s colour')} aria-label={t('Use the style’s colour')}><Icon name="close" size={11} /></button>
        : <small>{t('the style’s')}</small>}
    </div>
  );
  return (
    <div className="vid-form">
      <label className="vid-f vid-wide">
        <span>{t('Brand name')}</span>
        <input value={value.name ?? ''} dir="auto" disabled={disabled} placeholder={t('Shown on the closing scene')}
               onChange={(e) => onChange({ ...value, name: e.target.value || undefined })} />
      </label>
      {colour(t('Main colour'), 'primary', sw.bg)}
      {colour(t('Accent colour'), 'accent', sw.accent)}
      <div className="vid-logo vid-wide">
        {value.logo ? <img src={value.logo} alt="" /> : <span className="vid-pic-none"><Icon name="image" size={16} /></span>}
        <span className="vid-pic-what">
          <b>{t('Logo')}</b>
          <span>{t('On the title and the closing scene. PNG with a clear background looks best.')}</span>
        </span>
        <button type="button" className="ghost" disabled={disabled}
                onClick={() => pickLogo((logo) => { setBad(false); onChange({ ...value, logo }); }, () => setBad(true))}>
          {value.logo ? t('Change the logo') : t('Add a logo')}
        </button>
        {value.logo && <button type="button" className="ghost" disabled={disabled} onClick={() => onChange({ ...value, logo: undefined })}>{t('Remove')}</button>}
      </div>
      {bad && <p className="vid-bad vid-wide">{t('Use a PNG or JPEG picture under 400 KB.')}</p>}
    </div>
  );
}

/** Where a run is: a bar, a clock, and a sentence. */
function JobStatus({ t, video, job }: { t: T; video: Video; job: Job }) {
  useTick(true);
  const elapsed = Date.now() - job.started;
  let line: string;
  let pct: number | null = null;
  if (job.stage === 'planning') {
    line = job.chars ? t('Writing the storyboard…') : `${thinkingVerb(elapsed, t)}…`;
  } else if (job.stage === 'pictures') {
    pct = job.pics.of ? Math.round((100 * job.pics.done) / job.pics.of) : 100;
    line = job.pics.of
      ? fill(t('Finding pictures {n} of {of}…'), { n: Math.min(job.pics.of, job.pics.done + 1), of: job.pics.of })
      : t('Finishing…');
  } else {
    const i = video.scenes.findIndex((s) => s.id === job.sceneId);
    line = job.pics.of ? t('Finding a picture for the scene…') : fill(t('Writing scene {n} again…'), { n: i + 1 });
  }
  return (
    <div className="vid-status" role="status">
      <p className="vid-status-line">
        <span className="vid-glyph" aria-hidden="true">✻</span>
        <b>{line}</b>
      </p>
      <div className={`vid-bar ${pct === null ? 'is-early' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100}
           aria-valuenow={pct ?? undefined} aria-label={t('Progress')}>
        <i style={{ inlineSize: `${pct ?? 0}%` }} />
      </div>
      <p className="vid-clock">
        <span>{fill(t('Running for {time}'), { time: clock(elapsed) })}</span>
        {job.stage === 'planning' && job.chars > 0 && <span>{fill(t('{n} characters'), { n: job.chars.toLocaleString() })}</span>}
        {job.retry && <span>{fill(t('Trying again ({n} of {of})…'), { n: job.retry.attempt, of: job.retry.of })}</span>}
      </p>
    </div>
  );
}

/** An export under way: the frames rendered, roughly how long is left, and Cancel. */
function ExportStatus({ t, out }: { t: T; out: Out }) {
  useTick(true);
  const elapsed = Date.now() - out.started;
  const pct = Math.round(Math.min(1, Math.max(0, out.fraction)) * 100);
  const left = out.eta ?? (out.fraction > 0.02 ? (elapsed / out.fraction) * (1 - out.fraction) : 0);
  return (
    <div className="vid-status vid-export" role="status">
      <p className="vid-status-line">
        <span className="vid-glyph" aria-hidden="true">✻</span>
        <b>{out.phase === 'write' ? t('Saving the file…') : t('Rendering the video…')}</b>
        {out.phase === 'render' && <span className="vid-pct">{pct}%</span>}
      </p>
      <div className="vid-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('Progress')}>
        <i style={{ inlineSize: `${out.phase === 'write' ? 100 : pct}%` }} />
      </div>
      <p className="vid-clock">
        <span>{fill(t('Running for {time}'), { time: clock(elapsed) })}</span>
        {out.phase === 'render' && left > 1000 && <span>{fill(t('about {time} left'), { time: clock(left) })}</span>}
        <span>{t('Keep the app open until it is saved.')}</span>
      </p>
    </div>
  );
}

// ── the panel ─────────────────────────────────────────────────────────────

export function VideoPanel({ t, lang, gw, efforts, plan, providers, choice, gateway, onProviders, onError }: Props) {
  useWatch();
  const [openId, setOpenId] = useState<string | null>(null);
  const [seek, setSeek] = useState<{ frame: number; n: number } | undefined>(undefined);
  const fullBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loaded) return;
    loaded = true;
    void loadVideos().then((list) => {
      for (const v of list) {
        if (known.has(v.id)) continue;
        // A run the app was closed in the middle of is not running now.
        const stage = v.stage === 'planning' || v.stage === 'pictures' ? (v.scenes.length ? 'ready' : 'new') : v.stage;
        known.set(v.id, stage === v.stage ? v : { ...v, stage });
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
        toggleVideoFull(false);
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

  const routes: Routes = useMemo(() => ({ providers, gateway, fallback: gw, choice }), [providers, gateway, gw, choice]);
  const videos = [...known.values()].sort((a, b) => b.created - a.created);
  const open = openId ? known.get(openId) ?? null : null;

  const report = (m: string) => {
    if (full) { fullError = m; notify(); } else onError(m);
  };
  const begin = (v: Video, work: Work) => {
    const target = targetOf(v, routes);
    const doing = work.how === 'plan' ? t('plan the video') : work.how === 'scene' ? t('write the scene again') : t('find pictures');
    start(v, target, bookFor(v, target, efforts), work, (e) => explain(e, doing), report);
  };
  const seekTo = (v: Video, i: number) => setSeek((s) => ({ frame: frameOf(v, i), n: (s?.n ?? 0) + 1 }));

  const target = targetOf(open ?? draft.set, routes);
  const ready = armed({ baseUrl: target.baseUrl, key: target.apiKey });

  const body = (
    <div className="vid">
      {!ready && (
        <div className="sb-cta">
          <p className="ft-empty">{t('Add an API key in Settings first.')}</p>
          <button className="ghost bordered" onClick={onProviders}>
            <Icon name="settings" size={13} />
            <span className="cta-label">{t('Open Settings')}</span>
          </button>
        </div>
      )}
      {unkept && <p className="vid-warn">{t('Videos cannot be kept on this machine right now. Export before you close the app.')}</p>}
      {open
        ? <VideoView key={open.id} t={t} video={open} routes={routes} efforts={efforts} plan={plan} ready={ready} inFull={full}
                     seek={seek} onSeek={(i) => seekTo(open, i)}
                     onBack={() => setOpenId(null)} begin={begin} onError={report} />
        : <Home t={t} lang={lang} routes={routes} efforts={efforts} plan={plan} ready={ready} videos={videos}
                onOpen={setOpenId}
                onStart={(v) => { keep(v); setOpenId(v.id); begin(v, { how: 'plan' }); }} />}
    </div>
  );

  if (full) {
    return (
      <>
        <div className="sb-cta vid-away">
          <p className="ft-empty">{t('Video is open over the whole window.')}</p>
          <button className="ghost bordered" onClick={() => toggleVideoFull(false)}>
            <Icon name="restore" size={13} />
            <span className="cta-label">{t('Back to the sidebar')}</span>
          </button>
        </div>
        {createPortal(
          <div className="vid-full" role="dialog" aria-modal="true" aria-label={t('Video')} ref={fullBox} tabIndex={-1}>
            <header className="vid-full-head" data-tauri-drag-region>
              <Icon name="film" size={16} />
              <b>{t('Video')}</b>
              {open && <span dir="auto">{open.title || open.request}</span>}
              <button className="sb-act" onClick={() => toggleVideoFull(false)}
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
              <main className="vid-full-stage">
                {open
                  ? <Stage t={t} video={open} seek={seek} onSeek={(i) => seekTo(open, i)} />
                  : <FullWelcome t={t} videos={videos} onOpen={setOpenId} />}
              </main>
            </div>
          </div>,
          document.body,
        )}
      </>
    );
  }
  return body;
}

// ── the full window's large side ──────────────────────────────────────────

/** The preview, large, with the scenes under it as a strip to jump through. */
function Stage({ t, video, seek, onSeek }: { t: T; video: Video; seek?: { frame: number; n: number }; onSeek: (i: number) => void }) {
  const job = jobs.get(video.id);
  const credits = creditsOf(video.scenes);
  return (
    <div className="vid-stage">
      {video.scenes.length
        ? (
          <Suspense fallback={<div className="vid-player is-wait"><span className="vid-spinner" aria-hidden="true" /></div>}>
            <Preview video={video} t={t} at={seek} maxBlock="62vh" />
          </Suspense>
        )
        : (
          <div className="vid-working">
            <span className="vid-spinner" aria-hidden="true" />
            <b>{job ? t('Planning the storyboard…') : t('No scenes yet')}</b>
            {job && <JobStatus t={t} video={video} job={job} />}
          </div>
        )}
      {video.scenes.length > 0 && (
        <ol className="vid-strip" aria-label={t('Scenes')}>
          {video.scenes.map((s, i) => (
            <li key={s.id}>
              <button type="button" onClick={() => onSeek(i)} title={gistOf(s)}>
                <span className="vid-strip-n">{i + 1}</span>
                <b>{kindName(s.kind, t)}</b>
                <span dir="auto">{gistOf(s) || '—'}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {credits.length > 0 && (
        <details className="vid-credits">
          <summary>{fill(t('Picture credits ({n})'), { n: credits.length })}</summary>
          <ul>{credits.map((c) => <li key={c} dir="auto">{c}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function FullWelcome({ t, videos, onOpen }: { t: T; videos: Video[]; onOpen: (id: string) => void }) {
  return (
    <div className="vid-welcome">
      <h2>{t('Describe a video')}</h2>
      <p>{t('Say what it is for, how long, and in which language. The model plans a storyboard from the scenes below; you edit every word, preview it, and export an MP4.')}</p>
      <div className="vid-welcome-grid">
        {SCENE_KINDS.map((k) => (
          <div key={k} className="vid-card">
            <b>{kindName(k, t)}</b>
            <span>{kindAbout(k, t)}</span>
          </div>
        ))}
      </div>
      {videos.length > 0 && (
        <>
          <h3>{t('Your videos')}</h3>
          <ul className="vid-list">{videos.map((v) => <VideoRow key={v.id} t={t} video={v} onOpen={() => onOpen(v.id)} />)}</ul>
        </>
      )}
    </div>
  );
}

// ── asking for a video ────────────────────────────────────────────────────

function Home({ t, lang, routes, efforts, plan, ready, videos, onOpen, onStart }: {
  t: T;
  lang: Lang;
  routes: Routes;
  efforts: EffortBook;
  plan: PlanSummary | null;
  ready: boolean;
  videos: Video[];
  onOpen: (id: string) => void;
  onStart: (v: Video) => void;
}) {
  const [request, setRequest] = useDraft('request');
  const [formatSet, setFormatSet] = useDraft('format');
  const [secondsSet, setSecondsSet] = useDraft('seconds');
  const [styleSet, setStyleSet] = useDraft('style');
  const [langSet, setLangSet] = useDraft('lang');
  const [set, putSet] = useDraft('set');
  const [more, setMore] = useDraft('more');
  const [brand, setBrandNow] = useState<Brand>(readBrand);
  const [brandUnkept, setBrandUnkept] = useState(false);

  const found = useMemo(() => ({
    format: formatIn(request), seconds: secondsIn(request), style: styleIn(request),
  }), [request]);
  const format: Format = formatSet ?? found.format ?? 'landscape';
  const seconds: number = secondsSet ?? found.seconds ?? 30;
  const style: Style = styleSet ?? found.style ?? 'modern';
  const vlang: VideoLang = langSet ?? videoLangOf(request, lang);
  const target = targetOf(set, routes);
  const book = bookFor(set, target, efforts);
  const chosen = choiceOf(set, routes) ?? routes.choice;
  const onPlan = chosen.provider !== BUILT_IN || allows(plan, target.model);
  const level = target.wire === 'anthropic' && effortsFor(target.model).length ? effortOf(book, target.model) : null;

  const setBrand = (b: Brand) => {
    setBrandNow(b);
    try { localStorage.setItem(BRAND_KEY, JSON.stringify(b)); setBrandUnkept(false); } catch { setBrandUnkept(true); }
  };

  const go = () => {
    if (!request.trim() || !ready || !onPlan) return;
    const v = newVideo({ id: newId(), now: Date.now(), request: request.trim(), lang: vlang, format, style, seconds, brand });
    onStart({ ...v, ...set, credits: v.credits ?? true });
    setRequest('');
    setFormatSet(null);
    setSecondsSet(null);
    setStyleSet(null);
    setLangSet(null);
  };

  // What the words switched on, and what is only the default, side by side.
  const chip = (icon: 'grid' | 'clock' | 'sparkle' | 'chat', label: string, by: 'you' | 'words' | 'default') => (
    <span className={`vid-chip ${by === 'default' ? '' : 'on'}`}
          title={by === 'you' ? t('Chosen by you') : by === 'words' ? t('Found in your request') : t('The default — say it, or choose below')}>
      <Icon name={by === 'default' ? icon : 'check'} size={11} />
      {label}
    </span>
  );
  const byOf = (setHere: unknown, fromWords: unknown) => (setHere !== null ? 'you' : fromWords !== null ? 'words' : 'default');
  const langBy = langSet !== null ? 'you' : request.trim() ? 'words' : 'default';

  const label = [
    (menuOf(routes.providers).find((m) => m.provider === chosen.provider && m.model === target.model)?.label) ?? modelName(target.model),
    level ? effortLabel(level, t) : '',
  ].filter(Boolean).join(' · ');

  return (
    <>
      <div className="vid-ask">
        <label className="vid-ask-label" htmlFor="vid-request">{t('What should the video say?')}</label>
        <textarea id="vid-request" className="vid-request" dir="auto" rows={4}
                  value={request} onChange={(e) => setRequest(e.target.value)}
                  placeholder={t('For example: a 30-second vertical promo for our dental clinic, in Arabic, calm and modern')}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); } }} />

        <div className="vid-chips" aria-label={t('What your request asks for')}>
          {chip('grid', formatName(format, t), byOf(formatSet, found.format))}
          {chip('clock', fill(t('{n} s'), { n: seconds }), byOf(secondsSet, found.seconds))}
          {chip('sparkle', styleName(style, t), byOf(styleSet, found.style))}
          {chip('chat', langName(vlang, t), langBy)}
        </div>

        <div className="vid-group">
          <span className="vid-group-label">{t('Shape')}</span>
          <FormatPicker t={t} value={format} onChange={setFormatSet} />
        </div>
        <div className="vid-group">
          <span className="vid-group-label">{t('Length')}</span>
          <LengthPicker t={t} value={seconds} onChange={setSecondsSet} />
        </div>
        <div className="vid-group">
          <span className="vid-group-label">{t('Style')}</span>
          <StylePicker t={t} value={style} onChange={setStyleSet} />
        </div>
        <div className="vid-group">
          <span className="vid-group-label">{t('Language of the words')}</span>
          <LangPicker t={t} value={vlang} onChange={setLangSet} />
        </div>

        <ModelSettings t={t} value={set} onChange={(v) => putSet({ ...draft.set, ...v })} routes={routes} efforts={efforts} plan={plan} />

        <button className="vid-more" onClick={() => setMore(!more)} aria-expanded={more}>
          <Icon name="chevron" size={11} />
          {brand.name || brand.logo || brand.primary ? fill(t('Brand: {name}'), { name: brand.name || t('your colours') }) : t('Brand')}
        </button>
        {more && <BrandFields t={t} value={brand} style={style} onChange={setBrand} />}
        {more && brandUnkept && <p className="vid-bad">{t('The brand could not be kept on this machine. It goes on this video only.')}</p>}

        {!onPlan && <p className="vid-warn vid-in">{fill(t('Your plan does not include {model}. Choose another model above.'), { model: modelName(target.model) })}</p>}
        <button className="sb-cta-go vid-go" disabled={!request.trim() || !ready || !onPlan} onClick={go}>
          <Icon name="film" size={13} />
          {fill(t('Make it with {model}'), { model: label })}
        </button>
        <p className="vid-note">{t('The model writes a storyboard — words and timings only. The pictures are openly licensed and credited; you check everything before you export.')}</p>
      </div>

      {videos.length > 0 && (
        <>
          <div className="sb-sub">{t('Your videos')}</div>
          <ul className="vid-list">{videos.map((v) => <VideoRow key={v.id} t={t} video={v} onOpen={() => onOpen(v.id)} />)}</ul>
        </>
      )}
    </>
  );
}

function VideoRow({ t, video, onOpen }: { t: T; video: Video; onOpen: () => void }) {
  const job = jobs.get(video.id);
  const out = outs.get(video.id);
  return (
    <li>
      <button className="vid-row" onClick={onOpen}>
        <span className={`vid-dot ${job || out ? 'is-live' : video.error ? 'is-bad' : video.stage === 'ready' ? 'is-done' : ''}`} aria-hidden="true" />
        <span className="vid-row-what">
          <b dir="auto">{video.title || video.request}</b>
          <span>
            {formatName(video.format, t)}
            {' · '}
            {out ? t('Exporting')
              : job ? (job.stage === 'planning' ? t('Planning') : t('Finding pictures'))
              : video.scenes.length ? fill(t('{n} scenes · {s} s'), { n: video.scenes.length, s: Math.round(lengthOf(video)) })
              : t('Not planned')}
            {' · '}
            {whenOf(video.created)}
          </span>
        </span>
      </button>
    </li>
  );
}

// ── one video ─────────────────────────────────────────────────────────────

type Tab = 'scenes' | 'look' | 'details';

function VideoView({ t, video, routes, efforts, plan, ready, inFull, seek, onSeek, onBack, begin, onError }: {
  t: T;
  video: Video;
  routes: Routes;
  efforts: EffortBook;
  plan: PlanSummary | null;
  ready: boolean;
  inFull: boolean;
  seek?: { frame: number; n: number };
  onSeek: (index: number) => void;
  onBack: () => void;
  begin: (v: Video, work: Work) => void;
  onError: (m: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('scenes');
  // Asked once a video: a webview too old to encode says so here, before the
  // person has chosen where to save a file that could never be written.
  const [can, setCan] = useState<{ ok: boolean; why?: string } | null>(null);
  useEffect(() => {
    let live = true;
    canExport(video).then((c) => { if (live) setCan(c); }, () => { if (live) setCan(null); });
    return () => { live = false; };
  }, [video.id, video.format]); // eslint-disable-line react-hooks/exhaustive-deps
  const job = jobs.get(video.id);
  const out = outs.get(video.id);
  const saved = savedTo.get(video.id);
  const busy = !!job;
  const change = (next: Partial<Video>) => update(video.id, (v) => ({ ...v, ...next }));
  const missing = video.scenes.filter((s) => s.imageQuery && !s.picture && PICTURED.has(s.kind)).length;
  const credits = creditsOf(video.scenes);
  const target = targetOf(video, routes);
  const level = effortOf(bookFor(video, target, efforts), target.model);

  const exportIt = async () => {
    if (outs.has(video.id) || jobs.has(video.id) || !video.scenes.length) return;
    // What is exported is the video as it is now, on screen: the press is the approval.
    const v = video;
    try {
      const can = await canExport(v);
      if (!can.ok) {
        onError(can.why ? fill(t('The video cannot be rendered here: {why}'), { why: can.why }) : t('This computer cannot render the video here.'));
        return;
      }
      const path = await savePanel({ title: t('Export MP4'), defaultPath: videoFileName(v), filters: [{ name: 'MP4', extensions: ['mp4'] }] });
      if (!path) return;
      const o: Out = { ctl: new AbortController(), phase: 'render', fraction: 0, started: Date.now() };
      outs.set(v.id, o);
      savedTo.delete(v.id);
      notify();
      try {
        const bytes = await renderVideo(v, {
          signal: o.ctl.signal,
          onProgress: (fraction, eta) => { o.fraction = fraction; o.eta = eta; notifySoon(); },
        });
        if (o.ctl.signal.aborted) return;
        o.phase = 'write';
        notify();
        await writeVideoFile(path, bytes);
        savedTo.set(v.id, path);
      } finally {
        outs.delete(v.id);
        notify();
      }
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return;
      onError(explain(e, t('export the video')));
    }
  };

  const remove = async () => {
    const yes = await ask.confirm({
      title: t('Delete this video?'),
      body: `${video.title || video.request}\n\n${t('Its storyboard and pictures are removed from this machine. An MP4 you exported is not touched.')}`,
      confirmLabel: t('Delete'),
      danger: true,
    });
    if (!yes) return;
    gone.add(video.id);
    stop(video.id);
    outs.get(video.id)?.ctl.abort();
    known.delete(video.id);
    savedTo.delete(video.id);
    void deleteVideo(video.id);
    notify();
    onBack();
  };

  const redo = async (id: string) => {
    const i = video.scenes.findIndex((s) => s.id === id);
    const how = await ask.text({
      title: fill(t('Redo scene {n}'), { n: i + 1 }),
      value: '',
      placeholder: t('What should change? For example: shorter, and about the opening hours'),
      confirmLabel: t('Redo'),
      optional: true,
    });
    if (how === null) return;
    begin(video, { how: 'scene', id, instruction: how.trim() });
  };

  const replan = async () => {
    if (video.scenes.length) {
      const yes = await ask.confirm({
        title: t('Plan the storyboard again?'),
        body: t('The scenes you have now, and your changes to them, are replaced by a new storyboard.'),
        confirmLabel: t('Plan again'),
        danger: true,
      });
      if (!yes) return;
    }
    begin(video, { how: 'plan' });
  };

  const add = (kind: SceneKind) => {
    const s = blankScene(kind, video, newId);
    const scenes = [...video.scenes];
    // Before the close, which should stay last.
    const at = scenes.length && scenes[scenes.length - 1].kind === 'outro' ? scenes.length - 1 : scenes.length;
    scenes.splice(at, 0, s);
    change({ scenes });
  };

  const ORDER = ['planning', 'pictures', 'ready'] as const;
  const now = job ? (job.stage === 'planning' ? 'planning' : 'pictures') : video.scenes.length ? 'ready' : 'new';
  const at = now === 'new' ? -1 : ORDER.indexOf(now);

  return (
    <div className="vid-view">
      <div className="vid-top">
        <button className="sb-act vid-back" onClick={onBack} title={t('Back')} aria-label={t('Back')}>
          <Icon name="chevron" size={14} />
        </button>
        <div className="vid-title">
          <b dir="auto">{video.title || video.request}</b>
          <span>{formatName(video.format, t)} · {styleName(video.style, t)} · {langName(video.lang, t)}{video.scenes.length ? ` · ${fill(t('{n} s'), { n: Math.round(lengthOf(video)) })}` : ''}</span>
        </div>
        {!inFull && (
          <button className="sb-act" onClick={() => toggleVideoFull(true)} title={t('Full screen')} aria-label={t('Full screen')}>
            <Icon name="maximise" size={14} />
          </button>
        )}
        <button className="sb-act" onClick={() => void remove()} title={t('Delete this video')} aria-label={t('Delete this video')}>
          <Icon name="close" size={14} />
        </button>
      </div>

      <ol className="vid-steps" aria-label={t('Progress')}>
        {ORDER.map((s, i) => {
          const state = i < at || (!job && video.scenes.length) ? 'is-done' : i === at && busy ? 'is-live' : '';
          return (
            <li key={s} className={state}>
              <i aria-hidden="true" />
              {s === 'planning' ? t('Storyboard') : s === 'pictures' ? t('Pictures') : t('Ready to export')}
            </li>
          );
        })}
      </ol>

      {job && <JobStatus t={t} video={video} job={job} />}
      {!job && video.error && <p className="vid-bad vid-pad">{errorText(video.error, t)}</p>}

      {!inFull && video.scenes.length > 0 && (
        <Suspense fallback={<div className="vid-player is-wait"><span className="vid-spinner" aria-hidden="true" /></div>}>
          <Preview video={video} t={t} at={seek} maxBlock="46vh" />
        </Suspense>
      )}
      {!video.scenes.length && !job && (
        <div className="vid-acts">
          <button className="sb-cta-go" disabled={!ready} onClick={() => begin(video, { how: 'plan' })}>
            <Icon name="play" size={12} />{video.error ? t('Try again') : t('Plan the storyboard')}
          </button>
        </div>
      )}

      {video.scenes.length > 0 && (
        <div className="vid-acts">
          {job
            ? (
              <button className="ghost" onClick={() => stop(video.id)}>
                <Icon name="stop" size={12} />{t('Stop now')}
              </button>
            )
            : out
              ? (
                <button className="ghost" onClick={() => out.ctl.abort()}>
                  <Icon name="stop" size={12} />{t('Cancel')}
                </button>
              )
              : (
                <button className="sb-cta-go vid-export-go" onClick={() => void exportIt()} disabled={can?.ok === false}
                        title={can?.ok === false && can.why ? can.why : t('Renders the video on this computer and saves it where you choose.')}>
                  <Icon name="film" size={12} />{t('Export MP4…')}
                </button>
              )}
          {!job && !out && missing > 0 && (
            <button className="ghost" disabled={!ready} onClick={() => begin(video, { how: 'pictures' })}>
              <Icon name="image" size={12} />{fill(t('Find {n} missing pictures'), { n: missing })}
            </button>
          )}
        </div>
      )}
      {!out && can?.ok === false && (
        <p className="vid-bad vid-pad" dir="auto">
          {can.why ? fill(t('The video cannot be rendered here: {why}'), { why: can.why }) : t('This computer cannot render the video here.')}
        </p>
      )}
      {out && <ExportStatus t={t} out={out} />}
      {saved && !out && (
        <div className="vid-saved-row">
          <p className="vid-saved" dir="auto">{fill(t('Saved to {path}'), { path: saved })}</p>
          <button className="ghost" onClick={() => invoke('reveal_path', { path: saved }).catch((e: unknown) => onError(explain(e, t('show the file'))))}>
            <Icon name="folder" size={12} />{IS_MAC ? t('Show in Finder') : t('Show in Explorer')}
          </button>
        </div>
      )}

      {video.scenes.length > 0 && (
        <>
          <div className="vid-tabs" role="tablist">
            {(['scenes', 'look', 'details'] as const).map((x) => (
              <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>
                {x === 'scenes' ? fill(t('Scenes ({n})'), { n: video.scenes.length }) : x === 'look' ? t('Look') : t('Details')}
              </button>
            ))}
          </div>

          {tab === 'scenes' && (
            <Storyboard t={t} video={video} redoingId={job?.how === 'scene' ? job.sceneId : undefined} locked={busy || !ready}
                        onScenes={(scenes) => change({ scenes })} onRedo={(id) => void redo(id)} onSeek={onSeek} onAdd={add} onError={onError} />
          )}
          {tab === 'look' && (
            <div className="vid-look">
              <label className="vid-f vid-pad">
                <span>{t('Title of the video')}</span>
                <input value={video.title} dir="auto" onChange={(e) => change({ title: e.target.value })} />
              </label>
              <div className="vid-group vid-pad">
                <span className="vid-group-label">{t('Shape')}</span>
                <FormatPicker t={t} value={video.format} onChange={(format) => change({ format })} />
              </div>
              <div className="vid-group vid-pad">
                <span className="vid-group-label">{t('Style')}</span>
                <StylePicker t={t} value={video.style} onChange={(style) => change({ style })} />
              </div>
              <div className="vid-group vid-pad">
                <span className="vid-group-label">{t('Brand')}</span>
                <BrandFields t={t} value={video.brand} style={video.style} onChange={(brand) => change({ brand })} />
              </div>
              <label className="vid-check vid-pad">
                <input type="checkbox" checked={video.credits !== false} onChange={(e) => change({ credits: e.target.checked })} />
                <span>{t('End with a card crediting the pictures (their licences ask for it)')}</span>
              </label>
            </div>
          )}
          {tab === 'details' && (
            <div className="vid-look">
              <div className="vid-f vid-pad">
                <span>{t('What you asked for')}</span>
                <p className="vid-asked" dir="auto">{video.request}</p>
              </div>
              <div className="vid-pad">
                <ModelSettings t={t} value={video} onChange={(v) => change(v)} routes={routes} efforts={efforts} plan={plan} disabled={busy} />
              </div>
              <p className="vid-note vid-pad">
                {isRtl(video.lang) ? t('The words run right to left, in a typeface that has every Kurdish and Arabic letter.') : t('The words run left to right.')}
              </p>
              <div className="vid-acts">
                <button className="ghost" disabled={busy || !ready} onClick={() => void replan()}>
                  <Icon name="sparkle" size={12} />{t('Plan the storyboard again…')}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <div className="vid-honest">
        <p><Icon name="image" size={12} />{credits.length
          ? fill(t('{n} pictures, all openly licensed (CC0, public domain, CC BY or CC BY-SA), credited at the end of the video.'), { n: credits.length })
          : t('Pictures come only from openly licensed collections, and each is credited at the end of the video.')}</p>
        <p><Icon name="warning" size={12} />{t('The words were written by an AI model. Read every line — and check every name, number and claim — before you publish it.')}</p>
        <p className="vid-model">
          {fill(t('Planned with {model}.'), { model: modelName(video.model ?? target.model) })}
          {level ? ` · ${effortLabel(level, t)}` : ''}
        </p>
      </div>
    </div>
  );
}
