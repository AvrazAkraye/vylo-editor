/**
 * Reading a list of people from anything a shopkeeper has (docs/WA.md, package `audience`).
 *
 * A pasted list, a notes file, a CSV from a form, Excel's "CSV" in Windows-1256, a phone's contacts export, a
 * workbook, the people already in the account's chats: each becomes the same `Parsed` — digits-only international
 * numbers (`9647501234567`, WhatsApp's own form) with a name and the file's other columns, the lines that could not be
 * read and why, how many repeated, and a few numbers worth a second look.
 *
 * ## A number is a person
 *
 * Getting a number wrong is not a parse error. It is a message, under the shop's name, to a stranger. So the
 * normaliser rejects with a reason rather than guess (`too-short`, `too-long`, `not-a-number`, `country-unknown`), and
 * the free-text reader prefers missing a number to inventing one: a run of digits in a sentence is taken only when it
 * carries a sign of being a phone number (a `+`, a trunk zero, the country code, a mobile's shape), and a word before
 * it becomes a name only when the line is plainly "name, number".
 *
 * Each country's numbering plan is a few lengths and prefixes (`PLAN_LIST`), written from the ITU's published plans as
 * well as this package's author knew them. The countries this app's people live in and call — Iraq first — are exact;
 * others are deliberately generous, because a too-strict length rejects a real customer while a too-loose one is
 * caught at the next step anyway (the engine asks WhatsApp which numbers are on it before sending). `docs/wa/audience.md`
 * says where the author was unsure.
 *
 * ## The file is hostile
 *
 * It may be 5 MB of zeros, a picture renamed `.csv`, a quote that never closes, a vCard with a megabyte of photo in it, a
 * zip bomb named `.xlsx`. Nothing here uses `eval`, a regular expression that can backtrack (every pattern is anchored
 * with no nested repetition, and the free-text reader is a hand-written single pass), recursion, or an allocation sized
 * by what the file claims. Every count has a ceiling: 10 MB in, `LIMITS.recipients` people out, a thousand rejected
 * lines listed (the rest counted), so 50,000 lines of junk are read in one quick pass and summed up rather than kept.
 * And `parseAudience` never throws: a file that cannot be read is a `Parsed` with a `problem` and one rejected line.
 *
 * ## The list never leaves this machine
 *
 * Nothing here touches the network or a model. The assistant's tool and the interface show counts and `maskPhone`
 * examples (`+964 750 *** 4567`); the list itself stays where it was read (docs/WA.md, non-negotiable 2).
 */
import { isPhone, phoneOf, type Chat } from './whatsapp';
import {
  LIMITS,
  type Audience, type Country, type FileProblem, type InvalidWhy, type Lang, type Parsed, type Recipient, type Rejected,
  type SourceFormat, type Warned,
} from './whatsappbulktypes';
import { SHEET_LIMITS, SheetError, expandNumber, isOle, isZip, readSheet } from './whatsappsheet';

export interface ParseOptions {
  /** The calling code assumed for a number written without one, as digits (`964`). */
  defaultCountry?: string;
  /** The file's name and type, when it came from a file. */
  filename?: string;
  mime?: string;
  /**
   * Column choices that override the guess (run it again on the same input to remap). A name from `Parsed.columns`;
   * `nameColumn: ''` means "no name column".
   */
  phoneColumn?: string;
  nameColumn?: string;
}

// ── the ceilings ──────────────────────────────────────────────────────────

/** Characters of pasted text read; bytes of a file read. Past this the rest is not read, and the result says so. */
const MAX_INPUT = SHEET_LIMITS.file;
/** Lines (or rows) read at all. Far past any honest list of `LIMITS.recipients` people. */
const MAX_LINES = 200_000;
/** Rejected lines listed one by one; the rest are only counted (`Parsed.rejectedMore`). */
const MAX_REJECTED = 1_000;
const MAX_WARNED = 1_000;
/** Columns of a table read, and characters kept of one field. */
const MAX_COLS = 256;
const MAX_FIELD = 4_096;
/** Characters of one cell the normaliser looks at. No phone number, however it is written, is longer. */
const MAX_PHONE_TEXT = 64;
/** Characters of one line the free-text reader looks at. */
const MAX_LINE = 1_000_000;
/** Header text kept as a column's name (and a variable's key). */
const MAX_KEY = 40;

// ── numbering plans ───────────────────────────────────────────────────────

/** National lengths for numbers that start with `prefix` ('' is every number). */
interface Rule { prefix: string; min: number; max: number }

interface Plan {
  /** The calling code, as digits. */
  code: string;
  /** The first rule whose prefix the national number starts with decides; the last rule's prefix is ''. */
  rules: Rule[];
  /** What is dialled before a national number inside the country (`0` mostly, `8` in Russia, `06` in Hungary); none where nothing is. */
  trunk: string[];
  /** How a mobile number starts, where that is known well enough to warn about a number that is not one. */
  mobile: string[];
  /**
   * A shape every national number has, beyond its length, where the plan has one: North America's area code and
   * exchange never start with 0 or 1, and no +7 number starts with 0, 1, 2 or 5. A number that fails it is nobody's.
   */
  shape?: RegExp;
}

/**
 * One country's plan from a compact spec: `lens` is space-separated rules, each `prefix:min-max` or a bare `min-max`
 * for every other number (`'7:10 1:8 8-9'`: Iraqi numbers starting with 7 have ten digits, with 1 eight, the rest eight
 * or nine). `trunk` and `mobile` are comma-separated.
 */
function plan(code: string, lens: string, trunk = '0', mobile = '', shape?: RegExp): Plan {
  const rules = lens.split(' ').map((spec): Rule => {
    const colon = spec.indexOf(':');
    const [min, max = min] = spec.slice(colon + 1).split('-').map(Number);
    return { prefix: colon < 0 ? '' : spec.slice(0, colon), min, max };
  });
  if (rules[rules.length - 1].prefix !== '') rules.push({ prefix: '', min: 4, max: 15 - code.length });
  return { code, rules, trunk: trunk ? trunk.split(',') : [], mobile: mobile ? mobile.split(',') : [], shape };
}

/**
 * Every assigned geographic calling code. Lengths are of the national significant number (no trunk prefix, no country
 * code). Calling codes are a prefix code — no code is the start of another — which is what lets an international number
 * be split without a separator; the test suite checks it. The shared non-geographic codes (satellite phones, the global
 * freephone 800) are left out on purpose: nobody's customer is on WhatsApp through Inmarsat.
 */
const PLAN_LIST: Plan[] = [
  // Zone 1: the North American plan (US, Canada, much of the Caribbean): ten digits, NXX NXX XXXX — an area code and an
  // exchange never start with 0 or 1 — and "1" is dialled before them at home.
  plan('1', '10', '1', '', /^[2-9][0-9]{2}[2-9]/),
  // Zone 2: Africa.
  plan('20', '1:10 8-9', '0', '10,11,12,15'),
  plan('211', '9'), plan('212', '9', '0', '6,7'), plan('213', '8-9', '0', '5,6,7'), plan('216', '8', '', '2,4,5,9'),
  plan('218', '8-9', '0', '9'), plan('220', '7', ''), plan('221', '9', ''), plan('222', '8', ''), plan('223', '8', ''),
  plan('224', '8-9', ''), plan('225', '8-10', ''), plan('226', '8', ''), plan('227', '8', ''), plan('228', '8', ''),
  plan('229', '8-10', ''), plan('230', '7-8', ''), plan('231', '7-9'), plan('232', '8'), plan('233', '9'), plan('234', '7-10'),
  plan('235', '8', ''), plan('236', '8', ''), plan('237', '8-9', ''), plan('238', '7', ''), plan('239', '7', ''),
  plan('240', '9', ''), plan('241', '7-8', ''), plan('242', '9', ''), plan('243', '9'), plan('244', '9', ''),
  plan('245', '7-9', ''), plan('246', '7', ''), plan('247', '4-5', ''), plan('248', '7', ''), plan('249', '9'),
  plan('250', '9'), plan('251', '9'), plan('252', '7-9'), plan('253', '8', ''), plan('254', '9-10'), plan('255', '9'),
  plan('256', '9'), plan('257', '8', ''), plan('258', '8-9', ''), plan('260', '9'), plan('261', '9'), plan('262', '9'),
  plan('263', '5-10'), plan('264', '6-10'), plan('265', '7-9'), plan('266', '8', ''), plan('267', '7-8', ''),
  plan('268', '8', ''), plan('269', '7', ''), plan('27', '9'), plan('290', '4-5', ''), plan('291', '7'),
  plan('297', '7', ''), plan('298', '6', ''), plan('299', '6', ''),
  // Zone 3 and 4: Europe. Italy, San Marino, Spain, Greece, Portugal, Denmark, Norway, Poland keep no trunk: in Italy
  // the leading 0 of a landline is part of the number, and must not be dropped.
  plan('30', '10', '', '69'), plan('31', '9', '0', '6'), plan('32', '4:9 8-9', '0', '4'), plan('33', '9', '0', '6,7'),
  plan('34', '9', '', '6,7'), plan('350', '8', ''), plan('351', '9', '', '9'), plan('352', '4-11', ''), plan('353', '7-9', '0', '8'),
  plan('354', '7-9', ''), plan('355', '8-9'), plan('356', '8', ''), plan('357', '8', '', '9'), plan('358', '5-12'),
  plan('359', '7-9'), plan('36', '8-9', '06'), plan('370', '8', '8,0'), plan('371', '8', ''), plan('372', '7-8', ''),
  plan('373', '8'), plan('374', '8', '0'), plan('375', '9', '80,8,0'), plan('376', '6-9', ''), plan('377', '8-9', ''),
  plan('378', '6-10', ''), plan('380', '9'), plan('381', '8-10'), plan('382', '8'), plan('383', '8-9'), plan('385', '8-9'),
  plan('386', '8'), plan('387', '8-9'), plan('389', '8'), plan('39', '6-11', '', '3'),
  plan('40', '9', '0', '7'), plan('41', '9', '0', '7'), plan('420', '9', ''), plan('421', '9'), plan('423', '7-9', ''),
  plan('43', '4-13', '0', '6'), plan('44', '7:10 9-10', '0', '7'), plan('45', '8', ''), plan('46', '7-10', '0', '70,72,73,76,79'),
  plan('47', '8', '', '4,9'), plan('48', '9', ''), plan('49', '1:10-11 6-12', '0', '15,16,17'),
  // Zone 5: Central and South America.
  plan('500', '5', ''), plan('501', '7', ''), plan('502', '8', ''), plan('503', '8', ''), plan('504', '8', ''),
  plan('505', '8', ''), plan('506', '8', ''), plan('507', '7-8', ''), plan('508', '6', ''), plan('509', '8', ''),
  plan('51', '8-9'), plan('52', '10-11', ''), plan('53', '6-8'), plan('54', '10-11'), plan('55', '10-11'), plan('56', '9', ''),
  plan('57', '10', ''), plan('58', '10'), plan('590', '9'), plan('591', '8'), plan('592', '7', ''), plan('593', '8-9'),
  plan('594', '9'), plan('595', '9'), plan('596', '9'), plan('597', '6-7', ''), plan('598', '8'), plan('599', '7-8', ''),
  // Zone 6: South-East Asia and Oceania.
  plan('60', '8-10', '0', '1'), plan('61', '9', '0', '4'), plan('62', '8-12', '0', '8'), plan('63', '8-10', '0', '9'),
  plan('64', '8-10', '0', '2'), plan('65', '8', '', '8,9'), plan('66', '8-9', '0', '6,8,9'), plan('670', '7-8', ''),
  plan('672', '6', ''), plan('673', '7', ''), plan('674', '7', ''), plan('675', '7-8', ''), plan('676', '5-7', ''),
  plan('677', '5-7', ''), plan('678', '5-7', ''), plan('679', '7', ''), plan('680', '7', ''), plan('681', '6', ''),
  plan('682', '5', ''), plan('683', '4', ''), plan('685', '5-7', ''), plan('686', '5-8', ''), plan('687', '6', ''),
  plan('688', '5-6', ''), plan('689', '6-8', ''), plan('690', '4-5', ''), plan('691', '7', ''), plan('692', '7', ''),
  // Zone 7: Russia and Kazakhstan share it; "8" is dialled before a national number. Russia's numbers start 3, 4, 8
  // (landlines) or 9 (mobiles); Kazakhstan's 7 (landlines 71x/72x, mobiles 70x, 747, 75x, 76x, 77x) and 6 (reserved).
  plan('7', '10', '8', '9,70,74,75,76,77', /^[346789]/),
  // Zone 8: East Asia.
  plan('81', '9-10', '0', '70,80,90'), plan('82', '8-10', '0', '10'), plan('84', '9-10'), plan('850', '8-10', ''),
  plan('852', '8', ''), plan('853', '8', ''), plan('855', '8-9'), plan('856', '8-10'), plan('86', '1:10-11 9-11', '0', '13,14,15,16,17,18,19'),
  plan('880', '10', '0', '1'), plan('886', '8-9', '0', '9'),
  // Zone 9: Turkey, South Asia, the Middle East — this app's people, so the most exact. Iraqi mobiles are 7 and nine
  // more digits; a Baghdad landline is 1 and seven; other governorates two-digit area codes and six or seven.
  plan('90', '10', '0', '5'), plan('91', '10', '0', '6,7,8,9'), plan('92', '3:10 9-10', '0', '3'), plan('93', '9', '0', '7'),
  plan('94', '9', '0', '7'), plan('95', '7-10', '0', '9'), plan('960', '7', ''),
  // Lebanon: mobiles are 3 and six digits (written 03) or 70, 71, 76, 78, 79, 81 and six (written without the 0);
  // landlines a one-digit area code and six (Beirut 01).
  plan('961', '7-8', '0', '3,70,71,76,78,79,81'),
  plan('962', '7:9 8', '0', '7'), plan('963', '9:9 8-9', '0', '9'), plan('964', '7:10 1:8 8-9', '0', '74,75,76,77,78,79'),
  plan('965', '8', '', '4,5,6,9'), plan('966', '5:9 8-10', '0', '5'), plan('967', '7:9 7-8', '0', '7'),
  plan('968', '8', '', '7,9'), plan('970', '5:9 8-9', '0', '5'), plan('971', '5:9 8-9', '0', '5'), plan('972', '5:9 8-9', '0', '5'),
  plan('973', '8', '', '3,6'), plan('974', '8', '', '3,5,6,7'), plan('975', '7-8', ''), plan('976', '8', ''),
  plan('977', '8-10', '0', '9'), plan('98', '10', '0', '9'), plan('992', '9', ''), plan('993', '8', '8'),
  plan('994', '9'), plan('995', '9', '0', '5'), plan('996', '9'), plan('998', '9', ''),
];

