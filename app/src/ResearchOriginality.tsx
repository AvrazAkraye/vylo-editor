import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { open as openPanel } from '@tauri-apps/plugin-dialog';
import { Icon } from './Icon';
import { fill } from './i18n';
import { explain } from './errors';
import type { EffortBook } from './effort';
import type { Target } from './generate';
import type { Doc, DocLang } from './research';
import { cleanDoi, search, type Get } from './scholar';
import { fold } from './settings';
import {
  check, context, distinctive, integrity, pieceOfText, piecesOf, refOfDoc, refsOf, segments,
  type Issue, type Match, type Piece, type Ref, type Report,
} from './originality';
import { closeness, fingerprint, sampleOf, type Researcher } from './researchers';
import { readPicked } from './researchfiles';
import { Closeness } from './ResearchPeople';

/**
 * Research's originality check: how much of a text is somebody else's words,
 * and whether what it borrows is cited.
 *
 * Everything is compared on this machine (originality.ts), against texts the
 * app already holds: a document's sources — their abstracts, which is what
 * the indexes give — its data files, the papers of the researcher whose
 * manner it is written in (imitating a writer is not a licence to copy them),
 * the other documents, and any text added here for the purpose, such as a
 * colleague's thesis. One more comparison goes out, and only when the button
 * that says so is pressed: a few of the text's most distinctive sentences
 * searched in OpenAlex and Crossref, whose abstracts are compared too.
 *
 * It is not Turnitin, and says so: the open web, full texts behind paywalls
 * and other students' submissions are not searched. What it catches well is
 * what this module can cause — a writer that leant too hard on an abstract,
 * a passage repeated by two writers working in parallel, a claim with no
 * source, a source nobody cited.
 *
 * Results live in this module's scope, by what was checked, so moving between
 * tabs or to the full window does not throw a check away.
 */

interface Result {
  report: Report;
  issues: Issue[];
  refs: Ref[];
  pieces: Piece[];
  at: number;
}

/** Checks done, by document id, or '' for a pasted text. */
const results = new Map<string, Result>();
/** Texts added to compare with, for the session. */
let extra: Ref[] = [];
/** Abstracts found in the catalogues, by what was checked. */
const online = new Map<string, Ref[]>();
const searching = new Set<string>();
const running = new Set<string>();
/** The pasted text, and what the standalone tab is checking: '' is the pasted text, else a document id. */
let pasted = '';
let chosen = '';
const opts = { sources: true, data: true, voice: true, docs: true, people: false, extra: true, skipQuoted: true, skipCited: false };

const watchers = new Set<() => void>();
function notify() { for (const w of watchers) w(); }
function useWatch() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const w = () => setTick((n) => n + 1);
    watchers.add(w);
    return () => { watchers.delete(w); };
  }, []);
}

/** A plain GET with no headers, exactly as scholar.ts is always handed one. */
const get: Get = (url, signal) => fetch(url, { signal });

