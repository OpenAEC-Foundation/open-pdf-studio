// Fixtures and checks for the secure-redaction tests (#762).

import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PDFDocument, PDFName, PDFString, StandardFonts, decodePDFRawStream, PDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as mupdf from 'mupdf';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { lexContent, Name } from './lexer.js';
import { mul, apply, segmentInside, normaliseConvex } from './geometry.js';
import { Font as StdFont } from '@pdf-lib/standard-fonts';

const hier = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(hier, '../../..');

export const latin1 = (b) => Buffer.from(b).toString('latin1');

// ── Helvetica (standard 14, no /Widths) metrics ──
const helv = StdFont.load('Helvetica');
const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const glyphName = (ch) => ({ ' ': 'space', "'": 'quotesingle' })[ch] || (/[0-9]/.test(ch) ? DIGITS[ch] : ch);
export const helvWidth = (ch) => helv.getWidthOfGlyph(glyphName(ch)) / 1000;

/** x positions (text space, before Tm) of each glyph start and the end. */
export function advances(str, { fs, tc = 0, tw = 0, th = 1, width = helvWidth }) {
  const xs = [0];
  let x = 0;
  for (const ch of str) {
    x += (width(ch) * fs + tc + (ch === ' ' ? tw : 0)) * th;
    xs.push(x);
  }
  return xs;
}

/** Quad around characters [from, to) of `str` drawn at matrix M (text space → page). */
export function wordQuad(str, word, { fs, tc = 0, tw = 0, th = 1, width = helvWidth, M, inset = 0.4, below = 2.5, above = 0.72 }) {
  const i = str.indexOf(word);
  if (i < 0) throw new Error('word not found: ' + word);
  const xs = advances(str, { fs, tc, tw, th, width });
  const x0 = xs[i] + inset, x1 = xs[i + word.length] - inset - (tc * th > 0 ? tc * th : 0);
  const y0 = -below, y1 = fs * above;
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => apply(M, x, y));
}

export const rectQuad = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function type3Font(ctx) {
  const glyphs = {};
  const procs = {};
  const diffs = [32, PDFName.of('space')];
  procs.space = ctx.register(ctx.stream('300 0 d0'));
  diffs.push(65);
  for (let c = 65; c <= 90; c++) {
    const n = String.fromCharCode(c);
    diffs.push(PDFName.of(n));
    procs[n] = ctx.register(ctx.stream('600 0 0 0 600 700 d1 60 0 480 700 re f'));
    glyphs[n] = 1;
  }
  const widths = [];
  for (let c = 32; c <= 90; c++) widths.push(c === 32 ? 300 : c >= 65 ? 600 : 0);
  const toUni = ctx.register(ctx.stream(
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /T3 def /CMapType 2 def\n'
    + '1 begincodespacerange <00> <FF> endcodespacerange\n'
    + '2 beginbfrange <20> <20> <0020> <41> <5A> <0041> endbfrange\nendcmap CMapName currentdict /CMap defineresource pop end end\n'));
  const cp = ctx.obj({});
  for (const [k, v] of Object.entries(procs)) cp.set(PDFName.of(k), v);
  return ctx.register(ctx.obj({
    Type: 'Font', Subtype: 'Type3', FontMatrix: [0.001, 0, 0, 0.001, 0, 0], FontBBox: [0, 0, 600, 700],
    CharProcs: cp, Encoding: ctx.obj({ Type: 'Encoding', Differences: diffs }), FirstChar: 32, LastChar: 90,
    Widths: widths, Resources: ctx.obj({}), ToUnicode: toUni,
  }));
}
export const type3Width = (ch) => (ch === ' ' ? 0.3 : 0.6);

/**
 * Main fixture: text in several fonts and operators, vectors, images,
 * nested forms (shared with page 2), annotations, a form field, marked
 * content with ActualText and a structure tree with /Alt.
 */
