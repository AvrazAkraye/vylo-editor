import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react';
import { Icon } from './Icon';
import { fill } from './i18n';
import type { Dir4, Motion } from './motiontypes';
import { LIMITS, isRtlLang } from './motiontypes';
import type { OnEdit, T } from './motionui';
import { bind, read, seek, usePlay } from './motionplay';
import { secs } from './motiontrack';
import { Seg, SliderField, TextBox, type Choice } from './MotionControls';
import { secUnit } from './MotionKinds';
import {
  addScene, canAddScene, canSplitAt, moveScene, removeScene, renameScene, sceneAt, sceneList, sceneSpan, setTransition,
  splitSceneAt, type SceneSpec,
} from './motionscene';
import { TRANSITIONS, directed, dirOfTransition, type TransitionKind } from './motiontransition';

/**
 * The scene strip (pro pass, work package 05): a thin row above the timeline
 * that shows a graphic's scenes and the transitions between them.
 *
 * ## Quiet until asked for
 *
 * A graphic of one scene — every graphic until somebody adds a second — shows
 * nothing here but a small "+ Scene". That is the one control the feature adds
 * to the studio. With two or more, the row shows a chip per scene, as wide as
 * the scene is long, and between two neighbours a small chip saying how the
 * second arrives; "+ Scene" and "Split here" sit at its end.
 *
 * - A scene chip takes the playhead to the scene's start and opens a short
 *   menu: its name, move it earlier or later, join it to its neighbour.
 * - A transition chip opens the kinds, the direction (for the kinds that have
 *   one) and the length.
 * - "+ Scene" adds an empty scene after the one under the playhead; "Split
 *   here" cuts the scene under the playhead in two.
 *
 * Every change is one of `motionscene.ts`'s pure edits, handed to `onEdit` as
 * the rest of the studio's are (motionui.ts), so each is one undo step and is
 * read again like any other.
 *
 * ## Time runs left to right
 *
 * Like the timeline under it: the chips are in time order from the left in
 * every language (`dir="ltr"` on the track, so the insets inside it are
 * left-to-right on purpose), and → is later. The row's own end — where the
 * buttons are — and every menu follow the interface's reading direction.
 *
 * ## The keyboard
 *
 * The track is one tab stop. ← and → go from scene to transition to scene;
 * Home and End to the first and last; Enter or Space opens one; Alt with ← or
 * → moves a scene earlier or later; Delete joins a scene with the one before
 * it (the first, with the one after); F2 opens a scene's menu at its name.
 */

export interface ScenesProps {
  t: T;
  doc: Motion;
  onEdit: OnEdit;
  /** Move the playhead. The studio's clock (`motionplay.ts`) when not given. */
  onSeek?: (at: number) => void;
}

/** A transition's name, in the words Video's storyboard already uses where it has them. */
function kindName(k: TransitionKind, t: T): string {
  switch (k) {
    case 'fade': return t('Fade');
    case 'push': return t('Push across');
    case 'slide': return t('Slide');
    case 'iris': return t('Iris');
    case 'clock': return t('Clock wipe');
    case 'blinds': return t('Blinds');
    case 'pixelate': return t('Pixelate');
    case 'zoom': return t('Zoom');
    case 'whip': return t('Whip pan');
    case 'flash': return t('Flash');
    case 'light-leak': return t('Light leak');
    case 'glitch': return t('Glitch');
    default: return t('Cut');
  }
}

/** Which way a transition travels, with an arrow drawn the way it moves in the graphic's own direction. */
function dirChoice(d: Dir4, t: T, rtl: boolean): Choice<Dir4> {
  if (d === 'up') return { value: d, label: t('From below'), glyph: 'up' };
  if (d === 'down') return { value: d, label: t('From above'), glyph: 'down' };
  if (d === 'start') return { value: d, label: t('From the reading side'), glyph: rtl ? 'left' : 'right' };
  return { value: d, label: t('From the far side'), glyph: rtl ? 'right' : 'left' };
}

const DIR_ORDER: readonly Dir4[] = ['start', 'end', 'up', 'down'];

