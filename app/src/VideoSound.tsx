import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { fill } from './i18n';
import { explain } from './errors';
import type { Provider } from './providers';
import { generate, type Target } from './generate';
import type { EffortBook } from './effort';
import { TTS_KEY, langOf as systemLangOf, voiceFor as systemVoiceFor } from './whatsapptts';
import type { MusicSpec, Track, Video, VideoAudio } from './videotypes';
import { durationInFrames, isRtl } from './video';
import { FPS } from './videotypes';
import { kindName } from './VideoStoryboard';
import { KEY_NAMES, MUSIC_MOODS, arrange, composeMusic, moodForStyle, moodTempo, musicCues, type Mood as SynthMood } from './videosynth';
import {
  MOODS, MusicError, VOICES, audioSeconds, dataUrlBytes, encodeWav, fetchTrackBytes, fingerprint, fitScenesToVoice,
  isAbort, linesOver, moodFor, musicVolumeOf, narrationPrompt, parseNarration, searchMusic, speakLine, speakerFor,
  staleVoices, toDataUrl, trackOf, voiceForScenes, wordBudget, wordsIn, type Mood, type TrackCandidate, type VoiceFit,
} from './videomix';

/**
 * The Sound tab: music under the video, a voice reading each scene's
 * narration, and that narration as captions.
 *
 * Music comes from Openverse under licences that allow reuse, fetched once
 * and kept in the video with its credit (videomix.ts). The narration is
 * written by the video's own model — words only, read back through
 * `parseNarration` — and spoken by the person's own speech provider, the one
 * WhatsApp's voice notes use, its key sent only to its own address. Nothing
 * here writes a file: the sound lives in the video, and reaches a file only
 * through Export, which the person presses.
 *
 * Runs (writing the narration, making the voice) live outside React, so a
 * tab switch does not stop them; each result is merged into the newest copy
 * of the video as it arrives.
 */

type T = (s: string) => string;

interface Props {
  t: T;
  video: Video;
  onChange: (next: Partial<Video>) => void;
  locked: boolean;
  providers: readonly Provider[];
  onError: (m: string) => void;
  /** The video's model route (VideoPanel's `targetOf`), for writing the narration. Without it, the button says why. */
  target?: Target;
  efforts?: EffortBook;
}

// ── state that outlives the tab ───────────────────────────────────────────

interface Run {
  kind: 'write' | 'voice';
  ctl: AbortController;
  done: number;
  of: number;
  /** Characters of the model's answer so far. */
  chars: number;
}

interface Search {
  words: string;
  mood?: Mood['id'];
  state: 'busy' | 'done' | 'error';
  results: TrackCandidate[];
  error?: unknown;
  ctl?: AbortController;
}

const runs = new Map<string, Run>();
const searches = new Map<string, Search>();
/** The newest copy of each video this tab has seen or written — what a run merges into. */
const latest = new Map<string, Video>();
/** The last track a video had, so switching music off and on again keeps it. */
const lastTrack = new Map<string, Track>();
/** The voice chosen for each video, before it is used. */
const voicePick = new Map<string, string>();
/** What the last run changed, said once under the buttons. */
const notes = new Map<string, string>();
/** Fetched tracks, by URL: listening first and then choosing fetches once. */
const fetched = new Map<string, Promise<Uint8Array>>();

/** A piece being composed, or composed, for a video (videosynth.ts). */
interface Take {
  spec: MusicSpec;
  /** The video's length it was composed for, in seconds, and its cuts. */
  film: number;
  cues: number[];
  state: 'busy' | 'done' | 'error';
  fraction: number;
  track?: Track;
  error?: unknown;
  ctl?: AbortController;
  /** Put straight into the video when done: composing again to fit. */
  fit?: boolean;
}

/** The composer's knobs for each video, before and after composing. */
interface Knobs { mood: SynthMood; tempo?: number; energy: number; key?: number }

const takes = new Map<string, Take>();
const knobs = new Map<string, Knobs>();

/**
 * Composes in the background, like the voice: a tab switch does not stop
 * it. `put` receives the track when it is ready and should be used.
 */
function startCompose(id: string, spec: MusicSpec, film: number, cues: number[], put?: (track: Track) => void) {
  takes.get(id)?.ctl?.abort();
  const ctl = new AbortController();
  const take: Take = { spec, film, cues, state: 'busy', fraction: 0, ctl, fit: Boolean(put) };
  takes.set(id, take);
  ping();
  let shown = 0;
  composeMusic(spec, film, {
    cues, signal: ctl.signal,
    onProgress: (f) => { take.fraction = f; if (Date.now() - shown > 120) { shown = Date.now(); ping(); } },
  }).then(
    (track) => {
      if (takes.get(id) !== take) return;
      Object.assign(take, { state: 'done', track, ctl: undefined });
      put?.(track);
      ping();
    },
    (e: unknown) => {
      if (takes.get(id) !== take) return;
      if (isAbort(e)) takes.delete(id);
      else Object.assign(take, { state: 'error', error: e, ctl: undefined });
      ping();
    },
  );
}

/** A new seed: the spec keeps it, so the piece can be composed again exactly. */
const freshSeed = () => Math.floor(Math.random() * 1_000_000_000);

/** A composed track's mood, named in the interface's language. */
function moodLabel(t: T, mood: SynthMood | undefined): string {
  return t(MUSIC_MOODS.find((m) => m.id === mood)?.label ?? 'Uplifting');
}

const listeners = new Set<() => void>();

