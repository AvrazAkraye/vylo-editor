/**
 * How one scene hands over to the next (videotypes.ts `Transition`), drawn
 * for Remotion's TransitionSeries: Remotion's own fade, slide and wipe, and
 * the app's zoom, iris, flash, panel, split and glitch.
 *
 * The web renderer that exports the MP4 draws only part of CSS, so these are
 * made of what it draws: transforms, opacity, solid colours, and clip paths
 * of the shapes it reads — `circle()`, `polygon()` and `inset()` without
 * rounded corners. No filters, no blend modes, no blur.
 *
 * Things move the way the language reads: a new scene comes from the end
 * side — from the right in English, from the left in Arabic and Kurdish.
 */

import type React from 'react';
import { AbsoluteFill, random, useVideoConfig } from 'remotion';
import type { TransitionPresentation, TransitionPresentationComponentProps } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import type { Transition } from './videotypes';
import { TRANSITION_FRAMES } from './video';

/** What a cut draws with: the colours of the scene it brings in, and the way the language reads. */
export interface CutColours extends Record<string, unknown> {
  accent: string;
  accent2: string;
  /** The colour of a flash: white over a dark scene, the accent over a light one (white would not show there). */
  flash: string;
  rtl: boolean;
}

type Props = TransitionPresentationComponentProps<CutColours>;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const pc = (x: number) => `${x.toFixed(2)}%`;

/** A gentle push in: the new scene grows from slightly small, the old one grows past and fades. */
function Zoom({ children, presentationDirection, presentationProgress: p }: Props) {
  const style: React.CSSProperties = presentationDirection === 'entering'
    ? { opacity: Math.min(1, p * 1.6), transform: `scale(${0.86 + 0.14 * p})` }
    : { opacity: 1 - p, transform: `scale(${1 + 0.12 * p})` };
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
}

/**
 * An iris: the new scene opens in a circle from the middle of the frame,
 * with a thin ring in its accent at the edge; the old one pushes in a little
 * (grown, never shrunk, so no edge of the frame shows behind it).
 */
function Iris({ children, presentationDirection, presentationProgress: p, passedProps }: Props) {
  const { width, height } = useVideoConfig();
  if (presentationDirection === 'exiting') {
    return <AbsoluteFill style={{ transform: `scale(${(1 + 0.05 * p).toFixed(4)})` }}>{children}</AbsoluteFill>;
  }
  const r = (Math.hypot(width, height) / 2) * p;
  const ring = Math.max(2, Math.min(width, height) * 0.007);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ clipPath: p >= 1 ? undefined : `circle(${r.toFixed(1)}px at 50% 50%)` }}>{children}</AbsoluteFill>
      {p > 0 && p < 1 ? (
        <div style={{ position: 'absolute', left: width / 2 - r, top: height / 2 - r, width: 2 * r, height: 2 * r, borderRadius: '50%', border: `${ring.toFixed(1)}px solid ${passedProps.accent}`, boxSizing: 'border-box', opacity: 1 - p * 0.7 }} />
      ) : null}
    </AbsoluteFill>
  );
}

/**
 * A flash: light floods over the old scene in the first half and falls away
 * from the new one in the second, which settles from a little large.
 */
function Flash({ children, presentationDirection, presentationProgress: p, passedProps }: Props) {
  const exiting = presentationDirection === 'exiting';
  const glow = exiting ? clamp01(p / 0.5) : clamp01(1 - (p - 0.5) / 0.5);
  const shown = exiting || p >= 0.5;
  const scale = exiting ? 1 + 0.04 * p : 1.05 - 0.05 * clamp01((p - 0.5) / 0.5);
  return (
    <AbsoluteFill style={{ opacity: shown ? 1 : 0, transform: `scale(${scale.toFixed(4)})` }}>
      {children}
      <AbsoluteFill style={{ background: passedProps.flash, opacity: glow }} />
    </AbsoluteFill>
  );
}

/** How far a panel's slanted edge leans, in % of the frame's width. */
const SLANT = 8;

/**
 * A panel: two slanted bands in the new scene's accents sweep across from the
 * end side — a narrow one in the second accent leading, the wide one in the
 * accent behind it — covering the old scene; the new one is there behind
 * them as they leave.
 *
 * Each band is measured as a distance from the side it comes from, its edge
 * travelling from just before that side to just past the far one, so neither
 * shows before it starts nor lingers after.
 */
function Panel({ children, presentationDirection, presentationProgress: p, passedProps }: Props) {
  if (presentationDirection === 'exiting') return <AbsoluteFill>{children}</AbsoluteFill>;
  const { accent, accent2, rtl } = passedProps;
  // Where an edge stands at t (0 → 1), from the side the bands come from: its top and its foot, leaning.
  const edge = (t: number) => -SLANT + t * (100 + 2 * SLANT);
  const x = (d: number) => (rtl ? d : 100 - d);
  const top = (t: number) => x(edge(t) + SLANT / 2);
  const foot = (t: number) => x(edge(t) - SLANT / 2);
  const band = (front: number, back: number) =>
    `polygon(${pc(top(back))} 0%, ${pc(top(front))} 0%, ${pc(foot(front))} 100%, ${pc(foot(back))} 100%)`;
  const lead = { front: clamp01(p / 0.42), back: clamp01((p - 0.42) / 0.5) };
  const main = { front: clamp01((p - 0.05) / 0.45), back: clamp01((p - 0.5) / 0.5) };
  // The new scene: everything the wide band has already passed.
  const behind = x(-20);
  const reveal = `polygon(${pc(behind)} 0%, ${pc(top(main.back))} 0%, ${pc(foot(main.back))} 100%, ${pc(behind)} 100%)`;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ clipPath: p >= 1 ? undefined : reveal }}>{children}</AbsoluteFill>
      {p < 1 ? <AbsoluteFill style={{ background: accent2, clipPath: band(lead.front, lead.back) }} /> : null}
      {p < 1 ? <AbsoluteFill style={{ background: accent, clipPath: band(main.front, main.back) }} /> : null}
    </AbsoluteFill>
  );
}

