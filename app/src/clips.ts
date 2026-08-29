/**
 * Clipboard history — reaching something you copied three copies ago.
 *
 * ## The constraint is the whole feature
 *
 * The obvious implementation polls the OS clipboard on a timer and keeps every
 * change. That records everything the person copies *anywhere on their
 * machine*: the password their password manager put on the clipboard thirty
 * seconds ago, the recovery codes they moved between two browser tabs, the card
 * number they pasted into a checkout. It would write all of it to disk, in
 * plaintext, in a file nobody remembers exists. A convenience feature that
 * quietly becomes a credential store is not worth having, and nobody would
 * agree to it if they were asked in those words.
 *
 * So nothing here ever reads the OS clipboard. A clip is recorded only when a
 * person pastes **into this app** — an action they took, in this window, for
 * this app to see. Everything below narrows even that:
 *
 * - a paste into a password field is not recorded, because the gateway key box
 *   in Settings and on the welcome screen are exactly where a credential
 *   arrives by paste (`privateField`);
 * - a paste the source marked concealed or transient is not recorded
 *   (`concealed`);
 * - a paste that has the *shape* of a secret is not recorded, even when it was
 *   deliberate (`looksSecret`);
 * - the store holds {@link MAX_CLIPS} entries for {@link MAX_AGE_DAYS} days and
 *   no more, so it forgets on its own;
 * - and `clear` empties it, from a control that is visible in the picker rather
 *   than buried in Settings.
 *
 * ## What `looksSecret` is, and what it is not
 *
 * It is a courtesy. It is **not** a guarantee, and nothing in the UI may
 * describe it as one. It matches shapes — a PEM private key block, a JWT, the
 * token prefixes the big services stamp on their keys, and strings that look
 * drawn from a random generator rather than from a language. Shapes are all it
 * can see.
 *
 * So it misses, by construction: a 16-character password, a passphrase made of
 * four words, a database URL with credentials in the authority, an internal
 * token with no recognisable prefix, anything short. It also misfires the other
 * way and drops the occasional harmless base64 blob. Both directions are the
 * cost of a heuristic, which is why it is the last line here and not the first
 * — the paste-only rule and the password-field rule are what actually do the
 * work, because they are about *where the text came from* rather than guesses
 * about what it says.
 *
 * ## Shape of the module
 *
 * `record` and everything it calls are pure: a list in, a list out. The store
 * is an interface so the logic can be tested in node and so where the history
 * lives can change without touching any of the rules above. `localClips` binds
 * it to `localStorage`, the app's own origin-private storage, which is already
 * where `store.ts` keeps chats.
 */

export interface Clip {
  /** What is kept — the paste, cut to {@link MAX_TEXT}. */
  text: string;
  /**
   * How long the paste was before truncation. `full > text.length` is the only
   * way the UI can know it is offering a fragment, and it has to say so: a
   * picker that silently pastes back nine tenths of what you copied is worse
   * than one that refuses.
   */
  full: number;
  /** When it was pasted. Order is the array's job; this is for the label. */
  at: number;
}

/** Where the history lives. Injected so every rule above is testable in node. */
export interface ClipStore {
  read(): Clip[];
  write(clips: Clip[]): void;
}

/**
 * Small on purpose. This is "the last few things", not an archive — a longer
 * list is more to leak, harder to scan, and past about twenty nobody is
 * reaching for an item by eye anyway.
 */
export const MAX_CLIPS = 20;

/**
 * Long pastes are stored as a prefix. A whole 400 KB file on the clipboard is
 * not something anyone picks out of a list, and twenty of them would fill the
 * storage quota that the chat history shares.
 */
export const MAX_TEXT = 4096;

/**
 * A bounded count is not enough on its own: twenty entries pasted on a Tuesday
 * are still there in March. A bounded *lifetime* is the half that makes the
 * store forget without being asked.
 */
export const MAX_AGE_DAYS = 7;

const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

/**
 * How far past the truncation point `looksSecret` reads.
 *
 * The scan covers what will be *stored*, since only stored text can leak. But
 * cutting at exactly {@link MAX_TEXT} can split a token in half, and half of an
 * API key is still the half that gets written down — so the scan runs a little
 * past the cut and judges a straddling token whole.
 */
const SCAN_MARGIN = 128;

/* ── what is never recorded ──────────────────────────────────────────── */

/**
 * Pasteboard types by which the *source* application asks not to be recorded.
 *
 * Password managers set these; on macOS `org.nspasteboard.ConcealedType` is the
 * convention 1Password and friends follow, on Windows the shell reads
 * `ExcludeClipboardContentFromMonitorProcessing`, and KDE's is the last one.
 *
 * Honestly: a WKWebView is under no obligation to surface a native pasteboard
 * UTI in `clipboardData.types`, and often does not, so this check fires far
 * less often than the list suggests. It is here because when the information
 * *is* there, ignoring it would be choosing to record something whose owner
 * explicitly asked us not to — not because it can be relied on.
 */
