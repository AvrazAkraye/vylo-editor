// Speaking, in WhatsApp.
//
// Two sources, because they are two different jobs: the browser's own
// `speechSynthesis` reads a message aloud for nothing, and a real endpoint is
// needed only when there have to be *bytes* — a voice note has to be attached
// to something, and `speechSynthesis` speaks to the speakers and hands back
// nothing at all.
//
// The part worth testing hardest is the language. This inbox is Arabic,
// Sorani, Badini and English in one conversation, and an English voice reading
// Arabic is somewhere between an accent and nonsense.
import {
  BLANK_SPEECH, SEND_FORMAT, SPOKEN_MAX, canSpeak, chunks, langOf, readSpeech,
  scriptOf, speakerIn, speechBody, speechHeaders, speechPath, voiceFor,
  worthSpeaking, writeSpeech,
} from '../.test-build/whatsapptts.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (xs, ys) => JSON.stringify(xs) === JSON.stringify(ys);
const prov = (over = {}) => ({
  id: 'p1', name: 'OpenAI', baseUrl: 'https://api.example.com/v1',
  wire: 'openai', key: 'sk-x', models: [], ...over,
});

// ── the settings ──────────────────────────────────────────────────────────
ok('nothing stored is the defaults', same(readSpeech(null), BLANK_SPEECH));
ok('and rubbish is, never a throw', (() => (
  same(readSpeech('{'), BLANK_SPEECH) && same(readSpeech('[]'), BLANK_SPEECH)
  && same(readSpeech('"x"'), BLANK_SPEECH)
))());
ok('what was stored comes back', (() => {
  const s = readSpeech(writeSpeech({ model: 'tts-1-hd', voice: 'nova', speed: 1.2 }));
  return s.model === 'tts-1-hd' && s.voice === 'nova' && s.speed === 1.2;
})());
ok('a missing field falls back rather than emptying', (() => {
  const s = readSpeech(JSON.stringify({ voice: 'nova' }));
  return s.model === BLANK_SPEECH.model && s.voice === 'nova';
})());
ok('a blank field does too', readSpeech(JSON.stringify({ model: '   ' })).model === BLANK_SPEECH.model);
// Outside the range the endpoint refuses the whole request, so a stored value
// that has gone wrong would cost the feature rather than one playback.
ok('speed is clamped, not trusted', (() => (
  readSpeech(JSON.stringify({ speed: 99 })).speed === 4
  && readSpeech(JSON.stringify({ speed: 0 })).speed === 0.25
  && readSpeech(JSON.stringify({ speed: 'fast' })).speed === 1
))());
ok('enough to ask with', canSpeak(BLANK_SPEECH));
ok('and not, with a field missing',
   !canSpeak({ ...BLANK_SPEECH, voice: '' }) && !canSpeak({ ...BLANK_SPEECH, model: ' ' }));

// ── which provider ────────────────────────────────────────────────────────
ok('an OpenAI-shaped provider can speak', speakerIn([prov()])?.id === 'p1');
ok('one with no key cannot', speakerIn([prov({ key: '' })]) === null);
ok('nor one with no address', speakerIn([prov({ baseUrl: '' })]) === null);
ok('and neither can the other wire', speakerIn([prov({ wire: 'anthropic' })]) === null);
ok('none at all is null', speakerIn([]) === null);
ok('the first that could is taken', speakerIn([prov({ id: 'a' }), prov({ id: 'b' })])?.id === 'a');

// ── where the request goes, and with what ─────────────────────────────────
// The rule this module inherits: a key is only ever sent to the address it
// was entered beside.
ok('the path is built from the provider and nothing else',
   speechPath({ baseUrl: 'https://api.example.com/v1' }) === 'https://api.example.com/v1/audio/speech');
ok('a trailing slash does not double up',
   speechPath({ baseUrl: 'https://api.example.com/v1/' }) === 'https://api.example.com/v1/audio/speech');
ok('the key rides in the header', speechHeaders({ key: 'sk-x' }).Authorization === 'Bearer sk-x');
{
  const b = speechBody('hello', BLANK_SPEECH);
  ok('the body names the model, the words and the voice',
     b.model === 'tts-1' && b.input === 'hello' && b.voice === 'alloy', b);
  ok('and the format a voice note needs', b.response_format === SEND_FORMAT);
  // A speed of one is the voice's own pace; sending it says nothing and is
  // one more field for a strict server to have an opinion about.
  ok('a speed of one is not sent', !('speed' in b));
  ok('any other speed is', speechBody('x', { ...BLANK_SPEECH, speed: 1.5 }).speed === 1.5);
  ok('the format can be asked for', speechBody('x', BLANK_SPEECH, 'opus').response_format === 'opus');
}

