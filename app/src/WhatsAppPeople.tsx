import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as pickFile } from '@tauri-apps/plugin-dialog';
import { Icon } from './Icon';
import { fill, type Lang } from './i18n';
import { dateText } from './fmt';
import type { Chat } from './whatsapp';
import {
  COUNTRIES, excludeSuppressed, fromChats, makeAudience, maskPhone, parseAudience, type ParseOptions,
} from './whatsappaudience';
import { deleteAudience, loadAudiences, saveAudience } from './whatsappbulkstore';
import {
  LIMITS, type Audience, type FileProblem, type InvalidWhy, type Parsed, type Recipient, type Rejected, type SourceFormat,
} from './whatsappbulktypes';

/**
 * Step 1 of a broadcast: who it goes to (docs/WA.md, docs/wa/briefs/ui.md).
 *
 * Four ways in, as tabs, because a shop owner's numbers are in one of four
 * places and they know which: pasted from somewhere, a file, the people they
 * already talk to here, or a list they kept last time. Reading is not this
 * file's job — `whatsappaudience.ts` does it and is trusted to never throw and
 * never invent a person — so this file only decides what to *say* about a
 * read: how many people, how many lines could not be read and why, how many
 * repeated, how many are on the do-not-contact list and were left out.
 *
 * ## The summary is the control
 *
 * "1,204 people · 37 couldn't be read · 12 repeated · 9 asked not to be
 * messaged" is the answer to the only question the person has after pasting
 * ("did it work?"), so it sits where the eye lands, and the things that change
 * it — which column holds the phone, which the name, which country a number
 * without a code belongs to — sit right under it. Changing one reads the same
 * input again with the choice as an override; nothing is patched by hand.
 *
 * ## Numbers are masked here
 *
 * The first rows are shown so the person can check the columns were guessed
 * right, and that needs the name and the shape of the number, not the number:
 * `+964 750 *** 4567` is enough to recognise and not enough to copy off a
 * screen share. Only the report, which is the person's own record of what was
 * sent to whom, shows numbers whole.
 */

// ── small things every step uses ─────────────────────────────────────────

/**
 * A count as the interface writes it: Latin digits with a thousands comma.
 *
 * `fmt.ts` keeps digits 0–9 in every language, and a count is read against the
 * same count elsewhere on the screen; "1,204" in one place and "١٬٢٠٤" in
 * another would look like two different numbers.
 */
export function num(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0';
}

/**
 * A translated sentence with parts that are elements rather than text — the
 * count in bold inside "{n} people", a masked number kept left to right.
 *
 * `fill` would flatten them to strings; concatenating fragments instead would
 * fix English word order into three languages that do not share it. So the
 * template is split at its `{name}`s and each part dropped in where the
 * translation put it.
 */
export function Fill({ text, parts }: { text: string; parts: Record<string, ReactNode> }) {
  const out: ReactNode[] = [];
  const re = /\{(\w+)\}/g;
  let at = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push(<Fragment key={k++}>{text.slice(at, m.index)}</Fragment>);
    const part = parts[m[1]];
    out.push(<Fragment key={k++}>{part === undefined ? m[0] : part}</Fragment>);
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(<Fragment key={k++}>{text.slice(at)}</Fragment>);
  return <>{out}</>;
}

/** A phone as the screens show it: masked, and kept left to right in a right-to-left sentence. */
export function Masked({ phone }: { phone: string }) {
  return <bdi dir="ltr" className="wa-bk-phone">{maskPhone(phone)}</bdi>;
}

// ── the people, as the screens hold them ─────────────────────────────────

/**
 * What step 1 hands to the others: the people who will be messaged, and what
 * the read that produced them said about everything else.
 *
 * `recipients` is after the do-not-contact list, never before — every count
 * and preview downstream is about people who can actually be messaged.
 */
