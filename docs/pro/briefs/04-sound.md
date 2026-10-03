# 04 Sound design: effects that match the animation, a music bed, the preview

Read `docs/PRO.md` and `docs/pro/RESEARCH.md` ("Audio") first.

## Why
Silent graphics feel unfinished. The simple version of sound is one choice, Off, Effects, Music or Both, where Effects are *generated
from the animation itself* (a slide gets a whoosh, a number counting up gets ticks, a title that lands gets a soft impact) and Music is a
mood. Nothing to import, nothing to license, nothing to mix by hand. Everything is synthesised on the device.

## You own
`app/src/motionsound.ts`, `motionsfx.ts`, `motionsoundplay.ts`, `app/src/MotionSoundPanel.tsx`, `app/test/pro-sound.test.mjs`,
`docs/pro/sound.md`, `docs/pro/credits/04.md`, CSS `/* pro:04 */`, your i18n entries.

## Contract (the placeholder already exports these; keep the names)
```ts
export const SOUND_MODES = ['off', 'fx', 'music', 'both'] as const;
export interface SoundSpec { mode: SoundMode; level: number /* 0..1, default 0.6 */; mood?: Mood /* from videosynth.ts */; seed?: number }
export interface SoundBed { channels: Float32Array[]; sampleRate: number }
export function readSound(x: unknown): SoundSpec | undefined;     // clamps everything; undefined = silence; must not import motionread.ts
export async function renderSoundBed(doc: Motion, o?: { signal?: AbortSignal; sampleRate?: number }): Promise<SoundBed | null>;
```
Add: `defaultSound()`, `soundCues(doc): Cue[]`, `soundKey(doc): string` (a hash of only what affects the sound, so caches are exact).
`loudness.ts` (`measureLoudness`, `gainToTarget`) is a placeholder that package 02 makes exact: code against its names.

## Deliver
1. **Cues from the document** (`soundCues`): from each layer's `in`/`out` animation, counters, charts, particle bursts, backdrop starts:
   whoosh (slide, wipe, mask, spin, flip), pop (pop, zoom, shapes arriving), tick/type (type, counter rolling), impact (a big title landing
   or a big number arriving), riser (a chart growing), sparkle (particles, logo shimmer), swell. Density limits (at least ~90 ms between cues
   of a kind, a cap per second), pan from the layer's x position (logical, so RTL mirrors), gain from size. "Level" scales how many and how loud.
2. **`motionsfx.ts`**: pure synthesis (no assets, no Math.random: seeded), returning Float32Array at the bed's sample rate: whoosh (filtered noise
   sweep), pop, tick, key, impact (sub plus noise burst), sparkle, riser, swell, click. Edges faded so nothing clicks; RMS-matched to each other.
   Prefer pure JS over `OfflineAudioContext` so the same bytes come out in Node tests, preview and export.
3. **Music**: reuse `videosynth.ts` (`arrange(spec, seconds, cues)` then `render(score)`; moods in `MUSIC_MOODS`). Read-only: do not edit it
   (another session has uncommitted changes in it). Align the music's `cues` to scene starts and big entrances. Fade in 0.3 s and out over
   `min(1.2 s, 15%)`.
4. **`renderSoundBed`**: mix SFX and music, normalise to -16 LUFS with a -1.5 dB ceiling (via `loudness.ts`), return planar PCM, length exactly
   `doc.seconds`. `null` when mode is off or nothing would sound. Abortable. Cache by `soundKey`.
5. **Preview** (`motionsoundplay.ts`): Web Audio only (**never `<audio>`**: it deadlocks the macOS webview). `prepare(doc)` renders lazily and
   caches; `play(from)`, `pause()`, `seek(t)`, `setLevel`, `dispose`; started from the playback clock in `motionplay.ts` (read it); silent and
   harmless if there is no `AudioContext`. A user gesture is needed to start audio: handle the suspended state.
6. **`MotionSoundPanel.tsx`**: ONE row: a four-way segmented control (Off, Effects, Music, Both); with Music or Both, mood chips and a level
   slider. That is the entire interface. Props: `{ doc: Motion; onChange(next: Motion): void }`. Default for every graphic is Off.

## Acceptance
- Cue derivation per effect with exact expectations; determinism (same document, same hash); bed length equals the document's; peak below -1.5 dBTP;
  loudness within 1 LU of -16 when mode is Both; modes matrix; `readSound` fuzz; no NaN; density limits hold.
- Speed: a 10 s Effects bed under 400 ms in Node; a 10 s Music bed: record the number.
- `npm test`, `npx tsc --noEmit`, `npm run build` pass.
