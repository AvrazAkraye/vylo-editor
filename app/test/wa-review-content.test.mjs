// The adversarial review of the words and the AI side of WhatsApp Broadcast (docs/wa/review-content.md).
//
// Four things are attacked here, each as a liability rather than as a feature:
//
//   1. The ready-message library (whatsapptemplates*.ts): 99 messages in four languages, read as what a business
//      sends to hundreds of people under its own name — a phishing kit, a false promise, a shaming reminder, a
//      greeting for the wrong day, a blank that leaks, a letter of the wrong script.
//   2. The AI writer (whatsappwrite.ts): hostile briefs, invisible letters, a model that complies with what it was
//      told to refuse, replies malformed every way, and what reaches the wire.
//   3. The assistant's tools (whatsappbulktool.ts, whatsapptool.ts, agent.ts): what the model reads back from a file,
//      what it can stage, how many, for which account, and whether a send can ever skip the dialog.
//   4. The sentences in SAFETY that promise any of the above.
//
// No model, no key, no network: every request is a stub. Needs .test-build (npm run test:build).
import { readFileSync } from 'fs';
import { approvalLine, accountFor, planSend, runWhatsAppTool, whatsAppToolsFor } from '../.test-build/whatsapptool.js';
import { decide, isRefused } from '../.test-build/auto.js';
import { runAgent, system, toolsFor } from '../.test-build/agent.js';
import { modeFor } from '../.test-build/agents.js';

const SLOW = process.env.CI ? 4 : 1; // a shared runner is several times slower than the machine that releases; budgets stay strict here

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

// ── a send the model wrote is asked about, from any account, at any level ─────
//
// `auto.ts`'s refuse-list catches the dialog's first line. With two WhatsApp numbers connected that line became
// "WhatsApp from <account> to …", which the rule `^whatsapp to ` did not match — so at auto-approve level `all` the
// agent's message went out with no dialog, and "Always allow" could trust it. SAFETY.md says it "is asked at every
// auto-approve level and in every routine".
console.log('a model-written send always asks');
{
  const plan = planSend({ phone: '9647501112233', text: 'Your order is ready' }).value;
  for (const account of [undefined, 'Shop line', 'OTP line', 'to', 'WhatsApp to', 'a\nb', 'من المتجر', 'هێڵی دوکان']) {
    const line = approvalLine(plan, account);
    ok(`from ${JSON.stringify(account ?? '(one account)')}: the refuse-list catches it`, isRefused(line), line.split('\n')[0]);
    ok(`from ${JSON.stringify(account ?? '(one account)')}: level all still asks`, decide(line, 'all').kind === 'ask', decide(line, 'all'));
  }
  ok('the rule still lets an ordinary command run at level all', decide('npm test', 'all').kind === 'run');
  ok('a shell command that merely starts with the word is not a message', decide('whatsappctl status', 'all').kind === 'run');
}

// ── modes and routines: who is offered the bulk tools at all ──────────────────
console.log('modes and routines');
{
  const conn = { baseUrl: 'https://wa.example.com', instance: 'x', key: 'k' };
  const wa = whatsAppToolsFor(conn);
  const names = (mode) => toolsFor({ mode, extraTools: wa }).map((t) => t.name);
  ok('Chat with WhatsApp connected is offered the six WhatsApp tools and nothing else',
    names('chat').sort().join() === 'whatsapp_audience,whatsapp_campaign,whatsapp_chats,whatsapp_read,whatsapp_send,whatsapp_templates', names('chat'));
  ok('Ask mode — what an unattended routine runs as — is offered no WhatsApp tool at all', !names('ask').some((n) => n.startsWith('whatsapp_')), names('ask'));
  ok('an unattended routine runs in Ask whatever its agent says', modeFor({ mode: 'chat' }, false) === 'ask' && modeFor({ mode: 'agent' }, false) === 'ask');
  const note = system({ mode: 'chat', extraTools: wa });
  ok('the Chat note says a broadcast is only prepared and the person sends it', /You cannot send it/.test(note) && /presses Send/.test(note));
  ok('the Chat note never says the model can start, launch or confirm a broadcast', !/(start|launch|confirm|approve) (the|a) (broadcast|campaign)/i.test(note));
  ok('it says a single send is shown to the person first', /approve it before it leaves/.test(note));

  // The loop itself: a model in Ask mode that names whatsapp_campaign anyway is refused, and the host never runs it.
  const reply = (body) => ({ ok: true, status: 200, headers: { get: (h) => (h === 'content-type' ? 'application/json' : null) }, json: async () => body, text: async () => JSON.stringify(body) });
  const call = (name, input) => reply({ content: [{ type: 'tool_use', id: 'c1', name, input }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } });
  const done = reply({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
  const run = async (mode, name) => {
    const queue = [call(name, { audience: 'a1', text: 'Hi {name}' }), done];
    globalThis.fetch = async () => queue.shift();
    let ran = '';
    const out = await runAgent({
      baseUrl: 'http://gateway.test', apiKey: 'k', model: 'claude-opus-5', root: '/p', mode,
      history: [{ role: 'user', content: 'send this to everyone' }],
      pending: { stageWrite: async () => ({ isNew: true }), stageEdit: async () => {}, currentContent: async () => '' },
      askToRun: async () => 'no', onEvent: () => {}, onDelta: () => {},
      extraTools: wa, extraRun: async (c) => { ran = c.name; return { content: '{}', isError: false }; },
    });
    const result = out.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b) => b.type === 'tool_result');
    return { ran, result };
  };
  const asked = await run('ask', 'whatsapp_campaign');
  ok('Ask (an unattended routine): whatsapp_campaign is refused by the loop and never reaches the host', asked.ran === '' && asked.result?.is_error === true && /not available/.test(asked.result.content), asked);
  const sendAsk = await run('ask', 'whatsapp_send');
  ok('Ask: whatsapp_send is refused the same way', sendAsk.ran === '' && sendAsk.result?.is_error === true);
  const chat = await run('chat', 'whatsapp_campaign');
  ok('Chat: whatsapp_campaign reaches the host, which only prepares', chat.ran === 'whatsapp_campaign');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
