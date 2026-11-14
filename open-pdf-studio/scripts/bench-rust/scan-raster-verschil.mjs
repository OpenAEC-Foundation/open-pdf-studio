// How far the worker's binary page raster (PDFium) is from the JS one
// (pdf.js), for the rasters of symbol search (1200 px) and form recognition
// (1600 px, unrotated). Diagnostic for docs/rust-stappen.md: the algorithms
// are identical, so every difference in results comes from the raster.
//
// Needs a worker that writes its binary raster when OPDS_SCAN_DUMP names a
// directory (a debug aid in pdfium-worker/src/raster_scan/mod.rs).
//
//   node scripts/bench-rust/scan-raster-verschil.mjs --worker <exe> <pdf> <page> [...]

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { binaryImage } from '../../js/search/symbol-matcher.js';

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const args = process.argv.slice(2);
const wi = args.indexOf('--worker');
const workerExe = args.splice(wi, 2)[1];
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const fontDir = join(appRoot, 'node_modules/pdfjs-dist/standard_fonts/').split(String.fromCharCode(92)).join('/');
const dump = mkdtempSync(join(tmpdir(), 'opds-scan-'));

const env = { ...process.env, OPDS_SCAN_DUMP: dump, PATH: `${join(appRoot, 'src-tauri', 'binaries', 'win-x64')};${process.env.PATH}` };
const child = spawn(workerExe, ['95', `diff${process.pid}`], { env, stdio: ['pipe', 'pipe', 'inherit'] });
const rl = createInterface({ input: child.stdout });
const waiting = [];
rl.on('line', (line) => { const w = waiting.shift(); if (w) w(JSON.parse(line)); });
const next = () => new Promise((r) => waiting.push(r));
await next();
let id = 0;
const request = async (obj) => { const p = next(); child.stdin.write(`${JSON.stringify({ ...obj, id: ++id })}\n`); return p; };

/** Ink of `a` with ink of `b` within `r` pixels, as a share of the ink of `a`. */
function covered(a, b, w, h, r) {
  let ink = 0, hit = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!a[y * w + x]) continue;
    ink++;
    let found = false;
    for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && b[yy * w + xx]) { found = true; break; }
    }
    if (found) hit++;
  }
  return { ink, share: ink ? hit / ink : 1 };
}

console.log('page | raster | ink JS / worker (px) | JS ink also in worker: exact, within 1 px | worker ink also in JS: exact, within 1 px');
for (let i = 0; i < args.length; i += 2) {
  const file = args[i], pageNumber = Number(args[i + 1]);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), isEvalSupported: false, disableFontFace: true, verbosity: 0, standardFontDataUrl: fontDir }).promise;
  const page = await doc.getPage(pageNumber);
  for (const [cap, rotation, extra] of [[1200, page.rotate, 0], [1600, 0, (360 - page.rotate) % 360]]) {
    const base = page.getViewport({ scale: 1, rotation });
    const scale = Math.min(2, cap / Math.max(base.width, base.height));
    const vp = page.getViewport({ scale, rotation });
    const w = Math.ceil(vp.width), h = Math.ceil(vp.height);
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    await page.render({ canvas, canvasContext: ctx, viewport: vp, annotationMode: 0, background: 'rgb(255,255,255)' }).promise;
    const js = binaryImage(ctx.getImageData(0, 0, w, h)).pixels;
    const resp = await request({ op: 'form_shapes', raster: { path: file, page_index: pageNumber - 1, width: w, height: h, rotation: extra, expect_len: statSync(file).size }, scale });
    if (!resp.ok) { console.log(`${basename(file)} p${pageNumber} | ${resp.error}`); continue; }
    const rs = readFileSync(join(dump, `p${pageNumber - 1}-${w}x${h}.bin`));
    const a0 = covered(js, rs, w, h, 0), a1 = covered(js, rs, w, h, 1), b0 = covered(rs, js, w, h, 0), b1 = covered(rs, js, w, h, 1);
    const pct = (v) => `${(v * 100).toFixed(1)}%`;
    console.log(`${basename(file).slice(0, 30)} p${pageNumber} | ${w}x${h} | ${a0.ink} / ${b0.ink} | ${pct(a0.share)}, ${pct(a1.share)} | ${pct(b0.share)}, ${pct(b1.share)}`);
  }
  await doc.loadingTask.destroy();
}
child.stdin.write('{"op":"shutdown"}\n');
child.stdin.end();
