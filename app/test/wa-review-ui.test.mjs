// The Broadcast screens, reviewed (docs/wa/review-ui.md): what the review found wrong and fixed, held here so it stays
// fixed. The pictures and the measurements were taken in the app's own engine (a WKWebView host, macOS) and are in
// vylo-wa-samples/review/ui/; what a server render, the fakes `buildUi` bundles in, and the source can prove is proved
// here. Every check names the defect it guards.
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { buildUi } from './wa-ui.test.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail).slice(0, 400) : ''}`);
  cond ? pass++ : fail++;
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
const src = (f) => readFileSync(join(APP, 'src', f), 'utf8').replace(/\r\n/g, '\n');

const out = await buildUi(join(APP, '.test-build/wa-review-ui'));
require('esbuild').buildSync({
  entryPoints: [join(APP, 'src/i18n.ts')], bundle: true, format: 'esm', outdir: join(APP, '.test-build/wa-review-ui-i18n'), logLevel: 'error',
});
const imp = (f) => import(pathToFileURL(join(out, `${f}.js`)).href);
const B = await imp('WhatsAppBroadcast');
const P = await imp('WhatsAppPeople');
const Run = await imp('WhatsAppRun');
const { translator } = await import(pathToFileURL(join(APP, '.test-build/wa-review-ui-i18n/i18n.js')).href);
const { createElement: h } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const quiet = console.error;
const draw = (el) => { console.error = () => {}; try { return renderToStaticMarkup(el); } finally { console.error = quiet; } };
const en = (s) => s;
const F = globalThis.__waFake;
const ACCOUNT = { id: 'main', name: 'Zara Shoes', baseUrl: 'https://gw.example.invalid', instance: 'zara', key: 'K' };
const R = (phone, name, vars = {}) => ({ phone, name, vars });
const list = (n, vars = {}) => Array.from({ length: n }, (_, i) => R(`9647${50 + (i % 2)}${String(1000000 + i).slice(-7)}`, `Name${i}`, { ...vars }));
const MSG = { text: 'Hello {first_name}!', lang: 'en', optOut: true, optOutText: '', templateId: '', business: '' };
const campaign = (o = {}) => ({
  id: 'c1', name: 'Eid sale', accountId: 'main', recipients: list(10), message: { text: 'Hi {name}', lang: 'en', optOut: true }, pace: B.readPace({}),
  consent: false, state: 'draft', outcomes: {}, created: 1, updated: 1, ...o,
});
const review = (c, extra = {}) => draw(h(Run.ReviewStep, {
  t: en, account: ACCOUNT, campaign: c, msg: { ...MSG, text: c.message.text }, sentToday: 0, country: '964',
  onPace() {}, onConsent() {}, onSend: async () => '', ...extra,
}));
const sendDisabled = (html) => /<button type="button" class="sb-cta-go wa-bk-go wa-bk-send" disabled=""/.test(html);
const broadcast = src('WhatsAppBroadcast.tsx');
const runSrc = src('WhatsAppRun.tsx');

// ── 1. A tick and a typed count are for one list ────────────────────────────
// Found: the consent tick lived in the shell and survived a change of list. Tick it for ten people, go Back to step 1,
// read a different list, come back: the box was already ticked — under fifty people Send was one press away for a list
// nobody had vouched for. And a staged draft opened from its banner while the review card was showing kept the count
// typed for the other broadcast.
console.log('A tick and a typed count belong to one broadcast, to one list');
{
  const a = list(10), b = list(10).map((r, i) => (i === 9 ? R('9647709999999', 'Other') : r));
  const k = (rs, acct = 'main', id = 'c1') => B.reviewKey(id, rs, acct);
  ok('the same people give the same key', k(a) === k(list(10)));
  ok('one number changed is another list', k(a) !== k(b));
  ok('one person more is another list', k(a) !== k(list(11)));
  ok('another account is another broadcast', k(a) !== k(a, 'other'));
  ok('another draft is another broadcast', k(a) !== k(a, 'main', 'c2'));
  ok('an empty list has a key too', typeof k([]) === 'string' && k([]) !== k(a));
  const big = list(5000);
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) B.reviewKey('c1', big, 'main');
  ok('keying five thousand people is cheap (20 times under 200 ms)', performance.now() - t0 < 200 * (process.env.CI ? 4 : 1), performance.now() - t0);
  ok('the shell keeps the tick as the key it was given for, not as a boolean',
    /const \[consentFor, setConsentFor\] = useState/.test(broadcast) && /const consent = consentFor !== '' && consentFor === reviewAt;/.test(broadcast));
  ok('the review card is drawn per broadcast and list, so a typed count never carries over', /<ReviewStep key=\{reviewAt\}/.test(broadcast));
}