function ping() {
  for (const l of listeners) l();
}

function useTick() {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
}

/** Change the video, and remember the change for a run that is still going. */
function commit(id: string, onChange: (n: Partial<Video>) => void, next: Partial<Video>) {
  const cur = latest.get(id);
  if (cur) latest.set(id, { ...cur, ...next });
  onChange(next);
}

function bytesOf(c: TrackCandidate): Promise<Uint8Array> {
  const hit = fetched.get(c.url);
  if (hit) return hit;
  const p = fetchTrackBytes(c);
  fetched.set(c.url, p);
  p.catch(() => fetched.delete(c.url));
  while (fetched.size > 12) fetched.delete(fetched.keys().next().value as string);
  return p;
}

// ── listening ─────────────────────────────────────────────────────────────

/**
 * One player for the whole tab, so only one thing is heard at a time. It
 * plays blob: URLs — the CSP's `media-src` allows `blob:` and not `data:`.
 */
let player: HTMLAudioElement | null = null;
let playing = '';
const blobUrls = new Map<string, string>();

function audioEl(): HTMLAudioElement {
  if (!player) {
    player = new Audio();
    player.preload = 'auto';
    player.addEventListener('ended', () => { playing = ''; ping(); });
  }
  return player;
}

/** A blob: URL for bytes, made once per sound. */
function blobUrlOf(key: string, bytes: () => Uint8Array | null, type: string): string | null {
  const hit = blobUrls.get(key);
  if (hit) return hit;
  const b = bytes();
  if (!b) return null;
  const url = URL.createObjectURL(new Blob([b.buffer as ArrayBuffer], { type }));
  blobUrls.set(key, url);
  while (blobUrls.size > 24) {
    const [k, u] = blobUrls.entries().next().value as [string, string];
    blobUrls.delete(k);
    if (playing !== k) URL.revokeObjectURL(u);
  }
  return url;
}

let silent: string | null = null;

/**
 * Called in the click itself: WebKit lets an element play later, after an
 * await, only if it was started inside a gesture. A few silent samples do it.
 */
function unlock() {
  const el = audioEl();
  if (!silent) silent = URL.createObjectURL(new Blob([encodeWav([new Float32Array(64)], 8000).buffer as ArrayBuffer], { type: 'audio/wav' }));
  if (!el.src || el.paused) {
    el.src = silent;
    el.play().catch(() => undefined);
  }
}

function stopAll() {
  try { window.speechSynthesis?.cancel(); } catch { /* none */ }
  if (player) player.pause();
  playing = '';
  ping();
}

async function playUrl(key: string, url: string) {
  const el = audioEl();
  el.pause();
  try { window.speechSynthesis?.cancel(); } catch { /* none */ }
  playing = key;
  ping();
  el.src = url;
  try {
    await el.play();
  } catch {
    if (playing === key) { playing = ''; ping(); }
  }
}

/** The computer's own voice reading a line — a preview only, since it gives back no audio. */
function speakSystem(key: string, text: string) {
  const say = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!say) return;
  stopAll();
  const u = new SpeechSynthesisUtterance(text);
  const voices = say.getVoices();
  const want = systemVoiceFor(text, voices.map((v) => ({ name: v.name, lang: v.lang })));
  const found = want ? voices.find((v) => v.name === want.name) : undefined;
  if (found) u.voice = found;
  const lang = systemLangOf(text);
  if (lang) u.lang = lang;
  u.onend = () => { if (playing === key) { playing = ''; ping(); } };
  u.onerror = u.onend;
  playing = key;
  ping();
  say.speak(u);
}

// ── small pieces ──────────────────────────────────────────────────────────

function mmss(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="vid-sound-switch" title={label}>
      <input type="checkbox" role="switch" aria-label={label} checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

function PlayButton({ t, on, busy, onClick, label }: { t: T; on: boolean; busy?: boolean; onClick: () => void; label?: string }) {
  return (
    <button type="button" className={`vid-sound-play${on ? ' on' : ''}`} aria-pressed={on} onClick={onClick}
            aria-label={on ? t('Stop') : label ?? t('Listen')} title={on ? t('Stop') : label ?? t('Listen')}>
      {busy ? <span className="vid-spinner" aria-hidden="true" /> : <Icon name={on ? 'pause' : 'play'} size={12} />}
    </button>
  );
}

function Card({ icon, title, about, control, children }: { icon: ReactNode; title: string; about: string; control?: ReactNode; children?: ReactNode }) {
  return (
    <section className="vid-sound-card">
      <header className="vid-sound-head">
        <span className="vid-sound-glyph" aria-hidden="true">{icon}</span>
        <span className="vid-sound-what"><b>{title}</b><span>{about}</span></span>
        {control}
      </header>
      {children}
    </section>
  );
}

const NOTE = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 12.5V3.2l7-1.4v9.2" />
    <circle cx="4.2" cy="12.5" r="1.8" />
    <circle cx="11.2" cy="11" r="1.8" />
  </svg>
);

const WAVE = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M2 7v2M5 4.5v7M8 2.5v11M11 5v6M14 7v2" />
  </svg>
);

const CAPTION = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1.5" y="3" width="13" height="10" rx="2" />
    <path d="M4.5 10h3M9.5 10h2M4.5 7.5h7" />
  </svg>
);

