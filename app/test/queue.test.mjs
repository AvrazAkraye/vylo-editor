// Messages typed while a turn is running.
//
// The failure this module exists to prevent is a queued sentence landing on a
// conversation that moved underneath it — a checkpoint undo, a chat switch, a
// different folder. None of those throw. The message simply arrives addressed
// to work that is no longer there, and the answer that comes back is wrong with
// no visible cause. So most of what is below is about `drain` refusing, and
// refusing *visibly*: a message that vanishes without a word looks exactly like
// one that was sent and ignored.
import {
  MAX_QUEUED, NO_QUEUE, add, clear, convo, drain, interrupts, isFull, list, merge, remove,
} from '../.test-build/queue.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

/** The conversation most of these are written against. */
const A = convo('c_alpha', 0);
const texts = (items) => items.map((i) => i.text);

// ── an empty queue ────────────────────────────────────────────────────────
ok('an empty queue has nothing waiting', list(NO_QUEUE).length === 0);
ok('and nothing in it wants to interrupt the turn', !interrupts(NO_QUEUE));
ok('and it is not full', !isFull(NO_QUEUE));
ok('draining it takes nothing and hands nothing back',
   drain(NO_QUEUE, A).take.length === 0 && drain(NO_QUEUE, A).stale.length === 0);
ok('and leaves the very same queue, so an idle render sets no state',
   drain(NO_QUEUE, A).queue === NO_QUEUE);
ok('clearing it is likewise a no-op', clear(NO_QUEUE) === NO_QUEUE);

// ── writing messages into it ──────────────────────────────────────────────
{
  let q = add(NO_QUEUE, 'read the config', A, 'after');
  q = add(q, 'and the tests', A, 'after');
  ok('messages wait in the order they were written', texts(list(q)).join(' | ') === 'read the config | and the tests');
  ok('adding does not disturb the queue it was given', list(NO_QUEUE).length === 0);
  ok('each message carries the conversation it was written against',
     list(q).every((i) => i.convo === A));
  ok('and every one has an id of its own, or removing one would remove two',
     new Set(list(q).map((i) => i.id)).size === 2);

  ok('a blank message is not a message', add(q, '   \n  ', A, 'after') === q);
  ok('and neither is an empty one', add(q, '', A, 'after') === q);
  ok('leading and trailing space is not part of what was said',
     list(add(NO_QUEUE, '  fix the import  ', A, 'after'))[0].text === 'fix the import');
}

// ── the cap ───────────────────────────────────────────────────────────────
{
  let q = NO_QUEUE;
  for (let i = 0; i < MAX_QUEUED; i++) q = add(q, `message ${i}`, A, 'after');
  ok('the queue fills at the cap', isFull(q) && list(q).length === MAX_QUEUED);

  const over = add(q, 'one too many', A, 'after');
  ok('and one more is refused rather than accepted', over === q);
  // Making room by dropping the oldest is the silent drop this whole module is
  // written to avoid: that message is on screen in the pending list, and the
  // person did not ask for it to go.
  ok('the oldest is still there — nothing was thrown away to make room',
     texts(list(over))[0] === 'message 0');
}

// ── taking one back out ───────────────────────────────────────────────────
{
  let q = NO_QUEUE;
  for (const s of ['first', 'second', 'third']) q = add(q, s, A, 'after');
  const [, second] = list(q);

  const shorter = remove(q, second.id);
  ok('removing one takes exactly that one', texts(list(shorter)).join() === 'first,third');
  ok('and leaves the rest in the order they were written',
     texts(list(shorter))[0] === 'first' && texts(list(shorter))[1] === 'third');
  ok('removing something that is not there changes nothing', remove(q, 'q-nonexistent') === q);
  ok('and the queue it was removed from is untouched', list(q).length === 3);

  ok('clearing empties it', list(clear(q)).length === 0);
}

// ── the two send modes ────────────────────────────────────────────────────
{
  const waiting = add(NO_QUEUE, 'when you are done', A, 'after');
  ok('a message that can wait does not ask for the turn to be stopped', !interrupts(waiting));

  const urgent = add(waiting, 'no, stop, look at the other file', A, 'now');
  ok('one that cannot wait does', interrupts(urgent));
  // Two messages can be queued before either is acted on, and the second asking
  // to interrupt does not stop being true because the first did not ask.
  ok('and it still does when it is not the first in the queue', interrupts(urgent));

  // Mode says *when the caller drains*, not what a drain takes. A queue that
  // sent some of itself and held the rest back would deliver a person's
  // sentences out of the order they wrote them in.
  const both = drain(urgent, A);
  ok('a drain takes both modes, in the order they were written',
     texts(both.take).join(' | ') === 'when you are done | no, stop, look at the other file');
}

// ── draining onto the conversation it was written for ─────────────────────
{
  let q = add(NO_QUEUE, 'also check the tests', A, 'after');
  q = add(q, 'and the lockfile', A, 'after');

  const d = drain(q, A);
  ok('everything written against this conversation is sent', d.take.length === 2);
  ok('nothing is handed back', d.stale.length === 0);
  ok('and the queue is empty afterwards', list(d.queue).length === 0);
  ok('draining does not mutate the queue it drained', list(q).length === 2);
}

