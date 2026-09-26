import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { fill, type Lang } from './i18n';
import { explain } from './errors';
import type { EffortBook } from './effort';
import { generate, type Target } from './generate';
import type { Provider } from './providers';
import type { ChatTurn, Doc, DocLang } from './research';
import { MAX_OPS, MAX_REWRITES, applyOps, chatPrompt, keptChat, parseChat, type Change, type ChatTab, type Work } from './researchchatops';
import { Recorder, SpeechError, speechBackend, speechFileName, transcribe } from './slidesvoice';
import { micLang } from './whatsappvoice';
import { Dictation, OFF as DICTATION_OFF, browserOpen, recognitionLang, speechAvailable, type State as DictationState } from './dictate';

/**
 * Talking to a Research document: its Chat tab.
 *
 * The researcher asks about the document or says what to change — typed, or
 * spoken into the microphone — and the document's own model answers with a
 * sentence and a list of operations (researchchatops.ts). The app checks every
 * operation: changes to the outline, the title, the style or the notes are
 * kept at once, and a part to write again goes to the same writer the Outline
 * tab's rewrite uses, queued behind anything already being written. Under the
 * answer it lists what changed, what started and what was skipped.
 *
 * Speaking works as it does in the Slides chat: a recording between two
 * presses, sent to Vylo Voice or an OpenAI-shaped provider to be written
 * down, or — with neither — the webview's own dictation into the box.
 *
 * Nothing the model writes is run or rendered as HTML, and it cannot save a
 * file: "save it as Word" puts a button under the answer.
 *
 * A message being answered lives outside React, like the panel's runs, so
 * switching tabs or modules does not lose it.
 */

type T = (s: string) => string;

interface Props {
  t: T;
  lang: Lang;
  doc: Doc;
  /** A run is writing the document: the outline is not the chat's to change until it ends. */
  busy: () => boolean;
  ready: boolean;
  target: Target;
  book: EffortBook;
  providers: readonly Provider[];
  onSettings: () => void;
  /** The newest copy of the document. */
  current: () => Doc | undefined;
  onChange: (next: Partial<Doc>) => void;
  /** Runs to start, in order, behind any in flight. */
  onWork: (work: Work[]) => void;
  onOpen: (sectionId: string) => void;
  onTab: (tab: ChatTab) => void;
  onSaveWord: () => void;
  onSavePdf: () => void;
  saving: boolean;
}

// ── state that outlives the tab ───────────────────────────────────────────

interface Run {
  ctl: AbortController;
  message: string;
  spoken: boolean;
  started: number;
  chars: number;
  retry?: { attempt: number; of: number };
}

interface Trouble { message: string; spoken: boolean; error: string }

const runs = new Map<string, Run>();
const troubles = new Map<string, Trouble>();
const drafts = new Map<string, string>();
/** Documents with a message from Ask Vylo, sent when their Chat tab can send it. */
const waiting = new Set<string>();
const listeners = new Set<() => void>();

/** Ask Vylo: put the words in a document's chat box, and send them when the tab is drawn and ready. */
export function sendWhenOpen(id: string, text: string) {
  drafts.set(id, text);
  waiting.add(id);
  ping();
}

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

const MOVED = 'research-chat:moved';

interface Deps {
  t: T;
  lang: Lang;
  target: Target;
  book: EffortBook;
  busy: () => boolean;
  current: () => Doc | undefined;
  onChange: (next: Partial<Doc>) => void;
  onWork: (work: Work[]) => void;
  onOpen: (id: string) => void;
  onTab: (tab: ChatTab) => void;
}

