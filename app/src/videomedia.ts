/**
 * Pictures for the Video module: openly licensed images, found and fetched.
 *
 * The model suggests a few English words per scene (`imageQuery`); this file
 * turns them into a picture the film can carry with it — a JPEG data: URL,
 * fetched once, so rendering never touches the network — and the credit line
 * the licence asks for.
 *
 * ## Where the pictures come from
 *
 * Openverse (`api.openverse.org/v1/images/`) first: one index over Flickr,
 * Wikimedia Commons and a few dozen museums and photo libraries, searchable by
 * licence, aspect ratio and maturity, no key. Anonymous callers get 20 requests
 * a minute and 200 a day (its `x-ratelimit-*` headers say so), and a page of at
 * most 20 results. When it has nothing usable, or refuses (a 429), the
 * Wikimedia Commons API is asked instead: a search in the File namespace with
 * each file's size, URL and licence metadata in the same answer.
 *
 * Both answer with `access-control-allow-origin: *`, and so do the image hosts
 * the pictures come from (upload.wikimedia.org, thumb.wikimedia.org,
 * live.staticflickr.com, images.rawpixel.com, pd.w.org, iNaturalist's bucket,
 * Wellcome's IIIF server, and Openverse's own thumbnail proxy). A few sources do
 * not (StockSnap's CDN, Geograph, the Met): they are excluded from the search
 * or ranked last, and if their bytes cannot be read the Openverse thumbnail is
 * the fallback. No request carries a header, so none needs a preflight, and the
 * bytes go fetch → Blob → createImageBitmap → canvas, which a CORS-clean
 * response never taints.
 *
 * ## Only licences that allow reuse
 *
 * CC0, the Public Domain Mark (Commons' "Public domain"), CC BY and CC BY-SA —
 * any version. NonCommercial, NoDerivatives, GFDL-only, "copyrighted free use"
 * and anything unrecognised are dropped: a video is a derivative and it may
 * well be commercial. The credit line is "Title — Creator, LICENSE (where)".
 *
 * ## Being a good guest
 *
 * One search per scene (a query two scenes share is searched once), a second
 * index only when the first had nothing, requests one at a time, a time limit
 * on each, and a stop that stops. One scene's failure never fails the others.
 */

import type { Format, Picture, Scene } from './videotypes';

/** One picture a search found, before its bytes are fetched. */
export interface Candidate {
  /** A small preview, for the change-picture grid. */
  thumb: string;
  /** The image itself (fetchPicture picks a size near the frame from it). */
  url: string;
  title: string;
  /** "Title — Creator, LICENSE (where)". */
  credit: string;
  /** The page the picture lives on, for the credits. */
  source: string;
  /** e.g. "CC BY-SA 4.0", "CC0 1.0", "Public domain". */
  license: string;
  width?: number;
  height?: number;
}

/** One GET: the URL and an abort signal, never an init object — so never a header. */
export type Get = (url: string, signal?: AbortSignal) => Promise<Response>;

/** What `encode` makes of an image's bytes. */
export interface Encoded { src: string; width: number; height: number }
export type Encode = (blob: Blob, maxSide: number) => Promise<Encoded>;

const OPENVERSE = 'https://api.openverse.org/v1/images/';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';

/** Openverse's own licence codes that allow reuse in a video. */
export const OPENVERSE_LICENSES = 'cc0,pdm,by,by-sa';

/**
 * Sources left out of every Openverse search: hosts that refuse cross-origin
 * reads of the full image (StockSnap, Geograph), drawings and 3D renders that
 * make poor backdrops (SVG silhouettes, Sketchfab, Thingiverse).
 */
export const EXCLUDED_SOURCES = 'stocksnap,geographorguk,svgsilh,sketchfab,thingiverse';

/** The anonymous page limit (a bigger page_size is a 400). */
const MAX_PAGE = 20;

/** Below this on the long edge, a picture is a last resort for a 1080p frame. */
export const SMALL_SIDE = 1000;

export const DEFAULT_MAX_SIDE = 1920;
const JPEG_QUALITY = 0.86;
const SEARCH_TIMEOUT_MS = 15_000;
const IMAGE_TIMEOUT_MS = 30_000;
/** Bytes past this are not decoded: a 15000-pixel original would stall the page. */
const MAX_BYTES = 40 * 1024 * 1024;

