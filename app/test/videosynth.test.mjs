// Music composed in the app (videosynth.ts): the score, which is pure and
// runs here without Web Audio.
//
// What matters: the same spec always composes the same piece and a new seed
// a new one; the piece covers the video's length exactly — the last chord
// rings to the last sample and nothing sounds past it; every scene cut is
// moved to its nearest beat and marked there with a crash or an impact; each
// mood keeps to its own tempo range, keys and scale; the maqamat use their
// own intervals (Hijaz its augmented second) and the darbuka plays one of
// the Arabic rhythms; more energy means more notes. Rendering (the
// OfflineAudioContext half) is measured in a browser, not here.
import {
  arrange, composeMusic, normalSpec, musicCues, moodForStyle, moodTempo, MUSIC_MOODS, KEY_NAMES, COMPOSED,
} from '../.test-build/videosynth.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const MOODS = ['uplifting', 'calm', 'cinematic', 'corporate', 'electronic', 'lofi', 'epic', 'oriental'];
/** Each mood's tempo range and the keys it picks from when left to itself — read off the design, not the code. */
const RANGE = {
  uplifting: [112, 132], calm: [64, 84], cinematic: [76, 96], corporate: [100, 118],
  electronic: [118, 130], lofi: [70, 90], epic: [84, 104], oriental: [88, 116],
};
const SCALE = {
  uplifting: ['major'], calm: ['major'], cinematic: ['minor'], corporate: ['major'],
  electronic: ['minor'], lofi: ['major', 'dorian'], epic: ['minor'], oriental: ['hijaz', 'bayati', 'nahawand', 'kurd'],
};
const MAQAM = {
  hijaz: [0, 1, 4, 5, 7, 8, 10],
  bayati: [0, 1, 3, 5, 7, 8, 10],
  nahawand: [0, 2, 3, 5, 7, 8, 11],
  kurd: [0, 1, 3, 5, 7, 8, 10],
};
const PITCHED = new Set(['bass', 'pad', 'strings', 'choir', 'brass', 'lead', 'ney', 'piano', 'epiano', 'bell', 'pluck', 'harp', 'oud', 'qanun', 'arp']);
const pc = (p) => ((p % 12) + 12) % 12;
const CUES = [4.5, 9.2, 14, 19.3, 24.4];

// ── the moods ─────────────────────────────────────────────────────────────

ok('eight moods, the spec\'s own, each with a label', MUSIC_MOODS.length === 8 && MUSIC_MOODS.every((m, i) => m.id === MOODS[i] && m.label));
ok('twelve key names', KEY_NAMES.length === 12 && KEY_NAMES[0] === 'C' && KEY_NAMES[9] === 'A');
ok('a style suggests a mood', moodForStyle('elegant') === 'calm' && moodForStyle('bold') === 'electronic' && moodForStyle('nope') === 'uplifting' && moodForStyle(undefined) === 'uplifting');
ok('each mood has its usual tempo inside its range', MOODS.every((m) => moodTempo(m) >= RANGE[m][0] && moodTempo(m) <= RANGE[m][1]));
ok('a composed track calls itself original and yours', /Original music composed in Vylo Editor/.test(COMPOSED.credit) && COMPOSED.source === 'Vylo Editor' && COMPOSED.license === 'Yours to use');

// ── the spec ──────────────────────────────────────────────────────────────

{
  const n = normalSpec({ mood: 'nope', seed: -12.7, tempo: 500, energy: 3, key: 14 });
  ok('an unknown mood becomes uplifting, the rest held in range', n.mood === 'uplifting' && n.seed === 12 && n.tempo === 170 && n.energy === 1 && n.key === 2, n);
  const m = normalSpec({ mood: 'calm', seed: 5 });
  ok('fields left out stay out, so the mood decides them', !('tempo' in m) && !('energy' in m) && !('key' in m) && m.mood === 'calm');
  ok('a seed that is not a number is 0', normalSpec({ mood: 'epic', seed: NaN }).seed === 0);
}

// ── determinism ───────────────────────────────────────────────────────────

