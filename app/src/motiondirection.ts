/**
 * How a good motion graphic moves and sits: the numbers, and the rules a model
 * is given from them.
 *
 * The model already knows Motion's vocabulary and limits (motionai.ts); what it
 * was never told is the craft — that an exit is quicker than the entrance it
 * undoes, that nothing should move in the very first frame, that words need to
 * sit still long enough to be read, that a headline has to clear the edges of
 * the frame. Told those rules, the same sentence makes a better graphic, and
 * nobody sees a new control.
 *
 * ## One source of truth
 *
 * `DIRECTION` is the numbers. `directionPrompt` writes the rules from them, so
 * the prompt can never say a number the table does not hold. The quality check
 * (motioncheck.ts, package 01) and the templates (packages 07 and 08) import the
 * same table, so what the model is told, what the check measures and what a
 * template is built to are one set of numbers. **Its names are a contract**: a
 * key here may gain a sibling, but is not renamed or removed without changing
 * every importer; each one says what it is and in what unit.
 *
 * Units are Motion's own: seconds, and `u` (1% of the frame's short side), and
 * plain fractions for shares. Nothing here is in pixels.
 *
 * ## Where the numbers come from, and the choices made
 *
 * Most are from HyperFrames' skills (heygen-com/hyperframes, Apache-2.0):
 * `skills/hyperframes-creative/references/motion-principles.md` and
 * `typography.md`, `skills/motion-graphics`, `skills/embedded-captions/
 * references/caption-grouping.md` and `rail.md`; the safe areas are EBU R 95's.
 * Ideas and numbers, not code: nothing here is copied (docs/pro/credits/10.md).
 * Where the sources disagree a choice is made, and the reason is written
 * beside it (docs/pro/direction.md has the whole account):
 *
 * - **Decorations that breathe, or stillness?** `house-style.md` wants every
 *   decoration on a slow loop; `motion-principles.md` says stillness after
 *   motion is powerful and allows one ambient motion. Motion's backdrops already
 *   drift on their own, so the frame is alive without a loop: at most one
 *   `loop` in a graphic, and never on words being read.
 * - **How small may words be?** `typography.md` says 20 px body for full-screen
 *   viewing and 32 px in a feed; the frame presets set body as small as 0.85% of
 *   the width (16 px at 1920). Motion's frames are mostly watched on phones —
 *   Reels, Stories, feeds — so the feed numbers win: words 3u (32 px on a 1080
 *   short side), labels 2.2u (24 px), headlines 8u (90 px).
 * - **Type as a share of the width** (the digest's 1.5 / 4.6 / 7.3) is one
 *   preset's ramp (`code-editorial`), not a rule — others run from 0.83 to 1.56
 *   for body and 4.2 to 7.5 for headlines — and a share of the width makes a
 *   portrait headline half the size of a landscape one. Motion sizes in u
 *   precisely so a headline is the same fraction of the frame in every shape,
 *   so the minimums above are in u and no width ramp is kept.
 * - **How far in from the edges?** HyperFrames draws Premiere's guides, title
 *   80% and action 90% — numbers from the overscan of tube televisions. Nothing
 *   Motion makes is shown on one, and Motion's own templates keep their words 6
 *   to 8u in (motionrecipes-overlays.ts `marginOf`), which the 80% box would call
 *   wrong in nearly every template. The boxes here are EBU R 95's for HD: words
 *   inside 90%, anything that matters inside 93%. What does cover a frame today
 *   is a phone app's own buttons and caption over the bottom of a 9:16 video, so
 *   portrait keeps the bottom 17% clear (HyperFrames' caption band, the same
 *   share).
 * - **Two sans-serifs.** `typography.md` forbids pairing two; Motion's own
 *   templates set a `bold` headline over a `sans` line, which is one family's
 *   display cut over its text cut in effect. What the rule protects is contrast,
 *   and weight carries it: at most two voices, with weights far apart.
 * - **300 against 900.** For video `typography.md` wants the light side at 300;
 *   thin strokes are what H.264 blurs first, and the bundled Arabic face runs
 *   from 400 to 700 (motionfonts.ts), so a 300 would draw as 400 there anyway:
 *   the light side is 400.
 * - **Springs.** The sources give damping ratios (1 for no overshoot, 0.80-0.85
 *   for a phone-like settle, 0.6-0.7 only for playful). The vocabulary's own
 *   `spring` is damping 0.55 (motionmath.ts), which is in the playful band, so the
 *   model is told the curves by name: overshooting curves only when playful. The
 *   ratios stay here for a template that builds a curve of its own.
 */

