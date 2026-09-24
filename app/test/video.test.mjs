// The Video module's engine: what a request asks for, what the model is told,
// and how its storyboard is read.
//
// Three properties matter more than the rest. A request's length, frame, style
// and language are read the same in Arabic, Sorani, Badini and English, with
// either kind of digits. Whatever the model sends back — fenced, bare, broken,
// enormous or hostile — comes out as scenes the app can draw and nothing else.
// And the prompt says, every time, that the video invents no numbers and puts
// no words in a real person's mouth.
import {
  LENGTHS, TRANSITION_FRAMES, blankScene, durationInFrames, formatIn, isRtl, newVideo, parsePlan, parseScene,
  planPrompt, sanitizeScene, sceneFrames, scenePrompt, secondsIn, styleIn, videoLangOf,
} from '../.test-build/video.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const FPS = 30;
const KINDS = ['title', 'kinetic', 'bullets', 'stat', 'chart', 'quote', 'image', 'split', 'steps', 'outro'];
const LANGS = ['ar', 'ckb', 'kmr', 'en'];
let n = 0;
const newId = () => `id${++n}`;
const video = (o = {}) => ({
  ...newVideo({ id: 'v1', now: 1000, request: 'a promo for our clinic', lang: 'en', format: 'portrait', style: 'modern', seconds: 30 }),
  ...o,
});
const playSeconds = (scenes) => durationInFrames({ scenes }) / FPS;
const texts = (s) => JSON.stringify(s);
const scene = (o) => ({ id: 'x', seconds: 4, transition: 'fade', ...o });

// ── timing ────────────────────────────────────────────────────────────────
ok('a transition overlaps half a second', TRANSITION_FRAMES === 15);
ok('a 4-second scene is 120 frames', sceneFrames(scene({ kind: 'kinetic', text: 'a', seconds: 4 })) === 120);
ok('a scene is never under a second', sceneFrames(scene({ kind: 'kinetic', text: 'a', seconds: 0.2 })) === FPS);
ok('a length that is not a number counts as a second, never NaN',
  sceneFrames(scene({ kind: 'kinetic', text: 'a', seconds: NaN })) === FPS
  && sceneFrames(scene({ kind: 'kinetic', text: 'a', seconds: undefined })) === FPS);
ok('fractions of a frame round', sceneFrames(scene({ kind: 'kinetic', text: 'a', seconds: 2.51 })) === 75);
{
  const three = [scene({ kind: 'title', title: 'a' }), scene({ kind: 'kinetic', text: 'b' }), scene({ kind: 'outro', headline: 'c', transition: 'fade' })];
  ok('the film is its scenes less the transitions between them — the last hands over to nothing',
    durationInFrames({ scenes: three }) === 3 * 120 - 2 * TRANSITION_FRAMES, durationInFrames({ scenes: three }));
  const cut = [scene({ kind: 'title', title: 'a', transition: 'none' }), scene({ kind: 'kinetic', text: 'b' }), scene({ kind: 'outro', headline: 'c' })];
  ok('a cut overlaps nothing', durationInFrames({ scenes: cut }) === 3 * 120 - TRANSITION_FRAMES);
  ok('one scene is its own length', durationInFrames({ scenes: [three[0]] }) === 120);
}
ok('an empty storyboard is still a second long', durationInFrames({ scenes: [] }) === FPS && durationInFrames({}) === FPS);
ok('two one-second scenes never come to less than a second',
  durationInFrames({ scenes: [scene({ kind: 'kinetic', text: 'a', seconds: 1 }), scene({ kind: 'kinetic', text: 'b', seconds: 1 })] }) >= FPS);
ok('Arabic and both Kurdish scripts are right to left, English is not',
  isRtl('ar') && isRtl('ckb') && isRtl('kmr') && !isRtl('en'));
ok('the length presets are ascending and inside 5..180',
  LENGTHS.length >= 4 && LENGTHS.every((x, i) => x >= 5 && x <= 180 && (i === 0 || x > LENGTHS[i - 1])));

// ── a new video ───────────────────────────────────────────────────────────
{
  const v = newVideo({ id: 'a', now: 42, request: 'r', lang: 'ckb', format: 'square', style: 'bold', seconds: 30 });
  ok('a new video starts empty and new', v.scenes.length === 0 && v.stage === 'new' && v.title === '' && v.created === 42 && v.updated === 42);
  ok('with its choices', v.lang === 'ckb' && v.format === 'square' && v.style === 'bold' && v.seconds === 30 && v.request === 'r');
  ok('credits on by default, no brand is an empty brand', v.credits === true && JSON.stringify(v.brand) === '{}');
  ok('a length outside 5..180 is brought back in',
    newVideo({ ...v, now: 1, seconds: 2 }).seconds === 5 && newVideo({ ...v, now: 1, seconds: 999 }).seconds === 180
    && newVideo({ ...v, now: 1, seconds: NaN }).seconds === 30);
  const brand = { name: 'Nuri Clinic', primary: '#112233' };
  const b = newVideo({ id: 'b', now: 1, request: '', lang: 'en', format: 'landscape', style: 'warm', seconds: 15, brand });
  ok('the brand is copied, not shared', b.brand.name === 'Nuri Clinic' && b.brand !== brand);
}

