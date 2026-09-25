/**
 * The six scene kinds that came after the first ten — a montage of pictures,
 * a timeline, a comparison, real people, the logo, a QR code — and
 * `SceneBody`, which draws a scene of any kind.
 *
 * They keep the first ten's rules (videoscenebits.tsx): no z-index, filters,
 * blend modes or perspective; every line of words fitted here and drawn as
 * one line that does not wrap; right to left mirrored by `direction`, never
 * by hand-flipped text; pictures only through `<Img>` with `object-fit`.
 * Soft round light is an SVG radial gradient, and the QR code is one SVG path
 * in a placed wrapper, sized by its own width and height only.
 */

import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Easing, Img, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CompareScene, Format, GalleryScene, LogoScene, PeopleScene, Picture, QrScene, Scene, TimelineScene } from './videotypes';
import { alpha, contrast, localDigits, mix } from './videotheme';
import type { Numerals, Theme, TypeFace } from './videotheme';
import {
  Backdrop, Blob, Lines, Logo, Photo, Rule, SceneProvider, enterAt, glowOf, onPhoto, progress, revealOf, revealStyle, ShineText, staggerFor, textStyle, useEnter, useNaturalSize, useScene,
} from './videoscenebits';
import type { SceneInfo } from './videoscenebits';
import { Stage, firstKindView, fit, per } from './videoscenekinds';
import { qrModules, qrPath } from './videoqr';

// ---------------------------------------------------------------------------
// Shared

interface Rect { x: number; y: number; w: number; h: number }

/** The same rectangle seen in a mirror across `area` — the start side is the right in Arabic and Kurdish. */
const mirror = (r: Rect, area: Rect): Rect => ({ ...r, x: area.x + area.w - (r.x - area.x) - r.w });

/** A date as the video writes numbers: "1992" in Arabic-Indic digits when the video uses them. */
function dateIn(when: string, digits: Numerals): string {
  return localDigits(when.trim(), digits);
}

/** Corner radius for a card in a style, never rounder than `max` units. */
const radiusOf = (th: Theme, u: number, max = 32) => Math.min(th.radius, max) * u;

// ---------------------------------------------------------------------------
// Gallery

/**
 * Tiles for a montage of `n` pictures inside `a`, `g` apart: one large tile
 * and the rest around it, arranged for the frame's shape — side by side in a
 * wide frame, stacked in a tall one, a staggered grid in a square.
 */
function mosaic(n: number, format: Format, a: Rect, g: number): Rect[] {
  const { x, y, w, h } = a;
  if (n <= 1) return [a];
  if (n === 2) {
    if (format === 'portrait') {
      const h1 = (h - g) * 0.56;
      return [{ x, y, w, h: h1 }, { x, y: y + h1 + g, w, h: h - h1 - g }];
    }
    const w1 = (w - g) * (format === 'landscape' ? 0.58 : 0.5);
    return [{ x, y, w: w1, h }, { x: x + w1 + g, y, w: w - w1 - g, h }];
  }
  if (n === 3) {
    if (format === 'portrait') {
      const h1 = (h - g) * 0.52;
      const w2 = (w - g) / 2;
      return [{ x, y, w, h: h1 }, { x, y: y + h1 + g, w: w2, h: h - h1 - g }, { x: x + w2 + g, y: y + h1 + g, w: w - w2 - g, h: h - h1 - g }];
    }
    const w1 = (w - g) * (format === 'landscape' ? 0.6 : 0.56);
    const h2 = (h - g) / 2;
    return [{ x, y, w: w1, h }, { x: x + w1 + g, y, w: w - w1 - g, h: h2 }, { x: x + w1 + g, y: y + h2 + g, w: w - w1 - g, h: h - h2 - g }];
  }
  if (format === 'portrait') {
    const h1 = (h - 2 * g) * 0.4;
    const h2 = (h - 2 * g) * 0.3;
    const w2 = (w - g) / 2;
    return [
      { x, y, w, h: h1 },
      { x, y: y + h1 + g, w: w2, h: h2 }, { x: x + w2 + g, y: y + h1 + g, w: w - w2 - g, h: h2 },
      { x, y: y + h1 + h2 + 2 * g, w, h: h - h1 - h2 - 2 * g },
    ];
  }
  if (format === 'landscape') {
    const w1 = (w - g) * 0.5;
    const x2 = x + w1 + g;
    const w2 = w - w1 - g;
    const hTop = (h - g) * 0.55;
    const half = (w2 - g) / 2;
    return [
      { x, y, w: w1, h },
      { x: x2, y, w: w2, h: hTop },
      { x: x2, y: y + hTop + g, w: half, h: h - hTop - g }, { x: x2 + half + g, y: y + hTop + g, w: w2 - half - g, h: h - hTop - g },
    ];
  }
  const w1 = (w - g) / 2;
  const hA = (h - g) * 0.58;
  const hB = (h - g) * 0.42;
  return [
    { x, y, w: w1, h: hA }, { x: x + w1 + g, y, w: w - w1 - g, h: hB },
    { x, y: y + hA + g, w: w1, h: h - hA - g }, { x: x + w1 + g, y: y + hB + g, w: w - w1 - g, h: h - hB - g },
  ];
}

/** How far the montage sits from the frame's edge and how wide its seams are, in units, per style. */
const MONTAGE: Readonly<Record<Theme['style'], { margin: number; gap: number }>> = {
  modern: { margin: 28, gap: 14 },
  bold: { margin: 0, gap: 10 },
  elegant: { margin: 70, gap: 16 },
  neon: { margin: 40, gap: 20 },
  minimal: { margin: 64, gap: 24 },
  warm: { margin: 36, gap: 20 },
};

/**
 * A tile without a picture: the style's colours, its number set large in
 * outline and a quiet ring — so a montage whose pictures have not been
 * chosen yet still reads as designed, and says how many it is waiting for.
 */
function EmptyTile({ th, i, r }: { th: Theme; i: number; r: Rect }) {
  const { box, frames, digits } = useScene();
  const frame = useCurrentFrame();
  const u = box.u;
  const s = Math.min(r.w, r.h);
  const t = frame / Math.max(1, frames);
  const num = localDigits(String(i + 1).padStart(2, '0'), digits);
  const size = s * 0.5;
  // Bold alternates its accent with its dark ground; the others blend their two accents.
  const ground = th.style === 'bold'
    ? (i % 3 === 0 ? th.accent : i % 3 === 1 ? th.surface : mix(th.accent2, th.bg, 0.2))
    : `linear-gradient(${135 + i * 40}deg, ${mix(th.accent, th.bg, 0.12 + 0.2 * (i % 3))} 0%, ${mix(th.accent2, th.bg, 0.35 + 0.15 * (i % 2))} 100%)`;
  const ink = th.style === 'bold' && i % 3 === 1 ? th.accent : th.onAccent;
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', overflow: 'hidden', background: ground }}>
      <div style={{ position: 'absolute', left: r.w * (i % 2 ? 0.2 : 0.62) - s * 0.4, top: r.h * 0.42 - s * 0.4, width: s * 0.8, height: s * 0.8, borderRadius: '50%', border: `${Math.max(1, 2.5 * u)}px solid ${alpha(ink, 0.2)}`, transform: `scale(${1 + 0.1 * t})` }} />
      <div style={{ position: 'absolute', [th.rtl ? 'left' : 'right']: s * 0.08, bottom: -size * 0.12, fontFamily: th.display.family, fontWeight: th.display.weight, fontSize: size, lineHeight: `${size}px`, color: 'transparent', WebkitTextStroke: `${Math.max(1, 2.5 * u)}px ${alpha(ink, 0.35)}`, whiteSpace: 'nowrap', direction: 'ltr', transform: `translateY(${(1 - t) * 20 * u}px)` }}>{num}</div>
    </div>
  );
}

