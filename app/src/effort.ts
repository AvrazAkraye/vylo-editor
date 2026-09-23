/**
 * How hard the model thinks before it answers.
 *
 * Effort is the Messages API's `output_config.effort`: `low`, `medium`,
 * `high`, `xhigh` or `max`. It decides how much the model reasons on each
 * turn, and so how long a turn takes and how many tokens it spends — thinking
 * is billed as output whether or not its text is shown, so on a plan with a
 * monthly token allowance a higher level uses the allowance up faster.
 *
 * ## Not every model takes it, and not every model takes every level
 *
 * Haiku 4.5 **rejects** the field outright, with a 400 on every request — and
 * the trial plan is Haiku only, so sending it unconditionally would break the
 * one plan somebody meets first. The 4.6 models accept four of the five
 * (`xhigh` arrived with Opus 4.7). Opus 4.5 takes three. So the levels are
 * per model, and a model this build cannot place gets no control at all
 * rather than a guess: a level sent to a model that refuses it is a failed
 * turn, every turn, with nothing on screen saying why.
 *
 * ## Why a level is always sent, never "the default"
 *
 * Omitting the field is how the API spells "use the model's own default", and
 * that would be the obvious way to offer a Default option. Through the Vylo
 * gateway it is not true. The gateway applies its *own* default per model when
 * a caller sends none — it runs Opus 5.5 at `low` for another product that
 * shares it — so an editor that omitted the field would show "medium" and run
 * `low`. Sending the chosen level every time is the only way the picker and
 * the request can say the same thing.
 *
 * ## Why it is remembered per model
 *
 * The same word does not mean the same amount of thinking on two models. On
 * Opus 5.5 `medium` beats Opus 5 at `high`; its default is `medium` where
 * every earlier Opus defaults to `high`. A single global setting would carry
 * a level chosen for one model onto another where it means something else,
 * so each model keeps its own, and starts at its own default.
 */

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Every level, least to most. The order is what `fit` rounds down along. */
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Where the chosen levels are kept, by model. */
export const EFFORT_KEY = 'vylo.effort.v1';

const ALL: readonly Effort[] = EFFORTS;
const NO_XHIGH: readonly Effort[] = ['low', 'medium', 'high', 'max'];
const THREE: readonly Effort[] = ['low', 'medium', 'high'];

/**
 * The levels a model accepts, least to most — or none.
 *
 * Read from the id's family and version rather than listed model by model, so
 * a newer Opus or Sonnet in the same line is covered the day it ships instead
 * of the day this file is edited:
 *
 *   Opus, Sonnet, Fable, Mythos — 4.7 and later   all five
 *   the 4.6 models                                 no `xhigh`
 *   Opus 4.5                                       low, medium, high
 *   Haiku, Sonnet 4.5, anything older or unknown   none
 *
 * Haiku is excluded by family, not by version: no Haiku has taken the field,
 * and assuming the next one will is the kind of guess that fails every turn.
 */
export function effortsFor(model: string): readonly Effort[] {
  const m = /^claude-(opus|sonnet|fable|mythos)-(\d+)(?:-(\d+))?(?:$|-)/.exec(
    typeof model === 'string' ? model.trim().toLowerCase() : '',
  );
  if (!m) return [];
  const [, family, majorS, minorS] = m;
  const major = Number(majorS);
  // An id with no minor version is the whole line at that major: `claude-opus-5`.
  // A date suffix is not a minor version: `claude-opus-4-20250514` is Opus 4,
  // not Opus 4.20250514, and reading it as the latter would hand every level
  // to a model that takes none. A minor version is one or two digits.
  const minor = minorS && minorS.length <= 2 ? Number(minorS) : 0;
  if (major >= 5) return ALL;
  if (major === 4 && minor >= 7) return ALL;
  if (major === 4 && minor === 6) return NO_XHIGH;
  if (major === 4 && minor === 5 && family === 'opus') return THREE;
  return [];
}

/** Whether a model takes the field at all. */
export const takesEffort = (model: string): boolean => effortsFor(model).length > 0;

