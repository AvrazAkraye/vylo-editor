/**
 * The run that turns a request into a document: the plan, the sources, the
 * outline, the sections one by one, the abstract.
 *
 * `research.ts` knows what a thesis looks like and what to ask a model for
 * each part of one. This file knows the order the asking happens in, what is
 * kept when a step goes wrong, and how to pick up where a run stopped. It
 * talks to nothing itself: the model, the scholarly search, the store and the
 * clock are handed in as `Deps`, so every rule below is tested against stubs
 * and the panel is the only place that knows there is a network.
 *
 * ## A run can stop anywhere and carry on from there
 *
 * A doctoral dissertation is forty calls and the best part of an hour. Laptops
 * sleep, credit runs out, a provider has a bad afternoon. So the document
 * carries where it is — its `stage`, and a state on every section — and `run`
 * starts from that rather than from the beginning. Everything worth paying for
 * is saved the moment it exists, so the most a failure costs is the sections
 * that were being written when it happened.
 *
 * Stopping and failing are different things. Pressing Stop puts the sections
 * being written back the way they were and lets the `AbortError` through,
 * because nothing went wrong. A model that errors marks its section failed,
 * says why on the document, and starts nothing after it: writing chapter five
 * after chapter four failed would hand chapter five an ending to continue from
 * that is not there.
 *
 * ## Several writers, one document
 *
 * Forty sections one after another is the best part of an hour; the
 * researcher can ask for up to eight writers at once (`agentsOf`). Each takes
 * the next part in outline order when it is free, so the document still fills
 * from the front. They share one document and nothing else: a writer that
 * finishes puts its part into the document as it is at that moment, never into
 * the copy it started from, which is missing whatever the others finished
 * since. Each writer is told the others exist, or every part would open by
 * introducing the whole topic again; and it is handed the end of the part
 * before it only when that part is written — one still being written has no
 * end yet. One writer is the run as it always was.
 *
 * ## The model's reply is read, never trusted
 *
 * The plan, the outline and the abstract come back as JSON — usually inside a
 * sentence or a code fence, now and then with a raw newline in a string or a
 * trailing comma. `jsonIn` finds the object anyway. What is in it is checked
 * rather than believed: an outline's levels are made to nest, its word counts
 * to add up to roughly the length the kind should be, and the sources each part
 * leans on are cut down to the ones that exist.
 *
 * A section's text is cleaned for the same reason. The system prompt says not
 * to repeat the heading, not to write top-level headings and not to append a
 * reference list, and models do each of these sometimes. Most important, a
 * marker naming no record — `[@s42]` in a document with thirty sources — is
 * taken out here, so what is stored never points at a study that is not there.
 * Everything else the model wrote is kept.
 *
 * ## Sources are added to, never replaced
 *
 * A search adds to what the document has. Sources the researcher typed keep
 * their place and their keys, and new ones continue the numbering past every
 * key the document has used anywhere, because a key is never reused: a marker
 * already in the text has to go on meaning the work it meant. `search` may
 * return records with or without keys; they are assigned here either way, and
 * `highestKey` is exported for the panel to hand scholar's `merge` when the
 * researcher adds sources themselves.
 *
 * What the indexes are sent is only the queries the model derived from the
 * request, never the request: that is the researcher's own words, and may
 * carry their name, their supervisor's or their data. A plan that names no
 * query searches nothing, and says so.
 *
 * Legislation is the one exception to "the model names no source". A paper in
 * law turns on a constitution and a handful of statutes, OpenAlex does not
 * index a country's gazette, and a law is a name, a number and a year rather
 * than a study that could be invented whole. So the plan may list the laws the
 * topic is about, and they are added before the search as `origin: 'model'`,
 * unverified, for the researcher to check against the official text — never
 * twice, and never over one the document already has.
 *
 * ## The panel says it in the researcher's language
 *
 * What the run reports without stopping is a `note` with a code and numbers,
 * not a sentence, and the errors it writes on the document itself are the
 * exported constants below, so the panel can translate both. What a transport
 * says when it fails is passed on as it came.
 */

import type { Doc, Section, Source, Stage } from './research';
import {
  abstractPrompt, agentsOf, citable, continuePrompt, kindOf, outlinePrompt, planPrompt, screenPrompt, sectionPrompt,
  systemFor, targetSources, targetWords, tokensFor,
} from './research';
import { markerPieces } from './prose';
import { fold } from './settings';

// ── what the run is given ─────────────────────────────────────────────────

/**
 * The outside world, as the run sees it. The panel builds this from
 * `generate.ts`, `scholar.ts` and its store; the tests build it from stubs.
 */
export interface Deps {
  /**
   * One model call, streamed through `onText`. Rejects on failure, and with an
   * `AbortError` when `signal` fires. `onRestart` fires when the transport
   * starts the answer again after a broken stream: everything `onText` has
   * delivered so far is void, and the next delta is the answer's first.
   */
  generate(o: {
    system: string;
    user: string;
    maxTokens: number;
    onText?: (d: string) => void;
    onRestart?: () => void;
    signal?: AbortSignal;
  }): Promise<{ text: string; stopReason: string | null }>;
  /**
   * Real references for the queries, up to `want`. Keys on what it returns are
   * replaced here. `failed` is how many queries no index answered, and `sent`
   * how many were asked once repeats were dropped; without `sent`, every query
   * given is taken to have been asked.
   */
  search(queries: string[], want: number, signal?: AbortSignal): Promise<{ sources: Source[]; failed: number; sent?: number }>;
  /** Called after every change worth keeping, with the whole document. */
  save(doc: Doc): void;
  now(): number;
  newId(): string;
}

/**
 * What the run is doing, for the panel. `writers` is every section being
 * written right now, in outline order: which writer has it (from 1), and its
 * text as it streams in (not yet cleaned) — present, and empty between parts,
 * whenever sections are being written. `index` and `live` are the first of
 * them, so a panel that shows one part at a time shows what it always did;
 * with no writer at work, `index` is the section just finished or put back.
 * `note` is something the researcher should know that did not stop the run,
 * as a code the panel words in the researcher's language:
 *
 * - `plan-unreadable`: the plan's reply could not be read twice, so the
 *   request itself is the title. It is not a search (see `no-queries`, which
 *   follows it).
 * - `no-queries`: the plan named no searches, so nothing was searched — the
 *   request is never sent in their place. The outline is planned with the
 *   sources already there; the researcher can search or add their own.
 * - `search-partial`: `failed` of `of` searches failed; what the rest found
 *   is kept.
 * - `search-failed`: the search failed outright, `detail` saying why in the
 *   transport's words — or every one of `of` searches failed, `failed` of
 *   them; the outline is planned with the sources already there.
 */
export interface Progress {
  stage: Stage;
  index?: number;
  live?: string;
  writers?: { agent: number; index: number; live: string }[];
  note?: { code: 'plan-unreadable' | 'no-queries' | 'search-partial' | 'search-failed'; failed?: number; of?: number; detail?: string };
}

type Note = NonNullable<Progress['note']>;

interface Hooks {
  signal?: AbortSignal;
  onChange?: (doc: Doc, p: Progress) => void;
  /**
   * Asked before each new step and each new part: true ends the run there,
   * with nothing lost. Unlike `signal`, which abandons the parts in hand, a
   * pause lets every writer finish the part it has, and the document is left
   * where the next run carries on from.
   */
  paused?: () => boolean;
}

interface Ctx {
  deps: Deps;
  signal?: AbortSignal;
  onChange?: (doc: Doc, p: Progress) => void;
  paused?: () => boolean;
  /** The last note, carried on every later progress of the run: fewer sources matter to every section, not only to the moment the search ended. */
  note?: Note;
}

