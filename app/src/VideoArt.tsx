import type { ReactNode } from 'react';
import type { SceneKind } from './videotypes';
import { Bars, Ground, Nodes, Page, c } from './GalleryArt';

/**
 * Video's pictures, drawn with GalleryArt.tsx's kit: one for each kind of
 * scene the model can plan, each a small screen showing what that scene
 * does, and the banner's scenes. Decoration only; the card says what it is.
 */

export const SCENE_HUE: Readonly<Record<SceneKind, number>> = {
  title: 262, kinetic: 292, bullets: 222, stat: 38, chart: 200, quote: 330, image: 158, split: 176,
  steps: 250, outro: 12, gallery: 140, timeline: 48, compare: 190, people: 24, logo: 280, qr: 210,
};

/** How the gallery groups the scenes, for its chips. */
export type SceneGroup = 'words' | 'data' | 'pictures';
export const SCENE_GROUP: Readonly<Record<SceneKind, SceneGroup>> = {
  title: 'words', kinetic: 'words', bullets: 'words', quote: 'words', steps: 'words', outro: 'words',
  stat: 'data', chart: 'data', timeline: 'data', compare: 'data',
  image: 'pictures', split: 'pictures', gallery: 'pictures', people: 'pictures', logo: 'pictures', qr: 'pictures',
};

const X = 44;
const Y = 20;
const W = 232;
const H = 130;

/** A screen, its recording light on: every scene is shown on one. */
function Screen({ h, children }: { h: number; children: ReactNode }) {
  return (
    <g>
      <rect x={X + 4} y={Y + 6} width={W} height={H} rx="8" fill="#000" opacity=".4" />
      <rect x={X} y={Y} width={W} height={H} rx="8" fill={c(h, 35, 11)} stroke={c(h, 70, 60, 0.45)} />
      {children}
      <circle cx={X + 12} cy={Y + 12} r="3.5" fill={c(0, 85, 60)} />
    </g>
  );
}

const bar = (x: number, y: number, w: number, hh: number, fill: string, key?: number | string) => (
  <rect key={key} x={x} y={y} width={w} height={hh} rx={hh / 2} fill={fill} />
);

