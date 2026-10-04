// The Broadcast screens' pure half (docs/wa/ui.md): the remembered draft and its reader, the people and the
// message as the steps hold them, the words every code becomes, and `launch` — the one place a campaign starts —
// driven against a fake runner. wa-ui-more.test.mjs draws the screens.
//
// The screens are bundled here rather than read from `.test-build/WhatsAppBroadcast.js`: that bundle (test:build)
// inlines its own copy of React, and rendering it with this React would be two Reacts in one tree. So `buildUi`
// bundles the five components with React left outside, and swaps the engine's modules for fakes written below —
// the placeholders in src/ are empty (no countries, no templates) and the real ones are being written in parallel.
// The fakes never touch a network or a disk; the runner is a recorder the test drives by hand.
import { mkdirSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const require = createRequire(import.meta.url);

// ── the fakes ─────────────────────────────────────────────────────────────

const FAKES = {
  'whatsappaudience.mjs': `
export const COUNTRIES = [
  { iso: 'IQ', code: '964', flag: '🇮🇶', name: { en: 'Iraq', ar: 'العراق', ckb: 'عێراق', kmr: 'عیراق' } },
  { iso: 'TR', code: '90', flag: '🇹🇷', name: { en: 'Turkey', ar: 'تركيا', ckb: 'تورکیا', kmr: 'تورکیا' } },
  { iso: 'DE', code: '49', flag: '🇩🇪', name: { en: 'Germany', ar: 'ألمانيا', ckb: 'ئەڵمانیا', kmr: 'ئەلمانیا' } },
];
export function normalisePhone(raw, country) {
  const d = String(raw).replace(/[٠-٩]/g, (x) => String(x.charCodeAt(0) - 0x660)).replace(/\\D/g, '');
  if (!d) return { why: 'not-a-number' };
  if (d.length < 7) return { why: 'too-short' };
  if (d.length > 15) return { why: 'too-long' };
  if (d.startsWith('00')) return { phone: d.slice(2) };
  if (d.startsWith('0')) return { phone: country + d.slice(1) };
  if (d.startsWith(country) && d.length > 10) return { phone: d };
  return { phone: country + d };
}
export async function parseAudience(input, o = {}) {
  const text = typeof input === 'string' ? input : new TextDecoder().decode(input);
  const lines = text.split(/\\r?\\n/);
  const country = o.defaultCountry ?? '964';
  let columns = [], phoneColumn = null, nameColumn = null, start = 0;
  if (/[a-z]/i.test(lines[0] ?? '') && (lines[0] ?? '').includes(',') && !/\\d{5}/.test(lines[0])) {
    columns = lines[0].split(',').map((s) => s.trim());
    phoneColumn = o.phoneColumn ?? columns.find((c) => /phone/i.test(c)) ?? columns[0];
    nameColumn = o.nameColumn !== undefined ? (o.nameColumn || null) : (columns.find((c) => /name/i.test(c)) ?? null);
    start = 1;
  }
  const recipients = [], rejected = [], seen = new Set();
  let duplicates = 0;
  for (let i = start; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let phoneRaw = raw, name, vars = {};
    if (columns.length) {
      const cells = raw.split(',').map((s) => s.trim());
      columns.forEach((c, k) => { if (c !== phoneColumn && c !== nameColumn) vars[c] = cells[k] ?? ''; });
      phoneRaw = cells[columns.indexOf(phoneColumn)] ?? '';
      name = nameColumn ? cells[columns.indexOf(nameColumn)] : undefined;
    } else {
      const m = /^(.*?)[,\\-]?\\s*([+\\d][\\d\\s()-]{5,})\\s*$/.exec(raw);
      if (m) { phoneRaw = m[2]; name = m[1].replace(/[,\\-]\\s*$/, '').trim() || undefined; }
    }
    const n = normalisePhone(phoneRaw, country);
    if ('why' in n) { rejected.push({ line: i + 1, raw: raw.slice(0, 120), why: n.why }); continue; }
    if (seen.has(n.phone)) { duplicates++; continue; }
    seen.add(n.phone);
    recipients.push({ phone: n.phone, name, vars });
  }
  return { format: columns.length ? 'csv' : 'text', recipients, rejected, duplicates, columns, phoneColumn, nameColumn, defaultCountry: country };
}
export function countryForLang() { return '964'; }
export function fromChats(chats) {
  const recipients = chats.filter((c) => !c.group && c.jid.endsWith('@s.whatsapp.net'))
    .map((c) => ({ phone: c.jid.split('@')[0], name: /^\\d+$/.test(c.name) ? undefined : c.name, vars: {} }));
  return { format: 'chats', recipients, rejected: [], duplicates: 0, columns: [], phoneColumn: null, nameColumn: null, defaultCountry: '964' };
}
export function excludeSuppressed(list, suppressed) {
  const kept = list.filter((r) => !suppressed.has(r.phone));
  return { kept, removed: list.length - kept.length };
}
export function makeAudience(p, name, now = Date.now()) {
  return { id: 'a' + now, name, recipients: p.recipients.slice(0, 5000), source: p.format, created: now, updated: now };
}
export function maskPhone(phone) {
  return phone.length > 6 ? '+' + phone.slice(0, 3) + ' ' + phone.slice(3, 6) + ' *** ' + phone.slice(-4) : '***';
}
`,
  'whatsappcampaign.mjs': `
import { DEFAULT_PACE, PACE_BOUNDS, CAP_WARN, LIMITS } from ${JSON.stringify(join(APP, 'src/whatsappbulktypes.ts'))};
export const OPT_OUT = {
  en: 'Reply STOP to stop receiving messages.',
  ar: 'للتوقف عن استلام الرسائل أرسل STOP.',
  ckb: 'بۆ وەستاندنی نامەکان STOP بنێرە.',
  kmr: 'بۆ ڕاوەستاندنا نامەیان STOP بھنێرە.',
};
export function renderMessage(d, r, seed = 0) {
  const first = (r.name ?? '').trim().split(/\\s+/)[0] ?? '';
  let out = d.text.replace(/\\{([^{}|]+)(?:\\|([^{}]*))?\\}/g, (_, k, fb) => {
    const v = k === 'name' ? (r.name ?? '') : k === 'first_name' ? first : (r.vars[k] ?? '');
    return v || fb || '';
  });
  out = out.replace(/\\[\\[([^\\]]+)\\]\\]/g, (_, alts) => { const a = alts.split('|'); let h = seed; for (const c of r.phone) h += c.charCodeAt(0); return a[h % a.length]; });
  out = out.replace(/[ \\t]{2,}/g, ' ').replace(/ ([,.!?])/g, '$1').trim();
  if (d.optOut) out += '\\n\\n' + (d.optOutText || OPT_OUT[d.lang]);
  return out.slice(0, LIMITS.messageChars);
}
export function variablesIn(text) { return [...text.matchAll(/\\{([^{}|]+)(?:\\|[^{}]*)?\\}/g)].map((m) => m[1]); }
export function missingVars(d, recipients) {
  const names = [...new Set([...d.text.matchAll(/\\{([^{}|]+)\\}/g)].map((m) => m[1]))];
  return names.map((name) => ({ name, missing: recipients.filter((r) => !(name === 'name' || name === 'first_name' ? r.name : r.vars[name])).length }));
}
export function validateCampaign(c, o = {}) {
  const p = [];
  if (!c.recipients.length) p.push({ code: 'no-recipients' });
  if (c.recipients.length > LIMITS.recipients) p.push({ code: 'too-many', vars: { n: c.recipients.length, max: LIMITS.recipients } });
  if (!c.message.text.trim() && !c.message.attachment) p.push({ code: 'no-message' });
  if (!c.consent) p.push({ code: 'no-consent' });
  if (!c.accountId) p.push({ code: 'no-account' });
  if ((o.sentToday ?? 0) >= c.pace.dailyCap) p.push({ code: 'over-daily-cap' });
  if (c.state === 'running') p.push({ code: 'already-running' });
  return p;
}
export function newCampaign(o) {
  const now = o.now ?? Date.now();
  return { id: o.id ?? 'c' + now, name: o.name, accountId: o.accountId, audienceId: o.audienceId, recipients: o.recipients, message: o.message,
    pace: o.pace ?? { ...DEFAULT_PACE }, consent: false, state: 'draft', outcomes: {}, created: now, updated: now, staged: o.staged };
}
export function clampPace(p) {
  const out = { ...DEFAULT_PACE, ...p };
  for (const [k, [lo, hi]] of Object.entries(PACE_BOUNDS)) out[k] = Math.min(hi, Math.max(lo, out[k]));
  out.maxDelaySec = Math.max(out.maxDelaySec, out.minDelaySec);
  return out;
}
export function paceInBounds(p) { return JSON.stringify(clampPace(p)) === JSON.stringify(p); }
export function capWarning(p) { return p.dailyCap > CAP_WARN; }
export function estimateSeconds(people, pace = DEFAULT_PACE) {
  return people * (pace.minDelaySec + pace.maxDelaySec) / 2 + Math.floor(Math.max(0, people - 1) / pace.batchSize) * pace.batchPauseSec;
}
export function daysNeeded(people, pace = DEFAULT_PACE, sentToday = 0) { return Math.max(1, Math.ceil((people + sentToday) / pace.dailyCap)); }
export function isOptOut(text) { return /^\\s*(stop|unsubscribe|إيقاف|وەستان)\\s*[.!]*\\s*$/i.test(text); }
export function optOutPhones(msgs, recipients) {
  return [...new Set(msgs.filter((m) => !m.fromMe && isOptOut(m.text)).map((m) => m.jid.split('@')[0]).filter((p) => recipients.has(p)))];
}
export function reportCsv(c) {
  return ['phone,standing,why', ...c.recipients.map((r) => [r.phone, c.outcomes[r.phone]?.standing ?? 'queued', c.outcomes[r.phone]?.why ?? ''].join(','))].join('\\n');
}
`,
  'whatsappsend.mjs': `
const F = (globalThis.__waFake ??= {});
F.runs ??= []; F.tests ??= [];
export function runCampaign(c, deps) {
  const listeners = new Set();
  let resolve, reject;
  const done = new Promise((a, b) => { resolve = a; reject = b; });
  const run = { c, deps, calls: [], emit: (e) => { for (const l of listeners) l(e); }, finish: (x) => resolve(x), fail: (e) => reject(e) };
  F.runs.push(run);
  F.onRun?.(run);
  return {
    start() { run.calls.push('start'); return done; },
    pause() { run.calls.push('pause'); }, resume() { run.calls.push('resume'); }, stop() { run.calls.push('stop'); },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
export function realDeps(conn) {
  return { call: async () => { throw new Error('fake: no network'); }, instance: conn.instance, now: Date.now,
    sleep: async () => undefined, rnd: Math.random, save: async () => undefined, sentToday: async () => 0 };
}
export function recover(c) {
  const outcomes = {};
  for (const [k, o] of Object.entries(c.outcomes)) outcomes[k] = o.standing === 'sending' ? { ...o, standing: 'unknown' } : o;
  return { ...c, outcomes, state: c.state === 'running' ? 'paused' : c.state };
}
export async function sendTest(_conn, phone, text) { F.tests.push({ phone, text }); return F.testAnswer ?? 'sent'; }
`,
  'whatsappbulkstore.mjs': `
const F = (globalThis.__waFake ??= {});
F.store ??= { campaigns: new Map(), audiences: new Map(), suppressed: new Set(), saveOk: true, today: 0 };
const S = F.store;
export async function loadCampaigns() { return [...S.campaigns.values()]; }
export async function saveCampaign(c) { if (!S.saveOk) return false; S.campaigns.set(c.id, c); return true; }
export async function deleteCampaign(id) { S.campaigns.delete(id); }
export async function loadAudiences() { return [...S.audiences.values()]; }
export async function saveAudience(a) { S.audiences.set(a.id, a); return true; }
export async function deleteAudience(id) { S.audiences.delete(id); }
export async function loadSuppressed() { return new Set(S.suppressed); }
export async function addSuppressed(phones) { for (const p of phones) S.suppressed.add(p); }
export async function removeSuppressed(p) { S.suppressed.delete(p); }
export async function sentToday() { return S.today; }
`,
  'whatsapptemplates.mjs': `
const T = (en, ar, ckb, kmr) => ({ en, ar, ckb, kmr });
export const CATEGORIES = [
  { id: 'sale', icon: 'flame', title: T('Sale', 'تخفيضات', 'داشکاندن', 'داشکاندن') },
  { id: 'event', icon: 'calendar', title: T('Event', 'فعالية', 'بۆنە', 'بۆنە') },
  { id: 'appointment', icon: 'clock', title: T('Appointment', 'موعد', 'ژوانی', 'ژوان') },
  { id: 'holiday', icon: 'star', title: T('Holidays', 'مناسبات', 'جەژنەکان', 'جەژن') },
];
export const TEMPLATES = [
  { id: 'sale-1', category: 'sale', kind: 'promo', vars: ['name', 'business', 'offer', 'date'], tags: ['shop'],
    title: T('Weekend sale', 'تخفيضات نهاية الأسبوع', 'داشکاندنی کۆتایی هەفتە', 'داشکاندنا دووماهیا هەفتیێ'),
    text: T('Hello {name} 👋\\n{business} has *{offer}* until {date}. Come and see!', 'مرحباً {name} 👋\\nلدى {business} *{offer}* حتى {date}. تفضّل بزيارتنا!', 'سڵاو {name} 👋\\n{business} *{offer}*ی هەیە هەتا {date}. وەرە سەردانمان بکە!', 'سلاڤ {name} 👋\\n{business} *{offer}* هەیە هەتا {date}. وەرە سەرەدانا مە بکە!') },
  { id: 'event-1', category: 'event', kind: 'promo', vars: ['name', 'business', 'place', 'date', 'time'], tags: ['event'],
    title: T('You are invited', 'دعوة خاصة', 'بانگهێشت', 'داخوازی'),
    text: T('Dear {name}, {business} invites you to {place} on {date} at {time}.', 'عزيزي {name}، يدعوك {business} إلى {place} يوم {date} الساعة {time}.', '{name}ی بەڕێز، {business} بانگهێشتت دەکات بۆ {place} لە {date} کاتژمێر {time}.', '{name}یێ بەڕێز، {business} تە داخواز دکەت بۆ {place} ل {date} دەمژمێر {time}.') },
  { id: 'appointment-1', category: 'appointment', kind: 'service', vars: ['name', 'business', 'date', 'time'], tags: ['clinic'],
    title: T('Appointment reminder', 'تذكير بالموعد', 'بیرخستنەوەی ژوان', 'بیرئینانا ژوانێ'),
    text: T('Hello {name}, a reminder of your appointment at {business} on {date} at {time}.', 'مرحباً {name}، نذكّرك بموعدك لدى {business} يوم {date} الساعة {time}.', 'سڵاو {name}، بیرت دەخەینەوە ژوانت لە {business} لە {date} کاتژمێر {time}.', 'سلاڤ {name}، ژوانا تە ل {business} ل {date} دەمژمێر {time}.') },
  { id: 'holiday-1', category: 'holiday', kind: 'greeting', vars: ['name', 'business'], tags: ['eid'],
    title: T('Eid greetings', 'تهنئة العيد', 'پیرۆزبایی جەژن', 'پیرۆزباهیا جەژنێ'),
    text: T('Eid Mubarak, {name}! 🌙\\nWarm wishes from all of us at {business}.', 'عيد مبارك يا {name}! 🌙\\nأطيب التمنيات من فريق {business}.', 'جەژنت پیرۆز بێت {name}! 🌙\\nباشترین هیوا لە هەموومان لە {business}.', 'جەژنا تە پیرۆز بیت {name}! 🌙\\nباشترین هیڤی ژ هەمیان ل {business}.') },
];
export const TEMPLATE_LANGS = ['en', 'ar', 'ckb', 'kmr'];
export function templateById(id) { return TEMPLATES.find((t) => t.id === id); }
export function searchTemplates(q, lang, o = {}) {
  const s = String(q).trim().toLowerCase();
  return TEMPLATES.filter((t) => (!o.category || t.category === o.category) && (!s || (t.title[lang] + ' ' + t.text[lang] + ' ' + t.title.en).toLowerCase().includes(s)));
}
export function fillTemplate(t, lang, values) {
  return t.text[lang].replace(/\\{(\\w+)\\}/g, (m, k) => (k in values && values[k] ? values[k] : m));
}
`,
  'whatsappwrite.mjs': `
const F = (globalThis.__waFake ??= {});
F.writes ??= [];
export async function writeMessages(_target, _book, req, o = {}) {
  F.writes.push(req);
  if (o.signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
  if (F.writeAnswer) return F.writeAnswer(req);
  return { messages: ['Hello {name}! Our weekend offer is here: {offer}. See you soon at {business}.', 'Hi {first_name}, {offer} this weekend only at {business}.'].slice(0, req.count), said: '' };
}
export function riskHints(text) {
  const h = [];
  const letters = text.replace(/\\{[^}]*\\}/g, '').replace(/[^A-Za-z]/g, '');
  if (letters.length > 12 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.6) h.push({ code: 'caps' });
  if ((text.match(/!/g) ?? []).length > 3) h.push({ code: 'exclaims' });
  if (/bit\\.ly|tinyurl/i.test(text)) h.push({ code: 'short-link' });
  return h;
}
`,
  'tauri-core.mjs': `
const F = (globalThis.__waFake ??= {});
F.invokes ??= [];
export async function invoke(cmd, args) {
  F.invokes.push({ cmd, args });
  if (cmd === 'read_any_file') { const f = F.files?.[args.path]; if (!f) throw new Error(args.path + ': not found'); return f; }
  return null;
}
`,
  'tauri-dialog.mjs': `
const F = (globalThis.__waFake ??= {});
export async function open() { return F.pick ?? null; }
export async function save() { return F.savePath ?? null; }
`,
};

const REDIRECT = {
  './whatsappaudience': 'whatsappaudience.mjs',
  './whatsappcampaign': 'whatsappcampaign.mjs',
  './whatsappsend': 'whatsappsend.mjs',
  './whatsappbulkstore': 'whatsappbulkstore.mjs',
  './whatsapptemplates': 'whatsapptemplates.mjs',
  './whatsappwrite': 'whatsappwrite.mjs',
  '@tauri-apps/api/core': 'tauri-core.mjs',
  '@tauri-apps/plugin-dialog': 'tauri-dialog.mjs',
};

export const UI_ENTRIES = ['WhatsAppBroadcast', 'WhatsAppPeople', 'WhatsAppCompose', 'WhatsAppReady', 'WhatsAppRun'];

/**
 * The five screens, bundled against the fakes, with React outside. `splitting` so the entries share one copy of
 * each module: `launch`'s run lives in WhatsAppRun's module state, and a test that imports WhatsAppRun and renders
 * WhatsAppBroadcast must see the same run.
 */
export async function buildUi(outdir = join(APP, '.test-build/wa-ui'), extra = {}) {
  const esbuild = require('esbuild');
  const fakes = join(outdir, 'fakes');
  mkdirSync(fakes, { recursive: true });
  for (const [name, src] of Object.entries(FAKES)) writeFileSync(join(fakes, name), src);
  const redirect = {
    name: 'wa-ui-fakes',
    setup(b) {
      b.onResolve({ filter: /^(\.\/whatsapp(audience|campaign|send|bulkstore|templates|write)|@tauri-apps\/(api\/core|plugin-dialog))$/ }, (a) => {
        // The engine's own modules keep their real imports; only the screens' view of them is faked.
        if (!/WhatsApp(Broadcast|People|Compose|Ready|Run)\.tsx$/.test(a.importer) && !a.path.startsWith('@tauri')) return undefined;
        return { path: join(fakes, REDIRECT[a.path]) };
      });
    },
  };
  await esbuild.build({
    entryPoints: UI_ENTRIES.map((e) => join(APP, 'src', `${e}.tsx`)),
    bundle: true, format: 'esm', splitting: true, outdir, logLevel: 'error', jsx: 'automatic',
    external: ['react', 'react-dom'], plugins: [redirect], ...extra,
  });
  return outdir;
}

// ── the tests (only when run, not when imported by wa-ui-more) ────────────

const MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (MAIN) await main();

async function main() {
  let pass = 0, fail = 0;
  const ok = (name, cond, detail = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
    cond ? pass++ : fail++;
  };
  const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
  const SLOW = process.env.CI ? 4 : 1;

  const out = await buildUi();
  const People = await import(pathToFileURL(join(out, 'WhatsAppPeople.js')).href);
  const Compose = await import(pathToFileURL(join(out, 'WhatsAppCompose.js')).href);
  const Ready = await import(pathToFileURL(join(out, 'WhatsAppReady.js')).href);
  const Run = await import(pathToFileURL(join(out, 'WhatsAppRun.js')).href);
  const B = await import(pathToFileURL(join(out, 'WhatsAppBroadcast.js')).href);
  const F = globalThis.__waFake;
  const t = (s) => s;
  const R = (phone, name, vars = {}) => ({ phone, name, vars });

  console.log('Counts and files');
  eq('a count has a thousands comma and Latin digits', People.num(1204), '1,204');
  eq('a non-number is zero, not NaN', People.num(Number.NaN), '0');
  ok('the five list types are taken', ['a.txt', 'b.CSV', 'c.tsv', 'contacts.vcf', ' sheet.xlsx '].every(People.acceptsFile));
  ok('anything else is not', !['a.pdf', 'xlsx', 'a.xlsx.exe', '', 'noext'].some(People.acceptsFile));
  eq('base64 to bytes', [...People.bytesOf(Buffer.from([0, 1, 254, 255]).toString('base64'))], [0, 1, 254, 255]);
  ok('a drop with no zone open is not claimed', People.claimBroadcastDrop({ x: 1, y: 1 }, ['/a.csv']) === false);

  console.log('People');
  {
    const list = Array.from({ length: 20 }, (_, i) => R(`96475000000${String(i).padStart(2, '0')}`, `P${i}`, i % 2 ? { city: 'Erbil' } : { shop: 'x' }));
    eq('columns come from the people, in order, once each', People.columnsOf(list), ['shop', 'city']);
    const many = [R('1', 'a', Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`c${i}`, 'v'])))];
    eq('columns stop at the reader\'s ceiling', People.columnsOf(many).length, 12);
    const parsed = { format: 'csv', recipients: list, rejected: [{ line: 3, raw: 'abc', why: 'not-a-number' }], duplicates: 2, columns: ['phone', 'name', 'city'], phoneColumn: 'phone', nameColumn: 'name', defaultCountry: '964' };
    const p = People.peopleFrom(parsed, new Set([list[0].phone, list[1].phone]), 'x.csv');
    eq('the do-not-contact list is applied', [p.recipients.length, p.removed], [18, 2]);
    eq('and what the read said is kept', [p.rejected.length, p.duplicates, p.file, p.phoneColumn], [1, 2, 'x.csv', 'phone']);
    const a = { id: 'a1', name: 'VIP', recipients: list, source: 'csv', created: 1, updated: 2 };
    const fromA = People.peopleFromAudience(a, new Set());
    eq('a saved list keeps its name and id', [fromA.audienceId, fromA.audienceName, fromA.rejected.length], ['a1', 'VIP', 0]);
    const w = People.peopleFromAudience({ ...a, id: People.WORK_AUDIENCE_ID }, new Set());
    ok('the working list is not presented as a saved one', w.audienceId === undefined && w.audienceName === undefined);
    ok('a list at the ceiling says so', People.atCeiling({ ...p, recipients: new Array(5000).fill(list[0]), removed: 0 }));
    ok('a short one does not', !People.atCeiling(p));
    const whys = ['empty', 'too-short', 'too-long', 'not-a-number', 'country-unknown'].map((w) => People.whyText(w, t));
    eq('every reason a line was rejected has its own sentence', new Set(whys).size, 5);
  }

  console.log('The message');
  {
    eq('a chip goes in at the caret', Compose.insertAt('Hello  there', 6, 6, '{name}'), { text: 'Hello {name} there', caret: 12 });
    eq('against a word it gets a space', Compose.insertAt('Hello', 5, 5, '{name}'), { text: 'Hello {name}', caret: 12 });
    eq('over a selection it replaces it', Compose.insertAt('Hi Bob!', 3, 6, '{name}'), { text: 'Hi {name}!', caret: 9 });
    eq('a caret past the end is the end', Compose.insertAt('ab', 99, 120, '{x}'), { text: 'ab {x}', caret: 6 });
    eq('a reversed selection does not delete backwards', Compose.insertAt('abcd', 3, 1, 'Z').text, 'abc Zd');
    eq('the two per-person chips first, then the columns, once each', Compose.chipsFor(['city', 'name', 'shop']), ['name', 'first_name', 'city', 'shop']);
    const list = [R('1', ''), R('2', 'Rebaz'), R('3', 'Sara', { city: 'Duhok' }), R('4', 'Ali')];
    const s = Compose.samplePeople(list);
    eq('the preview shows three', s.length, 3);
    ok('including someone with a name and someone with a column', s.some((r) => r.name) && s.some((r) => r.vars.city));
    eq('and is the same every time', Compose.samplePeople(list).map((r) => r.phone), s.map((r) => r.phone));
    eq('a short list shows what it has', Compose.samplePeople([R('9', 'x')]).length, 1);
    eq('an empty list shows nobody', Compose.samplePeople([]).length, 0);
    const hints = ['caps', 'exclaims', 'links', 'short-link', 'long', 'money-words', 'repeat'].map((code) => Compose.hintText({ code }, t));
    eq('every spam hint is its own sentence', new Set(hints).size, 7);
    eq('WhatsApp formatting, for the preview', Compose.waRuns('a *b* _c_ ~d~ *e'), [
      { text: 'a ' }, { text: 'b', b: true, i: false, s: false }, { text: ' ' }, { text: 'c', b: false, i: true, s: false }, { text: ' ' },
      { text: 'd', b: false, i: false, s: true }, { text: ' *e' }]);
    eq('a marker across a line break is left as typed', Compose.waRuns('*a\nb*').length, 1);
    eq('the four languages have their names', ['en', 'ar', 'ckb', 'kmr'].map((l) => Compose.langName(l, t)), ['English', 'Arabic', 'Kurdish — Sorani', 'Kurdish — Badini']);
    const w = { text: 'x', lang: 'ar', optOut: true, optOutText: '  ', templateId: '', business: '' };
    eq('an empty opt-out line means the engine\'s own', Compose.draftOf(w).optOutText, undefined);
    eq('an edited one is trimmed', Compose.draftOf({ ...w, optOutText: ' Send STOP ' }).optOutText, 'Send STOP');
    ok('the draft carries nothing but the message', Object.keys(Compose.draftOf(w)).sort().join() === 'attachment,lang,optOut,optOutText,text');
  }

  console.log('Attachments');
  {
    const f = (name, bytes, data = 'QUJD') => ({ name, bytes, data });
    eq('a picture as a picture', Compose.attachmentFrom(f('a.jpg', 1000), 'image').kind, 'image');
    eq('a PDF is not a picture', Compose.attachmentFrom(f('a.pdf', 1000), 'image'), { why: 'wrong-kind' });
    eq('anything is a document', Compose.attachmentFrom(f('a.zip', 1000), 'document').kind, 'document');
    eq('over the limit is refused here too', Compose.attachmentFrom(f('a.mp4', 16 * 1024 * 1024 + 1), 'video'), { why: 'too-big' });
    eq('no bytes is unreadable', Compose.attachmentFrom(f('a.jpg', 0, ''), 'image'), { why: 'unreadable' });
    eq('a negative size is unreadable', Compose.attachmentFrom(f('a.jpg', -5), 'image'), { why: 'unreadable' });
    ok('a voice note takes audio files', Compose.extensionsFor('audio').includes('ogg') && Compose.attachmentFrom(f('n.ogg', 10), 'audio').kind === 'audio');
    eq('every kind has a name', new Set(Compose.ATTACH_KINDS.map((k) => Compose.attachKindName(k, t))).size, 5);
    ok('a long file name is cut', Compose.attachmentFrom(f(`${'x'.repeat(400)}.pdf`, 10), 'document').name.length <= 200);
  }

  console.log('Placeholders');
  {
    eq('placeholders in order, once each, fallbacks read as the name', Ready.placeholdersIn('{a} {b|x} {a} \\{c} {d}'), ['a', 'b', 'd']);
    ok('a placeholder is not read across a line', Ready.placeholdersIn('{a\nb}').length === 0);
    eq('a hole is a blank no column fills', Ready.holesIn('Hi {name}, {offer} in {city}', ['city']), ['offer']);
    eq('name and first_name are never holes', Ready.holesIn('{name} {first_name}', []), []);
    const tpl = { vars: ['name', 'business', 'offer', 'city'] };
    eq('the form asks only for what the list cannot fill', Ready.toFill(tpl, ['city']), ['business', 'offer']);
    const ph = ['business', 'offer', 'price', 'old_price', 'discount', 'code', 'date', 'time', 'place', 'address', 'link', 'phone', 'product', 'service', 'hours', 'points', 'days'];
    eq('every placeholder the library uses has its own label', new Set(ph.map((v) => Ready.placeholderLabel(v, t))).size, ph.length);
    eq('an unknown one is its own name', Ready.placeholderLabel('colour', t), 'colour');
    eq('the three kinds are named', new Set(['promo', 'service', 'greeting'].map((k) => Ready.kindText(k, t))).size, 3);
  }

  console.log('The remembered draft');
  {
    const fresh = B.readWork(null, 'ar');
    eq('nothing stored: a fresh draft in the interface\'s language', [fresh.lang, fresh.step, fresh.optOut, fresh.text, fresh.staged], ['ar', 1, true, '', false]);
    eq('with the country the language most likely means', fresh.country, '964');
    eq('and the product\'s pace', fresh.pace, { minDelaySec: 12, maxDelaySec: 30, batchSize: 20, batchPauseSec: 180, dailyCap: 200, stopAfterFailures: 3, typing: true });
    ok('and an id it will be saved under', /^[\w-]{1,48}$/.test(fresh.id));
    for (const raw of ['', 'x', '[]', 'null', '42', '"text"', '{"__proto__":{"polluted":1}}', '{{{', '\u0000']) {
      const w = B.readWork(raw, 'en');
      ok(`junk (${JSON.stringify(raw).slice(0, 20)}) is a fresh draft`, w.step === 1 && w.text === '' && w.lang === 'en' && !('polluted' in {}));
    }
    const hostile = B.readWork(JSON.stringify({
      text: 'x'.repeat(10_000), lang: 'fr', optOut: 'yes', optOutText: 7, templateId: { a: 1 }, business: 'b'.repeat(500), step: 9,
      country: '+964', id: '../../etc', staged: 'true',
      pace: { minDelaySec: 1, maxDelaySec: -4, batchSize: 1e9, batchPauseSec: 'x', dailyCap: 5000, stopAfterFailures: Number.NaN, typing: 1 },
    }), 'ckb');
    eq('every field falls back on its own', [hostile.lang, hostile.optOut, hostile.optOutText, hostile.templateId, hostile.step, hostile.country, hostile.staged],
      ['ckb', true, '', '', 1, '964', false]);
    eq('the text is capped at the message ceiling', hostile.text.length, 3800);
    eq('the business name at the value ceiling', hostile.business.length, 120);
    ok('an id that is not one is replaced', hostile.id !== '../../etc' && /^[\w-]+$/.test(hostile.id));
    eq('the pace is pulled inside the bounds', [hostile.pace.minDelaySec, hostile.pace.maxDelaySec, hostile.pace.batchSize, hostile.pace.batchPauseSec, hostile.pace.dailyCap, hostile.pace.stopAfterFailures, hostile.pace.typing],
      [6, 8, 100, 180, 1000, 3, true]);
    const p = B.readPace({ minDelaySec: 50, maxDelaySec: 20 });
    ok('the longest wait is never under the shortest', p.maxDelaySec >= p.minDelaySec, p);
    const kept = { ...B.blankWork('en'), text: 'Hi {name}', lang: 'kmr', step: 2, pace: { ...fresh.pace, dailyCap: 350 }, attachment: { kind: 'image', name: 'a.jpg', mime: 'image/jpeg', bytes: 3, data: 'QUJD' } };
    const stored = B.writeWork(kept);
    ok('the attachment is not stored (megabytes)', !stored.includes('QUJD') && !stored.includes('attachment'));
    const back = B.readWork(stored, 'en');
    eq('and the rest comes back as it was', [back.text, back.lang, back.step, back.pace.dailyCap, back.id], ['Hi {name}', 'kmr', 2, 350, kept.id]);
    ok('consent is not a field of the draft at all', !('consent' in back) && !stored.includes('consent'));
    const keep = B.blankWork('en', { country: '90', pace: back.pace, lang: 'ar', optOut: false, business: 'Shop' });
    eq('Start over keeps the choices and clears the words', [keep.country, keep.pace.dailyCap, keep.lang, keep.optOut, keep.business, keep.text, keep.step], ['90', 350, 'ar', false, 'Shop', '', 1]);
    ok('and starts a new campaign id', keep.id !== back.id);
    eq('the storage key', B.DRAFT_KEY, 'vylo.whatsapp.bulk.draft.v1');
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) B.readWork(stored, 'en');
    ok('reading the draft is cheap', performance.now() - t0 < 200 * SLOW, performance.now() - t0);
  }

  console.log('What blocks a step');
  {
    const msg = { text: '', lang: 'en', optOut: true, optOutText: '', templateId: '', business: '' };
    const ppl = (n, removed = 0, columns = []) => ({ recipients: Array.from({ length: n }, (_, i) => R(`9647500000${i}`, `N${i}`)), source: 'text', rejected: [], duplicates: 0, removed, columns, phoneColumn: null, nameColumn: null });
    eq('no people', B.blockerOf(1, null, msg, t), 'Add at least one person.');
    eq('everyone on the do-not-contact list', B.blockerOf(1, ppl(0, 4), msg, t), 'Everyone on this list asked not to be messaged.');
    eq('people: step 1 can go on', B.blockerOf(1, ppl(3), msg, t), '');
    eq('step 2 needs words or a file', B.blockerOf(2, ppl(3), msg, t), 'Write a message, or attach something.');
    eq('a file alone is a message', B.blockerOf(2, ppl(3), { ...msg, attachment: { kind: 'image', name: 'a', mime: 'image/png', bytes: 1, data: 'x' } }, t), '');
    ok('a blank nobody fills blocks, naming it', B.blockerOf(2, ppl(3), { ...msg, text: 'Get {offer} now' }, t).includes('{offer}'));
    eq('a column of the list is not a blank', B.blockerOf(2, ppl(3, 0, ['city']), { ...msg, text: 'Hi {name} in {city}' }, t), '');
    eq('the campaign is named after its list', B.campaignName({ audienceName: 'VIP customers' }, 'x', 'B'), 'VIP customers');
    eq('else after the first line of the message', B.campaignName(null, '\n  Eid sale!\nmore', 'B'), 'Eid sale!');
    ok('cut when it is long', B.campaignName(null, 'w'.repeat(90), 'B').length === 48);
    eq('else the fallback', B.campaignName(null, '  ', 'Broadcast'), 'Broadcast');
  }

  console.log('Counting a run');
  {
    const recipients = ['1', '2', '3', '4', '5', '6', '7'].map((p) => R(`96475000000${p}`, `N${p}`));
    const o = (phone, standing, at) => ({ phone, standing, at, attempts: 1 });
    const c = {
      id: 'c1', name: 'n', accountId: 'main', recipients, message: { text: 'x', lang: 'en', optOut: true }, pace: B.readPace({}), consent: true,
      state: 'running', created: 1, updated: 1,
      outcomes: Object.fromEntries([o(recipients[0].phone, 'sent', 10), o(recipients[1].phone, 'failed', 20), o(recipients[2].phone, 'unknown', 30),
        o(recipients[3].phone, 'skipped-not-on-whatsapp', 40), o(recipients[4].phone, 'sending', 50)].map((x) => [x.phone, x])),
    };
    eq('counted from the outcomes, the untouched as queued', Run.countsOf(c), { total: 7, sent: 1, failed: 1, unknown: 1, skipped: 1, sending: 1, queued: 2 });
    eq('progress is everyone with a standing', Math.round(Run.progressOf(c) * 100), 57);
    eq('the person being messaged now', Run.nowSending(c)?.phone, recipients[4].phone);
    eq('the latest first, the in-flight left out', Run.lastOutcomes(c).map((x) => x.standing), ['skipped-not-on-whatsapp', 'unknown', 'failed', 'sent']);
    eq('an empty campaign is at zero, not NaN', Run.progressOf({ ...c, recipients: [], outcomes: {} }), 0);
    eq('the report filters', ['all', 'sent', 'failed', 'unknown', 'skipped'].map((f) => Run.reportRows(c, f).length), [7, 1, 1, 1, 1]);
    ok('a stored running campaign the window does not hold was interrupted', Run.interruptedOf(c, null));
    ok('the one it holds was not', !Run.interruptedOf(c, c));
    ok('paused by the person is not interrupted', !Run.interruptedOf({ ...c, state: 'paused' }, null));
  }

  console.log('Confirming a large send');
  {
    ok('fifty is sent without typing', !Run.needsTyped(50));
    ok('fifty-one asks for the number', Run.needsTyped(51));
    for (const typed of ['1204', '1,204', ' 1 204 ', '١٢٠٤', '۱۲۰۴']) ok(`"${typed}" confirms 1,204`, Run.typedOk(typed, 1204));
    for (const typed of ['', '1203', '12045', 'yes', '1204x', '-1204']) ok(`"${typed}" does not`, !Run.typedOk(typed, 1204));
  }

  console.log('Words for codes');
  {
    eq('under a minute', Run.durationText(30, t), 'under a minute');
    eq('minutes', Run.durationText(19 * 60, t), 'about 19 min');
    eq('hours and minutes', Run.durationText(3 * 3600 + 10 * 60, t), 'about 3 h 10 min');
    eq('whole hours', Run.durationText(2 * 3600, t), 'about 2 h');
    eq('a negative time is none', Run.durationText(-5, t), 'under a minute');
    const codes = ['no-recipients', 'too-many', 'no-message', 'message-too-long', 'no-consent', 'no-account', 'attachment-too-big', 'attachment-unreadable', 'pace-out-of-bounds', 'over-daily-cap', 'already-running'];
    eq('every problem is its own sentence', new Set(codes.map((code) => Run.problemText({ code }, t))).size, codes.length);
    ok('with its numbers filled in', Run.problemText({ code: 'too-many', vars: { n: 5200, max: 5000 } }, t).includes('5,200'));
    const halts = ['auth', 'not-connected', 'rate-limited', 'repeated-failures', 'account', 'storage', 'instance', 'something-new'];
    eq('every halt reason is its own sentence, and an unknown one still says something', new Set(halts.map((h) => Run.haltText(h, t))).size, halts.length);
    eq('the brief\'s sentence for a refused key', Run.haltText('auth', t), 'The WhatsApp server refused the key. Check the connection in settings.');
    eq('the next message, counted down', Run.waitText({ why: 'delay', until: 18_000 }, 0, t), 'Next message in 18 s.');
    ok('a break says until when', Run.waitText({ why: 'batch', until: Date.now() + 60_000 }, Date.now(), t).startsWith('Taking a break until '));
    ok('the daily cap says it continues tomorrow', Run.waitText({ why: 'daily-cap', until: Date.now() + 3_600_000 }, Date.now(), t).includes('continues tomorrow'));
    eq('every state is named', new Set(['draft', 'ready', 'running', 'paused', 'done', 'stopped', 'halted'].map((s) => Run.stateText(s, t))).size, 7);
    eq('every standing is named', new Set(['queued', 'sending', 'sent', 'failed', 'unknown', 'skipped-not-on-whatsapp', 'skipped-opted-out', 'skipped-invalid', 'skipped-duplicate'].map((s) => Run.standingText(s, t))).size, 9);
    eq('every refusal is a sentence', new Set(['busy', 'no-consent', 'problems', 'storage', 'no-account'].map((r) => Run.refusalText(r, t))).size, 5);
    eq('the test number is remembered only when it is one', [Run.readMe('9647501234567'), Run.readMe('+964 750'), Run.readMe(null), Run.readMe('<script>')], ['9647501234567', '', '', '']);
  }

  console.log('launch: the one place a campaign starts');
  {
    const acct = { id: 'main', name: 'Shop', baseUrl: 'https://gw.example', instance: 'shop', key: 'k' };
    const recipients = [R('9647500000001', 'A'), R('9647500000002', 'B')];
    const base = {
      id: 'c-launch', name: 'n', accountId: 'main', recipients, message: { text: 'Hi {name}', lang: 'en', optOut: true }, pace: B.readPace({}),
      consent: true, state: 'draft', outcomes: {}, created: 1, updated: 1,
    };
    const runs = () => F.runs.length;
    const before = runs();
    eq('no account: refused', await Run.launch(base, null, 0), 'no-account');
    eq('an account that is not set up: refused', await Run.launch(base, { ...acct, key: '' }, 0), 'no-account');
    eq('another account than the campaign\'s: refused', await Run.launch(base, { ...acct, id: 'other' }, 0), 'no-account');
    eq('no consent: refused', await Run.launch({ ...base, consent: false }, acct, 0), 'no-consent');
    eq('consent that is not exactly true: refused', await Run.launch({ ...base, consent: 'yes' }, acct, 0), 'no-consent');
    eq('a problem the engine finds: refused', await Run.launch({ ...base, recipients: [] }, acct, 0), 'problems');
    eq('today\'s cap already reached: refused', await Run.launch(base, acct, 200), 'problems');
    F.store.saveOk = false;
    eq('a campaign that cannot be saved first: refused', await Run.launch(base, acct, 0), 'storage');
    F.store.saveOk = true;
    eq('none of those made a runner', runs(), before);
    let told = 0;
    const off = Run.watchLive(() => { told++; });
    eq('everything right: it starts', await Run.launch(base, acct, 0), null);
    eq('exactly one runner', runs(), before + 1);
    const run = F.runs[F.runs.length - 1];
    ok('it was saved before the runner was made, as ready, no longer staged', F.store.campaigns.get('c-launch')?.state === 'ready' && F.store.campaigns.get('c-launch')?.staged === false);
    ok('the runner was started', run.calls.includes('start'));
    ok('with the account\'s instance (the real wire is realDeps\')', run.deps.instance === 'shop');
    ok('and the screens were told', told > 0 && Run.liveRun()?.campaign.id === 'c-launch');
    eq('a second while it runs: refused', await Run.launch({ ...base, id: 'c-two' }, acct, 0), 'busy');
    eq('and made no runner', runs(), before + 1);
    run.emit({ kind: 'wait', until: 99, why: 'delay' });
    eq('a wait is drawn', Run.liveRun().wait, { until: 99, why: 'delay' });
    const sending = { ...run.c, state: 'running', outcomes: { [recipients[0].phone]: { phone: recipients[0].phone, standing: 'sent', attempts: 1, at: 5 } } };
    run.emit({ kind: 'state', campaign: sending });
    eq('a state is drawn, the wait kept while running', [Run.countsOf(Run.liveRun().campaign).sent, Run.liveRun().wait?.until], [1, 99]);
    Run.dismissRun();
    ok('a running campaign cannot be dismissed', Run.liveRun() !== null);
    run.finish({ ...sending, state: 'done' });
    await new Promise((r) => setTimeout(r, 5));
    ok('when it ends the screens know', Run.liveRun().over === true && Run.liveRun().campaign.state === 'done' && Run.liveRun().wait === null);
    Run.dismissRun();
    eq('a finished one is forgotten on request', Run.liveRun(), null);
    off();
    // A runner that throws (it promises not to) still ends, with the reason in words.
    eq('another can start after', await Run.launch({ ...base, id: 'c-three' }, acct, 0), null);
    F.runs[F.runs.length - 1].fail(new Error('boom'));
    await new Promise((r) => setTimeout(r, 5));
    ok('a crash ends the run and is said', Run.liveRun().over && Run.liveRun().crash.includes('boom'));
    Run.dismissRun();
    const applied = Run.applyEvent({ runner: null, campaign: base, wait: { until: 1, why: 'batch' }, over: false, crash: '' }, { kind: 'state', campaign: { ...base, state: 'halted' } });
    eq('a halt clears the wait', applied.wait, null);
  }

  console.log('STOP replies');
  {
    const c = { recipients: [R('9647500000001', 'A'), R('9647500000002', 'B')] };
    const m = (jid, text, fromMe = false) => ({ jid, text, fromMe });
    eq('only the campaign\'s people who replied a stop word', Run.stopRepliesFor(c, [
      m('9647500000001@s.whatsapp.net', 'STOP'), m('9647500000002@s.whatsapp.net', 'please stop by tomorrow'),
      m('9647500000009@s.whatsapp.net', 'stop'), m('9647500000002@s.whatsapp.net', 'STOP', true),
    ]), ['9647500000001']);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
