import {
  CAP_WARN, DEFAULT_PACE, LIMITS, MESSAGE_LANGS, PACE_BOUNDS,
  type Attachment, type Campaign, type Draft, type Lang, type Outcome, type Pace, type Problem, type Recipient,
} from './whatsappbulktypes';
import { phoneOf, type Msg } from './whatsapp';

/**
 * Campaign arithmetic: what each person is sent, whether a campaign may start, how long it takes, who asked to stop,
 * and the report. Pure — no clock, no storage, no network — so every rule here is held by `test/wa-engine.test.mjs`
 * and the runner (`whatsappsend.ts`) and the screens read the same answers.
 *
 * ## Why rendering is strict about what it prints
 *
 * A broadcast is read by hundreds of people at once, and the failure that embarrasses the owner is not a crash but a
 * message that says "Hi {name}," or "Hi , welcome" to a customer. So a variable is only a variable when it is written
 * like one; anything else in braces is left as the person typed it; a variable with no value prints nothing and the
 * spaces it leaves are closed up; and `missingVars` tells the screen beforehand who will get the shorter sentence.
 *
 * ## Why the wording choice is a hash and not a random number
 *
 * `[[Hello|Hi|Good morning]]` gives different people different wording — identical text sent hundreds of times is one
 * of the things WhatsApp looks for — but the choice is a function of the campaign's seed and the person's number. The
 * preview on the Review step is therefore exactly what that person is sent, the runner can render again after a
 * restart and send the same words, and a test can pin it.
 */

// ── the opt-out line ──────────────────────────────────────────────────────

/** The opt-out line, per language. */
export const OPT_OUT: Readonly<Record<Lang, string>> = {
  en: 'Reply STOP to stop receiving messages.',
  ar: 'للتوقف عن استلام الرسائل أرسل STOP.',
  ckb: 'بۆ وەستاندنی نامەکان STOP بنێرە.',
  kmr: 'بۆ ڕاوەستاندنا نامەیان STOP بھنێرە.',
};

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

const langOf = (l: unknown): Lang => (typeof l === 'string' && (MESSAGE_LANGS as readonly string[]).includes(l) ? (l as Lang) : 'en');

// ── numbers and plain text ────────────────────────────────────────────────

/**
 * A number as it goes on the wire — digits only, 6 to 15 of them (E.164's ceiling) — or '' when it cannot be one.
 *
 * Deliberately narrower than the audience parser's `normalisePhone`: this one is not trying to understand what a
 * person typed, only to refuse what the gateway must never be handed. Every place that keys a person by number (the
 * runner's outcomes, the do-not-contact list, the report) goes through it, so "the same person" means the same thing
 * everywhere.
 */
export function wirePhone(raw: unknown): string {
  const d = typeof raw === 'string' || (typeof raw === 'number' && Number.isSafeInteger(raw)) ? String(raw).replace(/\D/g, '') : '';
  return d.length >= 6 && d.length <= 15 ? d : '';
}

/** Cut to `max` UTF-16 units without leaving half a surrogate pair behind. */
function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  let t = s.slice(0, Math.max(0, max));
  const last = t.charCodeAt(t.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) t = t.slice(0, -1);
  return t;
}

/**
 * Characters a value from a file may not carry into a message: controls, and the marks that reorder the text around
 * them. A name is data, not formatting — a right-to-left override in a contact's name would reverse the rest of the
 * line it is pasted into, which is the classic way to make a message say something its author did not write. Zero-width
 * joiners stay: Kurdish, Persian and emoji need them.
 */
const VALUE_JUNK = /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const VALUE_BREAKS = /[\t\n\r\u000B\u000C\u0085\u2028\u2029]/g;

/** A value from a file or a stored record, as plain one-line text, at most `max` characters. */
export function plainValue(v: unknown, max: number = LIMITS.valueChars): string {
  if (typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v))) return '';
  return cut(String(v).replace(VALUE_BREAKS, ' ').replace(VALUE_JUNK, '').replace(/\s+/g, ' ').trim(), max).trim();
}

/**
 * The person's own message text: line endings made one kind, and the controls no message should carry taken out.
 * Tabs and line breaks stay — they are the person's layout. Bidi marks stay too: in the message (unlike in a name) they
 * are the author's own formatting. NUL goes, which is what lets the renderer use it as a private marker.
 */
