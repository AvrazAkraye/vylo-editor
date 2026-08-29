// The global shortcut: capturing a chord, writing it down, and reading it back.
//
// Two things here would be quietly wrong in a way nobody notices until the OS
// refuses a binding: an accelerator this side can produce but the Rust side
// cannot parse, and a stored value that is registered without being checked.
// Both get their own section. The rest is about the field behaving like every
// other keybinding recorder people have used.
import {
  accelerator, chordFrom, display, isCancel, KEY, label,
  loadBinding, parse, problem, refusal, saveBinding, SUMMONED,
} from '../.test-build/shortcut.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

/** A keydown, with everything up unless it is named. */
const press = (code, ...held) => ({
  code,
  ctrlKey: held.includes('ctrl'),
  altKey: held.includes('alt'),
  shiftKey: held.includes('shift'),
  metaKey: held.includes('meta'),
});

/** localStorage, small enough to see all of. */
const fakeStore = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
};

// ── capturing a chord ─────────────────────────────────────────────────────
ok('holding a modifier on its own is not yet a chord',
   chordFrom(press('MetaLeft', 'meta')) === null
   && chordFrom(press('ShiftRight', 'shift')) === null
   && chordFrom(press('ControlLeft', 'ctrl')) === null);

ok('a chord is the modifiers held plus the key pressed',
   JSON.stringify(chordFrom(press('Space', 'meta', 'shift')))
   === JSON.stringify({ ctrl: false, alt: false, shift: true, meta: true, code: 'Space' }));

ok('the chord records the physical key, not the character it types',
   chordFrom(press('KeyK', 'alt')).code === 'KeyK');

ok('a key that cannot be a global shortcut is not captured at all',
   chordFrom(press('CapsLock')) === null
   && chordFrom(press('F13', 'ctrl')) === null
   && chordFrom(press('ContextMenu', 'ctrl')) === null
   && chordFrom(press('ScrollLock', 'ctrl')) === null);

ok('every letter, digit and function key up to F12 can be captured',
   [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].every((c) => chordFrom(press(`Key${c}`, 'ctrl')))
   && [0,1,2,3,4,5,6,7,8,9].every((d) => chordFrom(press(`Digit${d}`, 'ctrl')))
   && [1,2,3,4,5,6,7,8,9,10,11,12].every((f) => chordFrom(press(`F${f}`, 'ctrl'))));

// ── Escape leaves rather than binds ───────────────────────────────────────
ok('Escape on its own cancels the recording', isCancel(press('Escape')));
ok('but Escape with a modifier is an ordinary chord',
   !isCancel(press('Escape', 'ctrl')) && chordFrom(press('Escape', 'ctrl')) !== null);
ok('and nothing else cancels', !isCancel(press('KeyK')) && !isCancel(press('Space')));

// ── the accelerator the Rust side parses ──────────────────────────────────
ok('modifiers are written in one fixed order',
   accelerator(chordFrom(press('KeyK', 'meta', 'shift', 'alt', 'ctrl')))
   === 'Control+Alt+Shift+Super+KeyK');

ok('a chord with one modifier is just that modifier and the key',
   accelerator(chordFrom(press('Space', 'meta'))) === 'Super+Space');

ok('the order the modifiers were held in does not change the accelerator',
   accelerator(chordFrom(press('Space', 'shift', 'meta')))
   === accelerator(chordFrom(press('Space', 'meta', 'shift'))));

// Every chord the field can produce has to survive the round trip, or a
// binding shows one thing and answers to another.
{
  const codes = [
    'Space', 'Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'Insert', 'Home', 'End',
    'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon',
    'Quote', 'Backquote', 'Comma', 'Period', 'Slash',
    ...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c) => `Key${c}`),
    ...[0,1,2,3,4,5,6,7,8,9].map((d) => `Digit${d}`),
    ...[1,2,3,4,5,6,7,8,9,10,11,12].map((f) => `F${f}`),
  ];
  const combos = [['ctrl'], ['alt'], ['meta'], ['ctrl', 'shift'], ['meta', 'shift'],
                  ['ctrl', 'alt', 'shift', 'meta']];
  let bad = null;
  for (const code of codes) {
    for (const held of combos) {
      const c = chordFrom(press(code, ...held));
      const a = accelerator(c);
      if (JSON.stringify(parse(a)) !== JSON.stringify(c)) { bad = a; break; }
      if (problem(c)) { bad = a + ' was refused'; break; }
    }
    if (bad) break;
  }
  ok('every chord the field can produce parses back to itself', bad === null, bad);
  ok('and that is 444 of them', codes.length * combos.length === 444);
}

// ── reading an accelerator back ───────────────────────────────────────────
ok('the spellings the plugin accepts are accepted here too',
   JSON.stringify(parse('cmd+shift+space')) === JSON.stringify(parse('Super+Shift+Space'))
   && JSON.stringify(parse('CONTROL+Option+KeyK')) === JSON.stringify(parse('Control+Alt+KeyK')));