function GalleryView({ scene }: { scene: GalleryScene }) {
  const { theme: th0, box, frames, index } = useScene();
  const frame = useCurrentFrame();
  const u = box.u;
  const W = box.width;
  const H = box.height;
  const pics: Picture[] = (scene.pictures ?? []).filter((p) => !!p?.src).slice(0, 4);
  const n = pics.length || Math.min(4, Math.max(3, scene.imageQueries?.length ?? 0));
  const th = onPhoto(th0);
  const look = MONTAGE[th0.style] ?? MONTAGE.modern;
  const m = look.margin * u;
  const g = look.gap * u;
  const area: Rect = { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
  const tiles = mosaic(n, box.format, area, g).map((r) => (th0.rtl ? mirror(r, area) : r));
  const r = radiusOf(th0, u, 28);
  const st = Math.max(3, Math.min(8, frames * 0.1));
  const heading = (scene.heading ?? '').trim();
  const headFit = heading ? fit(heading, th.display, { max: per({ landscape: 100, portrait: 96, square: 78 }), min: 40 * u, width: box.w * (box.format === 'landscape' ? 0.62 : 0.92), height: box.h * 0.3, lines: 3 }) : null;
  const headH = headFit ? headFit.lines.length * headFit.size * th.display.leading : 0;
  const barP = useEnter(10 + n * st);
  // The montage settles in, then keeps breathing a little closer.
  const drift = 1 + 0.025 * progress(frame, 0, frames, Easing.inOut(Easing.sin));
  const tileStyle = (i: number): CSSProperties => {
    const d = 2 + i * st;
    const p = progress(frame, d, d + 20, Easing.bezier(0.7, 0, 0.2, 1));
    const base: CSSProperties = { position: 'absolute', left: tiles[i].x, top: tiles[i].y, width: tiles[i].w, height: tiles[i].h, overflow: 'hidden', borderRadius: r, background: th0.surface };
    if (th0.style === 'neon') Object.assign(base, { border: `${Math.max(1, 2 * u)}px solid ${alpha(i % 2 ? th0.accent2 : th0.accent, 0.85)}`, boxShadow: `0 0 ${22 * u}px ${alpha(i % 2 ? th0.accent2 : th0.accent, 0.55)}` });
    if (th0.style === 'elegant') Object.assign(base, { border: `${Math.max(1, 1.5 * u)}px solid ${alpha(th0.accent, 0.7)}` });
    if (th0.style === 'bold') {
      // Bold slams its tiles in from alternate sides.
      const dir = i % 2 === 0 ? -1 : 1;
      return { ...base, transform: `translateX(${(1 - p) * dir * W * 0.35}px)`, opacity: p > 0 ? 1 : 0 };
    }
    // The others open each tile like a shutter, from a side that turns with the tile.
    const hide = ((1 - p) * 100).toFixed(2);
    const sides = [`0% ${hide}% 0% 0%`, `0% 0% ${hide}% 0%`, `0% 0% 0% ${hide}%`, `${hide}% 0% 0% 0%`];
    const side = sides[(i + (th0.rtl ? 2 : 0)) % 4];
    return { ...base, clipPath: `inset(${side} round ${r.toFixed(1)}px)`, opacity: p > 0 ? 1 : 0 };
  };
  const inner = (i: number): CSSProperties => {
    const d = 2 + i * st;
    const p = progress(frame, d, d + 26, Easing.out(Easing.cubic));
    return { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', transform: `scale(${(1.14 - 0.14 * p).toFixed(4)})` };
  };
  const headTop = H - box.bottom - headH;
  return (
    <AbsoluteFill style={{ direction: th0.rtl ? 'rtl' : 'ltr', background: th0.bg, overflow: 'hidden' }}>
      <Backdrop plain />
      <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, transform: `scale(${drift.toFixed(4)})` }}>
        {tiles.map((t, i) => (
          <div key={i} style={tileStyle(i)}>
            <div style={inner(i)}>
              {pics[i] ? <Photo src={pics[i].src} seed={index * 3 + i * 2 + 1} frames={frames} strength={0.8} /> : <EmptyTile th={th0} i={i} r={t} />}
            </div>
          </div>
        ))}
      </div>
      {headFit ? (
        <>
          <div style={{ position: 'absolute', left: 0, top: Math.max(0, headTop - 260 * u), width: W, height: H - Math.max(0, headTop - 260 * u), background: `linear-gradient(180deg, rgba(8, 8, 12, 0) 0%, rgba(8, 8, 12, 0.55) 45%, rgba(8, 8, 12, 0.78) 100%)` }} />
          <div style={{ position: 'absolute', [th0.rtl ? 'right' : 'left']: box.x, top: headTop, display: 'flex', flexDirection: 'row', alignItems: 'stretch', gap: 28 * u }}>
            <div style={{ width: Math.max(4, 9 * u), height: headH, background: th0.accent, transform: `scaleY(${Math.min(1, barP)})`, borderRadius: th0.radius ? 5 * u : 0, boxShadow: th0.style === 'neon' ? `0 0 ${18 * u}px ${th0.accent}` : undefined }} />
            <Lines fit={headFit} face={th.display} color={th.fg} delay={10 + n * st} stagger={th.motion.stagger * 1.5} shadow={glowOf(th0, u)} />
          </div>
        </>
      ) : null}
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// Timeline

function TimelineDot(p: { th: Theme; size: number; on: number }) {
  const { th, size } = p;
  const { box } = useScene();
  const u = box.u;
  const on = Math.max(0, Math.min(1.2, p.on));
  const shape: CSSProperties = th.style === 'elegant'
    ? { transform: `rotate(45deg) scale(${0.72 * on})` }
    : { borderRadius: th.style === 'bold' || th.style === 'minimal' ? (th.style === 'bold' ? 3 * u : 0) : '50%', transform: `scale(${on})` };
  return (
    <div style={{ width: size, height: size, position: 'relative' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, borderRadius: th.style === 'elegant' || th.style === 'bold' || th.style === 'minimal' ? 0 : '50%', background: th.bg, border: `${Math.max(2, 3 * u)}px solid ${alpha(th.fg, 0.25)}`, transform: th.style === 'elegant' ? 'rotate(45deg) scale(0.72)' : undefined }} />
      <div style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, background: th.accent, opacity: on > 0.02 ? 1 : 0, boxShadow: th.style === 'neon' ? `0 0 ${22 * u}px ${alpha(th.accent, 0.9)}` : undefined, ...shape }} />
    </div>
  );
}

