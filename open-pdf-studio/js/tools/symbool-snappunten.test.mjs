import assert from 'node:assert/strict';
import test from 'node:test';

import { symboolSnappunten } from './symbool-snappunten.js';
import { ankerPunt } from '../symbols/anker.js';

const ALLES = { endpoints: true, midpoints: true, centers: true };

// Een template met zijn snappunten in het ONgedraaide vak: de vier hoeken,
// het midden van de bovenrand en het midden.
const hoekTemplate = {
  snapPoints(_params, b) {
    return [
      { x: b.x, y: b.y, kind: 'endpoint' },
      { x: b.x + b.width, y: b.y, kind: 'endpoint' },
      { x: b.x, y: b.y + b.height, kind: 'endpoint' },
      { x: b.x + b.width, y: b.y + b.height, kind: 'endpoint' },
      { x: b.x + b.width / 2, y: b.y, kind: 'midpoint' },
      { x: b.x + b.width / 2, y: b.y + b.height / 2, kind: 'center' },
    ];
  },
};

function symbool(rotation) {
  return { type: 'parametricSymbol', x: 100, y: 100, width: 40, height: 20, rotation, params: {} };
}

function dichtbij(werkelijk, verwacht, melding) {
  assert.ok(Math.abs(werkelijk.x - verwacht.x) < 1e-9 && Math.abs(werkelijk.y - verwacht.y) < 1e-9,
    `${melding}: (${werkelijk.x}, ${werkelijk.y}) is niet (${verwacht.x}, ${verwacht.y})`);
}

test('ongedraaid symbool geeft dezelfde punten als de template', () => {
  for (const rotation of [undefined, 0, null]) {
    const punten = symboolSnappunten(symbool(rotation), hoekTemplate, ALLES);
    assert.deepEqual(punten, [
      { x: 100, y: 100, type: 'endpoint' },
      { x: 140, y: 100, type: 'endpoint' },
      { x: 100, y: 120, type: 'endpoint' },
      { x: 140, y: 120, type: 'endpoint' },
      { x: 120, y: 100, type: 'midpoint' },
      { x: 120, y: 110, type: 'center' },
    ]);
  }
});

test('gedraaid symbool: de hoekpunten liggen op de getekende hoeken', () => {
  // De getekende hoeken volgen de renderer (draaien om het midden van het
  // vak, met de klok mee); ankerPunt rekent met dezelfde regel.
  const vak = { x: 100, y: 100, width: 40, height: 20 };
  for (const rotation of [90, 180, 270, 33]) {
    const [linksboven, rechtsboven, , , bovenMidden, midden] =
      symboolSnappunten(symbool(rotation), hoekTemplate, ALLES);
    dichtbij(linksboven, ankerPunt(vak, rotation, 'back-left'), `linksboven bij ${rotation}°`);
    dichtbij(rechtsboven, ankerPunt(vak, rotation, 'back-right'), `rechtsboven bij ${rotation}°`);
    dichtbij(bovenMidden, ankerPunt(vak, rotation, 'back'), `midden bovenrand bij ${rotation}°`);
    dichtbij(midden, { x: 120, y: 110 }, `midden bij ${rotation}°`);
  }
});

test('kwartslag: de linkerbovenhoek komt rechtsboven het gedraaide vak', () => {
  // Vak 40×20 om (120, 110) een kwartslag gedraaid beslaat x 110..130 en
  // y 90..130; de oude linkerbovenhoek ligt dan op (130, 90).
  const [linksboven] = symboolSnappunten(symbool(90), hoekTemplate, ALLES);
  dichtbij(linksboven, { x: 130, y: 90 }, 'linksboven bij 90°');
  const [bij180] = symboolSnappunten(symbool(180), hoekTemplate, ALLES);
  dichtbij(bij180, { x: 140, y: 120 }, 'linksboven bij 180°');
  const [bij270] = symboolSnappunten(symbool(270), hoekTemplate, ALLES);
  dichtbij(bij270, { x: 110, y: 130 }, 'linksboven bij 270°');
});

test('zonder snapPoints: de hoeken en middens van het vak draaien mee', () => {
  const ongedraaid = symboolSnappunten(symbool(0), {}, ALLES);
  assert.deepEqual(ongedraaid.map((p) => p.type),
    ['corner', 'corner', 'corner', 'corner', 'midpoint', 'midpoint', 'midpoint', 'midpoint', 'center']);
  assert.deepEqual(ongedraaid[0], { x: 100, y: 100, type: 'corner' });

  const gedraaid = symboolSnappunten(symbool(90), null, ALLES);
  assert.equal(gedraaid.length, 9);
  dichtbij(gedraaid[0], { x: 130, y: 90 }, 'hoek linksboven bij 90°');
  dichtbij(gedraaid[8], { x: 120, y: 110 }, 'midden bij 90°');
  assert.equal(gedraaid[0].type, 'corner');
});

test('tweepuntssymbool: de eindpunten draaien niet nog een keer', () => {
  const stramien = { placement: 'two-point', snapPoints: () => { throw new Error('niet gebruikt'); } };
  const ann = { ...symbool(90), startX: 10, startY: 20, endX: 10, endY: 220 };
  assert.deepEqual(symboolSnappunten(ann, stramien, ALLES), [
    { x: 10, y: 20, type: 'endpoint' },
    { x: 10, y: 220, type: 'endpoint' },
    { x: 10, y: 120, type: 'midpoint' },
  ]);
});

test('alleen de gevraagde soorten punten', () => {
  const alleenMidden = symboolSnappunten(symbool(90), hoekTemplate, { centers: true });
  assert.deepEqual(alleenMidden.map((p) => p.type), ['center']);
  const geenMidden = symboolSnappunten(symbool(0), null, { endpoints: true, midpoints: true });
  assert.equal(geenMidden.length, 8);
  assert.ok(geenMidden.every((p) => p.type !== 'center'));
  assert.deepEqual(symboolSnappunten(symbool(45), hoekTemplate, {}), []);
});

test('vak zonder maat geeft geen terugvalpunten', () => {
  const ann = { type: 'parametricSymbol', x: 5, y: 5, rotation: 90 };
  assert.deepEqual(symboolSnappunten(ann, null, ALLES), []);
});