/** Output allowed for the plan: a few hundred tokens of JSON, and room for a model that thinks first. */
const PLAN_TOKENS = 8000;

/** For the outline: a dissertation's is forty entries with a brief each, in a script that costs two tokens a word. */
const OUTLINE_TOKENS = 16000;

/** Continuations a section that ran out of room is given before what it has is kept. */
const CONTINUATIONS = 2;

/** How much of the section before is handed on, for the prose to carry on rather than start over. */
const PREVIOUS_CHARS = 600;

/** Added to a request whose reply could not be read, for its one second try. */
const AGAIN = '\n\nYour last reply could not be read as JSON. Reply with the JSON object alone, with nothing before or after it.';

/**
 * Added instead when the reply stopped at its length limit. The same request
 * with the same limit would stop in the same place — a forty-part outline in
 * Arabic does not fit a model allowed 4,096 tokens however often it is asked —
 * so the second try asks for the same thing in fewer words.
 */
const SHORTER = '\n\nYour last reply was cut off at its length limit before its JSON was complete, so it could not be read. Reply with the JSON object alone, with nothing before or after it, and keep it shorter: the same entries, each in fewer words.';

/**
 * Words a part is asked for when it has none of its own and nothing under it —
 * a heading whose subsections were removed. It still has to say something, and
 * a model asked for "about 0 words" may say nothing at all.
 */
const MIN_WORDS = 150;

/** The `detail` of a `search-failed` note when no search threw but none was answered either. */
const NO_ANSWER = 'no search was answered';

/** Legislation the plan may add: a paper in law turns on a handful, and a longer list is guessing. */
const MAX_LAWS = 8;

/**
 * The document's error when the outline could not be read from two replies.
 * English, and the key the panel translates it by, as are the two below.
 */
export const UNREADABLE_OUTLINE = 'The outline could not be read from the model’s reply. Try again, or try another model.';

/** The document's error when the abstract could not be read from two replies. */
export const UNREADABLE_ABSTRACT = 'The abstract could not be read from the model’s reply. Try again, or try another model.';

/** The error on a section, and on the document, when the model wrote nothing that could be kept. */
export const EMPTY_SECTION = 'The model returned no text for this part.';

// ── the run ───────────────────────────────────────────────────────────────

/**
 * Takes a document from wherever it is to done, or as far as it gets.
 *
 * Resumes from `doc.stage`: a new document is planned, one stopped in the
 * middle of its sections carries on with the first section that is not
 * written, by as many writers as it asks for; the abstract is written once
 * every writer has finished. Returns the document as it ended up — with
 * `error` set when a step failed — and rejects only when `signal` stops it.
 * `stopBefore: 'writing'`
 * ends the run once the sources and the outline are there, for the researcher
 * to look at them before anything is written.
 */
export async function run(doc: Doc, deps: Deps, o: Hooks & { stopBefore?: 'writing' } = {}): Promise<Doc> {
  const c: Ctx = { deps, signal: o.signal, onChange: o.onChange, paused: o.paused };
  const held = () => !!c.paused?.();
  let d = doc;
  if (d.error !== undefined) d = keep(c, touch(c, withoutError(d), {}), { stage: d.stage });
  if (d.stage === 'new') d = keep(c, touch(c, d, { stage: 'planning' }), { stage: 'planning' });
  if (d.stage === 'planning') d = await planStep(c, d);
  if (d.error || held()) return d;
  if (d.stage === 'sources') d = await sourcesStep(c, d);
  if (held()) return d;
  // Every part removed before writing — the researcher clearing the outline
  // to plan their own — is an outline to plan again, not a document to finish
  // with nothing in it.
  if (d.stage === 'writing' && !d.sections.length) d = keep(c, touch(c, d, { stage: 'outline' }), { stage: 'outline' });
  if (d.stage === 'outline') d = await outlineStep(c, d);
  if (d.error || held()) return d;
  if (d.stage === 'writing' && o.stopBefore === 'writing') return d;
  if (d.stage === 'writing') d = await writingStep(c, d);
  if (d.error || held()) return d;
  if (d.stage === 'abstract') d = await abstractStep(c, d);
  return d;
}

/**
 * One section written again, with the researcher's instruction and its current
 * text in the request. Nothing else in the document changes, the stage
 * included. A section the researcher writes (`author`), or an index that is
 * not there, is returned as it is.
 */
export async function rewrite(doc: Doc, index: number, redo: string, deps: Deps, o: Hooks = {}): Promise<Doc> {
  const c: Ctx = { deps, signal: o.signal, onChange: o.onChange };
  const sec = doc.sections[index];
  if (!sec || sec.state === 'author') return doc;
  const current = sec.text.trim();
  const extra = { redo: (typeof redo === 'string' ? redo : '').trim() || undefined, current: current || undefined };
  const desk: Desk = { doc, writers: new Map() };
  try {
    await writeSection(c, desk, index, 1, extra, sec);
  } catch (e) {
    if (isAbort(e, c.signal)) putBack(c, desk);
    throw e;
  }
  return settle(c, desk.doc);
}

/**
 * The abstract written again from the sections as they are now. The stage
 * moves only from `abstract` to `done`. An error the document had goes when the
 * abstract is written, unless a failed section is still there to explain it.
 */
export async function redoAbstract(doc: Doc, deps: Deps, o: Hooks = {}): Promise<Doc> {
  const c: Ctx = { deps, signal: o.signal, onChange: o.onChange };
  // The step is handed the document without its error, so an error on what it
  // returns is always the step's own. Handed the old one, a step that worked
  // would carry it on, and nothing could tell that from a step that failed.
  const d = await abstractStep(c, withoutError(doc));
  if (d.error !== undefined || doc.error === undefined) return d;
  const explained = d.sections.some((s) => s.state === 'failed');
  return keep(c, touch(c, d, explained ? { error: doc.error } : {}), { stage: d.stage });
}

// ── the steps ─────────────────────────────────────────────────────────────

/**
 * The title, the field, the keywords, the searches and the legislation. What
 * the researcher has already filled in is theirs and stays. A reply that cannot
 * be read twice is not worth stopping for: the request itself is a title, and
 * the researcher can change it. It is not a query — nothing the researcher
 * typed goes to a search service as it was typed — so such a plan has none.
 */
async function planStep(c: Ctx, d: Doc): Promise<Doc> {
  let plan: ReturnType<typeof parsePlan>;
  try {
    plan = await askJson(c, d, planPrompt(d), PLAN_TOKENS, parsePlan);
  } catch (e) {
    return failed(c, d, e);
  }
  const p = plan ?? { title: d.request, titleEn: '', field: '', keywords: [], keywordsEn: [], queries: [], laws: [] };
  const meta = {
    ...d.meta,
    title: d.meta.title.trim() ? d.meta.title : p.title,
    titleEn: d.meta.titleEn.trim() ? d.meta.titleEn : p.titleEn,
    field: d.meta.field.trim() ? d.meta.field : p.field,
  };
  const next = touch(c, d, {
    meta,
    keywords: d.keywords.length ? d.keywords : p.keywords,
    keywordsEn: d.keywordsEn.length ? d.keywordsEn : p.keywordsEn,
    queries: p.queries.length ? p.queries : d.queries,
    sources: withLaws(d, p.laws),
    stage: 'sources',
  });
  return keep(c, next, plan ? { stage: 'sources' } : { stage: 'sources', note: { code: 'plan-unreadable' } });
}

