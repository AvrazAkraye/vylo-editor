/**
 * Named agents, at `.vylo/AGENTS.md`.
 *
 * A prompt is something you send. An agent is somebody you send it to: a name,
 * a standing brief, and a decision about what it is allowed to do. The same
 * reviewer you asked for last week, with the same instructions, without
 * retyping them — and without discovering halfway through that this time it
 * was allowed to edit. BridgeMind calls them teammates; the word matters less
 * than the file.
 *
 * ## Markdown, in the project, for the same reasons as `PROMPTS.md`
 *
 * The file travels with the repository, is readable on GitHub, and diffs in a
 * review. For a file of briefs that will be handed to a model — some of them
 * with permission to change things — that is not a nicety: an agent a teammate
 * added is an agent you can read before you use it, and the line that gave it
 * write access is a line a review can see. So it is the same shape as
 * `.vylo/PROMPTS.md`, and read the same way: a heading is the name, what
 * follows is the brief.
 *
 *     ## Reviewer
 *     - mode: ask
 *     - skills: review, security
 *
 *     Read the staged diff and list anything that could go wrong, with the
 *     file and line. Say plainly if there is nothing.
 *
 * ## The metadata is a list at the top of the body
 *
 * An agent has three things a prompt does not: what it may do, which model to
 * use, and which skills to carry. They go at the top of the body as list items,
 * `- key: value`, one per line, and the brief is everything after them.
 *
 * | key      | means                          | values                       |
 * |----------|--------------------------------|------------------------------|
 * | `mode`   | what it may do                 | `ask` (default), `agent`     |
 * | `model`  | which model, if not the default| any id                       |
 * | `skills` | skills attached to it          | names, comma-separated       |
 *
 * Every one is optional, and a heading with only prose under it is an agent
 * with the defaults. Only those three keys are read, and the run of metadata
 * stops at the first line that is not one of them — so a brief that begins
 * with a bullet list is a brief that begins with a bullet list, and a
 * `- mode: agent` written *after* the prose is prose. Nothing is swallowed on
 * the guess that it was meant as a field. On GitHub the list renders as a
 * short list under the heading, which is what it is.
 *
 * YAML front matter was considered and is the wrong tool: front matter
 * describes a *file*, and there are several agents in one file. The block
 * that describes each one has to sit with it, and a list under a heading is
 * what markdown already has for that.
 *
 * ## `ask` and `agent`
 *
 * `ask` reads only. `agent` may stage edits and ask to run commands, and every
 * one of those still goes through the approval gate — the mode decides which
 * tools the model is *given*, not whether a person is asked. `ask` is the
 * default and is what an unknown value reads as, because the wrong way to fail
 * is with the write tools. Unattended routines run as `ask` whatever the file
 * says: an approval gate with nobody at it is either closed or missing, and
 * closed is the one this app chooses. `modeFor` is that rule in code.
 *
 * The mode is enforced by the tool array (`agent.ts` keeps `READ_TOOLS` and
 * `WRITE_TOOLS` apart for exactly this) and not by a sentence in the system
 * prompt, which is why `systemPromptFor` says nothing about it: a prompt that
 * says "you may not edit" is a claim, and the absent tool is the fact.
 *
 * ## The id is a slug, and it is unique in the file
 *
 * A routine or a setting has to point at an agent by something steadier than a
 * position in a list, and friendlier than a hash: `reviewer`, from "Reviewer".
 * Two agents with the same name are two agents — the file is a person's and
 * nothing here refuses to read it — so the second becomes `reviewer-2`, in
 * file order, and stays that until somebody renames one.
 *
 * ## Editing is entry-level, as `PROMPTS.md` is
 *
 * Changing an agent rewrites that one entry and leaves every other byte where
 * it was, including the blank lines around it and the carriage returns of a
 * CRLF file. The file will have a title, a paragraph explaining it, and
 * spacing nobody here chose, and none of that is this module's to reformat.
 */

/** What an agent may do. `ask` reads; `agent` may stage edits and propose commands. */
export type Mode = 'ask' | 'agent';

export const MODES: Mode[] = ['ask', 'agent'];

export interface Agent {
  /** Slug of the name, unique within the file. How a setting points at it. */
  id: string;
  /** The heading. What the row says. */
  name: string;
  mode: Mode;
  /** Absent means the app's default model. */
  model?: string;
  /** Names of skills attached to it, in the order written. */
  skills: string[];
  /** Everything under the heading after the metadata. What the model is told. */
  brief: string;
  /** Index of the heading line, so one entry can be rewritten in place. */
  line: number;
}

/**
 * What `add` and `update` take: an agent without the two fields the file
 * decides. `id` comes from the name and `line` from where it lands.
 */
