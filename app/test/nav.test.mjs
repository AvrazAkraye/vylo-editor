// The navigation trail behind go-to-definition.
//
// Back is the half of go-to-definition that is easy to leave out, and the half
// that decides whether the feature helps or hurts. Everything here is about it
// behaving the way a back button behaves, because that is the only model
// anybody has.
import { NO_NAV, visit, back, forward, canBack, canForward, forget } from '../.test-build/nav.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const at = (n) => n.list[n.at] ?? null;
const P = (path, line = 1) => ({ path, line });

// ── an empty trail ────────────────────────────────────────────────────────
ok('nothing to go back to', !canBack(NO_NAV) && back(NO_NAV).place === null);
ok('nothing to go forward to', !canForward(NO_NAV) && forward(NO_NAV).place === null);
ok('and going back does not disturb it', back(NO_NAV).nav === NO_NAV);

// ── walking a trail ───────────────────────────────────────────────────────
{
  let n = NO_NAV;
  n = visit(n, P('a.ts', 10));
  ok('the first place is the current one', at(n).path === 'a.ts');
  ok('but there is still nothing behind it', !canBack(n));

  n = visit(n, P('b.ts', 3));
  n = visit(n, P('c.ts', 7));
  ok('the trail is three long', n.list.length === 3 && n.at === 2);

  const b1 = back(n); n = b1.nav;
  ok('back returns the previous place', b1.place.path === 'b.ts' && b1.place.line === 3);
  ok('and the line comes with it, not just the file', at(n).line === 3);
  const b2 = back(n); n = b2.nav;
  ok('back again reaches the start', b2.place.path === 'a.ts');
  ok('and stops there', !canBack(n) && back(n).place === null);

  const f1 = forward(n); n = f1.nav;
  ok('forward retraces', f1.place.path === 'b.ts');
  const f2 = forward(n); n = f2.nav;
  ok('all the way to the end', f2.place.path === 'c.ts' && !canForward(n));
  ok('and stops there too', forward(n).place === null);
  ok('nothing was lost on the way', n.list.length === 3);
}

// ── the branch rule ───────────────────────────────────────────────────────
{
  let n = NO_NAV;
  for (const p of ['a.ts', 'b.ts', 'c.ts']) n = visit(n, P(p));
  n = back(n).nav;                      // now at b.ts, with c.ts ahead
  ok('there is something ahead', canForward(n));
  n = visit(n, P('d.ts'));
  ok('going somewhere new discards what was ahead',
     !canForward(n) && !n.list.some((p) => p.path === 'c.ts'), n.list.map((p) => p.path));
  ok('and what was behind is untouched',
     n.list.map((p) => p.path).join() === 'a.ts,b.ts,d.ts', n.list.map((p) => p.path));
}

// ── arriving where you already are ────────────────────────────────────────
{
  let n = visit(visit(NO_NAV, P('a.ts', 4)), P('b.ts', 9));
  const again = visit(n, P('b.ts', 9));
  ok('is not recorded', again === n);
  ok('so back still goes back one real step', back(again).place.path === 'a.ts');
  const otherLine = visit(n, P('b.ts', 40));
  ok('but the same file at another line is a real move', otherLine.list.length === 3);
}

// ── the cap ───────────────────────────────────────────────────────────────
{
  let n = NO_NAV;
  for (let i = 0; i < 200; i++) n = visit(n, P(`f${i}.ts`, i + 1));
  ok('the trail is bounded', n.list.length <= 50, n.list.length);
  ok('and the cursor still points at where you are',
     at(n).path === 'f199.ts', at(n));
  ok('and back still walks it', back(n).place.path === 'f198.ts');
  ok('the oldest entries are the ones dropped',
     !n.list.some((p) => p.path === 'f0.ts') && n.list.some((p) => p.path === 'f199.ts'));
}

// ── a file that stops existing ────────────────────────────────────────────
{
  let n = NO_NAV;
  for (const p of ['a.ts', 'gone.ts', 'b.ts', 'gone.ts', 'c.ts']) n = visit(n, P(p));
  const trimmed = forget(n, 'gone.ts');
  ok('the deleted file is gone from the trail',
     !trimmed.list.some((p) => p.path === 'gone.ts'), trimmed.list.map((p) => p.path));
  ok('and you are still where you were', at(trimmed).path === 'c.ts', at(trimmed));
  ok('and back skips the hole', back(trimmed).place.path === 'b.ts');
}
{
  // Deleting the file you are looking at: the cursor has to land somewhere real.
  let n = NO_NAV;
  for (const p of ['a.ts', 'b.ts', 'gone.ts']) n = visit(n, P(p));
  const trimmed = forget(n, 'gone.ts');
  ok('deleting the current file leaves a valid cursor',
     trimmed.at === trimmed.list.length - 1 && at(trimmed).path === 'b.ts', trimmed);
}
{
  let n = visit(NO_NAV, P('only.ts'));
  const empty = forget(n, 'only.ts');
  ok('forgetting the only entry empties the trail',
     empty.list.length === 0 && empty.at === -1 && !canBack(empty), empty);
}
ok('forgetting a file that was never visited changes nothing', (() => {
  const n = visit(NO_NAV, P('a.ts'));
  return forget(n, 'other.ts') === n;
})());

// ── the trail is not mutated in place ─────────────────────────────────────
{
  const a = visit(NO_NAV, P('a.ts'));
  const b = visit(a, P('b.ts'));
  ok('visiting returns a new trail', a.list.length === 1 && b.list.length === 2);
  const c = back(b);
  ok('and so does going back', b.at === 1 && c.nav.at === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