/** The chips' colours, which scenes take in turn: written out, so the stylesheet's check can see each is used. */
const HUES = ['ms-c0', 'ms-c1', 'ms-c2', 'ms-c3', 'ms-c4', 'ms-c5'] as const;

/** A scene's name as the strip shows it: its own, or "Scene n". */
function shown(s: SceneSpec, i: number, t: T): string {
  return s.name || fill(t('Scene {n}'), { n: i + 1 });
}

/** The interface's reading direction where an element sits: a menu inside the left-to-right track is written in it. */
function dirAt(el: HTMLElement | null): 'ltr' | 'rtl' {
  try {
    return el && getComputedStyle(el).direction === 'rtl' ? 'rtl' : 'ltr';
  } catch {
    return 'ltr';
  }
}

/**
 * A small menu under a chip. Closed by a press outside it, by Escape (the
 * focus goes back to its chip) or by Tab leaving it; opens upward when there
 * is no room below, and toward the middle of the strip from a chip in either
 * half of it.
 */
function Pop({ label, anchor, side, dir, onClose, children }: {
  label: string;
  anchor: RefObject<HTMLElement>;
  side: 'start' | 'end';
  dir: 'ltr' | 'rtl';
  onClose: () => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [up, setUp] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const a = anchor.current?.getBoundingClientRect();
    if (a && r.bottom > window.innerHeight - 8 && a.top - r.height - 8 > 0) setUp(true);
    const first = el.querySelector<HTMLElement>('[aria-checked="true"]') ?? el.querySelector<HTMLElement>('input, button:not(:disabled)');
    first?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target || box.current?.contains(target) || anchor.current?.contains(target)) return;
      close.current();
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [anchor]);
  return (
    <div ref={box} className={`mo-pop ms-pop ${side === 'start' ? 'ms-pop-start' : 'ms-pop-end'}${up ? ' is-up' : ''}`} role="dialog" aria-label={label}
         onKeyDown={(e) => {
           // Its own keys stay its own: the track's arrows must not move the focus out of a menu.
           e.stopPropagation();
           if (e.key !== 'Escape') return;
           e.preventDefault();
           close.current();
           anchor.current?.focus();
         }}
         onBlur={(e) => {
           const next = e.relatedTarget as Node | null;
           if (next && !box.current?.contains(next) && !anchor.current?.contains(next)) close.current();
         }}>
      {/* The menu is written in the interface's direction; its box keeps the track's, so WebKit, which resolves
          a box's logical insets in its own direction, places it beside its chip in every language. */}
      <div className="ms-pop-in" dir={dir}>{children}</div>
    </div>
  );
}

interface ChipProps {
  t: T;
  scene: SceneSpec;
  index: number;
  count: number;
  here: boolean;
  tab: boolean;
  open: boolean;
  onOpen: (id: string) => void;
}

/** One scene's chip: its colour, its name, and when it is. */
const SceneChip = memo(function SceneChip({ t, scene, index, count, here, tab, open, onOpen }: ChipProps) {
  const name = shown(scene, index, t);
  // The name first: a chip as narrow as a short scene shows only the start of it (review R3).
  return (
    <button type="button" className={`ms-chip ${HUES[index % HUES.length]}`} data-ms-key={`s:${scene.id}`} tabIndex={tab ? 0 : -1}
            aria-haspopup="dialog" aria-expanded={open} aria-current={here ? 'true' : undefined}
            title={`${name}\n${fill(t('From {start} s to {end} s'), { start: secs(scene.start), end: secs(scene.end) })}`}
            aria-label={`${name}, ${fill(t('{n} of {of}'), { n: index + 1, of: count })}`}
            onClick={() => onOpen(scene.id)}>
      <span className="ms-name" dir="auto">{name}</span>
    </button>
  );
});

interface CutProps {
  t: T;
  scene: SceneSpec;
  name: string;
  tab: boolean;
  open: boolean;
  onOpen: (id: string) => void;
}

