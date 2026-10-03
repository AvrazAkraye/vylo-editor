// Work package 06: the gallery's search and the brand kit (motionsearch.ts,
// motionbrand.ts, the brand's half of motionstore.ts, the metadata of the
// original eighteen in motionrecipe.ts, and the brand's look in
// motiontemplates.ts).
//
// What matters, in order of how bad it would be to get wrong:
//
//   1. With no brand set, the original eighteen build exactly as they did
//      before this package: byte for byte, in every language and shape, pinned
//      to a digest taken from the commit before it, and through every new path
//      (`kitOptionsWithBrand(o, null)`, `look: null`).
//   2. A brand kit read from anywhere is clamped and never throws; reading it
//      again changes nothing; one with nothing in it is no kit.
//   3. A brand fills what it should and nothing else: its palette only when the
//      caller chose none, its name only in a field that means the brand (never
//      a lower third's person), its face only where the house display face was,
//      its logo only in a template with a place for one. `applyBrand` twice is
//      `applyBrand` once — the very object.
//   4. The search ranks the obvious template first in English, Arabic, Sorani
//      and Badini, folds the ways Arabic script is written, is deterministic,
//      lists everything for no search and nothing for nonsense, and survives
//      anything typed.
//   5. The kit is kept in a database of its own, survives refusal, and a load
//      that started before a save does not undo it.
import { createHash } from 'crypto';
import { makeCanvas } from './motioncanvas.mjs';
import {
  BRAND_LIMITS, applyBrand, brandFields, brandLook, initialsOf, kitOptionsWithBrand, readBrand,
} from '../.test-build/motionbrand.js';
import { GALLERY_ORDER, GROUP_NAMES, foldSearch, recentRecipes, searchRecipes, searchWords } from '../.test-build/motionsearch.js';
import { DISPLAY_VOICE, RECIPES, buildMotion, logoOk, lookOf } from '../.test-build/motiontemplates.js';
import { META, PALETTES, recipesOf } from '../.test-build/motionrecipe.js';
import { CORE_RECIPE_IDS, FORMAT_IDS, LANGUAGES, LIMITS, RECIPE_GROUPS, RECIPE_IDS, VOICES } from '../.test-build/motiontypes.js';
import { readMotion } from '../.test-build/motionread.js';
import { setLayer } from '../.test-build/motionedit.js';
import { paint } from '../.test-build/motiondraw.js';
import { readFileSync } from 'fs';
import { currentBrand, loadBrand, onBrand, saveBrand } from '../.test-build/motionstore.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const J = (x) => JSON.stringify(x);
const started = performance.now();

/**
 * The interface's translations, read from `src/i18n.ts` as text the way
 * `i18n.test.mjs` reads them (the module is not one the test build bundles on
 * its own; `motionsearch.js` carries its own copy inside it).
 */
