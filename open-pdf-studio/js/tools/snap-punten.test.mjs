// Object-snap kandidaten per modus: eindpunt, midpunt, vertex, startpunt en
// middelpunt staan elk op een eigen voorkeur, zodat ze in de lintgroep 'Snap'
// (en in het voorkeuren-dialog) afzonderlijk aan/uit te zetten zijn. Het label
// van een kandidaat volgt de meest specifieke modus: het eerste punt van een
// object meldt zich als 'startpoint', een polylijnknooppunt als 'vertex'.
//
// Echte state-store; Solid/TS zoals in de app (zie ../core/app-test-hooks.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.ts');
const { collectSnapPoints } = await import('./snap-engine.js');

// Alleen de voorkeuren die de extractie leest; de rest blijft zoals de app
// ze aanlevert.
const STANDAARD = {
  enableObjectSnap: true,
  snapToEndpoints: true,
  snapToMidpoints: true,
  snapToCenters: true,
  snapToVertices: true,
  snapToStartPoints: true,
  snapToEdges: false,
  snapToIntersections: false,
  snapToPerpendicular: false,
  snapToQuadrant: false,
  snapToTangent: false,
  snapToNearest: false,
  snapToPdfContent: false,
  enableGridSnap: false,
  polarTrackingEnabled: false,
  objectSnapRadius: 12,
};

function zetVoorkeuren(over = {}) {
  Object.assign(state.preferences, STANDAARD, over);
}

function kandidaten(annotaties, over = {}) {
  zetVoorkeuren(over);
  return collectSnapPoints(annotaties, 1);
}

const lijn = { id: 'l1', type: 'line', page: 1, startX: 0, startY: 0, endX: 100, endY: 0 };
const polylijn = {
  id: 'p1', type: 'polyline', page: 1,
  points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }],
};
const cirkel = { id: 'c1', type: 'circle', page: 1, x: 0, y: 0, width: 40, height: 40 };
const boog = {
  id: 'a1', type: 'arc', page: 1,
  centerX: 10, centerY: 20, radius: 5, startAngle: 0, endAngle: Math.PI,
};

const soorten = (pts) => pts.map(p => p.type);

test('een lijn levert startpunt, eindpunten én midpunt', () => {
  const pts = kandidaten([lijn]);
  assert.deepEqual(soorten(pts), ['startpoint', 'endpoint', 'endpoint', 'midpoint']);
  // Het startpunt wordt vóór de eindpunten gepusht, zodat het label op een
  // exacte treffer de specifieke modus toont.
  assert.equal(pts[0].x, 0);
  assert.equal(pts[0].y, 0);
  const midden = pts.find(p => p.type === 'midpoint');
  assert.equal(midden.x, 50);
});

test('startpunt-modus uit: geen startpunt-kandidaat, eindpunten blijven', () => {
  const pts = kandidaten([lijn], { snapToStartPoints: false });
  assert.deepEqual(soorten(pts), ['endpoint', 'endpoint', 'midpoint']);
  assert.ok(pts.some(p => p.type === 'endpoint' && p.x === 0 && p.y === 0));
});

test('eindpunten uit: het startpunt blijft snappen', () => {
  const pts = kandidaten([lijn], { snapToEndpoints: false });
  assert.deepEqual(soorten(pts), ['startpoint', 'midpoint']);
});

test('vertices van een polylijn staan los van de eindpunten', () => {
  const tel = (pts, type) => pts.filter(p => p.type === type).length;

  const metVertex = kandidaten([polylijn], { snapToEndpoints: false });
  assert.equal(tel(metVertex, 'vertex'), 3);
  assert.equal(tel(metVertex, 'endpoint'), 0);
  // Startpunt blijft de eerste kandidaat, zodat het label wint bij een treffer.
  assert.equal(metVertex[0].type, 'startpoint');

  const alleenEindpunten = kandidaten([polylijn], { snapToVertices: false });
  assert.equal(tel(alleenEindpunten, 'endpoint'), 3);
  assert.equal(tel(alleenEindpunten, 'vertex'), 0);

  const beideUit = kandidaten([polylijn], { snapToVertices: false, snapToEndpoints: false });
  assert.equal(tel(beideUit, 'vertex'), 0);
  assert.equal(tel(beideUit, 'endpoint'), 0);
  assert.equal(tel(beideUit, 'startpoint'), 1);
});

test('cirkel levert het middelpunt', () => {
  const pts = kandidaten([cirkel]);
  const centrum = pts.find(p => p.type === 'center');
  assert.ok(centrum, 'middelpunt ontbreekt');
  assert.equal(centrum.x, 20);
  assert.equal(centrum.y, 20);
});

test('boog levert startpunt, eindpunt, midpunt en middelpunt', () => {
  const pts = kandidaten([boog]);
  assert.ok(pts.some(p => p.type === 'startpoint' && p.x === 15 && p.y === 20));
  assert.ok(pts.some(p => p.type === 'endpoint' && p.x === 5 && p.y === 20));
  assert.ok(pts.some(p => p.type === 'center' && p.x === 10 && p.y === 20));
  // Halve boog van 0 naar π: het midpunt ligt boven het middelpunt.
  assert.ok(pts.some(p => p.type === 'midpoint' && Math.abs(p.x - 10) < 1e-9 && Math.abs(p.y - 25) < 1e-9));
});

test('de hele object-snap modus uit zet alle kandidaten stil', () => {
  assert.deepEqual(kandidaten([lijn, polylijn, cirkel], { enableObjectSnap: false }), []);
});
