import { useState } from 'react';
import type { Line } from './store';
import { Icon } from './Icon';

/**
 * A run of tool calls, folded to one line.
 *
 * The agent's own reasoning is the thing worth reading; twelve lines of
 * `read_file(...)` between two paragraphs bury it. So consecutive tool activity
 * collapses to a summary that still says exactly what was touched — the point
 * is to make the transcript legible, never to hide what the agent did, and one
 * click puts every argument and result back on screen.
 *
 * Errors are deliberately not folded in: a failure is the one thing you should
 * never have to expand a section to notice.
 */

/** Consecutive tool/result lines, grouped; everything else passes through alone. */
export function groupLines<T extends Line>(lines: T[]): (T | T[])[] {
  const out: (T | T[])[] = [];
  for (const l of lines) {
    if (l.kind !== 'tool' && l.kind !== 'result') { out.push(l); continue; }
    const last = out[out.length - 1];
    if (Array.isArray(last)) last.push(l);
    else out.push([l]);
  }
  return out;
}

/** `read_file({"path":"a.ts"})` → `read_file` */
function toolName(text: string): string {
  const i = text.indexOf('(');
  const j = text.indexOf(' →');
  const cut = i > 0 ? i : j > 0 ? j : text.length;
  return text.slice(0, cut).trim();
}

interface Props {
  run: Line[];
  t: (s: string) => string;
}

export function ToolRun({ run, t }: Props) {
  const [open, setOpen] = useState(false);
  const calls = run.filter((l) => l.kind === 'tool');
  const failed = run.some((l) => l.kind === 'result' && / → error: /.test(l.text));

  // Distinct names in the order they first ran, so the summary reads as a
  // sequence of actions rather than a tally.
  const names: string[] = [];
  for (const c of calls) {
    const n = toolName(c.text);
    if (n && !names.includes(n)) names.push(n);
  }
  const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '');
  const n = calls.length;

  return (
    <div className={`toolrun ${open ? 'open' : ''}`}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="tr-caret"><Icon name="chevron" size={11} /></span>
        <span className="tr-n">{n === 1 ? t('1 step') : `${n} ${t('steps')}`}</span>
        <span className="tr-names">{shown}</span>
        {failed && <span className="tr-bad">!</span>}
      </button>
      {open && (
        <div className="tr-list">
          {run.map((l, i) => (
            <div key={i} className={`tr-item ${l.kind === 'result' && / → error: /.test(l.text) ? 'err' : ''}`}>
              {l.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
