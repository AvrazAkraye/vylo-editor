// Package `audience` of the WhatsApp broadcast (docs/WA.md, docs/wa/briefs/audience.md): reading a list of people from
// anything a shopkeeper has. This file is the golden half — every example the brief names, one golden input per
// format (pasted text, .txt, .csv, .tsv, .vcf, .xlsx, the chats), every encoding Excel and phones write, Excel's
// float trap, vCard folding and quoted-printable Arabic, masks and the list helpers. `wa-audience-more.test.mjs` is the
// hostile half: zip bombs, truncated files, headers in six languages, the ceilings, speed and fuzz.
//
// Nothing here touches a network or a real number: every number below is invented, in the shape of a real one.
import { deflateRawSync } from 'node:zlib';
import {
  parseAudience, normalisePhone, COUNTRIES, CALLING_CODES, countryOf, countryForLang, fromChats, excludeSuppressed,
  makeAudience, maskPhone,
} from '../.test-build/whatsappaudience.js';
import { readXlsx, readSheet, SheetError, expandNumber, isZip, isOle, SHEET_LIMITS } from '../.test-build/whatsappsheet.js';
import { crc32 } from '../.test-build/slidespptx.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); }
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
const phones = (p) => p.recipients.map((r) => r.phone);
const ch = (code) => String.fromCharCode(code);
const LRM = ch(0x200e), RLM = ch(0x200f), NBSP = ch(0xa0), RLO = ch(0x202e), ZWNJ = ch(0x200c);

// ── a zip and a workbook, built here ──────────────────────────────────────

/**
 * A zip of `files`: each `[name, text|bytes, { deflate, claim, flags }]`. `claim` overrides the uncompressed size the
 * directory states (a lying zip), `flags` the general-purpose flags (bit 0: encrypted).
 */
function zipOf(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, data, o = {}] of files) {
    const raw = typeof data === 'string' ? enc.encode(data) : data;
    const body = o.deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const nm = enc.encode(name);
    const size = o.claim ?? raw.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, (o.flags ?? 0) | 0x0800, true);
    local.setUint16(8, o.deflate ? 8 : 0, true);
    local.setUint32(14, crc32(raw), true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, size, true);
    local.setUint16(26, nm.length, true);
    chunks.push(new Uint8Array(local.buffer), nm, body);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, (o.flags ?? 0) | 0x0800, true);
    dir.setUint16(10, o.deflate ? 8 : 0, true);
    dir.setUint32(16, crc32(raw), true);
    dir.setUint32(20, body.length, true);
    dir.setUint32(24, size, true);
    dir.setUint16(28, nm.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nm);
    offset += 30 + nm.length + body.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let at = 0;
  for (const c of all) { out.set(c, at); at += c.length; }
  return out;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colLetter = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * A workbook whose first sheet holds `rows`. A row is an array of cells, or `{ r, cells }` to place it; a cell is a
 * string (a shared string), `{ n }` (a number as Excel writes it), `{ i }` (an inline string), `{ f, v }` (a formula
 * with its saved text result), or null (no cell). Options: `deflate`, `hiddenFirst` (a hidden sheet before it),
 * `prefix` (the main namespace under a prefix, as strict exporters write it).
 */
function workbook(rows, o = {}) {
  const strings = [];
  const index = new Map();
  const si = (s) => { if (!index.has(s)) { index.set(s, strings.length); strings.push(s); } return index.get(s); };
  const p = o.prefix ? `${o.prefix}:` : '';
  const xmlns = o.prefix ? `xmlns:${o.prefix}="${NS}"` : `xmlns="${NS}"`;
  let at = 0;
  const rowXml = rows.map((row) => {
    const r = Array.isArray(row) ? { r: at + 1, cells: row } : row;
    at = r.r;
    const cells = r.cells.map((c, i) => {
      if (c === null || c === undefined) return '';
      const ref = `${colLetter(i)}${r.r}`;
      if (typeof c === 'string') return `<${p}c r="${ref}" t="s"><${p}v>${si(c)}</${p}v></${p}c>`;
      if ('n' in c) return `<${p}c r="${ref}"><${p}v>${c.n}</${p}v></${p}c>`;
      if ('i' in c) return `<${p}c r="${ref}" t="inlineStr"><${p}is><${p}t>${esc(c.i)}</${p}t></${p}is></${p}c>`;
      if ('f' in c) return `<${p}c r="${ref}" t="str"><${p}f>${esc(c.f)}</${p}f><${p}v>${esc(c.v)}</${p}v></${p}c>`;
      return '';
    }).join('');
    return `<${p}row r="${r.r}">${cells}</${p}row>`;
  }).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${p}worksheet ${xmlns}><${p}sheetData>${rowXml}</${p}sheetData></${p}worksheet>`;
  const sst = `<?xml version="1.0" encoding="UTF-8"?><${p}sst ${xmlns} count="${strings.length}">${strings.map((s) => `<${p}si><${p}t xml:space="preserve">${esc(s)}</${p}t></${p}si>`).join('')}</${p}sst>`;
  const sheets = o.hiddenFirst
    ? `<${p}sheet name="Lookup" sheetId="1" state="hidden" r:id="rId9"/><${p}sheet name="People" sheetId="2" r:id="rId1"/>`
    : `<${p}sheet name="People" sheetId="1" r:id="rId1"/>`;
  const book = `<?xml version="1.0" encoding="UTF-8"?><${p}workbook ${xmlns} xmlns:r="${REL}"><${p}sheets>${sheets}</${p}sheets></${p}workbook>`;
  const bookRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>`
    + `<Relationship Id="rId9" Type="${REL}/worksheet" Target="worksheets/sheet9.xml"/>`
    + `<Relationship Id="rId2" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>`
    + `<Relationship Id="rId3" Type="${REL}/externalLink" Target="https://example.invalid/x.xlsx" TargetMode="External"/></Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const lookup = `<?xml version="1.0"?><worksheet xmlns="${NS}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>secret</t></is></c><c r="B1"><v>9647509999999</v></c></row></sheetData></worksheet>`;
  const d = { deflate: !!o.deflate };
  return zipOf([
    ['[Content_Types].xml', types, d], ['_rels/.rels', rootRels, d], ['xl/workbook.xml', book, d],
    ['xl/_rels/workbook.xml.rels', bookRels, d], ['xl/worksheets/sheet1.xml', sheet, d], ['xl/worksheets/sheet9.xml', lookup, d],
    ['xl/sharedStrings.xml', sst, d], ['xl/vbaProject.bin', new Uint8Array([1, 2, 3, 4]), d],
  ]);
}

