// Overspanningspijl vloer: dichte (gevulde) pijlpunten en een tekst die boven
// de pijllijn binnen het kader blijft.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { overspanningspijlVloerTemplate as tpl, estimateTextWidth } from './overspanningspijl-vloer.js';
import { assertBinnenBbox } from './binnen-bbox.testhulp.mjs';

const BBOX = { x: 10, y: 20, width: 360, height: 70 };
const pijllijn = (cmds) => cmds.find((c) => c.role === 'pijllijn');
const tekst = (cmds) => cmds.find((c) => c.kind === 'text');

function oppervlak(points) {
  let som = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    som += a.x * b.y - b.x * a.y;
  }
  return Math.abs(som) / 2;
}

test('standaard: twee gesloten, gevulde driehoeken als pijlpunt', () => {
  const cmds = tpl.render({}, BBOX);
  const punten = cmds.filter((c) => c.role === 'pijlpunt');
  assert.equal(punten.length, 2);
  for (const p of punten) {
    assert.equal(p.kind, 'polyline');
    assert.equal(p.points.length, 3);
    assert.equal(p.close, true, 'driehoek is gesloten');
    assert.equal(p.fill, true, 'driehoek is gevuld');
    assert.ok(oppervlak(p.points) > 1, 'driehoek heeft oppervlak');
  }
  const lijn = pijllijn(cmds);
  // De punt van elke driehoek ligt op een uiteinde van de pijllijn.
  assert.ok(punten[0].points.some((q) => q.x === lijn.x1 && q.y === lijn.y1));
  assert.ok(punten[1].points.some((q) => q.x === lijn.x2 && q.y === lijn.y2));
});

test('halve pijlpunten: een gevulde halve driehoek per uiteinde', () => {
  const cmds = tpl.render({ pijlvorm: 'half' }, BBOX);
  const lijn = pijllijn(cmds);
  const vullingen = cmds.filter((c) => c.role === 'pijlpuntvulling');
  assert.equal(vullingen.length, 2);
  for (const v of vullingen) {
    assert.equal(v.kind, 'polyline');
    assert.equal(v.points.length, 3);
    assert.equal(v.close, true);
    assert.equal(v.fill, true);
    assert.ok(oppervlak(v.points) > 1);
    // Half: twee van de drie hoekpunten liggen op de pijllijn.
    assert.equal(v.points.filter((q) => q.y === lijn.y1).length, 2);
  }
  const [links, rechts] = vullingen;
  // Links hangt de halve punt onder de lijn, rechts staat hij erboven.
  assert.ok(links.points.every((q) => q.y >= lijn.y1));
  assert.ok(rechts.points.every((q) => q.y <= lijn.y1));
  // De weerhaak zelf blijft als lijn aanwezig (schuine zijde van de driehoek).
  const haken = cmds.filter((c) => c.role === 'pijlpunt');
  assert.equal(haken.length, 2);
  assert.ok(haken.every((c) => c.kind === 'line'));
});

for (const pijlvorm of ['open', 'half']) {
  test(`tekst staat gecentreerd boven de pijllijn (${pijlvorm})`, () => {
    const cmds = tpl.render({ pijlvorm }, BBOX);
    const t = tekst(cmds);
    const lijn = pijllijn(cmds);
    assert.equal(t.text, 'Overspanningsrichting vloer');
    assert.equal(t.x, BBOX.x + BBOX.width / 2);
    // De renderer tekent tekst gecentreerd op (x, y), verticaal op het midden.
    assert.ok(t.y - t.size / 2 >= BBOX.y - 1e-9, 'bovenkant binnen het kader');
    const hoogstePijl = Math.min(...cmds
      .filter((c) => c.role === 'pijlpunt' || c.role === 'pijlpuntvulling')
      .flatMap((c) => (c.points ? c.points.map((q) => q.y) : [c.y1, c.y2])));
    assert.ok(t.y + t.size / 2 <= hoogstePijl + 1e-9, 'onderkant boven de pijlpunten');
    assert.ok(t.y + t.size / 2 < lijn.y1, 'onderkant boven de pijllijn');
  });
}

test('tekst wordt verkleind tot hij binnen de bbox-breedte past', () => {
  const lang = 'Overspanningsrichting kanaalplaatvloer 260 mm met druklaag 50 mm';
  for (const bbox of [BBOX, { x: 0, y: 0, width: 170, height: 20 }, { x: 5, y: 5, width: 60, height: 12 }]) {
    for (const text of [undefined, lang]) {
      const cmds = tpl.render(text === undefined ? {} : { tekst: text }, bbox);
      const t = tekst(cmds);
      assert.ok(t.size > 0);
      const breedte = estimateTextWidth(t.text, t.size);
      assert.ok(breedte <= bbox.width + 1e-9, `tekst ${breedte} past niet in ${bbox.width}`);
      assert.ok(t.y - t.size / 2 >= bbox.y - 1e-9);
      assertBinnenBbox(cmds, bbox, 'overspanningspijl');
    }
  }
  const kort = tekst(tpl.render({ tekst: 'V1' }, BBOX));
  const langer = tekst(tpl.render({ tekst: lang }, BBOX));
  assert.ok(langer.size < kort.size, 'lange tekst krijgt een kleinere letter');
});

test('breedteschatting ligt niet onder de werkelijke letterbreedte', () => {
  // Arial: 'Overspanningsrichting vloer' is 12,39 em breed.
  assert.ok(estimateTextWidth('Overspanningsrichting vloer', 100) >= 1239);
});

test('bestaande params blijven werken', () => {
  const cmds = tpl.render({ lengte: 7200, tekst: 'Breedplaat overspanning' }, { x: 0, y: 0, width: 720, height: 100 });
  assert.equal(tekst(cmds).text, 'Breedplaat overspanning');
  assert.equal(cmds.filter((c) => c.role === 'pijlpunt').length, 2);
  assert.equal(tpl.realSizeMm({ lengte: 7200 }).width, 7200);
  assert.equal(tpl.snapPoints({}, BBOX).length, 3);
  assert.deepEqual(tpl.params.map((p) => p.key), ['lengte', 'tekst', 'pijlvorm']);
});
