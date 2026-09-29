import { fill, type Lang } from './i18n';
import type { Layer, Motion, RecipeId } from './motiontypes';

/**
 * What the Motion studio's components hand each other.
 *
 * The studio is several components — the stage, the timeline, the inspector,
 * the gallery — written to be independent: each takes the open graphic and
 * says what should change, and the panel (MotionPanel.tsx) is the only place
 * that knows how a change is made, recorded for undo and kept. Nothing below
 * holds state; it is the shape of the conversation.
 *
 * ## A change is a function
 *
 * A component never receives a setter for a field. It receives `onEdit` and
 * calls it with a function from the graphic to the graphic — usually one of
 * `motionedit.ts`'s. That keeps one door for every edit, so history records it,
 * the store keeps it, and the recipe link is dropped when the person edits a
 * layer by hand, all in the panel and not in twelve handlers.
 */

export type T = (s: string) => string;

/**
 * The numbered names a template gives its layers ("Step 2 circle"), by their
 * pattern with the number as `{n}`. Each is written out as a literal, so the
 * catalogue's check sees that the interface has it.
 */
const NUMBERED: ReadonlyMap<string, (t: T) => string> = new Map<string, (t: T) => string>([
  ['Burst ring {n}', (t: T) => t('Burst ring {n}')],
  ['Flash {n}', (t: T) => t('Flash {n}')],
  ['Icon {n}', (t: T) => t('Icon {n}')],
  ['Label {n}', (t: T) => t('Label {n}')],
  ['Line to step {n}', (t: T) => t('Line to step {n}')],
  ['Name {n}', (t: T) => t('Name {n}')],
  ['Number {n}', (t: T) => t('Number {n}')],
  ['Rule {n}', (t: T) => t('Rule {n}')],
  ['Shine {n}', (t: T) => t('Shine {n}')],
  ['Sonar ring {n}', (t: T) => t('Sonar ring {n}')],
  ['Step {n}', (t: T) => t('Step {n}')],
  ['Step {n} circle', (t: T) => t('Step {n} circle')],
  ['Step {n} highlight', (t: T) => t('Step {n} highlight')],
  ['Step {n} number', (t: T) => t('Step {n} number')],
  ['Step {n} ripple', (t: T) => t('Step {n} ripple')],
  ['Swatch {n}', (t: T) => t('Swatch {n}')],
  ['Sweep {n}', (t: T) => t('Sweep {n}')],
  ['Value {n}', (t: T) => t('Value {n}')],
]);

/**
 * A layer's name as the studio shows it. A template names its layers in
 * English ("Accent bar", "Step 2 circle"); they are shown in the interface's
 * language when the catalogue has the name, with the number put back. A name a
 * person typed, or one the catalogue does not know, is shown as written.
 */
export function shownName(name: string, t: T): string {
  const exact = t(name);
  if (exact !== name) return exact;
  const digits = name.match(/\d+/g);
  if (!digits || digits.length !== 1) return name;
  const numbered = NUMBERED.get(name.replace(/\d+/, '{n}'));
  return numbered ? fill(numbered(t), { n: digits[0] }) : name;
}

/** A change to the open graphic. */
export type Change = (m: Motion) => Motion;

/**
 * Make a change. `key` merges edits made in quick succession under the same
 * key — typing in a field, dragging a slider or a layer — into one undo step;
 * an edit with no key is a step of its own.
 */
export type OnEdit = (change: Change, key?: string) => void;

/** The tabs of the studio's side column. */
export const TABS = ['design', 'layers', 'ask', 'export'] as const;
export type Tab = (typeof TABS)[number];

export interface StageProps {
  t: T;
  doc: Motion;
  /** The layer being edited, outlined on the canvas. */
  selected: string | null;
  onSelect: (id: string | null) => void;
  /**
   * The layer was dragged: its new offsets in u. `commit` is false while the
   * pointer is down and true once, on release, so the panel records a single
   * undo step for the whole drag.
   */
  onMove: (id: string, x: number, y: number, commit: boolean) => void;
  /** In the sidebar: no drag handles, and the canvas fits the column. */
  compact?: boolean;
}

export interface TimelineProps {
  t: T;
  doc: Motion;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onEdit: OnEdit;
}

export interface InspectorProps {
  t: T;
  doc: Motion;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onEdit: OnEdit;
}

export interface HomeProps {
  t: T;
  /** The interface language: the words a template's card is drawn with. */
  lang: Lang;
  motions: Motion[];
  onOpen: (id: string) => void;
  /** Start a new graphic from a template, in the interface's language. */
  onTemplate: (id: RecipeId) => void;
  /** Put the cursor in the request box. */
  onAsk: () => void;
}

export interface ThumbProps {
  doc: Motion;
  /** CSS pixels wide; the height follows the graphic's shape. */
  width: number;
  /** Play in a loop while true; otherwise show the still. */
  animate?: boolean;
}

/** The layer with this id, or undefined. */
export function layerOf(m: Motion, id: string | null): Layer | undefined {
  return id ? m.layers.find((l) => l.id === id) : undefined;
}
