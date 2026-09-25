/**
 * Where everything on a slide goes, decided once.
 *
 * A slide is drawn three times — in the panel (SlideView.tsx), in the
 * PowerPoint file (slidespptx.ts) and in the PDF, which is the panel's drawing
 * printed. If each drew its own, a title that fits on screen would wrap on the
 * projector, and the person would find out in front of a committee. So this
 * turns a slide into boxes — rectangles, text, a picture, a table — on a
 * 1280 × 720 canvas, and every renderer only places the boxes it is given.
 * 1280 px is 13⅓ inches at 96 to the inch, which is PowerPoint's own 16:9
 * slide, so a pixel here is exactly 9525 EMU there and ¾ of a point.
 *
 * ## Sizes are chosen, not left to the renderer
 *
 * Nothing here can measure text: it runs in tests, in the PowerPoint builder
 * and in the webview alike. So a text box's size is fitted from an estimate —
 * characters times an average advance for their script, wrapped at word
 * boundaries — stepping down from the largest size that looks right until the
 * estimate fits. It errs on the side of room: a size one step too small is
 * invisible, a line that runs off a slide is not.
 *
 * ## Right to left is a mirror
 *
 * Every layout is written for a left-to-right deck, and an Arabic or Kurdish
 * one is the same boxes reflected: the accent bar on the right, the first
 * column of a comparison on the right, a timeline that starts at the right and
 * runs left. Text inside a box is aligned to its start, which is the right in
 * those languages; that is the renderer's to know from `rtl`.
 */

import type { Deck, Slide, Theme } from './slides';
import { byWords, digitsOf, isRtl } from './slides';

export const W = 1280;
export const H = 720;

// ── colour ────────────────────────────────────────────────────────────────

export interface Palette {
  /** Behind a content slide. */
  bg: string;
  ink: string;
  muted: string;
  accent: string;
  /** Behind the title, section and closing slides. */
  band: string;
  onBand: string;
  onBandMuted: string;
  /** Behind a card, a column, a quotation. */
  soft: string;
  /** A rule: the timeline's line, a table's row divider. */
  line: string;
}

export const PALETTES: Readonly<Record<Theme, Palette>> = {
  academic: { bg: '#FFFFFF', ink: '#1B2A41', muted: '#5B6B82', accent: '#B07D12', band: '#1B2A41', onBand: '#FFFFFF', onBandMuted: '#C9D3E0', soft: '#F1F4F8', line: '#CBD3DE' },
  modern: { bg: '#FFFFFF', ink: '#111827', muted: '#6B7280', accent: '#4F46E5', band: '#4F46E5', onBand: '#FFFFFF', onBandMuted: '#DCDAFB', soft: '#EEF2FF', line: '#D1D5DB' },
  elegant: { bg: '#FAF7F2', ink: '#2B2118', muted: '#7A6A58', accent: '#9C6B30', band: '#2B2118', onBand: '#F5E9D6', onBandMuted: '#CDBBA3', soft: '#F0E8DC', line: '#DCCFBE' },
  bold: { bg: '#FFFFFF', ink: '#0F0F0F', muted: '#505050', accent: '#E63946', band: '#0F0F0F', onBand: '#FFFFFF', onBandMuted: '#BDBDBD', soft: '#FDECEE', line: '#D6D6D6' },
  minimal: { bg: '#FFFFFF', ink: '#222222', muted: '#777777', accent: '#222222', band: '#F2F2F2', onBand: '#111111', onBandMuted: '#555555', soft: '#F6F6F6', line: '#DDDDDD' },
  warm: { bg: '#FFF8F0', ink: '#3D2C1E', muted: '#8A6F58', accent: '#D9480F', band: '#D9480F', onBand: '#FFFFFF', onBandMuted: '#FFE1CF', soft: '#FDEBDD', line: '#EBD5C3' },
};

