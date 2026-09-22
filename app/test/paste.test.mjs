// Pasting a lot of text into a shell.
//
// The hazard is narrow and worth stating: a paste that ends in a newline runs.
// Everything here is about telling that case apart from the ordinary one, and
// about not crying wolf — a confirmation people see for two-line pastes is one
// they learn to dismiss without reading, which is worse than not having it.
import {
  BULK_BYTES, BULK_LINES, DRAG_PATH, head, isAbsolute, isBulk, pathForPrompt, size,
  PATH_INLINE, carry, carrying, describe, isTemporary, landed, pastedFile, summarise,
  under, worthHolding,
} from '../.test-build/paste.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');

// ── what is held and what goes straight through ───────────────────────────
ok('a typed-length command goes straight through', !isBulk('git status'));
ok('so does an empty paste', !isBulk(''));
ok('two lines is a command and its argument, not a blob', !isBulk(lines(2)));
ok('and so is a paste at the line limit', !isBulk(lines(BULK_LINES)), BULK_LINES);
ok('past the limit it is held', isBulk(lines(BULK_LINES + 1)));
ok('a long single line is held on length alone',
   isBulk('x'.repeat(BULK_BYTES)) && !isBulk('x'.repeat(BULK_BYTES - 1)));
// Text copied with the line break at the end is three lines and a return, not
// four — counting it would hold pastes a keystroke short of the threshold.
ok('a trailing newline is not a line of its own',
   !isBulk(`${lines(BULK_LINES)}\n`), `${BULK_LINES} lines + newline`);
ok('carriage returns count the same as newlines',
   isBulk(lines(BULK_LINES + 1).replace(/\n/g, '\r\n')));

// ── what the chip says ────────────────────────────────────────────────────
{
  const s = summarise('one\ntwo\nthree');
  ok('the lines are counted', s.lines === 3, s);
  ok('the first line is what it shows', s.head === 'one', s);
  ok('and it does not run on arrival', s.runs === false, s);
}
{
  const s = summarise('rm -rf /tmp/x\n');
  ok('a trailing newline is the one thing worth warning about', s.runs === true, s);
  ok('and it is still one line', s.lines === 1, s);
}
ok('an empty paste has no lines', summarise('').lines === 0);
ok('bytes are the whole string, newline and all', summarise('ab\n').bytes === 3);
ok('the head is trimmed, so indented text does not show as blank',
   summarise('    indented\nmore').head === 'indented');
ok('\\r\\n is not left on the head',
   summarise('one\r\ntwo').head === 'one', summarise('one\r\ntwo').head);

// ── a size a person reads ─────────────────────────────────────────────────
ok('small pastes are bytes', size(240) === '240 B');
ok('past a thousand it is kilobytes', size(12400) === '12 KB', size(12400));
ok('and past a million, megabytes with one decimal', size(2_400_000) === '2.4 MB', size(2_400_000));
ok('the boundary does not read as 1000 B', size(1000) === '1 KB');

// ── the chip is one line tall, whatever is in it ──────────────────────────
// The strip's height changes the size of the terminal above it, so a chip that
// wrapped would resize the pane it is describing.
ok('a short first line is left alone', head('ls -la\nmore') === 'ls -la');
ok('a long one is cut with an ellipsis', (() => {
  const out = head('x'.repeat(200), 20);
  return out.length === 20 && out.endsWith('…');
})(), head('x'.repeat(200), 20));
ok('cutting never returns more than it was asked for',
   [1, 5, 40, 200].every((w) => head('y'.repeat(500), w).length <= w));

// ── a file dragged onto a pane ────────────────────────────────────────────
//
// The explorer knows paths relative to the folder it is showing; a shell knows
// wherever it happens to be. Between the two is this.

ok('the drag type is its own, not just text', DRAG_PATH.startsWith('application/'));

ok('a unix path is absolute', isAbsolute('/Users/me/App.js'));
ok('a windows path is too', isAbsolute('C:\\Users\\me\\App.js'));
ok('and a UNC share', isAbsolute('\\\\server\\share\\x'));
ok('a tree path is not', !isAbsolute('src/App.js'));
ok('nor is an empty one', !isAbsolute(''));

