/**
 * A look the model designs for one video — its palette, typeface, background
 * motif and pace — read, repaired and described here.
 *
 * The six styles are good, but six looks for every clinic, school and bakery
 * in the country means every video of a style looks like every other. So the
 * model, which has read the request, may design the look instead: five
 * colours, one of the app's typefaces, one of the six background motifs and
 * how fast things move. That is data, never code, and it passes through
 * `readDesign` before anything draws it.
 *
 * ## The model's taste is kept; its mistakes are not shipped
 *
 * A palette a model writes is usually handsome and sometimes unreadable —
 * pale grey words on white, a navy accent on a black ground. Words on a phone
 * in the sun need more than a designer's screen does, so the words must read
 * at 7:1 on the main ground (WCAG AAA) and 4.5:1 on the second one, and the
 * accent must stand out from the ground. What fails is moved just far enough:
 * the same hue made darker or lighter (`legible` in videolook.ts), and only
 * when no version of it can read, toward near-black or white. A typeface, a
 * motif or a pace the app does not have is replaced by a sensible default.
 *
 * Pure on purpose, like videolook.ts: the renderer (videotheme.ts), the
 * panel, the chat and the tests all read a design through the same function.
 */

import { FONT_CHOICES, contrast, fontIdOf, legible, mix } from './videolook';
import { jsonIn } from './researchrun';
import { VIDEO_DECOS, type VideoDeco, type VideoDesign } from './videotypes';

/** How much the words need against the main ground: WCAG AAA, for a phone in daylight. */
export const FG_ON_BG = 7;
/** Against the second ground, which the frame shades into: WCAG AA. */
export const FG_ON_BG2 = 4.5;
/** How far the accent must stand from the ground to be seen as a colour of its own. */
export const ACCENT_ON_BG = 2.5;

const ENERGIES: readonly VideoDesign['energy'][] = ['calm', 'lively', 'punchy'];

/**
 * A colour as `#RRGGBB`, or undefined. Takes `#rrggbb`, `rrggbb`, `#rgb` and
 * `rgb`, in any case — videolook.ts's `hexOf` wants the `#` on the short
 * form, but a model writing a palette drops it as often as not.
 */
function hexIn(x: unknown): string | undefined {
  if (typeof x !== 'string') return undefined;
  const s = x.trim();
  const six = /^#?([0-9a-f]{6})$/i.exec(s);
  if (six) return `#${six[1].toUpperCase()}`;
  const three = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  return three ? `#${three.slice(1).map((c) => c + c).join('').toUpperCase()}` : undefined;
}

/**
 * One line of the model's words — a name, a reason — as plain text: tags
 * gone, invisible and control characters gone, white space collapsed, and
 * cut to `cap` whole characters. It is only ever shown as text, but it is
 * shown, so it is kept short and clean.
 */
function lineOf(x: unknown, cap: number): string {
  if (typeof x !== 'string') return '';
  const s = x
    .slice(0, 2000)
    .replace(/<\/?[a-z!][^>]*>/gi, '')
    // Invisible letters (bidi marks, zero-width spaces) go, except the non-joiner Kurdish spells with; control characters are spaces.
    .replace(/\p{Cf}/gu, (c) => (c === String.fromCharCode(0x200c) ? c : ''))
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(s).slice(0, cap).join('').trim();
}

/**
 * A typeface id: one of `FONT_CHOICES` by id or label (videolook's
 * `fontIdOf`), or by the name of either of its families — a model that
 * knows fonts writes "Playfair Display" as readily as "classic".
 */
function fontOf(x: unknown): string {
  const id = fontIdOf(x);
  if (id) return id;
  if (typeof x !== 'string') return 'geometric';
  const s = x.trim().toLowerCase();
  return FONT_CHOICES.find((f) => f.latin.toLowerCase() === s || f.arabic.toLowerCase() === s)?.id ?? 'geometric';
}

function oneOf<T extends string>(x: unknown, list: readonly T[], fallback: T): T {
  if (typeof x !== 'string') return fallback;
  const s = x.trim().toLowerCase();
  return (list as readonly string[]).includes(s) ? s as T : fallback;
}

