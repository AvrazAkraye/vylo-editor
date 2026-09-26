import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { open as openPanel, save as savePanel } from '@tauri-apps/plugin-dialog';
import { Icon, type IconName } from './Icon';
import { IS_MAC } from './Welcome';
import * as ask from './ask';
import { fill, type Lang } from './i18n';
import { explain } from './errors';
import { BUILT_IN, armed, route as routeOf, type Chosen, type Provider } from './providers';
import { allows, type PlanSummary } from './account';
import { MODELS, modelName } from './models';
import { EFFORTS, effortLabel, effortOf, effortsFor, type Effort, type EffortBook } from './effort';
import {
  KINDS, LIMITS, LOGO_KEY, PROFILE_KEY, STYLES, UNIVERSITIES, WORDS, agentsOf, bylineOf, clampTo, detect, docLangOf,
  kindOf, localDigits, logoFor, newDoc, pagesFor, readLogos, readProfile, statementOf, styleIn, targetSources,
  targetWords, withLogo, yearsOf, type DataFile, type Doc, type Logos, type DocLang, type Kind, type Length, type Meta, type Profile, type Section,
  type SectionState, type Source, type Stage, type Style,
} from './research';
import { blocksOf, wordCount, type Block } from './prose';
import { citeContext, referenceList, renderRuns, type CiteContext, type Rich } from './cite';
import { cleanDoi, lookupDoi, merge, search, type Get } from './scholar';
import { generate, type Target } from './generate';
import {
  EMPTY_SECTION, UNREADABLE_ABSTRACT, UNREADABLE_OUTLINE, highestKey, redoAbstract, rewrite, run,
  type Deps, type Progress,
} from './researchrun';
import { breaksOf, docxBase64, fileNameFor } from './researchdocx';
import { deleteDoc, loadDocs, saveDoc } from './researchstore';
import { DATA_EXTENSIONS, kindOfName } from './researchdata';
import { readPicked } from './researchfiles';
import { MIN_WORDS, voiceIn, voiceOf, type Researcher } from './researchers';
import { ResearchPeople, personOf, usePeople } from './ResearchPeople';
import { ResearchOriginality } from './ResearchOriginality';
import { fold } from './settings';

/**
 * Research, in the sidebar: say what you need, and get a document.
 *
 * The request box is the whole interface to begin with. Whatever kind of
 * document it names — ورقة عمل, رسالة ماجستير, نامەی ماستەر, a PhD dissertation
 * — switches that skill on, and the chip under the box says which phrase did it,
 * so an activation is never a guess the researcher has to make about the app.
 * See research.ts for the skills themselves.
 *
 * ## A thesis takes longer than a panel stays open
 *
 * Writing a dissertation is forty requests and the better part of an hour. The
 * sidebar unmounts this component whenever somebody clicks another module, so
 * the runs cannot live in it. They live in this file's module scope — `jobs`
 * and `known` below — and the component only watches them; every section is
 * kept in IndexedDB as it is written (researchstore.ts), so closing the app
 * mid-chapter costs the chapter being written and nothing before it.
 *
 * ## The only way out is a button
 *
 * Nothing here writes a file on its own. The document is shown in full in the
 * reader, with its citations and reference list formatted exactly as they will
 * be printed, and a Word file exists only when the researcher presses Save as
 * Word and picks where. The file is built at that moment from the document on
 * screen — the same `prose.ts` and `cite.ts` draw both — and saving is refused
 * while a run is still changing it. That is the rule the rest of the app keeps
 * for model output, kept here: a person approves the exact content, and the
 * approval is the act of saving it.
 *
 * ## References
 *
 * The sources are searched in OpenAlex and Crossref (scholar.ts) with plain
 * requests that carry no key and no header. The researcher sees every one,
 * can switch any of them off, and can add their own by DOI — looked up, so a
 * mistyped DOI is caught here rather than by an examiner — or by hand, marked
 * as theirs to vouch for.
 */

interface Props {
  t: (s: string) => string;
  /** The interface language: the document's language when a request has no letters to tell it by. */
  lang: Lang;
  /** Where requests go — App's `wired` route, the same one the composer sends to. */
  gw: Target;
  efforts: EffortBook;
  /**
   * What a document may choose to be written with instead: the same menu the
   * composer offers — the gateway's models and every provider's — resolved
   * by the same `route`, so a key still only goes where it was entered.
   */
  providers: readonly Provider[];
  /** The composer's choice, which a document follows until it chooses its own. */
  choice: Chosen;
  /** The gateway's address and key, which `route` builds the built-in route from. */
  gateway: { baseUrl: string; apiKey: string };
  /** What the account may run, to say so before a long run fails on its first request. */
  plan: PlanSummary | null;
  /** Open Settings where a key is entered. */
  onProviders: () => void;
  onError: (message: string) => void;
}

// ── runs, outside React ───────────────────────────────────────────────────

interface Job {
  ctl: AbortController;
  progress: Progress;
  /** When the run started, for the clock on the status. */
  started: number;
  /**
   * When this run began writing, and how many parts were already written
   * then — the estimate of what is left is measured from here, not from the
   * planning before it or the parts an earlier run wrote.
   */
  from?: { at: number; done: number };
  /** What the run has done so far, oldest first, for the activity list. */
  log: LogEntry[];
  /** When each part being written was handed to its writer, by section index — for its own clock. */
  began: Map<number, number>;
  /** Pause asked for: the writers finish the parts they have, and nothing new starts. */
  pausing: boolean;
  /** Only a whole run can be paused; a rewrite or an abstract is one request. */
  pausable: boolean;
}

/**
 * One thing a run did. Kept as facts rather than sentences, so the list is
 * said in whatever language the interface is in when it is drawn.
 */
type LogEntry = { at: number } & (
  | { what: 'stage'; stage: Stage }
  | { what: 'sources'; n: number }
  | { what: 'outline'; n: number }
  | { what: 'part'; heading: string; words: number }
  | { what: 'note'; note: NonNullable<Progress['note']> }
);

/** The longest a log grows; a dissertation's forty parts and its stages fit well inside it. */
const MAX_LOG = 120;

/** Runs in progress, by document id. */
const jobs = new Map<string, Job>();
/** The newest copy of every document this session has seen, by id. */
const known = new Map<string, Doc>();
const watchers = new Set<() => void>();
let loaded = false;
/** Set when IndexedDB refused a save, so the panel can say documents are not being kept. */
let unkept = false;
/**
 * Documents deleted this session. A run stopped by a delete still saves the
 * section it was writing as it unwinds, and a search still resolves after the
 * panel has moved on; both would put the document back — in the list and in
 * IndexedDB — a moment after the person was told it was gone.
 */
const gone = new Set<string>();

function notify() {
  for (const w of watchers) w();
}

/**
 * At most one redraw a frame. A section streams in dozens of pieces a second,
 * and each one redrawing the whole panel is a laptop fan for no benefit.
 */
let queued = false;
function notifySoon() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; notify(); });
}

function keep(doc: Doc) {
  if (gone.has(doc.id)) return;
  known.set(doc.id, doc);
  void saveDoc(doc).then((ok) => { if (!ok && !unkept) { unkept = true; notify(); } });
  notify();
}

const newId = () => {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/**
 * The transport scholar.ts is handed: a plain GET. No headers, deliberately —
 * a header turns the request into one the browser asks permission for first,
 * and Crossref's answer to that question is no.
 */
const get: Get = (url, signal) => fetch(url, { signal });

function depsFor(gw: Target, efforts: EffortBook): Deps {
  return {
    generate: (o) => generate(gw, { ...o, efforts }),
    search: (queries, want, signal) => search(queries, want, get, { signal }),
    save: keep,
    now: () => Date.now(),
    newId,
  };
}

/** The stages before anything is written, where "let me check first" still has something to hold. */
const EARLY: readonly Stage[] = ['new', 'planning', 'sources', 'outline'];

type Work =
  | { how: 'run'; stopBefore?: 'writing' }
  | { how: 'rewrite'; index: number; redo: string }
  | { how: 'abstract' };

function start(doc: Doc, gw: Target, efforts: EffortBook, work: Work, onFail: (e: unknown) => void) {
  // A file still being read would land after the run took its copy, and be lost.
  if (jobs.has(doc.id) || readsOf(doc.id).length) return;
  const ctl = new AbortController();
  const job: Job = { ctl, progress: { stage: doc.stage }, started: Date.now(), log: [], began: new Map(), pausing: false, pausable: work.how === 'run' };
  let before = doc;
  const log = (e: LogEntry) => { job.log.push(e); if (job.log.length > MAX_LOG) job.log.shift(); };
  jobs.set(doc.id, job);
  // Which model wrote it goes with the document, for the line that says so.
  doc = doc.model === gw.model ? doc : { ...doc, model: gw.model };
  known.set(doc.id, doc);
  notify();
  const deps = depsFor(gw, efforts);
  const onChange = (d: Doc, p: Progress) => {
    if (gone.has(d.id)) return;
    known.set(d.id, d);
    // What changed since the last report, as the run's activity: a stage
    // begun, the sources kept once the search and the screen are over, the
    // outline, each part as it is finished, anything the run had to say.
    const at = Date.now();
    const was = job.progress;
    if (p.stage !== was.stage) {
      if (was.stage === 'sources') log({ at, what: 'sources', n: d.sources.filter((x) => x.use).length });
      log({ at, what: 'stage', stage: p.stage });
    }
    if (!before.sections.length && d.sections.length) log({ at, what: 'outline', n: d.sections.length });
    const wasDone = new Set(before.sections.filter((x) => x.state === 'done').map((x) => x.id));
    for (const x of d.sections) {
      if (x.state === 'done' && x.text && !wasDone.has(x.id)) log({ at, what: 'part', heading: x.heading, words: wordCount(x.text) });
    }
    if (p.note && p.note.code !== was.note?.code) log({ at, what: 'note', note: p.note });
    before = d;
    const now = [...(p.writers ?? []).map((x) => x.index), ...(p.index !== undefined && !p.writers ? [p.index] : [])];
    for (const i of now) if (!job.began.has(i)) job.began.set(i, at);
    job.progress = p;
    if (p.stage === 'writing' && !job.from) job.from = { at: Date.now(), done: d.sections.filter((s) => s.state === 'done').length };
    notifySoon();
  };
  const o = { signal: ctl.signal, onChange, paused: () => job.pausing };
  const going = work.how === 'rewrite' ? rewrite(doc, work.index, work.redo, deps, o)
    : work.how === 'abstract' ? redoAbstract(doc, deps, o)
    : run(doc, deps, { ...o, stopBefore: work.stopBefore });
  going
    .then((d) => keep(d))
    .catch((e: unknown) => {
      if ((e as { name?: string })?.name !== 'AbortError') onFail(e);
    })
    .finally(() => {
      jobs.delete(doc.id);
      notify();
    });
}

function stop(id: string) {
  jobs.get(id)?.ctl.abort();
}

/** Ask a run to pause: the parts being written are finished and kept, and it ends there. */
function pause(id: string) {
  const job = jobs.get(id);
  if (!job || job.pausing) return;
  job.pausing = true;
  notify();
}

/**
 * The whole window, for the module. Kept here rather than in the component so
 * the rail's button in App can open it, and so it survives the sidebar
 * closing under it.
 */
let full = false;

/**
 * An error raised while the full window is open. The app's own errors are
 * said in the chat, which is underneath the full window, where nobody would
 * see them; these are said in the window instead.
 */
let fullError: string | null = null;

/** Open the Research workspace over the whole window, or close it. */
export function toggleResearchFull(on = !full) {
  full = on;
  fullError = null;
  notify();
}

/**
 * The request form as it was left, kept across the moves between the sidebar
 * and the full window — each move draws the form anew, and a request
 * half-typed, a note written, a box ticked, is not the move's to throw away.
 */
interface Draft {
  request: string;
  kind: Kind | null;
  lang: DocLang | null;
  style: Style | null;
  set: Partial<Pick<Doc, 'choice' | 'effort' | 'agents' | 'words' | 'sourcesWanted'>>;
  files: DataFile[];
  cover: Pick<Meta, 'title' | 'venue' | 'presented'>;
  notes: string;
  pause: boolean;
  caption: boolean;
  more: boolean;
  /**
   * Whose manner to write in: a researcher's id, '' for nobody, or `null` to
   * follow the request — "بأسلوب د. أحمد" chooses Dr Ahmed when he is saved.
   */
  voice: string | null;
}

const draft: Draft = {
  request: '', kind: null, lang: null, style: null, set: {}, files: [],
  cover: { title: '', venue: '', presented: '' }, notes: '', pause: false, caption: false, more: false, voice: null,
};

/**
 * The module's tabs before a document is open. Out here so a click on
 * another module and back, or the move to the full window, comes back to the
 * same tab.
 */
type HomeTab = 'write' | 'docs' | 'people' | 'check' | 'skills';
let homeTab: HomeTab = 'write';
/** The request box takes the focus when the Write tab is next drawn: a skill or a researcher was just chosen for it. */
let focusAsk = false;

function toTab(tab: HomeTab) {
  homeTab = tab;
  notify();
}

/** A piece of the request form's state, written through to `draft` so it outlives the form. */
function useDraft<K extends keyof Draft>(k: K): [Draft[K], (v: Draft[K]) => void] {
  const [v, setV] = useState<Draft[K]>(draft[k]);
  return [v, (next) => { draft[k] = next; setV(next); }];
}

/**
 * Files being read, by whom they are for: a document's id, or '' for the
 * request form. Out here, so a read survives the move between the sidebar
 * and the full window, and so nothing starts while one is still coming — a
 * run takes its copy of the document when it starts, and a file that
 * arrived after would never reach it.
 */
const reads = new Map<string, string[]>();
const readsOf = (owner: string): readonly string[] => reads.get(owner) ?? [];
function markRead(owner: string, name: string, on: boolean) {
  const now = readsOf(owner);
  reads.set(owner, on ? [...now, name] : now.filter((n) => n !== name));
  notify();
}

/**
 * A part being edited in the reader, by document. Out here for the same
 * reason as the draft: leaving the full window draws the reader anew, and
 * two paragraphs rewritten by hand are not the move's to throw away.
 */
const edits = new Map<string, { id: string; text: string }>();

/** The routes a document can be sent on, and the one it follows by default. */
interface Routes {
  providers: readonly Provider[];
  gateway: { baseUrl: string; apiKey: string };
  /** The composer's route and choice, which a document with no choice of its own follows. */
  fallback: Target;
  choice: Chosen;
}

/**
 * A document's own choice, while the provider it names is still there at the
 * address it was chosen at; otherwise none, and the document follows the
 * composer. A provider removed in Settings frees its id for the next one
 * added, and following the id would send the document's request, notes and
 * data to a host nobody chose for it.
 */
function choiceOf(doc: Partial<Pick<Doc, 'choice'>>, r: Routes): Doc['choice'] | undefined {
  const c = doc.choice;
  if (!c || c.provider === BUILT_IN) return c;
  const p = r.providers.find((x) => x.id === c.provider);
  return p && (!c.at || c.at === p.baseUrl) ? c : undefined;
}

/** Where a document's requests go: its own choice through the app's one resolver, or the composer's. */
function targetOf(doc: Partial<Pick<Doc, 'choice'>>, r: Routes): Target {
  const c = choiceOf(doc, r);
  if (!c) return r.fallback;
  const x = routeOf(c, r.providers, { ...r.gateway, model: r.fallback.model });
  return { baseUrl: x.baseUrl, apiKey: x.key, wire: x.wire, model: x.model };
}

/** The effort a document runs at: its own for its model, over the composer's book. */
function bookFor(doc: Partial<Pick<Doc, 'effort'>>, target: Target, book: EffortBook): EffortBook {
  return doc.effort ? { ...book, [target.model]: doc.effort } : book;
}

/** One entry of the model menu: a provider and a model, as the composer's menu lists them. */
interface MenuItem { provider: string; model: string; label: string; at?: string }

function menuOf(providers: readonly Provider[]): MenuItem[] {
  return [
    ...MODELS.map((m) => ({ provider: BUILT_IN, model: m.id, label: m.short })),
    ...providers.flatMap((p) => p.models.map((pm) => ({ provider: p.id, model: pm, label: `${pm} · ${p.name}`, at: p.baseUrl }))),
  ];
}

/** Redraw when anything outside React changes. */
function useWatch() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const w = () => setTick((n) => n + 1);
    watchers.add(w);
    return () => { watchers.delete(w); };
  }, []);
}

// ── small pieces ──────────────────────────────────────────────────────────

const RTL = (l: DocLang) => l !== 'en';

/** A class per outline level, written out so the stylesheet's rules can be found from here. */
const LEVEL = ['', 'rsch-lv1', 'rsch-lv2', 'rsch-lv3', 'rsch-lv4'] as const;

/**
 * The name of a skill, in the interface language. Written as explicit calls,
 * not `t(k.label)`, so the catalogue scanner can see every one of them — a
 * table would let a new kind ship in English. research.test.mjs checks the
 * catalogue for the labels too.
 */
