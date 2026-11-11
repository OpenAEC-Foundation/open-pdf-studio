#!/usr/bin/env node
// Zoektekst: de JavaScript-route (pdf.js getTextContent in extractPageText,
// js/search/find-controller.js) tegenover de Rust-route (pdfium-worker,
// src/page_text/, via js/search/rust-zoektekst.js), met de zoekfunctie van de
// app op beide.
//
// 1. Pariteit op gemaakte PDF's (zoektekst-pdfs.mjs: Latijn, diakrieten,
//    ligaturen, afbreking, rechts naar links, CJK, gedraaide tekst, tekst in
//    formulieren, CropBox, onzichtbare tekst): per pagina dezelfde tekst, en
//    per zoekvraag (gewoon, hoofdlettergevoelig, hele woorden) dezelfde
//    treffers in dezelfde volgorde, met markeringen binnen 0,5 pt:
//    - het vak van elk getroffen item (transform, breedte, hoogte);
//    - het vak van de treffer zelf, waarbij JavaScript voor het deel van een
//      item de echte tekenbreedtes krijgt (standaardmetriek uit pdf-lib, de
//      /W van de gemaakte CID-fonts) en Rust zijn tekenvakken gebruikt.
//    Pagina's die de Rust-route bewust aan pdf.js laat (verticaal schrift,
//    rechts naar links) moeten in de app via pdf.js lopen: dat wordt ook
//    gecontroleerd.
// 2. De echte PDF's in 'test pdf-bestanden/Originele bestanden' (alleen
//    lezen): hoeveel pagina's dezelfde tekst geven, en de treffers voor een
//    paar zoekvragen.
// 3. Meting: een gemaakt document van 500 pagina's en een zware tekenset:
//    tijd tot de eerste treffer en tot het einde van de zoektocht zoals de
//    zoekbalk hem doet (huidige pagina eerst, dan de rest), en het
//    piekgeheugen van de node-heap (de WebView in de app) en van het
//    workerproces.
//
// Gebruik, vanuit open-pdf-studio/:
//   cargo +stable-x86_64-pc-windows-msvc build --release -p pdfium-worker
//   node --expose-gc scripts/bench-rust/10-zoektekst.mjs
//     [--worker <pad naar pdfium-worker(.exe)>]  (standaard C:\opds-cargo-target-449\release)
//     [--alleen pariteit|echt|bench] [--paginas 500] [--runs 3] [--zwaar <pdf>]
//     [--map <map met PDF's voor stap 2, ook submappen>]
// Exitcode 1 als de pariteit op de gemaakte PDF's faalt.

