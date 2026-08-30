// Saved chats: naming them, finding them, and writing one out.
//
// The chat list is the record of everything the agent did to a project, and
// everything asserted here is about it being usable as one. The awkward cases
// are the reason the functions are pure and the reason this file exists: a
// rename to nothing, a rename the next turn would otherwise undo, a search that
// should match nothing, and a chat that was opened and never used.
//
// The export is checked by shape rather than byte for byte. Pinning the whole
// document would fail on every wording change and teach the next person to
// paste the new output in without reading it; what matters is that the files
// that were written and the commands that ran are in there, that a tool call
// reads as a sentence, and that the model-facing tool results are not.
import {
  MAX_TITLE,
  chatsIn, cleanTitle, commandsRun, deleteChat, exportFileName, exportMarkdown,
  filesWritten, loadChat, renameChat, saveChat, searchChats, titleFrom,
} from '../.test-build/store.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

/** localStorage in four lines. `store.ts` reaches for the global, so it is one. */
const fresh = () => {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
  return map;
};

const you = (text) => ({ kind: 'you', text });
const said = (text) => ({ kind: 'text', text });
const call = (name, input) => ({ kind: 'tool', text: `${name}(${JSON.stringify(input)})` });
const got = (text) => ({ kind: 'result', text });
const chat = (over = {}) => ({
  id: 'c1', folder: '/Users/me/proj', title: 'A chat',
  updatedAt: Date.parse('2026-08-30T14:22:00'), lines: [], history: [], ...over,
});
const titles = (hits) => hits.map((h) => h.chat.title);

// ── a name a person typed ─────────────────────────────────────────────────
{
  ok('an empty name is not a name', cleanTitle('') === null);
  ok('nor is one of only spaces and newlines', cleanTitle('  \n\t  ') === null);
  ok('a name is collapsed onto one line, the way the generated ones are',
     cleanTitle('  add the\n  export button ') === 'add the export button');
  ok('a short name is left exactly as it is', cleanTitle('Slow startup') === 'Slow startup');
  ok('a very long name is bounded, because every chat shares one quota',
     cleanTitle('x'.repeat(400)).length === MAX_TITLE);
  ok('and is marked as cut rather than silently ending mid-word',
     cleanTitle('x'.repeat(400)).endsWith('…'));
}

// ── renaming through the store ────────────────────────────────────────────
{
  fresh();
  saveChat(chat({ id: 'a', title: 'New chat', lines: [you('why is this slow')] }));
  const before = loadChat('a');
  ok('a chat with no name of its own is named after its opening question',
     before.title === 'why is this slow', before.title);

  ok('renaming to an empty string is refused', renameChat('a', '   ') === false);
  ok('and the chat keeps the name it had', loadChat('a').title === 'why is this slow');

  ok('renaming to a real name reports that it landed', renameChat('a', 'Startup profiling') === true);
  ok('and the name is what comes back', loadChat('a').title === 'Startup profiling');
  // Ordering is by updatedAt, so bumping it would jump the row to the top the
  // instant the rename was committed -- out from under the person typing it.
  ok('renaming does not move the chat to the top of the list',
     loadChat('a').updatedAt === before.updatedAt);
  ok('renaming a chat that is not there is refused rather than creating one',
     renameChat('gone', 'Something') === false && loadChat('gone') === null);

  // The bug this exists to prevent: App.tsx re-saves the whole thread after
  // every turn and passes titleFrom(lines) as the title, so a rename that was
  // not remembered would be undone by the next reply.
  const now = loadChat('a');
  saveChat({ ...now, title: titleFrom(now.lines), lines: [...now.lines, said('because of the index')] });
  ok('the typed name survives the next turn saving over it',
     loadChat('a').title === 'Startup profiling', loadChat('a').title);

  // cleanTitle is what bounds it, and the store has to be the thing that calls
  // it — a caller passing a pasted paragraph would otherwise put it in every
  // list that draws a title, and in the one localStorage quota.
  ok('a pasted paragraph is cut on the way into the store',
     renameChat('a', 'y'.repeat(400)) === true && loadChat('a').title.length === MAX_TITLE);
}

// ── deleting, the one thing here with no undo ─────────────────────
{
  fresh();
  saveChat(chat({ id: 'keep', folder: '/a', title: 'New chat', lines: [you('keep me')] }));
  saveChat(chat({ id: 'go', folder: '/a', title: 'New chat', lines: [you('delete me')] }));

  deleteChat('go');
  ok('deleting a chat removes it', loadChat('go') === null);
  ok('and leaves every other chat alone', loadChat('keep') !== null);
  ok('and it is gone from the folder listing',
     chatsIn('/a').map((c) => c.id).join('|') === 'keep', chatsIn('/a').map((c) => c.id));

  // A row can outlive its record — a second window, or a chat the size cap
  // dropped — and the button passes whatever id the row was carrying. Deleting
  // nothing must not be deleting everything.
  deleteChat('never-existed');
  ok('deleting a chat that is not there leaves the rest of the store standing',
     chatsIn('/a').length === 1);
}

