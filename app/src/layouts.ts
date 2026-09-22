/**
 * Snap presets for the terminal panes.
 *
 * `panes.ts` says which terminals are on screen and `split.ts` says how wide
 * each one is, and between them a person can arrange three panes any way they
 * like — one click and one drag at a time. That is the right way to *adjust* a
 * layout and a slow way to *get to* one. "The one I am in, wide, with the test
 * runner beside it" is a shape somebody wants ten times a day, and building it
 * by hand is four gestures every time. A preset is that shape as one button.
 *
 * ## The shapes, and why these five
 *
 *   solo       one pane: the one you are in. Everything else out of the way.
 *   pair       two panes, even. Reading one thing against another.
 *   workbench  two panes, the one you are in wide. Working in one and
 *              glancing at the other — a server log, a test runner.
 *   quad       four panes, even, in a row. The row full, in one press.
 *   grid       six panes, three across and two down. The row's own argument
 *              against a fifth pane was about width, and a grid answers it:
 *              each pane is a *third* of the panel wide rather than a fifth,
 *              at the cost of height the panel has more of than it needs. So
 *              a grid holds more than a row rather than the same four.
 *   tidy       whatever is on screen, evened out. Not a shape but a repair:
 *              after a few drags the row is 40/23/37 and nobody chose that.
 *              BridgeMind's phrase for it is "squares the layout back up".
 *
 * Nothing here for three, and that was the gap. "Three even is what showing a
 * third already gives you, one click at a time" is true and was not the point:
 * somebody who wants three wants to say three, not to count clicks and stop.
 *
 * ## Asking for a number
 *
 * So `apply` also takes a count. One to `MAX_GRID`, evenly sized — the shape
 * `solo`, `pair` and `quad` already are at 1, 2 and 4, and the ones nothing
 * reached at 3, 5 and 6. The named presets stay because they say something a
 * count does not: `workbench` is two panes *unevenly*, and `quad` and `grid`
 * are the two arrangements, one filled.
 *
 * A count says how many and nothing about the arrangement, so it keeps the
 * one the row is already in — which is what "it should work on the grid too"
 * means. Four in a row and four in a grid are both four; only the panel knows
 * which, and it is the panel that remembers.
 *
 * A count says how many panes are wanted, which is not the same as how many
 * exist. `needs` is the difference — the sessions still to open — and the
 * caller opens them. It is a number rather than a flag because asking for four
 * with one terminal open needs three, and a flag could only say "one more":
 * the panel opened a single terminal, re-applied, and settled on two panes
 * while the button said four.
 *
 * ## How many columns
 *
 * `columns` is the grid's shape, and it is `ceil(sqrt(n))`: two columns for
 * three and four, three for five and six. It never leaves a hole in the last
 * row that a squarer count would have filled, and three across for six is the
 * shape people actually build by hand.
 *
 * ## The pane you are in is never the one that goes
 *
 * Every preset keeps the focused pane. A shape that swapped it out from under
 * you would leave you typing into a terminal that has just disappeared, which
 * is worse than any shape being wrong.
 *
 * ## Which panes fill a shape
 *
 * `pair` and `workbench` need two. If the row already has enough, the panes on
 * it stay: a preset is about shape, and somebody who put b beside a and
 * presses Pair means "these two, even", not "a and whatever is next in the
 * list". Only when the row is short does the shape reach into the session list
 * — and it takes the sessions *after* the focused one, wrapping round to the
 * top, because the terminal you opened after this one is the one most likely
 * to belong beside it. When the row is long, the panes farthest after the
 * focused one are the ones that go, by the same measure.
 *
 * If there is only one session there is nothing to pair it with, and this does
 * not invent one: the result is the focused pane alone with `needsNew` set,
 * and the caller opens a second terminal and applies the preset again.
 * Inventing a session here would mean this module knowing how to start a
 * shell, which is none of its business.
 *
 * ## Widths are written per pane, and only for panes on screen
 *
 * `split.ts` keys weights by pane id precisely so a hidden pane keeps its
 * width for when it comes back. A preset writes the panes it shows and leaves
 * every other entry alone — `solo` does not flatten the widths of the two
 * panes it just hid, so showing them again finds the arrangement they had.
 *
 * ## Recognising a shape
 *
 * The buttons highlight the preset the row is in, and that is read from the
 * row rather than remembered from the last click: a preset the person has
 * since dragged away from is no longer the layout, whatever was pressed.
 * Within two per cent of the row, because a divider nudged by a pixel is
 * still the shape it was.
 */

import { MAX_GRID, MAX_PANES } from './panes';
import { evened, shares, type Weights } from './split';

