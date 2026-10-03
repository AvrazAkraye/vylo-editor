// node all.mjs OUTDIR [kinds...] [--only id,id]
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
const ids = readFileSync(new URL('./ids.txt', import.meta.url), 'utf8').trim().split('\n');
const [out, ...rest] = process.argv.slice(2);
let only = null; const kinds = [];
for (let i = 0; i < rest.length; i++) { if (rest[i] === '--only') only = rest[++i].split(','); else kinds.push(rest[i]); }
const ks = kinds.length ? kinds : ['matrix', 'motion', 'stress'];
const q = [];
ids.forEach((id, i) => {
  if (only && !only.includes(id)) return;
  const n = String(i + 1).padStart(2, '0');
  for (const k of ks) q.push(`${n}-${id}-${k}|mode=${k}&recipe=${id}`);
});
const r = spawnSync('node', [new URL('./run.mjs', import.meta.url).pathname, '--jobs', '4', '--out', out, ...q], { encoding: 'utf8', maxBuffer: 1 << 26 });
console.log(r.stdout.split('\n').filter((l) => !l.startsWith('→')).join('\n'), r.stderr);
