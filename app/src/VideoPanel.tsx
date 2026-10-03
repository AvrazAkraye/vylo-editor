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
  FPS, type Brand, type Format, type LookSettings, type Scene, type SceneKind, type Style, type Video, type VideoDesign, type VideoLang,
} from './videotypes';
import { FONT_CHOICES, LOOK_LIMITS, lookFor, normalLook } from './videolook';
import {
  LENGTHS, TRANSITION_FRAMES, artPrompt, blankScene, designPrompt, durationInFrames, formatIn, isRtl, newVideo, parseArt, parsePlan, parseScene,
  linksBlock, planPrompt, sceneFrames, scenePrompt, secondsIn, styleIn, videoLangOf,
} from './video';
import { gatherLinks } from './videolinks';
import { BUILT_IN as DIRECTIONS_BUILT_IN, directionOf, loadDirections, saveDirections, type Direction } from './videodirections';
import { linksIn } from './videolink';
import { designIn } from './videodesign';
import { deleteVideo, loadVideos, saveVideo } from './videostore';
import { creditsOf, fillPictures, needsPictures, picturesOf, withPicturesOf } from './videomedia';
import { factsBlock, placeBriefPictures, researchVideo, wantsLookup, withSiteLogo, type Ask } from './videoresearch';
import { STYLE_SWATCH } from './VideoScenes';
import {
  AlignPicker, LookColour, LookSlider, Storyboard, WatermarkSwitch, cornerName, fontName, kindAbout, kindName, lookValueName, wantsPicture,
} from './VideoStoryboard';
import { VideoFacts } from './VideoFacts';
import { VideoSound } from './VideoSound';
import { VideoChat } from './VideoChat';
import { VideoHome } from './VideoHome';
import { RowDownload, VideoDownloads, forgetDownloads, useDownloading } from './VideoDownloads';
import { UndoRedo, VideoTimeline, selectScene, useVideoKeys } from './VideoTimeline';
import { videoHistory } from './videohistory';
import { TEMPLATES, sampleOf, sampleVideo, templateAbout, templateName, type Template } from './videotemplates';
import { brandFromLogo, paletteOfImage, type Swatch } from './videopalette';
import { locale, dateText } from './fmt';

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
 * components draw it (VideoScenes.tsx). The model is the video's art director
 * too — how each scene's words arrive, what is behind them, how the frame
 * moves (`art`), and while `ai` is on the whole look: five colours, a
 * typeface, a motif and a pace (`design`, read by videodesign.ts). Every one
 * of those is a word from a fixed list or a checked colour, so directing the
 * art is choosing, never writing code. Restyle asks for the art again with
 * the words untouched, and lands as one edit, so one undo takes it back.
 *
 * Nothing the model wrote is run, and nothing it wrote reaches a file except
 * through a download the person presses — **Download MP4** into their
 * Downloads folder under a name that never replaces a file, or **Save as…**
 * at a path they choose — rendering what is on screen at that moment
 * (VideoDownloads.tsx). That is SAFETY.md's rule, kept here.
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
  | { how: 'pictures' }
  /** A look designed by the model — a first one, or "Design again" for a different one. */
  | { how: 'design' }
  /** Restyle: the model art-directs every scene again, its words untouched. */
  | { how: 'art' };

