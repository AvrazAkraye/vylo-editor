// Minimal PNG decode (8-bit RGB/RGBA, non-interlaced) and diff. Not committed.
import { readFileSync } from 'fs';
import { inflateSync } from 'zlib';
export function decode(path) {
  const b = readFileSync(path);
  let p = 8, w, h, ct, idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p); const type = b.toString('ascii', p + 4, p + 8); const data = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3; const raw = inflateSync(Buffer.concat(idat)); const out = Buffer.alloc(w * h * bpp); const stride = w * bpp;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, up = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, px: out };
}
if (process.argv[2]) {
  for (const n of process.argv.slice(2)) {
    const A = decode(`before/${n}.png`), B = decode(`after/${n}.png`);
    if (A.w !== B.w || A.h !== B.h) { console.log(n, 'size differs', A.w, A.h, B.w, B.h); continue; }
    let strong = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 0; i < A.w * A.h; i++) {
      let m = 0; for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(A.px[i * A.bpp + k] - B.px[i * B.bpp + k]));
      if (m > 40) { strong++; const x = i % A.w, y = (i / A.w) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    }
    console.log(n.padEnd(30), 'strong px', strong, strong ? `box ${x0},${y0}-${x1},${y1}` : '');
  }
}
