#!/usr/bin/env node
// Snap-geometrie: de JavaScript-route (PDF.js-operatorlijst,
// open-pdf-studio/js/tools/pdf-snap-extractor.js) tegenover de Rust-route
// (pdfium-worker, src/snap_geometry.rs), op gemaakte vector-PDF's.
//
// 1. Pariteit: per testgeval moeten punten (met soort) en randen van beide
//    routes binnen 0,01 pt gelijk zijn. Bewuste verschillen (knippaden,
//    weergaven van annotaties) worden apart gecontroleerd: het verschil moet
//    precies dat ene element zijn.
// 2. Benchmark: een zware tekening (standaard 200.000 segmenten), JavaScript
//    tegenover Rust inclusief de overdracht (worker-stdin/stdout + SHM) en
//    het opbouwen van de snap-structuren in JavaScript; piekgeheugen van de
//    node-heap en van het workerproces.
//
// Gebruik, vanuit open-pdf-studio/:
//   cargo +stable-x86_64-pc-windows-msvc build --release -p pdfium-worker
//   node --expose-gc scripts/bench-rust/snap-geometrie.mjs
//     [--worker <pad naar pdfium-worker(.exe)>]  (standaard C:\opds-cargo-target-449\release)
//     [--alleen pariteit|bench] [--segmenten 200000] [--runs 3]
// Exitcode 1 als de pariteit faalt.

