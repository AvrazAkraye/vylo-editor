// Video sound: music from Openverse's audio index, a voice from the person's
// own speech provider, and one timing for the voice, the captions and the mix.
//
// What matters: only tracks whose licence allows a (possibly commercial)
// derivative are offered, from hosts whose bytes a webview may read, and
// never a sound effect or a pronunciation; a search is one GET with no
// headers; the voice's key goes to its own provider's address and nowhere
// else; every line is placed where the composition places its scene, scenes
// grow to fit their voice and never past twenty seconds; the mix puts each
// sample where it belongs (the voice at its frame, the music ducked under it,
// looped and faded); the captions reveal whole words in time; and the
// narration the model writes is read back clean, in the video's own letters.
// The fixtures are real Openverse answers measured from this machine and cut
// down; requests go to fakes, so nothing here touches a socket.
import {
  MOODS, moodFor, audioSearchUrl, fromOpenverseAudio, rankTracks, searchMusic, fetchTrackBytes, looksLikeMp3,
  toDataUrl, dataUrlBytes, trackOf, musicCredit, wikimediaMp3, MusicError, musicVolumeOf, DEFAULT_MUSIC_VOLUME,
  sceneStarts, lineWindows, fitScenesToVoice, linesOver, soundPlan, hasSound, planKey, fingerprint,
  mixDown, frameSamples, encodeWav, captionPages, captionAt, narrationPrompt, parseNarration, cleanLine, wordBudget,
  speakerFor, speakLine, speechUrl, staleVoices, voiceForScenes, VOICE_LEAD, VOICE_GAP, VOICE_TAIL, DUCK, MAX_TRACK_BYTES,
} from '../.test-build/videomix.js';
import { durationInFrames, TRANSITION_FRAMES } from '../.test-build/video.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const failure = async (p) => { try { await p; return null; } catch (e) { return e; } };

// ── fixtures (real responses, trimmed) ────────────────────────────────────

// Openverse, q=electronic music and q=upbeat corporate, license=cc0,pdm,by,by-sa, page_size=20,
// six and four of twenty results, fields cut to the ones read. Measured: the API sends
// access-control-allow-origin: *; cdn.freesound.org and upload.wikimedia.org send *;
// prod-1.storage.jamendo.com echoes the caller's origin.
const ovElectronic = {"result_count": 240, "page_size": 20, "results": [{"title": "electronic music loop 001", "foreign_landing_url": "https://freesound.org/people/frankum/sounds/255585", "url": "https://cdn.freesound.org/previews/255/255585_2305278-hq.mp3", "creator": "frankum", "license": "by", "license_version": "4.0", "provider": "freesound", "source": "freesound", "category": null, "filesize": 1048648, "filetype": "mp3", "duration": 45473, "mature": false, "unstable__sensitivity": []}, {"title": "Electronic music", "foreign_landing_url": "https://www.jamendo.com/track/1479595", "url": "https://prod-1.storage.jamendo.com/?trackid=1479595&format=mp32", "creator": "iNDEX", "license": "by-sa", "license_version": "3.0", "provider": "jamendo", "source": "jamendo", "category": "music", "filesize": null, "filetype": "mp32", "duration": 356000, "mature": false, "unstable__sensitivity": []}, {"title": "[Drums] electronic music snare", "foreign_landing_url": "https://freesound.org/people/waveplaySFX/sounds/222061", "url": "https://cdn.freesound.org/previews/222/222061_1676145-hq.mp3", "creator": "waveplaySFX", "license": "cc0", "license_version": "1.0", "provider": "freesound", "source": "freesound", "category": null, "filesize": 8832, "filetype": "mp3", "duration": 619, "mature": false, "unstable__sensitivity": []}, {"title": "Beethoven Meets Electronic Music - A Fusion of Classical and Modern Sounds (AI-generated)", "foreign_landing_url": "https://commons.wikimedia.org/w/index.php?curid=153723240", "url": "https://upload.wikimedia.org/wikipedia/commons/2/2b/Beethoven_Meets_Electronic_Music_-_A_Fusion_of_Classical_and_Modern_Sounds_%28AI-generated%29.ogg", "creator": "A Boy on a Trail", "license": "by", "license_version": "3.0", "provider": "wikimedia_audio", "source": "wikimedia_audio", "category": null, "filesize": 5330291, "filetype": "ogx", "duration": 261526, "mature": false, "unstable__sensitivity": []}, {"title": "LL-Q652 (ita)-XANA000-ethno electronic music", "foreign_landing_url": "https://commons.wikimedia.org/w/index.php?curid=133390259", "url": "https://upload.wikimedia.org/wikipedia/commons/1/1e/LL-Q652_%28ita%29-XANA000-ethno_electronic_music.wav", "creator": "Speaker: XANA000 Recorder: XANA000", "license": "cc0", "license_version": "1.0", "provider": "wikimedia_audio", "source": "wikimedia_audio", "category": "pronunciation", "filesize": 191276, "filetype": "wav", "duration": 1992, "mature": false, "unstable__sensitivity": []}, {"title": "Variations on electronic music", "foreign_landing_url": "https://commons.wikimedia.org/w/index.php?curid=115161826", "url": "https://upload.wikimedia.org/wikipedia/commons/e/e9/Variations_on_electronic_music.wav", "creator": "Calebramey", "license": "by-sa", "license_version": "4.0", "provider": "wikimedia_audio", "source": "wikimedia_audio", "category": null, "filesize": 43857058, "filetype": "wav", "duration": 114185, "mature": false, "unstable__sensitivity": []}]};
const ovCorporate = {"result_count": 9, "page_size": 20, "results": [{"title": "Upbeat Corporate", "foreign_landing_url": "https://www.jamendo.com/track/1670486", "url": "https://prod-1.storage.jamendo.com/?trackid=1670486&format=mp32", "creator": "Soundrider/Dope", "license": "by", "license_version": "3.0", "provider": "jamendo", "source": "jamendo", "category": "music", "filesize": null, "filetype": "mp32", "duration": 100000, "mature": false, "unstable__sensitivity": []}, {"title": "Tropicorp Advertisement", "foreign_landing_url": "https://freesound.org/people/code_box/sounds/561190", "url": "https://cdn.freesound.org/previews/561/561190_10962806-hq.mp3", "creator": "code_box", "license": "cc0", "license_version": "1.0", "provider": "freesound", "source": "freesound", "category": null, "filesize": 905986, "filetype": "mp3", "duration": 37647, "mature": false, "unstable__sensitivity": []}, {"title": "Rafael Krux - Inspiring Advertising - Upbeat Summer Corporate (cc-by) (filmmusic)", "foreign_landing_url": "https://commons.wikimedia.org/w/index.php?curid=84678522", "url": "https://upload.wikimedia.org/wikipedia/commons/3/38/Rafael_Krux_-_Inspiring_Advertising_-_Upbeat_Summer_Corporate_%28cc-by%29_%28filmmusic%29.mp3", "creator": "Rafael Krux", "license": "by", "license_version": "4.0", "provider": "wikimedia_audio", "source": "wikimedia_audio", "category": null, "filesize": 6567310, "filetype": "mp3", "duration": 164153, "mature": false, "unstable__sensitivity": []}, {"title": "'Origami' (Chill Electro-Jazz CC-BY) - Scott Buckley", "foreign_landing_url": "https://commons.wikimedia.org/w/index.php?curid=178126412", "url": "https://upload.wikimedia.org/wikipedia/commons/4/4e/%27Origami%27_%28Chill_Electro-Jazz_CC-BY%29_-_Scott_Buckley.oga", "creator": "Scott Buckley", "license": "by", "license_version": "4.0", "provider": "wikimedia_audio", "source": "wikimedia_audio", "category": null, "filesize": 33155491, "filetype": "ogx", "duration": 189230, "mature": false, "unstable__sensitivity": []}]};

