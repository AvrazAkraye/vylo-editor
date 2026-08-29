import { readFileSync, readdirSync } from 'node:fs';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';

const P = {
  js: javascript({ jsx: true }).language.parser,
  ts: javascript({ typescript: true, jsx: true }).language.parser,
  py: python().language.parser,
  rust: rust().language.parser,
  json: json().language.parser,
  html: html().language.parser,
  css: css().language.parser,
};
function errs(kind, code) {
  const tree = P[kind].parse(code);
  const out = [];
  const c = tree.cursor();
  do { if (c.type.isError) out.push(c.from); } while (c.next());
  return out;
}
const kindOf = (f) => f.endsWith('.tsx') || f.endsWith('.ts') ? 'ts'
  : f.endsWith('.css') ? 'css' : f.endsWith('.json') ? 'json'
  : f.endsWith('.html') ? 'html' : f.endsWith('.rs') ? 'rust' : null;

for (const dir of ['src', '.', 'src-tauri/src']) {
  let files = [];
  try { files = readdirSync(dir); } catch { continue; }
  for (const f of files) {
    const k = kindOf(f);
    if (!k) continue;
    const p = dir + '/' + f;
    let code; try { code = readFileSync(p, 'utf8'); } catch { continue; }
    const e = errs(k, code);
    const line = e.length ? code.slice(0, e[0]).split('\n').length : 0;
    console.log((e.length ? 'ERR ' : 'ok  '), p.padEnd(34), k.padEnd(5), e.length, e.length ? 'line ' + line : '');
  }
}
// html permissiveness
const htmlCases = ['<div><p>hi</div>', '<div>', '<<<>>>', '<div class=>', '</div>', '<script>function f({</script>'];
for (const c of htmlCases) console.log('html', JSON.stringify(c).padEnd(34), errs('html', c).length);
const cssCases = ['@media (min-width: 10px) { .a { color: red } }', '.a { color }', '.a {{ }', 'a b c'];
for (const c of cssCases) console.log('css ', JSON.stringify(c).padEnd(48), errs('css', c).length);
