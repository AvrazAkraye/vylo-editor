// The dev-server pane: which addresses it will show, and how it finds them.
//
// One rule carries the module and most of what is below is a case of it: the
// frame shows loopback hosts and nothing else, because the pane is for the
// thing you are building, the policy names those hosts and no others, and a
// general browser inside an agent's window is a phishing surface. Everything
// that enters the frame — typed, found in the terminal, or read back from
// storage — goes through `normalise`, so that is where the rule is tested.
import {
  KEY, MAX_RECENT, detect, label, normalise, read, recent, write,
} from '../.test-build/browser.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// ── what an address may be ────────────────────────────────────────────────
ok('a full address passes as it is', normalise('http://localhost:5173/') === 'http://localhost:5173/');
// The terminal said the port; making somebody type the rest is a quiz.
ok('a bare port is completed', normalise('5173') === 'http://localhost:5173/');
ok('host and port are completed', normalise('localhost:5173') === 'http://localhost:5173/');
ok('and so is a path after them', normalise('localhost:5173/app') === 'http://localhost:5173/app');
ok('127.0.0.1 is kept as written', normalise('http://127.0.0.1:8000') === 'http://127.0.0.1:8000/');
ok('127.0.0.1 without a scheme', normalise('127.0.0.1:8000') === 'http://127.0.0.1:8000/');
// 0.0.0.0 is where a server listens, not where a browser goes. The policy
// names localhost, and localhost is what the person means.
ok('0.0.0.0 is rewritten to localhost', normalise('http://0.0.0.0:8000/') === 'http://localhost:8000/');
ok('and the rewrite keeps the port and path', normalise('0.0.0.0:8000/admin/') === 'http://localhost:8000/admin/');
ok('the IPv6 loopback is accepted as written', normalise('http://[::1]:5173/') === 'http://[::1]:5173/');
ok('and completed without a scheme', normalise('[::1]:5173') === 'http://[::1]:5173/');
// The whole .localhost domain is reserved for loopback (RFC 6761).
ok('a subdomain of .localhost is accepted', normalise('http://app.localhost:3000/') === 'http://app.localhost:3000/');
ok('and a deeper one', normalise('http://a.b.localhost/') === 'http://a.b.localhost/');
ok('https is accepted', normalise('https://localhost:8443/') === 'https://localhost:8443/');
ok('https to a .localhost subdomain', normalise('https://app.localhost') === 'https://app.localhost/');
ok('whitespace around it is trimmed', normalise('  localhost:5173  ') === 'http://localhost:5173/');
ok('scheme and host are lowercased', normalise('HTTP://LOCALHOST:5173') === 'http://localhost:5173/');
ok('a default port is dropped', normalise('http://localhost:80/') === 'http://localhost/');
ok('path, query and hash are kept', normalise('localhost:5173/a/b?x=1&y=2#top') === 'http://localhost:5173/a/b?x=1&y=2#top');
// The URL parser normalises IPv4 spellings; two more ways to say the loopback.
ok('127.1 is the loopback', normalise('http://127.1:8000/') === 'http://127.0.0.1:8000/');
ok('so is the decimal form', normalise('http://2130706433:8000/') === 'http://127.0.0.1:8000/');
ok('the largest port is fine', normalise('localhost:65535') === 'http://localhost:65535/');
ok('normalising twice is the same as once', (() => {
  for (const s of ['5173', 'localhost:5173', 'http://0.0.0.0:8000/', 'HTTPS://APP.LOCALHOST/x?y#z', '[::1]:9']) {
    const once = normalise(s);
    if (once === null || normalise(once) !== once) return false;
  }
  return true;
})());

// Everything that is not this machine is refused, with no substitute offered.
ok('another host is refused', (() => {
  for (const s of ['example.com', 'http://example.com', 'https://example.com:5173/', '192.168.1.5:5173',
                   'http://10.0.0.1:3000', 'http://127.0.0.2:3000', 'http://[::2]:3000']) {
    if (normalise(s) !== null) return false;
  }
  return true;
})());
// A domain that merely starts with "localhost" is not the loopback.
ok('localhost.evil.dev is not localhost', normalise('http://localhost.evil.dev:5173/') === null);
ok('nor is a name that ends in it without a dot', normalise('http://notlocalhost:3000/') === null
   && normalise('http://xlocalhost:3000/') === null);
