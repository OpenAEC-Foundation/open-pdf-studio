import { test } from 'node:test';
import assert from 'node:assert/strict';
import { omhullendKader, centreerVerschuiving, puntOpPagina } from './plak-bij-muis.js';

test('omhullend kader van meerdere kaders', () => {
  const k = omhullendKader([
    { x: 10, y: 20, width: 30, height: 10 },
    { x: 50, y: 5, width: 10, height: 10 },
  ]);
  assert.deepEqual(k, { x: 10, y: 5, width: 50, height: 25 });
});

test('omhullend kader negeert ongeldige kaders, null zonder geldige', () => {
  assert.equal(omhullendKader([]), null);
  assert.equal(omhullendKader([null, { x: NaN, y: 0, width: 1, height: 1 }]), null);
  assert.deepEqual(omhullendKader([null, { x: 1, y: 2, width: 3, height: 4 }]), { x: 1, y: 2, width: 3, height: 4 });
});

test('centreren legt het midden van het kader op het punt', () => {
  const kader = { x: 10, y: 20, width: 40, height: 20 }; // midden (30, 30)
  assert.deepEqual(centreerVerschuiving(kader, { x: 100, y: 200 }), { dx: 70, dy: 170 });
  assert.deepEqual(centreerVerschuiving(null, { x: 1, y: 1 }), { dx: 0, dy: 0 });
});

test('groep behoudt onderlinge ligging na centreren', () => {
  const kaders = [
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 30, y: 40, width: 10, height: 10 },
  ];
  const { dx, dy } = centreerVerschuiving(omhullendKader(kaders), { x: 500, y: 500 });
  const verplaatst = kaders.map(b => ({ ...b, x: b.x + dx, y: b.y + dy }));
  assert.equal(verplaatst[1].x - verplaatst[0].x, 30);
  assert.equal(verplaatst[1].y - verplaatst[0].y, 40);
  const nieuw = omhullendKader(verplaatst);
  assert.equal(nieuw.x + nieuw.width / 2, 500);
  assert.equal(nieuw.y + nieuw.height / 2, 500);
});

test('punt op of naast de pagina', () => {
  const maat = { breedte: 595, hoogte: 842 };
  assert.equal(puntOpPagina({ x: 0, y: 0 }, maat), true);
  assert.equal(puntOpPagina({ x: 595, y: 842 }, maat), true);
  assert.equal(puntOpPagina({ x: -1, y: 10 }, maat), false);
  assert.equal(puntOpPagina({ x: 10, y: 843 }, maat), false);
  assert.equal(puntOpPagina(null, maat), false);
  assert.equal(puntOpPagina({ x: 1, y: 1 }, null), false);
});
