// Monochroommodus (#902), rekenwerk per beeld: JS (monochrome-image.js +
// ccitt-g4.js) tegen Rust (crate open-pdf-monochrome), met pariteitscontrole.
//
// Bouwt eerst de meethulp:
//   cargo +stable-x86_64-pc-windows-msvc build --release -p open-pdf-monochrome --example mono_cli
// (CARGO_TARGET_DIR naar keuze; geef het pad naar mono_cli.exe mee als het
// niet in C:\opds-cargo-target-449\release\examples staat.)
//
// Run (vanuit open-pdf-studio/):
//   node scripts/bench-rust/09-monochrome.mjs [pad\naar\mono_cli.exe]
//   node scripts/bench-rust/09-monochrome.mjs --golden   (G4-referentietabel voor lib.rs-tests)
//
// Invoer: scanachtige A4-pagina's op 300 dpi (monochrome.testhulp.mjs), als
// één-bit Flate-bron en als acht-bit zuiver zwart/wit grijs. Pariteit: G4
// byte-gelijk, Flate gelijk na decoderen, zelfde keuze (filter/reden).
//
// Rust wordt hier in-proces gemeten (mono_cli). De IPC-kosten van het
// Tauri-commando (rauwe body heen, ipc::Response terug) zijn een model:
// vaste latentie per aanroep + kopieën van de bytes, met de gemeten
// geheugenkopiesnelheid. Dat model moet in de app nagemeten worden.

import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync, inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { median } from './lib.mjs';
import { optimizeMonochromeImage } from '../../js/pdf/monochrome-image.js';
import { optimizeMonochromeDocument } from '../../js/pdf/monochrome-document.js';
import { encodeCcittG4 } from '../../js/pdf/ccitt-g4.js';
import { parseMonochromeResponse } from '../../js/pdf/monochrome-rust.js';
import { scanBitmap, imageSamples, withoutPadding } from '../../js/pdf/monochrome.testhulp.mjs';

// Aanname voor het IPC-model; na te meten in de app.
const IPC_LATENCY_MS = 1.0;
const IPC_COPIES = 3; // per richting: webview-buffer, Rust-Vec, kloon voor spawn_blocking

const fnv = (bytes) => { let h = 0xcbf29ce484222325n; for (const b of bytes) { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; } return '0x' + h.toString(16).padStart(16, '0'); };

if (process.argv[2] === '--golden') {
  // Zelfde bitmaps als open-pdf-monochrome/src/tests.rs (en ccitt-g4.test.mjs).
  const stride = (w) => Math.ceil(w / 8);
  const bitmap = (w, h, px) => { const o = new Uint8Array(stride(w) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px(x, y)) o[y * stride(w) + (x >> 3)] |= 128 >> (x & 7); return o; };
  const rng = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; };
  const textLike = (w, h, seed) => {
    const r = rng(seed), o = new Uint8Array(stride(w) * h);
    for (let y = 0; y < h; y++) {
      if ((y % 24) > 14) continue;
      let x = Math.floor(r() * 12);
      while (x < w) {
        const black = 1 + Math.floor(r() * 6), white = 1 + Math.floor(r() * (r() < 0.1 ? 60 : 9));
        for (let i = x; i < Math.min(w, x + black); i++) o[y * stride(w) + (i >> 3)] |= 128 >> (i & 7);
        x += black + white;
      }
    }
    return o;
  };
  const noise = (() => { const r = rng(7); const bits = Array.from({ length: 77 * 61 }, () => r() < 0.5); return (x, y) => bits[y * 77 + x]; })();
  const cases = [
    ['all_white', 64, 32, () => 1], ['all_black', 64, 32, () => 0], ['all_white_odd', 13, 7, () => 1], ['all_black_odd', 13, 7, () => 0],
    ['single_pixel', 1, 1, () => 0], ['single_column', 1, 41, (x, y) => y % 3 === 0], ['checkerboard', 64, 64, (x, y) => (x + y) & 1],
    ['checkerboard_odd', 37, 29, (x, y) => (x + y) & 1], ['coarse_checkerboard', 203, 97, (x, y) => ((x >> 3) + (y >> 3)) & 1],
    ['vertical_stripes', 100, 30, (x) => (x % 7) < 3], ['diagonals', 150, 150, (x, y) => ((x - y + 600) % 40) < 6 || ((x + y) % 50) < 2],
    ['shifting_edges', 120, 140, (x, y) => x >= 20 + ((y * 37) % 7) - 3 && x < 90 + ((y * 11) % 7) - 3], ['random_noise', 77, 61, noise],
  ].map(([l, w, h, px]) => [l, w, h, bitmap(w, h, px)]);
  for (const [w, h, seed] of [[1001, 133, 1], [2479, 61, 2], [9, 300, 3], [517, 517, 4]]) cases.push([`text_${w}x${h}_${seed}`, w, h, textLike(w, h, seed)]);
  for (const [label, w, h, s] of cases) for (const b of [false, true]) {
    const e = await encodeCcittG4(s, w, h, { blackIs1: b });
    console.log(`    ("${label}", ${b}, ${e.length}, ${fnv(e)}),`);
  }
  process.exit(0);
}

