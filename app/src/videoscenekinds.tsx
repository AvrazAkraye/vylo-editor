/**
 * One component per scene kind. Each lays itself out from the frame's safe
 * area (landscape, portrait and square differ), fits its words, mirrors in
 * right-to-left languages, and has a designed look when it has no picture.
 */

import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Easing, useCurrentFrame, useVideoConfig } from 'remotion';
import type {
  BulletsScene, ChartScene, ImageScene, KineticScene, OutroScene, QuoteScene, Scene, SplitScene, StatScene, StepsScene, TitleScene,
} from './videotypes';
import { alpha, fitText, mix, textWidth } from './videotheme';
import type { Fit, Theme, TypeFace } from './videotheme';
import {
  Backdrop, Lines, Logo, Photo, Rule, SceneProvider, Scrim, dirOf, enterAt, glowOf, onPhoto, progress, revealOf, revealStyle, staggerFor, textStyle, useEnter, useScene,
} from './videoscenebits';
import type { SceneInfo } from './videoscenebits';

// ---------------------------------------------------------------------------
// Shared layout

function Stage(p: { children: ReactNode; ground?: ReactNode; theme?: Theme; drift?: boolean; box?: CSSProperties }) {
  const { theme: th0, box, frames } = useScene();
  const th = p.theme ?? th0;
  const frame = useCurrentFrame();
  const drift = p.drift === false ? 1 : 1 + (0.018 * frame) / Math.max(1, frames);
  return (
    <AbsoluteFill style={{ direction: th.rtl ? 'rtl' : 'ltr', fontFamily: th.body.family, color: th.fg, overflow: 'hidden', background: th.bg }}>
      {p.ground ?? <Backdrop />}
      <div
        style={{
          position: 'absolute', left: box.x, top: box.top, width: box.w, height: box.h,
          display: 'flex', flexDirection: 'column', transform: `scale(${drift.toFixed(4)})`, ...p.box,
        }}
      >
        {p.children}
      </div>
    </AbsoluteFill>
  );
}

/** Per-format size, in pixels: landscape, portrait, square (given in units of 1/1080 of the short side). */
function per(fmt: { landscape: number; portrait: number; square: number }): number {
  const { box } = useScene();
  return fmt[box.format] * box.u;
}

function fit(text: string, face: TypeFace, o: { max: number; min: number; width: number; height: number; lines?: number; bold?: boolean; balance?: boolean }): Fit {
  const { ready } = useScene();
  return fitText(text, { face, bold: o.bold, maxSize: o.max, minSize: o.min, maxWidth: o.width, maxHeight: o.height, maxLines: o.lines, ready, balance: o.balance });
}

/** A small label above a headline: a short bar and a word. */
function Eyebrow(p: { text: string; theme: Theme; delay: number; center?: boolean }) {
  const { box } = useScene();
  const pr = useEnter(p.delay);
  const th = p.theme;
  const size = 30 * box.u;
  const latin = !th.rtl;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 * box.u, justifyContent: p.center ? 'center' : 'flex-start', ...revealStyle('rise', pr, 20 * box.u) }}>
      <div style={{ width: 44 * box.u * Math.min(1, pr), height: Math.max(2, 4 * box.u), background: th.accent, borderRadius: th.radius ? 3 * box.u : 0 }} />
      <div style={{ ...textStyle(th.body, size, th.accentText, true), letterSpacing: latin ? '0.18em' : undefined, textTransform: latin ? 'uppercase' : undefined }}>{p.text}</div>
    </div>
  );
}

const lastOf = (n: number) => (i: number) => (i === n - 1 ? true : false);

// ---------------------------------------------------------------------------
// Title

function TitleView({ scene }: { scene: TitleScene }) {
  const { theme: th0, box, frames, video, index } = useScene();
  const u = box.u;
  const pic = scene.picture?.src;
  const th = pic ? onPhoto(th0) : th0;
  const center = th.align === 'center';
  const logo = video.brand?.logo;
  const name = video.brand?.name?.trim();
  const width = center ? box.w : box.w * (box.format === 'landscape' ? 0.82 : 1);
  const titleFit = fit(scene.title, th.display, {
    max: per({ landscape: 150, portrait: 132, square: 124 }), min: 50 * u, width,
    height: box.h * (pic ? 0.42 : 0.52), lines: 4,
  });
  const subFit = scene.subtitle ? fit(scene.subtitle, th.body, { max: per({ landscape: 44, portrait: 44, square: 40 }), min: 26 * u, width: Math.min(width, 1150 * u), height: box.h * 0.2, lines: 3 }) : null;
  const st = th.motion.stagger * 1.6;
  const dHead = logo || name ? 10 : 4;
  const dRule = dHead + titleFit.lines.length * st + 4;
  const dSub = dRule + 6;
  const ruleP = useEnter(dRule);
  const subP = useEnter(dSub);
  const logoP = useEnter(0);
  const ground = pic ? (
    <AbsoluteFill>
      <Photo src={pic} seed={index} frames={frames} />
      <Scrim theme={th0} to={box.format === 'landscape' && !center ? 'start' : 'bottom'} />
      {box.format === 'landscape' && !center ? <Scrim theme={th0} to="bottom" strength={0.6} /> : null}
      {center ? <Scrim theme={th0} to="all" strength={0.8} /> : null}
    </AbsoluteFill>
  ) : undefined;
  return (
    <Stage ground={ground} theme={th} box={{ justifyContent: pic ? 'flex-end' : 'center', alignItems: center ? 'center' : 'flex-start' }}>
      {logo ? (
        <div style={{ marginBottom: 46 * u, ...revealStyle('pop', logoP, 30 * u) }}>
          <Logo src={logo} height={per({ landscape: 96, portrait: 110, square: 96 })} maxWidth={420 * u} />
        </div>
      ) : name ? (
        <div style={{ marginBottom: 34 * u }}>
          <Eyebrow text={name} theme={th} delay={2} center={center} />
        </div>
      ) : null}
      {th.style === 'elegant' ? <Ornament theme={th} delay={dHead - 2} /> : null}
      <Lines fit={titleFit} face={th.display} color={th.fg} delay={dHead} stagger={st} align={center ? 'center' : 'start'} shadow={glowOf(th, u)} lineColor={th.style === 'modern' || th.style === 'warm' ? (i) => (lastOf(titleFit.lines.length)(i) && titleFit.lines.length > 1 ? th.accentText : undefined) : undefined} />
      <Rule width={per({ landscape: 150, portrait: 130, square: 120 })} height={Math.max(3, 7 * u)} color={th.accent} p={ruleP} center={center} style={{ marginTop: 40 * u, marginBottom: 34 * u }} />
      {subFit && scene.subtitle ? (
        <div style={{ ...revealStyle('rise', subP, 24 * u), display: 'flex', flexDirection: 'column', alignItems: center ? 'center' : 'flex-start' }}>
          {subFit.lines.map((l, i) => (
            <div key={i} style={{ ...textStyle(th.body, subFit.size, th.muted), textAlign: center ? 'center' : 'start' }}>{l}</div>
          ))}
        </div>
      ) : null}
    </Stage>
  );
}

