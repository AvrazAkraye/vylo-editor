/**
 * The PowerPoint file: a deck as the person was shown it, as slides they can
 * open and change in PowerPoint, Keynote or Google Slides.
 *
 * ## Written here, not with a library
 *
 * A `.pptx` is a zip of XML parts. The libraries that write one are large,
 * carry their own zip and image code, and would be a dependency to keep
 * current and a licence to list for a file whose shape this app fully
 * decides. So this writes the parts itself — a presentation, one master, one
 * blank layout, a theme, the slides and their speaker notes — and stores them
 * in a zip written below (stored, not compressed: a deck is XML and a logo,
 * and PowerPoint reads a stored zip as readily as a deflated one).
 *
 * Every slide is the boxes slideslayout.ts gave the panel, placed at the same
 * coordinates — a pixel of its 1280 × 720 canvas is 9525 EMU, a font's pixel
 * ¾ of a point — so what was on screen is what is in the file.
 *
 * ## Text only ever goes in as text
 *
 * Everything the model or the person wrote enters a part as the escaped
 * content of an `<a:t>`. A title that reads `</a:t><a:fld …/>` is printed, not
 * obeyed, and a character XML cannot hold (a stray control character) is
 * dropped rather than written into a file PowerPoint would refuse to open.
 *
 * ## Right to left
 *
 * An Arabic or Kurdish paragraph is marked `rtl` and aligned as the layout
 * said, a table runs its columns from the right, and the presentation itself
 * is marked right to left so PowerPoint's slide sorter reads that way too.
 */

import type { Deck, DeckLang } from './slides';
import type { Box, ImageBox, Para, RectBox, TableBox, TextBox } from './slideslayout';
import { H, W, contain, layout } from './slideslayout';

/** EMU in one pixel of the layout's canvas: 12 192 000 across 1280. */
const EMU = 9525;
const emu = (px: number) => Math.round(px * EMU);
/** Hundredths of a point in one pixel of font size. */
const SZ = 75;

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS = `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"`;
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const CT = 'application/vnd.openxmlformats-officedocument.presentationml';

/** The fonts asked for: Arial has every Kurdish letter (Research's Word files use it for the same reason). */
const FONT: Readonly<Record<DeckLang, string>> = { ar: 'Arial', ckb: 'Arial', kmr: 'Arial', en: 'Calibri' };
const LANG_TAG: Readonly<Record<DeckLang, string>> = { ar: 'ar-IQ', ckb: 'ku-Arab-IQ', kmr: 'ku-Arab-IQ', en: 'en-US' };

// ── XML ───────────────────────────────────────────────────────────────────

/** Text as XML content: escaped, with what XML 1.0 cannot hold removed. */
export function xmlText(s: string): string {
  return String(s)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const hex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c.slice(1).toUpperCase() : '000000');
const fill = (c: string) => `<a:solidFill><a:srgbClr val="${hex(c)}"/></a:solidFill>`;

// ── shapes ────────────────────────────────────────────────────────────────

interface Ctx { lang: DeckLang; font: string; id: number; images: { rid: string; box: ImageBox }[]; ratio?: number }

const xfrm = (b: { x: number; y: number; w: number; h: number }) =>
  `<a:xfrm><a:off x="${emu(b.x)}" y="${emu(b.y)}"/><a:ext cx="${Math.max(1, emu(b.w))}" cy="${Math.max(1, emu(b.h))}"/></a:xfrm>`;

function runProps(ctx: Ctx, size: number, color: string, bold?: boolean, tag = 'a:rPr'): string {
  return `<${tag} lang="${LANG_TAG[ctx.lang]}" altLang="en-US" sz="${Math.round(size * SZ)}"${bold ? ' b="1"' : ' b="0"'} dirty="0">${fill(color)}<a:latin typeface="${ctx.font}"/><a:cs typeface="${ctx.font}"/></${tag}>`;
}

function algn(align: TextBox['align'], rtl: boolean): string {
  if (align === 'center') return 'ctr';
  const left = (align === 'start') !== rtl;
  return left ? 'l' : 'r';
}

