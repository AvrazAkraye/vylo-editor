/**
 * Bulk WhatsApp as something the assistant can *prepare* — never start.
 *
 * "Tell the AI to send message X to the users, and attach the file with the contacts." The
 * person says it in the chat; this is how the assistant helps, and the rules it works under
 * are the product's, not the model's:
 *
 * ## The list never reaches the model
 *
 * `whatsapp_audience` reads a contacts file *here* (through an injected `readFile`, the app's
 * own `read_any_file`), parses it with `whatsappaudience.ts`, keeps it on this machine, and
 * hands the model counts and three masked examples (`+964 750 *** 4567`) — never the numbers,
 * never the names, never the titles of the file's columns (a header row is the file's own
 * words). A model asked to "send this to everyone in the file" therefore works with an
 * audience *id*, which is also why a list of five thousand does not cost five thousand numbers
 * of context. (A file the person attached to the chat as text has already gone to the model by
 * the attaching; that is the composer's disclosure to make, not something a tool can undo.)
 *
 * ## It prepares; a person presses Send
 *
 * `whatsapp_campaign` saves a **draft** campaign (`staged: true`, `consent: false`, state
 * `draft`) and says so. There is no tool, no argument and no state that starts one: the person
 * opens WhatsApp → Broadcast, sees the exact message, the number of people, the pace and the
 * time, ticks that everyone agreed to hear from them, and presses Send. `whatsapp_send` (one
 * message) always asks (`whatsapptool.ts` says why); a thousand messages do not ask less, they
 * ask more, on a screen built for it. An unattended routine runs in Ask mode (agents.ts
 * `modeFor`), which is offered no WhatsApp tool at all (agent.ts `toolsFor`): it cannot even
 * prepare one. At most `STAGED_MAX` drafts wait for the person at a time.
 *
 * ## The words are the person's
 *
 * The tool's description tells the model what the writer's prompt tells it: no invented prices,
 * dates, links or claims; `{name}` for each person's name; short; in the people's language. The
 * message is shown to the person in full before anything is sent, and it can be edited there.
 *
 * Everything this module needs from outside is a parameter, so `test/wa-tools.test.mjs` runs
 * all of it without a file system, a store or a server.
 */

import { parseAudience, makeAudience, maskPhone, excludeSuppressed, type ParseOptions } from './whatsappaudience';
import { estimateSeconds, newCampaign } from './whatsappcampaign';
import { LIMITS, type Attachment, type AttachmentKind, type Audience, type Campaign, type Draft, type Lang, type Recipient, MESSAGE_LANGS } from './whatsappbulktypes';
import { fillTemplate, placeholdersIn, searchTemplates, templateById } from './whatsapptemplates';
import { loadAudiences, loadCampaigns, loadSuppressed, saveAudience, saveCampaign } from './whatsappbulkstore';

/** What a file read hands back: the app's `read_any_file`. */
export interface FileRead {
  name: string;
  /** Base64, no prefix. */
  data: string;
  bytes: number;
}

/** What the tools need from outside. All of it is replaced in a test. */
export interface BulkDeps {
  /** The app's own file reader. Absent: the tools that read a file say so. */
  readFile?: (path: string) => Promise<FileRead>;
  loadAudiences: () => Promise<Audience[]>;
  saveAudience: (a: Audience) => Promise<boolean>;
  saveCampaign: (c: Campaign) => Promise<boolean>;
  /** The campaigns already kept, to count the drafts still waiting for the person (`STAGED_MAX`). Absent: not counted. */
  loadCampaigns?: () => Promise<Campaign[]>;
  loadSuppressed: () => Promise<ReadonlySet<string>>;
  /** The WhatsApp account the tool call is for (`whatsapp.ts` `Account.id`). */
  accountId: string;
  /** The interface's language: what a message is written in when the call names none. */
  lang?: Lang;
  /** The calling code assumed for numbers written without one. */
  country?: string;
  now?: () => number;
}