// ── numbers: every example the brief names ────────────────────────────────

{
  const iraq = ['0750 123 4567', '+964 750 123 4567', '00964 750 123 4567', '750 123 4567', '07501234567', '٠٧٥٠١٢٣٤٥٦٧', '(0750) 123-4567'];
  for (const raw of iraq) eq(`964: "${raw}" is 9647501234567`, normalisePhone(raw, '964'), { phone: '9647501234567' });
  eq('90: "0532 123 45 67"', normalisePhone('0532 123 45 67', '90'), { phone: '905321234567' });
  eq('98: "0912 345 6789"', normalisePhone('0912 345 6789', '98'), { phone: '989123456789' });
  eq('966: "050 123 4567"', normalisePhone('050 123 4567', '966'), { phone: '966501234567' });
  eq('Persian digits (۰۹۱۲…) with 98', normalisePhone('۰۹۱۲ ۳۴۵ ۶۷۸۹', '98'), { phone: '989123456789' });
  eq('full-width digits and plus', normalisePhone('＋９６４ ７５０ １２３ ４５６７', '1'), { phone: '9647501234567' });
  eq('bidi marks around a copied Arabic-interface number', normalisePhone(`${RLM}${LRM}+964 750 123 4567${LRM}`, '964'), { phone: '9647501234567' });
  eq('no-break and thin spaces, en dashes, dots', normalisePhone(`0750${NBSP}123${ch(0x2009)}45${ch(0x2013)}67`, '964'), { phone: '9647501234567' });
  eq('dots as separators', normalisePhone('0750.123.4567', '964'), { phone: '9647501234567' });
  eq('the trunk zero written after the code: +964 0750…', normalisePhone('+964 0750 123 4567', '964'), { phone: '9647501234567' });
  eq('…and without the plus: 964 0750…', normalisePhone('964 0750 123 4567', '964'), { phone: '9647501234567' });
  eq('a number already with its code is taken as it is', normalisePhone('9647501234567', '964'), { phone: '9647501234567' });
  eq('+44 (0)20 … drops the bracketed trunk', normalisePhone('+44 (0)20 7946 0958', '964'), { phone: '442079460958' });
  eq('another country without its plus, too long to be Iraqi: WhatsApp\'s own form', normalisePhone('447911123456', '964'), { phone: '447911123456' });
  eq('+00964… (a pasted habit) is still international', normalisePhone('+00964 750 123 4567', '964'), { phone: '9647501234567' });
  eq('Kuwait has no trunk: eight digits', normalisePhone('5001 2345', '965'), { phone: '96550012345' });
  eq('Italy keeps the 0 of a landline', normalisePhone('06 1234 5678', '39'), { phone: '390612345678' });
  eq('Russia dials 8 at home', normalisePhone('8 916 123-45-67', '7'), { phone: '79161234567' });
  eq('Hungary dials 06 at home', normalisePhone('06 30 123 4567', '36'), { phone: '36301234567' });
  eq('North America: 1 at home, 011 abroad', [normalisePhone('1 (555) 123-4567', '1'), normalisePhone('011 964 750 123 4567', '1')],
    [{ phone: '15551234567' }, { phone: '9647501234567' }]);
  eq('a country option written +964 or 00964 is 964', [normalisePhone('0750 123 4567', '+964'), normalisePhone('0750 123 4567', '00964')],
    [{ phone: '9647501234567' }, { phone: '9647501234567' }]);
  eq('an Iraqi landline (Erbil) is a number', normalisePhone('066 225 1234', '964'), { phone: '964662251234' });
  eq('a Baghdad landline is eight digits', normalisePhone('01 719 1234', '964'), { phone: '96417191234' });

  // Rejected with a reason, never guessed.
  eq('too short: an Iraqi mobile missing a digit', normalisePhone('0770 123 456', '964'), { why: 'too-short' });
  eq('too short: …and without its zero', normalisePhone('770123456', '964'), { why: 'too-short' });
  eq('too long: one digit too many', normalisePhone('0750 123 45678', '964'), { why: 'too-long' });
  eq('too long: a wall of digits', normalisePhone('0'.repeat(500), '964'), { why: 'too-long' });
  eq('not a number: words', normalisePhone('call me', '964'), { why: 'not-a-number' });
  eq('not a number: a letter in it', normalisePhone('0750 12A 4567', '964'), { why: 'not-a-number' });
  eq('not a number: a plus in the middle', normalisePhone('0750+1234567', '964'), { why: 'not-a-number' });
  eq('empty: nothing, spaces, a dash', [normalisePhone('', '964'), normalisePhone('   ', '964'), normalisePhone('-', '964')],
    [{ why: 'empty' }, { why: 'empty' }, { why: 'empty' }]);
  eq('country unknown: a + code nobody has', normalisePhone('+999 123 456 789', '964'), { why: 'country-unknown' });
  eq('country unknown: a national number with an unknown default', normalisePhone('0750 123 4567', '999'), { why: 'country-unknown' });
  eq('country unknown: no default at all', normalisePhone('0750 123 4567', ''), { why: 'country-unknown' });
  eq('a non-string is never a throw', [normalisePhone(null, '964'), normalisePhone(undefined, null), normalisePhone({}, {})],
    [{ why: 'empty' }, { why: 'empty' }, { why: 'empty' }]);
}