const FPS = 30;
const scene = (id, seconds, transition = 'fade', extra = {}) => ({ id, kind: 'kinetic', text: `Scene ${id}`, seconds, transition, ...extra });
const video = (scenes, audio = {}, more = {}) => ({
  id: 'v', created: 0, updated: 0, request: 'A promo for the University of Duhok', title: 'UoD', lang: 'en', format: 'landscape',
  style: 'modern', seconds: 30, brand: {}, scenes, stage: 'ready', audio, ...more,
});
const reply = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300, status, statusText: status === 200 ? 'OK' : 'Err',
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  arrayBuffer: async () => (body instanceof Uint8Array ? body : new Uint8Array(0)).buffer,
});
const mp3Bytes = (n = 64) => { const b = new Uint8Array(n); b.set([0x49, 0x44, 0x33, 3]); return b; };

// ── moods and the search URL ──────────────────────────────────────────────

ok('six moods, each with a label and words to search', MOODS.length === 6 && MOODS.every((m) => m.label && m.queries.length >= 1)
  && same(MOODS.map((m) => m.id), ['corporate', 'piano', 'cinematic', 'electronic', 'acoustic', 'inspiring']));
ok('a style suggests a mood', moodFor({ style: 'elegant' }).id === 'piano' && moodFor({ style: 'bold' }).id === 'electronic' && moodFor({ style: 'nope' }).id === 'corporate');
{
  const u = new URL(audioSearchUrl('calm "piano" <b>music</b>', 99));
  ok('the search: Openverse audio, reusable licences only, nothing mature, at most 20, clean words',
    u.origin + u.pathname === 'https://api.openverse.org/v1/audio/' && u.searchParams.get('license') === 'cc0,pdm,by,by-sa'
    && u.searchParams.get('mature') === 'false' && u.searchParams.get('page_size') === '20' && u.searchParams.get('q') === 'calm piano music', u.search);
}

// ── reading an answer ─────────────────────────────────────────────────────

