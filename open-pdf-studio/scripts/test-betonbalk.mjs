// Node-unittest voor de pure betonbalk-geometrie (annotations/betonbalk.js).
//
// Draaien:  node scripts/test-betonbalk.mjs   (vanuit open-pdf-studio/)
//
// Dekt: tweepunts-model, verstek-hulpmeetkunde (90°/45°, miter-limiet →
// bevel), L-hoekverstek tussen twee LOSSE balken, T-aansluiting met EXACTE
// eindcoördinaten op de nabije doelrand (incl. regressie voor het
// verre-rand-doorschiet-defect), hartlijn-trim én -schakelaar, eindkappen,
// tag-geometrie, profielen en round-trip-determinisme.
import assert from 'node:assert/strict';
import {
  buildBetonbalk,
  beamOutline,
  betonbalkCenterline,
  betonbalkLineStyles,
  betonbalkProfielNaam,
  resolveBetonbalkParams,
  halfWidthFromMm,
  PX_PER_MM_1_100,
  MITER_LIMIT_FACTOR,
  BETONBALK_PROFIELEN,
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

// ── parameters, profielen en schaal ─────────────────────────────────────────

test('resolveBetonbalkParams: defaults en klemmen', () => {
  const p = resolveBetonbalkParams(null);
  assert.equal(p.breedteMm, 300);
  assert.equal(p.hoogteMm, 400);
  assert.equal(p.lijnstijl, 'doorgetrokken');
  assert.equal(p.toonHartlijn, true);
  assert.equal(p.tagTonen, false);
  assert.equal(resolveBetonbalkParams({ breedteMm: 5000 }).breedteMm, 2000);
  assert.equal(resolveBetonbalkParams({ hoogteMm: -3 }).hoogteMm, 400);
  assert.equal(resolveBetonbalkParams({ lijnstijl: 'onzin' }).lijnstijl, 'doorgetrokken');
  assert.equal(resolveBetonbalkParams({ toonHartlijn: false }).toonHartlijn, false);
});

test('profielen: naamgeving en standaard-tagtekst', () => {
  assert.equal(betonbalkProfielNaam(350, 400), '350x400');
  assert.equal(BETONBALK_PROFIELEN.length, 10);
  const p = resolveBetonbalkParams({ breedteMm: 350, hoogteMm: 500, tagTonen: true });
  assert.equal(p.tagTekst, '350x500');
  assert.equal(resolveBetonbalkParams({ tagTekst: ' B1 ' }).tagTekst, ' B1 ');
});

test('halfWidthFromMm: schaal en 1:100-fallback', () => {
  close(halfWidthFromMm(300, 0.1), 15);
  close(halfWidthFromMm(300, 0), (300 * PX_PER_MM_1_100) / 2);
});

test('betonbalkLineStyles: dash-conventie per stijl', () => {
  const solid = betonbalkLineStyles('doorgetrokken');
  assert.equal(solid.edgeDash, null);
  assert.ok(Array.isArray(solid.centerDash));
  const dashed = betonbalkLineStyles('gestippeld');
  assert.ok(Array.isArray(dashed.edgeDash));
  assert.equal(dashed.centerDash, null);
});

test('betonbalkCenterline: tweepunts-model + legacy points-vangnet', () => {
  const c = betonbalkCenterline({ startX: 1, startY: 2, endX: 3, endY: 4 });
  closePt(c[0], 1, 2); closePt(c[1], 3, 4);
  const legacy = betonbalkCenterline({ points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 9, y: 9 }] });
  closePt(legacy[1], 5, 0);
  assert.equal(betonbalkCenterline({ startX: 1, startY: 1, endX: 1, endY: 1 }), null);
});

// ── verstek-hulpmeetkunde (beamOutline) ─────────────────────────────────────

test('verstek 90°-knik: exacte snijpunten', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  const o = beamOutline(pts, 10);
  assert.equal(o.left.length, 3);
  closePt(o.left[1], 90, 10);
  assert.equal(o.right.length, 3);
  closePt(o.right[1], 110, -10);
});

test('verstek 45°-knik: snijpunt exact op beide offset-lijnen', () => {
  const h = 10;
  const o = beamOutline([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 100 }], h);
  const expectDist = h / Math.cos(Math.PI / 8);
  for (const side of ['left', 'right']) {
    const c = o[side][1];
    close(Math.hypot(c.x - 100, c.y - 0), expectDist, 1e-9);
    close(Math.abs(c.y), h, 1e-9); // op offset-lijn 1
    const d2 = Math.abs((c.y * 100) - (c.x - 100) * 100) / Math.hypot(100, 100);
    close(d2, h, 1e-9);            // op offset-lijn 2
  }
});

