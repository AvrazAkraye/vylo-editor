// The pure half of the broadcast engine (docs/wa/briefs/engine.md): what each person is sent, whether a campaign may
// start, the pace and how long it takes, who asked to stop, and the report.
//
// What matters, in order:
//
//   1. A customer never sees the machinery. No `{name}` printed, no "Hi , welcome", no doubled blank line where a
//      column was empty; a brace that is not a variable stays as typed; a value is never read as syntax.
//   2. The preview is what is sent: `[[a|b]]` is chosen from the seed and the number, never at random, and two people
//      get different wording.
//   3. A name cannot rearrange the message (bidi overrides go; a name in another script is isolated).
//   4. Validation says every reason a campaign cannot start — consent above all — and nothing that is not one.
//   5. Stop words are recognised in four languages and are not invented from "don't stop".
//   6. The report cannot run as a formula in the owner's spreadsheet.
import {
  OPT_OUT, renderMessage, variablesIn, missingVars, validateCampaign, newCampaign, clampPace, paceInBounds, capWarning,
  estimateSeconds, daysNeeded, isOptOut, optOutPhones, reportCsv, wirePhone, plainValue, requeue,
} from '../.test-build/whatsappcampaign.js';

// `whatsappbulktypes.ts` is types and constants only and has no bundle of its own in `.test-build` (the build line is
// package.json's, which this package does not edit), so its numbers are written out here — and checked against what
// the engine does with them below, so a change there that is not made here fails rather than passes quietly.
const LIMITS = { recipients: 5_000, messageChars: 3_800, attachmentBytes: 16 * 1024 * 1024, valueChars: 120, columns: 12, audiences: 40, campaigns: 60, suppressed: 20_000 };
const DEFAULT_PACE = { minDelaySec: 12, maxDelaySec: 30, batchSize: 20, batchPauseSec: 180, dailyCap: 200, stopAfterFailures: 3, typing: true };
const PACE_BOUNDS = { minDelaySec: [6, 120], maxDelaySec: [8, 300], batchSize: [5, 100], batchPauseSec: [30, 1800], dailyCap: [10, 1000], stopAfterFailures: [2, 10] };
const CAP_WARN = 300;

const SLOW = process.env.CI ? 4 : 1; // the ceilings are the release machine's; a shared runner gets four times as long
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); }
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const FSI = '\u2068', PDI = '\u2069';
const draft = (text, o = {}) => ({ text, lang: 'en', optOut: false, ...o });
const person = (phone, name, vars = {}) => ({ phone, ...(name === undefined ? {} : { name }), vars });
const ali = person('9647501112233', 'Ali Hassan', { city: 'Erbil', 'Shop Name': 'Nova' });
const nobody = person('9647504445566', '', {});
const R = (text, r = ali, o = {}, seed = 0) => renderMessage(draft(text, o), r, seed);

// ── numbers and plain values ──────────────────────────────────────────────
console.log('the shared numbers');
eq('the default pace is the engine\'s', clampPace({}), DEFAULT_PACE);
eq('the bounds are the engine\'s', clampPace({ minDelaySec: -1, maxDelaySec: -1, batchSize: -1, batchPauseSec: -1, dailyCap: -1, stopAfterFailures: -1 }),
  { minDelaySec: 6, maxDelaySec: 8, batchSize: 5, batchPauseSec: 30, dailyCap: 10, stopAfterFailures: 2, typing: true });
eq('and at the top', clampPace({ minDelaySec: 1e9, maxDelaySec: 1e9, batchSize: 1e9, batchPauseSec: 1e9, dailyCap: 1e9, stopAfterFailures: 1e9 }),
  { minDelaySec: 120, maxDelaySec: 300, batchSize: 100, batchPauseSec: 1800, dailyCap: 1000, stopAfterFailures: 10, typing: true });
ok('the message limit is the engine\'s', renderMessage({ text: 'x'.repeat(5000), lang: 'en', optOut: false }, { phone: '9647501112233', vars: {} }).length === LIMITS.messageChars);
ok('the value limit is the engine\'s', plainValue('y'.repeat(500)).length === LIMITS.valueChars);
ok('the warning line is the engine\'s', capWarning({ dailyCap: CAP_WARN + 1 }) && !capWarning({ dailyCap: CAP_WARN }));
console.log('numbers and values');
eq('a wire number is digits only', wirePhone('+964 750 111-2233'), '9647501112233');
ok('too short or too long is not a number', wirePhone('12345') === '' && wirePhone('1234567890123456') === '' && wirePhone('') === '');
ok('anything that is not text or a whole number is not a number', wirePhone(null) === '' && wirePhone({}) === '' && wirePhone(9.6e20) === '' && wirePhone(9647501112233) === '9647501112233');
eq('a value loses controls and reordering marks, keeps joiners', plainValue('A\u202Eli\u0000 \u200F\u2066x\u2069\u200Cy\nz'), 'Ali x\u200Cy z');
ok('a value is cut to the column limit without splitting a pair', plainValue('a'.repeat(LIMITS.valueChars - 1) + '😀') === 'a'.repeat(LIMITS.valueChars - 1));
ok('a value that is not text is empty', plainValue({}) === '' && plainValue(undefined) === '' && plainValue(NaN) === '' && plainValue(42) === '42');

