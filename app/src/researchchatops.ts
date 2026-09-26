/**
 * Talking to a Research document: the Chat tab's side of the model, and the
 * only road from what the model says in it to the document.
 *
 * The same design as the Slides and Video chats (slideschatops.ts), on
 * purpose. The researcher asks — "what does the second chapter argue?",
 * "which sources say the region may sign treaties?", "rewrite the
 * introduction more briefly", "add a part on the 2017 referendum after
 * chapter three", "finish writing it" — typed or spoken. The model answers
 * with a sentence for them and a list of operations; the app checks every
 * one and carries out those that are valid.
 *
 * ## The model writes operations, never the document
 *
 * An answer is `{ "reply": "…", "ops": [ … ] }`, every op one of a fixed
 * catalogue (`OPS`). The reply is shown as text. The text of a part is never
 * taken from the chat: "rewrite the introduction" becomes the same rewrite the
 * Outline tab's button starts, with the model's instruction, so every rule the
 * writer keeps — cite only through markers, invent no data, the document's
 * manner — still holds, and the new text is written by the request built for
 * it. What the chat may set directly is what the researcher could type into
 * the outline themselves: a heading, a brief, a length, a new or removed part,
 * the title, the citation style, a note.
 *
 * ## Answers come from the document
 *
 * The prompt carries the outline, the written text (inside a budget, shared
 * like the data files'), the sources as the list names them, and the notes;
 * the model is told to answer from those and to say so when they do not
 * answer the question — never to invent a study, a law or a page.
 *
 * ## Part numbers mean the outline the model was shown
 *
 * A reply that removes part 2 and then renames part 5 means the part that was
 * 5 when it read the outline. So every number is resolved against the outline
 * as it was sent, to a part's id, before anything is changed.
 *
 * ## Saving is not the model's
 *
 * A file is written only when a person presses a button: "save it as Word"
 * puts that button under the reply (`wants.offer`).
 *
 * Pure: every rule here is tested without a model (test/researchchat.test.mjs).
 */

import {
  STYLES, citable, kindOf, type ChatTurn, type Doc, type DocLang, type Section, type Style,
} from './research';
import { jsonIn } from './researchrun';
import { wordCount } from './prose';

// ── limits ────────────────────────────────────────────────────────────────

/** Turns a document keeps; older ones fall off the top. */
export const CHAT_KEEP = 60;
/** Turns sent with each new message, besides the message. */
export const CHAT_CONTEXT = 10;
/** Ops read from one answer. */
export const MAX_OPS = 40;
/** Parts written again from one message: each is a request of its own, one after another. */
export const MAX_REWRITES = 6;
/** The written text the chat sends, shared between the parts. */
export const DOC_CHARS = 60_000;

const TURN_CHARS = 900;
const MESSAGE_CHARS = 4000;
const REPLY_CHARS = 4000;
const INSTRUCTION_CHARS = 1500;
const HEADING_CHARS = 200;
const BRIEF_CHARS = 600;
const NOTE_CHARS = 2000;
const TITLE_CHARS = 300;
const PARTS_MAX = 120;

/** The operations the model may ask for. Anything else is skipped. */
export const OPS = [
  'rewrite_part', 'write_rest', 'write_abstract', 'rename_part', 'set_brief', 'set_words', 'add_part', 'remove_part',
  'set_title', 'set_citation_style', 'add_note', 'open_part', 'show_tab', 'offer_save',
] as const;
export type OpName = (typeof OPS)[number];

/** The tabs of a document the chat may show. */
export type ChatTab = 'outline' | 'sources' | 'check' | 'details';

const LANGUAGE_NAME: Readonly<Record<DocLang, string>> = {
  ar: 'Arabic', ckb: 'Central Kurdish (Sorani)', kmr: 'Northern Kurdish (Badini)', en: 'English',
};

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/** A string from the model, one kind of whitespace, control characters gone, cut to `cap`. */
function str(v: unknown, cap: number, lines = false): string {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  let s = String(v).normalize('NFC').replace(CONTROL, '');
  s = lines ? s.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  s = s.trim();
  return s.length > cap ? `${s.slice(0, cap - 1).trimEnd()}…` : s;
}

/** A whole number from the model — "3", 3, "٣" — or NaN. */
function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : NaN;
  if (typeof v !== 'string') return NaN;
  const ascii = v.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
  const m = /-?\d+/.exec(ascii);
  return m ? Number.parseInt(m[0], 10) : NaN;
}