// ── the length a request names ────────────────────────────────────────────
const secs = [
  ['30 seconds', 30], ['a 30-second promo', 30], ['30s promo', 30], ['30 sec', 30], ['45secs', 45],
  ['1 minute', 60], ['1.5 min', 90], ['2 minutes', 120], ['a minute long', 60], ['half a minute', 30],
  ['thirty-second spot', 30], ['ninety seconds', 90], ['fifteen seconds', 15],
  ['فيديو 30 ثانية', 30], ['فيديو مدته ٤٥ ثانية', 45], ['٣٠ ثانیه', 30], ['ثلاثين ثانية', 30], ['خمس عشرة ثانية', 15],
  ['فيديو دقيقة', 60], ['دقيقة ونصف', 90], ['دقيقتين', 120], ['نصف دقيقة', 30], ['٢ دقائق', 120],
  ['ڤیدیۆیەکی ٣٠ چرکەیی', 30], ['۳۰ چرکە', 30], ['٤٥ چرکە بۆ ئینستاگرام', 45], ['خولەکێک', 60], ['نیو خولەک', 30], ['خولەک و نیو', 90],
  ['ڤیدیۆیەکێ ٦٠ چرکە', 60], ['نیڤ دەقیقە', 30], ['دەقیقە و نیڤ', 90],
  ['10 minutes', 180], ['2 seconds', 5], ['٣ ثواني', 5],
];
for (const [text, want] of secs) ok(`"${text}" is ${want} seconds`, secondsIn(text) === want, secondsIn(text));
for (const text of ['a promo for our clinic', 'wait a second', 'the 1930s', 'our 3 branches', '', 'فيديو عن العيادة', 'بۆ ٣ لقەکان'])
  ok(`"${text}" names no length`, secondsIn(text) === null, secondsIn(text));
ok('not a string names no length', secondsIn(undefined) === null && secondsIn(42) === null);

// ── the frame ─────────────────────────────────────────────────────────────
const formats = [
  ['a vertical video', 'portrait'], ['for Instagram Reels', 'portrait'], ['TikTok ad', 'portrait'], ['YouTube Shorts', 'portrait'],
  ['9:16', 'portrait'], ['٩:١٦', 'portrait'], ['instagram story', 'portrait'],
  ['فيديو عمودي', 'portrait'], ['بشكل طولي', 'portrait'], ['للتيك توك', 'portrait'], ['ستوري انستغرام', 'portrait'], ['ريلز', 'portrait'],
  ['ڤیدیۆیەکی ستوونی', 'portrait'], ['شاقولی', 'portrait'], ['بۆ تیک تۆک', 'portrait'],
  ['a square post', 'square'], ['1:1', 'square'], ['فيديو مربع', 'square'], ['چوارگۆشە', 'square'], ['چارگۆشە', 'square'],
  ['for YouTube', 'landscape'], ['landscape 16:9', 'landscape'], ['horizontal', 'landscape'], ['فيديو أفقي', 'landscape'],
  ['اليوتيوب', 'landscape'], ['ئاسۆیی', 'landscape'],
];
for (const [text, want] of formats) ok(`"${text}" is ${want}`, formatIn(text) === want, formatIn(text));
for (const text of ['tell the story of our clinic', 'a promo', 'squared away', 'تحدث عن قصة العيادة', ''])
  ok(`"${text}" names no frame`, formatIn(text) === null, formatIn(text));

// ── the style ─────────────────────────────────────────────────────────────
const styles = [
  ['bold and energetic', 'bold'], ['a luxury feel', 'elegant'], ['neon cyberpunk', 'neon'], ['keep it minimal', 'minimal'],
  ['warm and friendly', 'warm'], ['clean and modern', 'modern'],
  ['بأسلوب فاخر', 'elegant'], ['تصميم بسيط', 'minimal'], ['حماسي', 'bold'], ['نيون', 'neon'], ['عصري', 'modern'], ['دافئ', 'warm'],
  ['شێوازێکی سادە', 'minimal'], ['گەرم', 'warm'], ['نیۆن', 'neon'], ['بەهێز', 'bold'], ['مۆدێرن', 'modern'],
];
for (const [text, want] of styles) ok(`"${text}" is ${want}`, styleIn(text) === want, styleIn(text));
ok('the style named first wins', styleIn('minimal but a little warm') === 'minimal' && styleIn('warm, not minimal') === 'warm');
ok('a request without a style names none', styleIn('a promo for our clinic') === null && styleIn('') === null);
ok('boldly is not bold, a word inside a word never counts', styleIn('boldly go') === null);

