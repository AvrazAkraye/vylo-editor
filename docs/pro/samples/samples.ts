// R2: real sample files and real-engine checks of export, sound and sync (scratch, git-ignored).
// Runs in the off-screen WKWebView host (wk2.mjs); big files are POSTed back to the runner.
import { buildMotion } from '../../src/motiontemplates';
import { readMotion } from '../../src/motionread';
import { musicCuesOf, renderSoundBed, soundCues, withSound } from '../../src/motionsound';
import { outputOf, settingsFor } from '../../src/motionshare';
import { makeFile } from '../../src/MotionExport';
import { changingFrames, renderMp4 } from '../../src/motionexportops';
import { encodeMp4 } from '../../src/motionencode';
import { canEncodeAac, encodeAac } from '../../src/motionaudioenc';
import { paint, preload } from '../../src/motiondraw';
import { addScene, sceneHold, sceneList, setTransition } from '../../src/motionscene';
import { addLayer, isAttached, placeAdded, setFields, setLayer } from '../../src/motionedit';
import { kitOptionsWithBrand, readBrand } from '../../src/motionbrand';
import { frameCount } from '../../src/motiontypes';

const w = window as any;
const t = (s: string) => s;

async function save(name: string, bytes: Uint8Array, scratch = false): Promise<void> {
  const r = await fetch(`/save?f=${encodeURIComponent(name)}${scratch ? '&scratch=1' : ''}`, { method: 'POST', body: bytes });
  if (!r.ok) throw new Error(`save ${name}: ${r.status}`);
}

function planarBytes(chs: Float32Array[]): Uint8Array {
  const n = chs[0].length;
  const out = new Float32Array(n * chs.length);
  chs.forEach((c, i) => out.set(c, i * n));
  return new Uint8Array(out.buffer);
}

interface Spec {
  name: string;
  recipe?: string;
  lang?: string;
  format?: string;
  fps?: number;
  seconds?: number;
  fields?: Record<string, unknown>;
  scenes?: { recipes: string[]; each: number; transitions: unknown[]; title?: string };
  sound?: { mode: string; level?: number; mood?: string } | null;
  dest: string;
  choices?: Record<string, unknown>;
  bed?: boolean;
  dropBackdrop?: boolean;
  /** S1: a graphic made by a sequence of the studio's own edits (see `built`). */
  build?: 'plusScene' | 'brand';
  brand?: Record<string, unknown>;
}

/** S1: what the studio's edits did, step by step, for the record. */
let story: any[] = [];

/**
 * S1 (a): Big title, "+ Scene" pressed with the playhead in it (MotionScenes.tsx `add`: addScene(m, playhead), then the
 * playhead goes to the new scene's start), Layers' Add text there (MotionLayers.tsx `add` through MotionPanel's
 * `inScene`: placeAdded(m, addLayer(m, 'text', { text, id, name }), playhead)), its words typed (setLayer), the new
 * scene's transition set to push (setTransition), then the template's words changed in Design's form (setFields).
 */
function plusScene(spec: Spec): any {
  const lang = (spec.lang ?? 'en') as any;
  let m: any = buildMotion({ id: 'plusscene', recipe: 'big-title', lang, format: (spec.format ?? 'landscape') as any, now: 0 });
  const note = (step: string) => story.push({ step, seconds: m.seconds, attached: isAttached(m), until: m.recipe?.until ?? null, fields: m.recipe?.fields ?? null,
    scenes: sceneList(m).map((x: any) => ({ start: x.start, end: x.end, transition: x.transition?.kind ?? null })), layers: m.layers.length });
  note('Big title');
  const playhead = 2.5;
  m = addScene(m, playhead, 1);
  note('+ Scene (playhead 2.5 s)');
  const at = sceneList(m)[1].start;
  const id = 'own-words';
  const before = m;
  const added = addLayer(m, 'text', { text: 'Your words', id, name: 'Text' } as any, 2);
  m = placeAdded(before, added.motion, at);
  note(`Layers: Add text (playhead ${at} s)`);
  const typed = setLayer(m, id, { text: spec.fields?.second ?? 'Doors open at 7 pm', size: 9 } as any, 3);
  m = placeAdded(m, typed, at);
  note('typed its words, size 9');
  m = setTransition(m, sceneList(m)[1].id, 'push', 4);
  note('scene 2 arrives by push');
  m = setFields(m, { title: spec.fields?.title ?? 'The new studio opens', subtitle: spec.fields?.subtitle ?? 'Saturday, 12 October' } as any, 5);
  note("Design's Words on screen: title and subtitle changed");
  const own = m.layers.find((l: any) => l.id === id);
  story.push({ ownLayer: own ? { start: own.start, end: own.end, text: own.text } : null });
  return m;
}

