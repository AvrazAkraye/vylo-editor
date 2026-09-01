import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from './Icon';
import { explain } from './errors';
import { applyWrite } from './disk';
import { sha256Hex } from './hash';
import * as ask from './ask';
import { TodoTask, STATE_CLASS, STATE_WORD, PRIORITY_WORD, type Acts } from './TodoTask';
import {
  add, duration, flatten, plan, remove, setDue, setEstimate, setPriority,
  setProgress, setStatus, summarise, toggle, toggleTag, edit,
  STARTER, type Rolled, type Status,
} from './todo';
import {
  columns, search as run, sections, sortBy, tagsIn, activeFiles,
  type Sort,
} from './todoview';

/**
 * The project's to-do list: a plan, not a checklist.
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
 *
 * ## Three views, and why not seven
 *
 * Focus groups by what to do next, List is the file in its own order, and Board
 * is the statuses in columns. A calendar and a timeline were left out rather
 * than faked: both need real dates on most tasks to say anything, and a
 * timeline drawn from two estimates and six blanks is a picture of nothing
 * that looks authoritative. When lists here routinely carry dates, they will be
 * worth building.
 */

const FILE = '.vylo/TODO.md';

type View = 'focus' | 'list' | 'board';

interface Props {
  root: string;
  t: (s: string) => string;
  /** Put a step in the composer for a person to read and send. */
  onToChat: (text: string) => void;
  /** Offer a command through the ordinary approval gate. */
  onToTerminal: (command: string) => void;
  /** Open one of a task's files in the editor. */
  onOpenFile: (path: string) => void;
  onError: (message: string) => void;
  /** How many steps are unticked, for the rail's badge. */
  onLeft: (n: number) => void;
}

