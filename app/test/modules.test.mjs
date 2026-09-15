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
  MODULES, DEFAULT, INITIAL_ON, KEY, OLD_KEY, migrate, moduleOf, labelOf, read, write, isOn, enabled,
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
ok('the default lists every module, in declaration order',
   DEFAULT.order.join() === ids.join());

// ── what a new window shows ───────────────────────────────────────────────
//
// Four, not fourteen. A rail of everything is a menu to be read before
// anything can be done, and most of it answers questions somebody who has just
// opened a folder has not asked yet.
ok('a new window starts with four sections on',
   enabled(DEFAULT).length === 4, enabled(DEFAULT).map((m) => m.id));
ok('and they are the four that are useful before anything is set up',
   enabled(DEFAULT).map((m) => m.id).sort().join() === ['chats', 'files', 'prompts', 'usage'].join(),
   enabled(DEFAULT).map((m) => m.id));
ok('INITIAL_ON and the off-list are the same statement, not two',
   ids.every((id) => INITIAL_ON.includes(id) !== DEFAULT.off.includes(id)));
ok('every module named in INITIAL_ON exists', INITIAL_ON.every((id) => ids.includes(id)));
// The rail is furniture; the sections it shows are the choice.
ok('nothing is removed, only switched off', DEFAULT.order.length === ids.length);
ok('the first module on is the file tree, which is where the rail opens',
   enabled(DEFAULT)[0].id === 'files');

// ── reading a saved layout ────────────────────────────────────────────────
ok('nothing saved is the default', read(null).order.join() === ids.join());
ok('and nothing saved means the four, not all of them',
   enabled(read(null)).length === 4, enabled(read(null)).map((m) => m.id));
ok('the default is copied, never handed out to be mutated', (() => {
  const a = read(null); a.off.push('files'); a.order.reverse();
  return read(null).off.join() === DEFAULT.off.join()
      && read(null).order.join() === ids.join() && DEFAULT.off.includes('files') === false;
})());
// A layout is a convenience. The cost of a bad one is the default arrangement,
// never a window that will not open.
ok('not JSON is the default', read('{{{').order.join() === ids.join());
ok('a JSON scalar is the default', read('7').order.join() === ids.join());
ok('an empty object is the default', read('{}').order.join() === ids.join());
// An empty `off` is a real choice — everything on — and no layout at all is a
// new window. They want opposite things, so they must not be the same value.
ok('a saved layout with nothing off keeps everything on',
   enabled(read('{"order":[],"off":[]}')).length === ids.length);
ok('while an object with none of these fields is a new window instead',
   enabled(read('{"theme":"dark"}')).length === 4);
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
// Built rather than defaulted: these are about the switch itself, and reading
// them should not require knowing which modules happen to ship on.
const allOn = () => read(JSON.stringify({ order: ids, off: [] }));
{
  const l = allOn();
  ok('everything on is everything on', enabled(l).length === ids.length);
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
  const l = read(null);
  ok('a module that ships off turns on from the default',
     isOn(toggle(l, 'memory'), 'memory') && enabled(toggle(l, 'memory')).length === 5);
  ok('and one that ships on turns off',
     !isOn(toggle(l, 'chats'), 'chats') && enabled(toggle(l, 'chats')).length === 3);
}
{
  // The control is disabled, so reaching here means something else called it —
  // and the useful behaviour is to hold the invariant quietly.
  let l = allOn();
  for (const id of ids.slice(1)) l = toggle(l, id);
  ok('the last module on cannot be turned off', enabled(l).length === 1, l.off);
  ok('and trying returns the layout unchanged', toggle(l, ids[0]) === l);
  ok('isLast says so before the button is pressed', isLast(l, ids[0]) === true);
  ok('and is false while there are two', isLast(read(null), 'files') === false);
  ok('and false for one of the four a new window shows', isLast(read(null), 'chats') === false);
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
  // "Back" is how it ships, which is no longer everything-on — pressing Reset
  // and getting fourteen icons would be a surprise, not a reset.
  ok('reset puts it back to how it ships', (() => {
    const messed = moveTo(toggle(l, 'search'), 5, 0);
    const r = reset();
    return r.order.join() === ids.join()
        && r.off.join() === DEFAULT.off.join()
        && r.side === 'left' && r.right.length === 0
        && messed.order[0] === ids[5];
  })());
}

// ── which section the sidebar shows ───────────────────────────────────────
{
  const l = allOn();
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
  const l = dock(allOn(), 'outline', 'other');
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

// ── the v1 → v2 migration ─────────────────────────────────────────────────
//
// The effect that saves this runs on mount, so everybody who has ever opened
// the app has a v1 entry. Changing the shipping default alone would therefore
// have reached nobody — not one existing window, including the author's. The
// question migration answers is which of those entries were a decision.

ok('the keys are different, and both versioned',
   KEY !== OLD_KEY && /\.v2$/.test(KEY) && /\.v1$/.test(OLD_KEY), [KEY, OLD_KEY]);

ok('nothing stored at all is a new window', enabled(migrate(null, null)).length === 4);

{
  // v1's default: every module on, because that was v1's default — not because
  // anyone looked at fourteen icons and approved of them.
  const v1 = JSON.stringify({ order: ids, off: [], side: 'left', right: [] });
  const m = migrate(null, v1);
  ok('a v1 layout nobody touched becomes the new arrangement',
     enabled(m).map((x) => x.id).sort().join() === ['chats', 'files', 'prompts', 'usage'].join(),
     enabled(m).map((x) => x.id));
}
{
  // …but an arrangement is an arrangement. Someone who moved the rail or sent
  // a panel to the far side did that on purpose, and keeps it.
  const v1 = JSON.stringify({ order: [...ids].reverse(), off: [], side: 'right', right: ['outline'] });
  const m = migrate(null, v1);
  ok('the order they set survives the migration', m.order[0] === ids[ids.length - 1], m.order[0]);
  ok('and the side', m.side === 'right');
  ok('and the far-side dock', m.right.join() === 'outline');
  ok('while the sections still become the new four',
     enabled(m).map((x) => x.id).sort().join() === ['chats', 'files', 'prompts', 'usage'].join());
}
{
  // Somebody who had already switched something off has said what they want.
  const v1 = JSON.stringify({ order: ids, off: ['browser'], side: 'left', right: [] });
  const m = migrate(null, v1);
  ok('a v1 layout with something switched off is left exactly alone',
     m.off.join() === 'browser' && enabled(m).length === ids.length - 1, m.off);
  ok('and is not quietly cut down to four', enabled(m).length > 4);
}
{
  // Once v2 exists it is the only answer; v1 is not consulted again, or the
  // next launch would undo whatever was just chosen.
  const v2 = JSON.stringify({ order: ids, off: [], side: 'left', right: [] });
  const v1 = JSON.stringify({ order: ids, off: ['files'], side: 'right', right: [] });
  const m = migrate(v2, v1);
  ok('v2 wins over v1 whenever it is there',
     enabled(m).length === ids.length && m.side === 'left', [enabled(m).length, m.side]);
}
ok('a corrupt v1 does not stop the app starting, it just starts fresh',
   enabled(migrate(null, '{{{')).length === 4);
ok('and a corrupt v2 does not fall through to v1 either',
   enabled(migrate('{{{', JSON.stringify({ order: ids, off: ['files'] }))).length === 4);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
