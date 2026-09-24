// Annotatielagen (#468): het model. Een document heeft een lijst benoemde
// lagen; elke annotatie hoort bij een laag, en zonder `layer` bij de
// standaardlaag — zodat bestaande documenten ongewijzigd werken.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_LAYER_ID,
  getLayers,
  ensureLayers,
  findLayer,
  layerIdOf,
  layerOf,
  resolveLayer,
  nextLayerName,
  addLayer,
  renameLayer,
  updateLayer,
  moveLayer,
  deleteLayer,
  annotationsOnLayer,
  assignLayer,
  currentLayerId,
  setCurrentLayer,
  layerForNewAnnotation,
  countByLayer,
  layersInUse,
  layersForSave,
  isLayerHidden,
  isLayerLocked,
  isLayerPrintable,
  layerDisplayName,
} from './annotatie-lagen.js';

const leegDoc = () => ({ annotations: [] });

// --- de standaardlaag ------------------------------------------------------

test('een document zonder lagen heeft alleen de standaardlaag', () => {
  const lagen = getLayers(leegDoc());
  assert.equal(lagen.length, 1);
  assert.equal(lagen[0].id, DEFAULT_LAYER_ID);
  assert.equal(lagen[0].visible, true);
  assert.equal(lagen[0].printable, true);
  assert.equal(lagen[0].locked, false);
});

test('getLayers laat het document ongemoeid; ensureLayers schrijft de lijst', () => {
  const doc = leegDoc();
  getLayers(doc);
  assert.equal(doc.annotationLayers, undefined);
  const lagen = ensureLayers(doc);
  assert.equal(doc.annotationLayers, lagen);
  assert.equal(lagen[0].id, DEFAULT_LAYER_ID);
});

test('rommel in de lijst wordt opgeschoond, dubbele ids verdwijnen', () => {
  const doc = {
    annotations: [],
    annotationLayers: [
      null, 'x', { id: '' }, { id: 'a', name: 'A' }, { id: 'a', name: 'nog eens A' },
      { id: 'b', name: '  B  ', visible: 0, locked: 1, printable: false, color: '#FF0000' },
      { id: 'c', name: 'C', color: 'rood' },
    ],
  };
  const lagen = getLayers(doc);
  assert.deepEqual(lagen.map((l) => l.id), [DEFAULT_LAYER_ID, 'a', 'b', 'c']);
  const b = lagen.find((l) => l.id === 'b');
  assert.equal(b.name, 'B');
  assert.equal(b.visible, false);
  assert.equal(b.locked, true);
  assert.equal(b.printable, false);
  assert.equal(b.color, '#ff0000');
  assert.equal(lagen.find((l) => l.id === 'c').color, null, 'geen geldige kleur');
});

test('de standaardlaag houdt haar plek als ze al in de lijst staat', () => {
  const doc = { annotations: [], annotationLayers: [{ id: 'a', name: 'A' }, { id: DEFAULT_LAYER_ID, name: 'x' }] };
  const lagen = getLayers(doc);
  assert.deepEqual(lagen.map((l) => l.id), ['a', DEFAULT_LAYER_ID]);
  assert.equal(lagen[1].name, '', 'de standaardlaag heeft geen eigen naam');
});

test('zonder layer hoort een annotatie bij de standaardlaag', () => {
  assert.equal(layerIdOf({}), DEFAULT_LAYER_ID);
  assert.equal(layerIdOf({ layer: '' }), DEFAULT_LAYER_ID);
  assert.equal(layerIdOf({ layer: 'a' }), 'a');
  assert.equal(layerIdOf(null), DEFAULT_LAYER_ID);
});

test('een onbekende laag valt terug op de standaardlaag', () => {
  const doc = { annotations: [], annotationLayers: [{ id: 'a', name: 'A', visible: false }] };
  assert.equal(layerOf(doc, { layer: 'a' }).id, 'a');
  assert.equal(layerOf(doc, { layer: 'weg' }).id, DEFAULT_LAYER_ID);
  assert.equal(layerOf(doc, {}).id, DEFAULT_LAYER_ID);
  assert.equal(findLayer(doc, 'weg'), null);
});

