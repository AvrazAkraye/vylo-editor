// Adversarial review of the parsing half of Broadcast (docs/wa/review-parse.md): a wrong number messages a stranger,
// a wrong parse loses a customer, a hostile file must never hurt the app.
//
// Country by country: fourteen numbering plans (the ten a Kurdistan/Iraq business messages most, and four diaspora
// ones) in the formats people really write, checked against the reviewer's own knowledge of the plans; the guesses
// that would put a typo in another country; things that look like numbers and are not, in a chat export and an
// invoice. Then formats (RFC 4180 corners, vCard variants, real workbooks built here with a stored and a deflated
// zip, encodings), hostility (timed), dedupe and counts, the assistant's tool, masks and the report, and what the
// People step tells the person.
//
// Every millisecond ceiling is `* SLOW` (as in pro-perf.test.mjs).
import { deflateRawSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  parseAudience, normalisePhone, maskPhone, makeAudience, excludeSuppressed, fromChats, countryOf,
} from '../.test-build/whatsappaudience.js';
import { readSheet, SheetError, expandNumber } from '../.test-build/whatsappsheet.js';
import { crc32 } from '../.test-build/slidespptx.js';
import { reportCsv } from '../.test-build/whatsappcampaign.js';
import { runBulkTool } from '../.test-build/whatsappbulktool.js';
import { buildUi } from './wa-ui.test.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const SLOW = process.env.CI ? 4 : 1; // a shared runner is several times slower than the machine that releases
const LIMITS = { recipients: 5_000, valueChars: 120, columns: 12 };
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`.slice(0, 600)}`); }
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
const phones = (p) => p.recipients.map((r) => r.phone);
const enc = (s) => new TextEncoder().encode(s);
async function timed(f) { const t = performance.now(); const v = await f(); return [v, performance.now() - t]; }
/** Parse that must not throw; a throw is a failure of its own. */
async function safe(name, input, o) {
  try { return await parseAudience(input, o); } catch (e) { ok(`${name}: parseAudience never throws`, false, String(e)); return null; }
}

// ── 1. phone numbers, country by country ─────────────────────────────────────
//
// Each row: [as written, the number it must become (or the reason it must be refused), note]. The expected numbers
// come from the reviewer's knowledge of each national plan (docs/wa/review-parse.md, "Numbering plans").