import { spawn, execFileSync } from 'node:child_process';
import { createRequire, register } from 'node:module';
import { existsSync, mkdirSync, openSync, readSync, closeSync, writeFileSync, readFileSync, readdirSync, fstatSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
const PAGINAS = Number(optie('paginas', 500));
const RUNS = Number(optie('runs', 3));
const ECHT = resolve(optie('map', join(app, '..', 'test pdf-bestanden', 'Originele bestanden')));
const TOL = 0.5;

// ── App-modules onder node ────────────────────────────────────────────────
register(pathToFileURL(join(app, 'js/core/app-test-hooks.mjs')).href, import.meta.url);
const { installeerBrowserStubs } = await import(pathToFileURL(join(app, 'js/core/app-test-hooks.mjs')).href);
installeerBrowserStubs();
const fc = await import(pathToFileURL(join(app, 'js/search/find-controller.js')).href);
const { maakRustZoektekst, decodeerZoektekst } = await import(pathToFileURL(join(app, 'js/search/rust-zoektekst.js')).href);
const mr = await import(pathToFileURL(join(app, 'js/search/match-rect.js')).href);
const { getDocument } = await import(pathToFileURL(appRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
const { PDFDocument, StandardFonts } = await import(pathToFileURL(appRequire.resolve('pdf-lib')).href);
const { maakPariteitsPdf, maakTekstDocument } = await import(pathToFileURL(join(hier, 'zoektekst-pdfs.mjs')).href);

const standardFontDataUrl = `${join(app, 'public/pdfjs/web/standard_fonts').split('\\').join('/')}/`;
const openPdfjs = (bytes) => getDocument({ data: new Uint8Array(bytes), verbosity: 0, isEvalSupported: false, standardFontDataUrl }).promise;

// ── De worker ───────────────────────────────────────────────────────────────
class Worker {
  constructor(slot) {
    this.slot = slot;
    this.ns = 'zoekbench';
    this.id = 1;
    this.workerMs = 0;
    this.overdracht = 0;
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
    if (!ready.caps?.includes('page_text')) throw new Error(`worker kent page_text niet: ${JSON.stringify(ready)}`);
    this.shm = join(tmpdir(), `pdfium-worker-${this.ns}-${this.slot}.shm`);
    this.fd = openSync(this.shm, 'r');
    return this;
  }

  vraag(obj) {
    return new Promise((r) => {
      this.wachtend.push((line) => r(JSON.parse(line)));
      this.proc.stdin.write(`${JSON.stringify(obj)}\n`);
    });
  }

  /** Zoals worker_pool/text.rs + het Tauri-commando extract_search_text. */
  async tekst({ path, first, count, expectLen }) {
    const resp = await this.vraag({ op: 'page_text', id: this.id++, path, first, count, expect_len: expectLen ?? null });
    if (!resp.ok) throw new Error(`PDF_TEXT_FAILED: ${resp.error}`);
    this.workerMs += resp.ms;
    this.overdracht += resp.shm_bytes;
    const buf = Buffer.allocUnsafe(resp.shm_bytes);
    readSync(this.fd, buf, 0, resp.shm_bytes, 32);
    return buf;
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
    closeSync(this.fd);
    this.proc.stdin.write('{"op":"shutdown"}\n');
    this.proc.stdin.end();
    await new Promise((r) => this.proc.on('exit', r));
  }
}

/** De route van de app; banen gaan elk naar hun eigen worker, zoals de pool ze verdeelt. */
function route(workers) {
  const lijst = Array.isArray(workers) ? workers : [workers];
  return maakRustZoektekst({ inTauri: () => true, call: (_cmd, args) => lijst[(args.lane || 0) % lijst.length].tekst(args), warn: (...a) => console.log('  waarschuwing:', ...a) });
}

// ── Treffers zoals de zoekbalk ze maakt ────────────────────────────────────
const VRAGEN = [
  'e', 'the', 'text', 'words', 'Word', 'word', 'here', 'Café', 'cafe', 'müller', 'Zürich', 'œuvre', 'en–dash',
  'Multiple spaces', 'spaces here', 'Kerned words', 'Tightkerning', 'Wide gap', 'gap here', 'C h a r', 'spaced text',
  'hyphen-', 'hyphen-ated', 'mc2', 'squared, H2O', 'Mixed Bold', 'Sizes on', 'Two separate blocks', 'far away',
  'Backwardsoverlap', 'leadingline', 'Scaled', 'Half scale', 'Horizontally scaled', 'scaled words', 'Condensed words',
  'final', 'flow', 'office', 'fi', 'ffi', 'staff', 'fine', 'flat', 'Coffee', 'affinity', 'first flight',
  'سلام', 'عربي', 'שלום', '1234', '١٢٣',
  '日本語', 'テキスト', '検索', '中文', '한국어', '검색', 'PDF文書', 'ABCdef 123', '日本語 検索',
  'Rotated', 'ninety', 'Upside down', 'two seventy', 'Diagonal forty', 'Skewed italic', 'Vertical kerned',
  'rotated page', 'second line', 'Before form', 'inside form', 'outer form', 'after form', 'form label', 'drawing form',
  'crop box', 'outside', 'Below', 'hidden ocr', 'visible again', 'Type', 'ype', 'three', 'Typethree', 'after type3', '2026-11-10', 'v1.2.3', '(x)', 'a+b=c',
];
const OPTIES = [
  { matchCase: false, wholeWord: false },
  { matchCase: true, wholeWord: false },
  { matchCase: false, wholeWord: true },
];

function treffers(pageData, vraag, o) {
  return fc.zoekPaginaAlleBronnen(pageData, fc.buildPattern(vraag, o.matchCase, o.wholeWord), vraag, { annotations: [] }, { tekst: true, annotaties: false });
}

/** Breedtemeter per font voor het JavaScript-deel van een item. */
async function maakMeters() {
  const pdf = await PDFDocument.create();
  const std = {};
  for (const [naam, f] of [['Helvetica', StandardFonts.Helvetica], ['Helvetica-Bold', StandardFonts.HelveticaBold], ['Times-Roman', StandardFonts.TimesRoman], ['Courier', StandardFonts.Courier]]) {
    std[naam] = await pdf.embedFont(f);
  }
  return (fontName) => {
    const f = std[fontName];
    if (!f) return null;
    return (s) => {
      try {
        // Ligaturen zijn na normalisatie losse tekens; elk teken apart.
        return [...s].reduce((t, c) => t + f.widthOfTextAtSize(c, 1000), 0);
      } catch {
        return [...s].length * 500;
      }
    };
  };
}

const vakVan = (item, s, e, view, fractions) => {
  const [a, b] = fractions;
  return mr.matchBoxInPageFrame(item.transform, item.width, item.height, a, b, view);
};
const vakAfstand = (p, q) => {
  if (!p || !q) return p === q ? 0 : Infinity;
  return Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.w - q.w), Math.abs(p.h - q.h), Math.abs(p.angle - q.angle) * 100);
};

/** Vergelijk twee paginadata: tekst, en treffers + markeringen voor alle vragen. */
function vergelijkPagina(js, rust, meters, vragen = VRAGEN, opties = OPTIES) {
  const uit = { tekstGelijk: js.text === rust.text, treffers: 0, verschillen: [], maxItemVak: 0, maxTrefferVak: 0, deelVakGemeten: 0 };
  const rustItemOp = new Map(rust.items.map((it, i) => [it.startPos, i]));
  for (const vraag of vragen) {
    for (const o of opties) {
      const a = treffers(js, vraag, o);
      const b = treffers(rust, vraag, o);
      uit.treffers += a.length;
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n; i++) {
        const p = a[i];
        const q = b[i];
        if (!p || !q || p.startPos !== q.startPos || p.matchText !== q.matchText) {
          uit.verschillen.push({ vraag, o, js: p && { pos: p.startPos, t: p.matchText }, rust: q && { pos: q.startPos, t: q.matchText } });
          continue;
        }
        if (p.items.length !== q.items.length) {
          uit.verschillen.push({ vraag, o, items: [p.items.length, q.items.length] });
          continue;
        }
        for (let k = 0; k < p.items.length; k++) {
          const ij = p.items[k];
          const ir = q.items[k];
          if (!ij.transform || !ir.transform) continue;
          const view = js.view;
          // (1) het hele item
          const d1 = vakAfstand(vakVan(ij, 0, ij.str.length, view, [0, 1]), vakVan(ir, 0, ir.str.length, view, [0, 1]));
          uit.maxItemVak = Math.max(uit.maxItemVak, d1);
          // (2) het getroffen deel
          const s = Math.max(0, p.startPos - ij.startPos);
          const e = Math.min(ij.str.length, p.endPos - ij.startPos);
          if (e <= s) continue;
          const meter = meters(rust.items[rustItemOp.get(ir.startPos)]?.fontName || '');
          const fj = mr.matchFractions(ij.str, s, e, meter);
          const fr = mr.matchFractionsUitVakken(ir.vakken, s, e) || [0, 1];
          const d2 = vakAfstand(vakVan(ij, s, e, view, fj), vakVan(ir, s, e, view, fr));
          // De JavaScript-schatting telt alleen tekenbreedtes op; een item met
          // tussenruimte (kerning, Tc, Tw) of een ligatuur kan zij niet goed
          // verdelen. Zo'n deeltreffer telt apart.
          const passend = meter && Math.abs((meter(ij.str) / 1000) * Math.hypot(ij.transform[0], ij.transform[1]) - ij.width) < 0.05;
          if (passend || (s === 0 && e === ij.str.length)) {
            uit.deelVakGemeten++;
            uit.maxTrefferVak = Math.max(uit.maxTrefferVak, d2);
            if (d2 > TOL) uit.verschillen.push({ vraag, o, vak: d2, item: ij.str, s, e });
          } else if (meter) {
            uit.deelVakSchatting = Math.max(uit.deelVakSchatting || 0, d2);
          }
          if (d1 > TOL) uit.verschillen.push({ vraag, o, itemvak: d1, item: ij.str });
        }
      }
    }
  }
  return uit;
}

