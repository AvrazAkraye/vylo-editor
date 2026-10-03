// Review R3 of the Pro pass: the interface against the simplicity contract,
// four languages, and the keyboard and screen-reader paths
// (docs/pro/review-interface.md). The pictures were looked at in an
// off-screen WKWebView; what can be held to in Node is held here.
//
//   - Every sentence the new parts hand to t() at run time — the check's tips
//     and their repairs, the sound's moods — is in all three dictionaries.
//     The catalogue test sees only literals written inside t(...); these are
//     written in a table elsewhere and translated where they are shown, so a
//     new tip without a translation would ship in English inside Arabic.
//   - The scene strip keeps its status and its "+ Scene" as the same first
//     two children whether it has one scene or several, so pressing "+ Scene"
//     keeps the focus on it and "Scenes: 2" is said by a region that was
//     already there; a transition's chip carries a mark for when its scene is
//     too short for the name; a scene chip's tooltip starts with its name.
//   - The sound's moods are the Design tab's chips, one pressed.
//   - The check's clean status can take the focus the last fix leaves; Fix
//     all sits in a foot that stays in sight.
//   - The brand kit says when it has been applied.
//   - The review's styles: logical properties only, and the text colours the
//     new parts use read at 4.5:1 or more in both themes.
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { buildMotion } from '../.test-build/motiontemplates.js';
import { addScene, sceneList, setTransition } from '../.test-build/motionscene.js';
import { withSound, SOUND_MOODS } from '../.test-build/motionsound.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const eq = (name, got, want) => ok(name, Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want), { got, want });
const nl = (s) => s.replace(/\r\n/g, '\n');
const NOW = 1_700_000_000_000;

// ── the dictionaries, read as the catalogue test reads them ───────────────
const i18n = nl(readFileSync('src/i18n.ts', 'utf8'));
const ENTRY = /^ {2}'((?:[^'\\]|\\.)+)':[ \t]*\r?\n?[ \t]*'((?:[^'\\]|\\.)*)',[ \t]*\r?$/gm;
const dict = {};
for (const lang of ['ar', 'ckb', 'kmr']) {
  const from = i18n.indexOf(`const ${lang}: Dict = {`);
  const to = i18n.indexOf('\n};', from);
  dict[lang] = new Set([...i18n.slice(from, to).matchAll(ENTRY)].map((m) => m[1]));
}

console.log('Sentences handed to t() at run time');
{
  const check = nl(readFileSync('src/motioncheck.ts', 'utf8'));
  const lit = (re) => [...check.matchAll(re)].map((m) => m[1]);
  const said = [
    ...lit(/\bmessage:\s*'((?:[^'\\]|\\.)+)'/g),
    ...lit(/\bmessage:\s*last \? '((?:[^'\\]|\\.)+)'/g),
    ...lit(/\bmessage:\s*last \? '(?:[^'\\]|\\.)+' : '((?:[^'\\]|\\.)+)'/g),
    ...lit(/\blabel:\s*'((?:[^'\\]|\\.)+)'/g),
    ...lit(/moveFix\(s, it, '((?:[^'\\]|\\.)+)'\)/g),
  ];
  ok('the check writes its tips and repairs as sentences (the scan found them)', said.length >= 18, said.length);
  for (const lang of ['ar', 'ckb', 'kmr']) {
    const gone = said.filter((k) => !dict[lang].has(k));
    eq(`every tip and repair of the check is in ${lang}`, gone, []);
    const moods = SOUND_MOODS.map((m) => m.label).filter((k) => !dict[lang].has(k));
    eq(`every mood the Sound row shows is in ${lang}`, moods, []);
  }
}

