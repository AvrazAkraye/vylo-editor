import { Channel, invoke } from '@tauri-apps/api/core';

/**
 * What to do when the disk moves underneath the app.
 *
 * Vylo ships its own terminal, so the folder on screen is changed by the person
 * using it several times an hour — `git checkout`, `git pull`, `npm install`, a
 * build — and until now none of it was visible. The sidebar went on listing
 * files that had been deleted, the status bar kept a branch that had been
 * switched away from, and an open tab kept showing a version that was
 * overwritten ten minutes ago. Reopening the folder was the only cure.
 *
 * `watch.rs` is the event source. This is the policy: given one batch of
 * changes and the state of the open tabs, what gets reloaded, what a human is
 * asked about, and what is ignored. It is a module of its own rather than a
 * handler inside `App.tsx` because its wrong answers are silent and expensive,
 * and a pure function of two arguments can be argued with in a test file.
 *
 * ## The rule that decides the shape of this file
 *
 * **A watcher must never silently overwrite a dirty buffer.** A reload is a
 * full-document replace; run against unsaved work it destroys it, with no undo
 * entry the person made and no warning that anything happened. So a clean tab
 * is reloaded and a dirty one is *offered* the reload, in a bar the same shape
 * as the staged-proposal bar. That split is what [`plan`] exists to compute,
 * and it is the case the tests lean on hardest.
 *
 * ## Why the app's own writes are muted
 *
 * Approving a diff, saving a buffer and restoring a checkpoint all write to the
 * disk, and the watcher reports them like anything else. Reloading a clean tab
 * that this app has just written is not merely wasted work: the reload replaces
 * the whole document, and CodeMirror maps the caret through that change, so
 * saving a file would send the cursor to the end of it. [`SelfWrites`] is the
 * app saying "that one was me", and events it claims are dropped before
 * anything else looks at them.
 *
 * It is a short window on purpose. Muting for longer would start swallowing
 * genuine outside changes that happen to land just after a save, and a missed
 * change is the defect this whole item exists to fix.
 *
 * ## Two kinds, not five
 *
 * `notify` reports Create, Modify, Remove and a dozen sub-kinds, and they are
 * not comparable across backends: FSEvents coalesces a burst into one flag,
 * ReadDirectoryChangesW splits a rename into two events, and an editor that
 * saves by writing a temp file and renaming it produces a different sequence on
 * each. What *is* reliably true is whether the path is there now, which is also
 * the only distinction anything downstream acts on — a file that exists is
 * re-read, a file that does not is gone. `watch.rs` stats each path once at the
 * end of the batch and sends that.
 */

/** Whether the path is there now. See the header for why there are only two. */
export type Kind = 'changed' | 'removed';

export interface Change {
  /** Relative to the workspace root, in whatever separators Rust produced. */
  path: string;
  kind: Kind;
}

/** One debounced batch, as `watch.rs` emits it. */
export interface Batch {
  changes: Change[];
  /**
   * More paths changed than one batch will carry. The list is a sample, not the
   * whole story, so nothing may be concluded from a path's *absence* from it.
   */
  truncated: boolean;
}

/** An open editor tab, as far as this needs to know. */
export interface Tab {
  path: string;
  /** Has unsaved edits. The one input that changes what happens to it. */
  dirty: boolean;
}

export interface State {
  tabs: readonly Tab[];
  /** Paths with a staged proposal — `Pending.list().map(c => c.path)`. */
  staged: readonly string[];
  /**
   * The app's own recent writes, so they are not reported back to it. Anything
   * with a `claims` method does; [`SelfWrites`] is the real one.
   */
  ours?: { claims(path: string): boolean };
}