ok('nor a trailing dot', normalise('http://localhost.:3000/') === null);
ok('nor localhost as a path on another host', normalise('http://evil.dev/localhost:5173') === null);
ok('nor localhost as credentials on another host', normalise('http://localhost:5173@evil.dev/') === null);
// file: and javascript: are exactly what the frame must never show.
ok('other schemes are refused, not completed', (() => {
  for (const s of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://localhost/', 'data:text/html,hi',
                   'ws://localhost:5173', 'tauri://localhost', 'about:blank', 'blob:http://localhost:5173/x']) {
    if (normalise(s) !== null) return false;
  }
  return true;
})());
ok('credentials in the address are refused', normalise('http://user:pw@localhost:5173/') === null
   && normalise('http://user@localhost:5173/') === null);
ok('nothing is refused', normalise('') === null && normalise('   ') === null);
ok('nonsense is refused', (() => {
  for (const s of ['not a url', 'http://', '::', 'http://local host:5173', 'localhost:port', ':5173', 'localhost:5173:', 'http://localhost:5173:80/']) {
    if (normalise(s) !== null) return false;
  }
  return true;
})());
// A colon with nothing after it is no port, which is what the parser says too.
ok('a trailing colon is the default port', normalise('localhost:') === 'http://localhost/');
ok('and so is something that is not a string', normalise(null) === null && normalise(undefined) === null && normalise(42) === null);
ok('an absurdly long address is refused', normalise(`http://localhost:5173/${'a'.repeat(3000)}`) === null);
// The ceiling is on what comes back, not only on what went in: percent-
// encoding multiplies a non-ASCII path several times over, and it is the
// result that is stored, framed, and handed to an `open_url` that measures
// the same 2048 and would refuse it complaining about a length nobody typed.
ok('an address that is only too long once encoded is refused', (() => {
  const typed = `https://localhost:5173/${'é'.repeat(1000)}`;
  return typed.length < 2048 && normalise(typed) === null;
})());
ok('but one that stays under it encoded is kept', (() => {
  const typed = `http://localhost:5173/${'a'.repeat(2000)}`;
  return typed.length < 2048 && normalise(typed) === typed;
})());
// Zero is what a program asks the kernel for when it wants any port at all;
// nothing is ever listening on it, so loading one is a blank frame. The check
// is on the port the parser produced, so it holds however the address is spelled.
ok('port zero is refused', normalise('0') === null);
ok('and so is every longer spelling of it', (() => {
  for (const s of ['localhost:0', 'http://localhost:0/', 'http://localhost:0/app',
                   'https://127.0.0.1:0/', 'http://0.0.0.0:0/', 'http://[::1]:0/',
                   'http://app.localhost:0/', '00', '0000']) {
    if (normalise(s) !== null) return false;
  }
  return true;
})());
ok('a port too large is refused', normalise('65536') === null && normalise('99999') === null
   && normalise('localhost:65536') === null);

// ── the short form ────────────────────────────────────────────────────────
ok('the root is host and port', label('http://localhost:5173/') === 'localhost:5173');
ok('a path is shown', label('http://localhost:5173/app') === 'localhost:5173/app');
ok('query and hash are shown', label('http://localhost:5173/app?x=1#top') === 'localhost:5173/app?x=1#top');
ok('no port, no colon', label('http://localhost/') === 'localhost');
// The scheme is shown only when it is the unusual one.
ok('https keeps its scheme', label('https://localhost:8443/') === 'https://localhost:8443');
ok('a .localhost subdomain', label('http://app.localhost:3000/x') === 'app.localhost:3000/x');
ok('the IPv6 loopback', label('http://[::1]:8080/') === '[::1]:8080');
ok('something that is not an address is shown as it is', label('what') === 'what');

// ── finding an address in terminal output ─────────────────────────────────
// The lines the common dev servers actually print.
ok('Vite: Local, and not Network',
   detect('  ➜  Local:   http://localhost:5173/\n  ➜  Network: http://192.168.1.5:5173/\n').join() === 'http://localhost:5173/');
// Vite prints the URL in cyan and the port in bold: the reset sequences sit
// between the host and the port, and after the slash.
ok('Vite with its colour codes',
   detect('\x1b[32m  ➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m\n').join() === 'http://localhost:5173/');
