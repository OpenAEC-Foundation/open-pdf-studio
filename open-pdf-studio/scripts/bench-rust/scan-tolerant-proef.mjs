// Experiment: a symbol score that tolerates one pixel of displacement.
//
// The current score is intersection over union of ink pixels. On thin line
// work one pixel of displacement halves it, so real symbols score between
// 0.56 and 0.97 and the default threshold of 0.75 cuts through them
// (docs/rust-stappen.md). The tolerant score counts an ink pixel as explained
// when the other image has ink within one pixel:
//   score = (|T and dilate(I)| + |I and dilate(T)|) / (|T| + |I|)
// over the template window. An exact copy still scores 1.
//
// Measured against a known truth (the sheets of scan-waarheid.mjs) on both
// rasters (pdf.js here, PDFium from the worker's OPDS_SCAN_DUMP), and for
// stray matches on real drawings.
//
//   node scripts/bench-rust/scan-tolerant-proef.mjs --worker <exe> --sheets <dir with sheet-*.pdf + truth> [<pdf> <page> ...]

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { binaryImage, cropTemplate, transformTemplate, suppressMatches } from '../../js/search/symbol-matcher.js';

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const args = process.argv.slice(2);
const take = (name) => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1]; };
const workerExe = take('--worker');
const sheets = take('--sheets');
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const fontDir = join(appRoot, 'node_modules/pdfjs-dist/standard_fonts/').split(String.fromCharCode(92)).join('/');
const dump = mkdtempSync(join(tmpdir(), 'opds-tol-'));

const env = { ...process.env, OPDS_SCAN_DUMP: dump, PATH: `${join(appRoot, 'src-tauri', 'binaries', 'win-x64')};${process.env.PATH}` };
const child = spawn(workerExe, ['93', `tol${process.pid}`], { env, stdio: ['pipe', 'pipe', 'inherit'] });
const rl = createInterface({ input: child.stdout });
const waiting = [];
rl.on('line', (line) => { const w = waiting.shift(); if (w) w(JSON.parse(line)); });
const next = () => new Promise((r) => waiting.push(r));
await next();
let id = 0;
const request = async (obj) => { const p = next(); child.stdin.write(`${JSON.stringify({ ...obj, id: ++id })}\n`); return p; };

function dilate({ width, height, pixels }) {
  const out = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!pixels[y * width + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < width && yy < height) out[yy * width + xx] = 1;
    }
  }
  return { width, height, pixels: out };
}

/** matchSymbols with a choice of score; `tolerant` uses the dilated images. */
function match(image, template, { threshold = 0.75, rotations = [0], scales = [1], tolerant = false, least = false, guard = 0 } = {}) {
  const dImage = tolerant ? dilate(image) : null;
  const stride = image.width + 1, integral = new Uint32Array(stride * (image.height + 1));
  for (let y = 0; y < image.height; y++) {
    let row = 0;
    for (let x = 0; x < image.width; x++) { row += image.pixels[y * image.width + x]; integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row; }
  }
  const found = [];
  for (const rotation of new Set(rotations)) for (const scale of new Set(scales)) {
    const t = transformTemplate(template, rotation, scale);
    const dT = tolerant ? dilate(t) : null;
    const foreground = [];
    for (let i = 0; i < t.pixels.length; i++) if (t.pixels[i]) foreground.push(i);
    if (!foreground.length) continue;
    const n = Math.min(16, foreground.length);
    const anchors = Array.from({ length: n }, (_, i) => foreground[Math.floor(i * foreground.length / n)]);
    const offsets = anchors.map((i) => Math.floor(i / t.width) * image.width + i % t.width);
    const src = tolerant ? dImage : image;
    for (let y = 0; y <= image.height - t.height; y++) for (let x = 0; x <= image.width - t.width; x++) {
      const count = integral[(y + t.height) * stride + x + t.width] - integral[y * stride + x + t.width] - integral[(y + t.height) * stride + x] + integral[y * stride + x];
      if (Math.min(count, foreground.length) / Math.max(1, count, foreground.length) < (tolerant ? threshold * 0.8 : threshold)) continue;
      const start = y * image.width + x;
      let hits = 0;
      for (const o of offsets) hits += src.pixels[start + o];
      if (hits < anchors.length * Math.max(0.5, threshold * 0.75)) continue;
      let score;
      if (tolerant) {
        let a = 0, b = 0, both = 0;
        for (let row = 0; row < t.height; row++) for (let col = 0; col < t.width; col++) {
          const k = row * t.width + col, q = start + row * image.width + col;
          a += t.pixels[k] & dImage.pixels[q];
          b += image.pixels[q] & dT.pixels[k];
          both += t.pixels[k] & image.pixels[q];
        }
        score = least ? Math.min(a / foreground.length, b / Math.max(1, count)) : (a + b) / Math.max(1, foreground.length + count);
        // Guard: the exact overlap must still be a fair share of the ink.
        if (guard && both / Math.max(1, foreground.length + count - both) < guard * threshold) continue;
      } else {
        let both = 0, union = 0;
        for (let row = 0; row < t.height; row++) for (let col = 0; col < t.width; col++) {
          const a = t.pixels[row * t.width + col], b = image.pixels[start + row * image.width + col];
          both += a & b; union += a | b;
        }
        score = both / Math.max(1, union);
      }
      if (score >= threshold) found.push({ x, y, width: t.width, height: t.height, score, rotation, scale });
      if (found.length >= 20000) return suppressMatches(found, 1001);
    }
  }
  return suppressMatches(found, 1001);
}

