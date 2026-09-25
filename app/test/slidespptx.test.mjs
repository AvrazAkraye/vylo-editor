// The PowerPoint file, checked as PowerPoint reads it: a zip whose entries are
// intact, whose parts all have a type and every relationship a target, whose
// XML is balanced, and whose text is text — a title that looks like markup is
// printed, never obeyed.
import { crc32, imageOf, pptxBytes, pptxParts, xmlText, zip } from '../.test-build/slidespptx.js';
import { blankSlide, newDeck } from '../.test-build/slides.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

let n = 0;
const newId = () => `id${++n}`;
// A 1×1 PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function deckOf(lang, o = {}) {
  const d = newDeck({ id: 'd', now: 1, request: 'r', lang, kind: 'defense', theme: 'academic', count: 10 });
  const slides = ['title', 'section', 'bullets', 'two', 'stat', 'table', 'timeline', 'quote', 'references', 'end']
    .map((k) => blankSlide(k, { lang, title: 'T' }, newId));
  slides[2] = { ...slides[2], notes: 'Say this.\nAnd this.' };
  return { ...d, title: 'T', slides, meta: { presenter: 'P', supervisor: 'S', university: 'U', college: 'C', date: '2026' }, ...o };
}

/** The entries of a stored zip, read from its central directory as a reader does. */
function unzip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  if (v.getUint32(end, true) !== 0x06054B50) throw new Error('no end record');
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const out = new Map();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (v.getUint32(at, true) !== 0x02014B50) throw new Error('bad central record');
    const crc = v.getUint32(at + 16, true);
    const size = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true);
    const offset = v.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    if (v.getUint32(offset, true) !== 0x04034B50) throw new Error(`bad local header for ${name}`);
    const localName = v.getUint16(offset + 26, true);
    const data = bytes.subarray(offset + 30 + localName, offset + 30 + localName + size);
    out.set(name, { data, crc, text: () => dec.decode(data) });
    at += 46 + nameLen;
  }
  return out;
}

/** Tags balanced and attributes quoted: what a parser would refuse, found without one. */
function balanced(xml) {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, '');
  const stack = [];
  const re = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|<|>/g;
  let m;
  let last = 0;
  while ((m = re.exec(body))) {
    const between = body.slice(last, m.index);
    if (/[<>]/.test(between)) return `stray bracket near ${between.slice(0, 40)}`;
    last = re.lastIndex;
    if (m[0] === '<' || m[0] === '>') return `stray ${m[0]} at ${m.index}: ${body.slice(Math.max(0, m.index - 30), m.index + 30)}`;
    if (m[1]) {
      if (stack.pop() !== m[2]) return `unbalanced </${m[2]}>`;
    } else if (!m[4]) stack.push(m[2]);
  }
  return stack.length ? `unclosed <${stack[stack.length - 1]}>` : null;
}

// ── the zip ───────────────────────────────────────────────────────────────
ok('CRC-32 is the standard one', crc32(new TextEncoder().encode('123456789')) === 0xCBF43926);
{
  const z = zip([['a.txt', 'hello'], ['ب.xml', new Uint8Array([1, 2, 3])]]);
  ok('a zip opens with a local file header', z[0] === 0x50 && z[1] === 0x4B && z[2] === 3 && z[3] === 4);
  const e = unzip(z);
  ok('and reads back entry by entry', e.get('a.txt').text() === 'hello' && e.get('ب.xml').data.length === 3);
  ok('each entry’s CRC is its data’s', [...e.values()].every((x) => x.crc === crc32(x.data)));
}

