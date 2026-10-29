// Inference-geometrie van het verplaatsen (#519): uitlijnlijnen, verworven
// punten en hun snijpunten, verlengden, evenwijdig/loodrecht met tolerantie,
// pool rond het basispunt, de prioriteit tegenover objectsnap en de
// begrensde indexen. Pure module: geen app-state, geen stubs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  createPointIndex, createSegmentIndex, createAcquirer, inferMove, findAlignments,
  findExtensions, findParallelPerpendicular, polarLine, intersectLines, makeLine,
  resolveSnapPriority, snapPriority, isPointSnapType, screenAxis, INFERENCE_PRIORITY,
} = await import('./inference-engine.js');

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const ALLES = { tracking: true, extension: true, parallel: true };
const GEEN = { tracking: false, extension: false, parallel: false };

function basis(over = {}) {
  return {
    start: { x: 0, y: 0 }, cursor: { x: 0, y: 0 }, probes: [],
    pointIndex: createPointIndex([]), segmentQuery: () => [], acquired: [],
    tol: 4, reach: 1000, angleTolDeg: 2, polar: null, enable: ALLES, ...over,
  };
}

test('uitlijnen: de cursor staat (bijna) recht onder een eindpunt → verticale hulplijn', () => {
  const idx = createPointIndex([{ x: 100, y: 20, type: 'endpoint' }]);
  const r = inferMove(basis({ start: { x: 500, y: 500 }, cursor: { x: 102, y: 300 }, pointIndex: idx }));
  assert.equal(r.kind, 'tracking');
  assert.ok(near(r.x, 100) && near(r.y, 300), JSON.stringify(r));
  assert.equal(r.guides[0].source.x, 100);
});

test('uitlijnen buiten de tolerantie of het bereik geeft niets', () => {
  const idx = createPointIndex([{ x: 100, y: 20, type: 'endpoint' }]);
  assert.equal(inferMove(basis({ start: { x: 500, y: 500 }, cursor: { x: 110, y: 300 }, pointIndex: idx })), null);
  assert.equal(inferMove(basis({ start: { x: 500, y: 500 }, cursor: { x: 101, y: 300 }, pointIndex: idx, reach: 100 })), null);
});

test('een snappunt van de BEWEGENDE selectie lijnt uit; de verschuiving corrigeert de cursor', () => {
  // Eigen hoekpunt ligt 50 rechts van de cursor; statisch punt op x = 250.
  const idx = createPointIndex([{ x: 250, y: 0, type: 'corner' }]);
  const cursor = { x: 198, y: 400 };
  const probes = [{ x: cursor.x + 50, y: cursor.y, ox: 50, oy: 0 }];
  const r = inferMove(basis({ start: { x: 600, y: 600 }, cursor, probes, pointIndex: idx }));
  assert.equal(r.kind, 'tracking');
  // Cursor 200 → het eigen punt landt precies op x = 250.
  assert.ok(near(r.x, 200), JSON.stringify(r));
});

test('twee uitlijningen tegelijk → snijpunt (horizontaal van het ene, verticaal van het andere punt)', () => {
  const idx = createPointIndex([{ x: 100, y: 0, type: 'endpoint' }, { x: 0, y: 200, type: 'midpoint' }]);
  const r = inferMove(basis({ start: { x: 900, y: 900 }, cursor: { x: 102, y: 197 }, pointIndex: idx }));
  assert.equal(r.kind, 'intersection');
  assert.ok(near(r.x, 100) && near(r.y, 200), JSON.stringify(r));
  assert.equal(r.priority, INFERENCE_PRIORITY.intersection);
});

test('verworven punten geven H/V-volglijnen; twee verworven punten geven hun snijpunt', () => {
  const acquired = [{ x: 50, y: 10 }, { x: 300, y: 120 }];
  const r = inferMove(basis({ start: { x: 900, y: 900 }, cursor: { x: 52, y: 118 }, acquired }));
  assert.equal(r.kind, 'intersection');
  assert.ok(near(r.x, 50) && near(r.y, 120), JSON.stringify(r));
  // Zonder volglijnen (instelling uit) doen ze niets.
  assert.equal(inferMove(basis({ start: { x: 900, y: 900 }, cursor: { x: 52, y: 118 }, acquired, enable: GEEN })), null);
});

test('verwerven: even stilstaan op een punt verwerft het, nogmaals stilstaan laat het los', () => {
  const acq = createAcquirer({ delayMs: 300, max: 2 });
  const p = { x: 5, y: 5, type: 'endpoint' };
  assert.deepEqual(acq.update(p, 0), { changed: false, pendingMs: 300 });
  assert.equal(acq.update(p, 200).changed, false);
  assert.equal(acq.update(p, 310).changed, true);
  assert.equal(acq.list().length, 1);
  // Blijft erop staan: niet meteen weer loslaten.
  assert.equal(acq.update(p, 900).changed, false);
  acq.update(null, 950);
  acq.update(p, 1000);
  assert.equal(acq.update(p, 1400).changed, true);
  assert.equal(acq.list().length, 0);
  // Maximaal `max`: het oudste valt af.
  for (const [i, t] of [[1, 2000], [2, 3000], [3, 4000]]) {
    acq.update({ x: i, y: i }, t); acq.update({ x: i, y: i }, t + 301);
  }
  assert.deepEqual(acq.list().map(a => a.x), [2, 3]);
});

