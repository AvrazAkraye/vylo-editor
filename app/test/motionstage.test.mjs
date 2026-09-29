// The stage's numbers: the clock it shows, pointer pixels as u, the arrow
// keys' steps, the scrubber's frames, and the canvas's size.
//
// Built on its own, with React left out of the bundle, because the component
// imports React and only its pure helpers are tested here:
//
//   npx esbuild src/MotionStage.tsx --bundle --format=esm --outdir=.test-build \
//       --log-level=error --external:react --external:react-dom
//
// What matters. The time reads m:ss.cc and never shows a hundredth the
// playhead has not reached. A drag of the same pixels is the same u in every
// shape, since u is a percent of the short side, and it is toward the *end* —
// so a drag to the right in an Arabic graphic is a negative x. Shift holds a
// drag to one axis, and the other axis keeps its exact value. The scrubber's
// frame and the clock's time go round without drifting. The canvas is never
// bigger than the graphic, never stretched up, and does not change for a
// resize of a few pixels.
import {
  backingOf, dragTo, fitFrame, frameAt, nudgeStep, nudged, pxToU, timeAt, timecode,
} from '../.test-build/MotionStage.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const eq = (name, got, want) => ok(name, Object.is(got, want) || got === want, { got, want });
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── the clock ─────────────────────────────────────────────────────────────
eq('0 is 0:00.00', timecode(0), '0:00.00');
eq('0.999 is cut, not rounded: 0:00.99', timecode(0.999), '0:00.99');
eq('61.5 is 1:01.50', timecode(61.5), '1:01.50');
eq('NaN reads as the start', timecode(NaN), '0:00.00');
eq('a negative time reads as the start', timecode(-2), '0:00.00');
eq('Infinity reads as the start', timecode(Infinity), '0:00.00');
eq('float dust does not lose a hundredth (0.57)', timecode(0.57), '0:00.57');
eq('a frame at 60 fps (21/60)', timecode(21 / 60), '0:00.35');
eq('the last frame of 30 s at 30 fps', timecode(30 - 1 / 30), '0:29.96');
eq('ten seconds pads the seconds', timecode(10.05), '0:10.05');

// ── frames and time ───────────────────────────────────────────────────────
{
  let drift = 0;
  for (const fps of [24, 30, 60]) {
    for (let n = 0; n < 30 * fps; n++) if (frameAt(timeAt(n, fps), fps) !== n) drift++;
  }
  eq('every frame of 30 s at 24, 30 and 60 fps goes to its time and back', drift, 0);
}
eq('a time between frames is the nearest frame', frameAt(0.51, 30), 15);
eq('frame 45 at 30 fps is 1.5 s', timeAt(45, 30), 1.5);
eq('frameAt ignores NaN', frameAt(NaN, 30), 0);
eq('frameAt keeps above zero', frameAt(-1, 30), 0);
eq('timeAt ignores a zero rate', timeAt(10, 0), 0);
eq('timeAt rounds a fractional frame', timeAt(2.6, 30), 0.1);

// ── pointer pixels as u ───────────────────────────────────────────────────
{
  // 1u is 1% of the short side, so 36 CSS px on a frame 360 short is 10u in both shapes.
  const land = pxToU(36, -18, 640, 360, false);
  const port = pxToU(36, -18, 360, 640, false);
  ok('landscape: 36 px is 10u across, -18 px is 5u up', near(land.x, 10) && near(land.y, -5), land);
  ok('portrait: the same pixels are the same u', near(port.x, 10) && near(port.y, -5), port);
  const rtl = pxToU(36, -18, 640, 360, true);
  ok('right to left: a move to the right is toward the start, a negative x', near(rtl.x, -10) && near(rtl.y, -5), rtl);
  const big = pxToU(96, 0, 1920, 1080, false);
  ok('at the frame\'s own size, 1u is 10.8 px', near(big.x, 96 / 10.8), big);
  const none = pxToU(10, 10, 0, 300, false);
  ok('a frame with no size moves nothing', none.x === 0 && none.y === 0, none);
}

// ── a drag ────────────────────────────────────────────────────────────────
{
  const from = { x: 8, y: -10 };
  const a = dragTo(from, 36, 18, 640, 360, false, false);
  ok('a drag adds the travel in u', near(a.x, 18) && near(a.y, -5), a);
  const r = dragTo(from, 36, 18, 640, 360, true, false);
  ok('in a right-to-left graphic a drag right takes x down', near(r.x, -2) && near(r.y, -5), r);
  const tidy = dragTo(from, 10, 0, 640, 360, false, false);
  eq('a drag is kept to tenths of a u', tidy.x, 10.8);
  eq('and an axis that did not move is untouched', tidy.y, -10);
  const exact = { x: 12.345, y: 3.21 };
  const h = dragTo(exact, 50, 12, 640, 360, false, true);
  ok('Shift holds a mostly-across drag to x, and y keeps its exact value', h.y === 3.21 && near(h.x, 12.345 + 13.9), h);
  const v = dragTo(exact, 5, -40, 640, 360, false, true);
  ok('Shift holds a mostly-down drag to y, and x keeps its exact value', v.x === 12.345 && near(v.y, 3.21 - 11.1), v);
  const far = dragTo({ x: 395, y: 0 }, 5000, 0, 640, 360, false, false);
  eq('a drag stops at the reach a reader allows', far.x, 400);
  const back = dragTo({ x: 0, y: 0 }, -0.01, 0, 640, 360, false, false);
  ok('a drag that rounds to nothing is 0, not -0', Object.is(back.x, 0), back);
}