// ── searching ─────────────────────────────────────────────────────────────
{
  const slow = chat({ id: 's', title: 'Why startup is slow', lines: [you('why is startup slow')] });
  const exp = chat({
    id: 'e', title: 'New chat',
    lines: [you('add a button'), said('I have added it to the composer row.')],
  });
  const empty = chat({ id: 'n', title: 'New chat', lines: [] });
  const all = [slow, exp, empty];

  ok('an empty query is not a filter', searchChats('  ', all).length === 3);
  ok('and returns the list in the order it was given',
     titles(searchChats('', all)).join('|') === 'Why startup is slow|New chat|New chat');

  const byName = searchChats('startup', all);
  ok('a query matching a title finds that chat', byName.length === 1 && byName[0].chat.id === 's');
  ok('and shows no snippet, because the name is the reason it matched',
     byName[0].snippet === undefined);

  const byText = searchChats('composer', all);
  ok('a query matching only the message text finds that chat',
     byText.length === 1 && byText[0].chat.id === 'e', titles(byText));
  ok('and says which line matched, since the name gives no clue',
     byText[0].snippet === 'I have added it to the composer row.', byText[0].snippet);

  ok('a query matching neither a name nor a word said finds nothing',
     searchChats('zzqjx', all).length === 0);
  ok('case is not part of the query, the same as it is not in cmd-P',
     searchChats('STARTUP', all).map((h) => h.chat.id).join('|') === 's');
  ok('a chat with no lines at all is simply not a text match',
     !searchChats('composer', all).some((h) => h.chat.id === 'n'));
  ok('but it is still findable by its name',
     searchChats('New chat', all).some((h) => h.chat.id === 'n'));

  // A name match is a stronger claim on "this is the one I meant" than a phrase
  // buried in a reply, and mixing the two orderings makes the list arbitrary.
  const both = [
    chat({ id: 'body', title: 'Unrelated', lines: [said('the index is rebuilt on save')] }),
    chat({ id: 'name', title: 'index', lines: [] }),
  ];
  ok('a chat whose name matches comes before one where only the text does',
     searchChats('index', both).map((h) => h.chat.id).join('|') === 'name|body');
  ok('a chat is listed once even when several of its lines match',
     searchChats('index', [chat({
       id: 'm', title: 'Unrelated',
       lines: [said('the index is rebuilt'), said('and the index is read on open')],
     })]).length === 1);

  // A reply arrives as one line holding newlines, and a snippet spanning them
  // would be a paragraph squeezed into a sidebar row. The split is what makes
  // the snippet the sentence that matched.
  const para = chat({ id: 'p', title: 'Unrelated', lines: [said(
    'The first thing I did was read the file.\nThe index is rebuilt on save.\nThat is why it was slow.')] });
  ok('the snippet is the line that matched, not the whole reply',
     searchChats('rebuilt', [para])[0].snippet === 'The index is rebuilt on save.',
     searchChats('rebuilt', [para])[0].snippet);

  const long = 'padding text '.repeat(30) + 'the needle is here' + ' trailing'.repeat(30);
  const far = searchChats('needle', [chat({ id: 'f', title: 'Unrelated', lines: [said(long)] })]);
  ok('a phrase far inside a long reply is still found', far.length === 1);
  ok('and the snippet is a window around it, not the first 160 characters',
     far[0].snippet.includes('needle') && far[0].snippet.startsWith('…'), far[0].snippet);
}

// ── what a session touched ────────────────────────────────────────────────
{
  const lines = [
    call('write_file', { path: 'src/a.ts', content: 'x' }),
    got('write_file → staged'),
    got('Wrote 2 files: src/a.ts, src/b.ts'),
    got('Wrote part of src/c.ts.'),
    got('Wrote 1 file: src/a.ts'),
  ];
  ok('the files reported written are the ones listed',
     filesWritten(lines).join('|') === 'src/a.ts|src/b.ts|src/c.ts', filesWritten(lines));
  ok('a file written twice is named once',
     filesWritten(lines).filter((f) => f === 'src/a.ts').length === 1);
  ok('a proposal that was never approved is not a file that changed',
     !filesWritten([call('write_file', { path: 'src/never.ts', content: 'x' })]).length);

  const ran = [
    call('run_command', { command: 'npm test', reason: 'check' }),
    call('read_file', { path: 'src/a.ts' }),
    call('run_command', { command: 'npm test' }),
    call('run_command', { command: 'cargo test' }),
  ];
  ok('the commands run are the run_command calls, in order',
     commandsRun(ran).join('|') === 'npm test|cargo test', commandsRun(ran));
  ok('a chat that ran nothing has no commands', commandsRun([you('hello')]).length === 0);
}

