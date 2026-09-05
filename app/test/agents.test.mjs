// Named agents.
//
// The file belongs to a person and travels with the project, so the property
// that matters most is the one `prompts.ts` and `todo.ts` protect: editing one
// entry leaves every other byte alone. The property that matters next is the
// one `modes.test.mjs` protects from the other side: what an agent may do is
// read from the file strictly, defaults to reading only, and is never guessed.
import {
  MODES, STARTER, add, entryLevel, find, modeFor, parse, remove, slug, systemPromptFor, update,
} from '../.test-build/agents.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const REAL = `# Agents

A sentence explaining the file, which belongs to nobody.

## Reviewer
- mode: ask
- skills: review, security

Read the staged diff and list anything exploitable.

Say so plainly if there is nothing.

## Fixer
- mode: agent
- model: claude-sonnet-4-5
- skills: tests

Fix what the reviewer found.

### How
Small commits.

## Plain

Just a brief, with no metadata at all.

## Empty one
`;

// ── parsing ───────────────────────────────────────────────────────────────
{
  const p = parse(REAL);
  ok('every heading with something under it is an agent', p.length === 3, p.map((x) => x.name));
  ok('the heading is the name', p[0].name === 'Reviewer');
  // Prose before the first heading is where somebody explains the file.
  ok('prose above the first heading is not an agent',
     !p.some((x) => x.brief.includes('belongs to nobody')));
  // A name somebody has not finished writing is not an agent.
  ok('an empty heading is not an agent', !p.some((x) => x.name === 'Empty one'));
  ok('each one knows its own line', p.every((x) => typeof x.line === 'number'));
  ok('and the lines are in order', p[0].line < p[1].line && p[1].line < p[2].line);
  ok('the heading line is the right one', REAL.split('\n')[p[1].line] === '## Fixer');

  // The list at the top is fields, not brief.
  ok('metadata lines are read as fields', p[0].mode === 'ask' && p[0].skills.length === 2, p[0]);
  ok('and are not in the brief', !p[0].brief.includes('mode:') && !p[0].brief.includes('skills:'), p[0].brief);
  ok('the brief starts at the prose', p[0].brief.startsWith('Read the staged'), p[0].brief);
  ok('a multi-paragraph brief is kept whole, blank line and all',
     p[0].brief.includes('exploitable') && p[0].brief.includes('\n\nSay so plainly'));
  ok('mode agent is read', p[1].mode === 'agent');
  ok('the model is read as written', p[1].model === 'claude-sonnet-4-5');
  ok('skills are split on commas and trimmed',
     p[0].skills.join('|') === 'review|security', p[0].skills);
  // A brief with sections in it is still one brief.
  ok('a deeper heading inside the body stays in the brief',
     p[1].brief.includes('### How') && p[1].brief.includes('Small commits.'), p[1].brief);

  // Missing metadata is the defaults, and the default is the safe one.
  ok('no metadata means mode ask', p[2].mode === 'ask');
  ok('and no model', p[2].model === undefined && !('model' in p[2]), p[2]);
  ok('and no skills', Array.isArray(p[2].skills) && p[2].skills.length === 0);
  ok('and the whole body is the brief', p[2].brief === 'Just a brief, with no metadata at all.');
}
ok('a file with no headings has no agents', parse('just some words\n').length === 0);
ok('an empty file is empty', parse('').length === 0);

// Only the three known keys are metadata, and the run stops at the first line
// that is not one — nothing is swallowed on a guess.
ok('a brief that begins with a bullet list keeps it', (() => {
  const p = parse('## A\n- Check the tests: they must pass\n- mode: agent\n\nmore\n');
  return p.length === 1 && p[0].mode === 'ask' && p[0].brief.startsWith('- Check the tests');
})(), parse('## A\n- Check the tests: they must pass\n- mode: agent\n\nmore\n'));
ok('a mode line after the prose is prose', (() => {
  const p = parse('## A\n\nDo things.\n\n- mode: agent\n');
  return p[0].mode === 'ask' && p[0].brief.includes('- mode: agent');
})());
ok('key and value case do not matter', (() => {
  const p = parse('## A\n- Mode: AGENT\n- Skills: x\n\nb\n');
  return p[0].mode === 'agent' && p[0].skills.join() === 'x';
})());
ok('other list markers work too', parse('## A\n* mode: agent\n+ skills: x\n\nb\n')[0].mode === 'agent');
// The wrong way to fail is with the write tools.
ok('an unknown mode reads as ask', parse('## A\n- mode: yolo\n\nb\n')[0].mode === 'ask');
ok('a blank line between metadata lines does not end them', (() => {
  const p = parse('## A\n- mode: agent\n\n- skills: x\n\nbrief\n');
  return p[0].mode === 'agent' && p[0].skills.join() === 'x' && p[0].brief === 'brief';
})(), parse('## A\n- mode: agent\n\n- skills: x\n\nbrief\n'));
ok('with two of a key, the first wins', parse('## A\n- mode: agent\n- mode: ask\n\nb\n')[0].mode === 'agent');
ok('an empty skills line is no skills', parse('## A\n- skills:\n\nb\n')[0].skills.length === 0);
ok('an empty model line is no model', parse('## A\n- model:\n\nb\n')[0].model === undefined);
ok('backticks around a skill name are not part of it',
   parse('## A\n- skills: `review`, `tests`\n\nb\n')[0].skills.join('|') === 'review|tests');
ok('a repeated skill is listed once',
   parse('## A\n- skills: a, a, b\n\nb\n')[0].skills.join('|') === 'a|b');
// A person who wrote `- skills: review` and nothing else has said what they meant.
ok('metadata with no prose is still an agent, with an empty brief', (() => {
  const p = parse('## A\n- skills: review\n');
  return p.length === 1 && p[0].brief === '' && p[0].skills.join() === 'review';
})());

// The entry level, as `prompts.ts` reads it.
ok('a file written entirely with # has agents, not a title', (() => {
  const p = parse('# One\n\nbody one\n\n# Two\n\nbody two\n');
  return p.length === 2 && p[0].name === 'One';
})());
ok('a single # above ## headings is the title', entryLevel('# Title\n\n## a\n\nb\n') === 2);
ok('three # headings are the entries', entryLevel('# a\n\n1\n\n# b\n\n2\n\n# c\n\n3\n') === 1);
ok('no headings at all does not divide by nothing', entryLevel('just words') === 1);

// ── ids ───────────────────────────────────────────────────────────────────
ok('a slug is lowercase with hyphens', slug('Release notes') === 'release-notes');
ok('punctuation is not part of it', slug('  Reviewer!!  ') === 'reviewer' && slug('C++ helper') === 'c-helper');
ok('runs of separators are one hyphen', slug('a  --  b') === 'a-b');
// This app is localised. A slug that only survives ASCII hands every
// non-English name the same id.
ok('letters in any script survive', slug('مراجع') === 'مراجع' && slug('Révision') === 'révision');
ok('a name with no letters gets a fallback', slug('!!!') === 'agent' && slug('') === 'agent');
{
  const p = parse('## Reviewer\n\na\n\n## reviewer\n\nb\n\n## Reviewer\n\nc\n');
  ok('ids come from names', p[0].id === 'reviewer');
  ok('a duplicate name gets a suffix', p[1].id === 'reviewer-2', p.map((x) => x.id));
  ok('and the next one the next number', p[2].id === 'reviewer-3', p.map((x) => x.id));
}
ok('a name that collides with a suffixed id is still unique', (() => {
  const p = parse('## A\n\n1\n\n## A\n\n2\n\n## A 2\n\n3\n');
  const ids = p.map((x) => x.id);
  return new Set(ids).size === 3;
})(), parse('## A\n\n1\n\n## A\n\n2\n\n## A 2\n\n3\n').map((x) => x.id));
ok('the first keeps its id however many follow',
   parse('## A\n\n1\n\n## A\n\n2\n')[0].id === 'a');

// ── finding one ───────────────────────────────────────────────────────────
{
  const p = parse(REAL);
  ok('found by id', find(p, 'fixer')?.name === 'Fixer');
  ok('found by name, whatever the case', find(p, 'REVIEWER')?.id === 'reviewer');
  ok('found by whatever slugs to the id', find(p, 'Plain!')?.id === 'plain');
  ok('nothing matching is nothing', find(p, 'zzzz') === undefined);
  ok('and so is an empty query', find(p, '  ') === undefined);
  ok('an exact id beats a name that would slug to it', (() => {
    const two = parse('## A B\n\n1\n\n## a-b\n\n2\n');       // ids: a-b, a-b-2
    return find(two, 'a-b')?.line === 0;
  })());
}

// ── adding ────────────────────────────────────────────────────────────────
{
  const after = add(REAL, { name: 'New one', brief: 'Do the thing.', mode: 'agent', skills: ['x', 'y'], model: 'm-1' });
  const p = parse(after);
  ok('a new agent joins the file', p.length === 4);
  ok('at the end', p[3].name === 'New one');
  // Two headings with no gap render as one paragraph in some viewers.
  ok('with a blank line before it', after.includes('\n\n## New one\n'));
  ok('and nothing above it moved', after.startsWith(REAL.replace(/\s+$/, '')), after.slice(0, 40));
  ok('what was given is what is read back',
     p[3].mode === 'agent' && p[3].model === 'm-1' && p[3].skills.join('|') === 'x|y' && p[3].brief === 'Do the thing.', p[3]);
  ok('the file says so in the format the header describes',
     after.includes('## New one\n- mode: agent\n- model: m-1\n- skills: x, y\n\nDo the thing.\n'), after.slice(-80));
}
// The mode is the line a reviewer needs; "absent means ask" is a fact about
// the parser, not the file.
ok('adding to an empty file writes the mode even when it is the default',
   add('', { name: 'First', brief: 'body' }) === '## First\n- mode: ask\n\nbody\n', add('', { name: 'First', brief: 'body' }));
ok('but not a model or skills there is nothing to say about',
   !add('', { name: 'F', brief: 'b' }).includes('model') && !add('', { name: 'F', brief: 'b' }).includes('skills'));
ok('an agent with no name is not added', add(REAL, { name: '  ', brief: 'body' }) === REAL);
ok('nor one with nothing to say and nothing attached', add(REAL, { name: 'T', brief: '  ' }) === REAL);
ok('but skills alone are something', parse(add('', { name: 'T', brief: '', skills: ['review'] })).length === 1);
ok('a newline in a name becomes a space',
   parse(add('', { name: 'one\ntwo', brief: 'b' }))[0].name === 'one two');
ok('a brief keeps its newlines', parse(add('', { name: 't', brief: 'a\n\nb' }))[0].brief === 'a\n\nb');
ok('an unknown mode is written as ask', add('', { name: 't', brief: 'b', mode: 'yolo' }).includes('- mode: ask'));
// `prompts.ts` always writes `##`, which vanishes into the last entry of a file
// written with `#`.
ok('a new entry takes the level the file uses', (() => {
  const after = add('# One\n\nbody one\n\n# Two\n\nbody two\n', { name: 'Three', brief: 'body three' });
  return after.includes('\n# Three\n') && parse(after).length === 3;
})());
// Read strictly, `# Agents` above a paragraph is an agent called "Agents". It
// is a title, and the first real agent goes under it.
ok('a file with only a title gets entries one level down', (() => {
  const after = add('# Agents\n\nAn intro.\n', { name: 'First', brief: 'b' });
  const p = parse(after);
  return after.includes('## First') && p.length === 1 && p[0].name === 'First';
})(), add('# Agents\n\nAn intro.\n', { name: 'First', brief: 'b' }));
// What the app itself produces: an empty file, then one agent, then another.
ok('adding twice to an empty file gives two agents side by side', (() => {
  const after = add(add('', { name: 'First', brief: 'a' }), { name: 'Second', brief: 'b' });
  const p = parse(after);
  return p.length === 2 && p.map((x) => x.name).join() === 'First,Second' && after.includes('\n\n## Second\n');
})(), add(add('', { name: 'First', brief: 'a' }), { name: 'Second', brief: 'b' }));
ok('a lone # with metadata under it is an agent, and the next goes beside it', (() => {
  const after = add('# Reviewer\n- mode: ask\n\nRead it.\n', { name: 'Second', brief: 'b' });
  return after.includes('\n# Second\n') && parse(after).length === 2;
})(), add('# Reviewer\n- mode: ask\n\nRead it.\n', { name: 'Second', brief: 'b' }));
ok('a lone ## with only prose is an agent too', (() => {
  const after = add('## Reviewer\n\nRead it.\n', { name: 'Second', brief: 'b' });
  return after.includes('\n## Second\n') && parse(after).length === 2;
})());