// ── what the model is told ────────────────────────────────────────────────

const STATE_WORD: Readonly<Record<Section['state'], string>> = {
  waiting: 'not written yet', writing: 'being written now', done: 'written', failed: 'failed — not written', author: 'left for the researcher to write',
};

function outlineOf(doc: Doc): string {
  return doc.sections.slice(0, PARTS_MAX).map((s, i) => {
    const words = s.state === 'done' ? `${wordCount(s.text)} words` : `aim ${s.words} words`;
    return `${'  '.repeat(s.level - 1)}${i + 1}. [level ${s.level}] ${s.heading} — ${STATE_WORD[s.state]}, ${words}${s.brief ? ` — brief: ${str(s.brief, 240)}` : ''}`;
  }).join('\n');
}

/**
 * The written parts inside `DOC_CHARS`, shared as `dataBlock` shares its
 * budget: smallest first, each an equal share of what is left, so a short
 * part is never cut to make room for a long one. A cut part says so.
 */
export function textOf(doc: Doc, budget = DOC_CHARS): string {
  const parts = doc.sections.map((s, i) => ({ s, i })).filter((x) => x.s.state === 'done' && x.s.text.trim());
  if (!parts.length) return '';
  const give = new Map<number, number>();
  let left = budget;
  [...parts].sort((a, b) => a.s.text.length - b.s.text.length).forEach((x, k, all) => {
    const n = Math.min(x.s.text.length, Math.floor(left / (all.length - k)));
    give.set(x.i, n);
    left -= n;
  });
  return parts.map(({ s, i }) => {
    const n = give.get(i) ?? 0;
    const cut = n < s.text.length;
    return `--- part ${i + 1}: ${s.heading}${cut ? ' (only its beginning is shown)' : ''} ---\n${s.text.slice(0, n)}`;
  }).join('\n\n');
}

function sourcesOf(doc: Doc): string {
  return citable(doc.sources).map((s) => {
    const who = s.authors.length ? s.authors.slice(0, 3).map((a) => a.family).join(', ') + (s.authors.length > 3 ? ' et al.' : '') : '';
    const abs = s.abstract ? ` — ${str(s.abstract, 260)}` : '';
    return `[${s.key}] ${who ? `${who} ` : ''}(${s.year ?? 'n.d.'}). ${s.title}${abs}`;
  }).join('\n');
}

function historyOf(turns: readonly ChatTurn[] | undefined): string[] {
  const recent = (turns ?? []).slice(-CHAT_CONTEXT);
  if (!recent.length) return [];
  return [
    'The conversation so far, oldest first:',
    ...recent.map((x) => {
      const said = x.role === 'you' ? `Researcher: ${str(x.text, TURN_CHARS)}` : `You: ${x.failed ? '(your answer could not be read)' : str(x.text, TURN_CHARS)}`;
      const did = x.changes?.length ? ` [done: ${x.changes.join('; ')}]` : '';
      return said + did;
    }),
    '',
  ];
}

const CATALOGUE = [
  '- {"op":"rewrite_part","part":3,"instruction":"what to change, precisely"} — the app\'s writer writes part 3 again (or writes it, if it is not written yet) following your instruction, with its sources and every rule of the document. Use it for any change to a part\'s text: shorter, clearer, a point added, a citation added, a repetition removed, another tone.',
  `- {"op":"write_rest"} — write every part not written yet, in order. - {"op":"write_abstract"} — write the abstract again from the text as it is.`,
  '- {"op":"rename_part","part":3,"heading":"…"} - {"op":"set_brief","part":3,"brief":"what it must cover"} - {"op":"set_words","part":3,"words":800}',
  '- {"op":"add_part","after":4,"level":2,"heading":"…","brief":"…","words":700} — a new part, not written yet, after part 4 (0 for the first place). Write it afterwards with rewrite_part on "part":"new" in the same reply only if the researcher asked for it to be written.',
  '- {"op":"remove_part","part":5}',
  `- {"op":"set_title","title":"…"} - {"op":"set_citation_style","style":"${STYLES.join('|')}"}`,
  '- {"op":"add_note","text":"…"} — a standing instruction or a fact from the researcher that every part written from now on must follow (their sample, their method, a rule of their university).',
  '- {"op":"open_part","part":3} — show that part in the reader. - {"op":"show_tab","tab":"outline|sources|check|details"} — "check" is the originality check.',
  '- {"op":"offer_save","format":"word|pdf"} — put a Save button under your reply. You cannot save a file yourself; the researcher presses the button.',
].join('\n');

