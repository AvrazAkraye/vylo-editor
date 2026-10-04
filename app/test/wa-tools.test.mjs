// The assistant's side of bulk WhatsApp (docs/WA.md): it reads a list here, prepares a draft, and cannot send.
// Everything the tools need from outside is injected, so this runs with no file system, store or server.
import { BULK_TOOLS, bulkDepsFor, isBulkTool, runBulkTool } from '../.test-build/whatsappbulktool.js';
import { runWhatsAppTool, whatsAppToolsFor } from '../.test-build/whatsapptool.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const FILE = 'Rebaz,0750 123 4567\nLayla,0751 222 3344\nbad,12\n';

/** A world in memory: the files the person has, the store, and a record of every call. */
function world(files = { '/home/me/contacts.csv': FILE }, suppressed = new Set()) {
  const saved = { audiences: [], campaigns: [] };
  const reads = [];
  return {
    saved, reads,
    deps: {
      readFile: async (path) => {
        reads.push(path);
        if (!(path in files)) throw new Error('No such file');
        const name = path.split('/').pop();
        return { name, data: b64(files[path]), bytes: files[path].length };
      },
      loadAudiences: async () => saved.audiences,
      saveAudience: async (a) => { saved.audiences.push(a); return true; },
      saveCampaign: async (c) => { saved.campaigns.push(c); return true; },
      loadSuppressed: async () => suppressed,
      accountId: 'main', lang: 'en', now: () => 1_700_000_000_000,
    },
  };
}
const json = (out) => JSON.parse(out.content);

// ── the tools exist, and the model is only offered them with a connection ──────
{
  ok('three bulk tools', BULK_TOOLS.map((t) => t.name).join() === 'whatsapp_audience,whatsapp_campaign,whatsapp_templates');
  ok('they are recognised as WhatsApp tools', BULK_TOOLS.every((t) => isBulkTool(t.name)) && !isBulkTool('whatsapp_send'));
  const conn = { baseUrl: 'https://wa.example.com', instance: 'x', key: 'k' };
  ok('offered with a connection, six tools in all', whatsAppToolsFor(conn).length === 6);
  ok('the campaign tool says it only prepares, in its own description', /Prepare — never send/.test(BULK_TOOLS[1].description) && /you cannot\s+start it/.test(BULK_TOOLS[1].description));
  ok('no tool, argument or enum value can start a campaign', !JSON.stringify(BULK_TOOLS).match(/"(start|run|send_now|confirm|consent)"/));
  ok('the audience tool says the list is never shown', /never shown to you/.test(BULK_TOOLS[0].description));
}

// ── an audience from a file: counts and masks only ────────────────────────────
{
  const w = world();
  const out = await runBulkTool('whatsapp_audience', { path: '/home/me/contacts.csv', name: 'Customers' }, w.deps);
  const r = json(out);
  ok('a file becomes an audience', !out.isError && r.people === 2 && typeof r.audience === 'string', out.content);
  ok('the line that was not a number is counted, not kept', r.notRead === 1);
  ok('the model is told the examples masked', r.examples.length === 2 && r.examples.every((e) => /\*\*\*/.test(e)), r.examples);
  ok('the result carries no full number and no name', !/\b9647\d{8,}\b/.test(out.content) && !/Rebaz|Layla/.test(out.content), out.content);
  ok('the audience is kept on this machine, with its people', w.saved.audiences.length === 1 && w.saved.audiences[0].recipients.length === 2 && w.saved.audiences[0].name === 'Customers');
  ok('the stored numbers are international digits', w.saved.audiences[0].recipients.every((p) => /^964\d{9,10}$/.test(p.phone)), w.saved.audiences[0].recipients);
}
{
  const w = world();
  const wrong = await runBulkTool('whatsapp_audience', { path: '/home/me/photo.png' }, w.deps);
  ok('a file of the wrong kind is refused before it is read', wrong.isError && w.reads.length === 0, wrong.content);
  const missing = await runBulkTool('whatsapp_audience', { path: '/home/me/none.csv' }, w.deps);
  ok('a file that is not there is an error with a reason', missing.isError && /No such file/.test(missing.content));
  const none = await runBulkTool('whatsapp_audience', {}, w.deps);
  ok('neither a path nor numbers is an error', none.isError);
  const few = await runBulkTool('whatsapp_audience', { numbers: ['0750 123 4567', '0751 999 8877', 'x'] }, w.deps);
  ok('a few numbers work without a file', !few.isError && json(few).people === 2);
  const many = await runBulkTool('whatsapp_audience', { numbers: Array.from({ length: 500 }, (_, i) => `0750 ${String(100000 + i).padStart(6, '0')}`) }, world().deps);
  ok('only fifty numbers are taken inline; a list belongs in a file', json(many).people <= 50);
  const w2 = world({ '/f.txt': '0750 123 4567\n0751 222 3344\n' }, new Set(['9647501234567']));
  const out2 = json(await runBulkTool('whatsapp_audience', { path: '/f.txt' }, w2.deps));
  ok('people who asked not to be messaged are left out and counted', out2.people === 1 && out2.askedNotToBeMessaged === 1, out2);
  const big = world({ '/big.csv': 'x' }); big.deps.readFile = async () => ({ name: 'big.csv', data: '', bytes: 11 * 1024 * 1024 });
  ok('a file over 10 MB is refused', (await runBulkTool('whatsapp_audience', { path: '/big.csv' }, big.deps)).isError);
  const noreader = { ...world().deps, readFile: undefined };
  ok('without a file reader the tool says where to go instead', /Broadcast/.test((await runBulkTool('whatsapp_audience', { path: '/home/me/contacts.csv' }, noreader)).content));
}

