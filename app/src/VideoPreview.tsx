import { useEffect, useMemo, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import type { Video } from './videotypes';
import { compositionOf, loadVideoFonts } from './VideoScenes';
import { playhead } from './VideoTimeline';

/**
 * The preview: Remotion's player over the app's own composition.
 *
 * Loaded on its own (VideoPanel imports it with `React.lazy`), so the player
 * arrives when a storyboard is first shown and not before. The fonts are
 * awaited first: a frame drawn in the fallback face and then re-laid in the
 * right one is a preview that jumps, and in Arabic a line that fits in one
 * face may not in the other.
 */
export default function VideoPreview({ video, t, at, maxBlock }: {
  video: Video;
  t: (s: string) => string;
  /** A frame to go to; `n` changes when the same frame is asked for twice. */
  at?: { frame: number; n: number };
  /** The tallest the player may be, as a CSS length — a vertical video must not push everything off the panel. */
  maxBlock: string;
}) {
  const [fonts, setFonts] = useState(false);
  const player = useRef<PlayerRef>(null);
  useEffect(() => {
    let live = true;
    setFonts(false);
    // A font that fails to load is drawn in the fallback: better than no preview.
    loadVideoFonts(video).catch(() => undefined).finally(() => { if (live) setFonts(true); });
    return () => { live = false; };
  }, [video.lang, video.style]); // eslint-disable-line react-hooks/exhaustive-deps

  const comp = useMemo(() => compositionOf(video), [video]);
  useEffect(() => {
    if (!at || !fonts) return;
    player.current?.pause();
    player.current?.seekTo(Math.min(Math.max(0, at.frame), comp.durationInFrames - 1));
  }, [at?.n, fonts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where the player is, for the timeline under it (VideoTimeline.tsx's
  // `playhead`), and the controls the timeline and the video's keys move it with.
  const frames = useRef(comp.durationInFrames);
  frames.current = comp.durationInFrames;
  useEffect(() => {
    const p = player.current;
    if (!fonts || !p) return;
    const id = video.id;
    const say = () => playhead.report(id, p.getCurrentFrame(), p.isPlaying());
    const onFrame = (e: { detail: { frame: number } }) => playhead.report(id, e.detail.frame, p.isPlaying());
    p.addEventListener('frameupdate', onFrame);
    p.addEventListener('seeked', onFrame);
    p.addEventListener('play', say);
    p.addEventListener('pause', say);
    p.addEventListener('ended', say);
    say();
    const off = playhead.attach(id, {
      seek: (f) => p.seekTo(Math.min(Math.max(0, Math.round(f)), frames.current - 1)),
      play: () => p.play(),
      pause: () => p.pause(),
      toggle: () => p.toggle(),
    });
    return () => {
      p.removeEventListener('frameupdate', onFrame);
      p.removeEventListener('seeked', onFrame);
      p.removeEventListener('play', say);
      p.removeEventListener('pause', say);
      p.removeEventListener('ended', say);
      off();
      playhead.report(id, playhead.clock(id).frame, false);
    };
  }, [fonts, video.id]);

  const ratio = comp.width / comp.height;
  const box = { aspectRatio: `${comp.width} / ${comp.height}`, inlineSize: `min(100%, calc(${maxBlock} * ${ratio.toFixed(4)}))` };
  if (!fonts) {
    return (
      <div className="vid-player is-wait" style={box} role="status">
        <span className="vid-spinner" aria-hidden="true" />
        <span>{t('Loading the fonts…')}</span>
      </div>
    );
  }
  return (
    // Left to right whatever the interface: Remotion places its frame and its
    // controls from the left, and in a right-to-left layout the frame slides
    // half out of view and the clock reads backwards. The scenes set their
    // own direction inside.
    <div className="vid-player" style={box} dir="ltr">
      <Player ref={player} component={comp.component} inputProps={comp.inputProps}
              durationInFrames={comp.durationInFrames} fps={comp.fps}
              compositionWidth={comp.width} compositionHeight={comp.height}
              controls loop clickToPlay spaceKeyToPlayOrPause={false} doubleClickToFullscreen={false}
              acknowledgeRemotionLicense
              style={{ inlineSize: '100%', blockSize: '100%' }} />
    </div>
  );
}
