// The Motion panel's decisions, without React (src/motionstate.ts).
//
// What matters. The request form sends only what the person chose — Auto is
// left to the model — and a template takes the chosen shape or wide. The
// placeholder shown while the model works is a valid, empty graphic in the
// shape asked for, titled with the request's first words. The list is newest
// change first. An edit with the history's key joins the step before it, a
// model's change in between starts the history again, and a drag's release
// ends its step. A drag that comes back to where it began changed nothing —
// not even the template link that moving a layer drops. The keys do what the
// panel says they do, and nothing while the cursor is in a field. An answer
// from the Ask tab is applied only to the graphic it was made for. And every
// note the model's answer can carry is said as a sentence, through `t`.
import {
  LENGTHS, LOG_CAP, SHAPES, TOP_TEMPLATES, answerFate, askLine, canMake, clock, dragChanged, endStep, errorText, fitWidth,
  formatName, formatRatio, freshDraft, JOURNAL_MAX, journalOf, keyAction, langName, logged, moveKey, noteText, placeholderOf, planLine, planRequestOf,
  quoted, recordEdit, secondsText, sortMotions, suggestions, tabStep, templateOptions, titleOfRequest, toneName, withJournal,
} from '../.test-build/motionstate.js';
import { COALESCE_MS, emptyHistory } from '../.test-build/motionhistory.js';
import { MAX_OPS } from '../.test-build/motionchatops.js';
import { LIMITS, RECIPE_IDS } from '../.test-build/motiontypes.js';
import { PALETTES } from '../.test-build/motionrecipe.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

/** The English sentence, as the catalogue's key. */
const en = (s) => s;
/** A translation that shows it was asked: every sentence said through `t` comes back marked. */
const marked = (s) => `«${s}»`;

const NOW = 1_700_000_000_000;
/** The isolates the panel sets outside words in: FIRST STRONG ISOLATE and POP DIRECTIONAL ISOLATE. */
const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);

function freeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) freeze(v);
  }
  return x;
}

const text = (id, o = {}) => ({
  id, name: id, start: 0, end: 6, pin: 'mc', x: 0, y: 0, scale: 1, rot: 0, opacity: 1,
  kind: 'text', text: 'Hello', voice: 'sans', size: 8, weight: 700, color: 'fg', align: 'center', lead: 1.15, track: 0, caps: false, max: 0, fit: false,
  ...o,
});
const doc = (o = {}) => freeze({
  id: 'g1', title: 'Hand', request: '', lang: 'en', format: 'landscape', fps: 30, seconds: 6,
  palette: { bg: '#000000', fg: '#FFFFFF', accent: '#4C8DFF', accent2: '#FF6AA2', muted: '#888888' }, backdrop: 'bg',
  layers: [text('title', { y: -5 }), text('sub', { y: 10, size: 4 })], stage: 'ready', created: 1, updated: 1,
  ...o,
});

// ── the request form ──

{
  const d = freshDraft();
  ok('a fresh draft is empty and Auto everywhere', d.request === '' && d.format === null && d.seconds === null && d.palette === null && !d.autostart && d.error === null);
  ok('and a new one each time', freshDraft() !== freshDraft());
  ok('the form offers the four shapes', SHAPES.join() === 'landscape,portrait,square,feed');
  ok('and four lengths besides Auto', LENGTHS.join() === '4,6,10,15');
  ok('six templates, each a real one', TOP_TEMPLATES.length === 6 && TOP_TEMPLATES.every((id) => RECIPE_IDS.includes(id)) && new Set(TOP_TEMPLATES).size === 6);
}

{
  const auto = planRequestOf({ request: '  a lower third for Sara  ', format: null, seconds: null, palette: null }, 'ar');
  ok('the words go as written, trimmed', auto.request === 'a lower third for Sara');
  ok('Auto is left to the model', auto.format === null && auto.seconds === null && auto.palette === null && auto.recipe === null);
  ok('in the interface language', auto.lang === 'ar');
  const chosen = planRequestOf({ request: 'x', format: 'portrait', seconds: 10, palette: 'sunset' }, 'en');
  ok('what the person chose is sent', chosen.format === 'portrait' && chosen.seconds === 10 && chosen.palette === 'sunset');
}

