// Rekenkern wapening (#312): notatie, staaflengte per buigvorm, gewicht per Ø
// en de buigstaat/wapeningsstaat uit annotaties via de hoeveelheden-engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  massaPerMeter, buigdoornDiameter, staafNotatie, staafLabel, aantalOverBreedte,
  bochtAftrek90, staafLengte, normaliseerStaaf, stavenVanAnnotatie, nummerStaven,
  buigstaatRegels, gewichtPerDiameter, wapeningsElementen, MASSA_FACTOR,
} from './wapening.js';
import { buildSchedule } from './engine.js';
import { getTemplateById, scheduleResultToTable } from './schedule-templates.js';
import { CATEGORY_ORDER, categoryOf } from './categories.js';
import { getTemplate } from '../symbols/registry.js';

const dicht = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

test('massa per meter is 0,00617·d² kg/m', () => {
  assert.equal(MASSA_FACTOR, 0.00617);
  dicht(massaPerMeter(8), 0.39488);
  dicht(massaPerMeter(10), 0.617);
  dicht(massaPerMeter(12), 0.88848);
  dicht(massaPerMeter(16), 1.57952);
  dicht(massaPerMeter(25), 3.85625);
});

test('doorndiameter volgens NEN-EN 1992-1-1 tabel 8.1N', () => {
  assert.equal(buigdoornDiameter(8), 32);
  assert.equal(buigdoornDiameter(16), 64);
  assert.equal(buigdoornDiameter(20), 140);
});

test('Nederlandse staafnotatie', () => {
  assert.equal(staafNotatie({ aantal: 12, diameter: 10, afstand: 150 }), '12Ø10-150');
  assert.equal(staafNotatie({ aantal: 4, diameter: 12 }), '4Ø12');
  assert.equal(staafNotatie({ diameter: 8, afstand: 150 }), 'Ø8-150');
  assert.equal(staafLabel({ aantal: 12, diameter: 10, afstand: 150, lengteMm: 2450 }), '12Ø10-150 lg=2450');
  assert.equal(staafLabel({ aantal: 3, diameter: 8 }), '3Ø8');
});

test('aantal staven over een verdeelbreedte (beide randen inbegrepen)', () => {
  assert.equal(aantalOverBreedte(1800, 150), 13);
  assert.equal(aantalOverBreedte(1000, 300), 4);
  assert.equal(aantalOverBreedte(0, 150), 1);
  assert.equal(aantalOverBreedte(1000, 0), 0);
});

test('staaflengte per buigvorm uit buitenmaten', () => {
  // 90°-bocht Ø10, doorn 40: 2(20+10) − π/2·(20+5)
  dicht(bochtAftrek90(10), 60 - (Math.PI / 2) * 25);
  assert.equal(staafLengte('00', { a: 4000 }, 12), 4000);
  dicht(staafLengte('11', { a: 2500, b: 400 }, 10, { afronden: false }), 2900 - bochtAftrek90(10));
  assert.equal(staafLengte('11', { a: 2500, b: 400 }, 10), 2880);
  dicht(staafLengte('21', { a: 300, b: 2000, c: 300 }, 10, { afronden: false }), 2600 - 2 * bochtAftrek90(10));
  assert.equal(staafLengte('21', { a: 300, b: 2000, c: 300 }, 10), 2560);
  // Beugel 300×500 Ø10: vier zijden, drie 90°-hoeken, twee 135°-haken + 10Ø.
  const r = 20, d = 10;
  const verwacht = 1600 - 8 * (r + d) + 3 * (Math.PI / 2) * (r + d / 2) + 2 * ((3 * Math.PI / 4) * (r + d / 2) + 100);
  dicht(staafLengte('51', { a: 300, b: 500 }, 10, { afronden: false }), verwacht);
  assert.equal(staafLengte('51', { a: 300, b: 500 }, 10), 1800);
  // Grotere staaf: doorn 7Ø.
  dicht(staafLengte('11', { a: 1000, b: 500 }, 20, { afronden: false }), 1500 - (180 - (Math.PI / 2) * 80));
  // Onbekende vorm valt terug op recht.
  assert.equal(staafLengte('99', { a: 1234 }, 10), 1235);
});

