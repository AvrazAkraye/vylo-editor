/**
 * The shape of a video, shared by everything in the Video module.
 *
 * ## The model writes a storyboard, never code
 *
 * A video is a list of scenes, each one of a fixed set of kinds with plain
 * fields — text, numbers, colours, an image the app fetched. The model's whole
 * contribution is that JSON (video.ts parses and repairs it); the scenes are
 * drawn by the app's own Remotion components (VideoScenes.tsx). Nothing the
 * model writes is ever run: a model that could put React into this webview
 * could call every native command the app has, which is the one thing
 * SAFETY.md exists to rule out.
 *
 * Who uses what:
 * - video.ts        — skills, prompts, parsing and repairing the storyboard, timing
 * - VideoScenes.tsx — the Remotion composition that draws a `Video`
 * - videomedia.ts   — finding and fetching openly licensed images for scenes
 * - videoexport.ts  — rendering to MP4 in the page and handing the bytes to Rust
 * - VideoPanel.tsx  — the sidebar module and its full window
 */

/** Frame shapes, by where the video will be watched. */
export type Format = 'landscape' | 'portrait' | 'square';

/** Pixel sizes for each format. */
export const FORMATS: Readonly<Record<Format, { width: number; height: number }>> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
};

export const FPS = 30;

/** The language the video's words are in. Arabic and both Kurdish scripts are right to left. */
export type VideoLang = 'ar' | 'ckb' | 'kmr' | 'en';

/** A visual style: palette, type and motion. VideoScenes.tsx draws each one. */
export type Style = 'modern' | 'bold' | 'elegant' | 'neon' | 'minimal' | 'warm';

/** How one scene hands over to the next. */
export type Transition = 'fade' | 'slide' | 'wipe' | 'zoom' | 'none';

/** An image the app fetched for a scene, kept with its credit. */
export interface Picture {
  /** A data: URL — fetched once, so rendering never touches the network. */
  src: string;
  /** Who made it and under what licence, shown in the credits and on request. */
  credit: string;
  /** Where it was found, for the credits. */
  source: string;
  /** The words it was searched with, so it can be searched again. */
  query: string;
  width?: number;
  height?: number;
}

/** Fields every scene has. */
interface SceneBase {
  id: string;
  /** Seconds on screen, transition included. */
  seconds: number;
  /** How this scene hands over to the next one. */
  transition: Transition;
  /** Words to search a picture with, in English — the model's suggestion. */
  imageQuery?: string;
  picture?: Picture;
  /** What a voice says during this scene, when the video is narrated. In the video's language. */
  narration?: string;
  /** This scene's look over the video's: set in the storyboard or by asking in the Chat tab. */
  look?: SceneLook;
}

/**
 * How the whole video looks beyond its style — set in the Look tab, or by
 * asking in the Chat tab ("make the logo bigger", "black background", "centre
 * the words"). Every field is optional; one that is absent is the style's own.
 * The numbers are multipliers of what the style draws, clamped by video.ts.
 */
export interface LookSettings {
  /** The logo's size, 0.5 to 3; 1 is the style's. */
  logoScale?: number;
  /** Every on-screen word, 0.7 to 1.5; 1 is as the style fits it. Words still never overflow. */
  textScale?: number;
  /** Where words sit across the frame: the reading side, the centre, or the other side. */
  align?: 'start' | 'center' | 'end';
  /** #rrggbb — the background, instead of the style's. */
  background?: string;
  /** #rrggbb — the words, instead of the style's. Checked for contrast against the background when drawn. */
  text?: string;
  /** A typeface from `FONT_CHOICES` (videotheme.ts), by id — each pair has every Kurdish letter. */
  font?: string;
  /** How fast things move and arrive, 0.5 (slow) to 2 (quick); 1 is the style's. */
  motion?: number;
  /** The background: the style's moving one, a still one, or a flat colour. */
  backdrop?: 'moving' | 'still' | 'plain';
  /** The corner the brand watermark sits in. */
  watermarkCorner?: 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';
  /** The watermark's size, 0.5 to 2. */
  watermarkScale?: number;
}

