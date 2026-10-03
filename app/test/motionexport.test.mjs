// Taking a motion graphic away: the sizes a film or a still is made at, the
// names it is saved under, what is drawn for each frame, and the request that
// writes the file.
//
// Encoding needs a browser with WebCodecs and is checked in one (the Export
// tab's harness renders real MP4s in WebKit and Chrome and hands them to
// ffprobe); what is checked here is everything around it, with the encoder,
// the painter, the loader and the canvas replaced by fakes that record:
//
//   - sizes: every shape at every size is a whole multiple of its ratio, even
//     on both sides (H.264), and 1080p is the shape's own size;
//   - names: the title in its own script — Arabic, Sorani, Badini — nothing a
//     file system refuses or reads as a path, the shape's tag, eighty
//     characters at most, and the same answers as Video's rule it copies;
//   - the film: fonts and pictures loaded before the first frame, frame i
//     painted at exactly i / fps, a transparent graphic drawn over its `bg`
//     tone without the graphic being changed, motion blur passed through,
//     progress and Cancel carried both ways, the encoder's error given back;
//     the encoder told which frames cannot have changed (`changingFrames`);
//     sound off unless asked for, and when asked, rendered at 48 kHz and
//     handed to the encoder (the rest of sound is pro-mux-audio.test.mjs's);
//   - the still: the frame snapped and kept inside the graphic, the alpha
//     kept only when asked for and there is any, bytes that are not a PNG
//     refused;
//   - the write request: the bytes as the body, the path percent-encoded in a
//     header, `x-unique` only for a download;
//   - and that neither file can make a request or a media element.
import { readFileSync } from 'node:fs';
import {
  FORMAT_TAG, QUALITIES, SIZES, changingFrames, downloadsPath, estimateBytes, fileNameFor, frameAt, openExported, pixelsFor,
  renderMp4, renderPng, sizeName, writeMotionFile,
} from '../.test-build/motionexportops.js';
import { buildMotion } from '../.test-build/motiontemplates.js';
import { fileNameFor as videoFileNameFor } from '../.test-build/videoexport.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rejection = async (p) => { try { await p; return null; } catch (e) { return e; } };

const FORMATS = ['landscape', 'portrait', 'square', 'feed'];
const RATIO = { landscape: [16, 9], portrait: [9, 16], square: [1, 1], feed: [4, 5] };
const SHORT = { '720p': 720, '1080p': 1080, '4k': 2160 };
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const MP4 = Uint8Array.from([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]);

const graphic = (o = {}) => ({
  id: 'm1', title: 'Launch day', request: '', lang: 'en', format: 'landscape', fps: 30, seconds: 2,
  palette: { bg: '#0B1020', fg: '#F5F7FF', accent: '#4C8DFF', accent2: '#FF6AA2', muted: '#8A93B2' },
  backdrop: 'bg', layers: [{ id: 'l1', kind: 'text', text: 'Hi' }], stage: 'ready', created: 1, updated: 1, ...o,
});

/**
 * Fakes for everything rendering touches. `log.order` is what happened, in
 * order; `log.paints` every paint with the document, the time and the options
 * it was given; `log.canvases` every canvas made, with the context options.
 */
