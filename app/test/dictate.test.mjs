// Dictation into the composer.
//
// Everything here is about the two halves that decide something: which results
// become text, and what a session does when the engine misbehaves. The engine
// and the clock are faked, because the real ones need a microphone, a network
// and eight seconds of silence.
//
// The thing this feature must never grow is a path from recognised speech to
// anything that runs. There is no such path to test for — the module's only
// output is `onText` — so what is tested instead is that the words land in a
// string, at a caret, and nowhere else.
import {
  CANNOT_START, Dictation, NOTHING_HEARD, OFF, SILENCE_MS, STOP_MS, UNAVAILABLE,
  browserOpen, fold, insert, join, recognitionLang, speechAvailable, trouble,
} from '../.test-build/dictate.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// ── putting two pieces of speech together ─────────────────────────────────
//
// Engines are inconsistent about the space around a result, so it is put back
// here rather than trusted.
ok('the first phrase arrives as it is', join('', 'hello') === 'hello');
ok('a second phrase is separated by one space', join('hello', 'there') === 'hello there');
ok('and the space the engine supplied is not doubled', join('hello', ' there') === 'hello there');
ok('but punctuation stays against the word it belongs to',
   join('hello', ', and then') === 'hello, and then', join('hello', ', and then'));
ok('a phrase that is only whitespace adds nothing', join('hello', '   ') === 'hello');

// ── which results become text ─────────────────────────────────────────────
{
  const { next, said } = fold(NOTHING_HEARD, 0, [{ text: 'hell', final: false }]);
  ok('a running guess is never committed', said === '', said);
  ok('but it is exposed, so the control can show it', next.interim === 'hell', next);
  ok('and nothing is counted as taken until it is final', next.taken === 0, next);
}
{
  const { next, said } = fold(NOTHING_HEARD, 0, [{ text: 'hello there', final: true }]);
  ok('a result the engine marks final is committed', said === 'hello there', said);
  ok('and the guess is cleared with it', next.interim === '', next);
}
{
  // The ordinary shape of a sentence: guessed, revised, then settled.
  const guess = fold(NOTHING_HEARD, 0, [{ text: 'hell', final: false }]).next;
  const { next, said } = fold(guess, 0, [{ text: 'hello there', final: true }]);
  ok('a result that goes interim then final is committed once, in its final form',
     said === 'hello there' && next.taken === 1, { said, next });
}
{
  // Engines redeliver a result they have already finalised. Committing it again
  // puts the sentence in the composer twice, which is the failure a person
  // notices first and cannot explain.
  const one = fold(NOTHING_HEARD, 0, [{ text: 'hello there', final: true }]).next;
  const { next, said } = fold(one, 0, [
    { text: 'hello there', final: true },
    { text: 'and more', final: true },
  ]);
  ok('a result the engine redelivers is not said twice', said === 'and more', said);
  ok('while the new one beside it still arrives', next.taken === 2, next);
}
{
  const { said, next } = fold(NOTHING_HEARD, 3, [
    { text: 'one', final: true },
    { text: 'two', final: true },
  ]);
  ok('two finals in one event arrive as one phrase', said === 'one two', said);
  ok('and counting starts from the index the engine gave, not from zero',
     next.taken === 5, next);
}
{
  const a = fold(NOTHING_HEARD, 0, [{ text: 'wor', final: false }]).next;
  const b = fold(a, 0, [{ text: 'world', final: false }]).next;
  ok('the running guess is replaced, not accumulated', b.interim === 'world', b);
}
ok('an event with nothing in it commits nothing',
   fold(NOTHING_HEARD, 0, []).said === '');

// ── where the words land ──────────────────────────────────────────────────
ok('an empty composer takes the words as they are',
   insert('', 0, 'hello there').text === 'hello there');
ok('and the caret ends after them, ready for the next phrase',
   insert('', 0, 'hello there').caret === 11, insert('', 0, 'hello there'));
{
  const r = insert('what does', 9, 'this do');
  ok('a space is added when the caret sits against a word',
     r.text === 'what does this do' && r.caret === 17, r);
}
ok('but not when the caret already follows one',
   insert('what does ', 10, 'this do').text === 'what does this do',
   insert('what does ', 10, 'this do'));
