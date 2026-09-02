// Prompts and commands worth keeping.
//
// The file belongs to a person and travels with the project, so the property
// that matters most is the same one `todo.ts` protects: editing one entry
// leaves every other byte alone, and nothing here reformats somebody's file.
import { STARTER, add, entryLevel, filter, kindOf, parse, payload, remove } from '../.test-build/prompts.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const REAL = `# Prompts

A sentence explaining the file, which belongs to nobody.

## Review the diff

Read the staged changes and list anything exploitable.

Say so plainly if there is nothing.

## Run the tests

\`npm test\`

## Build it

\`\`\`sh
npm run build
\`\`\`

## Empty one
`;

// ── parsing ───────────────────────────────────────────────────────────────
{
  const p = parse(REAL);
  ok('every heading with a body is a prompt', p.length === 3, p.map((x) => x.title));
  ok('the heading is the title', p[0].title === 'Review the diff');
  // Prose before the first heading is where somebody would naturally explain
  // the file. It belongs to nobody.
  ok('prose above the first heading is not a prompt',
     !p.some((x) => x.body.includes('belongs to nobody')));
  ok('a multi-paragraph body is kept whole',
     p[0].body.includes('exploitable') && p[0].body.includes('plainly'));
  ok('and its blank line survives', p[0].body.includes('\n\n'));
  // A heading with nothing under it has nothing to send.
  ok('an empty heading is not a prompt', !p.some((x) => x.title === 'Empty one'));
  ok('each one knows its own line', p.every((x) => typeof x.line === 'number'));
  ok('and the lines are in order', p[0].line < p[1].line && p[1].line < p[2].line);
}
ok('a file with no headings has no prompts', parse('just some words\n').length === 0);
ok('an empty file is empty', parse('').length === 0);
// A lone top heading is what a title is; three of them are three prompts.
ok('a file written entirely with # has prompts, not a title', (() => {
  const p = parse('# One\n\nbody one\n\n# Two\n\nbody two\n');
  return p.length === 2 && p[0].title === 'One';
})());
ok('a single # with nothing deeper is still a prompt',
   parse('# One\n\nbody\n').length === 1);
ok('but a single # above ## headings is the title',
   entryLevel('# Title\n\n## a\n\nb\n') === 2);
ok('and three # headings are the entries',
   entryLevel('# a\n\n1\n\n# b\n\n2\n\n# c\n\n3\n') === 1);
ok('no headings at all does not divide by nothing', entryLevel('just words') === 1);
// A prompt with sections in it is still one prompt.
ok('a heading inside a prompt is part of its body', (() => {
  const p = parse('# T\n\n## One\n\nintro\n\n### Detail\n\nmore\n');
  return p.length === 1 && p[0].body.includes('Detail') && p[0].body.includes('more');
})(), parse('# T\n\n## One\n\nintro\n\n### Detail\n\nmore\n'));

// ── which ones are commands ───────────────────────────────────────────────
// Strict, as `todo.ts` is: a sentence *about* a command is not one.
ok('a backticked body is a command', kindOf('`npm test`') === 'command');
ok('a fenced body is a command', kindOf('```sh\nnpm run build\n```') === 'command');
ok('a fence with no language too', kindOf('```\nls\n```') === 'command');
ok('prose is prose', kindOf('Explain this file') === 'prose');
ok('prose containing a command is still prose', kindOf('run `npm test` first') === 'prose');
ok('two backtick runs is prose', kindOf('`a` `b`') === 'prose');
ok('a paragraph after a fence is prose, not a command',
   kindOf('```sh\nls\n```\nand then look at it') === 'prose');
ok('empty backticks are prose', kindOf('``') === 'prose');
ok('surrounding whitespace does not change the kind', kindOf('  `ls`  ') === 'command');

