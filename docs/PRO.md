# The Pro pass

Started 2026-10-03, on branch `pro` (worktree `vylo-editor-pro`), from `motion` (0.132.0 plus the
unreleased logo-shadow fix). The owner's brief, in their words: *"keep working on all important
features that you see important, and the idea is to keep the app simple for the user with more
features."* The research that feeds it is `docs/pro/RESEARCH.md` (what is worth taking from
HyperFrames, an Apache-2.0 HTML-to-video framework, and what is not).

**Nothing in this pass is released or pushed.** It is built, tested and committed on `pro`. A release
is a separate decision the owner makes.

> **Status (2026-10-03): built, reviewed, fixed and green.** The ten packages, four wiring packages, five reviews and
> four fixes are merged. `docs/pro/SUMMARY.md` is the handoff: the gates, what a person gets, the decisions that are
> the owner's, the known limits, and how to merge into the main tree.

## The one idea

*Simple on top, deep underneath.* Motion should look the same to a person who only wants a title on
a video as it does today, and still have what a professional expects: sound, scenes and transitions,
a brand, a quality check, more and better templates, sharing sizes. Every feature below is judged by
what it adds to the **first screen** (as little as possible) and by what it lets a person do that
they could not (as much as possible).

## The simplicity contract

A work package is not done until it keeps every one of these. The reviewers check them.

1. **No new studio, no new top-level navigation, no new window.** Everything lives inside Motion.
2. **The shortest path does not get longer.** Home, pick a template, change the words, Export:
   no new step, no new decision on the way. A new capability is either automatic or off until asked for.
3. **One new always-visible control per feature, at most, and it is one line.** (The check chip, the
   Sound row, the Brand button, the "+ Scene" affordance.) Anything more is behind a disclosure.
4. **Auto first.** Sound is Off until chosen, then Auto (effects match the animation, music matches
   a mood, loudness is set for you). The check never blocks; it says "tips", not "errors", and fixes
   with one click. Export offers destinations ("Story", "Post", "Web loop"), not codec settings.
5. **Words work as well as buttons.** Everything a person can do by hand, they can ask the chat for.
   (Wave 2 gives the chat the new operations.)
6. **Four languages, both directions, from the first commit.** Every string goes through `t()` with
   `ar`, `ckb` and `kmr` entries; layout uses `pin`/`start`/`end` and logical CSS properties; nothing
   is physical-left/right. Keyboard and screen-reader paths exist for every control.
7. **Local and quiet.** No network request of its own, no telemetry, no new dependency (the zero-library
   promise in `docs/MOTION.md` stands), no code written by a model. SAFETY.md's claims are unchanged.
8. **Fast.** Preview stays smooth for a typical graphic (the check runs debounced and under 25 ms for
   30 layers; nothing in `paint` allocates per frame without need). Export is not slower without sound.

## What the pass adds, and where a person meets it

| Capability | What a person sees | Default |
|---|---|---|
| **Quality check** | A small chip by the stage: "Looks good" or "3 tips". Click for the list; each tip has a Fix button, there is Fix all | on, silent when clean |
| **Sound** | One row: Off, Effects, Music, Both; with Music, mood chips and a level | Off |
| **Scenes and transitions** | The timeline shows a thin strip of scenes; between two sits a small transition chip. A graphic with one scene looks as it does today, with a quiet "+ Scene" | one scene |
| **Brand kit** | A "Brand" button on Home and in Design: name, handle, logo, colours, font. New graphics start in it; "Apply brand" re-skins an existing one | none set |
| **Gallery** | Search box and group chips on Home; templates describe when to use them | all |
| **New templates** | Lower-third styles, notification and chat cards, device frames, hand-drawn callouts, film finish, bar-chart race, timeline, compare, price card | in the gallery |
| **Export** | "Where is it going?" cards: Story or Reel, Post, YouTube, Web loop (GIF), Picture. "More options" holds size, quality, fps, transparency | MP4, best fit |
| **AI direction** | Better graphics from the same sentence (motion rules the model is given) | invisible |

## Architecture: what Phase 0 already wired

The shared files are thin and pre-wired, so ten people can work without editing the same line.