export function TodoPanel({ root, t, onToChat, onToTerminal, onOpenFile, onError, onLeft }: Props) {
  const [text, setText] = useState('');
  const [sha, setSha] = useState('');
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState('');
  const [view, setView] = useState<View>('focus');
  const [sort, setSort] = useState<Sort>('file');
  const [query, setQuery] = useState('');

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
  const save = useCallback(async (next: string) => {
    let before = '';
    setText((now) => { before = now; return next; });   // optimistic: ticking must feel instant
    try {
      await applyWrite(root, FILE, next, sha || undefined);
      setSha(await sha256Hex(next));
    } catch (e) {
      setText(before);
      onError(explain(e, t('save the to-do list')));
      void load();
    }
  }, [root, sha, onError, t, load]);

  const tasks = useMemo(() => plan(text), [text]);
  const all = useMemo(() => flatten(tasks), [tasks]);
  const sum = useMemo(() => summarise(tasks), [tasks]);
  const tags = useMemo(() => tagsIn(tasks), [tasks]);
  const working = useMemo(() => activeFiles(tasks), [tasks]);

  // The rail badge counts what is left. Reported from here because this is the
  // only thing that has read the file, and through an effect rather than during
  // render so it is a state update on a settled value rather than mid-paint.
  useEffect(() => { onLeft(sum.total - sum.done); }, [sum.total, sum.done, onLeft]);

  /**
   * Every action, in one object.
   *
   * Each one is `save(f(text, line, …))` — a pure change to the file text,
   * written back through the guarded save. Nothing here holds state of its own,
   * so the file is always the only thing that knows anything.
   */
  const acts: Acts = useMemo(() => ({
    toggle: (line) => void save(toggle(text, line)),
    status: (line, s: Status) => void save(setStatus(text, line, s)),
    priority: (line, p) => void save(setPriority(text, line, p)),
    progress: (line, n) => void save(setProgress(text, line, n)),
    estimate: (line, m) => void save(setEstimate(text, line, m)),
    due: (line, d) => void save(setDue(text, line, d)),
    tag: (line, tag) => void save(toggleTag(text, line, tag)),
    rename: (line, title) => void save(edit(text, line, title)),
    remove: (line) => void save(remove(text, line)),
    addUnder: (line, title) => void save(add(text, title, line)),
    toChat: onToChat,
    toTerminal: onToTerminal,
    openFile: onOpenFile,
  }), [text, save, onToChat, onToTerminal, onOpenFile]);

  if (!ready) return null;

  if (!all.length && !text.trim()) {
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

  const found = query.trim() ? run(tasks, query) : null;

  const card = (task: Rolled, nested = true, depth = 0) => (
    <TodoTask key={task.line} task={task} acts={acts} t={t} nested={nested} depth={depth} />
  );

  return (
    <div className="todo">
      {/* ── Overview ───────────────────────────────────────────────────────
          Six figures, and every one is derived from the file rather than
          remembered — so none of them can be stale, and none of them needs a
          place to be stored. */}
      <div className="tv-head">
        <div className="tv-top">
          <span className={`tv-state ${STATE_CLASS[sum.status]}`}>
            <i aria-hidden="true" />{t(STATE_WORD[sum.status])}
          </span>
          <span className="tv-pct" aria-live="polite">{sum.percent}%</span>
        </div>

        <span className="tv-bar" aria-label={`${sum.percent}%`}>
          <i className={STATE_CLASS[sum.status]} style={{ inlineSize: `${sum.percent}%` }} />
        </span>

        <dl className="tv-facts">
          <div><dt>{t('Done')}</dt><dd>{sum.done} / {sum.total}</dd></div>
          {sum.left > 0 && <div><dt>{t('Remaining')}</dt><dd>{duration(sum.left)}</dd></div>}
          {sum.priority && (
            <div><dt>{t('Priority')}</dt>
              <dd className={`pr-${sum.priority}`}>{t(PRIORITY_WORD[sum.priority])}</dd></div>
          )}
          {sum.phase && <div><dt>{t('Phase')}</dt><dd title={sum.phase}>{sum.phase}</dd></div>}
          {sum.blocked > 0 && (
            <div><dt>{t('Blocked')}</dt><dd className="st-blocked">{sum.blocked}</dd></div>
          )}
        </dl>

        {/* Which files the work in flight touches. Real, because it comes from
            the `+` tokens on the tasks that are actually moving. */}
        {working.length > 0 && (
          <p className="tv-files">
            <Icon name="file" size={11} />
            {working.slice(0, 3).map((f) => (
              <button key={f} className="tk-file" onClick={() => onOpenFile(f)}>{f}</button>
            ))}
            {working.length > 3 && <span className="tk-more-n">+{working.length - 3}</span>}
          </p>
        )}
      </div>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="tv-bar-row">
        <div className="tv-views" role="tablist" aria-label={t('View')}>
          {([['focus', 'star', 'Focus'], ['list', 'list', 'List'], ['board', 'board', 'Board']] as const)
            .map(([k, icon, label]) => (
              <button key={k} role="tab" aria-selected={view === k}
                      className={view === k ? 'on' : ''} onClick={() => setView(k)}
                      title={t(label)}>
                <Icon name={icon} size={13} />{t(label)}
              </button>
            ))}
        </div>

        {/* Planning is a message, not an action. This fills the composer and
            stops: the agent answers with a staged edit to the same file, which
            is read and approved like every other change it proposes. Nothing
            about the plan is a path a model can write down on its own. */}
        <button className="ghost tv-plan" onClick={() => void (async () => {
          const what = await ask.text({
            title: t('What should be planned?'),
            value: '',
            placeholder: t('Add authentication to the app'),
            confirmLabel: t('Ask'),
          });
          if (what) onToChat(`${t('Break this into tasks in .vylo/TODO.md, with estimates and dependencies:')} ${what}`);
        })()} title={t('Ask the agent to plan this')}>
          <Icon name="sparkle" size={13} />{t('Plan')}
        </button>

        <label className="tv-find">
          <Icon name="search" size={12} />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder={t('Search — try #bug or !high or is:open')}
                 aria-label={t('Search — try #bug or !high or is:open')} spellCheck={false} />
          {query && (
            <button onClick={() => setQuery('')} aria-label={t('Clear')}><Icon name="close" size={11} /></button>
          )}
        </label>

        <select className="tv-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}
                aria-label={t('Sort')}>
          <option value="file">{t('In file order')}</option>
          <option value="priority">{t('By priority')}</option>
          <option value="due">{t('By due date')}</option>
          <option value="progress">{t('By progress')}</option>
        </select>
      </div>

      {tags.length > 0 && (
        <div className="tv-tags">
          {tags.slice(0, 12).map(({ tag, n }) => {
            const on = query.toLowerCase().includes(`#${tag}`);
            return (
              <button key={tag} className={`tk-tag ${on ? 'on' : ''}`} aria-pressed={on}
                      onClick={() => setQuery(on
                        ? query.replace(new RegExp(`#${tag}\\b`, 'gi'), '').trim()
                        : `${query} #${tag}`.trim())}>
                #{tag}<em>{n}</em>
              </button>
            );
          })}
        </div>
      )}

      {/* ── The list ─────────────────────────────────────────────────────── */}
      <div className="tv-body">
        {found ? (
          found.length ? (
            <ul className="todo-list">{sortBy(found, sort).map((x) => card(x, false))}</ul>
          ) : (
            <p className="ft-empty">{t('Nothing matches that.')}</p>
          )
        ) : view === 'board' ? (
          <div className="tv-board">
            {columns(all).map((c) => (
              <section key={c.key} className={`tv-col ${STATE_CLASS[c.key]}`}>
                <h3><i aria-hidden="true" />{t(c.title)}<em>{c.tasks.length}</em></h3>
                <ul className="todo-list">
                  {c.tasks.length
                    ? sortBy(c.tasks, sort).map((x) => card(x, false))
                    : <li className="tv-none">{t('Nothing here.')}</li>}
                </ul>
              </section>
            ))}
          </div>
        ) : view === 'focus' ? (
          <>
            {sections(all).map((s) => (
              <section key={s.key} className={`tv-sec sec-${s.key}`}>
                <h3><Icon name={s.icon} size={12} />{t(s.title)}<em>{s.tasks.length}</em></h3>
                <ul className="todo-list">{sortBy(s.tasks, sort).map((x) => card(x, false))}</ul>
              </section>
            ))}
          </>
        ) : (
          <ul className="todo-list">
            {sort === 'file'
              ? tasks.map((x) => card(x))
              : sortBy(all, sort).map((x) => card(x, false))}
          </ul>
        )}
      </div>

      <form className="todo-add"
            onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { void save(add(text, draft)); setDraft(''); } }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
               placeholder={t('Add a step — !high ~40m #tag all work here')}
               aria-label={t('Add a step — !high ~40m #tag all work here')}
               spellCheck={false} />
        <button type="button" className="tv-help" title={t('What the tokens mean')}
                aria-label={t('What the tokens mean')}
                onClick={() => void ask.confirm({
                  title: t('What the tokens mean'),
                  body: [
                    `!high    ${t('priority: critical, high, medium, low, maybe')}`,
                    `@doing   ${t('status: planning, doing, review, testing, blocked, deferred')}`,
                    `%45      ${t('progress, 0 to 100')}`,
                    `~40m     ${t('estimate: 90, 40m, 2h, 1h30m, 3d')}`,
                    `#ai      ${t('a tag or a category')}`,
                    `+src/a.ts ${t('a file this task touches')}`,
                    `>Login   ${t('waits for another task')}`,
                    `^today   ${t('due: today, tomorrow, or 2026-09-05')}`,
                  ].join('\n'),
                  confirmLabel: t('Close'),
                })}>
          <Icon name="sparkle" size={12} />
        </button>
      </form>
    </div>
  );
}

export default TodoPanel;
