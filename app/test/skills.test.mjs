// Skills: instruction sheets an agent can carry.
//
// The file belongs to a person and travels with the project, so the property
// that matters most is the one `agents.test.mjs` protects: editing one entry
// leaves every other byte alone. The property that matters next is the
// contract with `agents.systemPromptFor`: `textFor` hands it a record keyed
// by the names as the agent wrote them, in the agent's order, with anything
// the file does not have left out — and `missing` names exactly those.
import {
  STARTER, add, entryLevel, find, missing, parse, remove, slug, textFor, update,
} from '../.test-build/skills.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const REAL = `# Skills

A sentence explaining the file, which belongs to nobody.

## Review

Read the staged diff and list anything exploitable.

Say so plainly if there is nothing.

## Release notes

Write for somebody upgrading.

### Shape
One line per change.

## Tests

- Run them first.
- Read the failures before the code.

## Empty one
`;

// ── parsing ───────────────────────────────────────────────────────────────
{
  const p = parse(REAL);
  ok('every heading with something under it is a skill', p.length === 3, p.map((x) => x.name));
  ok('the heading is the name', p[0].name === 'Review');
  // Prose before the first heading is where somebody explains the file.
  ok('prose above the first heading is not a skill', !p.some((x) => x.body.includes('belongs to nobody')));
  // A name somebody has not finished writing is not a skill.
  ok('an empty heading is not a skill', !p.some((x) => x.name === 'Empty one'));
  ok('each one knows its own line', p.every((x) => typeof x.line === 'number'));
  ok('and the lines are in order', p[0].line < p[1].line && p[1].line < p[2].line);
  ok('the heading line is the right one', REAL.split('\n')[p[1].line] === '## Release notes');
  ok('the body starts at the first line under the heading', p[0].body.startsWith('Read the staged'), p[0].body);
  ok('a multi-paragraph body is kept whole, blank line and all',
     p[0].body.includes('exploitable') && p[0].body.includes('\n\nSay so plainly'));
  ok('and is trimmed at both ends', p[0].body === p[0].body.trim() && !p[0].body.endsWith('\n'));
  // A sheet with sections in it is still one sheet.
  ok('a deeper heading inside the body stays in the body',
     p[1].body.includes('### Shape') && p[1].body.includes('One line per change.'), p[1].body);
  // There is no metadata: a `- key: value` line at the top is body text.
  ok('a body that begins with a bullet list keeps it', p[2].body.startsWith('- Run them first.'), p[2].body);
}
ok('a file with no headings has no skills', parse('just some words\n').length === 0);
ok('an empty file is empty', parse('').length === 0);
ok('a mode line under a skill is body, not a field', (() => {
  const p = parse('## A\n- mode: agent\n\nmore\n');
  return p.length === 1 && p[0].body === '- mode: agent\n\nmore';
})());

// The entry level, as `prompts.ts` and `agents.ts` read it.
ok('a file written entirely with # has skills, not a title', (() => {
  const p = parse('# One\n\nbody one\n\n# Two\n\nbody two\n');
  return p.length === 2 && p[0].name === 'One';
})());
ok('a single # above ## headings is the title', entryLevel('# Title\n\n## a\n\nb\n') === 2);
ok('three # headings are the entries', entryLevel('# a\n\n1\n\n# b\n\n2\n\n# c\n\n3\n') === 1);
ok('no headings at all does not divide by nothing', entryLevel('just words') === 1);
{
  // The file once the last skill has been removed: a title and its paragraph.
  const bare = '# Skills\n\nA skill is a sheet.\n';
  ok('a title with a paragraph under it is a file with no skills in it', parse(bare).length === 0, parse(bare));
  ok('so the title cannot be removed', remove(bare, 0) === bare);
  ok('nor rewritten', update(bare, 0, { name: 'X', body: 'y' }) === bare);
  ok('and the next skill goes in one level down', add(bare, { name: 'R', body: 'b' }).includes('\n## R\n'));
  // Nobody titles a file with two hashes.
  ok('but a lone ## with a body is a skill', parse('## Solo\n\nGo.\n').length === 1);
  ok('and a lone # with a body is a title, whatever is under it', parse('# Solo\n\nGo.\n').length === 0);
}

// ── ids ───────────────────────────────────────────────────────────────────
ok('a slug is lowercase with hyphens', slug('Release notes') === 'release-notes');
ok('punctuation is not part of it', slug('  Review!!  ') === 'review' && slug('C++ style') === 'c-style');
ok('runs of separators are one hyphen', slug('a  --  b') === 'a-b');
// This app is localised. A slug that only survives ASCII hands every
// non-English name the same id.
ok('letters in any script survive', slug('مراجعة') === 'مراجعة' && slug('Révision') === 'révision');
ok('letters built from combining marks survive too',
   slug('हिंदी') === 'हिंदी' && slug('ผู้ตรวจ') === 'ผู้ตรวจ', [slug('हिंदी'), slug('ผู้ตรวจ')]);
ok('a name with no letters gets a fallback', slug('!!!') === 'skill' && slug('') === 'skill');
ok('two spellings of the same accented name slug alike', slug('Révision') === slug('Révision'));
{
  const p = parse('## Review\n\na\n\n## review\n\nb\n\n## Review\n\nc\n');
  ok('ids come from names', p[0].id === 'review');
  ok('a duplicate name gets a suffix', p[1].id === 'review-2', p.map((x) => x.id));
  ok('and the next one the next number', p[2].id === 'review-3', p.map((x) => x.id));
}
ok('a name that collides with a suffixed id is still unique', (() => {
  const p = parse('## A\n\n1\n\n## A\n\n2\n\n## A 2\n\n3\n');
  return new Set(p.map((x) => x.id)).size === 3;
})(), parse('## A\n\n1\n\n## A\n\n2\n\n## A 2\n\n3\n').map((x) => x.id));
ok('the first keeps its id however many follow', parse('## A\n\n1\n\n## A\n\n2\n')[0].id === 'a');

// ── finding one ───────────────────────────────────────────────────────────
{
  const p = parse(REAL);
  ok('found by id', find(p, 'release-notes')?.name === 'Release notes');
  ok('found by name, whatever the case', find(p, 'REVIEW')?.id === 'review');
  ok('found by whatever slugs to the id', find(p, 'Release Notes!')?.id === 'release-notes');
  ok('nothing matching is nothing', find(p, 'zzzz') === undefined);
  ok('and so is an empty query', find(p, '  ') === undefined);
  ok('an exact id beats a name that would slug to it', (() => {
    const two = parse('## A B\n\n1\n\n## a-b\n\n2\n');          // ids: a-b, a-b-2
    return find(two, 'a-b')?.line === 0;
  })());
}

// ── adding ────────────────────────────────────────────────────────────────
{
  const after = add(REAL, { name: 'New one', body: 'Do the thing.' });
  const p = parse(after);
  ok('a new skill joins the file', p.length === 4);
  ok('at the end', p[3].name === 'New one');
  // Two headings with no gap render as one paragraph in some viewers.
  ok('with a blank line before it', after.includes('\n\n## New one\n'));
  ok('and nothing above it moved', after.startsWith(REAL.replace(/\s+$/, '')), after.slice(0, 40));
  ok('what was given is what is read back', p[3].body === 'Do the thing.', p[3]);
  ok('the file says so in the format the header describes', after.endsWith('\n\n## New one\n\nDo the thing.\n'), after.slice(-40));
}
ok('adding to an empty file writes just the entry',
   add('', { name: 'First', body: 'body' }) === '## First\n\nbody\n', add('', { name: 'First', body: 'body' }));
ok('a skill with no name is not added', add(REAL, { name: '  ', body: 'body' }) === REAL);
ok('nor one with nothing under it', add(REAL, { name: 'T', body: '  \n ' }) === REAL);
ok('a newline in a name becomes a space', parse(add('', { name: 'one\ntwo', body: 'b' }))[0].name === 'one two');
ok('a body keeps its newlines', parse(add('', { name: 't', body: 'a\n\nb' }))[0].body === 'a\n\nb');
// Whole-body trim, as `agents.ts` trims a brief: the blank lines a textarea
// collects around the text are not part of the sheet.
ok('a body is trimmed on the way in', add('', { name: 't', body: '\n\n  hello  \n\n' }) === '## t\n\nhello\n',
   add('', { name: 't', body: '\n\n  hello  \n\n' }));
// `prompts.ts` always writes `##`, which vanishes into the last entry of a
// file written with `#`.
ok('a new entry takes the level the file uses', (() => {
  const after = add('# One\n\nbody one\n\n# Two\n\nbody two\n', { name: 'Three', body: 'body three' });
  return after.includes('\n# Three\n') && parse(after).length === 3;
})());
// What the app itself produces: an empty file, then one skill, then another.
ok('adding twice to an empty file gives two skills side by side', (() => {
  const after = add(add('', { name: 'First', body: 'a' }), { name: 'Second', body: 'b' });
  const p = parse(after);
  return p.length === 2 && p.map((x) => x.name).join() === 'First,Second' && after.includes('\n\n## Second\n');
})(), add(add('', { name: 'First', body: 'a' }), { name: 'Second', body: 'b' }));
ok('a lone ## is a skill, and the next goes beside it', (() => {
  const after = add('## Review\n\nRead it.\n', { name: 'Second', body: 'b' });
  return after.includes('\n## Second\n') && parse(after).length === 2;
})());
ok('a lone ### is a skill at that level, and the next goes beside it', (() => {
  const after = add('### Review\n\nRead it.\n', { name: 'Second', body: 'b' });
  return after.includes('\n### Second\n') && parse(after).length === 2;
})());
ok('adding to the starter keeps the title as the title', (() => {
  const p = parse(add(STARTER, { name: 'Third', body: 'c' }));
  return p.length === 3 && p[2].name === 'Third' && !p.some((x) => x.name === 'Skills');
})());