/**
 * Real references, added to the ones the document has. A search that fails is
 * a note, not a stop: an outline can be planned without sources, and the
 * researcher can search again or add their own.
 *
 * Only the plan's queries are searched. With none there is no search at all:
 * the request in their place would send the researcher's own words, whatever
 * they wrote in them, to two services that were promised short queries.
 */
async function sourcesStep(c: Ctx, d: Doc): Promise<Doc> {
  const want = targetSources(d);
  const queries = d.queries.filter((q) => typeof q === 'string' && q.trim() !== '');
  if (!queries.length) return keep(c, touch(c, d, { stage: 'outline' }), { stage: 'outline', note: { code: 'no-queries' } });
  let found: Source[] = [];
  let note: Note | undefined;
  try {
    stopIfAborted(c.signal);
    const r = await c.deps.search(queries, want, c.signal);
    found = Array.isArray(r?.sources) ? r.sources : [];
    const failures = typeof r?.failed === 'number' && r.failed > 0 ? r.failed : 0;
    const of = typeof r?.sent === 'number' && r.sent > 0 ? r.sent : queries.length;
    // Every search failing is the search failing, not a partial one: "the
    // sources found by the rest are kept" would be about searches that never ran.
    if (failures && failures >= of && !found.length) note = { code: 'search-failed', failed: failures, of, detail: NO_ANSWER };
    else if (failures) note = { code: 'search-partial', failed: failures, of };
  } catch (e) {
    if (isAbort(e, c.signal)) throw abortError(e, c.signal);
    note = { code: 'search-failed', detail: messageOf(e) };
  }
  let sources = mergeSources(d, found, want);
  const before = new Set(d.sources.map((s) => s.key));
  const fresh = sources.filter((s) => !before.has(s.key) && s.use);
  if (fresh.length) sources = await screened(c, d, sources, fresh);
  const next = touch(c, d, { sources, stage: 'outline' });
  return keep(c, next, note ? { stage: 'outline', note } : { stage: 'outline' });
}

/**
 * The works found, with the ones the model judged off the topic switched off.
 *
 * Only works this search found are judged: legislation from the plan and
 * anything the researcher added are theirs to keep. A reply that cannot be
 * read, or a request that fails, keeps everything as found — the screen makes
 * the list better, and its failure must not make it empty. An abort stops.
 */
async function screened(c: Ctx, d: Doc, sources: Source[], fresh: readonly Source[]): Promise<Source[]> {
  show(c, d, { stage: 'sources' });
  try {
    const keepKeys = await askJson(c, d, screenPrompt(d, fresh), 6_000, parseScreen);
    if (!keepKeys) return sources;
    const kept = new Set(keepKeys);
    const judged = new Set(fresh.map((s) => s.key));
    return sources.map((s) => (judged.has(s.key) && !kept.has(s.key) ? { ...s, use: false } : s));
  } catch (e) {
    if (isAbort(e, c.signal)) throw abortError(e, c.signal);
    return sources;
  }
}

/** The outline. Unlike the plan, there is nothing sensible to fall back on, so two unreadable replies stop the run. */
async function outlineStep(c: Ctx, d: Doc): Promise<Doc> {
  let sections: Section[] | null;
  try {
    sections = await askJson(c, d, outlinePrompt(d), OUTLINE_TOKENS, (t) => parseOutline(t, d, c.deps.newId));
  } catch (e) {
    return failed(c, d, e);
  }
  if (!sections) return keep(c, touch(c, d, { error: UNREADABLE_OUTLINE }), { stage: d.stage });
  return keep(c, touch(c, d, { sections, stage: 'writing' }), { stage: 'writing' });
}

/**
 * Every section not yet written, by as many writers as the document asks for
 * (`agentsOf`), each taking the next part in outline order as soon as it is
 * free. A heading with no words of its own and subsections under it is done
 * without a call — there is nothing to write. One with no words and nothing
 * under it is written all the same, at a floor of `MIN_WORDS` (see
 * `writeSection`). A section left `writing` by a run that never finished (the
 * app closed) is written again, since nothing can still be writing it.
 *
 * A part that fails starts nothing new, but the parts the other writers have
 * in hand are finished and kept: they are paid for, and none of them was
 * waiting on the one that failed. A stop waits for every writer to let go,
 * then puts all their parts back at once — one save, one view — and rejects
 * once.
 */
async function writingStep(c: Ctx, doc: Doc): Promise<Doc> {
  const desk: Desk = { doc, writers: new Map() };
  const agents = agentsOf(doc);
  // Said only when it is so: one writer writes each part after the one before.
  const extra: Extra = agents > 1 ? { parallel: true } : {};
  let next = 0;
  let halted = false;
  let stopped: unknown;
  let broke: { error: unknown } | undefined;

  /** The next part that needs a writer, in outline order; -1 when none is left or nothing new may start. */
  const claim = (): number => {
    while (!halted && !c.paused?.() && next < desk.doc.sections.length) {
      const i = next++;
      const s = desk.doc.sections[i];
      if (s.state === 'done' || s.state === 'author') continue;
      if (s.words <= 0 && (desk.doc.sections[i + 1]?.level ?? 0) > s.level) {
        desk.doc = withSection(c, desk.doc, i, { ...withoutError(s), state: 'done' });
        desk.shown = undefined;
        keepDesk(c, desk, i);
        continue;
      }
      return i;
    }
    return -1;
  };

  // A writer never rejects: what stopped it is kept here and dealt with once
  // they have all let go, so a stop is put back and thrown once, not once a writer.
  const writer = async (agent: number): Promise<void> => {
    try {
      for (let i = claim(); i !== -1; i = claim()) {
        const restore: Section = { ...withoutError(desk.doc.sections[i]), state: 'waiting' };
        if (!(await writeSection(c, desk, i, agent, extra, restore))) halted = true;
      }
    } catch (e) {
      halted = true;
      if (!isAbort(e, c.signal)) broke ??= { error: e };
      else if (stopped === undefined) stopped = abortError(e, c.signal);
    }
  };

  await Promise.all(Array.from({ length: agents }, (_, k) => writer(k + 1)));
  if (stopped !== undefined) {
    putBack(c, desk);
    throw stopped;
  }
  if (broke) throw broke.error;
  if (desk.doc.error !== undefined) return desk.doc;
  // Paused with parts still to write: the document stays in writing, with
  // every part the writers had in hand finished, for the next run to go on.
  const left = desk.doc.sections.some((s) => s.state !== 'done' && s.state !== 'author');
  if (left && c.paused?.()) return desk.doc;
  return keep(c, touch(c, desk.doc, { stage: 'abstract' }), { stage: 'abstract' });
}

// ── the writers ───────────────────────────────────────────────────────────

/** What a section's request carries besides the section: a rewrite's instruction and text, and whether others write at once. */
interface Extra { redo?: string; current?: string; parallel?: boolean }

/** A part being written: by which writer, how it is shown meanwhile, what a stop puts back, and its text so far. */
interface Writer {
  /** Which writer, from 1. */
  agent: number;
  index: number;
  /** The part as the panel sees it while it is written: `writing`, with the words it was asked for. */
  shown: Section;
  /** What it goes back to when the run is stopped. */
  restore: Section;
  /** Its text as it streams in, not yet cleaned. */
  live: string;
}

/**
 * What the writers share: the one document they all write into, and the parts
 * being written right now, by index.
 *
 * `doc` is what is saved. A part being written stays in it as it was, and is
 * `writing` only in what the panel is shown (`shownOf`), so no saved copy says
 * a part is being written by a run that may be gone. Every change to `doc` is
 * made to it as it is at that moment and runs to its end before another
 * begins, so two writers finishing in the same tick both land.
 */