const cli = process.argv[2] ?? 'C:\\opds-cargo-target-449\\release\\examples\\mono_cli.exe';
const work = join(tmpdir(), `opds-bench-monochrome-${process.pid}`);
mkdirSync(work, { recursive: true });

const noCheckpoint = () => undefined;
async function timeAsync(fn, repeat = 3) {
  const runs = [];
  let value;
  for (let r = 0; r < repeat; r++) {
    const t0 = process.hrtime.bigint();
    value = await fn();
    runs.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return { ms: median(runs), value };
}

function unpack(packed, width, height) {
  const stride = Math.ceil(width / 8), out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if ((packed[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1) out[y * width + x] = 255;
  }
  return out;
}

async function imageStream(width, height, bits, data) {
  const doc = await PDFDocument.create();
  const dict = doc.context.obj({ Type: 'XObject', Subtype: 'Image', Width: width, Height: height, BitsPerComponent: bits, ColorSpace: 'DeviceGray', Filter: 'FlateDecode' });
  return PDFRawStream.of(dict, Uint8Array.from(deflateSync(data)));
}

// Parameters precies zoals monochrome-image.js ze aan de Rust-route geeft.
async function paramsOf(stream) {
  let params = null, input = null;
  await optimizeMonochromeImage(stream, { checkpoint: noCheckpoint, native: async (i, p) => { input = i; params = p; return null; } });
  return { params, input };
}

const jobLine = (p) => ['opt', p.width, p.height, p.bits, p.channels, +p.flateSource, p.decodedSize, p.outputCap,
  +p.ccittFits, +p.blackIs1, +p.decodeOk, p.before, p.flateBase, p.ccittBase].join(' ');

function runCli(jobs, repeat) {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  for (const [name, line, bytes] of jobs) {
    writeFileSync(join(work, `${name}.job`), line);
    writeFileSync(join(work, `${name}.bin`), bytes);
  }
  const out = execFileSync(cli, [work, String(repeat)], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const times = new Map(out.trim().split(/\r?\n/).map((l) => { const [n, ns] = l.split(' '); return [n, Number(ns) / 1e6]; }));
  return jobs.map(([name]) => ({ name, ms: times.get(name), out: new Uint8Array(readFileSync(join(work, `${name}.out`))) }));
}

// Geheugenkopie (MB/s) voor het IPC-model.
const copyMBps = (() => {
  const src = new Uint8Array(32 * 1024 * 1024).fill(7);
  const runs = [];
  for (let r = 0; r < 5; r++) { const t0 = process.hrtime.bigint(); Uint8Array.from(src); runs.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  return 32 / (median(runs) / 1000);
})();
const ipcMs = (inBytes, outBytes) => IPC_LATENCY_MS + ((inBytes + outBytes) * IPC_COPIES) / (copyMBps * 1024 * 1024) * 1000;

console.log(`node ${process.version} | ${process.platform} ${process.arch}`);
console.log(`memcpy ~${copyMBps.toFixed(0)} MB/s; IPC model = ${IPC_LATENCY_MS} ms/call + ${IPC_COPIES} copies per direction\n`);

// ---------------------------------------------------------------- pagina's
const PAGES = 20;
const scans = [];
for (let i = 0; i < PAGES; i++) scans.push(await scanBitmap({ dpi: 300, seed: 100 + i }));
const { width, height } = scans[0];
console.log(`page: ${width}x${height} px (A4, 300 dpi), packed ${(scans[0].samples.length / 1024).toFixed(0)} KB, eight-bit ${(width * height / 1024 / 1024).toFixed(1)} MB\n`);

// ---------------------------------------------------------------- pariteit
let failures = 0;
const fail = (msg) => { failures++; console.log(`  PARITY FAIL: ${msg}`); };

// 1. G4 byte-gelijk op alle pagina's, beide BlackIs1.
{
  const jobs = [];
  for (let i = 0; i < PAGES; i++) for (const b of [0, 1]) jobs.push([`g4-${String(i).padStart(2, '0')}-${b}`, `g4 ${width} ${height} ${b}`, scans[i].samples]);
  const rust = runCli(jobs, 1);
  for (let k = 0; k < jobs.length; k++) {
    const [, , samples] = jobs[k];
    const js = await encodeCcittG4(samples, width, height, { blackIs1: jobs[k][1].endsWith(' 1') });
    if (js.length !== rust[k].out.length || fnv(js) !== fnv(rust[k].out)) fail(`${jobs[k][0]}: G4 differs (${js.length} vs ${rust[k].out.length})`);
  }
  console.log(`parity G4: ${jobs.length} page encodings compared byte for byte, ${failures} failures`);
}

// 2. Hele route per beeld: keuze, grootte, gedecodeerde samples.
const variants = [];
for (let i = 0; i < PAGES; i++) variants.push([`p${String(i).padStart(2, '0')}-1bit`, await imageStream(width, height, 1, scans[i].samples), scans[i].samples]);
for (let i = 0; i < 3; i++) variants.push([`p${String(i).padStart(2, '0')}-8bit`, await imageStream(width, height, 8, unpack(scans[i].samples, width, height)), scans[i].samples]);
const jobs = [];
for (const [name, stream] of variants) {
  const { params, input } = await paramsOf(stream);
  jobs.push([name, jobLine(params), input]);
}
const rust = runCli(jobs, 5);
const rustByInput = new Map();
const singlePage = {};
for (let k = 0; k < variants.length; k++) {
  const [name, stream, samples] = variants[k];
  const answer = parseMonochromeResponse(rust[k].out);
  rustByInput.set(fnv(jobs[k][2]), { answer, ms: rust[k].ms, outBytes: rust[k].out.length });
  const js = await optimizeMonochromeImage(stream, { checkpoint: noCheckpoint });
  const viaRust = await optimizeMonochromeImage(stream, { checkpoint: noCheckpoint, native: async () => answer });
  if (js.filter !== viaRust.filter || js.reason !== viaRust.reason) fail(`${name}: JS ${js.filter ?? js.reason} vs Rust ${viaRust.filter ?? viaRust.reason}`);
  if (js.filter === 'CCITTFaxDecode' && viaRust.filter === 'CCITTFaxDecode' && fnv(js.replacement.getContents()) !== fnv(viaRust.replacement.getContents())) fail(`${name}: CCITT bytes differ`);
  if (viaRust.replacement) {
    const decoded = withoutPadding(imageSamples(viaRust.replacement), width, height);
    if (fnv(decoded) !== fnv(withoutPadding(samples, width, height))) fail(`${name}: Rust samples differ after decoding`);
  }
  if (js.replacement && viaRust.replacement && js.filter === 'FlateDecode' && inflateSync(js.replacement.getContents()).length !== inflateSync(viaRust.replacement.getContents()).length) fail(`${name}: Flate length differs`);
  if (k === 0 || name === 'p00-8bit') singlePage[name.endsWith('8bit') ? '8bit' : '1bit'] = { stream, rust: rust[k], answer, input: jobs[k][2], js, viaRust };
  if (k < 3 || name.endsWith('8bit')) console.log(`  ${name}: JS ${js.filter ?? js.reason} ${js.after ?? '-'} B | Rust ${viaRust.filter ?? viaRust.reason} ${viaRust.after ?? '-'} B (flate ${answer.flateLength ?? '-'} B, G4 ${answer.ccittLength ?? '-'} B)`);
}
console.log(`parity per image: ${variants.length} images, ${failures} failures total\n`);

// ---------------------------------------------------------------- tijden
const rows = [];
const row = (name, ms, note = '') => rows.push({ name, ms, note });
for (const kind of ['1bit', '8bit']) {
  const s = singlePage[kind];
  const jsDefault = await timeAsync(() => optimizeMonochromeImage(s.stream));
  const jsBare = await timeAsync(() => optimizeMonochromeImage(s.stream, { checkpoint: noCheckpoint }));
  const glue = await timeAsync(() => optimizeMonochromeImage(s.stream, { checkpoint: noCheckpoint, native: async () => s.answer }), 5);
  const ipc = ipcMs(s.input.length, s.rust.out.length);
  row(`1 page ${kind}: JS (app checkpoints)`, jsDefault.ms);
  row(`1 page ${kind}: JS (no checkpoints)`, jsBare.ms);
  row(`1 page ${kind}: Rust compute`, s.rust.ms, `in ${(s.input.length / 1024).toFixed(0)} KB, out ${(s.rust.out.length / 1024).toFixed(0)} KB`);
  row(`1 page ${kind}: Rust + JS glue + IPC model`, s.rust.ms + glue.ms + ipc, `glue ${glue.ms.toFixed(1)} ms, IPC ${ipc.toFixed(1)} ms`);
}

// 20 pagina's als één document.
const doc = await PDFDocument.create();
for (let i = 0; i < PAGES; i++) {
  const page = doc.addPage([595, 842]);
  const ref = doc.context.register(variants[i][1]);
  page.node.setXObject(PDFName.of('Im0'), ref);
}
const docBytes = await doc.save({ useObjectStreams: false });
let calls = 0, rustMs = 0, ipcTotal = 0;
const nativeFromCli = async (input) => {
  const hit = rustByInput.get(fnv(input));
  if (!hit) throw new Error('no Rust answer for this image');
  calls++; rustMs += hit.ms; ipcTotal += ipcMs(input.length, hit.outBytes);
  return hit.answer;
};
const jsDoc = await timeAsync(() => optimizeMonochromeDocument(docBytes), 3);
const jsDocBare = await timeAsync(() => optimizeMonochromeDocument(docBytes, { checkpoint: noCheckpoint }), 3);
calls = 0; rustMs = 0; ipcTotal = 0;
const viaDoc = await timeAsync(() => optimizeMonochromeDocument(docBytes, { native: nativeFromCli }), 1);
if (calls !== PAGES) fail(`document: ${calls} native calls for ${PAGES} pages`);
if (viaDoc.value.images.some((im, i) => im.filter !== jsDoc.value.images[i].filter || im.reason !== jsDoc.value.images[i].reason)) fail('document: different filters');
row(`${PAGES} pages doc (${(docBytes.length / 1024 / 1024).toFixed(1)} MB): JS (app checkpoints)`, jsDoc.ms, `-> ${(jsDoc.value.newSize / 1024 / 1024).toFixed(2)} MB`);
row(`${PAGES} pages doc: JS (no checkpoints)`, jsDocBare.ms);
row(`${PAGES} pages doc: Rust + JS glue + IPC model`, viaDoc.ms + rustMs + ipcTotal, `Rust ${rustMs.toFixed(0)} ms, IPC ${ipcTotal.toFixed(0)} ms, glue+pdf-lib ${viaDoc.ms.toFixed(0)} ms -> ${(viaDoc.value.newSize / 1024 / 1024).toFixed(2)} MB`);

const w = Math.max(...rows.map((r) => r.name.length));
console.log(`${'case'.padEnd(w)} | ${'ms'.padStart(9)} | note`);
console.log(`${'-'.repeat(w)}-+-${'-'.repeat(9)}-+-----`);
for (const r of rows) console.log(`${r.name.padEnd(w)} | ${r.ms.toFixed(1).padStart(9)} | ${r.note}`);
console.log(`\nparity failures: ${failures}`);
rmSync(work, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
