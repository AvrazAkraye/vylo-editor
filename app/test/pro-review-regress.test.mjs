// Review R4 of the Pro pass (whole-app regression and performance): the cheap invariants behind
// docs/pro/review-regress.md, kept so a later change cannot quietly undo them. The measurements themselves
// (the app's own WebKit, the production bundle, export times) are in that document; this file holds what a
// test in Node can hold.
//
// What matters, in order:
//
//   1. Nothing of Motion loads when the app starts. `main.tsx` reaches no Motion, sound or audio module
//      through a static import: the studio is `lazy()` in App.tsx, and the Pro pass must not have changed that.
//   2. Inside Motion, what is heavy and rarely used stays out of the panel's static graph: the music
//      composer (videosynth.ts, and the Video module it brings) is an `import()` made only when music is
//      rendered, and the parts of the audio library the studio does not use (effects, automation, ducking)
//      are not reached at all.
//   3. The Pro pass touched no Video file (Video*.tsx, video*.ts): another session has uncommitted work in
//      them. Read from git: no commit of this pass (subject "pro…") names one.
//   4. Generous ceilings that would catch a runaway, not a tweak: the Motion chunk's own bytes, and
//      i18n.ts, which is in the startup chunk.
//   5. Fast where PRO.md says so, measured in Node with the recording canvas: the check under 25 ms for
//      30 layers; a frame painted without scenes as before (no offscreen canvas is ever made for it); a
//      graphic with scenes makes its two offscreen canvases once and reuses them over every frame; a
//      transition frame within bounds; and a film without sound never renders a sound bed.
//   6. The check and the sound are scheduled off the playhead: MotionChecks.tsx and the sound preview wait
//      for the graphic to settle (at least 200 ms) and the chip never subscribes to the clock.
import { readFileSync, existsSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { makeCanvas, offscreens } from './motioncanvas.mjs';
import { buildMotion } from '../.test-build/motiontemplates.js';
import { readMotion } from '../.test-build/motionread.js';
import { paint } from '../.test-build/motiondraw.js';
import { checkMotion } from '../.test-build/motioncheck.js';
import { addLayer } from '../.test-build/motionedit.js';
import { splitSceneAt, setTransition, sceneList } from '../.test-build/motionscene.js';
import { withSound } from '../.test-build/motionsound.js';
import { renderMp4 } from '../.test-build/motionexportops.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); }
}
const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');
const src = join(app, 'src');

// ── 1, 2: the static import graph ─────────────────────────────────────────

/** The files a file imports by value, relative ones only: `import type` and `import()` are not edges. */
function edges(file) {
  const text = readFileSync(file, 'utf8');
  const out = [];
  // An import or re-export clause has no semicolon in it, which keeps a match inside one statement.
  const re = /^[ \t]*(?:import|export)[ \t]+(?!type\b)([^;]*?)\bfrom[ \t]+['"](\.[^'"]+)['"]/gm;
  for (const m of text.matchAll(re)) out.push(m[2]);
  for (const m of text.matchAll(/^[ \t]*import[ \t]+['"](\.[^'"]+)['"]/gm)) out.push(m[1]);
  return out.map((p) => resolveFrom(dirname(file), p)).filter(Boolean);
}
function resolveFrom(dir, p) {
  for (const ext of ['', '.ts', '.tsx', '.js', '/index.ts', '/index.tsx']) {
    const f = join(dir, p + ext);
    if (existsSync(f) && statSync(f).isFile() && /\.(ts|tsx|js)$/.test(f)) return f;
  }
  return null;
}
function reach(entry) {
  const seen = new Set([entry]);
  const todo = [entry];
  while (todo.length) for (const f of edges(todo.pop())) if (!seen.has(f)) { seen.add(f); todo.push(f); }
  return seen;
}
const name = (f) => f.slice(src.length + 1);

