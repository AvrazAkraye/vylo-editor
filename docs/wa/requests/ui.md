# Requests from `ui` (changes outside the package's files, for the integrator)

1. **`app/test/vm-ask.test.mjs` line 632 only allows `vm:*` blocks after `/* vm:ask end */`.** WA.md asks each package to
   put its CSS block "at the end of `styles.css`", and any `wa:*` block there fails that check. `ui` therefore placed
   `/* wa:bulk start */ … /* wa:bulk end */` immediately **before** `/* vm:ask start */` (no selector is shared, so the
   cascade is unchanged). `design` will meet the same check with `wa:design`. Suggested fix when merging: widen the
   pattern to `(?:vm|wa):[a-z]+` so marked `wa:*` blocks may follow, then the `wa:bulk` block can move to the end.
2. **Mount the new props** in `WhatsAppPanel.tsx` (design's file): `chats={chats}` and `msgs={msgs}` on
   `<WhatsAppBroadcast …/>` (From my chats, STOP replies), and `openCampaign={id}` when the assistant stages a draft.
3. **App drop routing** (`App.tsx` `listenForDrops` `claim`): call `claimBroadcastDrop(at, paths)` (exported by
   `WhatsAppPeople.tsx`) first, so a list dropped on Broadcast's file zone is read there and not attached to the chat.
4. **Case-only file names**: the brief's `WhatsAppAudience.tsx` / `WhatsAppTemplates.tsx` collide on macOS with
   `whatsappaudience.ts` / `whatsapptemplates.ts` (TypeScript resolved `./WhatsAppAudience` to the `.ts` file; esbuild
   resolves `./whatsappaudience` to the `.tsx` first). They are `WhatsAppPeople.tsx` and `WhatsAppReady.tsx`; please
   use these names in WA.md's table.
