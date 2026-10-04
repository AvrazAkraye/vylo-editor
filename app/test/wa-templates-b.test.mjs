// Package `templates-b` (docs/WA.md, docs/wa/briefs/templates-b.md): the second half of the ready
// messages, `TEMPLATES_B` in whatsapptemplates-b.ts. Content only, so these are content checks.
//
// What matters, in order:
//
//   1. Nothing factual is invented. A ready message is sent to hundreds of people under the
//      sender's name: a price, a date, a percentage or a deadline written into the library would be
//      a promise the sender never made. So the texts hold no digits at all (Latin, Arabic-Indic or
//      Persian), no "%", no English number words; every fact is a {placeholder}.
//   2. The placeholders are exact. Only the eighteen names the brief allows; `vars` is exactly the
//      set each language uses, and the four languages use the same set (a Sorani text that forgot
//      {date} would send a reminder without the day); braces balance.
//   3. Codes look like codes. Every `verify` message carries {code} and the same "do not share this
//      code with anyone" sentence in all four languages, word for word, and no emoji; nor do notices,
//      payments or clinic messages. Payment texts never threaten; clinic texts never diagnose or
//      frighten; promotions carry no opt-out line (the engine adds one) and no false pressure.
//   4. The scripts are clean. Arabic, Sorani and Badini have no stray Latin letters besides the
//      placeholders; Arabic has none of the Kurdish/Persian letters (ی ک ە ێ …) and Kurdish none of
//      the Arabic ones (ي ك ة ى) — the mixed-keyboard typo that looks right and searches wrong; the
//      right-to-left texts use the Arabic comma and question mark.
//   5. The library is stable: a snapshot of the ids, so an accidental deletion or rename fails here.
//
// Search and filling are the API's (whatsapptemplates.ts, `templates-a`) and are tested there over
// the merged library; this file reads `TEMPLATES_B` alone, as the brief asks. The only "reader" here
// is a fill with the longest values a file's column may hold, to show every message stays inside
// the engine's limit whatever it is filled with.
import { TEMPLATES_B } from '../.test-build/whatsapptemplates-b.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const J = (x) => JSON.stringify(x);

const LANGS = ['en', 'ar', 'ckb', 'kmr'];
const RTL = ['ar', 'ckb', 'kmr'];

/** The placeholders the brief allows (templates-a.md), and nothing else. */
const KNOWN = new Set([
  'name', 'business', 'offer', 'price', 'old_price', 'discount', 'code', 'date', 'time', 'place',
  'address', 'link', 'phone', 'product', 'service', 'hours', 'points', 'days',
]);

/** Mine, in the brief's order; the other thirteen are `templates-a`'s. */
const MINE = ['order', 'delivery', 'payment', 'cart', 'welcome', 'course', 'health', 'property', 'food', 'verify', 'notice', 'survey', 'referral'];
const THEIRS = ['sale', 'new', 'code', 'flash', 'restock', 'event', 'opening', 'appointment', 'followup', 'review', 'loyalty', 'birthday', 'holiday'];

/** The kind each category's messages take (brief); `course` is a promotion when it advertises, a service when it reminds. */
const KIND = {
  order: ['service'], delivery: ['service'], payment: ['service'], verify: ['service'], notice: ['service'], health: ['service'],
  survey: ['service'], cart: ['promo'], food: ['promo'], property: ['promo'], referral: ['promo'], welcome: ['greeting'],
  course: ['promo', 'service'],
};

/**
 * The snapshot. A change to the library changes this line on purpose; a deletion by accident fails.
 * 52 templates: order 4, delivery 4, payment 4, cart 3, welcome 4, course 4, health 4, property 4,
 * food 5, verify 5, notice 5, survey 3, referral 3.
 */
const SNAPSHOT = 'cart-1 cart-2 cart-3 course-1 course-2 course-3 course-4 delivery-1 delivery-2 delivery-3 delivery-4 food-1 food-2 food-3 food-4 food-5 health-1 health-2 health-3 health-4 notice-1 notice-2 notice-3 notice-4 notice-5 order-1 order-2 order-3 order-4 payment-1 payment-2 payment-3 payment-4 property-1 property-2 property-3 property-4 referral-1 referral-2 referral-3 survey-1 survey-2 survey-3 verify-1 verify-2 verify-3 verify-4 verify-5 welcome-1 welcome-2 welcome-3 welcome-4';

