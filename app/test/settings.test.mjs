// The settings catalogue, and the search box in the rail.
//
// Two things are being protected here, and only one of them is the search.
//
// The first is that nothing falls off the list. Settings was a flat block of
// about nine controls in `App.tsx`; the redesign spreads them across eight
// categories, and the way that goes wrong is silent — a control that nobody
// moved, noticed months later by somebody who cannot turn a thing back on. So
// the pre-redesign controls are named one by one below. Deleting an entry from
// `settings.ts` has to also mean deleting its name from this file, which is a
// decision rather than an oversight.
//
// The second is that the search actually searches. A box that matches
// "Appearance" and not "dark" looks like it works, which D6 settled is worse
// than not having it. The keyword tests are the whole point of the module: each
// one is a word somebody would type that appears nowhere in the label.
import { readFileSync } from 'fs';
import { CATEGORIES, SETTINGS, search, view } from '../.test-build/settings.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
};

/** English: the translator the app hands out when the language is `en`. */
const en = (s) => s;

/** Every id `search` returned, in the order it returned them. */
const ids = (groups) => groups.flatMap((g) => g.rows.map((r) => r.id));
const cats = (groups) => groups.map((g) => g.category.id);
const find = (groups, id) => ids(groups).includes(id);

// ── the catalogue is complete ─────────────────────────────────────────────
//
// The checklist. Every control the flat settings block held before the
// redesign, by name, on the left; where it went, on the right. If one of these
// fails, a person has lost a switch they cannot turn back on.
{
  const CARRIED_OVER = {
    gateway: 'account',            // the gateway address
    apiKey: 'account',             // the API key
    signedIn: 'account',           // who is signed in
    signOut: 'account',            // and the button that ends it
    theme: 'appearance',           // match system / light / dark
    language: 'appearance',
    inlineCompletion: 'editor',
    notifyWhen: 'notifications',   // when the agent needs me / for everything
    notifySound: 'notifications',
    globalShortcut: 'shortcuts',   // with its "press a combination" capture
    mcpServers: 'modules',         // the list, with enable/disable and a count
  };
  const by = new Map(SETTINGS.map((s) => [s.id, s]));
  for (const [id, category] of Object.entries(CARRIED_OVER)) {
    ok(`${id} survived the redesign, in ${category}`,
       by.get(id)?.category === category, `found ${by.get(id)?.category ?? 'nothing'}`);
  }

  const ADDED = ['plan', 'keyMap', 'autoApprove', 'modules', 'railSide', 'drafts', 'checkpoints', 'fileHistory',
                 'clipboardHistory', 'version', 'updates', 'safety'];
  for (const id of ADDED) ok(`${id} is in the catalogue`, by.has(id));

  ok('and there is nothing in the catalogue this file has not named',
     SETTINGS.length === Object.keys(CARRIED_OVER).length + ADDED.length,
     `${SETTINGS.length} entries, ${Object.keys(CARRIED_OVER).length + ADDED.length} named`);

  ok('ids are unique', new Set(SETTINGS.map((s) => s.id)).size === SETTINGS.length);
  ok('every setting names a category that exists',
     SETTINGS.every((s) => CATEGORIES.some((c) => c.id === s.category)),
     SETTINGS.filter((s) => !CATEGORIES.some((c) => c.id === s.category)).map((s) => s.id).join(', '));
  ok('and every category has at least one setting',
     CATEGORIES.every((c) => SETTINGS.some((s) => s.category === c.id)),
     CATEGORIES.filter((c) => !SETTINGS.some((s) => s.category === c.id)).map((c) => c.id).join(', '));
  ok('every setting carries at least one keyword',
     SETTINGS.every((s) => s.keywords.length > 0),
     SETTINGS.filter((s) => !s.keywords.length).map((s) => s.id).join(', '));
}

