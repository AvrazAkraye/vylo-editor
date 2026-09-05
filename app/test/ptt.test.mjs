// Push-to-talk: hold a key and speak.
//
// Everything below is the reducer's table, and two properties carry it. The
// release decides whether a press was a hold or a tap, and a hold sends while
// a tap does not. Around that: the session starts on the way down, a chord is
// never a tap, blur cancels a hold and nothing else, and a setting that is off
// produces no action for any input.
//
// Nothing here can send or run anything: the reducer sees key codes and a
// clock, never a word of what was said. What is tested is that it says the
// right thing at the right moment and leaves its inputs alone.
import {
  CHOICES, DEFAULT, IDLE, KEY, TAP_MS,
  describe, equal, labelOf, phrase, printable, read, reduce, supports, write,
} from '../.test-build/ptt.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const ON = { enabled: true, code: 'AltRight' };
const OFF = { enabled: false, code: 'AltRight' };
const T0 = 1_000_000;

const down = (at, code = 'AltRight') => ({ type: 'down', code, at });
const up = (at, code = 'AltRight') => ({ type: 'up', code, at });
const blur = (at) => ({ type: 'blur', code: '', at });

/** Run a script of inputs from idle; the actions it produced, joined. */
function run(inputs, setting = ON, from = IDLE) {
  let state = from;
  const actions = [];
  for (const ev of inputs) {
    const step = reduce(state, ev, setting);
    state = step.state;
    if (step.action) actions.push(step.action);
  }
  return { state, actions: actions.join() };
}

// ── constants ─────────────────────────────────────────────────────────────
ok('the storage key is what the app expects', KEY === 'vylo.ptt.v1');
ok('a tap is anything under a quarter second', TAP_MS === 250);
ok('off by default, on the key most people mean', DEFAULT.enabled === false && DEFAULT.code === 'AltRight');
ok('the default key is the first choice', CHOICES[0].code === DEFAULT.code);
ok('four keys are offered, all right-hand modifiers or Fn',
   CHOICES.map((c) => c.code).join() === 'AltRight,ControlRight,MetaRight,Fn');
ok('every choice has an English label', CHOICES.every((c) => typeof c.label === 'string' && c.label.trim()));
ok('the labels are what the row will say', CHOICES.map((c) => c.label).join('|') === 'Right Option|Right Control|Right Command|Fn');
ok('idle is nothing held, nothing running', IDLE.held === false && IDLE.since === null && IDLE.listening === false);

// ── describing the setting ────────────────────────────────────────────────
// These are the i18n keys. They must not drift.
ok('the sentence for the default key', describe(ON) === 'Hold Right Option to dictate');
ok('for each of the others', ['ControlRight', 'MetaRight', 'Fn'].map((code) => describe({ enabled: true, code })).join('|')
   === 'Hold Right Control to dictate|Hold Right Command to dictate|Hold Fn to dictate');
ok('off is its own sentence, not an instruction that does nothing', describe(OFF) === 'Push-to-talk is off');
ok('the key carries a hole, and the label is separate for the translator', (() => {
  const p = phrase(ON);
  return p.key === 'Hold {key} to dictate' && p.vars.key === 'Right Option';
})());
ok('the off phrase has no hole', phrase(OFF).key === 'Push-to-talk is off' && Object.keys(phrase(OFF).vars).length === 0);
ok('a code that is not on offer is described by its code', describe({ enabled: true, code: 'KeyQ' }) === 'Hold KeyQ to dictate');
ok('labelOf answers for every choice', CHOICES.every((c) => labelOf(c.code) === c.label) && labelOf('Nope') === 'Nope');

// ── which keys may be shown ───────────────────────────────────────────────
// Fn is offered because people ask for it, and hidden because WKWebView never
// delivers it: shown only once a keydown with that code has actually arrived.
ok('the three modifiers are always shown', ['AltRight', 'ControlRight', 'MetaRight'].every((c) => supports(c, [])));
ok('Fn is hidden until it has been seen', supports('Fn', []) === false && supports('Fn', ['AltRight']) === false);
ok('and shown once it has', supports('Fn', ['Fn']) === true && supports('Fn', ['KeyA', 'Fn']) === true);
ok('a code that is not a choice is never shown', supports('KeyA', ['KeyA']) === false && supports('', []) === false);

