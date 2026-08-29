/**
 * Speaking a question instead of typing it.
 *
 * This is **dictation, and only dictation**. Recognised speech is put into the
 * composer for a person to read, edit and send; nothing here can make it *do*
 * anything. That is not a preference, it is the rule the whole app rests on:
 * text that reaches a shell or the disk must be a string a human has read and
 * approved, and a speech engine's guess at a noisy sentence is the least
 * approved string in the product. A "voice command" — say it, it runs — would
 * be model-or-machine output reaching a shell with no human in between, so it
 * does not exist. The only exit from this module is `onText`, which hands words
 * to a textarea.
 *
 * ## Behind an interface, because the engine is a browser's and may not be there
 *
 * Web Speech recognition is not a thing every webview has. The app runs in
 * WKWebView on macOS and WebView2 on Windows, and whether either exposes
 * `webkitSpeechRecognition` depends on the OS build underneath. So "not
 * available here" is an ordinary outcome rather than an edge case: `open`
 * returns null and the control says so, instead of a constructor throwing
 * somewhere in a click handler.
 *
 * The same interface is what makes the interesting half testable. Everything
 * that decides anything — which results are committed, where the words land in
 * text someone is already typing, when a forgotten session stops itself — is
 * here, with the engine and the clock passed in.
 *
 * ## Interim results stay out of the textarea
 *
 * An engine emits a running guess and revises it, several times a second. Put
 * that in the composer and every revision rewrites text the person may be
 * editing, which moves their caret and undoes their typing. So only *final*
 * results are inserted, and the running guess is exposed as `state.interim` for
 * the mic control to show. The caret is then only ever moved by an insertion
 * the person can see arrive.
 */

/** One result from the engine. */
export interface Phrase {
  /** What was heard. Engines are inconsistent about surrounding space. */
  text: string;
  /** The engine will not revise this. Only final text reaches the composer. */
  final: boolean;
}

export interface Transcript {
  /**
   * How many results have been committed. Engines redeliver: a result already
   * marked final arrives again in the next event, and without this the sentence
   * lands in the composer twice.
   */
  taken: number;
  /** The engine's current guess. Shown beside the mic, never inserted. */
  interim: string;
}

export const NOTHING_HEARD: Transcript = { taken: 0, interim: '' };

/**
 * Punctuation that belongs against the word before it.
 *
 * Recognisers emit ", and then" as its own result often enough that joining
 * with an unconditional space is visibly wrong.
 */
const HUGS_LEFT = /^[,.;:!?)\]}%…]/;

/** Two pieces of speech, with the single space between them the engine omits. */
export function join(a: string, b: string): string {
  const right = b.trim();
  if (!right) return a;
  if (!a) return right;
  return HUGS_LEFT.test(right) ? a + right : a + ' ' + right;
}

/**
 * Fold one engine event into the running transcript.
 *
 * `at` is the index of the first result in `phrases`, so results the engine
 * repeats can be recognised by position rather than by comparing text — two
 * identical sentences said twice are two sentences, not a redelivery.
 *
 * Returns the text finalised by *this* event, which is the only thing the
 * composer is given.
 */
export function fold(t: Transcript, at: number, phrases: Phrase[]): { next: Transcript; said: string } {
  let taken = t.taken;
  let said = '';
  let interim = '';
  phrases.forEach((p, i) => {
    if (!p.final) { interim = join(interim, p.text); return; }
    if (at + i < taken) return;
    said = join(said, p.text);
    taken = at + i + 1;
  });
  return { next: { taken, interim }, said };
}

/** A composer's contents and where the caret sits in them. */
export interface Composed {
  text: string;
  caret: number;
}

/**
 * Put spoken words into text someone has already typed.
 *
 * At the caret, not at the end: dictating a clause into the middle of a
 * half-written question is the reason to have this at all, and appending would
 * silently move the words somewhere else. The caret comes back positioned after
 * what was inserted, so the next phrase continues the sentence rather than
 * landing back where the first one started.
 */
export function insert(text: string, caret: number, said: string): Composed {
  const at = Math.max(0, Math.min(caret, text.length));
  const words = said.trim();
  if (!words) return { text, caret: at };
  const head = text.slice(0, at);
  const tail = text.slice(at);
  const lead = head && !/\s$/.test(head) && !HUGS_LEFT.test(words) ? ' ' : '';
  // A space *after* as well, or dictating into the middle of a sentence welds
  // the new words onto the next one. The caret stays in front of it, so the
  // following phrase does not have to step over it.
  const pad = tail && !/^\s/.test(tail) ? ' ' : '';
  return { text: head + lead + words + pad + tail, caret: (head + lead + words).length };
}