const TEXT_JUNK = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const plainText = (s: unknown): string => (typeof s === 'string' ? s.replace(/\r\n?/g, '\n').replace(TEXT_JUNK, '') : '');

// ── the template language ─────────────────────────────────────────────────

/*
 * `{name}`            the person's name
 * `{first_name}`      its first word
 * `{city}`            a column of the file (matched without regard to case, spaces, dots or dashes: `{City Name}` is `city_name`)
 * `{city|our shop}`   the words after the bar when the person has no value; `{city|}` is "nothing, and that is fine"
 * `[[Hi|Hello|Hey]]`  one of the alternatives, chosen per person; alternatives may hold variables and further choices
 * `\{` `\}` `\[[` `\]]` `\|`   the character itself
 *
 * A brace that does not make a variable — `{ }`, `{"a": 1}`, a lone `{` — is text, printed as typed. A `[[` with no
 * `]]` after it is text too. Nothing a value contains is read as syntax: values are put in after parsing.
 */

type Tok =
  | { t: 'lit'; s: string }
  | { t: 'var'; name: string; key: string; fallback: string | null }
  | { t: 'spin'; alts: Tok[][] };

/** A variable's name: letters of any script, digits, and the separators a column header uses. */
const VAR_NAME = /^[\p{L}\p{M}\p{N}_ .-]{1,40}$/u;
const HAS_WORD = /[\p{L}\p{N}]/u;
/** How deep `[[…[[…]]…]]` may nest before a `[[` is read as text: deeper is a typing accident, not a design. */
const MAX_DEPTH = 4;

/** The key a variable is looked up by: `City Name`, `city-name` and `city_name` are one column. */
const keyOf = (name: string): string => name.trim().toLowerCase().replace(/[\s.-]+/g, '_');

function parse(src: string): Tok[] {
  // Where the last `]]` is. A `[[` after it can never close, so it is text at once — without this a message with
  // hundreds of stray `[[` would be scanned to its end once per `[[`.
  const lastClose = src.lastIndexOf(']]');
  let i = 0;

  const readVar = (): Tok | null => {
    const close = src.indexOf('}', i + 1);
    if (close < 0 || close - i > 200) return null;
    const inner = src.slice(i + 1, close);
    if (inner.includes('{') || inner.includes('\n')) return null;
    const bar = inner.indexOf('|');
    const name = (bar < 0 ? inner : inner.slice(0, bar)).trim();
    if (!VAR_NAME.test(name) || !HAS_WORD.test(name)) return null;
    i = close + 1;
    return { t: 'var', name, key: keyOf(name), fallback: bar < 0 ? null : inner.slice(bar + 1).trim() };
  };

  const seq = (depth: number): Tok[] => {
    const out: Tok[] = [];
    let lit = '';
    const flush = () => { if (lit) { out.push({ t: 'lit', s: lit }); lit = ''; } };
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\\') {
        const two = src.slice(i + 1, i + 3);
        if (two === '[[' || two === ']]') { lit += two; i += 3; continue; }
        const one = src[i + 1];
        if (one === '{' || one === '}' || one === '|') { lit += one; i += 2; continue; }
        lit += ch; i++; continue;
      }
      if (depth > 0 && (ch === '|' || (ch === ']' && src[i + 1] === ']'))) break;
      if (ch === '{') {
        const v = readVar();
        if (v) { flush(); out.push(v); } else { lit += ch; i++; }
        continue;
      }
      if (ch === '[' && src[i + 1] === '[' && i < lastClose && depth < MAX_DEPTH) {
        const from = i;
        i += 2;
        const alts: Tok[][] = [];
        let closed = false;
        for (;;) {
          alts.push(seq(depth + 1));
          if (i >= src.length) break;
          if (src[i] === '|') { i++; continue; }
          i += 2; // `]]`
          closed = true;
          break;
        }
        if (closed) { flush(); out.push({ t: 'spin', alts }); continue; }
        i = from + 2;
        lit += '[[';
        continue;
      }
      lit += ch; i++;
    }
    flush();
    return out;
  };

  const out: Tok[] = [];
  // A `|` or `]]` at the top level is text; `seq(0)` never stops on one, so a single call reads everything.
  while (i < src.length) out.push(...seq(0));
  return out;
}

