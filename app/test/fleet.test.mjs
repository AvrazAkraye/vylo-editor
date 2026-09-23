// The agents running in the terminal panel, and which of them is doing what.
//
// Three states, and the one that matters most is the one a quiet pane hides:
// an agent that has stopped to ask permission looks exactly like one that has
// finished, and nothing happens until somebody answers. So most of this file
// is about `asks` — what counts as a question, and what must not.
import {
  ORDER, WORKING_MS, agentOf, asks, sections, statusOf, taskOf, tally,
} from '../.test-build/fleet.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── which programs are agents ─────────────────────────────────────────────
ok('claude is Claude Code', agentOf('claude') === 'Claude Code');
// An npm install runs under node and is reported by its package.
ok('and so is the npm package', agentOf('claude-code') === 'Claude Code');
ok('codex is Codex', agentOf('codex') === 'Codex');
ok('gemini-cli is Gemini CLI', agentOf('gemini-cli') === 'Gemini CLI');
ok('aider, opencode and cursor-agent are agents',
   agentOf('aider') === 'Aider' && agentOf('opencode') === 'OpenCode' && agentOf('cursor-agent') === 'Cursor Agent');
ok('case does not matter', agentOf('Claude') === 'Claude Code');
// A shell, an editor, a build: not agents, and not on the dashboard.
ok('a shell is not an agent', agentOf('zsh') === null && agentOf('bash') === null);
ok('nor is an editor or a build', agentOf('vim') === null && agentOf('node') === null && agentOf('npm') === null);
ok('nor is nothing', agentOf('') === null && agentOf(undefined) === null);

// ── what counts as a question ─────────────────────────────────────────────
// Claude Code's permission prompt, as it is drawn.
ok("Claude Code's permission prompt is a question", asks([
  ' Bash command',
  '   npm test',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. Yes, and don’t ask again for npm test commands',
  '   3. No, and tell Claude what to do differently (esc)',
].join('\n')));
ok('and so is its edit prompt', asks('Do you want to make this edit to server.ts?\n❯ 1. Yes\n  2. No'));
ok('and its create prompt', asks('Do you want to create notes.md?'));
ok('a numbered choice with the cursor on Yes is one on its own', asks('  ❯ 1) Yes\n    2) No'));
ok('a Codex approval is one', asks('Allow command?  npm run build'));
ok('a Gemini CLI approval is one', asks('Allow execution of: rm -rf dist ?'));
ok('an ordinary (y/n) is one', asks('Overwrite existing file? (y/n)'));
ok('and a [Y/n]', asks('Continue? [Y/n]'));
ok('an agent that says it is waiting is one', asks('Waiting for approval…'));

// What must NOT count. An idle agent's input box is the prompt of an agent that
// has finished; reading it as a question would turn every idle agent into one
// that needs you. This is the boxed style older versions drew — the current
// one, a bare `❯`, is recorded from a real Claude Code further down.
ok('an older boxed input prompt is not a question', !asks([
  '╭──────────────────────────────────────────────╮',
  '│ >                                            │',
  '╰──────────────────────────────────────────────╯',
  '  ? for shortcuts',
].join('\n')));
ok('a shell prompt is not one', !asks('avraz@mac vylo % '));
ok('ordinary output is not one', !asks('✓ 42 tests passed\nDone in 3.1s'));
// "yes" in prose is not a choice, and a question mark is not a question to you.
ok('the word yes in a sentence is not one', !asks('Yes, the build finished and everything passed.'));
ok('a question in prose is not one', !asks('Why did the test fail? Because the fixture was stale.'));
ok('nothing is not one', !asks('') && !asks('   ') && !asks(undefined));

// ── the real thing ────────────────────────────────────────────────────────
// Both screens were recorded from a real Claude Code in a private pty, rendered
// through a headless xterm, and read the way the panel's `screen()` reads them.
// They are here because each one broke a version of this module that looked
// right. The trust dialog was missed: its cursor sits on the first option, and
// reading up to the cursor never reached `Enter to confirm`. And the idle box is
// a bare `❯` — the glyph a selection menu uses — so matching the glyph would
// have marked every idle agent as needing you.
const TRUST = `────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Accessing workspace:
 /Users/you/project
 robe2
 Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source
 project, or work from your team). If not, take a moment to review what's in this folder first.
 Claude Code'll be able to read, edit, and execute files here.
 Security guide
 ❯ No, exit
   Yes, I trust this folder
 Enter to confirm · Esc to cancel`;