// ── the language ──────────────────────────────────────────────────────────
const langs = [
  ['a promo for our clinic', 'en'], ['فيديو ترويجي للعيادة', 'ar'],
  ['ڤیدیۆیەک دروستبکە لەسەر نەخۆشخانەکەمان', 'ckb'], ['من دڤێت ڤیدیۆیەکێ چێبکەم ل سەر نەخۆشخانێ', 'kmr'],
  ['make a video in Arabic', 'ar'], ['an Arabic video about dates', 'ar'], ['video in Sorani', 'ckb'], ['a Badini video', 'kmr'],
  ['video in Kurdish', 'ckb'], ['فيديو بالإنجليزية عن العيادة', 'en'], ['فيديو بالكردية', 'ckb'], ['بالكردية البادينية', 'kmr'],
  ['بە ئینگلیزی ڤیدیۆیەک دروستبکە', 'en'], ['ب عەرەبی ڤیدیۆیەکێ چێبکە', 'ar'],
  ['in Kurdish please — ڤیدیۆیەکێ چێبکە ژ بۆ مە دڤێت', 'kmr'],
];
for (const [text, want] of langs) ok(`"${text}" is ${want}`, videoLangOf(text, 'en') === want, videoLangOf(text, 'en'));
ok('no letters at all is the fallback', videoLangOf('30 / 9:16', 'ar') === 'ar' && videoLangOf('', 'kmr') === 'kmr');

// ── the prompt ────────────────────────────────────────────────────────────
{
  const v = video({ request: 'a 30-second vertical promo for Nuri Clinic, open 8am to 10pm', brand: { name: 'Nuri Clinic' } });
  const p = planPrompt(v);
  const all = `${p.system}\n${p.user}`;
  ok('the prompt is a system and a user part', typeof p.system === 'string' && typeof p.user === 'string' && p.system && p.user);
  ok('it carries the request as written', p.user.includes(v.request));
  ok('fenced as a description, not instructions', /not instructions/i.test(p.user) && p.user.includes('<<<') && p.user.includes('>>>'));
  ok('a motion designer and a scriptwriter', /motion designer/i.test(p.system) && /scriptwriter/i.test(p.system));
  ok('the hook comes first', /hook/i.test(p.system) && /first scene/i.test(p.system));
  ok('one idea per scene', /one idea per scene/i.test(p.system));
  ok('three words a second, and seconds fit the words', /three words a second/i.test(p.system) && /seconds/.test(p.system));
  ok('the arc, to a call to action', /problem/i.test(p.system) && /proof/i.test(p.system) && /call to action/i.test(p.system));
  ok('varied kinds and transitions', /never the same kind twice/i.test(p.system) && /Do not use one transition everywhere/i.test(p.system));
  ok('never invent a number — kinetic or bullets instead', /never invent a statistic/i.test(p.system) && /"kinetic" or "bullets"/.test(p.system));
  ok('never words in a real person\'s mouth', /Never put words in the mouth of a real person/i.test(p.system) && /testimonial/i.test(p.system));
  ok('never an invented phone or website', /Never invent one/i.test(p.system) && /phone/i.test(p.system));
  ok('JSON only', /JSON and nothing else/i.test(p.system) && /one JSON object and nothing else/i.test(p.user));
  ok('every kind\'s shape is described', KINDS.every((k) => p.user.includes(`"kind":"${k}"`)));
  ok('every transition is named', ['fade', 'slide', 'wipe', 'zoom', 'none'].every((t) => all.includes(`"${t}"`)));
  ok('imageQuery is English', /"imageQuery" is always in English/.test(p.user));
  ok('the length, the frame and the scene count', p.user.includes('about 30 seconds') && p.user.includes('1080×1920') && /Scenes: \d+ to \d+/.test(p.user));
  ok('the style', p.user.includes('modern'));
  ok('the brand, spelled as given', p.user.includes('Brand: Nuri Clinic'));
  ok('English words for an English video', /every on-screen word in English/.test(p.system));
  const example = p.user.slice(p.user.lastIndexOf('{"title"'));
  const ex = parsePlan(example, video({ seconds: 18 }), newId);
  ok('the example in the prompt is itself a valid storyboard', ex && ex.scenes.length === 5 && ex.scenes[0].kind === 'title' && ex.scenes[4].kind === 'outro', ex);
  ok('and has no figures in it to copy', !/"stat"|"chart"/.test(example.replace(/"kind":"(stat|chart)"/g, 'X')) && !/\d+%/.test(example));

  const byLang = Object.fromEntries(LANGS.map((l) => [l, planPrompt(video({ lang: l }))]));
  ok('Arabic video: Arabic words', /every on-screen word in Arabic/.test(byLang.ar.system) && byLang.ar.user.includes('in Arabic'));
  ok('Sorani video: Sorani, in Kurdish letters, not Badini', /Central Kurdish \(Sorani\)/.test(byLang.ckb.system) && byLang.ckb.system.includes('ڕ ڵ') && /not Badini/.test(byLang.ckb.system));
  ok('Badini video: Badini, with ڤ, not Sorani', /Badini/.test(byLang.kmr.system) && byLang.kmr.system.includes('ڤ') && /not Sorani forms/.test(byLang.kmr.system));
  ok('Kurdish never with Arabic substitute letters', /never Arabic substitutes/.test(byLang.ckb.system) && /never Arabic substitutes/.test(byLang.kmr.system));
  ok('the square frame is described', planPrompt(video({ format: 'square' })).user.includes('1080×1080'));
  ok('a longer video asks for more scenes', (() => {
    const count = (s) => Number(planPrompt(video({ seconds: s })).user.match(/Scenes: (\d+) to (\d+)/)[2]);
    return count(15) < count(30) && count(30) < count(90) && count(15) >= 3;
  })());
  ok('no brand, no brand line', !planPrompt(video()).user.includes('Brand:'));
}

