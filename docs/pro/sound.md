# 04 Sound design: what exists, how it works, what is left

Work package 04 of the Pro pass (`docs/PRO.md`, brief `docs/pro/briefs/04-sound.md`), branch `pro-04-sound`.
A graphic can now carry sound: **Off** (the default), **Effects** generated from its animation, **Music**
composed for it in a mood, or **Both**. Everything is synthesised on the device; nothing is downloaded,
nothing is licensed, nothing reaches the network.

## Files

| file | what it is | DOM |
|---|---|---|
| `app/src/motionsound.ts` | the `sound` field and its reader; cues from the animation; the bed (mix, music, loudness); the cache key | no (Web Audio only through `videosynth.render`) |
| `app/src/motionsfx.ts` | nine effects synthesised in plain JavaScript, seeded, at one loudness | no |
| `app/src/motionsoundplay.ts` | the preview: one `AudioContext`, one buffer source, following the playhead | Web Audio |
| `app/src/MotionSoundPanel.tsx` | `MotionSoundPanel` (the one row) and `MotionSoundPreview` (draws nothing; keeps the sound with the clock) | React |
| `app/test/pro-sound.test.mjs` | 181 checks | |

CSS: `/* pro:04 start */ … /* pro:04 end */` at the end of `styles.css` (two rules, logical properties).
i18n: six keys per language under `// Motion pro: 04 sound`; Sorani and Badini listed in `review-needed.md`.

## The API

```ts
// motionsound.ts — the contract names are unchanged
export const SOUND_MODES = ['off', 'fx', 'music', 'both'] as const;
export interface SoundSpec { mode: SoundMode; level: number; mood?: Mood; seed?: number }
export interface SoundBed { channels: Float32Array[]; sampleRate: number }
export function readSound(x: unknown): SoundSpec | undefined;
export async function renderSoundBed(doc: Motion, o?: RenderSoundOptions): Promise<SoundBed | null>;
//   RenderSoundOptions = { signal?: AbortSignal; sampleRate?: number /* 48000 */; music?: MusicRenderer /* tests only */ }
export function defaultSound(): SoundSpec;                  // { mode: 'off', level: 0.6 }
export function soundCues(doc: Motion): Cue[];               // the effects, thinned to the level, in time order
export function soundKey(doc: Motion): string;               // 16 hex digits, or 'silent'
export function withSound(doc: Motion, spec: SoundSpec | undefined, now?: number): Motion;  // the one edit
export function moodOf(doc: Motion): Mood;                   // the chosen mood, else the template's
export function musicCuesOf(doc: Motion): number[];          // the accents the music marks
export function loudnessFor(level: number): number;          // LUFS target for a level
export const SOUND_MOODS: readonly { id: Mood; label: string }[];
export interface Cue { kind; t; d; pan; gain; pitch; rev; seed; layer }

// motionsfx.ts
export const SFX_KINDS = ['whoosh', 'pop', 'tick', 'key', 'impact', 'sparkle', 'riser', 'swell', 'click'] as const;
export function synth(spec: Sfx, rate: number): Float32Array;   // mono, faded, at SFX_REF_DB (−18 dBFS short-term RMS)

// motionsoundplay.ts
prepare(doc): Promise<boolean>; play(from, speed?); pause(); seek(t); setLevel(0..1); follow({ t, playing, speed });
wake(); position(); dispose(); setAudioFactory(f | null)   // the last for tests

// MotionSoundPanel.tsx
<MotionSoundPanel t={t} doc={doc} onChange={(next) => …} />
<MotionSoundPreview doc={doc} />
```

## How it decides what to play

**Reading.** `readSound` repairs anything: an unknown mode is off; a level is held to 0..1 in hundredths (a model's
`60` is 60%); moods from the list or a few aliases (`lo-fi`, `chill`, `arabic`); a seed is a whole number in the
composer's range; a bare word is a mode. Off with nothing chosen is `undefined`, so a graphic that never had sound
and one turned off at the defaults read the same; off with a mood or a level keeps them for when it is turned on.
It is a fixed point and never throws (4,000-input fuzz, revoked Proxies and throwing getters included).

