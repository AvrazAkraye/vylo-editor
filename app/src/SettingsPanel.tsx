import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { Icon } from './Icon';
import * as ask from './ask';
import { LANGS, type Lang } from './i18n';
import { commandLine, isEnabled, type McpTool, type ServerSpec } from './mcp';
import { clipboardBytes, human, isOnDisk, usage, type Sizes, type StoreId } from './stores';
import { view, type CategoryId, type Setting } from './settings';
import { ModuleList, RailSide } from './ModuleList';
import { ProviderList } from './ProviderList';
import type { Provider } from './providers';
import type { Layout as ModuleLayout } from './modules';
import { LEVELS, LEVEL_ABOUT, LEVEL_LABEL, type Level as AutoLevel } from './auto';
import { IS_MAC, Shortcuts } from './Welcome';
import { label as chordLabel } from './shortcut';
import type { Chip } from './session';
import type { Clip } from './clips';
import type { Available } from './updates';
import type { Prefs as NotifyPrefs, Level as NotifyLevel } from './notify';
import type { Theme } from './theme';

/**
 * Settings.
 *
 * It used to be a flat block of nine controls that unrolled under the header —
 * gateway, key, theme, language, completion, notifications, shortcut, MCP — in
 * the order each was built. Nine is where that stops working: nothing is
 * grouped, nothing can be searched, and the answer to "where do I turn X off"
 * is to read all of it. This is the same controls behind a left rail of
 * categories and a right pane of rows, plus the two the old block could not
 * hold: the key map, and a Storage tab that finally gives every local store a
 * button.
 *
 * ## The shape
 *
 * `settings.ts` is the catalogue — which categories exist, which rows are in
 * each, what each row can be found by — and it answers the search. This file
 * draws it, and the division is deliberate: the rail needs to know which
 * categories have hits before a single row exists, which markup cannot answer
 * about itself while it is being built.
 *
 * `switch (row.id)` below is exhaustive over `SettingId`. Adding a row to the
 * catalogue without giving it a control is a type error here, rather than a
 * blank line somebody finds in a screenshot months later.
 *
 * ## The modal
 *
 * `Palette.tsx`'s `Shell`, for its reasons rather than for consistency: focus
 * returns where it came from, so a keyboard user carries on rather than
 * starting again at the top of the document, and Escape works wherever focus is
 * inside the dialog rather than only in the search field. D7 paid for both.
 *
 * ## What the rows say
 *
 * A row is a label, an optional line under it, and a control. That line is
 * where a settings screen earns its keep, so it is used for the things this app
 * has to say and has nowhere else to say them: that the key never leaves this
 * machine, that signing out does not revoke it, that an MCP server is a command
 * from the repository you opened, and what each local store is holding. Those
 * sentences live in the catalogue beside the row they belong to.
 */

interface Props {
  t: (s: string) => string;
  /** The rail row to open on. Set when a search result chose the row. */
  initial?: CategoryId;
  onClose: () => void;

  // ── Account ──
  baseUrl: string;
  onBaseUrl: (v: string) => void;
  apiKey: string;
  onApiKey: (v: string) => void;
  /** Empty when nobody is signed in. Never rendered — see `VYLO.md`. */
  token: string;
  signedInAs: string;
  /** Opens the account form. Settings closes; the form owns the screen. */
  onSignIn: () => void;
  /** Already reduced by `session.chip`, which decides the unmetered case. */
  plan: Chip | null;
  onSignOut: () => void;

  // ── Appearance ──
  theme: Theme;
  onTheme: (v: Theme) => void;
  lang: Lang;
  onLang: (v: Lang) => void;

  // ── Editor ──
  autocomplete: boolean;
  onAutocomplete: (v: boolean) => void;

  // ── Notifications ──
  notify: NotifyPrefs;
  onNotify: (patch: Partial<NotifyPrefs>) => void;

  // ── Shortcuts ──
  summon: string | null;
  /** An English sentence out of `shortcut.ts`, translated where it is drawn. */
  summonErr: string;
  recording: boolean;
  onRecording: (on: boolean) => void;
  onSummonKey: (e: React.KeyboardEvent) => void;
  onClearSummon: () => void;