/** S1 (c): a template started while a brand kit is set (kitOptionsWithBrand, as the gallery does). */
function branded(spec: Spec): any {
  const kit = readBrand(spec.brand);
  story.push({ kit });
  const o = kitOptionsWithBrand({ id: spec.name.replace(/\W/g, ''), recipe: spec.recipe as any, lang: (spec.lang ?? 'en') as any, format: (spec.format ?? 'landscape') as any,
    seconds: spec.seconds, fields: spec.fields as any, now: 0 }, kit);
  story.push({ options: { ...o, look: o.look ? { voice: (o.look as any).voice, logo: !!(o.look as any).logo } : null } });
  return buildMotion(o);
}

function docOf(spec: Spec): any {
  const lang = spec.lang ?? 'en';
  const format = spec.format ?? 'landscape';
  let doc: any;
  story = [];
  if (spec.build === 'plusScene') doc = plusScene(spec);
  else if (spec.build === 'brand') doc = branded(spec);
  else if (spec.scenes) {
    const sc = spec.scenes;
    const parts = sc.recipes.map((r, k) => buildMotion({ id: `p${k}`, recipe: r as any, lang: lang as any, format: format as any, seconds: sc.each, now: 0 }));
    const layers: any[] = [];
    parts.forEach((p, k) => p.layers.forEach((l: any) => layers.push({ ...l, id: `s${k}${l.id}`, start: l.start + k * sc.each, end: l.end + k * sc.each })));
    const scenes = parts.map((_, k) => (k === 0 ? { name: 'Hook', start: 0 } : { start: k * sc.each, transition: sc.transitions[k - 1] }));
    doc = readMotion({ ...parts[0], recipe: undefined, id: 'scenes', title: sc.title ?? 'Scenes', seconds: sc.each * parts.length, layers, scenes }, 0);
  } else {
    doc = buildMotion({ id: spec.name.replace(/\W/g, ''), recipe: spec.recipe as any, lang: lang as any, format: format as any, seconds: spec.seconds, fields: spec.fields as any, now: 0 });
  }
  if (spec.fps) doc = { ...doc, fps: spec.fps };
  if (spec.dropBackdrop) doc = { ...doc, layers: doc.layers.filter((l: any) => l.kind !== 'backdrop' && l.kind !== 'particles').map((l: any) => ({ ...l, loop: undefined })) };
  if (spec.sound) doc = withSound(doc, spec.sound as any, 0);
  return doc;
}

