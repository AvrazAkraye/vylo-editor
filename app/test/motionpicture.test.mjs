// A picture chosen for a picture layer: which files are taken, how big they
// are drawn, how they are written, and the loop that gets one under the size a
// graphic may hold.
//
// What matters. Only the five picture types are taken, by their type or — when
// a file carries none — by the ending of their name, and nothing over 12 MB. A
// picture is never enlarged and never loses its shape; it is at most 2048
// pixels on its long side. It is written as PNG when it has transparency or is
// a drawing (SVG, GIF), and as JPEG otherwise. The layer it goes into has the
// picture's shape, 40 u on its long side. And the size loop always returns a
// URL within the budget, or null — never one over it, never a picture smaller
// than a smudge, never an endless loop — and it asks for the smallest change
// that fits: the first try when that fits, a lower JPEG quality before a
// smaller picture.
import {
  PICTURE_ACCEPT, PICTURE_LONG_U, PICTURE_MAX_BYTES, PICTURE_MAX_SIDE,
  anyTransparent, boxFor, fitToBudget, fitWithin, outputType, pictureType, svgDrawSize, svgSize, tooBig,
} from '../.test-build/motionpicture.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── which files ──
{
  ok('the accept list is the five types', same(PICTURE_ACCEPT.split(',').sort(),
    ['image/gif', 'image/jpeg', 'image/png', 'image/svg+xml', 'image/webp']), PICTURE_ACCEPT);
  for (const t of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']) {
    ok(`${t} is taken`, pictureType({ type: t, name: 'x' }) === t);
  }
  ok('a type in capitals is taken', pictureType({ type: 'IMAGE/PNG', name: 'x' }) === 'image/png');
  for (const t of ['image/tiff', 'image/heic', 'image/bmp', 'application/pdf', 'text/html', 'video/mp4']) {
    ok(`${t} is refused`, pictureType({ type: t, name: 'photo.png' }) === null);
  }
  ok('a declared type wins over the name', pictureType({ type: 'text/plain', name: 'a.png' }) === null);
  ok('no type: read by the name', pictureType({ type: '', name: 'Logo.SVG' }) === 'image/svg+xml');
  ok('no type: .jpg is JPEG', pictureType({ type: '', name: 'a.b.jpg' }) === 'image/jpeg');
  ok('no type: .jpeg is JPEG', pictureType({ name: 'IMG_1.jpeg' }) === 'image/jpeg');
  ok('octet-stream: read by the name', pictureType({ type: 'application/octet-stream', name: 'x.webp' }) === 'image/webp');
  ok('no type and an unknown ending is refused', pictureType({ type: '', name: 'notes.txt' }) === null);
  ok('no type and no ending is refused', pictureType({ type: '', name: 'picture' }) === null);
  ok('a name that only looks like one is refused', pictureType({ type: '', name: 'png' }) === null);
  ok('an ending inherited from Object is refused', pictureType({ type: '', name: 'x.constructor' }) === null);
  ok('nothing at all is refused', pictureType({}) === null);
}

// ── how big a file ──
{
  ok('the limit is 12 MB', PICTURE_MAX_BYTES === 12 * 1024 * 1024);
  ok('a small file is taken', !tooBig(200_000));
  ok('exactly 12 MB is taken', !tooBig(PICTURE_MAX_BYTES));
  ok('a byte over is refused', tooBig(PICTURE_MAX_BYTES + 1));
  ok('a size that is not a number is refused', tooBig(NaN) && tooBig(-1) && tooBig(Infinity));
}

// ── how big it is drawn ──
{
  ok('the long side is 2048', PICTURE_MAX_SIDE === 2048);
  ok('a camera photo comes down to 2048 wide', same(fitWithin(6000, 4000, 2048), { w: 2048, h: 1365 }));
  ok('a tall one comes down to 2048 high', same(fitWithin(3024, 4032, 2048), { w: 1536, h: 2048 }));
  ok('a small picture is never enlarged', same(fitWithin(640, 480, 2048), { w: 640, h: 480 }));
  ok('exactly the limit stays', same(fitWithin(2048, 100, 2048), { w: 2048, h: 100 }));
  ok('a very thin strip keeps a pixel', same(fitWithin(40000, 10, 2048), { w: 2048, h: 1 }));
  const r = fitWithin(4000, 3000, 2048);
  ok('the shape is kept', Math.abs(r.w / r.h - 4 / 3) < 0.002, r);
  ok('a size that is not one is null', fitWithin(0, 100, 2048) === null && fitWithin(NaN, 5, 2048) === null && fitWithin(5, 5, 0) === null);
}

// ── the layer's box ──
{
  ok('a new layer is 40 u on its long side', PICTURE_LONG_U === 40);
  ok('landscape: 40 by 22.5', same(boxFor(1920, 1080), { w: 40, h: 22.5 }));
  ok('portrait: 22.5 by 40', same(boxFor(1080, 1920), { w: 22.5, h: 40 }));
  ok('square: 40 by 40', same(boxFor(512, 512), { w: 40, h: 40 }));
  ok('a panorama stays a strip', same(boxFor(10000, 100), { w: 40, h: 0.4 }));
  ok('never thinner than a tenth of a u', boxFor(100000, 1).h === 0.1);
  ok('another long side', same(boxFor(300, 200, 60), { w: 60, h: 40 }));
  ok('a size that is not one is a square', same(boxFor(0, 0), { w: 40, h: 40 }) && same(boxFor(NaN, 3), { w: 40, h: 40 }));
}

