import { useState } from 'react';
import { Icon } from './Icon';
import * as ask from './ask';
import {
  PICKABLE, PRIORITIES, duration,
  type Priority, type Rolled, type Status,
} from './todo';

/**
 * One task, and its subtasks under it.
 *
 * Two levels of detail on purpose. Closed, a task is one line with its
 * metadata as small chips — which is all anybody needs while scanning a list
 * for what to do next. Open, it grows the controls that change those chips.
 *
 * Everything on the open card writes one token on one line of `.vylo/TODO.md`,
 * so there is nothing here that could not be typed by hand into the file. That
 * is the test a control has to pass to be on this card at all: a button that
 * needed somewhere else to remember what it did would have broken the promise
 * the whole design rests on.
 */

/** Which dot goes beside a status. The spec's palette, as CSS classes. */
export const STATE_CLASS: Record<Status, string> = {
  todo: 'st-todo', planning: 'st-planning', doing: 'st-doing', review: 'st-review',
  testing: 'st-testing', blocked: 'st-blocked', deferred: 'st-deferred', done: 'st-done',
};

/** English for a status. Sentence case, like every other string in the app. */
export const STATE_WORD: Record<Status, string> = {
  todo: 'Not started', planning: 'Planning', doing: 'In progress', review: 'In review',
  testing: 'Testing', blocked: 'Blocked', deferred: 'Later', done: 'Completed',
};

export const PRIORITY_WORD: Record<Priority, string> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', maybe: 'Nice to have',
};

/** The estimates the picker offers, in minutes. */
const ESTIMATES = [15, 30, 60, 120, 240, 480];

export interface Acts {
  toggle: (line: number) => void;
  status: (line: number, s: Status) => void;
  priority: (line: number, p: Priority | null) => void;
  progress: (line: number, n: number | null) => void;
  estimate: (line: number, mins: number | null) => void;
  due: (line: number, due: string | null) => void;
  tag: (line: number, tag: string) => void;
  rename: (line: number, title: string) => void;
  remove: (line: number) => void;
  addUnder: (line: number, title: string) => void;
  toChat: (text: string) => void;
  toTerminal: (command: string) => void;
  openFile: (path: string) => void;
}

interface Props {
  task: Rolled;
  acts: Acts;
  t: (s: string) => string;
  /** Off in search results and on the board, where nesting would mislead. */
  nested?: boolean;
  depth?: number;
}

