// "Run the app for me" (2026-10-04): the red `not valid UTF-8 (binary?)` line for a PDF tab, and a dev server the
// agent starts. The server is run in the terminal, the agent is told when its address appears, and the address is
// opened for the person. Pure parts are called; the rest (Editor, App, TerminalPanel, the Rust command) is held by
// reading the source, since the repo has no DOM runner, and the Rust half by `cargo test` (devenv.rs).
import { readFileSync } from 'fs';
import { isServerCommand, isUp, readOpenIn, OPEN_CHOICES, OPEN_KEY, SERVER_QUIET_MS, SERVER_SETTLE_MS } from '../.test-build/devserver.js';
import { binaryKind, KIND_LABEL, fullPath } from '../.test-build/filekind.js';
import { runAgent } from '../.test-build/agent.js';
import { detect } from '../.test-build/browser.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const rs = (f) => readFileSync(new URL(`../src-tauri/src/${f}`, import.meta.url), 'utf8');
const SLOW = Number(process.env.SLOW ?? 1) || 1;

console.log('which commands are servers');
{
  const yes = [
    'npm start', 'npm run dev', 'pnpm dev', 'yarn start', 'bun run dev', 'npx expo start --web', 'expo start', 'npx vite --host',
    'vite', 'next dev', 'python3 -m http.server 8000', 'flask run', 'cd app && npm run dev', 'PORT=3000 npm start',
    'export NODE_ENV=development && npm run dev', 'cd site; npm start', 'npm install && npm run dev', 'NPM RUN DEV',
    'php -S localhost:8000', 'ng serve', 'hugo server', 'rails s', 'uvicorn main:app --reload', 'npm run web',
  ];
  const no = [
    'npm test', 'npm run build', 'npm install', 'npm ci', 'git status', 'ls -la', 'cd app', 'echo npm start', 'cargo build', 'node script.js',
    '', '   ', 'vite build', 'npx vite build', 'next build', 'expo export', 'yarn add react', 'pnpm install', 'python3 script.py', 'cat package.json',
    'npm run lint', 'rm -rf node_modules && npm install', 'tsc --noEmit', 'bun test',
  ];
  for (const c of yes) ok(`server: ${c}`, isServerCommand(c) === true);
  for (const c of no) ok(`not a server: ${JSON.stringify(c)}`, isServerCommand(c) === false);
  ok('junk is never a server', [null, undefined, 7, {}, [], 'x'.repeat(5000), 'npm start'.repeat(1000)].every((x) => isServerCommand(x) === false));
  const t0 = Date.now();
  for (let i = 0; i < 300; i++) isServerCommand(`cd a && ${'export A=b && '.repeat(40)}npm run dev ${'x '.repeat(500)}`);
  ok('a long command is cheap to classify', Date.now() - t0 < 1500 * SLOW, Date.now() - t0);
}

console.log('what a server prints');
{
  const out = {
    vite: '\x1b[32m  VITE v5.0.0\x1b[39m  ready in 300 ms\n\n  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m\n  ➜  Network: http://192.168.1.4:5173/',
    cra: 'Compiled successfully!\n\n  Local:            http://localhost:3000\n  On Your Network:  http://192.168.1.4:3000',
    expoWeb: 'Starting Metro Bundler\nWeb is waiting on http://localhost:8081\n› Metro waiting on exp://192.168.1.5:8081',
    django: 'Starting development server at http://127.0.0.1:8000/',
  };
  ok('the address is the one on this machine, through the colour codes, never the network one', detect(out.vite)[0] === 'http://localhost:5173/' && detect(out.vite).length === 1);
  ok('Create React App, Expo web and Django give theirs', detect(out.cra)[0] === 'http://localhost:3000/' && detect(out.expoWeb)[0] === 'http://localhost:8081/' && detect(out.django)[0] === 'http://127.0.0.1:8000/');
  const expo = 'Starting Metro Bundler\n› Metro waiting on exp://192.168.1.5:8081\n› Scan the QR code above with Expo Go\n› Press w │ open web';
  ok('Expo without the web target prints nothing a browser can open', detect(expo).length === 0);
  ok('but it is known to be up, so the agent is not kept waiting', isUp(expo) && isUp('Metro waiting on exp://x') && isUp('› Press w │ open web'));
  ok('npm\'s notices are neither an address nor "up"', detect('npm notice Changelog: https://github.com/npm/cli/releases/tag/v11.0.0').length === 0 && !isUp('npm notice New major version') && !isUp(null) && !isUp(7));
}

