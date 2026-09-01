// One field that searches everything.
//
// Two things are being pinned here, and the second one is the reason the module
// exists.
//
// The first is the plumbing: each prefix narrows to the kind it names, an empty
// query still answers with something, a source the app has not loaded yet is
// absent rather than a crash, and `#` — the one query that reads the disk —
// says so before anything is spent on it.
//
// The second is the order *between* the groups. Every kind here already had a
// matcher and none of them changed; what is new is which group comes first, and
// that is the whole difference between a field that feels like it read your
// mind and one that makes you scroll. So the ordering cases are written as the
// sentences they are meant to satisfy: an exact filename beats a fuzzy symbol,
// a word that *is* a setting's name beats a file that merely starts with it,
// and a query that starts a command is somebody naming an action rather than
// hunting for a file.
import {
  HEADING, diskState, everywhere, parse,
} from '../.test-build/everywhere.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
};

/** English: the translator the app hands out when the language is `en`. */
const en = (s) => s;

const kinds = (r) => r.groups.map((g) => g.kind);
const groupOf = (r, kind) => r.groups.find((g) => g.kind === kind);
const titles = (r, kind) => (groupOf(r, kind)?.results ?? []).map((x) => x.title);
const first = (r) => r.groups[0]?.kind;

// ── the fixture ───────────────────────────────────────────────────────────
//
// Deliberately shaped like this repository, because the ordering questions only
// have obvious answers on realistic names: a file whose basename is exactly a
// word, a symbol that contains that word in the middle, a setting whose label
// is the word itself.

const chat = (id, title, said, updatedAt = 1) => ({
  id, folder: '/p', title, updatedAt, history: [],
  lines: said.map((text) => ({ kind: 'you', text })),
});

const FILES = [
  'README',
  'src/App.tsx',
  'src/theme.ts',
  'src/Palette.tsx',
  'src/openFile.ts',
  'src/FolderTree.tsx',
  'docs/BACKLOG.md',
];

const SYMBOLS = [
  { name: 'renderPalette', kind: 'function', path: 'src/Palette.tsx', line: 12 },
  { name: 'unreadMessages', kind: 'const', path: 'src/chat.ts', line: 40 },
  { name: 'themeToggle', kind: 'function', path: 'src/theme.ts', line: 7 },
];

const CHATS = [
  chat('c1', 'Why is the theme flickering', ['the readme needs a section too'], 3),
  chat('c2', 'Add the export button', ['open the folder first'], 2),
];

const SESSIONS = [
  { id: 't1', n: 1, born: 0, dead: false },
  { id: 't2', n: 2, born: 0, dead: true, code: 0, command: 'npm test' },
];

const COMMANDS = [
  { id: 'openFolder', label: 'Open folder…', keys: '⌘O', keywords: ['project'] },
  { id: 'goToFile', label: 'Go to file', keys: '⌘P' },
  { id: 'saveFile', label: 'Save the open file', keys: '⌘S' },
  { id: 'toggleTerminal', label: 'Terminal', keys: '⌃`' },
];

const HITS = [
  { path: 'src/App.tsx', line: 120, text: '  // TODO: the header field' },
  { path: 'src/theme.ts', line: 4, text: 'const TODO = 1;' },
];

const src = (over = {}) => ({
  files: FILES, symbols: SYMBOLS, chats: CHATS, sessions: SESSIONS,
  commands: COMMANDS, active: 'src/App.tsx', t: en, ...over,
});

// ── parsing ───────────────────────────────────────────────────────────────
{
  ok('a bare query has no prefix', parse('theme').prefix === '' && parse('theme').term === 'theme');
  for (const [p, term] of [['>', 'save'], ['@', 'render'], ['#', 'todo'], [':', '']]) {
    const got = parse(`${p}save`.replace('save', p === ':' ? '42' : term || 'x'));
    ok(`${p} is read as a prefix`, got.prefix === p, JSON.stringify(got));
  }
  ok('the prefix is stripped off the term', parse('>save').term === 'save');
  ok('space between the prefix and the term is allowed', parse('>  save').term === 'save');
  ok('a colon takes a line number', parse(':42').line === 42 && parse(':42').term === '');
  ok('a colon with something that is not a number sets no line', parse(':x').line === null);
  ok('a trailing :42 comes off any query',
     parse('App.tsx:42').term === 'App.tsx' && parse('App.tsx:42').line === 42);
  ok('and only when it is digits at the very end', parse('http://x').line === null);
  ok('a query of nothing but spaces parses as empty',
     parse('   ').term === '' && parse('   ').prefix === '' && parse('   ').line === null);
}

