// Rekenwerk van gedraaide markeringsquads (#944, #927).

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  vlakQuad, vakUitVlakQuad, isSchuin, quadHoek, quadsUitQuadPoints, markeringUitQuads,
  gedraaideMarkeringUitBestand,
} from './markering-quads.js';

const dichtbij = (a, b, msg, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('vlakQuad: zonder draaiing geen quad', () => {
  assert.equal(vlakQuad({ x: 10, y: 20, width: 100, height: 30 }), null);
  assert.equal(vlakQuad({ x: 10, y: 20, width: 100, height: 30, rotation: 0 }), null);
});

test('vlakQuad: begin-boven, eind-boven, begin-onder, eind-onder, gedraaid zoals ctx.rotate', () => {
  // 90 graden met de klok mee om het midden (60, 35): linksboven (10, 20)
  // komt rechtsboven op (75, -15).
  const q = vlakQuad({ x: 10, y: 20, width: 100, height: 30, rotation: 90 });
  const verwacht = [{ x: 75, y: -15 }, { x: 75, y: 85 }, { x: 45, y: -15 }, { x: 45, y: 85 }];
  q.forEach((p, i) => { dichtbij(p.x, verwacht[i].x, `p${i + 1} x`); dichtbij(p.y, verwacht[i].y, `p${i + 1} y`); });
  dichtbij(quadHoek(q), 90, 'hoek p1 -> p2');
});

test('vakUitVlakQuad is het omgekeerde van vlakQuad', () => {
  for (const rotation of [40, -40, 90, 135, 180, -90, 359, 12.5]) {
    const ann = { x: 72, y: 90.4, width: 140, height: 22, rotation };
    const terug = vakUitVlakQuad(vlakQuad(ann), rotation);
    for (const k of ['x', 'y', 'width', 'height']) dichtbij(terug[k], ann[k], `${k} bij ${rotation}`, 1e-6);
    assert.equal(terug.rotation, rotation, 'de bekende hoek zelf');
    const zonder = vakUitVlakQuad(vlakQuad(ann));
    dichtbij(zonder.rotation, ((rotation % 360) + 360) % 360, `zonder bekende hoek 0..360 (${rotation})`, 1e-9);
  }
});

test('vakUitVlakQuad: de bekende hoek wint alleen als hij met de quad samenvalt', () => {
  const q = vlakQuad({ x: 0, y: 0, width: 50, height: 10, rotation: 40 });
  // Afrondingsruis zoals in een bestand (4 decimalen).
  const ruis = q.map((p) => ({ x: Math.round(p.x * 1e4) / 1e4, y: Math.round(p.y * 1e4) / 1e4 }));
  assert.equal(vakUitVlakQuad(ruis, 40).rotation, 40);
  dichtbij(vakUitVlakQuad(ruis, 75).rotation, 40, 'een andere hoek telt niet', 1e-3);
});

test('vakUitVlakQuad: geen rechthoek of gespiegeld geeft null', () => {
  const q = vlakQuad({ x: 0, y: 0, width: 50, height: 10, rotation: 30 });
  assert.equal(vakUitVlakQuad([q[0], q[1], q[2], { x: q[3].x + 5, y: q[3].y }]), null, 'scheef');
  assert.equal(vakUitVlakQuad([q[2], q[3], q[0], q[1]]), null, 'gespiegeld');
  assert.equal(vakUitVlakQuad([q[0], q[0], q[0], q[0]]), null, 'leeg');
  assert.equal(vakUitVlakQuad([q[0], q[1], q[2]]), null, 'drie punten');
});

test('isSchuin: liggend en staand niet, schuin wel', () => {
  for (const rotation of [0.0001, 90, 180, 270, 0.5, 89.5]) {
    assert.equal(isSchuin(vlakQuad({ x: 0, y: 0, width: 50, height: 10, rotation })), false, `${rotation}`);
  }
  for (const rotation of [30, 45, -30, 135, 200]) {
    assert.equal(isSchuin(vlakQuad({ x: 0, y: 0, width: 50, height: 10, rotation })), true, `${rotation}`);
  }
});

test('quadsUitQuadPoints: 8 getallen per quad, ook met een omrekening die een paar geeft', () => {
  const omkeer = (x, y) => [x, 100 - y];
  assert.deepEqual(quadsUitQuadPoints([1, 2, 3, 4, 5, 6, 7, 8], omkeer), [[
    { x: 1, y: 98 }, { x: 3, y: 96 }, { x: 5, y: 94 }, { x: 7, y: 92 },
  ]]);
  assert.equal(quadsUitQuadPoints([1, 2, 3], omkeer), null);
  assert.equal(quadsUitQuadPoints([1, 2, 3, 4, 5, 6, 7, NaN], omkeer), null);
  assert.equal(quadsUitQuadPoints(undefined, omkeer), null);
});

test('markeringUitQuads: vakken, quadPoints en omhullende uit de quads', () => {
  const q1 = vlakQuad({ x: 10, y: 10, width: 40, height: 10, rotation: 30 });
  const q2 = vlakQuad({ x: 60, y: 40, width: 20, height: 10, rotation: 30 });
  const m = markeringUitQuads([q1, q2]);
  assert.equal(m.quads.length, 2);
  assert.notEqual(m.quads[0], q1, 'een kopie');
  assert.equal(m.rects.length, 2);
  assert.deepEqual(m.quadPoints[0], q1.flatMap((p) => [p.x, p.y]));
  const xs = [...q1, ...q2].map((p) => p.x), ys = [...q1, ...q2].map((p) => p.y);
  dichtbij(m.x, Math.min(...xs), 'x');
  dichtbij(m.y, Math.min(...ys), 'y');
  dichtbij(m.x + m.width, Math.max(...xs), 'rechts');
  dichtbij(m.y + m.height, Math.max(...ys), 'onder');
});

test('gedraaideMarkeringUitBestand: vlak, schuine quads of niets', () => {
  const id = (x, y) => [x, y];
  const plat = (q) => q.flatMap((p) => [p.x, p.y]);
  const vlak = vlakQuad({ x: 10, y: 20, width: 100, height: 30, rotation: 40 });
  const uit = gedraaideMarkeringUitBestand({ subtype: 'Highlight', rawQuadPoints: plat(vlak), rotatie: 40, convertPoint: id });
  assert.ok(uit.vlak, 'een vlak');
  dichtbij(uit.vlak.width, 100, 'breedte', 1e-6);
  assert.equal(uit.vlak.rotation, 40);
  // Zonder /OPS_Rotation: een tekstmarkering met schuine quads.
  const tekst = gedraaideMarkeringUitBestand({ subtype: 'Highlight', rawQuadPoints: plat(vlak), convertPoint: id });
  assert.equal(tekst.vlak, undefined);
  assert.equal(tekst.quads.length, 1);
  // Recht: niets, de lader blijft bij de vakken.
  const recht = [10, 20, 110, 20, 10, 50, 110, 50];
  assert.equal(gedraaideMarkeringUitBestand({ subtype: 'Highlight', rawQuadPoints: recht, convertPoint: id }), null);
  // Een gedraaide vlakmarkering over 90 graden is recht, maar met /OPS_Rotation wel een vlak.
  const negentig = plat(vlakQuad({ x: 10, y: 20, width: 100, height: 30, rotation: 90 }));
  assert.equal(gedraaideMarkeringUitBestand({ subtype: 'Highlight', rawQuadPoints: negentig, rotatie: 90, convertPoint: id }).vlak.rotation, 90);
  // Andere soorten blijven zoals ze waren.
  assert.equal(gedraaideMarkeringUitBestand({ subtype: 'Underline', rawQuadPoints: plat(vlak), convertPoint: id }), null);
});