import { spawn, execFileSync } from 'node:child_process';
import { createRequire, register } from 'node:module';
import { existsSync, mkdirSync, openSync, readSync, closeSync, writeFileSync, copyFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

const hier = dirname(fileURLToPath(import.meta.url));
const app = resolve(hier, '../..');
const appRequire = createRequire(join(app, 'package.json'));

const argv = process.argv.slice(2);
const optie = (naam, standaard) => {
  const i = argv.indexOf(`--${naam}`);
  return i >= 0 ? argv[i + 1] : standaard;
};
const platformMap = process.platform === 'win32' ? 'win-x64' : process.platform === 'darwin' ? 'macos-universal' : 'linux-x64';
const exeNaam = process.platform === 'win32' ? 'pdfium-worker.exe' : 'pdfium-worker';
const WORKER = optie('worker', join(process.env.CARGO_TARGET_DIR || 'C:\\opds-cargo-target-449', 'release', exeNaam));
const PDFIUM_MAP = join(app, 'src-tauri', 'binaries', platformMap);
const ALLEEN = optie('alleen', null);
const SEGMENTEN = Number(optie('segmenten', 200000));
const RUNS = Number(optie('runs', 3));
const TOL = 0.01;

// ── App-modules onder node ────────────────────────────────────────────────
register(pathToFileURL(join(app, 'js/core/app-test-hooks.mjs')).href, import.meta.url);
const { installeerBrowserStubs } = await import(pathToFileURL(join(app, 'js/core/app-test-hooks.mjs')).href);
installeerBrowserStubs();
const extractor = await import(pathToFileURL(join(app, 'js/tools/pdf-snap-extractor.js')).href);
const { decodeerSnapGeometrie } = await import(pathToFileURL(join(app, 'js/tools/snap-geometrie-binair.js')).href);
const { paginaViewport } = await import(pathToFileURL(join(app, 'js/pdf/pagina-viewport.js')).href);
const { getDocument } = await import(pathToFileURL(appRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);

// ── PDF's maken ─────────────────────────────────────────────────────────────
function stream(dict, data, comprimeer = false) {
  const body = comprimeer ? deflateSync(Buffer.from(data, 'latin1')) : Buffer.from(data, 'latin1');
  return Buffer.concat([
    Buffer.from(`<< ${dict}${comprimeer ? ' /Filter /FlateDecode' : ''} /Length ${body.length} >>\nstream\n`, 'latin1'),
    body,
    Buffer.from('\nendstream', 'latin1'),
  ]);
}

function bouwPdf(objecten) {
  const delen = [Buffer.from('%PDF-1.7\n', 'latin1')];
  let lengte = delen[0].length;
  const offsets = [];
  objecten.forEach((o, i) => {
    offsets.push(lengte);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), Buffer.isBuffer(o) ? o : Buffer.from(o, 'latin1'), Buffer.from('\nendobj\n', 'latin1')]);
    delen.push(b);
    lengte += b.length;
  });
  let xref = `xref\n0 ${objecten.length + 1}\n0000000000 65535 f\r\n`;
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n\r\n`;
  xref += `trailer\n<< /Size ${objecten.length + 1} /Root 1 0 R >>\nstartxref\n${lengte}\n%%EOF\n`;
  delen.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(delen);
}

/**
 * Eén pagina. `formulieren`: [{ naam, matrix?, inhoud }] (objecten 5..);
 * elk formulier ziet alle formulieren in zijn resources. `annots`: ruwe
 * annotatiedicts, met `{AP}` voor een verwijzing naar een eigen weergave.
 */
function pagina({ inhoud, mediabox = [0, 0, 400, 400], paginaExtra = '', formulieren = [], annots = [], comprimeer = false }) {
  const xo = formulieren.map((f, i) => ` /${f.naam} ${5 + i} 0 R`).join('');
  const objecten = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    null,
    stream('', inhoud, comprimeer),
  ];
  for (const f of formulieren) {
    const m = f.matrix ? ` /Matrix [${f.matrix.join(' ')}]` : '';
    objecten.push(stream(`/Type /XObject /Subtype /Form /BBox [-5000 -5000 5000 5000]${m} /Resources << /XObject <<${xo} >> >>`, f.inhoud, comprimeer));
  }
  const annotRefs = [];
  for (const a of annots) {
    const apNr = objecten.length + 1;
    objecten.push(stream(`/Type /XObject /Subtype /Form /BBox [${a.bbox.join(' ')}]`, a.ap));
    objecten.push(a.dict.replace('{AP}', `${apNr} 0 R`));
    annotRefs.push(`${objecten.length} 0 R`);
  }
  const annotsEntry = annotRefs.length ? ` /Annots [${annotRefs.join(' ')}]` : '';
  objecten[2] = `<< /Type /Page /Parent 2 0 R /MediaBox [${mediabox.join(' ')}] /Contents 4 0 R /Resources << /XObject <<${xo} >> >>${annotsEntry} ${paginaExtra} >>`;
  return bouwPdf(objecten);
}

// ── De twee routes ──────────────────────────────────────────────────────────
const werkmap = join(tmpdir(), 'opds-snap-bench');
mkdirSync(werkmap, { recursive: true });

async function viewportVan(pdfDoc, extraRotatie) {
  const page = await pdfDoc.getPage(1);
  const opts = { scale: 1 };
  if (extraRotatie) opts.rotation = (page.rotate + extraRotatie) % 360;
  return { page, transform: Array.from(paginaViewport(page, opts).transform) };
}

async function viaJs(bytes, extraRotatie = 0) {
  const taak = getDocument({ data: new Uint8Array(bytes), verbosity: 0, isEvalSupported: false });
  const pdfDoc = await taak.promise;
  try {
    const t0 = performance.now();
    const { page, transform } = await viewportVan(pdfDoc, extraRotatie);
    const opList = await page.getOperatorList();
    const t1 = performance.now();
    const geo = await extractor.geometrieUitOperatorlijst(opList, transform);
    const t2 = performance.now();
    return { geo, transform, ms: { operatorlijst: t1 - t0, geometrie: t2 - t1, totaal: t2 - t0 }, ops: opList.fnArray.length };
  } finally {
    await taak.destroy();
  }
}

class Worker {
  constructor(slot) {
    this.slot = slot;
    this.ns = 'snapbench';
    this.id = 1;
  }

  async start() {
    if (!existsSync(WORKER)) throw new Error(`worker niet gevonden: ${WORKER} (cargo build --release -p pdfium-worker)`);
    const sep = process.platform === 'win32' ? ';' : ':';
    this.proc = spawn(WORKER, [String(this.slot), this.ns], {
      cwd: PDFIUM_MAP,
      env: { ...process.env, PATH: `${PDFIUM_MAP}${sep}${process.env.PATH}`, LD_LIBRARY_PATH: PDFIUM_MAP },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    this.wachtend = [];
    createInterface({ input: this.proc.stdout }).on('line', (line) => this.wachtend.shift()?.(line));
    const ready = JSON.parse(await new Promise((r) => this.wachtend.push(r)));
    if (!ready.caps?.includes('snap_geometry')) throw new Error(`worker kent snap_geometry niet: ${JSON.stringify(ready)}`);
    this.shm = join(tmpdir(), `pdfium-worker-${this.ns}-${this.slot}.shm`);
    return this;
  }

  vraag(obj) {
    return new Promise((r) => {
      this.wachtend.push((line) => r(JSON.parse(line)));
      this.proc.stdin.write(`${JSON.stringify(obj)}\n`);
    });
  }

  /** Volledige uitwisseling zoals worker_pool/snap.rs: stukken tot het totaal. */
  async snap(path, transform) {
    const t0 = performance.now();
    const stukken = [];
    let offset = 0;
    let totaal = 0;
    let workerMs = 0;
    let leesMs = 0;
    const fd = openSync(this.shm, 'r');
    try {
      do {
        const resp = await this.vraag({ op: 'snap_geometry', id: this.id++, path, page_index: 0, viewport: transform, offset });
        if (!resp.ok) throw new Error(resp.error);
        workerMs += resp.ms;
        totaal = resp.total_bytes;
        const tl = performance.now();
        const buf = Buffer.allocUnsafe(resp.shm_bytes);
        readSync(fd, buf, 0, resp.shm_bytes, 32);
        leesMs += performance.now() - tl;
        stukken.push(buf);
        offset += resp.shm_bytes;
      } while (offset < totaal);
    } finally {
      closeSync(fd);
    }
    const bytes = stukken.length === 1 ? stukken[0] : Buffer.concat(stukken);
    const t1 = performance.now();
    return { bytes, stukken: stukken.length, ms: { worker: workerMs, lezen: leesMs, uitwisseling: t1 - t0 } };
  }

  piekWerkgeheugen() {
    if (process.platform !== 'win32') return null;
    try {
      const uit = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${this.proc.pid}).PeakWorkingSet64`], { encoding: 'utf8' });
      return Number(uit.trim());
    } catch {
      return null;
    }
  }

  async stop() {
    this.proc.stdin.write('{"op":"shutdown"}\n');
    this.proc.stdin.end();
    await new Promise((r) => this.proc.on('exit', r));
  }
}