// ── Excel's float trap ────────────────────────────────────────────────────

{
  eq('expandNumber: scientific, exact', expandNumber('9.647501234567E+12'), { digits: '9647501234567', padded: 0 });
  eq('expandNumber: 7.501234567E9 (the zero Excel dropped is the country\'s to add back)', expandNumber('7.501234567E9'), { digits: '7501234567', padded: 0 });
  eq('expandNumber: the brief\'s 9.6475012345E+11 is 964750123450, one zero written in', expandNumber('9.6475012345E+11'), { digits: '964750123450', padded: 1 });
  eq('expandNumber: 964750123456 stays itself', expandNumber('964750123456'), { digits: '964750123456', padded: 0 });
  eq('expandNumber: a trailing .0', expandNumber('7501234567.0'), { digits: '7501234567', padded: 0 });
  eq('expandNumber: a real fraction is not a whole number', expandNumber('3.25'), null);
  eq('expandNumber: a negative exponent is not a phone', expandNumber('7.5E-3'), null);
  eq('expandNumber: no float ever: 17 significant digits survive', expandNumber('1.2345678901234567E+16'), { digits: '12345678901234567', padded: 0 });
  eq('a scientific number reads as a phone', normalisePhone('9.647501234567E+12', '964'), { phone: '9647501234567' });
  eq('…and a lower-case e', normalisePhone('9.647501234567e+12', '964'), { phone: '9647501234567' });
  eq('…and Excel\'s dropped zero, in scientific form', normalisePhone('7.501234567E+09', '964'), { phone: '9647501234567' });
  eq('…and the .0 pandas writes', normalisePhone('9647501234567.0', '964'), { phone: '9647501234567' });
  eq('the brief\'s 12-digit examples are one digit short of an Iraqi mobile, and say so', [normalisePhone('9.6475012345E+11', '964'), normalisePhone('964750123456', '964')],
    [{ why: 'too-short' }, { why: 'too-short' }]);
  eq('a number Excel rounded for display is refused, never rebuilt with zeros', normalisePhone('9.64751E+11', '964'), { why: 'not-a-number' });
}
{
  const p = await parseAudience('Phone\n9.64751E+11\n9.647501234567E+12\n', { filename: 'excel.csv' });
  eq('a rounded number in a CSV is rejected with the Excel hint', p.rejected, [{ line: 2, raw: '9.64751E+11', why: 'not-a-number', hint: 'excel-rounded' }]);
  eq('…and the exact one beside it is read', phones(p), ['9647501234567']);
}

// ── the countries, the codes, the masks ───────────────────────────────────

{
  const first = COUNTRIES.slice(0, 18).map((c) => c.iso);
  eq('the picker starts with the most likely, in the brief\'s order', first,
    ['IQ', 'TR', 'IR', 'SY', 'SA', 'AE', 'KW', 'JO', 'LB', 'EG', 'QA', 'BH', 'OM', 'YE', 'DE', 'SE', 'GB', 'US']);
  ok('every picker country has a code the normaliser knows', COUNTRIES.every((c) => CALLING_CODES.includes(c.code)));
  ok('every picker country is named in all four languages', COUNTRIES.every((c) => ['en', 'ar', 'ckb', 'kmr'].every((l) => typeof c.name[l] === 'string' && c.name[l].trim())));
  ok('iso codes are unique', new Set(COUNTRIES.map((c) => c.iso)).size === COUNTRIES.length);
  ok('every flag is two regional-indicator letters', COUNTRIES.every((c) => [...c.flag].length === 2 && [...c.flag].every((x) => x.codePointAt(0) >= 0x1f1e6 && x.codePointAt(0) <= 0x1f1ff)));
  eq('Iraq\'s flag', COUNTRIES[0].flag, String.fromCodePoint(0x1f1ee, 0x1f1f6));
  const prefixed = CALLING_CODES.filter((a) => CALLING_CODES.some((b) => b !== a && b.startsWith(a)));
  eq('calling codes are a prefix code (none is the start of another)', prefixed, []);
  ok('calling codes are 1 to 3 digits and unique', CALLING_CODES.every((c) => /^[1-9][0-9]{0,2}$/.test(c)) && new Set(CALLING_CODES).size === CALLING_CODES.length);
  ok('a plausible number of codes', CALLING_CODES.length > 200, CALLING_CODES.length);
  ok('the shared non-geographic codes are not countries', ['800', '808', '870', '881', '882', '883', '888', '979'].every((c) => !CALLING_CODES.includes(c)));
  eq('countryOf splits at the real code', ['9647501234567', '905321234567', '15551234567', '79161234567', '96550012345', '442079460958', '9991234', '', null].map(countryOf),
    ['964', '90', '1', '7', '965', '44', '', '', '']);
  eq('countryForLang is 964 for all four languages (and anything else)', ['en', 'ar', 'ckb', 'kmr', 'xx'].map(countryForLang), ['964', '964', '964', '964', '964']);

  eq('masks', ['9647501234567', '905321234567', '15551234567', '96550012345', '9613123456', '447911123456'].map(maskPhone),
    ['+964 750 *** 4567', '+90 532 *** 4567', '+1 555 *** 4567', '+965 50 *** 345', '+961 31 *** 56', '+44 791 *** 3456']);
  eq('a mask of junk is ***', ['', '123', 'abc', '9'.repeat(16), null, undefined].map(maskPhone), ['***', '***', '***', '***', '***', '***']);
  let leaks = 0;
  for (const code of CALLING_CODES) {
    for (let len = 7; len <= 15; len++) {
      if (code.length >= len) continue;
      const phone = (code + '123456789012345').slice(0, len);
      const m = maskPhone(phone);
      const shown = (m.match(/[0-9]/g) ?? []).length - (m.startsWith(`+${code}`) ? code.length : 0);
      if (!m.includes('***') || shown > len - code.length - 3) leaks++;
    }
  }
  eq('a mask always hides at least three digits of the national number, for every code and length', leaks, 0);
}

