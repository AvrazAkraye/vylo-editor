// Sound design for Motion (motionsound.ts, motionsfx.ts, motionsoundplay.ts).
//
// What matters. Sound is off unless chosen, and the reader repairs whatever
// it is handed into a spec or into silence, the same twice. Effects are read
// off the animation — each entrance, exit, counter, chart, burst, shimmer and
// backdrop asks for the sound written down for it, at the moment it moves,
// on the side of the frame it is seen on (mirrored in Arabic) — and are then
// thinned so no kind crowds itself and no second is too busy. Every effect is
// synthesised from nothing, seeded, faded at its ends and at one loudness.
// A bed is exactly the graphic's length, finite, under −1.5 dBTP, and at
// −16 LUFS (within 1 LU) when music and effects play together. Music fades in
// and out and dips under the big hits. The preview plays through Web Audio
// only, follows the playhead, waits for a person before it makes a sound, and
// does nothing at all where there is no Web Audio.
//
// Node has no OfflineAudioContext, so videosynth.ts cannot play its score
// here; the music tests hand renderSoundBed a stand-in player (plain sines
// for the score's notes). What the real player sounds like, and how long it
// takes, is measured in a browser, not here (docs/pro/sound.md).
import { readFileSync } from 'fs';
import {
  SOUND_MODES, SOUND_MOODS, defaultSound, readSound, withSound, moodOf, soundCues, musicCuesOf, soundKey,
  loudnessFor, renderSoundBed,
} from '../.test-build/motionsound.js';
import { SFX_KINDS, SFX_REF_DB, synth } from '../.test-build/motionsfx.js';
import {
  setAudioFactory, prepare, play, pause, seek, follow, setLevel, position, wake, dispose,
} from '../.test-build/motionsoundplay.js';
import { measureLoudness, gainToTarget } from '../.test-build/loudness.js';
import { MUSIC_MOODS } from '../.test-build/videosynth.js';
import { readMotion, blankLayer } from '../.test-build/motionread.js';
import { buildMotion, RECIPES } from '../.test-build/motiontemplates.js';
import { RECIPE_IDS, FORMAT_IDS, EFFECTS } from '../.test-build/motiontypes.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const db = (x) => 20 * Math.log10(x);
const MIN_GAP = { whoosh: 0.15, pop: 0.09, tick: 0.09, key: 0.09, impact: 0.5, sparkle: 0.35, riser: 0.8, swell: 1, click: 0.09 };

/** A graphic of `layers`, read the way the studio reads one, with its sound set. */
function docOf(layers, o = {}) {
  const d = readMotion({
    id: o.id ?? 'doc1', title: 'T', lang: o.lang ?? 'en', format: o.format ?? 'landscape', fps: 30, seconds: o.seconds ?? 6,
    backdrop: null, layers, stage: 'ready', created: 1, updated: 1,
  }, 1);
  d.sound = o.sound === undefined ? { mode: 'fx', level: 0.6 } : o.sound;
  if (o.scenes) d.scenes = o.scenes;
  if (o.recipe) d.recipe = o.recipe;
  return d;
}
const text = (o) => blankLayer('text', { id: 't', text: 'Hello', size: 6, pin: 'mc', x: 0, y: 0, start: 0, end: 6, ...o });
const anim = (fx, o = {}) => ({ fx, d: 0.5, delay: 0, ease: 'linear', amount: 1, ...o });
const cuesOf = (layers, o) => soundCues(docOf(layers, o));
const only = (cues, kind) => cues.filter((c) => c.kind === kind);

/** Whether a list of cues keeps its limits: each kind far enough apart, no second over `cap`. */
function dense(cues, cap) {
  for (let i = 0; i < cues.length; i++) {
    for (let j = i + 1; j < cues.length; j++) {
      if (cues[i].kind === cues[j].kind && Math.abs(cues[i].t - cues[j].t) < MIN_GAP[cues[i].kind] - 1e-9) return `${cues[i].kind} ${cues[i].t} ${cues[j].t}`;
    }
    const inSecond = cues.filter((c) => c.t >= cues[i].t && c.t < cues[i].t + 1 - 1e-9).length;
    if (inSecond > cap) return `second from ${cues[i].t} holds ${inSecond}`;
  }
  return '';
}
const finiteCue = (c, seconds) => ['t', 'd', 'pan', 'gain', 'pitch', 'seed'].every((k) => Number.isFinite(c[k]))
  && c.t >= 0 && c.t < seconds && c.gain >= 0 && c.gain <= 1 && c.pan >= -1 && c.pan <= 1 && c.pitch >= 0.5 && c.pitch <= 2 && SFX_KINDS.includes(c.kind);

// ── reading the field ─────────────────────────────────────────────────────

{
  ok('the modes are the contract\'s four', JSON.stringify(SOUND_MODES) === JSON.stringify(['off', 'fx', 'music', 'both']));
  ok('a graphic starts off, at 0.6', JSON.stringify(defaultSound()) === JSON.stringify({ mode: 'off', level: 0.6 }));
  ok('nothing is silence', readSound(undefined) === undefined && readSound(null) === undefined && readSound(42) === undefined && readSound([]) === undefined);
  ok('off at the defaults is no spec at all', readSound({ mode: 'off', level: 0.6 }) === undefined && readSound(defaultSound()) === undefined);
  ok('off that remembers a mood keeps it', JSON.stringify(readSound({ mode: 'off', mood: 'calm' })) === JSON.stringify({ mode: 'off', level: 0.6, mood: 'calm' }));
  ok('a full spec reads as itself', JSON.stringify(readSound({ mode: 'both', level: 0.35, mood: 'epic', seed: 7 })) === JSON.stringify({ mode: 'both', level: 0.35, mood: 'epic', seed: 7 }));
  ok('a bare word is a mode', JSON.stringify(readSound('music')) === JSON.stringify({ mode: 'music', level: 0.6 }) && readSound('off') === undefined);
  ok('the words a model uses for modes', readSound({ mode: 'Effects' })?.mode === 'fx' && readSound({ mode: 'sfx' })?.mode === 'fx'
    && readSound({ mode: 'all' })?.mode === 'both' && readSound({ mode: 'none', mood: 'calm' })?.mode === 'off');
  ok('an unknown mode is off', readSound({ mode: 'loud', level: 0.3 })?.mode === 'off');
  ok('level: clamped, in hundredths, 60 read as 60%', readSound({ mode: 'fx', level: 7 })?.level === 0.07 && readSound({ mode: 'fx', level: 60 })?.level === 0.6
    && readSound({ mode: 'fx', level: 500 })?.level === 1 && readSound({ mode: 'fx', level: -2 })?.level === 0
    && readSound({ mode: 'fx', level: 0.333 })?.level === 0.33 && readSound({ mode: 'fx', level: '0.5' })?.level === 0.5 && readSound({ mode: 'fx', level: NaN })?.level === 0.6);
  ok('mood: one of the list, aliases read, the rest dropped', readSound({ mode: 'music', mood: 'Lo-fi' })?.mood === 'lofi'
    && readSound({ mode: 'music', mood: 'jazz' })?.mood === undefined && readSound({ mode: 'music', mood: 'toString' })?.mood === undefined);
  ok('seed: a whole number in the composer\'s range', readSound({ mode: 'fx', seed: -12.7 })?.seed === 12 && readSound({ mode: 'fx', seed: 2147483647 })?.seed === 0
    && readSound({ mode: 'fx', seed: 'x' })?.seed === undefined);
  const inherited = Object.create({ mode: 'both' });
  ok('an inherited field is no field', readSound(inherited) === undefined);
}

