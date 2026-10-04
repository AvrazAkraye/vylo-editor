/**
 * The words every part of the WhatsApp broadcast feature shares (docs/WA.md).
 *
 * Types and limits only — no behaviour — so that the parser, the engine, the
 * ready messages, the writer, the assistant's tools and the screens can be built
 * side by side and still meet. A package may append types and optional fields
 * at the end under a `// wa:<package>` comment; it may not change what is here.
 *
 * Everything that crosses a boundary (a file, a stored record, a model's reply)
 * is read again by the reader that owns it and clamped to `LIMITS`.
 */
import type { Lang } from './i18n';

export type { Lang };

/** The languages a message is written in: the interface's four. */
export const MESSAGE_LANGS: readonly Lang[] = ['en', 'ar', 'ckb', 'kmr'];

// ── the limits, in one place ──────────────────────────────────────────────

export const LIMITS = {
  /** People in one audience, and in one campaign. */
  recipients: 5_000,
  /** Characters of a message after its variables are filled. WhatsApp's own ceiling is 4,096; this leaves room for the opt-out line. */
  messageChars: 3_800,
  /** An attachment, in bytes (the base64 text is a third bigger). */
  attachmentBytes: 16 * 1024 * 1024,
  /** A name or a value from a file's column, in characters. */
  valueChars: 120,
  /** Columns kept from a file. */
  columns: 12,
  /** Audiences and campaigns kept on this machine. */
  audiences: 40,
  campaigns: 60,
  /** The do-not-contact list. */
  suppressed: 20_000,
} as const;

// ── people ────────────────────────────────────────────────────────────────

/** One person to message. */
export interface Recipient {
  /** Digits only, country code first, no `+` and no spaces: WhatsApp's own form, `9647501234567`. */
  phone: string;
  name?: string;
  /** The file's other columns, by header (`{ city: 'Erbil' }`); plain text, each at most `LIMITS.valueChars`. */
  vars: Record<string, string>;
}

/** Why a line of a file was not taken as a number. */
export type InvalidWhy = 'empty' | 'too-short' | 'too-long' | 'not-a-number' | 'country-unknown';

export interface Rejected {
  /** 1-based, in the file as read. */
  line: number;
  /** What was there, cut to `LIMITS.valueChars`. */
  raw: string;
  why: InvalidWhy;
}

export type SourceFormat = 'text' | 'txt' | 'csv' | 'tsv' | 'vcf' | 'xlsx' | 'chats';

/** What reading a file or a pasted list came to. */
export interface Parsed {
  format: SourceFormat;
  recipients: Recipient[];
  rejected: Rejected[];
  /** Lines that repeated a number already taken. */
  duplicates: number;
  /** The file's column headers, when it had any. */
  columns: string[];
  phoneColumn: string | null;
  nameColumn: string | null;
  /** The calling code assumed for numbers written without one, as digits: `964`. */
  defaultCountry: string;
}

/** A kept list. */
export interface Audience {
  id: string;
  name: string;
  recipients: Recipient[];
  source: SourceFormat;
  /** The file's name, when it came from one. */
  file?: string;
  created: number;
  updated: number;
}

// ── messages ──────────────────────────────────────────────────────────────

export interface ContactCard {
  fullName: string;
  /** Digits only. */
  phone: string;
  organization?: string;
}

export type AttachmentKind = 'image' | 'video' | 'document' | 'audio' | 'contact';

export interface Attachment {
  kind: AttachmentKind;
  name: string;
  mime: string;
  bytes: number;
  /** Base64 without a `data:` prefix; empty for a contact card. */
  data: string;
  contact?: ContactCard;
}

/**
 * What is sent. `text` may hold `{name}`, `{first_name}`, `{any column}` and `{name|fallback}`, and `[[a|b|c]]` for a
 * choice that differs from person to person (whatsappcampaign.ts says exactly how they are read and filled).
 */
export interface Draft {
  text: string;
  lang: Lang;
  attachment?: Attachment;
  /** Add the opt-out line at the foot of each message. On unless the person turns it off. */
  optOut: boolean;
  /** The opt-out line in `lang`; the engine's default when absent. */
  optOutText?: string;
}

// ── pace ──────────────────────────────────────────────────────────────────

export interface Pace {
  minDelaySec: number;
  maxDelaySec: number;
  /** Messages between two long pauses. */
  batchSize: number;
  batchPauseSec: number;
  /** Messages in one calendar day on this account. */
  dailyCap: number;
  /** Failures in a row that halt the campaign. */
  stopAfterFailures: number;
  /** Show "typing…" for a moment before each message (the gateway's `delay`). */
  typing: boolean;
}

export const DEFAULT_PACE: Readonly<Pace> = {
  minDelaySec: 12,
  maxDelaySec: 30,
  batchSize: 20,
  batchPauseSec: 180,
  dailyCap: 200,
  stopAfterFailures: 3,
  typing: true,
};

/** Bounds a person may move the pace within; below `minDelaySec` the product does not go. */
export const PACE_BOUNDS = {
  minDelaySec: [6, 120],
  maxDelaySec: [8, 300],
  batchSize: [5, 100],
  batchPauseSec: [30, 1800],
  dailyCap: [10, 1000],
  stopAfterFailures: [2, 10],
} as const;

