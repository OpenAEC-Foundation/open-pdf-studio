import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
register('../core/app-test-hooks.mjs', import.meta.url);
register('../pdf/saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { getTransformAnchor, setTransformAnchor, resetTransformAnchor,
  snapshotTransformAnchor, restoreTransformAnchor, resizeAboutTransformAnchor,
  rotateAboutTransformAnchor, ANCHOR_HANDLE } = await import('./transform-anchor.js');
const { applyResize, applyMove, applyRotateGeneric } = await import('./transforms.js');
const { getAnnotationHandles, findHandleAt } = await import('./handles.js');
const { rectNaBijsnijden } = await import('./crop-geometrie.js');
const { state } = await import('../core/state.ts');
const { selectTool } = await import('../tools/tools/select-tool.js');
const shape = (extra = {}) => ({ id: 'a', page: 1, type: 'image', x: 100, y: 200, width: 200, height: 100, rotation: 0, ...extra });
const clone = a => JSON.parse(JSON.stringify(a));
function close(a, b) { assert.ok(Math.abs(a - b) < 1e-7, `${a} ≠ ${b}`); }
function point(a, b) { close(a.x, b.x); close(a.y, b.y); }
function resize(a, h, dx, dy, shift = false) {
  return resizeAboutTransformAnchor(a, clone(a), h, dx, dy, shift, false, {}, applyResize, applyMove);
}
function rotate(a, start, end, step = 0) {
  return rotateAboutTransformAnchor(a, clone(a), start, end, step, applyRotateGeneric);
}
function open(a) {
  state.documents = [{ id: 'anchor-test', pdfDoc: { numPages: 1 }, currentPage: 1,
    scale: 1, viewMode: 'single', annotations: [a], selectedAnnotations: [a],
    undoStack: [], redoStack: [], textEdits: [], watermarks: [], bookmarks: [], pageRotations: {} }];
  state.activeDocumentIndex = 0;
  return state.documents[0].annotations[0];
}

test('default center handle is visible and hittable at multiple zooms and rotations', () => {
  for (const type of ['image', 'box', 'circle', 'polygon', 'cloud']) {
    const a = shape({ type, rotation: 40 });
    for (const scale of [0.25, 1, 4, 64]) {
      const h = getAnnotationHandles(a, scale).find(h => h.type === ANCHOR_HANDLE);
      assert.ok(h, type);
      assert.equal(findHandleAt(200, 250, a, scale), ANCHOR_HANDLE);
    }
  }
});

test('placing an external anchor leaves annotation and serialized fields unchanged', () => {
  const a = shape(), before = JSON.stringify(a);
  setTransformAnchor(a, { x: -50, y: 350 });
  point(getTransformAnchor(a), { x: -50, y: 350 });
  assert.equal(JSON.stringify(a), before);
  assert.equal(getTransformAnchor(clone(a)).custom, false, 'copy has no session anchor');
  assert.equal(findHandleAt(-50, 350, a), ANCHOR_HANDLE);
});

test('unmoved default center does not change opposite-corner scaling', () => {
  const a = shape();
  assert.equal(resize(a, 'br', 40, 20), false);
  applyResize(a, 'br', 40, 20, clone(a));
  point(a, { x: 100, y: 200 });
  close(a.width, 240); close(a.height, 120);
});

test('90 degree rotation orbits an external anchor and keeps the reference point fixed', () => {
  const a = shape(), p = { x: 50, y: 250 };
  setTransformAnchor(a, p);
  rotate(a, { x: 200, y: 250 }, { x: 50, y: 400 });
  point(getTransformAnchor(a), p);
  close(a.rotation, 90);
  point({ x: a.x + a.width / 2, y: a.y + a.height / 2 }, { x: 50, y: 400 });
});

test('rotation begins at the pointer angle without jumping, including an already rotated shape', () => {
  const a = shape({ rotation: 32 }), p = { x: 140, y: 215 };
  setTransformAnchor(a, p);
  const before = clone(a), start = { x: 170, y: 180 };
  rotate(a, start, start);
  point(a, before); close(a.rotation, 32); point(getTransformAnchor(a), p);
});

test('snapped rotation still preserves the anchor', () => {
  const a = shape(); setTransformAnchor(a, { x: 100, y: 200 });
  rotate(a, { x: 200, y: 200 }, { x: 200, y: 234 }, 15);
  close(a.rotation, 15); point(getTransformAnchor(a), { x: 100, y: 200 });
});

