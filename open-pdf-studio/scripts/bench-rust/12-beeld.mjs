// PNG insluiten: JS tegen Rust (crate open-pdf-image), met pariteitscontrole.
//   embedPng van de PDF-bibliotheek tegen embedPngSnel
//
// Bouw eerst de meethulp:
//   cargo +stable-x86_64-pc-windows-msvc build --release -p open-pdf-image --example image_cli
//
// Run (vanuit open-pdf-studio/):
//   node scripts/bench-rust/12-beeld.mjs [pad\naar\image_cli.exe] [--klein]
// (--klein laat de grootste maat weg.)
//
// Draait in node (dezelfde V8 als de WebView). Rust wordt in-proces gemeten
// (image_cli). De oversteek van het Tauri-commando (rauwe body heen,
// ipc::Response terug) is hier een model: vaste latentie per aanroep +
// kopieën van de bytes, met de gemeten geheugenkopiesnelheid. Dat model is te
// gunstig: in de echte app kost de oversteek 23 tot 31 ms per MB (zie
// docs/rust-stappen.md). De kolommen "IPC", "Rust total" en "speedup" zeggen
// dus niets over de app; de tijden van JS en van Rust zelf en de pariteit wel.

import { writeFileSync, readFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync, inflateSync } from 'node:zlib';
import { PDFDocument, PDFName } from 'pdf-lib';
import { median } from './lib.mjs';
import { maakEmbedPng } from '../../js/pdf/embed-png-rust.js';
import { benchPng } from '../../js/pdf/beeld-gevallen.testhulp.mjs';

const IPC_LATENCY_MS = 1.0;
const IPC_COPIES = 3; // per richting: webview-buffer, Rust-Vec, kloon voor spawn_blocking

const args = process.argv.slice(2);
const klein = args.includes('--klein');
const cli = args.find((a) => !a.startsWith('--')) ?? 'C:\\opds-cargo-target-rust3b\\release\\examples\\image_cli.exe';
if (!existsSync(cli)) { console.error(`image_cli not found: ${cli}`); process.exit(2); }
const work = mkdtempSync(join(tmpdir(), 'opds-bench-beeld-'));

