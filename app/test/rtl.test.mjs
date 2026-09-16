// Interface direction, and the stylesheet that has to follow it.
//
// Two things are protected here, and only one of them is `dirFor`.
//
// The first is the mapping itself: three of the four languages this app ships
// in are written right to left, and an unknown code has to fall back rather
// than throw — `dirFor` is called with whatever `localStorage` holds, before
// the first paint, and a stored value is input rather than memory.
//
// The second is the one that matters over time. Converting 90-odd declarations
// to logical properties is a one-afternoon job; keeping them converted is not.
// A single `padding-left` added next month to a file this size is invisible in
// review and invisible in English, and it un-mirrors one control for the app's
// primary market. So the scan below reads `styles.css`, finds every physical
// left/right declaration in it, and requires each one to be named in EXEMPT
// with the reason it is deliberate. A new one is a failing test.
//
// The allow-list is falsifiable in both directions, which is the lesson this
// repo already wrote down about `orphans.mjs`: an entry that no longer matches
// anything fails too, so it cannot outlive the thing it excused.
//
// And the scanner is checked against a fixture holding one of each shape it
// looks for. A regex that has stopped matching returns nothing, and nothing is
// indistinguishable from a clean stylesheet — the same failure that hid every
// multi-line i18n entry behind a stray `\r` until Windows CI found it. Which is
// also why the whole scan is run a second time over a CRLF copy of the file:
// GitHub's Windows runners check this repo out with CRLF.
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { applyDir, dirFor, watchLang } from '../.test-build/rtl.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
};

// ── dirFor ────────────────────────────────────────────────────────────────
{
  for (const code of ['ar', 'ckb', 'kmr']) {
    ok(`${code} is right to left`, dirFor(code) === 'rtl', dirFor(code));
  }
  ok('en is left to right', dirFor('en') === 'ltr', dirFor('en'));

  // The whole point of the fallback: this is reached with a hand-edited store
  // and with a language nobody has shipped yet.
  let threw = false;
  let unknown;
  try { unknown = dirFor('zz'); } catch { threw = true; }
  ok('an unknown code does not throw', !threw);
  ok('an unknown code is left to right', unknown === 'ltr', String(unknown));

  ok('an empty string is left to right', dirFor('') === 'ltr');
  ok('null is left to right', dirFor(null) === 'ltr');
  ok('undefined is left to right', dirFor(undefined) === 'ltr');
  ok('a non-string is left to right', dirFor(7) === 'ltr');

  // Only the primary subtag decides, so a region this app never shipped cannot
  // flip a language — in either direction.
  ok('ar-EG is right to left', dirFor('ar-EG') === 'rtl');
  ok('AR is right to left', dirFor('AR') === 'rtl');
  ok('ckb_IQ is right to left', dirFor('ckb_IQ') === 'rtl');
  ok('en-GB is left to right', dirFor('en-GB') === 'ltr');
  // `ara` is a different tag from `ar`, and a prefix match would call it RTL.
  ok('ara is not treated as ar', dirFor('ara') === 'ltr');
}

// ── every shipped language has been given a direction ─────────────────────
//
// Read from `i18n.ts` rather than imported, the way `i18n.test.mjs` reads it:
// the catalogue is a 1400-line module and this test needs four strings from it.
// A fifth language added to LANGS without a decision about its direction fails
// here rather than shipping as left-to-right by default.
{
  const src = readFileSync(join(SRC, 'i18n.ts'), 'utf8').replace(/\r\n?/g, '\n');
  const block = src.match(/export const LANGS[^=]*=\s*\[([\s\S]*?)\];/);
  const codes = block ? [...block[1].matchAll(/code:\s*'([a-z-]+)'/g)].map((m) => m[1]) : [];

  // Liveness: if this regex stops matching, the checks below all pass vacuously.
  ok('LANGS was found and parsed', codes.length === 4, `found ${codes.length}: ${codes}`);
  ok('LANGS is the four shipped languages',
     codes.join(',') === 'en,ar,ckb,kmr', codes.join(','));

  const rtl = codes.filter((c) => dirFor(c) === 'rtl');
  ok('three of the four are right to left', rtl.length === 3, rtl.join(','));
}

// ── the stylesheet scanner ────────────────────────────────────────────────

/** Comments, replaced by spaces so line numbers and token boundaries survive. */
const blankComments = (css) =>
  css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** Values at the top level of a declaration: `var(--a) var(--b)` is two. */
