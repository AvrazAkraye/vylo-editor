/**
 * The app's sections, as modules.
 *
 * The activity rail used to be an array literal written inline in `App.tsx`,
 * and the sidebar header that named the open section was a chain of ternaries
 * written separately. The two drifted, as a list and a copy of a list always
 * do: `todo` was never added to the header chain, so the To do panel sat under
 * a heading that said "Memory" for eleven releases. Nobody noticed, because
 * nothing could — there was no single place that knew what a section *was*.
 *
 * This is that place. A module is a value:
 *
 *     { id: 'todo', label: 'To do', icon: 'check', about: '…', badge: 'todo' }
 *
 * Everything that needs to know about a section reads it from here: the rail
 * draws it, the header names it, Settings lists it, and the keyboard finds it.
 * Adding one is a single entry, and `modules.test.mjs` fails if that entry has
 * no panel in `App.tsx` — so the list and the thing it describes cannot drift
 * apart again without a red test.
 *
 * ## Turning them off
 *
 * Not everybody wants six. Somebody who works entirely in the chat has no use
 * for a Changes tab, and every icon they never press is one more thing between
 * them and the two they do. So each is a module the owner of the window can
 * turn off and drag into the order they want, from Settings → Modules.
 *
 * The order and the off-list are the person's, kept in `localStorage`, and
 * `read` repairs anything it cannot trust rather than throwing — a corrupt
 * layout must not be an app that will not start.
 *
 * ## Why this is not a plugin loader
 *
 * "Modules you can add" invites the obvious next step: a folder of JavaScript
 * files this app imports at runtime. That is not built and will not be, because
 * it is the largest hole it is possible to put in this application. Every
 * guarantee here rests on there being no path from a file in a repository to
 * code that runs — `apply_write` and `run_command` are absent from the tool
 * schema for exactly that reason, and a `.vylo/modules/*.js` that gets
 * `import()`ed would hand back everything those absences buy, to anything that
 * can write a file in a checkout.
 *
 * The app already has the safe version of the same idea, and it predates this:
 * **MCP servers**. They are separate processes, declared in `.vylo/mcp.json`,
 * whose every tool call goes through the approval gate. That is what "add a
 * module" means here, and it is listed in the same Settings tab as these — so
 * the answer to "can I add my own" is yes, through the door that has a lock on
 * it.
 */

import type { IconName } from './Icon';

export type ModuleId =
  | 'files' | 'search' | 'outline' | 'changes' | 'chats' | 'todo' | 'prompts' | 'memory';

export interface Module {
  id: ModuleId;
  /** The English sentence, which is also the `i18n.ts` key. */
  label: string;
  icon: IconName;
  /** One line in Settings saying what it is for. Also an `i18n.ts` key. */
  about: string;
  /** Which count badges the icon. Undefined for a section with nothing to count. */
  badge?: 'changes' | 'todo';
}

/**
 * In the order a new window shows them, which is also the order they are
 * argued for: where the files are, how to find one, what changed, who you
 * asked, what is left to do, what the project knows.
 */
export const MODULES: readonly Module[] = [
  { id: 'files', label: 'Explorer', icon: 'folder', about: 'The file tree for the open folder.' },
  { id: 'search', label: 'Search', icon: 'search', about: 'Find text across every file in the project.' },
  { id: 'outline', label: 'Outline', icon: 'list', about: 'Declarations in the file you have open.' },
  { id: 'changes', label: 'Changes', icon: 'diff', about: 'Staged edits and the git working tree.', badge: 'changes' },
  { id: 'chats', label: 'Chats', icon: 'chat', about: 'Every conversation in this folder.' },
  { id: 'todo', label: 'To do', icon: 'check', about: 'The project plan, kept in .vylo/TODO.md.', badge: 'todo' },
  { id: 'prompts', label: 'Prompts', icon: 'sparkle', about: 'Prompts and commands worth keeping, kept in .vylo/PROMPTS.md.' },
  { id: 'memory', label: 'Memory', icon: 'memory', about: 'What the agent has been told to remember.' },
];

const IDS = MODULES.map((m) => m.id);

/** The descriptor for an id. Every id has one, so this never returns undefined. */
export function moduleOf(id: ModuleId): Module {
  return MODULES.find((m) => m.id === id) ?? MODULES[0];
}

/** What a section is called, for the rail's tooltip and the sidebar heading. */
export function labelOf(id: ModuleId): string {
  return moduleOf(id).label;
}

/**
 * Which physical edge the rail sits against.
 *
 * Physical, not logical, and that is the awkward but correct choice. Somebody
 * who asks for the rail on the left means the left of their screen, in every
 * language — the rail is furniture, not text, and it does not flip when the
 * prose does. In a right-to-left interface the flex order has to be inverted to
 * keep it there, which `railFirst` below works out.
 */