// ── the flag that decides whether a keystroke costs a walk of the project ──
{
  ok('# with a term needs the disk', parse('#todo').needsDisk === true);
  ok('# alone does not — there is nothing to grep for', parse('#').needsDisk === false);
  ok('# with only spaces after it does not either', parse('#   ').needsDisk === false);
  for (const q of ['', '   ', 'theme', '>save', '@render', ':42', 'App.tsx:42']) {
    ok(`${JSON.stringify(q)} is answerable from memory`, parse(q).needsDisk === false);
  }
  ok('the flag is on the result too, so one call answers both',
     everywhere('#todo', src()).needsDisk === true);
}

// ── and what the field is allowed to do about it ──────────────────────────
//
// The flag alone is not enough, and the gap between the two wedged the palette:
// "have we searched?" stays true for ever after the first Enter, so a `#` query
// edited by one character had no hits, no way to fetch any, and nothing on
// screen saying so. Hits answer the term they were fetched for; that is the
// question, and these are the four states it has.
{
  const of = (q, found, busy = false) => diskState(parse(q), found, busy);

  ok('a bare query spends nothing', of('theme', null) === 'free');
  for (const q of ['', '>save', '@render', ':42', 'App.tsx:42', '#', '#  ']) {
    ok(`${JSON.stringify(q)} is free`, of(q, null) === 'free');
  }

  ok('# with a term and nothing in hand asks first', of('#todo', null) === 'ask');
  ok('and says so rather than firing on the keystroke', of('#todo', null) !== 'searching');
  ok('a walk in flight is not another Enter', of('#todo', null, true) === 'searching');
  ok('hits for this exact term are the answer',
     of('#todo', { term: 'todo' }) === 'answered');

  // The one that was wrong. Every character typed after a search leaves hits
  // that answer the *previous* term, and the palette has to be able to go and
  // get the new ones.
  ok('one more character asks again rather than showing the old answer',
     of('#todos', { term: 'todo' }) === 'ask');
  ok('and so does one fewer', of('#tod', { term: 'todo' }) === 'ask');
  ok('a different term entirely asks again',
     of('#render', { term: 'todo' }) === 'ask');
  ok('a search that found nothing still counts as answered — that is the news',
     of('#nothinghere', { term: 'nothinghere', hits: [] }) === 'answered');
  ok('the term is compared parsed, not as typed, so spacing is not a new query',
     of('#  todo  ', { term: 'todo' }) === 'answered');
  // Leaving `#` for a bare query must not leave the field thinking it owes a
  // walk: there is nothing to spend on a query that reads no disk.
  ok('dropping the # frees it again, whatever is held',
     of('todo', { term: 'todo' }) === 'free');
}