// ── removing ──────────────────────────────────────────────────────────────
{
  const p = parse(REAL);
  const after = remove(REAL, p[1].line);          // "Release notes"
  ok('removing takes the whole entry', parse(after).length === 2);
  ok('and the right one', !after.includes('Release notes') && !after.includes('One line per change'));
  ok('its neighbours are untouched', after.includes('## Review') && after.includes('## Tests'));
  ok('a multi-paragraph body goes in one piece', (() => {
    const gone = remove(REAL, p[0].line);
    return !gone.includes('exploitable') && !gone.includes('plainly');
  })());
  ok('and does not close the gap around what is left', !after.includes('\n\n\n'), after);
  ok('what was above is byte for byte the same', after.startsWith(REAL.split('\n').slice(0, p[1].line).join('\n')));
  ok('and what was below is too', after.endsWith(REAL.split('\n').slice(p[2].line).join('\n')));
}
ok('removing a line that is not a heading changes nothing', remove(REAL, 2) === REAL);
ok('and one past the end changes nothing', remove(REAL, 9999) === REAL && remove(REAL, -1) === REAL);
// The title is not a skill, and a panel that lists skills cannot remove it.
ok('the title cannot be removed as if it were a skill', remove(REAL, 0) === REAL);
ok('nor a heading inside a body', remove(REAL, REAL.split('\n').indexOf('### Shape')) === REAL);
ok('removing the only skill leaves the prose above it', (() => {
  const one = '# Title\n\nsome words\n\n## Only\n\nbody\n';
  const gone = remove(one, 4);
  return gone.includes('some words') && !gone.includes('body');
})());
// Blank runs anywhere else, including inside another skill's sheet, are that
// skill's bytes.
ok('removing one skill leaves the blank lines inside the others alone', (() => {
  const text = '## A\n\na\n\n\n\n## B\n\nb\n\n## C\n\nc\n';
  const after = remove(text, text.split('\n').indexOf('## C'));
  return after === '## A\n\na\n\n\n\n## B\n\nb\n';
})(), remove('## A\n\na\n\n\n\n## B\n\nb\n\n## C\n\nc\n', 10));
ok('and closes only the gap it opened',
   remove('## A\n\na\n\n## B\n\nb\n\n## C\n\nc\n', 4) === '## A\n\na\n\n## C\n\nc\n',
   remove('## A\n\na\n\n## B\n\nb\n\n## C\n\nc\n', 4));
