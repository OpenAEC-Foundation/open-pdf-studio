import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { wheelZoomDelta } from './wheel-zoom.js';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('reverse zoom is opt-in and preserves the size of fine and notch deltas', () => {
  for (const delta of [-100, -2, 2, 100]) {
    for (const pref of [undefined, {}, { reverseWheelZoom: false }, { reverseWheelZoom: 'true' }]) {
      assert.equal(wheelZoomDelta(delta, pref), delta);
    }
    assert.equal(wheelZoomDelta(delta, { reverseWheelZoom: true }), -delta);
  }
  for (const delta of [0, undefined, NaN, Infinity]) {
    assert.ok(wheelZoomDelta(delta, { reverseWheelZoom: true }) === 0);
  }
});

function nativeWheel(lineEnding) {
  let wheel;
  const steps = [], toolDeltas = [];
  const preferences = { reverseWheelZoom: false, wheelZoomWithoutCtrl: false };
  const canvas = { getBoundingClientRect: () => ({ left: 20, top: 30 }) };
  const context = {
    wheelZoomDelta, state: { preferences }, getActiveDocument: () => ({ pdfDoc: {}, filePath: 'test.pdf' }),
    document: { querySelector: () => ({ addEventListener: (_, f) => { wheel = f; } }), getElementById: () => canvas },
    viewport: { active: true }, zoomStepAtPoint: (...args) => steps.push(args), stopPanMomentum() {},
    maakWielHerkenning: () => ({}), maakElementVerschuiver: () => ({}),
    maakWielScroller: () => ({ stop() {} }), vloeiendScrollenAan: () => false,
    setTimeout: () => 1, clearTimeout() {},
    getTool: () => ({ onWheel: (_, e) => { toolDeltas.push(e.deltaY); e.preventDefault(); } }),
  };
  const navigationSource = source('../ui/setup/navigation-events.js').replace(/\r?\n/g, lineEnding);
  vm.runInNewContext(navigationSource.replace(/^import .*;\r?\n/gm, '').replace(/export /g, '') + '\nsetupWheelZoom();', context);
  return { preferences, steps, toolDeltas, wheel: (deltaY, extra = {}) => wheel({
    deltaY, clientX: 70, clientY: 90, ctrlKey: true, preventDefault() { this.defaultPrevented = true; }, ...extra,
  }) };
}

for (const lineEnding of ['\n', '\r\n']) for (const reverse of [false, true]) {
  test(`native viewport applies current preference ${reverse} with ${lineEnding === '\n' ? 'LF' : 'CRLF'}, keeping anchor and pinch threshold`, async () => {
    const h = nativeWheel(lineEnding); h.preferences.reverseWheelZoom = reverse;
    await h.wheel(-100); await h.wheel(100);
    assert.deepEqual(h.steps, [[50, 60, reverse ? -1 : 1], [50, 60, reverse ? 1 : -1]]);
    h.steps.length = 0;
    for (let i = 0; i < 4; i++) await h.wheel(-10);
    assert.equal(h.steps.length, 0);
    await h.wheel(-10);
    assert.deepEqual(h.steps, [[50, 60, reverse ? -1 : 1]]);
    h.steps.length = 0;
    await h.wheel(0); assert.equal(h.steps.length, 0);
    await h.wheel(-100, { ctrlKey: false });
    assert.deepEqual(h.toolDeltas, [-100]); assert.equal(h.steps.length, 0);
    h.preferences.wheelZoomWithoutCtrl = true;
    await h.wheel(100, { ctrlKey: false });
    assert.deepEqual(h.steps, [[50, 60, reverse ? 1 : -1]]);
    h.preferences.reverseWheelZoom = !reverse;
    await h.wheel(100, { ctrlKey: false, metaKey: true });
    assert.deepEqual(h.steps[1], [50, 60, reverse ? -1 : 1]);
  });
}