export interface People {
  recipients: Recipient[];
  source: SourceFormat;
  file?: string;
  rejected: Rejected[];
  /** Lines that could not be read beyond the thousand `rejected` lists (the reader counts the rest). */
  rejectedMore?: number;
  /** The read stopped early: 5,000 people, or a file longer than the reader reads. */
  truncated?: boolean;
  duplicates: number;
  /** On the do-not-contact list and left out. */
  removed: number;
  columns: string[];
  phoneColumn: string | null;
  nameColumn: string | null;
  /** The saved list it came from, when it did. */
  audienceId?: string;
  audienceName?: string;
}

/**
 * The id the list being worked on is kept under (`saveAudience`), so closing
 * the panel does not lose a list somebody spent a minute assembling. It is not
 * one of the person's saved lists and the Saved tab does not show it.
 */
export const WORK_AUDIENCE_ID = 'wa-bulk-work';

/** The extensions a list may come in, as the file picker offers them. */
export const LIST_TYPES: readonly string[] = ['txt', 'csv', 'tsv', 'vcf', 'xlsx'];

/** Whether a file's name says it is a list this can read. */
export function acceptsFile(name: string): boolean {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name.trim())?.[1]?.toLowerCase() ?? '';
  return LIST_TYPES.includes(ext);
}

/**
 * The columns worth a variable chip, from the people themselves.
 *
 * Read from the recipients' `vars` rather than from the file's header row so a
 * list restored after a restart (which kept the people, not the file) still
 * offers `{city}`. The first few hundred are enough to see every column a file
 * has, and capped at what the reader keeps.
 */
export function columnsOf(recipients: readonly Recipient[]): string[] {
  const seen: string[] = [];
  for (const r of recipients.slice(0, 300)) {
    for (const k of Object.keys(r.vars ?? {})) {
      if (!seen.includes(k)) seen.push(k);
      if (seen.length >= LIMITS.columns) return seen;
    }
  }
  return seen;
}

/** A read, as the people the campaign can use: the do-not-contact list applied. */
export function peopleFrom(p: Parsed, suppressed: ReadonlySet<string>, file?: string): People {
  const { kept, removed } = excludeSuppressed(p.recipients, suppressed);
  const out: People = {
    recipients: kept, source: p.format, file, rejected: p.rejected, duplicates: p.duplicates, removed,
    columns: p.columns.length ? p.columns : columnsOf(kept), phoneColumn: p.phoneColumn, nameColumn: p.nameColumn,
  };
  if (p.rejectedMore) out.rejectedMore = p.rejectedMore;
  if (p.truncated) out.truncated = true;
  return out;
}

/** How many lines could not be read: every one, not only the thousand the reader lists. */
export const notReadCount = (p: People): number => p.rejected.length + (p.rejectedMore ?? 0);

/** A kept list, as people. What was rejected when it was first read is no longer known, and is not claimed. */
export function peopleFromAudience(a: Audience, suppressed: ReadonlySet<string>): People {
  const { kept, removed } = excludeSuppressed(a.recipients, suppressed);
  return {
    recipients: kept, source: a.source, file: a.file, rejected: [], duplicates: 0, removed,
    columns: columnsOf(kept), phoneColumn: null, nameColumn: null,
    audienceId: a.id === WORK_AUDIENCE_ID ? undefined : a.id, audienceName: a.id === WORK_AUDIENCE_ID ? undefined : a.name,
  };
}

/** Whether a read stopped at the ceiling, said rather than discovered. */
export const atCeiling = (p: People): boolean => p.recipients.length + p.removed >= LIMITS.recipients;

/**
 * Why a line was not a number, in words a shopkeeper reads.
 *
 * Explicit calls with the sentence at the call, not a table: the catalogue
 * test reads literals out of `t(…)`, and a table would ship these in English.
 */
