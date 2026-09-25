import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { fill } from './i18n';
import { explain } from './errors';
import type { EffortBook } from './effort';
import { generate, type Target } from './generate';
import type { Brief, ChatTurn, Format, Style, Track, Transition, Video, VideoLang } from './videotypes';
import { kindName } from './VideoStoryboard';
import { composeMusic, musicCues } from './videosynth';
import { audioSeconds, fitScenesToVoice, isAbort, speakLine, speakerFor, toDataUrl, voiceForScenes } from './videomix';
import { TTS_KEY } from './whatsapptts';
import type { Provider } from './providers';
import { RowDownload } from './VideoDownloads';
import { mergeBrief, researchVideo, siteLogo, withSiteLogo } from './videoresearch';
import { MAX_OPS, MAX_SCENES, applyOps, chatPrompt, keptChat, parseChat, playedSeconds, type Change, type LookedUp } from './videochatops';

/**
 * Talking to the video: the Chat tab.
 *
 * Once a storyboard exists, the person says what they want — "shorter", "a
 * bolder style", "calmer music", "in Sorani" — and the video's own model
 * answers with a sentence and a list of operations (videochatops.ts). The app
 * checks every operation and applies the valid ones to the newest copy of
 * the video, all in one `onChange`, so the whole message is one undo step;
 * then it lists under the answer what changed and what was skipped.
 *
 * ## Nothing the model writes is run or rendered
 *
 * The answer is JSON read by `parseChat`; its reply is shown as text (React
 * escapes it — never HTML), its operations are applied field by field through
 * the storyboard's own repair. Music is composed by the app from a mood and a
 * tempo (videosynth.ts), never written by the model. Pictures are searched by
 * the panel's own run. Nothing reaches a file: the video lives in the app
 * until the person exports it (SAFETY.md).
 *
 * A message being answered lives outside React, like the panel's other runs,
 * so switching tabs does not lose it; its answer is applied to the newest
 * copy of the video when it arrives.
 */

type T = (s: string) => string;

interface Props {
  t: T;
  video: Video;
  /** A change the chat made — recorded for undo like one made by hand. */
  onChange: (next: Partial<Video>) => void;
  locked: boolean;
  /** Whether a model can be asked at all (a key, a plan). */
  ready: boolean;
  target: Target;
  efforts: EffortBook;
  /** Search pictures for every scene that wants one and has none. */
  onFindPictures: () => void;
  onError: (m: string) => void;
  /**
   * The newest copy of the video, wherever it was changed — for an answer
   * that arrives after the tab was left and the video edited elsewhere.
   * Without it, the copy this tab last drew.
   */
  current?: () => Video;
  /** The person's providers, where a speech service for the voice is found. */
  providers?: readonly Provider[];
}

// ── state that outlives the tab ───────────────────────────────────────────

interface Run {
  ctl: AbortController;
  message: string;
  started: number;
  /** Characters of the answer so far, so a long wait visibly moves. */
  chars: number;
  stage: 'asking' | 'looking' | 'music' | 'logo' | 'voice';
  retry?: { attempt: number; of: number };
  /** What is being looked up on the web now. */
  looking?: string;
  /** Lines spoken so far, of how many. */
  voiced?: { done: number; of: number };
}

/** A message that could not be answered: said under it, with Try again. Not kept in the video. */
interface Trouble { message: string; error: string }

const runs = new Map<string, Run>();
const troubles = new Map<string, Trouble>();
/** What the composer holds, per video, so a tab switch keeps a half-written message. */
const drafts = new Map<string, string>();
/** The newest copy of each video this tab has drawn or written. */
const latest = new Map<string, Video>();
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

/** Said by the run as a code, so the sentence is chosen where `t` is. */
const MOVED = 'video-chat:moved';

interface Deps {
  t: T;
  target: Target;
  efforts: EffortBook;
  /** The person's providers, where a speech service for the voice is found. */
  providers: readonly Provider[];
  onChange: (next: Partial<Video>) => void;
  onFindPictures: () => void;
  current: () => Video | undefined;
}

