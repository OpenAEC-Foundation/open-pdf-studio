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
