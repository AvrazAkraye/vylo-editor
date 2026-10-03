import type { Anim, Layer, Paint, RecipeId, Shadow, Stroke, Voice } from './motiontypes';
import { E, META, type Kit, type Recipe } from './motionrecipe';
import { clamp, contrast, luminance } from './motionmath';
import { digitsFor, toArabicDigits } from './motionfonts';
import { stillTime } from './motionanim';

/**
 * The overlay and brand recipes: lower third, subscribe, callout, social
 * handle (overlays: a transparent frame, made to sit over video), and logo
 * reveal, countdown and intro sting (brand: a frame of their own).
 *
 * ## Words on glass, never on the footage
 *
 * An overlay cannot know what is under it — a white wall one second, a night
 * street the next — so none of its words stands on the video itself. Each sits
 * on a plate of the palette's own ground (`glassOf`): the palette guarantees
 * its ink reads on its ground, so the words read over any footage, bright or
 * dark. The same rule makes a light palette a light plate and a dark one a
 * dark plate, with no special case.
 *
 * ## Plates sized from the words
 *
 * A plate is drawn from numbers, before any word is measured, so it is sized
 * by `widthOf`, from advance widths measured in the app's own engine (SF Pro
 * and Avenir Next for Latin; for Arabic script the bundled Noto Sans Arabic,
 * letter by letter in the form each letter takes in its word). That lands
 * within about 2% of what the renderer draws, where counting characters is 40%
 * out for Arabic. Every word that stands on a plate also has `fit`, so a face
 * that ever measures wider shrinks the words to the plate instead of past it.
 *
 * ## Timing
 *
 * Each recipe is timed at its natural length (`META[id].seconds`), with the
 * exit anchored to the end: a longer graphic only holds longer. A shorter one
 * is the same choreography compressed (`paceOf`), so two seconds still arrive,
 * hold and leave rather than cutting off mid-entrance. The countdown is the
 * exception: its step is `seconds / (from + 1)`, so it counts at whatever pace
 * its length gives it.
 */

// ── measuring words ───────────────────────────────────────────────────────

/**
 * Advance widths, in hundredths of an em, of the printable ASCII characters
 * (space to `~`) in the two faces these recipes size plates for, measured at
 * 100 px in the app's engine (WKWebView, macOS 26): `sans` is SF Pro
 * (`system-ui`), `bold` is Avenir Next. Two weights each; others are
 * interpolated.
 *
 * SF Pro (and SF Rounded) set a little wider the smaller they are drawn — its
 * optical sizes — while Avenir Next and the Arabic face do not: +1 to 3% at
 * the sizes a 1080p export draws words, 5 to 8% in the stage's preview, up to
 * 20% in a gallery card. So SF widths are taken 2% wide (`SF_AT_1080`), which
 * matches the export, and every word on a plate has headroom in its `max`
 * reaching into the plate's end padding (`roomy`): a preview's slightly wider
 * words use a little of the padding before `fit` shrinks anything.
 */
const LATIN: Readonly<Record<'sans' | 'bold', readonly (readonly [number, readonly number[]])[]>> = {
  sans: [
    [400, [
      21, 27, 40, 60, 60, 81, 67, 25, 32, 32, 40, 60, 21, 43, 21, 28, 61, 44, 57, 59, 60, 58, 62, 55, 60, 62, 21, 21,
      60, 60, 60, 49, 87, 64, 60, 69, 68, 55, 53, 71, 70, 22, 50, 60, 52, 83, 70, 73, 58, 73, 60, 59, 58, 70, 63, 92,
      63, 61, 62, 32, 28, 32, 60, 53, 50, 50, 55, 50, 55, 51, 30, 55, 54, 21, 21, 49, 20, 80, 53, 53, 55, 55, 31, 47,
      30, 53, 48, 72, 47, 49, 47, 32, 22, 32, 60,
    ]],
    [700, [
      20, 32, 46, 64, 65, 89, 70, 27, 38, 38, 45, 65, 24, 44, 24, 30, 66, 48, 60, 63, 65, 63, 65, 57, 65, 65, 24, 24,
      65, 65, 65, 53, 89, 69, 64, 71, 70, 57, 55, 73, 73, 26, 56, 65, 54, 86, 71, 75, 62, 75, 64, 63, 60, 71, 68, 97,
      69, 67, 63, 38, 30, 38, 65, 58, 50, 55, 60, 54, 60, 55, 36, 59, 58, 24, 24, 54, 24, 86, 58, 57, 59, 59, 36, 51,
      36, 58, 53, 79, 53, 54, 51, 38, 24, 38, 65,
    ]],
  ],
  bold: [
    [500, [
      25, 33, 42, 57, 60, 87, 72, 26, 32, 32, 45, 67, 26, 32, 26, 38, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 30, 30,
      67, 67, 67, 50, 80, 71, 64, 71, 76, 60, 57, 78, 73, 27, 50, 66, 51, 90, 77, 85, 60, 85, 61, 57, 57, 71, 64, 99,
      67, 62, 59, 32, 38, 32, 67, 50, 25, 54, 64, 49, 64, 57, 31, 63, 58, 26, 26, 53, 26, 89, 58, 61, 63, 63, 36, 44,
      33, 58, 50, 77, 51, 50, 46, 32, 22, 32, 67,
    ]],
    [800, [
      25, 45, 56, 62, 70, 94, 84, 33, 36, 36, 53, 67, 36, 34, 36, 46, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 38, 38,
      67, 67, 67, 59, 80, 78, 69, 70, 79, 60, 58, 76, 80, 37, 57, 76, 55, 101, 79, 86, 68, 86, 71, 62, 60, 78, 74, 108,
      80, 74, 67, 36, 46, 36, 71, 50, 36, 59, 69, 53, 69, 63, 42, 70, 67, 34, 35, 67, 34, 98, 67, 66, 69, 69, 45, 51,
      42, 66, 64, 97, 68, 64, 56, 36, 27, 36, 67,
    ]],
  ],
};

/**
 * Noto Sans Arabic, the face every voice sets Arabic script in: each
 * letter's isolated, initial, medial and final form in ems at weight 400,
 * grouped by the skeleton the letters share (dots do not change a width).
 * Summing the form each letter takes in its word lands within 2% of the
 * engine's width for every Arabic, Sorani and Badini word tried; counting
 * letters is 40% out, because a seen is four alefs wide.
 */
const ARABIC_FORMS: readonly (readonly [string, number, number, number, number])[] = [
  ['ء', 0.41, 0.41, 0.41, 0.41],
  ['آأإاٱ', 0.24, 0.24, 0.29, 0.29],
  ['بتثپ', 0.99, 0.28, 0.36, 1.09],
  ['ن', 0.69, 0.27, 0.34, 0.73],
  ['ئىيیێ', 0.76, 0.29, 0.36, 0.74],
  ['جحخ', 0.64, 0.59, 0.64, 0.65],
  ['چ', 0.66, 0.59, 0.64, 0.72],
  ['دذ', 0.48, 0.48, 0.53, 0.53],
  ['رزژڕ', 0.37, 0.37, 0.4, 0.4],
  ['سش', 1.21, 0.78, 0.85, 1.27],
  ['صض', 1.31, 0.9, 0.95, 1.35],
  ['طظ', 0.79, 0.68, 0.71, 0.83],
  ['عغ', 0.51, 0.5, 0.52, 0.53],
  ['فڤ', 0.98, 0.45, 0.5, 1.1],
  ['ق', 0.77, 0.45, 0.5, 0.81],
  ['كکگ', 0.88, 0.41, 0.51, 0.95],
  ['لڵ', 0.7, 0.26, 0.3, 0.73],
  ['م', 0.48, 0.53, 0.58, 0.56],
  ['هھ', 0.67, 0.57, 0.51, 0.55],
  ['وۆؤ', 0.45, 0.45, 0.47, 0.47],
  ['ةە', 0.41, 0.41, 0.49, 0.49],
];

const FORMS = new Map<string, readonly [number, number, number, number]>();
for (const [letters, iso, ini, med, fin] of ARABIC_FORMS) for (const ch of letters) FORMS.set(ch, [iso, ini, med, fin]);

/** Letters that never join the letter after them (alef, dal, reh, waw, ae…) and the hamza, which joins neither side. */
const NO_JOIN_AFTER = new Set(Array.from('ءآأإاٱؤوۆدذرزژڕةە'));

const ARABIC_CHAR = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFE]/;
const ARABIC_MARK = /[\u064B-\u065F\u0670\u06D6-\u06ED]/;
const ARABIC_DIGIT = /[\u0660-\u0669\u06F0-\u06F9]/;