for (const mood of MOODS) {
  const a = arrange({ mood, seed: 42 }, 30, CUES);
  const b = arrange({ mood, seed: 42 }, 30, CUES);
  const c = arrange({ mood, seed: 43 }, 30, CUES);
  ok(`${mood}: the same seed composes the same score`, JSON.stringify(a) === JSON.stringify(b));
  ok(`${mood}: another seed composes another`, JSON.stringify(a.notes) !== JSON.stringify(c.notes));
}
{
  // A spec that only differs in fields the mood would choose itself is a different piece only if it chose otherwise.
  const own = arrange({ mood: 'oriental', seed: 9 }, 30);
  const same = arrange({ mood: 'oriental', seed: 9, key: own.key }, 30);
  ok('naming the key the mood would have chosen changes nothing else', same.scale === own.scale && same.key === own.key);
}

// ── the length is covered exactly, and nothing plays past it ─────────────

for (const mood of MOODS) {
  for (const secs of [5, 12.3, 30, 61.7, 180]) {
    const cues = [];
    for (let t = 3.7; t < secs - 1; t += 5.3) cues.push(t);
    const s = arrange({ mood, seed: 7 }, secs, cues);
    const bad = s.notes.filter((n) => !(n.t >= 0) || !(n.d > 0) || n.t + n.d > secs + 1e-9 || !(n.v > 0 && n.v <= 1) || !Number.isFinite(n.p));
    const last = Math.max(...s.notes.map((n) => n.t + n.d));
    const secsOk = s.sections.length > 0 && s.sections[0].start === 0 && s.sections.every((x, i) => x.end > x.start && (i === 0 || Math.abs(x.start - s.sections[i - 1].end) < 1e-9));
    ok(`${mood} ${secs} s: no note before 0 or past the end`, bad.length === 0, bad.slice(0, 2));
    ok(`${mood} ${secs} s: the last chord rings to the very end`, s.seconds === secs && Math.abs(last - secs) < 1e-6 && s.end < secs && s.end > secs - 4.5, { last, end: s.end });
    ok(`${mood} ${secs} s: the sections run from 0 to the last chord, in order`, secsOk && Math.abs(s.sections[s.sections.length - 1].end - s.end) < 1e-6, s.sections);
    ok(`${mood} ${secs} s: the last chord falls on a beat`, Math.abs(s.end / s.beat - Math.round(s.end / s.beat)) < 1e-6);
  }
}
{
  const long = arrange({ mood: 'electronic', seed: 3 }, 180, []);
  const kinds = long.sections.map((x) => x.kind);
  ok('a long piece has an intro, a build, a main part, a break, a drop and a cadence', ['intro', 'build', 'main', 'break', 'drop', 'outro'].every((k) => kinds.includes(k)) && kinds[0] === 'intro' && kinds[kinds.length - 1] === 'outro', kinds);
  ok('a length that is not a number is taken as 30 s', arrange({ mood: 'calm', seed: 1 }, NaN).seconds === 30);
}

// ── cues: on beats, marked ────────────────────────────────────────────────

for (const mood of MOODS) {
  const s = arrange({ mood, seed: 11 }, 30, CUES);
  const onBeat = s.cues.every((c) => Math.abs(c / s.beat - Math.round(c / s.beat)) < 1e-6);
  const near = s.cues.length === CUES.length && s.cues.every((c, i) => Math.abs(c - CUES[i]) <= s.beat / 2 + 1e-9);
  const marked = s.cues.every((c) => s.notes.some((n) => (n.i === 'crash' || n.i === 'impact') && Math.abs(n.t - c) < 1e-5));
  const filled = s.cues.filter((c) => s.notes.some((n) => n.t >= c - 2 * s.beat - 1e-6 && n.t < c - 1e-6 && ['snare', 'revcrash', 'harp', 'timpani', 'tek', 'ka', 'tom', 'riq', 'qanun'].includes(n.i))).length;
  ok(`${mood}: every cut moves to its nearest beat`, onBeat && near, { cues: s.cues, beat: s.beat });
  ok(`${mood}: every cut has a crash or an impact exactly on its beat`, marked);
  ok(`${mood}: most cuts have a fill before them`, filled >= CUES.length - 1, filled);
  ok(`${mood}: at least one section changes on a cut`, s.sections.slice(1).some((x) => s.cues.some((c) => Math.abs(c - x.start) < 1e-6)), s.sections.map((x) => x.start));
}
{
  const s = arrange({ mood: 'uplifting', seed: 1 }, 20, [-3, 0, NaN, 25, 7, 7.01]);
  ok('cuts before the start, at 0, past the end or twice on one beat are dropped', s.cues.length === 1 && Math.abs(s.cues[0] - Math.round(7 / s.beat) * s.beat) < 1e-9, s.cues);
}

