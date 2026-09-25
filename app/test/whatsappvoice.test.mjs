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
  TARGETS, targetOf, voiceForm, voiceHeaders, voiceReady, writeVoice,
  NOTE_LANG_KEEP, SPOKEN, langFromText, micLang, noteLang, readNoteLangs, withNoteLang,
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
  const v = { baseUrl: VOICE_URL, key: 'vsk_test', lang: 'ckb', mode: 'accurate', translate: '' };

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
  // Both are kept and neither replaces the other -- an earlier draft returned
  // the translation in place of the transcript, which threw away the one of
  // the two that is closer to the recording.
  ok('a transcript is not replaced by its translation',
     jobState({ status: 'done', transcript: 'x', translation: 'hello' }).text === 'x');
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
  const configured = { baseUrl: VOICE_URL, key: 'vsk_x', lang: 'auto', mode: 'fast', translate: '' };
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

// ── translating as well ──────────────────────────────────────────────────
//
// The same endpoint does it, in the same pass, into any of four languages —
// including both Kurdishes, written in the Arabic-based script rather than
// Latin, which is the script these conversations are in.
{
  const base = { baseUrl: VOICE_URL, key: 'vsk_t', lang: 'ckb', mode: 'fast' };
  const read = (form) => {
    const out = {};
    for (const [k, val] of form.entries()) out[k] = typeof val === 'string' ? val : `(file:${val.name})`;
    return out;
  };
  const blob = new Blob([new Uint8Array([1])], { type: 'audio/mp4' });

  ok('four targets', TARGETS.length === 4);
  ok('Arabic among them', TARGETS.includes('ar'));
  ok('and both Kurdishes', TARGETS.includes('ckb') && TARGETS.includes('kmr'));
  ok('nothing is the empty choice', targetOf('') === '' && targetOf(null) === '');
  ok('and a language it cannot do is refused', targetOf('fr') === '' && targetOf('tr') === '');
  ok('a real target survives', targetOf('ar') === 'ar');
  ok('a stored one survives the round trip',
     readVoice(writeVoice({ ...base, translate: 'ar' })).translate === 'ar');
  ok('and a bad stored one becomes none',
     readVoice('{"translate":"elvish"}').translate === '');

  // The server refuses an unknown target rather than ignoring it, so '' must
  // not be sent as if it were a language.
  ok('no target, no field',
     !('translate_to' in read(voiceForm(blob, 'a.m4a', { ...base, translate: '' }))));
  ok('a target is sent', read(voiceForm(blob, 'a.m4a', { ...base, translate: 'ar' })).translate_to === 'ar');
  // Transcribing Sorani and translating it to Arabic is one request, and the
  // two fields are independent: the language is what was said, the target is
  // what to turn it into.
  const both = read(voiceForm(blob, 'a.m4a', { ...base, lang: 'ckb', translate: 'ar' }));
  ok('the said language and the target are separate',
     both.language === 'ckb' && both.translate_to === 'ar');

  // Both come back, and both are kept. Showing only the translation throws
  // away the one that is closer to the recording.
  const done = jobState({ status: 'done', transcript: 'سڵاو', translation: 'hello' });
  ok('the transcript is kept', done.text === 'سڵاو');
  ok('and so is the translation', done.translation === 'hello');
  ok('with no translation asked for it is empty',
     jobState({ status: 'done', transcript: 'سڵاو' }).translation === '');

  // The handover labels the translation as its own step rather than folding it
  // in as though it were what the person said.
  const note = transcriptNote('سڵاو', 'Vylo Voice', 'hello');
  ok('the note carries what was said', note.includes('سڵاو'));
  ok('and the translation, named as one', /\[translated\]: hello/.test(note), note);
  ok('and says nothing about translating when there was none',
     !transcriptNote('سڵاو', 'Vylo Voice').includes('translated'));
}