test('miter-limiet: scherpe knik valt terug op bevel', () => {
  const o = beamOutline([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 10 }], 10);
  assert.equal(o.left.length, 4);
  assert.equal(o.right.length, 4);
  for (const side of ['left', 'right']) {
    for (const c of [o[side][1], o[side][2]]) {
      assert.ok(Math.hypot(c.x - 100, c.y - 0) <= MITER_LIMIT_FACTOR * 10 + 1e-9);
    }
  }
});

// ── eindkappen ──────────────────────────────────────────────────────────────

test('vrije uiteinden: haakse eindkap op beide uiteinden', () => {
  const g = buildBetonbalk({ startX: 0, startY: 0, endX: 100, endY: 0 }, { halfWidth: 10 });
  assert.equal(g.caps.length, 2);
  closePt({ x: g.caps[0].x1, y: g.caps[0].y1 }, 0, 10);
  closePt({ x: g.caps[0].x2, y: g.caps[0].y2 }, 0, -10);
  closePt({ x: g.caps[1].x1, y: g.caps[1].y1 }, 100, 10);
  closePt({ x: g.caps[1].x2, y: g.caps[1].y2 }, 100, -10);
});

// ── T-aansluiting (met exacte asserts op de NABIJE doelrand) ────────────────

const T_TARGET = () => ({ points: [{ x: 0, y: -100 }, { x: 0, y: 100 }], halfWidth: 15 });

test('T: randen en hartlijn eindigen EXACT op de nabije doelrand, geen eindkap', () => {
  const target = T_TARGET();
  const snapshot = JSON.parse(JSON.stringify(target));
  const g = buildBetonbalk(
    { startX: -100, startY: 0, endX: 0, endY: 0 },
    { halfWidth: 10, others: [target] }
  );
  assert.equal(g.joinedEnd, true);
  assert.equal(g.joinedStart, false);
  assert.equal(g.caps.length, 1); // alleen de startkap
  // Nabije doelrand = x = -15 (doelbalk verticaal op x=0, h=15).
  closePt(g.edges.left[g.edges.left.length - 1], -15, 10);
  closePt(g.edges.right[g.edges.right.length - 1], -15, -10);
  // Hartlijn stopt óók op de nabije rand; de annotatie-data blijft heel.
  closePt(g.center[1], -15, 0);
  closePt(g.rawCenter[1], 0, 0);
  // Doelbalk niet gemuteerd.
  assert.deepEqual(JSON.parse(JSON.stringify(target)), snapshot);
});

test('T-regressie: uiteinde vóórbij de doel-hartlijn trimt NIET op de verre rand', () => {
  // Einde op x=+5 (voorbij de doel-hartlijn x=0): de nabije rand blijft
  // x=-15 — het oorspronkelijke defect koos hier de verre rand (x=+15) en
  // stak dwars door de doelbalk.
  const g = buildBetonbalk(
    { startX: -100, startY: 0, endX: 5, endY: 0 },
    { halfWidth: 10, others: [T_TARGET()] }
  );
  assert.equal(g.joinedEnd, true);
  closePt(g.edges.left[g.edges.left.length - 1], -15, 10);
  closePt(g.edges.right[g.edges.right.length - 1], -15, -10);
  closePt(g.center[1], -15, 0);
});

test('T aan de startzijde: doortrekken/afkorten tot de nabije doelrand', () => {
  const g = buildBetonbalk(
    { startX: -20, startY: 0, endX: -100, endY: 0 },
    { halfWidth: 10, others: [T_TARGET()] }
  );
  assert.equal(g.joinedStart, true);
  assert.equal(g.caps.length, 1);
  closePt(g.edges.left[0], -15, -10);  // left = +n van richting (-1,0)
  closePt(g.edges.right[0], -15, 10);
  closePt(g.center[0], -15, 0);
});

test('geen aansluiting buiten de tolerantie', () => {
  const g = buildBetonbalk(
    { startX: -100, startY: 0, endX: -40, endY: 0 },
    { halfWidth: 10, others: [T_TARGET()] }
  );
  assert.equal(g.joinedEnd, false);
  assert.equal(g.caps.length, 2);
});

// ── L-hoekverstek tussen twee LOSSE balken ──────────────────────────────────

