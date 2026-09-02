import { useState } from 'react';
import { Icon } from './Icon';
import * as ask from './ask';
import { ContextMenu } from './ContextMenu';
import type { Item as MenuItem, Point as MenuPoint } from './menu';
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

/** Which chip's menu is showing. */
type Which = 'status' | 'priority' | 'due' | 'estimate' | 'more';

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
  /** Which chip's menu is open, and where it was opened from. */
  const [at, setAt] = useState<{ which: Which; point: MenuPoint } | null>(null);

  const menu = (e: React.MouseEvent, which: Which) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // From the chip's own bottom-left, not the pointer: a menu that opens
    // under a chip you clicked reads as belonging to it, and a chip is a small
    // enough target that the pointer could be anywhere inside it.
    setAt({ which, point: { x: r.left, y: r.bottom + 4 } });
  };

  function itemsFor(which: Which): MenuItem[] {
    const clear = (on: boolean): MenuItem[] =>
      on ? [{ kind: 'divider' }, { kind: 'action', id: 'clear', label: 'Clear' }] : [];
    switch (which) {
      case 'status':
        return [
          { kind: 'action', id: 'todo', label: STATE_WORD.todo },
          ...PICKABLE.map((x): MenuItem => ({ kind: 'action', id: x, label: STATE_WORD[x] })),
        ];
      case 'priority':
        return [
          ...PRIORITIES.map((x): MenuItem => ({ kind: 'action', id: x, label: PRIORITY_WORD[x] })),
          ...clear(task.priority !== null),
        ];
      case 'due':
        return [
          { kind: 'action', id: 'today', label: 'today' },
          { kind: 'action', id: 'tomorrow', label: 'tomorrow' },
          { kind: 'action', id: 'pick', label: 'Pick a date…' },
          ...clear(task.due !== null),
        ];
      case 'estimate':
        return [
          ...ESTIMATES.map((m): MenuItem => ({ kind: 'action', id: String(m), label: duration(m) })),
          ...clear(task.estimate !== null),
        ];
      default:
        return [
          { kind: 'action', id: 'subtask', label: 'Add a subtask' },
          { kind: 'action', id: 'rename', label: 'Rename' },
          { kind: 'divider' },
          { kind: 'action', id: 'remove', label: 'Remove', danger: true },
        ];
    }
  }

  function pick(which: Which, id: string) {
    setAt(null);
    if (which === 'status') acts.status(task.line, id as Status);
    else if (which === 'priority') acts.priority(task.line, id === 'clear' ? null : (id as Priority));
    else if (which === 'estimate') acts.estimate(task.line, id === 'clear' ? null : Number(id));
    else if (which === 'due') {
      if (id === 'clear') acts.due(task.line, null);
      else if (id === 'pick') void (async () => {
        const on = await ask.text({
          title: t('Due'), value: /^\d{4}-/.test(task.due ?? '') ? task.due! : '',
          placeholder: '2026-09-05', confirmLabel: t('Save'),
        });
        // Anything that is not a date is refused here rather than written and
        // read back as nothing, which would look like the field ignoring you.
        if (on && /^\d{4}-\d{2}-\d{2}$/.test(on.trim())) acts.due(task.line, on.trim());
      })();
      else acts.due(task.line, id);
    } else if (id === 'subtask') void (async () => {
      const title = await ask.text({ title: t('Add a subtask'), value: '', confirmLabel: t('Add') });
      if (title) acts.addUnder(task.line, title);
    })();
    else if (id === 'rename') void (async () => {
      const title = await ask.text({ title: t('Rename this step'), value: task.title });
      if (title) acts.rename(task.line, title);
    })();
    else if (id === 'remove') void (async () => {
      const kids = task.children.length;
      if (await ask.confirm({
        title: t('Remove this step?'),
        body: kids ? `${task.title} — ${kids} ${t('subtasks go with it')}` : task.title,
        confirmLabel: t('Remove'), danger: true,
      })) acts.remove(task.line);
    })();
  }

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

          {/* One row, not six.
              This was six labelled rows of pills — status, priority, progress,
              estimate, due, tags — about twenty-five controls on every task
              somebody expanded. It read as a form, and a plan is not a form.
              Now each is a chip that opens a small menu: the same values, one
              row, and nothing on screen until it is asked for.
              The progress slider went entirely. Progress rolls up from
              subtasks on its own, an explicit percentage is a number almost
              nobody keeps current, and `%45` written by hand in the file is
              still read — it just has no dial. */}
          <div className="tk-bar-row">
            <button className={`tk-chip pick ${STATE_CLASS[task.state]}`}
                    onClick={(e) => menu(e, 'status')}>
              <i aria-hidden="true" />{t(STATE_WORD[task.state])}
            </button>

            <button className={`tk-chip pick ${task.priority ? `pr-${task.priority}` : 'none'}`}
                    onClick={(e) => menu(e, 'priority')}>
              {task.priority ? t(PRIORITY_WORD[task.priority]) : t('Priority')}
            </button>

            <button className={`tk-chip pick ${task.due ? 'set' : 'none'}`}
                    onClick={(e) => menu(e, 'due')}>
              <Icon name="calendar" size={10} />
              {task.due ? (t(task.due) || task.due) : t('Due')}
            </button>

            <button className={`tk-chip pick ${task.estimate !== null ? 'set' : 'none'}`}
                    onClick={(e) => menu(e, 'estimate')}>
              <Icon name="clock" size={10} />
              {task.estimate !== null ? duration(task.estimate) : t('Estimate')}
            </button>

            <button className="tk-chip pick none" onClick={(e) => menu(e, 'more')}
                    title={t('More')} aria-label={t('More')}>
              <Icon name="ellipsis" size={12} />
            </button>
          </div>

          {/* Tags stay inline. They are the one field with no fixed set of
              values, so a menu would be a menu with a text box in it. */}
          <form className="tk-tags"
                onSubmit={(e) => { e.preventDefault(); if (tag.trim()) { acts.tag(task.line, tag); setTag(''); } }}>
            {task.tags.map((x) => (
              <button key={x} type="button" className="tk-tag on"
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
      )}

      {at && (
        <ContextMenu
          at={at.point}
          items={itemsFor(at.which)}
          t={t}
          label={`${t('Actions')} — ${task.title}`}
          onPick={(id) => pick(at.which, id)}
          onClose={() => setAt(null)}
        />
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