// ── 2. Blanks block Send on the review card too ────────────────────────────
// Found: step 2 refuses `{offer}` that nothing fills, but a draft that opens straight on the review card — the
// assistant's staged campaign, a draft remembered at step 3 — never passed step 2, and `validateCampaign` does not look
// for blanks. Send was enabled and the message went out with a hole in it.
console.log('Blanks nothing fills block Send on the review card, and in launch');
{
  const holey = campaign({ message: { text: 'Hello {name}, get {offer} today at {city}!', lang: 'en', optOut: true }, recipients: list(10, { city: 'Erbil' }), consent: true });
  eq('the blanks of a campaign: not per person, not a column of its list', Run.blanksOf(holey), ['offer']);
  eq('a column every person has is not a blank', Run.blanksOf({ ...holey, message: { ...holey.message, text: 'Hi {name} in {city}' } }), []);
  const html = review(holey);
  ok('the review card says which blank is empty', html.includes('{offer} is not filled in'), html.slice(0, 300));
  ok('and Send is disabled', sendDisabled(html));
  ok('a full message with the box ticked can still be sent', !sendDisabled(review({ ...holey, message: { ...holey.message, text: 'Hi {name} in {city}' } })));
  F.store.saveOk = true;
  Run.dismissRun();
  const before = F.runs.length;
  eq('launch refuses a campaign with a blank, whoever calls it', await Run.launch({ ...holey, id: 'c-holey' }, ACCOUNT, 0), 'problems');
  ok('and no runner was made', F.runs.length === before);
}