ok('and not in front of punctuation',
   insert('hello', 5, ', and then').text === 'hello, and then',
   insert('hello', 5, ', and then'));
{
  // The reason this inserts at the caret at all: dictating a clause into the
  // middle of a half-written question.
  const r = insert('one three', 3, 'two');
  ok('dictation lands at the caret, not at the end',
     r.text === 'one two three' && r.caret === 7, r);
}
{
  const r = insert('onethree', 3, 'two');
  ok('a space is added after as well, so the next word is not welded on',
     r.text === 'one two three', r);
  ok('and the caret stays in front of that space, not after it', r.caret === 7, r);
}
{
  const r = insert('abc', 99, 'd');
  ok('a caret past the end of the text does not lose characters',
     r.text === 'abc d' && r.caret === 5, r);
}
{
  const r = insert('abc', -5, 'd');
  ok('a caret before the start is clamped rather than slicing backwards',
     r.text === 'd abc' && r.caret === 1, r);
}
{
  const r = insert('abc', 2, '   ');
  ok('silence inserts nothing and leaves the caret where it was',
     r.text === 'abc' && r.caret === 2, r);
}

// ── what to say when the engine fails ─────────────────────────────────────
ok('no permission is reported as something a person can act on',
   trouble('not-allowed') === 'Microphone access was refused. Allow it in your system settings.');
ok('a policy refusal says the same thing, because it looks the same from here',
   trouble('service-not-allowed') === trouble('not-allowed'));
ok('no microphone is its own message', trouble('audio-capture') === 'No microphone was found.');
ok('an engine that needs the network says so',
   trouble('network') === 'Dictation needs a connection, and there was none.');
ok('a language the engine will not do says so',
   trouble('language-not-supported') === 'Dictation does not have that language.');
// The two that are not failures. A red line for the end of a sentence would be
// an error message for the most ordinary thing that happens.
ok('silence is not an error', trouble('no-speech') === null);
ok('a session we aborted ourselves is not an error', trouble('aborted') === null);
ok('an unrecognised code still says something rather than nothing',
   trouble('wat') === 'Dictation stopped unexpectedly.');

// ── which language to recognise ───────────────────────────────────────────
ok('an Arabic interface dictates in Arabic, whatever the OS is set to',
   recognitionLang('ar', 'en-US') === 'ar');
// No engine has a Kurdish model, so asking for one fails with
// language-not-supported and the button never works for the people the
// interface was translated for.
ok('a Sorani interface falls back to the OS language', recognitionLang('ckb', 'tr-TR') === 'tr-TR');
ok('and so does Badini', recognitionLang('kmr', 'de-DE') === 'de-DE');
ok('an English interface follows the OS too', recognitionLang('en', 'en-GB') === 'en-GB');
ok('and an OS that says nothing gets a language rather than an empty one',
   recognitionLang('en', '') === 'en-US');

// ── the session ───────────────────────────────────────────────────────────

/** Timers that only advance when a test says so. */
const fakeTimers = () => {
  const armed = new Map();
  let next = 1;
  return {
    set(ms, fn) { const id = next++; armed.set(id, { ms, fn }); return id; },
    clear(id) { armed.delete(id); },
    /** Ids still armed, so a test can prove one was replaced rather than added. */
    ids() { return [...armed.keys()]; },
    waits() { return [...armed.values()].map((e) => e.ms); },
    /** Run the single armed timer, as if its wait had elapsed. */
    fire() {
      const [id] = armed.keys();
      if (id === undefined) return false;
      const { fn } = armed.get(id);
      armed.delete(id);
      fn();
      return true;
    },
  };
};

/** A session with a fake engine and a fake clock. */
const rig = (o = {}) => {
  const timers = fakeTimers();
  const said = [];
  const engines = [];
  const open = o.open ?? ((sink) => {
    const e = {
      sink, calls: [],
      start() { this.calls.push('start'); if (o.startThrows) throw new Error('InvalidStateError'); },
      stop() { this.calls.push('stop'); if (o.stopThrows) throw new Error('nope'); },
      abort() { this.calls.push('abort'); },
    };
    engines.push(e);
    return e;
  });
  const d = new Dictation({ open, onText: (s) => said.push(s), onState: () => {}, timers });
  return { d, timers, said, engines, engine: () => engines[engines.length - 1] };
};

const HELLO = [{ text: 'hello there', final: true }];

ok('nothing is listening until it is asked to', rig().d.state.phase === 'off');
ok('and the resting state carries no error', OFF.error === null && OFF.interim === '');

