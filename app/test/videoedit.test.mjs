// Editing a video by hand: undo and redo, the timeline's arithmetic, the
// templates and their sample storyboards, and the brand colours read from a
// logo.
//
// What matters most. An undo never gives back a storyboard the model has
// since replaced — the history starts again when anything but the person
// changes the video. Typing is one step, not one a letter, and a move or a
// removal is always a step of its own. Every template reads the same in all
// four languages, and its sample invents no facts. And a colour offered from
// a logo always reads on the style's background (WCAG 3:1).
import { readFileSync } from 'fs';
import {
  COALESCE_MS, HISTORY_CAP, canRedo, canUndo, dropIndexOf, duplicateScene, emptyHistory, groupOf, moveScene, recorded,
  redone, removeScene, resizeScene, sameSnapshot, sceneAtFrame, slotsOf, snapSeconds, snapshotOf, undone, videoHistory,
} from '../.test-build/videohistory.js';
import {
  TEMPLATES, fitSeconds, playedSeconds, sampleOf, sampleSpecs, sampleVideo, templateAbout, templateName,
} from '../.test-build/videotemplates.js';
import {
  brandFromLogo, contrastRatio, deltaE, dominantColours, hexOf, hslOf, labOf, luminance, readableOn, rgbOf, rgbOfHsl,
} from '../.test-build/videopalette.js';
import {
  LENGTHS, TRANSITION_FRAMES, durationInFrames, formatIn, newVideo, sanitizeScene, secondsIn, styleIn,
} from '../.test-build/video.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const FPS = 30;
let n = 0;
const newId = () => `id${++n}`;
const scene = (o = {}) => ({ id: newId(), kind: 'kinetic', text: 'Hello there', seconds: 4, transition: 'fade', ...o });
const video = (o = {}) => ({
  ...newVideo({ id: 'v1', now: 1000, request: 'a promo', lang: 'en', format: 'landscape', style: 'modern', seconds: 30 }),
  scenes: [scene({ kind: 'title', title: 'Hi', text: undefined }), scene(), scene({ kind: 'outro', headline: 'Bye', transition: 'none' })],
  ...o,
});

// ── history ──────────────────────────────────────────────────────────────
console.log('history');
{
  const v0 = video();
  const s0 = snapshotOf(v0);
  // Typing a title, one letter at a time, 100 ms apart, is one step.
  let h = emptyHistory();
  let cur = s0;
  const type = (title, at) => {
    const next = { ...cur, scenes: cur.scenes.map((s, i) => (i === 0 ? { ...s, title } : s)) };
    h = recorded(h, cur, next, at);
    cur = next;
  };
  type('H', 1000); type('Ha', 1100); type('Hal', 1200); type('Halo', 1300);
  ok('typing in one field within the window is one step', h.past.length === 1, h.past.length);
  ok('and the step goes back to before the first letter', h.past[0] === s0);
  type('Halo!', 1300 + COALESCE_MS + 1);
  ok('a pause longer than the window starts a new step', h.past.length === 2, h.past.length);
  ok('the group names the scene and the field', h.group === `scene:${cur.scenes[0].id}:title`, h.group);

  // Another field of the same scene is another step, however quick.
  const next = { ...cur, scenes: cur.scenes.map((s, i) => (i === 0 ? { ...s, subtitle: 'x' } : s)) };
  h = recorded(h, cur, next, 1300 + COALESCE_MS + 50);
  cur = next;
  ok('another field is another step', h.past.length === 3);

  // A move is always its own step, even within the window.
  const moved = { ...cur, scenes: [cur.scenes[1], cur.scenes[0], cur.scenes[2]] };
  ok('a move has no group', groupOf(cur, moved) === null);
  h = recorded(h, cur, moved, 1300 + COALESCE_MS + 60);
  cur = moved;
  const moved2 = { ...cur, scenes: [cur.scenes[1], cur.scenes[0], cur.scenes[2]] };
  h = recorded(h, cur, moved2, 1300 + COALESCE_MS + 70);
  cur = moved2;
  ok('two quick moves are two steps', h.past.length === 5, h.past.length);

  // Undo gives back exactly the objects that were there.
  const u = undone(h, cur);
  ok('undo returns the snapshot before the last step', u.snapshot === h.past[h.past.length - 1]);
  ok('and it is the same scene list, by identity', u.snapshot.scenes === moved.scenes);
  ok('the undone step can be redone', u.history.future.length === 1 && canRedo(u.history, u.snapshot));
  const r = redone(u.history, u.snapshot);
  ok('redo puts the step back', sameSnapshot(r.snapshot, cur));

  // A new change after an undo drops what could have been redone.
  const after = { ...u.snapshot, style: 'bold' };
  const h2 = recorded(u.history, u.snapshot, after, 99999);
  ok('a new change clears the redo stack', h2.future.length === 0 && !canRedo(h2, after));

  // A change with nothing changed is not a step.
  ok('no change, no step', recorded(h2, after, { ...after }, 100000) === h2);
}