// ── each prefix narrows to one kind ───────────────────────────────────────
{
  const r = everywhere('>save', src());
  ok('> narrows to commands', JSON.stringify(kinds(r)) === '["command"]', JSON.stringify(kinds(r)));
  ok('and finds the one it names', titles(r, 'command').includes('Save the open file'));
  ok('Enter on a command carries its id',
     groupOf(r, 'command').results[0].target.go === 'command'
     && groupOf(r, 'command').results[0].target.id === 'saveFile');
}
{
  const r = everywhere('@render', src());
  ok('@ narrows to symbols', JSON.stringify(kinds(r)) === '["symbol"]', JSON.stringify(kinds(r)));
  const hit = groupOf(r, 'symbol').results[0];
  ok('a symbol opens its file at its line',
     hit.target.go === 'file' && hit.target.path === 'src/Palette.tsx' && hit.target.line === 12);
  ok('and carries its kind as the tag the palette already draws', hit.tag === 'function');
}
{
  const r = everywhere('#todo', src());
  ok('# with no hits yet is empty rather than wrong', r.total === 0 && r.groups.length === 0);
  const done = everywhere('#todo', src({ hits: HITS }));
  ok('# narrows to the text group once the caller has searched',
     JSON.stringify(kinds(done)) === '["text"]', JSON.stringify(kinds(done)));
  ok('a text hit is the source line, set in the mono face',
     done.groups[0].results[0].title === '// TODO: the header field'
     && done.groups[0].results[0].mono === true);
  ok('and opens the file at the line it was found on',
     done.groups[0].results[0].target.line === 120);
}
{
  const r = everywhere(':42', src());
  ok(': narrows to one line row', JSON.stringify(kinds(r)) === '["line"]', JSON.stringify(kinds(r)));
  ok('which is the open file at that line',
     r.groups[0].results[0].target.path === 'src/App.tsx'
     && r.groups[0].results[0].target.line === 42);
  ok('with nothing open there is no line 42 of anything, and it says so',
     everywhere(':42', src({ active: null })).total === 0);
}
{
  const r = everywhere('App.tsx:42', src());
  ok('a line typed on the end of a file query rides along',
     groupOf(r, 'file').results[0].target.line === 42);
  ok('and the file is still found by the part in front of the colon',
     groupOf(r, 'file').results[0].title === 'App.tsx');
}

// ── a prefix with nothing after it ────────────────────────────────────────
{
  const r = everywhere('>', src());
  ok('> alone lists every command', titles(r, 'command').length === COMMANDS.length);
  ok('and nothing else', JSON.stringify(kinds(r)) === '["command"]');

  const s = everywhere('@', src());
  ok('@ alone lists every symbol', titles(s, 'symbol').length === SYMBOLS.length);

  // `#` and `:` have no list of their own to show, so they fall back to what an
  // empty query shows rather than to an empty palette.
  const h = everywhere('#', src());
  ok('# alone reads no disk and still answers with something',
     h.needsDisk === false && h.total > 0, JSON.stringify(kinds(h)));
  const c = everywhere(':', src());
  ok(': alone answers the same way', c.total > 0, JSON.stringify(kinds(c)));
}

// ── the empty query ───────────────────────────────────────────────────────
//
// A palette that opens empty looks broken. This is the case that decides
// whether the field is usable before a single character is typed.
{
  const r = everywhere('', src());
  ok('an empty query returns something', r.total > 0);
  ok('and it is the four kinds that mean anything unranked',
     JSON.stringify(kinds(r)) === '["command","chat","terminal","file"]', JSON.stringify(kinds(r)));
  ok('symbols are left out — a slice of the index in index order answers nothing',
     !groupOf(r, 'symbol'));
  ok('and settings are, because that is just the Settings dialog', !groupOf(r, 'setting'));
  ok('a query of nothing but spaces is the same thing',
     JSON.stringify(kinds(everywhere('    ', src()))) === JSON.stringify(kinds(r)));
  ok('each group is capped to its share of a shared palette',
     r.groups.every((g) => g.results.length <= 8));
  ok('every group has rows — an empty one is left out, not drawn',
     r.groups.every((g) => g.results.length > 0));
}

// ── a source the app has not loaded yet ───────────────────────────────────
{
  const bare = { t: en };
  ok('nothing loaded and an empty query is empty, not a crash',
     everywhere('', bare).total === 0 && everywhere('', bare).groups.length === 0);
  // Settings are the one source that is not loaded: `settings.ts` is a compiled
  // catalogue, so it answers before a folder has even been opened. Everything
  // else is absent rather than empty.
  ok('nothing loaded still finds a setting, because that catalogue is compiled in',
     JSON.stringify(kinds(everywhere('theme', bare))) === '["setting"]',
     JSON.stringify(kinds(everywhere('theme', bare))));
  ok('a prefix over an empty source is empty too',
     everywhere('>open', bare).total === 0 && everywhere('@x', bare).total === 0);
  ok('one empty source does not remove the others',
     groupOf(everywhere('theme', src({ symbols: [], files: [] })), 'setting') !== undefined);
  ok('and a chat store that is empty leaves the rest alone',
     everywhere('', src({ chats: [] })).total > 0);
}

