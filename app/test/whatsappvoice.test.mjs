// Transcribing a voice note, and where the audio goes.
//
// Two things are held here. The first is ordinary: the request is shaped the
// way an OpenAI-compatible service expects, and the words come back out of
// whatever it answers with.
//
// The second is the one that matters. This feature takes a recording of
// somebody's voice off this machine and posts it to a third party. The rule
// `providers.ts` states — a key is only ever sent to the URL it was entered
// beside — has to hold for the audio as well as for the key, and the button
// must not exist at all when there is nowhere it could honestly send it. A
// Transcribe button that quietly falls back to the built-in gateway would be
// audio going somewhere the person never chose, and the gateway answers a
// transcription request with a 404 anyway, so the person would learn nothing
// from the failure either.
import {
  endpointOf, modelFor, textFrom, transcriberIn, transcriptNote, uploadHeaders,
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