export async function mainFixture() {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const ctx = pdf.context;
  const page = pdf.addPage([612, 792]);
  const page2 = pdf.addPage([612, 792]);
  const helvRef = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' }));
  const ttf = readFileSync(path.join(app, 'node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'));
  const cid = await pdf.embedFont(ttf, { subset: false });
  const t3 = type3Font(ctx);
  // Images.
  const W = 32, H = 32;
  const rgbData = new Uint8Array(W * H * 3);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = (j * W + i) * 3; rgbData[k] = 200; rgbData[k + 1] = i * 4; rgbData[k + 2] = 60 + j * 4; }
  const smask = new Uint8Array(W * H).fill(255);
  const sm = ctx.register(ctx.flateStream(smask, { Type: 'XObject', Subtype: 'Image', Width: W, Height: H, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }));
  const img = ctx.register(ctx.flateStream(rgbData, { Type: 'XObject', Subtype: 'Image', Width: W, Height: H, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, SMask: sm }));
  // Nested forms: Fy inside Fx; Fx also on page 2.
  const fy = ctx.register(ctx.flateStream('0.8 0 0 rg BT /F1 12 Tf 0 0 Td (NESTEDLEFT NESTEDSECRET) Tj ET', {
    Type: 'XObject', Subtype: 'Form', BBox: [0, -5, 300, 20], Resources: ctx.obj({ Font: ctx.obj({ F1: helvRef }) }),
  }));
  const fx = ctx.register(ctx.flateStream('0.8 0 0 rg BT /F1 12 Tf 0 0 Td (FORMLEFT FORMSECRET) Tj ET q 1 0 0 1 0 -20 cm /Fy Do Q', {
    Type: 'XObject', Subtype: 'Form', BBox: [0, -30, 300, 20], Resources: ctx.obj({ Font: ctx.obj({ F1: helvRef }), XObject: ctx.obj({ Fy: fy }) }),
  }));
  const cidHex = (s) => cid.encodeText(s).toString();
  const inlineGray = Array.from({ length: 16 * 16 }, (_, k) => (40 + (k % 16) * 10).toString(16).padStart(2, '0')).join('');
  const content = [
    // L1: std14 Helvetica, Tc and Tw.
    'BT 0.8 0 0 rg /F1 12 Tf 0.5 Tc 2 Tw 72 700 Td (LEFTWORD T1SECRET RIGHTWORD) Tj ET',
    // L2: TJ with adjustments.
    'BT 0.8 0 0 rg /F1 12 Tf 72 660 Td [(KEEPA) -250 (T2SECRET) -120 (KEEPB)] TJ ET',
    // L3: Type0 / Identity-H.
    `BT 0.8 0 0 rg /F3 14 Tf 72 620 Td ${cidHex('LEFTCID CIDSECRET RIGHTCID')} Tj ET`,
    // L4: Type3.
    'BT 0.8 0 0 rg /F4 20 Tf 72 580 Td (TLEFT TTHREESECRET TRIGHT) Tj ET',
    // L5: rotated text matrix with horizontal scaling and rise.
    'BT 0.8 0 0 rg /F1 12 Tf 80 Tz 3 Ts 0.866025 0.5 -0.5 0.866025 300 430 Tm (ROTLEFT ROTSECRET ROTRIGHT) Tj ET',
    // L6: invisible (OCR) text.
    'BT 3 Tr /F1 10 Tf 1 0 0 1 72 400 Tm (OCRLEFT OCRSECRET OCRRIGHT) Tj ET',
    // L7: marked content with ActualText and an MCID used by the structure tree.
    '/Span <</ActualText (ACTUALSECRET) /MCID 0>> BDC BT 0.8 0 0 rg /F1 12 Tf 72 360 Td (SPANSECRET) Tj ET EMC',
    // L8: the ' operator.
    'BT 0.8 0 0 rg /F1 12 Tf 14 TL 72 330 Td (QUOTEKEEP) Tj (QUOTESECRET) \' ET',
    // Vectors.
    'q 1 0 0 RG 2 w 50 200 m 550 200 l S Q',
    'q 0 0 1 rg 200 160 200 30 re f Q',
    'q 0 0.6 0 RG 1.5 w 60 240 m 200 300 380 140 540 240 c S Q',
    'q 0.7 0 0.7 RG 1 w [6 3] 0 d 60 225 m 540 225 l S Q',
    // Image with soft mask; inline gray image.
    'q 128 0 0 128 420 260 cm /Im1 Do Q',
    `q 64 0 0 64 420 180 cm BI /W 16 /H 16 /CS /G /BPC 8 /F /AHx ID ${inlineGray}> EI Q`,
    // Form XObject (nested form inside).
    'q 1 0 0 1 72 520 cm /Fx Do Q',
  ].map((line) => `q ${line} Q`).join('\n');
  page.node.set(PDFName.of('Resources'), ctx.obj({
    Font: ctx.obj({ F1: helvRef, F3: cid.ref, F4: t3 }),
    XObject: ctx.obj({ Im1: img, Fx: fx }),
  }));
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(content)));
  page.node.set(PDFName.of('StructParents'), ctx.obj(0));
  page2.node.set(PDFName.of('Resources'), ctx.obj({ Font: ctx.obj({ F1: helvRef }), XObject: ctx.obj({ Fx: fx }) }));
  page2.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream('q 1 0 0 1 72 520 cm /Fx Do Q\nBT /F1 12 Tf 72 700 Td (PAGETWO) Tj ET')));
  // Structure tree: an element with /Alt around MCID 0.
  const se = ctx.register(ctx.obj({ Type: 'StructElem', S: 'Span', Pg: page.ref, K: 0, Alt: PDFString.of('STRUCTALTSECRET'), ActualText: PDFString.of('STRUCTACTUALSECRET') }));
  const root = ctx.register(ctx.obj({ Type: 'StructTreeRoot', K: [se] }));
  ctx.lookup(se).set(PDFName.of('P'), root);
  pdf.catalog.set(PDFName.of('StructTreeRoot'), root);
  pdf.catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }));
  // Annotations: in the annotation area (450..560 × 600..700) and one outside.
  const note = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [460, 660, 480, 680], Contents: PDFString.of('ANNOTSECRET') }));
  const popup = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [300, 740, 450, 790], Parent: note }));
  ctx.lookup(note).set(PDFName.of('Popup'), popup);
  const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [470, 610, 540, 630], A: ctx.obj({ S: 'URI', URI: PDFString.of('LINKSECRET-target') }) }));
  const keep = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FreeText', Rect: [60, 740, 200, 770], Contents: PDFString.of('KEEPNOTE'), DA: PDFString.of('/Helv 10 Tf 0 g') }));
  page.node.set(PDFName.of('Annots'), ctx.obj([note, popup, link, keep]));
  const form = pdf.getForm();
  const field = form.createTextField('secretField');
  field.setText('FIELDSECRET');
  field.addToPage(page, { x: 470, y: 635, width: 80, height: 18 });
  const keepField = form.createTextField('keepField');
  keepField.setText('KEEPFIELD');
  keepField.addToPage(page, { x: 60, y: 60, width: 80, height: 18 });
  // An orphan object (unreferenced) with a secret.
  ctx.register(ctx.flateStream('(ORPHANSECRET) Tj'));
  const bytes = await pdf.save({ useObjectStreams: false });
  return { bytes, cidWidth: (ch) => cid.widthOfTextAtSize(ch, 1000) / 1000 };
}