// ── three kinds at once, and the order between them ───────────────────────
//
// `theme` is in four of the six sources: the Theme setting, `src/theme.ts`,
// `themeToggle`, and a chat titled "Why is the theme flickering". The order is
// the module's whole argument.
{
  const r = everywhere('theme', src());
  ok('theme matches four kinds at once', r.groups.length === 4, JSON.stringify(kinds(r)));
  ok('the setting whose label IS the word comes first, above the file that merely starts with it',
     JSON.stringify(kinds(r)) === '["setting","file","symbol","chat"]', JSON.stringify(kinds(r)));
  ok('the file group is the file that starts with it', titles(r, 'file')[0] === 'theme.ts');
  ok('the chat came back on a word in its title, not its body',
     titles(r, 'chat')[0] === 'Why is the theme flickering');
  ok('and Enter on a setting names the row and the rail to open it on',
     groupOf(r, 'setting').results[0].target.go === 'setting'
     && groupOf(r, 'setting').results[0].target.id === 'theme'
     && groupOf(r, 'setting').results[0].target.category === 'appearance');
}
{
  // The rule stated on its own: an exact filename beats a fuzzy symbol. `README`
  // is a file by that exact name; `unreadMessages` contains the same letters in
  // the same order and is a perfectly good subsequence match.
  const r = everywhere('readme', src());
  ok('an exact filename beats a fuzzy symbol', first(r) === 'file', JSON.stringify(kinds(r)));
  ok('the symbol is still there, underneath it', titles(r, 'symbol').includes('unreadMessages'));
  ok('and so is the chat that said it in passing',
     (groupOf(r, 'chat')?.results ?? []).length === 1);
}
{
  // And the same query with the exact file taken away: the fuzzy symbol is now
  // the best claim anybody has, so it goes to the top. The ordering is a
  // property of the matches, not a fixed ranking of kinds.
  const r = everywhere('readme', src({ files: FILES.filter((f) => f !== 'README') }));
  ok('with no exact filename the fuzzy symbol leads', first(r) === 'symbol', JSON.stringify(kinds(r)));
}

// ── a command near the top when the query starts one ──────────────────────
{
  const r = everywhere('open', src());
  ok('a query that starts a command label puts commands first',
     first(r) === 'command', JSON.stringify(kinds(r)));
  ok('and the command it starts is the first row', titles(r, 'command')[0] === 'Open folder…');
  ok('the file that also starts with it is still there, below',
     titles(r, 'file').includes('openFile.ts'));
}
{
  // The other half of the rule. "folder" is inside a command label but does not
  // begin it, so there is no verb to lift: the file wins on its own merits.
  const r = everywhere('folder', src());
  ok('a word from the middle of a command label does not lift it',
     first(r) === 'file', JSON.stringify(kinds(r)));
  ok('the command is still found, just not promoted',
     titles(r, 'command').includes('Open folder…'));
}
{
  // The lift is not a licence. An exact match of another kind still wins.
  const r = everywhere('terminal', src());
  ok('an exactly-named command wins outright', first(r) === 'command');
  // And each source still answers for itself: `terminals.ts` matches a shell on
  // its name and a command pane on its command, so only the shell comes back.
  ok('the shell named Terminal 1 comes with it',
     JSON.stringify(titles(r, 'terminal')) === '["Terminal 1"]', JSON.stringify(titles(r, 'terminal')));
}

// ── terminal sessions keep what terminals.ts says about them ──────────────
{
  const r = everywhere('npm', src());
  const row = groupOf(r, 'terminal').results[0];
  ok('a command pane is found by the command it ran', row.title === 'npm test');
  ok('and its title is set as a string that ran, not a name', row.mono === true);
  ok('its state rides along as the tag', row.tag === 'ok');
  ok('Enter on it names the session', row.target.go === 'terminal' && row.target.id === 't2');
  ok('the translated word Terminal is what a shell is searched by',
     everywhere('تێرمینال', src({ term: 'تێرمینال' })).total > 0);
}