test('every resize handle keeps internal and external anchors fixed on rotated shapes', () => {
  for (const rotation of [0, 30, 90, 270]) for (const type of ['image', 'box', 'circle', 'cloud']) {
    for (const h of ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r']) {
      for (const p of [{ x: 150, y: 225 }, { x: -20, y: 400 }]) {
        const a = shape({ rotation, type });
        setTransformAnchor(a, p);
        assert.equal(resize(a, h, 23, -17), true);
        point(getTransformAnchor(a), p);
        assert.ok(a.width > 0 && a.height > 0);
      }
    }
  }
});

test('dragged corner follows pointer for free resize about an internal pivot', () => {
  const a = shape(); setTransformAnchor(a, { x: 150, y: 225 });
  resize(a, 'br', 60, 30);
  point({ x: a.x + a.width, y: a.y + a.height }, { x: 360, y: 330 });
  point(getTransformAnchor(a), { x: 150, y: 225 });
});

test('aspect ratio and minimum size hold while anchored, even beyond the pivot', () => {
  for (const lockAspectRatio of [false, true]) {
    const a = shape({ lockAspectRatio }); setTransformAnchor(a, { x: 150, y: 225 });
    resize(a, 'br', -1000, -500, true);
    point(getTransformAnchor(a), { x: 150, y: 225 });
    close(a.width / a.height, 2); assert.ok(a.width > 0);
  }
});

test('a pivot exactly on the dragged edge never divides by zero', () => {
  const a = shape(); setTransformAnchor(a, { x: 300, y: 250 });
  resize(a, 'r', 30, 0);
  close(a.width, 200); point(getTransformAnchor(a), { x: 300, y: 250 });
});

test('translation takes the anchor along and cropping preserves its canvas position', () => {
  const a = shape({ rotation: 30 }); setTransformAnchor(a, { x: 150, y: 220 });
  applyMove(a, 60, -10);
  point(getTransformAnchor(a), { x: 210, y: 210 });
  const old = clone(a);
  Object.assign(a, rectNaBijsnijden(old, { x: old.x + 40, y: old.y, w: 160, h: 100 }, 30));
  a.cropLeft = 0.2;
  point(getTransformAnchor(a), { x: 210, y: 210 });
});

test('reset and cancelled pivot drag restore default or previous custom anchor', () => {
  const a = shape(), before = snapshotTransformAnchor(a);
  setTransformAnchor(a, { x: 0, y: 0 }); restoreTransformAnchor(a, before);
  assert.equal(getTransformAnchor(a).custom, false);
  setTransformAnchor(a, { x: 123, y: 234 });
  const custom = snapshotTransformAnchor(a);
  setTransformAnchor(a, { x: -1, y: -2 }); restoreTransformAnchor(a, custom);
  point(getTransformAnchor(a), { x: 123, y: 234 });
  resetTransformAnchor(a); assert.equal(getTransformAnchor(a).custom, false);
});

test('locked shapes and invalid geometry do not expose editable pivots', () => {
  const a = shape({ locked: true });
  assert.ok(!getAnnotationHandles(a).some(h => h.type === ANCHOR_HANDLE));
  setTransformAnchor(a, { x: 0, y: 0 });
  assert.equal(getTransformAnchor(a).custom, false);
  assert.equal(getTransformAnchor(shape({ width: NaN })), null);
});

test('real select tool starts anchor drag and double-click resets without changing geometry', () => {
  const a = open(shape());
  setTransformAnchor(a, { x: 150, y: 225 });
  const ctx = { x: 150, y: 225, state, isPdfAReadOnly: () => false,
    findHandleAt: (x, y, a) => findHandleAt(x, y, a), cloneAnnotation: clone, redraw() {} };
  selectTool.onPointerDown(ctx, { detail: 1 });
  assert.equal(state.activeHandle, ANCHOR_HANDLE);
  assert.equal(state.isResizing, true);
  assert.ok(state._transformAnchorBefore);
  state.isResizing = false;
  selectTool.onPointerDown(ctx, { detail: 2 });
  assert.equal(getTransformAnchor(a).custom, false);
  assert.equal(state.isResizing, false);
  point(a, { x: 100, y: 200 });
});
