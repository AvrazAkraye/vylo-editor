// R2: is a film without sound, as the app writes it today, exactly the file the 0.132.0 writer would have
// written? Reads the samples back out of a real WebKit-encoded film and writes them again with the old
// writer (git 4b13ed8) and the new one; compares all three byte for byte (scratch, git-ignored).
import { readFileSync } from 'node:fs';
import { Mp4Writer as Old } from './old/motionmp4.js';
import { Mp4Writer as New } from './old/newmp4.js';

function boxes(b, from = 0, to = b.length, path = '') {
  const out = [];
  let at = from;
  while (at + 8 <= to) {
    const size = b.readUInt32BE(at);
    const type = b.toString('latin1', at + 4, at + 8);
    out.push({ type, at, size, path: path + '/' + type });
    if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf'].includes(type)) out.push(...boxes(b, at + 8, at + size, path + '/' + type));
    if (type === 'stsd') out.push(...boxes(b, at + 16, at + size, path + '/' + type));
    if (type === 'avc1') out.push(...boxes(b, at + 8 + 78, at + size, path + '/' + type));
    if (type === 'mp4a') out.push(...boxes(b, at + 8 + 28, at + size, path + '/' + type));
    at += size;
  }
  return out;
}

export function compare(file) {
  const b = readFileSync(file);
  const all = boxes(b);
  const get = (t) => all.find((x) => x.type === t);
  const u32 = (o) => b.readUInt32BE(o);
  const stsz = get('stsz'), stco = get('stco'), stss = get('stss'), avcC = all.find((x) => x.type === 'avcC') ?? null;
  const n = u32(stsz.at + 16);
  const sizes = Array.from({ length: n }, (_, i) => u32(stsz.at + 20 + 4 * i));
  const chunks = u32(stco.at + 12);
  const offsets = Array.from({ length: chunks }, (_, i) => u32(stco.at + 16 + 4 * i));
  const keys = new Set(stss ? Array.from({ length: u32(stss.at + 12) }, (_, i) => u32(stss.at + 16 + 4 * i)) : Array.from({ length: n }, (_, i) => i + 1));
  // stsc: first chunk, samples per chunk
  const stsc = get('stsc');
  const rows = Array.from({ length: u32(stsc.at + 12) }, (_, i) => [u32(stsc.at + 16 + 12 * i), u32(stsc.at + 20 + 12 * i)]);
  const per = (c) => { let s = 0; for (const [first, count] of rows) if (c + 1 >= first) s = count; return s; };
  const data = [];
  let k = 0;
  for (let c = 0; c < chunks; c++) {
    let p = offsets[c];
    for (let j = 0; j < per(c) && k < n; j++, k++) { data.push(b.subarray(p, p + sizes[k])); p += sizes[k]; }
  }
  const mdhd = get('mdhd');
  const timescale = u32(mdhd.at + 20);
  const stts = get('stts');
  const delta = u32(stts.at + 20);
  const fps = Math.round(timescale / delta);
  const avc = b.subarray(avcC.at + 8, avcC.at + avcC.size);
  const width = b.readUInt16BE(all.find((x) => x.type === 'avc1').at + 32), height = b.readUInt16BE(all.find((x) => x.type === 'avc1').at + 34);
  const step = Math.round(1e6 / fps);
  const make = (W) => {
    const w = new W({ width, height, fps, avcC: new Uint8Array(avc) });
    data.forEach((d, i) => w.add({ data: new Uint8Array(d), timestamp: Math.round((i * 1e6) / fps), duration: step, key: keys.has(i + 1) }));
    return Buffer.from(w.finish());
  };
  const old = make(Old), now = make(New);
  return {
    file, bytes: b.length, samples: n, fps, size: `${width}x${height}`, tracks: all.filter((x) => x.type === 'trak').length,
    boxes: all.map((x) => x.path).join(' '),
    oldEqualsFile: old.equals(b), newEqualsFile: now.equals(b), oldEqualsNew: old.equals(now),
  };
}

console.log(JSON.stringify(compare(process.argv[2]), null, 1));
