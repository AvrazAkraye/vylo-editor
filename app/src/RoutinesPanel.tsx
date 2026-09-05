import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from './Icon';
import * as ask from './ask';
import { explain } from './errors';
import { applyWrite } from './disk';
import { sha256Hex } from './hash';
import { firstDay } from './calendar';
import { watch } from './docs';
import { fill } from './i18n';
import { isTime, until, weekOrder } from './when';
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
 * Two rules the whole panel stands on. A *scheduled* run is unattended, so it
 * runs its agent in Ask mode — reads only — unless auto-approve is on, in
 * which case the person has already decided in advance (see auto.ts). Run now
 * is not that run: it has a person at the approval dialog by definition, so
 * App gives it the agent's own mode (`modeFor(agent, byHand || autoOn(auto))`),
 * and every Run now button here says in its title which of the two it will be.
 * And nothing here publishes, deletes or spends: routines are for gathering,
 * analysing and drafting things a person then reads, which is the only work
 * worth doing while nobody is watching.
 *
 * Anything wrong with the form is said at the form, in the `.pv-bad` line the
 * shared `pv-form` grammar already has, and per field. It used to go to
 * `onError` — which puts a line in the chat transcript, in another space, in a
 * sentence that named three fields whichever one was actually missing.
 *
 * The relative times come from `when.ts` and the order of the weekday picker
 * from `calendar.firstDay`, because neither belongs to a panel: the same
 * sentences are on the dashboard, and the week does not start on Sunday for
 * three of the four languages this ships in.
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
  /** The folder picker, for the empty state when no folder is open. */
  onOpenFolder: () => void;
  /** Whether unattended runs may act — auto-approve is on. */
  unattendedMayAct: boolean;
  /**
   * The interface language, which decides only what day the weekly picker
   * starts on — `calendar.firstDay` already owns that question for the month
   * grid. Optional, and English if it is not passed, so a caller that has not
   * been told about it still gets a week that starts where the calendar's does
   * rather than one that starts on Sunday for everybody.
   */
  lang?: string;
}

const BLANK = { name: '', agent: '', brief: '', kind: 'daily' as Schedule['kind'], minutes: 60, at: '09:00', day: 1 };