ok('a backticked command unwraps', payload('`npm test`') === 'npm test');
ok('a fenced one unwraps', payload('```sh\nnpm run build\n```') === 'npm run build');
ok('a multi-line fence keeps its lines', payload('```\ncd app\nnpm test\n```') === 'cd app\nnpm test');
ok('prose is sent as written, trimmed', payload('  Explain this  ') === 'Explain this');
{
  const p = parse(REAL);
  ok('the parsed command is unwrapped', p.find((x) => x.title === 'Run the tests').body === 'npm test');
  ok('and so is the fenced one', p.find((x) => x.title === 'Build it').body === 'npm run build');
  ok('their kinds are right', p.filter((x) => x.kind === 'command').length === 2);
  ok('and the prose one is prose', p.find((x) => x.title === 'Review the diff').kind === 'prose');
}

// ── adding ────────────────────────────────────────────────────────────────
{
  const after = add(REAL, 'New one', 'Do the thing.');
  ok('a new prompt joins the file', parse(after).length === 4);
  ok('at the end', parse(after)[3].title === 'New one');
  // Two headings with no gap render as one paragraph in some viewers and read
  // as a mistake in all of them.
  ok('with a blank line before it', after.includes('\n\n## New one\n'));
  ok('and nothing above it moved',
     after.startsWith(REAL.replace(/\s+$/, '')), after.slice(0, 40));
}
ok('adding to an empty file needs no leading gap',
   add('', 'First', 'body') === '## First\n\nbody\n');
ok('a prompt with no title is not added', add(REAL, '  ', 'body') === REAL);
ok('and neither is one with no body', add(REAL, 'Title', '  ') === REAL);
ok('a newline in a title becomes a space',
   parse(add('', 'one\ntwo', 'b'))[0].title === 'one two');
ok('but a body keeps its newlines', parse(add('', 't', 'a\n\nb'))[0].body === 'a\n\nb');

// ── removing ──────────────────────────────────────────────────────────────
{
  const p = parse(REAL);
  const after = remove(REAL, p[1].line);          // "Run the tests"
  ok('removing takes the whole entry', parse(after).length === 2);
  ok('and the right one', !after.includes('Run the tests'));
  ok('its neighbours are untouched',
     after.includes('Review the diff') && after.includes('Build it'));
  // Runs to the next heading, so a prompt of several paragraphs goes whole.
  ok('a multi-paragraph prompt goes in one piece', (() => {
    const gone = remove(REAL, p[0].line);
    return !gone.includes('exploitable') && !gone.includes('plainly');
  })());
  ok('and does not close the gap around what is left',
     !after.includes('\n\n\n'), after);
}
ok('removing a line that is not a heading changes nothing', remove(REAL, 2) === REAL);
ok('and one past the end changes nothing', remove(REAL, 9999) === REAL && remove(REAL, -1) === REAL);
ok('removing the only prompt leaves the prose above it', (() => {
  const one = '# Title\n\nsome words\n\n## Only\n\nbody\n';
  const gone = remove(one, 4);
  return gone.includes('some words') && !gone.includes('body');
})(), remove('# Title\n\nsome words\n\n## Only\n\nbody\n', 4));

// ── searching ─────────────────────────────────────────────────────────────
{
  const p = parse(REAL);
  ok('an empty query is everything', filter(p, '  ').length === 3);
  ok('a title matches', filter(p, 'tests').map((x) => x.title).join() === 'Run the tests');
  ok('a body matches too, because that is where the words are',
     filter(p, 'exploitable').map((x) => x.title).join() === 'Review the diff');
  ok('case does not matter', filter(p, 'REVIEW').length === 1);
  ok('nothing matching is nothing', filter(p, 'zzzz').length === 0);
  ok('filtering does not mutate', filter(p, 'x') !== p && p.length === 3);
}

// ── the starter ───────────────────────────────────────────────────────────
{
  const p = parse(STARTER);
  ok('the starter parses', p.length === 3, p.map((x) => x.title));
  // The convention has to be visible on first sight, or nobody learns it.
  ok('and shows both kinds',
     p.some((x) => x.kind === 'prose') && p.some((x) => x.kind === 'command'));
}

// ── CRLF, because the file lives in a repository ──────────────────────────
{
  const crlf = '## One\r\n\r\n`npm test`\r\n';
  const p = parse(crlf);
  ok('a CRLF file parses', p.length === 1, p);
  ok('and its title has no carriage return', p[0].title === 'One');
  ok('and its body is still a command', p[0].kind === 'command' && p[0].body === 'npm test');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
