import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import * as ask from './ask';
import { fill, type Lang } from './i18n';
import { armed } from './providers';
import type { Target } from './generate';
import type { EffortBook } from './effort';
import { MODEL_KEY, routeFor, readPick, type ModelChoice } from './modelchoice';
import { dateText, locale } from './fmt';
import type { Format, Motion, RecipeId } from './motiontypes';
import { TABS, type Change, type OnEdit, type Tab } from './motionui';
import { bind, pause, play, read, reset, seek } from './motionplay';
import { stillTime } from './motionanim';
import { duplicateLayer, placeAdded, removeLayer, setLayer } from './motionedit';
import { RECIPES, buildMotion } from './motiontemplates';
import { META, PALETTES, type PaletteId } from './motionrecipe';
import { kitOptionsWithBrand } from './motionbrand';
import { canRedo, canUndo, emptyHistory, redone, synced, undone, type MotionHistory } from './motionhistory';
import { currentBrand, deleteMotion, loadBrand, loadMotions, saveMotion } from './motionstore';
import { planMotion, planned, refineMotion, type PlanRequest } from './motionai';
import {
  LENGTHS, SHAPES, TOP_TEMPLATES, answerFate, canMake, clock, dragChanged, endStep, errorText, fitWidth, formatName, formatRatio,
  freshDraft, JOURNAL_MAX, journalOf, keyAction, logged, moveKey, placeholderOf, planLine, planRequestOf, recordEdit, secondsText, sortMotions,
  tabStep, templateOptions, webNoteOf, withJournal, type ChatEntry, type Draft,
} from './motionstate';
import { MotionStage } from './MotionStage';
import { MotionTimeline } from './MotionTimeline';
import { MotionDesign } from './MotionDesign';
import { MotionLayers } from './MotionLayers';
import { MotionHome } from './MotionHome';
import { MotionThumb } from './MotionThumb';
import { MotionExport, dropExports } from './MotionExport';
import { MotionChat } from './MotionChat';
import { MotionChecks } from './MotionChecks';
import { MotionSoundPreview } from './MotionSoundPanel';
import { MotionScenes } from './MotionScenes';

/**
 * Motion, in the sidebar and over the whole window: describe an animated
 * graphic or start from a template, edit it on the stage, the timeline and the
 * side tabs, and save it as an MP4 or a PNG (docs/MOTION.md).
 *
 * The same shape as Video (VideoPanel.tsx), on purpose — a request box, runs
 * that live outside React so they survive the sidebar being closed, a full
 * window for the work that does not fit in a column — and it is the one place
 * in the studio that knows how a change is made.
 *
 * ## One door for every change
 *
 * The stage, the timeline and the tabs never write into a graphic. Each hands
 * `onEdit` a function from the graphic to the graphic (motionui.ts), and
 * `edit` below applies it to the newest copy, records it for undo
 * (motionhistory.ts, with its `key` joining typing and drags into one step)
 * and keeps it. A drag that comes back to where it began records nothing and
 * leaves the template link as it was (`move`).
 *
 * ## The model writes JSON, never code
 *
 * Make it sends the words to the model (motionai.ts), which answers with a
 * graphic in the closed vocabulary of motiontypes.ts, read and repaired by
 * motionread.ts. The Ask tab sends a message about the open graphic and gets
 * the graphic back with notes on what changed, applied as one undo step.
 * Nothing the model returns is written anywhere by this panel: a graphic is
 * kept in the app's own IndexedDB (motionstore.ts), and a file is written only
 * by Export, when the person presses Download or Save as… (SAFETY.md).
 *
 * Templates never ask a model: a template is built here from its recipe and
 * the language's sample words, with no key and no network.
 *
 * ## The pro pass, mounted quietly (docs/pro/w2-panel.md)
 *
 * Each new part is one line on the screen, and only where the work is:
 *
 * - the **quality check** (MotionChecks.tsx): a chip in a row of its own under
 *   the stage, on its end side — not in the transport, which is left to right
 *   in every language — in the sidebar and in the full window alike;
 * - **sound** (MotionSoundPanel.tsx): a row in Design, and one silent
 *   `MotionSoundPreview` wherever a graphic is open, which keeps the sound
 *   with the playhead;
 * - **scenes** (MotionScenes.tsx): the strip above the full window's
 *   timeline, a single quiet "+ Scene" until there are two;
 * - the **brand kit** (MotionBrandKit.tsx): a button beside Design's colours.
 *   A template started here is built in the kit (`kitOptionsWithBrand`), which
 *   is loaded once, with the graphics.
 *
 * A layer added in Layers while the graphic has scenes goes into the scene
 * under the playhead (`placeAdded`, motionedit.ts).
 */

export interface MotionProps {
  t: (s: string) => string;
  lang: Lang;
  /**
   * Where a request goes, with which key: App's `wired`, derived in one place
   * (providers.ts `route`). The panel takes nothing else about keys or
   * providers, so no request here can be sent somewhere `wired` did not say.
   */
  gw: Target;
  efforts: EffortBook;
  /** The models the request form offers (modelchoice.ts); fewer than two and the form shows no Model choice. */
  models?: readonly ModelChoice[];
  onProviders: () => void;
  onError: (message: string) => void;
}

type T = (s: string) => string;

// ── the store, outside React ──────────────────────────────────────────────

interface Job {
  ctl: AbortController;
  how: 'plan' | 'refine';
  started: number;
  /** Characters of the model's answer so far, so a long wait visibly moves. */
  chars: number;
  /** The web is being searched for the facts the answer needs (motionresearch.ts): the status line says so. */
  looking?: boolean;
}

/** Model runs, by graphic. They outlive the panel: closing the sidebar does not stop one. */
const jobs = new Map<string, Job>();
/** The newest copy of every graphic this session has seen, by id. */
const known = new Map<string, Motion>();
/** Each graphic's undo, for this session only: an undo that survived a restart would undo into a graphic nobody remembers. */
const histories = new Map<string, MotionHistory>();
/** The Ask tab's conversation, by graphic; never stored. */
const logs = new Map<string, ChatEntry[]>();
/** Graphics whose numbers the model made up as examples, until the notice saying so is dismissed. */
const examples = new Set<string>();
/** Graphics deleted this session, which a run still unwinding must not put back. */
const gone = new Set<string>();
const watchers = new Set<() => void>();
let loaded = false;
/** Storage refused a graphic: said once, for the rest of the session. */
let unkept = false;

/** What the panel shows: kept here, so a move between the sidebar and the full window, or another module and back, loses none of it. */
let openId: string | null = null;
let tab: Tab = 'design';
/** The chosen layer of the open graphic. */
let selected: string | null = null;
/** A graphic to play from the top when its view next shows it with layers. */
let autoplay: string | null = null;

