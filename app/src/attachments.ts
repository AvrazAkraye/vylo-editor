import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { ImageBlock } from './agent';

/** An image the user attached, held in memory until the message is sent. */
export interface Attached {
  id: string;
  name: string;
  mediaType: string;
  data: string; // base64, no data: prefix
  bytes: number;
}

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

let seq = 0;
const nextId = () => `att_${Date.now()}_${seq++}`;

export function toImageBlock(a: Attached): ImageBlock {
  return { type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } };
}

export function previewUrl(a: Attached): string {
  return `data:${a.mediaType};base64,${a.data}`;
}

/** Read an image the user dropped, by path, through the Rust side. */
export async function attachFromPath(path: string): Promise<Attached> {
  const r = await invoke<{ media_type: string; data: string; name: string; bytes: number }>('read_image', { path });
  return { id: nextId(), name: r.name, mediaType: r.media_type, data: r.data, bytes: r.bytes };
}

/**
 * Read an image the user pasted. A pasted screenshot has no path — it only
 * exists in the clipboard — so this is the one route that cannot go through
 * Rust and reads the blob in the webview instead.
 */
export function attachFromFile(file: File): Promise<Attached> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      reject(new Error(`${file.name || 'clipboard image'}: not a PNG, JPEG, GIF or WebP`));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error(`${file.name || 'image'}: ${(file.size / 1048576).toFixed(1)} MB is over the 5 MB limit`));
      return;
    }
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Could not read the pasted image.'));
    fr.onload = () => {
      const s = String(fr.result || '');
      const comma = s.indexOf(',');
      resolve({
        id: nextId(),
        name: file.name || 'pasted image',
        mediaType: file.type,
        data: comma >= 0 ? s.slice(comma + 1) : s,
        bytes: file.size,
      });
    };
    fr.readAsDataURL(file);
  });
}

export interface DropHandlers {
  /** A folder was dropped — open it as the workspace. */
  onFolder: (path: string) => void;
  onImages: (items: Attached[]) => void;
  onHover: (active: boolean) => void;
  onError: (message: string) => void;
}

/**
 * Native drag-and-drop.
 *
 * Tauri intercepts the OS drop before the webview sees it, so the HTML5
 * `drop` event never fires and this has to come from the window event instead.
 * What arrives is a list of PATHS, not file contents, which is why images are
 * then read through Rust.
 */
export async function listenForDrops(h: DropHandlers): Promise<() => void> {
  const webview = getCurrentWebview();
  return webview.onDragDropEvent(async (event) => {
    const p = event.payload;
    if (p.type === 'over') { h.onHover(true); return; }
    if (p.type === 'leave') { h.onHover(false); return; }
    if (p.type !== 'drop') return;

    h.onHover(false);
    const paths = p.paths || [];
    if (!paths.length) return;

    // A dropped folder is a workspace, and that wins: dropping a project on the
    // window should open it, not try to attach it.
    for (const path of paths) {
      const kind = await invoke<string>('path_kind', { path }).catch(() => 'missing');
      if (kind === 'dir') { h.onFolder(path); return; }
    }

    const images: Attached[] = [];
    const errors: string[] = [];
    for (const path of paths) {
      if (!IMAGE_EXT.test(path)) {
        errors.push(`${path.split(/[/\\]/).pop()}: only images can be attached for now`);
        continue;
      }
      try { images.push(await attachFromPath(path)); }
      catch (e) { errors.push(String(e instanceof Error ? e.message : e)); }
    }
    if (images.length) h.onImages(images);
    if (errors.length) h.onError(errors.join(' · '));
  });
}
