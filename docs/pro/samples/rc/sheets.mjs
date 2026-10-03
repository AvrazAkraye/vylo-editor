// S1: the contact sheets just drawn against R5's, by decoded pixels (not file bytes). Scratch.
//   cd app/.test-build/rc && node all.mjs ./now/ && node sheets.mjs [reference-dir] [dir]
import { readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { decode } from './pngdiff.mjs';
const A = (process.argv[2] || '/Volumes/ExtremeSSD/apps/vylo-pro-samples/templates/after').replace(/\/?$/, '/');
const B = (process.argv[3] || './now').replace(/\/?$/, '/');
const names = readdirSync(A).filter((n) => n.endsWith('.png')).sort();
let same = 0;
for (const n of names) {
  const a = decode(A + n), b = decode(B + n);
  const h = (x) => createHash('sha256').update(x.px).digest('hex');
  if (a.w === b.w && a.h === b.h && h(a) === h(b)) { same++; continue; }
  let any = 0, max = 0;
  if (a.w === b.w && a.h === b.h) for (let i = 0; i < a.w * a.h; i++) {
    let m = 0;
    for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(a.px[i * a.bpp + k] - b.px[i * b.bpp + k]));
    if (m) { any++; max = Math.max(max, m); }
  }
  console.log(`${n}: ${a.w}x${a.h} vs ${b.w}x${b.h}, ${any} pixels differ, by at most ${max} levels`);
}
console.log(`pixel-identical: ${same} of ${names.length}`);
