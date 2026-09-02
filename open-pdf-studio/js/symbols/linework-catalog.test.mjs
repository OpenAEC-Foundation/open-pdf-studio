import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseLineworkCatalog,
  lineworkCatalogTemplates,
  lineworkTemplateId,
} from './linework-catalog.js';

const CATALOG = {
  format: 'linework-variants',
  formatVersion: 1,
  units: 'mm',
  label: { en: 'Rothoblaas', nl: 'Rothoblaas' },
  families: [{
    id: 'hbs-plate',
    name: { en: 'HBS PLATE screw', nl: 'HBS PLATE schroef' },
    defaultSize: '8x100',
    variants: [
      { id: 'HBSPL8100', label: '8x100', w: 105.5, h: 17, paths: [{ p: [0, 0, 105.5, 0] }] },
      { id: 'HBSPL8060', label: '8x60', w: 65, h: 14, paths: [{ c: 1, p: [0, 0, 65, 0, 65, 14] }] },
    ],
  }],
};

// --- parse ---

test('geeft null voor een ander parametrisch formaat', () => {
  assert.equal(parseLineworkCatalog({ format: 'steel-sections', families: [] }), null);
  assert.equal(parseLineworkCatalog(null), null);
  assert.equal(parseLineworkCatalog({}), null);
});

test('leest een geldige catalogus', () => {
  const c = parseLineworkCatalog(CATALOG);
  assert.equal(c.families.length, 1);
  assert.equal(c.families[0].variants.length, 2);
  assert.equal(c.families[0].variants[0].w, 105.5);
});

test('weigert een catalogus zonder families', () => {
  assert.throws(() => parseLineworkCatalog({ format: 'linework-variants', formatVersion: 1 }), /famil/i);
});

test('weigert een variant zonder bruikbare maat of geometrie', () => {
  const kapot = (variant) => ({
    ...CATALOG,
    families: [{ ...CATALOG.families[0], variants: [variant] }],
  });
  assert.throws(() => parseLineworkCatalog(kapot({ id: 'a', label: 'a', w: 0, h: 10, paths: [{ p: [0, 0] }] })), /maat/i);
  assert.throws(() => parseLineworkCatalog(kapot({ id: 'a', label: 'a', w: 10, h: 10, paths: [] })), /geometrie/i);
});

test('weigert een onbekende formatVersion', () => {
  assert.throws(() => parseLineworkCatalog({ ...CATALOG, formatVersion: 99 }), /formatVersion/i);
});

test('negeert onbekende sleutels, zodat het formaat kan groeien', () => {
  const c = parseLineworkCatalog({ ...CATALOG, toekomst: true, families: [{ ...CATALOG.families[0], extra: 1 }] });
  assert.equal(c.families.length, 1);
});

// --- templates ---

test('bouwt per familie één template met een maat-keuze', () => {
  const [t] = lineworkCatalogTemplates('rothoblaas-hbs-plate', parseLineworkCatalog(CATALOG));
  assert.equal(t.id, lineworkTemplateId('rothoblaas-hbs-plate', 'hbs-plate'));
  assert.equal(t.fixedSize, true);
  const maat = t.params.find(p => p.key === 'maat');
  assert.equal(maat.type, 'enum');
  assert.deepEqual(maat.options, ['8x100', '8x60']);
  assert.equal(maat.default, '8x100');
});

test('template-id is genest onder de collectie, zodat twee leveranciers niet botsen', () => {
  assert.notEqual(lineworkTemplateId('a', 'hbs-plate'), lineworkTemplateId('b', 'hbs-plate'));
});

test('realSizeMm geeft de maat van de gekozen variant', () => {
  const [t] = lineworkCatalogTemplates('c', parseLineworkCatalog(CATALOG));
  assert.deepEqual(t.realSizeMm({ maat: '8x60', schaal: 1 }), { width: 65, height: 14 });
  assert.deepEqual(t.realSizeMm({ maat: '8x100', schaal: 1 }), { width: 105.5, height: 17 });
});

test('realSizeMm rekent de schaalfactor mee', () => {
  const [t] = lineworkCatalogTemplates('c', parseLineworkCatalog(CATALOG));
  assert.deepEqual(t.realSizeMm({ maat: '8x60', schaal: 2 }), { width: 130, height: 28 });
});

test('valt terug op de standaardmaat bij een onbekende keuze', () => {
  const [t] = lineworkCatalogTemplates('c', parseLineworkCatalog(CATALOG));
  assert.deepEqual(t.realSizeMm({ maat: 'bestaat-niet' }), { width: 105.5, height: 17 });
});