/**
 * Send one message and apply its answer.
 *
 * The answer's ops are applied to the newest copy of the video, and all of it
 * — scenes, settings, the music when asked for, and the two new turns — goes
 * to `onChange` once, which the panel records as one undo step. Music is
 * composed before that, so it lands in the same step; when it cannot be, the
 * rest still applies and the line under the answer says so. A storyboard
 * whose scenes were added, removed or reordered while the model was answering
 * gets nothing: the scene numbers the model used would name other scenes.
 */
async function send(id: string, message: string, d: Deps) {
  if (runs.has(id)) return;
  const text = message.trim();
  if (!text) return;
  const ctl = new AbortController();
  const run: Run = { ctl, message: text, started: Date.now(), chars: 0, stage: 'asking' };
  runs.set(id, run);
  troubles.delete(id);
  ping();
  const now = () => d.current() ?? latest.get(id);
  const order = (v: Video | undefined) => (v?.scenes ?? []).map((s) => s.id).join(' ');
  try {
    const v0 = now();
    if (!v0) return;
    // The video as the model sees it, with what this message has looked up so far.
    let brief: Brief | undefined = v0.brief;
    const withBrief = (v: Video): Video => (brief && brief !== v.brief ? { ...v, brief, lookup: true } : v);
    const looked: LookedUp[] = [];
    let parsed: ReturnType<typeof parseChat> = { reply: '', ops: [], readable: false };
    // The model may ask to look things up before it acts. The app does, and
    // asks again with what was found — twice at most, so a message ends.
    for (let round = 0; ; round++) {
      const base = withBrief(now() ?? v0);
      const p = chatPrompt(base, base.chat, text, looked);
      run.stage = 'asking';
      run.chars = 0;
      ping();
      const out = await generate(d.target, {
        system: p.system, user: p.user, maxTokens: 6000, efforts: d.efforts, signal: ctl.signal,
        onText: (x) => { run.chars += x.length; run.retry = undefined; ping(); },
        onRestart: () => { run.chars = 0; },
        onRetry: (attempt, of) => { run.retry = { attempt, of }; ping(); },
      });
      parsed = parseChat(out.text);
      const asks = parsed.readable ? (applyOps(base, parsed.ops, newId, text).wants.lookups ?? []) : [];
      if (!asks.length || round >= 2) break;
      run.stage = 'looking';
      for (const subject of asks) {
        run.looking = subject;
        ping();
        let got: Brief | null = null;
        try {
          got = await withSiteLogo(
            await researchVideo(base.request, { lang: base.lang, format: base.format, subjects: [{ name: subject }], signal: ctl.signal }),
            { signal: ctl.signal },
          );
        } catch (e) {
          if (ctl.signal.aborted || isAbort(e)) throw e;
        }
        const useful = !!got && (got.facts.length > 0 || got.pictures.length > 0 || !!got.logo);
        if (useful) brief = mergeBrief(brief, got);
        looked.push({
          subject, found: useful ? got!.subjects : [], facts: useful ? got!.facts.length : 0, photos: useful ? got!.pictures.length : 0,
          logo: useful && !!got!.logo, ...(useful && got!.website ? { website: got!.website } : {}),
        });
      }
    }
    const you: ChatTurn = { role: 'you', text, at: run.started };
    if (!parsed.readable) {
      d.onChange({ chat: keptChat(now()?.chat, [you, { role: 'model', text: '', at: Date.now(), failed: true }]) });
      return;
    }
    if (order(now()) !== order(v0)) throw new Error(MOVED);

    let applied = applyOps(withBrief(now()!), parsed.ops, newId, text);
    let track: Track | undefined;
    let musicError = '';
    if (applied.wants.music) {
      run.stage = 'music';
      ping();
      const planned = { ...withBrief(now()!), ...applied.next };
      try {
        track = await composeMusic(applied.wants.music, playedSeconds(planned), { cues: musicCues(planned), signal: ctl.signal });
      } catch (e) {
        if (ctl.signal.aborted || isAbort(e)) throw e;
        musicError = explain(e, d.t('compose music for the video'));
      }
      // The video may have changed while the music was made: the ops go onto its newest copy.
      if (order(now()) !== order(v0)) throw new Error(MOVED);
      const spec = applied.wants.music;
      applied = applyOps(withBrief(now()!), parsed.ops, newId, text);
      applied.wants.music = spec;
    }
    // The logo, found before anything is applied, so it lands in the same undo step.
    let logoSrc: string | null = null;
    if (applied.wants.logo) {
      run.stage = 'logo';
      ping();
      const base = withBrief(now()!);
      logoSrc = base.brief?.logo?.src ?? null;
      const site = applied.wants.logo.site ?? base.brief?.website;
      try {
        if (!logoSrc && site) {
          const names = [...(base.brief?.subjects ?? []), base.brand?.name ?? '', base.title].filter((n) => n.trim());
          logoSrc = (await siteLogo(site, names, { signal: ctl.signal }))?.src ?? null;
        } else if (!logoSrc && !base.brief) {
          // Never looked up: look the subject up now — Wikimedia first, then its own website.
          const got = await withSiteLogo(await researchVideo(base.request, { lang: base.lang, format: base.format, signal: ctl.signal }), { signal: ctl.signal });
          brief = mergeBrief(brief, got);
          logoSrc = got.logo?.src ?? null;
        }
      } catch (e) {
        if (ctl.signal.aborted || isAbort(e)) throw e;
      }
      if (order(now()) !== order(v0)) throw new Error(MOVED);
    }
    const cur = now()!;
    const next: Partial<Video> = { ...applied.next };
    let changes: Change[] = [...looked.map((l): Change => ({ what: 'looked', subject: l.subject, found: l.found.length > 0 })), ...applied.changes];
    if (brief && brief !== cur.brief) { next.brief = brief; next.lookup = true; }
    if (applied.wants.logo) {
      if (logoSrc) next.brand = { ...(next.brand ?? cur.brand ?? {}), logo: logoSrc };
      else changes = changes.map((c) => (c.what === 'logo' ? { what: 'logo-failed' } : c));
    }
    if (applied.wants.music) {
      if (track) next.audio = { ...(next.audio ?? cur.audio ?? {}), music: track };
      else changes = changes.map((c) => (c.what === 'music' ? { what: 'music-failed', mood: c.mood, error: musicError } : c));
    }
    // The voice: every narration line spoken by the person's own speech
    // service, into the same step. The lines are the ones this answer leaves.
    if (applied.wants.voice) {
      const film = { ...cur, ...next };
      let stored: string | null = null;
      try { stored = localStorage.getItem(TTS_KEY); } catch { /* private mode */ }
      const speaker = speakerFor(d.providers, stored, film.audio?.voiceName);
      const lines = film.scenes.filter((x) => x.narration?.trim());
      if (!speaker) changes.push({ what: 'voice-failed', error: d.t('No speech service is set up — add one in Settings, then ask again.') });
      else if (!lines.length) changes.push({ what: 'voice-failed', error: d.t('No scene has a narration line to speak yet.') });
      else {
        run.stage = 'voice';
        run.voiced = { done: 0, of: lines.length };
        ping();
        try {
          const voice = { ...(voiceForScenes(film) ?? {}) };
          let made = 0;
          for (const x of lines) {
            const said = x.narration!.trim();
            if (voice[x.id]?.text !== said) {
              const bytes = await speakLine(speaker, said, { signal: ctl.signal });
              voice[x.id] = { text: said, src: toDataUrl(bytes, 'audio/mpeg'), seconds: await audioSeconds(bytes) };
              made++;
            }
            run.voiced.done++;
            ping();
          }
          const audio = { ...(film.audio ?? {}), narrate: true, voice, voiceName: speaker.speech.voice };
          const fit = fitScenesToVoice({ scenes: film.scenes, audio });
          next.audio = audio;
          if (fit.longer.length) next.scenes = fit.scenes;
          changes.push({ what: 'voice', lines: made || lines.length });
        } catch (e) {
          if (ctl.signal.aborted || isAbort(e)) throw e;
          changes.push({ what: 'voice-failed', error: explain(e, d.t('make the voice')) });
        }
      }
      if (order(now()) !== order(v0)) throw new Error(MOVED);
    }
    if (applied.wants.download) changes.push({ what: 'download' });
    const done = changeLines(changes.filter((c) => !failed(c)), d.t);
    const not = changes.filter(failed).map((c) => changeLine(c, d.t));
    const model: ChatTurn = {
      role: 'model', text: parsed.reply, at: Date.now(),
      ...(done.length ? { changes: done } : {}), ...(not.length ? { skipped: not } : {}),
      ...(applied.wants.download ? { offer: ['download'] as ChatTurn['offer'] } : {}),
    };
    d.onChange({ ...next, chat: keptChat(cur.chat, [you, model]) });
    if (applied.wants.pictures) d.onFindPictures();
  } catch (e) {
    if (ctl.signal.aborted || isAbort(e)) {
      // Stopped: nothing was applied, and the message goes back where it was written.
      if (!drafts.get(id)?.trim()) drafts.set(id, text);
      return;
    }
    const error = e instanceof Error && e.message === MOVED
      ? d.t('The storyboard changed while the model was answering, so nothing was applied. Send the message again.')
      : explain(e, d.t('answer your message'));
    troubles.set(id, { message: text, error });
  } finally {
    runs.delete(id);
    ping();
  }
}

