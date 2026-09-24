import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { fill } from './i18n';
import { explain } from './errors';
import { SCENE_KINDS, type Picture, type Scene, type SceneKind, type Transition, type Video } from './videotypes';
import { searchPictures, fetchPicture, type Candidate } from './videomedia';
import { SceneThumb } from './VideoScenes';

/**
 * The storyboard, as the person edits it: one card a scene.
 *
 * Every field here is a plain value the person can read and change — a line
 * of text, a number, a colour — because that is all a scene is. The model
 * proposed them; nothing it wrote is run, and nothing it wrote leaves this
 * window except in the MP4 the person exports. See videotypes.ts.
 */

type T = (s: string) => string;

/** The kinds that show a picture, and so get "Change the picture". */
export const PICTURED: ReadonlySet<SceneKind> = new Set<SceneKind>(['title', 'image', 'split']);

/** A kind's name, written out as calls so the catalogue scanner sees each one. */
export function kindName(k: SceneKind, t: T): string {
  if (k === 'title') return t('Title');
  if (k === 'kinetic') return t('Moving words');
  if (k === 'bullets') return t('Points');
  if (k === 'stat') return t('A number');
  if (k === 'chart') return t('Bar chart');
  if (k === 'quote') return t('Quotation');
  if (k === 'image') return t('Picture');
  if (k === 'split') return t('Picture and text');
  if (k === 'steps') return t('Steps');
  return t('Closing');
}

export function kindAbout(k: SceneKind, t: T): string {
  if (k === 'title') return t('A headline and a line under it, to open with.');
  if (k === 'kinetic') return t('One sentence, large, a few words at a time.');
  if (k === 'bullets') return t('A heading and up to five points arriving one by one.');
  if (k === 'stat') return t('One real number that counts up, with what it measures.');
  if (k === 'chart') return t('Up to six bars that grow, from numbers you give.');
  if (k === 'quote') return t('A quotation and who said it.');
  if (k === 'image') return t('A picture across the frame, slowly moving, with a caption.');
  if (k === 'split') return t('A picture on one side, a heading and a sentence on the other.');
  if (k === 'steps') return t('Up to five numbered steps, in order.');
  return t('The brand, what to do next, and where.');
}

function transitionName(x: Transition, t: T): string {
  if (x === 'fade') return t('Fade');
  if (x === 'slide') return t('Slide');
  if (x === 'wipe') return t('Wipe');
  if (x === 'zoom') return t('Zoom');
  return t('Cut');
}

const TRANSITIONS: readonly Transition[] = ['fade', 'slide', 'wipe', 'zoom', 'none'];

/** The first words of a scene, for its card when it is folded. */
export function gistOf(s: Scene): string {
  switch (s.kind) {
    case 'title': return s.title;
    case 'kinetic': return s.text;
    case 'bullets': return s.heading;
    case 'stat': return `${s.prefix ?? ''}${s.value}${s.suffix ?? ''} ${s.label}`.trim();
    case 'chart': return s.heading;
    case 'quote': return s.quote;
    case 'image': return s.caption ?? '';
    case 'split': return s.heading;
    case 'steps': return s.heading;
    default: return s.headline;
  }
}

/**
 * A candidate's thumbnail, straight from Openverse or Wikimedia — the window's
 * content policy allows pictures from those hosts. A shimmer until it arrives;
 * a tile that fails stays blank, and the rest of the grid is still useful.
 */
function WebThumb({ url, alt }: { url: string; alt: string }) {
  const [shown, setShown] = useState(false);
  return (
    <>
      {!shown && <span className="vid-shimmer" aria-hidden="true" />}
      <img src={url} alt={alt} draggable={false} loading="lazy" referrerPolicy="no-referrer"
           onLoad={() => setShown(true)} style={shown ? undefined : { opacity: 0 }} />
    </>
  );
}

/**
 * Search again for a scene's picture and choose another. Only openly licensed
 * pictures come back (videomedia.ts), each with its credit, which is carried
 * into the video's closing card.
 */
