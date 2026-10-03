import type { Motion } from './motiontypes';

/**
 * Sound for a graphic. PLACEHOLDER from Phase 0 (docs/PRO.md): work package 04
 * replaces this file; the names below are the contract other files already use.
 */
export const SOUND_MODES = ['off', 'fx', 'music', 'both'] as const;
export type SoundMode = (typeof SOUND_MODES)[number];

export interface SoundSpec {
  mode: SoundMode;
  /** 0..1 */
  level: number;
}

/** A finished bed of sound: planar PCM, one array per channel. */
export interface SoundBed {
  channels: Float32Array[];
  sampleRate: number;
}

/** Read a stored or model-written sound spec; `undefined` is silence. */
export function readSound(_x: unknown): SoundSpec | undefined {
  return undefined;
}

/** Render the whole sound of `doc` to PCM, or `null` when it has none. */
export async function renderSoundBed(_doc: Motion, _o: { signal?: AbortSignal; sampleRate?: number } = {}): Promise<SoundBed | null> {
  return null;
}
