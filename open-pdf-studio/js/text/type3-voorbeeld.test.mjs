// Live weergave van een tekstbewerking in een Type3-font (#723).
//
// De painter kan een Type3-font niet als CSS-font gebruiken en tekende de
// vervanging live in Helvetica; na opslaan stond hij wel in het originele
// font. Nu bouwt type3-voorbeeld.js een klein tijdelijk PDF met het font van
// de pagina en dezelfde tekenroute als de saver, en rendert PDF.js dat.
//
// - het tijdelijke PDF: font gekopieerd (CharProcs), dezelfde glyfcodes en
//   posities als het opgeslagen bestand;
// - een glyf die het Type3-font niet heeft: precies als de saver
//   (Standard-14 voor die run);
// - pixels: de render van het voorbeeld is de render van de opgeslagen
//   pagina (PDF.js + @napi-rs/canvas);
// - planning: debounce, verouderde bouw of render weggegooid of afgebroken,
//   vrijgeven, terugval.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
// PDF.js ziet de kale window van de stubs en plant zijn render-stappen met
// requestAnimationFrame; onder node bestaat die niet.
if (typeof window.requestAnimationFrame !== 'function') window.requestAnimationFrame = (fn) => setImmediate(fn);
if (typeof window.cancelAnimationFrame !== 'function') window.cancelAnimationFrame = (h) => clearImmediate(h);
const { saveTextEditsToPages, tekenTextEdit } = await import('../pdf/saver/text-edits.js');
const { interpretContentStreams } = await import('./content-stream-text.js');
const { analyseerPagina, maakInPlaceResultaat } = await import('../pdf/saver/text-edit-inplace.js');
const V = await import('./type3-voorbeeld.js');

// ── Testdocument: een Type3-font met drie glyfen (A, B, C) en een vierde code
// (D) die wel een breedte heeft maar geen procedure. ──
async function type3Pdf({ schaal = 1 } = {}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 200]);
  const ctx = pdf.context;
  const k = (n) => n / schaal; // glyfruimte bij FontMatrix 0.001 × schaal
  const proc = (s) => ctx.register(ctx.flateStream(s));
  const charProcs = ctx.obj({
    A: proc(`${k(700)} 0 d0 ${k(50)} 0 ${k(600)} ${k(700)} re f`),
    B: proc(`${k(800)} 0 d0 0 0 m ${k(750)} 0 l ${k(375)} ${k(700)} l f`),
    C: proc(`${k(600)} 0 d0 0 ${k(300)} ${k(550)} ${k(100)} re f`),
  });
  const font = ctx.obj({
    Type: 'Font',
    Subtype: 'Type3',
    FontBBox: [0, 0, k(1000), k(1000)],
    FontMatrix: [0.001 * schaal, 0, 0, 0.001 * schaal, 0, 0],
    CharProcs: charProcs,
    Encoding: ctx.obj({ Type: 'Encoding', Differences: [65, 'A', 'B', 'C', 'D'] }),
    FirstChar: 65,
    LastChar: 68,
    Widths: [k(700), k(800), k(600), k(500)],
    Resources: ctx.obj({}),
  });
  page.node.setFontDictionary(PDFName.of('F3'), ctx.register(font));
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(
    'q 0.2 0.2 0.2 rg 20 20 260 2 re f Q\nBT /F3 24 Tf 72 120 Td (ABC) Tj ET\n')));
  return pdf.save({ useObjectStreams: false });
}

function edit(over = {}) {
  return {
    id: 't3', page: 1, originalText: 'ABC', newText: 'CAB',
    pdfX: 72, pdfY: 120, pdfWidth: 50.4, fontSize: 24, lineSpacing: 28.8, numOriginalLines: 1,
    fontFamily: 'Helvetica', loadedFontName: 'g_d0_f1', color: '#000000', textAngle: 0,
    lineStyles: [{ fontFamily: 'Helvetica', fontSize: 24, color: '#000000', loadedFontName: 'g_d0_f1' }],
    originalLineInfo: [{ x: 72, y: 120, width: 50.4, fontSize: 24, angle: 0, text: 'ABC' }],
    ...over,
  };
}

const BOX = { x: 0, y: 0, width: 300, height: 200 };

