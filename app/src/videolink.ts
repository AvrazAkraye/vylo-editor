/**
 * Links in a video request, and what a linked page offers the video.
 *
 * A person can make a video from a link — "make a video from this page",
 * a YouTube link, an Instagram reel. This module is the part that needs no
 * network: finding the links in what they wrote, telling a video link from a
 * page, and reading a page's HTML (fetched by `link_fetch` in links.rs) for
 * its title, description, main words, pictures and videos.
 *
 * Only a link the person wrote, or a video on a page they linked, is ever
 * downloaded — never an address a model produced. `linksIn` reads the
 * request; the plan's reply is never searched for links.
 */

/** At most this many links of one request are followed. */
export const MAX_LINKS = 3;
/** The words of a page the plan is shown, at most. */
export const PAGE_TEXT = 6000;

/** The http(s) links in a text, in order, each once, without the punctuation a sentence puts after them. */
export function linksIn(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text ?? '').matchAll(/\bhttps?:\/\/[^\s<>"'«»“”‘’]+/gi)) {
    let u = m[0];
    // Punctuation a sentence puts after a link is not part of it; a closing bracket is only when the link opened one.
    for (;;) {
      const t = u.replace(/[.,;:!?\]}،؛؟]+$/u, '');
      const open = (t.match(/\(/g) ?? []).length;
      const close = (t.match(/\)/g) ?? []).length;
      const next = t.endsWith(')') && close > open ? t.slice(0, -1) : t;
      if (next === u) break;
      u = next;
    }
    try {
      const url = new URL(u);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      const s = url.toString();
      if (!out.includes(s)) out.push(s);
    } catch { /* not a link after all */ }
  }
  return out.slice(0, MAX_LINKS);
}

/** Hosts whose links are videos yt-dlp knows how to fetch. */
const VIDEO_HOSTS: readonly [RegExp, RegExp | null][] = [
  [/(^|\.)youtube\.com$/, /^\/(watch|shorts\/|live\/|embed\/)/],
  [/(^|\.)youtu\.be$/, null],
  [/(^|\.)instagram\.com$/, /^\/(reel|reels|p|tv)\//],
  [/(^|\.)tiktok\.com$/, /\/video\/|^\/t\//],
  [/(^|\.)vm\.tiktok\.com$/, null],
  [/(^|\.)facebook\.com$/, /\/(videos|reel|watch)\b|^\/watch/],
  [/(^|\.)fb\.watch$/, null],
  [/(^|\.)(x|twitter)\.com$/, /\/status\/\d+/],
  [/(^|\.)vimeo\.com$/, /^\/\d+/],
  [/(^|\.)dailymotion\.com$/, /^\/video\//],
];

/** Whether a link is a video itself (a video site's video page, or a video file) rather than a page to read. */
export function isVideoLink(link: string): boolean {
  let u: URL;
  try { u = new URL(link); } catch { return false; }
  if (/\.(mp4|m4v|mov|webm|mkv|m3u8)$/i.test(u.pathname)) return true;
  const host = u.hostname.toLowerCase();
  return VIDEO_HOSTS.some(([h, path]) => h.test(host) && (!path || path.test(u.pathname)));
}

/** What a page offers: its words, its pictures and its videos. */
export interface PageRead {
  title: string;
  description: string;
  site: string;
  /** The page's readable words, blocks separated by blank lines, at most PAGE_TEXT characters. */
  text: string;
  /** Absolute image addresses, the page's own chosen picture first, each once. */
  images: string[];
  /** Absolute video addresses: files, and video-site links it embeds. */
  videos: string[];
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

/** HTML entities as their characters. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

const clean = (s: string) => decodeEntities(s).replace(/\s+/g, ' ').trim();

/** An attribute of a tag, decoded. */
function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '').trim() : '';
}

/** The content of the first <meta> whose property or name is one of `keys`. */
function meta(html: string, keys: readonly string[]): string {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(m[0], 'property') || attr(m[0], 'name') || attr(m[0], 'itemprop')).toLowerCase();
    if (keys.includes(key)) {
      const v = attr(m[0], 'content');
      if (v) return clean(v);
    }
  }
  return '';
}

