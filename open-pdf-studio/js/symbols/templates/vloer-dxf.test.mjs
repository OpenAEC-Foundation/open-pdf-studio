// Vloerdoorsneden met late geometrie (#454): de index staat bij de start
// klaar, de geometrie laadt bij het eerste tekenen; uitvoer wacht erop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VLOER_INDEX } from '../data/vbi-vloeren-index.js';
import { VLOER_FAMILIES } from '../data/vbi-vloeren.js';
import {
  vloerTemplates, laadVloerGeometrie, vloerGeometrieGeladen, bijVloerGeometrieGeladen, _vergeetVloerGeometrie,
} from './vloer-dxf.js';
import { getTemplate, laadTemplateDataVoor } from '../registry.js';

const BBOX = { x: 10, y: 20, width: 120, height: 30 };

test('de index is de geometrie zonder paden (bij een nieuwe conversie samen bijwerken)', () => {
  const verwacht = VLOER_FAMILIES.map((f) => ({
    id: f.id, name: f.name, variants: f.variants.map(({ id, label, w, h }) => ({ id, label, w, h })),
  }));
  assert.deepEqual(VLOER_INDEX, verwacht);
  const conversie = readFileSync(new URL('../../../scripts/dxf-vloeren-convert.mjs', import.meta.url), 'utf8');
  assert.match(conversie, /writeFileSync\(OUT_INDEX, indexHeader \+ 'export const VLOER_INDEX = '/);
});

test('templates, keuzes en ware maat komen uit de index, zonder geometrie', () => {
  _vergeetVloerGeometrie();
  assert.deepEqual(vloerTemplates.map((t) => t.id), VLOER_INDEX.map((f) => `vloer-${f.id}`));
  const t = getTemplate('vloer-kanaalplaatvloer');
  assert.ok(t);
  const eerste = VLOER_INDEX[0].variants[0];
  assert.equal(t.params[0].default, eerste.label);
  assert.deepEqual(t.realSizeMm({ maat: eerste.label, schaal: 2 }), { width: eerste.w * 2, height: eerste.h * 2 });
  assert.equal(vloerGeometrieGeladen(), false);
});

test('vóór het laden tekent render() de omtrek en start de lading; daarna de doorsnede en een hertekening', async () => {
  _vergeetVloerGeometrie();
  let hertekend = 0;
  const weg = bijVloerGeometrieGeladen(() => { hertekend++; });
  try {
    const t = getTemplate('vloer-kanaalplaatvloer');
    const voor = t.render({ maat: '150 Standaard' }, BBOX);
    assert.equal(voor.length, 1);
    assert.equal(voor[0].kind, 'polyline');
    assert.equal(voor[0].close, true);
    assert.equal(voor[0].points.length, 4);
    // Binnen de bbox, met de verhouding van de doorsnede.
    for (const p of voor[0].points) {
      assert.ok(p.x >= BBOX.x - 1e-9 && p.x <= BBOX.x + BBOX.width + 1e-9);
      assert.ok(p.y >= BBOX.y - 1e-9 && p.y <= BBOX.y + BBOX.height + 1e-9);
    }
    assert.equal(await laadVloerGeometrie(), true);
    assert.equal(vloerGeometrieGeladen(), true);
    assert.equal(hertekend, 1);
    const na = t.render({ maat: '150 Standaard' }, BBOX);
    assert.ok(na.some((c) => c.kind === 'hatch'), 'beton met arcering');
    assert.ok(na.filter((c) => c.kind === 'polyline').length > 1);
  } finally {
    weg();
  }
});

test('laadTemplateDataVoor wacht op de geometrie van vloeren in de annotaties, en laat de rest liggen', async () => {
  _vergeetVloerGeometrie();
  await laadTemplateDataVoor([{ type: 'parametricSymbol', symbolId: 'north' }, { type: 'rectangle' }]);
  assert.equal(vloerGeometrieGeladen(), false, 'geen vloer: niets laden');
  await laadTemplateDataVoor([{ type: 'parametricSymbol', symbolId: 'vloer-ps-isolatievloer' }]);
  assert.equal(vloerGeometrieGeladen(), true);
});

test('een mislukte lading meldt het, tekent de omtrek en mag opnieuw', async () => {
  _vergeetVloerGeometrie();
  const oud = console.warn;
  const meldingen = [];
  console.warn = (...x) => meldingen.push(x.join(' '));
  try {
    assert.equal(await laadVloerGeometrie(() => Promise.reject(new Error('netwerk'))), false);
    assert.equal(vloerGeometrieGeladen(), false);
    assert.equal(meldingen.length, 1);
    assert.equal(await laadVloerGeometrie(), true);
  } finally {
    console.warn = oud;
  }
});

test('opslaan en exporteren wachten op de late templatedata', () => {
  const saver = readFileSync(new URL('../../pdf/saver.js', import.meta.url), 'utf8');
  assert.match(saver, /await laadTemplateDataVoor\(\[psAnn\]\);\s*const png = renderParametricSymbolToPng\(psAnn, 4\);/);
  const exporter = readFileSync(new URL('../../pdf/exporter.js', import.meta.url), 'utf8');
  assert.match(exporter, /if \(markeringen\) await laadTemplateDataVoor\(doc\.annotations\.filter\(a => a\.page === pageNum\)\);/);
  assert.match(exporter, /await laadTemplateDataVoor\(\[annotation\]\);/);
  const tekenen = readFileSync(new URL('../../annotations/rendering.js', import.meta.url), 'utf8');
  assert.match(tekenen, /bijTemplateDataGeladen\(\(\) => \{ try \{ hertekenActieveWeergave\(\); \}/);
  // Alleen vloer-dxf laadt de geometrie, en dan dynamisch.
  const vloer = readFileSync(new URL('./vloer-dxf.js', import.meta.url), 'utf8');
  assert.doesNotMatch(vloer, /^import .*vbi-vloeren\.js/m);
  assert.match(vloer, /import\('\.\.\/data\/vbi-vloeren\.js'\)/);
});
