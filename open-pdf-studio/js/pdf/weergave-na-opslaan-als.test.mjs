import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

// Opslaan als na tekstbewerkingen (GitHub #673). Na het inbakken herlaadt de
// saver het document uit een werkkopie (%TEMP%\opds-edit-<ms>.pdf); de
// viewport tekent dan uit dat pad. savePDFAs zette doc.filePath daarna op het
// nieuwe bestand en ruimde de werkkopie op, maar de viewport bleef het oude
// pad aanvragen: de PDFium-worker meldde `stat …opds-edit-….pdf` en de pagina
// hield zijn laatste bitmap (595×842 op schaal 1), wazig op elke zoom.
//
// wisselBestandspad() zet de viewport om naar het opgeslagen bestand, zonder
// opnieuw in te passen: zoom en uitsnede blijven, en elke volgende bitmap
// komt uit het nieuwe pad.
//
// De echte pdf-viewport.js draait hier onder node met een nep-canvas en
// vervangen app-modules (zie pdf-viewport-test-hooks.mjs).

globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

const container = { clientWidth: 800, clientHeight: 600, querySelector: () => null };
globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
globalThis.document = {
  getElementById: (id) => (id === 'pdf-container' ? container : null),
  querySelector: () => null,
};

const aanvragen = [];
globalThis.__vpTest = {
  impl: {
    ensureBitmapForCurrentView: () => { aanvragen.push(vp.viewport.filePath); },
    ensureTileForCurrentView: () => {},
  },
};

register('./pdf-viewport-test-hooks.mjs', import.meta.url);
const vp = await import('./pdf-viewport.js');
const { viewport } = vp;

const nepCtx = new Proxy({}, {
  get: (doel, sleutel) => (sleutel in doel ? doel[sleutel] : () => {}),
  set: (doel, sleutel, waarde) => { doel[sleutel] = waarde; return true; },
});
const canvas = { width: 0, height: 0, style: {}, getContext: () => nepCtx };

const WERK = 'C:/Temp/opds-edit-1761210000000.pdf';
const DOEL = 'C:/Docs/kopie.pdf';
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
// De aanvraag loopt via een dynamische import: wachten op de voorwaarde zelf,
// want onder een belaste testrun is een vaste pauze soms te kort.
async function wachtTot(voorwaarde, grens = 10000) {
  const einde = Date.now() + grens;
  while (!voorwaarde() && Date.now() < einde) await wacht(5);
}

function opzet() {
  vp.initViewport(canvas, () => {});
  vp.setPage(WERK, 1, 595, 842, 0, 0, 0, 0);
  viewport.pageType = 'raster';
  vp.setZoomAtPoint(400, 300, 2);
}

test('de viewport tekent na de wissel uit het opgeslagen bestand, met dezelfde zoom', async () => {
  opzet();
  const voor = { zoom: viewport.zoom, x: viewport.offsetX, y: viewport.offsetY };
  viewport.currentTile = { oud: true };
  aanvragen.length = 0;

  assert.equal(vp.wisselBestandspad(WERK, DOEL), true);
  assert.equal(viewport.filePath, DOEL);
  assert.deepEqual({ zoom: viewport.zoom, x: viewport.offsetX, y: viewport.offsetY }, voor, 'niet opnieuw ingepast');
  assert.equal(viewport.currentTile, null, 'de scherpe tegel van het oude pad vervalt');
  assert.equal(viewport.dirty, true);

  // De orchestrator haalt meteen een verse bitmap, uit het nieuwe pad.
  await wachtTot(() => aanvragen.length > 0);
  await wacht(100); // ook late aanvragen meenemen in de controle hieronder
  assert.ok(aanvragen.length > 0, 'een nieuwe bitmap wordt aangevraagd');
  assert.ok(aanvragen.every((p) => p === DOEL), `alleen uit het opgeslagen bestand: ${aanvragen}`);

  // En een zoomwissel daarna vraagt ook uit het nieuwe pad.
  aanvragen.length = 0;
  vp.setZoomAtPoint(400, 300, 4);
  await wachtTot(() => aanvragen.length > 0);
  await wacht(100); // ook late aanvragen meenemen in de controle hieronder
  assert.ok(aanvragen.length > 0);
  assert.ok(aanvragen.every((p) => p === DOEL));

  // De paginanavigatie daarna is gewoon "zelfde document": geen nieuwe fit.
  vp.setPage(DOEL, 1, 595, 842, 0, 0, 0, 0);
  assert.equal(viewport.zoom, 4);
});

test('toont de viewport een ander document, dan verandert er niets', () => {
  opzet();
  assert.equal(vp.wisselBestandspad('C:/Docs/ander.pdf', DOEL), false);
  assert.equal(viewport.filePath, WERK);
  assert.equal(vp.wisselBestandspad(WERK, WERK), false);
  assert.equal(vp.wisselBestandspad(WERK, null), false);
  assert.equal(viewport.filePath, WERK);
});
