import type { IconName } from './Icon';

/**
 * What is in Settings, and the words that find it.
 *
 * The dialog is a left rail of categories and a right pane of rows, and the
 * rail has a search field at the top. That field is the reason this module
 * exists. A search box that filters only the eight category names is an
 * affordance that does nothing — the person hunting for the dark/light toggle
 * types "dark", and "dark" is not in the word "Appearance". D6 settled that a
 * control which looks like it works and does not is worse than no control, so
 * the box searches the *settings*: every row, by its label, by the sentence
 * under it, and by the words somebody would actually reach for.
 *
 * ## Why the catalogue is data and not the panel's markup
 *
 * The panel needs three answers that the markup cannot give while it is being
 * rendered: which categories have hits (the rail draws all eight either way,
 * dimming the empty ones — a rail whose rows disappear as you type jumps under
 * the cursor), which rows the pane draws, and which category the pane is
 * looking at when the selected one has nothing. All three are decided here,
 * before a single row is built, and the panel maps over the answer.
 *
 * It is also the list nothing may silently fall off. A settings redesign that
 * drops a control is discovered months later by somebody who cannot turn a
 * thing back on, so the controls are enumerated in one place where they can be
 * counted — and `test/settings.test.mjs` counts them.
 *
 * ## Why `t` is an argument and not an import
 *
 * Someone reading this app in Kurdish types Kurdish. If the searchable text
 * were built when the module loaded, it would be built in whatever language
 * happened to be current — or, worse, in English forever — and search would
 * quietly be an English-only feature inside a translated interface. So every
 * lookup takes the translator and folds the text at call time. Changing the
 * language changes what search matches, immediately, with nothing to invalidate.
 *
 * Both halves go in the haystack: the English string *and* its translation.
 * The English is the catalogue key, so it costs nothing to keep, and it is
 * genuinely what people type for the parts that are not words in any language —
 * `mcp`, `sk-vylo`, `SAFETY.md`, `ctrl`. Keywords are looked up too, so a
 * translated keyword starts working the day it is added to `i18n.ts` and falls
 * back to English until then.
 *
 * ## Why substring and not the fuzzy matcher
 *
 * `fuzzy.ts` ranks paths, where a subsequence match is what people mean —
 * "apsx" should find `app/src/App.tsx`. Over twenty short labels it is the
 * opposite: almost every query is a subsequence of almost every row, so the
 * list never narrows and the ordering carries the whole result. A settings
 * search that answers "dark" with all twenty rows in a clever order is the
 * affordance-that-does-nothing again. Substring, with every word of the query
 * required to appear somewhere, is predictable: type "dark", get Theme.
 *
 * Every word, rather than the whole query as one string, so "tokens left" finds
 * the plan whichever order the two words are typed in.
 */

// ─── categories ───────────────────────────────────────────────────────────

export type CategoryId =
  | 'account' | 'appearance' | 'editor' | 'notifications'
  | 'shortcuts' | 'approval' | 'modules' | 'storage' | 'about';

export interface Category {
  id: CategoryId;
  /** The English sentence, which is also the `i18n.ts` key. */
  label: string;
  icon: IconName;
  /** The one row the rail pins to its foot, away from the rest. */
  foot?: true;
}

/**
 * In rail order.
 *
 * The icons are all names `Icon.tsx` already draws. Two constraints narrowed
 * the choice more than it looks: the set has no person, no bell, no key and no
 * keyboard, and the six glyphs the activity rail already owns — folder, search,
 * diff, chat, memory, settings — are spoken for, so reusing one here would say
 * "Explorer" next to the word "Storage". What is left is matched on meaning and
 * the reasoning is written down, because the next person will otherwise assume
 * these were picked at random:
 *
 *   account       `check`   — no person exists to draw. The tick is the answer
 *                             this tab gives first: signed in, key set.
 *   appearance    `sun`     — half of the control itself.
 *   editor        `file`    — the setting acts while you type in a file.
 *   notifications `dot`     — the badge dot, which is what a notification looks
 *                             like everywhere. `warning` would claim every
 *                             notification is a problem, and most of them are
 *                             "the turn finished".
 *   shortcuts     `bolt`    — the quick-action metaphor. The status bar uses it
 *                             for tokens; the two never share a surface.
 *   approval      `pause`   — the whole tab is about whether the app stops and
 *                             asks. Nothing else uses it, and it says the one
 *                             thing the setting decides.
 *   modules       `branch`  — the only glyph drawing one thing joined to
 *                             another, which is both halves of this tab: the
 *                             app's own sections attached to the rail, and an
 *                             MCP server attached as a separate process.
 *   storage       `clipboard` — a board of kept records, and one of the four
 *                             stores is literally the clipboard history.
 *   about         `ellipsis` — "more", on the row pinned to the foot.
 */