ok('Next', detect('   - Local:        http://localhost:3000\n   - Network:      http://192.168.1.5:3000\n').join() === 'http://localhost:3000/');
ok('Rails', detect('* Listening on http://127.0.0.1:3000\n').join() === 'http://127.0.0.1:3000/');
ok('Django', detect('Starting development server at http://127.0.0.1:8000/\nQuit the server with CONTROL-C.\n').join() === 'http://127.0.0.1:8000/');
// Flask prints both interfaces. They are two places: one is the loopback and
// the other, rewritten, is localhost.
ok('Flask, both lines', detect(' * Running on http://127.0.0.1:5000\n * Running on http://0.0.0.0:5000\n').join() === 'http://127.0.0.1:5000/,http://localhost:5000/');
ok('Tauri', detect('  ➜  Local:   http://localhost:1420/\n').join() === 'http://localhost:1420/');
ok('Django bound to every interface', detect('Starting development server at http://0.0.0.0:8000/').join() === 'http://localhost:8000/');
// Express-style servers print no URL at all.
ok('Express: listening on port', detect('Example app listening on port 3000\n').join() === 'http://localhost:3000/');
ok('"Server started on port"', detect('Server started on port 8080').join() === 'http://localhost:8080/');
ok('"ready on port"', detect('> ready on port 4000').join() === 'http://localhost:4000/');
ok('"port:" with a colon', detect('Listening on port: 9000').join() === 'http://localhost:9000/');
// A port that merely appears is not an address.
ok('a port in an error is not an address', detect('connection refused on port 22').length === 0);
// A host and port is an address wherever it appears; it is the person who
// picks from the list, and a wrong pick is a blank frame, not a hazard.
ok('but a host and port in an error line still is one',
   detect('connect ECONNREFUSED 127.0.0.1:22').join() === 'http://127.0.0.1:22/');
ok('"port 3000" on its own is not an address', detect('port 3000').length === 0);
ok('the verb has to be on the same line', detect('listening\non port 3000').length === 0);
ok('a scheme-less host and port is found', detect('open localhost:3000 in your browser').join() === 'http://localhost:3000/');
ok('a full stop at the end of the sentence is not part of the path',
   detect('Serving at http://localhost:3000.').join() === 'http://localhost:3000/');
ok('brackets around it are not part of it',
   detect('(http://localhost:3000/) and <http://localhost:4000>').join() === 'http://localhost:3000/,http://localhost:4000/');
ok('a path is kept', detect('open http://localhost:5173/admin/ to start').join() === 'http://localhost:5173/admin/');
ok('the IPv6 loopback is found', detect('Listening on http://[::1]:8080').join() === 'http://[::1]:8080/');
ok('a .localhost subdomain is found', detect('Local: http://app.localhost:3000/').join() === 'http://app.localhost:3000/');
ok('the same address twice is one address',
   detect('http://localhost:3000/\nhttp://localhost:3000/\n').join() === 'http://localhost:3000/');
ok('and two spellings of it are one address',
   detect('http://localhost:3000 and localhost:3000/ and port 3000 is up').join() === 'http://localhost:3000/');
// Order is order of appearance, whichever pattern found each.
ok('addresses come back in the order they were printed',
   detect('listening on port 3000\nLocal: http://localhost:5173/\nopen 127.0.0.1:8000').join()
   === 'http://localhost:3000/,http://localhost:5173/,http://127.0.0.1:8000/');
// The boundary after the host is not something the port can be given back to
// satisfy. A line that carries no address must yield none, rather than the
// bare host left behind when the port is dropped.
ok('a port that runs on into a domain is not an address', detect('http://localhost:3000.evil.dev').length === 0);
ok('nor one that runs on into a word', detect('http://localhost:3000abc').length === 0);
ok('nor one that runs on into a dash', detect('http://localhost:3000-1').length === 0);
ok('though the same host and port, ended properly, still is',
   detect('http://localhost:3000/x http://localhost:4000').join() === 'http://localhost:3000/x,http://localhost:4000/');
// In order of first appearance means the port's place in the line, not the
// verb's: "running" sits ahead of a URL that is printed before the port is.
ok('a port named after a URL comes after it',
   detect('running on http://localhost:3000 port 3001').join() === 'http://localhost:3000/,http://localhost:3001/');
ok('and before one printed after it',
   detect('listening on port 3000, then http://localhost:5173/').join() === 'http://localhost:3000/,http://localhost:5173/');
// An address ends where the line stops describing it.
ok('braces around it are not part of it either', detect('{http://localhost:3000/}').join() === 'http://localhost:3000/');
// Two, counted — one string holding a comma joins to the same thing as two.
ok('a comma between two of them belongs to neither', (() => {
  const d = detect('http://localhost:3000/,http://localhost:4000/');
  return d.length === 2 && d.join() === 'http://localhost:3000/,http://localhost:4000/';
})());
ok('and that holds without a scheme too', (() => {
  const d = detect('open localhost:3000/,localhost:4000/ to start');
  return d.length === 2 && d.join() === 'http://localhost:3000/,http://localhost:4000/';
})());
ok('an address on port zero is not found', detect('Local: http://localhost:0/ and listening on port 0').length === 0);
ok('addresses that are not this machine are not found', detect('https://example.com http://10.0.0.5:3000 http://localhost.evil.dev:3000/').length === 0);
ok('nothing in, nothing out', detect('').length === 0 && detect(null).length === 0 && detect(undefined).length === 0);
ok('detect returns a fresh array', (() => {
  const a = detect('x'); const b = detect('x');
  return a !== b && Array.isArray(a);
})());

