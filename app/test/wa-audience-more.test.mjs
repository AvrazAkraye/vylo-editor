// Package `audience`, the hostile half (docs/wa/briefs/audience.md): a file is a stranger. Headers in six languages and
// two scripts; zip bombs that tell the truth and ones that lie; workbooks cut short and bit-flipped; locked, foreign and
// oversized files; every ceiling (`LIMITS.recipients`, a thousand rejected listed, names, columns, values); the speed
// the brief asks for; and seeded fuzz over random bytes, random text, random tables and random vCards with the
// invariants that matter: it never throws, every phone is digits only, none repeats, nothing passes a limit.
//
// Every millisecond ceiling is `* SLOW` (as in pro-perf.test.mjs): a shared CI runner is several times slower.
import { deflateRawSync } from 'node:zlib';
import { parseAudience, normalisePhone } from '../.test-build/whatsappaudience.js';
import { readXlsx, SheetError, SHEET_LIMITS } from '../.test-build/whatsappsheet.js';
import { crc32 } from '../.test-build/slidespptx.js';

// `LIMITS` from whatsappbulktypes.ts, which the test bundle does not build on its own (it is types and these numbers);
// the golden file checks the same numbers through the reader's behaviour.
const LIMITS = { recipients: 5_000, valueChars: 120, columns: 12 };
const SLOW = process.env.CI ? 4 : 1; // a shared runner is several times slower than the machine that releases; budgets stay strict here
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); }
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
const info = (s) => console.log(`  info  ${s}`);
const phones = (p) => p.recipients.map((r) => r.phone);
const ch = (code) => String.fromCharCode(code);
async function timed(f) { const t = performance.now(); const v = await f(); return [v, performance.now() - t]; }

// ── a zip and a small workbook (inline strings and numbers only) ──────────

function zipOf(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, data, o = {}] of files) {
    const raw = typeof data === 'string' ? enc.encode(data) : data;
    const body = o.body ?? (o.deflate ? new Uint8Array(deflateRawSync(raw)) : raw);
    const nm = enc.encode(name);
    const size = o.claim ?? raw.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, (o.flags ?? 0) | 0x0800, true);
    local.setUint16(8, o.method ?? (o.deflate || o.body ? 8 : 0), true);
    local.setUint32(14, o.body ? 0 : crc32(raw), true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, size, true);
    local.setUint16(26, nm.length, true);
    chunks.push(new Uint8Array(local.buffer), nm, body);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, (o.flags ?? 0) | 0x0800, true);
    dir.setUint16(10, o.method ?? (o.deflate || o.body ? 8 : 0), true);
    dir.setUint32(16, o.body ? 0 : crc32(raw), true);
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

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const TYPES = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;
const BOOK = `<?xml version="1.0"?><workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const BOOK_RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const sheetXml = (rows) => `<?xml version="1.0"?><worksheet xmlns="${NS}"><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((c) => (
  typeof c === 'number' ? `<c><v>${c}</v></c>` : `<c t="inlineStr"><is><t>${esc(c)}</t></is></c>`)).join('')}</row>`).join('')}</sheetData></worksheet>`;
/** A workbook whose sheet part is `sheet` (text, or `[bytes, options]` for a hand-made entry). */
const book = (sheet, o = {}) => zipOf([
  ['[Content_Types].xml', TYPES, o], ['xl/workbook.xml', BOOK, o], ['xl/_rels/workbook.xml.rels', BOOK_RELS, o],
  Array.isArray(sheet) ? ['xl/worksheets/sheet1.xml', sheet[0], sheet[1]] : ['xl/worksheets/sheet1.xml', sheet, o],
]);

/** Reads that must come back, never throw, and say why when they find nobody. */
async function never(name, bytes, o, problem) {
  let p = null;
  let threw = null;
  try { p = await parseAudience(bytes, o); } catch (e) { threw = e; }
  ok(`${name}: parseAudience does not throw`, !threw, threw && String(threw));
  if (problem !== undefined) eq(`${name}: the problem is ${problem}`, p && [p.problem, p.recipients.length], [problem, 0]);
  return p;
}

// ── headers in six languages and two scripts ──────────────────────────────