/** One picture for each kind of scene. */
export function SceneKindArt({ kind }: { kind: SceneKind }) {
  const h = SCENE_HUE[kind];
  const hi = c(h, 90, 64);
  const soft = '#D9D4E6';
  const cx = X + W / 2;
  const cy = Y + H / 2;
  const inside: Record<SceneKind, ReactNode> = {
    title: (
      <>
        {bar(cx - 80, cy - 16, 160, 16, '#F4F1FA')}
        {bar(cx - 50, cy + 10, 100, 7, hi)}
      </>
    ),
    kinetic: (
      <>
        {[['#F4F1FA', 0, 1], [hi, 1, 0.9], ['#F4F1FA', 2, 0.55], [soft, 3, 0.25]].map(([f, i, o]) => (
          <rect key={String(i)} x={X + 30 + Number(i) * 44} y={cy - 22 + Number(i) * 10} width="40" height="14" rx="7" fill={String(f)} opacity={Number(o)} />
        ))}
      </>
    ),
    bullets: (
      <>
        {bar(X + 24, Y + 20, 110, 10, '#F4F1FA')}
        {[0, 1, 2, 3].map((i) => (
          <g key={i} opacity={1 - i * 0.2}>
            <circle cx={X + 30} cy={Y + 48 + i * 20} r="4" fill={hi} />
            {bar(X + 42, Y + 45 + i * 20, 120 - i * 14, 6, soft)}
          </g>
        ))}
      </>
    ),
    stat: (
      <>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="48" fontWeight="800" fill="#F4F1FA" fontFamily="system-ui, sans-serif">87%</text>
        {bar(cx - 40, cy + 26, 80, 6, hi)}
      </>
    ),
    chart: <Bars hue={h} x={X + 40} y={Y + H - 18} n={6} />,
    quote: (
      <>
        <text x={X + 22} y={Y + 58} fontSize="64" fontWeight="800" fill={hi} fontFamily="Georgia, serif">“</text>
        {bar(X + 64, Y + 36, 140, 7, '#F4F1FA')}
        {bar(X + 64, Y + 52, 120, 7, '#F4F1FA')}
        {bar(X + 64, Y + 68, 90, 7, '#F4F1FA')}
        {bar(X + 64, Y + 92, 60, 5, hi)}
      </>
    ),
    image: (
      <>
        <circle cx={X + W - 52} cy={Y + 38} r="14" fill={c(48, 95, 65)} />
        <path d={`M${X} ${Y + H - 8} L${X + 70} ${Y + 60} L${X + 118} ${Y + 100} L${X + 160} ${Y + 70} L${X + W} ${Y + H - 8} Z`} fill={c(h, 55, 40)} />
        <path d={`M${X} ${Y + H - 8} L${X + 50} ${Y + 90} L${X + 100} ${Y + H - 8} Z`} fill={c(h, 60, 28)} />
        {bar(X + 16, Y + H - 28, 90, 8, '#F4F1FA')}
      </>
    ),
    split: (
      <>
        <rect x={X + 10} y={Y + 10} width={W / 2 - 16} height={H - 20} rx="5" fill={c(h, 55, 35)} />
        <circle cx={X + 50} cy={Y + 44} r="10" fill={c(48, 95, 65)} />
        <path d={`M${X + 10} ${Y + H - 10} L${X + 60} ${Y + 60} L${X + W / 2 - 6} ${Y + H - 10} Z`} fill={c(h, 60, 22)} />
        {bar(X + W / 2 + 12, Y + 34, 84, 10, '#F4F1FA')}
        {bar(X + W / 2 + 12, Y + 54, 90, 6, soft)}
        {bar(X + W / 2 + 12, Y + 66, 70, 6, soft)}
      </>
    ),
    steps: (
      <>
        <line x1={X + 40} y1={cy} x2={X + W - 40} y2={cy} stroke={c(h, 60, 60, 0.5)} strokeWidth="3" />
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <circle cx={X + 40 + i * ((W - 80) / 2)} cy={cy} r="16" fill={i === 2 ? c(h, 40, 25) : hi} stroke={hi} strokeWidth="2" />
            <text x={X + 40 + i * ((W - 80) / 2)} y={cy + 6} textAnchor="middle" fontSize="16" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif">{i + 1}</text>
            {bar(X + 22 + i * ((W - 80) / 2), cy + 26, 36, 5, soft)}
          </g>
        ))}
      </>
    ),
    outro: (
      <>
        <circle cx={cx} cy={cy - 22} r="18" fill={hi} />
        {bar(cx - 60, cy + 6, 120, 9, '#F4F1FA')}
        <rect x={cx - 40} y={cy + 24} width="80" height="18" rx="9" fill={c(h, 90, 55)} />
      </>
    ),
    gallery: (
      <>
        {[[-58, -6, c(h, 55, 36)], [0, 4, c((h + 40) % 360, 55, 40)], [58, -4, c((h + 80) % 360, 55, 38)]].map(([dx, rot, f], i) => (
          <g key={i} transform={`rotate(${rot} ${cx + Number(dx)} ${cy})`}>
            <rect x={cx + Number(dx) - 34} y={cy - 36} width="68" height="72" rx="4" fill="#F4F1FA" />
            <rect x={cx + Number(dx) - 30} y={cy - 32} width="60" height="52" rx="2" fill={String(f)} />
          </g>
        ))}
      </>
    ),
    timeline: (
      <>
        <line x1={X + 20} y1={cy} x2={X + W - 20} y2={cy} stroke={hi} strokeWidth="3" />
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <circle cx={X + 36 + i * 54} cy={cy} r="6" fill="#fff" stroke={hi} strokeWidth="3" />
            {bar(X + 20 + i * 54, i % 2 ? cy + 14 : cy - 22, 32, 6, i % 2 ? soft : '#F4F1FA')}
          </g>
        ))}
      </>
    ),
    compare: (
      <>
        <rect x={X + 12} y={Y + 14} width={W / 2 - 18} height={H - 28} rx="6" fill={c(0, 60, 45, 0.25)} stroke={c(0, 70, 60, 0.6)} />
        <rect x={X + W / 2 + 6} y={Y + 14} width={W / 2 - 18} height={H - 28} rx="6" fill={c(150, 60, 45, 0.25)} stroke={c(150, 70, 55, 0.7)} />
        <path d={`M${X + 50} ${cy - 10} l16 16 m0 -16 l-16 16`} stroke={c(0, 80, 65)} strokeWidth="5" strokeLinecap="round" />
        <path d={`M${X + W / 2 + 44} ${cy - 2} l10 10 l20 -22`} stroke={c(150, 80, 55)} strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {bar(X + 30, cy + 22, 60, 5, soft)}
        {bar(X + W / 2 + 24, cy + 22, 60, 5, soft)}
      </>
    ),
    people: (
      <>
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <circle cx={X + 62 + i * 54} cy={cy - 12} r="18" fill={c((h + i * 30) % 360, 60, 55)} />
            <circle cx={X + 62 + i * 54} cy={cy - 17} r="7" fill="#F4F1FA" />
            <path d={`M${X + 50 + i * 54} ${cy + 1} Q${X + 62 + i * 54} ${cy - 12} ${X + 74 + i * 54} ${cy + 1}`} fill="#F4F1FA" />
            {bar(X + 44 + i * 54, cy + 14, 36, 6, '#F4F1FA')}
          </g>
        ))}
      </>
    ),
    logo: (
      <>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <line key={i} x1={cx} y1={cy} x2={cx + Math.cos(i * Math.PI / 4) * 58} y2={cy + Math.sin(i * Math.PI / 4) * 48} stroke={c(h, 90, 70, 0.25)} strokeWidth="2" />
        ))}
        <path d={`M${cx} ${cy - 30} L${cx + 26} ${cy - 15} L${cx + 26} ${cy + 15} L${cx} ${cy + 30} L${cx - 26} ${cy + 15} L${cx - 26} ${cy - 15} Z`} fill={hi} />
        <path d={`M${cx} ${cy - 14} L${cx + 12} ${cy - 7} L${cx + 12} ${cy + 7} L${cx} ${cy + 14} L${cx - 12} ${cy + 7} L${cx - 12} ${cy - 7} Z`} fill={c(h, 40, 15)} />
      </>
    ),
    qr: (
      <>
        <rect x={cx - 42} y={cy - 42} width="84" height="84" rx="6" fill="#F4F1FA" />
        {[[-34, -34], [14, -34], [-34, 14]].map(([dx, dy], i) => (
          <g key={i}>
            <rect x={cx + dx} y={cy + dy} width="20" height="20" rx="2" fill={c(h, 40, 15)} />
            <rect x={cx + dx + 5} y={cy + dy + 5} width="10" height="10" rx="1" fill="#F4F1FA" />
          </g>
        ))}
        {Array.from({ length: 16 }).map((_, i) => {
          const px = (i * 37) % 4;
          const py = Math.floor((i * 53) % 16 / 4);
          return <rect key={i} x={cx + 4 + px * 8} y={cy + 4 + py * 8} width="6" height="6" fill={c(h, 40, 15)} />;
        })}
      </>
    ),
  };
  return <Ground h={h} id={`vk-${kind}`}><Screen h={h}>{inside[kind]}</Screen></Ground>;
}

