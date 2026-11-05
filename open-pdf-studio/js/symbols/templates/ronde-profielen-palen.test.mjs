// Uitbreiding NL IFC Bouw (#936): ronde buis (CHS), ronde beton-/hout-
// doorsnede, houten balk in aanzicht, paalpositie voor het palenplan en de
// overspanningspijl met halve pijlpunten (⥋).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getTemplate, defaultParams } from '../registry.js';
import { NL_CATEGORIES } from '../../solid/data/nlSymbolLibrary.js';
import { ifcCategoryForSymbol } from '../../solid/data/ifcCategoryMap.js';

const BBOX = { x: 10, y: 20, width: 100, height: 100 };
const render = (id, p = {}, bbox = BBOX) => {
  const tpl = getTemplate(id);
  return tpl.render({ ...defaultParams(tpl), ...p }, bbox);
};
const eindig = (cmds) => {
  for (const c of cmds) {
    const v = [c.x, c.y, c.x1, c.y1, c.x2, c.y2, c.cx, c.cy, c.r,
      ...(c.points || []).flatMap((q) => [q.x, q.y]),
      ...(c.loops || []).flat().flatMap((q) => [q.x, q.y])].filter((n) => n !== undefined);
    assert.ok(v.every(Number.isFinite), JSON.stringify(c).slice(0, 120));
  }
};
const nl = NL_CATEGORIES.find((c) => c.id === 'nl-ifc-bouw');
const knop = (id) => nl.symbols.find((s) => s.id === id);

test('buis (CHS): ware maat, holle doorsnede en aanzicht met vrije lengte', () => {
  const tpl = getTemplate('staal-buis');
  assert.ok(tpl);
  assert.deepEqual(tpl.realSizeMm({ maat: 'CHS 219.1x8' }), { width: 219.1, height: 219.1 });
  assert.deepEqual(tpl.realSizeMm({ maat: 'CHS 219.1x8', aanzicht: 'zij' }), { width: null, height: 219.1 });
  assert.equal(tpl.freeAxis({ aanzicht: 'boven' }), 'x');
  assert.equal(tpl.freeAxis({ aanzicht: 'doorsnede' }), null);
  const ring = render('staal-buis').find((c) => c.kind === 'rings');
  assert.equal(ring.loops.length, 2, 'buitenomtrek en opening');
  assert.equal(ring.fill, true);
  // Buitenstraal = halve vakbreedte, wanddikte naar verhouding.
  const r = (loop) => Math.max(...loop.map((q) => Math.hypot(q.x - 60, q.y - 70)));
  assert.ok(Math.abs(r(ring.loops[0]) - 50) < 1e-6);
  assert.ok(Math.abs(r(ring.loops[1]) - 50 * (114.3 / 2 - 5) / (114.3 / 2)) < 1e-6);
  const zij = render('staal-buis', { aanzicht: 'zij' }, { x: 0, y: 0, width: 400, height: 50 });
  assert.equal(zij.filter((c) => c.kind === 'line' && c.dash && c.y1 === c.y2 && c.x1 === 0).length, 2, 'twee gestreepte wanden');
  eindig(zij);
  assert.equal(ifcCategoryForSymbol(knop('param-staal-buis')), 'IfcMember');
});

test('ronde doorsnede: beton grijs, hout in de houtkleur, op ware diameter', () => {
  const tpl = getTemplate('ronde-doorsnede');
  assert.deepEqual(tpl.realSizeMm({ diameter: 600, schaal: 1 }), { width: 600, height: 600 });
  const beton = render('ronde-doorsnede');
  const hout = render('ronde-doorsnede', { materiaal: 'hout', houtsoort: 'eiken' });
  const vulling = (cmds) => cmds.filter((c) => c.kind === 'hatch').map((c) => `${c.pattern}:${c.color}`);
  assert.deepEqual(vulling(beton), ['solid:#b3b3b3']);
  assert.deepEqual(vulling(hout), ['solid:#d9c49a', 'diagonal-left:#9b8a64']);
  assert.ok(beton.some((c) => c.kind === 'circle' && c.r === 50));
  assert.equal(beton.find((c) => c.role === 'label').text, 'Ø400');
  assert.ok(!render('ronde-doorsnede', { toonLabel: false }).some((c) => c.role === 'label'));
  eindig(hout);
  assert.equal(ifcCategoryForSymbol(knop('param-ronde-doorsnede')), 'IfcPile');
});

