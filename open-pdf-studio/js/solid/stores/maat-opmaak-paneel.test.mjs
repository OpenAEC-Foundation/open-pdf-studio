// Getalopmaak van een maat in het eigenschappenpaneel (core/maat-opmaak.js):
// de keuzelijst Precisie kent bij een maat drie standen — automatisch, een
// breuk van een inch, of uitdrukkelijk zoveel decimalen. De echte store,
// zoals MeasurementSection.jsx hem aanroept (updateAnnotProp).

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../core/state.ts');
const { DEFAULT_PREFERENCES } = await import('../../core/constants.ts');
const { storeShowProperties, annotProps, updateAnnotProp } = await import('./propertiesStore.js');
const { stelVoetInchBronIn } = await import('../../core/voet-inch.js');
// Zoals main.js: de voorkeur voet-inch komt uit state.preferences.
stelVoetInchBronIn(() => ({ formaat: state.preferences?.imperialLengthFormat, precisie: state.preferences?.imperialFractionPrecision }));

// 73,4382 pt bij 0,02972369 voet per punt = 2,1828 ft = 2'-2,19".
const VOET_PER_PT = 0.02972369;

function maat(extra = {}) {
  return {
    id: `maat-${Math.random().toString(36).slice(2, 8)}`, type: 'measureDistance', page: 1,
    startX: 100, startY: 100, endX: 100, endY: 100 + 73.4382,
    measureScale: VOET_PER_PT, measureUnit: 'ft', measurePrecision: 1, measureFraction: 16,
    measureText: `2'-2 3/16"`, color: '#ff0000', strokeColor: '#ff0000', lineWidth: 1, opacity: 1,
    createdAt: '2026-11-15T10:00:00.000Z', modifiedAt: '2026-11-15T10:00:00.000Z',
    ...extra,
  };
}

function selecteer(ann) {
  state.documents = [{
    id: 'doc', filePath: null, pdfDoc: { numPages: 1 }, currentPage: 1, scale: 1, viewMode: 'single',
    annotations: [ann], selectedAnnotation: ann, selectedAnnotations: [ann],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  storeShowProperties(ann);
}

test.beforeEach(() => { state.preferences = { ...DEFAULT_PREFERENCES }; });

test('het paneel toont de stand van de maat', () => {
  selecteer(maat());
  assert.equal(annotProps.measureFraction, 16);
  selecteer(maat({ measureFraction: undefined }));
  assert.equal(annotProps.measureFraction, '', 'automatisch');
  selecteer(maat({ measureFraction: 0 }));
  assert.equal(annotProps.measureFraction, 0, 'decimaal');
});

test('breuk → decimaal → andere breuk → automatisch', () => {
  const ann = maat();
  selecteer(ann);

  // 0.01: uitdrukkelijk twee decimalen.
  updateAnnotProp('measurePrecision', '2');
  assert.equal(ann.measureFraction, 0);
  assert.equal(ann.measurePrecision, 2);
  assert.equal(ann.measureText, '2.18 ft');
  assert.equal(annotProps.measureFraction, 0);

  // 1/4": voet-inch met kwarten.
  updateAnnotProp('measureFraction', '4');
  assert.equal(ann.measureFraction, 4);
  assert.equal(ann.measureText, `2'-2 1/4"`);

  // Automatisch: een maat met een eigen schaal neemt dan haar measurePrecision.
  updateAnnotProp('measureFraction', 'auto');
  assert.equal(ann.measureFraction, undefined);
  assert.equal(ann.measureText, '2.18 ft');
});

test('uitdrukkelijk decimaal gaat voor de voorkeur voet-inch, automatisch niet', () => {
  state.preferences = { ...DEFAULT_PREFERENCES, imperialLengthFormat: 'feetInch', imperialFractionPrecision: 8 };
  // Een maat met de schaal van de pagina (geen eigen schaal), zonder viewport.
  const ann = maat({ measureScale: undefined, measureFraction: undefined });
  state.documents = [];
  selecteer(ann);
  state.documents[0].measureScale = { pixelsPerUnit: 1 / VOET_PER_PT, unit: 'ft' };

  updateAnnotProp('measureFraction', 'auto');
  // 26,194" op 1/8 afgerond is 26 2/8 = 26 1/4".
  assert.equal(ann.measureText, `2'-2 1/4"`, 'automatisch volgt de voorkeur');
  updateAnnotProp('measurePrecision', '2');
  assert.equal(ann.measureText, '2.18 ft', 'decimaal wint');
});

test('bij een meetvlak zet een precisie geen opmaak', () => {
  const vlak = {
    id: 'vlak', type: 'measureArea', page: 1, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    measurePrecision: 2, color: '#ff0000', opacity: 1,
    createdAt: '2026-11-15T10:00:00.000Z', modifiedAt: '2026-11-15T10:00:00.000Z',
  };
  selecteer(vlak);
  updateAnnotProp('measurePrecision', '3');
  assert.equal(vlak.measurePrecision, 3);
  assert.equal(vlak.measureFraction, undefined);
});

test('alleen inches: i16 toont 26 3/16", f16 weer voet-inch, decimaal wist de keuze', () => {
  const ann = maat();
  selecteer(ann);

  updateAnnotProp('measureFraction', 'i16');
  assert.equal(ann.measureFraction, 16);
  assert.equal(ann.measureInchOnly, true);
  assert.equal(ann.measureText, '26 3/16"');
  assert.equal(annotProps.measureInchOnly, true);

  updateAnnotProp('measureFraction', 'f4');
  assert.equal(ann.measureInchOnly, undefined);
  assert.equal(ann.measureText, `2'-2 1/4"`);

  updateAnnotProp('measureFraction', 'i1');
  assert.equal(ann.measureText, '26"');

  updateAnnotProp('measurePrecision', '2');
  assert.equal(ann.measureFraction, 0);
  assert.equal(ann.measureInchOnly, undefined);
  assert.equal(ann.measureText, '2.18 ft');
});

// De eenheid zelf omrekenen (3 ft → 36 in) hoort bij #1091 (opgelost in #1086);
// hier alleen dat "alleen inches" niet blijft hangen na een andere eenheid.
test('voet → inch → een breuk kiezen → voet: geen achtergebleven "alleen inches"', () => {
  const ann = maat({ endX: 100 + 100.9295, endY: 100, measureFraction: 1, measureText: `3'-0"` });
  selecteer(ann);
  updateAnnotProp('measureUnit', 'in');
  // In inches biedt de keuzelijst alleen de inch-breuken (i…).
  updateAnnotProp('measureFraction', 'i32');
  assert.equal(ann.measureInchOnly, undefined, 'een maat in inches krijgt de vlag niet');
  updateAnnotProp('measureUnit', 'ft');
  assert.equal(ann.measureText, `3'-0"`);

  // Alleen inches bij een maat in voet, daarna een andere eenheid: de keuze vervalt.
  updateAnnotProp('measureFraction', 'i16');
  assert.equal(ann.measureInchOnly, true);
  assert.equal(ann.measureText, '36"');
  updateAnnotProp('measureUnit', 'in');
  updateAnnotProp('measureUnit', 'ft');
  assert.equal(ann.measureInchOnly, undefined);
  assert.equal(annotProps.measureInchOnly, false);
  assert.equal(ann.measureText, `3'-0"`);
});
