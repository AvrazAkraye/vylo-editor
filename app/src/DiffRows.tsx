import { Fragment } from 'react';
import type { Row } from './pending';
import type { Span } from './highlight';

/**
 * The rows of a diff, coloured.
 *
 * One component rather than one per surface. The review pane and the file
 * history panel both show "here is what will be written over what you have",
 * and the second of them started as a copy of the first's markup with the
 * highlighting left out — so the newest place in the app where a person reads
 * code to decide whether to overwrite their file was the one place it was grey
 * again. Moving it is the rule this repo already wrote down after `useGrammars`
 * went the same way: when a second surface wants something, move it rather than
 * copying it.
 *
 * Both callers wrap this in their own `<pre>` and pass whatever slice of the
 * diff they are drawing; `.row`, `.ln`, `.mk`, `.tx`, `.add` and `.del` are
 * global styles, which is why the two panels can look identical without one of
 * them owning the other's CSS.
 */
export function DiffRows({ rows, a, b }: { rows: Row[]; a: Span[][]; b: Span[][] }) {
  return (
    <>
      {rows.map((r, i) => (
        <div key={i} className={`row ${r.kind === '+' ? 'add' : r.kind === '-' ? 'del' : ''}`}>
          <span className="ln">{r.a ?? ''}</span>
          <span className="ln">{r.b ?? ''}</span>
          <span className="mk">{r.kind === ' ' ? ' ' : r.kind}</span>
          <span className="tx"><Code row={r} a={a} b={b} /></span>
        </div>
      ))}
    </>
  );
}

/**
 * One diff row's text, coloured.
 *
 * A removed line exists only in `before` and an added line only in `after`, so
 * each takes its spans from its own side. An unchanged line is in both and
 * takes the *after* side, which is the file that will exist if this is
 * approved.
 *
 * Falls back to the row's own text whenever the parse is missing — the
 * grammars have not loaded, the language has none, the file was too large, or
 * the row is one of `diffLines`' `⋯` markers, which stands for lines rather
 * than being one. The text is what matters; the colour is not.
 */
function Code({ row, a, b }: { row: Row; a: Span[][]; b: Span[][] }) {
  const from = row.kind === '-' ? a : b;
  const n = row.kind === '-' ? row.a : (row.b ?? row.a);
  const spans = n ? from[n - 1] : undefined;
  if (!spans || !spans.length) return <>{row.text || ' '}</>;
  return (
    <>
      {spans.map((s, i) => (s.cls
        ? <span key={i} className={s.cls}>{s.text}</span>
        : <Fragment key={i}>{s.text}</Fragment>))}
    </>
  );
}
