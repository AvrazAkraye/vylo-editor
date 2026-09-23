// How hard the model thinks before it answers.
//
// The table is the part that can break a plan. Haiku 4.5 rejects the field
// with a 400 on every request, and the trial plan is Haiku only — so the one
// wrong answer here that matters most is a level sent to Haiku, which would
// fail every turn for everybody who has just signed up.
//
// The other group worth reading is the default. Through the Vylo gateway,
// leaving the field out does not give the model's own default: the gateway
// applies its own, and runs Opus 5.5 at `low` for another product. So this
// module always produces a level for a model that takes one, and the tests
// hold it to that.
import {
  EFFORTS, EFFORT_KEY, defaultEffort, effortField, effortOf, effortsFor, fit,
  readEfforts, setEffort, takesEffort, writeEfforts,
} from '../.test-build/effort.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (xs, ys) => JSON.stringify(xs) === JSON.stringify(ys);
const ALL = ['low', 'medium', 'high', 'xhigh', 'max'];

ok('five levels, least to most', same(EFFORTS, ALL));
ok('stored under a versioned key', /\.v\d+$/.test(EFFORT_KEY));

// ── which models take it ──────────────────────────────────────────────────
// The plan models first, because they are what somebody can actually pick.
ok('Opus 5.5 takes all five', same(effortsFor('claude-opus-5-5'), ALL));
ok('Opus 4.8 takes all five', same(effortsFor('claude-opus-4-8'), ALL));
ok('Sonnet 5 takes all five', same(effortsFor('claude-sonnet-5'), ALL));
// The one that must never be sent a level.
ok('Haiku 4.5 takes none', same(effortsFor('claude-haiku-4-5'), []));
ok('and so it takes no effort at all', !takesEffort('claude-haiku-4-5'));

ok('Opus 5 takes all five', same(effortsFor('claude-opus-5'), ALL));
ok('Opus 4.7 takes all five', same(effortsFor('claude-opus-4-7'), ALL));
ok('Fable 5.1 takes all five', same(effortsFor('claude-fable-5-1'), ALL));
ok('Mythos 5.1 takes all five', same(effortsFor('claude-mythos-5-1'), ALL));
// `xhigh` arrived with Opus 4.7.
ok('the 4.6 models have no xhigh',
   same(effortsFor('claude-opus-4-6'), ['low', 'medium', 'high', 'max'])
   && same(effortsFor('claude-sonnet-4-6'), ['low', 'medium', 'high', 'max']));
ok('Opus 4.5 takes three', same(effortsFor('claude-opus-4-5'), ['low', 'medium', 'high']));
ok('Sonnet 4.5 takes none', same(effortsFor('claude-sonnet-4-5'), []));
ok('nor does Opus 4', same(effortsFor('claude-opus-4'), []));

// Read from the family and version, so the next Opus is covered the day it
// ships rather than the day this file is edited.
ok('a newer Opus in the line is covered', same(effortsFor('claude-opus-6'), ALL));
ok('and a newer Sonnet', same(effortsFor('claude-sonnet-5-5'), ALL));
// But not a newer Haiku: no Haiku has taken the field, and assuming the next
// one will is a guess that fails every turn.
ok('but not a newer Haiku', same(effortsFor('claude-haiku-5'), []));

// A date suffix is not a minor version: this is Opus 4, which takes nothing,
// and reading it as Opus 4.20250514 would hand it every level.
ok('a date suffix is not read as a version', same(effortsFor('claude-opus-4-20250514'), []));
ok('a dated 4.5 is still 4.5', same(effortsFor('claude-sonnet-4-5-20250929'), []));
ok('and a dated Opus 4.1 is not 4.7', same(effortsFor('claude-opus-4-1-20250805'), []));

ok('case and spacing do not matter', same(effortsFor('  Claude-Opus-5-5 '), ALL));
ok('an unknown model gets no control rather than a guess',
   same(effortsFor('my-local-llama'), []) && same(effortsFor('gpt-5'), []));
ok('nothing is nothing', same(effortsFor(''), []) && same(effortsFor(null), []));

// ── the defaults ──────────────────────────────────────────────────────────
// Every model that takes effort defaults to high, except Opus 5.5.
ok('Opus 5.5 starts at medium, as Anthropic tuned it', defaultEffort('claude-opus-5-5') === 'medium');
ok('Opus 4.8 starts at high', defaultEffort('claude-opus-4-8') === 'high');
ok('Sonnet 5 starts at high', defaultEffort('claude-sonnet-5') === 'high');
ok('Opus 5 starts at high, unlike its successor', defaultEffort('claude-opus-5') === 'high');
ok('Haiku has no default because it has no field', defaultEffort('claude-haiku-4-5') === null);