const el = fromOpenverseAudio(ovElectronic);
ok('effects, pronunciations and sub-twenty-second clips are dropped', !el.some((c) => /snare|LL-Q652/i.test(c.title)), el.map((c) => c.title));
ok('Freesound, Jamendo and Commons tracks are kept', el.length === 4 && same(el.map((c) => c.where), ['Freesound', 'Jamendo', 'Wikimedia Commons', 'Wikimedia Commons']), el.map((c) => c.where));
ok('a Commons Ogg or WAV is fetched as the MP3 Commons transcodes it to',
  el[2].url === 'https://upload.wikimedia.org/wikipedia/commons/transcoded/2/2b/Beethoven_Meets_Electronic_Music_-_A_Fusion_of_Classical_and_Electronic_Sounds.ogg/Beethoven_Meets_Electronic_Music_-_A_Fusion_of_Classical_and_Electronic_Sounds.ogg.mp3'
  || /\/transcoded\/2\/2b\/[^/]+\.og[gx]\/[^/]+\.og[gx]\.mp3$/.test(el[2].url), el[2].url);
ok('a Commons size is not the MP3\'s and is not kept', el[2].bytes === undefined && el[3].bytes === undefined);
ok('a Jamendo track is its mp32 stream', el[1].url === 'https://prod-1.storage.jamendo.com/?trackid=1479595&format=mp32' && el[1].music === true);
ok('seconds from the index\'s milliseconds', el[0].seconds === 45.5 && el[1].seconds === 356);
ok('the credit line is the pictures\' shape', el[0].credit === 'electronic music loop 001 — ' + el[0].creator + ', CC BY 3.0 (Freesound via Openverse)'
  || /^electronic music loop 001 — .+, CC BY [\d.]+ \(Freesound via Openverse\)$/.test(el[0].credit), el[0].credit);
const co = fromOpenverseAudio(ovCorporate);
ok('a Commons MP3 original is fetched as it is', co.some((c) => c.url.startsWith('https://upload.wikimedia.org/wikipedia/commons/3/38/') && c.url.endsWith('.mp3')), co.map((c) => c.url));
{
  const base = ovCorporate.results[0];
  const odd = { results: [
    { ...base, url: 'https://example.com/a.mp3', filetype: 'mp3' },
    { ...base, mature: true },
    { ...base, license: 'by-nc' },
    { ...base, unstable__sensitivity: ['user_reported_sensitive'] },
    { ...base, title: 'Cinematic Impact Boom' },
    { ...base, duration: 900000 },
    { ...base, url: 'http://prod-1.storage.jamendo.com/?trackid=1&format=mp32' },
    { ...base, source: 'freesound', filetype: 'wav', url: 'https://cdn.freesound.org/previews/1/1.wav' },
    { ...base, filesize: MAX_TRACK_BYTES + 1, source: 'freesound', filetype: 'mp3', url: 'https://cdn.freesound.org/previews/1/1-hq.mp3' },
  ] };
  ok('other hosts, mature, NonCommercial, flagged, effects, too long, plain http, not MP3, too big: all dropped', fromOpenverseAudio(odd).length === 0, fromOpenverseAudio(odd).map((c) => c.title));
}
ok('junk is no tracks', same(fromOpenverseAudio(null), []) && same(fromOpenverseAudio({ results: [null, 3, 'x'] }), []));
ok('wikimediaMp3: originals only', wikimediaMp3('https://upload.wikimedia.org/wikipedia/commons/0/02/A.ogg') === 'https://upload.wikimedia.org/wikipedia/commons/transcoded/0/02/A.ogg/A.ogg.mp3'
  && wikimediaMp3('https://upload.wikimedia.org/wikipedia/commons/0/02/A.mp3') === 'https://upload.wikimedia.org/wikipedia/commons/0/02/A.mp3'
  && wikimediaMp3('https://upload.wikimedia.org/wikipedia/commons/0/02/A.jpg') === null && wikimediaMp3('https://example.com/wikipedia/commons/0/02/A.ogg') === null);

// ── ranking ───────────────────────────────────────────────────────────────

{
  const c = (title, extra = {}) => ({ url: `https://cdn.freesound.org/previews/${title}.mp3`, title, creator: 'x', credit: '', source: '', license: 'CC0', where: 'Freesound', seconds: 60, music: true, ...extra });
  const r = rankTracks([c('noise thing', { music: false }), c('a song'), c('a song'), c('short one', { seconds: 21 }), c('unknown', { seconds: undefined })], 60);
  ok('ranking: music of the film\'s length first, the same track once, unknown lengths and non-music last',
    same(r.map((x) => x.title), ['a song', 'short one', 'unknown', 'noise thing']), r.map((x) => x.title));
}

// ── searching (a fake GET) ────────────────────────────────────────────────