const draft: Draft = freshDraft();
/** The model picked on the request form ('' is Auto, the composer's); remembered between sessions, checked against the menu on use. */
let modelPick = '';
try { modelPick = localStorage.getItem(MODEL_KEY) ?? ''; } catch { /* private mode */ }
function setModelPick(id: string) {
  modelPick = id;
  try { localStorage.setItem(MODEL_KEY, id); } catch { /* private mode */ }
}
/** Draws the request form again from `draft`, after something other than typing filled it. */
let formNonce = 0;

const EMPTY_LOG: ChatEntry[] = [];

function notify() {
  for (const w of watchers) w();
}

let queued = false;
function notifySoon() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    notify();
  });
}

function useWatch() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const w = () => setTick((n) => n + 1);
    watchers.add(w);
    return () => {
      watchers.delete(w);
    };
  }, []);
}

function useTick(on: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const i = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(i);
  }, [on]);
}

const newId = () => {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === 'AbortError';

/** The server a request went to, as a person reads it: `capi.vylo-tech.com`. */
function hostOf(base: string): string {
  try {
    return new URL(base).host || base;
  } catch {
    return base;
  }
}

// ── keeping ───────────────────────────────────────────────────────────────

/** A keyed edit — typing, a drag, a slider — is written this long after the last of its burst, once. */
const SAVE_LATER_MS = 400;
const saves = new Map<string, number>();

function write(id: string) {
  const m = known.get(id);
  if (!m || gone.has(id)) return;
  void saveMotion(m).then((ok) => {
    if (!ok && !unkept) {
      unkept = true;
      notify();
    }
  });
}

function persist(id: string, later: boolean) {
  const timer = saves.get(id);
  if (timer !== undefined) window.clearTimeout(timer);
  saves.delete(id);
  if (!later) {
    write(id);
    return;
  }
  saves.set(id, window.setTimeout(() => {
    saves.delete(id);
    write(id);
  }, SAVE_LATER_MS));
}

/**
 * Graphics whose last edits were still waiting to be written when the page
 * went away, kept where the next start finds them. WebKit drops an IndexedDB
 * write made while a page is being unloaded — even one begun at once in
 * `pagehide` — so the words typed in the last moment before the window closed
 * would be lost; `localStorage` is written synchronously and survives.
 */
const JOURNAL = 'vylo.motion.unsaved.v1';

/**
 * Whatever is waiting to be written, now: the window is hidden or going away.
 * Also into the journal, since a closing window is hidden first and unloaded a
 * moment later, and neither moment's IndexedDB write is sure to land.
 */
function flushSaves() {
  const waiting = [...saves.entries()];
  saves.clear();
  const unsaved: Motion[] = [];
  for (const [id, timer] of waiting) {
    window.clearTimeout(timer);
    write(id);
    const m = known.get(id);
    if (m && !gone.has(id)) unsaved.push(m);
  }
  if (!unsaved.length) return;
  try {
    const text = JSON.stringify(unsaved);
    if (text.length <= JOURNAL_MAX) localStorage.setItem(JOURNAL, text);
    else localStorage.removeItem(JOURNAL);
  } catch {
    /* storage refused or full: the write above is all there is */
  }
}

/** The journal's graphics (motionstate.ts `journalOf`), taken out of storage. */
function recovered(): Motion[] {
  try {
    const raw = localStorage.getItem(JOURNAL);
    localStorage.removeItem(JOURNAL);
    return journalOf(raw);
  } catch {
    return [];
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      flushSaves();
      return;
    }
    // Back in view: the writes have had their time, and a journal kept for a
    // page that never came back would bring back a graphic deleted since.
    try {
      localStorage.removeItem(JOURNAL);
    } catch {
      /* nothing kept */
    }
  });
  window.addEventListener('pagehide', flushSaves);
}

/** The newest copy of a graphic, shown at once and kept (a moment later, for a burst of small edits). */
function keep(m: Motion, later = false) {
  if (gone.has(m.id)) return;
  known.set(m.id, m);
  persist(m.id, later);
  notify();
}

/** A graphic, gone: from the screen, the store, its history and its conversation. A run on it is stopped and can never put it back. */
function forget(id: string) {
  gone.add(id);
  jobs.get(id)?.ctl.abort();
  const timer = saves.get(id);
  if (timer !== undefined) window.clearTimeout(timer);
  saves.delete(id);
  known.delete(id);
  histories.delete(id);
  logs.delete(id);
  examples.delete(id);
  if (drag?.id === id) drag = null;
  // A film or a still being made of it is stopped: nothing of a deleted graphic lands in Downloads afterwards.
  dropExports(id);
  if (openId === id) openGraphic(null);
  void deleteMotion(id);
  notify();
}

function openGraphic(id: string | null) {
  if (id !== openId) {
    selected = null;
    tab = 'design';
    drag = null;
    // Closed, or another opened: the clock starts from the top for the next one.
    reset();
  }
  openId = id;
  if (id) autoplay = id;
  notify();
}

function select(id: string | null) {
  if (selected === id) return;
  selected = id;
  notify();
}

// ── edits and undo ────────────────────────────────────────────────────────

/**
 * The one door for a change the person makes: applied to the newest copy,
 * recorded for undo (the same `key` within the history's window joins the
 * last step), and kept. Nothing changes while the model is making the graphic.
 */
function edit(id: string, change: Change, key?: string): Motion | null {
  const before = known.get(id);
  if (!before || jobs.get(id)?.how === 'plan') return null;
  const next = change(before);
  if (next === before) return before;
  const now = Date.now();
  const made: Motion = { ...next, id, created: before.created, updated: Math.max(now, before.updated) };
  histories.set(id, recordEdit(histories.get(id), before, made, now, key));
  keep(made, key !== undefined);
  return made;
}

function historyOf(m: Motion): MotionHistory {
  return histories.get(m.id) ?? emptyHistory(m);
}

/** Put back a step the history gives: stamped as a change, and the history told it is what the graphic now is. */
function restore(id: string, h: MotionHistory, cur: Motion) {
  if (h.present === cur) {
    histories.set(id, h);
    return;
  }
  const back: Motion = { ...h.present, updated: Math.max(Date.now(), cur.updated) };
  histories.set(id, { ...h, present: back });
  keep(back);
}

function undo(id: string) {
  const cur = known.get(id);
  if (!cur || jobs.get(id)?.how === 'plan') return;
  drag = null;
  restore(id, undone(historyOf(cur), cur), cur);
}

function redo(id: string) {
  const cur = known.get(id);
  if (!cur || jobs.get(id)?.how === 'plan') return;
  drag = null;
  restore(id, redone(historyOf(cur), cur), cur);
}

/** A drag or a burst of arrow presses in progress: the graphic and its history as they were before it. */
let drag: { id: string; layer: string; base: Motion; history: MotionHistory } | null = null;

/**
 * The stage moved a layer. Every report while the pointer is down is one
 * history step (`moveKey`); the release ends it. A drag that ends where it
 * began puts the graphic and its history back exactly as they were — the
 * template link, and the steps that could be redone — so it leaves no step.
 */