/**
 * Send one message and carry out its answer, against the newest copy of the
 * document. One whose parts were added, removed or reordered while the model
 * was answering gets nothing: the part numbers the model used would name
 * other parts.
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
  const order = (x: Doc | undefined) => (x?.sections ?? []).map((s) => s.id).join(' ');
  try {
    const d0 = d.current();
    if (!d0) return;
    const p = chatPrompt(d0, d0.chat, text, { spoken, ui: d.lang as DocLang });
    const out = await generate(d.target, {
      system: p.system, user: p.user, maxTokens: 6000, efforts: d.book, signal: ctl.signal,
      onText: (x) => { run.chars += x.length; run.retry = undefined; ping(); },
      onRestart: () => { run.chars = 0; },
      onRetry: (attempt, of) => { run.retry = { attempt, of }; ping(); },
    });
    const parsed = parseChat(out.text);
    const now = d.current();
    if (!now) return;
    const you: ChatTurn = { role: 'you', text, at: run.started, ...(spoken ? { spoken: true } : {}) };
    if (!parsed.readable) {
      d.onChange({ chat: keptChat(now.chat, [you, { role: 'model', text: '', at: Date.now(), failed: true }]) });
      return;
    }
    if (parsed.ops.length && order(now) !== order(d0)) throw new Error(MOVED);
    const applied = applyOps(now, parsed.ops, { newId, busy: d.busy() });
    const done = applied.changes.filter((c) => c.what !== 'skipped').map((c) => changeLine(c, d.t));
    const not = applied.changes.filter((c) => c.what === 'skipped').map((c) => changeLine(c, d.t));
    const model: ChatTurn = {
      role: 'model', text: parsed.reply, at: Date.now(),
      ...(done.length ? { changes: done } : {}), ...(not.length ? { skipped: not } : {}),
      ...(applied.wants.offer ? { offer: applied.wants.offer } : {}),
    };
    d.onChange({ ...(applied.next ?? {}), chat: keptChat(now.chat, [you, model]) });
    if (applied.work.length) d.onWork(applied.work);
    if (applied.wants.open) d.onOpen(applied.wants.open);
    if (applied.wants.tab) d.onTab(applied.wants.tab);
  } catch (e) {
    if (ctl.signal.aborted || isAbort(e)) {
      if (!drafts.get(id)?.trim()) drafts.set(id, text);
      return;
    }
    const error = e instanceof Error && e.message === MOVED
      ? d.t('The outline changed while the model was answering, so nothing was changed. Send the message again.')
      : explain(e, d.t('answer your message'));
    troubles.set(id, { message: text, spoken, error });
  } finally {
    runs.delete(id);
    ping();
  }
}

// ── words ─────────────────────────────────────────────────────────────────

function tabName(tab: ChatTab, t: T): string {
  if (tab === 'outline') return t('Outline');
  if (tab === 'sources') return t('Sources');
  if (tab === 'check') return t('Originality');
  return t('Details');
}

/** One change, said in the interface's language. */
export function changeLine(c: Change, t: T): string {
  switch (c.what) {
    case 'rewrite': return fill(t('Writing “{heading}” again'), { heading: c.heading });
    case 'write-rest': return c.n ? fill(t('Writing the {n} parts left'), { n: c.n }) : t('Continuing the document');
    case 'abstract': return t('Writing the abstract again');
    case 'renamed': return fill(t('Renamed “{from}” to “{to}”'), { from: c.from, to: c.to });
    case 'brief': return fill(t('New brief for “{heading}”'), { heading: c.heading });
    case 'words': return fill(t('“{heading}”: about {n} words'), { heading: c.heading, n: c.words });
    case 'added': return fill(t('Added “{heading}” at place {n}'), { heading: c.heading, n: c.at });
    case 'removed': return fill(t('Removed “{heading}”'), { heading: c.heading });
    case 'title': return fill(t('Title: “{title}”'), { title: c.title });
    case 'style': {
      const name = c.style === 'footnotes' ? t('Footnotes (Arabic style)')
        : ({ apa: 'APA 7', harvard: 'Harvard', chicago: 'Chicago', mla: 'MLA 9', ieee: 'IEEE' } as const)[c.style];
      return fill(t('Citation style: {style}'), { style: name });
    }
    case 'note': return t('Added to your notes — every part written from now on follows it');
    case 'open': return fill(t('Showing “{heading}”'), { heading: c.heading });
    case 'tab': return fill(t('Opened {tab}'), { tab: tabName(c.tab, t) });
    case 'save': return t('Save it with the button below');
    case 'skipped':
      switch (c.why) {
        case 'unknown': return fill(t('Skipped “{op}”: not something the app can do'), { op: c.op ?? '' });
        case 'no-part': return c.part ? fill(t('Skipped: there is no part {n}'), { n: c.part }) : t('Skipped a change to a part that is not there');
        case 'busy': return t('Skipped a change to the outline: the document is being written. Ask again when it stops.');
        case 'writing': return t('Skipped: that part is being written right now');
        case 'author': return t('Skipped: that part is yours to write');
        case 'too-many': return fill(t('Skipped the rest: at most {n} changes a message'), { n: MAX_OPS });
        case 'too-many-rewrites': return fill(t('Skipped: at most {n} parts are written again from one message'), { n: MAX_REWRITES });
        case 'nothing-left': return t('Skipped: every part is already written');
        case 'no-abstract': return t('Skipped: this kind of document has no abstract');
        case 'nothing-written': return t('Skipped: nothing is written yet to make an abstract from');
        default: return t('Skipped a change that could not be read');
      }
  }
}

