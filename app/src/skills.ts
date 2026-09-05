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
 * ## And a title is a `#`, at that level and no other
 *
 * `entryLevel` used to look for a title at whatever the shallowest level
 * happened to be: one heading there, anything deeper below it, and the one
 * became the title. That reads `## Review` above `### Findings` as a titled
 * file with one skill called "Findings" — and the skill called "Review",
 * which is the whole file, stops existing. It is not a hypothetical: it is
 * what a one-skill file becomes the moment somebody types a section into the
 * sheet, which is the very thing the demotion below exists to make safe.
 *
 * Level and level alone cannot tell `# Title` above `## A` from `## A` above
 * `### Section` — they are the same shape — so the level is the rule: only a
 * lone `#` is a title. That is what the section above already promised, what
 * `titleOnly` already does, and what `add` already writes; `entryLevel` now
 * says it too, and the three agree. The cost is a file titled `## Skills`
 * with `### Review` under it, which is now one skill with a section rather
 * than a title with an entry. Nobody titles a file with two hashes, and the
 * alternative costs the far commoner file its only skill.
 *
 * Writing the missing `# Skills` line into the file instead — so a demoted
 * section can never be mistaken for an entry — was the other way out. It
 * fixes the same case and adds a line to somebody's file that they did not
 * write, in a module whose first promise is that editing one entry leaves
 * every other byte alone.
 *
 * ## A heading typed into a sheet is demoted, not written through
 *
 * `parse` reads a heading deeper than the entry level as part of the sheet —
 * a sheet with sections in it is still one sheet — and that held for text a
 * person hand-wrote in the file. It did not hold for text the panel wrote.
 * The Instructions box takes free-form prose, somebody types `# Findings` in
 * a sheet, and that section is written into the file as a heading at the
 * title's level. The damage is not to the one entry: `entryLevel` counts the
 * levels of the whole document, so a single `#` in a single body flips the
 * entry level for every skill in the file. The real entries stop being
 * entries, the title becomes a row a panel can rewrite and remove, `remove`
 * takes the title and everything under it to the next `#`, and the next `add`
 * writes at the wrong level.
 *
 * So the write side enforces what the read side promises. `render` knows the
 * level the entry is going in at — `add` computes it, `update` takes it from
 * the heading it is replacing — and shifts every heading in the body that
 * would sit at or above that level down to one below it, by one amount, so
 * the sheet's own nesting survives the move. `clean` cannot do this: it is
 * the level that decides what is too shallow, and `clean` is not told one.
 *
 * Refusing the heading was the other option and it is worse: a sheet with
 * sections in it is a good sheet, the box is a textarea for prose, and an
 * error that says "no Markdown headings" in a Markdown file is this module's
 * storage format leaking into somebody's writing.
 *
 * ## A `#` inside a fence is not a heading, on the way in or out
 *
 * A sheet says how to do something, so a sheet has commands in it, and a
 * shell block has comments in it:
 *
 *     ```sh
 *     # install first
 *     npm i
 *     ```
 *
 * To CommonMark, to GitHub and to whoever reads the file, that line is code.
 * Demoting it wrote `### install first` into somebody's shell script, and —
 * worse, because it is silent — the `#` set the shift for the whole sheet, so
 * the real section below it went down a level further than it had to. The
 * read side had the same hole from the start: a hand-written sheet with a
 * fenced `#` in it re-levelled the file exactly the way a typed one did.
 *
 * So `scan` reads the lines once, tracks fences the way CommonMark opens and
 * closes them — three or more backticks or tildes, up to three spaces in,
 * closed by the same character at least as long with nothing after it — and
 * everything else here asks it rather than the heading pattern. Fenced lines
 * are content: not headings to `entryLevel`, not entry boundaries to `endOf`,
 * not candidates for demotion, and not touched by the escape below. They are
 * written through byte for byte.
 *
 * A fence the sheet opens and never closes is the one case that reading it
 * properly makes worse: to CommonMark it swallows the rest of the document,
 * so every skill below would leave the panel. The write side answers that the
 * same way it answers the heading — the fence has to close somewhere, and the
 * end of the sheet is the only place that keeps the sheet one sheet — so
 * `render` closes it, with the rail the sheet opened. The person sees the
 * closing line next time they open the form, which is the truth about what
 * they wrote, and saving again changes nothing.
 *
 * ## Six hashes, and the escape that comes back off
 *
 * Six hashes is as deep as Markdown goes, so a heading the shift would push
 * past six has nowhere to be a section: it is escaped, `\# Findings`, which
 * is no longer structure to Markdown or to `HEADING` and still reads as the
 * line the person typed. Capping it at six instead would be worse than doing
 * nothing — at a level-six entry, six *is* the entry level, and the capped
 * heading becomes a sibling skill, which is the bug this whole section is
 * about.
 *
 * The escape used to be one-way. `parse` handed the backslash to the form as
 * if somebody had typed it, the model was given it too, and a sheet copied
 * into a shallower file — where there is room for the heading — carried it
 * for good. So `parse` takes it back off, and `demote` puts it on again: the
 * pair is symmetric, a sheet read and saved untouched is the same bytes, and
 * the same sheet pasted into a file with room becomes `### Findings` as any
 * other sheet's heading would. A `\#` a person wrote by hand at the head of a
 * line is read as the heading it escapes, because nothing distinguishes it
 * from this module's own, and the form showing what it means beats the form
 * showing a backslash nobody typed. Inside a fence it is left alone, where a
 * backslash is somebody's code.
 *
 * One sheet does not round-trip byte for byte, and cannot: a sheet whose
 * headings straddle the floor, where `# A` above `###### B` at a level-five
 * entry becomes `###### A` above an escaped `B`. Reading the escape off gives
 * `B` room the next time — the heading it was nested under has moved down —
 * so the second save writes `B` as a heading and every save after that writes
 * the same bytes. The nesting was already gone when the first save flattened
 * it, so nothing is lost that the file still had; it settles, once.
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

