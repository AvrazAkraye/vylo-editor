/**
 * Turning a `Video` into an MP4 file on the person's disk.
 *
 * ## Two steps, two sides
 *
 * The film is rendered **in this page**, by Remotion's web renderer
 * (`renderMediaOnWeb`): each frame of the app's own composition is drawn to a
 * canvas and encoded with WebCodecs into H.264 in an MP4 container. Nothing is
 * uploaded to render it — the pictures are already data: URLs in the video and
 * the fonts are already loaded. The one request the renderer makes of its own
 * is Remotion's licence telemetry: one event per render, to remotion.pro,
 * carrying the licence key ("free-license", which it sends as none), the page's
 * origin and whether the render succeeded — never a frame, a word or a title.
 * SAFETY.md says so in its network section.
 *
 * The bytes then go to Rust's `export_write_video`, which writes them at the
 * path the OS save panel returned. That command is absent from the model's
 * tool schema (`test/modes.test.mjs` names it); both of its inputs come from
 * the human side — the path from the save panel, the bytes from the render the
 * person started by pressing Export.
 *
 * ## Why the bytes travel as a raw IPC body
 *
 * A thirty-second 1080p film is tens of megabytes. `export_write_docx` sends
 * base64 in JSON, which is fine for a few hundred kilobytes and wasteful here:
 * a third larger, then parsed as a string. Tauri v2's `invoke` takes a
 * `Uint8Array` as the whole request body, delivered to Rust as
 * `InvokeBody::Raw(Vec<u8>)` untouched, with anything else carried in request
 * headers — here the destination path, URI-encoded because a header is ASCII
 * and a path can be Arabic or Kurdish.
 */

import { invoke } from '@tauri-apps/api/core';
import { canRenderMediaOnWeb, renderMediaOnWeb } from '@remotion/web-renderer';
import type { RenderMediaOnWebProgress, WebRendererQuality } from '@remotion/web-renderer';
import { compositionOf, loadVideoFonts } from './VideoScenes';
import { FORMATS } from './videotypes';
import type { Video } from './videotypes';

/** Export quality, as the panel offers it. */
export type ExportQuality = 'high' | 'medium';

/**
 * The web renderer's bitrate presets scale with the frame size, so one name
 * serves all three formats. Motion graphics are flat colour and sharp text,
 * which a low bitrate smears first; "medium" is still clean at 1080p, "high"
 * is for a file that will be recompressed by a platform on upload.
 */
const BITRATE: Readonly<Record<ExportQuality, WebRendererQuality>> = {
  high: 'high',
  medium: 'medium',
};

/**
 * The licence this project renders under. Remotion's free licence asks for
 * exactly this string; passing nothing renders the same but logs a warning on
 * every export. Either way the renderer sends its one telemetry event.
 */
const LICENSE_KEY = 'free-license';

/**
 * Whether this webview can encode the video at all: WebCodecs, an H.264
 * encoder at this frame size. WebKit gained what the renderer needs in
 * Safari 26, so an older macOS answers no here rather than failing halfway
 * through an export. `why` is the renderer's own message, in English — the
 * panel shows its own words and may show this under them.
 */
export async function canExport(v: Video): Promise<{ ok: boolean; why?: string }> {
  const size = FORMATS[v.format] ?? FORMATS.landscape;
  try {
    const r = await canRenderMediaOnWeb({
      container: 'mp4',
      videoCodec: 'h264',
      width: size.width,
      height: size.height,
      muted: true,
      videoBitrate: BITRATE.high,
    });
    if (r.canRender) return { ok: true };
    const errors = r.issues.filter((i) => i.severity === 'error');
    const why = (errors.length ? errors : r.issues).map((i) => i.message).join(' ');
    return { ok: false, why: why || 'This window cannot encode H.264 video.' };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) };
  }
}

function abortError(): Error {
  // What `fetch` throws on abort, so callers can test `name === 'AbortError'`
  // for every cancellation in the app the same way.
  return typeof DOMException === 'function'
    ? new DOMException('The export was cancelled.', 'AbortError')
    : Object.assign(new Error('The export was cancelled.'), { name: 'AbortError' });
}