ok('a platform-dependent modifier is not read as either one',
   parse('CmdOrCtrl+KeyK') === null);

ok('two keys, no key, or a stray separator is not a chord',
   parse('Control+KeyA+KeyB') === null
   && parse('Control+Shift') === null
   && parse('Control+') === null
   && parse('') === null
   && parse('Control++KeyA') === null);

ok('a key nothing can bind globally is not a chord',
   parse('Control+CapsLock') === null && parse('Control+F13') === null);

// ── what a person sees ────────────────────────────────────────────────────
ok('macOS stacks the symbols in the order Apple does',
   display(chordFrom(press('KeyK', 'ctrl', 'alt', 'shift', 'meta')), true) === '⌃⌥⇧⌘K');

ok('and Windows spells the modifiers out',
   display(chordFrom(press('KeyK', 'ctrl', 'alt', 'shift', 'meta')), false)
   === 'Ctrl+Alt+Shift+Win+K');

ok('the key is named the way it is printed on the keyboard',
   display(chordFrom(press('Backquote', 'meta')), true) === '⌘`'
   && display(chordFrom(press('ArrowUp', 'meta')), true) === '⌘↑'
   && display(chordFrom(press('PageDown', 'ctrl')), false) === 'Ctrl+Page Down'
   && display(chordFrom(press('Digit1', 'meta')), true) === '⌘1');

ok('a stored binding is labelled without going through the keyboard again',
   label('Shift+Super+Space', true) === '⇧⌘Space'
   && label('Control+Shift+Space', false) === 'Ctrl+Shift+Space');

ok('and something that is not a binding is labelled as nothing at all',
   label('CmdOrCtrl+KeyK', true) === '' && label('', true) === '');

// ── what may not be bound ─────────────────────────────────────────────────
ok('a key with no modifier at all is refused',
   problem(chordFrom(press('KeyK'))) !== null && problem(chordFrom(press('F5'))) !== null);

ok('Shift alone does not count as a modifier',
   problem(chordFrom(press('KeyK', 'shift'))) !== null);

ok('Control, Alt or Command each make a chord bindable',
   problem(chordFrom(press('KeyK', 'ctrl'))) === null
   && problem(chordFrom(press('KeyK', 'alt'))) === null
   && problem(chordFrom(press('KeyK', 'meta'))) === null);

ok('the reason given is a sentence, not a code',
   /^[A-Z].*\.$/.test(problem(chordFrom(press('KeyK')))));

// ── explaining a refusal from the OS ──────────────────────────────────────
ok("Windows' already-registered error is explained as something else owning it",
   refusal('HotKey already registered: HotKey { mods: SUPER, key: KeyK, id: 1 }')
   === 'Something else on this machine already uses that combination. Try a different one.');

ok('macOS says only that the registration failed, and that means the same thing',
   refusal('Unable to register hotkey: RegisterEventHotKey failed for Space')
   === 'Something else on this machine already uses that combination. Try a different one.');

ok('a key the OS cannot express is explained as the key, not as a conflict',
   refusal('Unable to register hotkey: Unknown scancode for F21')
   === 'That key cannot be used in a global shortcut.'
   && refusal('could not read "Control+Nope" as a key combination: unsupported key')
   === 'That key cannot be used in a global shortcut.');

ok('and anything unrecognised still gets a sentence',
   refusal('the runtime went away') === 'The system would not accept that combination. Try a different one.');

// ── storage ───────────────────────────────────────────────────────────────
ok('nothing is bound before anything is stored', loadBinding(fakeStore()) === null);

{
  const store = fakeStore();
  saveBinding(store, 'Shift+Super+Space');
  ok('a saved binding comes back', loadBinding(store) === 'Shift+Super+Space');
  saveBinding(store, null);
  ok('and unsetting it removes the value rather than storing an empty one',
     loadBinding(store) === null && store.map.has(KEY) === false);
}

ok('a stored value that would swallow a key everywhere is ignored',
   loadBinding(fakeStore({ [KEY]: 'KeyA' })) === null
   && loadBinding(fakeStore({ [KEY]: 'Shift+KeyA' })) === null);

ok('so is one that is not a chord at all',
   loadBinding(fakeStore({ [KEY]: 'nonsense' })) === null
   && loadBinding(fakeStore({ [KEY]: '' })) === null);

ok('a hand-written binding comes back in the one canonical spelling',
   loadBinding(fakeStore({ [KEY]: 'shift+cmd+space' })) === 'Shift+Super+Space');

{
  const throws = {
    getItem: () => { throw new Error('storage disabled'); },
    setItem: () => { throw new Error('storage disabled'); },
    removeItem: () => { throw new Error('storage disabled'); },
  };
  let threw = false;
  try { saveBinding(throws, 'Super+Space'); } catch { threw = true; }
  ok('a store that refuses to answer leaves the app running',
     loadBinding(throws) === null && !threw);
}

// ── the name both sides use ───────────────────────────────────────────────
ok('the summon event is the literal summon.rs emits', SUMMONED === 'vylo://summon');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