{
  const d = templateOptions({ format: null, palette: null });
  ok('a template on Auto is wide, in its own palette', d.format === 'landscape' && d.palette === undefined);
  const c = templateOptions({ format: 'square', palette: 'mint' });
  ok('and takes the shape and palette chosen', c.format === 'square' && c.palette === 'mint');
}

ok('Make it needs words', !canMake({ request: '   ' }, true));
ok('and a model to send them to', !canMake({ request: 'a title' }, false));
ok('and then it can', canMake({ request: 'a title' }, true));

{
  ok('a title is the request\'s first words', titleOfRequest('A lower third for Sara Ahmed, head of design, in blue') === 'A lower third for Sara Ahmed,…');
  ok('a short request is its own title', titleOfRequest('Big title') === 'Big title');
  ok('from its first line with words', titleOfRequest('\n\n  Countdown   from ten \nthen GO') === 'Countdown from ten');
  ok('nothing is nothing', titleOfRequest('   ') === '');
  const long = titleOfRequest('Supercalifragilisticexpialidocious '.repeat(3));
  ok('a title never runs past a name\'s length', Array.from(long).length <= LIMITS.name + 1 && long.endsWith('…'), long);
  const ar = titleOfRequest('عنوان كبير يرتفع سطرا بعد سطر فوق خلفية متحركة');
  ok('words in Arabic are counted as words', ar === 'عنوان كبير يرتفع سطرا بعد سطر…', ar);
}

{
  const p = placeholderOf({ id: 'abc123', request: '  A bar chart of visitors  ', lang: 'ckb', draft: { format: null, seconds: null, palette: null }, now: NOW });
  ok('the placeholder is being made, with nothing in it yet', p.stage === 'planning' && p.layers.length === 0 && p.ai === true);
  ok('it keeps the id it was given and the time', p.id === 'abc123' && p.created === NOW && p.updated === NOW);
  ok('its words are the request, trimmed, in the language asked', p.request === 'A bar chart of visitors' && p.lang === 'ckb' && p.title === 'A bar chart of visitors');
  ok('on Auto it is wide, six seconds, in the first palette', p.format === 'landscape' && p.seconds === 6 && p.palette.bg === PALETTES[0].colors.bg);
  ok('its palette is its own copy', p.palette !== PALETTES[0].colors);
  const q = placeholderOf({ id: 'x', request: 'r', lang: 'en', draft: { format: 'feed', seconds: 15, palette: 'daylight' }, now: NOW });
  ok('with choices, it has them', q.format === 'feed' && q.seconds === 15 && q.palette.bg === PALETTES.find((x) => x.id === 'daylight').colors.bg);
  ok('it is a graphic the reader keeps as it is', q.fps === 30 && q.backdrop === 'bg');
}

// ── the list, and names ──

{
  const list = freeze([
    { id: 'a', updated: 5, created: 1 },
    { id: 'b', updated: 9, created: 2 },
    { id: 'c', updated: 5, created: 3 },
    { id: 'd', updated: 5, created: 3 },
  ]);
  const sorted = sortMotions(list).map((m) => m.id).join('');
  ok('the one changed last comes first, then the newer, then by id', sorted === 'bcda', sorted);
  ok('sorting leaves the list as it was', list[0].id === 'a');
  ok('it takes any iterable, such as a Map\'s values', sortMotions(new Map([['x', { id: 'x', updated: 1, created: 1 }]]).values()).length === 1);
}

ok('the shapes have names, through t', formatName('landscape', marked) === '«Wide 16:9»' && formatName('portrait', en) === 'Vertical 9:16'
  && formatName('square', en) === 'Square 1:1' && formatName('feed', en) === 'Feed 4:5');
ok('and ratios, the same in every language', formatRatio('landscape') === '16:9' && formatRatio('feed') === '4:5' && formatRatio('nonsense') === '16:9');
ok('languages are named', langName('ar', en) === 'Arabic' && langName('ckb', en) === 'Kurdish — Sorani' && langName('kmr', en) === 'Kurdish — Badini' && langName('en', en) === 'English');
ok('a length is said in seconds, through t', secondsText(6, en) === '6 s' && secondsText(4.46, en) === '4.5 s' && secondsText(NaN, en) === '0 s' && secondsText(6, marked) === '«6 s»');
ok('a wide thumbnail takes the box\'s width', fitWidth('landscape', 64, 40) === 64);
ok('a tall one takes the height, and is narrower', fitWidth('portrait', 64, 40) === 22 && fitWidth('square', 64, 40) === 40 && fitWidth('feed', 64, 40) === 32);

