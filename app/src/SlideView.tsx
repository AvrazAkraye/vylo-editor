import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Deck, Slide } from './slides';
import { H, W, contain, layout, type Box, type Para, type TextBox } from './slideslayout';

/**
 * One slide, drawn from the boxes slideslayout.ts gives every renderer.
 *
 * The slide is laid out on its own 1280 × 720 canvas and scaled to the width
 * it is given, so a thumbnail, the preview, the presenter's screen and a PDF
 * page are the same drawing at four sizes — and the PowerPoint file is that
 * drawing too, because slidespptx.ts places the same boxes.
 *
 * The canvas is always laid out left to right: every box already sits where
 * it belongs, reflected for an Arabic or Kurdish deck by the layout. Only the
 * text inside a box runs in its own direction.
 */

interface Props {
  deck: Deck;
  slide: Slide;
  index: number;
  /** The width to draw at, in CSS pixels. Omitted: the width of the box it is in. */
  width?: number;
  /** A click on a box that shows one of the slide's fields, with that field. */
  onField?: (field: string) => void;
  className?: string;
}

const FONT = "'Vylo Arabic', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";

/** `start` and `end` as the sides they are in a box of this direction. */
function sideOf(align: TextBox['align'], rtl: boolean): CSSProperties['textAlign'] {
  if (align === 'center') return 'center';
  return (align === 'start') !== rtl ? 'left' : 'right';
}

function Paragraph({ p, box }: { p: Para; box: TextBox }) {
  const style: CSSProperties = {
    fontSize: p.size,
    color: p.color,
    fontWeight: p.bold ? 700 : 400,
    marginBlockStart: p.gap ?? 0,
  };
  if (p.bullet) {
    // A hanging bullet: the first line starts at the bullet, the rest under the text.
    style.paddingInlineStart = '1.1em';
    style.textIndent = '-1.1em';
  }
  return (
    <p className="sl-p" style={style} dir={(p.rtl ?? box.rtl) ? 'rtl' : 'ltr'}>
      {p.bullet && <span className="sl-bullet" style={{ color: p.bullet }} aria-hidden="true">•</span>}
      {p.text}
    </p>
  );
}

function BoxView({ b, deck, onField }: { b: Box; deck: Deck; onField?: (field: string) => void }) {
  const place: CSSProperties = { left: b.x, top: b.y, width: b.w, height: b.h };
  if (b.t === 'rect') {
    return <div className="sl-rect" style={{ ...place, background: b.fill, borderRadius: b.radius ?? 0 }} />;
  }
  if (b.t === 'image') {
    const at = contain(b, deck.logoRatio);
    return <img className="sl-img" src={b.src} alt="" draggable={false} style={{ left: at.x, top: at.y, width: at.w, height: at.h }} />;
  }
  if (b.t === 'table') {
    return (
      <table className="sl-table" dir={b.rtl ? 'rtl' : 'ltr'} style={{ ...place, fontSize: b.size }}
             onClick={onField ? () => onField(b.field) : undefined} data-field={onField ? b.field : undefined}>
        <tbody>
          {b.rows.map((r, ri) => (
            <tr key={ri} style={{ height: b.rowH, background: ri === 0 ? b.headFill : ri % 2 === 0 ? b.stripe : '#FFFFFF' }}>
              {r.map((c, ci) => (
                <td key={ci} dir="auto" style={{ color: ri === 0 ? b.headInk : b.ink, fontWeight: ri === 0 ? 700 : 400, borderBlockEnd: `1.5px solid ${b.line}` }}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  const justify = b.valign === 'middle' ? 'center' : b.valign === 'bottom' ? 'flex-end' : 'flex-start';
  return (
    <div className={`sl-text${onField && b.field ? ' is-editable' : ''}`}
         style={{ ...place, justifyContent: justify, textAlign: sideOf(b.align, b.rtl), lineHeight: b.lineH }}
         onClick={onField && b.field ? () => onField(b.field!) : undefined} data-field={onField ? b.field : undefined}>
      {b.paras.map((p, i) => <Paragraph key={i} p={p} box={b} />)}
    </div>
  );
}

/** The slide at scale 1: the 1280 × 720 canvas itself. For the PDF, whose page is exactly that. */
export function SlideCanvas({ deck, slide, index, onField, scale = 1 }: Omit<Props, 'width' | 'className'> & { scale?: number }) {
  const drawn = useMemo(() => layout(slide, deck, index), [slide, deck, index]);
  return (
    <div className="sl-canvas" style={{ width: W, height: H, background: drawn.bg, fontFamily: FONT, transform: scale === 1 ? undefined : `scale(${scale})` }}>
      {drawn.boxes.map((b, i) => <BoxView key={i} b={b} deck={deck} onField={onField} />)}
    </div>
  );
}

/** The slide scaled to a width: given, or measured from the box it sits in. */
export function SlideView({ deck, slide, index, width, onField, className }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(0);
  useLayoutEffect(() => {
    if (width !== undefined) return;
    const el = frame.current;
    if (!el) return;
    const set = () => setMeasured(el.clientWidth);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  const w = width ?? measured;
  const scale = w > 0 ? w / W : 0;
  return (
    <div ref={frame} className={`sl-frame ${className ?? ''}`} style={width !== undefined ? { width, height: (width * H) / W } : undefined}>
      {scale > 0 && <SlideCanvas deck={deck} slide={slide} index={index} onField={onField} scale={scale} />}
    </div>
  );
}