function paginaOps(doc, page) {
  const inhoud = page.node.Contents();
  const lijst = inhoud.asArray ? inhoud.asArray() : [inhoud];
  const teksten = lijst.map((ref) => {
    const st = doc.context.lookup(ref);
    const bytes = st instanceof PDFRawStream ? decodePDFRawStream(st).decode() : st.getUnencodedContents();
    return Buffer.from(bytes).toString('latin1');
  });
  return interpretContentStreams(teksten).map((o) => ({
    font: o.font, size: o.size, x: o.x, y: o.y,
    hex: (o.strings || []).map((b) => Buffer.from(b).toString('hex')).join(''),
  }));
}

function fontVan(doc, page, naam) {
  const fonts = page.node.Resources().lookup(PDFName.of('Font'), PDFDict);
  return fonts.lookup(PDFName.of(naam), PDFDict);
}

// Het opgeslagen bestand (opnieuw geladen: pdf-lib schrijft ingebedde
// Standard-14-fonts pas bij save weg).
async function opgeslagen(bytes, e) {
  const doc = await PDFDocument.load(bytes);
  await saveTextEditsToPages(doc, doc.getPages(), { textEdits: [e] });
  return PDFDocument.load(await doc.save({ useObjectStreams: false }));
}

// De nieuwe show-ops: die in het originele (opgeslagen) of tijdelijke
// document na de regel staan, met de fontnaam vertaald naar het subtype.
function nieuweRuns(doc, page) {
  return paginaOps(doc, page).filter((o) => o.hex).map((o) => {
    const f = fontVan(doc, page, o.font);
    const sub = f ? String(f.get(PDFName.of('Subtype'))) : '?';
    return { ...o, font: sub };
  });
}

test('het tijdelijke PDF draagt het Type3-font en dezelfde codes als het opgeslagen bestand', async () => {
  const bytes = await type3Pdf();
  const e = edit();
  const res = await V.bouwType3VoorbeeldPdf(await PDFDocument.load(bytes), e, BOX);
  assert.equal(res?.type3, true);
  assert.deepEqual(res.fonts.map((f) => f.subtype), ['Type3']);
  assert.equal(e._pendingBakeInfo, undefined, 'het record zelf blijft onaangeroerd');

  const tmp = await PDFDocument.load(res.bytes);
  const tp = tmp.getPages()[0];
  const mb = tp.getMediaBox();
  assert.deepEqual([mb.x, mb.y, mb.width, mb.height], [0, 0, 300, 200]);
  const font = fontVan(tmp, tp, res.fonts[0].naam);
  assert.equal(String(font.get(PDFName.of('Subtype'))), '/Type3');
  const procs = font.lookup(PDFName.of('CharProcs'), PDFDict);
  assert.deepEqual(procs.keys().map(String).sort(), ['/A', '/B', '/C']);

  const opgeslagenDoc = await opgeslagen(bytes, edit());
  const bewaard = nieuweRuns(opgeslagenDoc, opgeslagenDoc.getPages()[0]);
  const voorbeeld = nieuweRuns(tmp, tp);
  assert.deepEqual(bewaard.map((o) => o.hex), ['434142'], 'saver schrijft CAB in het Type3-font');
  assert.deepEqual(voorbeeld, bewaard);
});

test('Type3-breedtes gaan via de FontMatrix (pen-advance klopt ook bij een andere glyfschaal)', async () => {
  for (const schaal of [1, 10]) {
    const doc = await PDFDocument.load(await type3Pdf({ schaal }));
    const ana = analyseerPagina(doc, doc.getPages()[0], [edit()]);
    const r = maakInPlaceResultaat(ana, ana.editMatches[0]);
    const enc = r.encodeRun('CAB', 0, 24);
    assert.ok(Math.abs(enc.width - 50.4) < 1e-9, `schaal ${schaal}: ${enc.width}`);
    assert.deepEqual(enc.codes, [67, 65, 66]);
    // D heeft een breedte maar geen procedure: niet in het font.
    assert.equal(r.encodeRun('CAD', 0, 24), null);
  }
  // analyseerPagina laat het document ongemoeid.
  const doc = await PDFDocument.load(await type3Pdf());
  const voor = doc.getPages()[0].node.get(PDFName.of('Contents'));
  analyseerPagina(doc, doc.getPages()[0], [edit()]);
  assert.equal(doc.getPages()[0].node.get(PDFName.of('Contents')), voor);
});