// ── a run, in words ──

ok('the clock reads minutes and seconds', clock(0) === '0:00' && clock(7_400) === '0:07' && clock(754_000) === '12:34');
ok('and hours past an hour', clock(3_723_000) === '1:02:03');
ok('and nonsense as nothing', clock(NaN) === '0:00' && clock(-5) === '0:00');
{
  const lines = new Set([0, 4000, 8000, 12000].map((ms) => planLine(ms, 0, en)));
  ok('while the model thinks, the line changes every few seconds', lines.size === 4 && [...lines].every((l) => l.endsWith('…')));
  ok('and says it is writing once its answer arrives', planLine(4000, 120, en) === 'Writing the graphic…');
  ok('the Ask tab has lines of its own', new Set([0, 4000, 8000, 12000].map((ms) => askLine(ms, en))).size === 4);
  ok('said through t', planLine(0, 0, marked).startsWith('«'));
}
{
  ok('a plan the model wrote badly is said in words', errorText(new Error('motion:unreadable-plan'), en, 'make the graphic').startsWith('The graphic could not be read'));
  ok('and a change', errorText(new Error('motion:unreadable-edit'), en, 'x').startsWith('The change could not be read'));
  ok('any other engine code gets a sentence too, never the code', !errorText(new Error('motion:something-new'), en, 'x').includes('motion:'));
  const odd = errorText(new Error('Something odd happened'), en, 'make the graphic');
  ok('anything else says what was being done', odd === 'Could not make the graphic. Something odd happened.', odd);
  ok('the engine\'s sentences go through t', errorText(new Error('motion:unreadable-plan'), marked, 'x').startsWith('«'));
  // What generate.ts throws, said in the interface's language: every sentence through t, nothing left in English.
  const status = (message, n) => Object.assign(new Error(message), { status: n });
  const k401 = errorText(status('The API key was rejected. Check it in Settings. (invalid x-api-key)', 401), marked, 'x', 'capi.vylo-tech.com');
  ok('a refused key names the server it went to, through t', k401.startsWith('«') && k401.includes(`${FSI}capi.vylo-tech.com${PDI}`) && !k401.includes('API key was rejected'), k401);
  const k500 = errorText(status('The server answered 500: Internal server error', 500), marked, 'x');
  ok('a server in trouble is said, not quoted', k500 === '«The server is having trouble.» «This is the server, not your account — try again shortly.»', k500);
  ok('an overload that came mid-stream is the same', errorText(new Error('Overloaded'), en, 'x').startsWith('The server is having trouble.'));
  const k429 = errorText(status('Rate limited — wait a moment. (slow down)', 429), marked, 'x');
  ok('a limit reached says to wait', k429.includes('«Wait a minute and try again.»') && !k429.includes('Rate limited'), k429);
  const k403 = errorText(status('The server answered 403: claude-x is not included in your plan. Available: a, b', 403), marked, 'x');
  ok('any other refusal keeps the server\'s own words, isolated', k403.startsWith('«The server answered {n}.»'.replace('{n}', '403')) && k403.includes(`${FSI}claude-x is not included`), k403);
  const net = errorText(new Error('Could not reach https://gw.example. Check the address in Settings, that you are online, and that the gateway allows this app (the underlying error was: Load failed).'), marked, 'x');
  ok('a connection that failed is said in words, through t', net === '«Could not reach that server.» «Check the address in Settings and that you are online.»', net);
  ok('and so is the platform\'s own network error', errorText(new TypeError('Load failed'), en, 'x').startsWith('Could not reach that server.'));
}
{
  const RLO = String.fromCharCode(0x202e);
  const q = quoted(`logo${RLO}evil`);
  ok('an outside value is isolated', q.startsWith(FSI) && q.endsWith(PDI), q);
  ok('a direction override inside it is dropped', !q.includes(RLO) && q.includes('logoevil'), q);
  ok('a long one is cut, with an ellipsis', Array.from(quoted('x'.repeat(500))).length === 42 && quoted('x'.repeat(500)).includes('…'));
  ok('a line break is a space', quoted('a\n\nb') === `${FSI}a b${PDI}`);
  ok('an isolate it carried cannot close ours early', !quoted(`a${PDI}b`).slice(1, -1).includes(PDI));
  ok('anything is turned into words', quoted(undefined) === `${FSI}${PDI}` && quoted(42) === `${FSI}42${PDI}`);
}

