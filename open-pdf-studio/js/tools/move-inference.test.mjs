// Verplaatssessie met inferentie (#519): de kandidaten komen uit de echte
// snap-engine (annotatieranden, wandvlakken), de selectie zelf doet nooit mee,
// de voorkeuren schakelen elk soort hulplijn, en de overlay kleurt per as/soort.
// Echte state-store; Solid/TS zoals in de app (zie ../core/app-test-hooks.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
globalThis.performance ??= { now: () => Date.now() };

const { state } = await import('../core/state.ts');
const {
  collectStaticSegments, selectOwnProbes, createMoveInferenceSession, buildInferenceOverlay,
  axisLockLine, GUIDE_COLORS, createPointIndex,
} = await import('./move-inference.js');

const PREFS = {
  enableObjectSnap: true, snapToEndpoints: true, snapToMidpoints: true, snapToCenters: true,
  snapToPdfContent: false, polarTrackingEnabled: false, polarIncrement: 45, polarTolerance: 3,
  moveInferenceTracking: true, moveInferenceExtension: true, moveInferenceParallel: true,
};
const prefs = (over = {}) => ({ ...PREFS, ...over });

const lijn = { id: 'l1', type: 'line', page: 1, startX: 0, startY: 0, endX: 100, endY: 0 };
const wand = { id: 'w1', type: 'wall', page: 1, startX: 0, startY: 300, endX: 200, endY: 300, thickness: 20 };
const vak = { id: 'b1', type: 'box', page: 1, x: 400, y: 400, width: 50, height: 30 };
const anderePagina = { id: 'l2', type: 'line', page: 2, startX: 0, startY: 0, endX: 10, endY: 10 };

test('statische segmenten: lijnranden en wandVLAKKEN, niet de selectie, niet een andere pagina', () => {
  const alle = [lijn, wand, vak, anderePagina];
  const segs = collectStaticSegments(alle, 1, new Set(['b1']));
  assert.ok(segs.some(s => s.annotation === lijn));
  assert.ok(!segs.some(s => s.annotation === vak), 'de bewegende selectie levert geen segmenten');
  assert.ok(!segs.some(s => s.annotation === anderePagina));
  const vlakken = segs.filter(s => s.annotation === wand && s.face);
  assert.ok(vlakken.length >= 4, `wandomtrek verwacht, kreeg ${vlakken.length}`);
  // Er is een vlak evenwijdig aan de as, NIET op de as zelf (y = 300).
  assert.ok(vlakken.some(s => Math.abs(s.y1 - s.y2) < 1e-6 && Math.abs(s.y1 - 300) > 1));
});

test('eigen probes: hoeken/eindpunten eerst, dubbele weg, begrensd', () => {
  const pts = [
    { x: 1, y: 1, type: 'midpoint' }, { x: 0, y: 0, type: 'corner' }, { x: 0, y: 0, type: 'endpoint' },
    { x: 5, y: 5, type: 'center' }, ...Array.from({ length: 30 }, (_, i) => ({ x: 10 + i, y: 0, type: 'corner' })),
  ];
  const p = selectOwnProbes(pts, 12);
  assert.equal(p.length, 12);
  assert.equal(p[0].type, 'corner');
  assert.ok(!p.some(q => q.type === 'midpoint'));
});

function sessie(annotations, over = {}) {
  Object.assign(state.preferences, PREFS);
  return createMoveInferenceSession({
    staticIndex: createPointIndex([{ x: 100, y: 0, type: 'endpoint' }, { x: 0, y: 0, type: 'endpoint' }]),
    annotations, page: 1, excludeIds: new Set(['b1']),
    ownPoints: [{ x: 400, y: 400, type: 'corner' }, { x: 450, y: 430, type: 'corner' }],
    start: { x: 420, y: 410 }, pdfSegments: false, ...over,
  });
}

test('sessie: een hoek van de selectie lijnt verticaal uit op het eindpunt van een lijn', () => {
  const s = sessie([lijn, vak]);
  // Cursor zo dat de hoek (450,430) → x = 102 komt: dx = cursor.x - 420; hoek.x = 450 + dx.
  const cursor = { x: 420 + (102 - 450), y: 600 };
  const r = s.infer(cursor, { prefs: prefs(), scale: 1 });
  assert.equal(r.kind, 'tracking');
  assert.ok(Math.abs((450 + r.x - 420) - 100) < 1e-6, JSON.stringify({ x: r.x }));
  s.dispose();
});

