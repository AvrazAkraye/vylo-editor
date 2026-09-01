import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from './Icon';
import { explain } from './errors';
import { applyWrite } from './disk';
import { sha256Hex } from './hash';
import { add, parse, progress, remove, toggle, STARTER, type Step } from './todo';

/**
 * The project's to-do list, and the two things a step can be sent to.
 *
 * `TodoPanel`, not `Todo`, because `todo.ts` holds the parsing and a component
 * differing from it only in case resolves to the wrong file on a
 * case-insensitive filesystem. `SettingsPanel` and `TerminalPanel` sit beside
 * `settings.ts` and `terminals.ts` for the same reason.
 *
 * ## Why a command step goes through the approval dialog
 *
 * A prose step fills the composer and a person presses send. That is safe
 * because a message is not an action.
 *
 * A command step does **not** get typed into the terminal for somebody to press
 * Enter on, which is the obvious and tempting design. `VYLO.md` is explicit:
 * nothing carries text from the model into a terminal, and the bridge stays
 * one-way. The temptation is to argue that a to-do step is the human's own
 * string — they typed it — so running it is no different from typing it in the
 * shell.
 *
 * The app cannot know that. `.vylo/TODO.md` is a file in the repository: the
 * agent can write to it through the review gate, a teammate can push to it, and
 * it arrives with a clone. A step's provenance is a file, not a keystroke. So a
 * command step gets exactly the gate a command the model proposed gets — the
 * same dialog, the same string on screen, the same decision.
 *
 * That is not theatre, which is the objection the rule anticipates for the
 * memory editor and the terminal. There, the human is demonstrably the author.
 * Here they are not, and the difference is the whole reason this is safe.
 */

const FILE = '.vylo/TODO.md';

interface Props {
  root: string;
  t: (s: string) => string;
  /** Put a step in the composer for a person to read and send. */
  onToChat: (text: string) => void;
  /** Offer a command through the ordinary approval gate. */
  onToTerminal: (command: string) => void;
  onError: (message: string) => void;
  /** How many steps are unticked, for the rail's badge. */
  onLeft: (n: number) => void;
}

export function TodoPanel({ root, t, onToChat, onToTerminal, onError, onLeft }: Props) {
  const [text, setText] = useState('');
  const [sha, setSha] = useState('');
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState('');

  const load = useCallback(async () => {
    if (!root) return;
    try {
      const r = await invoke<{ text: string }>('read_for_editor', { root, path: FILE });
      setText(r.text);
      setSha(await sha256Hex(r.text));
    } catch {
      // No list yet is the ordinary case, not a failure: most projects have
      // never had one. The starter is offered rather than written, so opening
      // the panel does not put a file in somebody's repository.
      setText('');
      setSha('');
    }
    setReady(true);
  }, [root]);

  useEffect(() => { setReady(false); void load(); }, [load]);

  /**
   * Write the file back, guarded by the hash it was read at.
   *
   * `applyWrite` refuses when the file has moved since — which here means the
   * agent, an editor, or a colleague changed it while the panel was open. The
   * message says so and the list reloads, rather than one of the two edits
   * quietly winning.
   */
  async function save(next: string) {
    const before = text;
    setText(next);                       // optimistic: ticking must feel instant
    try {
      await applyWrite(root, FILE, next, sha || undefined);
      setSha(await sha256Hex(next));
    } catch (e) {
      setText(before);
      onError(explain(e, t('save the to-do list')));
      void load();
    }
  }

  const steps = parse(text);
  const { done, total } = progress(steps);

  // The rail badge counts what is left. Reported from here because this is the
  // only thing that has read the file, and through an effect rather than during
  // render so it is a state update on a settled value rather than mid-paint.
  useEffect(() => { onLeft(total - done); }, [total, done, onLeft]);

  if (!ready) return null;

  if (!total && !text.trim()) {
    return (
      <div className="todo">
        <p className="ft-empty">{t('No to-do list in this project yet.')}</p>
        <button className="ghost bordered" onClick={() => void save(STARTER)}>
          <Icon name="plus" size={13} />{t('Start one')}
        </button>
        <p className="ft-empty todo-where">{t('It is saved as .vylo/TODO.md, so it travels with the project.')}</p>
      </div>
    );
  }

  return (
    <div className="todo">
      <div className="todo-head">
        <span className="todo-count" aria-live="polite">
          {done} / {total}
        </span>
        <span className="todo-bar" aria-hidden="true">
          <i style={{ inlineSize: `${total ? Math.round((done / total) * 100) : 0}%` }} />
        </span>
      </div>

      <ul className="todo-list">
        {steps.map((s: Step) => (
          <li key={s.line} className={`todo-row ${s.done ? 'done' : ''} ${s.kind}`}>
            <button className="todo-box" onClick={() => void save(toggle(text, s.line))}
                    role="checkbox" aria-checked={s.done}
                    aria-label={`${s.done ? t('Done') : t('Not done')} — ${s.text}`}>
              {s.done && <Icon name="check" size={11} />}
            </button>

            <span className={`todo-text ${s.kind === 'command' ? 'mono' : ''}`} title={s.text}>
              {s.text}
            </span>

            {/* Two destinations, and they are not the same shape. Prose reaches
                the composer unsent; a command reaches the approval dialog. */}
            {s.kind === 'command' ? (
              <button className="todo-act" onClick={() => onToTerminal(s.text)}
                      title={t('Run this step — you will be asked to approve it')}
                      aria-label={t('Run this step — you will be asked to approve it')}>
                <Icon name="terminal" size={12} />
              </button>
            ) : (
              <button className="todo-act" onClick={() => onToChat(s.text)}
                      title={t('Put this step in the message box')}
                      aria-label={t('Put this step in the message box')}>
                <Icon name="chat" size={12} />
              </button>
            )}

            <button className="todo-x" onClick={() => void save(remove(text, s.line))}
                    title={t('Remove')} aria-label={`${t('Remove')} — ${s.text}`}>
              <Icon name="close" size={11} />
            </button>
          </li>
        ))}
      </ul>

      <form className="todo-add"
            onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { void save(add(text, draft)); setDraft(''); } }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
               placeholder={t('Add a step — wrap it in backticks for a command')}
               aria-label={t('Add a step — wrap it in backticks for a command')}
               spellCheck={false} />
      </form>
    </div>
  );
}

export default TodoPanel;