const PLANS = new Map(PLAN_LIST.map((p) => [p.code, p]));

/** Every calling code the normaliser knows, for the picker's search and the test of the table. */
export const CALLING_CODES: readonly string[] = PLAN_LIST.map((p) => p.code);

/** The plan a digits-only international number belongs to: its calling code is one, two or three digits. */
function planFor(digits: string): Plan | null {
  for (let n = 1; n <= 3 && n <= digits.length; n++) {
    const p = PLANS.get(digits.slice(0, n));
    if (p) return p;
  }
  return null;
}

/** The calling code of a number in WhatsApp's form (`9647501234567` → `964`), or '' when it has none this knows. */
export function countryOf(phone: string): string {
  return planFor(typeof phone === 'string' ? phone : '')?.code ?? '';
}

function lengthWhy(p: Plan, nsn: string): InvalidWhy | null {
  const r = p.rules.find((x) => nsn.startsWith(x.prefix)) ?? p.rules[p.rules.length - 1];
  if (nsn.length < r.min) return 'too-short';
  if (nsn.length > r.max) return 'too-long';
  return p.shape && !p.shape.test(nsn) ? 'not-a-number' : null;
}

/**
 * Whether bare digits are more likely the home country's own number with one digit too many than another country's
 * number written without its `+`: they start the way a home number of a known shape starts (a mobile prefix, or a
 * prefix with a length of its own) and are at most one digit longer than that number can be. `75012345678` in an
 * Iraqi list is an Iraqi mobile with its zero gone and a slip of the finger; read as +7 501… it would message a
 * stranger in another country. Refused as too long, the person sees the line and fixes it.
 */
function homeTypo(home: Plan, digits: string): boolean {
  const known = home.rules.some((x) => x.prefix !== '' && digits.startsWith(x.prefix)) || home.mobile.some((m) => digits.startsWith(m));
  if (!known) return false;
  const r = home.rules.find((x) => digits.startsWith(x.prefix)) ?? home.rules[home.rules.length - 1];
  return digits.length <= r.max + 1;
}

/** Whether a number is shaped like a mobile in its country: `null` where this does not know the country's mobiles. */
function mobileShape(phone: string): boolean | null {
  const p = planFor(phone);
  if (!p || !p.mobile.length) return null;
  const nsn = phone.slice(p.code.length);
  return p.mobile.some((m) => nsn.startsWith(m));
}

// ── characters ────────────────────────────────────────────────────────────

/**
 * A digit's value in the scripts lists arrive in, or -1: ASCII, Arabic-Indic (what Arabic and Kurdish keyboards type),
 * Extended Arabic-Indic (Persian and Urdu), and full-width (an East Asian keyboard, or a phone's copy and paste).
 */
function digitOf(c: number): number {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 0x660 && c <= 0x669) return c - 0x660;
  if (c >= 0x6f0 && c <= 0x6f9) return c - 0x6f0;
  if (c >= 0xff10 && c <= 0xff19) return c - 0xff10;
  return -1;
}

const isPlus = (c: number): boolean => c === 43 || c === 0xff0b || c === 0xfe62;

/**
 * Invisible formatting that rides along with copied numbers: the left-to-right and right-to-left marks an Arabic or
 * Kurdish interface wraps around a number so it displays the right way round, bidi embeddings and isolates, zero-width
 * spaces and joiners' neighbours, the byte-order mark, the soft hyphen.
 */
function isInvisible(c: number): boolean {
  return c === 0xad || c === 0x61c || c === 0xfeff || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e)
    || (c >= 0x2060 && c <= 0x2069);
}

/** Space of every kind, including the no-break and thin spaces word processors put between digit groups. */
function isSpace(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12 || c === 0xa0 || c === 0x1680
    || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000;
}

/** What people put between the groups of a phone number. Not `,` `;` `:` or a tab: those separate numbers. */
function isPhonePunct(c: number): boolean {
  return c === 45 || c === 46 || c === 40 || c === 41 || c === 91 || c === 93 || c === 47 || c === 0xb7
    || (c >= 0x2010 && c <= 0x2015) || c === 0x2212 || c === 0xfe63 || c === 0xff0d || c === 0xff0e || c === 0xff08
    || c === 0xff09 || c === 0xff0f || c === 0x66c;
}

const isSeparator = (c: number): boolean => isSpace(c) || isInvisible(c) || isPhonePunct(c);

/** A letter in any script (a word character for the free-text reader's purposes). */
const LETTER = /\p{L}/u;
const isLetter = (c: number): boolean => c > 64 && LETTER.test(String.fromCodePoint(c));

/**
 * Text for a name or a value: one line, spaces collapsed, control characters and bidi overrides gone (a name that
 * carries U+202E would draw everything after it backwards in the interface — and in the message), capped to `cap`
 * characters without splitting a character. Zero-width joiner and non-joiner stay: Persian and Kurdish spell with them.
 */
function clean(raw: unknown, cap: number): string {
  if (typeof raw !== 'string') return '';
  const s = raw.length > cap * 8 ? raw.slice(0, cap * 8) : raw;
  let out = '';
  let n = 0;
  let space = false;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (isSpace(c)) { space = n > 0; continue; }
    if (c < 32 || (c >= 0x7f && c <= 0x9f) || (isInvisible(c) && c !== 0x200c && c !== 0x200d) || (c >= 0xd800 && c <= 0xdfff)
      || (c >= 0xfff9 && c <= 0xfffb) || c === 0xfffe || c === 0xffff) continue;
    if (n >= cap || (space && n + 1 >= cap)) break;
    if (space) { out += ' '; n++; space = false; }
    out += ch;
    n++;
  }
  return out;
}

/** A person's name from a cell, or nothing when there is no letter in it (a name that is just the number again). */
function nameFrom(raw: unknown): string | undefined {
  const n = clean(raw, LIMITS.valueChars);
  return n && LETTER.test(n) ? n : undefined;
}

/** A spreadsheet-style column letter: 0 → A, 26 → AA. The name of a column in a file that has no header row. */
function letter(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** A header as a column's name and a variable's key: one line, capped, without the characters a message template uses. */
function keyOf(header: string, i: number): string {
  const k = clean(header.replace(/[{}|[\]]/g, ' '), MAX_KEY).trim();
  return k || letter(i);
}

// ── the number ────────────────────────────────────────────────────────────

type Why = { why: InvalidWhy; hint?: 'excel-rounded' };
/** How a number was recognised: the free-text reader trusts some ways more than others. */
type Via = 'plus' | 'trunk' | 'code' | 'bare' | 'foreign';
type Norm = { phone: string; via: Via } | Why;

/** Excel's scientific form and its `.0`, which must be read as numbers before the dots are taken for separators. */
const SCIENTIFIC = /^[0-9]{1,20}(?:\.[0-9]{1,20})?[eE]\+?[0-9]{1,2}$/;
const DOT_ZERO = /^[0-9]{6,20}\.0{1,6}$/;
/**
 * Zeros a scientific number in text may need beyond the digits it shows: none. Excel writes a CSV as it displays the
 * cells, and its General format shows a whole number of up to eleven digits in full, so a phone number in scientific
 * form is one Excel *rounded* for display: `9.6475012346E+12` was 9647501234567, and its last two digits are gone.
 * Rebuilding it with zeros would message whoever owns `9647501234600` (a written-in zero is the right digit one time
 * in ten). Only a number written with every digit it has (`7.501234567E+09`) is read; the rest get the Excel hint.
 * A workbook is different: its XML holds the whole stored double (`whatsappsheet.ts`), so it never comes here.
 */
const MAX_PADDED = 0;

/** A number's digits and whether it was written international (`+`), or why it is not a number at all. */
function phoneText(raw: string): { digits: string; plus: boolean } | Why {
  const s = typeof raw === 'string' ? raw : '';
  const head = s.length > MAX_PHONE_TEXT ? s.slice(0, MAX_PHONE_TEXT) : s;
  let folded = '';
  for (const ch of head) {
    const d = digitOf(ch.codePointAt(0) ?? 0);
    folded += d >= 0 ? String(d) : ch;
  }
  const t = folded.trim();
  if (SCIENTIFIC.test(t) || DOT_ZERO.test(t)) {
    const x = expandNumber(t);
    if (!x) return { why: 'not-a-number' };
    if (x.padded > MAX_PADDED) return { why: 'not-a-number', hint: 'excel-rounded' };
    return { digits: x.digits, plus: false };
  }
  let digits = '';
  let plus = false;
  for (const ch of t) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 48 && c <= 57) {
      if (digits.length >= 20) return { why: 'too-long' };
      digits += ch;
    } else if (isPlus(c)) {
      if (digits || plus) return { why: 'not-a-number' };
      plus = true;
    } else if (!isSeparator(c)) {
      return { why: 'not-a-number' };
    }
  }
  // More text than any number is, all of it digits and spacing: too long. (With a letter in it, the loop said so.)
  if (s.length > MAX_PHONE_TEXT) return { why: digits.length > 15 ? 'too-long' : 'not-a-number' };
  if (!digits) return { why: plus ? 'not-a-number' : 'empty' };
  return { digits, plus };
}

