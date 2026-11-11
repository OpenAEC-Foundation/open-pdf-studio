// Unit-tests voor de lijndiktes van de wapeningskorf.
//
// Regressie-achtergrond: de korf tekende zijn fijne onderdelen
// (diameterteken r ≈ 3 px, beugel-dubbellijn ≈ 3 px uit elkaar, staafpunten
// r ≈ 2–3 px) met de GENERIEKE annotatie-lijndikte, die bij plaatsing uit de
// lint-keuze kwam (default 2–3 px). Resultaat: dichtgelopen klodders. De fix
// is tweeledig: (1) tekenwerkcomponenten krijgen bij plaatsing een vaste
// dunne pen (DRAFTING_LINE_WIDTH), en (2) het fijnwerk in dit template draagt
// een EIGEN, met de eigen maat meeschalende dikte — ook bestaande annotaties
// met een dikke lijnbreedte renderen daardoor weer leesbaar.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  wapeningskorfTemplate, diaSignLineWidth, dotLineWidth, stirrupLineWidth,
} from './wapeningskorf.js';
import { DRAFTING_LINE_WIDTH } from '../../annotations/drafting.js';

test('tekenwerk-pen is dun en vast (losgekoppeld van de lint-lijndikte)', () => {
  assert.equal(DRAFTING_LINE_WIDTH, 0.7);
});

test('fijnwerk-diktes schalen mee en blijven dun t.o.v. hun eigen maat', () => {
  // Diameterteken: bij de default-korf in een 400px-bbox is de tekenstraal
  // ≈ 3,3 px; de pen moet daar ruim onder blijven (≤ 0,35 × straal), anders
  // loopt het teken dicht.
  for (const r of [2, 3.3, 5, 8]) {
    const lw = diaSignLineWidth(r);
    assert.ok(lw >= 0.3 && lw <= Math.max(0.35 * r, 0.31),
      `diaSign lw=${lw} bij r=${r}`);
  }
  // Staafpunt-omtrek: nooit dikker dan 0,9 px (de punt is toch gevuld).
  assert.ok(dotLineWidth(10) <= 0.9);
  assert.ok(dotLineWidth(0.5) >= 0.3);
  // Beugel: de pen mag hoogstens ~1/3 van de staafdikte zijn zodat de
  // dubbellijn (hart-op-hart = staafdikte) niet samenvloeit.
  for (const bar of [1, 3, 5]) {
    assert.ok(stirrupLineWidth(bar) <= bar / 2 + 0.31,
      `stirrup lw bij staafdikte ${bar}px`);
  }
});

test('render: fijnwerk draagt eigen lineWidth die niet dichtloopt', () => {
  const params = {}; // defaults: 400×400, beugel ⌀8, boven 4⌀12, onder 6⌀16
  const bbox = { x: 0, y: 0, width: 400, height: 300 };
  const L = wapeningskorfTemplate.layoutMm(params);
  const S = Math.min(bbox.width / L.footprint.width, bbox.height / L.footprint.height);
  const cmds = wapeningskorfTemplate.render(params, bbox);

  // Bewijs van het regressiescenario in cijfers: de dubbellijn van de beugel
  // ligt maar beugelDiameter × S px uit elkaar — bij de historische 2–3 px
  // penbreedte vloeide dat samen.
  const gap = L.beugelDiameter * S;
  assert.ok(gap < 4, `beugel-dubbellijn-afstand is fijnwerk (${gap.toFixed(2)}px)`);

  // 1. Elke kleine cirkel (diameterteken, r < 6px) heeft een eigen dunne pen.
  const smallCircles = cmds.filter(c => c.kind === 'circle' && c.r < 6);
  assert.ok(smallCircles.length >= 4, 'diametertekens aanwezig');
  for (const c of smallCircles) {
    assert.ok(c.lineWidth >= 0.3 && c.lineWidth <= Math.max(0.35 * c.r, 0.31),
      `tekencirkel r=${c.r.toFixed(2)} lw=${c.lineWidth}`);
  }

  // 2. Gevulde staafpunten: eigen omtrek-pen ≤ 0,9 px.
  const dots = cmds.filter(c => c.kind === 'polyline' && c.fill === true);
  assert.equal(dots.length, 4 + 6 + 2, 'boven+onder+zij staafpunten');
  for (const d of dots) {
    assert.ok(d.lineWidth >= 0.3 && d.lineWidth <= 0.9, `punt lw=${d.lineWidth}`);
  }

  // 3. Beugel-dubbellijn: pen hoogstens de halve lijnafstand, zodat de twee
  //    lijnen gescheiden blijven — ongeacht de annotatie-lijndikte.
  const stirLw = stirrupLineWidth(gap);
  const stirrupRects = cmds.filter(c => c.kind === 'polyline' && c.close && !c.fill
    && c.lineWidth != null);
  assert.ok(stirrupRects.length >= 2, 'beugel binnen- en buitenlijn');
  for (const r of stirrupRects) {
    assert.equal(r.lineWidth, stirLw);
    assert.ok(r.lineWidth <= gap / 2 + 0.31, `beugel lw=${r.lineWidth} bij gap=${gap}`);
  }

  // 4. De betonomtrek (grootste dichte polyline) draagt GEEN eigen pen — die
  //    blijft de door de gebruiker instelbare annotatie-lijndikte volgen.
  const outline = cmds.find(c => c.kind === 'polyline' && c.close && !c.fill
    && c.lineWidth == null);
  assert.ok(outline, 'betonomtrek volgt de annotatie-lijndikte');
});