/** The redaction areas used with mainFixture (PDF space quads). */
export function mainMarks({ cidWidth }) {
  const at = (x, y) => [1, 0, 0, 1, x, y];
  const rot = [0.866025, 0.5, -0.5, 0.866025, 300, 430];
  const marks = [
    wordQuad('LEFTWORD T1SECRET RIGHTWORD', 'T1SECRET', { fs: 12, tc: 0.5, tw: 2, M: at(72, 700) }),
    // L2: TJ — position of T2SECRET after (KEEPA) and -250.
    (() => {
      const x0 = 72 + advances('KEEPA', { fs: 12 })[5] + 250 / 1000 * 12;
      const w = advances('T2SECRET', { fs: 12 })[8];
      return rectQuad(x0 + 0.4, 657.5, x0 + w - 0.4, 668.6);
    })(),
    wordQuad('LEFTCID CIDSECRET RIGHTCID', 'CIDSECRET', { fs: 14, width: cidWidth, M: at(72, 620) }),
    wordQuad('TLEFT TTHREESECRET TRIGHT', 'TTHREESECRET', { fs: 20, width: type3Width, M: at(72, 580), below: 1, above: 0.6 }),
    // Rotated: text space includes Tz 80 and Ts 3 (rise), mapped by Tm.
    wordQuad('ROTLEFT ROTSECRET ROTRIGHT', 'ROTSECRET', { fs: 12, th: 0.8, M: mul([1, 0, 0, 1, 0, 3], rot) }),
    wordQuad('OCRLEFT OCRSECRET OCRRIGHT', 'OCRSECRET', { fs: 10, M: at(72, 400) }),
    rectQuad(70, 355, 160, 372), // SPANSECRET
    wordQuad('QUOTESECRET', 'QUOTESECRET', { fs: 12, M: at(72, 316) }),
    // Vectors.
    rectQuad(250, 150, 350, 250),
    // Image (pixels 8..20 × rows 12..24) and inline image (columns 4..8 of 16, rows 4..8).
    rectQuad(452, 292, 500, 340),
    rectQuad(436, 212, 452, 228),
    // Form XObject: FORMSECRET (form at 72,520) and NESTEDSECRET (at 72,500).
    wordQuad('FORMLEFT FORMSECRET', 'FORMSECRET', { fs: 12, M: at(72, 520) }),
    wordQuad('NESTEDLEFT NESTEDSECRET', 'NESTEDSECRET', { fs: 12, M: at(72, 500) }),
    // Annotations.
    rectQuad(450, 600, 560, 700),
  ];
  return marks.map((quad) => ({ pageIndex: 0, quad, fill: [0, 0, 0] }));
}