interface Desk {
  doc: Doc;
  writers: Map<number, Writer>;
  /**
   * `doc` with every part being written shown as writing. Built once a change
   * and not once a streamed word, so the panel is handed the same document
   * while only the text streaming in changes. Cleared whenever `doc` or
   * `writers` changes.
   */
  shown?: Doc;
}

function shownOf(desk: Desk): Doc {
  if (!desk.writers.size) return desk.doc;
  desk.shown ??= { ...desk.doc, sections: desk.doc.sections.map((s, j) => desk.writers.get(j)?.shown ?? s) };
  return desk.shown;
}

/** Where the writers are, for the panel; `index` stands when none is at work. */
function progressOf(desk: Desk, stage: Stage, index: number): Progress {
  const writers = [...desk.writers.values()]
    .sort((a, b) => a.index - b.index)
    .map((w) => ({ agent: w.agent, index: w.index, live: w.live }));
  const first = writers[0];
  return first ? { stage: 'writing', index: first.index, live: first.live, writers } : { stage, index, writers };
}

/** The desk's document saved, and the panel shown it. */
function keepDesk(c: Ctx, desk: Desk, index: number): void {
  c.deps.save(desk.doc);
  show(c, shownOf(desk), progressOf(desk, desk.doc.stage, index));
}

/**
 * Where a part is in the document now, by its id: at the index its writer was
 * given, unless another part has that id there. Nothing reorders the sections
 * while a run holds them, so this is the index; but a part is put back by what
 * it is, not by where it was.
 */
function placeOf(d: Doc, i: number, id: string): number {
  return d.sections[i]?.id === id ? i : d.sections.findIndex((s) => s.id === id);
}

/** Every part still being written put back as it was, saved once and shown once: what a stop leaves. */
function putBack(c: Ctx, desk: Desk): void {
  const writers = [...desk.writers.values()].sort((a, b) => a.index - b.index);
  if (!writers.length) return;
  const back = new Map(writers.map((w) => [placeOf(desk.doc, w.index, w.restore.id), w.restore]));
  desk.writers.clear();
  desk.shown = undefined;
  desk.doc = touch(c, desk.doc, { sections: desk.doc.sections.map((s, j) => back.get(j) ?? s) });
  c.deps.save(desk.doc);
  show(c, desk.doc, progressOf(desk, 'writing', writers[0].index));
}

/**
 * One section, streamed, continued when it ran out of room, cleaned, and put
 * into the desk's document by writer `agent`. Resolves to whether it was
 * written; when it was not, the section and the document say why.
 *
 * `restore` is what the section goes back to when the run is stopped: waiting
 * for a run, and exactly what it was for a rewrite, so stopping a rewrite never
 * costs the text that was there. A stop rejects with the `AbortError` and
 * leaves the part among the desk's writers, for the caller to put back with
 * the others (`putBack`). On any other failure the text that was there stays,
 * and the section says why it failed.
 */
async function writeSection(c: Ctx, desk: Desk, i: number, agent: number, extra: Extra, restore: Section): Promise<boolean> {
  stopIfAborted(c.signal);
  const before = desk.doc.sections[i];
  // What the model is asked to write. Only the request gets the floor; the
  // outline keeps the number the researcher left there.
  const hasChildren = (desk.doc.sections[i + 1]?.level ?? 0) > before.level;
  const asked = before.words > 0 || hasChildren ? before : { ...before, words: MIN_WORDS };
  const previous = previousOf(desk, i);
  const w: Writer = { agent, index: i, shown: { ...withoutError(asked), state: 'writing' }, restore, live: '' };
  desk.writers.set(i, w);
  desk.shown = undefined;
  const busy = shownOf(desk);
  const say = (live: string) => {
    w.live = live;
    show(c, shownOf(desk), progressOf(desk, 'writing', i));
  };
  say('');
  const maxTokens = tokensFor(asked.words, busy.lang);
  let text = '';
  let error: string | undefined;
  try {
    // A restart is the transport asking again from nothing after a broken
    // stream. What was shown of the first attempt goes, or the panel would
    // print the answer twice, the broken copy above the whole one. Only this
    // writer's text goes: the others' streams were not broken.
    let live = '';
    const first = await ask(c, busy, sectionPrompt(busy, i, { previous, ...extra }), maxTokens, {
      onText: (delta) => say((live += delta)),
      onRestart: () => say((live = '')),
    });
    text = first.text ?? '';
    let stop = first.stopReason;
    for (let k = 0; k < CONTINUATIONS && stop === 'max_tokens'; k++) {
      const base = wholeWords(text);
      let more = '';
      // Only the continuation starts again: the text before it was kept. A
      // rewrite's instruction and current text go with it, or the second half
      // is written to the old brief; so does the word that others write at once.
      const next = await ask(c, busy, continuePrompt(busy, i, base, extra), maxTokens, {
        onText: (delta) => say(base + (more += delta)),
        onRestart: () => say(base + (more = '')),
      });
      text = joined(base, next.text ?? '');
      stop = next.stopReason;
    }
  } catch (e) {
    if (isAbort(e, c.signal)) throw abortError(e, c.signal);
    error = messageOf(e);
  }
  // Into the document as it is now, which may hold parts other writers
  // finished while this one was being written.
  const clean = error === undefined ? cleanSection(text, before.heading, new Set(citable(desk.doc.sources).map((s) => s.key))) : '';
  desk.writers.delete(i);
  desk.shown = undefined;
  const at = placeOf(desk.doc, i, before.id);
  const sec = desk.doc.sections[at];
  if (clean) {
    desk.doc = withSection(c, desk.doc, at, { ...withoutError(sec), text: clean, state: 'done' });
  } else {
    const message = error ?? EMPTY_SECTION;
    desk.doc = { ...withSection(c, desk.doc, at, { ...sec, state: 'failed', error: message }), error: message };
  }
  keepDesk(c, desk, i);
  return clean !== '';
}

/**
 * The abstract, from what was written. A kind without one is done without a
 * call, and so is a document with no part the model wrote: the abstract is
 * written from those parts, and asked with none — every part the researcher's
 * own, or no parts at all — a model describes a document that does not exist.
 * The English abstract is kept only where the kind has both and the
 * document is not already English — anything else the model volunteers is
 * dropped rather than stored somewhere nothing prints it.
 */
async function abstractStep(c: Ctx, d: Doc): Promise<Doc> {
  const k = kindOf(d.kind);
  const after: Stage = d.stage === 'abstract' ? 'done' : d.stage;
  const written = d.sections.some((s) => s.state === 'done' && s.text.trim() !== '');
  if (k.abstract === 'none' || !written) return after === d.stage ? d : keep(c, touch(c, d, { stage: after }), { stage: after });
  const both = k.abstract === 'both' && d.lang !== 'en';
  let r: ReturnType<typeof parseAbstract>;
  try {
    r = await askJson(c, d, abstractPrompt(d), tokensFor(both ? 700 : 350, d.lang), parseAbstract);
  } catch (e) {
    return failed(c, d, e);
  }
  if (!r) return keep(c, touch(c, d, { error: UNREADABLE_ABSTRACT }), { stage: d.stage });
  const next = touch(c, d, { abstract: r.abstract, abstractEn: both ? r.abstractEn : '', stage: after });
  return keep(c, next, { stage: after });
}

// ── plumbing ──────────────────────────────────────────────────────────────

