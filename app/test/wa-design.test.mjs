// The WhatsApp panel's design pass (docs/wa/design.md), held to what it promised.
//
// Five promises, each a group below:
//
//   1. The block is where it says it is and is written the way this file is
//      written: logical properties only, no pinned `direction`, no hex colours,
//      no width that would not fit the 248px column outside the full window.
//   2. The classes agree: every `wa-*` class the panel writes has a rule, and
//      every `wa-*` rule in the WhatsApp section and the design block is
//      written by the panel. (`orphans.test.mjs` checks the second half for the
//      whole app; this says which file, which is what a reader needs.)
//   3. The colours it chose are readable: the text pairs the block introduced,
//      measured in both themes with the same arithmetic `pro-review-interface`
//      uses, `color-mix` evaluated the way the browser does it (sRGB).
//   4. Motion is subtle and can be turned off: every animation in the block
//      has a `prefers-reduced-motion` rule beside it, and the app's global rule
//      that stops transitions is still there.
//   5. No behaviour changed: the handlers the panel had are all still in it,
//      and the panel still renders (react-dom/server) in its two first states
//      with every class it draws defined.
import { readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
};

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const nl = (t) => t.replace(/\r\n?/g, '\n');
const css = nl(readFileSync(join(APP, 'src/styles.css'), 'utf8'));
const panel = nl(readFileSync(join(APP, 'src/WhatsAppPanel.tsx'), 'utf8'));
const i18n = nl(readFileSync(join(APP, 'src/i18n.ts'), 'utf8'));
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');

