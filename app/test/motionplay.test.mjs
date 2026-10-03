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
//
// The clock against the sound (review R2, docs/pro/requests/R2.md item 3).
// The sound starts at the press, so the clock must count from the press too:
// the first frame after play() or seek() counts the time since the call, and
// the picture is not a frame behind. A loop lasts the film's length, shows the
// last frame for its own 1/fps, and never puts the playhead between the last
// frame and the end — a time the film does not have.
//
// The page's two clocks are one here, as they are in a browser:
// `requestAnimationFrame` hands its callbacks a `performance.now()` time, so
// `performance.now` is this test's clock too.
import { bind, lastFrame, pause, play, read, reset, seek, setLoop, setSpeed, step, toggle, SPEEDS } from '../.test-build/motionplay.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// A rAF we drive by hand, and the page's clock with it.
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
const realPerf = Object.getOwnPropertyDescriptor(globalThis, 'performance');
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true });

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
frame(16);
ok('the first frame counts the time since play (it used to count none)', near(read().t, 0.016, 1e-6), read().t);
frame(100);
ok('time is measured from the real gap', near(read().t, 0.116, 1e-6), read().t);
frame(1000);
ok('a long gap counts as at most a quarter of a second (a hidden window)', near(read().t, 0.116 + 0.25, 1e-6), read().t);

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

// ── the clock against the sound ─────────────────────────────────────────
bind(6, 30);
setLoop(true);
setSpeed(1);
reset();
{
  // The sound starts at the press; the picture must be where the sound is at every frame, not a frame behind.
  clock += 3.3; // the press comes part-way between two frames
  play();
  const pressed = clock;
  let worst = 0;
  for (let i = 0; i < 90; i++) {
    frame(1000 / 60);
    const sound = (clock - pressed) / 1000;
    worst = Math.max(worst, Math.abs(read().t - sound));
  }
  ok('after play, the playhead is where the sound is at every frame (it was one frame behind: 17 ms at 60 Hz)', worst < 1e-9, worst);
  pause();
}
{
  // The same at 30 Hz, from the middle of the graphic.
  seek(2);
  clock += 7;
  play();
  const pressed = clock;
  frame(1000 / 30);
  ok('at 30 Hz, the first frame is 33 ms on, not 0', near(read().t, 2 + 1 / 30, 1e-9), read().t);
  frame(1000 / 30);
  ok('and every frame after it keeps step', near(read().t, 2 + (clock - pressed) / 1000, 1e-9), read().t);
  pause();
}
{
  // Seek while playing: the clock counts on from the moment of the seek.
  seek(1);
  play();
  frame(16);
  frame(16);
  clock += 5;
  seek(3);
  const sought = clock;
  frame(11);
  ok('the first frame after a seek while playing counts the time since the seek', near(read().t, 3 + (clock - sought) / 1000, 1e-9), read().t);
  frame(1000 / 60);
  ok('and on from there', near(read().t, 3 + (clock - sought) / 1000, 1e-9), read().t);
  pause();
}
{
  // Seek while paused, wait, then play: the wait is not counted, the time since play is.
  seek(1);
  clock += 500;
  play();
  frame(16);
  ok('a paused seek counts nothing until play; then the time since play', near(read().t, 1.016, 1e-9), read().t);
  pause();
}
{
  // A press handled in the frame whose callbacks then run: the frame's time is before the press. No time, not
  // negative time.
  seek(1);
  play();
  const cb = queue.shift();
  cb(clock - 5);
  ok('a frame time before the press counts as nothing, not as time backwards', read().t === 1, read().t);
  frame(16);
  ok('and the clock counts on normally after it', near(read().t, 1.016, 1e-9), read().t);
  pause();
}
{
  // No performance clock (no page): the first frame only stamps, as it always did.
  Object.defineProperty(globalThis, 'performance', { value: undefined, configurable: true, writable: true });
  seek(1);
  play();
  frame(16);
  ok('without performance.now, the first frame only stamps', read().t === 1, read().t);
  frame(100);
  ok('and the next counts the gap', near(read().t, 1.1, 1e-9), read().t);
  pause();
  Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true });
}

