// De weergaveregels achter view-filters.js (#333, #468). Eén predicaat voor
// het tekenen én de raakdetectie: wat niet getekend wordt, is ook niet
// aanklikbaar. Een vergrendelde laag wordt wél getekend, maar is niet
// selecteerbaar of verplaatsbaar.

import assert from 'node:assert/strict';
import basisTest from 'node:test';
// Ook tegen documenten die, zoals in de app, bij toewijzen een kopie bewaren.
import { perDocumentsoort } from './documentsoorten.testhulp.mjs';
const { test, maakDoc } = perDocumentsoort(basisTest);
import { readFileSync } from 'node:fs';

import { hiddenInView, pickableInView, hiddenInOutput } from './view-filter-rules.js';
import { addLayer, updateLayer, DEFAULT_LAYER_ID } from './annotatie-lagen.js';

function docMetLagen() {
  const doc = maakDoc();
  const uit = addLayer(doc, { name: 'Uit', visible: false }).layer;
  const slot = addLayer(doc, { name: 'Slot', locked: true }).layer;
  const gewoon = addLayer(doc, { name: 'Gewoon' }).layer;
  return { doc, uit, slot, gewoon };
}

const bron = (doc, extra = {}) => ({ doc, hiddenTypes: new Set(), isStatusHidden: () => false, ...extra });

test('een uitgezette laag wordt niet getekend en is niet aanklikbaar', () => {
  const { doc, uit } = docMetLagen();
  const ann = { type: 'box', layer: uit.id };
  assert.equal(hiddenInView(ann, bron(doc)), true);
  assert.equal(pickableInView(ann, bron(doc)), false);
});

test('een vergrendelde laag wordt getekend, maar is niet aanklikbaar', () => {
  const { doc, slot } = docMetLagen();
  const ann = { type: 'box', layer: slot.id };
  assert.equal(hiddenInView(ann, bron(doc)), false);
  assert.equal(pickableInView(ann, bron(doc)), false);
});

test('een gewone laag: getekend en aanklikbaar', () => {
  const { doc, gewoon } = docMetLagen();
  const ann = { type: 'box', layer: gewoon.id };
  assert.equal(hiddenInView(ann, bron(doc)), false);
  assert.equal(pickableInView(ann, bron(doc)), true);
});

test('weer aangezet komt de annotatie ongewijzigd terug', () => {
  const { doc, uit } = docMetLagen();
  const ann = { type: 'box', layer: uit.id, x: 1 };
  const voor = JSON.stringify(ann);
  assert.equal(hiddenInView(ann, bron(doc)), true);
  updateLayer(doc, uit.id, { visible: true });
  assert.equal(hiddenInView(ann, bron(doc)), false);
  assert.equal(JSON.stringify(ann), voor, 'het filter raakt de annotatie niet aan');
});

test('de standaardlaag uit of op slot geldt voor annotaties zonder laag', () => {
  const doc = maakDoc();
  updateLayer(doc, DEFAULT_LAYER_ID, { visible: false });
  assert.equal(hiddenInView({ type: 'box' }, bron(doc)), true);
  updateLayer(doc, DEFAULT_LAYER_ID, { visible: true, locked: true });
  assert.equal(hiddenInView({ type: 'box' }, bron(doc)), false);
  assert.equal(pickableInView({ type: 'box' }, bron(doc)), false);
});

test('een document zonder lagen gedraagt zich zoals voorheen', () => {
  const doc = maakDoc();
  assert.equal(hiddenInView({ type: 'box' }, bron(doc)), false);
  assert.equal(pickableInView({ type: 'box' }, bron(doc)), true);
  assert.equal(hiddenInView({ type: 'box', layer: 'onbekend' }, bron(doc)), false);
  // Zonder document (nog niets open) ook niets verborgen.
  assert.equal(hiddenInView({ type: 'box' }, bron(null)), false);
  assert.equal(hiddenInView(null, bron(doc)), false);
  assert.equal(pickableInView(null, bron(doc)), false);
});

test('de bestaande filters blijven werken: hidden-vlag, soort, status', () => {
  const doc = maakDoc();
  assert.equal(hiddenInView({ type: 'box', hidden: true }, bron(doc)), true);
  assert.equal(hiddenInView({ type: 'box' }, bron(doc, { hiddenTypes: new Set(['box']) })), true);
  assert.equal(hiddenInView({ type: 'box', status: 'rejected' },
    bron(doc, { isStatusHidden: (a) => a.status === 'rejected' })), true);
  assert.equal(pickableInView({ type: 'box', hidden: true }, bron(doc)), false);
});

// De raakdetectie moet hetzelfde predicaat gebruiken: geen eigen, afwijkende
// regel per plek. Dit zijn de drie plekken die annotaties uitkiezen.
basisTest('klikken, het selectiekader en "alles selecteren" vragen of een annotatie aanklikbaar is', () => {
  const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
  for (const pad of ['./geometry.js', '../tools/tools/select-tool.js', '../core/stores/selection-helpers.ts']) {
    const bronTekst = lees(pad);
    assert.match(bronTekst, /isAnnotationPickableInView\(/, `${pad} gebruikt het aanklikbaar-predicaat`);
    assert.doesNotMatch(bronTekst, /isAnnotationHiddenInView\(/, `${pad} gebruikt niet meer alleen het weergavepredicaat`);
  }
});

// --- afdrukken en exporteren ------------------------------------------------

test('een uitgezette of niet-afdrukbare laag komt niet in de afdruk of export', () => {
  const doc = maakDoc();
  const uit = addLayer(doc, { name: 'Uit', visible: false }).layer;
  const scherm = addLayer(doc, { name: 'Alleen scherm', printable: false }).layer;
  const papier = addLayer(doc, { name: 'Papier' }).layer;
  assert.equal(hiddenInOutput({ type: 'box', layer: uit.id }, bron(doc)), true);
  assert.equal(hiddenInOutput({ type: 'box', layer: scherm.id }, bron(doc)), true);
  assert.equal(hiddenInView({ type: 'box', layer: scherm.id }, bron(doc)), false, 'op het scherm wel zichtbaar');
  assert.equal(hiddenInOutput({ type: 'box', layer: papier.id }, bron(doc)), false);
  // Vergrendeld is geen reden om niet af te drukken.
  const slot = addLayer(doc, { name: 'Slot', locked: true }).layer;
  assert.equal(hiddenInOutput({ type: 'box', layer: slot.id }, bron(doc)), false);
  // Zonder lagen: alles zoals voorheen.
  assert.equal(hiddenInOutput({ type: 'box' }, bron(maakDoc())), false);
});

basisTest('de uitvoer (afdruk, export, printvoorbeeld) vraagt het uitvoerpredicaat, het scherm niet', () => {
  const rendering = readFileSync(new URL('./rendering.js', import.meta.url), 'utf8');
  const teken = rendering.slice(rendering.indexOf('export function drawAnnotation('));
  const kop = teken.slice(0, teken.indexOf('const _evHalftone'));
  assert.match(kop, /_lagen\s*\?\s*isAnnotationHiddenInOutput\(annotation\)\s*:\s*isAnnotationHiddenInView\(annotation\)/);
  // Het printpad en de exports gaan door renderMarkeringenOffscreen, dat
  // altijd in uitvoermodus tekent.
  const exporter = readFileSync(new URL('../pdf/exporter.js', import.meta.url), 'utf8');
  assert.match(exporter, /const lagen = \{ uitvoer: true, markeringen \};/);
});
