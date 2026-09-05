// Push-to-talk: hold a key and speak.
//
// Everything below is the reducer's table, and two properties carry it. The
// release decides whether a press was a hold or a tap, and a hold sends while
// a tap does not. Around that: the session starts on the way down, a chord is
// never a tap, blur cancels a hold and nothing else, and a setting that is off
// produces no action for any input.
//
// `accept` is tested here for the same reason it exists. It is the component's
// entire policy about which key events reach the reducer, and it lives in the
// module so that the policy has a test to answer to: the reducer is identical
// whether or not a listener filters in front of it, so a filter written in
// `PushToTalk.tsx` would be a rule with nothing to check it. The rule that
// matters most is a yes — a printable key landing in a field somebody is typing
// into is handed over, because that is the event a chord is made of.
//
// Nothing here can send or run anything: the reducer sees key codes and a
// clock, never a word of what was said. What is tested is that it says the
// right thing at the right moment and leaves its inputs alone.
import {
  CHOICES, DEFAULT, IDLE, KEY, TAP_MS,
  accept, describe, equal, labelOf, offered, phrase, read, reduce, supports, write,
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
ok('idle is nothing held, nothing running, no other key down',
   IDLE.held === false && IDLE.since === null && IDLE.listening === false && IDLE.others.length === 0);

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
ok('offered is the membership test, and the component uses this one',
   CHOICES.every((c) => offered(c.code)) && !offered('KeyA') && !offered('altright') && !offered(''));

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
  // A letter is a key like any other. `PushToTalk.tsx` used to drop a keydown
  // that types a character when it landed in a field somebody was typing into,
  // and the reducer, never told, read Right Option + O in the composer as a
  // 600 ms hold and sent the half-written draft on the release. Nothing about
  // the code below changes for a letter, which is the point: the fix is that
  // the component stops filtering, and this is the rule it has to obey.
  ok('Option+O in a field is a chord, not a hold', (() => {
    const r = run([down(T0), down(T0 + 200, 'KeyO'), up(T0 + 600)]);
    return r.actions === 'start,toggle' && equal(r.state, IDLE);
  })());
  ok('the letter may be any character key', ['KeyA', 'Digit4', 'Space', 'Period', 'Numpad5', 'IntlBackslash'].every((code) =>
    run([down(T0), down(T0 + 200, code), up(T0 + 600)]).actions === 'start,toggle'));
  // A press that is chorded on the way down ends without sending, and the key
  // that chorded it is still down afterwards — so the *next* press of the
  // chosen key is the other shape, below, and must not start anything either.
  ok('and the key that chorded it is still down for the next press', (() => {
    const r = run([down(T0), down(T0 + 50, 'ControlLeft'), up(T0 + 600), down(T0 + 700), up(T0 + 1400)]);
    return r.actions === 'start,toggle' && r.state.listening === false;
  })());
}