/**
 * The parse of the last text seen. A campaign renders one text for thousands of people, and parsing it once rather
 * than once per person is most of the difference between a Review step that keeps up with typing and one that does not.
 */
let memoText: string | null = null;
let memoToks: Tok[] = [];
function tokens(text: string): Tok[] {
  if (text !== memoText) { memoToks = parse(text); memoText = text; }
  return memoToks;
}

/** The variables a text asks for, by name, in order of first use (a column asked for twice is listed once). */
export function variablesIn(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const walk = (list: readonly Tok[]) => {
    for (const tok of list) {
      if (tok.t === 'var') { if (!seen.has(tok.key)) { seen.add(tok.key); out.push(tok.name); } }
      else if (tok.t === 'spin') for (const alt of tok.alts) walk(alt);
    }
  };
  walk(tokens(plainText(text)));
  return out;
}

// ── which way the text runs ───────────────────────────────────────────────

/*
 * A name in another script is wrapped in Unicode's directional isolates (FSI … PDI) — decided here, as the brief asked.
 *
 * The bug it prevents: an Arabic name in an English message, followed by a number — "Hi علي, your code is 4521" — is
 * laid out by the bidi algorithm as one right-to-left run that swallows the punctuation and the digits, and the reader
 * sees the code in the wrong place. Isolating the inserted name makes it a sealed box that cannot reorder its
 * neighbours. It is done only when the scripts differ (an Arabic name in an Arabic message needs nothing), so most
 * messages carry no extra characters. FSI and PDI are default-ignorable: a phone too old to apply them draws nothing
 * for them rather than a box. Each costs one character of `LIMITS.messageChars`, which the length check counts.
 */
const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const FIRST_LETTER = /\p{L}/u;

function direction(s: string): 'ltr' | 'rtl' | null {
  const m = FIRST_LETTER.exec(s);
  if (!m) return null;
  return RTL_CHAR.test(m[0]) ? 'rtl' : 'ltr';
}

function baseDirection(toks: readonly Tok[], lang: Lang): 'ltr' | 'rtl' {
  let found: 'ltr' | 'rtl' | null = null;
  const walk = (list: readonly Tok[]) => {
    for (const tok of list) {
      if (found) return;
      if (tok.t === 'lit') found = direction(tok.s);
      else if (tok.t === 'spin') for (const alt of tok.alts) walk(alt);
    }
  };
  walk(toks);
  return found ?? (lang === 'en' ? 'ltr' : 'rtl');
}

const isolate = (v: string, dir: 'ltr' | 'rtl'): string => {
  const d = direction(v);
  return d && d !== dir ? `\u2068${v}\u2069` : v;
};

// ── rendering ─────────────────────────────────────────────────────────────

/** Where a variable or a choice printed nothing. A NUL cannot be in the text (`plainText` takes it out). */
const GAP = '\u0000';

/** Punctuation a gap is closed up against: "Hi {name}, welcome" with no name is "Hi, welcome". */
const CLOSE_UP = /[ \t]*\u0000[ \t]*(?=[,.!?;:\u060C\u061B\u061F\u2026)\]\u00BB\u201D])/g;

/**
 * Close up what empty variables left: the doubled space, the space before a comma, the line that is now only space.
 * Only around the gaps — the person's own double spaces and blank lines are theirs to keep.
 */
function tidy(s: string): string {
  if (!s.includes(GAP)) return s.trim();
  const out: string[] = [];
  let dropped = false;
  for (const raw of s.split('\n')) {
    if (!raw.includes(GAP)) {
      // A blank line that only follows another because a line between them went is not the author's blank line.
      if (!raw.trim() && dropped && out.length && !out[out.length - 1].trim()) continue;
      out.push(raw);
      if (raw.trim()) dropped = false;
      continue;
    }
    const line = raw
      .replace(/\u0000(?:[ \t]*\u0000)+/g, GAP)
      .replace(/^[ \t]*\u0000[ \t]*[,\u060C]?[ \t]*/, '')
      .replace(CLOSE_UP, '')
      .replace(/[ \t]*\u0000[ \t]*$/, '')
      .replace(/([ \t])[ \t]*\u0000[ \t]*/g, '$1')
      .replace(/\u0000[ \t]*/g, '');
    if (!line.trim()) { dropped = true; continue; }
    out.push(line);
  }
  return out.join('\n').trim();
}