// Fuzz: whatever arrives, the answer is silence or a clean spec, and reading it again gives it again.
{
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const junk = () => {
    const r = rnd();
    const pool = [
      () => NaN, () => Infinity, () => -Infinity, () => -0, () => 1e308, () => rnd() * 300 - 100, () => Math.floor(rnd() * 1e12),
      () => 'off', () => 'fx', () => 'music', () => 'both', () => 'BOTH ', () => 'calm', () => 'lofi', () => '60', () => '', () => 'x'.repeat(5000),
      () => null, () => undefined, () => true, () => [], () => ({}), () => ['music'], () => Symbol('s'), () => 10n,
      () => new Proxy({}, { get() { throw new Error('trap'); }, getOwnPropertyDescriptor() { throw new Error('trap'); }, has() { throw new Error('trap'); } }),
    ];
    return pool[Math.floor(r * pool.length)]();
  };
  let bad = '';
  for (let i = 0; i < 4000 && !bad; i++) {
    let x;
    const shape = rnd();
    if (shape < 0.2) x = junk();
    else if (shape < 0.9) {
      x = {};
      for (const k of ['mode', 'level', 'mood', 'seed', 'extra', '__proto__', 'constructor']) if (rnd() < 0.6) x[k] = junk();
      if (rnd() < 0.3) Object.defineProperty(x, 'level', { get() { throw new Error('getter'); }, enumerable: true });
    } else {
      x = new Proxy({ mode: 'fx' }, { getOwnPropertyDescriptor() { throw new Error('trap'); } });
    }
    let r;
    try { r = readSound(x); } catch (e) { bad = `threw ${e}`; break; }
    if (r === undefined) continue;
    const keys = Object.keys(r);
    const okShape = SOUND_MODES.includes(r.mode) && Number.isFinite(r.level) && r.level >= 0 && r.level <= 1 && near(Math.round(r.level * 100) / 100, r.level, 1e-12)
      && (r.mood === undefined || MUSIC_MOODS.some((m) => m.id === r.mood))
      && (r.seed === undefined || (Number.isInteger(r.seed) && r.seed >= 0 && r.seed < 2147483647))
      && keys.every((k) => ['mode', 'level', 'mood', 'seed'].includes(k));
    if (!okShape) bad = `shape ${JSON.stringify(r)}`;
    else if (JSON.stringify(readSound(r)) !== JSON.stringify(r)) bad = `not a fixed point: ${JSON.stringify(r)}`;
  }
  ok('fuzz: 4000 inputs, each silence or a clean spec, a fixed point, nothing thrown', bad === '', bad);
  // And through the document reader, which calls readSound for the `sound` field.
  const d = readMotion({ title: 'x', layers: [], sound: { mode: 'both', level: 70, mood: 'arabic' } }, 1);
  ok('the document reader keeps a read spec', JSON.stringify(d.sound) === JSON.stringify({ mode: 'both', level: 0.7, mood: 'oriental' }));
  ok('and a graphic read again keeps it the same', JSON.stringify(readMotion(JSON.parse(JSON.stringify(d)), 1).sound) === JSON.stringify(d.sound));
  ok('a graphic with no sound field has none', !('sound' in readMotion({ title: 'x', layers: [] }, 1)));
}

// ── setting it ────────────────────────────────────────────────────────────

{
  const d = docOf([text({})], { sound: undefined });
  delete d.sound;
  ok('setting the defaults changes nothing', withSound(d, defaultSound(), 5) === d);
  const on = withSound(d, { mode: 'music', level: 0.6 }, 5);
  ok('turning it on is a new graphic, stamped', on !== d && on.sound.mode === 'music' && on.updated === 5 && d.sound === undefined);
  ok('setting the same again is the same graphic', withSound(on, { mode: 'music', level: 0.6 }, 9) === on);
  const off = withSound(on, { mode: 'off', level: 0.6 }, 6);
  ok('turning it off with nothing to remember removes the field', !('sound' in off));
  ok('what is set is read first', withSound(d, { mode: 'fx', level: 9000 }, 1).sound.level === 1);
}

// ── moods ─────────────────────────────────────────────────────────────────

{
  ok('the moods are videosynth\'s, in its order, with its labels',
    JSON.stringify(SOUND_MOODS) === JSON.stringify(MUSIC_MOODS.map((m) => ({ id: m.id, label: m.label }))));
  ok('a chosen mood is used', moodOf(docOf([], { sound: { mode: 'music', level: 0.6, mood: 'calm' } })) === 'calm');
  ok('else the template\'s', moodOf(docOf([], { sound: { mode: 'music', level: 0.6 }, recipe: { id: 'countdown', fields: {} } })) === 'epic'
    && moodOf(docOf([], { sound: { mode: 'music', level: 0.6 }, recipe: { id: 'bar-chart', fields: {} } })) === 'corporate');
  ok('else uplifting', moodOf(docOf([], { sound: { mode: 'music', level: 0.6 } })) === 'uplifting'
    && moodOf(docOf([], { recipe: { id: 'constructor', fields: {} } })) === 'uplifting');
}

// ── cues: one effect at a time ────────────────────────────────────────────

