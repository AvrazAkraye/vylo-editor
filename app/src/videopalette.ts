/**
 * A brand's colours, read from its logo.
 *
 * When a logo is picked, its main colours are found — the logo drawn small on
 * a canvas, its pixels grouped by k-means in CIE Lab, where distance is close
 * to how different two colours look — and offered as the brand's main and
 * accent colours. Offered, never put there: the person presses "Use the
 * logo's colours", and the colours they had chosen stay until they do.
 *
 * Two things make a logo's colours hard to take as they are. The background
 * a logo was saved on — the white square around a JPEG — is its most common
 * colour and not a brand colour at all; it is found from the picture's edge
 * and left out. And a logo's colours were chosen for a white page, not for
 * the video's ground: a navy logo on the Neon style's near-black would draw
 * shapes nobody can see. So each colour is made lighter or darker, keeping
 * its hue, until it has at least 3:1 contrast against the style's background
 * — WCAG's measure for graphics and large text, which is what a video's
 * shapes and headlines are.
 *
 * Everything here but `paletteOfImage` is arithmetic on numbers, tested in
 * test/videoedit.test.mjs.
 */

export type RGB = [number, number, number];

/** One of a logo's colours, and how much of the logo it covers. */
export interface Swatch {
  hex: string;
  /** Of the logo's counted pixels, 0 to 1. */
  share: number;
  /** How colourful it is (Lab chroma): under ~12 is a white, a grey or a black. */
  chroma: number;
}

