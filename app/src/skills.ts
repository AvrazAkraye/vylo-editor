/**
 * Skills: instruction sheets an agent can carry, at `.vylo/SKILLS.md`.
 *
 * A brief says who an agent is. A skill says how to do one kind of thing —
 * how this project wants a review written, what its release notes leave out —
 * and several agents can carry the same one. BridgeMind's name for it, and
 * the name is right: it is something an agent knows how to do, written once,
 * attached by name, and read into what the model is told at the start of
 * every run that agent makes. The Reviewer and the Fixer both carry `Review`;
 * change the sheet and both of them change.
 *
 * ## Markdown, in the project, the same grammar as `AGENTS.md`
 *
 * The file travels with the repository, is readable on GitHub, and diffs in a
 * review. For text that is handed to a model verbatim that is the whole
 * point: a skill a teammate added is one you can read before an agent runs
 * with it, and a line that changed is a line a review can see. So it is the
 * same shape as `.vylo/AGENTS.md` and `.vylo/PROMPTS.md`, read the same way:
 * a `# Skills` title with a sentence explaining the file, then a heading per
 * skill, and what follows the heading is the sheet.
 *
 *     ## Review
 *
 *     Read the change before forming a view of it. For each finding give the
 *     file and line, and say plainly if there is nothing.
 *
 * ## No metadata
 *
 * An agent has three things to say about itself besides its brief, and
 * `agents.ts` reads them from a list at the top of the body. A skill has
 * nothing to say about itself: no mode, because a sheet does not decide what
 * the agent carrying it may do; no model; no list of other skills, because a
 * skill that pulls in skills is a dependency graph in a file a person is
 * meant to read top to bottom. So a skill is a heading and a body, and the
 * body starts on the first line under the heading. There is nothing here for
 * a `- key: value` line to mean, so one is body text — an instruction sheet
 * that begins with a bullet list begins with a bullet list.
 *
 * A folder of `skills/*.md` was considered, one file per skill, which is the
 * shape some tools use. One file wins here for the reason `PROMPTS.md` is one
 * file: it is read by a parser that already exists, it is edited by a panel
 * that already knows how, and a person reading the project sees every sheet
 * an agent might be given in one place, in one diff.
 *
 * ## Attached by name, and what an unknown name does
 *
 * An agent's file says `- skills: Review, Release notes`. A person typed that,
 * so it is matched the way `find` matches everything in this app: the id
 * exactly, then the name without regard to case, then whatever the query
 * slugs to — `release-notes`, `Release Notes` and `release notes` are the same
 * skill to whoever wrote them. `textFor` does that lookup for a whole agent
 * and hands back what `agents.systemPromptFor` takes: a record from name to
 * text, keyed by the name *as the agent wrote it*, so the exact lookup on the
 * other side hits first and the heading the model sees is the one the agent
 * chose.
 *
 * A name the file does not have is dropped there, silently, because a heading
 * with nothing under it tells the model only that somebody made a mistake.
 * Silence is right for the model and wrong for the person, which is what
 * `missing` is for: the Routines panel asks it which of an agent's skills the
 * file does not have and says so in the row, before the run, while there is
 * still somebody to read it.
 *
 * ## The id is a slug, and it is unique in the file
 *
 * `review`, from "Review", the same way `agents.ts` makes one, including the
 * part that keeps letters in any script — this app is localised, and a slug
 * that only survives ASCII would hand every non-English name the same id.
 * Two skills with the same name are two skills; the second becomes
 * `review-2`, in file order, and stays that until somebody renames one.
 *
 * ## A title alone is a file with no skills in it
 *
 * The file after the last skill is removed is `# Skills` and a paragraph.
 * Read strictly, that is one skill called "Skills" whose body is the
 * paragraph; read as a person reads it, it is a title. `agents.ts` tells the
 * two apart by the metadata line it always writes under an entry, and this
 * file has none, so the rule here is the level alone: a lone level-one
 * heading is a title, whatever is under it, and the next skill goes one
 * level down. A lone `## Review` is a skill, because nobody titles a file
 * with two hashes. `parse`, `update` and `remove` all read the file this
 * way, so the title cannot be listed, rewritten or removed by a panel that
 * lists skills.
 *
 * ## Editing is entry-level, as `AGENTS.md` is
 *
 * Changing a skill rewrites that one entry and leaves every other byte where
 * it was: the lines above, the blank lines that separate it from the next
 * heading, everything after, and the carriage return on every line of a CRLF
 * file. The file will have a title, a paragraph explaining it, and spacing
 * nobody here chose, and none of that is this module's to reformat.
 */