test('L-hoek: uiteinde-op-uiteinde levert exact verstek, geen eindkap', () => {
  // Eigen balk horizontaal naar (0,0); tweede balk verticaal vanaf (0,0).
  const target = { points: [{ x: 0, y: 0 }, { x: 0, y: 100 }], halfWidth: 10 };
  const g = buildBetonbalk(
    { startX: -100, startY: 0, endX: 0, endY: 0 },
    { halfWidth: 10, others: [target] }
  );
  assert.equal(g.joinedEnd, true);
  assert.equal(g.caps.length, 1);
  // Verstekpunten: binnenhoek (-10,10) op left, buitenhoek (10,-10) op right.
  closePt(g.edges.left[g.edges.left.length - 1], -10, 10);
  closePt(g.edges.right[g.edges.right.length - 1], 10, -10);
  // Bij een hoek loopt de hartlijn gewoon tot het hoekpunt door.
  closePt(g.center[1], 0, 0);
});

test('L-hoek met ongelijke breedtes: snijpunt op beide bandranden', () => {
  const target = { points: [{ x: 0, y: 0 }, { x: 0, y: 100 }], halfWidth: 20 };
  const g = buildBetonbalk(
    { startX: -100, startY: 0, endX: 0, endY: 0 },
    { halfWidth: 10, others: [target] }
  );
  // left eindigt op (−20, 10): onze rand y=10 ∧ partnerrand x=−20.
  closePt(g.edges.left[g.edges.left.length - 1], -20, 10);
  closePt(g.edges.right[g.edges.right.length - 1], 20, -10);
});

// ── hartlijn-schakelaar en tag ──────────────────────────────────────────────

test('toonHartlijn: schakelaar landt in params (default aan)', () => {
  const aan = buildBetonbalk({ startX: 0, startY: 0, endX: 100, endY: 0 }, { halfWidth: 10 });
  assert.equal(aan.params.toonHartlijn, true);
  const uit = buildBetonbalk(
    { startX: 0, startY: 0, endX: 100, endY: 0, toonHartlijn: false },
    { halfWidth: 10 }
  );
  assert.equal(uit.params.toonHartlijn, false);
  // Randen/outline identiek met en zonder hartlijn.
  assert.deepEqual(aan.edges, uit.edges);
  assert.deepEqual(aan.outline, uit.outline);
});

test('tag: gecentreerd boven de balk, meegeroteerd, nooit ondersteboven', () => {
  const g = buildBetonbalk(
    { startX: 0, startY: 0, endX: 100, endY: 0, tagTonen: true, breedteMm: 350, hoogteMm: 400 },
    { halfWidth: 10 }
  );
  assert.ok(g.tag);
  assert.equal(g.tag.text, '350x400');
  close(g.tag.angle, 0);
  close(g.tag.x, 50);
  assert.ok(g.tag.y < -10); // boven de bovenrand (schermassen, y omlaag)
  // Rechts-naar-links getekende balk: tekst flipt naar leesbaar (hoek 0).
  const flip = buildBetonbalk(
    { startX: 100, startY: 0, endX: 0, endY: 0, tagTonen: true },
    { halfWidth: 10 }
  );
  close(flip.tag.angle, 0);
  // Zonder tagTonen geen tag.
  const geen = buildBetonbalk({ startX: 0, startY: 0, endX: 100, endY: 0 }, { halfWidth: 10 });
  assert.equal(geen.tag, null);
});

// ── round-trip / determinisme ───────────────────────────────────────────────

test('round-trip: herberekening uit hetzelfde lijnstuk is identiek', () => {
  const ann = {
    startX: 10, startY: 20, endX: 180, endY: 90,
    breedteMm: 400, hoogteMm: 500, lijnstijl: 'gestippeld', tagTonen: true,
  };
  const others = [{ points: [{ x: 180, y: 90 }, { x: 300, y: 90 }], halfWidth: 12 }];
  const a = buildBetonbalk(ann, { halfWidth: 9, others });
  const b = buildBetonbalk(ann, { halfWidth: 9, others });
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.equal(a.outline.length, a.edges.left.length + a.edges.right.length);
});

test('buildBetonbalk: gedegenereerde invoer → null', () => {
  assert.equal(buildBetonbalk({}), null);
  assert.equal(buildBetonbalk({ startX: 1, startY: 1, endX: 1, endY: 1 }), null);
});

console.log(`\n${passed} tests geslaagd${process.exitCode ? ' (met fouten!)' : ''}`);
