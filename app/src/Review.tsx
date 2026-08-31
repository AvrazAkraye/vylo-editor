import { useEffect, useMemo, useRef, useState } from 'react';
import { buildPartial, diffRows, hunks, type Change, type Hunk, type Row } from './pending';
import { DiffRows } from './DiffRows';
import { highlightLines, type Span } from './highlight';
import { checkParse, hunksWithParseError, type Check, type Reason } from './parses';
import { useGrammars } from './useGrammars';
import { Icon } from './Icon';

interface Props {
  changes: Change[];
  onApprove: (paths: string[]) => void;
  /** Write only the ticked hunks of one file; the rest stay staged. */
  onApproveHunks: (path: string, content: string) => void;
  onReject: (paths: string[]) => void;
  busy: boolean;
  t: (s: string) => string;
}

/**
 * The approval gate.
 *
 * Nothing the agent proposes reaches the disk without passing through here, so
 * the diff has to be readable enough that people actually look at it. An
 * approval flow that is tedious gets click-throughed, and a click-throughed
 * gate is the same as no gate.
 *
 * The whole file used to be one decision, which made the gate coarser than the
 * thing it guards: a change is rarely uniformly good, and "approve all of this
 * or none of it" pushes people toward approving all of it. Each run of edits is
 * now its own decision, and the header says exactly how many lines will be
 * written before you commit to anything.
 */

/** Lines shown either side of a change. Matches the hunk merge threshold. */
const CONTEXT = 3;

