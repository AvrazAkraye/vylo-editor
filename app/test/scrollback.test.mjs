// Putting the terminals back the way you left them.
//
// The processes cannot come back — a shell is a child of this app. Everything
// else can, and the tests that matter are the ones about a record that has
// gone wrong, and about the trimming staying honest when it has to throw
// something away.
import {
  BANNER, KEY, MAX_CHARS, MAX_FOLDERS, MAX_LINES, MAX_SESSIONS, NOTHING,
  bytes, fit, read, tail, write,
} from '../.test-build/scrollback.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// ── the banner ────────────────────────────────────────────────────────────
// Without it somebody scrolls up, sees `npm run dev` compiling, and believes
// it is still running.
ok('the banner says the shell is new', /new shell/i.test(BANNER));
ok('and that nothing above it is running', /nothing above|not running|is running/i.test(BANNER));
ok('the store key is versioned', /\.v\d+$/.test(KEY));

// ── the tail of a buffer ──────────────────────────────────────────────────
ok('a short buffer is kept whole', tail(['a', 'b']) === 'a\nb');
// A terminal's buffer is padded to its height; keeping the padding would
// restore a screen of emptiness above the banner.
ok('trailing blank lines are dropped', tail(['a', 'b', '', '   ', '']) === 'a\nb');
ok('but blank lines in the middle are kept', tail(['a', '', 'b']) === 'a\n\nb');
ok('a long buffer keeps its end, not its start', (() => {
  const lines = Array.from({ length: MAX_LINES + 50 }, (_, i) => `line ${i}`);
  const out = tail(lines).split('\n');
  return out.length === MAX_LINES && out[out.length - 1] === `line ${MAX_LINES + 49}`;
})());
ok('an all-blank buffer is nothing', tail(['', '  ', '']) === '');
ok('an empty buffer is nothing', tail([]) === '');

// ── trimming to fit ───────────────────────────────────────────────────────
const S = (n, text) => ({ n, text });
{
  const many = Array.from({ length: MAX_SESSIONS + 4 }, (_, i) => S(i + 1, 'x'));
  const out = fit({ sessions: many, shown: [0], active: 0 });
  ok('too many sessions are capped', out.sessions.length === MAX_SESSIONS);
  // The first pane is the one somebody has been in all along.
  ok('and it is the newest that go', out.sessions[0].n === 1);
}
{
  // One long session must not cost every short one its history.
  const saved = {
    sessions: [S(1, 'a'.repeat(MAX_CHARS)), S(2, 'short')],
    shown: [0, 1], active: 0,
  };
  const out = fit(saved);
  ok('the record is brought under the ceiling',
     out.sessions.reduce((n, s) => n + s.text.length, 0) <= MAX_CHARS);
  ok('by trimming the biggest, not everything equally', out.sessions[1].text === 'short');
  ok('and the big one keeps its most recent end', out.sessions[0].text.length > 0);
}
{
  // A single enormous line has no boundary to trim at, and losing the whole
  // session to a preference about where text begins would be the wrong trade.
  const out = fit({ sessions: [S(1, 'a'.repeat(MAX_CHARS * 3))], shown: [0], active: 0 });
  ok('a session with no line breaks at all still keeps its tail',
     out.sessions[0].text.length > 0 && out.sessions[0].text.length <= MAX_CHARS,
     out.sessions[0].text.length);
}
ok('trimming starts at a line boundary, so a restore never opens mid-word', (() => {
  const text = Array.from({ length: 4000 }, (_, i) => `line ${i} ${'y'.repeat(40)}`).join('\n');
  const out = fit({ sessions: [S(1, text)], shown: [0], active: 0 });
  return out.sessions[0].text === '' || /^line \d+ /.test(out.sessions[0].text);
})(), fit({ sessions: [S(1, Array.from({ length: 4000 }, (_, i) => `line ${i} ${'y'.repeat(40)}`).join('\n'))], shown: [0], active: 0 }).sessions[0].text.slice(0, 40));
ok('trimming terminates even on pathological input', (() => {
  const out = fit({ sessions: [S(1, 'x'.repeat(MAX_CHARS * 4))], shown: [0], active: 0 });
  return Array.isArray(out.sessions);
})());
ok('indexes past the kept sessions are dropped', (() => {
  const out = fit({ sessions: [S(1, 'a')], shown: [0, 5, -1], active: 9 });
  return out.shown.join() === '0' && out.active === 0;
})());
ok('fitting does not mutate what it was given', (() => {
  const src = { sessions: [S(1, 'a'.repeat(MAX_CHARS + 10))], shown: [0], active: 0 };
  fit(src);
  return src.sessions[0].text.length === MAX_CHARS + 10;
})());

