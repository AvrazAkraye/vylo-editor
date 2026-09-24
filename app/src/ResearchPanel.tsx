import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { save as savePanel } from '@tauri-apps/plugin-dialog';
import { Icon } from './Icon';
import * as ask from './ask';
import { fill, type Lang } from './i18n';
import { explain } from './errors';
import { armed } from './providers';
import { allows, type PlanSummary } from './account';
import { modelName } from './models';
import { effortLabel, effortOf, type EffortBook } from './effort';
import {
  KINDS, PROFILE_KEY, STYLES, WORDS, bylineOf, detect, docLangOf, kindOf, localDigits, newDoc, readProfile,
  statementOf, styleIn, targetWords, yearsOf, type Doc, type DocLang, type Kind, type Length, type Meta, type Profile, type Section,
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
import { docxBase64, fileNameFor } from './researchdocx';
import { deleteDoc, loadDocs, saveDoc } from './researchstore';

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
}

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
  if (jobs.has(doc.id)) return;
  const ctl = new AbortController();
  const job: Job = { ctl, progress: { stage: doc.stage } };
  jobs.set(doc.id, job);
  // Which model wrote it goes with the document, for the line that says so.
  doc = doc.model === gw.model ? doc : { ...doc, model: gw.model };
  known.set(doc.id, doc);
  notify();
  const deps = depsFor(gw, efforts);
  const onChange = (d: Doc, p: Progress) => {
    if (gone.has(d.id)) return;
    known.set(d.id, d);
    job.progress = p;
    notifySoon();
  };
  const o = { signal: ctl.signal, onChange };
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
  if (k === 'review') return t('Literature review');
  if (k === 'proposal') return t('Research proposal');
  if (k === 'graduation') return t('Graduation project');
  if (k === 'masters') return t('Master’s thesis');
  return t('PhD dissertation');
}