function absolute(u: string, base: string): string | null {
  if (!u || u.startsWith('data:') || u.startsWith('javascript:')) return null;
  try {
    const url = new URL(u, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Pictures too small or too decorative to put in a scene. */
const SKIP_IMAGE = /(sprite|icon|logo|avatar|emoji|pixel|spacer|blank|badge|button|tracking|1x1|favicon)/i;

/**
 * A page's HTML read for what a video can use. Reads what the page says about
 * itself first (Open Graph, the title), then its readable blocks — headings,
 * paragraphs, list items — without scripts, styles, navigation, headers,
 * footers and forms.
 */
export function readPage(html: string, base: string): PageRead {
  const h = String(html ?? '');
  const title = meta(h, ['og:title', 'twitter:title']) || clean(h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const description = meta(h, ['og:description', 'description', 'twitter:description']);
  let site = meta(h, ['og:site_name', 'application-name']);
  if (!site) { try { site = new URL(base).hostname.replace(/^www\./, ''); } catch { site = ''; } }

  const images: string[] = [];
  const addImage = (u: string) => {
    const a = absolute(u, base);
    if (a && !images.includes(a) && !SKIP_IMAGE.test(a) && !/\.svg(\?|$)/i.test(a)) images.push(a);
  };
  addImage(meta(h, ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src']));
  for (const m of h.matchAll(/<img\b[^>]*>/gi)) {
    const w = Number(attr(m[0], 'width'));
    if (Number.isFinite(w) && w > 0 && w < 200) continue;
    const srcset = attr(m[0], 'srcset');
    // The largest in a srcset is the one worth having.
    const best = srcset ? srcset.split(',').map((p) => p.trim().split(/\s+/)).sort((a, b) => (parseFloat(b[1] ?? '0') || 0) - (parseFloat(a[1] ?? '0') || 0))[0]?.[0] : '';
    addImage(best || attr(m[0], 'src') || attr(m[0], 'data-src'));
    if (images.length >= 16) break;
  }

  const videos: string[] = [];
  const addVideo = (u: string) => {
    const a = absolute(u, base);
    if (a && !videos.includes(a)) videos.push(a);
  };
  addVideo(meta(h, ['og:video', 'og:video:url', 'og:video:secure_url', 'twitter:player:stream']));
  for (const m of h.matchAll(/<(video|source)\b[^>]*>/gi)) {
    const src = attr(m[0], 'src');
    if (src && (m[1].toLowerCase() === 'video' || /video|mp4|webm/i.test(attr(m[0], 'type') || src))) addVideo(src);
  }
  for (const m of h.matchAll(/<iframe\b[^>]*>/gi)) {
    const src = attr(m[0], 'src');
    const yt = src.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{6,})/i);
    if (yt) addVideo(`https://www.youtube.com/watch?v=${yt[1]}`);
    else if (/player\.vimeo\.com\/video\/(\d+)/i.test(src)) addVideo(`https://vimeo.com/${src.match(/video\/(\d+)/i)![1]}`);
  }

  // The readable words.
  const body = (h.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? h)
    .replace(/<(script|style|noscript|svg|template|iframe|form|nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const blocks: string[] = [];
  for (const m of body.matchAll(/<(h[1-4]|p|li|blockquote|figcaption|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const t = clean(m[2].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+([.,;:!?،؛؟])/gu, '$1');
    if (t.length < 3 || blocks.includes(t)) continue;
    blocks.push(m[1].toLowerCase().startsWith('h') ? `## ${t}` : t);
  }
  let text = '';
  for (const b of blocks) {
    if (text.length + b.length + 2 > PAGE_TEXT) break;
    text += (text ? '\n\n' : '') + b;
  }
  if (!text) text = clean(body.replace(/<[^>]+>/g, ' ')).slice(0, PAGE_TEXT);

  return { title, description, site, text, images: images.slice(0, 12), videos: videos.slice(0, 4) };
}