function move(id: string, layerId: string, x: number, y: number, commit: boolean) {
  const cur = known.get(id);
  if (!cur || jobs.get(id)?.how === 'plan') return;
  if (!drag || drag.id !== id || drag.layer !== layerId) {
    drag = { id, layer: layerId, base: cur, history: synced(historyOf(cur), cur) };
  }
  const d = drag;
  if (!commit) {
    edit(id, (m) => setLayer(m, layerId, { x, y }), moveKey(layerId));
    return;
  }
  drag = null;
  if (!dragChanged(d.base, cur, layerId, x, y)) {
    if (cur === d.base) return;
    const back: Motion = { ...d.base, updated: Math.max(Date.now(), cur.updated) };
    histories.set(id, { ...d.history, present: back });
    keep(back);
    return;
  }
  edit(id, (m) => setLayer(m, layerId, { x, y }), moveKey(layerId));
  const h = histories.get(id);
  if (h) histories.set(id, endStep(h));
}

// ── runs ──────────────────────────────────────────────────────────────────

function stop(id: string) {
  jobs.get(id)?.ctl.abort();
}

/**
 * Make a graphic from words. The placeholder is shown at once; the model's
 * graphic replaces it with the same id and `created`. On failure or Cancel
 * the placeholder goes and `onEnd` is told why (null for Cancel), so the
 * words can go back into the box.
 */
function startPlan(doc: Motion, req: PlanRequest, gw: Target, book: EffortBook, onEnd: (e: unknown) => void) {
  const id = doc.id;
  if (jobs.has(id)) return;
  const ctl = new AbortController();
  const job: Job = { ctl, how: 'plan', started: Date.now(), chars: 0 };
  jobs.set(id, job);
  if (known.get(id)?.stage !== 'planning') keep({ ...doc, stage: 'planning', updated: Date.now() });
  else notify();
  planMotion(gw, book, req, {
    id,
    signal: ctl.signal,
    onText: (n) => {
      job.chars = n;
      notifySoon();
    },
    onLookup: (query) => {
      job.looking = query !== null;
      notify();
    },
  })
    .then((made) => {
      const cur = known.get(id);
      if (gone.has(id) || !cur) return;
      const next: Motion = { ...made, id, created: cur.created, stage: 'ready', updated: Date.now() };
      delete next.error;
      histories.set(id, emptyHistory(next));
      if (planned(made)) examples.add(id);
      else examples.delete(id);
      if (openId === id) autoplay = id;
      keep(next);
    })
    .catch((e: unknown) => {
      if (gone.has(id)) return;
      const stopped = ctl.signal.aborted || isAbort(e);
      forget(id);
      onEnd(stopped ? null : e);
    })
    .finally(() => {
      jobs.delete(id);
      notify();
    });
}

/**
 * A message from the Ask tab. The model answers for the graphic as it was
 * sent; the answer is applied as one undo step only when the graphic is still
 * that, since an answer made for another version would undo what was done
 * meanwhile. Both turns go into the conversation either way.
 */
function startRefine(doc: Motion, text: string, gw: Target, book: EffortBook, words: { moved: string; failed: (e: unknown) => string }) {
  const id = doc.id;
  const message = text.trim();
  if (jobs.has(id) || !message) return;
  const ctl = new AbortController();
  const job: Job = { ctl, how: 'refine', started: Date.now(), chars: 0 };
  jobs.set(id, job);
  notify();
  const you: ChatEntry = { who: 'you', text: message, at: job.started };
  const answer = (entry: ChatEntry) => {
    if (!gone.has(id)) logs.set(id, logged(logs.get(id) ?? [], [you, entry]));
  };
  refineMotion(gw, book, doc, message, {
    signal: ctl.signal,
    onLookup: (query) => {
      job.looking = query !== null;
      notify();
    },
  })
    .then((r) => {
      const fate = answerFate(doc, known.get(id), r.notes);
      if (fate === 'gone' || gone.has(id)) return;
      if (fate === 'moved') {
        answer({ who: 'motion', text: words.moved, at: Date.now(), failed: true });
        return;
      }
      if (fate === 'apply') {
        // A number the model had no source for is an example until the person puts in theirs: said above the stage, as after Make it.
        if (planned(r.motion)) examples.add(id);
        edit(id, (m) => ({ ...r.motion, id, created: m.created, stage: 'ready' }));
      }
      // A search is said under the answer, and the pages it read listed as links (MotionChat.tsx).
      const web = webNoteOf(r.research);
      answer({
        who: 'motion', text: r.said, notes: r.notes, skipped: r.skipped, at: Date.now(),
        ...(web ? { web } : {}), ...(r.sources?.length ? { sources: r.sources } : {}),
      });
    })
    .catch((e: unknown) => {
      if (ctl.signal.aborted || isAbort(e)) return;
      answer({ who: 'motion', text: words.failed(e), at: Date.now(), failed: true });
    })
    .finally(() => {
      jobs.delete(id);
      notify();
    });
}

// ── the full window, and Ask Vylo's way in ────────────────────────────────

let full = false;
let fullError: string | null = null;

/** Open the Motion workspace over the whole window, or close it. */
export function toggleMotionFull(on = !full) {
  full = on;
  fullError = null;
  notify();
}

/** A new motion graphic from these words, made as the form would make it. */
export function askMotion(text: string) {
  Object.assign(draft, { request: text, format: null, seconds: null, palette: null, error: null, autostart: true });
  openGraphic(null);
  formNonce += 1;
  toggleMotionFull(true);
  window.setTimeout(() => {
    draft.autostart = false;
  }, 8000);
}

function useDraft<K extends keyof Draft>(k: K): [Draft[K], (v: Draft[K]) => void] {
  const [v, setV] = useState<Draft[K]>(draft[k]);
  return [v, (next) => {
    draft[k] = next;
    setV(next);
  }];
}

// ── small pieces ──────────────────────────────────────────────────────────

/**
 * A graphic the model never finished: the app closed while it was being made
 * (the reader keeps it as `new`, with no layers). Not one whose every layer
 * the person deleted — that is still their graphic, edited in Layers.
 */
const unmadeOf = (m: Motion) => !m.layers.length && m.stage !== 'ready';

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

/** The person has asked the system for less motion (the thumbnails stay still for it too, MotionThumb.tsx). */
const lessMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};
const MOD = IS_MAC ? '⌘' : 'Ctrl+';

/** Drawn on Icon.tsx's grid, for the three actions it has no picture for. */
const GLYPHS = {
  undo: 'M9.5 6.5 5 11l4.5 4.5M5.5 11H15a4.5 4.5 0 0 1 0 9h-3',
  redo: 'M14.5 6.5 19 11l-4.5 4.5M18.5 11H9a4.5 4.5 0 0 0 0 9h3',
  trash: 'M5 7h14M10 4h4M7 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4L17 7M10.5 10.5v6M13.5 10.5v6',
} as const;

function Glyph({ name, size = 14 }: { name: keyof typeof GLYPHS; size?: number }) {
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={GLYPHS[name]} />
    </svg>
  );
}