// --- render ---

test('render tekent de paden van de gekozen variant in de bbox', () => {
  const [t] = lineworkCatalogTemplates('c', parseLineworkCatalog(CATALOG));
  const cmds = t.render({ maat: '8x60' }, { x: 10, y: 20, width: 130, height: 28 });
  const lijnen = cmds.filter(c => c.kind === 'polyline');
  assert.equal(lijnen.length, 1);
  assert.equal(lijnen[0].close, true);
  // schaal 2x, oorsprong op de bbox
  assert.deepEqual(lijnen[0].points[0], { x: 10, y: 20 });
  assert.deepEqual(lijnen[0].points[1], { x: 140, y: 20 });
  assert.deepEqual(lijnen[0].points[2], { x: 140, y: 48 });
});

test('render houdt de verhouding aan en centreert in een afwijkende bbox', () => {
  const [t] = lineworkCatalogTemplates('c', parseLineworkCatalog(CATALOG));
  // bbox twee keer zo hoog als nodig: schaal volgt de krapste as, verticaal gecentreerd
  const cmds = t.render({ maat: '8x60' }, { x: 0, y: 0, width: 65, height: 28 });
  const pts = cmds.find(c => c.kind === 'polyline').points;
  assert.deepEqual(pts[0], { x: 0, y: 7 });
});

test('render geeft niets terug bij een lege catalogusvariant', () => {
  const [t] = lineworkCatalogTemplates('c', parseLineworkCatalog(CATALOG));
  assert.deepEqual(t.render({ maat: '8x60' }, { x: 0, y: 0, width: 0, height: 0 }), []);
});

test('toont desgevraagd een label met familienaam en maat', () => {
  const [t] = lineworkCatalogTemplates('c', parseLineworkCatalog(CATALOG));
  const cmds = t.render({ maat: '8x60', toonLabel: true }, { x: 0, y: 0, width: 65, height: 14 });
  const tekst = cmds.find(c => c.kind === 'text');
  assert.match(tekst.text, /8x60/);
});

test('snapPoints levert hoeken, midden en middens van de zijden', () => {
  const [t] = lineworkCatalogTemplates('c', parseLineworkCatalog(CATALOG));
  const pts = t.snapPoints({ maat: '8x60' }, { x: 0, y: 0, width: 100, height: 50 });
  assert.ok(pts.some(p => p.kind === 'center' && p.x === 50 && p.y === 25));
  assert.equal(pts.filter(p => p.kind === 'endpoint').length, 4);
  assert.equal(pts.filter(p => p.kind === 'midpoint').length, 4);
});

// --- bogen blijven bogen ---

const MET_BOOG = {
  format: 'linework-variants',
  formatVersion: 1,
  families: [{
    id: 'kop',
    name: 'Kop',
    variants: [{
      id: 'k1', label: 'k1', w: 20, h: 20,
      paths: [{ p: [0, 10, 20, 10] }],
      arcs: [{ cx: 10, cy: 10, r: 8, a0: 0, a1: 3.14159, ccw: 0 }],
    }],
  }],
};

test('leest bogen als bogen, niet als polygoonbenadering', () => {
  const c = parseLineworkCatalog(MET_BOOG);
  assert.equal(c.families[0].variants[0].arcs.length, 1);
});

test('render geeft een echte arc terug, meegeschaald', () => {
  const [t] = lineworkCatalogTemplates('c', parseLineworkCatalog(MET_BOOG));
  const cmds = t.render({ maat: 'k1' }, { x: 100, y: 200, width: 40, height: 40 });
  const boog = cmds.find(c => c.kind === 'arc');
  assert.ok(boog, 'geen arc-commando');
  assert.equal(boog.cx, 100 + 10 * 2);   // schaal 2, oorsprong 100
  assert.equal(boog.cy, 200 + 10 * 2);
  assert.equal(boog.r, 16);              // straal schaalt mee
  assert.equal(boog.a0, 0);              // hoeken blijven, geen rotatie
  assert.equal(boog.ccw, false);
});

test('een variant met alleen bogen is geldig', () => {
  const alleenBoog = {
    ...MET_BOOG,
    families: [{ ...MET_BOOG.families[0], variants: [{ id: 'a', label: 'a', w: 10, h: 10, arcs: [{ cx: 5, cy: 5, r: 4, a0: 0, a1: 1 }] }] }],
  };
  const c = parseLineworkCatalog(alleenBoog);
  assert.equal(c.families[0].variants[0].paths.length, 0);
  assert.equal(c.families[0].variants[0].arcs.length, 1);
});

