// The Broadcast screens drawn (docs/wa/ui.md): each step and view rendered with React's server renderer against the
// fakes `buildUi` (wa-ui.test.mjs) bundles in, in English and Arabic, in the column and the window — and the rules of
// the screen held as source checks: Send is the only way to `runCampaign`, consent is never stored, no key or gateway
// address is drawn, numbers are masked everywhere but the report, the CSS block is logical and every class is used.
// The pictures (headless Chrome, 248 px and 1100 px, light and dark, en/ar/ckb) are in vylo-wa-samples/ui/.
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
const nl = (s) => s.replace(/\r\n/g, '\n');
const count = (s, re) => (s.match(re) ?? []).length;

const out = await buildUi();
require('esbuild').buildSync({
  entryPoints: [join(APP, 'src/i18n.ts')], bundle: true, format: 'esm', outdir: join(APP, '.test-build/wa-ui-i18n'), logLevel: 'error',
});
const imp = (f) => import(pathToFileURL(join(out, `${f}.js`)).href);
const B = await imp('WhatsAppBroadcast');
const P = await imp('WhatsAppPeople');
const C = await imp('WhatsAppCompose');
const Rd = await imp('WhatsAppReady');
const Run = await imp('WhatsAppRun');
const { translator } = await import(pathToFileURL(join(APP, '.test-build/wa-ui-i18n/i18n.js')).href);
const { createElement: h } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const quiet = console.error;
const draw = (el) => { console.error = () => {}; try { return renderToStaticMarkup(el); } finally { console.error = quiet; } };
const en = (s) => s;
const ar = translator('ar');
const F = globalThis.__waFake;

const ACCOUNT = { id: 'main', name: 'Zara Shoes', baseUrl: 'https://gw-secret.example.invalid', instance: 'zara-instance', key: 'KEY-SHOULD-NEVER-SHOW' };
const secretFree = (html) => !html.includes('gw-secret') && !html.includes('KEY-SHOULD-NEVER-SHOW') && !html.includes('zara-instance');
const R = (phone, name, vars = {}) => ({ phone, name, vars });
const list = (n, cols = {}) => Array.from({ length: n }, (_, i) => R(`9647${50 + (i % 2)}${String(1000000 + i).slice(-7)}`, i % 5 === 4 ? undefined : `Name${i}`, { ...cols }));
const people = (recipients, extra = {}) => ({
  recipients, source: 'csv', rejected: [], duplicates: 0, removed: 0, columns: Object.keys(recipients[0]?.vars ?? {}), phoneColumn: null, nameColumn: null, ...extra,
});
const MSG = { text: 'Hello {first_name}, see you in {city}!', lang: 'en', optOut: true, optOutText: '', templateId: '', business: '' };
const campaign = (o = {}) => ({
  id: 'c1', name: 'Eid sale', accountId: 'main', recipients: list(10), message: { text: 'Hi {name}', lang: 'en', optOut: true }, pace: B.readPace({}),
  consent: false, state: 'draft', outcomes: {}, created: 1, updated: 1, ...o,
});

