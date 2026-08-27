import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

/**
 * Read-only file viewer.
 *
 * Deliberately not an editor. Editing here would be a second, silent way for
 * files to change — one that bypasses the diff-and-approve gate the whole
 * design rests on. Files are changed by asking the agent and approving the
 * result; this exists so you can read what it is talking about.
 */
export function Viewer({ root, path }: { root: string; path: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    invoke<string>('read_file', { root, path })
      .then((t) => { if (!cancelled) setText(t); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [root, path]);

  if (error) return <div className="vw-msg vw-err">{error}</div>;
  if (text === null) return <div className="vw-msg">Reading…</div>;

  const lines = text.split('\n');
  return (
    <div className="vw">
      <pre>
        {lines.map((l, i) => (
          <div className="vw-line" key={i}>
            <span className="vw-ln">{i + 1}</span>
            <span className="vw-tx">{l || ' '}</span>
          </div>
        ))}
      </pre>
      <div className="vw-foot">
        {lines.length} lines · {new Blob([text]).size.toLocaleString()} bytes
      </div>
    </div>
  );
}