test('een glyf die het Type3-font niet heeft: dezelfde terugval als de saver', async () => {
  const bytes = await type3Pdf();
  // Eén run met D: de hele run gaat naar Standard-14, ook bij de saver.
  const heel = await V.bouwType3VoorbeeldPdf(await PDFDocument.load(bytes), edit({ newText: 'CAD' }), BOX);
  assert.deepEqual(heel, { type3: false }, 'geen Type3 nodig: de Helvetica-weergave is juist');
  const bewaardHeel = nieuweRuns(...(await (async () => {
    const d = await opgeslagen(bytes, edit({ newText: 'CAD' }));
    return [d, d.getPages()[0]];
  })()));
  assert.ok(bewaardHeel.length > 0 && bewaardHeel.every((o) => o.font === '/Type1'), JSON.stringify(bewaardHeel));

  // Twee runs: CA in het Type3-font, D in Standard-14, in beide.
  const gemengd = edit({
    newText: 'CAD',
    lineSegments: [[{ text: 'CAD', dx: 0, runs: [
      { text: 'CA', bold: false, italic: false }, { text: 'D', bold: false, italic: false }] }]],
  });
  const res = await V.bouwType3VoorbeeldPdf(await PDFDocument.load(bytes), gemengd, BOX);
  assert.equal(res.type3, true);
  const tmp = await PDFDocument.load(res.bytes);
  const voorbeeld = nieuweRuns(tmp, tmp.getPages()[0]);
  const d = await opgeslagen(bytes, JSON.parse(JSON.stringify(gemengd)));
  const bewaard = nieuweRuns(d, d.getPages()[0]);
  assert.deepEqual(bewaard.map((o) => o.font), ['/Type3', '/Type1']);
  assert.deepEqual(voorbeeld, bewaard);
});

test('geen in-place-match of geen Type3: geen voorbeeld', async () => {
  const bytes = await type3Pdf();
  const elders = edit({ originalLineInfo: [{ x: 10, y: 10, width: 50, fontSize: 24, angle: 0, text: 'ABC' }] });
  assert.equal(await V.bouwType3VoorbeeldPdf(await PDFDocument.load(bytes), elders, BOX), null);
  assert.equal(await V.bouwType3VoorbeeldPdf(await PDFDocument.load(bytes), edit({ mcpStrict: true }), BOX), null);
  assert.equal(await V.bouwType3VoorbeeldPdf(await PDFDocument.load(bytes), edit({ baked: true }), BOX), null);
  // Een gewoon font: het CSS-font van PDF.js werkt, dus niets te bouwen.
  const gewoon = await PDFDocument.create();
  const p = gewoon.addPage([300, 200]);
  const hel = await gewoon.embedFont('Helvetica');
  p.node.setFontDictionary(PDFName.of('F1'), hel.ref);
  p.node.set(PDFName.of('Contents'), gewoon.context.register(gewoon.context.flateStream('BT /F1 24 Tf 72 120 Td (ABC) Tj ET')));
  const res = await V.bouwType3VoorbeeldPdf(await PDFDocument.load(await gewoon.save()), edit(), BOX, { tekenTextEdit });
  assert.ok(res === null || res.type3 === false, JSON.stringify(res));
});

// ── Pixels: voorbeeld tegen de opgeslagen pagina ──
let napiCanvas = null;
try { napiCanvas = await import('@napi-rs/canvas'); } catch { napiCanvas = null; }
const require = createRequire(import.meta.url);
const standaardFonts = (() => {
  try { return path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep; } catch { return undefined; }
})();

async function laadPdfjs(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs.getDocument({
    data: bytes, isEvalSupported: false, verbosity: 0, standardFontDataUrl: standaardFonts,
  }).promise;
}

function wit(canvas) {
  const out = napiCanvas.createCanvas(canvas.width, canvas.height);
  const c = out.getContext('2d');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, out.width, out.height);
  c.drawImage(canvas, 0, 0);
  return c.getImageData(0, 0, out.width, out.height);
}

