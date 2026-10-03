// Reading a model's reply under attack (motionai.ts `objectIn`, `parsePlan`,
// `refineMotion`): replies shaped by a model that loops, pads, or talks first.
//
// What matters: whatever arrives inside the 120 KB a reply may be, reading it
// costs about one scan of it, never the square of its nesting — a reply that is
// a runaway run of `{`, or an object nested thousands deep, is refused in
// milliseconds, since no plan or edit is nested more than a few levels; the
// slips a model makes are still read; and the plan is the object that carries
// one, not a setting quoted in braces in a sentence before it.
import { objectIn, parsePlan, refineMotion } from '../.test-build/motionai.js';
import { readMotion } from '../.test-build/motionread.js';
import { buildMotion } from '../.test-build/motiontemplates.js';

const SLOW = process.env.CI ? 4 : 1; // a shared runner is several times slower than the machine that releases; budgets stay strict here
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const req = { request: 'a big title that says Hello there, 8 seconds', lang: 'en', format: null, seconds: null, palette: null, recipe: null };
const timed = (f) => {
  const t0 = performance.now();
  let value, error;
  try { value = f(); } catch (e) { error = e; }
  return { ms: performance.now() - t0, value, error };
};
const timedAsync = async (f) => {
  const t0 = performance.now();
  let value, error;
  try { value = await f(); } catch (e) { error = e; }
  return { ms: performance.now() - t0, value, error };
};
const titleOf = (m) => m.layers.find((l) => l.id === 'big-title-title')?.text;
const graphic = buildMotion({ id: 't', recipe: 'big-title', lang: 'en', format: 'landscape', now: 1 });
const answer = (text) => () => refineMotion(null, null, graphic, 'make it portrait', { ask: async () => text });

// ── slips a model makes are still read ────────────────────────────────────
console.log('slips');
{
  const P = '{"recipe":"big-title","fields":{"title":"Hello there"}}';
  const readable = {
    fenced: '```json\n' + P + '\n```', nestedFences: '````\n```json\n' + P + '\n```\n````', bom: '\uFEFF' + P,
    trailingCommas: '{"recipe":"big-title","fields":{"title":"Hello there",},}', proseFirst: 'Here {is} one {"a":1} and {"b":[2]}: ' + P,
    smartQuotes: '{\u201Crecipe\u201D:\u201Cbig-title\u201D,\u201Cfields\u201D:{\u201Ctitle\u201D:\u201CHello there\u201D}}',
  };
  const got = Object.entries(readable).map(([k, text]) => {
    const r = timed(() => parsePlan(text, req, { id: 'p', now: 1 }));
    return [k, r.error ? String(r.error) : titleOf(r.value)];
  });
  ok('fences, a byte-order mark, trailing commas, curly quotes and prose before it: all read as the plan', got.every(([, t]) => t === 'Hello there'), got);
  const m = parsePlan('{"recipe":"big-title","seconds":"8","fields":{"title":"Hello \\ud800 there\\u2028!"}}', req, { id: 'p', now: 1 });
  ok('a string length, a lone surrogate and a line separator: read, and the graphic is a fixed point', m.seconds === 8 && same(readMotion(JSON.parse(JSON.stringify(m)), 1), m));
  const cut = parsePlan('{"recipe":"big-title","fields":{"title":"Hello there"},"palette":"sunset","format":"portr', req);
  ok('a plan cut off is still closed where it can be, and read', titleOf(cut) === 'Hello there' && cut.palette.bg === '#1a0f1f', cut.recipe);
}

