/**
 * Finding things in WhatsApp — chats by name, messages by what was said.
 *
 * Pure arithmetic over what `whatsapp.ts` has already parsed, so the awkward
 * part is testable. The awkward part is not the search; it is the *matching*.
 *
 * ## Why a plain `includes` is not enough here
 *
 * This inbox is Arabic, Sorani, Badini and English in the same thread, often
 * in the same sentence, and every one of those scripts has more than one way
 * to write the same word:
 *
 *   ي ی ى     three yehs. Arabic keyboards send U+064A, Persian and Kurdish
 *             ones U+06CC, and U+0649 turns up at the end of words. The same
 *             name is spelled all three ways by three people.
 *   ك ک       two kafs, the same split.
 *   ه ە       Sorani writes final -e as U+06D5 and half the keyboards in use
 *             send U+0647. Visually the same letter in that position.
 *   أ إ آ ٱ   alef with anything on it. People type whichever is easiest.
 *   ة         teh marbuta, which is an -a that is also an -h.
 *   ـ         tatweel, a stretch character with no sound at all, inserted for
 *             justification and pasted along with the text.
 *   ً ٌ ٍ َ ُ ِ ّ ْ   harakat. Written on formal text, never typed into a search box.
 *   ٠١٢ ۰۱۲   two sets of Arabic-Indic digits, and a phone number can arrive
 *             in either while somebody searches in the Latin ones.
 *
 * So a search for "يوسف" has to find "یوسف", and "123" has to find "١٢٣".
 * Without that this box would look broken to the only people who would use it.
 *
 * **What is deliberately NOT folded:** ڕ ڵ ۆ ێ ڤ ژ چ پ گ and ئ. Those are
 * letters of Kurdish, not variants of an Arabic one — folding ئ to ی would
 * merge the vowel carrier that starts a third of Sorani words with a
 * consonant, and folding ڕ to ر would merge two different sounds. A search
 * that cannot tell ڕۆژ from رۆژ is worse than one that is strict.
 *
 * ## Why the positions come back with the match
 *
 * Folding changes the length: a tatweel goes, a haraka goes, so character 9 of
 * the folded string may be character 12 of what is on screen. Highlighting
 * needs the *original* offsets, so `folded` carries an index for every
 * character it keeps and `ranges` maps back through it. Anything that folded
 * by substitution alone could skip this; the deletions are what make it
 * necessary.
 */

import { isGroup, phoneOf, type Chat, type Msg } from './whatsapp';

/**
 * Marks that hang off the character before them.
 *
 * The Latin combining range, the harakat, the hamza and maddah that sit on an
 * alef, the superscript alef, and the Quranic marks. They are consumed *with*
 * their base rather than tested on their own, which is the whole trick — see
 * `folded` for why testing them on their own cannot work.
 */
const MARK = /[\u0300-\u036F\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u08D3-\u08FF]/;

/**
 * Characters with no sound and no business in a comparison.
 *
 * Tatweel, which is a stretch with no sound at all and gets pasted along with
 * the text, and the bidi controls — which arrive in every other copy-paste out
 * of an RTL app and would otherwise make two identical strings differ.
 */
const DROP = /[\u0640\u200B-\u200F\u202A-\u202E\u2066-\u2069]/;

/**
 * One character for another, same count, written in *precomposed* characters.
 *
 * Each line is one of the spellings above. The digits are here rather than in
 * a range check because both Arabic-Indic blocks map to the same ten Latin
 * ones, and a table says that in one place.
 */
const SAME: Record<string, string> = {
  '\u064A': '\u06CC', '\u0649': '\u06CC',                    // ي ى → ی
  '\u0643': '\u06A9',                                        // ك → ک
  '\u06D5': '\u0647', '\u0629': '\u0647',                    // ە ة → ه
  '\u0623': '\u0627', '\u0625': '\u0627',                    // أ إ → ا
  '\u0622': '\u0627', '\u0671': '\u0627',                    // آ ٱ → ا
  '\u0624': '\u0648',                                        // ؤ → و
  '\u0660': '0', '\u0661': '1', '\u0662': '2', '\u0663': '3', '\u0664': '4',
  '\u0665': '5', '\u0666': '6', '\u0667': '7', '\u0668': '8', '\u0669': '9',
  '\u06F0': '0', '\u06F1': '1', '\u06F2': '2', '\u06F3': '3', '\u06F4': '4',
  '\u06F5': '5', '\u06F6': '6', '\u06F7': '7', '\u06F8': '8', '\u06F9': '9',
};

/** The folded text, and where each of its characters came from. */
export interface Folded {
  /** What to search in. */
  s: string;
  /** `at[i]` is the index in the original string of folded character `i`. */
  at: number[];
}