{
  // Text 6u is 0.6 of headline size: gain 0.3 + 0.55 × 0.6 = 0.63.
  const c = cuesOf([text({ start: 0.5, in: anim('slide', { delay: 0.2 }) })]);
  ok('slide: one whoosh when it starts, as long as it, at the layer\'s gain', c.length === 1 && c[0].kind === 'whoosh' && near(c[0].t, 0.7, 1e-4)
    && near(c[0].d, 0.5, 1e-3) && near(c[0].gain, 0.63, 1e-3) && c[0].rev === false && c[0].layer === 't', c);
  ok('its pitch varies a little, no more', c[0].pitch >= 0.97 && c[0].pitch <= 1.03);
  for (const fx of ['wipe', 'mask', 'spin', 'flip']) {
    const w = cuesOf([text({ in: anim(fx) })]);
    ok(`${fx}: a whoosh`, w.length === 1 && w[0].kind === 'whoosh' && near(w[0].gain, 0.63, 1e-3), w);
  }
  for (const fx of ['pop', 'zoom']) {
    const p = cuesOf([text({ in: anim(fx) })]);
    ok(`${fx}: a pop`, p.length === 1 && p[0].kind === 'pop' && p[0].t === 0 && near(p[0].gain, 0.63, 1e-3), p);
  }
  const tiny = cuesOf([blankLayer('shape', { id: 's', w: 5, h: 5, start: 0, end: 6, in: anim('pop') })]);
  ok('something tiny popping in: a click', tiny.length === 1 && tiny[0].kind === 'click', tiny);
  const rise = cuesOf([text({ in: anim('rise') })]);
  ok('words rising: a soft, shorter whoosh', rise.length === 1 && rise[0].kind === 'whoosh' && near(rise[0].gain, 0.63 * 0.55, 2e-3) && near(rise[0].d, 0.4, 1e-3), rise);
  const shapeRise = cuesOf([blankLayer('shape', { id: 's', w: 28, h: 28, start: 0, end: 6, in: anim('rise') })]);
  ok('a shape arriving: a pop', shapeRise.length === 1 && shapeRise[0].kind === 'pop' && near(shapeRise[0].gain, 0.85 * 0.75, 2e-3), shapeRise);
  ok('small words fading in: nothing', cuesOf([text({ in: anim('fade') })]).length === 0);
  const swell = cuesOf([text({ size: 10, in: anim('fade') })]);
  ok('a headline fading in: a swell, longer than the fade', swell.length === 1 && swell[0].kind === 'swell' && near(swell[0].gain, 0.425, 2e-3) && near(swell[0].d, 0.75, 1e-3), swell);
  const fadeShape = cuesOf([blankLayer('shape', { id: 's', w: 28, h: 28, start: 0, end: 6, in: anim('fade') })]);
  ok('a shape fading in: a soft pop', fadeShape.length === 1 && fadeShape[0].kind === 'pop' && near(fadeShape[0].gain, 0.51, 2e-3), fadeShape);
  ok('a panel the size of the frame fading in: nothing', cuesOf([blankLayer('shape', { id: 's', w: 70, h: 70, start: 0, end: 6, in: anim('fade') })]).length === 0);
  const grow = cuesOf([blankLayer('shape', { id: 's', w: 28, h: 28, start: 0, end: 6, in: anim('grow') })]);
  const draw = cuesOf([blankLayer('shape', { id: 's', w: 28, h: 28, start: 0, end: 6, in: anim('draw') })]);
  ok('a bar growing, a stroke drawing: quiet whooshes', grow[0]?.kind === 'whoosh' && near(grow[0].gain, 0.85 * 0.45, 2e-3)
    && draw[0]?.kind === 'whoosh' && near(draw[0].gain, 0.85 * 0.35, 2e-3), { grow, draw });

  const typed = cuesOf([text({ text: 'HELLO', in: anim('type', { d: 1 }) })]);
  ok('typing: a key as each letter appears', typed.length === 5 && typed.every((k) => k.kind === 'key')
    && [0.1, 0.3, 0.5, 0.7, 0.9].every((t, i) => near(typed[i].t, t, 1e-4)) && near(typed[0].gain, 0.378, 2e-3), typed.map((k) => k.t));
  const fast = cuesOf([text({ text: 'A quick line of typed words', in: anim('type', { d: 0.6 }) })]);
  ok('fast typing is thinned to one key per 90 ms', fast.length > 3 && dense(fast, 8) === '' && fast.length <= Math.ceil(0.6 / 0.09) + 1, fast.length);

  const words = cuesOf([text({ text: 'one two three', in: anim('rise', { d: 0.4, gap: 0.2, by: 'word' }) })]);
  ok('words arriving one by one: one whoosh each, the later ones softer', words.length === 3 && words.map((w) => w.t).join() === '0,0.2,0.4'
    && near(words[0].gain, 0.3465, 2e-3) && near(words[1].gain, 0.3465 * 0.7, 2e-3) && near(words[0].d, 0.32, 1e-3), words);
  const chars = cuesOf([text({ text: 'abcdef', in: anim('slide', { d: 0.4, gap: 0.05, by: 'char' }) })]);
  ok('letters arriving one by one: one gesture, as long as all of them', chars.length === 1 && near(chars[0].d, 0.4 + 5 * 0.05, 1e-3), chars);

  const big = cuesOf([text({ size: 12, in: anim('slide') })]);
  const hit = only(big, 'impact');
  ok('a big title landing: the whoosh, then an impact when it is 95% in', big.length === 2 && big[0].kind === 'whoosh' && near(big[0].gain, 0.96, 1e-3)
    && hit.length === 1 && near(hit[0].t, 0.475, 1e-4) && near(hit[0].gain, 0.63, 2e-3), big);
  const eased = only(cuesOf([text({ size: 12, in: anim('slide', { ease: 'expo-out' }) })]), 'impact');
  ok('on an easing curve the impact comes when it reads as landed, not at the curve\'s end', eased.length === 1 && eased[0].t < 0.25, eased);
  ok('a big title typing in does not land', only(cuesOf([text({ size: 12, text: 'BIG', in: anim('type') })]), 'impact').length === 0);

  const count = cuesOf([blankLayer('counter', { id: 'c', from: 0, to: 100, size: 6, start: 0, end: 6, count: { d: 1, delay: 0, ease: 'linear' } })]);
  const ticks = only(count, 'tick');
  ok('a counter rolling: ticks, one per 90 ms at most, every other sixteenth on a linear roll', ticks.length === 8
    && ticks.every((k, i) => near(k.t, 0.0625 * (2 * i + 1), 1e-4)), ticks.map((k) => k.t));
  ok('rising in pitch as it rolls', ticks[7].pitch > ticks[0].pitch + 0.2, ticks.map((k) => k.pitch));
  ok('a small number does not land', only(count, 'impact').length === 0);
  const bigCount = cuesOf([blankLayer('counter', { id: 'c', from: 0, to: 100, size: 12, start: 0, end: 6, count: { d: 1, delay: 0, ease: 'linear' } })]);
  const landed = only(bigCount, 'impact');
  ok('a big number lands with an impact when its roll is 98% done', landed.length === 1 && near(landed[0].t, 236 / 240, 1e-4) && near(landed[0].gain, 0.63, 2e-3), landed);
  ok('a counter that does not move does not tick', cuesOf([blankLayer('counter', { id: 'c', from: 5, to: 5, size: 6, start: 0, end: 6, count: { d: 1, delay: 0, ease: 'linear' } })]).length === 0);

  const chart = cuesOf([blankLayer('chart', { id: 'k', w: 45, h: 45, gap: 0.1, start: 0, end: 6, in: anim('grow', { d: 0.6 }) })]);
  ok('a chart growing: a riser as long as its data take', chart.length === 1 && chart[0].kind === 'riser' && near(chart[0].d, 0.8, 1e-3) && near(chart[0].gain, 0.68, 2e-3), chart);

  const burst = cuesOf([blankLayer('particles', { id: 'p', style: 'confetti', burst: true, start: 1, end: 6 })]);
  ok('a burst of particles: a sparkle', burst.length === 1 && burst[0].kind === 'sparkle' && burst[0].t === 1 && near(burst[0].gain, 0.6, 1e-3)
    && near(burst[0].d, 0.7, 1e-3) && burst[0].pitch > 0.85 && burst[0].pitch < 0.95, burst);
  const stream = cuesOf([blankLayer('particles', { id: 'p', style: 'snow', burst: false, start: 0, end: 6 })]);
  ok('a stream of particles: a quieter, longer one', stream.length === 1 && near(stream[0].gain, 0.35, 1e-3) && near(stream[0].d, 1.2, 1e-3), stream);

  const shine = cuesOf([blankLayer('icon', { id: 'i', size: 14, start: 0, end: 10, loop: { fx: 'shimmer', d: 2, amount: 1 } })], { seconds: 10 });
  ok('a shimmer: a small sparkle each pass, three at most', shine.length === 3 && shine.every((s) => s.kind === 'sparkle')
    && shine.map((s) => s.t).join() === '0.7,2.7,4.7', shine.map((s) => s.t));

  const ground = cuesOf([blankLayer('backdrop', { id: 'b', start: 0, end: 6 })]);
  ok('a backdrop that is simply there: a short, quiet swell at the start', ground.length === 1 && ground[0].kind === 'swell' && ground[0].t === 0
    && near(ground[0].gain, 0.3, 1e-3) && near(ground[0].d, 1.68, 1e-3) && ground[0].pan === 0, ground);

  const leave = cuesOf([text({ end: 5, out: anim('slide') })]);
  ok('an exit: the whoosh played backwards, as it starts to leave', leave.length === 1 && leave[0].kind === 'whoosh' && leave[0].rev === true
    && near(leave[0].t, 4.5, 1e-4) && near(leave[0].gain, 0.3465, 2e-3), leave);
  ok('fading out is silent', cuesOf([text({ end: 5, out: anim('fade') })]).length === 0);
  ok('a hidden layer is silent', cuesOf([text({ hidden: true, in: anim('pop') })]).length === 0);
  ok('an invisible layer is silent', cuesOf([text({ opacity: 0, in: anim('pop') })]).length === 0);
  // The reader brings a layer inside the graphic, so these are set after reading, the way a stale edit could leave them.
  const outside = (o) => {
    const d = docOf([text({ in: anim('pop', { d: 0.05 }) })]);
    d.layers = [{ ...d.layers[0], ...o }];
    return soundCues(d);
  };
  ok('a layer after the end is silent', outside({ start: 6.5, end: 9 }).length === 0);
  ok('no sound starts in the last instant', outside({ start: 5.99, end: 6 }).length === 0);
  ok('every effect in the list makes finite cues', EFFECTS.every((fx) => cuesOf([text({ in: anim(fx), out: anim(fx), end: 5 })]).every((c) => finiteCue(c, 6))));
}

