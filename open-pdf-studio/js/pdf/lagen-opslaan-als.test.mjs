// Opslaan als houdt de laagstand vast (#684).
//
// De geschakelde laagstand (lagen-schakelen.js) hoort bij één pdf.js-document
// en één pad. Opslaan als gaf het document een nieuw pad met dezelfde inhoud,
// maar de stand bleef aan het oude pad hangen en gold daarna als verouderd:
// - een wissel ging verloren en "Als standaard instellen" kon niet meer;
// - na "Als standaard instellen" + Opslaan als toonde het paneel de beginstand
//   van het oude bestand, terwijl het nieuwe bestand de bewaarde stand had;
// - op de desktop bleef Rust het oude pad naar een weergavekopie leiden en
//   tekende het nieuwe pad zonder de wissel.
// Nu verhuist de stand met het document mee naar het nieuwe pad, zoals de
// viewport (wisselBestandspad, #673).
//
// De echte saver (saver-test-hooks.mjs), de echte lagen-schakelen.js, een
// echt pdf.js-document met twee lagen: A staat aan, B staat standaard uit.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();
// Na een wissel tekent lagen-schakelen.js opnieuw via renderer.js, dat bij
// het laden een eigen klok start (de haperingsmelder); die houdt dit proces
// niet open.
const echteSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => { const t = echteSetInterval(...args); t?.unref?.(); return t; };

const { state } = await import('../core/state.js');
const { savePDFAs } = await import('./saver.js');
const lagen = await import('./lagen-schakelen.js');
const { laagstandBasis } = await import('./laagstand.js');
const { pdfjsIdVanRef } = await import('./lagen-boom.js');

const N = PDFName.of;

async function tekening() {
  const pdf = await PDFDocument.create();
  const pagina = pdf.addPage([100, 100]);
  const ctx = pdf.context;
  const a = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('A') }));
  const b = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('B') }));
  pagina.node.set(N('Resources'), ctx.obj({ Properties: { LA: a, LB: b } }));
  pagina.node.set(N('Contents'), ctx.register(ctx.flateStream(
    '/OC /LA BDC 1 0 0 rg 10 10 30 80 re f EMC\n/OC /LB BDC 0 0 1 rg 60 10 30 80 re f EMC\n')));
  pdf.catalog.set(N('OCProperties'), ctx.obj({ OCGs: [a, b], D: { Order: [a, b], OFF: [b] } }));
  return { bytes: await pdf.save(), a: pdfjsIdVanRef(a), b: pdfjsIdVanRef(b) };
}

/** De lagen die in het bestand standaard uit staan (pdf.js-id's). */
async function standaardUit(bytes) {
  const basis = await laagstandBasis(bytes);
  assert.ok(basis, 'het bestand heeft /OCProperties /D');
  const pdf = await PDFDocument.load(bytes);
  const d = pdf.context.lookup(pdf.context.lookup(pdf.catalog.get(N('OCProperties'))).get(N('D')));
  const off = d.get(N('OFF'));
  return off ? pdf.context.lookup(off).asArray().map((r) => pdfjsIdVanRef(r)).sort() : [];
}

/**
 * Een document in de store met een echt pdf.js-document, een echt bestand en
 * een bytes-cache per pad zoals loader.js. `tauri`: het desktoppad, met een
 * vastgelegde set_layer_view en weergavekopieën in de tijdelijke map.
 */
async function harness({ tauri = false } = {}) {
  const map = mkdtempSync(join(tmpdir(), 'opds-lagen-als-'));
  const bron = join(map, 'tekening.pdf').replace(/\\/g, '/');
  const { bytes, a, b } = await tekening();
  writeFileSync(bron, bytes);
  const cache = new Map([[bron, bytes]]);
  const log = { leiding: [] };
  /** pad → kopie waar Rust de renders van dat pad heen leidt */
  const rust = new Map();
  globalThis.window.__TAURI__ = { path: { tempDir: async () => map } };
  globalThis.__saverTest = {
    impl: {
      isTauri: () => tauri,
      invoke: async (cmd, args) => {
        if (cmd === 'set_layer_view') {
          log.leiding.push([args.path, args.view]);
          if (args.view) rust.set(args.path, args.view); else rust.delete(args.path);
        }
      },
      getCachedPdfBytes: (pad) => cache.get(pad),
      setCachedPdfBytes: (pad, b2) => { cache.set(pad, b2); },
      readBinaryFile: async (pad) => readFileSync(pad),
      writeBinaryFile: async (pad, b2) => { writeFileSync(pad, b2); return true; },
      writeBinaryFileAtomic: async (pad, b2) => { writeFileSync(pad, b2); return true; },
      markDocumentSaved: (d) => { d.modified = false; },
      saveFileDialog: async () => null,
    },
  };
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfDoc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  state.documents = [{
    id: 'lagen-als', filePath: bron, fileName: 'tekening.pdf', pdfDoc, annotations: [],
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [], currentPage: 1,
    modified: false, undoStack: [], savedUndoStackLength: 0,
  }];
  state.activeDocumentIndex = 0;
  const doc = state.documents[0];
  return {
    doc, a, b, map, bron, log, rust, cache,
    nieuw: join(map, 'kopie.pdf').replace(/\\/g, '/'),
    // Wat het paneel toont (ui/panels/layers.js): de eigen stand, anders de
    // beginstand van het pdf.js-document.
    zichtbaar: async (id) => (lagen.eigenLaagConfig(doc) || await doc.pdfDoc.getOptionalContentConfig())
      .getGroup(id)?.visible !== false,
    // Wat de saver na het opslaan nog achter de schermen doet (naOpslaan).
    rustig: () => new Promise((r) => setTimeout(r, 50)),
    // Tot de voorwaarde geldt (de weergavekopie wordt op de achtergrond gemaakt).
    tot: async (voorwaarde, ms = 5000) => {
      const eind = Date.now() + ms;
      while (!voorwaarde() && Date.now() < eind) await new Promise((r) => setTimeout(r, 10));
    },
    opruimen: async () => { await pdfDoc.loadingTask.destroy(); rmSync(map, { recursive: true, force: true }); },
  };
}