// ── looping: never a time the film does not have ────────────────────────
{
  // 6 s at 30 fps: the last frame is at 5.9667 s, and it is shown until 6 s.
  bind(6, 30);
  setLoop(true);
  setSpeed(1);
  const end = lastFrame(read());
  seek(5.9);
  play();
  frame(50);
  ok('just before the last frame, the time is the time', near(read().t, 5.95, 1e-9), read().t);
  frame(30);
  ok('between the last frame and the end (5.98 s), the playhead shows the last frame, not 5.98 (t %= seconds left it there)', read().t === end, read().t);
  frame(10);
  ok('still within the last frame\'s own 1/30 s: still the last frame', read().t === end, read().t);
  frame(20);
  ok('past the end, the next round starts where the time says (6.01 s is 0.01 s in): a loop lasts the film\'s 6 s', near(read().t, 0.01, 1e-9), read().t);
  pause();
}
{
  // Pausing in the last frame's stretch, and seeking, forget the time held there.
  const end = lastFrame(read());
  seek(5.9);
  play();
  frame(80);
  ok('held on the last frame (5.98 s)', read().t === end, read().t);
  pause();
  ok('paused there, it is on the last frame', read().t === end && !read().playing);
  play();
  ok('play from there starts from the top, as from any last frame', read().t === 0);
  frame(16);
  ok('with nothing of the held time carried in', near(read().t, 0.016, 1e-9), read().t);
  seek(5.9);
  frame(80);
  ok('held again while playing', read().t === end, read().t);
  seek(2);
  frame(16);
  ok('a seek forgets the held time too', near(read().t, 2.016, 1e-9), read().t);
  pause();
}
{
  // A graphic shorter than a gap: the clock goes round as many times as the time says, and lands on a real frame.
  bind(0.2, 30);
  setSpeed(2);
  seek(0);
  play();
  frame(250); // 0.5 s of film: two and a half rounds
  ok('a gap of more than a whole round lands where the time says (0.5 s of a 0.2 s graphic is 0.1 s in)', near(read().t, 0.1, 1e-9), read().t);
  frame(45); // 0.09 s more: 0.19 s in, inside the last frame's stretch
  ok('and a round that ends inside the last frame\'s stretch shows the last frame', read().t === lastFrame(read()), read().t);
  setSpeed(1);
  pause();
  bind(6, 30);
}
{
  // Fuzz: random lengths, rates, speeds, frame gaps (now and then a stall) and seeks while playing. Every playhead
  // is inside [0, last frame]; and it is exactly where the time since the last seek says, round after round, or on
  // the last frame while the time is in that frame's own stretch.
  let seed = 20261003;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32; };
  let outside = 0, astray = 0, checks = 0;
  for (let run = 0; run < 60; run++) {
    const seconds = [0.5, 1, 2.4, 4.39, 6, 12][run % 6];
    const fps = [24, 25, 30, 50, 60][Math.floor(rnd() * 5)];
    bind(seconds, fps);
    setLoop(true);
    setSpeed(SPEEDS[Math.floor(rnd() * SPEEDS.length)]);
    seek(rnd() * seconds);
    play();
    let film = read().t; // the film's time since the last seek, unwrapped
    for (let i = 0; i < 400; i++) {
      if (rnd() < 0.02) {
        clock += rnd() * 30;
        seek(rnd() * seconds);
        film = read().t;
      }
      const ms = rnd() < 0.03 ? 300 + rnd() * 900 : rnd() * 40;
      frame(ms);
      film += Math.min(0.25, ms / 1000) * read().speed;
      const end = lastFrame(read());
      const t = read().t;
      checks++;
      if (!(t >= 0 && t <= end)) outside++;
      const u = film % seconds;
      const want = u >= end ? end : u;
      if (Math.abs(t - want) > 1e-6) astray++;
    }
    pause();
  }
  ok(`fuzz: ${checks} frames over 60 plays, every playhead inside [0, last frame]`, outside === 0, outside);
  ok('fuzz: and every one where the time says, round after round', astray === 0, astray);
  setSpeed(1);
  bind(6, 30);
}

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

if (realPerf) Object.defineProperty(globalThis, 'performance', realPerf);
else delete globalThis.performance;

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
