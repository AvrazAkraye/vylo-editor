import { Fragment, type ReactNode } from 'react';

/**
 * A small markdown renderer for the agent's replies.
 *
 * Renders to React elements rather than a string of HTML. That is the whole
 * reason it is hand-written: model output is untrusted text, and the moment it
 * reaches innerHTML a reply containing a `<script>` tag becomes a problem. React
 * escapes text nodes by construction, so this cannot inject anything no matter
 * what comes back.
 *
 * Covers what a coding agent actually emits — fenced code, inline code, bold,
 * headings, bullets and numbered lists. Anything else falls through as plain
 * text, which is the correct failure: unrendered markdown is readable, a broken
 * parser is not.
 */

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // `code` first: bold markers inside a code span are literal, not formatting.
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<code key={`${keyBase}-c${i}`}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={`${keyBase}-b${i}`}>{m[2].slice(2, -2)}</strong>);
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        body.push(lines[i]);
        i++;
      }
      i++; // closing fence, or the end of the text if the model never closed it
      blocks.push(
        <pre className="md-code" key={key++}>
          {lang && <span className="md-lang">{lang}</span>}
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // heading
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(
        <div className={`md-h md-h${h[1].length}`} key={key++}>
          {inline(h[2], `h${key}`)}
        </div>,
      );
      i++;
      continue;
    }

    // list — bullets and numbers share a run
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const items: ReactNode[] = [];
      const numbered = /^\s*\d+\./.test(line);
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const item = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '');
        items.push(<li key={items.length}>{inline(item, `l${key}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(
        numbered ? <ol className="md-list" key={key++}>{items}</ol>
                 : <ul className="md-list" key={key++}>{items}</ul>,
      );
      continue;
    }

    // paragraph — consume until a blank line or the start of another block
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trimStart().startsWith('```') &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) &&
      !/^#{1,4}\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) {
      blocks.push(
        <p className="md-p" key={key++}>
          {para.join('\n').split('\n').map((l, n) => (
            <Fragment key={n}>{n > 0 && <br />}{inline(l, `p${key}-${n}`)}</Fragment>
          ))}
        </p>,
      );
      continue;
    }
    i++; // blank line
  }

  return <div className="md">{blocks}</div>;
}