export const CATEGORIES: readonly Category[] = [
  { id: 'account', label: 'Account', icon: 'check' },
  { id: 'appearance', label: 'Appearance', icon: 'sun' },
  { id: 'editor', label: 'Editor', icon: 'file' },
  { id: 'notifications', label: 'Notifications', icon: 'dot' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'bolt' },
  { id: 'approval', label: 'Approval', icon: 'pause' },
  { id: 'modules', label: 'Modules', icon: 'branch' },
  { id: 'storage', label: 'Storage', icon: 'clipboard' },
  { id: 'about', label: 'About', icon: 'ellipsis', foot: true },
];

// ─── the settings themselves ──────────────────────────────────────────────

/**
 * Stable, and a union rather than a string, so the panel's switch is
 * exhaustive: adding an entry here without giving it a control is a type error
 * rather than a blank row somebody notices in a screenshot.
 */
export type SettingId =
  | 'gateway' | 'apiKey' | 'signedIn' | 'signOut' | 'plan' | 'providers'
  | 'theme' | 'language'
  | 'inlineCompletion'
  | 'notifyWhen' | 'notifySound'
  | 'globalShortcut' | 'keyMap'
  | 'autoApprove'
  | 'modules' | 'railSide' | 'mcpServers'
  | 'drafts' | 'checkpoints' | 'fileHistory' | 'clipboardHistory'
  | 'version' | 'updates' | 'safety';

export interface Setting {
  id: SettingId;
  category: CategoryId;
  /** English sentence, and the `i18n.ts` key. Left of the row. */
  label: string;
  /** The line under the label. Present only where the label leaves a question. */
  hint?: string;
  /**
   * What somebody types when they do not know what the thing is called.
   *
   * These are the point of the whole module, so they are written from the
   * outside in: the value ("dark", "light"), the name it has in other apps
   * ("copilot", "hotkey"), the thing it is really about ("privacy", "quota"),
   * and the identifier it prints on screen ("sk-vylo", ".vylo/mcp.json").
   * A keyword nobody would type is dead weight; a missing one is a row that
   * cannot be found.
   */
  keywords: readonly string[];
}

/**
 * Every control the dialog holds, in the order its category shows them.
 *
 * The first eleven are the flat list Settings had before the redesign, moved
 * and not dropped — gateway, API key, who is signed in, sign out, theme,
 * language, inline completion, the two notification controls, the global
 * shortcut and the MCP servers. The rest are what the redesign adds: the plan,
 * the key map (which `Welcome.tsx` already renders), the four local stores and
 * the About rows.
 */