// ── a chord that began before the press ───────────────────────────────────
// The other shape: the chosen key goes down while something else is already
// held. There was never an instant at which this looked like dictation, so
// there is no session to end and no `start` to regret. Windows AltGr is this
// shape — ControlLeft then AltRight, the default key, for every accent typed.
{
  const altGr = (upAt) => run([down(T0, 'ControlLeft'), down(T0 + 5), up(upAt)]);
  ok('AltGr held: no session at all, so nothing is sent', altGr(T0 + 600).actions === '', altGr(T0 + 600).actions);
  ok('and nothing is left held or listening', (() => {
    const s = altGr(T0 + 600).state;
    return s.held === false && s.listening === false && s.since === null;
  })());
  ok('AltGr tapped: no session either, so the microphone is not left open', (() => {
    const r = altGr(T0 + 100);
    return r.actions === '' && r.state.listening === false;
  })(), altGr(T0 + 100).actions);
  ok('AltGr with the letter it was typed for sends nothing', (() => {
    const r = run([down(T0, 'ControlLeft'), down(T0 + 5), down(T0 + 200, 'KeyE'), up(T0 + 600)]);
    return r.actions === '' && r.state.listening === false;
  })());
  ok('the up for the chosen key is not mistaken for a stray release either',
     reduce(run([down(T0, 'ControlLeft'), down(T0 + 5)]).state, up(T0 + 600), ON).action === null);

  ok('Cmd held, then Right Option: no start', run([down(T0, 'MetaLeft'), down(T0 + 5)]).actions === '');
  ok('any key already down does it, modifier or letter',
     ['ControlLeft', 'ControlRight', 'ShiftLeft', 'MetaLeft', 'AltLeft', 'KeyA', 'Space'].every((code) =>
       run([down(T0, code), down(T0 + 5), up(T0 + 600)]).actions === ''));

  // The rule is about keys that are down *now*, which is the whole difference
  // between AltGr and somebody who happened to press Control a moment ago.
  ok('a plain hold, with nothing else down, still starts and still sends',
     run([down(T0), up(T0 + 600)]).actions === 'start,stop');
  ok('a modifier released before the chosen key goes down is not a chord',
     run([down(T0, 'ControlLeft'), up(T0 + 50, 'ControlLeft'), down(T0 + 100), up(T0 + 700)]).actions === 'start,stop');
  ok('and a chorded press leaves nothing behind: the next one is ordinary',
     run([down(T0, 'ControlLeft'), down(T0 + 5), up(T0 + 600), up(T0 + 700, 'ControlLeft'),
          down(T0 + 1000), up(T0 + 1600)]).actions === 'start,stop');
  ok('a repeated down of the other key does not leave it stuck down',
     run([down(T0, 'KeyS'), down(T0 + 10, 'KeyS'), up(T0 + 20, 'KeyS'), down(T0 + 30), up(T0 + 700)]).actions === 'start,stop');
  ok('an up for a key never seen going down leaves the set alone',
     run([up(T0, 'KeyS'), down(T0 + 30), up(T0 + 700)]).actions === 'start,stop');
  ok('the keys that are down are named, in the order they went down', (() => {
    const s = run([down(T0, 'ControlLeft'), down(T0 + 5, 'ShiftLeft')]).state;
    return s.others.join() === 'ControlLeft,ShiftLeft';
  })());
  // Blur is the only way a key can go down here and never come up, so it has
  // to empty the set: a code stuck in it would make every later press a chord.
  ok('blur empties the held keys, so the next press is ordinary',
     run([down(T0, 'ControlLeft'), blur(T0 + 50), down(T0 + 100), up(T0 + 700)]).actions === 'start,stop');
  ok('and so does a blur that cancelled a hold',
     run([down(T0), down(T0 + 20, 'ControlLeft'), blur(T0 + 50), down(T0 + 100), up(T0 + 700)]).actions === 'start,cancel,start,stop');

  // A hands-free session is somebody else's; a chord aimed at the keyboard
  // layout should not close it, and the next unchorded tap still does.
  ok('a chorded press of the chosen key does not end a hands-free session', (() => {
    const r = run([down(T0), up(T0 + 100), down(T0 + 2000, 'ControlLeft'), down(T0 + 2005), up(T0 + 2600)]);
    return r.actions === 'start' && r.state.listening === true;
  })());
  ok('and the tap after the modifier is let go still ends it',
     run([down(T0), up(T0 + 100), down(T0 + 2000, 'ControlLeft'), down(T0 + 2005), up(T0 + 2600),
          up(T0 + 2700, 'ControlLeft'), down(T0 + 3000), up(T0 + 3100)]).actions === 'start,toggle');
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
// which is why `accept` drops `KeyboardEvent.repeat` before the reducer sees
// it. Only the DOM can still tell a repeat from a press once the reducer has
// forgotten the key was down.

ok('an up for a key never seen going down is ignored', (() => {
  const r = reduce(IDLE, up(T0), ON);
  return r.action === null && equal(r.state, IDLE);
})());
ok('and so is a second up after a release', run([down(T0), up(T0 + 600), up(T0 + 700)]).actions === 'start,stop');

// ── what reaches the reducer ──────────────────────────────────────────────
// `accept` is the whole of the component's policy, kept here so that it has
// tests to answer to. Two noes — a repeat, and a setting that is off — and one
// yes that has to be said out loud, because a guard in the listener saying no
// to it is invisible to every other test in this file:
//
//     if (/^Key[A-Z]$/.test(e.code) && e.target instanceof HTMLTextAreaElement) return;
//
// That guard existed. It meant Right Option held in the composer while O typed
// "ø" was not marked as a chord, and the release sent the half-written draft.
{
  const ev = (code, over = {}) => ({ code, repeat: false, targetEditable: false, ...over });
  const IN_FIELD = { targetEditable: true };
  const PRINTABLE = ['KeyA', 'KeyO', 'KeyZ', 'Digit4', 'Space', 'Period', 'Comma', 'Numpad5', 'IntlBackslash', 'Backquote'];

  ok('a printable key in a field somebody is typing into still reaches the reducer',
     PRINTABLE.every((code) => accept(ev(code, IN_FIELD), ON) === true),
     PRINTABLE.filter((code) => !accept(ev(code, IN_FIELD), ON)).join());
  ok('and so does the chosen key, wherever it lands',
     accept(ev('AltRight', IN_FIELD), ON) === true && accept(ev('AltRight'), ON) === true);
  ok('the target never changes the answer, for any key',
     [...PRINTABLE, 'AltRight', 'ControlLeft', 'Fn', ''].every((code) =>
       accept(ev(code, IN_FIELD), ON) === accept(ev(code), ON)));
  // Which is the letter-in-the-composer case, end to end: the component hands
  // the letter over and the reducer calls the press a chord.
  ok('so Option+O typed into the composer is a chord and sends nothing', (() => {
    const evs = [ev('AltRight'), ev('KeyO', IN_FIELD), ev('KeyO', { ...IN_FIELD, repeat: true })];
    const passed = evs.filter((e) => accept(e, ON)).map((e) => e.code);
    if (passed.join() !== 'AltRight,KeyO') return false;
    return run([down(T0), down(T0 + 200, 'KeyO'), up(T0 + 600)]).actions === 'start,toggle';
  })());

  ok('a repeat is dropped, wherever it lands',
     accept(ev('AltRight', { repeat: true }), ON) === false
     && accept(ev('KeyA', { repeat: true, targetEditable: true }), ON) === false);
  ok('off, nothing is accepted at all',
     [...PRINTABLE, 'AltRight', 'Fn'].every((code) => accept(ev(code), OFF) === false && accept(ev(code, IN_FIELD), OFF) === false));
  ok('a keyup is judged the same way: it carries no repeat, so it is accepted',
     accept(ev('AltRight'), ON) === true && accept(ev('KeyO', IN_FIELD), ON) === true);
  ok('accept never touches what it is given', (() => {
    const e = ev('KeyO', IN_FIELD);
    const copy = JSON.stringify(e);
    const s = { enabled: true, code: 'AltRight' };
    accept(e, s);
    accept(ev('KeyO', { repeat: true }), s);
    return JSON.stringify(e) === copy && s.enabled === true && s.code === 'AltRight';
  })());
}

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
  const s = { held: false, since: null, listening: false, others: [] };
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
ok('equal compares the three fields the pill can see', equal(IDLE, { held: false, since: null, listening: false })
   && !equal(IDLE, { held: true, since: null, listening: false })
   && !equal(IDLE, { held: false, since: 0, listening: false })
   && !equal(IDLE, { held: false, since: null, listening: true }));
// And not the fourth. The pill says nothing about which other keys are down,
// and comparing them would redraw it on every letter typed; `PushToTalk.tsx`
// keeps the reducer's state in a ref whatever `equal` says, so nothing is lost.
ok('equal ignores the held keys', equal(IDLE, { held: false, since: null, listening: false, others: ['KeyS'] }));
ok('but the reducer still keeps them', run([down(T0, 'KeyS')]).state.others.join() === 'KeyS');
ok('the shared IDLE keeps its own empty set', (() => {
  const after = run([down(T0, 'KeyS'), up(T0 + 10, 'KeyS'), down(T0 + 20), blur(T0 + 30)]);
  return IDLE.others.length === 0 && after.state.others.length === 0;
})());
ok('the setting is never altered', (() => {
  const s = { enabled: true, code: 'AltRight' };
  run([down(T0), down(T0 + 20, 'KeyS'), up(T0 + 600), blur(T0 + 700)], s);
  return s.enabled === true && s.code === 'AltRight' && Object.keys(s).length === 2;
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
