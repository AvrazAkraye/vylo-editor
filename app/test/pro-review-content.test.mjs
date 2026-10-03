// Review R5 of the Pro pass: template and content quality (docs/pro/review-content.md).
//
// The reviewer rendered all 33 templates in the app's own WebKit, in every
// shape and language, with their samples, with long realistic words and with
// every field empty, and looked at them. What follows holds the fixes that
// came out of that, so a later change cannot quietly undo them:
//
// - A label that is too long is shortened at a word and says so with an
//   ellipsis (`clipWords`, `clipToLines`), never cut mid-word or with its last
//   word dropped unseen; labels set on two lines under a figure or a ring keep
//   the reader's 40 characters, not a chart's 24.
// - The donut's legend names share one size.
// - The countdown's last word stays inside its ring, in every script.
// - Kinetic type opens its lines when a comma would touch the highlight box.
// - The split reveal's lower panel is a colour of its own, not a muddy tint.
// - A headline does not end a line on a little word where a better break fits
//   (the device frame's "Your studio, / in your pocket"); the word on the
//   device's screen takes two lines on a phone before it is cut.
// - Nothing decorative is left alone when the words it belongs to are
//   cleared (the big title's rule, the kicker's underline).
// - Icons and words: villages and volunteers, and the Arabic plurals and
//   hamza-less spellings that pick a notification's icon.
// - Arabic terms: "loop" is never the word the app uses for a ring.
import { readFileSync } from 'node:fs';
import { clipWords, clipToLines, itemsOf, iconFor, WRAPPED_LABEL } from '../.test-build/motionrecipes-data.js';
import { buildMotion } from '../.test-build/motiontemplates.js';
import { META, PALETTES } from '../.test-build/motionrecipe.js';
import { contrast } from '../.test-build/motionmath.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const started = Date.now();
const LANGS = ['en', 'ar', 'ckb', 'kmr'];
const FORMATS = ['landscape', 'portrait', 'square', 'feed'];
const ELLIPSIS = '…';
const build = (recipe, lang, format, fields, more = {}) => buildMotion({ id: 'x', recipe, lang, format, now: 0, fields, ...more });
const by = (doc) => Object.fromEntries(doc.layers.map((l) => [l.id.slice(doc.recipe.id.length + 1), l]));
const len = (s) => Array.from(s).length;

/** Whether `shown` is `whole`, or the start of it cut after a whole word and ended with an ellipsis. */
function honest(shown, whole) {
  const flat = shown.replace(/\n/g, ' ');
  if (flat === whole) return true;
  if (!flat.endsWith(ELLIPSIS)) return false;
  const kept = flat.slice(0, -1).trim();
  if (!whole.startsWith(kept)) return false;
  const next = whole.slice(kept.length);
  // Cut after a whole word: what follows starts at a space or punctuation, or the first word was itself cut.
  return /^[\s,.;:،]/.test(next) || !kept.includes(' ');
}

// ── clipWords ─────────────────────────────────────────────────────────────
console.log('clipWords');
{
  ok('words that fit are as they are', clipWords('Students', 24) === 'Students' && clipWords('', 24) === '');
  ok('exactly the room is kept whole', clipWords('x'.repeat(24), 24) === 'x'.repeat(24));
  const v = clipWords('Villages visited by the bus every week', 24);
  ok('a long label is cut after a whole word, with an ellipsis, inside the room', v === `Villages visited by the${ELLIPSIS}` && len(v) <= 24, v);
  const b = clipWords('Buildings and maintenance', 24);
  ok('"Buildings and maintenanc" is never shown: the last word goes whole', b === `Buildings and${ELLIPSIS}`, b);
  ok('no comma or dash is left hanging before the ellipsis', clipWords('Salaries, benefits and pensions paid', 12) === `Salaries${ELLIPSIS}`);
  ok('a single word longer than the room is cut inside itself and still says so', clipWords('Supercalifragilistic', 8) === `Superca${ELLIPSIS}`);
  ok('Arabic words are cut at a word too', clipWords('الآداب والعلوم الإنسانية والفنون', 20).endsWith(ELLIPSIS)
    && !clipWords('الآداب والعلوم الإنسانية والفنون', 20).includes('الإنسانية'));
  let bad = 0;
  const words = ['a', 'bb', 'ccc', 'dddd', 'eeeee', 'ffffffffffff', 'الطلاب', 'x,', 'y;'];
  for (let i = 0; i < 2000; i++) {
    const n = 1 + (i * 7) % 9;
    const s = Array.from({ length: n }, (_, j) => words[(i * 13 + j * 5) % words.length]).join(' ');
    const room = 1 + (i % 30);
    const out = clipWords(s, room);
    if (len(out) > Math.max(room, 1) || !honest(out, s)) bad += 1;
  }
  ok('2,000 made-up labels: never longer than the room, always the label or an honest cut of it', bad === 0, bad);
}

