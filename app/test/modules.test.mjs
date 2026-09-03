// The app's sections, as modules.
//
// The bug this list exists to make impossible: the rail was an array literal in
// App.tsx and the sidebar heading was a separate chain of ternaries, and `todo`
// was in the first and missing from the second — so the To do panel sat under a
// heading that said "Memory" for eleven releases. The last test in this file is
// the one that would have caught it.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  MODULES, DEFAULT, KEY, moduleOf, labelOf, read, write, isOn, enabled,
  toggle, isLast, moveTo, reset, active, setSide, railFirst, dock, dockOf, docked,
} from '../.test-build/modules.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const ids = MODULES.map((m) => m.id);

// ── the registry itself ───────────────────────────────────────────────────
ok('there are modules', MODULES.length >= 6, MODULES.length);
ok('every id is unique', new Set(ids).size === ids.length, ids);
ok('every module has a label, an icon and a line about it',
   MODULES.every((m) => m.label && m.icon && m.about));
ok('every "about" is a sentence, not a fragment',
   MODULES.every((m) => m.about.endsWith('.')), MODULES.map((m) => m.about));
ok('a badge names a counter or is absent',
   MODULES.every((m) => m.badge === undefined || ['changes', 'todo'].includes(m.badge)));
ok('the descriptor comes back by id', moduleOf('todo').label === 'To do');
ok('and the label with it', labelOf('memory') === 'Memory');
ok('the storage key is versioned, so a later shape is tellable apart',
   /\.v\d+$/.test(KEY), KEY);
ok('the default has everything on, in declaration order',
   DEFAULT.order.join() === ids.join() && DEFAULT.off.length === 0);

// ── reading a saved layout ────────────────────────────────────────────────
ok('nothing saved is the default', read(null).order.join() === ids.join());
// A layout is a convenience. The cost of a bad one is the default arrangement,
// never a window that will not open.
ok('not JSON is the default', read('{{{').order.join() === ids.join());
ok('a JSON scalar is the default', read('7').order.join() === ids.join());
ok('an empty object is the default', read('{}').order.join() === ids.join());
ok('and none of those throw', (() => {
  for (const bad of [null, '', '[]', '{"order":null}', '{"order":{}}', 'undefined']) read(bad);
  return true;
})());

ok('a saved order is honoured', (() => {
  const l = read(JSON.stringify({ order: ['memory', 'files', 'search', 'changes', 'chats', 'todo'], off: [] }));
  return l.order[0] === 'memory' && l.order[1] === 'files';
})());
ok('a saved off-list is honoured', read('{"order":[],"off":["search"]}').off.join() === 'search');
ok('a module that no longer exists is dropped',
   read('{"order":["files","ghost"],"off":["ghost"]}').order.includes('ghost') === false);
ok('and dropping it does not drop the real ones',
   read('{"order":["ghost","files"]}').order.length === ids.length);
ok('a duplicate in a saved order is kept once', (() => {
  const l = read('{"order":["files","files","search"]}');
  return l.order.filter((x) => x === 'files').length === 1;
})());

// A module added in a later version must appear for somebody whose saved
// layout predates it, or it ships and nobody ever sees it.
{
  const old = JSON.stringify({ order: ['files', 'search'], off: [] });
  const l = read(old);
  ok('a module the saved order has never heard of still appears',
     l.order.length === ids.length, l.order);
  ok('and it is on, because one that arrives switched off is never discovered',
     ids.every((id) => isOn(l, id)));
  // Putting it back at its declared position would reorder somebody's rail
  // around a section they did not ask for.
  ok('it is appended rather than inserted, so nothing already there moves',
     l.order[0] === 'files' && l.order[1] === 'search', l.order);
}

// An empty rail beside an empty sidebar reads as broken, not as empty.
{
  const l = read(JSON.stringify({ order: ids, off: ids }));
  ok('a layout with everything off is repaired', enabled(l).length >= 1, l.off);
  ok('and the one that survives is the first in the person own order',
     enabled(l)[0].id === ids[0]);
}