// ── printable keys ────────────────────────────────────────────────────────
ok('letters, digits and punctuation type', ['KeyA', 'KeyZ', 'Digit0', 'Digit9', 'Space', 'Minus', 'Period', 'Slash', 'Backquote', 'BracketLeft', 'Numpad5', 'NumpadAdd', 'IntlBackslash'].every(printable));
ok('no offered key types', CHOICES.every((c) => !printable(c.code)));
ok('nor do the other non-character keys', ['Enter', 'Escape', 'ArrowLeft', 'ShiftLeft', 'CapsLock', 'F5', 'Tab', ''].every((c) => !printable(c)));

// ── reading the stored setting ────────────────────────────────────────────
ok('nothing stored is the default', equalSetting(read(null), DEFAULT) && equalSetting(read(''), DEFAULT));
ok('corrupt JSON is the default', equalSetting(read('{{{'), DEFAULT));
ok('a non-object is the default', equalSetting(read('"AltRight"'), DEFAULT) && equalSetting(read('[]'), DEFAULT) && equalSetting(read('null'), DEFAULT));
ok('read never hands out the default object itself', read(null) !== DEFAULT);
ok('enabled is on only if it is exactly true', (() => {
  const of = (enabled) => read(JSON.stringify({ enabled, code: 'AltRight' })).enabled;
  return of(true) === true && of('true') === false && of(1) === false && of(undefined) === false;
})());
ok('every offered code is kept', CHOICES.every((c) => read(JSON.stringify({ enabled: true, code: c.code })).code === c.code));
ok('a code that is not on offer becomes the default key', read(JSON.stringify({ enabled: true, code: 'KeyQ' })).code === 'AltRight'
   && read(JSON.stringify({ enabled: true, code: 7 })).code === 'AltRight'
   && read(JSON.stringify({ enabled: true })).code === 'AltRight');
ok('and the on/off survives that repair', read(JSON.stringify({ enabled: true, code: 'KeyQ' })).enabled === true);
ok('a good setting round-trips exactly', (() => {
  for (const s of [ON, OFF, { enabled: true, code: 'Fn' }]) if (JSON.stringify(read(write(s))) !== JSON.stringify(s)) return false;
  return true;
})());
ok('write keeps only the two fields', write({ enabled: true, code: 'MetaRight', extra: 1 }) === '{"enabled":true,"code":"MetaRight"}');

function equalSetting(a, b) { return a.enabled === b.enabled && a.code === b.code; }

// ── a hold ────────────────────────────────────────────────────────────────
// The handset gesture: down starts, up after a quarter second sends.
{
  const first = reduce(IDLE, down(T0), ON);
  ok('down starts, at once', first.action === 'start');
  ok('and records the press', first.state.held === true && first.state.since === T0 && first.state.listening === true);
  const release = reduce(first.state, up(T0 + 800), ON);
  ok('up after a hold stops and sends', release.action === 'stop');
  ok('and leaves nothing held or running', equal(release.state, IDLE));
  ok('a hold is a start and a stop, nothing else', run([down(T0), up(T0 + 800)]).actions === 'start,stop');
}
ok('the boundary is exactly TAP_MS: at it, a hold', reduce(reduce(IDLE, down(T0), ON).state, up(T0 + TAP_MS), ON).action === 'stop');
ok('one millisecond under, a tap', reduce(reduce(IDLE, down(T0), ON).state, up(T0 + TAP_MS - 1), ON).action === null);

// ── a tap, and a second tap ───────────────────────────────────────────────
// The hands-free gesture: the session started on the way down carries on,
// and the next tap ends it without sending.
{
  const tapped = run([down(T0), up(T0 + 100)]);
  ok('a tap starts and is the only action so far', tapped.actions === 'start');
  ok('the session carries on with the key up', tapped.state.listening === true && tapped.state.held === false);
  ok('and nothing is pending to send', tapped.state.since === null);
  const again = reduce(tapped.state, down(T0 + 5000), ON);
  ok('the second press starts nothing', again.action === null && again.state.held === true);
  ok('and records no moment to send from', again.state.since === null);
  const done = reduce(again.state, up(T0 + 5100), ON);
  ok('its release ends the session without sending', done.action === 'toggle' && equal(done.state, IDLE));
  ok('tap, tap is a start and a toggle', run([down(T0), up(T0 + 100), down(T0 + 5000), up(T0 + 5100)]).actions === 'start,toggle');
  // "Tap again to stop" is what the pill says the whole time, so a long second
  // press is still a stop: the release never sends what a tap began.
  ok('a long second press still does not send', run([down(T0), up(T0 + 100), down(T0 + 5000), up(T0 + 9000)]).actions === 'start,toggle');
  ok('after the second tap a third starts afresh', run([down(T0), up(T0 + 100), down(T0 + 5000), up(T0 + 5100), down(T0 + 8000)]).actions === 'start,toggle,start');
}