ok('a tree path resolves against the open folder',
   under('/Users/me/vylo', 'src/App.js') === '/Users/me/vylo/src/App.js');
ok('a trailing slash on the folder does not double up',
   under('/Users/me/vylo/', 'App.js') === '/Users/me/vylo/App.js');
ok('an absolute path is left alone', under('/Users/me/vylo', '/tmp/x') === '/tmp/x');
ok('and with no folder there is nothing to resolve against',
   under('', 'App.js') === 'App.js');

// What a person would have typed, which is the point.
ok('a file in the shell\'s own directory is typed relative',
   pathForPrompt('/Users/me/vylo/App.js', '/Users/me/vylo') === 'App.js');
ok('and one further down keeps its middle',
   pathForPrompt('/Users/me/vylo/src/App.js', '/Users/me/vylo') === 'src/App.js');
// A relative path that climbs out is longer than the absolute one and harder
// to check, and checking it is why the path is shown before it is run.
ok('a file outside it is typed in full',
   pathForPrompt('/tmp/x.txt', '/Users/me/vylo') === '/tmp/x.txt');
ok('a sibling folder is not reached by climbing',
   pathForPrompt('/Users/me/other/x', '/Users/me/vylo') === '/Users/me/other/x');
// A near-miss that a plain startsWith would get wrong.
ok('a folder whose name merely starts the same is outside',
   pathForPrompt('/Users/me/vylo-old/x', '/Users/me/vylo') === '/Users/me/vylo-old/x');
ok('the directory itself is `.`, which is a real argument',
   pathForPrompt('/Users/me/vylo', '/Users/me/vylo') === '.');
ok('a trailing slash on the shell\'s directory changes nothing',
   pathForPrompt('/Users/me/vylo/App.js', '/Users/me/vylo/') === 'App.js');
ok('with no directory known, the path is left as it is',
   pathForPrompt('/Users/me/vylo/App.js', '') === '/Users/me/vylo/App.js');

// ── an image on the clipboard ─────────────────────────────────────────────
//
// Copying a screenshot does not put a picture on the clipboard as far as a web
// view is concerned: macOS writes the file somewhere temporary and puts its
// path there as text. The reported case, verbatim:
const SHOT = '/var/folders/xy/8dln245503q9ggr8xjj13y840000gn/T/TemporaryItems/'
  + 'NSIRD_screencaptureui_VMsUO4/Screenshot 2026-09-16 at 8.59.24 PM.png';
{
  const f = pastedFile(SHOT);
  ok('a pasted screenshot is recognised as a file', f !== null, f);
  ok('and as a picture', f.image === true);
  ok('the name is what a person recognises it by',
     f.name === 'Screenshot 2026-09-16 at 8.59.24 PM.png', f.name);
  // A command written against it works today and not tomorrow, and the chip
  // is the only place that can say so.
  ok('and it is known to be temporary', f.temporary === true);
  ok('spaces in the name do not break it', f.path === SHOT);
}
ok('an ordinary file is a file but not a picture', (() => {
  const f = pastedFile('/Users/me/vylo/README.md');
  return f !== null && f.image === false && f.temporary === false;
})());
ok('a path in /tmp is temporary too', pastedFile('/tmp/x.png').temporary === true);
ok('case does not decide the extension', pastedFile('/a/B.PNG').image === true);

// Narrow on purpose: a chip over an ordinary paste is a step somebody has to
// dismiss to do what they meant.
ok('prose is not a path', pastedFile('the file is in /Users/me/vylo') === null);
ok('anything with a line break is not a path', pastedFile('/a/b.png\nrm -rf /') === null);
ok('a relative path is not enough to be sure', pastedFile('src/App.js') === null);
ok('nor is a folder, which has no extension', pastedFile('/Users/me/vylo') === null);
ok('nor a bare separator', pastedFile('/') === null);
ok('an empty paste is nothing', pastedFile('   ') === null);
ok('a windows path works the same', (() => {
  const f = pastedFile('C:\\Users\\me\\Pictures\\shot.png');
  return f !== null && f.image === true && f.name === 'shot.png';
})(), pastedFile('C:\\Users\\me\\Pictures\\shot.png'));
ok('a dotfile is not an extension', pastedFile('/Users/me/.zshrc') === null);

