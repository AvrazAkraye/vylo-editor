// The open tabs, per folder, across a restart.
//
// Restoring work has one property that decides whether the feature is welcome
// or annoying: it must never announce a problem. A file deleted last week, a
// value some other version of the app wrote, storage switched off entirely —
// all of those have to come out the far end as "fewer tabs", never as an error
// on the first screen of the session. Most of what is here is about that.
import {
  KEY, MAX_TABS, MAX_FOLDERS, NO_TABS,
  loadWorkspace, saveWorkspace, keepExisting, loadChatOrder, saveChatOrder,
} from '../.test-build/workspace.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

/** localStorage in three lines, plus a way to put something odd in it. */
const store = (raw) => {
  const map = new Map();
  if (raw !== undefined) map.set(KEY, raw);
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
};

const raw = (s) => JSON.parse(s.map.get(KEY) ?? 'null');
const paths = (ws) => ws.tabs.map((x) => x.path);
const T = (path, line = 1) => ({ path, line });

// ── a folder never opened ─────────────────────────────────────────────────
{
  const s = store();
  const ws = loadWorkspace(s, '/Users/me/fresh');
  ok('a folder nobody has opened has nothing to restore',
     ws.tabs.length === 0 && ws.active === null, ws);
  ok('and reading it writes nothing', s.map.size === 0);

  saveWorkspace(s, '/Users/me/other', { tabs: [T('a.ts')], active: 'a.ts' });
  ok('a folder that is not the one that was saved is still empty',
     loadWorkspace(s, '/Users/me/fresh').tabs.length === 0);
}

// ── the round trip ────────────────────────────────────────────────────────
{
  const s = store();
  const folder = '/Users/me/proj';
  saveWorkspace(s, folder, {
    tabs: [T('src/App.tsx', 412), T('src/store.ts', 7), T('docs/BACKLOG.md', 1)],
    active: 'src/store.ts',
  });
  const back = loadWorkspace(s, folder);
  ok('the tabs come back in the order they were opened',
     paths(back).join() === 'src/App.tsx,src/store.ts,docs/BACKLOG.md', paths(back));
  ok('the tab that was showing comes back with them', back.active === 'src/store.ts');
  ok('and each tab keeps its own caret line',
     back.tabs.map((x) => x.line).join() === '412,7,1', back.tabs);
}
{
  // The chat is not a file, so the app hands over null rather than inventing a
  // path for it.
  const s = store();
  saveWorkspace(s, '/p', { tabs: [T('a.ts', 3)], active: null });
  const back = loadWorkspace(s, '/p');
  ok('the chat being on top is remembered as no file at all',
     back.active === null && back.tabs.length === 1, back);
}

// ── the same file open in two folders ─────────────────────────────────────
{
  const s = store();
  saveWorkspace(s, '/work/alpha', { tabs: [T('src/index.ts', 90)], active: 'src/index.ts' });
  saveWorkspace(s, '/work/beta', { tabs: [T('src/index.ts', 4), T('README.md', 12)], active: 'README.md' });

  const a = loadWorkspace(s, '/work/alpha');
  const b = loadWorkspace(s, '/work/beta');
  ok('the same path in two folders is two separate tabs',
     a.tabs[0].line === 90 && b.tabs[0].line === 4, [a, b]);
  ok('and the two folders keep their own active tab',
     a.active === 'src/index.ts' && b.active === 'README.md', [a.active, b.active]);

  saveWorkspace(s, '/work/beta', { tabs: [], active: null });
  ok('closing everything in one folder leaves the other alone',
     loadWorkspace(s, '/work/alpha').tabs.length === 1
     && loadWorkspace(s, '/work/beta').tabs.length === 0);
}

// ── a file that has since been deleted ────────────────────────────────────
{
  const ws = {
    tabs: [T('a.ts', 5), T('gone.ts', 20), T('b.ts', 8)],
    active: 'b.ts',
  };
  const here = new Set(['a.ts', 'b.ts']);
  const kept = keepExisting(ws, (p) => here.has(p));
  ok('a file that no longer exists is dropped rather than reported',
     paths(kept).join() === 'a.ts,b.ts', paths(kept));
  ok('the survivors keep their order and their lines',
     kept.tabs[0].line === 5 && kept.tabs[1].line === 8, kept.tabs);
  ok('and the tab you were on is untouched', kept.active === 'b.ts');
}
{
  const ws = { tabs: [T('a.ts'), T('gone.ts'), T('b.ts')], active: 'gone.ts' };
  const kept = keepExisting(ws, (p) => p !== 'gone.ts');
  ok('losing the file you were looking at lands you on one that is still there',
     kept.active === 'a.ts', kept);
}
{
  const ws = { tabs: [T('a.ts'), T('b.ts')], active: null };
  const kept = keepExisting(ws, (p) => p === 'a.ts');
  ok('but a session that ended on the chat still starts on the chat',
     kept.active === null && paths(kept).join() === 'a.ts', kept);
}
{
  const ws = { tabs: [T('a.ts'), T('b.ts')], active: 'a.ts' };
  const kept = keepExisting(ws, () => false);
  ok('when every file is gone there is nothing to restore',
     kept.tabs.length === 0 && kept.active === null, kept);
}
{
  const ws = { tabs: [T('a.ts'), T('b.ts')], active: 'a.ts' };
  ok('and when nothing is missing the same object comes back',
     keepExisting(ws, () => true) === ws);
}