const newId = () => {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** The papers of a researcher, as texts to compare with. */
function papersOf(r: Researcher): Ref[] {
  const who = `${r.title} ${r.name}`.trim();
  return r.samples.map((s) => ({ id: `paper:${r.id}:${s.id}`, kind: 'sample' as const, label: `${who} — ${s.name}`, text: s.text }));
}

/** What a check compares with, as the options say. */
function refsFor(doc: Doc | undefined, docs: readonly Doc[], people: readonly Researcher[], owner: string): Ref[] {
  const out: Ref[] = [];
  if (doc) {
    for (const r of refsOf(doc)) if ((r.kind === 'source' && opts.sources) || (r.kind === 'data' && opts.data)) out.push(r);
    if (opts.voice && doc.voice) {
      const who = people.find((p) => p.id === doc.voice?.id);
      // Deleted since: the passages the document carries are all that is left of them.
      if (who) out.push(...papersOf(who));
      else doc.voice.excerpts.forEach((x, i) => out.push({ id: `voice:${i}`, kind: 'sample', label: doc.voice?.name ?? '', text: x }));
    }
  }
  if (opts.docs) {
    for (const d of docs) if (d.id !== doc?.id && d.sections.some((s) => s.state === 'done' && s.text.trim())) out.push(refOfDoc(d));
  }
  if (opts.people) {
    for (const p of people) if (!(doc?.voice && opts.voice && p.id === doc.voice.id)) out.push(...papersOf(p));
  }
  if (opts.extra) out.push(...extra);
  out.push(...(online.get(owner) ?? []));
  return out;
}

function run(owner: string, doc: Doc | undefined, docs: readonly Doc[], people: readonly Researcher[]) {
  if (running.has(owner)) return;
  const pieces = doc ? piecesOf(doc) : [pieceOfText(pasted)];
  if (!pieces.some((p) => p.text.trim())) return;
  running.add(owner);
  notify();
  // A frame to draw "Checking…" first: a thesis against a library is a second's work.
  window.setTimeout(() => {
    try {
      const refs = refsFor(doc, docs, people, owner);
      const report = check(pieces, refs, { skipQuoted: opts.skipQuoted, skipCited: opts.skipCited });
      // Stamped with the version checked, so an edit made while a search
      // was running still says the check is behind.
      results.set(owner, { report, issues: doc ? integrity(doc) : [], refs, pieces, at: doc ? doc.updated : Date.now() });
    } finally {
      running.delete(owner);
      notify();
    }
  }, 30);
}

interface Props {
  t: (s: string) => string;
  /** The document being checked. Absent in the module's own tab, where one is chosen or a text is pasted. */
  doc?: Doc;
  docs: Doc[];
  people: Researcher[];
  lang: DocLang;
  target: Target;
  book: EffortBook;
  /** Rewriting is refused while the document is being written, and without a key. */
  canRewrite: boolean;
  onRewrite?: (index: number, redo: string) => void;
  onRead?: (sectionId: string) => void;
  onOpenDoc?: (id: string) => void;
  onError: (m: string) => void;
}

export function ResearchOriginality(p: Props) {
  useWatch();
  const { t, docs } = p;
  const [pick, setPick] = useState(chosen);
  if (p.doc) return <Checker {...p} key={p.doc.id} doc={p.doc} owner={p.doc.id} />;
  const doc = pick ? docs.find((d) => d.id === pick) : undefined;
  const choose = (id: string) => { chosen = id; setPick(id); };
  return (
    <div className="rsch-orig">
      <label className="rsch-f">
        <span>{t('What to check')}</span>
        <select value={doc ? pick : ''} onChange={(e) => choose(e.target.value)}>
          <option value="">{t('A text I paste or attach')}</option>
          {docs.filter((d) => d.sections.some((s) => s.state === 'done')).map((d) => (
            <option key={d.id} value={d.id}>{d.meta.title || d.request}</option>
          ))}
        </select>
      </label>
      {doc
        ? (
          <>
            {p.onOpenDoc && (
              <button className="ghost rsch-open-doc" onClick={() => p.onOpenDoc?.(doc.id)}>
                <Icon name="book" size={12} />{t('Open the document')}
              </button>
            )}
            <Checker {...p} key={doc.id} doc={doc} owner={doc.id} />
          </>
        )
        : <Checker {...p} key="" owner="" />}
    </div>
  );
}

/**
 * A passage as the card shows it: citation markers are the app's, not the
 * reader's, and a match that runs for pages is shown by its two ends.
 */
function shown(text: string, most = 420): string {
  const x = text.replace(/\s*\[@[^\]]*\]/g, '');
  return x.length > most ? `${x.slice(0, most - 140)} … ${x.slice(-120)}` : x;
}

/** Band of a similarity score: low, some, high. */
function bandOf(score: number): 'is-ok' | 'is-warn' | 'is-bad' {
  return score <= 15 ? 'is-ok' : score <= 30 ? 'is-warn' : 'is-bad';
}

type View = 'matches' | 'from' | 'parts' | 'citations' | 'repeats';
const views = new Map<string, View>();