/**
 * What to tell the person about an engine error, or null when there is nothing
 * worth saying.
 *
 * The codes are Web Speech's. Two of them are not failures at all, and
 * reporting them as such would put a red line on screen for the ordinary end of
 * a sentence.
 */
export function trouble(code: string): string | null {
  switch (code) {
    // Silence. That is what the silence timeout is for, and it has already
    // turned the control off; saying so as well is an error message for the
    // most normal thing that happens.
    case 'no-speech': return null;
    // We asked for this one.
    case 'aborted': return null;
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was refused. Allow it in your system settings.';
    case 'audio-capture': return 'No microphone was found.';
    case 'network': return 'Dictation needs a connection, and there was none.';
    case 'language-not-supported': return 'Dictation does not have that language.';
    default: return 'Dictation stopped unexpectedly.';
  }
}

export const UNAVAILABLE = 'Dictation is not available here.';
export const CANNOT_START = 'Dictation could not start.';

/**
 * Which language to recognise.
 *
 * Not simply the interface language. Kurdish has no recognition model in any
 * engine, so asking for one fails with `language-not-supported` and dictation
 * never works at all — for exactly the people the interface was translated for.
 * The OS language is a guess; a language the engine refuses is a dead button.
 */
export function recognitionLang(ui: string, osLang: string): string {
  // Arabic has a model everywhere, and someone running the interface in Arabic
  // is likely speaking it even on a machine whose OS is set to English.
  if (ui === 'ar') return 'ar';
  return osLang || 'en-US';
}

/** A running engine. */
export interface Recogniser {
  start(): void;
  /** Finish the phrase in progress, then end. `ended` follows. */
  stop(): void;
  /** Drop everything now, without waiting for a final result. */
  abort(): void;
}

/** What a running engine tells the session. Any of these may arrive at any time. */
export interface Sink {
  started(): void;
  heard(at: number, phrases: Phrase[]): void;
  failed(code: string): void;
  ended(): void;
}

/** Opens an engine, or returns null where the webview has no speech recognition. */
export type Open = (sink: Sink) => Recogniser | null;

/** Injected so the timeouts can be tested without waiting for them. */
export interface Timers {
  set(ms: number, fn: () => void): number;
  clear(id: number): void;
}

const REAL_TIMERS: Timers = {
  set: (ms, fn) => setTimeout(fn, ms) as unknown as number,
  clear: (id) => clearTimeout(id),
};

/**
 * Nothing heard for this long and the session stops itself.
 *
 * Long enough to pause mid-thought, short enough that a session someone walked
 * away from is not holding the microphone open all afternoon with a recording
 * indicator in the menu bar nobody can explain.
 */
export const SILENCE_MS = 8_000;

/**
 * How long a stop is given before it is forced.
 *
 * `stop()` is supposed to be answered by `end`. An engine that does not answer
 * would otherwise leave the control stuck mid-stop for ever, which is the one
 * failure a person cannot get out of without restarting the app.
 */
export const STOP_MS = 1_500;

export type Phase = 'off' | 'starting' | 'listening' | 'stopping';

/** Everything the control draws comes from here. */
export interface State {
  phase: Phase;
  /** The engine's running guess, to show as provisional. Never inserted. */
  interim: string;
  /** An English sentence to pass through `t()`, or null. */
  error: string | null;
}

export const OFF: State = { phase: 'off', interim: '', error: null };

export interface Options {
  open: Open;
  /** Each finalised phrase, once. The only way words leave this module. */
  onText: (said: string) => void;
  /** Called on every change, so the view can redraw. */
  onState: (s: State) => void;
  timers?: Timers;
  silenceMs?: number;
}

/**
 * One dictation session, owned by the composer.
 *
 * Deliberately not a hook: the engine's callbacks arrive outside React's
 * lifecycle and the timers have to survive re-renders, so the state lives here
 * and is pushed out through `onState`.
 */
export class Dictation {
  state: State = OFF;

  private o: Options;
  private timers: Timers;
  private silence: number;
  private engine: Recogniser | null = null;
  private sofar: Transcript = NOTHING_HEARD;
  private timer: number | null = null;

  constructor(o: Options) {
    this.o = o;
    this.timers = o.timers ?? REAL_TIMERS;
    this.silence = o.silenceMs ?? SILENCE_MS;
  }

  toggle(): void {
    if (this.state.phase === 'off') this.start(); else this.stop();
  }

  start(): void {
    // Web Speech throws on a second start(), and a session already stopping is
    // about to hand its engine back — restarting through it would race.
    if (this.state.phase !== 'off') return;
    const engine = this.o.open(this.sink);
    if (!engine) { this.set({ error: UNAVAILABLE }); return; }
    this.engine = engine;
    this.sofar = NOTHING_HEARD;
    this.set({ phase: 'starting', interim: '', error: null });
    // Armed before start() rather than in `started`, so an engine that never
    // reports having started still returns the control to off by itself.
    this.arm(this.silence, () => this.stop());
    try {
      engine.start();
    } catch {
      this.engine = null;
      this.disarm();
      this.set({ phase: 'off', error: CANNOT_START });
    }
  }

