/**
 * Messages typed while a turn is running.
 *
 * The composer is `disabled={busy}` and `send()` returns immediately when it
 * is, so watching the agent open the wrong file on hop three leaves exactly two
 * options: sit through the nine hops after it, or throw the turn away. Both
 * cost the whole turn, and on a metered key both cost it twice — once for the
 * hops already bought and once for the ones the retype buys again. This module
 * is the third option: write the correction while the turn is still running,
 * and decide whether it goes in when the turn ends or interrupts it.
 *
 * Those two choices are what make this *steering* rather than buffering, and
 * they are the whole reason {@link SendMode} exists. A queue that could only
 * wait would still leave you watching nine hops you already know are wrong.
 *
 * ## This does not touch the security invariant, though it looks like it might
 *
 * No model output reaches disk or a shell without a human having read and
 * approved that exact content or string. Nothing here moves that line by a
 * millimetre. A queued message is a *human's own sentence*, typed into the
 * composer by hand, travelling the same path as any other user message: it
 * becomes one `user` turn and nothing else. It authorises no write, approves no
 * command, and skips no dialog — every `write_file`, `edit_file` and
 * `run_command` proposed after it is staged and approved exactly as it would
 * have been had the sentence been typed a minute later. A note in memory can no
 * more approve a write than this can, and for the same reason: it is text in a
 * request, not a decision. The tools that actually touch the disk and the shell
 * are absent from the schema, and this module adds nothing to it.
 *
 * The one thing worth being careful about is the *other* direction — nothing in
 * here may ever be filled in by the model. Every item comes from a keystroke.
 *
 * ## The risk that decides the shape
 *
 * A queued message must never land on a conversation that moved underneath it.
 * You queue "and check the tests too", then undo a checkpoint, or switch chats,
 * or open a different folder — and a sentence that made sense against the old
 * transcript is now addressed to a conversation that never contained the work
 * it refers to. The model answers a question about something that is not there,
 * which is worse than the message never having been sent: it is a wrong answer
 * with no visible cause.
 *
 * So every item carries the conversation it was written against, and
 * {@link drain} refuses anything whose token no longer matches. It refuses
 * *visibly*: refused items come back in `stale`, and the caller has to put them
 * somewhere a person can read them. Dropping a sentence somebody typed, without
 * saying so, is the one failure this module exists to prevent — a silent drop
 * is indistinguishable from a message that was sent and ignored, and the person
 * spends the next turn wondering which happened.
 *
 * The token comes from {@link convo} and is minted by the caller. It is
 * deliberately not the chat id on its own: a checkpoint undo cuts the
 * transcript and rewrites the files without changing which chat you are in, so
 * a chat-id check alone would pass it straight through.
 *
 * ## Nothing here is persisted
 *
 * A queue means something only while a turn is in flight, and no turn survives
 * a restart. A queue restored into a fresh session would be the hazard above by
 * construction — every item in it written against a conversation the app is no
 * longer in the middle of — so the honest lifetime is the process.
 */

/**
 * When a queued message goes in.
 *
 * - `after` — when the turn in flight finishes on its own. The agent is doing
 *   something useful and the correction can wait for it.
 * - `now` — stop the turn and send. This is the mode that makes the feature
 *   steering: the hop you are watching is the wrong one, and there is nothing
 *   to be gained from the nine after it.
 *
 * The mode decides *when the caller drains*, not what a drain takes. A drain
 * takes everything valid, in the order it was written; a queue that sent some
 * of itself and held the rest back would deliver a person's sentences out of
 * the order they wrote them in.
 */
export type SendMode = 'after' | 'now';

export interface Queued {
  /** Stable for the life of the item: what {@link remove} names and React keys on. */
  id: string;
  /** What the person typed, trimmed. */
  text: string;
  /** The conversation it was written against — see {@link convo}. */
  convo: string;
  mode: SendMode;
  /** When it was queued. For the label; the ordering is the array's job. */
  at: number;
}

export interface Queue {
  items: Queued[];
}

export const NO_QUEUE: Queue = { items: [] };

/**
 * How many messages may wait at once.
 *
 * Not a storage limit — each of these is a sentence. It is a limit on how far
 * ahead of the agent one person can get: the seventh message in a queue was
 * written against a turn several hops ago and answers a state the agent left
 * long before it arrives. That is the same staleness {@link drain} refuses
 * across a chat switch, reaching the same place the slow way.
 *
 * Adding past this is refused rather than dropping the oldest to make room. The
 * oldest is on screen in the pending list; taking it away without being asked
 * is exactly the silent drop the whole module is built to avoid.
 */
export const MAX_QUEUED = 6;

// Unique for the life of the process, which is all a queue lives for. A
// timestamp alone would not do: two messages inside one millisecond is unlikely
// by hand and certain under a test, and two items sharing an id makes `remove`
// take both — deleting a message the person did not point at.
let seq = 0;
const nextId = (): string => `q${++seq}`;

/** Whether one more would be refused. */
export const isFull = (q: Queue): boolean => q.items.length >= MAX_QUEUED;