export function TodoTask({ task, acts, t, nested = true, depth = 0 }: Props) {
  const [open, setOpen] = useState(false);
  const [tag, setTag] = useState('');

  const chips = (
    <>
      {task.priority && (
        <span className={`tk-chip pr-${task.priority}`} title={t('Priority')}>
          {t(PRIORITY_WORD[task.priority])}
        </span>
      )}
      {/* Nothing said about a task is not worth a chip saying so. */}
      {task.state !== 'todo' && task.state !== 'done' && (
        <span className={`tk-chip ${STATE_CLASS[task.state]}`}>{t(STATE_WORD[task.state])}</span>
      )}
      {task.estimate !== null && (
        <span className="tk-chip quiet" title={t('Estimated time')}>
          <Icon name="clock" size={10} />{duration(task.estimate)}
        </span>
      )}
      {task.due && (
        <span className="tk-chip quiet" title={t('Due')}>
          <Icon name="calendar" size={10} />{t(task.due) || task.due}
        </span>
      )}
      {task.tags.map((x) => <span key={x} className="tk-tag">#{x}</span>)}
    </>
  );

  return (
    <li className={`tk ${task.done ? 'done' : ''} ${STATE_CLASS[task.state]} ${open ? 'open' : ''}`}
        style={depth ? { marginInlineStart: `${Math.min(depth, 4) * 16}px` } : undefined}>
      <div className="tk-row">
        <button className="todo-box" onClick={() => acts.toggle(task.line)}
                role="checkbox" aria-checked={task.done}
                aria-label={`${task.done ? t('Done') : t('Not done')} — ${task.title}`}>
          {task.done && <Icon name="check" size={11} />}
        </button>

        <button className="tk-main" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="tk-line">
            <span className={`tk-title ${task.kind === 'command' ? 'mono' : ''}`}>{task.title}</span>
            {chips}
          </span>

          {/* The one thing a blocked task has to say, and the reason the whole
              dependency token exists. */}
          {task.waiting.length > 0 && (
            <span className="tk-wait">
              <Icon name="warning" size={11} />
              {t('Waiting for')} {task.waiting.join(', ')}
            </span>
          )}

          {/* A bar only where there is progress to show. A row of empty bars
              down a list is noise that says nothing. */}
          {!task.done && task.percent > 0 && (
            <span className="tk-bar" title={`${task.percent}%`}>
              <i><b style={{ inlineSize: `${task.percent}%` }} /></i>
              <em>{task.percent}%</em>
            </span>
          )}

          {task.files.length > 0 && (
            <span className="tk-files">
              {task.files.map((f) => (
                <span key={f} className="tk-file" role="link" tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); acts.openFile(f); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); acts.openFile(f); } }}>
                  <Icon name="file" size={10} />{f}
                </span>
              ))}
            </span>
          )}
        </button>

        <span className="tk-acts">
          {/* Two destinations, and they are not the same shape. Prose reaches
              the composer unsent; a command reaches the approval dialog. */}
          {task.kind === 'command' ? (
            <button className="todo-act" onClick={() => acts.toTerminal(task.text)}
                    title={t('Run this step — you will be asked to approve it')}
                    aria-label={t('Run this step — you will be asked to approve it')}>
              <Icon name="terminal" size={12} />
            </button>
          ) : (
            <button className="todo-act" onClick={() => acts.toChat(task.text)}
                    title={t('Put this step in the message box')}
                    aria-label={t('Put this step in the message box')}>
              <Icon name="chat" size={12} />
            </button>
          )}
          <button className="todo-act" onClick={() => setOpen(!open)}
                  title={t('Details')} aria-label={`${t('Details')} — ${task.title}`}>
            <Icon name="chevron" size={12} turn={open ? 180 : 0} />
          </button>
        </span>
      </div>

      {task.note && !open && <p className="tk-note one">{task.note.split('\n')[0]}</p>}

      {open && (
        <div className="tk-open">
          {task.note && <p className="tk-note">{task.note}</p>}

          <div className="tk-set">
            <span className="tk-label">{t('Status')}</span>
            <span className="tk-pills">
              {PICKABLE.map((s) => (
                <button key={s} className={`tk-pill ${STATE_CLASS[s]} ${task.status === s ? 'on' : ''}`}
                        aria-pressed={task.status === s}
                        onClick={() => acts.status(task.line, task.status === s ? 'todo' : s)}>
                  {t(STATE_WORD[s])}
                </button>
              ))}
            </span>
          </div>

          <div className="tk-set">
            <span className="tk-label">{t('Priority')}</span>
            <span className="tk-pills">
              {PRIORITIES.map((p) => (
                <button key={p} className={`tk-pill pr-${p} ${task.priority === p ? 'on' : ''}`}
                        aria-pressed={task.priority === p}
                        onClick={() => acts.priority(task.line, task.priority === p ? null : p)}>
                  {t(PRIORITY_WORD[p])}
                </button>
              ))}
            </span>
          </div>

          <div className="tk-set">
            <span className="tk-label">{t('Progress')}</span>
            <input className="tk-range" type="range" min={0} max={100} step={5}
                   value={task.percent} aria-label={t('Progress')}
                   /* Children average up into a parent, so a parent's own
                      slider would be overruled the moment anything changed
                      under it — better to say so than to offer a control that
                      does not hold. */
                   disabled={task.children.length > 0}
                   onChange={(e) => acts.progress(task.line, Number(e.target.value))} />
            <span className="tk-pct">{task.percent}%</span>
          </div>

          <div className="tk-set">
            <span className="tk-label">{t('Estimated time')}</span>
            <span className="tk-pills">
              {ESTIMATES.map((m) => (
                <button key={m} className={`tk-pill ${task.estimate === m ? 'on' : ''}`}
                        aria-pressed={task.estimate === m}
                        onClick={() => acts.estimate(task.line, task.estimate === m ? null : m)}>
                  {duration(m)}
                </button>
              ))}
            </span>
          </div>

          <div className="tk-set">
            <span className="tk-label">{t('Due')}</span>
            <span className="tk-pills">
              {(['today', 'tomorrow'] as const).map((d) => (
                <button key={d} className={`tk-pill ${task.due === d ? 'on' : ''}`}
                        aria-pressed={task.due === d}
                        onClick={() => acts.due(task.line, task.due === d ? null : d)}>
                  {t(d)}
                </button>
              ))}
              <input className="tk-date" type="date" value={/^\d{4}-/.test(task.due ?? '') ? task.due! : ''}
                     aria-label={t('Due')}
                     onChange={(e) => acts.due(task.line, e.target.value || null)} />
            </span>
          </div>

          <div className="tk-set">
            <span className="tk-label">{t('Tags')}</span>
            <form className="tk-pills"
                  onSubmit={(e) => { e.preventDefault(); if (tag.trim()) { acts.tag(task.line, tag); setTag(''); } }}>
              {task.tags.map((x) => (
                <button key={x} type="button" className="tk-pill on"
                        onClick={() => acts.tag(task.line, x)}
                        title={t('Remove')} aria-label={`${t('Remove')} #${x}`}>
                  #{x}<Icon name="close" size={9} />
                </button>
              ))}
              <input value={tag} onChange={(e) => setTag(e.target.value)}
                     className="tk-tagin" placeholder={t('Add a tag')}
                     aria-label={t('Add a tag')} spellCheck={false} />
            </form>
          </div>

          <div className="tk-more">
            <button className="ghost" onClick={() => void (async () => {
              const title = await ask.text({ title: t('Add a subtask'), value: '', confirmLabel: t('Add') });
              if (title) acts.addUnder(task.line, title);
            })()}>
              <Icon name="plus" size={12} />{t('Add a subtask')}
            </button>
            <button className="ghost" onClick={() => void (async () => {
              const title = await ask.text({ title: t('Rename this step'), value: task.title });
              if (title) acts.rename(task.line, title);
            })()}>
              <Icon name="pencil" size={12} />{t('Rename')}
            </button>
            <button className="ghost danger" onClick={() => void (async () => {
              // Removing a parent takes its subtasks, so the count is in the
              // question rather than discovered afterwards.
              const kids = task.children.length;
              if (await ask.confirm({
                title: t('Remove this step?'),
                body: kids ? `${task.title} — ${kids} ${t('subtasks go with it')}` : task.title,
                confirmLabel: t('Remove'), danger: true,
              })) acts.remove(task.line);
            })()}>
              <Icon name="close" size={12} />{t('Remove')}
            </button>
          </div>
        </div>
      )}

      {nested && task.children.length > 0 && (
        <ul className="tk-kids">
          {task.children.map((c) => (
            <TodoTask key={c.line} task={c} acts={acts} t={t} nested depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default TodoTask;
