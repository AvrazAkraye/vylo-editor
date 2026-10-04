// The ready messages, first half (docs/wa/templates.md): the rules every message of `whatsapptemplates-a.ts`
// keeps, and the categories and tables of the API around it.
//
// What matters, in order:
//
//   1. A message never says what the sender did not. No digit, no percent sign, no currency, no "free", "win"
//      or "guaranteed" in any language: a price, a deadline and a discount are placeholders, so a ready
//      message cannot promise hundreds of people something the shop is not giving.
//   2. The four languages are the same message. Each uses exactly the placeholders in `vars` — a `{date}` in
//      English that Sorani forgot would go out as a sentence with a hole in it — and the same emoji.
//   3. The right-to-left languages read right: no stray Latin letter outside a placeholder, no Arabic letter
//      glued to one (لـ{business} breaks when the name is filled), Arabic written in Arabic letters, Sorani
//      and Badini in Kurdish ones, and neither dialect leaking into the other.
//   4. It reads like a message, not a poster: at most three emoji, none in a service message, no opt-out line
//      (the engine adds one), balanced WhatsApp bold, nothing over 700 characters.
//   5. The library is pinned: the exact count per category, so a deletion fails here before a person notices
//      their favourite Eid greeting is gone.
//
// The content checks run over TEMPLATES_A only: `templates-b` writes the other half in parallel and holds its
// own half to the same rules in wa-templates-b.test.mjs. The API checks (categories, lookup, the order of
// TEMPLATES) hold whether or not that half has arrived.
import { TEMPLATES_A } from '../.test-build/whatsapptemplates-a.js';
import { TEMPLATES_B } from '../.test-build/whatsapptemplates-b.js';
import {
  CATEGORIES, TEMPLATES, TEMPLATE_LANGS, PLACEHOLDERS, PLACEHOLDER_TITLES, TAG_WORDS,
  categoryById, templateById, placeholdersIn, blanksOf,
} from '../.test-build/whatsapptemplates.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); }
}
/** The ids of whatever fails a check, for the detail line: the first few are enough to find the rest. */
const which = (xs) => xs.slice(0, 8).join(', ') + (xs.length > 8 ? ` … (${xs.length})` : '');

const LANGS = ['en', 'ar', 'ckb', 'kmr'];
const RTL = ['ar', 'ckb', 'kmr'];
const ALL_CATEGORIES = [
  'sale', 'new', 'code', 'flash', 'restock', 'event', 'opening', 'appointment', 'followup', 'review', 'loyalty', 'birthday', 'holiday',
  'order', 'delivery', 'payment', 'cart', 'welcome', 'course', 'health', 'property', 'food', 'verify', 'notice', 'survey', 'referral',
];
const A_CATEGORIES = ALL_CATEGORIES.slice(0, 13);
const ICONS = 'file folder search chat memory settings plus check warning sparkle attach send star play flame calendar list grid clock link bolt image camera clipboard film person shield'.split(' ');
const BRIEF_PLACEHOLDERS = ['name', 'business', 'offer', 'price', 'old_price', 'discount', 'code', 'date', 'time', 'place', 'address', 'link', 'phone', 'product', 'service', 'hours', 'points', 'days'];