{
  // Four columns: a reference that holds landline numbers, a city, the mobile, the name. Read by content alone, the
  // reference would be the phone column (it comes first, and every cell is a number) and the city the name (the first
  // column of words), so a right answer here is the header dictionary's doing.
  const headers = {
    en: ['Ref', 'City', 'Mobile number', 'Full name'],
    ar: ['رمز', 'المدينة', 'رقم الجوال', 'الاسم الكامل'],
    'ar (هاتف)': ['الفرع', 'المحافظة', 'الهاتف', 'اسم الزبون'],
    ckb: ['کۆد', 'شار', 'ژمارەی مۆبایل', 'ناوی تەواو'],
    'ckb (تەلەفۆن)': ['کۆد', 'شار', 'تەلەفۆن', 'ناو'],
    'kmr (Badini)': ['کۆد', 'باژێر', 'ژمارا موبایلێ', 'ناڤێ تەمام'],
    'kmr (Latin)': ['Kod', 'Bajar', 'Hejmara telefonê', 'Navê tevahî'],
    tr: ['Kod', 'Şehir', 'Cep Telefonu', 'Adı Soyadı'],
    'tr (İSİM)': ['KOD', 'ŞEHİR', 'TELEFON', 'İSİM'],
    fa: ['کد', 'شهر', 'شماره موبایل', 'نام'],
    'fa (تلفن همراه)': ['کد', 'شهر', 'تلفن همراه', 'نام مشتری'],
    de: ['Kennung', 'Stadt', 'Mobilnummer', 'Name'],
    'ar (keyboard variants: ة ی ک)': ['رمز', 'المدينة', 'رقم الموبایل', 'اسم العميل'],
  };
  for (const [lang, h] of Object.entries(headers)) {
    const csv = [h.join(','), 'R1,Erbil,0750 123 4567,Rebaz Ahmad', 'R2,Duhok,0770 123 4567,Shilan Kareem', 'R3,Zakho,0780 123 4567,Dara Ali']
      .map((l, i) => (i ? l.replace(/^R(\d)/, '066 225 123$1') : l)).join('\n');
    const p = await parseAudience(csv, { filename: `${lang}.csv` });
    eq(`header (${lang}): phone and name found by their words`, [p.phoneColumn, p.nameColumn, p.recipients[0]?.phone, p.recipients[0]?.name],
      [h[2], h[3], '9647501234567', 'Rebaz Ahmad']);
  }
  const words = ['Phone', 'رقم الهاتف', 'الجوال', 'موبايل', 'واتساب', 'ژمارە', 'تەلەفۆن', 'مۆبایل', 'telefon', 'cep', 'شماره', 'WhatsApp number', 'MSISDN', 'Tel.'];
  for (const w of words) {
    const p = await parseAudience(`Note,${w}\nhello,0750 123 4567\n`, { filename: 'w.csv' });
    eq(`header word "${w}" names the phone column`, p.phoneColumn, w);
  }
  const names = ['Name', 'الاسم', 'اسم', 'ناو', 'ناڤ', 'ad', 'isim', 'نام', 'Customer'];
  for (const w of names) {
    const p = await parseAudience(`City,${w},Phone\nErbil,Rebaz,0750 123 4567\n`, { filename: 'n.csv' });
    eq(`header word "${w}" names the name column`, p.nameColumn, w);
  }
  const hotel = await parseAudience('Hotel,Phone\nRoyal,0750 123 4567\n', { filename: 'h.csv' });
  ok('a header word is a whole word: "Hotel" is not "tel"', hotel.phoneColumn === 'Phone');
}

// ── zip bombs, cut zips, flipped bits, locked and foreign files ───────────

