/**
 * Emphasis matching, shared by the engine (video.ts checks the words a model
 * or a person asks for) and the renderer (the scenes set those words in the
 * accent), so the two can never disagree about what an emphasis lights up.
 *
 * A scene draws its words split at their spaces, so that is a word here too:
 * "e-mail" and "24/7" are one word each, and an emphasis of "mail" is not in
 * them. A phrase ("for you") is its words in order, and lights only where
 * they stand together — not every "for" in the line.
 */
import { fold } from './settings';

/**
 * A word as emphasis matches it: the app's fold (case, marks, the Arabic
 * letter forms), a phone's curly apostrophe as a plain one, Kurdish ە typed
 * as ه, and the punctuation around it gone — so "free," in a line matches
 * "Free" in the art.
 */
export function emphasisKey(word: string): string {
  return fold(word)
    .replace(/[’‘ʼ]/g, "'")
    .replace(/ە/g, 'ه')
    .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
}

/** An emphasis entry as the words it matches, folded; empty when it has none. */
export function phraseOf(entry: string): string[] {
  return entry.split(/\s+/).map(emphasisKey).filter(Boolean);
}

/**
 * Which of a line's words (split at spaces, as drawn) belong to one of the
 * phrases: each place a phrase's words stand in a row. A bare mark between
 * them ("salt & pepper") is part of the run; one before or after is not.
 */
export function markPhrases(words: readonly string[], phrases: readonly (readonly string[])[]): boolean[] {
  const out = words.map(() => false);
  if (!phrases.length) return out;
  const at: number[] = [];
  const keys: string[] = [];
  words.forEach((w, i) => {
    const k = emphasisKey(w);
    if (k) { at.push(i); keys.push(k); }
  });
  for (const ph of phrases) {
    if (!ph.length) continue;
    for (let i = 0; i + ph.length <= keys.length; i++) {
      if (!ph.every((w, k) => keys[i + k] === w)) continue;
      for (let j = at[i]; j <= at[i + ph.length - 1]; j++) out[j] = true;
    }
  }
  return out;
}

/**
 * The places a phrase stands in a text, each line on its own (a phrase never
 * runs from one line into the next): where it starts and ends in `text`,
 * without the punctuation around it.
 */
export function phraseSpans(text: string, phrase: readonly string[]): { at: number; end: number }[] {
  const out: { at: number; end: number }[] = [];
  if (!phrase.length) return out;
  let base = 0;
  for (const line of text.split('\n')) {
    const words: { k: string; at: number; end: number }[] = [];
    for (const m of line.matchAll(/\S+/g)) {
      const k = emphasisKey(m[0]);
      if (!k) continue;
      const i = m.index ?? 0;
      const lead = m[0].length - m[0].replace(/^[\p{P}\p{S}]+/u, '').length;
      const tail = m[0].length - m[0].replace(/[\p{P}\p{S}]+$/u, '').length;
      words.push({ k, at: base + i + lead, end: base + i + m[0].length - tail });
    }
    for (let i = 0; i + phrase.length <= words.length; i++) {
      if (phrase.every((w, k) => words[i + k].k === w)) out.push({ at: words[i].at, end: words[i + phrase.length - 1].end });
    }
    base += line.length + 1;
  }
  return out;
}
