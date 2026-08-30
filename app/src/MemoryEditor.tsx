import { useEffect, useState } from 'react';
import { applyWrite } from './disk';
import { MEMORY_FILE, readMemory, type Memory } from './memory';

const TEMPLATE = `# Project memory

Notes Vylo Editor carries into every chat in this project. Keep them short and
durable — conventions, commands that work here, decisions and why.

-
`;

interface Props {
  root: string;
  memory: Memory;
  onSaved: (m: Memory) => void;
  t: (s: string) => string;
}

/**
 * Direct authoring of the memory file.
 *
 * Saves straight to disk rather than through the staging gate, and that is the
 * point rather than an oversight: approval exists so a *model* cannot change
 * files unseen. Asking someone to review and approve their own typing would be
 * theatre. The agent's `remember` still stages, because those edits are
 * model-authored.
 */
export function MemoryEditor({ root, memory, onSaved, t }: Props) {
  const file = memory.file ?? MEMORY_FILE;
  const [text, setText] = useState(memory.text || TEMPLATE);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const dirty = text !== (memory.text || TEMPLATE);

  useEffect(() => { setText(memory.text || TEMPLATE); setNote(null); }, [memory.file, memory.text]);

  async function save() {
    setSaving(true);
    setNote(null);
    try {
      // No `expectSha256`: the person typing is the person whose text is on
      // screen. The write also acknowledges the file, so saving it here is
      // what makes it memory.
      await applyWrite(root, file, text);
      onSaved(await readMemory(root));
      setNote(t('Saved. It applies from your next message.'));
    } catch (e) {
      setNote(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mem">
      <div className="mem-bar">
        <code>{file}</code>
        <span className="mem-hint">
          {memory.file ? t('Carried into every chat in this project.') : t('Not created yet.')}
        </span>
        <div className="mem-btns">
          {note && <span className="mem-note">{note}</span>}
          <button className="approve" onClick={() => void save()} disabled={saving || !dirty}>
            {memory.file ? t('Save') : t('Create')}
          </button>
        </div>
      </div>
      <textarea
        className="mem-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        placeholder={TEMPLATE}
      />
    </div>
  );
}