// ── the whole point: a conversation that moved underneath it ──────────────
{
  // Queued in this chat, then the person opened a different one.
  const B = convo('c_beta', 0);
  const q = add(NO_QUEUE, 'and the migration file', A, 'after');

  const d = drain(q, B);
  ok('a message written in another chat is not sent into this one', d.take.length === 0);
  ok('it is handed back instead of dropped', texts(d.stale).join() === 'and the migration file');
  ok('and it is handed back whole, not as a count',
     d.stale[0].text === 'and the migration file' && d.stale[0].convo === A);
  // Keeping it would offer it at the end of every following turn, be refused
  // every time, and leave a row nobody can send and nobody put there.
  ok('the queue still empties, so nothing is offered again for ever',
     list(d.queue).length === 0);
}

{
  // A checkpoint undo: same chat, but the transcript it was written against has
  // been cut away and the files put back. This is the case a chat-id check on
  // its own would let through.
  const before = convo('c_alpha', 0);
  const after = convo('c_alpha', 1);
  const q = add(NO_QUEUE, 'now do the same for the other component', before, 'after');

  const d = drain(q, after);
  ok('a checkpoint undo invalidates a message queued before it', d.take.length === 0);
  ok('and that message comes back rather than going into the rewound chat',
     d.stale.length === 1);
  // The two tokens agree on everything except the revision, so a check on the
  // chat id alone would have sent this straight into the rewound conversation.
  ok('only the revision separates the two, which is why the token carries one',
     d.stale[0].convo.split('@')[0] === after.split('@')[0] && d.stale[0].convo !== after,
     [d.stale[0].convo, after]);
}

{
  // Opening a different folder starts a new chat, so the chat id moves.
  const q = add(NO_QUEUE, 'run the build', convo('c_alpha', 0), 'now');
  const d = drain(q, convo('c_gamma', 0));
  ok('a new folder invalidates it too', d.take.length === 0 && d.stale.length === 1);
  ok('even when it was the urgent kind — urgency is not a licence to land anywhere',
     d.stale[0].mode === 'now');
}

{
  // Queued in A, switched to B, queued again in B, and only then did the turn
  // that was running in A finish. The drain happens against B.
  let q = add(NO_QUEUE, 'written in A', A, 'after');
  const B = convo('c_beta', 0);
  q = add(q, 'written in B', B, 'after');
  q = add(q, 'also written in B', B, 'now');

  const d = drain(q, B);
  ok('a mixed queue sends only what belongs to the conversation it is draining into',
     texts(d.take).join(' | ') === 'written in B | also written in B');
  ok('and hands back only what does not', texts(d.stale).join() === 'written in A');
  ok('both halves keep the order they were written in',
     d.take[0].at <= d.take[1].at && texts(d.take)[0] === 'written in B');
  ok('nothing is both sent and handed back',
     d.take.length + d.stale.length === 3
     && !d.take.some((i) => d.stale.some((s) => s.id === i.id)));
}

{
  // Switched into another chat while the turn ran, then switched back before it
  // ended. Nothing about the conversation actually moved. This is why the check
  // is a comparison of tokens and not a flag raised when the chat changes: a
  // flag would refuse a message the conversation is still sitting there waiting
  // for, and refusing it is as wrong as sending it into the wrong chat.
  const q = add(NO_QUEUE, 'and the migration file', A, 'after');
  const d = drain(q, A);
  ok('a message survives a detour into another chat and back again',
     texts(d.take).join() === 'and the migration file' && d.stale.length === 0);
}

// ── the token ─────────────────────────────────────────────────────────────
{
  ok('the same chat at the same revision is the same conversation',
     convo('c_alpha', 3) === convo('c_alpha', 3));
  ok('a different chat is a different conversation', convo('c_alpha', 0) !== convo('c_beta', 0));
  ok('and so is the same chat after a cut', convo('c_alpha', 0) !== convo('c_alpha', 1));
  // Concatenated with no separator these two are both "a12", and the collision
  // is silent in exactly the direction that delivers a message into the wrong
  // chat.
  ok('a chat id ending in a digit cannot collide with another chat at a later revision',
     convo('a1', 2) !== convo('a', 12), [convo('a1', 2), convo('a', 12)]);
}

// ── one drain, one turn ───────────────────────────────────────────────────
{
  let q = add(NO_QUEUE, 'check the config', A, 'after');
  q = add(q, 'and the tests', A, 'after');
  const { take } = drain(q, A);

  // Three queued messages sent as three turns is three twelve-hop budgets
  // started with nobody watching — the hop cap stops being a cap when a queue
  // is what starts a turn. Joined, they are one turn.
  ok('everything drained becomes one message', typeof merge(take) === 'string');
  ok('separated by a blank line, the paragraph break a person would have typed',
     merge(take) === 'check the config\n\nand the tests');
  ok('one message on its own is merged into itself unchanged',
     merge([take[0]]) === 'check the config');
  ok('and nothing merges to nothing', merge([]) === '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