/**
 * A digits-only international number split into its country and national number and checked. A `0` straight after
 * the code is the trunk prefix written by habit (`+964 0750…`, `+44 (0)20…`) and is dropped where the country's trunk
 * is `0` — there, no national number starts with one.
 */
function international(digits: string, via: Via): Norm {
  const p = planFor(digits);
  if (!p) return { why: digits.length < 4 ? 'too-short' : 'country-unknown' };
  let nsn = digits.slice(p.code.length);
  if (nsn.length > 1 && nsn[0] === '0' && p.trunk.includes('0')) nsn = nsn.slice(1);
  const why = lengthWhy(p, nsn);
  return why ? { why } : { phone: p.code + nsn, via };
}

/** Bare digits of this length or more may be another country's number written without its `+` (WhatsApp's own form). */
const FOREIGN_MIN = 11;

/**
 * The number, or why not, and how it was recognised. In order:
 *
 *   1. `+…` or `00…` (or `011…` from North America) is international.
 *   2. A trunk prefix (`0750…`) is dropped and the country added.
 *   3. A number already starting with the country code, with a national number of the right length after it, is taken
 *      as it is (`9647501234567`; also `964 0750…`).
 *   4. A national number without its trunk (`750 123 4567`: what Excel leaves when it drops the zero) gets the country.
 *   5. Bare digits too long to be national here but a valid number of another country with its code in front
 *      (`447911123456` in an Iraqi list) are that number: lists exported from WhatsApp tools are written exactly so.
 *      Not when they look like a home number with one digit too many (`homeTypo`): that is a typo, not a foreigner.
 *   6. Otherwise the most telling reason: the trunk reading's, else the country-code reading's, else the national one's.
 */
function normalise(raw: string, country: string): Norm {
  const t = phoneText(raw);
  if ('why' in t) return t;
  const digits = t.digits;
  if (t.plus) return international(digits.startsWith('00') ? digits.slice(2) : digits, 'plus');
  if (digits.startsWith('00') && digits.length > 5) return international(digits.slice(2), 'plus');
  if (country === '1' && digits.startsWith('011') && digits.length > 6) return international(digits.slice(3), 'plus');
  const home = PLANS.get(country);
  if (!home) return { why: 'country-unknown' };
  let first: InvalidWhy | null = null;
  for (const tp of home.trunk) {
    if (digits.length <= tp.length || !digits.startsWith(tp)) continue;
    const nsn = digits.slice(tp.length);
    const why = lengthWhy(home, nsn);
    if (!why) return { phone: home.code + nsn, via: 'trunk' };
    first ??= why;
  }
  let coded: InvalidWhy | null = null;
  if (digits.startsWith(home.code) && digits.length > home.code.length + 3) {
    let nsn = digits.slice(home.code.length);
    if (nsn.length > 1 && nsn[0] === '0' && home.trunk.includes('0')) nsn = nsn.slice(1);
    coded = lengthWhy(home, nsn);
    if (!coded) return { phone: home.code + nsn, via: 'code' };
  }
  // Where the trunk is 0, no national number starts with 0: a zero-led number that failed above is not a bare one.
  const zeroLed = digits[0] === '0' && home.trunk.includes('0');
  first ??= coded;
  if (!zeroLed) {
    const why = lengthWhy(home, digits);
    if (!why) return { phone: home.code + digits, via: 'bare' };
    first ??= why;
    if (digits.length >= FOREIGN_MIN && !homeTypo(home, digits)) {
      const f = international(digits, 'foreign');
      if ('phone' in f) return f;
    }
  }
  return { why: first ?? 'not-a-number' };
}

/** The calling code an option names, as digits (`+964`, `00964` and `964` are the same), or '' when it names none. */
function codeOption(raw: unknown): string {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  let d = '';
  for (const ch of String(raw).slice(0, 12)) {
    const v = digitOf(ch.codePointAt(0) ?? 0);
    if (v >= 0) d += String(v);
  }
  if (d.startsWith('00')) d = d.slice(2);
  return d.slice(0, 4);
}

/** A number as WhatsApp writes it (digits, country code first), or why it is not one. */
export function normalisePhone(raw: string, country: string): { phone: string } | { why: InvalidWhy } {
  const n = normalise(typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : '', codeOption(country));
  return 'phone' in n ? { phone: n.phone } : { why: n.why };
}

/**
 * `+964 750 *** 4567`: enough to recognise, not enough to copy. Split at the real calling code (so `+90 532 *** 4567`,
 * not `+905 321 …`), and at least three digits are always hidden, however short the number.
 */
export function maskPhone(phone: string): string {
  const d = typeof phone === 'string' ? phone.replace(/[^0-9]/g, '') : '';
  if (d.length < 7 || d.length > 15) return '***';
  const code = planFor(d)?.code ?? d.slice(0, 3);
  const nsn = d.slice(code.length);
  let head = nsn.length >= 9 ? 3 : 2;
  const tail = nsn.length >= 10 ? 4 : nsn.length >= 8 ? 3 : 2;
  while (head > 0 && nsn.length - head - tail < 3) head--;
  if (nsn.length - head - tail < 3) return `+${code} ***`;
  return `+${code} ${head ? `${nsn.slice(0, head)} ` : ''}*** ${nsn.slice(-tail)}`;
}

// ── the countries a person picks from ─────────────────────────────────────

/** An emoji flag from a two-letter code: two regional-indicator letters. */
const flagOf = (iso: string): string => String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

const C = (iso: string, code: string, en: string, ar: string, ckb: string, kmr: string): Country =>
  ({ iso, code, name: { en, ar, ckb, kmr }, flag: flagOf(iso) });

/**
 * The countries the picker offers, the most likely first: Iraq, its neighbours and the Gulf, then where the diaspora
 * lives, then the rest of the region and the countries a shop's workers and suppliers come from. Any other country's
 * number still reads when it is written with its `+`: `CALLING_CODES` knows them all.
 */
export const COUNTRIES: readonly Country[] = [
  C('IQ', '964', 'Iraq', 'العراق', 'عێراق', 'عیراق'),
  C('TR', '90', 'Türkiye', 'تركيا', 'تورکیا', 'تورکیا'),
  C('IR', '98', 'Iran', 'إيران', 'ئێران', 'ئیران'),
  C('SY', '963', 'Syria', 'سوريا', 'سووریا', 'سووریا'),
  C('SA', '966', 'Saudi Arabia', 'السعودية', 'سعودیە', 'سعودیە'),
  C('AE', '971', 'United Arab Emirates', 'الإمارات', 'ئیمارات', 'ئیمارات'),
  C('KW', '965', 'Kuwait', 'الكويت', 'کوەیت', 'کوەیت'),
  C('JO', '962', 'Jordan', 'الأردن', 'ئوردن', 'ئوردن'),
  C('LB', '961', 'Lebanon', 'لبنان', 'لوبنان', 'لوبنان'),
  C('EG', '20', 'Egypt', 'مصر', 'میسر', 'میسر'),
  C('QA', '974', 'Qatar', 'قطر', 'قەتەر', 'قەتەر'),
  C('BH', '973', 'Bahrain', 'البحرين', 'بەحرەین', 'بەحرەین'),
  C('OM', '968', 'Oman', 'عُمان', 'عومان', 'عومان'),
  C('YE', '967', 'Yemen', 'اليمن', 'یەمەن', 'یەمەن'),
  C('DE', '49', 'Germany', 'ألمانيا', 'ئەڵمانیا', 'ئەلمانیا'),
  C('SE', '46', 'Sweden', 'السويد', 'سوید', 'سوید'),
  C('GB', '44', 'United Kingdom', 'المملكة المتحدة', 'بەریتانیا', 'بەریتانیا'),
  C('US', '1', 'United States & Canada', 'الولايات المتحدة وكندا', 'ئەمریکا و کەنەدا', 'ئەمریکا و کەنەدا'),
  C('NL', '31', 'Netherlands', 'هولندا', 'هۆڵەندا', 'هولەندا'),
  C('FR', '33', 'France', 'فرنسا', 'فەرەنسا', 'فەرەنسا'),
  C('AT', '43', 'Austria', 'النمسا', 'نەمسا', 'نەمسا'),
  C('CH', '41', 'Switzerland', 'سويسرا', 'سویسرا', 'سویسرا'),
  C('NO', '47', 'Norway', 'النرويج', 'نەرویج', 'نەرویج'),
  C('DK', '45', 'Denmark', 'الدنمارك', 'دانیمارک', 'دانیمارک'),
  C('FI', '358', 'Finland', 'فنلندا', 'فینلەندا', 'فینلەندا'),
  C('BE', '32', 'Belgium', 'بلجيكا', 'بەلجیکا', 'بەلجیکا'),
  C('IT', '39', 'Italy', 'إيطاليا', 'ئیتاڵیا', 'ئیتالیا'),
  C('ES', '34', 'Spain', 'إسبانيا', 'ئیسپانیا', 'ئیسپانیا'),
  C('GR', '30', 'Greece', 'اليونان', 'یۆنان', 'یونان'),
  C('CY', '357', 'Cyprus', 'قبرص', 'قوبرس', 'قوبرس'),
  C('RU', '7', 'Russia & Kazakhstan', 'روسيا وكازاخستان', 'ڕووسیا و کازاخستان', 'ڕووسیا و کازاخستان'),
  C('AM', '374', 'Armenia', 'أرمينيا', 'ئەرمەنستان', 'ئەرمەنستان'),
  C('GE', '995', 'Georgia', 'جورجيا', 'جۆرجیا', 'جۆرجیا'),
  C('AZ', '994', 'Azerbaijan', 'أذربيجان', 'ئازەربایجان', 'ئازەربایجان'),
  C('PS', '970', 'Palestine', 'فلسطين', 'فەلەستین', 'فەلەستین'),
  C('LY', '218', 'Libya', 'ليبيا', 'لیبیا', 'لیبیا'),
  C('TN', '216', 'Tunisia', 'تونس', 'تونس', 'تونس'),
  C('DZ', '213', 'Algeria', 'الجزائر', 'جەزائیر', 'جەزائیر'),
  C('MA', '212', 'Morocco', 'المغرب', 'مەغریب', 'مەغریب'),
  C('SD', '249', 'Sudan', 'السودان', 'سودان', 'سودان'),
  C('AF', '93', 'Afghanistan', 'أفغانستان', 'ئەفغانستان', 'ئەفغانستان'),
  C('PK', '92', 'Pakistan', 'باكستان', 'پاکستان', 'پاکستان'),
  C('IN', '91', 'India', 'الهند', 'هیندستان', 'هندستان'),
  C('BD', '880', 'Bangladesh', 'بنغلاديش', 'بەنگلادیش', 'بەنگلادیش'),
  C('PH', '63', 'Philippines', 'الفلبين', 'فلیپین', 'فلیپین'),
  C('ID', '62', 'Indonesia', 'إندونيسيا', 'ئیندۆنیزیا', 'ئیندونیزیا'),
  C('AU', '61', 'Australia', 'أستراليا', 'ئوسترالیا', 'ئوسترالیا'),
  C('PL', '48', 'Poland', 'بولندا', 'پۆڵەندا', 'پولەندا'),
  C('UA', '380', 'Ukraine', 'أوكرانيا', 'ئۆکرانیا', 'ئوکرانیا'),
  C('CN', '86', 'China', 'الصين', 'چین', 'چین'),
  C('MY', '60', 'Malaysia', 'ماليزيا', 'مالیزیا', 'مالیزیا'),
];

/**
 * The calling code a person using this interface language most likely means. All four of the app's languages are
 * spoken by its people in Iraq first — Arabic, Sorani, Badini, and English by the same shopkeepers — so it is `964`
 * for each; the picker is one tap away and the choice is remembered by the screens.
 */
export function countryForLang(lang: Lang): string {
  switch (lang) {
    case 'ar': case 'ckb': case 'kmr': case 'en':
    default: return '964';
  }
}

// ── reading bytes as text ─────────────────────────────────────────────────

/**
 * UTF-16 without a byte-order mark, told by where its NULs fall: Latin text, digits and spaces in UTF-16 have a NUL in
 * every other byte (the second in little-endian, the first in big-endian). Arabic letters do not, but the digits,
 * spaces and commas of a list of numbers do.
 */