import type { Lang } from './i18n';
import type { EaseName, Format } from './motiontypes';
import { FORMATS, LIMITS } from './motiontypes';

/** A range, low to high, in the unit its key says. */
type Span = readonly [number, number];

/**
 * The numbers. Read-only; each key's unit is in its comment. A test checks that
 * every number the prompt states is one of these (or made from them), so the
 * prompt cannot drift from the table.
 */
export const DIRECTION = {
  /** Seconds an entrance takes, by the weight of what arrives. A headline is `weighty`; a badge, an icon or a rule `standard`. */
  duration: {
    urgent: [0.15, 0.3] as Span,
    standard: [0.3, 0.5] as Span,
    weighty: [0.5, 0.8] as Span,
    cinematic: [0.8, 2] as Span,
  },
  /** An exit's length as a share of its entrance's: leaving is quicker than arriving. */
  exitRatio: 0.6,
  /**
   * Seconds into the graphic: nothing moves before `first[0]` (motion in the very
   * first frame reads as a jump cut), something moves by `first[1]`, and the main
   * element has begun to arrive by `hero`.
   */
  start: { first: [0.1, 0.3] as Span, hero: 0.5 },
  /** Seconds between one word, line or item and the next (`gap`), and the most one block's whole cascade may take. */
  stagger: { gap: [0.03, 0.12] as Span, total: 0.5 },
  /** Curves by role, in the vocabulary's words. Exits play backwards, so an `out` curve leaves slowly and then quickly. */
  ease: {
    enter: ['expo-out', 'snappy'] as readonly EaseName[],
    exit: 'out' as EaseName,
    /** Curves that pass their end and come back: for a playful graphic only, and on one element. */
    overshoot: ['back-out', 'spring', 'elastic-out', 'bounce-out'] as readonly EaseName[],
  },
  /** Damping ratios for a spring a template builds itself: no overshoot, a phone-like settle, playful. The vocabulary's `spring` is 0.55. */
  spring: { settle: 1, smooth: [0.8, 0.85] as Span, playful: [0.6, 0.7] as Span },
  /** Shares of the graphic's length: everything has entered by `build`, holds still, and exits only after `resolve`. */
  phases: { build: 0.3, resolve: 0.7 },
  /** The most `loop`s in one graphic. None on words being read. */
  loops: 1,
  /**
   * Shares of the frame. Words stay inside the `title` box (90%: 5% of the width
   * and of the height in from each edge); anything that matters inside the
   * `action` box. In portrait (9:16), where the apps' own buttons and captions
   * cover the bottom, nothing that matters in the bottom `portraitBottom`.
   */
  safe: { title: 0.9, action: 0.93, portraitBottom: 0.17 },
  /** The main element spans at least `hero` of the frame; the main words are at least `hierarchy` times the size of the smallest. */
  layout: { hero: 0.4, hierarchy: 3 },
  /**
   * Type, in u. `headline`, `text` and `label` are minimums; Arabic-script words
   * are drawn `arabic` times larger, because at the same size their body sits
   * lower and smaller than Latin capitals (motionrecipes-titles.ts `smallSize`).
   * At most `voices` voices; weights far apart: `heavy` for the main words,
   * `light` for the rest.
   */
  type: { headline: 8, text: 3, label: 2.2, arabic: 1.15, voices: 2, heavy: [800, 900] as Span, light: 400 },
  /** The accent tones mark this many elements: the one thing to look at. */
  accents: 1,
  /**
   * Reading. People read about `wordsPerSecond`; words on screen for 3 s must be
   * readable in 2, hence `margin`. A headline is `headlineWords` long: the old
   * prompt said 3 to 8, but "Grand opening" — its own example — is two, and the
   * templates' hints go lower still for a sting (intro: 1 to 4); 8 is the cap.
   */
  reading: { wordsPerSecond: 2.5, margin: 1.5, headlineWords: [2, 8] as Span },
  /**
   * Words that replace one another — a phrase, then the next (kinetic type now,
   * captions from speech later): at most `words` words and `seconds` each, at
   * least `minWords` and `minSeconds`, one on screen at a time. For captions
   * timed to speech: a new phrase at a pause of `pause` s, or a comma and
   * `commaPause` s; in `lead` s before its first word, out `gap` s before the
   * next or `linger` s after its last; at most `lines` lines of `lineChars`
   * characters, `size` of the frame's height; the word being said grows at most
   * `pop` times.
   */
  phrases: {
    words: 6, seconds: 2.5, minWords: 2, minSeconds: 0.5,
    pause: 0.5, commaPause: 0.25, lead: 0.08, gap: 0.05, linger: 0.6,
    lines: 2, lineChars: [32, 42] as Span, size: 0.045, pop: 1.1,
  },
} as const;