// ── a campaign: a draft, never started ────────────────────────────────────────
{
  const w = world();
  const aud = json(await runBulkTool('whatsapp_audience', { path: '/home/me/contacts.csv' }, w.deps)).audience;
  const out = await runBulkTool('whatsapp_campaign', { audience: aud, text: 'Hello {name}, 20% off this weekend.', name: 'Weekend' }, w.deps);
  const r = json(out);
  const c = w.saved.campaigns[0];
  ok('a draft campaign is saved', !out.isError && w.saved.campaigns.length === 1 && c.id === r.campaign);
  ok('it is staged, a draft, un-consented and unsent', c.staged === true && c.state === 'draft' && c.consent === false && Object.keys(c.outcomes).length === 0 && r.sent === 0);
  ok('it carries the audience as a snapshot and the account it is for', c.recipients.length === 2 && c.accountId === 'main' && c.audienceId === aud);
  ok('the opt-out line is on unless the model turns it off', c.message.optOut === true);
  ok('the model is told nothing was sent and where it waits', /NOTHING HAS BEEN SENT/.test(r.note) && /Broadcast/.test(r.note));
  const off = await runBulkTool('whatsapp_campaign', { audience: aud, text: 'Hi', opt_out: false }, w.deps);
  ok('opt_out false is honoured', !off.isError && w.saved.campaigns[1].message.optOut === false);
  ok('an unknown audience lists the saved ones', /No such audience/.test((await runBulkTool('whatsapp_campaign', { audience: 'zzz', text: 'Hi' }, w.deps)).content) && /contacts\.csv/.test((await runBulkTool('whatsapp_campaign', { audience: 'zzz', text: 'Hi' }, w.deps)).content));
  ok('no saved audience says to call the other tool first', /whatsapp_audience first/.test((await runBulkTool('whatsapp_campaign', { audience: 'a', text: 'Hi' }, world().deps)).content));
  ok('an empty message is refused', (await runBulkTool('whatsapp_campaign', { audience: aud, text: '   ' }, w.deps)).isError);
  ok('a message over the limit is refused', (await runBulkTool('whatsapp_campaign', { audience: aud, text: 'x'.repeat(4000) }, w.deps)).isError);
  const before = w.saved.campaigns.length;
  await runBulkTool('whatsapp_campaign', { audience: aud, text: 'Hi', consent: true, state: 'running', start: true, send: true }, w.deps);
  const last = w.saved.campaigns[before];
  ok('arguments that try to consent or start are ignored: still a draft', last.consent === false && last.state === 'draft' && last.staged === true);
  const lost = world(); lost.deps.saveCampaign = async () => false;
  const aud2 = json(await runBulkTool('whatsapp_audience', { path: '/home/me/contacts.csv' }, lost.deps)).audience;
  ok('a draft that could not be saved says so', (await runBulkTool('whatsapp_campaign', { audience: aud2, text: 'Hi' }, lost.deps)).isError);
}