// ── removing ──────────────────────────────────────────────────────────────
{
  const p = parse(REAL);
  const after = remove(REAL, p[1].line);          // "Fixer"
  ok('removing takes the whole entry', parse(after).length === 2);
  ok('and the right one', !after.includes('Fixer') && !after.includes('Small commits'));
  ok('its neighbours are untouched', after.includes('## Reviewer') && after.includes('## Plain'));
  ok('a multi-paragraph brief goes in one piece', (() => {
    const gone = remove(REAL, p[0].line);
    return !gone.includes('exploitable') && !gone.includes('plainly');
  })());
  ok('and does not close the gap around what is left', !after.includes('\n\n\n'), after);
  ok('what was above is byte for byte the same',
     after.startsWith(REAL.split('\n').slice(0, p[1].line).join('\n')));
}
ok('removing a line that is not a heading changes nothing', remove(REAL, 2) === REAL);
ok('and one past the end changes nothing', remove(REAL, 9999) === REAL && remove(REAL, -1) === REAL);
// The title is not an agent, and a panel that lists agents cannot remove it.
ok('the title cannot be removed as if it were an agent', remove(REAL, 0) === REAL);
ok('removing the only agent leaves the prose above it', (() => {
  const one = '# Title\n\nsome words\n\n## Only\n\nbody\n';
  const gone = remove(one, 4);
  return gone.includes('some words') && !gone.includes('body');
})());

