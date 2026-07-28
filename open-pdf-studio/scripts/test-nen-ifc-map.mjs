// Unittest voor de NEN 1414 → IFC-mapping (js/solid/data/nenIfcMap.js).
//
// Controleert:
//  1. Elke NEN-symbool-id uit de palette-bibliotheek (nen1414Library.js)
//     heeft een mapping-entry, en omgekeerd (geen zwevende entries).
//  2. Alleen bekende IFC4-klassen; PredefinedType past bij de klasse.
//  3. Namen zijn consistent met de bibliotheek (naam-fallback voor oudere
//     PDF's werkt dan gegarandeerd).
//  4. De classificatie-keten (ifcCategoryForSymbol/ifcCategoryForAnnotation)
//     gebruikt de expliciete mapping, en een report-telling per klasse klopt.
//
// nen1414Library.js gebruikt import.meta.glob (Vite) en window, dus die wordt
// hier TEKSTUEEL geparsed in plaats van geïmporteerd.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  NEN_IFC_MAP, NEN_IFC_ALLOWED_CLASSES, NEN_IFC_PREDEFINED_ENUMS,
  nenIfcForSymbolId, nenIfcForStamp,
} from '../js/solid/data/nenIfcMap.js';
import { ifcCategoryForSymbol, ifcCategoryForAnnotation } from '../js/solid/data/ifcCategoryMap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libSrc = readFileSync(path.join(__dirname, '../js/solid/data/nen1414Library.js'), 'utf8');

// Extraheer het NAMES-object uit de bibliotheek: regels als 'Tb1.003': 'Rookmelder',
const LIB_NAMES = {};
const namesBlock = libSrc.slice(libSrc.indexOf('const NAMES = {'), libSrc.indexOf('};', libSrc.indexOf('const NAMES = {')));
for (const m of namesBlock.matchAll(/'([^']+)':\s*'([^']*)'/g)) {
  LIB_NAMES[m[1]] = m[2];
}

test('bibliotheek geparsed: ~100 NEN-symbolen gevonden', () => {
  const n = Object.keys(LIB_NAMES).length;
  assert.ok(n >= 95 && n <= 120, `onverwacht aantal bibliotheek-symbolen: ${n}`);
});

test('elke bibliotheek-id heeft een mapping-entry', () => {
  const missing = Object.keys(LIB_NAMES).filter(id => !NEN_IFC_MAP[id]);
  assert.deepEqual(missing, [], `ontbrekend in NEN_IFC_MAP: ${missing.join(', ')}`);
});

test('geen zwevende mapping-entries buiten de bibliotheek', () => {
  const extra = Object.keys(NEN_IFC_MAP).filter(id => !(id in LIB_NAMES));
  assert.deepEqual(extra, [], `onbekend in bibliotheek: ${extra.join(', ')}`);
});

test('namen consistent met de bibliotheek (naam-fallback oudere PDF\'s)', () => {
  const diff = Object.entries(NEN_IFC_MAP)
    .filter(([id, e]) => LIB_NAMES[id] !== undefined && e.name !== LIB_NAMES[id])
    .map(([id, e]) => `${id}: '${e.name}' != '${LIB_NAMES[id]}'`);
  assert.deepEqual(diff, []);
});

test('alleen toegestane IFC4-klassen', () => {
  for (const [id, e] of Object.entries(NEN_IFC_MAP)) {
    assert.ok(NEN_IFC_ALLOWED_CLASSES.includes(e.ifcCategory),
      `${id}: onbekende IFC-klasse ${e.ifcCategory}`);
  }
});

test('PredefinedType geldig voor de klasse', () => {
  for (const [id, e] of Object.entries(NEN_IFC_MAP)) {
    if (!e.ifcPredefinedType) continue;
    const allowed = NEN_IFC_PREDEFINED_ENUMS[e.ifcCategory] || [];
    assert.ok(allowed.includes(e.ifcPredefinedType),
      `${id}: ${e.ifcCategory}.${e.ifcPredefinedType} niet in enum`);
  }
});

test('lookup: met en zonder nen1414-prefix, en via naam', () => {
  assert.equal(nenIfcForSymbolId('Tb1.003').ifcCategory, 'IfcSensor');
  assert.equal(nenIfcForSymbolId('nen1414-Tb1.003').ifcPredefinedType, 'SMOKESENSOR');
  assert.equal(nenIfcForSymbolId('nen1414-bestaatniet'), null);
  // Naam-fallback (ouder document: alleen OPS_StampName aanwezig)
  assert.equal(nenIfcForStamp(null, 'Rookmelder').ifcPredefinedType, 'SMOKESENSOR');
  assert.equal(nenIfcForStamp(null, 'Brandkraan (ondergronds)').ifcCategory, 'IfcFireSuppressionTerminal');
  assert.equal(nenIfcForStamp(null, 'Draft'), null);
});

test('ifcCategoryForSymbol gebruikt de expliciete NEN-mapping', () => {
  // Zonder expliciete mapping zou 'UPS' via trefwoorden nooit op
  // IfcElectricFlowStorageDevice uitkomen.
  assert.equal(ifcCategoryForSymbol({ id: 'nen1414-Tn12', name: 'UPS' }), 'IfcElectricFlowStorageDevice');
  assert.equal(ifcCategoryForSymbol({ id: 'nen1414-Tb2.041', name: 'Brandklep' }), 'IfcDamper');
  assert.equal(ifcCategoryForSymbol({ id: 'nen1414-Tw10', name: 'Brandkraan (ondergronds)' }), 'IfcFireSuppressionTerminal');
});

test('ifcCategoryForAnnotation herclassificeert oudere NEN-stempels', () => {
  // Expliciet veld wint.
  assert.equal(ifcCategoryForAnnotation({ type: 'stamp', ifcCategory: 'IfcDoor' }), 'IfcDoor');
  // Geen veld, wel symbolId.
  assert.equal(ifcCategoryForAnnotation({ type: 'stamp', symbolId: 'nen1414-Tr502' }), 'IfcFan');
  // Alleen stempelnaam (oudste bestanden).
  assert.equal(ifcCategoryForAnnotation({ type: 'stamp', stampName: 'Vluchtwegaanduiding' }), 'IfcLightFixture');
  // Gewone tekststempel blijft annotatie.
  assert.equal(ifcCategoryForAnnotation({ type: 'stamp', stampName: 'Draft' }), 'IfcAnnotation');
});

test('report-telling per IFC-klasse klopt met de mapping', () => {
  // Simuleer een document met álle NEN-symbolen als geplaatste stempels
  // en tel per klasse zoals ifc-export.js dat doet.
  const anns = Object.keys(NEN_IFC_MAP).map(id => ({
    type: 'stamp', symbolId: `nen1414-${id}`, stampName: NEN_IFC_MAP[id].name,
  }));
  const counts = {};
  for (const a of anns) {
    const cls = ifcCategoryForAnnotation(a);
    counts[cls] = (counts[cls] || 0) + 1;
  }
  const expected = {};
  for (const e of Object.values(NEN_IFC_MAP)) {
    expected[e.ifcCategory] = (expected[e.ifcCategory] || 0) + 1;
  }
  assert.deepEqual(counts, expected);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(total, Object.keys(NEN_IFC_MAP).length);
});