export interface Plan {
  /** Clean tabs to re-read. Safe: there is nothing unsaved to lose. */
  reload: string[];
  /**
   * Dirty tabs whose file moved, and clean tabs are never in here. Each one is
   * a bar offering reload-or-keep; the human decides.
   */
  ask: Change[];
  /** Clean tabs whose file is gone. Nothing to reload and nothing to lose. */
  close: string[];
  /**
   * Staged proposals whose file moved. `Pending.restage` rebuilds the diff on
   * top of what is there now — dropping the proposal instead would throw away
   * a turn's work because somebody ran `git pull`.
   */
  restage: string[];
  /** Redraw the file tree. */
  tree: boolean;
  /** Re-run `git_state` and `git_status`. */
  git: boolean;
}

const NOTHING: Plan = { reload: [], ask: [], close: [], restage: [], tree: false, git: false };

/**
 * Compare two workspace-relative paths.
 *
 * Not the same as `a === b`, and the difference is a real Windows bug rather
 * than tidiness: the watcher's paths come from the filesystem, so they carry
 * backslashes there, while a staged path was written by the *model*, which
 * says `src/app.ts` on every platform. Compared literally, no staged proposal
 * would ever be re-based on Windows and the diff would go stale in silence.
 */
function same(a: string, b: string): boolean {
  return a.replace(/\\/g, '/') === b.replace(/\\/g, '/');
}

/**
 * Anything inside the repository's own `.git`.
 *
 * `watch.rs` drops almost all of it — a single `git status` writes several
 * files in there and a fetch writes thousands — and lets exactly `HEAD` and
 * `index` through, because those two are how a branch switch and a staging
 * change announce themselves when no working-tree file was touched. They are
 * git news and nothing else: never a tab, never the tree.
 */
function isGitMeta(path: string): boolean {
  const p = path.replace(/\\/g, '/');
  return p === '.git' || p.startsWith('.git/');
}

/**
 * The last word about each path in the batch.
 *
 * A save that writes a temp file and renames it over the target arrives as
 * several events for one path, and the only one that is true is the last.
 * Insertion order is kept so the plan a batch produces is the same every time,
 * which is what makes it testable.
 */
export function collapse(changes: readonly Change[]): Change[] {
  const out: Change[] = [];
  const at = new Map<string, number>();
  for (const c of changes) {
    const key = c.path.replace(/\\/g, '/');
    const i = at.get(key);
    // Overwritten where it first appeared rather than pushed again: the last
    // word about a path is the true one, and its position in the batch is not
    // information about anything.
    if (i === undefined) { at.set(key, out.length); out.push({ ...c }); }
    else out[i] = { ...c };
  }
  return out;
}

/**
 * What this batch means for the app.
 *
 * Pure, and takes everything it needs, so every argument about whether a
 * reload was right to happen is settled by a line in `test/watch.test.mjs`
 * rather than by running the app and hoping to catch it.
 */
