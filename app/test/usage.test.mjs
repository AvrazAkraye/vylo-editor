// Token accounting.
//
// Wrong numbers are worse than no numbers — someone budgeting against a monthly
// allowance would be misled by them. The two streaming paths report usage
// differently, and most of these tests are about being right on both.
import { add, compact, fold, NO_USAGE, summarise, total } from '../.test-build/usage.js';

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
