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

export type Scene =
  | TitleScene | KineticScene | BulletsScene | StatScene | ChartScene
  | QuoteScene | ImageScene | SplitScene | StepsScene | OutroScene;

export type SceneKind = Scene['kind'];

export const SCENE_KINDS: readonly SceneKind[] = [
  'title', 'kinetic', 'bullets', 'stat', 'chart', 'quote', 'image', 'split', 'steps', 'outro',
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
  error?: string;
}