async function paginaDataJs(pdf, n) {
  return fc.extractPageText(pdf, n, null, null);
}

// ── 1. Pariteit op gemaakte PDF's ───────────────────────────────────────────
const werkmap = join(tmpdir(), 'opds-zoek-bench');
mkdirSync(werkmap, { recursive: true });

const REDENEN = ['verticaal', 'rechts naar links', 'tekst die PDFium niet leest'];
/** Pagina's van de gemaakte PDF die de app bewust met pdf.js leest. */
const VERWACHT_NAAR_JS = {
  rtl: 'rechts naar links', // PDFium ontleedt presentatievormen en spiegelt haakjes
  'cjk-verticaal': 'tekst die PDFium niet leest', // Identity-V: geen tekens uit PDFium
  type3: 'tekst die PDFium niet leest', // Type3 zonder ToUnicode: PDFium geeft de tekencodes
  'type3-klein': 'tekst die PDFium niet leest', // Type3 op Tf 1: pdf.js schaalt de hoogte met FontBBox × FontMatrix
};

async function pariteit(worker) {
  console.log('\n== Pariteit: gemaakte PDF ==');
  const { pdf: bytes, paginas } = maakPariteitsPdf();
  const pad = join(werkmap, 'pariteit.pdf');
  writeFileSync(pad, bytes);
  const pdf = await openPdfjs(bytes);
  const meters = await maakMeters();
  const r = route(worker);
  const bron = r.bron({ path: pad, expectLen: bytes.length, paginaAantal: pdf.numPages });
  let fouten = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    const js = await paginaDataJs(pdf, n);
    const rustRuw = await bron.pagina(n);
    const naam = paginas[n - 1];
    if (!rustRuw) {
      // Bewust naar pdf.js: de worker markeert de pagina en de app leest haar
      // met pdf.js. Alleen verwacht voor deze gevallen, met deze reden.
      const p = decodeerZoektekst(await worker.tekst({ path: pad, first: n - 1, count: 1, expectLen: bytes.length })).paginas[0];
      const reden = REDENEN.filter((_, i) => p.vlaggen & (1 << i)).join('+');
      console.log(`${String(n).padStart(2)} ${naam.padEnd(14)} via pdf.js: ${reden}`);
      if (!VERWACHT_NAAR_JS[naam] || !reden.split('+').includes(VERWACHT_NAAR_JS[naam])) { fouten++; console.log(`   ONVERWACHT (verwacht: ${VERWACHT_NAAR_JS[naam] || 'via Rust'})`); }
      continue;
    }
    const rust = { ...js, text: rustRuw.text, items: rustRuw.items };
    const v = vergelijkPagina(js, rust, meters);
    const ok = v.tekstGelijk && v.verschillen.length === 0;
    if (!ok) fouten++;
    console.log(`${String(n).padStart(2)} ${naam.padEnd(14)} tekst ${v.tekstGelijk ? 'gelijk' : 'VERSCHIL'}, ${v.treffers} treffers, ${v.verschillen.length} verschillen; max. afwijking itemvak ${v.maxItemVak.toFixed(3)} pt, treffervak ${v.maxTrefferVak.toFixed(3)} pt (${v.deelVakGemeten} gemeten)${v.deelVakSchatting ? `; deeltreffers in items met tussenruimte/ligatuur: JS-schatting tot ${v.deelVakSchatting.toFixed(2)} pt naast de Rust-vakken` : ''}`);
    if (!v.tekstGelijk) {
      console.log(`   js:   ${JSON.stringify(js.text)}`);
      console.log(`   rust: ${JSON.stringify(rust.text)}`);
    }
    for (const d of v.verschillen.slice(0, 6)) console.log('   ', JSON.stringify(d));
  }
  bron.sluit();

  // Wat de app doet met een pagina die de worker aan pdf.js laat: de CJK-
  // pagina (met verticaal schrift) en de RTL-pagina komen dan uit pdf.js, en
  // de zoektocht over het hele document is gelijk aan de JavaScript-route.
  const bron2 = r.bron({ path: pad, expectLen: bytes.length, paginaAantal: pdf.numPages });
  let gelijk = true;
  for (let n = 1; n <= pdf.numPages; n++) {
    const js = await paginaDataJs(pdf, n);
    const viaApp = await fc.extractPageText(pdf, n, null, bron2);
    for (const vraag of VRAGEN) {
      const a = treffers(js, vraag, OPTIES[0]).map((t) => `${t.startPos}:${t.matchText}`).join('|');
      const b = treffers(viaApp, vraag, OPTIES[0]).map((t) => `${t.startPos}:${t.matchText}`).join('|');
      if (a !== b) { gelijk = false; console.log(`   app-route wijkt af op pagina ${n} voor ${JSON.stringify(vraag)}`); }
    }
  }
  bron2.sluit();
  console.log(`zoektocht via de app-route (extractPageText met bron) over alle pagina's: ${gelijk ? 'gelijk aan pdf.js' : 'VERSCHIL'}`);
  if (!gelijk) fouten++;

  // Bestand op schijf gewijzigd: de worker weigert, de bron valt terug.
  const bron3 = r.bron({ path: pad, expectLen: bytes.length + 1, paginaAantal: pdf.numPages });
  const terug = await bron3.pagina(1);
  console.log(`afwijkende bestandslengte: ${terug === null && bron3.kapot ? 'terugval naar pdf.js' : 'GEEN TERUGVAL'}`);
  if (terug !== null) fouten++;
  await pdf.loadingTask.destroy();
  return fouten;
}