/**
 * The request for one message: what the model is, the document as it is,
 * the conversation, and the message.
 */
export function chatPrompt(
  doc: Doc, turns: readonly ChatTurn[] | undefined, message: string, o: { spoken?: boolean; ui?: DocLang } = {},
): { system: string; user: string } {
  const k = kindOf(doc.kind);
  const system = [
    `You are the research assistant inside a researcher's document: a ${k.label.toLowerCase()} in ${LANGUAGE_NAME[doc.lang]}. You answer their questions about the document, its sources and its subject, and you change the document when they ask — only through the operations listed below, which the app checks and carries out.`,
    '',
    'Rules that are never broken:',
    '1. Answer from the document, its sources and what the researcher tells you. When you name a source, name it as the list does (author and year, or its title). Never invent a study, an author, a statistic, a law, an article number or a page. When the document and its sources do not answer the question, say so plainly, and say what the researcher could look for.',
    `2. Reply in the language the researcher writes to you in${o.ui ? ` (their interface is in ${LANGUAGE_NAME[o.ui]})` : ''}. Plain sentences: no markdown headings, no code, no tables. Keep it short — one to five sentences — unless the question needs more.`,
    '3. Never write the text of a part in your reply or in an operation. A change to a part\'s text is a rewrite_part with a precise instruction; the app\'s writer does the writing.',
    '4. Change only what the researcher asked for. If a request is unclear, ask one short question and change nothing.',
    '5. You cannot save a file or run anything. For a file, offer the button.',
    '',
    'Reply with one JSON object and nothing else: { "reply": "what you say to the researcher", "ops": [ … ] } — "ops" is [] when nothing is to change.',
    'Operations (parts are numbered as in the outline you are shown):',
    CATALOGUE,
  ].join('\n');

  const text = textOf(doc);
  const sources = sourcesOf(doc);
  const said = str(message, MESSAGE_CHARS, true);
  const user = [
    `Title: ${doc.meta.title || doc.request}`,
    doc.meta.field ? `Field: ${doc.meta.field}` : '',
    `Citation style: ${doc.style}. Stage: ${doc.stage}.`,
    doc.voice ? `Written in the manner of ${doc.voice.name}.` : '',
    doc.notes.trim() ? `The researcher's notes:\n${str(doc.notes, 3000, true)}` : '',
    '',
    doc.sections.length ? 'The outline:' : 'There is no outline yet.',
    outlineOf(doc),
    doc.sections.length > PARTS_MAX ? `(and ${doc.sections.length - PARTS_MAX} more parts not shown)` : '',
    '',
    doc.abstract.trim() ? `The abstract:\n${str(doc.abstract, 2000, true)}\n` : '',
    sources ? 'The sources, by key:' : 'The document has no sources yet.',
    sources,
    '',
    text ? 'The written text (citation markers like [@s3] name the sources above):' : 'Nothing is written yet.',
    text,
    '',
    ...historyOf(turns),
    o.spoken
      ? 'The researcher\'s new message, spoken and written down by a speech engine — read it for what they meant, not letter by letter:'
      : 'The researcher\'s new message:',
    said,
  ].filter((l, i, all) => l !== '' || all[i - 1] !== '').join('\n');
  return { system, user };
}

// ── reading the answer ────────────────────────────────────────────────────

export interface Parsed {
  /** Whether the answer was an answer at all. */
  readable: boolean;
  reply: string;
  ops: unknown[];
}

const REPLY_KEYS = ['reply', 'message', 'answer', 'response', 'say'];
const OPS_KEYS = ['ops', 'operations', 'actions', 'changes'];

/**
 * The model's answer. JSON is asked for; a reply of plain sentences — a model
 * answering a question and forgetting the envelope — is taken as the reply
 * with nothing to change, since an answer to a question is still an answer.
 */
