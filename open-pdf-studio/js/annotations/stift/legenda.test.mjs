import assert from 'node:assert/strict';
import test from 'node:test';

import { LEGENDA_MAAT, legendaRegels, legendaIndeling, voorbeeldStift, legendaTekenopdrachten } from './legenda.js';
import { LEGENDA_GROEN, LEGENDA_TEKST } from './tekenopdrachten.js';
import { maakDefinitie } from './definities.js';

const meet = (tekst, grootte, vet) => String(tekst).length * grootte * (vet ? 0.6 : 0.5);

const defs = [
  maakDefinitie('liggerHout', { id: 'hout' }),
  { ...maakDefinitie('vloer', { id: 'vloerB' }), letter: 'B', omschrijving: 'Balklaag 45x145' },
  maakDefinitie('nieuweWand', { id: 'wand', omschrijving: 'HSB-wand 38x184' }),
  maakDefinitie('bestaandeWand', { id: 'bestaand' }),
  maakDefinitie('liggerStaal', { id: 'staal' }),
];
const lijn = (id, x, y, page = 1) => ({ type: 'stift', vorm: 'lijn', page, stiftDefId: id, points: [{ x, y }, { x: x + 10, y }] });

test('regels: gebruikte definities in de volgorde van de soorten, vloer met letter vooraan', () => {
  const annotaties = [
    lijn('hout', 10, 10), lijn('wand', 20, 20), lijn('wand', 30, 30), lijn('bestaand', 40, 40),
    { type: 'stift', vorm: 'pijl', page: 1, stiftDefId: 'vloerB', startX: 0, startY: 50, endX: 100, endY: 50 },
    { type: 'box', page: 1, x: 0, y: 0, width: 5, height: 5 },
  ];
  const regels = legendaRegels({ page: 1, kader: null }, annotaties, defs);
  assert.deepEqual(regels.map((r) => r.definitie.id), ['bestaand', 'wand', 'hout', 'vloerB']);
  assert.equal(regels[3].tekst, 'B  Balklaag 45x145');
  assert.equal(regels[1].tekst, 'HSB-wand 38x184');
});

test('regels: alleen binnen het kader, op dezelfde pagina, met een bekende definitie', () => {
  const annotaties = [lijn('wand', 10, 10), lijn('hout', 500, 500), lijn('staal', 10, 10, 2), lijn('weg', 10, 10)];
  const regels = legendaRegels({ page: 1, kader: { x: 0, y: 0, width: 100, height: 100 } }, annotaties, defs);
  assert.deepEqual(regels.map((r) => r.definitie.id), ['wand']);
});

test('indeling met één kolom: kop, regels onder elkaar, breedte uit de langste tekst', () => {
  const M = LEGENDA_MAAT;
  const regels = [{ definitie: defs[3], tekst: 'Bestaande wand' }, { definitie: defs[2], tekst: 'HSB-wand 38x184' }];
  const ind = legendaIndeling({ x: 100, y: 200, kop: 'Constructie 1e verdieping', kolommen: 1 }, regels, meet);
  assert.equal(ind.kop.tekst, 'CONSTRUCTIE 1E VERDIEPING');
  assert.equal(ind.kolommen, 1);
  assert.equal(ind.rijen.length, 2);
  const tekstVak = 15 * 12 * 0.5 + 2 * M.marge;
  assert.ok(Math.abs(ind.rijen[0].tekstVak.b - tekstVak) < 1e-9);
  assert.equal(ind.rijen[0].voorbeeldVak.x, 100);
  assert.ok(Math.abs(ind.rijen[1].voorbeeldVak.y - (200 + M.rij + M.tussen + M.rij + M.tussen)) < 1e-9);
  const kopBreedte = 25 * 12 * 0.6 + 2 * M.marge;
  assert.ok(Math.abs(ind.breedte - Math.max(kopBreedte, M.voorbeeld + M.tussen + tekstVak)) < 1e-9);
  assert.ok(Math.abs(ind.hoogte - (M.rij + M.tussen + 2 * M.rij + M.tussen)) < 1e-9);
});

test('twee kolommen: de eerste krijgt er één meer bij een oneven aantal', () => {
  const regels = defs.map((d) => ({ definitie: d, tekst: d.omschrijving }));
  const ind = legendaIndeling({ x: 0, y: 0, kolommen: 2 }, regels, meet);
  assert.equal(ind.kolommen, 2);
  const xs = [...new Set(ind.rijen.map((r) => r.voorbeeldVak.x))];
  assert.equal(xs.length, 2);
  assert.equal(ind.rijen.filter((r) => r.voorbeeldVak.x === xs[0]).length, 3);
  assert.equal(ind.rijen.filter((r) => r.voorbeeldVak.x === xs[1]).length, 2);
  assert.equal(legendaIndeling({ x: 0, y: 0, kolommen: 2 }, regels.slice(0, 1), meet).kolommen, 1);
});

test('zonder regels: alleen de kop', () => {
  const ind = legendaIndeling({ x: 0, y: 0 }, [], meet);
  assert.equal(ind.kop.tekst, 'CONSTRUCTIE');
  assert.equal(ind.hoogte, LEGENDA_MAAT.rij);
  assert.deepEqual(ind.rijen, []);
});

test('voorbeeldstiften passen in het vak van een regel', () => {
  const vak = { x: 0, y: 0, b: LEGENDA_MAAT.voorbeeld, h: LEGENDA_MAAT.rij };
  assert.equal(voorbeeldStift(defs[0], vak).vorm, 'lijn');
  const pijl = voorbeeldStift(defs[1], vak);
  assert.equal(pijl.startY, 7.5);
  const kruis = voorbeeldStift(maakDefinitie('sparing', { id: 's' }), vak);
  assert.ok(kruis.height <= vak.h && kruis.width <= vak.b);
  const punt = voorbeeldStift(maakDefinitie('paal', { id: 'p' }), vak);
  assert.deepEqual([punt.x, punt.y], [vak.b / 2, 7.5]);
});

test('tekenopdrachten: groene kop met vette tekst, per regel voorbeeld, groen vak en tekst', () => {
  const regels = [{ definitie: defs[2], tekst: 'HSB-wand 38x184' }];
  const ind = legendaIndeling({ x: 0, y: 0, kop: 'Dak' }, regels, meet);
  const opdrachten = legendaTekenopdrachten(ind, meet);
  assert.equal(opdrachten[0].soort, 'rechthoek');
  assert.equal(opdrachten[0].vulling, LEGENDA_GROEN);
  assert.equal(opdrachten[1].tekst, 'DAK');
  assert.equal(opdrachten[1].vet, true);
  assert.equal(opdrachten[1].kleur, LEGENDA_TEKST);
  const laatste = opdrachten.at(-1);
  assert.equal(laatste.tekst, 'HSB-wand 38x184');
  assert.equal(laatste.vet, false);
  assert.equal(opdrachten.at(-2).vulling, LEGENDA_GROEN);
  assert.ok(opdrachten.some((o) => o.soort === 'lijn' && o.kleur === '#FF0000'), 'het voorbeeld is de stift zelf');
});
