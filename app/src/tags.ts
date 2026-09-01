/**
 * A colour on a chat, and on a terminal session.
 *
 * Both lists are rows of text that look identical until you read them. A colour
 * is the fastest thing a person can scan, and the only one that survives being
 * glanced at from across the desk.
 *
 * ## Eight, not a picker
 *
 * A colour picker offers sixteen million choices and cannot promise that any of
 * them is legible. These eight are tokens, defined in all three theme blocks, so
 * each has a value chosen for the light ground and another for the dark one —
 * which is the thing a picker structurally cannot do, because the person
 * choosing is looking at one theme and the person reading may be in the other.
 *
 * Eight is also about as many as anybody can tell apart at the size these are
 * drawn. A ninth would be a colour somebody has to squint at to distinguish
 * from a neighbour, which is worse than not having it.
 *
 * ## `none` is a value
 *
 * Untagged is a choice a person makes, not the absence of one — so it is in the
 * list, first, and clearing a tag is picking it rather than pressing something
 * else. That also means `tagOf` never has to answer "what if it is missing":
 * missing and `none` are the same thing and both mean draw nothing.
 */

/** The tag names. Stored as these strings, so a rename here is a migration. */
export const TAGS = [
  'none', 'red', 'amber', 'green', 'teal', 'blue', 'violet', 'pink', 'grey',
] as const;

export type Tag = typeof TAGS[number];

/** Everything except `none`, which is what a picker offers as swatches. */
export const SWATCHES: readonly Tag[] = TAGS.filter((t) => t !== 'none');

/**
 * The English label, which is also the i18n key.
 *
 * Colour names are translated like anything else: a screen reader announcing
 * "red" to somebody using the app in Kurdish is the same failure as an
 * untranslated button, and this is the only text a tag has.
 */
export const LABELS: Record<Tag, string> = {
  none: 'No colour',
  red: 'Red',
  amber: 'Amber',
  green: 'Green',
  teal: 'Teal',
  blue: 'Blue',
  violet: 'Violet',
  pink: 'Pink',
  grey: 'Grey',
};

/**
 * A stored value, made safe.
 *
 * The store is JSON on disk that a person can edit and an older version of this
 * app can write, so anything can arrive here. An unknown name is `none` rather
 * than an error: a tag nobody recognises should make a row plain, not stop the
 * list from rendering.
 */
export function tagOf(value: unknown): Tag {
  return typeof value === 'string' && (TAGS as readonly string[]).includes(value)
    ? value as Tag
    : 'none';
}

/** The CSS class for a row, or '' when there is nothing to draw. */
export function tagClass(value: unknown): string {
  const t = tagOf(value);
  return t === 'none' ? '' : `tag-${t}`;
}

/**
 * The next tag in the ring, for cycling with a keystroke.
 *
 * Wraps through `none`, so the cycle always passes back through "no colour"
 * rather than trapping somebody in a ring of eight they have to leave with the
 * mouse.
 */
export function nextTag(value: unknown): Tag {
  const i = TAGS.indexOf(tagOf(value));
  return TAGS[(i + 1) % TAGS.length];
}