// ── updating ──────────────────────────────────────────────────────────────
{
  const lines = REAL.split('\n');
  const p = parse(REAL);
  const at = p[1].line;                              // "Fixer"
  const next = p[2].line;                            // "Plain"
  const after = update(REAL, at, { name: 'Repairer', brief: 'Mend it.', mode: 'ask', skills: [] });
  const q = parse(after);
  ok('the entry is rewritten', q[1].name === 'Repairer' && q[1].brief === 'Mend it.' && q[1].mode === 'ask', q[1]);
  ok('the model line is gone when the draft has none', q[1].model === undefined && !after.includes('claude-sonnet'));
  ok('and the old brief with it', !after.includes('Small commits'));
  ok('the same number of agents', q.length === 3);
  ok('everything above it is byte for byte the same',
     after.split('\n').slice(0, at).join('\n') === lines.slice(0, at).join('\n'));
  // The next heading has moved, but from it on nothing changed.
  const tail = (s) => s.split('\n').slice(s.split('\n').indexOf('## Plain')).join('\n');
  ok('and everything from the next heading on', tail(after) === tail(REAL), tail(after));
  // The blank run before the next heading is the gap, not the entry.
  ok('the gap before the next heading is kept', after.includes('Mend it.\n\n## Plain'), after);
  ok('the whole thing still ends the way it did', after.endsWith(lines.slice(next).join('\n')));
  ok('it is written in the header format',
     after.includes('## Repairer\n- mode: ask\n\nMend it.\n'), after);
}
ok('updating keeps the heading level the file uses', (() => {
  const one = '# One\n\nbody one\n\n# Two\n\nbody two\n';
  const after = update(one, 4, { name: 'Deux', brief: 'corps' });
  return after.includes('\n# Deux\n') && parse(after).length === 2 && parse(after)[1].name === 'Deux';
})());
ok('updating the entry before a bare heading leaves that heading in place', (() => {
  const p = parse(REAL);
  const after = update(REAL, p[2].line, { name: 'Plain', brief: 'Changed.' });
  return after.endsWith('Changed.\n\n## Empty one\n') && parse(after)[2].brief === 'Changed.';
})(), update(REAL, parse(REAL)[2].line, { name: 'Plain', brief: 'Changed.' }).slice(-40));
ok('updating the last entry keeps the trailing newline', (() => {
  const two = '## A\n\na\n\n## B\n\nb\n';
  const after = update(two, 4, { name: 'B', brief: 'Changed.' });
  return after.endsWith('Changed.\n') && parse(after)[1].brief === 'Changed.';
})());
// The absence of a trailing newline is a byte too.
ok('and does not add one the file did not have', (() => {
  const two = '## A\n\na\n\n## B\n\nb';
  const after = update(two, 4, { name: 'B', brief: 'Changed.' });
  return after.endsWith('Changed.') && !after.endsWith('\n');
})());
ok('a metadata-only entry gets its brief without losing a line', (() => {
  const one = '## A\n- skills: x\n\n## B\n\nb\n';
  const after = update(one, 0, { name: 'A', brief: 'now with words', skills: ['x'] });
  const p = parse(after);
  return p.length === 2 && p[0].brief === 'now with words' && p[1].name === 'B' && after.includes('now with words\n\n## B');
})(), update('## A\n- skills: x\n\n## B\n\nb\n', 0, { name: 'A', brief: 'now with words', skills: ['x'] }));
ok('the title is not an entry and is not rewritten', update(REAL, 0, { name: 'X', brief: 'y' }) === REAL);
ok('nor is a heading inside a brief', (() => {
  const at = REAL.split('\n').indexOf('### How');
  return update(REAL, at, { name: 'X', brief: 'y' }) === REAL;
})());
ok('nor a line that is not a heading', update(REAL, 2, { name: 'X', brief: 'y' }) === REAL);
ok('an update with no name changes nothing', update(REAL, parse(REAL)[0].line, { name: '', brief: 'y' }) === REAL);
ok('and one with nothing to say and nothing attached changes nothing',
   update(REAL, parse(REAL)[0].line, { name: 'X', brief: ' ' }) === REAL);