// ── 2. Echte PDF's ──────────────────────────────────────────────────────────
async function echt(worker) {
  if (!existsSync(ECHT)) { console.log(`\n(geen map ${ECHT})`); return 0; }
  console.log(`\n== Echte PDF's (${ECHT}, alleen lezen) ==`);
  const meters = await maakMeters();
  const vragen = ['e', 'de', 'the', 'en', '1', 'mm', 'wapening', 'beton', 'Plan', 'A', 'detail'];
  const lijst = [];
  const loop = (map) => {
    for (const d of readdirSync(map, { withFileTypes: true })) {
      if (d.isDirectory() && !['node_modules', 'target', '.git'].includes(d.name)) loop(join(map, d.name));
      else if (d.isFile() && d.name.toLowerCase().endsWith('.pdf')) lijst.push(join(map, d.name));
    }
  };
  loop(ECHT);
  for (const pad of lijst.sort()) {
    const naam = pad.slice(ECHT.length + 1);
    const fd = openSync(pad, 'r');
    const lengte = fstatSync(fd).size;
    closeSync(fd);
    const bytes = readFileSync(pad);
    let pdf;
    try { pdf = await openPdfjs(bytes); } catch (e) { console.log(`${naam}: pdf.js kan hem niet openen (${e.message})`); continue; }
    const redenen = new Set(); let gelijk = 0; let naarJs = 0; let treffersJs = 0; let verschillen = 0; let maxVak = 0; const voorbeelden = [];
    const max = Math.min(pdf.numPages, 60);
    let fout = null;
    const bron = route(worker).bron({ path: pad, expectLen: lengte, paginaAantal: pdf.numPages });
    try {
      for (let n = 1; n <= max; n++) {
        const js = await paginaDataJs(pdf, n);
        const ruw = await bron.pagina(n);
        if (!ruw) {
          naarJs++;
          const p = decodeerZoektekst(await worker.tekst({ path: pad, first: n - 1, count: 1, expectLen: lengte })).paginas[0];
          redenen.add(REDENEN.filter((_, i) => p.vlaggen & (1 << i)).join('+'));
          continue;
        }
        const rust = { ...js, text: ruw.text, items: ruw.items };
        const v = vergelijkPagina(js, rust, meters, vragen, [OPTIES[0]]);
        if (v.tekstGelijk) gelijk++;
        else if (voorbeelden.length < 3) voorbeelden.push(eersteVerschil(js.text, rust.text, n));
        treffersJs += v.treffers;
        for (const d of v.verschillen) if (voorbeelden.length < 3) voorbeelden.push(`p.${n} ${JSON.stringify(d)}`);
        verschillen += v.verschillen.filter((d) => d.vak === undefined && d.itemvak === undefined).length;
        maxVak = Math.max(maxVak, v.maxItemVak);
      }
    } catch (e) {
      fout = e.message;
    }
    bron.sluit();
    await pdf.loadingTask.destroy();
    console.log(`${naam.slice(-44).padEnd(44)} ${String(max).padStart(3)} p.: tekst gelijk ${gelijk}/${max - naarJs}${naarJs ? ` (+${naarJs} via pdf.js: ${[...redenen].join(', ')})` : ''}, treffers ${treffersJs}, afwijkend ${verschillen}, max. itemvak ${maxVak.toFixed(2)} pt${fout ? `; FOUT ${fout}` : ''}`);
    for (const vb of voorbeelden) console.log(`   ${vb}`);
  }
  return 0;
}