{
  const zeros = new Uint8Array(64 * 1024 * 1024);
  const bombBody = new Uint8Array(deflateRawSync(zeros, { level: 9 }));
  info(`a 64 MB part of zeros deflates to ${bombBody.length} bytes`);
  const [honest, t1] = await timed(() => never('a bomb that says how big it is', book(['', { body: bombBody, claim: zeros.length }]), { filename: 'b.xlsx' }, 'too-big'));
  ok('…refused before inflating anything', t1 < 200 * SLOW, `${t1.toFixed(0)} ms`);
  const [, t2] = await timed(() => never('a bomb that lies, claiming 2 KB', book(['', { body: bombBody, claim: 2048 }]), { filename: 'b.xlsx' }, 'damaged'));
  ok('…stopped at the first chunk past its claim', t2 < 300 * SLOW, `${t2.toFixed(0)} ms`);
  const under = SHEET_LIMITS.part - 1;
  const [, t3] = await timed(() => never('a bomb just under the part ceiling that lies by one byte', book(['', { body: new Uint8Array(deflateRawSync(new Uint8Array(under + 1), { level: 9 })), claim: under }]), { filename: 'b.xlsx' }, 'damaged'));
  ok('…read no further than the ceiling', t3 < 2000 * SLOW, `${t3.toFixed(0)} ms`);
  void honest;
  let threw = null;
  try { await readXlsx(book(['', { body: bombBody, claim: 2048 }])); } catch (e) { threw = e; }
  ok('readXlsx on a bomb throws a SheetError, nothing else', threw instanceof SheetError && threw.code === 'damaged', threw && String(threw));

  const good = book(sheetXml([['Phone'], ...Array.from({ length: 40 }, (_, i) => [7501234000 + i])]), { deflate: true });
  const whole = await parseAudience(good, { filename: 'g.xlsx' });
  eq('the deflated workbook the cuts are made from reads', phones(whole).length, 40);
  let cutsOk = 0;
  for (let cut = 1; cut < good.length; cut += Math.max(1, Math.floor(good.length / 97))) {
    const p = await parseAudience(good.subarray(0, cut), { filename: 'g.xlsx' });
    if (p && p.recipients.length === 0 && p.problem) cutsOk++;
  }
  ok('a workbook cut short anywhere is a problem, never a throw and never half a list', cutsOk >= 90, cutsOk);

  let seed = 0x5eed1;
  const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let flipsOk = 0;
  let onlySheetErrors = true;
  for (let k = 0; k < 150; k++) {
    const b = good.slice();
    const n = 1 + Math.floor(rand() * 6);
    for (let j = 0; j < n; j++) b[Math.floor(rand() * b.length)] ^= 1 << Math.floor(rand() * 8);
    let threwHere = null;
    try { await readXlsx(b); } catch (e) { threwHere = e; }
    if (threwHere && !(threwHere instanceof SheetError)) onlySheetErrors = false;
    const p = await parseAudience(b, { filename: 'g.xlsx' });
    if (p && Array.isArray(p.recipients) && p.recipients.every((r) => /^[1-9][0-9]{6,14}$/.test(r.phone))) flipsOk++;
  }
  eq('150 bit-flipped workbooks: every read comes back with only valid numbers', flipsOk, 150);
  ok('…and readXlsx throws only SheetError', onlySheetErrors);

  const ole = new Uint8Array(4096);
  ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  await never('an old .xls (or a password-protected .xlsx)', ole, { filename: 'old.xls' }, 'locked');
  await never('a part flagged encrypted', book(sheetXml([['Phone'], [7501234567]]), { flags: 1 }), { filename: 'e.xlsx' }, 'locked');
  await never('a zip with no content types', zipOf([['readme.txt', 'hello']]), { filename: 'z.xlsx' }, 'not-a-sheet');
  await never('a Word document renamed .xlsx', zipOf([['[Content_Types].xml', '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'], ['word/document.xml', '<w:document/>']]), { filename: 'w.xlsx' }, 'not-a-sheet');
  await never('a workbook with no sheet part', zipOf([['[Content_Types].xml', TYPES], ['xl/workbook.xml', BOOK]]), { filename: 'n.xlsx' }, 'not-a-sheet');
  await never('an entry compressed in a way not read here', book(sheetXml([['x']]), { method: 12 }), { filename: 'm.xlsx' }, 'damaged');
  const big = new Uint8Array(SHEET_LIMITS.file + 1);
  big.set([0x50, 0x4b, 3, 4]);
  await never('a workbook over 10 MB', big, { filename: 'big.xlsx' }, 'too-big');
  await never('random bytes named .xlsx', Uint8Array.from({ length: 5000 }, (_, i) => (i * 131 + 7) & 0xff), { filename: 'r.xlsx' }, 'not-a-sheet');
  await never('a PK header and nothing else', new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), { filename: 'p.xlsx' }, 'damaged');
  const entity = book(`<?xml version="1.0"?><!DOCTYPE w [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><worksheet xmlns="${NS}"><sheetData><row r="1"><c t="inlineStr"><is><t>&b;</t></is></c><c t="inlineStr"><is><t>&#1575;&amp;&#x41;</t></is></c></row><row r="2"><c><v>7501234567</v></c></row></sheetData></worksheet>`);
  eq('a DOCTYPE\'s entities are never expanded; the five named and numeric ones are', await readXlsx(entity), [['&b;', 'ا&A'], ['7501234567']]);
  const far = await readXlsx(book(`<worksheet xmlns="${NS}"><sheetData><row r="1048576"><c r="XFD1048576"><v>1</v></c></row></sheetData></worksheet>`));
  eq('a cell claimed to be at row 1,048,576 allocates nothing for the rows above', far, []);
}