ok('removing the first skill of a file with no title leaves no blank at the top',
   remove('## A\n\na\n\n## B\n\nb\n', 0) === '## B\n\nb\n', remove('## A\n\na\n\n## B\n\nb\n', 0));

// ── updating ──────────────────────────────────────────────────────────────
{
  const lines = REAL.split('\n');
  const p = parse(REAL);
  const at = p[1].line;                              // "Release notes"
  const next = p[2].line;                            // "Tests"
  const after = update(REAL, at, { name: 'Changelog', body: 'Mend it.' });
  const q = parse(after);
  ok('the entry is rewritten', q[1].name === 'Changelog' && q[1].body === 'Mend it.', q[1]);
  ok('and the old body with its sections is gone', !after.includes('### Shape') && !after.includes('somebody upgrading'));
  ok('the same number of skills', q.length === 3);
  ok('everything above it is byte for byte the same',
     after.split('\n').slice(0, at).join('\n') === lines.slice(0, at).join('\n'));
  // The next heading has moved, but from it on nothing changed.
  const tail = (s) => s.split('\n').slice(s.split('\n').indexOf('## Tests')).join('\n');
  ok('and everything from the next heading on', tail(after) === tail(REAL), tail(after));
  // The blank run before the next heading is the gap, not the entry.
  ok('the gap before the next heading is kept', after.includes('Mend it.\n\n## Tests'), after);
  ok('the whole thing still ends the way it did', after.endsWith(lines.slice(next).join('\n')));
  ok('it is written in the header format', after.includes('## Changelog\n\nMend it.\n'), after);
}
ok('updating keeps the heading level the file uses', (() => {
  const one = '# One\n\nbody one\n\n# Two\n\nbody two\n';
  const after = update(one, 4, { name: 'Deux', body: 'corps' });
  return after.includes('\n# Deux\n') && parse(after).length === 2 && parse(after)[1].name === 'Deux';
})());
ok('updating the entry before a bare heading leaves that heading in place', (() => {
  const p = parse(REAL);
  const after = update(REAL, p[2].line, { name: 'Tests', body: 'Changed.' });
  return after.endsWith('Changed.\n\n## Empty one\n') && parse(after)[2].body === 'Changed.';
})(), update(REAL, parse(REAL)[2].line, { name: 'Tests', body: 'Changed.' }).slice(-40));
ok('updating the last entry keeps the trailing newline', (() => {
  const two = '## A\n\na\n\n## B\n\nb\n';
  const after = update(two, 4, { name: 'B', body: 'Changed.' });
  return after.endsWith('Changed.\n') && parse(after)[1].body === 'Changed.';
})());
// The absence of a trailing newline is a byte too.
ok('and does not add one the file did not have', (() => {
  const two = '## A\n\na\n\n## B\n\nb';
  const after = update(two, 4, { name: 'B', body: 'Changed.' });
  return after.endsWith('Changed.') && !after.endsWith('\n');
})());
ok('the title is not an entry and is not rewritten', update(REAL, 0, { name: 'X', body: 'y' }) === REAL);
ok('nor is a heading inside a body', update(REAL, REAL.split('\n').indexOf('### Shape'), { name: 'X', body: 'y' }) === REAL);
ok('nor a line that is not a heading', update(REAL, 2, { name: 'X', body: 'y' }) === REAL);
ok('an update with no name changes nothing', update(REAL, parse(REAL)[0].line, { name: '', body: 'y' }) === REAL);
ok('and one with nothing under it changes nothing', update(REAL, parse(REAL)[0].line, { name: 'X', body: ' ' }) === REAL);
ok('updating does not mutate the draft', (() => {
  const d = { name: 'X', body: 'y\r\nz' };
  update(REAL, parse(REAL)[0].line, d);
  return d.body === 'y\r\nz' && d.name === 'X';
})());
ok('a rename alone keeps the body', (() => {
  const p = parse(REAL);
  const after = update(REAL, p[0].line, { name: 'Code review', body: p[0].body });
  const q = parse(after);
  return q[0].name === 'Code review' && q[0].id === 'code-review' && q[0].body === p[0].body;
})());