function eersteVerschil(a, b, n) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `p.${n} @${i}: js ${JSON.stringify(a.slice(Math.max(0, i - 15), i + 25))} | rust ${JSON.stringify(b.slice(Math.max(0, i - 15), i + 25))}`;
}

// ── 3. Meting ──────────────────────────────────────────────────────────────
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

/**
 * Een zoektocht zoals executeProgressiveSearch: huidige pagina eerst, dan
 * de rest; per pagina extractPageText + de treffers. Een vers geopend
 * pdf.js-document per run (geen tekstcache).
 */
let basisGeheugen = 0;
async function zoektocht(bytes, pad, vraag, huidig, workers, banen = 1) {
  globalThis.gc?.();
  basisGeheugen = process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers;
  const stop = geheugenMeter();
  const t0 = performance.now();
  const pdf = await openPdfjs(bytes);
  const bron = workers ? route(workers).bron({ path: pad, expectLen: bytes.length, paginaAantal: pdf.numPages, banen }) : null;
  const volgorde = [huidig, ...Array.from({ length: pdf.numPages }, (_, i) => i + 1).filter((p) => p !== huidig)];
  const patroon = fc.buildPattern(vraag, false, false);
  let eerste = null; let eerstePagina = null; let totaal = 0; let tekens = 0; let zoekMs = 0;
  const bewaard = [];
  for (const n of volgorde) {
    const data = await fc.extractPageText(pdf, n, null, bron);
    bewaard.push(data); // de zoekbalk bewaart de tekst van alle pagina's (tekstcache)
    tekens += data.text.length;
    const tz = performance.now();
    const t = fc.zoekPaginaAlleBronnen(data, patroon, vraag, { annotations: [] }, { tekst: true, annotaties: false });
    zoekMs += performance.now() - tz;
    totaal += t.length;
    if (eerstePagina === null) eerstePagina = performance.now() - t0;
    if (t.length && eerste === null) eerste = performance.now() - t0;
  }
  const ms = performance.now() - t0;
  const geheugen = stop();
  bron?.sluit();
  await pdf.loadingTask.destroy();
  // Wat de zoekbalk daarna bewaart (zijn tekstcache, in de app op de
  // hoofdthread): pdf.js is hier al dicht, in de app leeft het in een eigen
  // worker.
  globalThis.gc?.();
  await new Promise((r) => setTimeout(r, 0));
  globalThis.gc?.();
  const blijft = process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers - basisGeheugen;
  return { ms, eerste, eerstePagina, totaal, tekens, geheugen, blijft, zoekMs, paginas: volgorde.length, bewaard: bewaard.length };
}

