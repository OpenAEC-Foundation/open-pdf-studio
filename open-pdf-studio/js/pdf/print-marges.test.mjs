// Page Setup margins reach the printed sheet, and take decimal numbers (#1236).
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { leesMarge, paginaMarges, bedrukbaarMetMarges } from './print-marges.js';
import { berekenPlaatsing } from './print-plaatsing.js';

test('a margin field takes decimal numbers with a point or a comma', () => {
  assert.equal(leesMarge('2.5'), 2.5);
  assert.equal(leesMarge('2,5'), 2.5);
  assert.equal(leesMarge('10'), 10);
  assert.equal(leesMarge(7.25), 7.25);
  assert.equal(leesMarge(''), 0);
  assert.equal(leesMarge('abc'), 0);
  assert.equal(leesMarge('-3'), 0);
  assert.equal(leesMarge('999'), 200);
});

test('the four fields map to the four sides', () => {
  assert.deepEqual(paginaMarges({ marginLeft: '10', marginTop: '2,5', marginRight: 20, marginBottom: '' }),
    { links: 10, boven: 2.5, rechts: 20, onder: 0 });
  assert.deepEqual(paginaMarges(null), { links: 0, boven: 0, rechts: 0, onder: 0 });
});

test('without margins the answer of the printer is left alone', () => {
  const printer = { staand: { links: 4, boven: 4, rechts: 4, onder: 4 }, liggend: { links: 4, boven: 4, rechts: 4, onder: 4 } };
  assert.equal(bedrukbaarMetMarges(printer, { marginLeft: 0, marginTop: 0, marginRight: 0, marginBottom: 0 }), printer);
  assert.equal(bedrukbaarMetMarges(null, {}), null);
});

test('per side the larger of the printer edge and the chosen margin', () => {
  const printer = { staand: { links: 4, boven: 6, rechts: 4, onder: 12 }, liggend: null };
  const uit = bedrukbaarMetMarges(printer, { marginLeft: 20, marginTop: 2.5, marginRight: 20, marginBottom: 10 });
  assert.deepEqual(uit.staand, { links: 20, boven: 6, rechts: 20, onder: 12 });
  assert.deepEqual(uit.liggend, { links: 20, boven: 2.5, rechts: 20, onder: 10 });
  // An unknown printer edge: the chosen margins alone.
  assert.deepEqual(bedrukbaarMetMarges(null, { marginLeft: 15, marginTop: 15, marginRight: 15, marginBottom: 15 }).staand,
    { links: 15, boven: 15, rechts: 15, onder: 15 });
});

test('a fitted page stays inside the chosen margins', () => {
  const a4 = { breedteMm: 210, hoogteMm: 297 };
  const pagina = { breedtePt: 595.28, hoogtePt: 841.89 };
  const keuzes = (bedrukbaar) => ({ papier: { ...a4, bedrukbaar }, orientatie: 'portrait', schaling: 'fit', zoom: 100, centreren: true });
  const zonder = berekenPlaatsing({ ...keuzes(null), pagina });
  const met = berekenPlaatsing({ pagina, ...keuzes(bedrukbaarMetMarges(null, { marginLeft: 25, marginTop: 25, marginRight: 25, marginBottom: 25 })) });
  assert.ok(met.bedrukbaar.breedte < zonder.bedrukbaar.breedte, 'the printable area is narrower');
  assert.ok(Math.abs(met.bedrukbaar.breedte - 160) < 0.01 && Math.abs(met.bedrukbaar.x - 25) < 0.01);
  assert.ok(met.pagina.x >= 25 - 0.01 && met.pagina.x + met.pagina.breedte <= 185 + 0.01, 'the page lies between the left and right margin');
  assert.ok(met.pagina.y >= 25 - 0.01 && met.pagina.y + met.pagina.hoogte <= 272 + 0.01, 'and between the top and bottom margin');
});

test('the dialogs use the margins: decimal input and the print layout', () => {
  const lees = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  const instelling = lees('../solid/components/dialogs/PageSetupDialog.jsx');
  assert.doesNotMatch(instelling, /parseInt\(margin/, 'no whole-number rounding of margins');
  assert.match(instelling, /leesMarge\(marginLeft\(\)\)/);
  assert.match(lees('../solid/components/dialogs/PrintDialog.jsx'), /bedrukbaarMetMarges\(/);
});