// ── arrow keys ────────────────────────────────────────────────────────────
eq('an arrow moves 1u', nudgeStep(false, false), 1);
eq('Shift moves 5u', nudgeStep(true, false), 5);
eq('Alt moves 0.2u', nudgeStep(false, true), 0.2);
eq('Shift wins over Alt', nudgeStep(true, true), 5);
{
  const at = { x: 4, y: 6 };
  const r = nudged(at, 'ArrowRight', 1, false);
  ok('→ in a left-to-right graphic is toward the end', r.x === 5 && r.y === 6, r);
  const rr = nudged(at, 'ArrowRight', 1, true);
  ok('→ in a right-to-left graphic is toward the start', rr.x === 3 && rr.y === 6, rr);
  const l = nudged(at, 'ArrowLeft', 5, true);
  ok('← with Shift in a right-to-left graphic is 5u toward the end', l.x === 9 && l.y === 6, l);
  const u = nudged(at, 'ArrowUp', 1, false);
  ok('↑ is up in every direction', u.x === 4 && u.y === 5, u);
  const d = nudged(at, 'ArrowDown', 0.2, true);
  ok('↓ with Alt is a fifth of a u down', d.x === 4 && d.y === 6.2, d);
  const dust = nudged({ x: 0.1, y: 0 }, 'ArrowRight', 0.2, false);
  eq('0.1 + 0.2 is kept as 0.3', dust.x, 0.3);
  eq('any other key is not a nudge', nudged(at, 'Enter', 1, false), null);
  const edge = nudged({ x: -399.5, y: 0 }, 'ArrowLeft', 5, false);
  eq('a nudge stops at the reach a reader allows', edge.x, -400);
}

// ── the frame's size on screen ────────────────────────────────────────────
{
  const land = fitFrame(1000, 500, 1920, 1080);
  ok('landscape in a wide room fills the height', land.height === 500 && land.width === 888, land);
  const port = fitFrame(1000, 500, 1080, 1920);
  ok('portrait in the same room fills the height too', port.height === 500 && port.width === 281, port);
  const tall = fitFrame(300, 900, 1920, 1080);
  ok('landscape in a tall room fills the width', tall.width === 300 && tall.height === 168, tall);
  let over = 0;
  for (const [w, h] of [[333, 777], [1234, 567], [360, 202], [99, 99], [2000, 3000]]) {
    for (const [fw, fh] of [[1920, 1080], [1080, 1920], [1080, 1080], [1080, 1350]]) {
      const f = fitFrame(w, h, fw, fh);
      // Whole pixels cannot hold 16:9 exactly in a small box; the shape is kept to
      // the pixel on whichever side was cut to fit.
      const off = Math.min(Math.abs(f.height - (f.width * fh) / fw), Math.abs(f.width - (f.height * fw) / fh));
      if (f.width > w || f.height > h || off > 1) over++;
    }
  }
  eq('never larger than the room, and the shape kept to the pixel, for twenty rooms and shapes', over, 0);
  const none = fitFrame(0, 400, 1920, 1080);
  ok('no room is no frame', none.width === 0 && none.height === 0, none);
}

// ── the canvas's own pixels ───────────────────────────────────────────────
{
  const full = backingOf(3000, 1920, 1080, 2);
  ok('never more than the graphic\'s own size', full.width === 1920 && full.height === 1080, full);
  const retina = backingOf(800, 1920, 1080, 2);
  ok('at 2x, at least twice the CSS size', retina.width >= 1600 && retina.height >= 900, retina);
  ok('and not much more (a step is about 9%)', retina.width <= 1600 * 1.1, retina);
  const three = backingOf(800, 1920, 1080, 3);
  ok('a denser screen than 2x is drawn at 2x', three.width === retina.width, { three, retina });
  const nudge = backingOf(805, 1920, 1080, 2);
  ok('a resize of a few pixels keeps the canvas', nudge.width === retina.width && nudge.height === retina.height, { nudge, retina });
  let changes = 0;
  let last = backingOf(400, 1920, 1080, 2).width;
  for (let w = 401; w <= 900; w++) {
    const b = backingOf(w, 1920, 1080, 2).width;
    if (b !== last) changes++;
    last = b;
  }
  ok('dragging a window edge from 400 to 900 px reallocates a handful of times, not 500', changes > 0 && changes <= 12, changes);
  let bad = 0;
  for (const [fw, fh] of [[1920, 1080], [1080, 1920], [1080, 1080], [1080, 1350]]) {
    for (let w = 120; w <= 1400; w += 37) {
      const b = backingOf(w, fw, fh, 2);
      if (Math.abs(b.width / b.height - fw / fh) > 0.01) bad++;
      if (b.width < Math.min(fw, w * 2) - 1) bad++;
    }
  }
  eq('the shape is kept and the picture never stretched up, in every shape', bad, 0);
  const one = backingOf(640, 1080, 1080, 1);
  ok('at 1x, the CSS size or a step above', one.width >= 640 && one.width <= 700, one);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
