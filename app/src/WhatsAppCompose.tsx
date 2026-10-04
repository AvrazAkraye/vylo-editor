import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as pickFile } from '@tauri-apps/plugin-dialog';
import { Icon } from './Icon';
import { fill, type Lang } from './i18n';
import { detailOf } from './errors';
import type { EffortBook } from './effort';
import type { Target } from './generate';
import { sendAs, sendMime } from './whatsappmedia';
import { normalisePhone } from './whatsappaudience';
import { OPT_OUT, missingVars, renderMessage } from './whatsappcampaign';
import { riskHints, writeMessages } from './whatsappwrite';
import {
  LIMITS, MESSAGE_LANGS, type Attachment, type AttachmentKind, type Draft, type Hint, type Recipient, type Template, type Tone,
  type WriteAction,
} from './whatsappbulktypes';
import { Fill, num, type People } from './WhatsAppPeople';
import { Drawer, Holes, PER_PERSON, TemplatesDrawer, holesIn } from './WhatsAppReady';

/**
 * Step 2 of a broadcast: what it says (docs/WA.md, docs/wa/briefs/ui.md).
 *
 * One text area, and around it only what changes what a person receives: the
 * variables of the list as chips that drop in at the caret, the ready messages,
 * Write with AI, an attachment, the opt-out line, and the language the message
 * is in. Under it — or beside it, in a window — the message as three real
 * people from the list will see it, rendered by the engine's own
 * `renderMessage`, so the preview is not a guess at what will be sent: it is
 * what will be sent.
 *
 * ## What is said, and what blocks
 *
 * A placeholder nobody fills (`{offer}` from a template, `{city}` when the list
 * has no city) would go out as nothing, so it blocks the step with one sentence.
 * A column some people lack is a warning ("12 people have no city — their
 * message will leave it out"): the engine collapses the gap and the message is
 * still right for the rest. The spam hints (`riskHints`) are gentle one-liners
 * and never block; the person may know better.
 *
 * ## The model sees the brief and nothing else
 *
 * Write with AI hands `writeMessages` the person's own words about the offer,
 * the business name if they gave one, the language, tone and count. No name,
 * number or column from the list goes with it — the function's request type
 * has no field that could carry one (`whatsappwrite.ts`).
 */

// ── the message, as the screens hold it ──────────────────────────────────

/** The parts of the remembered draft that make the message (WhatsAppBroadcast.tsx keeps them). */
export interface MessageWork {
  text: string;
  /** The language the message is written in; the interface's at first. */
  lang: Lang;
  optOut: boolean;
  /** The opt-out line as edited; empty means the engine's line for `lang`. */
  optOutText: string;
  attachment?: Attachment;
  /** The ready message it started from, when it did. */
  templateId: string;
  business: string;
}

/** The engine's `Draft` for a message. */
export function draftOf(m: MessageWork): Draft {
  return {
    text: m.text, lang: m.lang, attachment: m.attachment, optOut: m.optOut,
    optOutText: m.optOutText.trim() ? m.optOutText.trim() : undefined,
  };
}

/** Insert `token` over the selection, and where the caret goes after it. */
export function insertAt(text: string, start: number, end: number, token: string): { text: string; caret: number } {
  const a = Math.max(0, Math.min(start, text.length));
  const b = Math.max(a, Math.min(end, text.length));
  // A chip dropped against a word would glue `{name}` to it; one space keeps them apart.
  const before = a > 0 && !/\s/.test(text[a - 1]) ? ' ' : '';
  const out = text.slice(0, a) + before + token + text.slice(b);
  return { text: out, caret: a + before.length + token.length };
}

/** The variables a list offers, as chips: the two every list has, then its columns. */
export function chipsFor(columns: readonly string[]): string[] {
  return [...PER_PERSON, ...columns.filter((c) => !PER_PERSON.includes(c))];
}

