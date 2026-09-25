import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  FPS, SCENE_KINDS, type Brand, type Format, type Scene, type SceneKind, type Style, type Video, type VideoLang,
} from './videotypes';
import {
  LENGTHS, TRANSITION_FRAMES, blankScene, durationInFrames, formatIn, isRtl, newVideo, parsePlan, parseScene,
  planPrompt, sceneFrames, scenePrompt, secondsIn, styleIn, videoLangOf,
} from './video';
import { deleteVideo, loadVideos, saveVideo } from './videostore';
import { creditsOf, fillPictures, needsPictures, picturesOf, withPicturesOf } from './videomedia';
import { factsBlock, placeBriefPictures, researchVideo, wantsLookup, type Ask } from './videoresearch';
import { STYLE_SWATCH } from './VideoScenes';
import { PICTURED, Storyboard, WatermarkSwitch, kindAbout, kindName } from './VideoStoryboard';
import { VideoFacts } from './VideoFacts';
import { VideoSound } from './VideoSound';
import { RowDownload, VideoDownloads, forgetDownloads, useDownloading } from './VideoDownloads';
import { UndoRedo, VideoTimeline, selectScene, useVideoKeys } from './VideoTimeline';
import { videoHistory } from './videohistory';
import { TEMPLATES, sampleOf, sampleVideo, templateAbout, templateName, type Template } from './videotemplates';
import { brandFromLogo, paletteOfImage, type Swatch } from './videopalette';

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
 * nothing it wrote reaches a file except through a download the person
 * presses — **Download MP4** into their Downloads folder under a name that
 * never replaces a file, or **Save as…** at a path they choose — rendering
 * what is on screen at that moment (VideoDownloads.tsx). That is SAFETY.md's
 * rule, kept here.
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
  /** Looking the subject up on the web, before the storyboard is asked for (videoresearch.ts). */
  looking?: boolean;
}

const jobs = new Map<string, Job>();
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

/** The pictures a search found for a scene — its own, a gallery's, each person's — written into its newest copy. */
const putFound = (id: string, found: Scene) => {
  const now = known.get(id)?.scenes.find((s) => s.id === found.id);
  if (!now || withPicturesOf(now, found) === now) return;
  update(id, (v) => ({ ...v, scenes: v.scenes.map((s) => (s.id === found.id ? withPicturesOf(s, found) : s)) }));
};

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
  // A gallery's pictures and each person's portrait are searched for too (videomedia's needsPictures).
  const want = v.scenes.filter((s) => (s.kind === 'gallery' || s.kind === 'people' || PICTURED.has(s.kind)) && needsPictures(s) && (!only || s.id === only));
  job.stage = only ? 'scene' : 'pictures';
  job.pics = { done: 0, of: want.length };
  notify();
  if (!want.length) return;
  // The scenes that already have a picture go too, and are skipped: they are
  // what keeps the same photograph from being chosen for two scenes.
  const got = await fillPictures(v.scenes.filter((s) => picturesOf(s).length > 0 || want.includes(s)), {
    format: v.format,
    signal: job.ctl.signal,
    onScene: (_i, scene) => {
      job.pics.done = Math.min(job.pics.of, job.pics.done + 1);
      putFound(id, scene);
      notifySoon();
    },
  });
  for (const s of got) putFound(id, s);
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
      // Look the subject up first — once a video; the Facts tab looks it up
      // again on request. What it finds is a note, never a failure: a lookup
      // that finds nothing, or fails, leaves the plan to go on without it.
      const asked = known.get(id) ?? v;
      if (wantsLookup(asked)) {
        job.looking = true;
        notify();
        // Small requests on the same route, at low effort: naming the subject,
        // and (Anthropic wire) the model's own web search.
        const quick: Ask = (q) => generate(gw, {
          system: q.system, user: q.user, maxTokens: q.maxTokens, tools: q.tools,
          efforts: { ...efforts, [gw.model]: 'low' }, signal: q.signal ?? ctl.signal,
        }).then((r) => r.text);
        try {
          const brief = await researchVideo(asked.request, {
            lang: asked.lang, format: asked.format, signal: ctl.signal, ask: quick,
            webSearch: gw.wire === 'anthropic' ? { ask: quick, key: `${gw.baseUrl} ${gw.model}` } : null,
          });
          update(id, (x) => ({ ...x, brief }));
        } catch (e) {
          if (ctl.signal.aborted || (e as { name?: string })?.name === 'AbortError') throw e;
        }
        job.looking = false;
        notify();
      }
      const before = known.get(id) ?? v;
      const p = planPrompt(before, {
        facts: before.lookup !== false ? factsBlock(before.brief) : undefined,
        narration: !!before.audio?.narrate,
      });
      const out = await call(p.system, p.user, 8000);
      const cur = known.get(id) ?? v;
      const plan = parsePlan(out.text, cur, newId);
      if (!plan || !plan.scenes.length) throw new Error(UNREADABLE_PLAN);
      // The subject's own pictures go in first; the search fills what is left.
      const scenes = cur.lookup !== false ? placeBriefPictures(plan.scenes, cur.brief, cur.format) : plan.scenes;
      keep({ ...cur, title: plan.title || cur.title, scenes, stage: 'pictures', updated: Date.now() });
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
  /** Look the subject up on the web before planning (videoresearch.ts). */
  lookup: boolean;
}

