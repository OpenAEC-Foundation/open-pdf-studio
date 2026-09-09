// annotationBounds is de enige plek waar de omhullende van een annotatie
// wordt afgeleid — gebruikt door de spatial index én door de viewport-culling
// in de tekenlus. Gaat hier iets mis, dan verdwijnen annotaties uit beeld.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// De echte bron laden met alleen de parametrische imports gestubd; die trekken
// via de schaalgebieden de TypeScript-state en SolidJS mee.
const bron = readFileSync(new URL('./spatial-index.js', import.meta.url), 'utf8')
  .replace(/^import \{ buildStavenreeks \}.*$/m,
    'const buildStavenreeks = () => ({ aabb: { x: 0, y: 0, width: 10, height: 10 } });')
  .replace(/^import \{ stavenreeksPxPerMm \}.*$/m, 'const stavenreeksPxPerMm = () => 1;')
  .replace(/^import \{ betonbalkHalfWidthPx \}.*$/m, 'const betonbalkHalfWidthPx = () => 20;')
  .replace(/^import \{ rotatedRectAabb \}.*$/m, `
const rotatedRectAabb = (r) => {
  const rad = (r.rotation || 0) * Math.PI / 180;
  const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
  const w = r.width * c + r.height * s;
  const h = r.width * s + r.height * c;
  return { x: r.x + r.width / 2 - w / 2, y: r.y + r.height / 2 - h / 2, width: w, height: h };
};`);

const { annotationBounds, SpatialIndex } =
  await import('data:text/javascript;base64,' + Buffer.from(bron, 'utf8').toString('base64'));

const omvat = (b, punten) => punten.every(([x, y]) =>
  x >= b.x - 1e-6 && x <= b.x + b.width + 1e-6 && y >= b.y - 1e-6 && y <= b.y + b.height + 1e-6);

test('rechthoek: omhullende is de rechthoek zelf', () => {
  const b = annotationBounds({ type: 'box', page: 1, x: 10, y: 20, width: 100, height: 50 });
  assert.deepEqual(b, { x: 10, y: 20, width: 100, height: 50 });
});

test('gedraaide rechthoek: omhullende groeit mee met de rotatie', () => {
  const b = annotationBounds({ type: 'box', page: 1, x: 0, y: 0, width: 100, height: 20, rotation: 90 });
  assert.ok(b.height > 90, `verwachtte een hoge omhullende, kreeg ${b.height}`);
  assert.ok(b.width < 30, `verwachtte een smalle omhullende, kreeg ${b.width}`);
});

test('tekstvak met aanhaallijn: knik en pijlpunt vallen binnen de omhullende', () => {
  const ann = {
    type: 'textbox', page: 1, x: 200, y: 200, width: 100, height: 40,
    leaders: [{ kneeX: 140, kneeY: 300, tipX: 60, tipY: 330 }],
  };
  const b = annotationBounds(ann);
  assert.ok(omvat(b, [[60, 330], [140, 300], [200, 200], [300, 240]]),
    `aanhaallijn valt buiten de omhullende: ${JSON.stringify(b)}`);
});

test('lijn: omhullende met marge voor de lijndikte, in beide richtingen', () => {
  const b = annotationBounds({ type: 'line', page: 1, startX: 300, startY: 40, endX: 100, endY: 90, lineWidth: 8 });
  assert.ok(omvat(b, [[100, 40], [300, 90]]));
  assert.ok(b.x <= 100 - 4 && b.x + b.width >= 300 + 4, 'marge ontbreekt');
});

test('polylijn en vrije hand: alle punten liggen binnen de omhullende', () => {
  const pts = [{ x: 5, y: 90 }, { x: 220, y: 12 }, { x: 130, y: 300 }];
  for (const veld of ['points', 'path']) {
    const b = annotationBounds({ type: veld === 'path' ? 'draw' : 'polyline', page: 1, [veld]: pts });
    assert.ok(omvat(b, pts.map(p => [p.x, p.y])), `${veld} valt buiten de omhullende`);
  }
});

test('hoekmeting en tekstmarkering krijgen ook een omhullende', () => {
  const hoek = annotationBounds({
    type: 'measureAngle', page: 1,
    point1: { x: 10, y: 10 }, vertex: { x: 60, y: 80 }, point2: { x: 120, y: 20 },
  });
  assert.ok(omvat(hoek, [[10, 10], [60, 80], [120, 20]]));

  const markering = annotationBounds({
    type: 'textHighlight', page: 1,
    quadPoints: [[{ x: 40, y: 40 }, { x: 90, y: 40 }, { x: 40, y: 55 }, { x: 90, y: 55 }]],
  });
  assert.ok(omvat(markering, [[40, 40], [90, 55]]));
});

test('goedkope modus laat parametrische figuren met rust', () => {
  const staven = { type: 'stavenreeks', page: 1, startX: 0, startY: 0, endX: 100, endY: 0 };
  const balk = { type: 'betonbalk', page: 1, startX: 0, startY: 0, endX: 100, endY: 0 };
  // null = "niet goedkoop te bepalen" → de aanroeper tekent gewoon.
  assert.equal(annotationBounds(staven, { goedkoop: true }), null);
  assert.equal(annotationBounds(balk, { goedkoop: true }), null);
  // Zonder die vlag komt de echte, dure omhullende er wel uit.
  assert.ok(annotationBounds(staven));
  assert.ok(annotationBounds(balk).width > 100, 'balkbreedte hoort mee te tellen');
});

test('goedkope modus geeft voor gewone typen dezelfde omhullende', () => {
  for (const ann of [
    { type: 'box', page: 1, x: 1, y: 2, width: 3, height: 4 },
    { type: 'line', page: 1, startX: 0, startY: 0, endX: 9, endY: 9 },
    { type: 'polyline', page: 1, points: [{ x: 0, y: 0 }, { x: 5, y: 7 }] },
  ]) {
    assert.deepEqual(annotationBounds(ann, { goedkoop: true }), annotationBounds(ann));
  }
});

test('index: herbouw pas als er bevraagd wordt', () => {
  const idx = new SpatialIndex();
  assert.equal(idx.isVerouderd, true, 'een verse index staat als verouderd te boek');
  const anns = [{ id: 'a', page: 1, type: 'box', x: 0, y: 0, width: 50, height: 50 }];
  idx.zorgVoorActueel(anns);
  assert.equal(idx.isVerouderd, false);
  assert.equal(idx.size, 1);

  idx.markStale();
  assert.equal(idx.isVerouderd, true);
  // markStale gooit niets weg — de index blijft bruikbaar tot de herbouw.
  assert.equal(idx.size, 1);
});

test('index: queryExact vindt alleen wat het venster echt raakt', () => {
  const idx = new SpatialIndex();
  const anns = [
    { id: 'in', page: 1, type: 'box', x: 100, y: 100, width: 40, height: 40 },
    { id: 'ver', page: 1, type: 'box', x: 5000, y: 5000, width: 40, height: 40 },
    { id: 'ander', page: 2, type: 'box', x: 100, y: 100, width: 40, height: 40 },
  ];
  idx.rebuild(anns);
  const hits = idx.queryExact(1, 90, 90, 100, 100, anns).map(a => a.id);
  assert.deepEqual(hits, ['in']);
});