// ── where a sound is heard ────────────────────────────────────────────────

{
  const at = (pin, x, lang) => cuesOf([text({ pin, x, in: anim('pop') })], { lang })[0].pan;
  const en = at('ms', 8, 'en');
  const ar = at('ms', 8, 'ar');
  // 5 letters × 6u × 0.55 = 16.5u wide, from 8u in: centred 16.25u across a 177.8u frame.
  ok('a layer at the start side is heard there: left in English', near(en, ((16.25 / (1920 / 1080 * 100)) * 2 - 1) * 0.7, 2e-3), en);
  ok('and right in Arabic, exactly mirrored', near(ar, -en, 1.5e-3), { en, ar });
  ok('centred is in the middle', at('mc', 0, 'en') === 0 && at('mc', 0, 'ckb') === 0);
  ok('the end side is the other ear', at('me', -8, 'en') > 0.4 && at('me', -8, 'kmr') < -0.4);
  ok('never hard into one ear', at('ts', -400, 'en') >= -0.7 && at('te', 400, 'en') <= 0.7);
}

// ── thinning ──────────────────────────────────────────────────────────────

{
  // Sixty layers sliding in within 0.6 s, sixty counters rolling, a burst on top.
  const crowd = [];
  for (let i = 0; i < 30; i++) crowd.push(text({ id: `w${i}`, size: 3 + (i % 9), start: 1 + i * 0.02, in: anim(i % 2 ? 'slide' : 'pop') }));
  for (let i = 0; i < 25; i++) crowd.push(blankLayer('counter', { id: `c${i}`, from: 0, to: 1000, size: 4 + (i % 10), start: i * 0.3, end: 12, count: { d: 2, delay: 0, ease: 'expo-out' } }));
  crowd.push(blankLayer('particles', { id: 'p', burst: true, start: 2, end: 12 }));
  for (const level of [0.1, 0.6, 1]) {
    const d = docOf(crowd, { seconds: 12, sound: { mode: 'fx', level } });
    const c = soundCues(d);
    const cap = Math.round(4 + 6 * level);
    ok(`level ${level}: no kind crowds itself, no second holds more than ${cap}`, dense(c, cap) === '' && c.length > 0 && c.length <= 240, dense(c, cap));
    ok(`level ${level}: every cue finite, in time order`, c.every((x) => finiteCue(x, 12)) && c.every((x, i) => i === 0 || c[i - 1].t <= x.t));
  }
  const quiet = soundCues(docOf(crowd, { seconds: 12, sound: { mode: 'fx', level: 0.1 } }));
  const normal = soundCues(docOf(crowd, { seconds: 12, sound: { mode: 'fx', level: 0.6 } }));
  ok('a lower level keeps fewer cues', quiet.length < normal.length, { quiet: quiet.length, normal: normal.length });
  ok('and what it keeps matters most: no tick survives at 0.1', only(quiet, 'tick').length === 0 && only(normal, 'tick').length > 0);
  const impacts = [text({ id: 'a', size: 12, in: anim('pop') }), text({ id: 'b', size: 12, start: 0.2, in: anim('pop') })];
  const two = only(cuesOf(impacts), 'impact');
  ok('two impacts closer than half a second are one', two.length === 1, two);
}

// ── keys and determinism ──────────────────────────────────────────────────

{
  const d = buildMotion({ id: 'k1', recipe: 'stats', lang: 'en', format: 'landscape', now: 1 });
  d.sound = { mode: 'both', level: 0.6 };
  const again = buildMotion({ id: 'k1', recipe: 'stats', lang: 'en', format: 'landscape', now: 1 });
  again.sound = { mode: 'both', level: 0.6 };
  ok('the same graphic gives the same cues and the same key', JSON.stringify(soundCues(d)) === JSON.stringify(soundCues(again)) && soundKey(d) === soundKey(again));
  ok('a key is sixteen hex digits', /^[0-9a-f]{16}$/.test(soundKey(d)));
  ok('silence has one key', soundKey({ ...d, sound: { mode: 'off', level: 0.6 } }) === 'silent' && soundKey({ ...d, sound: undefined }) === 'silent'
    && soundKey({ ...d, sound: { mode: 'fx', level: 0 } }) === 'silent');
  const k = soundKey(d);
  ok('a new colour changes nothing that is heard', soundKey({ ...d, palette: { ...d.palette, accent: '#123456' }, title: 'Other' }) === k);
  ok('the level changes it', soundKey({ ...d, sound: { mode: 'both', level: 0.5 } }) !== k);
  ok('the mode changes it', soundKey({ ...d, sound: { mode: 'fx', level: 0.6 } }) !== k);
  ok('the mood changes it', soundKey({ ...d, sound: { mode: 'both', level: 0.6, mood: 'calm' } }) !== k);
  ok('the seed changes it', soundKey({ ...d, sound: { mode: 'both', level: 0.6, seed: 3 } }) !== k);
  const moved = { ...d, layers: d.layers.map((l) => (l.id === 'stats-title' ? { ...l, start: l.start + 0.5 } : l)) };
  ok('moving a layer in time changes it', soundKey(moved) !== k);
  ok('music alone does not hang on the effects\' grain', soundKey({ ...d, sound: { mode: 'music', level: 0.6 } })
    === soundKey({ ...d, layers: d.layers.map((l) => ({ ...l, id: `${l.id}x` })), sound: { mode: 'music', level: 0.6 } }));
}

// ── the effects themselves ────────────────────────────────────────────────

