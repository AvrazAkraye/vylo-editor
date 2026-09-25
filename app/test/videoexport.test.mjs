// Taking a video away: the files the Video panel writes that are not rendered
// frames, and the names and requests they are written with.
//
// Rendering itself needs a browser with WebCodecs and is checked in one (see
// the downloads agent's harness notes in the round-2 report); what is checked
// here is everything around it that a person reads or a player parses:
//
//   - subtitles: the narration when a scene has one, else the words it shows,
//     each cue timed by where its scene starts — transitions overlap, so a
//     scene starts TRANSITION_FRAMES before the one before it has gone — and
//     never longer than two lines of 42;
//   - the storyboard backup: every word and setting, and no data: URL anywhere;
//   - file names: the title in its own script, nothing a file system refuses,
//     a shape's tag, eighty characters at most;
//   - the write request: the bytes as the body, the path percent-encoded in a
//     header, and `x-unique` only for a download.
import {
  BITRATES, RESOLUTIONS, SHAPE_TAG, fileNameFor, hasAudio, hasWords, posterFrame, resolutionName, scaleOf,
  sceneStarts, sizeAt, srtOf, storyboardOf, textBytes, wordsOf, writeVideoFile,
} from '../.test-build/videoexport.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const FPS = 30;
const T = 15; // TRANSITION_FRAMES
const scene = (kind, seconds, fields, transition = 'fade') => ({ id: `s${Math.random().toString(36).slice(2, 8)}`, kind, seconds, transition, ...fields });
const video = (scenes, o = {}) => ({
  id: 'v1', created: 1, updated: 1, request: 'a promo', title: 'Dental clinic', lang: 'en', format: 'landscape', style: 'modern',
  seconds: 30, brand: { name: 'Smile' }, scenes, stage: 'ready', ...o,
});

/** Parse SubRip back into cues, so the test reads what a player would. */
function cuesOf(srt) {
  const body = srt.replace(/^\uFEFF/, '');
  return body.split('\r\n\r\n').filter(Boolean).map((block) => {
    const [n, times, ...lines] = block.split('\r\n').filter((l) => l !== '');
    const [from, to] = times.split(' --> ').map((s) => {
      const m = /^(\d\d):(\d\d):(\d\d),(\d\d\d)$/.exec(s);
      return m ? ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4] : NaN;
    });
    return { n: Number(n), from, to, lines };
  });
}
const ms = (frames) => Math.round((frames * 1000) / FPS);

// ── scene starts ──────────────────────────────────────────────────────────
{
  const v = video([
    scene('title', 3, { title: 'A' }),
    scene('kinetic', 4, { text: 'B' }, 'none'),
    scene('outro', 2, { headline: 'C' }),
  ]);
  const s = sceneStarts(v.scenes);
  ok('the first scene starts at 0', s[0] === 0, s);
  ok('a fade overlaps: the second starts TRANSITION_FRAMES before the first ends', s[1] === 90 - T, s);
  ok('a cut does not: the third starts where the second ends', s[2] === s[1] + 120, s);
  ok('no scenes, no starts', sceneStarts([]).length === 0);
}

