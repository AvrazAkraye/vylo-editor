/**
 * The dev-server pane: what the project is serving, beside the code.
 *
 * Somebody runs `npm run dev`, the terminal prints `Local: http://localhost:5173/`,
 * and the next thing they do is leave the window to look at it. This pane is
 * that look, without leaving: an address, and a frame showing what is there.
 * It is not a browser. It shows the thing you are building and nothing else,
 * and most of this module is the "nothing else".
 *
 * This is the model only: which addresses count, how a half-typed one is
 * completed, how one is found in a chunk of terminal output, and how the list
 * of recent ones is kept. The panel that draws the frame and the app that
 * stores the state call in; nothing here touches the DOM, the clock or disk.
 *
 * ## Only the machine you are on
 *
 * `normalise` accepts http and https to `localhost`, `127.0.0.1`, `0.0.0.0`,
 * `[::1]` and `*.localhost`, with any port a server can listen on and any
 * path, and returns null for everything else. Three reasons, and any one of
 * them would do.
 *
 * The pane is for the thing you are building, and the thing you are building
 * is served from this machine. A dev server on another host is a deployment,
 * and a deployment has a browser.
 *
 * The app's content-security policy names exactly those hosts in `frame-src`
 * and nothing else. A URL this function let through that the policy refused
 * would be a blank frame with no error — the webview does not tell the page
 * why a frame stayed empty — so the two lists have to agree, and this is the
 * one that is tested.
 *
 * And a general browser inside an agent's window is a phishing surface. The
 * window already holds a gateway key and a chat that can stage edits; a frame
 * that can show any site can show a sign-in page that looks like this app's,
 * in the place a person expects this app to ask. Loopback hosts cannot be
 * anybody else's.
 *
 * `localhost` spelled as a domain that merely starts with it —
 * `localhost.evil.dev` — is not the loopback and is refused, the same rule
 * `providers.ts` applies to where a key may go. `*.localhost` *is* accepted:
 * the whole `.localhost` top-level domain is reserved for loopback by RFC
 * 6761, resolvers answer it locally, and dev tools that give each project a
 * subdomain — `app.localhost`, `api.localhost` — use it for exactly that.
 *
 * ## Every loopback address except this app's own
 *
 * The one loopback page the frame must not hold is the page the frame is in.
 * Tauri serves this app from `tauri://localhost`, from `http://tauri.localhost`
 * on Windows and Android — this conf does not set `useHttpsScheme`, and the
 * `http://ipc.localhost` already in `connect-src` is that same scheme in
 * action — and from `http://localhost:1420` under `tauri dev`. That last one
 * the dev server prints, so `detect` finds it and `App.tsx` loads the first
 * address it finds without being asked: nobody has to type it for it to end up
 * in the frame.
 *
 * Framed, it is the *same* origin as the page holding it, and the frame is
 * sandboxed `allow-scripts allow-same-origin`. A same-origin frame keeps that
 * origin, so the framed copy reaches `parent.localStorage` — where the gateway
 * key is — `parent.document`, and the Tauri IPC bridge: every single thing the
 * panel's sandbox note says a frame can never do. It also mounts the whole app
 * inside itself, and because it shares that storage it restores the same rail
 * and the same address and does it again, a stack of app instances each firing
 * its own IPC and timers.
 *
 * So `normalise` refuses the address the page is on — `location.origin`, when
 * there is a page — and refuses `tauri.localhost`, `ipc.localhost` and
 * `asset.localhost` by name as well, so the rule holds on a platform whose app
 * scheme is not http and in a test with no `location` at all. This makes the
 * accepted set narrower than `frame-src`, and narrower is the safe direction:
 * a policy that allows more than this function does costs nothing, while a
 * function that allows more than the policy is the blank frame described above.
 *
 * ## Which rule refused
 *
 * `normalise` answers with an address or with null, which is everything the
 * frame needs and less than the address bar does. The bar has to put a
 * sentence in front of somebody, and one sentence cannot be true of every
 * refusal: told "only an address on this machine can be shown here:
 * localhost, 127.0.0.1 or a .localhost name, with any port", a person who
 * typed `localhost:1420` under `tauri dev` has been read back their own
 * address as the description of what would have been accepted. The refusal
 * above is the one refusal that sentence cannot explain, and it is the one a
 * dev-server address is most likely to hit.
 *
 * So `refuse` says which rule said no — `own-origin`, `bad-port`,
 * `too-long`, or `not-local` for everything else — and the panel picks the
 * sentence. Both are views of one verdict computed by `judge`: written as two
 * functions they could disagree, and a disagreement here is either a refusal
 * explained by a rule that would have accepted it or an accepted address with
 * a reason attached.
 *
 * The order the rules run in is not the order they were written in, because
 * the order is the answer. The host is judged before the port, so
 * `http://evil.dev:0/` is refused for being somebody else's machine rather
 * than for its port, and an address refused for the port it names is one this
 * pane would otherwise have shown. The single exception is a port the parser
 * will not accept at all — over 65535 — which fails the address before there
 * is a host to look at: `http://evil.dev:65536/` is answered about its port,
 * which is true of it, if not the most useful thing there was to say.
 *
 * ## 0.0.0.0 is where a server listens, not where a browser goes
 *
 * Django and Flask print `http://0.0.0.0:8000/` when bound to every interface.
 * That address means "this machine, from anywhere", and what it means for the
 * person reading it is `localhost`. So it is accepted and rewritten: the
 * policy names `localhost` and not `0.0.0.0`, browsers disagree about whether
 * the unspecified address is navigable at all, and the person typed what the
 * terminal printed. `127.0.0.1` and `[::1]` are left as written — they are
 * real destinations, and a server bound to one of them is not necessarily
 * reachable at the other.
 *
 * ## Completing what people type
 *
 * `5173` means `http://localhost:5173/`, and `localhost:5173` means the same.
 * The address bar is a field a person fills in while looking at a terminal,
 * and the terminal said the port; making them type the rest is a quiz. Only
 * two completions exist — a bare port, and a missing scheme — because those
 * are the two things a person leaves out. A scheme that is not http or https
 * is not completed, it is refused: `file:` and `javascript:` are exactly what
 * this frame must never show.
 *
 * ## Finding the address in what the terminal prints
 *
 * `detect` reads a chunk of terminal output and returns the local addresses
 * in it, in the order they appear, each once. Vite, Next, Tauri, Rails,
 * Django and Flask all print a URL, so a URL is the first thing looked for;
 * Express-style servers say "listening on port 3000" and print no URL at all,
 * so a port on a line that says something is listening, running or ready is
 * the second. A port that merely appears — "connection refused on port 22" —
 * is not an address, and is left alone.
 *
 * An address ends where the line stops describing it: at whitespace, at a
 * quote or a bracket or a brace it was wrapped in, at a comma separating it
 * from the next one, and at the full stop the sentence ends with. It ends at
 * the host too — a port that runs on into a domain or a word is not a port on
 * a host this pane will show, and such a line yields nothing rather than the
 * bare host that happens to be inside it.
 *
 * A word in any script. The boundary at either end of the host is written in
 * Unicode letter and digit classes rather than in `\w`, so that
 * `localhost:3000ünchen` and `localhost:3000.日本.com` are refused for the
 * reason `localhost:3000.internal.corp` is, instead of accepted because the
 * letter after the port is not an ASCII one — and `日本localhost:3000`, a
 * name that merely ends in `localhost`, for the reason `notlocalhost:3000`
 * is. The cost is a line that puts an address hard against a word, which
 * Japanese, having no spaces, will do; that is the right way round, because a
 * missed address is one somebody types by hand, while an invented one is
 * loaded into the frame without anybody being asked.
 *
 * Every candidate goes through `normalise`, so what `detect` returns is what
 * the pane would accept if it were typed, and `Network: http://192.168.1.5:5173/`
 * — the other line Vite prints — is dropped for the reason above.
 *
 * ## Recent, not history
 *
 * The list of recent addresses is twelve long and the most recent is first.
 * It is a list of *places*, not a log of visits: a dev server on a project is
 * one address, and the person wants it offered next time without scrolling
 * past the forty times they reloaded it. Within-session back and forward is
 * the panel's, not this list's.
 *
 * ## The store
 *
 * `read` repairs what it is given rather than throwing, as every store in
 * this app does: a corrupt value is the empty state, never a window that will
 * not open. Every address that comes out of storage goes through `normalise`
 * on the way in, so a store edited by hand — or by a version of this file
 * that accepted more — cannot put something in the frame that the current
 * rule would refuse. The rule is enforced at the frame's only entrance.
 */