// ── the recent list ───────────────────────────────────────────────────────
const A = 'http://localhost:5173/', B = 'http://localhost:3000/', C = 'http://127.0.0.1:8000/';
ok('a new address goes to the front', recent([A, B], C).join() === [C, A, B].join());
ok('an address already there moves to the front, once', recent([A, B, C], C).join() === [C, A, B].join());
ok('the front stays the front', recent([A, B], A).join() === [A, B].join());
ok('it is normalised on the way in', recent([A], '3000').join() === [B, A].join());
ok('so two spellings are one entry', recent([A], 'LOCALHOST:5173').join() === A);
ok('the list is capped at twelve', (() => {
  let list = [];
  for (let p = 3000; p < 3020; p++) list = recent(list, `localhost:${p}`);
  return list.length === MAX_RECENT && MAX_RECENT === 12 && list[0] === 'http://localhost:3019/';
})());
ok('a smaller cap is honoured', recent([A, B, C], 'localhost:9', 2).join() === 'http://localhost:9/,http://localhost:5173/');
ok('a cap of zero is an empty list', recent([A], B, 0).length === 0);
ok('an address that is refused leaves the list as it was', recent([A, B], 'https://example.com').join() === [A, B].join());
ok('and port zero is refused here too', recent([A, B], 'http://localhost:0/').join() === [A, B].join());
ok('but as a copy', (() => { const l = [A]; return recent(l, 'nope') !== l; })());
ok('recent does not mutate what it was given', (() => { const l = [A, B]; recent(l, C); return l.join() === [A, B].join(); })());

// ── reading and writing the store ─────────────────────────────────────────
ok('the storage key is what the app expects', KEY === 'vylo.browser.v1');
ok('a good state round-trips exactly', (() => {
  const s = { url: A, recent: [A, B] };
  return JSON.stringify(read(write(s))) === JSON.stringify(s);
})());
ok('nothing stored is the empty state', read(null).url === null && read(null).recent.length === 0
   && read('').url === null && read('').recent.length === 0);
ok('corrupt JSON is the empty state', read('{{{').url === null && read('{{{').recent.length === 0);
ok('an array is the empty state', read('["http://localhost:5173/"]').url === null);
ok('a scalar is the empty state', read('7').url === null && read('"x"').recent.length === 0);
ok('and none of those throw', (() => {
  for (const bad of [null, '', '[]', '{}', '7', 'null', 'undefined', '{"url":{}}', '{"recent":"x"}', '{"recent":{}}']) read(bad);
  return true;
})());
// The rule is enforced at the frame's only entrance: an address a hand-edited
// store — or an older version of the rule — put there is refused on the way in.
ok('a stored address that is not this machine is dropped', read('{"url":"https://example.com/","recent":[]}').url === null);
// A store written by a version of this file that accepted `:0` does not get
// to put a blank frame in front of somebody now.
ok('a stored address on port zero is dropped', (() => {
  const s = read(JSON.stringify({ url: 'http://localhost:0/', recent: ['http://localhost:0/', A] }));
  return s.url === null && s.recent.join() === A;
})());
ok('a stored address is normalised', read('{"url":"localhost:5173","recent":[]}').url === A);
ok('a stored url that is not a string is null', read('{"url":5173,"recent":[]}').url === null);
ok('a missing recent list is empty', read('{"url":null}').recent.length === 0);
ok('in the recent list, what is not a string is skipped and what is refused is dropped',
   read(JSON.stringify({ url: null, recent: [A, 3, null, 'https://example.com/', B] })).recent.join() === [A, B].join());
ok('duplicates in the recent list collapse', read(JSON.stringify({ url: null, recent: [A, 'localhost:5173', A, B] })).recent.join() === [A, B].join());
ok('the recent list is capped on the way in', (() => {
  const many = Array.from({ length: 30 }, (_, i) => `http://localhost:${4000 + i}/`);
  return read(JSON.stringify({ url: null, recent: many })).recent.length === MAX_RECENT;
})());
ok('the current address need not be in the recent list', (() => {
  const s = read(JSON.stringify({ url: C, recent: [A] }));
  return s.url === C && s.recent.join() === A;
})());
ok('write keeps only the two fields', (() => {
  const out = JSON.parse(write({ url: A, recent: [B], extra: 'x' }));
  return Object.keys(out).join() === 'url,recent';
})());
ok('read returns a fresh object each time', read(null) !== read(null) && read(null).recent !== read(null).recent);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
