// Generated drawing pairs for the Compare pixel benchmark and the parity check
// between the JS pipeline (pdf.js + js/compare/*) and the PDFium worker.
//
// A pair is an "old" and a "new" revision of the same line drawing (frame,
// title block, walls, many short text-like strokes and a few text labels),
// with known edits on the new side:
//   removed — two walls and a block of strokes are gone,
//   added   — a room (rectangle with a cross) and a label appear,
//   moved   — a 12 x 12 mm detail block sits 8 mm further to the right.
// The `shift` variant also plots the whole new sheet 2.5 mm right, 1.5 mm up
// and 0.2 degrees rotated, so the automatic alignment has work to do.
//
// The edits are returned in millimetres on the new sheet (`truth`) so a
// benchmark can check that every edit is found.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { SHEETS_MM, drawingFor, plotMap, rng } from '../../js/compare/synthetic-sheets.mjs';

const PT = 72 / 25.4;

function detailBlock(x, y) {
  // A 12 x 12 mm square with a cross and a circle-ish octagon: the moved item.
  const s = [];
  const seg = (x1, y1, x2, y2, t = 0.35) => s.push({ x1, y1, x2, y2, t });
  seg(x, y, x + 12, y); seg(x + 12, y, x + 12, y + 12); seg(x + 12, y + 12, x, y + 12); seg(x, y + 12, x, y);
  seg(x, y, x + 12, y + 12); seg(x + 12, y, x, y + 12);
  for (let i = 0; i < 8; i++) {
    const a1 = (i * Math.PI) / 4;
    const a2 = ((i + 1) * Math.PI) / 4;
    seg(x + 6 + 4 * Math.cos(a1), y + 6 + 4 * Math.sin(a1), x + 6 + 4 * Math.cos(a2), y + 6 + 4 * Math.sin(a2), 0.25);
  }
  return s;
}

function room(x, y, w, h) {
  const s = [];
  const seg = (x1, y1, x2, y2, t = 0.5) => s.push({ x1, y1, x2, y2, t });
  seg(x, y, x + w, y); seg(x + w, y, x + w, y + h); seg(x + w, y + h, x, y + h); seg(x, y + h, x, y);
  seg(x, y, x + w, y + h, 0.18); seg(x + w, y, x, y + h, 0.18);
  return s;
}

function labels(sheet, seed, count) {
  const r = rng(seed * 7 + 3);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: 30 + r() * (sheet.width - 120),
      y: 30 + r() * (sheet.height - 90),
      size: 2.5 + r() * 2.5,
      text: `W-${100 + i} ${Math.round(r() * 9000 + 1000)}`,
    });
  }
  return out;
}

async function toPdf(sheet, segs, texts, map = null) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([sheet.width * PT, sheet.height * PT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const H = sheet.height * PT;
  const P = (x, y) => {
    const [mx, my] = map ? map(x, y) : [x, y];
    return { x: mx * PT, y: H - my * PT };
  };
  const black = rgb(0, 0, 0);
  for (const s of segs) {
    page.drawLine({ start: P(s.x1, s.y1), end: P(s.x2, s.y2), thickness: s.t * PT, color: black });
  }
  for (const t of texts) {
    const p = P(t.x, t.y);
    // Text is drawn unrotated even in the shift variant (0.2 degrees), the
    // alignment tolerance absorbs that.
    page.drawText(t.text, { x: p.x, y: p.y, size: t.size * PT, font, color: black });
  }
  return doc.save({ useObjectStreams: false });
}

/**
 * @param {'A3'|'A0'} name
 * @param {{shift?:boolean, seed?:number}} [opts]
 * @returns {Promise<{name:string, sheet:{width:number,height:number}, oldBytes:Uint8Array, newBytes:Uint8Array,
 *   truth:Array<{kind:string, x:number, y:number, width:number, height:number}>, shift:object|null}>}
 */
export async function makePair(name, { shift = false, seed = 5 } = {}) {
  const sheet = SHEETS_MM[name];
  const big = name === 'A0';
  const base = drawingFor(sheet, seed, { strokes: big ? 6000 : 1200 });
  const texts = labels(sheet, seed, big ? 160 : 40);

  // Edits in mm on the sheet.
  const W = sheet.width;
  const H = sheet.height;
  const removedWalls = [base[6], base[9]]; // two walls (indices after frame/title block)
  const blockAt = { x: W * 0.30, y: H * 0.55 };
  const movedBy = 8;
  const roomAt = { x: W * 0.62, y: H * 0.22, w: 30, h: 22 };
  const addedLabel = { x: W * 0.62, y: H * 0.22 + 30, size: 4, text: 'REV B ADDED' };
  // A cluster of strokes in a 25 x 25 mm square disappears.
  const holeAt = { x: W * 0.15, y: H * 0.25, w: 25, h: 25 };
  const inHole = (s) => [s.x1, s.x2].every((x) => x >= holeAt.x && x <= holeAt.x + holeAt.w)
    && [s.y1, s.y2].every((y) => y >= holeAt.y && y <= holeAt.y + holeAt.h);
  const strokesInHole = base.filter((s, i) => i > 30 && inHole(s));
  // Make sure the hole has content.
  const filler = [];
  const r = rng(seed + 99);
  for (let i = 0; i < 18; i++) {
    const x = holeAt.x + 2 + r() * (holeAt.w - 6);
    const y = holeAt.y + 2 + r() * (holeAt.h - 6);
    filler.push({ x1: x, y1: y, x2: x + 2 + r() * 2, y2: y + r() * 2, t: 0.25 });
  }

  const oldSegs = [...base, ...filler, ...detailBlock(blockAt.x, blockAt.y)];
  const newSegs = [
    ...base.filter((s) => !removedWalls.includes(s) && !strokesInHole.includes(s)),
    ...detailBlock(blockAt.x + movedBy, blockAt.y),
    ...room(roomAt.x, roomAt.y, roomAt.w, roomAt.h),
  ];
  const newTexts = [...texts, addedLabel];

  const shiftParams = shift ? { dx: 2.5, dy: -1.5, rotation: 0.2, scale: 1 } : null;
  const map = shift ? plotMap(sheet, sheet, shiftParams) : null;
  const oldBytes = await toPdf(sheet, oldSegs, texts);
  const newBytes = await toPdf(sheet, newSegs, newTexts, map);

  const wallBox = (s) => ({ x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), width: Math.abs(s.x2 - s.x1), height: Math.abs(s.y2 - s.y1) });
  const truth = [
    ...removedWalls.map((s) => ({ kind: 'removed', ...wallBox(s) })),
    { kind: 'removed', x: holeAt.x, y: holeAt.y, width: holeAt.w, height: holeAt.h },
    { kind: 'moved', x: blockAt.x, y: blockAt.y, width: 12 + movedBy, height: 12 },
    { kind: 'added', x: roomAt.x, y: roomAt.y, width: roomAt.w, height: roomAt.h },
    { kind: 'added', x: addedLabel.x, y: addedLabel.y - addedLabel.size, width: 30, height: addedLabel.size * 1.3 },
  ];
  return { name, sheet, oldBytes, newBytes, truth, shift: shiftParams };
}