// ── reading a stored record ───────────────────────────────────────────────
const REAL = write(null, '/work', {
  sessions: [
    { n: 1, name: 'build', tag: 'red', cwd: '/work/app', text: 'npm test\nok' },
    { n: 2, cwd: '/work', text: 'ls' },
  ],
  shown: [0, 1], active: 1,
});
{
  const back = read(REAL, '/work');
  ok('a record round-trips', back.sessions.length === 2);
  ok('with its names and colours', back.sessions[0].name === 'build' && back.sessions[0].tag === 'red');
  ok('its directories', back.sessions[0].cwd === '/work/app');
  ok('its text', back.sessions[0].text === 'npm test\nok');
  ok('which were on screen', back.shown.join() === '0,1');
  ok('and which was focused', back.active === 1);
}
ok('another folder reads as nothing', read(REAL, '/elsewhere').sessions.length === 0);
ok('no folder at all reads as nothing', read(REAL, '').sessions.length === 0);
// A bad record must be a fresh terminal, never a panel that will not open.
for (const bad of [null, '', '{{{', '[]', '{"":1}', '{"/work":null}', '{"/work":{"sessions":"no"}}', '{"/work":{}}']) {
  ok(`a broken store reads as nothing: ${JSON.stringify(bad)}`, read(bad, '/work').sessions.length === 0);
}
ok('a session with junk fields is repaired, not dropped', (() => {
  const s = read('{"/work":{"sessions":[{"n":"x","name":3,"text":null}]}}', '/work');
  return s.sessions.length === 1 && s.sessions[0].n === 1 && s.sessions[0].name === undefined && s.sessions[0].text === '';
})());
// A record that remembers nothing on screen would restore panes and draw none.
ok('a record with nothing shown still draws the first',
   read('{"/work":{"sessions":[{"n":1,"text":"a"}],"shown":[]}}', '/work').shown.join() === '0');
ok('duplicate shown indexes collapse',
   read('{"/work":{"sessions":[{"n":1,"text":"a"}],"shown":[0,0]}}', '/work').shown.join() === '0');
ok('a blank name is no name', read('{"/work":{"sessions":[{"n":1,"name":"  ","text":"a"}]}}', '/work').sessions[0].name === undefined);

// ── writing ───────────────────────────────────────────────────────────────
ok('writing one folder leaves the others alone', (() => {
  const two = write(REAL, '/other', { sessions: [{ n: 1, text: 'x' }], shown: [0], active: 0 });
  return read(two, '/work').sessions.length === 2 && read(two, '/other').sessions.length === 1;
})());
// Closing every terminal should not leave a transcript behind.
ok('writing no sessions removes the folder', read(write(REAL, '/work', NOTHING), '/work').sessions.length === 0);
ok('an unreadable store is started again rather than losing the write',
   read(write('not json', '/work', { sessions: [{ n: 1, text: 'x' }], shown: [0], active: 0 }), '/work').sessions.length === 1);
// Twenty projects should not carry twenty transcripts for ever.
ok('folders are capped', (() => {
  let raw = null;
  for (let i = 0; i < MAX_FOLDERS + 5; i++) {
    raw = write(raw, `/f${i}`, { sessions: [{ n: 1, text: 'x' }], shown: [0], active: 0 });
  }
  return Object.keys(JSON.parse(raw)).length <= MAX_FOLDERS;
})());
ok('and the folder just written is never the one evicted', (() => {
  let raw = null;
  for (let i = 0; i < MAX_FOLDERS + 5; i++) {
    raw = write(raw, `/f${i}`, { sessions: [{ n: 1, text: 'x' }], shown: [0], active: 0 });
  }
  return read(raw, `/f${MAX_FOLDERS + 4}`).sessions.length === 1;
})());
ok('what is written is already trimmed to fit', (() => {
  const raw = write(null, '/w', { sessions: [{ n: 1, text: 'x'.repeat(MAX_CHARS * 2) }], shown: [0], active: 0 });
  return read(raw, '/w').sessions[0].text.length <= MAX_CHARS;
})());

// ── what it costs ─────────────────────────────────────────────────────────
ok('nothing stored costs nothing', bytes(null) === 0);
ok('a record costs about its length in UTF-16', bytes('abcd') === 8);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