/** Ems of one word of Arabic script at weight 400: each letter in the form its neighbours give it. */
function arabicEm(word: string): number {
  const chars = Array.from(word).filter((ch) => !ARABIC_MARK.test(ch));
  let em = 0;
  chars.forEach((ch, i) => {
    const forms = FORMS.get(ch);
    if (!forms) {
      em += ARABIC_DIGIT.test(ch) ? 0.55 : ch === '\u200C' || ch === '\u200D' ? 0 : 0.42;
      return;
    }
    const prev = i > 0 ? chars[i - 1] : '';
    const next = i < chars.length - 1 ? chars[i + 1] : '';
    const joinsPrev = FORMS.has(prev) && !NO_JOIN_AFTER.has(prev) && ch !== 'ء';
    const joinsNext = FORMS.has(next) && !NO_JOIN_AFTER.has(ch) && next !== 'ء';
    em += forms[joinsPrev ? (joinsNext ? 2 : 3) : joinsNext ? 1 : 0];
  });
  return em;
}

/** The em width of one character of Latin (or anything not Arabic) in a voice and weight. */
function latinEm(ch: string, voice: Voice, weight: number): number {
  if (voice === 'mono') return 0.6;
  const base = ch.normalize('NFD').charAt(0);
  const code = base.charCodeAt(0);
  if (code >= 0x2e80) return 1;
  const rows = LATIN[voice === 'bold' || voice === 'condensed' ? 'bold' : 'sans'];
  const [w0, r0] = rows[0];
  const [w1, r1] = rows[1];
  const at = code - 32;
  const a = at >= 0 && at < r0.length ? r0[at] : 60;
  const b = at >= 0 && at < r1.length ? r1[at] : 64;
  const t = clamp((weight - w0) / (w1 - w0), -0.4, 1.7);
  const em = (a + (b - a) * t) / 100;
  return voice === 'condensed' ? em * 0.8 : voice === 'bold' ? em : em * SF_AT_1080;
}

/** How much wider SF Pro sets at a 1080p export's word sizes than at the 100 px it was measured at. */
const SF_AT_1080 = 1.02;

/**
 * A plate's text width with headroom: the room the words were sized for plus
 * part of the padding after them, so words drawn a few percent wider (a
 * smaller preview, another engine) run into the padding instead of shrinking.
 */
const roomy = (inner: number, pad: number) => inner + Math.min(pad * 0.7, inner * 0.08);

interface Measure {
  voice: Voice;
  weight: number;
  caps?: boolean;
  /** Letter spacing in ems, as the text layer's `track`. */
  track?: number;
}

/**
 * The width in u of one line of `text` set at `size` u, as the renderer will
 * draw it: Arabic script word by word in its joined forms (never tracked, never
 * in capitals, as the renderer sets it), everything else character by character.
 */
function lineWidth(text: string, size: number, m: Measure): number {
  const arabic = ARABIC_CHAR.test(text);
  const caps = !!m.caps && !arabic;
  const track = arabic ? 0 : m.track ?? 0;
  const shown = caps ? text.toUpperCase() : text;
  const weightScale = 1 + 0.1 * clamp((m.weight - 400) / 300, 0, 1);
  let em = 0;
  const words = shown.split(/\s+/).filter(Boolean);
  words.forEach((word, i) => {
    if (i) em += (arabic ? 0.312 : latinEm(' ', m.voice, m.weight)) + track;
    let run = '';
    const flush = () => {
      if (run) em += arabicEm(run) * weightScale;
      run = '';
    };
    for (const ch of Array.from(word)) {
      if (ARABIC_CHAR.test(ch)) {
        run += ch;
        continue;
      }
      flush();
      em += latinEm(ch, m.voice, m.weight) + track;
    }
    flush();
    if (!arabic && track && word) em -= track;
  });
  return em * size;
}

/** The widest line of `text` (lines at its line breaks), in u. */
function widthOf(text: string, size: number, m: Measure): number {
  return Math.max(0, ...text.split('\n').map((l) => lineWidth(l, size, m)));
}

/**
 * `text` in at most two lines no wider than `room` u: as it is when it fits,
 * else broken where the longer line is shortest, so a two-line title is two
 * even lines rather than a full one and a straggler. The break is written into
 * the words (`\n`), so the renderer draws exactly these lines; `fit` then
 * shrinks them should the longer still not fit.
 */
function twoLines(text: string, size: number, m: Measure, room: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  const one = words.join(' ');
  if (words.length < 2 || lineWidth(one, size, m) <= room) return one;
  let best = one;
  let bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const w = Math.max(lineWidth(a, size, m), lineWidth(b, size, m));
    if (w < bestW) {
      bestW = w;
      best = `${a}\n${b}`;
    }
  }
  return best;
}

// ── shared looks ──────────────────────────────────────────────────────────

type Ink = 'fg' | 'bg';

/** A token as the colour the palette gives it; a colour as itself. */
function colourOf(c: Kit, x: string): string {
  const p = c.palette as unknown as Record<string, string>;
  return Object.prototype.hasOwnProperty.call(p, x) ? p[x] : x;
}

/**
 * Which of the palette's ink and ground to set words in on `on` (every stop
 * of it, for a gradient): the lighter one when it clears `need` on all of it
 * — light words on a saturated button read as designed — else whichever reads
 * better. Bold labels are large text, so 3:1 is the line.
 */
function inkOn(c: Kit, on: Paint, need = 3): Ink {
  const colours = typeof on === 'string' ? [on] : on.stops.map((s) => s.color);
  const worst = (t: Ink) => Math.min(...colours.map((x) => contrast(colourOf(c, t), colourOf(c, x))));
  const light: Ink = luminance(c.palette.fg) >= luminance(c.palette.bg) ? 'fg' : 'bg';
  const dark: Ink = light === 'fg' ? 'bg' : 'fg';
  if (worst(light) >= need) return light;
  return worst(dark) > worst(light) ? dark : light;
}

interface Glass {
  fill: Paint;
  opacity: number;
  stroke: Stroke;
  shadow: Shadow;
}

/**
 * The plate an overlay's words stand on: the palette's ground, so the
 * palette's ink reads on it over any footage; a hairline edge (light on a
 * dark plate, dark on a light one), a soft light across its top (`SHEEN`) and
 * a soft shadow lift it off the picture.
 *
 * Solid, not translucent, so the palette's ink reads on it over any footage.
 * (These plates were drawn when WKWebView painted a shadowed shape at full
 * opacity whatever its layer's; the renderer now honours it — `shadowOn` in
 * motiondraw.ts — but they stay as designed: only plates that arrive by a wipe
 * carry the shadow, and shapes that fade in or out do without one, or pop from
 * nothing so that they need no fade.)
 */
function glassOf(c: Kit): Glass {
  const dark = luminance(c.palette.bg) < 0.4;
  return {
    fill: 'bg',
    opacity: 1,
    stroke: { color: dark ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.12)', width: 0.14, cap: 'round' },
    shadow: { color: 'rgba(0,0,0,.35)', blur: 3, x: 0, y: 1 },
  };
}

/** The soft light across the top of a glass plate. */
const SHEEN: Paint = {
  kind: 'linear', angle: 90,
  stops: [{ at: 0, color: 'rgba(255,255,255,.10)' }, { at: 0.55, color: 'rgba(255,255,255,0)' }],
};

/** An accent run from the second accent into the first: the family's gradient on bars and badges. */
const ACCENTS = (angle: number): Paint => ({ kind: 'linear', angle, stops: [{ at: 0, color: 'accent2' }, { at: 1, color: 'accent' }] });

/** The frame's safe margin: content keeps this far in from every edge. */
const marginOf = (c: Kit) => (c.landscape ? 8 : 6);

/**
 * How much of its natural timing a recipe keeps: 1 at the length it was
 * designed for or longer, less when the graphic is shorter, so the whole
 * choreography still fits.
 */
function paceOf(c: Kit): number {
  return clamp(c.seconds / META[c.recipe].seconds, 0.05, 1);
}

/** Digits as the language writes them: Arabic-Indic for Arabic and both Kurdish languages, as the counters do. */
function localDigits(c: Kit, s: string): string {
  return digitsFor(c.lang) === 'arab' ? toArabicDigits(s) : s;
}

/**
 * The timing of a ring that bursts: a moment to appear (a small pop), then the
 * exit carries it outward as it fades — `zoom` played out grows while it
 * fades — so one ring does both without its entrance and exit overlapping.
 * Neither part is shorter than the reader allows (0.05 s), and it is over by
 * `last`.
 */
function burst(c: Kit, t0: number, o: { grow: number; d: number; from?: number; appear?: number; last?: number }) {
  const appear = Math.max(0.05, o.appear ?? 0.1);
  const d = Math.max(0.05, Math.min(o.d, (o.last ?? c.seconds) - t0 - appear));
  return {
    start: t0, end: t0 + appear + d,
    in: c.enter('pop', { ease: 'out', amount: o.from ?? 0.4, d: appear }),
    out: c.leave('zoom', { amount: o.grow, d }),
  };
}