function values(text) {
  const out = [];
  let depth = 0, buf = '';
  for (const c of text) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (depth === 0 && /\s/.test(c)) { if (buf) { out.push(buf); buf = ''; } continue; }
    buf += c;
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * Every declaration in a stylesheet, with the selector it sits under and the
 * line its property name starts on. A hand-rolled walk rather than a parser
 * dependency, for the reason `orphans.mjs` gives: this is fifty lines of string
 * handling, and when it is wrong the fix is here.
 */
function declarations(css) {
  const src = blankComments(css.replace(/\r\n?/g, '\n'));
  const out = [];
  const stack = [];
  let buf = '', line = 1, start = 1;
  const flush = () => {
    const text = buf.trim();
    buf = '';
    if (!text || !stack.length) return;
    const at = text.indexOf(':');
    if (at <= 0) return;
    out.push({
      selector: stack[stack.length - 1],
      prop: text.slice(0, at).trim().toLowerCase(),
      value: text.slice(at + 1).trim(),
      line: start,
    });
  };
  for (const c of src) {
    if (c === '\n') {
      line++;
      if (buf) buf += ' '; else start = line;
      continue;
    }
    if (c === '{') { stack.push(buf.trim().replace(/\s+/g, ' ')); buf = ''; start = line; continue; }
    if (c === '}') { flush(); stack.pop(); start = line; continue; }
    if (c === ';') { flush(); start = line; continue; }
    if (!buf && /\s/.test(c)) { start = line; continue; }
    buf += c;
  }
  return out;
}

/** Properties whose name names a side. */
const SIDED = new Set([
  'left', 'right',
  'padding-left', 'padding-right',
  'margin-left', 'margin-right',
  'border-left', 'border-right',
  'border-left-width', 'border-right-width',
  'border-left-style', 'border-right-style',
  'border-left-color', 'border-right-color',
  'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-left-radius', 'border-bottom-right-radius',
  'scroll-margin-left', 'scroll-margin-right',
  'scroll-padding-left', 'scroll-padding-right',
]);

/** Properties whose *value* names a side. */
const SIDED_VALUE = new Set(['text-align', 'float', 'clear']);

/** Shorthands whose four-value form is asymmetric across the inline axis. */
const FOUR_UP = new Set(['padding', 'margin', 'border-radius']);

/**
 * Every declaration in `css` that hard-codes a direction, as
 * `selector | prop | reason`.
 */
function findings(css) {
  const out = [];
  for (const d of declarations(css)) {
    const key = (why) => ({ selector: d.selector, prop: d.prop, why, line: d.line });
    if (SIDED.has(d.prop)) out.push(key('physical side'));
    else if (SIDED_VALUE.has(d.prop) && /^(left|right)$/i.test(d.value)) out.push(key('physical value'));
    else if (d.prop === 'direction' && /^(ltr|rtl)$/i.test(d.value)) out.push(key('pinned direction'));
    else if (FOUR_UP.has(d.prop) && values(d.value).length === 4) out.push(key('four-value shorthand'));
  }
  return out;
}

// ── the scanner still finds things ────────────────────────────────────────
//
// One of each shape it looks for, plus the shapes that must NOT trip it: a
// logical property whose name contains "left" nowhere, a `filter:brightness()`
// whose text ends in "right", the token named `--traffic-lights`, and a
// symmetric shorthand.
{
  const FIXTURE = `
    .z{ /* padding-left:4px; text-align:right; */ color:red; }
    .a{ padding-left:4px; margin-right:auto; border-left:1px solid red; }
    .b{ left:0; right:0; text-align:left; float:right; }
    .c{ padding:1px 2px 3px 4px; margin:0 auto 0 6px; border-radius:1px 2px 3px 4px; }
    .d{ direction:rtl; }
    .clean{
      padding-inline-start:4px; margin-inline-end:auto; inset-inline-end:0;
      text-align:start; padding:1px 2px; padding-block:1px 2px;
      filter:brightness(1.06); border-top-color:red; flex-direction:column;
      width:var(--traffic-lights); border-bottom-left-radius:0;
    }
  `;
  const f = findings(FIXTURE);
  const got = (sel, prop) => f.some((x) => x.selector === sel && x.prop === prop);

  ok('finds padding-left', got('.a', 'padding-left'));
  ok('finds margin-right', got('.a', 'margin-right'));
  ok('finds border-left', got('.a', 'border-left'));
  ok('finds a bare left', got('.b', 'left'));
  ok('finds a bare right', got('.b', 'right'));
  ok('finds text-align:left', got('.b', 'text-align'));
  ok('finds float:right', got('.b', 'float'));
  ok('finds a four-value padding', got('.c', 'padding'));
  ok('finds a four-value margin', got('.c', 'margin'));
  ok('finds a four-value border-radius', got('.c', 'border-radius'));
  ok('finds a pinned direction', got('.d', 'direction'));
  ok('a commented-out declaration does not count', !got('.z', 'padding-left'));

  const clean = f.filter((x) => x.selector === '.clean');
  // `border-bottom-left-radius` in `.clean` is a genuine finding; everything
  // else in that rule must be silent. Naming the one keeps this honest.
  ok('logical properties and lookalikes do not trip it',
     clean.length === 1 && clean[0].prop === 'border-bottom-left-radius',
     clean.map((x) => x.prop).join(','));
}

// ── styles.css is converted, apart from what is named here ────────────────
//
// Each entry names the route the scanner cannot see. `why` is not decoration:
// it is the sentence that has to still be true for the exemption to stand, and
// the same sentence is written at the site in `styles.css`.
const EXEMPT = [
  // 1. macOS window chrome. The frame does not turn around because the
  //    interface inside it does.
  { selector: '.mac .bar', prop: 'padding-left',
    why: 'traffic-light inset: an OS measurement of a window that does not mirror' },
  { selector: '.mac .shell.fullscreen .bar', prop: 'padding-left',
    why: 'the same inset, in full screen' },
  { selector: '.tl', prop: 'padding',
    why: 'the strip that draws the macOS window buttons, physical with its inset' },
  { selector: '.tl', prop: 'direction',
    why: 'close, minimise, zoom is an order people recognise, not a reading order' },
  { selector: '.mac .tl', prop: 'margin-right',
    why: 'clearance from the window-button hover zone, an OS measurement of a corner that does not mirror' },
  { selector: ':root[dir="rtl"].mac .tl', prop: 'margin-right',
    why: 'the same clearance, wide enough for the control that lands there in a right-to-left header' },

  { selector: '.tpaste-what code', prop: 'direction',
    why: 'the first line of pasted text, shown as what it is rather than as prose' },
  { selector: '.sug-ghost', prop: 'direction',
    why: 'a shell command line reads left to right in every language this ships in' },
  { selector: '.sug-list', prop: 'direction',
    why: 'the same: program names and paths are not prose and do not mirror' },

  // 2. The path-truncation trick. `direction:rtl` here puts the ellipsis at the
  //    head of a long path so the tail that identifies the file survives, and
  //    `text-align:left` holds the shortened text against the leading edge.
  //    Converting either inverts the trick and eats the tail it exists to keep.
  { selector: '.rv-files .fp', prop: 'direction', why: 'head-truncation, not language direction' },
  { selector: '.rv-files .fp', prop: 'text-align', why: 'the other half of head-truncation' },
  { selector: '.pal-dir', prop: 'direction', why: 'head-truncation, not language direction' },
  { selector: '.pal-dir', prop: 'text-align', why: 'the other half of head-truncation' },
  { selector: '.wc-path', prop: 'direction', why: 'head-truncation, not language direction' },
  { selector: '.wc-path', prop: 'text-align', why: 'the other half of head-truncation' },
  { selector: '.mpick-dir', prop: 'direction', why: 'head-truncation, not language direction' },
  { selector: '.mpick-dir', prop: 'text-align', why: 'the other half of head-truncation' },

  // 3. Code does not mirror. A right-to-left CodeMirror would reverse the
  //    reading order of a file whose language has no opinion about the
  //    interface it is being edited in; a diff's gutter is a coordinate system;
  //    the terminal is a grid a program draws into by column; and a command
  //    waiting for approval has to read exactly as it will run.
  // `.tfoot-path` joined the list: a filesystem path is a path, and reading
  // `/Users/you/work` right-to-left would put the root at the wrong end.
  { selector: '.ed .cm-editor, .term-host, .tfoot-path, .rv-diff pre, .fh-pre, .md-code, .pal-line, .ask-txt code, .mcp-what code',
    prop: 'direction',
    why: 'source code, diffs, the terminal, a path and an approvable command are LTR whatever the UI is' },
];

{
  const css = readFileSync(join(SRC, 'styles.css'), 'utf8');
  const found = findings(css);
  const id = (x) => `${x.selector} | ${x.prop}`;
  const allowed = new Set(EXEMPT.map(id));

  const surprises = found.filter((x) => !allowed.has(id(x)));
  ok('no undocumented physical direction in styles.css', surprises.length === 0,
     surprises.map((x) => `${x.selector} { ${x.prop} } line ${x.line}`).join(' · '));

  // The other direction: an exemption that no longer matches anything is the
  // `.vw-*` bug wearing a different hat — one half deleted, the other left
  // behind. It has to come back as a finding or it is not an exemption.
  const seen = new Set(found.map(id));
  const stale = EXEMPT.filter((e) => !seen.has(id(e)));
  ok('every exemption still names a real declaration', stale.length === 0,
     stale.map(id).join(' · '));

  ok('every exemption says why', EXEMPT.every((e) => typeof e.why === 'string' && e.why.length > 20));

  // Liveness again, one level up: this file is 1900 lines and the scan walks
  // all of it. A parse that silently produced nothing would pass both checks
  // above.
  const decls = declarations(css);
  ok('the scan actually read the stylesheet', decls.length > 800, String(decls.length));
  ok('the stylesheet uses logical properties',
     decls.filter((d) => /^(padding|margin|border|inset)-inline/.test(d.prop)).length > 40,
     String(decls.filter((d) => /^(padding|margin|border|inset)-inline/.test(d.prop)).length));

  // Windows CI checks out with CRLF, and a regex over a source file has cost
  // this repo a red build once already. Same file, same findings.
  const crlf = css.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
  const fromCrlf = findings(crlf);
  ok('CRLF gives the same findings',
     fromCrlf.map(id).join('\n') === found.map(id).join('\n'),
     `${fromCrlf.length} vs ${found.length}`);
  ok('CRLF gives the same line numbers',
     fromCrlf.map((x) => x.line).join(',') === found.map((x) => x.line).join(','));
}

// ── dir is stamped, and stamped once ──────────────────────────────────────
//
// The mapping has one owner. A second place setting `dir` from its own idea of
// which languages are right-to-left is how `lang` and `dir` came to disagree in
// the first place, so the app is allowed exactly one writer of the attribute.
{
  const read = (f) => readFileSync(join(SRC, f), 'utf8').replace(/\r\n?/g, '\n');
  const files = readdirSync(SRC).filter((f) => /\.(ts|tsx)$/.test(f)).sort();
  const writers = files.filter((f) => /\.dir\s*=[^=]|setAttribute\(\s*['"]dir['"]/.test(read(f)));
  ok('rtl.ts is the only module that writes the dir attribute',
     writers.join(',') === 'rtl.ts',
     `${writers.join(',')} — direction is derived from lang in rtl.ts; a second writer is how lang and dir came to disagree`);

  // And it is applied before the first paint, beside the theme, rather than in
  // an effect that runs after the window has been drawn the other way round.
  const main = read('main.tsx');
  ok('main.tsx stamps the direction at startup', /applyDir\(\s*storedLang\(\)\s*\)/.test(main));
  ok('main.tsx keeps it in step after that', /watchLang\(\)/.test(main));
}

// ── the attribute actually moves, and moves back ──────────────────────────
//
// Everything above this is either the mapping or a grep. The thing that broke
// in the first place was neither: `lang` was being written and `dir` was not,
// and no test could have seen that because no test drove the two together.
//
// So this drives them. `document` and `MutationObserver` are stubbed rather
// than mocked out — the stub is a real object with a `lang` and a `dir` and an
// observer that fires when the test says so, which is what a browser is from
// `rtl.ts`'s point of view. What it proves is the round trip: the direction is
// derived at startup, follows a language change made by somebody else, and
// comes BACK when the language returns to English. A `watchLang` that only ever
// set `rtl` would pass every other check in this file and leave the app mirrored
// for ever after one visit to Arabic.
{
  const root = { lang: '', dir: '' };
  const observers = [];
  const realDoc = globalThis.document;
  const realMO = globalThis.MutationObserver;
  globalThis.document = { documentElement: root };
  globalThis.MutationObserver = class {
    constructor(fn) { this.fn = fn; this.watching = false; }
    observe() { this.watching = true; observers.push(this); }
    disconnect() { this.watching = false; }
  };
  /** What the browser does after an attribute write the observer is watching. */
  const setLang = (v) => {
    root.lang = v;
    for (const o of observers) if (o.watching) o.fn();
  };

  try {
    ok('applyDir stamps both attributes at startup',
       applyDir('ar') === 'rtl' && root.lang === 'ar' && root.dir === 'rtl',
       `lang=${root.lang} dir=${root.dir}`);

    const stop = watchLang();

    setLang('en');
    ok('a language change to English turns the layout back round', root.dir === 'ltr', root.dir);
    setLang('ckb');
    ok('and a change to Sorani turns it again', root.dir === 'rtl', root.dir);
    setLang('kmr');
    ok('and to Badini', root.dir === 'rtl', root.dir);
    setLang('en');
    ok('and back to English a second time', root.dir === 'ltr', root.dir);

    // The observer is on `lang` alone, so nothing else has to remember `dir`.
    ok('watchLang subscribed rather than polling', observers.length === 1);

    stop();
    setLang('ar');
    ok('and it unsubscribes, so a stopped watch stops writing', root.dir === 'ltr', root.dir);

    // Startup with a hand-edited store: input, not memory.
    root.dir = '';
    ok('a stored language nobody ships is left to right',
       applyDir('zz') === 'ltr' && root.dir === 'ltr', root.dir);
  } finally {
    globalThis.document = realDoc;
    globalThis.MutationObserver = realMO;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
