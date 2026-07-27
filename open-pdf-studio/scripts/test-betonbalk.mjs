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
  betonbalkTagAnchor,
  edgeCutouts,
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
  // Hartlijn is standaard UIT; alleen expliciete true zet hem aan.
  assert.equal(p.toonHartlijn, false);
  assert.equal(p.tagTonen, false);
  assert.equal(p.tagOffsetX, 0);
  assert.equal(p.tagOffsetY, 0);
  assert.equal(resolveBetonbalkParams({ breedteMm: 5000 }).breedteMm, 2000);
  assert.equal(resolveBetonbalkParams({ hoogteMm: -3 }).hoogteMm, 400);
  assert.equal(resolveBetonbalkParams({ lijnstijl: 'onzin' }).lijnstijl, 'doorgetrokken');
  assert.equal(resolveBetonbalkParams({ toonHartlijn: true }).toonHartlijn, true);
  assert.equal(resolveBetonbalkParams({ toonHartlijn: 'ja' }).toonHartlijn, false);
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

test('toonHartlijn: schakelaar landt in params (default UIT)', () => {
  const uit = buildBetonbalk({ startX: 0, startY: 0, endX: 100, endY: 0 }, { halfWidth: 10 });
  assert.equal(uit.params.toonHartlijn, false);
  const aan = buildBetonbalk(
    { startX: 0, startY: 0, endX: 100, endY: 0, toonHartlijn: true },
    { halfWidth: 10 }
  );
  assert.equal(aan.params.toonHartlijn, true);
  // Randen/outline identiek met en zonder hartlijn.
  assert.deepEqual(aan.edges, uit.edges);
  assert.deepEqual(aan.outline, uit.outline);
});

test('tag-offset: grip-anker verschuift vrij in paginaruimte', () => {
  const base = { startX: 0, startY: 0, endX: 100, endY: 0, tagTonen: true };
  const g0 = buildBetonbalk(base, { halfWidth: 10 });
  const g1 = buildBetonbalk({ ...base, tagOffsetX: 25, tagOffsetY: -40 }, { halfWidth: 10 });
  close(g1.tag.x - g0.tag.x, 25);
  close(g1.tag.y - g0.tag.y, -40);
  close(g1.tag.angle, g0.tag.angle); // hoek blijft langs de balk
  // De grip-helper levert exact hetzelfde anker als de tekenroutine.
  const a = betonbalkTagAnchor({ ...base, tagOffsetX: 25, tagOffsetY: -40 }, 10);
  closePt(a, g1.tag.x, g1.tag.y);
  // De AABB groeit mee met de verplaatste tag.
  assert.ok(g1.aabb.y <= g1.tag.y - g1.tag.fontSize * 0.6 + 1e-9);
});

// ── open T-aansluiting: rand van de DOORGAANDE balk onderbroken ────────────

test('open T: haakse aansluiting midden op de balk → exact interval', () => {
  // Eigen balk (0,0)-(200,0) h=10; aansluitende balk komt van boven
  // (y omlaag: van (100,-100) naar (100,0)... nadert van -y-zijde) — kies
  // van onder: (100,100) → (100,0), raakt de LEFT-rand (y=+10).
  const edges = beamOutline([{ x: 0, y: 0 }, { x: 200, y: 0 }], 10);
  const cut = edgeCutouts(edges, [{ x: 0, y: 0 }, { x: 200, y: 0 }], 10,
    [{ points: [{ x: 100, y: 100 }, { x: 100, y: 0 }], halfWidth: 8 }]);
  assert.equal(cut.left.length, 1);
  close(cut.left[0][0], 92);
  close(cut.left[0][1], 108);
  assert.equal(cut.right.length, 0);
  // En de zichtbare runs: twee stukken links, één rechts.
  const g = buildBetonbalk({ startX: 0, startY: 0, endX: 200, endY: 0 }, {
    halfWidth: 10,
    others: [{ points: [{ x: 100, y: 100 }, { x: 100, y: 0 }], halfWidth: 8 }],
  });
  assert.equal(g.edgeRuns.left.length, 2);
  assert.equal(g.edgeRuns.right.length, 1);
  close(g.edgeRuns.left[0].x2, 92);
  close(g.edgeRuns.left[1].x1, 108);
});

test('open T: aansluiting bij het uiteinde → interval geklemd op de rand', () => {
  const edges = beamOutline([{ x: 0, y: 0 }, { x: 200, y: 0 }], 10);
  const cut = edgeCutouts(edges, [{ x: 0, y: 0 }, { x: 200, y: 0 }], 10,
    [{ points: [{ x: 198, y: 100 }, { x: 198, y: 0 }], halfWidth: 8 }]);
  assert.equal(cut.left.length, 1);
  close(cut.left[0][0], 190);
  close(cut.left[0][1], 200); // geklemd op het rand-einde
});

test('open T: twee aansluitingen naast elkaar → drie zichtbare runs', () => {
  const others = [
    { points: [{ x: 50, y: 100 }, { x: 50, y: 0 }], halfWidth: 8 },
    { points: [{ x: 150, y: 100 }, { x: 150, y: 0 }], halfWidth: 8 },
  ];
  const g = buildBetonbalk({ startX: 0, startY: 0, endX: 200, endY: 0 }, { halfWidth: 10, others });
  assert.equal(g.edgeRuns.left.length, 3);
  close(g.edgeRuns.left[0].x2, 42);
  close(g.edgeRuns.left[1].x1, 58);
  close(g.edgeRuns.left[1].x2, 142);
  close(g.edgeRuns.left[2].x1, 158);
  assert.equal(g.edgeRuns.right.length, 1);
});

test('open T: schuine aansluiting → interval is de projectie van het vlak', () => {
  // 45°-aansluiting: interval = 2·h_o / sin(45°) = 2√2·h_o.
  const hO = 8;
  const edges = beamOutline([{ x: 0, y: 0 }, { x: 200, y: 0 }], 10);
  const cut = edgeCutouts(edges, [{ x: 0, y: 0 }, { x: 200, y: 0 }], 10,
    [{ points: [{ x: 0, y: 100 }, { x: 100, y: 0 }], halfWidth: hO }]);
  assert.equal(cut.left.length, 1);
  close(cut.left[0][1] - cut.left[0][0], 2 * Math.SQRT2 * hO, 1e-9);
  // Centrum ligt waar de AS van de aansluitende balk de rand kruist: de as
  // bereikt de nabije rand (y=+10) een stukje vóór het hartlijn-eindpunt,
  // dus x = 100 − h_eigen·cot(45°) = 90.
  close((cut.left[0][0] + cut.left[0][1]) / 2, 100 - 10, 1e-9);
});

test('open T: hoek-aansluiting (uiteinde op uiteinde) snijdt GEEN rand weg', () => {
  const g = buildBetonbalk({ startX: 0, startY: 0, endX: 200, endY: 0 }, {
    halfWidth: 10,
    others: [{ points: [{ x: 200, y: 0 }, { x: 200, y: 100 }], halfWidth: 10 }],
  });
  assert.equal(g.cutouts.left.length + g.cutouts.right.length, 0);
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