/** One scene's look over the video's. Absent fields follow the video. */
export interface SceneLook {
  textScale?: number;
  align?: 'start' | 'center' | 'end';
  /** #rrggbb */
  background?: string;
  /** #rrggbb */
  text?: string;
  /** Show the brand's logo on this scene — the title, logo and close show it anyway; false hides it there too. */
  logo?: boolean;
  /** The logo's size on this scene, 0.5 to 3, over the video's. */
  logoScale?: number;
  /** A picture: 'cover' fills the frame, 'contain' shows all of it. */
  fit?: 'cover' | 'contain';
}

/** A headline and a line under it. The opening scene, usually. */
export interface TitleScene extends SceneBase { kind: 'title'; title: string; subtitle?: string }
/** A sentence said a few words at a time, large, in rhythm. */
export interface KineticScene extends SceneBase { kind: 'kinetic'; text: string }
/** A heading and up to five points, arriving one after another. */
export interface BulletsScene extends SceneBase { kind: 'bullets'; heading: string; points: string[] }
/** One number that counts up, with what it measures. */
export interface StatScene extends SceneBase { kind: 'stat'; value: number; prefix?: string; suffix?: string; label: string }
/** A bar chart that grows. Up to six bars. */
export interface ChartScene extends SceneBase { kind: 'chart'; heading: string; bars: { label: string; value: number }[]; unit?: string }
/** A quotation and who said it. */
export interface QuoteScene extends SceneBase { kind: 'quote'; quote: string; author?: string }
/** A picture across the whole frame, slowly moving, with a caption. */
export interface ImageScene extends SceneBase { kind: 'image'; caption?: string }
/** A picture on one side, a heading and a sentence on the other. */
export interface SplitScene extends SceneBase { kind: 'split'; heading: string; text: string }
/** Numbered steps on a line, in order. Up to five. */
export interface StepsScene extends SceneBase { kind: 'steps'; heading: string; steps: string[] }
/** The close: the brand, what to do next, and where. */
export interface OutroScene extends SceneBase { kind: 'outro'; headline: string; cta?: string; url?: string }
/** Up to four pictures in a moving montage, with an optional heading. */
export interface GalleryScene extends SceneBase { kind: 'gallery'; heading?: string; pictures?: Picture[]; imageQueries?: string[] }
/** Dated events on a line, in order. Up to five; `when` is a year or a date as the sources give it. */
export interface TimelineScene extends SceneBase { kind: 'timeline'; heading: string; events: { when: string; text: string }[] }
/** Two sides compared, each with a title and up to four points. */
export interface CompareScene extends SceneBase { kind: 'compare'; heading: string; left: { title: string; points: string[] }; right: { title: string; points: string[] } }
/** Real people — a founder, a dean, a team — with their role and, when one was found, their picture. Up to four. */
export interface PeopleScene extends SceneBase { kind: 'people'; heading: string; people: { name: string; role?: string; picture?: Picture; imageQuery?: string }[] }
/** The brand's logo revealed, with a line under it. Uses `video.brand.logo`; the brand name when there is none. */
export interface LogoScene extends SceneBase { kind: 'logo'; tagline?: string }
/** A QR code for an address, with a line saying what it opens. */
export interface QrScene extends SceneBase { kind: 'qr'; heading: string; url: string }

export type Scene =
  | TitleScene | KineticScene | BulletsScene | StatScene | ChartScene
  | QuoteScene | ImageScene | SplitScene | StepsScene | OutroScene
  | GalleryScene | TimelineScene | CompareScene | PeopleScene | LogoScene | QrScene;

export type SceneKind = Scene['kind'];

export const SCENE_KINDS: readonly SceneKind[] = [
  'title', 'kinetic', 'bullets', 'stat', 'chart', 'quote', 'image', 'split', 'steps', 'outro',
  'gallery', 'timeline', 'compare', 'people', 'logo', 'qr',
];

/** The brand the video carries: colours override the style's, a logo appears on the title and the close. */
export interface Brand {
  name?: string;
  /** #rrggbb */
  primary?: string;
  /** #rrggbb */
  accent?: string;
  /** A data: URL the person picked. */
  logo?: string;
}

/**
 * A fact about the video's subject, found on the web before the storyboard
 * is planned, with where it came from. The person sees every one and can
 * switch it off; only facts that are on reach the model.
 */
export interface Fact {
  /** What it is, in English: "Founded", "Students", "Official website", "Motto". */
  label: string;
  value: string;
  /** The page it came from, named: "Wikidata", "Wikipedia (ar)". */
  source: string;
  url: string;
  use: boolean;
}