// ── a stored value that is absent, corrupt, or somebody else's ────────────
{
  ok('no stored value reads as an empty workspace',
     loadWorkspace(store(), '/p') === NO_TABS);
  ok('a value that is not JSON is ignored rather than thrown',
     loadWorkspace(store('{ this is not json'), '/p').tabs.length === 0);
  ok('a value that is JSON but not an object is ignored',
     loadWorkspace(store('["a.ts"]'), '/p').tabs.length === 0);
  ok('null is ignored', loadWorkspace(store('null'), '/p').tabs.length === 0);
  ok('a folder entry that is not an object is ignored',
     loadWorkspace(store('{"/p": 7}'), '/p').tabs.length === 0);
  ok('a tab list that is not a list is ignored',
     loadWorkspace(store('{"/p":{"tabs":"a.ts","active":null}}'), '/p').tabs.length === 0);
}
{
  const s = store('{"/p":{"tabs":[null,"a.ts",{"path":"real.ts","line":9},{"line":3}],"active":"real.ts"}}');
  const ws = loadWorkspace(s, '/p');
  ok('entries that are not tabs are skipped and the real one survives',
     paths(ws).join() === 'real.ts' && ws.tabs[0].line === 9, ws);
}
{
  const s = store('{"/p":{"tabs":[{"path":"a.ts","line":"forty"},{"path":"b.ts","line":0},{"path":"c.ts","line":-3},{"path":"d.ts"},{"path":"e.ts","line":12.7}],"active":null}}');
  const ws = loadWorkspace(s, '/p');
  ok('a line that is not a line opens the file at the top',
     ws.tabs.slice(0, 4).every((x) => x.line === 1), ws.tabs);
  ok('and a fractional line is a whole line', ws.tabs[4].line === 12, ws.tabs[4]);
}
{
  const s = store('{"/p":{"tabs":[{"path":"a.ts","line":1}],"active":"nowhere.ts"}}');
  ok('an active tab that is not in the list is dropped',
     loadWorkspace(s, '/p').active === null);
}
{
  const s = store('{"/p":{"tabs":[{"path":"a.ts","line":4},{"path":"a.ts","line":90}],"active":"a.ts"}}');
  const ws = loadWorkspace(s, '/p');
  ok('one file cannot be two tabs',
     ws.tabs.length === 1 && ws.tabs[0].line === 4, ws.tabs);
}
{
  // Storage can be off entirely, and then even reading raises.
  const angry = {
    getItem() { throw new Error('site data blocked'); },
    setItem() { throw new Error('site data blocked'); },
    removeItem() { throw new Error('site data blocked'); },
  };
  let threw = false;
  try {
    ok('storage that refuses to be read is an empty workspace',
       loadWorkspace(angry, '/p').tabs.length === 0);
    saveWorkspace(angry, '/p', { tabs: [T('a.ts')], active: 'a.ts' });
    saveWorkspace(angry, '/p', { tabs: [], active: null });
  } catch { threw = true; }
  ok('and storage that refuses to be written is survivable', !threw);
}

// ── paths that were never ours ────────────────────────────────────────────
{
  const s = store(JSON.stringify({
    '/p': {
      tabs: [
        { path: '/etc/passwd', line: 1 },
        { path: 'C:\\Windows\\win.ini', line: 1 },
        { path: '../../../.ssh/id_rsa', line: 1 },
        { path: 'src/../../out.ts', line: 1 },
        { path: '', line: 1 },
        { path: 'src/notes..old.ts', line: 6 },
      ],
      active: '/etc/passwd',
    },
  }));
  const ws = loadWorkspace(s, '/p');
  ok('an absolute path is not restored', !paths(ws).includes('/etc/passwd'), paths(ws));
  ok('nor a drive-lettered one', !paths(ws).some((p) => p.startsWith('C:')), paths(ws));
  ok('nor one that climbs out of the folder',
     !paths(ws).some((p) => p.includes('..' + '/')) && !paths(ws).includes('../../../.ssh/id_rsa'),
     paths(ws));
  ok('nor an empty one', !paths(ws).includes(''), paths(ws));
  ok('but a filename that merely contains two dots is an ordinary file',
     paths(ws).join() === 'src/notes..old.ts' && ws.tabs[0].line === 6, ws.tabs);
  ok('and an active tab that was refused does not survive as active', ws.active === null);
}

