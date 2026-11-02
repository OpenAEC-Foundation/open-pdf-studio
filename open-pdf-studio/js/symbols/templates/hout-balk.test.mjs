import test from 'node:test';
import assert from 'node:assert/strict';
import { houtBalkTemplate as t } from './hout-balk.js';
import { assertBinnenBbox } from './binnen-bbox.testhulp.mjs';

const bbox = { x: 23, y: -17, width: 400, height: 45 };

test('old timber sections keep their dimensions and diagonal section hatch', () => {
  assert.deepEqual(t.realSizeMm({ maat: '45 x 70' }), { width: 70, height: 45 });
  assert.equal(t.freeAxis({}), null);
  assert.deepEqual(t.render({}, bbox), t.render({ aanzicht: 'doorsnede' }, bbox));
  assert.ok(t.render({}, bbox).some(c => c.kind === 'hatch' && c.pattern === 'diagonal-left'));
});

test('timber schema exposes section, top and side views with section as default', () => {
  const view = t.params.find(p => p.key === 'aanzicht');
  assert.equal(view?.default, 'doorsnede');
  assert.deepEqual(view.options.map(o => o.value), ['doorsnede', 'boven', 'zij']);
});

test('elevations have a free length and a real thickness from the existing section axes', () => {
  for (const [aanzicht, height] of [['boven', 70], ['zij', 45]]) {
    assert.deepEqual(t.realSizeMm({ maat: '45 x 70', aanzicht }), { width: null, height });
    assert.equal(t.freeAxis({ aanzicht }), 'x');
  }
  assert.deepEqual(t.realSizeMm({ maat: '45 x 70', aanzicht: 'zij', eigenHoogte: 90, schaal: 2 }),
    { width: null, height: 180 });
  assert.deepEqual(t.realSizeMm({ aanzicht: 'boven', eigenBreedte: 120, schaal: 0.5 }),
    { width: null, height: 60 });
});

test('elevations draw the full beam length without a cross-section hatch', () => {
  for (const aanzicht of ['boven', 'zij']) {
    for (const box of [bbox, { x: 0, y: 0, width: 10, height: 3 }]) {
      const commands = t.render({ aanzicht, toonLabel: false, houtsoort: 'douglas' }, box);
      assertBinnenBbox(commands, box);
      assert.equal(commands.filter(c => c.kind === 'hatch').length, 1);
      assert.equal(commands[0].pattern, 'solid');
      assert.equal(commands[0].color, '#e2bb8e');
      const outline = commands.find(c => c.kind === 'polyline');
      assert.equal(Math.max(...outline.points.map(p => p.x)) - Math.min(...outline.points.map(p => p.x)), box.width);
      assert.equal(commands.some(c => c.kind === 'text'), false);
    }
  }
});

test('unknown view values fall back to the legacy section', () => {
  const unknown = { aanzicht: 'future-view' };
  assert.deepEqual(t.realSizeMm(unknown), t.realSizeMm({}));
  assert.deepEqual(t.render(unknown, bbox), t.render({}, bbox));
  assert.equal(t.freeAxis(unknown), null);
});

test('the shared sizing engine keeps elevation length and applies drawing scale', async () => {
  const { register } = await import('node:module');
  register('../../core/app-test-hooks.mjs', import.meta.url);
  const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
  installeerBrowserStubs();
  const { state } = await import('../../core/state.ts');
  const { applyTemplateRealSize } = await import('../real-size.js');
  state.documents = [{ annotations: [], measureScale: { pixelsPerUnit: 0.1, unit: 'mm' } }];
  state.activeDocumentIndex = 0;
  const ann = { type: 'parametricSymbol', symbolId: 'hout-balk', page: 1,
    x: 20, y: 30, width: 300, height: 20, params: { maat: '45 x 70', aanzicht: 'boven' } };
  const center = () => ({ x: ann.x + ann.width / 2, y: ann.y + ann.height / 2 });
  const before = center();
  assert.equal(applyTemplateRealSize(ann), true);
  assert.equal(ann.width, 300);
  assert.equal(ann.height, 7);
  assert.deepEqual(center(), before);
  ann.params.aanzicht = 'zij';
  applyTemplateRealSize(ann);
  assert.equal(ann.width, 300);
  assert.equal(ann.height, 4.5);
  assert.deepEqual(center(), before);
  ann.params.aanzicht = 'doorsnede';
  applyTemplateRealSize(ann);
  assert.equal(ann.width, 7);
  assert.equal(ann.height, 4.5);
  assert.deepEqual(center(), before);
});