test('de render van het voorbeeld is de render van de opgeslagen pagina (zelfde gebied)',
  { skip: napiCanvas ? false : '@napi-rs/canvas ontbreekt' }, async () => {
    const bytes = await type3Pdf();
    const gemengd = edit({
      newText: 'CAD',
      lineSegments: [[{ text: 'CAD', dx: 0, runs: [
        { text: 'CA', bold: false, italic: false }, { text: 'D', bold: false, italic: false }] }]],
    });
    const bron = await PDFDocument.load(bytes);
    const doc = { pdfDoc: {}, id: 'd1' };
    let klaar;
    const hertekend = new Promise((r) => { klaar = r; });
    V.zetType3Herteken(() => klaar());
    V.zetType3VoorbeeldBronnen({
      pdfLibVan: async () => bron,
      laadPdfjs,
      maakCanvas: (w, h) => napiCanvas.createCanvas(w, h),
      plan: (fn) => { queueMicrotask(fn); return 1; },
    });
    try {
      const px = 3;
      assert.equal(V.type3Voorbeeld(doc, 1, gemengd, BOX, px), null, 'eerst de Helvetica-terugval');
      await hertekend;
      const bmp = V.type3Voorbeeld(doc, 1, gemengd, BOX, px);
      assert.ok(bmp, `status ${V.type3VoorbeeldStatus(doc, 1, 't3')}`);
      assert.equal(bmp.px, px);

      // De opgeslagen pagina, met hetzelfde kader en dezelfde dichtheid.
      const saved = await opgeslagen(bytes, JSON.parse(JSON.stringify(gemengd)));
      const sdoc = await laadPdfjs(await saved.save({ useObjectStreams: false }));
      const spage = await sdoc.getPage(1);
      const canvas = napiCanvas.createCanvas(bmp.canvas.width, bmp.canvas.height);
      await spage.render({
        canvas,
        viewport: spage.getViewport({ scale: px, rotation: 0 }),
        transform: [1, 0, 0, 1, -bmp.kader.x * px, -bmp.kader.y * px],
        background: '#ffffff',
        annotationMode: 0,
      }).promise;
      await sdoc.loadingTask.destroy();

      const a = wit(bmp.canvas);
      const b = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      let inkt = 0; let verschil = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        if (a.data[i] < 128) inkt++;
        if (Math.abs(a.data[i] - b.data[i]) > 32) verschil++;
      }
      assert.ok(inkt > 500, `voorbeeld heeft glyfen (${inkt} donkere pixels)`);
      assert.ok(verschil <= a.data.length / 4 * 0.002, `${verschil} afwijkende pixels`);
      // De vlakke Type3-glyf C (een balk) staat waar de saver hem zet:
      // x 72..85.2, y 120+7.2..120+9.6 → tekenkader (y omlaag vanaf 200).
      const pix = (x, y) => a.data[(Math.round((y - bmp.kader.y) * px) * a.width + Math.round((x - bmp.kader.x) * px)) * 4];
      assert.ok(pix(78, 200 - 128.4) < 64, 'midden van de C-balk is donker');
      assert.ok(pix(78, 200 - 132) > 192, 'boven de C-balk is wit');
    } finally {
      V.vergeetType3Voorbeelden(doc);
      V.zetType3VoorbeeldBronnen({});
      V.zetType3Herteken(null);
    }
  });

// ── Planning met namaakbronnen ──
function namaak() {
  const log = { bouw: [], vernietigd: 0, geannuleerd: 0, geladen: 0, renders: [], timers: [] };
  const pdfjsDoc = () => ({
    destroy: async () => { log.vernietigd++; },
    getPage: async () => ({
      getViewport: ({ scale }) => ({ scale }),
      render: (args) => {
        let los;
        const promise = new Promise((r, f) => { los = { r, f }; });
        const taak = { promise, cancel: () => { log.geannuleerd++; los.f(new Error('cancelled')); } };
        log.renders.push({ args, los, taak });
        return taak;
      },
    }),
  });
  const bronnen = {
    pdfLibVan: async () => ({}),
    bouw: async (bron, e) => { log.bouw.push(e.newText); return log.bouwUitkomst ? log.bouwUitkomst(e) : { type3: true, bytes: new Uint8Array(1) }; },
    laadPdfjs: async () => { log.geladen++; return log.laadUitkomst ? log.laadUitkomst(pdfjsDoc) : pdfjsDoc(); },
    maakCanvas: (w, h) => ({ width: w, height: h }),
    plan: (fn) => { log.timers.push(fn); return log.timers.length; },
    annuleer: (t) => { log.timers[t - 1] = null; },
  };
  V.zetType3VoorbeeldBronnen(bronnen);
  return log;
}
const rust = () => new Promise((r) => setImmediate(r));
async function totDat(fn) {
  for (let i = 0; i < 1000 && !fn(); i++) await rust();
  assert.ok(fn(), 'voorwaarde niet bereikt');
}
const vuur = (log) => { const fns = log.timers.filter(Boolean); log.timers = []; fns.forEach((f) => f()); };

