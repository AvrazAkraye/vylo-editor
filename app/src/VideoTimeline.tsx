import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { IS_MAC } from './Welcome';
import { fill } from './i18n';
import { FPS, type Scene, type Video } from './videotypes';
import { TRANSITION_FRAMES, durationInFrames } from './video';
import { gistOf, kindName } from './VideoStoryboard';
import {
  SCENE_MAX, SCENE_MIN, SCENE_STEP, dropIndexOf, duplicateScene, moveScene, removeScene, resizeScene, sceneAtFrame,
  slotsOf, snapSeconds, type Slot,
} from './videohistory';

/**
 * The timeline under the preview: the video's scenes as blocks on a ruler,
 * each as wide as it lasts, and a playhead that follows the player.
 *
 * ## Time runs left to right, in every language
 *
 * An Arabic or Kurdish interface reads right to left, and so does the video's
 * text — but time on this strip runs left to right, as it does in the video
 * editors people in Erbil and Duhok already use (Premiere, CapCut, DaVinci
 * keep their timelines left to right in Arabic too), and as the player's own
 * scrubber above it does (VideoPreview.tsx keeps it left to right, or its
 * clock reads backwards). One direction for time wherever it is drawn, so the
 * playhead on the strip and the knob on the scrubber move the same way. The
 * words inside a block still run in their own direction, and the bars around
 * the strip follow the interface. The arrow keys follow the picture: → is
 * later, ← earlier.
 *
 * ## Editing
 *
 * Click a block to choose it and show it; drag it to move it; drag its end to
 * make it longer or shorter, on the half second, from 2 to 20 seconds; right
 * click for the rest. Every one of those has a key (the "?" on the strip's bar
 * lists them). A drag changes nothing until it is let go, so one drag is one
 * step to undo and one save, not a hundred.
 *
 * ## The playhead
 *
 * The player (VideoPreview.tsx) reports its frame to `playhead` below, and
 * takes seeks and play/pause from it; the strip moves its line by setting a
 * style on it, not by drawing itself again thirty times a second.
 */

type T = (s: string) => string;

// ── the player's clock, shared ────────────────────────────────────────────