function stop(id: string) {
  runs.get(id)?.ctl.abort();
}

// ── words ─────────────────────────────────────────────────────────────────

const failed = (c: Change) => c.what === 'skipped' || c.what === 'music-failed' || c.what === 'logo-failed' || c.what === 'voice-failed'
  || (c.what === 'looked' && !c.found);

function formatName(f: Format, t: T): string {
  if (f === 'portrait') return t('Vertical 9:16');
  if (f === 'square') return t('Square 1:1');
  return t('Wide 16:9');
}

function styleName(s: Style, t: T): string {
  if (s === 'bold') return t('Bold');
  if (s === 'elegant') return t('Elegant');
  if (s === 'neon') return t('Neon');
  if (s === 'minimal') return t('Minimal');
  if (s === 'warm') return t('Warm');
  return t('Modern');
}

function transitionName(x: Transition, t: T): string {
  if (x === 'fade') return t('Fade');
  if (x === 'slide') return t('Slide');
  if (x === 'wipe') return t('Wipe');
  if (x === 'zoom') return t('Zoom');
  return t('Cut');
}

function langName(l: VideoLang, t: T): string {
  if (l === 'ar') return t('Arabic');
  if (l === 'ckb') return t('Kurdish — Sorani');
  if (l === 'kmr') return t('Kurdish — Badini');
  return t('English');
}