// ── how it is written ──
{
  ok('an opaque photo is JPEG', outputType('image/jpeg', false) === 'image/jpeg');
  ok('an opaque PNG is JPEG', outputType('image/png', false) === 'image/jpeg');
  ok('an opaque WebP is JPEG', outputType('image/webp', false) === 'image/jpeg');
  ok('a PNG with transparency is PNG', outputType('image/png', true) === 'image/png');
  ok('a WebP with transparency is PNG', outputType('image/webp', true) === 'image/png');
  ok('an SVG is PNG', outputType('image/svg+xml', false) === 'image/png');
  ok('a GIF is PNG', outputType('image/gif', false) === 'image/png');

  const opaque = new Uint8ClampedArray([1, 2, 3, 255, 9, 9, 9, 255]);
  const clear = new Uint8ClampedArray([1, 2, 3, 255, 9, 9, 9, 254]);
  ok('opaque pixels have no transparency', !anyTransparent(opaque));
  ok('one pixel short of opaque has', anyTransparent(clear));
  ok('a colour of 0 is not transparency', !anyTransparent(new Uint8ClampedArray([0, 0, 0, 255])));
  ok('no pixels have none', !anyTransparent(new Uint8ClampedArray(0)));
}

// ── an SVG's size ──
{
  ok('width and height', same(svgSize('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"></svg>'), { w: 300, h: 150 }));
  ok('in px', same(svgSize("<svg width='64px' height='32px'>"), { w: 64, h: 32 }));
  ok('a viewBox when there is no size', same(svgSize('<svg viewBox="0 0 24 12"><path/></svg>'), { w: 24, h: 12 }));
  ok('a viewBox with commas', same(svgSize('<svg viewBox="0,0,100,50">'), { w: 100, h: 50 }));
  ok('percentages are not a size', same(svgSize('<svg width="100%" height="100%" viewBox="0 0 8 4">'), { w: 8, h: 4 }));
  ok('an XML prologue first', same(svgSize('<?xml version="1.0"?>\n<svg height="10" width="20">'), { w: 20, h: 10 }));
  ok('no size at all is null', svgSize('<svg><circle r="3"/></svg>') === null);
  ok('not an SVG is null', svgSize('<html></html>') === null);
  ok('drawn 1024 on its long side', same(svgDrawSize({ w: 24, h: 12 }), { w: 1024, h: 512 }));
  ok('a big one too', same(svgDrawSize({ w: 4000, h: 8000 }), { w: 512, h: 1024 }));
  ok('an unknown size is a square', same(svgDrawSize(null), { w: 1024, h: 1024 }));
}

// ── the size loop, with a fake encoder ──
{
  // Characters proportional to the area, and to the JPEG quality: a stand-in
  // for how real encoders grow.
  const made = [];
  const encoder = (perPixel) => (w, h, q) => {
    made.push({ w, h, q });
    return 'data:image/x;base64,' + 'A'.repeat(Math.round(w * h * perPixel * q));
  };

  made.length = 0;
  let r = fitToBudget({ w: 2048, h: 1365 }, 6_000_000, encoder(1), true);
  ok('what fits the first time is kept as it is', r && r.w === 2048 && r.h === 1365 && r.quality === 0.9 && made.length === 1, made);

  made.length = 0;
  r = fitToBudget({ w: 2048, h: 1365 }, 2_300_000, encoder(1), true);
  ok('a JPEG a little over drops its quality first', r && r.w === 2048 && r.quality === 0.8, { r: r && { w: r.w, q: r.quality }, made });
  ok('and is within the budget', r && r.src.length <= 2_300_000);

  made.length = 0;
  r = fitToBudget({ w: 2048, h: 1365 }, 600_000, encoder(1), true);
  ok('a JPEG far over is made smaller after the quality', r && r.w < 2048 && r.quality === 0.7, r && { w: r.w, q: r.quality });
  ok('within the budget', r && r.src.length <= 600_000, r && r.src.length);
  ok('its shape kept', r && Math.abs(r.w / r.h - 2048 / 1365) < 0.01, r && [r.w, r.h]);
  ok('quality never below 0.7', made.every((m) => m.q >= 0.7 - 1e-9), made.map((m) => m.q));

  made.length = 0;
  r = fitToBudget({ w: 2048, h: 2048 }, 1_000_000, encoder(3), false);
  ok('a PNG is made smaller at once, its quality untouched', r && made.every((m) => m.q === 1) && made[1] && made[1].w < 2048, made);
  ok('and fits', r && r.src.length <= 1_000_000);
  ok('in a few tries', made.length <= 4, made.length);

  made.length = 0;
  r = fitToBudget({ w: 2048, h: 2048 }, 5_000, encoder(3), false);
  ok('what cannot fit above a smudge is null', r === null);
  ok('and it stopped before a smudge', made.every((m) => Math.max(m.w, m.h) >= 96), made.map((m) => m.w));

  r = fitToBudget({ w: 2048, h: 2048 }, 1_000, () => 'x'.repeat(2_000), false);
  ok('an encoder that never shrinks gives up', r === null);

  let calls = 0;
  r = fitToBudget({ w: 4000, h: 4000 }, 100, () => { calls++; return 'x'.repeat(10_000); }, true);
  ok('and never tries forever', r === null && calls <= 12, calls);

  made.length = 0;
  r = fitToBudget({ w: 1000, h: 10 }, 5_000, encoder(1), false);
  ok('a thin strip shrinks by its long side', r && r.src.length <= 5_000 && r.h >= 1, r && [r.w, r.h]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