// Execute the real auxiliary-view handlers with their view dependencies supplied.
// This catches a missed consumer even when the shared delta helper is correct.
for (const reverse of [false, true]) {
  test(`compare and organizer wheel handlers obey reverse=${reverse}; ordinary scroll stays native`, () => {
    const preferences = { reverseWheelZoom: reverse }, factors = [], indexes = [];
    const event = deltaY => ({ deltaY, ctrlKey: true, preventDefault() {}, stopPropagation() {} });
    const compare = source('../solid/components/compare/CompareView.jsx');
    const block = compare.slice(compare.indexOf('  const handleWheel ='), compare.indexOf('  // +/− buttons'));
    const wheel = vm.runInNewContext(block + '\nhandleWheel;', {
      state: { preferences }, wheelZoomDelta, activePane: () => 'pane',
      zoomAnchored: (_, x, y, factor) => factors.push(factor), tryWheelPageNav: () => false,
    });
    wheel(event(-100)); wheel(event(100)); wheel(event(0)); wheel({ ...event(100), ctrlKey: false });
    assert.deepEqual(factors, reverse ? [1 / 1.1, 1.1] : [1.1, 1 / 1.1]);
    const organizer = source('../solid/components/dialogs/PageOrganizerDialog.jsx');
    const orgBlock = organizer.slice(organizer.indexOf('  const handleWheel ='), organizer.indexOf('  // ── Pending operations'));
    const orgWheel = vm.runInNewContext(orgBlock + '\nhandleWheel;', {
      state: { preferences }, wheelZoomDelta, zoom: () => 2, zoomStep: (i, step) => i + step,
      setZoomKeepingFocus: i => indexes.push(i),
    });
    orgWheel(event(-100)); orgWheel(event(100)); orgWheel(event(0)); orgWheel({ ...event(100), ctrlKey: false });
    assert.deepEqual(indexes, reverse ? [1, 3] : [3, 1]);
  });

  test(`synchronized split wheel obeys reverse=${reverse} without reversing scroll`, () => {
    const src = source('../pdf/split-view/split-view.js');
    const start = src.indexOf('function opWiel('), end = src.indexOf('function stuurNaarLive(');
    assert.ok(start >= 0 && end > start);
    const calls = [];
    const wheel = vm.runInNewContext(src.slice(start, end) + '\nopWiel;', {
      state: { preferences: { reverseWheelZoom: reverse } }, wheelZoomDelta,
      getActiveDocument: () => ({ pdfDoc: {} }), splitStaatVan: () => ({ sync: true }), _zichtbaar: true,
      byId: () => ({ clientWidth: 800, clientHeight: 600 }),
      wielDelta: e => ({ dx: 0, dy: e.deltaY, stap: true }), stuurNaarLive: (_, args) => calls.push(args),
    });
    for (const [deltaY, ctrlKey] of [[-100, true], [100, true], [0, true], [100, false]]) {
      wheel({ deltaY, ctrlKey, preventDefault() {}, stopPropagation() {} });
    }
    assert.deepEqual(calls.map(c => c.richting).slice(0, 2), reverse ? [-1, 1] : [1, -1]);
    assert.equal(calls.length, 3); assert.equal(calls[2].zoomen, false); assert.equal(calls[2].dy, 100);
  });
}

test('watermark preview reverses only wheel zoom and ignores a horizontal-only event', () => {
  const src = source('../solid/components/dialogs/WatermarkPreview.jsx');
  const body = src.slice(src.indexOf('onWheel={e=>{') + 'onWheel={e=>{'.length, src.indexOf('\n    }}>'));
  for (const reverse of [false, true]) {
    const results = [];
    const wheel = vm.runInNewContext('(e) => {' + body + '\n}', {
      state: { preferences: { reverseWheelZoom: reverse } }, wheelZoomDelta,
      setZoom: update => results.push(update(1)),
    });
    for (const [deltaY, ctrlKey] of [[-100, true], [100, true], [0, true], [100, false]]) {
      wheel({ deltaY, ctrlKey, preventDefault() {}, stopPropagation() {} });
    }
    assert.deepEqual(results, reverse ? [.9, 1.1] : [1.1, .9]);
  }
});