// ── colour arithmetic ─────────────────────────────────────────────────────

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function rgbOf(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function hexOf(rgb: RGB): string {
  return `#${rgb.map((c) => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

const linear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(c: string | RGB): number {
  const rgb = typeof c === 'string' ? rgbOf(c) : c;
  if (!rgb) return 0;
  const [r, g, b] = rgb.map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a: string | RGB, b: string | RGB): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** CIE L*a*b*, D65. */
export function labOf(rgb: RGB): RGB {
  const [r, g, b] = rgb.map(linear);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** How different two colours look (CIE76 ΔE): about 2.3 is just noticeable, over 20 is plainly another colour. */
export function deltaE(a: RGB, b: RGB): number {
  const x = labOf(a);
  const y = labOf(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

const labDistance = (x: RGB, y: RGB) => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);

export function hslOf([r, g, b]: RGB): RGB {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

export function rgbOfHsl([h, s, l]: RGB): RGB {
  const hue = (p: number, q: number, t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const H = h / 360;
  return [hue(p, q, H + 1 / 3) * 255, hue(p, q, H) * 255, hue(p, q, H - 1 / 3) * 255];
}

/**
 * The colour, made lighter or darker with its hue and saturation kept, until
 * it has `min` contrast against `bg`. Lighter on a dark ground, darker on a
 * light one; the other way only if that way cannot get there.
 */
export function readableOn(hex: string, bg: string, min = 3): string {
  const rgb = rgbOf(hex);
  if (!rgb || !rgbOf(bg)) return hex;
  if (contrastRatio(rgb, bg) >= min) return hexOf(rgb);
  const [h, s, l] = hslOf(rgb);
  const darkGround = luminance(bg) < 0.4;
  for (const dir of darkGround ? [1, -1] : [-1, 1]) {
    for (let step = 1; step <= 50; step++) {
      const next = clamp(l + dir * step * 0.02, 0, 1);
      const c = rgbOfHsl([h, s, next]);
      if (contrastRatio(c, bg) >= min) return hexOf(c);
      if (next === 0 || next === 1) break;
    }
  }
  return hexOf(rgb);
}

// ── a logo's main colours ─────────────────────────────────────────────────

interface Bin { rgb: RGB; lab: RGB; n: number }

/** Colourful enough to be a brand's colour rather than its lettering or its ground (Lab chroma). */
const CHROMATIC = 12;

/** The picture's edge, where a background shows: the colour most of it is, when most of it is one. */
function edgeColour(px: ArrayLike<number>, width: number, height: number): RGB | null {
  const edge: RGB[] = [];
  const at = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    if (px[i + 3] >= 128) edge.push([px[i], px[i + 1], px[i + 2]]);
  };
  for (let x = 0; x < width; x++) { at(x, 0); at(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { at(0, y); at(width - 1, y); }
  const all = 2 * width + 2 * Math.max(0, height - 2);
  // A logo on a clear background has no ground to remove.
  if (!edge.length || edge.length < all * 0.5) return null;
  const labs = edge.map(labOf);
  let best = -1;
  let most = 0;
  for (let i = 0; i < labs.length; i++) {
    const near = labs.filter((d) => labDistance(labs[i], d) < 10).length;
    if (near > most) { most = near; best = i; }
    if (most > edge.length * 0.8) break;
  }
  return best >= 0 && most >= edge.length * 0.6 ? edge[best] : null;
}

/**
 * A picture's main colours, most telling first: RGBA pixels (a canvas's
 * `getImageData().data`), `width` × `height`. Transparent pixels and the
 * background around the logo are left out; colours closer than a ΔE of 18
 * are one colour; a colourful one counts for more than a grey of the same
 * size, since a logo's grey is usually its lettering and its colour its brand.
 */
export function dominantColours(px: ArrayLike<number>, width: number, height: number, max = 3): Swatch[] {
  // Only a white, grey or black ground is taken for a background. A logo that
  // fills its square with a colour — white letters on the brand's red — has
  // that colour as its brand, and removing it would leave the letters.
  const edge = edgeColour(px, width, height);
  const edgeLab = edge ? labOf(edge) : null;
  const groundLab = edgeLab && Math.hypot(edgeLab[1], edgeLab[2]) < CHROMATIC ? edgeLab : null;
  // 4 bits a channel: 4096 bins, so k-means runs on a few hundred points at most, and runs the same every time.
  const collect = (skipGround: boolean) => {
    const bins = new Map<number, { r: number; g: number; b: number; n: number }>();
    let counted = 0;
    let opaque = 0;
    for (let i = 0; i + 3 < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      opaque += 1;
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];
      if (skipGround && groundLab && labDistance(labOf([r, g, b]), groundLab) < 12) continue;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bin = bins.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
      bin.r += r; bin.g += g; bin.b += b; bin.n += 1;
      bins.set(key, bin);
      counted += 1;
    }
    return { bins, counted, opaque };
  };
  let { bins, counted, opaque } = collect(true);
  // A picture that is all ground — a grey square — is its own colour.
  if (groundLab && counted < opaque * 0.03) ({ bins, counted, opaque } = collect(false));
  if (!counted) return [];
  const points: Bin[] = [...bins.values()].map((b) => {
    const rgb: RGB = [b.r / b.n, b.g / b.n, b.b / b.n];
    return { rgb, lab: labOf(rgb), n: b.n };
  });

  // Seeds: the commonest colour, then each time the colour that is both common
  // and far from the seeds so far (a weighted farthest point) — no randomness.
  const k = Math.min(6, points.length);
  const seeds: RGB[] = [];
  let first = points[0];
  for (const p of points) if (p.n > first.n) first = p;
  seeds.push(first.lab);
  while (seeds.length < k) {
    let pick: Bin | null = null;
    let score = -1;
    for (const p of points) {
      const d = Math.min(...seeds.map((s) => labDistance(s, p.lab)));
      if (p.n * d * d > score) { score = p.n * d * d; pick = p; }
    }
    if (!pick || score <= 0) break;
    seeds.push(pick.lab);
  }

  let centres = seeds.map((s) => [...s] as RGB);
  let owner = new Array<number>(points.length).fill(0);
  for (let round = 0; round < 12; round++) {
    owner = points.map((p) => {
      let best = 0;
      let d = Infinity;
      centres.forEach((c, j) => { const e = labDistance(c, p.lab); if (e < d) { d = e; best = j; } });
      return best;
    });
    const next = centres.map(() => ({ l: 0, a: 0, b: 0, n: 0 }));
    points.forEach((p, i) => {
      const c = next[owner[i]];
      c.l += p.lab[0] * p.n; c.a += p.lab[1] * p.n; c.b += p.lab[2] * p.n; c.n += p.n;
    });
    const moved = next.map((c, j) => (c.n ? [c.l / c.n, c.a / c.n, c.b / c.n] as RGB : centres[j]));
    const still = moved.every((c, j) => labDistance(c, centres[j]) < 0.5);
    centres = moved;
    if (still) break;
  }

  // Each cluster's colour is the average of its pixels in RGB, which is a colour the logo has.
  let groups = centres.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
  points.forEach((p, i) => {
    const g = groups[owner[i]];
    g.r += p.rgb[0] * p.n; g.g += p.rgb[1] * p.n; g.b += p.rgb[2] * p.n; g.n += p.n;
  });
  groups = groups.filter((g) => g.n > 0).sort((x, y) => y.n - x.n);

  // Two clusters that look alike are one colour.
  const merged: { r: number; g: number; b: number; n: number }[] = [];
  for (const g of groups) {
    const rgb: RGB = [g.r / g.n, g.g / g.n, g.b / g.n];
    const same = merged.find((m) => deltaE([m.r / m.n, m.g / m.n, m.b / m.n], rgb) < 18);
    if (same) { same.r += g.r; same.g += g.g; same.b += g.b; same.n += g.n; } else merged.push({ ...g });
  }

  return merged
    .map((m) => {
      const rgb: RGB = [m.r / m.n, m.g / m.n, m.b / m.n];
      const lab = labOf(rgb);
      return { hex: hexOf(rgb), share: m.n / counted, chroma: Math.hypot(lab[1], lab[2]) };
    })
    .filter((s) => s.share >= 0.02)
    .sort((x, y) => weight(y) - weight(x))
    .slice(0, max);
}

const weight = (s: Swatch) => s.share * (0.3 + Math.min(s.chroma, 60) / 60);

/**
 * A main colour and an accent for the brand, from a logo's colours, each
 * readable on the style's background `bg` (see `readableOn`). The main one is
 * the logo's most telling colourful colour; the accent the next that is
 * plainly different from it (ΔE 20 or more) — none when the logo has one
 * colour, and the video derives its second colour from the main one as it
 * does for any brand. `null` when the logo gave no colours at all.
 */
export function brandFromLogo(swatches: Swatch[], bg: string, min = 3): { primary: string; accent?: string; adjusted: boolean } | null {
  if (!swatches.length) return null;
  const main = swatches.find((s) => s.chroma >= CHROMATIC) ?? swatches[0];
  const mainRgb = rgbOf(main.hex)!;
  const second = swatches
    .filter((s) => s !== main)
    .sort((a, b) => Number(b.chroma >= CHROMATIC) - Number(a.chroma >= CHROMATIC))
    .find((s) => deltaE(rgbOf(s.hex)!, mainRgb) >= 20);
  const primary = readableOn(main.hex, bg, min);
  const accent = second ? readableOn(second.hex, bg, min) : undefined;
  // Made readable, two colours can meet: an accent that now looks like the main colour is not an accent.
  const keep = accent && deltaE(rgbOf(accent)!, rgbOf(primary)!) >= 12 ? accent : undefined;
  const adjusted = primary !== main.hex || (!!keep && !!second && keep !== second.hex);
  return keep ? { primary, accent: keep, adjusted } : { primary, adjusted };
}

// ── from a picture ────────────────────────────────────────────────────────

/** How small the logo is drawn to be read: plenty for three colours, and a few thousand pixels at most. */
const SAMPLE = 64;

/** A logo's main colours, from its data: URL. Rejects when it cannot be drawn. */
export async function paletteOfImage(src: string, max = 3): Promise<Swatch[]> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const scale = Math.min(1, SAMPLE / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No canvas');
  ctx.drawImage(img, 0, 0, w, h);
  return dominantColours(ctx.getImageData(0, 0, w, h).data, w, h, max);
}
