import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from './Icon';
import * as ask from './ask';
import { explain } from './errors';
import { applyWrite } from './disk';
import { sha256Hex } from './hash';
import { watch } from './docs';
import { STARTER, add, filter, parse, remove, type Prompt } from './prompts';

/**
 * Prompts and commands worth keeping.
 *
 * The two destinations are the whole design, and they are not the same shape.
 * A prose prompt fills the message box and stops — a message is not an action,
 * and the person presses send. A command prompt goes to the approval dialog,
 * the same one `run_command` uses.
 *
 * The reason a command from this file needs the gate is the reason a to-do step
 * does: `.vylo/PROMPTS.md` is a file in the repository. The agent can write to
 * it through the review gate, a teammate can push to it, and it arrives with a
 * clone. Its provenance is a file, not a keystroke, and the app cannot tell the
 * difference between a command you saved last week and one that arrived in a
 * merge this morning.
 */

const FILE = '.vylo/PROMPTS.md';

interface Props {
  root: string;
  t: (s: string) => string;
  /** Put a prompt in the message box for a person to read and send. */
  onToChat: (text: string) => void;
  /** Offer a command through the ordinary approval gate. */
  onToTerminal: (command: string) => void;
  onError: (message: string) => void;
}

export function PromptsPanel({ root, t, onToChat, onToTerminal, onError }: Props) {
  const [text, setText] = useState('');
  const [sha, setSha] = useState('');
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!root) return;
    try {
      const r = await invoke<{ text: string }>('read_for_editor', { root, path: FILE });
      setText(r.text);
      setSha(await sha256Hex(r.text));
    } catch {
      // No file yet is the ordinary case. The starter is offered rather than
      // written, so opening the panel does not put a file in a repository.
      setText('');
      setSha('');
    }
    setReady(true);
  }, [root]);

  useEffect(() => { setReady(false); void load(); }, [load]);

  // Somebody else wrote the file — the agent, through the review gate, or a
  // second copy of this panel. See docs.ts.
  useEffect(() => watch(FILE, (next) => {
    setText(next);
    void sha256Hex(next).then(setSha);
  }), []);

  async function save(next: string) {
    const before = text;
    setText(next);
    try {
      await applyWrite(root, FILE, next, sha || undefined);
      setSha(await sha256Hex(next));
    } catch (e) {
      setText(before);
      onError(explain(e, t('save the prompts')));
      void load();
    }
  }

  if (!ready) return null;

  const all = parse(text);

  if (!all.length && !text.trim()) {
    return (
      <div className="todo">
        <p className="ft-empty">{t('No saved prompts in this project yet.')}</p>
        <button className="ghost bordered" onClick={() => void save(STARTER)}>
          <Icon name="plus" size={13} />{t('Start one')}
        </button>
        <p className="ft-empty todo-where">{t('It is saved as .vylo/PROMPTS.md, so it travels with the project.')}</p>
      </div>
    );
  }

  const rows = filter(all, query);

  async function addOne() {
    const title = await ask.text({ title: t('Name it'), value: '', confirmLabel: t('Next') });
    if (!title) return;
    const body = await ask.text({
      title: t('What should it say?'),
      value: '',
      placeholder: t('Wrap it in backticks for a command'),
      confirmLabel: t('Save'),
    });
    if (body) void save(add(text, title, body));
  }

  return (
    <div className="todo pr">
      <div className="ol-head">
        <span className="tsl-find">
          <Icon name="search" size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder={t('Filter…')} aria-label={t('Filter…')} spellCheck={false} />
        </span>
        <button className="tsl-add" onClick={() => void addOne()}
                title={t('Save a prompt')} aria-label={t('Save a prompt')}>
          <Icon name="plus" size={15} />
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="ft-empty">{t('Nothing matches that.')}</p>
      ) : (
        <ul className="pr-list">
          {rows.map((p: Prompt) => (
            <li key={p.line} className={`pr-row ${p.kind}`}>
              <button className="pr-hit"
                      onClick={() => (p.kind === 'command' ? onToTerminal(p.body) : onToChat(p.body))}
                      title={p.kind === 'command'
                        ? t('Run this — you will be asked to approve it')
                        : t('Put this in the message box')}>
                <span className="pr-what">
                  <b>{p.title}</b>
                  <span className={p.kind === 'command' ? 'mono' : ''}>{p.body}</span>
                </span>
                <Icon name={p.kind === 'command' ? 'terminal' : 'chat'} size={13} />
              </button>
              <button className="todo-x" onClick={() => void (async () => {
                if (await ask.confirm({
                  title: t('Remove this prompt?'), body: p.title,
                  confirmLabel: t('Remove'), danger: true,
                })) void save(remove(text, p.line));
              })()} title={t('Remove')} aria-label={`${t('Remove')} — ${p.title}`}>
                <Icon name="close" size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default PromptsPanel;
