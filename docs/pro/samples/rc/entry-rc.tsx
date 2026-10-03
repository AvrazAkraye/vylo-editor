// R5 content-review harness: contact sheets of a template in the off-screen WKWebView with the app's real faces. Not committed.
import { buildMotion } from '../../src/motiontemplates';
import { META } from '../../src/motionrecipe';
import { paint } from '../../src/motiondraw';
import { stillTime, inDone, outStart, unitsOf } from '../../src/motionanim';
import { safeArea } from '../../src/motiondirection';
import { FORMAT_IDS, LANGUAGES, FORMATS } from '../../src/motiontypes';
import type { Format, Motion, RecipeId } from '../../src/motiontypes';
import type { Lang } from '../../src/i18n';
import { LONG } from './long';

const q = new URLSearchParams(location.search);
const mode = q.get('mode') ?? 'matrix';
const recipe = (q.get('recipe') ?? 'lower-third') as RecipeId;
const palette = q.get('palette') ?? undefined;
const seconds = q.get('seconds') ? Number(q.get('seconds')) : undefined;

async function fonts() {
  await document.fonts.load("700 40px 'Vylo Arabic'", 'بچووک ٠١٢');
  await document.fonts.load("400 40px 'Vylo Arabic'", 'بچووک ٠١٢');
  await document.fonts.ready;
}

