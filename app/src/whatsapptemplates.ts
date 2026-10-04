import { TEMPLATES_A } from './whatsapptemplates-a';
import { TEMPLATES_B } from './whatsapptemplates-b';
import { MESSAGE_LANGS, type Category, type CategoryId, type Lang, type Template, type TemplateKind } from './whatsappbulktypes';

/**
 * The ready messages. PLACEHOLDER from Phase 0 (docs/WA.md): `templates-a` replaces this file with the API
 * (categories, search, lookup, filling) and the first half of the library; `templates-b` writes
 * `whatsapptemplates-b.ts`, the second half, which this file merges. Names and signatures are the contract.
 */
export const CATEGORIES: readonly Category[] = [];

export const TEMPLATES: readonly Template[] = [...TEMPLATES_A, ...TEMPLATES_B];

/** The languages every template is written in. */
export const TEMPLATE_LANGS: readonly Lang[] = MESSAGE_LANGS;

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** The templates matching a search in a language (title, text and tags), best first; an empty search lists them in category order. */
export function searchTemplates(
  _query: string, _lang: Lang, _o: { category?: CategoryId; kind?: TemplateKind } = {},
): Template[] {
  return [];
}

/** A template's text in a language with the placeholders that `values` names filled in; the others (`{name}`) are left for each person. */
export function fillTemplate(t: Template, lang: Lang, _values: Record<string, string>): string {
  return t.text[lang];
}