function UndoRedo({ t, canUndo: can, canRedo: again, onUndo, onRedo }: {
  t: T; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
}) {
  const undoBtn = useRef<HTMLButtonElement>(null);
  const redoBtn = useRef<HTMLButtonElement>(null);
  // The last undo disables the button it was pressed on, and a disabled button drops the keyboard onto nothing:
  // the other of the two takes it.
  const pressed = useRef<'undo' | 'redo' | null>(null);
  useEffect(() => {
    const from = pressed.current;
    pressed.current = null;
    const a = document.activeElement;
    const lost = (own: HTMLButtonElement | null) => !a || a === document.body || a === own;
    if (from === 'undo' && !can && lost(undoBtn.current)) redoBtn.current?.focus();
    else if (from === 'redo' && !again && lost(redoBtn.current)) undoBtn.current?.focus();
  }, [can, again]);
  return (
    <span className="vid-tl-undo">
      <button ref={undoBtn} type="button" className="sb-act" disabled={!can} onClick={() => { pressed.current = 'undo'; onUndo(); }}
              title={`${t('Undo')} (${MOD}Z)`} aria-label={t('Undo')}>
        <Glyph name="undo" />
      </button>
      <button ref={redoBtn} type="button" className="sb-act" disabled={!again} onClick={() => { pressed.current = 'redo'; onRedo(); }}
              title={`${t('Redo')} (${IS_MAC ? '⇧⌘Z' : 'Ctrl+Y'})`} aria-label={t('Redo')}>
        <Glyph name="redo" />
      </button>
    </span>
  );
}

function tabName(x: Tab, t: T): string {
  if (x === 'layers') return t('Layers');
  if (x === 'ask') return t('Ask');
  if (x === 'export') return t('Export');
  return t('Design');
}

/** The shapes' drawn frames, written out so the stylesheet's rules can be found from here. */
const SHAPE_CLASS: Readonly<Record<Format, string>> = {
  landscape: 'mo-form-shape is-wide', portrait: 'mo-form-shape is-tall', square: 'mo-form-shape is-square', feed: 'mo-form-shape is-feed',
};

/** A template as its card draws it: the recipe filled with the language's sample words. Built once a language. */
const samples = new Map<string, Motion | null>();
function sampleOf(id: RecipeId, lang: Lang): Motion | null {
  const k = `${id}|${lang}`;
  if (!samples.has(k)) {
    let m: Motion | null = null;
    try {
      m = buildMotion({ id: `sample-${id}`, recipe: id, lang, format: 'landscape', now: 0 });
    } catch {
      m = null;
    }
    samples.set(k, m);
  }
  return samples.get(k) ?? null;
}

/**
 * Where a run is: a line that moves, a bar, a clock, and Cancel. Only the line
 * is a live region: it changes every few seconds, while the clock ticks every
 * second and the count of characters with every frame of the answer, which a
 * screen reader would read out one after another for as long as the run lasts.
 */
function Working({ t, job, onCancel }: { t: T; job: Job; onCancel: () => void }) {
  useTick(true);
  const elapsed = Date.now() - job.started;
  return (
    <div className="vid-status mo-status">
      <p className="vid-status-line" role="status">
        <span className="vid-glyph" aria-hidden="true">✻</span>
        <b>{planLine(elapsed, job.chars, t, !!job.looking)}</b>
      </p>
      <div className="vid-bar is-early" role="progressbar" aria-label={t('Progress')}><i /></div>
      <p className="vid-clock">
        <span>{fill(t('Running for {time}'), { time: clock(elapsed) })}</span>
        {job.chars > 0 && <span>{fill(t('{n} characters'), { n: job.chars.toLocaleString(locale()) })}</span>}
      </p>
      <span className="mo-status-acts">
        <button type="button" className="ghost bordered" onClick={onCancel}>
          <Icon name="stop" size={12} />
          <span className="cta-label">{t('Cancel')}</span>
        </button>
      </span>
    </div>
  );
}

/**
 * The frame a graphic being made will fill, in its shape, while the model
 * works; `idle` is the same frame, still, for one the app closed on.
 */
function Waiting({ t, doc, big, idle }: { t: T; doc: Motion; big?: boolean; idle?: boolean }) {
  return (
    <div className={big ? 'mo-wait is-big' : 'mo-wait'}>
      <div className={`mo-wait-frame ${SHAPE_CLASS[doc.format].replace('mo-form-shape ', '')}${idle ? ' is-idle' : ''}`} aria-hidden="true">
        {!idle && <span className="vid-spinner" />}
      </div>
      {big && (
        <>
          <b>{idle ? t('Not finished') : t('Making the graphic…')}</b>
          <p dir="auto">{doc.request}</p>
        </>
      )}
    </div>
  );
}

/**
 * The quality check's chip, in a row of its own under the stage, on the row's
 * end side. Its own row and not the transport's: the transport is left to
 * right in every language, and the tips' sentences must follow the
 * interface's direction. A repair is one edit, so one undo step; a tip with a
 * layer chooses it.
 */
function Checks({ t, doc, onEdit }: { t: T; doc: Motion; onEdit: OnEdit }) {
  return (
    <div className="mo-checks">
      <MotionChecks t={t} doc={doc} onApply={(next) => onEdit(() => next)} onSelect={select} />
    </div>
  );
}

/** The model's numbers are examples: said above the stage until dismissed, once a graphic. */
function Examples({ t, id }: { t: T; id: string }) {
  if (!examples.has(id)) return null;
  return (
    <p className="mo-examples" role="note">
      <Icon name="warning" size={13} />
      <span>{t('The numbers here are examples. Replace them with yours in Design.')}</span>
      <button type="button" className="sb-act" onClick={() => { examples.delete(id); notify(); }}
              title={t('Dismiss')} aria-label={t('Dismiss')}>
        <Icon name="close" size={12} />
      </button>
    </p>
  );
}

// ── the panel ─────────────────────────────────────────────────────────────

