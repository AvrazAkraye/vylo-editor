// Ask Vylo's router: one box, and where each request goes.
//
// What matters: a presentation or a video named anywhere is that, even from a
// document ("slides from my thesis"); a motion graphic is asked for by its own
// words and wins over the word "video" it may sit beside; a document of your
// own is its chat, not a new thesis; a kind of document is a new one; and a
// module that is off is never where anything is sent.
import { destinations, route } from '../.test-build/askroute.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const all = new Set(['research', 'video', 'motion', 'slides']);
const docs = [
  { id: 'old', title: 'Old', kind: 'article', updated: 1 },
  { id: 'thesis', title: 'Thesis', kind: 'masters', updated: 2 },
  { id: 'new', title: 'New', kind: 'working-paper', updated: 3 },
];
const r = (text, on = all, d = docs) => route(text, { docs: d, on });

// ── new research documents ────────────────────────────────────────────────
ok('ورقة عمل is a new working paper', r('اكتب ورقة عمل عن الذكاء الاصطناعي').dest === 'research' && r('اكتب ورقة عمل عن الذكاء الاصطناعي').kind === 'working-paper');
ok('with the phrase that decided it', r('اكتب ورقة عمل عن المناخ').phrase === 'ورقة عمل');
ok('a Sorani master\'s thesis', r('نامەی ماستەر دەربارەی زیرەکی دەستکرد بنووسە').dest === 'research');
ok('an English PhD dissertation', r('Write a PhD dissertation on federalism').kind === 'phd');

// ── video ─────────────────────────────────────────────────────────────────
ok('a video in English', r('make a 30 second video about our clinic').dest === 'video');
ok('فيديو', r('اصنع فيديو قصير عن جامعة دهوك').dest === 'video');
ok('ڤیدیۆ in Sorani', r('ڤیدیۆیەک دروست بکە دەربارەی زانکۆ').dest === 'video');
ok('a bare مقطع is a passage, not a video', r('اكتب مقطعا عن الفيدرالية').dest !== 'video');
ok('a video word inside another word does not count', r('write about videography history').dest !== 'video');

// ── motion graphics ───────────────────────────────────────────────────────
ok('a lower third', r('make a lower third for our speaker').dest === 'motion' && r('make a lower third for our speaker').phrase === 'lower third');
ok('an animated logo reveal', r('an animated logo reveal for my studio').dest === 'motion');
ok('motion graphics, plural', r('I need motion graphics for the conference').dest === 'motion');
ok('a motion graphic video is still a motion graphic', r('a motion graphic video about our clinic').dest === 'motion');
ok('kinetic typography', r('kinetic typography for the chorus').dest === 'motion');
ok('موشن جرافيك', r('اصنع موشن جرافيك لشركتنا').dest === 'motion');
ok('شعار متحرك', r('أريد شعار متحرك لمتجري').dest === 'motion');
ok('مۆشن گرافیک in Sorani', r('مۆشن گرافیکێک دروست بکە بۆ کۆمپانیاکەم').dest === 'motion');
ok('a plain video is still a video with motion on', r('make a 30 second video about our clinic').dest === 'video');
ok('slides that mention an animated title are still slides', r('slides with an animated title').dest === 'slides');
ok('"animation" alone is not enough: it is as likely to be about code', r('add an animation to this button').dest === 'chat');
ok('motion off: a motion graphic video falls to video', r('a motion graphic video about our clinic', new Set(['research', 'video', 'slides'])).dest === 'video');
ok('motion off: a lower third falls to the chat', r('make a lower third', new Set(['research', 'slides'])).dest === 'chat');

// ── slides ────────────────────────────────────────────────────────────────
ok('slides from words', r('make slides about climate change').dest === 'slides' && !r('make slides about climate change').docId);
ok('عرض تقديمي', r('أريد عرض تقديمي عن الطاقة').dest === 'slides');
ok('slides from my thesis take the thesis', r('turn my thesis into slides').dest === 'slides' && r('turn my thesis into slides').docId === 'thesis');
ok('from my research: the newest', r('make a presentation from my research').docId === 'new');
ok('Sorani: سلاید from توێژینەوەکەم', r('لە توێژینەوەکەم سلاید دروست بکە').docId === 'new');
ok('slides beat the kind of document they are about', r('presentation for my master\'s thesis defence').dest === 'slides');

// ── a document of yours ───────────────────────────────────────────────────
ok('my thesis is its chat', r('rewrite the introduction of my thesis').dest === 'doc-chat' && r('rewrite the introduction of my thesis').docId === 'thesis');
ok('بحثي is the newest document', r('ما هي أضعف أجزاء بحثي؟').dest === 'doc-chat' && r('ما هي أضعف أجزاء بحثي؟').docId === 'new');
ok('with no documents, it is a new one or the chat', r('rewrite the introduction of my thesis', all, []).dest === 'research');
ok('ڤەکولینا من in Badini', r('پێشەکیا ڤەکولینا من کورت بکە').dest === 'doc-chat');

// ── the chat, and modules that are off ────────────────────────────────────
ok('anything else is the chat', r('what is the capital of Iraq?').dest === 'chat' && r('what is the capital of Iraq?').phrase === '');
ok('empty is the chat', r('   ').dest === 'chat' && route(undefined, { docs, on: all }).dest === 'chat');
ok('video off: a video request is not sent to it', r('make a video about X', new Set(['research', 'slides'])).dest === 'chat');
ok('slides off: slides from my thesis falls to the document', r('turn my thesis into slides', new Set(['research'])).dest === 'doc-chat');
ok('research off: a thesis request is the chat', r('write a master\'s thesis on X', new Set(['video'])).dest === 'chat');

// ── what the box offers ───────────────────────────────────────────────────
ok('every destination when all are on and there are documents', destinations(all, true).join() === 'research,doc-chat,video,motion,slides,chat');
ok('no document chat without documents', !destinations(all, false).includes('doc-chat'));
ok('only the chat when every module is off', destinations(new Set(), true).join() === 'chat');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
