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
    /useEffect\(\(\) => \{\s*if \(firstView\.current\) \{ firstView\.current = false; return; \}\s*root\.current\?\.querySelector<HTMLElement>\('\.wa-bk-stepbox, \.wa-bk-run'\)\?\.focus\(\);\s*\}, \[view\]\);/.test(broadcast));
  ok('the root the shell looks in is both roots', (broadcast.match(/<div ref=\{root\} className="wa wa-bk/g) ?? []).length === 2);
  const ready = src('WhatsAppReady.tsx');
  ok('the fill form is a drawer of its own, so it takes the focus when it opens',
    /<Drawer key=\{`fill-\$\{chosen\.id\}`\}/.test(ready) && /<Drawer key="list"/.test(ready));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