/**
 * FNV-1a with MurmurHash3's finaliser: a stable, well-spread number from a string. The finaliser is not decoration —
 * FNV alone leaves the low bit of two strings that differ in their last character always opposite, so two `[[a|b]]`
 * in one message would always pick opposite sides, and nobody would ever get "a … a".
 */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The person's values by key, built once per render; an own-property map, so `{constructor}` is a column like any other. */
function valuesOf(r: Recipient): Map<string, string> {
  const m = new Map<string, string>();
  const vars = r && typeof r.vars === 'object' && r.vars ? r.vars : {};
  for (const [k, v] of Object.entries(vars)) {
    const key = keyOf(String(k));
    const value = plainValue(v);
    if (key && value && !m.has(key)) m.set(key, value);
  }
  return m;
}

function valueOf(key: string, r: Recipient, vars: Map<string, string>): string {
  if (key === 'name') return plainValue(r.name) || vars.get('name') || '';
  if (key === 'first_name') {
    const col = vars.get('first_name');
    if (col) return col;
    const name = plainValue(r.name) || vars.get('name') || '';
    return name.split(' ')[0] ?? '';
  }
  return vars.get(key) ?? '';
}

/** The opt-out line this draft ends with, or '' when it carries none. */
function footOf(d: Draft): string {
  if (d.optOut !== true) return '';
  const mine = plainText(d.optOutText).trim();
  if (mine) return cut(mine, 300);
  const lang = langOf(d.lang);
  return own(OPT_OUT, lang) ? OPT_OUT[lang] : OPT_OUT.en;
}

interface Rendered {
  /** What is sent, at most `LIMITS.messageChars`. */
  text: string;
  /** How long it would have been uncut: over the limit is a `message-too-long` problem, never a silent cut. */
  full: number;
  /** Variables this person had no value for, where the text gave no fallback. */
  missing: string[];
}

function render(d: Draft, r: Recipient, seed: number): Rendered {
  const toks = tokens(plainText(d.text));
  const dir = baseDirection(toks, langOf(d.lang));
  const vars = valuesOf(r);
  const phone = wirePhone(r?.phone) || String(r?.phone ?? '');
  const missing: string[] = [];
  const missed = new Set<string>();
  let k = 0;
  let out = '';
  const walk = (list: readonly Tok[]) => {
    for (const tok of list) {
      if (tok.t === 'lit') out += tok.s;
      else if (tok.t === 'var') {
        const v = valueOf(tok.key, r, vars);
        if (v) out += isolate(v, dir);
        else if (tok.fallback) out += tok.fallback;
        else {
          out += GAP;
          if (tok.fallback === null && !missed.has(tok.key)) { missed.add(tok.key); missing.push(tok.name); }
        }
      } else {
        const pick = tok.alts[hash(`${seed}|${phone}|${k++}`) % tok.alts.length];
        const before = out.length;
        walk(pick);
        if (out.length === before) out += GAP;
      }
    }
  };
  walk(toks);
  const body = tidy(out);
  let foot = footOf(d);
  // A message that already ends with the line (a template that wrote its own) does not get it twice.
  if (foot && body.endsWith(foot)) foot = '';
  const join = (b: string) => [b, foot].filter(Boolean).join('\n\n');
  const whole = join(body);
  if (whole.length <= LIMITS.messageChars) return { text: whole, full: whole.length, missing };
  // Over the limit. The Review step will not start a campaign like this (`validateCampaign`), so this cut is a guard
  // for every other caller: the body gives way, the opt-out line is never the part that is lost.
  const room = LIMITS.messageChars - (foot ? foot.length + 2 : 0);
  return { text: join(cut(body, Math.max(0, room)).trimEnd()), full: whole.length, missing };
}