export function Review({ changes, onApprove, onApproveHunks, onReject, busy, t }: Props) {
  const [openPath, setOpenPath] = useState<string | null>(changes[0]?.path ?? null);
  /** Hunks the user has un-ticked, per file. Absent means "all ticked". */
  const [off, setOff] = useState<Map<string, Set<number>>>(new Map());
  const [focused, setFocused] = useState(0);
  const box = useRef<HTMLElement>(null);

  const ready = useGrammars();

  /**
   * Both sides of every file, parsed whole and cut into lines.
   *
   * Whole, because a diff row is one line and a line has no context of its own
   * — a method body is not a program. And both sides, because after a partial
   * accept `before` is what is now on disk while `after` is still the full
   * proposal, so a removed line and an added line are lines of two different
   * documents and cannot share one parse.
   */
  const diffs = useMemo(() => {
    const m = new Map<string, {
      rows: Row[]; list: Hunk[]; a: Span[][]; b: Span[][];
      parse: Check | null; badHunks: Set<number>;
    }>();
    for (const c of changes) {
      const rows = diffRows(c.before, c.after);
      const list = hunks(rows);
      // The same parse the highlighting above pays for, walked for error nodes
      // instead of tags. `null` until the grammars land, so the pane never
      // flashes "not checked" at a file it is about to check.
      const parse = ready ? checkParse(c.before, c.after, c.path) : null;
      m.set(c.path, {
        rows,
        list,
        a: ready ? highlightLines(c.before, c.path) : [],
        b: ready ? highlightLines(c.after, c.path) : [],
        parse,
        // CONTEXT, so a hunk is marked when the error is anywhere in the block
        // drawn under it rather than only on a line that changed.
        badHunks: parse ? hunksWithParseError(rows, list, parse.lines, CONTEXT) : new Set<number>(),
      });
    }
    return m;
  }, [changes, ready]);

  // A file that has just been written is gone from `changes`, so the selection
  // has to move rather than pointing at nothing.
  const open = changes.find((c) => c.path === openPath) ?? changes[0];
  useEffect(() => { setFocused(0); }, [open?.path]);

  if (!changes.length) return null;

  const { rows, list, a: beforeLines, b: afterLines, parse, badHunks } =
    diffs.get(open.path)
    ?? { rows: [], list: [], a: [], b: [], parse: null, badHunks: new Set<number>() };
  const skipped = off.get(open.path) ?? new Set<number>();
  const accepted = new Set(list.filter((h) => !skipped.has(h.index)).map((h) => h.index));

  const picked = list
    .filter((h) => accepted.has(h.index))
    .reduce((s, h) => ({ added: s.added + h.added, removed: s.removed + h.removed }), { added: 0, removed: 0 });
  const total = changes.reduce((acc, c) => {
    const d = diffs.get(c.path);
    const n = (d?.list ?? []).reduce((s, h) => ({ added: s.added + h.added, removed: s.removed + h.removed }), { added: 0, removed: 0 });
    return { added: acc.added + n.added, removed: acc.removed + n.removed };
  }, { added: 0, removed: 0 });

  const partial = accepted.size > 0 && accepted.size < list.length;

  function toggle(index: number) {
    setOff((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(open.path) ?? []);
      if (set.has(index)) set.delete(index); else set.add(index);
      next.set(open.path, set);
      return next;
    });
  }

  function writeFile() {
    if (!accepted.size) return;
    if (accepted.size === list.length) onApprove([open.path]);
    else onApproveHunks(open.path, buildPartial(rows, list, accepted));
    setOff((prev) => { const n = new Map(prev); n.delete(open.path); return n; });
  }

  /**
   * j/k/space/enter, but only while the pane has focus. Binding them globally
   * would make them unusable in the composer, which is where people spend most
   * of their time.
   */
  function onKey(e: React.KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setFocused((i) => Math.min(list.length - 1, i + 1)); }
    else if (k === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setFocused((i) => Math.max(0, i - 1)); }
    else if (e.key === ' ') { e.preventDefault(); if (list[focused]) toggle(list[focused].index); }
    else if (e.key === 'Enter') { e.preventDefault(); writeFile(); }
  }

  return (
    <section className="review" aria-label={t('Proposed changes')} tabIndex={-1} ref={box} onKeyDown={onKey}>
      <header className="rv-head">
        <div className="rv-title">
          <b>{changes.length === 1
            ? t('1 file proposed')
            : `${changes.length} ${t('files proposed')}`}</b>
          <span className="stat">
            <span className="add">+{total.added}</span>
            <span className="del">−{total.removed}</span>
          </span>
          <span className="note">{t('Nothing is written until you approve.')}</span>
        </div>
        <div className="rv-actions">
          <button className="reject" disabled={busy}
                  onClick={() => onReject(changes.map((c) => c.path))}>
            {t('Discard all')}
          </button>
          <button className="approve" disabled={busy}
                  onClick={() => onApprove(changes.map((c) => c.path))}>
            {t('Approve all')}
          </button>
        </div>
      </header>

      <div className="rv-body">
        <ul className="rv-files">
          {changes.map((c) => {
            const d = diffs.get(c.path);
            const n = (d?.list ?? []).reduce((s, h) => ({ added: s.added + h.added, removed: s.removed + h.removed }), { added: 0, removed: 0 });
            // Only the failure is marked in this column. "parses" and "not
            // checked" need each other to mean anything, and three words will
            // not fit beside a path and two counts in 250px — they are on the
            // bar, which is where clicking here takes you.
            return (
              <li key={c.path}>
                <button className={c.path === open.path ? 'on' : ''} onClick={() => setOpenPath(c.path)}>
                  <span className="fp">{c.path}</span>
                  {c.isNew && <span className="new">{t('new')}</span>}
                  {d?.parse?.verdict === 'broken' && (
                    <span className="fp-bad">{t('does not parse')}</span>
                  )}
                  <span className="mini">
                    <span className="add">+{n.added}</span><span className="del">−{n.removed}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="rv-diff">
          <div className="rv-diff-bar">
            <code title={open.path}>{open.path}</code>
            {parse && <ParseNote check={parse} partial={partial} t={t} />}
            <span className="rv-keys">
              <kbd>j</kbd><kbd>k</kbd> {t('move')} · <kbd>space</kbd> {t('toggle')} · <kbd>↵</kbd> {t('write')}
            </span>
            <div className="rv-one">
              <button className="reject" disabled={busy} onClick={() => onReject([open.path])}>{t('Discard')}</button>
              <button className="approve" disabled={busy || !accepted.size} onClick={writeFile}>
                {partial
                  ? `${t('Write')} ${accepted.size}/${list.length} · +${picked.added} −${picked.removed}`
                  : t('Approve')}
              </button>
            </div>
          </div>

          <div className="rv-hunks">
            {list.length === 0 && <p className="ft-empty">{t('No changes left in this file.')}</p>}
            {list.map((h, n) => {
              const on = accepted.has(h.index);
              // Context either side, clipped to the file and never overlapping
              // the next hunk, which the merge threshold already guarantees.
              const from = Math.max(0, h.from - CONTEXT);
              const to = Math.min(rows.length - 1, h.to + CONTEXT);
              return (
                <div key={h.index} className={`hunk ${on ? '' : 'skipped'} ${n === focused ? 'focus' : ''}`}>
                  <button className="hunk-bar" onClick={() => { setFocused(n); toggle(h.index); }}
                          aria-pressed={on}>
                    <span className={`hunk-tick ${on ? 'on' : ''}`}>
                      {on && <Icon name="check" size={12} />}
                    </span>
                    <span className="hunk-n">{t('Change')} {n + 1}</span>
                    {badHunks.has(h.index) && <span className="hunk-bad">{t('does not parse')}</span>}
                    <span className="mini"><span className="add">+{h.added}</span><span className="del">−{h.removed}</span></span>
                    {!on && <span className="hunk-skip">{t('not included')}</span>}
                  </button>
                  <pre>
                    <DiffRows rows={rows.slice(from, to + 1)} a={beforeLines} b={afterLines} />
                  </pre>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * What the parse says about the file being proposed.
 *
 * Two rules decide whether this helps or hurts, and both are wording rather
 * than code.
 *
 * It says "parses", never "correct". A clean parse is not a type check, a lint
 * or a review — it means the braces balance. A badge that reads like approval
 * is a badge that gets people to stop reading the diff underneath it, and then
 * the feature has cost more than everything it catches.
 *
 * And it is advisory in both directions. Nothing here touches Approve, Write or
 * Discard: they are the same buttons, enabled the same way, whatever this says.
 * A parse that could stop a write would make this a second authority over the
 * disk, and there is exactly one — the person reading the diff. A parse that
 * could *wave one through* would be worse.
 */
function ParseNote({ check, partial, t }: {
  check: Check; partial: boolean; t: (s: string) => string;
}) {
  const broken = check.verdict === 'broken';
  // A broken verdict always carries at least one line — see `Check` — so the
  // number is not conditional on anything the reader has to look for.
  const label = broken
    ? `${t('does not parse')} · ${t('line')} ${check.lines[0]}`
    : check.verdict === 'parses' ? t('parses') : t('not checked');

  const said = check.verdict === 'parses'
    ? t('The proposed file parses. This is not a type check.')
    : broken ? t('The parser reached this line and could not continue.')
    : why(check.reason, t);
  // The ticked subset is a different document from the one that was parsed, so
  // the claim has to be qualified rather than quietly left standing.
  const caveat = partial && check.verdict !== 'unchecked'
    ? ' ' + t('Only some changes are ticked, so this is not the file that will be written.')
    : '';

  // No modifier for "not checked": the neutral base is what it looks like, and
  // a class with no rule behind it is the orphaned selector this stylesheet has
  // been caught carrying before.
  const tone = broken ? ' bad' : check.verdict === 'parses' ? ' ok' : '';
  return (
    <span className={`rv-parse${tone}`} title={said + caveat}>{label}</span>
  );
}

/** Why nothing was checked. Every reason gets its own sentence: "not checked"
 *  on its own invites the reading that something went wrong, and most of these
 *  are ordinary. */
function why(reason: Reason, t: (s: string) => string): string {
  switch (reason) {
    case 'no-grammar':
      return t('No parser is available for this kind of file.');
    case 'no-signal':
      return t('The parser for this kind of file accepts almost anything, so a pass would mean nothing.');
    case 'too-large':
      return t('This file is too large to parse here.');
    case 'already-broken':
      return t('This file did not parse before the change either, so the parser cannot judge it.');
    default:
      return t('The parser did not finish.');
  }
}