  /** Ask the engine to finish the phrase in progress and end. */
  stop(): void {
    if (this.state.phase === 'off' || this.state.phase === 'stopping') return;
    const engine = this.engine;
    this.set({ phase: 'stopping', interim: '' });
    this.arm(STOP_MS, () => { engine?.abort(); this.finish(); });
    try {
      engine?.stop();
    } catch {
      this.finish();
    }
  }

  /** Unmounting. Ends the session without waiting to be told it ended. */
  dispose(): void {
    this.disarm();
    try { this.engine?.abort(); } catch { /* the engine is going away regardless */ }
    this.engine = null;
    this.state = OFF;
  }

  private sink: Sink = {
    started: () => {
      if (this.state.phase === 'starting') this.set({ phase: 'listening' });
    },

    heard: (at, phrases) => {
      // Results that arrive after a stop belong to a session the person has
      // already ended; inserting them would put words in the box after the
      // control went off.
      if (this.state.phase === 'off' || this.state.phase === 'stopping') return;
      const { next, said } = fold(this.sofar, at, phrases);
      this.sofar = next;
      // Anything heard at all is someone still talking.
      this.arm(this.silence, () => this.stop());
      // Not every engine fires `start`; hearing something proves it is running.
      this.set({ phase: 'listening', interim: next.interim });
      if (said) this.o.onText(said);
    },

    failed: (code) => {
      const why = trouble(code);
      // An error that lands after the session already ended is a report, not a
      // transition — reviving the control to stop it again would flash it on.
      if (this.state.phase === 'off') { this.set({ error: why }); return; }
      // Web Speech sends `end` after `error` — but not every engine does, so
      // the grace timer is what actually returns the control to off.
      this.set({ phase: 'stopping', interim: '', error: why });
      this.arm(STOP_MS, () => { this.engine?.abort(); this.finish(); });
    },

    ended: () => this.finish(),
  };

  private finish(): void {
    this.disarm();
    this.engine = null;
    // `error` is left alone: `failed` sets it and `end` follows immediately,
    // so clearing it here would erase the reason before it was ever drawn.
    this.set({ phase: 'off', interim: '' });
  }

  private set(part: Partial<State>): void {
    this.state = { ...this.state, ...part };
    this.o.onState(this.state);
  }

  /** One timer at a time — a silence timeout and a stop grace never overlap. */
  private arm(ms: number, fn: () => void): void {
    this.disarm();
    this.timer = this.timers.set(ms, () => { this.timer = null; fn(); });
  }

  private disarm(): void {
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null; }
  }
}

/*
 * The engine half. Nothing below decides anything; it translates Web Speech's
 * shape into the interface above.
 */

interface NativeAlternative { transcript: string }
interface NativeResult { readonly isFinal: boolean; [i: number]: NativeAlternative }
interface NativeResults { readonly length: number; [i: number]: NativeResult }
interface NativeEvent { resultIndex: number; results: NativeResults }

interface Native {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onresult: ((e: NativeEvent) => void) | null;
}

type NativeCtor = new () => Native;

function ctor(): NativeCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: NativeCtor; webkitSpeechRecognition?: NativeCtor };
  // Prefixed first: WebKit has only the prefixed name, and where both exist
  // they are the same object.
  return w.webkitSpeechRecognition ?? w.SpeechRecognition ?? null;
}

/** Whether this webview can do it at all, for deciding whether to draw the control. */
export function speechAvailable(): boolean {
  return ctor() !== null;
}

/** The browser's engine, ready to be handed to `Dictation`. */
export function browserOpen(lang: string): Open {
  return (sink) => {
    const Ctor = ctor();
    if (!Ctor) return null;
    const r = new Ctor();
    r.lang = lang;
    // Continuous, or the engine ends after the first sentence and dictating a
    // paragraph means pressing the button once per sentence.
    r.continuous = true;
    r.interimResults = true;
    r.onstart = () => sink.started();
    r.onend = () => sink.ended();
    r.onerror = (e) => sink.failed(String(e?.error ?? 'unknown'));
    r.onresult = (e) => {
      const phrases: Phrase[] = [];
      // `results` is cumulative and `resultIndex` marks where it changed;
      // reading the whole list every event would recommit every sentence.
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        phrases.push({ text: res?.[0]?.transcript ?? '', final: !!res?.isFinal });
      }
      sink.heard(e.resultIndex, phrases);
    };
    return {
      start: () => r.start(),
      stop: () => r.stop(),
      abort: () => r.abort(),
    };
  };
}
