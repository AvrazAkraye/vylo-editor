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
 */

import { createContext, useContext, useId } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Img, interpolate, random, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Video } from './videotypes';
import { alpha, contrast, mix } from './videotheme';
import type { Box, Fit, Theme, TypeFace } from './videotheme';

// ---------------------------------------------------------------------------
// Scene context

export interface SceneInfo {
  video: Video;
  theme: Theme;
  box: Box;
  /** This scene's length in frames. */
  frames: number;
  index: number;
  count: number;
  /** The frame this scene starts at in the whole film (for backgrounds that flow across cuts). */
  start: number;
  /** The whole film's length in frames. */
  total: number;
  /** Whether the style's fonts are loaded (measurements are only cached then). */
  ready: boolean;
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
 * 0 → 1 as an element arrives, `delay` frames into the scene, in the style's
 * own curve: springs for the lively styles (a little overshoot), eased curves
 * for elegant and minimal.
 */
export function useEnter(delay: number, slower = 1): number {
  const frame = useCurrentFrame();
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

export function glowOf(theme: Theme, strength = 1): string | undefined {
  if (theme.style !== 'neon' || theme.inverted) return undefined;
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

interface LinesProps {
  fit: Fit;
  face: TypeFace;
  bold?: boolean;
  color: string;
  delay: number;
  stagger: number;
  mode?: RevealMode;
  align?: 'start' | 'center';
  shadow?: string;
  /** Colour for one line (by index), e.g. to set the last line in the accent. */
  lineColor?: (i: number) => string | undefined;
  style?: CSSProperties;
  slower?: number;
}

/**
 * Fitted lines, one text node each, revealed one after another. In 'mask'
 * mode each line rises out of its own clipping box (padded so Arabic dots and
 * tall letters are not cut).
 */
export function Lines(p: LinesProps) {
  const { theme, box } = useScene();
  const mode = p.mode ?? revealOf(theme);
  const lh = p.face.leading;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: p.align === 'center' ? 'center' : 'flex-start', ...p.style }}>
      {p.fit.lines.map((line, i) => (
        <Line
          key={i}
          text={line}
          size={p.fit.size}
          face={p.face}
          bold={p.bold}
          color={p.lineColor?.(i) ?? p.color}
          lh={lh}
          delay={p.delay + i * p.stagger}
          mode={mode}
          align={p.align}
          shadow={p.shadow}
          travel={theme.motion.travel * box.u}
          slower={p.slower}
        />
      ))}
    </div>
  );
}