export function plan(batch: Batch, state: State): Plan {
  const ours = state.ours;
  const changes = collapse(batch.changes).filter((c) => !(ours?.claims(c.path) ?? false));

  // A truncated batch says the world moved and does not say where. The only
  // honest response is to treat every open tab and every staged proposal as
  // affected: this is `git checkout` across a large branch, and the odds that
  // the file you are looking at is untouched are not worth betting unsaved work
  // on. Clean tabs are reloaded — a caret reset is a small price beside showing
  // the wrong file — and dirty ones are still only ever asked about.
  if (batch.truncated) {
    return {
      reload: state.tabs.filter((t) => !t.dirty).map((t) => t.path),
      ask: state.tabs.filter((t) => t.dirty).map((t) => ({ path: t.path, kind: 'changed' as const })),
      close: [],
      restage: [...state.staged],
      tree: true,
      git: true,
    };
  }

  if (!changes.length) return { ...NOTHING };

  // Git news does not touch a tab or the tree; a worktree change is both. A
  // batch of nothing but `.git/HEAD` therefore refreshes the branch and leaves
  // everything else alone, which is what a `git commit` in the terminal is.
  const real = changes.filter((c) => !isGitMeta(c.path));

  const out: Plan = {
    reload: [], ask: [], close: [], restage: [],
    // Deliberately not "only when a name appeared or disappeared". A backend
    // that has coalesced a burst reports one flag for the lot, so a new file
    // can arrive labelled as a modification — and a tree that misses it is the
    // exact complaint this item is about. One walk per debounced batch is the
    // cheaper mistake.
    tree: real.length > 0,
    // Any worktree write moves what `git status` says, and the two metadata
    // files are there precisely to catch the case where none did.
    git: true,
  };

  for (const c of real) {
    for (const tab of state.tabs) {
      if (!same(tab.path, c.path)) continue;
      // The tab's own spelling, not the event's: it is the key the app holds
      // its editors and its dirty set under.
      if (tab.dirty) out.ask.push({ path: tab.path, kind: c.kind });
      else if (c.kind === 'removed') out.close.push(tab.path);
      else out.reload.push(tab.path);
    }
    for (const staged of state.staged) {
      // Including a deleted file. `Pending.restage` reads '' for a file it
      // cannot open, so the proposal is redrawn as a whole-file create — which
      // is what it now is, and is visible rather than silently wrong.
      if (same(staged, c.path)) out.restage.push(staged);
    }
  }

  return out;
}

/**
 * Merge a new set of questions into the ones already on screen.
 *
 * A file being written repeatedly — a watched build re-emitting it — would
 * otherwise stack a second bar on top of the first asking the same thing. One
 * path is one question, and the newest kind wins: a file that changed and was
 * then deleted is deleted.
 */
export function mergeAsks(open: readonly Change[], next: readonly Change[]): Change[] {
  const out = open.map((c) => ({ ...c }));
  for (const c of next) {
    const had = out.find((o) => same(o.path, c.path));
    if (had) had.kind = c.kind;
    else out.push({ ...c });
  }
  return out;
}

/**
 * How long a path stays claimed after this app wrote it.
 *
 * Long enough to cover the write, the platform's own delivery lag and the
 * debounce in `watch.rs`; short enough that an outside change a moment later is
 * still seen. Both failures are real, and being told twice about your own save
 * is much cheaper than not being told about somebody else's `git checkout`.
 */
export const SELF_MS = 1_500;

/**
 * The paths this app has just written, so the watcher's report of them can be
 * dropped.
 *
 * A window rather than a consumed token: one `apply_write` can produce two or
 * three events on macOS and a different number on Windows, so counting them is
 * a thing that works on the machine it was written on.
 */
export class SelfWrites {
  private at = new Map<string, number>();

  /** Called with every path the app itself writes. */
  note(path: string, now = Date.now()): void {
    this.at.set(path.replace(/\\/g, '/'), now);
    // Swept here rather than on a timer: this map only grows when the app
    // writes, so the moment it writes is the moment worth tidying it.
    for (const [p, t] of this.at) if (now - t > SELF_MS) this.at.delete(p);
  }

  /** Was this event ours? Does not clear the claim — see the class comment. */
  claims(path: string, now = Date.now()): boolean {
    const t = this.at.get(path.replace(/\\/g, '/'));
    return t !== undefined && now - t <= SELF_MS;
  }

  /** Opening a different folder makes every claim meaningless. */
  clear(): void { this.at.clear(); }
}

/* ── the Rust side ─────────────────────────────────────────────────────── */

/**
 * Start watching `root`, and answer with the way to stop.
 *
 * One watcher at a time: `watch_start` replaces whatever was running, so
 * opening a second folder does not leave the first one reporting. The channel
 * is the same mechanism the terminal uses.
 */
export async function start(root: string, onBatch: (b: Batch) => void): Promise<() => void> {
  const channel = new Channel<Batch>();
  channel.onmessage = onBatch;
  await invoke('watch_start', { root, onEvent: channel });
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    void invoke('watch_stop').catch(() => { /* nothing was watching */ });
  };
}