// ── clipToLines ───────────────────────────────────────────────────────────
console.log('clipToLines');
{
  ok('words that fit on the lines are as they are', clipToLines('Books lent to children', 3.6, 40, 2) === 'Books lent to children');
  const long = 'Students who passed every single exam this year in all six schools';
  const two = clipToLines(long, 3.4, 26, 2);
  ok('words that need more lines keep what fits and end in an ellipsis', two.endsWith(ELLIPSIS) && honest(two, long), two);
  ok('one line asked for gives one line’s worth', clipToLines(long, 3.4, 26, 1).length < two.length);
  ok('nothing in, nothing out', clipToLines('', 3, 20, 2) === '' && clipToLines('word', 0, 20, 2) === 'word');
}

// ── labels under figures and rings ────────────────────────────────────────
console.log('labels under figures and rings');
{
  ok('a chart keeps 24 characters of a label, cut at a word', itemsOf('Villages visited by the bus: 96', 3)[0].label === `Villages visited by the${ELLIPSIS}`);
  ok('a wrapped label keeps the reader’s 40', WRAPPED_LABEL === 40 && itemsOf('Villages visited by the bus: 96', 3, '', WRAPPED_LABEL)[0].label === 'Villages visited by the bus');

  const statsWords = 'Books lent to children: 184500\nVolunteer reading hours: 12750\nVillages visited by the bus: 96';
  const stats = by(build('stats', 'en', 'landscape', { title: 'A decade in numbers', items: statsWords }));
  ok('three figures: "Villages visited by the bus" is drawn whole (it lost "bus" without a sign)', stats['label-3'].text.replace(/\n/g, ' ') === 'Villages visited by the bus', stats['label-3'].text);

  const rings = 'Attendance across the term: 92%\nHomework handed in on time: 78%\nStudents who passed every exam: 85%\nGroup projects finished: 64%';
  const ringsAr = 'الحضور طوال الفصل: 92%\nالطلاب الناجحون في كل الامتحانات: 85%';
  const bad = [];
  for (const format of FORMATS) for (const [lang, items] of [['en', rings], ['ar', ringsAr]]) {
    const doc = build('progress-stats', lang, format, { title: 'This term', items });
    const wholes = items.split('\n').map((l) => l.slice(0, l.lastIndexOf(':')));
    doc.layers.filter((l) => /-label-\d$/.test(l.id)).forEach((l, i) => { if (!honest(l.text, wholes[i])) bad.push(`${format}/${lang}: ${l.text}`); });
  }
  ok('progress rings: every label is whole or shortened at a word with an ellipsis, in every shape ("Attendance across the te" was not)', !bad.length, bad.slice(0, 3));
  const whole = by(build('progress-stats', 'en', 'landscape', { title: 'x', items: rings }));
  ok('progress rings: on the wide frame the four long labels are drawn whole', [1, 2, 3, 4].every((i) => !whole[`label-${i}`].text.includes(ELLIPSIS)));
}

