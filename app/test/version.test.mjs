// The version, in the seven places it is written down.
//
// This file exists because of a bug nobody could see from inside the code. The
// README's header said **0.59.0** for forty-two releases — through every one
// of 0.60 to 0.101 — because the release routine bumped `package.json`,
// `tauri.conf.json` and the four SAFETY files, and the README was not on that
// list. Every gate passed. The app was right, the updater was right, the
// releases were right, and the one page the public actually reads advertised a
// version from months earlier.
//
// A number repeated in seven files is a number that will disagree with itself.
// The only question is whether anything notices, and `npm test` is the gate
// that runs before every release, so it is the thing that can.
//
// The download links get their own group. They are the other half of the same
// promise: the header says which version this is, and the links are how
// somebody gets it. Both have to be true for the page to be worth anything.
import { readFileSync, existsSync } from 'fs';
import { join, resolve as resolvePath } from 'path';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const REPO = resolvePath('..');
const read = (f) => {
  const p = join(REPO, f);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};

// `package.json` is the source of truth, because it is the one the build reads.
const VERSION = JSON.parse(readFileSync(resolvePath('package.json'), 'utf8')).version;

ok('the version is a version', /^\d+\.\d+\.\d+$/.test(VERSION), VERSION);

// ── what ships ────────────────────────────────────────────────────────────
// The installer's version and the app's have to be the same number or the
// updater compares one against the other and draws its own conclusion.
{
  const conf = read('app/src-tauri/tauri.conf.json');
  ok('tauri.conf.json is present', conf !== null);
  const said = conf ? (JSON.parse(conf).version ?? '') : '';
  ok('and carries the same version as package.json', said === VERSION, { said, VERSION });
}

// ── what the page says ────────────────────────────────────────────────────
// The bug this file was written for. The header is the first thing on the
// repository page and the only place it states a version.
{
  const readme = read('README.md');
  ok('README.md is present', readme !== null);
  const head = readme ? /<strong>([^<]+)<\/strong>/.exec(readme) : null;
  ok('README.md states a version in its header', head !== null,
     readme ? readme.split('\n').slice(0, 16).join('\n') : '');
  ok('and it is this one', head?.[1] === VERSION, { says: head?.[1], VERSION });
}

// ── what the safety notes say ─────────────────────────────────────────────
// Each of them says which version it describes, when it was last checked
// against the code, and which version's binaries are unsigned. A note that
// names a version from three months ago is telling the reader it was not
// checked against what they are running — which, if true, is worse than the
// stale number.
//
// `includes` rather than a line match on purpose: these files also carry
// *historical* versions — "the token count has been in the status bar since
// 0.27.0" — which stay, and a rule that forbade them would be a rule people
// work around. The failure being caught is the current version appearing
// nowhere at all.
for (const f of ['SAFETY.md', 'SAFETY.ar.md', 'SAFETY.ckb.md', 'SAFETY.kmr.md', 'SECURITY.md']) {
  const text = read(f);
  ok(`${f} is present`, text !== null);
  ok(`${f} names the current version`, text !== null && text.includes(VERSION),
     text ? [...new Set([...text.matchAll(/\b\d+\.\d+\.\d+\b/g)].map((m) => m[0]))].join(' ') : '');
}

// ── how somebody gets it ──────────────────────────────────────────────────
{
  const readme = read('README.md') ?? '';
  const OWNER = 'AvrazAkraye/vylo-editor';
  // The publish scripts upload under exactly these names. A link is a promise
  // about a filename, and the two ends of it are in different files.
  const ASSETS = ['Vylo-Editor-macOS-AppleSilicon.dmg', 'Vylo-Editor-Windows-x64-setup.exe'];

  for (const asset of ASSETS) {
    // `/releases/latest/download/` and never `/releases/download/v1.2.3/`.
    // The first always resolves to the newest release; the second is correct
    // for exactly one release and wrong for every one after it, silently,
    // because a link to an old version still works.
    const link = `https://github.com/${OWNER}/releases/latest/download/${asset}`;
    ok(`README.md links to ${asset}`, readme.includes(link), link);
  }
  ok('and pins none of them to a tag',
     !/releases\/download\/v\d/.test(readme),
     (/releases\/download\/v[^)\s]*/.exec(readme) ?? [''])[0]);

  // The other end of the promise: the script that uploads them.
  const scripts = `${read('scripts/publish-macos.sh') ?? ''}\n${read('scripts/publish-windows.sh') ?? ''}`;
  for (const asset of ASSETS) {
    ok(`the publish scripts still upload ${asset}`, scripts.includes(asset), asset);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