test('een geschakelde laag blijft geschakeld na Opslaan als, en "Als standaard instellen" blijft kunnen', async () => {
  const h = await harness();
  try {
    assert.equal(await lagen.zetLaagZichtbaar(h.doc, h.a, false), false);
    assert.equal(lagen.heeftAfwijkendeStand(h.doc), true);

    assert.equal(await savePDFAs(h.doc, h.nieuw, { zonderHandtekeningVraag: true }), true);
    await h.rustig();
    assert.equal(h.doc.filePath, h.nieuw);
    // Het paneel bouwt zich op na het opslaan: een verouderde stand zou nu vervallen.
    await lagen.vergeetVerouderdeStand(h.doc);

    assert.equal(await h.zichtbaar(h.a), false, 'het paneel toont de wissel nog');
    assert.equal(await h.zichtbaar(h.b), false);
    assert.equal(lagen.heeftAfwijkendeStand(h.doc), true, '"Als standaard instellen" blijft beschikbaar');
    // De wissel is een weergave: het nieuwe bestand heeft de beginstand van het oude.
    assert.deepEqual(await standaardUit(readFileSync(h.nieuw)), [h.b]);

    // En daarna als standaard bewaren werkt op het nieuwe bestand.
    assert.equal(lagen.markeerStandAlsStandaard(h.doc), true);
    const { savePDF } = await import('./saver.js');
    assert.equal(await savePDF(null, { zonderHandtekeningVraag: true }, h.doc), true);
    await h.rustig();
    assert.deepEqual(await standaardUit(readFileSync(h.nieuw)), [h.a, h.b].sort());
    assert.equal(lagen.heeftAfwijkendeStand(h.doc), false);
  } finally {
    await h.opruimen();
  }
});

test('"Als standaard instellen" + Opslaan als: paneel en nieuw bestand tonen dezelfde stand', async () => {
  const h = await harness();
  try {
    await lagen.zetLaagZichtbaar(h.doc, h.a, false);
    await lagen.zetLaagZichtbaar(h.doc, h.b, true);
    assert.equal(lagen.markeerStandAlsStandaard(h.doc), true);

    assert.equal(await savePDFAs(h.doc, h.nieuw, { zonderHandtekeningVraag: true }), true);
    await h.rustig();
    await lagen.vergeetVerouderdeStand(h.doc);

    // Het nieuwe bestand: A uit, B aan.
    assert.deepEqual(await standaardUit(readFileSync(h.nieuw)), [h.a]);
    // Het paneel: hetzelfde, en het is nu de standaard van het bestand.
    assert.equal(await h.zichtbaar(h.a), false, 'A uit, zoals in het bestand');
    assert.equal(await h.zichtbaar(h.b), true, 'B aan, zoals in het bestand');
    assert.equal(lagen.heeftAfwijkendeStand(h.doc), false, 'de stand is de standaard van het nieuwe bestand');
    // Het oude bestand is niet aangeraakt.
    assert.deepEqual(await standaardUit(readFileSync(h.bron)), [h.b]);
  } finally {
    await h.opruimen();
  }
});

test('desktop: Rust leidt na Opslaan als het nieuwe pad naar een weergavekopie, en het oude niet meer', async () => {
  const h = await harness({ tauri: true });
  try {
    await lagen.zetLaagZichtbaar(h.doc, h.b, true);
    assert.equal(lagen.tekentUitKopie(h.bron), true);
    assert.ok(h.rust.get(h.bron), 'de wissel tekent uit een kopie');

    assert.equal(await savePDFAs(h.doc, h.nieuw, { zonderHandtekeningVraag: true }), true);
    await h.tot(() => h.rust.has(h.nieuw) && !h.rust.has(h.bron));
    await lagen.vergeetVerouderdeStand(h.doc);

    assert.equal(await h.zichtbaar(h.b), true);
    assert.equal(lagen.tekentUitKopie(h.nieuw), true, 'het nieuwe pad tekent de wissel');
    assert.equal(lagen.tekentUitKopie(h.bron), false, 'het oude pad tekent weer zichzelf');
    assert.equal(h.rust.has(h.bron), false, 'Rust leidt het oude pad niet meer om');
    const kopie = h.rust.get(h.nieuw);
    assert.ok(kopie, 'Rust leidt het nieuwe pad naar een kopie');
    // De kopie is het nieuwe bestand met de wissel: geen laag uit.
    assert.deepEqual(await standaardUit(readFileSync(kopie)), []);
  } finally {
    await h.opruimen();
  }
});