ok('write then read is the same layout', (() => {
  // Built from `ids` rather than written out: a list spelled out here is a copy
  // of the registry, and a copy is what this whole module exists to avoid.
  const l = { order: [...ids].reverse(), off: [ids[2]], side: 'left' };
  const back = read(write(l));
  return back.order.join() === l.order.join() && back.off.join() === l.off.join();
})());

// ── turning them on and off ───────────────────────────────────────────────
{
  const l = read(null);
  ok('everything starts on', enabled(l).length === ids.length);
  const off = toggle(l, 'search');
  ok('toggling turns one off', !isOn(off, 'search') && enabled(off).length === ids.length - 1);
  ok('and the rest keep their order',
     enabled(off).map((m) => m.id).join() === ids.filter((x) => x !== 'search').join());
  ok('toggling again turns it back on', isOn(toggle(off, 'search'), 'search'));
  ok('and does not leave a stale entry behind', toggle(off, 'search').off.length === 0);
  ok('toggling does not mutate what it was given', l.off.length === 0);
  ok('an unknown id changes nothing', toggle(l, 'ghost') === l);
}
{
  // The control is disabled, so reaching here means something else called it —
  // and the useful behaviour is to hold the invariant quietly.
  let l = read(null);
  for (const id of ids.slice(1)) l = toggle(l, id);
  ok('the last module on cannot be turned off', enabled(l).length === 1, l.off);
  ok('and trying returns the layout unchanged', toggle(l, ids[0]) === l);
  ok('isLast says so before the button is pressed', isLast(l, ids[0]) === true);
  ok('and is false while there are two', isLast(read(null), 'files') === false);
  ok('isLast is false for a module that is already off', isLast(l, ids[1]) === false);
}

// ── order ─────────────────────────────────────────────────────────────────
{
  const l = read(null);
  ok('a module moves to the front', moveTo(l, 4, 0).order[0] === ids[4]);
  ok('and the rest close up behind it',
     moveTo(l, 0, 2).order.join() === [ids[1], ids[2], ids[0], ...ids.slice(3)].join(),
     moveTo(l, 0, 2).order);
  ok('moving to where it already is changes nothing', moveTo(l, 2, 2) === l);
  ok('an index off either end changes nothing',
     moveTo(l, -1, 0) === l && moveTo(l, 0, 99) === l);
  ok('moving does not mutate what it was given', l.order.join() === ids.join());
  // Settings shows every module in one list, so dragging past a switched-off
  // row has to land where the eye says it will.
  ok('an off module still takes up a position, so a drag past it lands right', (() => {
    const withOff = toggle(l, ids[1]);          // ids[1] is off but still listed
    return moveTo(withOff, 0, 2).order.join() ===
      [ids[1], ids[2], ids[0], ...ids.slice(3)].join();
  })(), moveTo(toggle(l, ids[1]), 0, 2).order);
  ok('reset puts everything back', (() => {
    const messed = moveTo(toggle(l, 'search'), 5, 0);
    const r = reset();
    return r.order.join() === ids.join() && r.off.length === 0 && messed.order[0] === ids[5];
  })());
}

// ── which section the sidebar shows ───────────────────────────────────────
{
  const l = read(null);
  ok('the one asked for, when it is on', active(l, 'todo') === 'todo');
  // Turning off the section you were looking at has to move you somewhere.
  ok('the first one on, when it is not', active(toggle(l, 'todo'), 'todo') === ids[0]);
  ok('and never something switched off', (() => {
    const off = toggle(toggle(l, 'files'), 'search');
    return isOn(off, active(off, 'files'));
  })());
}