test('negeert een boog zonder bruikbare straal', () => {
  const kapot = {
    ...MET_BOOG,
    families: [{ ...MET_BOOG.families[0], variants: [{ id: 'a', label: 'a', w: 10, h: 10, paths: [{ p: [0, 0, 10, 10] }], arcs: [{ cx: 5, cy: 5, r: 0, a0: 0, a1: 1 }] }] }],
  };
  assert.equal(parseLineworkCatalog(kapot).families[0].variants[0].arcs.length, 0);
});

// --- stempeling op het product ---

const MET_TEKST = {
  format: 'linework-variants',
  formatVersion: 1,
  families: [{
    id: 'kop', name: 'Kop',
    variants: [{
      id: 'k', label: 'k', w: 14, h: 14,
      arcs: [{ cx: 7, cy: 7, r: 6.75, a0: 0, a1: 6.28 }],
      texts: [{ x: 4, y: 7, t: 'H', s: 2 }, { x: 10, y: 7, t: 'S', s: 2 }],
    }],
  }],
};

test('neemt stempeling op het product mee', () => {
  const c = parseLineworkCatalog(MET_TEKST);
  assert.equal(c.families[0].variants[0].texts.length, 2);
});

test('render plaatst de stempeling mee geschaald', () => {
  const [t] = lineworkCatalogTemplates('c', parseLineworkCatalog(MET_TEKST));
  const cmds = t.render({ maat: 'k' }, { x: 0, y: 0, width: 28, height: 28 });
  const letters = cmds.filter(c => c.kind === 'text');
  assert.equal(letters.length, 2);
  assert.equal(letters[0].text, 'H');
  assert.equal(letters[0].x, 8);    // 4 * schaal 2
  assert.equal(letters[0].y, 14);   // 7 * schaal 2
  assert.equal(letters[0].size, 4); // 2 * schaal 2
});

test('stempeling telt als geometrie, dus een variant met alleen tekst mag', () => {
  const alleenTekst = {
    ...MET_TEKST,
    families: [{ id: 'x', name: 'x', variants: [{ id: 'a', label: 'a', w: 10, h: 10, texts: [{ x: 5, y: 5, t: 'A', s: 2 }] }] }],
  };
  assert.equal(parseLineworkCatalog(alleenTekst).families[0].variants[0].texts.length, 1);
});

test('negeert tekst zonder inhoud of positie', () => {
  const kapot = {
    ...MET_TEKST,
    families: [{ id: 'x', name: 'x', variants: [{ id: 'a', label: 'a', w: 10, h: 10, arcs: [{ cx: 5, cy: 5, r: 2, a0: 0, a1: 1 }], texts: [{ x: 1, y: 1, t: '', s: 2 }, { t: 'B', s: 2 }] }] }],
  };
  assert.equal(parseLineworkCatalog(kapot).families[0].variants[0].texts.length, 0);
});

test('het maat-label blijft los van de stempeling', () => {
  const [t] = lineworkCatalogTemplates('c', parseLineworkCatalog(MET_TEKST));
  const cmds = t.render({ maat: 'k', toonLabel: true }, { x: 0, y: 0, width: 14, height: 14 });
  assert.equal(cmds.filter(c => c.kind === 'text').length, 3); // 2 stempels + 1 label
});

test('geeft geen Engelse naam mee als die gelijk is aan de Nederlandse', () => {
  const zelfde = {
    format: 'linework-variants', formatVersion: 1,
    families: [{ id: 'f', name: { nl: 'Schroef', en: 'Schroef' },
      variants: [{ id: 'a', label: 'a', w: 10, h: 10, paths: [{ p: [0, 0, 10, 10] }] }] }],
  };
  const [t] = lineworkCatalogTemplates('c', parseLineworkCatalog(zelfde), 'nl');
  assert.equal(t.name, 'Schroef');
  assert.equal(t.nameEn, undefined);   // paneel toont anders "Schroef / Schroef"
});

test('behoudt de Engelse naam als die wel afwijkt', () => {
  const anders = {
    format: 'linework-variants', formatVersion: 1,
    families: [{ id: 'f', name: { nl: 'Schroef', en: 'Screw' },
      variants: [{ id: 'a', label: 'a', w: 10, h: 10, paths: [{ p: [0, 0, 10, 10] }] }] }],
  };
  const [t] = lineworkCatalogTemplates('c', parseLineworkCatalog(anders), 'nl');
  assert.equal(t.name, 'Schroef');
  assert.equal(t.nameEn, 'Screw');
});
