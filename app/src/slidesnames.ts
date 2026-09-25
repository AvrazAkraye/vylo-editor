import type { DeckKind, DeckLang, SlideKind, Theme } from './slides';

/**
 * What the Slides module's kinds, looks and languages are called, in the
 * interface's language — one place, for the panel and the Chat tab alike.
 */

type T = (s: string) => string;

export function kindName(k: DeckKind, t: T): string {
  if (k === 'defense') return t('Thesis defence');
  if (k === 'lecture') return t('Lecture');
  if (k === 'class') return t('Class presentation');
  if (k === 'conference') return t('Conference talk');
  if (k === 'pitch') return t('Business pitch');
  return t('General');
}

export function kindAbout(k: DeckKind, t: T): string {
  if (k === 'defense') return t('Before an examining committee: the problem, the method, the results, the conclusions.');
  if (k === 'lecture') return t('A class taught step by step, with examples and a summary.');
  if (k === 'class') return t('A student’s talk or seminar.');
  if (k === 'conference') return t('A research talk of ten to fifteen minutes.');
  if (k === 'pitch') return t('A problem, a solution, and what you are asking for.');
  return t('Any subject, clearly built.');
}

export function themeName(th: Theme, t: T): string {
  if (th === 'academic') return t('Academic');
  if (th === 'modern') return t('Modern');
  if (th === 'elegant') return t('Elegant');
  if (th === 'bold') return t('Bold');
  if (th === 'minimal') return t('Minimal');
  return t('Warm');
}

export function slideKindName(k: SlideKind, t: T): string {
  if (k === 'title') return t('Title slide');
  if (k === 'section') return t('Section divider');
  if (k === 'bullets') return t('Points');
  if (k === 'two') return t('Two columns');
  if (k === 'stat') return t('Big numbers');
  if (k === 'table') return t('Table');
  if (k === 'timeline') return t('Steps in order');
  if (k === 'quote') return t('Quotation');
  if (k === 'references') return t('References');
  return t('Closing slide');
}

export function langName(l: DeckLang, t: T): string {
  if (l === 'ar') return t('Arabic');
  if (l === 'ckb') return t('Kurdish — Sorani');
  if (l === 'kmr') return t('Kurdish — Badini');
  return t('English');
}
