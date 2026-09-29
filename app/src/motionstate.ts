import { fill, type Lang } from './i18n';
import { explain } from './errors';
import { FORMATS, LIMITS, type Format, type Motion, type RecipeId, type Tone } from './motiontypes';
import { META, paletteOf, type PaletteId } from './motionrecipe';
import { detach, setLayer } from './motionedit';
import { readMotion } from './motionread';
import { emptyHistory, recorded, sameSnapshot, synced, type MotionHistory } from './motionhistory';
import type { PlanRequest } from './motionai';
import { MAX_OPS, type Note } from './motionchatops';
import { shownName } from './motionui';

/**
 * The Motion panel's decisions, without React: what the request form holds and
 * sends, how the graphics are listed and named, when an edit joins the last
 * undo step, whether a drag changed anything, which key does what, and every
 * note the model's answer carries, said in words.
 *
 * MotionPanel.tsx and MotionChat.tsx are the screens; this is what they decide
 * with, kept apart so `test/motionstate.test.mjs` can check it in Node. Nothing
 * here touches the DOM, the store or the clock: every function takes what it
 * needs and returns a value.
 */

type T = (s: string) => string;

// ── the request form ──────────────────────────────────────────────────────

/**
 * The request form as it was left, kept across the moves between the sidebar
 * and the full window, and filled by Ask Vylo. `null` is Auto: the model
 * chooses from the words, and a template takes its own.
 */
export interface Draft {
  request: string;
  format: Format | null;
  seconds: number | null;
  palette: PaletteId | null;
  /** Ask Vylo sent these words: make it as soon as the form can, once. */
  autostart: boolean;
  /** Why the last graphic asked for could not be made, said above the button until the next try. */
  error: string | null;
}

export function freshDraft(): Draft {
  return { request: '', format: null, seconds: null, palette: null, autostart: false, error: null };
}

/** The shapes the form offers, in the order it offers them. */
export const SHAPES: readonly Format[] = ['landscape', 'portrait', 'square', 'feed'];

/** The lengths the form offers besides Auto, in seconds. */
export const LENGTHS: readonly number[] = [4, 6, 10, 15];

/**
 * The six templates the sidebar shows under the form: a title, the overlay
 * people ask for most, kinetic type, a number, a chart and a logo. The rest are
 * one press away in the full window's gallery.
 */
export const TOP_TEMPLATES: readonly RecipeId[] = ['big-title', 'lower-third', 'kinetic', 'big-number', 'bar-chart', 'logo-reveal'];

/** What the model is asked for: the words as written, and only what the person chose — Auto is left to the model. */
export function planRequestOf(d: Pick<Draft, 'request' | 'format' | 'seconds' | 'palette'>, lang: Lang): PlanRequest {
  return { request: d.request.trim(), lang, format: d.format, seconds: d.seconds, palette: d.palette, recipe: null };
}

/** A template started from the form: its shape is the one chosen, else wide; its palette the one chosen, else its own. */
export function templateOptions(d: Pick<Draft, 'format' | 'palette'>): { format: Format; palette: PaletteId | undefined } {
  return { format: d.format ?? 'landscape', palette: d.palette ?? undefined };
}

/** Whether Make it can be pressed: there are words, and a model to send them to. */
export function canMake(d: Pick<Draft, 'request'>, ready: boolean): boolean {
  return ready && d.request.trim().length > 0;
}

/** What a graphic being made is called until the model names it: the request's first words. */
export function titleOfRequest(request: string, words = 6): string {
  const line = request.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).find(Boolean) ?? '';
  const parts = line.split(' ').filter(Boolean);
  let out = parts.slice(0, words).join(' ');
  let cut = parts.length > words;
  const chars = Array.from(out);
  if (chars.length > LIMITS.name) {
    out = chars.slice(0, LIMITS.name).join('').trimEnd();
    cut = true;
  }
  return cut ? `${out}…` : out;
}

/**
 * The graphic that stands in while the model makes one: the request, its
 * first words as a title, the shape, length and palette chosen (Auto as the
 * defaults), no layers, `planning`. Its id and `created` are kept when the
 * model's graphic replaces it.
 */