/**
 * One sweep of light across a shape — a copy of its outline with nothing in it
 * but the `shimmer` highlight, on for exactly one cycle so the band crosses
 * once — that has crossed by the graphic's still.
 *
 * The gallery's card and a graphic's cover are drawn at `stillTime`
 * (motionanim.ts), a moment after the last layer has arrived. A sweep has no
 * entrance, so one that started after the words had landed was itself the
 * last arrival, and the cover caught it a third of the way across the glass,
 * where it read as a smudge (with a long hold, the last of the repeated
 * sweeps did the same, later). So there is one sweep, while the piece lands,
 * and it is over by the still, which is worked out with that same function
 * from `others`, the layers without it. It cannot move that still: it starts
 * no later than they settle, and it has no exit.
 *
 * It wants to start at `at` and take `d`. When that would still be crossing
 * at the still, it starts earlier, though not before `earliest` (when the
 * shape it lights has landed), and is cut short at the still. With `ride` — the
 * entrance of a shape that moves as it arrives — it starts with that shape at
 * `earliest`, on the same entrance, so the light moves with what it lights,
 * and takes until the still to cross. Under 0.4 s (or under the entrance it
 * rides) is no sweep at all.
 */
function sweep(c: Kit, others: readonly Layer[], box: Record<string, unknown>, o: { at: number; d: number; earliest: number; opacity: number; ride?: Anim }): Layer[] {
  const by = stillTime(others, c.seconds) - 0.05;
  const start = o.ride ? o.earliest : Math.min(o.at, Math.max(o.earliest, by - o.d));
  const end = o.ride ? by : Math.min(start + o.d, by);
  // Never shorter than the entrance it rides: cut short, the entrance would no longer keep step with the shape's.
  if (!(end - start >= Math.max(0.4, o.ride ? o.ride.delay + o.ride.d : 0))) return [];
  return [c.shape('shine', {
    ...box, name: 'Shine', fill: '#ffffff00', opacity: o.opacity, start, end, loop: c.loop('shimmer', { d: end - start }),
    ...(o.ride ? { in: o.ride } : {}),
  })];
}

// ── lower third ───────────────────────────────────────────────────────────

/**
 * Lower third. An accent bar grows up at the bottom-start corner; a glass
 * plate wipes out of it toward the end, and as it opens the name masks up
 * inside it and the role slides in underneath, each starting while the one
 * before is still landing. As the plate settles a soft band of light crosses
 * the glass, behind the words arriving, and is gone by the time all is still
 * (`sweep`). It leaves the way it came — the words drop away, the
 * plate wipes back into the bar, the bar sinks — ending on the last frame.
 *
 * The corner is logical, so in Arabic and Kurdish the bar is on the right and
 * the plate opens leftward. The plate is as wide as the longer line, so a
 * short name gets a short plate; a long one is fitted to the widest plate the
 * frame allows rather than let past the glass. In portrait it sits higher,
 * clear of a phone's captions and buttons, and narrower.
 */
function lowerThird(c: Kit): Layer[] {
  const f = paceOf(c);
  const S = c.seconds;
  const at = (s: number) => s * f;
  const until = (s: number) => S - s * f;
  const g = glassOf(c);
  const m = marginOf(c);
  const k = c.portrait ? { name: 5.6, role: 3.4, bottom: 30, most: 76 }
    : c.landscape ? { name: 5, role: 3, bottom: 12, most: 84 }
      : { name: 5.3, role: 3.2, bottom: c.feed ? 14 : 11, most: 80 };
  const name = c.fields.name ?? '';
  const role = c.fields.role ?? '';
  const nameM: Measure = { voice: 'sans', weight: 700 };
  const roleM: Measure = { voice: 'sans', weight: 500 };

  const barW = 0.9;
  const plateX = m + barW + 0.55;
  const padS = k.name * 0.72;
  const padE = k.name * 0.86;
  const padV = k.name * 0.42;
  const nameLead = 1.1;
  const roleLead = 1.25;
  const nameH = name || !role ? k.name * nameLead : 0;
  const roleH = role ? k.role * roleLead : 0;
  const gapV = nameH && roleH ? k.role * 0.22 : 0;
  const H = 2 * padV + nameH + gapV + roleH;
  const most = Math.min(k.most, c.u.w - m - plateX);
  const plateW = clamp(Math.max(widthOf(name, k.name, nameM), widthOf(role, k.role, roleM)) + padS + padE, k.name * 5, most);
  const inner = plateW - padS - padE;

  // Heights are measured up from the frame's bottom edge; a layer pinned middle-start is placed by its centre.
  const y = (up: number) => c.u.h / 2 - up;
  const plateMid = k.bottom + H / 2;
  const roleMid = k.bottom + padV + roleH / 2;
  const nameMid = k.bottom + padV + roleH + gapV + nameH / 2;
  const plateBox = { pin: 'ms' as const, x: plateX, y: y(plateMid), w: plateW, h: H, radius: Math.min(1.1, H / 2) };
  const plateIn = c.enter('wipe', { dir: 'start', d: 0.7 * f });
  const plateOut = c.leave('wipe', { dir: 'start', d: 0.45 * f });

  const layers: Layer[] = [
    c.shape('bar', {
      name: 'Accent bar', pin: 'ms', x: m, y: y(plateMid), w: barW, h: H, radius: barW / 2, fill: ACCENTS(90),
      in: c.enter('grow', { dir: 'up', d: 0.5 * f }), out: c.leave('grow', { dir: 'up', d: 0.35 * f }),
    }),
    c.shape('plate', {
      name: 'Plate', ...plateBox, fill: g.fill, opacity: g.opacity, stroke: g.stroke, shadow: g.shadow,
      start: at(0.2), end: until(0.12), in: plateIn, out: plateOut,
    }),
    c.shape('sheen', { name: 'Glass', ...plateBox, fill: SHEEN, start: at(0.2), end: until(0.12), in: plateIn, out: plateOut }),
  ];
  if (nameH && name) {
    layers.push(c.text('name', {
      name: 'Name', text: name, pin: 'ms', x: plateX + padS, y: y(nameMid), size: k.name, weight: 700, voice: 'sans',
      color: 'fg', align: 'start', lead: nameLead, max: roomy(inner, padE), fit: true, start: at(0.45), end: until(0.38),
      in: c.enter('mask', { by: 'line', d: 0.7 * f }), out: c.leave('mask', { by: 'line', d: 0.36 * f }),
    }));
  }
  if (role) {
    layers.push(c.text('role', {
      name: 'Role', text: role, pin: 'ms', x: plateX + padS, y: y(roleMid), size: k.role, weight: 500, voice: 'sans',
      color: 'muted', align: 'start', lead: roleLead, max: roomy(inner, padE), fit: true, start: at(0.62), end: until(0.42),
      in: c.enter('slide', { dir: 'start', amount: 0.3, d: 0.7 * f }), out: c.leave('slide', { dir: 'start', amount: 0.3, d: 0.36 * f }),
    }));
  }
  // Over the glass, under the words: from when the plate has all but opened (its wipe is nine tenths there) to the still.
  layers.splice(3, 0, ...sweep(c, layers, plateBox, { at: at(1.5), d: 1.1 * f, earliest: at(0.2) + 0.55 * f, opacity: 0.2 }));
  return layers;
}

// ── subscribe ─────────────────────────────────────────────────────────────

/**
 * A bell in a 100 × 100 box, hung from the box's centre: the body fills the
 * lower half, so turning the layer about its centre swings the bell from its
 * top, the way a bell rings.
 */
const BELL = 'M50 53.5C39.5 53.5 33 61 33 71L33 81.5L28 88.5L72 88.5L67 81.5L67 71C67 61 60.5 53.5 50 53.5Z'
  + 'M46.5 54C46.5 49.6 53.5 49.6 53.5 54Z'
  + 'M44 91.5C44 96.5 56 96.5 56 91.5Z';

/** The pointer every desktop draws, its tip at (20, 6) of a 100 × 100 box. */
const CURSOR = 'M20 6L20 82L38.5 65.5L50.5 93.5L63.5 88L51.5 60.5L76 60.5Z';

/** A plain check mark, drawn as one stroke from its short arm (the icon set's check sits in a circle). */
const CHECK = 'M14 54L39 78L86 26';

/**
 * Subscribe. The button pops up with its bell button beside it; a pointer
 * glides in from the end side and clicks: the button dips and springs back, a
 * ripple spreads from the click and a halo from the button's edge, the label
 * cross-fades to the one after the click as a check draws itself beside it,
 * and the bell rings — swinging from its top for a second — throwing a few
 * stars. The pointer drifts away and the subscribed button holds until
 * everything shrinks away at the end.
 *
 * The press is two layers, the button before the click and after it: the
 * second starts smaller and springs up, and the first stays for the instant
 * the second takes to be solid, so the button never blinks. The button and
 * the bell button pop from nothing rather than from half size, so they need
 * no fade to arrive or leave (see `glassOf`). The
 * pointer is drawn as every desktop draws it, pointing up and to the left in
 * every language; only the side it comes from turns with the direction.
 */