// ── variables ─────────────────────────────────────────────────────────────
console.log('variables');
eq('{name}', R('Hi {name}!'), 'Hi Ali Hassan!');
eq('{first_name} is the first word', R('Hi {first_name}!'), 'Hi Ali!');
eq('a column, by its header', R('See you in {city}.'), 'See you in Erbil.');
eq('a column matched without case, spaces or dashes', R('{CITY} · {shop name} · {shop-name} · {Shop_Name}'), 'Erbil · Nova · Nova · Nova');
eq('a fallback when the value is empty', R('Hi {first_name|friend}!', nobody), 'Hi friend!');
eq('the value wins over the fallback', R('Hi {first_name|friend}!'), 'Hi Ali!');
eq('a first_name column wins over the first word of the name', R('{first_name}', person('9647501112233', 'Ali Hassan', { first_name: 'Alo' })), 'Alo');
eq('a name column is used when the name field is empty', R('{name}', person('9647501112233', '', { Name: 'Sara' })), 'Sara');
eq('an unknown variable prints nothing, never its braces', R('Hello {nickname}', ali), 'Hello');
eq('an explicit empty fallback prints nothing', R('Hello{title|}!', ali), 'Hello!');
eq('a column header in Arabic script is a variable', renderMessage(draft('{المدينة}', { lang: 'ckb' }), person('9647501112233', 'x', { 'المدينة': 'هەولێر' })), 'هەولێر');
eq('a column called constructor is a column, not the object machinery', R('[{constructor}][{__proto__}][{toString}]', person('9647501112233', 'x', {})), '[][][]');
eq('a value is never read as syntax', R('Hi {name}', person('9647501112233', '{city} [[a|b]] \\{', { city: 'X' })), 'Hi {city} [[a|b]] \\{');

console.log('what an empty variable leaves');
eq('the space before a comma goes', R('Hi {name}, welcome!', nobody), 'Hi, welcome!');
eq('the space before Arabic punctuation goes', R('مرحبا {name}، أهلا', nobody, { lang: 'ar' }), 'مرحبا، أهلا');
eq('a doubled space closes up', R('Dear {first_name} customer', nobody), 'Dear customer');
eq('two empty variables side by side close up', R('Dear {first_name} {last_name}, hello', nobody), 'Dear, hello');
eq('at the start of a line, with the comma after it', R('{name}, your order is ready', nobody), 'your order is ready');
eq('at the end of a line', R('Thanks {name}\nBye', nobody), 'Thanks\nBye');
eq('a line that was only a variable goes, and does not leave two blank lines', R('Hi\n\n{city}\n\nBye', nobody), 'Hi\n\nBye');
eq('a first line that was only a variable goes', R('{name}\nWelcome', nobody), 'Welcome');
eq('the author\'s own double spaces and blank lines stay', R('A  B\n\n\nC {name}', ali), 'A  B\n\n\nC Ali Hassan');
eq('text glued to an empty variable closes up', R('#{code}#', nobody), '##');

console.log('text that is not syntax');
eq('escaped braces print as braces', R('\\{name\\} is {name}'), '{name} is Ali Hassan');
eq('escaped double brackets print as brackets', R('\\[[a|b\\]]'), '[[a|b]]');
eq('an escaped bar inside a choice is a bar', R('[[a\\|b]]'), 'a|b');
eq('braces that are not a variable stay as typed', R('{ } {"a": 1} {} {and so on!}'), '{ } {"a": 1} {} {and so on!}');
eq('spaces inside the braces are allowed: { city } is the city', R('{ city }'), 'Erbil');
eq('a lone brace stays', R('price { 5'), 'price { 5');
eq('a variable name over 40 characters is text', R(`{${'x'.repeat(41)}}`), `{${'x'.repeat(41)}}`);
eq('an unclosed [[ is text', R('[[a|b and more'), '[[a|b and more');
eq('a ]] on its own is text', R('a ]] b | c'), 'a ]] b | c');
eq('a backslash before anything else stays', R('C:\\new \\n'), 'C:\\new \\n');
eq('NUL and other controls in the text go; tabs and line breaks stay', R('a\u0000b\u0007c\td\r\ne'), 'abc\td\ne');