function musicLine(mood: string, t: T): string {
  if (mood === 'uplifting') return t('New music composed — uplifting');
  if (mood === 'calm') return t('New music composed — calm');
  if (mood === 'cinematic') return t('New music composed — cinematic');
  if (mood === 'corporate') return t('New music composed — corporate');
  if (mood === 'electronic') return t('New music composed — electronic');
  if (mood === 'lofi') return t('New music composed — lo-fi');
  if (mood === 'epic') return t('New music composed — epic');
  return t('New music composed — oriental');
}

/** One change, said in the interface's language. */
export function changeLine(c: Change, t: T): string {
  switch (c.what) {
    case 'edited':
      return c.kind ? fill(t('Scene {n} is now: {kind}'), { n: c.scene, kind: kindName(c.kind, t) }) : fill(t('Scene {n}: new words'), { n: c.scene });
    case 'added': return fill(t('Added a scene at {n}: {kind}'), { n: c.at, kind: kindName(c.kind, t) });
    case 'removed': return fill(t('Removed scene {n}'), { n: c.scene });
    case 'moved': return fill(t('Moved scene {n} to place {to}'), { n: c.scene, to: c.to });
    case 'duplicated': return fill(t('Copied scene {n}'), { n: c.scene });
    case 'seconds':
      return c.scene === null ? fill(t('Every scene lasts {s} s'), { s: c.seconds }) : fill(t('Scene {n} lasts {s} s'), { n: c.scene, s: c.seconds });
    case 'transition':
      return c.scene === null
        ? fill(t('Every scene hands over with: {transition}'), { transition: transitionName(c.transition, t) })
        : fill(t('Scene {n} hands over with: {transition}'), { n: c.scene, transition: transitionName(c.transition, t) });
    case 'length': return fill(t('The video now runs {n} s'), { n: c.seconds });
    case 'style': return fill(t('Style: {style}'), { style: styleName(c.style, t) });
    case 'title': return fill(t('Renamed to “{title}”'), { title: c.title });
    case 'brand': {
      const parts: string[] = [];
      if (c.name === null) parts.push(t('Brand name removed'));
      else if (c.name) parts.push(fill(t('Brand name: {name}'), { name: c.name }));
      if (c.primary !== undefined || c.accent !== undefined) parts.push(t('Brand colours changed'));
      return parts.join(' · ');
    }
    case 'language': return fill(t('The words are now in {lang}'), { lang: langName(c.lang, t) });
    case 'pictures': return c.scene === null ? t('Looking for new pictures') : fill(t('Scene {n}: looking for a new picture'), { n: c.scene });
    case 'music': return musicLine(c.mood, t);
    case 'music-failed': return fill(t('The music could not be composed: {error}'), { error: c.error });
    case 'volume': return fill(t('Music volume: {n}%'), { n: c.value });
    case 'no-music': return t('Music removed');
    case 'logo': return t('The logo is on the brand — it shows on the first screen and at the close');
    case 'looked': return c.found ? fill(t('Looked up “{subject}” on the web'), { subject: c.subject }) : fill(t('Nothing was found on the web for “{subject}”'), { subject: c.subject });
    case 'photos': return fill(t('Photographs from the web put in {n} scenes'), { n: c.scenes });
    case 'format': return fill(t('Shape: {format}'), { format: formatName(c.format, t) });
    case 'voice': return fill(t('The voice is made: {n} lines spoken'), { n: c.lines });
    case 'voice-failed': return fill(t('The voice could not be made: {error}'), { error: c.error });
    case 'download': return t('Download it with the button below');
    case 'logo-failed': return t('No logo could be found on the web — add one under Look → Brand');
    case 'narration':
      return c.removed ? fill(t('Scene {n}: narration line removed'), { n: c.scene }) : fill(t('Scene {n}: new narration line'), { n: c.scene });
    case 'narrate': return c.on ? t('Narration on — make the voice in the Sound tab') : t('Narration off');
    case 'captions': return c.on ? t('Captions on') : t('Captions off');
    case 'watermark': return c.on ? t('Brand in the corner on') : t('Brand in the corner off');
    case 'credits': return c.on ? t('Credits card on') : t('Credits card off');
    case 'skipped':
      switch (c.why) {
        case 'unknown': return fill(t('Skipped “{op}”: not something the app can do'), { op: c.op });
        case 'no-scene': return c.scene ? fill(t('Skipped: there is no scene {n}'), { n: c.scene }) : t('Skipped a change to a scene that is not there');
        case 'last-scene': return t('Skipped: the only scene cannot be removed');
        case 'no-picture': return c.scene ? fill(t('Skipped: scene {n} shows no picture of its own'), { n: c.scene }) : t('Skipped: no scene shows a picture of its own');
        case 'language': return t('Not translated: not every scene was rewritten, so no words were changed');
        case 'too-many': return fill(t('Skipped the rest: at most {n} changes a message'), { n: MAX_OPS });
        case 'full': return fill(t('Skipped: a video holds at most {n} scenes'), { n: MAX_SCENES });
        case 'unfit': return c.scene ? fill(t('Skipped: that would leave scene {n} with nothing to show'), { n: c.scene }) : t('Skipped a change that would leave a scene with nothing to show');
        case 'unsourced':
          return c.scene
            ? fill(t('Skipped: scene {n} would show a number nobody gave — write the number in your message'), { n: c.scene })
            : t('Skipped a new scene with a number nobody gave — write the number in your message');
        default: return t('Skipped a change that could not be read');
      }
  }
}