import { stripAnsi } from './ansi';

/** What the app keeps: the address showing, and the ones shown before. */
export interface Stored {
  url: string | null;
  recent: string[];
}

/** Where the state is kept. Versioned, so a future shape can be told apart. */
export const KEY = 'vylo.browser.v1';

/** How many recent addresses are kept. A menu, not a history. */
export const MAX_RECENT = 12;

/**
 * The longest address accepted — of what is typed, and again of what comes
 * back. The same ceiling `open_url` applies on the Rust side: past this it is
 * not something anybody typed.
 *
 * Both ends are measured because the parser can hand back an address far
 * longer than the one that went in: a path of non-ASCII characters comes out
 * percent-encoded, at up to twelve characters for one of them. It is the
 * *result* that is stored, put in the frame and handed to `open_url`, so a
 * ceiling on the input alone would let a thousand-character path through and
 * leave the Rust side to refuse it afterwards, complaining about a length
 * nobody typed.
 */
const MAX_LENGTH = 2048;

// ── Which addresses count ──────────────────────────────────────────────────

/** A subdomain of the reserved loopback domain: `app.localhost`, `a.b.localhost`. */
const DOT_LOCALHOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.localhost$/;

/** A string that begins with a URL scheme and `//`: something the parser can take whole. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Nothing but a port number. */
const BARE_PORT = /^\d{1,5}$/;