/** What the rules may be made concrete for. Each is null (or left out) where it is not known: the rule then says the general case. */
export interface DirectionOptions {
  /** The graphic's language: Arabic script takes the larger sizes. */
  lang?: Lang | null;
  /** The frame: the safe area is said in its u. */
  format?: Format | null;
  /** The graphic's length: the phases are said in its seconds. */
  seconds?: number | null;
}

/** One decimal: what u and seconds are said to. */
const one = (n: number) => Math.round(n * 10) / 10;
/** One decimal, rounded up: a minimum said a little high is still a minimum. */
const atLeast = (n: number) => Math.ceil(n * 10 - 1e-9) / 10;

const range = (s: Span) => `${s[0]}-${s[1]}`;
/** A share as a percentage. */
const pct = (n: number) => one(n * 100);

/** Whether `f` is one of the frames (an own key: never `__proto__`). */
const isFormat = (f: unknown): f is Format => typeof f === 'string' && Object.prototype.hasOwnProperty.call(FORMATS, f);

/** The frame's size in u: the short side is 100. */
function frameU(f: Format): { w: number; h: number } {
  const { width, height } = FORMATS[f];
  const short = Math.min(width, height);
  return { w: (width / short) * 100, h: (height / short) * 100 };
}

/**
 * The title-safe area of a frame, as the distance in u from each edge that
 * words keep, to a tenth of a u: the sides (start and end alike), the top, and
 * the bottom — more in portrait, where the apps' buttons are. For the check and
 * the templates as much as for the prompt.
 */
export function safeArea(format: Format): { side: number; top: number; bottom: number } {
  const f: Format = isFormat(format) ? format : 'landscape';
  const { w, h } = frameU(f);
  const inset = (1 - DIRECTION.safe.title) / 2;
  // Rounded up: a margin said a little wide is still clear of the edge.
  const top = atLeast(h * inset);
  return { side: atLeast(w * inset), top, bottom: f === 'portrait' ? Math.max(top, atLeast(h * DIRECTION.safe.portraitBottom)) : top };
}

/**
 * The seconds `words` words should hold still to be read with room to spare:
 * `margin` times the time it takes at `wordsPerSecond`, and never less than a
 * phrase's `minSeconds`. 0 words is 0.
 */
export function readSeconds(words: number): number {
  const n = Number.isFinite(words) ? Math.max(0, Math.floor(words)) : 0;
  if (!n) return 0;
  const r = DIRECTION.reading;
  return Math.max(DIRECTION.phrases.minSeconds, one((n * r.margin) / r.wordsPerSecond));
}