export function parseChat(text: unknown): Parsed {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return { readable: false, reply: '', ops: [] };
  const obj = jsonIn(raw) as Record<string, unknown> | null;
  if (obj) {
    const reply = REPLY_KEYS.map((k) => obj[k]).find((v) => typeof v === 'string');
    const ops = OPS_KEYS.map((k) => obj[k]).find((v) => Array.isArray(v)) as unknown[] | undefined;
    if (typeof reply === 'string' || ops) return { readable: true, reply: str(reply ?? '', REPLY_CHARS, true), ops: ops ?? [] };
  }
  // Something that opened a JSON object and never closed it is a broken answer, not prose.
  if (/^\s*(```|\{)/.test(raw)) return { readable: false, reply: '', ops: [] };
  return { readable: true, reply: str(raw, REPLY_CHARS, true), ops: [] };
}

// ── carrying it out ───────────────────────────────────────────────────────

/** A run the panel starts after the change is kept: a part written again, the rest, the abstract. */
export type Work =
  | { how: 'rewrite'; id: string; redo: string }
  | { how: 'run' }
  | { how: 'abstract' };

export type Skip =
  | 'unknown' | 'no-part' | 'busy' | 'writing' | 'author' | 'too-many' | 'too-many-rewrites'
  | 'bad' | 'nothing-left' | 'no-abstract' | 'nothing-written';

/** What one reply changed or started, as facts the panel words in the interface's language. */
export type Change =
  | { what: 'rewrite'; heading: string }
  | { what: 'write-rest'; n: number }
  | { what: 'abstract' }
  | { what: 'renamed'; from: string; to: string }
  | { what: 'brief'; heading: string }
  | { what: 'words'; heading: string; words: number }
  | { what: 'added'; heading: string; at: number }
  | { what: 'removed'; heading: string }
  | { what: 'title'; title: string }
  | { what: 'style'; style: Style }
  | { what: 'note' }
  | { what: 'open'; heading: string }
  | { what: 'tab'; tab: ChatTab }
  | { what: 'save' }
  | { what: 'skipped'; why: Skip; op?: string; part?: number };

export interface Applied {
  /** The document's fields that changed; `null` when none did. */
  next: Partial<Doc> | null;
  changes: Change[];
  work: Work[];
  wants: { open?: string; tab?: ChatTab; offer?: ('docx' | 'pdf')[] };
}

const OP_ALIASES: Readonly<Record<string, OpName>> = {
  rewrite: 'rewrite_part', edit_part: 'rewrite_part', write_part: 'rewrite_part', revise_part: 'rewrite_part',
  continue: 'write_rest', continue_writing: 'write_rest', write_remaining: 'write_rest', finish: 'write_rest',
  abstract: 'write_abstract', rewrite_abstract: 'write_abstract',
  rename: 'rename_part', set_heading: 'rename_part', brief: 'set_brief', words: 'set_words', set_length: 'set_words',
  add: 'add_part', insert_part: 'add_part', new_part: 'add_part', remove: 'remove_part', delete_part: 'remove_part',
  title: 'set_title', rename_document: 'set_title', citation_style: 'set_citation_style', set_style: 'set_citation_style',
  note: 'add_note', open: 'open_part', show_part: 'open_part', tab: 'show_tab', open_tab: 'show_tab', save: 'offer_save',
};

const TABS: readonly ChatTab[] = ['outline', 'sources', 'check', 'details'];
const TAB_WORDS: Readonly<Record<string, ChatTab>> = { originality: 'check', plagiarism: 'check', check: 'check', outline: 'outline', sources: 'sources', references: 'sources', details: 'details', settings: 'details' };

function opOf(o: Record<string, unknown>): OpName | null {
  const raw = str(o.op ?? o.type ?? o.action ?? o.name, 40).toLowerCase().replace(/[\s-]+/g, '_');
  if ((OPS as readonly string[]).includes(raw)) return raw as OpName;
  return OP_ALIASES[raw] ?? null;
}

/**
 * Carry out the ops against `doc`. `busy` is a run in flight on it: the
 * outline is not the chat's to change under a writer, so those ops are
 * skipped, while writing more is queued behind the run by the panel.
 */
export function applyOps(doc: Doc, ops: unknown, o: { newId: () => string; busy: boolean }): Applied {
  const list = Array.isArray(ops) ? ops : [];
  const changes: Change[] = [];
  const work: Work[] = [];
  const wants: Applied['wants'] = {};
  const skip = (why: Skip, op?: string, part?: number) => changes.push({ what: 'skipped', why, ...(op ? { op } : {}), ...(part ? { part } : {}) });

  // Numbers are the outline as it was sent; ids survive the edits below.
  const sent = doc.sections.map((s) => s.id);
  let sections = doc.sections.map((s) => ({ ...s }));
  let title = doc.meta.title;
  let style = doc.style;
  let notes = doc.notes;
  let changed = false;
  let rewrites = 0;
  let lastAdded: string | null = null;
  const byId = (id: string) => sections.find((s) => s.id === id);

  /** A part the op names: a number from the outline as sent, or "new" for the part this reply added. */
  const partOf = (v: unknown): { id: string; n: number } | null => {
    if (typeof v === 'string' && /^\s*new\s*$/i.test(v) && lastAdded) return { id: lastAdded, n: 0 };
    const n = num(v);
    if (!Number.isInteger(n) || n < 1 || n > sent.length) return null;
    const id = sent[n - 1];
    return byId(id) ? { id, n } : null;
  };

  for (let k = 0; k < list.length; k++) {
    if (k >= MAX_OPS) { skip('too-many'); break; }
    const raw = list[k];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { skip('bad'); continue; }
    const f = raw as Record<string, unknown>;
    const op = opOf(f);
    if (!op) { skip('unknown', str(f.op ?? f.type ?? f.action ?? '?', 40)); continue; }

    // Showing and offering only change the screen.
    if (op === 'open_part') {
      const p = partOf(f.part ?? f.index ?? f.n);
      if (!p) { skip('no-part', op, num(f.part)); continue; }
      wants.open = p.id;
      changes.push({ what: 'open', heading: byId(p.id)!.heading });
      continue;
    }
    if (op === 'show_tab') {
      const w = str(f.tab ?? f.name, 20).toLowerCase();
      const tab = (TABS as readonly string[]).includes(w) ? (w as ChatTab) : TAB_WORDS[w];
      if (!tab) { skip('bad', op); continue; }
      wants.tab = tab;
      changes.push({ what: 'tab', tab });
      continue;
    }
    if (op === 'offer_save') {
      const w = str(f.format ?? f.as ?? 'word', 10).toLowerCase();
      const fmt: 'docx' | 'pdf' = w.includes('pdf') ? 'pdf' : 'docx';
      if (!(wants.offer ?? []).includes(fmt)) wants.offer = [...(wants.offer ?? []), fmt];
      if (!changes.some((c) => c.what === 'save')) changes.push({ what: 'save' });
      continue;
    }

    // Writing: started by the panel afterwards, queued behind a run in flight.
    if (op === 'rewrite_part') {
      const p = partOf(f.part ?? f.index ?? f.n);
      if (!p) { skip('no-part', op, num(f.part)); continue; }
      const sec = byId(p.id)!;
      if (sec.state === 'author') { skip('author', op, p.n); continue; }
      if (sec.state === 'writing') { skip('writing', op, p.n); continue; }
      if (rewrites >= MAX_REWRITES) { skip('too-many-rewrites', op, p.n); continue; }
      if (work.some((w) => w.how === 'rewrite' && w.id === p.id)) continue;
      rewrites += 1;
      work.push({ how: 'rewrite', id: p.id, redo: str(f.instruction ?? f.redo ?? f.how ?? '', INSTRUCTION_CHARS, true) });
      changes.push({ what: 'rewrite', heading: sec.heading });
      continue;
    }
    if (op === 'write_rest') {
      const left = sections.filter((s) => s.state === 'waiting' || s.state === 'failed').length;
      const early = ['new', 'planning', 'sources', 'outline'].includes(doc.stage);
      if (!left && !early) { skip('nothing-left', op); continue; }
      if (!work.some((w) => w.how === 'run')) work.push({ how: 'run' });
      changes.push({ what: 'write-rest', n: left });
      continue;
    }
    if (op === 'write_abstract') {
      if (kindOf(doc.kind).abstract === 'none') { skip('no-abstract', op); continue; }
      if (!sections.some((s) => s.state === 'done' && s.text.trim())) { skip('nothing-written', op); continue; }
      if (!work.some((w) => w.how === 'abstract')) work.push({ how: 'abstract' });
      changes.push({ what: 'abstract' });
      continue;
    }

    // Everything below changes the document, and waits for a run to end.
    if (o.busy) { skip('busy', op); continue; }

    if (op === 'set_title') {
      const t = str(f.title ?? f.text, TITLE_CHARS);
      if (!t) { skip('bad', op); continue; }
      title = t;
      changed = true;
      changes.push({ what: 'title', title: t });
      continue;
    }
    if (op === 'set_citation_style') {
      const w = str(f.style ?? f.name, 20).toLowerCase();
      const s = (STYLES as readonly string[]).includes(w) ? (w as Style) : w.startsWith('foot') || w.includes('هامش') || w.includes('هوامش') ? 'footnotes' : null;
      if (!s) { skip('bad', op); continue; }
      style = s;
      changed = true;
      changes.push({ what: 'style', style: s });
      continue;
    }
    if (op === 'add_note') {
      const t = str(f.text ?? f.note, NOTE_CHARS, true);
      if (!t) { skip('bad', op); continue; }
      notes = notes.trim() ? `${notes.trimEnd()}\n${t}` : t;
      changed = true;
      changes.push({ what: 'note' });
      continue;
    }
    if (op === 'add_part') {
      const heading = str(f.heading ?? f.title, HEADING_CHARS);
      if (!heading) { skip('bad', op); continue; }
      const afterN = num(f.after ?? f.at);
      let at: number;
      if (!Number.isFinite(afterN) || afterN <= 0) at = afterN === 0 ? 0 : sections.length;
      else if (afterN > sent.length) at = sections.length;
      else {
        const anchor = sections.findIndex((s) => s.id === sent[afterN - 1]);
        if (anchor < 0) { skip('no-part', op, afterN); continue; }
        at = anchor + 1;
      }
      const lv = num(f.level);
      const level = (lv >= 1 && lv <= 4 ? lv : sections[at - 1]?.level ?? 1) as Section['level'];
      const w = num(f.words);
      const id = o.newId();
      const part: Section = {
        id, level, heading, brief: str(f.brief, BRIEF_CHARS), words: Number.isFinite(w) ? Math.min(5000, Math.max(50, w)) : 700,
        sources: [], text: '', state: 'waiting',
      };
      sections = [...sections.slice(0, at), part, ...sections.slice(at)];
      lastAdded = id;
      changed = true;
      changes.push({ what: 'added', heading, at: at + 1 });
      continue;
    }

    const p = partOf(f.part ?? f.index ?? f.n);
    if (!p) { skip('no-part', op, num(f.part)); continue; }
    const sec = byId(p.id)!;
    if (sec.state === 'writing') { skip('writing', op, p.n); continue; }
    if (op === 'rename_part') {
      const h = str(f.heading ?? f.title ?? f.to, HEADING_CHARS);
      if (!h) { skip('bad', op, p.n); continue; }
      changes.push({ what: 'renamed', from: sec.heading, to: h });
      sec.heading = h;
      changed = true;
    } else if (op === 'set_brief') {
      const b = str(f.brief ?? f.text, BRIEF_CHARS);
      if (!b) { skip('bad', op, p.n); continue; }
      sec.brief = b;
      changed = true;
      changes.push({ what: 'brief', heading: sec.heading });
    } else if (op === 'set_words') {
      const w = num(f.words ?? f.length);
      if (!Number.isFinite(w) || w < 0) { skip('bad', op, p.n); continue; }
      sec.words = Math.min(5000, Math.max(0, w));
      changed = true;
      changes.push({ what: 'words', heading: sec.heading, words: sec.words });
    } else if (op === 'remove_part') {
      sections = sections.filter((s) => s.id !== p.id);
      // A rewrite of it earlier in this reply goes with it.
      for (let i = work.length - 1; i >= 0; i--) { const w = work[i]; if (w.how === 'rewrite' && w.id === p.id) work.splice(i, 1); }
      changed = true;
      changes.push({ what: 'removed', heading: sec.heading });
    }
  }

  // A rewrite of a part removed later in the reply has nothing to write.
  const kept = work.filter((w) => w.how !== 'rewrite' || sections.some((s) => s.id === w.id));
  const next: Partial<Doc> | null = changed
    ? {
      sections,
      ...(title !== doc.meta.title ? { meta: { ...doc.meta, title } } : {}),
      ...(style !== doc.style ? { style } : {}),
      ...(notes !== doc.notes ? { notes } : {}),
    }
    : null;
  return { next, changes, work: kept, wants };
}

/** The conversation with the new turns, the oldest dropped past `CHAT_KEEP`. */
export function keptChat(turns: readonly ChatTurn[] | undefined, add: readonly ChatTurn[]): ChatTurn[] {
  return [...(turns ?? []), ...add].slice(-CHAT_KEEP);
}
