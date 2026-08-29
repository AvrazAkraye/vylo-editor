import { invoke } from '@tauri-apps/api/core';

/**
 * Staged edits.
 *
 * The agent's `write_file` and `edit_file` tools do not write. They compute the
 * resulting content and leave it here; the disk is only touched when a human
 * approves the diff. The Rust side's real writing command is not in the tool
 * schema at all, so this is not a rule the model is asked to follow — it is a
 * capability it does not have.
 *
 * One consequence has to be handled deliberately: once a file is staged, the
 * agent must read the *staged* version, not what is still on disk. Otherwise it
 * makes an edit, reads the file back, sees its change missing, and either
 * repeats the edit or concludes it failed.
 */

export interface Change {
  path: string;
  before: string;   // '' when the file is new
  after: string;
  isNew: boolean;
}

/** Lowercase hex sha-256, matching what the Rust side computes. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class Pending {
  private map = new Map<string, Change>();

  /**
   * Unsaved editor buffers, injected by the app.
   *
   * Without this the agent reads the file from disk while the person it is
   * talking to is looking at something different on screen — so it reasons
   * about code that no longer exists, and its edits fight theirs.
   */
  dirty: (path: string) => string | undefined = () => undefined;

  get size(): number { return this.map.size; }
  list(): Change[] { return [...this.map.values()].sort((a, b) => a.path.localeCompare(b.path)); }
  has(path: string): boolean { return this.map.has(path); }
  clear(): void { this.map.clear(); }
  drop(path: string): void { this.map.delete(path); }

  /** Staged content, then an unsaved buffer, then disk — most recent first. */
  async currentContent(root: string, path: string): Promise<string> {
    const staged = this.map.get(path);
    if (staged) return staged.after;
    const open = this.dirty(path);
    if (open !== undefined) return open;
    return await invoke<string>('read_file', { root, path });
  }

  /** Stage a whole-file write. */
  async stageWrite(root: string, path: string, content: string): Promise<Change> {
    const existing = this.map.get(path);
    let before = existing?.before ?? '';
    let isNew = existing?.isNew ?? false;

    if (!existing) {
      try {
        before = await invoke<string>('read_file', { root, path });
      } catch {
        // Unreadable almost always means "does not exist yet", which is a
        // legitimate create rather than an error.
        before = '';
        isNew = true;
      }
    }
    const change: Change = { path, before, after: content, isNew };
    this.map.set(path, change);
    return change;
  }

  /**
   * Stage a targeted replacement.
   *
   * Rejects a match that is not unique. That refusal is the useful behaviour:
   * an ambiguous `old_string` means the model is guessing at which occurrence
   * it wants, and the error goes back as a tool_result so it can pick a longer,
   * unambiguous anchor instead of silently editing the wrong line.
   */
  async stageEdit(
    root: string, path: string, oldString: string, newString: string, replaceAll = false,
  ): Promise<Change> {
    const before = await this.currentContent(root, path);
    if (oldString === '') throw new Error(`${path}: old_string is empty`);

    const count = before.split(oldString).length - 1;
    if (count === 0) throw new Error(`${path}: old_string not found`);
    if (count > 1 && !replaceAll) {
      throw new Error(
        `${path}: old_string appears ${count} times. Include more surrounding context to make it unique, or set replace_all.`,
      );
    }

    const after = replaceAll ? before.split(oldString).join(newString) : before.replace(oldString, newString);
    const original = this.map.get(path);
    const change: Change = {
      path,
      before: original?.before ?? before,
      after,
      isNew: original?.isNew ?? false,
    };
    this.map.set(path, change);
    return change;
  }

  /**
   * Write approved changes to disk. Returns the paths that landed.
   *
   * Each write states the version it was built on. Before there was an editor
   * this could not go stale, because only the agent wrote; now a person can
   * have changed the same file since the diff was proposed, and writing
   * `after` regardless would silently destroy their work. A mismatch throws
   * with the path named, and the already-written paths are still returned so
   * the caller knows exactly how far it got.
   */
  async apply(root: string, paths: string[]): Promise<string[]> {
    const done: string[] = [];
    for (const path of paths) {
      const c = this.map.get(path);
      if (!c) continue;
      // '' means "this file should not exist yet", which is distinct from the
      // hash of an empty file that does.
      const expectSha256 = c.isNew ? '' : await sha256Hex(c.before);
      try {
        await invoke('apply_write', { root, path, content: c.after, expectSha256 });
      } catch (e) {
        if (done.length) {
          throw new Error(`${String(e)} (${done.length} other file(s) were written)`);
        }
        throw e;
      }
      this.map.delete(path);
      done.push(path);
    }
    return done;
  }

  /** Rebuild a staged change on top of the file as it is now. */
  async restage(root: string, path: string): Promise<Change | null> {
    const c = this.map.get(path);
    if (!c) return null;
    const before = await invoke<string>('read_file', { root, path }).catch(() => '');
    const next: Change = { path, before, after: c.after, isNew: false };
    this.map.set(path, next);
    return next;
  }
}

/* ── diff ──────────────────────────────────────────────────────────────── */

export type Row = { kind: ' ' | '+' | '-'; text: string; a?: number; b?: number };

/**
 * Line diff via longest common subsequence.
 *
 * Hand-rolled rather than pulled from a package: the whole need is a readable
 * review of one file's changes, and an LCS table is small enough that a
 * dependency would cost more than it saves. Falls back to a plain
 * replace-everything view on very large files, where the O(n·m) table is not
 * worth building.
 */
export function diffLines(before: string, after: string, context = 3): Row[] {
  const a = before.length ? before.split('\n') : [];
  const b = after.length ? after.split('\n') : [];

  if (a.length * b.length > 4_000_000) {
    return [
      ...a.map((text, i) => ({ kind: '-' as const, text, a: i + 1 })),
      ...b.map((text, i) => ({ kind: '+' as const, text, b: i + 1 })),
    ];
  }

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const rows: Row[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { rows.push({ kind: ' ', text: a[i], a: i + 1, b: j + 1 }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { rows.push({ kind: '-', text: a[i], a: i + 1 }); i++; }
    else { rows.push({ kind: '+', text: b[j], b: j + 1 }); j++; }
  }
  while (i < a.length) rows.push({ kind: '-', text: a[i], a: ++i });
  while (j < b.length) rows.push({ kind: '+', text: b[j], b: ++j });

  return collapse(rows, context);
}

/** Hide long runs of untouched lines, so a one-line change in a big file reads as one change. */
function collapse(rows: Row[], context: number): Row[] {
  const keep = new Set<number>();
  rows.forEach((r, i) => {
    if (r.kind === ' ') return;
    for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) keep.add(k);
  });
  if (keep.size === rows.length) return rows;

  const out: Row[] = [];
  let gap = false;
  rows.forEach((r, i) => {
    if (keep.has(i)) { out.push(r); gap = false; }
    else if (!gap) { out.push({ kind: ' ', text: '⋯' }); gap = true; }
  });
  return out;
}

export function countChanges(rows: Row[]): { added: number; removed: number } {
  return {
    added: rows.filter((r) => r.kind === '+').length,
    removed: rows.filter((r) => r.kind === '-').length,
  };
}