{
  // The model plans a storyboard: the history before it is not ours to give back.
  const v0 = video();
  let h = emptyHistory();
  const edited = { ...snapshotOf(v0), title: 'Mine' };
  h = recorded(h, snapshotOf(v0), edited, 1);
  ok('one step recorded', canUndo(h, edited));
  const planned = { ...edited, scenes: [scene(), scene()] };
  ok('after a model run, undo is off', !canUndo(h, planned));
  const u = undone(h, planned);
  ok('and asking anyway gives nothing and clears the history', u.snapshot === null && u.history.past.length === 0);
  // Editing after the run starts a history from the run's result.
  const h3 = recorded(h, planned, { ...planned, title: 'After' }, 5);
  ok('a change after a run starts afresh from the run', h3.past.length === 1 && h3.past[0] === planned || sameSnapshot(h3.past[0], planned));
  // A picture arriving is the same kind of change.
  const withPicture = { ...edited, scenes: edited.scenes.map((s, i) => (i === 0 ? { ...s, picture: { src: 'data:', credit: '', source: '', query: '' } } : s)) };
  ok('a fetched picture ends the history too', !canUndo(h, withPicture));
}

{
  let h = emptyHistory();
  let cur = snapshotOf(video());
  for (let i = 0; i < HISTORY_CAP + 30; i++) {
    const next = { ...cur, scenes: [...cur.scenes, scene()] };
    h = recorded(h, cur, next, i * 10);
    cur = next;
  }
  ok(`the history is capped at ${HISTORY_CAP} steps`, h.past.length === HISTORY_CAP, h.past.length);
}

{
  const a = snapshotOf(video());
  ok('a brand colour is grouped by its field', groupOf(a, { ...a, brand: { ...a.brand, primary: '#FF0000' } }) === 'brand:primary');
  ok('the style is its own group', groupOf(a, { ...a, style: 'neon' }) === 'style');
  ok('two fields at once have no group', groupOf(a, { ...a, style: 'neon', title: 'x' }) === null);
  ok('a scene added has no group', groupOf(a, { ...a, scenes: [...a.scenes, scene()] }) === null);
  ok('a scene whose kind changed has no group',
     groupOf(a, { ...a, scenes: a.scenes.map((s, i) => (i === 1 ? { ...s, kind: 'quote', quote: 'q' } : s)) }) === null);
  ok('two scenes changed at once have no group',
     groupOf(a, { ...a, scenes: a.scenes.map((s) => ({ ...s, seconds: 5 })) }) === null);
}

{
  // The session's book of histories.
  const v0 = video({ id: 'book' });
  const v1 = { ...v0, title: 'one' };
  videoHistory.record('book', v0, v1, 10);
  ok('the book can undo what it recorded', videoHistory.canUndo('book', v1));
  const back = videoHistory.undo('book', v1);
  ok('undo hands back the fields to put back', back && back.title === v0.title && back.scenes === v0.scenes);
  const v2 = { ...v1, ...back };
  ok('then redo is on', videoHistory.canRedo('book', v2));
  const fwd = videoHistory.redo('book', v2);
  ok('and redo hands back the change', fwd && fwd.title === 'one');
  videoHistory.forget('book');
  ok('a forgotten video has no history', !videoHistory.canUndo('book', { ...v2, ...fwd }));
  ok('a video never edited has none', !videoHistory.canUndo('never', v0) && videoHistory.undo('never', v0) === null);
}