// ── reading the storyboard ────────────────────────────────────────────────
const good = {
  title: 'Nuri Clinic',
  scenes: [
    { kind: 'title', title: 'Care that never closes', subtitle: 'Open late, every day', imageQuery: 'modern clinic reception', seconds: 3, transition: 'zoom' },
    { kind: 'kinetic', text: 'Sick at midnight? We are here.', seconds: 3, transition: 'slide' },
    { kind: 'split', heading: 'Real doctors', text: 'Every visit with a licensed physician.', imageQuery: 'doctor talking to patient', seconds: 4, transition: 'wipe' },
    { kind: 'bullets', heading: 'What we treat', points: ['Fever and flu', 'Minor injuries', 'Check-ups'], seconds: 5, transition: 'fade' },
    { kind: 'steps', heading: 'How to visit', steps: ['Book online', 'Come in', 'Feel better'], seconds: 5, transition: 'slide' },
    { kind: 'outro', headline: 'Nuri Clinic', cta: 'Book your visit', url: 'nuriclinic.com', seconds: 3, transition: 'fade' },
  ],
};
const goodJson = JSON.stringify(good);
{
  const v = video();
  const fenced = parsePlan('Here is your storyboard:\n```json\n' + JSON.stringify(good, null, 2) + '\n```\nEnjoy!', v, newId);
  ok('a fenced reply with prose around it is read', fenced && fenced.scenes.length === 6 && fenced.title === 'Nuri Clinic', fenced);
  const bare = parsePlan(goodJson, v, newId);
  ok('a bare reply is read', bare && bare.scenes.length === 6);
  ok('kinds and words survive', bare.scenes.map((s) => s.kind).join() === 'title,kinetic,split,bullets,steps,outro'
    && bare.scenes[3].points.length === 3 && bare.scenes[5].url === 'nuriclinic.com');
  ok('the last scene hands over to nothing', bare.scenes[5].transition === 'none');
  ok('the others keep their transitions', bare.scenes[0].transition === 'zoom' && bare.scenes[2].transition === 'wipe');
  ok('ids are fresh and all different', new Set(bare.scenes.map((s) => s.id)).size === 6 && bare.scenes.every((s) => /^id\d+$/.test(s.id)));
  ok('English picture searches are kept, on picture scenes', bare.scenes[0].imageQuery === 'modern clinic reception' && bare.scenes[2].imageQuery === 'doctor talking to patient');
  const arr = parsePlan('```json\n' + JSON.stringify(good.scenes) + '\n```', v, newId);
  ok('a bare list of scenes, without the object around it, is read', arr && arr.scenes.length === 6 && arr.title, arr);
  const wrapped = parsePlan(JSON.stringify({ storyboard: good }), v, newId);
  ok('a storyboard wrapped in another object is read', wrapped && wrapped.scenes.length === 6 && wrapped.title === 'Nuri Clinic');
  const example = parsePlan('For example {"kind":"kinetic","text":"x"} — and the plan: ' + goodJson, v, newId);
  ok('an example scene before the plan does not stand in for it', example && example.scenes.length === 6, example);
  const slips = parsePlan('{"title":"A","scenes":[{"kind":"kinetic","text":"line one\nline two","seconds":3,},{"kind":"outro","headline":"B",}],}', v, newId);
  ok('a raw newline and trailing commas are forgiven', slips && slips.scenes.some((s) => s.kind === 'kinetic' && s.text === 'line one line two'), slips);
}
for (const [name, text] of [
  ['nothing', ''], ['prose', 'I cannot make videos, sorry.'], ['not a string', undefined], ['a number', 42],
  ['an object with no scenes', '{"title":"x"}'], ['an empty list of scenes', '{"title":"x","scenes":[]}'],
  ['scenes of unknown kinds only', '{"scenes":[{"kind":"hologram","text":"x"},{"kind":"3d","text":"y"}]}'],
  ['scenes that are not objects', '{"scenes":["a", 1, null, [2]]}'],
  ['broken JSON', '{"title":"x","scenes":[{"kind":"kinetic","text":"a"'],
  ['scenes with nothing to show', '{"scenes":[{"kind":"kinetic","text":""},{"kind":"bullets"},{"kind":"quote","quote":"   "}]}'],
]) ok(`garbage is null: ${name}`, parsePlan(text, video(), newId) === null, parsePlan(text, video(), newId));