function utf16Guess(b: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const n = Math.min(b.length, 8192) >> 1;
  let even = 0;
  let odd = 0;
  for (let i = 0; i < n; i++) {
    if (b[2 * i] === 0) even++;
    if (b[2 * i + 1] === 0) odd++;
  }
  if (odd && odd * 8 >= n && even * 8 <= odd) return 'utf-16le';
  if (even && even * 8 >= n && odd * 8 <= even) return 'utf-16be';
  return null;
}

const isAsciiLetter = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

/**
 * Which legacy code page a file that is not UTF-8 is in: Windows-1256 (what Excel's "CSV" gives Arabic and Kurdish on
 * Windows) or Windows-1254 (Turkish). In Arabic every letter is a high byte, so high bytes sit beside other high bytes
 * and spaces; in Turkish the high bytes are the odd ş or ğ inside otherwise ASCII words. A default country of Türkiye
 * leans the call that way.
 */
function legacyCodePage(b: Uint8Array, country: string): 'windows-1256' | 'windows-1254' {
  let high = 0;
  let latin = 0;
  for (let i = 0; i < b.length && high < 4000; i++) {
    if (b[i] < 0x80) continue;
    high++;
    if (isAsciiLetter(b[i - 1] ?? 0) || isAsciiLetter(b[i + 1] ?? 0)) latin++;
  }
  return high && latin / high > (country === '90' ? 0.3 : 0.5) ? 'windows-1254' : 'windows-1256';
}

/**
 * A file's bytes as text: by its byte-order mark; else UTF-16 by its NULs; else strictly UTF-8; else the legacy Arabic
 * or Turkish code page. `null` when what comes out is not text (a picture, a PDF, an archive).
 */
function decodeBytes(b: Uint8Array, country: string): string | null {
  let enc: string | null = null;
  let from = 0;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) { enc = 'utf-8'; from = 3; }
  else if (b[0] === 0xff && b[1] === 0xfe) { enc = 'utf-16le'; from = 2; }
  else if (b[0] === 0xfe && b[1] === 0xff) { enc = 'utf-16be'; from = 2; }
  else enc = utf16Guess(b);
  const body = from ? b.subarray(from) : b;
  let text: string | null = null;
  if (enc) {
    try { text = new TextDecoder(enc).decode(body); } catch { return null; }
  } else {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(body); } catch { /* not UTF-8: a legacy code page */ }
    if (text === null) {
      try { text = new TextDecoder(legacyCodePage(body, country)).decode(body); } catch { text = new TextDecoder().decode(body); }
    }
  }
  return looksBinary(text) ? null : text;
}

/** Text with more than a sliver of control characters or replacement marks in its first 64 KB is not text. */
function looksBinary(text: string): boolean {
  if (text.startsWith('%PDF')) return true;
  const n = Math.min(text.length, 65_536);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12) || c === 0xfffd) bad++;
  }
  return bad > 4 && bad * 50 > n;
}

/** Text cut at the last line break before `max`, so a cut never splits a line (or a character). */
function cutText(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  const nl = text.lastIndexOf('\n', max);
  return { text: text.slice(0, nl > 0 ? nl : max), cut: true };
}

// ── collecting people ─────────────────────────────────────────────────────

/**
 * Where every reader puts what it finds. The first of a number wins and later ones are counted, not kept; a new
 * number past `LIMITS.recipients` stops the reading (`truncated`); rejected and warned lines are listed up to a
 * thousand and counted past it, so a file of junk costs a counter rather than an object per line.
 */
class Collector {
  readonly recipients: Recipient[] = [];
  readonly rejected: Rejected[] = [];
  readonly warned: Warned[] = [];
  duplicates = 0;
  rejectedMore = 0;
  truncated = false;
  private readonly seen = new Set<string>();

  add(r: Recipient, line: number): void {
    if (this.seen.has(r.phone)) { this.duplicates++; return; }
    if (this.recipients.length >= LIMITS.recipients) { this.truncated = true; return; }
    this.seen.add(r.phone);
    this.recipients.push(r);
    if (mobileShape(r.phone) === false && this.warned.length < MAX_WARNED) this.warned.push({ line, phone: r.phone, why: 'not-mobile' });
  }

  reject(line: number, raw: string, why: InvalidWhy, hint?: 'excel-rounded'): void {
    if (this.rejected.length >= MAX_REJECTED) { this.rejectedMore++; return; }
    const r: Rejected = { line, raw: clean(raw, LIMITS.valueChars), why };
    if (hint) r.hint = hint;
    this.rejected.push(r);
  }
}

interface Shape { columns: string[]; phoneColumn: string | null; nameColumn: string | null }
const NO_SHAPE: Shape = { columns: [], phoneColumn: null, nameColumn: null };

function finish(format: SourceFormat, country: string, col: Collector, shape: Shape, file: string | undefined, cut: boolean): Parsed {
  const p: Parsed = {
    format, recipients: col.recipients, rejected: col.rejected, duplicates: col.duplicates,
    columns: shape.columns, phoneColumn: shape.phoneColumn, nameColumn: shape.nameColumn, defaultCountry: country,
  };
  if (col.truncated || cut) p.truncated = true;
  if (col.warned.length) p.warned = col.warned;
  if (col.rejectedMore) p.rejectedMore = col.rejectedMore;
  if (file) p.file = file;
  return p;
}

/** A whole file that could not be read: no people, the problem, and one rejected line saying so. */
function failed(format: SourceFormat, country: string, problem: FileProblem, file: string | undefined): Parsed {
  const p: Parsed = {
    format, recipients: [], rejected: [{ line: 1, raw: file ?? '', why: problem === 'empty' ? 'empty' : 'not-a-number' }],
    duplicates: 0, columns: [], phoneColumn: null, nameColumn: null, defaultCountry: country, problem,
  };
  if (file) p.file = file;
  return p;
}

// ── header words, in six languages and two scripts ────────────────────────

/** Letters folded together so that the same word typed on an Arabic, a Persian or a Kurdish keyboard is one word. */
const FOLD = new Map<number, number>([
  [0x6d5, 0x647], // Kurdish ە → ه
  [0x629, 0x647], // ة → ه
  [0x6be, 0x647], // ھ → ه
  [0x6c1, 0x647], // ہ → ه
  [0x649, 0x64a], // ى → ي
  [0x6cc, 0x64a], // Persian ی → ي
  [0x6ce, 0x64a], // Kurdish ێ → ي
  [0x6a9, 0x643], // Persian ک → ك
  [0x6c6, 0x648], // Kurdish ۆ → و
  [0x6b5, 0x644], // Kurdish ڵ → ل
  [0x695, 0x631], // Kurdish ڕ → ر
  [0x6a4, 0x641], // Kurdish ڤ → ف
  [0x131, 0x69], // Turkish ı → i
]);

/**
 * A header folded to its words: decomposed so accents and Arabic vowel marks fall away (é → e, أ → ا, İ → i),
 * keyboard variants joined (`FOLD`), the tatweel dropped, lower case, split at everything that is not a letter or a digit.
 */
function foldWords(s: string): string[] {
  let out = '';
  for (const ch of s.slice(0, 80).normalize('NFKD')) {
    const c = ch.codePointAt(0) ?? 0;
    if ((c >= 0x300 && c <= 0x36f) || (c >= 0x610 && c <= 0x61a) || (c >= 0x64b && c <= 0x65f) || c === 0x670
      || (c >= 0x6d6 && c <= 0x6ed) || c === 0x640) continue;
    out += String.fromCodePoint(FOLD.get(c) ?? c);
  }
  return out.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 8);
}

/** A word and the forms it takes with the Arabic article, or with a Kurdish izafe or Badini ending on it. */
function variants(w: string): string[] {
  const out = [w];
  if (w.length > 3 && w.startsWith('ال')) out.push(w.slice(2));
  if (w.length > 3 && (w.endsWith('ي') || w.endsWith('ا'))) out.push(w.slice(0, -1));
  return out;
}

const wordSet = (...lists: string[]): Set<string> => new Set(lists.join(' ').split(' ').flatMap(foldWords));

/** Words that make a header a phone column. Whole words only: `tel` is not `hotel`. */
const PHONE_WORDS = wordSet(
  'phone phones telephone tel tele mobile mob cell cellphone cellular whatsapp msisdn number numbers gsm',
  'هاتف تلفون تليفون جوال موبايل محمول نقال واتساب واتس رقم ارقام',
  'ژمارە ژمارا تەلەفۆن تەلەفون مۆبایل موبایل واتساپ',
  'telefon telefonu tel cep numara numarası',
  'hejmar hejmara jimar jimare jimara mobîl',
  'تلفن شماره همراه',
  'telefonnummer handy mobilnummer rufnummer nummer mobil téléphone portable numéro telefono',
);
/** Words that make a header the name column. */
const NAME_WORDS = wordSet(
  'name names fullname customer customers client clients person contact',
  'اسم الاسم الإسم عميل العميل زبون الزبون',
  'ناو ناڤ کڕیار کریار',
  'nav navê xerîdar',
  'ad adı isim ismi adsoyad müşteri',
  'نام مشتری',
  'namn nom kunde kund',
);
/** Words that alone say "first name" or "last name". */
const FIRST_ONLY = wordSet('firstname givenname forename vorname förnamn prénom');
const LAST_ONLY = wordSet('surname lastname familyname nachname efternamn soyad soyadı soyisim پاشناو پاشناڤ paşnav کنیه الكنية اللقب خانوادگی');
/** Words that say "first" or "last" when a name word stands beside them (`First name`, `اسم العائلة`, `ناوی یەکەم`). */
const FIRST_WITH = wordSet('first given الأول اول یەکەم');
const LAST_WITH = wordSet('last family العائلة عائلة خێزان');

/**
 * Labels that say the number beside them is something else — an order, an invoice, an account, a price, a code — in
 * the same languages as the header words. In running text a number right after one of these is not a phone number,
 * however much it looks like one (`Order 7501234567`, `رقم الطلب 07501234567`).
 */
const FIELD_WORDS = wordSet(
  'order orders invoice inv bill receipt ref reference account acct iban swift serial sn id ids tracking awb shipment parcel',
  'total subtotal amount price cost qty quantity sum balance fee tax vat code pin otp barcode sku ean upc isbn imei model version ip date year postcode zip passport',
  'طلب فاتورة حساب مبلغ سعر مجموع رمز كود باركود تاريخ هوية وصل ايصال',
  'داواکاری پسوولە حیساب بڕ نرخ کۆی کۆد بەروار ناسنامە',
  'sipariş siparis fatura hesap tutar fiyat toplam kod tarih',
  'سفارش فاکتور قیمت جمع کد تاریخ',
);
/** Currencies written after an amount: `12 500 000 IQD`, `25.000.000 دينار`. */
const CURRENCY_WORDS = wordSet('iqd usd eur try irr sar aed kwd jod lbp egp sek gbp tl dollar dollars dinar dinars euro euros lira riyal dirham toman rial',
  'دينار دولار ريال درهم ليرة تومان دینار دۆلار');
/** "Number" itself, in every language: a phone word only when nothing more specific stands beside it. */
const NUMBER_WORDS = wordSet('number numbers رقم ارقام ژمارە ژمارا hejmar hejmara jimar jimare jimara numara numarası شماره nummer numéro');

type Kind = 'phone' | 'name' | 'first' | 'last';

/** What a header says its column holds, in English, Arabic, Sorani, Badini (both scripts), Turkish, Persian and a few European languages. */
function kindOf(header: string): Kind | null {
  if (!header || header.length > 60) return null;
  const words = foldWords(header);
  if (!words.length) return null;
  const has = (set: Set<string>): boolean => words.some((w) => variants(w).some((v) => set.has(v)));
  if (has(PHONE_WORDS)) return 'phone';
  const name = has(NAME_WORDS);
  if (has(LAST_ONLY) || (name && has(LAST_WITH))) return 'last';
  if (has(FIRST_ONLY) || (name && has(FIRST_WITH))) return 'first';
  return name ? 'name' : null;
}