/** One file exactly as the Export tab makes it (settingsFor → outputOf → makeFile), saved under `name`. */
w.sample = async (spec: Spec) => {
  const doc = docOf(spec);
  const s = settingsFor(spec.dest as any, doc, spec.choices as any);
  const out = outputOf(doc, s);
  const progress: number[] = [];
  let soundStage = 0;
  const t0 = performance.now();
  const made = await makeFile(doc, s, out, t, { onProgress: (d) => { if (progress.length < 1 || d % 50 === 0) progress.push(d); }, onSound: () => { soundStage++; } });
  const ms = performance.now() - t0;
  const ext = s.kind;
  await save(`${spec.name}.${ext}`, made.bytes);
  const film: any = made.bytes;
  const res: any = {
    name: spec.name, ext, ms: Math.round(ms), bytes: made.bytes.length, note: made.note,
    audio: film.audio, painted: film.painted, frames: film.frames, soundStage,
    settings: { kind: s.kind, format: s.format, reshape: s.reshape, width: s.width, height: s.height, fps: s.fps, seconds: s.seconds, quality: s.quality, blur: s.blur, transparent: s.transparent, size: s.size, side: s.side, at: s.at },
    story,
    doc: { seconds: out.seconds, fps: out.fps, lang: out.lang, format: out.format, sound: out.sound, scenes: out.scenes ? sceneList(out).map((x: any) => ({ start: x.start, end: x.end, transition: x.transition })) : null, layers: out.layers.length, recipe: out.recipe?.id ?? null },
  };
  if (spec.sound && s.kind === 'mp4') {
    res.cues = soundCues(out).map((c) => ({ kind: c.kind, t: +c.t.toFixed(4), d: +c.d.toFixed(3), pan: +c.pan.toFixed(3), gain: +c.gain.toFixed(3) }));
    res.musicCues = musicCuesOf(out);
    const list = sceneList(out);
    res.stills = list.slice(0, -1).map((x: any, i: number) => (list[i + 1].transition ? [+sceneHold(out, i).toFixed(4), x.end] : null)).filter(Boolean);
    res.cuesInStills = res.cues.filter((c: any) => res.stills.some(([a, b]: number[]) => c.t >= a - 1e-6 && c.t < b));
    if (spec.bed !== false) {
      const bed = await renderSoundBed(out, { sampleRate: 48000 });
      if (bed) {
        await save(`beds/${spec.name.split('/').pop()}.bed.f32`, planarBytes(bed.channels), true);
        res.bed = { rate: bed.sampleRate, n: bed.channels[0].length, channels: bed.channels.length };
      }
    }
  }
  if (s.kind === 'mp4') res.changing = Array.from(changingFrames(out.backdrop === null ? { ...out, backdrop: 'bg' } : out, { fps: out.fps, frames: frameCount(out), blur: s.blur ? { samples: 8, shutter: 0.5 } : undefined })).reduce((a: number, b: number) => a + b, 0);
  return res;
};

/** The same graphic twice: with the frame-skipping plan and painted whole, both films saved, for decoded-frame hashes. */
w.skipVsFull = async (spec: Spec & { size?: string; blur?: boolean }) => {
  const doc = docOf(spec);
  const o = { size: (spec.size ?? '720p') as any, quality: 'high' as const, blur: !!spec.blur };
  const t0 = performance.now();
  const skip: any = await renderMp4(doc, o);
  const t1 = performance.now();
  const full: any = await renderMp4(doc, o, { encodeMp4: (x: any) => encodeMp4({ ...x, unchanged: undefined }) } as any);
  const t2 = performance.now();
  await save(`${spec.name}.skip.mp4`, skip);
  await save(`${spec.name}.full.mp4`, full);
  // And on the canvas itself: paint every frame whole and hash it, then compare where the plan skips.
  const film = doc.backdrop === null ? { ...doc, backdrop: 'bg' } : doc;
  await preload(film);
  const W = 640, H = Math.round((640 * (doc.format === 'portrait' ? 16 : doc.format === 'square' ? 1 : doc.format === 'feed' ? 5 : 9)) / (doc.format === 'portrait' ? 9 : doc.format === 'square' ? 1 : doc.format === 'feed' ? 4 : 16)) & ~1;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const frames = frameCount(film);
  const blur = spec.blur ? { samples: 8, shutter: 0.5 } : undefined;
  const look: any = blur ? { width: W, height: H, clear: true, blur } : { width: W, height: H, clear: true };
  const plan = changingFrames(film, { fps: film.fps, frames, blur });
  const hash = (d: Uint8ClampedArray) => { let h = 0x811c9dc5; for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193); } return h >>> 0; };
  const hashes: number[] = [];
  for (let i = 0; i < frames; i++) { paint(ctx as any, film, i / film.fps, look); hashes.push(hash(ctx.getImageData(0, 0, W, H).data)); }
  let skipped = 0, wrong = 0, needless = 0;
  for (let i = 1; i < frames; i++) {
    if (plan[i] === 0) { skipped++; if (hashes[i] !== hashes[i - 1]) wrong++; } else if (hashes[i] === hashes[i - 1]) needless++;
  }
  return { name: spec.name, skipMs: Math.round(t1 - t0), fullMs: Math.round(t2 - t1), painted: skip.painted, fullPainted: full.painted, frames: skip.frames, canvas: { frames, skipped, wrong, needless } };
};