// ── what an agent is handed ───────────────────────────────────────────────
// `agents.systemPromptFor(agent, skillsText)` takes a record from name to
// text and looks each of the agent's names up in it, exactly first and then
// without regard to case. What `textFor` returns has to be that record.
{
  const p = parse(REAL);
  const r = textFor(p, ['Review', 'Tests']);
  ok('each name maps to its sheet', r.Review === p[0].body && r.Tests === p[2].body, r);
  ok('the keys are the names as the agent wrote them', Object.keys(r).join('|') === 'Review|Tests');
  ok('and the values are strings', Object.values(r).every((v) => typeof v === 'string'));
  ok('in the agent\'s order, not the file\'s', Object.keys(textFor(p, ['Tests', 'Review'])).join('|') === 'Tests|Review');
  ok('an unknown name is dropped', !('zzzz' in textFor(p, ['Review', 'zzzz'])) && Object.keys(textFor(p, ['Review', 'zzzz'])).length === 1);
  ok('nothing known is an empty record', Object.keys(textFor(p, ['zzzz'])).length === 0);
  ok('no names is an empty record', Object.keys(textFor(p, [])).length === 0);
  ok('an empty file gives an empty record', Object.keys(textFor([], ['Review'])).length === 0);
  // A person typed the agent's list, so the same latitude `find` gives.
  ok('a name is found without regard to case, and keyed as written', textFor(p, ['review']).review === p[0].body);
  ok('an id finds the sheet, and is keyed as the id', textFor(p, ['release-notes'])['release-notes'] === p[1].body);
  ok('a spelling that slugs to the id finds it', textFor(p, ['Release Notes'])['Release Notes'] === p[1].body);
  ok('surrounding spaces are not part of the key', Object.keys(textFor(p, ['  Review '])).join() === 'Review');
  ok('a blank name is dropped', Object.keys(textFor(p, ['', '  ', 'Review'])).join() === 'Review');
  ok('a sheet with nothing on it is left out, however the list was built',
     Object.keys(textFor([{ id: 'x', name: 'X', body: '  \n', line: 0 }], ['X'])).length === 0);
  ok('the same name twice is one key', Object.keys(textFor(p, ['Review', 'Review'])).length === 1);
  ok('the record is a fresh object each time', textFor(p, ['Review']) !== textFor(p, ['Review']));
  ok('and the skills are not changed by asking', p[0].body.startsWith('Read the staged') && p.length === 3);
}