test('debounce: één bouw na de pauze, met de laatste stand van de bewerking', async () => {
  const log = namaak();
  const doc = { pdfDoc: {} };
  try {
    const e = edit();
    assert.equal(V.type3Voorbeeld(doc, 1, e, BOX, 2), null);
    assert.equal(V.type3Voorbeeld(doc, 1, e, BOX, 2), null);
    assert.equal(log.timers.filter(Boolean).length, 1, 'één geplande bouw');
    e.newText = 'CA';
    V.type3Voorbeeld(doc, 1, e, BOX, 2);
    assert.equal(log.timers.filter(Boolean).length, 1, 'oude planning geannuleerd, nieuwe gepland');
    vuur(log);
    await totDat(() => log.renders.length === 1);
    assert.deepEqual(log.bouw, ['CA']);
    log.renders[0].los.r();
    await totDat(() => V.type3VoorbeeldStatus(doc, 1, 't3') === 'klaar' && V.type3Voorbeeld(doc, 1, e, BOX, 2));
    const bmp = V.type3Voorbeeld(doc, 1, e, BOX, 2);
    assert.equal(bmp.px, 2);
    // Kleine zoomstap: geen nieuwe render; grote: wel, het oude blijft tot dan.
    V.type3Voorbeeld(doc, 1, e, BOX, 2.1);
    assert.equal(log.renders.length, 1);
    assert.ok(V.type3Voorbeeld(doc, 1, e, BOX, 6), 'oude bitmap blijft tijdens de nieuwe render');
    await totDat(() => log.renders.length === 2);
    assert.equal(log.renders[1].args.viewport.scale, 6);
  } finally {
    V.vergeetType3Voorbeelden(doc);
    V.zetType3VoorbeeldBronnen({});
  }
});

test('verouderd: een bouw voor een oude stand wordt weggegooid en vrijgegeven', async () => {
  const log = namaak();
  const doc = { pdfDoc: {} };
  let los;
  log.bouwUitkomst = () => new Promise((r) => { los = r; });
  try {
    const e = edit();
    V.type3Voorbeeld(doc, 1, e, BOX, 2);
    vuur(log);
    await totDat(() => !!los);
    const eerste = los;
    los = null;
    // De bewerking verandert terwijl de bouw loopt.
    e.newText = 'BA';
    assert.equal(V.type3Voorbeeld(doc, 1, e, BOX, 2), null);
    eerste({ type3: true, bytes: new Uint8Array(1) });
    for (let i = 0; i < 20; i++) await rust();
    assert.equal(log.geladen, 0, 'de verouderde stand wordt niet eens in PDF.js geladen');
    assert.equal(log.renders.length, 0, 'en niet gerenderd');
    // Nu veroudert de stand terwijl PDF.js laadt: dat document gaat dicht.
    let laadLos;
    log.laadUitkomst = (maak) => new Promise((r) => { laadLos = () => r(maak()); });
    vuur(log);
    await totDat(() => !!los);
    los({ type3: true, bytes: new Uint8Array(1) });
    await totDat(() => !!laadLos);
    e.newText = 'AB';
    assert.equal(V.type3Voorbeeld(doc, 1, e, BOX, 2), null);
    laadLos();
    await totDat(() => log.vernietigd === 1);
    assert.equal(log.renders.length, 0);
    log.laadUitkomst = null;
    vuur(log);
    await totDat(() => !!los);
    los({ type3: true, bytes: new Uint8Array(1) });
    await totDat(() => log.renders.length === 1);
    assert.deepEqual(log.bouw, ['CAB', 'BA', 'AB']);
  } finally {
    V.vergeetType3Voorbeelden(doc);
    V.zetType3VoorbeeldBronnen({});
  }
});

