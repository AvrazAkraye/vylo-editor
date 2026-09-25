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
  pictureJobs, pictureSlots, picturesOf, planPrompt, qrModules, qrPath, qrText, sanitizeScene, sceneFrames, scenePrompt,
  secondsIn, styleIn, videoLangOf, withPicture,
} from '../.test-build/video.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const FPS = 30;
const KINDS = ['title', 'kinetic', 'bullets', 'stat', 'chart', 'quote', 'image', 'split', 'steps', 'outro'];
/** Round 2's kinds: a montage, dates, two sides, real people, the logo, a QR code. */
const NEW_KINDS = ['gallery', 'timeline', 'compare', 'people', 'logo', 'qr'];
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
  ok('every kind\'s shape is described', [...KINDS, ...NEW_KINDS].every((k) => p.user.includes(`"kind":"${k}"`)));
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

// ── round 2: six more kinds ───────────────────────────────────────────────
{
  const p = planPrompt(video());
  ok('a timeline only with dates given, people only with names given, a QR only for a website given',
    /timeline[^\n]*ONLY with dates the request or the facts give/.test(p.user)
    && /people[^\n]*ONLY names the request or the facts give/.test(p.user)
    && /qr[^\n]*ONLY for a website the request, the brand or the facts give/.test(p.user));
  ok('the rules say it too', /A "people" scene names only people the request names/.test(p.system) && /make no "qr" scene/.test(p.system));
  ok('a gallery has its own English searches', /a "gallery" has its own "imageQueries"/.test(p.user));
  ok('a brand with a logo is told a logo scene reveals it; one without is not',
    /"logo" scene reveals it/.test(planPrompt(video({ brand: { name: 'Nuri', logo: 'data:image/png;base64,AAAA' } })).user)
    && !/"logo" scene reveals it/.test(planPrompt(video({ brand: { name: 'Nuri' } })).user));
  ok('the logo itself never reaches the prompt', !planPrompt(video({ brand: { name: 'Nuri', logo: 'data:image/png;base64,SECRETLOGO' } })).user.includes('SECRETLOGO'));
}
{
  const v = video();
  const kindOf = (x) => sanitizeScene(x, v, newId)?.kind;
  ok('team → people, history → timeline, versus and vs → compare',
    kindOf({ kind: 'team', heading: 'H', people: [{ name: 'Ana' }] }) === 'people'
    && kindOf({ kind: 'history', heading: 'H', events: [{ when: '1992', text: 'a' }, { when: '2000', text: 'b' }] }) === 'timeline'
    && kindOf({ kind: 'versus', heading: 'H', left: { title: 'A' }, right: { title: 'B' } }) === 'compare'
    && kindOf({ kind: 'vs', heading: 'H', left: { title: 'A' }, right: { title: 'B' } }) === 'compare');
  ok('montage and collage → gallery, brand → logo, qr-code → qr',
    kindOf({ kind: 'montage', imageQueries: ['a beach', 'a road'] }) === 'gallery'
    && kindOf({ kind: 'collage', imageQueries: ['a beach', 'a road'] }) === 'gallery'
    && kindOf({ kind: 'brand', tagline: 'x' }) === 'logo'
    && kindOf({ kind: 'qr-code', heading: 'Scan', url: 'https://example.org' }) === undefined // not a site the person gave
    && sanitizeScene({ kind: 'qr-code', heading: 'Scan', url: 'nuri.iq' }, video({ request: 'promo, site nuri.iq' }), newId)?.kind === 'qr');
  ok('a timeline is its own kind now, not steps', kindOf({ kind: 'timeline', heading: 'H', events: [{ when: '1', text: 'a' }, { when: '2', text: 'b' }] }) === 'timeline');
}
{
  // gallery
  const v = video();
  const g = sanitizeScene({ kind: 'gallery', heading: 'Campus <b>life</b>', imageQueries: ['university library', 'students on lawn', 'lecture hall', 'campus at night', 'graduation', 'lab'], pictures: [{ src: 'data:image/png;base64,AAAA' }] }, v, newId);
  ok('a gallery keeps four searches at most, its heading cleaned', g?.kind === 'gallery' && g.imageQueries.length === 4 && g.heading === 'Campus life', g);
  ok('a gallery never takes pictures from the reply', g && g.pictures === undefined && !texts(g).includes('data:'));
  const mixed = sanitizeScene({ kind: 'gallery', imageQueries: ['مكتبة', 'library', 'LIBRARY', 'x'.repeat(80), { query: 'lawn with trees' }] }, v, newId);
  ok('only short English searches, once each, objects read', mixed?.kind === 'gallery' && mixed.imageQueries.join('|') === 'library|lawn with trees' && mixed.heading === undefined, mixed);
  const one = sanitizeScene({ kind: 'gallery', heading: 'Our lab', imageQueries: ['science lab'] }, v, newId);
  ok('one picture is an image scene with the heading as its caption', one?.kind === 'image' && one.imageQuery === 'science lab' && one.caption === 'Our lab', one);
  ok('no pictures is the heading in words, or nothing',
    sanitizeScene({ kind: 'gallery', heading: 'Moments' }, v, newId)?.kind === 'kinetic' && sanitizeScene({ kind: 'gallery' }, v, newId) === null);
  ok('a string of searches is a list', sanitizeScene({ kind: 'gallery', imageQueries: 'beach; mountain road' }, v, newId)?.imageQueries?.length === 2);
}
{
  // timeline
  const v = video({ lang: 'ar' });
  const tl = sanitizeScene({ kind: 'timeline', heading: 'مسيرتنا', events: [
    { when: '1992', text: 'تأسست الجامعة' }, { date: '2004', event: 'كلية الطب' }, { year: 2010, text: '<i>حرم جديد</i>' },
    { when: '', text: 'no date' }, { when: '2015', text: '' }, '2018 — مركز البحوث', { when: '2020', text: 'x' }, { when: '2021', text: 'y' }, { when: '2022', text: 'z' },
  ] }, v, newId);
  ok('a timeline keeps events with a date and words, five at most', tl?.kind === 'timeline' && tl.events.length === 5, tl);
  ok('dates and words read from their other names, markup stripped', tl.events[1].when === '2004' && tl.events[1].text === 'كلية الطب' && tl.events[2].when === '2010' && tl.events[2].text === 'حرم جديد');
  ok('"2018 — words" is a date and what happened', tl.events[3].when === '2018' && tl.events[3].text === 'مركز البحوث', tl.events[3]);
  ok('a date is short', Array.from(sanitizeScene({ kind: 'timeline', heading: 'h', events: [{ when: 'x'.repeat(100), text: 'a' }, { when: '1', text: 'b' }] }, v, newId).events[0].when).length <= 24);
  const lone = sanitizeScene({ kind: 'timeline', heading: 'Since', events: [{ when: '1992', text: 'Founded' }] }, video(), newId);
  ok('one event is words, not a timeline', lone?.kind === 'kinetic' && lone.text.includes('1992') && lone.text.includes('Founded'), lone);
}
{
  // compare
  const v = video();
  const c = sanitizeScene({ kind: 'compare', heading: 'Then and now', left: { title: 'Paper', points: ['Queues', 'Lost forms', 'Calls', 'Waiting', 'More'] }, right: { title: 'The app', points: 'Book in a minute\nReminders' } }, v, newId);
  ok('a comparison keeps both sides, four points a side', c?.kind === 'compare' && c.left.title === 'Paper' && c.left.points.length === 4 && c.right.points.join() === 'Book in a minute,Reminders', c);
  const cols = sanitizeScene({ kind: 'compare', heading: 'H', sides: [{ name: 'A', items: ['a1'] }, { label: 'B', bullets: ['b1'] }] }, v, newId);
  ok('sides given as a list are left and right', cols?.kind === 'compare' && cols.left.title === 'A' && cols.right.title === 'B' && cols.right.points[0] === 'b1', cols);
  const ab = sanitizeScene({ kind: 'compare', heading: 'H', before: 'Slow', after: 'Fast' }, v, newId);
  ok('before and after read as the two sides, titles only', ab?.kind === 'compare' && ab.left.title === 'Slow' && ab.right.title === 'Fast' && ab.left.points.length === 0);
  const half = sanitizeScene({ kind: 'compare', heading: 'Why us', right: { title: 'Us', points: ['Fast', 'Kind'] } }, v, newId);
  ok('one side alone is a list of its points', half?.kind === 'bullets' && half.heading === 'Why us' && half.points.join() === 'Fast,Kind', half);
  ok('a side title is short', Array.from(sanitizeScene({ kind: 'compare', heading: 'h', left: { title: 'x'.repeat(200) }, right: { title: 'y' } }, v, newId).left.title).length <= 40);
}
{
  // people
  const v = video({ lang: 'ckb' });
  const pp = sanitizeScene({ kind: 'people', heading: 'سەرۆکایەتی', people: [
    { name: 'د. ئەحمەد', role: 'سەرۆکی زان\u0643ۆ', imageQuery: 'Ahmed Rashid portrait', picture: { src: 'data:image/jpeg;base64,AAAA' } },
    { name: 'د. ئەحمەد', role: 'duplicate' }, { role: 'no name' }, 'سارا', { name: '<b>ژیان</b>', position: 'ڕاگر', imageQuery: 'ژیان' },
    { name: 'a' }, { name: 'b' }, { name: 'c' },
  ] }, v, newId);
  ok('people: four at most, each once, a name needed', pp?.kind === 'people' && pp.people.length === 4 && pp.people.map((x) => x.name).slice(0, 3).join('|') === 'د. ئەحمەد|سارا|ژیان', pp);
  ok('a role in Kurdish letters, read from "position" too', pp.people[0].role === 'سەرۆکی زان\u06A9ۆ' && pp.people[2].role === 'ڕاگر');
  ok('a portrait search is kept only in Latin letters', pp.people[0].imageQuery === 'Ahmed Rashid portrait' && pp.people[2].imageQuery === undefined);
  ok('a portrait is never taken from the reply', pp.people.every((x) => x.picture === undefined) && !texts(pp).includes('data:'));
  ok('no named person: the heading in words', sanitizeScene({ kind: 'people', heading: 'Our team', people: [{ role: 'x' }] }, v, newId)?.kind === 'kinetic');
}
{
  // logo and qr
  const v = video({ request: 'a promo for Nuri Clinic, visit www.nuri.iq/book today', brand: { name: 'Nuri' } });
  const lg = sanitizeScene({ kind: 'logo', tagline: 'Care, <em>always</em>' }, v, newId);
  ok('a logo scene keeps its line, cleaned', lg?.kind === 'logo' && lg.tagline === 'Care, always');
  ok('a logo scene needs no line', sanitizeScene({ kind: 'logo' }, v, newId)?.kind === 'logo');
  const qr = sanitizeScene({ kind: 'qr', heading: 'Book online', url: 'https://nuri.iq/book' }, v, newId);
  ok('a QR code for the website the request gave', qr?.kind === 'qr' && qr.url === 'https://nuri.iq/book' && qr.heading === 'Book online');
  ok('a QR code stays up long enough to scan', qr.seconds >= 5, qr.seconds);
  ok('a QR code for a website nobody gave is dropped', sanitizeScene({ kind: 'qr', heading: 'Scan', url: 'nuriclinic.com' }, v, newId) === null);
  ok('a QR code for javascript:, or with no address, is dropped',
    sanitizeScene({ kind: 'qr', heading: 'x', url: 'javascript:alert(1)' }, v, newId) === null && sanitizeScene({ kind: 'qr', heading: 'x' }, v, newId) === null);
  const briefed = video({ brief: { subjects: ['University of Duhok'], facts: [
    { label: 'Official website', value: 'https://uod.ac', source: 'Wikidata', url: 'https://www.wikidata.org/wiki/Q1', use: true },
    { label: 'Other site', value: 'uod-old.org', source: 'Wikidata', url: 'https://www.wikidata.org/wiki/Q1', use: false },
  ], pictures: [], at: 1 } });
  ok('a website from the facts found about the subject is one the person has', sanitizeScene({ kind: 'qr', heading: 'x', url: 'uod.ac' }, briefed, newId)?.kind === 'qr');
  ok('but not from a fact the person switched off', sanitizeScene({ kind: 'qr', heading: 'x', url: 'uod-old.org' }, briefed, newId) === null);
  ok('the brief\'s own website counts', sanitizeScene({ kind: 'qr', heading: 'x', url: 'https://www.duhok.example/x' }, video({ brief: { subjects: [], facts: [], pictures: [], website: 'https://duhok.example', at: 1 } }), newId)?.kind === 'qr');
}
{
  // narration survives the plan and the redo
  const v = video();
  const plan = parsePlan(JSON.stringify({ title: 'T', scenes: [
    { kind: 'title', title: 'Hook', narration: 'Have you ever <b>waited</b> all night?' },
    { kind: 'timeline', heading: 'Since', events: [{ when: '1992', text: 'a' }, { when: '2000', text: 'b' }], narration: 'It began in 1992.' },
    { kind: 'outro', headline: 'Bye', voiceover: 'Book today.' },
  ] }), v, newId);
  ok('narration is kept on every kind, cleaned, from "voiceover" too',
    plan && plan.scenes[0].narration === 'Have you ever waited all night?' && plan.scenes[1].narration === 'It began in 1992.' && plan.scenes[2].narration === 'Book today.', plan && plan.scenes);
  const vv = { ...v, scenes: plan.scenes };
  const redone = parseScene('{"kind":"people","heading":"Who","people":[{"name":"Ana","role":"Dean"}],"narration":"Meet Ana, our dean."}', vv.scenes[1], vv, newId);
  ok('a redone scene keeps the narration it was given', redone?.kind === 'people' && redone.narration === 'Meet Ana, our dean.');
}
{
  // pictures in a scene: slots, putting one in, taking one out, redo keeping them
  const pic = (q, n = 1) => ({ src: `data:image/jpeg;base64,P${n}`, credit: `c${n}`, source: `s${n}`, query: q });
  const g = { id: 'g', kind: 'gallery', seconds: 4, transition: 'fade', heading: 'H', imageQueries: ['beach', 'road', 'city'] };
  ok('an empty gallery wants each of its searches', pictureSlots(g).map((s) => s.key).join() === 'q:beach,q:road,q:city');
  let g2 = withPicture(g, 'q:road', pic('road', 1));
  ok('a found tile joins the montage, and its search is no longer wanted', g2.pictures.length === 1 && pictureSlots(g2).map((s) => s.key).join() === 'g0,q:beach,q:city' && g !== g2 && g.pictures === undefined);
  g2 = withPicture(withPicture(g2, 'q:beach', pic('beach', 2)), 'q:city', pic('city', 3));
  ok('three tiles, nothing more wanted', g2.pictures.length === 3 && pictureJobs([g2]).length === 0 && picturesOf(g2).length === 3);
  const g3 = withPicture(g2, 'g1', undefined);
  ok('a tile taken out takes its search with it', g3.pictures.length === 2 && !g3.imageQueries.includes('beach') && pictureJobs([g3]).length === 0, g3);
  const g4 = withPicture(g3, 'g0', pic('harbour', 4));
  ok('a tile replaced by hand remembers the new search instead of the old', g4.pictures[0].query === 'harbour' && g4.imageQueries.includes('harbour') && !g4.imageQueries.includes('road'), g4.imageQueries);
  const g5 = withPicture(withPicture(g4, 'new', pic('lake', 5)), 'new', pic('hill', 6));
  ok('four tiles at most', g5.pictures.length === 4 && withPicture(g5, 'new', pic('more', 7)) === g5);
  ok('a tile still to be found, taken out, is not searched for', pictureJobs([withPicture(g, 'q:road', undefined)]).map((j) => j.query).join() === 'beach,city');
  const people = { id: 'p', kind: 'people', seconds: 4, transition: 'fade', heading: 'H', people: [{ name: 'Ana', imageQuery: 'Ana Smith' }, { name: 'Bo' }] };
  ok('a person with a search wants a portrait; one without, none', pictureJobs([people]).map((j) => `${j.sceneId}/${j.key}/${j.query}`).join() === 'p/p0/Ana Smith');
  const withAna = withPicture(people, 'p0', pic('Ana Smith', 8));
  ok('a portrait goes to its person', withAna.people[0].picture.src.endsWith('P8') && withAna.people[1].picture === undefined && pictureJobs([withAna]).length === 0);
  const noAna = withPicture(withAna, 'p0', undefined);
  ok('a portrait taken out is not fetched again', noAna.people[0].picture === undefined && noAna.people[0].imageQuery === undefined && pictureJobs([noAna]).length === 0);
  const title = { id: 't', kind: 'title', seconds: 3, transition: 'fade', title: 'x', imageQuery: 'sunrise' };
  ok('a title\'s one picture is its main slot', pictureJobs([title])[0].key === 'main' && withPicture(title, 'main', pic('sunrise', 9)).picture.src.endsWith('P9'));
  ok('a kind with no picture has no slots, and an unknown key changes nothing',
    pictureSlots({ id: 'k', kind: 'kinetic', text: 'x', seconds: 3, transition: 'fade' }).length === 0 && withPicture(people, 'p9', pic('x')) === people && withPicture(g, 'g5', pic('x')) === g);

  // The redo prompt carries no pictures, and the redone scene keeps the ones it still asks for.
  const v = video();
  const vv = { ...v, scenes: [{ id: 't0', kind: 'title', title: 'Hook', seconds: 3, transition: 'fade' }, { ...g2, id: 'g1' }, { ...withAna, id: 'p1' }, { id: 'o', kind: 'outro', headline: 'Bye', seconds: 3, transition: 'none' }] };
  const prompt = scenePrompt(vv, 1, '');
  ok('no gallery tile or portrait is sent back to the model', !prompt.user.includes('data:image') && prompt.user.includes('"imageQueries"') && prompt.user.includes('Ana Smith'));
  const again = parseScene('{"kind":"gallery","heading":"New","imageQueries":["road","beach","forest"]}', vv.scenes[1], vv, newId);
  ok('a redone gallery keeps the tiles it still asks for', again?.kind === 'gallery' && again.pictures.map((p) => p.query).join() === 'road,beach' && pictureJobs([again]).map((j) => j.query).join() === 'forest', again);
  const peopleAgain = parseScene('{"kind":"people","heading":"Team","people":[{"name":"Ana","role":"Dean"},{"name":"Cy"}]}', vv.scenes[2], vv, newId);
  ok('a redone people scene keeps each portrait by name', peopleAgain?.people[0].picture?.src.endsWith('P8') && peopleAgain.people[1].picture === undefined, peopleAgain);
}
// ── a scene of a new kind added by hand ───────────────────────────────────
for (const lang of LANGS) {
  const v = video({ lang, request: 'a video for nuri.iq', brand: { name: 'Nuri' } });
  const scenes = NEW_KINDS.map((k) => blankScene(k, v, newId));
  ok(`${lang}: every new kind has a blank of that kind`, scenes.every((s, i) => s.kind === NEW_KINDS[i]), scenes.map((s) => s.kind));
  ok(`${lang}: new blanks have readable seconds and fresh ids`, scenes.every((s) => s.seconds >= 3 && s.seconds <= 20) && new Set(scenes.map((s) => s.id)).size === NEW_KINDS.length);
  const byKind = Object.fromEntries(scenes.map((s) => [s.kind, s]));
  ok(`${lang}: a blank timeline has events, a comparison two sides, a people scene people`,
    byKind.timeline.events.length >= 2 && byKind.compare.left.points.length && byKind.compare.right.title && byKind.people.people.length >= 1);
  ok(`${lang}: a blank QR code opens the site the request gave, and stays up to be scanned`, byKind.qr.url === 'nuri.iq' && byKind.qr.seconds >= 5, byKind.qr);
  ok(`${lang}: the blanks with words survive their own repair`, ['timeline', 'compare', 'people', 'logo', 'qr'].every((k) => sanitizeScene(byKind[k], v, newId)?.kind === k));
  const words = scenes.map(texts).join(' ');
  if (lang === 'ar') ok('ar: new placeholders in Arabic letters', /[\u0600-\u06FF]/.test(words) && !/[\u06CC\u06A9\u06D5]/.test(words));
  if (lang === 'ckb' || lang === 'kmr') ok(`${lang}: new placeholders in Kurdish letters`, /[\u06D5\u06CE]/.test(words) && !/[\u064A\u0643\u0629]/.test(words));
  if (lang === 'en') ok('en: new placeholders in English', !/[\u0600-\u06FF]/.test(words));
}
ok('a blank QR code for a video with no website has an empty address to fill in', blankScene('qr', video(), newId).url === '');
ok('a blank QR code takes the brief\'s website first', blankScene('qr', video({ brief: { subjects: [], facts: [], pictures: [], website: 'https://uod.ac', at: 1 } }), newId).url === 'https://uod.ac');