**Cues.** Each layer asks for sounds by what it does:

| what moves | sound | notes |
|---|---|---|
| `slide`, `wipe`, `mask`, `spin`, `flip` in | whoosh, the effect's length | words or lines split one by one: one each, later ones ×0.7; letters: one gesture |
| `pop`, `zoom` in | pop (click when tiny) | |
| `rise`, `drop` in | soft whoosh (×0.55, 0.8 long); a shape, icon or picture: pop ×0.75 | |
| `fade`, `blur` in | headline (≥ 9u): swell ×0.5; an object: pop ×0.6; a frame-sized panel: nothing; small words: nothing | |
| `grow`, `draw` in | quiet whoosh (×0.45, ×0.35) | |
| `type` in | a key as each letter appears, along the curve | |
| a chart's entrance | riser as long as its data take to come in | |
| a big title (≥ 11u) landing by pop/zoom/drop/slide/spin/flip/rise/mask | impact when it is 95% in on its curve | so an `expo-out` lands early, as it looks |
| a counter rolling | ticks at sixteen steps a second of roll, pitch rising; a big number (≥ 11u) lands with an impact at 98% | |
| particles | burst: sparkle (0.7 s, 0.6); stream: sparkle (1.2 s, 0.35); pitch by style | |
| a `shimmer` loop | a small sparkle each pass, after arriving and before leaving, three at most | |
| a backdrop | swell at its start (0.3 when simply there, 0.4 when it enters) | |
| an exit that moves | the whoosh reversed (peaks late), ×0.55 or ×0.35 | fades, blurs and un-typing leave silently |

Gain from size: `0.3 + 0.55 × min(bigness, 1.3)`, where bigness is type size / 10u (text), / 12u (counter), side
of the area / 28u (shape), / 40u (picture), / 45u (chart), icon size / 14u; times the layer's scale. Pan from the
centre of the layer's box across the frame, from its logical pin and `x`, mirrored in a right-to-left language, scaled
to ±0.7. Each cue's seed comes from the layer id, the kind and the graphic's seed; its pitch varies ±3% by that seed.

**Thinning.** Most important first (gain × weight: impact 1, whoosh and riser 0.8, pop 0.7, swell and sparkle 0.6,
click 0.5, key and tick 0.45); a cue is kept only if no kept cue of its kind is closer than its gap (whoosh 0.15 s,
pop/tick/key/click 0.09, sparkle 0.35, impact 0.5, riser 0.8, swell 1.0) and no one-second window would hold more
than `round(4 + 6 × level)` cues (8 at the default). The level also sets a floor, `0.5 × (1 − level)^1.5`: nothing
is dropped at 0.6 and above; at 0.1 only what matters most survives (no ticks). At most 240 cues.