// ── the parts ─────────────────────────────────────────────────────────────
for (const lang of ['en', 'ar', 'ckb']) {
  const deck = deckOf(lang, { logo: PNG, logoRatio: 1 });
  const bytes = pptxBytes(deck, new Date('2026-01-02T03:04:05Z'));
  const e = unzip(bytes);
  const names = [...e.keys()];
  ok(`[Content_Types].xml is first (${lang})`, names[0] === '[Content_Types].xml');
  ok(`one slide part per slide (${lang})`, names.filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x)).length === deck.slides.length);
  const bad = names.filter((x) => /\.(xml|rels)$/.test(x)).map((x) => [x, balanced(e.get(x).text())]).filter(([, b]) => b);
  ok(`every XML part is balanced (${lang})`, bad.length === 0, bad.slice(0, 3));

  // Every part has a content type, by extension or by name.
  const types = e.get('[Content_Types].xml').text();
  const defaults = new Set([...types.matchAll(/Default Extension="([^"]+)"/g)].map((m) => m[1]));
  const overrides = new Set([...types.matchAll(/Override PartName="([^"]+)"/g)].map((m) => m[1]));
  const untyped = names.filter((x) => x !== '[Content_Types].xml' && !overrides.has(`/${x}`) && !defaults.has(x.split('.').pop()));
  ok(`every part has a content type (${lang})`, untyped.length === 0, untyped);
  const ghost = [...overrides].filter((x) => !e.has(x.slice(1)));
  ok(`no content type names a part that is not there (${lang})`, ghost.length === 0, ghost);

  // Every relationship's target exists, resolved against its source's folder.
  const missing = [];
  for (const name of names.filter((x) => x.endsWith('.rels'))) {
    const dir = name.replace(/_rels\/[^/]*\.rels$/, '');
    for (const m of e.get(name).text().matchAll(/Target="([^"]+)"/g)) {
      const parts = (dir + m[1]).split('/');
      const path = [];
      for (const p of parts) { if (p === '..') path.pop(); else if (p && p !== '.') path.push(p); }
      if (!e.has(path.join('/'))) missing.push(`${name} → ${m[1]}`);
    }
  }
  ok(`every relationship points at a part (${lang})`, missing.length === 0, missing);

  const pres = e.get('ppt/presentation.xml').text();
  ok(`the slide is 16:9, 12192000 × 6858000 EMU (${lang})`, pres.includes('<p:sldSz cx="12192000" cy="6858000"/>'));
  ok(`the presentation’s direction is the deck’s (${lang})`, pres.includes('rtl="1"') === (lang !== 'en'));
  const s3 = e.get('ppt/slides/slide3.xml').text();
  ok(`paragraphs run in the deck’s direction (${lang})`, s3.includes(`rtl="${lang === 'en' ? 0 : 1}"`));
  ok(`a bullet is a bullet character in the accent (${lang})`, s3.includes('<a:buChar char="•"/>'));
  ok(`the language is tagged for spelling and fonts (${lang})`, s3.includes(`lang="${lang === 'en' ? 'en-US' : lang === 'ar' ? 'ar-IQ' : 'ku-Arab-IQ'}"`));
  ok(`speaker notes are a notes slide (${lang})`, e.has('ppt/notesSlides/notesSlide3.xml') && e.get('ppt/notesSlides/notesSlide3.xml').text().includes('And this.'));
  ok(`and only for slides that have notes (${lang})`, !e.has('ppt/notesSlides/notesSlide1.xml'));
  ok(`the logo is one picture, shared (${lang})`, names.filter((x) => x.startsWith('ppt/media/')).length === 1 && e.has('ppt/media/logo.png'));
  ok(`and drawn on the title slide (${lang})`, e.get('ppt/slides/slide1.xml').text().includes('<a:blip r:embed="rId2"/>'));
  const table = e.get('ppt/slides/slide6.xml').text();
  ok(`a table is a real table (${lang})`, table.includes('<a:tbl>') && (lang === 'en' ? !table.includes('<a:tblPr firstRow="1" bandRow="1" rtl="1"/>') : table.includes('rtl="1"')));
  ok(`the same deck makes the same bytes (${lang})`, (() => {
    const again = pptxBytes(deck, new Date('2026-01-02T03:04:05Z'));
    return again.length === bytes.length && again.every((b, i) => b === bytes[i]);
  })());
}

// ── text is text ──────────────────────────────────────────────────────────
ok('XML specials are escaped', xmlText('a < b & "c" > d') === 'a &lt; b &amp; &quot;c&quot; &gt; d');
ok('characters XML cannot hold are dropped', xmlText('a\u0001b\u000Bc￾') === 'abc');
ok('a lone surrogate is dropped, a pair kept', xmlText('x\uD800y😀') === 'xy😀');
{
  const hostile = deckOf('en');
  hostile.slides[2] = { ...hostile.slides[2], title: '</a:t></a:r><a:fld type="slidenum"/><a:r><a:t>', points: ['<p:sp/>'] };
  const e = unzip(pptxBytes(hostile));
  const s = e.get('ppt/slides/slide3.xml').text();
  ok('a title that looks like markup is printed, not obeyed', !s.includes('<a:fld') && s.includes('&lt;/a:t&gt;'));
  ok('and the part is still balanced', balanced(s) === null, balanced(s));
}

// ── pictures ──────────────────────────────────────────────────────────────
ok('a PNG data: URL is its bytes', imageOf(PNG)?.ext === 'png' && imageOf(PNG).bytes[1] === 0x50);
ok('a JPEG one is .jpeg', imageOf('data:image/jpeg;base64,/9j/4AAQ')?.ext === 'jpeg');
ok('anything else is no picture', imageOf('data:image/svg+xml;base64,PHN2Zz4=') === null && imageOf('https://x/y.png') === null && imageOf(undefined) === null);
{
  const parts = pptxParts(deckOf('en', { logo: 'data:image/svg+xml;base64,PHN2Zz4=' }));
  ok('a logo that is not a picture puts nothing in the file', !parts.some(([name]) => name.startsWith('ppt/media/'))
     && !parts.some(([name, data]) => name.startsWith('ppt/slides/slide') && typeof data === 'string' && data.includes('<p:pic>')));
}
{
  const empty = { ...deckOf('en'), slides: [] };
  const e = unzip(pptxBytes(empty));
  ok('a deck with no slides is still a file PowerPoint opens', e.has('ppt/presentation.xml') && e.get('ppt/presentation.xml').text().includes('<p:sldIdLst></p:sldIdLst>'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