// ── choices ───────────────────────────────────────────────────────────────
console.log('choices');
{
  const text = '[[Hi|Hello|Hey]] {first_name}';
  const people = Array.from({ length: 120 }, (_, i) => person(`96475000${String(i).padStart(5, '0')}`, `P${i}`));
  const first = people.map((p) => renderMessage(draft(text), p, 7));
  const again = people.map((p) => renderMessage(draft(text), p, 7));
  ok('the same seed and number always give the same words (the preview is what is sent)', JSON.stringify(first) === JSON.stringify(again));
  const words = new Set(first.map((s) => s.split(' ')[0]));
  ok('across people every alternative is used', words.size === 3, [...words]);
  const counts = ['Hi', 'Hello', 'Hey'].map((w) => first.filter((s) => s.startsWith(w + ' ')).length);
  ok('and none is starved (each at least a sixth of 120)', counts.every((n) => n >= 20), counts);
  const other = people.map((p) => renderMessage(draft(text), p, 8));
  ok('another seed gives a different arrangement', JSON.stringify(other) !== JSON.stringify(first));
  ok('the default seed is 0', renderMessage(draft(text), people[3]) === renderMessage(draft(text), people[3], 0));
  const two = people.map((p) => renderMessage(draft('[[a|b]][[a|b]]'), p, 1));
  ok('two choices in one text are made independently', new Set(two).size === 4, [...new Set(two)]);
}
eq('a choice may hold variables', R('[[Hi {first_name}|Hi {first_name}]]'), 'Hi Ali');
ok('choices nest', ['ax', 'ay', 'b'].includes(R('[[a[[x|y]]|b]]')));
eq('a choice of one is that one', R('[[only]]'), 'only');
eq('an empty choice closes up like an empty variable', renderMessage(draft('Hello [[]] friend'), ali), 'Hello friend');
ok('nesting deeper than four reads the extra [[ as text, without failing', typeof R('[[a[[b[[c[[d[[e|f]]]]]]]]]]') === 'string');

// ── which way the text runs ───────────────────────────────────────────────
console.log('directions');
eq('an Arabic name in an English message is isolated', R('Hi {name}, code 4521', person('9647501112233', 'علي')), `Hi ${FSI}علي${PDI}, code 4521`);
eq('an English name in an Arabic message is isolated', renderMessage(draft('مرحبا {name}', { lang: 'ar' }), ali), `مرحبا ${FSI}Ali Hassan${PDI}`);
eq('the same script needs nothing', renderMessage(draft('مرحبا {name}', { lang: 'ar' }), person('9647501112233', 'علي')), 'مرحبا علي');
eq('digits have no direction and are not wrapped', R('Code {code}', person('9647501112233', 'x', { code: '4521' })), 'Code 4521');
eq('a text that starts with a variable takes its direction from the words after it', renderMessage(draft('{name} مرحبا', { lang: 'en' }), ali), `${FSI}Ali Hassan${PDI} مرحبا`);
eq('a text with no words takes its direction from the language', renderMessage(draft('{name}', { lang: 'ckb' }), ali), `${FSI}Ali Hassan${PDI}`);
eq('an override inside a name is removed, not obeyed', R('Hi {name}!', person('9647501112233', 'Bob\u202Egnp.exe')), 'Hi Bobgnp.exe!');
ok('nothing in a rendered name can reorder the line', !/[\u202A-\u202E]/.test(R('{name} {city}', person('9647501112233', '\u202Ex\u202D', { city: '\u202Ey' }))));

// ── the opt-out line ──────────────────────────────────────────────────────
console.log('opt-out line');
for (const lang of ['en', 'ar', 'ckb', 'kmr']) {
  eq(`added after a blank line (${lang})`, renderMessage(draft('Offer', { lang, optOut: true }), ali), `Offer\n\n${OPT_OUT[lang]}`);
}
eq('the person\'s own line is used when given', R('Offer', ali, { optOut: true, optOutText: '  Send NO to stop.  ' }), 'Offer\n\nSend NO to stop.');
eq('off is off', R('Offer', ali, { optOut: false }), 'Offer');
eq('not added twice when the text already ends with it', R(`Offer\n\n${OPT_OUT.en}`, ali, { optOut: true }), `Offer\n\n${OPT_OUT.en}`);
eq('an unknown language gets the English line', R('Offer', ali, { optOut: true, lang: 'xx' }), `Offer\n\n${OPT_OUT.en}`);
eq('a language named like an object property is still unknown', R('Offer', ali, { optOut: true, lang: 'constructor' }), `Offer\n\n${OPT_OUT.en}`);

// ── the length cap ────────────────────────────────────────────────────────
console.log('length');
{
  const long = renderMessage(draft('x'.repeat(LIMITS.messageChars + 500), { optOut: true }), ali);
  ok('a rendered message never passes the limit', long.length <= LIMITS.messageChars, long.length);
  ok('and the opt-out line is never the part cut off', long.endsWith(OPT_OUT.en));
  const emoji = renderMessage(draft('😀'.repeat(LIMITS.messageChars)), ali);
  ok('the cut does not split an emoji', emoji.length <= LIMITS.messageChars && !/[\uD800-\uDBFF]$/.test(emoji));
}