/** The real dependencies for one account: the store, the app's file reader, the interface's language. */
export function bulkDepsFor(accountId: string, lang: Lang, readFile?: BulkDeps['readFile']): BulkDeps {
  return { readFile, loadAudiences, saveAudience, saveCampaign, loadCampaigns, loadSuppressed, accountId, lang };
}

export const BULK_TOOLS = [
  {
    name: 'whatsapp_audience',
    description:
      'Prepare a list of people to message in bulk, from a file on this computer (.txt, .csv, .tsv, .vcf, .xlsx) '
      + 'or from a few numbers. The list is read and kept ON THIS MACHINE and is never shown to you: you get only '
      + 'counts and three masked examples, plus an audience id for whatsapp_campaign. Use it when the user wants to '
      + 'message many people ("send this to the numbers in contacts.csv"). Do not paste a list into a tool call. '
      + 'Only the user\'s own contacts and customers who agreed to hear from them belong in a list.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file\'s full path on this computer.' },
        numbers: { type: 'array', items: { type: 'string' }, maxItems: 50, description: 'A few numbers instead of a file, as the user wrote them.' },
        name: { type: 'string', description: 'What to call the list.' },
        country: { type: 'string', description: 'The calling code assumed for numbers written without one, as digits (964 for Iraq). Leave it out unless the user says.' },
      },
    },
  },
  {
    name: 'whatsapp_campaign',
    description:
      'Prepare — never send — a bulk WhatsApp message to an audience from whatsapp_audience. It is saved as a DRAFT that '
      + 'the user reviews under WhatsApp → Broadcast: there they see the exact message and the number of people, tick '
      + 'that everyone agreed to hear from them, and press Send. Nothing leaves the machine before that and you cannot '
      + 'start it, so say plainly that it is prepared and waiting for them. Write the message as the user would, in the '
      + 'people\'s language, short and warm, with one clear call to action. Use {name} where each person\'s name goes. '
      + 'NEVER invent a price, discount, date, time, address, link, phone number or claim the user did not give: leave '
      + 'it out or use only what they said. Or pick a ready message with `template` (see whatsapp_templates) and fill '
      + 'every one of its blanks with `values`; a blank left empty is refused, so ask the user for what is missing.',
    input_schema: {
      type: 'object',
      properties: {
        audience: { type: 'string', description: 'The audience id from whatsapp_audience.' },
        text: { type: 'string', description: 'Exactly the message, with {name} for each person\'s name. Omit when using a template.' },
        template: { type: 'string', description: 'A ready message id from whatsapp_templates, instead of text.' },
        values: { type: 'object', additionalProperties: { type: 'string' }, description: 'For a template: the blanks, such as {"business":"…","offer":"…","date":"…"}.' },
        language: { type: 'string', enum: [...MESSAGE_LANGS], description: 'en, ar (Arabic), ckb (Sorani) or kmr (Badini). Default: the interface\'s.' },
        name: { type: 'string', description: 'What to call the campaign.' },
        opt_out: { type: 'boolean', description: 'Add the "reply STOP" line. Default true; leave it on for promotions.' },
        attachment_path: { type: 'string', description: 'A picture, video or document to send with it: its full path.' },
      },
      required: ['audience'],
    },
  },
  {
    name: 'whatsapp_templates',
    description:
      'Search the ready-made WhatsApp messages — sales, new arrivals, discount codes, events, appointment reminders, '
      + 'order and delivery updates, payment reminders, one-time codes, holiday greetings and more — in English, Arabic, '
      + 'Sorani or Badini. Returns ids, titles and the text with its {blanks}. Use an id with whatsapp_campaign.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What the message is for: "eid sale", "appointment reminder", "new product".' },
        language: { type: 'string', enum: [...MESSAGE_LANGS] },
      },
    },
  },
] as const;

const NAMES: ReadonlySet<string> = new Set<string>(BULK_TOOLS.map((t) => t.name));

