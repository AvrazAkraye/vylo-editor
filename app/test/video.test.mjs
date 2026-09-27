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
  ART_SCHEMA, DESIGN_RULES, DESIGN_SHAPE, MAX_BIGTYPE_LINES, MAX_FEATURES, SCHEMA, artOf, artPrompt, designIn, designPrompt,
  iconOf, mainTextOf, parseArt, readDesign, readingSeconds, sceneJson,
} from '../.test-build/video.js';
import { markPhrases, phraseOf } from '../.test-build/videoemphasis.js';

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

// ── round 4: creative videos — art direction, four more kinds, a designed look ──
const ROUND4 = ['bigtype', 'features', 'device', 'marquee'];
const EFFECTS = ['rise', 'mask', 'pop', 'fade', 'type', 'highlight', 'scale', 'slide', 'glitch'];
const GROUNDS = ['style', 'accent', 'gradient', 'dark', 'light', 'photo'];
const CAMERAS = ['still', 'push', 'pull', 'drift', 'tilt'];
const SHAPES = ['none', 'circle', 'ring', 'dots', 'lines', 'wave', 'burst', 'arrow', 'grid', 'blob'];
const FONTS = ['geometric', 'condensed', 'classic', 'wide', 'swiss', 'soft', 'book', 'poster', 'calligraphy', 'rounded'];
const DECOS = ['mesh', 'slab', 'frame', 'glow', 'rule', 'sun'];
/** WCAG contrast, written again here so the repair is checked by a second hand. */
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; })
    .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, k) => k - m); return (x + 0.05) / (y + 0.05); };
const HEX = /^#[0-9A-F]{6}$/;
const design = (o = {}) => ({ name: 'Night clinic', why: 'Calm and clear', bg: '#0B1B2B', bg2: '#12304A', fg: '#F4F8FF', accent: '#3DD6C4', accent2: '#F2B84B', font: 'swiss', deco: 'rule', energy: 'calm', ...o });

// A new video that asks for a designed look.
{
  const a = newVideo({ id: 'a', now: 1, request: 'r', lang: 'en', format: 'portrait', style: 'modern', seconds: 30, ai: true });
  ok('newVideo({ai:true}) asks for a designed look', a.ai === true && a.design === undefined);
  const b = newVideo({ id: 'b', now: 1, request: 'r', lang: 'en', format: 'portrait', style: 'modern', seconds: 30 });
  ok('without ai, no ai field at all: the style is the look', !('ai' in b));
  ok('ai:false is the same as none', !('ai' in newVideo({ id: 'c', now: 1, request: 'r', lang: 'en', format: 'portrait', style: 'modern', seconds: 30, ai: false })));
}

