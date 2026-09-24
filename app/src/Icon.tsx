/**
 * The icon set.
 *
 * The UI grew a collection of unicode pictographs — ▤ ⌕ ✦ ⤢ ▾ ⌁ 📁 — picked
 * one at a time for whatever was being built that day. They come from different
 * typefaces at different optical weights and sit on different baselines, and
 * that mismatch is most of why the chrome read as unfinished no matter how the
 * spacing and colour were tuned. One family, drawn on one grid, fixes it.
 *
 * Everything is on a 24 grid with a 1.5 stroke and round joins, and inherits
 * `currentColor`, so an icon is coloured by whatever it sits inside rather than
 * needing its own rule. Sizes are optical, not literal: a caret reads heavier
 * than a glyph of the same box, so carets are drawn smaller.
 *
 * Keyboard symbols (⌘ ⇧ ⌃ ⌥) are deliberately NOT in here. Those are real
 * typography for shortcuts, not decoration, and drawing them would be worse
 * than the character.
 */

interface Stroke { d: string; fill?: boolean }

const ICONS: Record<string, Stroke[]> = {
  file: [{ d: 'M14 3v4.5a1 1 0 0 0 1 1h4.5M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8.5z' }],
  folder: [{ d: 'M3.5 7.5A2 2 0 0 1 5.5 5.5h3.2a1 1 0 0 1 .8.4l1.2 1.6h7.8a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z' }],
  search: [{ d: 'M10.8 18.1a7.3 7.3 0 1 0 0-14.6 7.3 7.3 0 0 0 0 14.6zM16.2 16.2 21 21' }],
  chat: [{ d: 'M20 14.5a2.5 2.5 0 0 1-2.5 2.5H9l-4.5 4V6.5A2.5 2.5 0 0 1 7 4h10.5A2.5 2.5 0 0 1 20 6.5z' }],
  terminal: [{ d: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5zM8 9.5l3 2.5-3 2.5M13.5 15h3' }],
  memory: [{ d: 'M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-3.6L5.5 20.5v-16a1 1 0 0 1 1-1z' }],
  diff: [{ d: 'M8.5 7.5h7M12 4v7M8.5 16.5h7' }],
  branch: [
    { d: 'M7 8.2v7.6M7 5.2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM7 15.8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM17 5.2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z' },
    { d: 'M17 8.2v1.4c0 2.6-2.1 4.7-4.7 4.7H9.6' },
  ],
  settings: [{ d: 'M4 7.5h6.5M15 7.5h5M4 16.5h4.5M13 16.5h7M12.75 5.2v4.6M10.75 14.2v4.6' }],
  close: [{ d: 'M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5' }],
  chevron: [{ d: 'M9.5 5.5 16 12l-6.5 6.5' }],
  plus: [{ d: 'M12 5.5v13M5.5 12h13' }],
  check: [{ d: 'M5.5 12.5 10 17 18.5 7.5' }],
  warning: [{ d: 'M12 4.5 21 19.5H3zM12 10.2v4M12 16.8v.6' }],
  sparkle: [{ d: 'M12 3.5 13.9 9.4 20 11.3l-6.1 1.9L12 19l-1.9-5.8L4 11.3l6.1-1.9z' }],
  maximise: [{ d: 'M4.5 9.5V5.5a1 1 0 0 1 1-1h4M14.5 4.5h4a1 1 0 0 1 1 1v4M19.5 14.5v4a1 1 0 0 1-1 1h-4M9.5 19.5h-4a1 1 0 0 1-1-1v-4' }],
  restore: [{ d: 'M9.5 4.5v4a1 1 0 0 1-1 1h-4M19.5 9.5h-4a1 1 0 0 1-1-1v-4M14.5 19.5v-4a1 1 0 0 1 1-1h4M4.5 14.5h4a1 1 0 0 1 1 1v4' }],
  attach: [{ d: 'M19.5 11.8 12 19.3a5 5 0 0 1-7.1-7.1l8.4-8.4a3.4 3.4 0 0 1 4.8 4.8l-8.4 8.4a1.8 1.8 0 0 1-2.5-2.5l7.7-7.7' }],
  send: [{ d: 'M20.5 3.5 3.5 10l7.2 3.3L14 20.5z' }],
  stop: [{ d: 'M7.5 8.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1z', fill: true }],
  sun: [{ d: 'M12 7.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8zM12 2.8v1.9M12 19.3v1.9M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M2.8 12h1.9M19.3 12h1.9M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4' }],
  moon: [{ d: 'M20 14.7A8.6 8.6 0 0 1 9.3 4a8.6 8.6 0 1 0 10.7 10.7z' }],
  auto: [
    { d: 'M12 3.4a8.6 8.6 0 1 0 0 17.2 8.6 8.6 0 0 0 0-17.2z' },
    { d: 'M12 5.2a6.8 6.8 0 0 0 0 13.6z', fill: true },
  ],
  dot: [{ d: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z', fill: true }],
  split: [{ d: 'M4.5 5.5a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1zM12 4.5v15' }],
  star: [{ d: 'M12 4.2l2.35 4.76 5.25.77-3.8 3.7.9 5.23L12 16.19l-4.7 2.47.9-5.23-3.8-3.7 5.25-.77z' }],
  play: [{ d: 'M8.5 5.6a.8.8 0 0 1 1.22-.68l8.2 5.4a.8.8 0 0 1 0 1.36l-8.2 5.4a.8.8 0 0 1-1.22-.68z' }],
  flame: [{ d: 'M12 3.5s4.8 3.4 4.8 8.1a4.8 4.8 0 0 1-9.6 0c0-1.6.7-2.9 1.6-3.9.2 1.3.9 2.1 1.7 2.1 1.1 0 1.6-1 1.6-2.6 0-1.4-.1-2.6-.1-3.7z' }],
  calendar: [{ d: 'M4.5 7.5a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1zM4.5 10.5h15M8.5 4.5v4M15.5 4.5v4' }],
  list: [{ d: 'M9 6.5h10M9 12h10M9 17.5h10M5 6.5h.01M5 12h.01M5 17.5h.01' }],
  archive: [{ d: 'M4.5 8.5h15v10a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1zM3.5 5.5a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v3h-17zM10 12.5h4' }],
  board: [{ d: 'M4.5 5.5a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1zM9.8 4.5v15M14.6 4.5v15' }],
  // The three the terminal bar draws for its layout. A pane is a box, so all
  // three are the same box with different lines in it: crossed for a grid,
  // off-centre for a workbench, and — for the repair — no box at all, because
  // tidy is about the gaps rather than about a shape.
  grid: [{ d: 'M4.5 5.5a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1zM12 4.5v15M4.5 12h15' }],
  wide: [{ d: 'M4.5 5.5a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1zM15.2 4.5v15' }],
  even: [{ d: 'M5 5.5v13M12 5.5v13M19 5.5v13' }],
  // What is running in a pane, when it is Claude. Drawn in this set's own
  // hand — one grid, one stroke, round caps — rather than traced from the
  // mark itself: this says "the thing in here is Claude", which is what a
  // radiating burst says at 14 pixels, and tracing somebody's logo to say it
  // would be borrowing more than the meaning.
  claude: [{ d: 'M12 4.4v5.1M12 14.5v5.1M4.6 7.8l4.4 2.6M15 13.6l4.4 2.6M4.6 16.2l4.4-2.6M15 10.4l4.4-2.6' }],
  clock: [{ d: 'M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM12 7.8V12l2.8 2' }],
  link: [{ d: 'M10.2 13.8a3.4 3.4 0 0 0 4.9 0l2.6-2.6a3.45 3.45 0 0 0-4.9-4.9l-1.1 1.1M13.8 10.2a3.4 3.4 0 0 0-4.9 0l-2.6 2.6a3.45 3.45 0 1 0 4.9 4.9l1.1-1.1' }],
  bolt: [{ d: 'M13.4 3 5.8 13.4h5.1L10.6 21l7.6-10.4h-5.1z' }],
  pause: [{ d: 'M9.5 5.5v13M14.5 5.5v13' }],
  ellipsis: [{ d: 'M6 12h.01M12 12h.01M18 12h.01' }],
  image: [{ d: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5zM4.6 17.8l4.6-4.6a1.5 1.5 0 0 1 2.1 0l3.5 3.5M13.4 15.1l1.8-1.8a1.5 1.5 0 0 1 2.1 0l2.1 2.1M9.2 9.4v.01' }],
  camera: [
    { d: 'M3 9.5A2 2 0 0 1 5 7.5h3.2L10 4.8h4l1.8 2.7H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
    { d: 'M12 17a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z' },
  ],
  clipboard: [{ d: 'M9 4.5H7a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V6A1.5 1.5 0 0 0 17 4.5h-2M9.5 3h5a1 1 0 0 1 1 1v1.5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM9 11h6M9 15h4' }],
  mic: [{ d: 'M12 3.5a2.8 2.8 0 0 0-2.8 2.8v5a2.8 2.8 0 0 0 5.6 0v-5A2.8 2.8 0 0 0 12 3.5zM5.8 11a6.2 6.2 0 0 0 12.4 0M12 17.2v3.3' }],
  // Rename. There was no pencil, so `chevron` was doing the job — in the file
  // tree that put the expand caret and the rename button in the same row as the
  // same glyph, one pointing at the row's children and one meaning "edit this".
  // Replace: one arrow out, one back. Two rows rather than a crossed pair,
  // which at sixteen pixels reads as a knot.
  swap: [{ d: 'M4 9h13m-3.2-3.2L17 9l-3.2 3.2' }, { d: 'M20 15H7m3.2-3.2L7 15l3.2 3.2' }],
  // Research. An open book rather than a mortarboard: the module writes
  // documents, and a cap would promise a degree.
  book: [{ d: 'M12 6.8c-1.6-1.3-3.9-2-6.5-2H4.5v12.9h1c2.6 0 4.9.7 6.5 2 1.6-1.3 3.9-2 6.5-2h1V4.8h-1c-2.6 0-4.9.7-6.5 2zM12 6.8v12.9' }],
  // Video. A strip of film rather than a camera: the module makes a finished
  // film from a sentence, and `camera` already means a screenshot here.
  film: [{ d: 'M5.5 4.5h13a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM8 4.5v15M16 4.5v15M4.5 9h3.5M4.5 15h3.5M16 9h3.5M16 15h3.5' }],
  pencil: [{ d: 'M4.6 19.4l.7-3.5a2 2 0 0 1 .55-1.02L15.9 4.7a2.2 2.2 0 0 1 3.4 2.77l-.28.33-10.03 10.03a2 2 0 0 1-1.02.55zM14.4 6.2l3.4 3.4' }],
};

export type IconName = keyof typeof ICONS;

interface Props {
  name: IconName;
  /** Optical, not literal — a caret reads heavier than a glyph of the same box. */
  size?: number;
  /** Rotation in degrees, for the one caret that points four ways. */
  turn?: number;
  className?: string;
}

export function Icon({ name, size = 16, turn, className }: Props) {
  const strokes = ICONS[name];
  if (!strokes) return null;
  return (
    <svg
      className={className ? `ic ${className}` : 'ic'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decoration beside a label in every case here; the label is the name.
      aria-hidden="true"
      focusable="false"
      style={turn ? { transform: `rotate(${turn}deg)` } : undefined}
    >
      {strokes.map((s, i) => (
        <path key={i} d={s.d} fill={s.fill ? 'currentColor' : 'none'} stroke={s.fill ? 'none' : undefined} />
      ))}
    </svg>
  );
}