function subscribe(c: Kit): Layer[] {
  const f = paceOf(c);
  const S = c.seconds;
  const at = (s: number) => s * f;
  const until = (s: number) => S - s * f;
  const g = glassOf(c);
  const size = c.landscape ? 4 : 4.3;
  const pillH = size * 2.55;
  const padH = size * 1.25;
  const checkS = size * 0.95;
  const checkGap = size * 0.3;
  const gap = size * 0.5;
  const bottom = c.portrait ? 36 : c.landscape ? 14 : c.feed ? 18 : 13;
  const label = c.fields.label ?? '';
  const done = c.fields.done ?? '';
  const words: Measure = { voice: 'round', weight: 700 };
  const labelW = widthOf(label, size, words);
  const doneW = widthOf(done, size, words);
  const most = Math.min(64, c.u.w - 2 * marginOf(c) - pillH - gap);
  const pillW = clamp(Math.max(labelW, doneW + checkS + checkGap) + 2 * padH, pillH * 2.3, most);
  const inner = pillW - 2 * padH;
  const groupW = pillW + gap + pillH;
  const pillX = -groupW / 2 + pillW / 2;
  const bellX = groupW / 2 - pillH / 2;
  const cy = c.u.h / 2 - bottom - pillH / 2;
  const ink = inkOn(c, 'accent');
  const tClick = at(1.55);
  const pressD = 0.4 * f;

  const pill = {
    shape: 'rect' as const, pin: 'mc' as const, x: pillX, y: cy, w: pillW, h: pillH, radius: pillH / 2, fill: 'accent',
    stroke: { color: 'rgba(255,255,255,.22)', width: 0.14, cap: 'round' as const }, shadow: { color: 'rgba(0,0,0,.32)', blur: 2.6, x: 0, y: 0.9 },
  };
  // After the click: the done words and the check, centred together on the button.
  const doneRoom = inner - checkS - checkGap;
  const doneBox = Math.min(doneW, doneRoom);
  const group = checkS + checkGap + doneBox;
  const groupStart = pillX - group / 2;
  const doneAt = groupStart + checkS + checkGap;
  const doneMax = roomy(doneBox, padH);

  const cursorBox = size * 1.9;
  // The tip lands low on the button, beside the words, so the pointer hangs below the label rather than over it.
  const tipX = pillX + pillW * 0.27;
  const tipY = cy + pillH * 0.24;
  // The pointer is not mirrored, so its box sits to the physical right of its tip in both directions.
  const cursorX = tipX + (c.rtl ? -1 : 1) * cursorBox * 0.3;
  const cursorY = tipY + cursorBox * 0.44;
  const cursor = {
    shape: 'path' as const, d: CURSOR, pin: 'mc' as const, x: cursorX, y: cursorY, w: cursorBox, h: cursorBox, fill: '#ffffff',
    stroke: { color: 'rgba(0,0,0,.85)', width: 0.24, cap: 'round' as const },
  };
  const popIn = (d: number) => c.enter('pop', { ease: E.pop, amount: 2, d });
  const popOut = (d: number) => c.leave('pop', { amount: 2, d });

  const bellBox = pillH * 1.1;
  const bell = { shape: 'path' as const, d: BELL, pin: 'mc' as const, x: bellX, y: cy - bellBox * 0.22, w: bellBox, h: bellBox, fill: 'fg' };
  // The bell rings for whole half-swings, so it comes to rest exactly upright.
  const ringD = Math.min(1, Math.floor(Math.max(0, until(0.5) - tClick - at(0.1)) / 0.2) * 0.2);
  const rung = tClick + ringD;

  const layers: Layer[] = [
    c.shape('bell-disc', {
      name: 'Bell button', shape: 'ellipse', pin: 'mc', x: bellX, y: cy, w: pillH, h: pillH, fill: g.fill, opacity: g.opacity,
      stroke: g.stroke, shadow: g.shadow, start: at(0.12), end: S, in: popIn(0.55 * f), out: popOut(0.42 * f),
    }),
    c.shape('bell', {
      ...bell, name: 'Bell', start: at(0.22), end: tClick, in: c.enter('pop', { ease: E.pop, d: 0.45 * f }),
    }),
  ];
  if (ringD > 0) layers.push(c.shape('bell-ring', { ...bell, name: 'Bell ringing', start: tClick, end: rung, loop: c.loop('sway', { d: 0.4, amount: 3 }) }));
  layers.push(
    c.shape('bell-rest', { ...bell, name: 'Bell at rest', start: rung, end: until(0.06), out: popOut(0.36 * f) }),
    c.shape('button', { ...pill, name: 'Button', start: 0, end: tClick + 0.1 * pressD, in: popIn(0.6 * f) }),
    c.shape('button-pressed', {
      ...pill, name: 'Button pressed', start: tClick, end: S, in: c.enter('pop', { ease: E.pop, amount: 0.25, d: pressD }), out: popOut(0.42 * f),
    }),
    c.shape('halo', {
      name: 'Button halo', shape: 'rect', pin: 'mc', x: pillX, y: cy, w: pillW, h: pillH, radius: pillH / 2, fill: null,
      stroke: { color: 'accent', width: 0.45, cap: 'round' }, ...burst(c, tClick, { from: 0.15, appear: at(0.08), grow: 0.55, d: at(0.67) }),
    }),
    c.text('label', {
      name: 'Label', text: label, pin: 'mc', x: pillX, y: cy, size, weight: 700, voice: 'round', color: ink, align: 'center',
      lead: 1.1, max: roomy(inner, padH), fit: true, start: at(0.16), end: tClick + at(0.16),
      in: c.enter('rise', { amount: 0.35, d: 0.55 * f }), out: c.leave('fade', { d: at(0.14) }),
    }),
    c.shape('check', {
      name: 'Check', shape: 'path', d: CHECK, pin: 'mc', x: groupStart + checkS / 2, y: cy, w: checkS, h: checkS, fill: null,
      stroke: { color: ink, width: size * 0.16, cap: 'round' }, start: tClick + at(0.1), end: until(0.06),
      in: c.enter('draw', { d: 0.4 * f }), out: popOut(0.34 * f),
    }),
    c.text('done', {
      name: 'Label after the click', text: done, pin: 'mc', x: doneAt + doneMax / 2, y: cy, size, weight: 700,
      voice: 'round', color: ink, align: 'start', lead: 1.1, max: doneMax, fit: true, start: tClick + at(0.05), end: until(0.06),
      in: c.enter('pop', { ease: E.pop, amount: 0.45, d: 0.45 * f }), out: popOut(0.34 * f),
    }),
    c.shape('ripple', {
      name: 'Click ripple', shape: 'ellipse', pin: 'mc', x: tipX, y: tipY, w: pillH * 0.9, h: pillH * 0.9, fill: null,
      stroke: { color: 'rgba(255,255,255,.9)', width: 0.35, cap: 'round' }, ...burst(c, tClick, { from: 0.9, appear: at(0.1), grow: 3, d: at(0.6) }),
    }),
    c.particles('stars', {
      name: 'Stars', style: 'stars', pin: 'mc', x: bellX, y: cy - pillH * 0.1, colors: ['accent', 'accent2'], count: 14, size: 1.4,
      spread: 2.2, speed: 1, burst: true, start: tClick + at(0.05), end: Math.min(S, tClick + at(0.05) + 2.4),
    }),
    c.shape('cursor', {
      ...cursor, name: 'Pointer', start: at(0.45), end: tClick + 0.1 * pressD,
      in: c.enter('slide', { dir: 'end', amount: 2.2, d: 0.95 * f }),
    }),
    c.shape('cursor-click', {
      ...cursor, name: 'Pointer clicking', start: tClick, end: Math.min(until(0.5), tClick + at(1.35)),
      in: c.enter('pop', { ease: E.pop, amount: 0.3, d: pressD }), out: c.leave('slide', { dir: 'end', amount: 0.9, d: at(0.5) }),
    }),
  );
  return layers;
}

// ── callout ───────────────────────────────────────────────────────────────

/**
 * Callout. A ring draws itself round a point and a numbered badge pops in its
 * middle; a leader line draws out of the ring — up at 45° and then level — and
 * a glass label plate wipes open from its end, the words masking up inside.
 * While it holds, the ring breathes and a fainter ring spreads from it and
 * fades, like sonar, every second and a half. It leaves in reverse: the words
 * drop, the plate wipes back into the line, the line draws back into the ring,
 * and the ring and badge go last.
 *
 * The line is a path, and a path is not mirrored, so right to left gets its
 * mirror image: the point sits right of centre and the label opens leftward.
 * A long label breaks into two even lines rather than shrinking to nothing.
 */