// ── the timeline's arithmetic ─────────────────────────────────────────────
console.log('timeline');
{
  ok('lengths snap to the half second', snapSeconds(3.26) === 3.5 && snapSeconds(3.24) === 3 && snapSeconds(7.75) === 8);
  ok('and stay between 2 and 20', snapSeconds(0.4) === 2 && snapSeconds(25) === 20 && snapSeconds(NaN) === 2);

  const v = video();
  const [a, b, c] = v.scenes;
  ok('move puts a scene where asked', moveScene(v.scenes, 0, 2).map((s) => s.id).join() === [b, c, a].map((s) => s.id).join());
  ok('move to the same place is the same list', moveScene(v.scenes, 1, 1) === v.scenes);
  ok('move past the end lands at the end', moveScene(v.scenes, 0, 99)[2] === a);

  const d = duplicateScene(v.scenes, 1, () => 'copy');
  ok('duplicate puts the copy right after', d.length === 4 && d[2].id === 'copy' && d[1] === b);
  ok('the copy has the scene\'s words', d[2].text === b.text && d[2].kind === b.kind);

  ok('remove takes one scene', removeScene(v.scenes, 1).length === 2 && !removeScene(v.scenes, 1).includes(b));
  ok('but never the last one', removeScene([a], 0).length === 1);

  const r = resizeScene(v.scenes, 1, 6.3);
  ok('resize snaps the new length', r[1].seconds === 6.5 && r[0] === a && r[2] === c);
  ok('resize to the same length is the same list', resizeScene(v.scenes, 1, 4) === v.scenes);

  const slots = slotsOf(v.scenes);
  const last = slots[slots.length - 1];
  ok('the slots end where the film ends', last.start + last.frames === durationInFrames(v), [last, durationInFrames(v)]);
  ok('a transition overlaps the next scene by its frames', slots[1].start === slots[0].frames - TRANSITION_FRAMES);
  ok('the first scene is not handed over to', !slots[0].into && slots[0].out && slots[1].into);
  ok('the last scene hands over to nothing', !last.out);
  const cut = slotsOf([scene({ transition: 'none' }), scene()]);
  ok('a cut overlaps nothing', cut[1].start === cut[0].frames && !cut[1].into);

  ok('the scene at frame 0 is the first', sceneAtFrame(v.scenes, 0) === 0);
  ok('during a transition, it is the scene arriving', sceneAtFrame(v.scenes, slots[1].start + 1) === 1);
  ok('past the end, it is the last', sceneAtFrame(v.scenes, 99999) === 2);

  // Dragging the first scene: held past the middle of the second, it lands after it.
  ok('a scene held before the others\' middles stays first', dropIndexOf(v.scenes, 0, 10) === 0);
  ok('held past the second\'s middle, it lands second', dropIndexOf(v.scenes, 0, slots[1].start + slots[1].frames / 2 + 1) === 1);
  ok('held past everything, it lands last', dropIndexOf(v.scenes, 0, 99999) === 2);
  ok('the last scene dragged to the start lands first', dropIndexOf(v.scenes, 2, 0) === 0);
}