function thinkingVerb(ms: number, t: T): string {
  const n = Math.floor(ms / 4000) % 3;
  if (n === 1) return t('Reading the document');
  if (n === 2) return t('Weighing the sources');
  return t('Reading your message');
}

/** Things to say, in the interface's language. One that ends in "…" is started in the box. */
function suggestions(d: Doc, t: T): string[] {
  const written = d.sections.some((s) => s.state === 'done');
  const left = d.sections.some((s) => s.state === 'waiting' || s.state === 'failed');
  return [
    written ? t('Summarise what the document argues') : '',
    written ? t('Which parts have the weakest sources?') : '',
    t('What is missing from the outline?'),
    written ? t('Rewrite the introduction to be shorter') : '',
    t('Add a part about …'),
    left ? t('Write the rest of the document') : '',
    written ? t('Save it as Word') : '',
  ].filter(Boolean);
}

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

type Ear = { mode: 'idle' } | { mode: 'recording'; since: number } | { mode: 'writing' };

export function ResearchChat({
  t, lang, doc, busy, ready, target, book, providers, onSettings, current, onChange, onWork, onOpen, onTab, onSaveWord, onSavePdf, saving,
}: Props) {
  useRuns();
  const id = doc.id;
  const run = runs.get(id);
  const trouble = troubles.get(id);
  const turns = doc.chat ?? [];
  const [text, setText] = useState(() => drafts.get(id) ?? '');
  const box = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLOListElement>(null);
  const can = ready;
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

  const stored = drafts.get(id) ?? '';
  useEffect(() => {
    if (stored !== text && !run) setText(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, run]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.blockSize = 'auto';
    el.style.blockSize = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text]);

  useLayoutEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, !!run, !!trouble]);

  const deps = (): Deps => ({ t, lang, target, book, busy, current: () => current() ?? doc, onChange, onWork, onOpen, onTab });
  const go = (message: string, spoken = false) => {
    if (!can || runs.has(id) || !message.trim()) return;
    write('');
    void send(id, message, spoken, deps());
  };
  const goRef = useRef(go);
  goRef.current = go;
  // A message Ask Vylo left here goes as soon as it can; without a key it stays in the box.
  useEffect(() => {
    if (!waiting.has(id) || !can || runs.has(id)) return;
    waiting.delete(id);
    const said = drafts.get(id) ?? '';
    if (said.trim()) go(said);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can, id]);
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

  // ── the microphone ──
  const recorder = useRef<Recorder | null>(null);
  const writing = useRef<AbortController | null>(null);
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
      const said = micLang(backend.kind === 'vylo' ? backend.voice.lang : 'auto', lang, doc.lang);
      const words = await transcribe(backend, audio, { name: speechFileName(r.type), signal: ctl.signal, lang: said });
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
      : t('Speak to your document');

  const elapsed = run ? Date.now() - run.started : 0;
  const lastModel = turns.map((x) => x.role).lastIndexOf('model');
  const status = run ? (run.chars ? t('Answering…') : `${thinkingVerb(elapsed, t)}…`) : '';

  return (
    <div className="vid-chat rsch-chat">
      {!ready && <p className="vid-chat-note"><Icon name="warning" size={12} />{t('Add an API key in Settings to talk to the document.')}</p>}

      <ol className="vid-chat-log" ref={log} aria-live="polite" aria-label={t('Conversation with the document')}>
        {turns.length === 0 && !run && !trouble && (
          <li className="vid-chat-empty">
            <span className="vid-chat-empty-mark" aria-hidden="true"><Icon name="chat" size={16} /></span>
            <b>{t('Talk to your research')}</b>
            <span className="vid-chat-empty-what">{t('Ask about what it says and what its sources say, or tell it what to change — a part written again, a new part, a new title, the rest written. Answers come from the document and its sources; every change is listed under the answer.')}</span>
          </li>
        )}
        {turns.map((turn, i) => (turn.role === 'you'
          ? (
            <li key={`${turn.at}-${i}`} className="vid-chat-turn is-you">
              <p className="vid-chat-text" dir="auto">
                {turn.spoken && <span className="rsch-spoken" title={t('Spoken')} aria-label={t('Spoken')}><Icon name="mic" size={11} /></span>}
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
                    ? <p className="vid-chat-text rsch-chat-text" dir="auto">{turn.text}</p>
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
                {turn.offer?.length && i === lastModel ? (
                  <div className="rsch-chat-offer">
                    {turn.offer.includes('docx') && (
                      <button type="button" className="ghost bordered" disabled={saving || busy()} onClick={onSaveWord}>
                        <Icon name="file" size={12} />{t('Save as Word…')}
                      </button>
                    )}
                    {turn.offer.includes('pdf') && (
                      <button type="button" className="ghost bordered" disabled={saving || busy()} onClick={onSavePdf}>
                        <Icon name="file" size={12} />{t('Save as PDF…')}
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
              {(run?.spoken ?? trouble?.spoken) && <span className="rsch-spoken" aria-label={t('Spoken')}><Icon name="mic" size={11} /></span>}
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
          {suggestions(doc, t).map((s) => (
            <button key={s} type="button" className="vid-chat-chip" disabled={!can} onClick={() => suggest(s)} dir="auto">{s}</button>
          ))}
        </div>
      )}

      {ear.mode === 'recording' && (
        <p className="rsch-listen" role="status">
          <span className="rsch-listen-dot" aria-hidden="true" />
          <b>{fill(t('Listening… {time}'), { time: clock(Date.now() - ear.since) })}</b>
          <span>{t('Press the microphone again to send.')}</span>
          <button type="button" className="ghost" onClick={cancelRecording}>{t('Cancel')}</button>
        </p>
      )}
      {ear.mode === 'writing' && backend && (
        <p className="rsch-listen" role="status">
          <span className="vid-spinner" aria-hidden="true" />
          <b>{fill(t('{name} is writing down what you said…'), { name: backend.name })}</b>
          <button type="button" className="ghost" onClick={cancelRecording}>{t('Cancel')}</button>
        </p>
      )}
      {dict.phase !== 'off' && (
        <p className="rsch-listen" role="status">
          <span className="rsch-listen-dot" aria-hidden="true" />
          <b>{dict.interim || t('Listening…')}</b>
          <span>{t('Press the microphone again to send.')}</span>
        </p>
      )}
      {(heardWrong || dict.error) && <p className="rsch-bad" role="alert">{heardWrong || t(dict.error!)}</p>}
      {noEar && !canRecord && !canDictate && (
        <p className="vid-chat-note rsch-no-ear">
          <Icon name="mic" size={12} />
          <span>{t('To speak to your document, set up Vylo Voice — it writes down Sorani, Badini, Arabic and English — or a speech-to-text provider in Settings.')}</span>
          <button type="button" className="ghost bordered" onClick={onSettings}>{t('Open Settings')}</button>
        </p>
      )}

      <form className={`vid-chat-compose${can ? '' : ' is-off'}`} onSubmit={(e) => { e.preventDefault(); go(text); }}>
        <textarea ref={box} value={text} dir="auto" rows={1} disabled={!can}
                  placeholder={can ? t('Ask about the research, or say what to change…') : ''} aria-label={t('Message to the document')}
                  onChange={(e) => write(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      go(text);
                    }
                  }} />
        <button type="button" className={`vid-chat-send rsch-mic${listening ? ' is-on' : ''}`} disabled={!can || !!run || ear.mode === 'writing'}
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
      <p className="vid-chat-hint">{t('Enter sends · Shift+Enter adds a line · the microphone listens until you press it again')}</p>
    </div>
  );
}