function callout(c: Kit): Layer[] {
  const f = paceOf(c);
  const S = c.seconds;
  const at = (s: number) => s * f;
  const until = (s: number) => S - s * f;
  const g = glassOf(c);
  const m = marginOf(c);
  const P = c.portrait ? { x: -24, y: 18 } : c.landscape ? { x: -36, y: 10 } : { x: -26, y: c.feed ? 12 : 10 };
  const D = c.landscape ? 11 : 10.5;
  const size = c.portrait ? 4.4 : c.landscape ? 4.6 : 4.3;
  const words: Measure = { voice: 'sans', weight: 700 };
  const badge = D * 0.62;
  const diag = c.landscape ? 7.5 : 6.5;
  const level = c.landscape ? 9 : 6;
  const r = D / 2 + 0.9;
  const s0 = { x: P.x + r * Math.SQRT1_2, y: P.y - r * Math.SQRT1_2 };
  const end = { x: s0.x + diag + level, y: s0.y - diag };
  const padH = size * 0.85;
  const padV = size * 0.62;
  const lead = 1.18;
  const most = Math.min(c.landscape ? 78 : 66, c.u.w / 2 - m - end.x);
  const text = twoLines(c.fields.label ?? '', size, words, most - 2 * padH);
  const lines = text.split('\n').length;
  const plateW = clamp(widthOf(text, size, words) + 2 * padH, size * 5, most);
  const inner = plateW - 2 * padH;
  const H = 2 * padV + lines * size * lead;
  const plateBox = { pin: 'mc' as const, x: end.x + plateW / 2, y: end.y, w: plateW, h: H, radius: Math.min(1.1, H / 2) };
  const plateIn = c.enter('wipe', { dir: 'start', d: 0.55 * f });
  const plateOut = c.leave('wipe', { dir: 'start', d: 0.4 * f });
  const lineW = diag + level;
  const knee = Math.round((diag / lineW) * 10000) / 100;
  const leader = c.rtl ? `M100 100L${100 - knee} 0L0 0` : `M0 100L${knee} 0L100 0`;
  const fill: Paint = ACCENTS(45);
  const ink = inkOn(c, fill);

  const layers: Layer[] = [];
  // Sonar: a faint ring that spreads from the marker and fades, while the callout holds.
  for (let i = 0, t0 = at(0.6); i < 12 && t0 + at(1.1) <= until(0.75); i++, t0 += 1.6) {
    layers.push(c.shape(i ? `sonar-${i + 1}` : 'sonar', {
      name: `Sonar ring ${i + 1}`, shape: 'ellipse', pin: 'mc', x: P.x, y: P.y, w: D, h: D, fill: null,
      stroke: { color: 'accent', width: 0.32, cap: 'round' }, ...burst(c, t0, { from: 0.3, appear: at(0.1), grow: 3, d: at(1) }),
    }));
  }
  layers.push(
    c.shape('ring', {
      name: 'Marker ring', shape: 'ellipse', pin: 'mc', x: P.x, y: P.y, w: D, h: D, fill: 'rgba(0,0,0,.18)',
      stroke: { color: 'accent', width: 0.5, cap: 'round' }, end: until(0),
      in: c.enter('draw', { d: 0.6 * f }), out: c.leave('draw', { d: 0.36 * f }), loop: c.loop('pulse', { d: 1.6, amount: 1.3 }),
    }),
    c.shape('badge', {
      name: 'Badge', shape: 'ellipse', pin: 'mc', x: P.x, y: P.y, w: badge, h: badge, fill,
      start: at(0.12), end: until(0.02), in: c.enter('pop', { ease: E.pop, d: 0.5 * f }), out: c.leave('pop', { d: 0.36 * f }),
    }),
    c.text('number', {
      name: 'Number', text: localDigits(c, c.fields.number ?? ''), pin: 'mc', x: P.x, y: P.y, size: badge * 0.52, weight: 800,
      voice: 'sans', color: ink, align: 'center', lead: 1, max: badge * 0.86, fit: true, start: at(0.2), end: until(0.02),
      in: c.enter('pop', { ease: E.pop, d: 0.45 * f }), out: c.leave('pop', { d: 0.36 * f }),
    }),
    c.shape('leader', {
      name: 'Leader line', shape: 'path', d: leader, pin: 'mc', x: s0.x + lineW / 2, y: s0.y - diag / 2, w: lineW, h: diag,
      fill: null, stroke: { color: 'accent', width: 0.4, cap: 'round' }, start: at(0.38), end: until(0.04),
      in: c.enter('draw', { d: 0.5 * f, ease: 'cubic-out' }), out: c.leave('draw', { d: 0.34 * f }),
    }),
    c.shape('plate', {
      name: 'Label plate', ...plateBox, fill: g.fill, opacity: g.opacity, stroke: g.stroke, shadow: g.shadow,
      start: at(0.78), end: until(0.3), in: plateIn, out: plateOut,
    }),
    c.shape('sheen', { name: 'Glass', ...plateBox, fill: SHEEN, start: at(0.78), end: until(0.3), in: plateIn, out: plateOut }),
    c.text('label', {
      name: 'Label', text, pin: 'mc', x: end.x + padH + roomy(inner, padH) / 2, y: end.y, size, weight: 700, voice: 'sans', color: 'fg',
      align: 'start', lead, max: roomy(inner, padH), fit: true, start: at(0.92), end: until(0.52),
      in: c.enter('mask', { by: 'line', gap: 0.08, d: 0.65 * f }), out: c.leave('mask', { by: 'line', gap: 0.05, d: 0.32 * f }),
    }),
  );
  return layers;
}

// ── social handle ─────────────────────────────────────────────────────────

/**
 * Social handle. A glass pill springs in from the start side — overshooting
 * a hair and settling — holding a round accent badge with an `@`, the caption
 * in small capitals and the handle under it. Everything in it moves as one
 * piece, so nothing slips inside the pill. A band of light rides in with it
 * and has crossed it by the time it has settled (`sweep`); at the end it
 * slides back out the way it came.
 *
 * The caption sits inside the pill, not above it on the footage, so both lines
 * read over anything. With no caption the pill is shorter and holds the handle
 * alone. An `@` typed in front of the handle is dropped: the badge is the `@`.
 */
function handle(c: Kit): Layer[] {
  const f = paceOf(c);
  const S = c.seconds;
  const g = glassOf(c);
  const m = marginOf(c);
  const k = c.portrait ? { h: 12.4, size: 4, cap: 2.4, bottom: 30 }
    : c.landscape ? { h: 11, size: 3.6, cap: 2.2, bottom: 12 }
      : { h: 11.6, size: 3.8, cap: 2.3, bottom: c.feed ? 14 : 11 };
  const name = (c.fields.handle ?? '').replace(/^[@\uFF20]+/, '');
  const caption = c.fields.caption ?? '';
  const nameM: Measure = { voice: 'sans', weight: 700 };
  const capM: Measure = { voice: 'sans', weight: ARABIC_CHAR.test(caption) ? 600 : 700, caps: true, track: 0.14 };
  const H = caption ? k.h : k.h * 0.78;
  const inset = H * 0.12;
  const D = H - 2 * inset;
  const wordsAt = inset + D + H * 0.2;
  const padE = H * 0.5;
  const most = Math.min(c.landscape ? 84 : 86, c.u.w - 2 * m);
  const capSize = ARABIC_CHAR.test(caption) ? k.cap * 1.3 : k.cap;
  const pillW = clamp(wordsAt + Math.max(widthOf(name, k.size, nameM), widthOf(caption, capSize, capM)) + padE, H * 2.6, most);
  const inner = pillW - wordsAt - padE;
  const capLH = k.cap * 1.25;
  const nameLH = k.size * 1.12;
  const gapV = caption ? k.cap * 0.2 : 0;
  const block = (caption ? capLH + gapV : 0) + nameLH;
  const mid = k.bottom + H / 2;
  const y = (up: number) => c.u.h / 2 - up;
  const ink = inkOn(c, 'accent');
  const slideIn = c.enter('slide', { dir: 'start', amount: 1.5, d: 0.85 * f, ease: E.pop });
  const slideOut = c.leave('slide', { dir: 'start', amount: 1.5, d: 0.45 * f });
  const moving = { start: 0, end: S, in: slideIn, out: slideOut };
  const pillBox = { pin: 'ms' as const, x: m, y: y(mid), w: pillW, h: H, radius: H / 2 };

  const layers: Layer[] = [
    // No shadow: the pill fades as it slides, and a plate that fades is kept flat (see `glassOf`).
    c.shape('pill', { name: 'Pill', ...pillBox, ...moving, fill: g.fill, opacity: g.opacity, stroke: g.stroke }),
    c.shape('sheen', { name: 'Glass', ...pillBox, ...moving, fill: SHEEN }),
    c.shape('badge', {
      name: 'Badge', shape: 'ellipse', pin: 'ms', x: m + inset, y: y(mid), w: D, h: D, fill: 'accent', ...moving,
    }),
    // The `@` sits a little low in its line box in every face, so it is lifted to look centred in the badge.
    c.text('at', {
      name: 'At sign', text: '@', pin: 'ms', x: m + inset, y: y(mid) - D * 0.035, size: D * 0.54, weight: 700, voice: 'sans',
      color: ink, align: 'center', lead: 1, max: D, fit: true, ...moving,
    }),
    c.text('handle', {
      name: 'Handle', text: name, pin: 'ms', x: m + wordsAt, y: y(mid - block / 2 + nameLH / 2), size: k.size, weight: 700,
      voice: 'sans', color: 'fg', align: 'start', lead: 1.12, max: roomy(inner, padE), fit: true, ...moving,
    }),
  ];
  if (caption) {
    // Arabic script has no capitals to carry a small size, so its caption is set larger and a little lighter.
    const arabic = ARABIC_CHAR.test(caption);
    layers.push(c.text('caption', {
      name: 'Caption', text: caption, pin: 'ms', x: m + wordsAt, y: y(mid + block / 2 - capLH / 2), size: arabic ? k.cap * 1.3 : k.cap,
      weight: arabic ? 600 : 700, voice: 'sans', color: 'muted', align: 'start', lead: arabic ? 1 : 1.25, caps: true, track: 0.14,
      max: roomy(inner, padE), fit: true, ...moving,
    }));
  }
  // On the pill's own slide, so the light moves with the glass it lights, over the glass and under the badge.
  layers.splice(2, 0, ...sweep(c, layers, pillBox, { at: 0, d: 1 * f, earliest: 0, opacity: 0.24, ride: slideIn }));
  return layers;
}