function paragraph(ctx: Ctx, p: Para, box: Pick<TextBox, 'align' | 'rtl' | 'lineH'>): string {
  // PowerPoint's single spacing is about 1.2 × the size; the layout's is its own multiple.
  const spacing = Math.round((box.lineH / 1.2) * 100000);
  const indent = p.bullet ? emu(p.size * 1.1) : 0;
  const props = [
    `<a:pPr algn="${algn(box.align, box.rtl)}" rtl="${(p.rtl ?? box.rtl) ? 1 : 0}"${indent ? ` marL="${indent}" indent="${-indent}"` : ' marL="0" indent="0"'}>`,
    `<a:lnSpc><a:spcPct val="${spacing}"/></a:lnSpc>`,
    `<a:spcBef><a:spcPts val="${Math.round((p.gap ?? 0) * SZ)}"/></a:spcBef>`,
    p.bullet ? `<a:buClr><a:srgbClr val="${hex(p.bullet)}"/></a:buClr><a:buSzPct val="100000"/><a:buFont typeface="Arial"/><a:buChar char="•"/>` : '<a:buNone/>',
    '</a:pPr>',
  ].join('');
  if (!p.text) return `<a:p>${props}${runProps(ctx, p.size, p.color, p.bold, 'a:endParaRPr')}</a:p>`;
  return `<a:p>${props}<a:r>${runProps(ctx, p.size, p.color, p.bold)}<a:t>${xmlText(p.text)}</a:t></a:r></a:p>`;
}

