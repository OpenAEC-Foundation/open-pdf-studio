// Opslaan en heropenen van de constructieve tekengereedschappen (#312): de
// parameters van elk wapenings- en staalverbindingssymbool komen identiek
// terug, en de buigstaat uit het heropende bestand is gelijk aan die van
// vóór het opslaan. Echte saver en echte lader (pdf/rondgang.testhulp.mjs).
import assert from 'node:assert/strict';
import test from 'node:test';

const { leegBlad, opslaan, laad } = await import('./rondgang.testhulp.mjs');
const { getTemplate, defaultParams } = await import('../symbols/registry.js');
const { buigstaatRegels, stavenVanAnnotaties } = await import('../quantities/wapening.js');

const symbool = (id, symbolId, params, x, y) => {
  const tpl = getTemplate(symbolId);
  return {
    page: 1, rotation: 0, color: '#000000', strokeColor: '#000000', lineWidth: 1, opacity: 1, author: 'User',
    id, type: 'parametricSymbol', symbolId, x, y, width: 120, height: 70,
    params: { ...defaultParams(tpl), ...params },
  };
};

const MODELLEN = [
  symbool('detail', 'wapeningsdetail', { staafnummer: '1', aantal: 8, diameter: 12, vormcode: '11', a: 2400, b: 350 }, 40, 40),
  symbool('beugel', 'wapeningsdetail', { staafnummer: '2', aantal: 30, diameter: 8, afstand: 200, vormcode: '51', a: 250, b: 450, haaklengte: 90 }, 200, 40),
  symbool('staaf', 'staaf-plattegrond', { staafnummer: '3', diameter: 10, afstand: 150, verdeelbreedte: 2100, haken: 'beide' }, 40, 160),
  symbool('net', 'wapeningsnet', { laag: 'boven', aantalNetten: 2, staafnummerL: '4', staafnummerB: '5' }, 200, 160),
  symbool('rand', 'vloer-vorstrand', { lengte: 8000, staafnummerStart: '6', netLagen: 'onder' }, 40, 300),
  symbool('korf', 'wapeningskorf', { lengte: 5000, staafnummerStart: '8', staalkwaliteit: 'B500C' }, 200, 300),
  symbool('kop', 'kopplaat', { profiel: 'HEA 240', aanzicht: 'kop', overstek: 50, boutRijen: 4, boutklasse: '10.9' }, 40, 450),
  symbool('voet', 'voetplaat', { profiel: 'HEB 300', aanzicht: 'zij', ankerAantal: '6', ankerLengte: 450 }, 200, 450),
];

const ALLE = [...new Set(MODELLEN.map((m) => m.symbolId))];

test('elk symbool komt met identieke parameters terug', async () => {
  const bytes = await opslaan(await leegBlad(), MODELLEN);
  const terug = (await laad(bytes)).filter((m) => m.type === 'parametricSymbol');
  assert.equal(terug.length, MODELLEN.length);
  for (const origineel of MODELLEN) {
    const gevonden = terug.filter((m) => m.symbolId === origineel.symbolId
      && JSON.stringify(m.params) === JSON.stringify(origineel.params));
    assert.equal(gevonden.length, 1, `${origineel.id} (${origineel.symbolId}) niet ongewijzigd terug`);
    assert.ok(Math.abs(gevonden[0].x - origineel.x) < 0.01 && Math.abs(gevonden[0].y - origineel.y) < 0.01, `${origineel.id}: positie`);
  }
  assert.deepEqual([...new Set(terug.map((m) => m.symbolId))].sort(), ALLE.sort());
});

test('de buigstaat uit het heropende bestand is gelijk', async () => {
  const voor = buigstaatRegels(stavenVanAnnotaties(MODELLEN, getTemplate));
  const bytes = await opslaan(await leegBlad(), MODELLEN);
  const na = buigstaatRegels(stavenVanAnnotaties(await laad(bytes), getTemplate));
  const kern = (r) => [r.staafnummer, r.diameter, r.vormcode, r.lengteMm, r.aantal, r.staalkwaliteit];
  assert.ok(voor.length >= 10, `verwacht minstens 10 posities, kreeg ${voor.length}`);
  assert.deepEqual(na.map(kern), voor.map(kern));
  const kg = (lijst) => lijst.reduce((s, r) => s + r.massaKg, 0);
  assert.ok(Math.abs(kg(na) - kg(voor)) < 1e-9);
});

test('de IFC-categorie gaat mee naar het bestand', async () => {
  const bytes = await opslaan(await leegBlad(), MODELLEN.map((m) => ({ ...m, ifcCategory: m.symbolId === 'wapeningsnet' ? 'IfcReinforcingMesh' : '' })));
  const net = (await laad(bytes)).find((m) => m.symbolId === 'wapeningsnet');
  assert.equal(net.ifcCategory, 'IfcReinforcingMesh');
  const kop = (await laad(bytes)).find((m) => m.symbolId === 'kopplaat');
  assert.equal(kop.ifcCategory, 'IfcPlate', 'afgeleid uit het symbool-id');
});

test('stavenreeks: staafnummer en staalkwaliteit gaan mee naar het bestand en de buigstaat', async () => {
  const reeks = (id, extra) => ({
    page: 1, rotation: 0, color: '#000000', strokeColor: '#000000', lineWidth: 1, opacity: 1, author: 'User',
    id, type: 'stavenreeks', startX: 60, startY: 600, endX: 200, endY: 600,
    count: 6, diameter: 16, barLengthMm: 4200, legDir: 'down-left', legLength: 36, lineTail: 12, fontSize: 10, labelSide: 'end',
    ...extra,
  });
  const modellen = [
    reeks('r1', { barMark: '12', steelGrade: 'B500C' }),
    reeks('r2', { startY: 640, endY: 640, barLengthMm: 0 }),
  ];
  const terug = (await laad(await opslaan(await leegBlad(), modellen))).filter((m) => m.type === 'stavenreeks');
  assert.equal(terug.length, 2);
  const r1 = terug.find((m) => m.barLengthMm === 4200);
  assert.equal(r1.barMark, '12');
  assert.equal(r1.steelGrade, 'B500C');
  const regels = buigstaatRegels(stavenVanAnnotaties(terug, getTemplate));
  assert.deepEqual(regels.map((r) => [r.staafnummer, r.diameter, r.lengteMm, r.aantal, r.staalkwaliteit]),
    [['12', 16, 4200, 6, 'B500C']], 'de reeks zonder staaflengte komt niet in de staat');
});