/**
 * Three people for the preview, chosen to show the message at its most
 * different: the first person, the first with a name (if the first had none),
 * and the first with a column the others lack. Deterministic, so the preview
 * does not jump between renders.
 */
export function samplePeople(list: readonly Recipient[], n = 3): Recipient[] {
  const out: Recipient[] = [];
  const add = (r: Recipient | undefined) => { if (r && out.length < n && !out.includes(r)) out.push(r); };
  add(list[0]);
  add(list.find((r) => !!r.name && r.name !== list[0]?.name));
  add(list.find((r) => Object.keys(r.vars).length > Object.keys(list[0]?.vars ?? {}).length));
  for (const r of list) { if (out.length >= n) break; add(r); }
  return out;
}

/** A spam hint as one gentle sentence. Explicit calls, so the catalogue sees each. */
export function hintText(h: Hint, t: (s: string) => string): string {
  if (h.code === 'caps') return t('Much of it is in capital letters, which reads as shouting.');
  if (h.code === 'exclaims') return t('Many exclamation marks can make it look like spam.');
  if (h.code === 'links') return t('More than one link can make it look like spam.');
  if (h.code === 'short-link') return t('Shortened links are often treated as spam. Use the full address.');
  if (h.code === 'long') return t('Long messages are often left unread. Shorter usually works better.');
  if (h.code === 'money-words') return t('Words like “free money” or “guaranteed” look like spam to people and to WhatsApp.');
  return t('The same sentence appears more than once.');
}

/** A language's name, in the interface's language. */
export function langName(l: Lang, t: (s: string) => string): string {
  if (l === 'ar') return t('Arabic');
  if (l === 'ckb') return t('Kurdish — Sorani');
  if (l === 'kmr') return t('Kurdish — Badini');
  return t('English');
}

/**
 * WhatsApp's own formatting, for the preview: `*bold*`, `_italic_`, `~struck~`.
 *
 * One level, line by line, the way WhatsApp itself draws it; a marker that
 * does not close is left as typed. Pure, so the test reads it without a DOM.
 */