interface Clock { frame: number; playing: boolean }
interface Controls {
  seek: (frame: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
}

const clocks = new Map<string, Clock>();
const players = new Map<string, Controls>();
const tickers = new Set<(id: string, c: Clock) => void>();

/**
 * Where each video's preview is, and a way to move it. The preview reports
 * every frame and attaches its controls while it is mounted; the timeline and
 * the video's keys read the one and use the other.
 */
export const playhead = {
  report(id: string, frame: number, playing: boolean): void {
    const c = { frame: Math.max(0, Math.round(frame)), playing };
    clocks.set(id, c);
    for (const f of tickers) f(id, c);
  },
  /** The preview's controls, while it is mounted. Returns the detach. */
  attach(id: string, controls: Controls): () => void {
    players.set(id, controls);
    return () => { if (players.get(id) === controls) players.delete(id); };
  },
  clock(id: string): Clock {
    return clocks.get(id) ?? { frame: 0, playing: false };
  },
  /** `false` when there is no preview to move (it is still loading its fonts). */
  seek(id: string, frame: number): boolean {
    const p = players.get(id);
    if (!p) return false;
    p.seek(frame);
    return true;
  },
  play(id: string): boolean {
    const p = players.get(id);
    if (!p) return false;
    p.play();
    return true;
  },
  toggle(id: string): boolean {
    const p = players.get(id);
    if (!p) return false;
    p.toggle();
    return true;
  },
  subscribe(f: (id: string, c: Clock) => void): () => void {
    tickers.add(f);
    return () => { tickers.delete(f); };
  },
};

// ── the chosen scene, shared by the strip, the storyboard and the keys ────

const chosen = new Map<string, string>();
const choosers = new Set<() => void>();

export function selectScene(videoId: string, sceneId: string | null): void {
  if ((chosen.get(videoId) ?? null) === sceneId) return;
  if (sceneId) chosen.set(videoId, sceneId);
  else chosen.delete(videoId);
  for (const f of choosers) f();
}

export function selectedScene(videoId: string): string | null {
  return chosen.get(videoId) ?? null;
}

const watchChoice = (f: () => void) => {
  choosers.add(f);
  return () => { choosers.delete(f); };
};

function useSelected(videoId: string): string | null {
  return useSyncExternalStore(watchChoice, () => chosen.get(videoId) ?? null);
}

const newId = () => {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** The first frame of scene `i` with the transition into it finished. */
function startOf(slots: Slot[], i: number): number {
  const s = slots[i];
  return s ? s.start + (s.into ? TRANSITION_FRAMES : 0) : 0;
}

/** The scene the keys act on: the chosen one, or the one under the playhead. */
function currentIndex(video: Video): number {
  const id = selectedScene(video.id);
  const i = id ? video.scenes.findIndex((s) => s.id === id) : -1;
  return i >= 0 ? i : sceneAtFrame(video.scenes, playhead.clock(video.id).frame);
}

/** What the strip, its menu and the keys do to a scene — one set of verbs, so they cannot disagree. */
function commandsFor(video: Video, onScenes: (s: Scene[]) => void, onSeek: (i: number) => void, locked: boolean) {
  const scenes = video.scenes;
  const pick = (i: number, seek = true) => {
    const s = scenes[i];
    if (!s) return;
    selectScene(video.id, s.id);
    if (seek) onSeek(i);
  };
  return {
    pick,
    step(by: number) {
      if (!scenes.length) return;
      pick(Math.min(scenes.length - 1, Math.max(0, currentIndex(video) + by)));
    },
    remove(i: number) {
      if (locked || scenes.length <= 1 || !scenes[i]) return;
      const next = removeScene(scenes, i);
      onScenes(next);
      selectScene(video.id, next[Math.min(i, next.length - 1)]?.id ?? null);
    },
    duplicate(i: number) {
      if (locked || !scenes[i]) return;
      const next = duplicateScene(scenes, i, newId);
      onScenes(next);
      selectScene(video.id, next[i + 1].id);
    },
    move(i: number, by: number) {
      const j = i + by;
      if (locked || !scenes[i] || j < 0 || j >= scenes.length) return;
      onScenes(moveScene(scenes, i, j));
      selectScene(video.id, scenes[i].id);
    },
    resize(i: number, by: number) {
      if (locked || !scenes[i]) return;
      const next = resizeScene(scenes, i, (Number(scenes[i].seconds) || SCENE_MIN) + by);
      if (next !== scenes) onScenes(next);
    },
  };
}

// ── looks ─────────────────────────────────────────────────────────────────

/**
 * A colour a kind: words in violets, lists in blues, numbers in greens,
 * pictures in ambers and roses, the close in slate — so the shape of a video
 * reads at a glance, and two scenes of one kind side by side say so.
 */
const KIND_COLOUR: Readonly<Record<string, string>> = {
  title: '#6D5DF6', kinetic: '#9D5CF0', quote: '#C24FD0',
  bullets: '#2F6FE0', steps: '#1497D4', timeline: '#0E8FA6',
  stat: '#1E9E57', chart: '#5E9E1B', compare: '#0F9488',
  image: '#E0931A', split: '#E0662A', gallery: '#C98612', people: '#D8456B',
  outro: '#6B7486', logo: '#56607A', qr: '#40495E',
};

const PAD = 12;
const TAIL = 24;
const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3, 4] as const;
const GAP = 1.5;

function timecode(frame: number): string {
  const s = Math.max(0, frame) / FPS;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}

/** The ruler's step: the smallest that leaves room for its labels. */
function rulerStep(pps: number): number {
  for (const s of [0.5, 1, 2, 5, 10, 15, 30, 60]) if (s * pps >= 44) return s;
  return 120;
}

function tickLabel(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${(Number.isInteger(s) ? String(s) : s.toFixed(1)).padStart(2, '0')}`;
}

/** Drawn on Icon.tsx's grid (24, a 1.5 stroke, round joins), for the few verbs it has no picture for. */
const GLYPHS = {
  undo: 'M9.5 6.5 5 11l4.5 4.5M5.5 11H15a4.5 4.5 0 0 1 0 9h-3',
  redo: 'M14.5 6.5 19 11l-4.5 4.5M18.5 11H9a4.5 4.5 0 0 0 0 9h3',
  copy: 'M9 8.5h9A1.5 1.5 0 0 1 19.5 10v9a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 19v-9A1.5 1.5 0 0 1 9 8.5zM16 5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16',
  trash: 'M5 7h14M10 4h4M7 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4L17 7M10.5 10.5v6M13.5 10.5v6',
  minus: 'M5.5 12h13',
} as const;

function Glyph({ name, size = 14 }: { name: keyof typeof GLYPHS; size?: number }) {
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={GLYPHS[name]} />
    </svg>
  );
}

const MOD = IS_MAC ? '⌘' : 'Ctrl+';
const ALT = IS_MAC ? '⌥' : 'Alt+';
const SHIFT = IS_MAC ? '⇧' : 'Shift+';

// ── the strip ─────────────────────────────────────────────────────────────

interface Press { id: string; from: number; x0: number; scroll0: number; moved: boolean }
interface Drag { id: string; from: number; dx: number; to: number }
interface Grip { id: string; x0: number; scroll0: number; s0: number }

/** The video's scenes on a timeline, under the preview. */
export function VideoTimeline({ t, video, onScenes, onSeek, locked, wide = false }: {
  t: T;
  video: Video;
  onScenes: (scenes: Scene[]) => void;
  onSeek: (index: number) => void;
  /** A model run is changing the video: the strip shows and seeks, and edits nothing. */
  locked: boolean;
  /** Drawn for the full window: taller blocks, more room a second. */
  wide?: boolean;
}): JSX.Element | null {
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const clockEl = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(2);
  const [draft, setDraft] = useState<{ id: string; seconds: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hold, setHold] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ index: number; x: number; y: number } | null>(null);
  const [playing, setPlaying] = useState(() => playhead.clock(video.id).playing);
  const [now, setNow] = useState(() => sceneAtFrame(video.scenes, playhead.clock(video.id).frame));
  const selectedId = useSelected(video.id);
  const press = useRef<Press | null>(null);
  const grip = useRef<Grip | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const draftRef = useRef<{ id: string; seconds: number } | null>(null);
  const scrubbing = useRef(false);
  const blocks = useRef(new Map<string, HTMLLIElement>());

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // A draft length while its end is dragged; everything below is drawn from it.
  const scenes = draft ? video.scenes.map((s) => (s.id === draft.id ? { ...s, seconds: draft.seconds } : s)) : video.scenes;
  const slots = slotsOf(scenes);
  const totalFrames = durationInFrames({ scenes });
  const total = totalFrames / FPS;
  const span = Math.max(total, video.seconds);
  // The canvas is its padding, the film, and room past the end to drag a last scene longer into.
  const fit = width > 0 ? (width - PAD * 2 - TAIL - 1) / span : 0;
  // Held while a drag is on: a strip that rescaled under the pointer as a scene grew would never let go of it.
  const pps = hold ?? Math.max(4, Math.max(wide ? 10 : 14, fit) * ZOOMS[zoom] / ZOOMS[2]);
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  const xOf = (frame: number) => PAD + (frame / FPS) * pps;
  const overlap = (TRANSITION_FRAMES / FPS) * pps;
  const inner = Math.max(width, Math.floor(PAD * 2 + span * pps + TAIL));

  // The playhead follows the player without drawing the strip again.
  useEffect(() => playhead.subscribe((id, c) => {
    if (id !== video.id) return;
    const x = PAD + (c.frame / FPS) * ppsRef.current;
    if (head.current) head.current.style.transform = `translateX(${x}px)`;
    if (clockEl.current) clockEl.current.textContent = timecode(c.frame);
    setPlaying(c.playing);
    setNow(sceneAtFrame(video.scenes, c.frame));
    const sc = scroller.current;
    if (c.playing && sc && !press.current && !grip.current) {
      if (x > sc.scrollLeft + sc.clientWidth - 24 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - 24);
    }
  }), [video.id, video.scenes]);

  // Escape lets go of a drag, before the full window hears it and closes.
  const active = !!drag || !!draft;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      press.current = null;
      grip.current = null;
      dragRef.current = null;
      draftRef.current = null;
      setDrag(null);
      setDraft(null);
      setHold(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);

  const cmd = commandsFor(video, onScenes, onSeek, locked);
  const selectedIndex = selectedId ? video.scenes.findIndex((s) => s.id === selectedId) : -1;
  const focusIndex = selectedIndex >= 0 ? selectedIndex : Math.min(now, video.scenes.length - 1);

  const focusBlock = (id: string | undefined) => {
    if (!id) return;
    requestAnimationFrame(() => blocks.current.get(id)?.focus({ preventScroll: false }));
  };

  const frameAt = (clientX: number) => {
    const r = canvas.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.round(((clientX - r.left - PAD) / pps) * FPS);
  };
  const seekAt = (clientX: number) => {
    playhead.seek(video.id, Math.min(totalFrames - 1, Math.max(0, frameAt(clientX))));
  };
  const scrolled = () => scroller.current?.scrollLeft ?? 0;
  const edgeScroll = (clientX: number) => {
    const sc = scroller.current;
    if (!sc) return;
    const r = sc.getBoundingClientRect();
    if (clientX < r.left + 28) sc.scrollLeft -= 12;
    else if (clientX > r.right - 28) sc.scrollLeft += 12;
  };

  // ── pointer: a block ──
  const onBlockDown = (e: React.PointerEvent<HTMLLIElement>, i: number, s: Scene) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.vid-tl-grip')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { id: s.id, from: i, x0: e.clientX, scroll0: scrolled(), moved: false };
  };
  const onBlockMove = (e: React.PointerEvent<HTMLLIElement>) => {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.x0 + (scrolled() - p.scroll0);
    if (!p.moved && Math.abs(dx) < 5) return;
    if (locked || video.scenes.length < 2) return;
    if (!p.moved) setHold(pps);
    p.moved = true;
    const slot = slots[p.from];
    const centre = slot.start + slot.frames / 2 + (dx / pps) * FPS;
    const d = { id: p.id, from: p.from, dx, to: dropIndexOf(scenes, p.from, centre) };
    dragRef.current = d;
    setDrag(d);
    edgeScroll(e.clientX);
  };
  const onBlockUp = (i: number) => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    setHold(null);
    if (!p.moved) { cmd.pick(i); return; }
    if (d && d.to !== d.from) {
      onScenes(moveScene(video.scenes, d.from, d.to));
      selectScene(video.id, d.id);
    }
  };
  const onBlockCancel = () => {
    press.current = null;
    dragRef.current = null;
    setDrag(null);
    setHold(null);
  };

  // ── pointer: a block's end ──
  const onGripDown = (e: React.PointerEvent<HTMLSpanElement>, s: Scene) => {
    if (e.button !== 0 || locked) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    grip.current = { id: s.id, x0: e.clientX, scroll0: scrolled(), s0: snapSeconds(Number(s.seconds)) };
    const d = { id: s.id, seconds: snapSeconds(Number(s.seconds)) };
    draftRef.current = d;
    setDraft(d);
    setHold(pps);
    selectScene(video.id, s.id);
  };
  const onGripMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    const g = grip.current;
    if (!g) return;
    const dx = e.clientX - g.x0 + (scrolled() - g.scroll0);
    const d = { id: g.id, seconds: snapSeconds(g.s0 + dx / pps) };
    if (draftRef.current?.seconds !== d.seconds) {
      draftRef.current = d;
      setDraft(d);
    }
    edgeScroll(e.clientX);
  };
  const onGripUp = () => {
    const g = grip.current;
    const d = draftRef.current;
    grip.current = null;
    draftRef.current = null;
    setDraft(null);
    setHold(null);
    if (!g || !d) return;
    const i = video.scenes.findIndex((s) => s.id === g.id);
    if (i >= 0) {
      const next = resizeScene(video.scenes, i, d.seconds);
      if (next !== video.scenes) onScenes(next);
    }
  };
  const onGripCancel = () => {
    grip.current = null;
    draftRef.current = null;
    setDraft(null);
    setHold(null);
  };

  // ── keys, on a block ──
  const onBlockKey = (e: React.KeyboardEvent<HTMLLIElement>, i: number) => {
    const s = video.scenes[i];
    if (!s || e.metaKey || e.ctrlKey) return;
    const k = e.key;
    let done = true;
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && e.altKey) {
      cmd.move(i, k === 'ArrowRight' ? 1 : -1);
      focusBlock(s.id);
    } else if ((k === 'ArrowLeft' || k === 'ArrowRight') && e.shiftKey) {
      cmd.resize(i, k === 'ArrowRight' ? SCENE_STEP : -SCENE_STEP);
    } else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End') {
      const j = k === 'Home' ? 0 : k === 'End' ? video.scenes.length - 1 : Math.min(video.scenes.length - 1, Math.max(0, i + (k === 'ArrowRight' ? 1 : -1)));
      cmd.pick(j);
      focusBlock(video.scenes[j]?.id);
    } else if (k === 'Enter') {
      cmd.pick(i);
    } else if (k === ' ') {
      playhead.toggle(video.id);
    } else if (k === 'Delete' || k === 'Backspace') {
      const next = video.scenes[i + 1] ?? video.scenes[i - 1];
      cmd.remove(i);
      focusBlock(next?.id);
    } else if ((k === 'd' || k === 'D') && !e.altKey && !e.shiftKey) {
      cmd.duplicate(i);
      requestAnimationFrame(() => focusBlock(selectedScene(video.id) ?? undefined));
    } else if (k === 'ContextMenu' || (k === 'F10' && e.shiftKey)) {
      const r = e.currentTarget.getBoundingClientRect();
      selectScene(video.id, s.id);
      setMenu({ index: i, x: r.left + 8, y: r.bottom + 4 });
    } else {
      done = false;
    }
    if (done) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // ── keys, on the ruler ──
  const onRulerKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const f = playhead.clock(video.id).frame;
    let to: number | null = null;
    if (e.key === 'ArrowRight') to = f + (e.shiftKey ? 5 : 1) * FPS;
    else if (e.key === 'ArrowLeft') to = f - (e.shiftKey ? 5 : 1) * FPS;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = totalFrames - 1;
    else if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); playhead.toggle(video.id); return; }
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    playhead.seek(video.id, Math.min(totalFrames - 1, Math.max(0, to)));
  };

  // ── the ruler's marks ──
  const step = rulerStep(pps);
  const ticks: { at: number; major: boolean }[] = [];
  const minor = step / 2;
  const showMinor = minor * pps >= 10;
  const lastTick = (inner - PAD - 20) / pps;
  for (let s = 0; s <= lastTick; s += showMinor ? minor : step) {
    const major = Math.abs(s / step - Math.round(s / step)) < 1e-6;
    ticks.push({ at: s, major });
  }

  // How the length compares with what was asked.
  const diff = total - video.seconds;
  const near = Math.abs(diff) <= Math.max(1, video.seconds * 0.05);
  const lengthSay = near
    ? t('About the length you asked for')
    : diff > 0
      ? fill(t('{n} s longer than you asked'), { n: Math.round(diff * 10) / 10 })
      : fill(t('{n} s shorter than you asked'), { n: Math.round(-diff * 10) / 10 });

  // Where a dragged block would land.
  let dropX: number | null = null;
  if (drag && drag.to !== drag.from) {
    const others = slots.filter((_, i) => i !== drag.from);
    const at = others[drag.to];
    const last = others[others.length - 1];
    dropX = at ? xOf(at.start) : last ? xOf(last.start + last.frames) : null;
  }

  const clock = playhead.clock(video.id);
  const sel = selectedIndex >= 0 ? video.scenes[selectedIndex] : null;
  const helpId = `vid-tl-help-${video.id}`;
  const blockH = wide ? 58 : 46;
  const uiDir = typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';

  return (
    <section className={`vid-tl ${wide ? 'is-wide' : ''} ${locked ? 'is-locked' : ''}`} aria-label={t('Scenes on a timeline')}>
      <div className="vid-tl-bar">
        <button type="button" className="sb-act vid-tl-play" onClick={() => playhead.toggle(video.id)}
                title={`${playing ? t('Pause') : t('Play the preview')} (${t('Space')})`} aria-label={playing ? t('Pause') : t('Play the preview')}>
          <Icon name={playing ? 'pause' : 'play'} size={13} />
        </button>
        <span className="vid-tl-clock" dir="ltr">
          <span ref={clockEl}>{timecode(clock.frame)}</span>
          <span className="vid-tl-of"> / {timecode(totalFrames)}</span>
        </span>
        <span className={`vid-tl-len ${near ? 'is-near' : diff > 0 ? 'is-over' : 'is-under'}`} title={lengthSay}>
          <i aria-hidden="true" />
          {fill(t('{s} s of {asked} s'), { s: Math.round(total * 10) / 10, asked: video.seconds })}
          <span className="vid-tl-sr">{` — ${lengthSay}`}</span>
        </span>
        <KeysHelp t={t} />
      </div>

      <div className="vid-tl-scroll" ref={scroller} dir="ltr">
        <div className="vid-tl-canvas" ref={canvas} style={{ inlineSize: inner }}>
          <div className="vid-tl-ruler" role="slider" tabIndex={0} aria-label={t('Position in the video')}
               aria-valuemin={0} aria-valuemax={Math.round(total * 10) / 10} aria-valuenow={Math.round((clock.frame / FPS) * 10) / 10}
               aria-valuetext={`${timecode(clock.frame)} / ${timecode(totalFrames)}`}
               onKeyDown={onRulerKey}
               onPointerDown={(e) => {
                 if (e.button !== 0) return;
                 e.currentTarget.setPointerCapture(e.pointerId);
                 scrubbing.current = true;
                 seekAt(e.clientX);
               }}
               onPointerMove={(e) => { if (scrubbing.current) seekAt(e.clientX); }}
               onPointerUp={() => { scrubbing.current = false; }}
               onPointerCancel={() => { scrubbing.current = false; }}>
            {ticks.map((k) => (
              <span key={k.at} className={k.major ? 'vid-tl-tick is-major' : 'vid-tl-tick'} style={{ insetInlineStart: xOf(k.at * FPS) }}>
                {k.major && <b>{tickLabel(k.at)}</b>}
              </span>
            ))}
          </div>

          <ol className="vid-tl-track" role="listbox" aria-label={t('Scenes')} aria-orientation="horizontal"
              aria-describedby={helpId} style={{ blockSize: blockH }}>
            {scenes.map((s, i) => {
              const slot = slots[i];
              const x = xOf(slot.start);
              const w = (slot.frames / FPS) * pps;
              const lt = slot.into ? overlap + GAP : GAP;
              const rb = slot.out ? w - overlap - GAP : w - GAP;
              const clip = `polygon(${lt}px 0, ${w - GAP}px 0, ${rb}px 100%, ${GAP}px 100%)`;
              const dragging = drag?.id === s.id;
              const gist = String(gistOf(s) ?? '');
              const kind = kindName(s.kind, t);
              const on = selectedId === s.id;
              return (
                <li key={s.id} ref={(el) => { if (el) blocks.current.set(s.id, el); else blocks.current.delete(s.id); }}
                    role="option" aria-selected={on} tabIndex={i === focusIndex ? 0 : -1}
                    aria-label={`${fill(t('Scene {n}: {kind}, {s} s'), { n: i + 1, kind, s: s.seconds })}${gist ? ` — ${gist}` : ''}`}
                    className={`vid-tl-block ${on ? 'is-on' : ''} ${now === i ? 'is-now' : ''} ${dragging ? 'is-drag' : ''} ${draft?.id === s.id ? 'is-sizing' : ''}`}
                    style={{
                      insetInlineStart: x, inlineSize: w, clipPath: clip,
                      transform: dragging ? `translateX(${drag.dx}px) translateY(-3px)` : undefined,
                      ['--c' as string]: KIND_COLOUR[s.kind] ?? '#6B7486',
                    }}
                    onPointerDown={(e) => onBlockDown(e, i, s)}
                    onPointerMove={onBlockMove}
                    onPointerUp={() => onBlockUp(i)}
                    onPointerCancel={onBlockCancel}
                    onContextMenu={(e) => { e.preventDefault(); selectScene(video.id, s.id); setMenu({ index: i, x: e.clientX, y: e.clientY }); }}
                    onKeyDown={(e) => onBlockKey(e, i)}>
                  {/* The words follow the interface's side; the room left for the slanted joins is physical, as the strip is. */}
                  <span className="vid-tl-in" dir={uiDir}
                        style={{ paddingLeft: (slot.into ? overlap : 0) + 7, paddingRight: (slot.out ? overlap : 0) + 10 }}>
                    <b><span className="vid-tl-n">{i + 1}</span>{kind}</b>
                    <span className="vid-tl-gist"><bdi>{gist || '—'}</bdi></span>
                  </span>
                  {!locked && (
                    <span className="vid-tl-grip" aria-hidden="true" title={t('Drag to change the length')}
                          style={{ insetInlineEnd: slot.out ? Math.max(0, overlap / 2 - 2) : 0 }}
                          onPointerDown={(e) => onGripDown(e, s)} onPointerMove={onGripMove}
                          onPointerUp={onGripUp} onPointerCancel={onGripCancel} />
                  )}
                </li>
              );
            })}
          </ol>

          <i className="vid-tl-asked" aria-hidden="true" title={t('The length you asked for')} style={{ insetInlineStart: xOf(video.seconds * FPS) }} />
          {dropX !== null && <i className="vid-tl-drop" aria-hidden="true" style={{ insetInlineStart: dropX - 1 }} />}
          {draft && (() => {
            const i = scenes.findIndex((s) => s.id === draft.id);
            const slot = slots[i];
            return slot
              ? <span className="vid-tl-badge" role="status" style={{ insetInlineStart: xOf(slot.start + slot.frames) }}>{fill(t('{n} s'), { n: draft.seconds })}</span>
              : null;
          })()}
          <div className="vid-tl-head" ref={head} aria-hidden="true" style={{ transform: `translateX(${xOf(clock.frame)}px)` }}><i /></div>
        </div>
      </div>

      <div className="vid-tl-foot">
        {sel
          ? (
            <span className="vid-tl-sel">
              <b>{fill(t('Scene {n}'), { n: selectedIndex + 1 })}</b>
              <span>{kindName(sel.kind, t)} · {fill(t('{n} s'), { n: sel.seconds })}</span>
            </span>
          )
          : <span className="vid-tl-hint">{locked ? t('The scenes can be changed again when the model has finished.') : t('Drag a scene to move it, or its end to change its length.')}</span>}
        <span className="vid-tl-acts">
          <button type="button" className="sb-act" disabled={!sel || locked || selectedIndex <= 0} onClick={() => cmd.move(selectedIndex, -1)}
                  title={`${t('Move earlier')} (${ALT}←)`} aria-label={t('Move earlier')}>
            <Icon name="chevron" size={12} turn={180} />
          </button>
          <button type="button" className="sb-act" disabled={!sel || locked || selectedIndex >= video.scenes.length - 1} onClick={() => cmd.move(selectedIndex, 1)}
                  title={`${t('Move later')} (${ALT}→)`} aria-label={t('Move later')}>
            <Icon name="chevron" size={12} />
          </button>
          <button type="button" className="sb-act" disabled={!sel || locked} onClick={() => cmd.duplicate(selectedIndex)}
                  title={`${t('Duplicate the scene')} (D)`} aria-label={t('Duplicate the scene')}>
            <Glyph name="copy" size={13} />
          </button>
          <button type="button" className="sb-act" disabled={!sel || locked || video.scenes.length <= 1} onClick={() => cmd.remove(selectedIndex)}
                  title={`${t('Remove this scene')} (${IS_MAC ? '⌫' : 'Delete'})`} aria-label={t('Remove this scene')}>
            <Glyph name="trash" size={13} />
          </button>
          <i className="vid-tl-sep" aria-hidden="true" />
          <button type="button" className="sb-act" disabled={zoom <= 0} onClick={() => setZoom((z) => Math.max(0, z - 1))}
                  title={t('Zoom out')} aria-label={t('Zoom out')}>
            <Glyph name="minus" size={13} />
          </button>
          <button type="button" className="sb-act" disabled={zoom >= ZOOMS.length - 1} onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
                  title={t('Zoom in')} aria-label={t('Zoom in')}>
            <Icon name="plus" size={13} />
          </button>
        </span>
      </div>
      <p id={helpId} className="vid-tl-sr">
        {t('Arrow keys choose a scene. With Alt, an arrow moves it; with Shift, it makes it half a second shorter or longer. Delete removes it, D duplicates it, Space plays.')}
      </p>

      {menu && video.scenes[menu.index] && createPortal(
        <SceneMenu t={t} x={menu.x} y={menu.y} index={menu.index} count={video.scenes.length} locked={locked}
                   seconds={Number(video.scenes[menu.index].seconds) || SCENE_MIN}
                   onClose={() => { const id = video.scenes[menu.index]?.id; setMenu(null); focusBlock(id); }}
                   onPlay={() => {
                     const i = menu.index;
                     selectScene(video.id, video.scenes[i].id);
                     playhead.seek(video.id, startOf(slots, i));
                     playhead.play(video.id);
                   }}
                   onDuplicate={() => cmd.duplicate(menu.index)}
                   onRemove={() => cmd.remove(menu.index)}
                   onMove={(by) => cmd.move(menu.index, by)}
                   onResize={(by) => cmd.resize(menu.index, by)} />,
        document.body,
      )}
    </section>
  );
}

/** A scene's menu, where the pointer was right-clicked or under the block Shift+F10 was pressed on. */
function SceneMenu({ t, x, y, index, count, seconds, locked, onClose, onPlay, onDuplicate, onRemove, onMove, onResize }: {
  t: T;
  x: number;
  y: number;
  index: number;
  count: number;
  seconds: number;
  locked: boolean;
  onClose: () => void;
  onPlay: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onMove: (by: -1 | 1) => void;
  onResize: (by: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ x, y });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAt({ x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [x, y]);
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const item = (label: string, keys: string, run: () => void, disabled = false) => (
    <button type="button" role="menuitem" disabled={disabled} onClick={() => { run(); onClose(); }}>
      <span>{label}</span>
      {keys && <kbd dir="ltr">{keys}</kbd>}
    </button>
  );
  return (
    <div className="vid-tl-menu" role="menu" ref={box} aria-label={fill(t('Scene {n}'), { n: index + 1 })}
         // Where the pointer was, in the window's own coordinates — the one place a physical side is right.
         style={{ left: at.x, top: at.y }}
         onKeyDown={(e) => {
           const items = [...(box.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
           const i = items.indexOf(document.activeElement as HTMLButtonElement);
           if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); onClose(); }
           else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
           else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
           else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
           else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
         }}>
      {item(t('Play from here'), '', onPlay)}
      <hr />
      {item(t('Duplicate the scene'), 'D', onDuplicate, locked)}
      {item(t('Move earlier'), `${ALT}←`, () => onMove(-1), locked || index === 0)}
      {item(t('Move later'), `${ALT}→`, () => onMove(1), locked || index >= count - 1)}
      {item(t('Half a second longer'), `${SHIFT}→`, () => onResize(SCENE_STEP), locked || seconds >= SCENE_MAX)}
      {item(t('Half a second shorter'), `${SHIFT}←`, () => onResize(-SCENE_STEP), locked || seconds <= SCENE_MIN)}
      <hr />
      {item(t('Remove this scene'), IS_MAC ? '⌫' : 'Delete', onRemove, locked || count <= 1)}
    </div>
  );
}

// ── the video view's bar: undo, redo, and the keys ────────────────────────

export function UndoRedo({ t, canUndo, canRedo, onUndo, onRedo }: {
  t: T;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <span className="vid-tl-undo">
      <button type="button" className="sb-act" disabled={!canUndo} onClick={onUndo}
              title={`${t('Undo')} (${MOD}Z)`} aria-label={t('Undo')}>
        <Glyph name="undo" />
      </button>
      <button type="button" className="sb-act" disabled={!canRedo} onClick={onRedo}
              title={`${t('Redo')} (${IS_MAC ? '⇧⌘Z' : 'Ctrl+Y'})`} aria-label={t('Redo')}>
        <Glyph name="redo" />
      </button>
    </span>
  );
}

/** The "?" on the timeline's bar: every key the video view answers to. */
export function KeysHelp({ t }: { t: T }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      wrap.current?.querySelector('button')?.focus();
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc, true);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc, true);
    };
  }, [open]);
  const rows: [string, string][] = [
    [t('Space'), t('Play or pause')],
    ['← →', t('Previous or next scene')],
    [IS_MAC ? '⌫' : 'Delete', t('Remove the chosen scene')],
    ['D', t('Duplicate the chosen scene')],
    [`${MOD}Z`, t('Undo')],
    [IS_MAC ? '⇧⌘Z' : 'Ctrl+Y', t('Redo')],
    [`${ALT}← ${ALT}→`, t('Move the scene earlier or later (on the timeline)')],
    [`${SHIFT}← ${SHIFT}→`, t('Half a second shorter or longer (on the timeline)')],
    [IS_MAC ? '⇧F10' : 'Shift+F10', t('More for the scene (or right-click it)')],
  ];
  return (
    <span className="vid-tl-keys" ref={wrap}>
      <button type="button" className="sb-act vid-tl-q" onClick={() => setOpen(!open)} aria-expanded={open}
              title={t('Keyboard shortcuts')} aria-label={t('Keyboard shortcuts')}>?</button>
      {open && (
        <div className="vid-tl-pop" role="dialog" aria-label={t('Keyboard shortcuts')}>
          <b>{t('Keyboard shortcuts')}</b>
          <dl>
            {rows.map(([k, what]) => (
              <div key={what}>
                <dt><kbd dir="ltr">{k}</kbd></dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
          <p>{t('They work when the typing cursor is not in a field.')}</p>
        </div>
      )}
    </span>
  );
}

/**
 * The video view's keys: Space plays, ← → go through the scenes, Delete and
 * D remove and duplicate the chosen scene, and ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Y)
 * undo and redo. Only while the focus is in the video's part of the window —
 * the sidebar's panel, or the whole full window — and never while it is in a
 * field, where the keys are the field's (its own undo included). A key a
 * button or a radio answers to itself is left to it.
 */
export function useVideoKeys(o: {
  video: Video;
  scope: RefObject<HTMLElement>;
  locked: boolean;
  onScenes: (scenes: Scene[]) => void;
  onSeek: (index: number) => void;
  onUndo: () => void;
  onRedo: () => void;
}): void {
  const live = useRef(o);
  live.current = o;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const { video, scope, locked, onScenes, onSeek, onUndo, onRedo } = live.current;
      const el = scope.current;
      const act = document.activeElement;
      if (!el || !(act instanceof HTMLElement)) return;
      const root = el.closest('.vid-full') ?? el.closest('.vid') ?? el;
      if (!root.contains(act)) return;
      // A menu or a popover inside it has keys of its own.
      const inner = act.closest('[role="menu"], [role="dialog"], [role="alertdialog"]');
      if (inner && inner !== root && !inner.classList.contains('vid-full')) return;
      const field = act.isContentEditable
        || act.matches('textarea, select, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="color"]):not([type="range"])');
      const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && !e.altKey && (k === 'z' || (!IS_MAC && k === 'y' && !e.shiftKey))) {
        if (field) return;
        e.preventDefault();
        if (k === 'y' || e.shiftKey) onRedo();
        else onUndo();
        return;
      }
      if (field || e.metaKey || e.ctrlKey || e.altKey) return;
      const control = act.matches('button, a[href], summary, [role="button"], [role="menuitem"]');
      const own = act.matches('[role="radio"], [role="tab"], [role="slider"], [role="option"], input, video, audio');
      const cmd = commandsFor(video, onScenes, onSeek, locked);
      const chosenIndex = () => {
        const id = selectedScene(video.id);
        return id ? video.scenes.findIndex((s) => s.id === id) : -1;
      };
      if (e.key === ' ') {
        if (control || own) return;
        e.preventDefault();
        playhead.toggle(video.id);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (own || e.shiftKey || !video.scenes.length) return;
        e.preventDefault();
        cmd.step(e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const i = chosenIndex();
        if (i < 0 || own) return;
        e.preventDefault();
        cmd.remove(i);
      } else if (k === 'd' && !e.shiftKey) {
        const i = chosenIndex();
        if (i < 0 || own) return;
        e.preventDefault();
        cmd.duplicate(i);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