{
  const r = rig();
  r.d.start();
  ok('starting opens exactly one engine and starts it',
     r.engines.length === 1 && r.engine().calls.join() === 'start', r.engines.length);
  ok('but the control waits for the engine to say it is listening',
     r.d.state.phase === 'starting', r.d.state);
  r.engine().sink.started();
  ok('the engine saying it started is what turns the control on',
     r.d.state.phase === 'listening', r.d.state);
  // Web Speech throws on a second start(), and the person pressing twice is
  // not asking for two microphones.
  r.d.start();
  ok('starting again does not open a second engine', r.engines.length === 1, r.engines.length);
}
{
  const r = rig();
  r.d.start();
  r.engine().sink.started();
  r.engine().sink.heard(0, HELLO);
  ok('a finalised phrase is handed over exactly once',
     r.said.length === 1 && r.said[0] === 'hello there', r.said);
  r.engine().sink.heard(1, [{ text: 'and mo', final: false }]);
  ok('a running guess is not handed over', r.said.length === 1, r.said);
  ok('it is put in the state for the control to show',
     r.d.state.interim === 'and mo', r.d.state);
}
{
  // Some engines never fire `start` at all.
  const r = rig();
  r.d.start();
  r.engine().sink.heard(0, HELLO);
  ok('an engine that never says it started still turns the control on when it hears something',
     r.d.state.phase === 'listening', r.d.state);
}
{
  const r = rig();
  r.d.start();
  r.engine().sink.started();
  r.d.stop();
  ok('stopping asks the engine to finish the phrase rather than dropping it',
     r.engine().calls.includes('stop') && !r.engine().calls.includes('abort'), r.engine().calls);
  ok('and the control shows it is on the way out', r.d.state.phase === 'stopping', r.d.state);
  ok('the guess is dropped at once, because it will never be finalised now',
     r.d.state.interim === '', r.d.state);
  r.engine().sink.heard(2, [{ text: 'too late', final: true }]);
  ok('results that arrive after a stop are ignored', r.said.length === 0, r.said);
  r.engine().sink.ended();
  ok('the engine ending is what turns the control off', r.d.state.phase === 'off', r.d.state);
}
{
  // The one failure a person cannot get out of: a button stuck mid-stop.
  const r = rig();
  r.d.start();
  r.engine().sink.started();
  r.d.stop();
  ok('a stop is given a grace period', r.timers.waits()[0] === STOP_MS, r.timers.waits());
  r.timers.fire();
  ok('an engine that never says it ended is forced off rather than leaving the control stuck',
     r.d.state.phase === 'off' && r.engine().calls.includes('abort'), r.engine().calls);
}
{
  const r = rig({ stopThrows: true });
  r.d.start();
  r.engine().sink.started();
  r.d.stop();
  ok('a stop that throws still returns the control to off', r.d.state.phase === 'off', r.d.state);
}
{
  const r = rig();
  r.d.start();
  r.engine().sink.started();
  ok('a session arms a silence timeout as soon as it starts',
     r.timers.waits().join() === String(SILENCE_MS), r.timers.waits());
  const first = r.timers.ids()[0];
  r.engine().sink.heard(0, [{ text: 'still', final: false }]);
  ok('and anything heard at all resets it rather than adding a second one',
     r.timers.ids().length === 1 && r.timers.ids()[0] !== first, r.timers.ids());
  r.timers.fire();
  ok('a session someone walked away from stops itself',
     r.d.state.phase === 'stopping' && r.engine().calls.includes('stop'), r.d.state);
  r.engine().sink.ended();
  ok('and it is a clean stop, with nothing on screen to dismiss',
     r.d.state.phase === 'off' && r.d.state.error === null, r.d.state);
}
{
  const r = rig();
  r.d.start();
  r.engine().sink.started();
  r.engine().sink.failed('not-allowed');
  ok('an engine error is reported', r.d.state.error === trouble('not-allowed'), r.d.state);
  r.engine().sink.ended();
  ok('and survives the end that follows it, which is when it gets drawn',
     r.d.state.phase === 'off' && r.d.state.error === trouble('not-allowed'), r.d.state);
  r.d.start();
  ok('starting again clears it', r.d.state.error === null, r.d.state);
}
{
  const r = rig();
  r.d.start();
  r.engine().sink.started();
  r.engine().sink.failed('no-speech');
  ok('silence from the engine leaves nothing on screen', r.d.state.error === null, r.d.state);
  ok('but it still ends the session', r.d.state.phase === 'stopping', r.d.state);
}
{
  // Web Speech sends `error` then `end`; not every engine sends `end`.
  const r = rig();
  r.d.start();
  r.engine().sink.started();
  r.engine().sink.failed('network');
  r.timers.fire();
  ok('an engine that fails and then says nothing is still forced off',
     r.d.state.phase === 'off' && r.engine().calls.includes('abort'), r.engine().calls);
}
{
  const r = rig();
  r.d.start();
  r.engine().sink.started();
  r.engine().sink.ended();
  r.engine().sink.failed('network');
  ok('an error arriving after the session ended is a report, not a restart',
     r.d.state.phase === 'off', r.d.state);
  ok('and it is still said out loud', r.d.state.error === trouble('network'), r.d.state);
  ok('with no timer left running behind it', r.timers.ids().length === 0, r.timers.ids());
}
{
  // The common case on a webview that has no speech recognition at all.
  const r = rig({ open: () => null });
  r.d.start();
  ok('a webview with no engine says so instead of throwing',
     r.d.state.error === UNAVAILABLE, r.d.state);
  ok('and the control stays off', r.d.state.phase === 'off', r.d.state);
  ok('with nothing armed to fire later', r.timers.ids().length === 0, r.timers.ids());
}
{
  const r = rig({ startThrows: true });
  r.d.start();
  ok('an engine whose start throws does not leave the control on',
     r.d.state.phase === 'off' && r.d.state.error === CANNOT_START, r.d.state);
  ok('and does not leave a silence timeout armed', r.timers.ids().length === 0, r.timers.ids());
  r.d.start();
  ok('and the next attempt is allowed to open a fresh engine', r.engines.length === 2, r.engines.length);
}
{
  const r = rig();
  r.d.toggle();
  ok('one control starts it', r.d.state.phase === 'starting', r.d.state);
  r.engine().sink.started();
  r.d.toggle();
  ok('and the same control stops it', r.d.state.phase === 'stopping', r.d.state);
}
{
  const r = rig();
  r.d.start();
  r.engine().sink.started();
  r.d.dispose();
  ok('unmounting drops the session without waiting to be told it ended',
     r.engine().calls.includes('abort') && r.d.state.phase === 'off', r.engine().calls);
  ok('and takes its timers with it, so nothing fires into a dead component',
     r.timers.ids().length === 0, r.timers.ids());
}

