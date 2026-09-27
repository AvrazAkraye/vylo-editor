/**
 * Directions: guides for how a person's videos are made — a motion-design
 * prompt they found, a house style, a way of telling a story — saved once and
 * chosen for a video in the request form, the way a skill is chosen for a
 * task. The chosen one is copied into the video (`Video.guide`) and every
 * prompt about it carries it (video.ts `guideBlock`).
 *
 * Two come with the app, written for what its scenes can do; the person's
 * own are kept in this machine's localStorage — a preference of this person
 * on this computer, like the rest of the form, never sent anywhere but in the
 * prompt of a video that uses it.
 */

export interface Direction {
  id: string;
  name: string;
  text: string;
  /** One of the app's own: shown, used, never edited or deleted. */
  builtIn?: boolean;
}

const KEY = 'vylo.video.directions.v1';
/** The most a saved guide keeps (video.ts sends at most GUIDE_MAX of it). */
const TEXT_MAX = 12000;
const MAX_SAVED = 24;

export const BUILT_IN: readonly Direction[] = [
  {
    id: 'explainer',
    name: 'Explainer story',
    builtIn: true,
    text: [
      'Purpose: teach one core idea about the subject through one clear visual story, not a list of facts; make the difficult part intuitive without losing accuracy.',
      'Structure, in about seven beats: hook (a question or a surprising contrast) → the familiar world → what changes or goes wrong → the mechanism, how it works → the discovery → what it means for the viewer → a short recap and one action.',
      'Every scene adds new understanding. One primary visual idea per scene; let the key transformation breathe a second longer.',
      'Transitions carry meaning: the thing on screen opens into the next scene (iris, split) or turns the story (panel); calm steps fade. No random cuts.',
      'Words: warm and precise, concrete language before technical terms, labels short. If there is narration, it explains — it never reads out the on-screen words.',
      'Look: calm and clear, one accent colour for the idea being taught, emphasis on the one word that matters in each scene.',
    ].join('\n'),
  },
  {
    id: 'promo',
    name: 'Energetic promo',
    builtIn: true,
    text: [
      'Purpose: make a viewer stop scrolling in the first second and act at the end.',
      'Structure: a bold hook in huge type → the pain or the desire → the offer, in two or three punchy beats → proof only from the request → a clear call to action.',
      'Rhythm: fast. Short scenes (2–3 seconds), big type posters and scrolling words between the facts, a real clip or photo behind the emotional moment.',
      'Motion: strong entrances (pop, scale, slide, glitch once), colour panels and flashes on the turns, hard cuts on the beat, a calm close.',
      'Words: few and loud — three to six words a scene, the key word in the accent.',
    ].join('\n'),
  },
];

const clean = (x: unknown): Direction | null => {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id : '';
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 60) : '';
  const text = typeof o.text === 'string' ? o.text.slice(0, TEXT_MAX) : '';
  return id && name && text.trim() ? { id, name, text } : null;
};

/** The person's saved directions, newest first. */
export function loadDirections(): Direction[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.map(clean).filter((d): d is Direction => !!d).slice(0, MAX_SAVED) : [];
  } catch {
    return [];
  }
}

export function saveDirections(list: readonly Direction[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.map(clean).filter(Boolean).slice(0, MAX_SAVED)));
    return true;
  } catch {
    return false;
  }
}

/** A direction by id, the app's own included. */
export function directionOf(id: string | null | undefined, saved: readonly Direction[] = loadDirections()): Direction | null {
  if (!id) return null;
  return BUILT_IN.find((d) => d.id === id) ?? saved.find((d) => d.id === id) ?? null;
}