/** The loudest 50 ms of a sound, as RMS. */
function shortRms(buf, rate) {
  const w = Math.round(0.05 * rate);
  let best = 0;
  for (let s = 0; s === 0 || s + w <= buf.length; s += Math.round(0.005 * rate)) {
    let e = 0;
    for (let i = s; i < Math.min(buf.length, s + w); i++) e += buf[i] * buf[i];
    best = Math.max(best, e / w);
  }
  return Math.sqrt(best);
}

{
  const rate = 48000;
  const len = { pop: 0.16, tick: 0.045, key: 0.08, click: 0.03, impact: 1.5 };
  for (const kind of SFX_KINDS) {
    const s = synth({ kind, d: 0.8, pitch: 1, rev: false, seed: 9 }, rate);
    const want = len[kind] ?? 0.8 + { whoosh: 0.06, sparkle: 0.3, riser: 0.1, swell: 0.35 }[kind];
    const level = db(shortRms(s, rate));
    ok(`${kind}: its length, finite, starting and ending on zero, at the reference level`,
      s.length === Math.round(want * rate) && s.every(Number.isFinite) && s[0] === 0 && s[s.length - 1] === 0 && near(level, SFX_REF_DB, 0.15),
      { len: s.length, want: Math.round(want * rate), first: s[0], last: s[s.length - 1], level });
    const again = synth({ kind, d: 0.8, pitch: 1, rev: false, seed: 9 }, rate);
    const other = synth({ kind, d: 0.8, pitch: 1, rev: false, seed: 10 }, rate);
    ok(`${kind}: the same seed, the same samples; another seed, another sound`,
      Buffer.compare(Buffer.from(s.buffer), Buffer.from(again.buffer)) === 0 && Buffer.compare(Buffer.from(s.buffer), Buffer.from(other.buffer)) !== 0);
    // The edges rise from zero, not jump: no sample-to-sample step near either end is larger than the sound's own.
    let edge = 0, body = 0;
    const m = Math.round(0.0015 * rate);
    for (let i = 1; i < s.length; i++) {
      const step = Math.abs(s[i] - s[i - 1]);
      if (i < m || i > s.length - m) edge = Math.max(edge, step); else body = Math.max(body, step);
    }
    ok(`${kind}: no click at either end`, edge <= body + 1e-9, { edge, body });
  }
  const loudAt = (s) => {
    let at = 0, best = 0;
    for (let i = 0; i < s.length; i++) if (Math.abs(s[i]) > best) { best = Math.abs(s[i]); at = i; }
    return at / s.length;
  };
  const fwd = synth({ kind: 'whoosh', d: 1, pitch: 1, rev: false, seed: 1 }, rate);
  const back = synth({ kind: 'whoosh', d: 1, pitch: 1, rev: true, seed: 1 }, rate);
  ok('an entrance\'s whoosh peaks early, an exit\'s late', loudAt(fwd) < 0.45 && loudAt(back) > 0.55, { fwd: loudAt(fwd), back: loudAt(back) });
  const r = synth({ kind: 'riser', d: 2, pitch: 1, rev: false, seed: 1 }, rate);
  ok('a riser gets louder as it climbs', shortRms(r.subarray(Math.round(1.5 * rate), Math.round(1.9 * rate)), rate) > 3 * shortRms(r.subarray(Math.round(0.3 * rate), Math.round(0.7 * rate)), rate));
  const sweep = synth({ kind: 'whoosh', d: 9, pitch: 9, rev: false, seed: 1 }, rate);
  ok('lengths and pitches are held to their range', sweep.length === Math.round((1.6 + 0.06) * rate));
  const odd = synth({ kind: 'nonsense', d: NaN, pitch: NaN, seed: NaN }, NaN);
  ok('an unknown effect is a click, at a sane rate', odd.length === Math.round(0.03 * 48000) && odd.every(Number.isFinite));
  ok('another rate, the same sound in time', synth({ kind: 'impact', d: 0, pitch: 1, rev: false, seed: 1 }, 22050).length === Math.round(1.5 * 22050));
}

// ── beds ──────────────────────────────────────────────────────────────────

/** True peak, 4x oversampled by a Hann-windowed sinc, looked for around every sample within 6 dB of the sample peak. */
function truePeakDb(chs) {
  const taps = 16;
  const h = (x) => (x === 0 ? 1 : (Math.sin(Math.PI * x) / (Math.PI * x)) * (0.5 + 0.5 * Math.cos((Math.PI * x) / (taps + 1))));
  let peak = 0;
  for (const c of chs) {
    let sp = 0;
    for (const v of c) sp = Math.max(sp, Math.abs(v));
    peak = Math.max(peak, sp);
    for (let i = 0; i < c.length - 1; i++) {
      if (Math.abs(c[i]) < sp * 0.5 && Math.abs(c[i + 1]) < sp * 0.5) continue;
      for (const f of [0.25, 0.5, 0.75]) {
        let s = 0;
        for (let j = -taps + 1; j <= taps; j++) {
          const k = i + j;
          if (k >= 0 && k < c.length) s += c[k] * h(f - j);
        }
        peak = Math.max(peak, Math.abs(s));
      }
    }
  }
  return db(peak);
}

/** ITU-R BS.1770 integrated loudness, written out here so the report can say what an exact meter reads (loudness.ts may be the placeholder). */
function bs1770(chs, sr) {
  const pre = (() => {
    const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    const K = Math.tan(Math.PI * f0 / sr), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1 + K / Q + K * K;
    return [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  })();
  const rlb = (() => {
    const f0 = 38.13547087602444, Q = 0.5003270373238773, K = Math.tan(Math.PI * f0 / sr), a0 = 1 + K / Q + K * K;
    return [1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  })();
  const n = chs[0].length, block = Math.round(0.4 * sr), hop = Math.round(0.1 * sr);
  const hopSum = new Float64Array(Math.ceil(n / hop) + 1);
  for (const x of chs) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, z1 = 0, z2 = 0;
    for (let i = 0; i < n; i++) {
      const v = x[i];
      const y = pre[0] * v + pre[1] * x1 + pre[2] * x2 - pre[3] * y1 - pre[4] * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = y;
      const z = y - 2 * u1 + u2 - rlb[3] * z1 - rlb[4] * z2;
      u2 = u1; u1 = y; z2 = z1; z1 = z;
      hopSum[Math.floor(i / hop)] += z * z;
    }
  }
  const blocks = [];
  for (let b = 0; b + block / hop <= Math.floor(n / hop); b++) {
    let s = 0;
    for (let k = 0; k < block / hop; k++) s += hopSum[b + k];
    blocks.push(s / block);
  }
  const L = (m) => -0.691 + 10 * Math.log10(m);
  const abs = blocks.filter((m) => m > 0 && L(m) > -70);
  if (!abs.length) return -Infinity;
  const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((m) => L(m) > rel);
  return L(gated.reduce((a, b) => a + b, 0) / gated.length);
}

/** Plays a score with plain sines (Node has no Web Audio): enough to test the mix, nothing like the real instruments. */
const mtof = (p) => 440 * Math.pow(2, (p - 69) / 12);
let lastScore = null;
async function standIn(score, rate) {
  lastScore = score;
  const n = Math.max(1, Math.round(score.seconds * rate));
  const L = new Float32Array(n), R = new Float32Array(n);
  for (const note of score.notes) {
    const f = Math.min(5000, Math.max(40, mtof(note.p)));
    const from = Math.round(note.t * rate);
    const len = Math.min(n - from, Math.round(Math.min(note.d, 0.6) * rate));
    const w = (2 * Math.PI * f) / rate;
    for (let i = 0; i < len; i++) {
      const s = Math.sin(w * i) * Math.min(1, i / (0.005 * rate)) * Math.exp(-i / (0.3 * rate)) * note.v * 0.05;
      L[from + i] += s;
      R[from + i] += s * 0.9;
    }
  }
  return [L, R];
}
/** A steady 1 kHz tone as the "music", so a dip in it can be measured. */
async function tone(score, rate) {
  const n = Math.max(1, Math.round(score.seconds * rate));
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / rate);
  return [a, a.slice()];
}
/** The amplitude of `f` Hz in a stretch of samples (Goertzel). */
function amplitudeAt(x, from, to, f, rate) {
  const w = (2 * Math.PI * f) / rate, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = from; i < to; i++) {
    const s = x[i] + c * s1 - s2;
    s2 = s1; s1 = s;
  }
  return (2 * Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2)) / (to - from);
}