const LRE = '‪', PDF = '‬', LRM = '‎', RLM = '‏';
const NO = (why) => ({ why });
/** Refused, for any reason: where two readings disagree the reason given is the first reading's. */
const REJ = { why: '*' };
const same = (got, want) => (want === REJ ? 'why' in got : JSON.stringify(got) === JSON.stringify(want));
const PLANS = {
  // Iraq: mobiles 07x xxx xxxx (10-digit NSN: Korek 75x, Asiacell 77x, Zain 78x/79x); Baghdad 01 + 7; governorates
  // two-digit area code + 6 or 7 (Erbil 66, Sulaymaniyah 53, Duhok 62, Basra 40).
  '964': [
    ['0750 123 4567', '9647501234567'], ['+964 750 123 4567', '9647501234567'], ['00964 750 123 4567', '9647501234567'],
    ['750 123 4567', '9647501234567', 'Excel dropped the zero'], ['0750-123-4567', '9647501234567'],
    ['(0750) 123 4567', '9647501234567'], ['٠٧٥٠ ١٢٣ ٤٥٦٧', '9647501234567', 'Arabic-Indic'], ['۰۷۵۰ ۱۲۳ ۴۵۶۷', '9647501234567', 'Persian'],
    [`${LRE}+964 750 123 4567${PDF}`, '9647501234567', 'WhatsApp export'], [`${RLM}0750 123 4567${LRM}`, '9647501234567'],
    ['964 750 123 4567', '9647501234567'], ['+964 (0)750 123 4567', '9647501234567'], ['9647501234567', '9647501234567'],
    ['0751 234 5678', '9647512345678'], ['0770 123 4567', '9647701234567'], ['0771 123 4567', '9647711234567'],
    ['0772 123 4567', '9647721234567'], ['0780 123 4567', '9647801234567'], ['0781 123 4567', '9647811234567'],
    ['0782 123 4567', '9647821234567'], ['0790 123 4567', '9647901234567'], ['0791 123 4567', '9647911234567'],
    ['01 543 2100', '96415432100', 'Baghdad landline'], ['066 225 1234', '964662251234', 'Erbil landline'],
    ['053 330 1234', '964533301234', 'Sulaymaniyah'], ['062 722 1234', '964627221234', 'Duhok'], ['040 612 345', '96440612345', 'Basra, six-digit subscriber'],
    ['0750 123 456', NO('too-short')], ['0750 123 45678', NO('too-long')], ['7.501234567E+09', '9647501234567', 'Excel scientific, exact'],
  ],
  // Türkiye: ten-digit NSN; mobiles 5xx (Turkcell 53x, Vodafone 54x, Türk Telekom 50x/55x); trunk 0.
  '90': [
    ['0532 123 45 67', '905321234567'], ['+90 532 123 45 67', '905321234567'], ['0090 532 123 4567', '905321234567'],
    ['532 123 45 67', '905321234567'], ['0(532) 123-45-67', '905321234567'], ['۰۵۳۲ ۱۲۳ ۴۵ ۶۷', '905321234567'],
    ['05321234567', '905321234567'], ['+90 (532) 123 4567', '905321234567'], ['0505 123 45 67', '905051234567'],
    ['0212 345 67 89', '902123456789', 'Istanbul landline'], ['0532 123 45 6', NO('too-short')],
  ],
  // Iran: ten-digit NSN; mobiles 9xx (MCI 91x/99x, Irancell 93x/90x, Rightel 92x); Tehran 21 + 8.
  '98': [
    ['0912 345 6789', '989123456789'], ['+98 912 345 6789', '989123456789'], ['0098 912 345 6789', '989123456789'],
    ['912 345 6789', '989123456789'], ['۰۹۱۲ ۳۴۵ ۶۷۸۹', '989123456789'], ['٠٩١٢٣٤٥٦٧٨٩', '989123456789'],
    ['0935-123-4567', '989351234567'], ['+98 (0) 912 345 6789', '989123456789'], ['0998 123 4567', '989981234567'],
    ['021 8812 3456', '982188123456', 'Tehran landline'], ['0912 345 678', NO('too-short')],
  ],
  // Syria: mobiles 09x xxx xxx (9-digit NSN); Damascus 011 + 7.
  '963': [
    ['0944 123 456', '963944123456'], ['+963 944 123 456', '963944123456'], ['00963 944 123 456', '963944123456'],
    ['944 123 456', '963944123456'], ['0933-123-456', '963933123456'], ['٠٩٤٤ ١٢٣ ٤٥٦', '963944123456'],
    ['+963 (0)944 123456', '963944123456'], ['011 223 4567', '963112234567', 'Damascus landline'], ['0944 123 45', NO('too-short')],
  ],
  // Saudi Arabia: mobiles 05x xxx xxxx (9-digit NSN starting 5); Riyadh 011 + 7.
  '966': [
    ['050 123 4567', '966501234567'], ['+966 50 123 4567', '966501234567'], ['00966 50 123 4567', '966501234567'],
    ['50 123 4567', '966501234567'], ['0501234567', '966501234567'], ['٠٥٥ ١٢٣ ٤٥٦٧', '966551234567'],
    ['+966 (0) 50 123 4567', '966501234567'], ['011 234 5678', '966112345678', 'Riyadh landline'], ['050 123 456', NO('too-short')],
  ],
  // UAE: mobiles 05x xxx xxxx (9-digit NSN); landlines 0N xxx xxxx (8: Dubai 4, Abu Dhabi 2).
  '971': [
    ['050 123 4567', '971501234567'], ['+971 50 123 4567', '971501234567'], ['00971 50 123 4567', '971501234567'],
    ['50 123 4567', '971501234567'], ['055-123-4567', '971551234567'], ['٠٥٢ ١٢٣ ٤٥٦٧', '971521234567'],
    ['+971 (0)50 123 4567', '971501234567'], ['04 123 4567', '97141234567', 'Dubai landline'], ['050 123 45', NO('too-short')],
  ],
  // Kuwait: eight digits, no trunk; mobiles 4/5/6/9, landlines 2.
  '965': [
    ['9912 3456', '96599123456'], ['+965 9912 3456', '96599123456'], ['00965 9912 3456', '96599123456'],
    ['99123456', '96599123456'], ['6555-1234', '96565551234'], ['٥٠٠٠ ١٢٣٤', '96550001234'],
    ['+965 2245 6789', '96522456789', 'landline'], ['965 9912 3456', '96599123456'], ['9912 345', NO('too-short')], ['9912 34567', NO('too-long')],
  ],
  // Jordan: mobiles 07x xxx xxxx (9-digit NSN: 77/78/79); Amman 06 + 7.
  '962': [
    ['079 123 4567', '962791234567'], ['+962 79 123 4567', '962791234567'], ['00962 79 123 4567', '962791234567'],
    ['79 123 4567', '962791234567'], ['077-123-4567', '962771234567'], ['٠٧٨ ١٢٣ ٤٥٦٧', '962781234567'],
    ['+962 (0)79 123 4567', '962791234567'], ['06 512 3456', '96265123456', 'Amman landline'], ['079 123 456', NO('too-short')],
  ],
  // Lebanon: mobiles 03 xxx xxx (7-digit NSN) and 70/71/76/78/79/81 xxx xxx (8, written without the 0); landlines
  // 0N xxx xxx (7: Beirut 1).
  '961': [
    ['03 123 456', '9613123456'], ['+961 3 123 456', '9613123456'], ['00961 3 123 456', '9613123456'],
    ['70 123 456', '96170123456'], ['+961 71 123 456', '96171123456'], ['81 123 456', '96181123456'],
    ['٠٣ ١٢٣ ٤٥٦', '9613123456'], ['01 123 456', '9611123456', 'Beirut landline'], ['76-123-456', '96176123456'],
    ['3 123 45', NO('too-short')],
  ],
  // Egypt: mobiles 01x xxxx xxxx (10-digit NSN: 10, 11, 12, 15); Cairo 02 + 8, Alexandria 03 + 7.
  '20': [
    ['010 1234 5678', '201012345678'], ['+20 10 1234 5678', '201012345678'], ['0020 10 1234 5678', '201012345678'],
    ['10 1234 5678', '201012345678'], ['0111-234-5678', '201112345678'], ['٠١٢ ٣٤٥٦ ٧٨٩٠', '201234567890'],
    ['+20 (0)15 1234 5678', '201512345678'], ['02 2345 6789', '20223456789', 'Cairo landline'], ['03 456 7890', '2034567890', 'Alexandria'],
    ['010 1234 567', NO('too-short')],
  ],
  // Germany: mobiles 015x/016x/017x (10 or 11-digit NSN); landlines area code + subscriber, 6 to 11.
  '49': [
    ['0151 23456789', '4915123456789'], ['+49 151 23456789', '4915123456789'], ['0049 151 23456789', '4915123456789'],
    ['151 23456789', '4915123456789'], ['0170 1234567', '491701234567'], ['+49 (0)176 1234 5678', '4917612345678'],
    ['0176-1234-5678', '4917612345678'], ['030 1234 5678', '493012345678', 'Berlin landline'], ['089 1234567', '49891234567'],
  ],
  // Sweden: mobiles 07x-xxx xx xx (9-digit NSN: 70/72/73/76/79); Stockholm 08 + 5 to 8.
  '46': [
    ['070-123 45 67', '46701234567'], ['+46 70 123 45 67', '46701234567'], ['0046 70 123 45 67', '46701234567'],
    ['70 123 45 67', '46701234567'], ['073-123 45 67', '46731234567'], ['+46 (0)70 123 45 67', '46701234567'],
    ['08-123 456 78', '46812345678', 'Stockholm landline'], ['031-123 45 67', '46311234567'], ['076 123 45 67', '46761234567'],
  ],
  // United Kingdom: ten-digit NSN (mobiles 07xxx xxxxxx), a few nine-digit landlines.
  '44': [
    ['07911 123456', '447911123456'], ['+44 7911 123456', '447911123456'], ['0044 7911 123456', '447911123456'],
    ['7911 123456', '447911123456'], ['+44 (0)7911 123456', '447911123456'], ['07911-123-456', '447911123456'],
    ['020 7946 0018', '442079460018', 'London landline'], ['(0161) 496 0000', '441614960000'], ['07911 12345', NO('too-short')],
  ],
  // North America: NXX NXX XXXX, where N is 2-9 (an area code or an exchange never starts with 0 or 1); trunk 1.
  '1': [
    ['(202) 555-0123', '12025550123'], ['202-555-0123', '12025550123'], ['202.555.0123', '12025550123'],
    ['+1 202 555 0123', '12025550123'], ['1 202 555 0123', '12025550123'], ['1-202-555-0123', '12025550123'],
    ['001 202 555 0123', '12025550123'], ['2025550123', '12025550123'], ['+1 (415) 555-2671', '14155552671'],
    ['(123) 555-0123', REJ, 'area code 123 does not exist'], ['(202) 155-0123', NO('not-a-number'), 'exchange 155 does not exist'],
    ['0123456789', NO('not-a-number')], ['+1 012 555 0123', NO('not-a-number')],
  ],
  // Russia and Kazakhstan share +7: NSN of ten; Russia 3xx/4xx/8xx landlines and 9xx mobiles, Kazakhstan 7xx (6xx
  // reserved). Nothing starts with 0, 1, 2 or 5. Trunk 8.
  '7': [
    ['8 912 345-67-89', '79123456789'], ['+7 912 345 67 89', '79123456789'], ['8 (912) 345-67-89', '79123456789'],
    ['9123456789', '79123456789'], ['+7 701 123 4567', '77011234567', 'Kazakhstan mobile'], ['8 701 123 45 67', '77011234567'],
    ['+7 727 123 4567', '77271234567', 'Almaty landline'], ['+7 (495) 123-45-67', '74951234567', 'Moscow landline'],
    ['+7 512 345 6789', NO('not-a-number'), 'no +7 number starts with 5'], ['+7 012 345 6789', NO('not-a-number')],
  ],
};
console.log('1. Phone numbers, country by country');
for (const [code, rows] of Object.entries(PLANS)) {
  ok(`+${code}: at least eight formats written down`, rows.length >= 8, rows.length);
  for (const [raw, want, note] of rows) {
    const got = normalisePhone(raw, code);
    const w = typeof want === 'string' ? { phone: want } : want;
    ok(`+${code} ${JSON.stringify(raw)}${note ? ` (${note})` : ''}`, same(got, w), { got, want: w });
  }
}
{
  // Mobiles are not warned about; landlines are (a gentle hint, never a rejection).
  const mob = await parseAudience('0750 123 4567\n0751 234 5678\n0770 123 4567\n0771 123 4567\n0780 123 4567\n0790 123 4567\n');
  ok('Iraq: Korek, Asiacell and Zain mobiles carry no warning', mob.recipients.length === 6 && !mob.warned, mob.warned);
  const land = await parseAudience('01 543 2100\n066 225 1234\n');
  eq('Iraq: landlines are kept and warned about', [phones(land), (land.warned ?? []).map((w) => w.why)], [['96415432100', '964662251234'], ['not-mobile', 'not-mobile']]);
  const tr = await parseAudience('0212 345 67 89\n0532 123 45 67\n', { defaultCountry: '90' });
  eq('Türkiye: 5xx is a mobile, 212 is not', (tr.warned ?? []).map((w) => w.phone), ['902123456789']);
  const ir = await parseAudience('021 8812 3456\n0912 345 6789\n', { defaultCountry: '98' });
  eq('Iran: 9xx is a mobile, 21 is not', (ir.warned ?? []).map((w) => w.phone), ['982188123456']);
  const sa = await parseAudience('011 234 5678\n050 123 4567\n', { defaultCountry: '966' });
  eq('Saudi: 5x is a mobile, 11 is not', (sa.warned ?? []).map((w) => w.phone), ['966112345678']);
  const ae = await parseAudience('04 123 4567\n050 123 4567\n', { defaultCountry: '971' });
  eq('UAE: 5x is a mobile, 4 is not', (ae.warned ?? []).map((w) => w.phone), ['97141234567']);
  const eg = await parseAudience('02 2345 6789\n010 1234 5678\n', { defaultCountry: '20' });
  eq('Egypt: 1x is a mobile, 2 is not', (eg.warned ?? []).map((w) => w.phone), ['20223456789']);
  const ru = await parseAudience('+7 495 123 45 67\n+7 912 345 67 89\n+7 701 123 4567\n+7 727 123 4567\n');
  eq('+7: Russian 9xx and Kazakh 70x are mobiles; Moscow 495 and Almaty 727 are not', (ru.warned ?? []).map((w) => w.phone), ['74951234567', '77271234567']);
  const lb = await parseAudience('01 123 456\n03 123 456\n70 123 456\n', { defaultCountry: '961' });
  eq('Lebanon: 3 and 70 are mobiles, Beirut 1 is not', (lb.warned ?? []).map((w) => w.phone), ['9611123456']);
}