function Line(p: { text: string; size: number; face: TypeFace; bold?: boolean; color: string; lh: number; delay: number; mode: RevealMode; align?: 'start' | 'center'; shadow?: string; travel: number; slower?: number }) {
  const pr = useEnter(p.delay, p.slower);
  const text: CSSProperties = {
    fontFamily: p.face.family,
    fontWeight: p.bold ? p.face.strong : p.face.weight,
    fontSize: p.size,
    lineHeight: `${p.size * p.lh}px`,
    letterSpacing: p.face.tracking ? `${p.face.tracking}em` : undefined,
    textTransform: p.face.upper ? 'uppercase' : undefined,
    color: p.color,
    whiteSpace: 'nowrap',
    textShadow: p.shadow,
    textAlign: p.align === 'center' ? 'center' : 'start',
  };
  if (p.mode === 'mask') {
    const pad = p.size * 0.28;
    return (
      <div style={{ overflow: 'hidden', paddingTop: pad, paddingBottom: pad, marginTop: -pad, marginBottom: -pad, paddingInline: pad * 0.4, marginInline: -pad * 0.4 }}>
        <div style={{ ...text, transform: `translateY(${(1 - pr) * 115}%)`, opacity: Math.min(1, pr * 2) }}>{p.text}</div>
      </div>
    );
  }
  return <div style={{ ...text, ...revealStyle(p.mode, pr, p.travel * 0.6) }}>{p.text}</div>;
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
 * same picture and only the scene's content appears to change.
 */
export function Backdrop(p: { plain?: boolean; intensity?: number }) {
  const { theme: th, box, start, index, count, total, video } = useScene();
  const frame = useCurrentFrame();
  const t = start + frame;
  const { width: W, height: H, u } = box;
  const k = p.intensity ?? 1;
  const s = (period: number, phase = 0) => Math.sin((t / period) * Math.PI * 2 + phase);
  const layers: ReactNode[] = [];
  const angle = 155 + s(900) * 18;
  const ground: CSSProperties = { background: `linear-gradient(${angle.toFixed(2)}deg, ${th.bg} 0%, ${th.bg2} 100%)` };
  const big = Math.max(W, H);

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
      const num = String(index + 1).padStart(2, '0');
      const ns = (box.format === 'portrait' ? 520 : 600) * u;
      layers.push(
        <div key="num" style={{ position: 'absolute', [th.rtl ? 'left' : 'right']: -ns * 0.06, bottom: -ns * 0.2, fontFamily: "'Anton', 'Noto Kufi Arabic', sans-serif", fontWeight: 400, fontSize: ns, lineHeight: `${ns}px`, color: 'transparent', WebkitTextStroke: `${Math.max(1, 2.5 * u)}px ${alpha(th.fg, 0.12)}`, direction: 'ltr', whiteSpace: 'nowrap' }}>{num}</div>,
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
      const played = Math.min(1, t / Math.max(1, total - 1));
      layers.push(
        <div key="r1" style={{ position: 'absolute', left: box.x, top: y1, width: box.w, height: line, background: alpha(th.fg, 0.14) }} />,
        <div key="r2" style={{ position: 'absolute', left: box.x, top: y2, width: box.w, height: line, background: alpha(th.fg, 0.14) }} />,
        <div key="r3" style={{ position: 'absolute', [th.rtl ? 'right' : 'left']: box.x, top: y2 - line, width: box.w * played, height: line * 3, background: th.accent }} />,
        <div key="n" style={{ ...label, [th.rtl ? 'right' : 'left']: box.x, direction: 'ltr' }}>{`${String(index + 1).padStart(2, '0')} / ${String(count).padStart(2, '0')}`}</div>,
      );
      if (video.brand?.name) {
        layers.push(<div key="b" style={{ ...label, [th.rtl ? 'left' : 'right']: box.x }}>{video.brand.name}</div>);
      }
      break;
    }
    case 'sun': {
      const sun = Math.min(W, H) * (box.format === 'landscape' ? 0.62 : 0.5);
      const rise = s(900) * 30 * u;
      // The sun sits in the far corner on the end side, where words rarely are.
      const sx = th.rtl ? W * 0.12 : W * 0.88;
      const sy = box.format === 'portrait' ? H * 0.08 : H * 0.14;
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
      {p.plain ? null : layers}
      {th.grain > 0 ? <Grain opacity={th.grain} width={W} height={H} t={t} dark={th.dark} /> : null}
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// Pictures

/**
 * A picture filling its box, moving slowly: zooming in or out and drifting
 * in one of four directions, chosen by the scene's index so consecutive
 * pictures do not all move the same way.
 */
export function Photo(p: { src: string; seed: number; frames: number; style?: CSSProperties; strength?: number }) {
  const frame = useCurrentFrame();
  const t = Math.max(0, Math.min(1, frame / Math.max(1, p.frames)));
  const k = p.strength ?? 1;
  const zoomIn = p.seed % 2 === 0;
  const scale = zoomIn ? 1.06 + 0.12 * t * k : 1.18 - 0.12 * t * k;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const [dx, dy] = dirs[p.seed % 4];
  const pan = 2.4 * (t - 0.5) * k;
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', overflow: 'hidden', ...p.style }}>
      <Img src={p.src} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale.toFixed(4)}) translate(${(dx * pan).toFixed(3)}%, ${(dy * pan).toFixed(3)}%)` }} />
    </div>
  );
}

/**
 * Words over a picture are always light on a darkened picture, whatever the
 * style — a light scrim over a photograph looks washed out.
 */
export function onPhoto(theme: Theme): Theme {
  const ink = '#FFFFFF';
  const dark = '#0B0B0E';
  return {
    ...theme,
    fg: ink,
    muted: 'rgba(255, 255, 255, 0.82)',
    accentText: contrast(theme.accent, dark) >= 3 ? theme.accent : ink,
    dark: true,
  };
}

/** A darkening gradient over a picture, towards the side the words are on. */
export function Scrim(p: { theme: Theme; to: 'bottom' | 'top' | 'start' | 'all'; strength?: number }) {
  const base = p.theme.dark ? mix(p.theme.bg, '#000000', 0.3) : mix(p.theme.fg, '#000000', 0.5);
  const k = p.strength ?? 1;
  const dir = p.to === 'bottom' ? 180 : p.to === 'top' ? 0 : p.to === 'start' ? (p.theme.rtl ? 90 : 270) : 180;
  const bg = p.to === 'all'
    ? `linear-gradient(180deg, ${alpha(base, 0.55 * k)} 0%, ${alpha(base, 0.45 * k)} 50%, ${alpha(base, 0.75 * k)} 100%)`
    : `linear-gradient(${dir}deg, ${alpha(base, 0.05 * k)} 0%, ${alpha(base, 0.35 * k)} 45%, ${alpha(base, 0.9 * k)} 100%)`;
  return <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', background: bg }} />;
}

/** The brand's logo, kept in proportion within a height. */
export function Logo(p: { src: string; height: number; maxWidth: number; style?: CSSProperties }) {
  return <Img src={p.src} style={{ height: p.height, width: 'auto', maxWidth: p.maxWidth, objectFit: 'contain', ...p.style }} />;
}

/** A short accent line that grows from the start side. */
export function Rule(p: { width: number; height: number; color: string; p: number; center?: boolean; style?: CSSProperties }) {
  const { theme } = useScene();
  const w = Math.max(0, p.width * Math.min(1, p.p));
  return (
    <div style={{ width: p.width, height: p.height, display: 'flex', justifyContent: p.center ? 'center' : 'flex-start', ...p.style }}>
      <div style={{ width: w, height: p.height, background: p.color, borderRadius: theme.radius > 0 ? p.height / 2 : 0 }} />
    </div>
  );
}