ok('updating does not mutate the draft', (() => {
  const d = { name: 'X', brief: 'y', skills: ['a'] };
  update(REAL, parse(REAL)[0].line, d);
  return d.skills.length === 1 && d.name === 'X';
})());

// ── what the model is told ────────────────────────────────────────────────
const SKILLS = { review: 'Look for what is not handled.', tests: 'Run them, and read the failures.' };
ok('the brief alone is the prompt', systemPromptFor({ brief: 'Do it.', skills: [] }, SKILLS) === 'Do it.');
{
  const s = systemPromptFor({ brief: 'Do it.', skills: ['review', 'tests'] }, SKILLS);
  ok('skills follow the brief under a Skills heading', s.startsWith('Do it.\n\n## Skills\n\n'), s);
  ok('each one under its own name', s.includes('### review\n\nLook for') && s.includes('### tests\n\nRun them'), s);
  ok('in the order the agent lists them', s.indexOf('### review') < s.indexOf('### tests'));
}
ok('the order is the agent\'s, not the record\'s', (() => {
  const s = systemPromptFor({ brief: 'b', skills: ['tests', 'review'] }, SKILLS);
  return s.indexOf('### tests') < s.indexOf('### review');
})());
// A heading with nothing under it tells the model only that somebody made a
// mistake, and that is not the model's business.
ok('a skill with no text is left out', (() => {
  const s = systemPromptFor({ brief: 'b', skills: ['review', 'missing'] }, SKILLS);
  return s.includes('### review') && !s.includes('missing');
})());
ok('a skill whose text is blank is left out too',
   !systemPromptFor({ brief: 'b', skills: ['blank'] }, { blank: '  \n' }).includes('Skills'));