  // ── Account ──
  providers: Provider[];
  onProviders: (next: Provider[]) => void;

  // ── Approval ──
  auto: AutoLevel;
  onAuto: (level: AutoLevel) => void;

  // ── Modules ──
  modules: ModuleLayout;
  onModules: (next: ModuleLayout) => void;
  root: string;
  mcpServers: ServerSpec[];
  mcpTools: Record<string, McpTool[]>;
  mcpError: string | null;
  onToggleServer: (s: ServerSpec) => void;

  // ── Storage ──
  clips: Clip[];
  /**
   * A store has just been emptied.
   *
   * The window is still holding things that were standing on it — the redo
   * button reads the checkpoint store, the recovery banner offers drafts — and
   * a button that leaves those on screen pointing at nothing is worse than no
   * button. The clipboard history arrives here too: it is `localStorage`, so
   * emptying it *is* this call rather than something that follows one.
   */
  onEmptied: (id: StoreId) => void;

  // ── About ──
  update: Available | null;
  updating: number | null | 'done';
  /** Ask the gateway. Resolves once `update` has been set to the answer. */
  onCheckUpdates: () => Promise<void>;
  onInstall: () => void;
}

/** Where the pane starts, and where clearing the search puts you back. */
const FIRST: CategoryId = 'account';

/**
 * The line under the label.
 *
 * Nearly always the catalogue's own `hint`, which is where a sentence about a
 * row belongs. Two rows carry one from here instead, and both pass their
 * sentence to `t` inline rather than through a table. That is on purpose:
 * `i18n.test.mjs` finds a string by matching a call to `t` with a quoted
 * literal in it, so a sentence assembled any other way is one nothing checks
 * has reached Arabic, Sorani and Badini.
 */
function hintFor(row: Setting, t: Props['t']): string | null {
  if (row.hint) return t(row.hint);
  if (row.id === 'gateway') return t('Where model requests go. Change this only if you were told to.');
  if (row.id === 'apiKey') return t('Stored in this app only, on this machine.');
  return null;
}

/**
 * One row: label and its line on the left, control on the right.
 *
 * `wide` is for the three controls that are lists rather than values — the key
 * map, the MCP servers and the safety note. Squeezing a two-column table into
 * the right-hand third produces a column of single words, so those drop under
 * the label and take the width.
 */
function Row({ label, hint, bad, wide, children }: {
  label: string; hint: string | null; bad?: boolean; wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`set-row ${wide ? 'wide' : ''}`}>
      <div className="set-what">
        <span className="set-lbl">{label}</span>
        {/* `bad` is the one row whose line can become a refusal rather than an
            explanation — the OS declining a chord. Muted grey would read as
            advice, which is the opposite of what it is. */}
        {hint && <span className={`set-hint ${bad ? 'bad' : ''}`}>{hint}</span>}
      </div>
      <div className="set-ctl">{children}</div>
    </div>
  );
}

/**
 * One local store: how much it is holding, and the button that empties it.
 *
 * The confirmation names what goes rather than asking about "this data", and
 * every one of the four sentences is about the thing a person is actually
 * afraid of. Emptying drafts does not touch the buffer you are typing in;
 * emptying checkpoints is the one that costs something, because undo stops
 * being able to put files back.
 */
function StoreRow({ id, label, hint, bytes, onEmpty, t }: {
  id: StoreId; label: string; hint: string | null; bytes: number | null;
  onEmpty: () => void; t: Props['t'];
}) {
  const cost =
    id === 'drafts' ? t('Unsaved work in open editors stays where it is; only the copy that would survive a crash goes.')
    : id === 'checkpoints' ? t('Undo stops being able to put those files back. The files themselves are not touched.')
    : id === 'fileHistory' ? t('Every earlier version this app kept goes. The files themselves are not touched.')
    : t('Everything you pasted into Vylo is forgotten. Nothing else is touched.');

  return (
    <Row label={label} hint={hint}>
      <div className="set-pair">
        {/* An em dash until the walk answers. `usage` returns null rather than
            zero for exactly this moment: "0 B" would be a claim about somebody's
            disk that nothing has measured yet. */}
        <span className="set-size">{bytes === null ? '—' : human(bytes)}</span>
        <button
          className="ghost set-btn"
          disabled={bytes === 0}
          onClick={() => void (async () => {
            if (!await ask.confirm({ title: t('Empty this store?'), body: `${label}\n\n${cost}`,
                                     confirmLabel: t('Empty'), danger: true })) return;
            onEmpty();
          })()}
        >
          {t('Empty')}
        </button>
      </div>
    </Row>
  );
}