/** A streamed request's listeners: the text as it comes, and the transport starting it again. */
interface Stream { onText: (delta: string) => void; onRestart: () => void }

function ask(c: Ctx, d: Doc, user: string, maxTokens: number, stream?: Stream): Promise<{ text: string; stopReason: string | null }> {
  stopIfAborted(c.signal);
  return c.deps.generate({ system: systemFor(d), user, maxTokens, ...stream, signal: c.signal });
}

/**
 * A request whose reply must be JSON, asked a second time — saying so — when
 * the first cannot be read: for a shorter reply when the first stopped at its
 * length limit, since the same request would stop there again.
 */
async function askJson<T>(c: Ctx, d: Doc, user: string, maxTokens: number, parse: (text: string) => T | null): Promise<T | null> {
  let retry = AGAIN;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await ask(c, d, attempt ? user + retry : user, maxTokens);
    const v = parse(typeof r?.text === 'string' ? r.text : '');
    if (v) return v;
    if (r?.stopReason === 'max_tokens') retry = SHORTER;
  }
  return null;
}

/** A step that threw: an abort goes through, anything else is said on the document and ends the run. */
function failed(c: Ctx, d: Doc, e: unknown): Doc {
  if (isAbort(e, c.signal)) throw abortError(e, c.signal);
  return keep(c, touch(c, d, { error: messageOf(e) }), { stage: d.stage });
}

/** After a rewrite that worked, the document's error goes when no failed section is left to explain it. */
function settle(c: Ctx, d: Doc): Doc {
  if (d.error === undefined || d.sections.some((s) => s.state === 'failed')) return d;
  return keep(c, touch(c, withoutError(d), {}), { stage: d.stage });
}

function touch(c: Ctx, d: Doc, patch: Partial<Doc>): Doc {
  return { ...d, ...patch, updated: c.deps.now() };
}

function withSection(c: Ctx, d: Doc, i: number, sec: Section): Doc {
  return touch(c, d, { sections: d.sections.map((s, j) => (j === i ? sec : s)) });
}

function withoutError<T extends { error?: string }>(x: T): T {
  const out = { ...x };
  delete out.error;
  return out;
}

function keep(c: Ctx, d: Doc, p: Progress): Doc {
  c.deps.save(d);
  show(c, d, p);
  return d;
}

function show(c: Ctx, d: Doc, p: Progress): void {
  if (p.note) c.note = p.note;
  c.onChange?.(d, c.note && !p.note ? { ...p, note: c.note } : p);
}

function messageOf(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return m.trim() || 'The request failed.';
}

/**
 * Whether a failure is the run being stopped. By name, because a DOMException
 * is not an Error everywhere; and by the signal, because a fetch torn down
 * mid-stream can reject with whatever the reader was doing at the time.
 */
function isAbort(e: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError');
}

/** The error a stopped run rejects with: always an `AbortError`, whatever the transport threw. */
function abortError(e: unknown, signal?: AbortSignal): unknown {
  if (typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError') return e;
  const reason = signal?.reason as { name?: unknown } | undefined;
  if (typeof reason === 'object' && reason !== null && reason.name === 'AbortError') return reason;
  return new DOMException('Stopped.', 'AbortError');
}

function stopIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(null, signal);
}

// ── sections, in and out ──────────────────────────────────────────────────

/**
 * The end of the nearest section before `i` that has any text, starting at a
 * word — past headings with none of their own. None when the part before is
 * being written right now: it has no end yet, and the end of the part before
 * that, handed on as "the part before", would have this one write the bridge
 * the other writer is writing.
 */
function previousOf(desk: Desk, i: number): string | undefined {
  for (let j = i - 1; j >= 0; j--) {
    if (desk.writers.has(j)) return undefined;
    const t = desk.doc.sections[j].text.trim();
    if (!t) continue;
    if (t.length <= PREVIOUS_CHARS) return t;
    const tail = t.slice(-PREVIOUS_CHARS);
    const space = tail.search(/\s/);
    return (space > 0 && space < 80 ? tail.slice(space + 1) : tail).trim();
  }
  return undefined;
}

/**
 * Text that ran out of room, cut back to its last whole word.
 *
 * A reply stopped by its token limit usually stops in the middle of a word —
 * in Arabic script more often than not, where a word is several tokens. Asked
 * to continue from half a word, a model either finishes it or starts a new one,
 * and nothing tells the two apart afterwards. Cut at the last space instead,
 * the model continues from a boundary, and the join is always a plain one.
 */
function wholeWords(text: string): string {
  if (!/[\p{L}\p{M}\p{N}]$/u.test(text)) return text;
  const space = Math.max(text.lastIndexOf(' '), text.lastIndexOf('\n'), text.lastIndexOf('\t'));
  return space > 0 && text.length - space <= 40 ? text.slice(0, space + 1) : text;
}

/**
 * A continuation joined to what came before it. A model told to carry on
 * sometimes starts by repeating the last line it wrote; a repeat long enough
 * to be one rather than a coincidence is dropped.
 */
function joined(sofar: string, more: string): string {
  const a = sofar.trimEnd();
  const probe = more.replace(/^\s+/, '');
  for (let k = Math.min(a.length, probe.length, 300); k >= 24; k--) {
    // What follows the repeat is exactly what follows `a`, so the join is plain.
    if (a.endsWith(probe.slice(0, k))) return probe.slice(k).trim() ? a + probe.slice(k) : sofar;
  }
  const b = more;
  if (!b.trim()) return sofar;
  if (/\s$/.test(sofar) || /^\s/.test(b)) {
    return /[ \t]$/.test(sofar) && /^[ \t]/.test(b) ? sofar + b.replace(/^[ \t]+/, '') : sofar + b;
  }
  return /^[.,;:!?،؛)\]»…]/.test(b) ? sofar + b : `${sofar} ${b}`;
}

// ── sources ───────────────────────────────────────────────────────────────

/**
 * The highest `sN` the document has used anywhere — a source, an outline
 * entry, a marker in the text. New sources are numbered after it, never after
 * the sources alone: a marker can outlive its record (a key the model made
 * up, a source the researcher deleted), and the next work given that key would
 * be cited for a claim nobody read it for. The panel passes it to scholar's
 * `merge` as the floor when the researcher adds sources, for the same reason.
 */
export function highestKey(d: Doc): number {
  let n = 0;
  const see = (k: string) => {
    const m = /^s(\d+)$/.exec(k);
    if (m) n = Math.max(n, Number(m[1]));
  };
  for (const s of d.sources) see(s.key);
  for (const sec of d.sections) {
    for (const k of sec.sources) see(k);
    for (const m of sec.text.matchAll(/@\s*(s\d+)/g)) see(m[1]);
  }
  return n;
}

/** Digits as ASCII: ١٢ and ۱۲ are the 12 a law is numbered by. */
function asciiDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (ch) => String(ch.charCodeAt(0) - (ch >= '۰' ? 0x06F0 : 0x0660)));
}

/** A title as two records of the same work would both spell it. */
function titleKey(title: string): string {
  return asciiDigits(fold(title)).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** A title as two records of the same work would both spell it, with its year. */
function sameWork(s: Pick<Source, 'title' | 'year'>): string {
  return `${titleKey(s.title)}|${s.year ?? ''}`;
}

/**
 * A law's number as a plain number in ASCII digits — "رقم ١٢", "No. 12" and
 * 12 are all "12" — or `''` when it is anything else: a number the model
 * wrote as "12/2010" or "twelve" is one it was not sure of.
 */
function lawNumber(v: unknown): string {
  const raw = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : '') : typeof v === 'string' ? v : '';
  const s = asciiDigits(raw).trim()
    .replace(/^(?:رقم|no\.?|number|ژمارە|ژماره)\s*/iu, '')
    .replace(/^\(\s*(\d+)\s*\)$/, '$1');
  return /^\d{1,6}$/.test(s) && Number(s) > 0 ? String(Number(s)) : '';
}

