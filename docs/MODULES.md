# Modules

A module is a section of the app: an icon in the activity rail, a panel in the
sidebar, and a line in Settings → Modules where it can be turned off and dragged
into another position.

Six ship with the app — Explorer, Search, Changes, Chats, To do, Memory. They
are values in one file, `app/src/modules.ts`, and anything that needs to know
what a section is reads it from there.

## Why the registry exists

The rail used to be an array literal written inline in `App.tsx`, and the
sidebar heading that named the open section was a separate chain of ternaries.
The two were copies of one list, and copies drift: `todo` was added to the first
and never to the second, so the To do panel sat under a heading that said
**Memory** for eleven releases. Nobody noticed, because nothing could — there
was no single place that knew what a section was.

There is now, and `app/test/modules.test.mjs` fails if the registry and the app
disagree in either direction: a module with no panel, or a panel that is not a
module.

## Adding one

Four steps, and the tests enforce three of them.

1. **Declare it** in `MODULES` in `app/src/modules.ts`:

   ```ts
   { id: 'tasks', label: 'Tasks', icon: 'check',
     about: 'What the build is doing right now.' },
   ```

   `id` joins the `ModuleId` union. `label` and `about` are English sentences
   that are also the `i18n.ts` keys, so both need an entry in all four
   languages — `modules.test.mjs` checks this.

2. **Give it a panel** in `App.tsx`, guarded by `shown === 'tasks'`. Without
   one, `modules.test.mjs` fails with the id it could not find.

3. **Give it a badge**, if a number should sit on the icon. `badge` is a closed
   union of counter names, so a new one means widening `Module['badge']` and
   adding a branch to the `items={…}` mapping where the rail is rendered — two
   edits the compiler will ask for rather than two you have to remember.

4. **Add its icon** to `app/src/Icon.tsx` if it is not one of the existing
   names. `IconName` is a union, so an unknown name is a type error.

Nothing else has to change. The rail, the heading, the ordering, the on/off
switch, the persistence and the Settings row all come from the entry.

## What a module is not

It is not a plugin, and this app will not load one at runtime.

The obvious next step from "modules you can add" is a folder of JavaScript that
gets `import()`ed on start-up. It is not built, and it will not be, because it
would give away everything the rest of the design pays for. `apply_write` and
`run_command` are absent from the model's tool schema so that no model output
reaches disk or a shell without a human reading the exact content first. A
`.vylo/modules/*.js` that this app executes would hand that back to anything
able to write a file in a checkout — the agent, a dependency, a colleague's
push, a clone of a repository somebody found.

The safe version of the same idea already exists and predates this file:

## MCP servers

An **MCP server** is a separate process, declared by the project in
`.vylo/mcp.json`, that offers the agent extra tools — a database, a browser, an
issue tracker. It is listed in the same Settings tab as the sections above,
because it is the honest answer to "can I add my own".

What makes it safe is what makes it different from a plugin: it runs as its own
process rather than inside this app, the command that starts it is shown in full
before the button that runs it, and every tool call it offers goes through the
same approval dialog as a command the model proposes. Third-party code with
unknown side effects does not get to run unattended, and it never runs *as* this
application.

See `SAFETY.md` for the rule this follows from.