test('verlengde: voorbij het eindpunt van een lijn, niet óp de lijn', () => {
  const segs = createSegmentIndex([{ x1: 0, y1: 0, x2: 100, y2: 100 }]);
  const q = (x, y, r) => segs.near(x, y, r);
  const r = inferMove(basis({ start: { x: 500, y: 0 }, cursor: { x: 152, y: 149 }, segmentQuery: q, enable: { ...GEEN, extension: true } }));
  assert.equal(r.kind, 'extension');
  assert.ok(near(r.x, 150.5) && near(r.y, 150.5), JSON.stringify(r));
  assert.deepEqual(r.guides[0].source, { x: 100, y: 100 });
  // Op het lijnstuk zelf: geen verlengde (dat is de randsnap).
  assert.equal(inferMove(basis({ start: { x: 500, y: 0 }, cursor: { x: 51, y: 50 }, segmentQuery: q, enable: { ...GEEN, extension: true } })), null);
  // Verder dan het bereik voorbij het eindpunt: niets.
  assert.deepEqual(findExtensions([{ x: 800, y: 800, ox: 0, oy: 0 }], q, 4, 100), []);
});

test('verlengde van een wandvlak via een eigen hoekpunt van de selectie', () => {
  // Wandvlak horizontaal op y = 40 van x 0..200; het eigen hoekpunt ligt 30 onder de cursor.
  const segs = createSegmentIndex([{ x1: 0, y1: 40, x2: 200, y2: 40, face: true }]);
  const cursor = { x: 260, y: 12 };
  const probes = [{ x: 260, y: 42, ox: 0, oy: 30 }];
  const r = inferMove(basis({ start: { x: 900, y: 900 }, cursor, probes, segmentQuery: (x, y, rr) => segs.near(x, y, rr), enable: { ...GEEN, extension: true } }));
  assert.equal(r.kind, 'extension');
  assert.ok(near(r.y, 10), JSON.stringify(r)); // hoekpunt landt op y = 40
});

test('evenwijdig en loodrecht binnen de hoektolerantie, niet erbuiten', () => {
  const seg = { x1: 0, y1: 0, x2: 100, y2: 50 }; // ~26.57°
  const ang = Math.atan2(50, 100);
  const start = { x: 0, y: 200 };
  const evenwijdig = { x: start.x + 100 * Math.cos(ang + 0.02), y: start.y + 100 * Math.sin(ang + 0.02) }; // ~1.1°
  let r = findParallelPerpendicular(start, evenwijdig, [seg], 2);
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'parallel');
  const buiten = { x: start.x + 100 * Math.cos(ang + 0.06), y: start.y + 100 * Math.sin(ang + 0.06) }; // ~3.4°
  assert.deepEqual(findParallelPerpendicular(start, buiten, [seg], 2), []);
  const loodrecht = { x: start.x + 100 * Math.cos(ang + Math.PI / 2 - 0.015), y: start.y + 100 * Math.sin(ang + Math.PI / 2 - 0.015) };
  r = findParallelPerpendicular(start, loodrecht, [seg], 2);
  assert.equal(r[0].kind, 'perpendicular');
  // In inferMove: de cursor wordt op de hulplijn door het basispunt gelegd.
  const res = inferMove(basis({ start, cursor: evenwijdig, segmentQuery: () => [seg], tol: 4, enable: { ...GEEN, parallel: true } }));
  assert.equal(res.kind, 'parallel');
  const vx = res.x - start.x, vy = res.y - start.y;
  assert.ok(Math.abs(vx * 50 - vy * 100) < 1e-6, 'richting exact evenwijdig');
  assert.equal(res.guides[0].segment, seg);
});

test('pool tijdens verplaatsen: increment en tolerantie van de poolinstellingen rond het basispunt', () => {
  const start = { x: 100, y: 100 };
  const c = { x: 100 + 100 * Math.cos(Math.PI / 4 + 0.03), y: 100 + 100 * Math.sin(Math.PI / 4 + 0.03) };
  assert.ok(polarLine(start, c, 45, 3));
  assert.equal(polarLine(start, c, 45, 1), null);
  const r = inferMove(basis({ start, cursor: c, polar: { incrementDeg: 45, toleranceDeg: 3 }, enable: GEEN }));
  assert.equal(r.kind, 'polar');
  assert.ok(near(r.x - start.x, r.y - start.y), 'op de 45°-straal');
  // Uit: geen poolhulplijn.
  assert.equal(inferMove(basis({ start, cursor: c, polar: null, enable: GEEN })), null);
});

