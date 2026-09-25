// What the macOS bundle tells the system it needs.
//
// Dictation is the webview's `webkitSpeechRecognition`, which on macOS is
// Apple's speech service running inside this app. macOS will not let an app use
// the microphone or speech recognition unless its Info.plist says why — and
// without the keys it does not ask the person at all. WebKit refuses before
// requesting, because requesting without a reason would crash the app, and the
// refusal arrived on the page as the Web Speech `network` error.
//
// So for every release before this file existed, pressing the mic said
// "Dictation needs a connection, and there was none" to people who were online.
// Nothing failed: no test, no build, no log line — `tccd` recorded no request
// at all, because none was ever made. That is the reason for this check. The
// thing it guards is a file whose absence is silent.
import { readFileSync, existsSync } from 'fs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const PLIST = 'src-tauri/Info.plist';
const plist = existsSync(PLIST) ? readFileSync(PLIST, 'utf8') : '';

/** The <string> that follows a <key>, or null when the key is not there. */
const valueOf = (key) => {
  const m = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist);
  return m ? m[1].trim() : null;
};

ok('the bundle has an Info.plist for Tauri to merge', plist.length > 0, PLIST);
ok('and it is a property list', /<plist version="1\.0">[\s\S]*<dict>[\s\S]*<\/dict>[\s\S]*<\/plist>/.test(plist));

// The two keys, and they have to say something: macOS shows these strings in
// the permission dialog, and an empty one is a dialog with no reason in it.
for (const key of ['NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription']) {
  const v = valueOf(key);
  ok(`${key} is declared`, v !== null);
  ok(`${key} gives a reason a person can read`, v !== null && v.length >= 30, v);
}

// And the keys are needed only because dictation uses the engine that needs
// them. If dictation ever moves off Web Speech, this is where to notice that
// the permissions may be asking for something the app no longer does.
{
  const dictate = readFileSync('src/dictate.ts', 'utf8');
  ok('dictation still uses the webview speech engine these keys unlock',
     /webkitSpeechRecognition/.test(dictate));
}

// The honest-wording rule, held here because the dialog is the one place the
// person reads it before deciding: the listening is Apple's, which can use
// Apple's servers, so the speech reason must not promise it stays on the Mac.
ok('the speech reason does not promise the audio never leaves the Mac',
   !/(never leaves|stays on (this|your) mac|on-device only|offline)/i.test(valueOf('NSSpeechRecognitionUsageDescription') ?? ''));

// And the microphone reason says where a recording goes. The Slides chat
// records what is said and sends it to a transcription service
// (slidesvoice.ts); a reason that still said "nothing is recorded" would be the
// dialog telling the person something the app no longer does.
{
  const voice = existsSync('src/slidesvoice.ts') ? readFileSync('src/slidesvoice.ts', 'utf8') : '';
  const mic = valueOf('NSMicrophoneUsageDescription') ?? '';
  ok('the Slides chat still records with the microphone', /getUserMedia/.test(voice) && /MediaRecorder/.test(voice));
  ok('so the microphone reason says a recording goes to a transcription service', /transcription service/i.test(mic), mic);
  ok('and does not claim nothing is recorded', !/nothing is recorded/i.test(mic), mic);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