function TimelineView({ scene }: { scene: TimelineScene }) {
  const { theme: th, box, frames, digits } = useScene();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = box.u;
  const events = scene.events.filter((e) => (e.when ?? '').trim() || (e.text ?? '').trim()).slice(0, 5);
  const n = Math.max(1, events.length);
  const across = box.format === 'landscape' && n > 1;
  const heading = (scene.heading ?? '').trim();
  const headFit = heading ? fit(heading, th.display, { max: per({ landscape: 84, portrait: 100, square: 70 }), min: 40 * u, width: box.w, height: box.h * 0.22, lines: 2 }) : null;
  const headH = headFit ? headFit.lines.length * headFit.size * th.display.leading : 0;
  const d0 = 6 + (headFit ? headFit.lines.length * th.motion.stagger : 0);
  const span = Math.max(24, frames * 0.5 - d0);
  const lineP = progress(frame, d0, d0 + span, Easing.inOut(Easing.cubic));
  // The line reaches each event's dot, and the event arrives with it.
  const at = (i: number) => d0 + (n === 1 ? 0 : (i / (n - 1)) * span);
  const whens = events.map((e) => dateIn(e.when ?? '', digits));
  const line = Math.max(2, (th.style === 'bold' ? 6 : 4) * u);
  const track = alpha(th.fg, 0.14);
  const glow = th.style === 'neon' ? `0 0 ${16 * u}px ${th.accent}` : undefined;
  const headBlock = headFit ? (
    <>
      <Lines fit={headFit} face={th.display} color={th.fg} delay={2} stagger={th.motion.stagger * 1.4} shadow={glowOf(th, u)} align={across && th.align === 'center' ? 'center' : 'start'} style={{ alignSelf: across && th.align === 'center' ? 'center' : 'flex-start' }} />
      <div style={{ height: per({ landscape: 90, portrait: 80, square: 50 }) }} />
    </>
  ) : null;
  const areaH = box.h - headH - (headFit ? per({ landscape: 90, portrait: 80, square: 50 }) : 0);

  if (across) {
    const col = box.w / n;
    const whenSize = Math.min(...whens.map((w) => fit(w, th.display, { max: 104 * u, min: 30 * u, width: col * 0.86, height: 160 * u, lines: 1 }).size));
    const textSize = Math.min(...events.map((e) => fit(e.text, th.body, { max: 44 * u, min: 22 * u, width: col * 0.84, height: areaH * 0.34, lines: 3, bold: true }).size));
    const dot = 34 * u;
    const whenH = whenSize * 1.25;
    const lineTop = whenH + 40 * u + dot / 2 - line / 2;
    const tipX = col / 2 + (box.w - col) * lineP;
    return (
      <Stage box={{ justifyContent: 'center' }}>
        {headBlock}
        <div style={{ position: 'relative', width: box.w }}>
          <div style={{ position: 'absolute', [th.rtl ? 'right' : 'left']: col / 2, top: lineTop, width: box.w - col, height: line, background: track, borderRadius: line }} />
          <div style={{ position: 'absolute', [th.rtl ? 'right' : 'left']: col / 2, top: lineTop, width: (box.w - col) * lineP, height: line, background: th.accent, borderRadius: line, boxShadow: glow }} />
          {lineP > 0 && lineP < 1 && th.dark ? (
            <Blob size={90 * u} color={th.accent} opacity={0.9} style={{ [th.rtl ? 'right' : 'left']: tipX - 45 * u, top: lineTop + line / 2 - 45 * u }} />
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'row' }}>
            {events.map((e, i) => {
              const on = enterAt(frame - at(i), fps, th);
              const f = fit(e.text, th.body, { max: textSize, min: textSize, width: col * 0.84, height: 999, lines: 3, bold: true });
              return (
                <div key={i} style={{ width: col, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ height: whenH, display: 'flex', alignItems: 'flex-end', ...revealStyle(revealOf(th) === 'pop' ? 'pop' : 'rise', on, 30 * u) }}>
                    <div style={{ ...textStyle(th.display, whenSize, th.accentText), lineHeight: `${whenSize * 1.2}px`, textShadow: glowOf(th, u * 0.8), direction: th.rtl ? 'rtl' : 'ltr' }}>{whens[i]}</div>
                  </div>
                  <div style={{ height: 40 * u }} />
                  <TimelineDot th={th} size={dot} on={on} />
                  <div style={{ height: 36 * u }} />
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', ...revealStyle('rise', on, 24 * u) }}>
                    {f.lines.map((l, j) => <div key={j} style={{ ...textStyle(th.body, f.size, th.fg, true), textAlign: 'center' }}>{l}</div>)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Stage>
    );
  }

  const rowH = Math.min(areaH / n, (box.format === 'portrait' ? 280 : 220) * u);
  const dot = per({ landscape: 30, portrait: 36, square: 30 });
  const textW = box.w - dot - 44 * u;
  const whenSize = Math.min(...whens.map((w) => fit(w, th.display, { max: per({ landscape: 64, portrait: 76, square: 64 }), min: 28 * u, width: textW, height: rowH * 0.46, lines: 1 }).size));
  const textSize = Math.min(...events.map((e) => fit(e.text, th.body, { max: per({ landscape: 40, portrait: 46, square: 40 }), min: 22 * u, width: textW, height: rowH * 0.46, lines: 2, bold: true }).size));
  const listH = rowH * n;
  const top = rowH / 2;
  return (
    <Stage box={{ justifyContent: 'center' }}>
      {headBlock}
      <div style={{ position: 'relative', height: listH }}>
        <div style={{ position: 'absolute', [th.rtl ? 'right' : 'left']: dot / 2 - line / 2, top, width: line, height: listH - rowH, background: track }} />
        <div style={{ position: 'absolute', [th.rtl ? 'right' : 'left']: dot / 2 - line / 2, top, width: line, height: (listH - rowH) * lineP, background: th.accent, boxShadow: glow }} />
        {events.map((e, i) => {
          const on = enterAt(frame - at(i), fps, th);
          const f = fit(e.text, th.body, { max: textSize, min: textSize, width: textW, height: 999, lines: 2, bold: true });
          return (
            <div key={i} style={{ height: rowH, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 44 * u }}>
              <TimelineDot th={th} size={dot} on={on} />
              <div style={{ display: 'flex', flexDirection: 'column', ...revealStyle('rise', on, 30 * u, 'start', th.rtl) }}>
                <div style={{ ...textStyle(th.display, whenSize, th.accentText), lineHeight: `${whenSize * 1.25}px`, textShadow: glowOf(th, u * 0.8) }}>{whens[i]}</div>
                {f.lines.map((l, j) => <div key={j} style={textStyle(th.body, f.size, th.fg, true)}>{l}</div>)}
              </div>
            </div>
          );
        })}
      </div>
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// Compare

/** The words that stand between the two sides, where the language has a short one. */
const VERSUS: Readonly<Record<string, string>> = { en: 'VS' };

function ComparePanel(p: { th: Theme; side: { title: string; points: string[] }; favoured: boolean; w: number; h: number; delay: number; from: 'start' | 'end' | 'top' | 'bottom'; pointSize: number; titleSize: number; pad: number }) {
  const { th, side, favoured } = p;
  const { box } = useScene();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = box.u;
  const e = enterAt(frame - p.delay, fps, th);
  const travel = th.motion.travel * u * 1.2;
  const dx = p.from === 'start' ? (th.rtl ? 1 : -1) : p.from === 'end' ? (th.rtl ? -1 : 1) : 0;
  const dy = p.from === 'top' ? -1 : p.from === 'bottom' ? 1 : 0;
  const pad = p.pad;
  const solid = th.style === 'bold' && favoured;
  const ink = solid ? th.onAccent : th.fg;
  const titleInk = solid ? th.onAccent : favoured ? th.accentText : th.fg;
  const r = radiusOf(th, u, 30);
  const panel: CSSProperties = (() => {
    switch (th.style) {
      case 'bold': return { background: favoured ? th.accent : th.surface };
      case 'elegant': return { border: `${Math.max(1, 1.5 * u)}px solid ${alpha(th.accent, favoured ? 0.7 : 0.3)}`, background: favoured ? alpha(th.accent, 0.07) : 'transparent' };
      case 'neon': return { border: `${Math.max(1, 2 * u)}px solid ${alpha(favoured ? th.accent : th.accent2, favoured ? 0.9 : 0.4)}`, background: alpha(favoured ? th.accent : th.accent2, 0.07), boxShadow: favoured ? `0 0 ${30 * u}px ${alpha(th.accent, 0.45)}` : undefined };
      case 'minimal': return { background: favoured ? th.surface : 'transparent', border: `${Math.max(1, 1.5 * u)}px solid ${alpha(th.fg, favoured ? 0.9 : 0.14)}` };
      case 'warm': return { background: favoured ? alpha(th.accent, 0.13) : th.surface, boxShadow: `0 ${10 * u}px ${30 * u}px ${alpha(th.fg, 0.08)}` };
      default: return { background: favoured ? alpha(th.accent, 0.16) : alpha(th.fg, 0.05), border: `${Math.max(1, 1.5 * u)}px solid ${favoured ? alpha(th.accent, 0.6) : alpha(th.fg, 0.1)}` };
    }
  })();
  const markSize = p.pointSize * 0.42;
  const titleFit = fit(side.title, th.display, { max: p.titleSize, min: Math.min(p.titleSize, 30 * u), width: p.w - 2 * pad, height: p.titleSize * 2.8, lines: 2 });
  const pointW = p.w - 2 * pad - 60 * u;
  const st = staggerFor(th, 60, Math.max(1, side.points.length), 0.5, 0);
  return (
    <div style={{ width: p.w, height: p.h, borderRadius: r, padding: pad, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden', ...panel, opacity: Math.min(1, e * 1.4), transform: `translate(${(1 - e) * dx * travel}px, ${(1 - e) * dy * travel}px)` }}>
      {side.title ? titleFit.lines.map((l, i) => <div key={i} style={{ ...textStyle(th.display, titleFit.size, titleInk), lineHeight: `${titleFit.size * th.display.leading}px`, textShadow: favoured ? glowOf(th, u) : undefined }}>{l}</div>) : null}
      {side.title && side.points.length ? <div style={{ width: 70 * u * Math.min(1, e), height: Math.max(2, 5 * u), background: solid ? th.onAccent : favoured ? th.accent : alpha(th.fg, 0.3), marginTop: 22 * u, marginBottom: 30 * u, borderRadius: th.radius ? 3 * u : 0 }} /> : null}
      {side.points.map((pt, i) => {
        const pe = enterAt(frame - p.delay - 8 - i * st, fps, th);
        const f = fit(pt, th.body, { max: p.pointSize, min: p.pointSize, width: pointW, height: 999, lines: 2, bold: true });
        const mark: CSSProperties = favoured
          ? { background: solid ? th.onAccent : th.accent, boxShadow: th.style === 'neon' ? `0 0 ${12 * u}px ${th.accent}` : undefined }
          : { border: `${Math.max(1, 2.5 * u)}px solid ${alpha(ink, 0.45)}` };
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 22 * u, marginTop: i ? p.pointSize * 0.55 : 0, ...revealStyle('rise', pe, 18 * u) }}>
            <div style={{ width: markSize, height: markSize, borderRadius: th.style === 'bold' || th.style === 'minimal' ? 0 : '50%', flexShrink: 0, boxSizing: 'border-box', ...mark }} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {f.lines.map((l, j) => <div key={j} style={textStyle(th.body, f.size, favoured ? ink : th.muted, true)}>{l}</div>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CompareView({ scene }: { scene: CompareScene }) {
  const { theme: th, box, video } = useScene();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = box.u;
  const stacked = box.format === 'portrait';
  const heading = (scene.heading ?? '').trim();
  const headFit = heading ? fit(heading, th.display, { max: per({ landscape: 84, portrait: 96, square: 64 }), min: 36 * u, width: box.w, height: box.h * 0.2, lines: 2 }) : null;
  const headH = headFit ? headFit.lines.length * headFit.size * th.display.leading : 0;
  const below = headFit ? per({ landscape: 64, portrait: 64, square: 44 }) : 0;
  const gap = per({ landscape: 100, portrait: 84, square: 64 });
  const areaH = box.h - headH - below;
  const pw = stacked ? box.w : (box.w - gap) / 2;
  const phMax = stacked ? (areaH - gap) / 2 : areaH;
  const sides = [scene.left ?? { title: '', points: [] }, scene.right ?? { title: '', points: [] }];
  const pad = per({ landscape: 56, portrait: 52, square: 40 });
  const maxPoints = Math.max(1, ...sides.map((s) => s.points.length));
  const titleMax = per({ landscape: 76, portrait: 80, square: 54 });
  const titleSize = Math.min(...sides.map((s) => (s.title ? fit(s.title, th.display, { max: titleMax, min: 30 * u, width: pw - 2 * pad, height: titleMax * th.display.leading * 2.1, lines: 2 }).size : titleMax)));
  const titleLines = Math.max(1, ...sides.map((s) => (s.title ? fit(s.title, th.display, { max: titleSize, min: titleSize, width: pw - 2 * pad, height: 9999, lines: 2 }).lines.length : 0)));
  const ruleH = 22 * u + Math.max(2, 5 * u) + 30 * u;
  const titleBlock = titleLines * titleSize * th.display.leading + ruleH;
  const pointMax = per({ landscape: 46, portrait: 48, square: 36 });
  // The largest size at which the fuller side's points, one line each, fit under its title.
  const room = phMax - 2 * pad - titleBlock;
  const sizeCap = Math.max(20 * u, Math.min(pointMax, room / (maxPoints * th.body.leading + (maxPoints - 1) * 0.55)));
  const pointSize = Math.min(sizeCap, ...sides.flatMap((s) => s.points).map((pt) => fit(pt, th.body, { max: sizeCap, min: 20 * u, width: pw - 2 * pad - 60 * u, height: sizeCap * th.body.leading * 1.05, lines: 2, bold: true }).size));
  // Each panel as tall as the fuller side needs — not the whole frame, which would leave them hollow.
  const contentOf = (side: { title: string; points: string[] }) => (side.title ? titleBlock : 0)
    + side.points.reduce((sum, pt, i) => sum + fit(pt, th.body, { max: pointSize, min: pointSize, width: pw - 2 * pad - 60 * u, height: 9999, lines: 2, bold: true }).lines.length * pointSize * th.body.leading + (i ? pointSize * 0.55 : 0), 0);
  const ph = Math.min(phMax, Math.max(phMax * 0.5, Math.max(...sides.map(contentOf)) + 2 * pad));
  const blockH = stacked ? 2 * ph + gap : ph;
  const d0 = 6 + (headFit ? headFit.lines.length * th.motion.stagger : 0);
  const divP = progress(frame, d0 + 4, d0 + 26, Easing.out(Easing.cubic));
  const badgeP = enterAt(frame - d0 - 14, fps, th);
  const badge = 78 * u;
  const vs = VERSUS[video.lang];
  const divLine = Math.max(2, 3 * u);
  const divColor = th.style === 'bold' ? th.accent : alpha(th.accent, 0.8);
  // The divider runs a little past the panels, so it reads as a line between them rather than an edge.
  const reach = stacked ? 0 : 50 * u;
  return (
    <Stage box={{ justifyContent: 'center', alignItems: 'stretch' }}>
      {headFit ? <Lines fit={headFit} face={th.display} color={th.fg} delay={2} stagger={th.motion.stagger * 1.4} shadow={glowOf(th, u)} align={th.align === 'center' ? 'center' : 'start'} style={{ alignSelf: th.align === 'center' ? 'center' : 'flex-start' }} /> : null}
      {headFit ? <div style={{ height: below }} /> : null}
      <div style={{ position: 'relative', width: box.w, height: blockH, display: 'flex', flexDirection: stacked ? 'column' : 'row', justifyContent: 'space-between' }}>
        <ComparePanel th={th} side={sides[0]} favoured={false} w={pw} h={ph} delay={d0} from={stacked ? 'top' : 'start'} pointSize={pointSize} titleSize={titleSize} pad={pad} />
        <ComparePanel th={th} side={sides[1]} favoured w={pw} h={ph} delay={d0 + 8} from={stacked ? 'bottom' : 'end'} pointSize={pointSize} titleSize={titleSize} pad={pad} />
        {stacked ? (
          <div style={{ position: 'absolute', left: 0, top: ph + gap / 2 - divLine / 2, width: box.w, height: divLine, background: divColor, transform: `scaleX(${divP})` }} />
        ) : (
          <div style={{ position: 'absolute', left: pw + gap / 2 - divLine / 2, top: -reach, width: divLine, height: blockH + 2 * reach, background: divColor, transform: `scaleY(${divP})` }} />
        )}
        <div style={{ position: 'absolute', left: (stacked ? box.w / 2 : pw + gap / 2) - badge / 2, top: (stacked ? ph + gap / 2 : blockH / 2) - badge / 2, width: badge, height: badge, borderRadius: th.style === 'bold' || th.style === 'minimal' ? 0 : '50%', background: th.style === 'bold' ? th.accent : th.bg, border: th.style === 'bold' ? undefined : `${Math.max(2, 3 * u)}px solid ${th.accent}`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${Math.max(0, Math.min(1.1, badgeP))}) rotate(${th.style === 'elegant' ? 45 : 0}deg)`, boxShadow: th.style === 'neon' ? `0 0 ${24 * u}px ${th.accent}` : undefined }}>
          {vs && th.style !== 'elegant'
            ? <div style={{ ...textStyle(th.display, badge * 0.34, th.style === 'bold' ? th.onAccent : th.accentText), lineHeight: `${badge * 0.4}px`, direction: 'ltr' }}>{vs}</div>
            : <div style={{ width: badge * 0.24, height: badge * 0.24, background: th.accent, transform: th.style === 'elegant' ? undefined : 'rotate(45deg)' }} />}
        </div>
      </div>
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// People

/** Titles in front of a name that a monogram leaves out: "Dr.", "د.", "پرۆفیسۆر". */
const TITLE_WORDS = new Set([
  'dr', 'prof', 'mr', 'mrs', 'ms', 'miss', 'sir', 'eng', 'professor', 'doctor',
  'د', 'دكتور', 'الدكتور', 'دكتورة', 'الدكتورة', 'أ', 'م', 'السيد', 'السيدة', 'الأستاذ', 'الاستاذ', 'الأستاذة', 'بروفيسور', 'البروفيسور', 'المهندس', 'المهندسة',
  'دکتۆر', 'پرۆفیسۆر', 'مامۆستا', 'کاک', 'خاتوو', 'خاتو', 'ئەندازیار', 'بەڕێز',
]);

/**
 * A person's monogram: the first letters of the first and last names in a
 * Latin name ("AK"); in Arabic script, the first letter of the first name
 * alone — two Arabic letters side by side would join into a word — or its
 * first syllable when it opens with the carrier ئ, which alone reads as
 * nothing ("ئە" for ئەحمەد).
 */
export function initialsOf(name: string): string {
  const words = name.replace(/[()"\u00AB\u00BB\u201C\u201D]/g, ' ').split(/\s+/).filter(Boolean);
  // "Dr.", "د.", "أ.د." — a letter or two and a full stop, however many times — is a title too.
  const real = words.filter((w) => !TITLE_WORDS.has(w.replace(/[.\u066B\u06D4]+$/, '').toLowerCase()) && !/^(?:\p{L}{1,2}[.\u06D4])+$/u.test(w));
  const list = real.length ? real : words;
  const first = list[0] ?? '';
  if (/[\u0600-\u06FF]/.test(first)) {
    let w = first.startsWith('\u0627\u0644') && Array.from(first).length > 3 ? first.slice(2) : first;
    w = w.replace(/^[^\u0620-\u064A\u066E-\u06D3\u06D5\u06FA-\u06FF]+/, '');
    const letters = Array.from(w);
    if (letters[0] === '\u0626' && letters[1]) return letters.slice(0, 2).join('');
    return letters[0] ?? '';
  }
  const at = (w: string) => (Array.from(w.replace(/^[^\p{L}]+/u, ''))[0] ?? '').toUpperCase();
  return list.length > 1 ? at(first) + at(list[list.length - 1]) : at(first);
}

/**
 * A portrait placed in its square so the face shows. The renderer has no
 * `object-position`, and `object-fit: cover` crops a tall photograph to its
 * middle — a chest, not a face. With the picture's size known it is laid out
 * by hand instead: as wide as the square, and shifted so the crop keeps the
 * upper part, where a portrait's face is. Without its size, the centre.
 */
function faceCrop(pic: Picture, s: number, zoom: number): CSSProperties {
  const w0 = Number(pic.width);
  const h0 = Number(pic.height);
  if (!(w0 > 0 && h0 > 0)) return { width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom.toFixed(4)})` };
  const aspect = h0 / w0;
  const w = aspect >= 1 ? s * zoom : (s * zoom) / aspect;
  const h = w * aspect;
  const left = (s - w) / 2;
  // A tall picture keeps its top fifth above the square; a wide one is centred.
  const top = aspect > 1 ? -(h - s) * 0.2 : (s - h) / 2;
  return { position: 'absolute', left, top, width: w, height: h, maxWidth: 'none' };
}

function Portrait(p: { person: PeopleScene['people'][number]; size: number; delay: number; seed: number }) {
  const { theme: th, box, frames } = useScene();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = box.u;
  const s = p.size;
  const e = enterAt(frame - p.delay, fps, th);
  const ringP = progress(frame, p.delay + 4, p.delay + 28, Easing.out(Easing.cubic));
  const round = th.style === 'bold' ? 22 * u : th.style === 'minimal' ? 6 * u : s / 2;
  const pic = p.person.picture?.src;
  const zoom = 1.04 + 0.08 * progress(frame, 0, frames, Easing.inOut(Easing.sin));
  const deco: ReactNode[] = [];
  const ring = (inset: number, width: number, color: string, key: string, extra?: CSSProperties) => (
    <div key={key} style={{ position: 'absolute', left: -inset, top: -inset, width: s + 2 * inset, height: s + 2 * inset, borderRadius: round === s / 2 ? '50%' : round + inset, border: `${width}px solid ${color}`, boxSizing: 'border-box', opacity: Math.min(1, ringP * 1.2), transform: `scale(${0.9 + 0.1 * ringP})`, ...extra }} />
  );
  switch (th.style) {
    case 'modern':
      deco.push(<div key="g" style={{ position: 'absolute', left: -9 * u, top: -9 * u, width: s + 18 * u, height: s + 18 * u, borderRadius: '50%', background: `linear-gradient(${140 + 60 * ringP}deg, ${th.accent} 0%, ${th.accent2} 100%)`, opacity: Math.min(1, ringP * 1.2), transform: `scale(${0.9 + 0.1 * ringP})` }} />);
      break;
    case 'elegant':
      deco.push(ring(10 * u, Math.max(1, 1.5 * u), alpha(th.accent, 0.9), 'a'), ring(22 * u, Math.max(1, 1 * u), alpha(th.accent, 0.4), 'b'));
      break;
    case 'neon':
      deco.push(ring(8 * u, Math.max(2, 4 * u), th.accent, 'a', { boxShadow: `0 0 ${26 * u}px ${alpha(th.accent, 0.8)}` }));
      break;
    case 'bold':
      deco.push(<div key="b" style={{ position: 'absolute', left: 16 * u, top: 16 * u, width: s, height: s, borderRadius: round, background: th.accent, opacity: Math.min(1, ringP * 1.5), transform: `translate(${(1 - ringP) * -16 * u}px, ${(1 - ringP) * -16 * u}px)` }} />);
      break;
    case 'warm':
      deco.push(<div key="w" style={{ position: 'absolute', left: -14 * u, top: 6 * u, width: s + 20 * u, height: s + 12 * u, borderRadius: '50%', background: alpha(th.accent2, 0.45), opacity: Math.min(1, ringP * 1.2), transform: `rotate(${-8 + 8 * ringP}deg)` }} />);
      deco.push(ring(6 * u, Math.max(2, 4 * u), th.surface, 'r'));
      break;
    default:
      deco.push(ring(0, Math.max(1, 1.5 * u), alpha(th.fg, 0.35), 'm'));
  }
  const mono = initialsOf(p.person.name);
  return (
    <div style={{ position: 'relative', width: s, height: s, flexShrink: 0, transform: `scale(${0.7 + 0.3 * Math.min(1.05, e)})`, opacity: Math.min(1, e * 1.6) }}>
      {deco}
      <div style={{ position: 'absolute', left: 0, top: 0, width: s, height: s, borderRadius: round, overflow: 'hidden', background: pic ? th.surface : `linear-gradient(${135 + p.seed * 25}deg, ${th.accent} 0%, ${mix(th.accent2, th.accent, 0.35)} 100%)` }}>
        {pic ? (
          <Img src={pic} style={faceCrop(p.person.picture!, s, zoom)} />
        ) : (
          <div style={{ position: 'absolute', left: 0, top: 0, width: s, height: s, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ ...textStyle(nameFace(th), s * (Array.from(mono).length > 1 && !/[\u0600-\u06FF]/.test(mono) ? 0.36 : 0.44), th.onAccent), textTransform: 'none', letterSpacing: undefined, lineHeight: `${s * 0.6}px`, direction: /[\u0600-\u06FF]/.test(mono) ? 'rtl' : 'ltr' }}>{mono}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The face a name is set in: the style's display face — except neon's Arabic
 * one, Reem Kufi, a geometric Kufic that runs a name's words together and
 * turns a lone letter into an ornament; names take its body face instead.
 */
function nameFace(th: Theme): TypeFace {
  return th.style === 'neon' && th.rtl ? { ...th.body, weight: th.body.strong, leading: th.display.leading } : th.display;
}

function PersonText(p: { person: PeopleScene['people'][number]; width: number; nameMax: number; delay: number; align: 'start' | 'center' }) {
  const { theme: th0, box } = useScene();
  const th = { ...th0, display: nameFace(th0) };
  const u = box.u;
  // One line when it can be one at a good size; two when the name is long.
  const one = fit(p.person.name, th.display, { max: p.nameMax, min: 26 * u, width: p.width, height: p.nameMax * th.display.leading * 1.1, lines: 1 });
  const nameFit = one.size >= p.nameMax * 0.72 ? one : fit(p.person.name, th.display, { max: p.nameMax, min: 26 * u, width: p.width, height: p.nameMax * th.display.leading * 2.1, lines: 2 });
  const role = (p.person.role ?? '').trim();
  const roleSize = Math.max(20 * u, Math.min(nameFit.size * 0.52, 34 * u));
  const roleFit = role ? fit(role, th.body, { max: roleSize, min: 18 * u, width: p.width, height: roleSize * 3.4, lines: 2, bold: true }) : null;
  const e = useEnter(p.delay);
  const latin = !th.rtl;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: p.align === 'center' ? 'center' : 'flex-start', ...revealStyle('rise', e, 24 * u) }}>
      {nameFit.lines.map((l, i) => <div key={i} style={{ ...textStyle(th.display, nameFit.size, th.fg), textAlign: p.align === 'center' ? 'center' : 'start', textShadow: glowOf(th, u * 0.7) }}>{l}</div>)}
      {roleFit ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: p.align === 'center' ? 'center' : 'flex-start', marginTop: 10 * u }}>
          {roleFit.lines.map((l, i) => (
            <div key={i} style={{ ...textStyle(th.body, roleFit.size, th.accentText, true), textAlign: p.align === 'center' ? 'center' : 'start', letterSpacing: latin ? '0.08em' : undefined, textTransform: latin ? 'uppercase' : undefined }}>{l}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PeopleView({ scene }: { scene: PeopleScene }) {
  const { theme: th, box, frames } = useScene();
  const u = box.u;
  const people = scene.people.filter((p) => (p.name ?? '').trim()).slice(0, 4);
  const n = Math.max(1, people.length);
  const heading = (scene.heading ?? '').trim();
  const headFit = heading ? fit(heading, th.display, { max: per({ landscape: 80, portrait: 96, square: 64 }), min: 36 * u, width: box.w, height: box.h * 0.2, lines: 2 }) : null;
  const headH = headFit ? headFit.lines.length * headFit.size * th.display.leading : 0;
  const below = headFit ? per({ landscape: 70, portrait: 80, square: 44 }) : 0;
  const areaH = box.h - headH - below;
  const st = staggerFor(th, frames, n, 0.4, 6);
  const d0 = 4 + (headFit ? headFit.lines.length * th.motion.stagger : 0);
  const center = th.align === 'center';
  const head = headFit ? (
    <>
      <Lines fit={headFit} face={th.display} color={th.fg} delay={2} stagger={th.motion.stagger * 1.4} shadow={glowOf(th, u)} align={center ? 'center' : 'start'} style={{ alignSelf: center ? 'center' : 'flex-start' }} />
      <div style={{ height: below }} />
    </>
  ) : null;
  const format = box.format;
  // One person: a feature — the portrait large, the name beside it (wide) or under it.
  if (n === 1) {
    const person = people[0] ?? { name: '' };
    if (format === 'landscape') {
      const s = Math.min(areaH * 0.92, 520 * u);
      const textW = box.w - s - 110 * u;
      return (
        <Stage box={{ justifyContent: 'center' }}>
          {head}
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 110 * u, height: areaH }}>
            <Portrait person={person} size={s} delay={d0} seed={0} />
            <PersonText person={person} width={textW} nameMax={110 * u} delay={d0 + 10} align="start" />
          </div>
        </Stage>
      );
    }
    const s = Math.min(areaH * 0.58, (format === 'portrait' ? 600 : 420) * u, box.w * 0.8);
    return (
      <Stage box={{ justifyContent: 'center', alignItems: 'center' }}>
        {head}
        <Portrait person={person} size={s} delay={d0} seed={0} />
        <div style={{ height: 56 * u }} />
        <PersonText person={person} width={box.w} nameMax={per({ landscape: 96, portrait: 96, square: 70 })} delay={d0 + 10} align="center" />
      </Stage>
    );
  }
  // A tall frame lists them, each portrait beside its name.
  if (format === 'portrait') {
    const rowH = areaH / n;
    const s = Math.min(rowH * 0.8, (n === 2 ? 340 : n === 3 ? 270 : 220) * u);
    const textW = box.w - s - 56 * u;
    return (
      <Stage box={{ justifyContent: 'center' }}>
        {head}
        <div style={{ display: 'flex', flexDirection: 'column', height: areaH, justifyContent: 'space-evenly' }}>
          {people.map((person, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 56 * u }}>
              <Portrait person={person} size={s} delay={d0 + i * st} seed={i} />
              <PersonText person={person} width={textW} nameMax={per({ landscape: 60, portrait: 62, square: 48 })} delay={d0 + i * st + 8} align="start" />
            </div>
          ))}
        </div>
      </Stage>
    );
  }
  // Wide and square frames: a row, or two rows of two in a square.
  const grid = format === 'square' && n === 4;
  const cols = grid ? 2 : n;
  const rows = grid ? 2 : 1;
  const cellW = box.w / cols;
  const cellH = areaH / rows;
  const nameMax = per({ landscape: n > 3 ? 44 : 52, portrait: 52, square: n > 2 ? 38 : 44 });
  const textH = nameMax * th.display.leading * 1.3 + 70 * u;
  const s = Math.min(cellW * 0.8, cellH - textH - 40 * u, (format === 'landscape' ? 380 : 320) * u);
  return (
    <Stage box={{ justifyContent: 'center' }}>
      {head}
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', width: box.w, height: areaH, alignContent: 'center' }}>
        {people.map((person, i) => (
          <div key={i} style={{ width: cellW, height: grid ? cellH : undefined, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <Portrait person={person} size={s} delay={d0 + i * st} seed={i} />
            <div style={{ height: 34 * u }} />
            <PersonText person={person} width={cellW * 0.9} nameMax={nameMax} delay={d0 + i * st + 8} align="center" />
          </div>
        ))}
      </div>
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// Logo

/** Four corner marks that close in on the logo like a viewfinder, then rest. */
function Brackets(p: { w: number; h: number; color: string; p: number; thick: number; arm: number }) {
  const far = (1 - p.p) * 120;
  const c = (x: number, y: number, key: string) => {
    const sx = x < 0 ? -1 : 1;
    const sy = y < 0 ? -1 : 1;
    const left = x < 0 ? -far - p.thick : p.w + far - p.arm + p.thick;
    const top = y < 0 ? -far - p.thick : p.h + far - p.arm + p.thick;
    return (
      <div key={key} style={{ position: 'absolute', left, top, width: p.arm, height: p.arm, opacity: Math.min(1, p.p * 1.5) }}>
        <div style={{ position: 'absolute', left: sx < 0 ? 0 : p.arm - p.thick, top: 0, width: p.thick, height: p.arm, background: p.color }} />
        <div style={{ position: 'absolute', left: 0, top: sy < 0 ? 0 : p.arm - p.thick, width: p.arm, height: p.thick, background: p.color }} />
      </div>
    );
  };
  return <>{c(-1, -1, 'tl')}{c(1, -1, 'tr')}{c(-1, 1, 'bl')}{c(1, 1, 'br')}</>;
}

function LogoView({ scene }: { scene: LogoScene }) {
  const { theme: th, box, frames, video } = useScene();
  const frame = useCurrentFrame();
  const u = box.u;
  const W = box.width;
  const H = box.height;
  const logo = video.brand?.logo;
  const natural = useNaturalSize(logo);
  const name = (video.brand?.name ?? '').trim() || (video.title ?? '').trim();
  const tagline = (scene.tagline ?? '').trim();
  const open = progress(frame, 4, 30, Easing.bezier(0.7, 0, 0.2, 1));
  const settle = progress(frame, 4, 44, Easing.out(Easing.cubic));
  const bracketP = progress(frame, 0, 28, Easing.out(Easing.cubic));
  const tagP = useEnter(30);
  const ruleP = progress(frame, 26, 50, Easing.out(Easing.cubic));
  const breathe = 1 + 0.03 * progress(frame, 30, frames, Easing.inOut(Easing.sin));
  // The logo as large as the frame allows in its own proportions: a tall mark by its height, a long one by its width.
  const maxH = per({ landscape: 320, portrait: 340, square: 280 });
  const maxW = box.w * (box.format === 'portrait' ? 0.86 : 0.7);
  const aspect = natural ? natural.w / Math.max(1, natural.h) : 1;
  const logoH = Math.min(maxH, maxW / aspect);
  const logoW = logoH * aspect;
  // The wordmark, when there is no logo: the name as large as it fits, on one or two lines.
  const wordFit = !logo ? fit(name, th.display, { max: per({ landscape: 190, portrait: 150, square: 140 }), min: 50 * u, width: box.w * 0.9, height: box.h * 0.42, lines: 2 }) : null;
  const tagFit = tagline ? fit(tagline, th.body, { max: per({ landscape: 46, portrait: 46, square: 38 }), min: 24 * u, width: box.w * 0.8, height: 140 * u, lines: 2 }) : null;
  const markW = logo ? logoW : wordFit?.width ?? 0;
  const markH = logo ? logoH : wordFit ? wordFit.lines.length * wordFit.size * th.display.leading : 0;
  const glowSize = Math.max(W, H) * 0.9;
  // A glint of light that crosses the mark once it has landed, in the direction the language reads.
  const glintT = progress(frame, 34, 64, Easing.inOut(Easing.cubic));
  const glintX = th.rtl ? markW * (1.1 - 1.4 * glintT) : markW * (-0.3 + 1.4 * glintT);
  const glint = glintT > 0 && glintT < 1 ? Math.sin(glintT * Math.PI) : 0;
  const padX = 70 * u;
  const padY = 56 * u;
  return (
    <AbsoluteFill style={{ direction: th.rtl ? 'rtl' : 'ltr', background: th.bg, overflow: 'hidden' }}>
      <Backdrop intensity={0.7} />
      <Blob size={glowSize} color={th.accent} opacity={(th.dark ? 0.34 : 0.24) * settle} style={{ left: W / 2 - glowSize / 2, top: H / 2 - glowSize / 2 - (tagFit ? 40 * u : 0), transform: `scale(${0.6 + 0.4 * settle})` }} />
      <div style={{ position: 'absolute', left: 0, top: box.top, width: W, height: box.h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', transform: `scale(${breathe.toFixed(4)})` }}>
        <div style={{ position: 'relative', width: markW, height: markH, direction: 'ltr' }}>
          {th.style !== 'minimal' ? (
            <div style={{ position: 'absolute', left: -padX, top: -padY, width: markW + 2 * padX, height: markH + 2 * padY }}>
              <Brackets w={markW + 2 * padX} h={markH + 2 * padY} color={alpha(th.accent, 0.85)} p={bracketP} thick={Math.max(2, 4 * u)} arm={Math.min(54 * u, (markH + 2 * padY) * 0.3)} />
            </div>
          ) : null}
          {logo ? (
            <div style={{ position: 'absolute', left: 0, top: 0, width: logoW, height: logoH, clipPath: `circle(${(open * 75).toFixed(2)}% at 50% 50%)`, transform: `scale(${(1.12 - 0.12 * settle).toFixed(4)})`, opacity: Math.min(1, open * 2) }}>
              <Img src={logo} style={{ width: logoW, height: logoH, objectFit: 'contain' }} />
            </div>
          ) : wordFit ? (
            <div style={{ position: 'absolute', left: 0, top: 0, width: markW, display: 'flex', flexDirection: 'column', alignItems: 'center', direction: th.rtl ? 'rtl' : 'ltr', clipPath: `inset(-20% ${((1 - open) * 50).toFixed(2)}% -20% ${((1 - open) * 50).toFixed(2)}%)`, transform: `scale(${(1.06 - 0.06 * settle).toFixed(4)})` }}>
              {wordFit.lines.map((l, i) => (
                <ShineText key={i} text={l} color={th.fg} sheenAt={36 + i * 3} style={{ ...textStyle(th.display, wordFit.size, th.fg), textShadow: glowOf(th, u * 1.3), textAlign: 'center' }} />
              ))}
            </div>
          ) : null}
          {logo && glint > 0 ? (
            <Blob size={markH * 0.9} color="#FFFFFF" opacity={0.42 * glint} style={{ left: glintX - markH * 0.45, top: markH * 0.05 }} />
          ) : null}
        </div>
        {tagFit ? (
          <>
            <Rule width={140 * u} height={Math.max(3, 5 * u)} color={th.accent} p={ruleP} center style={{ marginTop: 84 * u, marginBottom: 34 * u }} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', ...revealStyle('rise', tagP, 24 * u) }}>
              {tagFit.lines.map((l, i) => <div key={i} style={{ ...textStyle(th.body, tagFit.size, th.muted), textAlign: 'center' }}>{l}</div>)}
            </div>
          </>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// QR code

/** Modules on a white card read by every phone: the style's darkest ink, or black when it is not dark enough. */
function moduleInk(th: Theme): string {
  const candidates = [th.dark ? th.bg : th.fg, '#0B0B0E'];
  return candidates.find((c) => /^#[0-9a-f]{6}$/i.test(c) && contrast(c, '#FFFFFF') >= 12) ?? '#000000';
}

function QrCard(p: { url: string; size: number; delay: number }) {
  const { theme: th, box, video } = useScene();
  const frame = useCurrentFrame();
  const u = box.u;
  const logo = video.brand?.logo;
  const m = qrModules(p.url, !!logo);
  const pop = progress(frame, p.delay, p.delay + 16, Easing.out(Easing.back(1.4)));
  const scan = progress(frame, p.delay + 6, p.delay + 34, Easing.inOut(Easing.cubic));
  const bracketP = progress(frame, p.delay + 20, p.delay + 42, Easing.out(Easing.cubic));
  const r = Math.min(radiusOf(th, u, 28), 28 * u);
  const ink = moduleInk(th);
  if (!m) {
    // No address yet (a scene added by hand): an empty card that says where the code goes.
    return (
      <div style={{ width: p.size, height: p.size, borderRadius: r, border: `${Math.max(2, 4 * u)}px dashed ${alpha(th.fg, 0.35)}`, boxSizing: 'border-box', opacity: Math.min(1, pop * 1.5) }} />
    );
  }
  // At least four modules of quiet white around the code, and whole pixels per module.
  const cell = Math.max(2, Math.floor(p.size / (m.size + 8)));
  const codePx = cell * m.size;
  const card = codePx + cell * 8;
  const hole = logo ? Math.round(m.size * 0.22) | 1 : 0;
  const from = Math.floor((m.size - hole) / 2);
  const d = qrPath(m, logo ? { from, to: from + hole } : undefined);
  const scanY = cell * 4 + codePx * scan;
  return (
    <div style={{ position: 'relative', width: card, height: card, transform: `scale(${(0.86 + 0.14 * pop).toFixed(4)})`, opacity: Math.min(1, pop * 1.4) }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: card, height: card, borderRadius: r, background: '#FFFFFF', boxShadow: th.style === 'neon' ? `0 0 ${40 * u}px ${alpha(th.accent, 0.6)}` : th.dark ? undefined : `0 ${16 * u}px ${40 * u}px ${alpha(th.fg, 0.16)}` }} />
      <div style={{ position: 'absolute', left: cell * 4, top: cell * 4, width: codePx, height: codePx, clipPath: `inset(0% 0% ${((1 - scan) * 100).toFixed(2)}% 0%)` }}>
        <svg width={codePx} height={codePx} viewBox={`0 0 ${m.size} ${m.size}`} shapeRendering="crispEdges" style={{ display: 'block', width: codePx, height: codePx }}>
          <path d={d} fill={ink} />
        </svg>
      </div>
      {logo ? (
        <div style={{ position: 'absolute', left: cell * (4 + from), top: cell * (4 + from), width: cell * hole, height: cell * hole, borderRadius: cell, background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: scan > 0.55 ? 1 : 0 }}>
          <Logo src={logo} height={cell * hole * 0.8} maxWidth={cell * hole * 0.8} />
        </div>
      ) : null}
      {scan > 0 && scan < 1 ? (
        <div style={{ position: 'absolute', left: cell * 2, top: scanY - 2 * u, width: card - cell * 4, height: Math.max(2, 4 * u), background: th.accent, borderRadius: 2 * u, boxShadow: `0 0 ${18 * u}px ${th.accent}` }} />
      ) : null}
      <div style={{ position: 'absolute', left: -34 * u, top: -34 * u, width: card + 68 * u, height: card + 68 * u }}>
        <Brackets w={card + 68 * u} h={card + 68 * u} color={th.accent} p={bracketP} thick={Math.max(3, 6 * u)} arm={56 * u} />
      </div>
    </div>
  );
}

function QrView({ scene }: { scene: QrScene }) {
  const { theme: th, box } = useScene();
  const u = box.u;
  const wide = box.format === 'landscape';
  const url = (scene.url ?? '').trim();
  const shownUrl = url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  const heading = (scene.heading ?? '').trim();
  const qrSize = per({ landscape: 560, portrait: 640, square: 480 });
  const textW = wide ? box.w - qrSize - 160 * u : box.w;
  const headFit = heading ? fit(heading, th.display, { max: per({ landscape: 96, portrait: 92, square: 64 }), min: 36 * u, width: textW, height: wide ? box.h * 0.5 : box.h * 0.2, lines: 3 }) : null;
  const urlSize = per({ landscape: 40, portrait: 42, square: 32 });
  const urlFit = shownUrl ? fit(shownUrl, th.body, { max: urlSize, min: 20 * u, width: textW, height: urlSize * 1.6, lines: 1, bold: true }) : null;
  const urlP = useEnter(16);
  const center = !wide;
  const words = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: center ? 'center' : 'flex-start', width: textW }}>
      {headFit ? <Lines fit={headFit} face={th.display} color={th.fg} delay={2} stagger={th.motion.stagger * 1.4} shadow={glowOf(th, u)} align={center ? 'center' : 'start'} /> : null}
      {urlFit ? (
        <div style={{ marginTop: (wide ? 44 : 30) * u, display: 'flex', alignItems: 'center', gap: 16 * u, ...revealStyle('rise', urlP, 20 * u) }}>
          <div style={{ width: 14 * u, height: 14 * u, borderRadius: th.radius ? '50%' : 0, background: th.accent, boxShadow: th.style === 'neon' ? `0 0 ${14 * u}px ${th.accent}` : undefined }} />
          <div style={{ ...textStyle(th.body, urlFit.size, th.accentText, true), direction: 'ltr' }}>{urlFit.lines[0]}</div>
        </div>
      ) : null}
    </div>
  );
  if (wide) {
    return (
      <Stage box={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {words}
        <QrCard url={url} size={qrSize} delay={6} />
      </Stage>
    );
  }
  return (
    <Stage box={{ justifyContent: 'center', alignItems: 'center' }}>
      {words}
      <div style={{ height: per({ landscape: 70, portrait: 110, square: 56 }) }} />
      <QrCard url={url} size={qrSize} delay={8} />
    </Stage>
  );
}

// ---------------------------------------------------------------------------

/** Draws one scene of any kind, given its context. */
export function SceneBody({ info }: { info: SceneInfo }) {
  const scene: Scene | undefined = info.video.scenes[info.index];
  let body: ReactNode = null;
  if (scene) {
    switch (scene.kind) {
      case 'gallery': body = <GalleryView scene={scene} />; break;
      case 'timeline': body = <TimelineView scene={scene} />; break;
      case 'compare': body = <CompareView scene={scene} />; break;
      case 'people': body = <PeopleView scene={scene} />; break;
      case 'logo': body = <LogoView scene={scene} />; break;
      case 'qr': body = <QrView scene={scene} />; break;
      default: body = firstKindView(scene);
    }
  }
  return <SceneProvider value={info}>{body ?? <Stage><div /></Stage>}</SceneProvider>;
}