// ─── Aanhaallijntjes: één per staaf, onder 60°, naar een verzamellijn ────

function korfOpdrachten(params, bbox = { x: 10, y: 20, width: 420, height: 320 }) {
  const L = wapeningskorfTemplate.layoutMm(params);
  const S = Math.min(bbox.width / L.footprint.width, bbox.height / L.footprint.height);
  const ox = bbox.x + (bbox.width - L.footprint.width * S) / 2;
  const oy = bbox.y + (bbox.height - L.footprint.height * S) / 2;
  const cmds = wapeningskorfTemplate.render(params, bbox);
  return {
    L, S, bbox, cmds, X: (v) => ox + v * S, Y: (v) => oy + v * S,
    lijntjes: (groep) => cmds.filter((c) => c.role === 'aanhaallijn' && (!groep || c.groep === groep)),
    verzamel: (groep) => cmds.filter((c) => c.role === 'verzamellijn' && (!groep || c.groep === groep)),
  };
}

/** Echte kruising van twee lijnstukken (raken aan een eindpunt telt niet). */
function kruisen(a, b) {
  const d = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = d(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const d2 = d(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  const d3 = d(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const d4 = d(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  const e = 1e-6;
  return ((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e));
}

test('aanhaallijntjes: vanaf elke staaf één, dus 4 / 6 / 2 bij de standaardkorf', () => {
  const k = korfOpdrachten({});
  assert.equal(k.lijntjes('boven').length, 4);
  assert.equal(k.lijntjes('onder').length, 6);
  assert.equal(k.lijntjes('zij').length, 2);
  assert.equal(k.lijntjes().length, 12);
  for (const groep of ['boven', 'onder', 'zij']) assert.equal(k.verzamel(groep).length, 1, groep);
});

test('aanhaallijntjes: beginnen op de staaf, lopen onder 60° en eindigen op de verzamellijn', () => {
  for (const params of [
    {},
    { bovenAantal: 2, bovenDiameter: 10, onderAantal: 3, zijAantal: 4 },
    { breedte: 300, hoogte: 900, zijAantal: 6, onderAantal: 5, bovenAantal: 1 },
    { breedte: 800, hoogte: 250, zijAantal: 0, onderAantal: 8, dekking: 45 },
  ]) {
    const k = korfOpdrachten(params);
    for (const groep of ['boven', 'onder', 'zij']) {
      const staven = k.L[groep];
      const lijntjes = k.lijntjes(groep);
      assert.equal(lijntjes.length, staven.length, `${groep}: één lijntje per staaf`);
      if (!staven.length) {
        assert.equal(k.verzamel(groep).length, 0, `${groep}: geen verzamellijn zonder staven`);
        continue;
      }
      const [v] = k.verzamel(groep);
      assert.ok(Math.abs(v.y1 - v.y2) < 1e-9, `${groep}: verzamellijn is horizontaal`);
      assert.ok(Math.abs(v.y1 - k.Y(k.L.labels[groep].y)) < 1e-6, `${groep}: verzamellijn op teksthoogte`);
      const links = Math.min(v.x1, v.x2), rechts = Math.max(v.x1, v.x2);
      assert.ok(rechts <= k.X(k.L.labels[groep].x) + 1e-6, `${groep}: verzamellijn stopt vóór de tekst`);
      assert.ok(rechts > k.X(k.L.sec.x + k.L.breedte), `${groep}: verzamellijn reikt tot naast de doorsnede`);
      staven.forEach((staaf, i) => {
        const l = lijntjes[i];
        assert.ok(Math.abs(l.x1 - k.X(staaf.x)) < 1e-6 && Math.abs(l.y1 - k.Y(staaf.y)) < 1e-6,
          `${groep} ${i}: begint in het hart van de staaf`);
        const dx = Math.abs(l.x2 - l.x1), dy = Math.abs(l.y2 - l.y1);
        assert.ok(dy > 1e-6, `${groep} ${i}: lijntje heeft lengte`);
        const hoek = Math.atan2(dy, dx) * 180 / Math.PI;
        assert.ok(Math.abs(hoek - 60) < 1e-6, `${groep} ${i}: hoek ${hoek}° i.p.v. 60°`);
        assert.ok(Math.abs(l.y2 - v.y1) < 1e-6, `${groep} ${i}: eindigt op de verzamellijn`);
        assert.ok(l.x2 >= links - 1e-6 && l.x2 <= rechts + 1e-6, `${groep} ${i}: eindpunt ligt op de verzamellijn`);
      });
    }
    // Kant per groep: boven → erboven, onder → eronder (buiten de doorsnede).
    if (k.L.boven.length) assert.ok(k.verzamel('boven')[0].y1 < k.Y(k.L.sec.y));
    if (k.L.onder.length) assert.ok(k.verzamel('onder')[0].y1 > k.Y(k.L.sec.y + k.L.hoogte));
  }
});

test('aanhaallijntjes: dun, kruisen elkaar niet en blijven binnen de bbox', () => {
  for (const params of [
    {},
    { zijAantal: 5, bovenAantal: 7 },
    { breedte: 300, hoogte: 900, zijAantal: 6 },
    { breedte: 250, hoogte: 1500, zijAantal: 8, bovenAantal: 2, onderAantal: 2 },
    { breedte: 900, hoogte: 200, onderAantal: 10, dekking: 50, onderDiameter: 32 },
  ]) {
    const k = korfOpdrachten(params);
    const lijnen = [...k.lijntjes(), ...k.verzamel()];
    for (const l of lijnen) {
      assert.ok(l.lineWidth > 0 && l.lineWidth <= 0.5, `dunne pen (${l.lineWidth})`);
      for (const [x, y] of [[l.x1, l.y1], [l.x2, l.y2]]) {
        assert.ok(x >= k.bbox.x - 0.5 && x <= k.bbox.x + k.bbox.width + 0.5, `x=${x} binnen bbox`);
        assert.ok(y >= k.bbox.y - 0.5 && y <= k.bbox.y + k.bbox.height + 0.5, `y=${y} binnen bbox`);
      }
    }
    const lijntjes = k.lijntjes();
    for (let i = 0; i < lijntjes.length; i++) {
      for (let j = i + 1; j < lijntjes.length; j++) {
        assert.ok(!kruisen(lijntjes[i], lijntjes[j]),
          `lijntjes ${lijntjes[i].groep}/${lijntjes[j].groep} kruisen (${JSON.stringify(params)})`);
      }
      // Een lijntje kruist ook geen verzamellijn van een ándere groep.
      for (const v of k.verzamel()) {
        if (v.groep !== lijntjes[i].groep) assert.ok(!kruisen(lijntjes[i], v), 'lijntje kruist vreemde verzamellijn');
      }
    }
  }
});

test('aanhaallijntjes: geen lijntjes zonder labels of zonder staven; tekst blijft gelijk', () => {
  const uit = korfOpdrachten({ toonLabels: false });
  assert.equal(uit.lijntjes().length + uit.verzamel().length, 0);
  const leeg = korfOpdrachten({ bovenAantal: 0, zijAantal: 0 });
  assert.equal(leeg.lijntjes('boven').length, 0);
  assert.equal(leeg.lijntjes('zij').length, 0);
  assert.equal(leeg.lijntjes('onder').length, 6);
  const teksten = korfOpdrachten({}).cmds.filter((c) => c.kind === 'text').map((c) => c.text);
  for (const t of ['4', '12', '6', '16', '2', '10', 'bgls', '8 - 150', 'Korf A']) {
    assert.ok(teksten.includes(t), `tekst "${t}" aanwezig`);
  }
});