/** The "do not share" sentence, word for word, in each language (whatsapptemplates-b.ts, verify). */
const DO_NOT_SHARE = {
  en: /do not share this code with anyone/i,
  ar: 'لا تشارك هذا الرمز مع أي شخص',
  ckb: 'ئەم کۆدە لەگەڵ هیچ کەسێک هاوبەش مەکە',
  kmr: 'ڤی کۆدی دگەل چ کەسێ پارڤە نەکە',
};
const has = (text, needle) => (typeof needle === 'string' ? text.includes(needle) : needle.test(text));

const PLACEHOLDER = /\{([^{}]*)\}/g;
const placeholders = (s) => [...s.matchAll(PLACEHOLDER)].map((m) => m[1]);
const strip = (s) => s.replace(PLACEHOLDER, '');
const emoji = (s) => s.match(/\p{Extended_Pictographic}/gu) ?? [];
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/** Letters that belong to Kurdish (and Persian) and never to Arabic, and the reverse. */
const KURDISH_ONLY = /[یکەێڕڵۆڤپچژگھ]/u; // ی ک ە ێ ڕ ڵ ۆ ڤ پ چ ژ گ ھ
const ARABIC_ONLY = /[يكةى]/u; // ي ك ة ى
const HARAKAT = /[ً-ْ]/u;
const DIGITS = /[0-9٠-٩۰-۹%٪]/u;
const NUMBER_WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|fifty|hundred|thousand|million|half|percent|dozen)\b/i;

/** Words a ready message must never use, by language (brief: no "win", "free money", "guaranteed"; no medical claims; no threats). */
const NEVER = {
  en: /\b(win|wins|winner|free money|guarantee|guaranteed|risk-free|miracle|cure|cures)\b/i,
  ar: /مضمون|اربح|تربح|فوز|معجزة|مجاناً تماماً/u,
  ckb: /گەرەنتی|بردنەوە|موعجیزە/u,
  kmr: /گەرەنتی|بردنەڤە|موعجیزە/u,
};
const HEALTH_NEVER = {
  en: /\b(diagnos\w*|cure\w*|treat\w*|urgent\w*|risk\w*|serious|immediately|worr\w*|abnormal|disease)\b/i,
  ar: /تشخيص|علاج|عاجل|خطر|خطير|فوراً|فورا|مرض|قلق/u,
  ckb: /دەستبەجێ|مەترسی|چارەسەر|نەخۆشی|خێرا/u,
  kmr: /دەستبەجێ|مەترسی|چارەسەر|نەخۆشی|ئێکسەر|لەز/u,
};
const PAYMENT_NEVER = {
  en: /\b(legal|court|penalt\w*|fines?|lawyer|suspend\w*|final notice|cut off|action)\b/i,
  ar: /قانون|محكمة|غرامة|محامي|إيقاف|إجراء/u,
  ckb: /دادگا|سزا|یاسا|پارێزەر|ڕاگرتن/u,
  kmr: /دادگەه|سزا|یاسا|پارێزەر|ڕاوەستاندن/u,
};
const PRESSURE = /\b(last chance|hurry|only \w+ left|today only|ends tonight|expires? (soon|today)|don.t miss)\b/i;
const OPT_OUT = {
  en: /\b(stop|unsubscribe|opt[- ]?out)\b/i,
  ar: /إيقاف|إلغاء الاشتراك/u,
  ckb: /وەستان|ڕاگرتن/u,
  kmr: /ڕاوەستان|بەس بکە/u,
};

// ── 1. the shape of the list ──────────────────────────────────────────────

ok('TEMPLATES_B is an array', Array.isArray(TEMPLATES_B));
ok('at least 40 templates', TEMPLATES_B.length >= 40, TEMPLATES_B.length);
const ids = TEMPLATES_B.map((t) => t.id);
ok('ids are unique', new Set(ids).size === ids.length, ids.filter((x, i) => ids.indexOf(x) !== i));
ok('snapshot: exactly these 52 ids (a deletion or a rename is on purpose, here)', [...ids].sort().join(' ') === SNAPSHOT, [...ids].sort().join(' '));