console.log('1b. A number valid in two countries: the guess must not land on a stranger');
{
  const IQ = [
    ['75012345678', NO('too-long'), 'an Iraqi mobile with its zero gone and one digit too many is not +7 501…'],
    ['77012345678', NO('too-long'), '…nor a Kazakh mobile'],
    ['79123456789', NO('too-long'), '…nor a Russian one: in an Iraqi list that needs its +'],
    ['78123456789', NO('too-long')], ['74123456789', NO('too-long')],
    ['+79123456789', '79123456789', 'with its + it is Russian'],
    ['447911123456', '447911123456', 'a British number in WhatsApp form still reads'],
    ['905321234567', '905321234567'], ['989123456789', '989123456789'], ['966501234567', '966501234567'],
    ['12025550123', '12025550123', 'an American number in WhatsApp form still reads'],
    ['17501234567', NO('too-long'), 'not a North American number: exchange 123'],
    ['10100200150', NO('too-long'), 'not a North American number: area code 010'],
    ['4915123456789', '4915123456789'],
  ];
  for (const [raw, want, note] of IQ) eq(`+964 default: ${raw}${note ? ` (${note})` : ''}`, normalisePhone(raw, '964'), typeof want === 'string' ? { phone: want } : want);
  eq('+90 default: a Turkish mobile with one digit too many is not Nicaraguan', normalisePhone('50512345678', '90'), NO('too-long'));
  eq('+90 default: 5xx typo is not Peruvian either', normalisePhone('51212345678', '90'), NO('too-long'));
  eq('+98 default: an Iranian mobile with one digit too many is not Afghan', normalisePhone('93701234567', '98'), NO('too-long'));
  eq('+98 default: an Iraqi mobile in WhatsApp form still reads', normalisePhone('9647501234567', '98'), { phone: '9647501234567' });
  eq('+98 default: a Turkish mobile in WhatsApp form still reads', normalisePhone('905321234567', '98'), { phone: '905321234567' });
  eq('countryOf: +7 is one code for two countries', [countryOf('79123456789'), countryOf('77011234567')], ['7', '7']);
}

console.log('1c. Things that look like phone numbers and are not');
{
  const chat = [
    `04/10/2026, 10:15 - ${LRE}+964 750 123 4567${PDF}: سلام، کەی دەکرێتەوە؟`,
    '04/10/2026, 10:16 - Rebaz: order 20261004001 for 125,000 IQD, ref 4471-9921-3301',
    `04/10/2026, 10:17 - ${LRE}+964 770 987 6543${PDF}: my brother's number is 0751 222 3344, call him`,
    '04/10/2026, 10:18 - Rebaz: price 1.250.000 dinar, version 2.10.3.45678, ip 192.168.100.200 and 10.100.200.150',
    '04.10.2026 10:19 - Layla: meet at 36.191113, 44.009167 tomorrow 2026-10-05 at 10:30',
    '[04.10.2026 10:20:11] Ahmed: ISBN 978-3-16-148410-0 and 9783161484100',
    '[2026-10-04 10:21:09] Ahmed: years 2026 and 1999-2026, card 4111 1111 1111 1111',
    '04/10/2026, 10:22 - Sara: IMEI 356938035643809, order #7501234567, total 12 500 000 IQD',
    '04/10/2026, 10:23 - Sara: coordinates 36.1911, 43.9930 and 13:45:00',
  ].join('\n');
  const p = await parseAudience(chat);
  eq('a messy WhatsApp chat export: exactly the three phone numbers in it, none named', p.recipients.map((r) => [r.phone, r.name ?? '']),
    [['9647501234567', ''], ['9647709876543', ''], ['9647512223344', '']]);
  ok('…and nothing in it is reported as a bad line (it is prose)', p.rejected.length === 0, p.rejected);

  const invoice = [
    'INVOICE #INV-2026-00451', 'Invoice No: 20261004451', 'Date: 04.10.2026   Due: 2026-11-04', 'Customer: Rebaz Ahmed',
    'Tel: 0750 123 4567', 'Item              Qty   Price', 'Phone case         2    15,000', 'Total: 12 500 000 IQD',
    'Price 25.000.000', 'Account: 0123 4567 8901 2345', 'IBAN: IQ20 CBIQ 8618 0010 0000 000', 'Order 7501234567',
    'Order #7501234568', 'Ref 75012345678', 'Serial 10100200150', 'ID 12345678901', 'Barcode 6281234567890',
    '36.191113, 44.009167', '10.100.200.150', '172.16.254.100', '1999-2026', '04.10.2026 10:19',
  ].join('\n');
  const inv = await parseAudience(invoice);
  eq('an invoice: only the customer\'s phone, and nobody called "Account", "Ref", "Order" or "Total"', inv.recipients.map((r) => [r.phone, r.name ?? '']),
    [['9647501234567', '']]);
  for (const line of ['36.191113, 44.009167', '10.100.200.150', '172.16.254.100', '1999-2026', '04.10.2026 10:19', '2026-10-04 10:15:00',
    'Total: 12 500 000 IQD', '25.000.000 IQD', '$ 7501234567', 'Account: 0123 4567 8901 2345', '4111 1111 1111 1111']) {
    const one = await parseAudience(line);
    eq(`not a person: ${JSON.stringify(line)}`, phones(one), []);
  }
  // …and the formats a list really uses still read.
  for (const [line, want] of [['0750.123.4567', '9647501234567'], ['04.10.2026 0750 123 4567', '9647501234567'],
    ['07501234567 07701234567', '9647501234567,9647701234567'], ['Rebaz 0750 123 4567', '9647501234567']]) {
    eq(`still a person: ${JSON.stringify(line)}`, phones(await parseAudience(line)).join(), want);
  }
  eq('still a person, US default: 202.555.0123', phones(await parseAudience('202.555.0123', { defaultCountry: '1' })), ['12025550123']);
}

// ── 2. formats ───────────────────────────────────────────────────────────────

console.log('2a. CSV: RFC 4180 corners');
{
  const csv = async (text, o = {}) => parseAudience(typeof text === 'string' ? enc(text) : text, { filename: 'list.csv', ...o });
  const p1 = await csv('Name,Phone,Note\n"Ahmed, Jr.","0750 123 4567","said ""hi""\nthen left"\n"Sa""ra",0751 222 3344,\n');
  eq('quotes, doubled quotes, a comma and a line break in cells', p1.recipients.map((r) => [r.phone, r.name, r.vars.Note ?? '']),
    [['9647501234567', 'Ahmed, Jr.', 'said "hi" then left'], ['9647512223344', 'Sa"ra', '']]);
  const p2 = await csv('﻿Name;Phone\r\nRebaz;0750 123 4567\r\n');
  eq('a BOM, ";" and CRLF', [p2.phoneColumn, p2.nameColumn, phones(p2)], ['Phone', 'Name', ['9647501234567']]);
  const p3 = await csv('Name\tPhone\nRebaz\t0750 123 4567\n', { filename: 'list.tsv' });
  eq('a tab', [p3.format, p3.nameColumn, phones(p3)], ['tsv', 'Name', ['9647501234567']]);
  const p4 = await csv('Name,Phone\n');
  eq('a header and nothing else: nobody, nothing rejected', [p4.recipients.length, p4.rejected.length], [0, 0]);
  const p5 = await csv('\n\nName,Phone\n\n\nRebaz,0750 123 4567\n\n\nLayla,0751 222 3344\n\n');
  eq('empty lines around and between rows; the line numbers are the file\'s', [p5.nameColumn, phones(p5)], ['Name', ['9647501234567', '9647512223344']]);
  const ragged = await csv('Name,Phone\nRebaz,0750 123 4567,Erbil,VIP\nLayla\n,0751 222 3344\nDara,0770 111 2233\nSoz,0780 111 2233,Duhok\n');
  eq('ragged rows keep the header and the names', [ragged.nameColumn, ragged.recipients.map((r) => [r.phone, r.name ?? ''])],
    ['Name', [['9647501234567', 'Rebaz'], ['9647512223344', ''], ['9647701112233', 'Dara'], ['9647801112233', 'Soz']]]);
  const quoted = await csv('"Name","Phone"\n"Rebaz","0750 123 4567\n');
  ok('a quote that never closes does not swallow the file', phones(quoted).length === 1, phones(quoted));
  const rows = ['name,phone'];
  for (let i = 0; i < 50_000; i++) rows.push(`P${i},07${String(500_000_000 + i).padStart(9, '0')}`);
  const [big, ms] = await timed(() => csv(rows.join('\n')));
  ok(`50,000 rows: 5,000 people, truncated, in ${ms.toFixed(0)} ms (< ${400 * SLOW})`, big.recipients.length === 5000 && big.truncated === true && ms < 400 * SLOW, { n: big.recipients.length, ms });
}