function textShape(ctx: Ctx, b: TextBox): string {
  const id = ctx.id++;
  const anchor = b.valign === 'middle' ? 'ctr' : b.valign === 'bottom' ? 'b' : 't';
  const paras = b.paras.length ? b.paras : [{ text: '', size: 18, color: '#000000' }];
  return [
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`,
    `<p:spPr>${xfrm(b)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`,
    `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>`,
    ...paras.map((p) => paragraph(ctx, p, b)),
    '</p:txBody></p:sp>',
  ].join('');
}

function rectShape(ctx: Ctx, b: RectBox): string {
  const id = ctx.id++;
  const r = b.radius ?? 0;
  const dot = r > 0 && Math.abs(b.w - b.h) < 1 && r >= b.w / 2 - 0.5;
  const geom = dot
    ? '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>'
    : r > 0
      ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.min(50000, Math.round((r / Math.min(b.w, b.h)) * 100000))}"/></a:avLst></a:prstGeom>`
      : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(b)}${geom}${fill(b.fill)}<a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
}

function imageShape(ctx: Ctx, b: ImageBox): string {
  const id = ctx.id++;
  const rid = `rId${ctx.images.length + 2}`;
  ctx.images.push({ rid, box: b });
  const at = contain(b, ctx.ratio);
  return [
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Logo ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`,
    `<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`,
    `<p:spPr>${xfrm(at)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`,
  ].join('');
}

function tableShape(ctx: Ctx, b: TableBox): string {
  const id = ctx.id++;
  const cols = Math.max(1, ...b.rows.map((r) => r.length));
  const colW = Math.floor(emu(b.w) / cols);
  const none = (side: string) => `<a:${side} w="0"><a:noFill/></a:${side}>`;
  const cell = (text: string, head: boolean, ri: number) => {
    const color = head ? b.headInk : b.ink;
    const para = text
      ? `<a:p><a:pPr algn="ctr" rtl="${b.rtl ? 1 : 0}"/><a:r>${runProps(ctx, b.size, color, head)}<a:t>${xmlText(text)}</a:t></a:r></a:p>`
      : `<a:p><a:pPr algn="ctr" rtl="${b.rtl ? 1 : 0}"/>${runProps(ctx, b.size, color, head, 'a:endParaRPr')}</a:p>`;
    const bg = head ? b.headFill : ri % 2 === 0 ? b.stripe : '#FFFFFF';
    return [
      `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${para}</a:txBody>`,
      `<a:tcPr marL="${emu(14)}" marR="${emu(14)}" marT="${emu(6)}" marB="${emu(6)}" anchor="ctr">`,
      none('lnL'), none('lnR'), none('lnT'),
      `<a:lnB w="${emu(1.5)}" cap="flat" cmpd="sng" algn="ctr">${fill(b.line)}<a:prstDash val="solid"/></a:lnB>`,
      fill(bg),
      '</a:tcPr></a:tc>',
    ].join('');
  };
  return [
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>`,
    `<p:xfrm><a:off x="${emu(b.x)}" y="${emu(b.y)}"/><a:ext cx="${colW * cols}" cy="${emu(b.h)}"/></p:xfrm>`,
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>`,
    `<a:tblPr firstRow="1" bandRow="1"${b.rtl ? ' rtl="1"' : ''}/>`,
    `<a:tblGrid>${Array.from({ length: cols }, () => `<a:gridCol w="${colW}"/>`).join('')}</a:tblGrid>`,
    ...b.rows.map((r, ri) => `<a:tr h="${emu(b.rowH)}">${Array.from({ length: cols }, (_, ci) => cell(r[ci] ?? '', ri === 0, ri)).join('')}</a:tr>`),
    '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>',
  ].join('');
}

function shape(ctx: Ctx, b: Box): string {
  if (b.t === 'text') return textShape(ctx, b);
  if (b.t === 'rect') return rectShape(ctx, b);
  if (b.t === 'image') return imageShape(ctx, b);
  return tableShape(ctx, b);
}

const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

// ── the parts ─────────────────────────────────────────────────────────────

const rels = (list: readonly (readonly [string, string, string])[]) =>
  `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('')}</Relationships>`;

const CLR_MAP = 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';

function theme(font: string, name: string): string {
  const scheme = (tag: string, c: string) => `<a:${tag}><a:srgbClr val="${c}"/></a:${tag}>`;
  const fonts = (tag: string) => `<a:${tag}><a:latin typeface="${font}"/><a:ea typeface=""/><a:cs typeface="${font}"/></a:${tag}>`;
  const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = (w: number) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
  return [
    HEAD,
    `<a:theme xmlns:a="${NS_A}" name="${name}"><a:themeElements>`,
    '<a:clrScheme name="Vylo">',
    '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>',
    scheme('dk2', '1B2A41'), scheme('lt2', 'F1F4F8'), scheme('accent1', '4F46E5'), scheme('accent2', 'B07D12'),
    scheme('accent3', 'E63946'), scheme('accent4', '2A9D8F'), scheme('accent5', 'D9480F'), scheme('accent6', '6B7280'),
    scheme('hlink', '4F46E5'), scheme('folHlink', '7C3AED'),
    '</a:clrScheme>',
    `<a:fontScheme name="Vylo">${fonts('majorFont')}${fonts('minorFont')}</a:fontScheme>`,
    '<a:fmtScheme name="Vylo">',
    `<a:fillStyleLst>${solid}${solid}${solid}</a:fillStyleLst>`,
    `<a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst>`,
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>',
    `<a:bgFillStyleLst>${solid}${solid}${solid}</a:bgFillStyleLst>`,
    '</a:fmtScheme>',
    '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>',
  ].join('');
}

function master(): string {
  const style = (tag: string, sz: number) => `<p:${tag}><a:lvl1pPr><a:defRPr sz="${sz}"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:${tag}>`;
  return [
    HEAD,
    `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}</p:spTree></p:cSld>`,
    `<p:clrMap ${CLR_MAP}/>`,
    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>',
    `<p:txStyles>${style('titleStyle', 4400)}${style('bodyStyle', 2800)}${style('otherStyle', 1800)}</p:txStyles>`,
    '</p:sldMaster>',
  ].join('');
}

const LAYOUT = `${HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

function notesMaster(font: string): string {
  return [
    HEAD,
    `<p:notesMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}`,
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr>',
    '<p:spPr><a:xfrm><a:off x="381000" y="685800"/><a:ext cx="6096000" cy="3429000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp>',
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr>',
    '<p:spPr><a:xfrm><a:off x="685800" y="4343400"/><a:ext cx="5486400" cy="4114800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>',
    '<p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>',
    `</p:spTree></p:cSld><p:clrMap ${CLR_MAP}/>`,
    `<p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0"><a:defRPr sz="1400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="${font}"/><a:cs typeface="${font}"/></a:defRPr></a:lvl1pPr></p:notesStyle>`,
    '</p:notesMaster>',
  ].join('');
}

function notesSlide(ctx: Ctx, notes: string, rtl: boolean): string {
  const paras = notes.split(/\n+/).map((t) => t.trim()).filter(Boolean);
  return [
    HEAD,
    `<p:notes ${NS}><p:cSld><p:spTree>${GROUP}`,
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>',
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>',
    '<p:txBody><a:bodyPr/><a:lstStyle/>',
    ...paras.map((t) => `<a:p><a:pPr algn="${rtl ? 'r' : 'l'}" rtl="${rtl ? 1 : 0}"/><a:r><a:rPr lang="${LANG_TAG[ctx.lang]}" altLang="en-US" dirty="0"><a:latin typeface="${ctx.font}"/><a:cs typeface="${ctx.font}"/></a:rPr><a:t>${xmlText(t)}</a:t></a:r></a:p>`),
    '</p:txBody></p:sp>',
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>',
  ].join('');
}

/** A logo from its data: URL, as bytes and the extension its type goes by; `null` for anything else. */
export function imageOf(url: string | undefined): { bytes: Uint8Array; ext: 'png' | 'jpeg' } | null {
  const m = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/.exec(url ?? '');
  if (!m) return null;
  try {
    const bin = atob(m[2].replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, ext: m[1] === 'png' ? 'png' : 'jpeg' };
  } catch {
    return null;
  }
}

/** Every part of the file, by its path in the zip, in the order they are stored. */
export function pptxParts(deck: Deck, now = new Date()): [string, string | Uint8Array][] {
  const font = FONT[deck.lang] ?? FONT.en;
  const rtl = deck.lang !== 'en';
  const logo = imageOf(deck.logo);
  const slides = deck.slides.map((slide, i) => {
    const drawn = layout(slide, logo ? deck : { ...deck, logo: undefined }, i);
    const ctx: Ctx = { lang: deck.lang, font, id: 2, images: [], ratio: deck.logoRatio };
    const body = drawn.boxes.map((b) => shape(ctx, b)).join('');
    const xml = [
      HEAD,
      `<p:sld ${NS}><p:cSld><p:bg><p:bgPr>${fill(drawn.bg)}<a:effectLst/></p:bgPr></p:bg><p:spTree>${GROUP}${body}</p:spTree></p:cSld>`,
      '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>',
    ].join('');
    const notes = slide.notes.trim() ? notesSlide(ctx, slide.notes, rtl) : null;
    return { xml, notes, images: ctx.images.map((x) => x.rid) };
  });

  const n = slides.length;
  const noted = slides.map((s, i) => (s.notes ? i + 1 : 0)).filter(Boolean);
  const types = [
    `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`,
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Default Extension="png" ContentType="image/png"/>',
    '<Default Extension="jpeg" ContentType="image/jpeg"/>',
    `<Override PartName="/ppt/presentation.xml" ContentType="${CT}.presentation.main+xml"/>`,
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT}.slideMaster+xml"/>`,
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${CT}.slideLayout+xml"/>`,
    `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="${CT}.notesMaster+xml"/>`,
    ...slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="${CT}.slide+xml"/>`),
    ...noted.map((k) => `<Override PartName="/ppt/notesSlides/notesSlide${k}.xml" ContentType="${CT}.notesSlide+xml"/>`),
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
    '<Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
    `<Override PartName="/ppt/presProps.xml" ContentType="${CT}.presProps+xml"/>`,
    `<Override PartName="/ppt/viewProps.xml" ContentType="${CT}.viewProps+xml"/>`,
    `<Override PartName="/ppt/tableStyles.xml" ContentType="${CT}.tableStyles+xml"/>`,
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    '</Types>',
  ].join('');

  // rId1 the master, then the slides, then the rest.
  const presRels: [string, string, string][] = [
    ['rId1', `${REL}/slideMaster`, 'slideMasters/slideMaster1.xml'],
    ...slides.map((_, i) => [`rId${i + 2}`, `${REL}/slide`, `slides/slide${i + 1}.xml`] as [string, string, string]),
    [`rId${n + 2}`, `${REL}/notesMaster`, 'notesMasters/notesMaster1.xml'],
    [`rId${n + 3}`, `${REL}/theme`, 'theme/theme1.xml'],
    [`rId${n + 4}`, `${REL}/presProps`, 'presProps.xml'],
    [`rId${n + 5}`, `${REL}/viewProps`, 'viewProps.xml'],
    [`rId${n + 6}`, `${REL}/tableStyles`, 'tableStyles.xml'],
  ];
  const presentation = [
    HEAD,
    `<p:presentation ${NS} saveSubsetFonts="1"${rtl ? ' rtl="1"' : ''}>`,
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>',
    `<p:notesMasterIdLst><p:notesMasterId r:id="rId${n + 2}"/></p:notesMasterIdLst>`,
    `<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst>`,
    `<p:sldSz cx="${W * EMU}" cy="${H * EMU}"/><p:notesSz cx="6858000" cy="9144000"/>`,
    '</p:presentation>',
  ].join('');

  const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const core = [
    HEAD,
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    `<dc:title>${xmlText(deck.title || deck.request)}</dc:title>`,
    deck.meta.presenter.trim() ? `<dc:creator>${xmlText(deck.meta.presenter.trim())}</dc:creator>` : '',
    `<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>`,
    '</cp:coreProperties>',
  ].join('');
  const app = `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Vylo Editor</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>${n}</Slides><Notes>${noted.length}</Notes></Properties>`;

  const parts: [string, string | Uint8Array][] = [
    ['[Content_Types].xml', types],
    ['_rels/.rels', rels([
      ['rId1', `${REL}/officeDocument`, 'ppt/presentation.xml'],
      ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
      ['rId3', `${REL}/extended-properties`, 'docProps/app.xml'],
    ])],
    ['docProps/core.xml', core],
    ['docProps/app.xml', app],
    ['ppt/presentation.xml', presentation],
    ['ppt/_rels/presentation.xml.rels', rels(presRels)],
    ['ppt/presProps.xml', `${HEAD}<p:presentationPr ${NS}/>`],
    ['ppt/viewProps.xml', `${HEAD}<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`],
    ['ppt/tableStyles.xml', `${HEAD}<a:tblStyleLst xmlns:a="${NS_A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`],
    ['ppt/theme/theme1.xml', theme(font, 'Vylo')],
    ['ppt/theme/theme2.xml', theme(font, 'Vylo Notes')],
    ['ppt/slideMasters/slideMaster1.xml', master()],
    ['ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([
      ['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml'],
      ['rId2', `${REL}/theme`, '../theme/theme1.xml'],
    ])],
    ['ppt/slideLayouts/slideLayout1.xml', LAYOUT],
    ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', `${REL}/slideMaster`, '../slideMasters/slideMaster1.xml']])],
    ['ppt/notesMasters/notesMaster1.xml', notesMaster(font)],
    ['ppt/notesMasters/_rels/notesMaster1.xml.rels', rels([['rId1', `${REL}/theme`, '../theme/theme2.xml']])],
  ];
  if (logo) parts.push([`ppt/media/logo.${logo.ext}`, logo.bytes]);
  slides.forEach((s, i) => {
    const k = i + 1;
    parts.push([`ppt/slides/slide${k}.xml`, s.xml]);
    parts.push([`ppt/slides/_rels/slide${k}.xml.rels`, rels([
      ['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml'],
      ...s.images.map((rid) => [rid, `${REL}/image`, `../media/logo.${logo?.ext ?? 'png'}`] as [string, string, string]),
      ...(s.notes ? [[`rId${s.images.length + 2}`, `${REL}/notesSlide`, `../notesSlides/notesSlide${k}.xml`] as [string, string, string]] : []),
    ])]);
    if (s.notes) {
      parts.push([`ppt/notesSlides/notesSlide${k}.xml`, s.notes]);
      parts.push([`ppt/notesSlides/_rels/notesSlide${k}.xml.rels`, rels([
        ['rId1', `${REL}/notesMaster`, '../notesMasters/notesMaster1.xml'],
        ['rId2', `${REL}/slide`, `../slides/slide${k}.xml`],
      ])]);
    }
  });
  return parts;
}