export function RoutinesPanel({
  root, t, routines, onRoutines, onRun, onOpen, onError, onOpenFolder, unattendedMayAct, lang = 'en',
}: Props) {
  const [text, setText] = useState('');
  const [sha, setSha] = useState('');
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState<typeof BLANK | null>(null);
  const [editing, setEditing] = useState('');
  /**
   * What is wrong with the form, under the form.
   *
   * It used to go to `onError`, which puts a line in the chat transcript —
   * a person looking at the field they left blank was told about it in
   * another panel, in a sentence that named the wrong fields. This is the
   * `.pv-bad` line the shared form grammar already has for exactly this.
   */
  const [bad, setBad] = useState('');
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

  // This panel's own parse, for the list and the form. App keeps its own copy
  // of the same file for the scheduler and the dashboard, so nothing here has
  // to push the list up — a save goes through `applyWrite`, and App watches.
  const agents = parseAgents(text);

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

  /**
   * The two examples, whatever is in the file already.
   *
   * A blank file gets `STARTER` whole — the paragraph at the top of it is half
   * the explanation of what an agent is. A file that exists but holds no
   * entries gets the two examples appended instead, because writing the
   * starter over it would delete somebody's prose to make room for a
   * demonstration.
   */
  function startWithExamples() {
    if (!text.trim()) return void save(AGENTS_STARTER);
    const next = parseAgents(AGENTS_STARTER)
      .reduce((acc, a) => addAgent(acc, { name: a.name, brief: a.brief, mode: a.mode }), text);
    void save(next);
  }

  function openForm(r?: Routine) {
    setBad('');
    setEditing(r?.id ?? '');
    setForm(r ? {
      name: r.name, agent: r.agent, brief: r.brief,
      kind: r.schedule.kind,
      minutes: r.schedule.kind === 'every' ? r.schedule.minutes : 60,
      at: r.schedule.kind === 'daily' || r.schedule.kind === 'weekly' ? r.schedule.at : '09:00',
      day: r.schedule.kind === 'weekly' ? r.schedule.day : 1,
    } : { ...BLANK, agent: agents[0]?.id ?? '' });
  }

  /**
   * What is missing, field by field, before anything is saved.
   *
   * Per field and in the order the fields are read, so the sentence names the
   * one the person is looking at. The model would refuse most of this too, but
   * silently and as a whole: a cleared time makes `normalise` return null,
   * which makes `add` refuse, which used to be reported as a missing name. And
   * an interval out of range is *clamped* by the model rather than refused, so
   * saying the range here is the only place a person finds out that 2 minutes
   * is not a thing this does.
   */
  function wrong(f: NonNullable<typeof form>): string {
    if (!f.name.trim()) return t('Give the routine a name.');
    if (!f.agent.trim()) return t('Choose the agent that runs it.');
    if (!f.brief.trim()) return t('Say what it should do.');
    if (f.kind === 'every') {
      const n = Number(f.minutes);
      if (!Number.isFinite(n) || n < MIN_EVERY || n > MAX_EVERY) {
        return fill(t('How often, between {min} and {max} minutes.'), { min: MIN_EVERY, max: MAX_EVERY });
      }
    }
    if ((f.kind === 'daily' || f.kind === 'weekly') && !isTime(f.at)) {
      return t('A time of day, on the 24-hour clock — 09:00.');
    }
    return '';
  }

  function saveForm() {
    if (!form) return;
    const no = wrong(form);
    if (no) { setBad(no); return; }
    const schedule: Schedule =
      form.kind === 'every' ? { kind: 'every', minutes: Math.round(Number(form.minutes)) }
      : form.kind === 'daily' ? { kind: 'daily', at: form.at.trim() }
      : form.kind === 'weekly' ? { kind: 'weekly', day: form.day as 0 | 1 | 2 | 3 | 4 | 5 | 6, at: form.at.trim() }
      : { kind: 'manual' };
    const draft = { name: form.name, agent: form.agent, brief: form.brief, schedule };
    const next = editing ? updateRoutine(routines, editing, draft, now) : addRoutine(routines, draft, now);
    // A backstop, not the message a person is meant to get: `wrong` has
    // already said anything sayable, so reaching here means the model refused
    // something this form does not know to ask about.
    if (!editing && next.length === routines.length) {
      setBad(t('A routine needs a name, an agent and a brief.'));
      return;
    }
    onRoutines(next);
    setForm(null);
    setBad('');
  }

  /**
   * A field changed, so the red line under the form may be about a field that
   * is now filled in. It goes as soon as anything is typed rather than at the
   * next Save, so it never says something the form has stopped meaning.
   */
  const change = (next: typeof BLANK) => { setForm(next); if (bad) setBad(''); };

  const when = (r: Routine) => {
    const at = nextRun(r, now);
    if (at === null) return t('Only when run by hand');
    const p = until(at, now);
    return fill(t(p.key), p.vars);
  };
  /**
   * What the row adds after the time: why the owed run is waiting, while it
   * is owed, else how the last run failed. The hold is the newer news, and
   * "Due now" with nothing beside it is the question this answers.
   */
  const note = (r: Routine) => {
    const at = nextRun(r, now);
    if (r.held && at !== null && at <= now) return r.held;
    return r.lastRun && !r.lastRun.ok && r.lastRun.error ? r.lastRun.error : '';
  };
  /** The first line of a brief: what the row shows, and what its title says. */
  const briefLine = (a: Agent) => a.brief.split('\n')[0];
  /**
   * What Run now will do, for *this* row's agent.
   *
   * The button is a hand run, and App gives a hand run the agent's own mode —
   * `modeFor(agent, byHand || autoOn(auto))` — because there is a person at
   * the approval dialog. So the promise differs per row, and a title reading
   * only "Run now" left the difference to be remembered from the dot two
   * sections up.
   *
   * An agent that is no longer in `.vylo/AGENTS.md` gets the narrower
   * sentence. The run will be refused before anything happens (App records
   * "Its agent is no longer in .vylo/AGENTS.md."), and of the two wordings the
   * one that promises less is the one to be wrong in.
   */
  const runTitle = (a?: Agent) => (a?.mode === 'agent'
    ? t('Run now — may edit, behind the approval dialog')
    : t('Run now — reads only'));

  // No folder means no `.vylo/AGENTS.md` to read, and a heading over an empty
  // column says nothing about why. The same sentence and button the Files
  // panel gives, because it is the same situation.
  if (!root) {
    return (
      <div className="sb-cta">
        <p className="ft-empty">{t('Open a folder, or drop one here')}</p>
        <button className="ghost bordered" onClick={onOpenFolder}>
          <Icon name="folder" size={13} />
          <span className="cta-label">{t('Open a folder')}</span>
        </button>
      </div>
    );
  }
  if (!ready) return null;

  return (
    <div className="rt">
      {/* ── Teammates ────────────────────────────────────────────────── */}
      <div className="sb-sub rt-sub">
        {t('Agents')}
        <button className="tsl-add" onClick={() => void newAgent()}
                title={t('New agent')} aria-label={t('New agent')}><Icon name="plus" size={14} /></button>
      </div>
      {agents.length === 0 ? (
        /* The sentence offers a choice, so the state has to give one. It used
           to give a single + whose handler decided for you: the first press
           wrote the examples, and there was no way to ask for the other. */
        <div className="sb-cta rt-cta">
          <p className="ft-empty">{t('No agents yet. Start with two examples, or name your own.')}</p>
          <button className="ghost bordered" onClick={startWithExamples}>
            <Icon name="plus" size={13} />
            <span className="cta-label">{t('Start with two examples')}</span>
          </button>
          <button className="ghost bordered" onClick={() => void newAgent()}>
            <Icon name="pencil" size={13} />
            <span className="cta-label">{t('Name an agent')}</span>
          </button>
        </div>
      ) : (
        <ul className="rt-agents">
          {agents.map((a) => (
            <li key={a.id} className="rt-agent">
              {/* The dot is decoration. What it meant — the distinction this
                  panel's whole safety story rests on — is in the line below
                  it, because an 8px circle with a hover title says nothing to
                  a keyboard or a screen reader. */}
              <span className={`rt-mode ${a.mode}`} aria-hidden="true" />
              <span className="rt-what">
                <b>{a.name}</b>
                {/* The title is the brief, not the mode. The mode is visible
                    text in this same span — for an ask-mode agent the tooltip
                    was the word "Reads only" over the words "Reads only" —
                    while the brief beside it is the half the row ellipsises,
                    and had no way to be read at all. Hovering now reveals what
                    was cut, which is the only thing a tooltip is for. */}
                <span title={briefLine(a)}>
                  {a.mode === 'agent' ? t('May edit') : t('Reads only')} · {briefLine(a)}
                </span>
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
        {/* Enabled even with no agents, because a disabled button is out of
            the tab order and its reason was in a hover title — so the one
            thing to do about it was unreachable by keyboard. It says what it
            will do, and does that: names an agent first. */}
        <button className="tsl-add" onClick={() => (agents.length ? openForm() : void newAgent())}
                title={agents.length ? t('New routine') : t('Add an agent first')}
                aria-label={agents.length ? t('New routine') : t('Add an agent first')}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      {/* One sentence per state, and neither of them is the old one. That said
          "Routines run in Ask mode — reads only" directly above rows whose Run
          now button hands the agent its *own* mode: true of the schedule,
          false of the button under it. Both notes now name the schedule and
          the button separately, because they are two different promises. */}
      {routines.length > 0 && (
        <p className="rt-note">
          {unattendedMayAct
            ? t('Auto-approve is on: routines may edit and run commands without asking.')
            : t('Scheduled runs use Ask mode — reads only. Run now uses the agent’s own mode, behind the approval dialog.')}
        </p>
      )}
      {routines.length === 0 && !form && (
        <p className="ft-empty">
          {agents.length ? t('Nothing scheduled. A routine is an agent, a brief and a time.')
            : t('Nothing scheduled. A routine is an agent, a brief and a time — so add an agent first.')}
        </p>
      )}
      <ul className="rt-list">
        {routines.map((r) => {
          const ph = phrase(r.schedule);
          const agent = agents.find((a) => a.id === r.agent);
          const aside = note(r);
          // No `paused` class on the row. The rule that read it went with the
          // 55%-opacity dimming it drove, so it had been styling nothing, and
          // the state is said by the pill in the time column below. A class
          // nothing reads is a hook somebody later mistakes for load-bearing.
          return (
            <li key={r.id} className={`rt-row ${r.lastRun && !r.lastRun.ok ? 'failed' : ''}`}>
              <div className="rt-what">
                <b>{r.name}</b>
                <span>{agent?.name ?? r.agent} · {fill(t(ph.key), { ...ph.vars, day: typeof ph.vars.day === 'string' ? t(ph.vars.day) : '' })}</span>
                {/* A pill rather than a dimmed row: paused used to be said by
                    dropping the whole column to 55% opacity, which put the
                    word "Paused" at about 2:1 against the sidebar. */}
                <em>
                  {r.paused ? <span className="rt-pill">{t('Paused')}</span> : when(r)}
                  {aside ? ` — ${aside}` : ''}
                </em>
              </div>
              <span className="rt-acts">
                <button className="todo-act" onClick={() => onRun(r)} title={runTitle(agent)} aria-label={`${t('Run now')} — ${r.name}`}><Icon name="play" size={12} /></button>
                {/* Only when there is a chat to open. A run refused before one
                    was made — no agent, no key — records an empty id, and the
                    button for it did nothing at all. */}
                {r.lastRun?.chatId && (
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
            <input value={form.name} onChange={(e) => change({ ...form, name: e.target.value })} placeholder={t('Weekly release notes')} spellCheck={false} />
          </label>
          <label>{t('Agent')}
            <select value={form.agent} onChange={(e) => change({ ...form, agent: e.target.value })}>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>{t('Brief')}
            <textarea value={form.brief} onChange={(e) => change({ ...form, brief: e.target.value })} rows={4}
                      placeholder={t('Say what to produce, where to look, the time window, and the shape of the answer.')} spellCheck={false} />
          </label>
          <label>{t('Schedule')}
            <select value={form.kind} onChange={(e) => change({ ...form, kind: e.target.value as Schedule['kind'] })}>
              <option value="every">{t('Every so many minutes')}</option>
              <option value="daily">{t('Daily')}</option>
              <option value="weekly">{t('Weekly')}</option>
              <option value="manual">{t('Only when run by hand')}</option>
            </select>
          </label>
          {form.kind === 'every' && (
            <label>{t('Minutes')}
              <input type="number" min={MIN_EVERY} max={MAX_EVERY} value={form.minutes}
                     onChange={(e) => change({ ...form, minutes: Number(e.target.value) })} />
            </label>
          )}
          {(form.kind === 'daily' || form.kind === 'weekly') && (
            <label>{t('At')}
              <input type="time" value={form.at} onChange={(e) => change({ ...form, at: e.target.value })} />
            </label>
          )}
          {form.kind === 'weekly' && (
            <label>{t('Day')}
              {/* Shown in the order the week runs here, as the calendar does.
                  The value stays the raw 0–6 `Date.getDay` index — only the
                  order turns round, or a Saturday-first list would file
                  everything under the wrong day. */}
              <select value={form.day} onChange={(e) => change({ ...form, day: Number(e.target.value) })}>
                {weekOrder(firstDay(lang)).map((i) => <option key={DAYS[i]} value={i}>{t(DAYS[i])}</option>)}
              </select>
            </label>
          )}
          {bad && <p className="pv-bad">{bad}</p>}
          <div className="pv-acts">
            <button className="ghost" onClick={() => { setForm(null); setBad(''); }}>{t('Cancel')}</button>
            <button className="approve" onClick={saveForm}>{t('Save')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default RoutinesPanel;