export type Side = 'left' | 'right';

export interface Layout {
  /** Every known module, in the order the rail shows them. */
  order: ModuleId[];
  /** Which of them are turned off. */
  off: ModuleId[];
  side: Side;
}

/**
 * Whether the rail is the first child of the shell.
 *
 * A left-to-right row lays its first item on the left; a right-to-left row lays
 * it on the right. So "keep the rail on the left" means *first* in one and
 * *last* in the other, and this is the one place that knows it.
 */
export const railFirst = (side: Side, dir: 'ltr' | 'rtl'): boolean =>
  dir === 'rtl' ? side === 'right' : side === 'left';

/** Everything on, in declaration order. */
export const DEFAULT: Layout = { order: [...IDS], off: [], side: 'left' };

/** Where the layout is kept. Versioned, so a future shape can be told apart. */
export const KEY = 'vylo.modules.v1';

/**
 * Read a saved layout, repairing anything that cannot be trusted.
 *
 * Four things go wrong in the field and all four are handled rather than
 * thrown: the value is absent, it is not JSON, it names a module that no longer
 * exists, or it is missing one that has since been added.
 *
 * A module the saved order has never heard of is **appended, and on**. Putting
 * it back at its declared position would reorder somebody's rail around a
 * section they did not ask for; putting it at the end adds without disturbing.
 * On rather than off, because a module that arrives switched off is one nobody
 * discovers.
 */
export function read(raw: string | null): Layout {
  let order: ModuleId[] = [];
  let off: ModuleId[] = [];
  let side: Side = 'left';

  try {
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved === 'object') {
      const known = (xs: unknown): ModuleId[] =>
        Array.isArray(xs)
          ? xs.filter((x): x is ModuleId => IDS.includes(x as ModuleId))
              .filter((x, i, a) => a.indexOf(x) === i)
          : [];
      order = known(saved.order);
      off = known(saved.off);
      if (saved.side === 'right' || saved.side === 'left') side = saved.side;
    }
  } catch {
    // Not JSON. A layout is a convenience, so the cost of a bad one is the
    // default arrangement, never a window that will not open.
  }

  for (const id of IDS) if (!order.includes(id)) order.push(id);
  // An empty rail beside an empty sidebar reads as a broken app rather than as
  // an empty one, and the way back is not obvious from looking at it. So one
  // stays on, and it is the first in the person's own order.
  if (off.length >= order.length) off = off.filter((x) => x !== order[0]);
  return { order, off, side };
}

/** What goes into storage. */
export function write(layout: Layout): string {
  return JSON.stringify({ order: layout.order, off: layout.off, side: layout.side });
}

export const isOn = (layout: Layout, id: ModuleId): boolean => !layout.off.includes(id);

/** The modules the rail draws, in order. Never empty. */
export function enabled(layout: Layout): Module[] {
  return layout.order.filter((id) => isOn(layout, id)).map(moduleOf);
}

/**
 * Turn one on or off.
 *
 * The last one on cannot be turned off — see `read`. Returning the layout
 * unchanged rather than refusing loudly is deliberate: the control that calls
 * this is already disabled, so reaching here means something else did, and the
 * useful behaviour is to hold the invariant quietly.
 */
export function toggle(layout: Layout, id: ModuleId): Layout {
  if (!IDS.includes(id)) return layout;
  if (isOn(layout, id)) {
    if (enabled(layout).length <= 1) return layout;
    return { ...layout, off: [...layout.off, id] };
  }
  return { ...layout, off: layout.off.filter((x) => x !== id) };
}

/** True when turning this one off would leave the rail empty. */
export function isLast(layout: Layout, id: ModuleId): boolean {
  return isOn(layout, id) && enabled(layout).length <= 1;
}

/**
 * Move a module to another position.
 *
 * The indices are over the whole order, off ones included, because Settings
 * shows every module in one list — dragging past a switched-off row has to
 * land where the eye says it will.
 */
export function moveTo(layout: Layout, from: number, to: number): Layout {
  const order = [...layout.order];
  if (from < 0 || from >= order.length || to < 0 || to >= order.length || from === to) return layout;
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  return { ...layout, order };
}

/** Move the rail to the other edge. */
export function setSide(layout: Layout, side: Side): Layout {
  return side === layout.side ? layout : { ...layout, side };
}

/** Everything on, in declaration order, forgetting whatever was arranged. */
export function reset(): Layout {
  return { order: [...IDS], off: [], side: 'left' };
}

/**
 * Which section the sidebar should show.
 *
 * Turning off the module you were looking at has to move you somewhere, and
 * the first one on is the only choice that is always available.
 */
export function active(layout: Layout, want: ModuleId): ModuleId {
  const on = enabled(layout);
  return on.some((m) => m.id === want) ? want : on[0].id;
}