/** The shapes a row can be in. What `describe` recognises. */
export type Shape = 'solo' | 'pair' | 'workbench' | 'quad' | 'grid';

/** What a button does: a shape, or `tidy`, which is a repair rather than a shape. */
export type Preset = Shape | 'tidy';

/**
 * What `apply` accepts: a named preset, or a number of panes.
 *
 * A number is always evenly wide. Unevenness is a shape and has a name.
 */
export type Request = Preset | number;

/** The counts that can be asked for: one pane up to the grid's cap. */
export const COUNTS: readonly number[] = Array.from({ length: MAX_GRID }, (_, i) => i + 1);

/**
 * The columns a grid of `n` panes is drawn in, and so how the panel sets
 * `--tcols`. See the header: `ceil(sqrt(n))`, which is 2, 2, 3, 3 for three
 * through six and never leaves the last row emptier than it has to be.
 *
 * One and two are here for completeness. The panel does not draw a grid below
 * three panes — two above one another is not what anybody means by one.
 */
export function columns(n: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(Math.max(1, Math.round(n)))));
}

/** A preset as the buttons show it. `label` and `about` are i18n keys. */
export interface PresetInfo {
  id: Preset;
  /** One word. It is a button. */
  label: string;
  /** One sentence, for the tooltip. */
  about: string;
}

/**
 * The presets the bar draws as buttons — which is no longer all of them.
 *
 * It was six: Solo, Pair, Workbench, Quad, Grid, Tidy. Then the count ladder
 * arrived beside them, and four of the six became the same thing said twice.
 * `solo` is 1. `pair` is 2. `quad` is 4. `grid` is 6. Nineteen controls sat in
 * that bar and thirteen of them were about the layout, for what is really two
 * questions: how many panes, and how they are arranged.
 *
 * So the ladder answers "how many" and keeps the four counts, the arrangement
 * became one toggle, and what is left here is the two presets that are neither:
 *
 *   workbench  two panes, *unevenly*. A width, which no count can ask for.
 *   tidy       whatever is there, evened out. A repair, not a shape.
 *
 * `Preset` still has all six, because `apply` still understands all six and
 * `describe` still answers them — they stopped being buttons, not concepts.
 */
export const PRESETS: readonly PresetInfo[] = [
  { id: 'workbench', label: 'Workbench', about: 'Two panes, with the one you are in wider.' },
  { id: 'tidy', label: 'Tidy', about: 'Keep the panes you have and square them back up.' },
];

/**
 * The wide pane's share of a workbench. The other pane gets the rest.
 *
 * Far enough from half that the wide pane is plainly the one being worked in,
 * and not so far that the other is a strip: a pane you are glancing at still
 * has to be wide enough to read a stack trace in.
 */
export const WIDE = 0.65;

/**
 * How far from a shape a row may be and still be called it, as a share of the
 * row. A divider nudged by a pixel is still the shape it was; a divider dragged
 * to 55/45 was chosen, and is not.
 */
export const TOLERANCE = 0.02;

/** The row as it is now. `shown` and `order` as `panes.ts` keeps them. */
export interface Layout {
  /** The pane the panel bar acts on. Kept by every preset. */
  focus: string;
  /** The panes on screen. */
  shown: readonly string[];
  /** Every session, in list order. Companions are taken from it. */
  order: readonly string[];
  weights: Weights;
}

/** The row a preset makes. */
export interface Applied {
  /** The panes to show, in list order. */
  shown: string[];
  /**
   * The widths. Written for the shown panes when two or more share the row;
   * a pane alone keeps whatever width it had, since nothing is beside it to
   * be proportional to. Every other entry is as it was.
   */
  weights: Weights;
  /**
   * How many sessions still have to be opened for the request to be met.
   *
   * Zero when the row can be built from what exists. The caller opens this
   * many and applies again; `shown` meanwhile is what *can* be shown, so the
   * row is never left blank while it waits.
   */
  needs: number;
  /** `needs > 0`, kept because that is the question most callers ask. */
  needsNew: boolean;
}

/**
 * The panes a row of `n` gets, in list order.
 *
 * Ranked: the focused pane, then the panes already on screen, then everything
 * else — the last two groups each in list order starting just after the
 * focused pane and wrapping round. The first `n` of that ranking are the row.
 * One ranking serves both directions: a short row fills from the front of it
 * and a long row is cut from the back.
 */
function fill(focus: string, live: readonly string[], order: readonly string[], n: number): string[] {
  const at = order.indexOf(focus);
  const rest = [...order.slice(at + 1), ...order.slice(0, at)];
  const ranked = [
    focus,
    ...rest.filter((id) => live.includes(id)),
    ...rest.filter((id) => !live.includes(id)),
  ];
  const kept = ranked.slice(0, n);
  return order.filter((id) => kept.includes(id));
}

