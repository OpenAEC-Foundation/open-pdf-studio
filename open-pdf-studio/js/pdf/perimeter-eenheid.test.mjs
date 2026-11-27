import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFName } from 'pdf-lib';
import { state, opslaan, laad, leegBlad, woordenboeken } from './rondgang.testhulp.mjs';
const { DEFAULT_PREFERENCES } = await import('../core/constants.ts');
const { storeShowProperties, updateAnnotProp, annotProps } = await import('../solid/stores/propertiesStore.js');
const { createMeasurePerimeterAnnotation } = await import('../tools/annotation-creators.js');
const { syncMeasurementAfterEdit } = await import('../annotations/transforms.js');

function setup(extra = {}) {
  state.preferences = { ...DEFAULT_PREFERENCES };
  state.documents = [{ id: 'perimeter', annotations: [], currentPage: 1, pageRotations: {},
    undoStack: [], redoStack: [], selectedAnnotations: [], viewMode: 'single',
    measureScale: { pixelsPerUnit: 0.1, unit: 'mm' }, ...extra }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}
function create() {
  const ann = createMeasurePerimeterAnnotation([{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 250 }]);
  const doc = state.documents[0];
  doc.annotations = [ann]; doc.selectedAnnotation = ann; doc.selectedAnnotations = [ann];
  storeShowProperties(ann);
  return ann;
}

test('Properties converts a calibrated perimeter mm → m → cm without changing physical length', () => {
  setup(); const ann = create();
  assert.equal(ann.measureValue, 2500);
  updateAnnotProp('measureUnit', 'm');
  assert.equal(ann.measureUnit, 'm'); assert.equal(ann.measureScale, 0.01);
  assert.equal(ann.measureValue, 2.5); assert.equal(ann.measureText, '2.50 m');
  assert.equal(annotProps.measureScale, 0.01);
  updateAnnotProp('measureUnit', 'cm');
  assert.equal(ann.measureValue, 250); assert.equal(ann.measureText, '250.0 cm');
  ann.points[2].y += 50;
  syncMeasurementAfterEdit(ann);
  assert.equal(ann.measureValue, 300); assert.equal(ann.measureUnit, 'cm');
  updateAnnotProp('measureScale', '0');
  assert.equal(ann.measureValue, 3000); assert.equal(ann.measureUnit, 'mm');
  assert.equal(annotProps.measureUnit, 'mm');
});

test('manual perimeter preference in meters survives geometry editing', () => {
  setup({ measureScale: null });
  Object.assign(state.preferences, { measurePerimDimUnit: 'm', measurePerimDimScale: 0.01 });
  const ann = create();
  assert.equal(ann.measureUnit, 'm'); assert.equal(ann.measureValue, 2.5);
  ann.points[2].y += 50; syncMeasurementAfterEdit(ann);
  assert.equal(ann.measureUnit, 'm'); assert.equal(ann.measureValue, 3);
});

test('selected perimeter unit and PDF /Measure agree across two save/reopen cycles', async () => {
  const doc = setup(); const ann = create(); updateAnnotProp('measureUnit', 'm');
  let bytes = await leegBlad(); let models = [ann];
  for (let i = 0; i < 2; i++) {
    bytes = await opslaan(bytes, models, { document: { measureScale: doc.measureScale } });
    const [{ dict }] = await woordenboeken(bytes);
    const m = dict.lookup(PDFName.of('Measure'));
    const x = m.lookup(PDFName.of('X')).lookup(0);
    assert.equal(x.lookup(PDFName.of('U')).decodeText(), 'm');
    assert.equal(x.lookup(PDFName.of('C')).asNumber(), 0.01);
    models = await laad(bytes);
    assert.equal(models[0].measureUnit, 'm'); assert.equal(models[0].measureScale, 0.01);
    assert.equal(models[0].measureText, '2.50 m');
    syncMeasurementAfterEdit(models[0]);
    assert.equal(models[0].measureValue, 2.5);
  }
});

test('inherited perimeter unit is shown after reopening without freezing its scale', async () => {
  const doc = setup(); const ann = create();
  const bytes = await opslaan(await leegBlad(), [ann], { document: { measureScale: doc.measureScale } });
  const [restored] = await laad(bytes);
  assert.equal(restored.measureUnit, 'mm');
  assert.equal(restored.measureScale, undefined);
  assert.equal(restored.measureValue, 2500);
});
