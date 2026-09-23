/**
 * The models this app offers, in one place.
 *
 * A list rather than a text field. Anthropic writes "Opus 4.8" in prose but
 * `claude-opus-4-8` in the API, so a free-text box invites a dotted id and a
 * 404 the gateway can only pass along. The gateway now repairs that too, but
 * not offering the mistake is better than fixing it.
 *
 * It lives in its own module because two surfaces need it and they must agree:
 * the composer's picker, which greys out what the plan cannot run, and the
 * Usage panel, which lists what the plan can run and what a bigger one adds.
 * A model named in one and not the other would be a plan the app describes
 * two ways.
 */

export interface Model {
  /** As the API spells it. */
  id: string;
  /** As a picker spells it. */
  short: string;
  /** As a menu that has room spells it. */
  label: string;
}

export const MODELS: Model[] = [
  { id: 'claude-haiku-4-5', short: 'Haiku 4.5', label: 'Haiku 4.5 — fastest, cheapest' },
  { id: 'claude-sonnet-5', short: 'Sonnet 5', label: 'Sonnet 5 — balanced' },
  { id: 'claude-opus-4-8', short: 'Opus 4.8', label: 'Opus 4.8 — the previous Opus' },
  // Last, because the list runs from least to most capable and this is now the
  // most. Its thinking cannot be switched off — effort is the only control —
  // and it defaults to `medium` where every earlier Opus defaults to `high`;
  // see effort.ts.
  { id: 'claude-opus-5-5', short: 'Opus 5.5', label: 'Opus 5.5 — most capable' },
];

/**
 * A model id as a person would say it, falling back to the id itself.
 *
 * The fallback is the point: a gateway may well offer a model this build has
 * never heard of, and printing its id is how the Usage panel stays truthful
 * about a plan rather than quietly dropping what it cannot name.
 */
export function modelName(id: string): string {
  return MODELS.find((m) => m.id === id)?.short ?? id;
}