/** A music problem as a sentence. */
function sayMusic(t: T, e: unknown, doing: string): string {
  if (e instanceof MusicError) {
    if (e.trouble === 'busy') return t('Openverse is asking for a pause. Try again in a minute.');
    if (e.trouble === 'offline') return t('Openverse could not be reached. Check the connection and try again.');
    if (e.trouble === 'too-big') return t('That track is too big to keep in the video. Choose a shorter one.');
    if (e.trouble === 'not-audio') return t('That track could not be read as MP3. Choose another.');
  }
  if ((e as { name?: string })?.name === 'TimeoutError') return t('It took too long to answer. Try again.');
  return explain(e, doing);
}

// ── the tab ───────────────────────────────────────────────────────────────

export function VideoSound({ t, video, onChange, locked, providers, onError, target, efforts }: Props): JSX.Element | null {
  useTick();
  latest.set(video.id, video);
  const id = video.id;
  const audio: VideoAudio = video.audio ?? {};
  const setAudio = (next: Partial<VideoAudio>) => {
    const cur = latest.get(id) ?? video;
    commit(id, onChange, { audio: { ...(cur.audio ?? {}), ...next } });
  };
  const run = runs.get(id);
  const rtl = isRtl(video.lang);

  // Unmounting stops what is being heard; a run goes on.
  useEffect(() => () => stopAll(), []);

  return (
    <div className="vid-sound">
      <MusicCard t={t} video={video} audio={audio} setAudio={setAudio} onError={onError} />
      <VoiceCard t={t} video={video} audio={audio} setAudio={setAudio} onChange={onChange} run={run} rtl={rtl}
                 locked={locked} providers={providers} onError={onError} target={target} efforts={efforts} />
      <Card icon={CAPTION} title={t('Captions')} about={t('The narration on screen, a few words at a time as they are said')}
            control={<Switch on={audio.captions === true} label={t('Captions')} onChange={(on) => setAudio({ captions: on })} />}>
        {audio.captions === true && !audio.narrate && (
          <p className="vid-note vid-sound-in">{t('Captions show the narration, so they appear once narration is on.')}</p>
        )}
        {audio.captions === true && audio.narrate && (
          <p className="vid-note vid-sound-in">{t('Burned into the video in its own typeface, above where phone apps put their buttons — for the many who watch with the sound off.')}</p>
        )}
      </Card>
    </div>
  );
}

// ── music ─────────────────────────────────────────────────────────────────

