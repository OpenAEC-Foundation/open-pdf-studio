// De ruimte en haar tag (#477): de ruimte (het ruimtevlak) is het object met
// naam, nummer en oppervlakte; de tag toont wat de ruimte heeft. Een ruimte
// is niet aan haar rand te pakken (daar liggen de wanden), wel via haar tag.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isRuimteVlak, raakbaarBijKlik, inSelectieVak, ruimteVanTag, tagsVanRuimte,
  oppervlakteM2Van, tagWeergaveParams, tagWijziging, ruimteNaamPatch,
} from './ruimte-koppeling.js';

const vierkant = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }];
const ruimte = {
  id: 'r1', type: 'measureArea', page: 1, points: vierkant,
  opsRuimteZaad: { x: 50, y: 40 }, opsRuimteNaam: 'Woonkamer', opsRuimteNummer: '0.01',
  measureValue: 24_500_000, measureUnit: 'mm²',
};
const tag = {
  id: 't1', type: 'parametricSymbol', symbolId: 'room-tag', page: 1,
  x: 30, y: 30, width: 40, height: 20,
  params: { naam: 'Oude naam', nummer: '', oppervlakteM2: 1, decimalen: 1, toonOppervlakte: true, zaadX: 50, zaadY: 40 },
};
const gewoonVlak = { id: 'm', type: 'measureArea', page: 1, points: vierkant, measureValue: 3, measureUnit: 'm²' };
const wand = { id: 'w', type: 'wall', page: 1, startX: 0, startY: 0, endX: 100, endY: 0 };

test('een ruimte uit de plattegrond herkennen', () => {
  assert.equal(isRuimteVlak(ruimte), true);
  assert.equal(isRuimteVlak({ ...ruimte, opsRuimteZaad: undefined }), true, 'alleen een naam is ook een ruimte');
  assert.equal(isRuimteVlak({ ...ruimte, opsRuimteZaad: undefined, opsRuimteNaam: undefined }), false);
  assert.equal(isRuimteVlak(gewoonVlak), false, 'een gewoon meetvlak niet');
  assert.equal(isRuimteVlak(tag), false);
});

test('een ruimte is met een klik niet te pakken, al het andere wel', () => {
  // Haar rand ligt op de wandvlakken en haar binnenkant is waar je een
  // selectierechthoek begint: de ruimte selecteer je via haar tag.
  assert.equal(raakbaarBijKlik(ruimte), false);
  assert.equal(raakbaarBijKlik(gewoonVlak), true, 'een gewoon meetvlak houdt zijn gedrag');
  assert.equal(raakbaarBijKlik(wand), true);
  assert.equal(raakbaarBijKlik(tag), true);
});

test('een sleepvak pakt een ruimte alleen als ze er helemaal in ligt', () => {
  const rb = { x: 0, y: 0, width: 100, height: 80 };
  const klein = { x: 10, y: -5, width: 30, height: 20 };      // om een stuk wand
  const groot = { x: -10, y: -10, width: 200, height: 200 };  // om de hele plattegrond
  for (const mode of ['window', 'crossing']) {
    assert.equal(inSelectieVak(ruimte, rb, klein, mode), false, `${mode}: niet per ongeluk`);
    assert.equal(inSelectieVak(ruimte, rb, groot, mode), true, `${mode}: de hele plattegrond`);
  }
  // Andere annotaties volgen de gewone regels: crossing raakt, window omsluit.
  assert.equal(inSelectieVak(gewoonVlak, rb, klein, 'crossing'), true);
  assert.equal(inSelectieVak(gewoonVlak, rb, klein, 'window'), false);
  assert.equal(inSelectieVak(wand, { x: 0, y: -2, width: 100, height: 4 }, klein, 'crossing'), true);
});

test('de tag vindt zijn ruimte via het zaadpunt, of via zijn plek', () => {
  const lijst = [wand, gewoonVlak, ruimte, tag];
  assert.equal(ruimteVanTag(tag, lijst), ruimte);
  // Een los uit de symboolbibliotheek geplaatste tag: de ruimte waar hij in staat.
  const los = { ...tag, id: 't2', params: { naam: 'Ruimte' } };
  assert.equal(ruimteVanTag(los, lijst), ruimte);
  // Buiten elke ruimte: geen koppeling.
  assert.equal(ruimteVanTag({ ...los, x: 500, y: 500 }, lijst), null);
  // Andere pagina telt niet.
  assert.equal(ruimteVanTag({ ...tag, page: 2 }, lijst), null);
  assert.deepEqual(tagsVanRuimte(ruimte, [...lijst, los]).map((t) => t.id), ['t1', 't2']);
});

test('de netto oppervlakte in m², uit de meting van de ruimte', () => {
  assert.equal(oppervlakteM2Van(ruimte), 24.5);
  assert.equal(oppervlakteM2Van({ measureValue: 12, measureUnit: 'm²' }), 12);
  assert.equal(oppervlakteM2Van({ measureValue: 120000, measureUnit: 'cm²' }), 12);
  assert.equal(oppervlakteM2Van({ measureValue: 5, measureUnit: 'px²' }), null, 'onbekende eenheid');
  assert.equal(oppervlakteM2Van({}), null);
});

test('de tag toont wat de ruimte heeft, geen eigen kopie', () => {
  const p = tagWeergaveParams(tag, [ruimte, tag]);
  assert.equal(p.naam, 'Woonkamer');
  assert.equal(p.nummer, '0.01');
  assert.equal(p.oppervlakteM2, 24.5);
  assert.equal(p.decimalen, 1, 'de opmaak blijft van de tag');
  // Zonder ruimte: de eigen waarden van de tag.
  assert.deepEqual(tagWeergaveParams(tag, [tag]), tag.params);
  // Een gewoon symbool: ongewijzigd.
  const deur = { type: 'parametricSymbol', symbolId: 'door', params: { width: 900 } };
  assert.equal(tagWeergaveParams(deur, [ruimte]), deur.params);
});

test('een naam in de tag wijzigen wijzigt de ruimte', () => {
  const w = tagWijziging(tag, ruimte, { ...tag.params, naam: 'Keuken', nummer: '0.02', decimalen: 2 });
  assert.deepEqual(w.ruimtePatch, { opsRuimteNaam: 'Keuken', measureName: 'Keuken', opsRuimteNummer: '0.02' });
  assert.equal(w.tagParams.decimalen, 2, 'opmaak blijft op de tag');
  assert.equal(w.tagParams.naam, 'Keuken', 'de tag houdt een reservekopie voor als de ruimte ontbreekt');
  // Alleen de opmaak gewijzigd: de ruimte blijft zoals ze is.
  const alleenOpmaak = tagWijziging(tag, ruimte, { ...tagWeergaveParams(tag, [ruimte]), decimalen: 0 });
  assert.equal(alleenOpmaak.ruimtePatch, null);
  // Zonder ruimte: alles op de tag.
  assert.equal(tagWijziging(tag, null, { ...tag.params, naam: 'X' }).ruimtePatch, null);
});

test('naam en nummer op de ruimte zetten', () => {
  assert.deepEqual(ruimteNaamPatch('Hal', '0.03'), { opsRuimteNaam: 'Hal', measureName: 'Hal', opsRuimteNummer: '0.03' });
  assert.deepEqual(ruimteNaamPatch('Hal', undefined), { opsRuimteNaam: 'Hal', measureName: 'Hal' });
  assert.deepEqual(ruimteNaamPatch(undefined, ''), { opsRuimteNummer: '' });
  assert.deepEqual(ruimteNaamPatch(' Berging ', null), { opsRuimteNaam: 'Berging', measureName: 'Berging' });
});