// ── 3. Focus is never left on nothing ──────────────────────────────────────
// Found in WebKit (document.activeElement after each move): pressing History, See the report, Back from a sub-view or
// Send removes the button that was pressed, and focus fell to <body> — a keyboard user was nowhere, and the panel's
// own keys stopped reaching the screen. In Ready messages, *Use this* swapped the list for the fill form inside the
// same drawer: focus fell to <body>, so Escape (handled on the drawer) no longer closed it.
console.log('Focus is never left on nothing');
{
  ok('every view the shell shows can take the focus (the steps, history, report, do-not-contact)',
    (broadcast.match(/<div className="wa-bk-stepbox"[^>]*tabIndex=\{-1\}/g) ?? []).length >= 4, (broadcast.match(/<div className="wa-bk-stepbox"[^>]*>/g) ?? []));
  const run = draw(h(Run.RunView, { t: en, campaign: campaign({ state: 'paused' }), run: null, interrupted: true, onContinue() {}, onReport() {}, onDone() {} }));
  ok('and so can the run', /<section class="wa-bk-run" tabindex="-1"/.test(run), run.slice(0, 120));
  ok('a new view takes the focus, as a new step does',
    /useEffect\(\(\) => \{\s*if \(firstView\.current\) \{ firstView\.current = false; return; \}\s*showTop\(root\.current\?\.querySelector<HTMLElement>\('\.wa-bk-stepbox, \.wa-bk-run'\)\);\s*\}, \[view\]\);/.test(broadcast));
  ok('the root the shell looks in is both roots', (broadcast.match(/<div ref=\{root\} className="wa wa-bk/g) ?? []).length === 2);
  const ready = src('WhatsAppReady.tsx');
  ok('the fill form is a drawer of its own, so it takes the focus when it opens',
    /<Drawer key=\{`fill-\$\{chosen\.id\}`\}/.test(ready) && /<Drawer key="list"/.test(ready));
}

// Found in WebKit at 248 x 760: Next, pressed at the bottom of a long step 1, opened step 2 scrolled 123 px down (229
// in Arabic) — focusing the new step scrolled its top to the sidebar's top edge, under the sticky header, so the
// heading, the stepper and Ready messages / Write with AI were hidden and the person landed mid-step.
console.log('A new step or view starts at its top');
{
  const scroller = { scrollHeight: 2000, clientHeight: 700, scrollTop: 340, parentElement: null, tag: 'scroller' };
  const plain = { scrollHeight: 2000, clientHeight: 2000, scrollTop: 0, parentElement: scroller, tag: 'plain' };
  let how = null;
  const box = { focus: (o) => { how = o; }, parentElement: plain };
  B.showTop(box, (el) => ({ overflowY: el.tag === 'scroller' ? 'auto' : 'visible' }));
  ok('the new box takes the focus without the browser scrolling it under the header', how?.preventScroll === true, how);
  ok('and the box\'s scroller goes back to its top', scroller.scrollTop === 0);
  ok('nothing else is scrolled', plain.scrollTop === 0);
  ok('nothing throws without a box', (() => { try { B.showTop(null); return true; } catch { return false; } })());
  ok('the step and the view are both shown that way',
    /showTop\(stepBox\.current\)/.test(broadcast) && /showTop\(root\.current\?\.querySelector<HTMLElement>\('\.wa-bk-stepbox, \.wa-bk-run'\)\)/.test(broadcast));
}

// Found: the variable chips offered `{phone}` (and `{name}` twice over) for a pasted list with a phone column: the
// header's columns, not the values each person carries. `{phone}` then went out as nothing for everyone, with only a
// warning on step 2, and the review card's blank check called it a column that does not exist.
console.log('The chips and the blanks come from what each person carries');
{
  const C = await imp('WhatsAppCompose');
  const ppl = {
    recipients: list(4, { city: 'Erbil' }), source: 'csv', rejected: [], duplicates: 0, removed: 0,
    columns: ['name', 'phone', 'city'], phoneColumn: 'phone', nameColumn: 'name',
  };
  const html = draw(h(C.ComposeStep, { t: en, lang: 'en', msg: MSG, onMsg() {}, people: ppl, country: '964', full: false, onProviders() {} }));
  const chips = [...html.matchAll(/<bdi dir="ltr">\{(\w+)\}<\/bdi>/g)].map((m) => m[1]);
  eq('the chips: the two per person, then the columns people carry', chips, ['name', 'first_name', 'city']);
  const notes = C.messageNotes({ ...MSG, text: 'Call {phone} in {city}' }, ppl, en);
  ok('a header column nobody carries is a blank on step 2, as on the card', notes.block.some((s) => s.includes('{phone}')), notes);
  ok('a column people carry is not', !notes.block.some((s) => s.includes('{city}')));
}

// ── 4. The stylesheet, as WebKit drew it ───────────────────────────────────
const css = readFileSync(join(APP, 'src/styles.css'), 'utf8').replace(/\r\n/g, '\n');
const bulk = css.slice(css.indexOf('/* wa:bulk start */'), css.indexOf('/* wa:bulk end */')).replace(/\/\*[\s\S]*?\*\//g, '');
/** The body of the rule whose selector list is exactly `sel`, in the bulk block. */
const ruleOf = (sel) => {
  for (const m of bulk.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1].trim() === sel) return m[2];
  return null;
};
const propOf = (body, prop) => (new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;}]+)`).exec(body ?? '') ?? [])[1]?.trim() ?? null;
console.log('The stylesheet, as WebKit drew it');
{
  // Found at 248 x 760: on a short step (People, empty) the Back/Next bar sat under the last field, half way up the
  // column, with empty sidebar under it — the column was not bounded, because Broadcast is mounted in a plain <div>.
  ok('in the column the sidebar\'s scroller is a column that Broadcast fills',
    /display\s*:\s*flex/.test(ruleOf('.sb-panel:has(> div > .wa-bk:not(.is-full))') ?? '')
      && /flex\s*:\s*1 0 auto/.test(ruleOf('.sb-panel > div:has(> .wa-bk:not(.is-full))') ?? '')
      && /flex\s*:\s*1 0 auto/.test(ruleOf('.wa-bk:not(.is-full)') ?? ''));
  ok('and the bar is pushed to its bottom edge', /margin-block-start\s*:\s*auto/.test(ruleOf('.wa-bk-bar') ?? ''));
  // Found: `.wa mark` (wa:design, 0-1-1) out-ranked `.wa-bk-hole` (0-1-0), so a blank nobody fills was drawn in the
  // accent, like the `{name}` the list fills — the one thing the colour was there to tell apart.
  const hole = ruleOf('.wa-bk mark.wa-bk-hole');
  ok('a blank is drawn by a rule that out-ranks the panel\'s `.wa mark`', hole !== null && /var\(--warn-wash\)/.test(hole) && /color\s*:\s*var\(--warn\)/.test(hole));
  ok('and no weaker rule for it is left behind', ruleOf('.wa-bk-hole') === null);
  // Found: the header of a broadcast with no account cut its sentence mid-word ("No WhatsApp account is co").
  ok('the no-account line wraps instead of being cut', /white-space\s*:\s*normal/.test(ruleOf('.wa-bk-title small.is-none') ?? ''));
  const head = draw(h(B.WhatsAppBroadcast, { t: en, lang: 'en', account: null, full: false, onProviders() {}, onClose() {} }));
  ok('and the header marks it so', head.includes('<small class="is-none">No WhatsApp account is connected.</small>'));
}

// Found by measuring every text pair the block draws, the way wa-design.test.mjs measures its own: in the light theme
// the quiet grey on `--panel-3` (a tip, a waiting/skipped pill, the report filters and the writer's count, a
// template's kind) is 4.15:1, the person's name over each preview bubble and the wall's sentence are 3.88:1, and the
// time on a preview bubble 4.19:1 (2.61:1 dark).
console.log('Every text the block draws is readable, in both themes');
{
  const block = (open) => { const at = css.indexOf(open); return css.slice(at, css.indexOf('\n}', at)); };
  const hexes = (text) => Object.fromEntries([...text.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})\b/g)].map((m) => [m[1], m[2]]));
  const preview = { light: hexes(ruleOf('.wa-bk') ?? ''), dark: hexes(ruleOf(':root[data-theme="dark"] .wa-bk') ?? '') };
  const base = { light: { ...hexes(block(':root{')), ...preview.light }, dark: { ...hexes(block(':root[data-theme="dark"]{')), ...preview.light, ...preview.dark } };
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const colour = (expr, theme) => {
    const v = /^var\(--([\w-]+)\)$/.exec(String(expr).trim());
    if (!v || !base[theme][v[1]]) throw new Error(`cannot read ${expr}`);
    return rgb(base[theme][v[1]]);
  };
  const lum = (c) => {
    const l = c.map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  };
  const ratio = (a, b) => { const [p, q] = [lum(a), lum(b)].sort((m, n) => n - m); return (p + 0.05) / (q + 0.05); };
  // [what, the rule that colours the text, the rule that paints what it sits on]
  const PAIRS = [
    ['a tip under the message', '.wa-bk-notes .is-tip', '.wa-bk-notes .is-tip'],
    ['a waiting or skipped standing', '.wa-bk-st', '.wa-bk-st'],
    ['a sent standing', '.wa-bk-st.is-sent', '.wa-bk-st.is-sent'],
    ['a failed standing', '.wa-bk-st.is-failed', '.wa-bk-st.is-failed'],
    ['an unsure standing', '.wa-bk-st.is-unknown', '.wa-bk-st.is-unknown'],
    ['a filter or count not chosen', '.wa-bk-seg button', '.wa-bk-seg'],
    ['a template\'s kind', '.wa-bk-kind', '.wa-bk-kind'],
    ['a blank nobody fills', '.wa-bk mark.wa-bk-hole', '.wa-bk mark.wa-bk-hole'],
    ['the name over a preview bubble', '.wa-bk-fig figcaption', '.wa-bk-wall'],
    ['the sentence on an empty preview', '.wa-bk-wall-note', '.wa-bk-wall'],
    ['the time on a preview bubble', '.wa-bk-bubble-meta', '.wa-bk-bubble'],
    ['the words in a preview bubble', '.wa-bk-bubble', '.wa-bk-bubble'],
    ['a chosen tab', '.wa-bk-tab.on', '.wa-bk-tab.on'],
    ['a tab not chosen', '.wa-bk-tab', '.wa-bk-tab'],
    ['a warning', '.wa-bk-warn', '.wa-bk-warn'],
    ['a blocking note', '.wa-bk-notes .is-block', '.wa-bk-notes .is-block'],
  ];
  for (const theme of ['light', 'dark']) {
    for (const [what, fgSel, bgSel] of PAIRS) {
      let r = -1, detail = '';
      try {
        const fg = propOf(ruleOf(fgSel), 'color');
        const bg = propOf(ruleOf(bgSel), 'background');
        detail = `${fg} on ${bg}`;
        r = ratio(colour(fg, theme), colour(bg, theme));
      } catch (e) { detail += ` ${e.message}`; }
      ok(`${theme}: ${what} ≥ 4.5:1`, r >= 4.5, `${detail} = ${r.toFixed(2)}`);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
