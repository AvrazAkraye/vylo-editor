import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { fill, type Lang } from './i18n';
import { explain } from './errors';
import type { EffortBook } from './effort';
import { generate, type Target } from './generate';
import type { Provider } from './providers';
import type { Deck, DeckTurn } from './slides';
import { MAX_OPS, applyOps, chatPrompt, keptChat, parseChat, MAX_SLIDES, type Change } from './slideschat';
import { Recorder, SpeechError, speechBackend, speechFileName, transcribe } from './slidesvoice';
import { Dictation, OFF as DICTATION_OFF, browserOpen, recognitionLang, speechAvailable, type State as DictationState } from './dictate';
import { langName, slideKindName, themeName } from './slidesnames';
import { findLogo } from './videoresearch';

/**
 * Talking to the slides: the Chat tab.
 *
 * Once a deck exists, the person says what they want — typed, or spoken into
 * the microphone — and the deck's own model answers with a sentence and a
 * list of operations (slideschat.ts). The app checks every operation and
 * applies the valid ones to the newest copy of the deck, all in one
 * `onChange`, which the panel records as one undo step; then it lists under
 * the answer what changed and what was skipped.
 *
 * ## Speaking
 *
 * The microphone records only between the press that starts it and the press
 * that ends it (slidesvoice.ts), and its button names the service the
 * recording goes to — Vylo Voice when it is set up, for its Sorani and Badini,
 * or an OpenAI-shaped provider. The words that come back are sent as the
 * person's message, marked as spoken, so the model reads them as what a speech
 * engine heard. With no such service, the webview's own dictation (dictate.ts)
 * writes what it hears into the box and sends it when the person stops — it
 * knows Arabic and English, not Kurdish, which is why it is the fallback.
 *
 * ## Nothing the model writes is run or rendered
 *
 * Its reply is shown as text (React escapes it — never HTML); its operations
 * are applied field by field through the deck's own repair. It can open a
 * slide or start the presentation, which only change the screen. It cannot
 * save: "save it" puts a button under the answer, and the person presses it.
 *
 * A message being answered lives outside React, like the panel's other runs,
 * so switching tabs does not lose it.
 */

type T = (s: string) => string;

interface Props {
  t: T;
  /** The interface language: what the webview's dictation listens for, when it is the one listening. */
  lang: Lang;
  deck: Deck;
  /** A change the chat made — recorded as one undo step. */
  onChange: (next: Partial<Deck>) => void;
  /** Open a slide in the editor. */
  onSelect: (id: string) => void;
  /** Start presenting from a slide, by its place in the deck. */
  onPresent: (at: number) => void;
  onSavePptx: () => void;
  onSavePdf: () => void;
  saving: boolean;
  locked: boolean;
  /** Whether a model can be asked at all (a key, a plan). */
  ready: boolean;
  target: Target;
  efforts: EffortBook;
  providers: readonly Provider[];
  /** Open Settings, where a transcription service is set up. */
  onSettings: () => void;
  /** The newest copy of the deck, wherever it was changed. */
  current: () => Deck | undefined;
}

// ── state that outlives the tab ───────────────────────────────────────────

interface Run {
  ctl: AbortController;
  message: string;
  spoken: boolean;
  started: number;
  chars: number;
  retry?: { attempt: number; of: number };
  /** Looking for a logo on the web, after the model answered. */
  logo?: boolean;
}

/** A message that could not be answered: said under it, with Try again. Not kept in the deck. */
interface Trouble { message: string; spoken: boolean; error: string }

const runs = new Map<string, Run>();
const troubles = new Map<string, Trouble>();
/** What the box holds, per deck, so a tab switch keeps a half-written message. */
const drafts = new Map<string, string>();
const listeners = new Set<() => void>();

function ping() {
  for (const l of listeners) l();
}

function useRuns() {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
}

function useSecond(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const i = window.setInterval(() => set((n) => n + 1), 1000);
    return () => window.clearInterval(i);
  }, [on]);
}