/** Scene numbers as a short list: 1–6, or 1, 3–4. */
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

/**
 * The changes, one line each — except new words in several scenes, which is
 * one line where the first of them was: a translation is "Scenes 1–6: new
 * words", not six lines saying the same thing.
 */
export function changeLines(changes: readonly Change[], t: T): string[] {
  const reworded = changes.filter((c): c is Extract<Change, { what: 'edited' }> => c.what === 'edited' && !c.kind).map((c) => c.scene);
  const merge = new Set(reworded).size > 1;
  const out: string[] = [];
  let said = false;
  for (const c of changes) {
    if (merge && c.what === 'edited' && !c.kind) {
      if (!said) out.push(fill(t('Scenes {list}: new words'), { list: numbers(reworded) }));
      said = true;
    } else out.push(changeLine(c, t));
  }
  return out;
}

/** What the model is doing before its answer arrives; a line that changes says it is working. */
function thinkingVerb(ms: number, t: T): string {
  const n = Math.floor(ms / 4000) % 4;
  if (n === 1) return t('Looking at the scenes');
  if (n === 2) return t('Planning the changes');
  if (n === 3) return t('Checking the facts');
  return t('Reading your message');
}

/** Things to say, in the interface's language. One that ends in "…" is started in the box for the person to finish. */
function suggestions(v: Video, t: T): string[] {
  return [
    t('Make it shorter'),
    t('Make the title punchier'),
    t('Change the style to bold'),
    t('Add a scene about …'),
    t('Compose calmer music'),
    v.lang === 'ckb' ? t('Translate it to Arabic') : t('Translate it to Kurdish Sorani'),
    t('Turn on captions'),
  ];
}

