import type { Chat } from './whatsapp';
import {
  LIMITS, type Audience, type Country, type InvalidWhy, type Lang, type Parsed, type Recipient,
} from './whatsappbulktypes';

/**
 * Reading a list of people. PLACEHOLDER from Phase 0 (docs/WA.md): the `audience` package replaces
 * this file — text, csv, tsv, vcf, xlsx, any text with numbers in it; number normalisation for many
 * countries; masks; dedupe. The names and signatures below are the contract the screens are built against.
 */
export interface ParseOptions {
  /** The calling code assumed for a number written without one, as digits (`964`). */
  defaultCountry?: string;
  /** The file's name and type, when it came from a file. */
  filename?: string;
  mime?: string;
  /** Column choices that override the guess (run it again on the same input to remap). */
  phoneColumn?: string;
  nameColumn?: string;
}

export async function parseAudience(_input: string | Uint8Array, o: ParseOptions = {}): Promise<Parsed> {
  return {
    format: 'text', recipients: [], rejected: [], duplicates: 0, columns: [], phoneColumn: null, nameColumn: null,
    defaultCountry: o.defaultCountry ?? '964',
  };
}

/** A number as WhatsApp writes it (digits, country code first), or why it is not one. */
export function normalisePhone(_raw: string, _country: string): { phone: string } | { why: InvalidWhy } {
  return { why: 'not-a-number' };
}

/** The countries the picker offers, the most likely first. */
export const COUNTRIES: readonly Country[] = [];

/** The calling code most likely meant by a person using this interface language. */
export function countryForLang(_lang: Lang): string {
  return '964';
}

/** The people in the chats an account can see, as a list to choose from (groups and `@lid` identities are not numbers). */
export function fromChats(_chats: readonly Chat[]): Parsed {
  return parseSync();
}

function parseSync(): Parsed {
  return { format: 'chats', recipients: [], rejected: [], duplicates: 0, columns: [], phoneColumn: null, nameColumn: null, defaultCountry: '964' };
}

/** The recipients not on the do-not-contact list, and how many were left out. */
export function excludeSuppressed(list: readonly Recipient[], suppressed: ReadonlySet<string>): { kept: Recipient[]; removed: number } {
  const kept = list.filter((r) => !suppressed.has(r.phone));
  return { kept, removed: list.length - kept.length };
}

/** A parsed list kept under a name. */
export function makeAudience(p: Parsed, name: string, now: number = Date.now()): Audience {
  return { id: `a${now}`, name, recipients: p.recipients.slice(0, LIMITS.recipients), source: p.format, created: now, updated: now };
}

/** `+964 750 *** 4567`: enough to recognise, not enough to copy. */
export function maskPhone(phone: string): string {
  return phone.length > 6 ? `+${phone.slice(0, 3)} ${phone.slice(3, 6)} *** ${phone.slice(-4)}` : '***';
}