/** Secrets that must be gone from extracted text. */
export const TEXT_SECRETS = ['T1SECRET', 'T2SECRET', 'CIDSECRET', 'TTHREESECRET', 'ROTSECRET', 'OCRSECRET', 'SPANSECRET', 'QUOTESECRET', 'SECRET'];
/** Secrets that must be gone from every byte of the file (CIDSECRET is glyph ids, checked by extraction). */
export const SECRETS = ['T1SECRET', 'T2SECRET', 'TTHREESECRET', 'ROTSECRET', 'OCRSECRET', 'SPANSECRET', 'ACTUALSECRET',
  'STRUCTALTSECRET', 'STRUCTACTUALSECRET', 'QUOTESECRET', 'ANNOTSECRET', 'LINKSECRET', 'FIELDSECRET', 'ORPHANSECRET'];
export const KEPT = ['LEFTWORD', 'RIGHTWORD', 'KEEPA', 'KEEPB', 'LEFTCID', 'RIGHTCID', 'TLEFT', 'TRIGHT', 'ROTLEFT', 'ROTRIGHT',
  'OCRLEFT', 'OCRRIGHT', 'QUOTEKEEP', 'FORMLEFT', 'NESTEDLEFT'];

export async function pdfjsText(bytes) {
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0, isEvalSupported: false }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    pages.push(tc.items.map((i) => i.str).join(' '));
  }
  await (doc.loadingTask || doc).destroy?.();
  return pages;
}

export function mupdfText(bytes) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const out = [];
  for (let p = 0; p < doc.countPages(); p++) out.push(doc.loadPage(p).toStructuredText('preserve-whitespace').asText());
  return out;
}

/** Characters with their origins (mupdf), per page. */
export function mupdfChars(bytes, pageIndex = 0) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const chars = [];
  doc.loadPage(pageIndex).toStructuredText('preserve-whitespace').walk({ onChar(c, origin) { chars.push({ c, x: origin[0], y: origin[1] }); } });
  return chars;
}

/** Origin of each character of `word` (first occurrence as a contiguous run). */
export function wordOrigins(chars, word) {
  for (let i = 0; i + word.length <= chars.length; i++) {
    let ok = true;
    for (let k = 0; k < word.length; k++) if (chars[i + k].c !== word[k]) { ok = false; break; }
    if (ok) return chars.slice(i, i + word.length).map(({ x, y }) => [x, y]);
  }
  return null;
}

export function render(bytes, pageIndex = 0, scale = 2) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const pix = doc.loadPage(pageIndex).toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceRGB, false, true);
  return { w: pix.getWidth(), h: pix.getHeight(), px: pix.getPixels().slice(), n: pix.getNumberOfComponents() };
}

/** Every stream of the file, raw and (when Flate) inflated, plus the whole file. */
export function allByteViews(bytes) {
  const views = [Buffer.from(bytes)];
  const s = latin1(bytes);
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    const data = Buffer.from(bytes.subarray(start, end));
    views.push(data);
    for (const cut of [0, 1, 2]) {
      try { views.push(inflateSync(data.subarray(0, data.length - cut))); break; } catch { /* not flate */ }
    }
  }
  return views;
}

