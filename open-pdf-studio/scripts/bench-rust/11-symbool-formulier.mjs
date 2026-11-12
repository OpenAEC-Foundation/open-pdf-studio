// Symbol search (js/search/) and form recognition (js/pdf/form-recognition.js):
// the JS path against the PDFium worker (pdfium-worker/src/raster_scan/), end
// to end on real pages.
//
// JS: as the app runs it: pdf.js render of the bounded raster, getImageData,
// then the pixel work with the app modules. Rendering uses @napi-rs/canvas
// instead of the WebView canvas, so the render times are indicative.
// Worker: one JSON line over stdin, one line back (render with PDFium + the
// Rust port); "cold" includes loading the file and parsing the page.
//
//   cargo +<msvc toolchain> build -p pdfium-worker --release
//   node scripts/bench-rust/11-symbool-formulier.mjs --worker <pdfium-worker.exe> <pdf> <page> [<pdf> <page> ...]
//
// Without --worker only the JS path is measured. --pauses also times the JS
// match with the app's own pauses (setTimeout every 16 rows; about 15 ms each
// under node on Windows, about 4 ms in the WebView).

import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { binaryImage, cropTemplate, matchSymbols } from '../../js/search/symbol-matcher.js';
import { decodeSymbolAnswer, decodeFormAnswer } from '../../js/pdf/raster-scan-rust.js';

const { detectFormShapes, overlap } = await import('../../js/pdf/form-recognition.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const args = process.argv.slice(2);
const take = (name) => { const i = args.indexOf(name); if (i < 0) return null; return args.splice(i, 2)[1]; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const workerExe = take('--worker');
const pauses = flag('--pauses');
const now = () => Number(process.hrtime.bigint()) / 1e6;
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const fontDir = join(appRoot, 'node_modules/pdfjs-dist/standard_fonts/').split(String.fromCharCode(92)).join('/');
const ALL = { rotations: [0, 90, 180, 270], scales: [0.8, 1, 1.25] };

function startWorker() {
  const env = { ...process.env, PATH: `${join(appRoot, 'src-tauri', 'binaries', 'win-x64')};${process.env.PATH}` };
  const child = spawn(workerExe, ['96', `bench${process.pid}`], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  const rl = createInterface({ input: child.stdout });
  const waiting = [];
  rl.on('line', (line) => { const w = waiting.shift(); if (w) w(JSON.parse(line)); });
  const next = () => new Promise((r) => waiting.push(r));
  let id = 0;
  return {
    async ready() {
      const msg = await next();
      if (msg.op !== 'ready' || !(msg.caps || []).includes('raster_scan')) throw new Error(`worker without raster_scan: ${JSON.stringify(msg)}`);
    },
    async request(op, obj) {
      const p = next();
      const t = now();
      child.stdin.write(`${JSON.stringify({ ...obj, op, id: ++id })}\n`);
      const resp = await p;
      if (!resp.ok) throw new Error(`${op}: ${resp.error}`);
      return { resp, ms: now() - t };
    },
    trim() { child.stdin.write('{"op":"trim"}\n'); },
    async stop() {
      child.stdin.write('{"op":"shutdown"}\n');
      child.stdin.end();
      await new Promise((r) => child.on('exit', r));
    },
  };
}

async function render(page, cap, rotation) {
  const base = page.getViewport({ scale: 1, rotation });
  const scale = Math.min(2, cap / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale, rotation });
  const w = Math.ceil(vp.width), h = Math.ceil(vp.height);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const t0 = now();
  await page.render({ canvas, canvasContext: ctx, viewport: vp, annotationMode: 0, background: 'rgb(255,255,255)' }).promise;
  const t1 = now();
  const image = ctx.getImageData(0, 0, w, h);
  return { image, scale, w, h, renderMs: t1 - t0, readMs: now() - t1 };
}

/** A template window with enough contrast, searched from the page centre outwards. */
function pickTemplate(bin, size) {
  const cx = bin.width >> 1, cy = bin.height >> 1;
  for (let r = 0; r < Math.max(bin.width, bin.height); r += size) {
    for (const [x, y] of [[cx + r, cy], [cx - r, cy], [cx, cy + r], [cx, cy - r], [cx + r, cy + r], [cx - r, cy - r]]) {
      const rect = { x, y, width: size, height: size };
      try { cropTemplate(bin, rect); return rect; } catch { /* next */ }
    }
  }
  return null;
}

/** JS matches found by the worker too: same variant, at most `tol` px away. */
function pairMatches(js, rs, tol = 2) {
  const used = new Set();
  let paired = 0, worst = 0;
  for (const m of js) {
    const i = rs.findIndex((r, k) => !used.has(k) && r.rotation === m.rotation && r.scale === m.scale && Math.abs(r.x - m.x) <= tol && Math.abs(r.y - m.y) <= tol);
    if (i < 0) continue;
    used.add(i);
    paired++;
    worst = Math.max(worst, Math.abs(rs[i].score - m.score));
  }
  return { paired, worst };
}

function pairShapes(js, rs) {
  const used = new Set();
  let paired = 0;
  for (const s of js) {
    const i = rs.findIndex((r, k) => !used.has(k) && r.type === s.type && r.source === s.source && overlap(r, s) > 0.6);
    if (i < 0) continue;
    used.add(i);
    paired++;
  }
  return paired;
}

const worker = workerExe ? startWorker() : null;
if (worker) await worker.ready();

const rows = [];
for (let i = 0; i < args.length; i += 2) {
  const file = args[i], pageNumber = Number(args[i + 1]);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), isEvalSupported: false, disableFontFace: true, verbosity: 0, standardFontDataUrl: fontDir }).promise;
  const page = await doc.getPage(pageNumber);
  const row = { name: `${basename(file).slice(0, 34)} p${pageNumber}` };
  const expect_len = statSync(file).size;
  const raster = (r, rotation) => ({ path: file, page_index: pageNumber - 1, width: r.w, height: r.h, rotation, expect_len });

  // Warm pdf.js (fonts, page parse) so the first measured render is not also
  // paying for opening the document.
  await render(page, 200, page.rotate);

  // Symbol search: raster capped at 1200 px, in the page's own rotation.
  const s = await render(page, 1200, page.rotate);
  const tb = now();
  const bin = binaryImage(s.image);
  const binMs = now() - tb;
  const rect = pickTemplate(bin, 48);
  row.sym = { raster: `${s.w}x${s.h}`, render: s.renderMs, read: s.readMs, bin: binMs };
  if (rect) {
    const template = cropTemplate(bin, rect);
    const jsMatch = async (opts, withPauses) => {
      const t = now();
      const res = await matchSymbols(bin, template, { ...opts, ...(withPauses ? {} : { yieldTask: async () => {} }) });
      return { ms: now() - t, res };
    };
    row.sym.one = await jsMatch({}, false);
    row.sym.all = await jsMatch(ALL, false);
    if (pauses) {
      row.sym.onePaused = (await jsMatch({}, true)).ms;
      row.sym.allPaused = (await jsMatch(ALL, true)).ms;
    }
    if (worker) {
      const crop = [rect.x, rect.y, rect.width, rect.height];
      worker.trim();
      const cold = await worker.request('symbol_scan', { raster: raster(s, 0), crop });
      const one = await worker.request('symbol_scan', { raster: raster(s, 0), crop });
      const all = await worker.request('symbol_scan', { raster: raster(s, 0), crop, ...ALL });
      const d1 = decodeSymbolAnswer(one.resp), d12 = decodeSymbolAnswer(all.resp);
      row.sym.rust = {
        cold: cold.ms, one: one.ms, all: all.ms, stages: one.resp.ms, stagesAll: all.resp.ms,
        n1: d1.matches.length, n12: d12.matches.length,
        p1: pairMatches(row.sym.one.res.matches, d1.matches), p12: pairMatches(row.sym.all.res.matches, d12.matches),
      };
    }
  }

  // Form recognition: raster capped at 1600 px, unrotated.
  const f = await render(page, 1600, 0);
  const td = now();
  const shapes = detectFormShapes(f.image, f.scale);
  row.form = { raster: `${f.w}x${f.h}`, render: f.renderMs, read: f.readMs, detect: now() - td, n: shapes.length };
  if (worker) {
    const req = { raster: raster(f, (360 - page.rotate) % 360), scale: f.scale };
    worker.trim();
    const cold = await worker.request('form_shapes', req);
    const warm = await worker.request('form_shapes', req);
    const rs = decodeFormAnswer(warm.resp);
    row.form.rust = { cold: cold.ms, warm: warm.ms, stages: warm.resp.ms, n: rs.length, paired: pairShapes(shapes, rs) };
  }
  rows.push(row);
  await doc.loadingTask.destroy();
}
if (worker) await worker.stop();