// ── subtitles ─────────────────────────────────────────────────────────────
{
  const v = video([
    scene('title', 3, { title: 'Smile Dental', subtitle: 'Care in Duhok' }),
    scene('bullets', 5, { heading: 'What we do', points: ['Check-ups', 'Whitening', 'Braces'], narration: 'We do check-ups. And whitening, and braces too!' }),
    scene('stat', 3, { value: 12000, suffix: '+', label: 'happy patients' }, 'none'),
    scene('outro', 3, { headline: 'Book today', cta: 'Call us', url: 'smile.example' }),
  ]);
  const srt = srtOf(v);
  ok('subtitles open with a byte-order mark', srt.startsWith('\uFEFF'));
  ok('and use CRLF line ends only', !/[^\r]\n/.test(srt.slice(1)) && srt.includes('\r\n'));
  const cues = cuesOf(srt);
  ok('cues are numbered from 1 without gaps', cues.every((c, i) => c.n === i + 1), cues.map((c) => c.n));
  ok('every cue ends after it starts', cues.every((c) => c.to > c.from), cues);
  ok('cues never overlap and leave no gaps inside the film', cues.every((c, i) => i === 0 || c.from === cues[i - 1].to), cues.map((c) => [c.from, c.to]));
  const starts = sceneStarts(v.scenes);
  const total = starts[3] + 90;
  ok('the first cue starts at the first frame', cues[0].from === 0);
  ok('the last cue ends where the film ends', cues[cues.length - 1].to === ms(total), [cues[cues.length - 1].to, ms(total)]);
  const text = cues.map((c) => c.lines.join(' ')).join(' | ');
  ok('a scene without narration shows its on-screen words', text.includes('Smile Dental') && text.includes('Care in Duhok'), text);
  ok('a scene with narration says the narration, not its points', text.includes('We do check-ups.') && !text.includes('Whitening |'), text);
  ok('a number is written as the scene shows it', text.includes('12,000+ happy patients'), text);
  ok('the close gives its call and its address', text.includes('Book today') && text.includes('smile.example'), text);
  const narr = cues.filter((c) => /check-ups|whitening/i.test(c.lines.join(' ')));
  ok('the narration starts when its scene starts', narr[0].from === ms(starts[1]), [narr[0].from, ms(starts[1])]);
  ok('and ends when the next scene starts', narr[narr.length - 1].to === ms(starts[2]), [narr[narr.length - 1].to, ms(starts[2])]);
  ok('no line is longer than 42 characters when it can be broken', cues.every((c) => c.lines.every((l) => l.length <= 42 || !l.includes(' '))), cues.map((c) => c.lines));
  ok('no cue has more than two lines', cues.every((c) => c.lines.length <= 2));
}
{
  // A long narration is cut into several cues, each timed by its share of the letters.
  const long = 'The University of Duhok was founded in 1992 in the Kurdistan Region of Iraq. Today it has more than twenty colleges, and thousands of students study there every year. Its campus sits beside the mountains.';
  const v = video([scene('image', 12, { caption: 'Campus', narration: long }, 'none')]);
  const cues = cuesOf(srtOf(v));
  ok('a long narration becomes several cues', cues.length >= 3, cues.length);
  ok('which together say every word, in order', cues.map((c) => c.lines.join(' ')).join(' ') === long, cues.map((c) => c.lines.join(' ')));
  ok('and fill the scene exactly', cues[0].from === 0 && cues[cues.length - 1].to === 12000, [cues[0].from, cues[cues.length - 1].to]);
  const perChar = cues.map((c) => (c.to - c.from) / c.lines.join(' ').length);
  ok('each for roughly its share of the letters', Math.max(...perChar) / Math.min(...perChar) < 1.6, perChar);
}
{
  // Right to left: each line opens with a right-to-left mark.
  const v = video([scene('title', 3, { title: '2024 ساڵی نوێ', subtitle: 'زانکۆی دهۆک' })], { lang: 'ckb', title: 'ساڵی نوێ' });
  const cues = cuesOf(srtOf(v));
  ok('an RTL line opens with U+200F', cues.every((c) => c.lines.every((l) => l.startsWith('\u200F'))), cues);
  const en = cuesOf(srtOf(video([scene('title', 3, { title: '2024 new year' })])));
  ok('an English one does not', en.every((c) => c.lines.every((l) => !l.startsWith('\u200F'))));
}
{
  // A line the voice speaks is timed as the voice is placed, and says what the voice says.
  const scenes = [
    { id: 'a1', kind: 'title', seconds: 3, transition: 'fade', title: 'Open day', narration: 'Welcome.' },
    { id: 'a2', kind: 'kinetic', seconds: 4, transition: 'none', text: 'Apply now', narration: 'Apply before June.' },
  ];
  const v = video(scenes, { audio: { narrate: true, voice: { a2: { text: 'Apply before the first of June.', src: 'data:audio/wav;base64,AA', seconds: 1.5 } } } });
  const cues = cuesOf(srtOf(v));
  const starts = sceneStarts(scenes);
  const spoken = cues.find((c) => c.lines.join(' ').includes('first of June'));
  ok('the voice\'s own words are the subtitle', !!spoken && !cues.some((c) => c.lines.join(' ') === 'Apply before June.'), cues);
  ok('from where the voice starts, inside its scene', spoken && spoken.from >= ms(starts[1]) && spoken.from < ms(starts[1]) + 1000, [spoken?.from, ms(starts[1])]);
  ok('for as long as it speaks', spoken && spoken.to - spoken.from === 1500, spoken && spoken.to - spoken.from);
  ok('a scene without a voice still has its narration, in its window', cues[0].lines.join(' ') === 'Welcome.' && cues[0].from === 0 && cues[0].to === ms(starts[1]), cues[0]);
  const off = cuesOf(srtOf(video(scenes, { audio: { narrate: false } })));
  ok('with narration switched off, the words on screen instead', off.map((c) => c.lines.join(' ')).join('|') === 'Open day|Apply now', off.map((c) => c.lines.join(' ')));
}
{
  const empty = video([scene('gallery', 3, {}), scene('image', 3, { caption: '  ' })]);
  ok('a video with no words has no subtitles', srtOf(empty) === '');
  ok('and says so', hasWords(empty) === false);
  ok('one with words does', hasWords(video([scene('kinetic', 3, { text: 'Hello' })])) === true);
  ok('no scenes, no subtitles', srtOf(video([])) === '');
}
{
  // Every kind gives its words; a hand-edited scene missing fields gives what it has.
  const v = video([]);
  const words = (s) => wordsOf(s, v);
  ok('timeline: dated events', words(scene('timeline', 4, { heading: 'History', events: [{ when: '1992', text: 'Founded' }] })).join('|') === 'History|1992: Founded');
  ok('compare: each side with its points', words(scene('compare', 4, { heading: 'Then and now', left: { title: 'Then', points: ['One room'] }, right: { title: 'Now', points: ['Ten', 'Labs'] } })).join('|') === 'Then and now|Then — One room|Now — Ten · Labs');
  ok('people: name and role', words(scene('people', 4, { heading: 'Team', people: [{ name: 'Dr Sara', role: 'Dean' }, { name: 'Ali' }] })).join('|') === 'Team|Dr Sara — Dean|Ali');
  ok('logo: the brand name and the tagline', words(scene('logo', 3, { tagline: 'Since 1992' })).join('|') === 'Smile|Since 1992');
  ok('qr: the heading and the address', words(scene('qr', 3, { heading: 'Apply', url: 'uod.ac' })).join('|') === 'Apply|uod.ac');
  ok('steps are numbered', words(scene('steps', 4, { heading: 'How', steps: ['Call', 'Come'] })).join('|') === 'How|1. Call|2. Come');
  ok('chart bars with the unit', words(scene('chart', 4, { heading: 'Growth', bars: [{ label: '2023', value: 40 }], unit: '%' })).join('|') === 'Growth|2023: 40 %');
  ok('quote with its author', words(scene('quote', 4, { quote: 'Smile.', author: 'Us' })).join('|') === 'Smile.|— Us');
  ok('missing fields are skipped, not "undefined"', !words(scene('bullets', 3, { heading: 'X', points: [null, 3, 'ok'] })).join('|').includes('undefined'));
  ok('an unknown kind still gives its heading', words({ id: 'x', kind: 'future', seconds: 3, transition: 'fade', heading: 'Later' }).join('|') === 'Later');
}