function kindName(k: Kind, t: (s: string) => string): string {
  if (k === 'working-paper') return t('Working paper');
  if (k === 'article') return t('Research article');
  if (k === 'conference') return t('Conference paper');
  if (k === 'review') return t('Literature review');
  if (k === 'proposal') return t('Research proposal');
  if (k === 'graduation') return t('Graduation project');
  if (k === 'masters') return t('Master’s thesis');
  return t('PhD dissertation');
}

function kindAbout(k: Kind, t: (s: string) => string): string {
  if (k === 'working-paper') return t('A paper for a conference, seminar or workshop, built on axes and ending in recommendations.');
  if (k === 'article') return t('An article for a peer-reviewed journal: introduction, literature, method, results, discussion.');
  if (k === 'conference') return t('A paper for a scientific conference: an abstract, the study, and recommendations, within the organisers’ limit.');
  if (k === 'review') return t('A review that synthesises what has been published on a question, and where the gaps are.');
  if (k === 'proposal') return t('The plan submitted for approval before a thesis: problem, questions, method and timeline.');
  if (k === 'graduation') return t('An undergraduate graduation research, in four or five short chapters.');
  if (k === 'masters') return t('A master’s thesis in the five-chapter form Arab and Kurdish universities ask for.');
  return t('A doctoral dissertation: deeper chapters, a critical literature, and a contribution to knowledge.');
}

function langName(l: DocLang, t: (s: string) => string): string {
  if (l === 'ar') return t('Arabic');
  if (l === 'ckb') return t('Kurdish — Sorani');
  if (l === 'kmr') return t('Kurdish — Badini');
  return t('English');
}

function lengthName(l: Length, t: (s: string) => string): string {
  if (l === 'short') return t('Short');
  if (l === 'long') return t('Long');
  return t('Standard');
}

/**
 * A style's name. The five named after a manual keep that name in every
 * language; the footnote style Arab and Kurdish universities use has no name
 * of its own, so it is described.
 */
function styleName(s: Style, t: (s: string) => string): string {
  if (s === 'footnotes') return t('Footnotes (Arabic style)');
  if (s === 'apa') return 'APA 7';
  if (s === 'harvard') return 'Harvard';
  if (s === 'chicago') return 'Chicago';
  if (s === 'mla') return 'MLA 9';
  return 'IEEE';
}

/** A logo is a small picture; a photograph of the campus is not one, and would be carried in every document. */
const MAX_LOGO_BYTES = 400_000;

/**
 * Ask for a picture file, and hand back its contents as a data URL.
 *
 * The browser's own file picker: the person chooses the file, and it is read
 * into memory. Nothing is written anywhere by choosing it.
 */
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

/** Fonts a researcher is likely to be asked for. Any name can be typed; Word substitutes one it lacks. */
const FONTS = ['Simplified Arabic', 'Traditional Arabic', 'Sakkal Majalla', 'Arial', 'Times New Roman', 'Unikurd Web', 'Noto Naskh Arabic'];

function stageName(s: Stage, t: (s: string) => string): string {
  if (s === 'planning') return t('Planning');
  if (s === 'sources') return t('Finding sources');
  if (s === 'outline') return t('Outlining');
  if (s === 'writing') return t('Writing');
  if (s === 'abstract') return t('Writing the abstract');
  if (s === 'done') return t('Finished');
  return t('Not started');
}

/**
 * What a run has to say about itself, in the interface language. The engine
 * reports codes, and its own fixed errors as constants, so that the sentence
 * is chosen here where `t` is; an error from the transport is shown as it came.
 */
function noteText(n: NonNullable<Progress['note']>, t: (s: string) => string): string {
  if (n.code === 'plan-unreadable') return t('The plan could not be read, so the request itself is the title.');
  if (n.code === 'no-queries') return t('The plan named no searches, so no sources were searched. Search from the Sources tab, or add your own.');
  if (n.code === 'search-partial') {
    return fill(t('{failed} of {of} searches failed; the sources found by the rest are kept.'), { failed: n.failed ?? 0, of: n.of ?? 0 });
  }
  if (n.of) return fill(t('None of the {of} searches was answered; the outline is planned with the sources already here.'), { of: n.of });
  return fill(t('The search for sources failed ({detail}); the outline is planned with the sources already here.'), { detail: n.detail ?? '' });
}

function errorText(e: string, t: (s: string) => string): string {
  if (e === UNREADABLE_OUTLINE) return t('The outline could not be read from the model’s reply. Try again, or try another model.');
  if (e === UNREADABLE_ABSTRACT) return t('The abstract could not be read from the model’s reply. Try again, or try another model.');
  if (e === EMPTY_SECTION) return t('The model returned no text for this part.');
  return e;
}

function stateName(s: SectionState, t: (s: string) => string): string {
  if (s === 'writing') return t('Writing');
  if (s === 'done') return t('Written');
  if (s === 'failed') return t('Failed');
  if (s === 'author') return t('Yours to write');
  return t('Waiting');
}

/** The trigger phrases a skill card shows: one per script, so every reader finds theirs. */
function samplesOf(k: Kind): string[] {
  const all = kindOf(k).triggers;
  const kurdish = /[ڕڵێۆەڤ]/;
  const pick = [
    all.find((p) => /[؀-ۿ]/.test(p) && !kurdish.test(p)),
    all.find((p) => kurdish.test(p)),
    all.find((p) => /^[a-z]/i.test(p)),
  ];
  return pick.filter((p): p is string => !!p);
}

const wordsOf = (doc: Doc) => doc.sections.reduce((n, s) => n + (s.text ? wordCount(s.text) : 0), 0);

const whenOf = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/**
 * One pass over a document as the reader draws it: the citation context, whose
 * memory of what was already cited turns the second footnote for a source into
 * "مصدر سابق", and the footnotes of the part being drawn.
 *
 * The pass is walked eagerly, in document order, by plain functions rather than
 * components: a component renders after its parent has finished, and by then
 * the parent would already have drawn the part's footnotes — none of them.
 */
interface Pass {
  ctx: CiteContext;
  doc: Doc;
  notes: Rich[][];
}

/**
 * A paragraph's runs with their digits in the document's numerals, decided
 * over the paragraph as a whole — a run that is only " (2020). " belongs to
 * the English reference around it, and has no letters of its own to say so.
 * The same rule, over the same text, as the Word file.
 */
function localRuns(runs: Rich[], doc: Doc): Rich[] {
  const joined = runs.map((r) => (r.note ? '' : r.text)).join('');
  const done = localDigits(joined, doc);
  if (done === joined) return runs;
  let at = 0;
  return runs.map((r) => {
    if (r.note) return r;
    const text = done.slice(at, at + r.text.length);
    at += r.text.length;
    return r.link ? r : { ...r, text };
  });
}

/** One run of rich text that is not a footnote. A DOI is shown and can be copied; it is not a link, because a link would navigate the app's own window. */
function runEl(r: Rich, i: number): ReactNode {
  const text = r.text;
  if (r.hole) return <mark key={i} className="rsch-hole">{text}</mark>;
  if (r.bold && r.italic) return <b key={i}><i>{text}</i></b>;
  if (r.bold) return <b key={i}>{text}</b>;
  if (r.italic) return <i key={i}>{text}</i>;
  if (r.link) return <span key={i} className="rsch-link" dir="ltr">{text}</span>;
  return <Fragment key={i}>{text}</Fragment>;
}

/** Rich text, its footnotes numbered from one in each part, as the reader shows them. */
function richEls(runs: Rich[], pass: Pass): ReactNode[] {
  return localRuns(runs, pass.doc).map((r, i) => {
    if (r.note) {
      pass.notes.push(r.note);
      return <sup key={i} className="rsch-fn">{localDigits(String(pass.notes.length), pass.doc)}</sup>;
    }
    return runEl(r, i);
  });
}

/** One block of a part's text. `level` is the part's own heading level, so a `###` inside it sits one below. */
function blockEl(b: Block, pass: Pass, level: number, key: number): ReactNode {
  const rich = (runs: Parameters<typeof renderRuns>[0]) => richEls(renderRuns(runs, pass.ctx), pass);
  if (b.t === 'p') return <p key={key}>{rich(b.runs)}</p>;
  if (b.t === 'hole') return <p key={key}><mark className="rsch-hole">[{localDigits(b.text, pass.doc)}]</mark></p>;
  if (b.t === 'h') {
    const depth = Math.min(6, level + 1 + b.depth);
    const runs = rich(b.runs);
    return depth <= 4 ? <h4 key={key}>{runs}</h4> : depth === 5 ? <h5 key={key}>{runs}</h5> : <h6 key={key}>{runs}</h6>;
  }
  if (b.t === 'table') {
    const head = b.head.map((c, i) => <th key={i}>{rich(c)}</th>);
    const rows = b.rows.map((row, r) => <tr key={r}>{row.map((c, i) => <td key={i}>{rich(c)}</td>)}</tr>);
    return (
      <div className="rsch-table" key={key}>
        <table>
          <thead><tr>{head}</tr></thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    );
  }
  const items = b.items.map((it, i) => <li key={i}>{rich(it)}</li>);
  return b.t === 'ul' ? <ul key={key}>{items}</ul> : <ol key={key}>{items}</ol>;
}

/** A part's footnotes, numbered from one as each page of the Word file numbers its own. */
function notesEl(pass: Pass): ReactNode {
  if (!pass.notes.length) return null;
  // Each note takes its own direction from its first letter: an English
  // citation inside an Arabic document is set left to right, or its commas
  // and brackets come out mirrored.
  const drawn = pass.notes.map((n, i) => (
    <li key={i} dir="auto"><span className="rsch-fn-n">{localDigits(String(i + 1), pass.doc)})</span> {richEls(n, { ...pass, notes: [] })}</li>
  ));
  pass.notes = [];
  return <ol className="rsch-notes">{drawn}</ol>;
}

// ── choosing how it is written ────────────────────────────────────────────

type Settings = Pick<Doc, 'kind' | 'length' | 'lang'> & Partial<Pick<Doc, 'choice' | 'effort' | 'agents' | 'words' | 'sourcesWanted'>>;

/**
 * The model, how hard it thinks, how long the document is, how many sources
 * it looks for, and how many writers work at once — the same controls in the
 * request form and in a document's details.
 *
 * The model menu is the composer's: the gateway's models, a model the plan
 * cannot run shown and disabled rather than hidden, then each provider's. The
 * intelligence levels are the ones that model takes — none for a model that
 * rejects the field, as Haiku does.
 */
function WriteSettings({ t, value, onChange, routes, efforts, plan, disabled }: {
  t: (s: string) => string;
  value: Settings;
  onChange: (next: Partial<Settings>) => void;
  routes: Routes;
  /** The composer's levels, which a document with no level of its own runs at. */
  efforts: EffortBook;
  plan: PlanSummary | null;
  disabled?: boolean;
}) {
  const menu = useMemo(() => menuOf(routes.providers), [routes.providers]);
  const chosen = choiceOf(value, routes) ?? routes.choice;
  const at = menu.findIndex((m) => m.provider === chosen.provider && m.model === chosen.model);
  const target = targetOf(value, routes);
  const levels = target.wire === 'anthropic' ? effortsFor(target.model) : [];
  // The level the run will send: the document's own, or the composer's for
  // that model — the same book `begin` hands the run.
  const level = effortOf(bookFor(value, target, efforts), target.model);
  const words = targetWords(value);
  const sources = targetSources(value);
  const agents = agentsOf(value);
  return (
    <div className="rsch-set">
      <label className="rsch-f rsch-wide">
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
        <label className="rsch-f rsch-wide" title={t('How hard the model thinks before answering. Higher is slower and uses more of your plan’s tokens.')}>
          <span>{t('Intelligence')}</span>
          <span className="rsch-levels" role="radiogroup" aria-label={t('Intelligence')}>
            {EFFORTS.filter((l) => levels.includes(l)).map((l) => (
              <button key={l} type="button" role="radio" aria-checked={level === l} disabled={disabled}
                      className={level === l ? 'on' : ''} onClick={() => onChange({ effort: l as Effort })}>
                {effortLabel(l, t)}
              </button>
            ))}
          </span>
        </label>
      )}
      <label className="rsch-f">
        <span>{t('Words')}</span>
        <NumberField value={value.words} limit={LIMITS.words} placeholder={String(words)} disabled={disabled}
                     onChange={(n) => onChange({ words: n })} />
        <small>{fill(t('about {n} pages'), { n: pagesFor(words, value.lang) })}</small>
        {/* The kind's own lengths, one press away, for a researcher who has no number in mind. */}
        <span className="rsch-presets">
          {(['short', 'standard', 'long'] as const).map((l) => (
            <button key={l} type="button" disabled={disabled}
                    className={!value.words && value.length === l ? 'on' : ''}
                    onClick={() => onChange({ words: undefined, length: l })}>
              {fill(t('{length} — about {n} words'), { length: lengthName(l, t), n: kindOf(value.kind).words[l].toLocaleString() })}
            </button>
          ))}
        </span>
      </label>
      <label className="rsch-f">
        <span>{t('Sources')}</span>
        <NumberField value={value.sourcesWanted} limit={LIMITS.sources} placeholder={String(sources)} disabled={disabled}
                     onChange={(n) => onChange({ sourcesWanted: n })} />
        <small>{t('works to find and cite')}</small>
      </label>
      <div className="rsch-f rsch-wide">
        <span>{t('Writers working at once')}</span>
        <span className="rsch-step">
          <button type="button" disabled={disabled || agents <= LIMITS.agents.min} onClick={() => onChange({ agents: agents - 1 })}
                  aria-label={t('Fewer writers')}>−</button>
          <b aria-live="polite">{agents}</b>
          <button type="button" disabled={disabled || agents >= LIMITS.agents.max} onClick={() => onChange({ agents: agents + 1 })}
                  aria-label={t('More writers')}>+</button>
          <small>{agents > 1
            ? fill(t('{n} parts are written at the same time: faster, and {n} requests at once on your plan.'), { n: agents })
            : t('One writer, part after part: each part carries on from the one before.')}</small>
        </span>
      </div>
    </div>
  );
}

/** A number as typed, with nothing taken out of it; `undefined` for an empty field. */
const typed = (text: string): number | undefined => clampTo(text, { min: 0, max: Number.MAX_SAFE_INTEGER }) ?? undefined;

/**
 * A number typed by hand. What is typed stays as typed until the field is
 * left: brought into its limits on every keystroke, the 8 of 8000 would
 * become 500 and the rest of the number would build 150,000 on it. The number
 * goes up as it is, and the limits are applied where it is used — so a Write
 * pressed before the field is left still gets 8000.
 */
