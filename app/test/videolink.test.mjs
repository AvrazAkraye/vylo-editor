// Links in a video request, and what a linked page offers the video (videolink.ts),
// and the clip scene the plan may make from a downloaded video (video.ts).
import { isVideoLink, linksIn, readPage, decodeEntities, MAX_LINKS } from '../.test-build/videolink.js';
import { sanitizeScene, newVideo, linksBlock, fitted, clipRoom, guideBlock, planPrompt, artPrompt, GUIDE_MAX } from '../.test-build/video.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// ── finding links ────────────────────────────────────────────────────────
ok('a link in a sentence, without the full stop after it', linksIn('Make a video from https://uod.ac/about. Thanks').join() === 'https://uod.ac/about');
ok('Arabic punctuation after a link is not part of it', linksIn('من هذا الرابط https://example.com/x، رجاءً')[0] === 'https://example.com/x');
ok('a bracketed link loses its bracket, one with brackets of its own keeps them',
  linksIn('(see https://a.com/b) and https://en.wikipedia.org/wiki/Duhok_(city)').join() === 'https://a.com/b,https://en.wikipedia.org/wiki/Duhok_(city)');
ok('each once, at most three', linksIn('https://a.com https://a.com https://b.com https://c.com https://d.com').length === MAX_LINKS);
ok('only http and https', linksIn('ftp://x.com javascript:alert(1) file:///etc/passwd').length === 0);
ok('no links, none', linksIn('a video about our college').length === 0 && linksIn(undefined).length === 0);

// ── video links ──────────────────────────────────────────────────────────
for (const u of ['https://www.youtube.com/watch?v=aqz-KE-bpKQ', 'https://youtu.be/aqz-KE-bpKQ', 'https://www.youtube.com/shorts/abc123',
  'https://www.instagram.com/reel/Cx1/', 'https://www.tiktok.com/@a/video/123', 'https://vimeo.com/76979871', 'https://x.com/a/status/123',
  'https://example.com/media/clip.mp4']) ok(`a video link: ${u}`, isVideoLink(u));
for (const u of ['https://www.youtube.com/@channel', 'https://www.instagram.com/someone/', 'https://uod.ac/about', 'https://vimeo.com/about', 'not a url'])
  ok(`not a video link: ${u}`, !isVideoLink(u));

// ── reading a page ───────────────────────────────────────────────────────
const html = `<!doctype html><html><head><title>Fallback title</title>
<meta property="og:title" content="University of Duhok &amp; Law">
<meta name="description" content="A public university in Duhok, founded in 1992.">
<meta property="og:site_name" content="UoD">
<meta property="og:image" content="/img/campus.jpg">
<meta property="og:video" content="https://cdn.example.com/tour.mp4">
</head><body>
<nav><a href="/">Home</a><p>Menu text</p></nav>
<header><p>Header text</p></header>
<h1>About the university</h1>
<p>The University of Duhok was founded in <b>1992</b>.</p>
<p>It has 25 colleges.</p>
<script>var x = "<p>not text</p>";</script>
<img src="/img/icon.png" width="32"><img src="/img/logo.svg"><img srcset="/img/a-400.jpg 400w, /img/a-1200.jpg 1200w" src="/img/a-400.jpg">
<iframe src="https://www.youtube.com/embed/aqz-KE-bpKQ"></iframe>
<footer><p>Footer text</p></footer>
</body></html>`;
const page = readPage(html, 'https://uod.ac/about');
ok('the Open Graph title, entities decoded', page.title === 'University of Duhok & Law', page.title);
ok('the description and the site name', page.description === 'A public university in Duhok, founded in 1992.' && page.site === 'UoD');
ok('headings and paragraphs are the text; menus, headers, footers and scripts are not',
  page.text.includes('## About the university') && page.text.includes('founded in 1992.') && page.text.includes('25 colleges')
  && !/Menu text|Header text|Footer text|not text/.test(page.text), page.text);
ok('pictures: the page\'s own first, absolute, the largest of a srcset, no icons or SVG',
  page.images[0] === 'https://uod.ac/img/campus.jpg' && page.images.includes('https://uod.ac/img/a-1200.jpg') && !page.images.some((i) => /icon|\.svg/.test(i)), page.images);
ok('videos: the page\'s own, and a YouTube embed as its watch link',
  page.videos[0] === 'https://cdn.example.com/tour.mp4' && page.videos.includes('https://www.youtube.com/watch?v=aqz-KE-bpKQ'), page.videos);