/** The message for one person: variables filled, a choice made (by `seed`, so a preview is what is sent), the opt-out line added. */
export function renderMessage(d: Draft, r: Recipient, seed = 0): string {
  return render(d, r, seed).text;
}

/**
 * Variables some recipients have no value for (and no fallback), with how many — only those that are missing for
 * someone. Counted by rendering each person with the same seed the runner uses, so a variable that sits in a
 * `[[…]]` alternative a person is not given is not counted against them.
 */
export function missingVars(d: Draft, recipients: readonly Recipient[], seed = 0): { name: string; missing: number }[] {
  const counts = new Map<string, number>();
  for (const r of recipients) for (const name of render(d, r, seed).missing) counts.set(keyOf(name), (counts.get(keyOf(name)) ?? 0) + 1);
  return variablesIn(d.text).map((name) => ({ name, missing: counts.get(keyOf(name)) ?? 0 })).filter((x) => x.missing > 0);
}

// ── whether a campaign may start ──────────────────────────────────────────

const ATTACHMENT_KINDS: readonly string[] = ['image', 'video', 'document', 'audio', 'contact'];
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Bytes a base64 text decodes to. */
const decodedBytes = (data: string): number => {
  const pad = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - pad);
};

/** What is wrong with an attachment, or null. Size before shape: a too-big file is told it is too big, not unreadable. */
function attachmentProblem(a: unknown): Problem | null {
  if (!a || typeof a !== 'object') return { code: 'attachment-unreadable' };
  const x = a as Partial<Attachment>;
  if (typeof x.kind !== 'string' || !ATTACHMENT_KINDS.includes(x.kind)) return { code: 'attachment-unreadable' };
  if (x.kind === 'contact') {
    const k = x.contact;
    return k && typeof k === 'object' && plainValue(k.fullName) && wirePhone(k.phone) ? null : { code: 'attachment-unreadable' };
  }
  const data = typeof x.data === 'string' ? x.data : '';
  const bytes = Math.max(decodedBytes(data), Number.isFinite(x.bytes) ? Number(x.bytes) : 0);
  if (bytes > LIMITS.attachmentBytes) return { code: 'attachment-too-big', vars: { bytes, max: LIMITS.attachmentBytes } };
  if (!data || data.length % 4 === 1 || !BASE64.test(data)) return { code: 'attachment-unreadable' };
  return null;
}

/**
 * Why this campaign cannot start yet; empty when it can. `sentToday` is what this account has already sent today.
 *
 * More people than today's cap leaves is not a problem — the runner waits for the next day and `daysNeeded` tells the
 * screen how many days it takes — but a cap already used up today is: pressing Send would start nothing until tomorrow,
 * and a button that does nothing visible is a button pressed twice.
 */
export function validateCampaign(c: Campaign, o: { sentToday?: number } = {}): Problem[] {
  const out: Problem[] = [];
  const recipients = Array.isArray(c.recipients) ? c.recipients : [];
  const n = recipients.length;
  if (n === 0) out.push({ code: 'no-recipients' });
  if (n > LIMITS.recipients) out.push({ code: 'too-many', vars: { n, max: LIMITS.recipients } });
  const d: Draft = c.message && typeof c.message === 'object' ? c.message : { text: '', lang: 'en', optOut: false };
  const text = plainText(d.text);
  if (!text.trim() && !d.attachment) out.push({ code: 'no-message' });
  else {
    const seed = typeof c.seed === 'number' && Number.isFinite(c.seed) ? c.seed : 0;
    const people = n ? recipients.slice(0, LIMITS.recipients) : [{ phone: '', vars: {} }];
    let over = 0;
    let longest = 0;
    for (const r of people) {
      const { full } = render(d, r, seed);
      if (full > LIMITS.messageChars) over++;
      if (full > longest) longest = full;
    }
    if (over) out.push({ code: 'message-too-long', vars: { n: over, max: LIMITS.messageChars, longest } });
  }
  if (c.consent !== true) out.push({ code: 'no-consent' });
  if (!(typeof c.accountId === 'string' && c.accountId.trim())) out.push({ code: 'no-account' });
  if (d.attachment) {
    const why = attachmentProblem(d.attachment);
    if (why) out.push(why);
  }
  if (!paceInBounds(c.pace)) out.push({ code: 'pace-out-of-bounds' });
  const cap = clampPace(c.pace ?? {}).dailyCap;
  const sent = Number.isFinite(o.sentToday) ? Math.max(0, Number(o.sentToday)) : 0;
  if (sent >= cap) out.push({ code: 'over-daily-cap', vars: { sent, cap } });
  if (c.state === 'running') out.push({ code: 'already-running' });
  return out;
}