export const SETTINGS: readonly Setting[] = [
  // ── Account ──
  {
    id: 'gateway', category: 'account', label: 'Gateway',
    keywords: ['url', 'address', 'server', 'endpoint', 'host', 'base', 'capi', 'proxy', 'connection'],
  },
  {
    id: 'apiKey', category: 'account', label: 'API key',
    keywords: ['key', 'token', 'secret', 'credential', 'sk-vylo', 'paste', 'x-api-key', 'model access'],
  },
  {
    id: 'signedIn', category: 'account', label: 'Signed in',
    keywords: ['account', 'sign in', 'log in', 'login', 'email', 'who', 'session', 'profile', 'user'],
  },
  {
    id: 'signOut', category: 'account', label: 'Sign out',
    // The one place the two-credentials rule reaches a person: the fear that
    // stops somebody signing out is that it will take their model access away.
    hint: 'Your key keeps working. It was minted for this machine, and signing out does not revoke it.',
    keywords: ['log out', 'logout', 'leave', 'forget me', 'session', 'switch account'],
  },
  {
    id: 'plan', category: 'account', label: 'Plan',
    keywords: ['trial', 'tokens left', 'usage', 'quota', 'balance', 'billing', 'subscription', 'credits', 'remaining', 'upgrade', 'limit'],
  },

  {
    id: 'providers', category: 'account', label: 'Model providers',
    hint: 'Other places to send requests — OpenAI, Blackbox, OpenRouter, or an Ollama on this machine. A key is only ever sent to the address it was entered beside.',
    keywords: ['provider', 'openai', 'blackbox', 'openrouter', 'groq', 'deepseek', 'ollama', 'external', 'api', 'gpt', 'custom model', 'endpoint', 'third party', 'byok'],
  },

  // ── Appearance ──
  {
    id: 'theme', category: 'appearance', label: 'Theme',
    keywords: ['dark', 'light', 'match system', 'colour', 'color', 'night', 'contrast', 'appearance'],
  },
  {
    id: 'language', category: 'appearance', label: 'Language',
    keywords: ['arabic', 'kurdish', 'sorani', 'badini', 'kurmanji', 'english', 'locale', 'translate', 'interface language'],
  },

  // ── Editor ──
  {
    id: 'inlineCompletion', category: 'editor', label: 'Inline completion',
    keywords: ['autocomplete', 'suggestions', 'ghost text', 'tab', 'as i type', 'copilot', 'complete'],
  },

  // ── Notifications ──
  {
    id: 'notifyWhen', category: 'notifications', label: 'When to notify me',
    hint: 'Only while Vylo is in the background. The banner brings the window forward; nothing is approved from it.',
    keywords: ['notifications', 'banner', 'alert', 'background', 'needs me', 'everything', 'turn ends', 'off'],
  },
  {
    id: 'notifySound', category: 'notifications', label: 'Notification sound',
    keywords: ['sound', 'chime', 'beep', 'audio', 'mute', 'silent', 'quiet'],
  },

  // ── Shortcuts ──
  {
    id: 'globalShortcut', category: 'shortcuts', label: 'Global shortcut',
    hint: 'Off until you set one. Press it anywhere to bring Vylo forward and start a message.',
    keywords: ['hotkey', 'summon', 'bring forward', 'system wide', 'combination', 'chord', 'cmd', 'ctrl', 'record'],
  },
  {
    id: 'keyMap', category: 'shortcuts', label: 'Keys',
    keywords: ['keyboard', 'shortcuts', 'bindings', 'key map', 'cheat sheet', 'go to file', 'go to symbol'],
  },

  // ── Approval ──
  {
    id: 'autoApprove', category: 'approval', label: 'When the agent changes something',
    hint: 'Off every time the app starts. Some commands always ask whatever this says — anything that deletes, publishes, rewrites history or runs as another user.',
    keywords: ['auto', 'automatic', 'approve', 'auto-approve', 'yolo', 'skip', 'permission', 'permissions', 'confirm', 'ask', 'without asking', 'trust', 'unattended', 'agent mode'],
  },

  // ── Modules ──
  //
  // Two halves, in the order they answer the question somebody opens this tab
  // with. First what the app is already made of and how to rearrange it; then
  // what can be attached to it.
  {
    id: 'modules', category: 'modules', label: 'Sections',
    hint: 'The panels in the activity rail. Turn off what you never open, and drag the rest into the order you want.',
    keywords: ['module', 'modules', 'rail', 'sidebar', 'panel', 'section', 'explorer', 'search', 'changes', 'chats', 'to do', 'memory', 'hide', 'show', 'reorder', 'arrange', 'sections', 'tabs', 'task bar', 'toolbar'],
  },
  {
    id: 'railSide', category: 'modules', label: 'Rail',
    hint: 'Which edge the activity rail sits against. It stays on that side of the screen whatever the language.',
    keywords: ['left', 'right', 'side', 'position', 'move', 'rail', 'task bar', 'taskbar', 'sidebar', 'edge', 'place', 'location'],
  },
  {
    id: 'mcpServers', category: 'modules', label: 'MCP servers',
    hint: 'Declared by this project in .vylo/mcp.json. Read the command before enabling one — it runs on your machine, and every tool it offers is asked for before it runs.',
    keywords: ['mcp', 'server', 'tools', 'plugins', 'extensions', 'model context protocol', 'enable', 'disable', 'add a module', 'import', 'third party'],
  },

  // ── Storage ──
  //
  // The four stores SAFETY.md documents, in the order that document lists them.
  // Its own table used to say checkpoints had "no in-app button — delete the
  // directory", which is why this category exists: a store a person cannot
  // empty from inside the app is a promise the privacy section cannot keep.
  // Every one of these rows shares the clearing keywords, because "clear" ought
  // to return all four.
  {
    id: 'drafts', category: 'storage', label: 'Drafts',
    hint: 'Unsaved editor buffers, so a crash does not lose them.',
    keywords: ['unsaved', 'recover', 'crash', 'buffers', 'app data', 'clear', 'empty', 'delete', 'disk', 'space'],
  },
  {
    id: 'checkpoints', category: 'storage', label: 'Checkpoints',
    hint: 'What files held before an approved write, so an undo can put them back.',
    keywords: ['undo', 'redo', 'restore', 'before the write', 'app data', 'clear', 'empty', 'delete', 'disk', 'space'],
  },
  {
    id: 'fileHistory', category: 'storage', label: 'File history',
    hint: 'Every version this app has written, so saving over your own work is recoverable.',
    keywords: ['versions', 'local history', 'recover', 'restore', 'app data', 'clear', 'empty', 'delete', 'disk', 'space'],
  },
  {
    id: 'clipboardHistory', category: 'storage', label: 'Clipboard history',
    hint: 'What you pasted into Vylo. It never reads the system clipboard on its own.',
    keywords: ['clips', 'paste', 'copied', 'privacy', 'clear', 'empty', 'delete', 'disk', 'space'],
  },

  // ── About ──
  {
    id: 'version', category: 'about', label: 'Version',
    keywords: ['build', 'release', 'number', 'changelog'],
  },
  {
    id: 'updates', category: 'about', label: 'Check for updates',
    hint: 'Every update is signed. One that fails the check is discarded before it runs.',
    keywords: ['update', 'upgrade', 'new version', 'install', 'download', 'relaunch'],
  },
  {
    id: 'safety', category: 'about', label: 'Safety',
    hint: 'What this app can do to this machine, what it keeps, and where.',
    keywords: ['SAFETY.md', 'privacy', 'permissions', 'security', 'containment', 'what it can do', 'data', 'documents'],
  },
];