/** The chip between two scenes: how the second arrives. */
const CutChip = memo(function CutChip({ t, scene, name, tab, open, onOpen }: CutProps) {
  const tr = scene.transition;
  const kind = kindName(tr?.kind ?? 'cut', t);
  const how = tr ? fill(t('{kind}, {n} s'), { kind, n: secs(tr.d) }) : kind;
  return (
    <button type="button" className={tr ? 'ms-cut' : 'ms-cut is-cut'} data-ms-key={`t:${scene.id}`} tabIndex={tab ? 0 : -1}
            aria-haspopup="dialog" aria-expanded={open} aria-label={fill(t('How {name} arrives: {how}'), { name, how })} title={how}
            onClick={() => onOpen(scene.id)}>
      {/* A scene too short for the kind's name shows this mark instead (a container query in styles.css, pro:r3). */}
      <span className="ms-cut-glyph" aria-hidden="true"><Icon name="swap" size={10} /></span>
      <span className="ms-cut-name">{kind}</span>
    </button>
  );
});

/** The menu a scene chip opens. */
function SceneMenu({ t, doc, scene, index, count, onEdit, onDone }: {
  t: T;
  doc: Motion;
  scene: SceneSpec;
  index: number;
  count: number;
  onEdit: OnEdit;
  onDone: (focus: string | null) => void;
}) {
  const name = shown(scene, index, t);
  const move = (by: number) => onEdit((m) => moveScene(m, scene.id, index + by));
  const join = () => {
    const keep = sceneList(doc)[index === 0 ? 1 : index - 1];
    onEdit((m) => removeScene(m, scene.id));
    onDone(keep && count > 2 ? `s:${keep.id}` : 'add');
  };
  return (
    <div className="ms-menu">
      <div className="ms-namerow">
        <span className="mo-label" aria-hidden="true">{t('Name')}</span>
        <TextBox label={t('Name')} value={scene.name} placeholder={name} maxLength={LIMITS.name}
                 onChange={(v) => onEdit((m) => renameScene(m, scene.id, v), `scene-name:${scene.id}`)} />
      </div>
      <div className="ms-acts">
        <button type="button" className="ghost" disabled={index === 0} onClick={() => move(-1)}>
          {t('Move earlier')}
        </button>
        <button type="button" className="ghost" disabled={index >= count - 1} onClick={() => move(1)}>
          {t('Move later')}
        </button>
      </div>
      <button type="button" className="ghost ms-join" onClick={join}>
        {index === 0 ? t('Join with the scene after') : t('Join with the scene before')}
      </button>
    </div>
  );
}

/** The menu a transition chip opens: the kind, its direction when it has one, and how long it takes. */
function CutMenu({ t, doc, scene, index, onEdit }: {
  t: T;
  doc: Motion;
  scene: SceneSpec;
  index: number;
  onEdit: OnEdit;
}) {
  const tr = scene.transition;
  const kind: TransitionKind = tr?.kind ?? 'cut';
  const rtl = isRtlLang(doc.lang);
  const before = sceneList(doc)[index - 1];
  const room = Math.min(LIMITS.transitionMax, scene.end - scene.start, before ? before.end - before.start : LIMITS.transitionMax);
  const kinds = TRANSITIONS.map((k) => ({ value: k, label: kindName(k, t) }));
  return (
    <div className="ms-menu">
      <Seg label={t('Transition')} value={kind} columns={3} choices={kinds}
           onChange={(k) => onEdit((m) => setTransition(m, scene.id, k === 'cut' ? null : k))} />
      {tr && directed(tr.kind) && (
        <Seg label={t('Direction')} value={dirOfTransition(tr)} dir={rtl ? 'rtl' : 'ltr'} choices={DIR_ORDER.map((d) => dirChoice(d, t, rtl))}
             onChange={(d) => onEdit((m) => setTransition(m, scene.id, { dir: d }))} />
      )}
      {tr && (
        <SliderField label={t('Duration')} value={tr.d} min={LIMITS.transitionMin} max={Math.max(LIMITS.transitionMin, room)} step={0.05}
                     digits={2} unit={secUnit(t)} onChange={(d) => onEdit((m) => setTransition(m, scene.id, { d }), `scene-cut:${scene.id}`)} />
      )}
    </div>
  );
}