test('houten balk: aanzicht naast de doorsnede, bestaande balken blijven doorsnede', () => {
  const tpl = getTemplate('hout-balk');
  assert.equal(defaultParams(tpl).aanzicht, 'doorsnede');
  assert.deepEqual(tpl.realSizeMm({ maat: '45 x 195' }), { width: 195, height: 45 });
  assert.deepEqual(tpl.realSizeMm({ maat: '45 x 195', aanzicht: 'zij' }), { width: null, height: 45 });
  assert.deepEqual(tpl.realSizeMm({ maat: '45 x 195', aanzicht: 'boven' }), { width: null, height: 195 });
  // Een balk uit een ouder bestand heeft geen aanzicht-parameter: doorsnede.
  assert.deepEqual(tpl.realSizeMm({ maat: '45 x 70' }), { width: 70, height: 45 });
  assert.equal(tpl.freeAxis({}), null);
  assert.equal(tpl.freeAxis({ aanzicht: 'zij' }), 'x');
  const patroon = (p) => render('hout-balk', p).filter((c) => c.kind === 'hatch').map((c) => c.pattern);
  assert.deepEqual(patroon({}), ['solid', 'diagonal-left']);
  assert.deepEqual(patroon({ aanzicht: 'zij' }), ['solid', 'wood-grain']);
  assert.deepEqual(knop('param-hout-balk-aanzicht').params, { aanzicht: 'zij' });
});

test('paalpositie: vierkant of rond, met kruis en paalnummer', () => {
  const tpl = getTemplate('paalpositie');
  assert.deepEqual(tpl.realSizeMm({ maat: 320, schaal: 1 }), { width: 320, height: 320 });
  const vierkant = render('paalpositie');
  assert.ok(vierkant.some((c) => c.kind === 'polyline' && c.close && c.role === 'paal'));
  assert.equal(vierkant.filter((c) => c.role === 'kruis').length, 2);
  const nummer = vierkant.find((c) => c.role === 'nummer');
  assert.equal(nummer.text, '1');
  assert.ok(nummer.x > BBOX.x + BBOX.width && nummer.y < BBOX.y, 'nummer rechtsboven de paal');
  const rond = render('paalpositie', { vorm: 'rond', nummer: 'P12', kruis: false });
  assert.ok(rond.some((c) => c.kind === 'circle' && c.r === 50));
  assert.equal(rond.filter((c) => c.role === 'kruis').length, 0);
  assert.equal(rond.find((c) => c.role === 'nummer').text, 'P12');
  assert.ok(!render('paalpositie', { toonNummer: false }).some((c) => c.role === 'nummer'));
  eindig(rond);
  assert.equal(ifcCategoryForSymbol(knop('param-paalpositie')), 'IfcPile');
});

test('overspanningspijl: halve pijlpunten (⥋) naast de open pijlpunten', () => {
  const bbox = { x: 0, y: 0, width: 360, height: 70 };
  const punten = (p) => render('overspanningspijl-vloer', p, bbox).filter((c) => c.role === 'pijlpunt');
  const open = punten({});
  assert.equal(open.length, 2);
  assert.ok(open.every((c) => c.kind === 'polyline' && c.points.length === 3), 'standaard: open pijlkoppen');
  const half = punten({ pijlvorm: 'half' });
  assert.equal(half.length, 2);
  assert.ok(half.every((c) => c.kind === 'line'), 'één weerhaak per uiteinde');
  const [links, rechts] = half;
  // Links: weerhaak omlaag naar rechts; rechts: omhoog naar links.
  assert.ok(links.x2 > links.x1 && links.y2 > links.y1);
  assert.ok(rechts.x2 < rechts.x1 && rechts.y2 < rechts.y1);
  const tekst = render('overspanningspijl-vloer', { pijlvorm: 'half', tekst: 'Overspanning' }, bbox).find((c) => c.kind === 'text');
  assert.equal(tekst.text, 'Overspanning');
  assert.deepEqual(knop('param-overspanningspijl-half').params, { pijlvorm: 'half' });
});
