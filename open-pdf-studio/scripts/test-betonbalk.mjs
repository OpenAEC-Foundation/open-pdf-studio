// Node-unittest voor de pure betonbalk-geometrie (annotations/betonbalk.js).
//
// Draaien:  node scripts/test-betonbalk.mjs   (vanuit open-pdf-studio/)
//
// Dekt de spec-eisen: verstek op 90°- en 45°-knik (exacte snijpunten),
// miter-limiet → bevel bij scherpe hoek, T-aansluiting (rand eindigt op de
// doelrand, geen eindkap; doelbalk ongewijzigd), eindkappen op vrije
// uiteinden en de round-trip hartlijn → outline → zelfde bij herberekening.
import assert from 'node:assert/strict';
import {
  buildBetonbalk,
  beamOutline,
  betonbalkLineStyles,
  resolveBetonbalkParams,
  halfWidthFromMm,
  PX_PER_MM_1_100,
  MITER_LIMIT_FACTOR,
} from '../js/annotations/betonbalk.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const close = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `verwacht ${b}, kreeg ${a}`);
const closePt = (p, x, y, eps = 1e-9) => { close(p.x, x, eps); close(p.y, y, eps); };

// ── parameters en schaal ────────────────────────────────────────────────────

test('resolveBetonbalkParams: defaults en klemmen', () => {
  assert.deepEqual(resolveBetonbalkParams(null), { breedteMm: 300, lijnstijl: 'doorgetrokken' });
  assert.equal(resolveBetonbalkParams({ breedteMm: 5000 }).breedteMm, 2000);
  assert.equal(resolveBetonbalkParams({ breedteMm: -3 }).breedteMm, 300);
  assert.equal(resolveBetonbalkParams({ lijnstijl: 'gestippeld' }).lijnstijl, 'gestippeld');
  assert.equal(resolveBetonbalkParams({ lijnstijl: 'onzin' }).lijnstijl, 'doorgetrokken');
});

test('halfWidthFromMm: schaal en 1:100-fallback', () => {
  close(halfWidthFromMm(300, 0.1), 15);            // 0,1 px/mm → 30 px breed
  close(halfWidthFromMm(300, 0), (300 * PX_PER_MM_1_100) / 2); // fallback 1:100
});

test('betonbalkLineStyles: dash-conventie per stijl', () => {
  const solid = betonbalkLineStyles('doorgetrokken');
  assert.equal(solid.edgeDash, null);
  assert.ok(Array.isArray(solid.centerDash));       // hartlijn streep-punt
  const dashed = betonbalkLineStyles('gestippeld');
  assert.ok(Array.isArray(dashed.edgeDash));        // randen onderbroken
  assert.equal(dashed.centerDash, null);            // hartlijn doorgetrokken
});

// ── verstek-joins ───────────────────────────────────────────────────────────

test('verstek 90°-knik: exacte snijpunten', () => {
  // Hartlijn: rechts, dan omlaag (schermassen, y omlaag). h = 10.
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  const o = beamOutline(pts, 10);
  // left = +n-zijde: n van (1,0) is (0,1) → y+10; n van (0,1) is (-1,0) → x-10.
  assert.equal(o.left.length, 3);
  closePt(o.left[0], 0, 10);
  closePt(o.left[1], 90, 10);    // snijpunt y=10 ∧ x=90
  closePt(o.left[2], 90, 100);
  assert.equal(o.right.length, 3);
  closePt(o.right[0], 0, -10);
  closePt(o.right[1], 110, -10); // snijpunt y=-10 ∧ x=110
  closePt(o.right[2], 110, 100);
});

test('verstek 45°-knik: snijpunt ligt exact op beide offset-lijnen', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 100 }];
  const h = 10;
  const o = beamOutline(pts, h);
  // Verstekafstand tot de knik = h / sin(θ/2), θ = 135° tussen de richtingen
  // (draai van 45°): |c − P1| = h / cos(22,5°).
  const turn = Math.PI / 4;
  const expectDist = h / Math.cos(turn / 2);
  for (const side of ['left', 'right']) {
    const c = o[side][1];
    close(Math.hypot(c.x - 100, c.y - 0), expectDist, 1e-9);
    // En exact op offset-lijn 1 (y = ±h) …
    close(Math.abs(c.y), h, 1e-9);
    // … en op offset-lijn 2 (afstand tot de tweede hartlijn = h).
    const d2 = Math.abs((c.x - 100) * (100 / Math.hypot(100, 100)) * 0
      + ((c.y - 0) * (100) - (c.x - 100) * (100)) / Math.hypot(100, 100));
    close(d2, h, 1e-9);
  }
});

test('miter-limiet: scherpe hoek valt terug op bevel (twee hoekpunten)', () => {
  // Bijna terugkerende hartlijn → verstekpunt ver voorbij 4×h.
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 10 }];
  const h = 10;
  const o = beamOutline(pts, h);
  // Bevel: per zijde 4 punten (start, 2 hoekpunten, eind).
  assert.equal(o.left.length, 4);
  assert.equal(o.right.length, 4);
  // Beide bevel-punten liggen binnen de miter-limiet van de knik.
  for (const side of ['left', 'right']) {
    for (const c of [o[side][1], o[side][2]]) {
      assert.ok(Math.hypot(c.x - 100, c.y - 0) <= MITER_LIMIT_FACTOR * h + 1e-9);
    }
  }
});