test('normaliseren van een staaf', () => {
  const s = normaliseerStaaf({ staafnummer: ' 7 ', diameter: '12', aantal: '3,4', lengteMm: 1999.6, vormcode: '1', staalkwaliteit: 'b500c' });
  assert.deepEqual(
    [s.staafnummer, s.diameter, s.aantal, s.lengteMm, s.vormcode, s.staalkwaliteit],
    ['7', 12, 3, 2000, '00', 'B500C'],
  );
  assert.equal(normaliseerStaaf({}).staalkwaliteit, 'B500B');
});

function ps(id, symbolId, params, page = 1) {
  return { id, type: 'parametricSymbol', symbolId, params, page };
}

const ANNOTATIES = [
  { id: 'a', type: 'stavenreeks', count: 5, diameter: 12, barLengthMm: 3000, page: 1 },
  ps('b', 'wapeningsdetail', { staafnummer: '1', aantal: 12, diameter: 10, afstand: 150, vormcode: '21', a: 300, b: 2000, c: 300 }),
  ps('c', 'wapeningsdetail', { staafnummer: '1', aantal: 12, diameter: 10, afstand: 150, vormcode: '21', a: 300, b: 2000, c: 300 }, 2),
  ps('d', 'staaf-plattegrond', { staafnummer: '', diameter: 12, afstand: 150, verdeelbreedte: 1800, lengte: 3000 }),
  ps('e', 'wapeningsnet', { lengte: 5000, breedte: 2150, diameterL: 8, afstandL: 150, diameterB: 8, afstandB: 150 }),
  { id: 'f', type: 'line', startX: 0, startY: 0, endX: 10, endY: 0, page: 1 },
  ps('g', 'bout', { maat: 'M12' }),
];

test('staven uit annotaties: stavenreeks en wapeningssymbolen, andere niet', () => {
  assert.equal(stavenVanAnnotatie(ANNOTATIES[0], getTemplate)[0].lengteMm, 3000);
  assert.equal(stavenVanAnnotatie(ANNOTATIES[5], getTemplate).length, 0);
  assert.equal(stavenVanAnnotatie(ANNOTATIES[6], getTemplate).length, 0);
  assert.equal(stavenVanAnnotatie(ps('x', 'onbekend', {}), getTemplate).length, 0);
  const net = stavenVanAnnotatie(ANNOTATIES[4], getTemplate);
  assert.deepEqual(net.map((s) => [s.aantal, s.lengteMm, s.staalkwaliteit]), [[15, 5000, 'B500A'], [34, 2150, 'B500A']]);
  assert.equal(net[0].bron.id, 'e');
});

test('automatische staafnummers na het hoogste handmatige, gelijke staven delen een nummer', () => {
  const genummerd = nummerStaven([
    normaliseerStaaf({ staafnummer: '4', diameter: 10, aantal: 1, lengteMm: 100 }),
    normaliseerStaaf({ diameter: 12, aantal: 2, lengteMm: 3000 }),
    normaliseerStaaf({ diameter: 12, aantal: 3, lengteMm: 3000 }),
    normaliseerStaaf({ diameter: 8, aantal: 3, lengteMm: 3000 }),
  ]);
  assert.deepEqual(genummerd.map((s) => s.staafnummer), ['4', '5', '5', '6']);
});

test('buigstaat: samenvoegen per positie, lengte en gewicht', () => {
  const regels = buigstaatRegels(ANNOTATIES.flatMap((a) => stavenVanAnnotatie(a, getTemplate)));
  assert.deepEqual(regels.map((r) => [r.staafnummer, r.diameter, r.vormcode, r.lengteMm, r.aantal]), [
    ['1', 10, '21', 2560, 24],
    ['2', 12, '00', 3000, 18],
    ['3', 8, '00', 5000, 15],
    ['4', 8, '00', 2150, 34],
  ]);
  assert.deepEqual(regels[0].paginas, [1, 2]);
  dicht(regels[0].totaleLengteM, 61.44);
  dicht(regels[0].massaKg, 61.44 * 0.617);
  dicht(regels[1].massaKg, 54 * 0.88848);
  assert.ok(regels.every((r) => r.conflict === false));

  const gewicht = gewichtPerDiameter(regels);
  assert.deepEqual(gewicht.perDiameter.map((e) => e.diameter), [8, 10, 12]);
  dicht(gewicht.perDiameter[0].totaleLengteM, 75 + 73.1);
  dicht(gewicht.perDiameter[0].massaKg, 148.1 * 0.39488);
  dicht(gewicht.totaalKg, 148.1 * 0.39488 + 61.44 * 0.617 + 54 * 0.88848);
});