/**
 * A code fence, as CommonMark opens and closes one: three or more backticks
 * or tildes, up to three spaces in, and whatever follows on the line.
 */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*?)\r?$/;

/** The backslash `demote` puts in front of a heading it cannot make deeper. */
const ESCAPE = /^\\(?=#{1,6}\s)/;

/** What one pass over the lines finds. */
interface Read {
  /**
   * Per line, how this module reads it: the heading level, `0` for a line
   * that is prose, and `-1` for a line a fenced code block owns — the rails
   * included. A fenced `# comment` is code, so it is neither a heading nor
   * something to escape or demote; see the header.
   */
  at: number[];
  /** The rail of a fence still open at the end, or '' if none is. */
  open: string;
}

/**
 * Read every line once: what is a heading, what a fence has taken, and
 * whether a fence was left open.
 *
 * One pass because a fence is state — whether a line is a heading depends on
 * every line above it — and because `parse`, `endOf` and `demote` must all
 * read the same file the same way or the write side stops matching the read
 * side, which is the bug the header is about.
 */
function scan(lines: readonly string[]): Read {
  let open = '';
  const at = lines.map((line) => {
    const f = FENCE.exec(line);
    if (open) {
      // Only the same character, at least as many of it, and nothing but
      // space after it, closes a fence. Anything else is code.
      if (f && f[1][0] === open[0] && f[1].length >= open.length && !f[2].trim()) open = '';
      return -1;
    }
    // A backtick fence's info string cannot itself hold a backtick.
    if (f && !(f[1][0] === '`' && f[2].includes('`'))) { open = f[1]; return -1; }
    return HEADING.exec(line)?.[1].length ?? 0;
  });
  return { at, open };
}

/** The level of every heading in the file, in order. */
function levels(text: string): number[] {
  return scan(text.split('\n')).at.filter((n) => n > 0);
}

/**
 * Which heading level names a skill.
 *
 * The same rule as `prompts.ts` and `agents.ts`, for the same file shapes: a
 * person writes `# Skills` at the top and `## Each one` below, and the
 * sentence under the title is not a skill; somebody else writes the whole
 * file with `#`, and every one of those is.
 *
 *   > The shallowest heading level is the entry level, unless it is level one,
 *   > exactly one heading is at it, and deeper headings exist — then that one
 *   > is the document's title and the next level down holds the entries.
 *
 * The "level one" is the part `titleOnly` and `add` always had and this did
 * not, and without it `## Review` above a `### Findings` the sheet's own
 * author typed is a titled file whose only skill is "Findings" — see the
 * header. A lone shallowest heading below level one is a skill with sections
 * under it, which is the commoner file by far.
 */
export function entryLevel(text: string): number {
  const all = levels(text);
  if (!all.length) return 1;
  const top = Math.min(...all);
  const atTop = all.filter((l) => l === top).length;
  const deeper = all.filter((l) => l > top);
  if (top === 1 && atTop === 1 && deeper.length) return Math.min(...deeper);
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
  const { at } = scan(lines);
  const level = entryLevel(text);
  const out: Skill[] = [];
  let name = '';
  let head = -1;
  let body: string[] = [];

  const flush = () => {
    if (head < 0) return;
    const raw = body.join('\n').trim();
    if (name && raw) out.push({ id: '', name, body: raw, line: head });
    body = [];
  };

  lines.forEach((line, i) => {
    // A heading shallower than the entry level is the document's title, and
    // ends whatever entry was open. A deeper one is part of the body — a
    // sheet with sections in it is still one sheet.
    if (at[i] > 0 && at[i] <= level) {
      flush();
      if (at[i] === level) { name = (HEADING.exec(line)?.[2] ?? '').trim(); head = i; }
      else { name = ''; head = -1; }
      return;
    }
    // The form is filled from this, so it gets the line as the person typed
    // it: without the carriage return the file carries, and without the
    // escape `demote` puts on a heading it could not make any deeper. A line
    // a fence owns keeps its backslash, where it is somebody's code.
    if (head >= 0) {
      const l = line.replace(/\r$/, '');
      body.push(at[i] === 0 ? l.replace(ESCAPE, '') : l);
    }
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

/**
 * A sheet's own headings, moved to sit under an entry heading at `level`.
 *
 * Anything at or above `level` would end the entry as `parse` and `endOf`
 * read the file — see the header: one `#` typed into the Instructions box
 * re-levels the whole document. The whole sheet shifts by one amount, taken
 * from its shallowest heading, so `# A` above `## B` stays `A` above `B`
 * rather than both flattening onto the same level. A sheet whose headings are
 * already deeper than the entry is left byte for byte alone, which is what
 * makes this idempotent: the body `parse` reads back and hands to the form is
 * written again unchanged. A heading shifted past six has no deeper level to
 * take, so its hashes are escaped — no longer a heading to Markdown or to
 * `HEADING`, still the line the person typed, and taken off again by `parse`.
 *
 * A line a fence owns is code and is written through: it is not a heading, it
 * does not set the shift, and it is not escaped. `scan` says which.
 */
function demote(body: string, level: number): string {
  const lines = body.split('\n');
  const { at } = scan(lines);
  const found = at.filter((n) => n > 0);
  const top = found.length ? Math.min(...found) : 0;
  if (!top || top > level) return body;
  const shift = level + 1 - top;
  return lines.map((l, i) => {
    if (at[i] <= 0) return l;
    const want = at[i] + shift;
    return want <= 6 ? l.replace(/^#+/, '#'.repeat(want)) : `\\${l}`;
  }).join('\n');
}

/**
 * A sheet that opens a fence and never closes it, closed at its own end.
 *
 * An open fence runs to the end of the document in CommonMark, so one sheet's
 * stray ``` takes every skill below it out of the file as `parse` reads it.
 * The fence has to close somewhere and the end of the sheet is the only place
 * that keeps the sheet one sheet — see the header. The rail it opened with is
 * the rail it closes with, so a ~~~ block and a longer run of backticks both
 * close as themselves. A balanced sheet comes back untouched, so saving a
 * sheet this has already closed writes the same bytes.
 */
function closeFence(body: string): string {
  const { open } = scan(body.split('\n'));
  return open ? `${body}\n${open}` : body;
}

/**
 * The lines of one entry: the heading, a blank line, the sheet.
 *
 * `hashes` is the entry's level and the sheet's ceiling both, so the sheet is
 * demoted under it on the way out — a heading a person typed into the box is
 * a section of their sheet and never a heading of this file. The fence is
 * closed first, so that what `demote` reads as code is what the file will.
 */
function render(s: Draft, hashes: string): string[] {
  return [`${hashes} ${s.name}`, '', ...demote(closeFence(s.body), hashes.length).split('\n')];
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

/**
 * Where the entry whose heading is at `line` ends: the next heading at or
 * above its level, as `scan` read the file.
 *
 * Stops at the next entry or at anything shallower, never at a heading
 * *inside* the sheet — a sheet with sections in it goes whole — and never at
 * one inside a fenced block, which is not a heading at all.
 */
function endOf(at: readonly number[], line: number, level: number): number {
  for (let i = line + 1; i < at.length; i++) if (at[i] > 0 && at[i] <= level) return i;
  return at.length;
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
  const { at } = scan(lines);
  const level = entryLevel(text);
  // Not an entry heading: the title, a heading inside a sheet, a line inside
  // a fence, or no heading at all. None of those is a skill to remove.
  if (at[line] !== level) return text;
  const end = endOf(at, line, level);
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
  const { at } = scan(lines);
  const level = entryLevel(text);
  if (at[line] !== level) return text;
  const s = clean(draft);
  if (!s) return text;

  const end = endOf(at, line, level);
  // The blank run before the next heading is the gap, not the entry. Keeping
  // it is what stops an edit from also closing up the file around it.
  let keep = end;
  while (keep > line + 1 && !lines[keep - 1].trim()) keep--;

  // The carriage return is part of the line as far as `split` is concerned,
  // and dropping it would convert one entry of a CRLF file to LF and leave the
  // rest — a diff on every line of an entry nobody meant to reformat.
  const cr = lines[line].endsWith('\r') ? '\r' : '';
  lines.splice(line, keep - line, ...render(s, '#'.repeat(level)).map((l) => l + cr));
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