// ── which language a voice note is in ─────────────────────────────────────
// Left to the server, two seconds of Arabic came back as English in Latin
// letters. The chat's own writing names the language instead, and a person's
// correction for a chat outranks every guess.
{
  ok('Arabic writing means Arabic', langFromText(['السلام عليكم', 'كيف حالك اليوم؟']) === 'ar');
  ok('one ڤ in a long Arabic chat is still Arabic', langFromText(['شاهدت الڤيديو الذي أرسلته أمس وكان جميلاً جداً يا أخي العزيز']) === 'ar');
  ok('Sorani writing means Sorani', langFromText(['سڵاو، چۆنی؟', 'باشم سوپاس، ئەتۆ چۆنی']) === 'ckb');
  ok('Badini writing means Badini', langFromText(['ئەز دێ ئێم', 'هەڤالێ من، تو چاوا یی؟ ئەڤە چیە']) === 'kmr');
  ok('Kurdish with neither ڤ nor ڵ goes to the Kurdish the interface names', langFromText(['ئێمە دەچین'], 'kmr') === 'kmr');
  ok('one word of Kurdish is Kurdish', langFromText(['سڵاو']) === 'ckb');
  ok('and to Sorani when it names none', langFromText(['ئێمە دەچین']) === 'ckb');
  ok('Badini typed in Latin means Badini', langFromText(['Ez dê bêm, tu çawa yî?']) === 'kmr');
  ok('English stays the server’s guess', langFromText(['See you tomorrow at the office']) === 'auto');
  ok('so does a chat with nothing written', langFromText([]) === 'auto' && langFromText(['👍', '😂']) === 'auto');
  ok('a link is not writing', langFromText(['https://example.com/salam-alaikum-video']) === 'auto');
  ok('Arabic digits are not letters', langFromText(['٠١٢٣٤٥٦٧٨٩']) === 'auto');

  ok('the chat’s own choice comes first', noteLang({ chat: 'en', setting: 'kmr', texts: ['السلام عليكم'] }) === 'en');
  ok('then a setting that names a language', noteLang({ setting: 'kmr', texts: ['السلام عليكم'] }) === 'kmr');
  ok('then the chat’s writing', noteLang({ setting: 'auto', texts: ['السلام عليكم ورحمة الله'] }) === 'ar');
  ok('with the interface’s Kurdish for a tie', noteLang({ setting: 'auto', texts: ['ئێمە دەچین'], kurdish: 'kmr' }) === 'kmr');
  ok('a stored "auto" for a chat is no choice', noteLang({ chat: 'auto', setting: 'auto', texts: ['سڵاو'] }) === 'ckb');

  ok('the choices are the four languages', SPOKEN.join() === 'ar,ckb,kmr,en');
  const kept = readNoteLangs(JSON.stringify({ a: 'ar', b: 'kmr', c: 'auto', d: 'fr', '': 'en', e: 3 }));
  ok('a stored choice is repaired: only real languages, only named chats', JSON.stringify(kept) === JSON.stringify({ a: 'ar', b: 'kmr' }));
  ok('a broken record is no record', JSON.stringify(readNoteLangs('{')) === '{}' && JSON.stringify(readNoteLangs('[1]')) === '{}' && JSON.stringify(readNoteLangs(null)) === '{}');
  const moved = withNoteLang({ a: 'ar', b: 'kmr' }, 'a', 'en');
  ok('a new choice replaces the old and goes last', JSON.stringify(moved) === JSON.stringify({ b: 'kmr', a: 'en' }));
  let many = {};
  for (let i = 0; i < NOTE_LANG_KEEP + 25; i++) many = withNoteLang(many, `c${i}`, 'ar');
  ok('at most so many chats are remembered, the oldest dropped', Object.keys(many).length === NOTE_LANG_KEEP && !('c0' in many) && (`c${NOTE_LANG_KEEP + 24}` in many));

  ok('the Slides mic: a setting that names a language wins', micLang('en', 'ar', 'ckb') === 'en');
  ok('then the interface’s language', micLang('auto', 'kmr', 'ar') === 'kmr');
  ok('then the deck’s', micLang('auto', 'en', 'ar') === 'ar');
  ok('and English stays the server’s guess', micLang('auto', 'en', 'en') === 'auto' && micLang('auto') === 'auto');

  const heard = jobState({ status: 'done', transcript: 'x', detected_language: 'ar' });
  ok('a finished job says which language it heard', heard.done && heard.heard === 'ar');
  ok('and "auto" for one without an engine here', jobState({ status: 'done', transcript: 'x', detected_language: 'ur' }).heard === 'auto'
     && jobState({ status: 'done', transcript: 'x' }).heard === 'auto');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
