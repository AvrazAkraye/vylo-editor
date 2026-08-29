// The suggestion's state machine, exercised without a DOM.
//
// The behaviour worth pinning down is what happens as you keep typing: a
// suggestion that vanishes the moment you type its first character would fire a
// fresh request for text the editor is already holding, which is both slower
// and more expensive than doing nothing.
import { EditorState } from '@codemirror/state';
import { ghostField, setGhost } from '../.test-build/complete.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const start = (doc, ghost) => {
  let s = EditorState.create({ doc, extensions: [ghostField] });
  if (ghost) s = s.update({ effects: setGhost.of(ghost) }).state;
  return s;
};
const g = (s) => s.field(ghostField);
const type = (s, at, text) => s.update({ changes: { from: at, insert: text }, selection: { anchor: at + text.length } }).state;

// A suggestion of "a + b;" sitting at the end of "  return "
const DOC = 'function f(a, b) {\n  return ';
const AT = DOC.length;

ok('a suggestion is held', g(start(DOC, { from: AT, text: 'a + b;' }))?.text === 'a + b;');

{
  const s = type(start(DOC, { from: AT, text: 'a + b;' }), AT, 'a');
  ok('typing its first character keeps the remainder', g(s)?.text === ' + b;', g(s));
  ok('and the suggestion moves with the cursor', g(s)?.from === AT + 1, g(s));
}

{
  let s = start(DOC, { from: AT, text: 'a + b;' });
  for (const ch of 'a + b') s = type(s, s.field(ghostField).from, ch);
  ok('typing all the way through leaves the last character', g(s)?.text === ';', g(s));
  s = type(s, s.field(ghostField).from, ';');
  ok('and finishing it clears the suggestion', g(s) === null, g(s));
}

{
  const s = type(start(DOC, { from: AT, text: 'a + b;' }), AT, 'x');
  ok('typing something else drops it', g(s) === null, g(s));
}

{
  // Editing elsewhere in the document must not shift a stale suggestion around.
  const s = type(start(DOC, { from: AT, text: 'a + b;' }), 0, '// note\n');
  ok('an edit somewhere else drops it', g(s) === null, g(s));
}

{
  const base = start(DOC, { from: AT, text: 'a + b;' });
  const moved = base.update({ selection: { anchor: 5 } }).state;
  ok('moving the cursor away drops it', g(moved) === null, g(moved));
  const stays = base.update({ selection: { anchor: AT } }).state;
  ok('a selection update at the same spot keeps it', g(stays)?.text === 'a + b;', g(stays));
}

{
  const s = start(DOC, { from: AT, text: 'a + b;' }).update({ effects: setGhost.of(null) }).state;
  ok('it can be dismissed outright', g(s) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