// ── tables: csv, tsv, a pasted spreadsheet, a workbook ────────────────────

interface Row { line: number; cells: string[] }

/** One field, capped. */
const grow = (field: string, piece: string): string =>
  field.length >= MAX_FIELD ? field : field + (piece.length > MAX_FIELD - field.length ? piece.slice(0, MAX_FIELD - field.length) : piece);

/**
 * RFC 4180, one character at a time: a field that starts with `"` runs to the next lone `"`, `""` inside it is a quote,
 * and it may hold the delimiter and line breaks. A row's line is where it began. A quote that never closes would
 * swallow the rest of the file, so when one reaches the end, that row is read again with quotes as plain characters —
 * and so is everything after it, which keeps the whole read to at most two passes.
 */
function parseDelimited(text: string, delim: string, maxRows: number): { rows: Row[]; cut: boolean } {
  const rows: Row[] = [];
  const n = text.length;
  const d = delim ? delim.charCodeAt(0) : -1;
  let quotes = true;
  let i = 0;
  let line = 1;
  while (i < n) {
    if (rows.length >= maxRows) return { rows, cut: true };
    const rowStart = i;
    const rowLine = line;
    const cells: string[] = [];
    let field = '';
    let from = i;
    let fresh = true;
    let quoted = false;
    let ended = false;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (quoted) {
        if (c === 34) {
          if (text.charCodeAt(i + 1) === 34) { field = grow(field, text.slice(from, i + 1)); i += 2; from = i; continue; }
          field = grow(field, text.slice(from, i));
          quoted = false;
          from = ++i;
          continue;
        }
        if (c === 10) line++;
        i++;
        continue;
      }
      if (c === 34 && fresh && quotes) { quoted = true; fresh = false; from = ++i; continue; }
      fresh = false;
      if (c === d) {
        if (cells.length < MAX_COLS) cells.push(grow(field, text.slice(from, i)));
        field = '';
        from = ++i;
        fresh = true;
        continue;
      }
      if (c === 10 || c === 13) {
        if (cells.length < MAX_COLS) cells.push(grow(field, text.slice(from, i)));
        i += c === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
        line++;
        ended = true;
        break;
      }
      i++;
    }
    if (!ended) {
      if (quoted) { quotes = false; i = rowStart; line = rowLine; continue; }
      if (cells.length < MAX_COLS) cells.push(grow(field, text.slice(from, i)));
    }
    rows.push({ line: rowLine, cells });
  }
  return { rows, cut: false };
}

const blankRow = (r: Row): boolean => r.cells.every((c) => !c.trim());

/**
 * The delimiter a text is written with, found by looking: the one that splits the most of the first rows into the
 * same number of fields (two or more). `null` when none does well enough — a list of single numbers, or prose.
 */
function delimiterOf(text: string, strict: boolean): string | null {
  const sample = cutText(text, 65_536).text;
  let best: { d: string; share: number; width: number } | null = null;
  for (const d of [',', ';', '\t', '|']) {
    if (!sample.includes(d)) continue;
    const rows = parseDelimited(sample, d, 40).rows.filter((r) => !blankRow(r));
    if (rows.length < (strict ? 2 : 1)) continue;
    const counts = new Map<number, number>();
    for (const r of rows) counts.set(r.cells.length, (counts.get(r.cells.length) ?? 0) + 1);
    let width = 0;
    let most = 0;
    for (const [w, k] of counts) if (k > most || (k === most && w > width)) { width = w; most = k; }
    const share = most / rows.length;
    if (width < 2 || share < (strict ? 0.8 : 0.6)) continue;
    if (!best || share > best.share || (share === best.share && width > best.width)) best = { d, share, width };
  }
  if (best) return best.d;
  // A file that says it is a CSV and whose rows are ragged (a notes column filled on some rows, a trailing comma
  // dropped on others) is still a table: its header row's delimiter, when it has one. Without this it was read as
  // free text and lost its header, its names and its columns.
  if (strict) return null;
  const head = sample.split(/\r?\n/, 50).find((l) => l.trim()) ?? '';
  let most = 0;
  let pick: string | null = null;
  for (const d of [',', ';', '\t', '|']) {
    const k = head.split(d).length - 1;
    if (k > most) { most = k; pick = d; }
  }
  return pick;
}

/** Whether a cell holds a number this reads, for guessing columns. */
const validIn = (cell: string, country: string): boolean => !!cell && 'phone' in normalise(cell, country);
/** …and a mobile one, for choosing between a phone and a mobile column. */
function mobileIn(cell: string, country: string): boolean {
  const n = cell ? normalise(cell, country) : null;
  return !!n && 'phone' in n && mobileShape(n.phone) === true;
}

/** The first valid number written anywhere in a cell (`Tel: 0750 123 4567`, `0750… / 0770…`). */
function firstIn(cell: string, country: string): Norm | null {
  for (const s of spansIn(cell)) {
    if (s.digits < 7) continue;
    const n = normalise(cell.slice(s.start, s.end), country);
    if ('phone' in n) return n;
  }
  return null;
}

/**
 * A table read as people. Returns `null` when the text is better read as free text: a table with no header whose
 * numbers sit in more than one column (`0750…, 0770…, 0780…` on every line) is a list of numbers, not a table, and
 * picking one column would drop the rest.
 */
function readTable(all: Row[], o: { phoneColumn?: string; nameColumn?: string }, country: string, col: Collector, strict: boolean): Shape | null {
  const rows = all.filter((r) => !blankRow(r));
  if (!rows.length) return null;

  // The header: the first of the first ten rows that names a phone column (rows above it are a title, and a title
  // such as "Customer list" may hold a header word of its own); else the first that names any column we know; else a
  // first row with no number in it when the rows under it have numbers. A row holding a number is data, whatever words
  // are beside it ("Name 1, 0750…").
  const top = rows.slice(0, 10).map((r) => (r.cells.some((c) => validIn(c, country)) ? [] : r.cells.map((c) => kindOf(c.trim()))));
  let headerAt = top.findIndex((k) => k.includes('phone'));
  if (headerAt < 0) headerAt = top.findIndex((k) => k.some((x) => x !== null));
  if (headerAt < 0) {
    const first = rows[0].cells;
    const below = rows.slice(1, 6);
    if (!first.some((c) => validIn(c, country)) && first.some((c) => LETTER.test(c)) && below.some((r) => r.cells.some((c) => validIn(c, country)))) headerAt = 0;
  }
  const header = headerAt >= 0 ? rows[headerAt].cells : [];
  const body = rows.slice(headerAt + 1);
  let width = header.length;
  for (const r of body) if (r.cells.length > width) width = r.cells.length;
  width = Math.min(width, MAX_COLS);

  const columns: string[] = [];
  const taken = new Set<string>();
  for (let i = 0; i < width; i++) {
    let k = keyOf(header[i] ?? '', i);
    for (let n = 2; taken.has(k.toLowerCase()); n++) k = `${keyOf(header[i] ?? '', i).slice(0, MAX_KEY - 3)} ${n}`;
    taken.add(k.toLowerCase());
    columns.push(k);
  }
  const kinds = columns.map((_, i) => (headerAt >= 0 ? kindOf((header[i] ?? '').trim()) : null));

  // How many of the first rows hold a valid number, and a mobile, column by column.
  const sample = body.slice(0, 300);
  const valid = columns.map((_, i) => sample.reduce((s, r) => s + (validIn(r.cells[i] ?? '', country) ? 1 : 0), 0));
  const mobiles = columns.map((_, i) => sample.reduce((s, r) => s + (mobileIn(r.cells[i] ?? '', country) ? 1 : 0), 0));
  const findColumn = (want: string | undefined): number => {
    if (typeof want !== 'string') return -2;
    const w = want.trim().toLowerCase();
    return w ? columns.findIndex((c) => c.toLowerCase() === w) : -1;
  };

  if (headerAt < 0 && sample.length && valid.filter((v) => v * 2 >= sample.length).length > 1) return null;

  const chosen = findColumn(o.phoneColumn);
  let phoneAt = chosen;
  if (phoneAt < 0) {
    phoneAt = -1;
    // A column whose header says phone wins when it holds any number at all — of several (`Phone`, `Mobile`), the one
    // with the most mobiles, then the most numbers: WhatsApp is on the mobile. Otherwise the column with the most
    // numbers. And when nothing in the first rows reads at all, still the column whose header says phone: its rows are
    // reported one by one and the rest of the file is read, where another column would turn everyone away.
    let best = [0, 0];
    kinds.forEach((k, i) => {
      if (k === 'phone' && valid[i] > 0 && (mobiles[i] > best[0] || (mobiles[i] === best[0] && valid[i] > best[1]))) { best = [mobiles[i], valid[i]]; phoneAt = i; }
    });
    let most = 0;
    if (phoneAt < 0) valid.forEach((v, i) => { if (v > most) { most = v; phoneAt = i; } });
    if (phoneAt < 0) phoneAt = kinds.indexOf('phone');
  }
  // The row's other phone columns, read when the chosen one is empty or wrong, or holds a landline beside a mobile.
  // Not when the person chose the column: then it is that column.
  const others = chosen >= 0 ? [] : kinds.flatMap((k, i) => (k === 'phone' && i !== phoneAt ? [i] : []));
  if (phoneAt < 0) {
    // Nothing reads as a number. In free text that means "not a table"; in a CSV, the rows are reported against the
    // column that looks most like numbers, so the person sees what was wrong with them.
    if (strict) return null;
    let most = -1;
    columns.forEach((_, i) => {
      const digity = sample.reduce((s, r) => s + (/[0-9\u{660}-\u{669}\u{6f0}-\u{6f9}]{5}/u.test((r.cells[i] ?? '').replace(/[\s\-.()]/g, '')) ? 1 : 0), 0);
      if (digity > most) { most = digity; phoneAt = i; }
    });
  }
  if (strict && headerAt < 0 && valid[phoneAt] * 2 < sample.length) return null;

  // The name: a chosen column; a header that says name; a first and a last name to join; or the column of words.
  let nameAt = findColumn(o.nameColumn);
  let lastAt = -1;
  if (nameAt === -2) {
    nameAt = kinds.findIndex((k, i) => k === 'name' && i !== phoneAt);
    if (nameAt < 0) {
      nameAt = kinds.findIndex((k, i) => k === 'first' && i !== phoneAt);
      lastAt = kinds.findIndex((k, i) => k === 'last' && i !== phoneAt);
      if (nameAt < 0) { nameAt = lastAt; lastAt = -1; }
    }
    if (nameAt < 0) {
      let best = 0.6;
      columns.forEach((_, i) => {
        if (i === phoneAt || kinds[i] === 'phone') return;
        let filled = 0;
        let words = 0;
        for (const r of sample) {
          const c = (r.cells[i] ?? '').trim();
          if (!c) continue;
          filled++;
          if (c.length <= 60 && LETTER.test(c) && !/[0-9]{3}/.test(c)) words++;
        }
        if (filled && words / filled > best) { best = words / filled; nameAt = i; }
      });
    }
  }

  // Everything else the file has, as variables for the message: the first `LIMITS.columns` columns with anything in them.
  const varAt: number[] = [];
  for (let i = 0; i < width && varAt.length < LIMITS.columns; i++) {
    if (i === phoneAt || i === nameAt || i === lastAt) continue;
    if (body.slice(0, 2000).some((r) => (r.cells[i] ?? '').trim())) varAt.push(i);
  }
  const varKey = varAt.map((i) => {
    const k = columns[i];
    // `{name}` and `{first_name}` are the engine's own; a column that happens to be called that is renamed.
    return /^(name|first_name|phone)$/i.test(k) ? `${k} 2` : k;
  });

  const readCell = (raw: string): Norm => {
    const c = raw.trim();
    const n = normalise(c, country);
    return 'phone' in n || !c ? n : firstIn(c, country) ?? n;
  };
  for (const r of body) {
    if (col.truncated) break;
    const cell = (r.cells[phoneAt] ?? '').trim();
    let n: Norm = readCell(cell);
    for (const i of others) {
      if ('phone' in n && mobileShape(n.phone) !== false) break;
      const m = readCell(r.cells[i] ?? '');
      if ('phone' in m && (!('phone' in n) || mobileShape(m.phone) !== false)) n = m;
    }
    if (!('phone' in n)) {
      col.reject(r.line, cell || r.cells.map((c) => c.trim()).filter(Boolean).join(', '), n.why, n.hint);
      continue;
    }
    const nameText = lastAt >= 0
      ? `${(r.cells[nameAt] ?? '').trim()} ${(r.cells[lastAt] ?? '').trim()}`
      : nameAt >= 0 ? r.cells[nameAt] ?? '' : '';
    const vars: Record<string, string> = {};
    varAt.forEach((i, k) => {
      const v = clean(r.cells[i] ?? '', LIMITS.valueChars);
      if (v) vars[varKey[k]] = v;
    });
    const person: Recipient = { phone: n.phone, vars };
    const name = nameFrom(nameText);
    if (name) person.name = name;
    col.add(person, r.line);
  }
  return { columns, phoneColumn: columns[phoneAt] ?? null, nameColumn: nameAt >= 0 ? columns[nameAt] ?? null : null };
}

