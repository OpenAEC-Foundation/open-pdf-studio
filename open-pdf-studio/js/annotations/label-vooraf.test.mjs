// Het label van een meting vooraf instellen (#1055): wat bij het actieve
// meetgereedschap als onderwerp of naam is ingevuld, gaat mee naar de
// volgende meting van die soort.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isLabelVeld, zetLabelVooraf, labelVooraf, metLabelVooraf, wisLabelVooraf } from './label-vooraf.js';

test('het ingestelde onderwerp gaat mee naar een nieuwe maatlijn', () => {
  wisLabelVooraf();
  zetLabelVooraf('measureDistance', 'subject', 'Keukenwand');
  const p = metLabelVooraf({ type: 'measureDistance', startX: 0 });
  assert.equal(p.subject, 'Keukenwand');
  assert.equal(p.startX, 0);
});

test('een label geldt alleen voor de eigen soort meting', () => {
  wisLabelVooraf();
  zetLabelVooraf('measureDistance', 'subject', 'Keukenwand');
  assert.equal('subject' in metLabelVooraf({ type: 'measureArea' }), false);
  assert.deepEqual(labelVooraf('measureArea'), {});
});

test('de naam van een oppervlak gaat mee, naast het onderwerp', () => {
  wisLabelVooraf();
  zetLabelVooraf('measureArea', 'measureName', 'Woonkamer');
  zetLabelVooraf('measureArea', 'subject', 'Begane grond');
  assert.deepEqual(labelVooraf('measureArea'), { measureName: 'Woonkamer', subject: 'Begane grond' });
});

test('wat het gereedschap zelf al invult blijft staan', () => {
  wisLabelVooraf();
  zetLabelVooraf('measureDistance', 'subject', 'Keukenwand');
  assert.equal(metLabelVooraf({ type: 'measureDistance', subject: 'Radius' }).subject, 'Radius');
});

test('een leeggemaakt label vervalt', () => {
  wisLabelVooraf();
  zetLabelVooraf('measureDistance', 'subject', 'Keukenwand');
  zetLabelVooraf('measureDistance', 'subject', '   ');
  assert.deepEqual(labelVooraf('measureDistance'), {});
});

test('de meetnaam blijft voorbehouden aan metingen', () => {
  wisLabelVooraf();
  assert.equal(isLabelVeld('measureDistance', 'subject'), true);
  assert.equal(isLabelVeld('measureArea', 'measureName'), true);
  assert.equal(isLabelVeld('measureDistance', 'color'), false);
  assert.equal(isLabelVeld('box', 'measureName'), false);
  zetLabelVooraf('box', 'measureName', 'x');
  const p = { type: 'box' };
  assert.equal(metLabelVooraf(p), p);
});

test('onderwerp uit de eigenschappen van een tekengereedschap gaat mee naar nieuwe objecten', async () => {
  const { register } = await import('node:module');
  register('../core/app-test-hooks.mjs', import.meta.url);
  const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
  installeerBrowserStubs();
  window.matchMedia ??= () => ({ matches: false, addEventListener() {} });
  const { state } = await import('../core/state.js');
  const { showToolDefaults, updateAnnotProp, annotProps } = await import('../solid/stores/propertiesStore.js');
  const { createAnnotationFromTool } = await import('../tools/annotation-creators.js');
  state.documents = [{ id: 'blad', scale: 1, currentPage: 1, annotations: [] }];
  state.activeDocumentIndex = 0;
  wisLabelVooraf();
  const maken = type => createAnnotationFromTool(type === 'polyline' ? 'lshape' : type, 10, 10, 50, 30, null);
  for (const type of ['line', 'arrow', 'polyline', 'box']) {
    await showToolDefaults(type);
    assert.equal(annotProps.subject, '');
    updateAnnotProp('subject', 'Wand ' + type);
    assert.equal(maken(type).pdfSubject, 'Wand ' + type);
  }
  await showToolDefaults('line');
  assert.equal(annotProps.subject, 'Wand line');
  updateAnnotProp('subject', '');
  assert.equal(maken('line').subject, '');
  assert.equal(maken('arrow').pdfSubject, 'Wand arrow');
});