// ─── matching ─────────────────────────────────────────────────────────────

export type Translate = (s: string) => string;

/**
 * Latin combining accents, then the Arabic-script marks that a keyboard emits
 * and a reader does not think of as letters: the harakat, the superscript alef,
 * and the tatweel people insert to stretch a word.
 *
 * `NFKD` first, so أ إ آ decompose to a bare alef plus a hamza that this class
 * removes. Mapping the composed forms by hand instead would miss the ones a
 * different keyboard produces.
 */
const MARKS = /[\u0300-\u036F\u0640\u064B-\u0652\u0653-\u0655\u0670]/g;

/**
 * Letters the two scripts in this app spell differently for the same sound.
 *
 * Arabic and Kurdish keyboards are both in use here, and Sorani writes U+06CC
 * and U+06A9 where Arabic writes U+064A and U+0643. Somebody searching the
 * Kurdish interface from an Arabic keyboard is typing the same word; without
 * this it matches nothing, and "search is broken in Kurdish" is not a bug
 * anyone would think to report.
 *
 * Escapes rather than the letters themselves, because these characters are
 * invisible to a reviewer at a glance and two of them are one pixel apart in
 * most fonts.
 */
const SAME: readonly (readonly [RegExp, string])[] = [
  [/[\u064A\u0649]/g, '\u06CC'],  // Arabic yeh and alef maqsura -> Kurdish yeh
  [/\u0643/g, '\u06A9'],           // Arabic kaf -> Kurdish keheh
  [/\u0629/g, '\u0647'],           // teh marbuta -> heh
];

/**
 * One spelling, for the query and the text alike.
 *
 * Exported because it is the app's fold, not this module's: `everywhere.ts`
 * searches settings alongside five other kinds and has to fold its own
 * haystacks the same way. A second fold would be a second answer to "is this
 * the same word", and the one place that would show is Arabic and Kurdish
 * input — which is the one place nobody would notice it.
 */
export function fold(s: string): string {
  let out = s.normalize('NFKD').replace(MARKS, '');
  for (const [from, to] of SAME) out = out.replace(from, to);
  return out.toLowerCase();
}