// ── free text: a pasted list, a notes file, a chat export, an email ──────

interface Span { start: number; end: number; digits: number }

/** Separators allowed inside one number in running text; a tab, a comma or a semicolon ends it. */
const isRunSeparator = (c: number): boolean => c !== 9 && c !== 10 && c !== 13 && (isSpace(c) || isInvisible(c) || isPhonePunct(c)) && c !== 47 && c !== 91 && c !== 93;

/**
 * Every phone-like run in a line, in one pass: a `+` or a digit, then digits with at most three separator characters
 * between groups. A run glued to a word (`INV20240512`, `12kg`) is an identifier and is skipped. Nothing here can
 * backtrack: each character is looked at a bounded number of times, so five megabytes of `0000…` is one long run,
 * read once.
 */
function spansIn(line: string): Span[] {
  const out: Span[] = [];
  const n = line.length;
  let i = 0;
  while (i < n && out.length <= LIMITS.recipients) {
    const c = line.charCodeAt(i);
    const plus = isPlus(c);
    if (!plus && digitOf(c) < 0) { i++; continue; }
    const start = i;
    let end = i + 1;
    let digits = plus ? 0 : 1;
    let seps = 0;
    let j = i + 1;
    for (; j < n; j++) {
      const k = line.charCodeAt(j);
      if (digitOf(k) >= 0) { digits++; seps = 0; end = j + 1; continue; }
      if (isRunSeparator(k) && ++seps <= 3) continue;
      break;
    }
    i = Math.max(j, start + 1);
    if (!digits) continue;
    if ((start > 0 && isLetter(line.codePointAt(start - 1) ?? 0)) || (end < n && isLetter(line.codePointAt(end) ?? 0))) continue;
    out.push({ start, end, digits });
  }
  return out;
}

/**
 * Whether a run is a date rather than a number: three groups split by the same `-` or `.`, one of them a year
 * (`2024-05-01`, `01.05.2024`, `1-5-24`). Dates with `/` and times with `:` never become runs at all.
 */
function isDate(text: string): boolean {
  const t = text.trim();
  const sep = t.includes('-') ? '-' : t.includes('.') ? '.' : '';
  if (!sep) return false;
  const g = t.split(sep);
  if (g.length !== 3 || g.some((x) => !/^[0-9]{1,4}$/.test(x))) return false;
  const [a, b, c] = g.map((x) => x.length);
  return (a === 4 && b <= 2 && c <= 2) || (a <= 2 && b <= 2 && (c === 4 || c === 2));
}

/** A date at the head of a run (`04.10.2026 10` is a date and the hour after it): a four-digit year, then nothing. */
const DATE_HEAD = /^([0-9]{1,4})([-.])([0-9]{1,2})\2([0-9]{2,4})(?![0-9])/;

/**
 * A run with the date it starts with taken off: what a chat export writes before every message (`04.10.2026 10:19`)
 * ran on into the hour and read as a number with a trunk zero. `null` when nothing is left.
 */
function afterDate(line: string, s: Span): Span | null {
  const m = DATE_HEAD.exec(line.slice(s.start, Math.min(s.end, s.start + 12)));
  if (!m) return s;
  const a = Number(m[1]);
  const b = Number(m[3]);
  const c = Number(m[4]);
  const ymd = m[1].length === 4 && b >= 1 && b <= 12 && m[4].length <= 2 && c >= 1 && c <= 31;
  const dmy = m[4].length === 4 && m[1].length <= 2 && a >= 1 && a <= 31 && b >= 1 && b <= 31 && (a <= 12 || b <= 12);
  if (!ymd && !dmy) return s;
  let i = s.start + m[0].length;
  while (i < s.end && digitOf(line.charCodeAt(i)) < 0) i++;
  let digits = 0;
  for (let k = i; k < s.end; k++) if (digitOf(line.charCodeAt(k)) >= 0) digits++;
  return digits ? { start: i, end: s.end, digits } : null;
}

/** Runs that are numbers of another kind: an IPv4 address, a decimal (`36.191113`, a coordinate), a span of years. */
const IPV4 = /^[0-9]{1,3}(?:\.[0-9]{1,3}){3}$/;
const DECIMAL = /^[1-9][0-9]{0,2}\.[0-9]{4,}$/;
const YEARS = /^(?:19|20)[0-9]{2} ?[-\u{2013}] ?(?:19|20)[0-9]{2}$/u;
const otherNumber = (text: string): boolean => IPV4.test(text) || DECIMAL.test(text) || YEARS.test(text);

/** Signs that the number after them is money or a reference: `$`, `€`, `£`, `₺`, `﷼`, `#`, `№`. */
const MONEY_MARKS = new Set([0x24, 0x20ac, 0xa3, 0x20ba, 0xfdfc, 0x23, 0x2116]);
const isWordChar = (c: number): boolean => isLetter(c) || (c >= 0x300 && c <= 0x36f) || (c >= 0x64b && c <= 0x65f) || c === 0x200c;
const isGap = (c: number): boolean => isSpace(c) || isInvisible(c) || c === 58 || c === 45 || c === 46 || c === 0x2013 || c === 0x2014;
const hasWord = (words: string[], set: Set<string>): boolean => words.some((w) => variants(w).some((v) => set.has(v)));

/**
 * Whether the words beside a run say it is not a phone number: a field label before it (`Order`, `Invoice No:`,
 * `Account:`, `رقم الطلب`) unless a phone word stands with it (`Phone No`, `WhatsApp account`), a `$` or `#` right
 * before it, or a currency right after it (`12 500 000 IQD`). A bounded scan of a few words either side.
 */
function labelledOther(line: string, s: Span): boolean {
  const stop = Math.max(0, s.start - 48);
  let i = s.start - 1;
  while (i >= stop && isGap(line.charCodeAt(i))) i--;
  if (i >= stop && MONEY_MARKS.has(line.charCodeAt(i))) return true;
  const before: string[] = [];
  while (i >= stop && before.length < 3) {
    const e = i + 1;
    while (i >= stop && isWordChar(line.charCodeAt(i))) i--;
    if (i + 1 === e) break;
    before.push(line.slice(i + 1, e));
    while (i >= stop && isGap(line.charCodeAt(i))) i--;
  }
  if (before.length) {
    const words = before.flatMap(foldWords);
    const phone = words.some((w) => variants(w).some((v) => PHONE_WORDS.has(v) && !NUMBER_WORDS.has(v)));
    if (!phone && hasWord(words, FIELD_WORDS)) return true;
  }
  let j = s.end;
  const end = Math.min(line.length, s.end + 24);
  while (j < end && isSpace(line.charCodeAt(j))) j++;
  const from = j;
  while (j < end && isWordChar(line.charCodeAt(j))) j++;
  return j > from && hasWord(foldWords(line.slice(from, j)), CURRENCY_WORDS);
}

/** How a number was found that the free-text reader trusts in a sentence: it says it is a phone number. */
const sure = (f: { phone: string; via: Via }): boolean =>
  f.via === 'plus' || f.via === 'trunk' || f.via === 'code' || (f.via === 'bare' && mobileShape(f.phone) === true);

/** Punctuation and space that may stand at the ends of a label: `Rebaz: `, ` - Rebaz`, `(Rebaz)`. */
const EDGE_CHARS = new Set(',;:|-–—•·*#"\'()[]<>/\\=.'.split('').map((c) => c.charCodeAt(0)));
const isEdge = (c: number): boolean => isSpace(c) || isInvisible(c) || EDGE_CHARS.has(c);

/**
 * `s` without punctuation and space at either end. A hand scan from both ends, not a `/[…]+$/` pattern: that one
 * retries from every position of a long run of dashes and goes quadratic on a hostile line.
 */