export function MotionPanel({ t, lang, gw, efforts, models, onProviders, onError }: MotionProps) {
  useWatch();
  const fullBox = useRef<HTMLDivElement>(null);
  const bodyBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loaded) return;
    loaded = true;
    // The brand kit, once: the sidebar's templates start in it too, and the sidebar never mounts Home, which loads its own.
    void loadBrand();
    void loadMotions().then((list) => {
      // Edits the last session could not write as it closed are put back, and written now.
      const kept = withJournal(list, recovered());
      for (const m of kept.write) void saveMotion(m);
      // The reader repairs a stored `planning`: nothing is resumed.
      for (const m of kept.list) if (!known.has(m.id) && !gone.has(m.id)) known.set(m.id, m);
      notify();
    });
  }, []);

  // Nothing plays while nobody can see it.
  useEffect(() => () => pause(), []);

  const ready = armed({ baseUrl: gw.baseUrl, key: gw.apiKey });
  const motions = sortMotions(known.values());
  const open = openId ? known.get(openId) ?? null : null;
  const job = open ? jobs.get(open.id) : undefined;
  const making = !!open && (job?.how === 'plan' || open.stage === 'planning');
  // A layer undone away is no longer chosen.
  const sel = open && selected !== null && open.layers.some((l) => l.id === selected) ? selected : null;
  useEffect(() => {
    if (selected !== null && sel === null) selected = null;
  });

  const isFull = full;

  // A graphic opened, or the list come back to, is seen from its top: the
  // column's scroll belonged to what was there before — a template chosen at
  // the bottom of the list opened the graphic with its title scrolled away.
  const shownId = open?.id ?? null;
  useLayoutEffect(() => {
    const column = bodyBox.current?.closest<HTMLElement>('.sb-panel, .mo-full-side');
    if (column) column.scrollTop = 0;
  }, [shownId]);

  const report = (m: string) => {
    if (full) {
      fullError = m;
      notify();
    } else onError(m);
  };

  // ── things the person starts ──

  const startTemplate = (id: RecipeId) => {
    const o = templateOptions(draft);
    // In the brand kit, when there is one: its colours unless a palette was picked (Auto leaves `palette` undefined),
    // its name in the fields that are the brand's, its face and logo. With no kit, these are the options as they are.
    const built = buildMotion(kitOptionsWithBrand({ id: newId(), recipe: id, lang, format: o.format, palette: o.palette, request: '' }, currentBrand()));
    // The sample words name it; a template whose sample gives none is called by its name, in the interface's language.
    const m = built.title === META[id].name ? { ...built, title: t(META[id].name) } : built;
    keep(m);
    histories.set(m.id, emptyHistory(m));
    openGraphic(m.id);
  };

  const makeFrom = (d: Pick<Draft, 'request' | 'format' | 'seconds' | 'palette'>, doc?: Motion) => {
    if (!canMake(d, ready)) return;
    const holder = doc ?? placeholderOf({ id: newId(), request: d.request, lang, draft: d, now: Date.now() });
    draft.error = null;
    if (!doc) {
      keep(holder);
      histories.set(holder.id, emptyHistory(holder));
    }
    openGraphic(holder.id);
    const asked = { ...d };
    startPlan(holder, planRequestOf(d, doc ? doc.lang : lang), routeFor(gw, models, modelPick), efforts, (e) => {
      // The words go back into the box, unless something new has been written there since.
      if (!draft.request.trim()) Object.assign(draft, { request: asked.request, format: asked.format, seconds: asked.seconds, palette: asked.palette });
      draft.error = e === null ? null : errorText(e, t, t('make the graphic'), hostOf(gw.baseUrl));
      formNonce += 1;
      notify();
    });
  };

  const remove = async (m: Motion) => {
    const yes = await ask.confirm({
      title: t('Delete this graphic?'),
      body: `${m.title || m.request}\n\n${t('It is removed from this machine. An MP4 or PNG you exported is not touched.')}`,
      confirmLabel: t('Delete'),
      danger: true,
    });
    if (yes) forget(m.id);
  };

  const onEdit: OnEdit = (change, key) => {
    if (openId) edit(openId, change, key);
  };

  const send = (text: string) => {
    if (!open || !ready) return;
    startRefine(open, text, routeFor(gw, models, modelPick), efforts, {
      moved: t('The graphic changed while the model was answering, so nothing was applied. Send the message again.'),
      failed: (e) => errorText(e, t, t('answer your message'), hostOf(gw.baseUrl)),
    });
  };

  // ── keys ──

  // The full window is a window: it takes the focus, keeps Tab inside, gives
  // it back when it closes, and Escape leaves it — a field first, then the
  // chosen layer, then the window.
  useEffect(() => {
    if (!isFull) return;
    const from = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    fullBox.current?.focus();
    /** Where Tab stops in the window, in order: a row's switches that are not its list's entry (tabindex -1) are not stops. */
    const stops = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>('button, input, select, textarea, [href], [tabindex]')]
      .filter((x) => x.tabIndex >= 0 && !x.matches(':disabled') && x.getClientRects().length > 0);
    let backwards = false;
    const onKey = (e: KeyboardEvent) => {
      const box = fullBox.current;
      const act = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (e.key === 'Escape' && !e.defaultPrevented) {
        // A dialog over the window (a confirm) answers its own Escape.
        if (act && box && !box.contains(act) && act.closest('[role="dialog"], [role="alertdialog"]')) return;
        if (act && box?.contains(act) && (act.matches('textarea, select, input:not([type="checkbox"]):not([type="radio"])') || act.isContentEditable)) {
          act.blur();
          box.focus();
          return;
        }
        if (selected !== null) {
          e.preventDefault();
          select(null);
          return;
        }
        toggleMotionFull(false);
        return;
      }
      if (e.key !== 'Tab' || !box) return;
      if (act && !box.contains(act) && act.closest('[role="dialog"], [role="alertdialog"]')) return;
      backwards = e.shiftKey;
      const all = stops(box);
      if (!all.length) return;
      const first = all[0];
      const last = all[all.length - 1];
      // `a` is `b` or comes after it: a focus on something that is not a stop (a timeline row that was clicked) past
      // either end wraps too, rather than Tab taking it out of the window.
      const from = (a: Node, b: Node) => a === b || !!(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (!act || !box.contains(act) || act === box) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && from(first, act)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && from(act, last)) {
        e.preventDefault();
        first.focus();
      }
    };
    // Tab can still go out past a stop the keys above cannot know is the first or the last: with macOS's Keyboard
    // navigation off, a button is not a stop. What goes out comes back in at the end it went out of — unless it went
    // to a dialog or a menu over the window, which has the keys to itself.
    const onFocus = (e: FocusEvent) => {
      const box = fullBox.current;
      const to = e.target instanceof HTMLElement ? e.target : null;
      if (!box || !to || box.contains(to) || to.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      const all = stops(box);
      (backwards ? all[all.length - 1] : all[0])?.focus();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      if (from?.isConnected) from.focus();
    };
  }, [isFull]);

  // Undo, redo, and the chosen layer's keys: in the full window, and in the
  // sidebar while the focus is in this panel — never in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const id = openId;
      const doc = id ? known.get(id) : undefined;
      if (!doc) return;
      const scope = full ? fullBox.current : bodyBox.current;
      const act = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // Over the whole window nothing else has keys: a control taken away from
      // under the focus leaves it on the page, not elsewhere.
      if (!scope || !act || !(scope.contains(act) || (full && act === document.body))) return;
      // A menu or a popover inside the studio has keys of its own.
      const inner = act.closest('[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]');
      if (inner && inner !== scope) return;
      const field = act.isContentEditable
        || act.matches('textarea, select, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="color"]):not([type="range"])');
      const what = keyAction({ key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, mac: IS_MAC, field });
      if (!what) return;
      if (what === 'undo' || what === 'redo') {
        e.preventDefault();
        if (what === 'undo') undo(doc.id);
        else redo(doc.id);
        return;
      }
      if (what === 'escape') {
        // The full window's own Escape above handles it there.
        if (!full && selected !== null) {
          e.preventDefault();
          select(null);
        }
        return;
      }
      const layer = selected !== null ? doc.layers.find((l) => l.id === selected) : undefined;
      if (!layer || act.matches('[role="radio"], [role="tab"], [role="slider"], [role="option"], input')) return;
      if (what === 'remove') {
        if (layer.locked) return;
        e.preventDefault();
        edit(doc.id, (m) => removeLayer(m, layer.id));
        select(null);
        return;
      }
      e.preventDefault();
      let copy = '';
      edit(doc.id, (m) => {
        const r = duplicateLayer(m, layer.id);
        copy = r.id;
        return r.motion;
      });
      if (copy) select(copy);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── what the column shows ──

  const view = open && (
    <View key={open.id} t={t} doc={open} job={job} making={making} ready={ready} inFull={isFull} sel={sel}
          log={logs.get(open.id) ?? EMPTY_LOG}
          onEdit={onEdit} onRemove={() => void remove(open)} onProviders={onProviders} onError={report} onSend={send}
          onRetry={() => makeFrom({ request: open.request, format: open.format, seconds: null, palette: null }, open)} />
  );
  const body = (
    <div className="mo" ref={bodyBox} tabIndex={-1}>
      {unkept && <p className="vid-warn">{t('Graphics cannot be kept on this machine right now. Export before you close the app.')}</p>}
      {view || (
        <Form key={formNonce} t={t} lang={lang} ready={ready} inFull={isFull} motions={motions} models={models} gw={gw}
              onMake={(d) => makeFrom(d)} onTemplate={startTemplate} onRemove={(m) => void remove(m)} onProviders={onProviders} />
      )}
    </div>
  );

  if (!isFull) return body;

  const stage = open
    ? making || unmadeOf(open)
      ? (
        <div className="mo-full-wait">
          <Waiting t={t} doc={open} big idle={!making} />
        </div>
      )
      : (
        <>
          <Examples t={t} id={open.id} />
          <div className="mo-full-canvas">
            <MotionStage t={t} doc={open} selected={sel} onSelect={select} onMove={(id, x, y, commit) => move(open.id, id, x, y, commit)} />
            <Checks t={t} doc={open} onEdit={onEdit} />
          </div>
          <div className="mo-full-time">
            <MotionScenes t={t} doc={open} onEdit={onEdit} />
            <MotionTimeline t={t} doc={open} selected={sel} onSelect={select} onEdit={onEdit} />
          </div>
        </>
      )
    : (
      <MotionHome t={t} lang={lang} motions={motions} onOpen={(id) => openGraphic(id)} onTemplate={startTemplate}
                  onAsk={() => document.getElementById('mo-request')?.focus()} />
    );

  return (
    <>
      <div className="sb-cta vid-away">
        <p className="ft-empty">{t('Motion is open over the whole window.')}</p>
        <button className="ghost bordered" onClick={() => toggleMotionFull(false)}>
          <Icon name="restore" size={13} />
          <span className="cta-label">{t('Back to the sidebar')}</span>
        </button>
      </div>
      {createPortal(
        <div className="mo-full" role="dialog" aria-modal="true" aria-label={t('Motion')} ref={fullBox} tabIndex={-1}>
          <header className="mo-full-head" data-tauri-drag-region>
            <Icon name="motion" size={16} />
            <b>{t('Motion')}</b>
            <span dir="auto">{open ? open.title || open.request : ''}</span>
            <button className="sb-act" onClick={() => toggleMotionFull(false)} title={t('Back to the sidebar')} aria-label={t('Back to the sidebar')}>
              <Icon name="restore" size={14} />
            </button>
          </header>
          {fullError && (
            <p className="mo-full-error" role="alert">
              <span dir="auto">{fullError}</span>
              <button className="sb-act" onClick={() => { fullError = null; notify(); }} title={t('Close')} aria-label={t('Close')}>
                <Icon name="close" size={12} />
              </button>
            </p>
          )}
          <div className="mo-full-main">
            <aside className="mo-full-side">{body}</aside>
            <main className="mo-full-stage">{stage}</main>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ── asking for a graphic ──────────────────────────────────────────────────

function Form({ t, lang, ready, inFull, motions, models, gw, onMake, onTemplate, onRemove, onProviders }: {
  t: T;
  lang: Lang;
  models?: readonly ModelChoice[];
  /** The composer's route: what Auto means. */
  gw: Target;
  ready: boolean;
  inFull: boolean;
  motions: Motion[];
  onMake: (d: Pick<Draft, 'request' | 'format' | 'seconds' | 'palette'>) => void;
  onTemplate: (id: RecipeId) => void;
  onRemove: (m: Motion) => void;
  onProviders: () => void;
}) {
  const [request, setRequest] = useDraft('request');
  const [format, setFormat] = useDraft('format');
  const [seconds, setSeconds] = useDraft('seconds');
  const [palette, setPalette] = useDraft('palette');
  const [error, setError] = useDraft('error');
  const [model, setModel] = useState(() => readPick(modelPick, models));
  const can = canMake({ request }, ready);

  const go = () => {
    if (!canMake({ request: draft.request }, ready)) return;
    const d = { request: draft.request, format: draft.format, seconds: draft.seconds, palette: draft.palette };
    setRequest('');
    setError(null);
    onMake(d);
  };

  // Ask Vylo's words: made as soon as the form can, once.
  useEffect(() => {
    if (!draft.autostart || !ready || !draft.request.trim()) return;
    draft.autostart = false;
    window.setTimeout(go, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const colors = palette ? PALETTES.find((p) => p.id === palette)?.colors : undefined;

  return (
    <>
      {!ready && (
        <div className="sb-cta">
          <p className="ft-empty">{t('Add an API key in Settings first.')}</p>
          <button className="ghost bordered" onClick={onProviders}>
            <Icon name="settings" size={13} />
            <span className="cta-label">{t('Open Settings')}</span>
          </button>
        </div>
      )}
      <div className="vid-ask">
        <label className="vid-ask-label" htmlFor="mo-request">{t('What should the graphic show?')}</label>
        <textarea id="mo-request" className="vid-request" dir="auto" rows={3} value={request}
                  placeholder={t('Describe a motion graphic…')}
                  onChange={(e) => { setRequest(e.target.value); if (error) setError(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      go();
                    }
                  }} />

        <div className="vid-group">
          <span className="vid-group-label" id="mo-shape-label">{t('Shape')}</span>
          <div className="mo-form-shapes" role="radiogroup" aria-labelledby="mo-shape-label">
            <button type="button" role="radio" aria-checked={format === null} className={format === null ? 'on' : ''} onClick={() => setFormat(null)}>
              <Icon name="sparkle" size={12} />
              <b>{t('Auto')}</b>
            </button>
            {SHAPES.map((f) => (
              <button key={f} type="button" role="radio" aria-checked={format === f} className={format === f ? 'on' : ''}
                      onClick={() => setFormat(f)} title={formatName(f, t)} aria-label={formatName(f, t)}>
                <i className={SHAPE_CLASS[f]} aria-hidden="true" />
                <b dir="ltr">{formatRatio(f)}</b>
              </button>
            ))}
          </div>
        </div>

        <div className="vid-group">
          <span className="vid-group-label" id="mo-length-label">{t('Length')}</span>
          <div className="vid-seg" role="radiogroup" aria-labelledby="mo-length-label">
            <button type="button" role="radio" aria-checked={seconds === null} className={seconds === null ? 'on' : ''} onClick={() => setSeconds(null)}>
              {t('Auto')}
            </button>
            {LENGTHS.map((n) => (
              <button key={n} type="button" role="radio" aria-checked={seconds === n} className={seconds === n ? 'on' : ''} onClick={() => setSeconds(n)}>
                {secondsText(n, t)}
              </button>
            ))}
          </div>
        </div>

        <div className="vid-group">
          <label className="vid-group-label" htmlFor="mo-palette">{t('Palette')}</label>
          <span className="mo-form-pal">
            <select id="mo-palette" value={palette ?? ''} onChange={(e) => setPalette(e.target.value ? (e.target.value as PaletteId) : null)}>
              <option value="">{t('Auto')}</option>
              {PALETTES.map((p) => <option key={p.id} value={p.id}>{t(p.name)}</option>)}
            </select>
            <span className={colors ? 'mo-form-dots' : 'mo-form-dots is-auto'} aria-hidden="true">
              {colors ? [colors.bg, colors.fg, colors.accent, colors.accent2, colors.muted].map((c, i) => <i key={i} style={{ background: c }} />) : <i />}
            </span>
          </span>
        </div>

        {models && models.length > 1 && (
          <div className="vid-group">
            <label className="vid-group-label" htmlFor="mo-model">{t('Model')}</label>
            <span className="mo-form-pal">
              <select id="mo-model" value={model}
                      onChange={(e) => { const id = readPick(e.target.value, models); setModel(id); setModelPick(id); }}>
                <option value="">{t('Auto')} — {models.find((m) => m.id === gw.model)?.label ?? gw.model}</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id} disabled={!m.ok}>{m.ok ? m.label : `${m.label} — ${t('not on your plan')}`}</option>
                ))}
              </select>
            </span>
          </div>
        )}

        {error && (
          <p className="mo-form-error" role="alert">
            <Icon name="warning" size={12} />
            <span dir="auto">{error}</span>
            <button type="button" className="sb-act" onClick={() => setError(null)} title={t('Dismiss')} aria-label={t('Dismiss')}>
              <Icon name="close" size={11} />
            </button>
          </p>
        )}
        <button className="sb-cta-go vid-go" disabled={!can} onClick={go}
                title={IS_MAC ? `${t('Make it')} (⌘↩)` : `${t('Make it')} (Ctrl+Enter)`}>
          <Icon name="sparkle" size={13} />
          {t('Make it')}
        </button>
        <p className="vid-note">
          {ready ? t('The model designs it from the app’s own shapes, effects and typefaces, never code. Change anything afterwards.')
            : inFull ? t('Templates need no key: start from one in the gallery.')
            : t('Templates need no key: start from one below.')}
        </p>
      </div>

      {!inFull && <Templates t={t} lang={lang} onTemplate={onTemplate} />}

      {motions.length > 0 && (
        <>
          <div className="sb-sub">{t('Your graphics')}</div>
          <ul className="mo-graphics">
            {motions.map((m) => <Row key={m.id} t={t} doc={m} onOpen={() => openGraphic(m.id)} onRemove={() => onRemove(m)} />)}
          </ul>
        </>
      )}
    </>
  );
}

/** The width of an element, kept current as the column is resized. */
function useWidth(ref: RefObject<HTMLElement>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(el.clientWidth);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Cards a row in the templates' grid, and the gap between them, as the stylesheet sets them. */
const CARD_GAP = 8;
const cardsPerRow = (w: number) => (w >= 300 ? 3 : 2);

/** Six templates to start from, drawn with the language's sample words; each plays while the pointer is on it. */
function Templates({ t, lang, onTemplate }: { t: T; lang: Lang; onTemplate: (id: RecipeId) => void }) {
  const [live, setLive] = useState<RecipeId | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const w = useWidth(grid);
  const per = cardsPerRow(w);
  const card = w ? Math.floor((w - CARD_GAP * (per - 1)) / per) : 0;
  // Only the templates this build can make: the gallery hides the rest the same way.
  const cards = useMemo(() => TOP_TEMPLATES.filter((id) => !!RECIPES[id]).map((id) => ({ id, doc: sampleOf(id, lang) })), [lang]);
  if (!cards.length) return null;
  return (
    <section className="mo-tpls" aria-labelledby="mo-tpls-head">
      <div className="mo-tpls-head">
        <span id="mo-tpls-head">{t('Start from a template')}</span>
        <button type="button" className="mo-tpls-all" onClick={() => { openGraphic(null); toggleMotionFull(true); }}>
          {t('All templates')}
          <Icon name="chevron" size={11} />
        </button>
      </div>
      <div className={per === 3 ? 'mo-tpls-grid is-three' : 'mo-tpls-grid'} ref={grid}>
        {cards.map(({ id, doc }) => (
          <button key={id} type="button" className="mo-tpl" onClick={() => onTemplate(id)} title={t(META[id].about)}
                  onPointerEnter={() => setLive(id)} onPointerLeave={() => setLive((x) => (x === id ? null : x))}
                  onFocus={() => setLive(id)} onBlur={() => setLive((x) => (x === id ? null : x))}>
            <span className="mo-tpl-art" style={{ ['--h' as string]: String(META[id].hue) }}>
              {doc && card > 0 ? <MotionThumb doc={doc} width={card} animate={live === id} /> : null}
            </span>
            <span className="mo-tpl-name" dir="auto">{t(META[id].name)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Row({ t, doc, onOpen, onRemove }: { t: T; doc: Motion; onOpen: () => void; onRemove: () => void }) {
  const job = jobs.get(doc.id);
  const status = job?.how === 'plan' || doc.stage === 'planning' ? t('Making…')
    : unmadeOf(doc) ? t('Not finished')
    : `${secondsText(doc.seconds, t)} · ${dateText(doc.updated)}`;
  return (
    <li className="mo-graphic">
      <button type="button" className="mo-graphic-open" onClick={onOpen}>
        <span className="mo-graphic-thumb" aria-hidden="true">
          {doc.layers.length || (doc.stage === 'ready' && !job)
            ? <MotionThumb doc={doc} width={fitWidth(doc.format, 64, 40)} />
            : <span className={job ? 'vid-dot is-live' : 'vid-dot'} />}
        </span>
        <span className="vid-row-what">
          <b dir="auto">{doc.title || doc.request}</b>
          <span>
            <bdi dir="ltr">{formatRatio(doc.format)}</bdi>
            {' · '}
            {status}
          </span>
        </span>
      </button>
      <button type="button" className="sb-act mo-graphic-del" onClick={onRemove}
              title={t('Delete this graphic')} aria-label={`${t('Delete this graphic')} — ${doc.title || doc.request}`}>
        <Glyph name="trash" />
      </button>
    </li>
  );
}

// ── one graphic ───────────────────────────────────────────────────────────

function View({ t, doc, job, making, ready, inFull, sel, log, onEdit, onRemove, onProviders, onError, onSend, onRetry }: {
  t: T;
  doc: Motion;
  job: Job | undefined;
  making: boolean;
  ready: boolean;
  inFull: boolean;
  sel: string | null;
  log: ChatEntry[];
  onEdit: OnEdit;
  onRemove: () => void;
  onProviders: () => void;
  onError: (m: string) => void;
  onSend: (text: string) => void;
  onRetry: () => void;
}) {
  const unfinished = !making && unmadeOf(doc);
  const h = historyOf(doc);
  const busy = job?.how === 'refine';

  // The clock follows the open graphic's length; one just made or started plays from the top.
  useEffect(() => {
    bind(doc.seconds, doc.fps);
  }, [doc.seconds, doc.fps]);
  useEffect(() => {
    if (autoplay !== doc.id || doc.stage !== 'ready' || !doc.layers.length) return;
    autoplay = null;
    reset();
    bind(doc.seconds, doc.fps);
    // Asked for less motion: it waits for Play, at the moment the gallery's still shows — not the empty first frame.
    if (lessMotion()) seek(stillTime(doc.layers, doc.seconds));
    else play();
  }, [doc.id, doc.stage, doc.layers.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const meta = [formatName(doc.format, t), !making && !unfinished ? secondsText(doc.seconds, t) : ''].filter(Boolean).join(' · ');
  const tabNow = tab;
  // Layers' edits, with a layer it adds put in the scene under the playhead (read when the edit lands) when there are scenes.
  const inScene: OnEdit = (change, key) => onEdit((m) => placeAdded(m, change(m), read().t), key);
  // A tab list as the keyboard works one: a single Tab stop, and the arrows, Home and End go from tab to tab and open it.
  const onTabKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const to = tabStep(TABS.indexOf(tab), e.key, getComputedStyle(e.currentTarget).direction === 'rtl', TABS.length);
    if (to === null) return;
    e.preventDefault();
    tab = TABS[to];
    notify();
    document.getElementById(`mo-tab-${TABS[to]}`)?.focus();
  };

  return (
    <div className="mo-view">
      <div className="vid-top">
        <button className="sb-act vid-back" onClick={() => openGraphic(null)} title={t('Back')} aria-label={t('Back')}>
          <Icon name="chevron" size={14} />
        </button>
        <div className="vid-title">
          <b dir="auto">{doc.title || doc.request}</b>
          <span>{meta}</span>
        </div>
        {!making && !unfinished && (
          <UndoRedo t={t} canUndo={canUndo(h, doc)} canRedo={canRedo(h, doc)}
                    onUndo={() => undo(doc.id)} onRedo={() => redo(doc.id)} />
        )}
        {!inFull && (
          <button className="sb-act" onClick={() => toggleMotionFull(true)} title={t('Full screen')} aria-label={t('Full screen')}>
            <Icon name="maximise" size={14} />
          </button>
        )}
        <button className="sb-act" onClick={onRemove} title={t('Delete this graphic')} aria-label={t('Delete this graphic')}>
          <Glyph name="trash" />
        </button>
      </div>

      {making && (
        <>
          {!inFull && <Waiting t={t} doc={doc} />}
          {job?.how === 'plan' && <Working t={t} job={job} onCancel={() => stop(doc.id)} />}
        </>
      )}

      {unfinished && (
        <div className="mo-unmade">
          <p>{t('This graphic was not finished: the app closed while the model was making it.')}</p>
          <p className="mo-unmade-asked" dir="auto">{doc.request}</p>
          {!ready && (
            <div className="sb-cta">
              <p className="ft-empty">{t('Add an API key in Settings first.')}</p>
              <button className="ghost bordered" onClick={onProviders}>
                <Icon name="settings" size={13} />
                <span className="cta-label">{t('Open Settings')}</span>
              </button>
            </div>
          )}
          <button className="sb-cta-go" disabled={!ready || !doc.request.trim()} onClick={onRetry}>
            <Icon name="sparkle" size={13} />
            {t('Make it again')}
          </button>
        </div>
      )}

      {!making && !unfinished && (
        <>
          {/* The one player of the open graphic's sound, in the sidebar and the full window alike (this view is in both). */}
          <MotionSoundPreview doc={doc} />
          {!inFull && <Examples t={t} id={doc.id} />}
          {!inFull && (
            <MotionStage t={t} doc={doc} selected={sel} onSelect={select} compact
                         onMove={(id, x, y, commit) => move(doc.id, id, x, y, commit)} />
          )}
          {!inFull && <Checks t={t} doc={doc} onEdit={onEdit} />}
          {busy && tabNow !== 'ask' && (
            <p className="mo-answering" role="status">
              <span className="vid-glyph" aria-hidden="true">✻</span>
              <span>{t('The model is answering your message…')}</span>
              <button type="button" className="ghost" onClick={() => { tab = 'ask'; notify(); }}>{t('Ask')}</button>
            </p>
          )}
          <div className="vid-tabs mo-tabs" role="tablist" aria-label={t('Motion')} onKeyDown={onTabKey}>
            {TABS.map((x) => (
              <button key={x} type="button" role="tab" id={`mo-tab-${x}`} aria-selected={tabNow === x} aria-controls="mo-tab-panel"
                      tabIndex={tabNow === x ? 0 : -1} className={tabNow === x ? 'on' : ''} onClick={() => { tab = x; notify(); }}>
                {tabName(x, t)}
                {x === 'ask' && busy && <i className="mo-tabs-dot" aria-hidden="true" />}
              </button>
            ))}
          </div>
          <div className="mo-tabs-panel" role="tabpanel" id="mo-tab-panel" aria-labelledby={`mo-tab-${tabNow}`}>
            {tabNow === 'design' && <MotionDesign t={t} doc={doc} selected={sel} onSelect={select} onEdit={onEdit} />}
            {tabNow === 'layers' && <MotionLayers t={t} doc={doc} selected={sel} onSelect={select} onEdit={inScene} />}
            {tabNow === 'ask' && (
              <MotionChat t={t} doc={doc} ready={ready} busy={busy} looking={busy && !!job?.looking} log={log} onSend={onSend}
                          onStop={() => stop(doc.id)} onProviders={onProviders} onError={onError} />
            )}
            {tabNow === 'export' && <MotionExport t={t} doc={doc} onError={onError} />}
          </div>
        </>
      )}
    </div>
  );
}
