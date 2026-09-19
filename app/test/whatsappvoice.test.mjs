// Transcribing a voice note, and where the audio goes.
//
// Two things are held here. The first is ordinary: the request is shaped the
// way an OpenAI-compatible service expects, and the words come back out of
// whatever it answers with.
//
// The second is the one that matters. This feature takes a recording of
// somebody's voice off this machine and posts it to a third party. The rule
// `providers.ts` states — a key is only ever sent to the URL it was entered
// beside — has to hold for the audio as well as for the key, and `transcriberIn`
// must return null rather than reach for whatever else is configured. A
// Transcribe button that quietly fell back to the built-in gateway would be
// audio going somewhere the person never chose; the gateway answers a
// transcription request with a 404 (verified against it), so they would not
// even learn anything from the failure.
//
// Null now draws a route to Settings rather than nothing at all. Drawing
// nothing was defensible — a control that cannot work teaches nothing — and it
// was still the wrong call: the voice note went to the model as "not read" and
// the panel never said why, or that anything could be done about it. What must
// stay true is that null means *no upload*, which is what these assertions
// hold; what is drawn over it is a question of manners.
import {
  BLANK_VOICE, VOICE_LANGS, VOICE_URL, acceptsName, backendFor, endpointOf,
  formFor, jobIdFrom, jobPath, jobState, langOf, modeOf, modelFor, readVoice,
  textFrom, transcribePath, transcriberIn, transcriptNote, uploadHeaders,
  voiceForm, voiceHeaders, voiceReady, writeVoice,
} from '../.test-build/whatsappvoice.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
};

const p = (over = {}) => ({
  id: 'p1', name: 'OpenAI', baseUrl: 'https://api.openai.com', wire: 'openai',
  key: 'sk-test', models: [], ...over,
});

// ── who may be asked ──────────────────────────────────────────────────────
{
  ok('an OpenAI-shaped provider can', transcriberIn([p()])?.name === 'OpenAI');
  // Anthropic's API has no transcription endpoint at all.
  ok('an Anthropic-shaped one cannot', transcriberIn([p({ wire: 'anthropic' })]) === null);
  ok('one with no key cannot', transcriberIn([p({ key: '' })]) === null);
  ok('one with no address cannot', transcriberIn([p({ baseUrl: '' })]) === null);
  ok('and no providers at all means no', transcriberIn([]) === null);
  // The button is drawn from this. Null must mean "no button", never "fall
  // back to whatever else is lying around".
  ok('the first usable one is chosen',
     transcriberIn([p({ wire: 'anthropic', name: 'Claude' }), p({ name: 'Groq' })])?.name === 'Groq');
}

// ── where it goes, and with what ──────────────────────────────────────────
{
  ok('the endpoint sits beside chat completions',
     endpointOf(p()) === 'https://api.openai.com/v1/audio/transcriptions');
  ok('a provider with a path prefix keeps it',
     endpointOf(p({ baseUrl: 'http://localhost:8080/api' })) === 'http://localhost:8080/api/v1/audio/transcriptions');

  // The key rule: the address and the key come out of one record. Nothing here
  // takes them separately, so nothing here can pair them wrongly.
  const h = uploadHeaders(p());
  ok('the key travels as a bearer token', h.authorization === 'Bearer sk-test');
  // The browser writes the multipart boundary. A content-type we set would
  // have no boundary in it and the upload would be unparseable.
  ok('and no content-type is set by us', !('content-type' in h) && !('Content-Type' in h));

  ok('whisper-1 by default', modelFor(p()) === 'whisper-1');
  // Somebody who listed a transcription model on a provider has already said
  // which one they want; Groq and local servers do not answer to whisper-1.
  ok("the person's own model wins", modelFor(p({ models: ['whisper-large-v3'] })) === 'whisper-large-v3');
  ok('a transcribe-shaped name counts too',
     modelFor(p({ models: ['gpt-4o', 'gpt-4o-transcribe'] })) === 'gpt-4o-transcribe');
  ok('and a chat-only list falls back',
     modelFor(p({ models: ['gpt-4o', 'o3'] })) === 'whisper-1');
}

// ── what comes back ───────────────────────────────────────────────────────
{
  ok('the ordinary shape', textFrom({ text: '  hello there  ' }) === 'hello there');
  ok('a bare string', textFrom('hello there') === 'hello there');
  // Some local servers answer in the chat shape. Cheap to accept.
  ok('the chat shape', textFrom({ choices: [{ message: { content: 'hello' } }] }) === 'hello');
  ok('nothing is empty', textFrom(null) === '' && textFrom({}) === '');
  ok('an error body is empty', textFrom({ error: { message: 'no such model' } }) === '');
  ok('and empty stays empty, not undefined', textFrom({ text: '   ' }) === '');
}

