// Draagstructuur op het raster: kolommen, balken en vloervelden.
import assert from 'node:assert/strict';
import test from 'node:test';

import { RasterFout, maakRaster } from './raster.js';
import { balken, kolommen, ontleedProfiel, peilTekst, vloervelden } from './draagstructuur.js';

function vangFout(fn) {
  try { fn(); } catch (e) { return e; }
  assert.fail('verwachtte een fout');
}

const raster2x1 = () => maakRaster({
  oorsprong: { x: 0, y: 0 }, veldenX: '2x5400', veldenY: [6000], schaal: '1:100',
});

test('de NL-schrijfwijze HE200B wordt het profiel HEB 200', () => {
  const p = ontleedProfiel('HE200B');
  assert.equal(p.soort, 'staal');
  assert.equal(p.symbolId, 'staal-heb');
  assert.equal(p.maat, 'HEB 200');
  assert.equal(ontleedProfiel('HE 300 A').maat, 'HEA 300');
});

test('de familie-schrijfwijze werkt met en zonder spatie', () => {
  assert.equal(ontleedProfiel('IPE300').maat, 'IPE 300');
  assert.equal(ontleedProfiel('ipe 300').symbolId, 'staal-ipe');
  assert.equal(ontleedProfiel('UNP-200').maat, 'UNP 200');
  assert.equal(ontleedProfiel('HEB 240').maat, 'HEB 240');
});

test('kokers en hoeklijnen krijgen de maat die het symbool kent', () => {
  assert.deepEqual(
    { id: ontleedProfiel('Koker 100x100x5').symbolId, maat: ontleedProfiel('Koker 100x100x5').maat },
    { id: 'staal-koker', maat: 'Koker 100x100x5' },
  );
  assert.equal(ontleedProfiel('L 100x100x10').symbolId, 'staal-hoeklijn');
  assert.equal(ontleedProfiel('L100x100x10').maat, 'L 100x100x10');
});

test('een betondoorsnede komt als breedte en hoogte binnen', () => {
  const p = ontleedProfiel('300x500');
  assert.equal(p.soort, 'beton');
  assert.equal(p.breedteMm, 300);
  assert.equal(p.hoogteMm, 500);
  assert.equal(p.naam, '300x500');
});

test('een onbekend profiel wordt geweigerd', () => {
  const fout = vangFout(() => ontleedProfiel('zwaar'));
  assert.ok(fout instanceof RasterFout);
  assert.equal(fout.code, 'profiel');
  assert.throws(() => ontleedProfiel(''), RasterFout);
});

test('een peil leest als op de tekening', () => {
  assert.equal(peilTekst(3000), '+3.000');
  assert.equal(peilTekst(0), '+0.000');
  assert.equal(peilTekst(-500), '-0.500');
  assert.equal(peilTekst(12250), '+12.250');
  // Afronding mag de hele meter meenemen, niet "+3.1000" maken.
  assert.equal(peilTekst(2999.7), '+3.000');
  assert.equal(peilTekst(null), '');
});

test('kolommen staan op elke knoop en zijn doorlopend genummerd', () => {
  const k = kolommen(raster2x1(), { profiel: 'HE200B', peilMm: 3000 });
  assert.equal(k.length, 6);
  assert.deepEqual(k.map(c => c.id), ['K1', 'K2', 'K3', 'K4', 'K5', 'K6']);
  // Leesvolgorde: eerst de bovenste rij van links naar rechts.
  assert.deepEqual(k.slice(0, 3).map(c => c.knoop), ['A-2', 'B-2', 'C-2']);
  assert.equal(k[0].ifcCategory, 'IfcColumn');
  assert.equal(k[0].peilMm, 3000);
  assert.equal(k[0].profiel.maat, 'HEB 200');
});

test('een knoop zonder kolom wordt overgeslagen zonder gat in de nummering', () => {
  const k = kolommen(raster2x1(), { profiel: 'HE200B', overslaan: ['A-2'] });
  assert.equal(k.length, 5);
  assert.equal(k[0].id, 'K1');
  assert.equal(k[0].knoop, 'B-2');
  assert.ok(!k.some(c => c.knoop === 'A-2'));
});

test('balken liggen tussen twee knopen en kennen hun overspanning', () => {
  const r = raster2x1();
  const b = balken(r, { profiel: '300x500', richting: 'x' });
  // Twee horizontale rasterlijnen, elk twee velden breed.
  assert.equal(b.length, 4);
  assert.equal(b[0].id, 'L1');
  assert.equal(b[0].van, 'A-2');
  assert.equal(b[0].naar, 'B-2');
  assert.equal(b[0].overspanningMm, 5400);
  assert.equal(b[0].ifcCategory, 'IfcBeam');
  assert.equal(b[0].startY, b[0].endY);
  assert.ok(b[0].endX > b[0].startX);
});

test('in beide richtingen liggen er balken op elke rasterlijn', () => {
  const b = balken(raster2x1(), { profiel: '300x500', richting: 'beide' });
  // 2 lijnen x 2 velden in x, plus 3 lijnen x 1 veld in y.
  assert.equal(b.length, 4 + 3);
  assert.equal(b.filter(x => x.as === 'y').length, 3);
  assert.equal(b.find(x => x.as === 'y').overspanningMm, 6000);
});

test('alleen randliggers laat de binnenlijnen leeg', () => {
  const r = maakRaster({
    oorsprong: { x: 0, y: 0 }, veldenX: '2x5000', veldenY: '2x5000', schaal: '1:100',
  });
  const alles = balken(r, { profiel: '300x500', richting: 'x' });
  const rand = balken(r, { profiel: '300x500', richting: 'x', alleenRand: true });
  assert.equal(alles.length, 6);   // drie lijnen x twee velden
  assert.equal(rand.length, 4);    // alleen de bovenste en de onderste lijn
});

test('een onbekende balkrichting wordt geweigerd', () => {
  const fout = vangFout(() => balken(raster2x1(), { richting: 'diagonaal' }));
  assert.ok(fout instanceof RasterFout);
  assert.equal(fout.code, 'richting');
});

test('vloervelden overspannen standaard over de kortste maat', () => {
  const r = raster2x1(); // velden van 5400 breed x 6000 hoog
  const v = vloervelden(r, { dikteMm: 260, peilMm: 3000 });
  assert.equal(v.length, 2);
  assert.equal(v[0].id, 'V1');
  assert.equal(v[0].overspanningsrichting, 'x');
  assert.equal(v[0].overspanningMm, 5400);
  assert.equal(v[0].dikteMm, 260);
  assert.equal(v[0].ifcCategory, 'IfcSlab');
});

test('een opgelegde overspanningsrichting wint van de kortste maat', () => {
  const v = vloervelden(raster2x1(), { richting: 'y' });
  assert.equal(v[0].overspanningsrichting, 'y');
  assert.equal(v[0].overspanningMm, 6000);
});

test('het vloerveld draagt het veldlabel van het raster', () => {
  const v = vloervelden(raster2x1(), {});
  assert.deepEqual(v.map(x => x.veld), ['A1', 'B1']);
});