/** A thin line, a diamond, a thin line — the elegant style's headline ornament. */
function Ornament(p: { theme: Theme; delay: number }) {
  const { box } = useScene();
  const u = box.u;
  const pr = useEnter(p.delay);
  const w = 110 * u * Math.min(1, pr);
  const line = Math.max(1, 1.5 * u);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 * u, marginBottom: 34 * u, opacity: Math.min(1, pr * 1.5) }}>
      <div style={{ width: w, height: line, background: alpha(p.theme.accent, 0.8) }} />
      <div style={{ width: 12 * u, height: 12 * u, background: p.theme.accent, transform: `rotate(45deg) scale(${Math.min(1, pr)})` }} />
      <div style={{ width: w, height: line, background: alpha(p.theme.accent, 0.8) }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kinetic

function KineticView({ scene }: { scene: KineticScene }) {
  const { theme: th, box, frames } = useScene();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = box.u;
  const center = th.align === 'center' || box.format !== 'landscape';
  const f = fit(scene.text, th.display, {
    max: per({ landscape: 168, portrait: 150, square: 140 }), min: 48 * u,
    width: box.w * (box.format === 'landscape' ? 0.9 : 1), height: box.h * 0.86, lines: 6,
  });
  const lines = f.lines.map((l) => l.split(' '));
  const words = lines.flat();
  const n = words.length;
  // The emphasised word: the last one, unless it is tiny — then the longest.
  let hi = n - 1;
  if ((words[hi] ?? '').length < 3) {
    hi = words.reduce((b, w, i) => (w.length > (words[b] ?? '').length ? i : b), 0);
  }
  const gap = Math.max(2, Math.min(9, (frames * 0.36) / Math.max(1, n)));
  const mode = th.style === 'bold' || th.style === 'neon' ? 'pop' : th.style === 'elegant' ? 'fade' : 'rise';
  const space = f.size * 0.26;
  let k = 0;
  return (
    <Stage box={{ justifyContent: 'center', alignItems: center ? 'center' : 'flex-start' }}>
      {lines.map((ws, li) => (
        <div key={li} style={{ display: 'flex', flexDirection: 'row', columnGap: space, justifyContent: center ? 'center' : 'flex-start', height: f.size * th.display.leading, alignItems: 'center' }}>
          {ws.map((w, wi) => {
            const i = k++;
            const p = enterAt(frame - 4 - i * gap, fps, th);
            const isHi = i === hi;
            const box2: CSSProperties = isHi && th.style === 'bold'
              ? { background: th.accent, color: th.onAccent, paddingInline: f.size * 0.12, marginInline: -f.size * 0.12, borderRadius: 4 * u }
              : { color: isHi ? th.accentText : th.fg };
            const shadow = isHi ? glowOf(th, u * 1.3) : th.style === 'neon' ? `0 0 ${12 * u}px ${alpha(th.fg, 0.35)}` : undefined;
            return (
              <div key={wi} style={{ ...textStyle(th.display, f.size, th.fg), ...box2, textShadow: shadow, ...revealStyle(mode, p, th.motion.travel * u * 0.8) }}>{w}</div>
            );
          })}
        </div>
      ))}
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// Bullets

function Marker(p: { i: number; theme: Theme; size: number; p: number }) {
  const th = p.theme;
  const { box } = useScene();
  const u = box.u;
  const num = String(p.i + 1).padStart(2, '0');
  const s = p.size;
  const scale = `scale(${0.4 + 0.6 * Math.min(1.1, p.p)})`;
  switch (th.style) {
    case 'elegant':
      return <div style={{ width: s, height: s, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: s * 0.3, height: s * 0.3, background: th.accent, transform: `rotate(45deg) ${scale}` }} /></div>;
    case 'neon':
      return <div style={{ width: s, height: s, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: s * 0.34, height: s * 0.34, borderRadius: '50%', background: th.accent, boxShadow: `0 0 ${18 * u}px ${th.accent}`, transform: scale }} /></div>;
    case 'warm':
      return <div style={{ width: s, height: s, borderRadius: '50%', background: th.accent, color: th.onAccent, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: scale, ...textStyle(th.body, s * 0.42, th.onAccent, true), direction: 'ltr' }}>{p.i + 1}</div>;
    case 'bold':
      return <div style={{ width: s, height: s, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', ...textStyle(th.display, s * 0.8, th.accentText), direction: 'ltr', opacity: Math.min(1, p.p * 1.5) }}>{num}</div>;
    case 'minimal':
      return <div style={{ width: s, height: s, display: 'flex', alignItems: 'center', ...textStyle(th.body, s * 0.42, th.accentText, true), direction: 'ltr', opacity: Math.min(1, p.p * 1.5) }}>{num}</div>;
    default:
      return <div style={{ width: s, height: s, borderRadius: 14 * u, background: alpha(th.accent, 0.2), border: `${Math.max(1, 2 * u)}px solid ${alpha(th.accent, 0.55)}`, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: scale, ...textStyle(th.body, s * 0.36, th.fg, true), direction: 'ltr' }}>{num}</div>;
  }
}

function BulletsView({ scene }: { scene: BulletsScene }) {
  const { theme: th, box, frames } = useScene();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = box.u;
  const wide = box.format === 'landscape';
  const points = scene.points.filter((s) => s.trim()).slice(0, 5);
  const n = Math.max(1, points.length);
  const headW = wide ? box.w * 0.4 : box.w;
  const listW = wide ? box.w * 0.54 : box.w;
  const headFit = fit(scene.heading, th.display, { max: per({ landscape: 104, portrait: 112, square: 84 }), min: 44 * u, width: headW, height: wide ? box.h * 0.8 : box.h * 0.3, lines: 4 });
  const headH = headFit.lines.length * headFit.size * th.display.leading;
  const listH = wide ? box.h : box.h - headH - 80 * u;
  const marker = per({ landscape: 64, portrait: 64, square: 56 });
  const textW = listW - marker - 32 * u;
  const rowMax = listH / n;
  // One size for every point, the largest that lets each fit its row.
  const size = Math.min(...(points.length ? points : ['']).map((pt) => fit(pt, th.body, { max: per({ landscape: 52, portrait: 56, square: 44 }), min: 24 * u, width: textW, height: rowMax * 0.62, lines: 3, bold: true }).size));
  const fits = points.map((pt) => fit(pt, th.body, { max: size, min: size, width: textW, height: 9999, lines: 3, bold: true }));
  const d0 = 8 + headFit.lines.length * th.motion.stagger;
  const st = staggerFor(th, frames, n, 0.5, d0);
  const heading = <Lines fit={headFit} face={th.display} color={th.fg} delay={2} stagger={th.motion.stagger * 1.4} shadow={glowOf(th, u)} />;
  const rows = (
    <div style={{ width: listW, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: Math.min(40 * u, rowMax * 0.18) }}>
      {fits.map((f, i) => {
        const p = enterAt(frame - d0 - i * st, fps, th);
        const lineP = progress(frame, d0 + i * st + 4, d0 + i * st + 26, Easing.out(Easing.cubic));
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 32 * u, ...revealStyle(revealOf(th) === 'pop' ? 'pop' : 'rise', p, th.motion.travel * u * 0.7, 'start', th.rtl) }}>
              <Marker i={i} theme={th} size={marker} p={p} />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {f.lines.map((l, j) => <div key={j} style={textStyle(th.body, f.size, th.fg, true)}>{l}</div>)}
              </div>
            </div>
            {th.style === 'minimal' || th.style === 'elegant' || th.style === 'modern' ? (
              <div style={{ height: Math.max(1, 1.5 * u), width: listW * lineP, background: alpha(th.fg, 0.14), marginTop: Math.min(40 * u, rowMax * 0.18) * 0.9 }} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
  if (wide) {
    return (
      <Stage box={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ width: headW, display: 'flex', flexDirection: 'column' }}>
          {heading}
          <Rule width={120 * u} height={Math.max(3, 6 * u)} color={th.accent} p={progress(frame, 10, 34, Easing.out(Easing.cubic))} style={{ marginTop: 36 * u }} />
        </div>
        {rows}
      </Stage>
    );
  }
  return (
    <Stage box={{ justifyContent: 'center' }}>
      {heading}
      <Rule width={110 * u} height={Math.max(3, 6 * u)} color={th.accent} p={progress(frame, 10, 34, Easing.out(Easing.cubic))} style={{ marginTop: 32 * u, marginBottom: 56 * u }} />
      {rows}
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// Stat

function decimalsOf(v: number): number {
  const s = String(v);
  const i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(2, s.length - i - 1);
}

function formatNumber(v: number, decimals: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const hasLetters = (s: string) => /[A-Za-z؀-ۿ]/.test(s);

function StatView({ scene }: { scene: StatScene }) {
  const { theme: th, box, frames, ready } = useScene();
  const frame = useCurrentFrame();
  const u = box.u;
  const value = Number.isFinite(scene.value) ? scene.value : 0;
  const dec = decimalsOf(value);
  const finalText = formatNumber(value, dec);
  const prefix = (scene.prefix ?? '').trim();
  const suffix = (scene.suffix ?? '').trim();
  const small = (s: string) => s.length > 1 && hasLetters(s);
  // The size at which prefix + number + suffix fit the width on one line.
  const maxSize = per({ landscape: 300, portrait: 250, square: 250 });
  const widthAt = (s: number) =>
    textWidth(finalText, th.display, s, false, ready) +
    (prefix ? textWidth(prefix, th.display, small(prefix) ? s * 0.4 : s, false, ready) + s * 0.08 : 0) +
    (suffix ? textWidth(suffix, th.display, small(suffix) ? s * 0.4 : s, false, ready) + s * 0.08 : 0);
  let size = maxSize;
  while (size > 60 * u && widthAt(size) > box.w * 0.92) size *= 0.95;
  const countEnd = Math.max(18, Math.min(frames * 0.38, 50));
  const c = progress(frame, 6, 6 + countEnd, Easing.bezier(0.16, 1, 0.3, 1));
  const now = formatNumber(value * c, dec);
  const numW = textWidth(finalText, th.display, size, false, ready) * 1.04;
  const pop = useEnter(2);
  const labelFit = fit(scene.label, th.body, { max: per({ landscape: 54, portrait: 60, square: 46 }), min: 26 * u, width: Math.min(box.w, 1150 * u), height: box.h * 0.25, lines: 3, bold: true });
  const labelP = useEnter(14);
  const numColor = th.style === 'bold' && !th.inverted ? th.accent : th.fg;
  const affix = (s: string) => (
    <div style={{ ...textStyle(th.display, small(s) ? size * 0.4 : size, th.accentText), lineHeight: `${size * 1.1}px`, alignSelf: small(s) ? 'center' : undefined, textShadow: glowOf(th, u) }}>{s}</div>
  );
  const rtlRow = th.rtl && (hasLetters(prefix) || hasLetters(suffix));
  const ring = Math.min(box.w, box.h) * 0.9;
  const ringP = useEnter(0, 1.6);
  return (
    <Stage box={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ position: 'absolute', left: box.w / 2 - ring / 2, top: box.h / 2 - ring / 2 - labelFit.lines.length * labelFit.size * 0.5, width: ring, height: ring, borderRadius: '50%', border: `${Math.max(1, 2 * u)}px solid ${alpha(th.accent, 0.22)}`, transform: `scale(${0.7 + 0.3 * ringP})`, opacity: Math.min(1, ringP) }} />
      <div style={{ position: 'absolute', left: box.w / 2 - ring * 0.43, top: box.h / 2 - ring * 0.43 - labelFit.lines.length * labelFit.size * 0.5, width: ring * 0.86, height: ring * 0.86, borderRadius: '50%', border: `${Math.max(1, 3 * u)}px dashed ${alpha(th.accent, 0.3)}`, transform: `rotate(${frame * 0.25}deg) scale(${0.7 + 0.3 * ringP})`, opacity: Math.min(1, ringP) }} />
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: size * 0.08, direction: rtlRow ? 'rtl' : 'ltr', transform: `scale(${0.85 + 0.15 * Math.min(1.05, pop)})`, opacity: Math.min(1, pop * 2) }}>
        {prefix ? affix(prefix) : null}
        <div style={{ ...textStyle(th.display, size, numColor), lineHeight: `${size * 1.1}px`, width: numW, textAlign: 'center', direction: 'ltr', textShadow: glowOf(th, u * 1.4) }}>{now}</div>
        {suffix ? affix(suffix) : null}
      </div>
      <Rule width={Math.min(numW, 420 * u)} height={Math.max(3, 8 * u)} color={th.accent} p={c} center style={{ marginTop: 18 * u, marginBottom: 40 * u }} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', ...revealStyle('rise', labelP, 30 * u) }}>
        {labelFit.lines.map((l, i) => <div key={i} style={{ ...textStyle(th.body, labelFit.size, th.muted, true), textAlign: 'center' }}>{l}</div>)}
      </div>
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// Chart

function ChartView({ scene }: { scene: ChartScene }) {
  const { theme: th, box, frames, ready } = useScene();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = box.u;
  const wide = box.format === 'landscape';
  const bars = scene.bars.filter((b) => Number.isFinite(b.value)).slice(0, 6);
  const n = Math.max(1, bars.length);
  const headFit = fit(scene.heading, th.display, { max: per({ landscape: 88, portrait: 100, square: 72 }), min: 40 * u, width: box.w, height: box.h * 0.24, lines: 3 });
  const headH = headFit.lines.length * headFit.size * th.display.leading;
  const areaH = box.h - headH - 70 * u;
  const rowH = Math.min(areaH / n, (wide ? 150 : box.format === 'portrait' ? 240 : 190) * u);
  const max = Math.max(1e-9, ...bars.map((b) => b.value));
  const dec = Math.max(0, ...bars.map((b) => decimalsOf(b.value)));
  const unit = (scene.unit ?? '').trim();
  const valueText = (v: number) => `${formatNumber(v, dec)}${unit ? (unit.length > 2 ? ' ' : '') + unit : ''}`;
  const labelW = wide ? box.w * 0.26 : box.w;
  const labelSize = Math.min(...(bars.length ? bars : [{ label: '' }]).map((b) => fit(b.label, th.body, { max: per({ landscape: 40, portrait: 46, square: 34 }), min: 20 * u, width: labelW * 0.96, height: wide ? rowH * 0.8 : rowH * 0.34, lines: wide ? 2 : 1, bold: true }).size));
  const barH = wide ? Math.min(rowH * 0.52, 64 * u) : Math.min(rowH * 0.3, 64 * u);
  const valueSize = Math.max(22 * u, Math.min(barH * 0.62, 40 * u));
  const trackW = wide ? box.w - labelW - 36 * u : box.w;
  const maxValueW = Math.max(...bars.map((b) => textWidth(valueText(b.value), th.body, valueSize, true, ready)), 40 * u);
  const fillMax = Math.max(trackW * 0.4, trackW - maxValueW - 28 * u);
  const d0 = 6 + headFit.lines.length * th.motion.stagger;
  const st = staggerFor(th, frames, n, 0.35, d0);
  const growFor = Math.max(18, Math.min(40, frames * 0.35));
  const r = Math.min(th.radius, barH / 2);
  return (
    <Stage box={{ justifyContent: 'center' }}>
      <Lines fit={headFit} face={th.display} color={th.fg} delay={2} stagger={th.motion.stagger * 1.4} shadow={glowOf(th, u)} />
      <div style={{ height: 60 * u }} />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {bars.map((b, i) => {
          const d = d0 + i * st;
          const g = th.motion.spring ? Math.min(1.04, enterAt(frame - d, fps, th, 1.4)) : progress(frame, d, d + growFor, th.motion.easing);
          const shown = Math.max(0, Math.min(1, g));
          const w = Math.max(barH * 0.2, (b.value / max) * fillMax * g);
          const top = b.value === max;
          const fill = top ? th.accent : th.style === 'minimal' ? alpha(th.fg, 0.75) : mix(th.accent, th.bg, 0.45);
          const labelFit2 = fit(b.label, th.body, { max: labelSize, min: labelSize, width: labelW * 0.96, height: 999, lines: 2, bold: true });
          const label = (
            <div style={{ display: 'flex', flexDirection: 'column', width: wide ? labelW : undefined, opacity: Math.min(1, shown * 2 + 0.2) }}>
              {labelFit2.lines.map((l, j) => <div key={j} style={textStyle(th.body, labelFit2.size, th.fg, true)}>{l}</div>)}
            </div>
          );
          const bar = (
            <div style={{ position: 'relative', width: trackW, height: barH, display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
              <div style={{ position: 'absolute', [th.rtl ? 'right' : 'left']: 0, top: 0, width: trackW, height: barH, background: alpha(th.fg, th.dark ? 0.06 : 0.07), borderRadius: r }} />
              <div style={{ width: w, height: barH, background: fill, borderRadius: r, boxShadow: th.style === 'neon' && top ? `0 0 ${24 * u}px ${alpha(th.accent, 0.8)}` : undefined }} />
              <div style={{ ...textStyle(th.body, valueSize, top ? th.accentText : th.fg, true), marginInlineStart: 18 * u, direction: 'ltr', opacity: Math.min(1, shown * 1.5) }}>{valueText(b.value * shown)}</div>
            </div>
          );
          return wide ? (
            <div key={i} style={{ height: rowH, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 36 * u }}>{label}{bar}</div>
          ) : (
            <div key={i} style={{ height: rowH, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14 * u }}>{label}{bar}</div>
          );
        })}
      </div>
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// Quote

function QuoteMark(p: { size: number; color: string; rtl: boolean; p: number; glow?: boolean }) {
  // Two closing quotes; mirrored for right-to-left.
  return (
    <div style={{ width: Math.round(p.size), height: Math.round(p.size), transform: `${p.rtl ? 'scaleX(-1) ' : ''}scale(${0.6 + 0.4 * Math.min(1.1, p.p)})`, opacity: Math.min(1, p.p * 1.5) }}>
    <svg width={Math.round(p.size)} height={Math.round(p.size)} viewBox="0 0 24 24" style={{ display: 'block', width: Math.round(p.size), height: Math.round(p.size) }}>
      <path d="M4.6 17.8c-.9-.9-1.4-2.2-1.4-3.9 0-3.2 2-6.1 5.1-7.9l.9 1.3C7.2 8.8 6.2 10.2 6 11.7c.3-.1.7-.2 1.1-.2 1.7 0 3 1.3 3 3.1 0 1.8-1.4 3.2-3.2 3.2-1 0-1.7-.3-2.3-1zm9.6 0c-.9-.9-1.4-2.2-1.4-3.9 0-3.2 2-6.1 5.1-7.9l.9 1.3c-2 1.5-3 2.9-3.2 4.4.3-.1.7-.2 1.1-.2 1.7 0 3 1.3 3 3.1 0 1.8-1.4 3.2-3.2 3.2-1 0-1.7-.3-2.3-1z" fill={p.color} />
    </svg>
    </div>
  );
}

function QuoteView({ scene }: { scene: QuoteScene }) {
  const { theme: th, box } = useScene();
  const frame = useCurrentFrame();
  const u = box.u;
  const center = th.align === 'center';
  // Reem Kufi (neon, Arabic script) is a display face: a long quotation reads better in the body face.
  const face = th.style === 'neon' && th.rtl ? { ...th.body, weight: th.body.strong, leading: th.display.leading } : th.display;
  const qFit = fit(scene.quote, face, { max: per({ landscape: 88, portrait: 92, square: 72 }), min: 34 * u, width: box.w * (box.format === 'landscape' ? 0.86 : 1), height: box.h * 0.6, lines: 8 });
  const markP = useEnter(0);
  const st = th.motion.stagger * 1.4;
  const dA = 6 + qFit.lines.length * st + 6;
  const aP = useEnter(dA);
  return (
    <Stage box={{ justifyContent: 'center', alignItems: center ? 'center' : 'flex-start' }}>
      <QuoteMark size={per({ landscape: 130, portrait: 140, square: 120 })} color={th.accent} rtl={th.rtl} p={markP} />
      <div style={{ height: 24 * u }} />
      <Lines fit={qFit} face={face} color={th.fg} delay={6} stagger={st} align={center ? 'center' : 'start'} shadow={glowOf(th, u * 0.7)} />
      {scene.author ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 * u, marginTop: 48 * u, ...revealStyle('rise', aP, 24 * u) }}>
          <div style={{ width: 56 * u * Math.min(1, progress(frame, dA, dA + 20)), height: Math.max(2, 3 * u), background: th.accent }} />
          <div style={textStyle(th.body, per({ landscape: 36, portrait: 38, square: 32 }), th.muted, true)}>{scene.author}</div>
        </div>
      ) : null}
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// Image

/** A composition of shapes for a scene whose picture is missing. */
function Artwork(p: { theme: Theme; seed: number; scale?: number }) {
  const { box, frames } = useScene();
  const frame = useCurrentFrame();
  const th = p.theme;
  const W = box.width;
  const H = box.height;
  const S = Math.min(W, H) * (p.scale ?? 1);
  const t = frame / Math.max(1, frames);
  const e = enterAt(frame, 30, th, 1.5);
  const cx = W * (p.seed % 2 ? 0.34 : 0.66);
  const cy = H * 0.46;
  const ring = (r: number, w: number, c: string, rot: number, dashed = false) => (
    <div style={{ position: 'absolute', left: cx - r, top: cy - r, width: 2 * r, height: 2 * r, borderRadius: '50%', border: `${w}px ${dashed ? 'dashed' : 'solid'} ${c}`, transform: `rotate(${rot}deg) scale(${0.6 + 0.4 * Math.min(1, e)})`, opacity: Math.min(1, e) }} />
  );
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: cx - S * 0.36, top: cy - S * 0.36, width: S * 0.72, height: S * 0.72, borderRadius: '50%', background: `linear-gradient(${140 + t * 40}deg, ${alpha(th.accent, 0.85)} 0%, ${alpha(th.accent2, 0.55)} 100%)`, transform: `scale(${(0.5 + 0.5 * Math.min(1, e)) * (1 + 0.05 * t)})`, opacity: th.dark ? 0.55 : 0.4 }} />
      {ring(S * 0.5, Math.max(1, 2 * box.u), alpha(th.accent, 0.35), t * 30)}
      {ring(S * 0.62, Math.max(1, 3 * box.u), alpha(th.accent2, 0.3), -t * 40, true)}
      <div style={{ position: 'absolute', left: cx + S * 0.28, top: cy - S * 0.42, width: S * 0.16, height: S * 0.16, borderRadius: th.radius ? '50%' : 0, background: th.accent2, transform: `translate(${-t * 40 * box.u}px, ${t * 30 * box.u}px) scale(${Math.min(1, e)})`, opacity: 0.8 }} />
      <div style={{ position: 'absolute', left: cx - S * 0.5, top: cy + S * 0.3, width: S * 0.3, height: Math.max(2, 6 * box.u), background: th.accent, transform: `translateX(${t * 60 * box.u}px) scaleX(${Math.min(1, e)})` }} />
    </AbsoluteFill>
  );
}

function ImageView({ scene }: { scene: ImageScene }) {
  const { theme: th0, box, frames, index } = useScene();
  const u = box.u;
  const pic = scene.picture?.src;
  const th = pic ? onPhoto(th0) : th0;
  const caption = (scene.caption ?? '').trim();
  const capFit = caption ? fit(caption, th.display, { max: per({ landscape: pic ? 80 : 120, portrait: pic ? 76 : 110, square: pic ? 68 : 100 }), min: 36 * u, width: box.w * (pic ? 0.82 : 0.9), height: box.h * (pic ? 0.34 : 0.6), lines: 4 }) : null;
  const barP = useEnter(6);
  if (!pic) {
    return (
      <Stage ground={<AbsoluteFill><Backdrop intensity={1.2} /><Artwork theme={th} seed={index} /></AbsoluteFill>} box={{ justifyContent: 'center', alignItems: 'center' }}>
        {capFit ? <Lines fit={capFit} face={th.display} color={th.fg} delay={8} stagger={th.motion.stagger * 1.5} align="center" shadow={glowOf(th, u)} /> : null}
      </Stage>
    );
  }
  const capH = capFit ? capFit.lines.length * capFit.size * th.display.leading : 0;
  return (
    <Stage
      theme={th}
      drift={false}
      ground={<AbsoluteFill><Photo src={pic} seed={index} frames={frames} /><Scrim theme={th0} to="bottom" strength={caption ? 1 : 0.4} /></AbsoluteFill>}
      box={{ justifyContent: 'flex-end' }}
    >
      {capFit ? (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', gap: 30 * u }}>
          <div style={{ width: Math.max(4, 9 * u), height: capH, background: th.accent, transform: `scaleY(${Math.min(1, barP)})`, borderRadius: th.radius ? 5 * u : 0 }} />
          <Lines fit={capFit} face={th.display} color={th.fg} delay={10} stagger={th.motion.stagger * 1.5} />
        </div>
      ) : null}
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// Split

function SplitView({ scene }: { scene: SplitScene }) {
  const { theme: th, box, frames, index } = useScene();
  const frame = useCurrentFrame();
  const u = box.u;
  const side = box.format === 'landscape';
  const pic = scene.picture?.src;
  const W = box.width;
  const H = box.height;
  const panelW = side ? W * 0.5 : W;
  const panelH = side ? H : H * (box.format === 'portrait' ? 0.46 : 0.44);
  const gap = 80 * u;
  const textW = side ? W - panelW - box.x - gap : box.w;
  const textTop = side ? box.top : panelH + 70 * u;
  const textH = side ? box.h : H - textTop - box.bottom;
  const headFit = fit(scene.heading, th.display, { max: per({ landscape: 92, portrait: 100, square: 64 }), min: 36 * u, width: textW, height: textH * 0.5, lines: 4 });
  const headH = headFit.lines.length * headFit.size * th.display.leading;
  const bodyFit = fit(scene.text, th.body, { max: per({ landscape: 40, portrait: 46, square: 34 }), min: 22 * u, width: textW, height: Math.max(40 * u, textH - headH - 90 * u), lines: 8 });
  const reveal = progress(frame, 0, 24, Easing.bezier(0.7, 0, 0.2, 1));
  const hidden = (1 - reveal) * 100;
  // The picture sits on the end side (right in LTR, left in RTL); it opens from the outer edge.
  const endIsRight = !th.rtl;
  const clip = side ? (endIsRight ? `inset(0% 0% 0% ${hidden}%)` : `inset(0% ${hidden}% 0% 0%)`) : `inset(0% 0% ${hidden}% 0%)`;
  const panelLeft = side ? (endIsRight ? W - panelW : 0) : 0;
  const textLeft = side ? (endIsRight ? box.x : panelW + gap) : box.x;
  const bodyP = useEnter(10 + headFit.lines.length * th.motion.stagger);
  const ruleP = progress(frame, 12, 36, Easing.out(Easing.cubic));
  const num = String(index + 1).padStart(2, '0');
  const panel = pic ? (
    <Photo src={pic} seed={index} frames={frames} />
  ) : (
    <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', overflow: 'hidden', background: `linear-gradient(135deg, ${th.accent} 0%, ${mix(th.accent, th.accent2, 0.7)} 100%)` }}>
      <div style={{ position: 'absolute', left: panelW * 0.5 - panelH * 0.45, top: panelH * 0.05, width: panelH * 0.9, height: panelH * 0.9, borderRadius: '50%', border: `${Math.max(1, 3 * u)}px solid ${alpha(th.onAccent, 0.25)}`, transform: `scale(${1 + 0.06 * (frame / frames)})` }} />
      <div style={{ position: 'absolute', left: panelW * 0.5 - panelH * 0.3, top: panelH * 0.2, width: panelH * 0.6, height: panelH * 0.6, borderRadius: '50%', background: alpha(th.onAccent, 0.1) }} />
      <div style={{ position: 'absolute', left: 0, top: panelH / 2 - Math.min(panelW, panelH) * 0.3, width: panelW, textAlign: 'center', fontFamily: th.display.family, fontWeight: th.display.weight, fontSize: Math.min(panelW, panelH) * 0.5, lineHeight: `${Math.min(panelW, panelH) * 0.6}px`, color: 'transparent', WebkitTextStroke: `${Math.max(1, 3 * u)}px ${alpha(th.onAccent, 0.6)}`, direction: 'ltr', transform: `translateY(${(1 - reveal) * 60 * u}px)` }}>{num}</div>
    </div>
  );
  return (
    <AbsoluteFill style={{ direction: th.rtl ? 'rtl' : 'ltr', fontFamily: th.body.family, color: th.fg, overflow: 'hidden', background: th.bg }}>
      <Backdrop intensity={0.8} />
      <div style={{ position: 'absolute', left: panelLeft, top: 0, width: panelW, height: panelH, clipPath: clip, overflow: 'hidden' }}>{panel}</div>
      {!side ? <div style={{ position: 'absolute', left: 0, top: panelH - Math.max(3, 8 * u), width: W * ruleP, height: Math.max(3, 8 * u), background: th.accent }} /> : null}
      <div style={{ position: 'absolute', left: textLeft, top: textTop, width: textW, height: textH, display: 'flex', flexDirection: 'column', justifyContent: side ? 'center' : 'flex-start' }}>
        <Lines fit={headFit} face={th.display} color={th.fg} delay={8} stagger={th.motion.stagger * 1.4} shadow={glowOf(th, u)} />
        <Rule width={100 * u} height={Math.max(3, 6 * u)} color={th.accent} p={ruleP} style={{ marginTop: 30 * u, marginBottom: 30 * u }} />
        <div style={{ display: 'flex', flexDirection: 'column', ...revealStyle('rise', bodyP, 26 * u) }}>
          {bodyFit.lines.map((l, i) => <div key={i} style={textStyle(th.body, bodyFit.size, th.muted)}>{l}</div>)}
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// Steps

function StepDot(p: { i: number; size: number; theme: Theme; on: number }) {
  const th = p.theme;
  const { box } = useScene();
  const u = box.u;
  const on = Math.max(0, Math.min(1.15, p.on));
  const lit = on > 0.02;
  const r = th.radius === 0 ? 0 : th.style === 'bold' ? 8 * u : '50%';
  return (
    <div style={{ width: p.size, height: p.size, position: 'relative' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: p.size, height: p.size, borderRadius: r, background: th.bg, border: `${Math.max(2, 3 * u)}px solid ${alpha(th.fg, 0.22)}` }} />
      <div style={{ position: 'absolute', left: 0, top: 0, width: p.size, height: p.size, borderRadius: r, background: th.accent, transform: `scale(${on})`, opacity: lit ? 1 : 0, boxShadow: th.style === 'neon' && lit ? `0 0 ${26 * u}px ${alpha(th.accent, 0.9)}` : undefined }} />
      <div style={{ position: 'absolute', left: 0, top: 0, width: p.size, height: p.size, display: 'flex', alignItems: 'center', justifyContent: 'center', ...textStyle(th.body, p.size * 0.4, lit ? th.onAccent : th.muted, true), lineHeight: `${p.size}px`, direction: 'ltr' }}>{p.i + 1}</div>
    </div>
  );
}

function StepsView({ scene }: { scene: StepsScene }) {
  const { theme: th, box, frames } = useScene();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = box.u;
  const steps = scene.steps.filter((s) => s.trim()).slice(0, 5);
  const n = Math.max(1, steps.length);
  const across = box.format === 'landscape' && n > 1;
  const headFit = fit(scene.heading, th.display, { max: per({ landscape: 84, portrait: 104, square: 72 }), min: 40 * u, width: box.w, height: box.h * 0.26, lines: 3 });
  const headH = headFit.lines.length * headFit.size * th.display.leading;
  const dot = per({ landscape: 84, portrait: 96, square: 70 });
  const d0 = 8 + headFit.lines.length * th.motion.stagger;
  const span = Math.max(20, frames * 0.45 - d0);
  const lineP = progress(frame, d0, d0 + span, Easing.inOut(Easing.cubic));
  const at = (i: number) => d0 + (n === 1 ? 0 : (i / (n - 1)) * span);
  const line = Math.max(2, 4 * u);
  const areaH = box.h - headH - 80 * u;
  if (across) {
    const col = box.w / n;
    const textSize = Math.min(...steps.map((s) => fit(s, th.body, { max: 42 * u, min: 22 * u, width: col * 0.84, height: areaH - dot - 40 * u, lines: 4, bold: true }).size));
    return (
      <Stage box={{ justifyContent: 'center' }}>
        <Lines fit={headFit} face={th.display} color={th.fg} delay={2} stagger={th.motion.stagger * 1.4} align={th.align} shadow={glowOf(th, u)} style={{ alignSelf: th.align === 'center' ? 'center' : 'flex-start' }} />
        <div style={{ height: 80 * u }} />
        <div style={{ position: 'relative', width: box.w }}>
          <div style={{ position: 'absolute', [th.rtl ? 'right' : 'left']: col / 2, top: dot / 2 - line / 2, width: box.w - col, height: line, background: alpha(th.fg, 0.14), borderRadius: line }} />
          <div style={{ position: 'absolute', [th.rtl ? 'right' : 'left']: col / 2, top: dot / 2 - line / 2, width: (box.w - col) * lineP, height: line, background: th.accent, borderRadius: line, boxShadow: th.style === 'neon' ? `0 0 ${16 * u}px ${th.accent}` : undefined }} />
          <div style={{ display: 'flex', flexDirection: 'row' }}>
            {steps.map((s, i) => {
              const on = enterAt(frame - at(i), fps, th);
              const f = fit(s, th.body, { max: textSize, min: textSize, width: col * 0.84, height: 999, lines: 4, bold: true });
              return (
                <div key={i} style={{ width: col, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <StepDot i={i} size={dot} theme={th} on={on} />
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
  const rowH = Math.min(areaH / n, 230 * u);
  const textW = box.w - dot - 40 * u;
  const textSize = Math.min(...steps.map((s) => fit(s, th.body, { max: per({ landscape: 42, portrait: 52, square: 40 }), min: 22 * u, width: textW, height: rowH * 0.8, lines: 3, bold: true }).size));
  const listH = rowH * n;
  return (
    <Stage box={{ justifyContent: 'center' }}>
      <Lines fit={headFit} face={th.display} color={th.fg} delay={2} stagger={th.motion.stagger * 1.4} shadow={glowOf(th, u)} />
      <div style={{ height: 70 * u }} />
      <div style={{ position: 'relative', height: listH }}>
        <div style={{ position: 'absolute', [th.rtl ? 'right' : 'left']: dot / 2 - line / 2, top: rowH / 2, width: line, height: listH - rowH, background: alpha(th.fg, 0.14) }} />
        <div style={{ position: 'absolute', [th.rtl ? 'right' : 'left']: dot / 2 - line / 2, top: rowH / 2, width: line, height: (listH - rowH) * lineP, background: th.accent, boxShadow: th.style === 'neon' ? `0 0 ${16 * u}px ${th.accent}` : undefined }} />
        {steps.map((s, i) => {
          const on = enterAt(frame - at(i), fps, th);
          const f = fit(s, th.body, { max: textSize, min: textSize, width: textW, height: 999, lines: 3, bold: true });
          return (
            <div key={i} style={{ height: rowH, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 40 * u }}>
              <StepDot i={i} size={dot} theme={th} on={on} />
              <div style={{ display: 'flex', flexDirection: 'column', ...revealStyle('rise', on, 30 * u, 'start', th.rtl) }}>
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
// Outro and credits

const CREDITS_LABEL: Record<string, string> = {
  en: 'Picture credits',
  ar: 'مصادر الصور',
  ckb: 'سەرچاوەی وێنەکان',
  kmr: 'ژێدەرێن وێنەیان',
};

/** Unique credit lines of the pictures the film shows. */
export function creditLines(scenes: Scene[]): string[] {
  const out: string[] = [];
  for (const s of scenes) {
    const c = s.picture?.credit?.trim();
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** How many frames at the end of the outro the credits card takes, or 0. */
export function creditsFrames(info: Pick<SceneInfo, 'video' | 'frames'>): number {
  if (info.video.credits === false) return 0;
  if (!creditLines(info.video.scenes).length) return 0;
  if (info.frames < 75) return 0;
  return Math.round(Math.min(120, Math.max(45, info.frames * 0.4)));
}

function OutroMain({ scene, frames }: { scene: OutroScene; frames: number }) {
  const { theme: th, box, video } = useScene();
  const frame = useCurrentFrame();
  const u = box.u;
  const logo = video.brand?.logo;
  const name = video.brand?.name?.trim();
  const logoP = useEnter(0);
  const headFit = fit(scene.headline, th.display, { max: per({ landscape: 140, portrait: 124, square: 110 }), min: 44 * u, width: box.w * 0.92, height: box.h * 0.36, lines: 3 });
  const st = th.motion.stagger * 1.5;
  const dCta = 8 + headFit.lines.length * st + 4;
  const ctaP = useEnter(dCta);
  const urlP = useEnter(dCta + 8);
  const cta = scene.cta?.trim();
  const url = scene.url?.trim();
  const ctaSize = per({ landscape: 46, portrait: 48, square: 40 });
  const ctaFit = cta ? fit(cta, th.body, { max: ctaSize, min: 22 * u, width: box.w * 0.8 - 100 * u, height: ctaSize * 1.6, lines: 1, bold: true }) : null;
  const pill = th.radius === 0 ? 0 : th.style === 'bold' ? 8 * u : 999;
  // Rings that open out from the centre, again and again.
  const rings: ReactNode[] = [];
  const R = Math.max(box.width, box.height) * 0.6;
  for (let i = 0; i < 3; i++) {
    const ph = ((frame + i * 40) % 120) / 120;
    rings.push(<div key={i} style={{ position: 'absolute', left: box.width / 2 - R, top: box.height / 2 - R, width: 2 * R, height: 2 * R, borderRadius: '50%', border: `${Math.max(1, 2 * u)}px solid ${alpha(th.accent, 0.3 * (1 - ph))}`, transform: `scale(${0.2 + ph * 0.8})` }} />);
  }
  const fadeOut = 1 - progress(frame, frames - 12, frames);
  return (
    <Stage ground={<AbsoluteFill><Backdrop />{rings}</AbsoluteFill>} box={{ justifyContent: 'center', alignItems: 'center', opacity: fadeOut }}>
      {logo ? (
        <div style={{ marginBottom: 56 * u, ...revealStyle('pop', logoP, 30 * u) }}>
          <Logo src={logo} height={per({ landscape: 130, portrait: 150, square: 120 })} maxWidth={560 * u} />
        </div>
      ) : name ? (
        <div style={{ marginBottom: 44 * u, ...revealStyle('pop', logoP, 30 * u), ...textStyle(th.display, per({ landscape: 56, portrait: 60, square: 50 }), th.accentText), letterSpacing: th.rtl ? undefined : '0.06em', textTransform: th.rtl ? undefined : 'uppercase' }}>{name}</div>
      ) : null}
      <Lines fit={headFit} face={th.display} color={th.fg} delay={8} stagger={st} align="center" shadow={glowOf(th, u)} />
      {ctaFit && cta ? (
        <div style={{ marginTop: 56 * u, paddingInline: 50 * u, height: ctaFit.size * 2.3, display: 'flex', alignItems: 'center', justifyContent: 'center', background: th.accent, borderRadius: pill, boxShadow: th.style === 'neon' ? `0 0 ${30 * u}px ${alpha(th.accent, 0.8)}` : th.dark ? undefined : `0 ${12 * u}px ${30 * u}px ${alpha(th.accent, 0.35)}`, ...revealStyle('pop', ctaP, 20 * u) }}>
          <div style={{ ...textStyle(th.body, ctaFit.size, th.onAccent, true), lineHeight: `${ctaFit.size * 1.3}px` }}>{ctaFit.lines[0]}</div>
        </div>
      ) : null}
      {url ? (
        <div style={{ marginTop: 36 * u, display: 'flex', flexDirection: 'column', alignItems: 'center', ...revealStyle('rise', urlP, 20 * u) }}>
          <div style={{ ...textStyle(th.body, per({ landscape: 38, portrait: 40, square: 34 }), th.muted, true), direction: 'ltr' }}>{url}</div>
        </div>
      ) : null}
    </Stage>
  );
}

function CreditsCard({ lines, delay }: { lines: string[]; delay: number }) {
  const { theme: th, box, video } = useScene();
  const frame = useCurrentFrame();
  const u = box.u;
  const f = frame - delay;
  const inP = progress(f, 0, 14, Easing.out(Easing.cubic));
  // One size for every line, the largest that fits them all.
  let size = per({ landscape: 36, portrait: 36, square: 30 });
  const width = Math.min(box.w, 1300 * u);
  let fits: Fit[] = [];
  for (let k = 0; k < 12; k++) {
    fits = lines.map((l) => fitText(l, { face: th.body, maxSize: size, minSize: size, maxWidth: width, maxHeight: 9999, maxLines: 3, ready: true }));
    const total = fits.reduce((s, x) => s + x.lines.length * size * th.body.leading + 18 * u, 0);
    if (total <= box.h * 0.7 || size < 16 * u) break;
    size *= 0.9;
  }
  const label = CREDITS_LABEL[video.lang] ?? CREDITS_LABEL.en;
  return (
    <AbsoluteFill style={{ direction: th.rtl ? 'rtl' : 'ltr', background: th.bg, opacity: inP, fontFamily: th.body.family }}>
      <Backdrop intensity={0.5} />
      <div style={{ position: 'absolute', left: box.x, top: box.top, width: box.w, height: box.h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', transform: `translateY(${(1 - inP) * 20 * u}px)` }}>
        <div style={{ ...textStyle(th.body, 26 * u, th.accentText, true), letterSpacing: th.rtl ? undefined : '0.2em', textTransform: th.rtl ? undefined : 'uppercase' }}>{label}</div>
        <div style={{ width: 60 * u, height: Math.max(2, 3 * u), background: th.accent, marginTop: 22 * u, marginBottom: 40 * u }} />
        {fits.map((x, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 18 * u, direction: dirOf(lines[i], th.rtl ? 'rtl' : 'ltr') }}>
            {x.lines.map((l, j) => <div key={j} style={{ ...textStyle(th.body, size, th.muted), textAlign: 'center' }}>{l}</div>)}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}

function OutroView({ scene }: { scene: OutroScene }) {
  const info = useScene();
  const cf = creditsFrames(info);
  if (!cf) return <OutroMain scene={scene} frames={info.frames + 12} />;
  const start = info.frames - cf;
  return (
    <AbsoluteFill>
      <OutroMain scene={scene} frames={start + 6} />
      <CreditsCard lines={creditLines(info.video.scenes)} delay={start} />
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------

/** Draws one scene of any kind, given its context. */
export function SceneBody({ info }: { info: SceneInfo }) {
  const scene = info.video.scenes[info.index];
  let body: ReactNode = null;
  if (scene) {
    switch (scene.kind) {
      case 'title': body = <TitleView scene={scene} />; break;
      case 'kinetic': body = <KineticView scene={scene} />; break;
      case 'bullets': body = <BulletsView scene={scene} />; break;
      case 'stat': body = <StatView scene={scene} />; break;
      case 'chart': body = <ChartView scene={scene} />; break;
      case 'quote': body = <QuoteView scene={scene} />; break;
      case 'image': body = <ImageView scene={scene} />; break;
      case 'split': body = <SplitView scene={scene} />; break;
      case 'steps': body = <StepsView scene={scene} />; break;
      case 'outro': body = <OutroView scene={scene} />; break;
    }
  }
  return <SceneProvider value={info}>{body ?? <Stage><div /></Stage>}</SceneProvider>;
}