function kindAbout(k: Kind, t: (s: string) => string): string {
  if (k === 'working-paper') return t('A paper for a conference, seminar or workshop, built on axes and ending in recommendations.');
  if (k === 'article') return t('An article for a peer-reviewed journal: introduction, literature, method, results, discussion.');
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

/** The logo a researcher chose once, for every cover after it. */
const LOGO_KEY = 'vylo.research.logo.v1';
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

/** Rich text. A DOI is shown and can be copied; it is not a link, because a link would navigate the app's own window. */
function richEls(runs: Rich[], pass: Pass): ReactNode[] {
  return localRuns(runs, pass.doc).map((r, i) => {
    if (r.note) {
      pass.notes.push(r.note);
      return <sup key={i} className="rsch-fn">{localDigits(String(pass.notes.length), pass.doc)}</sup>;
    }
    const text = r.text;
    if (r.hole) return <mark key={i} className="rsch-hole">{text}</mark>;
    if (r.bold && r.italic) return <b key={i}><i>{text}</i></b>;
    if (r.bold) return <b key={i}>{text}</b>;
    if (r.italic) return <i key={i}>{text}</i>;
    if (r.link) return <span key={i} className="rsch-link" dir="ltr">{text}</span>;
    return <Fragment key={i}>{text}</Fragment>;
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
  const drawn = pass.notes.map((n, i) => (
    <li key={i}><span className="rsch-fn-n">{localDigits(String(i + 1), pass.doc)})</span> {richEls(n, { ...pass, notes: [] })}</li>
  ));
  pass.notes = [];
  return <ol className="rsch-notes">{drawn}</ol>;
}

// ── the panel ─────────────────────────────────────────────────────────────

export function ResearchPanel({ t, lang, gw, efforts, plan, onProviders, onError }: Props) {
  useWatch();
  const [openId, setOpenId] = useState<string | null>(null);
  const [reading, setReading] = useState<{ id: string; at?: string } | null>(null);

  useEffect(() => {
    if (loaded) return;
    loaded = true;
    void loadDocs().then((docs) => {
      // A run started before the list arrived is newer than what was stored.
      for (const d of docs) if (!known.has(d.id)) known.set(d.id, d);
      notify();
    });
  }, []);

  const docs = [...known.values()].sort((a, b) => b.updated - a.updated);
  const open = openId ? known.get(openId) ?? null : null;
  const ready = armed({ baseUrl: gw.baseUrl, key: gw.apiKey });

  const fail = (doing: string) => (e: unknown) => onError(explain(e, doing));
  const begin = (doc: Doc, work: Work) => start(doc, gw, efforts, work, fail(t('write the document')));

  const reader = reading && known.get(reading.id);

  return (
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
      {ready && !allows(plan, gw.model) && (
        <p className="rsch-warn">{fill(t('Your plan does not include {model}. Choose another model in the composer.'), { model: modelName(gw.model) })}</p>
      )}
      {unkept && (
        <p className="rsch-warn">{t('Documents cannot be kept on this machine right now. Save to Word before you close the app.')}</p>
      )}

      {open
        ? <DocView key={open.id} doc={open} t={t} gw={gw} efforts={efforts} ready={ready}
                   onBack={() => setOpenId(null)} onRead={(at) => setReading({ id: open.id, at })}
                   begin={begin} onError={onError} />
        : <Home t={t} lang={lang} gw={gw} ready={ready} docs={docs}
                onOpen={setOpenId}
                onStart={(doc) => { keep(doc); setOpenId(doc.id); begin(doc, { how: 'run', stopBefore: doc.pause ? 'writing' : undefined }); }} />}

      {reader && createPortal(
        <Reader doc={reader} t={t} at={reading?.at}
                onClose={() => setReading(null)}
                begin={begin} onError={onError} />,
        document.body,
      )}
    </div>
  );
}

// ── asking for a document ─────────────────────────────────────────────────

function Home({ t, lang, gw, ready, docs, onOpen, onStart }: {
  t: (s: string) => string;
  lang: Lang;
  gw: Target;
  ready: boolean;
  docs: Doc[];
  onOpen: (id: string) => void;
  onStart: (doc: Doc) => void;
}) {
  const [request, setRequest] = useState('');
  // What the researcher chose by hand wins over what the words say, and stays
  // chosen while they keep typing.
  const [kindSet, setKindSet] = useState<Kind | null>(null);
  const [langSet, setLangSet] = useState<DocLang | null>(null);
  const [styleSet, setStyleSet] = useState<Style | null>(null);
  const [length, setLength] = useState<Length>('standard');
  const [more, setMore] = useState(false);
  const [profile, setProfile] = useState<Profile>(() => {
    try { return readProfile(localStorage.getItem(PROFILE_KEY)); } catch { return readProfile(null); }
  });
  const [cover, setCover] = useState<Pick<Meta, 'title' | 'venue' | 'presented'>>({ title: '', venue: '', presented: '' });
  const [logo, setLogo] = useState<string>(() => { try { return localStorage.getItem(LOGO_KEY) ?? ''; } catch { return ''; } });
  const [notes, setNotes] = useState('');
  const [pause, setPause] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  const found = useMemo(() => detect(request), [request]);
  const kind: Kind = kindSet ?? found?.kind ?? 'article';
  const docLang: DocLang = langSet ?? docLangOf(request, lang);
  // Footnotes are how Arab and Kurdish universities cite; APA is how English-language journals do.
  const style: Style = styleSet ?? styleIn(request) ?? (docLang === 'en' ? 'apa' : 'footnotes');

  const setField = (k: keyof Profile, v: string) => {
    const next = { ...profile, [k]: v };
    setProfile(next);
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(next)); } catch { /* kept for this session only */ }
  };

  const go = () => {
    if (!request.trim() || !ready) return;
    onStart(newDoc({
      id: newId(),
      now: Date.now(),
      request,
      kind,
      lang: docLang,
      style,
      length,
      meta: { ...profile, ...cover },
      logo: logo || undefined,
      notes,
      pause,
    }));
    setRequest('');
    setKindSet(null);
    setLangSet(null);
    setStyleSet(null);
    setCover({ title: '', venue: '', presented: '' });
    setNotes('');
  };

  const pickSkill = (k: Kind) => {
    setKindSet(k);
    if (!request.trim()) {
      // Say it in the language the researcher is likely to write the rest in.
      const s = samplesOf(k);
      // In Badini, a Badini phrase: the Kurdish sample is Sorani, and a
      // Sorani phrase would make the document Sorani.
      const badini = lang === 'kmr' ? kindOf(k).triggers.find((p) => docLangOf(p, 'kmr') === 'kmr') : undefined;
      const phrase = lang === 'en' ? s[s.length - 1] : lang === 'ar' ? s[0] : badini ?? s[1] ?? s[0];
      setRequest(`${phrase} `);
    }
    box.current?.focus();
  };

  const field = (k: keyof Profile, label: string, wide = false) => (
    <label className={wide ? 'rsch-f rsch-wide' : 'rsch-f'}>
      <span>{label}</span>
      {k === 'authority'
        ? <textarea rows={2} value={profile[k]} onChange={(e) => setField(k, e.target.value)} dir="auto" />
        : <input value={profile[k]} onChange={(e) => setField(k, e.target.value)} dir="auto" />}
    </label>
  );

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

        <div className="rsch-opts">
          <select value={kind} onChange={(e) => setKindSet(e.target.value as Kind)} aria-label={t('Kind of document')}>
            {KINDS.map((k) => <option key={k.id} value={k.id}>{kindName(k.id, t)}</option>)}
          </select>
          <select value={docLang} onChange={(e) => setLangSet(e.target.value as DocLang)} aria-label={t('Language of the document')}>
            {(['ar', 'ckb', 'kmr', 'en'] as const).map((l) => <option key={l} value={l}>{langName(l, t)}</option>)}
          </select>
          <select value={length} onChange={(e) => setLength(e.target.value as Length)} aria-label={t('Length')}>
            {(['short', 'standard', 'long'] as const).map((l) => (
              <option key={l} value={l}>{fill(t('{length} — about {n} words'), {
                length: lengthName(l, t), n: targetWords({ kind, length: l }).toLocaleString(),
              })}</option>
            ))}
          </select>
          <select value={style} onChange={(e) => setStyleSet(e.target.value as Style)} aria-label={t('Citation style')}>
            {STYLES.map((s) => <option key={s} value={s}>{styleName(s, t)}</option>)}
          </select>
        </div>

        <button className="rsch-more" onClick={() => setMore((m) => !m)} aria-expanded={more}>
          <Icon name="chevron" size={11} />
          {t('Cover, notes and data')}
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
            {field('university', t('University'))}
            {field('college', t('College'))}
            {field('department', t('Department'))}
            {field('field', t('Specialisation'))}
            {field('city', t('City'))}
            <label className="rsch-f">
              <span>{t('Conference or journal')}</span>
              <input value={cover.venue} onChange={(e) => setCover({ ...cover, venue: e.target.value })} dir="auto" />
            </label>
            {field('authority', t('Above the university on the cover — country, ministry (one per line)'), true)}
            <div className="rsch-logo rsch-wide">
              {logo ? <img src={logo} alt="" /> : <span className="rsch-logo-none"><Icon name="image" size={16} /></span>}
              <button className="ghost" onClick={() => pickLogo((url) => {
                setLogo(url);
                setLogoError(false);
                try { localStorage.setItem(LOGO_KEY, url); } catch { /* kept for this session only */ }
              }, () => setLogoError(true))}>{logo ? t('Change the logo') : t('Add the university’s logo')}</button>
              {logo && (
                <button className="ghost" onClick={() => {
                  setLogo('');
                  try { localStorage.removeItem(LOGO_KEY); } catch { /* nothing kept */ }
                }}>{t('Remove')}</button>
              )}
            </div>
            {logoError && <p className="rsch-bad rsch-wide">{t('Use a PNG or JPEG picture under 400 KB.')}</p>}
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

        <button className="sb-cta-go rsch-go" disabled={!request.trim() || !ready} onClick={go}>
          <Icon name="sparkle" size={13} />
          {fill(t('Write it with {model}'), { model: modelName(gw.model) })}
        </button>
      </div>

      {docs.length > 0 && (
        <>
          <div className="sb-sub">{t('Your documents')}</div>
          <ul className="rsch-docs">
            {docs.map((d) => <DocRow key={d.id} doc={d} t={t} onOpen={() => onOpen(d.id)} />)}
          </ul>
        </>
      )}

      <div className="sb-sub">{t('Skills')}</div>
      <p className="rsch-lede">{t('Each kind of document is a skill. Name it in your request — in Arabic, Kurdish or English — and it switches on.')}</p>
      <ul className="rsch-skills">
        {KINDS.map((k) => (
          <li key={k.id}>
            <button className={`rsch-card ${kind === k.id && (found || kindSet) ? 'on' : ''}`} onClick={() => pickSkill(k.id)}>
              <b>{kindName(k.id, t)}</b>
              <span>{kindAbout(k.id, t)}</span>
              <span className="rsch-says">
                {samplesOf(k.id).map((p) => <code key={p} dir="auto">{p}</code>)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
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

type Tab = 'outline' | 'sources' | 'details';

function DocView({ doc, t, gw, efforts, ready, onBack, onRead, begin, onError }: {
  doc: Doc;
  t: (s: string) => string;
  gw: Target;
  efforts: EffortBook;
  ready: boolean;
  onBack: () => void;
  onRead: (sectionId?: string) => void;
  begin: (doc: Doc, work: Work) => void;
  onError: (m: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('outline');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const job = jobs.get(doc.id);
  const busy = !!job;
  const k = kindOf(doc.kind);
  const done = doc.sections.filter((s) => s.state === 'done').length;
  const words = useMemo(() => wordsOf(doc), [doc]);
  const canWrite = doc.sections.some((s) => s.state === 'waiting' || s.state === 'failed');
  const paused = !busy && doc.stage === 'writing' && doc.sections.length > 0 && done === 0 && canWrite;
  const somethingWritten = done > 0;

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

  return (
    <div className="rsch-docview">
      <div className="rsch-top">
        <button className="sb-act rsch-back" onClick={onBack} title={t('Back')} aria-label={t('Back')}>
          <Icon name="chevron" size={14} />
        </button>
        <div className="rsch-title">
          <b dir="auto">{doc.meta.title || doc.request}</b>
          <span>{kindName(doc.kind, t)} · {langName(doc.lang, t)} · {styleName(doc.style, t)}</span>
        </div>
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
            {live
              ? fill(t('Writing “{heading}”…'), { heading: live.heading })
              : stageName(job.progress.stage, t) + '…'}
            {job.progress.note ? <span className="rsch-note"> {noteText(job.progress.note, t)}</span> : null}
          </p>
        )}
        {!busy && paused && <p>{t('Check the sources and the outline, then write.')}</p>}
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
        {busy && live && job.progress.live && (
          <p className="rsch-live" dir="auto">{job.progress.live.slice(-240)}</p>
        )}
      </div>

      <div className="rsch-acts">
        {busy
          ? <button className="ghost" onClick={() => stop(doc.id)}><Icon name="stop" size={12} />{t('Stop')}</button>
          : doc.stage !== 'done' && (
            <button className="sb-cta-go" disabled={!ready}
                    // "Let me check first" holds on a resume too: a run stopped
                    // while searching must not write straight through on Continue.
                    onClick={() => begin(doc, {
                      how: 'run',
                      stopBefore: doc.pause && EARLY.includes(doc.stage) ? 'writing' : undefined,
                    })}>
              <Icon name="play" size={12} />
              {paused ? t('Write the document') : doc.stage === 'new' ? t('Start') : t('Continue')}
            </button>
          )}
        <button className="ghost" disabled={!doc.sections.length} onClick={() => onRead()}>
          <Icon name="book" size={12} />{t('Read the document')}
        </button>
        <button className="ghost" disabled={busy || !somethingWritten || saving} onClick={() => void saveWord()}
                title={busy ? t('Stop the writing before saving.') : undefined}>
          <Icon name="file" size={12} />{t('Save as Word…')}
        </button>
      </div>
      {saved && <p className="rsch-saved" dir="auto">{fill(t('Saved to {path}'), { path: saved })}</p>}
      {saved && <p className="rsch-lede">{t('Word asks to update the fields when it opens the file: say yes, and the table of contents gets its page numbers.')}</p>}

      <div className="rsch-tabs" role="tablist">
        {(['outline', 'sources', 'details'] as const).map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>
            {x === 'outline' ? t('Outline of the document') : x === 'sources' ? t('Sources') : t('Details')}
          </button>
        ))}
      </div>

      {tab === 'outline' && (
        <OutlineTab doc={doc} t={t} busy={busy} liveIndex={liveIndex} onRead={onRead}
                    onChange={change} onRewrite={(index, redo) => begin(doc, { how: 'rewrite', index, redo })} ready={ready} />
      )}
      {tab === 'sources' && <SourcesTab doc={doc} t={t} busy={busy} onChange={change} onError={onError} />}
      {tab === 'details' && (
        <DetailsTab doc={doc} t={t} busy={busy} onChange={change}
                    onAbstract={() => begin(doc, { how: 'abstract' })} ready={ready} />
      )}

      <p className="rsch-lede rsch-honest">
        {t('A draft to build on. Read every claim and check every source before you submit it; the gaps marked in yellow are yours to fill.')}
      </p>
      {/* Held here for the model's sake too: which one, and how hard it thinks. */}
      <p className="rsch-lede">
        {/* The model the document was written with, recorded when its run
            started — not whichever one the composer shows now. */}
        {fill(t('Written with {model}.'), { model: modelName(doc.model ?? gw.model) })}
        {!doc.model && effortOf(efforts, gw.model) ? ` · ${effortLabel(effortOf(efforts, gw.model)!, t)}` : ''}
      </p>
    </div>
  );
}

function OutlineTab({ doc, t, busy, liveIndex, onRead, onChange, onRewrite, ready }: {
  doc: Doc;
  t: (s: string) => string;
  busy: boolean;
  liveIndex?: number;
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
        <li key={s.id} className={`rsch-sec ${LEVEL[s.level]} ${i === liveIndex ? 'is-live' : ''}`}>
          <button className="rsch-sec-main" onClick={() => onRead(s.id)} title={s.brief || undefined}>
            <span className={`rsch-dot ${s.state === 'done' ? 'is-done' : s.state === 'failed' ? 'is-bad' : s.state === 'writing' || i === liveIndex ? 'is-live' : s.state === 'author' ? 'is-yours' : ''}`}
                  aria-label={stateName(i === liveIndex ? 'writing' : s.state, t)} />
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

function DetailsTab({ doc, t, busy, onChange, onAbstract, ready }: {
  doc: Doc;
  t: (s: string) => string;
  busy: boolean;
  onChange: (next: Partial<Doc>) => void;
  onAbstract: () => void;
  ready: boolean;
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
  return (
    <div className="rsch-form">
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
      {field('university', t('University'))}
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

// ── the reader ────────────────────────────────────────────────────────────

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
function Reader({ doc, t, at, onClose, begin, onError }: {
  doc: Doc;
  t: (s: string) => string;
  at?: string;
  onClose: () => void;
  begin: (doc: Doc, work: Work) => void;
  onError: (m: string) => void;
}) {
  useWatch();
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
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
  const statement = statementOf(doc);
  const years = yearsOf(doc);
  const loc = (text: string) => localDigits(text, doc);

  useEffect(() => {
    // A dialog opened from here handles its own Escape and says so; that
    // press closes the dialog, not the document behind it.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing && !e.defaultPrevented) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onClose]);

  useEffect(() => {
    if (!at) return;
    body.current?.querySelector(`[data-sec="${at}"]`)?.scrollIntoView({ block: 'start' });
  }, [at]);

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

  const liveIndex = job?.progress.index;

  return (
    <div className="rsch-reader-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !editing) onClose(); }}>
      <div className="rsch-reader" role="dialog" aria-modal="true" aria-label={doc.meta.title || doc.request}>
        <div className="rsch-reader-head">
          <b dir="auto">{doc.meta.title || doc.request}</b>
          <span>{kindName(doc.kind, t)} · {styleName(doc.style, t)} · {fill(t('{n} words'), { n: wordsOf(doc).toLocaleString() })}</span>
          <button className="sb-act" onClick={() => { if (!editing) onClose(); }} disabled={!!editing}
                  title={t('Close')} aria-label={t('Close')}><Icon name="close" size={14} /></button>
        </div>
        <div className="rsch-reader-main">
          <nav className="rsch-toc" aria-label={w.contents} dir={RTL(doc.lang) ? 'rtl' : 'ltr'}>
            {doc.sections.map((s) => (
              <button key={s.id} className={LEVEL[s.level]} onClick={() => jump(s.id)}>{s.heading}</button>
            ))}
            {refs.length > 0 && <button className="rsch-lv1" onClick={() => jump('refs')}>{w.references}</button>}
          </nav>
          <div className="rsch-page" ref={body} dir={RTL(doc.lang) ? 'rtl' : 'ltr'} lang={doc.lang}
               data-digits={doc.lang !== 'en' && doc.digits !== 'western' ? 'eastern' : 'western'}>
            {/* The cover, laid out as the Word file lays it out, as Iraqi
                universities lay theirs out: the institution at the top on the reading side, the
                logo across from it, the title, who presented it and who
                supervised, and the two years under a double rule. */}
            <header className={`rsch-cover ${k.cover === 'thesis' ? 'is-full' : ''}`}>
              {k.cover === 'thesis' && (
                <div className="rsch-cover-top">
                  <div>
                    {[...doc.meta.authority.split('\n'), doc.meta.university, doc.meta.college, doc.meta.department]
                      .map((l) => l.trim()).filter(Boolean).map((l, i) => <p key={i}>{loc(l)}</p>)}
                  </div>
                  {doc.logo && <img src={doc.logo} alt="" />}
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
              <section key={s.id} data-sec={s.id} className={`rsch-part ${i === liveIndex ? 'is-live' : ''}`}>
                <div className="rsch-part-head">
                  <H level={s.level}>{loc(s.heading)}</H>
                  {!busy && !editing && (
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
                ) : i === liveIndex && job?.progress.live ? (
                  <p className="rsch-streaming">{job.progress.live}</p>
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
                      {g.entries.map((e) => (
                        <li key={e.key} dir={/[\u0600-\u06FF]/.test(e.runs.map((r) => r.text).join('').slice(0, 40)) ? 'rtl' : 'ltr'}>
                          {e.n !== undefined && (
                            <span className="rsch-n">{doc.style === 'ieee' ? `[${e.n}] ` : `${loc(String(e.n))}. `}</span>
                          )}
                          {richEls(e.runs, pass)}
                        </li>
                      ))}
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
        </div>
      </div>
    </div>
  );
}
