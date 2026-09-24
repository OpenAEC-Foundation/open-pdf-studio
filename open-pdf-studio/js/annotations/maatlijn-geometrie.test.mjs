import assert from 'node:assert/strict';
import test from 'node:test';

import { maatlijnGeometrie, papierMmNaarPt, PT_PER_MM } from './maatlijn-geometrie.js';

const bijna = (a, b, wat) => assert.ok(Math.abs(a - b) < 1e-9, `${wat}: ${a} ≈ ${b}`);

// Een liggende maat van x 0 tot 100 op y 50, gemeten punten op y 0 (erboven).
const maat = {
  startX: 0, startY: 50, endX: 100, endY: 50,
  leaderStartX: 0, leaderStartY: 0, leaderEndX: 100, leaderEndY: 0,
  headSize: 8,
};

test('papiermillimeters zijn paginapunten, welke tekenschaal er ook geldt', () => {
  assert.equal(PT_PER_MM, 72 / 25.4);
  bijna(papierMmNaarPt(2), 5.669291338582677, '2 mm');
  // Op 1:50 en 1:100 is het dezelfde 2 mm op papier; in werkelijkheid 100 of 200 mm.
  const pt50 = 72 / 25.4 / 50, pt100 = 72 / 25.4 / 100;
  bijna(papierMmNaarPt(2) / pt50, 100, 'werkelijke maat op 1:50');
  bijna(papierMmNaarPt(2) / pt100, 200, 'werkelijke maat op 1:100');
  assert.equal(papierMmNaarPt(-1), 0, 'geen negatieve maat');
});

test('de maatlijn loopt een uitloop voorbij de buitenste hulplijnen door', () => {
  const g = maatlijnGeometrie({ ...maat, dimLineOvershootMm: 2 });
  const u = papierMmNaarPt(2);
  bijna(g.maatlijn.x1, -u, 'begin');
  bijna(g.maatlijn.x2, 100 + u, 'eind');
  assert.equal(g.maatlijn.y1, 50);
  // Alleen aan het begin (eerste maat van een ketting) of alleen aan het eind.
  const begin = maatlijnGeometrie({ ...maat, dimLineOvershootMm: 2, dimOvershootEnds: 'start' });
  bijna(begin.maatlijn.x1, -u, 'begin');
  assert.equal(begin.maatlijn.x2, 100);
  const geen = maatlijnGeometrie({ ...maat, dimLineOvershootMm: 2, dimOvershootEnds: 'none' });
  assert.deepEqual([geen.maatlijn.x1, geen.maatlijn.x2], [0, 100]);
});

test('hulplijnen beginnen een stukje van het gemeten punt en lopen door voorbij de maatlijn', () => {
  const g = maatlijnGeometrie({ ...maat, dimExtGapMm: 1.5, dimExtOvershootMm: 2 });
  assert.equal(g.hulplijnen.length, 2);
  const [a, b] = g.hulplijnen;
  assert.equal(a.x1, 0);
  bijna(a.y1, papierMmNaarPt(1.5), 'vrije afstand vanaf het wandvlak');
  bijna(a.y2, 50 + papierMmNaarPt(2), 'voorbij de maatlijn');
  assert.equal(b.x1, 100);
  // Andersom (gemeten punten onder de maatlijn): de richting draait mee.
  const onder = maatlijnGeometrie({
    ...maat, leaderStartY: 100, leaderEndY: 100, dimExtGapMm: 1.5, dimExtOvershootMm: 2,
  });
  bijna(onder.hulplijnen[0].y1, 100 - papierMmNaarPt(1.5), 'vrije afstand');
  bijna(onder.hulplijnen[0].y2, 50 - papierMmNaarPt(2), 'voorbij de maatlijn');
});

test('zonder eigen instelling blijft het oude beeld', () => {
  // Oud: uitloop max(9, 0,9 x kop) als `extension` aan staat, hulplijn vanaf
  // het punt tot max(10, 0,5 x kop) voorbij de maatlijn.
  const g = maatlijnGeometrie({ ...maat, headSize: 12, extension: true });
  bijna(g.maatlijn.x1, -10.8, 'oude uitloop');
  assert.equal(g.hulplijnen[0].y1, 0, 'geen vrije afstand');
  bijna(g.hulplijnen[0].y2, 60, 'oude doorloop 10 pt');
  const uit = maatlijnGeometrie({ ...maat, headSize: 12, extension: false });
  assert.deepEqual([uit.maatlijn.x1, uit.maatlijn.x2], [0, 100]);
  // Zonder hulplijnpunten: geen hulplijnen.
  assert.deepEqual(maatlijnGeometrie({ startX: 0, startY: 0, endX: 10, endY: 0 }).hulplijnen, []);
});

test('een vrije afstand groter dan de hulplijn laat geen omgekeerd lijntje staan', () => {
  const kort = { ...maat, leaderStartY: 49, leaderEndY: 49 };
  const g = maatlijnGeometrie({ ...kort, dimExtGapMm: 5, dimExtOvershootMm: 2 });
  for (const h of g.hulplijnen) assert.ok(h.y1 >= 49 && h.y1 <= h.y2, `van ${h.y1} tot ${h.y2}`);
});

test('een schuine maat: uitloop en hulplijnen langs en haaks op de lijn', () => {
  const s = Math.SQRT1_2;
  const g = maatlijnGeometrie({
    startX: 0, startY: 0, endX: 100 * s, endY: 100 * s,
    leaderStartX: 10 * s, leaderStartY: -10 * s, leaderEndX: 100 * s + 10 * s, leaderEndY: 100 * s - 10 * s,
    dimLineOvershootMm: 2, dimExtGapMm: 0, dimExtOvershootMm: 0,
  });
  const u = papierMmNaarPt(2);
  bijna(g.maatlijn.x1, -u * s, 'uitloop langs de lijn (x)');
  bijna(g.maatlijn.y1, -u * s, 'uitloop langs de lijn (y)');
  bijna(g.hulplijnen[0].x2, 0, 'hulplijn eindigt op de maatlijn');
  bijna(g.hulplijnen[0].y2, 0, 'hulplijn eindigt op de maatlijn');
});
