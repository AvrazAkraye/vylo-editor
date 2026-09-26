import type { ReactNode } from 'react';
import type { Kind } from './research';
import { Bars, Book, Ground, Nodes, Page, c } from './GalleryArt';

/**
 * Research's pictures: one for each kind of document, in its own hue, and the
 * banner's scenes — drawn with GalleryArt.tsx's kit rather than downloaded.
 */

/** A kind's colour, as a hue: the card, its badge and its documents' covers share it. */
export const HUE: Readonly<Record<Kind, number>> = {
  'working-paper': 38, article: 217, conference: 262, review: 172, proposal: 24, graduation: 142, masters: 239, phd: 346,
};

/** How the gallery groups the kinds, for its chips. */
export type Group = 'paper' | 'thesis' | 'plan';
export const GROUP: Readonly<Record<Kind, Group>> = {
  'working-paper': 'paper', article: 'paper', conference: 'paper', review: 'plan', proposal: 'plan', graduation: 'thesis', masters: 'thesis', phd: 'thesis',
};

/** One picture for each kind of document. */
export function KindArt({ kind }: { kind: Kind }) {
  const h = HUE[kind];
  const id = `ka-${kind}`;
  const art: Record<Kind, ReactNode> = {
    'working-paper': (
      <>
        <Page x={150} y={28} w={110} h={138} hue={h} rot={6} lines={10} />
        <g transform="translate(40 60)">
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`translate(${i * 30} 0)`}>
              <rect y={60 - (i + 2) * 14} width="20" height={(i + 2) * 14} rx="3" fill={c(h, 85, 55 + i * 8)} />
              <circle cx="10" cy={48 - (i + 2) * 14} r="6" fill={c(h, 90, 75)} />
            </g>
          ))}
        </g>
      </>
    ),
    article: (
      <>
        <Page x={42} y={26} w={128} h={150} hue={h} rot={-4} lines={11} cols={2} />
        <Page x={176} y={40} w={104} h={124} hue={h} rot={5} lines={4} />
        <Bars hue={h} x={194} y={150} />
      </>
    ),
    conference: (
      <>
        <rect x="150" y="26" width="140" height="84" rx="6" fill={c(h, 30, 14)} stroke={c(h, 80, 65, 0.7)} />
        <Bars hue={h} x={166} y={96} n={6} />
        <circle cx="258" cy="66" r="18" fill="none" stroke={c(h, 90, 65)} strokeWidth="7" strokeDasharray="70 200" />
        <rect x="60" y="102" width="70" height="60" rx="5" fill={c(h, 45, 32)} />
        <rect x="56" y="96" width="78" height="10" rx="4" fill={c(h, 55, 45)} />
        <path d="M95 96 L95 70" stroke="#CFC9DD" strokeWidth="3" />
        <rect x="89" y="54" width="12" height="20" rx="6" fill="#E9E6F2" />
      </>
    ),
    review: (
      <>
        <Book x={40} y={120} w={120} h={24} hue={h} light={40} />
        <Book x={48} y={94} w={108} h={24} hue={(h + 20) % 360} light={48} />
        <Book x={36} y={68} w={116} h={24} hue={(h + 40) % 360} light={42} />
        <Page x={176} y={34} w={96} h={118} hue={h} rot={4} lines={9} />
        <circle cx="236" cy="110" r="26" fill={c(h, 60, 80, 0.18)} stroke={c(h, 90, 70)} strokeWidth="6" />
        <path d="M254 128 L278 152" stroke={c(h, 90, 70)} strokeWidth="9" strokeLinecap="round" />
      </>
    ),
    proposal: (
      <>
        <rect x="36" y="36" width="248" height="120" rx="8" fill={c(h, 30, 12, 0.7)} stroke={c(h, 70, 60, 0.4)} />
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <rect x="48" y={52 + i * 20} width="40" height="6" rx="3" fill="#C9C4D6" opacity=".6" />
            <rect x={100 + i * 26} y={50 + i * 20} width={60 + (i % 2) * 30} height="10" rx="5" fill={c(h, 90, 52 + i * 5)} />
          </g>
        ))}
        {[0, 1, 2, 3, 4, 5].map((i) => <line key={i} x1={100 + i * 30} y1="44" x2={100 + i * 30} y2="150" stroke={c(h, 60, 80, 0.12)} />)}
      </>
    ),
    graduation: (
      <>
        <Page x={48} y={40} w={104} h={128} hue={h} rot={-6} lines={9} />
        <g transform="translate(222 88)">
          <path d="M-58 0 L0 -26 L58 0 L0 26 Z" fill={c(h, 45, 28)} stroke={c(h, 80, 60)} strokeWidth="2" />
          <path d="M-34 12 L-34 38 Q0 56 34 38 L34 12 L0 26 Z" fill={c(h, 40, 22)} />
          <path d="M44 6 L44 40" stroke={c(h, 95, 65)} strokeWidth="3" />
          <circle cx="44" cy="44" r="6" fill={c(h, 95, 65)} />
        </g>
      </>
    ),
    masters: (
      <>
        <Book x={56} y={42} w={98} h={128} hue={h} light={38} />
        <path d="M130 42 L130 96 L138 88 L146 96 L146 42 Z" fill={c((h + 330) % 360, 85, 60)} />
        <Page x={172} y={36} w={100} h={122} hue={h} rot={5} lines={9} />
      </>
    ),
    phd: (
      <>
        <Book x={40} y={30} w={70} h={140} hue={h} light={34} />
        <Book x={116} y={44} w={64} h={126} hue={(h + 15) % 360} light={42} />
        <Nodes hue={h} x={200} y={70} />
        <g transform="translate(250 130)">
          <circle r="22" fill={c(h, 80, 50)} />
          <path d="M0 -12 L3.5 -3.5 L12 -3.5 L5 2 L7.5 11 L0 6 L-7.5 11 L-5 2 L-12 -3.5 L-3.5 -3.5 Z" fill={c(h, 90, 88)} />
        </g>
      </>
    ),
  };
  return <Ground h={h} id={id}>{art[kind]}</Ground>;
}