const animated = (sound, o = {}) => {
  const d = buildMotion({ id: o.id ?? 'bed1', recipe: o.recipe ?? 'stats', lang: 'en', format: 'landscape', now: 1, seconds: o.seconds });
  d.sound = sound;
  return d;
};
const still = (sound) => docOf([text({})], { sound });

{
  ok('off: no bed', (await renderSoundBed(animated({ mode: 'off', level: 0.6 }))) === null && (await renderSoundBed(animated(undefined))) === null);
  ok('level 0: no bed', (await renderSoundBed(animated({ mode: 'fx', level: 0 }))) === null);
  ok('effects on a graphic with no motion: no bed', (await renderSoundBed(still({ mode: 'fx', level: 0.6 }))) === null);
  ok('not a graphic at all: no bed', (await renderSoundBed(null)) === null && (await renderSoundBed({})) === null);

  for (const [seconds, rate] of [[5.5, 44100], [5.5, 48000], [5.5, 22050], [1, 48000], [7.25, 32000]]) {
    const bed = await renderSoundBed(animated({ mode: 'fx', level: 0.6 }, { seconds }), { sampleRate: rate });
    const n = Math.round(seconds * rate);
    ok(`effects bed, ${seconds} s at ${rate} Hz: two channels of exactly ${n} samples, all finite`,
      bed && bed.sampleRate === rate && bed.channels.length === 2 && bed.channels.every((c) => c.length === n && c.every(Number.isFinite)),
      bed && bed.channels.map((c) => c.length));
  }

  const t0 = performance.now();
  const fx10 = await renderSoundBed(animated({ mode: 'fx', level: 0.6, seed: 77 }, { recipe: 'steps', seconds: 10 }));
  const fxMs = performance.now() - t0;
  ok(`a 10 s effects bed in under 400 ms (${fxMs.toFixed(0)} ms, ${soundCues(animated({ mode: 'fx', level: 0.6, seed: 77 }, { recipe: 'steps', seconds: 10 })).length} cues)`, fx10 && fxMs < 400, fxMs);
  const tp = truePeakDb(fx10.channels);
  ok(`effects bed: true peak under −1.5 dBTP (${tp.toFixed(2)})`, tp < -1.5, tp);
  const m = measureLoudness(fx10.channels, 48000);
  console.log(`  info  effects bed: loudness.ts reads ${m.lufs.toFixed(2)} LUFS, an exact BS.1770 meter ${bs1770(fx10.channels, 48000).toFixed(2)} LUFS`);
  ok('the bed starts and ends on silence', fx10.channels.every((c) => c[0] === 0 && Math.abs(c[c.length - 1]) < 1e-6));

  const t1 = performance.now();
  const hit = await renderSoundBed(animated({ mode: 'fx', level: 0.6, seed: 77 }, { recipe: 'steps', seconds: 10 }));
  const hitMs = performance.now() - t1;
  ok(`asked again, it is kept (${hitMs.toFixed(1)} ms) and the same`, hitMs < 30 && hit.channels.every((c, i) => Buffer.compare(Buffer.from(c.buffer), Buffer.from(fx10.channels[i].buffer)) === 0));
  hit.channels[0].fill(0);
  const third = await renderSoundBed(animated({ mode: 'fx', level: 0.6, seed: 77 }, { recipe: 'steps', seconds: 10 }));
  ok('each caller gets its own copy', third.channels[0].some((v) => v !== 0));

  // Music, with the stand-in player.
  let err = null;
  try { await renderSoundBed(animated({ mode: 'music', level: 0.6, seed: 5 })); } catch (e) { err = e; }
  ok('without Web Audio, music says so rather than making silence', err instanceof Error && /cannot make sound/.test(err.message), err?.message);

  const both = animated({ mode: 'both', level: 0.6, seed: 4 }, { seconds: 10 });
  const t2 = performance.now();
  const bothBed = await renderSoundBed(both, { music: standIn });
  const bothMs = performance.now() - t2;
  const L = measureLoudness(bothBed.channels, 48000);
  ok(`both: −16 LUFS within 1 LU (${L.lufs.toFixed(2)})`, Math.abs(L.lufs + 16) <= 1, L);
  const tpBoth = truePeakDb(bothBed.channels);
  ok(`both: true peak under −1.5 dBTP (${tpBoth.toFixed(2)})`, tpBoth < -1.5, tpBoth);
  ok('the contract\'s own rule agrees there is nothing left to take off', gainToTarget(L, -16, -1.5) >= 0.999);
  console.log(`  info  both, 10 s, stand-in player: ${bothMs.toFixed(0)} ms; exact BS.1770 reads ${bs1770(bothBed.channels, 48000).toFixed(2)} LUFS`);
  ok('the composer was given the graphic\'s length and its accents', lastScore && lastScore.seconds === 10
    && musicCuesOf(both).every((c) => lastScore.cues.some((q) => Math.abs(q - c) <= lastScore.beat / 2 + 1e-6)), { want: musicCuesOf(both), got: lastScore?.cues });
  ok('in the graphic\'s mood', lastScore.mood === moodOf(both) && moodOf(both) === 'corporate');

  const quieter = await renderSoundBed({ ...both, sound: { mode: 'both', level: 0.3, seed: 4 } }, { music: standIn });
  const Lq = measureLoudness(quieter.channels, 48000);
  ok(`level 0.3 is the level's 6 dB quieter (${Lq.lufs.toFixed(2)} LUFS)`, Math.abs(Lq.lufs - loudnessFor(0.3)) <= 1, Lq);
  ok('loudness by level: −16 at 0.6, −14 at 1, the decibels below, silence at 0', loudnessFor(0.6) === -16 && loudnessFor(1) === -14
    && near(loudnessFor(0.3), -16 + db(0.5), 1e-9) && loudnessFor(0) === -Infinity && near(loudnessFor(0.8), -15, 1e-9));

  // The fades and the dips, heard in a steady tone.
  const dipDoc = docOf([text({ size: 12, start: 2, in: anim('pop', { d: 0.3 }) })], { seconds: 6, sound: { mode: 'both', level: 0.6, seed: 1 } });
  const impactAt = only(soundCues(dipDoc), 'impact')[0].t;
  const dipBed = await renderSoundBed(dipDoc, { music: tone });
  const ch = dipBed.channels[1];
  const r = 48000;
  const steady = amplitudeAt(ch, Math.round(4.0 * r), Math.round(4.2 * r), 1000, r);
  const dipped = amplitudeAt(ch, Math.round((impactAt + 0.16) * r), Math.round((impactAt + 0.2) * r), 1000, r);
  ok(`the music dips under the impact, to about 0.6 (${(dipped / steady).toFixed(2)})`, dipped / steady > 0.5 && dipped / steady < 0.72, { steady, dipped });
  const start = amplitudeAt(ch, 0, Math.round(0.05 * r), 1000, r);
  const end = amplitudeAt(ch, ch.length - Math.round(0.05 * r), ch.length, 1000, r);
  ok('it fades in over 0.3 s and out at the end', start < steady * 0.1 && end < steady * 0.1, { start, end, steady });

  // The modes, on a graphic that moves and one that does not.
  const rows = [];
  for (const mode of SOUND_MODES) {
    for (const [name, make] of [['moving', () => animated({ mode, level: 0.6 }, { recipe: 'big-number' })], ['still', () => still({ mode, level: 0.6 })]]) {
      const bed = await renderSoundBed(make(), { music: standIn, sampleRate: 16000 });
      rows.push(`${mode}/${name}:${bed ? 'bed' : 'none'}`);
    }
  }
  ok('the modes: off is silent; effects need motion; music and both always sound',
    rows.join(' ') === 'off/moving:none off/still:none fx/moving:bed fx/still:none music/moving:bed music/still:bed both/moving:bed both/still:bed', rows.join(' '));

  // Stopping.
  const ctl = new AbortController();
  ctl.abort();
  let stopped = null;
  try { await renderSoundBed(animated({ mode: 'fx', level: 0.6 }), { signal: ctl.signal }); } catch (e) { stopped = e; }
  ok('a stopped signal stops it before anything is made', stopped?.name === 'AbortError');
  const late = new AbortController();
  const slow = (score, rate) => new Promise((res) => setTimeout(() => res(standIn(score, rate)), 20));
  const run = renderSoundBed(animated({ mode: 'both', level: 0.6, seed: 99 }), { music: slow, signal: late.signal });
  setTimeout(() => late.abort(), 5);
  let midway = null;
  try { await run; } catch (e) { midway = e; }
  ok('and one stopped part-way stops it there', midway?.name === 'AbortError', midway?.message);
}