export interface Skill {
  /** Slug of the name, unique within the file. How a reference points at it. */
  id: string;
  /** The heading. What the row says, and what an agent names in `- skills:`. */
  name: string;
  /** Everything under the heading, trimmed. What the model is told. */
  body: string;
  /** Index of the heading line, so one entry can be rewritten in place. */
  line: number;
}

/**
 * What a form fills in: a skill without the two fields the file decides.
 * `id` comes from the name and `line` from where it lands.
 */
export type Draft = Pick<Skill, 'name' | 'body'>;

/** `## Anything`, at any level. `\r?$` because the file lives in a repository. */
const HEADING = /^(#{1,6})\s+(.*?)\r?$/;

/** The level of every heading in the file, in order. */
function levels(text: string): number[] {
  const out: number[] = [];
  for (const line of text.split('\n')) {
    const h = HEADING.exec(line);
    if (h) out.push(h[1].length);
  }
  return out;
}

/**
 * Which heading level names a skill.
 *
 * The same rule as `prompts.ts` and `agents.ts`, for the same file shapes: a
 * person writes `# Skills` at the top and `## Each one` below, and the
 * sentence under the title is not a skill; somebody else writes the whole
 * file with `#`, and every one of those is.
 *
 *   > The shallowest heading level is the entry level, unless there is exactly
 *   > one heading at it and deeper headings exist — then that one is the
 *   > document's title and the next level down holds the entries.
 */
export function entryLevel(text: string): number {
  const all = levels(text);
  if (!all.length) return 1;
  const top = Math.min(...all);
  const atTop = all.filter((l) => l === top).length;
  const deeper = all.filter((l) => l > top);
  if (atTop === 1 && deeper.length) return Math.min(...deeper);
  return top;
}

/**
 * A name as an id: lowercase, words joined with hyphens, nothing else.
 *
 * Letters, digits and combining marks in any script are kept, as `agents.slug`
 * keeps them — a skill named in Hindi has an id in Hindi rather than an empty
 * one. A name with no letters or digits at all gets `skill`, which `parse`
 * then makes unique in the usual way.
 */
export function slug(name: string): string {
  const s = name.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\p{M}]+/gu, '-').replace(/^-+|-+$/g, '');
  return s || 'skill';
}

/**
 * A file whose only heading is a level-one title.
 *
 * `entryLevel` would call that heading the entry. `add` never writes one, and
 * `parse`, `update` and `remove` follow the same reading — see the header.
 */
function titleOnly(text: string): boolean {
  const all = levels(text);
  return all.length === 1 && all[0] === 1;
}

/**
 * Every skill in the file, in order, with ids made unique.
 *
 * A heading with nothing under it is not a skill: it is a name somebody has
 * not finished writing, and handing the model an empty sheet under it would
 * tell the model nothing. Prose before the first heading belongs to nobody,
 * which is where the sentence explaining the file goes.
 */
export function parse(text: string): Skill[] {
  // A title and a paragraph is a file with no skills in it, not one skill
  // named after the title — which is what the file looks like once the last
  // skill is removed.
  if (titleOnly(text)) return [];
  const lines = text.split('\n');
  const level = entryLevel(text);
  const out: Skill[] = [];
  let name = '';
  let at = -1;
  let body: string[] = [];

  const flush = () => {
    if (at < 0) return;
    const raw = body.join('\n').trim();
    if (name && raw) out.push({ id: '', name, body: raw, line: at });
    body = [];
  };

  lines.forEach((line, i) => {
    const h = HEADING.exec(line);
    if (h) {
      // A heading shallower than the entry level is the document's title, and
      // ends whatever entry was open. A deeper one is part of the body — a
      // sheet with sections in it is still one sheet.
      if (h[1].length <= level) {
        flush();
        if (h[1].length === level) { name = h[2].trim(); at = i; }
        else { name = ''; at = -1; }
        return;
      }
    }
    if (at >= 0) body.push(line.replace(/\r$/, ''));
  });
  flush();

  // Second and later take a suffix, in file order, so the first "Review"
  // keeps `review` however many are added below it.
  const taken = new Set<string>();
  for (const s of out) {
    const base = slug(s.name);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    s.id = id;
  }
  return out;
}