function MusicCard({ t, video, audio, setAudio, onError }: {
  t: T; video: Video; audio: VideoAudio; setAudio: (n: Partial<VideoAudio>) => void; onError: (m: string) => void;
}) {
  const id = video.id;
  const track = audio.music;
  const [picking, setPicking] = useState(false);
  const [words, setWords] = useState(() => searches.get(id)?.words ?? '');
  const [taking, setTaking] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [vol, setVol] = useState<number | null>(null);
  const volTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const search = searches.get(id);
  const on = Boolean(track) || picking;
  const film = video.scenes.length ? durationInFrames(video) / FPS : 0;

  const find = (queries: readonly string[], label: string, mood?: Mood['id']) => {
    searches.get(id)?.ctl?.abort();
    const ctl = new AbortController();
    const s: Search = { words: label, mood, state: 'busy', results: [], ctl };
    searches.set(id, s);
    ping();
    searchMusic(queries, { seconds: film || video.seconds, signal: ctl.signal }).then(
      (results) => { if (searches.get(id) === s) { searches.set(id, { ...s, state: 'done', results: results.slice(0, 12), ctl: undefined }); ping(); } },
      (e: unknown) => { if (searches.get(id) === s && !isAbort(e)) { searches.set(id, { ...s, state: 'error', error: e, ctl: undefined }); ping(); } },
    );
  };
  const findMood = (m: Mood) => { setWords(''); find(m.queries, t(m.label), m.id); };

  const turn = (next: boolean) => {
    if (!next) {
      if (track) lastTrack.set(id, track);
      setPicking(false);
      stopAll();
      setAudio({ music: undefined });
      return;
    }
    const back = lastTrack.get(id);
    if (back) { setAudio({ music: back }); return; }
    setPicking(true);
    if (!searches.get(id)?.results.length) findMood(moodFor(video));
  };

  const listen = async (c: TrackCandidate) => {
    const key = `cand:${c.url}`;
    if (playing === key) { stopAll(); return; }
    unlock();
    setLoading(c.url);
    try {
      const bytes = await bytesOf(c);
      const url = blobUrlOf(key, () => bytes, 'audio/mpeg');
      if (url) await playUrl(key, url);
    } catch (e) {
      onError(sayMusic(t, e, t('fetch the music')));
    } finally {
      setLoading(null);
    }
  };

  const use = async (c: TrackCandidate) => {
    setTaking(c.url);
    try {
      const bytes = await bytesOf(c);
      const seconds = await audioSeconds(bytes).catch(() => c.seconds);
      const q = searches.get(id)?.words ?? '';
      const next = trackOf(c, toDataUrl(bytes, 'audio/mpeg'), q, seconds);
      lastTrack.set(id, next);
      setAudio({ music: next });
      setPicking(false);
    } catch (e) {
      onError(sayMusic(t, e, t('fetch the music')));
    } finally {
      setTaking(null);
    }
  };

  const hearTrack = () => {
    if (!track) return;
    const key = `track:${fingerprint(track.src)}`;
    if (playing === key) { stopAll(); return; }
    const url = blobUrlOf(key, () => dataUrlBytes(track.src), track.src.startsWith('data:audio/wav') ? 'audio/wav' : 'audio/mpeg');
    if (url) void playUrl(key, url);
  };

  // Composed music follows the video's length; when the video has changed since, it can be composed again to fit.
  const composed = track?.generated;
  const refit = takes.get(id);
  const refitting = refit?.state === 'busy' && refit.fit;
  const offBy = composed && film > 0 && track?.seconds !== undefined ? Math.abs(track.seconds - film) : 0;
  const fitAgain = () => {
    if (!composed) return;
    const cur = latest.get(id) ?? video;
    const now = cur.scenes.length ? durationInFrames(cur) / FPS : cur.seconds;
    startCompose(id, composed, now, musicCues(cur), (next) => {
      lastTrack.set(id, next);
      const v = latest.get(id) ?? cur;
      if (v.audio?.music?.generated) setAudio({ music: next });
    });
  };

  const volume = vol ?? musicVolumeOf(audio);
  const setVolume = (v: number) => {
    setVol(v);
    if (volTimer.current) clearTimeout(volTimer.current);
    // Kept when the hand stops: every change is a save of the whole video, music and all.
    volTimer.current = setTimeout(() => { setAudio({ musicVolume: v }); setVol(null); }, 350);
  };
  useEffect(() => () => { if (volTimer.current) clearTimeout(volTimer.current); }, []);

  const loops = track?.seconds !== undefined && film > 0 && track.seconds < film;
  const trackKey = track ? `track:${fingerprint(track.src)}` : '';

  return (
    <Card icon={NOTE} title={t('Music')}
          about={track && !composed ? t('Openly licensed music under the whole video') : t('Music under the whole video: composed here, or openly licensed')}
          control={<Switch on={on} label={t('Music')} onChange={turn} />}>
      {track && (
        <div className="vid-sound-body">
          <div className="vid-sound-track">
            <PlayButton t={t} on={playing === trackKey} onClick={hearTrack} />
            <span className="vid-sound-meta">
              <b dir="auto">{composed ? fill(t('{mood} — composed for this video'), { mood: moodLabel(t, composed.mood) }) : track.title}</b>
              <span dir="auto">{composed ? t('Original music composed in Vylo Editor') : track.credit}</span>
            </span>
            <span className="vid-sound-len">{mmss(track.seconds)}</span>
            <button type="button" className="ghost vid-sound-small" aria-expanded={picking} onClick={() => {
              const next = !picking;
              setPicking(next);
              if (next && !searches.get(id)?.results.length) findMood(moodFor(video));
            }}>{picking ? t('Close') : t('Change')}</button>
          </div>
          <label className="vid-sound-vol">
            <span>{t('Music volume')}</span>
            <input type="range" min={0} max={100} step={5} value={Math.round(volume * 100)}
                   onChange={(e) => setVolume(Number(e.target.value) / 100)} aria-valuetext={`${Math.round(volume * 100)}%`} />
            <output>{Math.round(volume * 100)}%</output>
          </label>
          {composed && (offBy > 0.25 || refitting) && (
            <div className="vid-warn vid-in vid-synth-fit" role="status">
              <span>{refitting
                ? fill(t('Composing… {n}%'), { n: Math.round((refit?.fraction ?? 0) * 100) })
                : fill(t('This music was composed for {m} s; the video is now {n} s.'), { m: track.seconds ?? 0, n: Math.round(film * 10) / 10 })}</span>
              <button type="button" className="ghost vid-sound-small" disabled={refitting} onClick={fitAgain}>
                {refitting ? <span className="vid-spinner" aria-hidden="true" /> : <Icon name="sparkle" size={12} />}{t('Compose again to fit')}
              </button>
            </div>
          )}
          <p className="vid-note">
            {loops
              ? fill(t('Shorter than the video, so it loops, the joins blended, to fill {n} seconds. It fades in at the start and out at the end.'), { n: Math.round(film) })
              : t('It fades in at the start and out at the end.')}
            {audio.narrate ? ` ${t('Under the voice it drops to about a third, and comes back between lines.')}` : ''}
          </p>
        </div>
      )}

      {on && (picking || !track) && (
        <ComposeCard t={t} video={video} audio={audio} setAudio={setAudio} onUsed={() => setPicking(false)} />
      )}

      {on && (picking || !track) && (
        <div className="vid-sound-body vid-sound-pick">
          <p className="vid-synth-or">{t('Or find openly licensed music')}</p>
          <div className="vid-chips vid-sound-moods" role="group" aria-label={t('Mood')}>
            {MOODS.map((m) => (
              <button key={m.id} type="button" className={`vid-chip vid-sound-mood${search?.mood === m.id ? ' on' : ''}`}
                      aria-pressed={search?.mood === m.id} onClick={() => findMood(m)}>
                {t(m.label)}
              </button>
            ))}
          </div>
          <form className="vid-sound-search" onSubmit={(e) => {
            e.preventDefault();
            const w = words.trim();
            if (w) find([w], w);
          }}>
            <input value={words} dir="ltr" spellCheck={false} maxLength={60} aria-label={t('Describe the music')}
                   placeholder={t('Or describe it, in English: soft guitar, happy ukulele…')} onChange={(e) => setWords(e.target.value)} />
            <button type="submit" className="ghost" disabled={!words.trim()}><Icon name="search" size={13} />{t('Search')}</button>
          </form>

          {search?.state === 'busy' && (
            <p className="vid-sound-wait" role="status"><span className="vid-spinner" aria-hidden="true" />{t('Looking for music…')}</p>
          )}
          {search?.state === 'error' && <p className="vid-bad">{sayMusic(t, search.error, t('find music'))}</p>}
          {search?.state === 'done' && !search.results.length && (
            <p className="vid-note">{t('Nothing usable came back for that. Try other words or another mood.')}</p>
          )}
          {search?.state === 'done' && search.results.length > 0 && (
            <ul className="vid-sound-results" aria-label={t('Music found')}>
              {search.results.map((c) => {
                const key = `cand:${c.url}`;
                const chosen = track?.source === c.source && track?.title === c.title;
                return (
                  <li key={c.url} className={`vid-sound-row${chosen ? ' is-on' : ''}`}>
                    <PlayButton t={t} on={playing === key} busy={loading === c.url} onClick={() => void listen(c)} />
                    <span className="vid-sound-meta">
                      <b dir="auto">{c.title}</b>
                      <span dir="auto">{[c.creator, c.license, c.where].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="vid-sound-len">{mmss(c.seconds)}</span>
                    <button type="button" className="ghost vid-sound-small" disabled={taking !== null || chosen} onClick={() => void use(c)}>
                      {taking === c.url ? <span className="vid-spinner" aria-hidden="true" /> : chosen ? <Icon name="check" size={12} /> : null}
                      {chosen ? t('In use') : t('Use')}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="vid-note">{t('From Openverse — Freesound, Jamendo and Wikimedia Commons — only under licences that allow reuse (CC0, public domain, CC BY, CC BY-SA). Its credit goes at the end with the pictures’.')}</p>
        </div>
      )}
    </Card>
  );
}

// ── composing ─────────────────────────────────────────────────────────────

/** What a take is, in one line — its key or maqam, its rhythm, its tempo — kept per take. */
const lines = new WeakMap<Take, { key: number; scale: string; iqa?: string; bpm: number }>();

function takeLine(t: T, take: Take): string {
  let s = lines.get(take);
  if (!s) {
    const sc = arrange(take.spec, take.film, take.cues);
    s = { key: sc.key, scale: sc.scale, iqa: sc.iqa, bpm: sc.bpm };
    lines.set(take, s);
  }
  const key = KEY_NAMES[s.key] ?? '';
  const maqam: Partial<Record<string, string>> = { hijaz: 'Hijaz', bayati: 'Bayati', nahawand: 'Nahawand', kurd: 'Kurd' };
  const iqa: Partial<Record<string, string>> = { maqsum: 'Maqsum', baladi: 'Baladi', saidi: 'Saidi' };
  const name = maqam[s.scale];
  const rhythm = s.iqa ? iqa[s.iqa] : undefined;
  return [
    name ? fill(t('Maqam {maqam} on {key}'), { maqam: t(name), key }) : fill(t(s.scale === 'major' ? '{key} major' : '{key} minor'), { key }),
    ...(rhythm ? [t(rhythm)] : []),
    fill(t('{n} BPM'), { n: Math.round(s.bpm) }),
  ].join(' · ');
}

/**
 * Composing music for the video in the app (videosynth.ts): a mood, a tempo,
 * how busy, a key or the mood's own. The piece follows the video — its
 * length, and a lift at every scene change — and is heard before it is used.
 */
function ComposeCard({ t, video, audio, setAudio, onUsed }: {
  t: T; video: Video; audio: VideoAudio; setAudio: (n: Partial<VideoAudio>) => void; onUsed: () => void;
}) {
  const id = video.id;
  const film = video.scenes.length ? durationInFrames(video) / FPS : video.seconds;
  const now = audio.music?.generated;
  const k: Knobs = knobs.get(id) ?? { mood: now?.mood ?? moodForStyle(video.style), tempo: now?.tempo, energy: now?.energy ?? 0.6, key: now?.key };
  const turn = (next: Partial<Knobs>) => { knobs.set(id, { ...k, ...next }); ping(); };
  const take = takes.get(id);
  const busy = take?.state === 'busy';
  const made = take?.state === 'done' ? take.track : undefined;
  const inUse = Boolean(made && audio.music?.src === made.src);
  const tempo = k.tempo ?? moodTempo(k.mood);
  const energy = Math.round(k.energy * 100);

  const compose = (seed: number) => {
    stopAll();
    const spec: MusicSpec = { mood: k.mood, seed, energy: k.energy, ...(k.tempo !== undefined ? { tempo: k.tempo } : {}), ...(k.key !== undefined ? { key: k.key } : {}) };
    startCompose(id, spec, film, musicCues(latest.get(id) ?? video));
  };
  const hearKey = made ? `synth:${fingerprint(made.src)}` : '';
  const hear = () => {
    if (!made) return;
    if (playing === hearKey) { stopAll(); return; }
    const url = blobUrlOf(hearKey, () => dataUrlBytes(made.src), 'audio/wav');
    if (url) void playUrl(hearKey, url);
  };
  const use = () => {
    if (!made) return;
    lastTrack.set(id, made);
    setAudio({ music: made });
    onUsed();
  };

  return (
    <div className="vid-sound-body vid-synth">
      <div className="vid-synth-head">
        <b>{t('Compose music')}</b>
        <span>{t('Written and played on this computer, to fit this video')}</span>
      </div>
      <div className="vid-chips vid-synth-moods" role="group" aria-label={t('Mood')}>
        {MUSIC_MOODS.map((m) => (
          <button key={m.id} type="button" className={`vid-chip vid-sound-mood${k.mood === m.id ? ' on' : ''}`} aria-pressed={k.mood === m.id}
                  onClick={() => turn({ mood: m.id, tempo: undefined })}>
            {t(m.label)}
          </button>
        ))}
      </div>
      <div className="vid-synth-knobs">
        <label className="vid-synth-knob">
          <span>{t('Tempo')}</span>
          <input type="range" min={60} max={170} step={1} value={tempo} onChange={(e) => turn({ tempo: Number(e.target.value) })}
                 aria-valuetext={fill(t('{n} BPM'), { n: tempo })} />
          <output>{k.tempo === undefined ? fill(t('Auto · {n} BPM'), { n: tempo }) : fill(t('{n} BPM'), { n: tempo })}</output>
        </label>
        <label className="vid-synth-knob">
          <span>{t('Energy')}</span>
          <input type="range" min={0} max={100} step={5} value={energy} onChange={(e) => turn({ energy: Number(e.target.value) / 100 })} aria-valuetext={`${energy}%`} />
          <output>{energy}%</output>
        </label>
        <label className="vid-synth-knob">
          <span>{t('Musical key')}</span>
          <select value={k.key === undefined ? '' : String(k.key)} onChange={(e) => turn({ key: e.target.value === '' ? undefined : Number(e.target.value) })}>
            <option value="">{t('Auto')}</option>
            {KEY_NAMES.map((name, i) => <option key={name} value={i} dir="ltr">{name}</option>)}
          </select>
        </label>
      </div>
      <div className="vid-synth-acts">
        <button type="button" className="sb-cta-go" disabled={busy} onClick={() => compose(take?.spec.seed ?? now?.seed ?? freshSeed())}>
          <Icon name="sparkle" size={13} />{t('Compose')}
        </button>
        <button type="button" className="ghost" disabled={busy || !take} onClick={() => compose(freshSeed())}>
          <Icon name="swap" size={13} />{t('Another take')}
        </button>
      </div>

      {busy && take && !take.fit && (
        <div className="vid-status vid-sound-run" role="status">
          <p className="vid-status-line">
            <span className="vid-glyph" aria-hidden="true">✻</span>
            <b>{fill(t('Composing… {n}%'), { n: Math.round(take.fraction * 100) })}</b>
            <button type="button" className="ghost vid-sound-small" onClick={() => take.ctl?.abort()}><Icon name="stop" size={11} />{t('Stop')}</button>
          </p>
          <div className="vid-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(take.fraction * 100)} aria-label={t('Progress')}>
            <i style={{ inlineSize: `${Math.max(4, take.fraction * 100)}%` }} />
          </div>
        </div>
      )}
      {made && take && (
        <div className="vid-synth-take">
          <PlayButton t={t} on={playing === hearKey} onClick={hear} />
          <span className="vid-sound-meta">
            <b dir="auto">{fill(t('{mood} — composed for this video'), { mood: moodLabel(t, take.spec.mood) })}</b>
            <span dir="auto">{takeLine(t, take)}</span>
          </span>
          <span className="vid-sound-len">{mmss(made.seconds)}</span>
          <button type="button" className="ghost vid-sound-small" disabled={inUse} onClick={use}>
            {inUse ? <Icon name="check" size={12} /> : null}{inUse ? t('In use') : t('Use it')}
          </button>
        </div>
      )}
      {take?.state === 'error' && <p className="vid-bad">{explain(take.error, t('compose the music'))}</p>}
      <p className="vid-note">{t('Original music, made on this computer for this video and yours to use: no licence, no credit needed. It follows the video — its length, and a lift at every scene change.')}</p>
    </div>
  );
}

// ── the voice ─────────────────────────────────────────────────────────────

function VoiceCard({ t, video, audio, setAudio, onChange, run, rtl, locked, providers, onError, target, efforts }: {
  t: T; video: Video; audio: VideoAudio; setAudio: (n: Partial<VideoAudio>) => void; onChange: (n: Partial<Video>) => void;
  run: Run | undefined; rtl: boolean; locked: boolean; providers: readonly Provider[]; onError: (m: string) => void;
  target?: Target; efforts?: EffortBook;
}) {
  const id = video.id;
  const narrate = audio.narrate === true;
  let stored: string | null = null;
  try { stored = localStorage.getItem(TTS_KEY); } catch { /* private mode */ }
  const pick = voicePick.get(id) ?? audio.voiceName ?? speakerFor(providers, stored)?.speech.voice ?? VOICES[0];
  const speaker = speakerFor(providers, stored, pick);
  const voice = audio.voice ?? {};
  const stale = staleVoices(video);
  const over = linesOver(video);
  const withWords = video.scenes.filter((s) => s.narration?.trim());
  const redo = Boolean(audio.voiceName) && pick !== audio.voiceName && Object.keys(voiceForScenes(video) ?? {}).length > 0;
  const toMake = withWords.filter((s) => redo || !voice[s.id] || stale.has(s.id)).map((s) => s.id);
  const kurdish = video.lang === 'ckb' || video.lang === 'kmr';
  const busy = Boolean(run);
  const note = notes.get(id);
  const [loading, setLoading] = useState<string | null>(null);

  const fitNote = (fit: VoiceFit): string => {
    const parts: string[] = [];
    if (fit.longer.length) {
      parts.push(fill(t('Made longer to fit the voice: {list}.'), {
        list: fit.longer.map((l) => fill(t('scene {n} ({from} → {to} s)'), { n: l.index + 1, from: l.from, to: l.to })).join(' · '),
      }));
    }
    if (fit.over.length) {
      parts.push(fill(t('Still too long for its scene even at 20 seconds: {list}. Shorten those lines.'), {
        list: fit.over.map((o) => fill(t('scene {n}'), { n: o.index + 1 })).join(' · '),
      }));
    }
    return parts.join(' ');
  };

  const fitNow = () => {
    const cur = latest.get(id) ?? video;
    const fit = fitScenesToVoice(cur);
    if (fit.longer.length) commit(id, onChange, { scenes: fit.scenes });
    notes.set(id, fitNote(fit));
    ping();
  };

  const write = async () => {
    if (!target || runs.has(id)) return;
    const ctl = new AbortController();
    const r: Run = { kind: 'write', ctl, done: 0, of: 1, chars: 0 };
    runs.set(id, r);
    notes.delete(id);
    ping();
    try {
      const cur = latest.get(id) ?? video;
      const p = narrationPrompt(cur);
      const out = await generate(target, {
        system: p.system, user: p.user, maxTokens: 4000, efforts, signal: ctl.signal,
        onText: (d) => { r.chars += d.length; ping(); },
        onRestart: () => { r.chars = 0; },
      });
      const now = latest.get(id) ?? cur;
      const lines = parseNarration(out.text, now);
      if (!lines) throw new Error(t('The answer could not be read as narration. Try again.'));
      commit(id, onChange, {
        scenes: now.scenes.map((s) => (lines[s.id] ? { ...s, narration: lines[s.id] } : s)),
        audio: { ...(now.audio ?? {}), narrate: true },
      });
      notes.set(id, fill(t('{n} lines written. Read them, change what you like, then make the voice.'), { n: Object.keys(lines).length }));
    } catch (e) {
      if (!isAbort(e) && !ctl.signal.aborted) onError(explain(e, t('write the narration')));
    } finally {
      runs.delete(id);
      ping();
    }
  };

  const make = async () => {
    if (!speaker || runs.has(id) || !toMake.length) return;
    const ctl = new AbortController();
    const r: Run = { kind: 'voice', ctl, done: 0, of: toMake.length, chars: 0 };
    runs.set(id, r);
    notes.delete(id);
    ping();
    try {
      for (const sceneId of toMake) {
        const cur = latest.get(id) ?? video;
        const text = cur.scenes.find((s) => s.id === sceneId)?.narration?.trim();
        if (!text) { r.done++; continue; }
        const bytes = await speakLine(speaker, text, { signal: ctl.signal });
        const seconds = await audioSeconds(bytes);
        const now = latest.get(id) ?? cur;
        commit(id, onChange, {
          audio: {
            ...(now.audio ?? {}),
            voice: { ...(voiceForScenes(now) ?? {}), [sceneId]: { text, src: toDataUrl(bytes, 'audio/mpeg'), seconds } },
            voiceName: speaker.speech.voice,
          },
        });
        r.done++;
        ping();
      }
      // Every line made: now make room for the ones that run long.
      const fit = fitScenesToVoice(latest.get(id) ?? video);
      if (fit.longer.length && !locked) commit(id, onChange, { scenes: fit.scenes });
      notes.set(id, fitNote(fit) || fill(t('{n} lines spoken. Each fits its scene.'), { n: r.done }));
    } catch (e) {
      if (!isAbort(e) && !ctl.signal.aborted) onError(explain(e, t('make the voice')));
    } finally {
      runs.delete(id);
      ping();
    }
  };

  const listen = (sceneId: string, text: string) => {
    const line = voice[sceneId];
    const key = line ? `voice:${fingerprint(line.src)}` : `say:${sceneId}:${text}`;
    if (playing === key) { stopAll(); return; }
    if (line) {
      const url = blobUrlOf(key, () => dataUrlBytes(line.src), 'audio/mpeg');
      if (url) void playUrl(key, url);
      return;
    }
    if (!speaker) { speakSystem(key, text); return; }
    // No voice yet but a provider: hear this one line as it will sound.
    unlock();
    setLoading(sceneId);
    speakLine(speaker, text).then(
      (bytes) => {
        const url = blobUrlOf(key, () => bytes, 'audio/mpeg');
        if (url) void playUrl(key, url);
      },
      (e: unknown) => onError(explain(e, t('make the voice'))),
    ).finally(() => setLoading(null));
  };

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const saveLine = (sceneId: string, text: string) => {
    const cur = latest.get(id) ?? video;
    commit(id, onChange, { scenes: cur.scenes.map((s) => (s.id === sceneId ? { ...s, narration: text.trim() ? text : undefined } : s)) });
    setDrafts((d) => { const { [sceneId]: _gone, ...rest } = d; return rest; });
  };
  const typeLine = (sceneId: string, text: string) => {
    setDrafts((d) => ({ ...d, [sceneId]: text }));
    clearTimeout(timers.current[sceneId]);
    // Kept a moment after typing stops: every change is a save of the whole video.
    timers.current[sceneId] = setTimeout(() => saveLine(sceneId, text), 600);
  };
  useEffect(() => () => { for (const k of Object.keys(timers.current)) clearTimeout(timers.current[k]); }, []);

  let host = '';
  try { host = speaker ? new URL(speaker.provider.baseUrl).host : ''; } catch { host = speaker?.provider.baseUrl ?? ''; }

  return (
    <Card icon={WAVE} title={t('Narration')} about={t('A voice reads a line in every scene')}
          control={<Switch on={narrate} label={t('Narration')} onChange={(n) => setAudio({ narrate: n })} />}>
      {narrate && (
        <div className="vid-sound-body">
          {speaker ? (
            <div className="vid-sound-voice">
              <label className="vid-f">
                <span>{t('Voice')}</span>
                <input list="vid-sound-voices" value={pick} dir="ltr" spellCheck={false} maxLength={60}
                       onChange={(e) => { voicePick.set(id, e.target.value); ping(); }} />
                <datalist id="vid-sound-voices">{VOICES.map((v) => <option key={v} value={v} />)}</datalist>
              </label>
              <p className="vid-note">
                {fill(t('Spoken by {name} with {model}. The key goes only to {host}.'), { name: speaker.provider.name, model: speaker.speech.model, host })}
              </p>
            </div>
          ) : (
            <p className="vid-warn vid-in">
              {t('No provider here can make a voice. Add an OpenAI-compatible provider with its key in Settings. Until then, ▶ reads a line in this computer’s own voice — a preview only, which cannot go into the video.')}
            </p>
          )}
          {kurdish && <p className="vid-note">{t('No speech service has a Kurdish voice yet. The voice reads the Kurdish letters as well as it can, so listen before you export.')}</p>}

          <div className="vid-sound-acts">
            <button type="button" className="ghost" disabled={!target || locked || busy || !video.scenes.length} onClick={() => void write()}
                    title={!target ? t('Writing the narration needs the video’s model, which this window was not given.') : undefined}>
              <Icon name="sparkle" size={13} />{withWords.length ? t('Write the narration again') : t('Write the narration')}
            </button>
            <button type="button" className="sb-cta-go" disabled={!speaker || busy || !toMake.length} onClick={() => void make()}>
              <Icon name="mic" size={13} />
              {redo ? fill(t('Make the voice again in {voice}'), { voice: pick }) : Object.keys(voice).length && toMake.length ? t('Update the voice') : t('Make the voice')}
            </button>
          </div>

          {run && (
            <div className="vid-status vid-sound-run" role="status">
              <p className="vid-status-line">
                <span className="vid-glyph" aria-hidden="true">✻</span>
                <b>{run.kind === 'write' ? t('Writing the narration…') : fill(t('Making the voice… {done} of {of}'), { done: run.done, of: run.of })}</b>
                <button type="button" className="ghost vid-sound-small" onClick={() => run.ctl.abort()}><Icon name="stop" size={11} />{t('Stop')}</button>
              </p>
              {run.kind === 'voice' ? (
                <div className="vid-bar" role="progressbar" aria-valuemin={0} aria-valuemax={run.of} aria-valuenow={run.done} aria-label={t('Progress')}>
                  <i style={{ inlineSize: `${Math.max(4, (run.done / Math.max(1, run.of)) * 100)}%` }} />
                </div>
              ) : (
                <p className="vid-clock">{fill(t('{n} characters so far'), { n: run.chars })}</p>
              )}
            </div>
          )}
          {note && !run && <p className="vid-sound-said" role="status">{note}</p>}
          {!run && over.size > 0 && (
            <div className="vid-warn vid-in vid-sound-over">
              <span>{fill(t('{n} lines are longer than their scenes, so they would be cut off.'), { n: over.size })}</span>
              <button type="button" className="ghost vid-sound-small" disabled={locked} onClick={fitNow}>{t('Lengthen those scenes')}</button>
            </div>
          )}

          <ol className="vid-sound-lines">
            {video.scenes.map((s, i) => {
              const text = drafts[s.id] ?? s.narration ?? '';
              const n = wordsIn(text);
              const max = wordBudget(video, i);
              const line = voice[s.id];
              const key = line ? `voice:${fingerprint(line.src)}` : `say:${s.id}:${text.trim()}`;
              const isStale = stale.has(s.id) || (drafts[s.id] !== undefined && line && drafts[s.id].trim() !== line.text.trim());
              return (
                <li key={s.id} className="vid-sound-line">
                  <div className="vid-sound-line-head">
                    <span className="vid-sound-n">{i + 1}</span>
                    <b>{kindName(s.kind, t)}</b>
                    <span className={`vid-sound-count${n > max ? ' is-over' : ''}`}>{fill(t('{n} of {max} words'), { n, max })}</span>
                    {line && !isStale && (
                      <span className={`vid-sound-tag${over.has(s.id) ? ' is-over' : ' is-ok'}`}>
                        {over.has(s.id) ? fill(t('{s} s too long'), { s: over.get(s.id)! }) : fill(t('{s} s'), { s: line.seconds.toFixed(1) })}
                      </span>
                    )}
                    {line && isStale && <span className="vid-sound-tag is-stale">{t('Changed — make the voice again')}</span>}
                    {text.trim() && (
                      <PlayButton t={t} on={playing === key} busy={loading === s.id} onClick={() => listen(s.id, text.trim())}
                                  label={line ? t('Listen') : speaker ? t('Listen') : t('Listen with this computer’s voice')} />
                    )}
                  </div>
                  <textarea dir={rtl ? 'rtl' : 'ltr'} rows={2} value={text} disabled={locked}
                            placeholder={t('What the voice says during this scene')}
                            onChange={(e) => typeLine(s.id, e.target.value)}
                            onBlur={(e) => { if (drafts[s.id] !== undefined) { clearTimeout(timers.current[s.id]); saveLine(s.id, e.target.value); } }} />
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Card>
  );
}
