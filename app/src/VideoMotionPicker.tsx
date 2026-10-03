import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { fill } from './i18n';
import { MotionThumb } from './MotionThumb';
import { loadMotions } from './motionstore';
import type { Motion } from './motiontypes';
import type { MotionScene, Scene, Video } from './videotypes';
import {
  MAX_HELD, changeSceneMotion, heldDoc, heldIn, newerSaved, overAt, setOver, updateHeld,
  type MotionPatch, type Refusal,
} from './videomotion';

/**
 * Graphics from the Motion studio, in the Video storyboard: the list to
 * choose one from (`MotionPicker`), the editor row of a scene that is a
 * graphic (`MotionSceneRow`) and the "Graphic on top" row every other scene
 * has (`OverRow`). VideoStoryboard.tsx puts them in its cards; videomotion.ts
 * makes every change they hand up.
 *
 * The list is what Motion keeps (`loadMotions`, every record read by Motion's
 * own reader), so it needs nothing of the Motion module being open or even on.
 * Each graphic is shown as itself — Motion's thumbnail paints it with the
 * renderer the film uses — with its name and its length.
 *
 * Placing a graphic writes the film's held graphics and its scenes at once,
 * which the storyboard's scene list alone cannot carry: `onVideo` is that
 * channel (VideoPanel.tsx passes the same change every hand edit goes
 * through). Without it these rows offer only what a scene's own fields can
 * do — Repeat, Starts at, Remove — and never a way in that would end in a
 * scene with nothing to play.
 */

type T = (s: string) => string;

/** A refusal in a plain sentence. */
export function refusalText(r: Refusal, t: T): string {
  if (r === 'full') return fill(t('This film already holds {n} graphics, the most it can. Take one out of the film first.'), { n: MAX_HELD });
  if (r === 'big') return t('This graphic is too large to put in a film: more than 1.5 MB, usually from a big picture in it. Use a smaller picture in Motion and try again.');
  return t('This graphic could not be read.');
}

/** A length in seconds as the storyboard writes one: "4 s", a tenth at most. */
function secondsText(n: number, t: T): string {
  return fill(t('{n} s'), { n: Math.round((Number.isFinite(n) ? n : 0) * 10) / 10 });
}

/**
 * The graphics saved in Motion, newest first, to place one. A refusal (the
 * film is full, the graphic too large) keeps the list open and says why.
 * Escape or Close shuts it, and the focus goes back where it was.
 */
