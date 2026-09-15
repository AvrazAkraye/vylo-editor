// Token accounting.
//
// Wrong numbers are worse than no numbers — someone budgeting against a monthly
// allowance would be misled by them. The two streaming paths report usage
// differently, and most of these tests are about being right on both.
import { across, add, compact, counted, fold, heaviest, NO_USAGE, percentOf, summarise, total } from '../.test-build/usage.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// Real frames, captured from the gateway.
const TOOLS_START = { input_tokens: 550, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 };
const TOOLS_DELTA = { input_tokens: 550, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 8 };
const PLAIN_START = { input_tokens: 0, output_tokens: 0 };
const PLAIN_DELTA = { input_tokens: 13, output_tokens: 8 };

{
  // With tools, both frames carry the input and the delta carries the final
  // output. Adding would double the input and count the partial output twice.
  const u = fold(fold(NO_USAGE, TOOLS_START), TOOLS_DELTA);
  ok('the tools path counts input once', u.input === 550, u);
  ok('and takes the final output, not the first', u.output === 8, u);
}
{
  // Without tools the gateway synthesises the frames and message_start is all
  // zeros. Assignment in frame order would take those zeros.
  const u = fold(fold(NO_USAGE, PLAIN_START), PLAIN_DELTA);
  ok('the plain path is not zeroed by message_start', u.input === 13 && u.output === 8, u);
}
{
  // Frames can only ever be seen in order, but max makes order irrelevant,
  // which is one less thing to be wrong about.
  const forwards = fold(fold(NO_USAGE, TOOLS_START), TOOLS_DELTA);
  const backwards = fold(fold(NO_USAGE, TOOLS_DELTA), TOOLS_START);
  ok('order does not matter', JSON.stringify(forwards) === JSON.stringify(backwards));
}

ok('cache reads are kept separate',
   fold(NO_USAGE, { input_tokens: 900, cache_read_input_tokens: 800 }).cacheRead === 800);
ok('a frame with no usage changes nothing',
   JSON.stringify(fold(NO_USAGE, null)) === JSON.stringify(NO_USAGE));
ok('a malformed usage object changes nothing',
   JSON.stringify(fold(NO_USAGE, { input_tokens: 'lots' })) === JSON.stringify(NO_USAGE));

// Hops within a turn fold; turns add.
{
  const turn1 = { input: 500, output: 20, cacheRead: 0, cacheWrite: 0 };
  const turn2 = { input: 700, output: 40, cacheRead: 100, cacheWrite: 0 };
  const both = add(turn1, turn2);
  ok('turns add up', both.input === 1200 && both.output === 60 && both.cacheRead === 100, both);
  ok('total is input plus output', total(both) === 1260, total(both));
}

// ── the status bar has about twelve characters ────────────────────────────
ok('small counts are exact', compact(847) === '847');
ok('thousands get one decimal', compact(12400) === '12.4k', compact(12400));
ok('a decimal is kept right up to 100k', compact(1240) === '1.2k', compact(1240));
ok('past 100k it rounds, since the digit stops mattering',
   compact(124000) === '124k', compact(124000));
ok('millions read as millions', compact(1_240_000) === '1.2M', compact(1_240_000));
ok('zero is zero', compact(0) === '0');
ok('a whole thousand has no trailing .0', compact(11000) === '11k', compact(11000));
ok('a whole million likewise', compact(2_000_000) === '2M', compact(2_000_000));
ok('nonsense does not render as NaN', compact(NaN) === '0' && compact(-5) === '0');

ok('a summary names both directions',
   summarise({ input: 12400, output: 800, cacheRead: 0, cacheWrite: 0 }) === '12.4k in · 800 out',
   summarise({ input: 12400, output: 800, cacheRead: 0, cacheWrite: 0 }));
ok('and mentions the cache when there is one',
   summarise({ input: 12400, output: 800, cacheRead: 11000, cacheWrite: 0 }).includes('11k cached'));
ok('an unused turn shows nothing rather than zeros',
   summarise(NO_USAGE) === '', summarise(NO_USAGE));

// ── across a project ──────────────────────────────────────────────────────
// The question is "what has this project cost", and the trap is that a chat
// written before tokens were recorded has no figure. Nothing may read that
// absence as a zero.
{
  const chats = [
    { title: 'a', tokens: { input: 100, output: 20, cacheRead: 5, cacheWrite: 1 } },
    { title: 'b', tokens: { input: 300, output: 40, cacheRead: 0, cacheWrite: 0 } },
    { title: 'old' },                                    // predates the field
    { title: 'empty', tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
  ];
  const sum = across(chats);
  ok('every chat is added up', sum.input === 400 && sum.output === 60, sum);
  ok('and the cache columns with them', sum.cacheRead === 5 && sum.cacheWrite === 1, sum);
  ok('a chat with no record does not break the sum', Number.isFinite(total(sum)));
  ok('an empty list is no usage, not NaN', total(across([])) === 0);

  // The honesty of the total depends on saying how many it came from.
  ok('only chats with a figure are counted', counted(chats) === 2, counted(chats));
  ok('a chat recorded as all zeros is not counted either', counted([{ tokens: NO_USAGE }]) === 0);

  const top = heaviest(chats, 3);
  ok('the dearest chat is first', top[0].chat.title === 'b' && top[0].used === 340, top);
  ok('and the list carries its own totals', top[1].chat.title === 'a' && top[1].used === 120, top);
  ok('chats with no figure are left out rather than ranked last',
     top.length === 2 && !top.some((r) => r.chat.title === 'old'), top);
  ok('the cap is honoured', heaviest(chats, 1).length === 1);
  ok('and a cap of zero asks for nothing', heaviest(chats, 0).length === 0);
  ok('a negative cap is not a slice from the end', heaviest(chats, -2).length === 0);
  // Corrupt records reach this from disk, and a NaN in a total poisons a bar.
  ok('a nonsense figure reads as zero',
     total(across([{ tokens: { input: NaN, output: -5, cacheRead: undefined, cacheWrite: 'x' } }])) === 0);
}

// ── the bar ───────────────────────────────────────────────────────────────
// Null and zero mean different things here and the difference is the whole
// point: an unmetered plan has no bar, it does not have an empty one.
ok('a percentage is rounded', percentOf(25, 100) === 25 && percentOf(1, 3) === 33);
ok('and clamped, because a plan can be overspent', percentOf(150, 100) === 100);
ok('no ceiling is null, not zero', percentOf(10, null) === null && percentOf(10, 0) === null);
ok('nor is a nonsense ceiling a bar', percentOf(10, NaN) === null && percentOf(10, -5) === null);
ok('nothing spent against a real ceiling is zero', percentOf(0, 100) === 0);
ok('and a nonsense part is zero rather than NaN', percentOf(NaN, 100) === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
