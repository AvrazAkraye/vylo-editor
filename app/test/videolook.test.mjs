// A video's look beyond its style: what the Look tab and the chat may set,
// and what the renderer draws with.
//
// What matters: whatever reaches a look — a stored value from an older build,
// a number the model wrote as "7" or "1.5", a colour that is not one, a font
// that drops Kurdish letters — comes out clamped to its range or left out,
// never guessed; a scene's look beats the video's and absent means the
// style's own; and words kept "legible" really reach 4.5:1 on their ground,
// staying as close to the colour asked for as they can.
import { readFileSync } from 'node:fs';
import {
  ALIGNS, BACKDROPS, CORNERS, FITS, FONT_CHOICES, LEGIBLE, LOOK_LIMITS,
  contrast, fontIdOf, hexOf, legible, lookFor, luminance, mix, normalLook, normalSceneLook, rgbOf,
} from '../.test-build/videolook.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── colours ───────────────────────────────────────────────────────────────
ok('a six-digit colour comes back as #RRGGBB', hexOf('#0b1020') === '#0B1020' && hexOf(' ffcc00 ') === '#FFCC00');
ok('a short colour is widened', hexOf('#abc') === '#AABBCC' && hexOf('#FFF') === '#FFFFFF');
ok('what is not a hex colour is not a colour — names included',
  [undefined, null, 12, '', 'black', 'blak', '#GGGGGG', '#12345', 'abc', '#1234567', 'rgb(0,0,0)', {}].every((x) => hexOf(x) === undefined));
ok('channels of a colour, grey for nonsense', same(rgbOf('#FF8000'), [255, 128, 0]) && same(rgbOf('nope'), [128, 128, 128]));
ok('mix: 0 is the first, 1 the second', mix('#000000', '#ffffff', 0) === '#000000' && mix('#000000', '#ffffff', 1) === '#ffffff' && mix('#000000', '#ffffff', 0.5) === '#808080');
ok('black on white is 21:1, and contrast is symmetric',
  Math.abs(contrast('#000000', '#FFFFFF') - 21) < 1e-9 && contrast('#123456', '#ABCDEF') === contrast('#ABCDEF', '#123456'));
ok('luminance runs from black to white', luminance('#000000') === 0 && Math.abs(luminance('#FFFFFF') - 1) < 1e-9);

// ── legible words ─────────────────────────────────────────────────────────
ok('a colour that already reads is kept as it is', legible('#FFFFFF', '#0B1020') === '#FFFFFF' && legible('#111111', '#F6F5F1') === '#111111');
{
  const y = legible('#FFE14D', '#FFFFFF');
  ok('pale yellow asked for on white becomes a yellow that reads, not black',
    contrast(y, '#FFFFFF') >= LEGIBLE && y !== '#000000' && rgbOf(y)[0] > rgbOf(y)[2], y);
  const n = legible('#1B1446', '#0B1020');
  ok('navy on near-black lightens until it reads', contrast(n, '#0B1020') >= LEGIBLE && luminance(n) > luminance('#1B1446'), n);
}
{
  // Every pair: the words reach AA on their ground, however unlucky the request.
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const hex = () => '#' + Array.from({ length: 3 }, () => Math.floor(rnd() * 256).toString(16).padStart(2, '0')).join('');
  let worst = 99;
  for (let i = 0; i < 2000; i++) {
    const a = hex(), b = hex();
    worst = Math.min(worst, contrast(legible(a, b), b));
  }
  ok('2000 random word and ground colours all end at 4.5:1 or more', worst >= LEGIBLE, worst);
}
ok('mid-grey grounds still get legible words', contrast(legible('#777777', '#777777'), '#777777') >= LEGIBLE);

// ── a video's look ────────────────────────────────────────────────────────
ok('nothing, or something that is not an object, is no look', [undefined, null, 3, 'big', [], [1]].every((x) => same(normalLook(x), {})));
ok('an empty look stays empty', same(normalLook({}), {}));
ok('numbers are clamped to their ranges',
  same(normalLook({ logoScale: 7, textScale: 9, motion: 0.01, watermarkScale: -1 }),
    { logoScale: LOOK_LIMITS.logoScale.max, textScale: LOOK_LIMITS.textScale.max, motion: LOOK_LIMITS.motion.min, watermarkScale: LOOK_LIMITS.watermarkScale.min }));