// ── repair ────────────────────────────────────────────────────────────────
{
  const v = video();
  const hostile = parsePlan(JSON.stringify({
    title: '<script>alert(1)</script>My <b>video</b>',
    scenes: [
      { kind: 'title', title: '<img src=x onerror=alert(1)>Hello **world**', seconds: 3 },
      { kind: 'kinetic', text: '<script type="text/javascript">steal()</script>Safe words<style>body{}</style>', seconds: 3 },
      { kind: 'bullets', heading: 'Many', points: Array.from({ length: 1000 }, (_, i) => `point ${i}`), seconds: 5 },
      { kind: 'chart', heading: 'Bars', bars: [{ label: 'a', value: 'NaN' }, { label: 'b', value: -4 }, { label: 'c', value: 3 }, { label: 'd', value: '٥٠' }, { label: '', value: 2 }, { label: 'e', value: Infinity }, { label: 'f', value: 1e300 }], seconds: 4 },
      { kind: 'stat', value: 'lots', label: 'Happy customers', seconds: 3 },
      { kind: 'stat', value: '٤٥%', label: 'of visits same day', seconds: 3 },
      { kind: 'image', caption: 'x'.repeat(1000), imageQuery: 'عيادة حديثة', seconds: 3 },
      { kind: 'kinetic', text: 'A picture? No.', imageQuery: 'clinic', picture: { src: 'data:image/png;base64,AAAA', credit: 'me' }, seconds: 3 },
      { kind: 'split', heading: 'H', text: 'T', imageQuery: 'a very long query that goes on and on and on past sixty characters for sure', seconds: 99 },
      { kind: 'outro', headline: 'Bye', url: 'javascript:alert(1)', seconds: 'NaN', transition: 'explode' },
    ],
  }), v, newId);
  const all = texts(hostile);
  ok('a hostile storyboard is still read', hostile && hostile.scenes.length >= 8, hostile);
  ok('no markup survives anywhere', !/[<>]/.test(all), all.match(/.{0,20}[<>].{0,20}/));
  ok('a script\'s contents go with it', !all.includes('alert') && !all.includes('steal()') && !all.includes('body{}'));
  ok('the words around markup stay', hostile.title === 'My video' && hostile.scenes[0].title === 'Hello world' && hostile.scenes[1].text === 'Safe words');
  const bullets = hostile.scenes.find((s) => s.kind === 'bullets');
  ok('a thousand points become five', bullets.points.length === 5);
  const chart = hostile.scenes.find((s) => s.kind === 'chart');
  ok('a chart keeps only bars with a label and a finite value ≥ 0', chart && chart.bars.map((b) => b.label).join() === 'c,d', chart);
  ok('with Arabic-Indic digits read as numbers', chart.bars[1].value === 50);
  const stats = hostile.scenes.filter((s) => s.kind === 'stat');
  ok('a stat with no number becomes words, never a guessed figure', stats.length === 1 && hostile.scenes.some((s) => s.kind === 'kinetic' && s.text === 'Happy customers'));
  ok('a stat given as "٤٥%" is 45 with a % after it', stats[0].value === 45 && stats[0].suffix === '%');
  const image = hostile.scenes.find((s) => s.kind === 'image');
  ok('a caption is capped at a sentence', image && Array.from(image.caption).length <= 220 && image.caption.endsWith('…'));
  ok('a picture search not in English is dropped', image.imageQuery === undefined);
  const kin = hostile.scenes.find((s) => s.kind === 'kinetic' && s.text === 'A picture? No.');
  ok('a picture search on a scene with no picture is dropped', kin && kin.imageQuery === undefined);
  ok('a picture is never taken from the reply', !all.includes('data:image') && hostile.scenes.every((s) => s.picture === undefined));
  const split = hostile.scenes.find((s) => s.kind === 'split');
  ok('a picture search over sixty characters is dropped', split && split.imageQuery === undefined);
  const outro = hostile.scenes[hostile.scenes.length - 1];
  ok('a javascript: url is dropped', outro.kind === 'outro' && outro.url === undefined);
  ok('an unknown transition is the last one\'s none, others fade', outro.transition === 'none');
  ok('every scene lasts 2 to 20 seconds, and a number', hostile.scenes.every((s) => Number.isFinite(s.seconds) && s.seconds >= 2 && s.seconds <= 20));
}
{
  const v = video();
  const r = parsePlan(JSON.stringify({ scenes: [
    { kind: 'text', text: 'Mapped from text', transition: 'teleport' },
    { kind: 'LIST', heading: 'Mapped from list', points: 'one\ntwo' },
    { kind: 'hologram', text: 'dropped' },
    { kind: 'cta', headline: 'Mapped from cta', cta: 'Call us' },
  ] }), v, newId);
  ok('text → kinetic, list → bullets, cta → outro', r && r.scenes.some((s) => s.kind === 'kinetic' && s.text === 'Mapped from text')
    && r.scenes.some((s) => s.kind === 'bullets' && s.points.join() === 'one,two')
    && r.scenes[r.scenes.length - 1].kind === 'outro' && r.scenes[r.scenes.length - 1].headline === 'Mapped from cta', r);
  ok('an unknown kind is dropped', !texts(r).includes('dropped'));
  ok('an unknown transition is fade', r.scenes.find((s) => s.text === 'Mapped from text').transition === 'fade');
  ok('a missing title is written from the plan', r.scenes[0].kind === 'title' && r.scenes[0].title);
}
{
  const v = video({ brand: { name: 'Nuri Clinic' } });
  const r = parsePlan('{"title":"Open late","scenes":[{"kind":"kinetic","text":"Sick at midnight?"},{"kind":"bullets","heading":"We treat","points":["Flu"]}]}', v, newId);
  ok('no title and no outro: both are written', r && r.scenes[0].kind === 'title' && r.scenes[r.scenes.length - 1].kind === 'outro' && r.scenes.length === 4, r);
  ok('the title from the plan\'s title, the outro from the brand', r.scenes[0].title === 'Open late' && r.scenes[3].headline === 'Nuri Clinic');
  const moved = parsePlan('{"title":"T","scenes":[{"kind":"outro","headline":"Bye"},{"kind":"kinetic","text":"Middle"},{"kind":"title","title":"Hook"}]}', video(), newId);
  ok('a title and an outro the model put elsewhere are moved, not duplicated',
    moved && moved.scenes.map((s) => s.kind).join() === 'title,kinetic,outro' && moved.scenes[0].title === 'Hook', moved);
  const untitled = parsePlan('{"scenes":[{"kind":"title","title":"The hook"},{"kind":"outro","headline":"Bye"}]}', video(), newId);
  ok('no title in the plan: the title scene\'s', untitled && untitled.title === 'The hook');
  const lone = parsePlan('{"scenes":[{"kind":"outro","headline":"Only"}]}', video(), newId);
  ok('a lone outro gets a title before it', lone && lone.scenes.length === 2 && lone.scenes[0].kind === 'title' && lone.scenes[1].headline === 'Only');
}
{
  const many = { title: 'Many', scenes: Array.from({ length: 1000 }, (_, i) => ({ kind: 'kinetic', text: `Scene ${i}`, seconds: 3 })) };
  const r = parsePlan(JSON.stringify(many), video({ seconds: 30 }), newId);
  ok('a thousand scenes are cut to what the length holds', r && r.scenes.length <= 12 && r.scenes.length >= 4, r && r.scenes.length);
  ok('keeping the opening and a close', r.scenes[0].kind === 'title' && r.scenes[r.scenes.length - 1].kind === 'outro');
}
{
  // Letters in their language's own spelling.
  const ku = parsePlan(JSON.stringify({ title: 'كلينيك', scenes: [
    { kind: 'title', title: 'نەخۆشخانەي ئێمە' }, { kind: 'kinetic', text: 'هەموو ڕۆژێك كراوەیە' }, { kind: 'outro', headline: 'سوپاس' },
  ] }), video({ lang: 'ckb' }), newId);
  ok('Kurdish written with Arabic ي and ك is put in Kurdish letters', ku && !/[\u064A\u0643\u0649]/.test(texts(ku)) && ku.scenes[1].text === 'هەموو ڕۆژێک کراوەیە', ku);
  const ar = parsePlan(JSON.stringify({ title: 'عیادتنا', scenes: [{ kind: 'title', title: 'رعایة کاملة' }, { kind: 'outro', headline: 'شکراً' }] }), video({ lang: 'ar' }), newId);
  ok('Arabic written with Kurdish ی and ک is put in Arabic letters', ar && !/[\u06CC\u06A9]/.test(texts(ar)) && ar.scenes[0].title === 'رعاية كاملة', ar);
  const en = parsePlan(JSON.stringify({ scenes: [{ kind: 'title', title: 'Nuri — نوری' }] }), video({ lang: 'en' }), newId);
  ok('an English video\'s Arabic-script words are left alone', en && en.scenes[0].title === 'Nuri — نوری');
  const bidi = parsePlan(JSON.stringify({ scenes: [{ kind: 'title', title: 'a\u202Eevil\u202C b\u200Bc' }, { kind: 'kinetic', text: 'می\u200Cخواهم' }] }), video({ lang: 'ckb' }), newId);
  ok('bidi overrides and zero-width spaces are removed', bidi && bidi.scenes[0].title === 'aevil bc');
  ok('but the zero-width non-joiner Kurdish spelling uses is kept', bidi.scenes[1].text.includes('\u200C'));
  const long = parsePlan(JSON.stringify({ scenes: [{ kind: 'title', title: 'word '.repeat(60) }] }), video(), newId);
  ok('a headline is capped at 90 characters, at a word\'s end', long && Array.from(long.scenes[0].title).length <= 90 && /word…$/.test(long.scenes[0].title), long.scenes[0].title);
}

