import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Dictation, OFF as NOT_DICTATING, browserOpen, insert as insertSpoken,
  recognitionLang, speechAvailable, type State as DictState,
} from './dictate';
import {
  runAgent, HopLimit, MAX_HOPS, Stopped, type Mode,
  type Block, type CommandRequest, type CommandResult, type Msg, type RunChoice,
} from './agent';
import {
  attachAnyPath, attachFromFile, describe, isImage, isText, listenForDrops,
  pickAttachments, previewUrl, textBlock, toImageBlock, type Attached, isDoc, toDocBlock} from './attachments';
import { diffstat, isEmpty as noChanges, type DiffStat } from './diffstat';
import { Pending, type Change } from './pending';
import { Review } from './Review';
import { invoke } from '@tauri-apps/api/core';
import { storedLang, storeLang, translator, type Lang, fill} from './i18n';
import { checkForUpdate, type Available } from './updates';
import { Markdown } from './Markdown';
import {
  ago, chatsIn, deleteChat, folders, newChatId, saveChat, titleFrom,
  type Chat, type Line as SavedLine,
} from './store';
import { memoryPrompt, readMemory, type Memory } from './memory';
import { environmentPrompt, readEnvironment } from './environment';
import { MemoryEditor } from './MemoryEditor';
import { FileHistory } from './FileHistory';
import { Chats } from './Chats';
import { cutPoints, redoTarget } from './checkpoints';
import {
  SelfWrites, mergeAsks, plan as diskPlan, start as watchFolder,
  type Batch as DiskBatch, type Change as DiskChange,
} from './watch';
import { FileTree, type Entry } from './FileTree';
// CodeMirror is a few hundred KB and the chat tab needs none of it, so the
// editor loads the first time a file is opened.
const Editor = lazy(() => import('./Editor'));
import type { EditorHandle } from './Editor';
import type { CompleteStatus } from './complete';
import { Everything, FindInFiles, QuickOpen, Symbols, type Symbol as Sym } from './Palette';
import type { CategoryId } from './settings';
import { NO_NAV, back, canBack, canForward, forget, forward, visit, type Nav } from './nav';
import { keepExisting, loadWorkspace, saveWorkspace, type Workspace } from './workspace';
import { move } from './reorder';
import { useReorder } from './useReorder';
import type { Session } from './terminals';
import { groupLines, ToolRun } from './ToolRun';
// xterm is the largest thing in the bundle and the panel starts closed, so it
// is fetched the first time someone actually opens a terminal.
const TerminalPanel = lazy(() => import('./TerminalPanel'));
import { Icon } from './Icon';
import { Rail } from './Rail';
import {
  KEY as MODULES_KEY, OLD_KEY as OLD_MODULES_KEY, dock as dockModule, dockOf, docked,
  enabled as enabledModules, labelOf, migrate as migrateModules, railFirst,
  toggle as toggleModule, write as writeModules,
  type Layout as ModuleLayout, type ModuleId,
} from './modules';
import { SettingsPanel } from './SettingsPanel';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import {
  KEY as ZOOM_KEY, NORMAL as ZOOM_NORMAL, canGrow, canShrink, larger, percent as zoomPercent,
  read as readZoom, smaller, write as writeZoom,
} from './zoom';
import {
  applyMention, findMentions, folderListing, mentionQuery, treeResolver, TERMINAL,
} from './mentions';
import { rank } from './fuzzy';
import {
  NO_QUEUE, convo, drain, interrupts, isFull, isStale,
  add as enqueue, clear as clearQueue, list as queued, merge as mergeQueued,
  remove as unqueue, type Queue, type SendMode,
} from './queue';
import {
  clear as clearClips, history as clipHistory, localClips, preview as clipPreview,
  privateField, remember as rememberClip, shortened, type Clip,
} from './clips';
import { detailOf, explain } from './errors';
import { add, NO_USAGE, summarise, compact, total, type Usage } from './usage';
import { replaceAll } from './replace';
import {
  isEnabled, listServers, setEnabled, startServer, stopServer, toSchema,
  type McpTool, type ServerSpec,
} from './mcp';
import { applyMessages, applyTarget, parseApply } from './apply';
import { askRaw } from './inline';
import { ALT, IS_MAC, MOD, Shortcuts, Welcome } from './Welcome';
import {
  allows, plans,
  forgetToken, loadToken, me, planSummary, saveToken, signOut,
  type PlanOffer, type PlanSummary } from './account';
import { MODELS } from './models';
import { adopted, chip, signedOut } from './session';
import { TrafficLights, rehideNativeButtons } from './TrafficLights';
import { TodoPanel } from './TodoPanel';
import { Working } from './Working';

/** The three ways of working. See `space` in App. */
/**
 * How much wheel makes one step of zoom.
 *
 * About one notch of a mouse wheel, which is the unit people expect a notch to
 * move. A trackpad pinch sends much smaller deltas and so takes several events
 * per step, which is what makes a pinch feel continuous rather than jumpy.
 */
const WHEEL_RUNG = 40;

/**
 * How wide each sidebar starts, and what double-clicking its edge goes back
 * to. Named rather than written twice: the first run and the reset have to
 * agree, or "put it back" puts it somewhere it has never been.
 */
const SIDEBAR_W = 248;
const RIGHT_W = 300;

/** How far an arrow key moves a divider. A visible step, not a nudge. */
const DIVIDER_STEP = 16;
/** The range either sidebar may be dragged to. */
const SIDE_MIN = 180;
const SIDE_MAX = 560;

/** What counts as a zoom key. See the handler for why there are five. */
const ZOOM_KEYS = new Set(['+', '=', '-', '_', '0']);

/**
 * Where you are working: the folder, a conversation, or the shell.
 *
 * There was a fourth, Agent, and it went because it was not a place. It
 * opened the Dashboard module in the rail over the same folder Code shows —
 * and when that module was switched off, which is its default, it opened
 * whatever module happened to be first, which is to say it did nothing. The
 * Dashboard is a section of the sidebar and the rail is how you get to it.
 *
 * It also cost more than it gave. "Agent" named this space *and* the mode in
 * the composer, and the two are unrelated: one is which panels are on screen,
 * the other is whether the next message may write to your disk. Somebody in
 * the Agent space, in Chat mode, was told by the model to "switch to Code
 * mode" — correct, and unfollowable, because the control saying Agent was not
 * the control that needed changing.
 */
type Space = 'code' | 'chat' | 'terminal';
import { OutlinePanel } from './OutlinePanel';
import { KEY as TERMS_KEY, bytes as termBytesOf } from './scrollback';
import { PromptsPanel } from './PromptsPanel';
import { PluginsPanel } from './PluginsPanel';
import { RoutinesPanel } from './RoutinesPanel';
import { DashboardPanel } from './DashboardPanel';
import {
  KEY as ROUTINES_KEY, TICK_KEY, adopt as adoptRoutines, due as dueRoutines,
  hold as holdRoutine, holdReason, inFolder as routinesIn, markRun, missedWhileClosed,
  owedNow, read as readRoutines, skip as skipRoutine, write as writeRoutines,
  type LastRun, type Phrase, type Routine,
} from './routines';
import { missedRuns as missedPhrase } from './when';
import { modeFor, parse as parseAgents, systemPromptFor, type Agent } from './agents';
import { watch as watchDoc } from './docs';
import { SkillsPanel } from './SkillsPanel';
import { UsagePanel } from './UsagePanel';
import { WhatsAppPanel } from './WhatsAppPanel';
import { KEY as WA_KEY, read as readWa } from './whatsapp';
import { callerFor } from './whatsappwire';
import { runWhatsAppTool, whatsAppToolsFor } from './whatsapptool';
import { parse as parseSkills, textFor as skillsTextFor, type Skill } from './skills';
import { BrowserPanel } from './BrowserPanel';
import { KEY as BROWSER_KEY, detect as detectUrls, read as readBrowser, recent as recentUrl, write as writeBrowser } from './browser';
import { PushToTalk } from './PushToTalk';
import { KEY as PTT_KEY, read as readPtt, write as writePtt, type Setting as PttSetting } from './ptt';
import { SYSTEM as ASK_SYSTEM, ask as askMessage, parse as parseCommand, reason } from './command';
import { dirFor } from './rtl';
import {
  blobUrl, compareUrl, isOpenable, parseRemote, pullsUrl, repoUrl,
} from './github';
import {
  BUILT_IN, CHOSEN_KEY, KEY as PROVIDERS_KEY, armed, chosen as chosenOf,
  read as readProviders, route as routeOf, write as writeProviders,
  type Chosen, type Provider,
} from './providers';
import { MAX_PANES, prune as prunePanes, toggle as togglePane } from './panes';
import { MIN as MIN_SHARE, after as afterDrag, evened, shares, type Weights } from './split';
import { ContextMenu } from './ContextMenu';
import {
  LEVEL_LABEL, appliesEdits, decide as decideAuto, isOn as autoOn, refusedFor,
  type Level as AutoLevel,
} from './auto';
import type { Item as MenuItem, Point as MenuPoint } from './menu';
import {
  after as tabsAfter, arrange as arrangeTabs, folderOf, isPinned,
  nameOf, nextActive, others as otherTabs, togglePin,
} from './tabs';
import {
  IDLE as NO_PROGRESS, advance as advanceProgress,
  type Event as ProgressEvent, type Progress,
} from './progress';
import { AskHost } from './AskHost';
import * as ask from './ask';
import { SignIn } from './SignIn';
import { listen } from '@tauri-apps/api/event';
import {
  accelerator, bind, chordFrom, isCancel, loadBinding,
  problem, refusal, saveBinding, SUMMONED,
} from './shortcut';
import {
  again, loadPrefs, raise, savePrefs, summons, watchFocus,
  type Moment, type Prefs as NotifyPrefs,
} from './notify';
import {
  applyTheme, isFullscreen, resolved, storeTheme, storedTheme, toggleFullscreen,
  watchSystem, type Theme,
} from './theme';

type Line = SavedLine & { shots?: Attached[] };

/** One checkpoint as `checkpoint_list` reports it. */
type CpMeta = { seq: number; at: number; paths: string[]; undone: boolean; redoable: boolean };

/**
 * Tabs that are not files.
 *
 * `__memory__` and `__todo__` sit on the tab strip and fill the main pane, but
 * they have no path, no editor on the stack, no version history and nothing to
 * save. Every place that asks "is the open tab a file" used to spell the check
 * out, and the list grew a second member the moment the to-do list could fill
 * the window — which is how a copied list starts to drift. One name, one place.
 */
const PSEUDO = new Set(['chat', '__memory__', '__todo__']);

/** True for a tab that is a real path on disk. */
const isFile = (id: string): boolean => !!id && !PSEUDO.has(id);

/** Width of the activity rail, which the sidebar drag has to discount. */
const RAIL_W = 46;

/** Shown in the composer, so the shortcut is learnable without a manual. */
const SEND_KEY = IS_MAC ? '⌘↵' : 'Ctrl+↵';

/**
 * Searches that found something, newest first.
 *
 * The Search panel was two buttons and a sentence in a column the height of the
 * window. What belongs in that space is the thing the panel is about, and the
 * only thing it knows: what has been searched for. Only searches that *matched*
 * are kept — offering back a term that found nothing is offering back a
 * mistake — and only the query, never a result, so nothing about the contents
 * of the folder is written to `localStorage`.
 */
const SEARCHES = 'vylo.searches.v1';
const MAX_SEARCHES = 8;

/**
 * A stored value is input, not memory: `localStorage` is editable by hand, so
 * anything that is not a list of non-empty strings is discarded rather than
 * rendered.
 */
function loadSearches(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SEARCHES) || '[]');
    if (!Array.isArray(raw)) return [];
    const clean = raw.filter((q): q is string => typeof q === 'string' && q.trim().length > 0);
    return [...new Set(clean)].slice(0, MAX_SEARCHES);
  } catch {
    return [];
  }
}

const LS = {
  base: 'vylo.baseUrl',
  key: 'vylo.apiKey',
  model: 'vylo.model',
  root: 'vylo.root',
};
// The session token is deliberately not in LS. It is a credential with its own
// lifetime and its own validation on the way *out* of storage — localStorage is
// editable — so it lives behind `loadToken` / `saveToken` in `account.ts`, under
// `vylo.token`, and is read nowhere else.

/**
 * How often the plan balance is re-read while nothing else is happening.
 *
 * Minutes, deliberately. This is a billing figure, not telemetry. It moves when
 * a turn ends, which is when it is fetched anyway; the timer exists only to
 * catch the account changing somewhere this app cannot see — a plan bought on
 * the website, or tokens spent from another machine. Polling it in seconds
 * would spend the user's own rate limit to tell them nothing new.
 */
const PLAN_EVERY_MS = 5 * 60_000;

/**
 * How many routine chats keep their teammate. See `teammates` in App.
 *
 * A cap and not a lifetime: what it protects against is a session that ran a
 * routine every five minutes for a week, and thirty-two transcripts back is
 * far past anything anybody is still pressing Try again on.
 */
const MAX_TEAMMATES = 32;

/**
 * The last segment of a folder path: what a project is called in one word.
 *
 * For the launch report, which names runs from every project. A row reading
 * "Nightly review" with no idea which of four checkouts it belongs to is the
 * report saying less than it knows; the folder's own name is the shortest
 * thing that answers it. Both separators, because the path comes from the
 * platform's folder picker and Windows uses the other one.
 */
const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** Where the project's agents live. The Routines panel edits it; App reads it. */
const AGENTS_FILE = '.vylo/AGENTS.md';
const SKILLS_FILE = '.vylo/SKILLS.md';

/**
 * The agents in `.vylo/AGENTS.md` as it stands on disk, or none.
 *
 * None for a folder without the file, and none for no folder at all — and
 * none, rather than a thrown error, when the read fails: an unreadable file
 * is the same to a scheduled run as an absent one, and the run says so on
 * its row rather than crashing a tick.
 */
async function readAgents(root: string): Promise<Agent[]> {
  if (!root) return [];
  try {
    const r = await invoke<{ text: string }>('read_for_editor', { root, path: AGENTS_FILE });
    return parseAgents(r.text);
  } catch {
    return [];
  }
}

/** The skills file, read the same way and for the same reason. */
async function readSkills(root: string): Promise<Skill[]> {
  if (!root) return [];
  try {
    const r = await invoke<{ text: string }>('read_for_editor', { root, path: SKILLS_FILE });
    return parseSkills(r.text);
  } catch {
    return [];
  }
}

/**
 * How a turn ended, for the one caller that records it.
 *
 * `converse` catches everything a turn can throw — a stop, the hop cap, a
 * gateway that never answered — because each of those puts a line and a
 * button in the chat rather than crashing the turn. Right for a person, and
 * wrong for a routine, which would see `send` resolve and mark a run that
 * produced an error line as green. So the outcome comes back as a value;
 * every other caller discards it. `error` is the sentence for the row.
 */
type Outcome = { ok: boolean; error?: string };