/** A campaign, ready to be reviewed (state `draft`, nobody has consented yet). */
export function newCampaign(o: {
  name: string; accountId: string; recipients: Recipient[]; message: Draft; pace?: Pace; audienceId?: string; now?: number; id?: string; staged?: boolean;
}): Campaign {
  const now = o.now ?? Date.now();
  return {
    id: o.id ?? `c${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    name: o.name, accountId: o.accountId, audienceId: o.audienceId,
    // A snapshot: the audience can be edited afterwards without changing who this campaign is for.
    recipients: Array.isArray(o.recipients) ? o.recipients.slice() : [],
    message: o.message,
    pace: clampPace(o.pace ?? DEFAULT_PACE),
    // Never true by default, whoever builds the campaign: the person ticks it on the Review step.
    consent: false,
    state: 'draft', outcomes: {}, created: now, updated: now, staged: o.staged,
  };
}

/**
 * The person decided: these `failed` or `unknown` people may be sent to again. Nobody sent, skipped or still queued
 * changes, and nothing happens by itself — this is the only way an `unknown` goes back in the queue, and it is a
 * person's button, not a rule. Call it on a campaign that is not running (a runner works on its own copy).
 */
export function requeue(c: Campaign, phones: readonly string[]): Campaign {
  const want = new Set(phones.map(wirePhone).filter(Boolean));
  const outcomes: Record<string, Outcome> = { ...c.outcomes };
  for (const p of want) {
    const o = own(outcomes, p) ? outcomes[p] : undefined;
    if (o && (o.standing === 'failed' || o.standing === 'unknown')) outcomes[p] = { ...o, standing: 'queued', why: undefined };
  }
  return { ...c, outcomes };
}

// ── pace ──────────────────────────────────────────────────────────────────

type Bounded = keyof typeof PACE_BOUNDS;
const BOUNDED = Object.keys(PACE_BOUNDS) as Bounded[];

/** Keep a pace inside the bounds the product allows; anything missing or not a number is the default. */
export function clampPace(p: Partial<Pace>): Pace {
  const src = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
  const out: Pace = { ...DEFAULT_PACE };
  for (const k of BOUNDED) {
    const v = src[k];
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    const [lo, hi] = PACE_BOUNDS[k];
    out[k] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : DEFAULT_PACE[k];
  }
  if (out.maxDelaySec < out.minDelaySec) out.maxDelaySec = out.minDelaySec;
  out.typing = typeof src.typing === 'boolean' ? src.typing : DEFAULT_PACE.typing;
  return out;
}

/** Whether a pace is inside the bounds the product allows. */
export function paceInBounds(p: Pace): boolean {
  if (!p || typeof p !== 'object') return false;
  for (const k of BOUNDED) {
    const v = p[k];
    const [lo, hi] = PACE_BOUNDS[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) return false;
  }
  return p.maxDelaySec >= p.minDelaySec && typeof p.typing === 'boolean';
}

/** Whether a daily cap earns the plain warning. */
export function capWarning(p: Pace): boolean {
  return clampPace(p).dailyCap > CAP_WARN;
}

/** The average "typing…" time the runner asks for, in seconds (`whatsappsend.ts` scales it with the text, 0.8 to 2.5 s). */
const TYPING_SEC = 1.6;

/**
 * About how long `people` messages take at this pace, in seconds: the average delay before every message (the first
 * one waits too), the typing time, and a batch pause between every `batchSize`. The daily cap is not in it —
 * `daysNeeded` says how many days, and the screen says both.
 */
export function estimateSeconds(people: number, pace: Pace = DEFAULT_PACE): number {
  const n = Number.isFinite(people) ? Math.max(0, Math.floor(people)) : 0;
  if (!n) return 0;
  const p = clampPace(pace);
  const each = (p.minDelaySec + p.maxDelaySec) / 2 + (p.typing ? TYPING_SEC : 0);
  return Math.round(n * each + Math.floor((n - 1) / p.batchSize) * p.batchPauseSec);
}

/** How many calendar days the cap spreads `people` messages over, given what was already sent today (today counts as one). */
export function daysNeeded(people: number, pace: Pace = DEFAULT_PACE, sentToday = 0): number {
  const cap = clampPace(pace).dailyCap;
  const n = Number.isFinite(people) ? Math.max(0, Math.floor(people)) : 0;
  const s = Number.isFinite(sentToday) ? Math.min(cap, Math.max(0, sentToday)) : 0;
  return Math.max(1, Math.ceil((n + s) / cap));
}

// ── stop words ────────────────────────────────────────────────────────────

/*
 * A reply is a stop request when, with punctuation, emoji, case and diacritics gone, and a few words of politeness
 * set aside, what is left is one of these. The whole message has to be it: "don't stop", "please stop by tomorrow"
 * and a paragraph that happens to contain "stop" are not requests, and suppressing someone for them would be a bug
 * of its own. Erring is still cheaper this way round — a person left off a list wrongly misses an offer; a person
 * who asked to stop and is written to again has been ignored — so the list takes the plain forms people really send.
 *
 * Arabic and Kurdish are folded before comparing: hamza forms of alef, Arabic and Persian yeh and kaf, and the Kurdish
 * letters a person without a Kurdish keyboard types differently (ڕ ر, ێ ی, ۆ و, ڵ ل, ە ه). Folding is only for this
 * comparison; nothing is rewritten.
 */
const STOP_WORDS = [
  'stop', 'unsubscribe', 'cancel', 'end', 'quit', 'no more', 'opt out', 'optout', 'remove', 'remove me',
  'stop sending', 'stop messaging', 'stop texting', 'stop all', 'leave me alone',
  'إيقاف', 'ايقاف', 'وقف', 'توقف', 'أوقف', 'إلغاء', 'الغاء', 'إلغاء الاشتراك', 'الغاء الاشتراك', 'ستوب', 'لا أريد',
  'وەستان', 'وەستێنە', 'ڕاگرە', 'نامەوێت', 'لابدە', 'بوەستە',
  'ڕاوەستە', 'نەخوازم', 'بەس', 'بس',
  'dur', 'durdur', 'iptal', 'bes',
  // How people write it in a sentence: with "me", with "your list", with "do not" (the engine review's misses).
  'remove me from your list', 'remove me from the list', 'remove me from this list', 'take me off', 'take me off your list',
  'take me off the list', 'take me off this list', 'dont message me', 'dont text me', 'dont contact me', 'dont send me',
  'do not message me', 'do not text me', 'do not contact me', 'do not send me', 'stop contacting',
  'لا ترسل', 'لا ترسلوا', 'لا ترسل لي', 'لا ترسلوا لي', 'لا تراسلني', 'لا أريد رسائل', 'توقفوا', 'أوقفوا', 'كفى', 'كفاية',
  // Kurdish in Latin letters: Kurmanji (Badini) "stop", "stop it", "I do not want"; Sorani "stopping".
  'raweste', 'rawestine', 'nexwazim', 'naxwazim', 'westan',
];

/** Words of politeness that do not change what a short reply asks for. */
const FILLER_WORDS = [
  'please', 'pls', 'plz', 'now', 'it', 'all', 'me', 'thanks', 'thank you', 'thx', 'messages', 'message', 'msgs', 'sms', 'whatsapp',
  'من فضلك', 'لو سمحت', 'رجاء', 'رجاءا', 'ارجو', 'شكرا', 'الرسائل', 'الآن',
  'تکایە', 'سوپاس', 'نامەکان', 'ئێستا',
  'lutfen', 'tesekkurler', 'spas',
];

function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['\u2019`]/g, '')
    .replace(/[\u0640\u200C\u200D\uFE0E\uFE0F]/g, '')
    .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627')
    .replace(/[\u064A\u0649\u06CE]/g, '\u06CC')
    .replace(/\u0643/g, '\u06A9')
    .replace(/\u0695/g, '\u0631')
    .replace(/\u06C6/g, '\u0648')
    .replace(/\u06B5/g, '\u0644')
    .replace(/[\u06D5\u06BE\u0629]/g, '\u0647')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPS = new Set(STOP_WORDS.map(fold));