/**
 * One skill, by id or by name.
 *
 * The id first, exactly — that is what a stored reference is. Then the name,
 * case-insensitively, and then whatever the query slugs to, so "Release Notes"
 * in an agent's `- skills:` line finds `release-notes` without anybody
 * knowing the rule.
 */
export function find(list: readonly Skill[], idOrName: string): Skill | undefined {
  const q = idOrName.trim();
  if (!q) return undefined;
  const lower = q.toLowerCase();
  return list.find((s) => s.id === q)
    ?? list.find((s) => s.name.toLowerCase() === lower)
    ?? list.find((s) => s.id === slug(q));
}

// ── Writing ────────────────────────────────────────────────────────────────

/** A draft with its strings cleaned, or nothing if there is not a skill in it. */
function clean(draft: Draft): Draft | null {
  const name = draft.name.replace(/[\r\n]+/g, ' ').trim();
  const body = draft.body.replace(/\r/g, '').trim();
  // A name with nothing under it is a placeholder — the same rule `parse`
  // reads by — and a sheet with no name is one nobody can attach.
  if (!name || !body) return null;
  return { name, body };
}

/** The lines of one entry: the heading, a blank line, the sheet. */
function render(s: Draft, hashes: string): string[] {
  return [`${hashes} ${s.name}`, '', ...s.body.split('\n')];
}

/**
 * The heading level a new entry should use.
 *
 * The level the existing skills are at. `prompts.ts` always writes `##`, which
 * is right for a file with a title and wrong for a file written entirely with
 * `#`: there, a `##` at the end is read as part of the last entry's body, and
 * the new one vanishes into it.
 *
 * A file with exactly one heading is the case the rule cannot settle on its
 * own, and the header says how it is settled here: a lone `#` is a title and
 * the first skill goes one level down; a lone heading at any other level is
 * a skill, and the next goes beside it.
 */
function levelForAdd(text: string): number {
  const all = levels(text);
  if (!all.length) return 2;
  if (all.length === 1) return all[0] === 1 ? 2 : all[0];
  return entryLevel(text);
}

/**
 * Add a skill at the end.
 *
 * A blank line before the heading whatever the file ended with, because two
 * headings with no gap render as one paragraph in some viewers and read as a
 * mistake in all of them. A CRLF file gets CRLF lines, so the addition does
 * not show up as a file that is now half one thing and half the other.
 */
export function add(text: string, draft: Draft): string {
  const s = clean(draft);
  if (!s) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const head = text.replace(/\s+$/, '');
  const entry = render(s, '#'.repeat(levelForAdd(text))).join(eol) + eol;
  return head ? `${head}${eol}${eol}${entry}` : entry;
}

/** Where the entry whose heading is at `line` ends: the next heading at or above its level. */
function endOf(lines: string[], line: number, level: number): number {
  for (let i = line + 1; i < lines.length; i++) {
    const h = HEADING.exec(lines[i]);
    // Stops at the next entry or at anything shallower, never at a heading
    // *inside* the sheet — a sheet with sections in it goes whole.
    if (h && h[1].length <= level) return i;
  }
  return lines.length;
}

/**
 * Remove one skill, heading and body.
 *
 * Only an entry: the title is not a skill and cannot be removed by a panel
 * that lists skills. The blank lines that separated it go with it; the ones
 * above the next heading are put back, so removing an entry from the middle
 * does not close the gap around its neighbour.
 */
