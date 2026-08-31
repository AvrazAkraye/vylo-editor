import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { Icon } from './Icon';
import { explain } from './errors';
import {
  ago, cleanTitle, exportFileName, exportMarkdown, renameChat, searchChats, type Chat,
} from './store';

/**
 * The chat list, as something you can keep rather than something that piles up.
 *
 * A thread arrives with a name the app invented from its opening question, and
 * until now that was the end of it: no way to correct the name, nothing to do
 * with an old one but open it, and no way to find the one where the interesting
 * thing happened. But this list is already the record of everything the agent
 * did to a project — every question, every reply, every file it wrote and every
 * command it ran — and that is worth being able to search and to keep.
 *
 * ## Where the writing happens
 *
 * Export is the only thing here that touches a disk, and it is a human action
 * from beginning to end: a person presses the button on a conversation they
 * have been reading, and the OS save panel decides where the file goes. The
 * command behind it (`export_write`) is absent from the tool schema like every
 * other command that writes, so nothing the model produces can reach it or
 * choose where it writes. What lands is a markdown transcript of what was
 * already on screen.
 *
 * ## Why rename is a prompt and not a field in the row
 *
 * Same reason as the explorer's rename, and the same call: the sidebar row is
 * narrow, an inline input in it has to fight the row's own click target for
 * focus, and `window.prompt` is already how this app renames things. The
 * generated title is the starting value, because a rename is usually an edit of
 * what is there rather than a fresh thought.
 *
 * ## Why delete asks
 *
 * There is no undo. Deleting a chat is the one destructive thing in this panel
 * and the confirmation names the chat, so the answer to "which one is about to
 * go" is on screen rather than in the reader's memory of which row they were
 * hovering.
 */

interface Props {
  chats: Chat[];
  /** The thread on screen, so its row can say so. */
  current: string;
  onOpen: (c: Chat) => void;
  /** Deleting is the parent's, because it also decides what to open next. */
  onDelete: (id: string) => void;
  /** A rename landed in the store; the parent re-reads it. */
  onRenamed: () => void;
  t: (s: string) => string;
}

export function Chats({ chats, current, onOpen, onDelete, onRenamed, t }: Props) {
  const [query, setQuery] = useState('');
  const [err, setErr] = useState('');

  // Rebuilt only when the query or the list changes. Every line of every chat
  // is a candidate, so doing this on each render of a streaming turn would be
  // the whole store scanned several times a second.
  const hits = useMemo(() => searchChats(query, chats), [query, chats]);

  function rename(c: Chat) {
    const typed = window.prompt(t('Rename this chat'), c.title);
    // Cancelled, or emptied. An empty name is refused rather than accepted:
    // the rename overwrites the generated title and nothing can recover it, so
    // a chat called nothing would be unfindable in a list of chats.
    if (typed === null || !cleanTitle(typed)) return;
    if (renameChat(c.id, typed)) onRenamed();
  }

  function remove(c: Chat) {
    const ok = window.confirm(
      `${t('Delete this chat permanently?')}\n\n${c.title}\n\n`
      + t('The conversation and what it recorded will be gone. The files it changed are not touched.'),
    );
    if (ok) onDelete(c.id);
  }

  async function exportChat(c: Chat) {
    setErr('');
    try {
      const path = await save({
        title: t('Export this conversation'),
        defaultPath: exportFileName(c),
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      // Cancelling the save panel is an answer, not a failure.
      if (!path) return;
      await invoke('export_write', { path, text: exportMarkdown(c) });
    } catch (e) {
      setErr(explain(e, t('export this conversation')));
    }
  }

  return (
    <>
      {chats.length > 0 && (
        <div className="ch-find">
          <Icon name="search" size={12} />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder={t('Search chats')}
                 aria-label={t('Search chats and what was said in them')} />
          {query && (
            <button className="ft-act" onClick={() => setQuery('')}
                    title={t('Clear the search')} aria-label={t('Clear the search')}>
              <Icon name="close" size={11} />
            </button>
          )}
        </div>
      )}

      {err && <p className="ft-empty ch-err">{err}</p>}

      {hits.length === 0 && (
        <p className="ft-empty">
          {chats.length === 0 ? t('No saved conversations.') : t('No chat matches that.')}
        </p>
      )}

      {hits.map(({ chat: c, snippet }) => (
        <div key={c.id} className={`ft-row chat-row ${c.id === current ? 'on' : ''}`}>
          <button className="chat-open" onClick={() => onOpen(c)} title={c.title}>
            <span className="ft-icon"><Icon name="chat" size={13} /></span>
            <span className="ch-text">
              <span className="ft-name">{c.title}</span>
              {/* Why this chat came back, when its name gives no clue. */}
              {snippet && <span className="ch-snip" title={snippet}>{snippet}</span>}
            </span>
            <span className="rc-meta">{ago(c.updatedAt, t)}</span>
          </button>
          <span className="ft-acts">
            <button className="ft-act" onClick={() => rename(c)}
                    title={`${t('Rename this chat')} — ${c.title}`}
                    aria-label={`${t('Rename this chat')} — ${c.title}`}>
              <Icon name="pencil" size={11} />
            </button>
            <button className="ft-act" onClick={() => void exportChat(c)}
                    title={`${t('Export as Markdown')} — ${c.title}`}
                    aria-label={`${t('Export as Markdown')} — ${c.title}`}>
              <Icon name="file" size={11} />
            </button>
          </span>
          <button className="chat-x" onClick={() => remove(c)}
                  title={`${t('Delete this chat')} — ${c.title}`}
                  aria-label={`${t('Delete this chat')} — ${c.title}`}>
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </>
  );
}
