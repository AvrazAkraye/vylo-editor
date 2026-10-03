import type { Lang } from './i18n';
import type { Anim, ChartLayer, Gradient, Layer, Paint, Shadow } from './motiontypes';
import type { PRO_B_IDS } from './motionids';
import { E, META, T, type Kit, type Recipe } from './motionrecipe';
import { contrast, luminance, mixColors } from './motionmath';
import { inDone, outStart, stillTime, unitsOf } from './motionanim';
import { safeArea } from './motiondirection';
import { digitsFor, formatNumber, toArabicDigits } from './motionfonts';
import { clipToLines, itemsOf, numberOf, WRAPPED_LABEL, type Item } from './motionrecipes-data';
import { raceData, raceWindow } from './motioncharts';

/**
 * Work package 08's templates: a film look to lay over video, a bar-chart
 * race, a timeline, a before-and-after, a price card, progress rings and a
 * retro title. The first, the last and the price card are where the five
 * finishes `motionbackdrop.ts` gained (grain, vignette, light leak, scan
 * lines, halftone) meet a template; the race is `motioncharts.ts`'s new
 * chart.
 *
 * They are built as the original eighteen are (`motionrecipes-data.ts` and
 * `-overlays.ts`): in `u` and logical pins, so one layout serves every shape
 * and both directions; timed at their natural length with the exit anchored
 * to the end, so a longer graphic only holds longer and a shorter one is the
 * same choreography compressed; every animation held inside its layer
 * (`settle`), so what is built is what the reader keeps; and sizes chosen from
 * estimates of how wide words will be, with `fit` on every line that could
 * still run long, because a recipe runs before any font is loaded.
 *
 * ## Numbers are read, never made
 *
 * A figure — a race's values, a ring's percentage, a price — is read from the
 * person's words by `motionrecipes-data.ts`'s readers, which take every way of
 * writing digits the region uses. A line with no number is skipped, and when
 * nothing reads, the sample's words for the language are used: plainly
 * placeholders (fruit by the tonne, a term's attendance), never a guess.
 */

type ProBId = (typeof PRO_B_IDS)[number];

// ── shared pieces ─────────────────────────────────────────────────────────

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** The frame's safe margin: wider on the wide frame, as titles are set there. */
const marginOf = (c: Kit) => (c.landscape ? 8 : 6);

/**
 * Where words may go, in u, as `motionrecipes-data.ts` keeps them: the margin
 * above or the title-safe area the model is told about and the check measures
 * (`safeArea`, motiondirection.ts), whichever is further in — 8.9u from the
 * sides of the wide frame, and the bottom 30.3u of a portrait one left to the
 * phone app's own buttons and caption.
 */
const sideOf = (c: Kit) => Math.max(marginOf(c), safeArea(c.format).side);
/** u words keep clear of the frame's bottom edge. */
const bottomOf = (c: Kit) => Math.max(marginOf(c), safeArea(c.format).bottom);
/** u from the top of the frame down to the lowest that words may reach. */
const footOf = (c: Kit) => c.u.h - bottomOf(c);

/**
 * The timing of one graphic: `pace` is 1 at the recipe's own length or
 * longer and less when it is shorter, down to 0.45, so a short version still
 * arrives, holds and leaves; `s` scales a designed time by it.
 */
interface Beat {
  pace: number;
  exit: number;
  s(t: number): number;
}

function beatOf(c: Kit): Beat {
  const pace = clamp(c.seconds / META[c.recipe].seconds, 0.45, 1);
  return { pace, exit: Math.min(T.exit, c.seconds * 0.2), s: (t) => t * pace };
}

/**
 * Every animation of a layer held inside its own span, and a layer that would
 * start too late to be seen dropped: what the reader would do, done here, so
 * a graphic of one second reads back exactly as it was built.
 */
function settle(layers: Layer[], seconds: number): Layer[] {
  const out: Layer[] = [];
  for (const l of layers) {
    const end = Math.min(l.end, seconds);
    if (!(l.start < seconds - 0.05) || !(end > l.start + 0.05)) continue;
    const span = end - l.start;
    const fit = (a: Anim | undefined): Anim | undefined => (a ? { ...a, d: clamp(a.d, 0.05, span), delay: clamp(a.delay, 0, span) } : a);
    const next = { ...l, end } as Layer;
    if (l.in) next.in = fit(l.in);
    if (l.out) next.out = fit(l.out);
    if (next.kind === 'counter') next.count = { ...next.count, d: clamp(next.count.d, 0.05, span), delay: clamp(next.count.delay, 0, span) };
    // In a short graphic an entrance may still be running when the exit begins: the entrance is shortened to finish as the
    // exit starts, then the exit; a layer with no time for even the shortest of both would only flicker, and is left out.
    const n = unitsOf(next);
    let over = next.in && next.out ? inDone(next, n) - outStart(next, n) : 0;
    if (over > 0 && next.in) {
      const cut = Math.min(over, next.in.d - 0.05);
      next.in = { ...next.in, d: next.in.d - cut };
      over -= cut;
    }
    if (over > 0 && next.out) {
      const cut = Math.min(over, next.out.d - 0.05);
      next.out = { ...next.out, d: next.out.d - cut };
      over -= cut;
    }
    if (over > 1e-6) continue;
    out.push(next);
  }
  return out;
}

const ARABIC_LETTER = /[\u0600-\u06FF]/;

/**
 * How wide words will be at weight 500 to 800, in ems: an average per letter,
 * Arabic script a little narrower, capitals and wide letters wider. A little
 * over, so an estimate errs toward room; every line it sizes also has `fit`.
 */