// ── logo reveal ───────────────────────────────────────────────────────────

/** A badge's letters: what the person gave, or the first letter of the name; two at most, one in Arabic script, whose letters would join. */
function markOf(mark: string, name: string): string {
  const src = (mark || name).replace(/\s+/g, '');
  const chars = Array.from(src);
  const arabic = ARABIC_CHAR.test(src);
  const out = chars.slice(0, arabic || !mark ? 1 : 2).join('');
  return arabic ? out : out.toUpperCase();
}

/**
 * Logo reveal. Over a slow aurora, a soft glow blooms and the badge — a
 * squircle in the accent gradient holding the letters, huge and heavy — pops
 * up and overshoots; as it lands three rings burst outward and fade, sparks
 * fly, and a diagonal light sweeps the badge once. Then the name masks up
 * beside it and the tagline rises in, quieter. The lockup holds with the glow
 * breathing, and leaves: words first, then the badge winds up and shrinks.
 *
 * The lockup is centred as a whole — badge at the start side with the words
 * beside it in landscape, stacked in the taller shapes — measured from the
 * words, so a short name does not leave the badge off to one side.
 */
function logoReveal(c: Kit): Layer[] {
  const f = paceOf(c);
  const S = c.seconds;
  const at = (s: number) => s * f;
  const until = (s: number) => S - s * f;
  const m = marginOf(c);
  const name = c.fields.name ?? '';
  const tagline = c.fields.tagline ?? '';
  const mark = markOf(c.fields.mark ?? '', name);
  const side = c.landscape;
  const B = c.portrait ? 34 : side ? 30 : 30;
  const nameSize = c.portrait ? 10.5 : side ? 11 : 10;
  const tagSize = c.portrait ? 4.4 : side ? 4.6 : 4.2;
  const nameM: Measure = { voice: 'bold', weight: 800 };
  const tagM: Measure = { voice: 'sans', weight: 500 };
  const gap = side ? B * 0.22 : B * 0.2;
  const room = side ? c.u.w - 2 * m - B - gap : c.u.w - 2 * m;
  const nameText = twoLines(name, nameSize, nameM, room);
  const tagText = twoLines(tagline, tagSize, tagM, room);
  const nameLead = 1.04;
  const tagLead = 1.3;
  const nameH = nameText.split('\n').length * nameSize * nameLead;
  const tagH = tagText ? tagText.split('\n').length * tagSize * tagLead : 0;
  const tagGap = tagText ? tagSize * 0.55 : 0;
  const nameW = Math.min(room, widthOf(nameText, nameSize, nameM));
  const tagW = Math.min(room, widthOf(tagText, tagSize, tagM));
  const wordsW = Math.max(nameW, tagW);

  let badge: { x: number; y: number };
  let nameBox: { x: number; y: number; w: number };
  let tagBox: { x: number; y: number; w: number };
  const align = side ? 'start' as const : 'center' as const;
  if (side) {
    const total = B + gap + wordsW;
    const x0 = -total / 2;
    const block = nameH + tagGap + tagH;
    badge = { x: x0 + B / 2, y: 0 };
    nameBox = { x: x0 + B + gap + wordsW / 2, y: -block / 2 + nameH / 2, w: wordsW };
    tagBox = { x: nameBox.x, y: block / 2 - tagH / 2, w: wordsW };
  } else {
    const gapBN = B * 0.24;
    const stack = B + gapBN + nameH + tagGap + tagH;
    const top = -stack / 2;
    badge = { x: 0, y: top + B / 2 };
    nameBox = { x: 0, y: top + B + gapBN + nameH / 2, w: room };
    tagBox = { x: 0, y: top + B + gapBN + nameH + tagGap + tagH / 2, w: room };
  }

  const fill = ACCENTS(45);
  const ink = inkOn(c, fill);
  const badgeBox = { pin: 'mc' as const, x: badge.x, y: badge.y, w: B, h: B, radius: B * 0.27 };
  // From nothing, not from half size: the badge has a shadow, and a shadowed shape is not faded here (see `glassOf`).
  const popIn = c.enter('pop', { ease: E.pop, amount: 2, d: 0.7 * f });
  const popOut = c.leave('pop', { amount: 2, d: 0.45 * f });
  const landed = at(0.62);

  const layers: Layer[] = [
    c.backdrop('backdrop', { name: 'Aurora', style: 'aurora', colors: ['accent', 'accent2'], speed: 1, density: 0.4, opacity: 0.6, in: c.enter('fade', { d: 0.8 * f }) }),
    c.shape('glow', {
      name: 'Glow', shape: 'ellipse', pin: 'mc', x: badge.x, y: badge.y, w: B * 3, h: B * 3, blend: 'screen', opacity: 0.75,
      fill: { kind: 'radial', angle: 0, stops: [{ at: 0, color: 'accent' }, { at: 0.66, color: '#00000000' }] },
      start: at(0.2), end: until(0), in: c.enter('fade', { d: 0.9 * f }), out: c.leave('fade', { d: 0.5 * f }),
      loop: c.loop('pulse', { d: 3, amount: 2 }),
    }),
  ];
  for (let i = 0; i < 3; i++) {
    const t0 = landed + at(0.09 * i);
    layers.push(c.shape(`ring-${i + 1}`, {
      name: `Burst ring ${i + 1}`, shape: 'ellipse', pin: 'mc', x: badge.x, y: badge.y, w: B * 1.18, h: B * 1.18, fill: null,
      stroke: { color: i === 1 ? 'accent' : i === 2 ? 'fg' : 'accent2', width: 0.5 - 0.1 * i, cap: 'round' },
      ...burst(c, t0, { appear: at(0.1), grow: 2 + 0.8 * i, d: at(0.85 + 0.15 * i), last: until(0) }),
    }));
  }
  layers.push(
    c.particles('sparks', {
      name: 'Sparks', style: 'sparks', pin: 'mc', x: badge.x, y: badge.y, colors: ['accent2', 'accent', 'fg'], count: 46, size: 1.3,
      spread: B * 0.3, speed: 1, burst: true, start: landed - at(0.05), end: Math.min(S, landed + 1.6),
    }),
    c.shape('badge', {
      name: 'Badge', shape: 'rect', ...badgeBox, fill, shadow: { color: 'rgba(0,0,0,.4)', blur: 4, x: 0, y: 1.5 },
      start: at(0.15), end: until(0), in: popIn, out: popOut,
    }),
    c.shape('badge-light', {
      name: 'Badge light', shape: 'rect', ...badgeBox, start: at(0.15), end: until(0), in: popIn, out: popOut,
      fill: { kind: 'linear', angle: 90, stops: [{ at: 0, color: 'rgba(255,255,255,.28)' }, { at: 0.5, color: 'rgba(255,255,255,0)' }] },
      stroke: { color: 'rgba(255,255,255,.22)', width: 0.22, cap: 'round' },
    }),
    c.text('mark', {
      name: 'Badge letters', text: mark, pin: 'mc', x: badge.x, y: badge.y - B * 0.01, size: B * (Array.from(mark).length > 1 ? 0.46 : 0.56),
      weight: 800, voice: 'bold', color: ink, align: 'center', lead: 1, max: B * 0.82, fit: true, start: at(0.23), end: until(0),
      in: c.enter('pop', { ease: E.pop, amount: 0.7, d: 0.6 * f }), out: popOut,
    }),
  );
  if (nameText) {
    layers.push(c.text('name', {
      name: 'Name', text: nameText, pin: 'mc', x: nameBox.x, y: nameBox.y, size: nameSize, weight: 800, voice: 'bold', color: 'fg',
      align, lead: nameLead, max: nameBox.w, fit: true, start: at(0.9), end: until(0.3),
      in: c.enter('mask', { by: 'line', gap: 0.09, d: 0.75 * f }), out: c.leave('mask', { by: 'line', gap: 0.05, d: 0.4 * f }),
    }));
  }
  if (tagText) {
    layers.push(c.text('tagline', {
      name: 'Tagline', text: tagText, pin: 'mc', x: tagBox.x, y: tagBox.y, size: tagSize, weight: 500, voice: 'sans', color: 'muted',
      align, lead: tagLead, max: tagBox.w, fit: true, start: at(1.2), end: until(0.35),
      in: c.enter('rise', { amount: 0.5, d: 0.8 * f }), out: c.leave('fade', { d: 0.35 * f }),
    }));
  }
  // Once, across the landed badge while the words come in, over its light and under its letters. (It used to come
  // back every four seconds of a long hold, and the cover then caught the last pass instead.)
  const light = layers.findIndex((l) => l.id === c.id('badge-light')) + 1;
  layers.splice(light, 0, ...sweep(c, layers, { shape: 'rect', ...badgeBox }, { at: at(1.0), d: 0.9 * f, earliest: at(0.15) + 0.7 * f, opacity: 0.75 }));
  return layers;
}