async function viaRust(worker, pad, transform) {
  const r = await worker.snap(pad, transform);
  const t0 = performance.now();
  const geo = decodeerSnapGeometrie(r.bytes);
  const t1 = performance.now();
  // Zelfde als de app: de index uit de worker, anders hier bouwen.
  const uitWorker = !!geo.index;
  geo.index ??= await extractor.bouwSnapIndex(geo.points, geo.edges);
  const t2 = performance.now();
  return {
    indexUitWorker: uitWorker, geo, bytes: r.bytes.length, stukken: r.stukken, ms: { ...r.ms, decoderen: t1 - t0, index: t2 - t1, totaal: r.ms.uitwisseling + (t2 - t0) } };
}

/** Is de index uit de worker precies wat buildSpatialIndex van dezelfde punten maakt? */
async function indexGelijk(geo) {
  const js = await extractor.bouwSnapIndex(geo.points, geo.edges);
  const lijst = (m) => JSON.stringify([...m.entries()].map(([k, v]) => [k, Array.from(v)]));
  return lijst(js.pointGrid) === lijst(geo.index.pointGrid)
    && lijst(js.edgeGrid) === lijst(geo.index.edgeGrid)
    && JSON.stringify(js.edgeOversized) === JSON.stringify(geo.index.edgeOversized);
}