// ── pasted text and .txt ──────────────────────────────────────────────────

{
  const text = [
    'Rebaz, 0750 123 4567',
    '0770 123 4567 - Ahmad Kareem',
    'Shilan: +964 780 111 2222',
    '0790 333 4444; 0751 555 6666, 0771 777 8888',
    '07502223333 07703334444',
    '',
    'My customers (do not share):',
    '[04/10/2026, 10:15:32] Rebaz: the order of 2024-05-01 is ready, total 125000',
    'Phone: 0782 999 0000',
    '0750 123 4567',
    '0770 123 456',
    '07501',
    'سيڤان ٠٧٥٠٤٤٤٥٥٥٥',
    `${RLO}Evil${ch(0x202c)} 0750 666 7777`,
    '066 225 1234',
  ].join('\n');
  const p = await parseAudience(text);
  eq('text: the format is text, with no columns', [p.format, p.columns, p.phoneColumn, p.nameColumn, p.defaultCountry], ['text', [], null, null, '964']);
  eq('text: every number, in order', phones(p), [
    '9647501234567', '9647701234567', '9647801112222', '9647903334444', '9647515556666', '9647717778888', '9647502223333',
    '9647703334444', '9647829990000', '9647504445555', '9647506667777', '964662251234',
  ]);
  eq('text: a name only where the line is "name, number"', p.recipients.map((r) => r.name ?? null), [
    'Rebaz', 'Ahmad Kareem', 'Shilan', null, null, null, null, null, null, 'سيڤان', 'Evil', null,
  ]);
  eq('text: a field word ("Phone:") is not a name', p.recipients[8].name, undefined);
  eq('text: the repeat is counted, not kept', p.duplicates, 1);
  eq('text: the short ones are rejected with their lines', p.rejected, [
    { line: 11, raw: '0770 123 456', why: 'too-short' },
    { line: 12, raw: '07501', why: 'too-short' },
  ]);
  eq('text: a landline is kept with a warning', p.warned, [{ line: 15, phone: '964662251234', why: 'not-mobile' }]);
  ok('text: every recipient has vars, and they are empty', p.recipients.every((r) => r.vars && Object.keys(r.vars).length === 0));
}
{
  const chat = [
    '[04/10/2026, 09:12:01] +964 750 123 4567: hello, is the red dress still there?',
    '04/10/2026, 09:13 - Shop: yes! call 0770 123 4567 or 7801234567 for delivery',
    '04/10/2026, 09:14 - +44 7911 123456 joined using this group\'s invite link',
    'Invoice INV20240512345 for 1.250.000 IQD, ref 4471234567',
    'Sent from my iPhone. Tracking number 123456789012',
  ].join('\n');
  const p = await parseAudience(chat, { filename: 'WhatsApp Chat.txt' });
  eq('a chat export: the format is txt', p.format, 'txt');
  eq('a chat export: numbers that say they are numbers (+, a trunk zero, a mobile\'s shape)', phones(p),
    ['9647501234567', '9647701234567', '9647801234567', '447911123456']);
  eq('a chat export: no names out of sentences, nothing rejected', [p.recipients.filter((r) => r.name).length, p.rejected.length], [0, 0]);
  eq('the file name is kept', p.file, 'WhatsApp Chat.txt');
}
{
  const p = await parseAudience('0750 123 4567\r\n0770 123 4567\r0780 123 4567\n', { filename: 'numbers.txt' });
  eq('a .txt of numbers, every line ending', [p.format, phones(p).length, p.rejected.length], ['txt', 3, 0]);
  const tr = await parseAudience('0532 123 45 67\n0533 222 33 44', { defaultCountry: '90' });
  eq('the default country decides', [tr.defaultCountry, phones(tr)], ['90', ['905321234567', '905332223344']]);
  const empty = await parseAudience('   \n\n  ');
  eq('blank text is the empty problem', [empty.problem, empty.recipients.length, empty.rejected[0].why], ['empty', 0, 'empty']);
}

// ── .csv ──────────────────────────────────────────────────────────────────