export function whyText(why: InvalidWhy, t: (s: string) => string, hint?: 'excel-rounded'): string {
  if (hint === 'excel-rounded') return t('Excel shortened this number. Format the column as Text and save the file again.');
  if (why === 'empty') return t('Nothing on this line');
  if (why === 'too-short') return t('Too short to be a phone number');
  if (why === 'too-long') return t('Too long to be a phone number');
  if (why === 'country-unknown') return t('No country uses that code');
  return t('Not a phone number');
}

/**
 * Why a whole file could not be read, as a sentence. The reader reports it as a word and one stand-in rejected line
 * (the file's name); shown as that line it read "Line 1 · contacts.xlsx · Not a phone number", which tells a person
 * with a password-protected workbook nothing about what to do.
 */
export function problemText(problem: FileProblem, t: (s: string) => string): string {
  if (problem === 'locked') return t('That file is locked with a password, or is an old .xls. Open it in Excel and save it again as a plain .xlsx.');
  if (problem === 'too-big') return t('That file is too big for a list: 10 MB at most.');
  if (problem === 'not-a-sheet') return t('That file is not an Excel workbook that can be read here. Save it as .xlsx or .csv.');
  if (problem === 'empty') return t('No phone numbers were found in that.');
  return t('That could not be read as a list of numbers.');
}

/** "Iraq +964", with the flag, in the interface's language. */
function countryName(code: string, lang: Lang): string {
  const c = COUNTRIES.find((x) => x.code === code);
  return c ? `${c.flag} ${c.name[lang] || c.name.en} +${c.code}` : `+${code}`;
}