// ── the QR code ───────────────────────────────────────────────────────────
ok('an address without a scheme opens as https', qrText('uod.ac') === 'https://uod.ac/' && qrText('www.nuri.iq/book?x=1') === 'https://www.nuri.iq/book?x=1');
ok('http stays http', qrText('http://example.org') === 'http://example.org/');
ok('only web addresses: no javascript:, mailto:, ftp:, spaces or bare words',
  [ 'javascript:alert(1)', 'mailto:a@b.c', 'ftp://x.org', 'nuri clinic', 'localhost', '', undefined, 42, 'https://user:pw@x.org' ].every((x) => qrText(x) === null));
ok('an Arabic-script host is carried as punycode, every byte ASCII', /^https:\/\/xn--[a-z0-9-]+\.[a-z]+\/$/.test(qrText('جامعة.com') ?? ''), qrText('جامعة.com'));
{
  const m = qrModules('https://uod.ac/');
  ok('a short address is a version 2 code at level M (25 × 25)', m && m.size === 25 && m.level === 'M' && m.dark.length === 25 && m.dark.every((r) => r.length === 25), m && m.size);
  const finder = (r0, c0) => {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
      const ring = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      if (m.dark[r0 + r][c0 + c] !== (ring || core)) return false;
    }
    return true;
  };
  ok('finder patterns in three corners', finder(0, 0) && finder(0, m.size - 7) && finder(m.size - 7, 0));
  ok('timing patterns alternate', Array.from({ length: m.size - 16 }, (_, i) => i + 8).every((i) => m.dark[6][i] === (i % 2 === 0) && m.dark[i][6] === (i % 2 === 0)));
  ok('the dark module is dark', m.dark[m.size - 8][8] === true);
  ok('the same address is the same code', JSON.stringify(qrModules('uod.ac').dark) === JSON.stringify(m.dark));
  const h = qrModules('https://uod.ac/', true);
  ok('with a logo over it, level H and a larger code', h.level === 'H' && h.size > m.size);
  ok('an address too long for any code is no code', qrModules('https://x.org/' + 'a'.repeat(3000)) === null && qrModules('not a url') === null);
  const path = qrPath(m);
  const dark = m.dark.flat().filter(Boolean).length;
  const cells = [...path.matchAll(/M\d+ \d+h(\d+)v1h-\d+z/g)].reduce((a, x) => a + Number(x[1]), 0);
  ok('the path draws exactly the dark modules, in runs', /^(M\d+ \d+h\d+v1h-\d+z)+$/.test(path) && cells === dark, { cells, dark });
  const mid = Math.floor(m.size / 2);
  const hole = qrPath(m, { from: mid - 2, to: mid + 3 });
  const holeCells = [...hole.matchAll(/M\d+ \d+h(\d+)v1h-\d+z/g)].reduce((a, x) => a + Number(x[1]), 0);
  const under = m.dark.slice(mid - 2, mid + 3).flatMap((r) => r.slice(mid - 2, mid + 3)).filter(Boolean).length;
  ok('a square left out under a logo', holeCells === dark - under);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