for (const c of MINE) {
  const n = TEMPLATES_B.filter((t) => t.category === c).length;
  ok(`category ${c} has at least 3 templates`, n >= 3, n);
}
ok('every template is in one of my thirteen categories', TEMPLATES_B.every((t) => MINE.includes(t.category)), TEMPLATES_B.filter((t) => !MINE.includes(t.category)).map((t) => t.id));
ok('none is in one of templates-a’s categories', !TEMPLATES_B.some((t) => THEIRS.includes(t.category)));
ok('the templates of a category sit together, in the brief’s order', (() => {
  const seen = [];
  for (const t of TEMPLATES_B) if (seen[seen.length - 1] !== t.category) seen.push(t.category);
  return J(seen) === J(MINE);
})());

for (const c of MINE) {
  const nums = TEMPLATES_B.filter((t) => t.category === c).map((t) => t.id);
  ok(`${c}: ids are ${c}-1 … ${c}-${nums.length}, in order`, J(nums) === J(nums.map((_, i) => `${c}-${i + 1}`)), nums);
}

// ── 2. every template, every language ─────────────────────────────────────

const counts = { over400: Object.fromEntries(LANGS.map((l) => [l, 0])) };
for (const t of TEMPLATES_B) {
  const id = t.id;
  ok(`${id}: kind fits its category`, (KIND[t.category] ?? []).includes(t.kind), t.kind);
  ok(`${id}: four titles, four texts, nothing else`,
    J(Object.keys(t.title).sort()) === J([...LANGS].sort()) && J(Object.keys(t.text).sort()) === J([...LANGS].sort()));
  ok(`${id}: tags are a few plain lowercase words, no repeats`,
    Array.isArray(t.tags) && t.tags.length >= 2 && t.tags.length <= 6 && new Set(t.tags).size === t.tags.length
    && t.tags.every((g) => /^[a-z][a-z-]*$/.test(g)), t.tags);

  // vars: known names, no repeats, exactly the set each language uses, in the order English meets them
  const vars = new Set(t.vars);
  ok(`${id}: vars are known placeholders, no repeats`, t.vars.length === vars.size && t.vars.every((v) => KNOWN.has(v)), t.vars);
  const firstSeen = [...new Set(placeholders(t.text.en))];
  ok(`${id}: vars are listed in the order the English text uses them`, J(firstSeen) === J(t.vars), firstSeen);

  for (const l of LANGS) {
    const title = t.title[l], text = t.text[l];
    const tag = `${id}/${l}`;
    ok(`${tag}: title and text are non-empty and trimmed`,
      typeof title === 'string' && typeof text === 'string' && title.trim() !== '' && text.trim() !== ''
      && title === title.trim() && text === text.trim());
    ok(`${tag}: title is short (≤ 40) and has no placeholder or emoji`, title.length <= 40 && !/[{}]/.test(title) && emoji(title).length === 0, title);
    const used = new Set(placeholders(text));
    ok(`${tag}: uses exactly vars`, sameSet(used, vars), { used: [...used], vars: t.vars });
    ok(`${tag}: placeholders are plain {name}s (no {a|b}, no [[…]])`,
      placeholders(text).every((p) => /^[a-z_]+$/.test(p)) && !text.includes('[['), placeholders(text));
    ok(`${tag}: braces balance (none left once placeholders are out)`, !/[{}]/.test(strip(text)));
    ok(`${tag}: at most 700 characters`, text.length <= 700, text.length);
    if (text.length > 400) counts.over400[l]++;
    ok(`${tag}: no link written in (links are {link})`, !/https?:|www\.|\.com\b/i.test(text));
    ok(`${tag}: no digit, no percent sign — every number is a placeholder`, !DIGITS.test(strip(text)) && !DIGITS.test(title), strip(text).match(DIGITS));
    ok(`${tag}: no promise words`, !NEVER[l].test(text), text.match(NEVER[l]));
    ok(`${tag}: at most 3 emoji`, emoji(text).length <= 3, emoji(text));
    ok(`${tag}: WhatsApp bold marks pair up`, (text.match(/\*/g) ?? []).length % 2 === 0);
    ok(`${tag}: no doubled spaces, no space at a line’s end, no empty run of lines`,
      !/ {2}/.test(text) && !/ \n/.test(text) && !/\n{3}/.test(text) && !/\t/.test(text));
    if (l === 'en') {
      ok(`${tag}: no number written as a word`, !NUMBER_WORDS.test(text), text.match(NUMBER_WORDS));
    } else {
      ok(`${tag}: no Latin letter outside the placeholders`, !/[A-Za-z]/.test(strip(text)) && !/[A-Za-z]/.test(title), strip(text).match(/[A-Za-z]+/g));
      ok(`${tag}: the Arabic comma and question mark, not the Latin ones`, !/[,?;]/.test(strip(text)) && !/[,?;]/.test(title));
    }
    if (l === 'ar') {
      ok(`${tag}: Arabic letters only (no ی ک ە ێ ڕ ڵ ۆ ڤ …)`, !KURDISH_ONLY.test(text) && !KURDISH_ONLY.test(title), (text + title).match(KURDISH_ONLY));
    }
    if (l === 'ckb' || l === 'kmr') {
      ok(`${tag}: Kurdish letters only (no ي ك ة ى, no harakat)`,
        !ARABIC_ONLY.test(text) && !ARABIC_ONLY.test(title) && !HARAKAT.test(text) && !HARAKAT.test(title), (text + title).match(ARABIC_ONLY) ?? (text + title).match(HARAKAT));
    }
  }

  // positive controls, so the script checks above cannot pass on an empty or misplaced text:
  // Arabic is Arabic, Sorani and Badini are Kurdish, and Sorani and Badini are not the same text
  ok(`${id}/ar: written in Arabic letters`, /[ا-ي]{3}/u.test(strip(t.text.ar)));
  ok(`${id}/ckb, kmr: written in Kurdish letters (ە ێ ۆ ڤ …)`, ['ckb', 'kmr'].every((l) => /[ەێۆڤڕ]/u.test(t.text[l])));
  ok(`${id}: Sorani and Badini are two texts, not one copied`, t.text.ckb !== t.text.kmr);
  ok(`${id}/kmr: Badini, not Sorani (no ڵ, the Sorani dark l)`, !t.text.kmr.includes('ڵ'));

  // the four languages carry the same emoji: a flower in English is a flower in Badini
  const em = LANGS.map((l) => J(emoji(t.text[l])));
  ok(`${id}: the same emoji in all four languages`, em.every((e) => e === em[0]), em);
  // the same number of lines, give or take one: the four are the same message, laid out alike
  const lines = LANGS.map((l) => t.text[l].split('\n').length);
  ok(`${id}: the four languages are laid out alike (lines ±1)`, Math.max(...lines) - Math.min(...lines) <= 1, lines);
}