test('één staafnummer met verschillende staven wordt gemarkeerd', () => {
  const regels = buigstaatRegels([
    normaliseerStaaf({ staafnummer: '1', diameter: 10, aantal: 2, lengteMm: 1000 }),
    normaliseerStaaf({ staafnummer: '1', diameter: 12, aantal: 2, lengteMm: 1000 }),
  ]);
  assert.equal(regels.length, 2);
  assert.ok(regels.every((r) => r.conflict));
});

test('de categorie wapening staat in de hoeveelheden', () => {
  assert.ok(CATEGORY_ORDER.includes('reinforcement'));
  const el = wapeningsElementen(ANNOTATIES, getTemplate);
  assert.equal(el.length, 4);
  assert.ok(el.every((e) => categoryOf(e) === 'reinforcement'));
  assert.equal(el[0].label, '24Ø10 lg=2560');
});

test('standaardsjabloon Buigstaat via de engine', () => {
  const tpl = getTemplateById('buigstaat');
  const r = buildSchedule([...ANNOTATIES, ...wapeningsElementen(ANNOTATIES, getTemplate)], tpl.config);
  assert.equal(r.count, 4);
  const rijen = r.groups[0].rows.map((row) => [row.vals.rebarMark, row.vals.rebarDiameter, row.vals.rebarShape, row.vals.rebarLength, row.vals.rebarCount]);
  assert.deepEqual(rijen, [[1, 10, '21', 2560, 24], [2, 12, '00', 3000, 18], [3, 8, '00', 5000, 15], [4, 8, '00', 2150, 34]]);
  dicht(r.grandTotals.rebarTotalLength, 61.44 + 54 + 75 + 73.1);
  dicht(r.grandTotals.rebarMass, 148.1 * 0.39488 + 61.44 * 0.617 + 54 * 0.88848);
  assert.equal(r.grandTotals.rebarCount, 24 + 18 + 15 + 34);
  // Diameter en lengte per staaf tellen niet op.
  assert.equal(r.grandTotals.rebarDiameter, undefined);
  assert.equal(r.grandTotals.rebarLength, undefined);

  const tabel = scheduleResultToTable(r, 'Buigstaat');
  assert.deepEqual(tabel.columns.slice(0, 4), ['Bar mark', 'Ø (mm)', 'Shape code', 'Bar length (mm)']);
  assert.deepEqual(tabel.rows[0].cells.slice(0, 5), ['1', '10', '21', '2560', '24']);
  const totaal = tabel.rows.at(-1);
  assert.ok(totaal.grand);
  assert.equal(totaal.cells[1], '', 'geen opgetelde diameter');
});

test('standaardsjabloon Wapeningsstaat: gewicht per diameter', () => {
  const tpl = getTemplateById('wapeningsstaat');
  const r = buildSchedule(wapeningsElementen(ANNOTATIES, getTemplate), tpl.config);
  assert.deepEqual(r.groups.map((g) => g.key), ['8', '10', '12']);
  dicht(r.groups[0].subtotals.rebarTotalLength, 148.1);
  dicht(r.groups[0].subtotals.rebarMass, 148.1 * 0.39488);
  assert.equal(r.groups[0].subtotals.rebarMassPerM, undefined);
  assert.equal(r.itemize, false);
});

test('een gewone formaat-instelling zet een niet-optelbaar veld niet aan', () => {
  const r = buildSchedule(wapeningsElementen(ANNOTATIES, getTemplate), {
    categories: ['reinforcement'], fields: ['rebarDiameter', 'rebarMass'],
    format: { rebarDiameter: { heading: 'Diam.' } },
  });
  assert.equal(r.columns[0].label, 'Diam.');
  assert.equal(r.columns[0].total, false);
  assert.equal(r.columns[1].total, true);
});