/** Base64 (what `read_any_file` returns) to the bytes the reader takes. */
export function bytesOf(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── a dropped file, which in the app arrives as a path ───────────────────

/**
 * Where a dropped list may land, while the From a file tab is open.
 *
 * Tauri takes the operating system's drop before the webview sees it
 * (`attachments.ts` `listenForDrops`), so an HTML `drop` never fires in the
 * app and a drop zone cannot catch a file by itself. App's `claim(at, paths)`
 * asks `claimBroadcastDrop` first; when the point is over this zone, the first
 * path is read here and App does not attach it to the chat. The HTML `drop`
 * handler below still serves a browser (the visual harness).
 */
let dropZone: { el: HTMLElement; take: (path: string) => void } | null = null;

/** For App's drop `claim`: true when the drop landed on Broadcast's file zone and was taken. */
export function claimBroadcastDrop(at: { x: number; y: number }, paths: readonly string[]): boolean {
  if (!dropZone || !paths.length) return false;
  const r = dropZone.el.getBoundingClientRect();
  if (at.x < r.left || at.x > r.right || at.y < r.top || at.y > r.bottom) return false;
  dropZone.take(paths[0]);
  return true;
}

/**
 * The input last read, kept for the life of the window so a column or country
 * choice can read it again. Not stored: a pasted list or a file's bytes is the
 * person's data, and the people it produced are already kept (`saveAudience`).
 */
let lastRead: { input: string | Uint8Array; opts: ParseOptions } | null = null;

/** Forget the input (Start over). */
export function forgetInput(): void {
  lastRead = null;
}

// ── the step ─────────────────────────────────────────────────────────────

type Way = 'paste' | 'file' | 'chats' | 'saved';
const WAYS: readonly Way[] = ['paste', 'file', 'chats', 'saved'];

export interface AudienceProps {
  t: (s: string) => string;
  lang: Lang;
  people: People | null;
  onPeople: (p: People | null) => void;
  /** The calling code assumed for numbers written without one. */
  country: string;
  onCountry: (code: string) => void;
  chats?: readonly Chat[];
  suppressed: ReadonlySet<string>;
}

export function AudienceStep({ t, lang, people, onPeople, country, onCountry, chats, suppressed }: AudienceProps) {
  const [way, setWay] = useState<Way>('paste');
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState('');
  const [hover, setHover] = useState(false);
  const [saved, setSaved] = useState<Audience[] | null>(null);
  const [saveName, setSaveName] = useState('');
  const [said, setSaid] = useState('');
  /** A saved list whose Delete was pressed once and waits for the second press. */
  const [deleting, setDeleting] = useState('');
  const zone = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const ids = useId();

  /** Read an input with options; every way in comes through here so a column choice can re-run it. */
  async function read(input: string | Uint8Array, opts: ParseOptions) {
    setBusy(true);
    setWhy('');
    setSaid('');
    try {
      const p = await parseAudience(input, { ...opts, defaultCountry: country });
      lastRead = { input, opts };
      if (p.problem) {
        setWhy(problemText(p.problem, t));
        onPeople(null);
      } else if (p.recipients.length === 0 && p.rejected.length === 0) {
        setWhy(t('No phone numbers were found in that.'));
        onPeople(null);
      } else {
        onPeople(peopleFrom(p, suppressed, opts.filename));
      }
    } catch {
      // The reader promises not to throw; if it ever does, the person still gets a sentence.
      setWhy(t('That could not be read as a list of numbers.'));
    } finally {
      setBusy(false);
    }
  }

  async function readPath(path: string) {
    setWhy('');
    try {
      const r = await invoke<{ name: string; data: string; bytes: number }>('read_any_file', { path });
      if (!acceptsFile(r.name)) {
        setWhy(t('That kind of file is not a list. Use .txt, .csv, .tsv, .vcf or .xlsx.'));
        return;
      }
      await read(bytesOf(r.data), { filename: r.name });
    } catch (e) {
      // The 16 MB ceiling and an unreadable file both arrive here as Rust's own words.
      setWhy(fill(t('That file could not be opened: {why}'), { why: e instanceof Error ? e.message : String(e) }));
    }
  }

  async function browse() {
    try {
      const picked = await pickFile({ multiple: false, directory: false, filters: [{ name: t('Lists of numbers'), extensions: [...LIST_TYPES] }] });
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (path) await readPath(path);
    } catch (e) {
      setWhy(fill(t('That file could not be opened: {why}'), { why: e instanceof Error ? e.message : String(e) }));
    }
  }

  // The zone takes app drops (paths) while it is on screen; see `claimBroadcastDrop`.
  useEffect(() => {
    if (way !== 'file' || !zone.current) return;
    dropZone = { el: zone.current, take: (path) => void readPath(path) };
    return () => { dropZone = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [way, country]);

  // The saved lists are fetched when their tab is opened, not before: most broadcasts never look.
  useEffect(() => {
    if (way !== 'saved' || saved) return;
    let live = true;
    void loadAudiences().then((list) => { if (live) setSaved(list.filter((a) => a.id !== WORK_AUDIENCE_ID)); })
      .catch(() => { if (live) setSaved([]); });
    return () => { live = false; };
  }, [way, saved]);

  /** A new country reads the same input again: a number without a code means something else now. */
  function pickCountry(code: string) {
    onCountry(code);
    if (lastRead) {
      const again = lastRead;
      setBusy(true);
      void parseAudience(again.input, { ...again.opts, defaultCountry: code })
        .then((p) => {
          if (p.problem) { setWhy(problemText(p.problem, t)); onPeople(null); return; }
          onPeople({ ...peopleFrom(p, suppressed, again.opts.filename), audienceId: people?.audienceId, audienceName: people?.audienceName });
        })
        .catch(() => setWhy(t('That could not be read as a list of numbers.')))
        .finally(() => setBusy(false));
    }
  }

  function remap(which: 'phoneColumn' | 'nameColumn', col: string) {
    if (!lastRead) return;
    void read(lastRead.input, { ...lastRead.opts, [which]: col });
  }

  async function keep() {
    if (!people) return;
    const name = saveName.trim() || fill(t('List of {date}'), { date: dateText(Date.now()) });
    const parsed: Parsed = {
      format: people.source, recipients: people.recipients, rejected: [], duplicates: 0, columns: people.columns,
      phoneColumn: people.phoneColumn, nameColumn: people.nameColumn, defaultCountry: country,
    };
    const a = { ...makeAudience(parsed, name.slice(0, LIMITS.valueChars)), file: people.file };
    const done = await saveAudience(a).catch(() => false);
    if (done) {
      onPeople({ ...people, audienceId: a.id, audienceName: a.name });
      setSaved(null);
      setSaveName('');
      setSaid(fill(t('Saved as “{name}”.'), { name: a.name }));
    } else {
      setSaid(t('The list could not be saved on this computer.'));
    }
  }

  /** Arrow keys move between the four tabs, the way a tab list is used from the keyboard. */
  function onTabKey(e: ReactKeyboardEvent) {
    const i = WAYS.indexOf(way);
    const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
    const fwd = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    let n = -1;
    if (e.key === fwd) n = (i + 1) % WAYS.length;
    else if (e.key === back) n = (i + WAYS.length - 1) % WAYS.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = WAYS.length - 1;
    if (n < 0) return;
    e.preventDefault();
    setWay(WAYS[n]);
    tabs.current[n]?.focus();
  }

  const wayName = (w: Way): string =>
    w === 'paste' ? t('Paste') : w === 'file' ? t('From a file') : w === 'chats' ? t('From my chats') : t('Saved lists');
  const wayIcon = (w: Way): string => (w === 'paste' ? 'clipboard' : w === 'file' ? 'file' : w === 'chats' ? 'chat' : 'list');

  const fromMyChats = chats && chats.length ? fromChats(chats) : null;
  const notRead = people ? notReadCount(people) : 0;
  const sample = people ? people.recipients.slice(0, 5) : [];
  const shownCols = people ? people.columns.filter((c) => c !== people.phoneColumn && c !== people.nameColumn).slice(0, 2) : [];

  return (
    <section className="wa-bk-step" aria-labelledby={`${ids}-h`}>
      <h3 className="wa-bk-h" id={`${ids}-h`}>{t('Who should get it?')}</h3>

      <div className="wa-bk-tabs" role="tablist" aria-label={t('Where the numbers are')} onKeyDown={onTabKey}>
        {WAYS.map((w, i) => (
          <button key={w} type="button" role="tab" id={`${ids}-t-${w}`} aria-selected={w === way} aria-controls={`${ids}-p`}
                  tabIndex={w === way ? 0 : -1} ref={(el) => { tabs.current[i] = el; }}
                  className={w === way ? 'wa-bk-tab on' : 'wa-bk-tab'} onClick={() => setWay(w)}>
            <Icon name={wayIcon(w)} size={13} />
            <span>{wayName(w)}</span>
          </button>
        ))}
      </div>

      <div className="wa-bk-way" role="tabpanel" id={`${ids}-p`} aria-labelledby={`${ids}-t-${way}`}>
        {way === 'paste' && (
          <>
            <textarea className="wa-bk-area" dir="auto" rows={6} value={pasted} spellCheck={false}
                      aria-label={t('Paste numbers, or a whole list with names')}
                      placeholder={t('Paste numbers, or a whole list with names')}
                      onChange={(e) => setPasted(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && pasted.trim()) { e.preventDefault(); void read(pasted, {}); }
                      }} />
            <button type="button" className="wa-bk-btn" disabled={!pasted.trim() || busy} onClick={() => void read(pasted, {})}>
              <Icon name={busy ? 'clock' : 'check'} size={13} />
              {busy ? t('Reading…') : t('Read these numbers')}
            </button>
          </>
        )}

        {way === 'file' && (
          <div ref={zone} className={hover ? 'wa-bk-drop is-over' : 'wa-bk-drop'}
               onDragOver={(e) => { e.preventDefault(); setHover(true); }}
               onDragLeave={() => setHover(false)}
               onDrop={(e) => {
                 e.preventDefault();
                 setHover(false);
                 const f = e.dataTransfer.files?.[0];
                 if (!f) return;
                 if (!acceptsFile(f.name)) { setWhy(t('That kind of file is not a list. Use .txt, .csv, .tsv, .vcf or .xlsx.')); return; }
                 void f.arrayBuffer().then((b) => read(new Uint8Array(b), { filename: f.name, mime: f.type }));
               }}>
            <Icon name="file" size={20} />
            <p>{t('Drop a list here')}</p>
            <small dir="ltr">.txt · .csv · .tsv · .vcf · .xlsx</small>
            <button type="button" className="wa-bk-btn" onClick={() => void browse()} disabled={busy}>
              <Icon name="folder" size={13} />
              {busy ? t('Reading…') : t('Choose a file…')}
            </button>
          </div>
        )}

        {way === 'chats' && (
          fromMyChats && fromMyChats.recipients.length ? (
            <div className="wa-bk-card">
              <p className="wa-bk-line">
                <Fill text={t('{n} people you have chatted with')} parts={{ n: <b>{num(fromMyChats.recipients.length)}</b> }} />
              </p>
              <p className="wa-bk-quiet">{t('Groups are left out. Only one-to-one chats with a phone number are used.')}</p>
              <button type="button" className="wa-bk-btn" onClick={() => { lastRead = null; onPeople(peopleFrom(fromMyChats, suppressed)); }}>
                <Icon name="check" size={13} />
                {t('Use these people')}
              </button>
            </div>
          ) : (
            <p className="wa-bk-empty">{t('Open your chats first: the people you talk to appear here.')}</p>
          )
        )}

        {way === 'saved' && (
          saved === null ? <p className="wa-bk-empty">{t('Loading…')}</p>
            : saved.length === 0 ? <p className="wa-bk-empty">{t('No saved lists yet. Read some numbers, then save them under a name.')}</p>
              : (
                <ul className="wa-bk-rows">
                  {saved.map((a) => (
                    <li key={a.id} className="wa-bk-rowline">
                      <span className="wa-bk-rowwhat">
                        <b dir="auto">{a.name}</b>
                        <small>
                          <Fill text={t('{n} people · {date}')} parts={{ n: num(a.recipients.length), date: dateText(a.updated) }} />
                        </small>
                      </span>
                      <button type="button" className="wa-bk-btn is-small"
                              onClick={() => { lastRead = null; onPeople(peopleFromAudience(a, suppressed)); }}>
                        {t('Use')}
                      </button>
                      <button type="button" className={deleting === a.id ? 'wa-bk-icon is-danger' : 'wa-bk-icon'}
                              title={deleting === a.id ? t('Press again to delete') : t('Delete this list')}
                              aria-label={deleting === a.id ? t('Press again to delete') : t('Delete this list')}
                              onClick={() => {
                                if (deleting !== a.id) { setDeleting(a.id); return; }
                                setDeleting('');
                                void deleteAudience(a.id).then(() => setSaved(null));
                              }}>
                        <Icon name="close" size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )
        )}
      </div>

      {why && <p className="wa-why" role="alert">{why}</p>}

      {people && (
        <div className="wa-bk-sum" aria-live="polite">
          <p className="wa-bk-sum-big">
            <Fill text={people.recipients.length === 1 ? t('{n} person') : t('{n} people')}
                  parts={{ n: <b>{num(people.recipients.length)}</b> }} />
            {people.audienceName && <span className="wa-bk-tag" dir="auto">{people.audienceName}</span>}
          </p>
          {(notRead > 0 || people.duplicates > 0 || people.removed > 0) && (
            <p className="wa-bk-sum-more">
              {notRead > 0 && <span>{fill(t('{n} couldn’t be read'), { n: num(notRead) })}</span>}
              {people.duplicates > 0 && <span>{fill(t('{n} repeated'), { n: num(people.duplicates) })}</span>}
              {people.removed > 0 && <span>{fill(t('{n} asked not to be messaged'), { n: num(people.removed) })}</span>}
            </p>
          )}
          {atCeiling(people) ? (
            <p className="wa-bk-warn">{fill(t('Only the first {n} were taken: that is the most one broadcast can hold.'), { n: num(LIMITS.recipients) })}</p>
          ) : people.truncated && (
            <p className="wa-bk-warn">{t('Only the first part of that file was read: it is longer than a list can be.')}</p>
          )}

          {people.rejected.length > 0 && (
            <details className="wa-bk-details">
              <summary>{t('Lines that couldn’t be read')}</summary>
              <ul className="wa-bk-rejects">
                {people.rejected.slice(0, 50).map((r) => (
                  <li key={`${r.line}-${r.raw}`}>
                    <span className="wa-bk-mono">{fill(t('Line {n}'), { n: r.line })}</span>
                    <bdi className="wa-bk-raw">{r.raw || '—'}</bdi>
                    <span className="wa-bk-quiet">{whyText(r.why, t, r.hint)}</span>
                  </li>
                ))}
                {notRead > 50 && (
                  <li className="wa-bk-quiet">{fill(t('And {n} more.'), { n: num(notRead - 50) })}</li>
                )}
              </ul>
            </details>
          )}

          {sample.length > 0 && (
            <div className="wa-bk-table" role="table" aria-label={t('The first people on the list')}>
              <div className="wa-bk-tr wa-bk-th" role="row">
                <span role="columnheader">{t('Phone')}</span>
                <span role="columnheader">{t('Name')}</span>
                {shownCols.map((c) => <span role="columnheader" key={c} dir="auto">{c}</span>)}
              </div>
              {sample.map((r) => (
                <div className="wa-bk-tr" role="row" key={r.phone}>
                  <span role="cell"><Masked phone={r.phone} /></span>
                  <span role="cell" dir="auto">{r.name || '—'}</span>
                  {shownCols.map((c) => <span role="cell" key={c} dir="auto">{r.vars[c] || '—'}</span>)}
                </div>
              ))}
            </div>
          )}

          {people.columns.length > 1 && lastRead && (
            <div className="wa-bk-pair">
              <label className="wa-bk-field">
                <span>{t('Phone is in')}</span>
                <select className="wa-bk-select" value={people.phoneColumn ?? ''} disabled={busy}
                        onChange={(e) => remap('phoneColumn', e.target.value)}>
                  {people.phoneColumn === null && <option value="">—</option>}
                  {people.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="wa-bk-field">
                <span>{t('Name is in')}</span>
                <select className="wa-bk-select" value={people.nameColumn ?? ''} disabled={busy}
                        onChange={(e) => remap('nameColumn', e.target.value)}>
                  <option value="">{t('No name column')}</option>
                  {people.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </div>
          )}
        </div>
      )}

      <label className="wa-bk-field">
        <span>{t('Numbers without a country code are from')}</span>
        <select className="wa-bk-select" value={country} disabled={busy} onChange={(e) => pickCountry(e.target.value)}>
          {!COUNTRIES.some((c) => c.code === country) && <option value={country}>{countryName(country, lang)}</option>}
          {COUNTRIES.map((c) => <option key={c.iso} value={c.code}>{countryName(c.code, lang)}</option>)}
        </select>
      </label>

      {people && people.recipients.length > 0 && !people.audienceId && (
        <div className="wa-bk-save">
          <input className="wa-bk-input" dir="auto" value={saveName} maxLength={LIMITS.valueChars}
                 placeholder={t('A name for this list')} aria-label={t('A name for this list')}
                 onChange={(e) => setSaveName(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void keep(); } }} />
          <button type="button" className="wa-bk-btn" onClick={() => void keep()}>
            <Icon name="check" size={13} />
            {t('Save this list')}
          </button>
        </div>
      )}
      {said && <p className="wa-bk-quiet" role="status">{said}</p>}

      <p className="wa-note">
        <Icon name="shield" size={12} />
        {t('Only your own contacts and customers who agreed to hear from you.')}
      </p>
    </section>
  );
}