function emOf(s: string, caps = false): number {
  let w = 0;
  for (const raw of caps ? s.toUpperCase() : s) {
    if (/\s/.test(raw)) w += 0.27;
    else if (/[\u0660-\u0669\u06F0-\u06F9]/.test(raw)) w += 0.68;
    else if (ARABIC_LETTER.test(raw)) w += 0.48;
    else if (/[A-Z0-9MW@%&$€£]/.test(raw) || /[mw]/.test(raw)) w += 0.68;
    else if (/[iljtf.,:;'!|/]/.test(raw)) w += 0.29;
    else w += 0.54;
  }
  return w * 1.06;
}

/**
 * How wide a number drawn by a counter will be, in ems: its digits,
 * separators and marks. Both digit scripts are estimated at the wider one's
 * widths, so a graphic and its Arabic or Kurdish version are laid out alike
 * and mirror each other exactly; the narrower digits only leave a little air.
 */
function figureEm(value: number, decimals: number, prefix: string, suffix: string, lang: Lang): number {
  let w = 0;
  for (const ch of `${prefix}${formatNumber(value, { decimals, group: true, lang })}${suffix}`) {
    if (/[0-9\u0660-\u0669]/.test(ch)) w += 0.69;
    else if (/[,.\u066B\u066C]/.test(ch)) w += 0.28;
    else if (ch === '%' || ch === '\u066A') w += 0.94;
    else if (/\s/.test(ch)) w += 0.25;
    else w += 0.68;
  }
  return w * 1.04;
}

/** A percent sign in the graphic's own writing: `٪` after Arabic-Indic digits, `%` after Latin ones. */
function markOf(c: Kit, mark: string): string {
  const m = String(mark ?? '');
  return digitsFor(c.lang) === 'arab' ? m.replace(/%/g, '\u066A') : m.replace(/\u066A/g, '%');
}

/** Digits as the graphic writes them: Arabic-Indic in Arabic and both Kurdish languages, as the charts and counters do. */
function localDigits(c: Kit, s: string): string {
  return digitsFor(c.lang) === 'arab' ? toArabicDigits(s) : s;
}

/**
 * The size and `fit` for a block of words that wraps at `max` u. A line breaks
 * between words and never inside one, so a word wider than a line (an
 * address, a long compound) would run out of the block: the block is set a
 * little smaller, until its longest word fits, and still wraps. `fit` — the
 * words on one line, shrunk to it — is only for a single word, or a word so
 * long that wrapping would need type too small to read.
 */
function wrapped(text: string, size: number, max: number, caps = false): { size: number; fit: boolean } {
  const words = text.split(/\s+/).filter(Boolean);
  const longest = Math.max(0, ...words.map((w) => emOf(w, caps)));
  if (longest * size <= max) return { size, fit: false };
  const smaller = (max * 0.96) / longest;
  return words.length > 1 && smaller >= size * 0.45 ? { size: smaller, fit: false } : { size, fit: true };
}

/** `wrapped`'s answer as a text layer's fields. */
const sizeFit = (w: { size: number; fit: boolean }) => ({ size: w.size, fit: w.fit });

/** A token as the colour the palette gives it; a colour as itself. */
function colourOf(c: Kit, x: string): string {
  const p = c.palette as unknown as Record<string, string>;
  return Object.prototype.hasOwnProperty.call(p, x) ? p[x] : x;
}

/** The palette's ink or its ground, whichever reads better on every colour of `on`: words on an accent. */
function inkOn(c: Kit, on: Paint): 'fg' | 'bg' {
  const colours = typeof on === 'string' ? [on] : on.stops.map((s) => s.color);
  const worst = (t: 'fg' | 'bg') => Math.min(...colours.map((x) => contrast(colourOf(c, t), colourOf(c, x))));
  return worst('bg') > worst('fg') ? 'bg' : 'fg';
}

/** Whether the palette's ground is dark: hairlines and sheens are light on it, dark otherwise. */
const darkGround = (c: Kit) => luminance(c.palette.bg) < 0.4;

/** The family's two-accent sweep across a shape. */
function sheen(angle = 30): Gradient {
  return { kind: 'linear', angle, stops: [{ at: 0, color: 'accent' }, { at: 1, color: 'accent2' }] };
}

/** The sample's words for a field in the graphic's language. */
function sampleOf(c: Kit, key: string): string {
  const r = SAMPLES[c.recipe as ProBId];
  return r?.[c.lang]?.[key] ?? r?.en?.[key] ?? '';
}

/** A moving ground under everything: faint, slow, and there from the first frame to the last. */
function groundOf(c: Kit, b: Beat, style: 'aurora' | 'halftone', o: { opacity: number; density: number }): Layer {
  return c.backdrop('backdrop', {
    style, colors: ['accent', 'accent2'], speed: 1, density: o.density, opacity: o.opacity,
    start: 0, end: c.seconds, in: c.enter('fade', { d: b.s(1), ease: E.soft }),
  });
}

/** Where a heading ends, and its layers. */
interface Head {
  layers: Layer[];
  /** u from the top of the frame to the bottom of the heading: where what is under it may begin. */
  bottom: number;
  /** u from the top to the heading's first line, for something set beside it. */
  top: number;
  size: number;
}

/**
 * A heading as the data templates set theirs: a short accent rule drawn from
 * the start edge, then the title masked up from behind its own line, one line
 * fitted on the wide frame, up to two elsewhere. `room` keeps space at the end
 * of the line for something beside it. An empty title is no heading.
 */
function headOf(c: Kit, b: Beat, align: 'start' | 'center', room = 0): Head {
  const M = sideOf(c);
  const text = (c.fields.title ?? '').trim();
  const ruleY = c.portrait ? 10 : c.landscape ? 8 : 6.5;
  const full = c.landscape ? 6.2 : c.portrait ? 6.4 : 5.6;
  if (!text) return { layers: [], bottom: marginOf(c), top: ruleY + 3, size: full };
  const max = Math.max(20, c.u.w - 2 * M - room);
  const ems = emOf(text) * 1.1;
  const wraps = !c.landscape && ems * full > max;
  const shrunk = wraps ? Math.min(full, (2 * max * 0.86) / ems) : full;
  // A word too long for a line even at the two-line size (an address, a long compound) makes it one fitted line instead.
  const two = wraps && Math.max(...text.split(/\s+/).map((w) => emOf(w) * 1.1)) * shrunk <= max;
  const size = two ? shrunk : full;
  const y = ruleY + 3;
  const pin = align === 'center' ? 'tc' : 'ts';
  const x = align === 'center' ? 0 : M;
  const lead = 1.12;
  return {
    bottom: y + size * lead * (two ? 2 : 1),
    top: y,
    size,
    layers: [
      c.shape('accent-rule', {
        name: 'Accent rule', shape: 'rect', w: 6, h: 0.8, radius: 0.4, fill: 'accent', pin, x, y: ruleY, start: b.s(0.05), end: c.seconds,
        in: c.enter('grow', { d: b.s(0.55) }), out: c.leave('grow', { d: b.exit }),
      }),
      c.text('title', {
        text, voice: 'sans', size, weight: 800, color: 'fg', align, lead, max, fit: !two, pin, x, y,
        start: b.s(0.12), end: c.seconds,
        in: c.enter('mask', { by: 'line', gap: T.gap, d: b.s(T.enter) }), out: c.leave('mask', { by: 'line', gap: T.gap, d: b.exit }),
      }),
    ],
  };
}

/*
 * Layers that repeat — a period, a milestone's date, a feature — share one
 * plain name ("Date", "Feature") rather than a numbered one: the interface
 * translates a numbered name only through its own table (`motionui.ts`), and
 * a plain one through the catalogue alone. Their ids stay numbered and unique.
 */

/** The lines of a list field, trimmed, without bullets, empty ones skipped. */
function linesOf(s: string): string[] {
  return String(s ?? '').split(/\r\n?|\n/).map((l) => l.replace(/^\s*(?:[\u2022\u00B7\u25AA\u25E6*]+|[-\u2013\u2014](?=\s))\s*/, '').trim()).filter(Boolean);
}

// ── film look ─────────────────────────────────────────────────────────────

/**
 * Film look: three finishes laid over the picture, as a film print carries
 * them — warm light leaking in at the side and blooming, the corners drawn
 * down by the lens, and grain over everything, changing every film frame.
 * The frame itself is transparent, so it lies over video as it is. A caption,
 * if there is one, is typed in at the bottom start like the date a home
 * camera burned into the picture, under the grain so it is part of the film;
 * it leaves at the end, while the finishes stay to the last frame so the look
 * can run under a whole clip. The leak's colours are the palette's accents,
 * so another palette is another stock.
 */
function filmLook(c: Kit): Layer[] {
  const b = beatOf(c);
  const M = sideOf(c);
  const S = c.seconds;
  const caption = (c.fields.caption ?? '').trim();
  const layers: Layer[] = [
    c.backdrop('light-leak', {
      name: 'Light leak', style: 'lightleak', colors: ['accent', 'accent2'], density: 0.45, speed: 1, opacity: 0.9,
      start: 0, end: S, in: c.enter('fade', { d: b.s(0.8), ease: E.soft }),
    }),
    c.backdrop('vignette', { name: 'Vignette', style: 'vignette', colors: ['#000000'], density: 0.5, speed: 1, start: 0, end: S }),
  ];
  if (caption) {
    const size = c.landscape ? 3.4 : c.portrait ? 4.2 : 3.8;
    layers.push(c.text('caption', {
      text: caption, voice: 'mono', size, weight: 500, color: 'fg', align: 'start', lead: 1.25, max: c.u.w - 2 * M, fit: true, track: 0.02,
      // Clear of a phone's captions and buttons in the tall frame: above the bottom 30.3u (`bottomOf`), not 18u as it was.
      pin: 'bs', x: M, y: -bottomOf(c), shadow: { color: 'rgba(0,0,0,.55)', blur: 1.2, x: 0, y: 0.2 },
      start: b.s(0.6), end: S, in: c.enter('type', { d: b.s(1.2), ease: 'linear' }), out: c.leave('fade', { d: b.exit }),
    }));
  }
  layers.push(c.backdrop('grain', { name: 'Grain', style: 'grain', colors: ['#FFFFFF', '#000000'], density: 0.45, speed: 1, start: 0, end: S }));
  return settle(layers, S);
}

// ── bar chart race ────────────────────────────────────────────────────────

/** Where a value list ends and the next value begins: `;`, an Arabic comma or semicolon, a bar, a comma before a space, or spaces. */
const VALUE_SEP = /\s*[;\u061B\u060C|]\s*|,\s+|\s+/;

/**
 * One racer from a line: its name (before the first colon, or before its
 * first number) and its values, in order. A value is any number
 * `numberOf` reads — grouped thousands, Arabic-Indic digits — and `12,18,25`
 * with no spaces is three values, since a group of thousands has three digits.
 * A line with no value is no racer.
 */
function racerOf(line: string): { name: string; values: number[] } | null {
  const colon = line.search(/[:=\uFF1A]/);
  let name = '';
  let rest = line;
  if (colon >= 0) {
    name = line.slice(0, colon);
    rest = line.slice(colon + 1);
  } else {
    const first = line.search(/[-+]?[\d\u0660-\u0669\u06F0-\u06F9]/);
    if (first < 0) return null;
    name = line.slice(0, first);
    rest = line.slice(first);
  }
  const values: number[] = [];
  for (const word of rest.split(VALUE_SEP)) {
    if (!word) continue;
    const one = numberOf(word);
    if (one) values.push(one.value);
    else for (const part of word.split(',')) {
      const v = numberOf(part);
      if (v) values.push(v.value);
    }
  }
  const clean = name.replace(/[\s,\u060C:-]+$/, '').replace(/\s+/g, ' ').trim();
  return values.length ? { name: clean, values } : null;
}

/** The periods, in order: split at commas, Arabic commas, semicolons or bars; a single phrase of several words is split at its spaces. */
function periodsOf(s: string): string[] {
  const parts = String(s ?? '').split(/[,;\u060C\u061B|]/).map((p) => p.trim()).filter(Boolean);
  return parts.length === 1 && /\s/.test(parts[0]) ? parts[0].split(/\s+/) : parts;
}

/**
 * Bar chart race: the title masks in at the start of the heading row with
 * the period at its end, large and quiet; the bars grow in, the leader first;
 * then the race runs, a period every second and a half at the design length,
 * the bars overtaking one another and the scale stretching to the leader,
 * whose bar and number are lit in the accent and hand it on when the lead
 * changes. The period rolls to the next as the race reaches it (each rises
 * in as the last rises away). It holds on the final standing, then the bars
 * shrink away.
 *
 * The race reads `Name: v1, v2, …` a line, up to ten racers and twelve
 * periods; the period names are their own field, so a racer's line is only
 * numbers after its name. The values go into the chart as `motioncharts.ts`
 * keeps a race (`raceData`), which drops periods evenly when a label would be
 * too long and says which it kept, so the period shown is always the one the
 * bars are at.
 */
function barRace(c: Kit): Layer[] {
  const b = beatOf(c);
  const M = sideOf(c);
  const max = META['bar-race'].fields[1].max;
  const read = (s: string) => linesOf(s).map(racerOf).filter((r): r is { name: string; values: number[] } => r !== null).slice(0, max);
  const mine = read(c.fields.items ?? '');
  const rows = mine.length ? mine : read(sampleOf(c, 'items'));
  const { data, steps } = raceData(rows.length ? rows : [{ name: '', values: [0] }]);
  const periods = periodsOf(c.fields.periods ?? '');
  const shown = steps.map((i) => localDigits(c, periods[i] ?? ''));
  const unit = markOf(c, c.fields.unit ?? '');
  const n = data.length;

  // The period sits at the end of the heading row; the title keeps clear of it.
  const periodSize = c.landscape ? 8 : c.portrait ? 8.5 : 7.5;
  // Never more than a third of the row: a period longer than that (a long word, an address) is fitted, not let past the frame.
  const periodW = shown.some(Boolean) ? Math.min(Math.max(...shown.map((p) => emOf(p) * periodSize)) + 1, (c.u.w - 2 * M) * 0.3) : 0;
  const head = headOf(c, b, 'start', periodW ? periodW + 4 : 0);
  const size = c.landscape ? 3 : c.portrait ? 3.6 : 3.2;
  const top = Math.max(head.bottom, head.top + periodSize * 0.9) + (c.landscape ? 5 : 6);
  const bottom = footOf(c);
  const W = c.u.w - 2 * M;
  // As tall as the room, but never more than four type-heights a bar: a short race stands in the middle, not stretched.
  const h = clamp(Math.min(bottom - top, n * size * (c.portrait ? 5.2 : 4.2)), 12, Math.max(12, bottom - top));
  const y = top + Math.max(0, bottom - top - h) * 0.4;
  const t0 = b.s(0.35);
  const [chart] = settle([c.chart('chart', {
    name: 'Race', chart: 'race', w: W, h, data, colors: ['muted', 'accent'], max: 0, unit, labels: true, values: true, voice: 'sans', size,
    color: 'fg', thick: 1.4, gap: b.s(0.08), pin: 'tc', x: 0, y, start: t0, end: c.seconds,
    in: c.enter('grow', { d: b.s(0.8) }), out: c.leave('grow', { d: b.exit }),
  })], c.seconds);
  const layers: Layer[] = [groundOf(c, b, 'aurora', { opacity: 0.5, density: 0.35 }), ...head.layers];
  if (chart) layers.push(chart);

  // One text a period, each on screen from halfway after the period before to halfway into the next. A race too quick to
  // read its periods (under a third of a second each, in a graphic of a second or two) shows only the last: the result.
  const win = chart ? raceWindow(chart as ChartLayer) : null;
  const quick = !!win && shown.length > 1 && (win.to - win.from) / (shown.length - 1) < 0.3;
  const m = shown.length;
  if (chart && win && shown.some(Boolean)) {
    const at = (j: number) => (m > 1 ? win.from + ((win.to - win.from) * j) / (m - 1) : win.from);
    for (let j = quick ? m - 1 : 0; j < m; j++) {
      if (!shown[j]) continue;
      const start = j === 0 || quick ? t0 : (at(j - 1) + at(j)) / 2 - b.s(0.06);
      const end = j === m - 1 ? c.seconds : (at(j) + at(j + 1)) / 2 + b.s(0.06);
      const span = Math.max(0.1, end - start);
      const roll = Math.min(b.s(0.32), span * 0.4);
      layers.push(c.text(`period-${j + 1}`, {
        name: 'Period', text: shown[j], voice: 'sans', size: periodSize, weight: 800, color: 'fg', opacity: 0.42, align: 'end',
        lead: 1, max: periodW, fit: true, pin: 'te', x: -M, y: head.top - periodSize * 0.12, start, end,
        in: c.enter('rise', { d: j === 0 || quick ? Math.min(b.s(T.enter), span * 0.4) : roll, amount: 0.6 }),
        out: j === m - 1 ? c.leave('fade', { d: Math.min(b.exit, span * 0.4) }) : c.leave('drop', { d: roll * 0.85, amount: 0.6, ease: 'out' }),
      }));
    }
  }
  return settle(layers, c.seconds);
}

// ── timeline ──────────────────────────────────────────────────────────────

interface Milestone {
  date: string;
  text: string;
}

/** A milestone from a line: the date before the first colon followed by a space (so 10:30 stays whole), or the first colon, or a dash; else all words. */
function milestoneOf(line: string): Milestone {
  const s = line.trim();
  const at = [/[:\uFF1A]\s/, /[:\uFF1A]/, /\s[-\u2013\u2014]\s/].map((re) => s.search(re)).find((i) => i > 0);
  if (at === undefined) return { date: '', text: s };
  const sep = s.slice(at).match(/^\s?[:\uFF1A\u2013\u2014-]\s?/)?.[0].length ?? 1;
  return { date: s.slice(0, at).trim().slice(0, 24), text: s.slice(at + sep).trim() };
}

/** Lines a block of words will take at `size` u in `room` u: an estimate, for placing what sits beside it. */
function linesFor(text: string, size: number, room: number): number {
  return clamp(Math.ceil((emOf(text) * size) / Math.max(1, room)), 1, 4);
}

/**
 * Timeline: the title masks in; a line draws itself through the milestones
 * from the first to the last (right to left in Arabic and Kurdish), and each
 * milestone arrives as the line reaches it — its ring pops, a short stem
 * grows out of it and its date and words rise in at the stem's end. The last
 * milestone is lit in the second accent and glows: where the story is now.
 * Everything leaves together, the line retracting.
 *
 * On the wide and square frames the line runs across and the milestones take
 * turns above and below it, so each has the room of two; on the tall frames
 * it runs down the start side with the words beside it.
 */
function timeline(c: Kit): Layer[] {
  const b = beatOf(c);
  const M = marginOf(c);
  const max = META.timeline.fields[1].max;
  const read = (s: string) => linesOf(s).map(milestoneOf).filter((x) => x.date || x.text).slice(0, max);
  const mine = read(c.fields.items ?? '');
  const items = (mine.length ? mine : read(sampleOf(c, 'items'))).map((it) => ({ ...it, date: localDigits(c, it.date) }));
  const n = Math.max(1, items.length);
  const head = headOf(c, b, 'center');
  const layers: Layer[] = [groundOf(c, b, 'aurora', { opacity: 0.45, density: 0.3 }), ...head.layers];
  const t0 = b.s(0.45);
  const drawD = b.s(1.1 + 0.18 * n);
  // When the line, drawing on its in-out curve, reaches a fraction of its length.
  const inout = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const reachAt = (f: number) => {
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (inout(mid) < f) lo = mid;
      else hi = mid;
    }
    return t0 + drawD * lo;
  };
  const leave = (d = b.exit) => c.leave('fade', { d });
  const across = !c.tall;
  const dateSize = c.landscape ? 4.4 : c.portrait ? 4.8 : 4.2;
  const textSize = c.landscape ? 3.2 : c.portrait ? 3.6 : 3.1;
  const ring = c.landscape ? 2.8 : 3;

  const dot = (i: number, x: number, y: number, pin: 'mc' | 'ts', when: number) => {
    const last = i === n - 1 && n > 1;
    const color = last ? 'accent2' : 'accent';
    if (last) {
      layers.push(c.shape('glow', {
        shape: 'ellipse', w: ring * 2.6, h: ring * 2.6, fill: color, opacity: 0.25, pin, x: pin === 'ts' ? x - ring * 0.8 : x, y: pin === 'ts' ? y - ring * 0.8 : y,
        start: when, end: c.seconds, in: c.enter('pop', { d: b.s(0.5), ease: E.pop }), out: leave(), loop: c.loop('pulse', { d: 1.8, amount: 3 }),
      }));
    }
    layers.push(c.shape(`dot-${i + 1}`, {
      name: 'Milestone', shape: 'ellipse', w: ring, h: ring, fill: 'bg', stroke: { color, width: 0.55, cap: 'round' }, pin, x, y,
      start: when, end: c.seconds, in: c.enter('pop', { d: b.s(T.quick), ease: E.pop }), out: leave(),
    }));
  };

  if (across) {
    const W = c.u.w - 2 * M;
    const labelW = Math.min(c.landscape ? 46 : 40, n > 1 ? (2 * W) / (n + 1) : W * 0.6);
    const span = n > 1 ? W - labelW : 0;
    const step = n > 1 ? span / (n - 1) : 0;
    const room = Math.min(labelW, n > 1 ? step * 1.84 : W * 0.6);
    const top = head.bottom + 4;
    const bottom = c.u.h - M;
    const lineY = (top + bottom) / 2 + (head.layers.length ? 2 : 0);
    const stem = c.landscape ? 4 : 4.5;
    const lineLen = n > 1 ? span + ring * 3 : W * 0.5;
    layers.push(c.shape('line', {
      shape: 'rect', w: lineLen, h: 0.45, radius: 0.22, fill: 'fg', opacity: 0.35, pin: 'tc', x: 0, y: lineY - 0.225,
      start: t0, end: c.seconds, in: c.enter('grow', { dir: 'start', d: drawD, ease: 'inout' }), out: c.leave('grow', { dir: 'start', d: b.exit }),
    }));
    items.forEach((it, i) => {
      const x = n > 1 ? -span / 2 + i * step : 0;
      const when = n > 1 ? reachAt((i * step + ring * 1.5) / lineLen) : t0 + drawD / 2;
      const up = i % 2 === 0;
      dot(i, x, lineY - c.u.h / 2, 'mc', when);
      layers.push(c.shape(`stem-${i + 1}`, {
        name: 'Stem', shape: 'rect', w: 0.3, h: stem, fill: 'fg', opacity: 0.3, pin: 'mc', x,
        y: lineY - c.u.h / 2 + (up ? -1 : 1) * (ring / 2 + stem / 2 + 0.3),
        start: when + b.s(0.05), end: c.seconds, in: c.enter('grow', { dir: up ? 'up' : 'down', d: b.s(0.35) }), out: leave(),
      }));
      // From the stem's end outward: the date, then the words.
      const near = ring / 2 + stem + 1.6;
      const dateH = it.date ? dateSize * 1.15 : 0;
      const ev = wrapped(it.text, textSize, room);
      const block = (dy: number) => (up ? { pin: 'bc' as const, y: lineY - near - dy - c.u.h } : { pin: 'tc' as const, y: lineY + near + dy });
      if (it.date) {
        layers.push(c.text(`date-${i + 1}`, {
          name: 'Date', text: it.date, voice: 'sans', size: dateSize, weight: 800, color: i === n - 1 && n > 1 ? 'accent2' : 'accent',
          align: 'center', lead: 1.1, max: room, fit: true, ...block(up && it.text ? ev.size * 1.25 * (ev.fit ? 1 : linesFor(it.text, ev.size, room)) + 0.8 : 0), x,
          start: when + b.s(0.08), end: c.seconds, in: c.enter('rise', { d: b.s(0.5), amount: 0.5 }), out: leave(),
        }));
      }
      if (it.text) {
        layers.push(c.text(`event-${i + 1}`, {
          name: 'Event', text: it.text, voice: 'sans', size: ev.size, weight: 500, color: 'fg', align: 'center', lead: 1.25, max: room,
          fit: ev.fit, ...block(up ? 0 : dateH + 0.8), x,
          start: when + b.s(0.16), end: c.seconds, in: c.enter('rise', { d: b.s(0.55), amount: 0.5 }), out: leave(),
        }));
      }
    });
    return settle(layers, c.seconds);
  }

  // Down the start side, the last milestone's words above the bottom 30.3u of a portrait frame (`footOf`: six
  // milestones used to reach 12u from the bottom, where a phone app's own buttons and caption lie).
  const lineX = M + 3;
  const top = head.bottom + 7;
  const bottom = footOf(c);
  const rowH = (bottom - top) / n;
  const first = top + Math.min(rowH * 0.3, 3);
  const span = n > 1 ? rowH * (n - 1) : 0;
  const lineLen = span + ring * 3;
  const textX = lineX + ring + 4.5;
  const room = c.u.w - textX - M;
  layers.push(c.shape('line', {
    shape: 'rect', w: 0.45, h: lineLen, radius: 0.22, fill: 'fg', opacity: 0.35, pin: 'ts', x: lineX - 0.225, y: first - ring * 1.5,
    start: t0, end: c.seconds, in: c.enter('grow', { dir: 'down', d: drawD, ease: 'inout' }), out: c.leave('grow', { dir: 'down', d: b.exit }),
  }));
  items.forEach((it, i) => {
    const y = first + i * rowH;
    const when = n > 1 ? reachAt((i * rowH + ring * 1.5) / lineLen) : t0 + drawD / 2;
    dot(i, lineX - ring / 2, y - ring / 2, 'ts', when);
    // A short stem from the ring to the words, as on the wide frame (and with the same ids, so a selection survives a change of shape).
    layers.push(c.shape(`stem-${i + 1}`, {
      name: 'Stem', shape: 'rect', w: textX - lineX - ring / 2 - 1.2, h: 0.3, fill: 'fg', opacity: 0.3, pin: 'ts', x: lineX + ring / 2 + 0.4, y: y - 0.15,
      start: when + b.s(0.05), end: c.seconds, in: c.enter('grow', { dir: 'start', d: b.s(0.35) }), out: leave(),
    }));
    const dateH = it.date ? dateSize * 1.15 : 0;
    if (it.date) {
      layers.push(c.text(`date-${i + 1}`, {
        name: 'Date', text: it.date, voice: 'sans', size: dateSize, weight: 800, color: i === n - 1 && n > 1 ? 'accent2' : 'accent',
        align: 'start', lead: 1.1, max: room, fit: true, pin: 'ts', x: textX, y: y - dateH / 2 - 0.4,
        start: when + b.s(0.06), end: c.seconds, in: c.enter('rise', { d: b.s(0.5), amount: 0.5 }), out: leave(),
      }));
    }
    if (it.text) {
      layers.push(c.text(`event-${i + 1}`, {
        name: 'Event', text: it.text, voice: 'sans', ...sizeFit(wrapped(it.text, textSize, room)), weight: 500, color: 'fg', align: 'start', lead: 1.25,
        max: room, pin: 'ts', x: textX, y: y + (it.date ? dateH / 2 + 0.6 : -textSize * 0.6),
        start: when + b.s(0.14), end: c.seconds, in: c.enter('rise', { d: b.s(0.55), amount: 0.5 }), out: leave(),
      }));
    }
  });
  return settle(layers, c.seconds);
}

// ── before and after ──────────────────────────────────────────────────────

/** How far a `slide` carries a layer, in u, at its largest amount (motionanim.ts: 12u a unit, amount up to 3). */
const SLIDE_MOST = 36;

/**
 * A rectangle of `w` by `h` u as path data in the shape's 100 x 100 box,
 * rounded by `r` u at the two corners on one side only (`side`: the physical
 * edge), so two halves meet square in the middle and round at the card's
 * edge. The radii are given per axis, so the box's own stretch makes them
 * round.
 */
function halfCard(w: number, h: number, r: number, side: 'left' | 'right' | 'bottom'): string {
  const rx = (Math.min(r, w / 2) / w) * 100;
  const ry = (Math.min(r, h / 2) / h) * 100;
  const n = (v: number) => Math.round(v * 1000) / 1000;
  if (side === 'right') return `M0 0H${n(100 - rx)}A${n(rx)} ${n(ry)} 0 0 1 100 ${n(ry)}V${n(100 - ry)}A${n(rx)} ${n(ry)} 0 0 1 ${n(100 - rx)} 100H0Z`;
  if (side === 'left') return `M100 0H${n(rx)}A${n(rx)} ${n(ry)} 0 0 0 0 ${n(ry)}V${n(100 - ry)}A${n(rx)} ${n(ry)} 0 0 0 ${n(rx)} 100H100Z`;
  return `M0 0H100V${n(100 - ry)}A${n(rx)} ${n(ry)} 0 0 1 ${n(100 - rx)} 100H${n(rx)}A${n(rx)} ${n(ry)} 0 0 1 0 ${n(100 - ry)}Z`;
}

/**
 * Before and after: a card shows how it was — its label in a pill at the top
 * start, its words in the middle of the first half — then a handle sweeps in
 * from the far edge to the middle, and behind it the second half wipes in,
 * lit in the accents, with its label and words arriving as the handle passes
 * them. The handle is a line and a knob with two arrows, the gesture of a
 * comparison slider, and it comes to rest exactly where the halves meet.
 *
 * The wipe, the line and the knob move as one: the wipe's edge and the line
 * both follow the same `cubic-out` over the same time, and the knob, which
 * can be carried only so far (`SLIDE_MOST`), joins them for the last part of
 * the way on a shorter run of the same curve, timed so that on that curve it
 * is exactly where the line is ((1 − s)³ shrinks by the same factor). Side
 * by side on the wide, square and 4:5 frames, with the second half at the
 * end (on the left in Arabic and Kurdish); one above the other on the tall
 * frame, the handle rising from the bottom.
 */
function compare(c: Kit): Layer[] {
  const b = beatOf(c);
  const M = marginOf(c);
  const stacked = c.portrait;
  const W = c.u.w - 2 * M;
  const H = c.u.h - 2 * M - (stacked ? 8 : 0);
  const r = 3.2;
  const pad = c.landscape ? 5 : 4.5;
  const g = sheen(stacked ? 60 : 30);
  const ink = inkOn(c, g);
  const leave = () => c.leave('fade', { d: b.exit });
  // The second half: where it sits, and how big.
  const half = stacked ? { w: W, h: H / 2, x: 0, y: H / 4 } : { w: W / 2, h: H, x: W / 4, y: 0 };
  // Where the first half's middle is.
  const firstAt = stacked ? { x: 0, y: -H / 4 } : { x: -W / 4, y: 0 };
  const textSize = c.landscape ? 6 : stacked ? 6.2 : c.square ? 5 : 5.4;
  const textMax = (stacked ? W : W / 2) - 2 * pad - 2;
  const labelSize = c.landscape ? 2.8 : 3;
  const pill = (label: string) => ({ w: emOf(label, true) * labelSize * 1.12 + labelSize * 2.4, h: labelSize * 2.1 });
  const before = (c.fields.before ?? '').trim();
  const after = (c.fields.after ?? '').trim();
  const beforeText = (c.fields.beforeText ?? '').trim();
  const afterText = (c.fields.afterText ?? '').trim();

  const t0 = b.s(0.15);
  const sweepAt = b.s(1.35);
  const sweepD = b.s(1.3);
  const sideOf = (): 'left' | 'right' | 'bottom' => (stacked ? 'bottom' : c.rtl ? 'left' : 'right');
  const layers: Layer[] = [
    c.shape('card', {
      name: 'Card', shape: 'rect', w: W, h: H, radius: r, fill: 'muted', opacity: 0.16, pin: 'mc', x: 0, y: stacked ? -4 : 0,
      start: t0, end: c.seconds, in: c.enter('zoom', { d: b.s(0.8), amount: 0.12 }), out: leave(),
    }),
  ];
  const y0 = stacked ? -4 : 0;
  // A label in a pill, at the top start of its half.
  const label = (key: string, text: string, inHalf: { x: number; y: number; w: number; h: number }, fill: Paint, color: string, at: number) => {
    if (!text) return;
    // As wide as its words, never wider than its half: a longer label is fitted inside the pill.
    const p0 = pill(text);
    const p = { w: Math.min(p0.w, inHalf.w - 2 * pad), h: p0.h };
    const x = inHalf.x - inHalf.w / 2 + pad + p.w / 2;
    const y = y0 + inHalf.y - inHalf.h / 2 + pad + p.h / 2;
    layers.push(
      c.shape(`${key}-pill`, {
        name: key === 'before' ? 'Before pill' : 'After pill', shape: 'rect', w: p.w, h: p.h, radius: p.h / 2, fill, opacity: 0.9, pin: 'mc', x, y,
        start: at, end: c.seconds, in: c.enter('pop', { d: b.s(T.quick), ease: E.pop, amount: 0.6 }), out: leave(),
      }),
      c.text(`${key}-label`, {
        name: key === 'before' ? 'Before label' : 'After label', text, voice: 'sans', size: labelSize, weight: 700, color, align: 'center', caps: true,
        track: 0.1, lead: 1, max: p.w - labelSize, fit: true, pin: 'mc', x, y, start: at + b.s(0.05), end: c.seconds,
        in: c.enter('fade', { d: b.s(0.4) }), out: leave(),
      }),
    );
  };
  const firstHalf = stacked ? { x: 0, y: -H / 4, w: W, h: H / 2 } : { x: -W / 4, y: 0, w: W / 2, h: H };
  // Both sides' words at one size, the smaller either needs, so neither looks louder for being shorter.
  const bw = wrapped(beforeText, textSize, textMax);
  const aw = wrapped(afterText, textSize, textMax);
  const wordsSize = Math.min(bw.size, aw.size);
  label('before', before, firstHalf, 'fg', 'bg', t0 + b.s(0.3));
  if (beforeText) {
    layers.push(c.text('before-text', {
      name: 'Before words', text: beforeText, voice: 'sans', size: wordsSize, weight: 700, color: 'fg', opacity: 0.72, align: 'center', lead: 1.15,
      max: textMax, fit: bw.fit, pin: 'mc', x: firstAt.x, y: y0 + firstAt.y, start: t0 + b.s(0.45),
      end: c.seconds, in: c.enter('rise', { d: b.s(T.enter) }), out: leave(),
    }));
  }

  // The sweep: the second half wiping in behind a line that grows from the far edge, the knob joining it for the last of the way.
  const wipeDir = stacked ? 'up' as const : 'end' as const;
  const sweep = (fx: 'wipe' | 'grow') => c.enter(fx, { d: sweepD, ease: 'cubic-out', dir: wipeDir });
  layers.push(
    c.shape('after-panel', {
      name: 'After panel', shape: 'path', d: halfCard(half.w, half.h, r, sideOf()), w: half.w, h: half.h, fill: g, pin: 'mc', x: half.x, y: y0 + half.y,
      start: sweepAt, end: c.seconds, in: sweep('wipe'), out: leave(),
    }),
    c.shape('divider', {
      name: 'Divider', shape: 'path', d: stacked ? 'M0 0H100' : c.rtl ? 'M100 0V100' : 'M0 0V100', w: half.w, h: half.h, fill: null,
      stroke: { color: 'fg', width: 0.6, cap: 'butt' }, pin: 'mc', x: half.x, y: y0 + half.y,
      start: sweepAt, end: c.seconds, in: sweep('grow'), out: leave(),
    }),
  );
  const travel = stacked ? half.h : half.w;
  const reach = Math.min(SLIDE_MOST, travel);
  const knobD = sweepD * Math.cbrt(reach / travel);
  const slide = c.enter('slide', { d: knobD, delay: sweepD - knobD, ease: 'cubic-out', dir: stacked ? 'up' : 'end', amount: reach / 12 });
  const knob = { pin: 'mc' as const, x: 0, y: y0, start: sweepAt, end: c.seconds, in: slide, out: leave() };
  const knobD2 = c.landscape ? 6.4 : 7;
  layers.push(
    c.shape('knob', { name: 'Knob', shape: 'ellipse', w: knobD2, h: knobD2, fill: 'fg', ...knob }),
    // Two arrows pointing out along the sweep: left and right, or up and down. Rotation is physical; x is logical, so it is mirrored.
    ...[-1, 1].map((s, i) => c.shape(`knob-arrow-${i + 1}`, {
      name: 'Arrow', shape: 'polygon', sides: 3, w: knobD2 * 0.26, h: knobD2 * 0.26, fill: 'bg', ...knob,
      x: stacked ? 0 : s * knobD2 * 0.2, y: y0 + (stacked ? s * knobD2 * 0.2 : 0),
      rot: stacked ? (s < 0 ? 0 : 180) : (s < 0) !== c.rtl ? -90 : 90,
    })),
  );
  const secondHalf = { x: half.x, y: half.y, w: half.w, h: half.h };
  label('after', after, secondHalf, 'bg', 'fg', sweepAt + sweepD * 0.55);
  if (afterText) {
    layers.push(c.text('after-text', {
      name: 'After words', text: afterText, voice: 'sans', size: wordsSize, weight: 800, color: ink, align: 'center', lead: 1.15,
      max: textMax, fit: aw.fit, pin: 'mc', x: half.x, y: y0 + half.y, start: sweepAt + sweepD * 0.4, end: c.seconds,
      in: c.enter('rise', { d: b.s(T.enter) }), out: leave(),
    }));
  }
  return settle(layers, c.seconds);
}

// ── price card ────────────────────────────────────────────────────────────

/** The family's plate shadow. */
const PLATE_SHADOW: Shadow = { color: 'rgba(0,0,0,.35)', blur: 3, x: 0, y: 1 };

/**
 * Price card: a card rises onto a faint halftone ground; in it the plan's
 * name in a small pill, then the price counting up to its number — the
 * currency before it and the period, smaller, after it — a hairline, the
 * features ticking in one after another, and last the button, which pops in
 * and catches one sweep of light. The figure is the person's: read from the
 * price field with `numberOf`, so `$19/month`, `19 €` and `١٩$` all count to
 * 19, and a price with no number (`Free`) is shown as it is.
 */
function priceCard(c: Kit): Layer[] {
  const b = beatOf(c);
  const dark = darkGround(c);
  const cardW = c.landscape ? 64 : c.portrait ? 82 : c.square ? 70 : 76;
  const pad = 6;
  const inner = cardW - 2 * pad;
  const plan = (c.fields.plan ?? '').trim();
  const priceRaw = (c.fields.price ?? '').trim();
  const slash = priceRaw.indexOf('/');
  const figureText = slash >= 0 ? priceRaw.slice(0, slash).trim() : priceRaw;
  const per = slash >= 0 ? `/${priceRaw.slice(slash + 1).trim()}` : '';
  const fig = numberOf(figureText);
  const features = linesOf(c.fields.features ?? '').slice(0, META['price-card'].fields[2].max);
  const button = (c.fields.button ?? '').trim();

  const planSize = 2.8;
  const priceSize = c.portrait ? 14 : 12;
  const perSize = c.portrait ? 4 : 3.6;
  const featSize = c.portrait ? 3.8 : 3.4;
  const rowH = featSize * 1.95;
  const btnH = c.portrait ? 9 : 8.4;
  const parts = [
    pad, plan ? planSize * 2.1 + 4 : 0, priceSize * 1.05, 3, 0.2, features.length ? 4 + features.length * rowH : 0, button ? 4.5 + btnH : 0, pad,
  ];
  const cardH = parts.reduce((s, v) => s + v, 0);
  let y = -cardH / 2;
  const next = (h: number) => {
    const mid = y + h / 2;
    y += h;
    return mid;
  };
  const leave = () => c.leave('fade', { d: b.exit });
  const t0 = b.s(0.2);
  const layers: Layer[] = [
    groundOf(c, b, 'halftone', { opacity: 0.4, density: 0.35 }),
    c.shape('card', {
      name: 'Card', shape: 'rect', w: cardW, h: cardH, radius: 3.6, fill: 'bg', shadow: PLATE_SHADOW, pin: 'mc', x: 0, y: 0,
      stroke: { color: dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.10)', width: 0.16, cap: 'round' },
      start: t0, end: c.seconds, in: c.enter('wipe', { dir: 'up', d: b.s(0.7) }), out: c.leave('wipe', { dir: 'up', d: b.exit }),
    }),
    c.shape('card-sheen', {
      name: 'Glass', shape: 'rect', w: cardW, h: cardH, radius: 3.6, pin: 'mc', x: 0, y: 0,
      fill: { kind: 'linear', angle: 90, stops: [{ at: 0, color: dark ? 'rgba(255,255,255,.09)' : 'rgba(0,0,0,.03)' }, { at: 0.6, color: 'rgba(255,255,255,0)' }] },
      start: t0, end: c.seconds, in: c.enter('wipe', { dir: 'up', d: b.s(0.7) }), out: c.leave('wipe', { dir: 'up', d: b.exit }),
    }),
  ];
  next(pad);
  if (plan) {
    const pw = Math.min(inner, emOf(plan, true) * planSize * 1.12 + planSize * 2.6);
    const py = next(planSize * 2.1);
    next(4);
    // The plan's name is the accent on a tint of the accent, as a badge's is — where that reads. The pill sits at the
    // top of the card, where its sheen is lightest, and there the accent on its own tint can fall under the 3:1 that
    // bold words this size need (the card's own palette, royal, measured 3.0 in the app's check; paper does worse):
    // then the name is set in the ink on the same tint. Worked out from the palette, so another palette decides anew.
    const lit = mixColors(c.palette.bg, dark ? '#FFFFFF' : '#000000', dark ? 0.09 : 0.03);
    const tint = mixColors(lit, c.palette.accent, 0.18);
    const planInk = contrast(c.palette.accent, tint) >= 3.2 ? 'accent' : 'fg';
    layers.push(
      c.shape('plan-pill', {
        name: 'Plan pill', shape: 'rect', w: pw, h: planSize * 2.1, radius: planSize * 1.05, fill: 'accent', opacity: 0.18, pin: 'mc', x: 0, y: py,
        start: t0 + b.s(0.3), end: c.seconds, in: c.enter('pop', { d: b.s(T.quick), ease: E.pop, amount: 0.6 }), out: leave(),
      }),
      c.text('plan', {
        text: plan, voice: 'sans', size: planSize, weight: 800, color: planInk, align: 'center', caps: true, track: 0.14, lead: 1,
        max: pw - planSize, fit: true, pin: 'mc', x: 0, y: py, start: t0 + b.s(0.35), end: c.seconds, in: c.enter('fade', { d: b.s(0.4) }), out: leave(),
      }),
    );
  }
  // The price and its period on one line, centred together.
  const py = next(priceSize * 1.05);
  const priceIn = t0 + b.s(0.45);
  if (fig) {
    const prefix = markOf(c, fig.prefix);
    const suffix = markOf(c, fig.percent ? '%' : fig.suffix);
    const priceW = figureEm(fig.value, fig.decimals, prefix, suffix, c.lang) * priceSize;
    const perW = per ? emOf(per) * perSize + 0.5 : 0;
    const size = Math.min(priceSize, (inner - perW - 1.2) / Math.max(0.1, priceW / priceSize));
    const total = Math.min(inner, (priceW * size) / priceSize + (per ? 1.2 + perW : 0));
    const counterW = (priceW * size) / priceSize;
    layers.push(c.counter('price', {
      from: 0, to: fig.value, decimals: fig.decimals, prefix, suffix, group: true, voice: 'sans', size, weight: 800, color: 'fg', align: 'center',
      track: -0.02, pin: 'mc', x: -total / 2 + counterW / 2, y: py, start: priceIn, end: c.seconds,
      count: { d: b.s(1.3), delay: 0, ease: E.enter }, in: c.enter('rise', { d: b.s(T.enter) }), out: leave(),
    }));
    if (per) {
      layers.push(c.text('period', {
        name: 'Price period', text: per, voice: 'sans', size: perSize, weight: 500, color: 'muted', align: 'start', lead: 1, max: perW + 0.5, fit: true,
        pin: 'mc', x: -total / 2 + counterW + 1.2 + (perW + 0.5) / 2, y: py + size * 0.32 - perSize * 0.35,
        start: priceIn + b.s(0.25), end: c.seconds, in: c.enter('fade', { d: b.s(0.5) }), out: leave(),
      }));
    }
  } else if (priceRaw) {
    layers.push(c.text('price-words', {
      name: 'Price', text: priceRaw, voice: 'sans', size: priceSize * 0.8, weight: 800, color: 'fg', align: 'center', lead: 1, max: inner, fit: true,
      pin: 'mc', x: 0, y: py, start: priceIn, end: c.seconds, in: c.enter('rise', { d: b.s(T.enter) }), out: leave(),
    }));
  }
  next(3);
  const ruleY = next(0.2);
  layers.push(c.shape('rule', {
    name: 'Divider', shape: 'rect', w: inner, h: 0.2, radius: 0.1, fill: 'fg', opacity: 0.16, pin: 'mc', x: 0, y: ruleY,
    start: priceIn + b.s(0.2), end: c.seconds, in: c.enter('grow', { dir: 'start', d: b.s(0.7) }), out: leave(),
  }));
  if (features.length) {
    next(4);
    features.forEach((f, i) => {
      const fy = next(rowH);
      const at = priceIn + b.s(0.45 + i * 0.1);
      layers.push(
        c.icon(`check-${i + 1}`, {
          name: 'Check', icon: 'check', size: featSize * 0.95, color: 'accent', weight: 2.6, pin: 'mc', x: -inner / 2 + featSize * 0.5, y: fy,
          start: at, end: c.seconds, in: c.enter('pop', { d: b.s(T.quick), ease: E.pop }), out: leave(),
        }),
        c.text(`feature-${i + 1}`, {
          name: 'Feature', text: f, voice: 'sans', size: featSize, weight: 500, color: 'fg', align: 'start', lead: 1.2,
          max: inner - featSize * 1.9, fit: true, pin: 'mc', x: -inner / 2 + featSize * 1.9 + (inner - featSize * 1.9) / 2, y: fy,
          start: at + b.s(0.05), end: c.seconds, in: c.enter('rise', { d: b.s(0.55), amount: 0.4 }), out: leave(),
        }),
      );
    });
  }
  if (button) {
    next(4.5);
    const by = next(btnH);
    const at = priceIn + b.s(0.55 + features.length * 0.1);
    const box = { shape: 'rect' as const, w: inner, h: btnH, radius: btnH / 2, pin: 'mc' as const, x: 0, y: by };
    const pop = c.enter('pop', { d: b.s(0.55), ease: E.pop, amount: 0.5 });
    layers.push(
      c.shape('button', {
        name: 'Button', ...box, fill: sheen(0), start: at, end: c.seconds, in: pop, out: leave(),
      }),
      c.text('button-label', {
        name: 'Button label', text: button, voice: 'sans', size: featSize * 1.05, weight: 700, color: inkOn(c, sheen(0)), align: 'center', lead: 1,
        max: inner - btnH, fit: true, pin: 'mc', x: 0, y: by, start: at + b.s(0.12), end: c.seconds, in: c.enter('fade', { d: b.s(0.35) }), out: leave(),
      }),
    );
    // One sweep of light across the button as it pops in, gone by the gallery's still. The card's cover is drawn at
    // `stillTime` (motionanim.ts), just after the last arrival; a sweep has no entrance of its own, so one that began
    // after everything had landed was itself the last arrival, and the cover caught it a third of the way across the
    // button. This one rides the button's own pop (it arrives with it, so it moves nothing), has no exit, and ends before
    // the still worked out from the other layers — which it therefore cannot move.
    const end = stillTime(settle(layers, c.seconds), c.seconds) - 0.05;
    // At least as long as the pop it rides (else `settle` would shorten its entrance and it would drift off the button).
    if (end - at >= Math.max(0.4, pop.d)) {
      layers.push(c.shape('button-shine', {
        name: 'Shine', ...box, fill: '#ffffff00', opacity: 0.35, start: at, end, in: pop, loop: c.loop('shimmer', { d: end - at }),
      }));
    }
  }
  return settle(layers, c.seconds);
}

// ── progress rings ────────────────────────────────────────────────────────

/**
 * Progress rings: the title masks in, then one to four rings sweep round
 * from the top one after another, each to its share, its number counting up
 * in the middle and its label rising beneath; the fullest is lit in the
 * second accent. A value written with `%`, or 100 and under, is a share of a
 * hundred; a larger plain number fills its ring and is shown as it is. A row
 * on the wide frame; on the others a row for up to three and two by two for
 * four, and a column on the tall frame for up to three.
 */
function progressStats(c: Kit): Layer[] {
  const b = beatOf(c);
  const M = sideOf(c);
  const items = itemsOf(c.fields.items ?? '', META['progress-stats'].fields[1].max, sampleOf(c, 'items'), WRAPPED_LABEL);
  const n = items.length;
  const cols = c.landscape ? n : c.portrait ? (n <= 3 ? 1 : 2) : n <= 3 ? n : 2;
  const rows = Math.ceil(n / cols);
  const head = headOf(c, b, 'center');
  const top = head.bottom + (c.landscape ? 6 : 7);
  const bottom = footOf(c);
  const cellW = (c.u.w - 2 * M) / cols;
  const cellH = (bottom - top) / rows;
  const labelSize = c.landscape ? 3.4 : c.portrait ? 3.8 : 3.2;
  const labelRoom = labelSize * 1.25 * 2 + 3;
  const D = clamp(Math.min(cellW * (cols > 2 ? 0.66 : 0.6), cellH - labelRoom), 14, c.landscape ? 44 : 48);
  let fullest = 0;
  items.forEach((it, i) => {
    const share = (v: Item) => (v.percent || Math.abs(v.value) <= 100 ? v.value / 100 : 1);
    if (share(it) > share(items[fullest])) fullest = i;
  });
  const layers: Layer[] = [groundOf(c, b, 'aurora', { opacity: 0.55, density: 0.35 }), ...head.layers];
  const blockH = D + labelRoom;
  const used = rows * cellH;
  items.forEach((it, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    // A last row with fewer rings is centred under the others.
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const x = (col - (inRow - 1) / 2) * cellW;
    const cy = top + row * cellH + (cellH - blockH) / 2 + D / 2 + Math.max(0, (bottom - top - used) / 2);
    const at = b.s(0.45) + i * b.s(0.15);
    const pct = it.percent || Math.abs(it.value) <= 100;
    layers.push(c.chart(`ring-${i + 1}`, {
      name: 'Ring', chart: 'ring', w: D, h: D, data: [{ label: it.label, value: it.value }], colors: [i === fullest && n > 1 ? 'accent2' : 'accent'],
      max: pct ? 100 : 0, unit: pct ? markOf(c, '%') : markOf(c, it.suffix), labels: false, values: true, voice: 'sans', size: labelSize, color: 'fg',
      thick: D * 0.085, gap: 0, pin: 'mc', x, y: cy - c.u.h / 2, start: at, end: c.seconds,
      in: c.enter('draw', { d: b.s(1.4) }), out: c.leave('draw', { d: b.exit }),
    }));
    if (it.label) {
      // Room is kept for two lines of label (`labelRoom`); a longer one keeps the words that fit and an ellipsis, rather
      // than the 24 characters a chart keeps ("Attendance across the te").
      const labelMax = Math.min(cellW * 0.9, D * 1.6);
      const set = wrapped(it.label, labelSize, labelMax);
      layers.push(c.text(`label-${i + 1}`, {
        text: clipToLines(it.label, set.size, labelMax, 2), voice: 'sans', ...sizeFit(set), weight: 600, color: 'muted', align: 'center',
        lead: 1.25, max: labelMax,
        pin: 'tc', x, y: cy + D / 2 + 3, start: at + b.s(0.3), end: c.seconds,
        in: c.enter('rise', { d: b.s(T.enter), amount: 0.5 }), out: c.leave('fade', { d: b.exit }),
      }));
    }
  });
  return settle(layers, c.seconds);
}

// ── retro screen ──────────────────────────────────────────────────────────

/**
 * Retro screen: an old television switching on. A line of light flashes
 * across the middle and spreads as it fades, the title opens out of it
 * (`flip`, its height growing from nothing) with two copies in the accents
 * a hair to either side, added as light, so its edges split into colour the
 * way a worn tube's do and jitter a little while it holds; the subtitle
 * types itself in under it. A halftone glow drifts behind, and scan lines and
 * a dark vignette lie over everything. It switches off the way it came on,
 * folding back into a line.
 */
function retroTitle(c: Kit): Layer[] {
  const b = beatOf(c);
  const M = marginOf(c);
  const S = c.seconds;
  const title = (c.fields.title ?? '').trim();
  const subtitle = (c.fields.subtitle ?? '').trim();
  const size0 = c.landscape ? 13 : c.portrait ? 12 : 11;
  const max = c.u.w - 2 * M;
  const subSize = c.landscape ? 3.4 : 3.8;
  // The condensed face sets about 82% as wide as the estimate: how many lines the title takes, for the subtitle under it.
  const tw = wrapped(title, size0 * 0.82, max, true);
  const size = tw.size / 0.82;
  const squeeze = tw.fit;
  const lines = title ? (squeeze ? 1 : clamp(Math.ceil((emOf(title, true) * 0.82 * size) / max), 1, 3)) : 0;
  const lead = 0.95;
  const blockH = lines * size * lead + (subtitle ? subSize * 1.3 + 4 : 0);
  const titleY = -blockH / 2 + (lines * size * lead) / 2;
  const t0 = b.s(0.35);
  const flip = (delay: number) => c.enter('flip', { d: b.s(0.55), ease: E.enter, delay });
  const layers: Layer[] = [
    c.backdrop('halftone', {
      name: 'Halftone', style: 'halftone', colors: ['accent', 'accent2'], density: 0.5, speed: 1, opacity: 0.6,
      start: 0, end: S, in: c.enter('fade', { d: b.s(0.8), ease: E.soft }),
    }),
    c.shape('flash', {
      name: 'Flash', shape: 'rect', w: c.u.w * 0.8, h: 0.5, radius: 0.25, fill: 'fg', pin: 'mc', x: 0, y: titleY,
      start: b.s(0.15), end: t0 + b.s(0.3), in: c.enter('fade', { d: b.s(0.08), ease: 'linear' }), out: c.leave('zoom', { d: b.s(0.3), amount: 1.2 }),
    }),
  ];
  if (title) {
    const copy = (key: string, color: string, dx: number, dy: number, period: number): Layer => c.text(key, {
      name: 'Title glow', text: title, voice: 'condensed', size, weight: 800, color, align: 'center', caps: true,
      track: 0.02, lead, max, fit: squeeze, pin: 'mc', x: dx, y: titleY + dy, blend: 'screen', opacity: 0.85, start: t0, end: S,
      in: flip(b.s(0.05)), out: c.leave('flip', { d: b.exit, ease: E.exit }), loop: c.loop('float', { d: period, amount: 0.12 }),
    });
    layers.push(
      copy('title-red', 'accent2', -0.55, 0.15, 0.23),
      copy('title-blue', 'accent', 0.55, -0.15, 0.31),
      c.text('title', {
        text: title, voice: 'condensed', size, weight: 800, color: 'fg', align: 'center', caps: true, track: 0.02, lead, max, fit: squeeze,
        pin: 'mc', x: 0, y: titleY, start: t0, end: S, in: flip(0), out: c.leave('flip', { d: b.exit, ease: E.exit }),
      }),
    );
  }
  if (subtitle) {
    layers.push(c.text('subtitle', {
      text: subtitle, voice: 'mono', size: subSize, weight: 500, color: 'fg', opacity: 0.85, align: 'center', caps: true, track: 0.12, lead: 1.3, max,
      fit: true, pin: 'mc', x: 0, y: titleY + (lines * size * lead) / 2 + 4 + (subSize * 1.3) / 2, start: t0 + b.s(0.55), end: S,
      in: c.enter('type', { d: b.s(0.9), ease: 'linear' }), out: c.leave('fade', { d: b.exit }),
    }));
  }
  layers.push(
    c.backdrop('scanlines', { name: 'Scan lines', style: 'scanlines', colors: ['#000000', '#FFFFFF'], density: 0.55, speed: 1, opacity: 0.8, start: 0, end: S }),
    c.backdrop('vignette', { name: 'Vignette', style: 'vignette', colors: ['#000000'], density: 0.6, speed: 1, start: 0, end: S }),
  );
  return settle(layers, S);
}

// ── the samples ───────────────────────────────────────────────────────────

/**
 * What each template says before the person writes anything: plainly
 * placeholders — fruit sold by the tonne, a small firm's story, a term's
 * attendance — so nobody takes one for a fact. Digits are 0-9; the engine
 * writes them in the graphic's own wherever it draws a figure.
 */
const SAMPLES: Readonly<Record<ProBId, Record<Lang, Record<string, string>>>> = {
  'film-look': {
    en: { caption: 'A summer in the mountains' },
    ar: { caption: 'صيف في الجبال' },
    ckb: { caption: 'هاوینێک لە چیاکان' },
    kmr: { caption: 'هاڤینەک ل چیایان' },
  },
  'bar-race': {
    en: {
      title: 'Fruit sold each year',
      items: 'Apples: 40, 55, 72, 90, 112, 126\nOranges: 28, 44, 70, 95, 128, 160\nGrapes: 52, 60, 64, 69, 73, 78\nFigs: 15, 30, 48, 66, 85, 108\nPears: 22, 31, 40, 52, 61, 70\nLemons: 10, 18, 35, 49, 58, 86',
      periods: '2019, 2020, 2021, 2022, 2023, 2024', unit: 't',
    },
    ar: {
      title: 'مبيعات الفاكهة سنوياً',
      items: 'التفاح: 40, 55, 72, 90, 112, 126\nالبرتقال: 28, 44, 70, 95, 128, 160\nالعنب: 52, 60, 64, 69, 73, 78\nالتين: 15, 30, 48, 66, 85, 108\nالكمثرى: 22, 31, 40, 52, 61, 70\nالليمون: 10, 18, 35, 49, 58, 86',
      periods: '2019, 2020, 2021, 2022, 2023, 2024', unit: 'طن',
    },
    ckb: {
      title: 'میوەی فرۆشراو هەموو ساڵێک',
      items: 'سێو: 40, 55, 72, 90, 112, 126\nپرتەقاڵ: 28, 44, 70, 95, 128, 160\nترێ: 52, 60, 64, 69, 73, 78\nهەنجیر: 15, 30, 48, 66, 85, 108\nهەرمێ: 22, 31, 40, 52, 61, 70\nلیمۆ: 10, 18, 35, 49, 58, 86',
      periods: '2019, 2020, 2021, 2022, 2023, 2024', unit: 'تەن',
    },
    kmr: {
      title: 'فێقیێن هاتینە فرۆتن هەر سال',
      items: 'سێڤ: 40, 55, 72, 90, 112, 126\nپرتەقال: 28, 44, 70, 95, 128, 160\nتری: 52, 60, 64, 69, 73, 78\nهەژیر: 15, 30, 48, 66, 85, 108\nهرمی: 22, 31, 40, 52, 61, 70\nلیمۆن: 10, 18, 35, 49, 58, 86',
      periods: '2019, 2020, 2021, 2022, 2023, 2024', unit: 'تەن',
    },
  },
  timeline: {
    en: { title: 'Our story', items: '2016: Founded in one small room\n2018: Our first hundred customers\n2021: A team of twenty\n2024: Open in three new cities' },
    ar: { title: 'قصتنا', items: '2016: البداية في غرفة صغيرة\n2018: أول مئة عميل\n2021: فريق من عشرين شخصاً\n2024: افتتاح فروع في ثلاث مدن جديدة' },
    ckb: { title: 'چیرۆکی ئێمە', items: '2016: دەستپێک لە ژوورێکی بچووک\n2018: یەکەم سەد کڕیارمان\n2021: تیمێکی بیست کەسی\n2024: کرانەوە لە سێ شاری نوێ' },
    kmr: { title: 'چیرۆکا مە', items: '2016: دەستپێک د ژوورەکا بچووک دا\n2018: ئێکەمین سەد کڕیارێن مە\n2021: تیمەکێ بیست کەسی\n2024: ڤەبوون ل سێ باژێرێن نوو' },
  },
  compare: {
    en: { before: 'Before', beforeText: 'Paper forms and long queues', after: 'After', afterText: 'One tap on your phone' },
    ar: { before: 'قبل', beforeText: 'أوراق كثيرة وطوابير طويلة', after: 'بعد', afterText: 'لمسة واحدة على هاتفك' },
    ckb: { before: 'پێشتر', beforeText: 'فۆڕمی کاغەز و ڕیزی درێژ', after: 'ئێستا', afterText: 'تەنها یەک دەستلێدان لە مۆبایلەکەت' },
    kmr: { before: 'بەری نوکە', beforeText: 'فۆرمێن کاغەزی و ڕیزێن درێژ', after: 'نوکە', afterText: 'تنێ ئێک تکاندن ل سەر مۆبایلا تە' },
  },
  'price-card': {
    en: { plan: 'Pro', price: '$19/month', features: 'Unlimited projects\nExport in full HD\nPriority support', button: 'Start free trial' },
    ar: { plan: 'احترافي', price: '19$/شهر', features: 'مشاريع غير محدودة\nتصدير بدقة عالية\nأولوية في الدعم الفني', button: 'ابدأ التجربة المجانية' },
    ckb: { plan: 'پرۆ', price: '19$/مانگانە', features: 'پرۆژەی بێسنوور\nهەناردەکردن بە کوالیتی بەرز\nپشتگیریی لەپێشینە', button: 'تاقیکردنەوەی بێبەرامبەر' },
    kmr: { plan: 'پرۆ', price: '19$/هەیڤانە', features: 'پرۆژێن بێ سنوور\nهەناردەکرن ب کوالیتییا بلند\nپشتەڤانییا ب پێشینە', button: 'تاقیکرنا بێ بەرامبەر' },
  },
  'progress-stats': {
    en: { title: 'This term at a glance', items: 'Attendance: 92%\nHomework done: 78%\nExams passed: 85%\nProjects: 64%' },
    ar: { title: 'لمحة عن هذا الفصل', items: 'الحضور: 92%\nالواجبات المنجزة: 78%\nالنجاح في الامتحانات: 85%\nالمشاريع: 64%' },
    ckb: { title: 'ئەم وەرزە بە کورتی', items: 'ئامادەبوون: 92%\nئەرکی تەواوکراو: 78%\nدەرچوون لە تاقیکردنەوە: 85%\nپرۆژەکان: 64%' },
    kmr: { title: 'ئەڤ وەرزە ب کورتی', items: 'ئامادەبوون: 92%\nئەرکێن ب دوماهی هاتین: 78%\nدەرباسبوون د ئەزموونان دا: 85%\nپرۆژە: 64%' },
  },
  'retro-title': {
    en: { title: 'Retro night', subtitle: 'Live from the studio' },
    ar: { title: 'ليلة الذكريات', subtitle: 'بث مباشر من الاستوديو' },
    ckb: { title: 'شەوی بیرەوەری', subtitle: 'ڕاستەوخۆ لە ستۆدیۆوە' },
    kmr: { title: 'شەڤا بیرهاتنان', subtitle: 'ڕاستەوخۆ ژ ستۆدیۆیێ' },
  },
};

// ── the recipes ───────────────────────────────────────────────────────────

const recipe = (id: ProBId, build: (c: Kit) => Layer[]): Recipe => ({ build, sample: SAMPLES[id] });

/** Work package 08's templates: how each is built. */
export const PRO_B_RECIPES: Readonly<Record<ProBId, Recipe>> = {
  'film-look': recipe('film-look', filmLook),
  'bar-race': recipe('bar-race', barRace),
  timeline: recipe('timeline', timeline),
  compare: recipe('compare', compare),
  'price-card': recipe('price-card', priceCard),
  'progress-stats': recipe('progress-stats', progressStats),
  'retro-title': recipe('retro-title', retroTitle),
};
