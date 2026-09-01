/**
 * How big the afternoon was.
 *
 * The status bar could already say "3 modified", which is the count of a thing
 * nobody wonders about: three files could be three characters or three
 * rewrites. `+412 −87` is the number that says how much work is in the tree,
 * and it is what Warp puts in the same bar.
 *
 * ## What the numbers are
 *
 * `git_diffstat` in `src-tauri/src/lib.rs` runs `git diff --numstat -z` twice —
 * once with `--cached` and once without — and sums them. Everything interesting
 * about that is written there: why two diffs rather than `git diff HEAD` (a
 * repository before its first commit has no HEAD, and that is when somebody has
 * the most staged), why `-z` (paths with spaces), and why a rename has to
 * consume two further fields.
 *
 * One thing is worth repeating on this side, because it is what the UI has to
 * carry: **a binary file has no line count at all**. numstat reports `-` and
 * `-` for it, treating that as zero would say "changed by nothing" about the
 * biggest thing in the commit, so the count travels separately and the status
 * bar says how many there were.
 *
 * ## Why nothing here is a string
 *
 * The app already draws this pair in three places — `Review.tsx`, `Editor.tsx`
 * and `FileHistory.tsx` all render `<span className="add">+{n}</span>` beside a
 * `del` — so a fourth formatter here would be a fourth answer to a question
 * that has one. This module decodes and it judges emptiness; the composing is
 * done where the rest of the app composes it, with `t()` for the words.
 */

import { invoke } from '@tauri-apps/api/core';

/** Exactly what `git_diffstat` answers. */
export interface DiffStat {
  added: number;
  removed: number;
  /** Distinct paths behind those numbers, staged and unstaged counted once. */
  files: number;
  /** How many of those files git would not count, because they are binary. */
  binary: number;
}

const whole = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * The reply, checked rather than asserted.
 *
 * `invoke<T>` asserts `T`; it does not check it. When `list_tree` grew an
 * envelope, three call sites went on reading the old shape, typechecked
 * perfectly and did nothing at runtime — and in one of them the decode threw
 * inside a `catch` that meant something else entirely. So this is a function
 * with a test per shape, and the type parameter is the last thing trusted.
 *
 * `null` for anything that is not four whole counts. A status bar with no
 * numbers in it is the same status bar it was last week; a status bar with
 * `NaN` in it is a bug report.
 */
export function decode(reply: unknown): DiffStat | null {
  if (typeof reply !== 'object' || reply === null) return null;
  const r = reply as Record<string, unknown>;
  if (!whole(r.added) || !whole(r.removed) || !whole(r.files) || !whole(r.binary)) return null;
  return { added: r.added, removed: r.removed, files: r.files, binary: r.binary };
}

/**
 * Nothing to say.
 *
 * `files`, not the lines, and the difference is a real tree rather than a
 * hypothetical one: a file that was renamed and not otherwise touched is one
 * changed file and zero changed lines, and it reads as `+0 −0` — which is what
 * happened. The case this is guarding is the clean tree, where drawing a `+0`
 * beside the branch would add a number to the bar that never changes.
 */
export function isEmpty(s: DiffStat): boolean {
  return s.files === 0;
}

/**
 * Ask Rust, and return null rather than throwing at a status bar.
 *
 * Two failures, kept apart on purpose. git refusing — the folder is not a
 * repository, or git is not installed — is an ordinary state of an ordinary
 * folder, and there is nothing to report about it. A reply of the wrong shape
 * is a defect in this app. They both end in "draw nothing", and they are still
 * not the same thing: a `catch` that swallows two different failures reports
 * the wrong one, which is why the decode sits outside it.
 */
export async function diffstat(root: string): Promise<DiffStat | null> {
  let reply: unknown;
  try {
    reply = await invoke('git_diffstat', { root });
  } catch {
    return null;
  }
  return decode(reply);
}
