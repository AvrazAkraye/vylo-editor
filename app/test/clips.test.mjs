// Clipboard history.
//
// The whole point of this feature is what it refuses to keep, so most of what
// is asserted here is a *refusal*: a paste from a password field, a paste the
// source marked concealed, a paste shaped like a credential, and a store that
// forgets on its own. The convenience half — dedup, the cap, truncation — is
// tested too, but it is the cheaper half.
//
// Two tests deliberately assert that the secret heuristic *misses*. It is a
// courtesy and not a guarantee, and a test that pretended otherwise would be
// the beginning of someone relying on it.
import {
  MAX_CLIPS, MAX_TEXT, MAX_AGE_DAYS,
  clear, concealed, history, looksSecret, preview, privateField, prune, record,
  remember, shortened,
} from '../.test-build/clips.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const texts = (clips) => clips.map((c) => c.text);
const store = (init = []) => {
  let held = init;
  return { read: () => held, write: (c) => { held = c; }, peek: () => held };
};

// ── nothing worth keeping ─────────────────────────────────────────────────
{
  const one = record([], 'kept', { now: 1 });
  ok('an empty paste is not recorded', record(one, '', { now: 2 }) === one);
  ok('nor is a paste of only spaces', record(one, '     ', { now: 2 }) === one);
  ok('nor one of only newlines and tabs', record(one, '\n\n\t \r\n', { now: 2 }) === one);
  ok('and the list comes back by identity, so the caller can skip the write',
     record(one, '', { now: 2 }) === one);
  ok('but a paste that is only indentation around real text is kept',
     record(one, '    return x;\n', { now: 2 }).length === 2);
}

// ── the same thing pasted twice ───────────────────────────────────────────
{
  let clips = [];
  clips = record(clips, 'const a = 1;', { now: 10 });
  clips = record(clips, 'const b = 2;', { now: 20 });
  clips = record(clips, 'const c = 3;', { now: 30 });
  clips = record(clips, 'const a = 1;', { now: 40 });

  ok('a repeat does not appear twice', clips.length === 3, texts(clips));
  ok('it moves to the front instead', clips[0].text === 'const a = 1;', texts(clips));
  ok('and the rest keep their order', texts(clips).join('|') === 'const a = 1;|const c = 3;|const b = 2;',
     texts(clips));
  ok('the moved entry is dated when it was last pasted, not when it was first',
     clips[0].at === 40);
}

// ── the cap ───────────────────────────────────────────────────────────────
{
  let clips = [];
  for (let i = 0; i < MAX_CLIPS + 12; i++) clips = record(clips, `paste number ${i}`, { now: i });
  ok('the history is bounded', clips.length === MAX_CLIPS, clips.length);
  ok('the newest is at the front', clips[0].text === `paste number ${MAX_CLIPS + 11}`);
  ok('and it is the oldest that was dropped',
     clips[clips.length - 1].text === `paste number ${12}`, texts(clips).slice(-2));
  ok('nothing that was dropped is still reachable',
     !clips.some((c) => c.text === 'paste number 0'));
}

// ── a paste too big to keep whole ─────────────────────────────────────────
{
  const huge = 'the quick brown fox jumps over the lazy dog. '.repeat(400);
  const [clip] = record([], huge, { now: 1 });
  ok('a very large paste is cut down for storage', clip.text.length === MAX_TEXT, clip.text.length);
  ok('what is kept is the beginning of it', huge.startsWith(clip.text));
  ok('the original length is remembered, so the UI can say it is a fragment',
     clip.full === huge.length);
  ok('and shortened() says so', shortened(clip) === true);
  ok('a paste that fitted is not marked shortened', shortened(record([], 'short', { now: 1 })[0]) === false);

  // Comparing only the stored prefix would fold these into one entry and then
  // hand back whichever of the two it happened to keep.
  const other = `${huge}TAIL`;
  const both = record(record([], huge, { now: 1 }), other, { now: 2 });
  ok('two long pastes sharing their first 4096 characters are still two clips',
     both.length === 2, both.map((c) => c.full));
}