{
  const csv = [
    'Customer list,,,',
    'Name,Phone,City,Note',
    '"Kareem, Ahmad",0750 123 4567,Erbil,"said ""yes"" in May"',
    'Shilan,"0770 123 4567",Duhok,"two',
    'lines"',
    'Rebaz,0750 123 4567,Erbil,repeat',
    'Sara,0770 12,Zakho,',
    'Dara,,Soran,no number',
    ',,,',
    'Hana,Tel: 0780 555 6666,Halabja,',
  ].join('\r\n');
  const p = await parseAudience(ch(0xfeff) + csv, { filename: 'customers.csv' });
  eq('csv: the columns, and which is which', [p.format, p.columns, p.phoneColumn, p.nameColumn], ['csv', ['Name', 'Phone', 'City', 'Note'], 'Phone', 'Name']);
  eq('csv: quotes, doubled quotes, a field across two lines', p.recipients.map((r) => [r.phone, r.name, r.vars]), [
    ['9647501234567', 'Kareem, Ahmad', { City: 'Erbil', Note: 'said "yes" in May' }],
    ['9647701234567', 'Shilan', { City: 'Duhok', Note: 'two lines' }],
    ['9647805556666', 'Hana', { City: 'Halabja' }],
  ]);
  eq('csv: rejected rows carry the line they began on', p.rejected, [
    { line: 7, raw: '0770 12', why: 'too-short' },
    { line: 8, raw: 'Dara, Soran, no number', why: 'empty' },
  ]);
  eq('csv: the repeat is counted', p.duplicates, 1);

  const semi = await parseAudience('Ad;Telefon;Şehir\nAyşe;0532 123 45 67;İzmir\n', { filename: 'kisiler.csv', defaultCountry: '90' });
  eq('csv: a semicolon delimiter, found by looking', [semi.columns, semi.recipients[0]], [['Ad', 'Telefon', 'Şehir'], { phone: '905321234567', vars: { 'Şehir': 'İzmir' }, name: 'Ayşe' }]);

  const remap = await parseAudience('Name,Mobile,Office\nRebaz,0750 123 4567,066 225 1234\n', { filename: 'a.csv', phoneColumn: 'Office', nameColumn: '' });
  eq('csv: phoneColumn and nameColumn override the guess ("" is no name; a column called Name is then a variable, renamed off {name})', [remap.phoneColumn, remap.nameColumn, remap.recipients[0]],
    ['Office', null, { phone: '964662251234', vars: { 'Name 2': 'Rebaz', Mobile: '0750 123 4567' } }]);
  const unknown = await parseAudience('Name,Mobile\nRebaz,0750 123 4567\n', { filename: 'a.csv', phoneColumn: 'Nope' });
  eq('csv: an override naming no column falls back to the guess', unknown.phoneColumn, 'Mobile');

  const split = await parseAudience('First Name,Last Name,Mobile Phone\nAhmad,Kareem,0750 123 4567\n', { filename: 'google.csv' });
  eq('csv: a first and a last name are joined', [split.nameColumn, split.recipients[0].name, split.recipients[0].vars], ['First Name', 'Ahmad Kareem', {}]);

  const bare = await parseAudience('0750 123 4567,Rebaz,Erbil\n0770 123 4567,Ahmad,Duhok\n', { filename: 'nohead.csv' });
  eq('csv: no header — columns are letters, and still guessed', [bare.columns, bare.phoneColumn, bare.nameColumn, bare.recipients[1].vars], [['A', 'B', 'C'], 'A', 'B', { C: 'Duhok' }]);

  const list = await parseAudience('0750 123 4567,0770 123 4567,0780 123 4567\n0790 123 4567,0751 123 4567,0771 123 4567\n', { filename: 'numbers.csv' });
  eq('csv: numbers in every column are a list, not a table: all six read', phones(list).length, 6);

  const one = await parseAudience('Phone\n0750 123 4567\n0770 123 4567\n', { filename: 'one.csv' });
  eq('csv: one column with a header', [one.columns, phones(one).length], [['Phone'], 2]);

  const keys = await parseAudience('Name,Phone,{city},a|b,[x],name,first_name\nR,0750 123 4567,Erbil,1,2,3,4\n', { filename: 'k.csv' });
  eq('csv: variable keys lose { } | [ ], and never shadow {name} or {first_name}', Object.keys(keys.recipients[0].vars), ['city', 'a b', 'x', 'name 2', 'first_name 2']);
}

// ── .tsv, and a selection pasted from Excel ───────────────────────────────

{
  const tsv = 'Name\tPhone\tCity\nRebaz\t7501234567\tErbil\nAhmad\t07701234567\tDuhok\n';
  const p = await parseAudience(tsv, { filename: 'people.tsv' });
  eq('tsv: read by its name', [p.format, p.phoneColumn, p.nameColumn, phones(p)], ['tsv', 'Phone', 'Name', ['9647501234567', '9647701234567']]);
  const pasted = await parseAudience(tsv);
  eq('a pasted Excel selection is a table too', [pasted.format, pasted.columns, pasted.recipients[0]],
    ['text', ['Name', 'Phone', 'City'], { phone: '9647501234567', vars: { City: 'Erbil' }, name: 'Rebaz' }]);
}

// ── encodings ─────────────────────────────────────────────────────────────

/** Bytes of `text` in a single-byte code page, built by inverting the platform's own decoder. */
function encodeLegacy(text, label) {
  const dec = new TextDecoder(label);
  const map = new Map();
  for (let b = 0; b < 256; b++) map.set(dec.decode(new Uint8Array([b])), b);
  return new Uint8Array([...text].map((c) => { if (!map.has(c)) throw new Error(`${c} not in ${label}`); return map.get(c); }));
}
const utf16 = (text, be) => {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[2 * i + (be ? 1 : 0)] = c & 0xff;
    out[2 * i + (be ? 0 : 1)] = c >> 8;
  }
  return out;
};
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };

{
  const arabic = 'الاسم,رقم الهاتف,المدينة\r\nرباز أحمد,07501234567,أربيل\r\nشيلان,07701234567,دهوك\r\n';
  const want = [['9647501234567', 'رباز أحمد', 'أربيل'], ['9647701234567', 'شيلان', 'دهوك']];
  const read = (p) => p.recipients.map((r) => [r.phone, r.name, r.vars['المدينة']]);
  const utf8 = new TextEncoder().encode(arabic);
  eq('UTF-8', read(await parseAudience(utf8, { filename: 'a.csv' })), want);
  eq('UTF-8 with a BOM', read(await parseAudience(cat(new Uint8Array([0xef, 0xbb, 0xbf]), utf8), { filename: 'a.csv' })), want);
  eq('UTF-16 LE with a BOM (Excel\'s "Unicode Text")', read(await parseAudience(cat(new Uint8Array([0xff, 0xfe]), utf16(arabic, false)), { filename: 'a.csv' })), want);
  eq('UTF-16 BE with a BOM', read(await parseAudience(cat(new Uint8Array([0xfe, 0xff]), utf16(arabic, true)), { filename: 'a.csv' })), want);
  eq('UTF-16 LE without a BOM, told by its NULs', read(await parseAudience(utf16(arabic, false), { filename: 'a.csv' })), want);
  eq('Windows-1256 (Excel\'s CSV on an Arabic Windows)', read(await parseAudience(encodeLegacy(arabic, 'windows-1256'), { filename: 'a.csv' })), want);

  const turkish = 'Adı Soyadı;Cep Telefonu;Şehir\r\nŞükrü Gündoğdu;0532 123 45 67;İstanbul\r\nIşıl Çağlar;0533 222 33 44;Eskişehir\r\n';
  const tr = await parseAudience(encodeLegacy(turkish, 'windows-1254'), { filename: 'tr.csv', defaultCountry: '90' });
  eq('Windows-1254 (Excel\'s CSV on a Turkish Windows)', tr.recipients.map((r) => [r.phone, r.name, r.vars['Şehir']]),
    [['905321234567', 'Şükrü Gündoğdu', 'İstanbul'], ['905332223344', 'Işıl Çağlar', 'Eskişehir']]);
  const tr964 = await parseAudience(encodeLegacy(turkish, 'windows-1254'), { filename: 'tr.csv', defaultCountry: '90' });
  ok('…told from Arabic by looking, not by the default country alone', tr964.recipients[0].name === 'Şükrü Gündoğdu');
  const tr2 = await parseAudience(encodeLegacy('Ad;Telefon\nŞükrü Gündoğdu Çağlayan Işık;+90 532 123 45 67\n', 'windows-1254'), { filename: 'tr.csv', defaultCountry: '964' });
  eq('…even when the default country is Iraq', tr2.recipients[0]?.name, 'Şükrü Gündoğdu Çağlayan Işık');

  const persian = 'نام,شماره موبایل\nسارا,۰۹۱۲۳۴۵۶۷۸۹\n';
  const fa = await parseAudience(new TextEncoder().encode(persian), { filename: 'fa.csv', defaultCountry: '98' });
  eq('Persian digits in a Persian CSV', [fa.phoneColumn, fa.nameColumn, phones(fa)], ['شماره موبایل', 'نام', ['989123456789']]);

  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...Array.from({ length: 200 }, (_, i) => (i * 37) & 0xff)]);
  const bin = await parseAudience(png, { filename: 'photo.csv' });
  eq('a picture renamed .csv is binary, not people', [bin.problem, bin.recipients.length, bin.rejected.length], ['binary', 0, 1]);
  const pdf = await parseAudience(new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n0750 123 4567'), { filename: 'list.pdf' });
  eq('a PDF is binary', pdf.problem, 'binary');
  eq('an empty file', (await parseAudience(new Uint8Array(0), { filename: 'x.csv' })).problem, 'empty');
}

// ── .vcf ──────────────────────────────────────────────────────────────────

{
  // An old Android/Nokia 2.1 export: quoted-printable UTF-8 Arabic, with a soft line break inside the name.
  const qp = (s) => [...new TextEncoder().encode(s)].map((b) => `=${b.toString(16).toUpperCase().padStart(2, '0')}`).join('');
  const rebaz = qp('رێباز ئەحمەد');
  const vcf = [
    'BEGIN:VCARD', 'VERSION:2.1',
    `N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:;${rebaz.slice(0, 30)}=`, `${rebaz.slice(30)};;;`,
    'TEL;CELL;PREF:0750 123 4567', 'TEL;HOME:066 225 1234', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:3.0', 'FN:Ahmad', '  Kareem', 'N:Kareem;Ahmad;;;',
    'item1.TEL;type=pref:+964 770 123 4567', 'item1.X-ABLabel:_$!<Mobile>!$_',
    'item2.TEL:0780 123 4567', 'item2.X-ABLabel:iPhone', 'TEL;TYPE=WORK,FAX:066 111 2222', 'TEL;TYPE=CELL:0770 123 4567',
    'PHOTO;ENCODING=b;TYPE=JPEG:' + 'A'.repeat(70), ' ' + 'B'.repeat(20000), 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:4.0', 'FN:Sara', 'TEL;VALUE=uri;TYPE="voice,cell":tel:+44-7911-123456;ext=12', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:3.0', 'FN:No Number', 'EMAIL:a@example.invalid', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:3.0', 'ORG:Erbil Bakery;Sales', 'TEL;TYPE=WORK:0750 999 8888', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:3.0', 'FN:Bad', 'TEL:0770 12', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:3.0', 'FN:Again Rebaz', 'TEL:+9647501234567', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:2.1', 'FN:Boss', 'AGENT:', 'BEGIN:VCARD', 'FN:Assistant', 'TEL:0751 000 1111', 'END:VCARD', 'TEL;CELL:0751 222 3333', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:3.0', 'FN:Cut Short', 'TEL;TYPE=CELL:0752 444 5555',
  ].join('\r\n');
  const p = await parseAudience(vcf, { filename: 'contacts.vcf' });
  eq('vcf: the format', p.format, 'vcf');
  eq('vcf: who and which numbers', p.recipients.map((r) => [r.name, r.phone]), [
    ['رێباز ئەحمەد', '9647501234567'],
    ['Ahmad Kareem', '9647701234567'],
    ['Ahmad Kareem', '9647801234567'],
    ['Sara', '447911123456'],
    ['Erbil Bakery', '9647509998888'],
    ['Boss', '9647512223333'],
    ['Cut Short', '9647524445555'],
  ]);
  eq('vcf: a card with no number (at its BEGIN line) and one with a bad number (at its TEL line) are rejected', p.rejected, [
    { line: 27, raw: 'No Number', why: 'empty' },
    { line: 40, raw: '0770 12', why: 'too-short' },
  ]);
  eq('vcf: the same number on another card is a duplicate', p.duplicates, 1);
  const many = await parseAudience(['BEGIN:VCARD', 'FN:Many', ...['0750', '0770', '0780', '0790', '0751'].map((x) => `TEL;CELL:${x} 111 2222`), 'END:VCARD'].join('\n'));
  eq('vcf: one card gives at most three numbers (the person and two more mobiles)', phones(many), ['9647501112222', '9647701112222', '9647801112222']);
  ok('vcf: the fax and the home landline are never recipients', !phones(p).includes('964661112222') && !phones(p).includes('964662251234'));
  ok('vcf: the agent\'s nested card is passed over', !phones(p).includes('9647510001111'));
  eq('vcf: pasted as text it is still a vcf', (await parseAudience(vcf)).format, 'vcf');

  const legacy = await parseAudience([
    'BEGIN:VCARD', 'VERSION:2.1', `FN;CHARSET=windows-1256;ENCODING=QUOTED-PRINTABLE:${[...encodeLegacy('شيلان', 'windows-1256')].map((b) => `=${b.toString(16).toUpperCase()}`).join('')}`,
    'TEL;CELL:07701234567', 'END:VCARD',
  ].join('\n'));
  eq('vcf: quoted-printable in the CHARSET it names', legacy.recipients[0]?.name, 'شيلان');
  const noCharset = await parseAudience([
    'BEGIN:VCARD', 'VERSION:2.1', `FN;ENCODING=QUOTED-PRINTABLE:${[...encodeLegacy('دارا', 'windows-1256')].map((b) => `=${b.toString(16).toUpperCase()}`).join('')}`,
    'TEL;CELL:07701234567', 'END:VCARD',
  ].join('\n'));
  eq('vcf: quoted-printable bytes that are not UTF-8 read as Windows-1256', noCharset.recipients[0]?.name, 'دارا');
  const broken = await parseAudience('BEGIN:VCARD\nFN;ENCODING=QUOTED-PRINTABLE:A=ZZB=4\nTEL:07701234567\nEND:VCARD');
  eq('vcf: a broken = sequence is kept as it is', broken.recipients[0]?.name, 'A=ZZB=4');
  const escaped = await parseAudience('BEGIN:VCARD\nVERSION:3.0\nN:Ahmad\\, Jr.;Rebaz\\;;;;\nTEL:07701234567\nEND:VCARD');
  eq('vcf: N is "given family", with \\, and \\; unescaped', escaped.recipients[0]?.name, 'Rebaz; Ahmad, Jr.');
}