// ── the zip ───────────────────────────────────────────────────────────────

let CRC: Uint32Array | null = null;

/** CRC-32, as zip wants it. The table is built the first time it is needed. */
export function crc32(bytes: Uint8Array): number {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/**
 * A zip of `files`, stored rather than deflated, with a fixed timestamp so
 * the same deck always makes the same bytes. Names are UTF-8 and flagged so.
 */
export function zip(files: readonly [string, string | Uint8Array][]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // 1 January 2024, 00:00, in DOS form: a date every reader accepts.
  const time = 0;
  const date = ((2024 - 1980) << 9) | (1 << 5) | 1;
  for (const [name, data] of files) {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    const nm = enc.encode(name);
    const crc = crc32(bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034B50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, nm.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), nm, bytes);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014B50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, bytes.length, true);
    dir.setUint32(24, bytes.length, true);
    dir.setUint16(28, nm.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nm);
    offset += 30 + nm.length + bytes.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054B50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let at = 0;
  for (const c of all) { out.set(c, at); at += c.length; }
  return out;
}

/** The deck as a `.pptx`, in bytes. */
export function pptxBytes(deck: Deck, now?: Date): Uint8Array {
  return zip(pptxParts(deck, now));
}

/** The same, as base64, which is what `invoke` carries to the Rust side well. */
export function pptxBase64(deck: Deck, now?: Date): string {
  const bytes = pptxBytes(deck, now);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