// ── cost ──────────────────────────────────────────────────────────────────
console.log('cost');
{
  const brackets = timed(() => parsePlan('['.repeat(5_000_000), req));
  ok(`5 MB of "[": refused as unreadable in ${brackets.ms.toFixed(0)} ms`, String(brackets.error).includes('motion:unreadable-plan') && brackets.ms < 1500 * SLOW, brackets.ms);
  // A plan is a shallow object, so one that holds a value nested 100,000 deep is no plan: refused, in no time, and
  // without the stack overflow a recursive reader would meet.
  const arrays = timed(() => parsePlan('{"recipe":"big-title","fields":{"title":"Hello there"},"x":' + '['.repeat(100_000) + ']'.repeat(100_000) + '}', req));
  ok(`100,000 nested arrays inside the answer: refused as no plan in ${arrays.ms.toFixed(0)} ms`,
    String(arrays.error).includes('motion:unreadable-plan') && arrays.ms < 100 * SLOW, String(arrays.error ?? arrays.ms));
  // Reading a reply cut off used to write out the closing brackets of every cut and keep them all: 64,000 `{` took
  // 30 s and 2 GB, a complete reply 20,000 objects deep 8 s to plan and 12 s to edit. Past 64 levels it now stops.
  const run = timed(() => objectIn('{'.repeat(64_000)));
  ok(`a runaway reply of 64,000 "{" is given up on at once (${run.ms.toFixed(1)} ms)`, run.value === null && run.ms < 100 * SLOW, run.ms);
  const planRun = timed(() => parsePlan('{'.repeat(64_000), req));
  ok(`and planned from, refused at once (${planRun.ms.toFixed(1)} ms)`, String(planRun.error).includes('motion:unreadable-plan') && planRun.ms < 100 * SLOW, planRun.ms);
  const deep = timed(() => parsePlan('{"a":'.repeat(6_000) + '1' + '}'.repeat(6_000), req));
  ok(`a complete reply 6,000 objects deep is no plan, refused at once (${deep.ms.toFixed(1)} ms)`,
    String(deep.error).includes('motion:unreadable-plan') && deep.ms < 100 * SLOW, deep.ms);
  const deeper = await timedAsync(answer('{"a":'.repeat(20_000) + '1' + '}'.repeat(20_000)));
  const runaway = await timedAsync(answer('{'.repeat(64_000)));
  ok(`an edit answered 20,000 objects deep or with 64,000 "{" is unreadable, at once (${deeper.ms.toFixed(1)} ms, ${runaway.ms.toFixed(1)} ms)`,
    String(deeper.error).includes('motion:unreadable-edit') && String(runaway.error).includes('motion:unreadable-edit') && deeper.ms < 100 * SLOW && runaway.ms < 100 * SLOW,
    [String(deeper.error), String(runaway.error)]);
  const curly = timed(() => objectIn('{\u201Ca\u201D:'.repeat(8_000)));
  const padded = timed(() => objectIn('{'.repeat(200) + 'x'.repeat(120_000) + '}'.repeat(200)));
  ok(`curly quotes nested 8,000 deep, and 200 "{" around 120 KB: ${curly.ms.toFixed(1)} ms and ${padded.ms.toFixed(1)} ms`,
    curly.ms < 100 * SLOW && padded.ms < 200 * SLOW, [curly.ms, padded.ms]);
}

// ── where the plan is ─────────────────────────────────────────────────────
console.log('finding the plan');
{
  const replies = [
    'I kept it short ({"seconds": 8}) as asked. Here is the plan:\n{"recipe":"big-title","seconds":8,"fields":{"title":"Hello there"}}',
    'The words are English, so {"lang":"en"}.\n```json\n{"recipe":"big-title","fields":{"title":"Hello there"}}\n```',
    'Vertical fits Reels best: {"format":"portrait"}\n{"recipe":"big-title","format":"portrait","fields":{"title":"Hello there"}}',
    'The template is {"recipe":"big-title"}; here it is filled in: {"recipe":"big-title","fields":{"title":"Hello there"}}',
  ];
  const got = replies.map((text) => { const r = timed(() => parsePlan(text, req)); return r.error ? String(r.error) : titleOf(r.value); });
  ok('the plan is the object that carries it, not a setting or a template\'s name quoted in braces before it', got.every((t) => t === 'Hello there'), got);
  const portrait = parsePlan(replies[2], req);
  ok('and the plan\'s own settings are read from it', portrait.format === 'portrait');
  const wrapped = parsePlan('{"reply":"ok","lang":"en","plan":{"recipe":"big-title","fields":{"title":"Hello there"}}}', req);
  ok('a plan wrapped in another object is found inside it', titleOf(wrapped) === 'Hello there');
  const settingsOnly = parsePlan('{"title":"Big sale","subtitle":"Half off","kicker":"Today","lang":"en"}', req);
  ok('an answer that is only a template\'s words and a setting is still read', settingsOnly.recipe?.id === 'big-title', settingsOnly.recipe);
  const r = await answer('I will use {"op":"format"} like this: {"say":"Done.","ops":[{"op":"format","value":"portrait"}]}')();
  ok('an edit is found after a sentence that quotes an op in braces', r.motion.format === 'portrait' && r.said === 'Done.');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