const CONCEALED = [
  'org.nspasteboard.ConcealedType',
  'org.nspasteboard.TransientType',
  'org.nspasteboard.AutoGeneratedType',
  'ExcludeClipboardContentFromMonitorProcessing',
  'CanIncludeInClipboardHistory',
  'CanUploadToCloudClipboard',
  'x-kde-passwordManagerHint',
];

/** True when the clipboard carries one of the do-not-record markers. */
export function concealed(types: readonly string[] | undefined): boolean {
  if (!types) return false;
  return types.some((t) => CONCEALED.some((m) => t.toLowerCase().includes(m.toLowerCase())));
}

/**
 * Enough of an element to judge it, so the rule is testable without a DOM.
 * `HTMLInputElement` satisfies it structurally, which is how the caller passes
 * a real paste target straight in.
 */
export interface FieldLike {
  type?: string;
  autocomplete?: string;
}

/**
 * True for a field whose whole purpose is to receive a credential.
 *
 * The app has two of them — the gateway key on the welcome screen and the same
 * key in Settings, both `type="password"` — and a history that recorded what
 * was pasted there would have failed at the one thing this module is for.
 */
export function privateField(el: FieldLike | null | undefined): boolean {
  if (!el) return false;
  if ((el.type || '').toLowerCase() === 'password') return true;
  const hint = (el.autocomplete || '').toLowerCase();
  return /password|one-time-code|cc-number|cc-csc/.test(hint);
}

/* ── the secret heuristic ────────────────────────────────────────────── */

/** Any PEM private key, whatever the algorithm names it. */
const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY/;

/**
 * A JWT. Three base64url segments joined by dots — the dots keep it out of the
 * token scan below, which is why it needs a rule of its own.
 */
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/;

/**
 * Prefixes services stamp on their keys so that leak scanners can find them.
 * Borrowed for the same purpose. The list is incomplete and always will be —
 * every service that invents a new one is a miss until someone adds it.
 */
const PREFIXES = [
  'sk-',          // OpenAI, Anthropic (sk-ant-)
  'sk_live_', 'sk_test_', 'rk_live_', 'pk_live_',  // Stripe
  'ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_',
  'glpat-',       // GitLab
  'xox',          // Slack: xoxb- xoxp- xoxa- xoxs- xoxr-
  'AKIA', 'ASIA', // AWS access key ids
  'AIza', 'ya29.',// Google
  'npm_',
  'dop_v1_',      // DigitalOcean
  'shpat_',       // Shopify
  'SG.',          // SendGrid
  'hf_',          // Hugging Face
];

/** A prefix alone proves nothing; `sk-` is two letters. Length is the rest. */
const MIN_PREFIXED = 20;

/**
 * Where a token is cut. Whitespace, and also the punctuation that wraps a value
 * in JSON, in a shell assignment or in source — so `"AKIA…"` and `KEY=ghp_…`
 * are judged as the value they contain rather than as one long string.
 */
