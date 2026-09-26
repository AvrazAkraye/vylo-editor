import { useEffect, useMemo, useState } from 'react';
import { open as openPanel } from '@tauri-apps/plugin-dialog';
import { Icon } from './Icon';
import * as ask from './ask';
import { fill } from './i18n';
import { explain } from './errors';
import type { EffortBook } from './effort';
import { generate, type Target } from './generate';
import type { DocLang } from './research';
import {
  MAX_SAMPLES, MIN_WORDS, closeness, fingerprint, langOfSamples, learnPrompt, newResearcher, parseGuide, sampleOf, stale,
  type Fingerprint, type Researcher,
} from './researchers';
import { readPicked } from './researchfiles';
import { deletePerson, loadPeople, savePerson } from './researchstore';

/**
 * Research's Researchers tab: the people whose manner a document can be
 * written in.
 *
 * A researcher is a name and one or more of their papers. From the papers the
 * app measures what code can measure — sentence and paragraph length, how
 * rich the vocabulary is, the connectors they reach for, the phrases they
 * repeat, whether they write "I", "we" or "the researcher" — and, when asked,
 * the document's model reads them and writes a style guide: tone, how the
 * argument moves, how a part opens and closes. Both go into a document chosen
 * to be written in that manner, as a copy (see `Voice` in research.ts).
 *
 * The papers stay on this machine, in the same IndexedDB database as the
 * documents (researchstore.ts). They leave it only inside the one request
 * that learns the style, to the model the person chose, and a PDF once more
 * to be transcribed — exactly as a data file does.
 *
 * Like the documents, the list and anything in flight live in this module's
 * scope rather than in the component: the sidebar unmounts the panel when
 * another module is clicked, and a style being learned is a minute's request
 * that must not be lost to a click.
 */

const people = new Map<string, Researcher>();
const watchers = new Set<() => void>();
let loaded = false;
/** Set when IndexedDB refused a save. */
let unkept = false;
/** Styles being learned, by researcher id. */
const learning = new Map<string, AbortController>();
/** Papers being read, by researcher id: their file names. */
const reading = new Map<string, string[]>();
/** The researcher open in the tab, kept across the moves between the sidebar and the full window. */
let openNow: string | null = null;

function notify() {
  for (const w of watchers) w();
}

function load() {
  if (loaded) return;
  loaded = true;
  void loadPeople().then((list) => {
    // Refused — blocked by an older window, say — is asked again on the next draw.
    if (!list) { loaded = false; return; }
    // One added before the list arrived is newer than what was stored.
    for (const r of list) if (!people.has(r.id)) people.set(r.id, r);
    notify();
  });
}

/** Saves waiting, by researcher: a name typed a letter at a time is one write, not one per letter of a record holding ten papers. */
const saving = new Map<string, number>();

function keepPerson(r: Researcher, now = false) {
  people.set(r.id, r);
  window.clearTimeout(saving.get(r.id));
  const put = () => {
    saving.delete(r.id);
    // Deleted in the meantime: not put back.
    const cur = people.get(r.id);
    if (cur) void savePerson(cur).then((ok) => { if (!ok && !unkept) { unkept = true; notify(); } });
  };
  if (now) put();
  else saving.set(r.id, window.setTimeout(put, 400));
  notify();
}

