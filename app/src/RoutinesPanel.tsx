import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from './Icon';
import * as ask from './ask';
import { explain } from './errors';
import { applyWrite } from './disk';
import { sha256Hex } from './hash';
import { watch } from './docs';
import { fill } from './i18n';
import {
  STARTER as AGENTS_STARTER, add as addAgent, parse as parseAgents, remove as removeAgent,
  type Agent, type Mode as AgentMode,
} from './agents';
import {
  DAYS, MAX_EVERY, MIN_EVERY, add as addRoutine, nextRun, pause, phrase, remove as removeRoutine,
  resume, update as updateRoutine, type Routine, type Schedule,
} from './routines';

/**
 * Teammates, and what they are on.
 *
 * BridgeMind's Agent mode in this app's terms. An **agent** is a name and a
 * brief, kept in `.vylo/AGENTS.md` so it travels with the project and is
 * reviewable in a pull request — a teammate somebody else added is a teammate
 * whose brief you can read before it runs. A **routine** puts one of them on a
 * schedule; the work runs in a fresh chat while the app is open, and the
 * result waits for a person.
 *
 * Two rules the whole panel stands on. A routine runs *unattended*, so it runs
 * an agent in Ask mode — reads only — unless auto-approve is on, in which case
 * the person has already decided in advance (see auto.ts). And nothing here
 * publishes, deletes or spends: routines are for gathering, analysing and
 * drafting things a person then reads, which is the only work worth doing
 * while nobody is watching.
 */

const FILE = '.vylo/AGENTS.md';

interface Props {
  root: string;
  t: (s: string) => string;
  routines: Routine[];
  onRoutines: (next: Routine[]) => void;
  /** Start one now, by hand. */
  onRun: (r: Routine) => void;
  /** Open the chat a run wrote to. */
  onOpen: (chatId: string) => void;
  onError: (message: string) => void;
  /** So the list can be told which agents exist, for the routine form. */
  onAgents?: (agents: Agent[]) => void;
  /** Whether unattended runs may act — auto-approve is on. */
  unattendedMayAct: boolean;
}

const BLANK = { name: '', agent: '', brief: '', kind: 'daily' as Schedule['kind'], minutes: 60, at: '09:00', day: 1 };