export function MotionScenes({ t, doc, onEdit, onSeek }: ScenesProps) {
  const help = useId();
  const play = usePlay();
  const now = Math.min(play.t, doc.seconds);
  const list = useMemo(() => sceneList(doc), [doc]);
  const here = list.length ? sceneAt(doc, now) : 0;
  const [open, setOpen] = useState<{ what: 'scene' | 'cut'; id: string; dir: 'ltr' | 'rtl' } | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [say, setSay] = useState('');
  const strip = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const later = useRef<{ seek: number | null; focus: string | null }>({ seek: null, focus: null });

  const go = (at: number) => (onSeek ?? seek)(at);

  // After an edit that made a new scene: take the playhead to it once the clock knows the graphic's new length
  // (bound here too, since the stage's own binding may run after this), and put the focus where it belongs.
  useLayoutEffect(() => {
    const l = later.current;
    if (l.seek !== null) {
      if (!onSeek) bind(doc.seconds, doc.fps);
      go(l.seek);
      l.seek = null;
    }
    if (l.focus) {
      const key = l.focus;
      l.focus = null;
      const el = key === 'add'
        ? strip.current?.querySelector<HTMLElement>('.ms-add')
        : track.current?.querySelector<HTMLElement>(`[data-ms-key="${key}"]`);
      el?.focus();
    }
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = list.length;
  const keys = list.flatMap((s, i) => (i === 0 ? [`s:${s.id}`] : [`t:${s.id}`, `s:${s.id}`]));
  const tabKey = focusKey && keys.includes(focusKey) ? focusKey : keys[here * 2] ?? keys[0];

  const opener = (what: 'scene' | 'cut') => (id: string) => {
    const el = track.current?.querySelector<HTMLElement>(`[data-ms-key="${what === 'scene' ? 's' : 't'}:${id}"]`) ?? null;
    anchor.current = el;
    if (open && open.what === what && open.id === id) {
      setOpen(null);
      return;
    }
    if (what === 'scene') {
      const s = list.find((x) => x.id === id);
      if (s) go(s.start);
    }
    setFocusKey(`${what === 'scene' ? 's' : 't'}:${id}`);
    setOpen({ what, id, dir: dirAt(strip.current) });
  };
  const openScene = opener('scene');
  // The chips are handed callbacks that never change, so a chip draws again only when what it shows does — not
  // with every tick of the clock this strip follows.
  const api = useRef({ openScene, openCut: opener('cut') });
  api.current = { openScene, openCut: opener('cut') };
  const [onOpenScene] = useState(() => (id: string) => api.current.openScene(id));
  const [onOpenCut] = useState(() => (id: string) => api.current.openCut(id));

  const add = () => {
    if (!canAddScene(doc)) return;
    const at = read().t;
    later.current.seek = sceneSpan(doc, at).end;
    onEdit((m) => addScene(m, at));
    setSay(fill(t('Scenes: {n}'), { n: Math.max(2, count + 1) }));
  };
  const split = () => {
    const at = read().t;
    if (!canSplitAt(doc, at)) return;
    onEdit((m) => splitSceneAt(m, at));
    setSay(fill(t('Scenes: {n}'), { n: Math.max(2, count + 1) }));
  };

  const onTrackKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const key = target.dataset.msKey;
    if (!key || e.metaKey || e.ctrlKey) return;
    const at = keys.indexOf(key);
    const id = key.slice(2);
    const index = list.findIndex((s) => s.id === id);
    let to = -1;
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.altKey) {
      if (!key.startsWith('s:')) return;
      e.preventDefault();
      const by = e.key === 'ArrowRight' ? 1 : -1;
      if (index + by < 0 || index + by >= count) return;
      later.current.focus = key;
      onEdit((m) => moveScene(m, id, index + by));
      return;
    }
    if (e.key === 'ArrowRight') to = at + 1;
    else if (e.key === 'ArrowLeft') to = at - 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = keys.length - 1;
    else if ((e.key === 'Delete' || e.key === 'Backspace') && key.startsWith('s:')) {
      e.preventDefault();
      const keep = list[index === 0 ? 1 : index - 1];
      later.current.focus = keep && count > 2 ? `s:${keep.id}` : 'add';
      onEdit((m) => removeScene(m, id));
      setSay(fill(t('Scenes: {n}'), { n: count - 1 }));
      return;
    } else if (e.key === 'F2' && key.startsWith('s:')) {
      e.preventDefault();
      openScene(id);
      return;
    } else return;
    e.preventDefault();
    const next = keys[Math.max(0, Math.min(keys.length - 1, to))];
    setFocusKey(next);
    track.current?.querySelector<HTMLElement>(`[data-ms-key="${next}"]`)?.focus();
  };

  const addTitle = canAddScene(doc)
    ? t('Add a scene')
    : fill(t('No room for another scene: a graphic is at most {s} s long and has at most {n} scenes'), { s: LIMITS.seconds, n: LIMITS.scenes });
  const addButton = (
    <button type="button" className={count ? 'ghost ms-add' : 'ghost ms-add ms-quiet'} disabled={!canAddScene(doc)}
            aria-label={t('Add a scene')} title={addTitle} onClick={add}>
      <Icon name="plus" size={12} />
      <span>{t('Scene')}</span>
    </button>
  );
  const status = <span className="vid-tl-sr" role="status">{say}</span>;

  // The same first two children in both shapes of the strip — the status, then the end's box with "+ Scene" first
  // in it — so the second scene does not swap them for new ones: the button keeps the focus it was pressed with,
  // and the status that says "Scenes: 2" is the region that was already there (one put in with its words already
  // in it is often not read out). Review R3.
  if (count < 2) {
    return (
      <div className="ms ms-one" ref={strip}>
        {status}
        <div className="ms-end">{addButton}</div>
      </div>
    );
  }

  const canSplit = canSplitAt(doc, now);
  return (
    <div className="ms" ref={strip}>
      {status}
      <div className="ms-end">
        {addButton}
        <button type="button" className="ghost ms-split" disabled={!canSplit} onClick={split}
                title={canSplit
                  ? t('Cut the scene in two at the playhead')
                  : fill(t('A scene is cut at least {s} s from its ends, and a graphic has at most {n} scenes'), { s: LIMITS.sceneMin, n: LIMITS.scenes })}>
          <Icon name="split" size={12} />
          <span>{t('Split here')}</span>
        </button>
      </div>
      <div className="ms-track" ref={track} dir="ltr" role="toolbar" aria-label={t('Scenes')} aria-describedby={help} onKeyDown={onTrackKey}>
        {list.map((s, i) => {
          const name = shown(s, i, t);
          const side = i < count / 2 ? 'start' : 'end';
          return (
            <div key={s.id} className="ms-scene" style={{ flexGrow: Math.max(0.1, s.end - s.start) }}>
              {i > 0 && (
                <span className="ms-anchor ms-cut-at">
                  <CutChip t={t} scene={s} name={name} tab={tabKey === `t:${s.id}`} open={open?.what === 'cut' && open.id === s.id} onOpen={onOpenCut} />
                  {open?.what === 'cut' && open.id === s.id && (
                    <Pop label={fill(t('How {name} arrives'), { name })} anchor={anchor} side={side} dir={open.dir} onClose={() => setOpen(null)}>
                      <CutMenu t={t} doc={doc} scene={s} index={i} onEdit={onEdit} />
                    </Pop>
                  )}
                </span>
              )}
              <span className="ms-anchor ms-chip-at">
                <SceneChip t={t} scene={s} index={i} count={count} here={i === here} tab={tabKey === `s:${s.id}`}
                           open={open?.what === 'scene' && open.id === s.id} onOpen={onOpenScene} />
                {open?.what === 'scene' && open.id === s.id && (
                  <Pop label={name} anchor={anchor} side={side} dir={open.dir} onClose={() => setOpen(null)}>
                    <SceneMenu t={t} doc={doc} scene={s} index={i} count={count} onEdit={onEdit}
                               onDone={(focus) => { setOpen(null); later.current.focus = focus; }} />
                  </Pop>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <p id={help} className="vid-tl-sr">
        {t('Left and right arrows go from scene to transition to scene. Enter opens one. Alt with an arrow moves a scene earlier or later; Delete joins it with its neighbour; F2 renames it.')}
      </p>
    </div>
  );
}