const ms = (v) => (v == null ? '-' : v.toFixed(0));
console.log('\nSymbol search, JS (ms)');
console.log(`page | raster | render | getImageData | binary | match 1 variant | match 12 variants${pauses ? ' | 1 with pauses | 12 with pauses' : ''} | total 1 | total 12`);
for (const r of rows) {
  const y = r.sym, base = y.render + y.read + y.bin;
  console.log(`${r.name} | ${y.raster} | ${ms(y.render)} | ${ms(y.read)} | ${ms(y.bin)} | ${ms(y.one?.ms)} | ${ms(y.all?.ms)}${pauses ? ` | ${ms(y.onePaused)} | ${ms(y.allPaused)}` : ''} | ${ms(y.one && base + y.one.ms)} | ${ms(y.all && base + y.all.ms)}`);
}
if (worker) {
  console.log('\nSymbol search, worker (ms; stages as the worker reports them)');
  console.log('page | cold, 1 variant | warm, 1 variant (render / match) | warm, 12 variants (render / match) | matches JS / Rust, 1 variant (paired, max score diff) | 12 variants');
  for (const r of rows) {
    const u = r.sym.rust;
    if (!u) { console.log(`${r.name} | no template`); continue; }
    console.log(`${r.name} | ${ms(u.cold)} | ${ms(u.one)} (${ms(u.stages.render)} / ${ms(u.stages.match)}) | ${ms(u.all)} (${ms(u.stagesAll.render)} / ${ms(u.stagesAll.match)}) | ${r.sym.one.res.matches.length} / ${u.n1} (${u.p1.paired}, ${u.p1.worst.toFixed(3)}) | ${r.sym.all.res.matches.length} / ${u.n12} (${u.p12.paired}, ${u.p12.worst.toFixed(3)})`);
  }
}
console.log('\nForm recognition, JS (ms)');
console.log('page | raster | render | getImageData | detectFormShapes | total | shapes');
for (const r of rows) { const f = r.form; console.log(`${r.name} | ${f.raster} | ${ms(f.render)} | ${ms(f.read)} | ${ms(f.detect)} | ${ms(f.render + f.read + f.detect)} | ${f.n}`); }
if (worker) {
  console.log('\nForm recognition, worker (ms)');
  console.log('page | cold | warm (render / detect) | shapes JS / Rust (paired)');
  for (const r of rows) { const u = r.form.rust; console.log(`${r.name} | ${ms(u.cold)} | ${ms(u.warm)} (${ms(u.stages.render)} / ${ms(u.stages.detect)}) | ${r.form.n} / ${u.n} (${u.paired})`); }
}
