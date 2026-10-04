import type { Target } from './generate';

/**
 * Which model a request goes to (Motion's form uses it first).
 *
 * The composer has always had a model menu; Motion used whatever it said. The request form now has its own
 * "Model" choice, next to Shape, Length and Palette, because the person making a graphic is the one who knows
 * whether it is worth waiting for the most capable model or a quick sketch from the fastest. The default is
 * **Auto**: the composer's model, exactly as before.
 *
 * Only a model the connection already offers can be picked, and only one the plan can run. The list comes from
 * App (the built-in models with the plan's `allows`, or the chosen provider's own models), and `routeFor` refuses
 * anything not in it, so a stale or tampered stored choice falls back to the composer's model rather than sending
 * a request somewhere the person did not choose. The key and the address are never touched: only `model` changes.
 */
export interface ModelChoice {
  id: string;
  /** As the menu spells it. */
  label: string;
  /** False when the plan cannot run it (shown, but not selectable, so the refusal is not a mystery). */
  ok: boolean;
}

/** Where the choice is remembered between sessions. */
export const MODEL_KEY = 'vylo.motion.model.v1';

/** The menu for a connection: the built-in models, or the chosen provider's own. */
export function choicesFor(
  builtIn: boolean,
  models: readonly { id: string; short: string }[],
  allowed: (id: string) => boolean,
  providerModels: readonly string[],
): ModelChoice[] {
  if (builtIn) return models.map((m) => ({ id: m.id, label: m.short, ok: allowed(m.id) }));
  return providerModels.filter((m) => typeof m === 'string' && m.length > 0 && m.length < 200).slice(0, 40).map((id) => ({ id, label: id, ok: true }));
}

/** A stored choice read back: the id when it is on the menu and runnable, otherwise '' (Auto). */
export function readPick(raw: unknown, choices: readonly ModelChoice[] | undefined): string {
  if (typeof raw !== 'string' || !raw) return '';
  return choices?.some((c) => c.id === raw && c.ok) ? raw : '';
}

/** The route a request takes: the composer's, with the model swapped when a runnable one is picked. */
export function routeFor(gw: Target, choices: readonly ModelChoice[] | undefined, pick: unknown): Target {
  const id = readPick(pick, choices);
  return id && id !== gw.model ? { ...gw, model: id } : gw;
}
