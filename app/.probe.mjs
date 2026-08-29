import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';

const P = {
  js: javascript({ jsx: true }).language.parser,
  ts: javascript({ typescript: true, jsx: true }).language.parser,
  py: python().language.parser,
  rust: rust().language.parser,
  json: json().language.parser,
  html: html().language.parser,
  css: css().language.parser,
  md: markdown().language.parser,
};

function errs(kind, code) {
  const tree = P[kind].parse(code);
  const out = [];
  const c = tree.cursor();
  do {
    if (c.type.isError) out.push({ name: c.type.name, from: c.from, to: c.to });
  } while (c.next());
  return out;
}

const cases = [
  ['ts', 'export function f() {\n  return 1;\n'],           // missing brace
  ['ts', 'export function f() {\n  return 1;\n}\n}\n'],     // extra brace
  ['ts', 'export function f(): number {\n  return 1;\n}\n'],// valid
  ['ts', ''],                                               // empty
  ['ts', '   \n\n'],                                        // whitespace only
  ['js', '[1, 2, ]'],
  ['json', '[1, 2, ]'],
  ['json', '{"a": 1}'],
  ['py', 'def f():\n    return 1\n'],
  ['py', 'def f(:\n    return 1\n'],
  ['py', 'fn main() {}\n'],
  ['rust', 'fn main() {}\n'],
  ['rust', 'fn main() {\n'],
  ['css', '.a { color: red; }\n'],
  ['css', '.a { color: red;\n'],
  ['css', '.a { color: red; } }\n'],
  ['html', '<div><p>hi</div>\n'],
  ['html', '<div></span>\n'],
  ['md', '# hi\n```\nunclosed\n'],
  ['md', '} } } not markdown {{{\n'],
  ['ts', 'class A { @dec x = 1; }\n'],
  ['ts', 'const x = 1;;;\n'],
  ['ts', 'const x: Foo<Bar> = new Foo();\n'],
  ['ts', 'if (a) {\n'],
  ['ts', 'const s = "unterminated\n'],
];
for (const [k, code] of cases) {
  const e = errs(k, code);
  console.log(k, JSON.stringify(code).slice(0, 46).padEnd(48), '->', e.length, JSON.stringify(e.slice(0, 3)));
}
