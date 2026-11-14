// Symbol search and form recognition against a known truth, for the JS path
// (pdf.js raster) and the worker (PDFium raster). The algorithms are identical
// (pdfium-worker/src/raster_scan/tests.rs); the rasters differ by about a
// pixel along edges, so the two paths cannot be compared match by match. What
// counts is that each finds what is really on the page.
//
// Generated with pdf-lib: a drawing sheet with one symbol at known places
// (fractional coordinates, four rotations, between unrelated line work), and
// a paper form with known text fields, check boxes, radio buttons and writing
// lines.
//
//   node scripts/bench-rust/scan-waarheid.mjs --worker <pdfium-worker.exe>
//
// SCORES=1 in the environment also prints, per rotation, the best score of
// every real symbol in both paths.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { binaryImage, cropTemplate, matchSymbols } from '../../js/search/symbol-matcher.js';
import { decodeSymbolAnswer, decodeFormAnswer } from '../../js/pdf/raster-scan-rust.js';
import { rng } from './lib.mjs';

const { detectFormShapes } = await import('../../js/pdf/form-recognition.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const args = process.argv.slice(2);
const workerExe = args[args.indexOf('--worker') + 1];
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const fontDir = join(appRoot, 'node_modules/pdfjs-dist/standard_fonts/').split(String.fromCharCode(92)).join('/');
// --out <dir> keeps the generated PDFs there (to open them in the app).
const dir = args.includes('--out') ? args[args.indexOf('--out') + 1] : mkdtempSync(join(tmpdir(), 'opds-waarheid-'));
const black = rgb(0, 0, 0);

// ── Worker ─────────────────────────────────────────────────────────────────
const env = { ...process.env, PATH: `${join(appRoot, 'src-tauri', 'binaries', 'win-x64')};${process.env.PATH}` };
const child = spawn(workerExe, ['94', `truth${process.pid}`], { env, stdio: ['pipe', 'pipe', 'inherit'] });
const rl = createInterface({ input: child.stdout });
const waiting = [];
rl.on('line', (line) => { const w = waiting.shift(); if (w) w(JSON.parse(line)); });
const next = () => new Promise((r) => waiting.push(r));
await next();
let id = 0;
const request = async (obj) => {
  const p = next();
  child.stdin.write(`${JSON.stringify({ ...obj, id: ++id })}\n`);
  const resp = await p;
  if (!resp.ok) throw new Error(resp.error);
  return resp;
};

async function jsRaster(bytes, cap, rotationOf) {
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(bytes), isEvalSupported: false, disableFontFace: true, verbosity: 0, standardFontDataUrl: fontDir }).promise;
  const page = await doc.getPage(1);
  const rotation = rotationOf(page);
  const base = page.getViewport({ scale: 1, rotation });
  const scale = Math.min(2, cap / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale, rotation });
  const w = Math.ceil(vp.width), h = Math.ceil(vp.height);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  await page.render({ canvas, canvasContext: ctx, viewport: vp, annotationMode: 0, background: 'rgb(255,255,255)' }).promise;
  const image = ctx.getImageData(0, 0, w, h);
  const rotate = page.rotate;
  await doc.loadingTask.destroy();
  return { image, scale, w, h, rotate };
}

// ── Drawing sheet with a symbol ────────────────────────────────────────────
// The symbol in a 36 pt box around (0, 0): a circle, a cross bar and a flag,
// so the four rotations differ.
function drawSymbol(page, cx, cy, rot, lineWidth) {
  const turn = (x, y) => {
    const [a, b] = [[x, y], [-y, x], [-x, -y], [y, -x]][rot / 90];
    return { x: cx + a, y: cy + b };
  };
  page.drawEllipse({ x: cx, y: cy, xScale: 12, yScale: 12, borderColor: black, borderWidth: lineWidth });
  page.drawLine({ start: turn(-16, 0), end: turn(16, 0), thickness: lineWidth, color: black });
  page.drawLine({ start: turn(0, 0), end: turn(0, 16), thickness: lineWidth, color: black });
  page.drawLine({ start: turn(0, 16), end: turn(9, 11), thickness: lineWidth, color: black });
  page.drawLine({ start: turn(9, 11), end: turn(0, 7), thickness: lineWidth, color: black });
}