**Music.** `videosynth.arrange({ mood, seed }, seconds, musicCuesOf(doc))` then `render(score, rate)` — imported
with `import()` only when music is made, so reading a graphic never loads the composer. The accents are each scene
start after the first (`doc.scenes`, package 05) and every big landing, half a second apart at least, twelve at most;
`arrange` moves each to its nearest beat. The mood is the chosen one, else the template's (data: corporate, logo and
titles: cinematic, countdown: epic, quote and backgrounds: calm, kinetic: electronic, handle: lo-fi; else uplifting).
The seed, unless chosen, comes from the graphic's id, so two graphics in one mood have different tunes. The music is
levelled to −23 LUFS under the effects, faded in over 0.3 s and out over `min(1.2 s, 15%)`, and dipped to ×0.6 under
every impact, whoosh and riser of gain 0.6 or more (0.15 s down, held 0.15 s or the riser's length, 0.4 s back).

**Loudness.** `loudnessFor(level)`: −16 LUFS at 0.6, the level's decibels below it (0.3 → −22), up to −14 at 1.
The mix is raised to the target (at most +10 dB for effects alone, +20 with music), limited, measured again, raised
by what the limiter took and limited once more; `gainToTarget(…, −1.5)` then has the last word and may only lower
it; 3 ms and 20 ms fades at the ends. The limiter looks ahead 5 ms, releases over 80 ms, and holds the
*reconstructed* wave (12-tap windowed sinc at ¼, ½, ¾ between samples) under −2.5 dB, so the true peak stays under
−1.5 dBTP by a finer meter.

**Effects.** Plain JavaScript, `rng(seed)` noise, a trapezoidal state-variable filter for the moving filters:
whoosh (noise through two band filters following a hump peaking at 30%, or 72% reversed), pop (a sine sliding up),
tick (two partials and a pinch of noise), key (press, thock, release), click, impact (falling sub-bass, body tone,
closing noise burst, soft saturation), sparkle (pentatonic bell grains), riser (noise and a four-harmonic buzz
climbing two octaves), swell (a chorused open fifth). Partials past 45% of the rate are left out. Each is faded
in 2 ms and out 8 ms (first and last samples exactly 0) and brought to −18 dBFS over its loudest 50 ms.

**Preview.** Web Audio only. The context is made only when a graphic has sound. `follow` starts the sound when play
starts, stops it on pause, and starts it again at the playhead only when they differ by more than 0.12 s (a seek, a
loop, a hidden window); a new speed restarts it at that speed (the pitch moves with it). A context that is
`suspended` is resumed by the first click or key press anywhere (capture-phase listeners, removed once running), and
a play that waited starts at the playhead the moment it runs. Starts and stops are faded over 8 ms. No context, no
sound, no error.

## Numbers

Node (Apple silicon, `npm test` build):

- `pro-sound.test.mjs`: **181 checks, 0 failures, about 2.7 s**. The whole chain: 13,490 checks, 0 failures,
  156 suites, about 51 s.
- A 10 s Effects bed (the `steps` template, 18 cues): **46 ms** (budget 400 ms). Asked again: about 1 ms (kept).
- A 10 s Both bed with the test's stand-in player: about 110 ms.

The app's engine (macOS 26.2 WKWebView, an off-screen host in `app/.test-build/sound-harness/`, non-persistent data
store, never the owner's app), real `videosynth.render` in an `OfflineAudioContext`, 48 kHz:

| bed | time | loudness.ts (placeholder) | exact BS.1770 | true peak |
|---|---|---|---|---|
| Music 10 s, first (loads the composer) | 580 ms | −16.15 | −12.81 | −2.30 |
| Music 10 s, corporate / oriental / epic | 529–656 ms | −16.1 | −12.8 to −14.3 | ≤ −2.18 |
| Music 30 s, calm | 1,057 ms | −16.16 | −12.99 | −2.50 |
| Both 10 s | 399–501 ms | −16.08 | −12.9 to −14.1 | ≤ −2.46 |
| Both 10 s, level 0.3 | 482 ms | −22.02 | −20.26 | −8.06 |
| Effects 10 s | 94 ms | −22.62 | −12.36 | −2.47 |

The gap between the two loudness columns is the placeholder: `loudness.ts` today is ungated RMS with no K-weighting,
so it reads music about 3 LU quieter than it is, and sparse effects (mostly silence) far quieter. Normalising
against it makes beds **about 3 LU louder than −16** by an exact meter until package 02 lands. The same harness with
an exact BS.1770 meter (gated, 4× true peak) substituted for `loudness.ts` gives every bed above within 0.05 LU of
its target (−16.00 to −16.05; −22.02 at level 0.3) with true peaks ≤ −2.5 dBTP. The same check in Node across all
eighteen templates, Effects and Both, levels 0.3 and 0.6: within 0.2 LU, except `loop-bg` with effects only (one
sparkle and one swell in 8 s, held at −18 LUFS by the +10 dB boost cap). At level 1 (−14 LUFS) seven beds stop
0.3–1.0 LU short: the peak ceiling, not the meter, is what holds them.

In the WKWebView a new `AudioContext` starts `suspended` and `resume()` without a gesture made it `running` in this
host; the preview's position advanced 0.701 s in 700 ms. The app's own webview configuration may differ; the
gesture listener covers that case.

## What was verified, and what was not

- Verified: every acceptance item in the brief in Node (cue derivation per effect with exact numbers, determinism,
  length, true peak, loudness within 1 LU in Both, the mode matrix, `readSound` fuzz, no NaN, density limits, the
  Effects speed); the music path, timing and loudness in real WebKit with the real composer.
- **Not verified: that anyone hears it.** No sound was listened to: the effects were designed by their numbers and
  shapes, and the harness runs off-screen. Real playback through the speakers in the app's webview, sync by ear, and
  how the effects sound to a person are untested. The preview's logic is tested against a recording stand-in
  `AudioContext`, not the app's.
- The panel's look was checked on its own, not in place: `MotionSoundPanel` rendered in the same WKWebView host with
  the app's `styles.css`, in English and Arabic (right to left), light and dark, Off / Effects / Both. The segments,
  the chips and the level mirror correctly and the chips sit under the control column. It is not mounted in the
  studio yet, so it has not been seen inside the Design tab, in Sorani or Badini, or with a keyboard or screen reader
  (it is built from `Seg` and `SliderField`, which carry the studio's keyboard and ARIA handling).
- Node cannot play the score (no `OfflineAudioContext`), so the music tests use a stand-in player (sines for the
  notes); `renderSoundBed` with music and no Web Audio throws "This window cannot make sound." rather than returning
  silence.

## Deviations from the brief

- `MotionSoundPanel` takes `t` as well as `doc` and `onChange`, as every Motion component does.
- The level slider shows for **any** mode that sounds, not only Music and Both: the level also decides how many
  effects play, so Effects needs it too. Mood chips show only with Music or Both.
- `RenderSoundOptions.music` (a stand-in score player) exists so Node can test the mix; nothing in the app passes it.
- Music that cannot be made (no Web Audio) throws instead of returning `null`, so an export can say the sound was
  dropped rather than ship silence as if it were intended.
- The duck depth is ×0.6, not the ×0.25 HyperFrames uses under a voice (an effect is a moment, not speech).
- `MotionSoundPreview` lives in `MotionSoundPanel.tsx` (my only `.tsx`); `motionplay.ts` exposes the clock only as a
  hook, so following it needs a component.

## Open problems

1. **`motionedit.ts` `rebuild()` drops `sound`** (and `scenes`): changing a template graphic's words, shape, language
   or length rebuilds it without its sound. Requested in `docs/pro/requests/04.md`.
2. Loudness is only as exact as `loudness.ts`; until package 02 lands, beds are about 3 LU hot by a real meter.
3. Speed changes move the pitch (playback rate); a pitch-kept time-stretch is out of scope.
4. Music takes 0.4–1 s to render in WebKit for a 10–30 s graphic; the preview is silent until it is ready. A long
   graphic's first Music render could show a quiet "composing" hint (not added: the brief's panel is one row).
5. The ckb and kmr strings need a native speaker (`review-needed.md`).
6. Output latency is not compensated in the preview (the context's `outputLatency`, typically 10–40 ms).

## What the integrator mounts, and where

1. `MotionDesign.tsx` (the Design tab): `<MotionSoundPanel t={t} doc={doc} onChange={(next) => onEdit((m) => withSound(m, next.sound), 'sound')} />`,
   after the length and rate rows. Applying `next.sound` to `m` (rather than replacing the graphic with `next`)
   keeps any edit that landed in between; the `'sound'` key folds a dragged level into one undo step.
2. `MotionPanel.tsx`: exactly one `<MotionSoundPreview doc={doc} />` wherever a graphic is open (it is a singleton
   player; it disposes when unmounted).
3. Export (package 03): `renderMp4(doc, { sound: (readSound(doc.sound)?.mode ?? 'off') !== 'off' })`; catch a throw
   from `renderSoundBed` as `audio: 'dropped'`.
4. Chat (wave 2): `sound.set` reads the model's value with `readSound` and applies it with `withSound`.
5. `docs/MOTION.md`: "Sound" leaves "Not in this version"; the file table gains the three modules. SAFETY wording:
   sound is synthesised on the device, no network, no assets.