export const isBulkTool = (name: string): boolean => NAMES.has(name);

export interface BulkOut { content: string; isError: boolean }

const fail = (content: string): BulkOut => ({ content, isError: true });
const ok = (value: unknown): BulkOut => ({ content: JSON.stringify(value), isError: false });

/** The file types a list may come from, by extension. */
const LIST_FILE = /\.(txt|csv|tsv|vcf|xlsx)$/i;
/** The most a file may be before it is refused, in bytes. */
const LIST_BYTES = 10 * 1024 * 1024;

const str = (x: unknown, max: number): string => (typeof x === 'string' ? x.trim().slice(0, max) : '');
const langOf = (x: unknown, fallback: Lang): Lang => (MESSAGE_LANGS as readonly unknown[]).includes(x) ? (x as Lang) : fallback;

/**
 * Letters nobody sees: every format character but the two joiners Sorani and emoji need (direction overrides and
 * isolates, zero-width spaces, the soft hyphen), the whole Unicode tag block, and the control characters but the tab
 * and the line break. The engine keeps a person's own bidi marks in a message they typed (whatsappcampaign.ts); a
 * message the model wrote has no author to keep them for, and an override in it shows the person one text at Review
 * and every phone another, while tag letters carry words to whatever reads the message next. The writer's reader
 * takes out the same (whatsappwrite.ts `HIDDEN`).
 */