console.log('The first open, in the column');
{
  const html = draw(h(B.WhatsAppBroadcast, { t: en, lang: 'en', account: ACCOUNT, full: false, onProviders() {}, onClose() {} }));
  ok('the panel\'s own frame and the broadcast\'s', html.startsWith('<div class="wa wa-bk">'));
  ok('the header says Broadcast and the account it sends from', html.includes('<b>Broadcast</b>') && html.includes('<bdi>Zara Shoes</bdi>'));
  ok('no key, no gateway address, no instance name', secretFree(html));
  ok('the way back to the chats is labelled', html.includes('aria-label="Back to chats"'));
  ok('history is one button away', html.includes('aria-label="History"'));
  eq('three steps', count(html, /class="wa-bk-stepb(?: [^"]*)?"/g), 3);
  eq('one of them is the current step', count(html, /aria-current="step"/g), 1);
  ok('the next two cannot be reached before there are people', count(html, /class="wa-bk-stepb"[^>]*disabled=""/g) === 2, html.match(/<ol[\s\S]*?<\/ol>/)?.[0]);
  eq('four ways in, as tabs', count(html, /role="tab"/g), 4);
  eq('one tab selected', count(html, /aria-selected="true"/g), 1);
  ok('one tab in the tab order (arrow keys move between them)', count(html, /role="tab"[^>]*tabindex="0"/g) === 1 && count(html, /role="tab"[^>]*tabindex="-1"/g) === 3);
  ok('the tabs control the panel', /aria-controls="([^"]+)"/.test(html) && html.includes(`id="${html.match(/aria-controls="([^"]+)"/)[1]}"`));
  ok('the paste box takes either direction', /<textarea class="wa-bk-area" dir="auto"/.test(html));
  ok('Next is there and disabled, with the reason in one sentence', /<p class="wa-bk-why">Add at least one person\.<\/p>/.test(html) && /class="sb-cta-go wa-bk-go" disabled=""/.test(html));
  ok('the honest line about whom to message', html.includes('Only your own contacts and customers who agreed to hear from you.'));
  ok('the step can take the focus when it changes', /class="wa-bk-stepbox" tabindex="-1"/.test(html));
  ok('nothing was sent by opening it', F.runs.length === 0 && F.tests.length === 0);
}

console.log('The first open, in a window and in Arabic');
{
  const html = draw(h(B.WhatsAppBroadcast, { t: ar, lang: 'ar', account: ACCOUNT, full: true, onProviders() {}, onClose() {} }));
  ok('the window layout', html.startsWith('<div class="wa wa-bk is-full">') && html.includes('class="wa-bk-nav"') && html.includes('class="wa-bk-aside"'));
  ok('the steps on the left, labelled', /<nav class="wa-bk-nav" aria-label="خطوات">/.test(html));
  ok('the preview on the right', html.includes('كيف ستبدو'));
  ok('the step is in Arabic', html.includes('لمن تُرسل؟') && !html.includes('Who should get it?'));
  ok('and the reason Next waits', html.includes('أضف شخصاً واحداً على الأقل.'));
  ok('no key or address in Arabic either', secretFree(html));
}

console.log('People, after a read');
{
  const ppl = people(list(1204, { city: 'Erbil' }), {
    rejected: Array.from({ length: 37 }, (_, i) => ({ line: i + 2, raw: `bad ${i}`, why: i % 2 ? 'too-short' : 'not-a-number' })), duplicates: 12, removed: 9,
  });
  const html = draw(h(P.AudienceStep, { t: en, lang: 'en', people: ppl, onPeople() {}, country: '964', onCountry() {}, suppressed: new Set() }));
  ok('the count is the headline', html.includes('<b>1,204</b> people'));
  ok('then what could not be used, each in words', html.includes('37 couldn’t be read') && html.includes('12 repeated') && html.includes('9 asked not to be messaged'));
  ok('the summary is announced when it changes', /class="wa-bk-sum" aria-live="polite"/.test(html));
  ok('the rejected lines, folded, with the reason', html.includes('<details class="wa-bk-details">') && html.includes('Line 2') && html.includes('Not a phone number'));
  ok('at most fifty of them, and the rest counted', count(html, /<li><span class="wa-bk-mono">Line/g) === 37);
  ok('the first rows as a table', html.includes('role="table"') && count(html, /role="row"/g) === 6);
  ok('numbers masked, never whole', html.includes('+964 750 *** ') && !/9647501000000/.test(html));
  ok('a masked number stays left to right', /<bdi dir="ltr" class="wa-bk-phone">\+964/.test(html));
  ok('the country choice lists the countries', html.includes('Iraq +964') && html.includes('Turkey +90'));
  ok('Save this list is offered', html.includes('Save this list'));
  const full = draw(h(P.AudienceStep, { t: en, lang: 'en', people: people(list(5000)), onPeople() {}, country: '964', onCountry() {}, suppressed: new Set() }));
  ok('a list at the ceiling says only the first were taken', full.includes('Only the first 5,000 were taken'));
  const one = draw(h(P.AudienceStep, { t: en, lang: 'en', people: people(list(1)), onPeople() {}, country: '964', onCountry() {}, suppressed: new Set() }));
  ok('one person is a person', one.includes('<b>1</b> person'));
  const unknown = draw(h(P.AudienceStep, { t: en, lang: 'en', people: null, onPeople() {}, country: '1', onCountry() {}, suppressed: new Set() }));
  ok('a remembered country the list does not know is still shown', /<option value="1"( selected="")?>\+1<\/option>/.test(unknown));
}

console.log('The message');
{
  const ppl = people([R('9647500000001', 'Rebaz Ahmed', { city: 'Erbil' }), R('9647500000002', 'Sara', { city: '' }), R('9647500000003', undefined, { city: 'Duhok' })]);
  const props = { t: en, lang: 'en', msg: MSG, onMsg() {}, people: ppl, country: '964', full: false, onProviders() {} };
  const html = draw(h(C.ComposeStep, props));
  ok('a chip for each detail of the list', ['{name}', '{first_name}', '{city}'].every((c) => html.includes(`<bdi dir="ltr">${c}</bdi>`)));
  ok('each chip says what it does', html.includes('aria-label="Insert city"'));
  ok('the message box takes either direction and stops at the ceiling', /<textarea[^>]*class="wa-bk-area wa-bk-msg" dir="auto"[^>]*maxLength="3800"/i.test(html));
  eq('the preview shows three people in the column', count(html, /<figure class="wa-bk-fig">/g), 3);
  ok('as the engine renders it for each of them', html.includes('Hello Rebaz, see you in Erbil!') && html.includes('Reply STOP to stop receiving messages.'));
  ok('someone with no name is captioned so', html.includes('No name'));
  ok('the person without a city is a warning, not a block', html.includes('1 person has no city: their message will leave it out.') && !html.includes('class="is-block"'));
  ok('the opt-out line is shown and can be edited', /<textarea class="wa-bk-area wa-bk-optline"[^>]*aria-label="The opt-out line"/.test(html));
  ok('the language of the message is a choice of four', count(html.match(/Message language[\s\S]*?<\/select>/)?.[0] ?? '', /<option /g) === 4);
  const wide = draw(h(C.ComposeStep, { ...props, full: true }));
  ok('in a window the preview is on the right, not in the step', !wide.includes('<figure class="wa-bk-fig">'));
  const hole = draw(h(C.ComposeStep, { ...props, msg: { ...MSG, text: 'Get {offer} at {business}' } }));
  ok('a blank nobody fills blocks the step, naming it', hole.includes('class="is-block"') && hole.includes('{offer} is not filled in'));
  const noOpt = draw(h(C.ComposeStep, { ...props, msg: { ...MSG, optOut: false } }));
  ok('turning the opt-out line off says what that costs', noOpt.includes('A promotion without a way to stop is the message people report.'));
  const shout = draw(h(C.ComposeStep, { ...props, msg: { ...MSG, text: 'HUGE SALE TODAY ONLY COME NOW' } }));
  ok('a spam hint is a gentle tip', shout.includes('class="is-tip"') && shout.includes('reads as shouting'));
  const pane = draw(h(C.PreviewPane, { t: en, msg: MSG, people: null }));
  ok('before there is a list the preview says where the real one comes from', pane.includes('Add people in step 1 to see their own messages here.'));
  const bubble = draw(h(C.Bubble, { t: en, text: 'a *b* _c_', attachment: { kind: 'document', name: 'menu.pdf', mime: 'application/pdf', bytes: 2 * 1024 * 1024, data: 'x' } }));
  ok('the bubble draws WhatsApp\'s formatting and the file', bubble.includes('<b>b</b>') && bubble.includes('<i>c</i>') && bubble.includes('menu.pdf') && bubble.includes('2.0 MB'));
}

console.log('Ready messages');
{
  const base = { t: en, lang: 'en', msgLang: 'en', business: '', onBusiness() {}, columns: [], replacing: false, onUse() {}, onClose() {} };
  const col = draw(h(Rd.TemplatesDrawer, { ...base, full: false }));
  ok('a labelled dialog', /role="dialog" aria-modal="true" aria-labelledby="[^"]+"/.test(col));
  ok('with a close button that says so', col.includes('aria-label="Close"'));
  ok('categories as a select in the column', /<select class="wa-bk-select">[\s\S]*Sale[\s\S]*<\/select>/.test(col) && !col.includes('aria-pressed'));
  eq('every ready message as a card', count(col, /<li class="wa-bk-tpl">/g), 4);
  ok('each with a Use button that names it', col.includes('aria-label="Use “Weekend sale”"'));
  ok('a promotion is marked as one', col.includes('wa-bk-kind is-promo'));
  const wide = draw(h(Rd.TemplatesDrawer, { ...base, full: true }));
  ok('categories as chips in a window, one pressed', count(wide, /class="wa-bk-chip[^"]*" aria-pressed="true"/g) === 1 && count(wide, /aria-pressed=/g) === 5);
  const holes = draw(h(Rd.Holes, { text: 'Hi {name}, {offer} in {city}', columns: ['city'] }));
  ok('a blank is marked, a per-person detail is not', holes.includes('<mark class="wa-bk-hole">{offer}</mark>') && holes.includes('<span class="wa-bk-var">{name}</span>') && holes.includes('<span class="wa-bk-var">{city}</span>'));
}

console.log('Review & send');
{
  const base = { t: en, account: ACCOUNT, msg: MSG, sentToday: 0, country: '964', onPace() {}, onConsent() {}, onSend: async () => '' };
  const off = draw(h(Run.ReviewStep, { ...base, campaign: campaign() }));
  ok('without consent Send is disabled', /class="sb-cta-go wa-bk-go wa-bk-send" disabled=""/.test(off));
  ok('and the card says why', off.includes('Tick the box to confirm everyone agreed to hear from you.'));
  ok('the consent tick is there and not ticked', /<input type="checkbox"\/><span>Everyone on this list agreed to hear from me\.<\/span>/.test(off));
  ok('the plain warning above the button', off.includes('WhatsApp can block numbers that message people who did not ask. Messages go slowly on purpose.'));
  ok('the pace said plainly', off.includes('About one message every 12–30 seconds, with a break every 20.') && off.includes('200 a day at most.'));
  ok('and how long it takes', /Sending takes about \d+ min in all\./.test(off));
  ok('the exact message of the first person, opt-out line included', off.includes('Exactly as Name0 will get it:') && off.includes('Hello Name0, see you in') && off.includes('Reply STOP'));
  ok('the people masked', off.includes('+964 750 *** ') && off.includes('and 7 more') && !off.includes('9647501000000'));
  ok('no key, no gateway address', secretFree(off));
  ok('a test to myself is offered, through the account', off.includes('Send a test to myself'));
  const on = draw(h(Run.ReviewStep, { ...base, campaign: campaign({ consent: true }) }));
  ok('with consent and ten people, Send is enabled', /class="sb-cta-go wa-bk-go wa-bk-send">/.test(on) && on.includes('Send to 10 people'));
  ok('and no typed confirmation is asked', !on.includes('To confirm, type the number of people'));
  const big = draw(h(Run.ReviewStep, { ...base, campaign: campaign({ consent: true, recipients: list(51) }) }));
  ok('fifty-one people ask for the number typed out', big.includes('To confirm, type the number of people: 51'));
  ok('and Send waits for it', /class="sb-cta-go wa-bk-go wa-bk-send" disabled=""/.test(big));
  const capped = draw(h(Run.ReviewStep, { ...base, sentToday: 200, campaign: campaign({ consent: true }) }));
  ok('today\'s cap reached blocks sending now', capped.includes('Today’s limit is already reached.') && /wa-bk-send" disabled=""/.test(capped));
  const days = draw(h(Run.ReviewStep, { ...base, campaign: campaign({ consent: true, recipients: list(450) }) }));
  ok('a list longer than the cap says the days it takes', days.includes('At 200 a day this takes 3 days.'));
  const staged = draw(h(Run.ReviewStep, { ...base, campaign: campaign({ staged: true }) }));
  ok('an assistant\'s draft says nothing has been sent', staged.includes('Prepared by the assistant. Nothing has been sent.'));
  const none = draw(h(Run.ReviewStep, { ...base, account: null, campaign: campaign({ consent: true, accountId: '' }) }));
  ok('no account: said, and no test offered', none.includes('No WhatsApp account is connected.') && !none.includes('Send a test to myself'));
  const ar3 = draw(h(Run.ReviewStep, { ...base, t: ar, campaign: campaign() }));
  ok('in Arabic', ar3.includes('راجعها ثم أرسلها') && ar3.includes('كل من في هذه القائمة وافق على تلقي رسائلي.'));
}

console.log('The run');
{
  const rec = list(20);
  const outcomes = Object.fromEntries(rec.slice(0, 8).map((r, i) => [r.phone, { phone: r.phone, standing: i === 7 ? 'sending' : i === 3 ? 'failed' : 'sent', attempts: 1, at: 100 + i }]));
  const c = campaign({ recipients: rec, outcomes, state: 'running', consent: true });
  const live = { runner: { pause() {}, resume() {}, stop() {} }, campaign: c, wait: { until: Date.now() + 18_000, why: 'delay' }, over: false, crash: '' };
  const html = draw(h(Run.RunView, { t: en, campaign: c, run: live, interrupted: false, onContinue() {}, onReport() {}, onDone() {} }));
  ok('a progress ring a screen reader can read', /role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="35"/.test(html));
  ok('the counts announced politely', /role="status" aria-live="polite">6 of 20 sent</.test(html));
  ok('the person being messaged now', html.includes('Sending to <bdi>Name7</bdi> now'));
  ok('the countdown to the next message', /Next message in 1[78] s\./.test(html));
  ok('Pause and Stop', html.includes('Pause') && html.includes('Stop') && !html.includes('Resume'));
  ok('the latest outcomes, in words', html.includes('class="wa-bk-st is-failed">Failed') && html.includes('class="wa-bk-st is-sent">Sent'));
  ok('closing the panel is said to be safe', html.includes('You can close this panel: sending goes on while the app is open.'));
  const paused = draw(h(Run.RunView, { t: en, campaign: c, run: { ...live, campaign: { ...c, state: 'paused' } }, interrupted: false, onContinue() {}, onReport() {}, onDone() {} }));
  ok('paused: Resume instead of Pause', paused.includes('Resume') && !paused.includes('>Pause<'));
  const halted = draw(h(Run.RunView, { t: en, campaign: { ...c, state: 'halted', halted: 'auth' }, run: { ...live, over: true, wait: null, campaign: { ...c, state: 'halted', halted: 'auth' } }, interrupted: false, onContinue() {}, onReport() {}, onDone() {} }));
  ok('a halt says why and what to do', html !== halted && halted.includes('The WhatsApp server refused the key. Check the connection in settings.'));
  ok('and offers to continue with those left', halted.includes('Continue with the 13 left') && halted.includes('See the report'));
  const stuck = draw(h(Run.RunView, { t: en, campaign: { ...c, state: 'paused' }, run: null, interrupted: true, onContinue() {}, onReport() {}, onDone() {} }));
  ok('interrupted: paused, nothing sent twice, Continue', stuck.includes('Paused: the app closed while it was sending.') && stuck.includes('Continue with the'));
  const unchecked = draw(h(Run.RunView, { t: en, campaign: { ...c, notes: ['number-check-unavailable'] }, run: null, interrupted: false, onContinue() {}, onReport() {}, onDone() {} }));
  ok('a campaign sent without the number check says so', unchecked.includes('check of which numbers are on WhatsApp was not available') && !html.includes('check of which numbers are on WhatsApp was not available'));
  const done = draw(h(Run.RunView, { t: en, campaign: { ...c, state: 'done' }, run: { ...live, over: true, wait: null, campaign: { ...c, state: 'done' } }, interrupted: false, onContinue() {}, onReport() {}, onDone() {} }));
  ok('finished: the report and a new broadcast, no Continue', done.includes('See the report') && done.includes('New broadcast') && !done.includes('Continue with'));
}

console.log('The report, history and the do-not-contact list');
{
  const rec = list(6);
  const outcomes = { [rec[0].phone]: { phone: rec[0].phone, standing: 'sent', attempts: 1 }, [rec[1].phone]: { phone: rec[1].phone, standing: 'unknown', attempts: 1, why: 'timeout' } };
  const c = campaign({ recipients: rec, outcomes, state: 'done' });
  const rep = draw(h(Run.ReportView, { t: en, lang: 'en', campaign: c, onAddSuppressed: async () => {}, onDuplicate() {}, onDoNotContact() {} }));
  ok('the report shows whole numbers, its own record', rep.includes(`+${rec[0].phone}`));
  ok('every person a row', count(rep, /role="row"/g) === 7);
  ok('filters, one pressed', count(rep, /aria-pressed="true"/g) === 1 && count(rep, /aria-pressed=/g) === 5);
  ok('the uncertain ones explained', rep.includes('Messages that may or may not have been sent') && rep.includes('They are never sent again by themselves.'));
  ok('CSV and the STOP replies are a press away', rep.includes('Download CSV') && rep.includes('Add STOP replies to the do-not-contact list'));
  const hist = draw(h(Run.HistoryView, { t: en, lang: 'en', campaigns: [campaign({ id: 'a', name: 'Old', updated: 5, state: 'done' }), campaign({ id: 'b', name: 'Staged one', staged: true, updated: 1 }), campaign({ id: 'r', name: 'Running', state: 'running', updated: 9 })], onOpen() {}, onDuplicate() {}, onDelete() {}, onDoNotContact() {} }));
  ok('the assistant\'s drafts first', hist.indexOf('Staged one') < hist.indexOf('Running') && hist.indexOf('Running') < hist.indexOf('Old'));
  ok('a running broadcast cannot be deleted', count(hist, />Delete</g) === 2);
  const dnc = draw(h(Run.DoNotContactView, { t: en, list: ['9647501234567'], country: '964', onAdd: async () => {}, onRemove: async () => {} }));
  ok('the do-not-contact list is masked', dnc.includes('+964 750 *** 4567') && !dnc.includes('9647501234567'));
  ok('and each removal names the number, masked', dnc.includes('aria-label="Take +964 750 *** 4567 off the list"'));
}

// ── the rules, held as source ─────────────────────────────────────────────

const FILES = ['WhatsAppBroadcast', 'WhatsAppPeople', 'WhatsAppCompose', 'WhatsAppReady', 'WhatsAppRun'];
const SRC = Object.fromEntries(FILES.map((f) => [f, nl(readFileSync(join(APP, 'src', `${f}.tsx`), 'utf8'))]));
const ALL = Object.values(SRC).join('\n');

console.log('Nothing sends without Send');
{
  eq('runCampaign is called once on every screen together', count(ALL, /\brunCampaign\(/g), 1);
  ok('inside launch', /export async function launch\([\s\S]*?const runner = runCampaign\(ready, realDeps\(account\)\);[\s\S]*?\n}\n/.test(SRC.WhatsAppRun));
  ok('after consent, the engine\'s problems and a save', /if \(c\.consent !== true\) return 'no-consent';\s*if \(validateCampaign\(c, \{ sentToday \}\)\.length\) return 'problems';[\s\S]*?const kept = await saveCampaign\(ready\)[\s\S]*?if \(!kept\) return 'storage';[\s\S]*?runCampaign\(/.test(SRC.WhatsAppRun));
  eq('launch is called from two places: Send and Continue', count(SRC.WhatsAppBroadcast, /\blaunch\(/g), 2);
  ok('nowhere else', FILES.filter((f) => f !== 'WhatsAppBroadcast').every((f) => count(SRC[f], /(?<!function )\blaunch\(/g) === 0));
  ok('Send on the card is the one that calls onSend', /onClick=\{\(\) => void send\(\)\}/.test(SRC.WhatsAppRun) && /const why = await onSend\(\);/.test(SRC.WhatsAppRun));
  ok('sendTest is the only other wire, to the person\'s own number', count(ALL, /\bsendTest\(/g) === 1);
  ok('Continue hands launch the stored campaign, its consent untouched', /const why = await launch\(c, account, today\);/.test(SRC.WhatsAppBroadcast));
  eq('no screen ever writes consent: true', count(ALL, /consent:\s*true/g), 0);
  ok('consent reaches the campaign only from the tick', /\}\),\n\s*consent,\n\s*\}\), \[work, people, account, consent, t\]\);/.test(SRC.WhatsAppBroadcast) && /onConsent=\{setConsent\}/.test(SRC.WhatsAppBroadcast));
  ok('Start over does not leave an empty working list to come back as "0 people"', /if \(!people \|\| people\.recipients\.length === 0\) \{ void deleteAudience\(WORK_AUDIENCE_ID\)/.test(SRC.WhatsAppBroadcast) && /work0 && work0\.recipients\.length > 0/.test(SRC.WhatsAppBroadcast));
}

console.log('What is kept, what is drawn');
{
  const sets = [...ALL.matchAll(/localStorage\.setItem\(([^,]+),/g)].map((m) => m[1].trim());
  eq('localStorage holds the draft and the test number, nothing else', [...new Set(sets)].sort(), ['DRAFT_KEY', 'ME_KEY']);
  ok('the draft type has no consent field', !/interface Work[\s\S]*?consent[\s\S]*?\n}/.test(SRC.WhatsAppBroadcast.match(/export interface Work[\s\S]*?\n}/)[0]));
  ok('every localStorage touch is inside a try', [...ALL.matchAll(/localStorage\.\w+\(/g)].every((m) => /try \{[^\n]*$/.test(ALL.slice(Math.max(0, m.index - 80), m.index))));
  ok('no screen reads a key or an address', !/\.(baseUrl|key|apiKey)\b/.test(ALL.replace(/e\.key/g, '')));
  eq('a whole number is drawn in one place: the report', count(ALL, /\+\{r\.phone\}/g), 1);
  ok('no any', !/:\s*any\b|as any\b|<any>/.test(ALL));
  ok('every visible sentence goes through t(): no bare English text between tags', !/>\s*[A-Z][a-z]+ [a-z]+[^<{]*</.test(ALL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
}

console.log('The stylesheet block');
{
  const css = nl(readFileSync(join(APP, 'src/styles.css'), 'utf8'));
  eq('one start marker and one end marker', [count(css, /\/\* wa:bulk start \*\//g), count(css, /\/\* wa:bulk end \*\//g)], [1, 1]);
  const block = css.slice(css.indexOf('/* wa:bulk start */'), css.indexOf('/* wa:bulk end */'));
  const code = block.replace(/\/\*[\s\S]*?\*\//g, '');
  ok('logical properties only', !/(^|[\s;{])(margin|padding|border)-(left|right)\s*:|(^|[\s;{])(left|right)\s*:|text-align\s*:\s*(left|right)|float\s*:/.test(code));
  ok('no four-value margin, padding or radius', ![...code.matchAll(/(?:^|[;{\s])(margin|padding|border-radius)\s*:\s*([^;}]+)/g)].some((m) => m[2].trim().split(/\s+/).length === 4));
  ok('no pinned direction', !/direction\s*:\s*(ltr|rtl)/.test(code));
  const defined = new Set();
  let buf = '';
  for (const ch of code) { if (ch === '{') { for (const m of buf.matchAll(/\.(wa-bk[\w-]*)/g)) defined.add(m[1]); buf = ''; } else if (ch === '}') buf = ''; else buf += ch; }
  const used = new Set([...ALL.matchAll(/\bwa-bk[\w-]*/g)].map((m) => m[0]));
  const missing = [...used].filter((c) => !defined.has(c));
  const unused = [...defined].filter((c) => !used.has(c));
  eq('every wa-bk class the screens write has a rule', missing, []);
  eq('every wa-bk rule is written by a screen', unused, []);
  ok('the block defines a plausible number of classes', defined.size > 100, defined.size);
  const columnRules = [...code.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => !m[1].includes('is-full') && !m[1].includes('wa-bk-body') && !m[1].includes('wa-bk-nav') && !m[1].includes('wa-bk-aside'));
  const wide = columnRules.filter((m) => [...m[2].matchAll(/(?:^|[;\s])(?:min-)?inline-size\s*:\s*(\d+)px/g)].some((x) => Number(x[1]) > 200));
  eq('no fixed width in the column wider than it can hold', wide.map((m) => m[1].trim()), []);
  ok('44 px targets in the column', /\.wa-bk:not\(\.is-full\) :is\([^)]*\.wa-bk-btn[^)]*\)\{\s*min-block-size:44px;/.test(code));
  ok('the dark theme is written twice, for the system and for the toggle', code.includes(':root:not([data-theme="light"]) .wa-bk{') && code.includes(':root[data-theme="dark"] .wa-bk{'));
  ok('motion respects the reader', code.includes('@media (prefers-reduced-motion: reduce)'));
  const greens = [...code.matchAll(/#(?:D9FDD3|005C4B|25D366|EFEAE2|0B141A)/gi)].length;
  ok('WhatsApp\'s colours appear only as the preview\'s tokens', greens === 6 && [...code.matchAll(/var\(--wa-(?:out|wall)\)/g)].every((m) => /wa-bk-(bubble|wall)/.test(code.slice(Math.max(0, code.lastIndexOf('}', m.index)), m.index))));
}

console.log('Four languages');
{
  const i18n = nl(readFileSync(join(APP, 'src/i18n.ts'), 'utf8'));
  const ENTRY = /^ {2}'((?:[^'\\]|\\.)+)':[ \t]*\r?\n?[ \t]*'((?:[^'\\]|\\.)*)',[ \t]*\r?$/gm;
  const dict = {};
  for (const lang of ['ar', 'ckb', 'kmr']) {
    const from = i18n.indexOf(`const ${lang}: Dict = {`);
    const body = i18n.slice(from, i18n.indexOf('\n};', from));
    dict[lang] = new Map([...body.matchAll(ENTRY)].map((m) => [m[1], m[2]]));
    ok(`${lang}: the screens' section is there`, body.includes('// wa ui: the Broadcast screens'));
  }
  const keys = new Set([...ALL.matchAll(/\bt\('((?:[^'\\]|\\.)+)'\)/g)].map((m) => m[1]));
  ok('the scan found the screens\' sentences', keys.size > 250, keys.size);
  for (const lang of ['ar', 'ckb', 'kmr']) {
    const gone = [...keys].filter((k) => !dict[lang].has(k));
    eq(`every sentence of the screens is in ${lang}`, gone, []);
    const ph = (s) => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort().join();
    const bad = [...keys].filter((k) => dict[lang].has(k) && k !== '{n} person' && ph(k) !== ph(dict[lang].get(k)));
    eq(`and keeps every placeholder in ${lang}`, bad, []);
  }
  ok('the Arabic is Arabic, not English left in place', [...keys].filter((k) => /[a-z]{4}/.test((dict.ar.get(k) ?? '').replace(/\{\w+\}/g, '')) && !/STOP|CSV|WhatsApp|txt|csv/.test(dict.ar.get(k))).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