console.log('2b. Headers in six languages, two phone columns, Excel\'s numbers');
{
  const h = async (head, row, country = '964') => parseAudience(enc(`${head}\n${row}\n`), { filename: 'h.csv', defaultCountry: country });
  for (const [head, row, country, phone, name] of [
    ['Name,Phone', 'Rebaz,0750 123 4567', '964', 'Phone', 'Name'],
    ['الاسم,رقم الهاتف', 'ريباز,07501234567', '964', 'رقم الهاتف', 'الاسم'],
    ['الاسم,الجوال', 'ريباز,0501234567', '966', 'الجوال', 'الاسم'],
    ['ناو,ژمارەی مۆبایل', 'ڕێباز,٠٧٥٠١٢٣٤٥٦٧', '964', 'ژمارەی مۆبایل', 'ناو'],
    ['ناڤ,ژمارا تەلەفۆنێ', 'رێباز,07501234567', '964', 'ژمارا تەلەفۆنێ', 'ناڤ'],
    ['Ad Soyad;Cep Telefonu', 'Ahmet Yılmaz;0532 123 45 67', '90', 'Cep Telefonu', 'Ad Soyad'],
    ['نام,شماره همراه', 'علی,۰۹۱۲۳۴۵۶۷۸۹', '98', 'شماره همراه', 'نام'],
  ]) {
    const p = await h(head, row, country);
    eq(`header ${JSON.stringify(head)}`, [p.phoneColumn, p.nameColumn, p.recipients.length], [phone, name, 1]);
  }
  // A phone column and a mobile column: WhatsApp is on the mobile, and a row whose phone cell is empty still has one.
  const two = await parseAudience(enc('Name,Phone,Mobile\nAra,066 222 1234,0750 123 4567\nBroosk,,0751 222 3344\nChra,066 222 9999,\nDilan,0770 111 2233,\n'), { filename: 'two.csv' });
  eq('phone + mobile columns: the mobile is used, and a row with only a mobile is not lost', two.recipients.map((r) => [r.name, r.phone]),
    [['Ara', '9647501234567'], ['Broosk', '9647512223344'], ['Chra', '964662229999'], ['Dilan', '9647701112233']]);
  ok('…nobody was rejected as empty', two.rejected.length === 0, two.rejected);
  const chosen = await parseAudience(enc('Name,Phone,Mobile\nAra,066 222 1234,0750 123 4567\nBroosk,,0751 222 3344\n'), { filename: 'two.csv', phoneColumn: 'Phone' });
  eq('…but a column the person chose is the column used', [phones(chosen), chosen.rejected.map((r) => r.line)], [['964662221234'], [3]]);
  // Excel's floats in a CSV: only a number written with every digit is a number.
  const sci = await parseAudience(enc('Name,Phone\nA,9.64750123456E+11\nB,7.5012345E+09\nC,9.647501234567E+12\nD,7.501234567E+09\nE,9.6475012346E+12\n'), { filename: 'x.csv' });
  eq('CSV scientific numbers: only the exact ones are read', sci.recipients.map((r) => [r.name, r.phone]), [['C', '9647501234567']]);
  ok('…D is C again (a duplicate, not a second person)', sci.duplicates === 1, sci.duplicates);
  eq('…every rounded one says so (A is exact, and simply one digit short)', sci.rejected.map((r) => [r.raw, r.why, r.hint ?? '']),
    [['9.64750123456E+11', 'too-short', ''], ['7.5012345E+09', 'not-a-number', 'excel-rounded'], ['9.6475012346E+12', 'not-a-number', 'excel-rounded']]);
  eq('expandNumber still says how many zeros were written in', expandNumber('7.5012345E+09'), { digits: '7501234500', padded: 2 });
}

console.log('2c. vCard');
{
  const card = (body, v = '3.0') => `BEGIN:VCARD\r\nVERSION:${v}\r\n${body}\r\nEND:VCARD\r\n`;
  const qp = await parseAudience(card('N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=D8=B1=D9=8A=D8=A8=D8=A7=\r\n=D8=B2;;;\r\nTEL;CELL:0750 123 4567', '2.1'));
  eq('2.1: quoted-printable Arabic with a soft line break, N only', qp.recipients.map((r) => [r.phone, r.name]), [['9647501234567', 'ريباز']]);
  const v3 = await parseAudience(card('FN:Layla\r\n Karim\r\nTEL;TYPE=CELL;TYPE=VOICE:+964 751 222 3344'));
  eq('3.0: a folded FN and TEL;TYPE=CELL;TYPE=VOICE', v3.recipients.map((r) => [r.phone, r.name]), [['9647512223344', 'LaylaKarim']]);
  const ios = await parseAudience(card('FN:Dara\r\nitem1.TEL:0662251234\r\nitem1.X-ABLabel:_$!<Work>!$_\r\nitem2.TEL:0770 111 2233\r\nitem2.X-ABLabel:_$!<Mobile>!$_'));
  eq('iPhone groups: item2.TEL labelled Mobile is the person', phones(ios), ['9647701112233']);
  const v4 = await parseAudience(card('FN:Kurt\r\nTEL;VALUE=uri;TYPE="cell,voice":tel:+49-151-2345-6789;ext=1', '4.0'));
  eq('4.0: tel: URI', phones(v4), ['4915123456789']);
  const five = await parseAudience(card('FN:Five\r\nTEL;CELL:0750 123 4567\r\nTEL;HOME:066 222 1234\r\nTEL;CELL:0770 111 2233\r\nTEL;WORK:066 222 9999\r\nTEL;CELL:0780 111 2233\r\nTEL;CELL:0790 111 2233'));
  eq('a card with six numbers: at most three, all mobiles', phones(five), ['9647501234567', '9647701112233', '9647801112233']);
  const cards = [];
  for (let i = 0; i < 1000; i++) {
    const n = `07${String(500_000_000 + i).padStart(9, '0')}`;
    cards.push(i === 500 ? `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Broken ${i}\r\nTEL;CELL:${n}\r\n` : card(`FN:P${i}\r\nTEL;CELL:${n}`));
  }
  const [many, ms] = await timed(() => parseAudience(cards.join('')));
  ok(`a thousand cards, one without its END: the 999 others and the broken one are all read (${ms.toFixed(0)} ms < ${300 * SLOW})`, many.recipients.length === 1000 && ms < 300 * SLOW, many.recipients.length);
  const agent = await parseAudience('BEGIN:VCARD\r\nVERSION:2.1\r\nFN:Boss\r\nTEL;CELL:0750 123 4567\r\nAGENT:\r\nBEGIN:VCARD\r\nVERSION:2.1\r\nFN:Assistant\r\nTEL;CELL:0770 111 2233\r\nEND:VCARD\r\nEND:VCARD\r\n');
  eq('a 2.1 AGENT card inside a card is still passed over', phones(agent), ['9647501234567']);
}