/**
 * The port inside an address the parser refused to take at all.
 *
 * `port_ok` below judges the port the parser produced, which is where `:0` is
 * caught: the parser keeps that one. A port above 65535 it does not keep — it
 * refuses the whole address — and an address the parser will not parse is
 * indistinguishable from nonsense. Called nonsense, `localhost:65536` is told
 * that only `localhost`, `127.0.0.1` or a `.localhost` name may be shown,
 * which is a list containing the host it typed.
 *
 * So the digits are read back out of the candidate the parser rejected, and
 * handed to `port_ok`, purely to name the reason: the addresses this module
 * accepts are still exactly the ones the parser accepts. `http://local
 * host:5173` fails to parse for its space, names a port that is perfectly
 * fine, and is reported as what it is rather than as a port problem.
 *
 * The run-up is greedy, so the colon found is the authority's last:
 * `http://user:pw@localhost:5173/` reads as port 5173, while
 * `http://localhost:5173@evil.dev/` — where the digits are not a port at all
 * — reads as no port, since only `/`, `?`, `#` or the end may follow them.
 */
const AUTHORITY_PORT = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*:(\d+)(?:[/?#]|$)/i;

/**
 * Whether a parsed hostname is one of the loopback names the pane will show.
 *
 * The URL parser has already lowercased the name and normalised the IPv4
 * spellings (`127.1` and `2130706433` both come out as `127.0.0.1`), so
 * exact comparison is enough here.
 */
function loopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0'
    || hostname === '[::1]' || DOT_LOCALHOST.test(hostname);
}

/**
 * The hostnames Tauri serves this app itself from when the app's scheme is
 * http — Windows and Android, unless `useHttpsScheme` is set, which this
 * app's conf does not set. `loopback` accepts all three as `*.localhost`
 * names, and `frame-src`'s `http://*.localhost:*` allows them, so nothing
 * else in the chain would refuse them.
 *
 * They are listed by name rather than left to `is_self` below, because the
 * platform that serves the app from `tauri://localhost` still has an
 * `asset.localhost` and an `ipc.localhost`, and because a rule that only
 * works where `location` can be read is a rule that is off in every test.
 */
const TAURI_HOSTS = new Set(['tauri.localhost', 'ipc.localhost', 'asset.localhost']);

/**
 * Whether an accepted address is the page this code is running in.
 *
 * Read at call time, from `globalThis`, because this module is also loaded
 * where there is no page at all — the tests import it into node — and there
 * the question has no answer and every address is somebody else's. An opaque
 * origin serialises as the string `null`, which is not an origin anything can
 * be framed from, so it never counts as a match.
 */
function is_self(u: URL): boolean {
  const here = (globalThis as { location?: { origin?: string } }).location?.origin;
  return typeof here === 'string' && here !== '' && here !== 'null' && u.origin === here;
}

/**
 * Whether a parsed port is one a server can be reached on: 1 to 65535.
 *
 * The parser does part of this itself — it refuses anything above 65535, and
 * leaves the field empty for a scheme's default port — but `:0` it accepts,
 * and zero is the number a program hands the kernel to mean "choose one for
 * me", never a number something is listening on. Loading it is a blank frame.
 *
 * The check is here, on the port the parser produced, rather than on the
 * digits of a bare port, so that it holds for every spelling of the same
 * mistake: `0`, `localhost:0`, `http://localhost:0/`, and an address coming
 * back out of the store through `read` or into the list through `recent`.
 *
 * `AUTHORITY_PORT` above hands it digits the parser never produced, which is
 * not a second gate — that address is refused either way — but the same
 * predicate answering what to *call* the refusal, so the two cannot drift.
 */
function port_ok(port: string): boolean {
  if (port === '') return true;
  const n = Number(port);
  return n >= 1 && n <= 65535;
}

/**
 * Which rule refused an address.
 *
 * `own-origin` is this app's own page, `bad-port` a port nothing can be
 * listening on, `too-long` past `MAX_LENGTH`, and `not-local` everything else
 * — another host, another scheme, credentials in the address, nonsense, and
 * an empty string, which is not an address either. Four, not one per `return`
 * below, because these are the four things there is a different sentence to
 * say about. See "Which rule refused".
 */
export type Refusal = 'own-origin' | 'not-local' | 'bad-port' | 'too-long';

/** An address the frame can load, or the rule that refused it. Never both. */
type Verdict = { url: string; no?: undefined } | { url?: undefined; no: Refusal };

/**
 * The whole rule, once, for the two functions below to read differently.
 *
 * `normalise` wants the address and `refuse` wants the reason, and they have
 * to be the same judgement or the panel explains a refusal by a rule that did
 * not refuse it.
 */
function judge(input: string): Verdict {
  const raw = (typeof input === 'string' ? input : '').trim();
  if (!raw) return { no: 'not-local' };
  if (raw.length > MAX_LENGTH) return { no: 'too-long' };

  let candidate = raw;
  if (BARE_PORT.test(raw)) {
    candidate = `http://localhost:${raw}/`;
  } else if (!HAS_SCHEME.test(raw)) {
    // `localhost:5173` parses as scheme `localhost:` with path `5173`, so the
    // scheme has to be supplied before the parser sees it.
    candidate = `http://${raw}`;
  }

  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    // A port over 65535 is refused by refusing the address whole, so the one
    // thing the parser can no longer be asked is read off the text instead.
    const digits = AUTHORITY_PORT.exec(candidate);
    return { no: digits && !port_ok(digits[1]) ? 'bad-port' : 'not-local' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { no: 'not-local' };
  if (u.username || u.password) return { no: 'not-local' };
  // The host before the port, so that somebody else's machine is refused for
  // being somebody else's machine whatever port it names.
  if (!loopback(u.hostname)) return { no: 'not-local' };
  if (!port_ok(u.port)) return { no: 'bad-port' };
  if (u.hostname === '0.0.0.0') u.hostname = 'localhost';
  // Refused after the rewrite, because the rewrite is what the frame would
  // load: under `tauri dev` the app is on `localhost:1420`, and so is
  // `0.0.0.0:1420`. See "Every loopback address except this app's own".
  if (TAURI_HOSTS.has(u.hostname) || is_self(u)) return { no: 'own-origin' };
  // Measured after the rewrite, because the rewrite is part of the result.
  if (u.href.length > MAX_LENGTH) return { no: 'too-long' };
  return { url: u.href };
}

/**
 * The address a person typed, as the URL the frame will load — or null.
 *
 * Accepted: http or https, to `localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]`
 * or `*.localhost`, with any port in 1..65535 and any path. A bare port is
 * completed to
 * `http://localhost:<port>/`; a missing scheme is completed to `http://`.
 * Anything else — another host, another scheme, credentials in the address,
 * nonsense — is null, and the caller says so rather than guessing. So is this
 * app's own page, which is a loopback address like any other and the one the
 * frame must never hold.
 *
 * The result is the parser's serialisation, so two spellings of one address
 * are one string: `HTTP://LOCALHOST:5173` and `http://localhost:5173/` both
 * come out as the latter, which is what lets the recent list hold each place
 * once.
 */
export function normalise(input: string): string | null {
  return judge(input).url ?? null;
}

/**
 * Why that address was refused, or null if it was not refused.
 *
 * For the address bar, which has to say something true about an address it
 * would not take. Everything that only has to *hold* an address — the frame,
 * the store, the recent list — asks `normalise` and gets no reason, because
 * there is nobody there to read one.
 */
export function refuse(input: string): Refusal | null {
  return judge(input).no ?? null;
}

/**
 * The short form for a tab or a row: `localhost:5173`, `localhost:5173/app`,
 * `https://localhost:8443` — the scheme shown only when it is the unusual one.
 *
 * A string that is not an address comes back as it is: this is for display,
 * and displaying what was given beats displaying nothing.
 */
export function label(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const scheme = u.protocol === 'https:' ? 'https://' : '';
  const path = u.pathname === '/' && !u.search && !u.hash ? '' : `${u.pathname}${u.search}${u.hash}`;
  return `${scheme}${u.host}${path}`;
}

// ── Finding an address in terminal output ──────────────────────────────────

/**
 * A URL to a loopback host, as a dev server prints one.
 *
 * The host has to end where the host ends: the lookahead refuses a name that
 * goes on — `http://localhost.evil.dev` would otherwise be found as
 * `http://localhost`, which is the one address in it that is not there.
 *
 * A name goes on in any alphabet, so the boundary is written `\p{L}\p{N}`
 * under the `u` flag rather than `\w`, which is ASCII and would have let
 * `http://localhost:3000.日本.com` and `http://localhost:3000ünchen` through
 * as `http://localhost:3000/`. Those are not addresses in those lines any
 * more than `http://localhost:3000.evil.dev` is one in its own.
 *
 * Host and port are matched inside a lookahead and then consumed through the
 * backreference to it, which is how a regular expression is made to keep a
 * port it has matched. Written the obvious way, as an optional group followed
 * by the boundary, the port is something the match can give back to make the
 * boundary hold: in `http://localhost:3000.evil.dev` the engine drops `:3000`,
 * finds a boundary after the bare host, and reports `http://localhost` —
 * again the one address in the line that is not in it, and the same for
 * `:3000abc` and `:3000-1`. A lookahead is not re-entered once it has
 * succeeded, so what it matched cannot be given back: either the boundary
 * holds after the host *and* its port, or the line yields nothing.
 *
 * The path runs to whitespace, a quote, a closing bracket or brace, or a
 * comma, and trailing punctuation is trimmed afterwards: `Starting development server at
 * http://127.0.0.1:8000/` ends in a slash, but `at http://localhost:3000.`
 * ends in a full stop that belongs to the sentence. A closing brace ends an
 * address for the reason a closing bracket does — the address was wrapped in
 * it, not extended by it — and a comma ends one because a line that prints
 * two addresses is a line that puts a comma between them.
 */
const URL_IN_TEXT = /\bhttps?:\/\/(?=((?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.localhost)(?::\d{1,5})?))\1(?![\p{L}\p{N}_-]|\.[\p{L}\p{N}_-])(?:\/[^\s"'<>)\]},]*)?/giu;

/**
 * `localhost:3000` with no scheme, as in "open localhost:3000 in your
 * browser". The port is required — the bare word appears in prose all the
 * time — and the leading group refuses a match inside a longer token, so
 * the host inside `http://localhost:3000` is not found a second time.
 *
 * It ends at the host for the same reason `URL_IN_TEXT` does, and needs the
 * same boundary to: without it `proxying to localhost:3000.internal.corp`
 * reported `http://localhost:3000/`, and `Failed to connect to
 * localhost:123456` reported `http://localhost:12345/` — a port cut out of a
 * longer number. Neither address is in the line, and `App.tsx` loads the first
 * address `detect` returns into the frame without being asked, so a line about
 * somewhere else opened whatever was on that local port.
 *
 * A plain lookahead is enough here, where the scheme'd pattern needs a
 * lookahead and a backreference, because there the port is optional and the
 * engine can give it back whole to make the boundary hold. Here it is
 * required: the only give-back is a shorter run of digits, and every prefix
 * of a longer number is followed by another digit, which the boundary
 * refuses too.
 *
 * Both ends of the host are Unicode classes under the `u` flag, and both had
 * to be. After the port, `\w` let `see localhost:3000ünchen` and `proxying to
 * localhost:3000.日本.com` report `http://localhost:3000/`, the address in
 * neither line. Before the host, it let `日本localhost:3000` report the same
 * — a name ending in `localhost` is not the loopback whatever the label in
 * front of it is written in, which is why `notlocalhost:3000` was already
 * refused. The trade is stated where `detect` is: a language that writes
 * without spaces can print an address this now walks past, and an address
 * nobody printed is the worse of the two mistakes.
 */
const HOST_PORT_IN_TEXT = /(^|[^\p{L}\p{N}_./:@-])((?:localhost|127\.0\.0\.1):\d{1,5}(?![\p{L}\p{N}_-]|\.[\p{L}\p{N}_-])(?:\/[^\s"'<>)\]},]*)?)/giu;

/**
 * "listening on port 3000", "Server started on port 8080", "ready on port
 * 4000". The verb has to be on the same line as the port: "port" on its own
 * is a word errors use too.
 *
 * The run-up is captured as well as the number, so that `detect` can record
 * the hit where the port is rather than where the verb is. The match starts
 * at the verb, and a verb can be a whole line ahead of its port: `running on
 * http://localhost:3000 port 3001` would file 3001 at the `r`, in front of a
 * URL printed after it, and a list that says it is in order of first
 * appearance would come back the wrong way round.
 */
const PORT_IN_TEXT = /(\b(?:listen(?:ing|s)?|running|started|starting|serving|ready|available|bound|up)\b[^\n]{0,60}?\bport\s*[:=]?\s*)(\d{1,5})\b/gi;

/** Punctuation a sentence ends with, which a URL at the end of one picks up. */
const TRAILING = /[.,;:!?]+$/;

/**
 * The loopback addresses in a chunk of terminal output, each once, in the
 * order they first appear.
 *
 * ANSI colour is stripped first — Vite prints its URL in cyan, and the reset
 * sequence that follows would otherwise be read as part of the path. Every
 * candidate goes through `normalise`, so the result is exactly the addresses
 * the pane would accept typed, in the form the pane would store them.
 */
export function detect(text: string): string[] {
  const plain = stripAnsi(typeof text === 'string' ? text : '');
  const found: { at: number; url: string }[] = [];

  for (const m of plain.matchAll(URL_IN_TEXT)) {
    found.push({ at: m.index ?? 0, url: m[0].replace(TRAILING, '') });
  }
  for (const m of plain.matchAll(HOST_PORT_IN_TEXT)) {
    found.push({ at: (m.index ?? 0) + m[1].length, url: m[2].replace(TRAILING, '') });
  }
  for (const m of plain.matchAll(PORT_IN_TEXT)) {
    found.push({ at: (m.index ?? 0) + m[1].length, url: m[2] });
  }

  found.sort((a, b) => a.at - b.at);
  const out: string[] = [];
  for (const f of found) {
    const url = normalise(f.url);
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

// ── The recent list ────────────────────────────────────────────────────────

/**
 * The list with `url` at the front, once, and no more than `cap` entries.
 *
 * The address goes through `normalise` first, so the list never holds two
 * spellings of one place — and never holds an address the pane would refuse.
 * One that does not normalise leaves the list as it was, as a copy.
 */
export function recent(list: readonly string[], url: string, cap = MAX_RECENT): string[] {
  const u = normalise(url);
  if (!u) return [...list];
  return [u, ...list.filter((x) => x !== u)].slice(0, Math.max(0, cap));
}

// ── Reading and writing the store ──────────────────────────────────────────

/** The empty state. A fresh object each time, so nobody shares one. */
const empty = (): Stored => ({ url: null, recent: [] });

/**
 * Read the stored state, repairing anything untrustworthy.
 *
 * A corrupt value is the empty state. An address that does not pass
 * `normalise` — whatever version of this file wrote it — is dropped, whether
 * it is the current one or a recent one; the recent list is deduplicated and
 * capped on the way in, and anything in it that is not a string is skipped.
 */
export function read(raw: string | null): Stored {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty();
    const s = parsed as Record<string, unknown>;
    const url = typeof s.url === 'string' ? normalise(s.url) : null;
    const seen: string[] = [];
    if (Array.isArray(s.recent)) {
      for (const item of s.recent) {
        if (typeof item !== 'string') continue;
        const u = normalise(item);
        if (u && !seen.includes(u)) seen.push(u);
        if (seen.length >= MAX_RECENT) break;
      }
    }
    return { url, recent: seen };
  } catch {
    return empty();
  }
}

/** What goes into storage. Only the two fields, whatever else was on the object. */
export function write(s: Stored): string {
  return JSON.stringify({ url: s.url, recent: s.recent });
}