async function drawingSheet(lineWidth, pageRotate) {
  const pdf = await PDFDocument.create();
  const W = 2384, H = 1684; // A1 landscape
  const page = pdf.addPage([W, H]);
  if (pageRotate) page.setRotation(degrees(pageRotate));
  const r = rng(31);
  // Unrelated line work: walls, a grid, dimension lines.
  for (let i = 0; i < 60; i++) {
    const x = 80 + r() * (W - 160), y = 80 + r() * (H - 160);
    const horizontal = r() < 0.5, len = 100 + r() * 500;
    page.drawLine({ start: { x, y }, end: { x: horizontal ? x + len : x, y: horizontal ? y : y + len }, thickness: 0.35 + r() * 1.2, color: black });
  }
  for (let i = 0; i < 14; i++) page.drawRectangle({ x: 100 + r() * (W - 500), y: 100 + r() * (H - 400), width: 80 + r() * 260, height: 60 + r() * 200, borderColor: black, borderWidth: 0.5 + r() });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 40; i++) page.drawText(`K${100 + i} ${(r() * 9000).toFixed(0)}`, { x: 80 + r() * (W - 300), y: 80 + r() * (H - 160), size: 9 + r() * 6, font, color: black });
  // The symbol on a jittered grid, so copies do not overlap and sit at
  // arbitrary fractions of a pixel.
  const truth = [];
  let n = 0;
  for (let gy = 0; gy < 6; gy++) for (let gx = 0; gx < 10; gx++) {
    const cx = 160 + gx * 215 + r() * 60, cy = 150 + gy * 250 + r() * 60;
    const rot = n === 0 ? 0 : [0, 0, 90, 180, 270][Math.floor(r() * 5)];
    // White patch first: the symbol stands free of the line work.
    page.drawRectangle({ x: cx - 24, y: cy - 24, width: 48, height: 48, color: rgb(1, 1, 1) });
    drawSymbol(page, cx, cy, rot, lineWidth);
    truth.push({ cx, cy, rot });
    n++;
  }
  return { bytes: await pdf.save(), truth, W, H };
}

/** Where a PDF point lands in the raster of a page shown with `rotate`. */
function toRaster(pt, W, H, rotate, scale) {
  const y = H - pt.y;
  const [x2, y2] = rotate === 90 ? [H - y, pt.x] : rotate === 180 ? [W - pt.x, H - y] : rotate === 270 ? [y, W - pt.x] : [pt.x, y];
  return { x: x2 * scale, y: y2 * scale };
}

function recall(matches, truth, wanted, tol = 3) {
  let found = 0;
  const used = new Set();
  for (const t of wanted) {
    const i = matches.findIndex((m, k) => !used.has(k) && Math.abs(m.x + m.width / 2 - t.x) <= tol && Math.abs(m.y + m.height / 2 - t.y) <= tol);
    if (i >= 0) { used.add(i); found++; }
  }
  const stray = matches.filter((m) => !truth.some((t) => Math.abs(m.x + m.width / 2 - t.x) <= tol && Math.abs(m.y + m.height / 2 - t.y) <= tol)).length;
  return { found, stray };
}