// --- toevoegen, hernoemen, eigenschappen -----------------------------------

test('een laag toevoegen: unieke naam, eigen id, standaardwaarden', () => {
  const doc = leegDoc();
  const r = addLayer(doc, { name: 'Constructie' });
  assert.equal(r.ok, true);
  assert.notEqual(r.layer.id, DEFAULT_LAYER_ID);
  assert.equal(r.layer.name, 'Constructie');
  assert.equal(r.layer.visible, true);
  assert.equal(r.layer.printable, true);
  assert.equal(r.layer.locked, false);
  assert.deepEqual(getLayers(doc).map((l) => l.name), ['', 'Constructie']);

  const r2 = addLayer(doc, { name: 'Ronde 2' });
  assert.notEqual(r2.layer.id, r.layer.id);
});

test('namen zijn uniek, ongeacht hoofdletters en spaties; leeg mag niet', () => {
  const doc = leegDoc();
  addLayer(doc, { name: 'Constructie' });
  assert.deepEqual(addLayer(doc, { name: ' constructie ' }), { ok: false, error: 'name-taken' });
  assert.deepEqual(addLayer(doc, { name: '   ' }), { ok: false, error: 'name-empty' });
  assert.deepEqual(addLayer(doc, {}), { ok: false, error: 'name-empty' });
});

test('een meegegeven id wordt gebruikt, een bezet id niet', () => {
  const doc = leegDoc();
  assert.equal(addLayer(doc, { id: 'l1', name: 'A' }).layer.id, 'l1');
  assert.deepEqual(addLayer(doc, { id: 'l1', name: 'B' }), { ok: false, error: 'id-taken' });
  assert.deepEqual(addLayer(doc, { id: DEFAULT_LAYER_ID, name: 'C' }), { ok: false, error: 'id-taken' });
});

test('de volgende vrije naam telt door', () => {
  const doc = leegDoc();
  assert.equal(nextLayerName(doc, 'Laag'), 'Laag 1');
  addLayer(doc, { name: 'Laag 1' });
  addLayer(doc, { name: 'laag 3' });
  assert.equal(nextLayerName(doc, 'Laag'), 'Laag 2');
  addLayer(doc, { name: 'Laag 2' });
  assert.equal(nextLayerName(doc, 'Laag'), 'Laag 4');
});

test('hernoemen: uniek, niet leeg, en de standaardlaag heeft een vaste naam', () => {
  const doc = leegDoc();
  const a = addLayer(doc, { name: 'A' }).layer;
  addLayer(doc, { name: 'B' });
  assert.deepEqual(renameLayer(doc, a.id, 'b'), { ok: false, error: 'name-taken' });
  assert.deepEqual(renameLayer(doc, a.id, ''), { ok: false, error: 'name-empty' });
  assert.deepEqual(renameLayer(doc, a.id, ' a '), { ok: true }, 'eigen naam anders geschreven mag');
  assert.equal(findLayer(doc, a.id).name, 'a');
  assert.deepEqual(renameLayer(doc, DEFAULT_LAYER_ID, 'X'), { ok: false, error: 'default-layer' });
  assert.deepEqual(renameLayer(doc, 'weg', 'X'), { ok: false, error: 'not-found' });
});

test('eigenschappen bijwerken: alleen zichtbaar, afdrukbaar, vergrendeld en kleur', () => {
  const doc = leegDoc();
  const a = addLayer(doc, { name: 'A' }).layer;
  const r = updateLayer(doc, a.id, { visible: false, locked: true, printable: false, color: '#00FF00', id: 'x', name: 'Z' });
  assert.equal(r.ok, true);
  const l = findLayer(doc, a.id);
  assert.equal(l.visible, false);
  assert.equal(l.locked, true);
  assert.equal(l.printable, false);
  assert.equal(l.color, '#00ff00');
  assert.equal(l.name, 'A', 'naam gaat via renameLayer');
  assert.equal(updateLayer(doc, DEFAULT_LAYER_ID, { visible: false }).ok, true, 'ook de standaardlaag');
  assert.equal(findLayer(doc, DEFAULT_LAYER_ID).visible, false);
  assert.deepEqual(updateLayer(doc, 'weg', { visible: false }), { ok: false, error: 'not-found' });
  updateLayer(doc, a.id, { color: null });
  assert.equal(findLayer(doc, a.id).color, null);
});