function PictureChooser({ t, scene, video, onPick, onClose, onError }: {
  t: T;
  scene: Scene;
  video: Video;
  onPick: (p: Picture | undefined) => void;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [query, setQuery] = useState(scene.picture?.query ?? scene.imageQuery ?? '');
  const [found, setFound] = useState<Candidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [taking, setTaking] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);

  const go = async () => {
    const q = query.trim();
    if (!q) return;
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setSearching(true);
    try {
      setFound(await searchPictures(q, { count: 12, format: video.format, signal: c.signal }));
    } catch (e) {
      if (!c.signal.aborted) onError(explain(e, t('search for pictures')));
    } finally {
      if (ctl.current === c) setSearching(false);
    }
  };

  const take = async (cand: Candidate) => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setTaking(cand.url);
    try {
      onPick(await fetchPicture(cand, query.trim(), { signal: c.signal }));
      onClose();
    } catch (e) {
      if (!c.signal.aborted) onError(explain(e, t('fetch the picture')));
    } finally {
      if (ctl.current === c) setTaking(null);
    }
  };

  useEffect(() => { if (query.trim()) void go(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="vid-pick">
      <div className="vid-pick-bar">
        <input className="vid-pick-q" value={query} dir="ltr" onChange={(e) => setQuery(e.target.value)}
               placeholder={t('Words to search with, in English')} aria-label={t('Words to search with, in English')}
               onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void go(); } }} />
        <button type="button" className="ghost" disabled={searching || !query.trim()} onClick={() => void go()}>
          <Icon name="search" size={12} />{t('Search')}
        </button>
      </div>
      {searching && <p className="vid-note">{t('Searching openly licensed pictures…')}</p>}
      {found && !searching && found.length === 0 && <p className="vid-note">{t('Nothing found. Try other words.')}</p>}
      {found && found.length > 0 && (
        <ul className="vid-pick-grid">
          {found.map((c) => (
            <li key={c.url}>
              <button type="button" className={`vid-pick-one ${taking === c.url ? 'is-taking' : ''}`} disabled={!!taking}
                      onClick={() => void take(c)} title={c.credit}>
                <WebThumb url={c.thumb} alt={c.title} />
                <span className="vid-pick-lic">{c.license}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="vid-pick-foot">
        <small>{t('Openly licensed pictures from Openverse and Wikimedia Commons. Each one is credited at the end of the video.')}</small>
        {scene.picture && (
          <button type="button" className="ghost" onClick={() => { onPick(undefined); onClose(); }}>{t('No picture')}</button>
        )}
        <button type="button" className="ghost" onClick={onClose}>{t('Close')}</button>
      </div>
    </div>
  );
}

/**
 * Lines of a list — points, steps — typed one per line. What is typed stays as
 * typed while the field has the focus: an empty line is where the next point
 * is about to go, and filtering it out on the keystroke would make Enter do
 * nothing.
 */
function LinesField({ label, value, max, onChange, disabled }: {
  label: string;
  value: string[];
  max: number;
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value.join('\n'));
  const clean = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, max);
  useEffect(() => {
    setText((cur) => (clean(cur).join('\n') === value.join('\n') ? cur : value.join('\n')));
  }, [value.join('\n')]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="vid-f vid-wide">
      <span>{label}</span>
      <textarea rows={Math.min(max, Math.max(2, value.length + 1))} value={text} dir="auto" disabled={disabled}
                onChange={(e) => { setText(e.target.value); onChange(clean(e.target.value)); }}
                onBlur={() => setText(value.join('\n'))} />
    </label>
  );
}

/** One scene's own fields, by kind. */
function SceneFields({ t, scene, onChange, disabled }: {
  t: T;
  scene: Scene;
  onChange: (patch: Partial<Scene>) => void;
  disabled?: boolean;
}) {
  const text = (label: string, value: string | undefined, key: string, wide = false, long = false) => (
    <label className={wide ? 'vid-f vid-wide' : 'vid-f'} key={key}>
      <span>{label}</span>
      {long
        ? <textarea rows={3} value={value ?? ''} dir="auto" disabled={disabled}
                    onChange={(e) => onChange({ [key]: e.target.value } as Partial<Scene>)} />
        : <input value={value ?? ''} dir="auto" disabled={disabled}
                 onChange={(e) => onChange({ [key]: e.target.value } as Partial<Scene>)} />}
    </label>
  );
  const s = scene;
  if (s.kind === 'title') return <>{text(t('Headline'), s.title, 'title', true)}{text(t('Line under it'), s.subtitle, 'subtitle', true)}</>;
  if (s.kind === 'kinetic') return text(t('Sentence'), s.text, 'text', true, true);
  if (s.kind === 'bullets') {
    return (
      <>
        {text(t('Heading'), s.heading, 'heading', true)}
        <LinesField label={t('Points, one per line (up to five)')} value={s.points} max={5} disabled={disabled}
                    onChange={(points) => onChange({ points } as Partial<Scene>)} />
      </>
    );
  }
  if (s.kind === 'stat') {
    return (
      <>
        <label className="vid-f">
          <span>{t('Number')}</span>
          <input type="number" value={Number.isFinite(s.value) ? s.value : 0} disabled={disabled}
                 onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange({ value: n } as Partial<Scene>); }} />
        </label>
        {text(t('What it measures'), s.label, 'label')}
        {text(t('Before the number'), s.prefix, 'prefix')}
        {text(t('After the number'), s.suffix, 'suffix')}
      </>
    );
  }
  if (s.kind === 'chart') {
    const bars = s.bars;
    const put = (next: { label: string; value: number }[]) => onChange({ bars: next } as Partial<Scene>);
    return (
      <>
        {text(t('Heading'), s.heading, 'heading', true)}
        <div className="vid-f vid-wide">
          <span>{t('Bars')}</span>
          <ul className="vid-bars">
            {bars.map((b, i) => (
              <li key={i}>
                <input className="vid-bar-label" value={b.label} dir="auto" disabled={disabled} aria-label={t('Label')}
                       onChange={(e) => put(bars.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <input className="vid-bar-value" type="number" min={0} value={b.value} disabled={disabled} aria-label={t('Value')}
                       onChange={(e) => {
                         const n = Number(e.target.value);
                         if (Number.isFinite(n) && n >= 0) put(bars.map((x, j) => (j === i ? { ...x, value: n } : x)));
                       }} />
                <button type="button" className="sb-act" disabled={disabled || bars.length <= 1} title={t('Remove')} aria-label={t('Remove')}
                        onClick={() => put(bars.filter((_, j) => j !== i))}><Icon name="close" size={11} /></button>
              </li>
            ))}
          </ul>
          {bars.length < 6 && (
            <button type="button" className="ghost vid-add-bar" disabled={disabled}
                    onClick={() => put([...bars, { label: '', value: 0 }])}><Icon name="plus" size={11} />{t('Add a bar')}</button>
          )}
        </div>
        {text(t('Unit'), s.unit, 'unit')}
      </>
    );
  }
  if (s.kind === 'quote') return <>{text(t('Quotation'), s.quote, 'quote', true, true)}{text(t('Who said it'), s.author, 'author', true)}</>;
  if (s.kind === 'image') return text(t('Caption'), s.caption, 'caption', true);
  if (s.kind === 'split') return <>{text(t('Heading'), s.heading, 'heading', true)}{text(t('Sentence'), s.text, 'text', true, true)}</>;
  if (s.kind === 'steps') {
    return (
      <>
        {text(t('Heading'), s.heading, 'heading', true)}
        <LinesField label={t('Steps, one per line (up to five)')} value={s.steps} max={5} disabled={disabled}
                    onChange={(steps) => onChange({ steps } as Partial<Scene>)} />
      </>
    );
  }
  return (
    <>
      {text(t('Headline'), s.headline, 'headline', true)}
      {text(t('What to do next'), s.cta, 'cta')}
      {text(t('Web address'), s.url, 'url')}
    </>
  );
}

/** One scene of the storyboard. */
function SceneCard({ t, video, scene, index, count, open, redoing, locked, onToggle, onChange, onMove, onRemove, onRedo, onSeek, onError }: {
  t: T;
  video: Video;
  scene: Scene;
  index: number;
  count: number;
  open: boolean;
  /** This scene is being written again by the model. */
  redoing: boolean;
  /** Something else is running on the video: no second request. */
  locked: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<Scene>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  onRedo: () => void;
  onSeek: () => void;
  onError: (m: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const last = index === count - 1;
  const gist = gistOf(scene);
  return (
    <li className={`vid-scene ${open ? 'is-open' : ''} ${redoing ? 'is-live' : ''}`}>
      <div className="vid-scene-head">
        <button type="button" className="vid-scene-thumb" onClick={onSeek} title={t('Show this scene in the preview')}
                aria-label={t('Show this scene in the preview')}>
          <SceneThumb scene={scene} video={video} />
          <span className="vid-scene-n">{index + 1}</span>
        </button>
        <button type="button" className="vid-scene-what" onClick={onToggle} aria-expanded={open}>
          <b>{kindName(scene.kind, t)}<span>{fill(t('{n} s'), { n: scene.seconds })}</span></b>
          <span dir="auto">{redoing ? t('Writing this scene again…') : gist || '—'}</span>
        </button>
        <span className="vid-scene-acts">
          <button type="button" className="sb-act" disabled={index === 0} onClick={() => onMove(-1)} title={t('Move up')} aria-label={t('Move up')}>
            <Icon name="chevron" size={12} turn={-90} />
          </button>
          <button type="button" className="sb-act" disabled={last} onClick={() => onMove(1)} title={t('Move down')} aria-label={t('Move down')}>
            <Icon name="chevron" size={12} turn={90} />
          </button>
          <button type="button" className="sb-act" disabled={count <= 1 || redoing} onClick={onRemove} title={t('Remove this scene')} aria-label={t('Remove this scene')}>
            <Icon name="close" size={12} />
          </button>
        </span>
      </div>
      {open && (
        <div className="vid-scene-body">
          <div className="vid-form">
            <SceneFields t={t} scene={scene} onChange={onChange} disabled={redoing} />
            <label className="vid-f">
              <span>{t('Seconds on screen')}</span>
              <input type="number" min={2} max={20} step={0.5} value={scene.seconds} disabled={redoing}
                     onChange={(e) => {
                       const n = Number(e.target.value);
                       if (Number.isFinite(n) && n > 0) onChange({ seconds: Math.min(20, Math.max(2, n)) });
                     }} />
            </label>
            <label className="vid-f">
              <span>{t('Into the next scene')}</span>
              <select value={last ? 'none' : scene.transition} disabled={last || redoing}
                      onChange={(e) => onChange({ transition: e.target.value as Transition })}>
                {TRANSITIONS.map((x) => <option key={x} value={x}>{transitionName(x, t)}</option>)}
              </select>
            </label>
          </div>
          {PICTURED.has(scene.kind) && (
            <div className="vid-pic">
              {scene.picture
                ? <img src={scene.picture.src} alt="" />
                : <span className="vid-pic-none"><Icon name="image" size={16} /></span>}
              <span className="vid-pic-what">
                <b>{scene.picture ? t('Picture') : t('No picture yet')}</b>
                <span dir="auto">{scene.picture ? scene.picture.credit : scene.imageQuery ? fill(t('Suggested: “{q}”'), { q: scene.imageQuery }) : t('Search for one, or leave it plain.')}</span>
              </span>
              <button type="button" className="ghost" disabled={redoing} onClick={() => setPicking(!picking)} aria-expanded={picking}>
                <Icon name="image" size={12} />{scene.picture ? t('Change the picture') : t('Choose a picture')}
              </button>
            </div>
          )}
          {picking && (
            <PictureChooser t={t} scene={scene} video={video} onError={onError}
                            onPick={(picture) => onChange({ picture, ...(picture ? { imageQuery: picture.query } : {}) })}
                            onClose={() => setPicking(false)} />
          )}
          <div className="vid-scene-foot">
            <button type="button" className="ghost" disabled={locked || redoing} onClick={onRedo}
                    title={t('Ask the model to write this scene again, with an instruction of yours.')}>
              <Icon name="sparkle" size={12} />{t('Redo this scene…')}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * The storyboard: the cards, and a way to add one. Changes are handed up as
 * whole scene lists, and the panel keeps the video.
 */
export function Storyboard({ t, video, redoingId, locked, onScenes, onRedo, onSeek, onAdd, onError }: {
  t: T;
  video: Video;
  redoingId?: string;
  locked: boolean;
  onScenes: (scenes: Scene[]) => void;
  onRedo: (id: string) => void;
  onSeek: (index: number) => void;
  onAdd: (kind: SceneKind) => void;
  onError: (m: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [kind, setKind] = useState<SceneKind>('kinetic');
  const scenes = video.scenes;
  const patch = (id: string, p: Partial<Scene>) =>
    onScenes(scenes.map((s) => (s.id === id ? ({ ...s, ...p } as Scene) : s)));
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= scenes.length) return;
    const next = [...scenes];
    [next[i], next[j]] = [next[j], next[i]];
    onScenes(next);
  };
  return (
    <div className="vid-board">
      <ol className="vid-scenes">
        {scenes.map((s, i) => (
          <SceneCard key={s.id} t={t} video={video} scene={s} index={i} count={scenes.length}
                     open={openId === s.id} redoing={redoingId === s.id} locked={locked}
                     onToggle={() => setOpenId(openId === s.id ? null : s.id)}
                     onChange={(p) => patch(s.id, p)}
                     onMove={(by) => move(i, by)}
                     onRemove={() => onScenes(scenes.filter((x) => x.id !== s.id))}
                     onRedo={() => onRedo(s.id)}
                     onSeek={() => onSeek(i)}
                     onError={onError} />
        ))}
      </ol>
      <div className="vid-add">
        <select value={kind} onChange={(e) => setKind(e.target.value as SceneKind)} aria-label={t('Kind of scene')}>
          {SCENE_KINDS.map((k) => <option key={k} value={k}>{kindName(k, t)}</option>)}
        </select>
        <button type="button" className="ghost" onClick={() => onAdd(kind)}>
          <Icon name="plus" size={12} />{t('Add a scene')}
        </button>
      </div>
      <p className="vid-note">{kindAbout(kind, t)}</p>
    </div>
  );
}