console.log('where it opens');
{
  ok('Chrome is the default, because that is what was asked for', readOpenIn(null) === 'chrome' && readOpenIn(undefined) === 'chrome' && readOpenIn('') === 'chrome');
  ok('the three choices read back', OPEN_CHOICES.every((c) => readOpenIn(c) === c) && OPEN_CHOICES.length === 3);
  ok('junk reads as the default', [7, {}, [], '__proto__', 'Chrome', 'firefox', 'off '].every((x) => readOpenIn(x) === 'chrome'));
  ok('stored under its own key', OPEN_KEY === 'vylo.devopen.v1');
  ok('the waits are sane', SERVER_SETTLE_MS < SERVER_QUIET_MS && SERVER_SETTLE_MS >= 500 && SERVER_QUIET_MS <= 120_000);
}

console.log('which files the editor does not read');
{
  const kinds = {
    'a.pdf': 'pdf', 'dir/Report.PDF': 'pdf', 'x.png': 'image', 'x.JPG': 'image', 'a.mp3': 'audio', 'a.mp4': 'video', 'a.zip': 'archive',
    'a.docx': 'office', 'a.ttf': 'font', 'a.wasm': 'binary', 'C:\\x\\y\\a.pdf': 'pdf', 'a.tar.gz': 'archive',
  };
  for (const [p, k] of Object.entries(kinds)) ok(`${p} is ${k}`, binaryKind(p) === k);
  for (const p of ['a.ts', 'a.json', 'README.md', 'Makefile', '.gitignore', 'a.', '.pdf', 'dir.pdf/file', 'a.svg', '', 'pdf']) {
    ok(`${JSON.stringify(p)} may be text`, binaryKind(p) === null);
  }
  ok('junk is text', [null, undefined, 7, {}].every((x) => binaryKind(x) === null));
  ok('every kind has a label', Object.values(kinds).every((k) => typeof KIND_LABEL[k] === 'string') && Object.keys(KIND_LABEL).length === 8);
  ok('a folder file is joined with the folder\'s own separator', fullPath('/a/b/', 'c/d.pdf') === '/a/b/c/d.pdf' && fullPath('C:\\a\\b', 'c/d.pdf') === 'C:\\a\\b\\c\\d.pdf' && fullPath('/a', '/d.pdf') === '/a/d.pdf');
}