ok('a page with no title falls back to <title>, and a site to its host', (() => { const p = readPage('<title>Plain</title><p>Hello there</p>', 'https://www.plain.org/x'); return p.title === 'Plain' && p.site === 'plain.org' && p.text === 'Hello there'; })());
ok('entities, named and numbered', decodeEntities('&amp;&#1583;&#x631;&nbsp;x&bogus;') === '&در x&bogus;');
ok('broken HTML never throws', (() => { try { readPage('<p><b>unclosed <img src=', 'https://x.com'); readPage(null, 'nonsense'); return true; } catch { return false; } })());

// ── the clip scene ───────────────────────────────────────────────────────
let n = 0;
const newId = () => `id${++n}`;
const clip = { id: 'c1', src: 'data:video/mp4;base64,AAAA', seconds: 12, width: 1280, height: 720, hasAudio: true, title: 'Campus tour', author: 'UoD', sourceUrl: 'https://youtu.be/x', site: 'Youtube' };
const v = { ...newVideo({ id: 'v1', now: 1, request: 'a video from https://youtu.be/x', lang: 'en', format: 'landscape', style: 'modern', seconds: 30 }), clips: [clip] };
const s1 = sanitizeScene({ kind: 'clip', clip: 1, from: 4, caption: 'Walk through the campus', seconds: 20 }, v, newId);
ok('a clip scene by its number in the prompt, with its start and caption', s1?.kind === 'clip' && s1.clip === 'c1' && s1.from === 4 && s1.caption === 'Walk through the campus', s1);
ok('…lasting no longer than what is left of the clip', s1.seconds === 8 && clipRoom(s1, v) === 8, s1.seconds);
ok('…by its id too, and "video" is a clip', sanitizeScene({ kind: 'video', clip: 'c1' }, v, newId)?.clip === 'c1');
ok('a clip the video does not have is no scene', sanitizeScene({ kind: 'clip', clip: 3 }, v, newId) === null && sanitizeScene({ kind: 'clip', clip: 1 }, { ...v, clips: [] }, newId) === null);
ok('a start past the end is held inside the clip', sanitizeScene({ kind: 'clip', clip: 1, from: 99 }, v, newId).from === 10);
ok('fitting the film to its length keeps a clip scene inside its clip',
  fitted([s1, { id: 'k', kind: 'kinetic', text: 'Hello there', seconds: 3, transition: 'fade' }], { seconds: 60, clips: [clip] })[0].seconds <= 8);
const block = linksBlock({ links: [{ url: 'https://uod.ac', kind: 'page', title: 'UoD', description: 'A university', text: 'Founded in 1992.', at: 1 }, { url: 'https://bad', kind: 'page', title: 'x', at: 1, error: 'no' }], clips: [clip] });
ok('the plan is told the linked page\'s words and the numbered clips, not a failed link',
  block.includes('Founded in 1992.') && block.includes('1. "Campus tour" from Youtube, 12 seconds long') && !block.includes('https://bad'), block);
ok('no links, no block', linksBlock({}) === '');

// ── the person's direction ───────────────────────────────────────────────
{
  const g = { name: 'Motion guide', text: 'Create seven scenes: hook, familiar world, disruption. Use no hard cuts. About [TOPIC].' };
  const vv = { ...v, guide: g, scenes: [{ id: 'a', kind: 'kinetic', text: 'Hi there', seconds: 3, transition: 'fade' }] };
  ok('a direction reaches the plan, the restyle and every prompt built on the system prompt',
    planPrompt(vv).system.includes('Use no hard cuts.') && artPrompt(vv).system.includes('Use no hard cuts.') && planPrompt(vv).system.includes('"Motion guide"'));
  ok('…as the person\'s, within what the app draws, the honesty rules still over it',
    /Where it asks for something the app cannot draw/.test(guideBlock(vv)) && /rules on numbers, quotations, people and claims still hold/.test(guideBlock(vv)));
  ok('no direction, nothing added', guideBlock(v) === '' && !planPrompt(v).system.includes("THE PERSON'S DIRECTION") && guideBlock({ guide: { name: 'x', text: '   ' } }) === '');
  ok('a long guide is cut to its limit', guideBlock({ guide: { name: 'x', text: 'y'.repeat(GUIDE_MAX + 500) } }).includes('y'.repeat(GUIDE_MAX)) && !guideBlock({ guide: { name: 'x', text: 'y'.repeat(GUIDE_MAX + 500) } }).includes('y'.repeat(GUIDE_MAX + 1)));
  ok('the app\'s own direction now tells a story, adds something new each scene and lets the key moment breathe',
    /A story, not a list of facts/.test(planPrompt(v).system) && /Every scene adds something new/.test(planPrompt(v).system) && /Let the key moment breathe/.test(planPrompt(v).system));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