// ── the ceilings ──────────────────────────────────────────────────────────

{
  const many = Array.from({ length: LIMITS.recipients + 1 }, (_, i) => `07${String(500000000 + i).padStart(9, '0')}`).join('\n');
  const p = await parseAudience(many);
  eq(`${LIMITS.recipients + 1} distinct numbers: ${LIMITS.recipients} kept, and it says it stopped`, [p.recipients.length, p.truncated], [LIMITS.recipients, true]);
  const fine = await parseAudience(Array.from({ length: 30 }, (_, i) => `0750${String(1000000 + i)}`).join('\n'));
  eq('a list that fits is not truncated', fine.truncated, undefined);

  const junk = Array.from({ length: 50_000 }, (_, i) => `0750 12${i % 10}`).join('\n');
  const [j, tj] = await timed(() => parseAudience(junk));
  eq('50,000 bad lines: a thousand listed, the rest counted', [j.rejected.length, j.rejectedMore, j.recipients.length], [1000, 49_000, 0]);
  ok('…promptly', tj < 600 * SLOW, `${tj.toFixed(0)} ms`);

  const landlines = Array.from({ length: 1500 }, (_, i) => `066 ${String(2000000 + i)}`).join('\n');
  const w = await parseAudience(landlines);
  eq('warnings are listed up to a thousand', [w.recipients.length, w.warned.length], [1500, 1000]);

  const nasty = `${ch(0x202e)}${'Ab'.repeat(300)}${ch(1)}${ch(0x7f)}${ch(0x9b)}${ch(0x2066)}${ch(0xfeff)}`;
  const named = await parseAudience(`Name,Phone\n"${nasty}",0750 123 4567\n`, { filename: 'n.csv' });
  const nm = named.recipients[0].name;
  ok('a name: capped at 120 characters, control and bidi characters gone', [...nm].length === 120 && !/[\p{Cc}\u{202a}-\u{202e}\u{2066}-\u{2069}\u{feff}]/u.test(nm), nm);
  const joiners = await parseAudience(`ناو,ژمارە\nشادی${ch(0x200c)}یە,0750 123 4567\n`, { filename: 'k.csv' });
  ok('…but the zero-width non-joiner Persian and Kurdish spell with stays', joiners.recipients[0].name.includes(ch(0x200c)));

  const wide = ['Name', 'Phone', ...Array.from({ length: 40 }, (_, i) => `col${i}`)].join(',') + '\n'
    + ['Rebaz', '0750 123 4567', 'v'.repeat(500), ...Array.from({ length: 39 }, (_, i) => `x${i}`)].join(',') + '\n';
  const wv = await parseAudience(wide, { filename: 'w.csv' });
  const vars = wv.recipients[0].vars;
  eq('forty extra columns: twelve kept as variables, values capped at 120', [Object.keys(vars).length, vars.col0.length], [LIMITS.columns, LIMITS.valueChars]);

  const long = `Phone\n${'0'.repeat(5 * 1024 * 1024)}\n`;
  const [lp, tl] = await timed(() => parseAudience(long, { filename: 'l.csv' }));
  eq('a 5 MB cell: rejected as too long, its text cut to 120', [lp.rejected[0]?.why, lp.rejected[0]?.raw.length], ['too-long', 120]);
  ok('…promptly', tl < 500 * SLOW, `${tl.toFixed(0)} ms`);

  const huge = 'x'.repeat(SHEET_LIMITS.file + 100) + '\n0750 123 4567';
  const hp = await parseAudience(huge);
  eq('text past 10 MB is not read, and it says so', [hp.truncated, hp.recipients.length], [true, 0]);
  const hugeBytes = new TextEncoder().encode('0750 123 4567\n' + '#'.repeat(SHEET_LIMITS.file) + '\n0770 123 4567\n');
  const hb = await parseAudience(hugeBytes, { filename: 'h.txt' });
  eq('a file past 10 MB is read up to its last whole line before the ceiling', [hb.truncated, phones(hb)], [true, ['9647501234567']]);
}

