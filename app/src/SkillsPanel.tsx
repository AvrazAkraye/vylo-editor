import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from './Icon';
import * as ask from './ask';
import { explain } from './errors';
import { applyWrite } from './disk';
import { sha256Hex } from './hash';
import { watch } from './docs';
import { STARTER, add, parse, remove, update, type Skill } from './skills';

/**
 * Instruction sheets an agent can carry.
 *
 * BridgeMind's Skills in this app's terms: a named piece of text kept in
 * `.vylo/SKILLS.md`, attached to an agent by name in `.vylo/AGENTS.md`, and
 * read into what the model is told at the start of every run that agent
 * makes. The file travels with the project and is reviewable in a pull
 * request, so a skill a teammate added is one you can read before an agent
 * runs with it.
 *
 * The panel is the agents section of `RoutinesPanel` with a form instead of
 * three questions: a sheet is a paragraph or more, and a paragraph wants a
 * textarea. A row is the skill's name and the first line of its sheet; press
 * it to edit, press its cross to remove it. Nothing here runs anything —
 * a skill is text until an agent carries it, and the agent's run goes
 * through the same gate every run does.
 *
 * The file is read once and then watched (see docs.ts), because the agent
 * can write it through the review gate and a second copy of this panel can
 * write it too. The starter is written on the first press of the plus rather
 * than on opening the panel, so looking at the section does not put a file
 * in somebody's repository.
 */

const FILE = '.vylo/SKILLS.md';

interface Props {
  root: string;
  t: (s: string) => string;
  onError: (message: string) => void;
  /** So the app can be told which skills exist, for `systemPromptFor`. */
  onSkills?: (skills: Skill[]) => void;
}

const BLANK = { name: '', body: '' };

export function SkillsPanel({ root, t, onError, onSkills }: Props) {
  const [text, setText] = useState('');
  const [sha, setSha] = useState('');
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState<typeof BLANK | null>(null);
  /**
   * The id of the skill the form is editing, or '' for a new one. The id
   * rather than the line, because the file can change under an open form —
   * the agent writes it, or a teammate's panel does — and the line is looked
   * up again at save time in whatever the file says then.
   */
  const [editing, setEditing] = useState('');

  const load = useCallback(async () => {
    if (!root) return;
    try {
      const r = await invoke<{ text: string }>('read_for_editor', { root, path: FILE });
      setText(r.text);
      setSha(await sha256Hex(r.text));
    } catch {
      // No file yet is the ordinary case.
      setText('');
      setSha('');
    }
    setReady(true);
  }, [root]);
  useEffect(() => { setReady(false); void load(); }, [load]);
  useEffect(() => watch(FILE, (next) => { setText(next); void sha256Hex(next).then(setSha); }), []);

  const skills = parse(text);
  useEffect(() => { onSkills?.(skills); }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(next: string) {
    const before = text;
    setText(next);
    try {
      await applyWrite(root, FILE, next, sha || undefined);
      setSha(await sha256Hex(next));
    } catch (e) {
      setText(before);
      onError(explain(e, t('save the skills')));
      void load();
    }
  }

  function openForm(s?: Skill) {
    setEditing(s?.id ?? '');
    setForm(s ? { name: s.name, body: s.body } : { ...BLANK });
  }

  function saveForm() {
    if (!form) return;
    let next = text;
    if (editing) {
      const cur = skills.find((s) => s.id === editing);
      if (!cur) {
        onError(t('That skill is no longer in .vylo/SKILLS.md.'));
        setForm(null);
        return;
      }
      next = update(text, cur.line, form);
    } else {
      next = add(text, form);
    }
    if (next === text) {
      // A file that came back unchanged means one of two things, and they want
      // opposite answers. `add` and `update` both refuse a draft with no name
      // or nothing under it — that is the mistake this message is for. But
      // `update` also hands back the same bytes when the draft is what the
      // entry already says, which is what Save on a form nobody touched does:
      // there is nothing to write, and nothing to complain about either, so
      // the form closes as it would after a real edit.
      if (form.name.trim() && form.body.trim()) { setForm(null); return; }
      onError(t('A skill needs a name and something under it.'));
      return;
    }
    void save(next);
    setForm(null);
  }

  if (!ready) return null;

  return (
    <div className="sk">
      <div className="sb-sub sk-sub">
        {t('Skills')}
        <button className="tsl-add" onClick={() => void (skills.length || text.trim() ? openForm() : save(STARTER))}
                title={t('New skill')} aria-label={t('New skill')}><Icon name="plus" size={14} /></button>
      </div>
      {skills.length === 0 && !form ? (
        <p className="ft-empty">{t('No skills yet. Start with two examples, then write your own.')}</p>
      ) : (
        <ul className="sk-list">
          {skills.map((s) => (
            <li key={s.id} className={`sk-row ${editing === s.id && form ? 'editing' : ''}`}>
              <button className="sk-hit" onClick={() => openForm(s)}
                      title={t('Edit')} aria-label={`${t('Edit')} — ${s.name}`}>
                <b>{s.name}</b>
                <span>{s.body.split('\n')[0]}</span>
              </button>
              <button className="todo-x" onClick={() => void (async () => {
                if (await ask.confirm({ title: t('Remove this skill?'), body: s.name, confirmLabel: t('Remove'), danger: true })) {
                  if (editing === s.id) setForm(null);
                  void save(remove(text, s.line));
                }
              })()} title={t('Remove')} aria-label={`${t('Remove')} — ${s.name}`}><Icon name="close" size={11} /></button>
            </li>
          ))}
        </ul>
      )}
      {skills.length > 0 && !form && (
        <p className="sk-note">{t('Attach one to an agent with a "- skills:" line in .vylo/AGENTS.md.')}</p>
      )}

      {form && (
        <div className="pv-form sk-form">
          <label>{t('Name')}
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                   placeholder={t('Review')} spellCheck={false} autoFocus />
          </label>
          <label>{t('Instructions')}
            <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={6}
                      placeholder={t('Say how this kind of work should be done here: what to read first, what to leave out, the shape of the answer.')}
                      spellCheck={false} />
          </label>
          <div className="pv-acts">
            <button className="ghost" onClick={() => setForm(null)}>{t('Cancel')}</button>
            <button className="approve" onClick={saveForm}>{t('Save')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default SkillsPanel;