// ── the unload journal ──
{
  const a = doc({ id: 'ga', updated: 10 });
  const b = doc({ id: 'gb', title: 'Bee', updated: 20 });
  const back = journalOf(JSON.stringify([a, b]));
  ok('a journal the panel wrote reads back as its graphics', back.length === 2 && back[0].id === 'ga' && back[1].title === 'Bee', back.map((m) => m.id));
  ok('nothing, garbage, a non-list or an oversized text is no graphics', [null, undefined, '', 'not json', '{"id":"x"}', '42', `[${'1,'.repeat(10)}1]`, 'x'.repeat(JOURNAL_MAX + 1)]
    .every((x) => journalOf(x).length === 0));
  ok('a graphic whose id the reader had to replace is left out', journalOf(JSON.stringify([{ ...a, id: '' }, { ...a, id: 42 }])).length === 0);
  ok('an unfinished one is left out', journalOf(JSON.stringify([{ ...a, stage: 'planning', layers: [] }])).length === 0);
  ok('at most fifty', journalOf(JSON.stringify(Array.from({ length: 80 }, (_, i) => ({ ...a, id: `g${i}` })))).length === 50);
  ok('a hostile record is read, not trusted', (() => { const m = journalOf(JSON.stringify([{ ...a, seconds: 1e9, layers: 'x', title: 7 }]))[0]; return !!m && m.seconds <= LIMITS.seconds && Array.isArray(m.layers); })());

  const stored = [doc({ id: 'ga', title: 'Stored', updated: 10 }), doc({ id: 'gc', updated: 5 })];
  const newer = doc({ id: 'ga', title: 'Typed last', updated: 11 });
  const w = withJournal(stored, [newer, doc({ id: 'gd', title: 'Never stored', updated: 3 })]);
  ok('a newer copy replaces the stored one and is written again', w.list.find((m) => m.id === 'ga')?.title === 'Typed last' && w.write.some((m) => m.id === 'ga'));
  ok('one the store never got is added and written', w.list.some((m) => m.id === 'gd') && w.write.some((m) => m.id === 'gd'));
  ok('the rest are as stored, none lost', w.list.length === 3 && w.list.find((m) => m.id === 'gc') === stored[1]);
  const same = withJournal(stored, [doc({ id: 'ga', title: 'Old copy', updated: 10 })]);
  ok('a copy no newer than the stored one changes nothing', same.write.length === 0 && same.list.find((m) => m.id === 'ga')?.title === 'Stored');
}

// ── undo ──

ok('a drag\'s key names the layer', moveKey('title') === 'move:title' && moveKey('a') !== moveKey('b'));
{
  const a = doc();
  const b = freeze({ ...a, layers: [{ ...a.layers[0], text: 'Hel' }, a.layers[1]], updated: 2 });
  const c = freeze({ ...b, layers: [{ ...b.layers[0], text: 'Hello there' }, b.layers[1]], updated: 3 });
  let h = recordEdit(undefined, a, b, NOW, 'layer:title:text');
  ok('a first edit is one step back to where it began', h.past.length === 1 && h.past[0] === a && h.present === b);
  h = recordEdit(h, b, c, NOW + 400, 'layer:title:text');
  ok('typing on in the same field joins that step', h.past.length === 1 && h.present === c);
  const d2 = freeze({ ...c, seconds: 8, updated: 4 });
  h = recordEdit(h, c, d2, NOW + 800);
  ok('an edit with no key is a step of its own', h.past.length === 2);
  const e = freeze({ ...d2, layers: [{ ...d2.layers[0], text: 'Late' }, d2.layers[1]], updated: 5 });
  const late = recordEdit(h, d2, e, NOW + 800 + COALESCE_MS + 1, 'layer:title:text');
  ok('the same key after a pause is a new step', late.past.length === 3);
  // The model changes the graphic between two edits: the history starts again from what it left.
  const model = freeze({ ...d2, palette: { ...d2.palette, accent: '#00FF00' }, updated: 6 });
  const after = freeze({ ...model, title: 'Mine', updated: 7 });
  const fresh = recordEdit(h, model, after, NOW + 900);
  ok('a change the model made in between starts the history again from it', fresh.past.length === 1 && fresh.past[0] === model);
  const same = recordEdit(h, d2, freeze({ ...d2, updated: 99 }), NOW + 950);
  ok('a new clock alone is not a step', same.past.length === h.past.length);
  ok('ending a step drops its key', endStep(h).key === null && endStep(late).key === null && late.key === 'layer:title:text');
  const ended = endStep(endStep(late));
  ok('and a step already ended is the same history', endStep(ended) === ended);
  const joined = recordEdit(endStep(late), e, freeze({ ...e, layers: [{ ...e.layers[0], text: 'Later' }, e.layers[1]] }), NOW + 800 + COALESCE_MS + 2, 'layer:title:text');
  ok('after a release, the same key does not join', joined.past.length === 4);
  ok('an empty history has nothing to give back', emptyHistory(a).past.length === 0);
}

