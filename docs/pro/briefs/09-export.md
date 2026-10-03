# 09 Export and sharing: destinations and GIF

Read `docs/PRO.md` and `docs/MOTION.md` (the export parts) first. Read `MotionExport.tsx`, `motionexportops.ts`, `motionencode.ts`.

## Why
Today the export dialog asks for size and quality. Most people are asking "where is this going?" The simple version is destination cards that pick the
right shape, size and kind of file; the detail stays one click away. And a looping GIF is the format people actually paste into chats and pages.

## You own
`app/src/motiongif.ts`, `motiongifops.ts`, `motionshare.ts`, `app/src/MotionExport.tsx`, `app/test/pro-export.test.mjs`, `docs/pro/export.md`,
`docs/pro/credits/09.md`, CSS `/* pro:09 */`, your i18n entries. You may *call* but not edit `motionexportops.ts` (package 03 owns it: it is adding
sound); use its exports (`frameAt`, `pixelsFor`, `estimateBytes`, `writeMotionFile`, `fileNameFor`...). If you need a change there, write
`docs/pro/requests/09.md`.

## Deliver
1. **`motiongif.ts`**: a pure GIF89a writer: LZW encoder, a colour quantiser (median-cut or octree, deterministic), optional ordered or error-diffusion
   dithering (deterministic), global palette sampled across frames or per-frame local palettes (choose and justify), a transparency index, the NETSCAPE
   loop block, frame delays in centiseconds with accumulated rounding error so the total duration is right, and frame-to-frame disposal/rect cropping to
   shrink the file. Test by decoding your own output with a small LZW decoder written in the test.
2. **`motiongifops.ts`**: `renderGif(doc, o)`: paint frames at the GIF's own rate (default 15 fps, at most 20), a width cap (default 720 px, at most
   1080), at most 15 s, size cap about 25 MB with automatic reduction (fewer colours, then smaller, then lower fps) and an honest message; progress and
   cancel; transparent graphics keep transparency.
3. **`motionshare.ts`**: the destinations as data plus a pure `settingsFor(dest, doc)`: `story` (9:16 MP4), `post` (4:5 or 1:1 MP4), `youtube` (16:9 MP4),
   `loop` (GIF), `picture` (PNG still at the most telling frame), `custom` (the old controls). Each says the format, size, quality and what changes in
   the document's own shape (it never changes the person's graphic, only the output). A file-size and time estimate.
4. **`MotionExport.tsx`**: the new dialog: six destination cards (an icon, two words, one line), the best one pre-selected from the graphic's shape; a
   single primary button; "More options" collapsed, holding everything the dialog offers today (size, quality, fps, transparency, Save as / Download).
   **Fewer decisions than today on the first screen; no capability removed.** Keep existing behaviours (overlay notice about MP4 having no alpha,
   unsupported-encoder fallback to PNG). Leave a clearly marked slot for a "Sound" line that package 04/03 will fill (a prop `soundNote?: ReactNode`).
   RTL, keyboard, screen reader.

## Acceptance
- GIF: header, logical screen descriptor, palette sizes, LZW round-trip, loop block, total delay within 1 cs of the document's length, transparency,
  determinism, a hostile palette (1 colour, 256 colours, every pixel different), tiny and large frames. The existing export tests keep passing.
- `settingsFor` table tests for every destination and every shape. `npm test`, `npx tsc --noEmit`, `npm run build` pass.