// ── tempo, key and scale per mood ─────────────────────────────────────────

for (const mood of MOODS) {
  const seen = new Set();
  let inRange = true;
  let keysOk = true;
  let scalesOk = true;
  for (let seed = 1; seed <= 24; seed++) {
    const s = arrange({ mood, seed }, 45, []);
    if (s.bpm < RANGE[mood][0] || s.bpm > RANGE[mood][1]) inRange = false;
    if (!SCALE[mood].includes(s.scale)) scalesOk = false;
    if (!Number.isInteger(s.key) || s.key < 0 || s.key > 11) keysOk = false;
    seen.add(s.key);
  }
  ok(`${mood}: the tempo stays in ${RANGE[mood][0]}–${RANGE[mood][1]} BPM`, inRange);
  ok(`${mood}: the scale is the mood's`, scalesOk);
  ok(`${mood}: keys vary with the seed`, keysOk && seen.size >= 2, [...seen]);
}
{
  const s = arrange({ mood: 'calm', seed: 2, tempo: 100, key: 5 }, 40, []);
  ok('a tempo asked for is kept within a few per cent', Math.abs(s.bpm - 100) <= 4, s.bpm);
  ok('a key asked for is the key', s.key === 5);
  const fast = arrange({ mood: 'lofi', seed: 2, tempo: 900 }, 40, []);
  ok('a tempo out of range is held to 170', fast.bpm <= 170 * 1.04 + 1e-9 && fast.bpm >= 160, fast.bpm);
  ok('the beat is the tempo', Math.abs(s.beat - 60 / s.bpm) < 1e-12);
}

// ── the maqamat ───────────────────────────────────────────────────────────

{
  const found = {};
  for (let seed = 1; seed <= 200 && Object.keys(found).length < 4; seed++) {
    const s = arrange({ mood: 'oriental', seed }, 40, [8, 16, 24, 32]);
    if (!found[s.scale]) found[s.scale] = s;
  }
  ok('all four maqamat are reached by some seed', ['hijaz', 'bayati', 'nahawand', 'kurd'].every((m) => found[m]), Object.keys(found));
  for (const [name, s] of Object.entries(found)) {
    ok(`${name}: its steps are its intervals`, JSON.stringify(s.steps) === JSON.stringify(MAQAM[name]), s.steps);
    const out = s.notes.filter((n) => PITCHED.has(n.i) && !MAQAM[name].includes(pc(n.p - s.key)));
    ok(`${name}: every pitched note is in the maqam`, out.length === 0, out.slice(0, 3).map((n) => [n.i, n.p]));
    const oud = new Set(s.notes.filter((n) => n.i === 'oud').map((n) => pc(n.p - s.key)));
    ok(`${name}: the oud carries the melody through its lower jins`, oud.size >= 5 && [0, 3].every((d) => oud.has(MAQAM[name][d])), [...oud]);
    ok(`${name}: a darbuka rhythm — maqsum, baladi or saidi — with dum and tek`, ['maqsum', 'baladi', 'saidi'].includes(s.iqa) && s.notes.some((n) => n.i === 'dum') && s.notes.some((n) => n.i === 'tek'), s.iqa);
    ok(`${name}: ney, qanun and riq are heard`, ['ney', 'qanun', 'riq'].every((i) => s.notes.some((n) => n.i === i)));
  }
  if (found.hijaz) {
    const oud = new Set(found.hijaz.notes.filter((n) => n.i === 'oud').map((n) => pc(n.p - found.hijaz.key)));
    ok('hijaz: the melody uses both sides of the augmented second', oud.has(1) && oud.has(4), [...oud]);
  }
  // The dum is tuned to the maqam: its tonic or fifth.
  const s = found.hijaz ?? Object.values(found)[0];
  ok('the dum is tuned to the tonic or the fifth', s.notes.filter((n) => n.i === 'dum').every((n) => [0, 7].includes(pc(n.p - s.key))));
  const rhythms = new Set();
  for (let seed = 1; seed <= 60; seed++) rhythms.add(arrange({ mood: 'oriental', seed }, 20).iqa);
  ok('the seed chooses among the three rhythms', rhythms.size === 3, [...rhythms]);
}

