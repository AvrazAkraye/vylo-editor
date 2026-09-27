/**
 * A clip's bytes as a URL the video player can read. A clip is kept in the
 * video as a data: URL (so it is saved with it and renders offline); the
 * WebCodecs player (`@remotion/media`) reads a blob: URL, made once per clip
 * and kept while the app runs — the same clip in the preview, the storyboard
 * and an export is one blob.
 */
import type { Clip } from './videotypes';

const urls = new Map<string, string>();

export function clipUrl(c: Pick<Clip, 'id' | 'src'>): string | null {
  const hit = urls.get(c.id);
  if (hit) return hit;
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(c.src ?? '');
  if (!m) return null;
  let bin: string;
  try { bin = atob(m[2]); } catch { return null; }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: m[1] || 'video/mp4' }));
  urls.set(c.id, url);
  return url;
}