// ── the donut's legend ────────────────────────────────────────────────────
console.log('the donut’s legend');
{
  const items = 'Salaries and benefits: 4200\nBuildings and maintenance: 1800\nTeaching materials: 950\nScholarships: 700\nResearch grants: 640\nEverything else: 310';
  const bad = [];
  for (const format of FORMATS) for (const lang of ['en', 'ar']) {
    const doc = build('donut', lang, format, { title: 'Where the budget goes', items });
    const names = doc.layers.filter((l) => /-name-\d$/.test(l.id));
    const sizes = new Set(names.map((l) => l.size));
    if (sizes.size !== 1) bad.push(`${format}/${lang}: sizes ${[...sizes].join(', ')}`);
    const wholes = items.split('\n').map((l) => l.slice(0, l.lastIndexOf(':')));
    names.forEach((l, i) => { if (!honest(l.text, wholes[i])) bad.push(`${format}/${lang}: "${l.text}"`); });
  }
  ok('every name in a legend is the same size, and whole or shortened at a word with an ellipsis', !bad.length, bad.slice(0, 4));
  const samples = FORMATS.flatMap((f) => LANGS.map((l) => build('donut', l, f).layers.filter((x) => /-name-\d$/.test(x.id)))).flat();
  ok('the samples’ short names are drawn whole and at the legend’s size', samples.every((l) => !l.text.includes(ELLIPSIS)));
}

// ── the countdown’s last word ───────────────────────────────────────────
console.log('the countdown’s last word');
{
  // A lower bound of the word's reach (Latin letters at least half an em, Arabic script's at least 0.4, the ink as the
  // recipe counts it): a word that reaches past the ring even so is certainly outside it. The sizes before the fix
  // ("انطلق" at 0.8 of a number's size) fail it; the real fit was checked by eye in the app's WebKit.
  const bad = [];
  const words = ['GO', "Let's begin!", 'انطلق', 'لنبدأ الآن!', 'دەست پێبکە'];
  for (const format of FORMATS) for (const lang of LANGS) for (const final of words) {
    const d = by(build('countdown', lang, format, { from: '3', final }));
    const R = d.track.w;
    const arabic = /[؀-ۿ]/.test(final);
    const n = d.final.text.split('\n').length;
    const widest = Math.max(...d.final.text.split('\n').map((s) => Array.from(s.replace(/\s/g, '')).length)) * (arabic ? 0.4 : 0.5);
    const tall = (n - 1) * d.final.lead + (arabic ? 1.3 : /[a-z]/.test(final) ? 1 : 0.76);
    const reach = Math.hypot(widest, tall) * d.final.size;
    if (reach > R * 0.9) bad.push(`${format}/${lang} "${final}": ${reach.toFixed(1)}u in a ${R}u ring`);
  }
  ok('the last word, in Latin or Arabic script, one line or two, fits inside the ring it bursts from', !bad.length, bad.slice(0, 4));
  const go = by(build('countdown', 'en', 'landscape'));
  ok('"GO" keeps its size: 0.8 of a number’s', Math.abs(go.final.size - go.n3.size * 0.8) < 0.01, [go.final.size, go.n3.size]);
}

// ── kinetic type ──────────────────────────────────────────────────────────
console.log('kinetic type');
{
  const lead = (title, highlight, format) => by(build('kinetic', 'en', format, { title, highlight })).title.lead;
  ok('a comma on the line above the lit word opens the lines so it cannot touch the box', FORMATS.every((f) => lead('Start small, dream big', 'big', f) >= 1.1));
  ok('without one, the capitals stay tight', FORMATS.every((f) => lead('Start small and dream big', 'big', f) === 0.98));
  ok('Arabic keeps its own leading', by(build('kinetic', 'ar', 'portrait')).title.lead === 1.28);
}

// ── the split reveal ──────────────────────────────────────────────────────
console.log('the split reveal');
{
  const d = by(build('split-title', 'en', 'portrait'));
  ok('the lower panel is the second accent, solid (it was the accent at 55%, which read as mud)', d['panel-bottom'].fill === 'accent2' && d['panel-bottom'].opacity === 1);
  const flat = PALETTES.filter((p) => contrast(p.colors.accent, p.colors.accent2) < 1.05).map((p) => p.id);
  ok('in every palette the two panels are two colours', flat.length === 0, flat);
  const opening = d['opening-top'].h + d['opening-bottom'].h;
  ok('on the tall frame the words and their band are the larger share of the middle', d.title.size >= 13 && opening > 50, [d.title.size, opening]);
}