const draft: Draft = { request: '', format: null, seconds: null, style: null, lang: null, set: {}, more: false, lookup: true };

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
  // The logo's own colours, read on this machine (videopalette.ts) and offered —
  // never put in place of colours the person chose until they press for it.
  const [swatches, setSwatches] = useState<Swatch[] | null>(null);
  useEffect(() => {
    if (!value.logo) { setSwatches(null); return; }
    let live = true;
    paletteOfImage(value.logo).then((x) => { if (live) setSwatches(x); }, () => { if (live) setSwatches(null); });
    return () => { live = false; };
  }, [value.logo]);
  const offer = swatches ? brandFromLogo(swatches, sw.bg) : null;
  const inUse = !!offer && value.primary?.toUpperCase() === offer.primary && value.accent?.toUpperCase() === offer.accent;
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
      {offer && (
        <div className="vid-tpl-palette vid-wide">
          <span className="vid-tpl-dots" aria-hidden="true">
            <i style={{ background: offer.primary }} title={offer.primary} />
            {offer.accent && <i style={{ background: offer.accent }} title={offer.accent} />}
          </span>
          <span className="vid-tpl-palette-what">
            <b>{t('Colours from the logo')}</b>
            {offer.adjusted && <span>{t('Made lighter or darker where needed, so they read on this style’s background.')}</span>}
          </span>
          {inUse
            ? <small className="vid-tpl-inuse"><Icon name="check" size={11} />{t('In use')}</small>
            : (
              <button type="button" className="ghost" disabled={disabled}
                      onClick={() => onChange({ ...value, primary: offer.primary, accent: offer.accent })}>
                {t('Use the logo’s colours')}
              </button>
            )}
        </div>
      )}
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
    line = job.looking ? t('Looking it up on the web…') : job.chars ? t('Writing the storyboard…') : `${thinkingVerb(elapsed, t)}…`;
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
      {/* The timeline is the way through the scenes here: click, drag, resize (VideoTimeline.tsx). */}
      {video.scenes.length > 0 && (
        <VideoTimeline t={t} video={video} onScenes={(scenes) => edit(video.id, { scenes })} onSeek={onSeek} locked={!!job} wide />
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
  const [lookup, setLookup] = useDraft('lookup');
  const [brand, setBrandNow] = useState<Brand>(readBrand);
  const [brandUnkept, setBrandUnkept] = useState(false);
  const [picked, setPicked] = useState<Template['id'] | null>(null);

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
    onStart({ ...v, ...set, credits: v.credits ?? true, lookup });
    setRequest('');
    setFormatSet(null);
    setSecondsSet(null);
    setStyleSet(null);
    setLangSet(null);
    setPicked(null);
  };

  // A template fills the form in the interface's language; nothing is asked of a model until "Make it".
  const pickTemplate = (tpl: Template) => {
    const text = tpl.request[lang] ?? tpl.request.en;
    setRequest(text);
    setFormatSet(tpl.format);
    setSecondsSet(tpl.seconds);
    setStyleSet(tpl.style);
    // Sorani and Badini are told apart by a few words, and a short request may not have them.
    if (langSet === null && videoLangOf(text, lang) !== lang) setLangSet(lang);
    setPicked(tpl.id);
    requestAnimationFrame(() => document.getElementById('vid-request')?.focus());
  };
  // A sample storyboard, opened at once: placeholder words to see and edit, no model asked.
  const openSample = (tpl: Template) => {
    const v = sampleVideo(tpl, { now: Date.now(), lang: vlang, request: request.trim() || (tpl.request[lang] ?? tpl.request.en), brand, newId });
    keep({ ...v, ...set });
    setPicked(null);
    onOpen(v.id);
  };
  const pickedTpl = picked ? TEMPLATES.find((x) => x.id === picked) ?? null : null;

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
          <span className="vid-group-label">{t('Start from a template')}</span>
          <div className="vid-tpl-row" role="group" aria-label={t('Start from a template')}>
            {TEMPLATES.map((tpl) => {
              const sw = STYLE_SWATCH[tpl.style];
              return (
                <button key={tpl.id} type="button" className={`vid-tpl-card ${picked === tpl.id ? 'on' : ''}`} aria-pressed={picked === tpl.id}
                        onClick={() => pickTemplate(tpl)} title={templateAbout(tpl.id, t)}>
                  <span className="vid-tpl-thumb" style={{ background: sw.bg, color: sw.accent }} aria-hidden="true">
                    <i className={tpl.format === 'portrait' ? 'vid-tpl-frame is-portrait' : tpl.format === 'square' ? 'vid-tpl-frame is-square' : 'vid-tpl-frame is-landscape'} />
                    <Icon name={tpl.icon} size={14} />
                  </span>
                  <b>{templateName(tpl.id, t)}</b>
                  <small>{formatName(tpl.format, t)} · {fill(t('{n} s'), { n: tpl.seconds })}</small>
                </button>
              );
            })}
          </div>
          {pickedTpl && (
            <div className="vid-tpl-picked">
              <span>{templateAbout(pickedTpl.id, t)} {t('Change any word above, then make it — or see a sample first.')}</span>
              <button type="button" className="ghost" onClick={() => openSample(pickedTpl)}>
                <Icon name="play" size={11} />{t('Open a sample storyboard')}
              </button>
              <small>{t('Placeholder words, ready to preview and edit. No model is asked.')}</small>
            </div>
          )}
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

        <label className="vid-check vid-facts-ask">
          <input type="checkbox" checked={lookup} onChange={(e) => setLookup(e.target.checked)} />
          <span>
            {t('Look the subject up on the web first')}
            <small>{t('Real facts, photographs and the logo from Wikipedia, Wikidata and Wikimedia Commons, given to the model before it plans. You see and check every one under “Found on the web”.')}</small>
          </span>
        </label>

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
  const out = useDownloading(video.id);
  return (
    <li className="vid-dl-li">
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
      <RowDownload t={t} video={video} locked={!!job} />
    </li>
  );
}