// ── templates ─────────────────────────────────────────────────────────────
console.log('templates');
const LANGS = ['en', 'ar', 'ckb', 'kmr'];
const ARABIC = /[؀-ۿ]/;
const catalogue = readFileSync('src/i18n.ts', 'utf8');
const inCatalogue = (k) => ['const ar', 'const ckb', 'const kmr'].every((d) => {
  const from = catalogue.indexOf(`${d}: Dict = {`);
  const to = catalogue.indexOf('\n};', from);
  return catalogue.slice(from, to).includes(`  '${k.replace(/'/g, "\\'")}':`);
});
{
  ok('eight to ten templates', TEMPLATES.length >= 8 && TEMPLATES.length <= 10, TEMPLATES.length);
  ok('each has its own id', new Set(TEMPLATES.map((x) => x.id)).size === TEMPLATES.length);
  const names = new Set();
  for (const tpl of TEMPLATES) {
    const name = templateName(tpl.id, (s) => s);
    const about = templateAbout(tpl.id, (s) => s);
    names.add(name);
    ok(`${tpl.id}: its name and sentence are translated in ar, ckb and kmr`, inCatalogue(name) && inCatalogue(about), [name, about]);
    ok(`${tpl.id}: a length the panel offers`, LENGTHS.includes(tpl.seconds), tpl.seconds);
    for (const l of LANGS) {
      const text = tpl.request[l];
      ok(`${tpl.id}/${l}: a request in the right script`, typeof text === 'string' && text.length > 20 && (l === 'en' ? !ARABIC.test(text) : ARABIC.test(text)), text);
      // The request box's words switch things on; a template's words must not contradict its own choices.
      const f = formatIn(text);
      const st = styleIn(text);
      ok(`${tpl.id}/${l}: its words ask for no other shape, length or style`,
         (f === null || f === tpl.format) && secondsIn(text) === null && (st === null || st === tpl.style), { f, s: secondsIn(text), st });
    }
  }
  ok('every template has its own name', names.size === TEMPLATES.length);

  for (const tpl of TEMPLATES) {
    const kinds = LANGS.map((l) => sampleSpecs(tpl.id, l).map((s) => s.kind).join());
    ok(`${tpl.id}: the sample has the same scenes in all four languages`, kinds.every((k) => k === kinds[0]), kinds);
    ok(`${tpl.id}: opens with a title and closes with an outro`, kinds[0].startsWith('title') && kinds[0].endsWith('outro'));
    for (const l of LANGS) {
      const text = JSON.stringify(sampleSpecs(tpl.id, l).map(({ kind, ...rest }) => rest));
      ok(`${tpl.id}/${l}: the sample's words are in its language`, l === 'en' ? !ARABIC.test(text) : ARABIC.test(text));
      const v = sampleVideo(tpl, { now: 5, lang: l, request: tpl.request[l], newId });
      ok(`${tpl.id}/${l}: a sample is a video, ready`, v.stage === 'ready' && v.lang === l && v.format === tpl.format && v.style === tpl.style && v.seconds === tpl.seconds);
      ok(`${tpl.id}/${l}: every scene is one the app can draw`, v.scenes.every((s) => {
        const back = sanitizeScene(s, v, newId);
        return back && back.kind === s.kind;
      }));
      ok(`${tpl.id}/${l}: scene ids are unique`, new Set(v.scenes.map((s) => s.id)).size === v.scenes.length);
      ok(`${tpl.id}/${l}: every length on the half second, 2 to 20`, v.scenes.every((s) => s.seconds >= 2 && s.seconds <= 20 && s.seconds * 2 === Math.round(s.seconds * 2)));
      const played = playedSeconds(v);
      ok(`${tpl.id}/${l}: it plays for about the template's length`, Math.abs(played - tpl.seconds) <= Math.max(2, tpl.seconds * 0.1), played);
      ok(`${tpl.id}/${l}: the last scene hands over to nothing`, v.scenes[v.scenes.length - 1].transition === 'none');
      ok(`${tpl.id}/${l}: it knows it is a sample`, sampleOf(v)?.id === tpl.id);
      ok(`${tpl.id}/${l}: no pictures are fetched for it`, v.scenes.every((s) => !s.picture));
    }
  }

  const tpl = TEMPLATES[0];
  const branded = sampleVideo(tpl, { now: 5, lang: 'en', request: 'x', brand: { name: 'University of Duhok' }, newId });
  ok('the brand\'s name goes on the close', branded.scenes[branded.scenes.length - 1].headline === 'University of Duhok');
  ok('pictures are suggested, in English, for the scenes that show them', branded.scenes.some((s) => s.imageQuery && !ARABIC.test(s.imageQuery)));
  const ar = sampleVideo(tpl, { now: 5, lang: 'ar', request: 'x', newId });
  ok('and the same suggestions in every language', ar.scenes.map((s) => s.imageQuery ?? '').join() === branded.scenes.map((s) => s.imageQuery ?? '').join());
  ok('a planned sample is not a sample any more', sampleOf({ ...branded, model: 'claude-opus-5-5' }) === null);
  ok('an ordinary video is not a sample', sampleOf(video()) === null);
  ok('a sample id naming no template is not a sample', sampleOf({ id: 'sample-nothing-1', model: undefined }) === null);

  // The one sample with numbers says they are placeholders, in every language.
  for (const l of LANGS) {
    const specs = sampleSpecs('review', l);
    const stat = specs.find((s) => s.kind === 'stat');
    const chart = specs.find((s) => s.kind === 'chart');
    ok(`review/${l}: its number and its chart say they are samples`, stat && stat.label.length > 10 && chart && /\(.+\)/.test(chart.heading));
  }

  const fitted = fitSeconds([scene({ transition: 'fade' }), scene({ transition: 'fade' }), scene({ transition: 'none' })], 20);
  ok('fitting three scenes to 20 s plays about 20 s', Math.abs(durationInFrames({ scenes: fitted }) / FPS - 20) <= 1, durationInFrames({ scenes: fitted }) / FPS);
  ok('fitting nothing is nothing', fitSeconds([], 30).length === 0);
}