/** Hosts measured to send `access-control-allow-origin: *` on the image bytes. */
const CORS_HOSTS = [
  /^upload\.wikimedia\.org$/, /^thumb\.wikimedia\.org$/, /(^|\.)staticflickr\.com$/,
  /^images\.rawpixel\.com$/, /^pd\.w\.org$/, /^inaturalist-open-data\.s3\.amazonaws\.com$/,
  /^iiif\.wellcomecollection\.org$/, /^api\.openverse\.org$/,
];

/** Titles no promotional video should open on, whatever the index's own flag says. */
const UNSAFE = /\b(nude|nudes|nudity|naked|nsfw|porn\w*|erotic\w*|sex|sexy|sexual|topless|lingerie|fetish|gore|corpse|autopsy)\b/i;

// ── small helpers ─────────────────────────────────────────────────────────

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Text from a scrap of HTML: tags gone, entities decoded, whitespace collapsed. */
export function stripHtml(html: string): string {
  return str(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (k.startsWith('#x')) return safeChar(parseInt(k.slice(2), 16), m);
      if (k.startsWith('#')) return safeChar(parseInt(k.slice(1), 10), m);
      return ENTITIES[k] ?? m;
    })
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeChar(code: number, fallback: string): string {
  try { return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : fallback; } catch { return fallback; }
}

function cap(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:–—-]+$/, '') + '…';
}

/**
 * The words a search is sent with: letters, digits, spaces and inner hyphens;
 * no quotes, operators or markup; at most eight words and 60 characters.
 */
export function cleanQuery(q: unknown): string {
  const words = str(q)
    .normalize('NFC')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .slice(0, 8);
  let out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > 60) break;
    out = next;
  }
  return out;
}

// ── URLs ──────────────────────────────────────────────────────────────────

const enc = (s: string) => encodeURIComponent(s);

/** An Openverse search: reusable licences only, no mature results, the frame's aspect when it has one. */
export function openverseUrl(query: string, pageSize: number, format?: Format): string {
  const n = Math.max(1, Math.min(MAX_PAGE, Math.floor(Number(pageSize)) || 1));
  const aspect = format === 'landscape' ? '&aspect_ratio=wide' : format === 'portrait' ? '&aspect_ratio=tall' : '';
  return `${OPENVERSE}?q=${enc(cleanQuery(query))}&license=${OPENVERSE_LICENSES}&page_size=${n}`
    + `&mature=false&excluded_source=${EXCLUDED_SOURCES}${aspect}`;
}

/** A Commons search: files only, bitmaps only, with size, URLs and licence metadata in the same answer. */
export function commonsUrl(query: string, limit: number): string {
  const n = Math.max(1, Math.min(MAX_PAGE, Math.floor(Number(limit)) || 1));
  return `${COMMONS}?action=query&format=json&formatversion=2&origin=*`
    + `&generator=search&gsrnamespace=6&gsrsearch=${enc(`${cleanQuery(query)} filetype:bitmap`)}&gsrlimit=${n}`
    + `&prop=imageinfo&iiprop=${enc('url|size|mime|extmetadata')}&iiurlwidth=330`
    + `&iiextmetadatafilter=${enc('ObjectName|Artist|LicenseShortName|License|UsageTerms')}`;
}

// ── licences ──────────────────────────────────────────────────────────────

const VERSION = /^\d+(\.\d+)?$/;

/** An Openverse licence code and version as people write it — or null when it does not allow reuse. */
export function openverseLicense(code: unknown, version: unknown): string | null {
  const c = str(code).toLowerCase().trim();
  const v = str(version).trim();
  const ver = VERSION.test(v) ? ` ${v}` : '';
  switch (c) {
    case 'cc0': return `CC0${ver}`;
    case 'pdm': return `Public Domain Mark${ver}`;
    case 'by': return `CC BY${ver}`;
    case 'by-sa': return `CC BY-SA${ver}`;
    default: return null;
  }
}

