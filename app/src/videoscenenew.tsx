/**
 * The four kinds the model's art direction brought: a typographic poster
 * (`bigtype`), features as icons and short labels (`features`), the scene's
 * picture inside a phone or a laptop (`device`), and one phrase scrolling
 * huge across the frame (`marquee`). videoscenemore.tsx `SceneBody` routes
 * them here.
 *
 * They keep the other kinds' rules (videoscenebits.tsx): no z-index,
 * filters, blend modes or perspective; words fitted here and drawn as lines
 * that never wrap, Arabic and Kurdish never split into letters or spaced; right
 * to left mirrored by `direction`; pictures only through `<Img>` (inside
 * `Photo`) with `object-fit`; icons and devices as static SVG or plain divs
 * moved by CSS transforms. They follow the look as the others do (`fitScaled`,
 * a set alignment) and the art: headlines arrive in the scene's effect through
 * `Lines`, with its emphasis, and `Stage` carries the ground, the shape and
 * the camera.
 */

import type { CSSProperties, ReactNode } from 'react';
import { Easing, useVideoConfig } from 'remotion';
import type { BigTypeScene, DeviceScene, FeaturesScene, IconId, MarqueeScene, Scene } from './videotypes';
import type { Align } from './videolook';
import { alpha, inkOn, mix, textWidth } from './videotheme';
import type { Emphasis } from './videotheme';
import { markPhrases } from './videoemphasis';
import type { Fit, Theme, TypeFace } from './videotheme';
import {
  Lines, Photo, Rule, enterAt, flexOf, glowOf, itemRevealOf, progress, revealStyle, staggerFor, textAlignOf, textStyle, useEnter, useScene, useSceneFrame,
} from './videoscenebits';
import { Stage, fit, fitScaled, per } from './videoscenekinds';
import { VideoIcon } from './videoicons';

/** Words cleaned for drawing: one space between them, none around. */
const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

/** The height of fitted lines in a face. */
const heightOf = (f: Fit, face: TypeFace) => f.lines.length * f.size * face.leading;

// ---------------------------------------------------------------------------
// Big type

/**
 * A typographic poster: one to four short lines stacked across the safe box,
 * each fitted on its own to the box's width — the first the largest, the
 * others never larger than it — then all scaled together until the stack
 * fits the box's height. They arrive one after another in the scene's
 * effect, with the scene's emphasis in the accent; a loud look (bold, or a
 * punchy design) draws every other line as an outline.
 */