/**
 * Words that read on `bg` at `min`:1 when no shade of their own hue can: the
 * ground itself is moved, away from the words, until they do. Only for a
 * ground so near the middle (around #777) that neither black nor white
 * reaches 7:1 on it — a palette nobody could read words on.
 */
function groundFor(fg: string, bg: string, min: number): string {
  if (contrast(fg, bg) >= min) return bg;
  const away = contrast(fg, '#000000') >= contrast(fg, '#FFFFFF') ? '#000000' : '#FFFFFF';
  for (let i = 1; i <= 20; i++) {
    const g = mix(bg, away, i / 20);
    if (contrast(fg, g) >= min) return g;
  }
  return away;
}

/**
 * A designed look, read and made readable, or `null` unless all five
 * colours are there.
 *
 * - Colours: `#abc`, `abc`, `#aabbcc` in any case, as `#AABBCC`.
 * - `fg` reads at 7:1 on `bg`: the model's colour made darker or lighter in
 *   its own hue until it does (a pale gold on cream becomes a deep one), and
 *   pure black or white at the end. A mid-grey `bg` that not even those read
 *   on is moved away from the words.
 * - `fg` reads at 4.5:1 on `bg2` too: moved further the same way when that
 *   keeps it readable on `bg`; otherwise — a dark `bg` shading into a light
 *   `bg2`, which no one colour of words reads on — `bg2` is brought toward
 *   `bg` until the words read on both.
 * - `accent` stands out from `bg` (2.5:1), moved toward the words until it
 *   does. `accent2` is the model's own: it only ever sits beside the accent.
 * - `font` one of `FONT_CHOICES` (else 'geometric'), `deco` one of the six
 *   motifs (else 'mesh'), `energy` calm, lively or punchy (else 'lively').
 * - `name` at most 40 characters, `why` at most 160, as plain one-line text.
 */
export function readDesign(v: unknown): VideoDesign | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  let bg = hexIn(o.bg ?? o.background);
  let bg2 = hexIn(o.bg2 ?? o.background2 ?? o.ground2);
  let fg = hexIn(o.fg ?? o.text ?? o.ink ?? o.foreground);
  let accent = hexIn(o.accent);
  const accent2 = hexIn(o.accent2 ?? o.secondary);
  if (!bg || !bg2 || !fg || !accent || !accent2) return null;

  fg = legible(fg, bg, FG_ON_BG);
  bg = groundFor(fg, bg, FG_ON_BG);
  if (contrast(fg, bg2) < FG_ON_BG2) {
    const both = legible(fg, bg2, FG_ON_BG2);
    if (contrast(both, bg) >= FG_ON_BG) fg = both;
    else {
      const was = bg2;
      for (let i = 1; i <= 20 && contrast(fg, bg2) < FG_ON_BG2; i++) bg2 = mix(was, bg, i / 20);
    }
  }
  const tone = accent;
  for (let i = 1; i <= 10 && contrast(accent, bg) < ACCENT_ON_BG; i++) accent = mix(tone, fg, i / 10);

  return {
    name: lineOf(o.name ?? o.title, 40),
    why: lineOf(o.why ?? o.reason, 160),
    bg: bg.toUpperCase(),
    bg2: bg2.toUpperCase(),
    fg: fg.toUpperCase(),
    accent: accent.toUpperCase(),
    accent2,
    font: fontOf(o.font ?? o.typeface),
    deco: oneOf<VideoDeco>(o.deco ?? o.motif ?? o.background_motif, VIDEO_DECOS, 'mesh'),
    energy: oneOf(o.energy ?? o.pace, ENERGIES, 'lively'),
  };
}

/**
 * The design in a model's reply: the `design` (or `look`) of a whole plan,
 * or a reply that is only a design. `null` when there is none that reads.
 */
export function designIn(reply: string): VideoDesign | null {
  const o = jsonIn(typeof reply === 'string' ? reply : '') as Record<string, unknown> | null;
  if (!o) return null;
  return readDesign(o.design) ?? readDesign(o.look) ?? readDesign(o);
}

/**
 * Each typeface's character, for the model to choose by. Every pair was
 * chosen because its Arabic face has every Kurdish letter (videolook.ts), so
 * the choice is about the voice of the video, never about the language.
 */