function fakes(o = {}) {
  const log = { order: [], paints: [], canvases: [], encode: null, preloaded: false };
  const deps = {
    preload: async (m) => {
      log.order.push('preload');
      log.preloadedDoc = m;
      await new Promise((r) => setTimeout(r, 5));
      log.preloaded = true;
    },
    paint: (ctx, doc, t, opts) => {
      log.order.push('paint');
      log.paints.push({ ctx, doc, t, opts, preloadedFirst: log.preloaded });
    },
    canvas: (w, h) => {
      const c = {
        width: w, height: h, contexts: [],
        getContext(type, opts) { c.contexts.push({ type, opts }); return { canvas: c, fake: true }; },
      };
      const bytes = o.png ?? PNG;
      if (o.offscreen) c.convertToBlob = async (opts) => { c.blobType = opts?.type; return new Blob([bytes]); };
      else c.toBlob = (cb, type) => { c.blobType = type; setTimeout(() => cb(o.noBlob ? null : new Blob([bytes])), 0); };
      log.canvases.push(c);
      return c;
    },
    encodeMp4: async (e) => {
      log.order.push('encode');
      log.encode = e;
      if (o.encodeError) throw new Error(o.encodeError);
      for (let i = 0; i < e.frames; i++) {
        if (e.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        await e.draw(i);
        e.onProgress?.(i + 1, e.frames);
      }
      return MP4;
    },
  };
  return { log, deps };
}

// ── sizes ─────────────────────────────────────────────────────────────────
ok('three sizes, 4K named as such', SIZES.join() === '720p,1080p,4k' && SIZES.map(sizeName).join() === '720p,1080p,4K');
ok('three qualities, the encoder\'s presets', QUALITIES.join() === 'medium,high,very-high');
for (const f of FORMATS) {
  const [a, b] = RATIO[f];
  for (const s of SIZES) {
    const { width, height } = pixelsFor(f, s);
    ok(`${f} at ${s} is ${width} × ${height}: even, exactly ${a}:${b}, ${SHORT[s]} on the short side`,
      width % 2 === 0 && height % 2 === 0 && width * b === height * a && Math.min(width, height) === SHORT[s], { width, height });
  }
}
ok('landscape 1080p is 1920 × 1080', same(pixelsFor('landscape', '1080p'), { width: 1920, height: 1080 }));
ok('a feed post at 1080p is 1080 × 1350', same(pixelsFor('feed', '1080p'), { width: 1080, height: 1350 }));
ok('portrait 1080p is 1080 × 1920, square 1080 × 1080',
  same(pixelsFor('portrait', '1080p'), { width: 1080, height: 1920 }) && same(pixelsFor('square', '1080p'), { width: 1080, height: 1080 }));
ok('720p of a wide graphic is 1280 × 720, of a feed post 720 × 900',
  same(pixelsFor('landscape', '720p'), { width: 1280, height: 720 }) && same(pixelsFor('feed', '720p'), { width: 720, height: 900 }));
ok('4K is UHD: 3840 × 2160 wide, 2160 × 3840 tall, 2160 × 2700 for a feed post',
  same(pixelsFor('landscape', '4k'), { width: 3840, height: 2160 }) && same(pixelsFor('portrait', '4k'), { width: 2160, height: 3840 })
  && same(pixelsFor('feed', '4k'), { width: 2160, height: 2700 }));
ok('no size is larger than UHD\'s pixel count', FORMATS.every((f) => SIZES.every((s) => {
  const p = pixelsFor(f, s);
  return p.width * p.height <= 3840 * 2160 && Math.max(p.width, p.height) <= 3840;
})));
ok('an unknown shape is drawn wide rather than failing', same(pixelsFor('cinema', '1080p'), { width: 1920, height: 1080 }));
ok('each shape has a tag for its file name', same(FORMAT_TAG, { landscape: '16x9', portrait: '9x16', square: '1x1', feed: '4x5' }));

// ── the estimate ──────────────────────────────────────────────────────────
{
  ok('the estimate is the bitrate asked for, times the length, in bytes',
    estimateBytes({ format: 'landscape', fps: 30, seconds: 5 }, '1080p', 'high') === (1920 * 1080 * 30 * 0.2 * 5) / 8,
    estimateBytes({ format: 'landscape', fps: 30, seconds: 5 }, '1080p', 'high'));
  let rising = true;
  let strictly = 0;
  for (const format of FORMATS) {
    for (const fps of [24, 30, 60]) {
      const m = { format, fps, seconds: 6 };
      for (const q of QUALITIES) {
        const bySize = SIZES.map((s) => estimateBytes(m, s, q));
        if (!bySize.every((b, i) => i === 0 || b >= bySize[i - 1])) rising = false;
        strictly += bySize.filter((b, i) => i > 0 && b > bySize[i - 1]).length;
      }
      for (const s of SIZES) {
        const byQuality = QUALITIES.map((q) => estimateBytes(m, s, q));
        if (!byQuality.every((b, i) => i === 0 || b >= byQuality[i - 1])) rising = false;
      }
    }
  }
  ok('a larger size or a higher quality never makes a smaller estimate', rising);
  ok('and a larger size makes a larger one, wherever the encoder\'s ceiling allows', strictly >= 60, strictly);
  const m = { format: 'square', fps: 24, seconds: 4 };
  ok('twice as long, twice as large', estimateBytes({ ...m, seconds: 8 }, '720p', 'medium') === 2 * estimateBytes(m, '720p', 'medium'));
  ok('a length that is not a number is nothing', estimateBytes({ ...m, seconds: NaN }, '720p', 'medium') === 0);
}

// ── which frame a moment is ───────────────────────────────────────────────
{
  const m = { seconds: 2, fps: 30 };
  ok('a moment snaps to the nearest frame', frameAt(m, 1.2345) === 37 && frameAt(m, 1.2) === 36);
  ok('never past the last frame', frameAt(m, 99) === 59 && frameAt(m, 1.99) === 59 && frameAt(m, 2) === 59);
  ok('never before the first', frameAt(m, -3) === 0 && frameAt(m, NaN) === 0 && frameAt(m, Infinity) === 0);
}

// ── rendering a film ──────────────────────────────────────────────────────
{
  const { log, deps } = fakes();
  const m = graphic({ fps: 24, seconds: 2.5 });
  const progress = [];
  const bytes = await renderMp4(m, { size: '1080p', quality: 'very-high', blur: false, onProgress: (d, t) => progress.push([d, t]) }, deps);
  ok('it returns what the encoder made', bytes === MP4);
  ok('fonts and pictures are loaded first, and waited for', log.order[0] === 'preload' && log.paints.every((p) => p.preloadedFirst) && log.preloadedDoc === m);
  ok('every frame of the graphic is drawn: seconds × fps', log.encode.frames === 60 && log.paints.length === 60, [log.encode.frames, log.paints.length]);
  ok('frame i is painted at exactly i / fps — never the wall clock', log.paints.every((p, i) => p.t === i / 24), log.paints.map((p) => p.t).slice(0, 5));
  ok('the encoder gets the frame rate and the quality', log.encode.fps === 24 && log.encode.quality === 'very-high');
  ok('one canvas, the film\'s size, whose every pixel is opaque',
    log.canvases.length === 1 && log.canvases[0].width === 1920 && log.canvases[0].height === 1080
    && log.encode.canvas === log.canvases[0] && log.encode.width === 1920 && log.encode.height === 1080
    && same(log.canvases[0].contexts, [{ type: '2d', opts: { alpha: false } }]), log.canvases[0]?.contexts);
  ok('every frame is painted whole, at the film\'s size, into that canvas\'s context',
    log.paints.every((p) => p.ctx.canvas === log.canvases[0] && p.opts.width === 1920 && p.opts.height === 1080 && p.opts.clear === true));
  ok('without motion blur, no blur is asked for', log.paints.every((p) => !('blur' in p.opts)));
  ok('an opaque graphic is painted as it is', log.paints.every((p) => p.doc === m));
  ok('progress is passed on, frame by frame', progress.length === 60 && same(progress[0], [1, 60]) && same(progress[59], [60, 60]));
}
{
  const { log, deps } = fakes();
  const m = graphic({ backdrop: null, format: 'feed' });
  const before = JSON.stringify(m);
  await renderMp4(m, { size: '720p', quality: 'high', blur: true }, deps);
  const painted = log.paints[0].doc;
  ok('a transparent graphic is filmed over its bg tone — an MP4 has no alpha', painted.backdrop === 'bg' && log.paints.every((p) => p.doc.backdrop === 'bg'));
  ok('from a copy: the graphic itself is untouched', m.backdrop === null && JSON.stringify(m) === before && painted !== m);
  ok('a shallow copy: the layers are the graphic\'s own, the rest the same', painted.layers === m.layers && same({ ...painted, backdrop: null }, m));
  ok('made once, not once a frame', log.paints.every((p) => p.doc === painted));
  ok('motion blur: eight paints over half a frame, handed to paint', log.paints.every((p) => same(p.opts.blur, { samples: 8, shutter: 0.5 })));
  ok('with the frame\'s own time at the centre of the shutter', log.paints.every((p, i) => p.t === i / 30));
  ok('a feed post at 720p is 720 × 900', log.encode.width === 720 && log.encode.height === 900);
}
{
  const { log, deps } = fakes();
  const ctl = new AbortController();
  const e = await rejection(renderMp4(graphic(), {
    size: '720p', quality: 'medium', blur: false, signal: ctl.signal, onProgress: (d) => { if (d === 10) ctl.abort(); },
  }, deps));
  ok('the signal reaches the encoder', log.encode.signal === ctl.signal);
  ok('Cancel stops between frames with an AbortError', e?.name === 'AbortError' && log.paints.length === 10, [e?.name, log.paints.length]);
}
{
  const { log, deps } = fakes();
  const ctl = new AbortController();
  ctl.abort();
  const e = await rejection(renderMp4(graphic(), { size: '720p', quality: 'medium', blur: false, signal: ctl.signal }, deps));
  ok('a render cancelled before it starts loads and draws nothing', e?.name === 'AbortError' && log.order.length === 0, log.order);
}
{
  const { log, deps } = fakes();
  const ctl = new AbortController();
  deps.preload = async () => { log.order.push('preload'); ctl.abort(); };
  const e = await rejection(renderMp4(graphic(), { size: '720p', quality: 'medium', blur: false, signal: ctl.signal }, deps));
  ok('nor one cancelled while its fonts load', e?.name === 'AbortError' && !log.order.includes('encode'), log.order);
}
for (const code of ['motion:no-encoder', 'motion:encode-failed: the GPU went away', 'motion:too-large']) {
  const { deps } = fakes({ encodeError: code });
  const e = await rejection(renderMp4(graphic(), { size: '4k', quality: 'high', blur: false }, deps));
  ok(`the encoder's "${code.split(':').slice(0, 2).join(':')}" comes back as it was`, e instanceof Error && e.message === code, e?.message);
}
{
  const { deps } = fakes();
  deps.canvas = () => ({ width: 1, height: 1, getContext: () => null, toBlob: () => undefined });
  const e = await rejection(renderMp4(graphic(), { size: '4k', quality: 'high', blur: false }, deps));
  ok('a canvas too large for the window is said so, not a crash', e?.message === 'motion:no-canvas', e?.message);
}

{
  // A lower third holds still for most of its length: those frames are not painted again.
  const { log, deps } = fakes();
  deps.encodeMp4 = async (e) => {
    log.encode = e;
    for (let i = 0; i < e.frames; i++) if (i === 0 || !e.unchanged(i)) await e.draw(i);
    return MP4.slice();
  };
  const m = buildMotion({ id: 'x', recipe: 'lower-third', lang: 'en', format: 'landscape', now: 0 });
  const bytes = await renderMp4(m, { size: '720p', quality: 'high', blur: false }, deps);
  const plan = changingFrames(m, { fps: 30, frames: 150 });
  ok('the encoder is told which frames are the one before them again, and only the others are painted',
    log.paints.length === plan.filter((x) => x === 1).length && log.paints.length < 110 && log.paints.every((p) => plan[Math.round(p.t * 30)] === 1));
  ok('an encoder that reports nothing: the film is its bytes, every frame counted as painted', same([...bytes], [...MP4]) && bytes.frames === 150 && bytes.painted === 150);
  ok('without sound asked for, no sound is rendered or given, and the film says none', log.encode.audio === undefined && bytes.audio === 'none' && !log.order.includes('sound'));
}
{
  const { log, deps } = fakes();
  const beds = [];
  deps.soundBed = async (doc, o) => { beds.push({ doc, o }); return { channels: [new Float32Array(48000)], sampleRate: 48000 }; };
  const m = graphic();
  await renderMp4(m, { size: '720p', quality: 'high', blur: false, sound: true }, deps);
  ok('with sound: the graphic\'s sound rendered once, at 48 kHz, and handed to the encoder as its audio',
    beds.length === 1 && beds[0].doc === m && beds[0].o.sampleRate === 48000 && beds[0].o.cooperative === false && log.encode.audio?.sampleRate === 48000 && log.order[0] === 'preload');
}

// ── rendering a still ─────────────────────────────────────────────────────
{
  const { log, deps } = fakes();
  const m = graphic({ seconds: 2, fps: 30 });
  const bytes = await renderPng(m, { size: '1080p', at: 1.2345, transparent: false }, deps);
  ok('it returns the canvas\'s PNG', same([...bytes], [...PNG]) && log.canvases[0].blobType === 'image/png');
  ok('fonts and pictures first', log.order[0] === 'preload' && log.paints[0].preloadedFirst);
  ok('one frame, snapped to the nearest: 1.2345 s is frame 37', log.paints.length === 1 && log.paints[0].t === 37 / 30, log.paints[0].t);
  ok('at the chosen size, whole, with no motion blur',
    log.canvases[0].width === 1920 && log.canvases[0].height === 1080 && same(log.paints[0].opts, { width: 1920, height: 1080, clear: true }));
  ok('into a canvas that can hold alpha', same(log.canvases[0].contexts, [{ type: '2d', opts: { alpha: true } }]));
}
for (const [at, frame] of [[99, 59], [2, 59], [1.99, 59], [-1, 0], [NaN, 0]]) {
  const { log, deps } = fakes();
  await renderPng(graphic({ seconds: 2, fps: 30 }), { size: '720p', at, transparent: false }, deps);
  ok(`a playhead at ${at} s draws frame ${frame}, inside the graphic`, log.paints[0].t === frame / 30, log.paints[0].t);
}
{
  const { log, deps } = fakes();
  const m = graphic({ backdrop: null });
  await renderPng(m, { size: '720p', at: 1, transparent: true }, deps);
  ok('a transparent graphic keeps its alpha when asked', log.paints[0].doc === m && log.paints[0].doc.backdrop === null);
}
{
  const { log, deps } = fakes();
  const m = graphic({ backdrop: null });
  await renderPng(m, { size: '720p', at: 1, transparent: false }, deps);
  ok('and is drawn over its bg tone when not', log.paints[0].doc.backdrop === 'bg' && m.backdrop === null && log.paints[0].doc !== m);
}
{
  const { log, deps } = fakes();
  const m = graphic({ backdrop: '#123456' });
  await renderPng(m, { size: '720p', at: 1, transparent: true }, deps);
  ok('a graphic with a backdrop has no alpha to keep: the backdrop is painted', log.paints[0].doc === m && log.paints[0].doc.backdrop === '#123456');
}
{
  // A backdrop colour that is not opaque — "transparent" as a model writes it becomes #00000000 in the
  // reader — was filmed over black (measured in WebKit: every pixel of the MP4's ground 0,0,0 where the
  // graphic's bg is #F6F3EC), and its "opaque" PNG came out see-through. It is transparent, like null.
  for (const backdrop of ['#00000000', '#0b102080']) {
    const film = fakes();
    const m = graphic({ backdrop });
    await renderMp4(m, { size: '720p', quality: 'high', blur: false }, film.deps);
    const still = fakes();
    await renderPng(m, { size: '720p', at: 1, transparent: false }, still.deps);
    const kept = fakes();
    await renderPng(m, { size: '720p', at: 1, transparent: true }, kept.deps);
    ok(`a backdrop of ${backdrop} is filmed over the bg tone, and an opaque still too; a transparent still keeps it`,
      film.log.paints.every((p) => p.doc.backdrop === 'bg') && still.log.paints[0].doc.backdrop === 'bg'
      && kept.log.paints[0].doc === m && m.backdrop === backdrop, [film.log.paints[0].doc.backdrop, still.log.paints[0].doc.backdrop]);
  }
  const solid = fakes();
  const m = graphic({ backdrop: '#0b1020ff' });
  await renderMp4(m, { size: '720p', quality: 'high', blur: false }, solid.deps);
  ok('an opaque colour with its alpha written out is painted as it is', solid.log.paints.every((p) => p.doc === m));
}
{
  const { log, deps } = fakes({ offscreen: true });
  const bytes = await renderPng(graphic({ format: 'feed' }), { size: '4k', at: 0, transparent: false }, deps);
  ok('an OffscreenCanvas is encoded with convertToBlob', log.canvases[0].blobType === 'image/png' && bytes.length === PNG.length);
  ok('a feed post at 4K is 2160 × 2700', log.canvases[0].width === 2160 && log.canvases[0].height === 2700);
}
{
  const { deps } = fakes({ png: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]) });
  const e = await rejection(renderPng(graphic(), { size: '720p', at: 0, transparent: false }, deps));
  ok('bytes that are not a PNG are refused here, before Rust sees them', e?.message === 'motion:png-failed', e?.message);
  const nothing = fakes({ noBlob: true });
  const e2 = await rejection(renderPng(graphic(), { size: '720p', at: 0, transparent: false }, nothing.deps));
  ok('and so is no picture at all', e2?.message === 'motion:png-failed', e2?.message);
  const short = fakes({ png: PNG.slice(0, 8) });
  const e3 = await rejection(renderPng(graphic(), { size: '720p', at: 0, transparent: false }, short.deps));
  ok('and a signature with nothing after it', e3?.message === 'motion:png-failed', e3?.message);
}

