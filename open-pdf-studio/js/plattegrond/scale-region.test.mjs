import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../core/state.ts');
const { DEFAULT_PREFERENCES } = await import('../core/constants.ts');
const { runAppEvent, plattegrondInApp } = await import('../mcp-bridge.js');
const meting = await import('../annotations/measurement.js');
const { dimensionMeasure } = await import('../pdf/saver/dimension-measure.js');

test('MCP en interactieve maatketting blijven op de schaal van hun meetpunten (#1046)', async () => {
  state.preferences = { ...DEFAULT_PREFERENCES };
  state.documents = [{ id: 'scale-region-1046', pdfDoc: { numPages: 1 }, currentPage: 1, scale: 1,
    viewMode: 'single', annotations: [], selectedAnnotations: [], selectedAnnotation: null,
    undoStack: [], redoStack: [], measureScale: { pixelsPerUnit: 72 / 2540, unit: 'mm' } }];
  state.activeDocumentIndex = 0;
  const doc = state.documents[0];
  doc.annotations.push({ id: 'region', type: 'scaleRegion', page: 1, x: 50, y: 50, width: 300, height: 100,
    scaleString: '1:10', units: 'mm' });
  const call = async (name, args) => { const r = await runAppEvent(name, args); assert.equal(r.ok, true, JSON.stringify(r)); return r; };
  const wall = await call('mcp:floorplan', { action: 'wall', start: { x: 100, y: 100 }, end: { x: 300, y: 100 }, thicknessMm: 10 });
  await call('mcp:floorplan', { action: 'wall', start: { x: 600, y: 600 }, end: { x: 800, y: 600 }, thicknessMm: 10 });
  const result = await call('mcp:floorplan', { action: 'dimensions', wallIds: wall.wallIds });
  const ann = doc.annotations.find(a => a.id === result.dimensions[0].id);
  assert.equal(result.dimensions[0].lengthMm, 706);
  assert.equal(Math.round(ann.measureValue), 706);
  assert.ok(ann.startY > 150, 'maatlijn ligt buiten de schaalregio');
  assert.equal(Math.round(meting.calculateDistance(100, 100, 300, 100, 1).value), 706);
  assert.equal(Math.round(meting.calculateDistance(100, 300, 300, 300, 1).value), 7056);
  assert.ok(Math.abs(dimensionMeasure(ann, doc).scale - 254 / 72) < 1e-9);
  meting.recalculateAllMeasurements();
  assert.equal(Math.round(ann.measureValue), 706);
  const edit = await plattegrondInApp({ action: 'dimensions', chainOf: ann.id,
    addPoints: [{ x: 200, y: ann.leaderStartY }] });
  assert.equal(edit.ok, true, JSON.stringify(edit));
  assert.deepEqual(edit.dimensions.filter(d => d.role === 'chain').map(d => d.lengthMm), [353, 353]);
  for (const d of edit.dimensions) {
    const a = doc.annotations.find(a => a.id === d.id);
    assert.equal(Math.round(a.measureValue), d.lengthMm);
  }
  const refresh = await plattegrondInApp({ action: 'dimensions', refresh: true });
  assert.equal(refresh.ok, true);
  for (const d of edit.dimensions) {
    const a = doc.annotations.find(a => a.id === d.id);
    assert.equal(Math.round(a.measureValue), 353);
    assert.ok(Math.abs(a.startY - (100 + 505 * 72 / 254)) < 1e-9, 'offset blijft op detailschaal');
  }
});