const FILLERS = FILLER_WORDS.map(fold).sort((a, b) => b.length - a.length);

/**
 * The words of politeness taken off the ends only, one at a time, until a stop phrase is left (or nothing is): so a
 * phrase that has a filler inside it — "don't message me" — is still found in "please, don't message me".
 */
function trimFillers(f: string): string {
  let s = f;
  while (s && !STOPS.has(s)) {
    const w = FILLERS.find((x) => s === x || s.startsWith(`${x} `) || s.endsWith(` ${x}`));
    if (!w) break;
    if (s === w) return '';
    s = s.startsWith(`${w} `) ? s.slice(w.length + 1) : s.slice(0, s.length - w.length - 1);
  }
  return s;
}

/** Whether an incoming message is a request to stop. */
export function isOptOut(text: string): boolean {
  if (typeof text !== 'string' || text.length > 200) return false;
  let f = fold(text);
  // "S.T.O.P" and "s t o p": letters one at a time are one word.
  if (/^\p{L}( \p{L})+$/u.test(f)) f = f.replace(/ /g, '');
  if (!f || f.length > 60 || f.split(' ').length > 6) return false;
  // "STOP STOP": a word said twice in a row is said once.
  f = f.split(' ').filter((w, i, all) => w !== all[i - 1]).join(' ');
  if (STOPS.has(f)) return true;
  let rest = ` ${f} `;
  for (const w of FILLERS) rest = rest.split(` ${w} `).join(' ');
  rest = rest.replace(/\s+/g, ' ').trim();
  if (rest && STOPS.has(rest)) return true;
  return STOPS.has(trimFillers(f));
}