ok('the ranges are what the contract says',
  LOOK_LIMITS.logoScale.min === 0.5 && LOOK_LIMITS.logoScale.max === 3 && LOOK_LIMITS.textScale.min === 0.7 && LOOK_LIMITS.textScale.max === 1.5
  && LOOK_LIMITS.motion.min === 0.5 && LOOK_LIMITS.motion.max === 2 && LOOK_LIMITS.watermarkScale.min === 0.5 && LOOK_LIMITS.watermarkScale.max === 2);
ok('a number written as a string is read; hundredths are kept, noise is not',
  same(normalLook({ logoScale: ' 1.5 ', textScale: 1.23456 }), { logoScale: 1.5, textScale: 1.23 }));
ok('a number that is not one is left out, never guessed',
  same(normalLook({ logoScale: 'huge', textScale: NaN, motion: Infinity, watermarkScale: '' , }), {}));
ok('alignment is one of three words; "centre" and "middle" mean centre; left and right are not words here (they flip in Arabic)',
  normalLook({ align: 'centre' }).align === 'center' && normalLook({ align: 'Middle' }).align === 'center'
  && normalLook({ align: 'END' }).align === 'end' && normalLook({ align: 'left' }).align === undefined);
ok('colours are checked and written one way', same(normalLook({ background: '#000', text: 'ffffff' }), { background: '#000000', text: '#FFFFFF' }));
ok('a colour that is not one is dropped', same(normalLook({ background: 'blak', text: 'white' }), {}));
ok('backdrop and corner are their words, case aside',
  normalLook({ backdrop: 'PLAIN' }).backdrop === 'plain' && normalLook({ backdrop: 'animated' }).backdrop === undefined
  && normalLook({ watermarkCorner: 'Bottom-Start' }).watermarkCorner === 'bottom-start' && normalLook({ watermarkCorner: 'top-left' }).watermarkCorner === undefined);
ok('a font is an id from FONT_CHOICES, or its label', normalLook({ font: 'poster' }).font === 'poster' && normalLook({ font: 'Book serif' }).font === 'book');
ok('a family that is not a choice is refused — Cairo has no Kurdish letters', normalLook({ font: 'Cairo' }).font === undefined && fontIdOf('Arial') === undefined);
ok('fields that are not part of a look are dropped', same(normalLook({ logoScale: 2, evil: '<script>', fit: 'contain', logo: true }), { logoScale: 2 }));
ok('normalising twice changes nothing', (() => {
  const x = normalLook({ logoScale: '2.555', align: 'centre', background: '#abc', font: 'Rounded', motion: 3, backdrop: 'still', watermarkCorner: 'bottom-end', watermarkScale: 0.1 });
  return same(normalLook(x), x);
})());

// ── a scene's look ────────────────────────────────────────────────────────
ok('a scene look keeps its own fields', same(normalSceneLook({ textScale: 1.2, align: 'end', background: '#112233', text: '#eee', logo: false, logoScale: 2, fit: 'contain' }),
  { textScale: 1.2, align: 'end', background: '#112233', text: '#EEEEEE', logo: false, logoScale: 2, fit: 'contain' }));
ok('a scene has no font, pace, backdrop or corner of its own', same(normalSceneLook({ font: 'poster', motion: 2, backdrop: 'plain', watermarkCorner: 'top-start' }), {}));
ok('logo is a yes or a no, not a word', normalSceneLook({ logo: 'yes' }).logo === undefined && normalSceneLook({ logo: true }).logo === true);
ok('fit is cover or contain', normalSceneLook({ fit: 'COVER' }).fit === 'cover' && normalSceneLook({ fit: 'fill' }).fit === undefined);
ok('the word lists are the contract\'s',
  same(ALIGNS, ['start', 'center', 'end']) && same(BACKDROPS, ['moving', 'still', 'plain'])
  && same(CORNERS, ['top-start', 'top-end', 'bottom-start', 'bottom-end']) && same(FITS, ['cover', 'contain']));