/** A year a law could have been passed in, from a number or a string of digits in either script. */
function lawYear(v: unknown): number | undefined {
  const s = typeof v === 'string' ? asciiDigits(v).trim() : '';
  const n = typeof v === 'number' ? v : /^\d{4}$/.test(s) ? Number(s) : NaN;
  return Number.isInteger(n) && n >= 1800 && n <= 2100 ? n : undefined;
}

/** What legislation is known by: its title with its year, and its title with its number when it has one. */
function lawKeys(s: Pick<Source, 'title' | 'number' | 'year'>): string[] {
  const n = lawNumber(s.number);
  return n ? [sameWork(s), `${titleKey(s.title)}#${n}`] : [sameWork(s)];
}

/** Legislation as the plan names it. */
interface Law { title: string; number: string; year?: number }

/**
 * The legislation the plan named, added to the document's sources with the
 * next free keys — unverified, for the researcher to check — unless the
 * document already has it: the same title with the same number, or with the
 * same year. The document's own sources are kept first and untouched.
 */
function withLaws(d: Doc, laws: readonly Law[]): Source[] {
  if (!laws.length) return d.sources;
  const out = d.sources.slice();
  const known = new Set(out.flatMap(lawKeys));
  let n = highestKey(d);
  for (const law of laws) {
    const keys = lawKeys(law);
    if (keys.some((k) => known.has(k))) continue;
    for (const k of keys) known.add(k);
    out.push({
      key: `s${++n}`,
      title: law.title,
      ...(law.number ? { number: law.number } : {}),
      ...(law.year !== undefined ? { year: law.year } : {}),
      authors: [],
      type: 'law',
      origin: 'model',
      verified: false,
      use: true,
    });
  }
  return out;
}

/**
 * What a search found, added to what the document has: duplicates of either
 * dropped by DOI and then by title and year, at most `max` new ones, each with
 * the next free key. The document's own sources are kept first and untouched.
 */
function mergeSources(d: Doc, found: readonly Source[], max: number): Source[] {
  const out = d.sources.slice();
  const dois = new Set(out.map((s) => (s.doi ?? '').trim().toLowerCase()).filter(Boolean));
  const works = new Set(out.map(sameWork));
  let n = highestKey(d);
  let added = 0;
  for (const s of found) {
    if (added >= max) break;
    if (!s || typeof s.title !== 'string' || !s.title.trim()) continue;
    const doi = (s.doi ?? '').trim().toLowerCase();
    const work = sameWork(s);
    if ((doi && dois.has(doi)) || works.has(work)) continue;
    if (doi) dois.add(doi);
    works.add(work);
    out.push({ ...s, authors: Array.isArray(s.authors) ? s.authors : [], key: `s${++n}` });
    added++;
  }
  return out;
}

// ── reading the model's JSON ──────────────────────────────────────────────

/** Where the bracket opened at `start` closes, skipping any inside strings; -1 when it never does. */
function closing(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close && --depth === 0) {
      return i;
    }
  }
  return -1;
}

/**
 * The slips a model makes in JSON that do not change what it meant: a raw
 * newline or tab inside a string, a comma before a closing bracket.
 */
function repaired(json: string): string {
  let out = '';
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (quoted) {
      if (escaped) { escaped = false; out += ch; continue; }
      if (ch === '\\') { escaped = true; out += ch; continue; }
      if (ch === '"') { quoted = false; out += ch; continue; }
      const code = ch.charCodeAt(0);
      if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
      else out += ch;
      continue;
    }
    if (ch === '"') { quoted = true; out += ch; continue; }
    if (ch === ',' && /^\s*[}\]]/.test(json.slice(i + 1, i + 200))) continue;
    out += ch;
  }
  return out;
}

function parsed(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch { /* try it mended */ }
  try {
    return JSON.parse(repaired(json));
  } catch {
    return undefined;
  }
}

/** The first bracketed value in `text` that parses and passes `want`. Candidates are bounded, so prose full of brackets costs little. */
function firstIn(text: string, open: '{' | '[', close: '}' | ']', want: (v: unknown) => boolean): unknown | null {
  if (typeof text !== 'string') return null;
  let tries = 0;
  for (let at = text.indexOf(open); at !== -1 && tries < 200; at = text.indexOf(open, at + 1)) {
    tries++;
    const end = closing(text, at, open, close);
    if (end === -1) continue;
    const v = parsed(text.slice(at, end + 1));
    if (v !== undefined && want(v)) return v;
  }
  return null;
}

/**
 * The first balanced `{…}` in a model's reply that parses as JSON — past a
 * sentence before it, a code fence around it, braces and escaped quotes inside
 * its strings, and a raw newline or trailing comma the model let slip. `null`
 * when there is none.
 */
export function jsonIn(text: string): unknown | null {
  return firstIn(text, '{', '}', (v) => typeof v === 'object' && v !== null && !Array.isArray(v));
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** A list of short strings, from an array or from one string with commas in it. Trimmed, deduplicated, at most `max`. */
function strings(v: unknown, max: number, chars: number): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,،;؛\n]/) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    const s = str(x).slice(0, chars);
    const k = fold(s);
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v.replace(/[,\s]/g, ''));
  return NaN;
}

/**
 * The legislation in a plan: entries with a title, at most eight, each named
 * once. A number that is not a plain number is left empty, and a year outside
 * 1800–2100 is left out, rather than either being printed in a footnote.
 */
function lawsIn(v: unknown): Law[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: Law[] = [];
  for (const raw of v) {
    if (out.length >= MAX_LAWS) break;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    const title = str(r.title).slice(0, 200).trim();
    if (!title) continue;
    const year = lawYear(r.year);
    const law: Law = year === undefined ? { title, number: lawNumber(r.number) } : { title, number: lawNumber(r.number), year };
    const keys = lawKeys(law);
    if (keys.some((k) => seen.has(k))) continue;
    for (const k of keys) seen.add(k);
    out.push(law);
  }
  return out;
}

/** Fields only a plan has. An entry of its `laws` has none of them. */
const PLAN_FIELDS = ['queries', 'keywords', 'keywordsEn', 'titleEn', 'field', 'laws'];

/**
 * Whether an object read from a plan's reply is the plan, and not one of the
 * laws inside it. When the plan itself does not parse — a quotation mark left
 * unescaped in an Arabic title, a reply cut off in the middle — the first
 * object that does is its first law, `{ title, number, year }`, and a law's
 * title taken for the document's would lose the keywords, the queries and the
 * legislation without a word. A law has a number or a year and no plan field.
 */
function planLike(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return PLAN_FIELDS.some((k) => k in o) || !('number' in o || 'year' in o);
}

/**
 * The plan in the model's reply, or `null` when there is none — no object, or
 * one with neither a title nor a single query, or only one of the laws a plan
 * that could not be read had in it. Lists may come as arrays or as one string
 * with commas; they are trimmed, deduplicated and capped. `laws` is the
 * legislation the topic turns on, as the model named it, and empty when it
 * named none or nothing that can be read.
 */
