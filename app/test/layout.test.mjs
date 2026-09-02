// A single-line input must not be stretched to fill a column.
//
// `.pal{ flex-direction: column }` with `.pal-in{ flex: 1 }` gave the command
// palette a search box 320 pixels tall with its placeholder floating in the
// middle. In a *row* that rule is right and necessary — the input takes the
// width the toggles leave. In a column, `flex: 1` grows the height instead, and
// three of the five palettes put the input straight into the column.
//
// The rule reads correctly either way, which is why looking at it did not find
// it, so this looks at the container instead. Every class the stylesheet
// declares as a flex row or a flex column is known statically, and every class
// used on an `<input>` is in the source — so "a control that grows, not scoped
// under a row" is something a test can ask.
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
};

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const css = readFileSync(join(SRC, 'styles.css'), 'utf8').replace(/\r\n?/g, '\n');

/** Comments blanked so a `flex: 1` written in prose is not a declaration. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** Every `selector { … }` block, flattened. Nested at-rules keep their block. */
function blocks(text) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    if (!selector || selector.startsWith('@')) continue;
    out.push({ selector, body: m[2], line: text.slice(0, m.index).split('\n').length });
  }
  return out;
}

const all = blocks(bare);
ok('the stylesheet parsed into a plausible number of rules', all.length > 400, String(all.length));

// ── which containers are rows and which are columns ───────────────────────
const rows = new Set();
const columns = new Set();
for (const { selector, body } of all) {
  if (!/display\s*:\s*(inline-)?flex/.test(body)) continue;
  const column = /flex-direction\s*:\s*column/.test(body);
  // The subject of the selector — the last simple part — is the container.
  for (const one of selector.split(',')) {
    const last = one.trim().split(/\s+|>/).filter(Boolean).pop() ?? '';
    for (const cls of last.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
      (column ? columns : rows).add(cls[1]);
    }
  }
}
ok('some containers are rows', rows.size > 10, String(rows.size));
ok('and some are columns', columns.size > 3, String(columns.size));
// `.pal` is the one this test was written for.
ok('.pal is known to be a column', columns.has('pal'));
ok('.pal-head is known to be a row', rows.has('pal-head'));

// ── which classes are worn by a single-line control ───────────────────────
const controls = new Set();
for (const file of readdirSync(SRC).filter((f) => f.endsWith('.tsx'))) {
  const src = readFileSync(join(SRC, file), 'utf8');
  // `<input className="a b"` and the same for select. A textarea is genuinely
  // multi-line and is left out on purpose.
  for (const m of src.matchAll(/<(input|select)\b[^>]*className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    for (const cls of (m[2] ?? m[3] ?? '').split(/[\s${}?:'"]+/)) {
      if (/^[a-zA-Z][\w-]*$/.test(cls)) controls.add(cls);
    }
  }
}
ok('input classes were found in the source', controls.size > 5, String(controls.size));
ok('.pal-in is known to be an input', controls.has('pal-in'));

// ── the check ─────────────────────────────────────────────────────────────
/** A positive flex-grow, from either the shorthand or the longhand. */
function grows(body) {
  const long = /flex-grow\s*:\s*([\d.]+)/.exec(body);
  if (long) return Number(long[1]) > 0;
  const short = /(?:^|;)\s*flex\s*:\s*([^;]+)/.exec(body);
  if (!short) return false;
  const first = short[1].trim().split(/\s+/)[0];
  if (first === 'none' || first === 'auto' || first === 'initial') return false;
  return Number(first) > 0;
}

const bad = [];
for (const { selector, body, line } of all) {
  if (!grows(body)) continue;
  for (const one of selector.split(',')) {
    const parts = one.trim().split(/\s+|>/).filter(Boolean);
    const subject = parts[parts.length - 1] ?? '';
    // Is the thing being grown a single-line control?
    const isControl = /(^|\.)(input|select)$/.test(subject)
      || [...subject.matchAll(/\.([a-zA-Z][\w-]*)/g)].some((m) => controls.has(m[1]));
    if (!isControl) continue;
    // Scoped under something the stylesheet declares as a row? Then growing is
    // along the width, which is what these rules are for.
    const underRow = parts.slice(0, -1).some((p) =>
      [...p.matchAll(/\.([a-zA-Z][\w-]*)/g)].some((m) => rows.has(m[1])));
    if (!underRow) bad.push(`${one.trim()} (line ${line})`);
  }
}

// A control that grows with nothing saying it is in a row is a control that
// will be 320 pixels tall the first time somebody puts it in a column.
ok('no single-line control grows without a row to grow along',
   bad.length === 0, bad.join(' | '));

// ── and the check itself works ────────────────────────────────────────────
// Without this, a regex that matches nothing passes for ever.
{
  const probe = blocks('.pal{ display:flex; flex-direction:column; } .pal-in{ flex:1; }');
  ok('the parser finds both rules in a probe', probe.length === 2);
  ok('and grows() reads the shorthand', grows('flex:1;') === true);
  ok('the longhand', grows('flex-grow: 2;') === true);
  ok('a zero is not growth', grows('flex:0 1 auto;') === false);
  ok('`none` is not growth', grows('flex:none;') === false);
  ok('and a rule with no flex at all is not', grows('color:red;') === false);
  // `flex-basis: 1px` is not a grow, and neither is `flex-shrink: 1`.
  ok('flex-shrink alone is not growth', grows('flex-shrink:1;') === false);
  ok('flex-basis alone is not growth', grows('flex-basis:1px;') === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