- `motionids.ts`: two id lists (`PRO_A_IDS`, `PRO_B_IDS`) the template packages fill. `RECIPE_IDS` is the
  original eighteen plus those. `motionrecipe.ts` builds `META` from `CORE_META` plus
  `motionrecipes-pro-a-meta.ts` / `-b-meta.ts` (data only, so nothing imports back); `motiontemplates.ts`
  spreads `PRO_A_RECIPES` / `PRO_B_RECIPES` into `RECIPES`. `RecipeMeta` gained optional `tags`,
  `useWhen`, `avoidWhen`, `pairsWith`.
- `Motion.sound?` (`motionsound.ts`) and `Motion.scenes?` (`motionscene.ts`): optional document fields,
  read by `readSound` / `readScenes` from `readMotion`, absent meaning silence and one scene.
  `paint()` hands a document with scenes to `paintScenes`; one without them paints exactly as before.
  `motionsound.ts` and `motionscene.ts` must not import `motionread.ts` or `motiondraw.ts` at run time
  (they are imported by them): use `import type`, small readers of their own, and a drawing function
  passed in.
- `loudness.ts` has a working placeholder (RMS-based) with the final names; `motionsound.ts` exports
  `SoundBed` and `renderSoundBed`; `motioncheck.ts` exports `Finding` and `checkMotion`. Packages that
  depend on another's output code against these.
- `package.json`: every module below is already an esbuild entry, and `test/pro-*.test.mjs` (one per
  package) is already in the chain before `orphans.test`. You normally do not edit `package.json`.
  If you add a module the plan did not declare, add its entry yourself and say so in your manifest.

## The ten work packages

Each has a brief in `docs/pro/briefs/NN-name.md`, a branch `pro-NN-name`, and its own worktree
`../vylo-editor-pro-NN-name`. **Exclusive** files are yours alone; "regions" are named functions or
list lines in a shared file that you alone edit.

| # | Package | Exclusive files | Depends on (contract only) |
|---|---|---|---|
| 01 | **Check**: quality rules, auto-fix, the chip | `motioncheck.ts`, `MotionChecks.tsx`, `test/pro-check.test.mjs` | none |
| 02 | **Audio library**: loudness (BS.1770), effects, automation, ducking | `audiocore.ts`, `audiofx.ts`, `audioauto.ts`, `audioduck.ts`, `loudness.ts`, `test/pro-audio.test.mjs` | none |
| 03 | **MP4 with sound**: AAC track, edit list, colour tags, faster export | `motionmp4.ts`, `motionencode.ts`, `motionexportops.ts`, `motionaudioenc.ts`, `test/pro-mux-audio.test.mjs`, the three existing mp4/encode/export tests | `SoundBed` |
| 04 | **Sound design**: effects that match the animation, music bed, preview | `motionsound.ts`, `motionsfx.ts`, `motionsoundplay.ts`, `MotionSoundPanel.tsx`, `test/pro-sound.test.mjs` | `loudness.ts`, `videosynth.ts` (read only) |
| 05 | **Scenes and transitions** | `motionscene.ts`, `motiontransition.ts`, `MotionScenes.tsx`, `test/pro-scenes.test.mjs`; regions: `paint()` hook in `motiondraw.ts`, `LayerBase.scene` and `LIMITS` in `motiontypes.ts` | none |
| 06 | **Gallery and brand kit** | `motionbrand.ts`, `motionsearch.ts`, `MotionBrandKit.tsx`, `MotionHome.tsx`, `motionrecipe.ts`, `motiontemplates.ts`, `motionstore.ts`, `test/pro-gallery.test.mjs` | none |
| 07 | **Templates A**: lower thirds, notifications, chat, device, callout | `motionrecipes-pro-a.ts`, `motionrecipes-pro-a-meta.ts`, `PRO_A_IDS`, `test/pro-templates-a.test.mjs` | none |
| 08 | **Templates B and visuals**: film finish, race chart, timeline, compare, price | `motionrecipes-pro-b.ts`, `-b-meta.ts`, `PRO_B_IDS`, `motionbackdrop.ts`, `motioncharts.ts`; regions: `BACKDROPS` / `CHARTS` lines, `test/pro-templates-b.test.mjs` | none |
| 09 | **Export and sharing**: destinations, GIF | `motiongif.ts`, `motiongifops.ts`, `motionshare.ts`, `MotionExport.tsx`, `test/pro-export.test.mjs` | none |
| 10 | **AI direction**: motion rules for the model, a fix-with-AI prompt | `motiondirection.ts`, `motionai.ts`, `test/pro-direction.test.mjs` | `Finding` |