function NumberField({ value, limit, placeholder, disabled, onChange }: {
  value: number | undefined;
  limit: { min: number; max: number };
  placeholder: string;
  disabled?: boolean;
  onChange: (n: number | undefined) => void;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  // A change from outside — a length pressed, another document opened —
  // replaces what is shown; the echo of what was just typed does not.
  useEffect(() => {
    setText((cur) => (typed(cur) === value ? cur : value === undefined ? '' : String(value)));
  }, [value]);
  const settle = () => {
    const n = clampTo(text, limit) ?? undefined;
    setText(n === undefined ? '' : String(n));
    if (n !== value) onChange(n);
  };
  return (
    <input type="text" inputMode="numeric" value={text} placeholder={placeholder} disabled={disabled}
           onChange={(e) => { setText(e.target.value); onChange(typed(e.target.value)); }}
           onBlur={settle} onKeyDown={(e) => { if (e.key === 'Enter') settle(); }} />
  );
}

/**
 * The researcher's own files: survey results, a spreadsheet, notes, a PDF.
 *
 * Read when they are attached — text and CSV as they are, Word and Excel
 * unpacked here, a PDF transcribed once by the document's model — and kept
 * with the document as text, which is what every request is given. The file
 * itself is not kept, only what was read out of it.
 */
function DataField({ t, owner, files, onChange, onAdd, target, book, lang, disabled, onError }: {
  t: (s: string) => string;
  /** Whom the files are for — a document's id, or '' for the request form. */
  owner: string;
  files: DataFile[];
  /** The list with one taken off. */
  onChange: (files: DataFile[]) => void;
  /**
   * Files read, to be added to the list as it is when they arrive — which
   * may be a minute after they were picked, in a form drawn again since.
   */
  onAdd: (files: DataFile[]) => void;
  target: Target;
  book: EffortBook;
  lang: DocLang;
  disabled?: boolean;
  onError: (m: string) => void;
}) {
  const reading = readsOf(owner);
  const attach = async () => {
    const picked = await openPanel({
      multiple: true,
      title: t('Attach data files'),
      filters: [{ name: t('Data'), extensions: [...DATA_EXTENSIONS] }],
    });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    const got: DataFile[] = [];
    for (const path of paths) {
      const name = path.split(/[\\/]/).pop() ?? path;
      if (!kindOfName(name)) { onError(fill(t('{name} cannot be read. Save it as .docx, .xlsx, .csv, .txt or .pdf and attach that.'), { name })); continue; }
      markRead(owner, name, true);
      try {
        // A PDF is transcribed once by the document's own model.
        const f = await readPicked(path, { id: newId(), target, book, lang });
        if (f) got.push(f);
      } catch (e) {
        onError(explain(e, fill(t('read {name}'), { name })));
      } finally {
        markRead(owner, name, false);
      }
    }
    // A workbook with no cells, a Word file with no text: nothing to give the
    // model, and listed as attached it would look as if something had been.
    const empty = got.filter((f) => !f.text.trim());
    for (const f of empty) onError(fill(t('Nothing could be read from {name}.'), { name: f.name }));
    const kept = got.filter((f) => f.text.trim());
    if (kept.length) onAdd(kept);
  };
  const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
  return (
    <div className="rsch-data rsch-wide">
      <div className="rsch-row">
        <button type="button" className="ghost" disabled={disabled || reading.length > 0} onClick={() => void attach()}>
          <Icon name="attach" size={12} />{t('Attach data files')}
        </button>
        <small>{t('Excel, Word, CSV, text or PDF — your results, surveys and notes. The document reports only what they contain.')}</small>
      </div>
      {(files.length > 0 || reading.length > 0) && (
        <ul className="rsch-files">
          {files.map((f) => (
            <li key={f.id}>
              <Icon name={f.kind === 'table' ? 'grid' : 'file'} size={12} />
              <b dir="auto">{f.name}</b>
              <span>{size(f.bytes)}{f.truncated ? ` · ${t('only the start could be kept')}` : ''}</span>
              <button type="button" className="sb-act" disabled={disabled} onClick={() => onChange(files.filter((x) => x.id !== f.id))}
                      title={t('Remove')} aria-label={t('Remove')}><Icon name="close" size={11} /></button>
            </li>
          ))}
          {reading.map((n) => (
            <li key={`r-${n}`} className="is-reading"><span className="rsch-dot is-live" aria-hidden="true" /><b dir="auto">{n}</b><span>{t('Reading…')}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The language of the document, as four buttons: the choice is too important to sit in a menu. */
function LangSwitch({ t, value, onChange, disabled }: {
  t: (s: string) => string;
  value: DocLang;
  onChange: (l: DocLang) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rsch-langs" role="radiogroup" aria-label={t('Language of the document')}>
      {(['ar', 'ckb', 'kmr', 'en'] as const).map((l) => (
        <button key={l} type="button" role="radio" aria-checked={value === l} disabled={disabled}
                className={value === l ? 'on' : ''} onClick={() => onChange(l)} lang={l === 'en' ? 'en' : l}>
          {langName(l, t)}
        </button>
      ))}
    </div>
  );
}

/** The time a run has taken, as a clock: 4:07, 1:02:30. */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Redraw every second while something is running, for the clock. */
function useTick(on: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const i = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(i);
  }, [on]);
}

/**
 * What a writer is doing before its first words arrive. The model is thinking
 * — at a high effort that can be a minute — and a line that changes says it
 * is working, where a still one looks stuck. Written out as calls so the
 * catalogue scanner finds every one.
 */
function thinkingVerb(ms: number, t: (s: string) => string): string {
  const n = Math.floor(ms / 4000) % 5;
  if (n === 1) return t('Reading the sources');
  if (n === 2) return t('Planning the part');
  if (n === 3) return t('Weighing the arguments');
  if (n === 4) return t('Choosing the citations');
  return t('Thinking');
}

/**
 * The line above a part being written: a turning mark, what the writer is
 * doing — thinking, then writing — its own clock, and its words against the
 * outline's target for it.
 */
function PartStatus({ t, job, index, live, want }: { t: (s: string) => string; job: Job; index: number; live: string; want: number }) {
  useTick(true);
  const since = Date.now() - (job.began.get(index) ?? Date.now());
  const n = live ? wordCount(live) : 0;
  return (
    <p className={`rsch-part-status ${live ? 'is-writing' : 'is-thinking'}`} role="status">
      <span className="rsch-glyph" aria-hidden="true">✻</span>
      <b>{live ? t('Writing the part') : thinkingVerb(since, t)}…</b>
      <span>{clock(since)}</span>
      {live
        ? <span>{want ? fill(t('{n} of {of} words'), { n: n.toLocaleString(), of: want.toLocaleString() }) : fill(t('{n} words'), { n: n.toLocaleString() })}</span>
        : <span>{t('the words appear here as they are written')}</span>}
    </p>
  );
}

/**
 * How far a run has come, from 0 to 100. The stages before writing are short
 * and each takes a fixed share; writing is most of the bar and moves with the
 * words — the ones finished and the ones being written this second — against
 * the words the outline asked for.
 */
function percentOf(doc: Doc, job: Job): number {
  const stage = job.progress.stage;
  if (stage === 'done') return 100;
  if (stage === 'abstract') return 96;
  if (stage !== 'writing') return stage === 'outline' ? 18 : stage === 'sources' ? 8 : 2;
  const live = new Map<number, number>();
  for (const w of job.progress.writers ?? []) live.set(w.index, wordCount(w.live));
  if (!job.progress.writers && job.progress.index !== undefined) live.set(job.progress.index, wordCount(job.progress.live ?? ''));
  let want = 0;
  let got = 0;
  doc.sections.forEach((x, i) => {
    if (x.words <= 0 || x.state === 'author') return;
    want += x.words;
    got += Math.min(x.words, x.state === 'done' ? x.words : live.get(i) ?? 0);
  });
  return Math.round(25 + (want ? (70 * got) / want : 0));
}

/** One line of the activity list, in the interface language. */
function logText(e: LogEntry, t: (s: string) => string): string {
  if (e.what === 'stage') return stageName(e.stage, t);
  if (e.what === 'sources') return fill(t('{n} sources kept for the document'), { n: e.n });
  if (e.what === 'outline') return fill(t('Outline ready: {n} parts'), { n: e.n });
  if (e.what === 'part') return fill(t('Written: {heading} — {n} words'), { heading: e.heading, n: e.words.toLocaleString() });
  return noteText(e.note, t);
}

/**
 * Where a run is, while it runs: a bar that fills as the document does, the
 * time taken and — once a part is done to measure by — roughly how long is
 * left, one row a writer with the part it has and the words it has put down,
 * and the run's activity so far, newest first.
 */
function RunStatus({ t, doc, job, rows = 5 }: { t: (s: string) => string; doc: Doc; job: Job; rows?: number }) {
  useTick(true);
  const writers = job.progress.writers ?? (job.progress.index !== undefined
    ? [{ agent: 1, index: job.progress.index, live: job.progress.live ?? '' }]
    : []);
  const todo = doc.sections.filter((s) => s.words > 0 && s.state !== 'author');
  const done = todo.filter((s) => s.state === 'done').length;
  const elapsed = Date.now() - job.started;
  // Measured from when this run began writing, over the parts it wrote: the
  // pace already has the writers in it, so it is not divided by them again.
  const from = job.from;
  const since = from ? done - from.done : 0;
  const left = from && since > 0 && done < todo.length ? ((Date.now() - from.at) / since) * (todo.length - done) : 0;
  const pct = percentOf(doc, job);
  // Before writing there are no words to count, so the bar says it is working
  // rather than pretending to measure.
  const early = job.progress.stage !== 'writing' && job.progress.stage !== 'abstract';
  const recent = job.log.slice(-rows).reverse();
  return (
    <div className="rsch-writers">
      <div className={`rsch-bar ${early ? 'is-early' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
           aria-label={t('Progress')}>
        <i style={{ inlineSize: `${pct}%` }} />
      </div>
      <p className="rsch-clock">
        {!early && <b>{pct}%</b>}
        <span>{fill(t('Running for {time}'), { time: clock(elapsed) })}</span>
        {left > 0 && <span>{fill(t('about {time} left'), { time: clock(left) })}</span>}
        {todo.length > 0 && <span>{fill(t('{done} of {n} written'), { done, n: todo.length })}</span>}
      </p>
      {writers.length > 0 && (
        <ul>
          {writers.map((w) => {
            const sec = doc.sections[w.index];
            if (!sec) return null;
            const n = wordCount(w.live);
            return (
              <li key={w.agent}>
                <span className="rsch-dot is-live" aria-hidden="true" />
                <b>{fill(t('Writer {n}'), { n: w.agent })}</b>
                <span className="rsch-writer-what" dir="auto">{sec.heading}</span>
                <span className="rsch-writer-n">{n ? fill(t('{n} words'), { n: n.toLocaleString() }) : `${thinkingVerb(Date.now() - (job.began.get(w.index) ?? Date.now()), t)}…`}</span>
                {/* The part's own bar: its words against what the outline gave it. */}
                <span className="rsch-writer-bar" aria-hidden="true"><i style={{ inlineSize: `${Math.min(100, sec.words ? (100 * n) / sec.words : 0)}%` }} /></span>
              </li>
            );
          })}
        </ul>
      )}
      {recent.length > 0 && (
        <ol className="rsch-log" aria-label={t('Activity')}>
          {recent.map((e, i) => (
            <li key={`${e.at}-${i}`} className={i === 0 ? 'is-new' : ''}>
              <span className="rsch-log-at">{clock(e.at - job.started)}</span>
              <span dir="auto">{logText(e, t)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── the panel ─────────────────────────────────────────────────────────────

export function ResearchPanel({ t, lang, gw, efforts, plan, providers, choice, gateway, onProviders, onError }: Props) {
  useWatch();
  const people = usePeople();
  const [openId, setOpenNow] = useState<string | null>(null);
  const [reading, setReading] = useState<{ id: string; at?: string } | null>(null);
  // In the full window the reader is already open beside the controls, and a
  // part chosen in the outline is scrolled to there; `n` scrolls to it again
  // when the same part is chosen twice.
  const [jump, setJump] = useState<{ at: string; n: number } | null>(null);
  const [printing, setPrinting] = useState<string | null>(null);
  const fullBox = useRef<HTMLDivElement>(null);
  const setOpenId = (id: string | null) => { setOpenNow(id); setJump(null); };

  useEffect(() => {
    if (loaded) return;
    loaded = true;
    void loadDocs().then((docs) => {
      // A run started before the list arrived is newer than what was stored.
      for (const d of docs) if (!known.has(d.id)) known.set(d.id, d);
      notify();
    });
  }, []);

  // The full window is a window: it takes the focus when it opens, keeps Tab
  // inside it — the app under it is hidden, and a Tab into the composer there
  // would type into a box nobody can see — and gives the focus back to where
  // it came from when it closes. Escape leaves it, unless a dialog over it
  // handles its own Escape and says so. In a field, Escape leaves the field
  // first: a request being typed or a part being edited is not the press's
  // to close over.
  const isFull = full;
  useEffect(() => {
    if (!isFull) return;
    // The reader over the window belongs to the sidebar; the full window has its own.
    setReading(null);
    const from = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    fullBox.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const box = fullBox.current;
      const act = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (e.key === 'Escape' && !e.defaultPrevented) {
        if (act && box?.contains(act) && (act.matches('textarea, select, input:not([type="checkbox"]):not([type="radio"])') || act.isContentEditable)) { act.blur(); box.focus(); return; }
        toggleResearchFull(false);
        return;
      }
      if (e.key !== 'Tab' || !box) return;
      // A dialog over the window keeps its own Tab.
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

  // The paper view is in the page only while a PDF is being made of it.
  useEffect(() => {
    if (!printing) return;
    document.documentElement.classList.add('rsch-printing');
    return () => document.documentElement.classList.remove('rsch-printing');
  }, [printing]);

  const routes: Routes = useMemo(() => ({ providers, gateway, fallback: gw, choice }), [providers, gateway, gw, choice]);
  const docs = [...known.values()].sort((a, b) => b.updated - a.updated);
  const open = openId ? known.get(openId) ?? null : null;

  // Said where it will be seen: in the full window while it is open — the
  // chat is under it — and in the chat otherwise. Decided when the error
  // comes, which for a run may be an hour after it started.
  const report = (m: string) => {
    if (full) { fullError = m; notify(); } else onError(m);
  };
  const fail = (doing: string) => (e: unknown) => report(explain(e, doing));
  const begin = (doc: Doc, work: Work) => {
    const target = targetOf(doc, routes);
    start(doc, target, bookFor(doc, target, efforts), work, fail(t('write the document')));
  };

  /**
   * Write the document as a PDF to `path`, which the save panel returned. The
   * page gets a paper view of exactly the document on screen — the reader's
   * blocks and citations, laid out by the print styles — and the webview
   * prints that to the file; no print dialog.
   */
  const pdfDoc = async (doc: Doc, path: string) => {
    // The paper view lays its pages out first — measured, then drawn — and
    // says when they are ready; a thesis is a few hundred milliseconds.
    const ready = new Promise<void>((r) => {
      paperReady = r;
      window.setTimeout(r, 15_000);
    });
    setPrinting(doc.id);
    await ready;
    try {
      await invoke('save_pdf', { path });
    } finally {
      setPrinting(null);
    }
  };

  const reader = reading && known.get(reading.id);
  const printed = printing ? known.get(printing) : undefined;
  const target = targetOf(open ?? draft.set, routes);
  const ready = armed({ baseUrl: target.baseUrl, key: target.apiKey });

  const body = (
    <div className="rsch">
      {!ready && (
        <div className="sb-cta">
          <p className="ft-empty">{t('Add an API key in Settings first.')}</p>
          <button className="ghost bordered" onClick={onProviders}>
            <Icon name="settings" size={13} />
            <span className="cta-label">{t('Open Settings')}</span>
          </button>
        </div>
      )}
      {unkept && (
        <p className="rsch-warn">{t('Documents cannot be kept on this machine right now. Save to Word before you close the app.')}</p>
      )}

      {open
        ? <DocView key={open.id} doc={open} t={t} routes={routes} efforts={efforts} plan={plan} ready={ready} inFull={full}
                   docs={docs} people={people}
                   onBack={() => setOpenId(null)}
                   onRead={(at) => {
                     if (!full) setReading({ id: open.id, at });
                     else if (at) setJump((j) => ({ at, n: (j?.n ?? 0) + 1 }));
                   }}
                   onPdf={(path) => pdfDoc(open, path)} begin={begin} onError={report} />
        : <HomeTabs t={t} lang={lang} routes={routes} efforts={efforts} plan={plan} ready={ready} docs={docs} people={people}
                    onOpen={setOpenId} onError={report}
                    onStart={(doc) => { keep(doc); setOpenId(doc.id); begin(doc, { how: 'run', stopBefore: doc.pause ? 'writing' : undefined }); }} />}
    </div>
  );

  const printView = printed && createPortal(<Paper key={printed.id} doc={printed} />, document.body);

  if (full) {
    return (
      <>
        <div className="sb-cta rsch-away">
          <p className="ft-empty">{t('Research is open over the whole window.')}</p>
          <button className="ghost bordered" onClick={() => toggleResearchFull(false)}>
            <Icon name="restore" size={13} />
            <span className="cta-label">{t('Back to the sidebar')}</span>
          </button>
        </div>
        {createPortal(
          <div className="rsch-full" role="dialog" aria-modal="true" aria-label={t('Research')} ref={fullBox} tabIndex={-1}>
            <header className="rsch-full-head" data-tauri-drag-region>
              <Icon name="book" size={16} />
              <b>{t('Research')}</b>
              {open && <span dir="auto">{open.meta.title || open.request}</span>}
              <button className="sb-act" onClick={() => toggleResearchFull(false)}
                      title={t('Back to the sidebar')} aria-label={t('Back to the sidebar')}>
                <Icon name="restore" size={14} />
              </button>
            </header>
            {fullError && (
              <p className="rsch-full-error" role="alert">
                <span dir="auto">{fullError}</span>
                <button className="sb-act" onClick={() => { fullError = null; notify(); }} title={t('Close')} aria-label={t('Close')}>
                  <Icon name="close" size={12} />
                </button>
              </p>
            )}
            <div className="rsch-full-main">
              <aside className="rsch-full-side">{body}</aside>
              <main className="rsch-full-doc">
                {open
                  ? <Reader key={open.id} doc={open} t={t} mode="inline" at={jump?.at} nonce={jump?.n} onClose={() => setJump(null)} begin={begin} />
                  : <FullWelcome t={t} docs={docs} onOpen={setOpenId} />}
              </main>
            </div>
          </div>,
          document.body,
        )}
        {printView}
      </>
    );
  }

  return (
    <>
      {body}
      {reader && createPortal(
        <Reader doc={reader} t={t} at={reading?.at} mode="overlay"
                onClose={() => setReading(null)}
                begin={begin} />,
        document.body,
      )}
      {printView}
    </>
  );
}

/** The large side of the full window before a document is open: the skills, and the documents so far. */
function FullWelcome({ t, docs, onOpen }: { t: (s: string) => string; docs: Doc[]; onOpen: (id: string) => void }) {
  return (
    <div className="rsch-welcome">
      <h2>{t('What do you need?')}</h2>
      <p>{t('Each kind of document is a skill. Name it in your request — in Arabic, Kurdish or English — and it switches on.')}</p>
      <div className="rsch-welcome-grid">
        {KINDS.map((k) => (
          <div key={k.id} className="rsch-card">
            <b>{kindName(k.id, t)}</b>
            <span>{kindAbout(k.id, t)}</span>
            <span className="rsch-says">{samplesOf(k.id).map((p) => <code key={p} dir="auto">{p}</code>)}</span>
          </div>
        ))}
      </div>
      {docs.length > 0 && (
        <>
          <h3>{t('Your documents')}</h3>
          <ul className="rsch-docs">{docs.map((d) => <DocRow key={d.id} doc={d} t={t} onOpen={() => onOpen(d.id)} />)}</ul>
        </>
      )}
    </div>
  );
}

// ── the module's tabs ─────────────────────────────────────────────────────

interface HomeProps {
  t: (s: string) => string;
  lang: Lang;
  routes: Routes;
  efforts: EffortBook;
  plan: PlanSummary | null;
  ready: boolean;
  docs: Doc[];
  people: Researcher[];
  onOpen: (id: string) => void;
  onStart: (doc: Doc) => void;
  onError: (m: string) => void;
}

/**
 * Before a document is open, the module is five tabs: Write a new one, the
 * Documents so far, the Researchers whose manner a document can be written
 * in, the Originality check, and the Skills — each kind of document. Before
 * this they were one long column, and the Documents list was under the form
 * where nobody with a thesis to open wanted to scroll for it.
 */
function HomeTabs(p: HomeProps) {
  const { t, lang, docs, people, routes, efforts, ready, onOpen, onError } = p;
  const tab = homeTab;
  const target = targetOf(draft.set, routes);
  const book = bookFor(draft.set, target, efforts);
  const tabs: { id: HomeTab; icon: IconName; label: string; n?: number }[] = [
    { id: 'write', icon: 'pencil', label: t('Write') },
    { id: 'docs', icon: 'list', label: t('Documents'), n: docs.length },
    { id: 'people', icon: 'person', label: t('Researchers'), n: people.length },
    { id: 'check', icon: 'shield', label: t('Originality') },
    { id: 'skills', icon: 'book', label: t('Skills') },
  ];
  return (
    <>
      <div className="rsch-home-tabs" role="tablist" aria-label={t('Research')}>
        {tabs.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => toTab(x.id)}
                  title={x.label}>
            <Icon name={x.icon} size={14} />
            <span>{x.label}</span>
            {!!x.n && <small>{x.n}</small>}
          </button>
        ))}
      </div>
      {tab === 'write' && <Home {...p} />}
      {tab === 'docs' && <DocList t={t} docs={docs} onOpen={onOpen} />}
      {tab === 'people' && (
        <ResearchPeople t={t} lang={lang} target={target} book={book} ready={ready} onError={onError}
                        onWrite={(id) => { draft.voice = id; focusAsk = true; toTab('write'); }} />
      )}
      {tab === 'check' && (
        <ResearchOriginality t={t} docs={docs} people={people} lang={lang} target={target} book={book}
                             canRewrite={false} onOpenDoc={onOpen} onError={onError} />
      )}
      {tab === 'skills' && <Skills t={t} lang={lang} />}
    </>
  );
}

/** Every document, newest first, with a box to find one by its title or request. */
function DocList({ t, docs, onOpen }: { t: (s: string) => string; docs: Doc[]; onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const terms = fold(q).split(/\s+/).filter(Boolean);
  const shown = terms.length
    ? docs.filter((d) => { const hay = fold(`${d.meta.title} ${d.request} ${d.voice?.name ?? ''}`); return terms.every((w) => hay.includes(w)); })
    : docs;
  if (!docs.length) {
    return (
      <div className="sb-cta">
        <p className="ft-empty">{t('No documents yet. Ask for one in the Write tab.')}</p>
        <button className="ghost bordered" onClick={() => toTab('write')}>
          <Icon name="pencil" size={13} />
          <span className="cta-label">{t('Write')}</span>
        </button>
      </div>
    );
  }
  return (
    <>
      <div className="rsch-find">
        <Icon name="search" size={12} />
        <input value={q} onChange={(e) => setQ(e.target.value)} dir="auto" placeholder={t('Find a document')} aria-label={t('Find a document')} />
      </div>
      <ul className="rsch-docs">
        {shown.map((d) => <DocRow key={d.id} doc={d} t={t} onOpen={() => onOpen(d.id)} />)}
      </ul>
      {!shown.length && <p className="rsch-lede">{t('No document matches.')}</p>}
    </>
  );
}

/**
 * The skills as cards. Choosing one puts its phrase in the request box, in
 * the language the researcher is likely to write the rest in, and goes to
 * the Write tab.
 */
function Skills({ t, lang }: { t: (s: string) => string; lang: Lang }) {
  const pick = (k: Kind) => {
    draft.kind = k;
    if (!draft.request.trim()) {
      const s = samplesOf(k);
      // In Badini, a Badini phrase: the Kurdish sample is Sorani, and a
      // Sorani phrase would make the document Sorani.
      const badini = lang === 'kmr' ? kindOf(k).triggers.find((x) => docLangOf(x, 'kmr') === 'kmr') : undefined;
      const phrase = lang === 'en' ? s[s.length - 1] : lang === 'ar' ? s[0] : badini ?? s[1] ?? s[0];
      draft.request = `${phrase} `;
    }
    focusAsk = true;
    toTab('write');
  };
  return (
    <>
      <p className="rsch-lede">{t('Each kind of document is a skill. Name it in your request — in Arabic, Kurdish or English — and it switches on.')}</p>
      <ul className="rsch-skills">
        {KINDS.map((k) => (
          <li key={k.id}>
            <button className={`rsch-card ${draft.kind === k.id ? 'on' : ''}`} onClick={() => pick(k.id)}>
              <b>{kindName(k.id, t)}</b>
              <span>{kindAbout(k.id, t)}</span>
              <span className="rsch-says">
                {samplesOf(k.id).map((x) => <code key={x} dir="auto">{x}</code>)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

// ── asking for a document ─────────────────────────────────────────────────

function Home({ t, lang, routes, efforts, plan, ready, people, onStart, onError }: HomeProps) {
  // Everything in the form is kept in `draft` as it is set, so the move to the
  // full window and back does not throw any of it away. What the researcher
  // chose by hand wins over what the words say, and stays chosen while they
  // keep typing.
  const [request, setRequest] = useDraft('request');
  const [kindSet, setKindSet] = useDraft('kind');
  const [langSet, setLangSet] = useDraft('lang');
  const [styleSet, setStyleSet] = useDraft('style');
  const [set, putSet] = useDraft('set');
  const setSet = (v: Partial<Settings>) => putSet({ ...draft.set, ...v });
  const [cover, setCover] = useDraft('cover');
  const [caption, setCaption] = useDraft('caption');
  const [notes, setNotes] = useDraft('notes');
  const [pause, setPause] = useDraft('pause');
  const [more, setMore] = useDraft('more');
  const [voiceSet, setVoiceSet] = useDraft('voice');
  // Files arrive after a read that may outlast this form, so they are drawn
  // from `draft` itself rather than from a copy of it.
  const files = draft.files;
  const setFiles = (v: DataFile[]) => { draft.files = v; notify(); };
  const loading = readsOf('').length > 0;
  const [profile, setProfile] = useState<Profile>(() => {
    try { return readProfile(localStorage.getItem(PROFILE_KEY)); } catch { return readProfile(null); }
  });
  // A logo from the first version was the logo of the university the profile
  // named then, and is read as that university's.
  const [logos, setLogos] = useState<Logos>(() => {
    try { return readLogos(localStorage.getItem(LOGO_KEY), readProfile(localStorage.getItem(PROFILE_KEY)).university); } catch { return {}; }
  });
  const [logoError, setLogoError] = useState(false);
  const [logoUnkept, setLogoUnkept] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  const found = useMemo(() => detect(request), [request]);
  // The researcher the request names, while none was chosen by hand.
  const named = useMemo(() => (voiceSet === null ? voiceIn(request, people) : null), [voiceSet, request, people]);
  const writer = voiceSet === null ? named : voiceSet ? personOf(voiceSet) ?? null : null;
  const voice = useMemo(() => (writer ? voiceOf(writer) : null), [writer]);
  useEffect(() => {
    if (!focusAsk) return;
    focusAsk = false;
    box.current?.focus();
  }, []);
  const kind: Kind = kindSet ?? found?.kind ?? 'article';
  const docLang: DocLang = langSet ?? docLangOf(request, lang);
  // Footnotes are how Arab and Kurdish universities cite; APA is how English-language journals do.
  const style: Style = styleSet ?? styleIn(request) ?? (docLang === 'en' ? 'apa' : 'footnotes');
  const settings: Settings = { kind, length: 'standard', lang: docLang, ...set };
  const target = targetOf(set, routes);
  const book = bookFor(set, target, efforts);
  // A model the plan cannot run is refused before a long run fails on its first request.
  const chosen = choiceOf(set, routes) ?? routes.choice;
  const onPlan = chosen.provider !== BUILT_IN || allows(plan, target.model);
  const logo = logoFor(logos, profile.university);
  const level = target.wire === 'anthropic' && effortsFor(target.model).length ? effortOf(book, target.model) : null;
  const agents = agentsOf(set);

  const setField = (k: keyof Profile, v: string) => {
    const next = { ...profile, [k]: v };
    setProfile(next);
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(next)); } catch { /* kept for this session only */ }
  };
  const keepLogos = (next: Logos) => {
    setLogos(next);
    // Storage that is full says so: a logo that seemed kept and is gone after
    // a restart is a cover printed without it.
    try { localStorage.setItem(LOGO_KEY, JSON.stringify(next)); setLogoUnkept(false); } catch { setLogoUnkept(true); }
  };

  const go = () => {
    if (!request.trim() || !ready || !onPlan || loading) return;
    const doc = newDoc({
      id: newId(),
      now: Date.now(),
      request,
      kind,
      lang: docLang,
      style,
      meta: { ...profile, ...cover },
      logo: logo || undefined,
      notes,
      pause,
    });
    onStart({ ...doc, ...set, files: files.length ? files : undefined, logoCaption: caption || undefined, voice: voice ?? undefined });
    setRequest('');
    setKindSet(null);
    setLangSet(null);
    setStyleSet(null);
    setVoiceSet(null);
    setFiles([]);
    setCover({ title: '', venue: '', presented: '' });
    setNotes('');
  };

  const field = (k: keyof Profile, label: string, wide = false) => (
    <label className={wide ? 'rsch-f rsch-wide' : 'rsch-f'}>
      <span>{label}</span>
      {k === 'authority'
        ? <textarea rows={2} value={profile[k]} onChange={(e) => setField(k, e.target.value)} dir="auto" />
        : <input value={profile[k]} onChange={(e) => setField(k, e.target.value)} dir="auto"
                 list={k === 'university' ? 'rsch-universities' : undefined} />}
    </label>
  );

  const label = [
    (menuOf(routes.providers).find((m) => m.provider === chosen.provider && m.model === target.model)?.label) ?? modelName(target.model),
    level ? effortLabel(level, t) : '',
    agents > 1 ? fill(t('{n} writers'), { n: agents }) : '',
  ].filter(Boolean).join(' · ');

  return (
    <>
      <div className="rsch-ask">
        <label className="rsch-ask-label" htmlFor="rsch-request">{t('What do you need?')}</label>
        <textarea id="rsch-request" ref={box} className="rsch-request" dir="auto" rows={4}
                  value={request} onChange={(e) => setRequest(e.target.value)}
                  placeholder={t('For example: a working paper on artificial intelligence in university teaching')}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); } }} />

        {/* The skill the words switched on, and the phrase that did it. When
            nothing was named it says so, rather than quietly picking one. */}
        <div className={`rsch-skill ${found || kindSet ? 'on' : ''}`}>
          <Icon name={found || kindSet ? 'check' : 'book'} size={12} />
          {kindSet
            ? <span>{fill(t('{kind}, chosen by you'), { kind: kindName(kind, t) })}</span>
            : found
              ? <span>{fill(t('{kind} — activated by “{phrase}”'), { kind: kindName(kind, t), phrase: found.trigger })}</span>
              : <span>{t('Name the kind of document, or choose one below.')}</span>}
        </div>

        <LangSwitch t={t} value={docLang} onChange={(l) => setLangSet(l)} />

        <VoicePicker t={t} people={people} value={voiceSet === null ? named?.id ?? '' : voiceSet} named={!!named && voiceSet === null}
                     onChange={(id) => setVoiceSet(id)} onPeople={() => toTab('people')} />

        <div className="rsch-opts">
          <select value={kind} onChange={(e) => setKindSet(e.target.value as Kind)} aria-label={t('Kind of document')}>
            {KINDS.map((k) => <option key={k.id} value={k.id}>{kindName(k.id, t)}</option>)}
          </select>
          <select value={style} onChange={(e) => setStyleSet(e.target.value as Style)} aria-label={t('Citation style')}>
            {STYLES.map((x) => <option key={x} value={x}>{styleName(x, t)}</option>)}
          </select>
        </div>

        <WriteSettings t={t} value={settings} onChange={setSet} routes={routes} efforts={efforts} plan={plan} />

        <DataField t={t} owner="" files={files} onChange={setFiles} onAdd={(got) => setFiles([...draft.files, ...got])}
                   target={target} book={book} lang={docLang} onError={onError} />

        <button className="rsch-more" onClick={() => setMore(!more)} aria-expanded={more}>
          <Icon name="chevron" size={11} />
          {t('Cover and notes')}
        </button>
        {more && (
          <div className="rsch-form">
            <label className="rsch-f rsch-wide">
              <span>{t('Title (leave empty to let it be proposed)')}</span>
              <input value={cover.title} onChange={(e) => setCover({ ...cover, title: e.target.value })} dir="auto" />
            </label>
            {field('author', t('Your name'))}
            <label className="rsch-f rsch-wide">
              <span>{t('The line above your name — e.g. a working paper presented by the student')}</span>
              <input value={cover.presented} onChange={(e) => setCover({ ...cover, presented: e.target.value })} dir="auto" />
            </label>
            {field('supervisor', t('Supervisor'))}
            {field('supervisorTitle', t('Supervisor’s title'))}
            {field('university', t('University'), true)}
            {field('college', t('College'))}
            {field('department', t('Department'))}
            {field('field', t('Specialisation'))}
            {field('city', t('City'))}
            <label className="rsch-f rsch-wide">
              <span>{t('Conference or journal')}</span>
              <input value={cover.venue} onChange={(e) => setCover({ ...cover, venue: e.target.value })} dir="auto" />
            </label>
            {field('authority', t('Above the university on the cover — country, ministry (one per line)'), true)}
            <div className="rsch-logo rsch-wide">
              {logo ? <img src={logo} alt="" /> : <span className="rsch-logo-none"><Icon name="image" size={16} /></span>}
              <span className="rsch-logo-what">
                <b dir="auto">{profile.university.trim() ? fill(t('Logo of {university}'), { university: profile.university.trim() }) : t('Logo for the cover')}</b>
                <span>{t('Kept for this university: choose it again and its logo comes with it.')}</span>
              </span>
              <button className="ghost" onClick={() => pickLogo((url) => {
                keepLogos(withLogo(logos, profile.university, url));
                setLogoError(false);
              }, () => setLogoError(true))}>{logo ? t('Change the logo') : t('Add the university’s logo')}</button>
              {logo && <button className="ghost" onClick={() => keepLogos(withLogo(logos, profile.university, ''))}>{t('Remove')}</button>}
            </div>
            {logoError && <p className="rsch-bad rsch-wide">{t('Use a PNG or JPEG picture under 400 KB.')}</p>}
            {logoUnkept && <p className="rsch-bad rsch-wide">{t('The logo could not be kept on this machine. It goes on this document’s cover only.')}</p>}
            <label className="rsch-check rsch-wide">
              <input type="checkbox" checked={caption} onChange={(e) => setCaption(e.target.checked)} />
              <span>{t('Print the university’s name under the logo')}</span>
            </label>
            <label className="rsch-f rsch-wide">
              <span>{t('Your notes and data')}</span>
              <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} dir="auto"
                        placeholder={t('Your sample, your results, a structure your university requires. The document uses them as given and never invents data.')} />
            </label>
            <label className="rsch-check rsch-wide">
              <input type="checkbox" checked={pause} onChange={(e) => setPause(e.target.checked)} />
              <span>{t('Let me check the sources and the outline before anything is written')}</span>
            </label>
          </div>
        )}
        <datalist id="rsch-universities">{UNIVERSITIES.map((u) => <option key={u} value={u} />)}</datalist>

        {!onPlan && <p className="rsch-warn rsch-in">{fill(t('Your plan does not include {model}. Choose another model above.'), { model: modelName(target.model) })}</p>}
        <button className="sb-cta-go rsch-go" disabled={!request.trim() || !ready || !onPlan || loading} onClick={go}
                title={loading ? t('Wait until your files have been read.') : undefined}>
          <Icon name="sparkle" size={13} />
          {fill(t('Write it with {model}'), { model: label })}
        </button>
      </div>

    </>
  );
}

/**
 * Whose manner to write in. The researchers come from the Researchers tab;
 * one the request names is chosen until another is chosen by hand, and the
 * line under the menu says which did it, as the skill chip does for kinds.
 */
function VoicePicker({ t, people, value, named, onChange, disabled, kept, onPeople }: {
  t: (s: string) => string;
  people: Researcher[];
  value: string;
  /** The choice came from the request's words. */
  named?: boolean;
  onChange: (id: string) => void;
  disabled?: boolean;
  /**
   * A document's own copy of a voice, listed even when its researcher is
   * gone or has too little to write from — or it could never be taken off.
   */
  kept?: { id: string; name: string };
  /** Where to add researchers; without it, an empty list shows nothing. */
  onPeople?: () => void;
}) {
  // What `voiceOf` will accept, without measuring every paper on every
  // keystroke: a learned guide, or enough words to measure.
  const usable = people.filter((r) => r.guide || r.samples.reduce((n, x) => n + x.words, 0) >= MIN_WORDS);
  const orphan = kept && !usable.some((r) => r.id === kept.id) ? kept : undefined;
  const who = usable.find((r) => r.id === value) ?? (orphan && orphan.id === value ? orphan : undefined);
  if (!usable.length && !orphan) {
    if (!onPeople) return null;
    return (
      <button type="button" className="rsch-voice-empty" onClick={onPeople} disabled={disabled}>
        <Icon name="person" size={12} />
        <span>{t('Write in a researcher’s style — add them in Researchers')}</span>
      </button>
    );
  }
  return (
    <div className={`rsch-voice ${who ? 'on' : ''}`}>
      <Icon name="person" size={12} />
      <select value={who ? value : ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={t('Writing style')}>
        <option value="">{t('In your own style')}</option>
        {orphan && <option value={orphan.id}>{fill(t('In the style of {name}'), { name: orphan.name })}</option>}
        {usable.map((r) => (
          <option key={r.id} value={r.id}>{fill(t('In the style of {name}'), { name: `${r.title} ${r.name}`.trim() })}</option>
        ))}
      </select>
      {who && named && <small>{t('named in your request')}</small>}
      {who && who !== orphan && !(who as Researcher).guide && <small>{t('measured only — learn the style for a closer match')}</small>}
    </div>
  );
}

function DocRow({ doc, t, onOpen }: { doc: Doc; t: (s: string) => string; onOpen: () => void }) {
  const job = jobs.get(doc.id);
  const written = doc.sections.filter((s) => s.state === 'done').length;
  return (
    <li>
      <button className="rsch-doc" onClick={onOpen}>
        <span className={`rsch-dot ${job ? 'is-live' : doc.stage === 'done' ? 'is-done' : doc.error ? 'is-bad' : ''}`} aria-hidden="true" />
        <span className="rsch-doc-what">
          <b dir="auto">{doc.meta.title || doc.request}</b>
          <span>
            {kindName(doc.kind, t)}
            {' · '}
            {job ? stageName(job.progress.stage, t)
              : doc.stage === 'done' ? t('Finished')
              : doc.sections.length ? fill(t('{done} of {n} written'), { done: written, n: doc.sections.length })
              : stageName(doc.stage, t)}
            {' · '}
            {whenOf(doc.updated)}
          </span>
        </span>
      </button>
    </li>
  );
}

// ── one document ──────────────────────────────────────────────────────────

type Tab = 'outline' | 'sources' | 'check' | 'details';

/** The tab a document was left on, by document: coming back to a thesis comes back to where it was. */
const docTabs = new Map<string, Tab>();

function DocView({ doc, t, routes, efforts, plan, ready, inFull, docs, people, onBack, onRead, onPdf, begin, onError }: {
  doc: Doc;
  docs: Doc[];
  people: Researcher[];
  t: (s: string) => string;
  routes: Routes;
  efforts: EffortBook;
  plan: PlanSummary | null;
  ready: boolean;
  /** Drawn in the full window, beside the document — where there is no reader to open. */
  inFull: boolean;
  onBack: () => void;
  onRead: (sectionId?: string) => void;
  /** Write the document as a PDF to a path the save panel returned. */
  onPdf: (path: string) => Promise<void>;
  begin: (doc: Doc, work: Work) => void;
  onError: (m: string) => void;
}) {
  const [tab, setTabNow] = useState<Tab>(docTabs.get(doc.id) ?? 'outline');
  const setTab = (x: Tab) => { docTabs.set(doc.id, x); setTabNow(x); };
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const job = jobs.get(doc.id);
  const busy = !!job;
  // A file still being read belongs in the document before anything is written from it.
  const loading = readsOf(doc.id).length > 0;
  const k = kindOf(doc.kind);
  const done = doc.sections.filter((s) => s.state === 'done').length;
  const words = useMemo(() => wordsOf(doc), [doc]);
  const canWrite = doc.sections.some((s) => s.state === 'waiting' || s.state === 'failed');
  const paused = !busy && doc.stage === 'writing' && doc.sections.length > 0 && done === 0 && canWrite;
  const somethingWritten = done > 0;
  // Stopped part-way through writing — paused, or closed — with parts left to write.
  const halfway = !busy && doc.stage === 'writing' && done > 0 && canWrite;

  const change = (next: Partial<Doc>) => keep({ ...doc, ...next, updated: Date.now() });

  const saveWord = async () => {
    if (busy) return;
    setSaving(true);
    setSaved('');
    try {
      const path = await savePanel({
        title: t('Save as Word'),
        defaultPath: fileNameFor(doc),
        filters: [{ name: 'Word', extensions: ['docx'] }],
      });
      // Cancelling the save panel is an answer, not a failure.
      if (!path) return;
      const data = await docxBase64(doc);
      await invoke('export_write_docx', { path, data });
      setSaved(path);
    } catch (e) {
      onError(explain(e, t('save the Word document')));
    } finally {
      setSaving(false);
    }
  };

  const savePdf = async () => {
    if (busy) return;
    setSaving(true);
    setSaved('');
    try {
      const path = await savePanel({
        title: t('Save as PDF'),
        defaultPath: fileNameFor(doc).replace(/\.docx$/i, '.pdf'),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (!path) return;
      await onPdf(path);
      setSaved(path);
    } catch (e) {
      onError(explain(e, t('save the PDF')));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const yes = await ask.confirm({
      title: t('Delete this document?'),
      body: `${doc.meta.title || doc.request}\n\n${t('Its outline, text and sources are removed from this machine. A Word file you saved is not touched.')}`,
      confirmLabel: t('Delete'),
      danger: true,
    });
    if (!yes) return;
    gone.add(doc.id);
    stop(doc.id);
    known.delete(doc.id);
    edits.delete(doc.id);
    void deleteDoc(doc.id);
    notify();
    onBack();
  };

  // The stages as a row of steps, so where a long run is can be read at a glance.
  const ORDER: Stage[] = ['planning', 'sources', 'outline', 'writing', 'abstract', 'done'];
  const now = job ? job.progress.stage : doc.stage;
  const at = ORDER.indexOf(now === 'new' ? 'planning' : now);
  const liveIndex = job?.progress.index;
  const live = liveIndex !== undefined ? doc.sections[liveIndex] : undefined;
  const writing = new Set((job?.progress.writers ?? []).map((w) => w.index));
  if (liveIndex !== undefined) writing.add(liveIndex);
  const target = targetOf(doc, routes);

  return (
    <div className="rsch-docview">
      <div className="rsch-top">
        <button className="sb-act rsch-back" onClick={onBack} title={t('Back')} aria-label={t('Back')}>
          <Icon name="chevron" size={14} />
        </button>
        <div className="rsch-title">
          <b dir="auto">{doc.meta.title || doc.request}</b>
          <span>{kindName(doc.kind, t)} · {langName(doc.lang, t)} · {styleName(doc.style, t)}</span>
          {doc.voice && <span className="rsch-voice-line"><Icon name="person" size={11} />{fill(t('In the style of {name}'), { name: doc.voice.name })}</span>}
        </div>
        {!inFull && (
          <button className="sb-act" onClick={() => toggleResearchFull(true)} title={t('Full screen')} aria-label={t('Full screen')}>
            <Icon name="maximise" size={14} />
          </button>
        )}
        <button className="sb-act" onClick={() => void remove()} title={t('Delete this document')} aria-label={t('Delete this document')}>
          <Icon name="close" size={14} />
        </button>
      </div>

      <ol className="rsch-steps" aria-label={t('Progress')}>
        {ORDER.filter((s) => s !== 'abstract' || k.abstract !== 'none').map((s) => {
          const i = ORDER.indexOf(s);
          const state = i < at || doc.stage === 'done' ? 'is-done' : i === at && busy ? 'is-live' : '';
          return <li key={s} className={state}><i aria-hidden="true" />{stageName(s, t)}</li>;
        })}
      </ol>

      <div className="rsch-status">
        {busy && (
          <p>
            {live && writing.size <= 1
              ? fill(t('Writing “{heading}”…'), { heading: live.heading })
              : stageName(job.progress.stage, t) + '…'}
            {job.progress.note ? <span className="rsch-note"> {noteText(job.progress.note, t)}</span> : null}
          </p>
        )}
        {busy && <RunStatus t={t} doc={doc} job={job} />}
        {!busy && paused && <p>{t('Check the sources and the outline, then write.')}</p>}
        {!busy && halfway && !doc.error && <p>{fill(t('Paused — {done} of {n} written. Resume when you are ready.'), { done, n: doc.sections.length })}</p>}
        {busy && job.pausing && <p className="rsch-note">{t('Pausing — the writers are finishing the parts they have.')}</p>}
        {!busy && doc.error && <p className="rsch-bad">{errorText(doc.error, t)}</p>}
        {doc.sections.length > 0 && (
          <p className="rsch-count">
            {fill(t('{done} of {n} written'), { done, n: doc.sections.length })}
            {' · '}
            {fill(t('{n} words'), { n: words.toLocaleString() })}
            {' · '}
            {fill(t('{n} sources'), { n: doc.sources.filter((s) => s.use).length })}
          </p>
        )}
        {busy && live && job.progress.live && writing.size <= 1 && (
          <p className="rsch-live" dir="auto">{job.progress.live.slice(-240)}</p>
        )}
      </div>

      <div className="rsch-acts">
        {busy
          ? (
            <>
              {job.pausable && (
                <button className="ghost" disabled={job.pausing} onClick={() => pause(doc.id)}
                        title={t('The parts being written are finished and kept; nothing new starts.')}>
                  <Icon name="pause" size={12} />{job.pausing ? t('Pausing…') : t('Pause')}
                </button>
              )}
              <button className="ghost" onClick={() => stop(doc.id)}
                      title={t('Stops at once. The parts being written now are not kept.')}>
                <Icon name="stop" size={12} />{t('Stop now')}
              </button>
            </>
          )
          : doc.stage !== 'done' && (
            <button className="sb-cta-go" disabled={!ready || loading}
                    title={loading ? t('Wait until your files have been read.') : undefined}
                    // "Let me check first" holds on a resume too: a run stopped
                    // while searching must not write straight through on Continue.
                    onClick={() => begin(doc, {
                      how: 'run',
                      stopBefore: doc.pause && EARLY.includes(doc.stage) ? 'writing' : undefined,
                    })}>
              <Icon name="play" size={12} />
              {paused ? t('Write the document') : doc.stage === 'new' ? t('Start') : halfway ? t('Resume') : t('Continue')}
            </button>
          )}
        {!inFull && (
          <button className="ghost" disabled={!doc.sections.length} onClick={() => onRead()}>
            <Icon name="book" size={12} />{t('Read the document')}
          </button>
        )}
        <button className="ghost" disabled={busy || !somethingWritten || saving} onClick={() => void saveWord()}
                title={busy ? t('Stop the writing before saving.') : undefined}>
          <Icon name="file" size={12} />{t('Save as Word…')}
        </button>
        <button className="ghost" disabled={busy || !somethingWritten || saving} onClick={() => void savePdf()}
                title={busy ? t('Stop the writing before saving.') : undefined}>
          <Icon name="file" size={12} />{t('Save as PDF…')}
        </button>
      </div>
      {saved && (
        <div className="rsch-saved-row">
          <p className="rsch-saved" dir="auto">{fill(t('Saved to {path}'), { path: saved })}</p>
          <button className="ghost" onClick={() => invoke('reveal_path', { path: saved }).catch((e: unknown) => onError(explain(e, t('show the file'))))}>
            <Icon name="folder" size={12} />{IS_MAC ? t('Show in Finder') : t('Show in Explorer')}
          </button>
        </div>
      )}
      {saved && /\.docx$/i.test(saved) && <p className="rsch-lede">{t('Word asks to update the fields when it opens the file: say yes, and the table of contents gets its page numbers.')}</p>}

      <div className="rsch-tabs" role="tablist">
        {(['outline', 'sources', 'check', 'details'] as const).map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>
            {x === 'outline' ? t('Outline') : x === 'sources' ? t('Sources') : x === 'check' ? t('Originality') : t('Details')}
          </button>
        ))}
      </div>

      {tab === 'outline' && (
        <OutlineTab doc={doc} t={t} busy={busy} writing={writing} onRead={onRead}
                    onChange={change} onRewrite={(index, redo) => begin(doc, { how: 'rewrite', index, redo })} ready={ready && !loading} />
      )}
      {tab === 'sources' && <SourcesTab doc={doc} t={t} busy={busy} onChange={change} onError={onError} />}
      {tab === 'check' && (
        <ResearchOriginality t={t} doc={doc} docs={docs} people={people} lang={doc.lang} target={target} book={bookFor(doc, target, efforts)}
                             canRewrite={ready && !busy && !loading} onRead={(id) => onRead(id)}
                             onRewrite={(index, redo) => begin(doc, { how: 'rewrite', index, redo })} onError={onError} />
      )}
      {tab === 'details' && (
        <DetailsTab doc={doc} t={t} busy={busy} onChange={change} routes={routes} efforts={efforts} plan={plan} people={people}
                    onAbstract={() => begin(doc, { how: 'abstract' })} ready={ready && !loading} onError={onError} />
      )}

      <p className="rsch-lede rsch-honest">
        {t('A draft to build on. Read every claim and check every source before you submit it; the gaps marked in yellow are yours to fill.')}
      </p>
      {/* Held here for the model's sake too: which one, and how hard it thinks. */}
      <p className="rsch-lede">
        {/* The model the document was written with, recorded when its run
            started — not whichever one the composer shows now. */}
        {fill(t('Written with {model}.'), { model: modelName(doc.model ?? target.model) })}
        {effortOf(bookFor(doc, target, efforts), target.model) ? ` · ${effortLabel(effortOf(bookFor(doc, target, efforts), target.model)!, t)}` : ''}
        {agentsOf(doc) > 1 ? ` · ${fill(t('{n} writers'), { n: agentsOf(doc) })}` : ''}
      </p>
    </div>
  );
}

function OutlineTab({ doc, t, busy, writing, onRead, onChange, onRewrite, ready }: {
  doc: Doc;
  t: (s: string) => string;
  busy: boolean;
  /** The parts being written right now — one a writer. */
  writing: ReadonlySet<number>;
  onRead: (sectionId?: string) => void;
  onChange: (next: Partial<Doc>) => void;
  onRewrite: (index: number, redo: string) => void;
  ready: boolean;
}) {
  if (!doc.sections.length) {
    return <p className="ft-empty">{busy ? t('The outline comes after the sources.') : t('No outline yet.')}</p>;
  }
  const set = (i: number, next: Partial<Section>) =>
    onChange({ sections: doc.sections.map((s, j) => (j === i ? { ...s, ...next } : s)) });

  const redo = async (i: number) => {
    const how = await ask.text({
      title: fill(t('Rewrite “{heading}”'), { heading: doc.sections[i].heading }),
      value: '',
      placeholder: t('What to change — shorter, more on the method, add a comparison table… (optional)'),
      confirmLabel: t('Rewrite'),
      optional: true,
    });
    if (how === null) return;
    onRewrite(i, how.trim());
  };

  const rename = async (i: number) => {
    const name = await ask.text({ title: t('Rename this part'), value: doc.sections[i].heading, confirmLabel: t('Save') });
    if (name === null || !name.trim()) return;
    set(i, { heading: name.trim() });
  };

  return (
    <ol className="rsch-outline">
      {doc.sections.map((s, i) => (
        <li key={s.id} className={`rsch-sec ${LEVEL[s.level]} ${writing.has(i) ? 'is-live' : ''}`}>
          <button className="rsch-sec-main" onClick={() => onRead(s.id)} title={s.brief || undefined}>
            <span className={`rsch-dot ${s.state === 'done' ? 'is-done' : s.state === 'failed' ? 'is-bad' : s.state === 'writing' || writing.has(i) ? 'is-live' : s.state === 'author' ? 'is-yours' : ''}`}
                  aria-label={stateName(writing.has(i) ? 'writing' : s.state, t)} />
            <span className="rsch-sec-name" dir="auto">{s.heading}</span>
            <span className="rsch-sec-n">{s.text ? wordCount(s.text).toLocaleString() : s.words ? `~${s.words.toLocaleString()}` : ''}</span>
          </button>
          {!busy && (
            <span className="rsch-sec-acts">
              {s.state !== 'author' && (s.state === 'done' || s.state === 'failed') && (
                <button className="sb-act" disabled={!ready} onClick={() => void redo(i)} title={t('Rewrite')} aria-label={t('Rewrite')}>
                  <Icon name="sparkle" size={12} />
                </button>
              )}
              <button className="sb-act" onClick={() => void rename(i)} title={t('Rename this part')} aria-label={t('Rename this part')}>
                <Icon name="pencil" size={12} />
              </button>
              {s.state !== 'done' && (
                <button className={`sb-act ${s.state === 'author' ? 'on' : ''}`}
                        onClick={() => set(i, { state: s.state === 'author' ? 'waiting' : 'author' })}
                        title={s.state === 'author' ? t('Let the model write this part') : t('I will write this part myself')}
                        aria-label={s.state === 'author' ? t('Let the model write this part') : t('I will write this part myself')}>
                  <Icon name="check" size={12} />
                </button>
              )}
              {s.state !== 'done' && (
                <button className="sb-act" onClick={() => onChange({ sections: doc.sections.filter((_, j) => j !== i) })}
                        title={t('Remove this part')} aria-label={t('Remove this part')}>
                  <Icon name="close" size={12} />
                </button>
              )}
            </span>
          )}
          {s.state === 'failed' && s.error && <p className="rsch-bad">{errorText(s.error, t)}</p>}
        </li>
      ))}
    </ol>
  );
}

/** The kinds of reference a researcher adds by hand: the ones a university library holds that no index does. */
type HandKind = 'article' | 'book' | 'dictionary' | 'thesis' | 'law';

interface Hand {
  type: HandKind;
  authors: string;
  title: string;
  year: string;
  /** The journal, the university of a thesis, or the gazette a law was published in. */
  venue: string;
  volume: string;
  issue: string;
  publisher: string;
  city: string;
  edition: string;
  /** A law's number. */
  number: string;
  /** When a law was published, as the gazette gives it. */
  issued: string;
}

const BLANK_HAND: Hand = {
  type: 'article', authors: '', title: '', year: '', venue: '', volume: '', issue: '',
  publisher: '', city: '', edition: '', number: '', issued: '',
};

function SourcesTab({ doc, t, busy, onChange, onError }: {
  doc: Doc;
  t: (s: string) => string;
  busy: boolean;
  onChange: (next: Partial<Doc>) => void;
  onError: (m: string) => void;
}) {
  const [doi, setDoi] = useState('');
  const [looking, setLooking] = useState(false);
  const [byHand, setByHand] = useState(false);
  const [hand, setHand] = useState<Hand>(BLANK_HAND);
  const [searching, setSearching] = useState(false);
  const cited = useMemo(() => new Set(citeContext(doc).order), [doc]);

  // Keys continue past every one the document names anywhere — in its text
  // and outline as well as its list — so a marker left in the text can never
  // come to point at a work added later.
  const add = (s: Source) => onChange({ sources: merge(doc.sources, [s], 1, highestKey(doc)) });

  /**
   * Works that arrived after a wait, added to the document as it is now —
   * not to the copy this tab was drawn with before the request went out,
   * which would undo whatever changed meanwhile. A run that started during
   * the wait owns the document; the works are not forced in under it.
   */
  const addLater = (found: Source[], max: number): boolean => {
    const cur = known.get(doc.id);
    if (!cur || gone.has(doc.id)) return false;
    if (jobs.has(doc.id)) { onError(t('The document is being written. Add sources when it stops.')); return false; }
    keep({ ...cur, sources: merge(cur.sources, found, max, highestKey(cur)), updated: Date.now() });
    return true;
  };

  const byDoi = async () => {
    const clean = cleanDoi(doi);
    if (!clean) { onError(t('That is not a DOI. A DOI starts with 10. and a slash.')); return; }
    if (doc.sources.some((s) => s.doi === clean)) { setDoi(''); return; }
    setLooking(true);
    try {
      const found = await lookupDoi(clean, get);
      if (!found) onError(fill(t('No record was found for {doi}. Check it against the paper.'), { doi: clean }));
      else if (addLater([found], 1)) setDoi('');
    } catch (e) {
      onError(explain(e, t('look up that DOI')));
    } finally {
      setLooking(false);
    }
  };

  const again = async () => {
    setSearching(true);
    try {
      // The plan's own queries; without them, the title the researcher can
      // see and edit — never the request as typed, which may hold more than
      // a search engine should be told (SAFETY.md says so).
      const got = await search(doc.queries.length ? doc.queries : [doc.meta.title || kindName(doc.kind, t)], 15, get);
      if (!got.sources.length) onError(t('Nothing new was found.'));
      else addLater(got.sources, 15);
    } catch (e) {
      onError(explain(e, t('search for sources')));
    } finally {
      setSearching(false);
    }
  };

  const inp = (k: keyof Omit<Hand, 'type'>, label: string, wide = false) => (
    <label className={wide ? 'rsch-f rsch-wide' : 'rsch-f'}>
      <span>{label}</span>
      <input value={hand[k]} onChange={(e) => setHand({ ...hand, [k]: e.target.value })} dir="auto" />
    </label>
  );

  const addByHand = () => {
    const title = hand.title.trim();
    if (!title) return;
    const authors = hand.authors.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [family, ...given] = l.split(/[,،]/);
      return given.length ? { family: family.trim(), given: given.join(' ').trim() } : { family: l };
    });
    const year = Number.parseInt(hand.year.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)), 10);
    const opt = (v: string) => v.trim() || undefined;
    const bookish = hand.type === 'book' || hand.type === 'dictionary';
    add({
      key: '', title, year: Number.isFinite(year) ? year : undefined,
      // Legislation has no author; the state enacted it.
      authors: hand.type === 'law' ? [] : authors,
      venue: bookish ? undefined : opt(hand.venue),
      volume: hand.type === 'article' ? opt(hand.volume) : undefined,
      issue: hand.type === 'article' || hand.type === 'law' ? opt(hand.issue) : undefined,
      publisher: bookish ? opt(hand.publisher) : undefined,
      city: bookish ? opt(hand.city) : undefined,
      edition: bookish ? opt(hand.edition) : undefined,
      number: hand.type === 'law' ? opt(hand.number) : undefined,
      issued: hand.type === 'law' ? opt(hand.issued) : undefined,
      type: hand.type, origin: 'person', verified: false, use: true,
    });
    setHand({ ...BLANK_HAND, type: hand.type });
    setByHand(false);
  };

  const toggle = (key: string) =>
    onChange({ sources: doc.sources.map((s) => (s.key === key && !s.retracted ? { ...s, use: !s.use } : s)) });

  return (
    <div className="rsch-sources">
      <div className="rsch-row">
        <input className="rsch-doi" value={doi} onChange={(e) => setDoi(e.target.value)} placeholder={t('Add by DOI')} disabled={busy}
               dir="ltr" onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void byDoi(); }} />
        <button className="ghost" disabled={busy || !doi.trim() || looking} onClick={() => void byDoi()}>{t('Add')}</button>
      </div>
      <div className="rsch-row">
        <button className="ghost" disabled={busy} onClick={() => setByHand((v) => !v)} aria-expanded={byHand}>{t('Add a reference by hand')}</button>
        <button className="ghost" disabled={busy || searching} onClick={() => void again()}>{searching ? t('Searching…') : t('Search again')}</button>
      </div>
      {byHand && (
        <div className="rsch-form">
          <label className="rsch-f rsch-wide">
            <span>{t('Kind')}</span>
            <select value={hand.type} onChange={(e) => setHand({ ...hand, type: e.target.value as HandKind })}>
              <option value="article">{t('Journal article')}</option>
              <option value="book">{t('Book')}</option>
              <option value="dictionary">{t('Dictionary')}</option>
              <option value="thesis">{t('Thesis or dissertation')}</option>
              <option value="law">{t('Law, regulation or decision')}</option>
            </select>
          </label>
          {hand.type !== 'law' && (
            <label className="rsch-f rsch-wide">
              <span>{t('Authors — one per line: family name, given names')}</span>
              <textarea rows={2} value={hand.authors} onChange={(e) => setHand({ ...hand, authors: e.target.value })} dir="auto" />
            </label>
          )}
          <label className="rsch-f rsch-wide">
            <span>{hand.type === 'law' ? t('Name, without its number and year') : t('Title')}</span>
            <input value={hand.title} onChange={(e) => setHand({ ...hand, title: e.target.value })} dir="auto" />
          </label>
          {hand.type === 'law' && inp('number', t('Number'))}
          {inp('year', t('Year'))}
          {hand.type === 'article' && inp('venue', t('Journal'), true)}
          {hand.type === 'article' && inp('volume', t('Volume'))}
          {(hand.type === 'article' || hand.type === 'law') && inp('issue', t('Issue'))}
          {hand.type === 'thesis' && inp('venue', t('University'), true)}
          {(hand.type === 'book' || hand.type === 'dictionary') && inp('publisher', t('Publisher'))}
          {(hand.type === 'book' || hand.type === 'dictionary') && inp('city', t('City'))}
          {(hand.type === 'book' || hand.type === 'dictionary') && inp('edition', t('Edition'))}
          {hand.type === 'law' && inp('venue', t('Published in — the official gazette'), true)}
          {hand.type === 'law' && inp('issued', t('Date of publication'))}
          <button className="sb-cta-go rsch-wide" disabled={busy || !hand.title.trim()} onClick={addByHand}>{t('Add')}</button>
        </div>
      )}
      <p className="rsch-lede">
        {fill(t('{used} of {n} in use · {cited} cited so far'), {
          used: doc.sources.filter((s) => s.use).length, n: doc.sources.length, cited: cited.size,
        })}
      </p>
      {!doc.sources.length && (
        <p className="ft-empty">{busy ? t('Searching OpenAlex and Crossref…') : t('No sources yet. Without them the document cites nothing.')}</p>
      )}
      <ul className="rsch-srcs">
        {doc.sources.map((s) => (
          <li key={s.key} className={s.use ? '' : 'off'}>
            <label className="rsch-src">
              <input type="checkbox" checked={s.use} disabled={s.retracted || busy} onChange={() => toggle(s.key)}
                     aria-label={t('Use in the document')} />
              <span className="rsch-src-what">
                <b dir="auto">{s.title}</b>
                {/* A line of only a year has no letters to set its direction
                    by, and "auto" would put it on the left of an Arabic list. */}
                <span dir={s.authors.length || s.venue ? 'auto' : undefined}>
                  {[
                    s.authors.slice(0, 3).map((a) => a.family).join(', ') + (s.authors.length > 3 ? ' …' : ''),
                    s.year ? String(s.year) : '',
                    s.venue ?? '',
                  ].filter(Boolean).join(' · ')}
                </span>
                <span className="rsch-tags">
                  {cited.has(s.key) && <em className="is-cited">{t('Cited')}</em>}
                  {s.retracted && <em className="is-bad">{t('Retracted')}</em>}
                  {s.origin === 'person' && <em>{s.verified ? t('Added by you') : t('Added by you — not verified')}</em>}
                  {s.origin === 'model' && <em className="is-check">{t('Proposed by the model — check it against the official text')}</em>}
                  {s.type === 'law' && s.number && <em>{fill(t('No. {n}'), { n: s.number })}</em>}
                  {s.doi && <code dir="ltr">{s.doi}</code>}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DetailsTab({ doc, t, busy, onChange, onAbstract, ready, routes, efforts, plan, people, onError }: {
  doc: Doc;
  people: Researcher[];
  t: (s: string) => string;
  busy: boolean;
  onChange: (next: Partial<Doc>) => void;
  onAbstract: () => void;
  ready: boolean;
  routes: Routes;
  efforts: EffortBook;
  plan: PlanSummary | null;
  onError: (m: string) => void;
}) {
  const [logoError, setLogoError] = useState(false);
  const setMeta = (k: keyof Meta, v: string) => onChange({ meta: { ...doc.meta, [k]: v } });
  const field = (k: keyof Meta, label: string, wide = false) => (
    <label className={wide ? 'rsch-f rsch-wide' : 'rsch-f'}>
      <span>{label}</span>
      {k === 'authority'
        ? <textarea rows={2} value={doc.meta[k]} onChange={(e) => setMeta(k, e.target.value)} dir="auto" disabled={busy} />
        : <input value={doc.meta[k]} onChange={(e) => setMeta(k, e.target.value)} dir="auto" disabled={busy} />}
    </label>
  );
  const statement = statementOf(doc);
  const k = kindOf(doc.kind);
  const target = targetOf(doc, routes);
  return (
    <div className="rsch-form">
      {/* How the rest is written: a change here applies to the parts not yet
          written, and to any written again. */}
      <div className="rsch-wide">
        {/* The outline and the title are written in the language; changing it
            under them would put Arabic chapters under English headings. */}
        <LangSwitch t={t} value={doc.lang} disabled={busy || doc.sections.length > 0}
                    // Out of English, the document takes the numerals its
                    // language prints; within Arabic and Kurdish, the choice stays.
                    onChange={(l) => onChange({ lang: l, digits: l === 'en' ? 'western' : doc.lang === 'en' ? 'eastern' : doc.digits ?? 'eastern' })} />
        {doc.sections.length > 0 && <p className="rsch-lede">{t('The outline is written in this language. For another, ask for a new document.')}</p>}
      </div>
      <div className="rsch-wide">
        <WriteSettings t={t} value={doc} routes={routes} efforts={efforts} plan={plan} disabled={busy}
                       onChange={(next) => onChange(next)} />
      </div>
      <div className="rsch-wide">
        {/* A copy is taken when chosen: relearning the researcher later
            does not change a document half-written in their manner. */}
        <VoicePicker t={t} people={people} value={doc.voice?.id ?? ''} disabled={busy}
                     kept={doc.voice ? { id: doc.voice.id, name: doc.voice.name } : undefined}
                     onChange={(id) => {
                       const r = personOf(id);
                       onChange({ voice: r ? voiceOf(r) ?? undefined : undefined });
                     }} />
        {/* The copy was taken when the style was chosen; a style learned
            again since reaches the document only when asked. */}
        {doc.voice && personOf(doc.voice.id) && (
          <button type="button" className="ghost rsch-voice-refresh" disabled={busy}
                  onClick={() => {
                    const r = personOf(doc.voice?.id);
                    const v = r ? voiceOf(r) : null;
                    if (v) onChange({ voice: v });
                  }}>
            <Icon name="sparkle" size={11} />{t('Use their latest style')}
          </button>
        )}
        {doc.voice && !people.some((r) => r.id === doc.voice?.id) && (
          <p className="rsch-lede">{fill(t('Written in the style of {name}, who is no longer in your researchers. The style stays with this document.'), { name: doc.voice.name })}</p>
        )}
        {doc.sections.some((s) => s.state === 'done') && <p className="rsch-lede">{t('A new style applies to the parts written from now on, and to any part written again.')}</p>}
      </div>
      <DataField t={t} owner={doc.id} files={doc.files ?? []} onChange={(files) => onChange({ files })}
                 onAdd={(got) => {
                   // Added to the document as it is when the read ends, which
                   // may be a minute on: not to the copy drawn when it began.
                   const cur = known.get(doc.id);
                   if (!cur || gone.has(doc.id)) return;
                   if (jobs.has(doc.id)) { onError(t('The document is being written. Attach files when it stops.')); return; }
                   keep({ ...cur, files: [...(cur.files ?? []), ...got], updated: Date.now() });
                 }}
                 target={target} book={bookFor(doc, target, efforts)} lang={doc.lang} disabled={busy} onError={onError} />
      <label className="rsch-f">
        <span>{t('Citation style')}</span>
        <select value={doc.style} disabled={busy} onChange={(e) => onChange({ style: e.target.value as Style })}>
          {STYLES.map((s) => <option key={s} value={s}>{styleName(s, t)}</option>)}
        </select>
      </label>
      <p className="rsch-lede rsch-wide">{t('Changing the style rebuilds every citation and the reference list. Nothing is rewritten.')}</p>
      {field('title', t('Title'), true)}
      {doc.lang !== 'en' && field('titleEn', t('Title in English'), true)}
      {field('author', t('Your name'))}
      {field('presented', t('The line above your name — e.g. a working paper presented by the student'), true)}
      {field('supervisor', t('Supervisor'))}
      {field('supervisorTitle', t('Supervisor’s title'))}
      <label className="rsch-f rsch-wide">
        <span>{t('University')}</span>
        <input value={doc.meta.university} onChange={(e) => setMeta('university', e.target.value)} dir="auto" disabled={busy}
               list="rsch-universities-d" />
        <datalist id="rsch-universities-d">{UNIVERSITIES.map((u) => <option key={u} value={u} />)}</datalist>
      </label>
      {field('college', t('College'))}
      {field('department', t('Department'))}
      {field('field', t('Specialisation'))}
      {field('venue', t('Conference or journal'))}
      {field('city', t('City'))}
      {field('year', t('Year'))}
      {field('authority', t('Above the university on the cover — country, ministry (one per line)'), true)}
      {statement && <p className="rsch-statement rsch-wide" dir={RTL(doc.lang) ? 'rtl' : 'ltr'}>{statement}</p>}
      <div className="rsch-logo rsch-wide">
        {doc.logo ? <img src={doc.logo} alt="" /> : <span className="rsch-logo-none"><Icon name="image" size={16} /></span>}
        <button className="ghost" disabled={busy}
                onClick={() => pickLogo((url) => { onChange({ logo: url }); setLogoError(false); }, () => setLogoError(true))}>
          {doc.logo ? t('Change the logo') : t('Add the university’s logo')}
        </button>
        {doc.logo && <button className="ghost" disabled={busy} onClick={() => onChange({ logo: undefined })}>{t('Remove')}</button>}
      </div>
      {logoError && <p className="rsch-bad rsch-wide">{t('Use a PNG or JPEG picture under 400 KB.')}</p>}
      <label className="rsch-check rsch-wide">
        <input type="checkbox" checked={!!doc.logoCaption} disabled={busy} onChange={(e) => onChange({ logoCaption: e.target.checked || undefined })} />
        <span>{t('Print the university’s name under the logo')}</span>
      </label>
      <label className="rsch-f">
        <span>{t('Font in Word')}</span>
        <input list="rsch-fonts" value={doc.font ?? ''} disabled={busy} dir="ltr"
               placeholder={doc.lang === 'ar' ? 'Simplified Arabic' : doc.lang === 'en' ? 'Times New Roman' : 'Arial'}
               onChange={(e) => onChange({ font: e.target.value })} />
        <datalist id="rsch-fonts">{FONTS.map((f) => <option key={f} value={f} />)}</datalist>
      </label>
      {doc.lang !== 'en' && (
        <label className="rsch-f">
          <span>{t('Numbers')}</span>
          <select value={doc.digits ?? 'eastern'} disabled={busy}
                  onChange={(e) => onChange({ digits: e.target.value as 'eastern' | 'western' })}>
            <option value="eastern">{t('Arabic-Indic (١٢٣)')}</option>
            <option value="western">{t('Western (123)')}</option>
          </select>
        </label>
      )}
      <label className="rsch-f rsch-wide">
        <span>{t('Your notes and data')}</span>
        <textarea rows={4} value={doc.notes} disabled={busy} onChange={(e) => onChange({ notes: e.target.value })} dir="auto" />
      </label>
      {k.abstract !== 'none' && (
        <button className="ghost rsch-wide" disabled={busy || !ready || !doc.sections.some((s) => s.state === 'done')} onClick={onAbstract}>
          <Icon name="sparkle" size={12} />{doc.abstract ? t('Write the abstract again') : t('Write the abstract')}
        </button>
      )}
    </div>
  );
}

// ── paper, for the PDF ────────────────────────────────────────────────────

/**
 * The document on A4 sheets, with every footnote at the foot of the page its
 * marker is on and numbered from one on each page — as the Word file puts
 * them, and as Arab and Kurdish universities expect them. The reader shows a
 * part's notes after the part; paper cannot, because a page is where a
 * footnote belongs and the browser has no footnotes of its own to lay out.
 *
 * So the pages are made here. Everything is drawn once, off screen, at the
 * paper's own width and type, and measured: each piece's height, where each
 * footnote marker sits in it, how tall each note is. Then the pieces are
 * placed page by page, each page's notes counted against its room, a
 * paragraph that does not fit continued on the next page at a line boundary,
 * and a heading never left alone at the foot of one. Then the sheets are drawn
 * with their real numbers, and the PDF is printed from them.
 */

/** A footnote, known by its place in the document until its page gives it a number. */
interface PaperNote { id: number; runs: Rich[] }

/** One piece of the flow — the cover, a heading, a paragraph, a table, one list item, one reference. */
interface Piece {
  key: string;
  /** Begins a new page: a thesis's chapters, the abstract, the reference list. */
  newPage?: boolean;
  /** Has a page to itself: the cover of a thesis. */
  alone?: boolean;
  /** A heading, kept on the page with the start of what follows it. */
  keep?: boolean;
  /** Text that may continue on the next page, line by line. */
  flows?: boolean;
  notes: PaperNote[];
  draw: (num: (id: number) => string) => ReactNode;
}

/** A piece on a sheet: all of it, or `height` pixels of it from `from` down. */
interface Slice { piece: number; from: number; height?: number }
interface Sheet { slices: Slice[]; notes: number[] }

/** Pixels in a millimetre, as CSS draws them on screen and on paper alike. */
const MM = 96 / 25.4;
/** The written area of an A4 page inside 2.5 cm margins, the Word file's. */
const BODY_HEIGHT = (297 - 50) * MM;

/** Runs with their footnote markers numbered by `num`, which the pages decide. */
function paperRuns(runs: Rich[], ids: (number | undefined)[], num: (id: number) => string): ReactNode[] {
  return runs.map((r, i) => (r.note && ids[i] !== undefined
    ? <sup key={i} className="rsch-fn" data-fn={ids[i]}>{num(ids[i]!)}</sup>
    : runEl(r, i)));
}

/** The document as pieces, in reading order, each citation rendered once in that order. */
function piecesOf(doc: Doc): Piece[] {
  const ctx = citeContext(doc);
  const k = kindOf(doc.kind);
  const w = WORDS[doc.lang];
  const thesis = k.cover === 'thesis';
  const loc = (text: string) => localDigits(text, doc);
  const out: Piece[] = [];
  let next = 0;
  // A run of text with its notes given ids in document order: "مصدر سابق" is
  // decided by the citation context as it walks, so every run is rendered
  // exactly once, here, in the order it is read.
  const take = (raw: Rich[]) => {
    const runs = localRuns(raw, doc);
    const notes: PaperNote[] = [];
    const ids = runs.map((r) => {
      if (!r.note) return undefined;
      notes.push({ id: next, runs: r.note });
      return next++;
    });
    return { notes, show: (num: (id: number) => string) => paperRuns(runs, ids, num) };
  };
  const text = (runs: Parameters<typeof renderRuns>[0]) => take(renderRuns(runs, ctx));

  out.push({ key: 'cover', alone: thesis, notes: [], draw: () => <Cover doc={doc} /> });
  // Whether the next piece starts a page. A thesis's cover is a page of its
  // own; a paper's title runs straight into the text, as in the Word file.
  let fresh = thesis;
  const push = (piece: Piece) => { out.push(fresh ? { ...piece, newPage: true } : piece); fresh = false; };

  if (k.dedication) {
    for (const [head, hole] of [[w.dedication, w.holeDedication], [w.thanks, w.holeThanks]]) {
      fresh = true;
      push({ key: `front-${head}`, keep: true, notes: [], draw: () => <h2 className="rsch-paper-title">{head}</h2> });
      push({ key: `front-${head}-hole`, notes: [], draw: () => <p className="rsch-paper-center"><mark className="rsch-hole">{hole}</mark></p> });
    }
  }
  if (k.abstract !== 'none' && doc.abstract) {
    if (thesis) fresh = true;
    push({ key: 'abstract-h', keep: true, notes: [], draw: () => <h2 className="rsch-paper-title">{w.abstract}</h2> });
    doc.abstract.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean).forEach((x, i) => {
      push({ key: `abstract-${i}`, flows: true, notes: [], draw: () => <p>{loc(x)}</p> });
    });
    if (doc.keywords.length) {
      push({ key: 'keywords', flows: true, notes: [], draw: () => <p><b>{w.keywords}:</b> {loc(doc.keywords.join(RTL(doc.lang) ? '، ' : ', '))}</p> });
    }
  }

  const breaks = breaksOf(doc);
  doc.sections.forEach((sec, si) => {
    if (breaks.has(si)) fresh = true;
    push({ key: `h-${sec.id}`, keep: true, notes: [], draw: () => <div className="rsch-part-head"><H level={sec.level}>{loc(sec.heading)}</H></div> });
    if (!sec.text) return;
    blocksOf(sec.text).forEach((b, bi) => {
      const key = `${sec.id}-${bi}`;
      if (b.t === 'p') {
        const x = text(b.runs);
        push({ key, flows: true, notes: x.notes, draw: (num) => <p>{x.show(num)}</p> });
      } else if (b.t === 'hole') {
        push({ key, flows: true, notes: [], draw: () => <p><mark className="rsch-hole">[{loc(b.text)}]</mark></p> });
      } else if (b.t === 'h') {
        const x = text(b.runs);
        const depth = Math.min(6, sec.level + 1 + b.depth);
        push({
          key, keep: true, notes: x.notes,
          draw: (num) => (depth <= 4 ? <h4>{x.show(num)}</h4> : depth === 5 ? <h5>{x.show(num)}</h5> : <h6>{x.show(num)}</h6>),
        });
      } else if (b.t === 'table') {
        const head = b.head.map((c) => text(c));
        const rows = b.rows.map((row) => row.map((c) => text(c)));
        const notes = [...head, ...rows.flat()].flatMap((c) => c.notes);
        push({
          key, notes,
          draw: (num) => (
            <div className="rsch-table">
              <table>
                <thead><tr>{head.map((c, i) => <th key={i}>{c.show(num)}</th>)}</tr></thead>
                <tbody>{rows.map((row, r) => <tr key={r}>{row.map((c, i) => <td key={i}>{c.show(num)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          ),
        });
      } else {
        b.items.forEach((item, ii) => {
          const x = text(item);
          const li = (num: (id: number) => string) => <li>{x.show(num)}</li>;
          push({
            key: `${key}-${ii}`, flows: true, notes: x.notes,
            draw: (num) => (b.t === 'ul' ? <ul className="rsch-paper-list">{li(num)}</ul> : <ol className="rsch-paper-list" start={ii + 1}>{li(num)}</ol>),
          });
        });
      }
    });
  });

  const refs = referenceList(ctx);
  if (refs.length) {
    if (thesis) fresh = true;
    push({ key: 'refs', keep: true, notes: [], draw: () => <h2 className="rsch-paper-title">{w.references}</h2> });
    refs.forEach((g, gi) => {
      if ((refs.length > 1 || doc.style === 'footnotes') && g.heading) {
        push({ key: `refs-${gi}`, keep: true, notes: [], draw: () => <h3>{loc(g.heading!)}</h3> });
      }
      for (const e of g.entries) {
        const rtl = /[؀-ۿ]/.test(e.runs.map((r) => r.text).join('').slice(0, 40));
        const x = take(e.runs);
        push({
          key: `ref-${e.key}`, flows: true, notes: x.notes,
          draw: (num) => (
            <p className="rsch-paper-ref" dir={rtl ? 'rtl' : 'ltr'}>
              {e.n !== undefined && <span className="rsch-n">{doc.style === 'ieee' ? `[${e.n}] ` : `${rtl ? loc(String(e.n)) : String(e.n)}. `}</span>}
              {x.show(num)}
            </p>
          ),
        });
      }
    });
  }

  if (k.abstract === 'both' && doc.lang !== 'en' && doc.abstractEn) {
    fresh = true;
    const en = (node: ReactNode) => <div dir="ltr" lang="en">{node}</div>;
    if (doc.meta.titleEn) push({ key: 'en-title', keep: true, notes: [], draw: () => en(<h2 className="rsch-paper-title">{doc.meta.titleEn}</h2>) });
    push({ key: 'en-abstract-h', keep: true, notes: [], draw: () => en(<h2 className="rsch-paper-title">{WORDS.en.abstract}</h2>) });
    doc.abstractEn.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean).forEach((x, i) => {
      push({ key: `en-abstract-${i}`, flows: true, notes: [], draw: () => en(<p>{x}</p>) });
    });
    if (doc.keywordsEn.length) {
      push({ key: 'en-keywords', flows: true, notes: [], draw: () => en(<p><b>{WORDS.en.keywords}:</b> {doc.keywordsEn.join(', ')}</p>) });
    }
  }
  return out;
}

/** What the paginator needs to know about a piece, read off the drawn page. */
interface Measured {
  height: number;
  /** Where the text's first line starts, below the piece's top margin. */
  top: number;
  /** The height of one line, for a piece that may continue on the next page. */
  line: number;
  /** Each footnote marker in it, and how far down the piece it sits. */
  marks: { id: number; at: number }[];
}

/**
 * Place the pieces on pages. Greedy, as Word is: each piece goes on the page
 * if it fits with its footnotes; a paragraph that does not is cut after the
 * last line that fits together with the notes of the markers above the cut;
 * a heading goes to the next page unless the start of what follows it fits
 * too; and a piece too tall for any page is put on one of its own and cut
 * off, rather than lost.
 */
function paginate(pieces: Piece[], m: Measured[], noteHeight: Map<number, number>, noteRoom: number): Sheet[] {
  const sheets: Sheet[] = [];
  let cur: Sheet = { slices: [], notes: [] };
  let used = 0;
  let notes = 0;
  const turn = () => {
    if (cur.slices.length) sheets.push(cur);
    cur = { slices: [], notes: [] };
    used = 0;
    notes = 0;
  };
  // Notes cost their own height, and the rule above them once a page has any.
  const cost = (ids: number[]) => (ids.length ? (cur.notes.length ? 0 : noteRoom) + ids.reduce((n, id) => n + (noteHeight.get(id) ?? 0), 0) : 0);
  const put = (i: number, from: number, height: number | undefined, ids: number[]) => {
    notes += cost(ids);
    cur.notes.push(...ids);
    cur.slices.push({ piece: i, from, height });
    used += height ?? m[i].height - from;
  };

  pieces.forEach((p, i) => {
    const me = m[i];
    if ((p.newPage || p.alone) && cur.slices.length) turn();
    let from = 0;
    for (let guard = 0; guard < 1000; guard++) {
      const room = BODY_HEIGHT - used - notes;
      const rest = me.height - from;
      const ids = me.marks.filter((x) => x.at >= from).map((x) => x.id);
      // The start of the next piece, which a heading must not be parted from.
      const after = p.keep && m[i + 1] ? Math.min(m[i + 1].height, m[i + 1].top + 2 * (m[i + 1].line || 0) || m[i + 1].height) : 0;
      if (rest + cost(ids) + after <= room) {
        put(i, from, from ? rest : undefined, ids);
        break;
      }
      if (p.flows && me.line > 0) {
        const lead = from ? 0 : me.top;
        let n = Math.floor((room - lead) / me.line);
        for (; n > 0; n--) {
          const end = from + lead + n * me.line;
          const inside = me.marks.filter((x) => x.at >= from && x.at < end).map((x) => x.id);
          if (lead + n * me.line + cost(inside) <= room) break;
        }
        const end = from + lead + n * me.line;
        // Two lines at the foot of a page at least, unless the page is empty.
        if ((n >= 2 || (n >= 1 && !cur.slices.length)) && end < me.height - 1) {
          put(i, from, end - from, me.marks.filter((x) => x.at >= from && x.at < end).map((x) => x.id));
          turn();
          from = end;
          continue;
        }
      }
      if (!cur.slices.length) {
        // Taller than a page and cannot be cut: its own page, the rest clipped.
        put(i, from, from ? rest : undefined, ids);
        break;
      }
      turn();
    }
    if (p.alone) turn();
  });
  turn();
  return sheets;
}

/** Called when the sheets are drawn and ready to print. */
let paperReady: (() => void) | null = null;

function Paper({ doc }: { doc: Doc }) {
  const pieces = useMemo(() => piecesOf(doc), [doc]);
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const flow = useRef<HTMLDivElement>(null);
  const noteList = useRef<HTMLOListElement>(null);
  const page = { dir: RTL(doc.lang) ? 'rtl' : 'ltr', lang: doc.lang, 'data-digits': doc.lang !== 'en' && doc.digits !== 'western' ? 'eastern' : 'western' };
  const allNotes = useMemo(() => pieces.flatMap((p) => p.notes), [pieces]);
  const noteRuns = useMemo(() => new Map(allNotes.map((n) => [n.id, localRuns(n.runs, doc)])), [allNotes, doc]);

  useEffect(() => {
    if (sheets) return;
    let gone = false;
    // Measured once the fonts are in, or the Arabic is measured in a fallback.
    void document.fonts.ready.then(() => {
      if (gone || !flow.current || !noteList.current) return;
      const m: Measured[] = [...flow.current.children].map((el) => {
        const box = el.getBoundingClientRect();
        const first = el.firstElementChild instanceof HTMLElement ? el.firstElementChild : null;
        const style = first ? getComputedStyle(first) : null;
        const line = style ? Number.parseFloat(style.lineHeight) || 0 : 0;
        const top = first ? first.getBoundingClientRect().top - box.top : 0;
        const marks = [...el.querySelectorAll<HTMLElement>('sup[data-fn]')].map((sup) => ({
          id: Number(sup.dataset.fn),
          at: sup.getBoundingClientRect().top - box.top,
        }));
        return { height: box.height, top, line, marks };
      });
      const heights = new Map<number, number>();
      let items = 0;
      for (const li of noteList.current.querySelectorAll<HTMLElement>('li[data-note]')) {
        const h = li.getBoundingClientRect().height + (Number.parseFloat(getComputedStyle(li).marginBlockEnd) || 0);
        heights.set(Number(li.dataset.note), h);
        items += h;
      }
      // The rule above a page's notes and the space around it: the list with
      // all of them, less the notes themselves.
      const room = Math.max(0, noteList.current.getBoundingClientRect().height - items);
      setSheets(paginate(pieces, m, heights, room));
    });
    return () => { gone = true; };
  }, [pieces, sheets]);

  useEffect(() => {
    if (!sheets) return;
    // Two frames for the sheets to be laid out before the page is printed.
    requestAnimationFrame(() => requestAnimationFrame(() => { paperReady?.(); paperReady = null; }));
  }, [sheets]);

  const noteEl = (id: number, n: string, measuring = false) => (
    <li key={id} dir="auto" data-note={measuring ? id : undefined}>
      <span className="rsch-fn-n">{n})</span> {paperRuns(noteRuns.get(id) ?? [], [], () => '')}
    </li>
  );

  if (!sheets) {
    const probe = () => localDigits('8', doc);
    return (
      <div id="rsch-print" className="is-measuring">
        <div className="rsch-sheet-body rsch-page is-paper" ref={flow} {...page}>
          {pieces.map((p) => <div key={p.key} className="rsch-piece">{p.draw(probe)}</div>)}
        </div>
        <ol className="rsch-notes rsch-sheet-notes" ref={noteList} {...page}>
          {allNotes.map((n) => noteEl(n.id, localDigits('88', doc), true))}
        </ol>
      </div>
    );
  }

  const number = new Map<number, string>();
  for (const sh of sheets) sh.notes.forEach((id, j) => number.set(id, localDigits(String(j + 1), doc)));
  const num = (id: number) => number.get(id) ?? '';
  return (
    <div id="rsch-print">
      {sheets.map((sh, si) => (
        <div className="rsch-sheet" key={si}>
          <div className="rsch-sheet-body rsch-page is-paper" {...page}>
            {sh.slices.map((sl) => {
              const p = pieces[sl.piece];
              const drawn = p.draw(num);
              if (sl.height === undefined && !sl.from) return <div key={p.key} className="rsch-piece">{drawn}</div>;
              // A paragraph cut across pages: this page's lines of it, the
              // rest drawn again on the next page and moved up past them.
              return (
                <div key={`${p.key}-${sl.from}`} className="rsch-piece rsch-cut" style={{ blockSize: sl.height }}>
                  <div style={{ marginBlockStart: -sl.from }}>{drawn}</div>
                </div>
              );
            })}
          </div>
          {sh.notes.length > 0 && (
            <ol className="rsch-notes rsch-sheet-notes" {...page}>
              {sh.notes.map((id, j) => noteEl(id, localDigits(String(j + 1), doc)))}
            </ol>
          )}
        </div>
      ))}
    </div>
  );
}

// ── the reader ────────────────────────────────────────────────────────────

/**
 * The cover, laid out as the Word file lays it out, as Iraqi universities lay
 * theirs out: the institution at the top on the reading side, the logo across
 * from it, the title, who presented it and who supervised, and the two years
 * under a double rule. The same in the reader and on paper.
 */
function Cover({ doc }: { doc: Doc }) {
  const k = kindOf(doc.kind);
  const w = WORDS[doc.lang];
  const statement = statementOf(doc);
  const years = yearsOf(doc);
  const loc = (text: string) => localDigits(text, doc);
  return (
    <header className={`rsch-cover ${k.cover === 'thesis' ? 'is-full' : ''}`}>
      {k.cover === 'thesis' && (
        <div className="rsch-cover-top">
          <div>
            {[...doc.meta.authority.split('\n'), doc.meta.university, doc.meta.college, doc.meta.department]
              .map((l) => l.trim()).filter(Boolean).map((l, i) => <p key={i}>{loc(l)}</p>)}
          </div>
          {doc.logo && (
            <figure className="rsch-cover-logo">
              <img src={doc.logo} alt="" />
              {doc.logoCaption && doc.meta.university.trim() && <figcaption>{loc(doc.meta.university.trim())}</figcaption>}
            </figure>
          )}
        </div>
      )}
      <h1>{loc(doc.meta.title || doc.request)}</h1>
      {statement && <p className="rsch-statement">{loc(statement)}</p>}
      {doc.meta.author && (
        <>
          <p className="rsch-by">{loc(bylineOf(doc))}</p>
          <p className="rsch-who">{doc.meta.author}</p>
        </>
      )}
      {doc.meta.supervisor && (
        <>
          <p className="rsch-by">{w.supervisor}</p>
          <p className="rsch-who">{doc.meta.supervisor}</p>
          {doc.meta.supervisorTitle && <p className="rsch-who-title">{loc(doc.meta.supervisorTitle)}</p>}
        </>
      )}
      {k.cover === 'thesis' && (years.start || years.end) && (
        <div className="rsch-cover-foot"><span>{loc(years.start)}</span><span>{loc(years.end)}</span></div>
      )}
    </header>
  );
}

/** A part's heading at its level: a chapter is an h2, a الفرع an h5. */
function H({ level, children }: { level: number; children: ReactNode }) {
  return level === 1 ? <h2>{children}</h2> : level === 2 ? <h3>{children}</h3> : level === 3 ? <h4>{children}</h4> : <h5>{children}</h5>;
}

/**
 * The whole document, as it will be printed, over the window.
 *
 * Over the window rather than in the sidebar because a thesis cannot be read in
 * a column 300 pixels wide, and this is where it is read: the review a person
 * does before saving is the review that makes the saving theirs. Drawn from the
 * same blocks and citations as the Word file, so what is approved here is what
 * is saved.
 */
function Reader({ doc, t, at, nonce, mode, onClose, begin }: {
  doc: Doc;
  t: (s: string) => string;
  at?: string;
  /** Changed to scroll to `at` again. */
  nonce?: number;
  /** Over the window from the sidebar, or beside the controls in the full window. */
  mode: 'overlay' | 'inline';
  onClose: () => void;
  begin: (doc: Doc, work: Work) => void;
}) {
  useWatch();
  // A part being edited is kept outside the reader too, so drawing it anew —
  // leaving the full window, reopening the reader — finds the edit where it
  // was.
  const [editing, setEditingNow] = useState<{ id: string; text: string } | null>(() => edits.get(doc.id) ?? null);
  const setEditing = (v: { id: string; text: string } | null) => {
    if (v) edits.set(doc.id, v);
    else edits.delete(doc.id);
    setEditingNow(v);
  };
  const body = useRef<HTMLDivElement>(null);
  const job = jobs.get(doc.id);
  const busy = !!job;
  // One pass over the document, walked in order: which citation is a source's
  // first is a fact about the pass, not about the document. Made again only
  // when the document changes — not for every piece of a section streaming
  // in, which is drawn from the run's live text instead.
  const drawn = useMemo(() => {
    const pass: Pass = { ctx: citeContext(doc), doc, notes: [] };
    const bodies = new Map<string, ReactNode>();
    for (const s of doc.sections) {
      if (!s.text) continue;
      bodies.set(s.id, (
        <>
          {blocksOf(s.text).map((b, j) => blockEl(b, pass, s.level, j))}
          {notesEl(pass)}
        </>
      ));
    }
    return { pass, bodies, refs: referenceList(pass.ctx) };
  }, [doc]);
  const { pass, refs } = drawn;
  const w = WORDS[doc.lang];
  const k = kindOf(doc.kind);
  const loc = (text: string) => localDigits(text, doc);

  useEffect(() => {
    // A dialog opened from here handles its own Escape and says so; that
    // press closes the dialog, not the document behind it.
    if (mode !== 'overlay') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing && !e.defaultPrevented) { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onClose, mode]);

  useEffect(() => {
    if (!at) return;
    body.current?.querySelector(`[data-sec="${at}"]`)?.scrollIntoView({ block: 'start' });
  }, [at, nonce]);

  const jump = (id: string) => body.current?.querySelector(`[data-sec="${id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });

  const saveEdit = () => {
    if (!editing) return;
    keep({
      ...doc,
      updated: Date.now(),
      sections: doc.sections.map((s) => (s.id === editing.id
        ? { ...s, text: editing.text, state: editing.text.trim() ? 'done' : s.state === 'author' ? 'author' : 'waiting' }
        : s)),
    });
    setEditing(null);
  };

  const redo = async (i: number) => {
    const how = await ask.text({
      title: fill(t('Rewrite “{heading}”'), { heading: doc.sections[i].heading }),
      value: '',
      placeholder: t('What to change — shorter, more on the method, add a comparison table… (optional)'),
      confirmLabel: t('Rewrite'),
      optional: true,
    });
    if (how === null) return;
    begin(doc, { how: 'rewrite', index: i, redo: how.trim() });
  };

  // Every part being written right now, with the text its writer has put
  // down so far — one a writer when several work at once.
  const live = new Map<number, string>();
  for (const x of job?.progress.writers ?? []) live.set(x.index, x.live);
  if (!job?.progress.writers && job?.progress.index !== undefined) live.set(job.progress.index, job.progress.live ?? '');
  const controls = !busy && !editing && !readsOf(doc.id).length;

  const page = (
          <div className="rsch-page" ref={body} dir={RTL(doc.lang) ? 'rtl' : 'ltr'} lang={doc.lang}
               data-digits={doc.lang !== 'en' && doc.digits !== 'western' ? 'eastern' : 'western'}>
            <Cover doc={doc} />

            {/* While a run is getting to the first words — planning, the
                search, the outline — the page says what is happening rather
                than standing empty under the cover. */}
            {job && !doc.sections.some((x) => x.text) && (
              <div className="rsch-working" role="status" dir={document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'}>
                <span className="rsch-spinner" aria-hidden="true" />
                <b>{stageName(job.progress.stage, t)}…</b>
                <p>{t('The document fills in here as each part is written.')}</p>
                <RunStatus t={t} doc={doc} job={job} rows={8} />
              </div>
            )}

            {k.dedication && (
              <section className="rsch-front">
                <h2>{w.dedication}</h2><p><mark className="rsch-hole">{w.holeDedication}</mark></p>
                <h2>{w.thanks}</h2><p><mark className="rsch-hole">{w.holeThanks}</mark></p>
              </section>
            )}

            {k.abstract !== 'none' && doc.abstract && (
              <section className="rsch-front">
                <h2>{w.abstract}</h2>
                <p>{loc(doc.abstract)}</p>
                {doc.keywords.length > 0 && <p><b>{w.keywords}:</b> {loc(doc.keywords.join(RTL(doc.lang) ? '، ' : ', '))}</p>}
              </section>
            )}

            {doc.sections.map((s, i) => (
              <section key={s.id} data-sec={s.id} className={`rsch-part ${live.has(i) ? 'is-live' : ''}`}>
                <div className="rsch-part-head">
                  <H level={s.level}>{loc(s.heading)}</H>
                  {controls && (
                    <span className="rsch-part-acts" dir="ltr">
                      <button className="sb-act" onClick={() => setEditing({ id: s.id, text: s.text })} title={t('Edit')} aria-label={t('Edit')}>
                        <Icon name="pencil" size={12} />
                      </button>
                      {s.state !== 'author' && (
                        <button className="sb-act" onClick={() => void redo(i)} title={t('Rewrite')} aria-label={t('Rewrite')}>
                          <Icon name="sparkle" size={12} />
                        </button>
                      )}
                    </span>
                  )}
                </div>
                {editing?.id === s.id ? (
                  <div className="rsch-edit">
                    <textarea value={editing.text} dir="auto" rows={Math.min(30, Math.max(8, editing.text.split('\n').length + 2))}
                              onChange={(e) => setEditing({ id: s.id, text: e.target.value })} autoFocus />
                    <p className="rsch-lede">{t('Cite a source with its marker, like [@s3]. Mark a gap with [[ ]].')}</p>
                    <div className="rsch-row">
                      <button className="sb-cta-go" onClick={saveEdit} disabled={busy}>{t('Save')}</button>
                      <button className="ghost" onClick={() => setEditing(null)}>{t('Cancel')}</button>
                    </div>
                  </div>
                ) : live.get(i) ? (
                  <>
                    {job && <PartStatus t={t} job={job} index={i} live={live.get(i) ?? ''} want={s.words} />}
                    <p className="rsch-streaming">{live.get(i)}<span className="rsch-caret" aria-hidden="true" /></p>
                  </>
                ) : live.has(i) ? (
                  <>
                    {job && <PartStatus t={t} job={job} index={i} live="" want={s.words} />}
                    <div className="rsch-skeleton" aria-hidden="true"><i /><i /><i /></div>
                  </>
                ) : s.text ? (
                  drawn.bodies.get(s.id)
                ) : s.state === 'author' ? (
                  <p><mark className="rsch-hole">{t('[You are writing this part.]')}</mark></p>
                ) : s.words > 0 ? (
                  <p className="rsch-pending">{s.brief || t('Not written yet.')}</p>
                ) : null}
              </section>
            ))}

            {refs.length > 0 && (
              <section data-sec="refs" className="rsch-refs">
                <h2>{w.references}</h2>
                {refs.map((g, gi) => (
                  <Fragment key={gi}>
                    {(refs.length > 1 || doc.style === 'footnotes') && g.heading && <h3>{loc(g.heading)}</h3>}
                    <ol>
                      {g.entries.map((e) => {
                        // An English entry is numbered 1., as the Word file numbers it.
                        const rtl = /[\u0600-\u06FF]/.test(e.runs.map((r) => r.text).join('').slice(0, 40));
                        return (
                        <li key={e.key} dir={rtl ? 'rtl' : 'ltr'}>
                          {e.n !== undefined && (
                            <span className="rsch-n">{doc.style === 'ieee' ? `[${e.n}] ` : `${rtl ? loc(String(e.n)) : String(e.n)}. `}</span>
                          )}
                          {richEls(e.runs, pass)}
                        </li>
                        );
                      })}
                    </ol>
                  </Fragment>
                ))}
              </section>
            )}

            {k.abstract === 'both' && doc.lang !== 'en' && doc.abstractEn && (
              <section className="rsch-front" dir="ltr" lang="en">
                {doc.meta.titleEn && <h2>{doc.meta.titleEn}</h2>}
                <h2>{WORDS.en.abstract}</h2>
                <p>{doc.abstractEn}</p>
                {doc.keywordsEn.length > 0 && <p><b>{WORDS.en.keywords}:</b> {doc.keywordsEn.join(', ')}</p>}
              </section>
            )}
          </div>
  );


  const head = (
    <div className="rsch-reader-head">
      {job && <span className="rsch-head-bar" aria-hidden="true"><i style={{ inlineSize: `${percentOf(doc, job)}%` }} /></span>}
      <b dir="auto">{doc.meta.title || doc.request}</b>
      <span>{kindName(doc.kind, t)} · {styleName(doc.style, t)} · {fill(t('{n} words'), { n: wordsOf(doc).toLocaleString() })}</span>
      {mode === 'overlay' && (
        <button className="sb-act" onClick={() => { if (!editing) onClose(); }} disabled={!!editing}
                title={t('Close')} aria-label={t('Close')}><Icon name="close" size={14} /></button>
      )}
    </div>
  );
  const main = (
    <div className="rsch-reader-main">
      <nav className="rsch-toc" aria-label={w.contents} dir={RTL(doc.lang) ? 'rtl' : 'ltr'}>
        {doc.sections.map((s, i) => (
          <button key={s.id} className={`${LEVEL[s.level]} ${live.has(i) ? 'is-live' : ''}`} onClick={() => jump(s.id)}>{s.heading}</button>
        ))}
        {refs.length > 0 && <button className="rsch-lv1" onClick={() => jump('refs')}>{w.references}</button>}
      </nav>
      {page}
    </div>
  );

  if (mode === 'inline') return <div className="rsch-reader is-inline">{head}{main}</div>;

  return (
    <div className="rsch-reader-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !editing) onClose(); }}>
      <div className="rsch-reader" role="dialog" aria-modal="true" aria-label={doc.meta.title || doc.request}>
        {head}
        {main}
      </div>
    </div>
  );
}