// ── variablesIn / missingVars ─────────────────────────────────────────────
console.log('variables asked for');
eq('in order of first use, once each', variablesIn('{city} {name} {City} [[{shop}|{name}]] \\{escaped}'), ['city', 'name', 'shop']);
eq('none in plain text', variablesIn('Hello { } {"json": true} there!'), []);
{
  const list = [ali, nobody, person('9647507778899', 'Sara', {}), person('9647500001111', '', { city: 'Duhok' })];
  eq('missing counts, only for variables someone lacks', missingVars(draft('Hi {name}, {city}! {name|friend} {shop name}'), list),
    [{ name: 'name', missing: 2 }, { name: 'city', missing: 2 }, { name: 'shop name', missing: 3 }]);
  eq('a variable with a fallback everywhere is never missing', missingVars(draft('{city|our shop}'), list), []);
  eq('nobody missing anything is an empty list', missingVars(draft('Hi {name}'), [ali]), []);
  const inChoice = missingVars(draft('[[{city}|plain]]'), Array.from({ length: 40 }, (_, i) => person(`96475000${String(i).padStart(5, '0')}`, 'x')));
  ok('a variable inside a choice counts only for the people given that choice', inChoice.length === 1 && inChoice[0].missing > 5 && inChoice[0].missing < 35, inChoice);
}

// ── validation ────────────────────────────────────────────────────────────
console.log('validation');
const good = () => ({
  ...newCampaign({ name: 'Autumn', accountId: 'main', recipients: [ali, nobody], message: draft('Hi {first_name|there}', { optOut: true }), now: 1, id: 'c1' }),
  consent: true,
});
const codes = (c, o) => validateCampaign(c, o).map((p) => p.code);
eq('a good campaign has no problems', codes(good()), []);
eq('no people', codes({ ...good(), recipients: [] }), ['no-recipients']);
{
  const many = Array.from({ length: LIMITS.recipients + 1 }, (_, i) => person(String(9647000000000 + i), ''));
  const p = validateCampaign({ ...good(), recipients: many });
  eq('too many people, with the numbers for the sentence', p, [{ code: 'too-many', vars: { n: LIMITS.recipients + 1, max: LIMITS.recipients } }]);
}
eq('no message: no text and no attachment', codes({ ...good(), message: draft('   \n ') }), ['no-message']);
eq('an attachment alone is a message', codes({ ...good(), message: draft('', { attachment: { kind: 'image', name: 'a.png', mime: 'image/png', bytes: 3, data: 'iVBO' } }) }), []);
eq('no consent — never true by default', codes({ ...good(), consent: false }), ['no-consent']);
eq('consent must be exactly true', codes({ ...good(), consent: 'yes' }), ['no-consent']);
eq('no account', codes({ ...good(), accountId: '  ' }), ['no-account']);
{
  const c = { ...good(), recipients: [ali, person('9647509990000', 'x', { bio: 'y'.repeat(120) })], message: draft(`${'z'.repeat(LIMITS.messageChars - 60)} {bio}`) };
  const p = validateCampaign(c);
  ok('too long for one person is a problem, counted', p.length === 1 && p[0].code === 'message-too-long' && p[0].vars.n === 1 && p[0].vars.longest > LIMITS.messageChars, p);
  eq('a template too long on its own is caught with nobody in the list', codes({ ...good(), recipients: [], message: draft('q'.repeat(LIMITS.messageChars + 1)) }), ['no-recipients', 'message-too-long']);
}
{
  const big = 'A'.repeat(Math.ceil((LIMITS.attachmentBytes + 3) / 3) * 4);
  const p = validateCampaign({ ...good(), message: draft('x', { attachment: { kind: 'video', name: 'v.mp4', mime: 'video/mp4', bytes: 1, data: big } }) });
  ok('an attachment over the limit is too big, measured from its data', p.length === 1 && p[0].code === 'attachment-too-big' && p[0].vars.max === LIMITS.attachmentBytes, p.map((x) => x.code));
  eq('a declared size over the limit is too big', codes({ ...good(), message: draft('x', { attachment: { kind: 'image', name: 'a', mime: 'image/png', bytes: LIMITS.attachmentBytes + 1, data: 'iVBO' } }) }), ['attachment-too-big']);
  eq('data that is not base64 is unreadable', codes({ ...good(), message: draft('x', { attachment: { kind: 'image', name: 'a', mime: 'image/png', bytes: 3, data: 'not base64!' } }) }), ['attachment-unreadable']);
  eq('empty data is unreadable', codes({ ...good(), message: draft('x', { attachment: { kind: 'document', name: 'a', mime: 'application/pdf', bytes: 0, data: '' } }) }), ['attachment-unreadable']);
  eq('an unknown kind is unreadable', codes({ ...good(), message: draft('x', { attachment: { kind: 'sticker', name: 'a', mime: 'x/y', bytes: 1, data: 'AAAA' } }) }), ['attachment-unreadable']);
  eq('a contact card needs a name and a number', codes({ ...good(), message: draft('x', { attachment: { kind: 'contact', name: 'c', mime: 'text/vcard', bytes: 0, data: '', contact: { fullName: 'Shop', phone: '12' } } }) }), ['attachment-unreadable']);
  eq('a good contact card is fine', codes({ ...good(), message: draft('', { attachment: { kind: 'contact', name: 'c', mime: 'text/vcard', bytes: 0, data: '', contact: { fullName: 'Shop', phone: '9647501234567' } } }) }), []);
}
eq('a pace outside the bounds', codes({ ...good(), pace: { ...DEFAULT_PACE, minDelaySec: 1 } }), ['pace-out-of-bounds']);
eq('a pace that is not a pace', codes({ ...good(), pace: null }), ['pace-out-of-bounds']);
eq('more people than today leaves is not a problem (it takes several days)', codes({ ...good(), pace: { ...DEFAULT_PACE, dailyCap: 10 } }, { sentToday: 9 }), []);
eq('a cap already used up today is', validateCampaign({ ...good(), pace: { ...DEFAULT_PACE, dailyCap: 10 } }, { sentToday: 10 }), [{ code: 'over-daily-cap', vars: { sent: 10, cap: 10 } }]);
eq('already running', codes({ ...good(), state: 'running' }), ['already-running']);
eq('every problem at once, without throwing', codes({ recipients: null, message: null, consent: false, accountId: 5, pace: 'x', state: 'running' }, { sentToday: 1e9 }),
  ['no-recipients', 'no-message', 'no-consent', 'no-account', 'pace-out-of-bounds', 'over-daily-cap', 'already-running']);