/** What was found about the subjects the request names — "UoD", a company, a city. */
export interface Brief {
  /** The names looked up, as they were understood: "University of Duhok". */
  subjects: string[];
  /** A few sentences about the subject from the sources, in the video's language when there was one. */
  summary?: string;
  facts: Fact[];
  /** Its own pictures — buildings, events, people — fetched, with credits. The video's scenes may use them. */
  pictures: Picture[];
  /** Its logo, when a free one was found. Offered for the brand, never put there unasked. */
  logo?: Picture;
  website?: string;
  /** When it was looked up (ms). */
  at: number;
}

/** A piece of music under the video: openly licensed, fetched, credited. */
/**
 * Music the app composes itself, from this and nothing else: no model writes
 * a note of it and nothing is downloaded, so it belongs to the video and needs
 * no credit. The same spec always composes the same piece; a new `seed`, a new
 * piece in the same mood.
 */
export interface MusicSpec {
  mood: 'uplifting' | 'calm' | 'cinematic' | 'corporate' | 'electronic' | 'lofi' | 'epic' | 'oriental';
  /** Beats per minute, 60–170; the mood's own when absent. */
  tempo?: number;
  /** 0 to 1: how busy and how loud the arrangement is. */
  energy?: number;
  /** The key's root, 0 = C … 11 = B; the mood's own when absent. */
  key?: number;
  seed: number;
}

export interface Track {
  /** A data: URL of the audio. */
  src: string;
  /** Set when the app composed it (videosynth.ts): how, so it can be composed again or changed. */
  generated?: MusicSpec;
  title: string;
  credit: string;
  source: string;
  license: string;
  seconds?: number;
  query?: string;
}

/** The video's sound: music under it, and an optional voice reading each scene's narration. */
export interface VideoAudio {
  /** Plan the video with a spoken line per scene, and read it out. */
  narrate?: boolean;
  music?: Track;
  /** 0 to 1. */
  musicVolume?: number;
  /** The narration's audio per scene id, made once from the scene's `narration`. */
  voice?: Record<string, { text: string; src: string; seconds: number }>;
  /** The voice's name at the provider that spoke it. */
  voiceName?: string;
  /** Burn the narration in as captions. */
  captions?: boolean;
}

/** One turn of the conversation in a video's Chat tab. */
export interface ChatTurn {
  role: 'you' | 'model';
  text: string;
  at: number;
  /** What the model's turn changed, in plain words, one line each — shown under its reply. */
  changes?: string[];
  /** What it asked for and did not get — an op skipped, music that could not be composed — one line each, shown apart. */
  skipped?: string[];
  /** The model's turn could not be understood or applied. */
  failed?: boolean;
  /** Buttons offered under the model's turn, for things only the person may press — a download. */
  offer?: 'download'[];
}

/** Where a video is in its life. */
export type Stage = 'new' | 'planning' | 'pictures' | 'ready';

export interface Video {
  id: string;
  created: number;
  updated: number;
  /** What the person asked for, as they typed it. */
  request: string;
  title: string;
  lang: VideoLang;
  format: Format;
  style: Style;
  /** The length asked for, in seconds; the scenes' own seconds are what is played. */
  seconds: number;
  brand: Brand;
  scenes: Scene[];
  stage: Stage;
  /** The model it was planned with, for the line that says so. */
  model?: string;
  /** The composer's choice, overridden — the same shape as Research's. */
  choice?: { provider: string; model: string; at?: string };
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Show the pictures' credits in a closing card. On by default; the licences ask for it. */
  credits?: boolean;
  /**
   * The brand's logo (or its name, when there is no logo) small in a corner of
   * every scene that does not already show it. On by default when the brand
   * has either; `false` turns it off.
   */
  watermark?: boolean;
  /** What was found on the web about the subject before planning, when it was looked up. */
  brief?: Brief;
  /** Look the subject up on the web before planning. On by default. */
  lookup?: boolean;
  /** Music and narration. */
  audio?: VideoAudio;
  /** The conversation in the Chat tab, oldest first; the latest turns go with each new message. */
  chat?: ChatTurn[];
  /** How it looks beyond its style. */
  look?: LookSettings;
  error?: string;
}