export function RoutinesPanel({ root, t, routines, onRoutines, onRun, onOpen, onError, onAgents, unattendedMayAct }: Props) {
  const [text, setText] = useState('');
  const [sha, setSha] = useState('');
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState<typeof BLANK | null>(null);
  const [editing, setEditing] = useState('');
  const [now, setNow] = useState(() => Date.now());

  // The "next in" column has to move, so the clock ticks — but a minute is
  // enough: nothing here is due to the second.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    if (!root) return;
    try {
      const r = await invoke<{ text: string }>('read_for_editor', { root, path: FILE });
      setText(r.text);
      setSha(await sha256Hex(r.text));
    } catch {
      setText('');
      setSha('');
    }
    setReady(true);
  }, [root]);
  useEffect(() => { setReady(false); void load(); }, [load]);
  useEffect(() => watch(FILE, (next) => { setText(next); void sha256Hex(next).then(setSha); }), []);

  const agents = parseAgents(text);
  useEffect(() => { onAgents?.(agents); }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(next: string) {
    const before = text;
    setText(next);
    try {
      await applyWrite(root, FILE, next, sha || undefined);
      setSha(await sha256Hex(next));
    } catch (e) {
      setText(before);
      onError(explain(e, t('save the agents')));
      void load();
    }
  }

  async function newAgent() {
    const name = await ask.text({ title: t('Name the agent'), value: '', placeholder: t('Reviewer'), confirmLabel: t('Next') });
    if (!name) return;
    const brief = await ask.text({
      title: t('What is it for?'), value: '',
      placeholder: t('Review the staged changes and list anything that could go wrong.'),
      confirmLabel: t('Save'),
    });
    if (!brief) return;
    const mode: AgentMode = (await ask.confirm({
      title: t('May it change files?'),
      body: t('Yes: it may stage edits and ask to run commands, behind the approval gate. No: it reads only.'),
      confirmLabel: t('Yes, it may'),
    })) ? 'agent' : 'ask';
    const next = addAgent(text, { name, brief, mode });
    if (next !== text) void save(next);
  }

  function openForm(r?: Routine) {
    setEditing(r?.id ?? '');
    setForm(r ? {
      name: r.name, agent: r.agent, brief: r.brief,
      kind: r.schedule.kind,
      minutes: r.schedule.kind === 'every' ? r.schedule.minutes : 60,
      at: r.schedule.kind === 'daily' || r.schedule.kind === 'weekly' ? r.schedule.at : '09:00',
      day: r.schedule.kind === 'weekly' ? r.schedule.day : 1,
    } : { ...BLANK, agent: agents[0]?.id ?? '' });
  }

  function saveForm() {
    if (!form) return;
    const schedule: Schedule =
      form.kind === 'every' ? { kind: 'every', minutes: Math.min(MAX_EVERY, Math.max(MIN_EVERY, Number(form.minutes) || 60)) }
      : form.kind === 'daily' ? { kind: 'daily', at: form.at }
      : form.kind === 'weekly' ? { kind: 'weekly', day: form.day as 0 | 1 | 2 | 3 | 4 | 5 | 6, at: form.at }
      : { kind: 'manual' };
    const draft = { name: form.name, agent: form.agent, brief: form.brief, schedule };
    const next = editing ? updateRoutine(routines, editing, draft, now) : addRoutine(routines, draft, now);
    if (next === routines || (!editing && next.length === routines.length)) {
      onError(t('A routine needs a name, an agent and a brief.'));
      return;
    }
    onRoutines(next);
    setForm(null);
  }

  const when = (r: Routine) => {
    const at = nextRun(r, now);
    if (r.paused) return t('Paused');
    if (at === null) return t('Only when run by hand');
    const mins = Math.max(0, Math.round((at - now) / 60_000));
    return mins < 1 ? t('Due now') : mins < 60 ? fill(t('In {n} minutes'), { n: mins })
      : fill(t('In {n} hours'), { n: Math.round(mins / 60) });
  };

  if (!ready) return null;

  return (
    <div className="rt">
      {/* ── Teammates ────────────────────────────────────────────────── */}
      <div className="sb-sub rt-sub">
        {t('Agents')}
        <button className="tsl-add" onClick={() => void (agents.length || text.trim() ? newAgent() : save(AGENTS_STARTER))}
                title={t('New agent')} aria-label={t('New agent')}><Icon name="plus" size={14} /></button>
      </div>
      {agents.length === 0 ? (
        <p className="ft-empty">{t('No agents yet. Start with two examples, or name your own.')}</p>
      ) : (
        <ul className="rt-agents">
          {agents.map((a) => (
            <li key={a.id} className="rt-agent">
              <span className={`rt-mode ${a.mode}`} title={a.mode === 'agent' ? t('May stage edits and ask to run commands') : t('Reads only')} />
              <span className="rt-what">
                <b>{a.name}</b>
                <span>{a.brief.split('\n')[0]}</span>
              </span>
              <button className="todo-x" onClick={() => void (async () => {
                if (await ask.confirm({ title: t('Remove this agent?'), body: a.name, confirmLabel: t('Remove'), danger: true })) {
                  void save(removeAgent(text, a.line));
                }
              })()} title={t('Remove')} aria-label={`${t('Remove')} — ${a.name}`}><Icon name="close" size={11} /></button>
            </li>
          ))}
        </ul>
      )}

      {/* ── Routines ─────────────────────────────────────────────────── */}
      <div className="sb-sub rt-sub">
        {t('Routines')}
        <button className="tsl-add" onClick={() => openForm()} disabled={!agents.length}
                title={agents.length ? t('New routine') : t('Add an agent first')} aria-label={t('New routine')}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      {!unattendedMayAct && routines.length > 0 && (
        <p className="rt-note">{t('Routines run in Ask mode — reads only — unless auto-approve is on.')}</p>
      )}
      {routines.length === 0 && !form && (
        <p className="ft-empty">{t('Nothing scheduled. A routine is an agent, a brief and a time.')}</p>
      )}
      <ul className="rt-list">
        {routines.map((r) => {
          const ph = phrase(r.schedule);
          const agent = agents.find((a) => a.id === r.agent);
          return (
            <li key={r.id} className={`rt-row ${r.paused ? 'paused' : ''} ${r.lastRun && !r.lastRun.ok ? 'failed' : ''}`}>
              <div className="rt-what">
                <b>{r.name}</b>
                <span>{agent?.name ?? r.agent} · {fill(t(ph.key), { ...ph.vars, day: typeof ph.vars.day === 'string' ? t(ph.vars.day) : '' })}</span>
                <em>{when(r)}{r.lastRun && !r.lastRun.ok && r.lastRun.error ? ` — ${r.lastRun.error}` : ''}</em>
              </div>
              <span className="rt-acts">
                <button className="todo-act" onClick={() => onRun(r)} title={t('Run now')} aria-label={`${t('Run now')} — ${r.name}`}><Icon name="play" size={12} /></button>
                {r.lastRun && (
                  <button className="todo-act" onClick={() => onOpen(r.lastRun!.chatId)} title={t('Open the last run')} aria-label={`${t('Open the last run')} — ${r.name}`}><Icon name="chat" size={12} /></button>
                )}
                <button className="todo-act" onClick={() => onRoutines(r.paused ? resume(routines, r.id, now) : pause(routines, r.id))}
                        title={r.paused ? t('Resume') : t('Pause')} aria-label={`${r.paused ? t('Resume') : t('Pause')} — ${r.name}`}>
                  <Icon name={r.paused ? 'play' : 'pause'} size={12} />
                </button>
                <button className="todo-act" onClick={() => openForm(r)} title={t('Edit')} aria-label={`${t('Edit')} — ${r.name}`}><Icon name="pencil" size={12} /></button>
                <button className="todo-x" onClick={() => void (async () => {
                  if (await ask.confirm({ title: t('Delete this routine?'), body: r.name, confirmLabel: t('Delete'), danger: true })) {
                    onRoutines(removeRoutine(routines, r.id));
                  }
                })()} title={t('Delete')} aria-label={`${t('Delete')} — ${r.name}`}><Icon name="close" size={11} /></button>
              </span>
            </li>
          );
        })}
      </ul>

      {form && (
        <div className="pv-form rt-form">
          <label>{t('Name')}
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('Weekly release notes')} spellCheck={false} />
          </label>
          <label>{t('Agent')}
            <select value={form.agent} onChange={(e) => setForm({ ...form, agent: e.target.value })}>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>{t('Brief')}
            <textarea value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })} rows={4}
                      placeholder={t('Say what to produce, where to look, the time window, and the shape of the answer.')} spellCheck={false} />
          </label>
          <label>{t('Schedule')}
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Schedule['kind'] })}>
              <option value="every">{t('Every so many minutes')}</option>
              <option value="daily">{t('Daily')}</option>
              <option value="weekly">{t('Weekly')}</option>
              <option value="manual">{t('Only when run by hand')}</option>
            </select>
          </label>
          {form.kind === 'every' && (
            <label>{t('Minutes')}
              <input type="number" min={MIN_EVERY} max={MAX_EVERY} value={form.minutes}
                     onChange={(e) => setForm({ ...form, minutes: Number(e.target.value) })} />
            </label>
          )}
          {(form.kind === 'daily' || form.kind === 'weekly') && (
            <label>{t('At')}
              <input type="time" value={form.at} onChange={(e) => setForm({ ...form, at: e.target.value })} />
            </label>
          )}
          {form.kind === 'weekly' && (
            <label>{t('Day')}
              <select value={form.day} onChange={(e) => setForm({ ...form, day: Number(e.target.value) })}>
                {DAYS.map((d, i) => <option key={d} value={i}>{t(d)}</option>)}
              </select>
            </label>
          )}
          <div className="pv-acts">
            <button className="ghost" onClick={() => setForm(null)}>{t('Cancel')}</button>
            <button className="approve" onClick={saveForm}>{t('Save')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default RoutinesPanel;