test('180°-knik (parallel terug): geen crash, bevel-punten', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }];
  const o = beamOutline(pts, 10);
  assert.ok(o && o.left.length >= 3 && o.right.length >= 3);
});

// ── eindkappen en T-aansluiting ─────────────────────────────────────────────

test('vrije uiteinden: haakse eindkap op beide uiteinden', () => {
  const g = buildBetonbalk({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }, { halfWidth: 10 });
  assert.equal(g.caps.length, 2);
  assert.equal(g.joinedStart, false);
  assert.equal(g.joinedEnd, false);
  // Startkap verbindt (0,10)–(0,-10); eindkap (100,10)–(100,-10).
  closePt({ x: g.caps[0].x1, y: g.caps[0].y1 }, 0, 10);
  closePt({ x: g.caps[0].x2, y: g.caps[0].y2 }, 0, -10);
  closePt({ x: g.caps[1].x1, y: g.caps[1].y1 }, 100, 10);
  closePt({ x: g.caps[1].x2, y: g.caps[1].y2 }, 100, -10);
});

test('T-aansluiting: randen eindigen op de doelrand, geen eindkap, doelbalk ongemoeid', () => {
  // Doelbalk: verticaal op x=0, halve breedte 15. Eigen balk komt van links
  // en eindigt op de doel-hartlijn.
  const target = { points: [{ x: 0, y: -100 }, { x: 0, y: 100 }], halfWidth: 15 };
  const targetSnapshot = JSON.parse(JSON.stringify(target));
  const g = buildBetonbalk(
    { points: [{ x: -100, y: 0 }, { x: 0, y: 0 }] },
    { halfWidth: 10, others: [target] }
  );
  assert.equal(g.joinedEnd, true);
  assert.equal(g.joinedStart, false);
  assert.equal(g.caps.length, 1); // alleen de startkap blijft
  // Beide eigen randen eindigen exact op de NABIJE doelrand x = -15.
  closePt(g.edges.left[g.edges.left.length - 1], -15, 10);
  closePt(g.edges.right[g.edges.right.length - 1], -15, -10);
  // De doelbalk is niet gemuteerd.
  assert.deepEqual(JSON.parse(JSON.stringify(target)), targetSnapshot);
});

test('T-aansluiting aan de startzijde + doortrekken tot de doelrand', () => {
  // Eigen hartlijn begint een stukje VOOR de doelrand (op x=-20, doelrand
  // x=-15): de randen worden tot de doelrand doorgetrokken/afgekort.
  const target = { points: [{ x: 0, y: -100 }, { x: 0, y: 100 }], halfWidth: 15 };
  const g = buildBetonbalk(
    { points: [{ x: -20, y: 0 }, { x: -100, y: 0 }] },
    { halfWidth: 10, others: [target] }
  );
  assert.equal(g.joinedStart, true);
  assert.equal(g.caps.length, 1);
  closePt(g.edges.left[0], -15, -10); // left = +n van richting (-1,0) → y=-10
  closePt(g.edges.right[0], -15, 10);
});

test('geen aansluiting buiten de tolerantie', () => {
  const target = { points: [{ x: 0, y: -100 }, { x: 0, y: 100 }], halfWidth: 15 };
  // Uiteinde op x=-40: verder dan h_doel (15) + tolerantie (min(10,15)=10).
  const g = buildBetonbalk(
    { points: [{ x: -100, y: 0 }, { x: -40, y: 0 }] },
    { halfWidth: 10, others: [target] }
  );
  assert.equal(g.joinedEnd, false);
  assert.equal(g.caps.length, 2);
});

// ── round-trip / determinisme ───────────────────────────────────────────────

test('round-trip: herberekening uit dezelfde hartlijn levert identieke geometrie', () => {
  const ann = {
    points: [{ x: 10, y: 20 }, { x: 120, y: 20 }, { x: 180, y: 90 }, { x: 180, y: 200 }],
    breedteMm: 400,
    lijnstijl: 'gestippeld',
  };
  const others = [{ points: [{ x: 180, y: 200 }, { x: 300, y: 200 }], halfWidth: 12 }];
  const a = buildBetonbalk(ann, { halfWidth: 9, others });
  const b = buildBetonbalk(ann, { halfWidth: 9, others });
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  // En de outline is gesloten consistent: left + reversed right.
  assert.equal(a.outline.length, a.edges.left.length + a.edges.right.length);
});

test('buildBetonbalk: gedegenereerde invoer → null', () => {
  assert.equal(buildBetonbalk({ points: [] }), null);
  assert.equal(buildBetonbalk({ points: [{ x: 1, y: 1 }, { x: 1, y: 1 }] }), null);
});

console.log(`\n${passed} tests geslaagd${process.exitCode ? ' (met fouten!)' : ''}`);
