# Review R3: interface, simplicity and accessibility

Wave 3 of the Pro pass (`docs/PRO.md`), branch `pro-r-interface`, from the integrated `pro`. The question: does the
finished studio keep *the simplicity contract* (PRO.md) for a person who only wants a title on a video, and can a
keyboard and a screen reader use every new part, in four languages and both directions?

## How it was looked at

An off-screen WKWebView (the app's engine, macOS 26.2), a non-persistent data store, a fake Tauri bridge; the real
`MotionPanel` in the sidebar and the full window, seeded with a plain template graphic (Big title), a three-scene
graphic with a push and a light leak and sound set to Both, a graphic with five tips, a graphic whose tips can all be
fixed, and long Arabic, Sorani and Badini names (scene names, a title, a brand of 40 letters). Never the owner's app,
never `tauri dev`. The harness (`app/.test-build/r3/`, git-ignored) is the W2-1 one, extended: every picture comes
with a report — controls without an accessible name, words left in English inside another language (text, `title`,
`aria-label`, `placeholder`), every key handed to `t()` that came back untranslated, labels cut inside their
button, horizontal overflow, targets under 24 px, the focus after each act, and the contrast of chosen text against
the colour actually behind it.

**216 pictures**, each looked at: Home, the sidebar's home, the sidebar editor, the full window, Design (with the
Sound row and its moods), Layers, Ask, Export (its cards, More options for Custom, Web loop and Picture), the brand
sheet, the scene strip, a scene's menu, a transition's menu, the check chip and its list, a search with results and
with none — in English, Arabic, Sorani and Badini, light and dark, at 380 px (sidebar), 760 × 600 (the narrowest
full window) and 1280 to 1440 wide; then the same set again after the fixes for English (light), Arabic (dark) and
Badini (light). Dense lines were cropped and enlarged before judging them (the export's size line looked reversed in
Arabic at 1×; at 3× it is right).

## 1. Simplicity

**The shortest path** (Home, pick a template, change the words, Export), counted the way docs/pro/export.md counts:

| Step | 0.132.0 | Now | New on screen | New decisions |
|---|---|---|---|---|
| Home | banner, "Templates 18" heading, a paragraph, chips, cards | banner, a search box *in place of* the heading, the Brand kit button, the same chips, "Recently used" (once there is history), cards | search box, Brand kit button | 0 |
| Pick a template | 1 click | 1 click | "● Looks good" under the stage; a quiet "+ Scene" above the timeline (full window) | 0 |
| Change the words | Design opens on the template's fields | the same | further down Design: one Sound row (Off), the Brand kit button on the Colours heading | 0 |
| Export | tab, then kind, size, quality, motion blur, Save as… and Download (5 decisions) | tab, six "Where is it going?" cards with the graphic's own already chosen, Download; the rest under "More options" | the cards (they replace the five controls) | 0 (was 5) |

Clicks: 3 (card, Export tab, Download) plus the typing, as before. No new step, no new decision; the Export tab is
simpler than it was. The path holds the contract.

**Each feature's first appearance:**

| Feature | What the person sees by default | Clicks to use it | Verdict |
|---|---|---|---|
| Quality check | "● Looks good" in quiet text (was a green pill), one line under the stage; an amber "3 tips" pill only when there is something to read | 1 to open the list, 1 per Fix or 1 for Fix all; a tip selects its layer | Keep. **Changed:** the clean state no longer looks like a badge; Fix all no longer scrolls out of sight. In the sidebar the line still costs ~30 px on every graphic: the one line the contract allows |
| Sound | One row in Design: Off · Effects · Music · Both, Off chosen | 1 (Effects); Music and a mood 2; the level a drag | Keep. **Changed:** the moods are now the Design tab's chips (they looked like loose words, below) |
| Scenes and transitions | A quiet "+ Scene" at the end of a 28 px band above the timeline (full window only) | 1 adds a scene; 1 on a chip opens its menu; 1 on a transition opens the kinds | Keep, **with one real regression left:** "+ Scene" on a template graphic drops the template, so *Words on screen* is replaced by "change its words in Layers" — the shortest path's own step moves away after one innocent click. Logic files: `docs/pro/requests/R3.md` §1 |
| Brand kit | "☆ Brand kit" on Home's bar and on Design's Colours heading; nothing else until opened | 1 opens the sheet; Save 1; Apply to this graphic 1 | Keep; every field optional, nothing set means every template as designed |
| Gallery search | A search box where the heading was; a "Recently used" line once there is history (hidden while searching) | type | Keep. "Recently used" is a second line for the same feature and can repeat the first card when there is one graphic; it is conditional and one line, so it stays |
| New templates | Cards in the grid, same as the old ones | 1 | Keep |
| Export | Six cards, the graphic's own shape chosen; one line saying size, kind, megabytes; "More options" closed | 2 (tab, Download) | Simpler than before. A sound line appears under the cards only when the graphic has sound |
| Chat operations, AI direction | Nothing new on screen | words | Keep |

## 2. Right to left and four languages