/** The banner's scenes. */
export type VideoScene = 'film' | 'web' | 'talk';
export const VIDEO_SCENE_HUE: Readonly<Record<VideoScene, number>> = { film: 280, web: 190, talk: 24 };

export function VideoSceneArt({ scene, rtl = false }: { scene: VideoScene; rtl?: boolean }) {
  const h = VIDEO_SCENE_HUE[scene];
  const body: Record<VideoScene, ReactNode> = {
    film: (
      <>
        <rect x="250" y="40" width="300" height="170" rx="12" fill={c(h, 35, 10)} stroke={c(h, 70, 60, 0.5)} />
        <rect x="270" y="60" width="260" height="110" rx="6" fill={c(h, 55, 30)} />
        <circle cx="400" cy="115" r="26" fill="#fff" opacity=".92" />
        <path d="M392 102 L414 115 L392 128 Z" fill={c(h, 60, 30)} />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <rect key={i} x={270 + i * 44} y="180" width="38" height="22" rx="3" fill={c((h + i * 25) % 360, 60, 45)} />
        ))}
        <rect x="500" y="110" width="74" height="120" rx="10" fill={c(h, 35, 12)} stroke={c(h, 70, 60, 0.6)} />
        <rect x="509" y="122" width="56" height="64" rx="4" fill={c((h + 60) % 360, 60, 45)} />
        <rect x="511" y="196" width="52" height="6" rx="3" fill="#F4F1FA" />
      </>
    ),
    web: (
      <>
        <g transform="translate(300 125)">
          <circle r="62" fill={c(h, 60, 30)} stroke={c(h, 90, 65)} strokeWidth="3" />
          <ellipse rx="26" ry="62" fill="none" stroke={c(h, 90, 70, 0.7)} strokeWidth="2" />
          <line x1="-62" y1="0" x2="62" y2="0" stroke={c(h, 90, 70, 0.7)} strokeWidth="2" />
          <path d="M-54 -30 Q0 -18 54 -30 M-54 30 Q0 18 54 30" fill="none" stroke={c(h, 90, 70, 0.5)} strokeWidth="2" />
        </g>
        <Nodes hue={h} x={390} y={80} />
        <rect x="400" y="130" width="150" height="80" rx="8" fill="#F4F1FA" />
        <rect x="412" y="142" width="60" height="44" rx="4" fill={c(h, 55, 45)} />
        <rect x="482" y="146" width="56" height="6" rx="3" fill={c(h, 70, 45)} />
        <rect x="482" y="160" width="46" height="4" rx="2" fill="#C9C4D6" />
        <rect x="482" y="170" width="52" height="4" rx="2" fill="#C9C4D6" />
      </>
    ),
    talk: (
      <>
        <rect x="200" y="50" width="200" height="150" rx="10" fill={c(h, 35, 10)} stroke={c(h, 70, 60, 0.5)} />
        <rect x="214" y="64" width="172" height="100" rx="5" fill={c(h, 60, 38)} />
        <Page x={250} y={80} w={100} h={70} hue={h} lines={4} />
        <rect x="420" y="60" width="150" height="36" rx="14" fill={c(h, 75, 52)} />
        <rect x="436" y="74" width="100" height="5" rx="2.5" fill="#fff" opacity=".85" />
        <rect x="400" y="108" width="170" height="50" rx="14" fill={c(h, 25, 20)} stroke={c(h, 70, 60, 0.5)} />
        <rect x="416" y="122" width="130" height="5" rx="2.5" fill="#C9C4D6" />
        <rect x="416" y="134" width="100" height="5" rx="2.5" fill="#C9C4D6" opacity=".7" />
        <circle cx="520" cy="190" r="20" fill={c(h, 80, 55)} />
        <rect x="514" y="178" width="12" height="18" rx="6" fill="#fff" />
      </>
    ),
  };
  // Not mirrored right to left — a play button points forwards in every
  // language — but moved to the far side of the words.
  return <Ground h={h} id={`vs-${scene}`} w={600} hgt={240}><g transform={rtl ? 'translate(-200 0)' : undefined}>{body[scene]}</g></Ground>;
}