// The prompts: the art director, its vocabularies, the four kinds.
{
  const p = planPrompt(video());
  ok('the model is the art director now, choosing from fixed vocabularies',
    /art director/.test(p.system) && /fixed vocabularies/.test(p.system) && !/you never choose fonts, colours, positions or animations/.test(p.system));
  ok('it still never writes code', /never write code, markup or CSS/.test(p.system));
  ok('the honesty rules are all still there',
    /Never invent a statistic/.test(p.system) && /Never put words in the mouth of a real person/.test(p.system) && /Never invent one/.test(p.system)
    && /A "people" scene names only people the request names/.test(p.system) && /award-winning/.test(p.system));
  ok('features list only what is offered; a device shows no other company\'s app',
    /"features" scene lists only what the request or the facts say is offered/.test(p.system) && /never another company's app/.test(p.system));
  ok('the four new kinds are described', ROUND4.every((k) => p.user.includes(`"kind":"${k}"`) && SCHEMA.includes(`"kind":"${k}"`)));
  ok('bigtype: 1 to 4 lines of 1 to 3 words, the strongest first', SCHEMA.includes('"lines":["1 to 4 lines of 1 to 3 words each, the strongest line first"]'));
  ok('device: phone or laptop, with a required search for what is on its screen',
    SCHEMA.includes('"device":"phone|laptop"') && /"imageQuery":"required: what is on the screen/.test(SCHEMA));
  const iconLine = SCHEMA.split('\n').find((l) => l.startsWith('"icon" is one of:')) ?? '';
  const icons = iconLine.replace('"icon" is one of: ', '').split('. ')[0].split(', ');
  ok('every icon is listed by name, sixty of them', icons.length === 60 && ['stethoscope', 'handshake', 'ruler', 'graduation', 'sparkle'].every((i) => icons.includes(i)), icons.length);
  ok('every word of the art vocabularies is shown, in the schema', [...EFFECTS, ...GROUNDS, ...CAMERAS, ...SHAPES, 'quiet', 'hero'].every((w) => ART_SCHEMA.includes(`"${w}"`)) && SCHEMA.includes(ART_SCHEMA));
  ok('a photo ground allows a picture search on any kind', /any kind whose "art" has "ground":"photo"/.test(SCHEMA));
  ok('creative direction: rhythm, a hero hook, a beat, emphasis copied, few shapes, a calm close',
    /CREATIVE DIRECTION/.test(p.user) && /Never the same "effect" three scenes running/.test(p.user) && /"size":"hero"/.test(p.user)
    && /"accent" or a "gradient" ground/.test(p.user) && /copied exactly from the scene's headline/.test(p.user)
    && /at most half of the scenes/.test(p.user) && /outro calm and clear/.test(p.user));
  ok('a video of 20 seconds or more is asked for a poster or a marquee; one of 15 is not',
    /At least one "bigtype" or "marquee"/.test(planPrompt(video({ seconds: 20 })).user) && !/At least one "bigtype" or "marquee"/.test(planPrompt(video({ seconds: 15 })).user));
  const example = p.user.slice(p.user.lastIndexOf('{"title"'));
  const ex = JSON.parse(example);
  ok('the example shows art on several scenes, and a new kind', ex.scenes.filter((s) => s.art).length >= 3 && ex.scenes.some((s) => ROUND4.includes(s.kind)));
  const exPlan = parsePlan(example, video({ seconds: 18 }), newId);
  ok('the example\'s art survives its own repair, emphasis included',
    exPlan && exPlan.scenes[0].art?.emphasis?.[0] === 'warm' && exPlan.scenes[0].art.ground === 'photo' && exPlan.scenes[1].kind === 'bigtype' && exPlan.scenes[3].kind === 'features',
    exPlan && exPlan.scenes.map((s) => s.art));
  const redo = scenePrompt({ ...video(), scenes: exPlan.scenes }, 1, '').user;
  ok('a redo may carry art, and keeps the scene\'s own unless asked', /"art":\{"effect":"rise"\}/.test(redo) && /keep the scene's own art/.test(redo));
}
{
  // The look is designed in the plan only when it is asked for and not there yet.
  const plain = planPrompt(video()).user;
  const asked = planPrompt(video({ ai: true })).user;
  const have = planPrompt(video({ ai: true, design: design() })).user;
  ok('a style video is not asked for a design', !plain.includes('"design":') && !plain.includes(DESIGN_RULES));
  ok('an AI-look video without one is asked for it in the same reply', asked.includes(`"design":${DESIGN_SHAPE}`) && asked.includes(DESIGN_RULES));
  ok('one that has its design is not asked again, and is told its look',
    !have.includes('"design":') && /Look: designed \("Night clinic"\) — a calm pace, the swiss typeface, the "rule" background/.test(have), have.match(/Look:.*/)?.[0]);
  ok('a design switched off is not the look', !planPrompt(video({ ai: false, design: design() })).user.includes('Look: designed'));
  ok('the brand\'s colours are the palette\'s starting point',
    /The brand's colours: #112233 and #FFAA00/.test(planPrompt(video({ ai: true, brand: { name: 'N', primary: '#112233', accent: '#fa0' } })).user));
  ok('design rules: every typeface with its character, each with all the Arabic and Kurdish letters',
    FONTS.every((f) => new RegExp(`"${f}" — [^\\n]+: [^\\n]+`).test(DESIGN_RULES)) && /all the Arabic and Kurdish letters/.test(DESIGN_RULES));
  ok('design rules: the six motifs, the three paces, readable, no neon unless asked',
    DECOS.every((d) => DESIGN_RULES.includes(`"${d}" — `)) && /"calm"/.test(DESIGN_RULES) && /"punchy"/.test(DESIGN_RULES) && /at least 7:1/.test(DESIGN_RULES) && /No neon/.test(DESIGN_RULES));
  ok('the shape offers every typeface and motif', FONTS.every((f) => DESIGN_SHAPE.includes(f)) && DECOS.every((d) => DESIGN_SHAPE.includes(d)));
}
{
  const plan = parsePlan(goodJson, video(), newId);
  const v = video({ title: 'Nuri Clinic', scenes: plan.scenes });
  const d = designPrompt(v);
  ok('a look on its own: JSON only, the request, the title and what the scenes say',
    /JSON only/.test(d.system) && d.user.includes(v.request) && d.user.includes('Title: Nuri Clinic') && d.user.includes('Sick at midnight?') && d.user.includes(DESIGN_SHAPE));
  const again = designPrompt(v, design());
  ok('designing again asks for a clearly different look, naming the one it has', /clearly different/.test(again.user) && again.user.includes('"Night clinic"') && !/clearly different/.test(d.user));
  const pic = { src: 'data:image/jpeg;base64,AAAA', credit: 'c', source: 's', query: 'doctor talking to patient' };
  const a = artPrompt({ ...v, scenes: v.scenes.map((s, i) => (i === 2 ? { ...s, picture: pic } : s)) });
  ok('restyle: every scene numbered, words untouched, art only',
    /^1\. \{/m.test(a.user) && new RegExp(`^${v.scenes.length}\\. \\{`, 'm').test(a.user) && /Do not change a word/.test(a.user) && a.user.includes('{"scenes":[{"i":1,"art":'));
  ok('restyle: a scene with a picture is marked, one without is not, and no picture data is sent',
    /^3\. .*— has a picture$/m.test(a.user) && !/^2\. .*has a picture/m.test(a.user) && !a.user.includes('data:image'));
  ok('restyle carries the creative direction and the art vocabulary', a.user.includes('CREATIVE DIRECTION') && a.user.includes(ART_SCHEMA));
}

// The four new kinds, read and repaired.
{
  const v = video();
  const k = (x, vv = v) => sanitizeScene(x, vv, newId);
  const b = k({ kind: 'bigtype', lines: ['Open', 'all night', '<b>every</b> night'] });
  ok('a poster keeps its lines, cleaned', b?.kind === 'bigtype' && b.lines.join('|') === 'Open|all night|every night', b);
  ok('four lines at most', MAX_BIGTYPE_LINES === 4 && k({ kind: 'bigtype', lines: ['a', 'b', 'c', 'd', 'e', 'f'] })?.lines.length === 4);
  ok('a line of more than three words is broken, evenly', k({ kind: 'bigtype', lines: ['We never close tonight'] })?.lines.join('|') === 'We never|close tonight');
  ok('one string with line breaks is its lines', k({ kind: 'bigtype', text: 'Care\nthat never\nsleeps' })?.lines.length === 3);
  const sentence = k({ kind: 'bigtype', lines: ['one two three four five six seven eight nine ten eleven twelve thirteen fourteen'] });
  ok('a sentence too long for a poster is said as a sentence', sentence?.kind === 'kinetic' && sentence.text.startsWith('one two'), sentence);
  ok('poster, big-type and typography-poster are bigtype; typography is still kinetic',
    ['poster', 'big-type', 'typography-poster'].every((kind) => k({ kind, lines: ['Big'] })?.kind === 'bigtype') && k({ kind: 'typography', text: 'x' })?.kind === 'kinetic');
  ok('a poster with no words is nothing', k({ kind: 'bigtype', lines: [] }) === null && k({ kind: 'bigtype' }) === null);
  ok('a Sorani poster is in Kurdish letters', k({ kind: 'bigtype', lines: ['هەموو ڕۆژێ\u0643'] }, video({ lang: 'ckb' }))?.lines[0] === 'هەموو ڕۆژێ\u06A9');
}
{
  const v = video();
  const k = (x) => sanitizeScene(x, v, newId);
  const f = k({ kind: 'features', heading: 'Why us', items: [
    { icon: 'doctor', label: 'Real doctors' }, { icon: 'price', label: 'Fair prices' }, { icon: 'time', label: 'Open late' }, { icon: 'team', label: 'A kind team' }, { icon: 'star', label: 'Fifth' },
  ] });
  ok('features: four at most, each an icon and a label', MAX_FEATURES === 4 && f?.kind === 'features' && f.items.length === 4 && f.heading === 'Why us', f);
  ok('an icon by the word a model used: doctor, price, time, team', f.items.map((it) => it.icon).join() === 'stethoscope,tag,clock,users', f.items);
  ok('and the rest of the table',
    [['fast', 'bolt'], ['love', 'heart'], ['idea', 'bulb'], ['security', 'shield'], ['eco', 'leaf'], ['travel', 'plane'], ['growth', 'trend'], ['goal', 'target'],
      ['quality', 'medal'], ['award', 'trophy'], ['support', 'chat'], ['email', 'mail'], ['call', 'phone'], ['web', 'globe'], ['shop', 'cart'], ['location', 'pin'],
      ['money', 'money'], ['school', 'school'], ['food', 'food']].every(([w, id]) => iconOf(w) === id));
  ok('an icon in any case or as a plural; anything else the sparkle',
    iconOf('HEART') === 'heart' && iconOf('Doctors') === 'stethoscope' && iconOf('stars') === 'star' && iconOf('hologram') === 'sparkle' && iconOf(undefined) === 'sparkle' && iconOf('constructor') === 'sparkle');
  ok('labels alone are features with the sparkle', k({ kind: 'features', items: ['Fast', 'Friendly'] })?.items.every((it) => it.icon === 'sparkle'));
  ok('the heading is optional', k({ kind: 'features', items: [{ icon: 'star', label: 'a' }, { icon: 'star', label: 'b' }] })?.heading === undefined);
  const one = k({ kind: 'features', heading: 'Why us', items: [{ icon: 'star', label: 'Open late' }] });
  ok('one feature is a line of words, not a grid', one?.kind === 'kinetic' && one.text.includes('Open late'), one);
  ok('icons, feature-grid and feature-list are features', ['icons', 'feature-grid', 'feature-list'].every((kind) => k({ kind, items: ['a', 'b'] })?.kind === 'features'));
  const long = k({ kind: 'features', items: [{ label: '<i>x</i> '.repeat(30) }, { label: 'b' }] });
  ok('a label is short and clean', long && Array.from(long.items[0].label).length <= 40 && !long.items[0].label.includes('<'), long);
}
{
  const k = (x, format) => sanitizeScene(x, video({ format }), newId);
  const d = { kind: 'device', heading: 'Book in a tap', text: 'Your visit, from your phone.', imageQuery: 'mobile booking app screen' };
  ok('a device is a phone in an upright or square video, a laptop in a wide one',
    k(d, 'portrait')?.device === 'phone' && k(d, 'square')?.device === 'phone' && k(d, 'landscape')?.device === 'laptop');
  ok('the device named is kept, in the other words for it too',
    k({ ...d, device: 'laptop' }, 'portrait')?.device === 'laptop' && k({ ...d, device: 'Smartphone' }, 'landscape')?.device === 'phone'
    && k({ ...d, device: 'computer' }, 'portrait')?.device === 'laptop' && k({ ...d, device: 'toaster' }, 'landscape')?.device === 'laptop');
  ok('"phone" and "laptop" as kinds are devices of that kind; mockup, app and screen fit the frame',
    k({ ...d, kind: 'laptop' }, 'portrait')?.device === 'laptop' && k({ ...d, kind: 'phone' }, 'landscape')?.device === 'phone'
    && ['mockup', 'app', 'screen'].every((kind) => k({ ...d, kind }, 'square')?.kind === 'device' && k({ ...d, kind }, 'square').device === 'phone'));
  const dv = k(d, 'portrait');
  ok('a device keeps its screen\'s search, and wants that picture', dv.imageQuery === 'mobile booking app screen' && pictureJobs([dv]).length === 1 && pictureJobs([dv])[0].key === 'main');
  ok('a device with no words is a picture; with nothing, nothing', k({ kind: 'device', imageQuery: 'app screen' }, 'portrait')?.kind === 'image' && k({ kind: 'device' }, 'portrait') === null);
}
{
  const k = (x) => sanitizeScene(x, video(), newId);
  const m = k({ kind: 'marquee', text: 'Open every night', sub: 'Nuri Clinic, Erbil' });
  ok('a marquee keeps its phrase and its line', m?.kind === 'marquee' && m.text === 'Open every night' && m.sub === 'Nuri Clinic, Erbil');
  ok('ticker, scroll and banner are marquees', ['ticker', 'scroll', 'banner'].every((kind) => k({ kind, text: 'Go' })?.kind === 'marquee'));
  const long = k({ kind: 'marquee', text: 'this is a whole sentence that nobody could read as it scrolls past the frame' });
  ok('a sentence is not a marquee: it is said as words', long?.kind === 'kinetic', long);
  ok('only a line under it is a line of words', k({ kind: 'marquee', sub: 'Just this' })?.kind === 'kinetic');
}
{
  const two = sanitizeScene({ kind: 'features', items: ['a b', 'c d'] }, video(), newId);
  const four = sanitizeScene({ kind: 'features', items: ['a b', 'c d', 'e f', 'g h'] }, video(), newId);
  ok('four features take longer to take in than two', readingSeconds(four) > readingSeconds(two));
  ok('every new kind has a readable length', ROUND4.every((kind) => { const s = blankScene(kind, video(), newId); return readingSeconds(s) >= 2 && s.seconds >= 3; }));
}

// Art: every field in its vocabulary, emphasis only in the scene's words, a photo only with a picture.
{
  const t = 'Care that never sleeps — free for children';
  const all = artOf({ effect: 'highlight', ground: 'gradient', camera: 'push', shape: 'burst', emphasis: ['free'], align: 'center', size: 'hero' }, t);
  ok('art: every valid field kept',
    all && all.effect === 'highlight' && all.ground === 'gradient' && all.camera === 'push' && all.shape === 'burst' && all.emphasis.join() === 'free' && all.align === 'center' && all.size === 'hero', all);
  ok('every word of each vocabulary is accepted',
    EFFECTS.every((e) => artOf({ effect: e }, t)?.effect === e) && GROUNDS.every((g) => artOf({ ground: g }, t)?.ground === g)
    && CAMERAS.every((c) => artOf({ camera: c }, t)?.camera === c) && SHAPES.every((s) => artOf({ shape: s }, t)?.shape === s));
  const bad = artOf({ effect: 'explode', ground: '#ff0000', camera: 'orbit', shape: '<svg onload=x>', align: 'left', size: 11, emphasis: 'nothing here' }, t);
  ok('unknown values are dropped; nothing valid is no art at all', bad === undefined, bad);
  ok('not an object is no art', [null, undefined, 'pop', 3, ['pop']].every((x) => artOf(x, t) === undefined));
  ok('the words models use: typewriter, zoom-in, centre, big, Sunburst, Fade In',
    artOf({ effect: 'typewriter' }, t)?.effect === 'type' && artOf({ camera: 'zoom-in' }, t)?.camera === 'push' && artOf({ align: 'centre' }, t)?.align === 'center'
    && artOf({ size: 'big' }, t)?.size === 'hero' && artOf({ shape: 'Sunburst' }, t)?.shape === 'burst' && artOf({ effect: 'Fade In' }, t)?.effect === 'fade');
  ok('emphasis: only words the scene says, as the scene writes them', artOf({ emphasis: ['FREE', 'cheap', 'Children'] }, t)?.emphasis.join() === 'free,children');
  ok('emphasis: whole words only; "leep" is not in "sleeps"', artOf({ emphasis: ['leep', 'car'] }, t) === undefined);
  ok('emphasis: a short phrase, in its order', artOf({ emphasis: ['never sleeps'] }, t)?.emphasis[0] === 'never sleeps' && artOf({ emphasis: ['sleeps never'] }, t) === undefined);
  ok('emphasis: at most three, each once', artOf({ emphasis: ['care', 'Care', 'never', 'sleeps', 'free'] }, t)?.emphasis.join() === 'Care,never,sleeps');
  ok('emphasis: one string with commas is a list, the Arabic comma too', artOf({ emphasis: 'free، children' }, t)?.emphasis.length === 2);
  ok('emphasis: longer than 30 characters is not an accent', artOf({ emphasis: ['Care that never sleeps — free for children'] }, t) === undefined);
  ok('emphasis in Arabic matches with or without vowel marks, and keeps the text\'s spelling',
    artOf({ emphasis: ['مجانا\u064B'] }, 'العلاج مجانا للأطفال')?.emphasis[0] === 'مجانا' && artOf({ emphasis: ['مجانا'] }, 'العلاج مجانا\u064B للأطفال')?.emphasis[0] === 'مجانا\u064B');
  ok('emphasis in Sorani: ە typed as ه still matches, and a word is never matched in part',
    artOf({ emphasis: ['خۆرای\u0647'] }, 'چارەسەر خۆرای\u06D5 بۆ منداڵان')?.emphasis[0] === 'خۆرای\u06D5' && artOf({ emphasis: ['خۆرا'] }, 'چارەسەر خۆرای\u06D5 بۆ منداڵان') === undefined);
  ok('a photo ground is dropped when there is no picture to show', artOf({ ground: 'photo', effect: 'pop' }, t, false)?.ground === undefined && artOf({ ground: 'photo' }, t)?.ground === 'photo');
}
{
  const v = video();
  const kin = sanitizeScene({ kind: 'kinetic', text: 'We are here at midnight', imageQuery: 'night city street', art: { ground: 'photo', effect: 'mask', emphasis: ['midnight'] } }, v, newId);
  ok('a photo ground lets any kind search for its picture', kin?.art?.ground === 'photo' && kin.imageQuery === 'night city street' && pictureJobs([kin]).map((j) => j.key).join() === 'main', kin);
  const shown = withPicture(kin, 'main', { src: 'data:image/jpeg;base64,NIGHT', credit: 'c', source: 's', query: 'night city street' });
  ok('and its picture goes in and comes out like any other', shown.picture?.src.endsWith('NIGHT') && picturesOf(shown).length === 1 && withPicture(shown, 'main', undefined).picture === undefined);
  const noQuery = sanitizeScene({ kind: 'kinetic', text: 'x y', art: { ground: 'photo', effect: 'pop' } }, v, newId);
  ok('a photo ground with nothing to search for is dropped; the rest of the art stays', noQuery?.art?.ground === undefined && noQuery.art.effect === 'pop' && noQuery.imageQuery === undefined);
  ok('without a photo ground, a search on a kind with no picture is still dropped', sanitizeScene({ kind: 'kinetic', text: 'x', imageQuery: 'night city', art: { ground: 'dark' } }, v, newId)?.imageQuery === undefined);
  ok('a gallery has its own pictures: no photo ground', sanitizeScene({ kind: 'gallery', imageQueries: ['a beach', 'a road'], imageQuery: 'x y', art: { ground: 'photo' } }, v, newId)?.art === undefined);
  const flat = sanitizeScene({ kind: 'title', title: 'Open all night', effect: 'scale', size: 'hero', emphasis: ['night'] }, v, newId);
  ok('art fields written on the scene itself are read as its art', flat?.art?.effect === 'scale' && flat.art.size === 'hero' && flat.art.emphasis[0] === 'night', flat);
  ok('art with nothing valid is no art', sanitizeScene({ kind: 'kinetic', text: 'x', art: { effect: 'explode' } }, v, newId)?.art === undefined);
  ok('emphasis is checked against the words the scene draws with it: its heading, not its points',
    sanitizeScene({ kind: 'bullets', heading: 'Why', points: ['Free parking', 'Open late'], art: { emphasis: ['Free', 'Why', 'nope'] } }, v, newId)?.art?.emphasis.join() === 'Why');
  ok('…a title\'s, not its subtitle', artOf({ emphasis: ['late', 'Care'] }, mainTextOf({ kind: 'title', title: 'Care that never closes', subtitle: 'Open late' }))?.emphasis.join() === 'Care'
    && mainTextOf({ kind: 'outro', headline: 'Nuri', cta: 'Book now' }) === 'Nuri' && mainTextOf({ kind: 'stat', value: 3, label: 'clinics' }) === ''
    && mainTextOf({ kind: 'marquee', text: 'Open late', sub: 'every day' }) === 'Open late' && mainTextOf({ kind: 'device', device: 'phone', heading: 'Book', text: 'in a minute' }) === 'Book');
  const said = (title, emphasis) => artOf({ emphasis }, title)?.emphasis?.join('|');
  ok('a phrase is kept as the words in a row, as the text writes them', said('Free delivery for you and for your family', ['FOR YOU']) === 'for you');
  ok('…and matched as the scene draws its words, split at spaces: "mail" is not in "e-mail", "24" not in "24/7"',
    said('Write us an e-mail today', ['mail']) === undefined && said('Write us an e-mail today', ['e-mail']) === 'e-mail' && said('Open 24/7', ['24']) === undefined);
  ok('…without the punctuation around it', said('Fresh, warm bread!', ['bread', 'fresh']) === 'bread|Fresh');
  ok('…never across two lines of the scene', said('Made for\nyou', ['for you']) === undefined);
  ok('…in Arabic script, with ە typed as ه', said('قاوەی تازە هەموو بەیانییەک', ['تازه']) === 'تازە' && said('قهوة طازجة كل صباح', ['طازجة']) === 'طازجة');
  ok('a scene read again by the model carries its art', sceneJson(kin).includes('"art":{') && sceneJson(kin).includes('"ground":"photo"'));
  ok('mainTextOf: every line a scene shows, defensively',
    mainTextOf(sanitizeScene({ kind: 'features', heading: 'H', items: ['a', 'b'] }, v, newId)) === 'H\na\nb' && mainTextOf({ kind: 'bigtype', lines: ['x', 'y'] }) === 'x\ny'
    && mainTextOf(null) === '' && mainTextOf({ kind: 'bullets', heading: 'h', points: 'broken' }) === 'h');

  // A redo keeps the scene's art and the picture behind it, unless it gives its own.
  const vv = { ...v, scenes: [{ id: 't', kind: 'title', title: 'Hi', seconds: 3, transition: 'fade' }, shown, { id: 'o', kind: 'outro', headline: 'Bye', seconds: 3, transition: 'none' }] };
  const kept = parseScene('{"kind":"kinetic","text":"Awake at midnight, every night"}', shown, vv, newId);
  ok('a redo that gives no art keeps the scene\'s own, and the picture behind it',
    kept?.art?.ground === 'photo' && kept.art.effect === 'mask' && kept.art.emphasis?.[0] === 'midnight' && kept.picture?.src.endsWith('NIGHT'), kept);
  const moved = parseScene('{"kind":"kinetic","text":"Always awake","art":{"effect":"pop","emphasis":["midnight","awake"]}}', shown, vv, newId);
  ok('a redo with its own art replaces it, emphasis checked against the new words',
    moved?.art?.effect === 'pop' && moved.art.ground === undefined && moved.art.emphasis.join() === 'awake' && moved.picture === undefined, moved);
  const photoAgain = parseScene('{"kind":"kinetic","text":"Still here","art":{"ground":"photo"}}', shown, vv, newId);
  ok('a redo that asks for the photo ground uses the picture the scene has',
    photoAgain?.art?.ground === 'photo' && photoAgain.picture?.src.endsWith('NIGHT') && photoAgain.imageQuery === 'night city street', photoAgain);
}

// Restyle: the model's art for each scene, by index.
{
  const plan = parsePlan(goodJson, video(), newId);
  const v = video({ scenes: plan.scenes });
  const reply = 'Here you go:\n```json\n' + JSON.stringify({ scenes: [
    { i: 2, art: { effect: 'type', emphasis: ['midnight'], ground: 'accent' } },
    { i: 1, art: { effect: 'glitch', size: 'hero', ground: 'photo' } },
    { i: 4, art: { ground: 'photo', emphasis: ['treat', 'injuries', 'Paris'] } },
    { i: 2, art: { effect: 'pop' } },
    { i: 99, art: { effect: 'pop' } },
    { i: 5, art: { effect: 'nonsense' } },
  ] }) + '\n```';
  const r = parseArt(reply, v);
  ok('restyle: one entry per scene', Array.isArray(r) && r.length === v.scenes.length, r);
  ok('found by "i", not by order', r[0]?.effect === 'glitch' && r[1]?.effect === 'type');
  ok('each checked against its own scene\'s words', r[1].emphasis?.join() === 'midnight' && r[3]?.emphasis?.join() === 'treat', r[3]);
  ok('a photo ground only where the scene has a picture to show', r[0].ground === 'photo' && r[3]?.ground === undefined);
  ok('a scene given twice keeps the first; out of range or nothing valid is none', r[1].effect === 'type' && r[4] === undefined && r[5] === undefined);
  const byPlace = parseArt(JSON.stringify({ scenes: [{ art: { effect: 'rise' } }, { art: { effect: 'fade' } }] }), v);
  ok('without "i", an entry is its place in the list', byPlace?.[0]?.effect === 'rise' && byPlace[1].effect === 'fade' && byPlace[2] === undefined);
  ok('a bare list is read, and art written on the entry itself', parseArt('[{"i":3,"effect":"slide","camera":"drift"}]', v)?.[2]?.camera === 'drift');
  ok('garbage is null, so a broken reply never wipes the art',
    [undefined, '', 'no', '{"scenes":[]}', '{"scenes":[{"i":1,"art":{"effect":"boom"}}]}', '{"title":"x"}'].every((x) => parseArt(x, v) === null));
}

// A designed look: read, made readable, and found in a reply.
{
  const good = readDesign(design());
  ok('a good design reads as it was written',
    good && good.bg === '#0B1B2B' && good.fg === '#F4F8FF' && good.accent === '#3DD6C4' && good.font === 'swiss' && good.deco === 'rule' && good.energy === 'calm' && good.name === 'Night clinic', good);
  ok('null unless all five colours are there', readDesign({ ...design(), accent2: undefined }) === null && readDesign(design({ bg2: 'blue' })) === null && [null, undefined, 'x', 3, []].every((x) => readDesign(x) === null));
  const short = readDesign(design({ bg: '#fff', bg2: 'f4f4f4', fg: '111', accent: '#c0392b', accent2: 'E67E22' }));
  ok('colours as #abc, abc, #aabbcc or aabbcc, in any case, come out #AABBCC',
    short && [short.bg, short.bg2, short.fg, short.accent, short.accent2].every((c) => HEX.test(c)) && short.bg === '#FFFFFF' && short.fg === '#111111' && short.accent2 === '#E67E22', short);
  const pale = readDesign(design({ bg: '#FFFFFF', bg2: '#F2F6FF', fg: '#9DB8F0', accent: '#F5F8FF' }));
  ok('words too pale on white are darkened to 7:1, and stay blue',
    ratio(pale.fg, pale.bg) >= 7 && ratio(pale.fg, pale.bg2) >= 4.5 && (parseInt(pale.fg.slice(5, 7), 16) > parseInt(pale.fg.slice(1, 3), 16)), pale);
  ok('an accent lost in the ground is moved toward the words until it shows', ratio(pale.accent, pale.bg) >= 2.5 && pale.accent !== '#F5F8FF');
  const split = readDesign(design({ bg: '#0A0A14', bg2: '#F5F0E6', fg: '#FFFFFF' }));
  ok('a dark ground shading into a light one: the second is brought toward the first until the words read on both',
    split && ratio(split.fg, split.bg) >= 7 && ratio(split.fg, split.bg2) >= 4.5 && split.bg2 !== '#F5F0E6', split);
  const grey = readDesign(design({ bg: '#777777', bg2: '#777777', fg: '#808080', accent: '#787878' }));
  ok('a mid-grey ground nothing reads on at 7:1 is itself moved until the words do', ratio(grey.fg, grey.bg) >= 7 && ratio(grey.fg, grey.bg2) >= 4.5 && ratio(grey.accent, grey.bg) >= 2.5, grey);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const hex = () => '#' + Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0');
  let wrong = null;
  for (let i = 0; i < 300 && !wrong; i++) {
    const d = readDesign({ bg: hex(), bg2: hex(), fg: hex(), accent: hex(), accent2: hex() });
    if (!d || ratio(d.fg, d.bg) < 7 || ratio(d.fg, d.bg2) < 4.5 || ratio(d.accent, d.bg) < 2.5 || ![d.bg, d.bg2, d.fg, d.accent, d.accent2].every((c) => HEX.test(c))) wrong = d;
  }
  ok('three hundred random palettes all come out readable', wrong === null, wrong);
  ok('a typeface by id, by label or by family name; anything else geometric',
    readDesign(design({ font: 'calligraphy' })).font === 'calligraphy' && readDesign(design({ font: 'Classic serif' })).font === 'classic'
    && readDesign(design({ font: 'Playfair Display' })).font === 'classic' && readDesign(design({ font: 'Comic Sans' })).font === 'geometric' && readDesign(design({ font: undefined })).font === 'geometric');
  ok('a motif and a pace from their lists, in any case; else mesh and lively',
    readDesign(design({ deco: 'SUN', energy: 'Punchy' })).deco === 'sun' && readDesign(design({ energy: 'Punchy' })).energy === 'punchy'
    && readDesign(design({ deco: 'confetti' })).deco === 'mesh' && readDesign(design({ energy: 'frantic' })).energy === 'lively');
  const words = readDesign(design({ name: '  <b>Night</b>\n  clinic   blue and a very long name that goes on  ', why: 'x '.repeat(200) }));
  ok('name and why: one plain line each, 40 and 160 characters at most',
    words.name.startsWith('Night clinic blue') && !words.name.includes('<') && Array.from(words.name).length <= 40 && Array.from(words.why).length <= 160 && !/\s\s/.test(words.why), words);
  ok('a bidi override or a zero-width space in a name is removed, not shown', readDesign(design({ name: 'Night\u202E \u200Bclinic' })).name === 'Night clinic');
}
{
  const plan = 'Sure!\n```json\n' + JSON.stringify({ title: 'T', design: design({ name: 'From the plan' }), scenes: [{ kind: 'title', title: 'Hi' }] }) + '\n```';
  ok('designIn: the design of a whole plan', designIn(plan)?.name === 'From the plan');
  ok('designIn: a reply that is only a design', designIn(JSON.stringify(design({ name: 'Alone' })))?.name === 'Alone');
  ok('designIn: a plan without one, or garbage, is null', designIn(goodJson) === null && designIn('no') === null && designIn(undefined) === null);
  ok('the storyboard is still read from a reply that carries a design', parsePlan(plan, video(), newId)?.scenes[0].title === 'Hi');
}

// A scene of the four new kinds added by hand.
for (const lang of LANGS) {
  const v = video({ lang });
  const scenes = ROUND4.map((k) => blankScene(k, v, newId));
  ok(`${lang}: the four new kinds have blanks of their kind that survive their own repair`,
    scenes.every((s, i) => s.kind === ROUND4[i] && sanitizeScene(s, v, newId)?.kind === s.kind), scenes.map((s) => s.kind));
  ok(`${lang}: readable seconds, fresh ids, a poster of short lines, three features with icons`,
    scenes.every((s) => s.seconds >= 3 && s.seconds <= 20) && new Set(scenes.map((s) => s.id)).size === 4
    && scenes[0].lines.every((l) => l.split(' ').length <= 3) && scenes[1].items.length === 3 && scenes[1].items.every((it) => iconOf(it.icon) === it.icon));
  const words = scenes.map((s) => mainTextOf(s)).join(' ');
  if (lang === 'ar') ok('ar: the four kinds\' placeholders in Arabic letters', /[\u0600-\u06FF]/.test(words) && !/[\u06CC\u06A9\u06D5]/.test(words));
  if (lang === 'ckb' || lang === 'kmr') ok(`${lang}: the four kinds' placeholders in Kurdish letters`, /[\u06D5\u06CE]/.test(words) && !/[\u064A\u0643\u0629]/.test(words));
  if (lang === 'en') ok('en: the four kinds\' placeholders in English', /[A-Za-z]/.test(words) && !/[\u0600-\u06FF]/.test(words));
}
ok('Badini and Sorani new placeholders differ', mainTextOf(blankScene('features', video({ lang: 'ckb' }), newId)) !== mainTextOf(blankScene('features', video({ lang: 'kmr' }), newId)));
ok('a blank device fits the frame: a phone upright, a laptop wide',
  blankScene('device', video({ format: 'portrait' }), newId).device === 'phone' && blankScene('device', video({ format: 'landscape' }), newId).device === 'laptop');
ok('a blank marquee scrolls the brand\'s name when there is one', blankScene('marquee', video({ brand: { name: 'Nuri' } }), newId).text === 'Nuri');

// ── emphasis as the scenes draw it ─────────────────────────────────────────
{
  const marks = (line, ...asked) => markPhrases(line.split(' '), asked.map(phraseOf)).map((m) => (m ? 1 : 0)).join('');
  ok('a phrase lights where its words stand together, not every copy of each word', marks('Free delivery for you and for your family', 'for you') === '00110000');
  ok('…every place it stands', marks('for you and for you', 'for you') === '11011');
  ok('a word lights with the punctuation around it', marks('Fresh, warm bread!', 'bread') === '001');
  ok('a bare mark between a phrase\'s words is part of it', marks('salt & pepper', 'salt pepper') === '111');
  ok('no emphasis lights nothing', marks('Open late') === '00');
  ok('a phrase across the lines a text was broken into lights on both', markPhrases(['Made', 'for', 'you'], [phraseOf('for you')]).join() === 'false,true,true');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