function BigTypeView({ scene }: { scene: BigTypeScene }) {
  const { theme: th, box, look } = useScene();
  const frame = useSceneFrame();
  const u = box.u;
  const lines = (Array.isArray(scene.lines) ? scene.lines : []).map(clean).filter(Boolean).slice(0, 4);
  const shown = lines.length ? lines : [' '];
  const align: Align = th.align;
  const face: TypeFace = th.rtl ? th.display : { ...th.display, leading: th.display.leading * 0.94 };
  const top = per({ landscape: 300, portrait: 250, square: 240 }) * Math.max(1, look.textScale);
  const fits: Fit[] = [];
  for (let i = 0; i < shown.length; i++) {
    const cap = i === 0 ? top : Math.min(top * 0.8, fits[0].size);
    fits.push(fit(shown[i], face, { max: cap, min: 24 * u, width: box.w, height: 9999, lines: 1 }));
  }
  const rule = Math.max(4, 8 * u);
  const ruleRoom = rule + 44 * u;
  const stack = fits.reduce((s, f) => s + heightOf(f, face), 0);
  // The stack in the box's height (under the rule), and smaller still when the look asks for smaller words.
  const k = Math.min(1, (box.h - ruleRoom) / Math.max(1, stack)) * Math.min(1, look.textScale);
  const sizes = fits.map((f) => f.size * k);
  // One Lines for the whole poster, so typing and a highlight run across its lines in order; each line keeps its own size.
  const all: Fit = { size: sizes[0], lines: fits.map((f) => f.lines.join(' ')), width: Math.max(...fits.map((f) => f.width * k)), room: box.w };
  const outline = th.punchy ? (i: number) => (i % 2 === 1 ? th.fg : undefined) : undefined;
  return (
    <Stage box={{ justifyContent: 'center', alignItems: flexOf(align) }}>
      <Rule width={per({ landscape: 150, portrait: 130, square: 120 })} height={rule} color={th.accent} p={progress(frame, 2, 26, Easing.out(Easing.cubic))} align={align} style={{ marginBottom: 44 * u }} />
      <Lines fit={all} sizes={sizes} face={face} color={th.fg} delay={6} stagger={th.motion.stagger * 2} align={align} shadow={glowOf(th, u)} outline={outline} sheen={30} />
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// Features

/** A card's surface in a look: the style's own treatment, a tint of the ink on an accent or gradient ground. */
function cardOf(th: Theme, u: number): CSSProperties {
  const r = Math.min(th.radius, 30) * u;
  const hair = Math.max(1, 1.5 * u);
  if (th.ground === 'accent' || th.ground === 'gradient') return { background: alpha(th.fg, 0.1), borderRadius: r };
  switch (th.style) {
    case 'bold': return { background: th.surface, borderRadius: r };
    // Cards with no fill of their own veil what is behind them (a shape in the corner) in the ground's colour.
    case 'elegant': return { border: `${hair}px solid ${alpha(th.accent, 0.45)}`, background: alpha(th.bg, 0.72), borderRadius: r };
    case 'neon': return { border: `${Math.max(1, 2 * u)}px solid ${alpha(th.accent, 0.55)}`, background: alpha(th.accent, 0.06), boxShadow: `0 0 ${24 * u}px ${alpha(th.accent, 0.3)}`, borderRadius: r };
    case 'minimal': return { border: `${hair}px solid ${alpha(th.fg, 0.14)}`, background: th.dark ? alpha(th.bg, 0.72) : th.surface, borderRadius: r };
    case 'warm': return { background: th.surface, boxShadow: `0 ${10 * u}px ${30 * u}px ${alpha(th.fg, 0.08)}`, borderRadius: r };
    default: return { background: alpha(th.fg, th.dark ? 0.05 : 0.04), border: `${hair}px solid ${alpha(th.fg, 0.1)}`, borderRadius: r };
  }
}

/**
 * An icon in its badge, popping in with progress `p`: an accent square for
 * bold, a hairline ring for elegant, a glowing ring for neon, a plain frame
 * for minimal, and for the rest a disc (a rounded square in square-cornered
 * looks) in an accent gradient with the icon in its ink.
 */
function Badge(p: { icon: IconId; size: number; p: number }) {
  const { theme: th, box } = useScene();
  const u = box.u;
  const s = p.size;
  const ring = Math.max(1, (th.style === 'neon' ? 2.5 : 1.5) * u);
  let shell: CSSProperties;
  let ink: string;
  switch (th.style) {
    case 'bold':
      shell = { background: th.accent, borderRadius: 6 * u };
      ink = th.onAccent;
      break;
    case 'elegant':
      shell = { border: `${ring}px solid ${th.accent}`, borderRadius: '50%' };
      ink = th.accentText;
      break;
    case 'minimal':
      shell = { border: `${ring}px solid ${alpha(th.fg, 0.85)}` };
      ink = th.fg;
      break;
    case 'neon':
      shell = { border: `${ring}px solid ${th.accent}`, borderRadius: '50%', boxShadow: `0 0 ${22 * u}px ${alpha(th.accent, 0.6)}` };
      ink = th.accentText;
      break;
    default: {
      const far = mix(th.accent, th.accent2, 0.6);
      shell = { background: `linear-gradient(135deg, ${th.accent} 0%, ${far} 100%)`, borderRadius: th.radius >= 20 ? '50%' : Math.min(th.radius, 24) * u };
      ink = inkOn(mix(th.accent, th.accent2, 0.3));
    }
  }
  const icon = s * 0.5;
  return (
    <div style={{ width: s, height: s, flexShrink: 0, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', ...shell, transform: `scale(${Math.max(0, Math.min(1.12, p.p)).toFixed(4)})`, opacity: Math.min(1, p.p * 1.6) }}>
      <VideoIcon id={p.icon} size={icon} color={ink} stroke={s > 110 * u ? 1.6 : 1.8} />
    </div>
  );
}

/**
 * Two to four features, each an icon in its badge and a short label, with
 * an optional heading: cards in a row in a wide frame (two rows of two in a
 * square with four), a list of rows — badge beside label — in a tall one.
 * Every label takes one size, the largest at which all of them fit; cards,
 * badges and labels arrive one after another.
 */
function FeaturesView({ scene }: { scene: FeaturesScene }) {
  const info = useScene();
  const { theme: th, box, frames } = info;
  const frame = useSceneFrame();
  const { fps } = useVideoConfig();
  const u = box.u;
  const items = (Array.isArray(scene.items) ? scene.items : []).filter((x) => x && clean(x.label)).slice(0, 4);
  const n = Math.max(1, items.length);
  const list = box.format === 'portrait';
  const grid = box.format === 'square' && n === 4;
  const heading = clean(scene.heading);
  const headAlign: Align = th.alignSet ? th.align : list ? 'start' : 'center';
  const headFit = heading ? fitScaled(heading, th.display, { max: per({ landscape: 96, portrait: 104, square: 76 }), min: 40 * u, width: box.w, height: box.h * 0.24, lines: 2 }) : null;
  const headH = headFit ? heightOf(headFit, th.display) : 0;
  const below = headFit ? per({ landscape: 70, portrait: 80, square: 48 }) : 0;
  const areaH = box.h - headH - below;
  const d0 = 4 + (headFit ? headFit.lines.length * th.motion.stagger : 0);
  const st = staggerFor(th, frames, n, 0.45, d0);
  const mode = itemRevealOf(info);
  const card = cardOf(th, u);
  const face = th.display;
  const head = headFit ? (
    <>
      <Lines fit={headFit} face={th.display} color={th.fg} delay={2} stagger={th.motion.stagger * 1.4} shadow={glowOf(th, u)} align={headAlign} style={{ alignSelf: flexOf(headAlign) }} />
      <div style={{ height: below }} />
    </>
  ) : null;

  if (list) {
    const gapY = 26 * u;
    const rowH = Math.min((areaH - gapY * (n - 1)) / n, 300 * u);
    const pad = 30 * u;
    const badge = Math.min(rowH - 2 * pad, 150 * u);
    const labelW = box.w - 2 * pad - badge - 40 * u;
    const size = Math.min(...items.map((x) => fitScaled(clean(x.label), face, { max: per({ landscape: 60, portrait: 64, square: 52 }), min: 26 * u, width: labelW, height: rowH - 2 * pad, lines: 2 }).size));
    return (
      <Stage box={{ justifyContent: 'center' }}>
        {head}
        <div style={{ display: 'flex', flexDirection: 'column', gap: gapY }}>
          {items.map((x, i) => {
            const d = d0 + i * st;
            const e = enterAt(frame - d, fps, th);
            const f = fit(clean(x.label), face, { max: size, min: size, width: labelW, height: 9999, lines: 2 });
            return (
              <div key={i} style={{ height: rowH, boxSizing: 'border-box', padding: pad, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 40 * u, ...card, ...revealStyle(mode, e, th.motion.travel * u, 'start', th.rtl) }}>
                <Badge icon={x.icon} size={badge} p={enterAt(frame - d - 4, fps, th)} />
                <Lines fit={f} face={face} color={th.fg} delay={d + 6} stagger={th.motion.stagger} mode={mode} align="start" />
              </div>
            );
          })}
        </div>
      </Stage>
    );
  }

  const cols = grid ? 2 : n;
  const rows = grid ? 2 : 1;
  const gap = per({ landscape: 40, portrait: 30, square: 28 });
  const cardW = (box.w - gap * (cols - 1)) / cols;
  const cardH = Math.min((areaH - gap * (rows - 1)) / rows, cardW * (grid ? 0.9 : 1.1));
  const pad = per({ landscape: 40, portrait: 36, square: 30 });
  const badge = Math.min(cardW * 0.36, cardH * 0.4, 160 * u);
  const labelW = cardW - 2 * pad;
  const labelH = cardH - 2 * pad - badge - 30 * u;
  const size = Math.min(...items.map((x) => fitScaled(clean(x.label), face, { max: per({ landscape: 56, portrait: 56, square: 44 }), min: 24 * u, width: labelW, height: labelH, lines: 3 }).size));
  return (
    <Stage box={{ justifyContent: 'center' }}>
      {head}
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap, width: box.w, justifyContent: 'center' }}>
        {items.map((x, i) => {
          const d = d0 + i * st;
          const e = enterAt(frame - d, fps, th);
          const f = fit(clean(x.label), face, { max: size, min: size, width: labelW, height: 9999, lines: 3 });
          return (
            <div key={i} style={{ width: cardW, height: cardH, boxSizing: 'border-box', padding: pad, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 30 * u, ...card, ...revealStyle(mode === 'fade' ? 'fade' : 'rise', e, th.motion.travel * u) }}>
              <Badge icon={x.icon} size={badge} p={enterAt(frame - d - 4, fps, th)} />
              <Lines fit={f} face={face} color={th.fg} delay={d + 6} stagger={th.motion.stagger} mode={mode} align="center" />
            </div>
          );
        })}
      </div>
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// Device

/**
 * A phone's body: rounded, a thin rim, a pill at the top of the screen, side
 * buttons; the screen is `children`, clipped by its rounded corners
 * (`border-radius` with `overflow: hidden` — the exporter drops the `round`
 * of a `clip-path: inset`).
 */
function Phone(p: { w: number; h: number; th: Theme; children: ReactNode }) {
  const { w, h, th } = p;
  const r = w * 0.16;
  const bezel = w * 0.034;
  const body = th.dark ? mix(th.bg, '#000000', 0.5) : '#141418';
  const rim = th.dark ? alpha('#FFFFFF', 0.22) : alpha('#000000', 0.35);
  const button = th.dark ? mix(body, '#FFFFFF', 0.18) : '#2A2A30';
  const sr = r - bezel;
  return (
    <div style={{ position: 'relative', width: w, height: h, flexShrink: 0 }}>
      <div style={{ position: 'absolute', left: w - 1, top: h * 0.22, width: w * 0.014, height: h * 0.1, background: button, borderRadius: w * 0.01 }} />
      <div style={{ position: 'absolute', left: -w * 0.014 + 1, top: h * 0.18, width: w * 0.014, height: h * 0.06, background: button, borderRadius: w * 0.01 }} />
      <div style={{ position: 'absolute', left: -w * 0.014 + 1, top: h * 0.26, width: w * 0.014, height: h * 0.06, background: button, borderRadius: w * 0.01 }} />
      <div style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, borderRadius: r, background: body, border: `${Math.max(1.5, w * 0.008)}px solid ${rim}`, boxSizing: 'border-box', boxShadow: `0 ${w * 0.08}px ${w * 0.2}px rgba(0, 0, 0, ${th.dark ? 0.55 : 0.28})` }} />
      <div style={{ position: 'absolute', left: bezel, top: bezel, width: w - 2 * bezel, height: h - 2 * bezel, background: '#000000', overflow: 'hidden', borderRadius: sr }}>
        {p.children}
        <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', background: 'linear-gradient(115deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0) 40%)' }} />
      </div>
      <div style={{ position: 'absolute', left: w / 2 - w * 0.14, top: bezel + w * 0.03, width: w * 0.28, height: w * 0.075, borderRadius: w * 0.04, background: '#000000' }} />
    </div>
  );
}

/** A laptop: the lid with its screen (`children`) and camera dot, and the base under it, wider, with its notch. */
function Laptop(p: { w: number; th: Theme; children: ReactNode }) {
  const { w, th } = p;
  const lidH = w * 0.64;
  const bezel = w * 0.026;
  const baseH = w * 0.042;
  const baseW = w * 1.16;
  const body = th.dark ? mix(th.bg, '#000000', 0.5) : '#141418';
  const rim = th.dark ? alpha('#FFFFFF', 0.22) : alpha('#000000', 0.35);
  const metal = th.dark ? mix(th.surface, '#FFFFFF', 0.28) : '#C9CBD1';
  const r = w * 0.028;
  return (
    <div style={{ position: 'relative', width: baseW, height: lidH + baseH, flexShrink: 0 }}>
      <div style={{ position: 'absolute', left: (baseW - w) / 2, top: 0, width: w, height: lidH, borderRadius: `${r}px ${r}px ${r * 0.3}px ${r * 0.3}px`, background: body, border: `${Math.max(1.5, w * 0.004)}px solid ${rim}`, boxSizing: 'border-box', boxShadow: `0 ${w * 0.04}px ${w * 0.1}px rgba(0, 0, 0, ${th.dark ? 0.5 : 0.25})` }} />
      <div style={{ position: 'absolute', left: (baseW - w) / 2 + bezel, top: bezel * 1.3, width: w - 2 * bezel, height: lidH - bezel * 1.3 - bezel * 1.9, background: '#000000', overflow: 'hidden', borderRadius: r * 0.35 }}>
        {p.children}
        <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', background: 'linear-gradient(120deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0) 42%)' }} />
      </div>
      <div style={{ position: 'absolute', left: baseW / 2 - bezel * 0.2, top: bezel * 0.45, width: bezel * 0.4, height: bezel * 0.4, borderRadius: '50%', background: alpha('#FFFFFF', 0.28) }} />
      <div style={{ position: 'absolute', left: 0, top: lidH - 1, width: baseW, height: baseH, borderRadius: `${baseH * 0.2}px ${baseH * 0.2}px ${baseH * 0.9}px ${baseH * 0.9}px`, background: `linear-gradient(180deg, ${metal} 0%, ${mix(metal, '#000000', 0.35)} 100%)` }} />
      <div style={{ position: 'absolute', left: baseW / 2 - w * 0.08, top: lidH - 1, width: w * 0.16, height: baseH * 0.38, borderRadius: `0 0 ${baseH * 0.3}px ${baseH * 0.3}px`, background: mix(metal, '#000000', 0.22) }} />
    </div>
  );
}

