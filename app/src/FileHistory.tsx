import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { countChanges, diffLines, type Row } from './pending';
import { DiffRows } from './DiffRows';
import { highlightLines } from './highlight';
import { useGrammars } from './useGrammars';
import { explain } from './errors';
import { ago } from './store';
import { Icon } from './Icon';

/**
 * The versions of one file, and a way back to one of them.
 *
 * Checkpoints undo what the *agent* wrote and drafts recover what was never
 * saved. This is the third case and the commonest one: a person saved over
 * their own work and wants it back. The Rust side keeps a copy of what every
 * write replaced; this is the only place a person can see them.
 *
 * ## Why the diff runs backwards
 *
 * The comparison shown is `now → the chosen version`, not the other way round,
 * so a `+` line is something restoring would *bring back* and a `−` line is
 * something it would take away. The panel exists to answer "what will this
 * button do", and a diff read in the other direction answers a question nobody
 * asked.
 *
 * ## Why unsaved work blocks the button
 *
 * Restoring writes the file, and the open editor then reloads from disk —
 * which would discard whatever is in the buffer. Saving first is not a
 * consolation prize: the save itself records a version, so the work being
 * protected lands in this same list and nothing is lost either way.
 *
 * ## Why forgetting is part of the feature
 *
 * A store that keeps a copy of every version of every file the app writes will
 * eventually hold a `.env`, or a key somebody pasted into a config file and
 * then deleted — and deleting it from the project does not delete it from
 * here. The caps bound the store; they do not let a person say *not that one*.
 * The clipboard history has that button for the same reason, and this is the
 * larger surface of the two: whole files rather than pastes.
 */

interface Version {
  seq: number;
  /** Unix seconds, as Rust records them. */
  at: number;
  bytes: number;
}

interface Props {
  root: string;
  path: string;
  /** True when the open buffer holds edits that are not on disk. */
  dirty: boolean;
  onClose: () => void;
  /** A version was written; the open editor has to reload from disk. */
  onRestored: (path: string) => void;
  t: (s: string) => string;
}

/** Enough precision to tell a truncated version from a whole one at a glance. */
const size = (n: number) => (n < 1024 ? `${n} B` : `${Math.round(n / 102.4) / 10} kB`);