/**
 * Queue a message, written against the conversation `against`.
 *
 * Blank text and a full queue both come back as the same queue object, so a
 * React state setter given the result renders nothing. Neither is an error
 * worth reporting from here: ⌘↵ on an empty box is a keystroke that missed, and
 * {@link isFull} is exported so the UI can say the queue is full *before* the
 * keystroke rather than swallowing it afterwards.
 */
export function add(
  q: Queue,
  text: string,
  against: string,
  mode: SendMode,
  at = Date.now(),
): Queue {
  const trimmed = text.trim();
  if (!trimmed || isFull(q)) return q;
  return { items: [...q.items, { id: nextId(), text: trimmed, convo: against, mode, at }] };
}

/** Drop one, by id. An id that is not there changes nothing. */
export function remove(q: Queue, id: string): Queue {
  if (!q.items.some((i) => i.id === id)) return q;
  return { items: q.items.filter((i) => i.id !== id) };
}

/**
 * What is waiting, oldest first.
 *
 * Oldest first is the order they will be sent, and therefore the order they
 * have to be drawn in: a pending list that reads newest-first would show a
 * person their sentences in the reverse of the order the agent will read them.
 */
export const list = (q: Queue): readonly Queued[] => q.items;

/** Throw the queue away. Only ever from a human action — see the drain rule. */
export const clear = (q: Queue): Queue => (q.items.length ? NO_QUEUE : q);

/**
 * Whether anything waiting asked for the turn to be stopped.
 *
 * Asked as a question of the queue rather than remembered from the add that
 * caused it: two messages can be queued before either is acted on, and the
 * second one asking to interrupt does not stop being true because the first did
 * not ask.
 */
export const interrupts = (q: Queue): boolean => q.items.some((i) => i.mode === 'now');

/**
 * Whether this item can no longer be sent, given the conversation now open.
 *
 * The same comparison {@link drain} makes, exported so the pending list can
 * make it too. Without it a refusal is only discovered when the turn ends: you
 * switch chats on hop three and the rows sit there looking like they are still
 * going to be sent, for as long as the turn has left to run. Marking them the
 * moment the conversation moves is the difference between a refusal a person
 * can act on — remove it, or switch back — and one they are told about
 * afterwards.
 *
 * It is also the only copy of the rule. A UI that wrote `i.convo !== current`
 * inline would be a second definition of what "the conversation moved" means,
 * free to drift from the one that actually decides.
 */
export const isStale = (item: Queued, current: string): boolean => item.convo !== current;

export interface Drained {
  /** To send, oldest first. */
  take: Queued[];
  /**
   * Written against a conversation that has since moved, and therefore **not**
   * sent. Handed back rather than dropped: the caller must put these where a
   * person can see them, because a sentence that vanishes without a word looks
   * exactly like one that was sent and ignored.
   */
  stale: Queued[];
  /** The queue afterwards. Empty whenever there was anything to drain. */
  queue: Queue;
}

/**
 * Take everything written against `current`, and hand back everything that was
 * not.
 *
 * The comparison is the whole point of the module. `current` is the token for
 * the conversation the app is in *now*; an item's `convo` is the token for the
 * conversation it was typed into. A chat switch, a new chat, a new folder and a
 * checkpoint undo all change the first without changing the second, and each of
 * them makes a queued sentence address work that is no longer there.
 *
 * The queue empties completely, stale items included. Keeping them would offer
 * them again at the end of every following turn, be refused again every time,
 * and leave a row in the pending list that can never be sent and that nobody
 * put there. They come back once, in `stale`, where the caller shows them and a
 * person can read them and decide.
 */
export function drain(q: Queue, current: string): Drained {
  // Same object back when there is nothing, so an effect that drains on every
  // idle render does not set state and re-run itself.
  if (!q.items.length) return { take: [], stale: [], queue: q };
  return {
    take: q.items.filter((i) => !isStale(i, current)),
    stale: q.items.filter((i) => isStale(i, current)),
    queue: NO_QUEUE,
  };
}

/**
 * Everything drained, as one user message.
 *
 * One drain, one turn — and not for tidiness. Sending three queued messages as
 * three turns is three twelve-hop budgets started with nobody watching, which
 * is the hop cap ceasing to be a cap because the thing starting a turn is a
 * queue rather than a person. Joined, they cost one turn, and the person who
 * wrote all three chose all three.
 *
 * A blank line between them because that is the paragraph break the person
 * would have typed, and because two sentences run together read as one.
 */
export const merge = (items: readonly Queued[]): string => items.map((i) => i.text).join('\n\n');

/**
 * A token naming the conversation a message was written against.
 *
 * The chat id alone is not enough. A checkpoint undo cuts the transcript back
 * and rewrites the files without changing which chat you are in, so a message
 * queued before it passes a chat-id check and arrives addressed to work that
 * has just been undone. `rev` is the caller's count of how many times *this*
 * chat has been cut — bumped by a checkpoint undo and by a redo — which is what
 * makes those cases indistinguishable from a chat switch. Which is what they
 * are: the conversation the message was written to is gone either way.
 *
 * The separator is load-bearing. Concatenated, chat `a1` at revision 2 and chat
 * `a` at revision 12 are the same string, and that collision is silent in
 * precisely the direction that delivers a message into the wrong chat.
 */
export const convo = (chatId: string, rev: number): string => `${chatId}@${rev}`;