test('as door het basispunt; Shift-vergrendeling houdt de lijn vast en snijdt met andere hulplijnen', () => {
  const start = { x: 0, y: 0 };
  let r = inferMove(basis({ start, cursor: { x: 300, y: 3 }, enable: { ...GEEN, tracking: true } }));
  assert.equal(r.kind, 'axis');
  assert.ok(near(r.y, 0));
  const lock = r.lockable;
  // Cursor ver weg van de lijn: blijft erop.
  r = inferMove(basis({ start, cursor: { x: 250, y: 80 }, lockLine: lock, enable: GEEN }));
  assert.equal(r.kind, 'locked');
  assert.ok(near(r.x, 250) && near(r.y, 0));
  // Vergrendeld + een verticale uitlijning op x = 240 → snijpunt.
  const idx = createPointIndex([{ x: 240, y: -500, type: 'endpoint' }]);
  r = inferMove(basis({ start, cursor: { x: 243, y: 80 }, lockLine: lock, pointIndex: idx, enable: { ...GEEN, tracking: true } }));
  assert.equal(r.kind, 'intersection');
  assert.ok(near(r.x, 240) && near(r.y, 0), JSON.stringify(r));
});

test('prioriteit: puntsnap > snijpunt > volglijn > pool > rand > raster', () => {
  assert.ok(isPointSnapType('endpoint') && isPointSnapType('vertex') && isPointSnapType('startpoint'));
  assert.ok(!isPointSnapType('edge') && !isPointSnapType('grid') && !isPointSnapType('nearest'));
  const P = INFERENCE_PRIORITY;
  assert.ok(snapPriority('corner') > P.intersection);
  assert.ok(P.intersection > P.tracking && P.tracking > P.polar && P.polar > snapPriority('edge') && snapPriority('edge') > snapPriority('grid'));
  const win = resolveSnapPriority([
    { id: 'rand', priority: snapPriority('edge'), dist: 0.1 },
    { id: 'volg', priority: P.tracking, dist: 3 },
    { id: 'eind', priority: snapPriority('endpoint'), dist: 5 },
  ]);
  assert.equal(win.id, 'eind');
  assert.equal(resolveSnapPriority([{ id: 'a', priority: 60, dist: 2 }, { id: 'b', priority: 60, dist: 1 }]).id, 'b');
  assert.equal(resolveSnapPriority([]), null);
});

test('dubbele lijnen: de as door het basispunt wint van de pool op 0°', () => {
  const r = inferMove(basis({ start: { x: 0, y: 0 }, cursor: { x: 200, y: 2 }, polar: { incrementDeg: 90, toleranceDeg: 3 }, enable: { ...GEEN, tracking: true } }));
  assert.equal(r.kind, 'axis');
  assert.equal(r.guides.length, 1);
});

test('schermas volgt een gedraaide weergave', () => {
  assert.equal(screenAxis(1, 0, false), 'x');
  assert.equal(screenAxis(0, 1, false), 'y');
  assert.equal(screenAxis(1, 0, true), 'y');
  assert.equal(screenAxis(1, 1, false), null);
});

test('snijpunt van lijnen; evenwijdige lijnen snijden niet', () => {
  const a = makeLine(0, 0, 1, 0), b = makeLine(5, -5, 0, 1);
  assert.deepEqual(intersectLines(a, b), { x: 5, y: 0 });
  assert.equal(intersectLines(a, makeLine(0, 3, 1, 0)), null);
});

test('indexen: uitlijnen via binair zoeken, dichtstbijzijnde punt via raster, segmenten lokaal', () => {
  const pts = [];
  for (let i = 0; i < 20000; i++) pts.push({ x: (i * 7919) % 5000, y: (i * 104729) % 5000 });
  const idx = createPointIndex(pts);
  let n = 0;
  idx.alignedX(1234, 0.5, () => { n++; });
  assert.equal(n, pts.filter(p => Math.abs(p.x - 1234) <= 0.5).length);
  const best = idx.nearest(2500, 2500, 200);
  const brute = pts.map(p => Math.hypot(p.x - 2500, p.y - 2500)).filter(d => d <= 200).sort((a, b) => a - b)[0];
  assert.ok(best && near(best.dist, brute));
  const segs = createSegmentIndex([{ x1: 0, y1: 0, x2: 10, y2: 0 }, { x1: 4000, y1: 4000, x2: 4010, y2: 4000 }, { x1: 0, y1: 0, x2: 50000, y2: 50000 }]);
  const gevonden = segs.near(5, 5, 20);
  assert.equal(gevonden.length, 2); // de lokale + de paginabrede
  assert.ok(!gevonden.some(s => s.x1 === 4000));
});

test('uitlijnen meldt per probe het dichtstbij uitgelijnde punt, niet een puntsnap', () => {
  const idx = createPointIndex([{ x: 10, y: 0 }, { x: 10, y: 90 }, { x: 10, y: 101 }]);
  const g = findAlignments([{ x: 11, y: 100, ox: 0, oy: 0 }], idx, 3, 1000);
  const v = g.find(x => x.dir === 'v');
  assert.equal(v.source.y, 90); // (10,101) ligt binnen tol: dat is een puntsnap
});
