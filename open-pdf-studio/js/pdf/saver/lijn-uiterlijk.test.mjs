// Lijn, pijl, polylijn en spline kregen bij opslaan geen appearance stream.
// De aanname was dat andere lezers ze zelf uit /L, /LE en /BS tekenen, maar
// PDFium (en dus de meeste browsers en veel andere lezers) doet dat niet: zulke
// annotaties waren daar onzichtbaar. De appearance volgt wat het scherm tekent
// (annotations/rendering.js en rendering/decorations.js).

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLineAP, buildPolylineAP, polylijnOmhullende, lijnOmhullende } from './appearance-vectors.js';

const X = (x) => x;
const Y = (y) => 800 - y;

// De getallen van één pad-operator, bv. alle "x y m" of "x y l".
const punten = (s, op) => [...s.matchAll(new RegExp(`(-?[\\d.]+) (-?[\\d.]+) ${op}\\b`, 'g'))]
  .map((m) => [Number(m[1]), Number(m[2])]);

test('een lijn wordt in zijn kleur en dikte van begin- naar eindpunt getekend', () => {
  const ap = buildLineAP({ startX: 10, startY: 20, endX: 110, endY: 20, X, Y,
    strokeColorHex: '#0000ff', lineWidth: 3 });
  assert.match(ap.content, /0 0 1 RG/);
  assert.match(ap.content, /\b3 w/);
  assert.deepEqual(punten(ap.content, 'm'), [[10, 780]]);
  assert.deepEqual(punten(ap.content, 'l'), [[110, 780]]);
  assert.match(ap.content, /\bS\b/);
  assert.doesNotMatch(ap.content, /\b(f|B)\b/, 'een lijn zonder kop vult niets');
});

test('een stippellijn houdt zijn streeppatroon', () => {
  const ap = buildLineAP({ startX: 0, startY: 0, endX: 50, endY: 0, X, Y,
    strokeColorHex: '#000000', lineWidth: 1, borderStyle: 'dashed' });
  assert.match(ap.content, /\[3 4\] 0 d/);
});

test('bij een gevulde pijlpunt stopt de lijn bij de voet van de punt', () => {
  const ap = buildLineAP({ startX: 10, startY: 20, endX: 110, endY: 20, X, Y,
    strokeColorHex: '#ff0000', lineWidth: 3, endHead: 'closed', headSize: 8 });
  // Lijn: 10 -> 110 - 8 = 102; punt: tip op 110, voet op 102.
  assert.deepEqual(punten(ap.content, 'l')[0], [102, 780]);
  const tips = punten(ap.content, 'm');
  assert.ok(tips.some(([x, y]) => x === 110 && y === 780), 'de punt begint op het eindpunt');
  assert.match(ap.content, /\bB\b/, 'de punt is gevuld en omlijnd');
});

test('een open pijlpunt is een V zonder vulling en de lijn loopt tot vlak voor de tip', () => {
  const ap = buildLineAP({ startX: 10, startY: 20, endX: 110, endY: 20, X, Y,
    strokeColorHex: '#ff0000', lineWidth: 3, endHead: 'open', headSize: 8 });
  // Scherm: inkorten met min(lw / 2, 1) = 1.
  assert.deepEqual(punten(ap.content, 'l')[0], [109, 780]);
  assert.doesNotMatch(ap.content, /\b(f|B)\b/);
  // De V: van een vleugel naar de tip en terug naar de andere vleugel.
  assert.ok(punten(ap.content, 'l').some(([x, y]) => x === 110 && y === 780));
});

test('een holle gesloten pijlpunt (geen /IC) wordt alleen omlijnd, de lijn loopt tot vlak voor de tip', () => {
  // Een pijl uit een ander programma met /LE ClosedArrow zonder /IC.
  const ap = buildLineAP({ startX: 10, startY: 20, endX: 110, endY: 20, X, Y,
    strokeColorHex: '#ff0000', lineWidth: 2, endHead: 'closed', headSize: 8, headFill: false });
  assert.doesNotMatch(ap.content, /\b(f|B|b)\b/, 'niets gevuld');
  assert.deepEqual(punten(ap.content, 'l')[0], [109, 780], 'zoals bij een open punt: inkorten met min(lw / 2, 1)');
  assert.match(ap.content, /110 780 m \S+ \S+ l \S+ \S+ l h\nS\n/, 'een gesloten driehoek, omlijnd');
  assert.match(ap.content, /\n2 w\n0 j\n\[\] 0 d\n110 780 m/, 'met de volle lijndikte');
  // Gevuld blijft gevuld.
  assert.match(buildLineAP({ startX: 10, startY: 20, endX: 110, endY: 20, X, Y,
    strokeColorHex: '#ff0000', lineWidth: 2, endHead: 'closed', headSize: 8 }).content, /\bB\b/);
});