const calls = [];
const fakeGet = (route) => async (...args) => { calls.push(args); return route(args[0]); };
{
  calls.length = 0;
  const found = await searchMusic(['upbeat corporate', 'corporate music'], { seconds: 30, get: fakeGet(() => reply(200, ovCorporate)), enough: 3 });
  ok('one query is enough when it leaves enough tracks', calls.length === 1 && found.length >= 3, calls.length);
  calls.length = 0;
  await searchMusic(['upbeat corporate', 'corporate music'], { seconds: 30, get: fakeGet(() => reply(200, ovCorporate)), enough: 50 });
  ok('the next words are tried when it does not', calls.length === 2 && calls[1][0].includes('q=corporate%20music'), calls.map((c) => c[0]));
  ok('a search is a GET with no init object: no header, no preflight', calls.every((c) => c.length === 2 && (c[1] === undefined || c[1] instanceof AbortSignal)));
  const busy = await failure(searchMusic('piano', { seconds: 30, get: fakeGet(() => reply(429, {})) }));
  ok('a 429 is "busy"', busy instanceof MusicError && busy.trouble === 'busy');
  const off = await failure(searchMusic('piano', { seconds: 30, get: async () => { throw new TypeError('Failed to fetch'); } }));
  ok('no connection is "offline"', off instanceof MusicError && off.trouble === 'offline');
  const ac = new AbortController();
  ac.abort();
  const stopped = await failure(searchMusic('piano', { seconds: 30, signal: ac.signal, get: fakeGet(() => reply(200, ovCorporate)) }));
  ok('a stop is an AbortError', stopped?.name === 'AbortError');
}

// ── fetching ──────────────────────────────────────────────────────────────

{
  const cand = { url: 'https://cdn.freesound.org/previews/1/1-hq.mp3' };
  const got = await fetchTrackBytes(cand, { get: fakeGet(() => reply(200, mp3Bytes(100))) });
  ok('a track\'s bytes, checked', got.length === 100 && looksLikeMp3(got));
  const big = await failure(fetchTrackBytes(cand, { get: fakeGet(() => reply(200, mp3Bytes(10), { 'content-length': String(MAX_TRACK_BYTES + 1) })) }));
  ok('too big by its header: refused before reading', big?.trouble === 'too-big');
  const known = await failure(fetchTrackBytes({ ...cand, bytes: MAX_TRACK_BYTES + 1 }, { get: fakeGet(() => reply(200, mp3Bytes())) }));
  ok('too big by the index: never asked', known?.trouble === 'too-big');
  const html = await failure(fetchTrackBytes(cand, { get: fakeGet(() => reply(200, new TextEncoder().encode('<html>nope</html>'))) }));
  ok('an HTML page is not audio', html?.trouble === 'not-audio');
  ok('an MPEG frame sync is audio', looksLikeMp3(new Uint8Array([0xFF, 0xFB, 0x90, 0x64])) && !looksLikeMp3(new Uint8Array([0, 1, 2, 3])));
}
{
  const bytes = new Uint8Array(100_003).map((_, i) => (i * 31) & 255);
  const url = toDataUrl(bytes, 'audio/mpeg');
  const back = dataUrlBytes(url);
  ok('data: URL round trip, past the chunk size', url.startsWith('data:audio/mpeg;base64,') && back.length === bytes.length && back.every((b, i) => b === bytes[i]));
  ok('only base64 data: URLs are read', dataUrlBytes('data:text/plain,hi') === null && dataUrlBytes('https://x/y') === null && dataUrlBytes(42) === null);
  const cand = el[0];
  const tr = trackOf(cand, url, 'electronic music', 45.51);
  ok('the kept track: its src, credit, licence, source and measured seconds', tr.src === url && tr.credit === cand.credit && tr.license === cand.license && tr.source === cand.source && tr.seconds === 45.5 && tr.query === 'electronic music');
  ok('musicCredit', musicCredit({ audio: { music: tr } }) === cand.credit && musicCredit({}) === undefined);
}
ok('music volume: the default when unset, held to 0..1', musicVolumeOf(undefined) === DEFAULT_MUSIC_VOLUME && musicVolumeOf({ musicVolume: 3 }) === 1 && musicVolumeOf({ musicVolume: -1 }) === 0 && musicVolumeOf({ musicVolume: 0.25 }) === 0.25);

// ── timing ────────────────────────────────────────────────────────────────

