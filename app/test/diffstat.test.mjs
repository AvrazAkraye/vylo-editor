// The size of the afternoon, on its way from git to the status bar.
//
// The interesting half of this feature is in Rust — parsing `--numstat -z`,
// the rename's two extra fields, the binary file that reports dashes — and it
// is tested there, against a real repository. What is left on this side is the
// join, and it is the join that has already broken once in this app: when
// `list_tree` grew an envelope, three call sites went on reading the old shape,
// typechecked perfectly and did nothing at runtime, because `invoke<T>` asserts
// `T` rather than checking it.
//
// So there are two things here. The wire, read out of `lib.rs` as text the way
// `stores.test.mjs` reads it — nothing in TypeScript can see the Rust end, and
// a renamed field is a status bar that silently stops drawing. And `decode`,
// one shape at a time, because "the reply was not what we expected" has to be a
// value this module returns rather than an exception thrown into a `catch` that
// meant "there is no git here".
import { readFileSync } from 'fs';
import { decode, diffstat, isEmpty } from '../.test-build/diffstat.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
};

// ── the wire ──────────────────────────────────────────────────────────────
{
  const rust = readFileSync('src-tauri/src/lib.rs', 'utf8').replace(/\r\n/g, '\n');
  const body = rust.slice(rust.indexOf('pub struct DiffStat {'));
  const fields = [...body.slice(0, body.indexOf('\n}')).matchAll(/^ {4}(\w+):/gm)].map((m) => m[1]);

  ok('lib.rs still has a DiffStat to decode', fields.length > 0, JSON.stringify(fields));
  // Serde serialises these names verbatim — there is no rename attribute on the
  // struct — so this list *is* the JSON the webview receives.
  ok('and its fields are exactly the four this module reads',
     JSON.stringify(fields) === JSON.stringify(['added', 'removed', 'files', 'binary']),
     JSON.stringify(fields));

  // A command the webview cannot reach is a feature that draws nothing.
  const handler = rust.slice(rust.indexOf('generate_handler!['));
  ok('git_diffstat is registered with the other commands',
     /\bgit_diffstat\b/.test(handler.slice(0, handler.indexOf(']'))));

  // The reason the command runs two diffs rather than one, pinned where
  // somebody simplifying it would look. `git diff HEAD` fails before the first
  // commit, which is exactly when the most is staged.
  ok('it asks git for the index as well as the worktree',
     /"diff", "--cached", "--numstat", "-z"/.test(rust)
     && /"diff", "--numstat", "-z"/.test(rust));
}

// ── decode, one shape at a time ───────────────────────────────────────────
{
  const good = { added: 412, removed: 87, files: 9, binary: 2 };
  ok('the shape git_diffstat actually returns decodes',
     JSON.stringify(decode(good)) === JSON.stringify(good), JSON.stringify(decode(good)));

  ok('a clean tree is four zeros and not a failure',
     JSON.stringify(decode({ added: 0, removed: 0, files: 0, binary: 0 }))
     === JSON.stringify({ added: 0, removed: 0, files: 0, binary: 0 }));

  // Forward compatible on purpose: a fifth field added in Rust must not blank
  // the whole bar, because the four this module needs are still there.
  ok('a field this app has not heard of is ignored rather than fatal',
     decode({ ...good, insertions: 3 })?.added === 412);

  ok('a missing field is not a zero', decode({ added: 1, removed: 2, files: 1 }) === null);
  ok('a number sent as a string is refused',
     decode({ added: '412', removed: 87, files: 9, binary: 2 }) === null);
  // The one that would otherwise reach the screen: `+NaN −87` is a bug report,
  // and every arithmetic path in JavaScript produces it silently.
  ok('NaN is refused rather than rendered',
     decode({ added: NaN, removed: 87, files: 9, binary: 2 }) === null);
  ok('Infinity is refused', decode({ added: Infinity, removed: 0, files: 1, binary: 0 }) === null);
  ok('a fractional line count is refused',
     decode({ added: 4.5, removed: 0, files: 1, binary: 0 }) === null);
  ok('a negative count is refused',
     decode({ added: -1, removed: 0, files: 1, binary: 0 }) === null);

  ok('null decodes to null rather than throwing', decode(null) === null);
  ok('undefined decodes to null', decode(undefined) === null);
  ok('a string decodes to null', decode('+412 -87') === null);
  ok('a number decodes to null', decode(412) === null);
  // An array is an object, so this is the shape that gets through a `typeof`
  // check and fails on the field after it.
  ok('an array decodes to null', decode([412, 87]) === null);
}

// ── what the status bar is allowed to draw ────────────────────────────────
{
  ok('a clean tree says nothing', isEmpty({ added: 0, removed: 0, files: 0, binary: 0 }));
  ok('an ordinary afternoon says something',
     !isEmpty({ added: 412, removed: 87, files: 9, binary: 0 }));

  // Both of the cases where the lines alone would read as a clean tree.
  ok('a file that moved without changing is still a change, and reads +0 −0',
     !isEmpty({ added: 0, removed: 0, files: 1, binary: 0 }));
  ok('and a change to binary files only is not an empty afternoon either',
     !isEmpty({ added: 0, removed: 0, files: 2, binary: 2 }));
}

// ── the wrapper ───────────────────────────────────────────────────────────
{
  // There is no Tauri host in node, so `invoke` rejects. That is the same
  // failure as a folder that is not a repository, and the contract is that a
  // status bar gets a value back rather than an exception.
  const answer = await diffstat('/nowhere');
  ok('a git that cannot answer is null, not a throw', answer === null, JSON.stringify(answer));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