export function placeholderOf(o: {
  id: string;
  request: string;
  lang: Lang;
  draft: Pick<Draft, 'format' | 'seconds' | 'palette'>;
  now: number;
}): Motion {
  return {
    id: o.id, title: titleOfRequest(o.request), request: o.request.trim(), lang: o.lang,
    format: o.draft.format ?? 'landscape', fps: 30, seconds: o.draft.seconds ?? 6,
    palette: { ...paletteOf(o.draft.palette ?? undefined).colors }, backdrop: 'bg', layers: [], ai: true,
    stage: 'planning', created: o.now, updated: o.now,
  };
}

// ── the unload journal ────────────────────────────────────────────────────

/**
 * The most the journal holds, in characters. The panel writes the graphics
 * whose last edits were still waiting when the window was hidden or closed
 * (MotionPanel.tsx); a graphic without pictures is a few kilobytes, and one
 * with pictures is left to IndexedDB alone.
 */
export const JOURNAL_MAX = 2_000_000;

/**
 * The graphics in a journal, read as any stored graphic is: a finished graphic
 * whose id survived the reader, at most fifty; nothing at all from text that
 * is not a list of them. The journal is the app's own, but storage is
 * editable and this is read before anything else runs.
 */
export function journalOf(raw: string | null | undefined): Motion[] {
  if (typeof raw !== 'string' || !raw || raw.length > JOURNAL_MAX) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list.slice(0, 50).flatMap((x) => {
    const m = readMotion(x);
    const id = (x as { id?: unknown } | null)?.id;
    return m && m.stage === 'ready' && typeof id === 'string' && id === m.id ? [m] : [];
  });
}

/**
 * The graphics a start shows: the stored ones, each replaced by a newer copy
 * from the journal, and the journal's graphics the store never got; `write`
 * is what must be written again. A copy no newer than the stored one changes
 * nothing — its write landed after all.
 */
export function withJournal(stored: readonly Motion[], journal: readonly Motion[]): { list: Motion[]; write: Motion[] } {
  const by = new Map(stored.map((m) => [m.id, m]));
  const write: Motion[] = [];
  for (const m of journal) {
    const had = by.get(m.id);
    if (had && had.updated >= m.updated) continue;
    by.set(m.id, m);
    write.push(m);
  }
  return { list: [...by.values()], write };
}

// ── the list, and names ───────────────────────────────────────────────────