// ── .xlsx ─────────────────────────────────────────────────────────────────

{
  const rows = [
    ['People of the shop'],
    [],
    ['Name', 'Mobile', 'City', 'Total'],
    [{ i: 'Rebaz' }, { n: '7501234567' }, 'Erbil', { f: 'SUM(D1:D2)', v: '125000' }],
    ['Ahmad', { n: '9.647701234567E+12' }, 'Duhok', { n: '3.5' }],
    ['Shilan', '0780 123 4567', 'Zakho', null],
    { r: 9, cells: ['Sara', { n: '7.501234567E9' }, 'Soran'] },
    { r: 10, cells: ['Dara', { n: '770123' }, 'Akre'] },
    { r: 11, cells: [null, null, null, { n: '1' }] },
  ];
  for (const deflate of [false, true]) {
    const how = deflate ? 'deflated' : 'stored';
    const bytes = workbook(rows, { deflate });
    ok(`xlsx (${how}): it is a zip and not OLE`, isZip(bytes) && !isOle(bytes));
    const cells = await readXlsx(bytes);
    eq(`xlsx (${how}): readXlsx puts every cell where its reference says`, cells.slice(0, 5), [
      ['People of the shop'], [], ['Name', 'Mobile', 'City', 'Total'], ['Rebaz', '7501234567', 'Erbil', '125000'], ['Ahmad', '9647701234567', 'Duhok', '3.5'],
    ]);
    eq(`xlsx (${how}): rows keep their numbers, gaps included`, [cells.length, cells[8], cells[10]], [11, ['Sara', '7501234567', 'Soran'], ['', '', '', '1']]);
    const p = await parseAudience(bytes, { filename: 'shop.xlsx' });
    eq(`xlsx (${how}): the title rows are passed over and the header found`, [p.format, p.columns, p.phoneColumn, p.nameColumn],
      ['xlsx', ['Name', 'Mobile', 'City', 'Total'], 'Mobile', 'Name']);
    eq(`xlsx (${how}): Excel's dropped zero and scientific form both recovered exactly`, p.recipients.map((r) => [r.phone, r.name, r.vars]), [
      ['9647501234567', 'Rebaz', { City: 'Erbil', Total: '125000' }],
      ['9647701234567', 'Ahmad', { City: 'Duhok', Total: '3.5' }],
      ['9647801234567', 'Shilan', { City: 'Zakho' }],
    ]);
    eq(`xlsx (${how}): rejected rows are reported by their row number`, p.rejected, [{ line: 10, raw: '770123', why: 'too-short' }, { line: 11, raw: '1', why: 'empty' }]);
    eq(`xlsx (${how}): Sara's number is Rebaz's again`, p.duplicates, 1);
  }
  const hidden = await parseAudience(workbook([['Phone'], [{ n: '7501234567' }]], { hiddenFirst: true }), { filename: 'h.xlsx' });
  eq('xlsx: a hidden first sheet is passed over for the first visible one', phones(hidden), ['9647501234567']);
  const prefixed = await readXlsx(workbook([['Phone'], ['0750 123 4567']], { prefix: 'x' }));
  eq('xlsx: a namespace prefix (x:row, x:c) reads the same', prefixed, [['Phone'], ['0750 123 4567']]);
  const bytesOnly = await parseAudience(workbook([['Phone'], [{ n: '7701234567' }]]), {});
  eq('xlsx: told by its bytes even without a name', [bytesOnly.format, phones(bytesOnly)], ['xlsx', ['9647701234567']]);
  const grid = await parseAudience(workbook([[{ n: '7501234567' }, { n: '7701234567' }], [{ n: '7801234567' }, '0790 123 45'], [{ n: '7511234567' }, { n: '7711234567' }]]), { filename: 'grid.xlsx' });
  eq('xlsx: numbers in several columns and no header are a list: every one read, the bad one by its row', [grid.format, phones(grid), grid.rejected],
    ['xlsx', ['9647501234567', '9647701234567', '9647801234567', '9647511234567', '9647711234567'], [{ line: 2, raw: '0790 123 45', why: 'too-short' }]]);
  const sheet = await readSheet(workbook([['a']]));
  eq('readSheet says whether a ceiling cut it', sheet, { rows: [['a']], cut: false });
  ok('SHEET_LIMITS: 10 MB a file, a cell ceiling', SHEET_LIMITS.file === 10 * 1024 * 1024 && SHEET_LIMITS.cells > 0);
  let threw = null;
  try { await readXlsx(new TextEncoder().encode('not a workbook')); } catch (e) { threw = e; }
  ok('readXlsx throws a SheetError with a code', threw instanceof SheetError && threw.code === 'not-a-sheet', threw && threw.code);
}

