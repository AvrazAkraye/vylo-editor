/**
 * The pieces every scene is made of: the scene's context, entrance curves,
 * lines of fitted text that reveal themselves, the moving backgrounds of the
 * six styles, pictures with a slow Ken Burns move, and the logo.
 *
 * ## What the web renderer can draw
 *
 * The exported file is drawn by `@remotion/web-renderer`, which walks the DOM
 * and paints each element onto a canvas itself. It understands a subset of
 * CSS, so everything here keeps to it: no z-index (later in the DOM is in
 * front), no CSS filter, blend mode, backdrop-filter or perspective, no inset
 * or spread shadows, no object-position, and only single *linear* gradients
 * as backgrounds. Soft round light — the blobs and vignettes — is an inline
 * SVG with a radial gradient: the renderer rasterises an `<svg>` as an image
 * (and caches it while its markup does not change), so each blob is a static
 * SVG moved only by its CSS transform. Film grain is an SVG turbulence,
 * likewise static and shifted by a transform.
 *
 * Text is drawn by the renderer one word at a time at the position the DOM
 * gave that word (`fillText` per word, right-aligned at the word's right edge
 * when `direction` is rtl), so Arabic shaping happens inside each word and the
 * line order comes from the browser's own bidi layout. Words are never split
 * into letters here, and Arabic is never letter-spaced — both would break the
 * joins between letters.
 *
 * ## The look
 *
 * A scene reads its look (videolook.ts `lookFor`) from `SceneInfo.look`.
 * Its pace is a clock: `useSceneFrame()` is the frame times `look.motion`,
 * and `SceneInfo.frames` is the scene's length on that clock, so everything
 * timed in frames (an entrance, a stagger, a count) runs faster or slower
 * while everything timed as a share of the scene (the close's fade, a Ken
 * Burns move, "all points in by half-way") keeps its place in the scene. The
 * film-wide background runs on the film's own frame, times the same pace.
 *
 * ## The art
 *
 * A scene's art direction (`SceneInfo.art`, read by videotheme.ts
 * `sceneArtOf`) is drawn here, over the style and under the person's look:
 *
 * - its effect — how `Lines` brings words in: the four reveals the styles
 *   always had, and typing (whole words one after another), a highlight
 *   (an accent marker grows behind the emphasised words), scaling down into
 *   place, sliding in from the reading-start side, and a short glitch (two
 *   offset copies in the accents, jittering for a third of a second);
 * - its emphasis — whole words of a line set in the accent: the line becomes
 *   inline spans split at its spaces, never inside a word, laid out exactly as
 *   the unsplit line (same face, weight and size), so fitting and line breaks
 *   do not move; the exporter draws each text node in its own span's colour;
 * - its ground — `Backdrop` draws the accent, the gradient, or the scene's
 *   picture under a scrim instead of the style's background (a dark or light
 *   ground is the style's motif in those colours);
 * - its shape — `ArtShape`, one animated figure in the accents, in the
 *   corner away from the words, drawn between the ground and the words;
 * - its camera — `useCamera`, a slow push, pull, drift or tilt of the scene's
 *   content layer; VideoScenes.tsx shrinks the safe box by as much as the
 *   move can carry words, so they never leave it.
 *
 * Positioned spans (a marker, a caret) are drawn in DOM order by the exporter
 * but above in-flow text by the browser, so the words over them are
 * positioned too: both then paint in DOM order, and the Player and the file
 * agree.
 */

import { createContext, useContext, useEffect, useId, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Easing, Img, interpolate, random, spring, useCurrentFrame, useDelayRender, useVideoConfig } from 'remotion';
import type { Camera, SceneArt, TextEffect, Video } from './videotypes';
import { alpha, drawStyleOf, fitText, localDigits, luminance, mix, onPhotoTheme, textWidth } from './videotheme';
import type { Box, Emphasis, Fit, Numerals, Theme, TypeFace } from './videotheme';
import { markPhrases } from './videoemphasis';
import { lookFor } from './videolook';
import type { Align, EffectiveLook, PictureFit } from './videolook';

// ---------------------------------------------------------------------------
// Scene context

export interface SceneInfo {
  video: Video;
  theme: Theme;
  box: Box;
  /** This scene's length on its own clock — its frames times the look's pace (`useSceneFrame`). */
  frames: number;
  index: number;
  count: number;
  /** The frame this scene starts at in the whole film (for backgrounds that flow across cuts). */
  start: number;
  /** The whole film's length in frames. */
  total: number;
  /** Whether the style's fonts are loaded (measurements are only cached then). */
  ready: boolean;
  /** The digits the video's numbers are drawn in (videotheme.ts `numeralsOf`). */
  digits: Numerals;
  /** The look this scene is drawn with: the scene's own over the video's (videolook.ts `lookFor`). */
  look: EffectiveLook;
  /** Where the brand heads this scene when its look asks for it and the scene has no place of its own: a band above `box`, which starts below it. */
  mark?: { top: number; height: number } | null;
  /** The scene's art direction, checked (videotheme.ts `sceneArtOf`); empty when it has none. */
  art: SceneArt;
  /**
   * The safe box before the art's camera took its allowance (`cameraBox`):
   * the ground's ornaments — the frame, the rules — are placed by it, so they
   * stay where every other scene has them. `box` when absent.
   */
  groundBox?: Box;
  /** Its emphasis as phrases of folded words (videotheme.ts `emphasisOf`), which `Lines` sets in the accent where each stands. */
  emphasis: Emphasis;
}

const SceneContext = createContext<SceneInfo | null>(null);

export const SceneProvider = SceneContext.Provider;

export function useScene(): SceneInfo {
  const s = useContext(SceneContext);
  if (!s) throw new Error('useScene outside a scene');
  return s;
}

// ---------------------------------------------------------------------------
// Motion

/**
 * The scene's frame on its own clock: Remotion's frame times the look's pace
 * (`look.motion`, 1 unless set) — so at 2 everything in the scene arrives in
 * half the frames, at 0.5 in twice as many. Every scene part times itself by
 * this, never by `useCurrentFrame()`; `SceneInfo.frames` is on the same clock.
 */
export function useSceneFrame(): number {
  const frame = useCurrentFrame();
  const { look } = useScene();
  return look.motion === 1 ? frame : frame * look.motion;
}

/** Flexbox's word for an alignment: the reading side, the middle, the other side (mirrored by the scene's direction). */
export const flexOf = (a: Align | undefined): 'flex-start' | 'center' | 'flex-end' => (a === 'center' ? 'center' : a === 'end' ? 'flex-end' : 'flex-start');

/** A line's `text-align` for an alignment. */
export const textAlignOf = (a: Align | undefined): 'start' | 'center' | 'end' => (a === 'center' ? 'center' : a === 'end' ? 'end' : 'start');

/**
 * 0 → 1 as an element arrives, `delay` frames into the scene, in the style's
 * own curve: springs for the lively styles (a little overshoot), eased curves
 * for elegant and minimal.
 */
export function useEnter(delay: number, slower = 1): number {
  const frame = useSceneFrame();
  const { fps } = useVideoConfig();
  const { theme } = useScene();
  return enterAt(frame - delay, fps, theme, slower);
}