/** Full and skip renders alternated (full, skip, full, skip, ...), every film saved: the encoder's own run-to-run noise as a control, and fair timings. */
w.alternate = async (spec: Spec & { size?: string; blur?: boolean }, rounds = 2) => {
  const doc = docOf(spec);
  const o = { size: (spec.size ?? '720p') as any, quality: 'high' as const, blur: !!spec.blur };
  const times: Record<string, number[]> = { full: [], skip: [] };
  // One throwaway render first, so neither side pays the first run's warm-up.
  await renderMp4(doc, o);
  for (let r = 0; r < rounds; r++) {
    for (const mode of ['full', 'skip']) {
      const t0 = performance.now();
      const bytes: any = await renderMp4(doc, o, mode === 'full' ? { encodeMp4: (x: any) => encodeMp4({ ...x, unchanged: undefined }) } as any : {});
      times[mode].push(Math.round(performance.now() - t0));
      await save(`${spec.name}.${mode}${r}.mp4`, bytes);
    }
  }
  return { name: spec.name, times };
};

/** Every template's sound through the real film path (encodeMp4, with its peak check) on a tiny picture; the films are saved for ffmpeg to meter. */
w.soundFilms = async (recipes: string[], modes: string[], levels: number[], tag = '') => {
  const rows: any[] = [];
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 36;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  for (const recipe of recipes) for (const mode of modes) for (const level of levels) {
    const doc = withSound(buildMotion({ id: `sf-${recipe}`, recipe: recipe as any, lang: 'en', format: 'landscape', now: 0 } as any), { mode, level } as any, 0);
    const bed = await renderSoundBed(doc, { sampleRate: 48000 });
    if (!bed) { rows.push({ recipe, mode, level, bed: null }); continue; }
    const t0 = performance.now();
    const frames = frameCount(doc);
    const bytes: any = await encodeMp4({ canvas, width: 64, height: 36, fps: doc.fps, frames, quality: 'medium', audio: bed, draw: (i) => { ctx.fillStyle = `rgb(${i % 255},0,0)`; ctx.fillRect(0, 0, 64, 36); } });
    const name = `${tag}${recipe}-${mode}-${level}.mp4`;
    await save(`soundfilms/${name}`, bytes, true);
    rows.push({ recipe, mode, level, name, audio: bytes.audio, ms: Math.round(performance.now() - t0) });
  }
  return rows;
};

/** What the decoded-peak check costs on a long bed: encode, decode, measure. */
w.checkCost = async (spec: Spec) => {
  const doc = docOf(spec);
  const bed = await renderSoundBed(doc, { sampleRate: 48000 });
  if (!bed) return null;
  const { decodeAac } = await import('../../src/motionaudioenc');
  const { truePeakOf } = await import('../../src/audiocore');
  const out: any = { seconds: bed.channels[0].length / 48000 };
  for (let k = 0; k < 3; k++) {
    const t0 = performance.now();
    const aac = await encodeAac(bed);
    const t1 = performance.now();
    const heard = await decodeAac(aac);
    const t2 = performance.now();
    const peak = truePeakOf(heard!);
    const t3 = performance.now();
    out[`run${k}`] = { encodeMs: Math.round(t1 - t0), decodeMs: Math.round(t2 - t1), peakMs: Math.round(t3 - t2), peakDb: +(20 * Math.log10(peak)).toFixed(2) };
  }
  return out;
};

/** An encode at a size that is not even (the encoder crops a pixel), with a click track. */
w.oddSize = async (width: number, height: number, fps = 30, seconds = 2) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const n = Math.round(seconds * 48000);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (const s of [0.5, 1.5]) for (let k = 0; k < 96; k++) { const v = 0.5 * Math.sin((2 * Math.PI * 3000 * k) / 48000) * Math.sin((Math.PI * k) / 96); L[Math.round(s * 48000) + k] = v; R[Math.round(s * 48000) + k] = v; }
  const frames = Math.round(seconds * fps);
  const bytes: any = await encodeMp4({
    canvas, width, height, fps, frames, quality: 'high', audio: { channels: [L, R], sampleRate: 48000 },
    draw: (i) => { ctx.fillStyle = i === Math.round(0.5 * fps) || i === Math.round(1.5 * fps) ? '#fff' : '#123'; ctx.fillRect(0, 0, width, height); ctx.fillStyle = '#f80'; ctx.fillRect(width - 1, 0, 1, height); ctx.fillRect(0, height - 1, width, 1); },
  });
  await save(`odd-${width}x${height}.mp4`, bytes);
  return { width, height, audio: bytes.audio, frames: bytes.frames, bytes: bytes.length };
};