console.log('2d. Workbooks, built here');
/** A zip: entries [name, text|bytes, { deflate, method, flags, claim, body }]; `zip64` writes a ZIP64 end. */
function zipOf(files, { zip64 = false } = {}) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, data, o = {}] of files) {
    const raw = typeof data === 'string' ? enc(data) : data;
    const body = o.body ?? (o.deflate ? new Uint8Array(deflateRawSync(raw)) : raw);
    const method = o.method ?? (o.deflate || o.body ? 8 : 0);
    const nm = enc(name);
    const size = o.claim ?? raw.length;
    const crc = o.body ? 0 : crc32(raw);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, (o.flags ?? 0) | 0x0800, true);
    local.setUint16(8, method, true); local.setUint32(14, crc, true); local.setUint32(18, body.length, true);
    local.setUint32(22, size, true); local.setUint16(26, nm.length, true);
    chunks.push(new Uint8Array(local.buffer), nm, body);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true);
    dir.setUint16(8, (o.flags ?? 0) | 0x0800, true); dir.setUint16(10, method, true); dir.setUint32(16, crc, true);
    dir.setUint32(20, body.length, true); dir.setUint32(24, size, true); dir.setUint16(28, nm.length, true); dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nm);
    offset += 30 + nm.length + body.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, zip64 ? 0xffff : files.length, true); end.setUint16(10, zip64 ? 0xffff : files.length, true);
  end.setUint32(12, zip64 ? 0xffffffff : size, true); end.setUint32(16, zip64 ? 0xffffffff : offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let at = 0;
  for (const c of all) { out.set(c, at); at += c.length; }
  return out;
}
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const xesc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const col = (i) => String.fromCharCode(65 + i);
/**
 * A real workbook: sheets [{ name, state, rows }] where a cell is a string (a shared string), `{ n }` (a number as
 * Excel writes it), `{ inline }`, `{ date }` (a serial with a date style) or null. Shared strings are written once.
 */