/**
 * A Commons licence as people write it — or null when it does not allow reuse.
 * `License` is Commons' normalised code (cc-by-sa-4.0, cc0, pd); the short name
 * ("CC BY-SA 3.0 de", "Public domain") is what is shown.
 */
export function commonsLicense(code: unknown, shortName: unknown): string | null {
  const c = stripHtml(str(code)).toLowerCase();
  const name = stripHtml(str(shortName));
  const n = name.toLowerCase();
  if (/\b(nc|nd)\b|noncommercial|non-commercial|noderiv/.test(c) || /\b(nc|nd)\b|noncommercial|non-commercial|noderiv/.test(n)) return null;
  const ok = (c && (/^cc0\b/.test(c) || /^pd(\b|-)/.test(c) || /^cc-by(-sa)?-\d/.test(c)))
    || (!c && (/^cc0\b/.test(n) || /^public domain$/.test(n) || /^cc by(-sa)? \d/.test(n)));
  if (!ok) return null;
  if (name && name.length <= 40 && /^(cc0|public domain|cc by(-sa)? \d)/i.test(name)) return name;
  if (/^cc0/.test(c)) return 'CC0';
  if (/^pd/.test(c)) return 'Public domain';
  const m = /^cc-by(-sa)?-(\d+(?:\.\d+)?)/.exec(c);
  return m ? `CC BY${m[1] ? '-SA' : ''} ${m[2]}` : null;
}

// ── parsing ───────────────────────────────────────────────────────────────

/** Where an Openverse picture came from, by its `source` code. */
const SOURCE_NAMES: Record<string, string> = {
  flickr: 'Flickr', wikimedia: 'Wikimedia Commons', rawpixel: 'rawpixel', wordpress: 'WordPress Photo Directory',
  nasa: 'NASA', inaturalist: 'iNaturalist', europeana: 'Europeana', met: 'The Met', smithsonian: 'Smithsonian',
  wellcome_collection: 'Wellcome Collection', rijksmuseum: 'Rijksmuseum', brooklynmuseum: 'Brooklyn Museum',
  clevelandmuseum: 'Cleveland Museum of Art', sciencemuseum: 'Science Museum', museumsvictoria: 'Museums Victoria',
};

function sourceName(code: string): string {
  if (SOURCE_NAMES[code]) return SOURCE_NAMES[code];
  if (code.startsWith('smithsonian')) return 'Smithsonian';
  return code.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()) || 'Openverse';
}

/** A title fit for a credit line: text only, no file extension, not too long. */
function cleanTitle(t: string): string {
  const s = stripHtml(t).replace(/^File:/i, '').replace(/\.(jpe?g|png|gif|webp|tiff?)$/i, '').replace(/_/g, ' ').trim();
  return cap(s || 'Untitled', 100);
}

/** "Title — Creator, LICENSE (where)", without the parts that are missing. */
export function creditLine(title: string, creator: string, license: string, where: string): string {
  const who = creator ? ` — ${creator}` : '';
  return `${title}${who}, ${license} (${where})`;
}

const BITMAP_EXT = /\.(jpe?g|png|gif|webp)$/i;

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function isHttps(url: string): boolean {
  return /^https:\/\//i.test(url) && hostOf(url) !== '';
}