/**
 * What a form fills in. The mode is required on purpose: `update` replaces
 * the whole entry, so a draft that could leave the mode out would be one that
 * silently resets an agent to Ask on a rename. Model and skills are optional
 * and absent means none — a draft says everything the entry will say.
 */
export type Draft = Pick<Agent, 'name' | 'brief' | 'mode'> & Partial<Pick<Agent, 'model' | 'skills'>>;

/** `## Anything`, at any level. `\r?$` because the file lives in a repository. */
const HEADING = /^(#{1,6})\s+(.*?)\r?$/;

/**
 * `- mode: ask`, `* Model: x`, `+ skills: a, b`. Only the three known keys —
 * anything else at the top of a body is the body.
 */
const META = /^\s*[-*+]\s+(mode|model|skills)\s*:\s*(.*?)\s*$/i;

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
 * Which heading level names an agent.
 *
 * The same rule as `prompts.ts`, for the same file shapes: a person writes
 * `# Agents` at the top and `## Each one` below, and the sentence under the
 * title is not an agent; somebody else writes the whole file with `#`, and
 * every one of those is.
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
 * Letters and digits in any script are kept, so an agent named in Arabic has
 * an id in Arabic rather than an empty one — this app is localised, and a slug
 * that only survives ASCII would hand every non-English name the same id. A
 * name with no letters or digits at all gets `agent`, which `parse` then makes
 * unique in the usual way.
 */
export function slug(name: string): string {
  const s = name.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\p{M}]+/gu, '-').replace(/^-+|-+$/g, '');
  return s || 'agent';
}

/** The fields at the top of a body, and the brief that is left. */
function readBody(raw: string): Pick<Agent, 'mode' | 'model' | 'skills' | 'brief'> {
  const lines = raw.split('\n');
  let mode: Mode | null = null;
  let model: string | undefined;
  let skills: string[] | null = null;
  let i = 0;
  for (; i < lines.length; i++) {
    // A loose list — blank lines between items — is still a list.
    if (!lines[i].trim()) continue;
    const m = META.exec(lines[i]);
    if (!m) break;
    const value = m[2];
    switch (m[1].toLowerCase()) {
      // First wins, as `todo.ts` reads tokens: a body with two modes on it is
      // one somebody hand-edited, and reading the first keeps it stable while
      // they fix it. An unknown mode is `ask`, because the wrong way to fail is
      // with the write tools.
      case 'mode': mode ??= value.toLowerCase() === 'agent' ? 'agent' : 'ask'; break;
      case 'model': model ??= value || undefined; break;
      case 'skills': skills ??= readSkills(value); break;
    }
  }
  const brief = lines.slice(i).join('\n').trim();
  return { mode: mode ?? 'ask', ...(model ? { model } : {}), skills: skills ?? [], brief };
}

