/**
 * Following the links in a video request: a page is read for its words and
 * pictures, a video (or a video on a page) is downloaded as a clip. The
 * network and the downloads are links.rs's (`link_fetch`, `link_bytes`,
 * `clip_download` — none of them in the agent's tool schema); this module
 * decides what to ask for and turns the answers into what a video keeps.
 *
 * Every address here comes from the person's own request (`linksIn`) or from
 * a page that request linked — never from a model's reply.
 */
import { invoke } from '@tauri-apps/api/core';
import type { Clip, LinkSource, Picture } from './videotypes';
import { isVideoLink, linksIn, readPage } from './videolink';

interface LinkFetched { url: string; status: number; contentType: string; html: string }
interface LinkBytes { data: string; mime: string; bytes: number }
interface ClipDownloaded {
  data: string; bytes: number; seconds: number; width: number; height: number; hasAudio: boolean;
  title: string; author: string; sourceUrl: string; site: string; license: string; fullSeconds: number;
}

/** A clip from a video link is at most this long; one found on a page, a little shorter. */
const CLIP_SECONDS = 45;
const PAGE_CLIP_SECONDS = 30;
/** Pictures kept from one page. */
const PAGE_PICTURES = 6;
/** Clips taken from one page's own videos. */
const PAGE_CLIPS = 2;

export interface Gathered { links: LinkSource[]; clips: Clip[]; pictures: Picture[] }

const newId = () => {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};

const sayError = (e: unknown) => (e instanceof Error ? e.message : String(e ?? 'failed')).slice(0, 300);

/** Download one clip. */
export async function downloadClip(url: string, seconds = CLIP_SECONDS, start = 0): Promise<Clip> {
  const r = await invoke<ClipDownloaded>('clip_download', { url, start, seconds });
  let site = r.site;
  if (!site) { try { site = new URL(r.sourceUrl || url).hostname.replace(/^www\./, ''); } catch { site = ''; } }
  return {
    id: newId(),
    src: `data:video/mp4;base64,${r.data}`,
    seconds: r.seconds, width: r.width, height: r.height, hasAudio: r.hasAudio,
    title: r.title, author: r.author, sourceUrl: r.sourceUrl || url, site,
    ...(r.license ? { license: r.license } : {}),
  };
}

/** A picture from a page, fetched as bytes and measured. */
async function pagePicture(url: string, site: string, title: string): Promise<Picture | null> {
  try {
    const r = await invoke<LinkBytes>('link_bytes', { url });
    const src = `data:${r.mime};base64,${r.data}`;
    const size = await new Promise<{ w: number; h: number } | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = src;
    });
    // Too small to fill a scene: an icon or a thumbnail.
    if (!size || size.w < 400 || size.h < 250) return null;
    return { src, credit: `${site} — ${url}`, source: site, query: title, width: size.w, height: size.h };
  } catch {
    return null;
  }
}

/**
 * Every link in a request followed: at most three, one after another, each
 * reported as it goes. A link that fails is kept with its reason — the plan
 * goes on without it.
 */
export async function gatherLinks(request: string, o: { signal?: AbortSignal; onStep?: (link: string, what: 'page' | 'video') => void } = {}): Promise<Gathered> {
  const out: Gathered = { links: [], clips: [], pictures: [] };
  for (const url of linksIn(request)) {
    if (o.signal?.aborted) break;
    const at = Date.now();
    if (isVideoLink(url)) {
      o.onStep?.(url, 'video');
      try {
        const c = await downloadClip(url, CLIP_SECONDS);
        out.clips.push(c);
        out.links.push({ url, kind: 'video', title: c.title, site: c.site, at });
      } catch (e) {
        out.links.push({ url, kind: 'video', title: url, at, error: sayError(e) });
      }
      continue;
    }
    o.onStep?.(url, 'page');
    try {
      const f = await invoke<LinkFetched>('link_fetch', { url });
      if (/^video\//i.test(f.contentType)) {
        const c = await downloadClip(f.url || url, CLIP_SECONDS);
        out.clips.push(c);
        out.links.push({ url, kind: 'video', title: c.title || url, site: c.site, at });
        continue;
      }
      if (f.status >= 400 || !f.html) throw new Error(f.status >= 400 ? `The page answered ${f.status}.` : 'The page had nothing to read.');
      const page = readPage(f.html, f.url || url);
      out.links.push({ url, kind: 'page', title: page.title || url, ...(page.description ? { description: page.description } : {}), ...(page.text ? { text: page.text } : {}), site: page.site, at });
      for (const img of page.images) {
        if (out.pictures.length >= PAGE_PICTURES * (out.links.length)) break;
        const p = await pagePicture(img, page.site, page.title);
        if (p) out.pictures.push(p);
      }
      let taken = 0;
      for (const v of page.videos) {
        if (taken >= PAGE_CLIPS || o.signal?.aborted) break;
        try {
          out.clips.push(await downloadClip(v, PAGE_CLIP_SECONDS));
          taken++;
        } catch { /* a page's video that will not come is left out */ }
      }
    } catch (e) {
      out.links.push({ url, kind: 'page', title: url, at, error: sayError(e) });
    }
  }
  return out;
}