ok('no skill with text means no Skills heading',
   systemPromptFor({ brief: 'Do it.', skills: ['missing'] }, SKILLS) === 'Do it.');
ok('no skills at all means no Skills heading', !systemPromptFor({ brief: 'b', skills: [] }, SKILLS).includes('Skills'));
ok('an empty brief with skills is just the skills',
   systemPromptFor({ brief: '', skills: ['review'] }, SKILLS).startsWith('## Skills'));
ok('nothing at all is nothing', systemPromptFor({ brief: ' ', skills: [] }, SKILLS) === '');
ok('a skill is found without regard to case',
   systemPromptFor({ brief: 'b', skills: ['Review'] }, SKILLS).includes('Look for what'));
ok('skill text is trimmed', systemPromptFor({ brief: 'b', skills: ['x'] }, { x: '\n  body  \n' }).endsWith('### x\n\nbody'));
// The tools say what the agent may do. A sentence that disagreed with them
// would be the one that was wrong.
ok('the prompt says nothing about the mode', (() => {
  const a = parse(REAL)[1];                         // Fixer, mode agent
  const s = systemPromptFor(a, SKILLS);
  return !/\bmode\b/i.test(s) && !s.includes('agent');
})());

// ── which mode it actually runs in ────────────────────────────────────────
ok('the two modes are the two modes', MODES.join() === 'ask,agent');
ok('an attended agent keeps its mode', modeFor({ mode: 'agent' }, true) === 'agent');
// An approval gate with nobody at it is either closed or missing.
ok('an unattended one reads only', modeFor({ mode: 'agent' }, false) === 'ask');
ok('ask is ask either way', modeFor({ mode: 'ask' }, true) === 'ask' && modeFor({ mode: 'ask' }, false) === 'ask');

