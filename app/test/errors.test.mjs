// Error messages.
//
// The bar is that a message says what failed and what to do about it. A
// technically accurate string that leaves someone stuck is the failure mode
// this exists to prevent, so most of these check the guidance rather than the
// detail.
import { detailOf, explain } from '../.test-build/errors.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// ── getting the message out of whatever was thrown ────────────────────────
ok('an Error yields its message', detailOf(new Error('boom')) === 'boom');
ok('a string is itself', detailOf('plain failure') === 'plain failure');
ok('a Rust command rejection is a string', detailOf('a.txt: is a directory') === 'a.txt: is a directory');
ok('an object with a message works', detailOf({ message: 'from an object' }) === 'from an object');
ok('null does not crash', detailOf(null) === 'Unknown error.');
ok('undefined does not crash', detailOf(undefined) === 'Unknown error.');

// ── saying what failed ────────────────────────────────────────────────────
{
  const m = explain('disk full', 'save src/App.tsx');
  ok('the attempt is named', m.startsWith('Could not save src/App.tsx.'), m);
  ok('and the detail is kept', m.includes('Disk full'), m);
}
ok('a detail is capitalised and punctuated',
   explain('something odd', 'commit') === 'Could not commit. Something odd.',
   explain('something odd', 'commit'));
ok('an empty error still says something',
   explain('', 'save') === 'Could not save. Unknown error.', explain('', 'save'));

// ── saying what to do ─────────────────────────────────────────────────────
const advises = (err, phrase) => explain(err, 'do the thing').includes(phrase);
ok('a stale write says to reload',
   advises('a.txt changed on disk since this was prepared', 'Reload the file'), explain('a.txt changed on disk', 'x'));
ok('a missing folder says to reopen it',
   advises('workspace root is unreadable: No such file or directory', 'open it again'));
ok('a rejected key points at Settings',
   advises('The gateway rejected the API key. (401)', 'Check the key in Settings'));
ok('a rate limit says to wait',
   advises('Rate limited by the gateway', 'Wait a moment'));
ok('no subscription points at the plan page',
   advises('No active subscription. Choose a plan', 'chat.vylo-tech.com'));
ok('a stopped MCP server says to enable it',
   advises('"pg" is not running', 'Enable it in Settings'));
ok('an ambiguous edit anchor explains itself',
   advises('a.ts: old_string appears 3 times', 'longer, unique anchor'));
ok('a binary file says so',
   advises('a.png: not valid UTF-8 (binary?)', 'binary file'));
ok('a containment refusal explains the boundary',
   advises('/etc/passwd escapes the workspace', 'inside the open folder'));
ok('a conversation past the context window says what to do',
   advises('prompt is too long: 249890 tokens > 200000 maximum', 'start a new chat'));
ok('and is not mistaken for a file that is too large',
   !advises('prompt is too long: 249890 tokens > 200000 maximum', 'read part of it'));
ok('a rejected max_tokens points at the model picker',
   advises('max_tokens: 16384 > 8192, which is the maximum allowed', 'choose another model'));

// ── not saying it twice ───────────────────────────────────────────────────
{
  const gateway = 'Could not reach the gateway at https://capi.vylo-tech.com. Check the address in Settings, that you are online, and that the gateway allows this app.';
  const m = explain(gateway, 'send the message');
  ok('a message that already explains itself is not prefixed',
     !m.includes('Could not send the message'), m);
  ok('and is passed through intact', m.startsWith('Could not reach the gateway'), m.slice(0, 40));
}
{
  // The detail already tells you to reload, so the advice is not repeated.
  const m = explain('a.txt changed on disk since this was prepared. Reload the file and try again.', 'approve');
  ok('advice already present is not appended twice',
     (m.match(/Reload the file/g) || []).length === 1, m);
}

// ── an unrecognised failure still reads as a sentence ─────────────────────
{
  const m = explain(new Error('EPIPE broken pipe'), 'run the command');
  ok('an unknown failure names the attempt', m === 'Could not run the command. EPIPE broken pipe.', m);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