// ── the exported document ─────────────────────────────────────────────────
{
  const md = exportMarkdown(chat({
    title: 'Add the export button',
    tokens: { input: 12345, output: 2345, cacheRead: 0, cacheWrite: 0 },
    lines: [
      you('add an export button'),
      said('Looking first.'),
      call('read_file', { path: 'src/Chats.tsx' }),
      got('read_file → import { useState } from "react";'),
      said('Here it is.'),
      call('run_command', { command: 'npm test' }),
      got('Wrote 1 file: src/Chats.tsx'),
      you('thanks'),
    ],
  }));
  const lines = md.split('\n');

  ok('the document is titled with the chat', lines[0] === '# Add the export button');
  ok('the project it belongs to is near the top', md.includes('- **Project** `/Users/me/proj`'));
  ok('so is when it was last touched',
     /- \*\*Last active\*\* \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(md), lines.slice(0, 8));
  ok('and how many questions were asked', md.includes('- **Questions** 2'));
  ok('the tokens it cost are recorded when they are known',
     md.includes('- **Tokens** 12,345 in · 2,345 out'));

  ok('what changed on disk has a section of its own', md.includes('## Files changed'));
  ok('naming the file that was written', md.includes('- `src/Chats.tsx`'));
  ok('and what ran has another', md.includes('## Commands run') && md.includes('- `npm test`'));
  ok('the summaries come before the transcript',
     md.indexOf('## Files changed') < md.indexOf('## The conversation'));

  ok('the questions are attributed to the person', md.includes('### You'));
  ok('and the replies to the app', md.includes('### Vylo'));
  ok('a run of replies is one heading, not one per streamed fragment',
     md.split('### Vylo').length - 1 === 1, md.split('### Vylo').length - 1);
  ok('the second question opens a second You section',
     md.split('### You').length - 1 === 2);

  ok('a tool call reads as a sentence', md.includes('*Read `src/Chats.tsx`*'));
  ok('and so does a command', md.includes('*Ran `npm test`*'));
  ok('the tool result written for the model is not in the document',
     !md.includes('read_file → '), md.slice(md.indexOf('## The conversation')));
  ok('but the line reporting what was written is',
     md.includes('*Wrote 1 file: src/Chats.tsx*'));

  ok('nothing of the stored shape leaks in',
     !md.includes('{"path"') && !md.includes('kind:'));
}

// ── the awkward chats ─────────────────────────────────────────────────────
{
  const md = exportMarkdown(chat({ title: 'Opened and never used' }));
  ok('a chat with no lines still exports a document', md.startsWith('# Opened and never used'));
  ok('which says so rather than ending mid-sentence',
     md.includes('Nothing was said in this conversation.'));
  ok('and has no empty Files changed section', !md.includes('## Files changed'));

  const failed = exportMarkdown(chat({ lines: [you('go'), { kind: 'error', text: 'The gateway refused.' }] }));
  ok('a turn that failed is part of the record', failed.includes('**Failed:** The gateway refused.'));

  const odd = exportMarkdown(chat({ lines: [{ kind: 'tool', text: 'mcp.figma__get_file(not json)' }] }));
  ok('a tool call this cannot parse is still reported as a call',
     odd.includes('*Called `mcp.figma__get_file`*'), odd);
}

// ── the name offered in the save dialog ───────────────────────────────────
{
  ok('the file is named after the chat',
     exportFileName(chat({ title: 'Add the export button' })) === 'add-the-export-button.md');
  ok('punctuation the file system objects to cannot survive',
     exportFileName(chat({ title: 'why/is: this "slow"?' })) === 'why-is-this-slow.md');
  ok('a name in another script keeps its own letters',
     exportFileName(chat({ title: 'گەڕان خێرا' })) === 'گەڕان-خێرا.md');
  ok('a name with nothing to slug still produces a file',
     exportFileName(chat({ title: '···' })) === 'chat.md');
  ok('a very long name is cut short of a path limit',
     exportFileName(chat({ title: 'word '.repeat(60) })).length <= 63);
}

// ── the list a folder shows ───────────────────────────────────────────────
{
  fresh();
  saveChat(chat({ id: 'one', folder: '/a', title: 'New chat', lines: [you('first')] }));
  saveChat(chat({ id: 'two', folder: '/b', title: 'New chat', lines: [you('second')] }));
  renameChat('one', 'Renamed');
  ok('a rename is visible in the folder listing',
     chatsIn('/a').map((c) => c.title).join('|') === 'Renamed');
  ok('and does not reach into another folder', chatsIn('/b')[0].title === 'second');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