/**
 * The phones among `recipients` that sent a stop word in `msgs`. Only people, only incoming, only those the campaign
 * wrote to: a "stop" said in a group is not said to us, and a stranger's "stop" is not about a list they are not on.
 */
export function optOutPhones(msgs: readonly Msg[], recipients: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const m of msgs) {
    if (!m || m.fromMe) continue;
    const p = phoneOf(m.jid);
    if (p && recipients.has(p) && isOptOut(m.text)) out.add(p);
  }
  return [...out];
}

// ── the report ────────────────────────────────────────────────────────────

/**
 * One CSV cell. A cell a spreadsheet would run as a formula — `=`, `+`, `-`, `@`, a tab or a carriage return first,
 * or their full-width twins — gets a leading `'`, the OWASP rule: a name like `=HYPERLINK(…)` in a contacts file
 * must arrive in the owner's spreadsheet as text, not as a link. Then the RFC 4180 quoting.
 */
function cell(v: unknown): string {
  let s = typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
  if (/^[\t\r]|^\s*[=+\-@＝＋－＠]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const iso = (at: unknown): string =>
  typeof at === 'number' && Number.isFinite(at) && at > 0 && at < 8.64e15 ? new Date(at).toISOString() : '';

/**
 * The campaign's report as CSV: one row per person, in the list's order, with where they stand, why, and when it last
 * changed. No key, no gateway address and no message body — it is meant to be kept and shared.
 */
export function reportCsv(c: Campaign): string {
  const rows: unknown[][] = [['phone', 'name', 'standing', 'why', 'time']];
  const outcomes = c.outcomes && typeof c.outcomes === 'object' ? c.outcomes : {};
  const seen = new Set<string>();
  const row = (phone: string, name: string) => {
    const o = own(outcomes, phone) ? outcomes[phone] : undefined;
    rows.push([phone, name, o?.standing ?? 'queued', o?.why ?? '', iso(o?.at)]);
  };
  for (const r of Array.isArray(c.recipients) ? c.recipients : []) {
    const p = wirePhone(r?.phone) || plainValue(r?.phone, 40);
    if (!p || seen.has(p)) continue;
    seen.add(p);
    row(p, plainValue(r?.name));
  }
  for (const p of Object.keys(outcomes)) if (!seen.has(p)) { seen.add(p); row(p, ''); }
  return `${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