// ── the starter ───────────────────────────────────────────────────────────
{
  const p = parse(STARTER);
  ok('the starter parses', p.length === 2, p.map((x) => x.name));
  ok('to the two examples', p[0].name === 'Reviewer' && p[1].name === 'Release notes');
  ok('both of which only read', p.every((x) => x.mode === 'ask'));
  ok('with briefs', p.every((x) => x.brief.length > 20));
  ok('and ids somebody could type', p.map((x) => x.id).join() === 'reviewer,release-notes');
  // The convention has to be visible on first sight, or nobody learns it.
  ok('and the format is visible in the file', STARTER.includes('## Reviewer\n- mode: ask\n'));
  ok('the sentence explaining the file is not an agent', !p.some((x) => x.brief.includes('An agent is a name')));
}

// ── CRLF, because the file lives in a repository ──────────────────────────
{
  const crlf = '# Agents\r\n\r\n## One\r\n- mode: agent\r\n- skills: a, b\r\n\r\nDo it.\r\n\r\n## Two\r\n\r\nOther.\r\n';
  const p = parse(crlf);
  ok('a CRLF file parses', p.length === 2, p);
  ok('and its names have no carriage return', p[0].name === 'One' && p[1].name === 'Two');
  ok('and its metadata is read', p[0].mode === 'agent' && p[0].skills.join('|') === 'a|b', p[0]);
  ok('and its brief has no carriage return', p[0].brief === 'Do it.' && p[1].brief === 'Other.', p[0].brief);

  const added = add(crlf, { name: 'Three', brief: 'More.' });
  ok('adding to a CRLF file writes CRLF', added.endsWith('\r\n\r\n## Three\r\n- mode: ask\r\n\r\nMore.\r\n'), added.slice(-60));
  ok('and nothing in it is LF alone', !/[^\r]\n/.test(added));
  ok('and it still parses', parse(added).length === 3);

  const updated = update(crlf, p[0].line, { name: 'Uno', brief: 'Hazlo.', mode: 'ask' });
  ok('updating a CRLF entry keeps every line CRLF', !/[^\r]\n/.test(updated), updated);
  ok('and rewrites the right one', parse(updated)[0].name === 'Uno' && parse(updated)[0].brief === 'Hazlo.');
  ok('and leaves the other where it was', updated.endsWith('\r\n\r\n## Two\r\n\r\nOther.\r\n'), updated);

  const removed = remove(crlf, p[0].line);
  ok('removing from a CRLF file leaves the rest', parse(removed).length === 1 && parse(removed)[0].name === 'Two');
  ok('and does not leave a triple gap', !removed.includes('\r\n\r\n\r\n'), removed);
  ok('and stays CRLF', !/[^\r]\n/.test(removed), removed);

  // `split('\n')` leaves the carriage return on the line, so the blank that
  // separated the last entry is "\r" — and putting it back at the end of the
  // file writes a carriage return with no newline after it, which no editor
  // wrote and every diff shows.
  const lastGone = remove('## One\r\n- mode: ask\r\n\r\nDo it.\r\n\r\n## Two\r\n\r\nOther.\r\n', 5);
  ok('removing the last agent of a CRLF file leaves no stray carriage return',
     lastGone === '## One\r\n- mode: ask\r\n\r\nDo it.\r\n', lastGone);
  const onlyGone = remove('# Agents\r\n\r\npara\r\n\r\n## One\r\n- mode: ask\r\n\r\nDo it.\r\n', 4);
  ok('and removing the only agent under a title leaves the title and its paragraph, ending in CRLF',
     onlyGone === '# Agents\r\n\r\npara\r\n', onlyGone);
}