// ── file names ────────────────────────────────────────────────────────────
{
  ok('the title, then the extension', fileNameFor({ title: 'Launch day' }, 'mp4') === 'Launch day.mp4');
  ok('with the shape\'s tag', FORMATS.every((f) => fileNameFor({ title: 'Launch day' }, 'png', FORMAT_TAG[f]) === `Launch day ${FORMAT_TAG[f]}.png`));
  ok('Arabic stays Arabic', fileNameFor({ title: 'يوم الإطلاق' }, 'mp4') === 'يوم الإطلاق.mp4');
  ok('Sorani keeps ڕ ڵ ۆ ێ ە', fileNameFor({ title: 'ڕۆژی نوێ دەجوڵێت' }, 'mp4', '9x16') === 'ڕۆژی نوێ دەجوڵێت 9x16.mp4');
  ok('and the zero-width non-joiner', fileNameFor({ title: 'ڕێکلامی\u200Cنوێ' }, 'png') === 'ڕێکلامی\u200Cنوێ.png');
  ok('Badini keeps ڤ', fileNameFor({ title: 'ڤیدیۆیا نوو' }, 'mp4') === 'ڤیدیۆیا نوو.mp4');
  const bad = fileNameFor({ title: '../../etc/passwd: "a" <b> | c? * \\ d\u0000e\u202Ef' }, 'png');
  ok('nothing a file system reads as a path or refuses', !/[\\/:*?"<>|\u0000-\u001f\u202E.]/.test(bad.slice(0, -4)) && bad.endsWith('.png'), bad);
  ok('nor a hidden file', fileNameFor({ title: '.zshrc' }, 'mp4') === 'zshrc.mp4');
  ok('an empty title is "motion"', fileNameFor({ title: '  ?? ' }, 'mp4') === 'motion.mp4' && fileNameFor({}, 'png', '4x5') === 'motion 4x5.png');
  ok('a Windows device name is not a file name',
    fileNameFor({ title: 'CON' }, 'mp4') === 'CON_.mp4' && fileNameFor({ title: 'nul' }, 'png') === 'nul_.png'
    && fileNameFor({ title: 'COM1' }, 'mp4') === 'COM1_.mp4' && fileNameFor({ title: 'lpt9' }, 'mp4', '1x1') === 'lpt9_ 1x1.mp4');
  ok('but a word that starts like one is', fileNameFor({ title: 'Console' }, 'mp4') === 'Console.mp4');
  const long = fileNameFor({ title: 'word '.repeat(40) }, 'mp4', '16x9');
  ok('at most eighty characters, cut where a word ends', Array.from(long).length <= 80 && long.endsWith('word 16x9.mp4'), long);
  const kurdish = fileNameFor({ title: 'بیرۆکەیەکی گەورە '.repeat(10) }, 'png');
  ok('counted in letters, not bytes, and cut at a word in Kurdish too', Array.from(kurdish).length <= 80 && Array.from(kurdish).length > 60 && !/\s\.png$/.test(kurdish), kurdish);
  ok('a word too long for the name is cut inside it', Array.from(fileNameFor({ title: 'a'.repeat(200) }, 'mp4')).length === 80);
  ok('letters written in two parts are joined first (NFC)', fileNameFor({ title: 'Cafe\u0301' }, 'png') === 'Caf\u00e9.png');
  const titles = ['Launch day', 'يوم الإطلاق', 'ڕۆژی دەستپێکردن', 'ڤیدیۆیا نوو', '../x: "y"', 'CON', 'word '.repeat(40), 'ڕێکلامی\u200Cنوێ', 'Q3 — 1,284+ visitors!'];
  ok('the same names as Video\'s rule, which this copies', titles.every((title) => ['', '16x9'].every((tag) =>
    fileNameFor({ title }, 'mp4', tag) === videoFileNameFor({ title }, 'mp4', tag))),
  titles.map((title) => [fileNameFor({ title }, 'mp4'), videoFileNameFor({ title }, 'mp4')]).filter(([a, b]) => a !== b));
}

// ── where it goes, and the write request ──────────────────────────────────
{
  const calls = [];
  let answer = null;
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (cmd, args, options) => {
        calls.push({ cmd, args, options });
        if (cmd === 'plugin:path|resolve_directory') return '/Users/sara/Downloads';
        if (cmd === 'plugin:path|join') return args.paths.join('/');
        return answer;
      },
    },
  };
  const at = await downloadsPath('ڕۆژی نوێ 16x9.mp4');
  ok('Download goes to the Downloads folder', at === '/Users/sara/Downloads/ڕۆژی نوێ 16x9.mp4', at);
  ok('asked of the system, not guessed', calls.some((c) => c.cmd === 'plugin:path|resolve_directory') && calls.some((c) => c.cmd === 'plugin:path|join'));

  calls.length = 0;
  answer = '/Users/sara/Downloads/ڕۆژی نوێ 16x9 (2).mp4';
  const got = await writeMotionFile(at, MP4, { unique: true });
  ok('it calls export_write_video — Video\'s command, no new one', calls[0].cmd === 'export_write_video');
  ok('with the bytes as the whole body', calls[0].args === MP4);
  ok('the path percent-encoded in x-path, Kurdish and all', calls[0].options.headers['x-path'] === encodeURIComponent(at)
    && /^[\x21-\x7e]+$/.test(calls[0].options.headers['x-path']));
  ok('and x-unique for a download, so nothing is replaced', calls[0].options.headers['x-unique'] === '1');
  ok('and returns where Rust wrote it', got === answer);

  answer = null;
  const chosen = await writeMotionFile('/Users/sara/Movies/يوم الإطلاق.png', PNG);
  ok('a Save as… replaces what the panel asked about, so it sends no x-unique', !('x-unique' in calls[1].options.headers));
  ok('and when Rust says nothing, the path is where it went', chosen === '/Users/sara/Movies/يوم الإطلاق.png');

  await openExported(got);
  ok('Open asks the system to open the file Rust wrote', calls[2].cmd === 'open_exported' && same(calls[2].args, { path: got }));
}

// ── what the export may not do ────────────────────────────────────────────
{
  const code = ['../src/motionexportops.ts', '../src/MotionExport.tsx']
    .map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'))
    // The comments say what is not done, in the words it is not done with.
    .map((s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''))
    .join('\n');
  ok('no request leaves the machine', !/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\.connection/.test(code));
  ok('no media element is ever made — a finished film opens in the system\'s player',
    !/<\s*(video|audio)\b|new\s+Audio\b|createElement\(\s*['"`](video|audio)/i.test(code));
  ok('no library: not Video\'s exporter, not Remotion', !/from\s+['"][^'"]*(videoexport|remotion)[^'"]*['"]/i.test(code));
  const commands = [...code.matchAll(/invoke(?:<[^>]*>)?\(\s*'([a-z_|:]+)'/g)].map((m) => m[1]);
  ok('the only commands are the ones Video already has', commands.length > 0 && commands.every((c) => ['export_write_video', 'open_exported', 'reveal_path'].includes(c)), commands);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