interface Job {
  ctl: AbortController;
  how: Work['how'];
  /** What it is doing now. */
  stage: 'planning' | 'pictures' | 'scene' | 'design' | 'art';
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
  /** Following a link in the request: reading a page or downloading a video (videolinks.ts). */
  linking?: 'page' | 'video';
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
const UNREADABLE_DESIGN = 'video:unreadable-design';
const UNREADABLE_ART = 'video:unreadable-art';

/**
 * Fetch the pictures the scenes asked for and have not got, one at a time,
 * each kept as it arrives — a scene edited meanwhile keeps its edit, because
 * only the picture is written into it, by the scene's id. `only` is one scene
 * (a scene written again) or a few (the photos a restyle put behind words).
 */
async function picturesFor(id: string, job: Job, only?: string | ReadonlySet<string>) {
  const v = known.get(id);
  if (!v) return;
  const mine = (s: Scene) => !only || (typeof only === 'string' ? s.id === only : only.has(s.id));
  // A gallery's pictures and each person's portrait are searched for too
  // (videomedia's needsPictures), and so is the photo a scene's art direction
  // puts behind its words.
  const want = v.scenes.filter((s) => (s.kind === 'gallery' || s.kind === 'people' || wantsPicture(s)) && needsPictures(s) && mine(s));
  job.stage = typeof only === 'string' ? 'scene' : 'pictures';
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
    ctl, how: work.how,
    stage: work.how === 'plan' ? 'planning' : work.how === 'scene' ? 'scene' : work.how === 'design' ? 'design' : work.how === 'art' ? 'art' : 'pictures',
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
      // The links in the request first — once a video: a page's words and
      // pictures, a video's clip (videolinks.ts). A link that fails is kept
      // with its reason and the plan goes on without it.
      const linked = known.get(id) ?? v;
      if (linksIn(linked.request).length && !linked.links?.length) {
        const got = await gatherLinks(linked.request, { signal: ctl.signal, onStep: (_url, what) => { job.linking = what; notify(); } });
        job.linking = undefined;
        if (ctl.signal.aborted) throw new DOMException('Stopped', 'AbortError');
        update(id, (x) => ({
          ...x,
          links: got.links,
          clips: [...(x.clips ?? []), ...got.clips],
          ...(got.pictures.length
            ? { brief: { ...(x.brief ?? { subjects: [], facts: [], pictures: [], at: Date.now() }), pictures: [...got.pictures, ...(x.brief?.pictures ?? [])].slice(0, 16) } }
            : {}),
        }));
        notify();
      }
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
          const found = await researchVideo(asked.request, {
            lang: asked.lang, format: asked.format, signal: ctl.signal, ask: quick,
            webSearch: gw.wire === 'anthropic' ? { ask: quick, key: `${gw.baseUrl} ${gw.model}` } : null,
          });
          // No free logo on Wikimedia: the organisation's own, from its own website.
          const brief = await withSiteLogo(found, { signal: ctl.signal }).catch((e: unknown) => {
            if (ctl.signal.aborted) throw e;
            return found;
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
        facts: [before.lookup !== false ? factsBlock(before.brief) : '', linksBlock(before)].filter(Boolean).join('\n\n') || undefined,
        narration: !!before.audio?.narrate,
      });
      const out = await call(p.system, p.user, 8000);
      const cur = known.get(id) ?? v;
      const plan = parsePlan(out.text, cur, newId);
      if (!plan || !plan.scenes.length) throw new Error(UNREADABLE_PLAN);
      // The subject's own pictures go in first; the search fills what is left.
      const scenes = cur.lookup !== false || cur.links?.length ? placeBriefPictures(plan.scenes, cur.brief, cur.format) : plan.scenes;
      // The look the model designed, when it was asked for one in the same
      // reply (video.ts asks while `ai` is on and there is none yet).
      const design = cur.ai && !cur.design ? designIn(out.text) ?? undefined : cur.design;
      keep({ ...cur, title: plan.title || cur.title, scenes, ...(design ? { design } : {}), stage: 'pictures', updated: Date.now() });
      // Asked for and not given: one short request of its own. A look that
      // still does not come is not a failed video — the style draws it until
      // Design again in the Look tab — so only stopping ends the run here.
      if (cur.ai && !design) {
        job.stage = 'design';
        job.chars = 0;
        notify();
        try {
          const d = known.get(id);
          if (d) {
            const q = designPrompt(d);
            const got = designIn((await call(q.system, q.user, 1200)).text);
            if (got) update(id, (x) => ({ ...x, design: got }));
          }
        } catch (e) {
          if (ctl.signal.aborted || (e as { name?: string })?.name === 'AbortError') throw e;
        }
      }
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
      const same = old.picture && wantsPicture(next) && (!next.imageQuery || next.imageQuery === old.imageQuery || next.imageQuery === old.picture.query);
      const pictured: Scene = next.picture || !same ? next : { ...next, picture: old.picture };
      // The scene's own look (its size, alignment, colours) is the person's, not the model's: it stays.
      const kept: Scene = old.look && !pictured.look ? { ...pictured, look: old.look } : pictured;
      update(id, (x) => ({ ...x, scenes: x.scenes.map((s) => (s.id === old.id ? kept : s)) }));
      job.sceneId = kept.id;
      await picturesFor(id, job, kept.id);
    } else if (work.how === 'design') {
      // A look for the video as it is now; a second one is asked to differ
      // from the first. It is a change of the look, so it switches `ai` on.
      const cur = known.get(id);
      if (!cur) return;
      const q = designPrompt(cur, cur.design);
      const got = designIn((await call(q.system, q.user, 1200)).text);
      if (!got) throw new Error(UNREADABLE_DESIGN);
      edit(id, { ai: true, design: got });
    } else if (work.how === 'art') {
      // Restyle: every scene's art direction again, the words untouched. The
      // answer is read against the scenes as they were asked about (`parseArt`
      // checks each scene's emphasis against its own words), and written by
      // id into the video as it is now — a scene edited meanwhile keeps its
      // edit, and its art. A photo the new direction puts behind a scene's
      // words is found first, and goes in with the art: one edit for all of
      // it, so one undo takes it back (a picture fetched afterwards would be
      // a change the history did not make, and undo would stop there). A
      // picture the person took out elsewhere is not fetched back.
      const cur = known.get(id);
      if (!cur) return;
      const q = artPrompt(cur);
      const out = await call(q.system, q.user, 4000);
      const arts = parseArt(out.text, cur);
      if (!arts) throw new Error(UNREADABLE_ART);
      const byId = new Map(cur.scenes.map((s, i) => [s.id, { was: s, art: arts[i] }]));
      const wanting = new Map<string, Scene>();
      cur.scenes.forEach((s, i) => {
        const art = arts[i];
        if (!art || art.ground !== 'photo' || s.art?.ground === 'photo') return;
        const next = { ...s, art } as Scene;
        if (needsPictures(next)) wanting.set(s.id, next);
      });
      const found = new Map<string, Scene>();
      if (wanting.size) {
        job.stage = 'pictures';
        job.pics = { done: 0, of: wanting.size };
        notify();
        try {
          // The scenes that have a picture go too, so no photograph is chosen twice.
          const asked = cur.scenes.map((s) => wanting.get(s.id) ?? s).filter((s) => wanting.has(s.id) || picturesOf(s).length > 0);
          const got = await fillPictures(asked, {
            format: cur.format,
            signal: job.ctl.signal,
            onScene: (_i, scene) => {
              if (wanting.has(scene.id)) found.set(scene.id, scene);
              job.pics.done = Math.min(job.pics.of, found.size);
              notifySoon();
            },
          });
          for (const g of got) if (wanting.has(g.id)) found.set(g.id, g);
        } catch (e) {
          // No photo is not a failed restyle: the scene keeps its style's ground until one is found.
          if (ctl.signal.aborted || (e as { name?: string })?.name === 'AbortError') throw e;
        }
      }
      const now = known.get(id) ?? cur;
      const scenes = now.scenes.map((s) => {
        const got = byId.get(s.id);
        if (!got || !got.art || got.was !== s) return s;
        const next = { ...s, art: got.art } as Scene;
        const pic = found.get(s.id);
        return pic ? withPicturesOf(next, pic) : next;
      });
      if (scenes.some((s, i) => s !== now.scenes[i])) edit(id, { scenes });
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
  /**
   * The model designs the look (`Video.ai`) — the default, because most
   * videos are not a template: the six styles are there to choose instead.
   */
  ai: boolean;
  /** The templates' row is open: folded away at the end of the form until asked for. */
  templates: boolean;
  /** The direction the video follows (videodirections.ts), by id; null for the app's own. */
  direction: string | null;
  /** Ask Vylo sent these words: make it as soon as the form can, as if the button were pressed. */
  autostart?: boolean;
}

/**
 * The direction a video follows, like choosing a skill: the app's own (no
 * guide), one of the two that come with it, or one the person wrote or
 * pasted — a motion-design prompt, a house style. Theirs can be edited and
 * deleted; the app's two can only be chosen.
 */
function DirectionPicker({ t, value, onChange }: { t: T; value: string | null; onChange: (id: string | null) => void }) {
  const [saved, setSaved] = useState<Direction[]>(() => loadDirections());
  const [editing, setEditing] = useState<Direction | null>(null);
  const [unkept, setUnkept] = useState(false);
  const all: Direction[] = [...DIRECTIONS_BUILT_IN, ...saved];
  const shown = directionOf(value, saved);
  const nameOf = (d: Direction) => (d.builtIn ? t(d.name) : d.name);
  const put = (list: Direction[]) => { setSaved(list); setUnkept(!saveDirections(list)); };
  const save = () => {
    if (!editing || !editing.name.trim() || !editing.text.trim()) return;
    const d = { id: editing.id, name: editing.name.trim(), text: editing.text };
    put(saved.some((x) => x.id === d.id) ? saved.map((x) => (x.id === d.id ? d : x)) : [d, ...saved]);
    onChange(d.id);
    setEditing(null);
  };
  return (
    <div className="vid-dir">
      <div className="vid-dir-chips" role="radiogroup" aria-label={t('Direction')}>
        <button type="button" role="radio" aria-checked={!shown} className={`vid-chip ${!shown ? 'on' : ''}`} onClick={() => onChange(null)}>
          {t('The app’s own')}
        </button>
        {all.map((d) => (
          <button key={d.id} type="button" role="radio" aria-checked={shown?.id === d.id} className={`vid-chip ${shown?.id === d.id ? 'on' : ''}`}
                  onClick={() => onChange(d.id)} title={d.text.slice(0, 300)}>
            {d.builtIn ? <Icon name="sparkle" size={11} /> : <Icon name="book" size={11} />}<bdi>{nameOf(d)}</bdi>
          </button>
        ))}
        <button type="button" className="vid-chip vid-dir-new" onClick={() => setEditing({ id: newId(), name: '', text: '' })}>
          <Icon name="plus" size={11} />{t('New direction')}
        </button>
      </div>
      {shown && !editing && (
        <div className="vid-dir-show">
          <p dir="auto">{shown.text.length > 260 ? `${shown.text.slice(0, 260)}…` : shown.text}</p>
          {!shown.builtIn && (
            <span className="vid-dir-acts">
              <button type="button" className="ghost vid-sound-small" onClick={() => setEditing({ ...shown })}><Icon name="pencil" size={11} />{t('Edit')}</button>
              <button type="button" className="ghost vid-sound-small" onClick={() => { put(saved.filter((x) => x.id !== shown.id)); onChange(null); }}>{t('Delete')}</button>
            </span>
          )}
        </div>
      )}
      {editing && (
        <div className="vid-dir-edit">
          <input value={editing.name} dir="auto" placeholder={t('Name')} maxLength={60}
                 onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <textarea rows={8} dir="auto" value={editing.text}
                    placeholder={t('Paste or write your guide: the story, the pacing, the tone, how scenes hand over. Bracketed fields like [TOPIC] are filled from your request.')}
                    onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
          <span className="vid-dir-acts">
            <button type="button" className="sb-cta-go" disabled={!editing.name.trim() || !editing.text.trim()} onClick={save}>{t('Save')}</button>
            <button type="button" className="ghost" onClick={() => setEditing(null)}>{t('Cancel')}</button>
          </span>
        </div>
      )}
      {unkept && <p className="vid-bad">{t('Your direction could not be saved on this machine.')}</p>}
    </div>
  );
}

/** Ask Vylo's way in: `askNonce` draws the form again from the draft it filled. */
let askNonce = 0;
let askHome = false;

/** A new video from these words, planned as the form would plan it. */
export function askVideo(text: string) {
  Object.assign(draft, { request: text, format: null, seconds: null, style: null, lang: null, ai: true, autostart: true });
  askHome = true;
  askNonce += 1;
  toggleVideoFull(true);
  window.setTimeout(() => { draft.autostart = false; }, 8000);
}

const draft: Draft = { request: '', format: null, seconds: null, style: null, lang: null, set: {}, more: false, lookup: true, ai: true, templates: false, direction: null };

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

/** The colours a video is drawn in, for a swatch or a field's fallback: its designed look while that is on, else its style's. */
function swatchOf(v: Partial<Pick<Video, 'style' | 'ai' | 'design'>>): { bg: string; fg: string; accent: string } {
  if (v.ai && v.design) return { bg: v.design.bg, fg: v.design.fg, accent: v.design.accent };
  return STYLE_SWATCH[v.style ?? 'modern'] ?? STYLE_SWATCH.modern;
}

/** The name of a video's look: the design's own, "Designed by AI" before it has one, or the style's. */
function lookName(v: Pick<Video, 'style'> & Partial<Pick<Video, 'ai' | 'design'>>, t: T): string {
  return v.ai ? (v.design?.name || t('Designed by AI')) : styleName(v.style, t);
}

function errorText(e: string, t: T): string {
  if (e === UNREADABLE_PLAN) return t('The storyboard could not be read from the model’s reply. Try again, or try another model.');
  if (e === UNREADABLE_SCENE) return t('The new scene could not be read from the model’s reply. Try again, or say it differently.');
  if (e === UNREADABLE_DESIGN) return t('The look could not be read from the model’s reply. Try Design again.');
  if (e === UNREADABLE_ART) return t('The new art direction could not be read from the model’s reply. Try Restyle again.');
  return e;
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const whenOf = (at: number) => dateText(at);

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

/**
 * The styles as swatches: the palette is most of what a style is. The first
 * is the model's own design for this video, when `ai` is given — drawn in its
 * colours and named once there is one, and as a promise before (the same
 * tile as Slides' "Designed by AI"). Choosing a style turns the design off
 * and keeps it, so choosing the tile again brings the same look back.
 */
function StylePicker({ t, value, onChange, disabled, ai }: {
  t: T; value: Style; onChange: (s: Style) => void; disabled?: boolean;
  ai?: { on: boolean; design?: VideoDesign; onPick: () => void; disabled?: boolean };
}) {
  const d = ai?.design;
  return (
    <div className="vid-styles" role="radiogroup" aria-label={t('Style')}>
      {ai && (
        <button type="button" role="radio" aria-checked={ai.on} disabled={disabled || ai.disabled}
                className={`sl-ai-look vid-ai-look${ai.on ? ' on' : ''}`} onClick={ai.onPick}
                title={d?.why || t('The model designs the colours, the typeface and the motion for this video’s subject.')}>
          <span className="vid-swatch sl-ai-swatch" style={d ? { background: `linear-gradient(135deg, ${d.bg}, ${d.bg2})`, color: d.fg } : undefined} aria-hidden="true">
            <Icon name="sparkle" size={13} />
            {d && <i style={{ background: d.accent }} />}
          </span>
          <span dir="auto">{d?.name || t('Designed by AI')}</span>
        </button>
      )}
      {STYLES_LIST.map((s) => {
        const sw = STYLE_SWATCH[s];
        const on = !ai?.on && value === s;
        return (
          <button key={s} type="button" role="radio" aria-checked={on} disabled={disabled}
                  className={on ? 'on' : ''} onClick={() => onChange(s)}>
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
function BrandFields({ t, value, swatch: sw, designed, onChange, disabled }: {
  t: T;
  value: Brand;
  /** The look's own colours, which the brand's replace: the style's, or the design's (`swatchOf`). */
  swatch: { bg: string; accent: string };
  /** The colours are a designed look's, and are called so. */
  designed?: boolean;
  onChange: (b: Brand) => void;
  disabled?: boolean;
}) {
  const [bad, setBad] = useState(false);
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
                  title={designed ? t('Use the design’s colour') : t('Use the style’s colour')}
                  aria-label={designed ? t('Use the design’s colour') : t('Use the style’s colour')}><Icon name="close" size={11} /></button>
        : <small>{designed ? t('the design’s') : t('the style’s')}</small>}
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
    line = job.linking === 'video' ? t('Downloading the video from your link…')
      : job.linking === 'page' ? t('Reading your link…')
      : job.looking ? t('Looking it up on the web…') : job.chars ? t('Writing the storyboard…') : `${thinkingVerb(elapsed, t)}…`;
  } else if (job.stage === 'design') {
    line = t('Designing the look…');
  } else if (job.stage === 'art') {
    line = t('Art-directing every scene…');
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
        {(job.stage === 'planning' || job.stage === 'design' || job.stage === 'art') && job.chars > 0 && (
          <span>{fill(t('{n} characters'), { n: job.chars.toLocaleString(locale()) })}</span>
        )}
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
  useEffect(() => {
    if (!askHome) return;
    askHome = false;
    setOpenId(null);
  }, [askNonce]);
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
    const doing = work.how === 'plan' ? t('plan the video') : work.how === 'scene' ? t('write the scene again')
      : work.how === 'design' ? t('design the look') : work.how === 'art' ? t('restyle the scenes') : t('find pictures');
    // A reply that could not be read is said in the run's own sentence, not as its code.
    const say = (e: unknown) => {
      const code = e instanceof Error ? e.message : '';
      const own = code.startsWith('video:') ? errorText(code, t) : code;
      return own !== code ? own : explain(e, doing);
    };
    start(v, target, bookFor(v, target, efforts), work, say, report);
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
        : <Home key={askNonce} t={t} lang={lang} routes={routes} efforts={efforts} plan={plan} ready={ready} videos={videos}
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
                  : <VideoHome t={t} videos={videos} onOpen={setOpenId}
                               onFocus={() => document.getElementById('vid-request')?.focus()}
                               names={{
                                 kind: (k) => kindName(k, t), about: (k) => kindAbout(k, t), format: (v) => formatName(v.format, t),
                                 status: (v) => videoStatus(v, t), when: whenOf, live: (v) => jobs.has(v.id), seconds: (v) => (v.scenes.length ? lengthOf(v) : 0),
                               }} />}
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
  const credits = creditsOf(video.scenes, video.clips);
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
  const [ai, setAi] = useDraft('ai');
  const [tplOpen, setTplOpen] = useDraft('templates');
  const [direction, setDirection] = useDraft('direction');
  // Choosing one of the six styles is choosing it over a designed look.
  const pickStyle = (s: Style | null) => { setStyleSet(s); setAi(false); };
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

  useEffect(() => {
    if (!draft.autostart || !request.trim() || !ready || !onPlan) return;
    draft.autostart = false;
    // A tick later: the panel's own effect, which runs after this one, shows
    // the form for a new request, and would close what `go` opens.
    window.setTimeout(go, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, onPlan]);

  const go = () => {
    if (!request.trim() || !ready || !onPlan) return;
    // With `ai`, `style` is still the tone of the words; the model designs the look.
    const v = newVideo({ id: newId(), now: Date.now(), request: request.trim(), lang: vlang, format, style, seconds, brand, ...(ai ? { ai: true } : {}) });
    const dir = directionOf(direction);
    onStart({ ...v, ...set, credits: v.credits ?? true, lookup, ...(dir ? { guide: { name: dir.name, text: dir.text } } : {}) });
    setRequest('');
    setFormatSet(null);
    setSecondsSet(null);
    setStyleSet(null);
    setLangSet(null);
    setAi(true);
    setPicked(null);
  };

  // A template fills the form in the interface's language; nothing is asked of a model until "Make it".
  const pickTemplate = (tpl: Template) => {
    const text = tpl.request[lang] ?? tpl.request.en;
    setRequest(text);
    setFormatSet(tpl.format);
    setSecondsSet(tpl.seconds);
    // A template's look is part of it: its style, not a designed one (the tile above brings that back).
    pickStyle(tpl.style);
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
          {ai ? chip('sparkle', t('Designed by AI'), 'default') : chip('sparkle', styleName(style, t), byOf(styleSet, found.style))}
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
          <StylePicker t={t} value={style} onChange={pickStyle} ai={{ on: ai, onPick: () => setAi(true) }} />
          {ai && <small className="sl-ai-note">{t('The model designs the colours, the typeface and the motion for your subject, and art-directs every scene. Change any of it afterwards.')}</small>}
        </div>
        <div className="vid-group">
          <span className="vid-group-label">{t('Direction')}</span>
          <DirectionPicker t={t} value={direction} onChange={setDirection} />
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
        {more && <BrandFields t={t} value={brand} swatch={swatchOf({ style })} onChange={setBrand} />}
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
        <p className="vid-note">{t('The model writes the storyboard and art-directs it, choosing only from the app’s own effects, colours and typefaces — never code. The pictures are openly licensed and credited; you check everything before you export.')}</p>

        {/* Templates, folded away at the end: most videos are not one, and a
            designed look is the default. Everything a template did stays —
            it fills the form above, or opens a sample storyboard. */}
        <button className="vid-more vid-tpl-more" onClick={() => setTplOpen(!tplOpen)} aria-expanded={tplOpen} aria-controls="vid-tpl-group">
          <Icon name="chevron" size={11} />
          {t('Start from a template')}
          {pickedTpl && <small dir="auto">{templateName(pickedTpl.id, t)}</small>}
        </button>
        {tplOpen && (
          <div className="vid-group" id="vid-tpl-group">
            <div className="vid-tpl-row" role="group" aria-label={t('Start from a template')}>
              {TEMPLATES.map((tpl) => {
                const sw = STYLE_SWATCH[tpl.style];
                return (
                  <button key={tpl.id} type="button" className={`vid-tpl-card ${picked === tpl.id ? 'on' : ''}`} aria-pressed={picked === tpl.id}
                          onClick={() => pickTemplate(tpl)} title={templateAbout(tpl.id, t)}>
                    <span className="vid-tpl-thumb" style={{ background: sw.bg, color: sw.accent }} aria-hidden="true">
                      <i className={tpl.format === 'portrait' ? 'vid-tpl-frame is-portrait' : tpl.format === 'square' ? 'vid-tpl-frame is-square' : 'vid-tpl-frame is-landscape'} />
                      <Icon name={tpl.icon} size={12} />
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
        )}
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

/** Where a video is, in words: planning, finding pictures, its scenes and length, or not planned. */
function videoStatus(video: Video, t: T): string {
  const job = jobs.get(video.id);
  return job ? (job.stage === 'planning' ? t('Planning') : job.stage === 'design' ? t('Designing the look…') : job.stage === 'art' ? t('Restyling…') : t('Finding pictures'))
    : video.scenes.length ? fill(t('{n} scenes · {s} s'), { n: video.scenes.length, s: Math.round(lengthOf(video)) })
    : t('Not planned');
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
            {out ? t('Exporting') : videoStatus(video, t)}
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

type Tab = 'scenes' | 'chat' | 'look' | 'sound' | 'facts' | 'details';

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

/**
 * The look the model designed, said plainly: its name and why it suits the
 * video, its five colours, its typeface and its pace — and Design again, for
 * a clearly different one. Before there is one (the plan's reply had none and
 * the request after it failed), a way to ask for it.
 */
function DesignCard({ t, video, busy, ready, onDesign }: { t: T; video: Video; busy: boolean; ready: boolean; onDesign: () => void }) {
  const d = video.design;
  const designing = jobs.get(video.id)?.how === 'design';
  if (!d) {
    return (
      <div className="sl-ai-card vid-ai-card">
        <span className="vid-ai-empty" aria-hidden="true"><Icon name="sparkle" size={14} /></span>
        <span className="sl-ai-what">
          <b>{designing ? t('Designing the look…') : t('No look has been designed yet')}</b>
          <small>{t('Until there is one, the style below draws the video.')}</small>
        </span>
        <button type="button" className="ghost bordered" disabled={busy || !ready} onClick={onDesign}>
          <Icon name="sparkle" size={11} />{t('Design the look')}
        </button>
      </div>
    );
  }
  const pace = d.energy === 'calm' ? t('Calm and slow') : d.energy === 'punchy' ? t('Fast and punchy') : t('Lively');
  return (
    <div className="sl-ai-card vid-ai-card">
      <span className="sl-ai-dots vid-ai-dots" aria-hidden="true">
        {[d.bg, d.bg2, d.fg, d.accent, d.accent2].map((c, i) => <i key={i} style={{ background: c }} title={c} />)}
      </span>
      <span className="sl-ai-what" dir="auto">
        <b>{d.name || t('Designed by AI')}</b>
        {d.why && <small>{d.why}</small>}
        <small className="vid-ai-meta">{fill(t('Typeface: {font} · Pace: {pace}'), { font: fontName(d.font, t), pace })}</small>
      </span>
      <button type="button" className="ghost bordered" disabled={busy || !ready} onClick={onDesign}
              title={t('Ask the model for a clearly different look for this video.')}>
        <Icon name="sparkle" size={11} />{designing ? t('Designing the look…') : t('Design again')}
      </button>
    </div>
  );
}

/**
 * The Look tab's own controls: the parts of the look the Chat tab sets ("make
 * the logo bigger", "black background"), by hand — sizes, where the words
 * sit, colours, the typeface, the backdrop, the watermark. Values are checked
 * by videolook.ts, as the renderer draws them; every change is one
 * `change({ look })`, so undo takes it back. A scene's own look is set on its
 * card in Scenes, and is said here when there is one.
 */
function LookFields({ t, video, onLook, onScenes }: {
  t: T;
  video: Video;
  onLook: (look: LookSettings | undefined) => void;
  onScenes: (scenes: Scene[]) => void;
}) {
  const own = normalLook(video.look ?? {});
  const eff = lookFor(video);
  const sw = swatchOf(video);
  const rtl = isRtl(video.lang);
  const set = (patch: Partial<LookSettings>) => {
    const next = normalLook({ ...own, ...patch });
    onLook(Object.keys(next).length ? next : undefined);
  };
  // While a designed look is on, what is not set here is the design's, and is called so.
  const designed = !!(video.ai && video.design);
  const styles = designed ? t('the design’s') : t('the style’s');
  const ownScenes = video.scenes.filter((s) => s.look && Object.keys(s.look).length).length;
  const limit = (k: keyof typeof LOOK_LIMITS) => ({ min: LOOK_LIMITS[k].min, max: LOOK_LIMITS[k].max });
  const face = (f: (typeof FONT_CHOICES)[number]) => (rtl ? `"${f.arabic}", "${f.latin}"` : `"${f.latin}", "${f.arabic}"`);
  return (
    <div className="vid-group vid-pad">
      <span className="vid-group-label">{t('Adjust the look')}</span>
      <div className="vid-look-box">
        <LookSlider t={t} label={t('Logo size')} value={eff.logoScale} {...limit('logoScale')} onChange={(n) => set({ logoScale: n })} />
        <LookSlider t={t} label={t('Text size')} value={eff.textScale} {...limit('textScale')} onChange={(n) => set({ textScale: n })} />
        <LookSlider t={t} label={t('Motion')} value={eff.motion} {...limit('motion')} onChange={(n) => set({ motion: n })} />
        <div className="vid-look-line">
          <span>{t('Alignment')}</span>
          <AlignPicker t={t} value={own.align} rtl={rtl} onChange={(align) => set({ align })} />
        </div>
        <div className="vid-look-pair">
          <LookColour t={t} label={t('Background')} value={own.background} fallback={sw.bg} own={styles} onChange={(background) => set({ background })} />
          <LookColour t={t} label={t('Text colour')} value={own.text} fallback={sw.fg} own={styles} onChange={(text) => set({ text })} />
        </div>
        <div className="vid-look-stack">
          <span>{t('Font')}</span>
          <div className="vid-look-fonts" role="radiogroup" aria-label={t('Font')}>
            <button type="button" role="radio" aria-checked={!own.font} className={own.font ? '' : 'on'} onClick={() => set({ font: undefined })}>
              {designed ? t('The design’s own') : t('The style’s own')}
            </button>
            {FONT_CHOICES.map((f) => (
              <button key={f.id} type="button" role="radio" aria-checked={own.font === f.id} className={own.font === f.id ? 'on' : ''}
                      onClick={() => set({ font: f.id })} style={{ fontFamily: `${face(f)}, var(--sans)` }}>
                {fontName(f.id, t)}
              </button>
            ))}
          </div>
        </div>
        <div className="vid-look-line">
          <span>{t('Backdrop')}</span>
          <span className="vid-seg" role="radiogroup" aria-label={t('Backdrop')}>
            {(['moving', 'still', 'plain'] as const).map((b) => (
              <button key={b} type="button" role="radio" aria-checked={eff.backdrop === b} className={eff.backdrop === b ? 'on' : ''}
                      onClick={() => set({ backdrop: b === 'moving' ? undefined : b })}>
                {lookValueName('backdrop', b, t)}
              </button>
            ))}
          </span>
        </div>
        <div className="vid-look-line">
          <span>{t('Watermark corner')}</span>
          {/* In the video's own direction: the reading side of an Arabic video is its right. */}
          <span className="vid-look-corners" role="radiogroup" aria-label={t('Watermark corner')} dir={rtl ? 'rtl' : 'ltr'}>
            {(['top-start', 'top-end', 'bottom-start', 'bottom-end'] as const).map((c) => (
              <button key={c} type="button" role="radio" aria-checked={eff.watermarkCorner === c} className={`${CORNER_CLASS[c]}${eff.watermarkCorner === c ? ' on' : ''}`}
                      title={cornerName(c, t)} aria-label={cornerName(c, t)}
                      onClick={() => set({ watermarkCorner: c === lookFor(null).watermarkCorner ? undefined : c })}>
                <i aria-hidden="true" />
              </button>
            ))}
          </span>
        </div>
        <LookSlider t={t} label={t('Watermark size')} value={eff.watermarkScale} {...limit('watermarkScale')} onChange={(n) => set({ watermarkScale: n })} />
        <div className="vid-look-foot">
          {ownScenes > 0 && (
            <span className="vid-look-scenes">
              {ownScenes === 1 ? t('One scene has a look of its own') : fill(t('{n} scenes have a look of their own'), { n: ownScenes })}
              <button type="button" className="ghost" onClick={() => onScenes(video.scenes.map((s) => {
                if (!s.look) return s;
                const { look: _l, ...rest } = s;
                return rest as Scene;
              }))}>
                {t('Reset them too')}
              </button>
            </span>
          )}
          <button type="button" className="ghost bordered" disabled={!Object.keys(own).length} onClick={() => onLook(undefined)}>
            {t('Reset the look')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The corner buttons' classes, written out so the stylesheet's rules can be found from here. */
const CORNER_CLASS = { 'top-start': 'is-top-start', 'top-end': 'is-top-end', 'bottom-start': 'is-bottom-start', 'bottom-end': 'is-bottom-end' } as const;

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
  const missing = video.scenes.filter((s) => (s.kind === 'gallery' || s.kind === 'people' || wantsPicture(s)) && needsPictures(s)).length;
  const credits = creditsOf(video.scenes, video.clips);
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
  // A look designed as part of planning is the storyboard's step; one asked
  // for later, and a restyle, are work on a video that is ready.
  const now = job
    ? job.stage === 'planning' || (job.how === 'plan' && job.stage === 'design') ? 'planning'
      : job.stage === 'design' || job.stage === 'art' ? 'ready' : 'pictures'
    : video.scenes.length ? 'ready' : 'new';
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
          <span>{formatName(video.format, t)} · <bdi>{lookName(video, t)}</bdi> · {langName(video.lang, t)}{video.scenes.length ? ` · ${fill(t('{n} s'), { n: Math.round(lengthOf(video)) })}` : ''}</span>
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
            {(['scenes', 'chat', 'look', 'sound', 'facts', 'details'] as const).map((x) => (
              <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>
                {x === 'scenes' ? fill(t('Scenes ({n})'), { n: video.scenes.length })
                  : x === 'chat' ? t('Chat') : x === 'look' ? t('Look') : x === 'sound' ? t('Sound') : x === 'facts' ? t('Found on the web') : t('Details')}
              </button>
            ))}
          </div>

          {tab === 'scenes' && (
            <Storyboard t={t} video={video} redoingId={job?.how === 'scene' ? job.sceneId : undefined} locked={busy || !ready}
                        restyling={job?.how === 'art'} onRestyle={() => begin(video, { how: 'art' })}
                        onScenes={(scenes) => change({ scenes })} onVideo={change} onRedo={(id) => void redo(id)} onSeek={seekScene} onAdd={add} onError={onError} />
          )}
          {tab === 'chat' && (
            <VideoChat t={t} video={video} onChange={change} locked={busy} ready={ready} target={target} providers={routes.providers}
                       efforts={bookFor(video, target, efforts)} onFindPictures={() => begin(video, { how: 'pictures' })} onError={onError}
                       current={() => known.get(video.id) ?? video} onUndo={undo} />
          )}
          {tab === 'look' && (
            <div className="vid-look">
              <label className="vid-f vid-pad">
                <span>{t('Title of the video')}</span>
                <input value={video.title} dir="auto" onChange={(e) => change({ title: e.target.value })} />
              </label>
              <div className="vid-group vid-pad">
                <span className="vid-group-label">{t('Style')}</span>
                {/* A style chosen keeps the design stored, off; the tile brings it back. */}
                <StylePicker t={t} value={video.style} onChange={(style) => change({ style, ai: false })} disabled={job?.how === 'design'}
                             ai={{
                               on: !!video.ai, design: video.design,
                               // Designed once already: that look again. Not yet: design one — which needs the model, and no other run.
                               disabled: !video.design && (busy || !ready),
                               onPick: () => (video.design ? change({ ai: true }) : begin(video, { how: 'design' })),
                             }} />
                {video.ai && <DesignCard t={t} video={video} busy={busy} ready={ready} onDesign={() => begin(video, { how: 'design' })} />}
              </div>
              <LookFields t={t} video={video} onLook={(look) => change({ look })} onScenes={(scenes) => change({ scenes })} />
              <div className="vid-group vid-pad">
                <span className="vid-group-label">{t('Brand')}</span>
                <BrandFields t={t} value={video.brand} swatch={swatchOf(video)} designed={!!(video.ai && video.design)} onChange={(brand) => change({ brand })} />
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