// ── fitting a level to a model ────────────────────────────────────────────
ok('a level the model takes is kept', fit('claude-opus-5-5', 'xhigh') === 'xhigh');
// Down rather than up: quietly spending more than was asked for is the worse
// surprise.
ok('xhigh on a 4.6 model rounds down to high', fit('claude-opus-4-6', 'xhigh') === 'high');
ok('max on Opus 4.5 rounds down to high', fit('claude-opus-4-5', 'max') === 'high');
ok('a model that takes none fits to nothing', fit('claude-haiku-4-5', 'high') === null);
ok('every level fits every effort model to something it takes',
   ['claude-opus-5-5', 'claude-opus-4-6', 'claude-opus-4-5', 'claude-sonnet-5'].every((m) =>
     ALL.every((l) => effortsFor(m).includes(fit(m, l)))));

// ── what is stored ────────────────────────────────────────────────────────
ok('nothing stored is no choices', same(readEfforts(null), {}) && same(readEfforts(''), {}));
ok('and rubbish is no choices, never a throw',
   same(readEfforts('{'), {}) && same(readEfforts('[]'), {}) && same(readEfforts('"x"'), {}));
ok('a stored choice comes back',
   readEfforts(writeEfforts({ 'claude-opus-5-5': 'xhigh' }))['claude-opus-5-5'] === 'xhigh');
ok('a level that is not a level is dropped',
   same(readEfforts(JSON.stringify({ 'claude-opus-5-5': 'turbo' })), {}));
// Kept even when the model does not take it today, because `effortOf` fits it
// on the way out — discarding it here would forget a choice the moment a
// model's table changed.
ok('a level a model does not take is kept, to be fitted later',
   readEfforts(JSON.stringify({ 'claude-opus-4-6': 'xhigh' }))['claude-opus-4-6'] === 'xhigh');

ok('setting one model leaves the others', (() => {
  const b = setEffort({ 'claude-sonnet-5': 'low' }, 'claude-opus-5-5', 'max');
  return b['claude-sonnet-5'] === 'low' && b['claude-opus-5-5'] === 'max';
})());
ok('nothing passed in is changed', (() => {
  const before = { 'claude-sonnet-5': 'low' };
  setEffort(before, 'claude-opus-5-5', 'max');
  return Object.keys(before).length === 1;
})());
ok('a rubbish level is refused', setEffort({}, 'claude-opus-5-5', 'turbo')['claude-opus-5-5'] === undefined);

// ── what is sent ──────────────────────────────────────────────────────────
// The choice for this model, fitted; else its own default. Never "leave it
// out and let the gateway decide", because the gateway decides `low`.
ok('nothing chosen sends the model default', effortOf({}, 'claude-opus-5-5') === 'medium');
ok('a choice is sent as chosen', effortOf({ 'claude-opus-5-5': 'xhigh' }, 'claude-opus-5-5') === 'xhigh');
ok('a choice for one model does not leak onto another',
   effortOf({ 'claude-opus-5-5': 'max' }, 'claude-sonnet-5') === 'high');
ok('a choice a model cannot take is fitted',
   effortOf({ 'claude-opus-4-6': 'xhigh' }, 'claude-opus-4-6') === 'high');
ok('a model that takes none sends none', effortOf({ 'claude-haiku-4-5': 'max' }, 'claude-haiku-4-5') === null);

{
  const f = effortField('anthropic', {}, 'claude-opus-5-5');
  ok('the field is output_config.effort', f.output_config?.effort === 'medium', f);
}
// The trial plan is Haiku only. This is the assertion that keeps it working.
ok('Haiku gets no field at all, not an empty one',
   !('output_config' in effortField('anthropic', { 'claude-haiku-4-5': 'high' }, 'claude-haiku-4-5')));
// The OpenAI-shaped providers have their own reasoning control, under another
// name with other levels; translating would be a guess about their API.
ok('the OpenAI wire gets no field',
   !('output_config' in effortField('openai', { 'claude-opus-5-5': 'high' }, 'claude-opus-5-5')));
ok('an unknown model gets no field', !('output_config' in effortField('anthropic', {}, 'my-local-llama')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