function workbook(sheets, { deflate = true, macro = false, merge = '', strings: own } = {}) {
  const strings = [];
  const sid = (s) => { let i = strings.indexOf(s); if (i < 0) { i = strings.length; strings.push(s); } return i; };
  const parts = sheets.map((sh, k) => {
    const rows = sh.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => {
      const ref = `${col(ci)}${ri + 1}`;
      if (c === null || c === undefined) return '';
      if (typeof c === 'string') return `<c r="${ref}" t="s"><v>${sid(c)}</v></c>`;
      if ('n' in c) return `<c r="${ref}"><v>${c.n}</v></c>`;
      if ('date' in c) return `<c r="${ref}" s="1"><v>${c.date}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xesc(c.inline)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const m = k === 0 && merge ? `<mergeCells count="1"><mergeCell ref="${merge}"/></mergeCells>` : '';
    return [`xl/worksheets/sheet${k + 1}.xml`, `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}"><sheetData>${rows}</sheetData>${m}</worksheet>`, { deflate }];
  });
  const sst = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${NS}" count="${strings.length}" uniqueCount="${strings.length}">${(own ?? strings).map((s) => `<si><t xml:space="preserve">${xesc(s)}</t></si>`).join('')}</sst>`;
  const main = macro ? 'application/vnd.ms-excel.sheet.macroEnabled.main+xml' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
  const types = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${main}"/></Types>`;
  const book = `<?xml version="1.0"?><workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>${sheets.map((sh, k) => `<sheet name="${xesc(sh.name ?? `Sheet${k + 1}`)}" sheetId="${k + 1}"${sh.state ? ` state="${sh.state}"` : ''} r:id="rId${k + 1}"/>`).join('')}</sheets></workbook>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, k) => `<Relationship Id="rId${k + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${k + 1}.xml"/>`).join('')}<Relationship Id="rIdS" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
  const rootRels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  return zipOf([
    ['[Content_Types].xml', types, { deflate }], ['_rels/.rels', rootRels, { deflate }], ['xl/workbook.xml', book, { deflate }],
    ['xl/_rels/workbook.xml.rels', rels, { deflate }], ...parts, ['xl/sharedStrings.xml', sst, { deflate }],
  ]);
}
const xl = (bytes, name = 'list.xlsx', o = {}) => safe(name, bytes, { filename: name, ...o });
{
  const rows = [['Name', 'Phone', 'City'], ['Rebaz', { n: '7501234567' }, 'Erbil'], ['Layla', { inline: '0751 222 3344' }, { inline: 'Duhok' }],
    ['Dara', { n: '9.647701112233E+12' }, null], ['Soz', { n: '9647801112233' }, 'Zakho'], ['Ari', { n: '7.901112233E9' }, 'Akre']];
  for (const deflate of [false, true]) {
    const p = await xl(workbook([{ rows }], { deflate }));
    eq(`${deflate ? 'deflated' : 'stored'} workbook: shared and inline strings, numbers as numbers, floats, scientific`,
      p && p.recipients.map((r) => [r.name, r.phone, r.vars.City ?? '']),
      [['Rebaz', '9647501234567', 'Erbil'], ['Layla', '9647512223344', 'Duhok'], ['Dara', '9647701112233', ''], ['Soz', '9647801112233', 'Zakho'], ['Ari', '9647901112233', 'Akre']]);
  }
  const dated = await xl(workbook([{ rows: [['Name', 'Joined', 'Phone'], ['Rebaz', { date: 45123 }, { n: '7501234567' }], ['Layla', { date: 45200 }, { n: '7512223344' }]] }]));
  eq('a date column (an Excel serial) is not taken for the phone', [dated.phoneColumn, phones(dated)], ['Phone', ['9647501234567', '9647512223344']]);
  const merged = await xl(workbook([{ rows: [['Customers, October'], ['Name', 'Phone'], ['Rebaz', { n: '7501234567' }]] }], { merge: 'A1:B1' }));
  eq('a merged title row above the header', [merged.nameColumn, merged.recipients.map((r) => r.name)], ['Name', ['Rebaz']]);
  const hidden = await xl(workbook([{ name: 'Lookup', state: 'hidden', rows: [['Code', 'Phone'], ['X', { n: '7709998877' }]] },
    { name: 'Customers', rows: [['Name', 'Phone'], ['Rebaz', { n: '7501234567' }]] }]));
  eq('a hidden first sheet is passed over', phones(hidden), ['9647501234567']);
  const two = await xl(workbook([{ rows: [['Name', 'Phone'], ['First', { n: '7501234567' }]] }, { rows: [['Name', 'Phone'], ['Second', { n: '7701234567' }]] }]));
  eq('several visible sheets: the first is the one read', two.recipients.map((r) => r.name), ['First']);
  const macro = await xl(workbook([{ rows: [['Name', 'Phone'], ['Rebaz', { n: '7501234567' }]] }], { macro: true }), 'list.xlsm');
  eq('.xlsm (macro-enabled) reads the same, macros never opened', phones(macro), ['9647501234567']);

  const lots = [['Name', 'Phone']];
  for (let i = 0; i < 100_000; i++) lots.push([{ inline: `P${i}` }, { n: String(7_500_000_000 + i) }]);
  const bigBook = workbook([{ rows: lots }]);
  const [big, ms] = await timed(() => xl(bigBook));
  ok(`100,000 rows (${(bigBook.length / 1048576).toFixed(1)} MB zipped): 5,000 people, truncated, ${ms.toFixed(0)} ms (< ${4000 * SLOW})`,
    big && big.recipients.length === 5000 && big.truncated === true && ms < 4000 * SLOW, big && { n: big.recipients.length, t: big.truncated, ms });

  // A bomb: 96 MB of zeros that claims 1 KB; and one that tells the truth.
  const zeros = new Uint8Array(96 * 1024 * 1024);
  const bombBody = new Uint8Array(deflateRawSync(zeros, { level: 9 }));
  const types = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;
  const lying = zipOf([['[Content_Types].xml', types], ['xl/workbook.xml', `<workbook xmlns="${NS}"/>`],
    ['xl/worksheets/sheet1.xml', zeros.subarray(0, 0), { body: bombBody, claim: 1024 }]]);
  const honest = zipOf([['[Content_Types].xml', types], ['xl/workbook.xml', `<workbook xmlns="${NS}"/>`],
    ['xl/worksheets/sheet1.xml', zeros.subarray(0, 0), { body: bombBody, claim: zeros.length }]]);
  const heap0 = process.memoryUsage().heapUsed;
  const [lie, lieMs] = await timed(() => xl(lying));
  const [tru, truMs] = await timed(() => xl(honest));
  ok(`a zip bomb that lies about its size is refused at its first chunk (${lieMs.toFixed(0)} ms)`, lie && lie.problem === 'damaged' && lieMs < 500 * SLOW, lie && lie.problem);
  ok(`one that tells the truth is refused before inflating (${truMs.toFixed(0)} ms)`, tru && tru.problem === 'too-big' && truMs < 100 * SLOW, tru && tru.problem);
  ok('…and neither held the inflated bytes', process.memoryUsage().heapUsed - heap0 < 64 * 1024 * 1024, process.memoryUsage().heapUsed - heap0);

  const good = workbook([{ rows: [['Name', 'Phone'], ['Rebaz', { n: '7501234567' }]] }]);
  for (const cut of [10, 100, good.length >> 1, good.length - 30, good.length - 1]) {
    const p = await xl(good.subarray(0, cut));
    ok(`a workbook cut at byte ${cut} is "damaged", nobody read`, p && p.problem === 'damaged' && p.recipients.length === 0, p && p.problem);
  }
  const z64 = await xl(zipOf([['[Content_Types].xml', types]], { zip64: true }));
  ok('a ZIP64 end record is refused as damaged, not misread', z64 && z64.problem === 'damaged', z64 && z64.problem);
  const enc1 = await xl(zipOf([['[Content_Types].xml', types, { flags: 1 }], ['xl/workbook.xml', `<workbook xmlns="${NS}"/>`, { flags: 1 }]]));
  ok('a zip with encrypted entries is "locked"', enc1 && enc1.problem === 'locked', enc1 && enc1.problem);
  const ole = new Uint8Array(4096); ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const enc2 = await xl(ole, 'Protected.xlsx');
  ok('a password-protected workbook (an OLE package) is "locked"', enc2 && enc2.problem === 'locked', enc2 && enc2.problem);
  const xls = await xl(ole, 'old.xls');
  ok('an old .xls is "locked" (save again as .xlsx), never parsed as text', xls && xls.problem === 'locked' && xls.recipients.length === 0, xls && xls.problem);
  const ods = await xl(zipOf([['mimetype', 'application/vnd.oasis.opendocument.spreadsheet'], ['content.xml', '<office:document-content/>']]), 'list.ods');
  ok('an .ods is "not-a-sheet", nobody read', ods && ods.problem === 'not-a-sheet' && ods.recipients.length === 0, ods && ods.problem);
  const renamed = await xl(good, 'contacts.csv');
  eq('a .csv that is really a workbook is read as one', [renamed.format, phones(renamed)], ['xlsx', ['9647501234567']]);
  const text = await xl(enc('Rebaz,0750 123 4567\n'), 'list.xlsx');
  ok('an .xlsx that is really text is "not-a-sheet"', text && text.problem === 'not-a-sheet', text && text.problem);
  let threw = null;
  try { await readSheet(lying); } catch (e) { threw = e; }
  ok('readSheet throws only SheetError', threw instanceof SheetError, String(threw));
}

console.log('2e. Encodings');
{
  /** Bytes in a legacy code page, from the platform's own table read backwards. */
  const legacy = (text, cp) => {
    const dec = new TextDecoder(cp);
    const back = new Map();
    for (let b = 0; b < 256; b++) back.set(dec.decode(new Uint8Array([b])), b);
    return new Uint8Array([...text].map((ch) => { const b = back.get(ch); if (b === undefined) throw new Error(`${ch} not in ${cp}`); return b; }));
  };
  const utf16 = (text, be, bom = true) => {
    const out = new Uint8Array((text.length + (bom ? 1 : 0)) * 2);
    let at = 0;
    const put = (c) => { out[at++] = be ? c >> 8 : c & 255; out[at++] = be ? c & 255 : c >> 8; };
    if (bom) put(0xfeff);
    for (let i = 0; i < text.length; i++) put(text.charCodeAt(i));
    return out;
  };
  const ar = 'الاسم,رقم الهاتف\r\nأحمد,07501234567\r\nريباز,0751 222 3344\r\n';
  const want = [['9647501234567', 'أحمد'], ['9647512223344', 'ريباز']];
  for (const [name, bytes] of [['UTF-8', enc(ar)], ['UTF-8 BOM', new Uint8Array([0xef, 0xbb, 0xbf, ...enc(ar)])],
    ['UTF-16LE BOM', utf16(ar, false)], ['UTF-16BE BOM', utf16(ar, true)], ['UTF-16LE, no BOM', utf16(ar, false, false)],
    ['Windows-1256 (Arabic Excel CSV)', legacy(ar, 'windows-1256')]]) {
    const p = await safe(name, bytes, { filename: 'ar.csv' });
    eq(`${name}: names and numbers`, p && p.recipients.map((r) => [r.phone, r.name]), want);
  }
  const tr = 'Ad Soyad;Cep Telefonu\r\nŞükrü Çağlayan;0532 123 45 67\r\nGül Işık;0505 123 45 67\r\n';
  const t = await safe('1254', legacy(tr, 'windows-1254'), { filename: 'tr.csv', defaultCountry: '90' });
  eq('Windows-1254 (Turkish Excel CSV)', t && t.recipients.map((r) => [r.phone, r.name]), [['905321234567', 'Şükrü Çağlayan'], ['905051234567', 'Gül Işık']]);
  const t2 = await safe('1254 under 964', legacy(tr.replace(/;0/g, ';+90 '), 'windows-1254'), { filename: 'tr.csv' });
  eq('…told apart from Arabic even with Iraq as the default country', t2 && t2.recipients.map((r) => r.name), ['Şükrü Çağlayan', 'Gül Işık']);
  // Mojibake: UTF-8 Arabic that was once read as Windows-1252 and saved again. The names cannot be recovered; the numbers can.
  const moji = new TextDecoder('windows-1252').decode(enc('أحمد')) + ',07501234567\n';
  const m = await safe('mojibake', enc(`Name,Phone\n${moji}`), { filename: 'm.csv' });
  eq('mojibake: the number still reads (the name is whatever the file says)', m && phones(m), ['9647501234567']);
}

// ── 3. hostility ─────────────────────────────────────────────────────────────

console.log('3. Hostile input: nothing throws, nothing hangs, nothing grows with a claim');
{
  const MB = 1024 * 1024;
  const fill = (unit, bytes) => unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);
  const units = ['0', '0 ', '0,', '0-', '0.', '+0', '0  ', '0   ', '0    ', '07501234567 ', '0750-', '(0', '٠', `${LRE}0`, '0​',
    '- ', 'a ', 'a,', 'Rebaz ', '"', '",', '"0,"', ';', '\t0', 'BEGIN:VCARD\n', 'TEL:0\n', '=\n', '1999-2026 ', '04.10.2026 ', '#0', '$ 0 '];
  for (const u of units) {
    for (const [size, ceiling, opt] of [[MB, 250, {}], [MB, 250, { filename: 'x.csv' }], [5 * MB, 1250, {}]]) {
      const text = fill(u, size);
      const [p, ms] = await timed(() => safe(`${JSON.stringify(u)} × ${size / MB} MB`, text, opt));
      ok(`${JSON.stringify(u)} × ${size / MB} MB${opt.filename ? ' as .csv' : ''}: ${ms.toFixed(0)} ms (< ${ceiling * SLOW}), within every limit`,
        p && ms < ceiling * SLOW && p.recipients.length <= LIMITS.recipients && p.rejected.length <= 1000 && p.recipients.every((r) => /^[1-9][0-9]{6,14}$/.test(r.phone)),
        p && { ms, n: p.recipients.length, x: p.rejected.length });
    }
  }
  const [line10, ms10] = await timed(() => safe('10 MB line', fill('ab0750 ', 10 * MB)));
  ok(`a 10 MB single line: ${ms10.toFixed(0)} ms (< ${2500 * SLOW}), cut and said so`, line10 && line10.truncated === true && ms10 < 2500 * SLOW, line10 && { ms10, t: line10.truncated });
  const [empty, msE] = await timed(() => safe('1e6 empty lines', '\n'.repeat(1_000_000) + '0750 123 4567\n'));
  ok(`a million empty lines: ${msE.toFixed(0)} ms (< ${250 * SLOW}), and the cut is said`, empty && msE < 250 * SLOW && empty.truncated === true, empty && { msE, t: empty.truncated, n: empty.recipients.length });
  const [nest, msN] = await timed(() => safe('nested quotes', `${'"'.repeat(500_000)}0750 123 4567${'"'.repeat(500_000)}\n`, { filename: 'q.csv' }));
  ok(`a megabyte of nested quotes: ${msN.toFixed(0)} ms (< ${250 * SLOW})`, nest && msN < 250 * SLOW, msN);
  const nul = await safe('NUL', enc('Name,Phone\nRe\u0000baz,0750 123 4567\nLay\u0000la,0751\u0000222 3344\n'), { filename: 'n.csv' });
  eq('NUL bytes: never in a name, and a number with a NUL in it is refused, not guessed', nul && [nul.recipients.map((r) => [r.phone, r.name]), nul.rejected.map((r) => r.why)],
    [[['9647501234567', 'Rebaz']], ['not-a-number']]);
  const bidi = await safe('bidi', enc(`Name,Phone\n‮evil‬ Name,0750​123‌4567\n⁦Layla⁩‏,${RLM}0751 222 3344${LRM}\n`), { filename: 'b.csv' });
  eq('bidi overrides and zero-width characters: gone from names, ignored in numbers', bidi && bidi.recipients.map((r) => [r.phone, r.name]),
    [['9647501234567', 'evil Name'], ['9647512223344', 'Layla']]);
  ok('…no override, isolate or mark survives in any name', bidi && bidi.recipients.every((r) => !/[‪-‮⁦-⁩‎‏؜]/.test(r.name ?? '')));
  const marks = await safe('markup', enc('Name,Phone\n<img src=x onerror=alert(1)>,0750 123 4567\n{name},0751 222 3344\n[[a|b]],0770 111 2233\n=cmd|\' /C calc\'!A0,0780 111 2233\n@SUM(A1),0790 111 2233\n'), { filename: 'm.csv' });
  eq('markup, {name}, [[a|b]] and formulas are names like any other (text, not code)', marks && marks.recipients.map((r) => r.name),
    ['<img src=x onerror=alert(1)>', '{name}', '[[a|b]]', '=cmd|\' /C calc\'!A0', '@SUM(A1)']);
  const before = Object.getOwnPropertyNames(Object.prototype).join();
  const proto = await safe('proto', enc(`Name,__proto__,constructor,{x},toString,hasOwnProperty,phone,${Array.from({ length: 14 }, (_, i) => `c${i}`).join(',')}\n`
    + `Rebaz,{"polluted":1},ctor,curly,ts,hop,0750 123 4567,${Array.from({ length: 14 }, (_, i) => `v${i}`).join(',')}\n`), { filename: 'p.csv' });
  const r0 = proto && proto.recipients[0];
  ok('headers named __proto__ / constructor do not touch Object.prototype', ({}).polluted === undefined && Object.getOwnPropertyNames(Object.prototype).join() === before);
  ok('…a variable called constructor is the column\'s own value', r0 && Object.prototype.hasOwnProperty.call(r0.vars, 'constructor') && r0.vars.constructor === 'ctor', r0 && r0.vars);
  ok('…{x} becomes x; at most twelve variables', r0 && r0.vars.x === 'curly' && Object.keys(r0.vars).length <= LIMITS.columns, r0 && Object.keys(r0.vars));
  const kept = r0 && makeAudience(proto, 'p').recipients[0];
  ok('…and saving the list keeps constructor and toString as columns', kept && kept.vars.constructor === 'ctor' && Object.prototype.hasOwnProperty.call(kept.vars, 'toString'), kept && kept.vars);
  // Fuzz the free-text reader with lines made of the pieces that matter, seeded.
  let seed = 42;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const bits = ['0750', '123', '4567', '+964', '00', ' ', '-', '.', '(', ')', ',', ';', 'Rebaz', 'order', '#', '$', '2026', '04.10.', ':', '\n', '٠٧', LRE, PDF, '"'];
  let bad = 0;
  for (let k = 0; k < 400; k++) {
    let s = '';
    for (let i = 0, n = 5 + rnd(60); i < n; i++) s += bits[rnd(bits.length)];
    const p = await safe('fuzz', s, k % 3 === 0 ? { filename: 'f.csv' } : {});
    if (!p || !p.recipients.every((r) => /^[1-9][0-9]{6,14}$/.test(r.phone)) || new Set(phones(p)).size !== p.recipients.length) bad++;
  }
  ok('400 seeded random lines: never throws, every phone is digits, none repeats', bad === 0, bad);
}

// ── 4. dedupe and counts ─────────────────────────────────────────────────────

console.log('4. Dedupe and counts');
{
  const three = await parseAudience('Rebaz, 0750 123 4567\nRebaz Ahmed, +964 750 123 4567\nR., 00964 (750) 123-45-67\n');
  eq('one person written three ways is one person (the first name wins), two duplicates', [three.recipients.map((r) => [r.phone, r.name]), three.duplicates],
    [[['9647501234567', 'Rebaz']], 2]);
  const shared = await parseAudience('Name,Phone\nRebaz,0750 123 4567\nShilan,0750 123 4567\n', { filename: 's.csv' });
  eq('two people with the same number: one message, counted as a duplicate (the first name kept)', [shared.recipients.map((r) => r.name), shared.duplicates], [['Rebaz'], 1]);
  const lines = ['Name,Phone'];
  for (let i = 0; i < 6000; i++) lines.push(`P${i},07${String(500_000_000 + i).padStart(9, '0')}`);
  for (let i = 0; i < 300; i++) lines.push(`Dup${i},07${String(500_000_000 + i).padStart(9, '0')}`);
  for (let i = 0; i < 1500; i++) lines.push(`Bad${i},12`);
  const ceil = await parseAudience(lines.join('\n'), { filename: 'c.csv' });
  ok('the 5,000 ceiling: exactly 5,000 people and truncated', ceil.recipients.length === 5000 && ceil.truncated === true, [ceil.recipients.length, ceil.truncated]);
  const junk = ['Name,Phone'];
  for (let i = 0; i < 2500; i++) junk.push(`Bad${i},12`);
  for (let i = 0; i < 40; i++) junk.push(`P${i},07${String(500_000_000 + i).padStart(9, '0')}`);
  for (let i = 0; i < 10; i++) junk.push(`D${i},07${String(500_000_000 + i).padStart(9, '0')}`);
  const j = await parseAudience(junk.join('\n'), { filename: 'j.csv' });
  eq('counts add up: people + duplicates + (rejected + rejectedMore) = rows', [j.recipients.length, j.duplicates, j.rejected.length, j.rejectedMore ?? 0,
    j.recipients.length + j.duplicates + j.rejected.length + (j.rejectedMore ?? 0)], [40, 10, 1000, 1500, 2550]);
  const sup = excludeSuppressed(j.recipients, new Set([j.recipients[0].phone, '999']));
  eq('the do-not-contact list removes exactly who is on it', [sup.kept.length, sup.removed], [39, 1]);
  const chats = fromChats([{ jid: '9647501234567@s.whatsapp.net', name: 'Rebaz' }, { jid: '9647501234567:12@s.whatsapp.net', name: 'Rebaz (laptop)' },
    { jid: '123456789012345@lid', name: 'Hidden' }, { jid: '120363000000000000@g.us', name: 'Group', group: true }, { jid: '9647512223344@s.whatsapp.net', name: '9647512223344' }]);
  eq('chats: a second device is a duplicate; a @lid and a group are never people; a name that is the number is no name',
    [chats.recipients.map((r) => [r.phone, r.name ?? '']), chats.duplicates], [[['9647501234567', 'Rebaz'], ['9647512223344', '']], 1]);
}

// ── 5. the assistant's tool ─────────────────────────────────────────────────

console.log('5. whatsapp_audience: what a model-named path can reach, and what comes back');
{
  const b64 = (b) => Buffer.from(typeof b === 'string' ? enc(b) : b).toString('base64');
  const world = (files) => {
    const reads = [];
    const saved = [];
    return {
      reads, saved,
      deps: {
        readFile: async (path) => {
          reads.push(path);
          if (!(path in files)) throw new Error(`${path}: No such file or directory (os error 2)`);
          const data = files[path];
          return { name: path.split('/').pop(), data: b64(data), bytes: typeof data === 'string' ? enc(data).length : data.length };
        },
        loadAudiences: async () => saved, saveAudience: async (a) => { saved.push(a); return true; },
        saveCampaign: async () => true, loadSuppressed: async () => new Set(), accountId: 'main', lang: 'en', now: () => 1_700_000_000_000,
      },
    };
  };
  const run = async (w, input) => { const out = await runBulkTool('whatsapp_audience', input, w.deps); return { out, r: out.isError ? null : JSON.parse(out.content) }; };

  const gate = world({});
  for (const path of ['/home/me/contacts.csv.exe', '/home/me/contacts.csv.', '/dev/zero', '/home/me/.ssh/id_rsa', '/home/me/list.xls', '/home/me/list.ods', '/home/me/list.pdf']) {
    const { out } = await run(gate, { path });
    ok(`refused before reading: ${path}`, out.isError && !gate.reads.includes(path), out.content);
  }
  const up = world({ '/home/me/CONTACTS.CSV': 'Rebaz,0750 123 4567\n' });
  ok('an upper-case extension is a list', (await run(up, { path: '/home/me/CONTACTS.CSV' })).r?.people === 1);

  const junk = ['Name,Phone'];
  for (let i = 0; i < 1500; i++) junk.push(`Bad${i},12`);
  junk.push('Rebaz,0750 123 4567', 'Layla,0751 222 3344');
  const many = ['Phone'];
  for (let i = 0; i < 6000; i++) many.push(`07${String(500_000_000 + i).padStart(9, '0')}`);
  const ole = new Uint8Array(1024); ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const w = world({
    '/l/junk.csv': junk.join('\n'), '/l/many.csv': many.join('\n'), '/l/locked.xlsx': ole,
    '/l/named.csv': 'Name,Phone,City\nRebaz Ahmed,0750 123 4567,Erbil\n',
    '/l/headless.csv': 'Shilan Kareem,shilan@example.com,0750 12\nRebaz,rebaz@example.com,0750 123 4567\nLayla,layla@example.com,0751 222 3344\n',
    '/l/secret.txt': 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\nhunter2\n',
  });
  const a = await run(w, { path: '/l/junk.csv' });
  eq('notRead counts every line that could not be read, not the thousand listed', a.r && [a.r.people, a.r.notRead], [2, 1500]);
  const m = await run(w, { path: '/l/many.csv' });
  ok('a list cut at 5,000 says so', m.r && m.r.people === 5000 && m.r.truncated === true && /5,000|5000/.test(m.r.note), m.r);
  const l = await run(w, { path: '/l/locked.xlsx' });
  ok('a locked workbook says what is wrong, in words the model can pass on', l.r && l.r.problem === 'locked' && /password|\.xlsx/i.test(l.r.note), l.r);
  const n = await run(w, { path: '/l/named.csv' });
  eq('a header row the reader recognises is shown (so {City} can be offered)', n.r && n.r.columns, ['Name', 'Phone', 'City']);
  const h = await run(w, { path: '/l/headless.csv' });
  ok('a first row taken for a header that is really a person never reaches the model', h.r && !/Shilan|example\.com|0750 12/.test(h.out.content), h.out.content);
  const s = await run(w, { path: '/l/secret.txt' });
  ok('a file that is not a list: counts only, nothing of its content', s.r && !/AWS|wJalr|hunter2|EXAMPLE/.test(s.out.content), s.out.content);
  const miss = await run(w, { path: '/l/missing.csv' });
  ok('a missing file: an error naming only the path the model gave', miss.out.isError && miss.out.content.includes('/l/missing.csv'), miss.out.content);
  ok('every result carries no full number and no name', [a, m, n, h, s].every((x) => !/9647\d{9}|Rebaz|Layla/.test(x.out.content)));
}

// ── 6. masks and the report ──────────────────────────────────────────────────

console.log('6. maskPhone and reportCsv');
{
  let worst = '';
  for (let len = 1; len <= 20; len++) {
    for (const lead of ['964', '1', '7', '44', '90', '999', '0']) {
      const d = (lead + '123456789012345678901').slice(0, len);
      const m = maskPhone(d);
      const shown = m.replace(/[^0-9]/g, '');
      const code = m.startsWith('+') ? m.slice(1).split(' ')[0] : '';
      const nsnShown = shown.length - code.length;
      const nsnLen = d.length - code.length;
      if (m !== '***' && (len < 7 || len > 15 || nsnLen - nsnShown < 3 || !d.startsWith(code))) worst ||= `${d} → ${m}`;
    }
  }
  ok('maskPhone never shows more than all but three digits, and nothing of a too-short or too-long input', !worst, worst);
  eq('maskPhone of odd inputs', [maskPhone(''), maskPhone('abc'), maskPhone(null), maskPhone(undefined), maskPhone(9647501234567), maskPhone('+964 750 123 4567')],
    ['***', '***', '***', '***', '***', '+964 750 *** 4567']);
  const names = ['=HYPERLINK("http://x","y")', '+SUM(1)', '-1+1', '@SUM(A1)', '\t=cmd', ' =1+1', '＝1+1', '=cmd|\' /C calc\'!A0', 'Ahmed, Jr.', 'Sa"ra', 'أحمد', '‮evil', 'two\nlines'];
  const recipients = names.map((name, i) => ({ phone: `96475012345${String(i).padStart(2, '0')}`, name, vars: {} }));
  const csv = reportCsv({ recipients, outcomes: { '9647501234500': { standing: 'failed', why: '=1+1', at: 1 } } });
  // RFC 4180 back to cells.
  const back = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (q) { if (c === '"') { if (csv[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\r') { /* CRLF */ } else if (c === '\n') { row.push(cell); back.push(row); row = []; cell = ''; } else cell += c;
  }
  const cells = back.slice(1).flat();
  ok('reportCsv: no cell a spreadsheet would run (names and reasons alike)', cells.every((c) => !/^[=+\-@＝＋－＠\t\r]/.test(c) && !/^\s+[=+\-@]/.test(c)), cells.filter((c) => /^[\s=+\-@＝＋－＠]/.test(c)));
  eq('reportCsv: commas, quotes, Arabic come back whole; no override and no line break inside a name', back.slice(9, 13).map((r) => r[1]), ['Ahmed, Jr.', 'Sa"ra', 'أحمد', 'evil']);
  eq('…a name with a line break is one line', back[13][1], 'two lines');
  ok('…every row has five cells', back.every((r) => r.length === 5), back.map((r) => r.length));
}

// ── 7. what the People step tells the person ────────────────────────────────

console.log('7. The People step: counts and file problems');
{
  const out = await buildUi(join(APP, '.test-build/wa-review-parse-ui'));
  const People = await import(pathToFileURL(join(out, 'WhatsAppPeople.js')).href);
  const t = (s) => s;
  const parsed = { format: 'csv', recipients: [{ phone: '9647501234567', vars: {} }], rejected: Array.from({ length: 1000 }, (_, i) => ({ line: i + 2, raw: 'x', why: 'too-short' })),
    rejectedMore: 1500, truncated: true, duplicates: 0, columns: [], phoneColumn: null, nameColumn: null, defaultCountry: '964' };
  const p = People.peopleFrom(parsed, new Set());
  eq('peopleFrom keeps what the read said beyond the listed lines', [p.rejectedMore, p.truncated], [1500, true]);
  eq('"couldn\'t be read" is every line, not the thousand listed', People.notReadCount(p), 2500);
  for (const problem of ['locked', 'too-big', 'binary', 'damaged', 'not-a-sheet', 'empty', 'cannot-inflate']) {
    const s = People.problemText(problem, t);
    ok(`a file problem is a sentence: ${problem}`, typeof s === 'string' && s.length > 20 && !/Line|Not a phone number/.test(s), s);
  }
  ok('a locked file says how to fix it', /\.xlsx/.test(People.problemText('locked', t)));
  ok('a number Excel shortened says so', /Excel/.test(People.whyText('not-a-number', t, 'excel-rounded')));
  const { createElement: h } = (await import('module')).createRequire(import.meta.url)('react');
  const { renderToStaticMarkup } = (await import('module')).createRequire(import.meta.url)('react-dom/server');
  const quiet = console.error; console.error = () => {};
  let html = '';
  try {
    html = renderToStaticMarkup(h(People.AudienceStep, { t, lang: 'en', people: { ...p, recipients: p.recipients }, onPeople: () => {}, country: '964', onCountry: () => {}, suppressed: new Set() }));
  } finally { console.error = quiet; }
  ok('the summary shows 2,500 couldn\'t be read', html.includes('2,500 couldn’t be read'), html.slice(0, 400));
  ok('a list cut short says so even under 5,000 people', /only the first part|was read/i.test(html) && !html.includes('Only the first 5,000'), html.slice(0, 600));
  const src = readFileSync(join(APP, 'src/WhatsAppPeople.tsx'), 'utf8');
  ok('a read with a problem is turned into a sentence, never shown as "Line 1"', /p\.problem/.test(src) && /problemText\(/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