/** The banner's scenes. */
export type Scene = 'write' | 'voice' | 'check' | 'chat';
export const SCENE_HUE: Readonly<Record<Scene, number>> = { write: 262, voice: 38, check: 158, chat: 212 };

export function SceneArt({ scene }: { scene: Scene }) {
  const h = SCENE_HUE[scene];
  const id = `sa-${scene}`;
  const body: Record<Scene, ReactNode> = {
    write: (
      <>
        <rect x="300" y="44" width="250" height="160" rx="10" fill={c(h, 30, 10)} stroke={c(h, 70, 60, 0.5)} />
        <rect x="300" y="44" width="250" height="18" rx="10" fill={c(h, 40, 18)} />
        {[0, 1, 2].map((i) => <circle key={i} cx={312 + i * 11} cy="53" r="3" fill={c(h, 60, 70, 0.7)} />)}
        <Page x={318} y={72} w={110} h={120} hue={h} lines={10} />
        <Bars hue={h} x={448} y={180} n={8} />
        <circle cx="505" cy="110" r="24" fill="none" stroke={c(h, 90, 65)} strokeWidth="9" strokeDasharray="95 200" />
        <circle cx="505" cy="110" r="24" fill="none" stroke={c((h + 60) % 360, 90, 65)} strokeWidth="9" strokeDasharray="40 200" strokeDashoffset="-95" />
        <Nodes hue={h} x={170} y={70} />
        <Page x={180} y={130} w={90} h={90} hue={h} rot={-8} lines={6} fade={0.9} />
      </>
    ),
    voice: (
      <>
        <g transform="translate(250 120)">
          <circle r="34" cy="-30" fill={c(h, 80, 60)} />
          <path d="M-58 60 Q0 -10 58 60 Z" fill={c(h, 70, 50)} />
        </g>
        {[0, 1, 2, 3].map((i) => (
          <path key={i} d={`M300 ${80 + i * 22} C 350 ${60 + i * 22}, 380 ${110 + i * 22}, 430 ${85 + i * 22}`} fill="none"
                stroke={c(h, 90, 70, 0.6 - i * 0.1)} strokeWidth="3" strokeLinecap="round" />
        ))}
        <Page x={440} y={40} w={120} h={160} hue={h} rot={4} lines={13} />
      </>
    ),
    check: (
      <>
        <g transform="translate(260 120)">
          <path d="M0 -80 L64 -56 L64 -6 C64 36 36 64 0 78 C-36 64 -64 36 -64 -6 L-64 -56 Z" fill={c(h, 50, 22)} stroke={c(h, 90, 60)} strokeWidth="4" />
          <path d="M-26 -2 L-6 18 L30 -22" fill="none" stroke={c(h, 95, 65)} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <Page x={380} y={50} w={120} h={150} hue={h} rot={5} lines={12} />
        <rect x="392" y="104" width="80" height="9" rx="2" fill={c(0, 85, 60, 0.45)} transform="rotate(5 440 125)" />
        <circle cx="520" cy="70" r="26" fill="none" stroke={c(h, 30, 30)} strokeWidth="8" />
        <circle cx="520" cy="70" r="26" fill="none" stroke={c(h, 95, 60)} strokeWidth="8" strokeDasharray="30 200" transform="rotate(-90 520 70)" />
      </>
    ),
    chat: (
      <>
        <Page x={200} y={50} w={130} h={160} hue={h} rot={-5} lines={13} />
        <g>
          <rect x="360" y="52" width="170" height="40" rx="14" fill={c(h, 70, 50)} />
          <rect x="376" y="66" width="120" height="5" rx="2.5" fill="#fff" opacity=".85" />
          <rect x="376" y="76" width="80" height="5" rx="2.5" fill="#fff" opacity=".6" />
          <rect x="340" y="104" width="190" height="56" rx="14" fill={c(h, 25, 20)} stroke={c(h, 70, 60, 0.5)} />
          <rect x="356" y="118" width="150" height="5" rx="2.5" fill="#C9C4D6" />
          <rect x="356" y="129" width="130" height="5" rx="2.5" fill="#C9C4D6" opacity=".8" />
          <rect x="356" y="140" width="90" height="5" rx="2.5" fill="#C9C4D6" opacity=".6" />
          <rect x="420" y="172" width="110" height="30" rx="12" fill={c(h, 70, 50)} />
          <circle cx="440" cy="187" r="4" fill="#fff" /><circle cx="454" cy="187" r="4" fill="#fff" opacity=".7" /><circle cx="468" cy="187" r="4" fill="#fff" opacity=".4" />
        </g>
      </>
    ),
  };
  return <Ground h={h} id={id} w={600} hgt={240}>{body[scene]}</Ground>;
}