// ── how the words are introduced ──────────────────────────────────────────
{
  const line = transcriptNote('meet me at six', 'OpenAI');
  // A machine's guess at speech, in a language nothing here checks, must not
  // arrive looking like something the person typed.
  ok('it says it was a voice note', line.includes('voice note'));
  ok('it names what transcribed it', line.includes('OpenAI'));
  ok('and it carries the words', line.includes('meet me at six'));
}

// ── which language ────────────────────────────────────────────────────────
//
// Whisper detects a language well on a clear minute and badly on the thing a
// voice note actually is: eight seconds, a phone microphone, a room with other
// people in it. Naming the language turns the guess into a given.
{
  ok('auto is the default for anything unrecognised',
     langOf(null) === 'auto' && langOf('') === 'auto' && langOf('klingon') === 'auto');
  ok('a stored choice survives', langOf('ar') === 'ar' && langOf('en') === 'en');
  ok('Arabic is offered', VOICE_LANGS.includes('ar'));
  // Both Kurdishes, which is the whole reason Vylo Voice is preferred: it has
  // an engine for each, and the Whisper behind the OpenAI-shaped services has
  // neither. A previous release said Kurdish could not be done, which was true
  // of that backend and not of this one.
  ok('and both Kurdishes', VOICE_LANGS.includes('ckb') && VOICE_LANGS.includes('kmr'));

  const read = (form) => {
    const out = {};
    for (const [k, v] of form.entries()) out[k] = typeof v === 'string' ? v : `(file:${v.name})`;
    return out;
  };
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/ogg' });

  const auto = read(formFor(blob, 'n.oga', 'whisper-1'));
  // Absent is how the API spells automatic. "auto" is not a language code and
  // a strict server would refuse it.
  ok('auto sends no language at all', !('language' in auto), JSON.stringify(auto));
  ok('and still sends the model and the file', auto.model === 'whisper-1' && auto.file === '(file:n.oga)');

  const ar = read(formFor(blob, 'n.oga', 'whisper-1', 'ar'));
  ok('Arabic sends language=ar', ar.language === 'ar');
  ok('English sends language=en', read(formFor(blob, 'n.oga', 'whisper-1', 'en')).language === 'en');
  ok('the response format is the plain one', ar.response_format === 'json');
  // The filename matters: several servers pick the decoder from the extension.
  ok('the file keeps its name', ar.file === '(file:n.oga)');
}