/**
 * What the model does when the field is left out, per the API.
 *
 * Every model that takes effort defaults to `high` — except Opus 5.5, which
 * defaults to `medium`. That is where a model starts in this app before
 * anybody has chosen, so that picking Opus 5.5 behaves as Anthropic tuned it
 * rather than one level hotter.
 */
export function defaultEffort(model: string): Effort | null {
  const levels = effortsFor(model);
  if (!levels.length) return null;
  if (/^claude-opus-5-5(?:$|-)/.test(model.trim().toLowerCase())) return 'medium';
  return levels.includes('high') ? 'high' : levels[levels.length - 1];
}

/**
 * The nearest level a model accepts, rounding *down*.
 *
 * Down rather than up: a level somebody chose was a decision about how much to
 * spend, and quietly spending more than they asked for is the worse surprise.
 * `xhigh` on a 4.6 model becomes `high`. Nothing below the lowest level exists,
 * so a level under it becomes the lowest.
 */
export function fit(model: string, level: Effort): Effort | null {
  const levels = effortsFor(model);
  if (!levels.length) return null;
  if (levels.includes(level)) return level;
  const want = EFFORTS.indexOf(level);
  for (let i = want; i >= 0; i--) {
    if (levels.includes(EFFORTS[i])) return EFFORTS[i];
  }
  return levels[0];
}

/** The chosen level for each model that has one. */
export type EffortBook = Readonly<Record<string, Effort>>;

const isEffort = (v: unknown): v is Effort =>
  typeof v === 'string' && (EFFORTS as readonly string[]).includes(v);

/**
 * Stored choices, repaired.
 *
 * A bad record is no choices, never a throw — this runs before the composer
 * draws. A level stored for a model is kept even if it is not one the model
 * accepts today, because `effortOf` fits it on the way out; discarding it
 * here would forget a choice the moment a model's table changed.
 */
export function readEfforts(raw: string | null): EffortBook {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, Effort> = {};
    for (const [model, level] of Object.entries(v as Record<string, unknown>)) {
      if (model.trim() && isEffort(level)) out[model] = level;
    }
    return out;
  } catch {
    return {};
  }
}

export const writeEfforts = (b: EffortBook): string => JSON.stringify(b);

/**
 * The level to send for a model, or `null` to send nothing.
 *
 * What was chosen for this model, fitted to what it accepts; otherwise its
 * own default. `null` only for a model that takes no effort at all, which is
 * the one case where leaving the field out is not a choice but a requirement.
 */
export function effortOf(book: EffortBook, model: string): Effort | null {
  const chosen = book[model];
  return chosen ? fit(model, chosen) : defaultEffort(model);
}

/** The book with one model's level changed. Nothing passed in is mutated. */
export function setEffort(book: EffortBook, model: string, level: Effort): EffortBook {
  if (!model.trim() || !isEffort(level)) return { ...book };
  return { ...book, [model]: level };
}

/**
 * The field for a request body, or nothing.
 *
 * Spread rather than assigned, for the reason `quoting` gives in whatsapp.ts:
 * an absent `output_config` and an empty one are not the same thing to a
 * server that validates the field.
 *
 * Only on the Anthropic wire. The OpenAI-shaped providers a person adds have
 * their own reasoning control with its own name and its own levels, and
 * translating one into the other would be a guess about somebody else's API.
 */
export function effortField(
  wire: 'anthropic' | 'openai', book: EffortBook, model: string,
): { output_config?: { effort: Effort } } {
  if (wire !== 'anthropic') return {};
  const level = effortOf(book, model);
  return level ? { output_config: { effort: level } } : {};
}

/**
 * A level as the composer says it.
 *
 * Short, because it sits beside the model's name in a row that already holds
 * the mode, the model and the send button; the control's own label and
 * tooltip say it is effort. `xhigh` is the API's spelling and nobody's word
 * for anything, so it is "Extra high" on screen.
 */
export function effortLabel(level: Effort, t: (s: string) => string): string {
  return level === 'low' ? t('Low')
    : level === 'medium' ? t('Medium')
      : level === 'high' ? t('High')
        : level === 'xhigh' ? t('Extra high')
          : t('Max');
}
