// The playback clock: one time for the open graphic, moved by the transport
// bar, the timeline and the stage.
//
// What matters. The playhead is always a frame that could be exported and
// never past the last one (a layer that runs to the end is not drawn *at* the
// end, so a playhead parked there would show an empty frame). Time is
// measured, not counted: a dropped frame does not slow the graphic, and a long
// gap — the window was hidden — is no time at all. Stepping pauses. Looping
// wraps and not looping stops on the last frame; pressing play there starts
// again from the top.
import { bind, lastFrame, pause, play, read, reset, seek, setLoop, setSpeed, step, toggle, SPEEDS } from '../.test-build/motionplay.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// A rAF we drive by hand.
let queue = [];
let clock = 0;
globalThis.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
globalThis.cancelAnimationFrame = () => { queue = []; };
const frame = (ms) => {
  clock += ms;
  const run = queue;
  queue = [];
  for (const cb of run) cb(clock);
};

bind(6, 30);
reset();
ok('starts at the top, paused', read().t === 0 && !read().playing);
ok('the last frame is one frame short of the end', near(lastFrame(read()), 6 - 1 / 30));

seek(2.0123);
ok('seek snaps to a frame', near(read().t * 30, Math.round(read().t * 30)) && near(read().t, 2.0));
seek(99);
ok('seek stops at the last frame', near(read().t, 6 - 1 / 30));
seek(-4);
ok('seek stops at the first', read().t === 0);
seek(NaN);
ok('seek ignores nonsense', read().t === 0);

step(3);
ok('step moves by frames', near(read().t, 3 / 30));
step(-1);
ok('and back', near(read().t, 2 / 30));
step(-5);
ok('stepping back from the start wraps to the end', near(read().t, (6 * 30 - 3) / 30));
step(0);
ok('a step of zero changes nothing but pauses', !read().playing);

// Playing.
reset();
setLoop(true);
setSpeed(1);
play();
ok('play starts the clock', read().playing);
frame(16); // first tick only stamps
frame(100);
ok('time is measured from the real gap', near(read().t, 0.1, 1e-6), read().t);
frame(1000);
ok('a long gap counts as no time (a hidden window)', near(read().t, 0.1 + 0.25, 1e-6), read().t);

setSpeed(2);
const before = read().t;
frame(100);
ok('speed scales the clock', near(read().t - before, 0.2, 1e-6), read().t - before);
setSpeed(0.3);
ok('a speed that is not offered is ignored', read().speed === 1 && SPEEDS.includes(read().speed));
setSpeed(1);

// Looping.
pause();
seek(5.9);
play();
frame(16);
frame(200);
ok('a loop wraps past the end', read().playing && read().t < 1, read().t);

// Not looping.
pause();
setLoop(false);
seek(5.9);
play();
frame(16);
frame(250);
ok('without a loop it stops on the last frame', !read().playing && near(read().t, lastFrame(read())), read().t);
play();
ok('play from the end starts again from the top', read().playing && read().t === 0);
pause();
ok('pause stops it', !read().playing);
toggle();
ok('toggle plays', read().playing);
toggle();
ok('and pauses', !read().playing);

// Binding.
seek(5.9);
bind(3, 30);
ok('a shortened graphic brings the playhead back', near(read().t, 3 - 1 / 30), read().t);
bind(0, 30);
ok('a length of zero is repaired, not divided by', read().seconds === 1);
bind(6, 30);
ok('rebinding the same length is a no-op', (() => { const t = read().t; bind(6, 30); return read().t === t; })());
reset();
ok('reset goes home and stops', read().t === 0 && !read().playing);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