function runCli(jobs, repeat) {
  for (const [name, line, bytes] of jobs) {
    writeFileSync(join(work, `${name}.job`), line);
    writeFileSync(join(work, `${name}.bin`), bytes);
  }
  const out = execFileSync(cli, [work, String(repeat)], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const times = new Map(out.trim().split(/\r?\n/).map((l) => { const [n, ns] = l.split(' '); return [n, Number(ns) / 1e6]; }));
  const result = jobs.map(([name]) => ({ name, ms: times.get(name), out: new Uint8Array(readFileSync(join(work, `${name}.out`))) }));
  for (const [name] of jobs) for (const ext of ['job', 'bin', 'out']) rmSync(join(work, `${name}.${ext}`), { force: true });
  return result;
}

const copyMBps = (() => {
  const src = new Uint8Array(32 * 1024 * 1024).fill(7);
  const runs = [];
  for (let r = 0; r < 5; r++) { const t0 = process.hrtime.bigint(); Uint8Array.from(src); runs.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  return 32 / (median(runs) / 1000);
})();
const ipcMs = (inBytes, outBytes) => IPC_LATENCY_MS + ((inBytes + outBytes) * IPC_COPIES) / (copyMBps * 1024 * 1024) * 1000;

async function timeAsync(fn, repeat) {
  const runs = [];
  let value;
  for (let r = 0; r < repeat; r++) {
    const t0 = process.hrtime.bigint();
    value = await fn();
    runs.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return { ms: median(runs), value };
}

const gelijk = (a, b) => a.length === b.length && Buffer.from(a.buffer, a.byteOffset, a.length).equals(Buffer.from(b.buffer, b.byteOffset, b.length));
const mb = (n) => (n / 1024 / 1024).toFixed(1);
const ms = (n) => (n >= 100 ? n.toFixed(0) : n.toFixed(1));
let failures = 0;
const fail = (msg) => { failures++; console.log(`  PARITY FAIL: ${msg}`); };

console.log(`node ${process.version} | ${process.platform} ${process.arch}`);
console.log(`memcpy ~${copyMBps.toFixed(0)} MB/s; IPC model = ${IPC_LATENCY_MS} ms/call + ${IPC_COPIES} copies per direction (too favourable: the real app measured 23-31 ms per MB)\n`);

console.log('PNG -> image XObject (embedPng against the Rust route)\n');
const dictOf = (s) => [...s.dict.entries()].filter(([k]) => k !== PDFName.of('Length')).map(([k, v]) => `${k} ${v}`).join(' ');
const rowsA = [];
const matenA = [[0.03, 200, 160], [0.1, 400, 250], [0.3, 640, 480], [1, 1250, 800], [8, 3200, 2500], ...(klein ? [] : [[35, 7000, 5000]])];
for (const [mp, width, height] of matenA) {
  for (const alfa of [false, true]) {
    const naam = `${mp}MP-${alfa ? 'alpha' : 'opaque'}`;
    const png = benchPng({ width, height, alfa, zlib: (d) => Uint8Array.from(deflateSync(d)) });
    const repeat = mp >= 35 ? 1 : 3;

    // JS: uitpakken (embedPng) en bij het opslaan weer inpakken (embed + inhoud).
    let jsDecode = 0;
    const js = await timeAsync(async () => {
      const doc = await PDFDocument.create();
      const t0 = process.hrtime.bigint();
      const image = await doc.embedPng(png);
      jsDecode = Number(process.hrtime.bigint() - t0) / 1e6;
      const kanalen = { rgb: image.embedder.image.rgbChannel, alpha: image.embedder.image.alphaChannel ?? null };
      await image.embed();
      const stream = doc.context.lookup(image.ref);
      let bytes = stream.getContents().length;
      const m = stream.dict.get(PDFName.of('SMask'));
      const masker = m ? doc.context.lookup(m) : null;
      if (masker) bytes += masker.getContents().length;
      return { kanalen, dict: dictOf(stream), maskerDict: masker ? dictOf(masker) : null, bytes, ref: image.ref.toString() };
    }, repeat);

    const [rust] = runCli([[naam, 'png', png]], repeat === 1 ? 2 : 5);
    // De JS-kant van de Rust-route: antwoord lezen, woordenboeken bouwen.
    const glue = await timeAsync(async () => {
      const doc = await PDFDocument.create();
      const image = await maakEmbedPng({ native: async () => async () => rust.out, minPixels: 1 })(doc, png);
      await image.embed();
      const stream = doc.context.lookup(image.ref);
      const m = stream.dict.get(PDFName.of('SMask'));
      const masker = m ? doc.context.lookup(m) : null;
      return { stream, masker, ref: image.ref.toString() };
    }, 5);

    const r = glue.value;
    if (rust.out[0] !== 1) fail(`${naam}: Rust sent the image back (${new TextDecoder().decode(rust.out.subarray(1))})`);
    else {
      if (dictOf(r.stream) !== js.value.dict || (r.masker ? dictOf(r.masker) : null) !== js.value.maskerDict || r.ref !== js.value.ref) fail(`${naam}: dictionaries differ`);
      if (!gelijk(Uint8Array.from(inflateSync(r.stream.getContents())), js.value.kanalen.rgb)) fail(`${naam}: RGB differs`);
      if (!!r.masker !== !!js.value.kanalen.alpha) fail(`${naam}: alpha stream presence differs`);
      else if (r.masker && !gelijk(Uint8Array.from(inflateSync(r.masker.getContents())), js.value.kanalen.alpha)) fail(`${naam}: alpha differs`);
    }
    const ipc = ipcMs(png.length, rust.out.length);
    rowsA.push({ naam, px: `${width}x${height}`, png: png.length, js: js.ms, jsDecode, rust: rust.ms, ipc, glue: glue.ms, totaal: rust.ms + ipc + glue.ms, jsBytes: js.value.bytes, rustBytes: rust.out.length - 20 });
  }
}
console.log(`${'case'.padEnd(14)} | ${'pixels'.padEnd(9)} | ${'PNG MB'.padStart(6)} | ${'JS ms'.padStart(7)} | ${'(decode)'.padStart(8)} | ${'Rust ms'.padStart(7)} | ${'IPC ms'.padStart(6)} | ${'glue ms'.padStart(7)} | ${'Rust total'.padStart(10)} | ${'speedup'.padStart(7)} | ${'streams JS/Rust MB'.padStart(18)}`);
for (const r of rowsA) {
  console.log(`${r.naam.padEnd(14)} | ${r.px.padEnd(9)} | ${mb(r.png).padStart(6)} | ${ms(r.js).padStart(7)} | ${ms(r.jsDecode).padStart(8)} | ${ms(r.rust).padStart(7)} | ${ms(r.ipc).padStart(6)} | ${ms(r.glue).padStart(7)} | ${ms(r.totaal).padStart(10)} | ${(r.js / r.totaal).toFixed(1).padStart(6)}x | ${`${mb(r.jsBytes)} / ${mb(r.rustBytes)}`.padStart(18)}`);
}
console.log(`\nparity: ${rowsA.length} images, dictionaries and decoded RGB/alpha compared, ${failures} failures`);

rmSync(work, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'OK' : 'FAILED'}: ${failures} parity failures`);
process.exit(failures === 0 ? 0 : 1);