/**
 * Text prepared for matching, with the way back.
 *
 * ## Why this composes before it does anything else
 *
 * The obvious implementation is NFD, drop every combining mark, done. It is
 * wrong here, and wrong in a way that only shows up in Kurdish.
 *
 * In NFD, أ is alef plus U+0654 HAMZA ABOVE — and ئ is *yeh* plus the same
 * U+0654. Dropping combining marks turns أ into ا, which is wanted, and ئ into
 * ي, which is not: ئ is the vowel carrier that begins a third of the words in
 * Sorani, and merging it with a consonant would make a search for ئەم find
 * every یەم in the inbox. The mark cannot be judged without its base.
 *
 * So each character is taken with whatever hangs off it, that cluster is
 * composed, and the decision is made on the single character that comes out:
 * أ is in the table and folds to ا, ئ is not in the table and stays itself.
 * A cluster that does not compose — a letter with a haraka on it — keeps its
 * base and drops the rest, which is the same answer by a different route.
 *
 * Latin accents are still stripped by decomposition, but only after the table
 * has had its say and only when every mark is in the Latin range, so no Arabic
 * character ever reaches that branch.
 *
 * ## The index map
 *
 * Folding deletes characters, so folded position 9 may be original position
 * 12. `at` carries the original index of every character kept, and it is what
 * lets a highlight land where the eye expects it. Iteration is by code point
 * rather than by UTF-16 unit, because chat text is full of emoji and half a
 * surrogate pair is not a character.
 */
export function folded(text: string): Folded {
  const src = typeof text === 'string' ? text : '';
  const units = [...src];
  let s = '';
  const at: number[] = [];
  let idx = 0;
  for (let k = 0; k < units.length; k++) {
    const base = units[k];
    const start = idx;
    idx += base.length;
    // Everything that hangs off this character comes with it, and is gone
    // from the result unless composing puts it back.
    let cluster = base;
    while (k + 1 < units.length && MARK.test(units[k + 1])) {
      k += 1;
      cluster += units[k];
      idx += units[k].length;
    }
    // A mark with nothing before it, or a character with no sound.
    if (MARK.test(base) || DROP.test(base)) continue;
    const one = cluster.normalize('NFC');
    let c = [...one].length === 1 ? one : base;
    if (SAME[c] !== undefined) {
      c = SAME[c];
    } else {
      const d = c.normalize('NFD');
      const tail = [...d].slice(1);
      if (tail.length > 0 && tail.every((x) => x >= '\u0300' && x <= '\u036F')) c = [...d][0];
      c = c.toLowerCase();
      if ([...c].length > 1) c = [...c][0];
    }
    s += c;
    at.push(start);
  }
  return { s, at };
}