{
  const scenes = [scene('a', 3), scene('b', 4, 'none'), scene('c', 3, 'slide'), scene('d', 2, 'none')];
  const starts = sceneStarts(scenes);
  ok('scene starts: each scene\'s frames less the transition overlap, a cut overlapping nothing', same(starts, [0, 90 - 15, 75 + 120, 195 + 90 - 15]), starts);
  const last = starts[3] + 60;
  ok('and the last one ends where the composition does', last === durationInFrames({ scenes }), [last, durationInFrames({ scenes })]);
  const w = lineWindows({ scenes });
  ok('a line opens when its scene is half in, plus a breath', w[0].start === VOICE_LEAD && w[1].start === 75 + Math.round(TRANSITION_FRAMES / 2) + VOICE_LEAD && w[2].start === 195 + VOICE_LEAD, w.map((x) => x.start));
  ok('and closes a gap before the next opens; the last before the end', w[0].end === w[1].start - VOICE_GAP && w[3].end === durationInFrames({ scenes }) - VOICE_TAIL, w);
}
{
  const voice = (seconds, text = 'said') => ({ text, src: 'data:audio/mpeg;base64,AAAA', seconds });
  const v = video([scene('a', 3), scene('b', 3), scene('c', 3, 'none')], { narrate: true, voice: { a: voice(2), b: voice(5.2), c: voice(30) } });
  const over = linesOver(v);
  ok('lines that do not fit are found, by how much', !over.has('a') && over.get('b') > 2 && over.get('c') > 20, [...over]);
  const fit = fitScenesToVoice(v);
  ok('a scene grows to fit its voice, in tenths', fit.longer.some((l) => l.id === 'b' && l.from === 3 && l.to > 5.2 && Math.abs(l.to * 10 - Math.round(l.to * 10)) < 1e-9), fit.longer);
  ok('never past twenty seconds, and the rest is reported', fit.scenes[2].seconds === 20 && fit.over.length === 1 && fit.over[0].id === 'c', fit.over);
  ok('after fitting, only the line that cannot fit runs over', same([...linesOver({ ...v, scenes: fit.scenes }).keys()], ['c']));
  ok('a scene that fits is left alone', fit.scenes[0].seconds === 3 && !fit.longer.some((l) => l.id === 'a'));
  const tight = fitScenesToVoice(video([scene('a', 3)], { voice: { a: voice(2.3) } }));
  ok('the tightest fit leaves no line over', linesOver({ scenes: tight.scenes, audio: { voice: { a: voice(2.3) } } }).size === 0, tight.scenes[0].seconds);
}

// ── the plan ──────────────────────────────────────────────────────────────

{
  const music = { src: 'data:audio/mpeg;base64,QUJD', title: 't', credit: 'c', source: 's', license: 'CC0' };
  const voiceA = { text: 'Hello there', src: 'data:audio/mpeg;base64,REVG', seconds: 1.5 };
  const scenes = [scene('a', 3, 'fade', { narration: 'Hello there' }), scene('b', 4, 'none', { narration: 'Welcome to the University of Duhok today' })];
  const off = soundPlan(video(scenes, { music, voice: { a: voiceA } }));
  ok('narration off: the music plays, no line is heard or captioned', off.music && off.lines.length === 0 && hasSound(video(scenes, { music })));
  const on = soundPlan(video(scenes, { narrate: true, music, musicVolume: 0.4, voice: { a: voiceA } }));
  ok('narration on: the voiced line with its audio, the other as words only, timed by its words', on.lines.length === 2
    && on.lines[0].src === voiceA.src && on.lines[0].seconds === 1.5 && on.lines[1].src === '' && Math.abs(on.lines[1].seconds - 7 / 2.5) < 1e-9, on.lines);
  ok('the music at its volume', on.music.volume === 0.4 && on.frames === durationInFrames({ scenes }));
  ok('nothing to hear: no music and no voice', !hasSound(video(scenes, { narrate: true })) && !hasSound(video([], {})));
  ok('a voice for a scene that is gone is not placed', soundPlan(video([scene('z', 3)], { narrate: true, voice: { a: voiceA } })).lines.length === 0);
  const k1 = planKey(on);
  ok('the plan key changes with the volume and the timing, not otherwise', k1 === planKey(soundPlan(video(scenes, { narrate: true, music, musicVolume: 0.4, voice: { a: voiceA } })))
    && k1 !== planKey(soundPlan(video(scenes, { narrate: true, music, musicVolume: 0.5, voice: { a: voiceA } })))
    && k1 !== planKey(soundPlan(video([{ ...scenes[0], seconds: 4 }, scenes[1]], { narrate: true, music, musicVolume: 0.4, voice: { a: voiceA } }))));
  ok('a fingerprint is short and tells long strings apart', fingerprint('x'.repeat(100000)).length < 24 && fingerprint('a' + 'x'.repeat(99999)) !== fingerprint('b' + 'x'.repeat(99999)));
}

// ── the mix ───────────────────────────────────────────────────────────────