const IDLE = ` ▐▛███▛█   Claude Code v2.1.280
▝▜██████▀  Opus 5 with high effort · API Usage Billing
  ▝▝ ▝▝    /…/project
                                                                                                      ● high · /effort
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ auto mode on (shift+tab to cycle) · ← 1 agent`;
ok('a real Claude Code trust prompt needs you', asks(TRUST), TRUST);
ok('a real idle Claude Code does not', !asks(IDLE), IDLE);
ok('and the idle box really is a bare ❯, which is why the glyph is not a pattern',
   /^❯$/m.test(IDLE));
// The line under the spinner while it works says esc to *interrupt*, and must
// not be read as the dialog footer.
ok('esc to interrupt is not esc to cancel', !asks('✻ Flowing… (esc to interrupt)'));

// ── working, idle, needs ──────────────────────────────────────────────────
const NOW = 1_000_000;
ok('output a moment ago is working', statusOf({ lastOut: NOW - 500, now: NOW, screen: '' }) === 'working');
ok('output at the edge of the window is still working',
   statusOf({ lastOut: NOW - WORKING_MS, now: NOW, screen: '' }) === 'working');
ok('a quiet terminal is idle', statusOf({ lastOut: NOW - WORKING_MS - 1, now: NOW, screen: '> ' }) === 'idle');
ok('a quiet terminal asking something needs you',
   statusOf({ lastOut: NOW - 10_000, now: NOW, screen: 'Do you want to proceed?\n❯ 1. Yes' }) === 'needs');
// An agent still printing is not waiting for anybody, whatever scrolled past.
ok('a terminal still printing is working even with a question on screen',
   statusOf({ lastOut: NOW - 200, now: NOW, screen: 'Do you want to proceed?' }) === 'working');
ok('a terminal that has never printed is idle, not working',
   statusOf({ lastOut: 0, now: NOW, screen: '' }) === 'idle');

// ── what it was asked to do ───────────────────────────────────────────────
const isClaude = (l) => /^claude\b/.test(l);
ok('the last thing asked is the task',
   taskOf(['cd api', 'claude', 'Do a security review'], isClaude) === 'Do a security review');
// `claude` is how the session began, not what it is doing.
ok('an agent that has only been started has no task yet', taskOf(['cd api', 'claude'], isClaude) === '');
ok('a slash command is a setting, not a task',
   taskOf(['claude', 'fix the flaky test', '/model'], isClaude) === 'fix the flaky test');
ok('only slash commands is no task', taskOf(['claude', '/clear'], isClaude) === '');
ok('a task from before the agent was restarted is not this session’s',
   taskOf(['claude', 'old job', 'claude'], isClaude) === '');
ok('a long task is shortened', (() => {
  const t = taskOf(['claude', 'x'.repeat(200)], isClaude);
  return t.length === 80 && t.endsWith('…');
})());
ok('nothing sent is no task', taskOf([], isClaude) === '');

// ── counting and grouping ─────────────────────────────────────────────────
const card = (id, status) => ({ id, title: id, agent: 'Claude Code', where: '~/x', status });
const cards = [card('a', 'idle'), card('b', 'working'), card('c', 'idle'), card('d', 'needs'), card('e', 'working')];
ok('the tally counts every state', same(tally(cards), { all: 5, needs: 1, working: 2, idle: 2 }));
ok('nothing is all zeros', same(tally([]), { all: 0, needs: 0, working: 0, idle: 0 }));
// Needs you first: it is the only one waiting on the person reading it.
ok('sections run needs, working, idle', same(ORDER, ['needs', 'working', 'idle']));
ok('and are drawn in that order', same(sections(cards).map((s) => s.status), ['needs', 'working', 'idle']));
// A card that jumps position when a neighbour starts is a card you have to find
// again.
ok('cards keep the session order inside a section',
   same(sections(cards).find((s) => s.status === 'idle').cards.map((c) => c.id), ['a', 'c']));
ok('an empty section is left out', same(sections([card('a', 'idle')]).map((s) => s.status), ['idle']));
ok('a filter shows one section', same(sections(cards, 'working').map((s) => s.status), ['working']));
ok('a filter with nothing in it shows nothing', same(sections([card('a', 'idle')], 'needs'), []));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