test('vrijgeven: een lopende render wordt afgebroken, het tijdelijke document gesloten', async () => {
  const log = namaak();
  const doc = { pdfDoc: {} };
  try {
    const e = edit();
    V.type3Voorbeeld(doc, 1, e, BOX, 2);
    vuur(log);
    await totDat(() => log.renders.length === 1);
    // Andere bewerkingen op de pagina blijven; deze is weg (opgeslagen).
    V.houdType3Voorbeelden(doc, 2, []);
    assert.equal(log.geannuleerd, 0, 'een andere pagina raakt hem niet');
    V.houdType3Voorbeelden(doc, 1, []);
    assert.equal(log.geannuleerd, 1);
    await totDat(() => log.vernietigd === 1);
    assert.equal(V.type3VoorbeeldStatus(doc, 1, 't3'), null);
    // Een document dat herladen werd (andere pdfDoc): opnieuw bouwen.
    V.type3Voorbeeld(doc, 1, e, BOX, 2);
    vuur(log);
    await totDat(() => log.renders.length === 2);
    log.renders[1].los.r();
    await totDat(() => !!V.type3Voorbeeld(doc, 1, e, BOX, 2));
    doc.pdfDoc = {};
    assert.equal(V.type3Voorbeeld(doc, 1, e, BOX, 2), null);
    await totDat(() => log.vernietigd === 2);
  } finally {
    V.vergeetType3Voorbeelden(doc);
    V.zetType3VoorbeeldBronnen({});
  }
});

test('terugval: mislukte bouw, geen Type3, export zonder planning', async () => {
  const log = namaak();
  const doc = { pdfDoc: {} };
  try {
    log.bouwUitkomst = () => { throw new Error('kapot'); };
    const fout = console.warn;
    console.warn = () => {};
    try {
      V.type3Voorbeeld(doc, 1, edit(), BOX, 2);
      vuur(log);
      await totDat(() => V.type3VoorbeeldStatus(doc, 1, 't3') === 'mislukt');
    } finally { console.warn = fout; }
    assert.equal(V.type3Voorbeeld(doc, 1, edit(), BOX, 2), null);
    assert.equal(log.timers.filter(Boolean).length, 0, 'niet steeds opnieuw proberen');

    log.bouwUitkomst = () => ({ type3: false });
    V.type3Voorbeeld(doc, 1, edit({ id: 'gewoon' }), BOX, 2);
    vuur(log);
    await totDat(() => V.type3VoorbeeldStatus(doc, 1, 'gewoon') === 'nvt');
    assert.equal(log.renders.length, 0);

    // Afdruk/export: alleen uit de cache, niets plannen.
    assert.equal(V.type3Voorbeeld(doc, 1, edit({ id: 'uit' }), BOX, 2, { plannen: false }), null);
    assert.equal(V.type3VoorbeeldStatus(doc, 1, 'uit'), null);
    // Records zonder origineel, opgeslagen of via MCP: nooit.
    for (const e of [edit({ id: 'n', originalText: '' }), edit({ id: 'b', baked: true }), edit({ id: 'm', mcpStrict: true })]) {
      assert.equal(V.type3Voorbeeld(doc, 1, e, BOX, 2), null);
      assert.equal(V.type3VoorbeeldStatus(doc, 1, e.id), null);
    }
  } finally {
    V.vergeetType3Voorbeelden(doc);
    V.zetType3VoorbeeldBronnen({});
  }
});

test('omhullende: ruim om de regel, ook gedraaid', () => {
  const o = V.voorbeeldOmhullende(edit(), 0, 200);
  assert.ok(o.x <= 72 - 10 && o.x + o.width >= 72 + 50.4);
  assert.ok(o.y <= 200 - 120 - 24 && o.y + o.height >= 200 - 120 + 5);
  const g = V.voorbeeldOmhullende(edit({ textAngle: 90 }), 0, 200);
  assert.ok(g.height > g.width, JSON.stringify(g));
  assert.equal(V.voorbeeldOmhullende(edit({ newText: '' }), 0, 200), null);
});

test('de painter gebruikt het voorbeeld en geeft het vrij', async () => {
  const { readFile } = await import('node:fs/promises');
  const bron = (await readFile(new URL('../annotations/rendering.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  assert.match(bron, /type3Voorbeeld\(doc, pageNum, edit, paginaBox/);
  assert.match(bron, /houdType3Voorbeelden\(doc, pageNum, type3Sleutels\)/);
  assert.match(bron, /zetType3Herteken\(hertekenTekstBewerkingen\)/);
  const release = (await readFile(new URL('../pdf/document-release.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  assert.match(release, /vergeetType3Voorbeelden\(gesloten\)/);
});