// ── newCampaign ───────────────────────────────────────────────────────────
console.log('a new campaign');
{
  const list = [ali];
  const c = newCampaign({ name: 'N', accountId: 'main', recipients: list, message: draft('x'), pace: { ...DEFAULT_PACE, minDelaySec: 1, maxDelaySec: 9999 } });
  ok('nobody has consented, and it is a draft', c.consent === false && c.state === 'draft' && Object.keys(c.outcomes).length === 0);
  ok('the pace is clamped into the bounds', c.pace.minDelaySec === PACE_BOUNDS.minDelaySec[0] && c.pace.maxDelaySec === PACE_BOUNDS.maxDelaySec[1]);
  list.push(nobody);
  ok('the people are a snapshot: editing the list afterwards does not change the campaign', c.recipients.length === 1);
  const ids = new Set(Array.from({ length: 200 }, () => newCampaign({ name: 'n', accountId: 'a', recipients: [], message: draft('x'), now: 5 }).id));
  ok('two campaigns made in the same millisecond have different ids', ids.size === 200);
  ok('staged is carried, consent still false', newCampaign({ name: 'n', accountId: 'a', recipients: [], message: draft('x'), staged: true }).staged === true);
}

// ── pace ──────────────────────────────────────────────────────────────────
console.log('pace');
eq('nothing is the default', clampPace({}), { ...DEFAULT_PACE });
eq('garbage is the default', clampPace(null), { ...DEFAULT_PACE });
{
  const p = clampPace({ minDelaySec: 1, maxDelaySec: 1e9, batchSize: '7', batchPauseSec: NaN, dailyCap: 5000, stopAfterFailures: -3, typing: 'yes' });
  eq('each field clamped into its bounds; numbers from text are read; the rest default', p,
    { minDelaySec: 6, maxDelaySec: 300, batchSize: 7, batchPauseSec: DEFAULT_PACE.batchPauseSec, dailyCap: 1000, stopAfterFailures: 2, typing: true });
  const q = clampPace({ minDelaySec: 100, maxDelaySec: 20 });
  ok('the longest delay is never below the shortest', q.minDelaySec === 100 && q.maxDelaySec === 100);
  ok('typing can be turned off', clampPace({ typing: false }).typing === false);
}
ok('the default pace is in bounds', paceInBounds({ ...DEFAULT_PACE }));
ok('a clamped pace is always in bounds', [{}, { minDelaySec: -5 }, { dailyCap: 1e9 }, { maxDelaySec: 1, minDelaySec: 120 }].every((p) => paceInBounds(clampPace(p))));
ok('out of bounds is out', !paceInBounds({ ...DEFAULT_PACE, dailyCap: 1001 }) && !paceInBounds({ ...DEFAULT_PACE, minDelaySec: 5 }) && !paceInBounds({ ...DEFAULT_PACE, maxDelaySec: 10, minDelaySec: 20 }));
ok('a missing typing flag is out', !paceInBounds({ ...DEFAULT_PACE, typing: undefined }));
ok(`a cap above ${CAP_WARN} earns the warning, at it does not`, capWarning({ ...DEFAULT_PACE, dailyCap: CAP_WARN + 1 }) && !capWarning({ ...DEFAULT_PACE, dailyCap: CAP_WARN }));
{
  // 45 people at 12–30 s (21 on average), 1.6 s typing, a 180 s pause after every 20: two pauses.
  eq('the estimate: delays, typing and the batch pauses between', estimateSeconds(45), Math.round(45 * 22.6 + 2 * 180));
  eq('exactly one batch has no pause', estimateSeconds(20, { ...DEFAULT_PACE, typing: false }), 20 * 21);
  eq('nobody takes no time', estimateSeconds(0), 0);
  ok('a nonsense count takes no time', estimateSeconds(-4) === 0 && estimateSeconds(NaN) === 0);
}
eq('within the cap: one day', daysNeeded(150), 1);
eq('just over: two days', daysNeeded(201), 2);
eq('what was sent today counts against today', daysNeeded(150, DEFAULT_PACE, 100), 2);
eq('a cap used up today: today is a day with nothing in it', daysNeeded(200, DEFAULT_PACE, 200), 2);
eq('a thousand at a cap of 1,000 is one day', daysNeeded(1000, { ...DEFAULT_PACE, dailyCap: 1000 }), 1);
eq('5,000 at the default cap is 25 days', daysNeeded(5000), 25);