const CATALOGUE = (() => {
  const src = readFileSync('src/i18n.ts', 'utf8').replace(/\r\n/g, '\n');
  const ENTRY = /^ {2}'((?:[^'\\]|\\.)+)':[ \t]*\n?[ \t]*'((?:[^'\\]|\\.)*)',[ \t]*$/gm;
  const out = {};
  for (const lang of ['ar', 'ckb', 'kmr']) {
    const from = src.indexOf(`const ${lang}: Dict = {`);
    const body = src.slice(from, src.indexOf('\n};', from));
    out[lang] = new Map([...body.matchAll(ENTRY)].map((m) => [m[1].replace(/\\'/g, "'"), m[2].replace(/\\'/g, "'")]));
  }
  return out;
})();
const translator = (lang) => (s) => CATALOGUE[lang]?.get(s) ?? s;

/** A one-pixel PNG, as the picture importer writes one. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const BRAND = { name: 'Vylo Tech', handle: '@vylotech', url: 'https://vylo-tech.com/', logo: PNG, paletteId: 'ocean', voice: 'serif' };

// ── 1. the eighteen, exactly as before ────────────────────────────────────
console.log('the original eighteen with no brand');
{
  // sha256 of the JSON of every original template built with no fields, in every language and shape, at `now` 1, taken
  // from the commit before this package (c921d23). If a recipe is changed on purpose, this moves, and the new value is
  // written here in the same commit, saying why. Moved by W2-4 (template polish, docs/pro/w2-polish.md): the data
  // templates keep their words inside the title-safe area (8.9u from the wide frame's sides, out of a portrait frame's
  // bottom 30.3u), and the lower third, handle, logo reveal and intro sweep their light while landing, gone by the still.
  // Moved by R5 (content review, docs/pro/review-content.md): the split reveal's lower panel is the second accent (it was
  // the accent at 55%, a muddy tone) and its tall frame sets the title larger; kinetic type opens its lines when a comma
  // above would touch the highlight (the English sample in the tall shapes); and the countdown's last word fits inside its
  // ring in Arabic script. The other fifteen build exactly as before.
  const PINNED = '129b725ea7902055d9086baf918d8c9c0adedbd76c0c4e070a8e8b7cb1c32c1a';
  const h = createHash('sha256');
  for (const id of CORE_RECIPE_IDS) for (const lang of LANGUAGES) for (const format of FORMAT_IDS) {
    h.update(J(buildMotion({ id: 'x', recipe: id, lang, format, now: 1 })));
  }
  const digest = h.digest('hex');
  ok('the 18 x 4 languages x 4 shapes build byte for byte as at c921d23', digest === PINNED, digest);

  let n = 0;
  const bad = [];
  for (const id of CORE_RECIPE_IDS) for (const lang of LANGUAGES) for (const format of FORMAT_IDS) {
    for (const o of [
      { id: 'x', recipe: id, lang, format, now: 3 },
      { id: 'x', recipe: id, lang, format, now: 3, palette: 'paper', seconds: 9, fields: Object.fromEntries(META[id].fields.map((f) => [f.key, ''])) },
    ]) {
      const plain = J(buildMotion(o));
      n++;
      if (kitOptionsWithBrand(o, null) !== o || kitOptionsWithBrand(o, undefined) !== o || kitOptionsWithBrand(o, {}) !== o) bad.push(`${id}/${lang}/${format} options changed`);
      if (J(buildMotion({ ...o, look: null })) !== plain || J(buildMotion({ ...o, look: {} })) !== plain) bad.push(`${id}/${lang}/${format} look changed it`);
      if (J(buildMotion({ ...o, look: { voice: DISPLAY_VOICE } })) !== plain) bad.push(`${id}/${lang}/${format} the house face changed it`);
    }
  }
  ok(`${n} builds: no kit, an empty kit, no look and the house face are the plain build, and the very options object`, bad.length === 0, bad.slice(0, 4));
}

// ── 2. metadata ───────────────────────────────────────────────────────────
console.log('metadata of the eighteen');
{
  const bad = [];
  const oneSentence = (s) => typeof s === 'string' && s.length >= 30 && s.length <= 220 && /\.$/.test(s) && !/[\n`{}]/.test(s)
    && (s.match(/[.!?](\s|$)/g) ?? []).length === 1;
  for (const id of CORE_RECIPE_IDS) {
    const m = META[id];
    const tags = m.tags ?? [];
    if (!Array.isArray(m.tags) || tags.length < 5 || tags.length > 12) bad.push(`${id}: ${tags.length} tags`);
    if (tags.some((t) => typeof t !== 'string' || !t.trim() || t !== t.toLowerCase() || t.length > 30)) bad.push(`${id}: a tag is not a short lower-case word`);
    if (new Set(tags).size !== tags.length) bad.push(`${id}: a tag twice`);
    if (!oneSentence(m.useWhen)) bad.push(`${id}: useWhen is not one sentence: ${m.useWhen}`);
    if (!oneSentence(m.avoidWhen)) bad.push(`${id}: avoidWhen is not one sentence: ${m.avoidWhen}`);
    const pairs = m.pairsWith ?? [];
    if (!pairs.length || pairs.length > 4 || pairs.some((p) => !RECIPE_IDS.includes(p) || p === id) || new Set(pairs).size !== pairs.length) bad.push(`${id}: pairsWith ${J(pairs)}`);
    for (const f of m.fields) if (f.brand !== undefined && !['name', 'handle', 'url', 'initials'].includes(f.brand)) bad.push(`${id}.${f.key}: brand ${f.brand}`);
  }
  ok('every original template has 5 to 12 short lower-case tags, one-sentence useWhen and avoidWhen, and real pairs', bad.length === 0, bad.slice(0, 5));
  ok('the brief\'s own words find a tag: name tag, subscribe, sale, countdown',
    META['lower-third'].tags.includes('name tag') && META.subscribe.tags.includes('subscribe') && META.kinetic.tags.includes('sale') && META.countdown.tags.includes('countdown'));
  const branded = CORE_RECIPE_IDS.flatMap((id) => META[id].fields.filter((f) => f.brand).map((f) => `${id}.${f.key}=${f.brand}`));
  ok('the fields that mean the brand, and only those: the logo reveal\'s name and letters, the handle', J(branded) === J(['handle.handle=handle', 'logo-reveal.name=name', 'logo-reveal.mark=initials']), branded);
  ok('a lower third\'s name is a person\'s, never filled from a brand', !META['lower-third'].fields.some((f) => f.brand));
  const slots = CORE_RECIPE_IDS.filter((id) => META[id].logo);
  ok('only the logo reveal has a place for a logo', J(slots) === J(['logo-reveal']), slots);
  const missing = [];
  for (const lang of LANGUAGES) for (const format of FORMAT_IDS) {
    const m = buildMotion({ id: 'x', recipe: 'logo-reveal', lang, format, now: 1 });
    if (!m.layers.some((l) => l.id === `logo-reveal-${META['logo-reveal'].logo.layer}`)) missing.push(`${lang}/${format}`);
  }
  ok('the logo slot\'s layer is built in every language and shape', missing.length === 0, missing);
  // The other languages are searched by what the interface shows, so all of it must be translated.
  const untranslated = [];
  for (const lang of ['ar', 'ckb', 'kmr']) {
    const t = translator(lang);
    for (const id of CORE_RECIPE_IDS) for (const s of [META[id].name, META[id].about, ...META[id].fields.map((f) => f.label)]) if (t(s) === s) untranslated.push(`${lang}: ${s}`);
    for (const g of RECIPE_GROUPS) if (t(GROUP_NAMES[g]) === GROUP_NAMES[g]) untranslated.push(`${lang}: ${GROUP_NAMES[g]}`);
  }
  ok('every name, description, field label and group name the index reads is translated in ar, ckb and kmr', untranslated.length === 0, untranslated.slice(0, 5));
}

// ── 3. the search ─────────────────────────────────────────────────────────
console.log('search: folding');
{
  ok('alef forms are one letter', foldSearch('أإآٱا') === 'ااااا', foldSearch('أإآٱا'));
  ok('alef maqsura, Persian yeh and Arabic yeh are one', foldSearch('ىیي') === 'ييي');
  ok('Persian kaf is kaf; teh marbuta and Sorani heh are heh', foldSearch('کةھ') === 'كهه');
  ok('tashkeel and tatweel go', foldSearch('مُخَـــطَّطٌ') === 'مخطط', foldSearch('مُخَـــطَّطٌ'));
  ok('Eastern Arabic and Persian digits are 0-9', foldSearch('٣٤ ۵۶') === '34 56');
  ok('Latin accents and case go', foldSearch('Éclair CAFÉ') === 'eclair cafe');
  ok('invisible marks go', foldSearch('lo\u200bgo\u200f') === 'logo');
  ok('plurals fold, and only plurals', J(searchWords('charts stories boxes matches status press axis counter')) === J(['chart', 'story', 'box', 'match', 'status', 'press', 'axis', 'counter']),
    searchWords('charts stories boxes matches status press axis counter'));
  ok('the Arabic article goes from the front of a word, not from a short one', J(searchWords('الشعار الخط')) === J(['شعار', 'خط']), searchWords('الشعار الخط'));
  ok('words that decide nothing are dropped, in every language', searchWords('a template for my video في من لە بۆ ل').length === 0, searchWords('a template for my video في من لە بۆ ل'));
}

console.log('search: ranking');
{
  const first = (q, lang = 'en') => searchRecipes(q, lang)[0];
  // A family of templates shares its words: for a general search ("name", "interview speaker") any lower third is the obvious answer.
  const LOWER_THIRDS = ['lower-third', 'lt-bar', 'lt-pill', 'lt-kicker', 'lt-neon'];
  const good = (got, id) => got === id || (id === 'lower-third' && LOWER_THIRDS.includes(got));
  const top = (q, n, lang = 'en') => searchRecipes(q, lang).slice(0, n);
  const want = [
    ['name tag', 'lower-third'], ['subscribe', 'subscribe'], ['sale', 'kinetic'], ['countdown', 'countdown'], ['pie', 'donut'],
    ['logo', 'logo-reveal'], ['quote', 'quote'], ['background', 'loop-bg'], ['how to', 'steps'], ['username', 'handle'], ['timer', 'countdown'],
    ['instagram', 'handle'], ['YouTube', 'subscribe'], ['trend over time', 'line-chart'], ['company logo end card', 'logo-reveal'], ['testimonial', 'quote'],
    ['interview speaker', 'lower-third'], ['checklist', 'steps'], ['kpi percent', 'big-number'],
  ];
  const wrong = want.filter(([q, id]) => !good(first(q), id)).map(([q, id]) => `${q}: ${first(q)} not ${id}`);
  ok(`${want.length} English searches put the obvious template first`, wrong.length === 0, wrong);
  ok('"chart" finds the three charts first', J(top('chart', 3).sort()) === J(['bar-chart', 'donut', 'line-chart']), top('chart', 3));
  ok('"charts" is "chart"', J(searchRecipes('charts', 'en')) === J(searchRecipes('chart', 'en')));
  ok('"number" has the big number among the first two', top('number', 2).includes('big-number'), top('number', 2));
  ok('the results follow typing: "subs" already finds subscribe, "coun" the countdown', first('subs') === 'subscribe' && searchRecipes('coun', 'en').includes('countdown'));
  const arabic = [
    ['شعار', 'logo-reveal'], ['الشعار', 'logo-reveal'], ['عداد', 'big-number'], ['اشترك', 'subscribe'], ['اشترا', 'subscribe'], ['اقتباس', 'quote'],
    ['إحصائيات', 'stats'], ['احصائيات', 'stats'], ['اسم', 'lower-third'], ['خطوات', 'steps'], ['عد تنازلي', 'countdown'], ['مُخَطَّط دائري', 'donut'],
    ['logo', 'logo-reveal'],
  ];
  const wrongAr = arabic.filter(([q, id]) => !good(first(q, 'ar'), id)).map(([q, id]) => `${q}: ${first(q, 'ar')} not ${id}`);
  ok(`${arabic.length} Arabic searches (with and without the article, hamza and marks; English too) put the obvious template first`, wrongAr.length === 0, wrongAr);
  ok('Arabic folding: marks, tatweel and alef forms find the same templates',
    J(searchRecipes('مُخَـطَّط', 'ar')) === J(searchRecipes('مخطط', 'ar')) && J(searchRecipes('أرقام', 'ar')) === J(searchRecipes('ارقام', 'ar')));
  const kurdish = [['لۆگۆ', 'logo-reveal', 'ckb'], ['ناو', 'lower-third', 'ckb'], ['ناوی', 'lower-third', 'ckb'], ['هەنگاو', 'steps', 'ckb'], ['لۆگۆ', 'logo-reveal', 'kmr'], ['پێنگاڤ', 'steps', 'kmr']];
  const wrongKu = kurdish.filter(([q, id, l]) => !good(first(q, l), id)).map(([q, id, l]) => `${l} ${q}: ${first(q, l)} not ${id}`);
  ok(`${kurdish.length} Sorani and Badini searches put the obvious template first`, wrongKu.length === 0, wrongKu);
  ok('a Kurdish keyboard\'s yeh and kaf find what an Arabic one does', J(searchRecipes('ناوی', 'ckb')) === J(searchRecipes('ناوي', 'ckb')) && J(searchRecipes('کۆتایی', 'ckb')) === J(searchRecipes('كۆتايي', 'ckb')));
  const misses = [];
  for (const lang of LANGUAGES) {
    const t = translator(lang);
    for (const id of CORE_RECIPE_IDS) if (first(t(META[id].name), lang) !== id) misses.push(`${lang}: ${t(META[id].name)} -> ${first(t(META[id].name), lang)}`);
  }
  ok('every original template is the first result for its own name, in all four languages', misses.length === 0, misses);
}

console.log('search: empty, garbage, stability');
{
  const all = searchRecipes('', 'en');
  ok('no search lists every template in the gallery\'s order', J(all) === J(GALLERY_ORDER) && all.length === Object.keys(META).length);
  ok('nor does white space, punctuation or only dropped words', ['   ', '!!!', '— , .', 'a the of', 'في من'].every((q) => J(searchRecipes(q, 'ar')) === J(GALLERY_ORDER)));
  ok('nonsense finds nothing', searchRecipes('zzqxv', 'en').length === 0 && searchRecipes('qqqqzzzz wxwxwx', 'ckb').length === 0);
  ok('case, spacing and punctuation do not change a search', J(searchRecipes('  SUBSCRIBE!! ', 'en')) === J(searchRecipes('subscribe', 'en'))
    && J(searchRecipes('Name-Tag', 'en')) === J(searchRecipes('name tag', 'en')));
  ok('word order does not change it', J(searchRecipes('logo company', 'en')) === J(searchRecipes('company logo', 'en')));
  ok('anything at all is a search: no throw', [null, undefined, 42, {}, [], 'x'.repeat(100000), '\u202eevil\u202c', '👩‍👩‍👧‍👦'.repeat(50), '\uD800', 'مدينة '.repeat(3000)]
    .every((q) => { try { return Array.isArray(searchRecipes(q, 'ar')); } catch { return false; } }));
  ok('a language that is not one searches as English does', J(searchRecipes('logo', 'xx')) === J(searchRecipes('logo', 'en')));
  // Fuzz: random strings from a mixed alphabet, in every language.
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz  ABCXYZ0123456789-_.,!?@#ابتثجحخدذرزسشصضطظعغفقكلمنهويةىأإآـًٌٍَُِّْکیەێۆڕڵڤ٣۴\u200c\u200f';
  const bad = [];
  let slowest = 0;
  for (let i = 0; i < 2000; i++) {
    const q = Array.from({ length: Math.floor(rnd() * 40) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
    const lang = LANGUAGES[i % 4];
    const t0 = performance.now();
    const a = searchRecipes(q, lang);
    slowest = Math.max(slowest, performance.now() - t0);
    const b = searchRecipes(q, lang);
    if (J(a) !== J(b)) bad.push(`not deterministic: ${q}`);
    if (new Set(a).size !== a.length || a.some((id) => !META[id])) bad.push(`not a list of templates: ${q}`);
  }
  ok(`2000 random searches: deterministic, each template at most once, real ids (slowest ${slowest.toFixed(2)} ms)`, bad.length === 0 && slowest < 20, bad.slice(0, 3));
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) searchRecipes(['name tag', 'chart', 'شعار', 'لۆگۆ'][i % 4], LANGUAGES[i % 4]);
  const per = (performance.now() - t0) / 1000;
  ok(`a search takes well under a millisecond (${(per * 1000).toFixed(0)} µs)`, per < 1, per);
}

console.log('the gallery\'s order and the recent list');
{
  ok('the gallery\'s order holds every template once, group by group', GALLERY_ORDER.length === new Set(GALLERY_ORDER).size
    && GALLERY_ORDER.length === Object.keys(META).length
    && J(GALLERY_ORDER) === J(RECIPE_GROUPS.flatMap((g) => recipesOf(g).map((m) => m.id))));
  const ms = [
    { recipe: { id: 'quote', fields: {} }, updated: 10 },
    { updated: 99 },
    { recipe: { id: 'countdown', fields: {} }, updated: 50 },
    { recipe: { id: 'quote', fields: {} }, updated: 70 },
    { recipe: { id: 'not-a-template', fields: {} }, updated: 80 },
    { recipe: { id: 'steps', fields: {} }, updated: 50 },
    { recipe: { id: 'intro', fields: {} }, updated: NaN },
    null,
  ];
  ok('recent: newest first, each once, ties in the order given, no graphic without a template or with an unknown one',
    J(recentRecipes(ms)) === J(['quote', 'countdown', 'steps', 'intro']), recentRecipes(ms));
  ok('recent: at most as many as asked', J(recentRecipes(ms, 2)) === J(['quote', 'countdown']) && recentRecipes(ms, 0).length === 0 && recentRecipes(ms, -3).length === 0);
  ok('recent: no graphics, no recent', recentRecipes([]).length === 0);
}

// ── 4. the brand kit reader ───────────────────────────────────────────────
console.log('brand: reading');
{
  ok('not a kit: nothing, a number, a string, a list', [null, undefined, 3, 'Vylo', [], [BRAND], true].every((x) => readBrand(x) === null));
  ok('an empty kit is no kit', readBrand({}) === null && readBrand({ name: '  ', handle: '@', url: 'https://', voice: 'bold', palette: { bg: 'nope' } }) === null);
  const k = readBrand(BRAND);
  ok('a kit is read: the handle without its @, the address without its scheme and slash, the palette by id',
    k && k.name === 'Vylo Tech' && k.handle === 'vylotech' && k.url === 'vylo-tech.com' && k.logo === PNG && k.paletteId === 'ocean' && k.voice === 'serif'
      && J(k.palette) === J(Object.fromEntries(Object.entries(PALETTES.find((p) => p.id === 'ocean').colors).map(([t, c]) => [t, c.toLowerCase()]))), k);
  ok('reading a kit again changes nothing', J(readBrand(k)) === J(k));
  ok('the name is one line, cut to its length', readBrand({ name: `A\n\tB  ${'x'.repeat(500)}` }).name === `A B ${'x'.repeat(BRAND_LIMITS.name - 4)}`);
  ok('a handle has no spaces and no @, and is cut to its length', readBrand({ handle: ' \uff20@my handle ' }).handle === 'myhandle'
    && Array.from(readBrand({ handle: 'h'.repeat(99) }).handle).length === BRAND_LIMITS.handle);
  ok('an address loses every scheme in front and every slash behind', readBrand({ url: 'HTTPS://http://example.com///' }).url === 'example.com');
  ok('a logo is a PNG or JPEG data URL inside the picture limit, or nothing', [
    'http://example.com/logo.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGI+', 'javascript:alert(1)', 42,
    `data:image/png;base64,${'A'.repeat(LIMITS.image)}`,
  ].every((logo) => readBrand({ name: 'x', logo }).logo === undefined) && readBrand({ logo: 'data:image/jpeg;base64,/9j/4AAQ' }).logo === 'data:image/jpeg;base64,/9j/4AAQ');
  ok('a voice is one of the list, else the house face', readBrand({ name: 'x', voice: 'comic' }).voice === DISPLAY_VOICE && readBrand({ voice: 'mono' }).voice === 'mono');
  const custom = readBrand({ palette: { bg: '#112233', fg: 'not a colour', accent: '#ABCDEF' } });
  ok('five colours of its own: each read, the unreadable from the first palette', custom.paletteId === null && custom.palette.bg === '#112233'
    && custom.palette.accent === '#abcdef' && custom.palette.fg === PALETTES[0].colors.fg.toLowerCase(), custom);
  ok('five colours that are one of the nine palettes are that palette', readBrand({ palette: PALETTES[3].colors }).paletteId === PALETTES[3].id);
  ok('a palette id that is not one falls to the colours, and none is none', readBrand({ name: 'x', paletteId: 'plaid' }).palette === null);
  const hostile = new Proxy({}, { get() { throw new Error('no'); }, ownKeys() { throw new Error('no'); }, getOwnPropertyDescriptor() { throw new Error('no'); }, has() { throw new Error('no'); } });
  ok('a record that throws from every trap is no kit, and nothing is thrown', (() => { try { return readBrand(hostile) === null; } catch { return false; } })());
  ok('only its own keys count, never its prototype\'s', readBrand(Object.create({ name: 'inherited' })) === null);

  // Fuzz: random values in every key; the reader never throws, keeps its limits, and is a fixed point.
  let seed = 11;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const STR = ['', ' ', 'Vylo', '@@x y', '\u202eevil', 'مدينة جميلة', '👩‍👩‍👧‍👦', 'x'.repeat(5000), '\u0000\u0007bell', 'https://a.b/c/', 'ftp://x', '#FFF', 'ocean', 'serif'];
  const ANY = [...STR, 0, -1, NaN, Infinity, null, undefined, true, [], {}, [1, 2], { bg: '#000' }, PNG, `data:image/jpeg;base64,${'Q'.repeat(100)}`];
  const bad = [];
  for (let i = 0; i < 3000; i++) {
    const x = {};
    for (const key of ['name', 'handle', 'url', 'logo', 'paletteId', 'palette', 'voice', 'junk']) if (rnd() < 0.7) x[key] = key === 'palette' && rnd() < 0.5 ? { bg: pick(ANY), fg: pick(ANY), accent: pick(STR), accent2: '#123456', muted: pick(ANY) } : pick(ANY);
    let a;
    try { a = readBrand(x); } catch (e) { bad.push(`threw ${e}`); continue; }
    if (a === null) continue;
    if (J(readBrand(a)) !== J(a)) bad.push(`not a fixed point: ${J(x).slice(0, 120)}`);
    if (Array.from(a.name).length > BRAND_LIMITS.name || /\s{2}|\n/.test(a.name) || a.name !== a.name.trim()) bad.push(`name ${J(a.name).slice(0, 60)}`);
    if (Array.from(a.handle).length > BRAND_LIMITS.handle || /\s|^[@\uff20]/.test(a.handle)) bad.push(`handle ${a.handle}`);
    if (Array.from(a.url).length > BRAND_LIMITS.url || /\s|\/$|^[a-z]+:\/\//i.test(a.url)) bad.push(`url ${a.url}`);
    if (a.logo !== undefined && !logoOk(a.logo)) bad.push('logo');
    if (!VOICES.includes(a.voice)) bad.push(`voice ${a.voice}`);
    if ((a.palette === null) !== (a.paletteId === null && a.palette === null) && a.paletteId !== null && a.palette === null) bad.push('palette id without colours');
    if (a.palette && !Object.values(a.palette).every((c) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(c))) bad.push(`palette ${J(a.palette)}`);
  }
  ok('3000 random kits: never a throw, every limit kept, every kit a fixed point', bad.length === 0, bad.slice(0, 4));
  ok('initials: two words make two capitals, one word one, Arabic script one letter', initialsOf('vylo tech labs') === 'VT' && initialsOf('Vylo') === 'V'
    && initialsOf('فيلو تك') === 'ف' && initialsOf('') === '' && initialsOf('   ') === '');
}

// ── 5. a brand in a new graphic ───────────────────────────────────────────
console.log('brand: new graphics');
const kit = readBrand(BRAND);
{
  const o = { id: 'n', recipe: 'logo-reveal', lang: 'en', format: 'landscape', now: 5 };
  const withKit = kitOptionsWithBrand(o, kit);
  ok('the options gain the kit\'s palette, its name and initials, and its look', J(withKit.palette) === J(kit.palette)
    && withKit.fields.name === 'Vylo Tech' && withKit.fields.mark === 'VT' && withKit.look.voice === 'serif' && withKit.look.logo === PNG, withKit);
  ok('a palette the caller chose wins over the brand\'s', kitOptionsWithBrand({ ...o, palette: 'paper' }, kit).palette === 'paper');
  ok('words the caller gave win, and then the badge does not wear the brand\'s initials', (() => {
    const w = kitOptionsWithBrand({ ...o, fields: { name: 'Northwind' } }, kit);
    return w.fields.name === 'Northwind' && w.fields.mark === undefined;
  })());
  ok('a field given empty stays empty', kitOptionsWithBrand({ ...o, fields: { name: '' } }, kit).fields.name === '');
  ok('a kit with no palette leaves each template its own', kitOptionsWithBrand(o, { name: 'x' }).palette === undefined);
  ok('the handle template takes the handle; a lower third takes nothing', brandFields('handle', kit).handle === 'vylotech' && J(brandFields('lower-third', kit)) === '{}');
  ok('the look: none for a kit with the house face and no logo', brandLook(readBrand({ name: 'x' })) === null && J(brandLook(kit)) === J({ voice: 'serif', logo: PNG }));

  const bad = [];
  for (const id of CORE_RECIPE_IDS) for (const lang of LANGUAGES) for (const format of FORMAT_IDS) {
    const base = { id: 'n', recipe: id, lang, format, now: 5 };
    const plain = buildMotion(base);
    const m = buildMotion(kitOptionsWithBrand(base, kit));
    const key = `${id}/${lang}/${format}`;
    if (J(buildMotion(kitOptionsWithBrand(base, kit))) !== J(m)) bad.push(`${key} not deterministic`);
    if (J(readMotion(JSON.parse(J(m)), 5)) !== J(m)) bad.push(`${key} not a fixed point of the reader`);
    if (J(m.palette) !== J(kit.palette)) bad.push(`${key} palette`);
    // The face: every layer that was the house display face is the brand's, and no other layer's face moved.
    const before = new Map(plain.layers.map((l) => [l.id, l]));
    for (const l of m.layers) {
      const p = before.get(l.id);
      if (!p || !('voice' in l)) continue;
      const want = p.voice === DISPLAY_VOICE ? 'serif' : p.voice;
      if (l.voice !== want) bad.push(`${key} ${l.id} ${p.voice} -> ${l.voice}`);
    }
    if (id === 'logo-reveal') {
      const logo = m.layers.find((l) => l.id === 'logo-reveal-logo');
      const badge = plain.layers.find((l) => l.id === 'logo-reveal-badge');
      if (!logo || logo.kind !== 'image' || logo.src !== PNG || logo.fit !== 'contain') bad.push(`${key} no logo`);
      else if (logo.w !== badge.w || logo.h !== badge.h || logo.start !== badge.start || logo.end !== badge.end || J(logo.in) !== J(badge.in) || J(logo.shadow) !== J(badge.shadow)) bad.push(`${key} the logo is not where the badge was`);
      if (m.layers.findIndex((l) => l.id === 'logo-reveal-logo') !== plain.layers.findIndex((l) => l.id === 'logo-reveal-badge')) bad.push(`${key} the logo is not at the badge's place in the stack`);
      if (m.layers.some((l) => /^logo-reveal-(badge|badge-light|mark|shine(-\d)?)$/.test(l.id))) bad.push(`${key} the badge's layers are still there`);
      if (m.recipe.fields.name !== 'Vylo Tech' || m.recipe.fields.mark !== 'VT') bad.push(`${key} fields ${J(m.recipe.fields)}`);
    } else if (m.layers.some((l) => l.kind === 'image')) bad.push(`${key} a logo where there is no place for one`);
    if (id === 'handle' && m.recipe.fields.handle !== 'vylotech') bad.push(`${key} handle`);
    if (id === 'lower-third' && J(m.recipe.fields) !== J(plain.recipe.fields)) bad.push(`${key} a lower third's words changed`);
    if (m.layers.some((l) => !(l.end > l.start))) bad.push(`${key} a layer ends before it starts`);
    for (let i = 0; i < 6; i++) {
      const c = makeCanvas(160, 90);
      try { paint(c.ctx, m, (m.seconds * i) / 5, { strict: true }); } catch (e) { bad.push(`${key} paint threw ${e}`); break; }
      const problems = c.check();
      if (problems.length) { bad.push(`${key} @${i}: ${problems[0]}`); break; }
    }
  }
  ok(`the 18 in every language and shape with a kit: palette, face where the house face was and nowhere else, the logo in the logo reveal's badge and nowhere else, the brand's words only where they belong, clean frames`,
    bad.length === 0, bad.slice(0, 5));

  const kinetic = buildMotion(kitOptionsWithBrand({ id: 'k', recipe: 'kinetic', lang: 'en', format: 'landscape', now: 1 }, kit));
  const kineticPlain = buildMotion({ id: 'k', recipe: 'kinetic', lang: 'en', format: 'landscape', now: 1, palette: kit.palette });
  ok('a template whose look is its typeface keeps it', J(kinetic.layers) === J(kineticPlain.layers));
}

console.log('brand: a rebuild keeps the look');
{
  const m = buildMotion(kitOptionsWithBrand({ id: 'r', recipe: 'logo-reveal', lang: 'ar', format: 'square', now: 1 }, kit));
  ok('lookOf reads back the face and the logo', J(lookOf(m)) === J({ logo: PNG, voice: 'serif' }), lookOf(m));
  ok('lookOf: none for a plain graphic, one with no template, and one detached', lookOf(buildMotion({ id: 'p', recipe: 'logo-reveal', lang: 'en', format: 'landscape', now: 1 })) === null
    && lookOf({ ...m, recipe: undefined }) === null);
  const again = buildMotion({ id: 'r', recipe: 'logo-reveal', lang: 'ar', format: 'portrait', now: 1, fields: { ...m.recipe.fields, tagline: 'جديد' }, palette: m.palette, look: lookOf(m) });
  ok('built again for new words and a new shape with lookOf, it keeps the face and the logo', again.layers.some((l) => l.id === 'logo-reveal-logo')
    && again.layers.filter((l) => 'voice' in l).every((l) => l.voice !== DISPLAY_VOICE));
  const big = buildMotion(kitOptionsWithBrand({ id: 'b', recipe: 'big-title', lang: 'en', format: 'landscape', now: 1 }, { name: 'x', voice: 'mono' }));
  ok('lookOf finds a face with no logo', J(lookOf(big)) === J({ voice: 'mono' }));
}

// ── 6. applying a brand to a graphic that exists ──────────────────────────
console.log('brand: Apply brand');
{
  // Colours no template is designed in, so every graphic has something to change.
  const own = readBrand({ ...BRAND, paletteId: undefined, palette: { bg: '#102030', fg: '#f0f0f0', accent: '#ff5500', accent2: '#00aaff', muted: '#889900' } });
  const bad = [];
  for (const id of CORE_RECIPE_IDS) for (const lang of ['en', 'ar']) {
    const doc = { ...buildMotion({ id: `a-${id}`, recipe: id, lang, format: 'feed', now: 1 }), title: 'Mine', fps: 60, sound: { mode: 'kept' }, scenes: undefined };
    const a = applyBrand(doc, own, 2);
    const b = applyBrand(a, own, 3);
    const key = `${id}/${lang}`;
    if (b !== a) bad.push(`${key} not idempotent`);
    if (a === doc) bad.push(`${key} nothing changed`);
    if (J(a.palette) !== J(own.palette)) bad.push(`${key} palette`);
    if (a.title !== 'Mine' || a.fps !== 60 || a.sound?.mode !== 'kept' || a.id !== doc.id || a.created !== doc.created || a.updated !== 2) bad.push(`${key} lost what it carried`);
    if (!a.recipe || a.recipe.id !== id) bad.push(`${key} lost its template`);
    for (const f of META[id].fields) {
      const want = f.brand ? brandFields(id, own)[f.key] ?? doc.recipe.fields[f.key] : doc.recipe.fields[f.key];
      if (a.recipe.fields[f.key] !== want) bad.push(`${key} field ${f.key}: ${a.recipe.fields[f.key]}`);
    }
    const clean = applyBrand(buildMotion({ id: `c-${id}`, recipe: id, lang, format: 'portrait', now: 1 }), own, 2);
    if (J(readMotion(JSON.parse(J(clean)), 9)) !== J(clean)) bad.push(`${key} not a fixed point of the reader`);
  }
  ok('every original template\'s graphic: re-skinned, idempotent (the very object), its title, rate, sound and template kept, the brand\'s words only where they belong, a fixed point of the reader', bad.length === 0, bad.slice(0, 5));

  const native = buildMotion({ id: 'y', recipe: 'line-chart', lang: 'en', format: 'landscape', now: 1 });
  ok('a graphic already in the kit\'s colours, with no house face and no brand field, comes back as the very object', applyBrand(native, kit, 2) === native);
  const doc = buildMotion({ id: 'z', recipe: 'logo-reveal', lang: 'en', format: 'landscape', now: 1 });
  ok('no kit, or an empty one, gives the graphic back', applyBrand(doc, null) === doc && applyBrand(doc, {}) === doc && applyBrand(doc, undefined) === doc);
  const branded = applyBrand(doc, kit, 2);
  const plainKit = applyBrand(branded, { name: 'Other' }, 3);
  ok('a second kit with the house face and no logo puts the template\'s own face and badge back',
    plainKit.layers.some((l) => l.id === 'logo-reveal-badge') && !plainKit.layers.some((l) => l.id === 'logo-reveal-logo')
      && plainKit.recipe.fields.name === 'Other' && J(plainKit.palette) === J(branded.palette));

  // A graphic edited by hand: no template, so its palette and its display layers' face, through motionedit.
  const title = doc.layers.find((l) => l.kind === 'text' && l.voice === DISPLAY_VOICE);
  const detached = setLayer(doc, title.id, { x: title.x + 1 }, 4);
  ok('(a hand edit detaches it)', !detached.recipe);
  const d1 = applyBrand(detached, kit, 5);
  const d2 = applyBrand(d1, kit, 6);
  ok('edited by hand: the palette and every house-face layer change, nothing else, and twice is once', d2 === d1 && J(d1.palette) === J(kit.palette)
    && d1.layers.every((l, i) => !('voice' in l) || l.voice === (detached.layers[i].voice === DISPLAY_VOICE ? 'serif' : detached.layers[i].voice))
    && d1.layers.length === detached.layers.length && !d1.recipe);
  ok('edited by hand, a kit with only a name changes nothing', applyBrand(detached, { name: 'Only a name' }, 7) === detached);
}

// ── 7. keeping the kit ────────────────────────────────────────────────────
console.log('brand: kept');
{
  const seen = [];
  const stop = onBrand((b) => seen.push(b ? b.name : null));
  const thrower = onBrand(() => { throw new Error('a watcher that throws'); });
  ok('before anything is loaded there is no kit', currentBrand() === null);
  ok('with no IndexedDB: loading finds none, saving says it could not', (await loadBrand()) === null && (await saveBrand(kit)) === false);
  ok('but the session keeps it, and the watchers hear of it, even past one that throws', currentBrand()?.name === 'Vylo Tech' && seen.at(-1) === 'Vylo Tech');

  /** IndexedDB with databases kept apart by name: open, get, put, delete, transactions that complete later or abort. */
  function fakeIndexedDB() {
    const later = (fn) => setTimeout(fn, 0);
    const idb = {
      mode: { open: 'ok', abortWrites: false, slowGet: 0 },
      dbs: new Map(),
      opened: [],
      open(name, version) {
        idb.opened.push(`${name}@${version}`);
        const req = { result: undefined, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
        later(() => {
          if (idb.mode.open === 'error') return req.onerror?.();
          if (!idb.dbs.has(name)) idb.dbs.set(name, new Map());
          const stores = idb.dbs.get(name);
          const db = {
            onclose: null,
            objectStoreNames: { contains: (s) => stores.has(s) },
            createObjectStore(s, o) { stores.set(s, { keyPath: o.keyPath, data: new Map() }); },
            transaction(s, mode) {
              const store = stores.get(s);
              if (!store) throw new Error('NotFoundError');
              const tx = { oncomplete: null, onabort: null, onerror: null };
              const writes = [];
              let settling = false;
              const settle = () => {
                if (settling) return;
                settling = true;
                later(() => {
                  if (mode === 'readwrite' && idb.mode.abortWrites) return tx.onabort?.();
                  for (const w of writes) w();
                  tx.oncomplete?.();
                });
              };
              const request = (fn, delay = 0) => {
                const r = { result: undefined, onsuccess: null, onerror: null };
                setTimeout(() => { try { r.result = fn(); r.onsuccess?.(); } catch (e) { r.onerror?.(); } }, delay);
                settle();
                return r;
              };
              tx.objectStore = () => ({
                get: (key) => request(() => structuredClone(store.data.get(key)), idb.mode.slowGet),
                put(v) { const c = structuredClone(v); writes.push(() => store.data.set(c[store.keyPath], c)); return request(() => c[store.keyPath]); },
                delete(key) { writes.push(() => store.data.delete(key)); return request(() => undefined); },
              });
              return tx;
            },
          };
          req.result = db;
          if (!stores.size) req.onupgradeneeded?.();
          req.onsuccess?.();
        });
        return req;
      },
    };
    return idb;
  }
  const idb = fakeIndexedDB();
  globalThis.indexedDB = idb;
  ok('saving says so once it is on disk', (await saveBrand(kit)) === true);
  ok('it is kept in a database of its own, at version 1, and the graphics\' database is not touched', J(idb.opened) === J(['vylo-motion-brand@1'])
    && idb.dbs.get('vylo-motion-brand').get('kit').data.get('brand')?.name === 'Vylo Tech' && !idb.dbs.has('vylo-motion'), idb.opened);
  ok('it comes back as it was saved', J(await loadBrand()) === J(kit) && J(currentBrand()) === J(kit));
  idb.dbs.get('vylo-motion-brand').get('kit').data.set('brand', { id: 'brand', name: `  Repaired\n${'y'.repeat(300)}`, logo: 'http://x/y.png', voice: 'comic' });
  const repaired = await loadBrand();
  ok('a stored record from anywhere is read again: repaired, its address-logo dropped', repaired && repaired.name.startsWith('Repaired y') && repaired.logo === undefined
    && repaired.voice === DISPLAY_VOICE && Array.from(repaired.name).length === BRAND_LIMITS.name);
  idb.dbs.get('vylo-motion-brand').get('kit').data.set('brand', { id: 'brand', nothing: true });
  ok('a stored record that is no kit is no kit', (await loadBrand()) === null && currentBrand() === null);
  await saveBrand(kit);
  idb.mode.slowGet = 30;
  const loading = loadBrand();
  idb.mode.slowGet = 0;
  await saveBrand(readBrand({ ...BRAND, name: 'Newer' }));
  await loading;
  ok('a load that started before a save does not put back what the save replaced', currentBrand()?.name === 'Newer');
  ok('clearing forgets it, on disk and in the session', (await saveBrand(null)) === true && !idb.dbs.get('vylo-motion-brand').get('kit').data.has('brand')
    && currentBrand() === null && (await loadBrand()) === null);
  idb.mode.abortWrites = true;
  ok('a write the disk refuses says so, and the session still has the kit', (await saveBrand(kit)) === false && currentBrand()?.name === 'Vylo Tech');
  idb.mode.abortWrites = false;
  stop();
  thrower();
  const count = seen.length;
  await saveBrand(null);
  ok('a watcher that stopped hears no more', seen.length === count);
}

console.log(`\n${pass} passed, ${fail} failed (${((performance.now() - started) / 1000).toFixed(1)} s)`);
if (fail) process.exit(1);