/** Every `{…}` in a text, whatever is inside: wider than the API's own reader on purpose, so `{ Name }` is caught. */
const bracesIn = (s) => [...s.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
const withoutSlots = (s) => s.replace(/\{[a-z_]+\}/g, '');
const EMOJI = /\p{Extended_Pictographic}/gu;
const emojiOf = (s) => s.match(EMOJI) ?? [];
const LATIN = /[A-Za-z]/;
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

// ── the categories ─────────────────────────────────────────────────────────

ok('there are 26 categories', CATEGORIES.length === 26, CATEGORIES.length);
ok('the categories are exactly the CategoryId names, each once', sameSet(CATEGORIES.map((c) => c.id), ALL_CATEGORIES) && new Set(CATEGORIES.map((c) => c.id)).size === 26);
ok('selling comes first: sale, new, flash and code open the list', CATEGORIES.slice(0, 4).map((c) => c.id).join() === 'sale,new,flash,code');
for (const c of CATEGORIES) {
  ok(`category ${c.id}: a title in each of the four languages`, LANGS.every((l) => typeof c.title[l] === 'string' && c.title[l].trim().length > 0));
}
ok('every category icon is one the brief lists', CATEGORIES.every((c) => ICONS.includes(c.icon)), which(CATEGORIES.filter((c) => !ICONS.includes(c.icon)).map((c) => `${c.id}:${c.icon}`)));
ok('no two categories share an icon', new Set(CATEGORIES.map((c) => c.icon)).size === CATEGORIES.length);
ok('category titles in Arabic, Sorani and Badini have no Latin letters', CATEGORIES.every((c) => RTL.every((l) => !LATIN.test(c.title[l]))));
ok('category titles are short enough for a chip (≤ 24 characters)', CATEGORIES.every((c) => LANGS.every((l) => c.title[l].length <= 24)),
  which(CATEGORIES.flatMap((c) => LANGS.filter((l) => c.title[l].length > 24).map((l) => `${c.id}.${l}`))));
ok('categoryById finds every category', CATEGORIES.every((c) => categoryById(c.id) === c));
ok('categoryById answers nothing for junk', [undefined, null, 7, {}, 'SALE', 'nope', ''].every((x) => categoryById(x) === undefined));

// ── the library: A then B ──────────────────────────────────────────────────

ok('TEMPLATES is the first half, then the second, in order',
  TEMPLATES.length === TEMPLATES_A.length + TEMPLATES_B.length
  && TEMPLATES.every((t, i) => t.id === (i < TEMPLATES_A.length ? TEMPLATES_A[i] : TEMPLATES_B[i - TEMPLATES_A.length]).id));
ok('TEMPLATE_LANGS is the four languages', TEMPLATE_LANGS.join() === LANGS.join());
ok('ids are unique across both halves', new Set(TEMPLATES.map((t) => t.id)).size === TEMPLATES.length);
ok('templateById finds every message of the first half', TEMPLATES_A.every((t) => templateById(t.id)?.id === t.id));
ok('templateById answers nothing for an unknown id or a non-string', [undefined, null, 1, {}, 'sale-0', 'SALE-1', ' sale-1'].every((x) => templateById(x) === undefined));

// ── the snapshot ───────────────────────────────────────────────────────────

const PINNED = { sale: 4, new: 3, code: 3, flash: 3, restock: 3, event: 3, opening: 3, appointment: 4, followup: 3, review: 3, loyalty: 3, birthday: 3, holiday: 9 };
const counts = Object.fromEntries(A_CATEGORIES.map((c) => [c, TEMPLATES_A.filter((t) => t.category === c).length]));
ok('the first half holds exactly 47 messages', TEMPLATES_A.length === 47, TEMPLATES_A.length);
ok('at least 40 messages, as the brief asks', TEMPLATES_A.length >= 40);
for (const c of A_CATEGORIES) ok(`category ${c}: ${PINNED[c]} messages, as pinned (at least 3)`, counts[c] === PINNED[c] && counts[c] >= 3, counts[c]);
ok('the first half uses only its own thirteen categories', TEMPLATES_A.every((t) => A_CATEGORIES.includes(t.category)), which(TEMPLATES_A.filter((t) => !A_CATEGORIES.includes(t.category)).map((t) => t.id)));
ok('ids are category-n, numbered from 1 without gaps, in order',
  A_CATEGORIES.every((c) => TEMPLATES_A.filter((t) => t.category === c).every((t, i) => t.id === `${c}-${i + 1}`)));
ok('the first half lists its categories in one block each', TEMPLATES_A.every((t, i) => i === 0 || t.category === TEMPLATES_A[i - 1].category || !TEMPLATES_A.slice(0, i).some((p) => p.category === t.category)));

// ── each message ───────────────────────────────────────────────────────────

for (const t of TEMPLATES_A) {
  const four = LANGS.every((l) => typeof t.title?.[l] === 'string' && t.title[l].trim() && typeof t.text?.[l] === 'string' && t.text[l].trim());
  ok(`${t.id}: a title and a text in all four languages`, four);
  if (!four) continue;
  const found = LANGS.map((l) => bracesIn(t.text[l]));
  ok(`${t.id}: vars are exactly the placeholders of each language`,
    new Set(t.vars).size === t.vars.length && found.every((f) => sameSet([...new Set(f)], t.vars)),
    LANGS.map((l, i) => `${l}: ${[...new Set(found[i])].join(',')}`).join(' / '));
  ok(`${t.id}: the four languages carry the same emoji`, LANGS.every((l) => emojiOf(t.text[l]).join('') === emojiOf(t.text.en).join('')),
    LANGS.map((l) => `${l}:${emojiOf(t.text[l]).join('')}`).join(' '));
}

const texts = TEMPLATES_A.flatMap((t) => LANGS.map((l) => ({ t, l, s: t.text[l] })));
const titles = TEMPLATES_A.flatMap((t) => LANGS.map((l) => ({ t, l, s: t.title[l] })));
const bad = (xs, pred) => xs.filter(pred).map(({ t, l }) => `${t.id}.${l}`);

ok('every kind is promo, service or greeting', TEMPLATES_A.every((t) => ['promo', 'service', 'greeting'].includes(t.kind)));
ok('every holiday message is a greeting', TEMPLATES_A.filter((t) => t.category === 'holiday').every((t) => t.kind === 'greeting'));
ok('sales, codes, flash sales and openings are promotions', TEMPLATES_A.filter((t) => ['sale', 'code', 'flash', 'opening', 'new'].includes(t.category)).every((t) => t.kind === 'promo'));
ok('reminders, follow-ups and reviews are service messages', TEMPLATES_A.filter((t) => ['followup', 'review'].includes(t.category) || t.id === 'appointment-1').every((t) => t.kind === 'service'));
ok('each of the three kinds is used', ['promo', 'service', 'greeting'].every((k) => TEMPLATES_A.some((t) => t.kind === k)));

ok('only the brief\'s placeholders are used', texts.every(({ s }) => bracesIn(s).every((p) => BRIEF_PLACEHOLDERS.includes(p))),
  which(texts.flatMap(({ t, l, s }) => bracesIn(s).filter((p) => !BRIEF_PLACEHOLDERS.includes(p)).map((p) => `${t.id}.${l}:{${p}}`))));
ok('no brace outside a well-formed placeholder', texts.every(({ s }) => !/[{}]/.test(withoutSlots(s))), which(bad(texts, ({ s }) => /[{}]/.test(withoutSlots(s)))));
ok('no engine syntax in the library ({name|…} or [[a|b]])', texts.every(({ s }) => !s.includes('|') && !s.includes('[[')));
ok('titles hold no placeholder', titles.every(({ s }) => !/[{}]/.test(s)));
ok('every message greets or signs with a placeholder (none is a bare slogan)', TEMPLATES_A.every((t) => t.vars.length > 0));
ok('a sender fills at most six blanks', TEMPLATES_A.every((t) => blanksOf(t).length <= 6), which(TEMPLATES_A.filter((t) => blanksOf(t).length > 6).map((t) => t.id)));

ok('no text is over 700 characters', texts.every(({ s }) => s.length <= 700), which(bad(texts, ({ s }) => s.length > 700)));
ok('most texts are under 400 characters (at least nine in ten)', texts.filter(({ s }) => s.length < 400).length >= texts.length * 0.9,
  `${texts.filter(({ s }) => s.length < 400).length} of ${texts.length}`);
ok('titles are short (≤ 40 characters)', titles.every(({ s }) => s.length <= 40), which(bad(titles, ({ s }) => s.length > 40)));

// 1. No fact the sender did not give.
const DIGIT = /[0-9\u0660-\u0669\u06F0-\u06F9]/;
ok('no digit in any text or title, in any numeral system', [...texts, ...titles].every(({ s }) => !DIGIT.test(s)), which(bad([...texts, ...titles], ({ s }) => DIGIT.test(s))));
ok('no percent sign and no currency', texts.every(({ s }) => !/[%٪$€£¥]|\b(usd|iqd|dollars?)\b|دينار|دولار|دۆلار|دینار/i.test(s)));
ok('no web address written into a text', texts.every(({ s }) => !/https?:|www\./i.test(s)));
const PROMISES = {
  en: /\b(win|wins|winner|winning|free|guarantee[sd]?|risk[- ]free|cash prize|act now|cure[sd]?|miracle|diagnos\w*|only \w+ left)\b/i,
  ar: /مجان|مضمون|اربح|ربح|جائزة|جوائز|علاج|شفاء/,
  ckb: /بێبەرامبەر|بەخۆڕایی|گەرەنتی|خەڵات|براوە|چارەسەر/,
  kmr: /بێ بەرامبەر|بێبەرامبەر|گەرەنتی|خەلات|سەرکەفتی بە|چارەسەر/,
};
ok('no "free", "win", "guaranteed" or cure in any language', texts.every(({ l, s }) => !PROMISES[l].test(s)), which(bad(texts, ({ l, s }) => PROMISES[l].test(s))));

// 3. The right-to-left languages.
const rtl = texts.filter(({ l }) => RTL.includes(l));
ok('no Latin letter in Arabic, Sorani or Badini outside a placeholder', rtl.every(({ s }) => !LATIN.test(withoutSlots(s))), which(bad(rtl, ({ s }) => LATIN.test(withoutSlots(s)))));
ok('no letter glued to a placeholder (punctuation may touch it)', rtl.every(({ s }) => !/\p{L}\{|\}\p{L}/u.test(s)), which(bad(rtl, ({ s }) => /\p{L}\{|\}\p{L}/u.test(s))));
ok('Arabic is written in Arabic letters (no ی ک ە ێ ۆ ڕ ڵ ڤ گ پ چ ژ)', texts.filter(({ l }) => l === 'ar').every(({ s }) => !/[\u06CC\u06A9\u06D5\u06CE\u06C6\u0695\u06B5\u06A4\u06AF\u067E\u0686\u0698]/.test(s)));
ok('Sorani and Badini use the Kurdish ی and ک, never ي ك ة', texts.filter(({ l }) => l === 'ckb' || l === 'kmr').every(({ s }) => !/[\u064A\u0643\u0629]/.test(s)),
  which(bad(texts.filter(({ l }) => l === 'ckb' || l === 'kmr'), ({ s }) => /[\u064A\u0643\u0629]/.test(s))));
// A pasted line of the wrong dialect is the likeliest slip when two Kurdish texts sit side by side.
ok('Sorani has no Badini ڤ and no bare ل / ژ / د prepositions', texts.filter(({ l }) => l === 'ckb').every(({ s }) => !/\u06A4|(^|\s)(ل|ژ|د)(\s)/.test(s)),
  which(bad(texts.filter(({ l }) => l === 'ckb'), ({ s }) => /\u06A4|(^|\s)(ل|ژ|د)(\s)/.test(s))));
ok('Badini has no Sorani ڵ, لە, ئەمڕۆ or ئێستا', texts.filter(({ l }) => l === 'kmr').every(({ s }) => !/\u06B5|(^|\s)لە(\s)|ئەمڕۆ|ئێستا/.test(s)),
  which(bad(texts.filter(({ l }) => l === 'kmr'), ({ s }) => /\u06B5|(^|\s)لە(\s)|ئەمڕۆ|ئێستا/.test(s))));
ok('Arabic punctuation in the right-to-left texts (، not a Latin comma)', rtl.every(({ s }) => !s.includes(',')), which(bad(rtl, ({ s }) => s.includes(','))));

// 4. Reads like a message.
const ALLOWED_EMOJI = new Set([...'🛍🎉🌙✨🎁⚡⏰🧺📍🎂🎈🔥🌷💐📚⭐🎄']);
const OFFENSIVE = /[\u{1F44D}\u{1F44C}\u{1F91E}\u{1F595}\u{1F44E}\u{1F377}\u{1F37A}\u{1F37B}\u{1F378}\u{1F942}\u{1F437}\u{1F416}\u{1F953}]/u;
ok('at most three emoji in a text', texts.every(({ s }) => emojiOf(s).length <= 3), which(bad(texts, ({ s }) => emojiOf(s).length > 3)));
ok('only the chosen emoji (no hand gestures, no alcohol, no pork)', texts.every(({ s }) => emojiOf(s).every((e) => ALLOWED_EMOJI.has(e)) && !OFFENSIVE.test(s)),
  which(bad(texts, ({ s }) => !emojiOf(s).every((e) => ALLOWED_EMOJI.has(e)))));
ok('no emoji in a service message', texts.filter(({ t }) => t.kind === 'service').every(({ s }) => emojiOf(s).length === 0));
ok('no emoji in a title', titles.every(({ s }) => emojiOf(s).length === 0));
const OPT_OUT = /\bstop\b|unsubscribe|opt[- ]out|إيقاف|إلغاء الاشتراك|وەستان|ڕاگرتن|بوەستینە/i;
ok('no opt-out line written into a promotion (the engine adds it)', texts.filter(({ t }) => t.kind === 'promo').every(({ s }) => !OPT_OUT.test(s)));
ok('WhatsApp bold is balanced', texts.every(({ s }) => (s.match(/\*/g) ?? []).length % 2 === 0), which(bad(texts, ({ s }) => (s.match(/\*/g) ?? []).length % 2 !== 0)));
ok('bold used sparingly (at most two spans)', texts.every(({ s }) => (s.match(/\*/g) ?? []).length <= 4));
ok('no italic, strike or monospace markers', texts.every(({ s }) => !/[_~`]/.test(withoutSlots(s))));
ok('no space at either end of a line, no double space', texts.every(({ s }) => s.split('\n').every((line) => line === line.trim() && !line.includes('  '))),
  which(bad(texts, ({ s }) => !s.split('\n').every((line) => line === line.trim() && !line.includes('  ')))));
ok('no text starts or ends with a blank line, none has two blank lines running', texts.every(({ s }) => s === s.trim() && !s.includes('\n\n\n')));
ok('a promotion with a link has it on its own or after a colon', texts.filter(({ s }) => s.includes('{link}')).every(({ s }) => /(^|\n|: )\{link\}/.test(s)));

// Tags.
ok('every message has a tag or more', TEMPLATES_A.every((t) => Array.isArray(t.tags) && t.tags.length > 0));
ok('tags are lowercase words joined by hyphens', TEMPLATES_A.every((t) => t.tags.every((g) => /^[a-z]+(-[a-z]+)*$/.test(g))));
ok('no tag repeats within a message', TEMPLATES_A.every((t) => new Set(t.tags).size === t.tags.length));
ok('every tag of the first half is searchable in four languages (in TAG_WORDS)', TEMPLATES_A.every((t) => t.tags.every((g) => g in TAG_WORDS)),
  which([...new Set(TEMPLATES_A.flatMap((t) => t.tags.filter((g) => !(g in TAG_WORDS))))]));
ok('the brief\'s kinds of business are covered by tags', ['shop', 'restaurant', 'clinic', 'school', 'salon', 'real-estate', 'online-store'].every((g) => TEMPLATES_A.some((t) => t.tags.includes(g))));
ok('the brief\'s holidays are all here', ['eid-al-fitr', 'eid-al-adha', 'ramadan', 'newroz', 'new-year', 'mothers-day', 'teachers-day', 'thanks'].every((g) => TEMPLATES_A.some((t) => t.category === 'holiday' && t.tags.includes(g))));

// ── the tables ─────────────────────────────────────────────────────────────

ok('PLACEHOLDERS is the brief\'s list, in its order', PLACEHOLDERS.join() === BRIEF_PLACEHOLDERS.join());
ok('every placeholder has a label in four languages', PLACEHOLDERS.every((p) => LANGS.every((l) => typeof PLACEHOLDER_TITLES[p]?.[l] === 'string' && PLACEHOLDER_TITLES[p][l].trim())));
ok('no label for a placeholder that does not exist', Object.keys(PLACEHOLDER_TITLES).every((p) => PLACEHOLDERS.includes(p)));
ok('placeholder labels in the right-to-left languages have no Latin letters', PLACEHOLDERS.every((p) => RTL.every((l) => !LATIN.test(PLACEHOLDER_TITLES[p][l]))));
ok('every TAG_WORDS entry has words in four languages', Object.values(TAG_WORDS).every((w) => LANGS.every((l) => typeof w[l] === 'string' && w[l].trim())));
ok('TAG_WORDS in the right-to-left languages have no Latin letters', Object.values(TAG_WORDS).every((w) => RTL.every((l) => !LATIN.test(w[l]))));

// ── the small readers ──────────────────────────────────────────────────────

ok('placeholdersIn: each once, in order', placeholdersIn('{a} {b} {a} {c}').join() === 'a,b,c');
ok('placeholdersIn: the engine\'s {name|fallback} is not one of these', placeholdersIn('Hi {name|friend}, {offer}').join() === 'offer');
ok('placeholdersIn: a lone brace swallows nothing', placeholdersIn('50% { off {offer} and } more').join() === 'offer');
ok('placeholdersIn: not a string, no placeholders', [null, undefined, 5, {}, ['{a}']].every((x) => placeholdersIn(x).length === 0));
ok('placeholdersIn agrees with vars for every message of the first half', TEMPLATES_A.every((t) => LANGS.every((l) => sameSet(placeholdersIn(t.text[l]), t.vars))));
ok('blanksOf leaves {name} to the engine', blanksOf(templateById('sale-1')).join() === 'business,discount,product,date,link');
ok('blanksOf of a greeting signed by the business is one blank', blanksOf(templateById('holiday-1')).join() === 'business');
ok('blanksOf of nothing is nothing', blanksOf(undefined).length === 0 && blanksOf({}).length === 0 && blanksOf({ vars: 'x' }).length === 0);

// ── the library cannot be changed by a screen ──────────────────────────────

const throwsOn = (f) => { try { f(); return false; } catch { return true; } };
ok('a message\'s text cannot be rewritten in place', throwsOn(() => { TEMPLATES[0].text.en = 'changed'; }) && TEMPLATES[0].text.en !== 'changed');
ok('a message\'s vars and tags cannot be pushed to', throwsOn(() => TEMPLATES[0].vars.push('x')) && throwsOn(() => TEMPLATES[0].tags.push('x')));
ok('the list itself cannot be pushed to', throwsOn(() => TEMPLATES.push(TEMPLATES[0])));
ok('a category title cannot be rewritten', throwsOn(() => { CATEGORIES[0].title.en = 'x'; }));
ok('the placeholder list cannot be pushed to', throwsOn(() => PLACEHOLDERS.push('x')));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