// ── the look a scene is drawn with ────────────────────────────────────────
{
  const d = lookFor({}, {});
  ok('no look anywhere is the style\'s own',
    same(d, { logoScale: 1, textScale: 1, motion: 1, backdrop: 'moving', watermarkCorner: 'top-end', watermarkScale: 1, fit: 'cover' }), d);
  ok('a missing video or scene is the same as an empty one', same(lookFor(undefined), d) && same(lookFor(null, null), d));
  const v = { look: { logoScale: 2, textScale: 1.2, align: 'center', background: '#000000', text: '#FFFFFF', font: 'book', motion: 1.5, backdrop: 'still', watermarkCorner: 'bottom-start', watermarkScale: 1.5 } };
  const s = { look: { textScale: 0.8, align: 'end', background: '#FFFFFF', text: '#111111', logo: true, logoScale: 0.5, fit: 'contain' } };
  const both = lookFor(v, s);
  ok('a scene\'s look beats the video\'s', both.textScale === 0.8 && both.align === 'end' && both.background === '#FFFFFF' && both.text === '#111111' && both.logoScale === 0.5 && both.fit === 'contain' && both.logo === true);
  ok('the video\'s own fields reach every scene', both.font === 'book' && both.motion === 1.5 && both.backdrop === 'still' && both.watermarkCorner === 'bottom-start' && both.watermarkScale === 1.5);
  const onlyVideo = lookFor(v, { look: {} });
  ok('absent in the scene follows the video', onlyVideo.textScale === 1.2 && onlyVideo.align === 'center' && onlyVideo.logoScale === 2 && onlyVideo.logo === undefined && onlyVideo.fit === 'cover');
  ok('stored nonsense is normalised before it is drawn', lookFor({ look: { logoScale: 40, background: 'red', font: 'Tajawal' } }).logoScale === 3
    && lookFor({ look: { background: 'red' } }).background === undefined && lookFor({ look: { font: 'Tajawal' } }).font === undefined);
}

// ── the typefaces ─────────────────────────────────────────────────────────
{
  const ids = FONT_CHOICES.map((f) => f.id);
  ok('eight to ten typefaces, each with an id, a label and both families',
    FONT_CHOICES.length >= 8 && FONT_CHOICES.length <= 10 && FONT_CHOICES.every((f) => f.id && f.label && f.latin && f.arabic), FONT_CHOICES.length);
  ok('ids and labels are unique', new Set(ids).size === ids.length && new Set(FONT_CHOICES.map((f) => f.label.toLowerCase())).size === ids.length);
  ok('the six styles\' own pairs are among them',
    ['geometric', 'condensed', 'classic', 'wide', 'swiss', 'soft'].every((id) => ids.includes(id)));
  // Families checked against their woff2 cmaps and found without ڕ ڵ ێ ۆ ە — none may come back as a choice.
  const NO_KURDISH = ['Cairo', 'Tajawal', 'Almarai', 'Readex Pro', 'Changa', 'El Messiri', 'Lalezar', 'Markazi Text', 'Rubik', 'Alexandria',
    'Lemonada', 'Rakkas', 'Blaka', 'Oi', 'Handjet', 'Baloo Bhaijaan 2', 'Qahiri', 'Gulzar'];
  ok('no Arabic-script family that drops Kurdish letters', FONT_CHOICES.every((f) => !NO_KURDISH.includes(f.arabic)));
}

// ── purity ────────────────────────────────────────────────────────────────
{
  const src = readFileSync(new URL('../src/videolook.ts', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import\s+(type\s+)?[^;]*from\s+'([^']+)'/gm)];
  ok('videolook.ts imports types only — the chat can use it without React, Remotion or fonts',
    imports.length > 0 && imports.every((m) => m[1]), imports.map((m) => m[2]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