// ── 1. the block ───────────────────────────────────────────────────────────
console.log('The block');
const A = css.indexOf('/* wa:design start */');
const B = css.indexOf('/* wa:design end */');
ok('the design block is in styles.css, once', A > 0 && B > A && css.indexOf('/* wa:design start */', A + 1) === -1);
const mine = strip(css.slice(A, B));
ok('it has rules in it', (mine.match(/\{/g) || []).length > 100, String((mine.match(/\{/g) || []).length));
ok('no physical left or right in it',
  !/(^|[^-\w])(left|right)\s*:|margin-(left|right)|padding-(left|right)|border-(left|right)|text-align:\s*(left|right)|float:\s*(left|right)/.test(mine));
ok('no pinned direction (an address is isolated in the markup instead)', !/(^|[;{\s])direction\s*:/.test(mine));
ok('no hex colours: every colour is a token or mixed from one', !/#[0-9a-fA-F]{3,8}\b/.test(mine));

/** Rules as { sel, body }, at-rules flattened (their inner rules kept). */
function rules(text) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const sel = m[1].trim().replace(/\s+/g, ' ').replace(/^@media[^{]*$/, '');
    if (sel && !sel.startsWith('@')) out.push({ sel: sel.replace(/^.*\{\s*/, ''), body: m[2] });
  }
  return out;
}
const blockRules = rules(mine);
{
  const wide = [];
  for (const { sel, body } of blockRules) {
    for (const d of body.matchAll(/(?:^|;)\s*((?:min-|max-)?(?:inline-size|width))\s*:\s*(\d+)px/g)) {
      if (Number(d[2]) > 248 && !/wa-full/.test(sel)) wide.push(`${sel} ${d[1]}:${d[2]}px`);
    }
  }
  ok('no fixed width wider than the 248px column outside the full window', wide.length === 0, wide.join(' | '));
}
{
  // The language, defined once for light and written twice for dark, as every
  // dark token in this file is (see the top of styles.css).
  const light = /\.wa, \.wa-full\{([^}]*)\}/.exec(mine)?.[1] ?? '';
  const sys = /:root:not\(\[data-theme="light"\]\) \.wa, :root:not\(\[data-theme="light"\]\) \.wa-full\{([^}]*)\}/.exec(mine)?.[1] ?? '';
  const dark = /:root\[data-theme="dark"\] \.wa, :root\[data-theme="dark"\] \.wa-full\{([^}]*)\}/.exec(mine)?.[1] ?? '';
  const names = (t) => [...t.matchAll(/--(wa-[\w-]+)\s*:/g)].map((m) => m[1]).sort().join(',');
  ok('the --wa-* language is defined on the panel\'s two roots', names(light).split(',').length >= 12, names(light));
  ok('the two dark blocks define the same tokens', names(sys) !== '' && names(sys) === names(dark), `${names(sys)} / ${names(dark)}`);
  ok('and the same values', sys.replace(/\s+/g, '') === dark.replace(/\s+/g, ''));
  ok('every dark token is also defined in light', names(dark).split(',').every((n) => names(light).split(',').includes(n)));
}

// ── 2. the classes agree ───────────────────────────────────────────────────
console.log('Classes');
const S0 = css.indexOf('/* ── WhatsApp ──');
const S1 = css.indexOf('/* ── sessions as a strip');
ok('the WhatsApp section is found', S0 > 0 && S1 > S0);
const sectionCss = strip(css.slice(S0, S1)) + '\n' + mine;
const classesIn = (text) => {
  const found = new Set();
  let buf = '';
  for (const ch of text) {
    if (ch === '{') { for (const m of buf.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) found.add(m[1]); buf = ''; }
    else if (ch === '}') buf = '';
    else buf += ch;
  }
  return found;
};
const defined = classesIn(sectionCss);
const allDefined = classesIn(strip(css));
const written = new Set([...panel.matchAll(/(?<![\w-])(wa-[a-z0-9-]+)/g)].map((m) => m[1]));
// Not a class: the prefix a comment quotes when it explains why the six
// tints are written out as literals.
const NOT_CLASSES = new Set(['wa-t']);
const missing = [...written].filter((c) => !NOT_CLASSES.has(c) && !allDefined.has(c));
ok('every wa-* class the panel writes has a rule', missing.length === 0, missing.join(', '));
const unused = [...defined].filter((c) => c.startsWith('wa-') && !written.has(c));
ok('every wa-* rule in the section and the block is written by the panel', unused.length === 0, unused.join(', '));
for (const state of ['is-sticker', 'is-unread', 'is-sure', 'is-on', 'is-bad', 'is-off', 'is-busy']) {
  ok(`the state class ${state} is both drawn and written`, defined.has(state) && panel.includes(state));
}
ok('the six avatar tints are still six literals', ['wa-t0', 'wa-t1', 'wa-t2', 'wa-t3', 'wa-t4', 'wa-t5'].every((c) => panel.includes(`'${c}'`)));
ok('the group glyph is the new people icon, appended to Icon.tsx',
  /people: \[\{ d: '/.test(readFileSync(join(APP, 'src/Icon.tsx'), 'utf8')) && (panel.match(/name="people"/g) || []).length === 3);

// ── 3. readable ────────────────────────────────────────────────────────────
console.log('Contrast');
{
  const block = (open) => { const at = css.indexOf(open); return css.slice(at, css.indexOf('\n}', at)); };
  const hexes = (text) => Object.fromEntries([...text.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})\b/g)].map((m) => [m[1], m[2]]));
  const vars = (text) => Object.fromEntries([...text.matchAll(/--(wa-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const base = { light: hexes(block(':root{')), dark: hexes(block(':root[data-theme="dark"]{')) };
  const waLight = vars(/\.wa, \.wa-full\{([^}]*)\}/.exec(mine)[1]);
  const waDark = { ...waLight, ...vars(/:root\[data-theme="dark"\] \.wa, :root\[data-theme="dark"\] \.wa-full\{([^}]*)\}/.exec(mine)[1]) };
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  /** A token's colour as [r,g,b], following var() and colour-mix in sRGB. */
  function colour(expr, theme) {
    const e = expr.trim();
    const v = /^var\(--([\w-]+)\)$/.exec(e);
    if (v) {
      const n = v[1];
      if (n.startsWith('wa-')) return colour((theme === 'light' ? waLight : waDark)[n], theme);
      return rgb(base[theme][n]);
    }
    const mix = /^color-mix\(in srgb,\s*(var\(--[\w-]+\))\s+(\d+)%,\s*(var\(--[\w-]+\))\)$/.exec(e);
    if (mix) {
      const p = Number(mix[2]) / 100;
      const x = colour(mix[1], theme), y = colour(mix[3], theme);
      return x.map((c, i) => c * p + y[i] * (1 - p));
    }
    if (/^#/.test(e)) return rgb(e);
    throw new Error(`cannot read ${e}`);
  }
  const lum = (c) => {
    const l = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  };
  const ratio = (a, b) => { const [p, q] = [lum(a), lum(b)].sort((m, n) => n - m); return (p + 0.05) / (q + 0.05); };
  const PAIRS = [
    ['var(--ink)', 'var(--wa-mine)', 4.5, 'your words on your bubble'],
    ['var(--wa-mine-meta)', 'var(--wa-mine)', 4.5, 'the time and ticks on your bubble'],
    ['var(--brand)', 'var(--wa-mine)', 4.5, 'a quote\'s name and a read tick on your bubble'],
    ['var(--ink)', 'var(--wa-theirs)', 4.5, 'their words on their bubble'],
    ['var(--mute)', 'var(--wa-theirs)', 4.5, 'the time on their bubble, and a day'],
    ['var(--brand)', 'var(--wa-theirs)', 4.5, 'a group sender\'s name'],
    ['var(--mute)', 'var(--wa-canvas)', 4.5, 'a preview and a time in the list'],
    ['var(--brand)', 'var(--wa-canvas)', 4.5, 'an unread time in the list'],
    ['var(--brand)', 'var(--wa-sel)', 4.5, 'the open conversation\'s name in a window'],
    ['var(--ink-2)', 'var(--wa-card)', 4.5, 'a label in a card'],
    ['var(--mute)', 'var(--wa-card)', 4.5, 'help under a field'],
    ['var(--mute)', 'var(--wa-field)', 4.5, 'a placeholder-free field\'s hint'],
    ['var(--on-fill)', 'var(--fill)', 4.5, 'an unread count'],
    ['var(--brand)', 'var(--brand-wash)', 4.5, 'Broadcast, "New messages", the selected account'],
  ];
  for (const theme of ['light', 'dark']) {
    for (const [fg, bg, min, what] of PAIRS) {
      let r = 0;
      try { r = ratio(colour(fg, theme), colour(bg, theme)); } catch (e) { r = -1; }
      ok(`${theme}: ${what} ≥ ${min}:1`, r >= min, `${fg} on ${bg} = ${r.toFixed(2)}`);
    }
  }
}

// ── 4. motion ──────────────────────────────────────────────────────────────
console.log('Motion');
{
  const reduce = [...mine.matchAll(/@media \(prefers-reduced-motion: reduce\)\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
  const stopped = new Set(rules(reduce).filter((r) => /animation\s*:\s*none/.test(r.body)).flatMap((r) => r.sel.split(',').map((s) => s.trim())));
  const animated = blockRules.filter((r) => /(^|;)\s*animation\s*:\s*(?!none)/.test(r.body)).flatMap((r) => r.sel.split(',').map((s) => s.trim()));
  ok('the block animates something (the skeleton, the window)', animated.length > 0);
  const loose = animated.filter((s) => !stopped.has(s));
  ok('every animation in the block stops under prefers-reduced-motion', loose.length === 0, loose.join(' | '));
  const durations = [...mine.matchAll(/transition:[^;]*/g)].map((m) => m[0]);
  ok('transitions use the one short duration', durations.every((d) => d.includes('var(--wa-fast)')), durations.filter((d) => !d.includes('var(--wa-fast)')).join(' | '));
  ok('which is 150ms', /--wa-fast:\.15s;/.test(mine));
  ok('and the app still stops every transition when less motion is asked for', /prefers-reduced-motion: reduce\)\{\n[^@]*?\*\{ transition-duration:\.001ms !important; \}/.test(css));
}

// ── 5. behaviour ───────────────────────────────────────────────────────────
console.log('Behaviour');
{
  // Every way in and out of every feature, as the panel wrote it before this
  // pass. Each line is still in the file, character for character.
  const HANDLERS = [
    'onClick={() => setBulk(true)}',
    '<WhatsAppBroadcast t={t} lang={lang ?? \'en\'} account={current} full={full} gw={gw} efforts={efforts}',
    'onClick={() => setFull((v) => !v)}',
    "onKeyDown={(e) => { if (e.key === 'Escape') setFind(''); }}",
    "if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }",
    'onClick={() => setPicking(true)}',
    'onClick={() => { setPicking(false); setPicked(new Set()); }}',
    "role: 'checkbox' as const",
    "if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(r.msg.id); }",
    'ref={newMark}',
    '<div ref={foot} />',
    'setCount((n) => Math.min(n + PAGE, MAX_LOADED));',
    'onClick={() => void reloadNow()}',
    'onClick={() => void attach()}',
    'onClick={() => void sayIt()}',
    'onClick={() => void hand()}',
    'onClick={() => void transcribe(m)}',
    'onClick={() => void transcribe(m, code)}',
    'onClick={() => readOut(r.msg)}',
    "onClick={() => { setReplyTo(r.msg); setFind(''); }}",
    'onClick={() => setReplyTo(null)}',
    'onClick={() => setPreview({ url, name })}',
    'onClick={() => setPreview(null)}',
    'onClick={() => reload(m)}',
    'onClick={() => removeAccount(form.id)}',
    'onClick={() => setRemoving(true)}',
    'onClick={() => void check(form)}',
    'onClick={() => show(c.jid)}',
    'onClick={() => show(h.msg.jid)}',
    'onClick={() => onPick(a.id)}',
    'onClick={onAdd}',
    'onClick={leave}',
    'onClick={onProviders}',
    "onClick={() => setFind('')}",
    'onClick={() => setOutbox((p) => p.filter((_, n) => n !== i))}',
    '{open ? convoView() : listView()}',
    'rows={1}',
    "if (e.key === 'Escape') { e.preventDefault(); setFull(false); }",
    "if (e.key === 'Escape') { e.preventDefault(); setPreview(null); }",
  ];
  const lost = HANDLERS.filter((h) => !panel.includes(h));
  ok(`all ${HANDLERS.length} handlers the panel had are still in it`, lost.length === 0, lost.join(' | '));
  ok('Change the connection does what it did, from one place',
    panel.includes("const editConnection = () => { setState('setup'); setRemoving(false); setForm(current ?? blankAccount(accounts)); };")
    && (panel.match(/onClick=\{editConnection\}/g) || []).length === 2);
  ok('the bulk state and the Broadcast mount are still there', panel.includes('const [bulk, setBulk] = useState(false);') && panel.includes("<div className={full ? 'wa-full' : undefined}>"));
  ok('every message keeps dir="auto"', (panel.match(/dir="auto"/g) || []).length >= 12, String((panel.match(/dir="auto"/g) || []).length));
  ok('the one <audio> is the one that was there', (panel.match(/<audio className/g) || []).length === 1);
  ok('nothing is exported but the panel', [...panel.matchAll(/^export\s+(?:const|function|class|type|interface)\s+(\w+)/gm)].map((m) => m[1]).join(',') === 'WhatsAppPanel');
}

// The panel, rendered, in the two states it can be in before any effect runs:
// no account (the first-run form) and a set-up account (the list, waiting for
// the first answer). Bundled here with the native dialog and Tauri stubbed,
// because neither is reachable in Node and neither is called while rendering.
{
  const { build } = await import('esbuild');
  const out = join(APP, '.test-build', 'wa-design');
  mkdirSync(out, { recursive: true });
  await build({
    entryPoints: [join(APP, 'src/WhatsAppPanel.tsx')], bundle: true, format: 'esm', platform: 'node',
    outfile: join(out, 'panel.mjs'), jsx: 'automatic', logLevel: 'error',
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    plugins: [{
      name: 'tauri-stub',
      setup(b) {
        b.onResolve({ filter: /^@tauri-apps\// }, (a) => ({ path: a.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const open = async () => null; export const invoke = async () => null;', loader: 'js' }));
      },
    }],
  });
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k), clear: () => store.clear(),
  };
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { WhatsAppPanel } = await import(pathToFileURL(join(out, 'panel.mjs')).href);
  const t = (s) => s;
  const props = { t, lang: 'en', onProviders() {}, onSendToChat() {} };
  const drawnClasses = (html) => new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));
  const undefinedIn = (html) => [...drawnClasses(html)].filter((c) => !allDefined.has(c));

  const first = renderToStaticMarkup(createElement(WhatsAppPanel, props));
  ok('first run: the form renders', first.includes('class="wa wa-setup"'));
  ok('first run: a sentence says what the fields are for', first.includes('wa-intro') && first.includes('Link a number through your Evolution API server'));
  ok('first run: three cards, for three servers', (first.match(/class="wa-card"/g) || []).length === 3);
  ok('first run: the key note sits in the connection card, under the key',
    first.indexOf('The key is kept on this machine') > first.indexOf('API key') && first.indexOf('The key is kept on this machine') < first.indexOf('Check and save'));
  ok('first run: the voice help is a note, not an error', !/class="wa-why"[^>]*>[^<]*<svg[\s\S]{0,400}Made by whichever provider/.test(first) && first.includes('class="wa-help"'));
  ok('first run: every class it draws is defined', undefinedIn(first).length === 0, undefinedIn(first).join(', '));

  store.set('vylo.whatsapp.accounts.v1', JSON.stringify({
    list: [
      { id: 'main', name: 'Business', baseUrl: 'https://wa.example.test', instance: 'biz', key: 'k' },
      { id: 'p2', name: 'OTP line', baseUrl: 'https://wa.example.test', instance: 'otp', key: '' },
    ],
    active: 'main',
  }));
  const live = renderToStaticMarkup(createElement(WhatsAppPanel, props));
  ok('set up: the list renders, in the bounded view', live.includes('class="wa wa-view"') && live.includes('class="wa-scroll"'));
  ok('set up: rows in the shape of rows until the first answer', live.includes('class="wa-skel"') && (live.match(/wa-skel-row/g) || []).length === 6);
  ok('set up: not the sentence that says nothing has arrived', !live.includes('Nothing has arrived yet'));
  ok('set up: accounts as pills with initials and a set-up dot', /class="wa-mark wa-acct-mark wa-t\d"[^>]*>B<i>/.test(live) && live.includes('wa-acct  is-off'));
  ok('set up: Add says its name', /wa-acct-add[\s\S]*?<span>Add<\/span>/.test(live));
  ok('set up: Broadcast is the accented door, with its word for the window', live.includes('sb-act wa-cast') && live.includes('class="wa-cast-label">Broadcast<'));
  ok('set up: every class it draws is defined', undefinedIn(live).length === 0, undefinedIn(live).join(', '));
}

// ── the words ──────────────────────────────────────────────────────────────
console.log('Words');
{
  const KEY = 'Link a number through your Evolution API server: its address, the instance name and the API key.';
  for (const lang of ['ar', 'ckb', 'kmr']) {
    const from = i18n.indexOf(`const ${lang}: Dict = {`);
    const body = i18n.slice(from, i18n.indexOf('\n};', from));
    const at = body.indexOf('// wa design');
    ok(`${lang}: the design entries are under // wa design`, at > 0);
    const v = new RegExp(`'${KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':\\s*\\n?\\s*'([^']+)'`).exec(body.slice(at));
    ok(`${lang}: the first-run sentence is translated`, Boolean(v && v[1].trim() && v[1] !== KEY));
    ok(`${lang}: and keeps Evolution API and API as written`, Boolean(v && v[1].includes('Evolution API') && v[1].includes('API')));
  }
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