// ── what a review found ───────────────────────────────────────────────────
// Each of these is a concrete input a reviewer produced that the module got
// wrong once. They stay so it cannot get them wrong again.
ok('a slug keeps letters that are built from combining marks',
   slug('हिंदी') === 'हिंदी' && slug('ผู้ตรวจ') === 'ผู้ตรวจ' && slug('مُراجِع') === 'مُراجِع', [slug('हिंदी'), slug('ผู้ตรวจ')]);
ok('removing one agent leaves the blank lines inside the others alone', (() => {
  const text = '## A\n\na\n\n\n\n## B\n\nb\n\n## C\n\nc\n';
  const after = remove(text, text.split('\n').indexOf('## C'));
  return after === '## A\n\na\n\n\n\n## B\n\nb\n';
})(), remove('## A\n\na\n\n\n\n## B\n\nb\n\n## C\n\nc\n', 10));
ok('and closes only the gap it opened', remove('## A\n\na\n\n## B\n\nb\n\n## C\n\nc\n', 4) === '## A\n\na\n\n## C\n\nc\n',
   remove('## A\n\na\n\n## B\n\nb\n\n## C\n\nc\n', 4));
ok('a skill with a newline in it cannot break the entry on the way back', (() => {
  const after = add('', { name: 'T', brief: 'x', mode: 'ask', skills: ['a\nb', 'c,d'] });
  const p = parse(after);
  return p.length === 1 && p[0].brief === 'x' && p[0].skills.join('|') === 'a b|c d';
})(), parse(add('', { name: 'T', brief: 'x', mode: 'ask', skills: ['a\nb', 'c,d'] })));
{
  // The file once the last agent has been removed: a title and its paragraph.
  const bare = '# Agents\n\nAn agent is a name, a brief and a mode.\n';
  ok('a title with a paragraph under it is a file with no agents in it', parse(bare).length === 0, parse(bare));
  ok('so the title cannot be removed', remove(bare, 0) === bare);
  ok('nor rewritten', update(bare, 0, { name: 'X', brief: 'y', mode: 'ask' }) === bare);
  ok('and the next agent goes in one level down', add(bare, { name: 'R', brief: 'b', mode: 'ask' }).includes('\n## R\n'));
  ok('but a level-one heading with metadata is an agent', parse('# Solo\n- mode: agent\n\nGo.\n').length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