// ── the engine half ───────────────────────────────────────────────────────
//
// Translating Web Speech's cumulative result list is where an off-by-one hides,
// so it is driven with a fake constructor rather than left to a real browser.
ok('speech is reported as unavailable where there is no window at all',
   speechAvailable() === false);
ok('and opening it there returns nothing rather than throwing',
   browserOpen('en-US')({}) === null);

{
  const made = [];
  class FakeSR {
    constructor() {
      this.calls = [];
      made.push(this);
    }
    start() { this.calls.push('start'); }
    stop() { this.calls.push('stop'); }
    abort() { this.calls.push('abort'); }
  }
  globalThis.window = { webkitSpeechRecognition: FakeSR };

  ok('a webview with the prefixed engine is reported as available', speechAvailable() === true);

  const log = [];
  const sink = {
    started: () => log.push(['started']),
    heard: (at, phrases) => log.push(['heard', at, phrases]),
    failed: (code) => log.push(['failed', code]),
    ended: () => log.push(['ended']),
  };
  const rec = browserOpen('en-GB')(sink);
  const sr = made[0];
  ok('the engine is told which language to expect', sr.lang === 'en-GB', sr.lang);
  ok('and to keep going past the first sentence', sr.continuous === true);
  ok('and to report its guesses on the way', sr.interimResults === true);

  rec.start();
  rec.stop();
  rec.abort();
  ok('the three controls reach the engine', sr.calls.join() === 'start,stop,abort', sr.calls);

  sr.onstart();
  sr.onend();
  ok('start and end are passed through',
     log[0][0] === 'started' && log[1][0] === 'ended', log);

  sr.onerror({ error: 'not-allowed' });
  ok('an error carries its code', log[2][1] === 'not-allowed', log[2]);
  sr.onerror({});
  ok('and an error with no code does not become "undefined"', log[3][1] === 'unknown', log[3]);

  // `results` is cumulative; `resultIndex` says where it changed. Reading the
  // whole list every event would recommit every sentence already spoken.
  sr.onresult({
    resultIndex: 1,
    results: {
      length: 3,
      0: { isFinal: true, 0: { transcript: 'already said' } },
      1: { isFinal: true, 0: { transcript: 'hello there' } },
      2: { isFinal: false, 0: { transcript: 'and mo' } },
    },
  });
  const [, at, phrases] = log[4];
  ok('results before the changed one are not read again', at === 1 && phrases.length === 2, log[4]);
  ok('a final result is passed on as final',
     phrases[0].text === 'hello there' && phrases[0].final === true, phrases[0]);
  ok('and a guess as a guess',
     phrases[1].text === 'and mo' && phrases[1].final === false, phrases[1]);

  sr.onresult({ resultIndex: 0, results: { length: 1, 0: { isFinal: true } } });
  ok('a result with no alternative in it does not throw', log[5][2][0].text === '', log[5]);

  delete globalThis.window;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