export function waRuns(text: string): { text: string; b?: boolean; i?: boolean; s?: boolean }[] {
  const out: { text: string; b?: boolean; i?: boolean; s?: boolean }[] = [];
  const re = /([*_~])([^*_~\n]+?)\1/g;
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push({ text: m[2], b: m[1] === '*', i: m[1] === '_', s: m[1] === '~' });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

// ── attachments ──────────────────────────────────────────────────────────

export const ATTACH_KINDS: readonly AttachmentKind[] = ['image', 'video', 'document', 'audio', 'contact'];

export function attachKindName(k: AttachmentKind, t: (s: string) => string): string {
  if (k === 'image') return t('Picture');
  if (k === 'video') return t('Video');
  if (k === 'audio') return t('Voice note');
  if (k === 'contact') return t('Contact card');
  return t('Document');
}

const attachIcon = (k: AttachmentKind): string =>
  k === 'image' ? 'image' : k === 'video' ? 'camera' : k === 'audio' ? 'mic' : k === 'contact' ? 'person' : 'file';

/** What the file picker offers for each kind. A document may be anything WhatsApp carries. */
export function extensionsFor(k: AttachmentKind): string[] {
  if (k === 'image') return ['jpg', 'jpeg', 'png', 'webp'];
  if (k === 'video') return ['mp4', 'mov', '3gp'];
  if (k === 'audio') return ['mp3', 'ogg', 'opus', 'm4a', 'aac', 'wav'];
  return ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip'];
}

/**
 * A read file as an attachment of the kind asked for, or why it cannot be one.
 *
 * The size is checked again here although `read_any_file` refuses over 16 MB:
 * the limit is the campaign's (`LIMITS.attachmentBytes`) and may be lowered
 * without the Rust command knowing. A picture that `sendAs` would send as a
 * document is refused as a picture rather than sent as something else.
 */
export function attachmentFrom(
  file: { name: string; data: string; bytes: number }, kind: AttachmentKind,
): Attachment | { why: 'too-big' | 'unreadable' | 'wrong-kind' } {
  if (!file.data || !Number.isFinite(file.bytes) || file.bytes <= 0) return { why: 'unreadable' };
  if (file.bytes > LIMITS.attachmentBytes) return { why: 'too-big' };
  const mime = sendMime(file.name);
  if (kind !== 'document' && kind !== 'contact' && sendAs(file.name, mime) !== kind) return { why: 'wrong-kind' };
  return { kind, name: file.name.slice(0, 200), mime, bytes: file.bytes, data: file.data };
}

function sizeText(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ── the preview ──────────────────────────────────────────────────────────

/** One message as WhatsApp draws it: the only place WhatsApp's green appears. */
export function Bubble({ text, attachment, t }: { text: string; attachment?: Attachment; t: (s: string) => string }) {
  return (
    <div className="wa-bk-bubble">
      {attachment && (
        attachment.kind === 'image' && attachment.data
          ? <img className="wa-bk-bubble-img" src={`data:${attachment.mime};base64,${attachment.data}`} alt={attachment.name} />
          : (
            <span className="wa-bk-bubble-file">
              <Icon name={attachIcon(attachment.kind)} size={16} />
              <span dir="auto">{attachment.kind === 'contact' ? attachment.contact?.fullName || attachment.name : attachment.name}</span>
              {attachment.kind !== 'contact' && <small dir="ltr">{sizeText(attachment.bytes)}</small>}
            </span>
          )
      )}
      {text && (
        <span className="wa-bk-bubble-text" dir="auto">
          {waRuns(text).map((r, i) => (
            r.b ? <b key={i}>{r.text}</b> : r.i ? <i key={i}>{r.text}</i> : r.s ? <s key={i}>{r.text}</s> : <span key={i}>{r.text}</span>
          ))}
        </span>
      )}
      <span className="wa-bk-bubble-meta" aria-hidden="true">
        12:00
        <Icon name="check" size={11} />
      </span>
      <span className="wa-bk-sr">{t('Preview')}</span>
    </div>
  );
}

/**
 * The message for three people from the list, as they will receive it.
 *
 * Rendered by the engine (`renderMessage`, default seed — the runner must use
 * the same, see docs/wa/ui.md). Before there is a list, the text itself with
 * its variables marked, and a sentence saying where the real preview comes from.
 */
export function PreviewPane({ t, msg, people }: { t: (s: string) => string; msg: MessageWork; people: People | null }) {
  const draft = draftOf(msg);
  const sample = people ? samplePeople(people.recipients) : [];
  const empty = !msg.text.trim() && !msg.attachment;
  return (
    <section className="wa-bk-preview" aria-label={t('How it will look')}>
      <h4 className="wa-bk-sub">{t('How it will look')}</h4>
      <div className="wa-bk-wall">
        {empty ? (
          <p className="wa-bk-wall-note">{t('Write a message to see it here.')}</p>
        ) : sample.length === 0 ? (
          <>
            <div className="wa-bk-bubble">
              <span className="wa-bk-bubble-text" dir="auto"><Holes text={msg.text} columns={[]} /></span>
            </div>
            <p className="wa-bk-wall-note">{t('Add people in step 1 to see their own messages here.')}</p>
          </>
        ) : sample.map((r) => (
          <figure key={r.phone} className="wa-bk-fig">
            <figcaption dir="auto">{r.name || t('No name')}</figcaption>
            <Bubble text={renderMessage(draft, r)} attachment={msg.attachment} t={t} />
          </figure>
        ))}
      </div>
    </section>
  );
}

// ── Write with AI ────────────────────────────────────────────────────────

const TONES: readonly Tone[] = ['friendly', 'professional', 'festive', 'urgent', 'short'];

function toneName(x: Tone, t: (s: string) => string): string {
  if (x === 'friendly') return t('Friendly');
  if (x === 'professional') return t('Professional');
  if (x === 'festive') return t('Festive');
  if (x === 'urgent') return t('Urgent');
  return t('Short and plain');
}

/** What went wrong with a writing request, in a sentence. An abort is not a failure and says nothing. */
export function writeFailure(e: unknown, t: (s: string) => string): string {
  if (e instanceof Error && e.name === 'AbortError') return '';
  if (e instanceof Error && e.message === 'whatsapp:unreadable-writing') return t('The answer could not be read as messages. Try again.');
  return fill(t('The message could not be written: {why}'), { why: detailOf(e) });
}

interface WriterProps {
  t: (s: string) => string;
  msgLang: Lang;
  base: string;
  business: string;
  gw?: Target;
  efforts?: EffortBook;
  onProviders: () => void;
  onUse: (text: string) => void;
  onClose: () => void;
  full: boolean;
}

function WriterDrawer({ t, msgLang, base, business, gw, efforts, onProviders, onUse, onClose, full }: WriterProps) {
  const [brief, setBrief] = useState('');
  const [tone, setTone] = useState<Tone>('friendly');
  const [count, setCount] = useState(3);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [said, setSaid] = useState('');
  const [bad, setBad] = useState('');
  const [into, setInto] = useState<Lang>(msgLang === 'en' ? 'ar' : 'en');
  const stop = useRef<AbortController | null>(null);
  const ids = useId();
  useEffect(() => () => stop.current?.abort(), []);

  async function ask(action: WriteAction, from: string, toLang: Lang = msgLang) {
    if (!gw || !efforts) return;
    stop.current?.abort();
    const ctl = new AbortController();
    stop.current = ctl;
    setBusy(true);
    setBad('');
    setSaid('');
    try {
      const got = await writeMessages(gw, efforts, {
        action, brief: brief.trim(), lang: toLang, tone, base: from || undefined, business: business.trim() || undefined,
        count: action === 'write' || action === 'variants' ? count : 1,
      }, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      setResults(got.messages);
      setSaid(got.said);
      if (!got.messages.length && !got.said) setBad(t('The answer could not be read as messages. Try again.'));
    } catch (e) {
      setBad(writeFailure(e, t));
    } finally {
      if (stop.current === ctl) { stop.current = null; setBusy(false); }
    }
  }

  if (!gw || !efforts) {
    return (
      <Drawer title={t('Write with AI')} onClose={onClose} closeLabel={t('Close')} wide={full}>
        <p className="wa-bk-empty">{t('Writing needs a model. Add a model in Settings, then come back.')}</p>
        <button type="button" className="sb-cta-go wa-bk-go" onClick={onProviders}>
          <Icon name="settings" size={13} />
          {t('Add a model in Settings')}
        </button>
      </Drawer>
    );
  }

  return (
    <Drawer title={t('Write with AI')} onClose={onClose} closeLabel={t('Close')} wide={full}>
      <label className="wa-bk-field">
        <span>{t('What do you want to tell people?')}</span>
        <textarea className="wa-bk-area" dir="auto" rows={3} value={brief} maxLength={1200}
                  placeholder={t('For example: 20% off all shoes this weekend at our Erbil shop')}
                  onChange={(e) => setBrief(e.target.value)} />
      </label>
      <div className="wa-bk-pair">
        <label className="wa-bk-field">
          <span>{t('Tone')}</span>
          <select className="wa-bk-select" value={tone} onChange={(e) => setTone(TONES.find((x) => x === e.target.value) ?? 'friendly')}>
            {TONES.map((x) => <option key={x} value={x}>{toneName(x, t)}</option>)}
          </select>
        </label>
        <div className="wa-bk-field">
          <span id={`${ids}-n`}>{t('How many to choose from')}</span>
          <div className="wa-bk-seg" role="group" aria-labelledby={`${ids}-n`}>
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" className={n === count ? 'on' : ''} aria-pressed={n === count} onClick={() => setCount(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="wa-bk-quiet">{fill(t('Written in {lang}. Your list is never sent to the model, only what you type here.'), { lang: langName(msgLang, t) })}</p>
      <div className="wa-bk-acts">
        <button type="button" className="sb-cta-go wa-bk-go" disabled={busy || !brief.trim()} onClick={() => void ask('write', '')}>
          <Icon name={busy ? 'clock' : 'sparkle'} size={13} />
          {busy ? t('Writing…') : t('Write')}
        </button>
        {base.trim() && (
          <button type="button" className="wa-bk-btn" disabled={busy} onClick={() => void ask('improve', base)}>
            {t('Improve my message')}
          </button>
        )}
        {busy && (
          <button type="button" className="wa-bk-btn" onClick={() => { stop.current?.abort(); stop.current = null; setBusy(false); }}>
            {t('Stop')}
          </button>
        )}
      </div>
      {bad && <p className="wa-why" role="alert">{bad}</p>}
      {said && <p className="wa-bk-said" dir="auto">{said}</p>}
      {results.length > 0 && (
        <ul className="wa-bk-cards" aria-label={t('Suggestions')} aria-busy={busy}>
          {results.map((r, i) => (
            <li key={`${i}-${r.slice(0, 12)}`} className="wa-bk-tpl">
              <span className="wa-bk-tpl-text" dir="auto">{r}</span>
              <span className="wa-bk-acts">
                <button type="button" className="wa-bk-btn is-small" onClick={() => onUse(r)}>{t('Use this')}</button>
                <button type="button" className="wa-bk-btn is-small is-quiet" disabled={busy} onClick={() => void ask('improve', r)}>{t('Improve')}</button>
                <button type="button" className="wa-bk-btn is-small is-quiet" disabled={busy} onClick={() => void ask('shorten', r)}>{t('Shorten')}</button>
              </span>
              <span className="wa-bk-acts">
                <select className="wa-bk-select is-small" value={into} aria-label={t('Translate into')}
                        onChange={(e) => setInto(MESSAGE_LANGS.find((l) => l === e.target.value) ?? 'en')}>
                  {MESSAGE_LANGS.map((l) => <option key={l} value={l}>{langName(l, t)}</option>)}
                </select>
                <button type="button" className="wa-bk-btn is-small is-quiet" disabled={busy} onClick={() => void ask('translate', r, into)}>
                  {t('Translate')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

// ── the attachment form ──────────────────────────────────────────────────

function AttachDrawer({ t, current, country, onAttach, onClose, full }: {
  t: (s: string) => string; current?: Attachment; country: string; onAttach: (a: Attachment | undefined) => void; onClose: () => void; full: boolean;
}) {
  const [kind, setKind] = useState<AttachmentKind>(current?.kind ?? 'image');
  const [bad, setBad] = useState('');
  const [card, setCard] = useState({
    fullName: current?.contact?.fullName ?? '', phone: current?.contact?.phone ?? '', organization: current?.contact?.organization ?? '',
  });
  const ids = useId();

  async function choose() {
    setBad('');
    try {
      const picked = await pickFile({ multiple: false, directory: false, filters: [{ name: attachKindName(kind, t), extensions: extensionsFor(kind) }] });
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (!path) return;
      const r = await invoke<{ name: string; data: string; bytes: number }>('read_any_file', { path });
      const a = attachmentFrom(r, kind);
      if ('why' in a) {
        setBad(a.why === 'too-big' ? fill(t('That file is larger than {n} MB, the most WhatsApp takes.'), { n: LIMITS.attachmentBytes / 1024 / 1024 })
          : a.why === 'wrong-kind' ? fill(t('That file is not a {kind}. Choose another, or attach it as a document.'), { kind: attachKindName(kind, t) })
            : t('That file could not be read.'));
        return;
      }
      onAttach(a);
      onClose();
    } catch (e) {
      // Rust says what was wrong with the file (over 16 MB, unreadable), in its own words.
      setBad(fill(t('That file could not be opened: {why}'), { why: detailOf(e) }));
    }
  }

  function keepCard() {
    const n = normalisePhone(card.phone, country);
    if (!card.fullName.trim()) { setBad(t('Write the name on the card.')); return; }
    if (!('phone' in n)) { setBad(t('That phone number could not be read.')); return; }
    const contact = { fullName: card.fullName.trim().slice(0, LIMITS.valueChars), phone: n.phone, organization: card.organization.trim().slice(0, LIMITS.valueChars) || undefined };
    onAttach({ kind: 'contact', name: contact.fullName, mime: 'text/vcard', bytes: 0, data: '', contact });
    onClose();
  }

  return (
    <Drawer title={t('Attach')} onClose={onClose} closeLabel={t('Close')} wide={full}>
      <div className="wa-bk-kinds" role="radiogroup" aria-labelledby={`${ids}-k`}>
        <span id={`${ids}-k`} className="wa-bk-sr">{t('What to attach')}</span>
        {ATTACH_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={k === kind} className={k === kind ? 'wa-bk-chip on' : 'wa-bk-chip'}
                  onClick={() => { setKind(k); setBad(''); }}>
            <Icon name={attachIcon(k)} size={13} />
            {attachKindName(k, t)}
          </button>
        ))}
      </div>
      {kind === 'contact' ? (
        <>
          <label className="wa-bk-field"><span>{t('Name on the card')}</span>
            <input className="wa-bk-input" dir="auto" value={card.fullName} onChange={(e) => setCard({ ...card, fullName: e.target.value })} /></label>
          <label className="wa-bk-field"><span>{t('Phone')}</span>
            <input className="wa-bk-input" dir="ltr" inputMode="tel" value={card.phone} onChange={(e) => setCard({ ...card, phone: e.target.value })} /></label>
          <label className="wa-bk-field"><span>{t('Company (if any)')}</span>
            <input className="wa-bk-input" dir="auto" value={card.organization} onChange={(e) => setCard({ ...card, organization: e.target.value })} /></label>
          <button type="button" className="sb-cta-go wa-bk-go" onClick={keepCard}>
            <Icon name="check" size={13} />
            {t('Attach this card')}
          </button>
        </>
      ) : (
        <>
          <p className="wa-bk-quiet">{fill(t('Up to {n} MB. The message becomes its caption.'), { n: LIMITS.attachmentBytes / 1024 / 1024 })}</p>
          <button type="button" className="sb-cta-go wa-bk-go" onClick={() => void choose()}>
            <Icon name="folder" size={13} />
            {t('Choose a file…')}
          </button>
        </>
      )}
      {bad && <p className="wa-why" role="alert">{bad}</p>}
      {current && (
        <button type="button" className="wa-bk-btn is-quiet" onClick={() => { onAttach(undefined); onClose(); }}>
          <Icon name="close" size={12} />
          {fill(t('Remove {name}'), { name: current.name })}
        </button>
      )}
    </Drawer>
  );
}

// ── the step ─────────────────────────────────────────────────────────────

export interface ComposeProps {
  t: (s: string) => string;
  lang: Lang;
  msg: MessageWork;
  onMsg: (patch: Partial<MessageWork>) => void;
  people: People | null;
  country: string;
  full: boolean;
  gw?: Target;
  efforts?: EffortBook;
  onProviders: () => void;
}

type Tool = '' | 'templates' | 'writer' | 'attach';

/** The sentences about a message that are worth saying, and whether any blocks the step. */
export function messageNotes(msg: MessageWork, people: People | null, t: (s: string) => string): { block: string[]; warn: string[]; tips: string[] } {
  const columns = people?.columns ?? [];
  const block: string[] = [];
  for (const v of holesIn(msg.text, columns)) {
    block.push(fill(t('{var} is not filled in, and the list has no column by that name. Fill it in or remove it.'), { var: `{${v}}` }));
  }
  const warn: string[] = [];
  if (people && people.recipients.length) {
    for (const m of missingVars(draftOf(msg), people.recipients)) {
      if (m.missing <= 0 || (!columns.includes(m.name) && !PER_PERSON.includes(m.name))) continue;
      warn.push(m.missing === 1
        ? fill(t('1 person has no {var}: their message will leave it out.'), { var: m.name })
        : fill(t('{n} people have no {var}: their message will leave it out.'), { n: num(m.missing), var: m.name }));
    }
  }
  const tips = riskHints(msg.text).map((h) => hintText(h, t));
  return { block, warn, tips };
}

export function ComposeStep({ t, lang, msg, onMsg, people, country, full, gw, efforts, onProviders }: ComposeProps) {
  const [tool, setTool] = useState<Tool>('');
  const area = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  const ids = useId();
  const columns = people?.columns ?? [];
  const chips = chipsFor(columns);
  const notes = useMemo(() => messageNotes(msg, people, t), [msg, people, t]);

  // The caret goes after an inserted chip, once React has put the new text in.
  useEffect(() => {
    if (caret.current === null || !area.current) return;
    area.current.focus();
    area.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [msg.text]);

  function put(token: string) {
    const el = area.current;
    const at = insertAt(msg.text, el?.selectionStart ?? msg.text.length, el?.selectionEnd ?? msg.text.length, token);
    caret.current = at.caret;
    onMsg({ text: at.text.slice(0, LIMITS.messageChars) });
  }

  const longest = useMemo(() => {
    const d = draftOf(msg);
    const list = people ? samplePeople(people.recipients) : [];
    const lens = list.map((r) => renderMessage(d, r).length);
    return Math.max(msg.text.length, ...lens);
  }, [msg, people]);

  const optLine = msg.optOutText || OPT_OUT[msg.lang];

  return (
    <section className="wa-bk-step" aria-labelledby={`${ids}-h`}>
      <h3 className="wa-bk-h" id={`${ids}-h`}>{t('What should it say?')}</h3>

      <div className="wa-bk-tools">
        <button type="button" className="wa-bk-btn" onClick={() => setTool('templates')}>
          <Icon name="list" size={13} />
          {t('Ready messages')}
        </button>
        <button type="button" className="wa-bk-btn" onClick={() => setTool('writer')}>
          <Icon name="sparkle" size={13} />
          {t('Write with AI')}
        </button>
      </div>

      <label className="wa-bk-field">
        <span>{t('Message')}</span>
        <textarea ref={area} className="wa-bk-area wa-bk-msg" dir="auto" rows={full ? 9 : 7} value={msg.text}
                  maxLength={LIMITS.messageChars} placeholder={t('Hello {name}, …')}
                  onChange={(e) => onMsg({ text: e.target.value, templateId: e.target.value ? msg.templateId : '' })} />
      </label>

      <div className="wa-bk-chips" role="group" aria-label={t('Insert a detail from the list')}>
        {chips.map((c) => (
          <button key={c} type="button" className="wa-bk-chip is-var" onClick={() => put(`{${c}}`)}
                  aria-label={fill(t('Insert {var}'), { var: c })}>
            <bdi dir="ltr">{`{${c}}`}</bdi>
          </button>
        ))}
      </div>

      <p className={longest > LIMITS.messageChars ? 'wa-bk-count is-over' : 'wa-bk-count'}>
        {fill(t('{n} of {max} characters'), { n: num(longest), max: num(LIMITS.messageChars) })}
      </p>

      <div className="wa-bk-row">
        <button type="button" className="wa-bk-btn" onClick={() => setTool('attach')}>
          <Icon name="attach" size={13} />
          {msg.attachment ? t('Change the attachment') : t('Attach')}
        </button>
        {msg.attachment && (
          <span className="wa-bk-file">
            <Icon name={attachIcon(msg.attachment.kind)} size={12} />
            <bdi>{msg.attachment.name}</bdi>
            <button type="button" className="wa-bk-icon" onClick={() => onMsg({ attachment: undefined })}
                    title={t('Remove the attachment')} aria-label={t('Remove the attachment')}>
              <Icon name="close" size={11} />
            </button>
          </span>
        )}
      </div>

      <label className="wa-bk-field">
        <span>{t('Message language')}</span>
        <select className="wa-bk-select" value={msg.lang}
                onChange={(e) => onMsg({ lang: MESSAGE_LANGS.find((l) => l === e.target.value) ?? msg.lang, optOutText: '' })}>
          {MESSAGE_LANGS.map((l) => <option key={l} value={l}>{langName(l, t)}</option>)}
        </select>
      </label>

      <div className="wa-bk-optout">
        <label className="wa-bk-check">
          <input type="checkbox" checked={msg.optOut} onChange={(e) => onMsg({ optOut: e.target.checked })} />
          <span>{t('Add a line that lets people stop these messages')}</span>
        </label>
        {msg.optOut && (
          <>
            <input className="wa-bk-input" dir="auto" value={optLine} maxLength={200} aria-label={t('The opt-out line')}
                   onChange={(e) => onMsg({ optOutText: e.target.value })} />
            {msg.optOutText && msg.optOutText !== OPT_OUT[msg.lang] && (
              <button type="button" className="wa-bk-link" onClick={() => onMsg({ optOutText: '' })}>{t('Use the usual line')}</button>
            )}
          </>
        )}
        {!msg.optOut && <p className="wa-bk-quiet">{t('A promotion without a way to stop is the message people report.')}</p>}
      </div>

      {(notes.block.length > 0 || notes.warn.length > 0 || notes.tips.length > 0) && (
        <ul className="wa-bk-notes" aria-live="polite">
          {notes.block.map((s) => <li key={s} className="is-block"><Icon name="warning" size={12} /><span>{s}</span></li>)}
          {notes.warn.map((s) => <li key={s} className="is-warn"><Icon name="warning" size={12} /><span>{s}</span></li>)}
          {notes.tips.map((s) => <li key={s} className="is-tip"><Icon name="bolt" size={12} /><span>{s}</span></li>)}
        </ul>
      )}

      {!full && <PreviewPane t={t} msg={msg} people={people} />}

      {tool === 'templates' && (
        <TemplatesDrawer t={t} lang={lang} msgLang={msg.lang} full={full} business={msg.business}
                         onBusiness={(business) => onMsg({ business })} columns={columns} replacing={!!msg.text.trim()}
                         onUse={(text, tpl: Template) => {
                           onMsg({ text, templateId: tpl.id, optOut: tpl.kind === 'promo' ? true : msg.optOut });
                           setTool('');
                         }}
                         onClose={() => setTool('')} />
      )}
      {tool === 'writer' && (
        <WriterDrawer t={t} msgLang={msg.lang} base={msg.text} business={msg.business} gw={gw} efforts={efforts}
                      onProviders={onProviders} full={full}
                      onUse={(text) => { onMsg({ text: text.slice(0, LIMITS.messageChars), templateId: '' }); setTool(''); }}
                      onClose={() => setTool('')} />
      )}
      {tool === 'attach' && (
        <AttachDrawer t={t} current={msg.attachment} country={country} full={full}
                      onAttach={(attachment) => onMsg({ attachment })} onClose={() => setTool('')} />
      )}
    </section>
  );
}

/** For the review: the message's attachment, named, or nothing. */
export function AttachmentLine({ a, t }: { a?: Attachment; t: (s: string) => string }): ReactNode {
  if (!a) return null;
  return (
    <span className="wa-bk-file">
      <Icon name={attachIcon(a.kind)} size={12} />
      <Fill text={t('{kind}: {name}')} parts={{ kind: attachKindName(a.kind, t), name: <bdi>{a.name}</bdi> }} />
    </span>
  );
}
