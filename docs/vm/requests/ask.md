# Requests from package `ask`

Changes outside the files package `ask` owns, for the integrator to make or veto.

## Made here, out of lane (veto if you disagree)

1. **`app/test/pro-review-safety.test.mjs`, two pins.** The brief tells Motion to take `WEB_SEARCH_TOOL` and
   `webSearchRefused` from `videoresearch.ts` (never a copy) and to open a source the app's one way, `open_url`. Both
   change what that test pins about Motion's run-time closure, so the gate could not be green without touching it:
   - `REACHED` gains `videoresearch.ts`, with its reason: loaded by `import()` the first time Motion searches, for a
     constant and a set lookup; its Wikidata lookup (the `fetch`) is never called from Motion. `vm-ask.test.mjs` checks
     exactly which two names are used and that neither asks for the network.
   - `PINNED` gains `open_url: ['MotionChat.tsx']` (a source's page, opened only when the person presses its link;
     the address is read by `sourceUrl` first, and Rust's `open_url` takes only `https:`).
2. **`app/test/motionai.test.mjs` and `app/test/pro-direction.test.mjs`**: the edit prompt's base budget raised by 700
   (measured growth 643), with the reason written beside each. The brief sanctions this.

## Asked, not made

3. **`app/src/motionedit.ts` `rebuild`** should carry `Motion.sources` as it carries `sound`:
   `if (part.sources) next.sources = part.sources;` next to `if (part.sound) next.sound = part.sound;`. Without it, a
   hand edit of a template graphic's words, shape, language or length in Design drops the graphic's sources (the Ask's
   own ops keep them: `motionchatops.ts` `carried`). One line; no test of mine depends on it.
4. **`app/src/videoresearch.ts`**: an exported `rememberRefusal(key: string)` (one line: `noWebSearch.add(key)`) would
   let Motion's refusal land in Video's memory too. Today it is one-way: Motion reads Video's refusals (once its module
   is loaded) and keeps its own set; Video does not read Motion's, so a route that refused Motion's search is tried once
   more by Video's lookup. Harmless (one 4xx), so not urgent.
5. **`docs/MOTION.md` line 18** says "Motion makes no network request of its own". Still true of Motion's files; add
   that the one request Motion causes may now carry Anthropic's web-search tool when the person asks for facts
   (as SAFETY.md now says).