export function enterAt(f: number, fps: number, theme: Theme, slower = 1): number {
  if (f <= 0) return 0;
  const m = theme.motion;
  if (m.spring) {
    return spring({ frame: f / slower, fps, config: m.spring });
  }
  return interpolate(f, [0, m.duration * slower], [0, 1], { easing: m.easing, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
}

/** A plain eased 0 → 1 between two frames, for things like counters and growing lines. */
export function progress(frame: number, from: number, to: number, easing?: (t: number) => number): number {
  if (to <= from) return frame >= from ? 1 : 0;
  return interpolate(frame, [from, to], [0, 1], { easing, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
}

/** Frames between staggered items, squeezed so everything has arrived by `by` of the scene. */
export function staggerFor(theme: Theme, frames: number, items: number, by = 0.45, start = 0): number {
  if (items <= 1) return theme.motion.stagger;
  const room = Math.max(0, frames * by - start);
  return Math.max(1, Math.min(theme.motion.stagger * 2.2, room / (items - 1)));
}

// ---------------------------------------------------------------------------
// Camera

/** How far the camera moves: push and pull scale by 6%, drift travels 1.5% of the frame each way, tilt turns 1.2°. */
const CAMERA_SCALE = 0.06;
const CAMERA_DRIFT = 0.015;
const CAMERA_TILT = 1.2;

/**
 * The safe box a scene lays its words out in under its camera: smaller by as
 * much as the move can carry a word outward — at the end of a push (or the
 * start of a pull) the content is 6% larger about the box's centre; a drift
 * slides it 1.5% of the frame either way; a tilt lifts the ends of a line by
 * the sine of the angle. Laid out in this box, the words stay inside the
 * style's safe area at every frame of the move.
 */
export function cameraBox(box: Box, camera: Camera | undefined): Box {
  const shrink = (dx: number, dy: number): Box => ({ ...box, x: box.x + dx, w: box.w - 2 * dx, top: box.top + dy, bottom: box.bottom + dy, h: box.h - 2 * dy });
  switch (camera) {
    case 'push':
    case 'pull': {
      const k = 1 / (1 + CAMERA_SCALE);
      return shrink((box.w * (1 - k)) / 2, (box.h * (1 - k)) / 2);
    }
    case 'drift':
      return shrink(box.width * CAMERA_DRIFT, 0);
    case 'tilt': {
      const s = Math.sin((CAMERA_TILT * Math.PI) / 180);
      return shrink((s * box.h) / 2, (s * box.w) / 2);
    }
    default:
      return box;
  }
}

/**
 * The scene's camera as a transform for its content layer, over the scene's
 * progress (eased in and out, as a camera on a slider): push 1 → 1.06, pull
 * 1.06 → 1, drift from 1.5% behind to 1.5% ahead in the direction the
 * language reads, tilt from −1.2° (mirrored for right to left) to level.
 * `null` when the art sets no camera — the kind keeps its own gentle drift —
 * and no transform at all for 'still'.
 */
export function useCamera(): CSSProperties | null {
  const { art, frames, box, theme } = useScene();
  const frame = useSceneFrame();
  const cam = art.camera;
  if (!cam) return null;
  if (cam === 'still') return {};
  const t = interpolate(frame, [0, Math.max(1, frames)], [0, 1], { easing: Easing.bezier(0.37, 0, 0.63, 1), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  switch (cam) {
    case 'push':
      return { transform: `scale(${(1 + CAMERA_SCALE * t).toFixed(5)})` };
    case 'pull':
      return { transform: `scale(${(1 + CAMERA_SCALE * (1 - t)).toFixed(5)})` };
    case 'drift':
      return { transform: `translateX(${((theme.rtl ? -1 : 1) * box.width * CAMERA_DRIFT * (2 * t - 1)).toFixed(2)}px)` };
    case 'tilt':
      return { transform: `rotate(${((theme.rtl ? 1 : -1) * CAMERA_TILT * (1 - t)).toFixed(4)}deg)` };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Text

export type RevealMode = 'mask' | 'rise' | 'pop' | 'fade';

/** The reveal a style uses for headlines. */
export function revealOf(theme: Theme): RevealMode {
  switch (theme.style) {
    case 'modern':
    case 'bold':
    case 'minimal':
      return 'mask';
    case 'neon':
      return 'pop';
    default:
      return 'rise';
  }
}

/** How a scene's headlines arrive: its art's effect when it chose one, else its style's reveal. */
export function effectOf(info: Pick<SceneInfo, 'theme' | 'art'>): TextEffect {
  return info.art.effect ?? revealOf(info.theme);
}

/**
 * The plain reveal a scene's list items, dates and labels take: the style's
 * as always, or the nearest of three to the scene's effect — a list typed or
 * glitched word by word would be noise, so its items fade or pop instead.
 */
export function itemRevealOf(info: Pick<SceneInfo, 'theme' | 'art'>): 'rise' | 'pop' | 'fade' {
  switch (effectOf(info)) {
    case 'pop':
    case 'scale':
    case 'glitch':
      return 'pop';
    case 'fade':
    case 'type':
      return 'fade';
    default:
      return 'rise';
  }
}

/** Neon's glow around words — only on a dark ground, where light can glow; around dark words on a light one it is a smudge. */
export function glowOf(theme: Theme, strength = 1): string | undefined {
  if (theme.style !== 'neon' || theme.inverted || !theme.dark) return undefined;
  const u = 1;
  return `0 0 ${14 * u * strength}px ${alpha(theme.accent, 0.75)}, 0 0 ${42 * u * strength}px ${alpha(theme.accent, 0.45)}`;
}

/** Transform and opacity for an element arriving with progress `p`. */
export function revealStyle(mode: RevealMode, p: number, travel: number, dir: 'up' | 'start' = 'up', rtl = false): CSSProperties {
  const o = Math.max(0, Math.min(1, p * 1.25));
  const d = (1 - p) * travel;
  const shift = dir === 'up' ? `translateY(${d}px)` : `translateX(${rtl ? d : -d}px)`;
  switch (mode) {
    case 'pop':
      return { opacity: o, transform: `${shift} scale(${0.82 + 0.18 * p})` };
    case 'fade':
      return { opacity: o };
    default:
      return { opacity: o, transform: shift };
  }
}

/** Frames a sheen takes to cross a line. */
const SHEEN_FRAMES = 30;

/** One band of a sheen: a clipped copy of the line in a lighter colour. */
export interface SheenBand { clipPath: string; color: string; opacity: number }

/**
 * A band of light crossing a line of text once, `f` frames after it starts,
 * in the direction the language reads: copies of the line in a lighter
 * colour, each clipped to a slanted band (`clip-path: polygon`) — a bright
 * core inside two fainter, wider ones, which reads as a soft highlight. Both
 * the Player and the web renderer draw a clipped copy exactly over its line;
 * a gradient clipped to the letters (`background-clip: text`) would be
 * simpler, but the exporter reads that from computed styles and WebKit's is
 * not to be relied on. Outside the sweep there are no bands at all. Minimal
 * has no decoration and neon already glows, so neither shines.
 */
export function sheenBands(theme: Theme, color: string, f: number): SheenBand[] {
  if (theme.style === 'minimal' || theme.style === 'neon' || f <= 0 || f >= SHEEN_FRAMES) return [];
  if (!/^#[0-9a-f]{6}$/i.test(color)) return [];
  const t = Easing.inOut(Easing.cubic)(f / SHEEN_FRAMES);
  // From before the start edge to past the end edge — right to left for Arabic and Kurdish.
  const at = theme.rtl ? 130 - 160 * t : -30 + 160 * t;
  // A pale line (white on a dark ground) catches the style's accent as the light passes; a coloured
  // line brightens; dark words on a light ground warm towards the second accent.
  const light = luminance(color) > 0.6
    ? mix(theme.accent, '#FFFFFF', 0.4)
    : theme.dark || theme.inverted ? mix(color, '#FFFFFF', 0.7) : mix(color, theme.accent2, 0.85);
  const slant = theme.rtl ? -4 : 4;
  const band = (half: number) => {
    const x = (v: number) => `${v.toFixed(2)}%`;
    return `polygon(${x(at - half + slant)} 0%, ${x(at + half + slant)} 0%, ${x(at + half - slant)} 100%, ${x(at - half - slant)} 100%)`;
  };
  const fade = Math.sin(t * Math.PI);
  return [
    { clipPath: band(11), color: light, opacity: 0.35 * fade },
    { clipPath: band(6), color: light, opacity: 0.6 * fade },
    { clipPath: band(2.5), color: light, opacity: 0.95 * fade },
  ];
}

/**
 * A line of text with its sheen: the line itself, then the bands laid
 * exactly over it (same style, same box, later in the DOM so in front).
 */
export function ShineText(p: { text: string; content?: ReactNode; style: CSSProperties; color: string; sheenAt?: number }) {
  const { theme } = useScene();
  const frame = useSceneFrame();
  const bands = p.sheenAt === undefined ? [] : sheenBands(theme, p.color, frame - p.sheenAt);
  if (!bands.length) return <div style={p.style}>{p.content ?? p.text}</div>;
  const { transform, opacity, ...plain } = p.style;
  return (
    <div style={{ position: 'relative', transform, opacity }}>
      <div style={plain}>{p.content ?? p.text}</div>
      {bands.map((b, i) => (
        <div key={i} style={{ ...plain, position: 'absolute', left: 0, top: 0, width: '100%', color: b.color, opacity: b.opacity, textShadow: undefined, clipPath: b.clipPath }}>{p.text}</div>
      ))}
    </div>
  );
}

interface LinesProps {
  fit: Fit;
  face: TypeFace;
  bold?: boolean;
  color: string;
  delay: number;
  stagger: number;
  /** How the lines arrive; the scene's effect (its art's, else the style's reveal) when absent. */
  mode?: TextEffect;
  align?: Align;
  shadow?: string;
  /** Colour for one line (by index), e.g. to set the last line in the accent. */
  lineColor?: (i: number) => string | undefined;
  style?: CSSProperties;
  slower?: number;
  /** A light that sweeps once across the lines, starting at this frame of the scene (styles that have one). */
  sheen?: number;
  /** Leave the scene's emphasis out of these lines; set in the accent unless false. */
  emphasis?: boolean;
  /**
   * The colours the lines are drawn in, where they differ from the scene's —
   * words over a darkened picture (`onPhoto`) — so the emphasis and the
   * marker read there too.
   */
  theme?: Theme;
  /** A line drawn as an outline in this colour instead of filled (a poster's alternate lines). */
  outline?: (i: number) => string | undefined;
  /** A size for each line, when the lines were fitted one by one (a poster); `fit.size` otherwise. */
  sizes?: number[];
}

const NO_MARKS: Emphasis = [];

/**
 * Which words of each line carry the scene's emphasis (null for a line with
 * none): each phrase where its words stand together, across the lines the
 * text was broken into. A highlight with no emphasis marks the whole first
 * line, so the effect always has something to mark.
 */
function markWords(lines: string[][], emphasis: Emphasis, highlight: boolean): (boolean[] | null)[] {
  const flat = markPhrases(lines.flat(), emphasis);
  let at = 0;
  const out = lines.map((ws) => {
    const m = flat.slice(at, at + ws.length);
    at += ws.length;
    return m;
  });
  if (highlight && lines.length && !out.some((m) => m.some(Boolean))) out[0] = lines[0].map(() => true);
  return out.map((m) => (m.some(Boolean) ? m : null));
}

/** Whether a scene's emphasis lights any of these lines' words. */
export function emphasised(lines: readonly string[], emphasis: Emphasis): boolean {
  return emphasis.length > 0 && markPhrases(lines.join(' ').split(' '), emphasis).some(Boolean);
}

/**
 * Fitted lines, one text node each (or one span per word where the scene's
 * art needs them), revealed one after another in the scene's effect. In
 * 'mask' mode each line rises out of its own clipping box (padded so Arabic
 * dots and tall letters are not cut); in 'type' the words of every line
 * appear one after another, all in by about 40% of the scene; a highlight's
 * marker grows once every line has arrived.
 */
export function Lines(p: LinesProps) {
  const info = useScene();
  const { box, frames } = info;
  const theme = p.theme ?? info.theme;
  const mode = p.mode ?? effectOf(info);
  const lh = p.face.leading;
  const words = p.fit.lines.map((l) => l.split(' '));
  const marks = markWords(words, p.emphasis === false ? NO_MARKS : info.emphasis, mode === 'highlight');
  const count = words.reduce((s, w) => s + w.length, 0);
  const gap = Math.max(2, Math.min(6, (frames * 0.4 - p.delay) / Math.max(1, count)));
  const starts: number[] = [];
  let typed = 0;
  for (let i = 0; i < words.length; i++) {
    starts.push(mode === 'type' ? p.delay + typed * gap : p.delay + i * p.stagger);
    typed += words[i].length;
  }
  // 'scale': how large a line may start and still stay inside the width it was fitted into.
  const growOf = (line: string, size: number) => {
    if (mode !== 'scale' || !p.fit.room) return undefined;
    const w = textWidth(line, p.face, size, !!p.bold, info.ready);
    return w > 0 ? p.fit.room / w : undefined;
  };
  const allIn = mode === 'type' ? p.delay + count * gap : p.delay + Math.max(0, words.length - 1) * p.stagger + theme.motion.duration * 0.8;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: flexOf(p.align), ...p.style }}>
      {p.fit.lines.map((line, i) => (
        <Line
          key={i}
          theme={theme}
          text={line}
          words={words[i]}
          marks={marks[i]}
          size={p.sizes?.[i] ?? p.fit.size}
          grow={growOf(line, p.sizes?.[i] ?? p.fit.size)}
          face={p.face}
          bold={p.bold}
          color={p.lineColor?.(i) ?? p.color}
          lh={lh}
          delay={starts[i]}
          mode={mode}
          align={p.align}
          shadow={p.shadow}
          travel={theme.motion.travel * box.u}
          slower={p.slower}
          sheen={p.sheen === undefined || p.outline?.(i) ? undefined : p.sheen + i * 3}
          gap={gap}
          caretUntil={i < words.length - 1 ? starts[i + 1] : allIn + 24}
          markAt={allIn + 2 + i * 4}
          outline={p.outline?.(i)}
        />
      ))}
    </div>
  );
}

interface LineProps {
  theme: Theme;
  text: string;
  words: string[];
  marks: boolean[] | null;
  size: number;
  /** 'scale': the room the line has to grow into, as a multiple of its width (unlimited when absent). */
  grow?: number;
  face: TypeFace;
  bold?: boolean;
  color: string;
  lh: number;
  delay: number;
  mode: TextEffect;
  align?: Align;
  shadow?: string;
  travel: number;
  slower?: number;
  sheen?: number;
  /** 'type': frames between words, and the frame the caret leaves this line. */
  gap: number;
  caretUntil: number;
  /** 'highlight': the frame this line's marker starts growing. */
  markAt: number;
  outline?: string;
}

/** How large a line starts in the 'scale' effect, when its room allows. */
const SCALE_FROM = 1.25;

/** Frames a glitch lasts at the start of a line. */
const GLITCH_FRAMES = 10;

const isHex = (c: string) => /^#[0-9a-f]{6}$/i.test(c);

function Line(p: LineProps) {
  const th = p.theme;
  const frame = useSceneFrame();
  const pr = useEnter(p.delay, p.slower);
  const stroke = Math.max(1.5, p.size * 0.022);
  const text: CSSProperties = {
    fontFamily: p.face.family,
    fontWeight: p.bold ? p.face.strong : p.face.weight,
    fontSize: p.size,
    lineHeight: `${p.size * p.lh}px`,
    letterSpacing: p.face.tracking ? `${p.face.tracking}em` : undefined,
    textTransform: p.face.upper ? 'uppercase' : undefined,
    color: p.outline ? 'transparent' : p.color,
    WebkitTextStroke: p.outline ? `${stroke.toFixed(2)}px ${p.outline}` : undefined,
    whiteSpace: 'nowrap',
    textShadow: p.outline ? undefined : p.shadow,
    textAlign: textAlignOf(p.align),
  };
  const content = lineContent(p, th, frame, stroke);
  switch (p.mode) {
    case 'mask': {
      const pad = p.size * 0.28;
      return (
        <div style={{ overflow: 'hidden', paddingTop: pad, paddingBottom: pad, marginTop: -pad, marginBottom: -pad, paddingInline: pad * 0.4, marginInline: -pad * 0.4 }}>
          <ShineText text={p.text} content={content} color={p.color} sheenAt={p.sheen} style={{ ...text, transform: `translateY(${(1 - pr) * 115}%)`, opacity: Math.min(1, pr * 2) }} />
        </div>
      );
    }
    case 'type':
      // The words themselves appear; the line does not move.
      return <ShineText text={p.text} content={content} color={p.color} sheenAt={p.sheen} style={text} />;
    case 'scale': {
      // Settles from large — as large as the line's room allows; a line that already fills it grows into place instead.
      const origin = p.align === 'center' ? 'center' : (p.align === 'end') !== th.rtl ? 'right' : 'left';
      const big = Math.min(SCALE_FROM, (p.grow ?? SCALE_FROM) * 0.99);
      const from = big >= 1.06 ? big : 0.86;
      return <ShineText text={p.text} content={content} color={p.color} sheenAt={p.sheen} style={{ ...text, opacity: Math.max(0, Math.min(1, pr * 1.4)), transform: `scale(${(from + (1 - from) * pr).toFixed(4)})`, transformOrigin: `${origin} center` }} />;
    }
    case 'slide':
      return <ShineText text={p.text} content={content} color={p.color} sheenAt={p.sheen} style={{ ...text, ...revealStyle('rise', pr, p.travel * 2.4, 'start', th.rtl) }} />;
    case 'glitch': {
      const f = frame - p.delay;
      if (f < 0) return <div style={{ ...text, opacity: 0 }}>{p.text}</div>;
      if (f >= GLITCH_FRAMES) return <ShineText text={p.text} content={content} color={p.color} sheenAt={p.sheen} style={text} />;
      // Two copies in the accents, offset and sliced differently every frame, over a flickering line.
      const k = 1 - f / GLITCH_FRAMES;
      const j = (key: string) => (random(`${key}|${p.text}|${f}`) - 0.5) * 2;
      const slice = (key: string) => {
        const top = random(`${key}t|${p.text}|${f}`) * 62;
        const tall = 14 + random(`${key}h|${p.text}|${f}`) * 34;
        return `inset(${top.toFixed(1)}% 0% ${Math.max(0, 100 - top - tall).toFixed(1)}% 0%)`;
      };
      const copy = (key: string, color: string): CSSProperties => ({
        ...text,
        position: 'absolute', left: 0, top: 0, width: '100%',
        color, WebkitTextStroke: undefined, textShadow: undefined,
        transform: `translate(${(j(key + 'x') * p.size * 0.07 * k).toFixed(2)}px, ${(j(key + 'y') * p.size * 0.025 * k).toFixed(2)}px)`,
        clipPath: slice(key),
      });
      return (
        <div style={{ position: 'relative', opacity: random(`o|${p.text}|${f}`) > 0.22 ? 1 : 0.45 }}>
          <div style={{ ...text, transform: `translateX(${(j('b') * p.size * 0.02 * k).toFixed(2)}px)` }}>{content ?? p.text}</div>
          <div style={copy('a', th.accent)}>{p.text}</div>
          <div style={copy('c', th.accent2)}>{p.text}</div>
        </div>
      );
    }
    case 'highlight':
      return <ShineText text={p.text} content={content} color={p.color} sheenAt={p.sheen} style={{ ...text, ...revealStyle('rise', pr, p.travel * 0.6) }} />;
    default:
      return <ShineText text={p.text} content={content} color={p.color} sheenAt={p.sheen} style={{ ...text, ...revealStyle(p.mode, pr, p.travel * 0.6) }} />;
  }
}

/**
 * What a line shows: its text alone, or — when its words carry emphasis or
 * arrive one by one — spans split at its spaces, so no word is ever broken
 * and the line lays out exactly as its plain text does.
 *
 * Emphasis is the accent colour on the words; where the accent does not read
 * as a colour of its own (an accent or gradient ground) and in a highlight,
 * it is a marker in the accent behind them with the words in its ink. In a
 * highlight the marker grows from the reading-start side once the lines are
 * in. Typing shows the words up to the frame, with a caret after the last.
 */
function lineContent(p: LineProps, th: Theme, frame: number, stroke: number): ReactNode {
  const typing = p.mode === 'type';
  if (!p.marks && !typing) return undefined;
  const marker = p.mode === 'highlight' || th.accentText === th.fg;
  const pad = p.size * 0.08;
  // The marker grows under the words, which keep their colour (so a letter not yet covered still reads on the
  // ground), then settle into the marker's ink once it is whole.
  const grow = (run: number) => (p.mode === 'highlight' ? progress(frame, p.markAt + run * 4, p.markAt + run * 4 + 12, Easing.out(Easing.cubic)) : 1);
  const settle = (run: number) => (p.mode === 'highlight' ? progress(frame, p.markAt + run * 4 + 12, p.markAt + run * 4 + 18) : 1);
  const inkOver = (t: number) => (isHex(p.color) && isHex(th.onAccent) ? mix(p.color, th.onAccent, t) : t > 0.5 ? th.onAccent : p.color);
  const shownOf = (j: number) => !typing || frame >= p.delay + j * p.gap;
  const nodes: ReactNode[] = [];
  let run = 0;
  let j = 0;
  let lastShown = -1;
  while (j < p.words.length) {
    const marked = !!p.marks?.[j];
    let k = j + 1;
    // A run of marked words is one span, so its marker covers the spaces between them; typing keeps every word its own.
    if (marked && !typing) while (k < p.words.length && p.marks?.[k]) k++;
    const piece = p.words.slice(j, k).join(' ');
    const shown = shownOf(j);
    if (shown) lastShown = j;
    if (j > 0) nodes.push(' ');
    if (!marked) {
      nodes.push(typing ? <span key={j} style={{ opacity: shown ? 1 : 0 }}>{piece}</span> : piece);
    } else if (!marker) {
      const word: CSSProperties = p.outline ? { WebkitTextStroke: `${stroke.toFixed(2)}px ${th.accentText}` } : { color: th.accentText };
      nodes.push(<span key={j} style={{ ...word, opacity: shown ? 1 : 0 }}>{piece}</span>);
    } else {
      const g = shown ? grow(run) : 0;
      const t = shown ? settle(run) : 0;
      // An outlined word fills in with the marker's ink once the marker is under it; a filled one turns to that ink.
      const ink: CSSProperties = p.outline
        ? t > 0.5 ? { color: th.onAccent, WebkitTextStroke: '0px transparent' } : {}
        : { color: inkOver(t) };
      nodes.push(
        <span key={j} style={{ position: 'relative', opacity: shown ? 1 : 0 }}>
          {g > 0 ? (
            <span style={{ position: 'absolute', [th.rtl ? 'right' : 'left']: -pad, top: '12%', height: '80%', width: `calc(${(g * 100).toFixed(2)}% + ${(2 * pad * g).toFixed(2)}px)`, background: th.accent, borderRadius: th.radius ? p.size * 0.08 : 0 }} />
          ) : null}
          <span style={{ position: 'relative', ...ink, textShadow: g > 0 ? 'none' : undefined }}>{piece}</span>
        </span>,
      );
      run++;
    }
    j = k;
  }
  if (typing && lastShown >= 0 && frame < p.caretUntil) {
    const typed = lastShown === p.words.length - 1;
    const blink = !typed || Math.floor((frame - p.delay) / 8) % 2 === 0;
    // A zero-width anchor right after the last word shown (word j is node 2j), so the caret takes no room in the line.
    nodes.splice(2 * lastShown + 1, 0,
      <span key="caret" style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', [th.rtl ? 'right' : 'left']: p.size * 0.06, top: '12%', height: '78%', width: Math.max(2, p.size * 0.055), background: th.accent, opacity: blink ? 1 : 0 }} />
      </span>,
    );
  }
  return nodes;
}

/** Plain text style for a face at a size. */
export function textStyle(face: TypeFace, size: number, color: string, bold = false): CSSProperties {
  return {
    fontFamily: face.family,
    fontWeight: bold ? face.strong : face.weight,
    fontSize: size,
    lineHeight: `${size * face.leading}px`,
    letterSpacing: face.tracking ? `${face.tracking}em` : undefined,
    textTransform: face.upper ? 'uppercase' : undefined,
    color,
    whiteSpace: 'nowrap',
  };
}

/** The direction a single string reads in, from its first strong letter. */
export function dirOf(s: string, fallback: 'rtl' | 'ltr'): 'rtl' | 'ltr' {
  const m = /[A-Za-zÀ-ɏ]|[֐-ࣿיִ-﷿ﹰ-﻿]/.exec(s);
  if (!m) return fallback;
  return /[A-Za-zÀ-ɏ]/.test(m[0]) ? 'ltr' : 'rtl';
}

// ---------------------------------------------------------------------------
// Shapes

/** A soft round light: an SVG radial gradient, static, placed by the caller's transform. */
export function Blob(p: { size: number; color: string; opacity?: number; style?: CSSProperties; hard?: boolean }) {
  const id = 'g' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const s = Math.max(2, Math.round(p.size));
  // The <svg> itself carries no position: the renderer rasterises it with its own inline style, where
  // left/top would shift the picture inside its box. The wrapper is placed and moved instead.
  return (
    <div style={{ position: 'absolute', width: s, height: s, opacity: p.opacity ?? 1, ...p.style }}>
    <svg width={s} height={s} viewBox="0 0 100 100" style={{ display: 'block', width: s, height: s }}>
      <defs>
        <radialGradient id={id} cx="50" cy="50" r="50" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={p.color} stopOpacity={1} />
          {p.hard ? <stop offset="0.7" stopColor={p.color} stopOpacity={0.9} /> : <stop offset="0.35" stopColor={p.color} stopOpacity={0.62} />}
          {p.hard ? null : <stop offset="0.7" stopColor={p.color} stopOpacity={0.18} />}
          <stop offset="1" stopColor={p.color} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="50" fill={`url(#${id})`} />
    </svg>
    </div>
  );
}

/** Moving film grain: a static turbulence image nudged every other frame. */
export function Grain(p: { opacity: number; width: number; height: number; t: number; dark: boolean }) {
  const id = 'n' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const pad = 48;
  const w = Math.round(p.width + pad * 2);
  const h = Math.round(p.height + pad * 2);
  const step = Math.floor(p.t / 2);
  const dx = Math.round(random(`gx${step}`) * pad * 2) - pad * 2;
  const dy = Math.round(random(`gy${step}`) * pad * 2) - pad * 2;
  const tone = p.dark ? '1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0.9 0' : '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.9 0';
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, opacity: p.opacity, transform: `translate(${dx + pad}px, ${dy + pad}px)` }}>
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', width: w, height: h }}>
      <filter id={id} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" seed="7" />
        <feColorMatrix type="matrix" values={tone} />
      </filter>
      <rect width={w} height={h} filter={`url(#${id})`} />
    </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Backgrounds

/**
 * The style's moving ground. Driven by the film's own frame (`start` + the
 * scene's frame), so the backgrounds of two scenes in a transition are the
 * same picture and only the scene's content appears to change. `bare` leaves
 * the style's shapes out (a montage covers them).
 *
 * The look's `backdrop`: 'moving' is this at the look's pace; 'still' is the
 * same picture held at the film's first frame, on every scene; 'plain' is the
 * background colour alone, flat.
 *
 * The scene's art ground (`theme.ground`) replaces it for that scene: the
 * accent as a solid ground with a soft light across it, the two accents as a
 * slowly turning gradient, or the scene's picture with its Ken Burns move
 * under a dark scrim; a dark or light ground is this same motif in those
 * colours (the theme carries them). The scene's shape (`ArtShape`) is drawn
 * on top of whichever ground, under the grain — `shape={false}` leaves it
 * out (the credits card), as `bare` does.
 */
export function Backdrop(p: { bare?: boolean; intensity?: number; shape?: boolean }) {
  const { theme: th, box: sceneBox, groundBox, start, index, count, total, video, digits, look, frames } = useScene();
  const box = groundBox ?? sceneBox;
  const frame = useCurrentFrame();
  const shape = p.bare || p.shape === false ? null : <ArtShape />;
  // The film's own frame, for what tells the time (minimal's progress rule), and the backdrop's clock.
  const now = start + frame;
  const t = look.backdrop === 'still' ? 0 : look.motion === 1 ? now : now * look.motion;
  const { width: W, height: H, u } = box;
  const s = (period: number, phase = 0) => Math.sin((t / period) * Math.PI * 2 + phase);
  const big = Math.max(W, H);
  const pic = th.ground === 'photo' ? video.scenes[index]?.picture?.src : undefined;
  if (pic) {
    return (
      <AbsoluteFill style={{ background: '#0B0B0E', overflow: 'hidden' }}>
        <Photo src={pic} seed={index} frames={frames} />
        <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', background: 'linear-gradient(180deg, rgba(8, 8, 12, 0.52) 0%, rgba(8, 8, 12, 0.44) 45%, rgba(8, 8, 12, 0.76) 100%)' }} />
        {shape}
      </AbsoluteFill>
    );
  }
  if (th.ground === 'accent' || th.ground === 'gradient') {
    const flat = look.backdrop === 'plain';
    const angle = (th.ground === 'gradient' ? 128 : 160) + (flat ? 0 : s(900) * 16);
    const light = mix(th.bg, '#FFFFFF', 0.35);
    return (
      <AbsoluteFill style={{ background: th.ground === 'accent' && flat ? th.bg : `linear-gradient(${angle.toFixed(2)}deg, ${th.bg} 0%, ${th.bg2} 100%)`, overflow: 'hidden' }}>
        {th.ground === 'accent' && !flat && !p.bare ? (
          <Blob size={big * 0.95} color={light} opacity={0.3} style={{ left: -big * 0.3, top: -big * 0.42, transform: `translate(${(s(520) * 70 * u).toFixed(2)}px, ${(s(610, 1) * 50 * u).toFixed(2)}px)` }} />
        ) : null}
        {shape}
        {th.grain > 0 && !flat ? <Grain opacity={th.grain * 0.8} width={W} height={H} t={t} dark={th.dark} /> : null}
      </AbsoluteFill>
    );
  }
  if (look.backdrop === 'plain') return <AbsoluteFill style={{ background: th.bg, overflow: 'hidden' }}>{shape}</AbsoluteFill>;
  // Over a background the person chose, the style's lights are quieter, so the colour they asked for is the one seen.
  const k = (p.intensity ?? 1) * (th.groundSet ? 0.5 : 1);
  const layers: ReactNode[] = [];
  const angle = 155 + s(900) * 18;
  const ground: CSSProperties = { background: `linear-gradient(${angle.toFixed(2)}deg, ${th.bg} 0%, ${th.bg2} 100%)` };

  switch (th.deco) {
    case 'mesh': {
      layers.push(
        <Blob key="a" size={big * 1.05} color={th.accent} opacity={0.42 * k} style={{ left: -big * 0.35, top: -big * 0.45, transform: `translate(${s(420) * 90 * u}px, ${s(560, 1) * 70 * u}px)` }} />,
        <Blob key="b" size={big * 0.9} color={th.accent2} opacity={0.26 * k} style={{ left: W - big * 0.5, top: H - big * 0.42, transform: `translate(${s(500, 2) * 110 * u}px, ${s(380, 0.5) * 80 * u}px)` }} />,
        <Blob key="c" size={big * 0.6} color={mix(th.accent, th.accent2, 0.5)} opacity={0.2 * k} style={{ left: W * 0.55 - big * 0.3, top: -big * 0.18, transform: `translate(${s(640, 3) * 140 * u}px, ${s(470, 1.2) * 90 * u}px)` }} />,
      );
      // A hairline grid, very faint, for a technical feel.
      const cell = 120 * u;
      const drift = (t * 0.25 * u) % cell;
      for (let i = -1; i < W / cell + 1; i++) {
        layers.push(<div key={`gx${i}`} style={{ position: 'absolute', left: i * cell + drift, top: 0, width: Math.max(1, u), height: H, background: alpha(th.fg, 0.035 * k) }} />);
      }
      for (let i = -1; i < H / cell + 1; i++) {
        layers.push(<div key={`gy${i}`} style={{ position: 'absolute', left: 0, top: i * cell + drift, width: W, height: Math.max(1, u), background: alpha(th.fg, 0.035 * k) }} />);
      }
      break;
    }
    case 'slab': {
      const slide = ((t * 1.6 * u) % (big * 0.5));
      layers.push(
        <div key="band" style={{ position: 'absolute', left: -big * 0.25, top: H * 0.5 - big * 0.2, width: big * 1.5, height: big * 0.26, background: alpha(th.accent, th.inverted ? 0.1 : 0.09), transform: `rotate(-14deg) translateX(${slide - big * 0.25}px)` }} />,
        <div key="band2" style={{ position: 'absolute', left: -big * 0.25, top: H * 0.5 + big * 0.12, width: big * 1.5, height: big * 0.022, background: alpha(th.accent2, th.inverted ? 0.14 : 0.3), transform: `rotate(-14deg) translateX(${-slide}px)` }} />,
      );
      // The scene's number, huge and outlined, in the far corner.
      const num = localDigits(String(index + 1).padStart(2, '0'), digits);
      const ns = (box.format === 'portrait' ? 520 : 600) * u;
      layers.push(
        <div key="num" style={{ position: 'absolute', [th.rtl ? 'left' : 'right']: -ns * 0.06, bottom: -ns * 0.2, fontFamily: th.ownFont ? "'Anton', 'Noto Kufi Arabic', sans-serif" : th.display.family, fontWeight: th.ownFont ? 400 : th.display.weight, fontSize: ns, lineHeight: `${ns}px`, color: 'transparent', WebkitTextStroke: `${Math.max(1, 2.5 * u)}px ${alpha(th.fg, 0.12)}`, direction: 'ltr', whiteSpace: 'nowrap' }}>{num}</div>,
      );
      break;
    }
    case 'frame': {
      layers.push(
        <Blob key="v" size={big * 1.3} color={mix(th.bg2, th.accent, 0.12)} opacity={0.95 * k} style={{ left: W / 2 - big * 0.65, top: H / 2 - big * 0.65, transform: `scale(${1 + s(700) * 0.04})` }} />,
        <Blob key="l" size={big * 0.5} color={th.accent} opacity={0.12 * k} style={{ left: W * 0.5 - big * 0.25, top: -big * 0.3, transform: `translate(${s(800) * 120 * u}px, 0px)` }} />,
      );
      const inset = Math.min(box.x, box.top) * 0.45;
      const line = Math.max(1, 1.5 * u);
      const c = alpha(th.accent, 0.55);
      layers.push(
        <div key="f" style={{ position: 'absolute', left: inset, top: inset, width: W - 2 * inset, height: H - 2 * inset, border: `${line}px solid ${alpha(th.accent, 0.28)}` }} />,
        <div key="f2" style={{ position: 'absolute', left: inset + 10 * u, top: inset + 10 * u, width: W - 2 * inset - 20 * u, height: H - 2 * inset - 20 * u, border: `${line}px solid ${alpha(th.accent, 0.12)}` }} />,
      );
      // Corner ornaments: small diamonds.
      const d = 14 * u;
      for (const [x, y] of [[inset, inset], [W - inset, inset], [inset, H - inset], [W - inset, H - inset]]) {
        layers.push(<div key={`d${x}-${y}`} style={{ position: 'absolute', left: x - d / 2, top: y - d / 2, width: d, height: d, background: c, transform: 'rotate(45deg)' }} />);
      }
      break;
    }
    case 'glow': {
      layers.push(
        <Blob key="a" size={big * 0.95} color={th.accent} opacity={0.4 * k} style={{ left: -big * 0.3, top: -big * 0.35, transform: `translate(${s(360) * 120 * u}px, ${s(290, 1) * 80 * u}px)` }} />,
        <Blob key="b" size={big * 0.85} color={th.accent2} opacity={0.28 * k} style={{ left: W - big * 0.5, top: H * 0.25 - big * 0.2, transform: `translate(${s(420, 2) * 100 * u}px, ${s(330, 0.3) * 120 * u}px)` }} />,
      );
      // A synthwave floor: converging lines (static SVG) and horizontal lines that scroll toward the viewer.
      const horizon = H * 0.72;
      const floorH = H - horizon;
      const vx = W / 2;
      const rays: ReactNode[] = [];
      const n = 16;
      for (let i = -n; i <= n; i++) {
        const x2 = vx + (i / n) * W * 1.6;
        rays.push(<line key={i} x1={vx} y1={0} x2={x2} y2={floorH} stroke={th.accent2} strokeOpacity={0.28} strokeWidth={1.4} />);
      }
      layers.push(
        <div key="fade" style={{ position: 'absolute', left: 0, top: horizon - 160 * u, width: W, height: 160 * u, background: `linear-gradient(180deg, ${alpha(th.accent, 0)} 0%, ${alpha(th.accent, 0.16)} 100%)` }} />,
        <div key="rays" style={{ position: 'absolute', left: 0, top: horizon, width: Math.round(W), height: Math.round(floorH), opacity: 0.8 * k }}>
          <svg width={Math.round(W)} height={Math.round(floorH)} viewBox={`0 0 ${Math.round(W)} ${Math.round(floorH)}`} style={{ display: 'block', width: Math.round(W), height: Math.round(floorH) }}>
            {rays}
          </svg>
        </div>,
      );
      const rows = 9;
      const phase = (t % 45) / 45;
      for (let i = 0; i < rows; i++) {
        const z = (i + phase) / rows;
        const y = horizon + floorH * z * z;
        layers.push(<div key={`h${i}`} style={{ position: 'absolute', left: 0, top: y, width: W, height: Math.max(1, 1.6 * u), background: alpha(th.accent2, 0.1 + 0.35 * z) }} />);
      }
      layers.push(<div key="hz" style={{ position: 'absolute', left: 0, top: horizon, width: W, height: Math.max(1, 2 * u), background: alpha(th.accent, 0.7) }} />);
      break;
    }
    case 'rule': {
      const line = Math.max(1, 1.5 * u);
      const y1 = box.top * 0.55;
      const y2 = H - box.bottom * 0.55;
      const small = 22 * u;
      const label: CSSProperties = { position: 'absolute', top: y1 - small * 1.9, fontFamily: th.body.family, fontWeight: th.body.strong, fontSize: small, lineHeight: `${small * 1.3}px`, color: th.muted, whiteSpace: 'nowrap' };
      const played = Math.min(1, now / Math.max(1, total - 1));
      // A vertical frame's story bar takes the place of the top rule.
      if (box.format !== 'portrait') layers.push(<div key="r1" style={{ position: 'absolute', left: box.x, top: y1, width: box.w, height: line, background: alpha(th.fg, 0.14) }} />);
      layers.push(<div key="r2" style={{ position: 'absolute', left: box.x, top: y2, width: box.w, height: line, background: alpha(th.fg, 0.14) }} />);
      // A vertical video keeps words out of the top and bottom bands (phone apps draw there) and
      // shows its progress in the story bar along the top instead (VideoScenes.tsx).
      if (box.format !== 'portrait') {
        const counter = localDigits(`${String(index + 1).padStart(2, '0')} / ${String(count).padStart(2, '0')}`, digits);
        // The counter reads from the start side — unless the watermark was moved into that corner.
        const counterAtEnd = watermarkOn(video) && look.watermarkCorner === 'top-start';
        layers.push(
          <div key="r3" style={{ position: 'absolute', [th.rtl ? 'right' : 'left']: box.x, top: y2 - line, width: box.w * played, height: line * 3, background: th.accent }} />,
          <div key="n" style={{ ...label, [th.rtl !== counterAtEnd ? 'right' : 'left']: box.x, direction: 'ltr' }}>{counter}</div>,
        );
        // The brand's name on the other side — unless the watermark already puts the brand in that corner.
        if (video.brand?.name && !watermarkOn(video)) {
          layers.push(<div key="b" style={{ ...label, [th.rtl ? 'left' : 'right']: box.x }}>{video.brand.name}</div>);
        }
      }
      break;
    }
    case 'sun': {
      // In a vertical frame the sun sits up in the band phone apps draw over, clear of the words below it.
      const sun = Math.min(W, H) * (box.format === 'landscape' ? 0.62 : box.format === 'portrait' ? 0.44 : 0.42);
      const rise = s(900) * 30 * u;
      // The sun sits in the far corner on the end side, where words rarely are.
      const sx = th.rtl ? W * 0.12 : W * 0.88;
      const sy = box.format === 'portrait' ? H * 0.035 : box.format === 'square' ? H * 0.07 : H * 0.14;
      layers.push(
        <Blob key="glow" size={sun * 2.4} color={th.accent2} opacity={0.3 * k} style={{ left: sx - sun * 1.2, top: sy - sun * 1.2, transform: `translateY(${rise}px)` }} />,
        <div key="sun" style={{ position: 'absolute', left: sx - sun / 2, top: sy - sun / 2, width: sun, height: sun, borderRadius: '50%', background: `linear-gradient(200deg, ${alpha(th.accent2, 0.42)} 0%, ${alpha(th.accent, 0.22)} 100%)`, transform: `translateY(${rise}px)`, opacity: k }} />,
        <Blob key="c" size={big * 0.7} color="#FFFFFF" opacity={0.5 * k} style={{ left: -big * 0.25, top: H - big * 0.4, transform: `translate(${s(700, 1) * 80 * u}px, 0px)` }} />,
      );
      // Soft hills at the foot of the frame.
      layers.push(
        <div key="h1" style={{ position: 'absolute', left: -W * 0.2, top: H * 0.86, width: W * 0.9, height: H * 0.5, borderRadius: '50%', background: alpha(th.accent, 0.1), transform: `translateX(${s(1000) * 30 * u}px)` }} />,
        <div key="h2" style={{ position: 'absolute', left: W * 0.35, top: H * 0.9, width: W * 1.0, height: H * 0.5, borderRadius: '50%', background: alpha(th.accent2, 0.14), transform: `translateX(${s(1100, 2) * 30 * u}px)` }} />,
      );
      break;
    }
  }

  return (
    <AbsoluteFill style={{ ...ground, overflow: 'hidden' }}>
      {p.bare ? null : layers}
      {shape}
      {th.grain > 0 ? <Grain opacity={th.grain} width={W} height={H} t={t} dark={th.dark} /> : null}
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// The scene's shape

/**
 * The decorative shape a scene's art chose (`art.shape`), animated, in the
 * accents, in the free space away from the words: a corner on the end side
 * (the start side when the words are set to the end), at the top or the
 * foot by turns, half off the frame — in a vertical frame that is the band
 * phone apps draw over, where no words go. Its size follows the frame's unit,
 * and it is drawn under the words at an opacity that leaves them reading.
 *
 * - circle: a disc in an accent gradient that swells in and breathes, a thin
 *   ring round it and a small moon circling;
 * - ring: an arc that draws itself in, then turns slowly, round a dotted one;
 * - dots: a field of dots that pop in from the corner and ripple;
 * - lines: parallel strokes that slide in on a slant and drift;
 * - wave: three waves flowing toward the reading end;
 * - burst: rays that pop out from a point and slowly turn;
 * - arrow: an arrow in a ring pointing toward the reading end, nudging;
 * - grid: hairlines that draw in, with cells that light up in turn;
 * - blob: two soft lights wandering.
 *
 * Only the ring's arc changes its SVG while it draws; every other picture is
 * static markup moved by CSS, which the exporter draws once.
 */
export function ArtShape() {
  const { theme: th, box, frames, index, art, video, look } = useScene();
  const frame = useSceneFrame();
  const { fps } = useVideoConfig();
  const kind = art.shape;
  if (!kind || kind === 'none') return null;
  const { width: W, height: H, u } = box;
  const S = (box.format === 'landscape' ? 400 : box.format === 'portrait' ? 480 : 340) * u;
  const scene = video.scenes[index];
  // Words set to the end leave the start side free; a caption at the foot of a picture leaves the top.
  const right = (th.align !== 'end') !== th.rtl;
  const footWords = !!scene && (scene.kind === 'gallery' || ((scene.kind === 'image' || scene.kind === 'title') && !!scene.picture?.src));
  // Never in the corner mark's corner; in a vertical frame, never under the story bar along the top.
  const mark = watermarkOn(video) ? look.watermarkCorner : null;
  const markRight = !!mark && mark.endsWith('end') !== th.rtl;
  const markTop = !!mark && mark.startsWith('top');
  let top = footWords || (box.format === 'portrait' ? false : index % 2 === 0);
  if (mark && markRight === right) top = !markTop;
  // How far in from the corner the shape's centre sits, as a share of its size: a ring or a light may run off the frame, an arrow must be whole.
  const inset = kind === 'arrow' ? 0.5 : kind === 'ring' || kind === 'blob' ? 0.18 : 0.26;
  const cx = right ? W - S * inset : S * inset;
  const cy = top ? S * inset : H - S * inset;
  const e = enterAt(frame - 4, fps, th, 1.4);
  const inP = Math.max(0, Math.min(1, e));
  const sec = frame / fps;
  const dir = th.rtl ? -1 : 1;
  const a1 = th.accent;
  const a2 = th.accent2;
  const wrap: CSSProperties = { position: 'absolute', left: cx - S / 2, top: cy - S / 2, width: S, height: S, opacity: th.ground === 'photo' ? 0.85 : th.dark ? 0.9 : 0.78 };
  const abs = (x: number, y: number, w: number, h: number, extra: CSSProperties = {}): CSSProperties => ({ position: 'absolute', left: x, top: y, width: w, height: h, ...extra });
  const line = Math.max(1, 1.6 * u);
  let body: ReactNode = null;
  switch (kind) {
    case 'circle': {
      const d = S * 0.62;
      const orbit = sec * 0.7 * dir;
      const moon = S * 0.1;
      body = (
        <>
          <div style={abs(S * 0.04, S * 0.04, S * 0.92, S * 0.92, { borderRadius: '50%', border: `${line}px solid ${alpha(a2, 0.5)}`, transform: `scale(${(0.8 + 0.2 * inP).toFixed(4)})`, opacity: inP })} />
          <div style={abs((S - d) / 2, (S - d) / 2, d, d, { borderRadius: '50%', background: `linear-gradient(${(135 + 40 * (frame / Math.max(1, frames))).toFixed(1)}deg, ${alpha(a1, 0.92)} 0%, ${alpha(a2, 0.7)} 100%)`, transform: `scale(${(e * (1 + 0.035 * Math.sin(sec * 1.4))).toFixed(4)})`, opacity: inP })} />
          <div style={abs(S / 2 + Math.cos(orbit) * S * 0.46 - moon / 2, S / 2 + Math.sin(orbit) * S * 0.46 - moon / 2, moon, moon, { borderRadius: '50%', background: a2, transform: `scale(${inP.toFixed(4)})` })} />
        </>
      );
      break;
    }
    case 'ring': {
      const p = progress(frame, 4, 4 + Math.max(20, Math.min(44, frames * 0.3)), Easing.inOut(Easing.cubic));
      const C = 2 * Math.PI * 42;
      const arc = Math.round(C * 0.8 * p * 10) / 10;
      const turn = (frame * 0.35 * dir).toFixed(2);
      body = (
        <>
          <div style={abs(0, 0, S, S, { transform: th.rtl ? `rotate(${turn}deg) scaleX(-1)` : `rotate(${turn}deg)` })}>
            <svg width={Math.round(S)} height={Math.round(S)} viewBox="0 0 100 100" style={{ display: 'block', width: Math.round(S), height: Math.round(S) }}>
              <circle cx="50" cy="50" r="42" fill="none" stroke={a1} strokeWidth="3.4" strokeLinecap="round" strokeDasharray={`${arc} ${Math.ceil(C)}`} transform="rotate(-90 50 50)" />
            </svg>
          </div>
          <div style={abs(S * 0.17, S * 0.17, S * 0.66, S * 0.66, { transform: `rotate(${(-frame * 0.2 * dir).toFixed(2)}deg) scale(${(0.85 + 0.15 * inP).toFixed(4)})`, opacity: inP })}>
            <svg width={Math.round(S * 0.66)} height={Math.round(S * 0.66)} viewBox="0 0 100 100" style={{ display: 'block', width: Math.round(S * 0.66), height: Math.round(S * 0.66) }}>
              <circle cx="50" cy="50" r="47" fill="none" stroke={a2} strokeOpacity="0.7" strokeWidth="2" strokeLinecap="round" strokeDasharray="0.5 7" />
            </svg>
          </div>
        </>
      );
      break;
    }
    case 'dots': {
      const n = 6;
      const step = S / n;
      const dot = S * 0.042;
      const dots: ReactNode[] = [];
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          // Distance from the corner the shape sits in, so the field pops in from the frame's edge.
          const di = right ? n - 1 - i : i;
          const dj = top ? j : n - 1 - j;
          const dist = di + dj;
          const pop = Math.max(0, Math.min(1.15, enterAt(frame - 4 - dist * 1.6, fps, th)));
          const ripple = 1 + 0.35 * Math.sin(sec * 2.2 - dist * 0.55);
          dots.push(<div key={`${i}-${j}`} style={abs(i * step + (step - dot) / 2, j * step + (step - dot) / 2, dot, dot, { borderRadius: '50%', background: dist % 3 === 0 ? a2 : a1, transform: `scale(${(pop * ripple).toFixed(4)})` })} />);
        }
      }
      body = <>{dots}</>;
      break;
    }
    case 'lines': {
      const bars: ReactNode[] = [];
      const thick = S * 0.026;
      for (let i = 0; i < 6; i++) {
        const len = S * (0.42 + ((i * 37) % 10) / 20);
        const p = Math.max(0, Math.min(1, enterAt(frame - 4 - i * 3, fps, th)));
        const driftX = Math.sin(sec * 0.9 + i) * S * 0.05;
        bars.push(<div key={i} style={abs(S * 0.5 - len / 2, S * 0.12 + i * S * 0.13, len, thick, { borderRadius: thick / 2, background: i % 2 ? alpha(a2, 0.85) : a1, transform: `translateX(${(((1 - p) * -S * 0.45 + driftX) * dir).toFixed(2)}px)`, opacity: p })} />);
      }
      body = <div style={abs(0, 0, S, S, { transform: `rotate(${(-32 * dir).toFixed(1)}deg)` })}>{bars}</div>;
      break;
    }
    case 'wave': {
      const period = Math.max(2, Math.round(S * 0.5));
      const amp = S * 0.05;
      const w = period * 4;
      const h = Math.round(S * 0.2);
      const mid = h / 2;
      let d = `M0 ${mid.toFixed(1)} Q${(period / 4).toFixed(1)} ${(mid - 2 * amp).toFixed(1)} ${(period / 2).toFixed(1)} ${mid.toFixed(1)}`;
      for (let x = period; x <= w; x += period / 2) d += ` T${x.toFixed(1)} ${mid.toFixed(1)}`;
      const waves: ReactNode[] = [];
      for (let i = 0; i < 3; i++) {
        const shift = ((frame * (1.4 + i * 0.5) * u + i * period * 0.3) % period);
        const reveal = Math.max(0, Math.min(1, enterAt(frame - 4 - i * 4, fps, th)));
        waves.push(
          <div key={i} style={abs(0, S * 0.26 + i * S * 0.17, S, h, { overflow: 'hidden', clipPath: `inset(0% ${((1 - reveal) * 100).toFixed(2)}% 0% 0%)` })}>
            <div style={abs(-period + shift, 0, w, h)}>
              <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', width: w, height: h }}>
                <path d={d} fill="none" stroke={i === 1 ? a2 : a1} strokeOpacity={i === 2 ? 0.55 : 0.9} strokeWidth={Math.max(2, S * 0.018)} strokeLinecap="round" />
              </svg>
            </div>
          </div>,
        );
      }
      // Flowing and revealed toward the reading end: mirrored as a whole for right to left.
      body = <div style={abs(0, 0, S, S, th.rtl ? { transform: 'scaleX(-1)' } : {})}>{waves}</div>;
      break;
    }
    case 'burst': {
      const rays: ReactNode[] = [];
      const n = 12;
      const thick = S * 0.03;
      const pulse = 1 + 0.06 * Math.sin(sec * 2.4);
      const r = (S * 0.1 + S * 0.2 * Math.max(0, e)) * pulse;
      const spin = sec * 6 * dir;
      for (let i = 0; i < n; i++) {
        const len = S * (i % 2 ? 0.11 : 0.18);
        rays.push(<div key={i} style={abs(S / 2, S / 2 - thick / 2, len, thick, { borderRadius: thick / 2, background: i % 2 ? a2 : a1, transformOrigin: '0% 50%', transform: `rotate(${(i * (360 / n) + spin).toFixed(2)}deg) translateX(${r.toFixed(2)}px) scaleX(${inP.toFixed(4)})`, opacity: inP })} />);
      }
      const core = S * 0.08;
      body = (
        <>
          {rays}
          <div style={abs(S / 2 - core / 2, S / 2 - core / 2, core, core, { borderRadius: '50%', background: a1, transform: `scale(${Math.max(0, e).toFixed(4)})` })} />
        </>
      );
      break;
    }
    case 'arrow': {
      const nudge = Math.pow(Math.sin(sec * 2.2), 2) * S * 0.05;
      const slide = (1 - inP) * -S * 0.3;
      const inner = S * 0.62;
      body = (
        <>
          <div style={abs(S * 0.06, S * 0.06, S * 0.88, S * 0.88, { borderRadius: '50%', border: `${Math.max(1, 2 * u)}px solid ${alpha(a2, 0.6)}`, transform: `scale(${(0.85 + 0.15 * inP).toFixed(4)})`, opacity: inP })} />
          <div style={abs((S - inner) / 2, (S - inner) / 2, inner, inner, { transform: `translateX(${((slide + nudge) * dir).toFixed(2)}px)${th.rtl ? ' scaleX(-1)' : ''}`, opacity: inP })}>
            <svg width={Math.round(inner)} height={Math.round(inner)} viewBox="0 0 100 100" style={{ display: 'block', width: Math.round(inner), height: Math.round(inner) }}>
              <path d="M14 50H84 M58 24L85 50L58 76" fill="none" stroke={a1} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </>
      );
      break;
    }
    case 'grid': {
      const n = 5;
      const cell = S / n;
      const parts: ReactNode[] = [];
      for (let i = 0; i <= n; i++) {
        const p = Math.max(0, Math.min(1, progress(frame, 4 + i * 2, 22 + i * 2, Easing.out(Easing.cubic))));
        parts.push(<div key={`v${i}`} style={abs(i * cell - line / 2, 0, line, S * p, { background: alpha(a1, 0.5) })} />);
        parts.push(<div key={`h${i}`} style={abs(0, i * cell - line / 2, S * p, line, { background: alpha(a1, 0.5) })} />);
      }
      const lit = [[1, 1], [3, 2], [2, 4], [4, 0]];
      lit.forEach(([ci, cj], k) => {
        const on = Math.max(0, Math.sin(sec * 1.3 + k * 1.7)) * inP;
        parts.push(<div key={`c${k}`} style={abs(ci * cell + line, cj * cell + line, cell - 2 * line, cell - 2 * line, { background: k % 2 ? a2 : a1, opacity: 0.75 * on })} />);
      });
      body = <div style={abs(0, 0, S, S, { transform: `translate(${(Math.sin(sec * 0.5) * S * 0.02).toFixed(2)}px, ${(Math.cos(sec * 0.4) * S * 0.02).toFixed(2)}px)` })}>{parts}</div>;
      break;
    }
    case 'blob': {
      body = (
        <>
          <Blob size={S * 1.2} color={a1} opacity={0.62 * inP} style={{ left: -S * 0.1, top: -S * 0.1, transform: `translate(${(Math.sin(sec * 0.6) * S * 0.08).toFixed(2)}px, ${(Math.cos(sec * 0.5) * S * 0.06).toFixed(2)}px) scale(${(0.7 + 0.3 * inP).toFixed(4)})` }} />
          <Blob size={S * 0.7} color={a2} opacity={0.5 * inP} style={{ left: S * 0.35, top: S * 0.3, transform: `translate(${(Math.cos(sec * 0.7) * S * 0.1).toFixed(2)}px, ${(Math.sin(sec * 0.8) * S * 0.08).toFixed(2)}px)` }} />
        </>
      );
      break;
    }
  }
  return <div style={wrap}>{body}</div>;
}

// ---------------------------------------------------------------------------
// Pictures

/**
 * The slow camera moves a picture can make, as scale and drift (in % of the
 * picture) at the start and the end: pushing in, pulling out, panning,
 * tilting and diagonals. A picture always stays larger than its box, so no
 * edge ever shows.
 */
const MOVES: readonly { s: [number, number]; x: [number, number]; y: [number, number] }[] = [
  { s: [1.05, 1.17], x: [-1.2, 1.4], y: [0.6, -0.8] }, // push in, drifting to the end
  { s: [1.19, 1.07], x: [1.4, -1.2], y: [-0.4, 0.8] }, // pull out, drifting back
  { s: [1.12, 1.13], x: [-3.2, 3.2], y: [0, 0] }, // a pan across
  { s: [1.14, 1.14], x: [0, 0], y: [2.8, -2.8] }, // a tilt up
  { s: [1.06, 1.2], x: [2, -1.6], y: [1.6, -1.2] }, // a diagonal push
  { s: [1.13, 1.12], x: [3, -3], y: [-0.6, 0.6] }, // a pan the other way
  { s: [1.2, 1.08], x: [-1.8, 1.4], y: [-1.6, 1.2] }, // a diagonal pull
];

/**
 * A picture filling its box, moving slowly — a Ken Burns move chosen by
 * `seed` so neighbouring pictures never move alike, eased at both ends so it
 * starts and settles like a camera on a slider rather than a scroll. The
 * move runs across `frames` and a little past it, so it is still going
 * during the transition out. `strength` scales it (a face moves less), and
 * so does the look's pace: a quicker film's camera travels further.
 *
 * `fit` (the scene's `look.fit` unless given): 'cover' fills the box, as
 * always; 'contain' shows all of the picture, a little inside the box and
 * breathing in, over a copy of itself that covers the box under a dark veil
 * — the renderer has no blur, and the veiled copy carries the picture's
 * colours to the edges instead of bars.
 */
export function Photo(p: { src: string; seed: number; frames: number; style?: CSSProperties; strength?: number; fit?: PictureFit }) {
  const frame = useSceneFrame();
  const { look, theme } = useScene();
  const k = (p.strength ?? 1) * look.motion;
  if ((p.fit ?? look.fit) === 'contain') {
    const t = interpolate(frame, [0, Math.max(1, p.frames + 15)], [0, 1], { easing: Easing.bezier(0.33, 0, 0.6, 1), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const veil = mix(theme.dark ? theme.bg : theme.fg, '#000000', 0.35);
    const fill: CSSProperties = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' };
    return (
      <div style={{ ...fill, overflow: 'hidden', ...p.style }}>
        <Img src={p.src} style={{ ...fill, objectFit: 'cover', transform: 'scale(1.2)' }} />
        <div style={{ ...fill, background: alpha(veil, 0.86) }} />
        <Img src={p.src} style={{ ...fill, objectFit: 'contain', transform: `scale(${(0.93 + 0.04 * t * Math.min(1.5, k)).toFixed(4)})` }} />
      </div>
    );
  }
  const m = MOVES[((p.seed % MOVES.length) + MOVES.length) % MOVES.length];
  const t = interpolate(frame, [0, Math.max(1, p.frames + 15)], [0, 1], { easing: Easing.bezier(0.33, 0, 0.6, 1), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const lerp = (r: [number, number]) => r[0] + (r[1] - r[0]) * t;
  const scale = 1 + (lerp(m.s) - 1) * (0.6 + 0.4 * k);
  // Drift never takes the picture's edge inside its box: at most half the headroom the scale leaves.
  const room = ((scale - 1) / scale) * 50;
  const dx = Math.max(-room, Math.min(room, lerp(m.x) * k));
  const dy = Math.max(-room, Math.min(room, lerp(m.y) * k));
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', overflow: 'hidden', ...p.style }}>
      <Img src={p.src} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale.toFixed(4)}) translate(${dx.toFixed(3)}%, ${dy.toFixed(3)}%)` }} />
    </div>
  );
}

/**
 * Words over a picture are always light on a darkened picture, whatever the
 * style — a light scrim over a photograph looks washed out. (videotheme.ts
 * `onPhotoTheme`, which a scene on a photo ground is already drawn in.)
 */
export const onPhoto = onPhotoTheme;

/** A darkening gradient over a picture, towards the side the words are on. */
export function Scrim(p: { theme: Theme; to: 'bottom' | 'top' | 'start' | 'end' | 'all'; strength?: number }) {
  const base = p.theme.dark ? mix(p.theme.bg, '#000000', 0.3) : mix(p.theme.fg, '#000000', 0.5);
  const k = p.strength ?? 1;
  const dir = p.to === 'bottom' ? 180 : p.to === 'top' ? 0 : p.to === 'start' ? (p.theme.rtl ? 90 : 270) : p.to === 'end' ? (p.theme.rtl ? 270 : 90) : 180;
  const bg = p.to === 'all'
    ? `linear-gradient(180deg, ${alpha(base, 0.55 * k)} 0%, ${alpha(base, 0.45 * k)} 50%, ${alpha(base, 0.75 * k)} 100%)`
    : `linear-gradient(${dir}deg, ${alpha(base, 0.05 * k)} 0%, ${alpha(base, 0.35 * k)} 45%, ${alpha(base, 0.9 * k)} 100%)`;
  return <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', background: bg }} />;
}

const naturalSizes = new Map<string, { w: number; h: number }>();

/**
 * A picture's own width and height, for laying it out by hand (a logo framed
 * tightly, say). Holds the renderer's frame until the picture has been
 * measured, so no frame is drawn with a guess; null while unknown or when it
 * cannot be read. Pictures are data: URLs, so this never touches the network.
 */
export function useNaturalSize(src: string | undefined): { w: number; h: number } | null {
  const [size, setSize] = useState(() => (src ? naturalSizes.get(src) ?? null : null));
  const { delayRender, continueRender } = useDelayRender();
  useEffect(() => {
    if (!src) return;
    const known = naturalSizes.get(src);
    if (known) {
      setSize(known);
      return;
    }
    let live = true;
    const handle = delayRender('Measuring a picture', { timeoutInMilliseconds: 20000 });
    const img = new Image();
    const done = () => continueRender(handle);
    img.onload = () => {
      const got = { w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
      if (naturalSizes.size > 32) naturalSizes.clear();
      naturalSizes.set(src, got);
      if (live) setSize(got);
      done();
    };
    img.onerror = done;
    img.src = src;
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);
  return src ? size ?? naturalSizes.get(src) ?? null : null;
}

/** The brand's logo, kept in proportion within a height. */
export function Logo(p: { src: string; height: number; maxWidth: number; style?: CSSProperties }) {
  return <Img src={p.src} style={{ height: p.height, width: 'auto', maxWidth: p.maxWidth, objectFit: 'contain', ...p.style }} />;
}

/** A short accent line that grows from the start side (from the middle when centred, from the end when set to the end). */
export function Rule(p: { width: number; height: number; color: string; p: number; center?: boolean; align?: Align; style?: CSSProperties }) {
  const { theme } = useScene();
  const w = Math.max(0, p.width * Math.min(1, p.p));
  return (
    <div style={{ width: p.width, height: p.height, display: 'flex', justifyContent: flexOf(p.align ?? (p.center ? 'center' : 'start')), ...p.style }}>
      <div style={{ width: w, height: p.height, background: p.color, borderRadius: theme.radius > 0 ? p.height / 2 : 0 }} />
    </div>
  );
}

/**
 * The brand on a scene that does not usually carry it (a scene's
 * `look.logo`): its logo at `height`, or — with no logo — its name as a small
 * wordmark after an accent dot, fitted to `maxWidth` on one line. Latin names
 * are spaced and set in capitals; Arabic-script ones never are.
 */
export function BrandMark(p: { height: number; maxWidth: number; theme: Theme; delay?: number; style?: CSSProperties }) {
  const { video, box, ready } = useScene();
  const pr = useEnter(p.delay ?? 0);
  const th = p.theme;
  const logo = video.brand?.logo;
  const name = video.brand?.name?.trim() ?? '';
  const arrive = revealStyle('rise', pr, 18 * box.u);
  if (logo) {
    return (
      <div style={{ height: p.height, display: 'flex', alignItems: 'center', ...arrive, ...p.style }}>
        <Logo src={logo} height={p.height} maxWidth={p.maxWidth} />
      </div>
    );
  }
  if (!name) return null;
  const latin = !/[؀-ۿ]/.test(name);
  const dot = p.height * 0.18;
  const gap = p.height * 0.24;
  const face: TypeFace = { ...th.body, weight: th.body.strong, tracking: latin ? 0.14 : 0, upper: latin };
  const f = fitText(name, { face, maxSize: p.height * 0.5, minSize: p.height * 0.2, maxWidth: Math.max(1, p.maxWidth - dot - gap), maxHeight: p.height, maxLines: 1, ready });
  return (
    <div style={{ height: p.height, display: 'flex', flexDirection: 'row', alignItems: 'center', gap, direction: th.rtl ? 'rtl' : 'ltr', ...arrive, ...p.style }}>
      <div style={{ width: dot, height: dot, borderRadius: th.radius ? '50%' : 0, background: th.accent, flexShrink: 0 }} />
      <div style={{ fontFamily: th.body.family, fontWeight: th.body.strong, fontSize: f.size, lineHeight: `${f.size * 1.3}px`, color: th.fg, whiteSpace: 'nowrap', letterSpacing: latin ? '0.14em' : undefined, textTransform: latin ? 'uppercase' : undefined, direction: latin ? 'ltr' : 'rtl' }}>{f.lines[0] ?? name}</div>
    </div>
  );
}

/**
 * Whether the film carries the brand in a corner: on unless the person
 * turned it off, and only when there is a brand to carry — a logo, or a name
 * to set as a small wordmark.
 */
export function watermarkOn(v: Pick<Video, 'watermark' | 'brand'>): boolean {
  return v.watermark !== false && !!(v.brand?.logo || v.brand?.name?.trim());
}

/** Where the corner mark sits (VideoScenes.tsx draws it), and the band a scene keeps clear for it. */
export interface WatermarkSpot {
  /** The mark's top edge and height, in pixels. */
  top: number;
  height: number;
  /** Its distance from the frame's side, and which side: the right or the left. */
  side: number;
  right: boolean;
  /** The frame edge it sits along. */
  edge: 'top' | 'bottom';
  /** How far into the safe area a scene keeps clear for it, along that edge, in pixels. */
  band: number;
}

/**
 * The corner mark's place in a frame, from the look's `watermarkCorner` and
 * `watermarkScale`. A vertical frame puts it inside the safe area, just below
 * the top band or just above the bottom one where phone apps draw, and every
 * scene under it keeps a band clear. A wide or square frame puts it in the
 * margin as the style always has — inside the elegant frame's lines, level
 * with minimal's counter (below its rule at the foot), and likewise for a
 * designed look with the frame or rule motif — and keeps a band
 * clear only for as much as a larger mark reaches beyond where the style's
 * own size sat. It never leaves the frame.
 */
export function watermarkSpot(v: Pick<Video, 'look' | 'style' | 'lang' | 'ai' | 'design'>, box: Box): WatermarkSpot {
  const look = lookFor(v);
  // The style whose ground the mark sits on: a designed look's motif's (a 'frame' design has elegant's lines).
  const style = drawStyleOf(v);
  const u = box.u;
  const H = box.height;
  const edge = look.watermarkCorner.startsWith('top') ? 'top' : 'bottom';
  const right = look.watermarkCorner.endsWith('end') !== (v.lang !== 'en');
  const base = (box.format === 'landscape' ? 50 : box.format === 'portrait' ? 60 : 46) * u;
  const inset = Math.min(box.x, box.top) * 0.45;
  const side = style === 'elegant' && box.format !== 'portrait' ? inset + 34 * u : box.x;
  const at = (k: number): { top: number; height: number; reach: number } => {
    let h = base * k;
    if (box.format === 'portrait') {
      const top = edge === 'top' ? box.top + 4 * u : H - box.bottom - 4 * u - h;
      return { top, height: h, reach: 24 * u + h };
    }
    let y: number;
    if (style === 'elegant') y = edge === 'top' ? inset + 26 * u : H - inset - 26 * u - h;
    else if (style === 'minimal' && edge === 'top') y = box.top * 0.55 - 22 * u * 1.9 - (h - 22 * u * 1.3) / 2;
    else if (style === 'minimal') {
      // Under the rule and its progress line at the foot, never over them.
      y = H - box.bottom * 0.55 + 3 * Math.max(1, 1.5 * u) + 8 * u;
      h = Math.min(h, H - y - 10 * u);
    } else y = edge === 'top' ? box.top / 2 - h / 2 : H - box.bottom / 2 - h / 2;
    y = Math.max(6 * u, Math.min(H - 6 * u - h, y));
    const reach = edge === 'top' ? y + h + 12 * u - box.top : H - box.bottom - (y - 12 * u);
    return { top: y, height: h, reach: Math.max(0, reach) };
  };
  const now = at(look.watermarkScale);
  const band = box.format === 'portrait' ? now.reach : Math.max(0, now.reach - at(1).reach);
  return { top: now.top, height: now.height, side, right, edge, band };
}