for (const l of LANGS) {
  const share = counts.over400[l] / TEMPLATES_B.length;
  ok(`${l}: most texts are under 400 characters (at most a tenth are longer)`, share <= 0.1, counts.over400[l]);
}

// ── 3. what each kind of message must and must not do ─────────────────────

for (const t of TEMPLATES_B) {
  const id = t.id;
  if (t.category === 'verify') {
    ok(`${id}: a code is a service message`, t.kind === 'service');
    for (const l of LANGS) {
      ok(`${id}/${l}: carries {code}`, t.text[l].includes('{code}'));
      ok(`${id}/${l}: says "do not share this code" word for word`, has(t.text[l], DO_NOT_SHARE[l]), t.text[l]);
      ok(`${id}/${l}: no emoji, no bold`, emoji(t.text[l]).length === 0 && !t.text[l].includes('*'));
    }
    ok(`${id}: no offer, price or link to sell anything`, !['offer', 'price', 'old_price', 'discount', 'points', 'product'].some((v) => t.vars.includes(v)), t.vars);
  }
  if (['notice', 'payment', 'health'].includes(t.category)) {
    ok(`${id}: no emoji in a notice, a payment or a clinic’s message`, LANGS.every((l) => emoji(t.text[l]).length === 0));
  }
  if (t.category === 'payment') {
    ok(`${id}: polite — never a threat (en)`, !PAYMENT_NEVER.en.test(t.text.en), t.text.en.match(PAYMENT_NEVER.en));
    for (const l of RTL) ok(`${id}/${l}: polite — never a threat`, !PAYMENT_NEVER[l].test(t.text[l]), t.text[l].match(PAYMENT_NEVER[l]));
    // a receipt may say "thank you!"; a message asking for money never raises its voice
    if (t.vars.includes('date')) ok(`${id}: asks for money without an exclamation mark`, LANGS.every((l) => !t.text[l].includes('!')));
  }
  if (t.category === 'health') {
    for (const l of LANGS) ok(`${id}/${l}: no diagnosis, no claim, no fear`, !HEALTH_NEVER[l].test(t.text[l]), t.text[l].match(HEALTH_NEVER[l]));
  }
  if (t.kind === 'promo') {
    for (const l of LANGS) ok(`${id}/${l}: no opt-out line (the engine adds it)`, !OPT_OUT[l].test(t.text[l]), t.text[l].match(OPT_OUT[l]));
    ok(`${id}: no false pressure`, !PRESSURE.test(t.text.en), t.text.en.match(PRESSURE));
  }
  if (t.category === 'cart') {
    ok(`${id}: a cart is nudged once — no deadline`, !t.vars.includes('date') && !t.vars.includes('days') && !t.vars.includes('time'));
  }
  if (t.kind === 'greeting') {
    ok(`${id}: a greeting greets by name`, t.vars.includes('name'));
  }
}
ok('payment has an invoice, a receipt, a reminder and an overdue notice',
  ['payment-1', 'payment-2', 'payment-3', 'payment-4'].every((x) => ids.includes(x)));