/**
 * The workbench widths: the focused pane at `WIDE`, the other at the rest.
 *
 * Written as share × count, the scale `split.ts` writes back in, so 1 stays
 * the even weight and these sit either side of it rather than dwarfing every
 * pane that still has the default.
 */
function widened(shown: readonly string[], focus: string, weights: Weights): Weights {
  const out: Record<string, number> = { ...weights };
  for (const id of shown) out[id] = (id === focus ? WIDE : 1 - WIDE) * shown.length;
  return out;
}

/**
 * The row a preset makes from the row there is.
 *
 * `shown` is read the way `panes.ts` reads it — sessions that no longer exist
 * are dropped, and a focus that is not a session falls back to the first pane
 * on screen — so a stale layout restored from disk gets a sensible row rather
 * than a blank one. Nothing passed in is changed.
 */
export function apply(preset: Request, from: Layout): Applied {
  const { order } = from;
  const live = order.filter((id) => from.shown.includes(id));
  const focus = order.includes(from.focus) ? from.focus : (live[0] ?? order[0] ?? '');

  // How many panes the shape is. `tidy` is however many there are — plus the
  // focused one, if it was somehow not among them — and never more than the cap.
  const size = typeof preset === 'number' ? Math.round(preset)
    : preset === 'solo' ? 1
    : preset === 'quad' ? MAX_PANES
    : preset === 'grid' ? MAX_GRID
    : preset === 'tidy' ? live.length + (live.includes(focus) ? 0 : 1)
    : 2;
  const want = Math.min(MAX_GRID, Math.max(1, size));

  const needs = Math.max(0, want - order.length);
  const needsNew = needs > 0;
  if (!order.length) return { shown: [], weights: from.weights, needs, needsNew };

  const shown = fill(focus, live, order, Math.min(want, order.length));
  // One pane has no width to arrange, so nothing is written until there are
  // two — the widths a short row was given are still there for when it fills.
  const weights = shown.length < 2 || preset === 'solo' ? from.weights
    : preset === 'workbench' ? widened(shown, focus, from.weights)
    : evened(shown, from.weights);
  return { shown, weights, needs, needsNew };
}

/**
 * How many panes the row is, if they are evenly wide — otherwise nothing.
 *
 * What lights the count buttons. Deliberately separate from `describe`: that
 * one answers "which named shape is this" and has to say `custom` for three
 * even panes, because three even panes have no name. This one answers "how
 * many", which three does have an answer to.
 *
 * A single pane is even by definition; there is nothing beside it to be
 * uneven with.
 */
export function evenCount(shown: readonly string[], weights: Weights): number | null {
  if (!shown.length) return null;
  if (shown.length === 1) return 1;
  const parts = shares(shown, weights);
  const near = (x: number) => Math.abs(x - 1 / shown.length) <= TOLERANCE + 1e-9;
  return parts.every(near) ? shown.length : null;
}

/**
 * Which shape the row is in, or `custom`.
 *
 * `tidy` is never the answer — it is an action, and a tidied pair is a pair.
 * Only the counts with a *name* are answered: one, two and four. Three, five
 * and six are `custom` however even they are, because there is no named shape
 * for them — the count ladder is what says those, and `evenCount` is what
 * lights it. A workbench is a workbench whichever side is wide, because the
 * buttons show the shape, and which pane got the width is not something a
 * highlight can say.
 *
 * `grid` is never the answer either, for a different reason. Four even panes
 * are four even panes whether they are in a row or in two rows of two; the
 * arrangement is not in the widths, and this only reads widths. The panel
 * remembers the arrangement and decides between `quad` and `grid` itself.
 */
export function describe(shown: readonly string[], weights: Weights): Shape | 'custom' {
  if (shown.length === 1) return 'solo';
  const near = (x: number, to: number) => Math.abs(x - to) <= TOLERANCE + 1e-9;
  if (shown.length === MAX_PANES) {
    const parts = shares(shown, weights);
    return parts.every((x) => near(x, 1 / MAX_PANES)) ? 'quad' : 'custom';
  }
  if (shown.length !== 2) return 'custom';
  // Inclusive at the edge, in spite of the arithmetic: 0.52 - 0.5 is a hair
  // over 0.02 in floating point, and the contract says 0.02 off still counts.
  const [a, b] = shares(shown, weights);
  if (near(a, 0.5)) return 'pair';
  if (near(a, WIDE) || near(b, WIDE)) return 'workbench';
  return 'custom';
}
