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
// Level alone cannot tell `# Title` above `## A` from `## A` above its own
// `### Section` — they are the same shape — so only a lone `#` is a title.
// Reading it the other way costs a one-skill file its only skill.
{
  const one = '## Review\n\nRead it.\n\n### Findings\n\nOne per line.\n';
  ok('a lone ## above deeper headings is a skill, not a title', entryLevel(one) === 2, entryLevel(one));
  const p = parse(one);
  ok('so the file has that skill', p.length === 1 && p[0].name === 'Review', p.map((x) => x.name));
  ok('with the section in its sheet', p[0].body === 'Read it.\n\n### Findings\n\nOne per line.', p[0].body);
  ok('and the next skill goes in beside it', add(one, { name: 'Tests', body: 'Run them.' }).includes('\n## Tests\n'),
     add(one, { name: 'Tests', body: 'Run them.' }));
  ok('a lone ##### above a ###### is read the same way', parse('##### A\n\na\n\n###### B\n\nb\n').length === 1);
  // The `#` case is unchanged: that is a title, and always was.
  ok('but a lone # above deeper headings is still the title',
     entryLevel('# Title\n\n## a\n\nb\n\n### c\n\nd\n') === 2 && parse('# Title\n\n## a\n\nb\n').length === 1);
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

// ── a heading typed into a sheet ──────────────────────────────────────────
// The Instructions box takes free-form prose, and a `#` in it used to be
// written through verbatim. `entryLevel` counts the levels of the whole
// document, so one body re-levelled the whole file: the real entries stopped
// being entries and the title became a row a panel could rewrite and remove.
{
  const p = parse(STARTER);
  const after = update(STARTER, p[0].line, { name: 'Review', body: 'Read the change.\n\n# Findings\n\nOne per line.' });
  const q = parse(after);
  ok('a # typed into a sheet does not become an entry', q.length === 2, q.map((x) => x.name));
  ok('and the file still has the skills it had', q.map((x) => x.name).join('|') === 'Review|Release notes', q.map((x) => x.name));
  ok('the title is still the title', entryLevel(after) === 2 && !q.some((x) => x.name === 'Skills'), entryLevel(after));
  ok('the section is kept, one level under the entry', q[0].body.includes('\n### Findings\n'), q[0].body);
  ok('with the words around it', q[0].body.startsWith('Read the change.') && q[0].body.endsWith('One per line.'), q[0].body);
  ok('the agent is still handed the sheet', textFor(q, ['Review']).Review === q[0].body);
  ok('and the skill below it is byte for byte the same', q[1].body === p[1].body, q[1].body);
  // The heading is no longer structure, so `endOf` still ends the entry where
  // the entry ends — removing the neighbour used to take the file with it.
  ok('removing the neighbour takes only the neighbour', parse(remove(after, q[1].line)).length === 1);
  // One fewer hash split the sheet in two and left a phantom skill behind.
  const two = parse(update(STARTER, p[0].line, { name: 'Review', body: 'Read it.\n\n## Findings\n\nOne per line.' }));
  ok('nor does a ## split the sheet in two', two.length === 2 && two[0].body.includes('### Findings'), two.map((x) => x.name));
  // `add` reads the level the same way, so it is poisoned the same way.
  ok('and the next new skill still goes in at the file\'s level', add(after, { name: 'Third', body: 'c' }).includes('\n## Third\n'));
}
// A sheet with sections in it is still one sheet — that was always true of a
// heading a person hand-wrote, and is what this leaves alone.
ok('a heading already deeper than the entry is untouched', (() => {
  const after = update(REAL, parse(REAL)[0].line, { name: 'Review', body: 'a\n\n### Shape\n\nb' });
  return parse(after)[0].body === 'a\n\n### Shape\n\nb';
})(), parse(update(REAL, parse(REAL)[0].line, { name: 'Review', body: 'a\n\n### Shape\n\nb' }))[0].body);
ok('a new skill is written the same way', (() => {
  const q = parse(add(REAL, { name: 'New', body: '# A\n\nx' }));
  return q.length === 4 && q[3].body === '### A\n\nx';
})(), parse(add(REAL, { name: 'New', body: '# A\n\nx' })).map((x) => x.body));
// The nesting inside a sheet is the author's. Clamping every heading onto one
// level would put a section beside the section it was written under.
ok('the sheet keeps its own nesting', (() => {
  const q = parse(add(REAL, { name: 'New', body: '# A\n\n## B\n\nx' }));
  return q[3].body === '### A\n\n#### B\n\nx';
})(), parse(add(REAL, { name: 'New', body: '# A\n\n## B\n\nx' }))[3].body);
// The form is filled from what `parse` read, and Save on a form nobody
// touched must write the same bytes — not push the sheet down another level.
ok('writing a sheet back unchanged writes the same bytes', (() => {
  const once = add(REAL, { name: 'New', body: '# A\n\nx' });
  const s = parse(once)[3];
  return update(once, s.line, { name: s.name, body: s.body }) === once;
})());
// The file a hand-written two-skill file with no title becomes when one of
// them is removed — and then a section typed into the one that is left. The
// demoted heading used to make `## Review` read as the document's title, and
// the only skill in the file stopped existing.
{
  const one = '## Review\n\nRead it.\n';
  const after = update(one, 0, { name: 'Review', body: 'Read it.\n\n# Findings\n\nOne per line.' });
  const q = parse(after);
  ok('a section typed into the only skill of a title-less file keeps the skill',
     q.length === 1 && q[0].name === 'Review', q.map((x) => x.name));
  ok('and the section is in its sheet, one level down', q[0].body === 'Read it.\n\n### Findings\n\nOne per line.', q[0].body);
  ok('the entry level does not move', entryLevel(after) === 2, entryLevel(after));
  ok('the agent is still handed the sheet', textFor(q, ['Review']).Review === q[0].body);
  ok('writing it back writes the same bytes', update(after, q[0].line, { name: 'Review', body: q[0].body }) === after);
  ok('the skill can still be removed', remove(after, q[0].line).trim() === '');
  ok('and the next new skill goes in beside it', (() => {
    const two = parse(add(after, { name: 'Tests', body: 'Run them.' }));
    return two.length === 2 && two.map((x) => x.name).join('|') === 'Review|Tests';
  })(), parse(add(after, { name: 'Tests', body: 'Run them.' })).map((x) => x.name));
}

// ── a fenced block in a sheet ─────────────────────────────────────────────
// A sheet says how to do something, so it has commands in it, and a shell
// block has comments in it. To CommonMark, to GitHub and to whoever reads the
// file, that line is code — on the way out and on the way back in.
{
  const body = 'Run this:\n\n```sh\n# install first\nnpm i\n```\n\nDone.';
  const after = update(STARTER, parse(STARTER)[0].line, { name: 'Review', body });
  const q = parse(after);
  ok('a # inside a fence is written through byte for byte', after.includes('\n# install first\nnpm i\n'), after);
  ok('and read back exactly as it was typed', q[0].body === body, q[0].body);
  ok('the file still has both its skills', q.map((x) => x.name).join('|') === 'Review|Release notes', q.map((x) => x.name));
  ok('and the title is still the title', entryLevel(after) === 2 && !q.some((x) => x.name === 'Skills'));
  ok('saving it again writes the same bytes', update(after, q[0].line, { name: 'Review', body: q[0].body }) === after);
}
// The fence's # also set the shift for the whole sheet, so a real section
// below it went down a level further than it had to.
ok('a fenced # does not set the shift for the rest of the sheet', (() => {
  const q = parse(add(REAL, { name: 'New', body: 'a\n\n```sh\n# c\n```\n\n## Section\n\nx' }));
  return q[3].body === 'a\n\n```sh\n# c\n```\n\n### Section\n\nx';
})(), parse(add(REAL, { name: 'New', body: 'a\n\n```sh\n# c\n```\n\n## Section\n\nx' }))[3].body);
// The read side had the same hole from the start: a fenced # a person wrote
// by hand re-levelled the file exactly the way a typed one did.
{
  const hand = '# Skills\n\npara\n\n## A\n\n```sh\n# c\n```\n\n## B\n\nb\n';
  const p = parse(hand);
  ok('a hand-written fenced # is not the file\'s shallowest heading', entryLevel(hand) === 2, entryLevel(hand));
  ok('and does not split the sheet it is in', p.map((x) => x.name).join('|') === 'A|B' && p[0].body === '```sh\n# c\n```', p);
}
// `endOf` reads the same file the same way, so a fenced heading is not an
// entry boundary and is not an entry.
{
  const text = '## A\n\n```\n## not a skill\n```\n\n## B\n\nb\n';
  const p = parse(text);
  ok('a fenced heading does not end the entry it is in', p.length === 2 && p[0].body === '```\n## not a skill\n```', p);
  ok('removing the next skill leaves the fenced one whole', remove(text, p[1].line) === '## A\n\n```\n## not a skill\n```\n',
     remove(text, p[1].line));
  ok('and a fenced heading cannot be removed as if it were a skill', remove(text, 3) === text);
  ok('nor rewritten as one', update(text, 3, { name: 'X', body: 'y' }) === text);
}
ok('and a fenced heading does not decide the level a new skill goes in at', (() => {
  // Two `#` lines would be a file written with `#` and no title — but one of
  // them is code, so this is a title with nothing under it yet.
  const after = add('# Skills\n\n```\n# c\n```\n', { name: 'B', body: 'b' });
  const q = parse(after);
  return after.includes('\n## B\n') && q.length === 1 && q[0].name === 'B';
})(), add('# Skills\n\n```\n# c\n```\n', { name: 'B', body: 'b' }));
// CommonMark opens and closes a fence by the rail: the same character, at
// least as many of it, nothing after it, and no backtick in a backtick
// fence's info string.
ok('a longer rail is not closed by a shorter one', (() => {
  const body = '````\n```\n# still code\n````';
  return parse(add(REAL, { name: 'New', body }))[3].body === body;
})(), parse(add(REAL, { name: 'New', body: '````\n```\n# still code\n````' }))[3].body);
ok('a rail with an info string on it does not close one', (() => {
  const body = '```sh\n# c\n```js\n# also code\n```';
  return parse(add(REAL, { name: 'New', body }))[3].body === body;
})(), parse(add(REAL, { name: 'New', body: '```sh\n# c\n```js\n# also code\n```' }))[3].body);
ok('a backtick rail whose info string holds a backtick is not a fence at all', (() => {
  const q = parse(add(REAL, { name: 'New', body: '``` a`b\n\n# S\n\nx' }));
  return q[3].body === '``` a`b\n\n### S\n\nx';
})(), parse(add(REAL, { name: 'New', body: '``` a`b\n\n# S\n\nx' }))[3].body);
// The sheet itself is trimmed on the way in, so an indented rail is one with
// something above it.
ok('three spaces in is still a fence', (() => {
  const body = 'a\n\n   ```\n# c\n   ```\n\n# S\n\nx';
  return parse(add(REAL, { name: 'New', body }))[3].body === 'a\n\n   ```\n# c\n   ```\n\n### S\n\nx';
})(), parse(add(REAL, { name: 'New', body: 'a\n\n   ```\n# c\n   ```\n\n# S\n\nx' }))[3].body);
ok('four is an indented code block, not a rail', (() => {
  const body = 'a\n\n    ```\n\n# S\n\nx';
  return parse(add(REAL, { name: 'New', body }))[3].body === 'a\n\n    ```\n\n### S\n\nx';
})(), parse(add(REAL, { name: 'New', body: 'a\n\n    ```\n\n# S\n\nx' }))[3].body);
// An open fence runs to the end of the document, so one sheet's stray ``` would
// take every skill below it out of the file. The fence has to close somewhere.
ok('a fence a sheet never closes is closed at the end of the sheet', (() => {
  const q = parse(add(REAL, { name: 'New', body: 'Run:\n\n```sh\nnpm i' }));
  return q.length === 4 && q[3].body === 'Run:\n\n```sh\nnpm i\n```';
})(), parse(add(REAL, { name: 'New', body: 'Run:\n\n```sh\nnpm i' }))[3].body);
ok('so the skills below it are still skills', (() => {
  const after = update(REAL, parse(REAL)[0].line, { name: 'Review', body: 'Run:\n\n```sh\nnpm i' });
  return parse(after).map((x) => x.name).join('|') === 'Review|Release notes|Tests';
})(), parse(update(REAL, parse(REAL)[0].line, { name: 'Review', body: 'Run:\n\n```sh\nnpm i' })).map((x) => x.name));
ok('it closes with the rail the sheet opened', (() => {
  const q = parse(add(REAL, { name: 'New', body: '~~~~\nx' }));
  return q[3].body === '~~~~\nx\n~~~~';
})(), parse(add(REAL, { name: 'New', body: '~~~~\nx' }))[3].body);
ok('and closing it is done once', (() => {
  const once = add(REAL, { name: 'New', body: 'Run:\n\n```sh\nnpm i' });
  const s = parse(once)[3];
  return update(once, s.line, { name: s.name, body: s.body }) === once;
})());

// ── six hashes, and the escape that comes back off ────────────────────────
// Six hashes is as deep as Markdown goes, so a heading with nowhere left to
// go is escaped. Capping it at six would be worse than doing nothing: at a
// level-six entry, six is the entry level, and the capped heading becomes a
// sibling skill.
{
  const deep = update('###### Solo\n\nRead it.\n', 0, { name: 'Solo', body: '# F\n\nx' });
  const q = parse(deep);
  ok('a heading with nowhere deeper to go is escaped in the file', deep.includes('\n\\# F\n'), deep);
  ok('so it is no longer structure', q.length === 1 && q[0].name === 'Solo', q.map((x) => x.name));
  // The escape used to be one-way: the form showed it, the model was given
  // it, and a sheet copied into a shallower file carried it for good.
  ok('but the form is handed the line as it was typed', q[0].body === '# F\n\nx', q[0].body);
  ok('and so is the model', textFor(q, ['Solo']).Solo === '# F\n\nx');
  ok('writing that straight back writes the same bytes', update(deep, 0, { name: 'Solo', body: q[0].body }) === deep);
  ok('and the same sheet in a file with room becomes a heading again', (() => {
    return parse(add(REAL, { name: 'Copied', body: q[0].body }))[3].body === '### F\n\nx';
  })(), parse(add(REAL, { name: 'Copied', body: q[0].body }))[3].body);
}
{
  // A sheet that straddles the floor: what fits is demoted, what does not is
  // escaped. Reading the escape off gives the deeper heading room the next
  // time — the shallower one it was nested under has moved down — so the
  // sheet settles after one save and stays there.
  const once = update('##### Solo\n\nRead it.\n', 0, { name: 'Solo', body: '# A\n\n###### B\n\nx' });
  ok('what fits is demoted and only the overflow is escaped',
     once.includes('\n###### A\n') && once.includes('\n\\###### B\n'), once);
  const b = parse(once)[0].body;
  const twice = update(once, 0, { name: 'Solo', body: b });
  ok('and the sheet settles after one save', b === '###### A\n\n###### B\n\nx', b);
  ok('with the skill intact', parse(twice).length === 1 && parse(twice)[0].body === b, parse(twice));
  ok('and no further change', update(twice, 0, { name: 'Solo', body: b }) === twice, twice);
}
ok('a backslash inside a fence is somebody\'s code and stays', (() => {
  const body = 'a\n\n```\n\\# literal\n```';
  return parse(add(REAL, { name: 'New', body }))[3].body === body;
})(), parse(add(REAL, { name: 'New', body: 'a\n\n```\n\\# literal\n```' }))[3].body);
// The carriage return is put back per line, so a line the sheet gained must
// have one too.
ok('demoting in a CRLF file leaves every line CRLF', (() => {
  const after = update('# Skills\r\n\r\n## One\r\n\r\nDo it.\r\n', 2, { name: 'One', body: 'a\n# S\nb' });
  return !/[^\r]\n/.test(after) && parse(after)[0].body === 'a\n### S\nb';
})(), update('# Skills\r\n\r\n## One\r\n\r\nDo it.\r\n', 2, { name: 'One', body: 'a\n# S\nb' }));

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

  // A rail closes a fence when nothing but space follows it, and a carriage
  // return is space the file put there.
  const fenced = '# Skills\r\n\r\n## One\r\n\r\n```sh\r\n# c\r\n```\r\n\r\n## Two\r\n\r\nb\r\n';
  const f = parse(fenced);
  ok('a fence closes in a CRLF file too', entryLevel(fenced) === 2 && f.map((x) => x.name).join('|') === 'One|Two', f);
  ok('and its code has no carriage return in it', f[0].body === '```sh\n# c\n```', f[0].body);
  ok('a fence closed on the way into a CRLF file is CRLF as well', (() => {
    const out = update('# Skills\r\n\r\n## One\r\n\r\nDo it.\r\n', 2, { name: 'One', body: '```\nx' });
    return !/[^\r]\n/.test(out) && out.endsWith('## One\r\n\r\n```\r\nx\r\n```\r\n');
  })(), update('# Skills\r\n\r\n## One\r\n\r\nDo it.\r\n', 2, { name: 'One', body: '```\nx' }));
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