/** The graphics as the list shows them: the one changed last first. */
export function sortMotions(list: Iterable<Motion>): Motion[] {
  return [...list].sort((a, b) => b.updated - a.updated || b.created - a.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function formatName(f: Format, t: T): string {
  if (f === 'portrait') return t('Vertical 9:16');
  if (f === 'square') return t('Square 1:1');
  if (f === 'feed') return t('Feed 4:5');
  return t('Wide 16:9');
}

/** A shape's proportions, as a chip shows them: `16:9`. The same in every language. */
export function formatRatio(f: Format): string {
  return (FORMATS[f] ?? FORMATS.landscape).ratio;
}

export function langName(l: Lang, t: T): string {
  if (l === 'ar') return t('Arabic');
  if (l === 'ckb') return t('Kurdish — Sorani');
  if (l === 'kmr') return t('Kurdish — Badini');
  return t('English');
}

/** A length as it is written: `6 s`, `4.5 s`. */
export function secondsText(n: number, t: T): string {
  const s = Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
  return fill(t('{n} s'), { n: s });
}

/**
 * The width a thumbnail of this shape is drawn at to fit a `w` x `h` box: the
 * full width for a wide graphic, less for a tall one, whose height is the limit.
 */
export function fitWidth(f: Format, w: number, h: number): number {
  const s = FORMATS[f] ?? FORMATS.landscape;
  return Math.max(1, Math.floor(Math.min(w, (h * s.width) / s.height)));
}

// ── a run, in words ───────────────────────────────────────────────────────

/** Elapsed time as a clock: 0:07, 12:40, 1:02:03. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** What the model is doing while a graphic is made: a line that changes says it is working, until its answer starts arriving. */
export function planLine(ms: number, chars: number, t: T): string {
  if (chars > 0) return t('Writing the graphic…');
  const n = Math.floor(Math.max(0, ms) / 4000) % 4;
  if (n === 1) return `${t('Choosing a design')}…`;
  if (n === 2) return `${t('Placing the layers')}…`;
  if (n === 3) return `${t('Timing the motion')}…`;
  return `${t('Reading your request')}…`;
}

/**
 * Words from outside the app — a layer's id or a field the model wrote, a
 * title, a server's own message — set inside a translated sentence. They are
 * shown as written, but they cannot take the sentence over: controls that
 * reverse or embed text are dropped, the words are cut to `max` characters,
 * and they are isolated (U+2068 … U+2069), so an English id in an Arabic
 * sentence, or a right-to-left override the model wrote, stays inside its
 * own run and the sentence around it keeps its direction.
 */
export function quoted(s: unknown, max = 40): string {
  const one = String(s ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .trim();
  const chars = Array.from(one);
  const cut = chars.length > max ? `${chars.slice(0, Math.max(1, max - 1)).join('')}…` : one;
  return `\u2068${cut}\u2069`;
}

/** The HTTP status a failed request carried (generate.ts attaches it), or 0. */
function statusOf(e: unknown): number {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' && Number.isFinite(s) ? s : 0;
}

/**
 * A failed run as a sentence, in the interface's language. The engine says
 * what it could not read as a code (`motion:…`); a refused key, a server in
 * trouble, a limit reached and a connection that failed are said here, with
 * what to do — `host` is the address the request went to. Anything else is
 * the app's usual "Could not …" with its advice (errors.ts), `doing` being
 * what was attempted: "make the graphic".
 */
export function errorText(e: unknown, t: T, doing: string, host = ''): string {
  const code = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  if (code === 'motion:unreadable-plan') return t('The graphic could not be read from the model’s reply. Try again, or say it another way.');
  if (code === 'motion:unreadable-edit') return t('The change could not be read from the model’s reply. Try again, or say it another way.');
  if (code.startsWith('motion:')) return t('The model’s reply could not be read. Try again.');
  const status = statusOf(e);
  if (status === 401) return fill(t('{name} refused the key. Check it in Settings.'), { name: quoted(host || '—', 60) });
  if (status >= 500 || (!status && /overloaded/i.test(code))) return `${t('The server is having trouble.')} ${t('This is the server, not your account — try again shortly.')}`;
  if (status === 429) return `${fill(t('The server answered {n}.'), { n: status })} ${t('Wait a minute and try again.')}`;
  if (status >= 400) {
    // The server's own words, as it wrote them: what it refused, which no sentence here could know.
    const said = /^The server answered \d+:\s*([\s\S]*)$/.exec(code)?.[1]?.trim() ?? '';
    return said ? `${fill(t('The server answered {n}.'), { n: status })} ${quoted(said, 200)}` : fill(t('The server answered {n}.'), { n: status });
  }
  if (/^Could not reach /.test(code) || (e instanceof TypeError && /load failed|failed to fetch|network/i.test(code))) {
    return `${t('Could not reach that server.')} ${t('Check the address in Settings and that you are online.')}`;
  }
  return explain(e, doing);
}

/** The same while a message in the Ask tab is answered. */
export function askLine(ms: number, t: T): string {
  const n = Math.floor(Math.max(0, ms) / 4000) % 4;
  if (n === 1) return `${t('Looking at the layers')}…`;
  if (n === 2) return `${t('Planning the changes')}…`;
  if (n === 3) return `${t('Checking the timing')}…`;
  return `${t('Reading your message')}…`;
}

// ── undo ──────────────────────────────────────────────────────────────────

/** The history key of a drag or a burst of arrow presses on one layer: all of it is one step. */
export function moveKey(layerId: string): string {
  return `move:${layerId}`;
}

/**
 * The history after the person changed `before` into `next`, at `now`. The
 * history is first brought to `before` (`synced`): when something other than
 * the person changed the graphic since the last step — the model, a template —
 * it starts again from there, so an undo never puts back what the model has
 * since replaced. The same `key` within motionhistory's window joins the last
 * step; no key is a step of its own.
 */
export function recordEdit(h: MotionHistory | undefined, before: Motion, next: Motion, now: number, key?: string): MotionHistory {
  return recorded(synced(h ?? emptyHistory(before), before), next, now, key);
}

/** The step in progress ends here: the next edit is a step of its own, whatever its key. A drag's release does this. */
export function endStep(h: MotionHistory): MotionHistory {
  return h.key === null ? h : { ...h, key: null };
}

/**
 * Whether a drag that ends with the layer at `x`, `y` changed the graphic,
 * measured against the graphic as it was when the drag began. One that came
 * back to where it started changed nothing — not even the link to the template
 * that moving a layer by hand drops — so the panel puts the graphic back as it
 * was and records no step.
 */
export function dragChanged(before: Motion, now: Motion, layerId: string, x: number, y: number): boolean {
  const after = setLayer(now, layerId, { x, y });
  return !sameSnapshot(detach(before), detach(after));
}

// ── keys ──────────────────────────────────────────────────────────────────

/** What a key does to the open graphic. Space, the arrows, comma and full stop are the stage's own. */
export type KeyAct = 'undo' | 'redo' | 'remove' | 'duplicate' | 'escape';

export interface KeyPress {
  key: string;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** On a Mac the command key is ⌘; elsewhere it is Ctrl. */
  mac: boolean;
  /** The typing cursor is in a field: its keys, undo included, are the field's. */
  field: boolean;
}

/**
 * ⌘Z / Ctrl+Z undo, ⇧⌘Z / Ctrl+Shift+Z (and Ctrl+Y) redo, ⌘D / Ctrl+D
 * duplicate the chosen layer, Delete or Backspace remove it, Escape let go of
 * it. Nothing while the cursor is in a field.
 */
export function keyAction(p: KeyPress): KeyAct | null {
  if (p.field) return null;
  const mod = p.mac ? p.meta && !p.ctrl : p.ctrl && !p.meta;
  const k = p.key.toLowerCase();
  if (mod) {
    if (p.alt) return null;
    if (k === 'z') return p.shift ? 'redo' : 'undo';
    if (k === 'y' && !p.mac && !p.shift) return 'redo';
    if (k === 'd' && !p.shift) return 'duplicate';
    return null;
  }
  if (p.meta || p.ctrl || p.alt) return null;
  if (p.key === 'Delete' || p.key === 'Backspace') return 'remove';
  if (p.key === 'Escape') return 'escape';
  return null;
}

/**
 * The tab a key goes to in a list of `n` tabs, from the `i`th: the arrows step
 * and go round — the other way round in a right-to-left interface, where the
 * next tab is the one to the left — and Home and End go to either end. Null for
 * any other key, which the tab leaves alone.
 */
export function tabStep(i: number, key: string, rtl: boolean, n: number): number | null {
  if (!(n > 0)) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  const by = (key === 'ArrowRight') !== rtl ? 1 : -1;
  const from = Number.isInteger(i) && i >= 0 && i < n ? i : 0;
  return (from + by + n) % n;
}

// ── the Ask tab ───────────────────────────────────────────────────────────

/**
 * One line of the conversation with a graphic. It lives in the panel for the
 * session and is never stored: a graphic's history is its undo, not its chat.
 */
export interface ChatEntry {
  who: 'you' | 'motion';
  /** What the person wrote, or what the model said back. */
  text: string;
  /** What the answer changed, one note a change. */
  notes?: Note[];
  /** What it asked for and the app did not do, each with its reason. */
  skipped?: Note[];
  at: number;
  /** Nothing was applied: the answer could not be had, or the graphic changed while it was coming. Said with Try again. */
  failed?: boolean;
}

/** Turns kept a graphic: a long session keeps its newest. */
export const LOG_CAP = 80;

export function logged(log: readonly ChatEntry[], add: readonly ChatEntry[]): ChatEntry[] {
  return [...log, ...add].slice(-LOG_CAP);
}

/**
 * What becomes of an answer when it arrives: applied, or not because the
 * graphic is gone, or because the person changed it while the model was
 * answering (the answer was made for the graphic as it was sent), or because
 * it changed nothing.
 */
export function answerFate(sent: Motion, now: Motion | undefined, notes: readonly unknown[]): 'gone' | 'moved' | 'nothing' | 'apply' {
  if (!now) return 'gone';
  if (!sameSnapshot(sent, now)) return 'moved';
  return notes.length ? 'apply' : 'nothing';
}

/** Things to say to a graphic, in the interface's language; each is sent as it is. */
export function suggestions(t: T): string[] {
  return [t('Make it faster'), t('Make the title bigger'), t('Change the colours'), t('Make it shorter'), t('Add a subtitle')];
}

/** One of a graphic's five colours, by its role. */
export function toneName(tone: Tone, t: T): string {
  if (tone === 'bg') return t('Background');
  if (tone === 'fg') return t('Text colour');
  if (tone === 'accent') return t('Accent colour');
  if (tone === 'accent2') return t('Second accent');
  return t('Muted colour');
}

/**
 * A template's field, by its key, as the form labels it: the recipe's own
 * label when the recipe is known and has the key, else the first recipe's
 * that does (a `title` is a Title everywhere), else the key itself.
 */
function fieldName(key: string, t: T, recipe?: RecipeId): string {
  const own = recipe ? META[recipe]?.fields.find((f) => f.key === key) : undefined;
  const any = own ?? Object.values(META).map((m) => m.fields.find((f) => f.key === key)).find(Boolean);
  return any ? t(any.label) : quoted(key);
}

/** A multiplier as it is said: 1.5, 0.7 — at most two decimals. */
const times = (n: number) => String(Math.round(n * 100) / 100);

/**
 * A note from the model's answer, said in the interface's language: what an
 * applied change did, or why a change was skipped (motionchatops.ts `Note`).
 * `recipe` is the graphic's template, when it has one, so its fields are
 * named as its form names them.
 */
export function noteText(n: Note, t: T, recipe?: RecipeId): string {
  switch (n.code) {
    case 'fields': return fill(t('New words: {fields}'), { fields: n.keys.map((k) => fieldName(k, t, recipe)).join(' · ') });
    case 'palette': return fill(t('Colours: {name}'), { name: t(n.name) });
    case 'colors': return fill(t('New colour: {tones}'), { tones: n.tones.map((x) => toneName(x, t)).join(' · ') });
    case 'seconds': return fill(t('The graphic now runs {n} s'), { n: Math.round(n.value * 10) / 10 });
    case 'format': return fill(t('Shape: {format}'), { format: formatName(n.value, t) });
    case 'lang': return fill(t('The words are now in {lang}'), { lang: langName(n.value, t) });
    case 'title': return fill(t('Renamed to “{title}”'), { title: quoted(n.value, 60) });
    case 'layer': return fill(t('Changed the layer “{name}”'), { name: quoted(shownName(n.name, t)) });
    case 'add': return fill(t('Added a layer: {name}'), { name: quoted(shownName(n.name, t)) });
    case 'remove': return fill(t('Removed the layer “{name}”'), { name: quoted(shownName(n.name, t)) });
    case 'recipe': return fill(t('Started again from the template “{name}”'), { name: t(n.name) });
    case 'speed':
      return n.value >= 1
        ? fill(t('Everything moves {n} times as fast'), { n: times(n.value) })
        : fill(t('Everything moves more slowly: {n} times the speed'), { n: times(n.value) });
    case 'detached': return t('It is no longer a template: from now on its words are changed layer by layer');
    case 'sample': return t('A number nobody gave is an example for now: put in the real one in Design');
    case 'unknown': return fill(t('Skipped “{op}”: not something the app can do'), { op: quoted(n.op) });
    case 'invalid': return n.field ? fill(t('Skipped: “{what}” could not be read'), { what: quoted(n.field) }) : t('Skipped a change that could not be read');
    case 'no-layer': return fill(t('Skipped: there is no layer “{id}”'), { id: quoted(n.id) });
    case 'no-field': return fill(t('Skipped: “{field}” is not a setting of that layer'), { field: quoted(n.field) });
    case 'not-template': return t('Skipped: the words are changed layer by layer now, not in the template');
    case 'unsourced': return fill(t('Skipped: “{field}” would show a number nobody gave — write the number in your message'), { field: fieldName(n.field, t, recipe) });
    case 'untranslated': return fill(t('Not changed to {lang}: the words were not rewritten in it'), { lang: langName(n.value, t) });
    case 'refused': return fill(t('Skipped “{field}”: a picture comes only from you, never from the model'), { field: quoted(n.field) });
    case 'no-data': return t('Skipped: a chart needs numbers to draw');
    case 'full': return fill(t('Skipped: a graphic holds at most {n} layers'), { n: LIMITS.layers });
    case 'too-many': return fill(t('Skipped the rest: at most {n} changes a message'), { n: MAX_OPS });
    default: return t('Skipped a change that could not be read');
  }
}