/** A stand-in for footage under an overlay: a bright sky over a dark street, with a figure. */
function footage(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#8fbfe8'); g.addColorStop(0.55, '#e4ebf0'); g.addColorStop(0.56, '#3a3d44'); g.addColorStop(1, '#1b1c20');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(120,90,70,.85)';
  const s = Math.min(w, h);
  ctx.beginPath(); ctx.ellipse(w * 0.55, h * 0.36, s * 0.07, s * 0.09, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(40,50,70,.9)';
  ctx.beginPath(); ctx.ellipse(w * 0.55, h * 0.72, s * 0.17, s * 0.25, 0, 0, Math.PI * 2); ctx.fill();
}

function fieldsFor(fill: string | null, lang: Lang): Record<string, string> | undefined {
  if (fill === 'long') {
    const l = LONG[recipe];
    return l ? (lang === 'en' ? l.en : lang === 'ar' ? l.ar : undefined) : undefined;
  }
  if (fill === 'empty') return Object.fromEntries(META[recipe].fields.map((f) => [f.key, '']));
  return undefined;
}

function make(lang: Lang, format: Format, fill: string | null = null): Motion {
  return buildMotion({ id: 'x', recipe, lang, format, now: 1, seconds, palette: palette as never, fields: fieldsFor(fill, lang) });
}

function frame(doc: Motion, t: number, guides = false): HTMLCanvasElement {
  const size = FORMATS[doc.format];
  const c = document.createElement('canvas');
  c.width = size.width; c.height = size.height;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  paint(ctx, doc, t);
  if (doc.backdrop === null) {
    const under = document.createElement('canvas');
    under.width = c.width; under.height = c.height;
    const u = under.getContext('2d') as CanvasRenderingContext2D;
    footage(u, c.width, c.height);
    u.drawImage(c, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(under, 0, 0);
  }
  if (guides) {
    const k = Math.min(size.width, size.height) / 100;
    const a = safeArea(doc.format);
    ctx.save(); ctx.strokeStyle = 'rgba(255,0,80,.9)'; ctx.lineWidth = 2; ctx.setLineDash([12, 8]);
    ctx.strokeRect(a.side * k, a.top * k, size.width - 2 * a.side * k, size.height - a.top * k - a.bottom * k);
    ctx.restore();
  }
  return c;
}

/** When everything has arrived, and when the first exit begins. */
function phases(doc: Motion): { settled: number; leaving: number } {
  let settled = 0;
  let leaving = doc.seconds;
  for (const l of doc.layers) {
    if (l.hidden || l.kind === 'backdrop' || l.kind === 'particles') continue;
    const n = unitsOf(l);
    settled = Math.max(settled, inDone(l, n));
  }
  // The exit that ends the graphic: the first exit that begins after everything has arrived (a wipe that pulls away
  // during the entrance is part of the entrance).
  for (const l of doc.layers) {
    if (l.hidden || l.kind === 'backdrop' || l.kind === 'particles' || !l.out || l.out.fx === 'none') continue;
    const s = outStart(l, unitsOf(l));
    if (s > settled - 0.01) leaving = Math.min(leaving, s);
  }
  return { settled, leaving };
}

/** Ten moments: five through the entrance, the still, four through the exit. */
function moments(doc: Motion): { t: number; tag: string }[] {
  const { settled, leaving } = phases(doc);
  const still = stillTime(doc.layers, doc.seconds);
  const ins = [0.1, 0.25, 0.42, 0.6, 0.8].map((f) => ({ t: settled * f, tag: 'in' }));
  const span = Math.max(0.05, doc.seconds - leaving);
  const outs = [0.15, 0.4, 0.65, 0.9].map((f) => ({ t: leaving + span * f, tag: 'out' }));
  return [...ins, { t: still, tag: 'STILL' }, ...outs];
}

function label(o: CanvasRenderingContext2D, s: string, x: number, y: number) {
  o.save();
  o.font = '600 13px system-ui';
  const w = o.measureText(s).width + 8;
  o.fillStyle = 'rgba(0,0,0,.72)'; o.fillRect(x, y, w, 17);
  o.fillStyle = '#fff'; o.fillText(s, x + 4, y + 13);
  o.restore();
}

function sheetOf(rows: { lang: Lang; fill: string | null; tag: string }[], H: number): string {
  const cells = FORMAT_IDS.map((f) => Math.round((FORMATS[f].width / FORMATS[f].height) * H));
  const gap = 8;
  const out = document.createElement('canvas');
  out.width = cells.reduce((s, w) => s + w + gap, gap);
  out.height = rows.length * (H + gap) + gap;
  const o = out.getContext('2d')!;
  o.fillStyle = '#6b6b6b'; o.fillRect(0, 0, out.width, out.height);
  rows.forEach((r, row) => {
    let x = gap;
    FORMAT_IDS.forEach((format, col) => {
      const doc = make(r.lang, format, r.fill);
      const t = q.get('t') ? Math.min(doc.seconds - 0.01, Number(q.get('t'))) : stillTime(doc.layers, doc.seconds);
      o.drawImage(frame(doc, t), x, gap + row * (H + gap), cells[col], H);
      if (col === 0) label(o, `${r.tag} ${format} t=${t.toFixed(2)}`, x + 2, gap + row * (H + gap) + 2);
      x += cells[col] + gap;
    });
  });
  return out.toDataURL('image/png');
}

async function matrix(): Promise<string> {
  await fonts();
  return sheetOf(LANGUAGES.map((lang) => ({ lang, fill: null, tag: lang })), 300);
}

async function stress(): Promise<string> {
  await fonts();
  return sheetOf([
    { lang: 'en', fill: 'long', tag: 'LONG en' }, { lang: 'ar', fill: 'long', tag: 'LONG ar' },
    { lang: 'en', fill: 'empty', tag: 'EMPTY en' }, { lang: 'ar', fill: 'empty', tag: 'EMPTY ar' },
  ], 300);
}

/** Landscape en/ar: two rows of five each; portrait en/ar side by side: two rows of five each. */
async function motion(): Promise<string> {
  await fonts();
  const gap = 6;
  const LW = 320, LH = 180, PW = 160, PH = 284;
  const width = 5 * (LW + gap) + gap;
  const height = 2 * (2 * (LH + gap)) + gap + 2 * (PH + gap) + gap;
  const out = document.createElement('canvas');
  out.width = Math.max(width, 2 * (5 * (PW + gap) + gap) + gap); out.height = height;
  const o = out.getContext('2d')!;
  o.fillStyle = '#5a5a5a'; o.fillRect(0, 0, out.width, out.height);
  let y = gap;
  for (const lang of ['en', 'ar'] as Lang[]) {
    const doc = make(lang, 'landscape', q.get('fill'));
    moments(doc).forEach((m, i) => {
      const x = gap + (i % 5) * (LW + gap);
      const yy = y + Math.floor(i / 5) * (LH + gap);
      o.drawImage(frame(doc, m.t), x, yy, LW, LH);
      label(o, `${lang} ${m.tag} ${m.t.toFixed(2)}`, x + 2, yy + 2);
    });
    y += 2 * (LH + gap);
  }
  y += gap;
  ['en', 'ar'].forEach((lang, side) => {
    const doc = make(lang as Lang, 'portrait', q.get('fill'));
    const x0 = gap + side * (5 * (PW + gap) + gap);
    moments(doc).forEach((m, i) => {
      const x = x0 + (i % 5) * (PW + gap);
      const yy = y + Math.floor(i / 5) * (PH + gap);
      o.drawImage(frame(doc, m.t), x, yy, PW, PH);
      label(o, `${lang} ${m.tag} ${m.t.toFixed(2)}`, x + 2, yy + 2);
    });
  });
  return out.toDataURL('image/png');
}

/** A dense time-lapse of one shape and language: `n` frames from 0 to the end. */
async function lapse(): Promise<string> {
  await fonts();
  const doc = make((q.get('lang') ?? 'en') as Lang, (q.get('format') ?? 'landscape') as Format, q.get('fill'));
  const n = Number(q.get('n') ?? 20);
  const from = Number(q.get('from') ?? 0);
  const to = Math.min(doc.seconds - 0.01, Number(q.get('to') ?? doc.seconds - 0.01));
  const size = FORMATS[doc.format];
  const W = size.width > size.height ? 300 : 150;
  const H = Math.round(W * size.height / size.width);
  const cols = 5;
  const gap = 6;
  const out = document.createElement('canvas');
  out.width = cols * (W + gap) + gap; out.height = Math.ceil(n / cols) * (H + gap) + gap;
  const o = out.getContext('2d')!;
  o.fillStyle = '#5a5a5a'; o.fillRect(0, 0, out.width, out.height);
  for (let i = 0; i < n; i++) {
    const t = from + (to - from) * (i / Math.max(1, n - 1));
    const x = gap + (i % cols) * (W + gap);
    const y = gap + Math.floor(i / cols) * (H + gap);
    o.drawImage(frame(doc, t), x, y, W, H);
    label(o, t.toFixed(2), x + 2, y + 2);
  }
  return out.toDataURL('image/png');
}

async function one(): Promise<string> {
  await fonts();
  const doc = make((q.get('lang') ?? 'en') as Lang, (q.get('format') ?? 'landscape') as Format, q.get('fill'));
  const t = q.get('t') && q.get('t') !== 'still' ? Math.min(doc.seconds - 0.01, Number(q.get('t'))) : stillTime(doc.layers, doc.seconds);
  const c = frame(doc, t, q.get('guides') === '1');
  const scale = Number(q.get('scale') ?? 0.5);
  const s = document.createElement('canvas');
  s.width = Math.round(c.width * scale); s.height = Math.round(c.height * scale);
  s.getContext('2d')!.drawImage(c, 0, 0, s.width, s.height);
  return s.toDataURL('image/png');
}

/** Each layer's timing, for reading the motion as numbers. */
async function timing(): Promise<string> {
  const doc = make((q.get('lang') ?? 'en') as Lang, (q.get('format') ?? 'landscape') as Format, q.get('fill'));
  const rows = doc.layers.map((l) => {
    const n = unitsOf(l);
    return `${l.id.padEnd(30)} ${l.kind.padEnd(8)} [${l.start.toFixed(2)}-${l.end.toFixed(2)}] in=${l.in ? `${l.in.fx}/${l.in.d}/${l.in.ease}+${l.in.delay}` : '-'} done=${inDone(l, n).toFixed(2)} out=${l.out ? `${l.out.fx}/${l.out.d}/${l.out.ease}` : '-'} from=${outStart(l, n).toFixed(2)} loop=${l.loop ? l.loop.fx : '-'}`;
  });
  return `seconds ${doc.seconds} still ${stillTime(doc.layers, doc.seconds).toFixed(2)}\n${rows.join('\n')}`;
}

(window as unknown as { __done: Promise<string> }).__done = (mode === 'matrix' ? matrix() : mode === 'stress' ? stress() : mode === 'motion' ? motion()
  : mode === 'lapse' ? lapse() : mode === 'timing' ? timing() : one())
  .catch((e) => `ERROR ${e?.stack ?? e}`);