// ── every template, every shape, every language ──────────────────────────

{
  let bad = '';
  let count = 0;
  for (const id of RECIPE_IDS) {
    if (!RECIPES[id]) continue;
    for (const format of FORMAT_IDS) {
      for (const lang of ['en', 'ar', 'ckb', 'kmr']) {
        const d = buildMotion({ id: `s-${id}`, recipe: id, lang, format, now: 1 });
        d.sound = { mode: 'both', level: 0.6 };
        const c = soundCues(d);
        count += c.length;
        if (!c.every((x) => finiteCue(x, d.seconds))) bad = `${id} ${format} ${lang}: a cue out of range`;
        else if (dense(c, 8)) bad = `${id} ${format} ${lang}: ${dense(c, 8)}`;
        else if (!musicCuesOf(d).every((t) => t > 0 && t < d.seconds)) bad = `${id} ${format} ${lang}: a music cue out of range`;
      }
    }
  }
  ok(`every template in every shape and language: cues in range and within their limits (${count} cues)`, bad === '', bad);
  const silentOnes = [];
  let worst = -Infinity;
  for (const id of RECIPE_IDS) {
    if (!RECIPES[id]) continue;
    for (const [lang, format, rate] of [['ar', 'portrait', 16000], ['en', 'landscape', 48000]]) {
      const d = buildMotion({ id: `b-${id}`, recipe: id, lang, format, now: 1 });
      d.sound = { mode: 'fx', level: 1 };
      const bed = await renderSoundBed(d, { sampleRate: rate });
      if (!bed) { silentOnes.push(id); continue; }
      const peak = truePeakDb(bed.channels);
      worst = Math.max(worst, peak);
      if (!bed.channels.every((c) => c.length === Math.round(d.seconds * rate) && c.every(Number.isFinite))) bad = `${id}: a bad bed`;
      else if (peak >= -1.5) bad = `${id} at ${rate} Hz: true peak ${peak}`;
    }
  }
  ok(`every template's effects bed, at 16 and 48 kHz, is the right length, finite, under −1.5 dBTP (worst ${worst.toFixed(2)})`, bad === '', bad);
  ok('and every template makes some sound', silentOnes.length === 0, silentOnes);
}

// Fuzz: graphics of random layers, read the studio's way.
{
  let seed = 99;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pickOf = (a) => a[Math.floor(rnd() * a.length)];
  const kinds = ['text', 'shape', 'icon', 'counter', 'chart', 'backdrop', 'particles'];
  let bad = '';
  for (let i = 0; i < 150 && !bad; i++) {
    const seconds = 1 + Math.floor(rnd() * 30);
    const layers = [];
    for (let j = 0; j < 1 + Math.floor(rnd() * 20); j++) {
      const start = rnd() * seconds;
      layers.push({
        kind: pickOf(kinds), id: `l${j}`, text: 'some words here', size: rnd() * 40, w: rnd() * 100, h: rnd() * 100, from: rnd() * 1000, to: rnd() * 1000,
        start, end: start + rnd() * seconds, pin: pickOf(['ts', 'mc', 'be', 'ms', 'xx']), x: rnd() * 800 - 400, scale: rnd() * 5,
        in: rnd() < 0.8 ? { fx: pickOf(EFFECTS), d: rnd() * 3, delay: rnd(), ease: pickOf(['linear', 'back-out', 'spring', 'bounce-out']), by: pickOf(['all', 'word', 'char', 'line']), gap: rnd() } : undefined,
        out: rnd() < 0.5 ? { fx: pickOf(EFFECTS), d: rnd() * 2 } : undefined,
        loop: rnd() < 0.2 ? { fx: 'shimmer', d: rnd() * 5 } : undefined,
        count: { d: rnd() * 4, delay: rnd(), ease: pickOf(['linear', 'expo-out', 'elastic-out']) }, burst: rnd() < 0.5, opacity: rnd() < 0.1 ? 0 : 1,
      });
    }
    const d = readMotion({ title: 'f', seconds, lang: pickOf(['en', 'ar']), format: pickOf(FORMAT_IDS), layers }, 1);
    const level = Math.round(rnd() * 100) / 100;
    d.sound = { mode: 'fx', level };
    let c;
    try { c = soundCues(d); } catch (e) { bad = `threw ${e}`; break; }
    const cap = Math.round(4 + 6 * level);
    if (!c.every((x) => finiteCue(x, d.seconds))) bad = `cue out of range in graphic ${i}`;
    else if (dense(c, cap)) bad = `graphic ${i}: ${dense(c, cap)}`;
    else if (!/^[0-9a-f]{16}$|^silent$/.test(soundKey(d))) bad = `key ${soundKey(d)}`;
  }
  ok('fuzz: 150 random graphics, every cue finite, in range and within the limits', bad === '', bad);
}