// ── headlines and the device ──────────────────────────────────────────────
console.log('headlines and the device');
{
  const wide = by(build('ui-device', 'en', 'landscape'));
  ok('the device’s headline breaks "Your studio, / in your pocket", never ending a line on "in"', wide.title.text === 'Your studio,\nin your pocket', wide.title.text);
  const lines = by(build('ui-device', 'en', 'landscape', { title: 'A short guide to the city of lights', subtitle: '', screen: 'Go' })).title.text.split('\n');
  const weak = /\b(a|an|the|in|of|to|on|at|by|for|and|or|with|from|your|our|my)$/i;
  ok('no line but the last ends on a little word when another break fits', lines.slice(0, -1).every((l) => !weak.test(l)), lines);
  const bad = [];
  for (const format of ['portrait', 'square', 'feed']) {
    const w = by(build('ui-device', 'en', format, { title: 'Studio', subtitle: '', screen: 'Noor Studio Pro' }))['screen-word'];
    if (!w || w.text.includes(ELLIPSIS) || w.text.replace(/\n/g, ' ') !== 'Noor Studio Pro') bad.push(`${format}: ${w?.text}`);
  }
  ok('a three-word name on a phone’s screen takes two lines rather than "Noor…"', !bad.length, bad);
  const fields = META['ui-device'].fields.map((f) => f.key).join();
  ok('the device keeps its fields', fields === 'title,subtitle,screen');
}

// ── nothing decorative left alone ─────────────────────────────────────────
console.log('nothing decorative left alone');
{
  const empty = (id) => Object.fromEntries(META[id].fields.map((f) => [f.key, '']));
  const bt = by(build('big-title', 'en', 'landscape', empty('big-title')));
  ok('big title with every field cleared: no rule in the middle of nothing', !bt['rule-start'] && !bt['rule-end']);
  const bt2 = by(build('big-title', 'en', 'landscape'));
  ok('… and with a headline, the rule under it', !!bt2['rule-start'] && !!bt2['rule-end']);
  const kk = by(build('lt-kicker', 'en', 'landscape', { kicker: 'Guest', name: '', role: 'Climate scientist' }));
  ok('kicker and name with the name cleared: no underline under nothing', !kk.underline && !!kk.role);
  ok('… and with a name, the underline as long as it', !!by(build('lt-kicker', 'en', 'landscape')).underline);
}

// ── icons and words ───────────────────────────────────────────────────────
console.log('icons and words');
{
  ok('villages and towns are places, in English and Arabic', iconFor('Villages visited by the bus', 2) === 'pin' && iconFor('قرى زارتها الحافلة', 2) === 'pin' && iconFor('Towns', 0) === 'pin');
  ok('volunteer hours are people in both languages, as the English already was', iconFor('Volunteer reading hours', 1) === 'users' && iconFor('ساعات قراءة تطوعية', 1) === 'users');
  const icon = (items) => by(build('ui-notify', 'ar', 'landscape', { items }))['card-1-icon'].icon;
  ok('a notification: Arabic plurals and hamza-less spellings pick the right icon', icon('3 رسائل جديدة: من لانا') === 'chat'
    && icon('اعجاب جديد: بمنشورك') === 'heart'
    && icon('فاز فريقك: المركز الأول') === 'trophy'
    && icon('تم التأكيد: الحجز جاهز') === 'check');
  ok('"تدقيق" (an audit) is not a clock any more', icon('تدقيق الحسابات: اكتمل') !== 'clock');
}

// ── Arabic terms ──────────────────────────────────────────────────────────
console.log('Arabic terms');
{
  const src = readFileSync(new URL('../src/i18n.ts', import.meta.url), 'utf8');
  const ar = src.slice(src.indexOf('const ar: Dict = {'), src.indexOf('const ckb: Dict = {'));
  const entries = [...ar.matchAll(/^ {2}'((?:[^'\\]|\\.)+)':\s*'((?:[^'\\]|\\.)*)',/gm)].map((m) => [m[1], m[2]]);
  const ring = entries.find(([k]) => k === 'Ring')?.[1];
  const clash = entries.filter(([k, v]) => /\bloops?\b/i.test(k) && ring && v.includes(ring)).map(([k]) => k);
  ok('no "loop" is called by the word the app uses for a ring', ring === 'حلقة' && !clash.length, clash);
  const fps = entries.find(([k]) => k === '{n} frames a second')?.[1] ?? '';
  ok('"{n} frames a second" reads right for 6, 8 and 10 as well as 15 (no accusative singular after the number)', fps.includes('{n}') && !fps.includes('إطاراً'), fps);
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - started) / 1000).toFixed(1)} s)`);
if (fail) process.exit(1);