function trimEdge(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && isEdge(s.charCodeAt(a))) a++;
  while (b > a && isEdge(s.charCodeAt(b - 1))) b--;
  return a === 0 && b === s.length ? s : s.slice(a, b);
}
/** A run of words: letters, combining marks, the joiners, apostrophes, dots and hyphens — nothing else. */
const WORDS = /^[\p{L}\p{M}][\p{L}\p{M}'’.\- \u{200c}\u{200d}]*$/u;

const isLabel = (s: string): boolean => s.length <= 60 && WORDS.test(s) && s.split(' ').length <= 5;

/** Pieces of one run looked at; a run of more is a wall of digits, not a list (each piece costs a few readings). */
const MAX_PARTS = 4 * LIMITS.recipients;

/**
 * A run with spaces that is too long for one number (`07501234567 07701234567`) split into the numbers in it: from
 * each piece, the longest run of following pieces that reads as a valid number, never across a `+`. Bounded look-ahead,
 * so a line of ten thousand numbers is read in one pass.
 */
function splitRun(text: string, country: string): { found: { phone: string; via: Via; text: string }[]; failed: { text: string; why: InvalidWhy }[] } {
  const parts = text.split(/\s+/, MAX_PARTS).filter(Boolean);
  const found: { phone: string; via: Via; text: string }[] = [];
  const failed: { text: string; why: InvalidWhy }[] = [];
  let i = 0;
  while (i < parts.length && found.length <= LIMITS.recipients) {
    let best: { j: number; n: { phone: string; via: Via } } | null = null;
    let acc = '';
    let why: InvalidWhy = 'not-a-number';
    for (let j = i; j < parts.length && j < i + 8; j++) {
      if (j > i && isPlus(parts[j].charCodeAt(0))) break;
      acc += parts[j];
      if (acc.replace(/[^0-9]/g, '').length > 17) break;
      const n = normalise(acc, country);
      if ('phone' in n) best = { j, n };
      else if (j === i) why = n.why;
    }
    if (best) {
      found.push({ ...best.n, text: parts.slice(i, best.j + 1).join(' ') });
      i = best.j + 1;
    } else {
      if (parts[i].replace(/[^0-9]/g, '').length >= 5) failed.push({ text: parts[i], why });
      i++;
    }
  }
  return { found, failed };
}

/**
 * Text with no table shape, a line at a time. A line is a *list line* when, besides its numbers, it holds only
 * punctuation or a short run of words on one side (`Rebaz, 0750 123 4567`; `0750 123 4567 - Rebaz`); then its numbers
 * are taken, its failures reported, and the words become the name. Any other line is *prose* (a chat export, an
 * email): its numbers are taken only when they say they are phone numbers — written with `+` or `00`, a trunk zero,
 * the country code, or the shape of a mobile here — and nothing in it is reported or named. A sentence never names
 * anybody: preferring a missing name to an invented one.
 */
function readFree(text: string, country: string, col: Collector): boolean {
  const lines = text.split(/\r\n|\r|\n/);
  let cut = lines.length > MAX_LINES;
  for (let li = 0; li < lines.length && li < MAX_LINES; li++) {
    if (col.truncated) break;
    if (lines[li].length > MAX_LINE) cut = true;
    const line = lines[li].length > MAX_LINE ? lines[li].slice(0, MAX_LINE) : lines[li];
    const all = spansIn(line);
    const spans: Span[] = [];
    for (const s0 of all) {
      const s = s0.digits >= 7 ? afterDate(line, s0) : null;
      if (!s || s.digits < 7) continue;
      const text = line.slice(s.start, s.end);
      if (isDate(text) || otherNumber(text) || labelledOther(line, s)) continue;
      spans.push(s);
    }
    if (!spans.length) {
      // A line that is nothing but five or six digits was meant as a number, and is reported as too short.
      const only = all.length === 1 ? all[0] : null;
      if (only && only.digits >= 5 && !trimEdge(line.slice(0, only.start)) && !trimEdge(line.slice(only.end))) {
        const n = normalise(line.slice(only.start, only.end), country);
        if (!('phone' in n)) col.reject(li + 1, line.slice(only.start, only.end), n.why, n.hint);
      }
      continue;
    }

    // What is left of the line once its numbers are taken out decides what kind of line it is.
    const before = trimEdge(line.slice(0, spans[0].start));
    const after = trimEdge(line.slice(spans[spans.length - 1].end));
    let between = true;
    for (let k = 1; k < spans.length && between; k++) between = !trimEdge(line.slice(spans[k - 1].end, spans[k].start));
    const label = before && after ? '' : before || after;
    const list = between && (!before || !after) && (!label || isLabel(label));
    const name = list && label && kindOf(label) === null ? nameFrom(label) : undefined;

    for (const s of spans) {
      if (col.truncated) break;
      const raw = line.slice(s.start, s.end);
      const n = s.digits > 20 ? ({ why: 'too-long' } as Why) : normalise(raw, country);
      const found: { phone: string; via: Via }[] = [];
      const bad: { text: string; why: InvalidWhy; hint?: 'excel-rounded' }[] = [];
      // Too long with spaces in it may be several numbers in a row (`07501234567 07701234567`); anything else wrong
      // with it is reported whole. A piece is taken only when it says it is a phone number by itself: eight digits
      // from the middle of an account or card number (`0123 4567 8901 2345`) are valid somewhere and nobody's phone.
      const split = !('phone' in n) && n.why === 'too-long' && /\s/.test(raw) ? splitRun(raw, country) : null;
      if ('phone' in n) found.push(n);
      else if (split && split.found.some(sure)) {
        for (const f of split.found) if (sure(f)) found.push(f); else bad.push({ text: f.text, why: 'too-long' });
        bad.push(...split.failed);
      } else bad.push({ text: raw, why: n.why, hint: n.hint });
      for (const f of found) {
        if (!list && !sure(f)) continue;
        const person: Recipient = { phone: f.phone, vars: {} };
        if (name) person.name = name;
        col.add(person, li + 1);
      }
      if (list) for (const b of bad) col.reject(li + 1, b.text, b.why, b.hint);
    }
  }
  return cut;
}

// ── vCard ─────────────────────────────────────────────────────────────────

interface Tel { value: string; types: Set<string>; group: string; line: number }
interface Card { line: number; fn: string; n: string; org: string; tels: Tel[]; labels: Map<string, string> }

/** Characters kept of one unfolded vCard line. A photo is megabytes of base64 nobody here needs. */
const MAX_PROPERTY = 8_192;

/** A vCard text value unescaped: `\,` `\;` `\\`, and `\n` as a space (a name is one line). */
function vUnescape(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      const e = s[++i];
      out += e === 'n' || e === 'N' ? ' ' : e;
    } else out += c;
  }
  return out;
}

/** A structured value's parts, split at the `;` that are not escaped. */
function vSplit(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) { cur += s[i] + s[i + 1]; i++; continue; }
    if (s[i] === ';') { out.push(cur); cur = ''; continue; }
    cur += s[i];
  }
  out.push(cur);
  return out.map(vUnescape);
}

/** A `CHARSET` that `TextDecoder` knows, else UTF-8. */
function decoderFor(charset: string, fatal: boolean): TextDecoder {
  try { return new TextDecoder(charset || 'utf-8', { fatal }); } catch { return new TextDecoder('utf-8', { fatal }); }
}

/**
 * Quoted-printable, as vCard 2.1 writes non-ASCII names: `=D8=B1=D8=A8=D8=A7=D8=B2` is UTF-8 bytes (or the bytes of
 * the `CHARSET` it names). A broken `=` sequence is kept as it is. Without a charset, bytes that are not UTF-8 are read
 * as Windows-1256: the old phones that wrote 2.1 wrote Arabic so.
 */
function qpDecode(value: string, charset: string): string {
  const bytes: number[] = [];
  const enc = new TextEncoder();
  const hex = (c: number): number => (c >= 48 && c <= 57 ? c - 48 : (c | 32) >= 97 && (c | 32) <= 102 ? (c | 32) - 87 : -1);
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 61 && i + 2 < value.length + 0 && hex(value.charCodeAt(i + 1)) >= 0 && hex(value.charCodeAt(i + 2)) >= 0) {
      bytes.push(hex(value.charCodeAt(i + 1)) * 16 + hex(value.charCodeAt(i + 2)));
      i += 2;
    } else if (c < 128) bytes.push(c);
    else {
      const cp = value.codePointAt(i) ?? c;
      const ch = String.fromCodePoint(cp);
      for (const b of enc.encode(ch)) bytes.push(b);
      i += ch.length - 1;
    }
  }
  const b = new Uint8Array(bytes);
  if (charset) return decoderFor(charset, false).decode(b);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('windows-1256').decode(b); }
}

/** A `TEL` value as a number to read: a vCard 4 `tel:` URI loses its scheme and its `;ext=…`. */
function telValue(v: string): string {
  let t = v.trim();
  if (/^tel:/i.test(t)) t = t.slice(4);
  const semi = t.indexOf(';');
  return semi >= 0 ? t.slice(0, semi) : t;
}

/** The labels phones give a mobile number (`X-ABLabel`, as an iPhone writes them), folded. */
const MOBILE_LABELS = wordSet('mobile cell cellular iphone handy موبايل جوال محمول مۆبایل موبایل cep mobil');
const FAX_LABELS = wordSet('fax pager فاكس فکس faks');

/**
 * A person from a vCard. The name is `FN`, else `N` as "given middle family", else `ORG` (a business's own card).
 * The number: every `TEL` except a fax or pager, ranked mobile first (`CELL`, `MOBILE`, `IPHONE`, `TEXT`, or an
 * `X-ABLabel` that says mobile), then the preferred one, then the rest; the first that reads is the person. Further
 * numbers of the same card become extra recipients with the same name only when they differ and are mobiles — typed
 * so where the country's mobiles are unknown, and shaped so where they are known — and at most two of them: a contact
 * with a mobile and an office line is one person, not two messages.
 */
function finishCard(card: Card, country: string, col: Collector): void {
  const name = nameFrom(card.fn) ?? nameFrom(card.n) ?? nameFrom(card.org);
  const labelHas = (group: string, set: Set<string>): boolean => {
    const l = group ? card.labels.get(group) : undefined;
    return !!l && foldWords(l).some((w) => set.has(w));
  };
  const tels = card.tels
    .filter((t) => !t.types.has('FAX') && !t.types.has('PAGER') && !labelHas(t.group, FAX_LABELS))
    .map((t) => ({
      t,
      mobile: ['CELL', 'MOBILE', 'IPHONE', 'TEXT'].some((x) => t.types.has(x)) || labelHas(t.group, MOBILE_LABELS),
      pref: t.types.has('PREF'),
    }));
  const ranked = [...tels.filter((x) => x.mobile), ...tels.filter((x) => !x.mobile && x.pref), ...tels.filter((x) => !x.mobile && !x.pref)];
  const read = ranked.map((x) => ({ ...x, n: normalise(telValue(x.t.value), country) }));
  const good = read.filter((x): x is typeof x & { n: { phone: string; via: Via } } => 'phone' in x.n);
  if (!good.length) {
    const bad = read.find((x) => !('phone' in x.n));
    if (bad && !('phone' in bad.n)) col.reject(bad.t.line, bad.t.value, bad.n.why, bad.n.hint);
    else col.reject(card.line, name ?? '', 'empty');
    return;
  }
  const add = (phone: string, line: number) => {
    const person: Recipient = { phone, vars: {} };
    if (name) person.name = name;
    col.add(person, line);
  };
  add(good[0].n.phone, good[0].t.line);
  const mine = new Set([good[0].n.phone]);
  for (const x of good.slice(1)) {
    if (mine.size >= 3 || col.truncated) break;
    if (mine.has(x.n.phone)) continue;
    const shape = mobileShape(x.n.phone);
    if (shape === false || (shape === null && !x.mobile)) continue;
    mine.add(x.n.phone);
    add(x.n.phone, x.t.line);
  }
}

/**
 * A contacts file: vCard 2.1, 3.0 or 4.0, any number of cards. Folded lines (a line break and a space or tab) are
 * joined first; a quoted-printable value's soft line breaks (`=` at the end) too. Properties may carry a group
 * (`item1.TEL`, joined to `item1.X-ABLabel`), bare 2.1 parameters (`TEL;CELL;PREF:`) or 3.0/4.0 ones
 * (`TEL;TYPE=cell,voice:`, `TEL;VALUE=uri:tel:+964…`). A card inside a card (2.1's `AGENT`) is passed over.
 */