// ── scaling to the length asked for ───────────────────────────────────────
for (const seconds of [20, 30, 45, 60, 90]) {
  const r = parsePlan(goodJson, video({ seconds }), newId);
  const scenes = r.scenes;
  const total = playSeconds(scenes);
  const feasible = scenes.length * 20 - 0.5 * (scenes.length - 1) >= seconds;
  if (feasible) ok(`a ${seconds}-second request plays for about ${seconds} seconds`, Math.abs(total - seconds) <= 1, total);
  else ok(`a ${seconds}-second request with too few scenes plays as long as they may`, scenes.every((s) => s.seconds === 20));
}
{
  // Six scenes of about eight words each take some 17 seconds to read: asked
  // for 15, they run that long rather than flash past.
  const short = parsePlan(goodJson, video({ seconds: 15 }), newId);
  ok('six wordy scenes asked to fit 15 seconds run a little long, never unreadably short',
    playSeconds(short.scenes) > 15 && playSeconds(short.scenes) < 19, playSeconds(short.scenes));
}
{
  const r = parsePlan(goodJson, video({ seconds: 30 }), newId);
  const src = good.scenes.map((s) => s.seconds);
  const got = r.scenes.map((s) => s.seconds);
  ok('the model\'s rhythm survives: a longer scene stays longer', got[3] > got[0] && got[4] > got[1], { src, got });
  const tight = parsePlan(JSON.stringify({ scenes: [
    { kind: 'title', title: 'One two three four five six seven', seconds: 3 },
    { kind: 'kinetic', text: 'This sentence has exactly twelve words in it so that it takes time', seconds: 3 },
    { kind: 'bullets', heading: 'Five points', points: ['one two three four', 'five six seven eight', 'nine ten eleven twelve', 'a b c d', 'e f g h'], seconds: 3 },
    { kind: 'outro', headline: 'Thanks for watching', cta: 'Visit us today', seconds: 3 },
  ] }), video({ seconds: 5 }), newId);
  const readable = (s) => s.seconds >= Math.min(20, (texts(s).split(/\s+/).length) / 3);
  ok('a length too short to read in: every scene stays readable and the video runs long',
    tight && tight.scenes[1].seconds >= 4.5 && tight.scenes[2].seconds >= 7 && playSeconds(tight.scenes) > 5 && tight.scenes.every(readable), tight && tight.scenes.map((s) => s.seconds));
  ok('seconds are tenths', r.scenes.every((s) => Math.abs(s.seconds * 10 - Math.round(s.seconds * 10)) < 1e-9));
  const noSecs = parsePlan('{"scenes":[{"kind":"title","title":"Hi"},{"kind":"kinetic","text":"Hello there"},{"kind":"outro","headline":"Bye"}]}', video({ seconds: 15 }), newId);
  ok('scenes with no seconds get some, and the whole still fits the length', noSecs && Math.abs(playSeconds(noSecs.scenes) - 15) <= 1, noSecs && noSecs.scenes.map((s) => s.seconds));
  const huge = parsePlan('{"scenes":[{"kind":"title","title":"Hi","seconds":1e9},{"kind":"outro","headline":"Bye","seconds":-5}]}', video({ seconds: 10 }), newId);
  ok('absurd seconds are held to 2..20 and then fitted', huge && huge.scenes.every((s) => s.seconds >= 2 && s.seconds <= 20) && Math.abs(playSeconds(huge.scenes) - 10) <= 1, huge && huge.scenes);
}