{
  const base = doc({ recipe: { id: 'big-title', fields: { title: 'Hello' } } });
  const moving = freeze({ ...base, recipe: undefined, layers: [{ ...base.layers[0], x: 12, y: 3 }, base.layers[1]], updated: 5 });
  ok('a drag that came back to where it began changed nothing', !dragChanged(base, moving, 'title', 0, -5));
  ok('not even the template link it dropped on the way', !dragChanged(base, base, 'title', 0, -5));
  ok('a drag that ended somewhere else changed the graphic', dragChanged(base, moving, 'title', 12, 3));
  ok('a drag of a layer that is gone changes nothing more', !dragChanged(base, base, 'nope', 5, 5));
  const other = freeze({ ...moving, seconds: 9 });
  ok('and a graphic changed meanwhile by something else is a change', dragChanged(base, other, 'title', 0, -5));
}

// ── keys ──

{
  const k = (key, o = {}) => keyAction({ key, meta: false, ctrl: false, shift: false, alt: false, mac: true, field: false, ...o });
  ok('⌘Z undoes on a Mac', k('z', { meta: true }) === 'undo' && k('Z', { meta: true }) === 'undo');
  ok('⇧⌘Z redoes', k('z', { meta: true, shift: true }) === 'redo' && k('Z', { meta: true, shift: true }) === 'redo');
  ok('Ctrl+Z is not undo on a Mac', k('z', { ctrl: true }) === null);
  ok('Ctrl+Z and Ctrl+Y elsewhere', k('z', { ctrl: true, mac: false }) === 'undo' && k('y', { ctrl: true, mac: false }) === 'redo'
    && k('z', { ctrl: true, shift: true, mac: false }) === 'redo');
  ok('⌘Y is not redo on a Mac', k('y', { meta: true }) === null);
  ok('⌘D duplicates, Ctrl+D elsewhere', k('d', { meta: true }) === 'duplicate' && k('d', { ctrl: true, mac: false }) === 'duplicate' && k('d', { meta: true, shift: true }) === null);
  ok('Delete and Backspace remove', k('Delete') === 'remove' && k('Backspace') === 'remove');
  ok('Escape lets go', k('Escape') === 'escape');
  ok('with a modifier they are something else\'s', k('Backspace', { meta: true }) === null && k('Escape', { alt: true }) === null && k('Delete', { ctrl: true }) === null);
  ok('⌥⌘Z is not undo', k('z', { meta: true, alt: true }) === null);
  ok('in a field every key is the field\'s', k('z', { meta: true, field: true }) === null && k('Backspace', { field: true }) === null && k('Escape', { field: true }) === null);
  ok('Space, the arrows, comma and full stop are the stage\'s', [' ', 'ArrowLeft', 'ArrowRight', ',', '.', 'd', 'z'].every((x) => k(x) === null));
}

// ── the tab list ──
//
// A tab list is one Tab stop and the arrows go from tab to tab, opening each. In a right-to-left interface the tabs
// run from the right, so the next one is to the LEFT: the arrow that moves forward is the one pointing that way.