// ── what the file does not have ───────────────────────────────────────────
{
  const p = parse(REAL);
  ok('a name the file has is not missing', missing(p, ['Review', 'Tests']).length === 0);
  ok('one it does not have is', missing(p, ['Review', 'Security']).join() === 'Security');
  ok('in the agent\'s order', missing(p, ['b', 'Review', 'a']).join('|') === 'b|a');
  ok('reported as written', missing(p, ['  Security ']).join() === 'Security');
  ok('the same name twice is reported once', missing(p, ['x', 'x']).join() === 'x');
  ok('a different case is not missing', missing(p, ['REVIEW']).length === 0);
  ok('an id is not missing', missing(p, ['release-notes']).length === 0);
  ok('a spelling that slugs to an id is not missing', missing(p, ['release notes']).length === 0);
  ok('a blank name is nothing to report', missing(p, ['', '  ']).length === 0);
  ok('with no file, every name is missing', missing([], ['Review', 'Tests']).join('|') === 'Review|Tests');
  ok('no names means nothing missing', missing(p, []).length === 0);
  // The two agree: what one drops, the other names.
  ok('missing names exactly what textFor drops', (() => {
    const names = ['Review', 'nope', 'release-notes', 'also nope'];
    const kept = Object.keys(textFor(p, names));
    const gone = missing(p, names);
    return [...kept, ...gone].sort().join('|') === [...names].sort().join('|');
  })());
}

// ── the starter ───────────────────────────────────────────────────────────
{
  const p = parse(STARTER);
  ok('the starter parses', p.length === 2, p.map((x) => x.name));
  ok('to the two examples', p[0].name === 'Review' && p[1].name === 'Release notes');
  ok('with sheets on them', p.every((x) => x.body.length > 20));
  ok('and ids somebody could type', p.map((x) => x.id).join() === 'review,release-notes');
  ok('the sentence explaining the file is not a skill', !p.some((x) => x.body.includes('A skill is an instruction sheet')));
  // The names match the `agents.ts` starter's convention, so `- skills:
  // Review, Release notes` written from one file finds both in the other.
  ok('and an agent naming both gets both', Object.keys(textFor(p, ['Review', 'Release notes'])).length === 2
     && missing(p, ['Review', 'Release notes']).length === 0);
  ok('the convention is visible in the file', STARTER.includes('- skills: Review, Release notes'));
}