// ── sanitizeScene on its own ──────────────────────────────────────────────
{
  const v = video();
  ok('not an object is null', [null, undefined, 'x', 3, [], true].every((x) => sanitizeScene(x, v, newId) === null));
  ok('no kind is null', sanitizeScene({ text: 'x' }, v, newId) === null);
  ok('"type" is read as the kind', sanitizeScene({ type: 'kinetic', text: 'x' }, v, newId)?.kind === 'kinetic');
  ok('a chart with one bar becomes its heading as words', sanitizeScene({ kind: 'chart', heading: 'Growth', bars: [{ label: 'a', value: 1 }] }, v, newId)?.kind === 'kinetic');
  ok('steps need two', sanitizeScene({ kind: 'steps', heading: 'How', steps: ['Only'] }, v, newId)?.kind === 'kinetic');
  ok('five steps at most', sanitizeScene({ kind: 'steps', heading: 'How', steps: ['1', '2', '3', '4', '5', '6', '7'] }, v, newId)?.steps.length === 5);
  ok('an image with neither caption nor search is null', sanitizeScene({ kind: 'image' }, v, newId) === null);
  ok('an image with only a search is kept', sanitizeScene({ kind: 'image', imageQuery: 'sunset beach' }, v, newId)?.imageQuery === 'sunset beach');
  const q = sanitizeScene({ kind: 'quote', quote: 'Be kind.', author: 'Anonymous' }, v, newId);
  ok('a quote keeps its author', q?.quote === 'Be kind.' && q.author === 'Anonymous');
  const o = sanitizeScene({ kind: 'outro', cta: 'Call now' }, v, newId);
  ok('an outro with only an action shows the action', o?.headline === 'Call now' && o.cta === undefined);
  ok('a website with a path is kept, one with spaces is not',
    sanitizeScene({ kind: 'outro', headline: 'x', url: 'https://nuri.iq/book' }, v, newId)?.url === 'https://nuri.iq/book'
    && sanitizeScene({ kind: 'outro', headline: 'x', url: 'nuri clinic dot com' }, v, newId)?.url === undefined);
  ok('a stat\'s prefix and suffix are short', (() => {
    const s = sanitizeScene({ kind: 'stat', value: 3, prefix: 'x'.repeat(50), suffix: 'k', label: 'branches' }, v, newId);
    return s && Array.from(s.prefix).length <= 8 && s.suffix === 'k';
  })());
  ok('a number as a string with commas', sanitizeScene({ kind: 'stat', value: '12,500', label: 'visits' }, v, newId)?.value === 12500);
  ok('the id is always a fresh one', sanitizeScene({ kind: 'kinetic', text: 'x', id: 'evil' }, v, newId)?.id !== 'evil');
}