// ── stop words ────────────────────────────────────────────────────────────
console.log('stop words');
const stops = [
  'STOP', 'stop', 'Stop.', 'stop!!!', ' STOP ', 'Stop 🛑', 'S.T.O.P', 'stop please', 'Please STOP', 'stop it', 'STOP ALL', 'stop messages',
  'Unsubscribe', 'unsubscribe me', 'CANCEL', 'end', 'Quit', 'no more', 'No more messages please', 'opt out', 'Opt-out', 'remove me',
  'stop sending', 'stop messaging me', 'Stop, thank you', "stop'", 'ＳＴＯＰ',
  'إيقاف', 'ايقاف', 'أوقف', 'وقف', 'توقف', 'إلغاء', 'الغاء', 'إلغاء الاشتراك', 'الغاء الاشتراك', 'إيقاف من فضلك', 'إِيقَاف', 'ستوب', 'إيـقـاف', 'إيقاف الرسائل',
  'وەستان', 'وەستێنە', 'ڕاگرە', 'راگره', 'نامەوێت', 'لابدە', 'وەستان تکایە',
  'ڕاوەستە', 'راوەستە', 'نەخوازم', 'بەس', 'بس',
  'dur', 'DURDUR', 'İptal', 'iptal lütfen',
];
for (const s of stops) ok(`a stop request: ${JSON.stringify(s)}`, isOptOut(s));
const notStops = [
  "don't stop", 'Dont stop', 'please stop by tomorrow', 'stop by our store', 'I will stop by the shop tomorrow to pick up the order',
  'the end', 'end of day', 'cancel my order', 'no', 'yes', 'ok', 'please', 'thanks', '', '   ', '🛑',
  'لا توقف', 'وقف السيارة هنا', 'متى تتوقفون عن العمل؟',
  'سڵاو', 'بەس نرخەکەی چەندە؟',
  'durum nedir', `${'stop '.repeat(10)}`, 'stop'.padEnd(250, '.'),
];
for (const s of notStops) ok(`not a stop request: ${JSON.stringify(s).slice(0, 50)}`, !isOptOut(s));
ok('a value that is not text is not a stop request', !isOptOut(null) && !isOptOut(5) && !isOptOut({}));
{
  const msg = (jid, text, fromMe = false) => ({ id: 'x', keyId: 'x', jid, fromMe, at: 1, text, kind: 'text', who: '', status: '', quoted: null });
  const people = new Set(['9647501112233', '9647504445566']);
  const got = optOutPhones([
    msg('9647501112233@s.whatsapp.net', 'STOP'),
    msg('9647501112233@s.whatsapp.net', 'stop'),
    msg('9647504445566@s.whatsapp.net', 'stop by tomorrow?'),
    msg('9647509999999@s.whatsapp.net', 'STOP'),
    msg('120363000000000000@g.us', 'STOP'),
    msg('9647504445566@s.whatsapp.net', 'STOP', true),
    msg('9647504445566:12@s.whatsapp.net', 'إيقاف'),
    null,
  ], people);
  eq('the senders among the campaign\'s people who asked to stop, once each; not strangers, groups or ourselves', got.sort(), ['9647501112233', '9647504445566']);
}