// ── speed ─────────────────────────────────────────────────────────────────

{
  const n = 5000;
  const text = Array.from({ length: n }, (_, i) => `Customer ${String.fromCharCode(65 + (i % 26))}, 07${String(500000000 + i).padStart(9, '0')}`).join('\n');
  const [pt, tt] = await timed(() => parseAudience(text));
  info(`5,000 lines of text: ${tt.toFixed(0)} ms`);
  ok('5,000 lines of pasted text in well under a second', pt.recipients.length === n && tt < 400 * SLOW, `${pt.recipients.length} in ${tt.toFixed(0)} ms`);

  const csv = 'Name,Phone,City,Notes\n' + Array.from({ length: n }, (_, i) => `"Name ${i}",07${String(700000000 + i).padStart(9, '0')},Erbil,"note, ${i}"`).join('\n');
  const [pc, tc] = await timed(() => parseAudience(csv, { filename: 'big.csv' }));
  info(`5,000 CSV rows: ${tc.toFixed(0)} ms`);
  ok('5,000 CSV rows in well under a second', pc.recipients.length === n && tc < 400 * SLOW, `${pc.recipients.length} in ${tc.toFixed(0)} ms`);

  const photo = `PHOTO;ENCODING=b;TYPE=JPEG:${'A'.repeat(70)}\r\n${Array.from({ length: 1500 }, () => ` ${'Q'.repeat(70)}`).join('\r\n')}`;
  const vcf = Array.from({ length: n }, (_, i) => ['BEGIN:VCARD', 'VERSION:3.0', `FN:Person ${i}`, `N:${i};Person;;;`, `TEL;TYPE=CELL:+964 78${String(10000000 + i)}`,
    'TEL;TYPE=WORK:066 225 1234', i === 7 ? photo : 'NOTE:hi', 'END:VCARD'].join('\r\n')).join('\r\n');
  const [pv, tv] = await timed(() => parseAudience(vcf, { filename: 'all.vcf' }));
  info(`5,000 vCards (one with a 100 KB photo): ${tv.toFixed(0)} ms`);
  ok('5,000 vCards in well under a second', pv.recipients.length === n && tv < 500 * SLOW, `${pv.recipients.length} in ${tv.toFixed(0)} ms`);

  const sheet = book(sheetXml([['Name', 'Phone', 'City'], ...Array.from({ length: n }, (_, i) => [`Name ${i}`, 7700000000 + i, 'Duhok'])]), { deflate: true });
  const [px, tx] = await timed(() => parseAudience(sheet, { filename: 'big.xlsx' }));
  info(`5,000 workbook rows: ${tx.toFixed(0)} ms`);
  ok('5,000 workbook rows in well under a second', px.recipients.length === n && tx < 600 * SLOW, `${px.recipients.length} in ${tx.toFixed(0)} ms`);

  const prose = Array.from({ length: 50_000 }, (_, i) => `junk line ${i} with words, 12-34, ref ABC${i}, dated 2024-05-0${i % 9 + 1}`).join('\n');
  const [pj, tj] = await timed(() => parseAudience(prose));
  ok('50,000 lines of prose with no number in them: nothing, promptly', pj.recipients.length === 0 && pj.rejected.length === 0 && tj < 600 * SLOW, `${tj.toFixed(0)} ms`);

  const hostile = [
    ['5 MB of zeros', '0'.repeat(5 * 1024 * 1024)],
    ['a million dashes, then a name and a number', `${'-'.repeat(999_000)}a 0750 123 4567`],
    ['"0000 " a million times', '0000 '.repeat(1_000_000)],
    ['a quote that never closes, 5 MB', `"Name,Phone\n${'Rebaz,0750 123 4567\n'.repeat(250_000)}`],
    ['a million commas', ','.repeat(1_000_000)],
    ['a million plus signs', '+'.repeat(1_000_000)],
    ['5 MB of Arabic digits', '٠'.repeat(5 * 1024 * 1024)],
    ['a million BEGIN:VCARD', 'BEGIN:VCARD\n'.repeat(1_000_000)],
  ];
  for (const [name, input] of hostile) {
    const [p, t] = await timed(() => parseAudience(input, name.includes('quote') ? { filename: 'q.csv' } : {}));
    ok(`hostile: ${name} — ${t.toFixed(0)} ms`, p && t < 1500 * SLOW && p.recipients.every((r) => /^[1-9][0-9]{6,14}$/.test(r.phone)), `${t.toFixed(0)} ms`);
  }
  const unclosed = await parseAudience(`"Name,Phone\nRebaz,0750 123 4567\nAhmad,0770 123 4567\n`, { filename: 'q.csv' });
  eq('a quote that never closes does not swallow the rest of the file', phones(unclosed), ['9647501234567', '9647701234567']);
  const dashes = await parseAudience(`${'-'.repeat(500_000)}a 0750 123 4567`);
  eq('half a million dashes before a number: the number is still found', phones(dashes), ['9647501234567']);
}

