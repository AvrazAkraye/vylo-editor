/**
 * Which computer the app is running on, for the words a screen prints: ⌘ or
 * Ctrl, Finder or Explorer.
 *
 * macOS writes ⌘; everywhere else it is Ctrl, and showing ⌘ there is a lie.
 * Anywhere a shortcut or the file manager is named — the composer hint, a
 * button's `kbd`, a tooltip, "Show in Finder" — has the same two choices to
 * make, so it imports this rather than typing the glyph or testing again.
 *
 * A module of its own, with nothing imported, so that a screen which needs
 * only this one boolean does not pull in the module it used to live in.
 * `Welcome.tsx` (where it was) imports the sign-in screen, and through it the
 * account and gateway modules, which make network requests, and the
 * environment block, which reads files. Motion's Export tab needs to know only
 * whether to say Finder; importing it from here keeps those modules out of
 * what "Motion makes no network request of its own" is checked against
 * (`test/pro-review-safety.test.mjs`, docs/pro/requests/R1.md item 2).
 * `Welcome.tsx` re-exports it, so nothing else changed.
 */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