// ── an attachment ─────────────────────────────────────────────────────────────
{
  const w = world({ '/home/me/contacts.csv': FILE, '/home/me/poster.png': 'PNGDATA', '/home/me/menu.pdf': 'PDFDATA', '/home/me/run.exe': 'MZ' });
  const aud = json(await runBulkTool('whatsapp_audience', { path: '/home/me/contacts.csv' }, w.deps)).audience;
  const img = await runBulkTool('whatsapp_campaign', { audience: aud, text: 'Look', attachment_path: '/home/me/poster.png' }, w.deps);
  ok('a picture rides along as an image', !img.isError && w.saved.campaigns.at(-1).message.attachment?.kind === 'image');
  await runBulkTool('whatsapp_campaign', { audience: aud, text: 'Menu', attachment_path: '/home/me/menu.pdf' }, w.deps);
  ok('a PDF rides along as a document', w.saved.campaigns.at(-1).message.attachment?.kind === 'document');
  ok('an executable is refused', (await runBulkTool('whatsapp_campaign', { audience: aud, text: 'x', attachment_path: '/home/me/run.exe' }, w.deps)).isError);
  ok('a missing attachment is refused', (await runBulkTool('whatsapp_campaign', { audience: aud, text: 'x', attachment_path: '/home/me/nope.png' }, w.deps)).isError);
}

// ── ready messages ────────────────────────────────────────────────────────────
{
  const w = world();
  const out = await runBulkTool('whatsapp_templates', { query: 'sale', language: 'en' }, w.deps);
  ok('searching the library never throws and answers in JSON', !out.isError && Array.isArray(json(out).templates));
  const bad = await runBulkTool('whatsapp_campaign', { audience: json(await runBulkTool('whatsapp_audience', { path: '/home/me/contacts.csv' }, w.deps)).audience, template: 'no-such-template' }, w.deps);
  ok('a template that does not exist is an error that says how to find one', bad.isError && /whatsapp_templates/.test(bad.content));
}

// ── through the tool runner ───────────────────────────────────────────────────
{
  const conn = { baseUrl: 'https://wa.example.com', instance: 'x', key: 'k' };
  const calls = [];
  const deps = { conn, call: async (p, b) => { calls.push(p); return {}; }, ask: async () => 'no' };
  const out = await runWhatsAppTool('whatsapp_audience', { numbers: ['0750 123 4567'] }, deps);
  ok('without bulk dependencies the runner says it is not available', out.isError && /not available/.test(out.content));
  const w = world();
  const out2 = await runWhatsAppTool('whatsapp_audience', { numbers: ['0750 123 4567'] }, { ...deps, bulk: w.deps });
  ok('with them it runs, and asks nobody and calls no server', !out2.isError && calls.length === 0);
  const unconnected = await runWhatsAppTool('whatsapp_audience', {}, { ...deps, conn: { baseUrl: '', instance: '', key: '' }, bulk: w.deps });
  ok('without a connection the usual sentence', unconnected.isError && /not connected/.test(unconnected.content));
  ok('real dependencies are built from the store and the file reader', typeof bulkDepsFor('a', 'en', async () => ({})).loadAudiences === 'function');
  ok('a name that is not a bulk tool falls through', (await runBulkTool('run_command', {}, w.deps)) === null);
}

// ── fuzz: hostile inputs never throw ──────────────────────────────────────────
{
  const w = world();
  const junk = [null, undefined, 0, -1, NaN, true, '', 'x'.repeat(5000), [], [null, 1, {}], {}, { a: { b: 1 } }, '‮evil', '../../etc/passwd', '{name}'];
  let threw = 0, shape = 0;
  for (const name of BULK_TOOLS.map((t) => t.name)) {
    for (const a of junk) for (const b of junk) {
      try {
        const out = await runBulkTool(name, { path: a, numbers: b, audience: a, text: b, template: a, values: b, language: a, name: b, opt_out: a, attachment_path: b, query: a, country: b }, w.deps);
        if (!out || typeof out.content !== 'string' || typeof out.isError !== 'boolean') shape++;
      } catch { threw++; }
    }
  }
  ok('fuzz: the tools never throw on junk arguments', threw === 0, threw);
  ok('fuzz: and always answer in the same shape', shape === 0, shape);
  ok('fuzz: nothing was ever sent, consented or started', w.saved.campaigns.every((c) => c.consent === false && c.state === 'draft'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