const SPLIT = /[\s"'`<>(){}[\],;=]+/;

/** Characters a base64/base64url/hex token is made of. */
const TOKENISH = /^[A-Za-z0-9+/_-]{32,}$/;

const count = (s: string, re: RegExp) => (s.match(re) || []).length;

/** Shannon entropy in bits per character. */
function entropy(s: string): number {
  const seen = new Map<string, number>();
  for (const c of s) seen.set(c, (seen.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of seen.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** The longest run of consecutive lowercase letters. */
function lowerRun(s: string): number {
  let best = 0, run = 0;
  for (const c of s) {
    if (c >= 'a' && c <= 'z') { run += 1; if (run > best) best = run; }
    else run = 0;
  }
  return best;
}

/**
 * Does this token look generated rather than written?
 *
 * The character classes are the cheap part. The discriminator that does the
 * work is the run of lowercase letters: a random base64 string changes class
 * every two or three characters, while `feature/JIRA-1234-add-clipboard` — a
 * branch name, an entirely ordinary thing to paste — is *words*, with capitals
 * and digits sprinkled between them, and a word is a run.
 *
 * Entropy is only a floor here, against degenerate repetition. It cannot be the
 * discriminator: a string of mostly-distinct characters scores near log2(n)
 * whether a generator or a person produced it, so at these lengths the branch
 * name above scores 4.5 and beats plenty of real keys.
 *
 * The trade cuts both ways and is deliberate. Keeping identifiers and branch
 * names out of the net lets through the roughly one random token in ten that
 * happens to contain six lowercase letters in a row.
 */
function generated(tok: string): boolean {
  if (!TOKENISH.test(tok)) return false;
  if (count(tok, /[a-z]/g) < 2 || count(tok, /[A-Z]/g) < 2 || count(tok, /[0-9]/g) < 1) return false;
  if (entropy(tok) < 3.5) return false;
  return lowerRun(tok) <= 5;
}

/**
 * True when the text looks like it carries a credential.
 *
 * Read the module header before trusting this: it recognises shapes, so it
 * misses every secret that does not have one. It is a courtesy, not a promise.
 */
export function looksSecret(text: string): boolean {
  if (PRIVATE_KEY.test(text) || JWT.test(text)) return true;
  for (const tok of text.split(SPLIT)) {
    if (!tok) continue;
    if (tok.length >= MIN_PREFIXED && PREFIXES.some((p) => tok.startsWith(p))) return true;
    if (generated(tok)) return true;
  }
  return false;
}

/* ── the history itself ──────────────────────────────────────────────── */

/**
 * Two clips are the same when what is stored is the same *and* it stood for a
 * paste of the same length. Comparing the stored prefix alone would fold two
 * different long pastes that happen to share their first {@link MAX_TEXT}
 * characters into one entry, and offer the wrong one back.
 */
const same = (a: Clip, b: Clip) => a.text === b.text && a.full === b.full;

export interface RecordOpts {
  /** `clipboardData.types` from the paste, for the do-not-record markers. */
  types?: readonly string[];
  now?: number;
}

/**
 * Record a paste, or decline to.
 *
 * Returns the list **unchanged, by identity** when the paste was not recorded,
 * so a caller can skip the write. A repeat of something already held moves to
 * the front rather than appearing twice — a history with the same snippet at
 * positions one, four and nine is a history you have to read instead of scan.
 */
export function record(clips: Clip[], text: string, opts: RecordOpts = {}): Clip[] {
  const { types, now = Date.now() } = opts;
  // Whitespace-only pastes come from selecting a blank line or over-reaching a
  // selection by one; there is nothing to come back for.
  if (!text.trim()) return clips;
  if (concealed(types)) return clips;
  if (looksSecret(text.slice(0, MAX_TEXT + SCAN_MARGIN))) return clips;

  const clip: Clip = { text: text.slice(0, MAX_TEXT), full: text.length, at: now };
  return [clip, ...clips.filter((c) => !same(c, clip))].slice(0, MAX_CLIPS);
}

/** True when only the beginning of the paste was kept. The UI must say so. */
export const shortened = (clip: Clip) => clip.full > clip.text.length;

/** Drop what has aged out. Unchanged by identity when nothing had. */
export function prune(clips: Clip[], now: number = Date.now()): Clip[] {
  const live = clips.filter((c) => now - c.at < MAX_AGE_MS);
  return live.length === clips.length ? clips : live;
}

/**
 * One line standing for a clip, for the picker.
 *
 * Newlines and runs of spaces collapse: a row that renders leading indentation
 * shows four spaces where the distinguishing text should be, and every row of
 * a pasted block then looks identical.
 */
export function preview(text: string, max = 140): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/* ── bound to a store ────────────────────────────────────────────────── */

/**
 * What is held now, oldest entries already forgotten.
 *
 * Expiry writes back rather than filtering on the way out: an expiry that only
 * hides is not expiry, and the text would still be on disk.
 */
export function history(store: ClipStore, now: number = Date.now()): Clip[] {
  const held = store.read();
  const live = prune(held, now);
  if (live !== held) store.write(live);
  return live;
}

/** Record a paste and persist it. Returns the new history. */
export function remember(store: ClipStore, text: string, opts: RecordOpts = {}): Clip[] {
  const now = opts.now ?? Date.now();
  const held = history(store, now);
  const next = record(held, text, { ...opts, now });
  if (next !== held) store.write(next);
  return next;
}

/** Forget everything, from a control the person can see. */
export function clear(store: ClipStore): void {
  store.write([]);
}

const KEY = 'vylo.clips.v1';

/**
 * The default store.
 *
 * `localStorage` is origin-private to the app's own webview and is where
 * `store.ts` already keeps chats, so this adds a key rather than a mechanism.
 * Reads are defensive in both directions — storage can be unavailable, and the
 * value can be anything at all, since a hand-edited or half-written entry
 * should empty the picker rather than break the app around it.
 */
export const localClips: ClipStore = {
  read(): Clip[] {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((c): c is Clip =>
          !!c && typeof c.text === 'string' && typeof c.full === 'number' && typeof c.at === 'number')
        .slice(0, MAX_CLIPS);
    } catch {
      return [];
    }
  },
  write(clips: Clip[]): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(clips.slice(0, MAX_CLIPS)));
    } catch {
      /* quota, or storage disabled — a lost clipboard history is not worth an error */
    }
  },
};