const HEX = /^#[0-9a-f]{6}$/i;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Relative luminance, as WCAG defines it. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** `a` moved toward `b` by `t`, as a hex colour. */
function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return `#${x.map((c, i) => Math.round(c + (y[i] - c) * t).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/**
 * The deck's colours: its theme's, with the brand's in place of the band and
 * the accent. Text on a brand band is white or near-black, whichever reads —
 * a university's pale gold under white text is a slide nobody at the back of
 * the room can read.
 */
export function paletteOf(deck: Pick<Deck, 'theme' | 'brand'>): Palette {
  const p = PALETTES[deck.theme] ?? PALETTES.academic;
  const band = deck.brand?.primary && HEX.test(deck.brand.primary) ? deck.brand.primary.toUpperCase() : null;
  const accent = deck.brand?.accent && HEX.test(deck.brand.accent) ? deck.brand.accent.toUpperCase() : null;
  if (!band && !accent) return p;
  const out = { ...p };
  if (band) {
    out.band = band;
    out.onBand = luminance(band) > 0.45 ? '#111111' : '#FFFFFF';
    out.onBandMuted = mix(out.onBand, band, 0.28);
  }
  if (accent) out.accent = accent;
  return out;
}

// ── boxes ─────────────────────────────────────────────────────────────────

export type Align = 'start' | 'center' | 'end';

export interface Para {
  text: string;
  /** In pixels of the 1280-wide canvas. */
  size: number;
  color: string;
  bold?: boolean;
  /** A bullet before it, in this colour. */
  bullet?: string;
  /** Room above it, in pixels. */
  gap?: number;
  /**
   * Its own direction, when its script says so: an English reference in an
   * Arabic deck reads left to right, or its full stop lands at its start.
   * Undefined follows the box.
   */
  rtl?: boolean;
}

export interface TextBox {
  t: 'text';
  x: number; y: number; w: number; h: number;
  paras: Para[];
  align: Align;
  valign: 'top' | 'middle' | 'bottom';
  rtl: boolean;
  /** Line height, as a multiple of the size. */
  lineH: number;
  /** Which of the slide's fields it shows, so a click on it can open that field. */
  field?: string;
}

export interface RectBox {
  t: 'rect';
  x: number; y: number; w: number; h: number;
  fill: string;
  /** Corner radius in pixels; half the height makes a dot. */
  radius?: number;
}

export interface ImageBox {
  t: 'image';
  /** The box the picture is fitted into, keeping its shape. */
  x: number; y: number; w: number; h: number;
  src: string;
}

export interface TableBox {
  t: 'table';
  x: number; y: number; w: number; h: number;
  rows: string[][];
  size: number;
  rowH: number;
  headFill: string;
  headInk: string;
  ink: string;
  line: string;
  stripe: string;
  rtl: boolean;
  field: string;
}

export type Box = TextBox | RectBox | ImageBox | TableBox;

export interface Drawn {
  bg: string;
  boxes: Box[];
}

// ── fitting text ──────────────────────────────────────────────────────────

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g;

/** The average advance of a character in `text`, in ems. Arabic script runs narrower than Latin. */
function advance(text: string, bold: boolean): number {
  const n = Array.from(text).length || 1;
  const arabic = (text.match(ARABIC)?.length ?? 0) / n;
  return (0.53 - 0.07 * arabic) * (bold ? 1.06 : 1);
}

/** Lines `text` wraps to at `size` in `width`, breaking at spaces as a renderer does. */
export function linesOf(text: string, size: number, width: number, bold = false): number {
  if (!text) return 1;
  const per = Math.max(1, Math.floor(width / (size * advance(text, bold))));
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const len = Array.from(word).length;
    const need = used ? used + 1 + len : len;
    if (need <= per) { used = need; continue; }
    if (used) lines += 1;
    // A word longer than the line breaks where it must.
    lines += Math.floor((len - 1) / per);
    used = ((len - 1) % per) + 1;
  }
  return lines;
}

interface Fitting { width: number; height: number; max: number; min: number; lineH: number; gapEm?: number; bold?: boolean; indent?: number }

/** The largest size, from `max` down to `min`, at which every text fits the box by estimate. */
export function fit(texts: readonly string[], f: Fitting): number {
  const list = texts.length ? texts : [''];
  for (let size = f.max; size > f.min; size -= 1) {
    const w = f.width - (f.indent ? f.indent * size : 0);
    let h = 0;
    list.forEach((t, i) => {
      h += linesOf(t, size, w, f.bold) * size * f.lineH + (i ? (f.gapEm ?? 0) * size : 0);
    });
    if (h <= f.height) return size;
  }
  return f.min;
}

// ── the layouts ───────────────────────────────────────────────────────────

/** The hanging indent of a bullet, in ems: the bullet sits in it. */
export const BULLET_INDENT = 1.1;

/** The content area of a slide with a title bar. */
const BODY = { x: 80, y: 196, w: 1120, h: 452 };

/** Every box of a layout, reflected for a right-to-left deck. */
function mirrored(boxes: Box[]): Box[] {
  return boxes.map((b) => ({ ...b, x: W - b.x - b.w }));
}

/**
 * A paragraph's direction by its letters: Arabic script reads right to left,
 * Latin with none left to right, and digits alone take the box's.
 */
export function dirOf(text: string, rtl: boolean): boolean {
  if (/[\u0600-\u06FF\u0750-\u077F]/.test(text)) return true;
  return /\p{L}/u.test(text) ? false : rtl;
}

function text(x: number, y: number, w: number, h: number, paras: Para[], o: Partial<Omit<TextBox, 't' | 'x' | 'y' | 'w' | 'h' | 'paras'>> & { rtl: boolean }): TextBox {
  const own = paras.map((p) => {
    const dir = dirOf(p.text, o.rtl);
    return dir === o.rtl ? p : { ...p, rtl: dir };
  });
  return { t: 'text', x, y, w, h, paras: own, align: o.align ?? 'start', valign: o.valign ?? 'top', rtl: o.rtl, lineH: o.lineH ?? 1.25, ...(o.field ? { field: o.field } : {}) };
}

/**
 * Lay one slide out.
 *
 * `index` is its place in the deck, from zero, for the number in its corner.
 * Every string shown goes through `digitsOf` here, once, so the renderers
 * never decide how a number is written.
 */
export function layout(slide: Slide, deck: Deck, index: number): Drawn {
  const p = paletteOf(deck);
  const rtl = isRtl(deck.lang);
  const d = (s: string) => digitsOf(s, deck);
  const boxes: Box[] = [];
  const logo = deck.logo ? { src: deck.logo } : null;

  /** The title bar every content slide has: its title, a short accent rule, the logo in the corner. */
  const titleBar = () => {
    const w = logo ? 1010 : 1120;
    const t = d(slide.title);
    const size = fit([t], { width: w, height: 104, max: 52, min: 26, lineH: 1.15, bold: true });
    boxes.push(text(80, 48, w, 108, [{ text: t, size, color: p.ink, bold: true }], { rtl, valign: 'bottom', lineH: 1.15, field: 'title' }));
    boxes.push({ t: 'rect', x: 80, y: 166, w: 88, h: 6, fill: p.accent, radius: 3 });
    if (logo) boxes.push({ t: 'image', x: 1112, y: 52, w: 88, h: 88, src: logo.src });
  };

  /** The deck's title and the slide's number, small, along the foot. */
  const footer = () => {
    boxes.push(text(80, 668, 900, 28, [{ text: d(deck.title), size: 15, color: p.muted }], { rtl, valign: 'middle' }));
    boxes.push(text(1080, 668, 120, 28, [{ text: d(String(index + 1)), size: 16, color: p.muted, bold: true }], { rtl, align: 'end', valign: 'middle' }));
  };

  /** A list of points, fitted to its box, each with an accent bullet. */
  const points = (list: string[], x: number, y: number, w: number, h: number, o: { max: number; min: number; field: string; bullet?: boolean; color?: string }) => {
    // A line being typed is empty for a moment; it is not a bullet yet.
    const shown = list.filter((x) => x.trim()).map(d);
    const size = fit(shown, { width: w, height: h, max: o.max, min: o.min, lineH: 1.3, gapEm: 0.55, indent: o.bullet === false ? 0 : BULLET_INDENT });
    boxes.push(text(x, y, w, h, shown.map((t, i) => ({
      text: t, size, color: o.color ?? p.ink, ...(o.bullet === false ? {} : { bullet: p.accent }), ...(i ? { gap: Math.round(size * 0.55) } : {}),
    })), { rtl, lineH: 1.3, field: o.field }));
  };

  let bg = p.bg;
  switch (slide.kind) {
    case 'title': {
      bg = p.band;
      if (logo) boxes.push({ t: 'image', x: 540, y: 44, w: 200, h: 124, src: logo.src });
      const place = [deck.meta.university, deck.meta.college].map((s) => d(s.trim())).filter(Boolean);
      if (place.length) {
        const size = fit(place, { width: 1040, height: 66, max: 28, min: 15, lineH: 1.25 });
        boxes.push(text(120, 176, 1040, 66, place.map((t, i) => ({ text: t, size: i ? Math.round(size * 0.85) : size, color: p.onBandMuted, bold: i === 0 })), { rtl, align: 'center', valign: 'middle' }));
      }
      const t = d(slide.title || deck.title);
      const ts = fit([t], { width: 1080, height: 190, max: 68, min: 32, lineH: 1.18, bold: true });
      boxes.push(text(100, 250, 1080, 190, [{ text: t, size: ts, color: p.onBand, bold: true }], { rtl, align: 'center', valign: 'middle', lineH: 1.18, field: 'title' }));
      if (slide.subtitle) {
        const s = d(slide.subtitle);
        const ss = fit([s], { width: 1000, height: 72, max: 32, min: 18, lineH: 1.25 });
        boxes.push(text(140, 446, 1000, 72, [{ text: s, size: ss, color: p.onBandMuted }], { rtl, align: 'center', valign: 'top', field: 'subtitle' }));
      }
      boxes.push({ t: 'rect', x: 580, y: 532, w: 120, h: 6, fill: p.accent, radius: 3 });
      const w = byWords(deck.lang);
      const people = [
        deck.meta.presenter.trim() ? `${w.by} ${deck.meta.presenter.trim()}` : '',
        deck.meta.supervisor.trim() ? `${w.supervisor} ${deck.meta.supervisor.trim()}` : '',
        deck.meta.date.trim(),
      ].filter(Boolean).map(d);
      if (people.length) {
        const ps = fit(people, { width: 1000, height: 120, max: 26, min: 14, lineH: 1.3, gapEm: 0.2 });
        boxes.push(text(140, 556, 1000, 124, people.map((x, i) => ({ text: x, size: ps, color: p.onBand, bold: i === 0, ...(i ? { gap: Math.round(ps * 0.2) } : {}) })), { rtl, align: 'center', lineH: 1.3 }));
      }
      return { bg, boxes };
    }
    case 'section': {
      bg = p.band;
      boxes.push({ t: 'rect', x: 80, y: 262, w: 120, h: 8, fill: p.accent, radius: 4 });
      const t = d(slide.title);
      const ts = fit([t], { width: 1120, height: 170, max: 68, min: 32, lineH: 1.15, bold: true });
      boxes.push(text(80, 288, 1120, 170, [{ text: t, size: ts, color: p.onBand, bold: true }], { rtl, lineH: 1.15, field: 'title' }));
      if (slide.subtitle) {
        const s = d(slide.subtitle);
        const ss = fit([s], { width: 1120, height: 110, max: 34, min: 18, lineH: 1.3 });
        boxes.push(text(80, 470, 1120, 110, [{ text: s, size: ss, color: p.onBandMuted }], { rtl, lineH: 1.3, field: 'subtitle' }));
      }
      return { bg, boxes: rtl ? mirrored(boxes) : boxes };
    }
    case 'end': {
      bg = p.band;
      const t = d(slide.title);
      const ts = fit([t], { width: 1080, height: 170, max: 84, min: 36, lineH: 1.15, bold: true });
      boxes.push(text(100, logo ? 150 : 200, 1080, 170, [{ text: t, size: ts, color: p.onBand, bold: true }], { rtl, align: 'center', valign: 'bottom', lineH: 1.15, field: 'title' }));
      boxes.push({ t: 'rect', x: 580, y: logo ? 340 : 390, w: 120, h: 6, fill: p.accent, radius: 3 });
      if (slide.subtitle) {
        const s = d(slide.subtitle);
        const ss = fit([s], { width: 1000, height: 90, max: 36, min: 18, lineH: 1.25 });
        boxes.push(text(140, logo ? 362 : 412, 1000, 90, [{ text: s, size: ss, color: p.onBandMuted }], { rtl, align: 'center', field: 'subtitle' }));
      }
      if (deck.meta.presenter.trim()) {
        boxes.push(text(140, logo ? 468 : 530, 1000, 40, [{ text: d(deck.meta.presenter.trim()), size: 26, color: p.onBand, bold: true }], { rtl, align: 'center', valign: 'middle' }));
      }
      if (logo) boxes.push({ t: 'image', x: 560, y: 532, w: 160, h: 120, src: logo.src });
      return { bg, boxes };
    }
    case 'quote': {
      bg = p.soft;
      if (slide.title) {
        boxes.push(text(170, 96, 990, 56, [{ text: d(slide.title), size: 28, color: p.accent, bold: true }], { rtl, valign: 'bottom', field: 'title' }));
      }
      boxes.push({ t: 'rect', x: 120, y: 180, w: 10, h: 290, fill: p.accent, radius: 5 });
      const b = d(slide.body);
      const bs = fit([b], { width: 990, height: 300, max: 52, min: 22, lineH: 1.4 });
      boxes.push(text(170, 172, 990, 306, [{ text: b, size: bs, color: p.ink }], { rtl, valign: 'middle', lineH: 1.4, field: 'body' }));
      if (slide.subtitle) {
        boxes.push(text(170, 500, 990, 50, [{ text: `— ${d(slide.subtitle)}`, size: 28, color: p.muted }], { rtl, valign: 'top', field: 'subtitle' }));
      }
      footer();
      return { bg, boxes: rtl ? mirrored(boxes) : boxes };
    }
    default:
      break;
  }

  titleBar();
  if (slide.kind === 'bullets') {
    points(slide.points, BODY.x, BODY.y + 8, BODY.w, BODY.h - 8, { max: 40, min: 18, field: 'points' });
  } else if (slide.kind === 'references') {
    points(slide.points, BODY.x, BODY.y, BODY.w, BODY.h, { max: 26, min: 12, field: 'points' });
  } else if (slide.kind === 'two') {
    const cw = (BODY.w - 24) / 2;
    ([[slide.head, slide.points, 'head', 'points'], [slide.head2, slide.points2, 'head2', 'points2']] as const).forEach(([head, list, hf, pf], i) => {
      const x = BODY.x + i * (cw + 24);
      boxes.push({ t: 'rect', x, y: BODY.y, w: cw, h: BODY.h, fill: p.soft, radius: 16 });
      const h = d(head);
      const hs = fit([h], { width: cw - 64, height: 56, max: 34, min: 18, lineH: 1.2, bold: true });
      boxes.push(text(x + 32, BODY.y + 26, cw - 64, 58, [{ text: h, size: hs, color: p.accent, bold: true }], { rtl, valign: 'middle', lineH: 1.2, field: hf }));
      points([...list], x + 32, BODY.y + 100, cw - 64, BODY.h - 128, { max: 34, min: 15, field: pf });
    });
  } else if (slide.kind === 'stat') {
    const list = slide.pairs.filter((x) => x.a.trim() || x.b.trim()).slice(0, 3);
    const n = Math.max(1, list.length);
    const cw = (BODY.w - (n - 1) * 32) / n;
    list.forEach((pair, i) => {
      const x = BODY.x + i * (cw + 32);
      boxes.push({ t: 'rect', x, y: 224, w: cw, h: 380, fill: p.soft, radius: 20 });
      const a = d(pair.a);
      const as = fit([a], { width: cw - 48, height: 170, max: n === 1 ? 120 : 96, min: 36, lineH: 1.05, bold: true });
      boxes.push(text(x + 24, 256, cw - 48, 176, [{ text: a, size: as, color: p.accent, bold: true }], { rtl, align: 'center', valign: 'middle', lineH: 1.05, field: 'pairs' }));
      const b = d(pair.b);
      const bs = fit([b], { width: cw - 64, height: 140, max: 32, min: 15, lineH: 1.3 });
      boxes.push(text(x + 32, 444, cw - 64, 144, [{ text: b, size: bs, color: p.ink }], { rtl, align: 'center', lineH: 1.3, field: 'pairs' }));
    });
  } else if (slide.kind === 'timeline') {
    const list = slide.pairs.filter((x) => x.a.trim() || x.b.trim()).slice(0, 6);
    const n = Math.max(1, list.length);
    const span = 1080;
    const cw = span / n;
    boxes.push({ t: 'rect', x: 100, y: 372, w: span, h: 4, fill: p.line, radius: 2 });
    list.forEach((pair, i) => {
      const cx = 100 + (i + 0.5) * cw;
      boxes.push({ t: 'rect', x: cx - 13, y: 361, w: 26, h: 26, fill: p.accent, radius: 13 });
      const a = d(pair.a);
      const as = fit([a], { width: cw - 20, height: 110, max: 40, min: 16, lineH: 1.15, bold: true });
      boxes.push(text(cx - cw / 2 + 10, 236, cw - 20, 112, [{ text: a, size: as, color: p.accent, bold: true }], { rtl, align: 'center', valign: 'bottom', lineH: 1.15, field: 'pairs' }));
      const b = d(pair.b);
      const bs = fit([b], { width: cw - 20, height: 240, max: 28, min: 13, lineH: 1.3 });
      boxes.push(text(cx - cw / 2 + 10, 404, cw - 20, 244, [{ text: b, size: bs, color: p.ink }], { rtl, align: 'center', lineH: 1.3, field: 'pairs' }));
    });
  } else if (slide.kind === 'table') {
    const rows = slide.rows.map((r) => r.map(d));
    const cols = Math.max(1, ...rows.map((r) => r.length));
    const rowH = Math.min(68, Math.floor(BODY.h / Math.max(1, rows.length)));
    const colW = BODY.w / cols;
    // Each cell in at most two lines of its column; the header, bold, likewise.
    let size = Math.min(28, Math.round(rowH * 0.4));
    while (size > 11 && rows.some((r, ri) => r.some((c) => linesOf(c, size, colW - 28, ri === 0) > 2))) size -= 1;
    boxes.push({
      t: 'table', x: BODY.x, y: BODY.y, w: BODY.w, h: rowH * rows.length, rows, size, rowH,
      headFill: p.band, headInk: p.onBand, ink: p.ink, line: p.line, stripe: p.soft, rtl, field: 'rows',
    });
  }
  footer();
  return { bg, boxes: rtl ? mirrored(boxes) : boxes };
}

/**
 * Where a picture goes inside its box: as large as fits, keeping its shape,
 * centred. `ratio` is its width over its height; an unknown one fills the box.
 */
export function contain(box: { x: number; y: number; w: number; h: number }, ratio: number | undefined): { x: number; y: number; w: number; h: number } {
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return box;
  const w = Math.min(box.w, box.h * ratio);
  const h = w / ratio;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}