{
  const rate = 8000;
  const tone = (secs, f, amp = 0.5) => { const n = Math.round(secs * rate); const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * f * i) / rate); return a; };
  const rms = (a, from, to) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, to - from)); };
  const scenes = [scene('a', 4), scene('b', 4, 'none'), scene('c', 4, 'none')];
  const voice = { text: 'x', src: 'VOICE', seconds: 1 };
  const plan = soundPlan(video(scenes, { narrate: true, music: { src: 'MUSIC', title: '', credit: '', source: '', license: '' }, musicVolume: 1, voice: { b: voice } }));
  const voicePcm = { rate, channels: [new Float32Array(rate).fill(0.25)] };
  const musicPcm = { rate, channels: [tone(2, 440), tone(2, 440)] };
  const pcm = (s) => (s === 'VOICE' ? voicePcm : s === 'MUSIC' ? musicPcm : undefined);
  const voiceOnly = mixDown({ ...plan, music: undefined }, pcm, rate);
  const s0 = Math.round((plan.lines[0].start / FPS) * rate);
  ok('the voice starts on its frame, to the sample', voiceOnly[0][s0 - 1] === 0 && Math.abs(voiceOnly[0][s0] - 0.25) < 1e-6 && Math.abs(voiceOnly[1][s0 + 100] - 0.25) < 1e-6, [s0, voiceOnly[0][s0]]);
  ok('and lasts as long as it is', Math.abs(voiceOnly[0][s0 + rate - 1] - 0.25) < 1e-6 && voiceOnly[0][s0 + rate] === 0);
  const n = Math.round((plan.frames / FPS) * rate);
  ok('the mix is the film\'s length, in two channels', voiceOnly.length === 2 && voiceOnly[0].length === n);

  const full = mixDown(plan, pcm, rate);
  const musicOnly = full[0].map((x, i) => x - voiceOnly[0][i]);
  const at = (sec) => Math.round(sec * rate);
  const loud = rms(musicOnly, at(2), at(3));
  const under = rms(musicOnly, s0 + at(0.35), s0 + at(0.85));
  ok('the music ducks under the voice, by about ten decibels', under < loud * (DUCK + 0.05) && under > loud * (DUCK - 0.05) && loud > 0.05, { under, loud });
  ok('and comes back after it', rms(musicOnly, s0 + at(1.8), s0 + at(2.3)) > loud * 0.9);
  ok('and fades in from silence', Math.abs(full[0][0]) < 1e-6 && rms(full[0], 0, 200) < rms(full[0], rate, rate + 2000));
  const endRms = rms(full[0], n - 200, n);
  ok('and out to silence at the end', endRms < 0.02, endRms);
  const looped = rms(musicOnly, at(7), at(7.5));
  ok('a two-second track loops to fill a twelve-second film', looped > loud * 0.9, looped);
  const seam = rms(musicOnly, at(1.4), at(2.1));
  ok('and its joins are crossfaded, not dropped', seam > loud * 0.6, seam);
  ok('nothing clips', full.every((ch) => ch.every((x) => Math.abs(x) <= 1)));
  const hot = mixDown({ ...plan, music: undefined, lines: [{ ...plan.lines[0], src: 'HOT' }] }, (s) => (s === 'HOT' ? { rate, channels: [new Float32Array(rate).fill(3)] } : undefined), rate);
  ok('a sum over full scale is bent under 1, not wrapped', hot[0][s0 + 10] > 0.9 && hot[0][s0 + 10] <= 1);
  const cut = mixDown({ ...plan, music: undefined, lines: [{ ...plan.lines[0], end: plan.lines[0].start + 6 }] }, pcm, rate);
  const stop = Math.round(((plan.lines[0].start + 6) / FPS) * rate);
  ok('a line is stopped where its window ends, faded, not clicked', cut[0][stop] === 0 && cut[0][stop - 1] < 0.01 && cut[0][stop - 120] > 0.1 && cut[0][stop - 120] < 0.2 && Math.abs(cut[0][stop - 300] - 0.25) < 1e-6, [cut[0][stop - 1], cut[0][stop - 120], cut[0][stop]]);
  ok('a src that did not decode is silent, not an error', mixDown(plan, () => undefined, rate)[0].every((x) => x === 0));

  let total = 0;
  let good = true;
  for (let f = 0; f < plan.frames; f++) {
    const s = frameSamples(full, f, FPS, rate);
    total += s.length / 2;
    if (!(s instanceof Int16Array)) good = false;
  }
  ok('frame slices cover every sample once, as 16-bit stereo', good && total === n, [total, n]);
  const f0 = frameSamples(full, Math.ceil(s0 * FPS / rate) + 1, FPS, rate);
  ok('and carry the samples', f0.some((x) => x !== 0));

  const wav = encodeWav(voiceOnly, rate);
  const dv = new DataView(wav.buffer);
  const tag = (at) => String.fromCharCode(...wav.slice(at, at + 4));
  ok('a WAV: RIFF, PCM, stereo, 16-bit, the rate, the right size', tag(0) === 'RIFF' && tag(8) === 'WAVE' && tag(36) === 'data'
    && dv.getUint16(20, true) === 1 && dv.getUint16(22, true) === 2 && dv.getUint32(24, true) === rate && dv.getUint16(34, true) === 16
    && dv.getUint32(40, true) === n * 4 && wav.length === 44 + n * 4);
  ok('with the samples in it', Math.abs(dv.getInt16(44 + s0 * 4, true) - Math.round(0.25 * 32767)) <= 1);
}

// ── captions ──────────────────────────────────────────────────────────────

