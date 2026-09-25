/**
 * A QR code for the 'qr' scene: the address as a scanner will open it, and
 * the grid of dark and light modules that encodes it.
 *
 * The encoding itself is Kazuhiko Arase's qrcode-generator (MIT) — the one
 * dependency the Video module adds, because a QR code that is almost right
 * opens nothing, and that library has been scanned by phones for fifteen
 * years. This file only decides what goes into it: an address a phone opens
 * as a link (a scheme in front, the host in punycode and the path
 * percent-encoded, so every byte is ASCII and no scanner has to guess a text
 * encoding), and how much error correction it carries — more when a logo is
 * laid over its centre, since the logo hides modules the code must rebuild.
 */

import qrcode from 'qrcode-generator';

/**
 * The address a scene's `url` opens, as the QR code carries it, or `null`
 * when it is not a web address. "uod.ac" becomes "https://uod.ac/": without
 * a scheme a phone shows the words instead of opening them. Only http(s).
 */
export function qrText(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const u = url.trim();
  if (!u || u.length > 300 || /\s/.test(u)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^https?:\/\//i.test(u)) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (!parsed.hostname.includes('.') || parsed.username || parsed.password) return null;
    const href = parsed.href;
    return /^[\x21-\x7E]+$/.test(href) ? href : null;
  } catch {
    return null;
  }
}

/** A QR code's modules: `size` × `size`, `dark[row][col]`. */
export interface QrModules {
  size: number;
  dark: boolean[][];
  /** The error correction it was made with: 'H' when a logo covers the middle, 'M' otherwise. */
  level: 'M' | 'H';
}

const cache = new Map<string, QrModules | null>();

/**
 * The modules for `url`, or `null` when it is not an address a QR code
 * should open. The smallest version that holds it; level M (15% may be lost),
 * or H (30%) when `withLogo` — a logo over the middle covers at most a
 * twentieth of the code, well inside what H rebuilds.
 */
export function qrModules(url: unknown, withLogo = false): QrModules | null {
  const text = qrText(url);
  if (!text) return null;
  const level = withLogo ? 'H' : 'M';
  const key = `${level}|${text}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  let out: QrModules | null = null;
  try {
    const qr = qrcode(0, level);
    qr.addData(text, 'Byte');
    qr.make();
    const size = qr.getModuleCount();
    const dark: boolean[][] = [];
    for (let r = 0; r < size; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < size; c++) row.push(qr.isDark(r, c));
      dark.push(row);
    }
    out = { size, dark, level };
  } catch {
    out = null; // too long for any version: no code rather than a broken one
  }
  if (cache.size > 64) cache.clear();
  cache.set(key, out);
  return out;
}

/**
 * The dark modules as one SVG path in module units — "M x y h1 v1 h-1z" per
 * run of dark modules in a row — so the code is a single shape the renderer
 * rasterises once, with no seams between neighbouring squares. `skip` leaves
 * a square of modules out (under a logo).
 */
export function qrPath(m: QrModules, skip?: { from: number; to: number }): string {
  const parts: string[] = [];
  for (let r = 0; r < m.size; r++) {
    let c = 0;
    while (c < m.size) {
      const hidden = (col: number) => !!skip && r >= skip.from && r < skip.to && col >= skip.from && col < skip.to;
      if (!m.dark[r][c] || hidden(c)) {
        c++;
        continue;
      }
      let end = c;
      while (end < m.size && m.dark[r][end] && !hidden(end)) end++;
      parts.push(`M${c} ${r}h${end - c}v1h${c - end}z`);
      c = end;
    }
  }
  return parts.join('');
}