// ── fuzz ──────────────────────────────────────────────────────────────────

const BAD_NAME = /[\p{Cc}\u{202a}-\u{202e}\u{2066}-\u{2069}\u{200e}\u{200f}\u{feff}]/u;

/** Every invariant a read must keep, whatever it was given; the first broken one, or ''. */
function broken(p) {
  if (!p || typeof p !== 'object') return 'no result';
  if (!Array.isArray(p.recipients) || !Array.isArray(p.rejected)) return 'no lists';
  if (p.recipients.length > LIMITS.recipients) return 'too many recipients';
  if (p.rejected.length > 1000 || (p.warned?.length ?? 0) > 1000) return 'too many listed';
  const seen = new Set();
  for (const r of p.recipients) {
    if (typeof r.phone !== 'string' || !/^[1-9][0-9]{6,14}$/.test(r.phone)) return `bad phone ${JSON.stringify(r.phone)}`;
    if (seen.has(r.phone)) return `duplicate ${r.phone}`;
    seen.add(r.phone);
    if (r.name !== undefined && (typeof r.name !== 'string' || !r.name || [...r.name].length > LIMITS.valueChars || BAD_NAME.test(r.name) || r.name !== r.name.trim())) return `bad name ${JSON.stringify(r.name)}`;
    if (!r.vars || typeof r.vars !== 'object' || Object.keys(r.vars).length > LIMITS.columns) return 'bad vars';
    for (const [k, v] of Object.entries(r.vars)) {
      if (!k || /[{}|[\]]/.test(k) || [...k].length > 40) return `bad key ${JSON.stringify(k)}`;
      if (typeof v !== 'string' || !v || [...v].length > LIMITS.valueChars || BAD_NAME.test(v)) return `bad value ${JSON.stringify(v)}`;
    }
  }
  for (const r of p.rejected) {
    if (!Number.isInteger(r.line) || r.line < 1 || typeof r.raw !== 'string' || [...r.raw].length > LIMITS.valueChars) return `bad rejected ${JSON.stringify(r)}`;
    if (!['empty', 'too-short', 'too-long', 'not-a-number', 'country-unknown'].includes(r.why)) return `bad why ${r.why}`;
  }
  if (!Number.isInteger(p.duplicates) || p.duplicates < 0) return 'bad duplicates';
  return '';
}