// ── the logo's colours ────────────────────────────────────────────────────
console.log('palette');
{
  ok('hex to rgb and back', hexOf(rgbOf('#1a5fdf')) === '#1A5FDF' && rgbOf('#abc').join() === '170,187,204');
  ok('a bad hex is null', rgbOf('blue') === null && rgbOf('#12345') === null);
  ok('white is luminance 1, black 0', luminance('#FFFFFF') === 1 && luminance('#000000') === 0);
  ok('black on white is 21:1', Math.abs(contrastRatio('#000000', '#FFFFFF') - 21) < 1e-9);
  ok('#777 on white is about 4.48:1', Math.abs(contrastRatio('#777777', '#FFFFFF') - 4.48) < 0.01, contrastRatio('#777777', '#FFFFFF'));
  ok('contrast is the same either way', contrastRatio('#123456', '#FEDCBA') === contrastRatio('#FEDCBA', '#123456'));
  const white = labOf([255, 255, 255]);
  ok('white in Lab is L 100, a 0, b 0', Math.abs(white[0] - 100) < 0.02 && Math.abs(white[1]) < 0.02 && Math.abs(white[2]) < 0.02, white);
  ok('a colour is ΔE 0 from itself', deltaE([10, 20, 30], [10, 20, 30]) === 0);
  ok('red and blue are far apart', deltaE([255, 0, 0], [0, 0, 255]) > 100);
  ok('two nearly equal colours are close', deltaE([200, 30, 30], [203, 31, 30]) < 2.3);
  for (const hex of ['#1A5FDF', '#E0573A', '#7C5CFF', '#22D3EE', '#808080', '#000000', '#FFFFFF']) {
    const back = hexOf(rgbOfHsl(hslOf(rgbOf(hex))));
    ok(`hsl round trip ${hex}`, back === hex, back);
  }

  // Made readable, with its hue kept.
  const light = '#F6F5F1'; // the Minimal style's ground
  const dark = '#0B1020'; // the Modern style's
  const yellow = readableOn('#FFD60A', light);
  ok('yellow on a light ground is darkened to 3:1', contrastRatio(yellow, light) >= 3, yellow);
  ok('and stays yellow', Math.abs(hslOf(rgbOf(yellow))[0] - hslOf(rgbOf('#FFD60A'))[0]) < 4, yellow);
  const navy = readableOn('#1A237E', dark);
  ok('navy on a dark ground is lightened to 3:1', contrastRatio(navy, dark) >= 3 && luminance(navy) > luminance('#1A237E'), navy);
  ok('a colour that already reads is left as it is', readableOn('#E0573A', dark) === '#E0573A');
  ok('a stricter bar can be asked for', contrastRatio(readableOn('#2E5BFF', dark, 4.5), dark) >= 4.5);

  // Pictures, drawn by hand: w × h RGBA.
  const picture = (w, h, paint) => {
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = paint(x, y);
      px.set([r, g, b, a], (y * w + x) * 4);
    }
    return px;
  };
  // A JPEG logo: a white square, an orange mark, black lettering.
  const jpeg = picture(40, 40, (x, y) => {
    if (x >= 8 && x < 24 && y >= 8 && y < 24) return [232, 93, 4];
    if (y >= 30 && y < 34 && x >= 6 && x < 34) return [20, 20, 20];
    return [255, 255, 255];
  });
  const fromJpeg = dominantColours(jpeg, 40, 40);
  ok('the background a logo was saved on is left out', fromJpeg.every((s) => luminance(s.hex) < 0.9), fromJpeg);
  ok('the colourful mark comes first', fromJpeg[0] && deltaE(rgbOf(fromJpeg[0].hex), [232, 93, 4]) < 5, fromJpeg);
  ok('the lettering is found too', fromJpeg.some((s) => deltaE(rgbOf(s.hex), [20, 20, 20]) < 5), fromJpeg);
  ok('shares add up to at most 1', fromJpeg.reduce((a, s) => a + s.share, 0) <= 1.0001);

  // A PNG on a clear background: two colours, no ground to remove.
  const png = picture(30, 30, (x, y) => {
    const d = Math.hypot(x - 15, y - 15);
    if (d < 8) return [0, 150, 80];
    if (d < 12) return [250, 200, 0];
    return [0, 0, 0, 0];
  });
  const fromPng = dominantColours(png, 30, 30);
  ok('transparent pixels are not a colour', fromPng.every((s) => s.hex !== '#000000'), fromPng);
  ok('both colours of a two-colour logo', fromPng.length === 2
     && fromPng.some((s) => deltaE(rgbOf(s.hex), [0, 150, 80]) < 5) && fromPng.some((s) => deltaE(rgbOf(s.hex), [250, 200, 0]) < 5), fromPng);
  ok('the same picture gives the same colours every time', JSON.stringify(dominantColours(png, 30, 30)) === JSON.stringify(fromPng));
  // Near shades of one colour are one colour.
  const shades = picture(20, 20, (x) => (x < 10 ? [200, 30, 30] : [210, 35, 32]));
  ok('near shades are one colour', dominantColours(shades, 20, 20).length === 1);
  // White letters on the brand's red, edge to edge: the red is the brand, not a background.
  const filled = picture(30, 30, (x, y) => (y > 12 && y < 18 && x > 5 && x < 25 ? [255, 255, 255] : [200, 16, 46]));
  const fromFilled = dominantColours(filled, 30, 30);
  ok('a colour filling the square is the brand, not a background', fromFilled[0] && deltaE(rgbOf(fromFilled[0].hex), [200, 16, 46]) < 5, fromFilled);
  ok('a picture that is all white is white', dominantColours(picture(10, 10, () => [255, 255, 255]), 10, 10)[0]?.hex === '#FFFFFF');
  ok('an empty picture has no colours', dominantColours(picture(4, 4, () => [0, 0, 0, 0]), 4, 4).length === 0);

  const offer = brandFromLogo(fromJpeg, dark);
  ok('the offer\'s main colour is the logo\'s colourful one', offer && deltaE(rgbOf(offer.primary), [232, 93, 4]) < 15, offer);
  ok('it reads on the style\'s ground', offer && contrastRatio(offer.primary, dark) >= 3);
  ok('the black lettering becomes an accent that reads on a dark ground', offer && offer.accent && contrastRatio(offer.accent, dark) >= 3, offer);
  ok('and the offer says it had to change it', offer && offer.adjusted === true);
  const onLight = brandFromLogo(fromPng, light);
  ok('on a light ground, both colours read', onLight && contrastRatio(onLight.primary, light) >= 3 && (!onLight.accent || contrastRatio(onLight.accent, light) >= 3), onLight);
  const one = brandFromLogo([{ hex: '#1A5FDF', share: 1, chroma: 60 }], dark);
  ok('a one-colour logo gives no accent', one && one.accent === undefined, one);
  ok('no colours, no offer', brandFromLogo([], dark) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