// ── the cap on tabs ───────────────────────────────────────────────────────
{
  const s = store();
  const many = Array.from({ length: 40 }, (_, i) => T(`f${i}.ts`, i + 1));
  saveWorkspace(s, '/p', { tabs: many, active: 'f39.ts' });
  const ws = loadWorkspace(s, '/p');
  ok('only a bounded number of tabs is remembered', ws.tabs.length === MAX_TABS, ws.tabs.length);
  ok('the most recently opened are the ones kept',
     paths(ws).includes('f39.ts') && !paths(ws).includes('f0.ts'), paths(ws));
  ok('and their caret lines came with them',
     ws.tabs[ws.tabs.length - 1].line === 40, ws.tabs);
}
{
  // The tab you are actually using can be the oldest one open — a file left up
  // while forty others were opened and closed around it.
  const s = store();
  const many = Array.from({ length: 40 }, (_, i) => T(`f${i}.ts`, i + 1));
  saveWorkspace(s, '/p', { tabs: many, active: 'f0.ts' });
  const ws = loadWorkspace(s, '/p');
  ok('the tab you were looking at survives the trim even when it is the oldest',
     ws.active === 'f0.ts' && paths(ws).includes('f0.ts'), paths(ws));
  ok('and the trim still respects the cap', ws.tabs.length === MAX_TABS, ws.tabs.length);
  ok('the rest are still the newest, in order',
     paths(ws).slice(1).join() === Array.from({ length: MAX_TABS - 1 }, (_, i) => `f${40 - MAX_TABS + 1 + i}.ts`).join(),
     paths(ws));
}

// ── the cap on folders ────────────────────────────────────────────────────
{
  const s = store();
  for (let i = 0; i < MAX_FOLDERS + 5; i++) {
    saveWorkspace(s, `/folder/${i}`, { tabs: [T(`f${i}.ts`)], active: `f${i}.ts` });
  }
  const stored = raw(s);
  ok('only a bounded number of folders is remembered',
     Object.keys(stored).length === MAX_FOLDERS, Object.keys(stored).length);
  ok('the folder used most recently is one of them',
     loadWorkspace(s, `/folder/${MAX_FOLDERS + 4}`).tabs.length === 1);
  ok('and the one untouched longest is the one forgotten',
     loadWorkspace(s, '/folder/0').tabs.length === 0);
}
{
  // Reopening an old project makes it recent again, which is the whole point of
  // ordering by use rather than by when it was first seen.
  const s = store();
  for (let i = 0; i < MAX_FOLDERS; i++) {
    saveWorkspace(s, `/folder/${i}`, { tabs: [T(`f${i}.ts`)], active: null });
  }
  saveWorkspace(s, '/folder/0', { tabs: [T('again.ts')], active: null });
  saveWorkspace(s, '/newcomer', { tabs: [T('n.ts')], active: null });
  ok('touching a folder again saves it from being the next forgotten',
     loadWorkspace(s, '/folder/0').tabs.length === 1, raw(s));
  ok('and the newcomer is in', loadWorkspace(s, '/newcomer').tabs.length === 1);
  ok('while the next-oldest went instead', loadWorkspace(s, '/folder/1').tabs.length === 0);
}

// ── tidying up ────────────────────────────────────────────────────────────
{
  const s = store();
  saveWorkspace(s, '/p', { tabs: [T('a.ts')], active: 'a.ts' });
  saveWorkspace(s, '/q', { tabs: [T('b.ts')], active: 'b.ts' });
  saveWorkspace(s, '/p', { tabs: [], active: null });
  ok('closing every tab forgets the folder rather than storing emptiness',
     Object.keys(raw(s)).join() === '/q', raw(s));
  saveWorkspace(s, '/q', { tabs: [], active: null });
  ok('and forgetting the last folder removes the key entirely',
     s.map.size === 0, [...s.map.keys()]);
}
{
  const s = store();
  saveWorkspace(s, '', { tabs: [T('a.ts')], active: 'a.ts' });
  ok('there is nothing to save with no folder open', s.map.size === 0);
}
{
  // Saving reads what is there first, so a value it could not parse must not
  // take the rest of the store down with it.
  const s = store('not json at all');
  saveWorkspace(s, '/p', { tabs: [T('a.ts', 3)], active: 'a.ts' });
  ok('a save over a corrupt value replaces it',
     loadWorkspace(s, '/p').tabs[0].line === 3, s.map.get(KEY));
}