// ── the preview ───────────────────────────────────────────────────────────

/** A recording stand-in for an AudioContext: what was started where, what was stopped, what was resumed. */
class FakeParam {
  constructor(v) { this.value = v; this.events = []; }
  setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v; }
  linearRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]); this.value = v; }
  cancelScheduledValues(t) { this.events.push(['cancel', t]); }
  setTargetAtTime(v, t, c) { this.events.push(['target', v, t, c]); this.value = v; }
}
class FakeNode {
  constructor() { this.out = []; }
  connect(n) { this.out.push(n); return n; }
  disconnect() { this.out = []; }
}
class FakeCtx {
  constructor(state = 'running') {
    this.state = state; this.currentTime = 0; this.sampleRate = 16000; this.destination = new FakeNode();
    this.sources = []; this.resumes = 0; this.closed = false; this.onstatechange = null; this.allowed = state === 'running';
  }
  createGain() { const n = new FakeNode(); n.gain = new FakeParam(1); return n; }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, copyToChannel: (src, i) => data[i].set(src.subarray(0, length)), data };
  }
  createBufferSource() {
    const s = new FakeNode();
    s.playbackRate = new FakeParam(1);
    s.started = null; s.stopped = null; s.onended = null;
    s.start = (when, offset) => { s.started = { when, offset }; };
    s.stop = (when) => { s.stopped = when ?? this.currentTime; };
    this.sources.push(s);
    return s;
  }
  /** Resuming works only once a person has done something (`allowed`), as in WebKit. */
  resume() {
    this.resumes++;
    if (!this.allowed) return Promise.resolve();
    this.state = 'running';
    this.onstatechange?.();
    return Promise.resolve();
  }
  close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
}
const live = (ctx) => ctx.sources.filter((s) => s.started && s.stopped === null);

{
  // The default, in Node: no AudioContext anywhere.
  setAudioFactory(null);
  const fxDoc = animated({ mode: 'fx', level: 0.6, seed: 3 }, { recipe: 'big-number' });
  ok('without Web Audio, nothing to play and nothing thrown', (await prepare(fxDoc)) === false);
  let threw = false;
  try { play(1); follow({ t: 2, playing: true, speed: 1 }); seek(3); setLevel(0.2); pause(); wake(); dispose(); } catch { threw = true; }
  ok('every call is harmless', !threw && position() === 0);
  setAudioFactory(() => null);
  ok('nor with a factory that makes none', (await prepare(fxDoc)) === false);

  let ctx = new FakeCtx();
  setAudioFactory(() => ctx);
  ok('a silent graphic never makes a context', (await prepare(still({ mode: 'off', level: 0.6 }))) === false && ctx.sources.length === 0);
  ok('a graphic with sound gets ready', (await prepare(fxDoc)) === true);
  ok('and is not rendered twice', (await prepare(fxDoc)) === true);
  ok('nothing plays until asked', live(ctx).length === 0);
  play(1);
  const first = live(ctx)[0];
  ok('play: one buffer source, from the second asked, at speed 1', live(ctx).length === 1 && first.started.offset === 1 && first.playbackRate.value === 1
    && first.buffer.duration === fxDoc.seconds && first.buffer.sampleRate === 16000);
  ok('through its own fade-in, to the master, to the speakers', first.out[0].gain.events[0][1] === 0 && first.out[0].out[0].out[0] === ctx.destination);
  ctx.currentTime = 0.5;
  ok('its position follows the context\'s clock', near(position(), 1.5));
  follow({ t: 1.55, playing: true, speed: 1 });
  ok('a playhead a little apart is left alone', live(ctx).length === 1 && live(ctx)[0] === first);
  follow({ t: 3, playing: true, speed: 1 });
  ok('a playhead far apart (a seek, a loop) starts it again there', first.stopped !== null && live(ctx).length === 1 && live(ctx)[0].started.offset === 3);
  follow({ t: 3, playing: true, speed: 2 });
  ok('a new speed starts it again at that speed', live(ctx).length === 1 && live(ctx)[0].playbackRate.value === 2);
  follow({ t: 3.4, playing: false, speed: 2 });
  ok('pause stops it', live(ctx).length === 0);
  seek(2);
  ok('a seek while paused plays nothing', live(ctx).length === 0);
  setLevel(0.25);
  ok('the monitor level goes to the master', first.out[0].out[0].gain.value === 0.25);
  follow({ t: fxDoc.seconds - 0.01, playing: true, speed: 1 });
  ok('a playhead past the sound\'s end starts nothing', live(ctx).length === 0);
  follow({ t: 0.2, playing: true, speed: 1 });
  ok('and when it loops round, the sound starts again', live(ctx).length === 1 && live(ctx)[0].started.offset === 0.2);
  // The graphic changes while it plays: the new bed comes in at the same second.
  const changed = { ...fxDoc, sound: { mode: 'fx', level: 0.4, seed: 3 } };
  ctx.currentTime = 1;
  const was = live(ctx)[0];
  const there = position();
  await prepare(changed);
  ok('a changed graphic is swapped in where it was playing', was.stopped !== null && live(ctx).length === 1 && live(ctx)[0] !== was
    && near(live(ctx)[0].started.offset, there, 1e-9) && there > 0.2, { there });
  ok('turned off, it falls silent', (await prepare(still({ mode: 'off', level: 0.6 }))) === false && live(ctx).length === 0);
  dispose();
  ok('dispose closes the context', ctx.closed === true);

  // A context that waits for a person.
  ctx = new FakeCtx('suspended');
  setAudioFactory(() => ctx);
  await prepare(fxDoc);
  follow({ t: 2, playing: true, speed: 1 });
  ok('suspended: nothing starts, and it asks to resume', live(ctx).length === 0 && ctx.resumes >= 1);
  follow({ t: 2.5, playing: true, speed: 1 });
  ok('still waiting, still nothing', live(ctx).length === 0);
  ctx.allowed = true;
  await ctx.resume();
  ok('the moment it runs, it starts at the playhead', live(ctx).length === 1 && live(ctx)[0].started.offset === 2.5);
  dispose();
  setAudioFactory(null);
}

// ── what these files may and may not do ───────────────────────────────────

{
  const src = (f) => readFileSync(`src/${f}`, 'utf8');
  const files = ['motionsound.ts', 'motionsfx.ts', 'motionsoundplay.ts', 'MotionSoundPanel.tsx'];
  const code = files.map((f) => src(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')).join('\n');
  ok('no <audio>, no media element: Web Audio only', !/<audio|new Audio\(|HTMLAudioElement|HTMLMediaElement|createElement\(\s*['"]audio/.test(code));
  ok('no Math.random, no ctx.filter', !/Math\.random/.test(code) && !/\.filter\s*=/.test(code));
  const sound = src('motionsound.ts');
  const runtime = [...sound.matchAll(/^import\s+(?!type\b)[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]);
  ok('motionsound.ts does not import motionread.ts or motiondraw.ts at run time', !runtime.some((p) => /motionread|motiondraw/.test(p)), runtime);
  ok('and loads the composer only when music is made', !runtime.includes('./videosynth') && /import\('\.\/videosynth'\)/.test(sound));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