export function SettingsPanel(props: Props) {
  const { t, onClose, initial } = props;
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CategoryId>(initial ?? FIRST);
  const { rail, pane, selected: showing } = view(query, selected, t);

  /**
   * The three directories, walked while the Storage tab is on screen and again
   * after anything is emptied.
   *
   * Here rather than in each row, and once rather than four times: it is a real
   * walk of a real store, and four rows each asking for the whole answer would
   * be four walks to draw one screen. Not fetched when the dialog opens either
   * — most people never open this tab.
   */
  const [sizes, setSizes] = useState<Sizes | null>(null);
  const [walked, setWalked] = useState(0);
  const storage = pane?.category.id === 'storage';
  useEffect(() => {
    if (!storage) return;
    let live = true;
    void invoke<Sizes>('store_sizes')
      .then((s) => { if (live) setSizes(s); })
      // No app data directory to walk is not worth an error in a settings
      // dialog. The row shows an em dash and the button still works.
      .catch(() => { if (live) setSizes(null); });
    return () => { live = false; };
  }, [storage, walked]);

  // What the clipboard history takes. It is `localStorage` rather than a
  // directory — see `stores.ts` — so this window is the only thing that can
  // measure it, and what it holds is exactly this string.
  const clipBytes = useMemo(() => clipboardBytes(props.clips), [props.clips]);

  function empty(id: StoreId) {
    if (!isOnDisk(id)) { props.onEmptied(id); return; }
    void invoke('store_empty', { storeId: id })
      .then(() => props.onEmptied(id))
      // Walk again either way. A failure leaves the store as it was, and the
      // figure on screen should be the one that is true now rather than the
      // one from before a button that did nothing.
      .finally(() => setWalked((n) => n + 1));
  }

  // Send focus back where it came from. Closing an overlay and dropping the
  // caret at the top of the document is the difference between a keyboard user
  // continuing and starting again. Same as `Palette.tsx`'s Shell.
  const came = useRef<Element | null>(null);
  useEffect(() => {
    came.current = document.activeElement;
    return () => { (came.current as HTMLElement | null)?.focus?.(); };
  }, []);

  // Escape works wherever focus is inside the dialog, not only in the search
  // field. Arrowing into the rail used to leave no way out but the mouse.
  const escape = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className="set-back" onMouseDown={onClose}>
      <div className="set" role="dialog" aria-modal="true" aria-label={t('Settings')}
           onMouseDown={(e) => e.stopPropagation()} onKeyDown={escape}>
        <button className="set-x" onClick={onClose} title={t('Close')} aria-label={t('Close')}>
          <Icon name="close" size={15} />
        </button>

        <nav className="set-rail" aria-label={t('Sections')}>
          {/* Named as well as prompted: a placeholder disappears the moment
              anything is typed, so it is a hint and never a label. */}
          <input className="set-find" value={query} autoFocus spellCheck={false}
                 placeholder={t('Search settings…')} aria-label={t('Search settings…')}
                 onChange={(e) => setQuery(e.target.value)} />
          <span className="set-cap">{t('Settings')}</span>
          {rail.map(({ category, hits }) => (
            <div key={category.id} className={category.foot ? 'set-foot' : undefined}>
              {/* Dimmed, never removed. A rail whose rows disappear as you type
                  jumps under the cursor, and the row you were about to click is
                  not the one you hit. */}
              <button
                className={`set-cat ${showing === category.id ? 'on' : ''} ${hits ? '' : 'nil'}`}
                disabled={hits === 0}
                aria-current={showing === category.id ? 'page' : undefined}
                onClick={() => setSelected(category.id)}
              >
                <Icon name={category.icon} size={19} />
                <span className="set-cat-t">{t(category.label)}</span>
              </button>
            </div>
          ))}
        </nav>

        <div className="set-pane">
          {pane === null ? (
            <p className="set-none">{t('Nothing in settings matches that.')}</p>
          ) : (
            <>
              <h2 className="set-head">{t(pane.category.label)}</h2>
              {pane.rows.map((row) => (
                <Control key={row.id} {...props} row={row}
                         sizes={sizes} clipBytes={clipBytes} onEmpty={empty} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** What one row needs beyond the panel's own props. */
interface ControlProps extends Props {
  row: Setting;
  sizes: Sizes | null;
  clipBytes: number;
  onEmpty: (id: StoreId) => void;
}

/**
 * The control for one row.
 *
 * A component rather than a function returning markup, because two of the cases
 * keep state of their own — the version, and whether an update check has been
 * asked for — and a hook cannot live inside a `switch`.
 */
function Control({ row, ...p }: ControlProps) {
  const { t } = p;
  const label = t(row.label);
  const hint = hintFor(row, t);

  const [version, setVersion] = useState('');
  useEffect(() => {
    if (row.id !== 'version') return;
    let live = true;
    void getVersion().then((v) => { if (live) setVersion(v); }).catch(() => {});
    return () => { live = false; };
  }, [row.id]);

  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);

  switch (row.id) {
    // ── Account ──
    case 'gateway':
      return (
        <Row label={label} hint={hint}>
          {/* The label is a sibling span rather than a <label for>, because a
              label forwards a click on its own text to its control -- which the
              shortcut recorder below cannot have. So the name is given here. */}
          <input className="set-in" value={p.baseUrl} spellCheck={false}
                 aria-label={label} onChange={(e) => p.onBaseUrl(e.target.value)} />
        </Row>
      );
    case 'apiKey':
      return (
        <Row label={label} hint={hint}>
          <input className="set-in" type="password" value={p.apiKey} placeholder="sk-vylo-…"
                 spellCheck={false} aria-label={label}
                 onChange={(e) => p.onApiKey(e.target.value)} />
        </Row>
      );
    case 'signedIn':
      // Not signed in is a *state to leave*, not a fact to report. Until this
      // carried a button the only sign-in form was on the welcome screen, which
      // nobody sees once a folder is open and a key is saved — so the feature
      // existed and was unreachable by anyone who already had a key, which is
      // everyone who had used the app before it shipped.
      return (
        <Row label={label} hint={hint}>
          {p.token
            ? <span className="set-val">{p.signedInAs || t('Signed in')}</span>
            : (
              <button className="ghost set-btn" onClick={p.onSignIn}>
                {t('Sign in')}
              </button>
            )}
        </Row>
      );
    case 'signOut':
      // Signing out clears the session and *not* the API key. The key was
      // minted for this machine and still works; throwing it away because
      // somebody pressed a button labelled Sign out would take their model
      // access with it. The hint on this row says so, because that is the fear
      // that stops people pressing it.
      return (
        <Row label={label} hint={hint}>
          <button className="ghost set-btn" disabled={!p.token} onClick={p.onSignOut}>
            {t('Sign out')}
          </button>
        </Row>
      );
    case 'plan':
      return (
        <Row label={label} hint={hint}>
          <span className="set-val">
            {/* Three states, not two. `chip` answers null both for somebody who
                pasted a key and never signed in — still the majority path — and
                for a signed-in account the server described in a way that
                carries no figure. Telling the second they are not signed in
                would be a plain lie, so that one draws nothing at all. */}
            {p.plan ? (
              <>
                <b>{p.plan.name ?? t('No plan')}</b>
                {p.plan.tail === 'left' ? ` · ${p.plan.left} ${t('left')}`
                  : p.plan.tail === 'no-limit' ? ` · ${t('no limit')}` : ''}
              </>
            ) : p.token ? '—' : t('Not signed in')}
          </span>
        </Row>
      );

    // ── Appearance ──
    case 'theme':
      return (
        <Row label={label} hint={hint}>
          <select className="set-sel" value={p.theme} aria-label={label}
                  onChange={(e) => p.onTheme(e.target.value as Theme)}>
            <option value="system">{t('Match system')}</option>
            <option value="light">{t('Light')}</option>
            <option value="dark">{t('Dark')}</option>
          </select>
        </Row>
      );
    case 'language':
      return (
        <Row label={label} hint={hint}>
          <select className="set-sel" value={p.lang} aria-label={label}
                  onChange={(e) => p.onLang(e.target.value as Lang)}>
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </Row>
      );

    // ── Editor ──
    case 'inlineCompletion':
      return (
        <Row label={label} hint={hint}>
          <select className="set-sel" value={p.autocomplete ? 'on' : 'off'} aria-label={label}
                  onChange={(e) => p.onAutocomplete(e.target.value === 'on')}>
            <option value="on">{t('On — suggest as I type, Tab to accept')}</option>
            <option value="off">{t('Off')}</option>
          </select>
        </Row>
      );

    // ── Notifications ──
    case 'notifyWhen':
      return (
        <Row label={label} hint={hint}>
          <select className="set-sel" value={p.notify.level} aria-label={label}
                  onChange={(e) => p.onNotify({ level: e.target.value as NotifyLevel })}>
            <option value="needed">{t('When the agent needs me')}</option>
            <option value="all">{t('For everything, including when a turn ends')}</option>
            <option value="off">{t('Off')}</option>
          </select>
        </Row>
      );
    case 'notifySound':
      return (
        <Row label={label} hint={hint}>
          <select className="set-sel" value={p.notify.sound ? 'on' : 'off'} aria-label={label}
                  onChange={(e) => p.onNotify({ sound: e.target.value === 'on' })}>
            <option value="off">{t('Off')}</option>
            <option value="on">{t('On')}</option>
          </select>
        </Row>
      );

    // ── Shortcuts ──
    case 'globalShortcut':
      return (
        <Row label={label} hint={p.summonErr ? t(p.summonErr) : hint} bad={!!p.summonErr}>
          <div className="set-pair">
            {/* A button and not a label-wrapped field: a label forwards a click
                on its own text to the control, and the recorder would toggle
                twice. Recording is a mode, and a mode you cannot see is a
                keystroke going somewhere you did not expect. */}
            <button type="button"
                    className={`sc-key ${p.recording ? 'rec' : ''} ${p.summon ? '' : 'unset'}`}
                    aria-pressed={p.recording}
                    onClick={() => p.onRecording(!p.recording)}
                    onKeyDown={(e) => { if (p.recording) p.onSummonKey(e); }}
                    onBlur={() => p.onRecording(false)}>
              {p.recording ? t('Press a combination…')
                : p.summon ? chordLabel(p.summon, IS_MAC) : t('Not set')}
            </button>
            {p.summon && !p.recording && (
              <button type="button" className="ghost set-btn" onClick={p.onClearSummon}>
                {t('Clear')}
              </button>
            )}
          </div>
        </Row>
      );
    case 'keyMap':
      // `Welcome.tsx` already renders the key map, and it is the same list on
      // both screens. Two of them would drift the day one shortcut changed.
      return (
        <Row label={label} hint={hint} wide>
          <Shortcuts t={t} columns={2} />
        </Row>
      );

    case 'providers':
      return (
        <Row label={label} hint={hint} wide>
          <ProviderList providers={p.providers} onChange={p.onProviders} t={t} />
        </Row>
      );

    // ── Approval ──
    case 'autoApprove':
      return (
        <Row label={label} hint={hint} wide>
          <div className="ap">
            {LEVELS.map((lv) => (
              <label key={lv} className={`ap-row ${p.auto === lv ? 'on' : ''} ${lv === 'all' ? 'far' : ''}`}>
                <input type="radio" name="auto" checked={p.auto === lv}
                       onChange={() => p.onAuto(lv)} />
                <span>
                  <b>{t(LEVEL_LABEL[lv])}</b>
                  <em>{t(LEVEL_ABOUT[lv])}</em>
                </span>
              </label>
            ))}
          </div>
        </Row>
      );

    // ── Modules ──
    case 'modules':
      return (
        <Row label={label} hint={hint} wide>
          <ModuleList layout={p.modules} onChange={p.onModules} t={t} />
        </Row>
      );

    case 'railSide':
      return (
        <Row label={label} hint={hint}>
          <RailSide layout={p.modules} onChange={p.onModules} t={t} />
        </Row>
      );

    case 'mcpServers':
      return (
        <Row label={label} hint={hint} wide>
          {p.mcpError && <p className="mcp-err">{p.mcpError}</p>}
          {p.mcpServers.length === 0 && !p.mcpError && (
            <p className="set-val">{p.root ? t('None') : t('No folder')}</p>
          )}
          {p.mcpServers.map((sv) => {
            const on = isEnabled(p.root, sv);
            const tools = p.mcpTools[sv.name];
            return (
              <div className={`mcp-row ${on ? 'on' : ''}`} key={sv.name}>
                <div className="mcp-what">
                  <b>{sv.name}</b>
                  {/* The exact command, before the button that runs it. */}
                  <code>{commandLine(sv)}</code>
                  {Object.keys(sv.env ?? {}).length > 0 && (
                    <span className="mcp-env">{t('sets')} {Object.keys(sv.env ?? {}).join(', ')}</span>
                  )}
                  {on && tools && (
                    <span className="mcp-tools">
                      {tools.length} {tools.length === 1 ? t('tool') : t('tools')}
                    </span>
                  )}
                </div>
                <button className={on ? 'ghost' : 'approve'} onClick={() => p.onToggleServer(sv)}>
                  {on ? t('Disable') : t('Enable')}
                </button>
              </div>
            );
          })}
        </Row>
      );

    // ── Storage ──
    case 'drafts':
    case 'checkpoints':
    case 'fileHistory':
    case 'clipboardHistory': {
      // Bound rather than read twice: the switch narrows `row.id` here, and
      // that narrowing does not survive into the closure below.
      const id: StoreId = row.id;
      return (
        <StoreRow id={id} label={label} hint={hint} t={t}
                  bytes={usage(id, p.sizes, p.clipBytes)}
                  onEmpty={() => p.onEmpty(id)} />
      );
    }

    // ── About ──
    case 'version':
      return (
        <Row label={label} hint={hint}>
          <span className="set-val set-mono">{version || '—'}</span>
        </Row>
      );
    case 'updates':
      return (
        <Row label={label} hint={hint}>
          <div className="set-pair">
            {p.update ? (
              <>
                <span className="set-val set-mono">{p.update.version}</span>
                <button className="approve set-btn" disabled={p.updating !== null}
                        onClick={p.onInstall}>
                  {p.updating === null ? t('Install and restart')
                    : p.updating === 'done' || p.updating === 100 ? t('Restarting…')
                    : typeof p.updating === 'number' ? `${p.updating}%` : t('Downloading…')}
                </button>
              </>
            ) : (
              <>
                {checked && !checking && <span className="set-val">{t('Up to date')}</span>}
                <button className="ghost set-btn" disabled={checking} onClick={() => {
                  setChecking(true);
                  // A failed check never raises anything: `checkForUpdate`
                  // answers null when it is offline, and "up to date" is the
                  // honest reading of "nothing was offered".
                  void p.onCheckUpdates().finally(() => { setChecking(false); setChecked(true); });
                }}>
                  {checking ? t('Checking…') : t('Check now')}
                </button>
              </>
            )}
          </div>
        </Row>
      );
    case 'safety':
      // The rule the whole design rests on, in the one place somebody looking
      // for it would look. Naming the document is not enough on its own: it is
      // in the repository rather than in the app, so the sentence has to be
      // here for the row to be worth opening.
      return (
        <Row label={label} hint={hint} wide>
          <p className="set-quote">
            {t('No model output reaches disk or a shell without a human having read and approved that exact content or string.')}
          </p>
          <p className="set-val set-mono">SAFETY.md</p>
        </Row>
      );

    default: {
      // Exhaustive. A catalogue entry with no control here is a type error,
      // rather than a row that renders as nothing and is noticed in a
      // screenshot months later.
      const unhandled: never = row.id;
      return unhandled;
    }
  }
}
