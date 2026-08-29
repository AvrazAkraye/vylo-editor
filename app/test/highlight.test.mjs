// Syntax highlighting for code blocks in the transcript.
//
// The property that matters most is that highlighting is *lossless*: the spans
// must reassemble into exactly the code that went in. A highlighter that drops
// a character or repeats one has silently rewritten the model's code in the
// place a person reads it to decide whether to apply it.
import {
  kindOf, kindOfInfo, highlight, loadGrammars, grammarsReady,
} from '../.test-build/highlight.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const joined = (spans) => spans.map((s) => s.text).join('');
const classes = (spans) => [...new Set(spans.map((s) => s.cls).filter(Boolean))];

// ── before the grammars arrive ────────────────────────────────────────────
// This has to run first: the load is a one-way door for the process.
ok('nothing is highlighted before the grammars load', !grammarsReady());
{
  const spans = highlight('const x = 1;', 'ts');
  ok('and code still renders, in one plain span',
     spans.length === 1 && spans[0].cls === '' && spans[0].text === 'const x = 1;', spans);
}

// ── which language a fence names ──────────────────────────────────────────
ok('a bare extension', kindOfInfo('ts') === 'ts' && kindOfInfo('py') === 'py');
ok('a language name', kindOfInfo('python') === 'py' && kindOfInfo('javascript') === 'js');
ok('jsx and tsx keep their family', kindOfInfo('jsx') === 'js' && kindOfInfo('tsx') === 'ts');
ok('a filename, which is how a reply usually names the file',
   kindOfInfo('src/App.tsx') === 'ts', kindOfInfo('src/App.tsx'));
ok('a dotfile-looking fence', kindOfInfo('.ts') === 'ts');
ok('only the first word is read', kindOfInfo('js title="example"') === 'js');
ok('case does not matter', kindOfInfo('Python') === 'py');
ok('a language with no grammar falls through', kindOfInfo('bash') === null);
ok('an empty fence falls through', kindOfInfo('') === null);
ok('a fence naming a file with no extension falls through',
   kindOfInfo('Makefile') === null, kindOfInfo('Makefile'));
ok('extensions the editor also honours', kindOf('mts') === 'ts' && kindOf('scss') === 'css'
   && kindOf('mdx') === 'md' && kindOf('pyi') === 'py');
ok('an unknown extension is not guessed at', kindOf('zig') === null);

// ── with the grammars ─────────────────────────────────────────────────────
await loadGrammars();
ok('the grammars report themselves ready', grammarsReady());

{
  const code = 'const greeting = "hi"; // a note\nfunction add(a, b) { return a + b }';
  const spans = highlight(code, 'js');
  ok('javascript is coloured', classes(spans).length > 2, classes(spans));
  ok('keywords are keywords', spans.some((s) => s.text === 'const' && s.cls === 'syn-kw'));
  ok('strings are strings', spans.some((s) => s.text === '"hi"' && s.cls === 'syn-str'));
  ok('comments are comments', spans.some((s) => s.text === '// a note' && s.cls === 'syn-com'));
  ok('a function name is not just another variable',
     spans.some((s) => s.text === 'add' && s.cls === 'syn-fn'),
     spans.filter((s) => s.text === 'add'));
  ok('and the code comes back exactly as it went in', joined(spans) === code);
}

// ── lossless, which is the one that must never break ──────────────────────
{
  const samples = [
    ['ts', 'export interface A { b: string }\nconst f = <T,>(x: T) => x;'],
    ['tsx', 'const El = () => <div className="x">{"hi"}</div>;'],
    ['py', 'def f(a, b=2):\n    """doc"""\n    return a + b  # sum'],
    ['rs', 'fn main() {\n    let s = String::from("hi");\n    println!("{s}");\n}'],
    ['json', '{"a": [1, 2, null], "b": {"c": true}}'],
    ['css', '.a { color: #fff; /* x */ }\n@media (min-width: 10px) { .b { top: 0 } }'],
    ['html', '<!doctype html>\n<div id="a"><span>hi</span></div>'],
    ['md', '# Title\n\nSome *text* and `code`.\n\n- one\n- two'],
    // The awkward ones: not valid, not ASCII, not LF.
    ['ts', 'const broken = "unterminated\nlet x'],
    ['js', 'const s = "emoji 🙂 and ünïcode";'],
    ['js', 'const a = 1;\r\nconst b = 2;\r\n'],
    ['py', '\tif True:\n\t\tpass\n'],
    ['ts', ''],
    ['ts', '\n\n\n'],
    ['js', 'x'.repeat(5000)],
  ];
  let lossless = true;
  let ordered = true;
  for (const [lang, code] of samples) {
    const spans = highlight(code, lang);
    if (joined(spans) !== code) { lossless = false; console.log('    lost:', JSON.stringify(lang)); break; }
    if (spans.some((s) => s.text === '')) { ordered = false; break; }
  }
  ok('every sample reassembles into exactly the original code', lossless);
  ok('and no empty span is emitted', ordered);
}

// ── the languages each do something ───────────────────────────────────────
for (const [lang, code, want] of [
  ['py', 'def f():\n    return 1', 'syn-kw'],
  ['rs', 'fn main() { let x = 1; }', 'syn-kw'],
  ['json', '{"a": "b"}', 'syn-str'],
  ['css', 'a { color: red }', 'syn-var'],
  ['html', '<div>hi</div>', 'syn-type'],
]) {
  const cls = classes(highlight(code, lang));
  ok(`${lang} produces ${want}`, cls.includes(want), cls);
}

// A JSON key and a JSON string value are different things, and colouring them
// the same would lose the only structure a config file has.
{
  const spans = highlight('{"a": "b"}', 'json');
  ok('a json key and its value are told apart',
     spans.some((s) => s.text === '"a"' && s.cls === 'syn-var')
     && spans.some((s) => s.text === '"b"' && s.cls === 'syn-str'), spans);
}

// ── failure is plain, never wrong ─────────────────────────────────────────
ok('a language with no grammar is left alone', (() => {
  const spans = highlight('echo hi', 'bash');
  return spans.length === 1 && spans[0].cls === '';
})());
ok('an unfenced block is left alone', (() => {
  const spans = highlight('some prose', '');
  return spans.length === 1 && spans[0].cls === '';
})());
ok('empty code is nothing at all', highlight('', 'ts').length === 0);
ok('an enormous block is not parsed', (() => {
  const spans = highlight('const x = 1;\n'.repeat(20_000), 'ts');
  return spans.length === 1 && spans[0].cls === '';
})());

// ── the cache ─────────────────────────────────────────────────────────────
{
  const code = 'const cached = true;';
  const a = highlight(code, 'ts');
  const b = highlight(code, 'ts');
  ok('the same block is parsed once', a === b);
  const c = highlight(code, 'py');
  ok('but the language is part of the key', c !== a && joined(c) === code);
}
ok('the cache stays bounded and keeps working', (() => {
  for (let i = 0; i < 300; i++) highlight(`const v${i} = ${i};`, 'ts');
  const spans = highlight('const last = 1;', 'ts');
  return joined(spans) === 'const last = 1;' && classes(spans).includes('syn-kw');
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