const FONT_CHARACTER: Readonly<Record<string, string>> = {
  geometric: 'clean and contemporary, a little technical — apps, start-ups, modern services',
  condensed: 'tall, tight and loud, like a poster — sport, sales, announcements with punch',
  classic: 'a high-contrast classic serif — luxury, heritage, formal occasions, fashion',
  wide: 'wide and futuristic — tech launches, gaming, events at night',
  swiss: 'neutral and precise — institutions, companies, public information, finance',
  soft: 'a warm, friendly soft serif — food, family, community, hospitality',
  book: 'a calm book serif with a traditional Naskh — education, culture, health, religion',
  poster: 'a characterful bold grotesque — campaigns, youth, creative work, culture',
  calligraphy: 'refined, with a Ruqaa hand — weddings, Eid and Newroz greetings, poetry, perfume',
  rounded: 'rounded and playful — children, schools, casual apps, cafés',
};

/** Each background motif's character. The six styles' own, drawn by videoscenebits.tsx. */
const DECO_CHARACTER: Readonly<Record<VideoDeco, string>> = {
  mesh: 'soft colour clouds drifting over a faint grid — modern, digital',
  slab: 'diagonal bands and a huge outlined scene number — bold, sporty, loud',
  frame: 'a thin double frame with small corner diamonds — elegant, formal, premium',
  glow: 'glowing lights over a retro horizon of lines — nightlife, gaming, tech events',
  rule: 'thin rules, a progress line and a scene counter — minimal, editorial, institutional',
  sun: 'a soft sun and gentle hills in a corner — warm, friendly, outdoors, family',
};

/**
 * How the model designs a video's look: what a good palette for a short
 * video is, and each typeface and motif with its character, so it chooses by
 * what the video needs rather than by the first word on the list. The app
 * checks the contrast again (`readDesign`), so a rule broken here costs a
 * colour, never a scene nobody can read.
 */
export const DESIGN_RULES = [
  'Design the look of this video for its subject, its audience and its occasion: the palette, typeface, background motif and pace a good art director would choose for exactly this video — not a generic look that would suit any video.',
  '- "bg" and "bg2": the background and the colour it shades into as the frame moves. A dark ground makes colour glow on a phone; a light one feels open, clean and daytime. Choose for the subject, not by habit.',
  '- "fg": the words, on both grounds — very strong contrast (at least 7:1 on "bg", 4.5:1 on "bg2").',
  '- "accent": what draws the eye — the emphasised words, the shapes, the highlight marker, a solid ground on its own for a beat. Clearly different from "bg". "accent2": its partner, for gradients and second shapes, in harmony with it.',
  '- If the request or the brand gives colours, build the palette around them. If it names an institution, a country or an occasion (Newroz, Eid, a national day, a graduation), you may draw on its well-known colours.',
  '- Readable first: no mid-grey grounds, no words close to their ground in colour. No neon and no pure primaries unless the request asks for them.',
  '- "font": the typeface, by id. Every one has all the Arabic and Kurdish letters (ڕ ڵ ێ ۆ ە ڤ included), so choose by character, not by language:',
  ...FONT_CHOICES.map((f) => `  - "${f.id}" — ${f.latin} with ${f.arabic}: ${FONT_CHARACTER[f.id] ?? f.label.toLowerCase()}.`),
  '- "deco": the background motif, by id:',
  ...VIDEO_DECOS.map((d) => `  - "${d}" — ${DECO_CHARACTER[d]}.`),
  '- "energy": how things move — "calm" (slow and eased: premium, health, formal, remembrance), "lively" (springy: most promos), "punchy" (fast, in capitals: sales, sport, launches).',
  '- "name": two or three words naming the look, in the video\'s language. "why": one short sentence, in that language, on why it suits this video.',
  'Colours as #RRGGBB.',
].join('\n');

/** The JSON shape of a design, as the model is shown it. */
export const DESIGN_SHAPE = '{"name":"…","why":"…","bg":"#RRGGBB","bg2":"#RRGGBB","fg":"#RRGGBB","accent":"#RRGGBB","accent2":"#RRGGBB",'
  + `"font":"${FONT_CHOICES.map((f) => f.id).join('|')}","deco":"${VIDEO_DECOS.join('|')}","energy":"calm|lively|punchy"}`;
