import { readFileSync } from 'node:fs';
import { javascript } from '@codemirror/lang-javascript';
import { rust } from '@codemirror/lang-rust';
const P = { ts: javascript({ typescript: true, jsx: true }).language.parser, rust: rust().language.parser };
function show(p, kind) {
  const code = readFileSync(p, 'utf8');
  const tree = P[kind].parse(code);
  const c = tree.cursor();
  let n = 0;
  do {
    if (c.type.isError && n < 6) {
      n++;
      const line = code.slice(0, c.from).split('\n').length;
      const txt = code.split('\n')[line - 1];
      console.log(`${p}:${line}  [${c.from},${c.to}] ${JSON.stringify(code.slice(c.from, c.to)).slice(0,40)}  || ${JSON.stringify(txt).slice(0, 110)}`);
    }
  } while (c.next());
}
show('src/Editor.tsx', 'ts');
show('src/agent.ts', 'ts');
show('src/budget.ts', 'ts');
show('src/attachments.ts', 'ts');
show('src/Welcome.tsx', 'ts');
show('src/FileHistory.tsx', 'ts');
show('src-tauri/src/drafts.rs', 'rust');
show('src-tauri/src/lib.rs', 'rust');