{
  const n = 4;
  ok('→ goes to the next tab, left to right', tabStep(0, 'ArrowRight', false, n) === 1 && tabStep(2, 'ArrowRight', false, n) === 3);
  ok('← goes back, left to right', tabStep(2, 'ArrowLeft', false, n) === 1);
  ok('right to left, ← is the next tab and → the one before', tabStep(0, 'ArrowLeft', true, n) === 1 && tabStep(2, 'ArrowRight', true, n) === 1);
  ok('the arrows go round at either end, in both directions',
    tabStep(3, 'ArrowRight', false, n) === 0 && tabStep(0, 'ArrowLeft', false, n) === 3 && tabStep(3, 'ArrowLeft', true, n) === 0 && tabStep(0, 'ArrowRight', true, n) === 3);
  ok('Home and End go to the first and the last, whichever the direction',
    tabStep(2, 'Home', false, n) === 0 && tabStep(1, 'End', false, n) === 3 && tabStep(2, 'Home', true, n) === 0 && tabStep(1, 'End', true, n) === 3);
  ok('up, down, Space and Enter are not the list\'s', ['ArrowUp', 'ArrowDown', ' ', 'Enter', 'Tab', 'a'].every((k) => tabStep(1, k, false, n) === null));
  ok('a tab that is not in the list starts from the first', tabStep(-1, 'ArrowRight', false, n) === 1 && tabStep(9, 'ArrowLeft', false, n) === 3 && tabStep(NaN, 'ArrowRight', true, n) === 3);
  ok('an empty list goes nowhere', tabStep(0, 'ArrowRight', false, 0) === null && tabStep(0, 'Home', false, 0) === null);
  ok('one tab stays itself', tabStep(0, 'ArrowRight', false, 1) === 0 && tabStep(0, 'ArrowLeft', true, 1) === 0);
}

// ── the Ask tab ──

{
  const turns = Array.from({ length: LOG_CAP + 5 }, (_, i) => ({ who: 'you', text: String(i), at: i }));
  const log = logged([], turns);
  ok('a long conversation keeps its newest turns', log.length === LOG_CAP && log[log.length - 1].text === String(LOG_CAP + 4));
  const two = logged(freeze([{ who: 'you', text: 'a', at: 1 }]), [{ who: 'motion', text: 'b', at: 2 }]);
  ok('turns are added after, in a new list', two.length === 2 && two[1].text === 'b');
}

{
  const sent = doc();
  ok('an answer for a graphic that is gone is dropped', answerFate(sent, undefined, [{ code: 'title', value: 'x' }]) === 'gone');
  ok('one for the graphic as it was sent is applied', answerFate(sent, sent, [{ code: 'title', value: 'x' }]) === 'apply');
  ok('a saved copy of it is still the same graphic', answerFate(sent, freeze({ ...sent, updated: 50 }), [{ code: 'title', value: 'x' }]) === 'apply');
  ok('one that changed nothing applies nothing', answerFate(sent, sent, []) === 'nothing');
  const edited = freeze({ ...sent, layers: [{ ...sent.layers[0], text: 'Changed meanwhile' }, sent.layers[1]] });
  ok('one for a graphic the person changed meanwhile is not applied', answerFate(sent, edited, [{ code: 'title', value: 'x' }]) === 'moved');
}

{
  const s = suggestions(en);
  ok('five suggestions, sent as they are', s.length === 5 && s.includes('Make it faster') && s.includes('Add a subtitle'));
  ok('in the interface\'s language', suggestions(marked).every((x) => x.startsWith('«')));
}