/** The candidates an Openverse answer holds: reusable, not mature, pictures with a URL. */
export function fromOpenverse(json: unknown): Candidate[] {
  const results = (json as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const out: Candidate[] = [];
  for (const r of results as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue;
    const url = str(r.url);
    if (!isHttps(url)) continue;
    if (r.mature === true) continue;
    if (Array.isArray(r.unstable__sensitivity) && r.unstable__sensitivity.length) continue;
    const ft = str(r.filetype).toLowerCase();
    if (/svg|tif|pdf/.test(ft) || /\.(svg|tiff?|pdf)$/i.test(new URL(url).pathname)) continue;
    const license = openverseLicense(r.license, r.license_version);
    if (!license) continue;
    const title = cleanTitle(str(r.title));
    if (UNSAFE.test(title)) continue;
    const creator = cap(stripHtml(str(r.creator)), 80);
    const code = str(r.source) || str(r.provider);
    const where = code === 'wikimedia' ? 'Wikimedia Commons via Openverse' : `${sourceName(code)} via Openverse`;
    const landing = str(r.foreign_landing_url);
    const thumb = str(r.thumbnail);
    out.push({
      thumb: isHttps(thumb) ? thumb : url,
      url,
      title,
      credit: creditLine(title, creator, license, where),
      source: isHttps(landing) ? landing : url,
      license,
      width: num(r.width),
      height: num(r.height),
    });
  }
  return out;
}

/**
 * A Commons `Artist` field as a name: its HTML stripped, and the asides some
 * uploaders add — "[user: …, mail: …]", "(talk)", an "Original:" label, an
 * address — left out.
 */
export function commonsArtist(html: string): string {
  const t = stripHtml(html)
    .replace(/\[[^\]]*\]|\((talk|contribs?)\)/gi, ' ')
    .replace(/^(original|author|photo(graph)?(er)?|by)\s*:\s*/i, '')
    .replace(/\S+@\S+|\S+\s+at\s+\S+\.(com|org|net)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '');
  return cap(t, 80);
}

/** A Commons URL without the tracking query the API adds to it. */
function bare(url: string): string {
  return url.replace(/[?#].*$/, '');
}

/** The candidates a Commons answer holds, in the search's own order. */
export function fromCommons(json: unknown): Candidate[] {
  const pages = (json as { query?: { pages?: unknown } })?.query?.pages;
  const list: Record<string, unknown>[] = Array.isArray(pages)
    ? pages as Record<string, unknown>[]
    : pages && typeof pages === 'object' ? Object.values(pages as Record<string, Record<string, unknown>>) : [];
  const ordered = list
    .filter((p) => p && typeof p === 'object')
    .map((p, i) => ({ p, at: typeof p.index === 'number' ? p.index : 1e6 + i }))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.p);
  const out: Candidate[] = [];
  for (const p of ordered) {
    const info = (Array.isArray(p.imageinfo) ? p.imageinfo[0] : null) as Record<string, unknown> | null;
    if (!info) continue;
    const mime = str(info.mime).toLowerCase();
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) continue;
    const url = bare(str(info.url));
    if (!isHttps(url)) continue;
    const meta = (info.extmetadata ?? {}) as Record<string, { value?: unknown } | undefined>;
    const val = (k: string) => str(meta[k]?.value);
    const license = commonsLicense(val('License'), val('LicenseShortName'));
    if (!license) continue;
    const title = cleanTitle(val('ObjectName') || str(p.title));
    if (UNSAFE.test(title) || UNSAFE.test(str(p.title))) continue;
    const creator = commonsArtist(val('Artist'));
    const width = num(info.width), height = num(info.height);
    const landing = str(info.descriptionurl);
    const thumbUrl = str(info.thumburl);
    out.push({
      thumb: isHttps(thumbUrl) ? bare(thumbUrl) : wikimediaSized(url, width, height, 330) ?? url,
      url,
      title,
      credit: creditLine(title, creator, license, 'Wikimedia Commons'),
      source: isHttps(landing) ? landing : url,
      license,
      width,
      height,
    });
  }
  return out;
}

// ── sizes ─────────────────────────────────────────────────────────────────

/**
 * The widths Wikimedia renders thumbnails at. Any other width is a 400
 * (measured: 1080px- is refused, 1280px- and 1920px- are served).
 */
const WIKIMEDIA_WIDTHS = [250, 330, 500, 960, 1280, 1920, 3840];

/**
 * A Wikimedia original's URL, as a thumbnail whose long edge is at least
 * `side` — or null when the original is already that small, or it is not a
 * plain Commons original.
 */