const kept = { sheets: {} };
console.log('Symbol search: found / present (stray matches)');
console.log('sheet | threshold | JS, same rotation | worker, same rotation | JS, four rotations | worker, four rotations');
for (const [lineWidth, pageRotate] of [[0.5, 0], [1, 0], [2, 0], [1, 90]]) {
  const sheet = await drawingSheet(lineWidth, pageRotate);
  const file = join(dir, `sheet-${lineWidth}-${pageRotate}.pdf`);
  writeFileSync(file, sheet.bytes);
  const js = await jsRaster(sheet.bytes, 1200, (p) => p.rotate);
  const place = (t) => ({ ...toRaster({ x: t.cx, y: t.cy }, sheet.W, sheet.H, pageRotate, js.scale), rot: (t.rot + 360 - 0) % 360 });
  const truth = sheet.truth.map(place);
  // After a page rotation the symbols are turned with the page; "same
  // rotation" then means the same as the first one, which is the template.
  const same = truth.filter((t) => t.rot === truth[0].rot);
  const half = 20 * js.scale;
  const rect = { x: truth[0].x - half, y: truth[0].y - half, width: 2 * half, height: 2 * half };
  const bin = binaryImage(js.image);
  const template = cropTemplate(bin, rect);
  // With --out: the template rectangle in page-view points (to repeat the
  // search in the app) and, per sheet, the rectangle and the symbol centres in
  // raster pixels (for scan-tolerant-proef.mjs).
  if (args.includes('--out')) {
    if (lineWidth === 1 && !pageRotate) kept.sheetRect = { x: rect.x / js.scale, y: rect.y / js.scale, width: rect.width / js.scale, height: rect.height / js.scale };
    kept.sheets[`sheet-${lineWidth}-${pageRotate}.pdf`] = { rect, points: truth.map((t) => ({ x: t.x, y: t.y, rot: t.rot })) };
    writeFileSync(join(dir, 'truth.json'), JSON.stringify(kept));
  }
  const raster = { path: file, page_index: 0, width: js.w, height: js.h, rotation: 0, expect_len: sheet.bytes.length };
  for (const threshold of [0.75, 0.6]) {
    const all = { rotations: [0, 90, 180, 270], threshold };
    const noPause = { yieldTask: async () => {} };
    const j1 = (await matchSymbols(bin, template, { threshold, ...noPause })).matches;
    const j4 = (await matchSymbols(bin, template, { ...all, ...noPause })).matches;
    const crop = [rect.x, rect.y, rect.width, rect.height];
    const r1 = decodeSymbolAnswer(await request({ op: 'symbol_scan', raster, crop, threshold })).matches;
    const r4 = decodeSymbolAnswer(await request({ op: 'symbol_scan', raster, crop, ...all })).matches;
    if (threshold === 0.6 && process.env.SCORES) {
      const j = (await matchSymbols(bin, template, { rotations: [0, 90, 180, 270], threshold: 0.5, ...noPause })).matches;
      const w = decodeSymbolAnswer(await request({ op: 'symbol_scan', raster, crop, rotations: [0, 90, 180, 270], threshold: 0.5 })).matches;
      const best = (m, t) => Math.max(0, ...m.filter((q) => Math.abs(q.x + q.width / 2 - t.x) <= 3 && Math.abs(q.y + q.height / 2 - t.y) <= 3).map((q) => q.score));
      for (const rot of [0, 90, 180, 270]) {
        const ts = truth.filter((t) => t.rot === rot);
        const fmt = (m) => ts.map((t) => best(m, t).toFixed(2)).sort().join(' ');
        console.log(`   rot ${rot} JS    : ${fmt(j)}`);
        console.log(`   rot ${rot} worker: ${fmt(w)}`);
      }
    }
    const show = (m, wanted) => { const q = recall(m, truth, wanted); return `${q.found} / ${wanted.length} (${q.stray})`; };
    console.log(`line ${lineWidth} pt${pageRotate ? `, /Rotate ${pageRotate}` : ''} | ${threshold} | ${show(j1, same)} | ${show(r1, same)} | ${show(j4, truth)} | ${show(r4, truth)}`);
  }
}

