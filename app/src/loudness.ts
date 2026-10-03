/**
 * Loudness. PLACEHOLDER from Phase 0 (docs/PRO.md): work package 02 replaces
 * the bodies with ITU-R BS.1770-4 (K-weighting, gating, true peak). The names
 * and shapes below are the contract other files already use.
 */
export interface Loudness {
  /** Integrated loudness, LUFS. */
  lufs: number;
  /** Sample peak in dBFS (work package 02 makes this the true peak). */
  peakDb: number;
}

export function measureLoudness(channels: readonly Float32Array[], _sampleRate: number): Loudness {
  let sum = 0;
  let n = 0;
  let peak = 0;
  for (const c of channels) {
    for (let i = 0; i < c.length; i += 1) {
      sum += c[i] * c[i];
      const a = Math.abs(c[i]);
      if (a > peak) peak = a;
    }
    n += c.length;
  }
  const rms = n > 0 ? Math.sqrt(sum / n) : 0;
  return { lufs: rms > 0 ? 20 * Math.log10(rms) - 0.7 : -Infinity, peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity };
}

/** The linear gain that brings `measured` to `targetLufs` without the peak passing `ceilingDb`. */
export function gainToTarget(measured: Loudness, targetLufs = -16, ceilingDb = -1.5): number {
  if (!Number.isFinite(measured.lufs)) return 1;
  const db = Math.min(targetLufs - measured.lufs, ceilingDb - measured.peakDb);
  return Math.pow(10, db / 20);
}
