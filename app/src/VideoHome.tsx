import { useState } from 'react';
import { Icon } from './Icon';
import { GalleryChips, GalleryHero, hue, type Slide } from './Gallery';
import { SCENE_KINDS, type SceneKind, type Video } from './videotypes';
import { STYLE_SWATCH } from './VideoScenes';
import { SCENE_GROUP, SCENE_HUE, SceneKindArt, VIDEO_SCENE_HUE, VideoSceneArt, type SceneGroup } from './VideoArt';

/**
 * Video's home in the full window, before a video is open — the same gallery
 * as Research's (Gallery.tsx): a banner that turns through what the module
 * does, chips that filter the kinds of scene, a card for each scene with a
 * picture of it on a screen, and the videos so far as thumbnails in their own
 * shape and style.
 */

type T = (s: string) => string;

interface Names {
  kind: (k: SceneKind) => string;
  about: (k: SceneKind) => string;
  format: (v: Video) => string;
  /** Where a video is, in words: exporting, planning, its scenes and seconds. */
  status: (v: Video) => string;
  when: (at: number) => string;
  live: (v: Video) => boolean;
  /** Its length, in seconds, as the timeline adds it up. */
  seconds: (v: Video) => number;
}

function groupName(g: SceneGroup | 'all', t: T): string {
  if (g === 'words') return t('Words on screen');
  if (g === 'data') return t('Numbers and data');
  if (g === 'pictures') return t('Pictures');
  return t('All');
}

const GROUP_HUE: Readonly<Record<SceneGroup, number>> = { words: 262, data: 38, pictures: 158 };

/** 0:39, 1:05 — a video's length as a player shows it. */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;

export function VideoHome({ t, videos, names, onOpen, onFocus }: {
  t: T;
  videos: Video[];
  names: Names;
  onOpen: (id: string) => void;
  /** Put the cursor in the request box. */
  onFocus: () => void;
}) {
  const [group, setGroup] = useState<SceneGroup | 'all'>('all');
  const latest = videos.find((v) => v.scenes.length) ?? videos[0];
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
  const slides: Slide[] = [
    { key: 'film', hue: VIDEO_SCENE_HUE.film, art: <VideoSceneArt scene="film" rtl={rtl} />, mirror: false, icon: 'film', tag: t('Video'),
      title: t('A video from one sentence'),
      text: t('Say what it is for, how long, and in which language. The model plans a storyboard from the scenes below; you edit every word, preview it, and export an MP4.'),
      go: t('Describe a video'), to: onFocus },
    { key: 'art', hue: VIDEO_SCENE_HUE.art, art: <VideoSceneArt scene="art" rtl={rtl} />, mirror: false, icon: 'sparkle', tag: t('Designed by AI'),
      title: t('Every video designed for its subject'),
      text: t('The model is the art director: it chooses the colours and the typeface, how each scene’s words arrive and what moves behind them. Change any choice, or restyle every scene at once.'),
      go: t('Describe a video'), to: onFocus },
    { key: 'web', hue: VIDEO_SCENE_HUE.web, art: <VideoSceneArt scene="web" rtl={rtl} />, mirror: false, icon: 'search', tag: t('Found on the web'),
      title: t('Real facts, photographs and logos'),
      text: t('Real facts, photographs and the logo from Wikipedia, Wikidata and Wikimedia Commons, given to the model before it plans. You see and check every one under “Found on the web”.'),
      go: t('Describe a video'), to: onFocus },
    { key: 'talk', hue: VIDEO_SCENE_HUE.talk, art: <VideoSceneArt scene="talk" rtl={rtl} />, mirror: false, icon: 'chat', tag: t('Chat'),
      title: t('Talk to your video'),
      text: t('Open a video and tell it what to change — a scene, the words, the colours, the music — typed or spoken.'),
      go: latest ? t('Open the latest video') : t('Describe a video'), to: () => (latest ? onOpen(latest.id) : onFocus()) },
  ];
  const kinds = SCENE_KINDS.filter((k) => group === 'all' || SCENE_GROUP[k] === group);

  return (
    <div className="gal-home">
      <GalleryHero slides={slides} label={t('Video')} prev={t('Previous')} next={t('Next')} />

      <div className="gal-head">
        <h3>{t('Scenes')} <small>{SCENE_KINDS.length}</small></h3>
        <p>{t('The model builds every video from these scenes. Ask for one by name, or leave it to the storyboard.')}</p>
      </div>
      <GalleryChips label={t('Kinds')} value={group} onChange={setGroup}
                    chips={(['all', 'words', 'data', 'pictures'] as const).map((g) => ({
                      id: g, label: groupName(g, t), hue: g === 'all' ? undefined : GROUP_HUE[g],
                      count: g === 'all' ? SCENE_KINDS.length : SCENE_KINDS.filter((k) => SCENE_GROUP[k] === g).length,
                    }))} />
      <div className="gal-grid">
        {kinds.map((k) => (
          <div key={k} className="gal-card is-static" style={hue(SCENE_HUE[k])}>
            <span className="gal-card-art">
              <SceneKindArt kind={k} />
              <span className="gal-badge"><i />{groupName(SCENE_GROUP[k], t)}</span>
              <b className="gal-card-name">{names.kind(k)}</b>
            </span>
            <span className="gal-card-body">
              <span className="gal-card-about">{names.about(k)}</span>
            </span>
          </div>
        ))}
      </div>

      {videos.length > 0 && (
        <>
          <div className="gal-head">
            <h3>{t('Your videos')} <small>{videos.length}</small></h3>
          </div>
          <div className="gal-covers">
            {videos.map((v) => {
              // A designed look is drawn in its own colours; a style in its swatch.
              const sw = v.ai && v.design ? { bg: v.design.bg, fg: v.design.fg, accent: v.design.accent } : STYLE_SWATCH[v.style] ?? STYLE_SWATCH.modern;
              return (
                <button key={v.id} type="button" className="gal-cover" style={hue(SCENE_HUE[v.scenes[0]?.kind ?? 'title'])} onClick={() => onOpen(v.id)}>
                  <span className="gal-cover-art vid-cover-art">
                    <span className={`vid-cover-frame is-${v.format}`} style={{ background: sw.bg, color: sw.fg }} dir="auto">
                      <i style={{ background: sw.accent }} />
                      <b>{v.title || v.request}</b>
                    </span>
                    <span className="vid-cover-play" aria-hidden="true"><Icon name="play" size={14} /></span>
                    <span className="gal-badge"><i />{names.format(v)}</span>
                    {names.seconds(v) > 0 && <span className="vid-cover-time">{clock(names.seconds(v))}</span>}
                  </span>
                  <span className="gal-cover-foot">
                    <span className={`vid-dot ${names.live(v) ? 'is-live' : v.error ? 'is-bad' : v.stage === 'ready' ? 'is-done' : ''}`} aria-hidden="true" />
                    <span>{names.status(v)}</span>
                    <small>{names.when(v.created)}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