// --- volgorde --------------------------------------------------------------

test('een laag verplaatsen in de lijst', () => {
  const doc = leegDoc();
  const a = addLayer(doc, { name: 'A' }).layer;
  const b = addLayer(doc, { name: 'B' }).layer;
  assert.deepEqual(getLayers(doc).map((l) => l.name), ['', 'A', 'B']);
  assert.equal(moveLayer(doc, b.id, 0).ok, true);
  assert.deepEqual(getLayers(doc).map((l) => l.id), [b.id, DEFAULT_LAYER_ID, a.id]);
  moveLayer(doc, b.id, 99);
  assert.deepEqual(getLayers(doc).map((l) => l.id), [DEFAULT_LAYER_ID, a.id, b.id], 'buiten bereik = achteraan');
  assert.deepEqual(moveLayer(doc, 'weg', 0), { ok: false, error: 'not-found' });
});

// --- verwijderen en toewijzen ----------------------------------------------

test('toewijzen zet layer, en de standaardlaag haalt het veld weg', () => {
  const doc = leegDoc();
  const a = addLayer(doc, { name: 'A' }).layer;
  const x = { id: '1' };
  const y = { id: '2', layer: a.id };
  assert.equal(assignLayer([x, y], a.id), 1, 'één annotatie veranderde');
  assert.equal(x.layer, a.id);
  assert.equal(assignLayer([x, y], DEFAULT_LAYER_ID), 2);
  assert.equal('layer' in x, false);
  assert.equal('layer' in y, false);
});

test('annotaties op een laag, met de onbekende bij de standaardlaag', () => {
  const doc = leegDoc();
  const a = addLayer(doc, { name: 'A' }).layer;
  const p = { id: 'p', layer: a.id };
  const q = { id: 'q' };
  const r = { id: 'r', layer: 'weg' };
  doc.annotations.push(p, q, r);
  assert.deepEqual(annotationsOnLayer(doc, a.id), [p]);
  assert.deepEqual(annotationsOnLayer(doc, DEFAULT_LAYER_ID), [q, r]);
  const tel = countByLayer(doc);
  assert.equal(tel.get(a.id), 1);
  assert.equal(tel.get(DEFAULT_LAYER_ID), 2);
});

test('een laag verwijderen; de standaardlaag kan niet weg', () => {
  const doc = leegDoc();
  const a = addLayer(doc, { name: 'A' }).layer;
  setCurrentLayer(doc, a.id);
  assert.deepEqual(deleteLayer(doc, DEFAULT_LAYER_ID), { ok: false, error: 'default-layer' });
  assert.deepEqual(deleteLayer(doc, 'weg'), { ok: false, error: 'not-found' });
  assert.deepEqual(deleteLayer(doc, a.id), { ok: true });
  assert.deepEqual(getLayers(doc).map((l) => l.id), [DEFAULT_LAYER_ID]);
  assert.equal(currentLayerId(doc), DEFAULT_LAYER_ID, 'de huidige laag gaat terug naar de standaardlaag');
});

// --- huidige laag ----------------------------------------------------------

test('de huidige laag: standaard, instelbaar, en nooit een onbekende', () => {
  const doc = leegDoc();
  assert.equal(currentLayerId(doc), DEFAULT_LAYER_ID);
  assert.equal(layerForNewAnnotation(doc), undefined, 'standaardlaag = geen veld');
  const a = addLayer(doc, { name: 'A' }).layer;
  assert.equal(setCurrentLayer(doc, a.id).ok, true);
  assert.equal(currentLayerId(doc), a.id);
  assert.equal(layerForNewAnnotation(doc), a.id);
  assert.deepEqual(setCurrentLayer(doc, 'weg'), { ok: false, error: 'not-found' });
  doc.currentLayerId = 'weg';
  assert.equal(currentLayerId(doc), DEFAULT_LAYER_ID);
  assert.equal(layerForNewAnnotation(null), undefined);
});

