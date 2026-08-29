import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { ImageBlock } from './agent';

/**
 * Something the user attached to their next message.
 *
 * Two shapes, because they reach the model by different routes: an image
 * becomes a real `image` content block, while a text file is folded into the
 * prompt with a header saying where it came from. Keeping them one union means
 * the composer, the tray and the transcript each handle attachments once.
 */
export type Attached = AttachedImage | AttachedText;

export interface AttachedImage {
  kind: 'image';
  id: string;
  name: string;
  mediaType: string;
  data: string; // base64, no data: prefix
  bytes: number;
}

export interface AttachedText {
  kind: 'text';
  id: string;
  name: string;
  text: string;
  bytes: number;
  truncated: boolean;
}

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

export const isImage = (a: Attached): a is AttachedImage => a.kind === 'image';
export const isText = (a: Attached): a is AttachedText => a.kind === 'text';

let seq = 0;
const nextId = () => `att_${Date.now()}_${seq++}`;

export function toImageBlock(a: AttachedImage): ImageBlock {
  return { type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } };
}

export function previewUrl(a: AttachedImage): string {
  return `data:${a.mediaType};base64,${a.data}`;
}

/** How an attached text file is introduced to the model. */
export function textBlock(a: AttachedText): string {
  const note = a.truncated ? ' (first 256 KB)' : '';
  return `[Attached file: ${a.name}${note}]\n${a.text}\n[End of ${a.name}]`;
}

export function describe(a: Attached): string {
  const kb = a.bytes < 1024 ? `${a.bytes} B` : `${Math.round(a.bytes / 1024)} KB`;
  return `${a.name} · ${kb}`;
}

/** Read an image the user dropped or picked, by path, through the Rust side. */
export async function attachFromPath(path: string): Promise<Attached> {
  const r = await invoke<{ media_type: string; data: string; name: string; bytes: number }>('read_image', { path });
  return { kind: 'image', id: nextId(), name: r.name, mediaType: r.media_type, data: r.data, bytes: r.bytes };
}

/** Read a text file the user dropped or picked. Rust refuses binaries. */
export async function attachTextFromPath(path: string): Promise<Attached> {
  const r = await invoke<{ name: string; text: string; bytes: number; truncated: boolean }>(
    'read_text_attachment', { path },
  );
  return { kind: 'text', id: nextId(), name: r.name, text: r.text, bytes: r.bytes, truncated: r.truncated };
}

/** One path, routed by what it looks like. */
export function attachAnyPath(path: string): Promise<Attached> {
  return IMAGE_EXT.test(path) ? attachFromPath(path) : attachTextFromPath(path);
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
        kind: 'image',
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

/**
 * The attach button.
 *
 * Deliberately not filtered to images: "attach" means a file, and a log, a
 * stack trace or a CSV from outside the open folder is exactly the thing the
 * agent cannot reach on its own.
 */
export async function pickAttachments(): Promise<{ items: Attached[]; errors: string[] }> {
  const picked = await open({
    multiple: true,
    directory: false,
    filters: [
      { name: 'Images and text', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'md', 'log', 'json', 'csv', 'yml', 'yaml', 'toml', 'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'rb', 'php', 'sh', 'sql', 'html', 'css', 'xml', 'env', 'ini', 'conf'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
  return collect(paths);
}

/** Read a list of paths, keeping the failures rather than losing the batch. */
export async function collect(paths: string[]): Promise<{ items: Attached[]; errors: string[] }> {
  const items: Attached[] = [];
  const errors: string[] = [];
  for (const path of paths) {
    try { items.push(await attachAnyPath(path)); }
    catch (e) { errors.push(String(e instanceof Error ? e.message : e)); }
  }
  return { items, errors };
}

export interface DropHandlers {
  /** A folder was dropped — open it as the workspace. */
  onFolder: (path: string) => void;
  onAttach: (items: Attached[]) => void;
  onHover: (active: boolean) => void;
  onError: (message: string) => void;
}

/**
 * Native drag-and-drop.
 *
 * Tauri intercepts the OS drop before the webview sees it, so the HTML5
 * `drop` event never fires and this has to come from the window event instead.
 * What arrives is a list of PATHS, not file contents, which is why the files
 * are then read through Rust.
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

    const { items, errors } = await collect(paths);
    if (items.length) h.onAttach(items);
    if (errors.length) h.onError(errors.join(' · '));
  });
}