export function MotionPicker({ t, title, using, onPick, onClose }: {
  t: T;
  /** What the list is for, at its head. */
  title: string;
  /** The Motion id of the graphic in place now, marked in the list. */
  using?: string;
  /** Place this graphic; `null` when it was placed, else why not. */
  onPick: (doc: Motion) => Refusal | null;
  onClose: () => void;
}) {
  const [list, setList] = useState<Motion[] | null>(null);
  const [refused, setRefused] = useState<Refusal | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(null);

  useEffect(() => {
    back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let live = true;
    void loadMotions().then((all) => { if (live) setList(all); }, () => { if (live) setList([]); });
    return () => {
      live = false;
      // The focus goes back to what opened the list, while it is still on the page.
      const to = back.current;
      if (to && to.isConnected) to.focus();
    };
  }, []);

  // Once the list is there, the focus is in it: on the first graphic, or on Close when there is none.
  useEffect(() => {
    if (list === null) return;
    const first = box.current?.querySelector<HTMLElement>('.vm-pick-one, .vm-pick-close');
    first?.focus();
  }, [list]);

  const take = (m: Motion) => {
    const why = onPick(m);
    if (why) setRefused(why);
    else onClose();
  };

  return (
    <div className="vid-pick vm-pick" ref={box} role="group" aria-label={title}
         onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
      <b className="vm-pick-title">{title}</b>
      {list === null && <p className="vid-note" role="status">{t('Reading your saved graphics…')}</p>}
      {list !== null && list.length === 0 && (
        <p className="vid-note">{t('You have no saved graphics yet. Make one in Motion and it will be here.')}</p>
      )}
      {list !== null && list.length > 0 && (
        <ul className="vm-pick-list">
          {list.map((m) => (
            <li key={m.id}>
              <button type="button" className={`vm-pick-one${using === m.id ? ' on' : ''}`} aria-current={using === m.id ? 'true' : undefined}
                      onClick={() => take(m)}>
                <span className="vm-pick-art"><MotionThumb doc={m} width={112} /></span>
                <span className="vm-pick-what">
                  <b dir="auto">{m.title}</b>
                  <small>{secondsText(m.seconds, t)}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {refused && <p className="vid-bad" role="alert">{refusalText(refused, t)}</p>}
      <div className="vid-pick-foot">
        <small>{t('A copy goes into the film: changing the graphic in Motion later does not change this film.')}</small>
        <button type="button" className="ghost vm-pick-close" onClick={onClose}>{t('Close')}</button>
      </div>
    </div>
  );
}

/** The saved graphics, for "Update from Motion": read once when a row opens. */
function useSaved(): Motion[] {
  const [saved, setSaved] = useState<Motion[]>([]);
  useEffect(() => {
    let live = true;
    void loadMotions().then((all) => { if (live) setSaved(all); }, () => undefined);
    return () => { live = false; };
  }, []);
  return saved;
}

/** The plain sentence a graphic with a sound of its own gets: it is not mixed into the film in this version (docs/VM.md). */
function SoundNote({ t, doc }: { t: T; doc: Motion | null }) {
  if (!doc?.sound) return null;
  return <p className="vid-note vid-wide">{t('This graphic’s own sound is not part of the film yet.')}</p>;
}

/**
 * The editor row of a scene that is a graphic: its name and length, Change
 * (the list again), Repeat, and — only while the graphic saved in Motion is
 * newer than the copy the film holds — Update from Motion, which brings the
 * new one into every scene that uses it.
 */
export function MotionSceneRow({ t, video, scene, onChange, onVideo, disabled }: {
  t: T;
  video: Video;
  scene: MotionScene;
  onChange: (patch: Partial<Scene>) => void;
  onVideo?: (patch: Partial<Video>) => void;
  disabled?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [refused, setRefused] = useState<Refusal | null>(null);
  const saved = useSaved();
  const held = heldIn(video, scene.motion);
  const doc = heldDoc(held);
  const newer = onVideo ? newerSaved(held, saved) : undefined;
  const put = (r: { patch: MotionPatch } | { refused: Refusal }): Refusal | null => {
    if ('refused' in r) return r.refused;
    onVideo?.(r.patch);
    return null;
  };
  return (
    <>
      <div className="vid-pic vm-row vid-wide">
        <span className="vid-pic-what">
          <b dir="auto">{held && doc ? held.title : t('This graphic is no longer in the film.')}</b>
          {doc && <span>{fill(t('A graphic from Motion, {n} long.'), { n: secondsText(doc.seconds, t) })}</span>}
        </span>
        {onVideo && (
          <button type="button" className="ghost" disabled={disabled} aria-expanded={picking} onClick={() => setPicking(!picking)}>
            <Icon name="swap" size={12} />{t('Change')}
          </button>
        )}
        {newer && held && (
          <button type="button" className="ghost" disabled={disabled}
                  title={t('The graphic was changed in Motion after it was put in this film.')}
                  onClick={() => {
                    const r = updateHeld(video, held.id, newer);
                    if ('refused' in r) setRefused(r.refused);
                    else { setRefused(null); onVideo?.({ motions: r.motions }); }
                  }}>
            <Icon name="refresh" size={12} />{t('Update from Motion')}
          </button>
        )}
      </div>
      <label className="vid-check vid-wide">
        <input type="checkbox" checked={scene.loop === true} disabled={disabled}
               onChange={(e) => onChange({ loop: e.target.checked || undefined } as Partial<Scene>)} />
        <span>{t('Repeat it while the scene lasts')}</span>
      </label>
      <SoundNote t={t} doc={doc} />
      {refused && <p className="vid-bad vid-wide" role="alert">{refusalText(refused, t)}</p>}
      {picking && onVideo && (
        <div className="vid-wide">
          <MotionPicker t={t} title={t('Choose the graphic this scene plays')} using={held?.from}
                        onPick={(m) => put(changeSceneMotion(video, scene.id, m))} onClose={() => setPicking(false)} />
        </div>
      )}
    </>
  );
}

/**
 * "Graphic on top" for any scene that is not a graphic itself: Add (the
 * list), and once there is one its name, Change, Remove and Starts at — the
 * second into the scene it starts; it plays once.
 */
export function OverRow({ t, video, scene, onChange, onVideo, disabled }: {
  t: T;
  video: Video;
  scene: Scene;
  onChange: (patch: Partial<Scene>) => void;
  onVideo?: (patch: Partial<Video>) => void;
  disabled?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const over = scene.kind === 'motion' ? undefined : scene.over;
  const held = over ? heldIn(video, over.motion) : undefined;
  const doc = heldDoc(held);
  // Nothing to show and no way to add one: the row is not there at all.
  if (!over && !onVideo) return null;
  const put = (m: Motion): Refusal | null => {
    const r = setOver(video, scene.id, m);
    if ('refused' in r) return r.refused;
    onVideo?.(r.patch);
    return null;
  };
  return (
    <div className="vm-over">
      <div className="vid-pic vm-row">
        <span className="vid-pic-what">
          <b>{t('Graphic on top')}</b>
          <span dir="auto">{over ? (held && doc ? held.title : t('This graphic is no longer in the film.')) : t('A lower third or a title from Motion, over this scene.')}</span>
        </span>
        {onVideo && (
          <button type="button" className="ghost" disabled={disabled} aria-expanded={picking} onClick={() => setPicking(!picking)}>
            <Icon name={over ? 'swap' : 'plus'} size={12} />{over ? t('Change') : t('Add')}
          </button>
        )}
        {over && (
          <button type="button" className="ghost" disabled={disabled} onClick={() => onChange({ over: undefined } as Partial<Scene>)}>
            <Icon name="close" size={12} />{t('Remove')}
          </button>
        )}
      </div>
      {over && (
        <label className="vid-f vm-over-at">
          <span>{t('Starts at (seconds into the scene)')}</span>
          <input type="number" min={0} max={Math.max(0, scene.seconds - 0.5)} step={0.5} value={over.at ?? 0} disabled={disabled}
                 onChange={(e) => {
                   const n = Number(e.target.value);
                   if (Number.isFinite(n)) onChange({ over: { motion: over.motion, at: overAt(n, scene.seconds) } } as Partial<Scene>);
                 }} />
        </label>
      )}
      {over && <p className="vid-note">{t('It plays once, from that second, over the scene.')}</p>}
      <SoundNote t={t} doc={over ? doc : null} />
      {picking && onVideo && (
        <MotionPicker t={t} title={over ? t('Choose the graphic on top of this scene') : t('Choose a graphic to put on top of this scene')}
                      using={held?.from} onPick={put} onClose={() => setPicking(false)} />
      )}
    </div>
  );
}