// ── the list and the app cannot drift apart ───────────────────────────────
//
// This is the test the header bug needed. Every module must have a panel, and
// every panel must be a module — one half without the other is exactly how
// `todo` ended up under a heading that said "Memory".
{
  const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');
  const missing = ids.filter((id) => !app.includes(`shown === '${id}'`));
  ok('every module has a panel in App.tsx', missing.length === 0, missing);

  const branches = [...app.matchAll(/shown === '([a-z]+)'/g)].map((m) => m[1]);
  const stray = [...new Set(branches)].filter((id) => !ids.includes(id));
  ok('and every panel in App.tsx is a module', stray.length === 0, stray);

  // The heading is read from the registry now. A ternary chain naming sections
  // is the shape of the original bug, so its return is a failure.
  ok('the sidebar heading is not a chain of ternaries again',
     !/shown === 'files' \? t\(|rail === 'files' \? t\(/.test(app));

  const rail = readFileSync(join(SRC, 'Rail.tsx'), 'utf8');
  ok('Rail.tsx takes its ids from here rather than declaring its own',
     !/export type RailId/.test(rail), 'Rail.tsx still declares RailId');
}
{
  // Every label and every "about" line reaches the interface through t(), so
  // both have to be in the catalogues or a module is English in Arabic.
  const i18n = readFileSync(join(SRC, 'i18n.ts'), 'utf8');
  const absent = MODULES.flatMap((m) => [m.label, m.about])
    .filter((s) => !i18n.includes(`'${s.replace(/'/g, "\\'")}':`));
  ok('every module label and description is translated', absent.length === 0, absent);
}

// ── which edge the rail sits against ──────────────────────────────────────
//
// Physical, not logical, and that is the awkward but correct choice: somebody
// who asks for the rail on the left means the left of their screen, in every
// language. The rail is furniture, not prose, and it does not flip when the
// text does.
ok('the rail starts on the left', DEFAULT.side === 'left' && read(null).side === 'left');
ok('and moves', setSide(read(null), 'right').side === 'right');
ok('moving it to where it is changes nothing', (() => {
  const l = read(null);
  return setSide(l, 'left') === l;
})());
ok('the side survives a save and a load', read(write(setSide(read(null), 'right'))).side === 'right');
ok('a saved side is honoured', read('{"side":"right"}').side === 'right');
ok('nonsense falls back to the left', read('{"side":"up"}').side === 'left');
ok('a missing side falls back to the left', read('{"order":[]}').side === 'left');
ok('and reset puts it back', setSide(read(null), 'right') && reset().side === 'left');
ok('toggling a module does not move the rail', toggle(setSide(read(null), 'right'), 'search').side === 'right');
ok('and neither does reordering', moveTo(setSide(read(null), 'right'), 0, 2).side === 'right');

// A left-to-right row lays its first item on the left; a right-to-left row lays
// it on the right. So "keep it on the left" is *first* in one and *last* in the
// other, and getting this backwards puts the rail on the wrong edge for every
// Arabic and Kurdish user without anybody who reads English ever seeing it.
ok('left is the first child in a left-to-right window', railFirst('left', 'ltr') === true);
ok('and the last child in a right-to-left one', railFirst('left', 'rtl') === false);
ok('right is the last child in a left-to-right window', railFirst('right', 'ltr') === false);
ok('and the first child in a right-to-left one', railFirst('right', 'rtl') === true);

// ── the second sidebar ────────────────────────────────────────────────────
ok('everything starts beside the rail', ids.every((id) => dockOf(read(null), id) === 'rail'));
{
  const l = dock(read(null), 'outline', 'other');
  ok('a module can be sent to the other side', dockOf(l, 'outline') === 'other');
  ok('and the rest stay', dockOf(l, 'files') === 'rail');
  ok('the other side lists it, in rail order', docked(l, 'other').map((m) => m.id).join() === 'outline');
  ok('and the rail side no longer does', !docked(l, 'rail').some((m) => m.id === 'outline'));
  ok('sending it back works', dockOf(dock(l, 'outline', 'rail'), 'outline') === 'rail');
  ok('docking where it already is changes nothing', dock(l, 'outline', 'other') === l);
  ok('an unknown id changes nothing', dock(l, 'ghost', 'other') === l);
  ok('the dock survives a save and a load', dockOf(read(write(l)), 'outline') === 'other');
  // A switched-off module is not on either side.
  ok('a switched-off module is on neither side', (() => {
    const off = toggle(l, 'outline');
    return !docked(off, 'other').length;
  })());
}
ok('a stored dock naming a module that no longer exists is dropped',
   read('{"right":["ghost","outline"]}').right.join() === 'outline');
ok('reset clears the other side', reset().right.length === 0);
ok('a saved layout from before this field reads as nothing docked',
   read('{"order":[],"off":[]}').right.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