// ── what a secret looks like ──────────────────────────────────────────────
//
// The shapes below are assembled from fragments rather than written out.
// This repository is public, and GitHub and the vendors both scan public code
// for credential shapes — a convincing fake raises a real alert against a real
// account, and one of those vendors is the one this product runs on. Nothing
// here has to look convincing to do its job: `looksSecret` asks only for a
// known prefix and twenty characters, or a thirty-two character token that
// changes character class often. Every value below is deliberately outside
// each vendor's own pattern (wrong length, and dashes where they allow none),
// so a scanner reads them as the examples they are.
const FAKE = 'Ex-4mPl3-N0t-4-R34l-Cr3d3nt14l-Ex-4mPl3';
const pre = (...parts) => parts.join('');
const GH_TOKEN = pre('ghp', '_') + FAKE;
const pem = (kind) => `-----BEGIN ${kind} PRIVATE ` + `KEY-----\n${FAKE}\n-----END ${kind} PRIVATE ` + `KEY-----`;
const jwt = () => [pre('eyJ', 'hbGciOiJub25lIn0'), pre('eyJ', 'zdWIiOiJleGFtcGxlIn0'), 'n0t-a-s1gnatur3'].join('.');
{
  const secret = [
    ['an OpenAI-style key', pre('sk', '-ant-') + FAKE],
    ['a GitHub token', GH_TOKEN],
    ['an AWS access key id', pre('AKI', 'A') + 'EX4MPL3N0T4R34LK3Y'],
    ['an AWS secret in a shell export', 'export AWS_SECRET_ACCESS_KEY=' + FAKE],
    ['a Slack bot token', pre('xox', 'b-') + FAKE],
    ['an OpenSSH private key', pem('OPENSSH')],
    ['an RSA private key', pem('RSA')],
    ['a JWT', jwt()],
    ['a random-looking token inside JSON', '{ "token": "R8kPz2XvNq7mLw4TbY6HcJ3FdG5sA1eU" }'],
    ['a token on a line of its own in a config file', 'API_TOKEN = "Kp7mQz2XvNq9LwTbY6HcJ3FdG5sA1eU4"'],
  ];
  for (const [what, text] of secret) ok(`${what} is recognised`, looksSecret(text) === true);

  const ordinary = [
    ['a line of code', 'const clips = record(clips, text, { now });'],
    ['a branch name with a ticket number', 'feature/JIRA-1234-add-clipboard-history-picker'],
    ['a long camelCase identifier', 'handleClipboardHistoryPickerKeyDown2'],
    ['a git commit sha', '9f3b2c1d4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c'],
    ['an md5 digest', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a URL', 'https://github.com/anthropics/claude-code/blob/main/README.md#installation'],
    ['an absolute path', '/Volumes/ExtremeSSD/apps/vylo-editor/app/src-tauri/src/drafts.rs'],
    ['a shell command', 'npm run build && npx tauri build --target universal-apple-darwin'],
    ['a line of CSS', '.pal-row{ display:flex; align-items:baseline; gap:var(--sp-5); width:100%; }'],
    ['an SQL statement', 'SELECT id, name FROM users WHERE created_at > now() - interval 30 day;'],
    ['a sentence', 'The quick brown fox jumps over the lazy dog, twice, on 2026-08-29.'],
    ['an updater target string', 'com.vylotech.editor.updater.macos-aarch64-v0.21.0'],
  ];
  for (const [what, text] of ordinary) ok(`${what} is left alone`, looksSecret(text) === false);

  // The limits, asserted so that nobody mistakes the heuristic for a promise.
  ok('a short password is NOT recognised — the heuristic sees shapes, not secrets',
     looksSecret('hunter2!') === false);
  ok('nor is a database URL carrying credentials',
     looksSecret('postgres://admin:letmein@db.internal:5432/app') === false);

  const clips = record([], GH_TOKEN, { now: 1 });
  ok('and a secret-shaped paste is not recorded at all', clips.length === 0);
}

// ── secrets across the truncation boundary ────────────────────────────────
{
  const filler = 'lorem ipsum dolor sit amet '.repeat(300);
  const token = GH_TOKEN;

  // Half of an API key is still the half that would be written to disk, so a
  // token straddling the cut has to be judged whole.
  const straddling = `${filler.slice(0, MAX_TEXT - 11)} ${token}`;
  ok('a secret straddling the truncation point is still caught',
     record([], straddling, { now: 1 }).length === 0);

  // And the honest converse: only what is stored is examined.
  const beyond = `${filler.slice(0, MAX_TEXT + 600)} ${token}`;
  const kept = record([], beyond, { now: 1 });
  ok('a secret far past the end of what is stored does not block the paste', kept.length === 1);
  ok('and it is not in what was stored either', !kept[0].text.includes(pre('ghp', '_')));
}

// ── markers the source set ────────────────────────────────────────────────
{
  ok('a concealed pasteboard is recognised', concealed(['org.nspasteboard.ConcealedType']) === true);
  ok('so is a transient one', concealed(['public.utf8-plain-text', 'org.nspasteboard.TransientType']) === true);
  ok("so is Windows' exclude-from-history marker",
     concealed(['ExcludeClipboardContentFromMonitorProcessing']) === true);
  ok('an ordinary text paste is not concealed', concealed(['text/plain', 'text/html']) === false);
  ok('and no types at all is not concealed', concealed(undefined) === false && concealed([]) === false);

  const clips = record([], 'my banking password', { types: ['org.nspasteboard.ConcealedType'], now: 1 });
  ok('a concealed paste is not recorded', clips.length === 0);
}

// ── the fields a credential arrives in ────────────────────────────────────
{
  ok('a password input is a private field', privateField({ type: 'password' }) === true);
  ok('so is one that autocompletes a one-time code',
     privateField({ type: 'text', autocomplete: 'one-time-code' }) === true);
  ok('so is a new-password field', privateField({ type: 'text', autocomplete: 'new-password' }) === true);
  ok('the composer textarea is not', privateField({}) === false);
  ok('nor is an ordinary search box', privateField({ type: 'search' }) === false);
  ok('and nothing at all is not', privateField(null) === false && privateField(undefined) === false);
}

// ── forgetting on its own ─────────────────────────────────────────────────
{
  const day = 24 * 60 * 60 * 1000;
  const now = 1_000 * day;
  const clips = [
    { text: 'yesterday', full: 9, at: now - day },
    { text: 'last month', full: 10, at: now - 30 * day },
    { text: 'a moment ago', full: 12, at: now - 1000 },
  ];
  const live = prune(clips, now);
  ok(`clips older than ${MAX_AGE_DAYS} days are forgotten`, texts(live).join('|') === 'yesterday|a moment ago',
     texts(live));
  ok('a list with nothing to forget comes back by identity', prune(live, now) === live);

  // Expiry that only hides is not expiry: the text would still be on disk.
  const s = store(clips);
  const shown = history(s, now);
  ok('reading the history writes the expiry back to storage', s.peek().length === 2, s.peek().length);
  ok('and returns what it wrote', shown === s.peek());
}

// ── through a store ───────────────────────────────────────────────────────
{
  const s = store();
  remember(s, 'first', { now: 1 });
  remember(s, 'second', { now: 2 });
  ok('a remembered paste is persisted', texts(s.peek()).join('|') === 'second|first', texts(s.peek()));

  const before = s.peek();
  remember(s, '   ', { now: 3 });
  ok('a paste that was refused does not touch storage', s.peek() === before);

  remember(s, GH_TOKEN, { now: 4 });
  ok('nor does a secret-shaped one', s.peek() === before);

  remember(s, 'first', { now: 5 });
  ok('a repeat through the store moves to the front too',
     texts(s.peek()).join('|') === 'first|second', texts(s.peek()));

  clear(s);
  ok('clear empties it', s.peek().length === 0);
  ok('and reading after a clear is empty rather than broken', history(s, 6).length === 0);
}

// ── the one-line label ────────────────────────────────────────────────────
{
  ok('a preview is one line', preview('function f() {\n  return 1;\n}') === 'function f() { return 1; }');
  ok('leading indentation is dropped, so rows are not four spaces of nothing',
     preview('        const x = 1;') === 'const x = 1;');
  ok('a long preview is cut and marked', preview('x'.repeat(400)).length === 140
     && preview('x'.repeat(400)).endsWith('…'));
  ok('a short one is left exactly as it is', preview('hello') === 'hello');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