// ── a chord is not a tap ──────────────────────────────────────────────────
// Someone who picked Right Command still presses Cmd+S with it. The session
// starts on the way down as it must; another key during the press marks it,
// and the release ends without sending however long it lasted.
{
  const cmd = { enabled: true, code: 'MetaRight' };
  const slow = run([down(T0, 'MetaRight'), down(T0 + 50, 'KeyS'), up(T0 + 600, 'MetaRight')], cmd);
  ok('a slow Cmd+S does not send', slow.actions === 'start,toggle', slow.actions);
  ok('and ends the session', equal(slow.state, IDLE));
  ok('a quick Cmd+S does not leave the microphone open', (() => {
    const r = run([down(T0, 'MetaRight'), down(T0 + 30, 'KeyS'), up(T0 + 90, 'MetaRight')], cmd);
    return r.actions === 'start,toggle' && r.state.listening === false;
  })());
  const marked = reduce(reduce(IDLE, down(T0), ON).state, down(T0 + 50, 'KeyS'), ON);
  ok('the other key itself does nothing but mark the press', marked.action === null && marked.state.held === true && marked.state.since === null && marked.state.listening === true);
  ok('the other key coming up changes nothing', (() => {
    const after = reduce(marked.state, up(T0 + 80, 'KeyS'), ON);
    return after.action === null && equal(after.state, marked.state);
  })());
  ok('a chord during a hands-free press has nothing left to mark', (() => {
    const handsFree = run([down(T0), up(T0 + 100), down(T0 + 5000)]).state;
    const r = reduce(handsFree, down(T0 + 5050, 'KeyS'), ON);
    return r.action === null && equal(r.state, handsFree);
  })());
}

// ── other keys, when nothing is held ──────────────────────────────────────
ok('a down for a different key starts nothing', (() => {
  const r = reduce(IDLE, down(T0, 'ControlRight'), ON);
  return r.action === null && equal(r.state, IDLE);
})());
ok('an up for a different key while held changes nothing', (() => {
  const held = reduce(IDLE, down(T0), ON).state;
  const r = reduce(held, up(T0 + 500, 'KeyS'), ON);
  return r.action === null && equal(r.state, held);
})());
ok('the code is matched exactly', reduce(IDLE, down(T0, 'altright'), ON).action === null && reduce(IDLE, down(T0, 'AltLeft'), ON).action === null);
ok('each offered key works as the chosen one', CHOICES.every((c) => run([down(T0, c.code), up(T0 + 500, c.code)], { enabled: true, code: c.code }).actions === 'start,stop'));
ok('typing while hands-free does not end the session', (() => {
  const r = run([down(T0), up(T0 + 100), down(T0 + 1000, 'KeyH'), up(T0 + 1050, 'KeyH'), down(T0 + 1100, 'KeyI'), up(T0 + 1150, 'KeyI')]);
  return r.actions === 'start' && r.state.listening === true && r.state.held === false;
})());

// ── repeats and stray ups ─────────────────────────────────────────────────
ok('a held key repeats; only the first down counts', (() => {
  const r = run([down(T0), down(T0 + 30), down(T0 + 60), down(T0 + 90), up(T0 + 600)]);
  return r.actions === 'start,stop';
})());
ok('a repeat keeps the original press time', (() => {
  const s = run([down(T0), down(T0 + 200)]).state;
  return s.since === T0;
})());
// The fold above holds only while the reducer still believes the key is down,
// and the engine can take that belief away mid-hold: eight seconds of silence
// ends the session, the component resets the reducer to idle, and the next
// repeat of a key that is still physically held then reads as a fresh press —
// a second `start` nobody asked for. This is the hole, stated:
ok('a repeat that lands after the state was reset mid-hold would start a second session',
   reduce(IDLE, down(T0 + 120), ON).action === 'start');
// which is why `PushToTalk.tsx` drops `KeyboardEvent.repeat` before the reducer
// sees it. Only the DOM can still tell a repeat from a press once the reducer
// has forgotten the key was down.

ok('an up for a key never seen going down is ignored', (() => {
  const r = reduce(IDLE, up(T0), ON);
  return r.action === null && equal(r.state, IDLE);
})());
ok('and so is a second up after a release', run([down(T0), up(T0 + 600), up(T0 + 700)]).actions === 'start,stop');

