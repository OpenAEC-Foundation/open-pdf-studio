// Profiel van het laden van annotaties met de JS-lader, per stap, op een
// zware markeringsset (annotaties-set.mjs). Zelfde stappen als
// loadExistingAnnotations in js/pdf/loader.js, zonder DOM:
//   1. pdf.js getDocument + getPage + getAnnotations per blad
//   2. pdf-lib PDFDocument.load (het gedeelde pdf-lib-document)
//   3. extractAnnotationColors per blad (de rauwe woordenboeken)
//   4. zetPaginaAnnotatiesOm per blad (omzetten naar het model)
//
// Daarnaast, als het meetprototype gebouwd is (annotaties-rust/Cargo.toml):
//   5. lopdf: bestand laden, alle annotatiewoordenboeken doorlopen (verwijzingen
//      opgevolgd, stromen als woordenboek + lengte) en als JSON coderen;
//   6. JSON.parse van dat resultaat in JS, plus een IPC-model (1 ms per
//      aanroep + 3 kopieën van ~4 GB/s, zoals bij de eerdere stappen).
// Dat is de ondergrens van wat een Rust-route kost: de omzetting en de
// semantiek van extractAnnotationColors blijven daarna nog in JS.
//
// Run vanuit open-pdf-studio/:
//   node --expose-gc --max-old-space-size=8192 scripts/bench-rust/10-annotaties-profiel.mjs [bladen] [perBlad]

import { performance } from 'node:perf_hooks';
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';

const hulp = await import('../../js/pdf/rondgang.testhulp.mjs');
const { maakSet } = await import('./annotaties-set.mjs');
const { extractAnnotationColors } = await import('../../js/pdf/loader/color-extraction.js');
const { zetPaginaAnnotatiesOm } = await import('../../js/pdf/loader/annotaties-omzetten.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const bladen = Number(process.argv[2] || 100);
const perBlad = Number(process.argv[3] || 500);
const tg0 = performance.now();
const { pad, bytes } = await maakSet(hulp, { bladen, perBlad });
console.log(`set: ${pad} (${(bytes.length / 1048576).toFixed(1)} MB), klaar in ${((performance.now() - tg0) / 1000).toFixed(1)} s`);

const heap = () => { globalThis.gc?.(); const m = process.memoryUsage(); return (m.heapUsed + m.arrayBuffers) / 1048576; };

async function run() {
  const h0 = heap();
  const t = {};
  let s = performance.now();
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  t.open = performance.now() - s;
  s = performance.now();
  const paginas = [];
  const ruw = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    paginas.push(p);
    ruw.push(await p.getAnnotations());
  }
  t.getAnnotations = performance.now() - s;
  s = performance.now();
  const lib = await PDFDocument.load(bytes.slice(), { ignoreEncryption: true });
  t.pdflibLoad = performance.now() - s;
  s = performance.now();
  const kaarten = [];
  for (let n = 1; n <= doc.numPages; n++) kaarten.push(await extractAnnotationColors(n, lib));
  t.extractColors = performance.now() - s;
  s = performance.now();
  let aantal = 0;
  const modellen = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const vp = paginas[n - 1].getViewport({ scale: 1 });
    const m = await zetPaginaAnnotatiesOm(ruw[n - 1], n, vp, new Map(), kaarten[n - 1]);
    aantal += m.length;
    modellen.push(m);
  }
  t.convert = performance.now() - s;
  const ruwAantal = ruw.reduce((a, r) => a + r.length, 0);
  t.heapMB = heap() - h0;
  await doc.loadingTask.destroy();
  return { t, aantal, ruwAantal };
}

for (let r = 0; r < 2; r++) {
  const { t, aantal, ruwAantal } = await run();
  const tot = t.open + t.getAnnotations + t.pdflibLoad + t.extractColors + t.convert;
  console.log(`run ${r + 1}: ${ruwAantal} annotaties in het bestand, ${aantal} modellen`);
  for (const [k, v] of Object.entries(t)) console.log(`  ${k.padEnd(16)} ${v.toFixed(0).padStart(7)}${k === 'heapMB' ? ' MB' : ' ms'}`);
  console.log(`  ${'totaal'.padEnd(16)} ${tot.toFixed(0).padStart(7)} ms`);
}

// ── Rust-meetprototype ──────────────────────────────────────────────────────
const doelmap = process.env.CARGO_TARGET_DIR || 'C:/opds-cargo-target-449';
const exe = join(doelmap, 'release', process.platform === 'win32' ? 'opds-annotaties-meting.exe' : 'opds-annotaties-meting');
if (!existsSync(exe)) {
  console.log(`
(geen meetprototype op ${exe}; zie annotaties-rust/Cargo.toml)`);
} else {
  const uit = join(mkdtempSync(join(tmpdir(), 'opds-annot-rs-')), 'records.json');
  for (let r = 0; r < 2; r++) {
    const m = JSON.parse(execFileSync(exe, [pad, uit], { encoding: 'utf8' }).trim());
    // JSON.parse en geheugen in een vers proces: hier lopen de pdf.js- en
    // pdf-lib-resten van de JS-runs nog door het geheugen.
    const meet = `const heap=()=>{gc();const m=process.memoryUsage();return (m.heapUsed+m.arrayBuffers)/1048576};
      const h0=heap();let t=require('fs').readFileSync(process.argv[1],'utf8');const s=performance.now();
      const r=JSON.parse(t);const ms=performance.now()-s;t=null;globalThis.r=r;
      console.log(JSON.stringify({ms,heap:heap()-h0,bladen:r.length}))`;
    const p = JSON.parse(execFileSync(process.execPath, ['--expose-gc', '-e', meet, uit], { encoding: 'utf8' }).trim());
    const parseMs = p.ms, heapMB = p.heap, records = { length: p.bladen };
    const ipcMs = 1 + 3 * (m.json_bytes / 4e9) * 1000;
    console.log(`rust ${r + 1}: ${m.annots} annotaties, ${(m.json_bytes / 1048576).toFixed(1)} MB JSON`);
    console.log(`  ${'lopdf laden'.padEnd(16)} ${m.load_ms.toFixed(0).padStart(7)} ms`);
    console.log(`  ${'doorlopen'.padEnd(16)} ${m.walk_ms.toFixed(0).padStart(7)} ms`);
    console.log(`  ${'JSON coderen'.padEnd(16)} ${m.json_ms.toFixed(0).padStart(7)} ms`);
    console.log(`  ${'IPC (model)'.padEnd(16)} ${ipcMs.toFixed(0).padStart(7)} ms`);
    console.log(`  ${'JSON.parse (JS)'.padEnd(16)} ${parseMs.toFixed(0).padStart(7)} ms`);
    console.log(`  ${'heapMB'.padEnd(16)} ${heapMB.toFixed(0).padStart(7)} MB (${records.length} bladen)`);
    console.log(`  ${'totaal'.padEnd(16)} ${(m.load_ms + m.walk_ms + m.json_ms + ipcMs + parseMs).toFixed(0).padStart(7)} ms`);
  }
}