/** Does the secret occur in the file in any form (ASCII, hex, UTF-16BE text string)? */
export function containsSecret(bytes, secret) {
  const hex = Buffer.from(secret, 'latin1').toString('hex');
  const utf16 = Buffer.from(secret, 'utf16le').swap16();
  for (const v of allByteViews(bytes)) {
    const t = v.toString('latin1');
    if (t.includes(secret)) return true;
    if (t.toLowerCase().replace(/\s/g, '').includes(hex)) return true;
    if (v.includes(utf16)) return true;
  }
  return false;
}

export async function contentOf(bytes, pageIndex = 0) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const c = pdf.getPage(pageIndex).node.Contents();
  const refs = c.asArray ? c.asArray() : [c];
  return refs.map((r) => latin1(decodePDFRawStream(pdf.context.lookup(r)).decode())).join('\n');
}

/**
 * Painted path segments (page space) of a content stream: every stroke and
 * fill edge, excluding clipping-only paths and the overlay block.
 */
export function paintedSegments(src) {
  const ops = lexContent(Buffer.from(src, 'latin1'));
  let ctm = [1, 0, 0, 1, 0, 0];
  const st = [];
  let subs = [], cur = null, start = null, skip = 0;
  const segs = [];
  for (const o of ops) {
    const n = o.operands.filter((x) => typeof x === 'number');
    const P = (x, y) => apply(ctm, x, y);
    switch (o.op) {
      case 'BMC': if (o.operands[0] instanceof Name && o.operands[0].v === 'OPSRedact') skip++; else if (skip) skip++; break;
      case 'BDC': if (skip) skip++; break;
      case 'EMC': if (skip) skip--; break;
      case 'q': st.push(ctm); break;
      case 'Q': ctm = st.pop() || ctm; break;
      case 'cm': ctm = mul(n.slice(-6), ctm); break;
      case 'm': cur = start = P(n[0], n[1]); break;
      case 'l': { const p = P(n[0], n[1]); subs.push([cur, p]); cur = p; break; }
      case 'c': { const p = P(n[4], n[5]); subs.push([cur, P(n[0], n[1]), P(n[2], n[3]), p]); cur = p; break; }
      case 'h': if (cur && start) subs.push([cur, start]); cur = start; break;
      case 're': { const [x, y, w, h] = n; const a = P(x, y), b = P(x + w, y), c = P(x + w, y + h), d = P(x, y + h); subs.push([a, b], [b, c], [c, d], [d, a]); cur = a; break; }
      case 'S': case 's': case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*':
        if (!skip) segs.push(...subs);
        subs = []; break;
      case 'n': subs = []; break;
      default: break;
    }
  }
  return segs;
}

/** Does any painted segment pass through the interior of quad (shrunk by `inset`)? */
export function segmentsInside(segs, quad, inset = 0.05) {
  const C = normaliseConvex(quad);
  const cx = C.reduce((s, p) => s + p[0], 0) / C.length, cy = C.reduce((s, p) => s + p[1], 0) / C.length;
  const shr = C.map(([x, y]) => { const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy); return [x - dx / l * inset, y - dy / l * inset]; });
  const hits = [];
  for (const s of segs) {
    const pts = s.length === 2 ? s : bez(s);
    for (let i = 1; i < pts.length; i++) {
      const r = segmentInside(shr, pts[i - 1], pts[i]);
      if (r && r[1] - r[0] > 1e-6) { hits.push(s); break; }
    }
  }
  return hits;
}
function bez([p0, p1, p2, p3]) {
  const out = [p0];
  for (let i = 1; i <= 64; i++) { const t = i / 64, u = 1 - t; out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); }
  return out;
}

/** Bytes of `src` plus an incremental update that replaces object `num`'s stream. */
export function appendIncrementalUpdate(src, num, newContent, rootRef, size) {
  const s = latin1(src);
  const prev = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(s)[1]);
  let tail = '\n';
  const objOffset = src.length + tail.length;
  tail += `${num} 0 obj\n<< /Length ${newContent.length} >>\nstream\n${newContent}\nendstream\nendobj\n`;
  const xref = src.length + tail.length;
  tail += `xref\n0 1\n0000000000 65535 f \n${num} 1\n${String(objOffset).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<< /Size ${size} /Root ${rootRef} /Prev ${prev} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array([...src, ...Buffer.from(tail, 'latin1')]);
}

export { mupdf, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, StandardFonts };