{
  const pages = captionPages('One two three four five six seven eight nine ten', 4, 100);
  ok('pages of at most so many words', same(pages, [['One', 'two', 'three', 'four'], ['five', 'six', 'seven', 'eight'], ['nine', 'ten']]), pages);
  ok('and so many letters', captionPages('aaaaaaaaaa bbbbbbbbbb cccccccccc', 7, 22).length === 2);
  ok('a new page after a sentence ends', same(captionPages('We teach. We build. We grow together here.', 7, 100), [['We', 'teach.', 'We', 'build.'], ['We', 'grow', 'together', 'here.']]) || captionPages('We teach, we build, we grow. Together we lead.', 7, 100)[0].slice(-1)[0].endsWith('.'));
  const ar = captionPages('جامعة دهوك، مكان للعلم والمعرفة. انضم إلينا اليوم', 5, 40);
  ok('Arabic words are kept whole, and an Arabic comma or full stop can end a page', ar.flat().join(' ') === 'جامعة دهوك، مكان للعلم والمعرفة. انضم إلينا اليوم' && ar.every((p) => p.length <= 5), ar);
  ok('no words, no pages', same(captionPages(''), []) && same(captionPages(null), []));

  const line = { id: 'a', index: 0, text: 'one two three four', src: 'x', start: 30, end: 150, seconds: 2 };
  ok('no caption before the line', captionAt([line], 29, FPS) === null);
  const first = captionAt([line], 30, FPS);
  ok('the first word as the line starts', first && first.shown === 1 && same(first.page, ['one', 'two', 'three', 'four']));
  const mid = captionAt([line], 30 + 31, FPS);
  ok('about half the words half way through', mid && mid.shown === 3, mid);
  const done = captionAt([line], 30 + 60 + 5, FPS);
  ok('every word once it has been said, held a moment', done && done.shown === 4);
  ok('then gone', captionAt([line], 30 + 60 + 16, FPS) === null);
  ok('never past its window', captionAt([{ ...line, end: 50 }], 50, FPS) === null && captionAt([{ ...line, end: 50 }], 49, FPS) !== null);
  const paged = captionAt([{ ...line, text: 'a b c d e f g h' }], 30 + 55, FPS, (t) => captionPages(t, 4, 100));
  ok('a long line turns its pages', paged && paged.pageIndex === 1 && same(paged.page, ['e', 'f', 'g', 'h']), paged);
  const two = [line, { ...line, id: 'b', index: 1, text: 'next line', start: 160, end: 300 }];
  ok('the line being said is the one shown', captionAt(two, 170, FPS)?.lineIndex === 1 && captionAt(two, 40, FPS)?.lineIndex === 0);
}

// ── narration, written by the model ───────────────────────────────────────

{
  const v = video([
    { id: 's1', kind: 'title', title: 'University of Duhok', subtitle: 'Since 1992', seconds: 3, transition: 'fade', picture: { src: 'data:image/jpeg;base64,SECRET', credit: 'c', source: 's', query: 'q' }, narration: 'old line' },
    { id: 's2', kind: 'bullets', heading: 'Why study here', points: ['Research', 'Community'], seconds: 5, transition: 'none' },
    { id: 's3', kind: 'outro', headline: 'UoD', cta: 'Apply now', url: 'uod.ac', seconds: 3, transition: 'none' },
  ], {}, { lang: 'ckb', brief: { subjects: ['University of Duhok'], facts: [
    { label: 'Founded', value: '1992', source: 'Wikidata', url: 'https://www.wikidata.org', use: true },
    { label: 'Students', value: '99999', source: 'Wikipedia', url: 'https://x', use: false },
  ], pictures: [], at: 0 } });
  const p = narrationPrompt(v);
  ok('the prompt: Sorani, in Kurdish letters, spoken, JSON only', /Central Kurdish \(Sorani\)/.test(p.user) && /ی ک ە ێ ۆ ڕ ڵ/.test(p.system) && /reply with JSON and nothing else/i.test(p.system));
  ok('each scene with its budget of words', /1\. \(title, at most \d+ words\)/.test(p.user) && /3\. \(outro, at most \d+ words\)/.test(p.user));
  ok('the budget is about two and a half words a second of its window', wordBudget(v, 1) === Math.floor(((lineWindows(v)[1].end - lineWindows(v)[1].start) / FPS) * 2.5));
  ok('only the facts the person kept', p.user.includes('Founded: 1992') && !p.user.includes('99999'));
  ok('no ids, pictures or old narration go to the model', !p.user.includes('SECRET') && !p.user.includes('"id"') && !p.user.includes('old line') && !p.user.includes('s1'));
  ok('the request is fenced as a description', p.user.includes('<<<\nA promo for the University of Duhok\n>>>'));
  ok('no invented numbers, no stage directions', /State no figure/.test(p.system) && /no stage directions/.test(p.system));

  const got = parseNarration('Sure! {"lines":[{"scene":2,"narration":"<b>فێربوون</b> لێرە دەست پێ دەکات"},{"scene":1,"narration":"Narrator: [music] زانكۆی دهۆك **چاوەڕێتە**"},{"scene":9,"narration":"ghost"}]}', v);
  ok('lines by scene number, in any order; a scene that does not exist is dropped', got && Object.keys(got).length === 2 && got.s2 && got.s1, got);
  ok('markup, labels and directions are cleaned out, and Kurdish is in its own letters', got.s1 === 'زانکۆی دهۆک چاوەڕێتە' && got.s2 === 'فێربوون لێرە دەست پێ دەکات', got);
  ok('a list of strings, in order', same(parseNarration('["one", "two", "three"]', v), { s1: 'one', s2: 'two', s3: 'three' }));
  ok('{"narration": [...]} and keyed by number', same(parseNarration('{"narration":["a","b"]}', v), { s1: 'a', s2: 'b' }) && same(parseNarration('{"1":"x","3":"z"}', v), { s1: 'x', s3: 'z' }));
  ok('by id when the model echoes one', same(parseNarration('{"lines":[{"id":"s3","text":"close"}]}', v), { s3: 'close' }));
  ok('nothing usable is null', parseNarration('I cannot help with that.', v) === null && parseNarration('{"lines":[]}', v) === null && parseNarration(null, v) === null);
  ok('Arabic keeps Arabic letters', cleanLine('جامعة دهوک', 'ar') === 'جامعة دهوك' && cleanLine('"Quoted line."', 'en') === 'Quoted line.');
  ok('invisible marks are gone, the Kurdish non-joiner stays', cleanLine('a\u200Fb\u202Ec\u200Cd', 'ckb') === 'abc\u200Cd');
  ok('a line is capped', cleanLine('word '.repeat(200), 'en').length <= 440);
}

