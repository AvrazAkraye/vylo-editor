import { useEffect, useId } from 'react';
import type { Motion } from './motiontypes';
import type { T } from './motionui';
import { Row, Seg, SliderField, type Choice } from './MotionControls';
import { SOUND_MOODS, defaultSound, moodOf, readSound, withSound, type SoundMode, type SoundSpec } from './motionsound';
import { dispose, follow, prepare, wake } from './motionsoundplay';
import { usePlay } from './motionplay';

/**
 * A graphic's sound, as a person sets it: one row.
 *
 * Off, Effects, Music, Both — four segments, Off chosen for every graphic
 * until somebody chooses otherwise. With Music or Both, the moods appear as
 * chips under it (the template's own mood lit until another is picked); with
 * any sound on, a level. That is all of it: which effect plays where, how the
 * music follows the cuts and how loud the whole is are worked out
 * (motionsound.ts), so there is nothing else to set.
 *
 * Every change goes to `onChange` as the whole graphic, already read
 * (`withSound`), so the panel records it for undo like any other edit. A
 * click here is also a moment WebKit lets sound start, so each one wakes the
 * preview's context (`wake`).
 */
export function MotionSoundPanel({ t, doc, onChange }: { t: T; doc: Motion; onChange: (next: Motion) => void }) {
  const id = useId();
  const spec = readSound(doc.sound) ?? defaultSound();
  const set = (patch: Partial<SoundSpec>) => {
    wake();
    const next = withSound(doc, { ...spec, ...patch });
    if (next !== doc) onChange(next);
  };
  const modes: readonly Choice<SoundMode>[] = [
    { value: 'off', label: t('Off') },
    { value: 'fx', label: t('Effects'), title: t('Sounds made from the animation: a whoosh for a slide, ticks for a counter') },
    { value: 'music', label: t('Music'), title: t('Music composed for this graphic, on this computer') },
    { value: 'both', label: t('Both'), title: t('Effects over music') },
  ];
  const mood = moodOf(doc);
  const music = spec.mode === 'music' || spec.mode === 'both';
  return (
    <div className="mo-sound">
      <Row label={t('Sound')} id={id}>
        <Seg labelledBy={id} value={spec.mode} choices={modes} onChange={(mode) => set({ mode })} />
      </Row>
      {/* The Design tab's own chips (its length presets), not Video's: Video's are a fill the colour of this column,
          so in the sidebar they read as loose words (review R3). */}
      {music && (
        <div className="mo-de-chips mo-sound-moods" role="group" aria-label={t('Mood')}>
          {SOUND_MOODS.map((m) => (
            <button key={m.id} type="button" className={`gal-chip${m.id === mood ? ' on' : ''}`} aria-pressed={m.id === mood}
                    onClick={() => set({ mood: m.id })}>
              {t(m.label)}
            </button>
          ))}
        </div>
      )}
      {spec.mode !== 'off' && (
        <SliderField label={t('Level')} value={spec.level} scale={100} min={0} max={100} step={1} digits={0} unit="%"
                     onChange={(level) => set({ level })} />
      )}
    </div>
  );
}

/** How long the graphic must stay unchanged before its sound is rendered again: a slider dragged across renders once. */
const SETTLE_MS = 250;

/**
 * The graphic's sound, heard while it plays. Draws nothing: mount it once
 * wherever the open graphic is (beside the stage), and it keeps the preview's
 * sound (motionsoundplay.ts) ready for the graphic as it changes and in step
 * with the playhead (motionplay.ts). Leaving it — closing the graphic — stops
 * the sound and lets the speaker go.
 */
export function MotionSoundPreview({ doc }: { doc: Motion }) {
  const p = usePlay();
  useEffect(() => {
    const timer = setTimeout(() => {
      void prepare(doc);
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [doc]);
  useEffect(() => {
    follow({ t: p.t, playing: p.playing, speed: p.speed });
  }, [p.t, p.playing, p.speed]);
  useEffect(() => () => dispose(), []);
  return null;
}
