// R5 harness runner: node run.mjs [--out DIR] [--tag T] [--jobs N] "mode=matrix&recipe=x" ... Not committed.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
const run = promisify(execFile);
const here = new URL('.', import.meta.url).pathname;
const src = here + '../../src/';
const args = process.argv.slice(2);
let outDir = here + 'shots/';
let tag = '';
let jobs = 3;
const queries = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') outDir = args[++i].replace(/\/?$/, '/');
  else if (args[i] === '--tag') tag = '-' + args[++i];
  else if (args[i] === '--jobs') jobs = Number(args[++i]);
  else if (args[i] === '--names') { /* name=query pairs follow */ }
  else queries.push(args[i]);
}
const res = await build({ entryPoints: [here + 'entry-rc.tsx'], bundle: true, write: false, format: 'iife', jsx: 'automatic', outdir: here + 'out',
  external: ['@tauri-apps/api/core', '@codemirror/state'], logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' } });
mkdirSync(here + 'site/fonts', { recursive: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(here + 'site/rc.js', res.outputFiles[0].text);
copyFileSync(src + 'fonts/arabic.woff2', here + 'site/fonts/arabic.woff2');
const css = readFileSync(src + 'styles.css', 'utf8');
writeFileSync(here + 'site/rc.html', `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><script src="./rc.js"></script></body></html>`);

async function one(q) {
  // "name=foo|query" sets the file name.
  let name;
  if (q.includes('|')) { [name, q] = q.split('|'); } else name = q.replace(/[^a-z0-9.]+/gi, '-');
  name += tag;
  const out = `${outDir}${name}.txt`;
  try {
    await run(here + 'host', [`file://${here}site/rc.html?${q}`, out], { encoding: 'utf8', timeout: 280000, maxBuffer: 1 << 26 });
  } catch (e) { console.log('host failed', e.status, String(e.stdout).slice(0, 2000)); }
  const body = readFileSync(out, 'utf8');
  if (body.startsWith('data:image/png;base64,')) {
    writeFileSync(`${outDir}${name}.png`, Buffer.from(body.slice(22), 'base64'));
    (await import('fs')).unlinkSync(out);
    console.log('→', `${outDir}${name}.png`);
  } else console.log(q, '→', body.slice(0, 20000));
}
const queue = queries.slice();
await Promise.all(Array.from({ length: jobs }, async () => { while (queue.length) await one(queue.shift()); }));