console.log('startup: nothing of Motion');
const atStart = [...reach(join(src, 'main.tsx'))].map(name);
{
  ok(`main.tsx reaches the app's own modules statically (${atStart.length})`, atStart.includes('App.tsx') && atStart.length > 50, atStart.length);
  const motion = atStart.filter((f) => /^(motion|Motion|audio|loudness)/.test(f));
  ok('no Motion, sound or audio module is reached from main.tsx without an import()', motion.length === 0, motion);
  ok('nor the music composer', !atStart.includes('videosynth.ts'));
  const app = readFileSync(join(src, 'App.tsx'), 'utf8');
  ok('App.tsx opens Motion with lazy(() => import(\'./MotionPanel\'))', /lazy\(\(\) => import\('\.\/MotionPanel'\)/.test(app));
}

console.log('inside Motion: the heavy and the rare stay out of the panel\'s static graph');
const panel = [...reach(join(src, 'MotionPanel.tsx'))].map(name);
{
  ok(`the panel's static graph is found (${panel.length} files)`, panel.includes('motiondraw.ts') && panel.includes('MotionChecks.tsx'), panel.length);
  for (const f of ['videosynth.ts', 'video.ts', 'audiofx.ts', 'audioauto.ts', 'audioduck.ts']) ok(`${f} is not in it`, !panel.includes(f));
  const sound = readFileSync(join(src, 'motionsound.ts'), 'utf8');
  ok('motionsound.ts reaches the composer only by import(\'./videosynth\') (and its types)', /await import\('\.\/videosynth'\)/.test(sound) && !/^import(?! type)[^;]*from '\.\/videosynth'/m.test(sound));
}

// ── 3: Video untouched ────────────────────────────────────────────────────

console.log('Video untouched');
{
  let log = null;
  try {
    log = execFileSync('git', ['log', '--no-merges', '--format=@@%s', '--name-only', '8631266..HEAD', '--', 'src', 'src-tauri/src'],
      { cwd: app, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 << 20 });
  } catch { /* no git, or the base commit is not in this history */ }
  if (log === null) {
    ok('git history unavailable here: the Video check is skipped (the review ran it: docs/pro/review-regress.md)', true);
  } else {
    let subject = '';
    const touched = [];
    let commits = 0;
    for (const line of log.split('\n')) {
      if (line.startsWith('@@')) { subject = line.slice(2); if (/^pro[(:]/.test(subject)) commits++; continue; }
      if (!line || !/^pro[(:]/.test(subject)) continue;
      if (/(^|\/)(Video[^/]*\.tsx|video[^/]*\.ts)$/.test(line)) touched.push(`${subject.slice(0, 40)}: ${line}`);
    }
    ok(`no commit of the Pro pass (${commits}) touches a Video file`, touched.length === 0, touched);
  }
}

// ── 4: ceilings ───────────────────────────────────────────────────────────

console.log('ceilings');
{
  const i18n = statSync(join(src, 'i18n.ts')).size;
  ok(`i18n.ts, in the startup chunk, under 1,000,000 bytes (${i18n})`, i18n < 1_000_000, i18n);
  let bytes = null;
  try {
    const { build } = await import('esbuild');
    const r = await build({
      entryPoints: [join(src, 'MotionPanel.tsx')], bundle: true, minify: true, write: false, metafile: true, format: 'esm', jsx: 'automatic',
      absWorkingDir: app, outdir: join(app, '.test-build', 'r4-virtual'), logLevel: 'silent',
      loader: { '.woff2': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl' },
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', '@tauri-apps/*', '@codemirror/*'],
    });
    const out = Object.values(r.metafile.outputs).find((o) => o.entryPoint);
    const startup = new Set(atStart.map((f) => `src/${f}`));
    // The Motion chunk's own bytes: what the panel brings that the startup chunk does not already hold,
    // without the composer (its own chunk, loaded by import()).
    bytes = Object.entries(out.inputs).filter(([k]) => k.startsWith('src/') && !startup.has(k) && !/^src\/(videosynth|video)\.ts$/.test(k))
      .reduce((s, [, v]) => s + v.bytesInOutput, 0);
  } catch (e) {
    ok(`esbuild could not bundle the panel: ${String(e && e.message || e).slice(0, 200)}`, false);
  }
  if (bytes !== null) ok(`the Motion chunk's own code, minified, under 1,000,000 bytes (${bytes}; 0.132.0 was about 430,000)`, bytes > 300_000 && bytes < 1_000_000, bytes);
}

// ── 5: fast ───────────────────────────────────────────────────────────────

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const time = (f) => { const a = performance.now(); f(); return performance.now() - a; };
const graphic = (recipe, seconds = 10) => ({ ...buildMotion({ id: `r4-${recipe}`, recipe, lang: 'en', format: 'landscape', seconds, now: 1 }), fps: 30 });

console.log('the check');
{
  let d = graphic('big-title');
  for (let k = 0; d.layers.length < 30; k++) {
    const r = addLayer(d, k % 3 === 2 ? 'shape' : 'text', k % 3 === 2 ? { start: 0, end: 10 } : { text: `Line ${k} with a few words`, start: (k % 5) * 0.5, end: 10 }, 1);
    if (!r.id) break;
    d = r.motion;
  }
  const { ctx } = makeCanvas(8, 8);
  checkMotion(d, { ctx });
  const ms = median(Array.from({ length: 7 }, () => time(() => checkMotion(d, { ctx }))));
  ok(`30 layers checked in ${ms.toFixed(1)} ms (PRO.md: under 25)`, d.layers.length === 30 && ms < 25, { layers: d.layers.length, ms });
}

console.log('painting');
{
  const W = 1920, H = 1080;
  const frames = (doc, n = 300) => {
    const { ctx, calls } = makeCanvas(W, H);
    const ts = [];
    for (let i = 0; i < n; i++) {
      ts.push(time(() => paint(ctx, doc, (i % (doc.seconds * 30)) / 30, { width: W, height: H })));
      calls.length = 0;
      for (const c of offscreens) if (c.rec) c.rec.calls.length = 0;
    }
    return ts;
  };
  const plain = graphic('big-title');
  frames(plain, 30);
  // Its backdrop's dither tile (motionbackdrop.ts, since 0.132.0) is made once, in the first second: none after it.
  const before = offscreens.length;
  const tPlain = frames(plain);
  ok('a graphic without scenes makes no offscreen canvas frame after frame', offscreens.length === before, offscreens.length - before);
  ok(`and paints a 1080p frame in ${median(tPlain).toFixed(2)} ms median (bound 10)`, median(tPlain) < 10, median(tPlain));

  let cut = splitSceneAt(plain, 3.3, 1);
  cut = splitSceneAt(cut, 6.6, 1);
  sceneList(cut).forEach((s, i) => { if (i > 0) cut = setTransition(cut, s.id, i === 1 ? 'push' : 'glitch', 1); });
  const list = sceneList(cut);
  ok('the graphic with scenes has three, two with a transition', list.length === 3 && list.filter((s) => s.transition).length === 2, list.map((s) => s.transition?.kind ?? null));
  const made0 = offscreens.length;
  const tScenes = frames(cut, 600);
  ok(`600 frames with two transitions make two offscreen canvases, once (${offscreens.length - made0})`, offscreens.length - made0 <= 2, offscreens.length - made0);
  const inTr = (t) => list.some((s, i) => i > 0 && s.transition && t >= s.start && t < s.start + s.transition.d);
  const trFrames = tScenes.filter((_, i) => inTr((i % 300) / 30));
  ok(`a transition frame (two scenes painted and mixed) in ${median(trFrames).toFixed(2)} ms median (bound 30)`, trFrames.length > 10 && median(trFrames) < 30, { n: trFrames.length, ms: median(trFrames) });
  ok(`and a frame outside them no slower than three plain ones (${median(tScenes).toFixed(2)} vs ${median(tPlain).toFixed(2)} ms)`, median(tScenes) < 3 * median(tPlain) + 0.5, { scenes: median(tScenes), plain: median(tPlain) });

  const sounded = withSound(cut, { mode: 'both', level: 0.6 }, 1);
  const raw = JSON.parse(JSON.stringify(sounded));
  readMotion(raw, 1);
  const read = median(Array.from({ length: 21 }, () => time(() => readMotion(raw, 1))));
  ok(`a graphic with sound and scenes is read in ${read.toFixed(2)} ms (bound 5)`, read < 5, read);
}

console.log('a film without sound');
{
  let beds = 0;
  const doc = graphic('lower-third', 4);
  const out = await renderMp4(doc, { size: '720p', quality: 'high', blur: false }, {
    canvas: (w, h) => makeCanvas(w, h).canvas,
    preload: async () => undefined,
    soundBed: async () => { beds++; return null; },
    encodeMp4: async (o) => {
      let painted = 0;
      for (let i = 0; i < o.frames; i++) if (i === 0 || !o.unchanged?.(i)) { o.draw(i); painted++; }
      return Object.assign(new Uint8Array(8), { painted, audio: o.audio ? 'kept' : 'none' });
    },
  });
  ok('renders no sound bed', beds === 0, beds);
  ok('and is the film it was: no audio, every changing frame painted', out.audio === 'none' && out.painted > 0 && out.painted <= 120, { audio: out.audio, painted: out.painted });
}

// ── 6: off the playhead ───────────────────────────────────────────────────

console.log('scheduling');
{
  const checks = readFileSync(join(src, 'MotionChecks.tsx'), 'utf8');
  const settle = Number((checks.match(/const SETTLE = (\d+);/) ?? [])[1]);
  ok(`the check waits ${settle} ms after the last change (at least 200)`, settle >= 200, settle);
  ok('the chip never subscribes to the playhead', !/from '\.\/motionplay'/.test(checks) && !/usePlay\(/.test(checks));
  const sound = readFileSync(join(src, 'MotionSoundPanel.tsx'), 'utf8');
  const wait = Number((sound.match(/const SETTLE_MS = (\d+);/) ?? [])[1]);
  ok(`the sound preview renders ${wait} ms after the last change (at least 200)`, wait >= 200, wait);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