/** A daily cap above this earns a plain warning. */
export const CAP_WARN = 300;

// ── a campaign ────────────────────────────────────────────────────────────

/** Where one person stands. `unknown`: the send may or may not have gone; never retried by itself. */
export type Standing =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'unknown'
  | 'skipped-not-on-whatsapp'
  | 'skipped-opted-out'
  | 'skipped-invalid'
  | 'skipped-duplicate';

export interface Outcome {
  phone: string;
  standing: Standing;
  /** When it last changed, ms. */
  at?: number;
  /** A short machine word for the report (`http-429`, `timeout`, `not-on-whatsapp`), never a key or a body. */
  why?: string;
  attempts: number;
}

export type CampaignState = 'draft' | 'ready' | 'running' | 'paused' | 'done' | 'stopped' | 'halted';

export interface Campaign {
  id: string;
  name: string;
  /** The WhatsApp account (whatsapp.ts `Account.id`) it sends from. */
  accountId: string;
  /** The audience it came from, when kept. */
  audienceId?: string;
  /** A snapshot: editing the audience later does not change a campaign made from it. */
  recipients: Recipient[];
  message: Draft;
  pace: Pace;
  /** The person ticked "everyone on this list agreed to hear from me". Never true by default. */
  consent: boolean;
  state: CampaignState;
  /** By phone. */
  outcomes: Record<string, Outcome>;
  created: number;
  updated: number;
  started?: number;
  finished?: number;
  /** Why it stopped by itself, in a word the interface turns into a sentence. */
  halted?: string;
  /** Prepared by the assistant for the person to review; nothing has been sent. */
  staged?: boolean;
}

/** A reason a campaign cannot start yet. The interface turns `code` into a sentence. */
export interface Problem {
  code:
    | 'no-recipients' | 'too-many' | 'no-message' | 'message-too-long' | 'no-consent' | 'no-account'
    | 'attachment-too-big' | 'attachment-unreadable' | 'pace-out-of-bounds' | 'over-daily-cap' | 'already-running';
  /** Numbers for the sentence: `{ n: 5200, max: 5000 }`. */
  vars?: Record<string, number | string>;
}

// ── ready messages ────────────────────────────────────────────────────────

export type CategoryId =
  | 'sale' | 'new' | 'code' | 'flash' | 'restock' | 'event' | 'opening' | 'appointment' | 'followup' | 'review'
  | 'loyalty' | 'birthday' | 'holiday' | 'order' | 'delivery' | 'payment' | 'cart' | 'welcome' | 'course'
  | 'health' | 'property' | 'food' | 'verify' | 'notice' | 'survey' | 'referral';

export interface Category {
  id: CategoryId;
  title: Record<Lang, string>;
  /** An `Icon.tsx` name. */
  icon: string;
}

/** `promo` asks for the opt-out line; `service` (a code, an order, a reminder to someone who is a customer) does not need it. */
export type TemplateKind = 'promo' | 'service' | 'greeting';

export interface Template {
  id: string;
  category: CategoryId;
  kind: TemplateKind;
  title: Record<Lang, string>;
  /** The message in each language, with `{placeholders}`. */
  text: Record<Lang, string>;
  /** Placeholders the person fills or the file provides: `['name', 'business', 'offer']`. */
  vars: string[];
  tags: string[];
}

// ── the writer ────────────────────────────────────────────────────────────

export type WriteAction = 'write' | 'improve' | 'translate' | 'shorten' | 'variants';
export type Tone = 'friendly' | 'professional' | 'urgent' | 'festive' | 'short';

export interface WriteRequest {
  action: WriteAction;
  /** What the person wants said, in their own words. The only thing from the person that reaches the model besides `base`. */
  brief: string;
  lang: Lang;
  tone: Tone;
  /** The message to improve, translate, shorten or vary. */
  base?: string;
  business?: string;
  /** How many alternatives (1 to 4). */
  count: number;
}

// ── Phase 0 additions the screens and the engine meet at ─────────────────

/** A country a number can belong to. `code` is the calling code as digits. */
export interface Country {
  iso: string;
  code: string;
  name: Record<Lang, string>;
  /** An emoji flag, for the picker. */
  flag: string;
}

/** What a runner tells whoever is drawing it. */
export type RunEvent =
  /** Every change a screen should draw: a person's standing, the state, a halt. */
  | { kind: 'state'; campaign: Campaign }
  /** The runner is waiting, and until when (ms): a delay between two messages, a batch pause, or tomorrow's cap. */
  | { kind: 'wait'; until: number; why: 'delay' | 'batch' | 'daily-cap' };

/** A plain hint about a message that may look like spam to WhatsApp or to the person reading it. */
export interface Hint {
  code: 'caps' | 'exclaims' | 'links' | 'short-link' | 'long' | 'money-words' | 'repeat';
  vars?: Record<string, number | string>;
}

// wa:audience, wa:engine, wa:templates, wa:writer, wa:ui, wa:design — append below, under your own comment.