/** Cancel an export with sound at a stage: 'bed' (while the bed renders), 'aac' (half-way through the AAC), 'frames'. Then export again. */
w.cancelAt = async (spec: Spec, stage: string) => {
  const doc = docOf(spec);
  const ctl = new AbortController();
  let error = '';
  let soundCalls: number[][] = [];
  const t0 = performance.now();
  try {
    await renderMp4(doc, {
      size: '720p', quality: 'high', blur: false, sound: true, signal: ctl.signal,
      onSound: (d, total) => { soundCalls.push([d, total]); if (stage === 'bed' && d === 0) setTimeout(() => ctl.abort(), 30); if (stage === 'aac' && d > 0 && d >= total / 2) ctl.abort(); },
      onProgress: (d) => { if (stage === 'frames' && d === 10) ctl.abort(); },
    });
  } catch (e: any) { error = `${e?.name}: ${e?.message}`; }
  const cancelMs = Math.round(performance.now() - t0);
  const again: any = await renderMp4(doc, { size: '720p', quality: 'high', blur: false, sound: true });
  await save(`cancel-${stage}-then-again.mp4`, again);
  return { stage, error, cancelMs, soundCalls: soundCalls.length, firstCalls: soundCalls.slice(0, 3), againAudio: again.audio, againFrames: again.frames, againBytes: again.length };
};

/** Export with `AudioEncoder` taken away, or replaced by one that fails. */
w.noAac = async (spec: Spec, how: string) => {
  const doc = docOf(spec);
  const real = w.AudioEncoder;
  let can = null as boolean | null;
  try {
    if (how === 'absent') delete w.AudioEncoder;
    if (how === 'absent') w.AudioEncoder = undefined;
    if (how === 'refuses') w.AudioEncoder = class { static async isConfigSupported() { return { supported: false }; } };
    if (how === 'fails') {
      w.AudioEncoder = class {
        static isConfigSupported(c: any) { return real.isConfigSupported(c); }
        _e: any; state = 'unconfigured'; encodeQueueSize = 0;
        constructor(init: any) { this._e = init; }
        configure() { this.state = 'configured'; }
        encode() { setTimeout(() => this._e.error(new DOMException('synthetic failure', 'EncodingError')), 0); }
        async flush() { await new Promise((r) => setTimeout(r, 5)); }
        close() { this.state = 'closed'; }
      };
    }
    can = await canEncodeAac();
    const bytes: any = await renderMp4(doc, { size: '720p', quality: 'high', blur: false, sound: true });
    await save(`noaac-${how}.mp4`, bytes);
    return { how, can, audio: bytes.audio, frames: bytes.frames, bytes: bytes.length };
  } finally {
    w.AudioEncoder = real;
  }
};

/** The AAC encoder's own behaviour on a bed: priming, frames, and what it does to the true peak. */
w.aacOf = async (spec: Spec) => {
  const doc = docOf(spec);
  const bed = await renderSoundBed(doc, { sampleRate: 48000 });
  if (!bed) return null;
  const aac = await encodeAac(bed);
  return { rate: aac.sampleRate, delay: aac.delaySamples, total: aac.totalSamples, frames: aac.frames.length, firstTs: aac.frames[0].timestamp, lastTs: aac.frames[aac.frames.length - 1].timestamp };
};