// ── the tab ───────────────────────────────────────────────────────────────

export function VideoChat({ t, video, onChange, locked, ready, target, efforts, onFindPictures, onError: _onError, current, providers = [] }: Props): JSX.Element {
  useRuns();
  latest.set(video.id, video);
  const id = video.id;
  const run = runs.get(id);
  const trouble = troubles.get(id);
  const turns = video.chat ?? [];
  const [text, setText] = useState(() => drafts.get(id) ?? '');
  const box = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLOListElement>(null);
  const can = ready && !locked;
  useSecond(!!run);

  // A message stopped mid-answer comes back to the box it was written in.
  const stored = drafts.get(id) ?? '';
  useEffect(() => {
    if (stored !== text && !run) setText(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, run]);

  const write = (s: string) => {
    drafts.set(id, s);
    setText(s);
  };

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

  const deps = (): Deps => ({ t, target, efforts, providers, onChange, onFindPictures, current: () => current?.() ?? latest.get(id) });
  const go = (message: string) => {
    if (!can || runs.has(id) || !message.trim()) return;
    write('');
    void send(id, message, deps());
  };
  const suggest = (s: string) => {
    if (s.endsWith('…')) {
      write(`${s.slice(0, -1).trimEnd()} `);
      requestAnimationFrame(() => {
        const el = box.current;
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      });
    } else go(s);
  };

  const elapsed = run ? Date.now() - run.started : 0;
  // Only the newest answer's offer stands: an older one belonged to an older video.
  const lastModel = turns.map((x) => x.role).lastIndexOf('model');
  const status = run
    ? run.stage === 'music' ? t('Composing the music…')
      : run.stage === 'logo' ? t('Finding the logo…')
      : run.stage === 'looking' ? fill(t('Looking up “{subject}” on the web…'), { subject: run.looking ?? '' })
      : run.stage === 'voice' ? fill(t('Making the voice: {n} of {of}…'), { n: run.voiced?.done ?? 0, of: run.voiced?.of ?? 0 })
      : run.chars ? t('Writing the changes…') : `${thinkingVerb(elapsed, t)}…`
    : '';

  return (
    <div className="vid-chat">
      {!ready && <p className="vid-chat-note"><Icon name="warning" size={12} />{t('Add an API key in Settings to talk to the video.')}</p>}
      {ready && locked && <p className="vid-chat-note"><Icon name="clock" size={12} />{t('Wait until the storyboard and its pictures are finished.')}</p>}

      <ol className="vid-chat-log" ref={log} aria-live="polite" aria-label={t('Conversation with the video')}>
        {turns.length === 0 && !run && !trouble && (
          <li className="vid-chat-empty">
            <span className="vid-chat-empty-mark" aria-hidden="true"><Icon name="sparkle" size={16} /></span>
            <b>{t('Talk to your video')}</b>
            <span className="vid-chat-empty-what">{t('Say what to change in your own words — shorter scenes, a new style, calmer music, a translation. The model changes the storyboard and lists every change under its answer; one undo takes a whole message back.')}</span>
          </li>
        )}
        {turns.map((turn, i) => (turn.role === 'you'
          ? (
            <li key={`${turn.at}-${i}`} className="vid-chat-turn is-you">
              <p className="vid-chat-text" dir="auto">{turn.text}</p>
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
                {/* A download is the person's to press: the chat offers it, and the button does it. */}
                {turn.offer?.includes('download') && i === lastModel && (
                  <div className="vid-chat-offer">
                    <RowDownload t={t} video={video} locked={locked} />
                    <span>{t('Download MP4')}</span>
                  </div>
                )}
              </div>
            </li>
          )))}
        {(run || trouble) && (
          <li className={`vid-chat-turn is-you is-pending${trouble && !run ? ' is-stuck' : ''}`}>
            <p className="vid-chat-text" dir="auto">{run?.message ?? trouble?.message}</p>
          </li>
        )}
        {run && (
          <li className="vid-chat-turn is-model is-working" role="status">
            <span className="vid-chat-mark" aria-hidden="true"><span className="vid-glyph">✻</span></span>
            <div className="vid-chat-status">
              <b>{status}</b>
              <span className="vid-chat-clock">
                <span>{fill(t('Running for {time}'), { time: clock(elapsed) })}</span>
                {run.stage === 'asking' && run.chars > 0 && <span>{fill(t('{n} characters'), { n: run.chars.toLocaleString() })}</span>}
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
                <button type="button" className="ghost bordered" disabled={!can} onClick={() => go(trouble.message)}>
                  {t('Try again')}
                </button>
                <button type="button" className="ghost" onClick={() => { troubles.delete(id); ping(); }}>{t('Dismiss')}</button>
              </span>
            </div>
          </li>
        )}
      </ol>

      {!run && !text.trim() && (
        <div className="vid-chat-chips" role="group" aria-label={t('Suggestions')}>
          {suggestions(video, t).map((s) => (
            <button key={s} type="button" className="vid-chat-chip" disabled={!can} onClick={() => suggest(s)} dir="auto">{s}</button>
          ))}
        </div>
      )}

      <form className={`vid-chat-compose${can ? '' : ' is-off'}`} onSubmit={(e) => { e.preventDefault(); go(text); }}>
        <textarea ref={box} value={text} dir="auto" rows={1} disabled={!can}
                  placeholder={can ? t('Tell the video what to change…') : ''} aria-label={t('Message to the video')}
                  onChange={(e) => write(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      go(text);
                    }
                  }} />
        {run
          ? (
            <button type="button" className="vid-chat-send is-stop" onClick={() => stop(id)} title={t('Stop')} aria-label={t('Stop')}>
              <Icon name="stop" size={14} />
            </button>
          )
          : (
            <button type="submit" className="vid-chat-send" disabled={!can || !text.trim()} title={t('Send')} aria-label={t('Send')}>
              <Icon name="send" size={13} />
            </button>
          )}
      </form>
      <p className="vid-chat-hint">{t('Enter sends · Shift+Enter adds a line · one undo takes a whole message back')}</p>
    </div>
  );
}