const INVISIBLE = /(?![‌‍])\p{Cf}|[\u{E0000}-\u{E0FFF}]|[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/gu;
const plainOf = (s: string): string => s.replace(INVISIBLE, '');

/**
 * A value the model gave for a blank, as words only: a brace or a `[[` in it would turn into a blank or a choice
 * the engine reads per person (`{code}` as a hole, `[[a|b]]` as a coin toss), which is not what "fill the blank
 * with this" means.
 */
const valueText = (s: string): string => plainOf(s).replace(/\[\[|\]\]|[{}]/g, '').trim();

/** The columns a list's people carry, as `WhatsAppPeople.tsx` `columnsOf` reads them: the blanks a message may leave to the list. */
function columnsOf(recipients: readonly Recipient[]): Set<string> {
  const out = new Set<string>();
  for (const r of recipients.slice(0, 300)) for (const k of Object.keys(r.vars ?? {})) out.add(k);
  return out;
}

/** Filled per person by the engine, never a blank for the sender (`WhatsAppReady.tsx` `PER_PERSON`). */
const PER_PERSON: readonly string[] = ['name', 'first_name'];

/**
 * Drafts the assistant may leave waiting for one account. Each is a banner on the Broadcast screen, and the store
 * keeps sixty campaigns, pushing the oldest out to make room — a model in a loop could otherwise bury the person's
 * screen and push out a paused broadcast whose record is what stops a number being messaged twice.
 */
const STAGED_MAX = 5;

/** Base64 to bytes, without trusting its length. */
function bytesOf(base64: string): Uint8Array {
  const bin = atob(base64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const KINDS: ReadonlyArray<[RegExp, AttachmentKind, string]> = [
  [/\.(png|jpe?g|gif|webp)$/i, 'image', 'image/jpeg'],
  [/\.(mp4|mov|m4v|3gp)$/i, 'video', 'video/mp4'],
  [/\.(ogg|oga|opus|mp3|m4a|aac|wav|amr)$/i, 'audio', 'audio/mpeg'],
  [/\.(pdf|docx?|xlsx?|pptx?|txt|csv|zip)$/i, 'document', 'application/octet-stream'],
];

/** A picture, video or document on this computer as something a campaign can carry, or why not. */
async function attachmentFrom(path: string, readFile: NonNullable<BulkDeps['readFile']>): Promise<Attachment | string> {
  let r: FileRead;
  try {
    r = await readFile(path);
  } catch (e) {
    return `That file could not be read: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (!(r.bytes <= LIMITS.attachmentBytes)) return `That file is over ${Math.round(LIMITS.attachmentBytes / 1048576)} MB, which is too big to send.`;
  const hit = KINDS.find(([re]) => re.test(r.name));
  if (!hit) return 'That kind of file cannot be sent. A picture, a video, a voice note or a document can.';
  return { kind: hit[1], name: r.name, mime: hit[2], bytes: r.bytes, data: r.data };
}

/**
 * Run one of the bulk tools. `null` for a name that is not one of these, so the caller can
 * fall through, the way `runWhatsAppTool` does.
 */
export async function runBulkTool(name: string, input: Record<string, unknown>, deps: BulkDeps): Promise<BulkOut | null> {
  if (!isBulkTool(name)) return null;
  const now = deps.now ?? Date.now;
  const lang = deps.lang ?? 'en';
  try {
    if (name === 'whatsapp_templates') {
      const l = langOf(input.language, lang);
      const found = searchTemplates(str(input.query, 80), l).slice(0, 6);
      if (!found.length) return ok({ templates: [], note: 'No ready message matches. Write the message yourself.' });
      return ok({
        templates: found.map((t) => ({ id: t.id, category: t.category, kind: t.kind, title: t.title[l], text: t.text[l], blanks: t.vars.filter((v) => v !== 'name') })),
        note: '{name} is filled for each person. Every other blank must be filled through `values` in whatsapp_campaign: '
          + 'ask the user for any they have not given — a draft with an empty blank is refused.',
      });
    }

    if (name === 'whatsapp_audience') {
      const country = str(input.country, 4).replace(/\D/g, '') || deps.country || '964';
      const opts: ParseOptions = { defaultCountry: country };
      let text: string | Uint8Array | null = null;
      let fileName = '';
      const path = str(input.path, 1000);
      if (path) {
        if (!deps.readFile) return fail('Reading a file is not available here. Ask the user to open WhatsApp → Broadcast and choose the file there.');
        if (!LIST_FILE.test(path)) return fail('A list can come from a .txt, .csv, .tsv, .vcf or .xlsx file.');
        const r = await deps.readFile(path);
        if (!(r.bytes <= LIST_BYTES)) return fail('That file is over 10 MB, which is too big for a list.');
        fileName = r.name;
        opts.filename = r.name;
        text = bytesOf(r.data);
      } else if (Array.isArray(input.numbers) && input.numbers.length) {
        text = input.numbers.slice(0, 50).map((n) => str(n, 40)).filter(Boolean).join('\n');
      }
      if (text === null || text === '') return fail('Give a file path or a few numbers.');
      const parsed = await parseAudience(text, opts);
      const suppressed = await deps.loadSuppressed();
      const { kept, removed } = excludeSuppressed(parsed.recipients, suppressed);
      if (!kept.length) {
        return ok({
          audience: null, people: 0, notRead: parsed.rejected.length, askedNotToBeMessaged: removed,
          note: 'No usable number was found. Nothing was saved.',
        });
      }
      const a = makeAudience({ ...parsed, recipients: kept }, plainOf(str(input.name, 60)) || fileName || 'List', now());
      if (!(await deps.saveAudience(a))) return fail('The list could not be saved on this machine.');
      // How many other columns the people carry, never their titles: a header row is the file's own words (up to
      // 256 of them, and an instruction is as easy to write there as anywhere), and a file with no header has its
      // first person read as one — "Ahmed Ali, owes 500000 dinar" would otherwise reach the model as two "columns".
      return ok({
        audience: a.id, name: a.name, people: kept.length, notRead: parsed.rejected.length, repeated: parsed.duplicates,
        askedNotToBeMessaged: removed, columns: columnsOf(kept).size,
        examples: kept.slice(0, 3).map((r) => maskPhone(r.phone)),
        note: 'The list stays on this machine; you never see it, nor the names of its columns. Use this audience id with '
          + 'whatsapp_campaign; the user can put a column into the message on the Broadcast screen.',
      });
    }

    // whatsapp_campaign
    if (deps.loadCampaigns) {
      const waiting = (await deps.loadCampaigns())
        .filter((c) => c && c.staged === true && c.state === 'draft' && c.accountId === deps.accountId).length;
      if (waiting >= STAGED_MAX) {
        return fail(`${waiting} prepared broadcasts are already waiting for the user under WhatsApp → Broadcast. `
          + 'Ask them to send or delete those (Broadcast → History) before preparing another.');
      }
    }
    const audiences = await deps.loadAudiences();
    const id = str(input.audience, 80);
    const audience = audiences.find((a) => a.id === id);
    if (!audience) {
      return fail(audiences.length
        ? `No such audience. The saved ones: ${audiences.slice(0, 8).map((a) => `${a.id} ("${a.name}", ${a.recipients.length} people)`).join('; ')}.`
        : 'There is no saved audience yet. Call whatsapp_audience first.');
    }
    const l = langOf(input.language, lang);
    let text = str(typeof input.text === 'string' ? plainOf(input.text) : '', LIMITS.messageChars + 1);
    const templateId = str(input.template, 60);
    // A promotion from the library always carries the opt-out line, as it does when the person picks it on the
    // screen (WhatsAppCompose.tsx); only a message the model wrote itself, or a service one, may go without.
    let promo = false;
    if (!text && templateId) {
      const t = templateById(templateId);
      if (!t) return fail('No such ready message. Search with whatsapp_templates.');
      promo = t.kind === 'promo';
      const values: Record<string, string> = {};
      if (input.values && typeof input.values === 'object') {
        for (const [k, v] of Object.entries(input.values as Record<string, unknown>).slice(0, 20)) {
          if (/^[a-z_]{1,24}$/.test(k) && typeof v === 'string') values[k] = valueText(v).slice(0, 200);
        }
      }
      text = fillTemplate(t, l, values);
    }
    if (!text) return fail('The message is empty. Give `text`, or a ready message with `template`.');
    if (text.length > LIMITS.messageChars) return fail(`The message is too long: at most ${LIMITS.messageChars} characters.`);
    // A blank nobody filled is refused here, as step 2 of the screen refuses it. A staged draft opens on Review, where
    // only the engine's checks run, and the engine sends an empty blank as nothing: "Use the code ** at Shop for off".
    const columns = columnsOf(audience.recipients);
    const blanks = placeholdersIn(text).filter((v) => !PER_PERSON.includes(v) && !columns.has(v));
    if (blanks.length) {
      return fail(`Nothing was prepared: the message still has blanks nobody filled — ${blanks.map((b) => `{${b}}`).join(', ')}. `
        + 'Ask the user for them (for a ready message, pass them in `values`), or write the message without them.');
    }
    const message: Draft = { text, lang: l, optOut: promo || input.opt_out !== false };
    const path = str(input.attachment_path, 1000);
    if (path) {
      if (!deps.readFile) return fail('Attaching a file is not available here. The user can attach it in WhatsApp → Broadcast.');
      const att = await attachmentFrom(path, deps.readFile);
      if (typeof att === 'string') return fail(att);
      message.attachment = att;
    }
    const campaign = newCampaign({
      name: plainOf(str(input.name, 60)) || audience.name, accountId: deps.accountId, recipients: audience.recipients,
      message, audienceId: audience.id, now: now(), staged: true,
    });
    if (!(await deps.saveCampaign(campaign))) return fail('The draft could not be saved on this machine.');
    return ok({
      campaign: campaign.id, people: campaign.recipients.length, minutes: Math.round(estimateSeconds(campaign.recipients.length, campaign.pace) / 60),
      state: 'draft', sent: 0,
      note: 'NOTHING HAS BEEN SENT. The draft is waiting under WhatsApp → Broadcast, where the user reads the exact message, confirms that everyone agreed to hear from them, and presses Send. Tell them so.',
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