// ── chats keep what store.ts says about them ──────────────────────────────
{
  const r = everywhere('folder first', src());
  const row = groupOf(r, 'chat').results[0];
  ok('a chat is found by a line in its body', row.target.id === 'c2');
  ok('and the line that matched is the reason shown', row.detail === 'open the folder first');
  ok('a chat found by its title carries no snippet',
     groupOf(everywhere('flickering', src()), 'chat').results[0].detail === undefined);
}

// ── folding, because a third of this app's languages are written in Arabic ─
//
// `settings.ts` owns the fold and this module imports it rather than writing a
// second. These are the two spellings that fold together in practice: the marks
// a keyboard emits and a reader does not count as letters, and the yeh and kaf
// that Arabic and Kurdish write differently for the same sound.
{
  const AR = { Theme: 'المظهر', Language: 'زمانی ڕووکار' };
  const ar = (s) => AR[s] ?? s;
  const arabic = (over = {}) => src({ t: ar, ...over });

  const marks = everywhere('المَظهر', arabic());
  ok('a query typed with harakat finds the setting spelled without them',
     titles(marks, 'setting').includes('المظهر'), JSON.stringify(titles(marks, 'setting')));

  const yeh = everywhere('زماني', arabic());
  ok('an Arabic yeh finds a Kurdish one — the same word from a different keyboard',
     titles(yeh, 'setting').includes('زمانی ڕووکار'), JSON.stringify(titles(yeh, 'setting')));

  // And the fold applies to the commands this module matches itself, not only
  // to the sources that already folded.
  const cmds = [{ id: 'find', label: 'گەڕان' }];
  const tatweel = everywhere('گەڕــان', src({ commands: cmds }));
  ok('a tatweel stretched into a command label folds away',
     titles(tatweel, 'command').includes('گەڕان'), JSON.stringify(titles(tatweel, 'command')));

  // The tiering folds too, or an Arabic exact match would rank as a fuzzy one.
  const exact = everywhere('المظهر', arabic());
  ok('an exact match in Arabic is an exact match', first(exact) === 'setting');
}

// ── caps ──────────────────────────────────────────────────────────────────
{
  const many = Array.from({ length: 400 }, (_, i) => `src/thing${i}.ts`);
  const shared = everywhere('thing', src({ files: many }));
  ok('a group sharing the palette is capped at eight',
     groupOf(shared, 'file').results.length === 8);
  const alone = everywhere('@x', src({ symbols: [] }));
  ok('and a group that has the palette to itself is not capped at eight',
     alone.total === 0);
  const symbolsMany = Array.from({ length: 400 }, (_, i) => (
    { name: `thing${i}`, kind: 'const', path: 'src/a.ts', line: i }));
  ok('the sole group gets the panel’s own limit instead',
     everywhere('@thing', src({ symbols: symbolsMany })).total === 200);
}

// ── the shape the caller renders ──────────────────────────────────────────
{
  const r = everywhere('theme', src());
  ok('every group carries an English heading for the caller to translate',
     r.groups.every((g) => g.label === HEADING[g.kind] && g.label.length > 0));
  const rows = r.groups.flatMap((g) => g.results);
  ok('every row has a key', rows.every((x) => typeof x.key === 'string' && x.key.length > 0));
  ok('and the keys are unique, so React can draw them',
     new Set(rows.map((x) => x.key)).size === rows.length);
  ok('every row has a title', rows.every((x) => typeof x.title === 'string' && x.title.length > 0));
  ok('and every row says what Enter does',
     rows.every((x) => ['file', 'chat', 'terminal', 'setting', 'command'].includes(x.target.go)));
  ok('the total is the rows', r.total === rows.length);
  ok('the query comes back as typed, for the highlighter', r.query === 'theme');
  ok('there is a heading for every kind',
     ['command', 'file', 'symbol', 'text', 'line', 'chat', 'terminal', 'setting']
       .every((k) => typeof HEADING[k] === 'string' && HEADING[k].length > 0));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
