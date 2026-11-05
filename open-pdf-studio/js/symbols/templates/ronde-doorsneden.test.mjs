import assert from 'node:assert/strict';
import test from 'node:test';
import { getTemplate, defaultParams } from '../registry.js';
import { NL_CATEGORIES } from '../../solid/data/nlSymbolLibrary.js';
import { ifcCategoryForParametric } from '../../solid/data/ifcCategoryMap.js';
import { isSafeSymbolSvg } from '../../solid/data/symbolLibraryOnline.js';

const expected = {
  'staal-chs': 'IfcMember', 'beton-rond': 'IfcMember', 'hout-rond': 'IfcMember',
  'paal-plattegrond': 'IfcPile', 'overspanningsharpoen-vloer': 'IfcAnnotation',
};
const bbox = { x: 10, y: 20, width: 100, height: 100 };

test('all five requested symbols are placeable from NL IFC Bouw with the correct IFC category', () => {
  const symbols = NL_CATEGORIES.find(g => g.id === 'nl-ifc-bouw').symbols;
  for (const [id, category] of Object.entries(expected)) {
    assert.ok(getTemplate(id), `${id}: registered`);
    const entries = symbols.filter(s => s.parametricId === id);
    assert.equal(entries.length, 1, `${id}: one palette entry`);
    assert.equal(isSafeSymbolSvg(entries[0].svg), true, `${id}: valid preview`);
    assert.equal(ifcCategoryForParametric(id), category);
  }
});

test('CHS cross-section has two concentric loops, correct diameter/wall, and circular snaps', () => {
  const tpl = getTemplate('staal-chs');
  for (const maat of tpl.params.find(p => p.key === 'maat').options) {
    const [d, t] = maat.slice(4).split('x').map(Number);
    const params = { maat, hartlijn: false, toonLabel: false };
    assert.deepEqual(tpl.realSizeMm(params), { width: d, height: d });
    const [{ loops, fill }] = tpl.render(params, bbox);
    assert.equal(fill, true);
    assert.equal(loops.length, 2);
    for (const [i, loop] of loops.entries()) {
      const radius = 50 * (i ? 1 - 2 * t / d : 1);
      for (const p of loop) assert.ok(Math.abs(Math.hypot(p.x - 60, p.y - 70) - radius) < 1e-8);
    }
    assert.equal(tpl.snapPoints(params, bbox).length, 5);
  }
  assert.deepEqual(tpl.realSizeMm({ maat: 'CHS 114.3x5', schaal: 2 }), { width: 228.6, height: 228.6 });
});

test('CHS top and side views keep a free beam length with two hidden walls', () => {
  const tpl = getTemplate('staal-chs');
  for (const aanzicht of ['boven', 'zij']) {
    const params = { maat: 'CHS 114.3x5', aanzicht, hartlijn: false };
    assert.deepEqual(tpl.realSizeMm(params), { width: null, height: 114.3 });
    assert.equal(tpl.freeAxis(params), 'x');
    const lines = tpl.render(params, { x: 0, y: 0, width: 600, height: 114.3 }).filter(c => c.kind === 'line');
    assert.deepEqual(lines.map(c => c.y1), [5, 109.3]);
    assert.ok(lines.every(c => c.dash?.length && c.x2 === 600));
  }
});

test('round solid sections use custom diameters, material fills and finite fallback dimensions', () => {
  for (const id of ['hout-rond', 'beton-rond']) {
    const tpl = getTemplate(id);
    assert.deepEqual(tpl.realSizeMm({ diameter: 450, schaal: 2 }), { width: 900, height: 900 });
    for (const diameter of [NaN, Infinity, -5, 0, undefined]) {
      assert.deepEqual(tpl.realSizeMm({ diameter }), { width: 300, height: 300 });
    }
    const cmds = tpl.render({ diameter: 450, houtsoort: 'eiken' }, bbox);
    const outline = cmds.find(c => c.kind === 'polyline');
    for (const p of outline.points) assert.ok(Math.abs(Math.hypot(p.x - 60, p.y - 70) - 50) < 1e-8);
    assert.equal(cmds.find(c => c.kind === 'text').text, 'Ø 450');
    assert.equal(cmds.find(c => c.kind === 'hatch').color, id === 'hout-rond' ? '#d9c49a' : '#dcdcdc');
    assert.equal(tpl.render({ toonLabel: false }, bbox).some(c => c.kind === 'text'), false);
    assert.equal(tpl.freeAxis({}), null);
  }
});

test('pile plan marker snaps to its cross and keeps its editable number inside the appearance', () => {
  const tpl = getTemplate('paal-plattegrond');
  const cmds = tpl.render({ nummer: 'P-12' }, bbox);
  const c = cmds.find(c => c.kind === 'circle');
  assert.deepEqual([c.cx, c.cy], [60, 70], 'position stays at the placement centre');
  const lines = cmds.filter(c => c.kind === 'line');
  assert.equal(lines[0].y1, c.cy);
  assert.equal(lines[1].x1, c.cx);
  assert.deepEqual(tpl.snapPoints({}, bbox), [{ kind: 'center', x: c.cx, y: c.cy }]);
  const label = cmds.find(c => c.kind === 'text');
  assert.equal(label.text, 'P-12');
  assert.ok(label.y - label.size / 2 >= bbox.y);
  assert.ok(label.y + label.size / 2 < c.cy - c.r);
  assert.equal(tpl.render({ toonLabel: false }, bbox).length, 3);
});

test('alternate floor span has left-down/right-up barbs, while the old arrow remains double-headed', () => {
  const old = getTemplate('overspanningspijl-vloer');
  const tpl = getTemplate('overspanningsharpoen-vloer');
  const params = { lengte: 4500, tekst: 'Vloer A' };
  const legacy = old.render(params, bbox);
  const cmds = tpl.render(params, bbox);
  const [left, right] = cmds.filter(c => c.role === 'pijlpunt');
  assert.equal(left.points.length, 2);
  assert.equal(right.points.length, 2);
  assert.ok(left.points[1].y > left.points[0].y);
  assert.ok(right.points[0].y < right.points[1].y);
  assert.ok(legacy.filter(c => c.role === 'pijlpunt').every(c => c.points.length === 3));
  assert.deepEqual(tpl.realSizeMm(params), old.realSizeMm(params));
  assert.deepEqual(tpl.snapPoints(params, bbox), old.snapPoints(params, bbox));
  assert.equal(cmds.find(c => c.kind === 'text').text, 'Vloer A');
});

test('new template defaults and geometry survive parameter serialization', () => {
  for (const id of Object.keys(expected)) {
    const tpl = getTemplate(id);
    const params = defaultParams(tpl);
    assert.deepEqual(tpl.render(JSON.parse(JSON.stringify(params)), bbox), tpl.render(params, bbox));
  }
});
