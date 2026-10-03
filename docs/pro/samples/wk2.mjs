// R2 harness runner (scratch, git-ignored): bundles an entry, serves it on 127.0.0.1 (WebCodecs needs a
// secure context), accepts POST /save?f=<name> from the page (large files are written straight to disk
// instead of through the host's JSON), and runs the off-screen WKWebView host. Never the owner's app.
//
//   cd app && node .test-build/r2/wk2.mjs <entry.ts> '<expression>' <out.json> [--size WxH] [--timeout s] [--dir outdir]
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..', '..');
const args = process.argv.slice(2);
const [entry, expression, out] = args;
const rest = args.slice(3);
let dir = join(here, 'out');
const di = rest.indexOf('--dir');
if (di >= 0) { dir = resolve(rest[di + 1]); rest.splice(di, 2); }
mkdirSync(dir, { recursive: true });

const host = join(here, 'webkit-host');
if (!existsSync(host)) {
  const r = spawnSync('swiftc', ['-O', join(here, 'webkit-host.swift'), '-o', host], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(1);
}
const { build } = await import(pathToFileURL(join(app, 'node_modules', 'esbuild', 'lib', 'main.js')).href);
// ORIG=1: the encoder files as they were at the start of this review (git HEAD), for before/after numbers.
const origDir = join(here, 'orig');
const origPlugin = { name: 'orig', setup(b) {
  if (!process.env.ORIG) return;
  b.onResolve({ filter: /(^|\/)(motionencode|motionaudioenc)$/ }, (a) => ({ path: join(origDir, a.path.split('/').pop() + '.ts') }));
  b.onResolve({ filter: /^\.\// }, (a) => (a.importer.startsWith(origDir) ? { path: join(app, 'src', a.path.slice(2) + '.ts') } : undefined));
} };
const bundled = await build({
  plugins: [origPlugin],
  entryPoints: [resolve(entry)], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2021',
  logLevel: 'error', absWorkingDir: app, outdir: join(here, 'out-virtual'), jsx: 'automatic',
  loader: { '.woff2': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl', '.ttf': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
});
const code = bundled.outputFiles.filter((f) => f.path.endsWith('.js')).map((f) => f.text).join('\n');
const css = bundled.outputFiles.filter((f) => f.path.endsWith('.css')).map((f) => f.text).join('\n');
const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><body style="margin:0;background:#222"><div id="root"></div><script>${code.replace(/<\/script/gi, '<\\/script')}</script>`;

const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'POST' && u.pathname === '/save') {
    const name = normalize(u.searchParams.get('f') || 'x.bin').replace(/^(\.\.[/\\])+/, '');
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      const file = join(u.searchParams.get('scratch') ? join(here, 'out') : dir, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.concat(parts));
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/page.html`;
const child = spawn(host, [url, expression, out, ...rest], { stdio: 'inherit' });
child.on('exit', (code) => { server.close(); process.exit(code ?? 1); });