// ── Vergelijken binnen de tolerantie ─────────────────────────────────────────
function koppel(a, b, coords, sleutel) {
  const cel = (x, y) => `${Math.floor(x)},${Math.floor(y)}`;
  const raster = new Map();
  b.forEach((item, i) => {
    const [x, y] = sleutel(item);
    const k = cel(x, y);
    if (!raster.has(k)) raster.set(k, []);
    raster.get(k).push(i);
  });
  const gebruikt = new Uint8Array(b.length);
  let maxAfwijking = 0;
  const zonderPaar = [];
  for (const item of a) {
    const [x, y] = sleutel(item);
    let gevonden = -1;
    let afw = 0;
    zoek: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of raster.get(cel(x + dx, y + dy)) || []) {
          if (gebruikt[j]) continue;
          const d = coords(item, b[j]);
          if (d !== null && d <= TOL) { gevonden = j; afw = d; break zoek; }
        }
      }
    }
    if (gevonden < 0) zonderPaar.push(item);
    else { gebruikt[gevonden] = 1; maxAfwijking = Math.max(maxAfwijking, afw); }
  }
  const overB = b.filter((_, j) => !gebruikt[j]);
  return { zonderPaar, overB, maxAfwijking };
}

const puntAfstand = (p, q) => (p.type !== q.type ? null : Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y)));
const randAfstand = (e, f) => Math.min(
  Math.max(Math.abs(e.x1 - f.x1), Math.abs(e.y1 - f.y1), Math.abs(e.x2 - f.x2), Math.abs(e.y2 - f.y2)),
  Math.max(Math.abs(e.x1 - f.x2), Math.abs(e.y1 - f.y2), Math.abs(e.x2 - f.x1), Math.abs(e.y2 - f.y1)),
);

// Ontdubbelen gebeurt op een raster van 0,1 px (Math.round(x * 10)). Ligt
// een coördinaat precies op een celgrens (x,x5), dan beslist het laatste bitje
// van het getal in welke cel hij valt: PDF.js leest de getallen uit de inhoud
// anders in float32 dan PDFium, en dan kan in de ene route een punt met een
// buurpunt samenvallen en in de andere niet. Zo'n punt heeft in de andere set
// altijd een punt (de winnaar van het ontdubbelen) binnen één rastercel; dat
// telt als grensgeval, niet als verschil in geometrie.
const CEL = 0.1;
function scheidGrensgevallen(zonderPaar, anderen) {
  const raster = new Map();
  for (const q of anderen) {
    const k = `${Math.floor(q.x)},${Math.floor(q.y)}`;
    if (!raster.has(k)) raster.set(k, []);
    raster.get(k).push(q);
  }
  const echt = [];
  let grens = 0;
  for (const p of zonderPaar) {
    let buur = false;
    for (let dx = -1; dx <= 1 && !buur; dx++) {
      for (let dy = -1; dy <= 1 && !buur; dy++) {
        buur = (raster.get(`${Math.floor(p.x) + dx},${Math.floor(p.y) + dy}`) || [])
          .some((q) => Math.abs(p.x - q.x) <= CEL + TOL && Math.abs(p.y - q.y) <= CEL + TOL);
      }
    }
    if (buur) grens++;
    else echt.push(p);
  }
  return { echt, grens };
}