// ── CRLF, because the file lives in a repository ──────────────────────────
{
  const crlf = '# Skills\r\n\r\n## One\r\n\r\nDo it.\r\n\r\nTwice.\r\n\r\n## Two\r\n\r\nOther.\r\n';
  const p = parse(crlf);
  ok('a CRLF file parses', p.length === 2, p);
  ok('and its names have no carriage return', p[0].name === 'One' && p[1].name === 'Two');
  ok('and its bodies have no carriage return', p[0].body === 'Do it.\n\nTwice.' && p[1].body === 'Other.', p[0].body);
  ok('so the record handed to the model has none', !textFor(p, ['One']).One.includes('\r'));

  const added = add(crlf, { name: 'Three', body: 'More.' });
  ok('adding to a CRLF file writes CRLF', added.endsWith('\r\n\r\n## Three\r\n\r\nMore.\r\n'), added.slice(-60));
  ok('and nothing in it is LF alone', !/[^\r]\n/.test(added));
  ok('and it still parses', parse(added).length === 3);
  ok('a body typed with CRLF is written with the file\'s CRLF, not doubled', (() => {
    const out = add(crlf, { name: 'Three', body: 'a\r\nb' });
    return out.endsWith('## Three\r\n\r\na\r\nb\r\n') && !out.includes('\r\r');
  })());

  const updated = update(crlf, p[0].line, { name: 'Uno', body: 'Hazlo.' });
  ok('updating a CRLF entry keeps every line CRLF', !/[^\r]\n/.test(updated), updated);
  ok('and rewrites the right one', parse(updated)[0].name === 'Uno' && parse(updated)[0].body === 'Hazlo.');
  ok('and leaves the other where it was', updated.endsWith('\r\n\r\n## Two\r\n\r\nOther.\r\n'), updated);
  ok('and the title', updated.startsWith('# Skills\r\n\r\n## Uno\r\n'), updated.slice(0, 30));

  const removed = remove(crlf, p[0].line);
  ok('removing from a CRLF file leaves the rest', parse(removed).length === 1 && parse(removed)[0].name === 'Two');
  ok('and does not leave a triple gap', !removed.includes('\r\n\r\n\r\n'), removed);
  ok('and stays CRLF', !/[^\r]\n/.test(removed), removed);

  // `split('\n')` leaves the carriage return on the line, so the blank that
  // separated the last entry is "\r" — and putting it back at the end of the
  // file writes a carriage return with no newline after it, which no editor
  // wrote and every diff shows.
  const lastGone = remove('## A\r\n\r\na\r\n\r\n## B\r\n\r\nb\r\n', 4);
  ok('removing the last skill of a CRLF file leaves no stray carriage return',
     lastGone === '## A\r\n\r\na\r\n', lastGone);
  const onlyGone = remove('# S\r\n\r\npara\r\n\r\n## A\r\n\r\na\r\n', 4);
  ok('and removing the only skill under a title leaves the title and its paragraph, ending in CRLF',
     onlyGone === '# S\r\n\r\npara\r\n', onlyGone);
}

// ── names in other scripts ────────────────────────────────────────────────
// This app is localised, and a skill written in Arabic or Kurdish is attached
// by an agent written in Arabic or Kurdish.
{
  const text = '# المهارات\n\n## مراجعة\n\nاقرأ التغيير كاملاً.\n\n## Révision\n\nLis le tout.\n';
  const p = parse(text);
  ok('a name in Arabic is read', p[0].name === 'مراجعة' && p[0].body === 'اقرأ التغيير كاملاً.');
  ok('and gets an id in Arabic', p[0].id === 'مراجعة');
  ok('an agent naming it in Arabic finds it', textFor(p, ['مراجعة'])['مراجعة'] === p[0].body && missing(p, ['مراجعة']).length === 0);
  ok('an accented name is found in either case', textFor(p, ['RÉVISION'])['RÉVISION'] === 'Lis le tout.');
  // NFD and NFC are the same word to whoever typed them.
  ok('and in either normalisation', find(p, 'Révision')?.id === 'révision');
  ok('a title in Arabic is still the title', !p.some((x) => x.name === 'المهارات'));
  ok('adding a name in another script and reading it back', (() => {
    const after = add(text, { name: 'پێداچوونەوە', body: 'هەموو گۆڕانکارییەکە بخوێنەوە.' });
    const q = parse(after);
    return q.length === 3 && q[2].name === 'پێداچوونەوە' && q[2].id === 'پێداچوونەوە';
  })());
  ok('a name that is only punctuation gets the fallback id, made unique', (() => {
    const q = parse('## !!!\n\na\n\n## ???\n\nb\n');
    return q.map((x) => x.id).join() === 'skill,skill-2';
  })());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