// ── countdown ─────────────────────────────────────────────────────────────

/** The count's start, whatever was typed: Arabic-Indic digits read as digits, 3 to 10, 3 when there is no number. */
function countFrom(s: string): number {
  const ascii = s.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
  const n = Number(ascii.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? clamp(Math.round(n), 3, 10) : 3;
}

/**
 * Countdown. Inside a ring of fine ticks, each number pops in huge at the
 * centre while an accent arc sweeps once round the ring in exactly its step;
 * as the arc closes the number shrinks away into the centre, the next pops
 * out of it, and a soft flash marks the change. After 1 comes the last word, bigger
 * and in the accent, with confetti thrown up from behind it and rings bursting
 * out; it holds for its step and blows away on the last frame.
 *
 * One step is `seconds / (from + 1)`: the numbers and the last word share the
 * length evenly, so the default (3 in four seconds) counts in true seconds and
 * any length still ends on the word. Numbers are written in the language's
 * digits.
 */
function countdown(c: Kit): Layer[] {
  const S = c.seconds;
  const from = countFrom(c.fields.from ?? '');
  const step = S / (from + 1);
  // What each change takes scales with the step, but only up to a second's worth: a slow count still pops.
  const beat = Math.min(step, 1);
  const R = c.landscape ? 60 : 66;
  const numSize = R * 0.62;
  const final = c.fields.final ?? '';
  const tEnd = from * step;
  const finalM: Measure = { voice: 'bold', weight: 900 };
  // The last word stays inside the ring it bursts from: two even lines if it is long, fitted to the ring's
  // width, and set smaller when it breaks so the pair is no taller than the ring holds.
  const room = R * 1.2;
  const finalText = twoLines(final, numSize * 0.8, finalM, room);
  const finalSize = numSize * (finalText.includes('\n') ? 0.6 : 0.8);
  const layers: Layer[] = [
    c.backdrop('backdrop', { name: 'Rays', style: 'rays', colors: ['accent', 'fg'], speed: 1, density: 0.5, opacity: 0.4 }),
    c.shape('ticks', {
      name: 'Tick ring', shape: 'ellipse', pin: 'mc', w: R + 8, h: R + 8, fill: null, opacity: 0.3,
      stroke: { color: 'fg', width: 1.6, cap: 'butt', dash: [0.24, 3.1] }, end: tEnd + beat * 0.3,
      in: c.enter('fade', { d: beat * 0.4 }), out: c.leave('fade', { d: beat * 0.3 }), loop: c.loop('spin', { d: 60, amount: 1 }),
    }),
    c.shape('track', {
      name: 'Ring', shape: 'ellipse', pin: 'mc', w: R, h: R, fill: 'rgba(255,255,255,.03)', opacity: 0.5,
      stroke: { color: 'muted', width: 1.3, cap: 'round' }, end: tEnd + beat * 0.3,
      in: c.enter('draw', { d: beat * 0.5 }), out: c.leave('fade', { d: beat * 0.3 }),
    }),
  ];
  for (let i = 0; i < from; i++) {
    const n = from - i;
    const t0 = i * step;
    if (i > 0) {
      layers.push(c.shape(`flash-${n}`, {
        name: `Flash ${n}`, shape: 'rect', pin: 'mc', w: c.u.w, h: c.u.h, start: t0, end: t0 + beat * 0.35, blend: 'screen',
        fill: { kind: 'radial', angle: 0, stops: [{ at: 0, color: 'rgba(255,255,255,.1)' }, { at: 0.6, color: 'rgba(255,255,255,0)' }] },
        out: c.leave('fade', { d: beat * 0.35, ease: 'out' }),
      }));
    }
    layers.push(
      c.shape(`sweep-${n}`, {
        name: `Sweep ${n}`, shape: 'arc', pin: 'mc', w: R, h: R, from: 0, sweep: 360, fill: null,
        stroke: { color: 'accent', width: 1.5, cap: 'round' }, shadow: { color: 'accent', blur: 2, x: 0, y: 0 }, start: t0, end: t0 + step,
        in: c.enter('draw', { d: step * 0.97, ease: 'soft' }),
      }),
      c.text(`n${n}`, {
        name: `Number ${n}`, text: localDigits(c, String(n)), pin: 'mc', y: numSize * 0.02, size: numSize, weight: 900, voice: 'bold',
        // It has all but gone when the next pops out of the same centre, so the two never blur into each other.
        color: 'fg', align: 'center', lead: 1, max: R * 0.9, fit: true, start: t0, end: Math.min(S, t0 + step + beat * 0.06),
        in: c.enter('pop', { ease: E.pop, amount: 1, d: beat * 0.42 }), out: c.leave('pop', { d: beat * 0.18 }),
      }),
    );
  }
  layers.push(
    c.shape('flash-final', {
      name: 'Flash, last word', shape: 'rect', pin: 'mc', w: c.u.w, h: c.u.h, start: tEnd, end: tEnd + beat * 0.5, blend: 'screen',
      fill: { kind: 'radial', angle: 0, stops: [{ at: 0, color: 'rgba(255,255,255,.22)' }, { at: 0.7, color: 'rgba(255,255,255,0)' }] },
      out: c.leave('fade', { d: beat * 0.5, ease: 'out' }),
    }),
    c.particles('confetti', {
      name: 'Confetti', style: 'confetti', pin: 'mc', y: 4, colors: ['accent', 'accent2', 'fg'], count: 150, size: 1.7, spread: 5,
      speed: 1, burst: true, start: tEnd, end: S,
    }),
  );
  for (let i = 0; i < 2; i++) {
    const t0 = tEnd + beat * 0.06 * i;
    layers.push(c.shape(`burst-${i + 1}`, {
      name: `Burst ring ${i + 1}`, shape: 'ellipse', pin: 'mc', w: R, h: R, fill: null, stroke: { color: i ? 'accent2' : 'accent', width: 1 - 0.4 * i, cap: 'round' },
      ...burst(c, t0, { from: 0.3, appear: beat * 0.08, grow: 2 + i, d: beat * 0.7 }),
    }));
  }
  layers.push(c.text('final', {
    name: 'Last word', text: finalText, pin: 'mc', size: finalSize, weight: 900, voice: 'bold', color: 'accent', align: 'center',
    lead: 1.02, max: room, fit: true, start: tEnd, end: S,
    in: c.enter('pop', { ease: E.pop, amount: 1.2, d: beat * 0.45 }), out: c.leave('zoom', { amount: 1.2, d: beat * 0.28 }),
  }));
  return layers;
}

// ── intro sting ───────────────────────────────────────────────────────────

/**
 * Intro sting. Three bands sweep across the frame on a slant, one after
 * another — a thin one, the wide accent band, a hairline — and the title snaps
 * onto the wide band, overshooting, with a flash and a spray of sparks; the
 * subtitle masks up under the bands. A light rides in with the wide band and
 * runs along it, gone by the time the words have settled (`sweep`). Then the
 * words go, and the bands sweep on off the far side, so the sting leaves in
 * the direction it arrived.
 *
 * The whole composition is turned 7° as one piece — every layer is placed
 * along the turned axis, not just turned where it stands — and right to left
 * turns it the other way, so the mirror is exact.
 *
 * A band leaves by collapsing toward its far end (`grow` toward the end), which
 * on a flat band looks exactly like wiping it away. A wipe out toward the end
 * would say the same, but a layer that wipes in from one side and out toward
 * the other reveals from the wrong side (motionanim applies the exit's edge
 * even before the exit has begun).
 */
function intro(c: Kit): Layer[] {
  const f = paceOf(c);
  const S = c.seconds;
  const at = (s: number) => s * f;
  const until = (s: number) => S - s * f;
  const m = marginOf(c);
  const deg = c.rtl ? 7 : -7;
  const th = (-7 * Math.PI) / 180;
  // A point `up` u along the composition's own vertical, as a logical offset from the centre.
  const along = (dy: number) => ({ x: -dy * Math.sin(th), y: dy * Math.cos(th) });
  const size = c.landscape ? 15 : c.portrait ? 13 : 13.5;
  const subSize = c.portrait ? 4.6 : 4.4;
  const titleM: Measure = { voice: 'bold', weight: 900 };
  const room = c.u.w - 2 * m - 4;
  const title = twoLines(c.fields.title ?? '', size, titleM, room);
  const lines = title.split('\n').length;
  const titleLead = 1.02;
  const bandH = lines * size * titleLead + size * 0.8;
  const long = Math.hypot(c.u.w, c.u.h) * 1.15;
  const fill: Paint = { kind: 'linear', angle: c.rtl ? 180 : 0, stops: [{ at: 0, color: 'accent' }, { at: 1, color: 'accent2' }] };
  const ink = inkOn(c, fill);
  const subRoom = room * 0.8;
  const subtitle = twoLines(c.fields.subtitle ?? '', subSize, { voice: 'sans', weight: 500 }, subRoom);
  const subLines = subtitle.split('\n').length;
  const band = (id: string, name: string, dy: number, h: number, paint: Paint, t0: number, t1: number) => {
    const p = along(dy);
    return c.shape(id, {
      name, pin: 'mc', x: p.x, y: p.y, w: long, h, rot: deg, fill: paint, start: at(t0), end: until(t1),
      in: c.enter('wipe', { dir: 'start', d: 0.55 * f }), out: c.leave('grow', { dir: 'end', d: 0.42 * f }),
    });
  };
  const top = -(bandH / 2 + 4.2);
  const low = bandH / 2 + 3;
  const mainBox = { pin: 'mc' as const, w: long, h: bandH, rot: deg };
  const sub = along(low + 3.4 + (subLines * subSize * 1.2) / 2);
  const titleAt = at(0.34);

  const layers: Layer[] = [
    c.backdrop('backdrop', { name: 'Aurora', style: 'aurora', colors: ['accent', 'accent2'], speed: 1, density: 0.45, opacity: 0.55 }),
    band('band-top', 'Band above', top, 2.6, 'accent2', 0, 0.1),
    band('band', 'Band', 0, bandH, fill, 0.07, 0.05),
    band('band-low', 'Band below', low, 1.1, 'fg', 0.14, 0),
    c.shape('flash', {
      name: 'Flash', shape: 'rect', pin: 'mc', w: c.u.w, h: c.u.h, start: titleAt, end: titleAt + at(0.35), blend: 'screen',
      fill: { kind: 'radial', angle: 0, stops: [{ at: 0, color: 'rgba(255,255,255,.22)' }, { at: 0.7, color: 'rgba(255,255,255,0)' }] },
      out: c.leave('fade', { d: at(0.35), ease: 'out' }),
    }),
    c.particles('sparks', {
      name: 'Sparks', style: 'sparks', pin: 'mc', colors: ['accent2', 'fg', 'accent'], count: 54, size: 1.4, spread: size * 1.4,
      speed: 1, burst: true, start: titleAt + at(0.06), end: Math.min(S, titleAt + at(0.06) + 1.6),
    }),
    c.text('title', {
      name: 'Title', text: title, pin: 'mc', rot: deg, size, weight: 900, voice: 'bold', color: ink, align: 'center', lead: titleLead,
      max: room, fit: true, start: titleAt, end: until(0.42),
      in: c.enter('pop', { ease: E.pop, amount: 1.25, d: 0.6 * f }), out: c.leave('zoom', { amount: 1, d: 0.36 * f }),
    }),
  ];
  if (subtitle) {
    layers.push(c.text('subtitle', {
      name: 'Subtitle', text: subtitle, pin: 'mc', x: sub.x, y: sub.y, rot: deg, size: subSize, weight: 500, voice: 'sans', color: 'fg',
      align: 'center', lead: 1.2, max: subRoom, fit: true, start: at(0.66), end: until(0.62),
      in: c.enter('mask', { by: 'line', gap: 0.08, d: 0.6 * f }), out: c.leave('mask', { by: 'line', gap: 0.05, d: 0.32 * f }),
    }));
  }
  // On the wide band's own wipe (`band` above), over the bands and under the flash and the words.
  const ride = c.enter('wipe', { dir: 'start', d: 0.55 * f });
  layers.splice(4, 0, ...sweep(c, layers, mainBox, { at: at(0.07), d: 0.9 * f, earliest: at(0.07), opacity: 0.4, ride }));
  return layers;
}

// ── the recipes ───────────────────────────────────────────────────────────

export const OVERLAY_RECIPES: Partial<Record<RecipeId, Recipe>> = {
  'lower-third': {
    build: lowerThird,
    sample: {
      en: { name: 'Lana Aziz', role: 'Senior Reporter, Erbil' },
      ar: { name: 'لانا عزيز', role: 'مراسلة أولى، أربيل' },
      ckb: { name: 'لانا عەزیز', role: 'پەیامنێری باڵا، هەولێر' },
      kmr: { name: 'لانا عەزیز', role: 'نووچەڤان، دهۆک' },
    },
  },
  subscribe: {
    build: subscribe,
    sample: {
      en: { label: 'Subscribe', done: 'Subscribed' },
      ar: { label: 'اشترك', done: 'تم الاشتراك' },
      ckb: { label: 'بەشداربە', done: 'بەشداربوویت' },
      kmr: { label: 'ببە ئابۆنە', done: 'ئابۆنە بووی' },
    },
  },
  callout: {
    build: callout,
    sample: {
      en: { label: 'Start here', number: '1' },
      ar: { label: 'ابدأ من هنا', number: '1' },
      ckb: { label: 'لێرەوە دەست پێبکە', number: '1' },
      kmr: { label: 'ژ ڤێرێ دەست پێ بکە', number: '1' },
    },
  },
  handle: {
    build: handle,
    sample: {
      en: { handle: 'lana.makes', caption: 'Follow us' },
      ar: { handle: 'lana.makes', caption: 'تابعونا' },
      ckb: { handle: 'lana.makes', caption: 'فۆڵۆومان بکەن' },
      kmr: { handle: 'lana.makes', caption: 'ل دویڤ مە بن' },
    },
  },
  'logo-reveal': {
    build: logoReveal,
    sample: {
      en: { name: 'Noor Studio', tagline: 'Stories worth telling', mark: 'NS' },
      ar: { name: 'استوديو نور', tagline: 'قصص تستحق أن تروى', mark: 'ن' },
      ckb: { name: 'ستۆدیۆی نوور', tagline: 'چیرۆکی شایەنی گێڕانەوە', mark: 'ن' },
      kmr: { name: 'ستۆدیۆیا نوور', tagline: 'چیرۆکێن هێژایی ڤەگێڕانێ', mark: 'ن' },
    },
  },
  countdown: {
    build: countdown,
    sample: {
      en: { from: '3', final: 'GO' },
      ar: { from: '3', final: 'انطلق' },
      ckb: { from: '3', final: 'دەست پێبکە' },
      kmr: { from: '3', final: 'دەست پێ بکە' },
    },
  },
  intro: {
    build: intro,
    sample: {
      en: { title: 'Big Ideas', subtitle: 'Episode 12, out now' },
      ar: { title: 'أفكار كبيرة', subtitle: 'الحلقة 12 متاحة الآن' },
      ckb: { title: 'بیرۆکەی گەورە', subtitle: 'ئەڵقەی 12، ئێستا بەردەستە' },
      kmr: { title: 'بیرۆکێن مەزن', subtitle: 'ئەلقەیا 12، نوکە بەردەستە' },
    },
  },
};