// ── the voice ─────────────────────────────────────────────────────────────

{
  const openai = { id: 'p1', name: 'OpenAI', baseUrl: 'https://api.openai.com', wire: 'openai', key: 'sk-one', models: [] };
  const other = { id: 'p2', name: 'Claude', baseUrl: 'https://api.anthropic.com/v1', wire: 'anthropic', key: 'sk-two', models: [] };
  ok('no provider that can speak: no speaker', speakerFor([other], null) === null && speakerFor([{ ...openai, key: '' }], null) === null);
  const sp = speakerFor([other, openai], JSON.stringify({ model: 'tts-1-hd', voice: 'nova', speed: 1.1 }), 'onyx');
  ok('the speaker: the OpenAI-shaped provider, WhatsApp\'s model and speed, the video\'s voice', sp.provider === openai && sp.speech.model === 'tts-1-hd' && sp.speech.speed === 1.1 && sp.speech.voice === 'onyx');
  ok('without a video voice, the stored one', speakerFor([openai], JSON.stringify({ voice: 'sage' })).speech.voice === 'sage');
  const posts = [];
  const bytes = await speakLine(sp, '  مرحبا  ', { post: async (url, init) => { posts.push([url, init]); return reply(200, mp3Bytes(20)); } });
  const [url, init] = posts[0];
  const body = JSON.parse(init.body);
  ok('one POST, to that provider\'s own /v1/audio/speech', posts.length === 1 && url === 'https://api.openai.com/v1/audio/speech' && init.method === 'POST');
  ok('a base stored without /v1 gets it, one with it does not get it twice', speechUrl({ baseUrl: 'http://localhost:8880' }) === 'http://localhost:8880/v1/audio/speech'
    && speechUrl({ baseUrl: 'https://api.example.com/v1/' }) === 'https://api.example.com/v1/audio/speech');
  ok('with that provider\'s key and no other', init.headers.Authorization === 'Bearer sk-one' && !JSON.stringify(init).includes('sk-two'));
  ok('asking for MP3, in the chosen voice, of the words', body.response_format === 'mp3' && body.voice === 'onyx' && body.model === 'tts-1-hd' && body.input === 'مرحبا' && body.speed === 1.1);
  ok('the bytes come back', bytes.length === 20);
  const err = await failure(speakLine(sp, 'x', { post: async () => reply(401, { error: { message: 'Incorrect API key provided' } }) }));
  ok('a refusal says what the provider said', err && /401/.test(err.message) && /Incorrect API key/.test(err.message), err?.message);
  const empty = await failure(speakLine(sp, '   ', { post: async () => reply(200, mp3Bytes()) }));
  ok('nothing to say is not sent', empty && posts.length === 1);
}
{
  const v = video([scene('a', 3, 'fade', { narration: 'new words' }), scene('b', 3, 'fade', { narration: 'same' })],
    { voice: { a: { text: 'old words', src: 'x', seconds: 1 }, b: { text: 'same', src: 'y', seconds: 1 }, gone: { text: 'z', src: 'z', seconds: 1 } } });
  ok('a voice whose words changed is stale', same([...staleVoices(v)], ['a']));
  ok('lines for scenes that are gone are dropped', same(Object.keys(voiceForScenes(v)), ['a', 'b']));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