test('sessie: voorkeuren schakelen volglijnen, verlengden en evenwijdig uit; pool volgt de poolinstellingen', () => {
  const s = sessie([lijn, vak], { ownPoints: [] });
  // Verlengde van de lijn y = 0 voorbij (100,0).
  const c = { x: 180, y: 2 };
  assert.equal(s.infer(c, { prefs: prefs({ moveInferenceTracking: false, moveInferenceParallel: false }), scale: 1 }).kind, 'extension');
  assert.equal(s.infer(c, { prefs: prefs({ moveInferenceTracking: false, moveInferenceParallel: false, moveInferenceExtension: false }), scale: 1 }), null);
  // Pool rond het basispunt (420,410) op 45°.
  const p = { x: 420 + 100 * Math.cos(Math.PI / 4 + 0.02), y: 410 + 100 * Math.sin(Math.PI / 4 + 0.02) };
  const uit = prefs({ moveInferenceTracking: false, moveInferenceParallel: false, moveInferenceExtension: false });
  assert.equal(s.infer(p, { prefs: uit, scale: 1 }), null);
  assert.equal(s.infer(p, { prefs: { ...uit, polarTrackingEnabled: true }, scale: 1 }).kind, 'polar');
  s.dispose();
});

test('sessie: X-asvergrendeling als lockLine snijdt met de verticale uitlijning', () => {
  const s = sessie([lijn, vak], { ownPoints: [], start: { x: 0, y: 500 } });
  const r = s.infer({ x: 101, y: 520 }, { prefs: prefs(), scale: 1, lockLine: axisLockLine({ x: 0, y: 500 }, 'x') });
  assert.equal(r.kind, 'intersection');
  assert.ok(Math.abs(r.x - 100) < 1e-6 && Math.abs(r.y - 500) < 1e-6);
  s.dispose();
});

test('overlay: rood = X, groen = Y, magenta = evenwijdig; een kwartslag gedraaide weergave wisselt de assen', () => {
  const hor = { x: 300, y: 0, kind: 'axis', guides: [{ kind: 'axis', line: { px: 0, py: 0, dx: 1, dy: 0 }, source: { x: 0, y: 0 } }] };
  let o = buildInferenceOverlay(hor, { page: 1, start: { x: 0, y: 0 }, scale: 1, showDistance: false });
  assert.equal(o.lines[0].color, GUIDE_COLORS.x);
  assert.equal(o.label.text, 'On X axis');
  o = buildInferenceOverlay(hor, { page: 1, start: { x: 0, y: 0 }, scale: 1, quarterTurn: true, showDistance: false });
  assert.equal(o.lines[0].color, GUIDE_COLORS.y);
  assert.equal(o.label.text, 'On Y axis');
  const seg = { x1: 0, y1: 0, x2: 100, y2: 50 };
  const par = { x: 10, y: 5, kind: 'parallel', guides: [{ kind: 'parallel', line: { px: 0, py: 0, dx: 0.894, dy: 0.447 }, segment: seg }] };
  o = buildInferenceOverlay(par, { page: 1, start: { x: 0, y: 0 }, scale: 1, showDistance: false });
  assert.ok(o.lines.every(l => l.color === GUIDE_COLORS.parallel));
  assert.ok(o.markers.some(m => m.kind === 'parallel'));
  assert.equal(o.label.text, 'Parallel');
  // Verworven punten krijgen altijd een markering, ook zonder inferentie.
  o = buildInferenceOverlay(null, { page: 1, acquired: [{ x: 1, y: 2 }] });
  assert.deepEqual(o.markers.map(m => m.kind), ['acquired']);
  assert.equal(o.label, null);
});

test('g-move-mode gebruikt de inferentie, de prioriteit en ruimt de overlay op', () => {
  const bron = readFileSync(new URL('./g-move-mode.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(bron, /createMoveInferenceSession\(/);
  assert.match(bron, /resolveSnapPriority\(cands\)/);
  assert.match(bron, /cycleTypeLengthField\(\)/);
  assert.match(bron, /inference\?\.dispose\(\)/);
  // Een getypte afstand volgt de afgeleide richting, niet de rauwe cursor.
  assert.match(bron, /typeLengthApply\(start\.x, start\.y, dir\.x, dir\.y\)/);
  // De selectie snapt nooit op zichzelf: statische kandidaten zonder de doelen.
  assert.match(bron, /collectSnapPoints\(doc\.annotations \|\| \[\], page, _excludeSet\(\)\)/);
  assert.match(bron, /excludeIds: _excludeSet\(\)/);
});