{
  const all = [
    { code: 'fields', keys: ['title', 'subtitle'] },
    { code: 'palette', id: 'sunset', name: 'Sunset' },
    { code: 'colors', tones: ['accent', 'bg'] },
    { code: 'seconds', value: 8 },
    { code: 'format', value: 'portrait' },
    { code: 'lang', value: 'ar' },
    { code: 'title', value: 'Launch day' },
    { code: 'layer', id: 'big-title-title', name: 'Title' },
    { code: 'add', id: 'l9', name: 'Text', kind: 'text' },
    { code: 'remove', id: 'l3', name: 'Rule' },
    { code: 'recipe', id: 'lower-third', name: 'Lower third' },
    { code: 'speed', value: 1.5 },
    { code: 'speed', value: 0.7 },
    { code: 'detached' },
    { code: 'sample' },
    { code: 'unknown', op: 'sparkle' },
    { code: 'invalid', op: 'layer', field: 'size' },
    { code: 'invalid', op: 'layer' },
    { code: 'no-layer', op: 'layer', id: 'logo' },
    { code: 'no-field', op: 'layer', field: 'glow' },
    { code: 'not-template', op: 'fields' },
    { code: 'unsourced', field: 'value' },
    { code: 'untranslated', value: 'ckb' },
    { code: 'refused', op: 'add', field: 'src' },
    { code: 'no-data', op: 'add' },
    { code: 'full', op: 'add' },
    { code: 'too-many', count: 3 },
  ];
  const said = all.map((n) => noteText(n, en));
  ok('every note is a sentence', said.every((x) => typeof x === 'string' && x.trim().length > 4 && !x.includes('{')), said.filter((x) => x.includes('{')));
  ok('no two notes say the same', new Set(said).size === said.length);
  ok('every note is said through t', all.every((n) => noteText(n, marked).includes('«')));
  const byCode = Object.fromEntries(all.map((n, i) => [`${n.code}${n.code === 'speed' ? n.value : n.code === 'invalid' ? (n.field ?? '') : ''}`, said[i]]));
  ok('words changed are named as the form names them', byCode.fields === 'New words: Title · Subtitle', byCode.fields);
  ok('and as that template\'s form names them, when it is known', noteText({ code: 'fields', keys: ['items'] }, en, 'bar-chart') === 'New words: Bars'
    && noteText({ code: 'fields', keys: ['items'] }, en, 'steps') === 'New words: Steps');
  ok('a field no template has is its key, isolated', noteText({ code: 'fields', keys: ['zzz'] }, en) === `New words: ${FSI}zzz${PDI}`);
  const RLO = String.fromCharCode(0x202e);
  const hostile = [
    { code: 'no-layer', op: 'layer', id: `logo${RLO}evil` }, { code: 'unknown', op: `spark${RLO}le` }, { code: 'no-field', op: 'layer', field: `gl${RLO}ow` },
    { code: 'invalid', op: 'layer', field: `si${RLO}ze` }, { code: 'refused', op: 'add', field: `s${RLO}rc` }, { code: 'title', value: `Launch${RLO} day` },
    { code: 'layer', id: 'a', name: `Ti${RLO}tle` }, { code: 'add', id: 'b', name: `Te${RLO}xt` }, { code: 'remove', id: 'c', name: `Ru${RLO}le` },
    { code: 'fields', keys: [`zz${RLO}z`] }, { code: 'unsourced', field: `val${RLO}ue` },
  ];
  const hs = hostile.map((n) => noteText(n, en));
  ok('what the model wrote cannot turn a sentence around: no override survives, and each value is isolated', hs.every((x) => !x.includes(RLO) && x.includes(FSI) && x.includes(PDI)), hs);
  ok('and a long id is cut', noteText({ code: 'no-layer', op: 'layer', id: 'y'.repeat(300) }, en).length < 120);
  ok('a palette by its name, translated', noteText({ code: 'palette', id: 'sunset', name: 'Sunset' }, marked) === '«Colours: «Sunset»»');
  ok('colours by their role', byCode.colors === 'New colour: Accent colour · Background', byCode.colors);
  ok('the length in seconds', byCode.seconds === 'The graphic now runs 8 s');
  ok('the shape by its name', byCode.format === 'Shape: Vertical 9:16');
  ok('the language by its name', byCode.lang === 'The words are now in Arabic');
  ok('faster and slower are different sentences', byCode['speed1.5'] === 'Everything moves 1.5 times as fast' && byCode['speed0.7'].includes('0.7') && byCode['speed0.7'] !== byCode['speed1.5']);
  ok('too many says the ceiling', byCode['too-many'].includes(String(MAX_OPS)));
  ok('a full graphic says how many layers it may hold', byCode.full.includes(String(LIMITS.layers)));
  ok('a field that could not be read is named, and one without a field is said plainly', byCode.invalidsize.includes('size') && byCode.invalid === 'Skipped a change that could not be read');
  ok('a note the app does not know is still a sentence', noteText({ code: 'from-the-future' }, en).length > 4);
  ok('the five colours have names', ['bg', 'fg', 'accent', 'accent2', 'muted'].map((x) => toneName(x, en)).every((x, i, a) => x && a.indexOf(x) === i));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