/**
 * Doors: the new scene opens from a line down the middle (across the middle
 * in a tall frame), a thin accent line on each opening edge; the old one
 * pushes in a little.
 */
function Split({ children, presentationDirection, presentationProgress: p, passedProps }: Props) {
  const { width, height } = useVideoConfig();
  if (presentationDirection === 'exiting') {
    return <AbsoluteFill style={{ transform: `scale(${(1 + 0.04 * p).toFixed(4)})` }}>{children}</AbsoluteFill>;
  }
  const across = height > width;
  const shut = 50 * (1 - p);
  const clip = across ? `inset(${pc(shut)} 0% ${pc(shut)} 0%)` : `inset(0% ${pc(shut)} 0% ${pc(shut)})`;
  const line = Math.max(2, Math.min(width, height) * 0.006);
  const at = (k: 1 | -1): React.CSSProperties => (across
    ? { left: 0, width: '100%', top: height / 2 + k * (height / 2) * p - line / 2, height: line }
    : { top: 0, height: '100%', left: width / 2 + k * (width / 2) * p - line / 2, width: line });
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ clipPath: p >= 1 ? undefined : clip, transform: `scale(${(1.08 - 0.08 * p).toFixed(4)})` }}>{children}</AbsoluteFill>
      {p > 0 && p < 1 ? (
        <>
          <div style={{ position: 'absolute', background: passedProps.accent, opacity: 1 - p * 0.5, ...at(-1) }} />
          <div style={{ position: 'absolute', background: passedProps.accent, opacity: 1 - p * 0.5, ...at(1) }} />
        </>
      ) : null}
    </AbsoluteFill>
  );
}

/**
 * A glitch: the old scene jitters harder and harder, torn bands of the new
 * one flicker through it, then the new one takes over with the jitter dying
 * away; bars in the accents flash across the frame. The same frame always
 * glitches the same way (Remotion's seeded `random`).
 */
function Glitch({ children, presentationDirection, presentationProgress: p, passedProps }: Props) {
  const { width, height } = useVideoConfig();
  const step = Math.round(p * TRANSITION_FRAMES);
  const r = (k: string) => random(`cut-glitch|${k}|${step}`);
  const j = (k: string) => (r(k) - 0.5) * 2;
  if (presentationDirection === 'exiting') {
    const k = clamp01(p / 0.5);
    return <AbsoluteFill style={{ transform: `translateX(${(j('x') * width * 0.03 * k).toFixed(1)}px)` }}>{children}</AbsoluteFill>;
  }
  // Before the middle, only a torn band of the new scene, now and then; after it, all of it, settling.
  const early = p < 0.5;
  const tear = r('tear') > 0.45;
  const top = r('top') * 70;
  const tall = 8 + r('tall') * 22;
  const clip = early ? (tear && p > 0.15 ? `inset(${pc(top)} 0% ${pc(Math.max(0, 100 - top - tall))} 0%)` : 'inset(0% 0% 100% 0%)') : undefined;
  const k = early ? 1 : clamp01(1 - (p - 0.5) / 0.3);
  const bars = p > 0.15 && p < 0.85 ? [0, 1, 2, 3].filter((i) => r(`on${i}`) > 0.35) : [];
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ clipPath: clip, transform: k > 0 ? `translateX(${(j('nx') * width * 0.04 * k).toFixed(1)}px)` : undefined }}>{children}</AbsoluteFill>
      {bars.map((i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: j(`bx${i}`) * width * 0.2,
            top: r(`by${i}`) * height,
            width: width * (0.5 + r(`bw${i}`) * 0.7),
            height: Math.max(2, height * (0.006 + r(`bh${i}`) * 0.03)),
            background: i % 2 ? passedProps.accent2 : passedProps.accent,
            opacity: 0.85,
          }}
        />
      ))}
    </AbsoluteFill>
  );
}

/** One of the app's own presentations, typed as the series takes them (its props are the colours it was given). */
const own = (component: React.FC<Props>, colours: CutColours) => ({ component, props: colours }) as unknown as TransitionPresentation<Record<string, unknown>>;

/** The presentation for a transition into the next scene, in that scene's colours. */
export function presentationOf(t: Transition, colours: CutColours): TransitionPresentation<Record<string, unknown>> {
  const rtl = colours.rtl;
  switch (t) {
    case 'slide':
      return slide({ direction: rtl ? 'from-left' : 'from-right' }) as TransitionPresentation<Record<string, unknown>>;
    case 'wipe':
      return wipe({ direction: rtl ? 'from-left' : 'from-right' }) as TransitionPresentation<Record<string, unknown>>;
    case 'zoom': return own(Zoom, colours);
    case 'iris': return own(Iris, colours);
    case 'flash': return own(Flash, colours);
    case 'panel': return own(Panel, colours);
    case 'split': return own(Split, colours);
    case 'glitch': return own(Glitch, colours);
    default:
      return fade({ shouldFadeOutExitingScene: true }) as TransitionPresentation<Record<string, unknown>>;
  }
}
