import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normaliseerNulpunt, coordinaatTovNulpunt, nulpuntLinksonder, nulpuntUitOnderlegger,
  nulpuntNaarJson, nulpuntUitJson, herschikNulpunten, paginaNulpunt,
} from './coord-nulpunt.js';
import { modelNulpuntInPagina } from '../pdf/pdf-viewports.js';

test('zonder nulpunt tellen coördinaten vanaf linksboven, y omlaag', () => {
  assert.deepEqual(coordinaatTovNulpunt(100, 50, null), { x: 100, y: 50 });
});

test('met nulpunt tellen ze daarvandaan, y omhoog', () => {
  const n = { x: 10, y: 200, yUp: true };
  assert.deepEqual(coordinaatTovNulpunt(110, 150, n), { x: 100, y: 50 });
  assert.deepEqual(coordinaatTovNulpunt(10, 200, n), { x: 0, y: 0 });
});

test('yUp uit: y blijft omlaag vanaf het nulpunt', () => {
  assert.deepEqual(coordinaatTovNulpunt(30, 80, { x: 10, y: 20, yUp: false }), { x: 20, y: 60 });
});

test('linksonder van een pagina van 800 hoog', () => {
  assert.deepEqual(nulpuntLinksonder(800), { x: 0, y: 800, yUp: true });
  assert.equal(nulpuntLinksonder(0), null);
});

test('ongeldige nulpunten worden genegeerd', () => {
  assert.equal(normaliseerNulpunt({ x: NaN, y: 1 }), null);
  assert.equal(normaliseerNulpunt(null), null);
  assert.equal(paginaNulpunt({ coordOrigins: { 2: { x: 1, y: 2 } } }, 1), null);
  assert.deepEqual(paginaNulpunt({ coordOrigins: { 2: { x: 1, y: 2 } } }, 2), { x: 1, y: 2, yUp: true });
});

test('JSON in het bestand en terug', () => {
  const n = { x: 12.5, y: 700, yUp: true };
  assert.deepEqual(nulpuntUitJson(nulpuntNaarJson(n)), n);
  assert.equal(nulpuntUitJson('kapot'), null);
  assert.equal(nulpuntNaarJson(null), null);
});

test('het nulpunt van de onderlegger komt uit de eerste viewport met een model', () => {
  const n = nulpuntUitOnderlegger([{}, { modelNulpunt: { x: 5, y: 6 } }]);
  assert.deepEqual(n, { x: 5, y: 6, yUp: true });
  assert.equal(nulpuntUitOnderlegger([{ heeftModelMatrix: true }]), null);
  assert.equal(nulpuntUitOnderlegger(undefined), null);
});

test('modelmatrix: het punt dat naar (0, 0) gaat', () => {
  // model = 2·pagina − (100, 40): pagina (50, 20) wordt model (0, 0).
  assert.deepEqual(modelNulpuntInPagina([2, 0, 0, 2, -100, -40]), { x: 50, y: 20 });
  // Gedraaid of gespiegeld: geen nulpunt.
  assert.equal(modelNulpuntInPagina([0, 1, -1, 0, 0, 0]), null);
  assert.equal(modelNulpuntInPagina([1, 0, 0, -1, 0, 0]), null);
  assert.equal(modelNulpuntInPagina([1, 0, 0, 1, null, 0]), null);
});

test('nulpunten verhuizen mee met de pagina’s', () => {
  const uit = herschikNulpunten({ 1: { x: 1, y: 1, yUp: true }, 2: { x: 2, y: 2, yUp: true } }, { 1: 3, 2: null });
  assert.deepEqual(Object.keys(uit), ['3']);
});

test('het nulpunt reist mee in het bestand', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const { schrijfNulpunt, leesNulpunten } = await import('../pdf/schaal-in-pdf.js');
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]);
  doc.addPage([600, 800]);
  schrijfNulpunt(doc.getPage(1), { x: 10, y: 790, yUp: true });
  const bytes = await doc.save();
  const terug = leesNulpunten(await PDFDocument.load(bytes));
  assert.deepEqual(terug, { 2: { x: 10, y: 790, yUp: true } });
  schrijfNulpunt(doc.getPage(1), null);
  assert.deepEqual(leesNulpunten(await PDFDocument.load(await doc.save())), {});
});