// --- opzoeken voor MCP en XFDF ---------------------------------------------

test('een laag opzoeken op id of naam; de standaardlaag ook op haar weergavenaam', () => {
  const doc = leegDoc();
  const a = addLayer(doc, { name: 'Constructie' }).layer;
  assert.equal(resolveLayer(doc, a.id).id, a.id);
  assert.equal(resolveLayer(doc, ' CONSTRUCTIE ').id, a.id);
  assert.equal(resolveLayer(doc, DEFAULT_LAYER_ID).id, DEFAULT_LAYER_ID);
  assert.equal(resolveLayer(doc, 'Standaard', { defaultName: 'Standaard' }).id, DEFAULT_LAYER_ID);
  assert.equal(resolveLayer(doc, 'Onbekend'), null);
  assert.equal(resolveLayer(doc, ''), null);
  assert.equal(resolveLayer(doc, 42), null);
});

test('de weergavenaam van de standaardlaag komt uit de vertaling', () => {
  assert.equal(layerDisplayName({ id: DEFAULT_LAYER_ID, name: '' }, 'Standaard'), 'Standaard');
  assert.equal(layerDisplayName({ id: 'a', name: 'A' }, 'Standaard'), 'A');
});

// --- wat de weergave en de uitvoer ervan vragen -----------------------------

test('verborgen, vergrendeld en afdrukbaar per annotatie, via haar laag', () => {
  const doc = leegDoc();
  const uit = addLayer(doc, { name: 'Uit', visible: false }).layer;
  const slot = addLayer(doc, { name: 'Slot', locked: true }).layer;
  const papier = addLayer(doc, { name: 'Niet op papier', printable: false }).layer;
  assert.equal(isLayerHidden(doc, { layer: uit.id }), true);
  assert.equal(isLayerHidden(doc, { layer: slot.id }), false);
  assert.equal(isLayerLocked(doc, { layer: slot.id }), true);
  assert.equal(isLayerLocked(doc, { layer: uit.id }), false);
  assert.equal(isLayerPrintable(doc, { layer: papier.id }), false);
  assert.equal(isLayerPrintable(doc, { layer: slot.id }), true);
  // Zonder lagen verandert er niets.
  const kaal = leegDoc();
  assert.equal(isLayerHidden(kaal, {}), false);
  assert.equal(isLayerLocked(kaal, {}), false);
  assert.equal(isLayerPrintable(kaal, {}), true);
  assert.equal(isLayerHidden(null, {}), false);
});

// --- wat er bewaard moet worden ---------------------------------------------

test('een document zonder lagen heeft niets te bewaren', () => {
  assert.equal(layersInUse(leegDoc()), false);
  assert.equal(layersForSave(leegDoc()), null);
  // Alleen de standaardlaag, in haar standaardstand: nog steeds niets.
  const doc = leegDoc();
  ensureLayers(doc);
  assert.equal(layersInUse(doc), false);
  assert.equal(layersForSave(doc), null);
});

test('een eigen laag, of een gewijzigde standaardlaag, moet wel bewaard worden', () => {
  const doc = leegDoc();
  addLayer(doc, { name: 'A' });
  assert.equal(layersInUse(doc), true);
  assert.deepEqual(layersForSave(doc).map((l) => l.name), ['', 'A']);

  const doc2 = leegDoc();
  updateLayer(doc2, DEFAULT_LAYER_ID, { visible: false });
  assert.equal(layersInUse(doc2), true);

  const doc3 = leegDoc();
  ensureLayers(doc3);
  addLayer(doc3, { name: 'B' });
  setCurrentLayer(doc3, getLayers(doc3)[1].id);
  deleteLayer(doc3, getLayers(doc3)[1].id);
  assert.equal(layersInUse(doc3), false, 'alles weer terug = niets te bewaren');
});