// ── the chats ─────────────────────────────────────────────────────────────

{
  const chats = [
    { jid: '9647501234567@s.whatsapp.net', name: 'Rebaz', group: false, last: 'hi', lastKind: 'text', lastFromMe: false, at: 3, unread: 0 },
    { jid: '120363025555555555@g.us', name: 'Family', group: true, last: '', lastKind: 'text', lastFromMe: false, at: 2, unread: 0 },
    { jid: '121298634178579@lid', name: 'Someone', group: false, last: '', lastKind: 'text', lastFromMe: false, at: 2, unread: 0 },
    { jid: 'status@broadcast', name: 'Status', group: false, last: '', lastKind: 'text', lastFromMe: false, at: 2, unread: 0 },
    { jid: '9647701234567@s.whatsapp.net', name: '9647701234567', group: false, last: '', lastKind: 'text', lastFromMe: false, at: 1, unread: 0 },
    { jid: '9647501234567:12@s.whatsapp.net', name: 'Rebaz phone 2', group: false, last: '', lastKind: 'text', lastFromMe: false, at: 1, unread: 0 },
    { jid: '447911123456@c.us', name: `${RLO}Sara${ch(0x202c)}`, group: false, last: '', lastKind: 'text', lastFromMe: false, at: 1, unread: 0 },
    { jid: '123@s.whatsapp.net', name: 'short', group: false },
    null, 42, { jid: 7 }, { jid: '9647801234567@s.whatsapp.net', name: 'Grouped?', group: true },
  ];
  const p = fromChats(chats);
  eq('chats: one-to-one numbers only; never a group, a @lid, a broadcast', p.recipients.map((r) => [r.phone, r.name ?? null]),
    [['9647501234567', 'Rebaz'], ['9647701234567', null], ['447911123456', 'Sara']]);
  eq('chats: a second device of the same number is a duplicate', p.duplicates, 1);
  eq('chats: a number too short to be one is rejected, not dropped silently', p.rejected, [{ line: 8, raw: '123', why: 'too-short' }]);
  eq('chats: the format', [p.format, p.columns, p.phoneColumn], ['chats', [], null]);
  eq('chats: nothing in, nothing out', [fromChats([]).recipients.length, fromChats(null).recipients.length, fromChats('x').recipients.length], [0, 0, 0]);
}

// ── the do-not-contact list and kept lists ────────────────────────────────

{
  const list = [{ phone: '9647501234567', vars: {} }, { phone: '9647701234567', vars: {} }, { phone: '9647801234567', vars: {} }];
  const { kept, removed } = excludeSuppressed(list, new Set(['9647701234567', '1234']));
  eq('excludeSuppressed: removed by phone, counted', [kept.map((r) => r.phone), removed], [['9647501234567', '9647801234567'], 1]);
  eq('excludeSuppressed: an empty set removes nothing', excludeSuppressed(list, new Set()).removed, 0);
  eq('excludeSuppressed: hostile arguments are not a throw', [excludeSuppressed(null, null).removed, excludeSuppressed(list, null).kept.length], [0, 3]);

  const p = await parseAudience('Name,Phone\nRebaz,0750 123 4567\nAhmad,0770 123 4567\n', { filename: 'my customers.csv' });
  const a = makeAudience(p, '  VIP customers  ', 1_700_000_000_000);
  eq('makeAudience: name, source, file, times', [a.name, a.source, a.file, a.created, a.updated], ['VIP customers', 'csv', 'my customers.csv', 1_700_000_000_000, 1_700_000_000_000]);
  eq('makeAudience: the same list at the same moment has the same id', a.id, makeAudience(p, 'x', 1_700_000_000_000).id);
  ok('makeAudience: another list at the same moment has another id', a.id !== makeAudience({ ...p, recipients: p.recipients.slice(1) }, 'x', 1_700_000_000_000).id);
  eq('makeAudience: no name falls back to the file\'s', makeAudience(p, '', 1).name, 'my customers');
  const hostile = makeAudience({
    format: 'evil', file: 42,
    recipients: [
      { phone: '9647501234567', name: `${RLO}x${ch(1)}`, vars: { '{a}': 'v'.repeat(500), b: 7, c: '' } },
      { phone: '9647501234567', vars: {} }, { phone: '+9647701234567', vars: {} }, { phone: '0750', vars: {} }, null, 'x',
      { phone: '9647801234567', vars: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 'v'])) },
    ],
  }, `${'n'.repeat(500)}`, Number.NaN);
  eq('makeAudience: every recipient read again (bad ones gone, duplicates gone)', hostile.recipients.map((r) => r.phone), ['9647501234567', '9647801234567']);
  eq('makeAudience: names and vars clamped', [hostile.recipients[0].name, Object.keys(hostile.recipients[0].vars), hostile.recipients[0].vars.a.length, Object.keys(hostile.recipients[1].vars).length],
    ['x', ['a'], 120, 12]);
  eq('makeAudience: a bad source and time are made safe', [hostile.source, hostile.created, hostile.name.length, hostile.file], ['text', 0, 60, undefined]);
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