// ── Paper form ─────────────────────────────────────────────────────────────
async function paperForm(lineWidth, pageRotate) {
  const pdf = await PDFDocument.create();
  const W = 595.28, H = 841.89;
  const page = pdf.addPage([W, H]);
  if (pageRotate) page.setRotation(degrees(pageRotate));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const r = rng(5);
  const truth = [];
  page.drawText('Aanvraagformulier', { x: 60, y: 780, size: 18, font, color: black });
  let y = 730;
  for (let i = 0; i < 8; i++) {
    const x = 180 + r() * 3, w = 220 + r() * 120, h = 18 + r() * 4;
    page.drawText(`Veld ${i + 1}:`, { x: 60, y: y + 5, size: 10, font, color: black });
    page.drawRectangle({ x, y, width: w, height: h, borderColor: black, borderWidth: lineWidth });
    truth.push({ type: 'text', x, y, width: w, height: h });
    y -= 34 + r() * 3;
  }
  for (let i = 0; i < 6; i++) {
    const x = 62 + r() * 2 + (i % 3) * 170, yy = y - Math.floor(i / 3) * 26 + r();
    page.drawRectangle({ x, y: yy, width: 11, height: 11, borderColor: black, borderWidth: lineWidth });
    page.drawText(`Keuze ${i + 1}`, { x: x + 18, y: yy + 2, size: 10, font, color: black });
    truth.push({ type: 'checkbox', x, y: yy, width: 11, height: 11 });
  }
  y -= 70;
  for (let i = 0; i < 4; i++) {
    const cx = 68 + r() * 2 + i * 120, cy = y + r();
    page.drawEllipse({ x: cx, y: cy, xScale: 5.5, yScale: 5.5, borderColor: black, borderWidth: lineWidth });
    page.drawText(`Optie ${i + 1}`, { x: cx + 12, y: cy - 3, size: 10, font, color: black });
    truth.push({ type: 'radio', x: cx - 5.5, y: cy - 5.5, width: 11, height: 11 });
  }
  y -= 50;
  for (let i = 0; i < 4; i++) {
    const x = 180 + r() * 2, len = 240 + r() * 60;
    page.drawText(`Toelichting ${i + 1}`, { x: 60, y: y + 2, size: 10, font, color: black });
    page.drawLine({ start: { x, y }, end: { x: x + len, y }, thickness: lineWidth, color: black });
    truth.push({ type: 'text', line: true, x, y, width: len, height: 16 });
    y -= 30 + r() * 2;
  }
  return { bytes: await pdf.save(), truth, W, H };
}

function formRecall(shapes, truth, H) {
  const out = {};
  for (const kind of ['field', 'checkbox', 'radio', 'line']) {
    const wanted = truth.filter((t) => (kind === 'line' ? t.line : kind === 'field' ? t.type === 'text' && !t.line : t.type === kind));
    const found = wanted.filter((t) => {
      // Truth in PDF points, y up; shapes in points of the unrotated page, y down.
      const box = { x: t.x, y: H - t.y - (t.line ? 0 : t.height), width: t.width, height: t.height };
      return shapes.some((s) => s.type === t.type && (t.line ? s.source === 'writing-line' && Math.abs(s.x - box.x) < 3 && Math.abs(s.y + s.height - box.y) < 3 && Math.abs(s.width - box.width) < 4
        : s.source === 'empty-outline' && Math.abs(s.x - box.x) < 3 && Math.abs(s.y - box.y) < 3 && Math.abs(s.width - box.width) < 4 && Math.abs(s.height - box.height) < 4));
    }).length;
    out[kind] = `${found} / ${wanted.length}`;
  }
  return out;
}

console.log('\nForm recognition: found / present');
console.log('form | path | text fields | check boxes | radio buttons | writing lines | shapes in total');
for (const [lineWidth, pageRotate] of [[0.5, 0], [0.75, 0], [1, 0], [1.5, 0], [0.75, 90]]) {
  const form = await paperForm(lineWidth, pageRotate);
  const file = join(dir, `form-${lineWidth}-${pageRotate}.pdf`);
  writeFileSync(file, form.bytes);
  const js = await jsRaster(form.bytes, 1600, () => 0);
  const jsShapes = detectFormShapes(js.image, js.scale);
  const rs = decodeFormAnswer(await request({
    op: 'form_shapes', scale: js.scale,
    raster: { path: file, page_index: 0, width: js.w, height: js.h, rotation: (360 - js.rotate) % 360, expect_len: form.bytes.length },
  }));
  for (const [name, shapes] of [['JS', jsShapes], ['worker', rs]]) {
    const q = formRecall(shapes, form.truth, form.H);
    console.log(`line ${lineWidth} pt${pageRotate ? `, /Rotate ${pageRotate}` : ''} | ${name} | ${q.field} | ${q.checkbox} | ${q.radio} | ${q.line} | ${shapes.length}`);
  }
}
child.stdin.write('{"op":"shutdown"}\n');
child.stdin.end();