export function FileHistory({ root, path, dirty, onClose, onRestored, t }: Props) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [text, setText] = useState<string | null>(null);
  /** What is on disk now. `null` while loading, `false` when it is too large. */
  const [current, setCurrent] = useState<string | false | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Send focus back where it came from, the way the palettes do: closing an
  // overlay and dropping the caret at the top of the document is the difference
  // between a keyboard user continuing and starting again.
  const came = useRef<Element | null>(null);
  useEffect(() => {
    came.current = document.activeElement;
    return () => { (came.current as HTMLElement | null)?.focus?.(); };
  }, []);

  useEffect(() => {
    let gone = false;
    void (async () => {
      try {
        const [list, file] = await Promise.all([
          invoke<Version[]>('history_list', { root, path }),
          invoke<{ text: string; truncated: boolean }>('read_for_editor', { root, path }),
        ]);
        if (gone) return;
        setVersions(list);
        setCurrent(file.truncated ? false : file.text);
        setChosen(list[0]?.seq ?? null);
      } catch (e) {
        if (!gone) { setVersions([]); setErr(explain(e, t('read this file’s history'))); }
      }
    })();
    return () => { gone = true; };
    // `t` is deliberately not a dependency. It is rebuilt on every App render —
    // a streaming turn, a dictation result, `busy` flipping — so depending on
    // it would re-run this several times a second while a turn is going, and
    // each run resets `chosen` to the newest version under whoever is reading
    // one. It is used here only for an error string, where a translator one
    // render old says exactly the same thing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, path]);

  // Fetched per selection rather than all at once: a file's history can be
  // dozens of versions of a large file, and the list is drawn from names alone
  // precisely so that opening this costs one read.
  useEffect(() => {
    if (chosen === null) return;
    let gone = false;
    setText(null);
    void invoke<string>('history_read', { root, path, seq: chosen })
      .then((v) => { if (!gone) setText(v); })
      .catch((e) => { if (!gone) setErr(explain(e, t('read that version'))); });
    return () => { gone = true; };
    // Not `t`, for the reason above: re-fetching the version being read on
    // every App render is the same bug one step along.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, path, chosen]);

  const rows: Row[] = useMemo(
    () => (typeof current === 'string' && text !== null ? diffLines(current, text) : []),
    [current, text],
  );
  const { added, removed } = countChanges(rows);
  const same = text !== null && text === current;

  // Both sides, parsed whole and cut into lines — the same job the review pane
  // does, for the same reason: a diff row is one line, and a line parsed on its
  // own has no context. Here the two sides are always different files, since
  // one is what is on disk and the other a version from before.
  const ready = useGrammars();
  const disk = useMemo(
    () => (ready && typeof current === 'string' ? highlightLines(current, path) : []),
    [ready, current, path],
  );
  const version = useMemo(
    () => (ready && text !== null ? highlightLines(text, path) : []),
    [ready, text, path],
  );

  function move(by: number) {
    if (!versions?.length) return;
    const at = versions.findIndex((v) => v.seq === chosen);
    setChosen(versions[Math.min(versions.length - 1, Math.max(0, at + by))].seq);
  }

  function key(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
  }

  /**
   * Throw away what is kept, for this file or for the whole folder.
   *
   * The panel stays open on an empty list rather than closing: the empty state
   * already says there is nothing kept, which is the confirmation that the
   * button did what it said.
   */
  async function forget(all: boolean) {
    const ok = window.confirm(
      (all
        ? t('Forget every kept version of every file in this folder?')
        : t('Forget every kept version of this file?'))
      + `\n\n${all ? root : path}\n\n`
      + t('This cannot be undone. The files themselves are not touched.'),
    );
    if (!ok) return;
    setBusy(true);
    try {
      if (all) await invoke('history_forget_all', { root });
      else await invoke('history_forget', { root, path });
      setVersions([]);
      setChosen(null);
      setText(null);
      setErr('');
    } catch (e) {
      setErr(explain(e, all ? t('forget this folder’s history') : t('forget this file’s history')));
    }
    setBusy(false);
  }

  async function restore() {
    if (chosen === null) return;
    setBusy(true);
    try {
      await invoke<string>('history_restore', { root, path, seq: chosen });
      onRestored(path);
      onClose();
    } catch (e) {
      setErr(explain(e, t('put that version back')));
      setBusy(false);
    }
  }

  return (
    <div className="pal-back" onMouseDown={onClose}>
      <div className="pal fh" onMouseDown={(e) => e.stopPropagation()} onKeyDown={key}
           role="dialog" aria-modal="true" aria-label={t('File history')}>
        <div className="fh-bar">
          <Icon name="restore" size={13} />
          <code>{path}</code>
          <span className="fh-sp" />
          {/* Where the clipboard picker puts its Clear, and for the same
              reason. A convenience feature that quietly becomes a credential
              store is not worth having. */}
          <button className="fh-forget" disabled={busy || !versions?.length}
                  onClick={() => void forget(false)}>
            {t('Forget this file’s history')}
          </button>
          <button className="fh-forget" disabled={busy} onClick={() => void forget(true)}>
            {t('Forget everything in this folder')}
          </button>
          <button className="tab-x" onClick={onClose} aria-label={t('Close')}>
            <Icon name="close" size={12} />
          </button>
        </div>

        {err && <p className="pal-none pal-err">{err}</p>}

        <div className="fh-body">
          <div className="fh-list" role="listbox" aria-label={t('Versions')} tabIndex={0}>
            {versions === null && <p className="pal-none">{t('Looking…')}</p>}
            {versions?.length === 0 && !err && (
              <p className="pal-none">
                {t('No earlier versions yet. One is kept every time this app writes the file.')}
              </p>
            )}
            {versions?.map((v) => (
              <button key={v.seq} role="option" aria-selected={v.seq === chosen}
                      className={`pal-row fh-row ${v.seq === chosen ? 'on' : ''}`}
                      onClick={() => setChosen(v.seq)}>
                <span className="pal-name">{ago(v.at * 1000)}</span>
                <span className="fh-sp" />
                <span className="pal-dir">{size(v.bytes)}</span>
              </button>
            ))}
          </div>

          <div className="fh-view">
            <div className="fh-head">
              {chosen === null ? <span /> : current === false ? (
                <span>{t('This file is too large to compare, so the version is shown whole.')}</span>
              ) : same ? (
                <span>{t('Identical to the file on disk.')}</span>
              ) : (
                <span className="fh-counts">
                  <span className="mini">
                    <span className="add">+{added}</span><span className="del">−{removed}</span>
                  </span>
                  {t('if this version is put back')}
                </span>
              )}
              <span className="fh-sp" />
              {/* Named so it is clear this writes the file, rather than the
                  ambiguous "Restore" that could equally mean the buffer. */}
              <button className="approve" disabled={busy || dirty || chosen === null || same}
                      onClick={() => void restore()}>
                {t('Put this version back')}
              </button>
            </div>

            {dirty && (
              <p className="fh-note">
                {t('Save or undo your unsaved changes first — putting a version back rewrites the file on disk.')}
              </p>
            )}

            <div className="fh-scroll">
              {text === null && chosen !== null && <p className="pal-none">{t('Looking…')}</p>}
              {text !== null && current === false && <pre className="fh-pre fh-plain">{text}</pre>}
              {text !== null && current !== false && (
                <pre className="fh-pre">
                  <DiffRows rows={rows} a={disk} b={version} />
                </pre>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