export function App() {
  // capi is the gateway's own PUBLIC_BASE_URL and what the other Vylo clients
  // use. Both hosts front the same process; when streaming lands, capi needs
  // `flush_interval -1` in its Caddy block the way chat already has.
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem(LS.base) || 'https://capi.vylo-tech.com');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(LS.key) || '');
  // Two secrets, and they are not interchangeable: `apiKey` authenticates
  // `/v1/messages`, `token` authenticates the account API. Neither is ever sent
  // where the other belongs — `account.ts` builds no URL outside `/app/api`,
  // and nothing here hands `token` to `runAgent`, `askRaw` or a transcript.
  const [token, setToken] = useState(() => loadToken(localStorage));
  // Who that token belongs to, for Settings to name. The email is what the
  // person typed, not a secret; the token it came with never leaves the two
  // lines above and below.
  const [signedInAs, setSignedInAs] = useState('');
  // What the plan has left, or null when there is nothing to say. Never
  // rendered as a zero balance — see `planSummary`, which is where the
  // unmetered case is decided.
  const [plan, setPlan] = useState<PlanSummary | null>(null);
  /**
   * What the gateway charges for each plan. Read once per sign-in rather than
   * on the `/me` timer: a price list is not a running total, and refreshing it
   * every few minutes would spend requests against the rate limit it describes.
   */
  const [offers, setOffers] = useState<PlanOffer[]>([]);
  const [model, setModel] = useState(() => localStorage.getItem(LS.model) || 'claude-haiku-4-5');
  /**
   * The providers a person added, and which provider+model is chosen.
   *
   * The gateway is not in the list — it is composed into every read, because
   * it predates the list, its key is managed by sign-in, and a stored copy
   * would be a second value to drift. `model` above stays the *gateway's*
   * model, so removing every provider leaves the app exactly as it was.
   */
  const [providers, setProviders] = useState<Provider[]>(() => readProviders(localStorage.getItem(PROVIDERS_KEY)));
  const [choice, setChoice] = useState<Chosen>(() =>
    chosenOf(localStorage.getItem(CHOSEN_KEY), readProviders(localStorage.getItem(PROVIDERS_KEY)),
      // The same dotted-id repair the `model` effect below applies, because
      // this fallback reads the stored value before that effect has run.
      (localStorage.getItem(LS.model) || 'claude-haiku-4-5').replace(/(\d)\.(\d)/g, '$1-$2')));
  const [root, setRoot] = useState(() => localStorage.getItem(LS.root) || '');
  const [prompt, setPrompt] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  /**
   * Where the turn is, for the line that used to say only "working…".
   *
   * A ref beside the state because the agent's callbacks are created once per
   * turn and fire many times a second while a reply streams; reducing through
   * the ref and setting state from it keeps the reducer honest without every
   * callback having to close over the latest value.
   */
  /**
   * Which editors are drawn at once.
   *
   * Every open file is mounted whichever of them are showing — unmounting one
   * would throw away unsaved edits and its undo history — so this is the same
   * problem the terminal panes solved, and it reuses the same rules: order
   * follows the tab strip, the set is never empty, three is the cap.
   */
  /** Pinned tabs, in pin order. Restored with the folder's other tab state. */
  const [pinned, setPinned] = useState<string[]>([]);
  /** The tab a context menu is open on, and where. */
  const [tabMenu, setTabMenu] = useState<{ path: string; at: MenuPoint } | null>(null);
  /** The remote, and how far this branch has drifted from it. */
  const [remote, setRemote] = useState({ url: '', upstream: '', ahead: 0, behind: 0 });
  /**
   * The user's home directory, so a path can be written `~/work` as a prompt
   * does. Derived from the open folder rather than asked for: every path this
   * app shows is inside it, and `/Users/name` is the first two segments on
   * macOS and `/home/name` on Linux. Empty when it cannot be sure, which only
   * costs a longer path.
   */
  const home = useMemo(() => {
    const m = /^(\/(?:Users|home)\/[^/]+)/.exec(root);
    return m ? m[1] : '';
  }, [root]);
  const [syncing, setSyncing] = useState('');
  /**
   * Whether questions are being answered in advance.
   *
   * Deliberately **not** persisted. A mode that relaxes the one rule the app
   * rests on should not be quietly on the next time the window opens — the
   * person who turned it on knew why, and the person opening the app a week
   * later is not necessarily the same state of mind. Off on every start.
   */
  const [auto, setAuto] = useState<AutoLevel>('off');
  const [shownFiles, setShownFiles] = useState<string[]>([]);
  /** How wide each editor pane is. Same arithmetic as the terminal's — see split.ts. */
  const [edWeights, setEdWeights] = useState<Weights>({});
  const edRow = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState<Progress>(NO_PROGRESS);
  const track = useRef(NO_PROGRESS);
  const note = useCallback((e: ProgressEvent) => {
    track.current = advanceProgress(track.current, e);
    setProgress(track.current);
  }, []);
  // The turn in flight, so it can be stopped. Streaming makes a long turn
  // visible, which makes not being able to interrupt one obvious.
  const abort = useRef<AbortController | null>(null);
  /**
   * Whether a turn is in flight, set *synchronously*.
   *
   * `busy` is React state, so every guard reading it reads the value of the
   * render its closure was made in. The queue drain calls `send`, `setBusy`
   * lands a task later, and the thirty-second tick firing in that gap saw
   * `false`, started a routine, wiped the live turn's chat and called `send`
   * again — whose own `busy` check was the same stale `false`. This is the
   * flag that closes that window: set before the first `await` in `send` and
   * at the top of `converse`, cleared in `converse`'s `finally`, and read by
   * `tick`, `runRoutine` and `send`. `busy` stays, because it is what renders.
   */
  const inFlight = useRef(false);
  /**
   * Whether the turn that just ended left a decision on screen — a failure with
   * Try again, or the hop cap with Continue.
   *
   * Read by the queue drain. Sending a queued message straight after one of
   * those buries the button under a new turn and buys another twelve hops
   * nobody agreed to; the queue waits instead, visible, and goes in after the
   * press that actually finishes the turn. A ref rather than state because
   * nothing renders from it and a render is not wanted when it changes.
   */
  const needsDecision = useRef(false);
  // Index of the reply currently being written to, so deltas append to it
  // instead of each one becoming its own line.
  const openLine = useRef<number | null>(null);
  // How many steps are unticked. A badge saying how many exist would be a
  // number that never changes; the one worth glancing at is what is left.
  const [todoLeft, setTodoLeft] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  /**
   * The settings row a search result chose, or null.
   *
   * `SettingsPanel` starts on `FIRST` and nothing could move it, so a settings
   * row in the one search field would have opened Settings on Account and left
   * the person to find the row themselves — an affordance that does nothing.
   */
  const [settingsAt, setSettingsAt] = useState<CategoryId | null>(null);
  /**
   * The terminal panel's pane list, reported upward so one field can find a
   * session. Empty until the panel has been opened once, which is the honest
   * answer: before that there are no sessions.
   */
  const [sessions, setSessions] = useState<Session[]>([]);
  /** Set by the terminal panel, so a session row can focus a pane. */
  const focusSession = useRef<((id: string) => void) | null>(null);
  // The account form, opened from Settings. It lives outside the settings
  // modal rather than inside it because it takes a password and then replaces
  // two stored credentials — that is a screen, not a row.
  const [signInOpen, setSignInOpen] = useState(false);
  // The global shortcut, and null until somebody sets one -- which is the whole
  // design of it rather than a default nobody got round to choosing. See
  // `shortcut.ts`.
  const [summon, setSummon] = useState<string | null>(() => loadBinding(localStorage));
  const [recording, setRecording] = useState(false);
  /** An English sentence out of `shortcut.ts`, translated where it is drawn. */
  const [summonErr, setSummonErr] = useState('');
  // T2.1. What may interrupt somebody who is in another window, and how loudly.
  const [notifyPrefs, setNotifyPrefs] = useState<NotifyPrefs>(() => loadPrefs(localStorage));
  // Read through a ref where it is used: `askToRun` is handed to `runAgent`
  // once and then held for the length of a turn, so a setting changed during a
  // twelve-hop turn would otherwise not be seen until the next one.
  const notifyNow = useRef(notifyPrefs);
  notifyNow.current = notifyPrefs;
  // Only the window knows whether it is in front, and it starts in front --
  // which is what a window that has just been opened is.
  const focused = useRef(true);
  /** When each kind of summons last went out, so six staged files are one banner. */
  const raised = useRef<Partial<Record<Moment['kind'], number>>>({});
  const [shots, setShots] = useState<Attached[]>([]);

  /**
   * Whether the message box is on screen.
   *
   * It is a third of the height of a short window and most of what somebody
   * reading code wants that height for. Kept as a preference rather than a
   * per-session thing, because somebody who works in the editor for an hour
   * should not have to put it away every time they open the app.
   *
   * The Terminal space hides it regardless — that space is the shell filling
   * the window — so this is the answer for the other three.
   */
  const [askOpen, setAskOpen] = useState(() => localStorage.getItem('vylo.ask') !== '0');
  useEffect(() => {
    try { localStorage.setItem('vylo.ask', askOpen ? '1' : '0'); } catch { /* private mode */ }
  }, [askOpen]);
  /** What the saved terminal sessions take. Re-measured when Settings opens. */
  const [termBytes, setTermBytes] = useState(0);
  const [dragging, setDragging] = useState(false);
  /**
   * The terminal's claim on a drop.
   *
   * Called with the point and the paths; called with `null` paths to ask
   * whether it *would* claim one, which is how the window's overlay knows to
   * stay quiet. A ref because the drop listener is registered once and this
   * changes with every render.
   */
  const termDrop = useRef<((at: { x: number; y: number }, paths: string[] | null) => boolean) | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [git, setGit] = useState<{ is_repo: boolean; branch: string; dirty: number } | null>(null);
  /** `+412 −87`, or null when this is not a repo and there is nothing to say. */
  const [stat, setStat] = useState<DiffStat | null>(null);
  const pending = useRef(new Pending());
  // The command the agent is waiting on, plus the resolver that unblocks it.
  const [askRun, setAskRun] = useState<CommandRequest | null>(null);
  const decide = useRef<((choice: RunChoice) => void) | null>(null);
  // Set by the terminal panel: run an approved string in a visible tab and
  // resolve with what it printed.
  const termRun = useRef<((command: string) => Promise<CommandResult>) | null>(null);
  // Commands the user chose to stop being asked about. Session-only and matched
  // exactly: "always allow npm test" should not quietly also allow "npm test && rm -rf".
  const trusted = useRef(new Set<string>());
  // Files this session actually wrote, so the commit bar offers exactly those
  // rather than whatever else is dirty in the tree.
  const [written, setWritten] = useState<string[]>([]);
  const [commitMsg, setCommitMsg] = useState('');
  const [lang, setLang] = useState<Lang>(() => storedLang());
  const [update, setUpdate] = useState<Available | null>(null);
  const [updating, setUpdating] = useState<number | null | 'done'>(null);
  const [recents, setRecents] = useState(() => folders());
  const [chatId, setChatId] = useState<string>(() => newChatId());
  // Messages typed while a turn is running. Never persisted: a queue means
  // something only while a turn is in flight, and no turn survives a restart.
  const [queue, setQueue] = useState<Queue>(NO_QUEUE);
  /**
   * How many times this chat has been cut out from under itself — a checkpoint
   * undo, or the redo that puts one back.
   *
   * Paired with the chat id it is the token `queue.ts` compares, and it is the
   * half the chat id cannot supply: an undo rewrites the files and truncates
   * the transcript without changing which chat you are in, so a message queued
   * before it would pass a chat-id check and arrive addressed to work that has
   * just been undone.
   */
  const [rev, setRev] = useState(0);
  /** The conversation a message typed right now would be written against. */
  const convoNow = convo(chatId, rev);
  const [chats, setChats] = useState<Chat[]>([]);
  const [memory, setMemory] = useState<Memory>({ file: null, text: '' });
  // The environment block for the system prompt, or '' before a folder is open.
  const [environment, setEnvironment] = useState('');
  const [tree, setTree] = useState<Entry[]>([]);
  const [tabs, setTabs] = useState<string[]>([]);          // open file paths

  /**
   * Dragging a tab to a different place in the strip.
   *
   * There is nothing to persist: the order is this array's own, and the effect
   * that already saves it per folder saves the arrangement with it. Dropping a
   * tab outside the strip is a cancel — nothing in this gesture can close one.
   */
  const tabDrag = useReorder({
    axis: 'x',
    onMove: (from, to) => setTabs((p) => move(p, from, to)),
  });
  const [active, setActive] = useState<string>('chat');    // 'chat' | a path
  const [sidebarW, setSidebarW] = useState(() => Number(localStorage.getItem('vylo.sbw')) || SIDEBAR_W);
  const [theme, setTheme] = useState<Theme>(() => storedTheme());
  const [full, setFull] = useState(false);
  const [showTerm, setShowTerm] = useState(false);
  const [palette, setPalette] = useState<'all' | 'open' | 'find' | 'symbols' | 'fileSymbols' | 'defs' | null>(null);
  // What the search palette opens with. Every route in sets it, so ⌘⇧F always
  // starts on a blank field and only a recent search seeds one.
  const [findSeed, setFindSeed] = useState('');
  const [searches, setSearches] = useState<string[]>(() => loadSearches());
  // The file whose earlier versions are on screen. A path rather than a flag:
  // the panel is about one file, and `active` can move under it.
  const [versionsFor, setVersionsFor] = useState<string | null>(null);
  const [rail, setRail] = useState<ModuleId>(() => (localStorage.getItem('vylo.rail') as ModuleId) || 'files');
  /**
   * Which sections exist, in which order, and which are switched off.
   *
   * `readModules` repairs anything it cannot trust, so a hand-edited or
   * half-written value is the default arrangement rather than a window that
   * will not open.
   */
  // v2 if it is there, otherwise whatever v1 held — see `migrate`. The effect
  // below writes v2 straight back, so this runs once per person, ever.
  const [modules, setModules] = useState<ModuleLayout>(() =>
    migrateModules(localStorage.getItem(MODULES_KEY), localStorage.getItem(OLD_MODULES_KEY)));
  /**
   * The second sidebar: which docked module it shows, whether it is open, and
   * how wide it is. Separate from the rail's own state on purpose — the point
   * of a second sidebar is a panel on each side of the work, and the two must
   * not close each other.
   */
  const [rightRail, setRightRail] = useState<ModuleId | null>(() => (localStorage.getItem('vylo.rrail') as ModuleId) || null);
  const [rightOpen, setRightOpen] = useState(() => localStorage.getItem('vylo.rropen') !== '0');
  const [rightW, setRightW] = useState(() => Number(localStorage.getItem('vylo.rrw')) || RIGHT_W);
  const resizingR = useRef(false);
  /** A rail icon's menu: dock on the other side, or turn the module off. */
  const [railMenu, setRailMenu] = useState<{ id: ModuleId; at: MenuPoint } | null>(null);
  /** Right-click in the file tree. */
  const [fileMenu, setFileMenu] = useState<{ path: string; isDir: boolean; at: MenuPoint } | null>(null);
  const [railOpen, setRailOpen] = useState(() => localStorage.getItem('vylo.railopen') !== '0');
  // The line a search result asked for, cleared once the file is showing so
  // reopening the same file later does not jump again.
  const [jump, setJump] = useState<{ path: string; line: number } | null>(null);
  // Where go-to-definition has been, so there is a way back. Without the back
  // half the jump makes navigating worse, not better.
  const [trail, setTrail] = useState<Nav>(NO_NAV);
  const [symbols, setSymbols] = useState<Sym[]>([]);
  // Clipboard history. Held in state as well as in storage so the composer
  // button can be disabled when there is nothing to offer -- which is also why
  // the picker never has an empty state to design.
  const [clips, setClips] = useState<Clip[]>(() => clipHistory(localClips));
  const [clipsOpen, setClipsOpen] = useState(false);
  /**
   * The window-level key listener is registered once and would otherwise hold
   * the first render's closures — the same trap F3's quit guard fell into.
   * Everything it needs is read through here instead.
   */
  const keys = useRef({ back: () => {}, fwd: () => {}, sym: () => {}, fileSym: () => {}, clips: () => {} });
  const editors = useRef(new Map<string, EditorHandle>());
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  /**
   * Files that changed on disk while they were open *and dirty*.
   *
   * A separate list from `dirty` because it is a question rather than a state:
   * a reload is a full-document replace, so running one against unsaved work
   * destroys it silently. Clean tabs are reloaded without asking and never
   * appear here; see `src/watch.ts`.
   */
  const [asks, setAsks] = useState<DiskChange[]>([]);
  /**
   * Bumped when the watcher says the folder moved.
   *
   * The tree, `git_state` and `git_status` are already effects keyed on the
   * things that change them, and this is one more of those things. Invoking all
   * three by hand from the watcher instead would be the same three calls
   * written a second time, with a second set of cancellation bugs.
   */
  const [diskTick, setDiskTick] = useState(0);
  /**
   * What this app has just written, so the watcher's report of it can be
   * dropped. Without it, saving a file reloads the buffer you are typing in and
   * CodeMirror maps your caret through the replacement to the end of the file.
   */
  const selfWrites = useRef(new SelfWrites());
  /**
   * The folder whose stored tabs have already been read back.
   *
   * `openFolder` clears the tabs before the restore has run, and the effect
   * that persists them fires on that empty list — so without this the stored
   * tabs are erased one frame before they are read. Nothing is written for a
   * folder until its restore has had its say.
   */
  const restoredFor = useRef('');
  /**
   * Caret lines that came back from storage, held until each editor has mounted
   * and can report its own. The editor is lazy and reads its file
   * asynchronously, so there is a window where the only record of where you
   * were is this map.
   */
  const restoredLines = useRef(new Map<string, number>());
  /**
   * The message box's height, once somebody has set it by hand.
   *
   * `null` means what it always did: grow with the text up to a cap. A number
   * means the person dragged the grip, and a box you placed must stay where
   * you put it — auto-grow overriding a deliberate drag is the box moving
   * under your hands. Double-clicking the grip goes back to growing.
   */
  const [cmpH, setCmpH] = useState<number | null>(() => {
    const v = Number(localStorage.getItem('vylo.cmph'));
    return Number.isFinite(v) && v >= 80 ? v : null;
  });
  useEffect(() => {
    try {
      if (cmpH === null) localStorage.removeItem('vylo.cmph');
      else localStorage.setItem('vylo.cmph', String(cmpH));
    } catch { /* private mode */ }
  }, [cmpH]);

  // The box grows with the text up to a point, then scrolls. A fixed three
  // rows meant anything longer than a sentence was written through a slot.
  useEffect(() => {
    const el = composer.current;
    if (!el) return;
    if (cmpH !== null) {
      // Placed by hand: it stays put and the text scrolls inside it.
      el.style.height = `${cmpH}px`;
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [prompt, cmpH]);

  /** Drag the grip on the card's top edge. Up is taller — the box grows upward. */
  function dragComposer(e: React.PointerEvent) {
    const el = composer.current;
    if (!el) return;
    const grip = e.currentTarget as HTMLElement;
    grip.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = el.getBoundingClientRect().height;
    document.body.classList.add('resizing-v');
    const move = (ev: PointerEvent) => {
      const h = Math.round(startH + (startY - ev.clientY));
      setCmpH(Math.min(Math.max(h, 80), Math.round(window.innerHeight * 0.6)));
    };
    const done = () => {
      grip.releasePointerCapture?.(e.pointerId);
      document.body.classList.remove('resizing-v');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', done);
      grip.removeEventListener('pointercancel', done);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', done);
    grip.addEventListener('pointercancel', done);
  }

  const [autocomplete, setAutocomplete] = useState(() => localStorage.getItem('vylo.autocomplete') !== '0');
  const [acStatus, setAcStatus] = useState<CompleteStatus>('idle');
  // The mention being typed. Derived from the caret, never stored alongside the
  // text -- see mentions.ts for why.
  const [mention, setMention] = useState<{ start: number; caret: number; query: string } | null>(null);
  const [mentionPick, setMentionPick] = useState(0);
  // The active terminal's output, for `@terminal`. The panel hands this over
  // when it mounts so the composer can pull rather than the panel having to push.
  const termText = useRef<(() => string) | null>(null);
  // "Pick it from what it prints": opening the dev-server pane reads the
  // terminal for addresses a server announced, so the first one shows without
  // being typed. Only when the pane opens — not on every line the terminal
  // writes — because a pane that changes address on its own is a pane you
  // cannot trust to keep showing the thing you were looking at.
  //
  // An opening is a *transition* into visible, and that is what this tracks:
  // the deps carry `railOpen`/`rightOpen`, and the ref carries the previous
  // answer so only false → true does anything. Depending on them without the
  // transition re-fronted every detected address on every toggle — collapsing
  // a sidebar shows nothing and is not an opening — rewriting the store and,
  // with the pane docked and empty, setting `url` under someone typing in the
  // address field. Dropping them lost the other half: expanding a collapsed
  // sidebar over a server that has started since is an opening too, and
  // neither `rail` nor `rightRail` changed, so that pane came back as empty as
  // it was left. Tracking the previous state gets both, and the same-value
  // return below keeps even a genuine re-open from handing the store or
  // BrowserPanel's `url` effect a change that isn't one.
  const browserWasVisible = useRef(false);
  useEffect(() => {
    // The rail's own two facts, not `shown`/`rightShown`: those are computed
    // further down the render, and a module's dock is exactly what these deps
    // already cover.
    const visible = (rail === 'browser' && railOpen) || (rightRail === 'browser' && rightOpen);
    const opened = visible && !browserWasVisible.current;
    // Written before the early returns, or a run that detects nothing would
    // leave the ref claiming the pane is still shut and the next dep change
    // would read as a second opening.
    browserWasVisible.current = visible;
    if (!opened) return;
    const found = detectUrls(termText.current?.() ?? '');
    if (!found.length) return;
    // Decided out here, and the ref moved out here with it: an updater React
    // may call more than once for one update has to give the same answer every
    // time, and one that both reads and sets the flag would seed on the first
    // call and un-seed itself on the second.
    const seed = !browserSeeded.current;
    if (seed) browserSeeded.current = true;
    setBrowser((b) => {
      const url = b.url ?? (seed ? found[0] : null);
      const recent = [...found].reverse().reduce((acc, u) => recentUrl(acc, u), b.recent);
      const same = url === b.url && recent.length === b.recent.length && recent.every((u, i) => u === b.recent[i]);
      return same ? b : { url, recent };
    });
  }, [rail, rightRail, railOpen, rightOpen]);
  /**
   * The checkpoint redo would put back, or null when nothing is undone.
   *
   * Read from the store rather than kept here, so it survives a restart and a
   * chat switch the same way the undo buttons on the transcript do.
   */
  const [redoable, setRedoable] = useState<{ seq: number; paths: string[] } | null>(null);
  const [mcpServers, setMcpServers] = useState<ServerSpec[]>([]);
  /** Tools from servers that are actually running, namespaced for the model. */
  const [mcpTools, setMcpTools] = useState<Record<string, McpTool[]>>({});
  const [mcpError, setMcpError] = useState<string | null>(null);
  /**
   * The WhatsApp connection, if the panel has one.
   *
   * Read from storage rather than lifted out of `WhatsAppPanel`: the panel owns
   * it, and a turn can start while that panel has never been mounted. Read at
   * the start of each turn, so connecting mid-session gives the agent the tools
   * without a restart, and disconnecting takes them away again.
   */
  const whatsAppConn = useCallback(() => readWa(localStorage.getItem(WA_KEY)), []);
  /**
   * Set when a close was intercepted. Holds what would be lost, so the dialog
   * can name it rather than asking about "unsaved changes" in the abstract.
   */
  const [quitting, setQuitting] = useState<{ dirty: string[]; staged: number; busy: boolean } | null>(null);
  const [quitError, setQuitError] = useState<string | null>(null);
  const [lastTurn, setLastTurn] = useState<Usage>(NO_USAGE);
  const [chatTokens, setChatTokens] = useState<Usage>(NO_USAGE);
  // How much of the model's context the next request would use. Set before
  // every hop, so it reflects the conversation as it actually stands.
  const [ctx, setCtx] = useState<{ used: number; limit: number } | null>(null);
  /** Unsaved buffers from a session that did not end cleanly. */
  const [drafts, setDrafts] = useState<{ path: string; base: string; at: number }[]>([]);
  /** Files the user chose to recover; the editor reads its draft on mount. */
  const [recovering, setRecovering] = useState<Set<string>>(new Set());
  /** Everything git considers changed, whoever changed it. */
  const [tracked, setTracked] = useState<{ path: string; status: string; staged: boolean; untracked: boolean; from: string | null }[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('vylo.mode') as Mode) || 'agent');
  /**
   * Which of the three ways of working the window is arranged for.
   *
   * BridgeMind's central paradigm, adopted because it names something this
   * app already had three of and no word for: **Agent** is teammates on
   * routines, **Code** is terminals and files over a folder, **Chat** is a
   * conversation that is not tied to a project. The switch is a layout and a
   * default, not a lock — every panel is still reachable from the rail.
   */
  /**
   * Routines and the agents they run — Agent mode's state.
   *
   * The routines live in localStorage (they are schedules, not project
   * content); the agents live in `.vylo/AGENTS.md`, and App reads that file
   * itself: on every folder change, and again whenever this app writes it.
   * They used to arrive through the Routines panel, which meant a scheduled
   * run could only find its agent if that panel had been opened this session
   * — a run that depends on which rail the window was left on is not
   * unattended. A run reads the file once more as it starts, for edits that
   * arrived some other way (see `runRoutine`).
   */
  const [routines, setRoutines] = useState<Routine[]>(() => readRoutines(localStorage.getItem(ROUTINES_KEY)));
  const [agentsList, setAgentsList] = useState<Agent[]>([]);
  useEffect(() => {
    // Cleared first: the old folder's agents must not stand in for the new
    // one's, even for the moment the read takes.
    setAgentsList([]);
    let live = true;
    void readAgents(root).then((list) => { if (live) setAgentsList(list); });
    return () => { live = false; };
  }, [root]);
  useEffect(() => watchDoc(AGENTS_FILE, (next) => setAgentsList(parseAgents(next))), []);
  /**
   * The dev-server pane: the address showing and the ones shown before. Kept
   * per machine, not per project — the port a person runs on is a habit.
   */
  const [browser, setBrowser] = useState(() => readBrowser(localStorage.getItem(BROWSER_KEY)));
  /**
   * Whether that pane has already been given an address.
   *
   * `browser.url === null` cannot tell *never opened one* from *cleared it on
   * purpose* — BrowserPanel's empty-field Enter is a deliberate "show
   * nothing" — so the terminal seed above re-filled a pane the person had just
   * emptied. This ref tells them apart: true from the start when a stored
   * address is restored, and set by the seed and by every address the panel
   * reports back, the clearing one included. Declared beside the state it
   * describes rather than beside the effect that reads it, which runs after
   * this line the same way its `setBrowser` call does.
   */
  const browserSeeded = useRef(browser.url !== null);
  useEffect(() => { try { localStorage.setItem(BROWSER_KEY, writeBrowser(browser)); } catch { /* private mode */ } }, [browser]);
  /**
   * Runs that were owed and will not be taken. Reported once, never run.
   *
   * Two scans fill it and both report the same way: the launch scan, over
   * every project's routines, and the folder scan, over the routines of a
   * project as it opens. Every project's, because a skipped run is skipped
   * wherever it belongs — see routines.ts, "A routine belongs to the folder it
   * was made in". Appended rather than replaced, so the second scan of a
   * launch does not swallow the first one's notice.
   */
  const [missedRuns, setMissedRuns] = useState<Routine[]>([]);
  /**
   * The teammate a chat belongs to, keyed by chat id.
   *
   * Keyed by the chat and not by the turn, which is the whole point. It used
   * to be one ref cleared in the run's `finally`, so pressing Try again or
   * Continue on a routine's failed turn re-sent that history with the agent's
   * brief gone from the system prompt and in whatever mode the *person* is in
   * — possibly `agent` with write tools, where the run itself had read only.
   * A routine's chat keeps its teammate for as long as the session does, so a
   * retry is the same request.
   *
   * Two modes, because a retry is not the run. `unattended` is what the
   * scheduler started it with (`ask`, unless auto-approve is on); `attended`
   * is the agent's own, for a press — there is somebody at the approval
   * dialog by definition. `converse` picks by whether a run is in flight.
   *
   * It applies to exactly two turns and no others: the run's own, and a Try
   * again or Continue on it. Being keyed by the chat is what made that easy to
   * get wrong — the entry outlives the run, and `converse` used to find it for
   * *any* turn in that transcript, so a person who opened the run's chat,
   * pressed Ask and typed a question got the agent's own mode (often `agent`,
   * with write tools) and the agent's brief in front of their message, while
   * the toggle said Ask. So the lookup is gated on `routineRun` or the retry
   * flag the two buttons set, and `send` deletes the entry for the chat the
   * moment a person sends their own message into it.
   *
   * A ref, because `converse` reads it inside callbacks created once per turn
   * and nothing renders from it. Bounded, because a session that ran a routine
   * every five minutes for a week should not be holding a thousand briefs.
   */
  const teammates = useRef(new Map<string, { brief: string; unattended: Mode; attended: Mode }>());

  /**
   * The routine whose turn is in flight, with the chat it started in — or null
   * when nothing is running unattended.
   *
   * Three things read it. `askToRun` refuses to spend a person's "Always allow
   * this" on a turn they are not watching, and refuses an MCP tool call
   * outright — which is why `attended` is on it: Run now has somebody at the
   * dialog, the scheduler does not. `converse` finds the turn's teammate by
   * the chat it opened, which the render this closure came from has not been
   * told about yet. And `pickFolder`, `openFolder`, `newChat`, `openChat` and
   * `removeChat` refuse to move the window out from under it: this app has one
   * chat, and switching mid-run left the run streaming onto the new folder's
   * transcript and saved it there under that folder's chat id — the run's own
   * id never got a file, so "Open the last run" was a silent no-op. Refusing
   * loses nothing that Stop does not give back.
   *
   * The folder the run started in was on here too, and is not, because the
   * only use anybody could find for it was to let a switch *back* to that same
   * folder or chat through — and each of those paths clears `history.current`
   * and `lines` on its way, so "you are already here" would throw the live
   * run's transcript away rather than leave it alone. `runRoutine` keeps the
   * folder it captured in a local, which is where the run actually reads it.
   */
  const routineRun = useRef<{ id: string; attended: boolean } | null>(null);

  /**
   * That this turn is a Try again or a Continue, set by those two buttons.
   *
   * The one thing `converse` cannot work out for itself. A retry is the same
   * request as the turn it repeats, so in a routine's chat it has to carry the
   * agent's brief and the agent's mode; a message a person typed into that
   * same chat is a different request and must not. Both arrive as `converse`
   * on the same chat id, so the difference has to be told, and the two press
   * handlers are the only places that know it. Read once at the top of
   * `converse` and cleared there, so nothing inherits it.
   */
  const retrying = useRef(false);

  /**
   * The mode the turn in flight is actually running in, or null between turns.
   *
   * The working line used to render the mode toggle, which is the person's
   * setting and not always the turn's: a routine's run, and a retry of it, go
   * out in the agent's mode. A line that says Ask over a turn holding write
   * tools is worse than no line, so the turn tells it what it got.
   */
  const [turnMode, setTurnMode] = useState<Mode | null>(null);

  const [space, setSpace] = useState<Space>(() => {
    const v = localStorage.getItem('vylo.space.v1');
    // A window closed in the Agent space opens in Code, which is where that
    // space already put you — the same folder, with one more panel open.
    return v === 'chat' || v === 'terminal' ? v : 'code';
  });
  /**
   * The space, for handlers registered once.
   *
   * The window's key bindings are installed on an empty dependency list, so
   * they hold the first render's closures for ever. Anything of theirs that
   * has to know where it is reads it here instead of capturing it.
   */
  const spaceRef = useRef(space);
  spaceRef.current = space;
  useEffect(() => { try { localStorage.setItem('vylo.space.v1', space); } catch { /* private mode */ } }, [space]);
  /**
   * A window closed in the Terminal space reopens in it.
   *
   * The space itself is restored above, but the arrangement it implies is not
   * — the terminal open and filling the window, the sidebars shut — so without
   * this the switcher would say Terminal over a Code layout, which is a window
   * in two states at once. Once, on mount, through the same path the button
   * uses, so there is one description of what Terminal means.
   */
  useEffect(() => { if (spaceRef.current === 'terminal') goTo('terminal'); }, []);
  useEffect(() => { try { localStorage.setItem(ROUTINES_KEY, writeRoutines(routines)); } catch { /* private mode */ } }, [routines]);
  /**
   * The routines of the folder that is open — what both panels are given.
   *
   * The list is one list for the whole app, but a routine names its agent by a
   * slug from one project's `.vylo/AGENTS.md` and the starter file gives every
   * project a `## Reviewer`: unfiltered, project A's "Nightly review" ran in
   * project B against B's heading of the same name, in B's mode, with A's
   * brief. See routines.ts, "A routine belongs to the folder it was made in".
   */
  const myRoutines = useMemo(() => routinesIn(routines, root), [routines, root]);
  /**
   * The open folder's share of the missed-run notice.
   *
   * The transcript report names every project's, each foreign one labelled
   * with its folder; the dashboard row is `{name} · {schedule}` with nowhere
   * to put a label, and a list of names from projects that are not open is
   * exactly the notice a person cannot act on. So the panel gets this one.
   */
  const missedHere = useMemo(() => routinesIn(missedRuns, root), [missedRuns, root]);
  /**
   * Put the open folder's list back, leaving every other folder's alone.
   *
   * The panel is handed a filtered list and hands back a filtered list, so a
   * plain `setRoutines` would delete every other project's routines the first
   * time somebody renamed one. Anything that comes back without a folder was
   * just added — the panel does not know about folders — and is stamped with
   * the one that is open.
   *
   * In place, and that is the point of the map. Rebuilding the list as
   * "everybody else, then this folder" moved this project's rows to the end of
   * storage on every save, so pausing one routine rewrote the order of all of
   * them, and a person switching between two projects watched the file churn
   * for no reason. Each stored row is replaced where it stands, a row the
   * panel dropped is dropped, and only a genuinely new one is appended.
   */
  const saveRoutines = useCallback((next: Routine[]) => setRoutines((prev) => {
    const stamped = next.map((r) => (r.folder ? r : { ...r, folder: root }));
    const byId = new Map(stamped.map((r) => [r.id, r]));
    const seen = new Set<string>();
    const kept = prev.flatMap((r) => {
      if (r.folder !== root) return [r];
      const now = byId.get(r.id);
      if (!now) return [];
      seen.add(r.id);
      return [now];
    });
    return [...kept, ...stamped.filter((r) => !seen.has(r.id))];
  }), [root]);
  // Hiding the panel must not kill what is running in it -- a dev server you
  // cannot see is still a dev server. So the panel is mounted on first use and
  // stays mounted, hidden, until the last shell is closed.
  const [termMounted, setTermMounted] = useState(false);
  /**
   * How tall the terminal panel opens.
   *
   * 260 was about eleven lines of output, which is enough to see a command
   * finish and not enough to read what it said — so the first thing anybody did
   * was drag it. 380 is around eighteen, which fits a test summary or a stack
   * trace without the drag.
   */
  const [termH, setTermH] = useState(() => Number(localStorage.getItem('vylo.termh')) || 380);
  // Terminal mode: the panel takes the whole work area. Some work is all
  // terminal for a while, and a 260px drawer is the wrong shape for it.
  const [termFull, setTermFull] = useState(() => localStorage.getItem('vylo.termfull') === '1');

  /**
   * How large the window draws itself.
   *
   * The *webview's* zoom rather than a CSS transform, and that is a terminal
   * decision: CSS zoom scales xterm's canvas as a bitmap, so every character
   * in the terminal would go soft as soon as anybody made it bigger — which is
   * the one thing somebody enlarging a terminal is trying to fix. Page zoom
   * changes the device pixel ratio instead, so xterm re-renders at the new
   * size and the text stays sharp.
   *
   * Applied on mount as well as on change: the webview does not remember it
   * across launches, and a level that only survived until you closed the
   * window would read as a setting that does not work.
   */
  const [zoom, setZoom] = useState(() => readZoom(localStorage.getItem(ZOOM_KEY)));
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    try { localStorage.setItem(ZOOM_KEY, writeZoom(zoom)); } catch { /* private mode */ }
    // Not fatal, and deliberately quiet. A webview too old for `setZoom`, or a
    // capability that is not granted, means the window stays the size it is —
    // which is a missing convenience, not something to interrupt anybody over.
    void getCurrentWebview().setZoom(zoom).catch(() => {});
    // For the one measurement on this window that is *not* in CSS pixels — see
    // `.mac .tl` in styles.css, which divides by this so the clearance from
    // macOS's window-button hover zone stays the same size the OS draws it.
    document.documentElement.style.setProperty('--zoom', String(zoom));
  }, [zoom]);

  /**
   * Ctrl and the wheel, which is also a trackpad pinch.
   *
   * A pinch on a Mac trackpad arrives as a wheel event with `ctrlKey` set —
   * the browsers' long-standing convention — so one handler covers both
   * gestures without asking the OS anything, and ⌘ is deliberately not
   * included because ⌘-wheel means nothing anywhere.
   *
   * Stepped on an accumulated delta rather than per event. A mouse notch is
   * about 100 and a pinch arrives in ones and twos: a rung per event would
   * make the wheel feel right and the pinch run the whole ladder in a
   * heartbeat, and a rung per notch-sized threshold makes both move at the
   * speed of the hand.
   *
   * Capturing and stopping it as well as preventing the default: underneath
   * this are a terminal and an editor that both scroll on a wheel, and zooming
   * while the page slides away is two gestures for one movement.
   */
  useEffect(() => {
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      acc += e.deltaY;
      while (Math.abs(acc) >= WHEEL_RUNG) {
        const inwards = acc < 0;
        acc -= inwards ? -WHEEL_RUNG : WHEEL_RUNG;
        setZoom((z) => (inwards ? larger(z) : smaller(z)));
      }
    };
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => window.removeEventListener('wheel', onWheel, { capture: true });
  }, []);
  const sizingTerm = useRef(false);
  const work = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const resizing = useRef(false);

  // Dictation. The control is only drawn where the webview has a speech engine
  // at all -- WKWebView and WebView2 do not both have one -- because an
  // affordance that cannot work is worse than no affordance, the same reason
  // D6 shipped without a mention button.
  const canDictate = useMemo(() => speechAvailable(), []);
  const [dict, setDict] = useState<DictState>(NOT_DICTATING);
  const dictation = useRef<Dictation | null>(null);
  // The engine's callbacks and the silence timer both arrive from outside
  // React, so what they read has to come through a ref: closing over `prompt`
  // and `lang` directly would leave the session working from the state as it
  // was on the render that built it.
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const langRef = useRef(lang);
  langRef.current = lang;

  function ensureDictation(): Dictation {
    if (!dictation.current) {
      dictation.current = new Dictation({
        open: (sink) => browserOpen(recognitionLang(langRef.current, navigator.language))(sink),
        // The only exit from the session: finalised words, into the box, at the
        // caret, for a person to read and send. Nothing recognised runs.
        onText: (said) => {
          // The one door finalised words come through, so it is the one place
          // that can say a session heard anything. See `spoke`.
          spoke.current = true;
          const el = composer.current;
          const caret = el?.selectionStart ?? promptRef.current.length;
          const r = insertSpoken(promptRef.current, caret, said);
          promptRef.current = r.text;
          setPrompt(r.text);
          // After the value changes React puts the caret at the end, which
          // would drop the next phrase somewhere else. Same fix as
          // chooseMention above.
          window.setTimeout(() => {
            composer.current?.focus();
            composer.current?.setSelectionRange(r.caret, r.caret);
          }, 0);
        },
        onState: setDict,
      });
    }
    return dictation.current;
  }
  function dictate() { ensureDictation().toggle(); }

  /**
   * Push-to-talk: hold a key, speak, let go, and the message goes. Off until
   * a person turns it on, and the key is theirs to choose (`ptt.ts`).
   */
  const [ptt, setPtt] = useState<PttSetting>(() => readPtt(localStorage.getItem(PTT_KEY)));
  useEffect(() => { try { localStorage.setItem(PTT_KEY, writePtt(ptt)); } catch { /* private mode */ } }, [ptt]);
  /** Key codes seen going down this session, so Settings offers Fn only where it fires. */
  const [pttSeen, setPttSeen] = useState<string[]>([]);
  /** Set by a push-to-talk release: send the composer once the engine has ended. */
  const sendOnEnd = useRef(false);
  /**
   * Whether the session that just ended delivered any finalised words.
   *
   * The guard used to be `promptRef.current.trim()` alone, which cannot tell
   * *nothing was heard* from *there was already a draft in the box*. A hold
   * that finalises nothing — a press-and-hesitate, a muted microphone, a room
   * too noisy for the engine to resolve a phrase — therefore sent the
   * half-written sentence the person was still composing, because they touched
   * a modifier. Set by `onText`, the one door recognised words come through,
   * and cleared where a push-to-talk press actually opens a session — not on
   * every press, because a press that joins a running session or lands on one
   * still finalising has heard nothing of its own to forget.
   */
  const spoke = useRef(false);
  // A release sends, but only once the engine has finished: the last phrase
  // lands through `onText` before the state reaches 'off', and `send()` reads
  // the box. Calling send() in the same tick as stop() would send the words
  // minus the ones still being finalised.
  //
  // While a turn is running the release takes the fork ⌘↵ takes in the
  // composer's own key handler: into the visible queue, not into `send()`.
  // `send()` refuses a message mid-turn and reports it in an Outcome, and an
  // effect has nowhere to draw one — so the sentence would vanish with no
  // transcript line and no error, the silent drop `queueMessage` exists to
  // prevent. The mic button is disabled while busy; push-to-talk is not, so
  // the key is the only way into this case.
  useEffect(() => {
    if (dict.phase !== 'off' || !sendOnEnd.current) return;
    sendOnEnd.current = false;
    if (!spoke.current || !promptRef.current.trim()) return;
    if (busy) queueMessage('after');
    else void send();
  }, [dict.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // A microphone left open by a component that no longer exists is the one
  // failure nobody can see to fix.
  useEffect(() => () => dictation.current?.dispose(), []);
  // Memoised because `translator()` returns a fresh closure every call, and a
  // `t` with a new identity on every render re-runs the effects of anything
  // that depends on it — several times a second while a turn streams.
  const t = useMemo(() => translator(lang), [lang]);
  const history = useRef<Msg[]>([]);
  const log = useRef<HTMLDivElement>(null);

  // Repair settings saved before either fix, so an existing install is not
  // stuck on a model id that 404s.
  useEffect(() => {
    const fixed = model.replace(/(\d)\.(\d)/g, '$1-$2');
    if (fixed !== model) setModel(fixed);
  }, [model]);

  useEffect(() => { localStorage.setItem(LS.base, baseUrl); }, [baseUrl]);
  useEffect(() => { localStorage.setItem(LS.key, apiKey); }, [apiKey]);
  // Storage follows the state in both directions, so signing out cannot leave a
  // dead token behind for the next launch to load and send.
  useEffect(() => {
    if (token) saveToken(localStorage, token); else forgetToken(localStorage);
  }, [token]);
  useEffect(() => { localStorage.setItem(LS.model, model); }, [model]);
  useEffect(() => { localStorage.setItem('vylo.autocomplete', autocomplete ? '1' : '0'); }, [autocomplete]);
  useEffect(() => { localStorage.setItem('vylo.termfull', termFull ? '1' : '0'); }, [termFull]);
  useEffect(() => { localStorage.setItem('vylo.rail', rail); }, [rail]);
  useEffect(() => { localStorage.setItem(MODULES_KEY, writeModules(modules)); }, [modules]);
  useEffect(() => { try { if (rightRail) localStorage.setItem('vylo.rrail', rightRail); } catch { /* private mode */ } }, [rightRail]);
  useEffect(() => {
    if (!showSettings) return;
    try { setTermBytes(termBytesOf(localStorage.getItem(TERMS_KEY))); } catch { setTermBytes(0); }
  }, [showSettings]);
  useEffect(() => { try { localStorage.setItem('vylo.rropen', rightOpen ? '1' : '0'); } catch { /* private mode */ } }, [rightOpen]);

  // The second sidebar's width, dragged from its divider. Which way the pointer
  // means "wider" depends on which edge it sits against.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!resizingR.current) return;
      const onFarEdge = railFirst(modules.side, dirFor(lang));
      const w = onFarEdge ? window.innerWidth - e.clientX : e.clientX;
      setRightW(Math.min(560, Math.max(200, w)));
    };
    const up = () => {
      if (!resizingR.current) return;
      resizingR.current = false;
      document.body.classList.remove('resizing');
      try { localStorage.setItem('vylo.rrw', String(rightW)); } catch { /* private mode */ }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [rightW, modules.side, lang]);
  useEffect(() => {
    try { localStorage.setItem(PROVIDERS_KEY, writeProviders(providers)); } catch { /* private mode */ }
  }, [providers]);
  useEffect(() => {
    try { localStorage.setItem(CHOSEN_KEY, JSON.stringify(choice)); } catch { /* private mode */ }
  }, [choice]);
  // Keep the gateway's own model in step when it is the one chosen, so every
  // older reader of `model` — and a downgrade — sees what is actually in use.
  useEffect(() => { if (choice.provider === BUILT_IN) setModel(choice.model); }, [choice]);
  /**
   * Everything a request needs: endpoint base, headers' key, dialect, model.
   * One derivation, used by every call site, which is what keeps a provider's
   * key on that provider's URL and nowhere else — see providers.ts.
   */
  const wired = useMemo(() => {
    // route() and nothing else. The review found an earlier version of this
    // memo re-deriving the pair and disagreeing with route()'s fallback — the
    // gateway's URL carrying an empty key — which is exactly the class of bug
    // a second resolver exists to create.
    const r = routeOf(choice, providers, { baseUrl, apiKey, model });
    return { baseUrl: r.baseUrl, apiKey: r.key, wire: r.wire, model: r.model };
  }, [choice, providers, baseUrl, apiKey, model]);

  /**
   * The remote, refreshed with everything else that watches the tree.
   *
   * `ahead`/`behind` are as old as the last fetch, which the strip says rather
   * than implying it just looked — a count that silently means "an hour ago"
   * is worse than one labelled as such.
   */
  useEffect(() => {
    if (!root || !git?.is_repo) { setRemote({ url: '', upstream: '', ahead: 0, behind: 0 }); return; }
    let off = false;
    void invoke<typeof remote>('git_remote', { root })
      .then((r) => { if (!off) setRemote(r); })
      .catch(() => {});
    return () => { off = true; };
  }, [root, git?.is_repo, git?.branch, changes.length, written.length]);

  const origin = useMemo(() => parseRemote(remote.url), [remote.url]);

  /** Open a link, if it is one this app will open at all. */
  function browse(url: string) {
    if (!isOpenable(url)) { push({ kind: 'error', text: t('That link cannot be opened.') }); return; }
    void invoke('open_url', { url }).catch((e) => push({ kind: 'error', text: explain(e, t('open that link')) }));
  }

  /**
   * Push, pull or fetch. A button somebody pressed, so no gate — see git_push.
   *
   * The command is passed in as a call rather than as a name, so every name
   * appears literally at its call site. `orphans.mjs` finds an `invoke` by
   * reading the literal after it, and a name held in a variable reads as a
   * command nothing invokes — and the one allow-list that would have excused
   * that is asserted empty, on purpose.
   */
  async function sync(what: string, go: () => Promise<string>) {
    setSyncing(what);
    try {
      const said = await go();
      push({ kind: 'result', text: said.trim() || t('Done.') });
      setRemote(await invoke('git_remote', { root }));
      // The branch and the dirty count move with a pull, so re-read them too.
      setGit(await invoke('git_state', { root }));
    } catch (e) {
      push({ kind: 'error', text: explain(e, t('reach the remote')) });
    } finally {
      setSyncing('');
    }
  }
  useEffect(() => { localStorage.setItem('vylo.mode', mode); }, [mode]);
  useEffect(() => { localStorage.setItem('vylo.railopen', railOpen ? '1' : '0'); }, [railOpen]);
  useEffect(() => { localStorage.setItem(SEARCHES, JSON.stringify(searches)); }, [searches]);
  useEffect(() => { if (root) localStorage.setItem(LS.root, root); }, [root]);
  useEffect(() => {
    storeLang(lang);
    // Tells the OS text stack which script to shape and which fonts to prefer,
    // and — through `watchLang` in `rtl.ts`, which observes this attribute —
    // which way round to lay the interface out.
    //
    // The comment that stood here said layout stays left-to-right in every
    // language because "only the text runs right-to-left, and the browser does
    // that on its own". Half of that is true: bidi reorders glyphs *within a
    // line*. It does not move the activity rail to the other edge, flip the
    // sidebar, mirror the tab strip, turn the back caret round, or move a
    // `margin-inline-start:auto`. Three of the four languages are right to
    // left, so that was the whole interface on the wrong side for most of the
    // people it was translated for.
    //
    // `dir` is deliberately NOT set here. It is derived from `lang` in one
    // place, so a second call site that sets the language cannot forget the
    // direction — which is exactly how the two came to disagree.
    // `test/rtl.test.mjs` fails if any module but `rtl.ts` writes it.
    document.documentElement.lang = lang;
  }, [lang]);

  /**
   * T3.1 — what the plan has left, before a turn hits the end of it.
   *
   * Today an allowance runs out mid-answer and the first anyone hears of it is
   * a 402 halfway through. `GET /me` has the number, so it is read on launch,
   * again every time a turn ends — `busy` going false is the moment the figure
   * has just changed, and the only moment worth spending a request on — and
   * otherwise on a timer slow enough to be a billing figure rather than a poll.
   *
   * Nothing here is allowed to be fatal. A `/me` that has never succeeded leaves
   * `plan` null and the status bar showing nothing at all — the app has to work
   * perfectly for somebody who pasted a key and never signed in, which is most
   * people today. A refresh that fails after one has succeeded keeps the figure
   * it already had, which is a real number a few minutes old rather than a
   * blank that would read as an allowance gone.
   */
  useEffect(() => {
    if (!token) { setPlan(null); setSignedInAs(''); return; }
    // Not mid-turn. The answer would be out of date the moment the turn ended,
    // and the request would be competing with the one that matters.
    if (busy) return;
    let live = true;
    const ask = () => void me(baseUrl, token).then((r) => {
      if (!live) return;
      if (r.ok) {
        setSignedInAs(r.value.user.email);
        setPlan(planSummary(r.value.usage));
        return;
      }
      // An expired session is a sign-out, not an error banner: the minted key
      // still works, so nothing the person is doing has to stop — they are
      // simply not signed in any more. Clearing the token here runs this effect
      // again, which is what forgets the stored copy and the plan.
      if (r.why.state === 'signed-out') setToken('');
    });
    ask();
    const timer = setInterval(ask, PLAN_EVERY_MS);
    return () => { live = false; clearInterval(timer); };
  }, [token, baseUrl, busy]);

  // The price list, once. Failing is not worth reporting: every card that uses
  // it is written to render without it, so an older gateway simply shows the
  // plan without a price rather than an error about money.
  useEffect(() => {
    if (!token) { setOffers([]); return; }
    let live = true;
    void plans(baseUrl, token).then((r) => { if (live && r.ok) setOffers(r.value); });
    return () => { live = false; };
  }, [token, baseUrl]);

  // Applying on every change rather than only on click also covers the first
  // paint, so the window never flashes the wrong theme on launch.
  /**
   * Anything that puts something in the box opens the box.
   *
   * One rule rather than a call at every site that writes to it — Send to
   * chat, a dropped file, the clipboard history, dictation, an apply from the
   * transcript. Text typed into something nobody can see is the kind of bug
   * that gets reported as "it lost my message", and there is no site that
   * writes to this and means for it to stay hidden.
   */
  const lastWrite = useRef({ prompt, shots });
  useEffect(() => {
    // *Changed*, not *non-empty* — and the difference was a button that did
    // nothing. Written as "there is something in the box, so open the box",
    // with `askOpen` among the dependencies, this ran again the instant the
    // box was hidden and put it straight back: anybody with a half-written
    // message could not close it at all.
    //
    // A write is a write whatever it changes to, so the previous values are
    // remembered rather than tested for emptiness, and `askOpen` is not a
    // dependency: toggling it is not somebody writing into the box.
    const written = prompt !== lastWrite.current.prompt || shots !== lastWrite.current.shots;
    lastWrite.current = { prompt, shots };
    if (written && (prompt.trim() || shots.length)) setAskOpen(true);
  }, [prompt, shots]);

  useEffect(() => { applyTheme(theme); storeTheme(theme); }, [theme]);

  // Following the OS means following it *afterwards* too. The ref keeps the
  // listener reading the current choice without being torn down on each change.
  const themeRef = useRef(theme);
  themeRef.current = theme;
  useEffect(() => watchSystem(() => themeRef.current, () => applyTheme('system')), []);

  // Fullscreen can also be entered from the OS (green button, Ctrl+Cmd+F), so
  // the header reflects the window rather than only our own toggle.
  useEffect(() => {
    void isFullscreen().then(setFull);
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      // macOS is Ctrl+Cmd+F -- both modifiers, deliberately. Accepting either
      // one would swallow Ctrl+F, which is Find on Windows and cursor-forward
      // in every text field on a Mac.
      if (e.key === 'F11' || (e.metaKey && e.ctrlKey && k === 'f')) {
        e.preventDefault();
        void toggleFullscreen().then(setFull);
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && k === 'd') {
        e.preventDefault();
        setTheme((t0) => t0 === 'dark' ? 'light' : 'dark');
      } else if (e.ctrlKey && !e.metaKey && (e.key === '`' || e.key === '~')) {
        e.preventDefault();
        if (e.shiftKey) {
          // Un-maximising is a way out of the Terminal space, the same as the
          // panel's own button — the space is the terminal maximised.
          if (spaceRef.current === 'terminal') { leaveTerminal(); setTermFull(false); setShowTerm(true); }
          else { setTermMounted(true); setShowTerm(true); setTermFull((v) => !v); }
        }
        else toggleTerm();
      } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && k === 'p') {
        e.preventDefault();
        setPalette('all');
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && k === 'v') {
        e.preventDefault();
        keys.current.clips();
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && k === 'f') {
        e.preventDefault();
        openFind();
      } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && k === 'j') {
        // Where VS Code puts the same idea: the panel at the bottom, away and
        // back. Through the ref, because this handler is installed once.
        e.preventDefault();
        setAskOpen((v) => !v);
      } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && k === 's') {
        e.preventDefault();
        void saveActive();
      } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && k === 't') {
        e.preventDefault();
        keys.current.sym();
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && k === 'o') {
        e.preventDefault();
        keys.current.fileSym();
      } else if ((IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)
                 && !e.altKey && ZOOM_KEYS.has(e.key)) {
        /**
         * Bigger, smaller, and back to normal.
         *
         * The platform's own modifier and only that one, which is not
         * pedantry: Ctrl+- on macOS is already Back in this window, bound
         * that way because VS Code binds it that way. Requiring ⌘ on a Mac
         * and Ctrl everywhere else keeps both bindings and needs no
         * exception.
         *
         * `+` and `=` are the same key with and without Shift, and `_` is
         * `-` with it, so all of them count — asking somebody to notice
         * whether they held Shift to reach a plus sign is asking them to
         * think about a keyboard layout.
         */
        e.preventDefault();
        if (e.key === '0') setZoom(ZOOM_NORMAL);
        else if (e.key === '-' || e.key === '_') setZoom(smaller(zoomRef.current));
        else setZoom(larger(zoomRef.current));
      } else if (IS_MAC && e.ctrlKey && !e.metaKey && (e.key === '-' || e.key === '_')) {
        // Back and forward, bound the way VS Code binds them on each platform
        // rather than one invention used on both. ⌥⌘← / ⌥⌘→ — the obvious
        // choice — is previous/next tab everywhere on macOS, and Ctrl+- is zoom
        // out on Windows, so neither works in both places.
        e.preventDefault();
        if (e.shiftKey) keys.current.fwd(); else keys.current.back();
      } else if (!IS_MAC && e.altKey && !e.ctrlKey && !e.metaKey
                 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        if (e.key === 'ArrowRight') keys.current.fwd(); else keys.current.back();
      }
    };
    // resize fires continuously while a window is dragged; each check is an IPC
    // round-trip, so coalesce them rather than firing one per frame.
    let pend: number | undefined;
    const onResize = () => {
      window.clearTimeout(pend);
      pend = window.setTimeout(() => void isFullscreen().then(setFull), 150);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(pend);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // macOS rebuilds the title bar entering and leaving full screen, and its own
  // window buttons come back with it. Hiding them once at startup is not
  // enough.
  useEffect(() => { if (IS_MAC) rehideNativeButtons(); }, [full]);

  // One check on launch, deliberately silent on failure -- an update check is
  // never a good reason to greet someone with an error.
  useEffect(() => { void checkForUpdate().then(setUpdate); }, []);

  // The stored binding is registered here rather than from Rust at startup, so
  // the chord lives in the same localStorage as every other setting and "not
  // set" needs no representation at all.
  useEffect(() => {
    const stored = loadBinding(localStorage);
    if (stored) void bind(stored).catch((e) => setSummonErr(refusal(detailOf(e))));
  }, []);

  // Rust has already raised and focused the window by the time this arrives.
  // The caret is the half only the window can do, because only it knows what is
  // on screen.
  useEffect(() => {
    const stop = listen(SUMMONED, () => composer.current?.focus());
    return () => { void stop.then((off) => off()); };
  }, []);

  // T2.1. Focus is the first thing the policy reads, and it is the *window's*
  // focus rather than the document's: `document.hasFocus()` is a webview's
  // opinion of itself and says nothing about the app being behind three others.
  useEffect(() => watchFocus((f) => { focused.current = f; }), []);

  /**
   * Say that the agent is waiting, if the person is not here to see it.
   *
   * Whether anything fires at all is `notify.ts`; this is only where the app's
   * three facts meet. Nothing about the command, the file or the model's words
   * is passed, because `Moment` has no field for any of them -- a banner that
   * could carry a proposed command would be a shell command approved from the
   * notification centre with the string never on screen.
   *
   * Failing to raise a banner is never a reason to interrupt a turn.
   */
  function raiseSummons(m: Moment) {
    const last = raised.current[m.kind];
    const now = Date.now();
    if (!again(m.kind, last === undefined ? Infinity : now - last)) return;
    const s = summons(m, focused.current, notifyNow.current);
    if (!s) return;
    raised.current[m.kind] = now;
    void raise(s, t, IS_MAC).catch(() => { /* the OS said no; the window is still there */ });
  }

  /** Change one notification setting and store it, like every other one here. */
  function setNotifyTo(patch: Partial<NotifyPrefs>) {
    const next = { ...notifyNow.current, ...patch };
    setNotifyPrefs(next);
    savePrefs(localStorage, next);
  }

  /** Bind `accel`, or release the chord when it is null. Stored only if the OS agreed. */
  async function setSummonTo(accel: string | null) {
    try {
      await bind(accel);
      saveBinding(localStorage, accel);
      setSummon(accel);
      setSummonErr('');
      setRecording(false);
    } catch (e) {
      // Nothing was stored, and Rust has put the previous chord back, so the
      // field still describes what the machine will answer to.
      setSummonErr(refusal(detailOf(e)));
    }
  }

  function recordSummon(e: React.KeyboardEvent) {
    // While the field is recording, no key does its usual job -- ⌘P must not
    // open the palette behind it. `stopPropagation` on the synthetic event
    // stops the native one before the window keydown listener sees it.
    e.preventDefault();
    e.stopPropagation();
    if (isCancel(e.nativeEvent)) { setRecording(false); return; }
    const chord = chordFrom(e.nativeEvent);
    if (!chord) return; // still only modifiers held
    const why = problem(chord);
    if (why) { setSummonErr(why); return; }
    void setSummonTo(accelerator(chord));
  }

  /**
   * Fill the symbol palette when it opens.
   *
   * `defs` is deliberately absent: its list is the candidates for one
   * identifier, set by go-to-definition, and refetching would throw them away.
   *
   * The in-file list comes from the *buffer*, not the index. The index is built
   * from disk, so it would be missing the function you just typed and would
   * still list the one you just deleted — in the palette you opened to jump to
   * it.
   */
  useEffect(() => {
    if ((palette === 'symbols' || palette === 'all') && root) {
      let off = false;
      void invoke<Sym[]>('list_symbols', { root })
        .then((list) => { if (!off) setSymbols(list); })
        .catch(() => { if (!off) setSymbols([]); });
      return () => { off = true; };
    }
    if (palette === 'fileSymbols') {
      const h = isFile(active) ? editors.current.get(active) : null;
      if (!h) { setSymbols([]); return; }
      let off = false;
      void invoke<Sym[]>('symbols_in_text', { path: active, text: h.text() })
        .then((list) => { if (!off) setSymbols(list); })
        .catch(() => { if (!off) setSymbols([]); });
      return () => { off = true; };
    }
  }, [palette, root, active]);

  // The tree is the sidebar's content and also what tells the user the folder
  // actually opened. Reloaded after edits land so new files appear.
  useEffect(() => {
    if (!root) { setTree([]); return; }
    let cancelled = false;
    void invoke<{ entries: Entry[]; skipped: number; truncated: boolean }>(
      'list_tree', { root, maxEntries: 4000 },
    )
      .then((r) => { if (!cancelled) setTree(r.entries); })
      .catch(() => { if (!cancelled) setTree([]); });
    return () => { cancelled = true; };
  }, [root, written, diskTick]);

  /**
   * What one batch from the filesystem watcher means for what is on screen.
   *
   * The decisions are all in `plan`, which is pure and tested; this is only the
   * carrying out. Three of them are worth naming: a clean buffer is reloaded, a
   * dirty one is *asked* about, and a staged proposal is re-based rather than
   * dropped — somebody running `git pull` must not throw away a turn's work.
   */
  async function applyDiskBatch(b: DiskBatch) {
    const p = diskPlan(b, {
      tabs: tabs.filter(isFile).map((path) => ({ path, dirty: dirty.has(path) })),
      staged: pending.current.list().map((c) => c.path),
      ours: selfWrites.current,
    });
    if (p.tree || p.git) setDiskTick((n) => n + 1);
    for (const path of p.reload) await editors.current.get(path)?.reload().catch(() => {});
    for (const path of p.restage) await pending.current.restage(root, path).catch(() => null);
    if (p.restage.length) setChanges(pending.current.list());
    // Clean and gone: nothing to reload and nothing to lose. `closeTab` asks
    // before discarding unsaved work, and a dirty tab is never in this list.
    for (const path of p.close) closeTab(path);
    if (p.ask.length) setAsks((prev) => mergeAsks(prev, p.ask));
  }
  // Reassigned every render. The subscription below is registered once per
  // folder and would otherwise hold the first render's tabs — the same trap the
  // quit guard fell into.
  const disk = useRef(applyDiskBatch);
  disk.current = applyDiskBatch;

  /**
   * Watch the open folder.
   *
   * Vylo ships its own terminal, so `git checkout`, `git pull` and `npm install`
   * all happen inside the app and used to be invisible until the folder was
   * reopened. `watch.rs` canonicalises the root exactly as `resolve` does and
   * refuses anything that is not under it, so a symlink out of the folder
   * cannot become a watch on somebody's home directory.
   *
   * A folder that cannot be watched still opens: this is the push, and every
   * refresh it triggers is also reachable by the actions that already existed.
   */
  useEffect(() => {
    if (!root) return;
    let off: (() => void) | null = null;
    let gone = false;
    void watchFolder(root, (b) => { void disk.current(b); })
      .then((stop) => { if (gone) stop(); else off = stop; })
      .catch(() => { /* a folder that cannot be watched still opens */ });
    return () => { gone = true; off?.(); selfWrites.current.clear(); };
  }, [root]);

  // Sidebar width, dragged from the divider.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!resizing.current) return;
      const w = Math.min(460, Math.max(180, e.clientX - RAIL_W));
      setSidebarW(w);
    };
    const up = () => {
      if (!resizing.current) return;
      resizing.current = false;
      document.body.classList.remove('resizing');
      try { localStorage.setItem('vylo.sbw', String(sidebarW)); } catch { /* private mode */ }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [sidebarW]);

  // Panel height, dragged from the bar above it. Measured against the work
  // area rather than the viewport so the header and composer are not counted.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const box = work.current;
      if (!sizingTerm.current || !box) return;
      const r = box.getBoundingClientRect();
      setTermH(Math.min(Math.max(r.height - 140, 120), Math.max(120, r.bottom - e.clientY)));
    };
    const up = () => {
      if (!sizingTerm.current) return;
      sizingTerm.current = false;
      document.body.classList.remove('resizing-v');
      try { localStorage.setItem('vylo.termh', String(termH)); } catch { /* private mode */ }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [termH]);

  /**
   * Anything left unsaved by a session that did not end cleanly.
   *
   * Offered rather than restored: silently reopening files someone may have
   * abandoned is its own surprise, and the banner says how many there are
   * before anything is reopened.
   */
  useEffect(() => {
    setDrafts([]);
    setRecovering(new Set());
    if (!root) return;
    let cancelled = false;
    void invoke<{ path: string; base: string; at: number }[]>('draft_list', { root })
      .then((d) => { if (!cancelled) setDrafts(d); })
      .catch(() => { /* no drafts is the normal case */ });
    return () => { cancelled = true; };
  }, [root]);

  function recoverDrafts() {
    setRecovering(new Set(drafts.map((d) => d.path)));
    setTabs((p) => [...new Set([...p, ...drafts.map((d) => d.path)])]);
    setActive(drafts[0]?.path ?? 'chat');
    setDrafts([]);
  }

  function discardDrafts() {
    const gone = drafts.map((d) => d.path);
    void invoke('draft_clear', { root, path: null }).catch(() => {});
    setDrafts([]);
    setRecovering((p) => new Set([...p].filter((x) => !gone.includes(x))));
  }

  /**
   * Reopen the files this folder had open, silently dropping the ones that are
   * gone.
   *
   * Silently is the requirement, not a nicety. Files move and are deleted
   * between sessions — by git as much as by anyone — so a stored tab list is a
   * list of guesses, and greeting someone with "could not open src/old.ts"
   * about a file they deleted last week reports their own tidying back to them
   * as a fault.
   *
   * `path_kind` stats and reads nothing, which is what makes probing a dozen
   * paths before the window is useful cheap enough to do. It takes an absolute
   * path and does not go through `resolve()`, and that is sound here because
   * `loadWorkspace` has already dropped anything absolute or climbing out
   * through `..` — the join cannot leave the folder.
   */
  useEffect(() => {
    restoredFor.current = '';
    restoredLines.current.clear();
    if (!root) return;
    let cancelled = false;
    const saved = loadWorkspace(localStorage, root);
    void (async () => {
      const here = new Set<string>();
      for (const tab of saved.tabs) {
        const kind = await invoke<string>('path_kind', { path: `${root}/${tab.path}` })
          .catch(() => 'missing');
        if (kind === 'file') here.add(tab.path);
      }
      if (cancelled) return;
      const ws = keepExisting(saved, (p) => here.has(p));
      for (const tab of ws.tabs) restoredLines.current.set(tab.path, tab.line);
      setPinned(ws.tabs.filter((x) => x.pinned).map((x) => x.path));
      // Step aside if anything was opened while the probes were in flight — a
      // recovered draft, or a click in the explorer. Replacing what someone
      // just asked for with what they had last week is worse than not
      // restoring at all.
      setTabs((prev) => (prev.length ? prev : ws.tabs.map((x) => x.path)));
      setActive((cur) => (cur === 'chat' && ws.active ? ws.active : cur));
      restoredFor.current = root;
      // Write back what actually survived, so a file deleted outside the app is
      // probed once rather than on every launch for ever.
      saveWorkspace(localStorage, root, ws);
    })();
    return () => { cancelled = true; };
  }, [root]);

  /**
   * What to remember: the open files, which one was showing, and where the
   * caret was in each.
   *
   * A pseudo-tab is not a file, so it is not stored — it would be probed and
   * dropped on every launch. The chat is stored as no active file at all.
   */
  const snapshotTabs = (): Workspace => ({
    tabs: tabs.filter(isFile).map((p) => ({
      path: p,
      // A tab that has just been restored has no editor handle yet — the
      // component is lazy and its file is read asynchronously. Falling back to
      // line 1 rather than to what was restored would erase every caret line
      // one render after putting it back.
      line: editors.current.get(p)?.line() ?? restoredLines.current.get(p) ?? 1,
      pinned: isPinned(pinned, p) || undefined,
    })),
    active: isFile(active) ? active : null,
  });

  /**
   * Saved on every tab change, which is also when a caret is worth recording:
   * switching tabs is the moment you leave a file, so the line read here is
   * where you actually were in it. The caret in the tab still on screen moves
   * without either list changing, and is caught by the close handler below.
   *
   * Through a ref for the same reason the quit guard is: the close listener is
   * registered once and would otherwise hold the first render's tabs.
   */
  const keepTabs = useRef(() => {});
  keepTabs.current = () => {
    if (root && restoredFor.current === root) saveWorkspace(localStorage, root, snapshotTabs());
  };
  useEffect(() => { keepTabs.current(); }, [root, tabs, active]);

  // The config is read on every folder change, but reading it starts nothing:
  // it arrives with the repository, so a project you cloned could name any
  // command. Servers only spawn from the button, after the command is on screen.
  useEffect(() => {
    setMcpTools({});
    setMcpError(null);
    if (!root) { setMcpServers([]); return; }
    let cancelled = false;
    void listServers(root)
      .then((list) => { if (!cancelled) setMcpServers(list); })
      .catch((e) => { if (!cancelled) { setMcpServers([]); setMcpError(String(e)); } });
    return () => { cancelled = true; };
  }, [root]);

  // Servers the human enabled earlier are started again on open — the approval
  // was for this exact command, and the fingerprint check is what enforces that.
  useEffect(() => {
    if (!root || !mcpServers.length) return;
    let cancelled = false;
    void (async () => {
      for (const s of mcpServers) {
        if (cancelled || !isEnabled(root, s)) continue;
        try {
          const tools = await startServer(root, s);
          if (!cancelled) setMcpTools((p) => ({ ...p, [s.name]: tools }));
        } catch (e) {
          if (!cancelled) setMcpError(`${s.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [root, mcpServers]);

  async function toggleServer(spec: ServerSpec) {
    const on = isEnabled(root, spec);
    setMcpError(null);
    if (on) {
      setEnabled(root, spec, false);
      await stopServer(spec.name).catch(() => {});
      setMcpTools((p) => { const n = { ...p }; delete n[spec.name]; return n; });
      return;
    }
    try {
      const tools = await startServer(root, spec);
      setEnabled(root, spec, true);
      setMcpTools((p) => ({ ...p, [spec.name]: tools }));
    } catch (e) {
      setMcpError(`${spec.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Closing the window throws away anything not on disk.
   *
   * Editor buffers are the part that actually loses work, so they are what
   * blocks. Staged changes and a turn in flight are named too — they are also
   * lost, and a dialog that mentions only one of the three would be telling
   * half the truth.
   *
   * Read through refs: the listener is registered once, and a listener holding
   * the first render's state would decide with numbers from before the session
   * had anything in it.
   */
  const closing = useRef({ dirty, editors, changes: [] as Change[], busy: false });
  closing.current = { dirty, editors, changes, busy };
  useEffect(() => {
    let stop: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested((e) => {
      // Before the early return: this is the one place the caret in the tab
      // still on screen gets recorded, and a clean quit takes that path
      // whether or not anything is dirty.
      keepTabs.current();
      const c = closing.current;
      const unsaved = [...c.dirty].filter((p) => c.editors.current.get(p)?.isDirty());
      if (!unsaved.length && !c.changes.length && !c.busy) return;
      e.preventDefault();
      setQuitError(null);
      setQuitting({ dirty: unsaved, staged: c.changes.length, busy: c.busy });
    }).then((un) => { stop = un; });
    return () => stop?.();
  }, []);

  /**
   * Leave without saving. `destroy` skips the handler above; `close` re-enters it.
   *
   * The drafts go too. "Leave anyway" is a decision to discard this work, and
   * offering it back on the next launch would quietly overturn that — the
   * recovery banner is for a session that ended without anyone choosing.
   */
  const quitNow = () => {
    void invoke('draft_clear', { root, path: null })
      .catch(() => {})
      .finally(() => { void getCurrentWindow().destroy(); });
  };

  async function saveAllAndQuit() {
    setQuitError(null);
    for (const path of quitting?.dirty ?? []) {
      const h = editors.current.get(path);
      if (!h?.isDirty()) continue;
      try {
        await h.save();
      } catch (e) {
        // Quitting after a failed save would lose exactly the work this exists
        // to protect, so it stays open and says which file refused.
        setQuitError(`${path}: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    quitNow();
  }

  /**
   * The working tree, reloaded whenever anything might have touched it.
   *
   * `written` covers approvals and saves; `git` covers a commit or a branch
   * change. Hand edits land through `written` too, because the editor reports
   * every save.
   */
  useEffect(() => {
    if (!root || !git?.is_repo) { setTracked([]); return; }
    let cancelled = false;
    void invoke<typeof tracked>('git_status', { root })
      .then((c) => { if (!cancelled) setTracked(c); })
      .catch(() => { if (!cancelled) setTracked([]); });
    return () => { cancelled = true; };
  }, [root, git?.is_repo, git?.branch, written, changes, diskTick]);

  /**
   * Open a working-tree change as a diff against its committed version.
   *
   * Staged through `Pending` with `after` equal to what is already on disk, so
   * the review pane renders it with the machinery the agent's proposals use and
   * approving it is a no-op write. It is a viewer, not an edit.
   */
  async function viewTracked(path: string) {
    try {
      const head = await invoke<string | null>('git_file_head', { root, path });
      if (head === null) { openFile(path); return; }
      const now = await pending.current.currentContent(root, path);
      if (head === now) { openFile(path); return; }
      openFile(path);
      push({ kind: 'result', text: `${path}: ${t('opened; the committed version differs')}` });
    } catch (e) {
      push({ kind: 'error', text: explain(e, `${t('read the committed')} ${path}`) });
    }
  }

  async function commitPicked() {
    const paths = [...picked];
    if (!paths.length || !commitMsg.trim()) return;
    setBusy(true);
    try {
      const r = await invoke<{ sha: string; summary: string }>('git_commit', {
        root, message: commitMsg.trim(), paths,
      });
      push({ kind: 'result', text: `${t('Committed')} ${r.sha} — ${r.summary}` });
      setPicked(new Set());
      setCommitMsg('');
      setWritten([]);
      setGit(await invoke('git_state', { root }));
    } catch (e) {
      push({ kind: 'error', text: explain(e, t('commit')) });
    } finally {
      setBusy(false);
    }
  }

  // The agent reads what you are looking at. Without this it reads the file
  // from disk while your unsaved edits are on screen, reasons about code that
  // no longer exists, and proposes changes that fight yours.
  useEffect(() => {
    pending.current.dirty = (path) => {
      const h = editors.current.get(path);
      return h?.isDirty() ? h.text() : undefined;
    };
  }, []);

  // Memory is a file in the project, so it is re-read whenever the folder
  // changes or an edit lands -- approving a `remember` should take effect on
  // the very next turn, not the next launch.
  useEffect(() => {
    if (!root) { setMemory({ file: null, text: '' }); return; }
    let cancelled = false;
    void readMemory(root).then((m) => { if (!cancelled) setMemory(m); });
    return () => { cancelled = true; };
  }, [root, written]);

  // What machine and what project the model is working on. Re-read on the same
  // trigger as memory, because an approved write can create the very first
  // package.json and a block still saying there is none is a fact that is
  // wrong rather than one that is missing. Recomputing costs nothing when the
  // project has not moved: environmentPrompt is deterministic, so an unchanged
  // folder produces the identical string, React bails out of the render, and
  // the cached prompt prefix survives untouched.
  useEffect(() => {
    if (!root) { setEnvironment(''); return; }
    let cancelled = false;
    void readEnvironment(root).then((f) => { if (!cancelled) setEnvironment(environmentPrompt(f)); });
    return () => { cancelled = true; };
  }, [root, written]);

  // Bring back the conversation for this folder. Runs on mount too, so
  // reopening the app lands you where you left off.
  useEffect(() => {
    if (!root) return;
    const found = chatsIn(root);
    setChats(found);
    // Reopen the thread that was last touched here; a folder with no history
    // starts a fresh one rather than showing another project's chat.
    const latest = found[0];
    if (latest) {
      setChatId(latest.id);
      setLines(latest.lines);
      history.current = latest.history;
      setChatTokens(latest.tokens ?? NO_USAGE);
      setLastTurn(NO_USAGE);
      setCtx(null);
    } else {
      setChatId(newChatId());
      setLines([]);
      history.current = [];
      setChatTokens(NO_USAGE);
      setLastTurn(NO_USAGE);
      setCtx(null);
    }
  }, [root]);

  // Persist after the exchange settles rather than on every streamed line --
  // writing the whole transcript on each token would be wasteful and would
  // stutter a long reply.
  useEffect(() => {
    if (!root || busy) return;
    if (!lines.length && !history.current.length) return;
    saveChat({
      id: chatId,
      folder: root,
      title: titleFrom(lines),
      updatedAt: Date.now(),
      lines: lines.map(({ shots: _shots, ...l }) => l),
      history: history.current,
      tokens: chatTokens,
    });
    setChats(chatsIn(root));
    setRecents(folders());
  }, [root, busy, lines, chatId, chatTokens]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [lines, changes]);

  // Whether git is available as an undo is worth knowing *before* approving,
  // not after.
  useEffect(() => {
    if (!root) { setGit(null); return; }
    void invoke<{ is_repo: boolean; branch: string; dirty: number }>('git_state', { root })
      .then(setGit).catch(() => setGit(null));
  }, [root, changes, diskTick]);

  // How big the afternoon is, refreshed exactly when the branch is. `git` is a
  // fresh object out of every `git_state` call, so depending on it covers the
  // periodic refresh, the commit and the new branch in one effect instead of a
  // line beside each of the four `setGit` call sites.
  //
  // The `live` flag is not ceremony: switching folders fires this twice, and
  // the slower answer is the one about the folder you just left.
  useEffect(() => {
    if (!root || !git?.is_repo) { setStat(null); return; }
    let live = true;
    void diffstat(root).then((s) => { if (live) setStat(s); });
    return () => { live = false; };
  }, [root, git]);

  // The redo stack belongs to the chat, not to this component, so switching
  // chats has to ask again rather than carrying the last one's answer over.
  useEffect(() => { void refreshRedo(); }, [chatId]);

  // Drag-and-drop is a window-level OS event, not an HTML5 one: Tauri
  // intercepts the drop before the webview sees it.
  useEffect(() => {
    let stop: (() => void) | undefined;
    void listenForDrops({
      onFolder: (path) => { openFolder(path); },
      onAttach: (items) => setShots((p) => [...p, ...items]),
      // The window's "drop to attach" overlay stays out of the way of anything
      // that will claim the drop for itself — offering to attach a file over a
      // terminal that is about to type its path is two answers to one gesture.
      onHover: (on, at) => setDragging(on && !(at && termDrop.current?.(at, null))),
      claim: (at, paths) => !!termDrop.current?.(at, paths),
      onError: (m) => push({ kind: 'error', text: m }),
    }).then((un) => { stop = un; });
    return () => stop?.();
  }, []);

  // Pasting a screenshot is the common case and it has no path at all, so it
  // never reaches the Rust side -- the blob is read here instead.
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      // Clipboard history is fed from here and from nowhere else. Nothing polls
      // the OS clipboard, because that would record the password a password
      // manager put there thirty seconds ago -- see clips.ts. A paste into a
      // password field (the gateway key, in Settings and on the welcome screen)
      // is skipped for the same reason.
      const pasted = e.clipboardData?.getData('text/plain') || '';
      if (pasted && !privateField(e.target as HTMLInputElement | null)) {
        setClips(rememberClip(localClips, pasted, { types: e.clipboardData?.types }));
      }
      const files = Array.from(e.clipboardData?.files || []);
      const imgs = files.filter((f) => f.type.startsWith('image/'));
      if (!imgs.length) return;
      e.preventDefault();
      for (const f of imgs) {
        try {
          const a = await attachFromFile(f);
          setShots((p) => [...p, a]);
        } catch (err) {
          push({ kind: 'error', text: explain(err, t('attach that image')) });
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const resolveMention = useMemo(() => treeResolver(tree), [tree]);

  /** Files and folders ranked for the picker, plus @terminal when one is open. */
  const mentionHits = useMemo(() => {
    if (!mention) return [] as { path: string; kind: 'file' | 'folder' | 'terminal' }[];
    const rows: { path: string; kind: 'file' | 'folder' | 'terminal' }[] =
      tree.map((e) => ({ path: e.path, kind: e.is_dir ? ('folder' as const) : ('file' as const) }));
    if (termMounted) rows.unshift({ path: TERMINAL, kind: 'terminal' });
    const q = mention.query.trim();
    return q ? rank(q, rows, (r) => r.path, 8) : rows.slice(0, 8);
  }, [mention, tree, termMounted]);

  /** What the message will carry, recomputed from the text on every keystroke. */
  const mentioned = useMemo(
    () => findMentions(prompt, resolveMention, termMounted),
    [prompt, resolveMention, termMounted],
  );

  function chooseMention(path: string) {
    if (!mention) return;
    const r = applyMention(prompt, mention.start, mention.caret, path);
    setPrompt(r.text);
    setMention(null);
    window.setTimeout(() => {
      composer.current?.focus();
      composer.current?.setSelectionRange(r.caret, r.caret);
    }, 0);
  }

  /**
   * Turn every mention in the message into something the model can read.
   *
   * `list` defaults to the mentions in the box because that is what an ordinary
   * send carries. A queued message is not in the box any more, so it brings its
   * own — `@other/file.ts` is most of what a correction typed mid-turn says,
   * and resolving the live box instead would attach whatever is being typed
   * next.
   */
  async function resolveAttachments(
    list: ReturnType<typeof findMentions> = mentioned,
  ): Promise<{ items: Attached[]; errors: string[] }> {
    const items: Attached[] = [];
    const errors: string[] = [];
    for (const m of list) {
      try {
        if (m.kind === 'terminal') {
          const text = termText.current?.() ?? '';
          if (text.trim()) {
            items.push({ kind: 'text', id: `m_${m.raw}`, name: 'terminal', text, bytes: text.length, truncated: false });
          }
        } else if (m.kind === 'folder') {
          // Paths, not contents -- see folderListing.
          const text = folderListing(m.path, tree);
          items.push({ kind: 'text', id: `m_${m.raw}`, name: `${m.path}/`, text, bytes: text.length, truncated: false });
        } else {
          const a = await attachAnyPath(`${root}/${m.path}`);
          items.push({ ...a, id: `m_${m.raw}`, name: m.path });
        }
      } catch (e) {
        errors.push(`${m.raw}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { items, errors };
  }

  /** A block can be applied when we can tell which file it belongs to. */
  const fileSet = useMemo(
    () => new Set(tree.filter((e) => !e.is_dir).map((e) => e.path)),
    [tree],
  );
  const openFilePath = isFile(active) ? active : null;

  /**
   * Send a block back with the file it belongs to and stage what comes back.
   *
   * A block is almost always a fragment, so writing it to the file would
   * replace the file with a snippet. The model returns targeted replacements
   * instead, which `stageEdit` applies — and its uniqueness check is what stops
   * an ambiguous anchor editing the wrong occurrence.
   */
  async function applyBlock(code: string, info: string, before: string) {
    const path = applyTarget(info, before, openFilePath, (p) => fileSet.has(p));
    if (!path) { push({ kind: 'error', text: t('No file to apply this to. Open one first.') }); return; }
    if (!armed({ baseUrl: wired.baseUrl, key: wired.apiKey })) { push({ kind: 'error', text: t('Add an API key in Settings first.') }); return; }

    setBusy(true);
    try {
      const file = await pending.current.currentContent(root, path);
      const { system, user } = applyMessages({
        path, language: info.split(/\s+/)[0] || '', file, snippet: code,
      });
      const raw = await askRaw(wired, system, user);
      const edits = parseApply(raw);
      if (!edits.length) {
        push({ kind: 'result', text: `${path}: ${t('nothing to change.')}` });
        return;
      }
      for (const e of edits) {
        await pending.current.stageEdit(root, path, e.old, e.replacement);
      }
      setChanges(pending.current.list());
      push({ kind: 'result', text: `${t('Staged')} ${edits.length} ${edits.length === 1 ? t('edit') : t('edits')} ${t('to')} ${path}. ${t('Review below.')}` });
    } catch (e) {
      push({ kind: 'error', text: explain(e, `${t('apply that to')} ${path}`) });
    } finally {
      setBusy(false);
    }
  }

  const push = (l: Line) => {
    openLine.current = null;
    setLines((p) => [...p, { at: Date.now(), ...l }]);
  };

  /** A piece of the reply as it is written. Opens a line, then extends it. */
  const stream = (text: string) => setLines((p) => {
    const i = openLine.current;
    if (i !== null && p[i]?.kind === 'text') {
      const next = [...p];
      next[i] = { ...next[i], text: next[i].text + text };
      return next;
    }
    openLine.current = p.length;
    return [...p, { at: Date.now(), kind: 'text' as const, text }];
  });

  /**
   * Open the project search, blank or on a term that has been searched before.
   *
   * Every way in goes through here so the seed is always set deliberately:
   * leaving the previous query behind would mean ⌘⇧F reopening on whatever was
   * last typed, which is a different feature and not the one the shortcut
   * promises.
   */
  function openFind(seed = '') {
    setFindSeed(seed);
    setPalette('find');
  }

  /** A search that matched, kept so the panel has something to offer back. */
  function rememberSearch(q: string) {
    const term = q.trim();
    if (!term) return;
    setSearches((prev) => [term, ...prev.filter((p0) => p0 !== term)].slice(0, MAX_SEARCHES));
  }

  /** Open a file and, when it came from a search hit, scroll to the line. */
  function openAt(path: string, line?: number) {
    openFile(path);
    setJump(line ? { path, line } : null);
    // A file already open ignores the mount-time line, so tell it directly.
    if (line) {
      const h = editors.current.get(path);
      if (h) window.setTimeout(() => h.goto(line), 0);
    }
  }

  /**
   * Where the caret is now, for the navigation trail.
   *
   * Read from the editor rather than from `jump`, because `jump` is where the
   * file was *opened*, and going back should return you to the line you were
   * reading when you jumped away — not to wherever you arrived twenty minutes
   * ago.
   */
  function here(): { path: string; line: number } | null {
    if (!isFile(active)) return null;
    return { path: active, line: editors.current.get(active)?.line() ?? 1 };
  }

  /** Go somewhere and remember where we were, so back means something. */
  function navigateTo(path: string, line: number) {
    const from = here();
    setTrail((n) => visit(from ? visit(n, from) : n, { path, line }));
    openAt(path, line);
  }

  /** Walk the trail. The cursor moves; nothing new is recorded. */
  function step(dir: 'back' | 'forward') {
    const r = dir === 'back' ? back(trail) : forward(trail);
    if (!r.place) return;
    setTrail(r.nav);
    openAt(r.place.path, r.place.line);
  }

  /**
   * F12 or ⌘-click on an identifier.
   *
   * The index knows declarations, not references, so this is "where is this
   * declared" rather than a resolver — no scopes, no imports, no shadowing. It
   * is right almost always and honest about the rest: several candidates open
   * the picker rather than guessing, and none says so rather than doing
   * nothing, which would read as the key being broken.
   */
  async function goToDefinition(name: string) {
    const needle = name.trim();
    if (!root || !needle) return;
    try {
      const hits = await invoke<Sym[]>('find_symbol', { root, name: needle, limit: 40 });
      // find_symbol matches substrings, which is right for the agent asking a
      // vague question and wrong for a person who clicked on an exact word.
      const exact = hits.filter((h) => h.name === needle);
      const pick = exact.length ? exact : hits;
      if (!pick.length) {
        push({ kind: 'result', text: `${t('No definition found for')} ${needle}.` });
        return;
      }
      if (pick.length === 1) { navigateTo(pick[0].path, pick[0].line); return; }
      setSymbols(pick);
      setPalette('defs');
    } catch (e) {
      push({ kind: 'error', text: explain(e, `${t('find')} ${needle}`) });
    }
  }

  // Read through the ref, because the window key listener was registered once.
  keys.current = {
    back: () => step('back'),
    fwd: () => step('forward'),
    sym: () => { if (root) setPalette('symbols'); },
    fileSym: () => { if (here()) setPalette('fileSymbols'); },
    clips: () => openClips(),
  };

  /**
   * What the palette can be told to do.
   *
   * Actions this app already has, given a name and a way to be typed rather
   * than only a shortcut to be remembered. Every label is already a catalogue
   * key — a command list that invented its own names would be a second set of
   * words for the same buttons, in three languages.
   *
   * The order is the menu order, and it is what the palette shows for `>` with
   * nothing after it, so it reads top to bottom as a list of what this app
   * does.
   */
  const commands = useMemo(() => [
    { id: 'openFolder', label: t('Open folder…'), keys: '' },
    // No keys on these two, and both were caught by the same reading. ⌘P is
    // the one field now, not Go to file; and ⌘⇧D *switches* the theme, so
    // printing it against Dark promises Dark to somebody who is already in it.
    // A shortcut printed on a row has to do what that row does.
    { id: 'goToFile', label: t('Go to file…'), keys: '' },
    { id: 'goToSymbol', label: t('Go to symbol in project…'), keys: `${MOD}T` },
    { id: 'goToFileSymbol', label: t('Go to symbol in file…'), keys: `${MOD}⇧O` },
    { id: 'searchProject', label: t('Search the project…'), keys: `${MOD}⇧F` },
    { id: 'terminal', label: t('Terminal'), keys: `${ALT}\`` },
    { id: 'ask', label: t(askOpen ? 'Hide the message box' : 'Show the message box'), keys: `${MOD}J` },
    { id: 'clips', label: t('Clipboard history'), keys: `${MOD}⇧V` },
    { id: 'newBranch', label: t('New branch'), keys: '' },
    { id: 'fullScreen', label: t(full ? 'Leave full screen' : 'Full screen'), keys: 'F11' },
    // At the ends these clamp, which is invisible and harmless, so they are
    // always listed. Reset is not: offering a way back to a size you are
    // already at is a row that does nothing when pressed.
    ...(canGrow(zoom) ? [{ id: 'zoomIn', label: t('Zoom in'), keys: `${MOD}+` }] : []),
    ...(canShrink(zoom) ? [{ id: 'zoomOut', label: t('Zoom out'), keys: `${MOD}-` }] : []),
    ...(zoom === ZOOM_NORMAL ? [] : [{ id: 'zoomReset', label: t('Reset zoom'), keys: `${MOD}0` }]),
    { id: 'themeDark', label: t('Dark'), keys: '' },
    { id: 'themeLight', label: t('Light'), keys: '' },
    { id: 'themeSystem', label: t('Match system'), keys: '' },
    { id: 'settings', label: t('Settings'), keys: '' },
    { id: 'signIn', label: t('Sign in'), keys: '' },
    { id: 'updates', label: t('Check for updates'), keys: '' },
  ], [t, full]);

  /** Run one of them. Called after the palette has closed, never before. */
  function runCommand(id: string) {
    switch (id) {
      case 'openFolder': void pickFolder(); break;
      case 'goToFile': setPalette('open'); break;
      case 'goToSymbol': keys.current.sym(); break;
      case 'goToFileSymbol': keys.current.fileSym(); break;
      case 'searchProject': openFind(); break;
      case 'terminal': toggleTerm(); break;
      case 'ask': setAskOpen((v) => !v); break;
      case 'clips': keys.current.clips(); break;
      case 'newBranch': void newBranch(); break;
      case 'fullScreen': void toggleFullscreen().then(setFull); break;
      case 'zoomIn': setZoom(larger(zoomRef.current)); break;
      case 'zoomOut': setZoom(smaller(zoomRef.current)); break;
      case 'zoomReset': setZoom(ZOOM_NORMAL); break;
      case 'themeDark': setTheme('dark'); break;
      case 'themeLight': setTheme('light'); break;
      case 'themeSystem': setTheme('system'); break;
      case 'settings': setShowSettings(true); break;
      case 'signIn': setSignInOpen(true); break;
      case 'updates': setShowSettings(true); break;
      default: break;
    }
  }

  /**
   * The section actually on screen.
   *
   * `rail` is the last one chosen and is kept even while it is switched off, so
   * turning a module back on returns you to where you were. `shown` is what can
   * be drawn right now, which is that one unless it is off.
   */
  // Each sidebar chooses from the modules docked on it. A module moved to the
  // other side must not go on being the left sidebar's "shown", and one that
  // has been switched off is on neither.
  const leftIds = docked(modules, 'rail').map((m) => m.id);
  const rightIds = docked(modules, 'other').map((m) => m.id);
  const shown: ModuleId = leftIds.includes(rail) ? rail : (leftIds[0] ?? enabledModules(modules)[0].id);
  const rightShown: ModuleId | null = rightRail && rightIds.includes(rightRail) ? rightRail : (rightIds[0] ?? null);

  /**
   * What a tab's menu offers.
   *
   * Built per tab rather than shown-and-disabled, so a pseudo-tab does not
   * offer to copy a path it has not got. `tidy` in `menu.ts` takes out the
   * dividers left around whatever was dropped.
   */
  function tabItems(path: string): MenuItem[] {
    const file = isFile(path);
    const strip = arrangeTabs(tabs, pinned);
    const drawn = panes.includes(path);
    return [
      { kind: 'action', id: 'pin', label: isPinned(pinned, path) ? 'Unpin' : 'Pin' },
      file ? { kind: 'action', id: 'split',
               label: drawn && panes.length > 1 ? 'Hide this pane' : 'Show this alongside',
               disabled: !drawn && panes.length >= MAX_PANES } : { kind: 'divider' },
      { kind: 'divider' },
      file ? { kind: 'action', id: 'copyName', label: 'Copy the name' } : { kind: 'divider' },
      file ? { kind: 'action', id: 'copyPath', label: 'Copy the path' } : { kind: 'divider' },
      file ? { kind: 'action', id: 'copyFolder', label: 'Copy the folder',
               disabled: !folderOf(path) } : { kind: 'divider' },
      file ? { kind: 'action', id: 'reveal', label: 'Show in the explorer' } : { kind: 'divider' },
      // Only when there is a branch on the remote to link into. A blob URL for
      // a branch nobody has pushed is a 404 with a confident-looking address.
      file && origin?.isGitHub && remote.upstream
        ? { kind: 'action', id: 'github', label: 'Open on GitHub' } : { kind: 'divider' },
      { kind: 'divider' },
      { kind: 'action', id: 'close', label: 'Close' },
      { kind: 'action', id: 'others', label: 'Close the others',
        hint: String(otherTabs(strip, path, pinned).length),
        disabled: otherTabs(strip, path, pinned).length === 0 },
      { kind: 'action', id: 'after', label: 'Close the ones after this',
        hint: String(tabsAfter(strip, path, pinned).length),
        disabled: tabsAfter(strip, path, pinned).length === 0 },
    ];
  }

  /** Close a set of tabs, then land somewhere sensible. */
  function closeMany(going: string[]) {
    if (!going.length) return;
    const land = nextActive(arrangeTabs(tabs, pinned), going, active);
    for (const p of going) closeTab(p);
    if (land && land !== active) setActive(land);
  }

  async function onTabMenu(path: string, id: string) {
    const copy = (text: string) => void navigator.clipboard.writeText(text)
      .catch(() => push({ kind: 'error', text: t('Could not copy that.') }));
    switch (id) {
      case 'pin': setPinned((p) => togglePin(p, path)); break;
      case 'split': splitTo(path); break;
      case 'copyName': copy(nameOf(path)); break;
      // The path as the app talks about it — relative to the open folder, the
      // same string every message and every diff in this app uses.
      case 'copyPath': copy(path); break;
      case 'copyFolder': copy(folderOf(path)); break;
      case 'reveal': setRail('files'); setRailOpen(true); setJump({ path, line: 1 }); break;
      case 'github':
        if (origin) browse(blobUrl(origin, git?.branch || 'main', path,
          editors.current.get(path)?.line()));
        break;
      case 'close': closeTab(path); break;
      case 'others': closeMany(otherTabs(arrangeTabs(tabs, pinned), path, pinned)); break;
      case 'after': closeMany(tabsAfter(arrangeTabs(tabs, pinned), path, pinned)); break;
    }
  }

  /** Drag the line between two editors. The terminal's twin — see split.ts. */
  function dragEditors(e: React.PointerEvent, at: number) {
    const box = edRow.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let last = e.clientX;
    document.body.classList.add('resizing');
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - last;
      if (!dx) return;
      last = ev.clientX;
      const sign = getComputedStyle(el).direction === 'rtl' ? -1 : 1;
      setEdWeights((w) => afterDrag(panes, w, at, (dx * sign) / box.width, MIN_SHARE));
    };
    const done = () => {
      el.releasePointerCapture?.(e.pointerId);
      document.body.classList.remove('resizing');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', done);
      el.removeEventListener('pointercancel', done);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', done);
    el.addEventListener('pointercancel', done);
  }

  /**
   * Show a file beside the others, or stop showing it.
   *
   * Hiding the pane you are *in* has to move the caret somewhere first,
   * otherwise the next render puts it straight back — the open tab is always
   * drawn, which is the invariant that makes the pane set need no effect to
   * keep it in step.
   */
  function splitTo(path: string) {
    const next = togglePane(panes, path, files);
    if (!next.includes(path) && path === active) setActive(next[0] ?? path);
    else if (next.includes(path) && !panes.includes(path)) setActive(path);
    setShownFiles(next);
  }

  /**
   * Move to a way of working.
   *
   * Chat: the conversation, sandboxed — mode `chat`, sidebar folded. Code: the
   * folder — files in the rail, the composer back to whatever it was before
   * Chat. Agent: the dashboard of routines and teammates. What it does not do
   * is unmount anything; the editors, terminals and transcript all persist,
   * because a switch that lost your place would be a switch nobody flipped.
   */
  const lastCodeMode = useRef<Mode>(mode === 'chat' ? 'agent' : mode);

  /**
   * What the terminal and the two sidebars were doing before Terminal took
   * them over.
   *
   * Terminal is the one space that borrows rather than arranges: it needs the
   * panel open, filling the window, with nothing either side of it, and those
   * are all settings somebody already has an opinion about. Leaving has to be
   * the same gesture backwards or the space is a one-way door that quietly
   * maximises your terminal and closes your file tree.
   */
  const beforeTerm = useRef<{ show: boolean; full: boolean; rail: boolean; right: boolean } | null>(null);

  /**
   * Hand back everything Terminal borrowed, and say what `showTerm` was.
   *
   * The caller sets `showTerm` itself, because the two ways out disagree about
   * it: leaving by the mode switch puts the panel back the way it was found,
   * while closing the panel means closed whatever it was before.
   */
  function restoreTerm(): { show: boolean } {
    const was = beforeTerm.current ?? { show: false, full: false, rail: true, right: true };
    beforeTerm.current = null;
    setTermFull(was.full);
    setRailOpen(was.rail);
    setRightOpen(was.right);
    return { show: was.show };
  }

  /**
   * Leave the Terminal space for Code.
   *
   * Written out of refs and setters alone, so it is safe to call from the
   * window's key bindings — those are installed once and hold the first
   * render's closures for ever, and `goTo` reads state that would be stale
   * there. Anything that stops the terminal filling the window comes through
   * here.
   */
  function leaveTerminal() {
    setSpace('code');
    setShowTerm(restoreTerm().show);
    setRail('files');
    setRailOpen(true);
  }

  function goTo(next: Space) {
    if (spaceRef.current === 'terminal' && next !== 'terminal') setShowTerm(restoreTerm().show);
    setSpace(next);
    if (next === 'terminal') {
      // Read before anything is set, or what is remembered is what this is
      // about to do rather than what was there.
      if (!beforeTerm.current) {
        beforeTerm.current = { show: showTerm, full: termFull, rail: railOpen, right: rightOpen };
      }
      setTermMounted(true);
      setShowTerm(true);
      setTermFull(true);
      setRailOpen(false);
      setRightOpen(false);
      // A terminal you have to click before typing in is not a terminal space.
      // After paint, because the pane is about to be re-laid out to fill the
      // window and the caret should land in it at its final size.
      requestAnimationFrame(() => focusSession.current?.(''));
      return;
    }
    /**
     * Code and Chat are places the terminal is not.
     *
     * Each of the three switches to a way of working rather than adding a
     * panel to the last one, so arriving somewhere puts away what belongs to
     * the others — Terminal hides the message box and the transcript, and
     * these two close the shell. Without it the switch is a half-move: you
     * press Chat for a conversation and get a conversation with a terminal
     * across the bottom of it.
     *
     * The panel is not taken away, only put away. Ctrl-` and the button in
     * the status bar bring it back, and doing so is then a thing somebody
     * chose rather than a leftover from where they used to be. Last, because
     * it beats the `restoreTerm` above — leaving Terminal for Code means
     * Code, not the arrangement from before Terminal.
     */
    setShowTerm(false);

    if (next === 'chat') {
      if (mode !== 'chat') lastCodeMode.current = mode;
      setMode('chat');
      setActive('chat');
      setRailOpen(false);
      return;
    }
    // Code. Leaving the sandbox is part of arriving: the mode went to `chat`
    // on the way in and nothing else puts it back.
    if (mode === 'chat') setMode(lastCodeMode.current);
    setRail('files');
    setRailOpen(true);
  }

  /** Clicking the section you are on collapses the sidebar, as VS Code does. */
  function pickRail(id: ModuleId) {
    if (dockOf(modules, id) === 'other') {
      // Same gesture, other side: the module you are looking at collapses its
      // sidebar; any other opens it there.
      if (id === rightShown && rightOpen) { setRightOpen(false); return; }
      setRightRail(id);
      setRightOpen(true);
      return;
    }
    if (id === rail && railOpen) { setRailOpen(false); return; }
    setRail(id);
    setRailOpen(true);
  }

  /**
   * Create, rename and delete, from the explorer.
   *
   * These are human actions and are absent from the tool schema, like every
   * other write. `window.prompt` rather than an inline field: the explorer is a
   * tree with no room for one, and a modal that cannot be mistyped past is the
   * right shape for something that touches the filesystem.
   */
  async function newFile(dir = '') {
    const name = await ask.text({ title: t('New file'), value: dir ? `${dir}/` : '',
                                 confirmLabel: t('Create') });
    if (!name?.trim()) return;
    try {
      await invoke('create_file', { root, path: name.trim() });
      setWritten((p) => [...p, name.trim()]);   // nudges the tree to reload
      openFile(name.trim());
    } catch (e) {
      push({ kind: 'error', text: explain(e, `${t('create')} ${name.trim()}`) });
    }
  }

  async function newFolder(dir = '') {
    const name = await ask.text({ title: t('New folder'), value: dir ? `${dir}/` : '',
                                 confirmLabel: t('Create') });
    if (!name?.trim()) return;
    try {
      await invoke('create_dir', { root, path: name.trim() });
      setWritten((p) => [...p, name.trim()]);
    } catch (e) {
      push({ kind: 'error', text: explain(e, `${t('create')} ${name.trim()}`) });
    }
  }

  async function renameEntry(from: string) {
    const to = await ask.text({ title: t('Rename to'), value: from });
    if (!to?.trim() || to.trim() === from) return;
    const dest = to.trim();
    try {
      await invoke('rename_path', { root, from, to: dest });
      // An open tab still points at the old path, and would save a file that no
      // longer exists there. Move the tab with the file.
      setTabs((p) => p.map((x) => (x === from ? dest : x)));
      setActive((a) => (a === from ? dest : a));
      setDirty((p) => { const n = new Set(p); if (n.delete(from)) n.add(dest); return n; });
      const h = editors.current.get(from);
      if (h) { editors.current.delete(from); editors.current.set(dest, h); }
      // A trail entry pointing at the old name would take you to a file that
      // no longer exists, and blame you for asking.
      setTrail((n) => forget(n, from));
      setWritten((p) => [...p, dest]);
    } catch (e) {
      push({ kind: 'error', text: explain(e, `${t('rename')} ${from}`) });
    }
  }

  async function deleteEntry(path: string, isDir: boolean) {
    // Permanent — there is no trash — so the confirmation says how much goes.
    const inside = isDir ? tree.filter((e) => e.path.startsWith(`${path}/`)).length : 0;
    const what = isDir
      ? `${path}/ — ${inside} ${inside === 1 ? t('entry') : t('entries')}`
      : path;
    if (!await ask.confirm({ title: t('Delete permanently?'), body: what,
                             confirmLabel: t('Delete'), danger: true })) return;
    try {
      await invoke('delete_path', { root, path });
      const gone = (x: string) => x === path || x.startsWith(`${path}/`);
      setTabs((p) => p.filter((x) => !gone(x)));
      setActive((a) => (gone(a) ? 'chat' : a));
      setDirty((p) => new Set([...p].filter((x) => !gone(x))));
      for (const key of [...editors.current.keys()]) if (gone(key)) editors.current.delete(key);
      setTrail((n) => [...n.list].reduce((acc, pl) => (gone(pl.path) ? forget(acc, pl.path) : acc), n));
      setWritten((p) => [...p, path]);
    } catch (e) {
      push({ kind: 'error', text: explain(e, `${t('delete')} ${path}`) });
    }
  }

  /**
   * Replace across the project, staged for review.
   *
   * Every affected file is read through `Pending.currentContent`, so an
   * unsaved buffer or an already-staged change is what gets rewritten rather
   * than a stale copy from disk. Nothing is written here — the review pane is
   * where a bulk edit is either understood or refused.
   */
  async function replaceEverywhere(
    find: string, to: string, opts: { fold: boolean; words: boolean },
  ): Promise<number> {
    // A wider net than the display cap: the panel shows 300 hits, but a replace
    // has to touch every file that matches, not the first few hundred lines.
    const found = await invoke<{ hits: { path: string }[] }>('search', {
      root, query: find, maxHits: 5000, caseInsensitive: opts.fold, wholeWord: opts.words,
    }).catch(() => ({ hits: [] as { path: string }[] }));

    const paths = [...new Set(found.hits.map((h) => h.path))];
    let changed = 0;
    let total = 0;
    for (const path of paths) {
      try {
        const before = await pending.current.currentContent(root, path);
        const { text, count } = replaceAll(before, find, to, opts);
        if (!count || text === before) continue;
        await pending.current.stageWrite(root, path, text);
        changed += 1;
        total += count;
      } catch (e) {
        push({ kind: 'error', text: explain(e, `${t('replace in')} ${path}`) });
      }
    }
    setChanges(pending.current.list());
    push({
      kind: 'result',
      text: changed
        ? `${t('Staged')} ${total} ${total === 1 ? t('replacement') : t('replacements')} ${t('across')} ${changed} ${changed === 1 ? t('file') : t('files')}. ${t('Review below.')}`
        : t('Nothing to replace.'),
    });
    return changed;
  }

  function toggleTerm() {
    // In the Terminal space the terminal *is* the space, so closing it is a
    // request to leave rather than a request to look at an empty window — and
    // it is still a request to close, so the panel goes with it. The ref and
    // `leaveTerminal` between them keep this correct from the key bindings,
    // which hold the first render's copy of this function for ever.
    if (spaceRef.current === 'terminal') { leaveTerminal(); setShowTerm(false); return; }
    setShowTerm((v) => { if (!v) setTermMounted(true); return !v; });
  }

  async function attach() {
    try {
      const { items, errors } = await pickAttachments();
      if (items.length) setShots((p) => [...p, ...items]);
      if (errors.length) push({ kind: 'error', text: errors.join(' \u00b7 ') });
    } catch (e) {
      push({ kind: 'error', text: explain(e, t('attach that file')) });
    }
  }

  /**
   * Take a screenshot straight into the tray.
   *
   * The Rust side runs a fixed, interactive command and nothing here supplies
   * an argument to it — `mode` picks between two argument lists written in
   * `capture.rs`, and the user drags the crosshair themselves, so what is
   * captured stays their choice. Escape comes back as `cancelled` rather than
   * an error: changing your mind is not a failure, and an error line saying
   * otherwise is noise.
   *
   * Windows has no "write it to this file" snip, so it returns `clipboard` and
   * we point at the paste that already works rather than growing a second way
   * for an image to arrive.
   */
  async function capture(mode: 'region' | 'window') {
    try {
      const r = await invoke<{ status: string; media_type?: string; data?: string; bytes?: number }>(
        'capture_screenshot', { mode },
      );
      if (r.status === 'cancelled') return;
      if (r.status === 'clipboard') {
        push({ kind: 'result', text: t('The snip is on your clipboard — paste it into the message.') });
      } else if (r.status === 'captured' && r.data && r.media_type) {
        const shot: Attached = {
          kind: 'image',
          id: `shot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: `${t('Screenshot')}.png`,
          mediaType: r.media_type,
          data: r.data,
          bytes: r.bytes ?? 0,
        };
        setShots((p) => [...p, shot]);
      }
      // Focus goes back to the box in both cases — the shot is only half of a
      // message, and on Windows the next keystroke is the paste.
      composer.current?.focus();
    } catch (e) {
      push({ kind: 'error', text: explain(e, t('take a screenshot')) });
    }
  }

  /** Terminal output the user chose to hand to the agent. One direction only. */
  function fromTerminal(text: string) {
    setPrompt((p) => `${p ? p.replace(/\s*$/, '') + '\n\n' : ''}\`\`\`\n${text}\n\`\`\`\n`);
    composer.current?.focus();
  }

  /**
   * The same gesture, with files attached.
   *
   * WhatsApp is the caller: a conversation arrives as the fenced block
   * `fromTerminal` would have made, and the photos, stickers, PDFs and video
   * stills in it arrive in the attachment tray beside it. The tray and not the
   * request, deliberately — everything else that attaches a file lands there
   * first, the person sees what is about to be sent, and one of them can be
   * taken back out before it goes.
   */
  function fromWhatsApp(text: string, attached?: Attached[]) {
    fromTerminal(text);
    if (attached && attached.length) setShots((p) => [...p, ...attached]);
  }

  function openClips() {
    // Re-read rather than trusting state: entries expire by age, and the
    // expiry has to happen when the list is looked at, not only when it grows.
    const held = clipHistory(localClips);
    setClips(held);
    if (held.length) setClipsOpen(true);
  }

  function closeClips() {
    setClipsOpen(false);
    composer.current?.focus();
  }

  /** A chosen clip lands at the caret, not at the end -- it is a paste. */
  function insertClip(text: string) {
    const el = composer.current;
    const from = el?.selectionStart ?? prompt.length;
    const to = el?.selectionEnd ?? from;
    setPrompt(prompt.slice(0, from) + text + prompt.slice(to));
    setClipsOpen(false);
    const caret = from + text.length;
    window.setTimeout(() => {
      composer.current?.focus();
      composer.current?.setSelectionRange(caret, caret);
    }, 0);
  }

  async function newBranch() {
    const suggested = `vylo/${new Date().toISOString().slice(0, 10)}`;
    const name = await ask.text({ title: t('New branch name'), value: suggested,
                                 confirmLabel: t('Create') });
    if (!name) return;
    try {
      await invoke('git_create_branch', { root, name });
      setGit(await invoke('git_state', { root }));
      push({ kind: 'result', text: `${t('Switched to branch')} ${name}` });
    } catch (e) {
      push({ kind: 'error', text: explain(e, `${t('create the branch')} ${name}`) });
    }
  }

  async function commit() {
    if (!written.length || !commitMsg.trim()) return;
    setBusy(true);
    try {
      const r = await invoke<{ sha: string; summary: string }>('git_commit', {
        root, message: commitMsg.trim(), paths: written,
      });
      push({ kind: 'result', text: `${t('Committed')} ${r.sha} — ${r.summary}` });
      setWritten([]);
      setCommitMsg('');
      setGit(await invoke('git_state', { root }));
    } catch (e) {
      push({ kind: 'error', text: explain(e, t('commit')) });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Suspend the agent loop until the user decides. Returning a promise the
   * button resolves is what keeps the whole thing inside one turn, so the model
   * can read the command's output immediately instead of the turn ending and
   * the context being re-sent.
   */
  /**
   * Run one step from the to-do list.
   *
   * Through `askToRun`, which is the same gate a command the model proposed
   * goes through, and then into the **visible** terminal rather than the pipe.
   * Both halves are deliberate.
   *
   * The gate, because the app cannot know a step is the human's own string:
   * `.vylo/TODO.md` is a file in the repository, so the agent can write to it
   * through the review gate, a colleague can push to it, and it arrives with a
   * clone. Its provenance is a file, not a keystroke — which is exactly the
   * case VYLO.md's one-way rule is about, and why typing it into the shell for
   * somebody to press Enter on would be the reverse bridge that rule forbids.
   *
   * The visible terminal, because a step somebody is stepping through is one
   * they want to watch and be able to interrupt. The pipe exists so the model
   * can read output; here there is no model in the loop.
   */
  /**
   * A command, from words.
   *
   * One request, no tools — the person has already said what they want, and
   * there is nothing for the agent loop to look up. What comes back goes to
   * `askToRun`: the same dialog, the same string on screen, the same "Always
   * allow this" as a command the agent proposed mid-turn.
   *
   * There is deliberately no second confirmation. The dialog *is* the approval,
   * and a screen that asks twice teaches people to click through both.
   *
   * Returns a note when the answer was not a command, and null when it was —
   * so the terminal never holds a runnable string.
   */
  async function askForCommand(question: string, output: string): Promise<string | null> {
    if (!armed({ baseUrl: wired.baseUrl, key: wired.apiKey })) return t('Add an API key in Settings first.');
    const raw = await askRaw(
      wired,
      ASK_SYSTEM,
      askMessage({ question, environment, cwd: root, output }),
    );
    const reply = parseCommand(raw);
    if (!reply) return t('No answer came back. Try again.');
    if (reply.kind === 'note') return reply.text;

    const choice = await askToRun({ command: reply.text, reason: reason(question) });
    if (choice === 'no') return null;
    if (!termRun.current) return t('Open the terminal first.');
    try { await termRun.current(reply.text); }
    catch (e) { return explain(e, `${t('run')} ${reply.text}`); }
    return null;
  }

  async function runStep(command: string) {
    const choice = await askToRun({ command, reason: t('A step from the to-do list.') });
    if (choice === 'no') return;
    if (!termRun.current) { setShowTerm(true); push({ kind: 'result', text: t('Open the terminal first.') }); return; }
    setShowTerm(true);
    try { await termRun.current(command); }
    catch (e) { push({ kind: 'error', text: explain(e, `${t('run')} ${command}`) }); }
  }

  /**
   * Ask about one command, or answer for the person if they decided in advance.
   *
   * The order of the three checks below is the guarantee, and it used to be
   * wrong. "Always allow this" was consulted *first*, above the refuse-list —
   * so a `git push origin main` trusted once during an attended turn ran with
   * no dialog and no transcript line, at every auto-approve level, including
   * inside a routine nobody was watching. SAFETY.md says the refuse-list
   * "always asks, at every level, and there is no setting that turns this
   * off"; that is only true if the refusal is computed before anything can
   * short-circuit past it, which is what happens here now.
   *
   * Two further things a routine's turn does not get. It does not spend a
   * person's trust: "Always allow this" is somebody answering a dialog they
   * were looking at, and an unattended run gets only what auto-approve itself
   * decided. And it does not run MCP tools — every rule in the refuse-list is
   * shell-shaped (`\brm\s+-`, `\bgit\s+push\b`), so `slack: post_message(…)`
   * matches nothing and level `all` would otherwise post to a channel with
   * nobody there. Asking, unattended, means it does not run.
   */
  function askToRun(req: CommandRequest): Promise<RunChoice> {
    // First, before trust and before the level. `decide` checks the same list
    // within itself; this is the copy that no branch below can skip.
    const refused = refusedFor(req.command);
    const unattended = routineRun.current !== null && !routineRun.current.attended;
    if (!refused && !unattended && trusted.current.has(req.command)) {
      // Said out loud, because "you will not be asked again" is not the same
      // promise as "this happened and you were not told".
      push({ kind: 'result', text: `${t('Ran without asking')} — ${req.command}` });
      return Promise.resolve('pipe');
    }
    // Auto-approve answers the dialog; it does not go round it. The command
    // still passes through here, is still recorded, and still runs down the
    // same path — so turning the mode off leaves nothing behind.
    const unattendedTool = unattended && req.kind === 'mcp';
    const call = decideAuto(req.command, auto);
    if (call.kind === 'run' && !unattendedTool) {
      push({ kind: 'result', text: `${t('Ran without asking')} — ${req.command}` });
      return Promise.resolve('pipe');
    }
    // A command the mode would have run, held back by the refuse-list. Saying
    // which rule caught it is the difference between a dialog that looks broken
    // and one that is doing its job.
    const sayWhy = unattendedTool
      ? t('an unattended run may not use MCP tools')
      : call.kind === 'ask' && call.why ? t(call.why) : null;
    if (autoOn(auto) && sayWhy) {
      push({ kind: 'result', text: `${t('Asking anyway, because')} ${sayWhy} — ${req.command}` });
    }
    setAskRun(req);
    // The loop is suspended on the promise below until somebody clicks, so this
    // is the one moment the app is genuinely stuck. `req.command` is not passed
    // and there is nowhere to put it: the dialog is what the human reads.
    raiseSummons({ kind: 'approval', mcp: req.kind === 'mcp' });
    note({ kind: 'ask' });
    return new Promise<RunChoice>((resolve) => {
      decide.current = (choice) => {
        decide.current = null;
        setAskRun(null);
        note({ kind: 'answered' });
        resolve(choice);
      };
    });
  }

  /**
   * Whether a routine's turn is in flight, said out loud if it is.
   *
   * The guard on every door that would take this app's one chat away from a
   * run: picking or opening another folder, starting a new chat, opening or
   * deleting an old one. None of them used to check anything, so a run in `/A`
   * went on streaming into `/B`'s transcript, `history.current` overwrote
   * `/B`'s history, and the persistence effect filed the routine's whole turn
   * under `/B`'s chat id — while the id the row points at never got a file at
   * all.
   *
   * It refuses on the run, not on where the door leads, and that is a decision
   * rather than a missing check. Every one of these paths clears
   * `history.current` and `lines` before it does anything else, so letting
   * "you are already in that folder" or "that is the run's own chat" through
   * would throw the live transcript away in the name of leaving it alone.
   *
   * Refusing rather than aborting, because refusing loses nothing: the run
   * finishes, is saved under its own id in its own folder, and "Open the last
   * run" finds it. Anybody who does not want to wait has Stop, which is the
   * same button it always was.
   */
  function heldByRoutine(): boolean {
    if (!routineRun.current) return false;
    push({ kind: 'result', text: t('A routine is running. Stop it, or wait for it to finish.') });
    return true;
  }

  function openFolder(path: string) {
    if (heldByRoutine()) return;
    setRoot(path);
    // Cleared here and repopulated by the restore effect above, so switching
    // between projects never shows one project's transcript against another's
    // files, even for a frame.
    history.current = [];
    setLines([]);
    setTabs([]);
    setActive('chat');
    // Staged edits are relative to the folder they were made against; carrying
    // them into a different project would be a way to write a file somewhere
    // nobody asked for.
    pending.current.clear();
    setChanges([]);
    // Both are about the folder that was open: a question about a file in it,
    // and a claim that this app wrote one. Neither means anything now.
    setAsks([]);
    selfWrites.current.clear();
    setShots([]);
    // "Always allow" was granted against one project, not all of them.
    trusted.current.clear();
    setWritten([]);
    setCommitMsg('');
    // Both of these are about the folder that was open. A File History left up
    // would go on querying the old relative path against the new root.
    setVersionsFor(null);
    setClipsOpen(false);
  }

  function openFile(path: string) {
    setTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActive(path);
  }

  async function closeTab(path: string) {
    // Closing a tab destroys its buffer, so unsaved work needs a decision
    // rather than a shrug.
    if (editors.current.get(path)?.isDirty()
        && !await ask.confirm({ title: t('Close without saving?'), body: path,
                                confirmLabel: t('Close'), danger: true })) return;
    editors.current.delete(path);
    setDirty((p) => { const n = new Set(p); n.delete(path); return n; });
    // Otherwise reopening the file later brings back a bar asking about a
    // change that was decided when the buffer was thrown away.
    setAsks((p) => p.filter((x) => x.path !== path));
    setTabs((prev) => prev.filter((p) => p !== path));
    setActive((cur) => (cur === path ? 'chat' : cur));
    // Otherwise reopening the file later in the same session drops the caret at
    // the line the *previous* session left it on, which reads as the editor
    // scrolling on its own.
    restoredLines.current.delete(path);
  }

  async function saveActive() {
    const h = editors.current.get(active);
    if (!h || !h.isDirty()) return;
    try {
      await h.save();
    } catch (e) {
      push({ kind: 'error', text: explain(e, `${t('save')} ${active}`) });
    }
  }

  function newChat() {
    if (!root || heldByRoutine()) return;
    setChatId(newChatId());
    history.current = [];
    setLines([]);
    setChanges([]);
    pending.current.clear();
    setChatTokens(NO_USAGE);
    setLastTurn(NO_USAGE);
    setCtx(null);
    setActive('chat');
  }

  /**
   * The gap between a run being asked for and `send` setting `inFlight`, which
   * now holds two file reads. A second Run now in that gap — a double-click,
   * or the tick landing on it — would open a second chat for the same run.
   * This guards run-against-run; `inFlight` guards run-against-turn, and both
   * are checked at the top of `runRoutine` and again after the reads.
   */
  const routineStarting = useRef(false);

  /**
   * Run one routine, now.
   *
   * A fresh chat, so the run's transcript is its own and the result has an
   * address to open later. The agent is read from `.vylo/AGENTS.md` as it
   * stands *now*, not from state: the line that says what it may do is the
   * one a review can see, and a `git pull` that changed it while the app was
   * open is not something this app's own write notifications hear about.
   *
   * `byHand` is the difference between the scheduler and the Run now button,
   * and it decides the mode. An unattended run is `ask` — reads only — unless
   * auto-approve is on, in which case the person decided in advance. A hand
   * run has a person at the approval dialog by definition, so it gets the
   * agent's own mode; the button used to downgrade it to reads-only while the
   * dot beside it said "May stage edits and ask to run commands".
   *
   * The mode goes in the transcript. A run recorded only as
   * `Routine — name · agent` cannot be told apart, a week later, from one
   * whose agent's mode has since been edited in `.vylo/AGENTS.md`, and SAFETY
   * says what a routine did is a transcript you can open afterwards.
   *
   * `markRun` is written at the start and again at the end, with `send`'s
   * outcome: the start is what stops a second tick from launching it twice,
   * the end is what the dashboard reads. Both go through `record`, which
   * refuses to write onto a row that is no longer the same routine. Nothing
   * writes one for a refusal because a turn is in flight: that is a deferral,
   * not a run, and recording it would move the anchor and lose the owed slot.
   * A missing agent or key *is* recorded — the routine cannot run until
   * somebody fixes it, and the row is where they find out — but before the
   * chat is reset, so a run that never started leaves no chat holding only its
   * header and opens no Settings in a window nobody is at.
   */
  async function runRoutine(r: Routine, byHand = false) {
    if (busy || inFlight.current || routineStarting.current) {
      push({ kind: 'error', text: t('A turn is running; try again when it ends.') });
      return;
    }
    if (!root) { push({ kind: 'error', text: t('Open a folder first.') }); return; }
    routineStarting.current = true;
    try {
      const at = Date.now();
      // The run's own folder, captured before anything can await. Everything
      // below is written against this and not against `root` as it stands at
      // the end.
      const runRoot = root;
      /**
       * Write the run onto its row — if the row is still this routine.
       *
       * Ids are minted from the clock and never reused, so this is a second
       * lock on the same door: a routine deleted mid-run, with another created
       * afterwards, must not have this run's result and chat id stamped onto
       * it. `createdAt` is the identity that survives a rename and a reschedule.
       */
      const record = (result: LastRun) => setRoutines((p) => (
        p.find((x) => x.id === r.id)?.createdAt === r.createdAt ? markRun(p, r.id, result) : p));
      const agents = await readAgents(runRoot);
      setAgentsList(agents);
      // Skills the same way: what the file says now is what the agent carries.
      const skills = await readSkills(runRoot);
      // Two file reads have happened since the guard at the top, and a person
      // can start a turn across them — press Enter, release push-to-talk, or
      // have the queue drain. Everything below wipes the chat, so the flag is
      // read again here rather than trusted from a render ago.
      if (inFlight.current || routineRun.current) {
        push({ kind: 'error', text: t('A turn is running; try again when it ends.') });
        return;
      }
      const agent = agents.find((a) => a.id === r.agent);
      if (!agent) {
        record({ at, chatId: '', ok: false, error: t('Its agent is no longer in .vylo/AGENTS.md.') });
        return;
      }
      if (!armed({ baseUrl: wired.baseUrl, key: wired.apiKey })) {
        record({ at, chatId: '', ok: false, error: t('Add an API key in Settings first.') });
        return;
      }
      const id = newChatId();
      record({ at, chatId: id, ok: true });
      // Set before the chat is touched, so nothing can switch folder or chat
      // from here until the run ends — see `heldByRoutine`.
      routineRun.current = { id, attended: byHand };
      // The same reset `newChat` does, with an id known up front.
      setChatId(id);
      history.current = [];
      setLines([]);
      setChanges([]);
      pending.current.clear();
      setChatTokens(NO_USAGE);
      setLastTurn(NO_USAGE);
      setCtx(null);
      setActive('chat');
      const runMode = modeFor(agent, byHand || autoOn(auto));
      const said = runMode === 'ask'
        ? t('Reads only')
        : fill(t('May act (auto-approve: {level})'), { level: t(LEVEL_LABEL[auto]) });
      push({ kind: 'result', text: `${t('Routine')} — ${r.name} · ${agent.name} · ${said}` });
      // Kept against the chat, not against the turn, so Try again and Continue
      // in this transcript are still this agent — see `teammates`.
      if (teammates.current.size >= MAX_TEAMMATES) {
        teammates.current.delete(teammates.current.keys().next().value as string);
      }
      teammates.current.set(id, {
        brief: systemPromptFor(agent, skillsTextFor(skills, agent.skills)),
        unattended: runMode,
        attended: modeFor(agent, true),
      });
      try {
        const outcome = await send(r.brief);
        record({ at, chatId: id, ...outcome });
      } catch (e) {
        record({ at, chatId: id, ok: false, error: explain(e, t('run the routine')) });
      } finally {
        routineRun.current = null;
        raiseSummons({ kind: 'routine' });
      }
    } finally {
      routineStarting.current = false;
    }
  }

  /**
   * The last keystroke or click anywhere in the window, for the scheduler.
   *
   * Capture phase, so a handler that stops propagation — the editor, the
   * terminal — still counts as somebody being here.
   */
  const lastActivity = useRef(0);
  useEffect(() => {
    const bump = () => { lastActivity.current = Date.now(); };
    window.addEventListener('keydown', bump, true);
    window.addEventListener('pointerdown', bump, true);
    return () => {
      window.removeEventListener('keydown', bump, true);
      window.removeEventListener('pointerdown', bump, true);
    };
  }, []);

  /**
   * Say which runs were owed and will not be taken, and forgive them.
   *
   * One reporter for the two scans below, because they are the same news: a
   * run owed at a moment nobody could take it is a run that was skipped, and
   * SAFETY says a skipped run is reported and never run late. It goes into the
   * transcript as well as onto the dashboard — the dashboard is a module that
   * can be switched off in Settings, and a report that exists only on a panel
   * nobody has open is not a report.
   *
   * A routine from another project is named with that project's folder. The
   * launch scan reads every project's routines, and "Nightly review" out of a
   * checkout that is not open is a name the reader cannot place — which was
   * the objection to reporting the whole list at all. The dashboard notice has
   * nowhere to put the label, so it is handed the open folder's share only.
   */
  const reportMissed = (missed: Routine[], now: number) => {
    if (!missed.length) return;
    const m = missedPhrase(missed.length);
    const named = missed
      .map((r) => (r.folder && r.folder !== root ? `${r.name} (${baseName(r.folder)})` : r.name))
      .join(' · ');
    push({ kind: 'result', text: `${fill(t(m.key), m.vars)} ${named}` });
    // Appended, not replaced: on launch both scans run in the same commit, and
    // the second must not swallow the first one's notice. By id, so a scan
    // that names a routine already in the notice refreshes it rather than
    // listing it twice.
    setMissedRuns((p) => [...p.filter((x) => !missed.some((r) => r.id === x.id)), ...missed]);
    setRoutines((p) => missed.reduce((acc, r) => skipRoutine(acc, r.id, now), p));
  };

  /**
   * What the launch scan named, so the folder scan does not name it twice.
   *
   * Both effects below run in the same commit on mount, and both read
   * `routines` from that one render — so the launch scan's `skip` has not
   * landed by the time the folder scan asks what the open project is owed, and
   * every run the launch scan named in that project is owed by definition.
   * Read once and emptied; on a later folder change there is nothing to
   * subtract, because a scan that has already run has already skipped.
   */
  const launchScan = useRef<Set<string> | null>(null);

  /**
   * The launch scan. What fell due while the app was closed, over every
   * project's routines.
   *
   * Deliberately over the whole list rather than this folder's. SAFETY says
   * missed runs are reported *and skipped, never run late*, and a routine
   * belonging to a project that is not open would otherwise sit owed until
   * that project was opened and then fire a day late. Skipping it is the
   * promise; naming it — with its project's folder, since it is not this one —
   * is what makes the skip something a person can act on.
   *
   * Routines with no folder are left out: the effect below is about to hand
   * them the open project and re-arm them there, so there is nothing owed yet
   * to report. The tick time this measures from is written by `tick`, not by
   * the interval — see there.
   */
  useEffect(() => {
    const last = Number(localStorage.getItem(TICK_KEY)) || null;
    const now = Date.now();
    const missed = missedWhileClosed(routines.filter((r) => r.folder), last, now);
    launchScan.current = new Set(missed.map((r) => r.id));
    reportMissed(missed, now);
    // Once, at launch.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Opening a project: claim the routines that belong to nobody, and settle
   * what this project is already owed.
   *
   * Two things a folder change has to do, and both of them are the same
   * promise — that a routine runs in the project it was written for, on time
   * or not at all.
   *
   * **Adoption.** A routine stored before `folder` existed has none, and used
   * to be treated as belonging wherever it was read: it resolved its agent
   * slug against whatever project happened to be open, which is the defect
   * folder scoping closes. The first project opened after this version claims
   * them, re-armed from that moment so the claim itself cannot fire a run
   * here, and one line says how many — silently moving somebody's schedules
   * into a project is not something to do without saying it.
   *
   * **What it is already owed.** `TICK_KEY` is one clock for the whole app, so
   * a slot that passed while a *different* project was on screen is behind the
   * launch window rather than inside it: not missed, not reported, and first
   * in the queue the moment its project opens, days late. Opening the folder
   * asks the same question about that folder alone (`owedNow`) and answers it
   * the same way — reported, and skipped.
   *
   * Runs on mount, which is the launch case for whichever project the app
   * reopens on, and that is why `launchScan` exists.
   */
  useEffect(() => {
    if (!root) return;
    const now = Date.now();
    const orphans = routines.filter((r) => !r.folder).length;
    if (orphans) {
      // The same shape `when.ts` returns, and the same reason for it: the
      // singular is its own sentence, and the number sits inside the sentence
      // where a translator can move it.
      const said: Phrase = orphans === 1
        ? { key: '1 routine made before folders existed now belongs to this project.', vars: {} }
        : { key: '{n} routines made before folders existed now belong to this project.', vars: { n: orphans } };
      push({ kind: 'result', text: fill(t(said.key), said.vars) });
    }
    const already = launchScan.current;
    launchScan.current = null;
    const owed = owedNow(routines, root, now).filter((r) => !already?.has(r.id));
    // Adoption first, so the skips below land on the list it produced.
    setRoutines((p) => adoptRoutines(p, root, now));
    reportMissed(owed, now);
  }, [root]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * One tick: start the routine that is owed, or say why not.
   *
   * This app has one chat and a run replaces it, so a run starts only when the
   * window is free — nothing running, no edits waiting in the review pane, no
   * command dialog or decision on screen, nothing in the box, nobody at the
   * keys in the last minute (`holdReason`). Otherwise the routine is *held*:
   * the reason goes on its row and the run stays owed, so the next free tick
   * takes it. Never `markRun` here — that moves the anchor and the owed run is
   * lost (see routines.ts, "Held is not a run"). The previous chat needs no
   * saving: the effect that persists it already ran.
   *
   * Only this folder's routines, because `agent` is a slug from this folder's
   * `.vylo/AGENTS.md` — see routines.ts, "A routine belongs to the folder it
   * was made in".
   *
   * `TICK_KEY` is written *here*, and only once every guard is past. The
   * interval used to write it before calling this, so a morning spent with no
   * folder open still advanced "the last time the scheduler ran" past a 09:00
   * slot that could never have started — and the next launch, comparing
   * against it, found nothing missed and let the tick run yesterday's routine
   * a day late. What the next launch needs to measure from is the last moment
   * a run *could* have started, which is exactly this line.
   */
  function tick(now: number) {
    if (!root) return;
    const why = busy || inFlight.current
      ? t('The app was busy; it will try at the next slot.')
      : (() => {
        const held = holdReason({
          // A dialog on screen is a decision waiting for a person, and so are
          // proposals in the review pane: `runRoutine` clears both.
          staged: changes.length > 0 || pending.current.list().length > 0 || askRun !== null,
          draft: prompt.trim().length > 0 || shots.length > 0,
          deciding: needsDecision.current,
          queued: queued(queue).length > 0,
          lastActivity: lastActivity.current,
        }, now);
        return held ? t(held) : null;
      })();
    const mine = routinesIn(routines, root);
    if (why) {
      const d = dueRoutines(mine, now);
      if (d.length && d[0].held !== why) setRoutines((p) => holdRoutine(p, d[0].id, why));
      return;
    }
    try { localStorage.setItem(TICK_KEY, String(now)); } catch { /* private mode */ }
    const d = dueRoutines(mine, now);
    if (!d.length) return;
    void runRoutine(d[0]);
  }
  // Set once, and read the newest render's `tick` through a ref. An interval
  // rebuilt on every dependency change restarts its thirty seconds each time
  // a run is recorded; one built once over a plain closure sends a run out
  // with the key, model and tools of whatever render it was made in, and a
  // key added in Settings five minutes ago is not on it. The ref gives the
  // tick current state without either.
  const tickRef = useRef(tick);
  tickRef.current = tick;
  useEffect(() => {
    const id = window.setInterval(() => tickRef.current(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  function openChat(c: Chat) {
    if (heldByRoutine()) return;
    setChatId(c.id);
    setLines(c.lines);
    history.current = c.history;
    setChatTokens(c.tokens ?? NO_USAGE);
    setLastTurn(NO_USAGE);
    setCtx(null);
    // Staged edits belong to the thread that proposed them; carrying them into
    // another conversation would offer changes with no visible reason.
    pending.current.clear();
    setChanges([]);
    setActive('chat');
  }

  function removeChat(id: string) {
    // Checked here as well as in `openChat`, and not left to it: this function
    // deletes the file first, so a refusal one line later would leave `chatId`
    // pointing at something that is gone.
    if (heldByRoutine()) return;
    deleteChat(id);
    const left = chatsIn(root);
    setChats(left);
    setRecents(folders());
    if (id === chatId) {
      if (left[0]) openChat(left[0]); else newChat();
    }
  }

  async function pickFolder() {
    // Before the dialog, not after it. `openFolder` refuses anyway, so the only
    // thing the old order bought was a native modal opened over a running turn,
    // browsed, and answered — and then a transcript line saying it was all for
    // nothing.
    if (heldByRoutine()) return;
    const picked = await open({ directory: true, multiple: false, title: t('Open a project folder') });
    if (typeof picked === 'string') openFolder(picked);
  }

  async function approve(paths: string[]) {
    setBusy(true);
    try {
      // Snapshot before writing, not after: once apply() has run the previous
      // contents only exist in the staged change, which it then discards.
      const cp = await snapshot(paths);
      const done = await pending.current.apply(root, paths);
      for (const p of done) selfWrites.current.note(p);
      setChanges(pending.current.list());
      setWritten((prev) => [...new Set([...prev, ...done])]);
      if (!commitMsg && done.length) {
        // A starting point, not a decision — the user edits it before committing.
        const name = done[0].split('/').pop() || done[0];
        setCommitMsg(done.length === 1 ? `Update ${name}` : `Update ${name} and ${done.length - 1} more`);
      }
      push({
        kind: 'result',
        text: `${t('Wrote')} ${done.length} ${done.length === 1 ? t('file') : t('files')}: ${done.join(', ')}`,
        cp: cp ?? undefined,
      });
      // Tell the agent what landed, so a follow-up turn knows the state of the
      // disk rather than assuming its proposal is still pending.
      history.current.push({
        role: 'user',
        content: `[The user approved and wrote: ${done.join(', ')}. These changes are now on disk.]`,
      });
    } catch (e) {
      // Raw, because the branch below matches on the stale-write wording.
      // It is put through explain() at the point it is shown.
      const msg = detailOf(e);
      // The write was refused because the file moved under the proposal. Re-base
      // the staged change on what is there now, so the review pane shows the
      // real conflict instead of a diff against a version that no longer exists.
      const stale = paths.find((p) => msg.includes(p));
      if (stale && msg.includes('changed on disk')) {
        await pending.current.restage(root, stale);
        setChanges(pending.current.list());
        push({ kind: 'error', text: `${msg} ${t('The diff now shows the current file — check it before approving again.')}` });
      } else {
        push({ kind: 'error', text: explain(msg, t('write the approved changes')) });
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * Write part of a file's proposal. The rest stays staged, so the review pane
   * redraws showing exactly what was left behind rather than losing it.
   */
  async function approvePart(path: string, content: string) {
    setBusy(true);
    try {
      await pending.current.applyPartial(root, path, content);
      selfWrites.current.note(path);
      setChanges(pending.current.list());
      setWritten((prev) => [...new Set([...prev, path])]);
      if (!commitMsg) setCommitMsg(`Update ${path.split('/').pop() || path}`);
      push({ kind: 'result', text: `${t('Wrote part of')} ${path}.` });
      history.current.push({
        role: 'user',
        content: `[The user approved part of your change to ${path} and wrote it. The rest of that change is still staged and NOT on disk. Re-read the file before editing it again.]`,
      });
    } catch (e) {
      push({ kind: 'error', text: explain(e, `${t('write part of')} ${path}`) });
    } finally {
      setBusy(false);
    }
  }

  /** The chat id as a directory name the checkpoint store will accept. */
  function cpChat() { return chatId.replace(/[^A-Za-z0-9_-]/g, ''); }

  /**
   * Record what the files about to be written look like now, and what the
   * write is about to make them.
   *
   * Returns null when there is nothing to record or the store is unavailable —
   * a checkpoint failing is not a reason to refuse a write the user asked for,
   * it just means that particular turn has no undo, and the missing button
   * says so by its absence.
   */
  async function snapshot(paths: string[]): Promise<{ seq: number; hist: number } | null> {
    const staged = pending.current.list().filter((c) => paths.includes(c.path));
    if (!staged.length) return null;
    try {
      // `after` is what makes the write redoable. The number comes back from
      // the store rather than a counter here, which would start again at one on
      // the next launch and file this checkpoint on top of an older one.
      const seq = await invoke<number>('checkpoint_save', {
        chatId: cpChat(),
        files: staged.map((c) => ({
          path: c.path, content: c.before, existed: !c.isNew, after: c.after,
        })),
      });
      // A new write is a new branch. The store has just dropped everything that
      // was undone, so the control for it goes too.
      setRedoable(null);
      return { seq, hist: history.current.length };
    } catch {
      return null;
    }
  }

  /**
   * The checkpoint redo would put back, re-read from the store.
   *
   * Which one that is — the oldest undone, and only when it can actually be put
   * back — is `redoTarget` in `checkpoints.ts`, where it is tested. It was the
   * kind of rule that fails silently: skipping to a later checkpoint writes a
   * state the project reached after one that was never restored.
   */
  async function refreshRedo() {
    const meta = await invoke<CpMeta[]>('checkpoint_list', { chatId: cpChat() }).catch(() => []);
    setRedoable(redoTarget(meta));
  }

  /** Put the files back, and the conversation with them. */
  async function restore(index: number, cp: { seq: number; hist: number }) {
    const meta = await invoke<CpMeta[]>('checkpoint_list', { chatId: cpChat() }).catch(() => []);
    const undoing = meta.filter((m) => !m.undone && m.seq >= cp.seq).sort((a, b) => a.seq - b.seq);
    const affected = [...new Set(undoing.flatMap((m) => m.paths))].sort();
    const ok = await ask.confirm({
      title: t('Undo this change and everything after it?'),
      body: `${affected.join('\n')}\n\n`
        + t('These files go back to how they were, losing any edits made since. The conversation is cut back to this point.'),
      confirmLabel: t('Undo'),
      danger: true,
    });
    if (!ok) return;

    // What redo will need: the conversation once, and where each checkpoint
    // being undone falls inside it. One copy rather than one prefix each —
    // `history` holds every tool result, so twenty prefixes of a refactoring
    // session is tens of megabytes through one IPC call and again onto the
    // disk. The arithmetic is `cutPoints`, which is tested; the store keeps
    // whatever it is handed and never looks inside it.
    //
    // Images go, for the reason saveChat drops them: a few screenshots are
    // megabytes of base64, and this is written to disk.
    const cuts = cutPoints(undoing, lines, history.current.length);
    const whole = {
      lines: lines.map(({ shots: _shots, ...l }) => l),
      history: history.current,
    };
    const tails = cuts.map((c, i) => (i === cuts.length - 1 ? { ...c, conversation: whole } : c));

    setBusy(true);
    try {
      const done = await invoke<string[]>('checkpoint_restore', {
        chatId: cpChat(), seq: cp.seq, root, tails,
      });
      // This function reloads every editor below, so the watcher reporting the
      // same files a moment later would reload them a second time and move
      // every caret in the app.
      for (const p of done) selfWrites.current.note(p);
      // Staged changes were proposed against files that no longer look like
      // that, so keeping them would offer a diff against a version that is gone.
      pending.current.clear();
      setChanges([]);
      history.current = history.current.slice(0, cp.hist);
      setLines((p) => p.slice(0, index));
      // The conversation a queued message was written against is now gone.
      // Bumping the revision is what makes `drain` hand that message back
      // instead of sending it into a transcript that was just cut away — the
      // chat id has not changed and cannot see this.
      setRev((r) => r + 1);
      setWritten([]);
      // Reload every open buffer, or the editor keeps showing the version that
      // was just rolled back and would write it straight over the restore.
      for (const h of editors.current.values()) await h.reload().catch(() => {});
      await refreshRedo();
      push({ kind: 'result', text: `${t('Restored')} ${done.length} ${done.length === 1 ? t('file') : t('files')}.` });
    } catch (e) {
      push({ kind: 'error', text: explain(e, t('restore the files')) });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Step one checkpoint forward again.
   *
   * As destructive as undo — it writes over whatever is in those files now —
   * so it asks in the same way, naming them.
   */
  async function redo() {
    if (!redoable) return;
    const ok = await ask.confirm({
      title: t('Redo this change?'),
      body: `${redoable.paths.join('\n')}\n\n`
        + t('These files go back to the version this write produced, losing any edits made since. The conversation comes back with them.'),
      confirmLabel: t('Redo'),
    });
    if (!ok) return;

    setBusy(true);
    try {
      const back = await invoke<{
        paths: string[];
        conversation: { lines: SavedLine[]; history: Msg[] } | null;
        ends: { upto: number; hist: number } | null;
      }>('checkpoint_redo', { chatId: cpChat(), root });
      pending.current.clear();
      setChanges([]);
      // The transcript is replaced, not appended to: it is the one that write
      // belonged to, and the line reporting it carries the undo button — which
      // is what stops redo being the one-way step undo used to be.
      //
      // The store kept one conversation for the whole undo and this
      // checkpoint's cut into it, so the slicing happens here: the shape of a
      // transcript is the UI's business and nothing in Rust looks inside it. A
      // missing cut takes nothing off, which is the whole conversation — what
      // the newest checkpoint of an undo gets anyway.
      for (const p of back.paths) selfWrites.current.note(p);
      history.current = (back.conversation?.history ?? []).slice(0, back.ends?.hist);
      setLines((back.conversation?.lines ?? []).slice(0, back.ends?.upto));
      // A redo replaces the transcript exactly as an undo cut it, so it moves
      // the conversation out from under a queued message in the same way.
      setRev((r) => r + 1);
      setWritten([]);
      for (const h of editors.current.values()) await h.reload().catch(() => {});
      await refreshRedo();
      push({
        kind: 'result',
        text: `${t('Redone')} ${back.paths.length} ${back.paths.length === 1 ? t('file') : t('files')}.`,
      });
    } catch (e) {
      push({ kind: 'error', text: explain(e, t('re-apply the files')) });
    } finally {
      setBusy(false);
    }
  }

  function reject(paths: string[]) {
    paths.forEach((p) => pending.current.drop(p));
    setChanges(pending.current.list());
    push({
      kind: 'result',
      text: `${t('Discarded')} ${paths.length} ${paths.length === 1 ? t('proposed change') : t('proposed changes')}.`,
    });
    history.current.push({
      role: 'user',
      content: `[The user discarded your proposed changes to: ${paths.join(', ')}. Do not re-apply them unless asked.]`,
    });
  }

  /**
   * Send a message.
   *
   * `queued` is everything drained out of the message queue when a turn ended,
   * already merged into one string — see `queue.ts`. It arrives as an argument
   * rather than through `prompt` because `setPrompt` and then `send()` in one
   * tick reads the box as it was *before* the set, and would send whatever was
   * there a moment ago. The box is also not the queue's to borrow: it holds the
   * message being written now, and a drain must not take a half-typed sentence
   * with it.
   *
   * A queued message is text and its own mentions. Attachments stay in the tray
   * for the message being written — a screenshot dragged in while the agent
   * worked belongs to whatever is typed next, not to something queued three
   * hops ago.
   */
  async function send(queued?: string): Promise<Outcome> {
    const text = (queued ?? prompt).trim();
    const carriedShots = queued ? [] : shots;
    // `inFlight` as well as `busy`: `busy` is the value of the render this
    // closure was made in, and the whole point of the ref is that it is not.
    if (busy || inFlight.current) return { ok: false, error: t('A turn is running; try again when it ends.') };
    // An image on its own is a legitimate message -- "what is wrong here?"
    // with a screenshot needs no words.
    if (!text && carriedShots.length === 0) return { ok: false };
    if (!root) {
      const error = t('Open a folder first.');
      push({ kind: 'error', text: error });
      return { ok: false, error };
    }
    if (!armed({ baseUrl: wired.baseUrl, key: wired.apiKey })) {
      const error = t('Add an API key in Settings first.');
      push({ kind: 'error', text: error });
      setShowSettings(true);
      return { ok: false, error };
    }

    if (!queued) {
      // The message is gone; anything still being said belongs to the next one,
      // not to the empty box left behind.
      dictation.current?.stop();
      setPrompt('');
    }
    // A person's own message into a routine's chat ends that chat's teammate.
    // Everything that reaches here came out of the composer or the queue —
    // Try again and Continue call `converse` directly — so this is somebody
    // asking their own question, and it runs in their mode with no brief in
    // front of it. The one caller that is not a person is `runRoutine`, which
    // has set `routineRun` before it gets here. See `teammates`.
    if (!routineRun.current) teammates.current.delete(chatId);
    push({ kind: 'you', text, shots: carriedShots.length ? [...carriedShots] : undefined });
    // Before the first `await`, and synchronously: `setBusy` lands a task
    // later, and the thirty-second tick firing in that gap used to read `busy`
    // as false and start a routine over the top of this turn. Cleared in
    // `converse`'s `finally`, and again below for the paths that never reach it.
    inFlight.current = true;
    setBusy(true);
    try {
      // Images ride in the same user turn as the question, before the text, so
      // the model reads the picture and then what is being asked about it. Text
      // files have no block type of their own, so they are folded into the
      // written turn with a header saying which file each one is.
      // Mentions are read at send time from the text as it finally stands, so a
      // file named and then deleted from the message is never attached.
      const { items: fromMentions, errors: mentionErrors } = await resolveAttachments(
        queued ? findMentions(queued, resolveMention, termMounted) : mentioned,
      );
      for (const e of mentionErrors) push({ kind: 'error', text: e });
      const carried = [...fromMentions, ...carriedShots];

      const images = carried.filter(isImage);
      const docs = carried.filter(isDoc);
      const files = carried.filter(isText);
      const written_ = files.length ? `${files.map(textBlock).join('\n\n')}\n\n${text}` : text;
      // Documents before images before the question, which is the order the
      // model reads them in: the thing being asked about, then the thing being
      // asked.
      const attached = [...docs.map(toDocBlock), ...images.map(toImageBlock)];
      const content: Block[] | string = attached.length
        ? [...attached, { type: 'text' as const, text: written_ }]
        : written_;
      history.current.push({ role: 'user', content });
      if (!queued) setShots([]);

      return await converse();
    } finally {
      // `converse` has already done this; the second write is for the case
      // where nothing above it got that far, so a throw between here and there
      // cannot leave the scheduler thinking a turn runs forever.
      inFlight.current = false;
    }
  }

  /**
   * Run a turn against the history as it stands.
   *
   * Split out of `send` so it can be run a second time. On a failed turn the
   * history still ends with the user's message and nothing after it — the
   * assistant's half is built inside `runAgent` and discarded when it throws —
   * so trying again is the same request, not a repair.
   *
   * Which is why the teammate is looked up by chat id rather than read off the
   * turn. Try again and Continue in a routine's transcript are the same
   * request too, and they used to be sent with the agent's brief gone and in
   * the person's own mode. A press has a person at the approval dialog, so it
   * gets the agent's attended mode; the scheduler's own turn gets the mode the
   * run started with.
   */
  async function converse(): Promise<Outcome> {
    // Synchronously, before anything can await — see `inFlight`. Set here as
    // well as in `send`, because Try again and Continue call this directly.
    inFlight.current = true;
    // Two turns get a teammate and no others: the run's own, and a Try again
    // or Continue on it. The run's chat is read off `routineRun`, because
    // `runRoutine` called `setChatId` a moment ago and this closure still
    // holds the previous id; a retry is the chat on screen, and only while the
    // flag those two buttons set is up. Any other turn in that transcript is a
    // person's own message, which `send` has already unhooked — this is the
    // second lock on the same door, and the one that holds if a path is ever
    // added that reaches here without going through `send`.
    const retry = retrying.current;
    retrying.current = false;
    const mate = routineRun.current
      ? teammates.current.get(routineRun.current.id)
      : retry ? teammates.current.get(chatId) : undefined;
    // What the turn is really running as, for the working line: the agent's
    // own mode when a mate applies, never more than Ask when unattended.
    const runningAs: Mode = mate ? (routineRun.current ? mate.unattended : mate.attended) : mode;
    setTurnMode(runningAs);
    // Only the newest failure offers a retry; an older one would re-ask a
    // question two answers back. Continue goes the same way: it resumes the
    // conversation as it stands, so a button left on an older line would
    // silently resume from somewhere else.
    setLines((p) => (p.some((l) => l.retry || l.more)
      ? p.map((l) => (l.retry || l.more ? { ...l, retry: undefined, more: undefined } : l))
      : p));
    needsDecision.current = false;
    setBusy(true);
    note({ kind: 'start', at: Date.now(), maxHops: MAX_HOPS });
    const controller = new AbortController();
    abort.current = controller;
    try {
      history.current = await runAgent({
        baseUrl: wired.baseUrl, apiKey: wired.apiKey, model: wired.model,
        wire: wired.wire, root,
        history: history.current,
        pending: pending.current,
        askToRun,
        // A routine's turn runs as its agent: that agent's mode (never more than
        // Ask when unattended — see modeFor) and its brief on top of memory.
        mode: runningAs,
        onUsage: (u) => { setLastTurn(u); setChatTokens((p) => add(p, u)); },
        onContext: (used, limit) => setCtx({ used, limit }),
        onHop: (hop) => note({ kind: 'hop', hop }),
        // Silent compaction is how a tool loses trust: the model forgets
        // something, the answer gets worse, and nothing said why. Say it once.
        onCompact: ({ dropped }) => {
          note({ kind: 'compact' });
          push({
            kind: 'result',
            text: dropped
              ? `${t('Summarised')} ${dropped} ${t('earlier messages to stay inside the context window.')}`
              : t('Trimmed older tool output to stay inside the context window.'),
          });
        },
        extraTools: [
          ...Object.entries(mcpTools)
            .flatMap(([server, tools]) => tools.map((t) => toSchema(server, t))),
          // Only when a connection exists -- see `whatsAppToolsFor`. A tool the
          // model is offered and cannot use costs a round trip and an apology.
          ...whatsAppToolsFor(whatsAppConn()),
        ],
        // The other half of the line above. `whatsapp_send` suspends the turn
        // on `askToRun` exactly as `run_command` does, and no auto-approve
        // level reaches it: `auto.ts` is about commands, and this never becomes
        // one. A message cannot be unsent, so it is always a person who sends
        // it.
        extraRun: (callToRun, ask) => {
          const conn = whatsAppConn();
          return runWhatsAppTool(callToRun.name, callToRun.input, {
            conn, call: callerFor(conn), ask,
          });
        },
        runInTerminal: (command) => {
          if (!termRun.current) throw new Error(t('Open the terminal first.'));
          setShowTerm(true);
          return termRun.current(command);
        },
        environment,
        memory: mate
          ? `${memoryPrompt(memory)}\n\n${mate.brief}`.trim()
          : memoryPrompt(memory),
        onDelta: (text) => { note({ kind: 'delta', chars: text.length }); stream(text); },
        onEvent: (e) => push({ kind: e.kind, text: e.text }),
        // The transcript gets the text; the status line gets the structure.
        // `onEvent` hands over a formatted string, and re-parsing it to find
        // the tool name would be reading our own output back.
        onToolStart: (name, input) => note({ kind: 'tool', name, input }),
        onToolEnd: () => note({ kind: 'result' }),
        onStaged: () => {
          const staged = pending.current.list();
          setChanges(staged);
          // Applied here rather than at the end of the turn, so the agent's next
          // `read_file` sees what it just wrote — which is what makes a
          // multi-step change work without being asked about each step.
          //
          // The snapshot in `approve` still runs, so an auto-applied write is
          // an undoable one. That is the whole reason this mode is defensible.
          if (appliesEdits(auto) && staged.length) {
            void approve(staged.map((c) => c.path));
            push({ kind: 'result', text: `${t('Applied without asking')} — ${staged.length}` });
            return;
          }
          // Fires once per file, so the quiet window in `again()` is what turns
          // a six-file turn into one banner rather than six.
          raiseSummons({ kind: 'staged' });
        },
        onRetry: (n, of) => {
          note({ kind: 'retry', attempt: n, attempts: of });
          push({
            kind: 'result',
            text: `${t('The gateway did not answer — trying again')} (${n}/${of})`,
          });
        },
        // A model's real limit, learned from the 400 that named it and applied
        // to the same request rather than reported as a failure. Said out loud
        // because it changes how much the agent will remember from here on,
        // and a silent change to that is how a tool loses trust.
        onLimit: (kind, value) => push({
          kind: 'result',
          text: `${kind === 'context'
            ? t('This model accepts a different context size. Corrected it and sent the request again.')
            : t('This model accepts a different reply length. Corrected it and sent the request again.')} (${value})`,
        }),
        // The half-written reply is on screen and is about to be asked for
        // again. Take it back, or the answer appears twice.
        onRestart: () => setLines((p) => {
          const i = openLine.current;
          openLine.current = null;
          return i === null ? p : p.filter((_, n) => n !== i);
        }),
        signal: controller.signal,
      });
      // A turn that ran to the end. News rather than a decision, so it only
      // fires at the "everything" level.
      raiseSummons({ kind: 'finished' });
      return { ok: true };
    } catch (e) {
      // Stopping is a choice, not a failure, and reporting it as an error would
      // read like something went wrong. What was said before the stop is kept:
      // the person read it and decided on it, so it is part of the conversation
      // — and a transcript showing a reply the model has no memory of giving is
      // how the next question stops making sense.
      if (e instanceof Stopped) {
        history.current = e.messages;
        push({ kind: 'result', text: t('Stopped.') });
        // Not an error line, and not a finished run either: a routine whose
        // run was stopped has a result nobody should read as complete.
        return { ok: false, error: t('Stopped.') };
      } else if (e instanceof HopLimit) {
        // Everything this turn read is on the exception, so keep it. The old
        // behaviour threw it away and offered Try again, which bought the same
        // twelve hops to reach the same wall — on a metered plan, twice the
        // bill for one answer. Continue re-enters `converse()` with exactly
        // this conversation, which ends with tool results and is a complete
        // request as it stands; nothing is appended to it. And it is a press:
        // a cap that continues by itself is not a cap.
        history.current = e.messages;
        const text = t('Reached the step limit for this turn. Nothing is lost — press Continue to carry on.');
        push({ kind: 'result', text, more: true });
        // Which is also why the queue must not drain over it: a queued message
        // would press Continue on the user's behalf and buy the hops.
        needsDecision.current = true;
        return { ok: false, error: text };
      } else {
        // Retryable in the sense that the same request can be sent again: the
        // history still ends with the user's message. Whether it will work is
        // the gateway's business, and the button says nothing about that.
        const error = explain(e, t('send the message'));
        push({ kind: 'error', text: error, retry: true });
        // There is a Try again on screen now, and the queue must not send over
        // the top of it -- see `needsDecision`.
        needsDecision.current = true;
        // Deliberately not in the `Stopped` branch above: Stop is a button in
        // this window, so whoever pressed it was looking at the app a moment
        // ago, and telling somebody that what they just asked for has happened
        // is how notifications get switched off.
        raiseSummons({ kind: 'failed' });
        return { ok: false, error };
      }
    } finally {
      abort.current = null;
      openLine.current = null;
      // Before `setBusy`, which lands a task later: the tick must not see an
      // idle app one moment before the ref says the turn is over.
      inFlight.current = false;
      // Back to idle, which is also what makes every late callback from an
      // aborted request a no-op rather than a spinner over a finished reply.
      note({ kind: 'stop' });
      setTurnMode(null);
      setBusy(false);
    }
  }

  /**
   * Put what is in the box into the queue instead of sending it.
   *
   * Reachable only while a turn is running; the same chord sends when one is
   * not. Nothing here is a new way for anything to reach the disk or a shell.
   * The sentence goes on to be one `user` message like any other, and every
   * write and every command it leads to is staged and approved exactly as it
   * would have been had it been typed a minute later.
   */
  function queueMessage(mode: SendMode) {
    if (!prompt.trim()) return;
    // Say the queue is full rather than swallowing the keystroke. Clearing the
    // box and losing the sentence to a cap nobody mentioned is the silent drop
    // this whole feature is built to avoid, one step earlier.
    if (isFull(queue)) {
      push({ kind: 'error', text: t('Nothing more can be queued until this turn ends.') });
      return;
    }
    const next = enqueue(queue, prompt, convoNow, mode);
    setQueue(next);
    dictation.current?.stop();
    setPrompt('');
    // Stop only once the message is safely in the queue. Aborting first ends
    // the turn, the effect below drains a queue that does not yet hold this
    // message, and the one sentence not sent is the one that asked for the
    // interruption.
    if (interrupts(next)) abort.current?.abort();
  }

  /**
   * Queued messages go in when the turn ends. Two guards, each with a failure
   * behind it.
   *
   * `drain` refuses anything written against a conversation that has since
   * moved — another chat, another folder, a checkpoint undo — and hands it back
   * rather than dropping it, because a sentence that vanishes without a word
   * looks exactly like one that was sent and ignored.
   *
   * The second is `needsDecision`: a turn that failed, or hit the hop cap, put
   * a button on screen that the person has to press. Sending a queued message
   * then buries it under a new turn and buys hops nobody agreed to. So the
   * queue is left where it is — on screen, with its remove controls — and goes
   * in after the retry that actually finishes the turn.
   *
   * A turn the person stopped by hand is *not* one of those. Every message in
   * the queue was put there by a ⌘↵ that means send; Stop ends the turn, not
   * the intentions queued behind it. Anyone who wants them gone has a remove on
   * every row and a Clear beside them.
   */
  useEffect(() => {
    if (busy || needsDecision.current || !queued(queue).length) return;
    const { take, stale, queue: left } = drain(queue, convoNow);
    setQueue(left);
    for (const i of stale) {
      push({
        kind: 'error',
        text: `${t('Not sent, because this conversation has moved on since it was written:')} ${i.text}`,
      });
    }
    // One drain, one turn. Three queued messages sent as three turns would be
    // three hop budgets started with nobody watching.
    if (take.length) void send(mergeQueued(take));
  }, [busy, queue, convoNow]);

  const folderName = root ? root.split(/[/\\]/).filter(Boolean).pop() : null;
  // null means say nothing, which is what a status bar owes somebody who pasted
  // a key and never signed in — the majority path, and the one this feature is
  // not allowed to change.
  const planChip = chip(plan);
  // The pseudo-tabs are on the strip but not on the editor stack.
  const files = tabs.filter(isFile);
  // Pruned on every render rather than in an effect: a tab can close from a
  // file being deleted on disk, which is not a click, and a pane pointing at it
  // would draw nothing.
  // The open tab is always one of the panes — the set only ever adds panes
  // *beside* it — so there is no state to keep in step and no effect to write.
  const panes = isFile(active)
    ? prunePanes(shownFiles.includes(active) ? shownFiles : [active], files)
    : [];
  const split = panes.length > 1;

  /**
   * A sidebar's contents, for the module it is showing.
   *
   * One function, two sidebars. Each panel is written once here and drawn on
   * whichever side its module is docked — which is the only way a second
   * sidebar could arrive without every panel being written twice and the two
   * copies drifting, the way the rail's heading once drifted from its list.
   */
  const sideFor = (shown: ModuleId, where: 'rail' | 'other' = 'rail') => (
    <>
          <div className="sb-head-bar">
            {/* From the registry. As a chain of ternaries this had no branch
                for `todo`, so the To do panel sat under a heading that said
                "Memory" for eleven releases. */}
            <h2>{t(labelOf(shown))}</h2>
            {/* Docking was a right-click on a rail icon and nothing else, which
                is a gesture nobody guesses — the feature shipped and was asked
                for again a release later. It is a button now. */}
            <button className="sb-act" onClick={() => {
              const to = where === 'other' ? 'rail' : 'other';
              setModules((m) => dockModule(m, shown, to));
              if (to === 'other') { setRightRail(shown); setRightOpen(true); }
              else { setRail(shown); setRailOpen(true); }
            }} title={t('Move to the other side')} aria-label={t('Move to the other side')}>
              <Icon name="split" size={14} />
            </button>
            {where === 'other' && (
              <button className="sb-act" onClick={() => setRightOpen(false)}
                      title={t('Hide this sidebar')} aria-label={t('Hide this sidebar')}>
                <Icon name="close" size={14} />
              </button>
            )}
            {shown === 'chats' && (
              <button className="sb-act" onClick={newChat} title={t('New chat')} aria-label={t('New chat')}>
                <Icon name="plus" size={14} />
              </button>
            )}
            {shown === 'files' && root && (
              <>
                <button className="sb-act" onClick={() => void newFile()}
                        title={t('New file')} aria-label={t('New file')}>
                  <Icon name="file" size={14} />
                </button>
                <button className="sb-act" onClick={() => void newFolder()}
                        title={t('New folder')} aria-label={t('New folder')}>
                  <Icon name="folder" size={14} />
                </button>
              </>
            )}
          </div>

          <div className="sb-panel">
            {shown === 'files' && (root
              ? <FileTree entries={tree} openPath={active === 'chat' ? null : active} t={t}
                          onOpen={openFile} changed={new Set(changes.map((c) => c.path))}
                          onRename={(p) => void renameEntry(p)}
                          onDelete={(p, d) => void deleteEntry(p, d)}
                          onNewIn={(d) => void newFile(d)}
                          onMenu={(path, isDir, at) => setFileMenu({ path, isDir, at })} />
              : (
                <div className="sb-cta">
                  <p className="ft-empty">{t('Open a folder, or drop one here')}</p>
                  <button className="ghost bordered" onClick={pickFolder}>
                    <Icon name="folder" size={13} />
                    <span className="cta-label">{t('Open a folder')}</span>
                  </button>
                </div>
              ))}

            {/* Icon, label, then the shortcut against the far edge — the shape
                every list of this kind has. The label is its own element so the
                `kbd` has something to be pushed away from; see the note on
                `.ghost.bordered` in the stylesheet. */}
            {shown === 'dashboard' && (
              <DashboardPanel t={t} routines={myRoutines} agents={agentsList} missed={missedHere}
                    onRun={(r) => void runRoutine(r, true)}
                    onOpen={(id) => { const c = chatsIn(root).find((x) => x.id === id); if (c) openChat(c); }}
                    onRoutines={() => { setRail('routines'); setRailOpen(true); }}
                    onDismiss={() => setMissedRuns([])}
                    onNewChat={newChat} />
            )}
            {shown === 'routines' && (
              <RoutinesPanel root={root} t={t} lang={lang} routines={myRoutines} onRoutines={saveRoutines}
                    onRun={(r) => void runRoutine(r, true)}
                    onOpen={(id) => { const c = chatsIn(root).find((x) => x.id === id); if (c) openChat(c); }}
                    onError={(m) => push({ kind: 'error', text: m })}
                    onOpenFolder={() => void pickFolder()}
                    unattendedMayAct={autoOn(auto)} />
            )}
            {shown === 'skills' && (
              <SkillsPanel root={root} t={t}
                    onError={(m) => push({ kind: 'error', text: m })} />
            )}
            {shown === 'usage' && (
              <UsagePanel t={t} plan={plan} chat={chatTokens} lastTurn={lastTurn}
                    chats={chats} offers={offers} ctx={ctx}
                    onOpen={(id) => { const c = chatsIn(root).find((x) => x.id === id); if (c) openChat(c); }}
                    onSettings={() => { setSettingsAt('account'); setShowSettings(true); }} />
            )}
            {shown === 'whatsapp' && (
              <WhatsAppPanel t={t} onSendToChat={fromWhatsApp}
                    onProviders={() => { setSettingsAt('account'); setShowSettings(true); }} />
            )}
            {shown === 'plugins' && (
              <PluginsPanel root={root} t={t}
                    servers={mcpServers} tools={mcpTools} error={mcpError}
                    onToggle={(sv) => void toggleServer(sv)}
                    onSettings={() => { setSettingsAt('modules'); setShowSettings(true); }} />
            )}
            {shown === 'browser' && (
              <BrowserPanel t={t} url={browser.url} recent={browser.recent}
                    onUrl={(u) => {
                      // Every call is a person: typed, picked, a back, or the
                      // empty Enter that clears. All four settle what the pane
                      // shows, so none of them may be undone by the seed above.
                      browserSeeded.current = true;
                      setBrowser((b) => ({ url: u, recent: u ? recentUrl(b.recent, u) : b.recent }));
                    }}
                    onError={(m) => push({ kind: 'error', text: m })} />
            )}

            {shown === 'prompts' && (
              <PromptsPanel root={root} t={t}
                    onToChat={(text) => { setActive('chat'); setPrompt((p) => (p.trim() ? `${p.trim()}\n${text}` : text)); }}
                    onToTerminal={(command) => void runStep(command)}
                    onError={(m) => push({ kind: 'error', text: m })} />
            )}

            {shown === 'outline' && (
              <OutlinePanel t={t}
                    path={openFilePath}
                    /* Read at call time: the panel polls, and a handle captured
                       once would go stale the moment a tab was switched. */
                    buffer={() => (isFile(active) ? editors.current.get(active) ?? null : null)}
                    onJump={(path, line) => setJump({ path, line })} />
            )}

            {shown === 'search' && (
              <>
                <div className="sb-cta">
                  <p className="ft-empty">{t('Search every file in the project.')}</p>
                  <button className="ghost bordered" onClick={() => openFind()}>
                    <Icon name="search" size={13} />
                    <span className="cta-label">{t('Search')}</span>
                    <kbd>{MOD}⇧F</kbd>
                  </button>
                  {/* No `kbd`: ⌘P is the one field now, and printing it here
                      would send somebody to a different palette than the one
                      this button opens. The button is the way in, and the
                      `goToFile` command in that field is the other. */}
                  <button className="ghost bordered" onClick={() => setPalette('open')}>
                    <Icon name="file" size={13} />
                    <span className="cta-label">{t('Go to file…')}</span>
                  </button>
                </div>

                {/* The rest of the column, which was empty. A search you have
                    run before is the one thing this panel knows about, and
                    picking it up again is a click rather than remembering the
                    term. Absent until there is one, so a first run shows the
                    two buttons and nothing pretending to be a list. */}
                {searches.length > 0 && (
                  <>
                    <div className="sb-sub">{t('Recent searches')}</div>
                    {searches.map((q) => (
                      <button key={q} className="ft-row sb-search" title={q}
                              onClick={() => openFind(q)}>
                        <span className="ft-icon"><Icon name="search" size={12} /></span>
                        <span className="ft-name">{q}</span>
                      </button>
                    ))}
                    <div className="sb-cta sb-forget">
                      <button className="ghost" onClick={() => setSearches([])}>
                        {t('Clear')}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}

            {shown === 'changes' && (
              <>
                {/* The remote. Nothing here needs a token: a pull request is a
                    page on github.com with the fields filled in, and opening it
                    in a browser gets the whole feature with no credential and
                    nothing to leak. The browser is already signed in, which is
                    the part a token would have been duplicating. */}
                {origin && (
                  <div className="gh">
                    <button className="gh-name" onClick={() => browse(repoUrl(origin))}
                            disabled={!origin.isGitHub}
                            title={origin.isGitHub ? t('Open the repository') : remote.url}>
                      <Icon name="branch" size={12} />
                      {origin.owner}/{origin.repo}
                    </button>

                    <span className="gh-drift">
                      {remote.upstream
                        ? (remote.ahead || remote.behind
                            ? <>
                                {remote.ahead > 0 && <b title={t('Commits here that are not on the remote')}>↑{remote.ahead}</b>}
                                {remote.behind > 0 && <b title={t('Commits on the remote that are not here')}>↓{remote.behind}</b>}
                              </>
                            : t('Up to date'))
                        : t('Not tracking a remote branch')}
                      {/* Counted from the last fetch, not from just now. A
                          number that silently means "an hour ago" is worse
                          than one that says so. */}
                      <em>{t('as of the last fetch')}</em>
                    </span>

                    <span className="gh-acts">
                      <button className="ghost" disabled={!!syncing || !git?.is_repo}
                              onClick={() => void sync('git_fetch', () => invoke<string>('git_fetch', { root }))}>
                        {syncing === 'git_fetch' ? t('Fetching') : t('Fetch')}
                      </button>
                      <button className="ghost" disabled={!!syncing || remote.behind === 0}
                              onClick={() => void sync('git_pull', () => invoke<string>('git_pull', { root }))}
                              title={t('Only when it can fast-forward. A merge or a rebase is your decision to make.')}>
                        {syncing === 'git_pull' ? t('Pulling') : t('Pull')}
                      </button>
                      <button className="approve" disabled={!!syncing || remote.ahead === 0}
                              onClick={() => void sync('git_push', () => invoke<string>('git_push', { root }))}>
                        {syncing === 'git_push' ? t('Pushing') : t('Push')}
                      </button>
                    </span>

                    {origin.isGitHub && remote.upstream && git?.branch && (
                      <button className="gh-pr"
                              onClick={() => browse(compareUrl(origin, 'main', git.branch))}>
                        <Icon name="link" size={12} />{t('Open a pull request')}
                      </button>
                    )}
                    {origin.isGitHub && (
                      <button className="gh-pr" onClick={() => browse(pullsUrl(origin))}>
                        <Icon name="diff" size={12} />{t('Pull requests')}
                      </button>
                    )}
                  </div>
                )}

                <div className="sb-sub">{t('Proposed')}</div>
                {changes.length === 0
                  ? <p className="ft-empty">{t('No proposed changes.')}</p>
                  : changes.map((c) => (
                      <button key={c.path} className="ft-row changed" onClick={() => openFile(c.path)} title={c.path}>
                        <span className="ft-icon"><Icon name="diff" size={13} /></span>
                        <span className="ft-name">{c.path.split('/').pop()}</span>
                        <span className="ft-dot" />
                      </button>
                    ))}

                {git?.is_repo && (
                  <>
                    <div className="sb-sub">{t('Working tree')}</div>
                    {tracked.length === 0
                      ? <p className="ft-empty">{t('Nothing changed since the last commit.')}</p>
                      : tracked.map((c) => (
                          <div key={c.path} className="ft-row wt-row" title={c.from ? `${c.from} → ${c.path}` : c.path}>
                            <button className="wt-tick" aria-pressed={picked.has(c.path)}
                                    aria-label={`${t('Select')} ${c.path}`}
                                    onClick={() => setPicked((p) => {
                                      const n = new Set(p);
                                      n.has(c.path) ? n.delete(c.path) : n.add(c.path);
                                      return n;
                                    })}>
                              {picked.has(c.path) && <Icon name="check" size={11} />}
                            </button>
                            <button className="ft-hit" onClick={() => void viewTracked(c.path)}>
                              <span className={`wt-code ${c.untracked ? 'new' : c.staged ? 'staged' : ''}`}>
                                {c.status.trim() || '·'}
                              </span>
                              <span className="ft-name">{c.path.split('/').pop()}</span>
                            </button>
                          </div>
                        ))}
                    {tracked.length > 0 && (
                      <div className="wt-commit">
                        <input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)}
                               onKeyDown={(e) => { if (e.key === 'Enter') void commitPicked(); }}
                               placeholder={t('Commit message')} aria-label={t('Commit message')} />
                        <button className="approve" disabled={busy || !picked.size || !commitMsg.trim()}
                                onClick={() => void commitPicked()}>
                          {t('Commit')} {picked.size || ''}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {shown === 'todo' && (
              <TodoPanel root={root} t={t}
                    onToChat={(text) => setPrompt((p) => (p.trim() ? `${p.trim()}\n${text}` : text))}
                    onToTerminal={(command) => void runStep(command)}
                    onOpenFile={(path) => openFile(path)}
                    onError={(m) => push({ kind: 'error', text: m })}
                    onLeft={setTodoLeft}
                    onExpand={() => {
                      setTabs((p) => (p.includes('__todo__') ? p : [...p, '__todo__']));
                      setActive('__todo__');
                    }} />
            )}

            {shown === 'memory' && (
              <>
                <button className={`ft-row ${active === '__memory__' ? 'on' : ''}`}
                        onClick={() => { setTabs((p) => p.includes('__memory__') ? p : [...p, '__memory__']); setActive('__memory__'); }}>
                  <span className="ft-icon"><Icon name="memory" size={13} /></span>
                  <span className="ft-name">{memory.file ?? t('Create memory file')}</span>
                </button>
                <p className="ft-empty">
                  {memory.file
                    ? t('Carried into every chat in this project.')
                    : t('Nothing remembered yet — write it yourself, or ask the agent to remember something.')}
                </p>
              </>
            )}

            {shown === 'chats' && (
              <>
                <Chats chats={chats} current={chatId} root={root} t={t}
                       onOpen={openChat} onDelete={removeChat}
                       onRenamed={() => { setChats(chatsIn(root)); setRecents(folders()); }} />
                {recents.length > 0 && (
                  <>
                    <div className="sb-sub">{t('Projects')}</div>
                    {recents.map((r) => (
                      <button key={r.folder} className={`ft-row ${r.folder === root ? 'on' : ''}`}
                              onClick={() => openFolder(r.folder)} title={r.folder}>
                        <span className="ft-icon"><Icon name="folder" size={13} /></span>
                        <span className="ft-name">{r.name}</span>
                        <span className="rc-meta">{r.chats}</span>
                      </button>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
    </>
  );

  return (
    <div className={`shell ${full ? 'fullscreen' : ''}`}>
      <header className="bar" data-tauri-drag-region>
        {IS_MAC && <TrafficLights full={full} t={t}
                                 onFullscreen={() => void toggleFullscreen().then(setFull)} />}
        <div className="brand">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <rect x="2" y="2" width="60" height="60" rx="13" fill="url(#g)" />
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#5C8FFF" /><stop offset=".55" stopColor="#2F7BF6" /><stop offset="1" stopColor="#1A5FDF" />
              </linearGradient>
            </defs>
            <path d="M17 22.5 L27 41.5 L37 22.5" fill="none" stroke="#fff" strokeWidth="5.2" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="43.4" y="21.5" width="4.6" height="21" rx="2.3" fill="#fff" fillOpacity=".92" />
          </svg>
          <b>Vylo Editor</b>
        </div>
        <button className="folder" onClick={pickFolder} title={root || t('No folder open')}>
          <Icon name="folder" size={14} />{folderName || t('Open folder…')}
        </button>
        {git?.is_repo && (
          <button className="ghost" onClick={() => void newBranch()}
                  title={t('Create a branch and switch to it')}>
            <Icon name="plus" size={11} />{t('New branch')}
          </button>
        )}
        {git?.is_repo && (
          <span className={`git ${git.dirty ? 'dirty' : ''}`}
                title={git.dirty
                  ? `${git.dirty} ${git.dirty === 1 ? t('file') : t('files')} `
                    + t('already modified before the agent touched anything')
                  : t('Working tree is clean')}>
            {git.branch}{git.dirty ? ` · ${git.dirty} ${t('modified')}` : ''}
          </span>
        )}
        <span className="bar-sp" />
        {/* Agent · Code · Chat · Terminal. In the title bar because it is about
            the whole window, not about the next message — that toggle stays in
            the composer. */}
        <span className="seg space" role="group" aria-label={t('Way of working')}>
          {(['code', 'chat', 'terminal'] as Space[]).map((sp) => (
            <button key={sp} className={space === sp ? 'on' : ''} aria-pressed={space === sp}
                    onClick={() => goTo(sp)}
                    title={t(sp === 'code' ? 'Terminals and files over this folder'
                      : sp === 'chat' ? 'A conversation not tied to a project'
                      : 'A shell, filling the window')}>
              {t(sp === 'code' ? 'Code' : sp === 'chat' ? 'Chat' : 'Terminal')}
            </button>
          ))}
        </span>
        <span className="bar-sp" />
        {/* One field across the middle, which is the whole of Phase O: seven
            boxes had seven placeholders and this has one. A button rather than
            an input — the palette owns the caret. */}
        <button className="find-field" onClick={() => setPalette('all')}
                aria-label={t('Search everything…')} aria-haspopup="dialog">
          <Icon name="search" size={13} />
          <span>{t('Search everything…')}</span>
          <kbd>{MOD}P</kbd>
        </button>
        <span className="bar-sp" />
        <button className={`ghost icon ${showTerm ? 'on' : ''}`} onClick={toggleTerm}
                title={`${t('Terminal')} · ${ALT}\``} aria-label={t('Terminal')}
                aria-pressed={showTerm}><Icon name="terminal" /></button>
        <div className="seg" role="group" aria-label={t('Theme')}>
          {(['light', 'system', 'dark'] as Theme[]).map((v) => {
            const name = t(v === 'light' ? 'Light' : v === 'dark' ? 'Dark' : 'Match system');
            return (
              <button key={v} className={theme === v ? 'on' : ''} onClick={() => setTheme(v)}
                      title={name} aria-label={name} aria-pressed={theme === v}>
                <Icon name={v === 'light' ? 'sun' : v === 'dark' ? 'moon' : 'auto'} size={14} />
              </button>
            );
          })}
        </div>
        <button className="ghost icon" onClick={() => void toggleFullscreen().then(setFull)}
                title={t(full ? 'Leave full screen' : 'Full screen')}
                aria-label={t(full ? 'Leave full screen' : 'Full screen')} aria-pressed={full}>
          <Icon name={full ? 'restore' : 'maximise'} />
        </button>
        <button className="ghost" onClick={() => setShowSettings((s) => !s)}>{t('Settings')}</button>
      </header>

      {/* Settings, as a modal over a dimmed window rather than a block that
          unrolled under the header and pushed the whole app down. The controls
          are the same ones and no longer a flat list; `settings.ts` is the
          catalogue and `SettingsPanel.tsx` draws it. */}
      {/* The one dialog the app draws for itself.  and
           do nothing in this webview — wry implements none of
          WKWebView's JavaScript panels — so thirteen actions silently did
          nothing, or silently answered no. */}
      <AskHost t={t} />
      {canDictate && (
        <PushToTalk
          t={t}
          setting={ptt}
          /* The engine's word on whether a session is running — and 'off' is
             the only phase that is not one. A 'stopping' engine still owes
             this app the phrase it was asked to finish: dictate.ts delivers
             that final result *while* stopping and `onText` puts it in the
             composer, so the session is alive in the only sense this pill
             claims.

             It was narrowed to 'starting'/'listening' to stop a re-press
             inside the stop's grace window from drawing "Listening — release
             to send" over a session `Dictation.start()` refuses to open. That
             cure tore down more than it fixed. The engine also stops itself
             after eight seconds of silence *mid-hold*, and the moment the
             phase went to 'stopping' PushToTalk's sync effect (`listening !==
             false`, PushToTalk.tsx) reset its reducer to IDLE with the key
             still down; the release then matched no held key, produced no
             'stop' action, and the sentence stayed in the composer. Told the
             truth, the reducer keeps believing in the hold, the release still
             reaches `onStop`, and the reconciliation happens one moment later
             when 'off' finally arrives. The re-press is handled where it
             happens instead, in `onStart` below. */
          listening={dict.phase !== 'off'}
          onStart={() => {
            const d = ensureDictation();
            /* `spoke` records what the *session* has heard, so only a press
               that actually opens one may clear it. Clearing on every press
               threw away an utterance already in flight: hold, say "ship it",
               release (`onStop` arms the send, the engine's final result is
               still coming), press again inside STOP_MS — the clear ran,
               `start()` refused as it must, and when 'off' arrived the send
               effect read `spoke === false` and stranded the sentence in the
               composer. 'starting' and 'listening' are the same story with a
               session already running: joining one is not opening one.

               And nothing else is done for a re-press. The send the pending
               session owes was armed by the release that stopped it, not by a
               key going down — a press is not a send, and a session ended by
               a chord or by the mic button deliberately leaves its words in
               the composer for a person to read, so arming from here would
               put them on the wire unasked. The reducer is left believing in
               a session it did not get for at most the grace window; 'off'
               turns `listening` false and its sync effect returns it to IDLE,
               so the pill cannot outlive the engine. */
            if (d.state.phase === 'off') spoke.current = false;
            // Called whatever the phase: `start()` is the one place that knows
            // when a session may open, and it no-ops in the three where one
            // may not.
            d.start();
          }}
          onStop={() => {
            // A release after the engine already ended (silence) has nothing to send.
            const d = dictation.current;
            if (!d || d.state.phase === 'off') return;
            sendOnEnd.current = true;
            d.stop();
          }}
          onCancel={() => dictation.current?.stop()}
          onKeyCodeSeen={(code) => setPttSeen((seen) => (seen.includes(code) ? seen : [...seen, code]))}
        />
      )}

      {signInOpen && (
        <div className="pal-back" onMouseDown={() => setSignInOpen(false)}>
          <div className="pal signin-modal" onMouseDown={(e) => e.stopPropagation()}
               role="dialog" aria-modal="true" aria-label={t('Sign in')}
               onKeyDown={(e) => { if (e.key === 'Escape') setSignInOpen(false); }}>
            <SignIn baseUrl={baseUrl} t={t}
                    onSignedIn={(tok, key) => {
                      // Same rule as the welcome screen: neither empty half may
                      // overwrite something live.
                      const next = adopted({ apiKey, token }, { apiKey: key, token: tok });
                      setToken(next.token);
                      setApiKey(next.apiKey);
                      setSignInOpen(false);
                    }} />
          </div>
        </div>
      )}

      {fileMenu && (
        <ContextMenu
          at={fileMenu.at}
          items={[
            /* Both, because the two answer different questions: the whole path
               is what a command outside this window needs, and the short one is
               what a person pastes into a message or a commit. */
            { kind: 'action', id: 'copyPath', label: 'Copy the path' },
            { kind: 'action', id: 'copyRel', label: 'Copy the path from the project' },
            { kind: 'divider' },
            ...(fileMenu.isDir
              ? [{ kind: 'action', id: 'new', label: 'New file here' } as MenuItem]
              : [{ kind: 'action', id: 'open', label: 'Open' } as MenuItem]),
            { kind: 'action', id: 'rename', label: 'Rename' },
            { kind: 'divider' },
            { kind: 'action', id: 'delete', label: 'Delete', danger: true },
          ]}
          t={t}
          label={`${t('Actions')} — ${nameOf(fileMenu.path)}`}
          onPick={(id) => {
            // The tree holds paths relative to the open folder — see the walk
            // in `walk.rs`. The whole path is that, under the root.
            const whole = `${root.replace(/[\\/]+$/, '')}/${fileMenu.path}`;
            if (id === 'copyPath') void navigator.clipboard.writeText(whole).catch(() => {});
            else if (id === 'copyRel') void navigator.clipboard.writeText(fileMenu.path).catch(() => {});
            else if (id === 'open') void openFile(fileMenu.path);
            else if (id === 'new') void newFile(fileMenu.path);
            else if (id === 'rename') void renameEntry(fileMenu.path);
            else if (id === 'delete') void deleteEntry(fileMenu.path, fileMenu.isDir);
          }}
          onClose={() => setFileMenu(null)}
        />
      )}

      {railMenu && (
        <ContextMenu
          at={railMenu.at}
          items={[
            { kind: 'action', id: 'dock',
              label: dockOf(modules, railMenu.id) === 'other' ? 'Show beside the rail' : 'Show on the other side' },
            { kind: 'divider' },
            { kind: 'action', id: 'off', label: 'Turn off', disabled: enabledModules(modules).length <= 1 },
          ]}
          t={t}
          label={`${t('Actions')} — ${t(labelOf(railMenu.id))}`}
          onPick={(id) => {
            if (id === 'dock') {
              const to = dockOf(modules, railMenu.id) === 'other' ? 'rail' : 'other';
              setModules((m) => dockModule(m, railMenu.id, to));
              // Open it where it went, so the move is visible at once.
              if (to === 'other') { setRightRail(railMenu.id); setRightOpen(true); }
              else { setRail(railMenu.id); setRailOpen(true); }
            } else if (id === 'off') {
              setModules((m) => toggleModule(m, railMenu.id));
            }
          }}
          onClose={() => setRailMenu(null)}
        />
      )}

      {tabMenu && (
        <ContextMenu
          at={tabMenu.at}
          items={tabItems(tabMenu.path)}
          t={t}
          label={`${t('Actions')} — ${nameOf(tabMenu.path)}`}
          onPick={(id) => void onTabMenu(tabMenu.path, id)}
          onClose={() => setTabMenu(null)}
        />
      )}

      {showSettings && (
        <SettingsPanel
          t={t}
          initial={settingsAt ?? undefined}
          onClose={() => { setShowSettings(false); setSettingsAt(null); }}
          providers={providers}
          onProviders={(next) => {
            setProviders(next);
            // The choice is repaired the moment its provider goes, not at the
            // next restart — otherwise the composer keeps showing a model
            // whose key was just deleted, and a freed id given to the next
            // provider added would silently rebind the stale choice to it.
            setChoice((c) => (c.provider === BUILT_IN || next.some((x) => x.id === c.provider)
              ? c : { provider: BUILT_IN, model }));
          }}
          auto={auto}
          onAuto={setAuto}
          ptt={ptt}
          onPtt={setPtt}
          pttSeen={pttSeen}
          modules={modules}
          onModules={setModules}
          baseUrl={baseUrl}
          onBaseUrl={setBaseUrl}
          apiKey={apiKey}
          onApiKey={setApiKey}
          token={token}
          signedInAs={signedInAs}
          onSignIn={() => { setShowSettings(false); setSignInOpen(true); }}
          plan={planChip}
          onSignOut={() => {
            // Signing out clears the session and *not* the API key: the key is
            // a separate credential that goes on working, it was minted for
            // this machine, and throwing it away because somebody pressed a
            // button labelled Sign out would take the app offline for a reason
            // nobody asked for. Revoking a key is a decision for the keys page.
            const dead = token;
            const next = signedOut({ apiKey, token });
            setToken(next.token);
            setApiKey(next.apiKey);
            void signOut(localStorage, baseUrl, dead);
          }}
          theme={theme}
          onTheme={setTheme}
          lang={lang}
          onLang={setLang}
          autocomplete={autocomplete}
          onAutocomplete={setAutocomplete}
          notify={notifyPrefs}
          onNotify={setNotifyTo}
          summon={summon}
          summonErr={summonErr}
          recording={recording}
          onRecording={(on) => { if (on) setSummonErr(''); setRecording(on); }}
          onSummonKey={recordSummon}
          onClearSummon={() => void setSummonTo(null)}
          root={root}
          mcpServers={mcpServers}
          mcpTools={mcpTools}
          mcpError={mcpError}
          onToggleServer={(s) => void toggleServer(s)}
          clips={clips}
          termBytes={termBytes}
          onEmptied={(id) => {
            // The window is still standing on these stores, and that is the
            // half of the Storage tab that would fail silently: Redo would
            // offer to put back contents that are gone, and the recovery
            // banner would offer drafts that no longer exist. Emptying the
            // clipboard history *is* this call rather than something that
            // follows one -- it is localStorage, not a directory Rust can see.
            if (id === 'clipboardHistory') { clearClips(localClips); setClips([]); }
            if (id === 'drafts') setDrafts([]);
            if (id === 'checkpoints') setRedoable(null);
            // Also localStorage, so emptying it *is* this call. The terminals
            // on screen keep running — this throws away what would have been
            // restored next time, not what is live now.
            if (id === 'terminals') {
              try { localStorage.removeItem(TERMS_KEY); } catch { /* private mode */ }
              setTermBytes(0);
            }
          }}
          update={update}
          updating={updating}
          onCheckUpdates={() => checkForUpdate().then(setUpdate)}
          onInstall={() => {
            if (!update) return;
            setUpdating(0);
            update.install((pct) => setUpdating(pct)).catch((e) => {
              setUpdating(null);
              push({ kind: 'error', text: explain(e, t('install the update')) });
            });
          }}
        />
      )}

      {/* `rail-end` moves the rail to the other edge by reordering the flex
          children. Which order that is depends on the writing direction, and
          `railFirst` is the one place that knows — see modules.ts. */}
      <div className={`body ${railFirst(modules.side, dirFor(lang)) ? '' : 'rail-end'}`}>
        <Rail
          /* One list, from `modules.ts`. The literal that used to be here was a
             copy of a list, and the copy drifted — see modules.ts. */
          items={enabledModules(modules).map((m) => ({
            id: m.id,
            icon: m.icon,
            label: t(m.label),
            badge: m.badge === 'changes' ? changes.length + tracked.length
              : m.badge === 'todo' ? todoLeft : undefined,
          }))}
          active={shown}
          alsoOn={rightOpen ? rightShown : null}
          collapsed={!railOpen}
          onSelect={pickRail}
          onMenu={(id, at) => setRailMenu({ id, at })}
          settings={() => setShowSettings((v) => !v)}
          settingsLabel={t('Settings')}
          label={t('Sections')}
        />

        {railOpen && leftIds.length > 0 && (
        <aside className="sidebar" style={{ width: sidebarW }}>
          {sideFor(shown)}
        </aside>
        )}

        {/* Draggable, double-clickable and focusable. The drag is how almost
            everybody will resize this; the other two are for the person who
            cannot hold a pointer steady on a ten-pixel strip, and for the one
            who has dragged it somewhere silly and wants out. */}
        {railOpen && leftIds.length > 0 && (
          <div className="divider" onMouseDown={() => {
            resizing.current = true;
            document.body.classList.add('resizing');
          }} role="separator" aria-orientation="vertical"
              tabIndex={0}
              aria-label={t('Resize the sidebar')}
              title={t('Drag to resize — double-click for the usual width')}
              onDoubleClick={() => setSidebarW(SIDEBAR_W)}
              onKeyDown={(e) => {
                // Physical, like the drag: this edge moves left and right on
                // the screen, and it does so in every language.
                const by = e.key === 'ArrowLeft' ? -DIVIDER_STEP : e.key === 'ArrowRight' ? DIVIDER_STEP : 0;
                if (!by) return;
                e.preventDefault();
                setSidebarW((w) => Math.min(SIDE_MAX, Math.max(SIDE_MIN, w + by)));
              }} />
        )}

        <div className="work" ref={work}>
          {!root && !(showTerm && termFull) && (
            // Either half may be empty, and neither empty one may overwrite
            // something live: a pasted key arrives with no token, and a
            // sign-in whose minting failed arrives with no key.
            <Welcome recents={recents} onOpen={pickFolder} onOpenFolder={openFolder}
                     apiKey={apiKey} baseUrl={baseUrl} t={t}
                     onSignedIn={(tok, key) => {
                       const next = adopted({ apiKey, token }, { apiKey: key, token: tok });
                       setToken(next.token);
                       setApiKey(next.apiKey);
                     }} />
          )}

          <div {...tabDrag.strip}
               className={`tabs ${tabDrag.strip.className} ${!root || (showTerm && termFull) ? 'gone' : ''}`}>
            {/* Shown only once there is a trail. A pair of permanently greyed
                arrows is chrome; a pair that appears when it can do something
                is an answer to "how do I get back". */}
            {(canBack(trail) || canForward(trail)) && (
              <span className="navb">
                <button disabled={!canBack(trail)} onClick={() => step('back')}
                        title={`${t('Back')} ${IS_MAC ? '⌃-' : 'Alt+←'}`} aria-label={t('Back')}>
                  <Icon name="chevron" size={13} />
                </button>
                <button disabled={!canForward(trail)} onClick={() => step('forward')}
                        title={`${t('Forward')} ${IS_MAC ? '⌃⇧-' : 'Alt+→'}`} aria-label={t('Forward')}>
                  <Icon name="chevron" size={13} />
                </button>
              </span>
            )}
            <button className={`tab ${active === 'chat' ? 'on' : ''}`} onClick={() => setActive('chat')}>
              {t('Chat')}
            </button>
            {arrangeTabs(tabs, pinned).map((path, i) => {
              const beside = panes.includes(path) && path !== active;
              return (
              <span key={path}
                    className={`tab ${tabDrag.itemClass(i)} ${active === path ? 'on' : ''} ${beside ? 'beside' : ''} ${isPinned(pinned, path) ? 'pinned' : ''} ${dirty.has(path) ? 'dirty' : ''}`}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setTabMenu({ path, at: { x: e.clientX, y: e.clientY } });
                    }}>
                {isPinned(pinned, path) && (
                  <Icon name="dot" size={8} className="tab-pin" aria-label={t('Pinned')} />
                )}
                <button className="tab-name" title={path}
                        onClick={() => {
                          setActive(path);
                          // Clicking a tab means "this one", as it always has.
                          // Showing it *as well* is the button beside it, so
                          // the ordinary click never has to be learnt twice.
                          if (!panes.includes(path)) setShownFiles([path]);
                        }}>
                  {path === '__memory__' ? (memory.file ?? t('Memory'))
                    : path === '__todo__' ? t('To do')
                    : path.split('/').pop()}
                  {dirty.has(path) && <i className="tab-dot" aria-label={t('Unsaved')} />}
                </button>
                {isFile(path) && (
                  <button className={`tab-split ${panes.includes(path) ? 'lit' : ''}`} data-nodrag
                          aria-pressed={panes.includes(path)}
                          disabled={!panes.includes(path) && panes.length >= MAX_PANES}
                          title={t(panes.includes(path) ? 'Hide this pane' : 'Show this alongside')}
                          aria-label={t(panes.includes(path) ? 'Hide this pane' : 'Show this alongside')}
                          onClick={() => splitTo(path)}>
                    <Icon name="split" size={11} />
                  </button>
                )}
                <button className="tab-x" onClick={() => closeTab(path)} data-nodrag
                        aria-label={`${t('Close')} ${path}`}><Icon name="close" size={12} /></button>
              </span>
            );})}
          </div>

          {/* Where the open file is.
              The tab says its name and the status bar says the whole path in
              the far corner, which is the one place nobody looks while
              reading code. Two files called `index.ts` are the ordinary case
              in any project, and the tab strip cannot tell them apart — so the
              folders live here, between the tabs and the text, where the eye
              already is.

              Relative to the open folder, because the part that repeats on
              every file is the part worth leaving out. Clicking a segment
              searches for it, which is the useful thing to do with a folder
              name you have just read. */}
          {isFile(active) && root && (
            <div className="crumbs" aria-label={t('Where this file is')}>
              {active.replace(root, '').replace(/^[\\/]+/, '').split(/[\\/]/).map((part, i, all) => (
                <Fragment key={`${part}-${i}`}>
                  {i > 0 && <Icon name="chevron" size={10} />}
                  {i === all.length - 1 ? (
                    <b>{part}</b>
                  ) : (
                    <button onClick={() => openFind(part)}
                            title={fill(t('Find {name}'), { name: part })}>{part}</button>
                  )}
                </Fragment>
              ))}
              <span className="bar-sp" />
              <button className="crumbs-copy" title={t('Copy the full path')}
                      aria-label={t('Copy the full path')}
                      onClick={() => void navigator.clipboard.writeText(active).catch(() => {})}>
                <Icon name="clipboard" size={11} />
              </button>
            </div>
          )}

          {/* The disk moved under a file with unsaved edits in it. A watcher
              that reloaded this on its own would destroy work with no undo
              entry and no warning, so it is a question. Clean tabs never reach
              here — they have already been reloaded. */}
          {asks.filter((a) => a.path === active).map((a) => (
            <div key={a.path} className="staged-bar stale disk-bar">
              <Icon name="warning" size={13} />
              <span>
                {a.kind === 'removed'
                  ? t('This file was deleted on disk.')
                  : t('This file changed on disk while you were editing it.')}
              </span>
              <span className="bar-sp" />
              {a.kind === 'changed' && (
                <button className="approve"
                        onClick={() => {
                          void editors.current.get(a.path)?.reload()
                            .catch((e) => push({ kind: 'error', text: explain(e, t('reload the file')) }));
                          setAsks((p) => p.filter((x) => x.path !== a.path));
                        }}>
                  {t('Reload')}
                </button>
              )}
              <button className="ghost"
                      onClick={() => setAsks((p) => p.filter((x) => x.path !== a.path))}>
                {t('Keep mine')}
              </button>
            </div>
          ))}

          {!root ? null : active === '__memory__' ? (
            <MemoryEditor root={root} memory={memory} onSaved={setMemory} t={t} />
          ) : active === '__todo__' ? (
            /* The same panel, given the window. The board especially needs it:
               eight columns in a 260px sidebar is eight columns nobody can
               read. Both copies stay in step because every write goes through
               `applyWrite`, which says so — see docs.ts. */
            <div className="todo-full">
              <TodoPanel root={root} t={t} wide lang={lang}
                    onToChat={(text) => { setActive('chat'); setPrompt((p) => (p.trim() ? `${p.trim()}\n${text}` : text)); }}
                    onToTerminal={(command) => void runStep(command)}
                    onOpenFile={(path) => openFile(path)}
                    onError={(m) => push({ kind: 'error', text: m })}
                    onLeft={setTodoLeft} />
            </div>
          ) : active !== 'chat' ? null : (
          <div className={`log ${showTerm && termFull ? 'gone' : ''}`} ref={log}
               role="log" aria-relevant="additions" aria-label={t('Conversation')}>
        {lines.length === 0 && (
          <div className="empty">
            <p className="empty-lead">{t('Ask about the code in this folder.')}</p>
            <p>{t('It can propose edits and run your tests — you approve every change and every command first.')}</p>
            <Shortcuts t={t} columns={1} />
          </div>
        )}
        {groupLines(lines).map((item, i) => Array.isArray(item) ? (
          <ToolRun key={i} run={item} t={t} />
        ) : (
          <div key={i} className={`line ${item.kind}`}>
            {item.shots && (
              <div className="shots sent">
                {item.shots.filter(isImage).map((a) => <img key={a.id} src={previewUrl(a)} alt={a.name} />)}
                {item.shots.filter(isText).map((a) => (
                  <span key={a.id} className="filechip" title={describe(a)}>{a.name}</span>
                ))}
              </div>
            )}
            {item.kind === 'error' && <span className="tag err">{t('error')}</span>}
            {item.kind === 'text'
              ? (
                <div className="body">
                  <Markdown text={item.text} apply={{
                    can: (info, before) => !!applyTarget(info, before, openFilePath, (p) => fileSet.has(p)),
                    run: (code, info, before) => void applyBlock(code, info, before),
                    label: t('Apply'),
                  }} />
                </div>
              )
              : <span className="body">{item.text}</span>}
            {item.cp && (
              <button className="undo-cp" disabled={busy}
                      onClick={() => void restore(i, item.cp!)}
                      title={t('Undo this change and everything after it?')}>
                <Icon name="restore" size={12} />{t('Undo this write')}
              </button>
            )}
            {/* Both raise `retrying` first: a retry is the same request as the
                turn it repeats, so in a routine's chat it goes out with that
                agent's brief and mode rather than the person's. */}
            {item.retry && (
              <button className="undo-cp" disabled={busy}
                      onClick={() => { retrying.current = true; void converse(); }}>
                <Icon name="restore" size={12} />{t('Try again')}
              </button>
            )}
            {item.more && (
              <button className="undo-cp" disabled={busy}
                      onClick={() => { retrying.current = true; void converse(); }}>
                <Icon name="send" size={12} />{t('Continue')}
              </button>
            )}
          </div>
        ))}
        {/* Undo cut away the lines its own button sat on, so redo stands where
            the transcript now ends, naming the write it would put back. */}
        {redoable && (
          <div className="line result redo-row">
            <span className="body">{t('Undone:')} {redoable.paths.join(', ')}</span>
            <button className="undo-cp" disabled={busy} onClick={() => void redo()}
                    title={t('Redo this change?')}>
              <Icon name="restore" size={12} />{t('Redo this write')}
            </button>
          </div>
        )}
        {busy && (
          <Working
            progress={progress}
            t={t}
            mode={t((turnMode ?? mode) === 'ask' ? 'Ask' : 'Agent')}
            model={MODELS.find((m) => m.id === wired.model)?.short ?? wired.model}
            context={ctx ? Math.round((ctx.used / ctx.limit) * 100) : null}
            onStop={() => abort.current?.abort()}
          />
        )}
          </div>
          )}

          {/* Every open file stays mounted. Unmounting on tab switch would
              throw away unsaved edits and the undo history with them. */}
          {files.length > 0 && !(showTerm && termFull) && (
            <Suspense fallback={<div className="vw-msg">{t('Opening…')}</div>}>
              {/* Every editor stays mounted whichever tab is active — that is
                  the invariant — but the *wrapper* claims flex:1, so with the
                  chat on screen it was an invisible box taking half the column
                  and the conversation was clipped into the other half. The
                  wrapper collapses when nothing in it can be visible; its
                  children stay mounted either way. */}
              <div ref={edRow} className={`ed-stack ${split ? 'split' : ''}`}
                   style={{ display: isFile(active) ? 'flex' : 'none' }}>
              {files.map((p) => {
              const at = panes.indexOf(p);
              return (
                <Fragment key={p}>
                <div className="tdiv" role="separator" aria-orientation="vertical"
                     tabIndex={at > 0 ? 0 : -1} aria-label={`${t('Resize')} — ${p}`}
                     style={{ display: at > 0 ? 'block' : 'none' }}
                     onPointerDown={(e) => dragEditors(e, at)}
                     onKeyDown={(e) => {
                       const by = e.key === 'ArrowLeft' ? -0.02 : e.key === 'ArrowRight' ? 0.02 : 0;
                       if (!by) return;
                       e.preventDefault();
                       setEdWeights((w) => afterDrag(panes, w, at, by));
                     }}
                     onDoubleClick={() => setEdWeights((w) => evened(panes, w))}
                     title={t('Drag to resize, double-click to even them out')} />
                <Editor
                  root={root}
                  path={p}
                  visible={panes.includes(p)}
                  dark={resolved(theme) === 'dark'}
                  // Read at mount only, so this is the restored caret for a
                  // reopened tab and never fights a later jump.
                  line={jump?.path === p ? jump.line : restoredLines.current.get(p)}
                  complete={() => ({
                    enabled: autocomplete,
                    baseUrl,
                    apiKey,
                    onStatus: setAcStatus,
                  })}
                  edit={() => ({ ...wired, memory: memoryPrompt(memory) })}
                  staged={changes.find((c) => c.path === p) ?? null}
                  recover={recovering.has(p)}
                  t={t}
                  onReady={(h) => { if (h) editors.current.set(p, h); else editors.current.delete(p); }}
                  onDefinition={(name) => void goToDefinition(name)}
                  onDirty={(path, isDirty) => setDirty((prev) => {
                    const next = new Set(prev);
                    if (isDirty) next.add(path); else next.delete(path);
                    return next;
                  })}
                  onSaved={(path) => {
                    // Ours, so the watcher's report of it is dropped: reloading
                    // the buffer somebody is typing in sends their caret to the
                    // end of the file.
                    selfWrites.current.note(path);
                    // And saving is the answer to "this changed on disk" —
                    // whichever way it was answered, the question is settled.
                    setAsks((p) => p.filter((x) => x.path !== path));
                    setWritten((prev) => [...new Set([...prev, path])]);
                  }}
                  onError={(m) => push({ kind: 'error', text: m })}
                  grow={at >= 0 ? shares(panes, edWeights)[at] * panes.length : 1}
                />
                </Fragment>
              );})}
              </div>
            </Suspense>
          )}

          {termMounted && (
            <>
              <div className={`hdiv ${showTerm && !termFull ? '' : 'gone'}`} role="separator" aria-orientation="horizontal"
                   onMouseDown={() => { sizingTerm.current = true; document.body.classList.add('resizing-v'); }} />
              <div className={`panel-wrap ${showTerm ? '' : 'gone'} ${termFull ? 'full' : ''}`}
                   style={termFull ? undefined : { height: termH }}>
                <Suspense fallback={<div className="panel-load">{t('Starting a shell…')}</div>}>
                <TerminalPanel
                  root={root}
                  dark={resolved(theme) === 'dark'}
                  t={t}
                  onSendToChat={fromTerminal}
                  expose={(getText) => { termText.current = getText; }}
                  exposeRun={(run: ((c: string) => Promise<CommandResult>) | null) => { termRun.current = run; }}
                  onAsk={askForCommand}
                  exposeDrop={(f) => { termDrop.current = f; }}
                  home={home}
                  onSessions={setSessions}
                  exposeFocus={(f) => { focusSession.current = f; }}
                  full={termFull}
                  onToggleFull={() => {
                    // The Terminal space *is* the terminal filling the window,
                    // so un-maximising it is a way of leaving — and the person
                    // is still looking at the shell, so it stays open.
                    if (space === 'terminal') {
                      leaveTerminal();
                      setTermFull(false);  // after leaveTerminal, so this wins
                      setShowTerm(true);   // they are still looking at the shell
                      return;
                    }
                    setTermFull((v) => !v);
                  }}
                  onClose={(drop) => {
                    if (space === 'terminal') leaveTerminal();
                    // Last, so it beats whatever `leaveTerminal` put back:
                    // closing the panel means closed, whatever it was before.
                    setShowTerm(false);
                    // `drop` tears the panel down, so its panes are gone. The
                    // list has to go with them or the one search field offers
                    // sessions that no longer exist and cannot be focused.
                    if (drop) { setTermMounted(false); setSessions([]); }
                  }}
                  onError={(m) => push({ kind: 'error', text: m })}
                />
                </Suspense>
              </div>
            </>
          )}
        </div>

        {/* The second sidebar, on the edge opposite the rail. Its divider is
            on its rail-facing side, so the drag reads the same way the left
            one does: pull toward the work to widen. */}
        {rightOpen && rightShown && (
          <>
            <div className="divider rdiv" onMouseDown={() => {
              resizingR.current = true;
              document.body.classList.add('resizing');
            }} role="separator" aria-orientation="vertical"
                tabIndex={0}
                aria-label={t('Resize the sidebar')}
                title={t('Drag to resize — double-click for the usual width')}
                onDoubleClick={() => setRightW(RIGHT_W)}
                onKeyDown={(e) => {
                  // The mirror image: this sidebar is on the other edge, so
                  // the arrow that widens it is the opposite one.
                  const by = e.key === 'ArrowRight' ? -DIVIDER_STEP : e.key === 'ArrowLeft' ? DIVIDER_STEP : 0;
                  if (!by) return;
                  e.preventDefault();
                  setRightW((w) => Math.min(SIDE_MAX, Math.max(SIDE_MIN, w + by)));
                }} />
            <aside className="sidebar right" style={{ width: rightW }}>
              {sideFor(rightShown, 'other')}
            </aside>
          </>
        )}
        {/* A rail for the other side, once there is something to choose
            between. One module docked there needs no tabs — the panel is
            the tab — but two or more were reachable only through the left
            rail's dimmer "also on" mark, which is a poor way to switch. The
            same component as the first rail, minus the Settings button,
            which belongs to one edge. */}
        {rightIds.length > 1 && (
          <Rail
            far
            items={docked(modules, 'other').map((m) => ({
              id: m.id,
              icon: m.icon,
              label: t(m.label),
              badge: m.badge === 'changes' ? changes.length + tracked.length
                : m.badge === 'todo' ? todoLeft : undefined,
            }))}
            active={rightShown ?? rightIds[0]}
            collapsed={!rightOpen}
            onSelect={pickRail}
            onMenu={(id, at) => setRailMenu({ id, at })}
            label={t('Sections on the other side')}
          />
        )}
      </div>

      {drafts.length > 0 && (
        <div className="update recover">
          <span className="up-txt">
            <b>
              {drafts.length === 1
                ? t('1 file was left unsaved')
                : `${drafts.length} ${t('files were left unsaved')}`}
            </b>
            <span className="up-notes">
              {drafts.map((d) => d.path.split('/').pop()).join(', ')}
            </span>
          </span>
          <div className="up-btns">
            <button className="ghost" onClick={discardDrafts}>{t('Discard them')}</button>
            <button className="approve" onClick={recoverDrafts}>{t('Reopen them')}</button>
          </div>
        </div>
      )}

      {update && (
        <div className="update">
          <span className="up-txt">
            <b>{t('Update available')}</b> — {update.version}
            {update.notes && <span className="up-notes">{update.notes}</span>}
          </span>
          <div className="up-btns">
            {updating === null ? (
              <>
                <button className="ghost" onClick={() => setUpdate(null)}>{t('Later')}</button>
                <button className="approve" onClick={() => {
                  setUpdating(0);
                  update.install((p) => setUpdating(p)).catch((e) => {
                    setUpdating(null);
                    push({ kind: 'error', text: explain(e, t('install the update')) });
                  });
                }}>{t('Install and restart')}</button>
              </>
            ) : (
              <span className="up-progress">
                {updating === 'done' || updating === 100
                  ? t('Restarting…')
                  : typeof updating === 'number' ? `${updating}%` : t('Downloading…')}
              </span>
            )}
          </div>
        </div>
      )}

      {askRun && (
        <div className="ask" role="alertdialog" aria-label={t('Command approval')}>
          <div className="ask-in">
            <div className="ask-txt">
              <span className="ask-lbl">
                {askRun.kind === 'mcp' ? t('Let this MCP tool run?') : t('Run this command?')}
              </span>
              <code>{askRun.command}</code>
              {askRun.reason && <span className="ask-why">{askRun.reason}</span>}
              <span className="ask-dir">{t('in')} {folderName}</span>
            </div>
            <div className="ask-btns">
              <button className="reject" onClick={() => decide.current?.('no')}>{t('Decline')}</button>
              {/* Not offered for anything the refuse-list caught. SAFETY says
                  those always ask, at every level, with no setting that turns
                  it off — and a button that quietly created such a setting was
                  the loudest way to break that promise. */}
              {!refusedFor(askRun.command) && (
                <button className="ghost keep" onClick={() => {
                  trusted.current.add(askRun.command);
                  decide.current?.('pipe');
                }}>{t('Always allow this')}</button>
              )}
              {/* The same approved string, on a surface you can watch and
                  interrupt. Not a second decision — the string was already read
                  and approved by the time either button is pressed. */}
              {termMounted && (
                <button className="ghost keep" onClick={() => decide.current?.('terminal')}>
                  {t('Run in terminal')}
                </button>
              )}
              <button className="approve" onClick={() => decide.current?.('pipe')}>{t('Run')}</button>
            </div>
          </div>
        </div>
      )}

      <Review changes={changes} onApprove={approve} onApproveHunks={approvePart}
              onReject={reject} busy={busy} t={t} />

      {git?.is_repo && written.length > 0 && (
        <div className="commit">
          <span className="cm-lbl">
            {written.length} {written.length === 1 ? t('file written') : t('files written')}
          </span>
          <input
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void commit(); }}
            placeholder={t('Commit message')}
            aria-label={t('Commit message')}
          />
          <button className="ghost" onClick={() => setWritten([])} disabled={busy}>{t('Not now')}</button>
          <button className="approve" onClick={() => void commit()} disabled={busy || !commitMsg.trim()}>
            {t('Commit to')} {git.branch}
          </button>
        </div>
      )}


      {quitting && (
        <div className="ask quit" role="alertdialog" aria-label={t('Unsaved work')}>
          <div className="ask-in">
            <div className="ask-txt">
              <span className="ask-lbl">{t('Leave without saving?')}</span>
              {quitting.dirty.length > 0 && (
                <span className="ask-why">
                  {t('Unsaved')}: {quitting.dirty.map((p) => p.split('/').pop()).join(', ')}
                </span>
              )}
              {quitting.staged > 0 && (
                <span className="ask-why">
                  {quitting.staged} {quitting.staged === 1 ? t('proposed change') : t('proposed changes')} {t('will be discarded.')}
                </span>
              )}
              {quitting.busy && <span className="ask-why">{t('A reply is still being written.')}</span>}
              {quitError && <span className="ask-why err">{quitError}</span>}
            </div>
            <div className="ask-btns">
              <button className="ghost keep" onClick={() => setQuitting(null)}>{t('Stay')}</button>
              <button className="reject" onClick={quitNow}>{t('Leave anyway')}</button>
              {quitting.dirty.length > 0 && (
                <button className="approve" onClick={() => void saveAllAndQuit()}>
                  {t('Save and leave')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {palette === 'open' && (
        <QuickOpen entries={tree} onOpen={(p) => openAt(p)} onClose={() => setPalette(null)} t={t} />
      )}
      {palette === 'all' && (
        <Everything
          root={root}
          t={t}
          sources={{
            files: tree.filter((e) => !e.is_dir).map((e) => e.path),
            symbols,
            chats,
            sessions,
            commands,
            active: isFile(active) ? active : null,
            term: t('Terminal'),
          }}
          onOpen={(path, line) => openAt(path, line)}
          onChat={(id) => { const c = chats.find((x) => x.id === id); if (c) openChat(c); }}
          onTerminal={(id) => { setTermMounted(true); setShowTerm(true); focusSession.current?.(id); }}
          onSetting={(_id, category) => { setSettingsAt(category); setShowSettings(true); }}
          onCommand={(id) => {
            // Deferred by one turn of the loop, which is what makes the note on
            // `runCommand` true. `Everything` dispatches and *then* closes, so a
            // command that opens another palette — four of the fifteen do —
            // would have its `setPalette` overwritten by `onClose`'s in the same
            // batch, and would silently do nothing.
            window.setTimeout(() => runCommand(id), 0);
          }}
          onClose={() => setPalette(null)}
        />
      )}
      {(palette === 'symbols' || palette === 'fileSymbols' || palette === 'defs') && (
        <Symbols symbols={symbols} scope={palette === 'fileSymbols' ? active : null}
                 onOpen={navigateTo} onClose={() => setPalette(null)} t={t} />
      )}
      {palette === 'find' && (
        <FindInFiles root={root} initial={findSeed} onSearched={rememberSearch}
                     onOpen={openAt} onClose={() => setPalette(null)}
                     onReplace={replaceEverywhere} t={t} />
      )}

      {/* Clipboard history. Never rendered empty: the button that opens it is
          disabled when there is nothing held, so there is no state in which the
          only way out is the mouse. */}
      {clipsOpen && clips.length > 0 && (
        <div className="pal-back" onMouseDown={closeClips}>
          <div className="pal" role="dialog" aria-modal="true" aria-label={t('Clipboard history')}
               onMouseDown={(e) => e.stopPropagation()}
               onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); closeClips(); } }}>
            <div className="pal-list">
              {clips.map((c, i) => (
                <button key={`${c.at}_${c.full}_${i}`} className="pal-row clip-row"
                        autoFocus={i === 0} onClick={() => insertClip(c.text)}>
                  <span className="clip-text" title={c.text}>{clipPreview(c.text)}</span>
                  <span className="clip-meta">
                    <span>{ago(c.at, t)}</span>
                    {shortened(c) && (
                      <b title={t('Only the first part of this paste was kept.')}>{t('shortened')}</b>
                    )}
                  </span>
                </button>
              ))}
            </div>
            <div className="clip-foot">
              <span className="clip-note">
                {t('Only what you paste into Vylo is kept. Your clipboard is never read.')}
              </span>
              <button className="clip-clear"
                      onClick={() => { clearClips(localClips); setClips([]); closeClips(); }}>
                {t('Clear')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restoring writes the file, so the open buffer has to be told: it is
          still holding the version that was just replaced and would write it
          straight back over the restore on the next save. Same reason the
          checkpoint restore above reloads every editor. */}
      {versionsFor && root && (
        <FileHistory root={root} path={versionsFor} dirty={dirty.has(versionsFor)}
                     onClose={() => setVersionsFor(null)}
                     onRestored={(p) => void editors.current.get(p)?.reload()
                       .catch((e) => push({ kind: 'error', text: explain(e, t('reload the file')) }))}
                     t={t} />
      )}

      {dragging && <div className="dropzone"><span>{t('Drop a folder to open it, or files to attach')}</span></div>}

      {/* Hidden rather than unmounted in the Terminal space: `display:none`
          takes it out of the tab order and off the screen, which is what was
          asked, while a half-written message and the caret inside it survive
          going to the shell and coming back. */}
      {root && (
      <div className={`composer ${space === 'terminal' || !askOpen ? 'gone' : ''}`}>
        <div className="cmp-card">
          {/* Up is taller. Double-click hands the height back to the text. */}
          <div className="cmp-grip" role="separator" aria-orientation="horizontal" tabIndex={0}
               title={t('Drag to resize — double-click to grow with the text again')}
               aria-label={t('Resize the message box')}
               onPointerDown={dragComposer}
               onDoubleClick={() => setCmpH(null)}
               onKeyDown={(e) => {
                 const by = e.key === 'ArrowUp' ? 16 : e.key === 'ArrowDown' ? -16 : 0;
                 if (!by) return;
                 e.preventDefault();
                 setCmpH((h) => Math.min(Math.max((h ?? composer.current?.getBoundingClientRect().height ?? 80) + by, 80),
                   Math.round(window.innerHeight * 0.6)));
               }}>
            <i aria-hidden="true" />
          </div>
          {/* What is waiting, in the order it will be sent. Inside the card
              rather than in the transcript: none of it has been said to the
              agent yet, and drawing it in the conversation would show the agent
              being told something it has not been told. */}
          {queued(queue).length > 0 && (
            <div className="qlist" role="group" aria-label={t('Queued')}>
              <div className="qhead">
                <span>{t('Queued')}</span>
                <button className="qclear" onClick={() => setQueue(clearQueue)}>{t('Clear')}</button>
              </div>
              {queued(queue).map((item) => {
                // Said now rather than when the turn ends: a refusal you can
                // still do something about is worth more than one you are told
                // about nine hops later.
                const gone = isStale(item, convoNow);
                return (
                  <div key={item.id} className={`qrow ${item.mode === 'now' ? 'now' : ''} ${gone ? 'gone' : ''}`}>
                    <Icon name={item.mode === 'now' ? 'stop' : 'pause'} size={12} />
                    <span className="qtext" title={item.text}>{item.text}</span>
                    {gone && <span className="qwhy">{t('Written in another conversation')}</span>}
                    <button className="qx" onClick={() => setQueue((p) => unqueue(p, item.id))}
                            title={t('Remove from the queue')} aria-label={t('Remove from the queue')}>
                      <Icon name="close" size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
                  {(shots.length > 0 || mentioned.length > 0) && (
            <div className="tray">
              {/* Derived from the text, so deleting the word removes the chip. */}
              {mentioned.map((m) => (
                <span className="chip mention" key={m.raw} title={m.raw}>
                  <Icon name={m.kind === 'terminal' ? 'terminal' : m.kind === 'folder' ? 'folder' : 'file'} size={13} />
                  <span className="nm">{m.kind === 'terminal' ? t('Terminal') : m.path}</span>
                </span>
              ))}
              {shots.map((a) => (
                <div className={`chip ${a.kind}`} key={a.id} title={describe(a)}>
                  {isImage(a) ? <img src={previewUrl(a)} alt="" /> : <span className="doc"><Icon name="file" size={14} /></span>}
                  <span className="nm">{a.name}</span>
                  <button onClick={() => setShots((p) => p.filter((x) => x.id !== a.id))}
                          aria-label={`${t('Remove')} ${a.name}`}><Icon name="close" size={12} /></button>
                </div>
              ))}
            </div>
          )}
          {mention && mentionHits.length > 0 && (
            <div className="mpick" role="listbox" aria-label={t('Mention a file')}>
              {mentionHits.map((h, i) => (
                <button key={h.path} role="option" aria-selected={i === mentionPick}
                        className={`mpick-row ${i === mentionPick ? 'on' : ''}`}
                        onMouseEnter={() => setMentionPick(i)}
                        onMouseDown={(e) => { e.preventDefault(); chooseMention(h.path); }}>
                  <Icon name={h.kind === 'terminal' ? 'terminal' : h.kind === 'folder' ? 'folder' : 'file'} size={13} />
                  <span className="mpick-name">{h.path.split('/').pop()}</span>
                  <span className="mpick-dir">{h.path.includes('/') ? h.path.slice(0, h.path.lastIndexOf('/')) : ''}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={composer}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              const caret = e.target.selectionStart ?? e.target.value.length;
              const q = mentionQuery(e.target.value, caret);
              setMention(q ? { ...q, caret } : null);
              setMentionPick(0);
            }}
            onBlur={() => setMention(null)}
            onKeyDown={(e) => {
              // While the picker is up it owns the arrows and Enter; without
              // this, Enter would send a message with a half-typed mention in it.
              if (mention && mentionHits.length) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setMentionPick((i) => Math.min(mentionHits.length - 1, i + 1)); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); setMentionPick((i) => Math.max(0, i - 1)); return; }
                if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); chooseMention(mentionHits[mentionPick].path); return; }
                if (e.key === 'Escape') { e.preventDefault(); setMention(null); return; }
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                // One chord, doing whichever of the two things the state of the
                // app makes sensible: send when nothing is running, queue when
                // something is. Shift makes it the kind that stops the turn.
                if (busy) queueMessage(e.shiftKey ? 'now' : 'after');
                else void send();
              }
            }}
            placeholder={t(busy ? 'Queue a message for when this turn ends…' : 'Ask about this codebase…')}
            rows={2}
          />

          <div className="cmp-bar">
            <button className="cmp-btn" onClick={() => void attach()} disabled={busy}
                    title={t('Attach a file')} aria-label={t('Attach a file')}>
              <Icon name="attach" size={15} />
            </button>

            {/* A region on a click, a window on ⌥/Alt-click. One button with a
                modifier rather than two: the bar is already five controls wide,
                and on macOS the crosshair itself offers Space for a window, so
                a second button would be advertising what the OS already does. */}
            <button className="cmp-btn" disabled={busy}
                    onClick={(e) => void capture(e.altKey ? 'window' : 'region')}
                    title={`${t('Take a screenshot')} · ${IS_MAC ? t('hold Option for a window') : t('hold Alt for a window')}`}
                    aria-label={t('Take a screenshot')}>
              <Icon name="camera" size={15} />
            </button>

            <button className="cmp-btn" onClick={openClips} disabled={busy || clips.length === 0}
                    title={t('Clipboard history')} aria-label={t('Clipboard history')}>
              <Icon name="clipboard" size={15} />
            </button>

            {canDictate && (
              <button className={`cmp-btn mic ${dict.phase === 'off' ? '' : 'on'}`}
                      onClick={dictate} disabled={busy}
                      aria-pressed={dict.phase !== 'off'}
                      title={t(dict.phase === 'off' ? 'Dictate' : 'Stop dictating')}
                      aria-label={t(dict.phase === 'off' ? 'Dictate' : 'Stop dictating')}>
                <Icon name="mic" size={15} />
              </button>
            )}
            {dict.error ? (
              <span className="dict-say bad">{t(dict.error)}</span>
            ) : dict.phase !== 'off' && (
              /* The engine's guess, still provisional -- only finalised words
                 are put in the message. */
              <span className="dict-say">{dict.interim || t('Listening…')}</span>
            )}

            {/* Inline, because which model is answering changes what the reply
                costs and how good it is, and that is a per-question decision —
                not a setting you configure once and forget. */}
            {/* Ask is a smaller tool array, not an instruction — see agent.ts.
                It sits beside the model picker because both change what the
                next message will cost and what it can do. */}
            <span className="seg cmp-mode" role="group" aria-label={t('Mode')}>
              {mode === 'chat' ? (
                /* A way out, not a label.
                   This was disabled, and that is how somebody asked the model
                   to create a file, was told "switch to Code mode", and had
                   nothing on screen that would do it — the one control saying
                   Chat could not be pressed, and the one saying Agent was in
                   the title bar meaning something else entirely. Pressing it
                   now is the answer the model gave. */
                <button className="on" aria-pressed
                        onClick={() => goTo('code')}
                        title={t('Sandboxed — press to work on this folder')}>
                  {t('Chat')}
                </button>
              ) : (['ask', 'agent'] as Mode[]).map((m) => (
                <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}
                        aria-pressed={mode === m}
                        title={t(m === 'ask' ? 'Reads only — cannot change anything' : 'Can propose edits and ask to run commands')}>
                  {t(m === 'ask' ? 'Ask' : 'Agent')}
                </button>
              ))}
            </span>

            <span className="cmp-model">
              {/* Live while a turn runs. `runAgent` was handed the model when
                  the turn started, so changing it now decides the next one —
                  which is exactly the decision you make when you can see this
                  one going wrong. */}
              {/* One menu across every provider. The value is an index into a
                  flat list rather than a joined string, because a model id can
                  contain any separator somebody might choose to join on. */}
              {(() => {
                const menu = [
                  ...MODELS.map((m) => ({ provider: BUILT_IN, model: m.id, label: m.short })),
                  ...providers.flatMap((p) => p.models.map((pm) => ({ provider: p.id, model: pm, label: pm }))),
                ];
                const at = menu.findIndex((x) => x.provider === choice.provider && x.model === choice.model);
                return (
                  <select value={at >= 0 ? String(at) : 'custom'}
                          onChange={(e) => {
                            const c = menu[Number(e.target.value)];
                            if (c) setChoice({ provider: c.provider, model: c.model });
                          }}
                          aria-label={t('Model')}>
                    {/* A model the plan cannot run is shown and disabled rather than
                        hidden: hiding it makes the gateway's refusal a mystery, and the
                        list is also the answer to "what would upgrading get me". `allows`
                        treats a plan that named no models as allowing everything, so an
                        older gateway greys out nothing. */}
                    {MODELS.map((m, i) => {
                      const ok = allows(plan, m.id);
                      return (
                        <option key={m.id} value={String(i)} disabled={!ok}>
                          {ok ? m.short : `${m.short} — ${t('not on your plan')}`}
                        </option>
                      );
                    })}
                    {providers.filter((p) => p.models.length).map((p) => (
                      <optgroup key={p.id} label={p.name}>
                        {p.models.map((pm) => {
                          const i = menu.findIndex((x) => x.provider === p.id && x.model === pm);
                          return <option key={pm} value={String(i)}>{pm}</option>;
                        })}
                      </optgroup>
                    ))}
                    {at < 0 && <option value="custom">{choice.model}</option>}
                  </select>
                );
              })()}
              <Icon name="chevron" size={11} turn={90} />
            </span>

            <span className="cmp-hint">{SEND_KEY}</span>

            {busy ? (
              <>
                {/* Only while there is something to queue. A disabled button
                    beside Stop on every turn is a control that does nothing
                    almost all the time. */}
                {prompt.trim().length > 0 && (
                  <button className="send queue"
                          onClick={(e) => queueMessage(e.shiftKey ? 'now' : 'after')}
                          title={t('Send this when the turn ends · hold Shift to stop the turn and send it now')}>
                    {t('Queue')}<Icon name="pause" size={13} />
                  </button>
                )}
                <button className="send stop" onClick={() => abort.current?.abort()}>
                  <Icon name="stop" size={13} />{t('Stop')}
                </button>
              </>
            ) : (
              <button className="send" onClick={() => void send()}
                      disabled={!prompt.trim() && shots.length === 0}>
                {t('Send')}<Icon name="send" size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
      )}

      <footer className="status" aria-label={t('Status')}>
        <span><span className={`dotm ${apiKey ? '' : 'off'}`} />{busy ? t('working…') : apiKey ? t('Ready') : t('No API key')}</span>
        {/* The balance, and only when there is a real one to show. `unknown` is
            "we could not tell", which is not something to put in a status bar —
            a wrong figure about money is worse than no figure. An unmetered
            plan says so rather than showing a zero, which would tell the
            customer paying the most that they had run out. */}
        {planChip && (
          <span className={`planm ${planChip.level}`}
                title={t('What your plan has left this period')}>
            <b>{planChip.name ?? t('No plan')}</b>
            {planChip.tail === 'left' ? ` ${planChip.left} ${t('left')}`
              : planChip.tail === 'days' && planChip.days !== null
                ? ` ${fill(planChip.days === 0 ? t('ends today')
                    : planChip.days === 1 ? t('1 day left') : t('{n} days left'), { n: planChip.days })}`
              : planChip.tail === 'no-limit' ? ` ${t('no limit')}` : ''}
          </span>
        )}
        {/* Lines, not files. "3 modified" is the count of a thing nobody
            wonders about — three files could be three characters or three
            rewrites — and these two numbers are staged and unstaged summed, so
            they cover what is already `git add`ed as well. A binary file has no
            line count at all, so it is said out loud rather than folded into
            the zeros. */}
        {git?.is_repo && (
          <span><b>{git.branch}</b>
            {stat && !noChanges(stat) && (
              <span className="dstat" dir="ltr"
                    title={t('Lines added and removed, staged and unstaged together')}>
                <span className="add">+{stat.added}</span>
                <span className="del">−{stat.removed}</span>
              </span>
            )}
            {stat && stat.binary > 0 && (
              <span>{fill(stat.binary === 1 ? t('{n} binary file') : t('{n} binary files'),
                          { n: stat.binary })}</span>
            )}
          </span>
        )}
        <span>{root ? folderName : t('No folder')}</span>
        {changes.length > 0 && <span><b>{changes.length}</b> {t('to review')}</span>}
        {total(lastTurn) > 0 && (
          <span title={t('Tokens used by the last turn')}>{summarise(lastTurn)}</span>
        )}
        {total(chatTokens) > 0 && (
          <span title={t('Tokens used by this conversation')}>
            <Icon name="bolt" size={11} />{compact(total(chatTokens))}
          </span>
        )}
        {/* Only once it is worth knowing. A fresh chat sits near a tenth of the
            window on the tool schemas alone, and reporting that is noise. */}
        {ctx && ctx.used / ctx.limit >= 0.5 && (
          <span className={`ctxm ${ctx.used / ctx.limit >= 0.85 ? 'hot' : ''}`}
                title={t('How full the model context is')}>
            {Math.round((ctx.used / ctx.limit) * 100)}% {t('context')}
          </span>
        )}
        {/* Unmissable while it is on, and a way back off in one click.
            A mode that relaxes the rule the app rests on must not be something
            you can forget is running — the whole point is that nothing else
            will stop and tell you. */}
        {autoOn(auto) && (
          <button className="st-auto" onClick={() => { setSettingsAt('approval'); setShowSettings(true); }}
                  title={t(LEVEL_LABEL[auto])}>
            <Icon name="bolt" size={12} />
            {t(auto === 'all' ? 'Running without asking' : 'Applying without asking')}
          </button>
        )}
        <span className="sp" />
        {isFile(active) && (
          <span className={`ac ac-${acStatus}`} title={t('Inline completion')}>
            <Icon name={acStatus === 'thinking' ? 'ellipsis' : acStatus === 'cooldown' ? 'pause'
                       : acStatus === 'error' ? 'warning' : 'bolt'} size={13} />
          </span>
        )}
        {openFilePath && (
          <button className="st-btn" onClick={() => setVersionsFor(openFilePath)}
                  title={t('Earlier versions of this file')}>
            <Icon name="restore" size={12} />{t('History')}
          </button>
        )}
        {/* Only when it is not 100%. Somebody who zoomed by accident — the
            chord is next to several others — otherwise has a window that looks
            wrong with nothing on screen saying why, and clicking this is the
            way back. */}
        {zoom !== ZOOM_NORMAL && (
          <button className="st-btn" onClick={() => setZoom(ZOOM_NORMAL)}
                  title={t('Back to the normal size')}>
            <Icon name="maximise" size={12} />{fill(t('{n}%'), { n: zoomPercent(zoom) })}
          </button>
        )}
        <button className="st-btn" onClick={() => openFind()}>
          <Icon name="search" size={12} />{t('Search')}
        </button>
        {/* Not in the Terminal space: that space is the shell filling the
            window, so a control that promises the message box back would be
            promising something the space does not do. */}
        {space !== 'terminal' && (
          <button className={`st-btn ${askOpen ? 'on' : ''}`} onClick={() => setAskOpen((v) => !v)}
                  aria-pressed={askOpen}
                  title={t(askOpen ? 'Hide the message box' : 'Show the message box')}>
            <Icon name="chat" size={12} />{t('Ask')}
          </button>
        )}
        <button className="st-btn" onClick={toggleTerm}>
          <Icon name="terminal" size={12} />{t('Terminal')}
        </button>
        {isFile(active) && (
          <span title={active}>{active}{dirty.has(active) && <Icon name="dot" size={9} />}</span>
        )}
        <span>{model}</span>
        <span>{resolved(theme) === 'dark' ? t('Dark') : t('Light')}</span>
      </footer>
    </div>
  );
}
