import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
const P = { ts: javascript({ typescript: true, jsx: true }).language.parser,
            tsNoJsx: javascript({ typescript: true }).language.parser,
            py: python().language.parser, rust: rust().language.parser };
function e(kind, code) {
  const t = P[kind].parse(code); const c = t.cursor(); const out = [];
  do { if (c.type.isError) out.push([c.from, c.to, JSON.stringify(code.slice(c.from, c.to))]); } while (c.next());
  return out;
}
const cases = [
  ['ts', 'interface Version {\n  seq: number;\n}\n'],
  ['tsNoJsx', 'interface Version {\n  seq: number;\n}\n'],
  ['ts', 'function C() { return <div>{/* hi */}</div>; }\n'],
  ['ts', 'function C() { return <div>{x}</div>; }\n'],
  ['ts', 'type A = { a: number };\n'],
  ['ts', 'enum E { A, B }\n'],
  ['ts', 'const x = y satisfies Z;\n'],
  ['ts', 'abstract class A { abstract f(): void; }\n'],
  ['ts', 'const f = (b: X): b is Y => true;\n'],
  ['ts', 'const f = (b: X): boolean => true;\n'],
  ['ts', 'for await (const x of y) {}\n'],
  ['ts', 'const { a, ...rest } = o;\n'],
  ['ts', 'a?.b?.[c] ?? d;\n'],
  ['ts', 'export * as ns from "m";\n'],
  ['ts', 'class A { #p = 1; static { init(); } }\n'],
  ['ts', 'using x = get();\n'],
  ['py', 'match x:\n    case 1:\n        pass\n'],
  ['py', 'async def f():\n    async with a as b:\n        pass\n'],
  ['py', 'x: list[int] = []\n'],
  ['py', 'def f(a, /, b, *, c): pass\n'],
  ['py', 'f"{x!r:>{w}}"\n'],
  ['rust', 'use base64::Engine as _;\n'],
  ['rust', 'let Ok(x) = y else { return };\n'],
  ['rust', 'fn f<T: Into<String>>(t: T) -> Option<T> { Some(t) }\n'],
  ['rust', 'impl<\'a> Foo<\'a> { fn f(&self) {} }\n'],
  ['rust', 'async fn f() -> Result<(), E> { Ok(()) }\n'],
  ['rust', 'let x: Vec<_> = v.into_iter().collect();\n'],
  ['rust', 'macro_rules! m { () => {} }\n'],
];
for (const [k, c] of cases) console.log(k.padEnd(8), JSON.stringify(c).slice(0, 52).padEnd(54), e(k, c).length, JSON.stringify(e(k, c).slice(0, 2)));