async function rasters(file, pageNumber) {
  const bytes = readFileSync(file);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, verbosity: 0, standardFontDataUrl: fontDir }).promise;
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1, rotation: page.rotate });
  const scale = Math.min(2, 1200 / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale, rotation: page.rotate });
  const w = Math.ceil(vp.width), h = Math.ceil(vp.height);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  await page.render({ canvas, canvasContext: ctx, viewport: vp, annotationMode: 0, background: 'rgb(255,255,255)' }).promise;
  const js = binaryImage(ctx.getImageData(0, 0, w, h));
  const resp = await request({ op: 'symbol_scan', raster: { path: file, page_index: pageNumber - 1, width: w, height: h, rotation: 0, expect_len: statSync(file).size }, crop: [0, 0, 6, 6], search: false });
  if (!resp.ok && !/TEMPLATE/.test(resp.error)) throw new Error(resp.error);
  const rs = { width: w, height: h, pixels: new Uint8Array(readFileSync(join(dump, `p${pageNumber - 1}-${w}x${h}.bin`))) };
  await doc.loadingTask.destroy();
  return { js, rs, scale, rotate: page.rotate };
}

// ── Truth sheets ───────────────────────────────────────────────────────────
if (sheets) {
  const truthAll = JSON.parse(readFileSync(join(sheets, 'truth.json'), 'utf8'));
  console.log('Truth sheets: found / present (stray), all four rotations');
  console.log('sheet | raster | threshold | current | tolerant | tolerant-least | tolerant+guard .5 | tolerant+guard .6 | least+guard .5');
  for (const name of Object.keys(truthAll.sheets)) {
    const t = truthAll.sheets[name];
    const { js, rs } = await rasters(join(sheets, name), 1);
    for (const [label, image] of [['pdf.js', js], ['PDFium', rs]]) {
      const template = cropTemplate(image, t.rect);
      for (const threshold of [0.75, 0.85]) {
        const cell = (tolerant, extra = {}) => {
          const m = match(image, template, { threshold, rotations: [0, 90, 180, 270], tolerant, ...extra });
          const hit = (p) => m.some((q) => Math.abs(q.x + q.width / 2 - p.x) <= 3 && Math.abs(q.y + q.height / 2 - p.y) <= 3);
          const found = t.points.filter(hit).length;
          const stray = m.filter((q) => !t.points.some((p) => Math.abs(q.x + q.width / 2 - p.x) <= 3 && Math.abs(q.y + q.height / 2 - p.y) <= 3)).length;
          return `${found} / ${t.points.length} (${stray})`;
        };
        console.log(`${name} | ${label} | ${threshold} | ${cell(false)} | ${cell(true)} | ${cell(true, { least: true })} | ${cell(true, { guard: 0.5 })} | ${cell(true, { guard: 0.6 })} | ${cell(true, { least: true, guard: 0.5 })}`);
      }
    }
  }
}

// ── Real drawings: how many matches, and how many of them only the tolerant score gives ──
if (args.length) {
  console.log('\nReal pages, template = first window with contrast from the centre: matches at 0.75, one variant');
  console.log('page | raster | current | tolerant | least | guard .5 | guard .6 | least+guard .5 || at .85: tolerant | guard .5 | guard .6');
  for (let i = 0; i < args.length; i += 2) {
    const { js, rs } = await rasters(args[i], Number(args[i + 1]));
    for (const [label, image] of [['pdf.js', js], ['PDFium', rs]]) {
      let rect = null;
      const cx = image.width >> 1, cy = image.height >> 1;
      outer: for (let r = 0; r < 600; r += 48) for (const [x, y] of [[cx + r, cy], [cx - r, cy], [cx, cy + r], [cx, cy - r]]) {
        try { cropTemplate(image, { x, y, width: 48, height: 48 }); rect = { x, y, width: 48, height: 48 }; break outer; } catch { /* next */ }
      }
      if (!rect) { console.log(`${basename(args[i]).slice(0, 30)} | ${label} | no template`); continue; }
      const template = cropTemplate(image, rect);
      const n = (o) => match(image, template, o).length;
      console.log(`${basename(args[i]).slice(0, 30)} p${args[i + 1]} | ${label} | ${n({})} | ${n({ tolerant: true })} | ${n({ tolerant: true, least: true })} | ${n({ tolerant: true, guard: 0.5 })} | ${n({ tolerant: true, guard: 0.6 })} | ${n({ tolerant: true, least: true, guard: 0.5 })} || at .85: ${n({ tolerant: true, threshold: 0.85 })} | ${n({ tolerant: true, threshold: 0.85, guard: 0.5 })} | ${n({ tolerant: true, threshold: 0.85, guard: 0.6 })}`);
    }
  }
}
child.stdin.write('{"op":"shutdown"}\n');
child.stdin.end();