async function meet(naam, bytes, pad, vraag, huidig) {
  console.log(`
-- ${naam}: ${mb(bytes.length)}, zoekvraag ${JSON.stringify(vraag)}, huidige pagina ${huidig}, ${RUNS} runs (mediaan) --`);
  const js = [];
  for (let i = 0; i < RUNS; i++) js.push(await zoektocht(bytes, pad, vraag, huidig, null));
  const workers = [await new Worker(71).start(), await new Worker(72).start(), await new Worker(73).start()];
  const basisWs = workers[0].piekWerkgeheugen();
  const rust = {};
  for (const banen of [1, 2, 3]) {
    rust[banen] = [];
    for (let i = 0; i < RUNS; i++) {
      for (const w of workers) { w.workerMs = 0; w.overdracht = 0; }
      // Elke run een nieuwe kopie van het bestand: de worker laadt hem koud,
      // zoals bij de eerste zoektocht in een net geopend document.
      const kopie = pad.replace(/\.pdf$/i, `-kopie-${banen}-${i}.pdf`);
      if (!kopie.startsWith(werkmap)) { rust[banen].push(await zoektocht(bytes, pad, vraag, huidig, workers.slice(0, banen), banen)); continue; }
      writeFileSync(kopie, bytes);
      const r = await zoektocht(bytes, kopie, vraag, huidig, workers.slice(0, banen), banen);
      r.workerMs = workers.reduce((t, w) => t + w.workerMs, 0); r.overdracht = workers.reduce((t, w) => t + w.overdracht, 0);
      rust[banen].push(r);
    }
  }
  const piekWs = Math.max(...workers.map((w) => w.piekWerkgeheugen() || 0));
  for (const w of workers) await w.stop();
  const m = (runs, f) => mediaan(runs.map(f));
  console.log(`pagina's ${js[0].paginas}, tekens ${js[0].tekens} (Rust ${rust[1][0].tekens}), treffers JS ${js[0].totaal} / Rust ${rust[1][0].totaal}`);
  console.log('route              eerste pagina  eerste treffer   totaal (ms)  waarvan zoeken   piek node-heap   tekstcache');
  const regel = (label, runs) => console.log(`${label.padEnd(18)} ${m(runs, (r) => r.eerstePagina).toFixed(0).padStart(13)}  ${m(runs, (r) => r.eerste ?? NaN).toFixed(0).padStart(14)}  ${m(runs, (r) => r.ms).toFixed(0).padStart(12)}  ${m(runs, (r) => r.zoekMs).toFixed(0).padStart(14)}   ${mb(m(runs, (r) => r.geheugen)).padStart(14)}   ${mb(m(runs, (r) => r.blijft)).padStart(12)}`);
  regel('JavaScript', js);
  for (const banen of [1, 2, 3]) regel(`Rust, ${banen} ${banen === 1 ? 'baan' : 'banen'}`, rust[banen]);
  const r1 = rust[1].filter((r) => r.workerMs != null);
  if (r1.length) console.log(`Rust: workers lezen samen ${m(r1, (r) => r.workerMs).toFixed(0)} ms (1 baan), overdracht ${mb(m(r1, (r) => r.overdracht))} via SHM; werkgeheugen per workerproces na start ${mb(basisWs)}, piek ${mb(piekWs)}`);
}