// ── which script ──────────────────────────────────────────────────────────
ok('English is latin', scriptOf('hello there') === 'latin');
ok('Arabic is arabic', scriptOf('مرحبا كيف حالك') === 'arabic');
ok('Sorani is arabic script, which is what it is', scriptOf('سڵاو چۆنی باشی') === 'arabic');
ok('Badini too', scriptOf('سلاڤ چاوایی') === 'arabic');
// The first strong character is what `dir=auto` uses and it is the wrong rule
// here: this is an Arabic message that opens in Latin.
ok('a message is what most of it is, not what it starts with',
   scriptOf('OK تمام شكرا جزيلا يا صديقي') === 'arabic');
ok('and the other way round',
   scriptOf('شكرا thanks very much for all of your help today') === 'latin');
ok('digits and punctuation alone are neither',
   scriptOf('123 !!! ???') === 'other' && scriptOf('') === 'other');
ok('a non-string is neither, not a crash',
   [null, undefined, 42].every((x) => scriptOf(x) === 'other'));

ok('arabic asks for an Arabic voice', langOf('مرحبا') === 'ar');
ok('latin for an English one', langOf('hello') === 'en');
// Only ever a hint: a machine with no Arabic voice gets its default rather
// than silence.
ok('and neither asks for nothing in particular', langOf('123') === '');

// ── which of the system's voices ──────────────────────────────────────────
const VOICES = [
  { name: 'Daniel', lang: 'en-GB' },
  { name: 'Majed', lang: 'ar-SA' },
  { name: 'Tarik', lang: 'ar_EG' },
  { name: 'Samantha', lang: 'en-US' },
];
ok('an Arabic message gets an Arabic voice', voiceFor('مرحبا', VOICES)?.name === 'Majed');
ok('an English one gets an English voice', voiceFor('hello', VOICES)?.name === 'Daniel');
// `ar-SA` and `ar-EG` read Arabic equally well for this purpose, and
// preferring one is a claim about dialect a chat app has no basis for.
ok('an underscore tag still matches', voiceFor('مرحبا', [{ name: 'Tarik', lang: 'ar_EG' }])?.name === 'Tarik');
ok('an exact tag wins over a family match',
   voiceFor('hello', [{ name: 'X', lang: 'en-AU' }, { name: 'Y', lang: 'en' }])?.name === 'Y');
ok('nothing suitable is the system default', voiceFor('مرحبا', [{ name: 'D', lang: 'en-GB' }]) === null);
ok('no voices at all is too', voiceFor('hello', []) === null);
ok('and a message with no script asks for nothing', voiceFor('123', VOICES) === null);

// ── cutting a long one ────────────────────────────────────────────────────
ok('nothing is no pieces', same(chunks(''), []) && same(chunks('   '), []));
ok('a short message is one piece', same(chunks('hello'), ['hello']));
ok('and is trimmed', same(chunks('  hello  '), ['hello']));
ok('a non-string is no pieces', [null, undefined, 42].every((x) => chunks(x).length === 0));
{
  const long = `${'a'.repeat(60)}. ${'b'.repeat(60)}. ${'c'.repeat(60)}.`;
  const cut = chunks(long, 100);
  ok('a long one is cut into pieces that fit', cut.every((c) => c.length <= 100), cut.map((c) => c.length));
  // Nothing may be silently dropped: what goes in comes back out.
  ok('and nothing is lost', cut.join(' ').replace(/\s+/g, '') === long.replace(/\s+/g, ''),
     { in: long.length, out: cut.join(' ').length });
  ok('cut at a sentence end where there is one', cut[0].endsWith('.'), cut[0].slice(-12));
}
{
  // No sentence ends at all: a space is the next best place.
  const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
  const cut = chunks(words, 60);
  ok('with no full stops it cuts at a space', cut.every((c) => !/\bword\d*$/.test(c) || c.endsWith(words.slice(-6))
    || !c.includes('  ')), cut);
  ok('every piece still fits', cut.every((c) => c.length <= 60));
  ok('and nothing is lost there either', cut.join(' ') === words);
}
{
  // A single word longer than the whole allowance is a pasted URL, and
  // cutting one of those anywhere is equally wrong.
  const url = 'x'.repeat(250);
  const cut = chunks(url, 100);
  ok('one enormous word is cut anyway rather than refused', cut.length === 3, cut.map((c) => c.length));
  ok('and still adds back up', cut.join('') === url);
}
ok('the cap is what the endpoint takes', SPOKEN_MAX > 0 && SPOKEN_MAX <= 4096);
ok('a message exactly at the cap is one piece', chunks('a'.repeat(SPOKEN_MAX)).length === 1);
ok('and one over it is two', chunks('a'.repeat(SPOKEN_MAX + 1)).length === 2);

// ── worth offering at all ─────────────────────────────────────────────────
// Reading "ok" aloud takes longer to start than to hear.
ok('a sentence is worth reading', worthSpeaking('are you coming tonight'));
ok('a tick is not', !worthSpeaking('ok') && !worthSpeaking('👍'.slice(0, 1)));
ok('nor is nothing', !worthSpeaking('') && !worthSpeaking('   '));
ok('nor a non-string', [null, undefined, 42].every((x) => !worthSpeaking(x)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