/** The options as the rules use them: a known language, a known frame, a length in Motion's range — anything else is unknown. */
function known(o: DirectionOptions | null | undefined): { lang: Lang | null; format: Format | null; seconds: number | null } {
  const x: DirectionOptions = typeof o === 'object' && o !== null ? o : {};
  const lang = x.lang === 'en' || x.lang === 'ar' || x.lang === 'ckb' || x.lang === 'kmr' ? x.lang : null;
  const format = isFormat(x.format) ? x.format : null;
  const s = x.seconds;
  const seconds = typeof s === 'number' && Number.isFinite(s) && s > 0 ? one(Math.min(LIMITS.seconds, Math.max(LIMITS.minSeconds, s))) : null;
  return { lang, format, seconds };
}

const quoted = (words: readonly string[]) => words.map((w) => `"${w}"`).join(', ');
/** "a" or "b", "a", "b" or "c". */
const orList = (words: readonly string[]) => {
  const q = words.map((w) => `"${w}"`);
  return q.length < 2 ? q.join('') : `${q.slice(0, -1).join(', ')} or ${q[q.length - 1]}`;
};

/** The heading the rules sit under, in the prompts' own style ("Facts — never broken"). */
const DIRECTION_HEAD = 'Direction — unless asked otherwise';

/**
 * The rules for the system prompt: short, imperative, numbered, in the model's
 * terms — seconds, `u`, the vocabulary's own words — every number from
 * `DIRECTION`. Each option that is known makes its rule concrete (the safe area
 * in this frame's u, the phases in this length's seconds, the sizes for this
 * script); one that is not leaves the general rule. The same rules in the same
 * order either way, each once, and the same text every time for the same
 * options.
 */
export function directionPrompt(opts: DirectionOptions = {}): string {
  const { lang, format, seconds } = known(opts);
  const d = DIRECTION;
  const t = d.type;
  const arabic = lang === 'ar' || lang === 'ckb' || lang === 'kmr';
  const size = (n: number) => (arabic ? atLeast(n * t.arabic) : n);

  const safe = format
    ? (() => {
      const a = safeArea(format);
      return `Words ≥${a.side}u from the sides, ≥${a.top}u from the top${a.bottom === a.top ? ' and bottom' : ` and ≥${a.bottom}u from the bottom`}.`;
    })()
    : `Words ≥${pct((1 - d.safe.title) / 2)}% of the width and height from each edge; portrait: out of the bottom ${pct(d.safe.portraitBottom)}%.`;
  const phases = seconds
    ? `All in by ${one(seconds * d.phases.build)} s, still until ${one(seconds * d.phases.resolve)} s, exits after`
    : `All in by ${pct(d.phases.build)}% of the length, still until ${pct(d.phases.resolve)}%, exits after`;
  const sizes = `headlines ≥${size(t.headline)}u, words ≥${size(t.text)}u, labels ≥${size(t.label)}u${lang === null ? `; Arabic script ×${t.arabic}` : ''}`;

  const rules = [
    `Entrances ${range(d.duration.urgent)} s urgent, ${range(d.duration.standard)} standard, ${range(d.duration.weighty)} headlines, ${range(d.duration.cinematic)} cinematic; exits ${d.exitRatio} as long.`,
    `Ease entrances ${orList(d.ease.enter)}, exits "${d.ease.exit}"; ${quoted(d.ease.overshoot)} only if playful, on one element.`,
    `First motion at ${range(d.start.first)} s, main element by ${d.start.hero} s, most important first; "gap" ${range(d.stagger.gap)}, cascade ≤${d.stagger.total} s.`,
    `${phases}; ≤${d.loops} "loop", never on words.`,
    safe,
    `Main element ≥${pct(d.layout.hero)}% of the frame, its words ≥${d.layout.hierarchy}× the smallest; ${sizes}.`,
    `≤${t.voices} voices; weights ${range(t.heavy)} for main words, ${t.light} for the rest; words fg or muted; accent on ${d.accents} element.`,
    `Headlines ${range(d.reading.headlineWords)} words; hold words still ${one(d.reading.margin / d.reading.wordsPerSecond)} s each; phrases in turn ≤${d.phrases.words} words, ≤${d.phrases.seconds} s, ≥${d.phrases.minSeconds} s.`,
  ];
  return [DIRECTION_HEAD, ...rules.map((r, i) => `${i + 1}. ${r}`)].join('\n');
}