export function wikimediaSized(url: string, width: number | undefined, height: number | undefined, side: number): string | null {
  if (!width || !height) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/^(upload|thumb)\.wikimedia\.org$/.test(u.hostname)) return null;
  const m = /^\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^/]+)$/.exec(u.pathname);
  if (!m || !BITMAP_EXT.test(m[3])) return null;
  const need = Math.ceil(side * width / Math.max(width, height));
  const w = WIKIMEDIA_WIDTHS.find((x) => x >= need);
  if (!w || w >= width) return null;
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${m[1]}/${m[2]}/${m[3]}/${w}px-${m[3]}`;
}

/** The size a picture is drawn at: the long edge at most `maxSide`, never enlarged. */
export function scaledSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  const k = Math.min(1, Math.max(1, Math.round(maxSide)) / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

// ── ranking ───────────────────────────────────────────────────────────────

/** How well a picture's shape fits a frame: 0 fits, bigger fits worse. */
function aspectMiss(width: number, height: number, format: Format): number {
  const r = width / height;
  if (format === 'landscape') return r >= 1.2 ? 0 : r >= 0.95 ? 3 : 6;
  if (format === 'portrait') return r <= 0.85 ? 0 : r <= 1.05 ? 3 : 6;
  return r >= 0.75 && r <= 1.34 ? 0 : 2;
}

/**
 * The candidates in the order worth trying. The index's relevance order is the
 * main key; a picture that is the wrong shape for the frame, from a host whose
 * bytes may not be readable, or of unknown size gives up a few places; one
 * smaller than SMALL_SIDE on its long edge goes after every larger one.
 */
export function rank(cands: readonly Candidate[], format?: Format): Candidate[] {
  const score = (c: Candidate, i: number) => {
    let s = i;
    if (c.width && c.height) {
      if (Math.max(c.width, c.height) < SMALL_SIDE) s += 1000;
      if (format) s += aspectMiss(c.width, c.height, format);
    } else s += 4;
    const host = hostOf(c.url);
    if (!CORS_HOSTS.some((re) => re.test(host))) s += 8;
    return s;
  };
  return cands.map((c, i) => ({ c, s: score(c, i), i })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.c);
}

function isSmall(c: Candidate): boolean {
  return !!c.width && !!c.height && Math.max(c.width, c.height) < SMALL_SIDE;
}

/** The same picture however it was found: its page, its file, or a title of three words or more. */
function keysOf(c: Pick<Candidate, 'url' | 'source' | 'title'>): string[] {
  const keys = [`u:${bare(c.url)}`, `s:${c.source}`];
  const words = c.title.toLowerCase().replace(/[^\p{L}\s]+/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length >= 3) keys.push(`t:${words.join(' ')}`);
  return keys;
}

// ── requests ──────────────────────────────────────────────────────────────

const defaultGet: Get = (url, signal) => fetch(url, { signal });

function abortError(signal?: AbortSignal): Error {
  const r = signal?.reason;
  if (r && typeof r === 'object' && (r as { name?: unknown }).name === 'AbortError') return r as Error;
  const e = new Error('Stopped.');
  e.name = 'AbortError';
  return e;
}

function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

/**
 * `run` with its own signal, stopped by the caller's signal (an AbortError) or
 * after `ms` (a TimeoutError). Settles when either happens even if `run`
 * ignores its signal.
 */
async function within<T>(ms: number, signal: AbortSignal | undefined, run: (s: AbortSignal) => Promise<T>): Promise<T> {
  if (signal?.aborted) throw abortError(signal);
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stop = new Promise<never>((_, reject) => {
    onAbort = () => { ctrl.abort(); reject(abortError(signal)); };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      const e = new Error('The request took too long.');
      e.name = 'TimeoutError';
      ctrl.abort();
      reject(e);
    }, ms);
  });
  stop.catch(() => { /* handled by the race */ });
  try {
    return await Promise.race([run(ctrl.signal), stop]);
  } catch (e) {
    if (signal?.aborted) throw abortError(signal);
    throw e;
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

/** JSON from a URL, or null for any failure but being stopped. */
async function getJson(get: Get, url: string, signal: AbortSignal | undefined, ms: number): Promise<unknown | null> {
  try {
    return await within(ms, signal, async (s) => {
      const r = await get(url, s);
      if (!r.ok) return null;
      return await r.json();
    });
  } catch (e) {
    if (signal?.aborted || isAbort(e)) throw abortError(signal);
    return null;
  }
}

// ── the exports the panel uses ────────────────────────────────────────────

/**
 * Pictures for a few English words: Openverse first, Commons when Openverse
 * has nothing of a usable size or does not answer. At most `count` (default
 * 12), best first. Empty when nothing reusable was found; throws only when
 * stopped, or when neither index answered at all.
 */
export async function searchPictures(
  query: string,
  o: { count?: number; format?: Format; signal?: AbortSignal; get?: Get; timeout?: number } = {},
): Promise<Candidate[]> {
  const q = cleanQuery(query);
  if (o.signal?.aborted) throw abortError(o.signal);
  if (!q) return [];
  const get = o.get ?? defaultGet;
  const count = Math.max(1, Math.min(MAX_PAGE, Math.floor(Number(o.count ?? 12)) || 12));
  const page = Math.min(MAX_PAGE, Math.max(8, count + 4));
  const ms = o.timeout ?? SEARCH_TIMEOUT_MS;

  const ov = await getJson(get, openverseUrl(q, page, o.format), o.signal, ms);
  const fromOv = ov === null ? [] : fromOpenverse(ov);
  if (fromOv.some((c) => !isSmall(c))) return diversify(rank(fromOv, o.format)).slice(0, count);

  const wm = await getJson(get, commonsUrl(q, page), o.signal, ms);
  if (ov === null && wm === null) throw new Error('No picture index answered.');
  const seen = new Set<string>();
  const all: Candidate[] = [];
  for (const c of [...(wm === null ? [] : fromCommons(wm)), ...fromOv]) {
    const k = keysOf(c);
    if (k.some((x) => seen.has(x))) continue;
    k.forEach((x) => seen.add(x));
    all.push(c);
  }
  return diversify(rank(all, o.format)).slice(0, count);
}

/**
 * A photographer's series often shares one title ("Pearly Whites Dental
 * Clinic" five times, measured): the first of each title keeps its place, the
 * repeats go after every other picture, so the grid offers a real choice.
 */
function diversify(cands: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const first: Candidate[] = [], again: Candidate[] = [];
  for (const c of cands) {
    const k = c.title.toLowerCase().replace(/[^\p{L}]+/gu, ' ').trim();
    (k && seen.has(k) ? again : first).push(c);
    if (k) seen.add(k);
  }
  return [...first, ...again];
}

/**
 * The browser's way from bytes to a JPEG data: URL no bigger than `maxSide` on
 * its long edge: createImageBitmap, a canvas (OffscreenCanvas where there is
 * one), JPEG at 0.86 on white (a transparent PNG would otherwise go black).
 */
export async function encodeJpeg(blob: Blob, maxSide: number): Promise<Encoded> {
  const bmp = await createImageBitmap(blob);
  try {
    const { width, height } = scaledSize(bmp.width, bmp.height, maxSide);
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No 2D canvas.');
      paint(ctx, bmp, width, height);
      const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
      return { src: await dataUrlOf(out), width, height };
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas.');
    paint(ctx, bmp, width, height);
    return { src: canvas.toDataURL('image/jpeg', JPEG_QUALITY), width, height };
  } finally {
    bmp.close();
  }
}

function paint(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, bmp: ImageBitmap, width: number, height: number) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, width, height);
}

function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read the picture.'));
    r.readAsDataURL(blob);
  });
}

/**
 * The URLs to try for a candidate, best first: a Wikimedia thumbnail near
 * `maxSide` when the original is bigger, the image itself, and the index's
 * small thumbnail as the last resort.
 */
export function picturesToTry(c: Candidate, maxSide: number): string[] {
  const urls = [wikimediaSized(c.url, c.width, c.height, maxSide), c.url, c.thumb];
  return [...new Set(urls.filter((u): u is string => !!u && isHttps(u)))];
}

/**
 * A candidate's bytes, as a JPEG data: URL no bigger than `maxSide` (default
 * 1920) on its long edge, with its credit. Throws when no URL gave a picture,
 * or when stopped.
 */
export async function fetchPicture(
  c: Candidate,
  query: string,
  o: { signal?: AbortSignal; get?: Get; maxSide?: number; encode?: Encode; timeout?: number } = {},
): Promise<Picture> {
  const get = o.get ?? defaultGet;
  const maxSide = Math.max(64, Math.round(o.maxSide ?? DEFAULT_MAX_SIDE));
  const encode = o.encode ?? encodeJpeg;
  const ms = o.timeout ?? IMAGE_TIMEOUT_MS;
  let last: unknown = null;
  for (const url of picturesToTry(c, maxSide)) {
    if (o.signal?.aborted) throw abortError(o.signal);
    try {
      const out = await within(ms, o.signal, async (s) => {
        const r = await get(url, s);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const type = (r.headers?.get?.('content-type') ?? '').toLowerCase();
        if (type && !type.startsWith('image/')) throw new Error(`Not an image: ${type}`);
        const size = Number(r.headers?.get?.('content-length') ?? 0);
        if (size > MAX_BYTES) throw new Error('Too big.');
        const blob = await r.blob();
        if (!blob.size || blob.size > MAX_BYTES) throw new Error('Empty or too big.');
        if (blob.type && !blob.type.toLowerCase().startsWith('image/')) throw new Error(`Not an image: ${blob.type}`);
        return encode(blob, maxSide);
      });
      if (!out || !/^data:image\//.test(out.src)) throw new Error('No picture.');
      return {
        src: out.src,
        credit: c.credit,
        source: c.source,
        query: cleanQuery(query) || query,
        width: out.width,
        height: out.height,
      };
    } catch (e) {
      if (o.signal?.aborted || isAbort(e)) throw abortError(o.signal);
      last = e;
    }
  }
  throw new Error(`Could not fetch the picture${last instanceof Error ? `: ${last.message}` : '.'}`);
}

/** Candidates tried per scene before it is left without a picture. */
const TRIES_PER_SCENE = 3;

/**
 * Pictures for every scene that asks for one (an `imageQuery` and no
 * `picture`), one scene at a time. Each finished scene — with its picture, or
 * unchanged when its search or fetch failed — is reported through `onScene`
 * as it happens; the new list is returned at the end. No picture is used
 * twice, counting the ones scenes already had. Stopping throws an AbortError;
 * the scenes reported until then keep their pictures.
 */
export async function fillPictures(
  scenes: Scene[],
  o: { format?: Format; signal?: AbortSignal; get?: Get; onScene?: (index: number, scene: Scene) => void; encode?: Encode; maxSide?: number; timeout?: number } = {},
): Promise<Scene[]> {
  const out = scenes.slice();
  const used = new Set<string>();
  for (const s of scenes) {
    if (s.picture) keysOf({ url: s.picture.source, source: s.picture.source, title: '' }).forEach((k) => used.add(k));
  }
  const searched = new Map<string, Candidate[] | null>();
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    if (o.signal?.aborted) throw abortError(o.signal);
    if (s.picture) continue;
    const q = cleanQuery(s.imageQuery);
    if (!q) continue;
    let found: Candidate[] | null;
    if (searched.has(q.toLowerCase())) found = searched.get(q.toLowerCase()) ?? null;
    else {
      try {
        found = await searchPictures(q, { count: 10, format: o.format, signal: o.signal, get: o.get, timeout: o.timeout });
      } catch (e) {
        if (o.signal?.aborted || isAbort(e)) throw abortError(o.signal);
        found = null;
      }
      searched.set(q.toLowerCase(), found);
    }
    let next: Scene = s;
    let tries = 0;
    for (const c of found ?? []) {
      if (tries >= TRIES_PER_SCENE) break;
      const keys = keysOf(c);
      if (keys.some((k) => used.has(k))) continue;
      tries += 1;
      try {
        const picture = await fetchPicture(c, q, { signal: o.signal, get: o.get, encode: o.encode, maxSide: o.maxSide, timeout: o.timeout });
        keys.forEach((k) => used.add(k));
        next = { ...s, picture };
        break;
      } catch (e) {
        if (o.signal?.aborted || isAbort(e)) throw abortError(o.signal);
      }
    }
    out[i] = next;
    try { o.onScene?.(i, next); } catch { /* the panel's problem, not the next scene's */ }
  }
  return out;
}

/** The pictures' credit lines, each once, in the order the scenes show them. */
export function creditsOf(scenes: Scene[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of Array.isArray(scenes) ? scenes : []) {
    const line = str(s?.picture?.credit).trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}