console.log('the agent and a server');
{
  const reply = (body) => ({
    ok: true, status: 200, headers: { get: (h) => (h === 'content-type' ? 'application/json' : null) },
    json: async () => body, text: async () => JSON.stringify(body),
  });
  const runs = (command) => reply({
    content: [{ type: 'tool_use', id: 'u1', name: 'run_command', input: { command, reason: 'start it' } }],
    stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 },
  });
  const done = reply({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
  const drive = async (command, choice, terminal) => {
    const queue = [runs(command), done];
    const sent = [];
    globalThis.fetch = async (_u, init) => { sent.push(JSON.parse(init.body)); return queue.shift(); };
    const asked = [], ran = [];
    await runAgent({
      baseUrl: 'http://gateway.test', apiKey: 'k', model: 'claude-opus-5', root: '/p',
      history: [{ role: 'user', content: 'run it' }],
      pending: { stageWrite: async () => ({ isNew: true }), stageEdit: async () => {}, currentContent: async () => '' },
      askToRun: async (req) => { asked.push(req.command); return choice; },
      runInTerminal: async (c) => { ran.push(c); return terminal; },
      onEvent: () => {}, onDelta: () => {},
    });
    const back = sent[1]?.messages?.at(-1)?.content?.[0]?.content;
    return { asked, ran, text: typeof back === 'string' ? back : JSON.stringify(back) };
  };

  const up = { code: null, output: 'Local: http://localhost:8081', truncated: false, running: true, url: 'http://localhost:8081', opened: 'chrome' };
  const a = await drive('npm start', 'pipe', up);
  ok('a server approved for a pipe runs in the terminal instead', a.ran.join() === 'npm start' && a.asked.length === 1, a);
  ok('the model is told it is still running, where, and that Chrome opened it', /still running/.test(a.text) && /http:\/\/localhost:8081/.test(a.text) && /Chrome/.test(a.text), a.text);
  ok('and told not to start it again or open a browser itself', /not start it again/.test(a.text) && /browser yourself/.test(a.text), a.text);
  ok('the output so far is included', /Local: http:\/\/localhost:8081/.test(a.text) && /output so far/.test(a.text));

  const b = await drive('npm run dev', 'terminal', { ...up, opened: 'default' });
  ok('a server approved for the terminal says the default browser', /your browser|user's browser/.test(b.text) && !/Chrome/.test(b.text), b.text);

  const c = await drive('npm run dev', 'pipe', { code: null, output: '', truncated: false, running: true });
  ok('a server that printed no address is still reported as running', /still running/.test(c.text) && /no output yet/.test(c.text) && !/serving at/.test(c.text), c.text);

  const d = await drive('npm run dev', 'pipe', { ...up, opened: undefined });
  ok('when nothing was opened the model is not told it was', /serving at/.test(d.text) && !/opened it/.test(d.text), d.text);

  const g = await drive('npm start', 'pipe', { code: null, output: 'Metro waiting on exp://192.168.1.5:8081', truncated: false, running: true });
  ok('a server with no address on this machine gets the web-target hint, and no second server', /expo start --web/.test(g.text) && /second server/.test(g.text) && /nothing was opened/.test(g.text), g.text);

  const e = await drive('npm run build', 'terminal', { code: 0, output: 'built', truncated: false });
  ok('a command that finishes is reported by its exit code, as before', /exit code: 0/.test(e.text) && !/still running/.test(e.text), e.text);

  const f = await drive('npm start', 'no', up);
  ok('a refusal still runs nothing', f.ran.length === 0 && !/still running/.test(f.text), f);
}

console.log('the pieces are wired');
{
  const ed = src('Editor.tsx'), app = src('App.tsx'), term = src('TerminalPanel.tsx'), lib = rs('lib.rs'), env = rs('devenv.rs');
  const sp = src('SettingsPanel.tsx');
  const safety = ['SAFETY.md', 'SAFETY.ar.md', 'SAFETY.ckb.md', 'SAFETY.kmr.md'].map((f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'));
  ok('the editor decides by name before it reads', /const bin = binaryKind\(path\)/.test(ed) && /bin/.test(ed.slice(ed.indexOf('read_for_editor') - 300, ed.indexOf('read_for_editor'))));
  ok('the card offers attach and show-in-folder', /className="ed-binary"/.test(ed) && /Attach to the chat/.test(ed) && /reveal_path/.test(ed));
  ok('attach goes to the chat through the same path as a dropped file', /onAttach=\{\(full\) => void attachAnyPath\(full\)/.test(app));
  ok('a server answers the agent early, once', /function settleEarly/.test(term) && /if \(!run \|\| run\.early\) return/.test(term) && /SERVER_QUIET_MS/.test(term) && /SERVER_SETTLE_MS/.test(term));
  ok('a pane that finishes or closes after the early answer settles nothing new', /run\.settle\(\{ code, output: text, truncated \}\)/.test(term));
  ok('every terminal run goes through runPane', (app.match(/termRun\.current\(/g) ?? []).length === 1 && (app.match(/runPane\(/g) ?? []).length >= 4);
  const pane = app.slice(app.indexOf('async function runPane'), app.indexOf('async function runStep'));
  ok('a chat that never opened the terminal gets it mounted, shown and waited for, not an error', /setTermMounted\(true\)/.test(pane) && /setShowTerm\(true\)/.test(pane) && /for \(let i = 0; i < 100 && !termRun\.current; i\+\+\)/.test(pane) && pane.indexOf('setTermMounted(true)') < pane.indexOf("throw new Error(t('Open the terminal first.'))"));
  ok('nobody checks for the pane before runPane does', !/if \(!termRun\.current\) return t\('Open the terminal first\.'\)/.test(app) && !/if \(!termRun\.current\) \{ setShowTerm/.test(app));
  ok('open_local runs off the main thread', /async fn open_local/.test(env) && /spawn_blocking/.test(env));
  ok('the lookup of the login PATH starts in the background at launch', /fn warm/.test(env) && /thread::spawn/.test(env));
  ok('only a server with an address is opened, and only through open_local', /if \(!result\.running \|\| !result\.url\) return result/.test(app) && /invoke<'chrome' \| 'default'>\('open_local'/.test(app));
  ok('"Do not open it" opens nothing, and the choice is read when the address appears', /choice === 'off'/.test(app) && /devOpenRef\.current/.test(app));
  ok('the setting is a control in Settings', /case 'devOpen'/.test(sp) && /OPEN_CHOICES|<option value="chrome">/.test(sp));
  ok('the command is registered', /devenv::open_local/.test(lib) && /generate_handler!/.test(lib) && /devenv::warm\(\)/.test(lib));
  ok('commands the agent runs see the login shell\'s PATH', /\.env\("PATH", devenv::command_path\(\)\)/.test(lib));
  ok('only this machine\'s addresses are ever opened', /fn local_target/.test(env) && /open_local/.test(env));
  ok('SAFETY says it, in all four languages', safety.every((f) => f.includes('`open_local`') && f.includes('app/src/devserver.ts') && f.includes('app/src-tauri/src/devenv.rs')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