- **Every visible word is translated.** Over every picture in Arabic, Sorani and Badini the report found no English
  except the intended (MP4, GIF, PNG, 1080p, "hex", "Full HD", the language picker's "English") and the fixture's
  own layer names. No `t()` key came back untranslated. A new test holds the strings the check and the Sound row
  hand to `t()` from tables (22 tips and repairs, 8 moods), which the catalogue test cannot see.
- **Mirroring** is right throughout: the bar, the cards, the chip menu (end-aligned), the brand sheet (flipped to fit),
  the Sound row and its slider, More options' chevron. The scene strip's track stays left to right on purpose (time
  runs as the timeline's does), its buttons in the names column, its menus in the reading direction.
- **Fixed:** the handle's "@" stood at the far side of its box in Arabic and Kurdish (`dir="ltr"` on `.mb-at`); the
  brand preview's accent bar ran left to right in a right-to-left preview; transition names at 9 px were close to
  unreadable in Arabic script, and a destination card's line too (both 10.5 px now; the chosen card's line in
  `--ink-2`, which also fixes its contrast); a scene chip cut to "Sce…" had a tooltip without its name (now name,
  then times).
- **Kept as they are:** the colour names under the brand kit's five swatches stay at 9 px — at 10.5 px "Background"
  broke mid-word in its 58 px column (tried and reverted); each swatch is also named by its label.
- Long names truncate with an ellipsis and keep the full text in the tooltip and the accessible name (the brand
  button, scene chips, the window title). No horizontal overflow at 760 px in any language.

## 3. Accessibility

Checked by dispatching keys and reading the focus and the live regions (not a real key press, not VoiceOver):

- **Works:** the chip opens on ArrowDown, arrows move and wrap, Home/End, Escape closes it and returns the focus to
  the chip without leaving the full window; the brand sheet, a scene's menu and a transition's menu close on Escape
  and give the focus back to their trigger; the export cards are a radio group; More options is a disclosure
  (`aria-expanded`, `aria-controls`); progress is a `progressbar` and a polite status every tenth; the chip's count is
  a polite region of its own. Tab order is the reading order: the column, the stage and its transport, the tips
  chip, "+ Scene", "Split here", one stop for the scene track, the timeline. Reduced motion stops every new popover's
  animation and the gallery's playing cards; nothing new animates otherwise.
- **Fixed:**
  1. *Focus lost after "+ Scene".* Going from one scene to two swapped the strip's children, so the pressed button
     was replaced and the focus fell to the window; and "Scenes: 2" was put in a *new* status region, which screen
     readers often do not read. The strip now keeps its status and its end box (with "+ Scene" first) as the same
     first two children in both shapes: the button keeps the focus, the region is the one that was there.
  2. *Focus lost after the last fix.* When Fix all or a Fix left nothing to say, the chip (holding the focus)
     became a status and the focus fell to the page. The status can now take the focus from code (`tabIndex=-1`)
     and does.
  3. *The focused tip was not visible:* shown only by a fill 1.1:1 against the menu. It now has the studio's ring,
     drawn inside.
  4. *Fix all below the fold:* with five tips in Sorani (and in the sidebar in English) the menu scrolled and Fix
     all was under it. It now sits in a sticky foot.
  5. *Contrast:* the quiet "+ Scene" was 3.7:1 in the light theme (an opacity on top of `--mute`), the chosen
     destination's line 4.4:1. Both above 4.5 now; a test checks the text pairs the new parts use in both themes.
  6. *Targets:* the transition chip was 20 px tall, the logo's remove button 25 × 21; both 24 px now.
  7. *Applying the brand said nothing:* the sheet closed and the graphic changed silently. It now says "Applied the
     brand kit: {name}" in a status region (words the catalogue already had in four languages).

## 4. Consistency

The new parts mostly look like the studio: the check's list, the scene menus and the brand sheet are the colour
popover (`.mo-pop`), the cards are the studio's radio cards, the strip's chips are the timeline's. Two did not:

- **The moods were Video's chips**, whose fill is `--panel-2` — the sidebar's own colour, so in Design they were
  loose words in three rows. They are now the Design tab's chips (the length presets right above them).
- **The clean "Looks good"** was a green-washed pill, a badge louder than anything else in the column, on every
  graphic. It is now quiet text with a green dot; the amber pill is kept for when there is something to read.
- **The scene strip** stopped lining up with the timeline whenever a transition chip was wider than its share of a
  short scene: at 760 px (or in Arabic) two transition names took a three-second scene whole and the next chips no
  longer stood over their layers. The transition chip now gives way inside its scene, and a scene under 130 px shows
  a ⇄ mark (a container query) with the name kept as its accessible name and tooltip.

## What changed

| File | Change |
|---|---|
| `app/src/MotionScenes.tsx` | stable first children (status, end box with "+ Scene"); a mark beside each transition's name; the chip tooltip starts with the name |
| `app/src/MotionChecks.tsx` | Fix all in a sticky foot (`role="none"`); the clean status takes the focus the last fix leaves |
| `app/src/MotionSoundPanel.tsx` | the moods as `gal-chip` in `mo-de-chips` |
| `app/src/MotionBrandKit.tsx` | `dir="ltr"` on the handle's row; a status that says the brand was applied |
| `app/src/styles.css` | `/* pro:r3 */` only: the strip's container query and sizes, the quiet clean chip, the tip's ring, the sticky foot, 10.5 px lines, the two contrast fixes, 24 px targets, the mirrored preview bar |
| `app/test/pro-review-interface.test.mjs` | 43 checks, wired before `orphans.test` |
| `docs/pro/requests/R3.md` | "+ Scene" keeps the template (motionscene/motionedit); `empty-frame` and scenes (motioncheck) |

No new i18n key (the one sentence added was already in the catalogue), so nothing new for `review-needed.md`.
`npm test` (whole chain, exit 0), `npx tsc --noEmit` and `npm run build` pass.

## What is left, and what was not verified

- **"+ Scene" detaches a template** (above; `requests/R3.md` §1). The largest simplicity defect left.
- The sidebar has no scene strip: scenes are made in the full window only (as W2-1 chose).
- The sidebar spends one line (~30 px) on "Looks good" for every graphic.
- Not verified: a real screen reader (VoiceOver), real key presses (the harness dispatches events), the real app
  window and its title bar, sound actually heard, focus rings as they draw after a real keyboard focus (the
  pictures come from programmatic focus), and the Sorani and Badini wording itself (`review-needed.md`).