const newId = () => {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** Every saved researcher, the most recently changed first, redrawn when the list changes. */
export function usePeople(): Researcher[] {
  const [, setTick] = useState(0);
  useEffect(() => {
    load();
    const w = () => setTick((n) => n + 1);
    watchers.add(w);
    return () => { watchers.delete(w); };
  }, []);
  return [...people.values()].sort((a, b) => b.updated - a.updated);
}

/** A saved researcher by id, as the store holds them now. */
export function personOf(id: string | null | undefined): Researcher | undefined {
  return id ? people.get(id) : undefined;
}

/** Learn a researcher's style from their papers: one request, to the model the panel is set to. */
function learn(r: Researcher, target: Target, book: EffortBook, onFail: (e: unknown) => void, unreadable: string) {
  if (learning.has(r.id) || !r.samples.length) return;
  const ctl = new AbortController();
  learning.set(r.id, ctl);
  notify();
  const { system, user } = learnPrompt(r);
  generate(target, { system, user, maxTokens: 8000, efforts: book, signal: ctl.signal })
    .then((out) => {
      const g = parseGuide(out.text, { lang: langOfSamples(r.samples), now: Date.now(), from: r.samples.map((s) => s.id) });
      if (!g) throw new Error(unreadable);
      // Deleted while it was being learned: nothing to put the guide on.
      const now = people.get(r.id);
      if (!now) return;
      // Learned from the papers the request carried; a paper added since
      // makes it stale, which the tab says.
      keepPerson({ ...now, guide: g, updated: Date.now() }, true);
    })
    .catch((e: unknown) => {
      if ((e as { name?: string })?.name !== 'AbortError') onFail(e);
    })
    .finally(() => {
      learning.delete(r.id);
      notify();
    });
}

function initials(name: string): string {
  const w = name.replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  // A title the name starts with — د, Dr — is not who they are.
  const real = w.filter((x) => !/^(د|دکتۆر|دكتور|أ|ا|پ|Dr|Prof|Mr|Ms|Mrs)$/i.test(x));
  const pick = real.length ? real : w;
  return pick.slice(0, 2).map((x) => [...x][0] ?? '').join('').toUpperCase() || '?';
}

function nameOf(r: Researcher): string {
  return `${r.title.trim()} ${r.name.trim()}`.trim();
}

interface Props {
  t: (s: string) => string;
  /** The language to transcribe a PDF in when the researcher has no papers yet to tell by. */
  lang: DocLang;
  target: Target;
  book: EffortBook;
  ready: boolean;
  /** Start a document in this researcher's manner: the Write tab, with them chosen. */
  onWrite: (id: string) => void;
  onError: (m: string) => void;
}

export function ResearchPeople(p: Props) {
  const { t } = p;
  const list = usePeople();
  const [openId, setOpen] = useState<string | null>(openNow);
  const [name, setName] = useState('');
  const setOpenId = (id: string | null) => { openNow = id; setOpen(id); };
  const open = openId ? people.get(openId) : undefined;

  if (open) return <PersonView {...p} r={open} onBack={() => setOpenId(null)} />;

  const add = () => {
    const n = name.trim();
    if (!n) return;
    const r = newResearcher({ id: newId(), now: Date.now(), name: n });
    keepPerson(r, true);
    setName('');
    setOpenId(r.id);
  };

  return (
    <div className="rsch-people">
      <p className="rsch-lede">{t('Save a researcher and one or more of their papers. The app learns how they write, and any document can then be written in their manner.')}</p>
      {unkept && <p className="rsch-warn rsch-in">{t('Researchers cannot be kept on this machine right now.')}</p>}
      <div className="rsch-people-add">
        <input value={name} onChange={(e) => setName(e.target.value)} dir="auto" placeholder={t('The researcher’s name')}
               aria-label={t('The researcher’s name')}
               onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button className="sb-cta-go" disabled={!name.trim()} onClick={add}>
          <Icon name="plus" size={12} />{t('Add')}
        </button>
      </div>
      {list.length > 0
        ? (
          <ul className="rsch-people-list">
            {list.map((r) => {
              const words = r.samples.reduce((n, s) => n + s.words, 0);
              const busy = learning.has(r.id);
              return (
                <li key={r.id}>
                  <button className="rsch-person" onClick={() => setOpenId(r.id)}>
                    <span className="rsch-avatar" aria-hidden="true">{initials(r.name)}</span>
                    <span className="rsch-doc-what">
                      <b dir="auto">{nameOf(r) || t('Unnamed researcher')}</b>
                      <span dir="auto">
                        {[r.field, r.affiliation].filter((x) => x.trim()).join(' · ') || fill(t('{n} papers'), { n: r.samples.length })}
                      </span>
                    </span>
                    <span className={`rsch-badge ${busy ? 'is-live' : r.guide && !stale(r) ? 'is-ok' : ''}`}>
                      {busy ? t('Learning…')
                        : r.guide ? (stale(r) ? t('Learn again') : t('Style learned'))
                        : words ? fill(t('{n} words'), { n: words.toLocaleString() })
                        : t('No papers yet')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )
        : (
          <ol className="rsch-how">
            <li><b>{t('Add a researcher')}</b><span>{t('Their name, and their title and field if you like.')}</span></li>
            <li><b>{t('Attach their papers')}</b><span>{t('One or more — Word, PDF or text, or paste them. The more they wrote, the better the style is caught.')}</span></li>
            <li><b>{t('Learn the style')}</b><span>{t('Then write any document in their manner, from the Write tab or from here.')}</span></li>
          </ol>
        )}
    </div>
  );
}

function PersonView({ t, lang, target, book, ready, r, onBack, onWrite, onError }: Props & { r: Researcher; onBack: () => void }) {
  const print = useMemo(() => fingerprint(r.samples), [r.samples]);
  const busy = learning.has(r.id);
  const inFlight = reading.get(r.id) ?? [];
  const [paste, setPaste] = useState(false);
  const [pasteName, setPasteName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [trial, setTrial] = useState('');
  const [trying, setTrying] = useState(false);
  const full = r.samples.length >= MAX_SAMPLES;
  const change = (next: Partial<Researcher>) => keepPerson({ ...r, ...next, updated: Date.now() });
  // Whether `voiceOf` has something to copy — asked cheaply, since every
  // keystroke in the name field makes a new record.
  const voice = !!r.guide || r.samples.reduce((n, x) => n + x.words, 0) >= MIN_WORDS;
  const trialPrint = useMemo(
    () => (trial.trim() ? fingerprint([sampleOf({ id: 'trial', name: 'trial', text: trial, now: 0 })]) : null),
    [trial],
  );
  const match = closeness(print, trialPrint);

  /** Papers arrive after a read that may outlast this view; they go onto the researcher as they are then. */
  const addSamples = (got: { id: string; name: string; text: string; truncated?: boolean }[]) => {
    const now = people.get(r.id);
    if (!now || !got.length) return;
    const room = MAX_SAMPLES - now.samples.length;
    const add = got.slice(0, Math.max(0, room))
      // A file only partly read is a sample only partly kept, whichever cut it.
      .map((g) => { const x = sampleOf({ ...g, now: Date.now() }); return g.truncated ? { ...x, truncated: true } : x; })
      .filter((s) => s.words > 0);
    if (got.length > room) onError(fill(t('A researcher keeps {n} papers at most; the rest were not added.'), { n: MAX_SAMPLES }));
    if (add.length) keepPerson({ ...now, samples: [...now.samples, ...add], updated: Date.now() }, true);
  };

  const attach = async () => {
    const picked = await openPanel({
      multiple: true,
      title: t('Attach their papers'),
      filters: [{ name: t('Papers'), extensions: ['docx', 'pdf', 'txt', 'md'] }],
    });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    const got: { id: string; name: string; text: string; truncated?: boolean }[] = [];
    for (const path of paths) {
      const name = path.split(/[\\/]/).pop() ?? path;
      reading.set(r.id, [...(reading.get(r.id) ?? []), name]);
      notify();
      try {
        const f = await readPicked(path, { id: newId(), target, book, lang: langOfSamples(r.samples, lang) });
        if (!f) onError(fill(t('{name} cannot be read. Save it as .docx, .txt or .pdf and attach that.'), { name }));
        else if (!f.text.trim()) onError(fill(t('Nothing could be read from {name}.'), { name }));
        else got.push({ id: f.id, name: f.name, text: f.text, truncated: f.truncated });
      } catch (e) {
        onError(explain(e, fill(t('read {name}'), { name })));
      } finally {
        reading.set(r.id, (reading.get(r.id) ?? []).filter((n) => n !== name));
        notify();
      }
    }
    addSamples(got);
  };

  const addPasted = () => {
    if (!pasteText.trim()) return;
    addSamples([{ id: newId(), name: pasteName.trim() || t('Pasted text'), text: pasteText }]);
    setPasteText('');
    setPasteName('');
    setPaste(false);
  };

  const remove = async () => {
    const yes = await ask.confirm({
      title: t('Delete this researcher?'),
      body: `${nameOf(r)}\n\n${t('Their papers and learned style are removed from this machine. Documents already written in their manner keep it.')}`,
      confirmLabel: t('Delete'),
      danger: true,
    });
    if (!yes) return;
    learning.get(r.id)?.abort();
    window.clearTimeout(saving.get(r.id));
    saving.delete(r.id);
    people.delete(r.id);
    void deletePerson(r.id);
    notify();
    onBack();
  };

  const field = (k: 'name' | 'title' | 'affiliation' | 'field', label: string, wide = false) => (
    <label className={wide ? 'rsch-f rsch-wide' : 'rsch-f'}>
      <span>{label}</span>
      <input value={r[k]} onChange={(e) => change({ [k]: e.target.value })} dir="auto" />
    </label>
  );

  return (
    <div className="rsch-person-view">
      <div className="rsch-top">
        <button className="sb-act rsch-back" onClick={onBack} title={t('Back')} aria-label={t('Back')}>
          <Icon name="chevron" size={14} />
        </button>
        <span className="rsch-avatar" aria-hidden="true">{initials(r.name)}</span>
        <div className="rsch-title">
          <b dir="auto">{nameOf(r) || t('Unnamed researcher')}</b>
          <span>{fill(t('{n} papers'), { n: r.samples.length })} · {fill(t('{n} words'), { n: r.samples.reduce((n, s) => n + s.words, 0).toLocaleString() })}</span>
        </div>
        <button className="sb-act" onClick={() => void remove()} title={t('Delete this researcher')} aria-label={t('Delete this researcher')}>
          <Icon name="close" size={14} />
        </button>
      </div>

      <div className="rsch-form">
        {field('name', t('Name'))}
        {field('title', t('Title — Dr., Prof., أ.د.'))}
        {field('field', t('Field'))}
        {field('affiliation', t('University or institution'))}
        <label className="rsch-f rsch-wide">
          <span>{t('What you know about how they write (optional)')}</span>
          <textarea rows={2} value={r.note} onChange={(e) => change({ note: e.target.value })} dir="auto"
                    placeholder={t('For example: short, firm sentences; always opens a chapter with a question.')} />
        </label>
      </div>

      <div className="sb-sub">{t('Their papers')}</div>
      <div className="rsch-data">
        <div className="rsch-row">
          <button type="button" className="ghost" disabled={full || inFlight.length > 0} onClick={() => void attach()}>
            <Icon name="attach" size={12} />{t('Attach their papers')}
          </button>
          <button type="button" className="ghost" disabled={full} onClick={() => setPaste(!paste)} aria-expanded={paste}>
            <Icon name="clipboard" size={12} />{t('Paste a text')}
          </button>
        </div>
        <small>{t('Their own writing only — a thesis, articles, a chapter. Their reference lists are left out when they are found.')}</small>
        {paste && (
          <div className="rsch-paste">
            <input value={pasteName} onChange={(e) => setPasteName(e.target.value)} dir="auto" placeholder={t('What it is — e.g. the title of the article')} />
            <textarea rows={6} value={pasteText} onChange={(e) => setPasteText(e.target.value)} dir="auto"
                      placeholder={t('Paste a passage of theirs: a few pages at least.')} />
            <div className="rsch-row">
              <button className="sb-cta-go" disabled={!pasteText.trim()} onClick={addPasted}><Icon name="plus" size={12} />{t('Add the text')}</button>
              <button className="ghost" onClick={() => setPaste(false)}>{t('Cancel')}</button>
            </div>
          </div>
        )}
        {(r.samples.length > 0 || inFlight.length > 0) && (
          <ul className="rsch-files">
            {r.samples.map((s) => (
              <li key={s.id}>
                <Icon name="file" size={12} />
                <b dir="auto">{s.name}</b>
                <span>{fill(t('{n} words'), { n: s.words.toLocaleString() })}{s.truncated ? ` · ${t('only the start could be kept')}` : ''}</span>
                <button type="button" className="sb-act" onClick={() => change({ samples: r.samples.filter((x) => x.id !== s.id) })}
                        title={t('Remove')} aria-label={t('Remove')}><Icon name="close" size={11} /></button>
              </li>
            ))}
            {inFlight.map((n) => (
              <li key={`r-${n}`} className="is-reading"><span className="rsch-dot is-live" aria-hidden="true" /><b dir="auto">{n}</b><span>{t('Reading…')}</span></li>
            ))}
          </ul>
        )}
      </div>

      <div className="sb-sub">{t('Their style')}</div>
      {print ? <Measures t={t} print={print} /> : <p className="rsch-lede">{t('Add at least 150 words of their writing and their style is measured here.')}</p>}

      {r.guide && (
        <div className="rsch-guide" dir="auto">
          <p>{r.guide.summary}</p>
          <dl>
            {r.guide.traits.map((x, i) => (
              <div key={i}><dt>{x.name}</dt><dd>{x.detail}</dd></div>
            ))}
          </dl>
          {r.guide.phrases.length > 0 && (
            <div className="rsch-chips" aria-label={t('Expressions they reuse')}>
              {r.guide.phrases.map((x) => <span key={x} className="rsch-chip">{x}</span>)}
            </div>
          )}
          {r.guide.avoid.length > 0 && (
            <>
              <b className="rsch-guide-h">{t('What they avoid')}</b>
              <ul>{r.guide.avoid.map((x) => <li key={x}>{x}</li>)}</ul>
            </>
          )}
        </div>
      )}
      {r.guide && stale(r) && <p className="rsch-warn rsch-in">{t('Papers were added or removed since the style was learned. Learn it again to include them.')}</p>}

      <div className="rsch-acts">
        {busy
          ? (
            <button className="ghost" onClick={() => learning.get(r.id)?.abort()}>
              <Icon name="stop" size={12} />{t('Stop')}
            </button>
          )
          : (
            <button className={r.guide && !stale(r) ? 'ghost' : 'sb-cta-go'} disabled={!ready || !r.samples.length || inFlight.length > 0}
                    title={!r.samples.length ? t('Attach their papers first.') : undefined}
                    onClick={() => learn(r, target, book, (e) => onError(explain(e, t('learn the style'))), t('The style could not be read from the answer. Try again.'))}>
              <Icon name="sparkle" size={12} />{r.guide ? t('Learn again') : t('Learn the style')}
            </button>
          )}
        <button className={r.guide && !stale(r) ? 'sb-cta-go' : 'ghost'} disabled={!voice} onClick={() => onWrite(r.id)}>
          <Icon name="pencil" size={12} />{t('Write in this style')}
        </button>
      </div>
      {busy && <p className="rsch-lede rsch-live-line"><span className="rsch-dot is-live" aria-hidden="true" />{fill(t('Reading the papers of {name} and learning how they write…'), { name: nameOf(r) })}</p>}
      {!r.guide && print && !busy && <p className="rsch-lede">{t('The numbers above are measured on this machine. Learning the style also sends the papers to the model you chose, once, to describe the manner in words.')}</p>}

      <button className="rsch-more" onClick={() => setTrying(!trying)} aria-expanded={trying}>
        <Icon name="chevron" size={11} />
        {t('Test a text against this style')}
      </button>
      {trying && (
        <div className="rsch-paste">
          <textarea rows={5} value={trial} onChange={(e) => setTrial(e.target.value)} dir="auto"
                    placeholder={t('Paste a text to see how close it is to their manner.')} />
          {match
            ? <Closeness t={t} match={match} />
            : trial.trim() && <p className="rsch-lede">{t('Paste at least 150 words, and give the researcher at least as many.')}</p>}
        </div>
      )}
    </div>
  );
}

/** The measured style, as a grid of numbers and the words they reach for. */
function Measures({ t, print }: { t: (s: string) => string; print: Fingerprint }) {
  const person = print.person === 'I' ? t('in the first person (I)') : print.person === 'we' ? t('as “we”') : t('impersonally (the researcher)');
  return (
    <div className="rsch-measures">
      <dl className="rsch-stats">
        <div><dt>{t('Sentence length')}</dt><dd>{fill(t('{n} words'), { n: print.sentenceWords })}</dd></div>
        <div><dt>{t('Paragraph length')}</dt><dd>{fill(t('{n} words'), { n: print.paragraphWords })}</dd></div>
        <div><dt>{t('Vocabulary richness')}</dt><dd>{Math.round(print.richness * 100)}%</dd></div>
        <div><dt>{t('Writes')}</dt><dd>{person}</dd></div>
        <div><dt>{t('Questions')}</dt><dd>{fill(t('{n} per 1,000 words'), { n: print.questions })}</dd></div>
        <div><dt>{t('Citations')}</dt><dd>{fill(t('{n} per 1,000 words'), { n: print.citations })}</dd></div>
      </dl>
      {print.connectors.length > 0 && (
        <>
          <b className="rsch-guide-h">{t('Connectors they reach for')}</b>
          <div className="rsch-chips">
            {print.connectors.map((c) => <span key={c.word} className="rsch-chip" dir="auto">{c.word}<small>{c.per1000}</small></span>)}
          </div>
        </>
      )}
      {print.phrases.length > 0 && (
        <>
          <b className="rsch-guide-h">{t('Phrases they repeat')}</b>
          <div className="rsch-chips">
            {print.phrases.map((c) => <span key={c.text} className="rsch-chip" dir="auto">{c.text}<small>×{c.count}</small></span>)}
          </div>
        </>
      )}
    </div>
  );
}

type Match = NonNullable<ReturnType<typeof closeness>>;

/** How close a text is to a researcher's manner: the overall number, and each measure's. */
export function Closeness({ t, match, name }: { t: (s: string) => string; match: Match; name?: string }) {
  const band = match.score >= 75 ? 'is-ok' : match.score >= 50 ? 'is-warn' : 'is-bad';
  const what = (w: Match['parts'][number]['what']) =>
    w === 'sentences' ? t('Sentence length')
      : w === 'paragraphs' ? t('Paragraph length')
      : w === 'vocabulary' ? t('Vocabulary richness')
      : w === 'connectors' ? t('Connectors')
      : w === 'person' ? t('Writes')
      : t('Questions');
  return (
    <div className="rsch-close">
      <div className={`rsch-close-score ${band}`}>
        <b>{Math.round(match.score)}%</b>
        <span>{name ? fill(t('close to the manner of {name}'), { name }) : t('close to their manner')}</span>
      </div>
      <ul className="rsch-bars">
        {match.parts.map((x) => (
          <li key={x.what}>
            <span>{what(x.what)}</span>
            <i><s style={{ inlineSize: `${Math.max(2, Math.min(100, x.score))}%` }} /></i>
            <small>{Math.round(x.score)}%</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