/** `a, b, \`c\`` → `['a', 'b', 'c']`. Commas only: a skill's name may have a space in it. */
function readSkills(value: string): string[] {
  const out: string[] = [];
  for (const part of value.split(',')) {
    const s = part.trim().replace(/^`+|`+$/g, '').trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Every agent in the file, in order, with ids made unique.
 *
 * A heading with nothing under it — no metadata, no brief — is not an agent:
 * it is a name somebody has not finished writing. One with only metadata is,
 * with an empty brief, because a person who wrote `- skills: review` and
 * nothing else has said what they meant. Prose before the first heading
 * belongs to nobody, which is where the sentence explaining the file goes.
 */
export function parse(text: string): Agent[] {
  // A title and a paragraph is a file with no agents in it, not one agent
  // named after the title — which is what the file looks like once the last
  // agent is removed.
  if (titleOnly(text)) return [];
  const lines = text.split('\n');
  const level = entryLevel(text);
  const out: Agent[] = [];
  let name = '';
  let at = -1;
  let body: string[] = [];

  const flush = () => {
    if (at < 0) return;
    const raw = body.join('\n').trim();
    if (name && raw) out.push({ id: '', name, ...readBody(raw), line: at });
    body = [];
  };

  lines.forEach((line, i) => {
    const h = HEADING.exec(line);
    if (h) {
      // A heading shallower than the entry level is the document's title, and
      // ends whatever entry was open. A deeper one is part of the body — a
      // brief with sections in it is still one brief.
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

  // Second and later take a suffix, in file order, so the first "Reviewer"
  // keeps `reviewer` however many are added below it.
  const taken = new Set<string>();
  for (const a of out) {
    const base = slug(a.name);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    a.id = id;
  }
  return out;
}

/**
 * One agent, by id or by name.
 *
 * The id first, exactly — that is what a stored reference is. Then the name,
 * case-insensitively, and then whatever the query slugs to, so "Release Notes"
 * typed into a box finds `release-notes` without anybody knowing the rule.
 */
export function find(list: readonly Agent[], idOrName: string): Agent | undefined {
  const q = idOrName.trim();
  if (!q) return undefined;
  const lower = q.toLowerCase();
  return list.find((a) => a.id === q)
    ?? list.find((a) => a.name.toLowerCase() === lower)
    ?? list.find((a) => a.id === slug(q));
}

// ── Writing ────────────────────────────────────────────────────────────────

/** A draft with its strings cleaned, or nothing if there is not an agent in it. */
function clean(draft: Draft): Required<Omit<Draft, 'model'>> & { model?: string } | null {
  const name = draft.name.replace(/[\r\n]+/g, ' ').trim();
  const brief = draft.brief.replace(/\r/g, '').trim();
  // A skill is one line of a comma list: newlines would end the metadata
  // early on the way back in, and a comma would read as two skills.
  const skills = readSkills((draft.skills ?? []).map((x) => x.replace(/[\r\n,]+/g, ' ')).join(','));
  const model = draft.model?.replace(/[\r\n]+/g, ' ').trim() || undefined;
  // A name with nothing to say and nothing attached is a name, and a name
  // alone is a placeholder — the same rule `parse` reads by.
  if (!name || (!brief && !skills.length)) return null;
  return { name, brief, skills, mode: draft.mode === 'agent' ? 'agent' : 'ask', ...(model ? { model } : {}) };
}

/**
 * The lines of one entry.
 *
 * The mode is always written, even when it is the default: the mode is the
 * line a reviewer needs, and "absent means ask" is a fact about this parser
 * rather than about the file. A file that says what it means beats one that
 * relies on a reader knowing the default. Model and skills are written only
 * when there is something to say.
 */
function render(a: NonNullable<ReturnType<typeof clean>>, hashes: string): string[] {
  const out = [`${hashes} ${a.name}`, `- mode: ${a.mode}`];
  if (a.model) out.push(`- model: ${a.model}`);
  if (a.skills.length) out.push(`- skills: ${a.skills.join(', ')}`);
  if (a.brief) out.push('', ...a.brief.split('\n'));
  return out;
}

/**
 * The heading level a new entry should use.
 *
 * The level the existing agents are at. `prompts.ts` always writes `##`, which
 * is right for a file with a title and wrong for a file written entirely with
 * `#`: there, a `##` at the end is read as part of the last entry's body, and
 * the new one vanishes into it.
 *
 * A file with exactly one heading is the case the rule cannot settle on its
 * own. `# Agents` above a paragraph is a title with the file's explanation
 * under it, and the first agent goes one level down — even though, read
 * strictly, that paragraph is an agent called "Agents". A lone `## Reviewer`
 * is an agent, and the next goes beside it. What separates the two is the
 * level and the metadata: nobody writes `- mode:` under a title, and `add`
 * always writes it, so a lone `#` with metadata under it is an agent written
 * with `#` and the next one is too.
 */
/**
 * A file whose only heading is a level-one title with no metadata under it.
 * `entryLevel` would call that heading the entry; `add` already refuses to,
 * and `parse`, `update` and `remove` follow the same reading.
 */
function titleOnly(text: string): boolean {
  const all = levels(text);
  if (all.length !== 1 || all[0] !== 1) return false;
  return !text.split('\n').some((l) => META.test(l.replace(/\r$/, '')));
}

function levelForAdd(text: string): number {
  const all = levels(text);
  if (!all.length) return 2;
  if (all.length === 1) {
    const meta = text.split('\n').some((l) => META.test(l.replace(/\r$/, '')));
    return all[0] === 1 && !meta ? 2 : all[0];
  }
  return entryLevel(text);
}

/**
 * Add an agent at the end.
 *
 * A blank line before the heading whatever the file ended with, because two
 * headings with no gap render as one paragraph in some viewers and read as a
 * mistake in all of them. A CRLF file gets CRLF lines, so the addition does
 * not show up as a file that is now half one thing and half the other.
 */
export function add(text: string, draft: Draft): string {
  const a = clean(draft);
  if (!a) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const head = text.replace(/\s+$/, '');
  const entry = render(a, '#'.repeat(levelForAdd(text))).join(eol) + eol;
  return head ? `${head}${eol}${eol}${entry}` : entry;
}

/** Where the entry whose heading is at `line` ends: the next heading at or above its level. */
function endOf(lines: string[], line: number, level: number): number {
  for (let i = line + 1; i < lines.length; i++) {
    const h = HEADING.exec(lines[i]);
    // Stops at the next entry or at anything shallower, never at a heading
    // *inside* the brief — a brief with sections in it goes whole.
    if (h && h[1].length <= level) return i;
  }
  return lines.length;
}

/**
 * Remove one agent, heading and body.
 *
 * Only an entry: the title is not an agent and cannot be removed by a panel
 * that lists agents. The blank lines that separated it go with it; the ones
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
  // another agent's brief, are that agent's bytes and stay.
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
 * Rewrite one agent in place.
 *
 * The whole entry is replaced — heading, metadata, brief — because a rename or
 * a change of mode is a different entry, and the old bytes mean nothing in it.
 * Everything else is left where it was: the lines above, the blank lines that
 * separate it from the next heading, the next heading and everything after,
 * and the carriage return on every line of a CRLF file. The heading keeps the
 * level it had, which is the file's entry level by definition.
 */
export function update(text: string, line: number, draft: Draft): string {
  const lines = text.split('\n');
  if (line < 0 || line >= lines.length || titleOnly(text)) return text;
  const level = entryLevel(text);
  const h = HEADING.exec(lines[line]);
  if (!h || h[1].length !== level) return text;
  const a = clean(draft);
  if (!a) return text;

  const end = endOf(lines, line, level);
  // The blank run before the next heading is the gap, not the entry. Keeping
  // it is what stops an edit from also closing up the file around it.
  let keep = end;
  while (keep > line + 1 && !lines[keep - 1].trim()) keep--;

  // The carriage return is part of the line as far as `split` is concerned,
  // and dropping it would convert one entry of a CRLF file to LF and leave the
  // rest — a diff on every line of an entry nobody meant to reformat.
  const cr = lines[line].endsWith('\r') ? '\r' : '';
  lines.splice(line, keep - line, ...render(a, h[1]).map((l) => l + cr));
  return lines.join('\n');
}

// ── Running one ────────────────────────────────────────────────────────────

/**
 * The mode an agent actually runs in.
 *
 * Its own when a person is there to answer the approval dialog; `ask` when
 * nobody is. An unattended routine that could stage edits is a routine whose
 * edits wait in a dialog nobody sees, or worse, one somebody auto-approves to
 * make the dialog go away. Reading only is the mode that needs no one.
 */
export function modeFor(agent: Pick<Agent, 'mode'>, attended: boolean): Mode {
  return attended ? agent.mode : 'ask';
}

/**
 * The system prompt for an agent: its brief, then the bodies of its skills.
 *
 * `skillsText` maps a skill's name to its text, however the caller loaded it.
 * A skill that is named but has no text is left out rather than mentioned —
 * a heading with nothing under it tells the model nothing except that the
 * person who wrote the file made a mistake, and that is not the model's
 * business. When no skill has text the "Skills" heading is left out too.
 *
 * Nothing here says what the agent may do. The tools it is given say that,
 * and a sentence that disagreed with them would be the one that was wrong.
 */
export function systemPromptFor(agent: Pick<Agent, 'brief' | 'skills'>, skillsText: Record<string, string>): string {
  const parts: string[] = [];
  const brief = agent.brief.trim();
  if (brief) parts.push(brief);

  const found: string[] = [];
  for (const name of agent.skills) {
    const body = skillText(skillsText, name);
    if (body) found.push(`### ${name}\n\n${body}`);
  }
  if (found.length) parts.push(`## Skills\n\n${found.join('\n\n')}`);
  return parts.join('\n\n');
}

/**
 * The text for a skill, by its name.
 *
 * Exactly first, then without regard to case — `- skills: Review` and a file
 * called `review.md` are the same skill to the person who typed it.
 */
function skillText(skillsText: Record<string, string>, name: string): string {
  const exact = skillsText[name];
  if (typeof exact === 'string' && exact.trim()) return exact.trim();
  const lower = name.toLowerCase();
  for (const key of Object.keys(skillsText)) {
    if (key.toLowerCase() === lower && skillsText[key].trim()) return skillsText[key].trim();
  }
  return '';
}

/** What a project gets when it has never had one. */
export const STARTER = `# Agents

An agent is a name, a brief, and a decision about what it may do. The list at
the top of an entry is that decision: \`mode: ask\` may only read, \`mode: agent\`
may stage edits and ask to run commands, each of which still waits for your
approval. \`model\` picks one; \`skills\` attaches skills by name. Everything
after those lines is the brief.

## Reviewer
- mode: ask

Read the staged diff and list anything that could go wrong: a case not handled,
a value not checked, a message that will confuse somebody. Give the file and
line for each. Say plainly if there is nothing.

## Release notes
- mode: ask

Read what has been merged since the last tag and draft release notes for it:
what somebody upgrading will notice, in their words rather than the commit's.
Leave out anything they cannot see.
`;