function vergelijk(js, rust) {
  const p = koppel(js.points, rust.points, puntAfstand, (q) => [q.x, q.y]);
  const e = koppel(js.edges, rust.edges, randAfstand, (r) => [(r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2]);
  const gJs = scheidGrensgevallen(p.zonderPaar, rust.points);
  const gRust = scheidGrensgevallen(p.overB, js.points);
  p.zonderPaar = gJs.echt;
  p.overB = gRust.echt;
  return {
    grensgevallen: gJs.grens + gRust.grens,
    punten: [js.points.length, rust.points.length],
    randen: [js.edges.length, rust.edges.length],
    alleenJs: { punten: p.zonderPaar, randen: e.zonderPaar },
    alleenRust: { punten: p.overB, randen: e.overB },
    maxAfwijking: Math.max(p.maxAfwijking, e.maxAfwijking),
  };
}

// ── Testgevallen ──────────────────────────────────────────────────────────
const kromme = (x, y) => `${x} ${y} m ${x} ${y + 40} ${x + 40} ${y + 40} ${x + 40} ${y} c S`;
const GEVALLEN = [
  { naam: 'lijnen', pdf: pagina({ inhoud: '0 0 m 100 0 l S 10 10 m 390 390 l S 5 300 m 5 300.3 l S 200 200 m 200 200 l S' }) },
  { naam: 'polylijnen', pdf: pagina({ inhoud: '10 10 m 50 10 l 50 60 l 120 60 l 120 5 l S 200 200 m 260 200 l 230 250 l h S 300 10 m 320 10 l 300 10 m 340 40 l S' }) },
  { naam: 'krommen', pdf: pagina({ inhoud: `${kromme(10, 10)} 100 100 m 150 150 200 200 v S 100 300 m 150 350 200 300 y S 250 250 m 260 290 300 300 330 260 c 360 220 380 260 390 300 c h f` }) },
  { naam: 'rechthoeken', pdf: pagina({ inhoud: '10 10 100 50 re f 150 150 -40 30 re S 200 10 50 50 re 260 10 20 20 re B 300 300 0.2 0.2 re f' }) },
  {
    naam: 'formulieren met /Matrix, genest',
    pdf: pagina({
      inhoud: 'q 1 0 0 1 100 50 cm /F1 Do Q q 0.5 0 0 0.5 0 200 cm /F1 Do Q /F3 Do',
      formulieren: [
        { naam: 'F1', matrix: [1, 0, 0, 1, 10, 20], inhoud: '0 0 m 50 0 l 50 30 l S /F2 Do' },
        { naam: 'F2', matrix: [0.7071, 0.7071, -0.7071, 0.7071, 5, 5], inhoud: '0 0 m 40 0 l S 0 0 20 10 re S' },
        { naam: 'F3', matrix: [2, 0, 0, 3, 250, 250], inhoud: `${kromme(0, 0)} q 1 0 0 1 10 0 cm /F2 Do Q` },
      ],
    }),
  },
  { naam: 'CTM: schaal, scheef, genest', pdf: pagina({ inhoud: 'q 2 0 0 0.5 10 10 cm 0 0 m 100 100 l S q 1 0.3 0.2 1 0 0 cm 10 10 40 40 re S Q 5 5 m 30 80 l S Q 0 0 m 400 0 l S' }) },
  ...[90, 180, 270].map((r) => ({ naam: `/Rotate ${r}`, pdf: pagina({ inhoud: '10 10 m 300 20 l 250 380 l S 50 50 100 60 re f', paginaExtra: `/Rotate ${r}` }) })),
  { naam: '/Rotate 90 + gebruikersrotatie 90', extraRotatie: 90, pdf: pagina({ inhoud: '10 10 m 300 20 l 250 380 l S', paginaExtra: '/Rotate 90' }) },
  { naam: 'MediaBox verschoven + /UserUnit 2', pdf: pagina({ inhoud: '110 110 m 450 120 l 300 480 l S', mediabox: [100, 100, 500, 500], paginaExtra: '/UserUnit 2' }) },
  {
    naam: 'knippad (bewust verschil: alleen in JavaScript)',
    knip: [[50, 50, 150, 50], [150, 50, 150, 150], [150, 150, 50, 150], [50, 150, 50, 50]],
    pdf: pagina({ inhoud: 'q 50 50 100 100 re W n 0 0 m 300 300 l S 60 60 m 200 60 l S Q 10 390 m 390 390 l S' }),
    zonderKnip: pagina({ inhoud: 'q 0 0 m 300 300 l S 60 60 m 200 60 l S Q 10 390 m 390 390 l S' }),
  },
  {
    naam: 'annotatie met weergave (bewust verschil: alleen in JavaScript)',
    annotatie: true,
    pdf: pagina({
      inhoud: '0 0 m 100 0 l S',
      annots: [{ dict: '<< /Type /Annot /Subtype /Square /Rect [200 200 300 300] /AP << /N {AP} >> >>', bbox: [0, 0, 100, 100], ap: '5 5 90 90 re S' }],
    }),
    zonderAnnotatie: pagina({ inhoud: '0 0 m 100 0 l S' }),
  },
];

async function pariteit(worker) {
  console.log('\n== Pariteit JavaScript (PDF.js) ↔ Rust (PDFium-worker), tolerantie 0,01 pt ==');
  let fout = 0;
  for (const g of GEVALLEN) {
    const pad = join(werkmap, `${g.naam.replace(/[^a-z0-9]+/gi, '_')}.pdf`);
    writeFileSync(pad, g.pdf);
    const js = await viaJs(g.pdf, g.extraRotatie || 0);
    const rust = await viaRust(worker, pad, js.transform);
    let verschil = vergelijk(js.geo, rust.geo);
    let opmerking = '';
    if (g.knip || g.annotatie) {
      // Het verschil moet precies het weggelaten element zijn: de JavaScript-
      // route op dezelfde tekening zonder dat element is gelijk aan Rust.
      const zonder = await viaJs(g.knip ? g.zonderKnip : g.zonderAnnotatie, g.extraRotatie || 0);
      const extraRanden = verschil.alleenJs.randen.length;
      verschil = vergelijk(zonder.geo, rust.geo);
      opmerking = ` (JavaScript had ${extraRanden} extra rand(en): ${g.knip ? 'de knip-rechthoek' : 'de annotatieweergave, op de verkeerde plek'})`;
      if (g.knip) {
        const rechthoek = vergelijk({ points: [], edges: g.knip.map(([x1, y1, x2, y2]) => ({ x1, y1: 400 - y1, x2, y2: 400 - y2 })) },
          { points: [], edges: (await viaJs(g.pdf)).geo.edges.filter((e) => !rust.geo.edges.some((f) => randAfstand(e, f) <= TOL)) });
        if (rechthoek.alleenJs.randen.length || rechthoek.alleenRust.randen.length) { opmerking += ' -- MAAR het verschil is niet precies de knip-rechthoek'; fout++; }
      }
    }
    const indexOk = rust.indexUitWorker && await indexGelijk(rust.geo);
    if (!indexOk) opmerking += ' -- INDEX UIT DE WORKER WIJKT AF';
    const ok = indexOk && !verschil.alleenJs.punten.length && !verschil.alleenJs.randen.length && !verschil.alleenRust.punten.length && !verschil.alleenRust.randen.length;
    if (!ok) fout++;
    console.log(`${ok ? 'OK  ' : 'FOUT'} ${g.naam.padEnd(58)} punten ${verschil.punten.join('/')} randen ${verschil.randen.join('/')} max afwijking ${verschil.maxAfwijking.toExponential(2)}${verschil.grensgevallen ? `, ${verschil.grensgevallen} grensgeval(len) ontdubbelen` : ''}${opmerking}`);
    if (!ok) {
      console.log('     alleen JavaScript:', JSON.stringify({ p: verschil.alleenJs.punten.slice(0, 5), r: verschil.alleenJs.randen.slice(0, 5) }));
      console.log('     alleen Rust:      ', JSON.stringify({ p: verschil.alleenRust.punten.slice(0, 5), r: verschil.alleenRust.randen.slice(0, 5) }));
    }
  }
  return fout;
}

// ── Zware tekening ────────────────────────────────────────────────────────
function zwareTekening(segmenten) {
  // Deterministisch: dezelfde tekening bij elke run.
  let s = 12345;
  const rnd = () => { // mulberry32
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const W = 2384;
  const H = 1684; // A1 liggend
  const c = (v) => v.toFixed(2);
  const delen = ['0.2 w'];
  let n = 0;
  // Een blok (formulier) dat vaak terugkomt, zoals symbolen in CAD-exports.
  const blok = '0 0 m 10 0 l 10 10 l 0 10 l h S 0 0 m 10 10 l S 0 10 m 10 0 l S'; // 6 segmenten
  while (n < segmenten) {
    const soort = rnd();
    const x = rnd() * (W - 60);
    const y = rnd() * (H - 60);
    if (soort < 0.55) { // polylijn van 4 segmenten
      let p = `${c(x)} ${c(y)} m`;
      for (let k = 0; k < 4; k++) p += ` ${c(x + rnd() * 50)} ${c(y + rnd() * 50)} l`;
      delen.push(`${p} S`);
      n += 4;
    } else if (soort < 0.75) { // losse lijn
      delen.push(`${c(x)} ${c(y)} m ${c(x + rnd() * 40)} ${c(y + rnd() * 40)} l S`);
      n += 1;
    } else if (soort < 0.85) { // rechthoek
      delen.push(`${c(x)} ${c(y)} ${c(5 + rnd() * 30)} ${c(5 + rnd() * 30)} re S`);
      n += 4;
    } else if (soort < 0.93) { // kromme (4 segmenten na afvlakken)
      delen.push(`${c(x)} ${c(y)} m ${c(x + 10)} ${c(y + 30)} ${c(x + 30)} ${c(y + 30)} ${c(x + 40)} ${c(y)} c S`);
      n += 4;
    } else { // blok via formulier met eigen CTM
      delen.push(`q 1 0 0 1 ${c(x)} ${c(y)} cm /B Do Q`);
      n += 6;
    }
  }
  return {
    pdf: pagina({ inhoud: delen.join('\n'), mediabox: [0, 0, W, H], formulieren: [{ naam: 'B', matrix: [1.5, 0, 0, 1.5, 0, 0], inhoud: blok }], comprimeer: true }),
    segmenten: n,
  };
}

function geheugenMeter() {
  const nu = () => { const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; };
  globalThis.gc?.();
  const basis = nu();
  let piek = basis;
  const t = setInterval(() => { piek = Math.max(piek, nu()); }, 5);
  return () => { clearInterval(t); piek = Math.max(piek, nu()); return piek - basis; };
}

const mediaan = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
const mb = (b) => (b == null ? 'n.b.' : `${(b / 1048576).toFixed(1)} MB`);

async function bench() {
  const { pdf, segmenten } = zwareTekening(SEGMENTEN);
  const pad = join(werkmap, `zwaar-${segmenten}.pdf`);
  writeFileSync(pad, pdf);
  console.log(`\n== Benchmark: zware tekening, ${segmenten} segmenten, ${mb(pdf.length)} PDF, ${RUNS} runs (mediaan) ==`);

  const jsRuns = [];
  let jsGeo = null;
  let jsGeheugen = 0;
  for (let i = 0; i < RUNS; i++) {
    const stop = geheugenMeter();
    const r = await viaJs(pdf);
    jsGeheugen = Math.max(jsGeheugen, stop());
    jsRuns.push(r);
    jsGeo = r.geo;
  }
  const transform = jsRuns[0].transform;

  // Koud: elke run een nieuwe kopie (nieuw pad), dus laden + parsen in de
  // worker telt mee. Warm: hetzelfde pad nog eens (document in de cache, de
  // pagina-handle blijft open als het parsen >= 250 ms kostte).
  const worker = await new Worker(91).start();
  const basisWs = worker.piekWerkgeheugen();
  const koud = [];
  const warm = [];
  let rustGeheugen = 0;
  let laatste = null;
  for (let i = 0; i < RUNS; i++) {
    const kopie = join(werkmap, `zwaar-${segmenten}-${i}.pdf`);
    copyFileSync(pad, kopie);
    const stop = geheugenMeter();
    koud.push(await viaRust(worker, kopie, transform));
    rustGeheugen = Math.max(rustGeheugen, stop());
    laatste = await viaRust(worker, kopie, transform);
    warm.push(laatste);
  }
  const piekWs = worker.piekWerkgeheugen();
  await worker.stop();

  const v = vergelijk(jsGeo, laatste.geo);
  const indexOk = laatste.indexUitWorker && await indexGelijk(laatste.geo);
  const gelijk = indexOk && !v.alleenJs.punten.length && !v.alleenJs.randen.length && !v.alleenRust.punten.length && !v.alleenRust.randen.length;

  if (!gelijk) {
    console.log('alleen JavaScript:', v.alleenJs.punten.length, 'punten', v.alleenJs.randen.length, 'randen', JSON.stringify({ p: v.alleenJs.punten.slice(0, 4), r: v.alleenJs.randen.slice(0, 4) }));
    console.log('alleen Rust:      ', v.alleenRust.punten.length, 'punten', v.alleenRust.randen.length, 'randen', JSON.stringify({ p: v.alleenRust.punten.slice(0, 4), r: v.alleenRust.randen.slice(0, 4) }));
  }
  const m = (runs, f) => mediaan(runs.map(f)).toFixed(0).padStart(7);
  console.log(`operatoren in de PDF.js-lijst: ${jsRuns[0].ops}; punten ${jsGeo.points.length}, randen ${jsGeo.edges.length}; pariteit: ${gelijk ? 'gelijk' : 'VERSCHIL'} (max afwijking ${v.maxAfwijking.toExponential(2)}, ${v.grensgevallen} grensgeval(len) ontdubbelen); index uit de worker ${indexOk ? 'gelijk aan buildSpatialIndex' : 'WIJKT AF'}`);
  console.log(`overdracht Rust → JS: ${mb(laatste.bytes)} in ${laatste.stukken} stuk(ken)`);
  console.log('');
  console.log('route                              extractie  overdracht  decoderen   index   totaal (ms)');
  console.log(`JavaScript (operatorlijst + geo)   ${m(jsRuns, (r) => r.ms.operatorlijst)}           -          - ${m(jsRuns, (r) => r.ms.geometrie)}*  ${m(jsRuns, (r) => r.ms.totaal)}`);
  for (const [naam, runs] of [['Rust koud (laden+parsen+extractie)', koud], ['Rust warm (document in de cache)  ', warm]]) {
    console.log(`${naam} ${m(runs, (r) => r.ms.worker)}     ${m(runs, (r) => r.ms.uitwisseling - r.ms.worker)}    ${m(runs, (r) => r.ms.decoderen)} ${m(runs, (r) => r.ms.index)}  ${m(runs, (r) => r.ms.totaal)}`);
  }
  console.log('* JavaScript: geometrie uit de operatorlijst, inclusief de index');
  console.log(`overdracht = worker-antwoord (SHM schrijven) + SHM lezen; daarvan SHM lezen in node: koud ${m(koud, (r) => r.ms.lezen).trim()} ms, warm ${m(warm, (r) => r.ms.lezen).trim()} ms`);
  console.log('');
  console.log(`piekgeheugen node-heap (+ArrayBuffers) tijdens extractie: JavaScript ${mb(jsGeheugen)}, Rust-route ${mb(rustGeheugen)}${globalThis.gc ? '' : ' (zonder --expose-gc: onnauwkeurig)'}`);
  console.log(`werkgeheugen workerproces: na start ${mb(basisWs)}, piek ${mb(piekWs)}`);
  return gelijk ? 0 : 1;
}

let fouten = 0;
const worker = await new Worker(90).start();
try {
  if (ALLEEN !== 'bench') fouten += await pariteit(worker);
} finally {
  await worker.stop();
}
if (ALLEEN !== 'pariteit') fouten += await bench();
console.log(fouten ? `\n${fouten} fout(en)` : '\nalles in orde');
process.exit(fouten ? 1 : 0);