// ── the rail ──────────────────────────────────────────────────────────────
//
// An icon name that `Icon.tsx` does not draw renders as nothing at all — the
// component returns null for an unknown name — so the rail would show a column
// of labels with a hole where each glyph should be, and no error anywhere.
{
  const icons = new Set(
    [...readFileSync('src/Icon.tsx', 'utf8').matchAll(/^ {2}([a-z][\w]*):\s*\[/gm)].map((m) => m[1]),
  );
  ok('Icon.tsx parsed to a plausible set', icons.size > 20, `${icons.size} icons`);
  for (const c of CATEGORIES) {
    ok(`the ${c.id} icon is one Icon.tsx draws`, icons.has(c.icon), c.icon);
  }
  ok('exactly one category is pinned to the foot of the rail',
     CATEGORIES.filter((c) => c.foot).length === 1,
     CATEGORIES.filter((c) => c.foot).map((c) => c.id).join(', '));
  ok('and it is About, which is the one nobody opens on purpose',
     CATEGORIES.find((c) => c.foot)?.id === 'about');
  ok('no two categories share an icon',
     new Set(CATEGORIES.map((c) => c.icon)).size === CATEGORIES.length);
}

// ── an empty query ────────────────────────────────────────────────────────
//
// The dialog opens with the field empty. A list that is blank until you type
// looks broken rather than ready, so this is the case that matters most.
{
  const all = search('', en);
  ok('an empty query returns every category', cats(all).length === CATEGORIES.length);
  ok('and every setting', ids(all).length === SETTINGS.length, `${ids(all).length}`);
  ok('a query of nothing but spaces does the same',
     ids(search('   ', en)).length === SETTINGS.length);
  ok('the categories come back in rail order',
     cats(all).join() === CATEGORIES.map((c) => c.id).join(), cats(all).join());
  ok('and the rows in catalogue order',
     ids(all).join() === SETTINGS.map((s) => s.id).join());
}

// ── matching a label ──────────────────────────────────────────────────────
{
  const g = search('theme', en);
  ok('a query that is the label finds the setting', find(g, 'theme'));
  ok('and does not drag the rest of the catalogue with it',
     ids(g).length === 1, ids(g).join(', '));
  ok('a partial label works too — nobody types the whole word',
     find(search('notif', en), 'notifySound'));
}

// ── matching a keyword and not the label ──────────────────────────────────
//
// This is what the module is for. Each of these words appears nowhere in the
// label of the thing it finds, and each is what somebody would actually type.
{
  const dark = search('dark', en);
  ok('"dark" finds Theme', find(dark, 'theme'));
  ok('and "dark" is genuinely not in its label',
     !SETTINGS.find((s) => s.id === 'theme').label.toLowerCase().includes('dark'));
  ok('"light" finds it as well', find(search('light', en), 'theme'));

  ok('"token" finds the API key', find(search('token', en), 'apiKey'));
  ok('"trial" finds the plan', find(search('trial', en), 'plan'));
  ok('"tokens left" finds the plan', find(search('tokens left', en), 'plan'));
  ok('and so does "left tokens", because every word is looked for separately',
     find(search('left tokens', en), 'plan'));

  ok('"copilot" finds inline completion', find(search('copilot', en), 'inlineCompletion'));
  ok('"hotkey" finds the global shortcut', find(search('hotkey', en), 'globalShortcut'));
  ok('"privacy" finds the clipboard history', find(search('privacy', en), 'clipboardHistory'));
  ok('"undo" finds checkpoints — the store with no button until now',
     find(search('undo', en), 'checkpoints'));
  ok('"SAFETY.md" finds the safety documents', find(search('SAFETY.md', en), 'safety'));
}

// ── typing the name of a category ─────────────────────────────────────────
//
// The eight category names are printed down the rail, three centimetres from
// the search box, so they are the likeliest words in the dialog to be typed.
// They were also the worst handled: "Storage" and "About" matched nothing at
// all, "Editor" returned Drafts rather than inline completion, and "Shortcuts"
// returned the key map and not the global shortcut. A label a person can see,
// typed into the box beside it, answering "nothing matches" is the
// affordance-that-does-nothing at its most embarrassing.
{
  for (const c of CATEGORIES) {
    const g = search(c.label, en);
    const want = SETTINGS.filter((x) => x.category === c.id).map((x) => x.id);
    ok(`typing "${c.label}" returns everything in ${c.id}`,
       want.every((id) => find(g, id)),
       `missing ${want.filter((id) => !find(g, id)).join(', ')}`);
  }
  ok('"storage" returns the four local stores and nothing else',
     ids(search('storage', en)).join() === 'drafts,checkpoints,fileHistory,clipboardHistory',
     ids(search('storage', en)).join());
  ok('"about" is a category name too, and finds its three rows',
     ids(search('about', en)).join() === 'version,updates,safety',
     ids(search('about', en)).join());

  // Per row rather than as a separate category pass, which is the difference
  // between a second word narrowing the result and being ignored.
  ok('a category name and a word together narrow to one row',
     ids(search('storage clipboard', en)).join() === 'clipboardHistory',
     ids(search('storage clipboard', en)).join());
  ok('and a category name with a word that is in no row of it finds nothing',
     search('storage copilot', en).length === 0);
}

// ── a query that spans two categories ─────────────────────────────────────
{
  const g = search('key', en);
  ok('"key" is in two places and both come back',
     cats(g).includes('account') && cats(g).includes('shortcuts'), cats(g).join(', '));
  ok('the API key is one of them', find(g, 'apiKey'));
  ok('and the key map is the other', find(g, 'keyMap'));
  ok('the groups are still in rail order',
     cats(g).join() === cats(g).slice().sort(
       (a, b) => CATEGORIES.findIndex((c) => c.id === a) - CATEGORIES.findIndex((c) => c.id === b),
     ).join());

  ok('"clear" returns all four local stores, because all four can be emptied',
     search('clear', en).find((x) => x.category.id === 'storage')?.rows.length === 4);
}

// ── folding ───────────────────────────────────────────────────────────────
{
  ok('the query is case-folded', find(search('DARK', en), 'theme'));
  ok('so is the catalogue — "Keys" is found by "keys"', find(search('keys', en), 'keyMap'));
  ok('accents are folded away: "thème" finds Theme', find(search('thème', en), 'theme'));
  ok('leading and trailing space is ignored', find(search('   dark   ', en), 'theme'));
  ok('and a space in the middle separates two words rather than one query',
     find(search('  tokens   left  ', en), 'plan'));
}

// ── a query that matches nothing ──────────────────────────────────────────
{
  const none = search('xyzzy', en);
  ok('a query nothing matches returns nothing', none.length === 0, JSON.stringify(cats(none)));
  ok('and a query that matches only part of a word does not half-match',
     search('darkness', en).length === 0);
}

// ── the same search in Arabic ─────────────────────────────────────────────
//
// Read out of `i18n.ts` rather than made up, so this is the translator the app
// actually hands to the panel. Somebody reading Vylo in Arabic types Arabic,
// and if the haystack were built at module load this would all match nothing.
{
  const src = readFileSync('src/i18n.ts', 'utf8').replace(/\r\n/g, '\n');
  const table = (lang) => {
    const from = src.indexOf(`const ${lang}: Dict = {`);
    const to = src.indexOf('\n};', from);
    const out = {};
    for (const m of src.slice(from, to).matchAll(
      /^ {2}'((?:[^'\\]|\\.)+)':[ \t]*\n?[ \t]*'((?:[^'\\]|\\.)*)',[ \t]*$/gm,
    )) out[m[1]] = m[2];
    return out;
  };
  const ar = table('ar');
  const ckb = table('ckb');
  const kmr = table('kmr');
  const tr = (d) => (s) => d[s] ?? s;

  ok('the ar table was read', Object.keys(ar).length > 50, `${Object.keys(ar).length} keys`);
  ok('the Arabic for Theme is in the catalogue', ar['Theme'] === 'المظهر', ar['Theme']);

  ok('typing the Arabic label finds the setting',
     find(search(ar['Theme'], tr(ar)), 'theme'));
  ok('and the harakat a keyboard adds do not stop it',
     find(search('المَظهَر', tr(ar)), 'theme'));
  ok('the English keyword still works while reading Arabic — "mcp" is not a word',
     find(search('mcp', tr(ar)), 'mcpServers'));
  ok('and English words do not stop working either',
     find(search('dark', tr(ar)), 'theme'));
  ok('the Arabic label does NOT match while reading English, which is the point',
     search(ar['Theme'], en).length === 0);

  // Sorani writes ی and ک; an Arabic keyboard produces ي and ك. Same word, and
  // "search does not work in Kurdish" is not a bug anyone reports.
  ok('the Kurdish label finds the API key', find(search(ckb['API key'], tr(ckb)), 'apiKey'));
  ok('and so does the same word typed on an Arabic keyboard',
     find(search('كليلي', tr(ckb)), 'apiKey'));
  ok('Badini works the same way', find(search(kmr['Keys'], tr(kmr)), 'keyMap'));
}

// ── what the panel renders ────────────────────────────────────────────────
{
  const v = view('', 'account', en);
  ok('with no query the rail carries all eight categories', v.rail.length === CATEGORIES.length);
  ok('every one of them has hits', v.rail.every((r) => r.hits > 0));
  ok('the pane shows the category that was selected', v.selected === 'account');
  ok('and its rows', v.pane.rows.every((r) => r.category === 'account'));

  const d = view('dark', 'account', en);
  ok('searching keeps all eight in the rail — a rail that shrinks jumps under the cursor',
     d.rail.length === CATEGORIES.length);
  ok('but only Appearance has a hit',
     d.rail.filter((r) => r.hits > 0).map((r) => r.category.id).join() === 'appearance',
     d.rail.filter((r) => r.hits > 0).map((r) => r.category.id).join());
  ok('and the pane follows the hit instead of going blank on Account',
     d.selected === 'appearance' && ids([d.pane]).join() === 'theme');

  const kept = view('dark', 'appearance', en);
  ok('a selection that does have hits is left alone', kept.selected === 'appearance');

  const both = view('key', 'shortcuts', en);
  ok('and a selection with hits is not dragged to the first group',
     both.selected === 'shortcuts', both.selected);

  const nothing = view('xyzzy', 'storage', en);
  ok('when nothing matches there is no pane to draw', nothing.pane === null);
  ok('and the selection is left where the person put it', nothing.selected === 'storage');
  ok('the rail is still all eight, all at zero',
     nothing.rail.length === CATEGORIES.length && nothing.rail.every((r) => r.hits === 0));

  ok('the rail is in rail order',
     view('', 'about', en).rail.map((r) => r.category.id).join()
       === CATEGORIES.map((c) => c.id).join());
}

// ── the strings reach all three languages ─────────────────────────────────
//
// `i18n.test.mjs` cannot see these. Its reverse check finds strings written as
// a literal `t('…')` call, and every label here is passed to `t` as a variable
// — which is deliberate, and is what lets the language change without anything
// being rebuilt. So the check has to happen where the strings are: a label that
// is not in the three catalogues renders in English inside an Arabic dialog,
// and nothing else in the suite would say so.
{
  const src = readFileSync('src/i18n.ts', 'utf8').replace(/\r\n/g, '\n');
  const keys = (lang) => {
    const from = src.indexOf(`const ${lang}: Dict = {`);
    const to = src.indexOf('\n};', from);
    return new Set([...src.slice(from, to).matchAll(
      /^ {2}'((?:[^'\\]|\\.)+)':[ \t]*\n?[ \t]*'(?:[^'\\]|\\.)*',[ \t]*$/gm,
    )].map((m) => m[1]));
  };
  const wanted = [
    ...CATEGORIES.map((c) => c.label),
    ...SETTINGS.map((s) => s.label),
    ...SETTINGS.flatMap((s) => (s.hint ? [s.hint] : [])),
  ];
  for (const lang of ['ar', 'ckb', 'kmr']) {
    const have = keys(lang);
    const missing = wanted.filter((s) => !have.has(s.replace(/'/g, "\\'")) && !have.has(s));
    ok(`every settings label and hint is in ${lang}`, missing.length === 0,
       `${missing.length} missing: ${missing.join(' | ')}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