async function bench() {
  console.log('\n== Meting ==');
  const doc = maakTekstDocument(PAGINAS);
  const pad = join(werkmap, `tekst-${PAGINAS}.pdf`);
  writeFileSync(pad, doc);
  await meet(`gemaakt tekstdocument, ${PAGINAS} pagina's`, doc, pad, 'search', 1);
  await meet(`gemaakt tekstdocument, ${PAGINAS} pagina's (zeldzaam woord)`, doc, pad, 'Hoofdstuk 499', Math.floor(PAGINAS / 2));
  const zwaar = optie('zwaar', null);
  const kandidaten = zwaar ? [zwaar] : ['3131-CLT-Set.pdf', 'Zware vector PDF.pdf', '20260316 - Barn Relocation - 389 E Hemenway Lane - for Permit.pdf'].map((f) => join(ECHT, f));
  for (const k of kandidaten) {
    if (!existsSync(k)) continue;
    const bytes = readFileSync(k);
    await meet(`tekenset ${k.split(/[\\/]/).pop()}`, bytes, k, 'e', 1);
  }
}

let fouten = 0;
if (!ALLEEN || ALLEEN === 'pariteit' || ALLEEN === 'echt') {
  const worker = await new Worker(70).start();
  try {
    if (ALLEEN !== 'echt') fouten += await pariteit(worker);
    if (ALLEEN !== 'pariteit') await echt(worker);
  } finally {
    await worker.stop();
  }
}
if (!ALLEEN || ALLEEN === 'bench') await bench();
console.log(fouten ? `\n${fouten} fout(en)` : '\nalles in orde');
process.exit(fouten ? 1 : 0);