export function parsePlan(text: string): {
  title: string; titleEn: string; field: string; keywords: string[]; keywordsEn: string[]; queries: string[];
  laws: { title: string; number: string; year?: number }[];
} | null {
  const o = firstIn(text, '{', '}', planLike) as Record<string, unknown> | null;
  if (!o) return null;
  const plan = {
    title: str(o.title).slice(0, 400),
    titleEn: str(o.titleEn).slice(0, 400),
    field: str(o.field).slice(0, 200),
    keywords: strings(o.keywords, 8, 80),
    keywordsEn: strings(o.keywordsEn, 8, 80),
    queries: strings(o.queries, 10, 200),
    laws: lawsIn(o.laws),
  };
  return plan.title || plan.queries.length ? plan : null;
}

/** Marker keys an outline entry names, as bare keys: `s3`, `@s3` and `[@s3]` are the same one. */
function keysOf(v: unknown, known: ReadonlySet<string>): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;\s]+/) : [];
  const out: string[] = [];
  for (const x of raw) {
    const k = str(x).replace(/^\[?\s*@?\s*/, '').replace(/\s*\]$/, '');
    if (known.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * The outline in the model's reply, made into sections that can be written;
 * `null` when no entry with a heading can be read.
 *
 * Levels are made to nest: 1 to 4 — الفصل › المبحث › المطلب › الفرع in an
 * Arabic thesis in law — the first a 1, none more than one below
 * the one before. Words are 0 to 3,000 each; a part with no subsections and no
 * words is given the average, since it has to say something; and when the
 * total is more than 40% away from what the kind should come to, every part is
 * scaled to fit. Sources are kept only where they name a record the model may
 * cite. A bare array of entries is read as well as `{ "sections": […] }`.
 */
export function parseOutline(text: string, doc: Doc, newId: () => string): Section[] | null {
  const o = jsonIn(text) as Record<string, unknown> | null;
  const named = o?.sections ?? o?.outline;
  const list = Array.isArray(named) ? named : firstIn(text, '[', ']', Array.isArray);
  if (!Array.isArray(list)) return null;
  const known = new Set(citable(doc.sources).map((s) => s.key));
  const rows: { level: number; heading: string; brief: string; words: number; sources: string[] }[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const heading = str(r.heading ?? r.title).replace(/^#+\s*/, '').replace(/^\*\*(.+)\*\*$/, '$1').trim().slice(0, 300);
    if (!heading) continue;
    const words = num(r.words);
    rows.push({
      level: num(r.level),
      heading,
      brief: str(r.brief).slice(0, 1200),
      words: Number.isFinite(words) ? Math.min(3000, Math.max(0, Math.round(words))) : 0,
      sources: keysOf(r.sources, known),
    });
  }
  if (!rows.length) return null;

  let prev = 0;
  for (const row of rows) {
    const asked = Number.isFinite(row.level) ? Math.round(row.level) : prev || 1;
    row.level = Math.min(prev + 1, 4, Math.max(1, asked));
    prev = row.level;
  }

  const leaf = rows.map((row, i) => (rows[i + 1]?.level ?? 0) <= row.level);
  const target = targetWords(doc);
  const given = rows.filter((row, i) => leaf[i] && row.words > 0);
  const empty = rows.filter((row, i) => leaf[i] && row.words === 0);
  if (empty.length) {
    const share = given.length
      ? given.reduce((n, row) => n + row.words, 0) / given.length
      : target / empty.length;
    for (const row of empty) row.words = Math.min(3000, Math.max(100, Math.round(share / 10) * 10));
  }
  const total = rows.reduce((n, row) => n + row.words, 0);
  if (total > 0 && Math.abs(total - target) > 0.4 * target) {
    const f = target / total;
    for (const row of rows) {
      if (row.words > 0) row.words = Math.min(3000, Math.max(50, Math.round((row.words * f) / 10) * 10));
    }
  }

  return rows.map((row) => ({
    id: newId(),
    level: row.level as Section['level'],
    heading: row.heading,
    brief: row.brief,
    words: row.words,
    sources: row.sources,
    text: '',
    state: 'waiting' as const,
  }));
}

/**
 * The abstract in the model's reply, or `null` when there is no non-empty
 * `abstract` in it. Markers are taken out — an abstract cites nothing — and
 * `abstractEn` is `''` when the reply has none.
 */
/** The markers a screening reply keeps, as bare keys; `null` when the reply has no "keep" list. */
export function parseScreen(text: string): string[] | null {
  const o = jsonIn(text) as Record<string, unknown> | null;
  if (!o || !Array.isArray(o.keep)) return null;
  return o.keep.map((k) => str(k).replace(/^\[?\s*@?\s*/, '').replace(/\s*\]$/, '')).filter(Boolean);
}

export function parseAbstract(text: string): { abstract: string; abstractEn: string } | null {
  const o = jsonIn(text) as Record<string, unknown> | null;
  if (!o) return null;
  const plain = (v: unknown) => str(v).replace(/[ \t]*\[\s*@[^\]\n]*\]/g, '').replace(/[ \t]+([.,;:،؛])/g, '$1').trim();
  const abstract = plain(o.abstract);
  if (!abstract) return null;
  return { abstract, abstractEn: plain(o.abstractEn ?? o.abstract_en ?? o.englishAbstract) };
}

// ── cleaning a section ────────────────────────────────────────────────────

const FENCE = /^\s*(```|~~~)[\w+-]*\s*$/;

/** Ordinals a heading is numbered with: أولاً، ثانياً…, یەکەم، دووەم…, ئێک، دوو… Folded, as they are compared. */
const ORDINALS = [
  'أولاً', 'ثانياً', 'ثالثاً', 'رابعاً', 'خامساً', 'سادساً', 'سابعاً', 'ثامناً', 'تاسعاً', 'عاشراً',
  'یەکەم', 'دووەم', 'سێیەم', 'چوارەم', 'پێنجەم', 'شەشەم', 'حەوتەم', 'هەشتەم', 'نۆیەم', 'دەیەم',
  'ئێک', 'دوو', 'سێ', 'چار', 'پێنج',
].map((w) => fold(w));

const NUMBERED = new RegExp(
  `^(?:[\\d\\u0660-\\u0669\\u06F0-\\u06F9]+(?:[.\\-][\\d\\u0660-\\u0669\\u06F0-\\u06F9]+)*[.)\\-–—:]?|(?:${ORDINALS.join('|')})\\s*[:\\-–—.])\\s*`,
  'u',
);

/** A heading or a line, as compared: folded, its numbering off, punctuation and markup gone. */
function norm(s: string): string {
  return fold(s).trim().replace(NUMBERED, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function unmarked(line: string): string {
  return line.trim().replace(/^#{1,6}\s*/, '').replace(/^[*_]+|[*_]+$/g, '').trim();
}

/** A line and its part after a colon — "الفصل الأول: الإطار العام" is repeated by either half. */
function spellings(s: string, before: boolean): string[] {
  const t = unmarked(s);
  const out = [norm(t)];
  const colon = t.search(/[:：]/);
  if (colon > 0 && colon < t.length - 1) {
    out.push(norm(t.slice(colon + 1)));
    if (before) out.push(norm(t.slice(0, colon)));
  }
  return out.filter(Boolean);
}

function repeatsHeading(line: string, heading: string): boolean {
  const h = new Set(spellings(heading, true));
  return spellings(line, false).some((v) => h.has(v));
}

/**
 * Headings a model puts over a reference list it was told not to write — and
 * over footnotes written out as text at the end, which cite in words what the
 * markers cite from records.
 */
const REFERENCE_HEADINGS = new Set([
  'references', 'reference list', 'list of references', 'bibliography', 'works cited', 'footnotes', 'endnotes',
  'المراجع', 'المصادر', 'المصادر والمراجع', 'المراجع والمصادر', 'قائمة المراجع', 'قائمة المصادر', 'قائمة المصادر والمراجع',
  'المصادر المعتمدة', 'الهوامش', 'الحواشي',
  'سەرچاوەکان', 'سەرچاوە', 'لیستی سەرچاوەکان', 'پەراوێزەکان',
  'ژێدەر', 'ژێدەرەکان', 'ژێدەران', 'لیستا ژێدەران',
].map(norm));

function isReferenceHeading(line: string): boolean {
  return REFERENCE_HEADINGS.has(norm(unmarked(line)));
}

/** A line of a list — `(١)` and `(1)` included, as footnotes are numbered — or a marker to begin with. */
const LIST_LINE = /^\s*(?:[-*•+]\s|[\d٠-٩۰-۹]+[.)]\s|\(\s*[\d٠-٩۰-۹]+\s*\)|\[\d+\]|\[\s*@)/;

/**
 * A line that is plainly a reference entry, read with its digits as ASCII so
 * ٢٠٢٠ is a year too: a year in brackets (a Hijri one included, and 2020a or
 * ٢٠٢٠أ), no date, a DOI, Chicago's "Family, Given. 2020." or a line that ends
 * with its year, as "دار الثقافة، عمان، ٢٠١٥." does.
 */
const ENTRY_LIKE = /\(\s*(?:1[3-9]\d\d|20\d\d)\s*(?:[a-z]|[أبجم]|هـ?)?\s*\)|\(\s*n\.\s?d\.\s*\)|\(\s*د\.\s?ت\s*\)|doi\.org\/|\b10\.\d{4,9}\/|^[^.\n]{2,80}\.\s+(?:1[5-9]\d\d|20\d\d)[a-z]?\.(?:\s|$)|[,،]\s*(?:1[3-9]\d\d|20\d\d)\s*(?:هـ|م)?\s*\.?\s*$/i;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;

/** A line that starts with an ordinal, "أولاً:" or "دووەم:", folded as `ORDINALS` are. */
const ORDINAL_START = new RegExp(`^(?:${ORDINALS.join('|')})\\s*[:\\-–—.]`, 'u');

/**
 * A heading over one group of a grouped reference list — "أولاً: الكتب",
 * "ثانياً: البحوث", "Books:" — as the region's universities lay one out:
 * short, and numbered with an ordinal or ending in a colon.
 */
function groupHeading(line: string): boolean {
  const t = unmarked(line);
  return t !== '' && t.length <= 60 && (ORDINAL_START.test(fold(t)) || /[:：]$/.test(t));
}

/**
 * Removes a reference list the model appended at the end: a references heading
 * followed by nothing but entries, and the headings of the groups they are in.
 */
function withoutReferenceList(lines: string[]): string[] {
  let j = lines.length - 1;
  let entries = 0;
  for (; j >= 0; j--) {
    const line = lines[j];
    if (!line.trim()) continue;
    if (LIST_LINE.test(line) || ENTRY_LIKE.test(asciiDigits(line))) {
      entries++;
      continue;
    }
    // A group heading counts only above entries, and never when it is the references heading itself ("المراجع:").
    if (entries && groupHeading(line) && !isReferenceHeading(line)) continue;
    break;
  }
  if (j < 0 || !isReferenceHeading(lines[j])) return lines;
  if (!entries && j === 0) return lines;
  const out = lines.slice(0, j);
  while (out.length && (!out[out.length - 1].trim() || RULE.test(out[out.length - 1]))) out.pop();
  return out;
}

/** Where a marker was taken out, until the spaces around it are tidied. */
const GONE = '\u0000';

/**
 * Markers kept to the keys that exist. A marker naming only known keys is left
 * exactly as written; one naming some is rewritten with those (and their
 * locators); one naming none is removed, with the space before it, so no
 * "claim ." is left behind.
 *
 * Keys are split exactly where prose.ts splits them (`markerPieces`), so every
 * key the preview and the Word file would cite has been checked here: `؛`,
 * `،` and a bare space separate keys too. A marker in doubled brackets,
 * `[[@s3]]`, is one prose.ts reads as a citation, so its outer pair is part of
 * it — kept with it, and gone with it rather than left behind as "[]". A lone
 * extra bracket on one side is not the marker's, and stays where it was.
 */
function knownMarkers(text: string, keys: ReadonlySet<string>): string {
  const marked = text.replace(/(\[?)\[\s*@([^\]\n]*)\](\]?)/g, (whole, open: string, body: string, close: string) => {
    const doubled = open !== '' && close !== '';
    const outside = doubled ? ['', ''] : [open, close];
    const parts: { key: string; locator: string[]; changed: boolean }[] = [];
    for (const piece of markerPieces(`@${body}`)) {
      const m = /^@\s*([A-Za-z0-9_-]+)(.*)$/.exec(piece);
      if (m) {
        const key = keys.has(m[1]) ? m[1] : keys.has(m[1].toLowerCase()) ? m[1].toLowerCase() : '';
        const locator = m[2].replace(/^[\s,،:.]+/, '').trim();
        parts.push({ key, locator: locator ? [locator] : [], changed: key !== m[1] });
      } else if (parts.length) {
        parts[parts.length - 1].locator.push(piece);
      }
    }
    const kept = parts.filter((p) => p.key);
    if (kept.length && kept.length === parts.length && !kept.some((p) => p.changed)) return whole;
    if (!kept.length) return `${outside[0]}${GONE}${outside[1]}`;
    const group = kept.map((p) => `@${p.key}${p.locator.length ? `, ${p.locator.join(', ')}` : ''}`).join('; ');
    return doubled ? `[[${group}]]` : `${open}[${group}]${close}`;
  });
  if (!marked.includes(GONE)) return marked;
  return marked.replace(/[ \t]*(?:\u0000[ \t]*)+/g, (gap, at: number, all: string) => {
    const before = all[at - 1];
    const after = all[at + gap.length];
    if (at === 0 || before === '\n') return '';
    if (after === undefined || after === '\n' || /[.,;:!?،؛)\]»…]/.test(after)) return '';
    return ' ';
  });
}

/**
 * A section's text as it is stored: the model's reply with what it was told not
 * to write taken out, and nothing else.
 *
 * Code fence lines go (what was inside them stays). A first line that repeats
 * the heading goes — compared folded, with or without `#`, bold or numbering
 * such as "1." or "أولاً:". `# ` and `## ` headings become `### `, since the
 * section's own heading is the app's. A reference list appended at the end — a
 * References / المراجع / سەرچاوەکان / ژێدەر heading followed only by entries,
 * grouped under "أولاً: الكتب" and the like or not, with years in any digits —
 * goes, and so do footnotes written out under الهوامش. Markers naming keys not
 * in `keys` lose those keys, and go when none are left, keys read exactly as
 * prose.ts reads them.
 */
export function cleanSection(text: string, heading: string, keys: ReadonlySet<string>): string {
  if (typeof text !== 'string') return '';
  let lines = text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').split('\n').filter((l) => !FENCE.test(l));
  const first = lines.findIndex((l) => l.trim() !== '');
  if (first !== -1 && typeof heading === 'string' && heading.trim() && repeatsHeading(lines[first], heading)) {
    lines.splice(first, 1);
  }
  lines = lines.map((l) => l.replace(/^[ \t]{0,3}#{1,2}[ \t]+/, '### '));
  lines = withoutReferenceList(lines);
  return knownMarkers(lines.join('\n'), keys)
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
    .trim();
}