test('een beginpunt krijgt zijn eigen kop, naar buiten gericht', () => {
  const ap = buildLineAP({ startX: 10, startY: 20, endX: 110, endY: 20, X, Y,
    strokeColorHex: '#000000', lineWidth: 1, startHead: 'closed', endHead: 'none', headSize: 8 });
  assert.deepEqual(punten(ap.content, 'm')[0], [18, 780], 'lijn begint bij de voet van de beginpunt');
  const vleugels = punten(ap.content, 'l').filter(([x]) => x === 18);
  assert.equal(vleugels.length, 2, 'de voet van de beginpunt ligt aan de binnenkant');
});

test('de overige kopvormen tekenen iets, en niets verzonnens', () => {
  for (const kop of ['diamond', 'circle', 'square', 'butt', 'slash', 'openReversed', 'closedReversed', 'stealth']) {
    const ap = buildLineAP({ startX: 0, startY: 0, endX: 100, endY: 0, X, Y,
      strokeColorHex: '#000000', lineWidth: 1, endHead: kop, headSize: 8 });
    const zonderKop = buildLineAP({ startX: 0, startY: 0, endX: 100, endY: 0, X, Y,
      strokeColorHex: '#000000', lineWidth: 1, headSize: 8 });
    assert.ok(ap.content.length > zonderKop.content.length, `${kop} tekent een kop`);
  }
});

test('een lijn zonder lengte levert geen appearance', () => {
  assert.equal(buildLineAP({ startX: 5, startY: 5, endX: 5, endY: 5, X, Y }), null);
});

test('een polylijn loopt door al zijn punten, met scherpe hoeken zoals op het scherm', () => {
  const ap = buildPolylineAP({ points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 40 }], X, Y,
    strokeColorHex: '#00ff00', lineWidth: 2 });
  assert.match(ap.content, /0 1 0 RG/);
  assert.match(ap.content, /\b2 w/);
  assert.match(ap.content, /\b0 J\b/);
  assert.match(ap.content, /\b0 j\b/);
  assert.deepEqual(punten(ap.content, 'm'), [[0, 800]]);
  assert.deepEqual(punten(ap.content, 'l'), [[50, 800], [50, 760]]);
  assert.doesNotMatch(ap.content, /\bh\b/, 'een polylijn is open');
});

test('een polylijn met minder dan twee punten levert geen appearance', () => {
  assert.equal(buildPolylineAP({ points: [{ x: 1, y: 1 }], X, Y }), null);
});

test('de verstekgrens staat expliciet op 10, zoals op het canvas', () => {
  const ap = buildPolylineAP({ points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], X, Y, lineWidth: 1 });
  assert.match(ap.content, /\b10 M\b/);
});

test('de omhullende van een polylijn bevat de verstekpunt van een scherpe hoek', () => {
  // Punthoek van ~20 graden: verhouding 1/sin(10°) = 5,76 < 10, dus een spits.
  const rect = polylijnOmhullende([[0, 0], [17.6, 100], [35.2, 0]], 2);
  const spits = 100 + 5.76 * 1; // r * lw / 2
  assert.ok(rect[3] >= spits - 0.05, `bovenkant ${rect[3]} moet de spits ${spits} bevatten`);
  assert.deepEqual(rect.slice(0, 3).map((v) => Math.round(v * 10) / 10), [-2, -2, 37.2]);
});

test('een rechte polylijn houdt de gewone marge van één lijndikte', () => {
  assert.deepEqual(polylijnOmhullende([[0, 0], [50, 0], [100, 0]], 3), [-3, -3, 103, 3]);
});

test('een hoek scherper dan de verstekgrens valt terug op afgeschuind en groeit niet', () => {
  // Bijna terugkerende lijn: verhouding > 10, dus geen spits.
  const rect = polylijnOmhullende([[0, 0], [100, 1], [0, 2]], 2);
  assert.ok(rect[2] <= 102.01, `rechterkant ${rect[2]}`);
});

test('de omhullende van een pijl bevat elke kopvorm met haar lijndikte', () => {
  const koppen = ['open', 'closed', 'openReversed', 'closedReversed', 'diamond', 'circle', 'square', 'butt', 'slash', 'stealth'];
  for (const kop of koppen) {
    for (const hoek of [0, 0.4, 1.3, 2.7]) {
      const lw = 3, headSize = 8;
      const sx = 100, sy = 100, ex = sx + 80 * Math.cos(hoek), ey = sy + 80 * Math.sin(hoek);
      const ap = buildLineAP({ startX: sx, startY: sy, endX: ex, endY: ey, X, Y, lineWidth: lw,
        startHead: kop, endHead: kop, headSize });
      const rect = lijnOmhullende({ x1: X(sx), y1: Y(sy), x2: X(ex), y2: Y(ey), lineWidth: lw, headSize, heeftKoppen: true });
      const coords = [...ap.content.matchAll(/(-?[\d.]+) (-?[\d.]+) [mlc]\b/g)].map((m) => [Number(m[1]), Number(m[2])]);
      for (const [x, y] of coords) {
        const marge = lw / 2;
        assert.ok(x - marge >= rect[0] - 1e-6 && x + marge <= rect[2] + 1e-6 && y - marge >= rect[1] - 1e-6 && y + marge <= rect[3] + 1e-6,
          `${kop} @${hoek}: (${x}, ${y}) valt buiten ${rect}`);
      }
    }
  }
});