// ── energy scales density ─────────────────────────────────────────────────

for (const mood of MOODS) {
  const calm = arrange({ mood, seed: 5, energy: 0.15 }, 40, CUES).notes.length;
  const busy = arrange({ mood, seed: 5, energy: 0.95 }, 40, CUES).notes.length;
  ok(`${mood}: more energy, more notes`, busy > calm * 1.15, { calm, busy });
}
{
  const lo = arrange({ mood: 'uplifting', seed: 5, energy: 0.1 }, 40);
  const hi = arrange({ mood: 'uplifting', seed: 5, energy: 1 }, 40);
  const kinds = (s) => new Set(s.notes.map((n) => n.i)).size;
  ok('more energy brings in more instruments', kinds(hi) > kinds(lo), { lo: kinds(lo), hi: kinds(hi) });
}

// ── a theme that returns ──────────────────────────────────────────────────

{
  // The melody's opening motif comes back: the same intervals at the start of more than one phrase.
  const s = arrange({ mood: 'corporate', seed: 8 }, 60, []);
  const bell = s.notes.filter((n) => n.i === 'bell' && n.t < s.end - 0.01);
  const shapes = new Map();
  for (let k = 0; k + 3 < bell.length; k++) {
    const key = [1, 2, 3].map((j) => bell[k + j].p - bell[k].p).join(',') + '|' + [1, 2, 3].map((j) => Math.round((bell[k + j].t - bell[k].t) / s.beat * 4)).join(',');
    shapes.set(key, (shapes.get(key) ?? 0) + 1);
  }
  ok('the melody repeats its motifs', Math.max(...shapes.values()) >= 3, Math.max(...shapes.values()));
}

// ── cues from a video ─────────────────────────────────────────────────────

{
  const scene = (id, seconds, transition) => ({ id, kind: 'kinetic', text: id, seconds, transition });
  const v = { scenes: [scene('a', 4, 'fade'), scene('b', 5, 'none'), scene('c', 6, 'fade')] };
  // a: 0–120 frames; b starts at 105 (a fades over 15), arriving halfway, at 112.5; c starts at 255, after a cut.
  const cues = musicCues(v);
  ok('a video\'s cuts: halfway into each transition, or the cut itself', cues.length === 2 && Math.abs(cues[0] - 112.5 / 30) < 1e-3 && Math.abs(cues[1] - 255 / 30) < 1e-3, cues);
  ok('no scenes, no cuts', musicCues({ scenes: [] }).length === 0 && musicCues({}).length === 0);
}

// ── rendering needs a browser ─────────────────────────────────────────────

{
  let err = null;
  try { await composeMusic({ mood: 'calm', seed: 1 }, 5, {}); } catch (e) { err = e; }
  ok('without Web Audio, composing says so instead of making silence', err instanceof Error && /cannot make sound/.test(err.message), err?.message);
  const ctl = new AbortController();
  ctl.abort();
  let stopped = null;
  try { await composeMusic({ mood: 'calm', seed: 1 }, 5, { signal: ctl.signal }); } catch (e) { stopped = e; }
  ok('a stopped signal stops it before anything is made', stopped?.name === 'AbortError');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
