// Turning a git remote into a link somebody can open.
//
// A wrong answer here is a link that opens somebody else's repository, so most
// of this file is about what the parser refuses. The scp-like form is the trap:
// `git@github.com:owner/repo.git` has a colon where a URL has a slash, so
// `new URL()` reads it as the `git` scheme and hands back nonsense rather than
// throwing.
import {
  blobUrl, commitUrl, compareUrl, isGitHubHost, isOpenable, parseRemote,
  pullsUrl, repoUrl,
} from '../.test-build/github.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const same = (r) => r && `${r.host}/${r.owner}/${r.repo}`;

// ── the five ways a remote gets written ───────────────────────────────────
for (const [url, want] of [
  ['git@github.com:AvrazAkraye/vylo-editor.git', 'github.com/AvrazAkraye/vylo-editor'],
  ['git@github.com:AvrazAkraye/vylo-editor', 'github.com/AvrazAkraye/vylo-editor'],
  ['https://github.com/AvrazAkraye/vylo-editor.git', 'github.com/AvrazAkraye/vylo-editor'],
  ['https://github.com/AvrazAkraye/vylo-editor', 'github.com/AvrazAkraye/vylo-editor'],
  ['https://github.com/AvrazAkraye/vylo-editor/', 'github.com/AvrazAkraye/vylo-editor'],
  ['ssh://git@github.com/AvrazAkraye/vylo-editor.git', 'github.com/AvrazAkraye/vylo-editor'],
  ['git://github.com/AvrazAkraye/vylo-editor.git', 'github.com/AvrazAkraye/vylo-editor'],
  ['https://token@github.com/AvrazAkraye/vylo-editor.git', 'github.com/AvrazAkraye/vylo-editor'],
  ['  git@github.com:a/b.git  ', 'github.com/a/b'],
]) {
  ok(`reads ${url.trim()}`, same(parseRemote(url)) === want, same(parseRemote(url)));
}
// A repository whose name genuinely ends in .git would be unreachable either
// way; git itself strips it, so this matches git.
ok('a trailing .git is stripped once, not repeatedly',
   parseRemote('git@github.com:a/b.git.git').repo === 'b.git');

// ── what it refuses ───────────────────────────────────────────────────────
// Being sure is the point: a guess here opens the wrong repository.
for (const bad of [
  '', '   ', 'not a remote', 'github.com', 'https://github.com',
  'https://github.com/onlyowner', 'https://github.com/a/b/c',
  'git@github.com:', 'git@github.com:a', '/local/path/repo.git', 'C:\\repo',
]) {
  ok(`refuses ${JSON.stringify(bad)}`, parseRemote(bad) === null, parseRemote(bad));
}
ok('a missing value does not throw',
   parseRemote(undefined) === null && parseRemote(null) === null);
// GitLab-style nesting is more than two segments, so it is refused rather than
// mangled into a GitHub-shaped guess.
ok('a nested group is refused rather than guessed',
   parseRemote('git@gitlab.com:group/sub/repo.git') === null);

// ── which hosts are GitHub ────────────────────────────────────────────────
ok('github.com is', isGitHubHost('github.com') === true);
ok('and its subdomains', isGitHubHost('www.github.com') === true);
ok('and an Enterprise install', isGitHubHost('github.acme.dev') === true);
ok('case does not matter', isGitHubHost('GitHub.com') === true);
// Both of these are how a link ends up somewhere else entirely.
ok('notgithub.com is not', isGitHubHost('notgithub.com') === false);
ok('and neither is github.evil.example', isGitHubHost('github-evil.example') === false);
ok('gitlab is not', isGitHubHost('gitlab.com') === false);
ok('a non-GitHub remote parses but is marked',
   parseRemote('git@gitlab.com:a/b.git').isGitHub === false);
ok('and a GitHub one is', parseRemote('git@github.com:a/b.git').isGitHub === true);

// ── the links ─────────────────────────────────────────────────────────────
{
  const r = parseRemote('git@github.com:AvrazAkraye/vylo-editor.git');
  ok('the repository', repoUrl(r) === 'https://github.com/AvrazAkraye/vylo-editor');
  // ssh in, https out: an ssh URL is not something a browser can open.
  ok('an ssh remote still gives an https link', repoUrl(r).startsWith('https://'));
  ok('a file on a branch',
     blobUrl(r, 'main', 'app/src/App.tsx') === 'https://github.com/AvrazAkraye/vylo-editor/blob/main/app/src/App.tsx');
  ok('with a line', blobUrl(r, 'main', 'a.ts', 12).endsWith('/blob/main/a.ts#L12'));
  ok('line zero is not a line', blobUrl(r, 'main', 'a.ts', 0).endsWith('a.ts'));
  ok('and neither is a negative one', blobUrl(r, 'main', 'a.ts', -3).endsWith('a.ts'));
  // Encoding the whole path would turn every slash into %2F and give one long
  // filename.
  ok('a path is encoded segment by segment',
     blobUrl(r, 'main', 'src/a b/c.ts').endsWith('/blob/main/src/a%20b/c.ts'),
     blobUrl(r, 'main', 'src/a b/c.ts'));
  ok('a branch with a slash is encoded',
     blobUrl(r, 'feat/x', 'a.ts').includes('/blob/feat%2Fx/'));
  ok('a commit', commitUrl(r, 'abc1234').endsWith('/commit/abc1234'));
  ok('the pull requests', pullsUrl(r).endsWith('/pulls'));
  // `expand=1` is the difference between opening the form and opening near it.
  ok('a comparison opens the pull request form',
     compareUrl(r, 'main', 'feat') === 'https://github.com/AvrazAkraye/vylo-editor/compare/main...feat?expand=1');
  ok('and encodes both branch names',
     compareUrl(r, 'main', 'feat/a b').includes('main...feat%2Fa%20b'));
}

// ── what may be handed to the operating system ────────────────────────────
// `file:` opens anything on the disk, `javascript:` is obvious, and on Windows
// the shell will act on schemes nobody here has heard of.
ok('https is openable', isOpenable('https://github.com/a/b') === true);
ok('http is not', isOpenable('http://github.com/a/b') === false);
ok('file is not', isOpenable('file:///etc/passwd') === false);
ok('javascript is not', isOpenable('javascript:alert(1)') === false);
ok('a bare path is not', isOpenable('/etc/passwd') === false);
ok('nonsense is not', isOpenable('not a url') === false && isOpenable('') === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