export function remove(text: string, line: number): string {
  const lines = text.split('\n');
  if (line < 0 || line >= lines.length || titleOnly(text)) return text;
  const level = entryLevel(text);
  const h = HEADING.exec(lines[line]);
  if (!h || h[1].length !== level) return text;
  const end = endOf(lines, line, level);
  const before = lines.slice(0, line);
  const after = lines.slice(end);
  // Close the gap the cut left to the one blank line that separated the
  // neighbours — and only that gap. Blank runs anywhere else, including inside
  // another skill's sheet, are that skill's bytes and stay.
  while (before.length && after.length && !before[before.length - 1].trim() && !after[0].trim()) after.shift();
  while (!before.length && after.length && !after[0].trim()) after.shift();
  const out = [...before, ...after];
  // `split('\n')` takes the newline off a line but leaves the carriage return
  // on it, so a blank line of a CRLF file is "\r". Cutting the last entry
  // leaves that blank last, and joining would write its carriage return back
  // with no newline after it — a stray CR at the end of a file that never had
  // one. What follows a file's final newline is nothing, so make it nothing.
  if (out.length && out[out.length - 1] === '\r') out[out.length - 1] = '';
  return out.join('\n');
}

/**
 * Rewrite one skill in place.
 *
 * The whole entry is replaced — heading and sheet — because a rename is a
 * different entry, and the old bytes mean nothing in it. Everything else is
 * left where it was: the lines above, the blank lines that separate it from
 * the next heading, the next heading and everything after, and the carriage
 * return on every line of a CRLF file. The heading keeps the level it had,
 * which is the file's entry level by definition.
 */
export function update(text: string, line: number, draft: Draft): string {
  const lines = text.split('\n');
  if (line < 0 || line >= lines.length || titleOnly(text)) return text;
  const level = entryLevel(text);
  const h = HEADING.exec(lines[line]);
  if (!h || h[1].length !== level) return text;
  const s = clean(draft);
  if (!s) return text;

  const end = endOf(lines, line, level);
  // The blank run before the next heading is the gap, not the entry. Keeping
  // it is what stops an edit from also closing up the file around it.
  let keep = end;
  while (keep > line + 1 && !lines[keep - 1].trim()) keep--;

  // The carriage return is part of the line as far as `split` is concerned,
  // and dropping it would convert one entry of a CRLF file to LF and leave the
  // rest — a diff on every line of an entry nobody meant to reformat.
  const cr = lines[line].endsWith('\r') ? '\r' : '';
  lines.splice(line, keep - line, ...render(s, h[1]).map((l) => l + cr));
  return lines.join('\n');
}

// ── Handing them to an agent ───────────────────────────────────────────────

/**
 * The text of an agent's skills, as `agents.systemPromptFor` takes it.
 *
 * `names` is the agent's `skills` field, in the order written, and the
 * record's keys are those names exactly as written — so the exact lookup on
 * the other side hits first, the heading the model sees is the one the agent
 * chose, and the order of the keys is the agent's order. Each name is
 * resolved the way `find` resolves it, so an id, a different case or a
 * differently spaced spelling all find the sheet. A name the file does not
 * have is left out; `missing` is the list of those, for a person.
 */
export function textFor(skills: readonly Skill[], names: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of names) {
    const name = raw.trim();
    const found = find(skills, name);
    // A sheet with nothing on it is not a sheet, however the list was built.
    if (!found || !found.body.trim()) continue;
    out[name] = found.body;
  }
  return out;
}

/**
 * The names an agent lists that the file does not have, in the agent's order.
 *
 * What the Routines panel shows beside an agent whose file has drifted — a
 * skill renamed, or one a teammate deleted — so the person finds out before
 * the run rather than by noticing the answer got worse. Resolved as `find`
 * resolves, so only a name that would actually be dropped by `textFor` is
 * reported. Blank names are nothing to report.
 */
export function missing(skills: readonly Skill[], names: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || out.includes(name) || find(skills, name)) continue;
    out.push(name);
  }
  return out;
}

/** What a project gets when it has never had one. */
export const STARTER = `# Skills

A skill is an instruction sheet an agent can carry: a way of working, written
once and attached by name. An agent lists the ones it carries in its entry in
\`.vylo/AGENTS.md\`, as \`- skills: Review, Release notes\`, and their text
follows its brief in what the model is told. The heading is the name and
everything under it is the sheet.

## Review

Read the whole change before forming a view of it. For each finding give the
file and line, say what goes wrong and when, and put the ones that lose data or
break a build above the ones that are a matter of taste. Say plainly if there
is nothing.

## Release notes

Write for somebody upgrading, not for whoever wrote the commit: what they will
notice, what they have to do, and what has gone. Group by what changed for
them, not by where it changed in the code. Leave out anything they cannot see.
`;
