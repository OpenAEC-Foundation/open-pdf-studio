// Het schrijfpad van een vectorknipsel: appearance-ops, de bronpagina op de
// catalogus, en de ontdubbeling daarvan.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';

import {
  knipselApOps, registreerBron, bouwKnipselAppearance, CATALOGUS_SLEUTEL,
} from './vector-snippet.js';

const VAK = { left: 100, bottom: 80, right: 220, top: 140 };  // 120 x 60

async function bron() {
  const d = await PDFDocument.create();
  const p = d.addPage([600, 400]);
  p.drawRectangle({ x: 100, y: 80, width: 120, height: 60 });
  return d.save();
}

// --- appearance-ops -------------------------------------------------------

test('de ops schalen het knipsel naar de Rect en verschuiven het erheen', () => {
  const ops = knipselApOps([50, 40, 290, 160], 120, 60, 'OPSK0');
  assert.equal(ops, 'q 2 0 0 2 50 40 cm /OPSK0 Do Q');
});

test('een Rect met dezelfde maat als het knipsel geeft schaal 1', () => {
  assert.equal(knipselApOps([0, 0, 120, 60], 120, 60, 'OPSK0'), 'q 1 0 0 1 0 0 cm /OPSK0 Do Q');
});

test('ongelijke schaling in x en y is toegestaan (de gebruiker mag uitrekken)', () => {
  assert.equal(knipselApOps([0, 0, 240, 60], 120, 60, 'OPSK0'), 'q 2 0 0 1 0 0 cm /OPSK0 Do Q');
});

test('een leeg knipsel of een leeg doelvak levert geen ops', () => {
  assert.equal(knipselApOps([0, 0, 100, 100], 0, 60, 'X'), null);
  assert.equal(knipselApOps([0, 0, 100, 100], 120, 0, 'X'), null);
  assert.equal(knipselApOps([10, 10, 10, 100], 120, 60, 'X'), null);
  assert.equal(knipselApOps(null, 120, 60, 'X'), null);
});

// --- bronpagina op de catalogus -------------------------------------------

test('de bronpagina komt in een woordenboek op de catalogus', async () => {
  const doel = await PDFDocument.create();
  doel.addPage([300, 300]);
  await registreerBron(doel, 'aaaabbbbccccdddd', await bron());
  const heropend = await PDFDocument.load(await doel.save());
  const wb = heropend.catalog.lookup(PDFName.of(CATALOGUS_SLEUTEL));
  assert.ok(wb, 'woordenboek ontbreekt');
  assert.deepEqual(wb.keys().map((k) => k.asString()), ['/aaaabbbbccccdddd']);
});

test('dezelfde sleutel twee keer registreren levert één stream', async () => {
  const doel = await PDFDocument.create();
  doel.addPage([300, 300]);
  const bytes = await bron();
  const a = await registreerBron(doel, 'aaaabbbbccccdddd', bytes);
  const b = await registreerBron(doel, 'aaaabbbbccccdddd', bytes);
  assert.equal(a.toString(), b.toString(), 'zelfde ref');
  const heropend = await PDFDocument.load(await doel.save());
  const wb = heropend.catalog.lookup(PDFName.of(CATALOGUS_SLEUTEL));
  assert.equal(wb.keys().length, 1);
});

test('twee verschillende bronnen krijgen elk hun eigen stream', async () => {
  const doel = await PDFDocument.create();
  doel.addPage([300, 300]);
  await registreerBron(doel, 'aaaabbbbccccdddd', await bron());
  await registreerBron(doel, '1111222233334444', await bron());
  const heropend = await PDFDocument.load(await doel.save());
  const wb = heropend.catalog.lookup(PDFName.of(CATALOGUS_SLEUTEL));
  assert.equal(wb.keys().length, 2);
});

// --- het geheel -----------------------------------------------------------

test('bouwKnipselAppearance levert ops plus het XObject om ze aan te hangen', async () => {
  const doel = await PDFDocument.create();
  doel.addPage([600, 600]);
  const r = await bouwKnipselAppearance(doel, {
    bronBytes: await bron(), srcBox: VAK, rect: [50, 50, 290, 170], sleutel: 'aaaabbbbccccdddd',
  });
  assert.deepEqual([r.breedte, r.hoogte], [120, 60]);
  assert.equal(r.content, 'q 2 0 0 2 50 50 cm /OPSK0 Do Q');
  assert.deepEqual(Object.keys(r.xobjects), ['OPSK0']);
  assert.ok(r.bronRef, 'bronpagina geregistreerd');
});

test('zonder bronbytes weigert het schrijfpad in plaats van een leeg knipsel te maken', async () => {
  const doel = await PDFDocument.create();
  doel.addPage([600, 600]);
  await assert.rejects(
    () => bouwKnipselAppearance(doel, { bronBytes: null, srcBox: VAK, rect: [0, 0, 10, 10], sleutel: 'x' }),
    /geen bronbytes/,
  );
});

test('een ontaard doelvak weigert ook', async () => {
  const doel = await PDFDocument.create();
  doel.addPage([600, 600]);
  const bytes = await bron();
  await assert.rejects(
    () => bouwKnipselAppearance(doel, {
      bronBytes: bytes, srcBox: VAK, rect: [50, 50, 50, 170], sleutel: 'aaaabbbbccccdddd',
    }),
    /geen oppervlak/,
  );
});