New component names avoid the case-insensitive collision with a module of the same lowercase name
(`MotionBrand.tsx` would collide with `motionbrand.ts`, hence `MotionBrandKit.tsx`).

## Rules for every package

- **Stay in your lane.** Edit only the files and regions above. Need a change elsewhere? Write it in
  `docs/pro/requests/NN.md` and carry on; the integrator does it. Never `git add -A`; add your paths.
- **Do not touch** `/Volumes/ExtremeSSD/apps/vylo-editor` (the main tree has another session's
  unfinished Video work), any other worktree, `/opt/vylo-claude`, or the network. No `npm install`,
  no new dependency, no model-written code, no `ctx.filter`, no `<audio>`, no `.dir =` outside `rtl.ts`.
- **Video is off limits** in this pass (`Video*.tsx`, `video*.ts`): the other session has uncommitted
  changes in them. Read-only use of `videosynth.ts` is fine.
- **Match the house style**: long explanatory comments that say *why*; pure functions; no `any`; units in
  u; the closed vocabulary; everything read through a reader that clamps. Look at a neighbouring file first.
- **i18n**: every visible word through `t('English sentence')`; add `ar`, `ckb`, `kmr` entries at the end
  of each dictionary in `i18n.ts` under a comment `// Motion pro: NN name`. Arabic must be good;
  Sorani and Badini are best effort and every such string is listed in `docs/pro/review-needed.md`
  (append your own section) for a native speaker.
- **CSS** goes at the end of `styles.css` between `/* pro:NN start */` and `/* pro:NN end */`. Logical
  properties only. Reuse existing tokens and patterns; do not invent a new look.
- **Tests**: your `test/pro-*.test.mjs` replaces the placeholder and imports every export you add (the
  orphans gate counts tests as users). Follow an existing test's shape (`ok(name, cond, detail)`, a
  pass/fail count, exit 1 on failure). Fuzz the readers you write. The whole chain (`npm test`, about 35
  seconds), `npx tsc --noEmit` and `npm run build` must pass before you finish.
- **Credit**: anything ported from HyperFrames carries an Apache-2.0 header naming the source file and
  what changed, and an entry in `docs/pro/credits/NN.md`. Ideas and numbers need no header; copied or
  closely translated code does.
- **Commit** on your branch with `pro(NN): ...`. Do not push. Do not merge. Leave the tree clean.
- **Report** in under 400 words: what exists, the API, test counts, deviations, open problems, and what
  the integrator must mount where. Also write `docs/pro/NN.md` with the same, in more detail.

## How it comes together

1. **Wave 1 (this):** ten builders, each in its own worktree, in parallel.
2. **Merge:** `tools/pro-merge.py` (kept in the scratch area, not the repo) merges the ten branches into
   `pro`. The files are disjoint by design; `package.json`, `i18n.ts` and `styles.css` are the only
   shared ones and are merged by union, then checked.
3. **Wave 2 (integration):** mount the components (check chip, Sound row, Brand button, scene strip),
   give the chat the new operations (`scene.*`, `sound.set`, `brand.apply`, check-and-fix), wire sound
   into export and preview, refresh `THIRD_PARTY_NOTICES.md` and the SAFETY wording for sound, update
   `docs/MOTION.md` ("Not in this version").
4. **Wave 3 (review):** adversarial reviewers per area (fuzz the new readers, renderer determinism,
   export and A/V sync, interface in four languages and RTL, and a simplicity audit against the contract
   above), whole-app scenarios in the app's own WebKit, then fixes.
5. **Release:** the owner decides. Until then it stays on `pro`.

## Not in this pass, and why

- **Video studio changes** (own footage and audio, captions from speech, changes-to-video from git,
  Remotion removal): the other session has uncommitted Video work; they follow once it lands. Motion's
  scenes, transitions and sound are what will make replacing Remotion possible.
- **Captions**: they need word timings, which come from speech; Motion has no speech yet. They belong
  with Video.
- **WebGL transitions** and a GPU path: Canvas2D first; the shader set is a later, separate decision.
- **Video clips as layers, keyframes, groups, masks**: engine changes with a wide blast radius.
- **Anything from HyperFrames' CLI, skills, media services or cloud rendering**: see RESEARCH.md.
