// The arithmetic either side of an undo.
//
// Both of these fail silently. A cut point that is one line out restores a
// conversation that disagrees with the files on disk; picking the wrong
// checkpoint to redo puts back a state the project reached after one that was
// never restored. Neither throws, and neither is visible until somebody notices
// the transcript describing work that is not there.
import { cutPoints, redoTarget } from '../.test-build/checkpoints.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A transcript: plain lines, with `w(seq, hist)` for one reporting a write. */
const line = () => ({ kind: 'text' });
const w = (seq, hist) => ({ kind: 'result', cp: { seq, hist } });

// ── the ordinary shape ────────────────────────────────────────────────────
{
  // you, reply, WROTE(1), you, reply, WROTE(2), you, reply — eight lines, and a
  // history that has grown to 20 messages by the end.
  const lines = [line(), line(), w(1, 4), line(), line(), w(2, 12), line(), line()];
  const cuts = cutPoints([{ seq: 1 }, { seq: 2 }], lines, 20);

  ok('one cut point per checkpoint being undone', cuts.length === 2);
  ok('the older one ends just after the line that reported it',
     same(cuts[0], { seq: 1, ends: { upto: 3, hist: 5 } }), cuts[0]);
  ok('and its history is one past the length before the write, which approving appended to',
     cuts[0].ends.hist === 5);
  ok('the newest keeps the whole conversation, not just up to its own line',
     same(cuts[1], { seq: 2, ends: { upto: 8, hist: 20 } }), cuts[1]);
}

// ── the awkward ones ──────────────────────────────────────────────────────
{
  const lines = [line(), w(1, 2), line(), w(2, 6), line()];
  ok('an undo of nothing has nothing to keep', same(cutPoints([], lines, 9), []));

  const one = cutPoints([{ seq: 2 }], lines, 9);
  ok('a single checkpoint is the newest, so it keeps everything',
     same(one, [{ seq: 2, ends: { upto: 5, hist: 9 } }]), one);

  // The list arrives from `checkpoint_list` newest-first and is sorted by the
  // caller today; "the last one keeps everything" must not depend on that.
  const jumbled = cutPoints([{ seq: 2 }, { seq: 1 }], lines, 9);
  ok('the newest is decided by number, not by where it sat in the list',
     same(jumbled, [
       { seq: 1, ends: { upto: 2, hist: 3 } },
       { seq: 2, ends: { upto: 5, hist: 9 } },
     ]), jumbled);
}

{
  // A checkpoint whose line is not in this transcript: the chat was restored,
  // or the line was cut away by an earlier undo. There is no honest offset, so
  // it keeps everything rather than a guess.
  const lines = [line(), w(7, 3), line()];
  const cuts = cutPoints([{ seq: 4 }, { seq: 7 }], lines, 11);
  ok('a checkpoint with no line reporting it keeps the whole conversation',
     same(cuts[0], { seq: 4, ends: { upto: 3, hist: 11 } }), cuts[0]);
}

{
  // Every write in the chat is being undone, so the first cut is the empty
  // conversation — which is a real state and not a missing one.
  const lines = [w(1, 0), line()];
  const cuts = cutPoints([{ seq: 1 }], lines, 4);
  ok('undoing the only write keeps the transcript it produced',
     same(cuts, [{ seq: 1, ends: { upto: 2, hist: 4 } }]), cuts);
}

// ── which checkpoint redo offers ──────────────────────────────────────────
const m = (seq, undone, redoable = undone) => ({ seq, paths: [`${seq}.ts`], undone, redoable });

ok('nothing undone, nothing to redo', redoTarget([]) === null);
ok('and a list of applied checkpoints offers nothing either',
   redoTarget([m(3, false), m(2, false), m(1, false)]) === null);

{
  // Newest first, the way Rust sends it.
  const got = redoTarget([m(4, true), m(3, true), m(2, false), m(1, false)]);
  ok('redo puts back the oldest undone one, so it steps back over the undo',
     same(got, { seq: 3, paths: ['3.ts'] }), got);
}

ok('the answer does not depend on the order the list arrives in',
   same(redoTarget([m(3, true), m(4, true)]), redoTarget([m(4, true), m(3, true)])));

{
  // The oldest undone checkpoint predates redo, so it kept no `after` and no
  // transcript. Offering the one above it would write a state the project
  // reached *after* one that was never put back.
  const got = redoTarget([m(4, true), m(3, true, false)]);
  ok('a checkpoint that cannot be put back stops redo rather than being skipped',
     got === null, got);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