// ── blur ──────────────────────────────────────────────────────────────────
// Cmd-Tab away with the key down and the release lands on another window.
{
  const held = reduce(IDLE, down(T0), ON).state;
  const gone = reduce(held, blur(T0 + 400), ON);
  ok('blur while held cancels', gone.action === 'cancel');
  ok('and forgets the press', equal(gone.state, IDLE));
  ok('the up that never comes is not missed: the next down starts again', reduce(gone.state, down(T0 + 3000), ON).action === 'start');
  ok('blur while idle does nothing', reduce(IDLE, blur(T0), ON).action === null && equal(reduce(IDLE, blur(T0), ON).state, IDLE));
  ok('blur leaves a hands-free session alone', (() => {
    const handsFree = run([down(T0), up(T0 + 100)]).state;
    const r = reduce(handsFree, blur(T0 + 2000), ON);
    return r.action === null && equal(r.state, handsFree);
  })());
  ok('but a blur during the second press of one cancels it', (() => {
    const pressing = run([down(T0), up(T0 + 100), down(T0 + 2000)]).state;
    const r = reduce(pressing, blur(T0 + 2050), ON);
    return r.action === 'cancel' && equal(r.state, IDLE);
  })());
  ok('a blur during a chorded press cancels too', run([down(T0), down(T0 + 50, 'KeyS'), blur(T0 + 100)]).actions === 'start,cancel');
}

// ── a setting that is off ─────────────────────────────────────────────────
ok('off, a down does nothing', reduce(IDLE, down(T0), OFF).action === null && equal(reduce(IDLE, down(T0), OFF).state, IDLE));
ok('off, a whole hold does nothing', run([down(T0), down(T0 + 30), up(T0 + 600)], OFF).actions === '');
ok('off, a blur does nothing', reduce(IDLE, blur(T0), OFF).action === null);
ok('off mid-hold, the release does nothing and the state is untouched', (() => {
  const held = reduce(IDLE, down(T0), ON).state;
  const r = reduce(held, up(T0 + 600), OFF);
  return r.action === null && equal(r.state, held);
})());
ok('the gate is the setting, not the key: a different chosen key ignores the old one', reduce(IDLE, down(T0, 'AltRight'), { enabled: true, code: 'ControlRight' }).action === null);

// ── the clock ─────────────────────────────────────────────────────────────
ok('only differences are taken: the same gestures at any epoch', run([down(0), up(600)]).actions === 'start,stop' && run([down(9e12), up(9e12 + 600)]).actions === 'start,stop');
ok('an up before its down reads as a tap, which sends nothing', run([down(T0), up(T0 - 10)]).actions === 'start');
ok('a clock that cannot be trusted reads as a tap too, and does not throw', (() => {
  const a = run([down(NaN), up(T0)]);
  const b = run([down(T0), up(NaN)]);
  return a.actions === 'start' && b.actions === 'start';
})());

// ── purity ────────────────────────────────────────────────────────────────
ok('the state that went in is as it was', (() => {
  const s = { held: false, since: null, listening: false };
  const copy = JSON.stringify(s);
  reduce(s, down(T0), ON);
  reduce(s, blur(T0), ON);
  reduce(s, up(T0), ON);
  return JSON.stringify(s) === copy;
})());
ok('the state that comes back is always a new object', (() => {
  const s = { ...IDLE };
  return reduce(s, down(T0, 'KeyS'), ON).state !== s && reduce(s, down(T0), OFF).state !== s && reduce(IDLE, blur(T0), ON).state !== IDLE;
})());
ok('the shared IDLE is never handed out or altered', (() => {
  const r = reduce(reduce(IDLE, down(T0), ON).state, up(T0 + 600), ON);
  r.state.held = true;
  return IDLE.held === false && r.state !== IDLE;
})());
ok('equal compares the three fields', equal(IDLE, { held: false, since: null, listening: false })
   && !equal(IDLE, { held: true, since: null, listening: false })
   && !equal(IDLE, { held: false, since: 0, listening: false })
   && !equal(IDLE, { held: false, since: null, listening: true }));
ok('the setting is never altered', (() => {
  const s = { enabled: true, code: 'AltRight' };
  run([down(T0), down(T0 + 20, 'KeyS'), up(T0 + 600), blur(T0 + 700)], s);
  return s.enabled === true && s.code === 'AltRight' && Object.keys(s).length === 2;
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