// ── Vylo Voice ───────────────────────────────────────────────────────────
//
// The service queues a recording and transcribes it on a worker, so this is a
// conversation with a server rather than one request. The shapes below are
// read off its own source: `POST /api/transcribe` answers with a job id, and
// `/api/jobs/{id}` carries `queued` -> `processing` -> `done` | `failed`.
{
  const v = { baseUrl: VOICE_URL, key: 'vsk_test', lang: 'ckb', mode: 'accurate' };

  ok('the default is the service that speaks Kurdish', BLANK_VOICE.baseUrl === VOICE_URL);
  ok('a key is what makes it usable', voiceReady(v) && !voiceReady({ ...v, key: '' }));
  ok('and an address is too', !voiceReady({ ...v, baseUrl: '' }));

  ok('a stored connection survives the round trip',
     readVoice(writeVoice(v)).key === 'vsk_test' && readVoice(writeVoice(v)).lang === 'ckb');
  ok('rubbish is the empty form, not a throw', readVoice('{oh no')?.baseUrl === VOICE_URL);
  ok('a trailing slash is trimmed', readVoice('{"baseUrl":"https://x.dev/"}').baseUrl === 'https://x.dev');
  ok('an unknown language falls back to auto', readVoice('{"lang":"klingon"}').lang === 'auto');
  ok('and an unknown mode to fast', modeOf('thorough') === 'fast' && modeOf('accurate') === 'accurate');

  ok('the paths are the service\'s own',
     transcribePath(v) === `${VOICE_URL}/api/transcribe`
     && jobPath(v, 'abc') === `${VOICE_URL}/api/jobs/abc`);
  // Both credentials this service takes arrive the same way; the vsk_ prefix
  // is what tells a durable key from a dashboard session.
  ok('the key travels as a bearer token', voiceHeaders(v).authorization === 'Bearer vsk_test');
  ok('and we set no content-type', !('content-type' in voiceHeaders(v)));

  const read = (form) => {
    const out = {};
    for (const [k, val] of form.entries()) out[k] = typeof val === 'string' ? val : `(file:${val.name})`;
    return out;
  };
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp4' });
  const form = read(voiceForm(blob, 'note.m4a', v));
  ok('the upload names the language', form.language === 'ckb');
  ok('and the effort', form.mode === 'accurate');
  // Unlike the OpenAI shape, `auto` is a real value here -- it is in the
  // server's own language list -- so it is sent rather than omitted.
  ok('auto is sent, because this server knows that word',
     read(voiceForm(blob, 'n.m4a', { ...v, lang: 'auto' })).language === 'auto');
  ok('the file keeps its name', form.file === '(file:note.m4a)');

  // The server checks the filename and answers 422 for anything else, which is
  // why the converted voice note's extension is corrected before it gets here.
  ok('an m4a is accepted', acceptsName('3AA31B6BE9F9771D98AA.m4a'));
  ok('so is an oga and an mp3', acceptsName('a.oga') && acceptsName('a.mp3'));
  ok('a jpeg is not', !acceptsName('a.jpeg'));
  ok('and a file with no extension is not', !acceptsName('recording'));

  ok('a job id is read back', jobIdFrom({ id: 'abc123', status: 'queued' }) === 'abc123');
  ok('and nothing sensible is empty', jobIdFrom(null) === '' && jobIdFrom({}) === '');

  ok('queued is not done', jobState({ status: 'queued', progress: 0 }).done === false);
  ok('processing is not done', jobState({ status: 'processing', progress: 0.4 }).done === false);
  ok('and it carries progress', jobState({ status: 'processing', progress: 0.4 }).progress === 0.4);
  const done = jobState({ status: 'done', transcript: '  سڵاو، چۆنی  ' });
  ok('done carries the words, trimmed', done.done === true && done.text === 'سڵاو، چۆنی');
  // A translation was asked for, so it is the thing to show.
  ok('a translation wins when there is one',
     jobState({ status: 'done', transcript: 'x', translation: 'hello' }).text === 'hello');
  ok('silence is an answer, not a failure',
     jobState({ status: 'done', transcript: '' }).done === true
     && jobState({ status: 'done', transcript: '' }).text === '');
  const bad = jobState({ status: 'failed', error: 'the worker died' });
  ok('failed carries its reason', bad.done === true && bad.failed === 'the worker died');
  ok('and always says something', 'failed' in jobState({ status: 'failed' }));
  // A status this app has not heard of must read as "still running". Giving up
  // early would report silence for a recording that was about to arrive.
  ok('an unknown status keeps waiting', jobState({ status: 'reticulating' }).done === false);
  ok('and so does nothing at all', jobState(null).done === false);
}

// ── which backend ────────────────────────────────────────────────────────
{
  const configured = { baseUrl: VOICE_URL, key: 'vsk_x', lang: 'auto', mode: 'fast' };
  const openai = p();

  // Vylo Voice first when it is set up: it is the only one of the two with
  // Kurdish engines, and these conversations are in Kurdish.
  ok('Vylo Voice wins when it has a key', backendFor(configured, [openai]).kind === 'vylo');
  ok('a provider is the fallback', backendFor(BLANK_VOICE, [openai]).kind === 'openai');
  ok('and nothing configured is null', backendFor(BLANK_VOICE, []) === null);
  ok('a half-filled voice connection does not win',
     backendFor({ ...configured, key: '' }, [openai]).kind === 'openai');
  ok('the backend names itself for the dialog',
     backendFor(configured, []).name === 'Vylo Voice' && backendFor(BLANK_VOICE, [openai]).name === 'OpenAI');
}

// ── Kurdish must not be sent to a Whisper that cannot read it ─────────────
{
  const read = (form) => {
    const out = {};
    for (const [k, val] of form.entries()) out[k] = typeof val === 'string' ? val : `(file:${val.name})`;
    return out;
  };
  const blob = new Blob([new Uint8Array([1])], { type: 'audio/mp4' });
  // Whisper was not trained on Sorani or Badini; `ckb` would be refused or
  // answered with nonsense. Dropping to automatic at least makes the guess
  // visible as a guess.
  ok('Sorani is dropped on the OpenAI path',
     !('language' in read(formFor(blob, 'a.m4a', 'whisper-1', 'ckb'))));
  ok('Badini too', !('language' in read(formFor(blob, 'a.m4a', 'whisper-1', 'kmr'))));
  ok('but Arabic is sent', read(formFor(blob, 'a.m4a', 'whisper-1', 'ar')).language === 'ar');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