/**
 * Render the whole film to MP4 bytes.
 *
 * Fonts are loaded first: a frame drawn before its font has arrived is drawn
 * in a fallback, and a video cannot be re-flowed afterwards. `onProgress`
 * gets the renderer's overall fraction (0..1, rendering and encoding weighted
 * together) and, once a few frames have been timed, the milliseconds it
 * estimates are left. Aborting `signal` stops between frames and rejects with
 * an `AbortError`. Silent: the video has no sound, so no audio track is made.
 */
export async function renderVideo(
  v: Video,
  o: { signal?: AbortSignal; onProgress?: (fraction: number, etaMs?: number) => void; quality?: ExportQuality } = {},
): Promise<Uint8Array> {
  const { signal, onProgress } = o;
  if (signal?.aborted) throw abortError();
  await loadVideoFonts(v);
  if (signal?.aborted) throw abortError();

  const c = compositionOf(v);
  onProgress?.(0);
  let result;
  try {
    result = await renderMediaOnWeb({
      composition: {
        id: c.id,
        component: c.component,
        durationInFrames: c.durationInFrames,
        fps: c.fps,
        width: c.width,
        height: c.height,
        // Required by the type when the component has props; the render uses
        // `inputProps` below, which are the same video.
        defaultProps: c.inputProps,
      },
      inputProps: c.inputProps,
      container: 'mp4',
      videoCodec: 'h264',
      videoBitrate: BITRATE[o.quality ?? 'high'] ?? BITRATE.high,
      muted: true,
      signal: signal ?? null,
      licenseKey: LICENSE_KEY,
      // Frees the event loop between frames so the panel's progress bar and
      // Cancel button stay live; the default, named so it is a choice.
      pageResponsiveness: 'medium',
      // Pictures are data: URLs and fonts are loaded above, so a frame that
      // is still not ready after a minute is a bug, not a slow network.
      delayRenderTimeoutInMilliseconds: 60_000,
      onProgress: onProgress
        ? (p: RenderMediaOnWebProgress) => {
          const fraction = Math.min(1, Math.max(0, Number.isFinite(p.progress) ? p.progress : 0));
          const eta = p.renderEstimatedTime > 0 && Number.isFinite(p.renderEstimatedTime) ? p.renderEstimatedTime : undefined;
          onProgress(fraction, eta);
        }
        : null,
    });
  } catch (e) {
    if (signal?.aborted) throw abortError();
    throw e;
  }
  if (signal?.aborted) throw abortError();
  const blob = await result.getBlob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  onProgress?.(1, 0);
  return bytes;
}

/** Names Windows keeps for devices, which no file may have. */
const DEVICE = /^(?:con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * A name for the saved file, from the title: `researchdocx.ts`'s
 * `fileNameFor` rule. Its letters in whatever script they are in — Arabic,
 * Sorani's ڕ ڵ ێ ۆ ە, Badini's ڤ — its digits, spaces, `-`, `_` and the
 * zero-width non-joiner Persian-script words need, and nothing a file system
 * could read as a path or refuse: no `/ \ : * ? " < > |`, no control
 * characters, no other punctuation. At most eighty characters with the
 * extension, cut where a word ends. `video.mp4` when the title leaves nothing.
 */
export function videoFileName(v: Video): string {
  const title = (typeof v?.title === 'string' ? v.title : '').normalize('NFC');
  const kept = title.replace(/[^\p{L}\p{M}\p{N}\u200C _-]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const max = 80 - '.mp4'.length;
  const chars = Array.from(kept);
  let base = kept;
  if (chars.length > max) {
    const head = chars.slice(0, max + 1).join('');
    const at = head.lastIndexOf(' ');
    base = (at > 0 ? head.slice(0, at) : chars.slice(0, max).join('')).trim();
  }
  if (!base) return 'video.mp4';
  return `${DEVICE.test(base) ? `${base}_` : base}.mp4`;
}

/**
 * Write the rendered MP4 at `path`, which must be what the OS save panel
 * returned. Rust refuses anything that is not an absolute `.mp4` path in an
 * existing folder, or bytes that are not an MP4 (`ftyp` at offset 4), or more
 * than 1 GiB; the refusal comes back as the rejection's message.
 */
export async function writeVideoFile(path: string, bytes: Uint8Array): Promise<void> {
  await invoke('export_write_video', bytes, { headers: { 'x-path': encodeURIComponent(path) } });
}