function readVcf(text: string, country: string, col: Collector): boolean {
  const lines = text.split(/\r\n|\r|\n/);
  const cut = lines.length > MAX_LINES * 4;
  let card: Card | null = null;
  let depth = 0;
  /** The card's last property was a 2.1 `AGENT:` with its value to follow: the next BEGIN is that card, inside. */
  let agent = false;
  let logical = '';
  let logicalLine = 0;

  const handle = (prop: string, at: number): void => {
    let colon = -1;
    let quote = false;
    for (let i = 0; i < prop.length && i < 512; i++) {
      const c = prop[i];
      if (c === '"') quote = !quote;
      else if (c === ':' && !quote) { colon = i; break; }
    }
    if (colon < 0) return;
    const params = prop.slice(0, colon).split(';');
    let key = params[0].trim().toUpperCase();
    const dot = key.lastIndexOf('.');
    const group = dot >= 0 ? key.slice(0, dot) : '';
    if (dot >= 0) key = key.slice(dot + 1);
    const value = prop.slice(colon + 1);
    if (key === 'BEGIN' && /^\s*vcard\s*$/i.test(value)) {
      // A BEGIN inside a card that is not an agent's is the next card: the one before lost its END (a cut or joined
      // export). Without this, every card after a broken one was read as nested and passed over.
      if (depth > 0 && !agent) {
        if (card) finishCard(card, country, col);
        card = null;
        depth = 0;
      }
      agent = false;
      if (depth++ === 0) card = { line: at, fn: '', n: '', org: '', tels: [], labels: new Map() };
      return;
    }
    if (key === 'END' && /^\s*vcard\s*$/i.test(value)) {
      if (depth > 0 && --depth === 0 && card) { finishCard(card, country, col); card = null; }
      return;
    }
    if (depth === 1) agent = key === 'AGENT' && !value.trim();
    if (!card || depth !== 1) return;
    const types = new Set<string>();
    let encoding = '';
    let charset = '';
    for (const p of params.slice(1)) {
      const eq = p.indexOf('=');
      const k = eq < 0 ? 'TYPE' : p.slice(0, eq).trim().toUpperCase();
      const v = (eq < 0 ? p : p.slice(eq + 1)).replace(/"/g, '').trim();
      if (k === 'ENCODING') encoding = v.toUpperCase();
      else if (k === 'CHARSET') charset = v;
      else if (k === 'PREF') types.add('PREF');
      else if (k === 'TYPE') {
        for (const x of v.split(',')) {
          const u = x.trim().toUpperCase();
          if (u === 'QUOTED-PRINTABLE' || u === 'BASE64' || u === 'B') encoding = u;
          else if (u) types.add(u);
        }
      }
    }
    const text = encoding === 'QUOTED-PRINTABLE' ? qpDecode(value, charset) : value;
    const c = card as Card;
    if (key === 'FN') c.fn ||= vUnescape(text);
    else if (key === 'N') {
      if (!c.n) {
        const [family = '', given = '', middle = ''] = vSplit(text);
        c.n = [given, middle, family].map((x) => x.trim()).filter(Boolean).join(' ');
      }
    } else if (key === 'ORG') c.org ||= vSplit(text)[0] ?? '';
    else if (key === 'TEL') { if (c.tels.length < 20) c.tels.push({ value: text, types, group, line: at }); }
    else if (key === 'X-ABLABEL' && group) c.labels.set(group, vUnescape(text));
  };

  for (let i = 0; i < lines.length && i < MAX_LINES * 4; i++) {
    const raw = lines[i];
    if (logical && (raw.startsWith(' ') || raw.startsWith('\t'))) {
      if (logical.length < MAX_PROPERTY) logical += raw.slice(1, 1 + MAX_PROPERTY - logical.length);
      continue;
    }
    if (logical.endsWith('=') && /QUOTED-PRINTABLE/i.test(logical.slice(0, Math.max(0, logical.indexOf(':'))))) {
      if (logical.length < MAX_PROPERTY) logical = logical.slice(0, -1) + raw.slice(0, MAX_PROPERTY - logical.length);
      continue;
    }
    if (logical) handle(logical, logicalLine);
    if (col.truncated) return true;
    logical = raw.length > MAX_PROPERTY ? raw.slice(0, MAX_PROPERTY) : raw;
    logicalLine = i + 1;
  }
  if (logical) handle(logical, logicalLine);
  // A file cut off before its last END:VCARD still has a person in it.
  if (card) finishCard(card, country, col);
  return cut;
}

// ── reading anything ──────────────────────────────────────────────────────

const extensionOf = (name: string): string => {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
};

/** What the file says it is, by its name, then its type. */
function declared(file: string, mime: string): 'csv' | 'tsv' | 'vcf' | 'xlsx' | 'txt' | '' {
  const ext = extensionOf(file);
  if (ext === 'csv') return 'csv';
  if (ext === 'tsv' || ext === 'tab') return 'tsv';
  if (ext === 'vcf' || ext === 'vcard') return 'vcf';
  if (ext === 'xlsx' || ext === 'xlsm' || ext === 'xls') return 'xlsx';
  if (ext) return 'txt';
  const m = mime.toLowerCase();
  if (m.includes('csv')) return 'csv';
  if (m.includes('tab-separated')) return 'tsv';
  if (m.includes('vcard')) return 'vcf';
  if (m.includes('spreadsheetml') || m.includes('ms-excel')) return 'xlsx';
  return '';
}

const looksVcard = (text: string): boolean => /^\s*BEGIN:VCARD/i.test(text.slice(0, 4096)) || /\nBEGIN:VCARD/i.test(text.slice(0, 4096));

/**
 * Anything a person has, read as people. `input` is pasted or decoded text, or a file's bytes (a workbook, a vCard,
 * a CSV in any of the encodings Excel and phones write). Never throws: a file that cannot be read comes back with a
 * `problem` and one rejected line.
 *
 * `format` is how it was read: `vcf` and `xlsx` by what is inside (a contacts file pasted as text is a `vcf`), `csv`,
 * `tsv` and `txt` by the file's name, and `text` for something pasted.
 */
export async function parseAudience(input: string | Uint8Array, o: ParseOptions = {}): Promise<Parsed> {
  const opts = o && typeof o === 'object' ? o : {};
  const country = codeOption(opts.defaultCountry) || '964';
  const file = typeof opts.filename === 'string' ? clean(opts.filename, LIMITS.valueChars) || undefined : undefined;
  const kind = declared(file ?? '', typeof opts.mime === 'string' ? opts.mime.slice(0, 200) : '');
  const columns = {
    phoneColumn: typeof opts.phoneColumn === 'string' ? opts.phoneColumn.slice(0, LIMITS.valueChars) : undefined,
    nameColumn: typeof opts.nameColumn === 'string' ? opts.nameColumn.slice(0, LIMITS.valueChars) : undefined,
  };
  let format: SourceFormat = kind === 'csv' || kind === 'tsv' || kind === 'txt' ? kind : file ? 'txt' : 'text';
  try {
    let text: string;
    let cut = false;
    if (input instanceof Uint8Array) {
      if (!input.length) return failed(format, country, 'empty', file);
      if (isZip(input) || isOle(input) || kind === 'xlsx') {
        format = 'xlsx';
        if (!isZip(input) && !isOle(input)) return failed(format, country, 'not-a-sheet', file);
        const sheet = await readSheet(input);
        const col = new Collector();
        const shape = readTable(sheet.rows.map((cells, i) => ({ line: i + 1, cells })), columns, country, col, false);
        if (shape) return finish(format, country, col, shape, file, sheet.cut);
        // Numbers in several columns and no header: a list laid out in a grid. Every row read as a line of text,
        // `rows[i]` still being row i + 1, so a rejected number keeps its row.
        const grid = new Collector();
        const lines = sheet.rows.map((cells) => cells.join(', ')).join('\n');
        return finish(format, country, grid, NO_SHAPE, file, readFree(lines, country, grid) || sheet.cut);
      }
      let bytes = input;
      if (bytes.length > MAX_INPUT) {
        // Cut at a line break, so the cut does not split a character for the decoder to stumble on.
        let at = MAX_INPUT;
        while (at > 0 && bytes[at - 1] !== 10) at--;
        bytes = bytes.subarray(0, at || MAX_INPUT);
        cut = true;
      }
      const decoded = decodeBytes(bytes, country);
      if (decoded === null) return failed(format, country, 'binary', file);
      text = decoded;
    } else if (typeof input === 'string') {
      const c = cutText(input, MAX_INPUT);
      text = c.text;
      cut = c.cut;
    } else {
      return failed(format, country, 'empty', file);
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (!text.trim()) return failed(format, country, 'empty', file);

    const col = new Collector();
    if (kind === 'vcf' || looksVcard(text)) {
      format = 'vcf';
      return finish(format, country, col, NO_SHAPE, file, readVcf(text, country, col) || cut);
    }
    const tabular = kind === 'csv' || kind === 'tsv';
    const delim = kind === 'tsv' ? '\t' : delimiterOf(text, !tabular);
    if (delim) {
      const { rows, cut: rowsCut } = parseDelimited(text, delim, MAX_LINES);
      const shape = readTable(rows, columns, country, col, !tabular);
      if (shape) return finish(format, country, col, shape, file, cut || rowsCut);
    } else if (tabular) {
      // One column: a CSV of numbers alone, with or without a header.
      const shape = readTable(parseDelimited(text, '', MAX_LINES).rows, columns, country, col, true);
      if (shape) return finish(format, country, col, shape, file, cut);
    }
    const fresh = new Collector();
    return finish(format, country, fresh, NO_SHAPE, file, readFree(text, country, fresh) || cut);
  } catch (e) {
    return failed(format, country, e instanceof SheetError ? e.code : 'damaged', file);
  }
}

// ── the people in the chats ───────────────────────────────────────────────

/**
 * The people in the chats an account can see, as a list to choose from: one-to-one chats with a real number only —
 * never a group, never a `@lid` (WhatsApp's privacy identity, a run of digits that is not a phone number), never a
 * broadcast or a channel. The number is WhatsApp's own, so it is checked only for being a possible international
 * number (8 to 15 digits), not against a country's plan: a person WhatsApp knows is not refused for a length table
 * here being wrong. A chat named by its number has no name. Most recent chat first, as given.
 */
export function fromChats(chats: readonly Chat[]): Parsed {
  const col = new Collector();
  const list = Array.isArray(chats) ? chats.slice(0, MAX_LINES) : [];
  list.forEach((c: unknown, i) => {
    if (col.truncated || !c || typeof c !== 'object') return;
    const chat = c as Partial<Chat>;
    const jid = typeof chat.jid === 'string' ? chat.jid : '';
    if (chat.group === true || !isPhone(jid)) return;
    const phone = phoneOf(jid);
    if (phone.length < 8 || phone.length > 15 || phone[0] === '0') { col.reject(i + 1, phone || jid, phone.length > 15 ? 'too-long' : 'too-short'); return; }
    const person: Recipient = { phone, vars: {} };
    const name = nameFrom(chat.name);
    if (name && name !== jid) person.name = name;
    col.add(person, i + 1);
  });
  return finish('chats', '964', col, NO_SHAPE, undefined, false);
}

// ── lists ─────────────────────────────────────────────────────────────────

/** The recipients not on the do-not-contact list, and how many were left out. */
export function excludeSuppressed(list: readonly Recipient[], suppressed: ReadonlySet<string>): { kept: Recipient[]; removed: number } {
  const all = Array.isArray(list) ? list : [];
  const kept = suppressed && typeof suppressed.has === 'function' ? all.filter((r) => !suppressed.has(r?.phone)) : all.slice();
  return { kept, removed: all.length - kept.length };
}

/**
 * One recipient read again, whatever made it: digits only and a possible length, a cleaned name, at most
 * `LIMITS.columns` variables with clean keys and capped values. `null` when it is not a person.
 */
function readRecipient(x: unknown): Recipient | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  const phone = typeof r.phone === 'string' ? r.phone : '';
  if (!/^[1-9][0-9]{6,14}$/.test(phone)) return null;
  const out: Recipient = { phone, vars: {} };
  const name = nameFrom(r.name);
  if (name) out.name = name;
  if (r.vars && typeof r.vars === 'object') {
    let n = 0;
    for (const [k, v] of Object.entries(r.vars as Record<string, unknown>)) {
      if (n >= LIMITS.columns) break;
      const key = clean(k.replace(/[{}|[\]]/g, ' '), MAX_KEY).trim();
      const val = clean(v, LIMITS.valueChars);
      // Own keys only: `in` would find `constructor` and `toString` on every object and drop those columns, which the
      // engine reads like any other (`{constructor}` is a column). `__proto__` cannot be a plain key at all.
      if (key && val && key !== '__proto__' && !Object.prototype.hasOwnProperty.call(out.vars, key)) { out.vars[key] = val; n++; }
    }
  }
  return out;
}

const SOURCES: readonly SourceFormat[] = ['text', 'txt', 'csv', 'tsv', 'vcf', 'xlsx', 'chats'];

/** A short, stable fingerprint of the numbers, so two lists made in the same millisecond do not share an id. */
function fingerprint(rs: readonly Recipient[]): string {
  let h = 0x811c9dc5;
  for (const r of rs) for (let i = 0; i < r.phone.length; i++) h = Math.imul(h ^ r.phone.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/**
 * A parsed list kept under a name. Every recipient is read again (`readRecipient`), duplicates dropped and the list
 * capped: a `Parsed` may have come from anywhere, the assistant's tool included. An empty name falls back to the
 * file's name without its extension.
 */
export function makeAudience(p: Parsed, name: string, now: number = Date.now()): Audience {
  const at = Number.isFinite(now) ? Math.max(0, Math.floor(now)) : 0;
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  for (const x of Array.isArray(p?.recipients) ? p.recipients : []) {
    if (recipients.length >= LIMITS.recipients) break;
    const r = readRecipient(x);
    if (r && !seen.has(r.phone)) { seen.add(r.phone); recipients.push(r); }
  }
  const file = typeof p?.file === 'string' ? clean(p.file, LIMITS.valueChars) : '';
  const a: Audience = {
    id: `a${at.toString(36)}${fingerprint(recipients)}`,
    name: clean(name, 60) || clean(file.replace(/\.[A-Za-z0-9]{1,8}$/, ''), 60),
    recipients,
    source: SOURCES.includes(p?.format) ? p.format : 'text',
    created: at,
    updated: at,
  };
  if (file) a.file = file;
  return a;
}