const newId = () => {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError';

/** Said by the run as a code, so the sentence is chosen where `t` is. */
const MOVED = 'slides-chat:moved';

interface Deps {
  t: T;
  target: Target;
  efforts: EffortBook;
  onChange: (next: Partial<Deck>) => void;
  onSelect: (id: string) => void;
  onPresent: (at: number) => void;
  current: () => Deck | undefined;
}

/**
 * Send one message and apply its answer.
 *
 * The ops are applied to the newest copy of the deck, and all of it — slides,
 * settings, and the two new turns — goes to `onChange` once, which the panel
 * records as one undo step. A deck whose slides were added, removed or
 * reordered while the model was answering gets nothing: the slide numbers the
 * model used would name other slides.
 */
async function send(id: string, message: string, spoken: boolean, d: Deps) {
  if (runs.has(id)) return;
  const text = message.trim();
  if (!text) return;
  const ctl = new AbortController();
  const run: Run = { ctl, message: text, spoken, started: Date.now(), chars: 0 };
  runs.set(id, run);
  troubles.delete(id);
  ping();
  const order = (x: Deck | undefined) => (x?.slides ?? []).map((s) => s.id).join(' ');
  try {
    const d0 = d.current();
    if (!d0) return;
    const p = chatPrompt(d0, d0.chat, text, spoken);
    // A translation rewrites every slide and its notes: room for all of them.
    const out = await generate(d.target, {
      system: p.system, user: p.user, maxTokens: 12000, efforts: d.efforts, signal: ctl.signal,
      onText: (x) => { run.chars += x.length; run.retry = undefined; ping(); },
      onRestart: () => { run.chars = 0; },
      onRetry: (attempt, of) => { run.retry = { attempt, of }; ping(); },
    });
    const parsed = parseChat(out.text);
    const now = d.current();
    if (!now) return;
    const you: DeckTurn = { role: 'you', text, at: run.started, ...(spoken ? { spoken: true } : {}) };
    if (!parsed.readable) {
      d.onChange({ chat: keptChat(now.chat, [you, { role: 'model', text: '', at: Date.now(), failed: true }]) });
      return;
    }
    if (order(now) !== order(d0)) throw new Error(MOVED);
    let applied = applyOps(now, parsed.ops, newId, text);
    let base = now;
    // The logo, found before anything is applied, so it lands in the same undo step.
    if (applied.wants.logo) {
      run.logo = true;
      ping();
      const want = applied.wants.logo;
      const got = await findLogo(want.subject, { lang: now.lang, site: want.site, signal: ctl.signal });
      // The deck may have changed while the web was asked: the ops go onto its newest copy.
      const later = d.current();
      if (!later) return;
      if (order(later) !== order(d0)) throw new Error(MOVED);
      base = later;
      applied = applyOps(later, parsed.ops, newId, text);
      if (got && /^data:image\/(png|jpeg);base64,/.test(got.logo.src)) {
        const w = got.logo.width ?? 0, h = got.logo.height ?? 0;
        applied.next.logo = got.logo.src;
        applied.next.logoRatio = w > 0 && h > 0 ? w / h : undefined;
      } else {
        applied.changes = applied.changes.map((c) => (c.what === 'logo' ? { what: 'logo-failed', subject: c.subject } : c));
      }
    }
    const undone = (c: Change) => c.what === 'skipped' || c.what === 'logo-failed';
    const done = changeLines(applied.changes.filter((c) => !undone(c)), d.t);
    const not = applied.changes.filter(undone).map((c) => changeLine(c, d.t));
    const model: DeckTurn = {
      role: 'model', text: parsed.reply, at: Date.now(),
      ...(done.length ? { changes: done } : {}), ...(not.length ? { skipped: not } : {}),
      ...(applied.wants.offer ? { offer: applied.wants.offer } : {}),
    };
    d.onChange({ ...applied.next, chat: keptChat(base.chat, [you, model]) });
    const slides = applied.next.slides ?? base.slides;
    if (applied.wants.select) d.onSelect(applied.wants.select);
    if (applied.wants.present) d.onPresent(Math.max(0, slides.findIndex((s) => s.id === applied.wants.present)));
  } catch (e) {
    if (ctl.signal.aborted || isAbort(e)) {
      // Stopped: nothing was applied, and the message goes back where it was written.
      if (!drafts.get(id)?.trim()) drafts.set(id, text);
      return;
    }
    const error = e instanceof Error && e.message === MOVED
      ? d.t('The slides changed while the model was answering, so nothing was applied. Send the message again.')
      : explain(e, d.t('answer your message'));
    troubles.set(id, { message: text, spoken, error });
  } finally {
    runs.delete(id);
    ping();
  }
}

// ── words ─────────────────────────────────────────────────────────────────

/** One change, said in the interface's language. */
export function changeLine(c: Change, t: T): string {
  switch (c.what) {
    case 'edited':
      return c.kind ? fill(t('Slide {n} is now: {kind}'), { n: c.slide, kind: slideKindName(c.kind, t) }) : fill(t('Slide {n}: new words'), { n: c.slide });
    case 'added': return fill(t('Added a slide at {n}: {kind}'), { n: c.at, kind: slideKindName(c.kind, t) });
    case 'removed': return fill(t('Removed slide {n}'), { n: c.slide });
    case 'moved': return fill(t('Moved slide {n} to place {to}'), { n: c.slide, to: c.to });
    case 'duplicated': return fill(t('Copied slide {n}'), { n: c.slide });
    case 'notes': return c.removed ? fill(t('Slide {n}: notes removed'), { n: c.slide }) : fill(t('Slide {n}: new speaker notes'), { n: c.slide });
    case 'theme': return fill(t('Look: {theme}'), { theme: themeName(c.theme, t) });
    case 'title': return fill(t('Renamed to “{title}”'), { title: c.title });
    case 'brand': return t('Colours changed');
    case 'logo': return fill(t('The logo of {name} is on the title slide, the closing slide and the corner of the others'), { name: c.subject });
    case 'logo-failed': return fill(t('No logo of {name} could be found on the web — add one from the Presentation tab'), { name: c.subject });
    case 'logo-removed': return t('The logo is off the slides');
    case 'cover': return t('The names on the title slide changed');
    case 'language': return fill(t('The words are now in {lang}'), { lang: langName(c.lang, t) });
    case 'digits': return c.digits === 'eastern' ? t('Numbers are written ١٢٣') : t('Numbers are written 123');
    case 'shown': return fill(t('Showing slide {n}'), { n: c.slide });
    case 'present': return fill(t('Presenting from slide {n}'), { n: c.slide });
    case 'save': return t('Save it with the button below');
    case 'skipped':
      switch (c.why) {
        case 'unknown': return fill(t('Skipped “{op}”: not something the app can do'), { op: c.op });
        case 'no-slide': return c.slide ? fill(t('Skipped: there is no slide {n}'), { n: c.slide }) : t('Skipped a change to a slide that is not there');
        case 'last-slide': return t('Skipped: the only slide cannot be removed');
        case 'references': return t('Skipped: the reference list is the document’s own, and the model cannot write it');
        case 'language': return t('Not translated: not every slide was rewritten, so no words were changed');
        case 'too-many': return fill(t('Skipped the rest: at most {n} changes a message'), { n: MAX_OPS });
        case 'full': return fill(t('Skipped: a presentation holds at most {n} slides'), { n: MAX_SLIDES });
        case 'unfit': return c.slide ? fill(t('Skipped: that would leave slide {n} with nothing to show'), { n: c.slide }) : t('Skipped a change that would leave a slide with nothing to show');
        case 'unsourced':
          return c.slide
            ? fill(t('Skipped: slide {n} would show a number nobody gave — write the number in your message'), { n: c.slide })
            : t('Skipped a new slide with a number nobody gave — write the number in your message');
        default: return t('Skipped a change that could not be read');
      }
  }
}

/** Slide numbers as a short list: 1–6, or 1, 3–4. */
function numbers(ns: number[]): string {
  const sorted = [...new Set(ns)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return out.join(', ');
}

/** The changes, one line each — except new words in several slides, which is one line: a translation is "Slides 1–12: new words". */
export function changeLines(changes: readonly Change[], t: T): string[] {
  const reworded = changes.filter((c): c is Extract<Change, { what: 'edited' }> => c.what === 'edited' && !c.kind).map((c) => c.slide);
  const renoted = changes.filter((c): c is Extract<Change, { what: 'notes' }> => c.what === 'notes' && !c.removed).map((c) => c.slide);
  const mergeWords = new Set(reworded).size > 1;
  const mergeNotes = new Set(renoted).size > 1;
  const out: string[] = [];
  let saidWords = false;
  let saidNotes = false;
  for (const c of changes) {
    if (mergeWords && c.what === 'edited' && !c.kind) {
      if (!saidWords) out.push(fill(t('Slides {list}: new words'), { list: numbers(reworded) }));
      saidWords = true;
    } else if (mergeNotes && c.what === 'notes' && !c.removed) {
      if (!saidNotes) out.push(fill(t('Slides {list}: new speaker notes'), { list: numbers(renoted) }));
      saidNotes = true;
    } else out.push(changeLine(c, t));
  }
  return out;
}

/** What the model is doing before its answer arrives; a line that changes says it is working. */
function thinkingVerb(ms: number, t: T): string {
  const n = Math.floor(ms / 4000) % 3;
  if (n === 1) return t('Looking at the slides');
  if (n === 2) return t('Planning the changes');
  return t('Reading your message');
}

/** Things to say, in the interface's language. One that ends in "…" is started in the box for the person to finish. */
function suggestions(d: Deck, t: T): string[] {
  return [
    t('Make slide 2 shorter'),
    t('Add a slide about …'),
    t('Write speaker notes for every slide'),
    t('Change the look to bold'),
    ...(d.logo ? [] : [t('Add the logo of my university')]),
    d.lang === 'ckb' ? t('Translate it to Arabic') : t('Translate it to Kurdish Sorani'),
    t('Start the presentation'),
    t('Save it as PowerPoint'),
  ];
}

/** Why the microphone or the transcription failed, in the interface's language. */
function voiceError(e: unknown, name: string, t: T): string {
  if (e instanceof SpeechError) {
    if (e.trouble === 'refused') return fill(t('{name} refused the key. Check it in Settings.'), { name });
    if (e.trouble === 'slow') return t('That is taking longer than expected. It may still finish — try again shortly.');
    if (e.trouble === 'status') return fill(t('The server answered {n}.'), { n: e.detail });
    if (e.trouble === 'format') return fill(t('{name} is not a kind of audio that can be transcribed.'), { name: e.detail });
    return e.detail || t('The recording could not be transcribed.');
  }
  const n = (e as { name?: string })?.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return t('The microphone is not allowed. Allow Vylo Editor to use it in your system’s privacy settings, then try again.');
  if (n === 'NotFoundError') return t('No microphone was found.');
  return explain(e, t('write down what you said'));
}

// ── the tab ───────────────────────────────────────────────────────────────

type Ear =
  | { mode: 'idle' }
  | { mode: 'recording'; since: number }
  | { mode: 'writing' };

export function SlidesChat({
  t, lang, deck, onChange, onSelect, onPresent, onSavePptx, onSavePdf, saving, locked, ready, target, efforts, providers, onSettings, current,
}: Props): JSX.Element {
  useRuns();
  const id = deck.id;
  const run = runs.get(id);
  const trouble = troubles.get(id);
  const turns = deck.chat ?? [];
  const [text, setText] = useState(() => drafts.get(id) ?? '');
  const box = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLOListElement>(null);
  const can = ready && !locked;
  const [ear, setEar] = useState<Ear>({ mode: 'idle' });
  const [heardWrong, setHeardWrong] = useState('');
  const [dict, setDict] = useState<DictationState>(DICTATION_OFF);
  const [noEar, setNoEar] = useState(false);
  useSecond(!!run || ear.mode === 'recording');

  const backend = useMemo(() => speechBackend(providers), [providers]);
  const canRecord = !!backend && Recorder.available();
  const canDictate = useMemo(() => speechAvailable(), []);

  const write = (s: string) => {
    drafts.set(id, s);
    setText(s);
  };

  // A message stopped mid-answer comes back to the box it was written in.
  const stored = drafts.get(id) ?? '';
  useEffect(() => {
    if (stored !== text && !run) setText(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, run]);

  // The box grows with what is typed, up to a few lines.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.blockSize = 'auto';
    el.style.blockSize = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text]);

  // The newest turn in view.
  useLayoutEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, !!run, !!trouble]);

  const deps = (): Deps => ({ t, target, efforts, onChange, onSelect, onPresent, current: () => current() ?? deck });
  const go = (message: string, spoken = false) => {
    if (!can || runs.has(id) || !message.trim()) return;
    write('');
    void send(id, message, spoken, deps());
  };
  const goRef = useRef(go);
  goRef.current = go;
  const textRef = useRef(text);
  textRef.current = text;

  const suggest = (s: string) => {
    if (s.endsWith('…')) {
      write(`${s.slice(0, -1).trimEnd()} `);
      requestAnimationFrame(() => {
        const el = box.current;
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      });
    } else go(s);
  };

  // ── the microphone: a recording for the transcription service ──
  const recorder = useRef<Recorder | null>(null);
  const writing = useRef<AbortController | null>(null);
  // Never a microphone left open by a tab that is gone.
  useEffect(() => () => { recorder.current?.cancel(); writing.current?.abort(); }, []);

  const finishRecording = async () => {
    const r = recorder.current;
    recorder.current = null;
    if (!r || !backend) return;
    setEar({ mode: 'writing' });
    const ctl = new AbortController();
    writing.current = ctl;
    try {
      const audio = await r.stop();
      if (!audio || audio.size === 0) { setHeardWrong(t('Nothing was recorded. Speak after pressing the microphone.')); return; }
      const words = await transcribe(backend, audio, { name: speechFileName(r.type), signal: ctl.signal });
      if (!words.trim()) { setHeardWrong(t('Nothing could be made out. Try again, a little closer to the microphone.')); return; }
      goRef.current(words, true);
    } catch (e) {
      if (!ctl.signal.aborted && !isAbort(e)) setHeardWrong(voiceError(e, backend.name, t));
    } finally {
      writing.current = null;
      setEar({ mode: 'idle' });
    }
  };

  const startRecording = async () => {
    setHeardWrong('');
    const r = new Recorder();
    recorder.current = r;
    try {
      await r.start(() => { void finishRecording(); });
      if (recorder.current === r) setEar({ mode: 'recording', since: Date.now() });
      else r.cancel();
    } catch (e) {
      r.cancel();
      recorder.current = null;
      setHeardWrong(voiceError(e, backend?.name ?? '', t));
    }
  };

  const cancelRecording = () => {
    recorder.current?.cancel();
    recorder.current = null;
    writing.current?.abort();
    setEar({ mode: 'idle' });
  };

  // ── the fallback: the webview's dictation, into the box, sent when it stops ──
  const dictation = useRef<Dictation | null>(null);
  const heard = useRef(false);
  const langRef = useRef(lang);
  langRef.current = lang;
  useEffect(() => () => dictation.current?.dispose(), []);
  useEffect(() => {
    if (dict.phase !== 'off' || !heard.current) return;
    heard.current = false;
    if (textRef.current.trim()) goRef.current(textRef.current, true);
  }, [dict.phase]);
  const toggleDictation = () => {
    setHeardWrong('');
    if (!dictation.current) {
      dictation.current = new Dictation({
        open: (sink) => browserOpen(recognitionLang(langRef.current, navigator.language))(sink),
        onText: (said) => {
          heard.current = true;
          const was = textRef.current;
          const next = was.trim() ? `${was.trimEnd()} ${said}` : said;
          textRef.current = next;
          write(next);
        },
        onState: setDict,
      });
    }
    dictation.current.toggle();
  };

  const onMic = () => {
    if (!can || run) return;
    if (canRecord) {
      if (ear.mode === 'recording') void finishRecording();
      else if (ear.mode === 'idle') void startRecording();
      return;
    }
    if (canDictate) { toggleDictation(); return; }
    setNoEar(true);
  };

  const listening = ear.mode === 'recording' || dict.phase !== 'off';
  const micTitle = canRecord
    ? (ear.mode === 'recording' ? t('Stop and send') : fill(t('Speak — your voice goes to {name} to be written down, then sent'), { name: backend!.name }))
    : canDictate
      ? (dict.phase === 'off' ? t('Speak — your words are written into the box and sent when you stop') : t('Stop and send'))
      : t('Speak to your slides');

  const elapsed = run ? Date.now() - run.started : 0;
  const lastModel = turns.map((x) => x.role).lastIndexOf('model');
  const status = run ? (run.logo ? t('Finding the logo on the web…') : run.chars ? t('Writing the changes…') : `${thinkingVerb(elapsed, t)}…`) : '';

  return (
    <div className="vid-chat sl-chat">
      {!ready && <p className="vid-chat-note"><Icon name="warning" size={12} />{t('Add an API key in Settings to talk to the slides.')}</p>}
      {ready && locked && <p className="vid-chat-note"><Icon name="clock" size={12} />{t('Wait until the slides are written.')}</p>}

      <ol className="vid-chat-log" ref={log} aria-live="polite" aria-label={t('Conversation with the slides')}>
        {turns.length === 0 && !run && !trouble && (
          <li className="vid-chat-empty">
            <span className="vid-chat-empty-mark" aria-hidden="true"><Icon name="mic" size={16} /></span>
            <b>{t('Talk to your slides')}</b>
            <span className="vid-chat-empty-what">{t('Say or type what to change, in your own words and your own language — shorter slides, a new slide, a translation, notes for every slide, or “start the presentation”. The model changes the deck and lists every change under its answer; one undo takes a whole message back.')}</span>
          </li>
        )}
        {turns.map((turn, i) => (turn.role === 'you'
          ? (
            <li key={`${turn.at}-${i}`} className="vid-chat-turn is-you">
              <p className="vid-chat-text" dir="auto">
                {turn.spoken && <span className="sl-spoken" title={t('Spoken')} aria-label={t('Spoken')}><Icon name="mic" size={11} /></span>}
                {turn.text}
              </p>
            </li>
          )
          : (
            <li key={`${turn.at}-${i}`} className={`vid-chat-turn is-model${turn.failed ? ' is-failed' : ''}`}>
              <span className="vid-chat-mark" aria-hidden="true"><Icon name={turn.failed ? 'warning' : 'sparkle'} size={12} /></span>
              <div className="vid-chat-body">
                {turn.failed
                  ? <p className="vid-chat-text">{t('The answer could not be read, so nothing was changed. Try again, or ask for less at once.')}</p>
                  : turn.text
                    ? <p className="vid-chat-text" dir="auto">{turn.text}</p>
                    : !turn.changes?.length && !turn.skipped?.length && <p className="vid-chat-text is-quiet">{t('Nothing needed changing.')}</p>}
                {(turn.changes?.length || turn.skipped?.length) ? (
                  <ul className="vid-chat-changes" aria-label={t('What changed')}>
                    {(turn.changes ?? []).map((line, j) => (
                      <li key={`c${j}`} dir="auto"><Icon name="check" size={11} /><span>{line}</span></li>
                    ))}
                    {(turn.skipped ?? []).map((line, j) => (
                      <li key={`s${j}`} className="is-skipped" dir="auto"><Icon name="warning" size={11} /><span>{line}</span></li>
                    ))}
                  </ul>
                ) : null}
                {/* A file is the person's to save: the chat offers the button, and the press does it. */}
                {turn.offer?.length && i === lastModel ? (
                  <div className="vid-chat-offer sl-chat-offer">
                    {turn.offer.includes('pptx') && (
                      <button type="button" className="ghost bordered" disabled={saving || locked} onClick={onSavePptx}>
                        <Icon name="slides" size={12} />{t('Save as PowerPoint')}
                      </button>
                    )}
                    {turn.offer.includes('pdf') && (
                      <button type="button" className="ghost bordered" disabled={saving || locked} onClick={onSavePdf}>
                        <Icon name="file" size={12} />{t('Save as PDF')}
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </li>
          )))}
        {(run || trouble) && (
          <li className={`vid-chat-turn is-you is-pending${trouble && !run ? ' is-stuck' : ''}`}>
            <p className="vid-chat-text" dir="auto">
              {(run?.spoken ?? trouble?.spoken) && <span className="sl-spoken" aria-label={t('Spoken')}><Icon name="mic" size={11} /></span>}
              {run?.message ?? trouble?.message}
            </p>
          </li>
        )}
        {run && (
          <li className="vid-chat-turn is-model is-working" role="status">
            <span className="vid-chat-mark" aria-hidden="true"><span className="vid-glyph">✻</span></span>
            <div className="vid-chat-status">
              <b>{status}</b>
              <span className="vid-chat-clock">
                <span>{fill(t('Running for {time}'), { time: clock(elapsed) })}</span>
                {run.chars > 0 && <span>{fill(t('{n} characters'), { n: run.chars.toLocaleString() })}</span>}
                {run.retry && <span>{fill(t('Trying again ({n} of {of})…'), { n: run.retry.attempt, of: run.retry.of })}</span>}
              </span>
            </div>
          </li>
        )}
        {trouble && !run && (
          <li className="vid-chat-turn is-model is-failed" role="alert">
            <span className="vid-chat-mark" aria-hidden="true"><Icon name="warning" size={12} /></span>
            <div className="vid-chat-body">
              <p className="vid-chat-text" dir="auto">{trouble.error}</p>
              <span className="vid-chat-again">
                <button type="button" className="ghost bordered" disabled={!can} onClick={() => go(trouble.message, trouble.spoken)}>
                  {t('Try again')}
                </button>
                <button type="button" className="ghost" onClick={() => { troubles.delete(id); ping(); }}>{t('Dismiss')}</button>
              </span>
            </div>
          </li>
        )}
      </ol>

      {!run && !text.trim() && !listening && ear.mode === 'idle' && (
        <div className="vid-chat-chips" role="group" aria-label={t('Suggestions')}>
          {suggestions(deck, t).map((s) => (
            <button key={s} type="button" className="vid-chat-chip" disabled={!can} onClick={() => suggest(s)} dir="auto">{s}</button>
          ))}
        </div>
      )}

      {ear.mode === 'recording' && (
        <p className="sl-listen" role="status">
          <span className="sl-listen-dot" aria-hidden="true" />
          <b>{fill(t('Listening… {time}'), { time: clock(Date.now() - ear.since) })}</b>
          <span>{t('Press the microphone again to send.')}</span>
          <button type="button" className="ghost" onClick={cancelRecording}>{t('Cancel')}</button>
        </p>
      )}
      {ear.mode === 'writing' && backend && (
        <p className="sl-listen" role="status">
          <span className="vid-spinner" aria-hidden="true" />
          <b>{fill(t('{name} is writing down what you said…'), { name: backend.name })}</b>
          <button type="button" className="ghost" onClick={cancelRecording}>{t('Cancel')}</button>
        </p>
      )}
      {dict.phase !== 'off' && (
        <p className="sl-listen" role="status">
          <span className="sl-listen-dot" aria-hidden="true" />
          <b>{dict.interim || t('Listening…')}</b>
          <span>{t('Press the microphone again to send.')}</span>
        </p>
      )}
      {(heardWrong || dict.error) && <p className="vid-bad" role="alert">{heardWrong || t(dict.error!)}</p>}
      {noEar && !canRecord && !canDictate && (
        <p className="vid-chat-note sl-no-ear">
          <Icon name="mic" size={12} />
          <span>{t('To speak to your slides, set up Vylo Voice — it writes down Sorani, Badini, Arabic and English — or a speech-to-text provider in Settings.')}</span>
          <button type="button" className="ghost bordered" onClick={onSettings}>{t('Open Settings')}</button>
        </p>
      )}

      <form className={`vid-chat-compose${can ? '' : ' is-off'}`} onSubmit={(e) => { e.preventDefault(); go(text); }}>
        <textarea ref={box} value={text} dir="auto" rows={1} disabled={!can}
                  placeholder={can ? t('Tell the slides what to change, or press the microphone and say it…') : ''} aria-label={t('Message to the slides')}
                  onChange={(e) => write(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      go(text);
                    }
                  }} />
        <button type="button" className={`vid-chat-send sl-mic${listening ? ' is-on' : ''}`} disabled={!can || !!run || ear.mode === 'writing'}
                onClick={onMic} aria-pressed={listening} title={micTitle} aria-label={micTitle}>
          <Icon name={listening ? 'send' : 'mic'} size={14} />
        </button>
        {run
          ? (
            <button type="button" className="vid-chat-send is-stop" onClick={() => runs.get(id)?.ctl.abort()} title={t('Stop')} aria-label={t('Stop')}>
              <Icon name="stop" size={14} />
            </button>
          )
          : (
            <button type="submit" className="vid-chat-send" disabled={!can || !text.trim() || listening} title={t('Send')} aria-label={t('Send')}>
              <Icon name="send" size={13} />
            </button>
          )}
      </form>
      <p className="vid-chat-hint">{t('Enter sends · Shift+Enter adds a line · the microphone listens until you press it again · one undo takes a whole message back')}</p>
    </div>
  );
}