// ── redoing one scene ─────────────────────────────────────────────────────
{
  const v = video();
  const plan = parsePlan(goodJson, v, newId);
  const vv = { ...v, scenes: plan.scenes };
  vv.scenes[2] = { ...vv.scenes[2], picture: { src: 'data:image/jpeg;base64,AAAA', credit: 'c', source: 's', query: 'doctor talking to patient' } };
  const p = scenePrompt(vv, 2, 'make it about the night shift');
  ok('the redo prompt names the scene and carries the instruction', p.user.includes('Rewrite scene 3 only') && p.user.includes('make it about the night shift'));
  ok('and the whole storyboard, without pictures or ids', p.user.includes('Real doctors') && !p.user.includes('data:image') && !p.user.includes(`"id"`));
  ok('with the same rules as the plan', p.system === planPrompt(vv).system);
  ok('the first scene is told it is the hook, the last the close',
    /opening hook/.test(scenePrompt(vv, 0, '').user) && /the close/.test(scenePrompt(vv, vv.scenes.length - 1, '').user));
  ok('no instruction: make it better', /no instruction/.test(scenePrompt(vv, 1, '').user));
  ok('an index out of range is the nearest scene', scenePrompt(vv, 99, '').user.includes(`Rewrite scene ${vv.scenes.length} only`));

  const old = vv.scenes[2];
  const same = parseScene('```json\n{"kind":"split","heading":"Doctors all night","text":"A physician on duty until morning.","seconds":4,"transition":"slide"}\n```', old, vv, newId);
  ok('a redone scene is read', same && same.kind === 'split' && same.heading === 'Doctors all night');
  ok('it keeps the old scene\'s id — the same place in the storyboard', same.id === old.id);
  ok('and its picture, when it asked for no other', same.picture && same.picture.src === old.picture.src && same.imageQuery === old.imageQuery);
  const other = parseScene('{"kind":"split","heading":"Night","text":"On duty.","imageQuery":"night hospital corridor"}', old, vv, newId);
  ok('a new picture search drops the old picture, to be fetched again', other && other.picture === undefined && other.imageQuery === 'night hospital corridor');
  const kinetic = parseScene('{"scene":{"kind":"kinetic","text":"We never close."}}', old, vv, newId);
  ok('a scene wrapped in {"scene": …} is read, and a kind with no picture drops it', kinetic && kinetic.kind === 'kinetic' && kinetic.picture === undefined);
  ok('no seconds given: the old scene\'s', kinetic.seconds === old.seconds);
  ok('no transition given: the old scene\'s', kinetic.transition === old.transition);
  const last = vv.scenes[vv.scenes.length - 1];
  const close = parseScene('{"kind":"outro","headline":"See you","transition":"zoom"}', last, vv, newId);
  ok('the last scene still hands over to nothing', close && close.transition === 'none');
  const wordy = parseScene('{"kind":"kinetic","text":"one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen","seconds":2}', vv.scenes[1], vv, newId);
  ok('a redone scene is held to the time its words take to read', wordy && wordy.seconds >= 5, wordy && wordy.seconds);
  ok('garbage is null', parseScene('no', old, vv, newId) === null && parseScene('{"kind":"nope"}', old, vv, newId) === null && parseScene(undefined, old, vv, newId) === null);
  const hostile = parseScene('{"kind":"kinetic","text":"<script>x()</script>Hi","seconds":"NaN"}', vv.scenes[1], vv, newId);
  ok('a redone scene is repaired like a planned one', hostile && hostile.text === 'Hi' && Number.isFinite(hostile.seconds));
}

// ── a scene added by hand ─────────────────────────────────────────────────
for (const lang of LANGS) {
  const v = video({ lang });
  const scenes = KINDS.map((k) => blankScene(k, v, newId));
  ok(`${lang}: every kind has a blank of that kind`, scenes.every((s, i) => s.kind === KINDS[i]), scenes.map((s) => s.kind));
  ok(`${lang}: blanks survive their own repair unchanged in kind`, scenes.every((s) => sanitizeScene(s, v, newId)?.kind === s.kind));
  ok(`${lang}: blanks have words, a fresh id, readable seconds and fade`,
    scenes.every((s) => s.id && s.seconds >= 3 && s.seconds <= 20 && s.transition === 'fade' && texts(s).length > 60));
  ok(`${lang}: fresh ids`, new Set(scenes.map((s) => s.id)).size === KINDS.length);
  const words = scenes.map(texts).join(' ');
  if (lang === 'en') ok('en: English placeholders', /[A-Za-z]/.test(words) && !/[\u0600-\u06FF]/.test(words));
  if (lang === 'ar') ok('ar: Arabic placeholders, in Arabic letters', /[\u0600-\u06FF]/.test(words) && !/[\u06CC\u06A9\u06D5]/.test(words));
  if (lang === 'ckb' || lang === 'kmr') ok(`${lang}: Kurdish placeholders, in Kurdish letters`, /[\u06D5\u06CE]/.test(words) && !/[\u064A\u0643\u0629]/.test(words));
}
ok('Badini and Sorani placeholders differ', texts(blankScene('title', video({ lang: 'ckb' }), newId)) !== texts(blankScene('title', video({ lang: 'kmr' }), newId)));
ok('Badini placeholders use ڤ, as Badini does', KINDS.map((k) => texts(blankScene(k, video({ lang: 'kmr' }), newId))).join().includes('ڤ'));
{
  const v = video({ brand: { name: 'Nuri Clinic' } });
  ok('a blank title and outro carry the brand', blankScene('title', v, newId).title === 'Nuri Clinic' && blankScene('outro', v, newId).headline === 'Nuri Clinic');
  ok('a blank chart has bars, a blank stat a number', blankScene('chart', v, newId).bars.length >= 2 && Number.isFinite(blankScene('stat', v, newId).value));
  ok('an unknown kind is kinetic rather than a crash', blankScene('hologram', v, newId).kind === 'kinetic');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