/** The renderer's own canvas at some GIF frames' times, at the GIF's size, as raw RGBA (the reference a decoded GIF is compared with). */
w.gifReference = async (spec: Spec, times: number[]) => {
  const doc = docOf(spec);
  const s = settingsFor(spec.dest as any, doc, spec.choices as any);
  const out = outputOf(doc, s);
  const film = s.transparent ? out : (out.backdrop === null || /^#[0-9a-f]{8}$/i.test(String(out.backdrop)) && !/ff$/i.test(String(out.backdrop)) ? { ...out, backdrop: 'bg' } : out);
  await preload(film);
  const canvas = document.createElement('canvas');
  canvas.width = s.width;
  canvas.height = s.height;
  const ctx = canvas.getContext('2d', { alpha: s.transparent })!;
  const base = spec.name.split('/').pop();
  const frames: any[] = [];
  for (const [i, tm] of times.entries()) {
    paint(ctx as any, film, tm, { width: s.width, height: s.height, clear: true } as any);
    await save(`gifref/${base}/${i}.rgba`, new Uint8Array(ctx.getImageData(0, 0, s.width, s.height).data.buffer), true);
    frames.push({ i, t: tm });
  }
  await save(`gifref/${base}/index.json`, new TextEncoder().encode(JSON.stringify({ width: s.width, height: s.height, frames })), true);
  return { width: s.width, height: s.height, frames: frames.length };
};

w.info = async () =>({ ua: navigator.userAgent, aac: await canEncodeAac() });

/** S1: the graphic a film was made from (after outputOf), for the cue comparison in node (cuesab.mjs). */
w.dumpDoc = async (spec: Spec) => {
  const doc = docOf(spec);
  const s = settingsFor(spec.dest as any, doc, spec.choices as any);
  const out = outputOf(doc, s);
  await save(`docs/${spec.name.split('/').pop()}.json`, new TextEncoder().encode(JSON.stringify(out)), true);
  return { name: spec.name, seconds: out.seconds, layers: out.layers.length };
};

/**
 * S1: why a film with sound takes longer in this page than it did for R2. The page's visibility, what a bare
 * setTimeout(0) waits here, and one sound bed rendered with every timer it sets recorded (asked delay, waited).
 */
w.bedTime = async (spec: Spec) => {
  const vis = { hidden: document.hidden, state: document.visibilityState };
  const bare: number[] = [];
  for (let i = 0; i < 40; i++) { const t0 = performance.now(); await new Promise((r) => setTimeout(r, 0)); bare.push(performance.now() - t0); }
  const doc = docOf(spec);
  const s = settingsFor(spec.dest as any, doc, spec.choices as any);
  const out = outputOf(doc, s);
  const real = window.setTimeout;
  const timers: number[][] = [];
  (window as any).setTimeout = (fn: any, ms?: number, ...rest: any[]) => {
    const t0 = performance.now();
    const asked = ms ?? 0;
    return real(() => { timers.push([asked, performance.now() - t0]); fn(...rest); }, ms, ...rest);
  };
  const t0 = performance.now();
  let n = 0;
  try { const bed = await renderSoundBed(out, { sampleRate: 48000 }); n = bed ? bed.channels[0].length : 0; } finally { (window as any).setTimeout = real; }
  const ms = performance.now() - t0;
  const zero = timers.filter(([a]) => a <= 4);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const q = (xs: number[], p: number) => { const ys = xs.slice().sort((a, b) => a - b); return ys.length ? +ys[Math.min(ys.length - 1, Math.floor(p * ys.length))].toFixed(1) : null; };
  return {
    vis, bare: { median: q(bare, 0.5), max: q(bare, 1), sum: +sum(bare).toFixed(0) },
    bed: { samples: n, ms: Math.round(ms), timers: timers.length, shortTimers: zero.length, waitedInShort: Math.round(sum(zero.map((x) => x[1]))),
      shortMedian: q(zero.map((x) => x[1]), 0.5), shortP90: q(zero.map((x) => x[1]), 0.9), shortMax: q(zero.map((x) => x[1]), 1) },
  };
};

/** S1: one bed alone, saved as `beds2/<name>.<tag>.bed.f32` (determinism and before/after checks). */
w.bedOnly = async (spec: Spec, tag: string) => {
  const doc = docOf(spec);
  const s = settingsFor(spec.dest as any, doc, spec.choices as any);
  const out = outputOf(doc, s);
  const bed = await renderSoundBed(out, { sampleRate: 48000 });
  if (!bed) return null;
  await save(`beds2/${spec.name.split('/').pop()}.${tag}.bed.f32`, planarBytes(bed.channels), true);
  return { n: bed.channels[0].length };
};
