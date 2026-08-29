/**
 * The arithmetic either side of an undo.
 *
 * Two small decisions that were embedded in `App.tsx` with no test: where each
 * checkpoint's transcript ends inside the conversation an undo is cutting away,
 * and which checkpoint redo is allowed to put back. Both fail silently — a
 * wrong cut restores a conversation that says something different from what is
 * on disk, and a wrong pick redoes a change out of order — which is exactly the
 * kind of thing that has to be pinned by name rather than noticed.
 *
 * Nothing here talks to Tauri or to React, so it can be.
 */

/** Just enough of a transcript line: the checkpoint a write was filed under. */
export interface Marked {
  cp?: { seq: number; hist: number };
}

/** Where one checkpoint's transcript ends inside the conversation kept with it. */
export interface Ends {
  /** Lines to keep. */
  upto: number;
  /** Messages of `history` to keep. */
  hist: number;
}

export interface Kept {
  seq: number;
  ends: Ends;
}

/**
 * For each checkpoint being undone, where the conversation stood the moment
 * that write landed.
 *
 * The whole transcript is sent to the store once and these are offsets into it,
 * rather than a prefix per checkpoint: the prefixes shared nothing, and
 * `history` holds every `tool_result` — the full text of every file the agent
 * read — so undoing twenty writes meant twenty copies of a multi-megabyte
 * conversation through one IPC call and onto the disk.
 *
 * Two cases are not the obvious arithmetic:
 *
 * - **The newest keeps everything.** Its cut is the whole conversation, not the
 *   line that reported it, so undoing and then redoing all the way forward
 *   lands exactly where it started rather than dropping whatever was said after
 *   the last write.
 * - **A checkpoint whose line is gone keeps everything too.** That happens when
 *   the write was reported in a transcript this chat no longer holds. There is
 *   no honest offset to give, and the whole conversation is the direction that
 *   loses nothing.
 *
 * `hist` is one past the line's own `hist` because that field is the length
 * *before* the write, and approving appends exactly one message after it.
 */
export function cutPoints(
  undoing: { seq: number }[],
  lines: Marked[],
  history: number,
): Kept[] {
  // Sorted here rather than trusted from the caller: "the last one" has to mean
  // the newest checkpoint, and it is the only entry that keeps the whole
  // conversation.
  const order = [...undoing].sort((a, b) => a.seq - b.seq);
  return order.map((m, i) => {
    const at = lines.findIndex((l) => l.cp?.seq === m.seq);
    const whole = i === order.length - 1 || at < 0;
    return {
      seq: m.seq,
      ends: {
        upto: whole ? lines.length : at + 1,
        hist: whole ? history : lines[at].cp!.hist + 1,
      },
    };
  });
}

/** One checkpoint as `checkpoint_list` reports it. */
export interface Meta {
  seq: number;
  paths: string[];
  undone: boolean;
  redoable: boolean;
}

/**
 * The checkpoint redo would put back: the *oldest* undone one, so undo and redo
 * step over the same list in opposite directions.
 *
 * Offered only when that one can actually be put back — not "the oldest one
 * that can be". Skipping to a later checkpoint would write a state the project
 * reached *after* one that was never restored, and would bring back a
 * transcript that does not describe the files. A checkpoint written before redo
 * existed kept no `after`, and the honest way to say so is no button rather
 * than one that fails when it is pressed.
 */
export function redoTarget(meta: Meta[]): { seq: number; paths: string[] } | null {
  // By number rather than by position: the list arrives newest-first, and a
  // rule that depends on which end is which breaks quietly if that ever
  // changes.
  const oldest = meta
    .filter((m) => m.undone)
    .reduce<Meta | null>((low, m) => (!low || m.seq < low.seq ? m : low), null);
  return oldest?.redoable ? { seq: oldest.seq, paths: oldest.paths } : null;
}