test('een lijn zonder koppen houdt de gewone marge van één lijndikte', () => {
  assert.deepEqual(lijnOmhullende({ x1: 10, y1: 20, x2: 110, y2: 20, lineWidth: 2, headSize: 8, heeftKoppen: false }), [8, 18, 112, 22]);
});

test('de hoeken van een boog draaien mee met de pagina, zodat elk boogpunt op zijn plek blijft', async () => {
  const { boogHoekenNaRotatie } = await import('./utils.js');
  const cw = 600, ch = 800;
  const mappers = {
    90: (x, y) => ({ x: y, y: ch - x }),
    180: (x, y) => ({ x: cw - x, y: ch - y }),
    270: (x, y) => ({ x: cw - y, y: x }),
  };
  const boog = { centerX: 200, centerY: 300, radius: 50, startAngle: 0.2, endAngle: 1.4 };
  for (const rot of [90, 180, 270]) {
    const m = mappers[rot];
    const c = m(boog.centerX, boog.centerY);
    const { startAngle, endAngle } = boogHoekenNaRotatie(boog, rot);
    for (const [oud, nieuw] of [[boog.startAngle, startAngle], [boog.endAngle, endAngle]]) {
      const p = m(boog.centerX + boog.radius * Math.cos(oud), boog.centerY + boog.radius * Math.sin(oud));
      const q = { x: c.x + boog.radius * Math.cos(nieuw), y: c.y + boog.radius * Math.sin(nieuw) };
      assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < 1e-9, `rot ${rot}`);
    }
  }
  assert.deepEqual(boogHoekenNaRotatie(boog, 0), { startAngle: 0.2, endAngle: 1.4 });
});

test('een dubbel punt (segment van lengte nul) verbergt de verstekpunt niet', () => {
  const rect = polylijnOmhullende([[0, 0], [17.6, 100], [17.6, 100], [35.2, 0]], 2);
  assert.ok(rect[3] >= 105.7, `bovenkant ${rect[3]}`);
});

test('de omhullende neemt ook een platte lijst van x,y-paren', () => {
  assert.deepEqual(polylijnOmhullende([0, 0, 50, 0, 100, 0], 3), [-3, -3, 103, 3]);
});

test('een hulplijn van een tekstvak: doorgetrokken via de knik, gevulde pijlkop van 7 op de punt', async () => {
  const { buildLeiderAP } = await import('./appearance-vectors.js');
  const ap = buildLeiderAP({ points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 40 }], X, Y,
    strokeColorHex: '#000000', lineWidth: 1, eindStijl: 'arrow' });
  assert.deepEqual(punten(ap.content, 'm')[0], [0, 800]);
  assert.ok(punten(ap.content, 'l').some(([x, y]) => x === 50 && y === 800), 'via de knik');
  assert.match(ap.content, /\[\] 0 d/, 'altijd doorgetrokken, zoals op het scherm');
  assert.match(ap.content, /\bB\b/, 'gevulde kop');
  assert.ok(punten(ap.content, 'm').some(([x, y]) => x === 50 && y === 760), 'kop op de punt');
});

test('een hulplijn met cirkel-einde: gevulde cirkel met straal 4 gecentreerd op de punt', async () => {
  const { buildLeiderAP } = await import('./appearance-vectors.js');
  const ap = buildLeiderAP({ points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 40 }], X, Y,
    strokeColorHex: '#000000', lineWidth: 1, eindStijl: 'circle' });
  const xs = [...ap.content.matchAll(/(-?[\d.]+) (-?[\d.]+) c\b/g)].map((m) => Number(m[1]));
  assert.ok(xs.length >= 4, 'cirkel uit bezierbogen');
  assert.ok(Math.min(...xs) >= 46 - 1e-6 && Math.max(...xs) <= 54 + 1e-6, `cirkel rond x=50: ${xs}`);
  assert.match(ap.content, /\bf\b/);
});

test('de omhullende van een hulplijn bevat de kop', async () => {
  const { leiderOmhullende } = await import('./appearance-vectors.js');
  const r = leiderOmhullende([[0, 800], [50, 800], [50, 760]], 1, 'arrow');
  assert.ok(r[1] <= 760 - 7 / Math.cos(Math.PI / 6) - 1 + 1e-6, `onderkant ${r[1]}`);
});

test('lijndikte 0 tekent zoals het scherm: 0,5 zonder vulling en bij een pijl, anders 0', async () => {
  const { apLijndikte } = await import('./appearance-vectors.js');
  assert.equal(apLijndikte(0, { heeftVulling: false }), 0.5);
  assert.equal(apLijndikte(0, { heeftVulling: true }), 0);
  assert.equal(apLijndikte(0, { isPijl: true, heeftVulling: true }), 0.5);
  assert.equal(apLijndikte(2, { heeftVulling: false }), 2);
  assert.equal(apLijndikte(undefined, { heeftVulling: false }), undefined);
});