/** The words of a query, folded, with the empties gone. */
function words(query: string): string[] {
  return folded(typeof query === 'string' ? query : '').s
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/**
 * Whether `text` contains every word of `query`.
 *
 * Every word rather than the whole phrase, because "ahmad baghdad" should find
 * a chat named "Ahmad from Baghdad" — somebody searching a name types the two
 * parts they remember, not the string as it was saved. An empty query matches
 * everything, which is what makes a search box that has not been typed in yet
 * show the whole list.
 */
export function matches(text: string, query: string): boolean {
  const q = words(query);
  if (q.length === 0) return true;
  const { s } = folded(text);
  return q.every((w) => s.includes(w));
}

/**
 * Where to draw a highlight, as `[start, end)` pairs on the ORIGINAL text.
 *
 * Every occurrence of every word, merged where they touch or overlap, in
 * order. Merging matters for a query like "ali ali" and for two words that
 * happen to be adjacent in the text: two `<mark>` elements with nothing
 * between them draw a seam.
 *
 * The end offset is the index *after* the last character, taken from the next
 * kept character's origin so that anything dropped inside the match — a
 * tatweel in the middle of a word — is highlighted along with it rather than
 * left as a gap.
 */
export function ranges(text: string, query: string): Array<[number, number]> {
  const q = words(query);
  if (q.length === 0) return [];
  const { s, at } = folded(text);
  if (!s) return [];
  const src = typeof text === 'string' ? text : '';
  const found: Array<[number, number]> = [];
  for (const w of q) {
    let i = s.indexOf(w);
    while (i !== -1) {
      const start = at[i];
      // The character after the match, or the end of the string when the match
      // runs to it.
      const last = i + w.length;
      const end = last < at.length ? at[last] : src.length;
      found.push([start, end]);
      i = s.indexOf(w, i + 1);
    }
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Array<[number, number]> = [];
  for (const r of found) {
    const prev = out[out.length - 1];
    if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/**
 * The text split into runs, marked or not, ready to draw.
 *
 * A component that has to build this itself gets the off-by-one wrong once and
 * then draws a highlight one character to the left for the rest of its life.
 * The whole string is always accounted for: concatenating every `text` back
 * together gives what went in, so nothing can be silently dropped.
 */
export function marked(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const src = typeof text === 'string' ? text : '';
  const rs = ranges(src, query);
  if (rs.length === 0) return src ? [{ text: src, hit: false }] : [];
  const out: Array<{ text: string; hit: boolean }> = [];
  let cursor = 0;
  for (const [a, b] of rs) {
    if (a > cursor) out.push({ text: src.slice(cursor, a), hit: false });
    out.push({ text: src.slice(a, b), hit: true });
    cursor = b;
  }
  if (cursor < src.length) out.push({ text: src.slice(cursor), hit: false });
  return out;
}

/**
 * The chats a query keeps.
 *
 * Matched on the name, on the number behind the jid, and on the last thing
 * said — three things somebody could be searching by, and the last one is why
 * this is not just a name filter: "the chat where someone sent the address" is
 * how people look for a conversation they cannot name.
 *
 * Order is left exactly as it came in. The list is sorted by recency and a
 * search that reorders it makes the eye start again.
 */
export function findChats(chats: readonly Chat[], query: string): Chat[] {
  if (words(query).length === 0) return [...chats];
  return chats.filter((c) => matches(c.name, query)
    || matches(phoneOf(c.jid), query)
    || matches(c.last, query)
    // A group is worth finding by the word "group" in any of the four
    // languages the app speaks? No — that would need the catalogue in here.
    // The jid is the honest fallback, and it is what the row shows when a
    // group has no name to show instead.
    || (isGroup(c.jid) && matches(c.jid, query)));
}

/** One message that matched, and the chat it is in. */
export interface Hit {
  msg: Msg;
  /** The conversation's display name at the time of searching. */
  name: string;
}

/**
 * Messages matching a query, newest first.
 *
 * Newest first, against the thread's own oldest-first order, because a search
 * result list is read from the top and the recent one is nearly always the one
 * wanted. `cap` keeps a long history from rendering thousands of rows into a
 * 248-pixel column; the count of what matched is reported separately so the
 * list can say "showing 50 of 300" rather than quietly lying.
 */
export function findMsgs(msgs: readonly Msg[], query: string, cap = 60): { hits: Msg[]; total: number } {
  if (words(query).length === 0) return { hits: [], total: 0 };
  const all = msgs.filter((m) => m.text && matches(m.text, query));
  const hits = [...all].sort((a, b) => b.at - a.at).slice(0, Math.max(0, cap));
  return { hits, total: all.length };
}

/**
 * The same, across every conversation, with the name each one belongs to.
 *
 * `names` is the chat list keyed by jid rather than a lookup function, because
 * the caller already has that list built and the alternative is this module
 * knowing how a name is derived — which is `chatsFrom`'s job and involves a
 * fallback chain this has no business repeating.
 */
export function findEverywhere(
  msgs: readonly Msg[],
  query: string,
  names: Readonly<Record<string, string>>,
  cap = 60,
): { hits: Hit[]; total: number } {
  const { hits, total } = findMsgs(msgs, query, cap);
  return { hits: hits.map((m) => ({ msg: m, name: names[m.jid] || phoneOf(m.jid) || m.jid })), total };
}

/**
 * A short piece of the message around the first match, for a result row.
 *
 * A result row is one line. Showing the start of a long message when the match
 * is four hundred characters in shows nothing of why it matched, so the window
 * is centred on the hit — backed up to a word boundary where there is one
 * nearby, so it does not begin mid-word.
 *
 * The returned offsets are still original offsets, shifted by the cut, so
 * `marked` can be run on the snippet and highlight the same characters.
 */
export function snippet(text: string, query: string, width = 90): string {
  const src = typeof text === 'string' ? text : '';
  if (src.length <= width) return src;
  const rs = ranges(src, query);
  const hit = rs.length > 0 ? rs[0][0] : 0;
  if (hit < width) return `${src.slice(0, width)}…`;
  // A third of the window before the match, so there is context on both sides.
  let start = Math.max(0, hit - Math.floor(width / 3));
  const space = src.lastIndexOf(' ', start);
  if (space !== -1 && start - space < 12) start = space + 1;
  const end = Math.min(src.length, start + width);
  return `${start > 0 ? '…' : ''}${src.slice(start, end)}${end < src.length ? '…' : ''}`;
}
