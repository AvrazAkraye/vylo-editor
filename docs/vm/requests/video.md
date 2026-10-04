# Requests from package `video` to the integrator

Changes outside the package's files that the feature needs. Each is small; the reason is in `docs/vm/video.md`.

## 1. `app/src/VideoPanel.tsx` — give the storyboard the film-wide change (required)

Placing a graphic writes the film's held graphics (`Video.motions`) and its scenes in one step; `Storyboard` only had
`onScenes`. It now takes an optional `onVideo`. Pass the same `change` every hand edit uses (one undo step, kept, saved):

```tsx
<Storyboard t={t} video={video} … onScenes={(scenes) => change({ scenes })} onVideo={change} … />
```

Without it the storyboard offers no way in to a graphic and is exactly as before.

## 2. `app/src/videostore.ts` — read held graphics when a film is read (required)

```ts
import { readVideoMotions } from './videomotion';
// in checked(v), before `return out;`
out = readVideoMotions(out);
```

Every held graphic read again through `readMotion`, at most 12, each at most 1.5 MB; scenes and overlays naming a graphic the
film does not hold dropped; graphics no scene uses let go (this is where letting go happens — see "Undo" in `docs/vm/video.md`).
It returns the same object for a film with no graphics.

## 3. `app/src/videohistory.ts` — track the held graphics (recommended)

Add `'motions'` to `TRACKED` and to `snapshotOf` (`motions: v.motions`). Then "Update from Motion" is undone like any other
change (today it is not recorded at all, since only tracked fields make a step). Adding and removing graphic scenes already
undo correctly without it.

## 4. Already done here, for the record: `app/src/VideoArt.tsx`

Three one-line entries for `'motion'` (`SCENE_HUE`, `SCENE_GROUP`, `SceneKindArt`), forced by `tsc` once `'motion'` is a
`SceneKind`. Merge as a union with any other change to that file.

## 5. From the review (`docs/vm/review-video.md`): wire `vm-review-video.test.mjs` (required)

In `app/package.json` `test:4`, right after `node test/vm-video.test.mjs && `, add `node test/vm-review-video.test.mjs && `
(the script becomes 1,387 characters). Until then the orphans gate fails with "test file on disk that no npm script runs".
