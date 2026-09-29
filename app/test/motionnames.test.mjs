// The names templates give their layers, shown in the interface's language.
//
// A template names its layers in English ("Accent bar", "Step 2 circle"), and
// the Layers list, the timeline and the notes under a chat answer show those
// names. The interface is Arabic, Sorani or Badini for many of the people who
// use it, so every name a template can give must be a catalogue key with all
// three translations — a numbered one as a pattern with `{n}` — and
// `shownName` puts the interface's words on it and the number back. A name a
// person typed, or one the catalogue does not know, is shown as written.
//
// Needs .test-build/{motionui,motiontemplates}.js.
import { readFileSync } from 'node:fs';
import { shownName } from '../.test-build/motionui.js';
import { buildMotion, RECIPES } from '../.test-build/motiontemplates.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// ── shownName ─────────────────────────────────────────────────────────────
{
  const dict = { 'Accent bar': 'شريط التمييز', 'Step {n} circle': 'دائرة الخطوة {n}', 'Flash': 'وميض', 'Flash {n}': 'وميض {n}' };
  const t = (s) => (Object.prototype.hasOwnProperty.call(dict, s) ? dict[s] : s);
  ok('a name the catalogue has is shown in its words', shownName('Accent bar', t) === 'شريط التمييز');
  ok('a numbered name is its pattern with the number put back', shownName('Step 2 circle', t) === 'دائرة الخطوة 2' && shownName('Step 12 circle', t) === 'دائرة الخطوة 12');
  ok('and a name that is also a word alone (Flash) is the word alone', shownName('Flash', t) === 'وميض' && shownName('Flash 3', t) === 'وميض 3');
  ok('a name the catalogue does not know is shown as written', shownName('My headline', t) === 'My headline' && shownName('Hello 5', t) === 'Hello 5');
  ok('a name with two numbers, or none, is left alone', shownName('Step 2 circle 3', t) === 'Step 2 circle 3' && shownName('', t) === '');
  ok('a name that is a property of every object is only a name', shownName('constructor', t) === 'constructor' && shownName('__proto__', t) === '__proto__' && shownName('toString {n}', t) === 'toString {n}');
  ok('in English every name is itself', ['Accent bar', 'Step 2 circle', 'Flash 3'].every((n) => shownName(n, (s) => s) === n));
}

// ── every name a template gives is in the catalogue ───────────────────────
{
  const src = readFileSync(new URL('../src/i18n.ts', import.meta.url), 'utf8');
  const ENTRY = /^ {2}'((?:[^'\\]|\\.)+)':[ \t]*\r?\n?[ \t]*'((?:[^'\\]|\\.)*)',[ \t]*\r?$/gm;
  const dictOf = (lang) => {
    const a = src.indexOf(`const ${lang}: Dict = {`);
    const b = src.indexOf('\n};', a);
    return new Map([...src.slice(a, b).matchAll(ENTRY)].map((m) => [m[1].replace(/\\'/g, "'"), m[2]]));
  };
  const dicts = { ar: dictOf('ar'), ckb: dictOf('ckb'), kmr: dictOf('kmr') };

  const names = new Set();
  for (const id of Object.keys(RECIPES)) {
    for (const lang of ['en', 'ar', 'ckb', 'kmr']) {
      for (const format of ['landscape', 'portrait', 'square', 'feed']) {
        for (const seconds of [undefined, 2, 30]) {
          for (const l of buildMotion({ id: 'x', recipe: id, lang, format, seconds, now: 0 }).layers) names.add(l.name.replace(/\d+/g, '{n}'));
        }
      }
    }
  }
  ok('the templates name their layers (a sanity check on the walk)', names.size > 60, names.size);
  for (const lang of ['ar', 'ckb', 'kmr']) {
    const missing = [...names].filter((n) => !dicts[lang].get(n));
    ok(`every layer name a template can give is translated into ${lang}`, missing.length === 0, missing);
  }
  const numbered = [...names].filter((n) => n.includes('{n}'));
  const off = numbered.filter((n) => ['ar', 'ckb', 'kmr'].some((lang) => !(dicts[lang].get(n) ?? '').includes('{n}')));
  ok('and a numbered name keeps its number in every translation', off.length === 0, off);
  // shownName must reach each numbered pattern: a name it cannot map back would fall through in English.
  const seen = new Map(Object.entries({ ar: 'ا', ckb: 'ک', kmr: 'ڤ' }));
  const lost = [];
  for (const [lang, mark] of seen) {
    const t = (s) => (dicts[lang].has(s) ? `${mark}|${s}` : s);
    for (const n of numbered) {
      const shown = shownName(n.replace('{n}', '7'), t);
      if (!shown.startsWith(`${mark}|`) || !shown.includes('7') || shown.includes('{n}')) lost.push(`${lang}: ${n} -> ${shown}`);
    }
  }
  ok('shownName reaches every numbered pattern the templates use', lost.length === 0, lost.slice(0, 5));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