/** A query as the folded words that all have to appear. */
export function words(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

/**
 * Whether every word of an already-split query appears in `text`.
 *
 * Split from `search` so the predicate exists once. `everywhere.ts` matches
 * commands with it: commands are short labels exactly as settings rows are, and
 * the reasoning at the top of this file — that a subsequence match over twenty
 * short labels never narrows — is the same reasoning there.
 */
export function matchesWords(text: string, terms: readonly string[]): boolean {
  if (!terms.length) return true;
  const hay = fold(text);
  return terms.every((term) => hay.includes(term));
}

/** The rail row a setting belongs to, for the category name in its haystack. */
const OWNER = new Map(CATEGORIES.map((c) => [c.id, c.label]));

/**
 * Everything one row can be found by, folded.
 *
 * Joined on newlines so a query word cannot match across the seam between two
 * keywords and claim a hit that neither of them is.
 *
 * **The category's own name is in here**, which reads like belt and braces and
 * is the one omission that made the box look broken. The eight category names
 * are the words *printed in the rail*, so they are the words most likely to be
 * typed — and without this they were the words the search handled worst:
 * "Storage" and "About" matched nothing at all, "Editor" returned Drafts and
 * not inline completion, and "Shortcuts" returned the key map and not the
 * global shortcut. Somebody typing a label they can see, into a box beside it,
 * and being told nothing matches is the affordance-that-does-nothing this
 * module exists to prevent, in its most embarrassing form.
 *
 * Per row rather than as a separate category pass, so a query mixing the two —
 * "storage clipboard" — narrows to one row instead of returning everything in
 * the category. Every word still has to appear somewhere in the same row.
 */
function haystack(s: Setting, t: Translate): string {
  const own = [s.label, OWNER.get(s.category) ?? '', ...(s.hint ? [s.hint] : []), ...s.keywords];
  // The English and the translation, both. See the note at the top: the English
  // is the catalogue key, so keeping it costs nothing and it is what people
  // type for `mcp`, `sk-vylo` and `SAFETY.md` in any language.
  return fold([...own, ...own.map((k) => t(k))].join('\n'));
}

export interface Group {
  category: Category;
  /** The rows to draw, in catalogue order. Never empty. */
  rows: Setting[];
}

/**
 * The catalogue narrowed to a query, grouped by category and in rail order.
 *
 * An empty query returns everything. That is the important case, not the
 * degenerate one: the dialog opens with the field empty, and a settings list
 * that is blank until you type looks broken rather than ready.
 *
 * Categories with no hits are left out entirely. `view` puts them back for the
 * rail, which needs all eight; anything reading the result directly wants only
 * what matched.
 */
export function search(query: string, t: Translate): Group[] {
  // Folding before the split handles the leading and trailing space for free.
  const terms = words(query);
  const groups: Group[] = [];
  for (const category of CATEGORIES) {
    const rows = SETTINGS.filter((s) => {
      if (s.category !== category.id) return false;
      // The haystack is twenty `t()` calls per row, so the empty query — which
      // keeps everything — must not pay for one.
      if (!terms.length) return true;
      // Every word, anywhere in the row: "tokens left" finds the plan, and so
      // does "left tokens".
      return matchesWords(haystack(s, t), terms);
    });
    if (rows.length) groups.push({ category, rows });
  }
  return groups;
}

export interface RailRow {
  category: Category;
  /** How many rows match. Zero means the rail dims it rather than hides it. */
  hits: number;
}

export interface View {
  /** All eight, in rail order, whatever the query. */
  rail: RailRow[];
  /** The heading and rows the pane draws, or null when nothing matched at all. */
  pane: Group | null;
  /**
   * The category the pane ended up on. Not always the one that was passed:
   * see below.
   */
  selected: CategoryId;
}

/**
 * What the panel renders, from the query and whichever category is selected.
 *
 * The one decision worth reading: **when the selected category has no hits, the
 * pane falls through to the first category that does.** Somebody sitting on
 * Account who types "dark" would otherwise watch the pane go blank while the
 * answer sits one row down the rail, unclicked — the search would have found
 * the setting and then hidden it.
 *
 * This is derived, not stored. The panel keeps its own selection state and this
 * never writes to it, so clearing the query returns the person to the category
 * they actually chose rather than to wherever a search left them.
 */
export function view(query: string, selected: CategoryId, t: Translate): View {
  const groups = search(query, t);
  const hits = new Map(groups.map((g) => [g.category.id, g.rows.length]));
  const pane = groups.find((g) => g.category.id === selected) ?? groups[0] ?? null;
  return {
    rail: CATEGORIES.map((category) => ({ category, hits: hits.get(category.id) ?? 0 })),
    pane,
    selected: pane ? pane.category.id : selected,
  };
}
