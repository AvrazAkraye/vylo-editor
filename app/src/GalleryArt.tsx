import type { ReactNode } from 'react';

/**
 * The drawing kit the modules' galleries share (ResearchArt.tsx,
 * VideoArt.tsx): a dark ground with a glow and a field of dots, and a few
 * shapes — a page, bars, a graph of nodes, a book — coloured from one hue.
 * SVG built here, so the pictures are sharp at any size, need no network,
 * and carry nobody's artwork into a public repository. Every picture is
 * decoration: `aria-hidden`, with the card's own text saying what it is.
 */

export const c = (h: number, s: number, l: number, a = 1) => `hsl(${h} ${s}% ${l}% / ${a})`;

/** The dark ground every picture stands on: a gradient, a glow, a field of dots. */
export function Ground({ h, id, children, w = 320, hgt = 180 }: { h: number; id: string; children: ReactNode; w?: number; hgt?: number }) {
  return (
    <svg viewBox={`0 0 ${w} ${hgt}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" className="gal-art-svg">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={c(h, 45, 20)} />
          <stop offset="1" stopColor={c((h + 40) % 360, 55, 7)} />
        </linearGradient>
        <radialGradient id={`${id}-r`} cx=".72" cy=".35" r=".55">
          <stop offset="0" stopColor={c(h, 90, 60, 0.55)} />
          <stop offset="1" stopColor={c(h, 90, 60, 0)} />
        </radialGradient>
        <pattern id={`${id}-p`} width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1" fill={c(h, 60, 85, 0.12)} />
        </pattern>
      </defs>
      <rect width={w} height={hgt} fill={`url(#${id}-g)`} />
      <rect width={w} height={hgt} fill={`url(#${id}-p)`} />
      <rect width={w} height={hgt} fill={`url(#${id}-r)`} />
      {children}
    </svg>
  );
}

/** A sheet of paper with lines of text and an accent heading. */
export function Page({ x, y, w, h, hue, rot = 0, lines = 6, cols = 1, fade = 1 }: {
  x: number; y: number; w: number; h: number; hue: number; rot?: number; lines?: number; cols?: number; fade?: number;
}) {
  const colW = (w - 20 - (cols - 1) * 8) / cols;
  return (
    <g transform={`rotate(${rot} ${x + w / 2} ${y + h / 2})`} opacity={fade}>
      <rect x={x + 3} y={y + 4} width={w} height={h} rx="4" fill="#000" opacity=".35" />
      <rect x={x} y={y} width={w} height={h} rx="4" fill="#F7F5FB" />
      <rect x={x + 10} y={y + 10} width={w * 0.55} height="6" rx="3" fill={c(hue, 70, 50)} />
      {Array.from({ length: cols }).map((_, k) => Array.from({ length: lines }).map((__, i) => (
        <rect key={`${k}-${i}`} x={x + 10 + k * (colW + 8)} y={y + 24 + i * 9} width={colW * (i % 3 === 2 ? 0.7 : 1)} height="3.5" rx="1.75" fill="#C9C4D6" />
      )))}
    </g>
  );
}

export function Nodes({ hue, x, y }: { hue: number; x: number; y: number }) {
  const pts: [number, number][] = [[0, 0], [34, -18], [60, 8], [28, 30], [74, -26], [92, 20]];
  const links: [number, number][] = [[0, 1], [1, 2], [0, 3], [3, 2], [1, 4], [2, 5], [4, 5]];
  return (
    <g transform={`translate(${x} ${y})`}>
      {links.map(([a, b], i) => <line key={i} x1={pts[a][0]} y1={pts[a][1]} x2={pts[b][0]} y2={pts[b][1]} stroke={c(hue, 90, 70, 0.5)} strokeWidth="1" />)}
      {pts.map(([px, py], i) => <circle key={i} cx={px} cy={py} r={i % 2 ? 3 : 4.5} fill={c(hue, 95, i % 2 ? 75 : 62)} />)}
    </g>
  );
}

export function Bars({ hue, x, y, n = 5 }: { hue: number; x: number; y: number; n?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {Array.from({ length: n }).map((_, i) => {
        const hh = 12 + ((i * 37) % 30);
        return <rect key={i} x={i * 11} y={-hh} width="7" height={hh} rx="2" fill={c(hue, 90, 55 + i * 4)} />;
      })}
    </g>
  );
}

export function Book({ x, y, w, h, hue, light = 45 }: { x: number; y: number; w: number; h: number; hue: number; light?: number }) {
  return (
    <g>
      <rect x={x + 3} y={y + 4} width={w} height={h} rx="3" fill="#000" opacity=".35" />
      <rect x={x} y={y} width={w} height={h} rx="3" fill={c(hue, 55, light)} />
      <rect x={x} y={y} width="6" height={h} rx="2" fill={c(hue, 60, light - 15)} />
      <rect x={x + 12} y={y + 12} width={w - 22} height="5" rx="2" fill={c(hue, 80, 85)} />
      <rect x={x + 12} y={y + 22} width={(w - 22) * 0.6} height="3" rx="1.5" fill={c(hue, 60, 80, 0.8)} />
    </g>
  );
}