// ── the chat order, in the same store ─────────────────────────────────────
//
// The chat list is sorted by when each chat was last used and is re-read after
// every reply, so an order somebody dragged into place has nowhere to live but
// here. It rides in the folder's own record rather than in a second key: it is
// an answer to the same question — what was this folder like when you left it.
{
  const s = store();
  ok('a folder nobody has arranged has no order', loadChatOrder(s, '/p').length === 0);
  saveChatOrder(s, '/p', ['c2', 'c1', 'c3']);
  ok('an order comes back as it was left', loadChatOrder(s, '/p').join() === 'c2,c1,c3');
  ok('and belongs to that folder only', loadChatOrder(s, '/q').length === 0);
}
{
  // The two writers share one key, and neither may drop what the other wrote.
  const s = store();
  saveChatOrder(s, '/p', ['c1', 'c2']);
  saveWorkspace(s, '/p', { tabs: [T('a.ts', 4)], active: 'a.ts' });
  ok('saving tabs keeps the chat order', loadChatOrder(s, '/p').join() === 'c1,c2', raw(s));
  ok('and the tabs are there too', loadWorkspace(s, '/p').tabs[0].line === 4);
  saveChatOrder(s, '/p', ['c2', 'c1']);
  ok('saving the order keeps the tabs', paths(loadWorkspace(s, '/p')).join() === 'a.ts');
  ok('and the active tab with them', loadWorkspace(s, '/p').active === 'a.ts');
}
{
  // Closing every tab still forgets a folder — unless somebody arranged its
  // chats, which is a decision about the folder that outlives its tabs.
  const s = store();
  saveChatOrder(s, '/p', ['c1']);
  saveWorkspace(s, '/p', { tabs: [T('a.ts')], active: 'a.ts' });
  saveWorkspace(s, '/p', { tabs: [], active: null });
  ok('closing every tab does not throw away the arrangement',
     loadChatOrder(s, '/p').join() === 'c1', raw(s));
  ok('and the folder has no tabs left', loadWorkspace(s, '/p').tabs.length === 0);
  saveChatOrder(s, '/p', []);
  ok('dragging it all back forgets the folder entirely', s.map.size === 0, [...s.map.keys()]);
}
{
  const s = store();
  saveChatOrder(s, '', ['c1']);
  ok('there is nothing to remember with no folder open', s.map.size === 0);
}
{
  // A stored value is input. This one is a list of ids somebody can edit.
  const s = store(JSON.stringify({ '/p': { tabs: [], active: null, seq: 1, chats: ['a', 7, '', 'a', 'b'] } }));
  ok('a stored order keeps only the ids in it', loadChatOrder(s, '/p').join() === 'a,b');
  const long = [];
  for (let i = 0; i < 200; i++) long.push(`c${i}`);
  const t = store();
  saveChatOrder(t, '/p', long);
  ok('and it is capped, so a hand-edited store cannot grow without end',
     loadChatOrder(t, '/p').length === 60, loadChatOrder(t, '/p').length);
}
{
  // Records written before any of this existed.
  const s = store(JSON.stringify({ '/p': { tabs: [{ path: 'a.ts', line: 2 }], active: 'a.ts', seq: 1 } }));
  ok('a record from before this existed reads as nobody having arranged anything',
     loadChatOrder(s, '/p').length === 0);
  ok('and its tabs are untouched', loadWorkspace(s, '/p').tabs[0].line === 2);
}
{
  // Ordering the folders is what the cap uses, so a chat drag has to count as
  // having touched the folder.
  const s = store();
  for (let i = 0; i < MAX_FOLDERS; i++) saveWorkspace(s, `/folder/${i}`, { tabs: [T('a.ts')], active: 'a.ts' });
  saveChatOrder(s, '/folder/0', ['c1']);
  saveWorkspace(s, '/newcomer', { tabs: [T('b.ts')], active: 'b.ts' });
  ok('arranging a folder\'s chats saves it from being the next forgotten',
     loadWorkspace(s, '/folder/0').tabs.length === 1, raw(s));
  ok('and the next-oldest went instead', loadWorkspace(s, '/folder/1').tabs.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
