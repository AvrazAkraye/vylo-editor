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
 */
function port_ok(port: string): boolean {
  if (port === '') return true;
  const n = Number(port);
  return n >= 1 && n <= 65535;
}

/**
 * The address a person typed, as the URL the frame will load — or null.
 *
 * Accepted: http or https, to `localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]`
 * or `*.localhost`, with any port in 1..65535 and any path. A bare port is
 * completed to
 * `http://localhost:<port>/`; a missing scheme is completed to `http://`.
 * Anything else — another host, another scheme, credentials in the address,
 * nonsense — is null, and the caller says so rather than guessing.
 *
 * The result is the parser's serialisation, so two spellings of one address
 * are one string: `HTTP://LOCALHOST:5173` and `http://localhost:5173/` both
 * come out as the latter, which is what lets the recent list hold each place
 * once.
 */
export function normalise(input: string): string | null {
  const raw = (typeof input === 'string' ? input : '').trim();
  if (!raw || raw.length > MAX_LENGTH) return null;

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
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!port_ok(u.port)) return null;
  if (!loopback(u.hostname)) return null;
  if (u.hostname === '0.0.0.0') u.hostname = 'localhost';
  // Measured after the rewrite, because the rewrite is part of the result.
  if (u.href.length > MAX_LENGTH) return null;
  return u.href;
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
const URL_IN_TEXT = /\bhttps?:\/\/(?=((?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.localhost)(?::\d{1,5})?))\1(?![\w-]|\.[\w-])(?:\/[^\s"'<>)\]},]*)?/gi;

/**
 * `localhost:3000` with no scheme, as in "open localhost:3000 in your
 * browser". The port is required — the bare word appears in prose all the
 * time — and the leading group refuses a match inside a longer token, so
 * the host inside `http://localhost:3000` is not found a second time.
 */
const HOST_PORT_IN_TEXT = /(^|[^\w./:@-])((?:localhost|127\.0\.0\.1):\d{1,5}(?:\/[^\s"'<>)\]},]*)?)/gi;

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