// ── the storyboard backup ─────────────────────────────────────────────────
{
  const pic = { src: 'data:image/jpeg;base64,AAAA', credit: 'Photo by A, CC BY', source: 'Openverse', query: 'dental clinic' };
  const v = video([scene('title', 3, { title: 'Hi', picture: pic }), scene('gallery', 3, { pictures: [pic, pic] })], {
    brand: { name: 'Smile', logo: 'DATA:image/png;base64,BBBB', primary: '#112233' },
    audio: { music: { src: 'data:audio/mpeg;base64,CCCC', title: 'Tune', credit: 'X', source: 'Y', license: 'CC0' }, voice: { s1: { text: 'Hi', src: 'data:audio/wav;base64,DD', seconds: 1 } } },
  });
  const json = storyboardOf(v, Date.UTC(2026, 8, 25));
  const back = JSON.parse(json);
  ok('it is JSON that parses back', typeof back === 'object');
  ok('with no data: URL anywhere, in any case', !/data:/i.test(json), json.match(/data:[^"]{0,20}/gi));
  ok('it says what it is and when', back.kind === 'video storyboard' && back.version === 1 && back.saved === '2026-09-25T00:00:00.000Z');
  ok('every word is kept', back.video.title === 'Dental clinic' && back.video.scenes[0].title === 'Hi');
  ok('each picture keeps its credit, source and search words', back.video.scenes[0].picture.credit === pic.credit && back.video.scenes[0].picture.query === 'dental clinic' && !('src' in back.video.scenes[0].picture));
  ok('a list of pictures keeps every entry', back.video.scenes[1].pictures.length === 2);
  ok('the brand keeps its colours, not its logo', back.video.brand.primary === '#112233' && !('logo' in back.video.brand));
  ok('the music keeps its credit, not its sound', back.video.audio.music.credit === 'X' && !('src' in back.video.audio.music));
  ok('the narration keeps its words, not its voice', back.video.audio.voice.s1.text === 'Hi' && !('src' in back.video.audio.voice.s1));
  ok('the video itself is untouched', v.brand.logo.startsWith('DATA:') && v.scenes[0].picture.src.startsWith('data:'));
  ok('it ends with a newline', json.endsWith('}\n'));
}

// ── sound ─────────────────────────────────────────────────────────────────
{
  const said = [{ id: 'n1', kind: 'kinetic', seconds: 3, transition: 'fade', text: 'Hi', narration: 'Hello there.' }];
  const voice = { n1: { text: 'Hello there.', src: 'data:audio/wav;base64,AA', seconds: 1 } };
  ok('no audio, no sound', hasAudio(video(said)) === false);
  ok('music is sound', hasAudio(video(said, { audio: { music: { src: 'data:audio/mpeg;base64,AA', title: 't', credit: 'c', source: 's', license: 'l' } } })) === true);
  ok('a narration voice is sound', hasAudio(video(said, { audio: { narrate: true, voice } })) === true);
  ok('a voice kept while narration is off is not — it would be a silent track', hasAudio(video(said, { audio: { narrate: false, voice } })) === false);
  ok('narrate switched on without a voice yet is not', hasAudio(video(said, { audio: { narrate: true, voice: {} } })) === false);
}

// ── sizes ─────────────────────────────────────────────────────────────────
ok('three resolutions, 4K named as such', RESOLUTIONS.map(resolutionName).join() === '720p,1080p,4K');
ok('three bitrates', BITRATES.join() === 'medium,high,very-high');
ok('720p of a wide film is 1280 × 720', JSON.stringify(sizeAt('landscape', '720p')) === '{"width":1280,"height":720}');
ok('4K of a vertical one is 2160 × 3840', JSON.stringify(sizeAt('portrait', '2160p')) === '{"width":2160,"height":3840}');
ok('1080p of a square one is 1080 × 1080', JSON.stringify(sizeAt('square', '1080p')) === '{"width":1080,"height":1080}');
ok('every size is even, as H.264 needs', ['landscape', 'portrait', 'square'].every((f) => RESOLUTIONS.every((r) => {
  const s = sizeAt(f, r);
  return s.width % 2 === 0 && s.height % 2 === 0 && Math.ceil(1080 * scaleOf(r)) === Math.min(s.width, s.height);
})));
ok('each shape has a tag for its file name', SHAPE_TAG.landscape === '16x9' && SHAPE_TAG.portrait === '9x16' && SHAPE_TAG.square === '1x1');

// ── the poster's frame ────────────────────────────────────────────────────
{
  const v = video([scene('kinetic', 2, { text: 'a' }), scene('title', 4, { title: 'b' }), scene('outro', 2, { headline: 'c' })]);
  const s = sceneStarts(v.scenes);
  ok('the title scene\'s middle by default', posterFrame(v) === s[1] + 60, [posterFrame(v), s[1] + 60]);
  ok('or the middle of the scene chosen', posterFrame(v, 2) === s[2] + 30);
  ok('the first scene\'s when there is no title', posterFrame(video([scene('kinetic', 2, { text: 'a' })])) === 30);
  ok('a scene out of range means the default', posterFrame(v, 9) === posterFrame(v));
  ok('no scenes, frame 0', posterFrame(video([])) === 0);
}

// ── file names ────────────────────────────────────────────────────────────
{
  ok('the title, then the extension', fileNameFor({ title: 'Dental clinic' }, 'mp4') === 'Dental clinic.mp4');
  ok('with a shape tag', fileNameFor({ title: 'Dental clinic' }, 'mp4', '9x16') === 'Dental clinic 9x16.mp4');
  ok('Arabic stays Arabic', fileNameFor({ title: 'عيادة الأسنان' }, 'webm') === 'عيادة الأسنان.webm');
  ok('Sorani keeps ڕ ێ ۆ and the ZWNJ', fileNameFor({ title: 'ڕێکلامی\u200Cکلینیک' }, 'png') === 'ڕێکلامی\u200Cکلینیک.png');
  ok('Badini keeps ڤ', fileNameFor({ title: 'ڤیدیۆیا نوو' }, 'srt') === 'ڤیدیۆیا نوو.srt');
  const bad = fileNameFor({ title: '../../etc/passwd: "a" <b> | c? * \\ d\u0000e' }, 'json');
  ok('nothing a file system reads as a path or refuses', !/[\\/:*?"<>|\u0000]/.test(bad.slice(0, -5)) && bad.endsWith('.json'), bad);
  ok('an empty title is "video"', fileNameFor({ title: '  ?? ' }, 'mp4') === 'video.mp4');
  ok('a Windows device name is not a file name', fileNameFor({ title: 'CON' }, 'mp4') === 'CON_.mp4');
  const long = fileNameFor({ title: 'word '.repeat(40) }, 'mp4', '16x9');
  ok('at most eighty characters, cut where a word ends', Array.from(long).length <= 80 && long.endsWith('word 16x9.mp4'), long);
}

// ── the write request ─────────────────────────────────────────────────────
{
  const calls = [];
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (cmd, args, options) => { calls.push({ cmd, args, options }); return '/Users/a/Downloads/عيادة (2).mp4'; } } };
  const bytes = new Uint8Array([0, 0, 0, 8, 102, 116, 121, 112]);
  const got = await writeVideoFile('/Users/a/Downloads/عيادة.mp4', bytes, { unique: true });
  ok('it calls export_write_video', calls[0].cmd === 'export_write_video');
  ok('with the bytes as the whole body', calls[0].args === bytes);
  ok('the path percent-encoded in x-path', calls[0].options.headers['x-path'] === encodeURIComponent('/Users/a/Downloads/عيادة.mp4'));
  ok('and x-unique for a download', calls[0].options.headers['x-unique'] === '1');
  ok('and returns where Rust wrote it', got === '/Users/a/Downloads/عيادة (2).mp4');
  await writeVideoFile('/Users/a/Movies/x.mp4', bytes);
  ok('a Save as… replaces, so it sends no x-unique', !('x-unique' in calls[1].options.headers));
  ok('text is sent as UTF-8', new TextDecoder().decode(textBytes('ڤ')) === 'ڤ' && textBytes('ڤ').length === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