// ── what is worth looking at before it lands ──────────────────────────────
//
// A rule about the text, not about where it came from. A rule about the source
// would have to say why dragging a file out of the explorer is different from
// dragging the same file out of Finder, and it is not.

ok('a screenshot off the desktop is held — it is temporary', worthHolding(SHOT));
ok('and so is anything too long to read on a line',
   worthHolding(`/${'x'.repeat(PATH_INLINE)}`) && !worthHolding(`/${'x'.repeat(PATH_INLINE - 2)}`));
// A chip over `App.js` is a step somebody has to clear to do what the drag
// already said.
ok('a short permanent path lands in one gesture',
   !worthHolding('/Users/me/vylo/App.js'));
ok('a project file dragged from the explorer is not held', !worthHolding('src/App.js'));
ok('temporariness is about the place, not the name',
   isTemporary('/tmp/notes.txt') && !isTemporary('/Users/me/tmp-notes.txt'));
ok('and the windows temp directory counts',
   isTemporary('C:\\Users\\me\\AppData\\Local\\Temp\\x.png'));

// `describe` answers for anything that came off a file system, where there is
// nothing to guess about — unlike `pastedFile`, which has to be sure.
{
  const d = describe('/Users/me/Pictures/holiday.JPG');
  ok('a dragged file is described without guessing', d.image === true && d.name === 'holiday.JPG');
}
ok('a folder is describable even with no extension', (() => {
  const d = describe('/Users/me/vylo/src');
  return d.name === 'src' && d.image === false;
})());
ok('a trailing slash does not make the name empty', describe('/Users/me/vylo/').name === 'vylo');
// The narrow one still refuses what it cannot be sure of.
ok('describe answers where pastedFile declines',
   describe('/Users/me/vylo').name === 'vylo' && pastedFile('/Users/me/vylo') === null);

// ── the in-app drag register ──────────────────────────────────────────────
//
// Why this exists at all: a drag from the file tree to a terminal sets
// `dataTransfer` and that should be the whole story. On macOS it is not — the
// drag travels over the system pasteboard, Tauri's handler takes the drop
// before the webview sees it, and the `drop` event never fires. What arrives
// instead carries no paths, because no files were involved. The bug that was
// reported is exactly that: the pane lights up, the strip appears, letting go
// does nothing, and the highlight stays on.
ok('nothing is being carried to begin with', (() => { landed(); return carrying() === null; })());
ok('a path can be carried', (() => { carry('path', '/x/y.ts'); return carrying().kind === 'path'; })());
ok('and read back whole', carrying().value === '/x/y.ts');
// Peeking must not empty it: the hover asks repeatedly while the drop asks once.
ok('peeking does not take it', carrying() !== null && carrying() !== null);
ok('landing takes it', (() => {
  const got = landed();
  return got.kind === 'path' && got.value === '/x/y.ts';
})());
ok('and leaves nothing behind', carrying() === null);
// Whoever handles the drop calls this, and the other path then finds nothing —
// which is what stops both of them doing the same work on a platform where the
// webview does get its own drop event.
ok('landing twice is null the second time', landed() === null);

ok('a pane can be carried too', (() => {
  carry('pane', 't3');
  const got = landed();
  return got.kind === 'pane' && got.value === 't3';
})());
ok('a new drag replaces the last', (() => {
  carry('path', '/one');
  carry('pane', 't9');
  const got = landed();
  return got.kind === 'pane' && got.value === 't9';
})());
// A drag that carries nothing is not a drag: `''` would otherwise land as a
// path the terminal would try to type.
ok('an empty value carries nothing', (() => { carry('path', ''); return carrying() === null; })());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