// ── one video ─────────────────────────────────────────────────────────────

type Tab = 'scenes' | 'look' | 'sound' | 'facts' | 'details';

/**
 * A change the person made by hand: kept, and remembered for undo
 * (videohistory.ts). A run's own changes — a plan, a scene written again, a
 * picture fetched — go through `update` and are not; the history notices
 * them and starts again from what they left, so an undo never fights one.
 */
function edit(id: string, next: Partial<Video>) {
  const before = known.get(id);
  if (!before) return;
  update(id, (v) => ({ ...v, ...next }));
  const after = known.get(id);
  if (after && after !== before) videoHistory.record(id, before, after);
}

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
  const job = jobs.get(video.id);
  // Rendering and saving, and whether this window can, live in VideoDownloads.
  const out = useDownloading(video.id);
  const busy = !!job;
  // Every change made here by hand is remembered for undo; a run's own changes are not (see `edit`).
  const change = (next: Partial<Video>) => edit(video.id, next);
  const undo = () => {
    if (jobs.has(video.id)) return;
    const back = videoHistory.undo(video.id, known.get(video.id) ?? video);
    if (back) update(video.id, (v) => ({ ...v, ...back }));
  };
  const redoEdit = () => {
    if (jobs.has(video.id)) return;
    const again = videoHistory.redo(video.id, known.get(video.id) ?? video);
    if (again) update(video.id, (v) => ({ ...v, ...again }));
  };
  const viewRef = useRef<HTMLDivElement>(null);
  const seekScene = (i: number) => { selectScene(video.id, video.scenes[i]?.id ?? null); onSeek(i); };
  useVideoKeys({ video, scope: viewRef, locked: busy, onScenes: (scenes) => change({ scenes }), onSeek: seekScene, onUndo: undo, onRedo: redoEdit });
  const sample = sampleOf(video);
  // Montages and people count too: videomedia's needsPictures is the same test the search runs.
  const missing = video.scenes.filter((s) => (s.kind === 'gallery' || s.kind === 'people' || PICTURED.has(s.kind)) && needsPictures(s)).length;
  const credits = creditsOf(video.scenes);
  const target = targetOf(video, routes);
  const level = effortOf(bookFor(video, target, efforts), target.model);

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
    forgetDownloads(video.id);
    videoHistory.forget(video.id);
    known.delete(video.id);
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
    // Focusable, so a click anywhere in the video's view puts its keys (Space, the arrows) to work.
    <div className="vid-view vid-tl-scope" ref={viewRef} tabIndex={-1}>
      <div className="vid-top">
        <button className="sb-act vid-back" onClick={onBack} title={t('Back')} aria-label={t('Back')}>
          <Icon name="chevron" size={14} />
        </button>
        <div className="vid-title">
          <b dir="auto">{video.title || video.request}</b>
          <span>{formatName(video.format, t)} · {styleName(video.style, t)} · {langName(video.lang, t)}{video.scenes.length ? ` · ${fill(t('{n} s'), { n: Math.round(lengthOf(video)) })}` : ''}</span>
        </div>
        {video.scenes.length > 0 && (
          <UndoRedo t={t} canUndo={!busy && videoHistory.canUndo(video.id, video)} canRedo={!busy && videoHistory.canRedo(video.id, video)}
                    onUndo={undo} onRedo={redoEdit} />
        )}
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
      {sample && !job && (
        <div className="vid-tpl-sample" role="note">
          <Icon name="sparkle" size={13} />
          <span className="vid-tpl-sample-what">
            <b>{fill(t('A sample from “{name}”'), { name: templateName(sample.id, t) })}</b>
            <span>{t('Placeholder words that show the shape of the video — no model has written anything yet. Change every line, or have the model plan it from your request.')}</span>
          </span>
          <button className="ghost" disabled={!ready} onClick={() => void replan()}>
            <Icon name="sparkle" size={12} />{t('Plan it with the model')}
          </button>
        </div>
      )}

      {!inFull && video.scenes.length > 0 && (
        <Suspense fallback={<div className="vid-player is-wait"><span className="vid-spinner" aria-hidden="true" /></div>}>
          <Preview video={video} t={t} at={seek} maxBlock="46vh" />
        </Suspense>
      )}
      {!inFull && video.scenes.length > 0 && (
        <VideoTimeline t={t} video={video} onScenes={(scenes) => change({ scenes })} onSeek={seekScene} locked={busy} />
      )}
      {!video.scenes.length && !job && (
        <div className="vid-acts">
          <button className="sb-cta-go" disabled={!ready} onClick={() => begin(video, { how: 'plan' })}>
            <Icon name="play" size={12} />{video.error ? t('Try again') : t('Plan the storyboard')}
          </button>
        </div>
      )}

      {/* Download MP4 and every other way to take the video away, with the
          progress, Cancel and "Saved to …" — one primary action, in VideoDownloads. */}
      {video.scenes.length > 0 && <VideoDownloads t={t} video={video} locked={busy} onError={onError} />}
      {video.scenes.length > 0 && (job || (!out && missing > 0)) && (
        <div className="vid-acts">
          {job && (
            <button className="ghost" onClick={() => stop(video.id)}>
              <Icon name="stop" size={12} />{t('Stop now')}
            </button>
          )}
          {!job && !out && missing > 0 && (
            <button className="ghost" disabled={!ready} onClick={() => begin(video, { how: 'pictures' })}>
              <Icon name="image" size={12} />{fill(t('Find {n} missing pictures'), { n: missing })}
            </button>
          )}
        </div>
      )}

      {video.scenes.length > 0 && (
        <>
          <div className="vid-tabs" role="tablist">
            {(['scenes', 'look', 'sound', 'facts', 'details'] as const).map((x) => (
              <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>
                {x === 'scenes' ? fill(t('Scenes ({n})'), { n: video.scenes.length })
                  : x === 'look' ? t('Look') : x === 'sound' ? t('Sound') : x === 'facts' ? t('Found on the web') : t('Details')}
              </button>
            ))}
          </div>

          {tab === 'scenes' && (
            <Storyboard t={t} video={video} redoingId={job?.how === 'scene' ? job.sceneId : undefined} locked={busy || !ready}
                        onScenes={(scenes) => change({ scenes })} onRedo={(id) => void redo(id)} onSeek={seekScene} onAdd={add} onError={onError} />
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
                <WatermarkSwitch t={t} video={video} onChange={(watermark) => change({ watermark })} />
              </div>
              <label className="vid-check vid-pad">
                <input type="checkbox" checked={video.credits !== false} onChange={(e) => change({ credits: e.target.checked })} />
                <span>{t('End with a card crediting the pictures (their licences ask for it)')}</span>
              </label>
            </div>
          )}
          {tab === 'sound' && (
            <VideoSound t={t} video={video} onChange={change} locked={busy} providers={routes.providers} onError={onError}
                        target={target} efforts={bookFor(video, target, efforts)} />
          )}
          {tab === 'facts' && <VideoFacts t={t} video={video} onChange={change} locked={busy} onError={onError} />}
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
        <p><Icon name="warning" size={12} />{sample
          ? t('The words are a template’s placeholders. Replace every one — and check every name, number and claim — before you publish it.')
          : t('The words were written by an AI model. Read every line — and check every name, number and claim — before you publish it.')}</p>
        {!sample && (
          <p className="vid-model">
            {fill(t('Planned with {model}.'), { model: modelName(video.model ?? target.model) })}
            {level ? ` · ${effortLabel(level, t)}` : ''}
          </p>
        )}
      </div>
    </div>
  );
}