// ── the report ────────────────────────────────────────────────────────────
console.log('report');
/** RFC 4180, enough to read back what reportCsv writes. */
function parseCsv(text) {
  const rows = [];
  let row = [], cellText = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cellText += '"'; i++; }
      else if (ch === '"') q = false;
      else cellText += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cellText); cellText = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') { row.push(cellText); rows.push(row); row = []; cellText = ''; i++; }
    else cellText += ch;
  }
  return rows;
}
{
  const c = {
    ...good(),
    recipients: [
      person('9647501112233', '=HYPERLINK("http://evil","x")'), person('9647504445566', '+1 555'), person('9647507778899', '-2+3'),
      person('9647500001111', '@SUM(A1)'), person('9647500002222', '\tTab'), person('9647500003333', 'Rêbaz, "the boss"\nline'),
      person('9647500004444', ' =1+1'), person('9647500005555', '＝1+1'), person('+964 750 111 2233', 'duplicate'),
    ],
    outcomes: {
      '9647501112233': { phone: '9647501112233', standing: 'sent', at: Date.UTC(2026, 9, 4, 10, 0, 0), attempts: 1 },
      '9647504445566': { phone: '9647504445566', standing: 'failed', why: 'http-400', at: Date.UTC(2026, 9, 4, 10, 1, 0), attempts: 1 },
      '9647507778899': { phone: '9647507778899', standing: 'unknown', why: 'timeout', at: 'garbage', attempts: 1 },
      '9640000000009': { phone: '9640000000009', standing: 'skipped-opted-out', why: '=cmd|calc', attempts: 0 },
      '9640000000010': { phone: '9640000000010', standing: 'failed', why: '\tcmd', attempts: 0 },
    },
  };
  const csv = reportCsv(c);
  const rows = parseCsv(csv);
  eq('a header, then one row per person in the list\'s order, a repeated number once, then outcomes not in the list', rows.map((r) => r[0]),
    ['phone', '9647501112233', '9647504445566', '9647507778899', '9647500001111', '9647500002222', '9647500003333', '9647500004444', '9647500005555', '9640000000009', '9640000000010']);
  ok('every row has five cells', rows.every((r) => r.length === 5), rows.map((r) => r.length));
  eq('standing, why and time', rows[1].slice(2), ['sent', '', '2026-10-04T10:00:00.000Z']);
  eq('a person with no outcome yet is queued', rows[4][2], 'queued');
  eq('a time that is not one is left empty', rows[3][4], '');
  const names = rows.slice(1).map((r) => r[1]);
  ok('a formula is neutralised with a leading quote: = + - @', names[0].startsWith("'=") && names[1].startsWith("'+") && names[2].startsWith("'-") && names[3].startsWith("'@"), names.slice(0, 4));
  eq('a tab inside a name is taken out before it can lead a cell', names[4], 'Tab');
  ok('a why that starts with a tab is neutralised', rows[10][3] === "'\tcmd", rows[10]);
  ok('a space before = and the full-width = are neutralised', names[6].startsWith("'") && names[7].startsWith("'"), names.slice(6, 8));
  eq('commas, quotes and line breaks survive the quoting', names[5], 'Rêbaz, "the boss" line');
  ok('a why from a bad record is neutralised too', rows[9][3].startsWith("'="), rows[9][3]);
  ok('no key, no body, no address in the report', !csv.includes('Hi ') && !csv.includes('apikey') && !csv.includes('http://127'));
  ok('lines end with CRLF', csv.endsWith('\r\n') && !/[^\r]\n/.test(csv.replace(/"[^"]*"/g, '')));
  eq('an empty campaign is a header', reportCsv({ recipients: [], outcomes: {} }), 'phone,name,standing,why,time\r\n');
}

// ── requeue ───────────────────────────────────────────────────────────────
console.log('requeue');
{
  const c = { ...good(), outcomes: {
    a: undefined,
    '9647501112233': { phone: '9647501112233', standing: 'unknown', why: 'timeout', attempts: 1 },
    '9647504445566': { phone: '9647504445566', standing: 'sent', attempts: 1 },
    '9647507778899': { phone: '9647507778899', standing: 'failed', why: 'invalid', attempts: 1 },
    '9647500001111': { phone: '9647500001111', standing: 'skipped-opted-out', attempts: 0 },
  } };
  const r = requeue(c, ['+964 750 111 2233', '9647504445566', '9647507778899', '9647500001111', 'nonsense', 'constructor']);
  eq('unknown and failed go back in the queue; sent and skipped never do', ['9647501112233', '9647504445566', '9647507778899', '9647500001111'].map((p) => r.outcomes[p].standing),
    ['queued', 'sent', 'queued', 'skipped-opted-out']);
  ok('the attempts are kept, the reason cleared, the original untouched', r.outcomes['9647501112233'].attempts === 1 && r.outcomes['9647501112233'].why === undefined && c.outcomes['9647501112233'].standing === 'unknown');
}

// ── speed ─────────────────────────────────────────────────────────────────
console.log('speed');
{
  const people = Array.from({ length: 5000 }, (_, i) => person(String(9647000000000 + i), i % 3 ? `Name ${i}` : '', { city: i % 2 ? 'Erbil' : '', code: String(i) }));
  const d = draft('[[Hi|Hello|Hey]] {first_name|friend}! Your code is {code}. [[See you in {city|town}|Visit us soon]].', { optOut: true });
  let t = performance.now();
  let total = 0;
  for (const p of people) total += renderMessage(d, p, 3).length;
  const ms = performance.now() - t;
  ok(`5,000 renders in under 250 ms × SLOW (${ms.toFixed(0)} ms)`, ms < 250 * SLOW && total > 0);
  t = performance.now();
  const c = { ...newCampaign({ name: 'Big', accountId: 'main', recipients: people, message: d }), consent: true };
  const problems = validateCampaign(c, { sentToday: 0 });
  const missing = missingVars(d, people);
  const est = estimateSeconds(people.length, c.pace);
  const days = daysNeeded(people.length, c.pace);
  const ms2 = performance.now() - t;
  ok(`a 5,000-person campaign validated, checked for missing values and estimated in under 400 ms × SLOW (${ms2.toFixed(0)} ms)`, ms2 < 400 * SLOW && problems.length === 0 && missing.length === 0 && est > 0 && days === 25, { problems, missing });
  const evil = '[['.repeat(20000) + '{'.repeat(20000);
  t = performance.now();
  renderMessage(draft(evil), ali);
  const ms3 = performance.now() - t;
  ok(`a text of 40,000 unclosed brackets and braces renders in under 300 ms × SLOW (${ms3.toFixed(0)} ms)`, ms3 < 300 * SLOW);
}

// ── fuzz ──────────────────────────────────────────────────────────────────
console.log('fuzz');
{
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const pieces = ['{', '}', '[[', ']]', '|', '\\', '{name}', '{first_name}', '{city|x}', '{x|}', ' ', '  ', '\n', 'word', 'علي', '😀', ',', '\u0000', '\u202E', '{constructor}', 'STOP'];
  const randomText = (n) => Array.from({ length: n }, () => pieces[Math.floor(rnd() * pieces.length)]).join('');
  let threw = 0, nul = 0, long = 0, unstable = 0, overrides = 0;
  for (let i = 0; i < 3000; i++) {
    const text = randomText(1 + Math.floor(rnd() * 40));
    const r = person(String(9647000000000 + i), randomText(Math.floor(rnd() * 6)), { city: randomText(Math.floor(rnd() * 4)) });
    try {
      const a = renderMessage(draft(text, { optOut: rnd() < 0.5, lang: ['en', 'ar', 'ckb', 'kmr', 'zz'][i % 5] }), r, i);
      const b = renderMessage(draft(text, { optOut: rnd() < 2, lang: 'en' }), r, i);
      if (a.includes('\u0000') || b.includes('\u0000')) nul++;
      if (a.length > LIMITS.messageChars) long++;
      if (renderMessage(draft(text), r, i) !== renderMessage(draft(text), r, i)) unstable++;
      const names = plainValue(r.name);
      if (/[\u202A-\u202E]/.test(names)) overrides++;
      variablesIn(text); missingVars(draft(text), [r]); isOptOut(text);
    } catch { threw++; }
  }
  ok('3,000 random texts: nothing throws', threw === 0, threw);
  ok('no marker ever leaks into a message', nul === 0, nul);
  ok('nothing passes the length limit', long === 0, long);
  ok('the same input always renders the same', unstable === 0, unstable);
  ok('no override survives in a value', overrides === 0, overrides);
  let outOfBounds = 0;
  const junk = [null, undefined, 0, -1, 1e12, NaN, Infinity, '12', 'x', {}, [], true];
  for (let i = 0; i < 2000; i++) {
    const p = {};
    for (const k of ['minDelaySec', 'maxDelaySec', 'batchSize', 'batchPauseSec', 'dailyCap', 'stopAfterFailures', 'typing']) {
      if (rnd() < 0.7) p[k] = rnd() < 0.5 ? junk[Math.floor(rnd() * junk.length)] : Math.floor(rnd() * 3000) - 500;
    }
    if (!paceInBounds(clampPace(p))) outOfBounds++;
  }
  ok('2,000 random paces: every one clamps into the bounds', outOfBounds === 0, outOfBounds);
  let badRows = 0;
  for (let i = 0; i < 300; i++) {
    const recipients = Array.from({ length: 5 }, (_, j) => person(String(9647000000000 + i * 10 + j), randomText(5)));
    const outcomes = Object.fromEntries(recipients.map((r) => [r.phone, { phone: r.phone, standing: 'failed', why: randomText(3), at: rnd() * 2e12, attempts: 1 }]));
    const rows = parseCsv(reportCsv({ recipients, outcomes }));
    if (rows.length !== 6 || rows.some((r) => r.length !== 5) || rows.slice(1).some((r) => /^\s*[=+\-@]/.test(r[1]) || /^\s*[=+\-@]/.test(r[3]))) badRows++;
  }
  ok('300 random reports read back as five cells a row, no formula anywhere', badRows === 0, badRows);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