ok('verify has a one-time code that says until when it is valid', TEMPLATES_B.some((t) => t.category === 'verify' && t.vars.includes('time') && /valid until \{time\}/.test(t.text.en)));
ok('no template measures minutes with {days}', TEMPLATES_B.every((t) => !/\{days\}\s*(minutes?|دقائق|دقيقة|خولەک)/u.test(LANGS.map((l) => t.text[l]).join('\n'))));

// ── 4. filled with the longest values a file may hold ─────────────────────
// LIMITS.valueChars (120) per value and LIMITS.messageChars (3,800) per message: whatsappbulktypes.ts.

const VALUE_CHARS = 120, MESSAGE_CHARS = 3800;
const fill = (text, value) => text.replace(PLACEHOLDER, (_, k) => (KNOWN.has(k) ? value(k) : `{${k}}`));
let worst = 0, leftover = 0;
for (const t of TEMPLATES_B) {
  for (const l of LANGS) {
    const filled = fill(t.text[l], () => 'و'.repeat(VALUE_CHARS));
    worst = Math.max(worst, filled.length);
    if (/[{}]/.test(filled)) leftover++;
  }
}
ok('filled with the longest values, every message stays inside the engine’s limit', worst <= MESSAGE_CHARS, worst);
ok('filled, no brace is left over in any message', leftover === 0, leftover);

// A fuzz: values with braces, bidi marks, emoji and newlines do not turn into new placeholders
// (a filled message holds exactly the value text the sender typed, once per placeholder).
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const ATOMS = ['{', '}', '{name}', '‏', '‮', '🎉', '\n', 'a', 'ب', 'ڤ', ' ', '*', '_', '[[', '|'];
let fuzzBad = 0;
for (let i = 0; i < 300; i++) {
  const t = TEMPLATES_B[Math.floor(rnd() * TEMPLATES_B.length)];
  const l = LANGS[Math.floor(rnd() * LANGS.length)];
  const v = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => ATOMS[Math.floor(rnd() * ATOMS.length)]).join('');
  const filled = fill(t.text[l], () => v);
  const expected = strip(t.text[l]).length + v.length * placeholders(t.text[l]).length;
  if (filled.length !== expected) fuzzBad++;
}
ok('fuzz: a filled message is the text plus exactly the values, whatever they hold', fuzzBad === 0, fuzzBad);

// ── 5. the counts, said once ──────────────────────────────────────────────

const byKind = TEMPLATES_B.reduce((a, t) => ((a[t.kind] = (a[t.kind] ?? 0) + 1), a), {});
ok('promo, service and greeting are all present', byKind.promo > 0 && byKind.service > 0 && byKind.greeting > 0, byKind);
ok('every template is a frozen-in-shape object (no extra fields)', TEMPLATES_B.every((t) =>
  J(Object.keys(t).sort()) === J(['category', 'id', 'kind', 'tags', 'text', 'title', 'vars'])));

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