/**
 * The scene's picture on a phone's or a laptop's screen, with the heading and
 * a line beside it (a wide frame: the device on the end side) or under it (a
 * tall or square one). The device rises in with a slight tilt that settles,
 * then floats. With no picture the screen is an accent gradient with the
 * heading on it, like an app's first screen, and the words beside keep only
 * the line.
 */
function DeviceView({ scene }: { scene: DeviceScene }) {
  const { theme: th, box, frames, index } = useScene();
  const frame = useSceneFrame();
  const { fps } = useVideoConfig();
  const u = box.u;
  const pic = scene.picture?.src;
  const kind: 'phone' | 'laptop' = scene.device === 'laptop' || scene.device === 'phone' ? scene.device : box.format === 'landscape' ? 'laptop' : 'phone';
  const side = box.format === 'landscape';
  const heading = clean(scene.heading);
  const text = clean(scene.text);
  // The words that sit beside or under the device: with no picture, the heading is on the screen instead.
  const headWords = pic ? heading : '';
  const hasWords = !!(headWords || text);
  const gap = per({ landscape: 90, portrait: 70, square: 50 });
  const areaW = side ? (hasWords ? box.w * (kind === 'laptop' ? 0.56 : 0.4) : box.w) : box.w;
  const areaH = side ? box.h : hasWords ? box.h * (box.format === 'portrait' ? 0.6 : 0.58) : box.h;
  let devW: number;
  let devH: number;
  if (kind === 'phone') {
    devH = Math.min(areaH, (areaW * 0.95) / 0.49);
    devW = devH * 0.49;
  } else {
    const w = Math.min(areaW / 1.16, areaH / (0.64 + 0.042));
    devW = w * 1.16;
    devH = w * (0.64 + 0.042);
  }
  const textW = side ? box.w - devW - gap : box.w;
  const textH = side ? box.h : box.h - devH - gap;
  const align: Align = th.alignSet ? th.align : side ? 'start' : 'center';
  const headFit = headWords ? fitScaled(headWords, th.display, { max: per({ landscape: 96, portrait: 92, square: 66 }), min: 36 * u, width: textW, height: textH * (text ? 0.55 : 0.9), lines: side ? 4 : 2 }) : null;
  const headH = headFit ? heightOf(headFit, th.display) : 0;
  // With the heading on the screen, the line beside it is the words' whole voice, and larger.
  const bodyMax = per({ landscape: 42, portrait: 44, square: 34 }) * (headFit ? 1 : 1.35);
  const bodyFit = text ? fitScaled(text, th.body, { max: bodyMax, min: 22 * u, width: textW, height: Math.max(40 * u, textH - headH - 60 * u), lines: side ? 6 : 3, bold: !headFit }) : null;
  const e = enterAt(frame - 2, fps, th, 1.3);
  const settle = Math.max(0, Math.min(1.05, e));
  const float = Math.sin((frame / fps) * 1.2) * 7 * u * Math.min(1, settle);
  const tilt = (th.rtl ? -1 : 1) * 5 * (1 - Math.min(1, settle));
  const bodyP = useEnter(12 + (headFit ? headFit.lines.length * th.motion.stagger : 0));
  const screenW = kind === 'phone' ? devW * (1 - 2 * 0.034) : (devW / 1.16) * (1 - 2 * 0.026);
  const screenH = kind === 'phone' ? devH - 2 * devW * 0.034 : (devW / 1.16) * (0.64 - 0.026 * 3.2);
  // The splash: an app mark, the heading, two placeholder lines — all inside the screen's height.
  const splash = !pic && heading ? fit(heading, th.display, { max: screenW * (kind === 'phone' ? 0.15 : 0.1), min: 12 * u, width: screenW * 0.8, height: screenH - screenW * 0.42, lines: 4 }) : null;
  const splashInk = inkOn(mix(th.accent, th.accent2, 0.35));
  const screen = pic ? (
    <Photo src={pic} seed={index} frames={frames} strength={0.6} fit="cover" />
  ) : (
    <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', background: `linear-gradient(150deg, ${th.accent} 0%, ${mix(th.accent, th.accent2, 0.7)} 100%)`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', direction: th.rtl ? 'rtl' : 'ltr' }}>
      <div style={{ width: screenW * 0.14, height: screenW * 0.14, borderRadius: screenW * 0.04, background: alpha(splashInk, 0.9), marginBottom: screenW * 0.06, transform: `scale(${progress(frame, 10, 26, Easing.out(Easing.back(1.6))).toFixed(4)})` }} />
      {splash ? splash.lines.map((l, i) => <div key={i} style={{ ...textStyle(th.display, splash.size, splashInk), textAlign: 'center', opacity: progress(frame, 14 + i * 3, 26 + i * 3) }}>{l}</div>) : null}
      {[0.5, 0.38].map((w, i) => (
        <div key={i} style={{ width: screenW * w, height: Math.max(3, screenW * 0.025), borderRadius: screenW * 0.02, background: alpha(splashInk, 0.28), marginTop: screenW * (i ? 0.03 : 0.08), transform: `scaleX(${progress(frame, 20 + i * 4, 36 + i * 4, Easing.out(Easing.cubic)).toFixed(4)})` }} />
      ))}
    </div>
  );
  const device = (
    <div style={{ width: side ? devW : box.w, height: devH, display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0, opacity: Math.min(1, settle * 1.5), transform: `translateY(${((1 - Math.min(1, settle)) * 120 * u + float).toFixed(2)}px) rotate(${tilt.toFixed(3)}deg)` }}>
      {kind === 'phone' ? <Phone w={devW} h={devH} th={th}>{screen}</Phone> : <Laptop w={devW / 1.16} th={th}>{screen}</Laptop>}
    </div>
  );
  const words = hasWords ? (
    <div style={{ width: textW, display: 'flex', flexDirection: 'column', alignItems: flexOf(align), justifyContent: 'center' }}>
      {headFit ? <Lines fit={headFit} face={th.display} color={th.fg} delay={10} stagger={th.motion.stagger * 1.4} shadow={glowOf(th, u)} align={align} /> : null}
      {headFit && bodyFit ? <Rule width={100 * u} height={Math.max(3, 6 * u)} color={th.accent} p={progress(frame, 16, 40, Easing.out(Easing.cubic))} align={align} style={{ marginTop: 28 * u, marginBottom: 28 * u }} /> : null}
      {bodyFit ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: flexOf(align), ...revealStyle('rise', bodyP, 26 * u) }}>
          {bodyFit.lines.map((l, i) => <div key={i} style={{ ...textStyle(th.body, bodyFit.size, headFit ? th.muted : th.fg, !headFit), textAlign: textAlignOf(align) }}>{l}</div>)}
        </div>
      ) : null}
    </div>
  ) : null;
  if (side) {
    // Words on the start side, the device on the end side (the row follows the scene's direction); set to the end, they swap.
    return (
      <Stage box={{ flexDirection: align === 'end' ? 'row-reverse' : 'row', alignItems: 'center', justifyContent: hasWords ? 'space-between' : 'center', gap }}>
        {words}
        {device}
      </Stage>
    );
  }
  return (
    <Stage box={{ justifyContent: 'center', alignItems: 'center', gap }}>
      {device}
      {words}
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// Marquee

/**
 * The phrase as a row shows it: split at its spaces, never inside a word,
 * when it carries emphasis — the emphasised words in the accent (its stroke
 * on an outlined row); where the accent is the words' own colour (an accent
 * ground), they take the other treatment instead: outlined in a filled row,
 * filled in an outlined one.
 */
function marqueeWords(phrase: string, th: Theme, emphasis: Emphasis, stroke: string, outlined: boolean): ReactNode {
  if (!emphasis.length) return phrase;
  const words = phrase.split(' ');
  const marks = markPhrases(words, emphasis);
  if (!marks.some(Boolean)) return phrase;
  const own = th.accentText !== th.fg;
  const style: CSSProperties = own
    ? outlined ? { WebkitTextStroke: `${stroke} ${th.accentText}` } : { color: th.accentText }
    : outlined ? { color: th.fg, WebkitTextStroke: '0px transparent' } : { color: 'transparent', WebkitTextStroke: `${stroke} ${th.fg}`, textShadow: 'none' };
  const out: ReactNode[] = [];
  words.forEach((w, i) => {
    if (i) out.push(' ');
    out.push(marks[i] ? <span key={i} style={style}>{w}</span> : w);
  });
  return out;
}

/**
 * A phrase, huge, in rows that scroll across the frame in alternating
 * directions — the first toward where the language reads from, so each copy
 * arrives the way it is read — one row filled, the next outlined, with a
 * small accent mark between copies. Each copy sits in a box exactly one
 * period wide, so the scroll wraps by exactly a period and never jumps. The
 * rows stay inside the safe box's height (a vertical frame's top and foot
 * are the phone apps'), and run past both sides of the frame. `sub`, when
 * there is one, is a calm line in the middle band between the rows. The rows
 * lean a few degrees in a wide or square frame.
 */
function MarqueeView({ scene }: { scene: MarqueeScene }) {
  const info = useScene();
  const { theme: th, box, ready, look } = info;
  const frame = useSceneFrame();
  const { fps } = useVideoConfig();
  const u = box.u;
  const W = box.width;
  const phrase = clean(scene.text) || ' ';
  const sub = clean(scene.sub);
  const n = box.format === 'portrait' ? (sub ? 4 : 5) : sub ? 2 : 3;
  const face = th.display;
  const subFit = sub ? fitScaled(sub, th.body, { max: per({ landscape: 46, portrait: 48, square: 40 }), min: 24 * u, width: box.w * 0.9, height: box.h * 0.2, lines: 2, bold: true }) : null;
  const subBand = subFit ? heightOf(subFit, th.body) + 70 * u : 0;
  const lead = th.rtl ? face.leading : Math.max(1, face.leading);
  const size = Math.min(per({ landscape: 230, portrait: 220, square: 200 }) * look.textScale, (box.h - subBand) / (n * lead));
  const rowH = size * lead;
  const textW = Math.max(size, textWidth(phrase, face, size, false, ready));
  const mark = size * 0.16;
  const period = textW + size * 0.62;
  const copies = Math.ceil((W + period) / period) + 1;
  const speed = W * 0.0032;
  const lean = box.format === 'portrait' ? 0 : (th.rtl ? 3 : -3);
  const stroke = Math.max(1.5, size * 0.02);
  // Rows run past both edges of the frame, so a drifting or tilting camera never shows where they end.
  const bleed = W * 0.05;
  const blockH = n * rowH + subBand;
  const topOf = (i: number) => (box.h - blockH) / 2 + i * rowH + (subFit && i >= n / 2 ? subBand : 0);
  const subP = useEnter(10 + n * 3);
  const rows: ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const outline = i % 2 === 1;
    // Row 0 moves toward where the language reads from; the next the other way.
    const leftward = (i % 2 === 0) !== th.rtl;
    const shift = (frame * speed * (1 + 0.18 * (i % 3)) + i * period * 0.37) % period;
    const x = leftward ? -shift : -period + shift;
    const reveal = Math.max(0, Math.min(1, enterAt(frame - 2 - i * 3, fps, th)));
    const text: CSSProperties = {
      ...textStyle(face, size, outline ? 'transparent' : th.fg),
      lineHeight: `${rowH}px`,
      WebkitTextStroke: outline ? `${stroke.toFixed(2)}px ${alpha(th.fg, 0.85)}` : undefined,
      textShadow: outline ? undefined : glowOf(th, u),
      direction: th.rtl ? 'rtl' : 'ltr',
    };
    const units: ReactNode[] = [];
    for (let c = 0; c < copies; c++) {
      units.push(
        <div key={c} style={{ position: 'relative', width: period, height: rowH, flexShrink: 0, direction: th.rtl ? 'rtl' : 'ltr' }}>
          <div style={{ position: 'absolute', top: 0, [th.rtl ? 'right' : 'left']: 0, ...text }}>{marqueeWords(phrase, th, info.emphasis, `${stroke.toFixed(2)}px`, outline)}</div>
          <div style={{ position: 'absolute', top: rowH / 2 - mark / 2, [th.rtl ? 'left' : 'right']: (size * 0.62 - mark) / 2, width: mark, height: mark, borderRadius: th.radius ? '50%' : 0, background: i % 2 ? th.accent2 : th.accent, transform: th.radius ? undefined : 'rotate(45deg)' }} />
        </div>,
      );
    }
    rows.push(
      <div key={i} style={{ position: 'absolute', left: -box.x - bleed, top: topOf(i), width: W + 2 * bleed, height: rowH, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: x, top: 0, height: rowH, display: 'flex', flexDirection: 'row', direction: 'ltr', transform: `translateY(${((1 - reveal) * 100).toFixed(2)}%)`, opacity: reveal }}>
          {units}
        </div>
      </div>,
    );
  }
  return (
    <Stage box={{}}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: box.w, height: box.h, transform: lean ? `rotate(${lean}deg)` : undefined }}>
        {rows}
      </div>
      {subFit ? (
        <div style={{ position: 'absolute', left: 0, top: topOf(0) + (Math.ceil(n / 2)) * rowH + 35 * u, width: box.w, display: 'flex', flexDirection: 'column', alignItems: 'center', ...revealStyle('rise', subP, 24 * u) }}>
          {subFit.lines.map((l, i) => <div key={i} style={{ ...textStyle(th.body, subFit.size, th.fg, true), textAlign: 'center' }}>{l}</div>)}
        </div>
      ) : null}
    </Stage>
  );
}

// ---------------------------------------------------------------------------

/** The four new kinds' views, or null for any other kind. */
export function newKindView(scene: Scene): ReactNode | null {
  switch (scene.kind) {
    case 'bigtype': return <BigTypeView scene={scene} />;
    case 'features': return <FeaturesView scene={scene} />;
    case 'device': return <DeviceView scene={scene} />;
    case 'marquee': return <MarqueeView scene={scene} />;
    default: return null;
  }
}