{
  const SEED = Number(process.env.WA_FUZZ_SEED ?? 20261004);
  let s = SEED;
  const rand = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const int = (n) => Math.floor(rand() * n);
  const pieces = ['0750 123 4567', '+964 770 123 4567', '٠٧٨٠١٢٣٤٥٦٧', '۰۹۱۲۳۴۵۶۷۸۹', '9.647501234567E+12', '7501234567', '066 225 1234',
    'Rebaz', 'رێباز', 'شيلان', 'Şükrü', '"', '""', ',', ';', '\t', '|', '\n', '\r\n', ' ', '-', '(', ')', '+', '00', 'Name', 'Phone', 'الاسم',
    'رقم', 'ژمارە', 'BEGIN:VCARD', 'END:VCARD', 'TEL;CELL:', 'FN:', '=D8=B1', '=\n', ch(0x202e), ch(0x200f), ch(0), ch(0xfeff), 'e+', '.0', '1', '9', '0'];
  const failures = [];
  const run = async (kind, input, o) => {
    let p;
    try { p = await parseAudience(input, o); } catch (e) { failures.push(`${kind}: threw ${e}`); return; }
    const b = broken(p);
    if (b) failures.push(`${kind}: ${b}`);
  };
  for (let k = 0; k < 250; k++) {
    await run('random bytes', Uint8Array.from({ length: int(3000) }, () => int(256)), { filename: pick(['a.csv', 'a.txt', 'a.vcf', 'a.tsv', '']) });
    let text = '';
    for (let j = int(400); j > 0; j--) text += String.fromCodePoint(rand() < 0.7 ? 32 + int(95) : pick([int(0x2fff), 0x600 + int(0x100), 0x660 + int(10), 0x6f0 + int(10), 0x200b + int(8), 0x202a + int(5), 0x1f600 + int(80)]));
    await run('random text', text, { defaultCountry: pick(['964', '90', '98', '1', '44', '999', '', 'abc']) });
    let soup = '';
    for (let j = int(200); j > 0; j--) soup += pick(pieces);
    await run('random pieces', soup, { filename: pick(['a.csv', 'a.txt', 'a.vcf', 'a.tsv', undefined]), phoneColumn: pick([undefined, 'Phone', 'A', '']), nameColumn: pick([undefined, 'Name', '', 'B']) });
    const d = pick([',', ';', '\t', '|']);
    const table = Array.from({ length: 1 + int(30) }, () => Array.from({ length: 1 + int(8) }, () => pick(pieces.filter((x) => x !== '\n' && x !== '\r\n'))).join(d)).join('\n');
    await run('random table', table, { filename: pick(['t.csv', 't.tsv', 't.txt']) });
    const vcard = Array.from({ length: 1 + int(8) }, () => ['BEGIN:VCARD', ...Array.from({ length: int(8) }, () => `${pick(['TEL', 'FN', 'N', 'item1.TEL', 'item1.X-ABLabel', 'ORG', 'BEGIN', 'END'])}${pick(['', ';CELL', ';TYPE=cell,pref', ';ENCODING=QUOTED-PRINTABLE', ';CHARSET=bogus'])}:${pick(pieces)}${pick(pieces)}`), pick(['END:VCARD', ''])].join(pick(['\n', '\r\n', '\n '])).repeat(1)).join('\n');
    await run('random vcard', vcard, {});
  }
  eq(`fuzz (seed ${SEED}): 1,250 random inputs, every invariant kept`, failures.slice(0, 5), []);

  let normFail = 0;
  for (let k = 0; k < 5000; k++) {
    let raw = '';
    for (let j = int(24); j > 0; j--) raw += pick(['0', '7', '5', '9', '1', '+', ' ', '-', '(', ')', '.', '٠', '۷', 'E', 'a', '00', ch(0x200e)]);
    const r = normalisePhone(raw, pick(['964', '90', '1', '7', '39', '965', '']));
    if ('phone' in r ? !/^[1-9][0-9]{6,14}$/.test(r.phone) : !['empty', 'too-short', 'too-long', 'not-a-number', 'country-unknown'].includes(r.why)) normFail++;
  }
  eq(`fuzz (seed ${SEED}): 5,000 random number strings normalise to digits or to a reason`, normFail, 0);
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