function Checker({ t, doc, docs, people, lang, target, book, canRewrite, onRewrite, onRead, owner, onError }: Props & { owner: string }) {
  useWatch();
  const [text, setText] = useState(pasted);
  const [adding, setAdding] = useState(false);
  const [addName, setAddName] = useState('');
  const [addText, setAddText] = useState('');
  const [loading, setLoading] = useState(false);
  const [view, setViewNow] = useState<View>(views.get(owner) ?? 'matches');
  const [more, setMore] = useState(40);
  const [only, setOnly] = useState<string | null>(null);
  const setView = (v: View) => { views.set(owner, v); setViewNow(v); setOnly(null); };
  const res = results.get(owner);
  const busy = running.has(owner);
  const looking = searching.has(owner);
  const [, redraw] = useState(0);
  const [cut, setCut] = useState<string[]>([]);
  // The document as it is now, for a check that starts after a search of
  // several seconds: the one drawn when the button was pressed may be old.
  const latest = useRef(doc);
  latest.current = doc;
  const flip = (k: keyof typeof opts) => { opts[k] = !opts[k]; redraw((n) => n + 1); };

  const written = doc ? doc.sections.some((s) => s.state === 'done' && s.text.trim()) : text.trim().length > 0;
  const changed = !!(res && doc && doc.updated > res.at);
  const voiceOwner = doc?.voice ? people.find((x) => x.id === doc.voice?.id) : undefined;
  const otherDocs = docs.filter((d) => d.id !== doc?.id && d.sections.some((s) => s.state === 'done')).length;
  const papers = people.reduce((n, x) => n + x.samples.length, 0);

  const setPasted = (v: string) => { pasted = v; setText(v); };

  /** A file read into text: into the box being checked, or as a text to compare with. */
  const readFiles = async (into: 'check' | 'extra') => {
    const picked = await openPanel({
      multiple: into === 'extra',
      title: into === 'check' ? t('Attach a file to check') : t('Add texts to compare with'),
      filters: [{ name: t('Documents'), extensions: ['docx', 'pdf', 'txt', 'md'] }],
    });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    setLoading(true);
    try {
      for (const path of paths) {
        const name = path.split(/[\\/]/).pop() ?? path;
        try {
          const f = await readPicked(path, { id: newId(), target, book, lang });
          if (!f || !f.text.trim()) { onError(fill(t('Nothing could be read from {name}.'), { name })); continue; }
          // A file too long to keep whole is checked by its beginning, and says so.
          if (f.truncated) setCut((c) => [...c.filter((x) => x !== f.name), f.name]);
          if (into === 'check') setPasted(f.text);
          else extra = [...extra, { id: `extra:${f.id}`, kind: 'pasted', label: f.name, text: f.text }];
        } catch (e) {
          onError(explain(e, fill(t('read {name}'), { name })));
        }
      }
    } finally {
      setLoading(false);
      notify();
    }
  };

  const addPasted = () => {
    if (!addText.trim()) return;
    extra = [...extra, { id: `extra:${newId()}`, kind: 'pasted', label: addName.trim() || t('Pasted text'), text: addText }];
    setAddText('');
    setAddName('');
    setAdding(false);
    notify();
  };

  /** Look the most distinctive sentences up in the catalogues, then check again with what was found. */
  const lookUp = async () => {
    if (searching.has(owner)) return;
    const now = latest.current;
    const pieces = now ? piecesOf(now) : [pieceOfText(pasted)];
    const queries = distinctive(pieces, 8);
    if (!queries.length) { onError(t('The text has no sentences long enough to search for.')); return; }
    searching.add(owner);
    notify();
    try {
      const r = await search(queries, 30, get);
      // The document's own sources come back from the catalogues too. They
      // are compared already, as sources whose citations count; found again
      // without a key they would count every cited passage as uncited.
      const cur = latest.current;
      const key = (title: string) => fold(title).replace(/\s+/g, ' ').trim();
      const dois = new Set((cur?.sources ?? []).map((s) => (s.doi ? cleanDoi(s.doi) : null)).filter(Boolean));
      const titles = new Set((cur?.sources ?? []).map((s) => key(s.title)).filter(Boolean));
      const found: Ref[] = r.sources
        .filter((s) => s.abstract)
        .filter((s) => !(s.doi && dois.has(cleanDoi(s.doi))) && !titles.has(key(s.title)))
        .map((s) => ({
          id: `online:${s.doi ?? s.key}`,
          kind: 'online',
          label: [s.title, s.year ? `(${s.year})` : ''].filter(Boolean).join(' '),
          text: `${s.title}\n${s.abstract ?? ''}`,
        }));
      online.set(owner, found);
      if (r.failed && r.failed >= (r.sent ?? queries.length)) onError(t('The catalogues could not be reached. The check used the texts on this machine only.'));
    } catch (e) {
      onError(explain(e, t('search the catalogues')));
    } finally {
      searching.delete(owner);
      notify();
    }
    run(owner, latest.current, docs, people);
  };

  const pieceHeading = (id: string) => res?.pieces.find((x) => x.id === id)?.heading ?? '';
  const refOf = (id: string) => res?.refs.find((x) => x.id === id);
  const indexOf = (pieceId: string) => doc ? doc.sections.findIndex((s) => s.id === pieceId) : -1;
  const rewrite = (pieceId: string, redo: string) => {
    const i = indexOf(pieceId);
    if (i >= 0 && onRewrite) onRewrite(i, redo);
  };

  const kindName = (k: Ref['kind']) =>
    k === 'source' ? t('Source') : k === 'data' ? t('Data file') : k === 'sample' ? t('Researcher’s paper')
      : k === 'document' ? t('Your document') : k === 'online' ? t('Catalogue') : t('Added text');

  const report = res?.report;
  const matches = report ? report.matches.filter((m) => !only || m.piece === only) : [];
  const counted = (m: Match) => !(opts.skipQuoted && m.quoted) && !(opts.skipCited && m.cited);

  const copyReport = () => {
    if (!report || !res) return;
    const lines = [
      doc ? (doc.meta.title || doc.request) : t('Pasted text'),
      `${t('Similarity')}: ${report.score}% · ${fill(t('{n} words checked'), { n: report.words.toLocaleString() })}`,
      '',
      ...report.byRef.map((b) => `${b.score}%  ${refOf(b.ref)?.label ?? b.ref}`),
      '',
      ...report.byPiece.filter((b) => b.matchedWords).map((b) => `${b.score}%  ${pieceHeading(b.piece)}`),
    ];
    void navigator.clipboard.writeText(lines.join('\n')).catch(() => onError(t('The report could not be copied.')));
  };

  return (
    <div className="rsch-orig">
      {!doc && (
        <div className="rsch-paste">
          <textarea rows={7} value={text} onChange={(e) => setPasted(e.target.value)} dir="auto"
                    placeholder={t('Paste the text to check — a chapter, an article, a whole thesis.')} />
          <div className="rsch-row">
            <button className="ghost" disabled={loading} onClick={() => void readFiles('check')}><Icon name="attach" size={12} />{t('Attach a file to check')}</button>
            {text.trim() && <small>{fill(t('{n} words'), { n: text.trim().split(/\s+/).length.toLocaleString() })}</small>}
          </div>
        </div>
      )}

      <fieldset className="rsch-against">
        <legend>{t('Compare with')}</legend>
        {doc && <Check on={opts.sources} flip={() => flip('sources')} label={fill(t('Its sources ({n})'), { n: doc.sources.filter((s) => s.use && s.abstract).length })} />}
        {doc && !!doc.files?.length && <Check on={opts.data} flip={() => flip('data')} label={fill(t('Its data files ({n})'), { n: doc.files.length })} />}
        {doc?.voice && <Check on={opts.voice} flip={() => flip('voice')} label={fill(t('The papers of {name}, whose manner it is written in'), { name: doc.voice.name })} />}
        <Check on={opts.docs} flip={() => flip('docs')} label={fill(t('Your other documents ({n})'), { n: otherDocs })} />
        {papers > 0 && <Check on={opts.people} flip={() => flip('people')} label={fill(t('Every saved researcher’s papers ({n})'), { n: papers })} />}
        <Check on={opts.extra} flip={() => flip('extra')} label={fill(t('Texts you added to compare with ({n})'), { n: extra.length })} />
        {extra.length > 0 && (
          <ul className="rsch-files">
            {extra.map((x) => (
              <li key={x.id}>
                <Icon name="file" size={12} /><b dir="auto">{x.label}</b>
                <span>{fill(t('{n} words'), { n: x.text.trim().split(/\s+/).length.toLocaleString() })}</span>
                <button type="button" className="sb-act" onClick={() => { extra = extra.filter((y) => y.id !== x.id); notify(); }}
                        title={t('Remove')} aria-label={t('Remove')}><Icon name="close" size={11} /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="rsch-row">
          <button className="ghost" disabled={loading} onClick={() => void readFiles('extra')}><Icon name="attach" size={12} />{t('Add texts to compare with')}</button>
          <button className="ghost" onClick={() => setAdding(!adding)} aria-expanded={adding}><Icon name="clipboard" size={12} />{t('Paste a text')}</button>
        </div>
        {adding && (
          <div className="rsch-paste">
            <input value={addName} onChange={(e) => setAddName(e.target.value)} dir="auto" placeholder={t('What it is — e.g. the title of the article')} />
            <textarea rows={5} value={addText} onChange={(e) => setAddText(e.target.value)} dir="auto" placeholder={t('Paste the text to compare with.')} />
            <div className="rsch-row">
              <button className="sb-cta-go" disabled={!addText.trim()} onClick={addPasted}><Icon name="plus" size={12} />{t('Add the text')}</button>
              <button className="ghost" onClick={() => setAdding(false)}>{t('Cancel')}</button>
            </div>
          </div>
        )}
        <Check on={opts.skipQuoted} flip={() => flip('skipQuoted')} label={t('Leave quoted passages out of the score')} />
        <Check on={opts.skipCited} flip={() => flip('skipCited')} label={t('Leave passages cited to their source out of the score')} />
      </fieldset>

      <div className="rsch-acts">
        <button className="sb-cta-go" disabled={!written || busy || loading} onClick={() => run(owner, doc, docs, people)}>
          <Icon name="shield" size={12} />{busy ? t('Checking…') : res ? t('Check again') : t('Check originality')}
        </button>
        <button className="ghost" disabled={!written || looking || busy} onClick={() => void lookUp()}
                title={t('Sends up to 8 sentences of the text to OpenAlex and Crossref and compares the abstracts found.')}>
          <Icon name="search" size={12} />{looking ? t('Searching…') : t('Search the catalogues too')}
        </button>
      </div>
      <p className="rsch-lede">{t('Compared on this machine. The catalogue search sends a few sentences to OpenAlex and Crossref. The open web, paywalled full texts and other students’ submissions are not searched — this is not Turnitin.')}</p>
      {cut.length > 0 && <p className="rsch-warn rsch-in">{fill(t('Only the beginning of {name} could be read, and only that is checked.'), { name: cut.join('، ') })}</p>}
      {!!online.get(owner)?.length && <p className="rsch-lede">{fill(t('{n} abstracts from the catalogues are included.'), { n: online.get(owner)?.length ?? 0 })}</p>}
      {changed && <p className="rsch-warn rsch-in">{t('The document changed since it was checked. Check again.')}</p>}

      {doc?.voice && voiceOwner && <StyleMatch t={t} doc={doc} who={voiceOwner} />}

      {report && res && (
        <>
          <div className={`rsch-score ${bandOf(report.score)}`}>
            <div className="rsch-score-n">
              <b>{report.score}%</b>
              <span>{t('Similarity')}</span>
            </div>
            <div className="rsch-score-what">
              <b>{report.score <= 15 ? t('Low similarity') : report.score <= 30 ? t('Some similarity — read the passages below') : t('High similarity — rewrite the passages below')}</b>
              <span>{fill(t('{n} words checked'), { n: report.words.toLocaleString() })} · {fill(t('against {n} texts'), { n: res.refs.length })}</span>
              <i className="rsch-meter"><s style={{ inlineSize: `${Math.min(100, report.score)}%` }} /></i>
            </div>
          </div>

          <div className="rsch-seg" role="tablist">
            {(['matches', 'from', 'parts', ...(doc ? ['citations'] as const : []), 'repeats'] as const).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                {v === 'matches' ? t('Passages') : v === 'from' ? t('Where from') : v === 'parts' ? t('By part') : v === 'citations' ? t('Citations') : t('Repeats')}
                <small>
                  {v === 'matches' ? report.matches.length : v === 'from' ? report.byRef.length : v === 'parts' ? report.byPiece.filter((b) => b.matchedWords).length
                    : v === 'citations' ? res.issues.length : report.repeats.length}
                </small>
              </button>
            ))}
          </div>

          {view === 'matches' && (
            <>
              {only && (
                <p className="rsch-filter">
                  <span dir="auto">{pieceHeading(only)}</span>
                  <button className="sb-act" onClick={() => setOnly(null)} title={t('Show all')} aria-label={t('Show all')}><Icon name="close" size={11} /></button>
                </p>
              )}
              {!matches.length && <p className="rsch-lede">{t('No passage matches any of the texts it was compared with.')}</p>}
              <ul className="rsch-hits">
                {matches.slice(0, more).map((m, i) => {
                  const piece = res.pieces.find((x) => x.id === m.piece);
                  const ref = refOf(m.ref);
                  if (!piece || !ref) return null;
                  const c = context(piece.text, m.start, m.end, 90);
                  const theirs = context(ref.text, m.refStart, m.refEnd, 60);
                  const key = ref.key;
                  return (
                    <li key={i} className={counted(m) ? '' : 'is-quiet'}>
                      <div className="rsch-hit-head">
                        <b dir="auto">{piece.heading}</b>
                        <small>{fill(t('{n} words'), { n: m.words })}</small>
                        {m.quoted && <span className="rsch-tag">{t('quoted')}</span>}
                        {m.cited && <span className="rsch-tag is-ok">{t('cited')}</span>}
                      </div>
                      <p className="rsch-hit" dir="auto">{shown(c.before)}<mark>{shown(c.hit)}</mark>{shown(c.after)}</p>
                      <details>
                        <summary><span className="rsch-tag">{kindName(ref.kind)}</span><span dir="auto">{ref.label}</span></summary>
                        <p className="rsch-hit" dir="auto">{shown(theirs.before)}<mark>{shown(theirs.hit)}</mark>{shown(theirs.after)}</p>
                      </details>
                      {doc && (
                        <div className="rsch-row">
                          {onRead && indexOf(m.piece) >= 0 && <button className="ghost" onClick={() => onRead(m.piece)}><Icon name="book" size={11} />{t('Open the part')}</button>}
                          {onRewrite && indexOf(m.piece) >= 0 && !m.quoted && (
                            <button className="ghost" disabled={!canRewrite}
                                    onClick={() => rewrite(m.piece, key
                                      ? `Say the passage "${shown(c.hit, 600)}" in your own words — it is too close to the wording of source [@${key}] — and cite [@${key}] where its idea is used. Keep the rest of the part as it is.`
                                      : `Say the passage "${shown(c.hit, 600)}" in your own words: it is too close to the wording of another text. Keep the rest of the part as it is.`)}>
                              <Icon name="pencil" size={11} />{t('Say it in your own words')}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {matches.length > more && <button className="ghost rsch-more-btn" onClick={() => setMore(more + 40)}>{fill(t('Show {n} more'), { n: Math.min(40, matches.length - more) })}</button>}
            </>
          )}

          {view === 'from' && (
            report.byRef.length
              ? (
                <ul className="rsch-bars rsch-bars-wide">
                  {report.byRef.map((b) => {
                    const ref = refOf(b.ref);
                    return (
                      <li key={b.ref}>
                        <span dir="auto"><span className="rsch-tag">{ref ? kindName(ref.kind) : ''}</span>{ref?.label ?? b.ref}</span>
                        <i className={bandOf(b.score * 3)}><s style={{ inlineSize: `${Math.max(2, Math.min(100, b.score * 3))}%` }} /></i>
                        <small>{b.score}%</small>
                      </li>
                    );
                  })}
                </ul>
              )
              : <p className="rsch-lede">{t('No text it was compared with shares a passage with it.')}</p>
          )}

          {view === 'parts' && (
            <ul className="rsch-bars rsch-bars-wide">
              {report.byPiece.map((b) => (
                <li key={b.piece}>
                  <button className="rsch-bar-name" disabled={!b.matchedWords} onClick={() => { setView('matches'); setOnly(b.piece); }}>
                    <span dir="auto">{pieceHeading(b.piece)}</span>
                  </button>
                  <i className={bandOf(b.score)}><s style={{ inlineSize: `${Math.max(b.matchedWords ? 2 : 0, Math.min(100, b.score))}%` }} /></i>
                  <small>{b.score}%</small>
                </li>
              ))}
            </ul>
          )}

          {view === 'citations' && doc && (
            <Issues t={t} doc={doc} issues={res.issues} canRewrite={canRewrite}
                    onRead={onRead} onRewrite={onRewrite ? rewrite : undefined} indexOf={indexOf} />
          )}

          {view === 'repeats' && (
            report.repeats.length
              ? (
                <ul className="rsch-hits">
                  {report.repeats.slice(0, more).map((r, i) => {
                    const a = res.pieces.find((x) => x.id === r.a.piece);
                    const b = res.pieces.find((x) => x.id === r.b.piece);
                    if (!a || !b) return null;
                    const ca = context(a.text, r.a.start, r.a.end, 50);
                    const cb = context(b.text, r.b.start, r.b.end, 50);
                    return (
                      <li key={i}>
                        <div className="rsch-hit-head"><b dir="auto">{a.heading}</b><small>{fill(t('{n} words'), { n: r.words })}</small></div>
                        <p className="rsch-hit" dir="auto">{shown(ca.before)}<mark>{shown(ca.hit)}</mark>{shown(ca.after)}</p>
                        <div className="rsch-hit-head"><b dir="auto">{b.heading}</b></div>
                        <p className="rsch-hit" dir="auto">{shown(cb.before)}<mark>{shown(cb.hit)}</mark>{shown(cb.after)}</p>
                        {doc && onRewrite && indexOf(r.b.piece) >= 0 && (
                          <div className="rsch-row">
                            <button className="ghost" disabled={!canRewrite}
                                    onClick={() => rewrite(r.b.piece, `The passage "${shown(cb.hit, 600)}" repeats what the part "${a.heading}" already says. Remove the repetition: refer back to that part briefly where needed and add something of this part's own instead. Keep the rest as it is.`)}>
                              <Icon name="pencil" size={11} />{t('Remove the repetition')}
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )
              : <p className="rsch-lede">{t('No passage is repeated inside the text.')}</p>
          )}

          {!doc && report.matches.length > 0 && (
            <details className="rsch-marked">
              <summary>{t('The text with the matching passages marked')}</summary>
              <p className="rsch-hit" dir="auto">
                {segments(res.pieces[0].text, report.matches.map((m) => ({ start: m.start, end: m.end })))
                  .map((s, i) => (s.hit ? <mark key={i}>{s.text}</mark> : <Fragment key={i}>{s.text}</Fragment>))}
              </p>
            </details>
          )}

          <div className="rsch-acts">
            <button className="ghost" onClick={copyReport}><Icon name="clipboard" size={12} />{t('Copy the report')}</button>
          </div>
        </>
      )}
    </div>
  );
}

function Check({ on, flip, label }: { on: boolean; flip: () => void; label: string }) {
  return (
    <label className="rsch-check">
      <input type="checkbox" checked={on} onChange={flip} />
      <span dir="auto">{label}</span>
    </label>
  );
}

/** How close the document is to the manner it was written in, measured the same way the researcher's papers were. */
function StyleMatch({ t, doc, who }: { t: (s: string) => string; doc: Doc; who: Researcher }) {
  // Measuring a thesis and ten papers is most of a second: once per change, not per redraw.
  const theirs = useMemo(() => fingerprint(who.samples), [who.samples]);
  // Part by part: one sample of a whole thesis would be cut at a paper's limit.
  const ours = useMemo(
    () => fingerprint(doc.sections.filter((s) => s.state === 'done' && s.text.trim()).map((s) => sampleOf({ id: s.id, name: s.heading, text: s.text, now: 0 }))),
    [doc.sections],
  );
  const match = closeness(theirs, ours);
  if (!match) return null;
  return <Closeness t={t} match={match} name={doc.voice?.name} />;
}

function Issues({ t, doc, issues, canRewrite, onRead, onRewrite, indexOf }: {
  t: (s: string) => string;
  doc: Doc;
  issues: Issue[];
  canRewrite: boolean;
  onRead?: (sectionId: string) => void;
  onRewrite?: (pieceId: string, redo: string) => void;
  indexOf: (pieceId: string) => number;
}) {
  if (!issues.length) return <p className="rsch-lede">{t('Every claim that needs a source has one, and every source is used.')}</p>;
  const heading = (id: string) => doc.sections.find((s) => s.id === id)?.heading ?? '';
  const title = (key: string) => doc.sources.find((s) => s.key === key)?.title ?? key;
  const groups: { what: Issue['what']; label: string; about: string }[] = [
    { what: 'uncited-claim', label: t('Claims without a source'), about: t('A figure, a finding or “studies show” with no citation near it.') },
    { what: 'uncited-quote', label: t('Quotations without a source'), about: t('Words in quotation marks with no citation in their paragraph.') },
    { what: 'uncited-part', label: t('Parts that cite nothing'), about: t('A long part of the document with no citation at all.') },
    { what: 'retracted-source', label: t('Retracted sources cited'), about: t('The publisher withdrew these works. Remove them.') },
    { what: 'dominant-source', label: t('One source carries too much'), about: t('More than 30% of all the citations go to one work.') },
    { what: 'unused-source', label: t('Sources never cited'), about: t('In the reference list, but not cited anywhere in the text.') },
    { what: 'gap', label: t('Gaps left for you'), about: t('Places marked for your own data or text.') },
  ];
  return (
    <div className="rsch-issues">
      {groups.map((g) => {
        const list = issues.filter((x) => x.what === g.what);
        if (!list.length) return null;
        return (
          <section key={g.what}>
            <h4>{g.label} <small>{list.length}</small></h4>
            <p className="rsch-lede">{g.about}</p>
            <ul className="rsch-hits">
              {list.slice(0, 30).map((x, i) => {
                if (x.what === 'unused-source' || x.what === 'retracted-source') {
                  return <li key={i}><p className="rsch-hit" dir="auto">{title(x.key)}</p></li>;
                }
                if (x.what === 'dominant-source') {
                  return <li key={i}><p className="rsch-hit" dir="auto">{title(x.key)} — {Math.round(x.share * 100)}%</p></li>;
                }
                if (x.what === 'uncited-part') {
                  return (
                    <li key={i}>
                      <div className="rsch-hit-head"><b dir="auto">{heading(x.section)}</b><small>{fill(t('{n} words'), { n: x.words })}</small></div>
                      {onRead && <div className="rsch-row"><button className="ghost" onClick={() => onRead(x.section)}><Icon name="book" size={11} />{t('Open the part')}</button></div>}
                    </li>
                  );
                }
                return (
                  <li key={i}>
                    <div className="rsch-hit-head"><b dir="auto">{heading(x.section)}</b></div>
                    <p className="rsch-hit" dir="auto"><mark>{shown(x.text)}</mark></p>
                    <div className="rsch-row">
                      {onRead && <button className="ghost" onClick={() => onRead(x.section)}><Icon name="book" size={11} />{t('Open the part')}</button>}
                      {onRewrite && x.what !== 'gap' && indexOf(x.section) >= 0 && (
                        <button className="ghost" disabled={!canRewrite}
                                onClick={() => onRewrite(x.section, `The sentence "${x.text}" ${x.what === 'uncited-quote' ? 'quotes words' : 'makes a claim'} without a citation. Cite the source it comes from if it is one of the sources you were given; otherwise rephrase it as the researcher's own reasoning, or replace the figure with a [[gap]] saying what the researcher must supply. Keep the rest of the part as it is.`)}>
                          <Icon name="pencil" size={11} />{t('Fix with a citation')}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