// ── the parts, drawn ──────────────────────────────────────────────────────
const require = createRequire(import.meta.url);
let esbuild = null;
try { esbuild = require('esbuild'); } catch { esbuild = null; }
if (!esbuild) ok('esbuild is there to build the parts', false);
else {
  esbuild.buildSync({
    entryPoints: ['src/MotionScenes.tsx', 'src/MotionSoundPanel.tsx', 'src/MotionChecks.tsx', 'src/MotionBrandKit.tsx'],
    bundle: true, format: 'esm', outdir: '.test-build/pro-review-interface', logLevel: 'error',
    external: ['react', 'react-dom', '@tauri-apps/api/core', '@tauri-apps/plugin-dialog', '@codemirror/state'],
  });
  const { createElement } = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { MotionScenes } = await import('../.test-build/pro-review-interface/MotionScenes.js');
  const { MotionSoundPanel } = await import('../.test-build/pro-review-interface/MotionSoundPanel.js');
  const { MotionChecks } = await import('../.test-build/pro-review-interface/MotionChecks.js');
  const { MotionBrandKit } = await import('../.test-build/pro-review-interface/MotionBrandKit.js');
  const t = (s) => s;
  const quiet = console.error;
  const render = (el) => {
    console.error = () => {};
    try { return renderToStaticMarkup(el); } finally { console.error = quiet; }
  };
  const tpl = () => buildMotion({ id: 'r3', recipe: 'big-title', lang: 'en', format: 'landscape', now: NOW });

  console.log('The scene strip');
  {
    const strip = (doc) => render(createElement(MotionScenes, { t, doc, onEdit: () => {}, onSeek: () => {} }));
    let three = addScene(addScene(tpl(), 1, NOW), 7, NOW);
    three = setTransition(three, sceneList(three)[1].id, 'push', NOW);
    const one = strip(tpl());
    const many = strip(three);
    // The root, then the status, then the end's box with "+ Scene" first in it: the same in both shapes.
    const head = /^<div class="ms[^"]*"><span class="vid-tl-sr" role="status">[^<]*<\/span><div class="ms-end"><button type="button" class="ghost ms-add[^"]*"/;
    ok('one scene: the status, then the end with "+ Scene" first', head.test(one), one.slice(0, 260));
    ok('three scenes: the same two first, so the button and the region are kept', head.test(many), many.slice(0, 260));
    ok('one scene still shows nothing but the quiet "+ Scene"', one.includes('ms-add ms-quiet') && !one.includes('ms-track') && !one.includes('ms-split'));
    const cuts = many.match(/<button[^>]*class="ms-cut( is-cut)?"[\s\S]*?<\/button>/g) ?? [];
    eq('two transition chips between three scenes', cuts.length, 2);
    ok('each with a mark a screen reader skips, and its name', cuts.every((c) => /<span class="ms-cut-glyph" aria-hidden="true">/.test(c) && /<span class="ms-cut-name">[^<]+<\/span>/.test(c)), cuts);
    ok('and named in full for a screen reader, mark or no mark', cuts.every((c) => /aria-label="How Scene \d arrives: [^"]+"/.test(c)));
    const titles = [...many.matchAll(/<button[^>]*class="ms-chip [^"]*"[^>]*title="([^"]*)"/g)].map((m) => m[1]);
    eq('three scene chips', titles.length, 3);
    ok('each chip\'s tooltip starts with its name, which a short chip cuts', titles.every((x, i) => x.startsWith(`Scene ${i + 1}\n`) && x.includes('From ')), titles);
  }

  console.log('The Sound row');
  {
    const doc = withSound(tpl(), { mode: 'music', level: 0.6 }, NOW);
    const html = render(createElement(MotionSoundPanel, { t, doc, onChange: () => {} }));
    const moods = html.match(/<div class="mo-de-chips mo-sound-moods" role="group" aria-label="Mood">[\s\S]*?<\/div>/)?.[0] ?? '';
    ok('the moods are a labelled group in the Design tab\'s chip row', moods !== '', html.slice(0, 300));
    eq('one chip per mood, the Design tab\'s own', (moods.match(/class="gal-chip( on)?"/g) ?? []).length, SOUND_MOODS.length);
    eq('exactly one of them pressed', (moods.match(/aria-pressed="true"/g) ?? []).length, 1);
    ok('none of Video\'s chips, which vanish on the sidebar\'s colour', !html.includes('vid-chip'));
  }

  console.log('The quality check');
  {
    const clean = render(createElement(MotionChecks, { t, doc: tpl(), onApply: () => {}, onSelect: () => {} }));
    ok('clean: a status that can take the focus the last fix leaves, from code only', /^<span class="mk-check" tabindex="-1">/.test(clean), clean);
    ok('its picture hidden from a screen reader, its words in a polite region', /class="mk-check-chip is-clean"[^>]*aria-hidden="true"/.test(clean) && /aria-live="polite">Looks good</.test(clean));
    const src = nl(readFileSync('src/MotionChecks.tsx', 'utf8'));
    ok('Fix all sits in the menu\'s foot, a part of no role', /<div className="mk-check-foot" role="none">\s*<button[^>]*className="ghost mk-check-all"/.test(src));
    ok('the last fix puts the focus on the status when it came from the menu or the chip', /toDone\.current = !!active && \(!!menu\.current\?\.contains\(active\) \|\| active === chip\.current\)/.test(src) && /done\.current\?\.focus\(\)/.test(src));
  }

  console.log('The brand kit');
  {
    const html = render(createElement(MotionBrandKit, { t }));
    ok('a status region beside the button, there before anything is said', /<\/button><span class="vid-tl-sr" role="status"><\/span>/.test(html), html);
    const src = nl(readFileSync('src/MotionBrandKit.tsx', 'utf8'));
    ok('Apply says what it did, in words the catalogue has', /setSaid\(next\.name \? fill\(t\('Applied the brand kit: \{name\}'\)/.test(src)
      && ['ar', 'ckb', 'kmr'].every((l) => dict[l].has('Applied the brand kit: {name}') && dict[l].has('Applied the brand kit')));
    ok('the handle and its @ run left to right in every language', /<span className="mb-at" dir="ltr">/.test(src));
  }
}

// ── the review's styles ──────────────────────────────────────────────────
console.log('Styles');
{
  const css = nl(readFileSync('src/styles.css', 'utf8'));
  const a = css.indexOf('/* pro:r3 start */'), b = css.indexOf('/* pro:r3 end */');
  const mine = css.slice(a, b).replace(/\/\*[\s\S]*?\*\//g, '');
  ok('the review\'s styles are in their own block', a > 0 && b > a);
  ok('with no physical left or right in them', !/(^|[^-])(left|right)\s*:|margin-(left|right)|padding-(left|right)|border-(left|right)|text-align:\s*(left|right)/.test(mine));
  ok('a transition\'s name gives way to its mark in a short scene', /\.ms-scene\{[^}]*container-type:inline-size/.test(mine) && /@container \(max-inline-size: \d+px\)\{[^@]*\.ms-cut-name\{ display:none; \}[^@]*\.ms-cut-glyph\{ display:inline-flex; \}/.test(mine));
  ok('the focused tip is ringed, not only tinted', /\.mk-check-tip:focus-visible\{ outline:2px solid var\(--brand\)/.test(mine));
  ok('no sentence of the new parts at 9px', ['.ms-cut{', '.mo-share-dest small, .mo-share-hint{'].every((sel) => new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^}]*font-size:var\\(--fs-2\\)`).test(mine)));

  // The tokens, light (the root) and dark (the explicit theme), and the pairs the new parts write text in.
  const block = (open) => {
    const at = css.indexOf(open);
    return css.slice(at, css.indexOf('\n}', at));
  };
  const tokens = (text) => Object.fromEntries([...text.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})\b/g)].map((m) => [m[1], m[2]]));
  const light = tokens(block(':root{'));
  const dark = tokens(block(':root[data-theme="dark"]{'));
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (x, y) => {
    const [p, q] = [lum(x), lum(y)].sort((m, n) => n - m);
    return (p + 0.05) / (q + 0.05);
  };
  const PAIRS = [
    ['mute', 'panel-2', 'the quiet "Looks good" and "+ Scene" on the sidebar'],
    ['mute', 'bg', 'the same on the full window'],
    ['mute', 'panel', 'a transition\'s name, a destination\'s line'],
    ['warn', 'warn-wash', 'the tips chip'],
    ['ink-2', 'brand-wash', 'the chosen destination\'s line'],
    ['ok', 'panel-2', 'the clean status\'s dot (a mark, 3:1 would do)'],
  ];
  for (const [theme, set] of [['light', light], ['dark', dark]]) {
    for (const [fg, bg, what] of PAIRS) {
      const r = set[fg] && set[bg] ? ratio(set[fg], set[bg]) : 0;
      ok(`${theme}: ${what} reads at 4.5:1 or more (${fg} on ${bg}: ${r.toFixed(2)})`, r >= 4.5, { fg: set[fg], bg: set[bg] });
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
