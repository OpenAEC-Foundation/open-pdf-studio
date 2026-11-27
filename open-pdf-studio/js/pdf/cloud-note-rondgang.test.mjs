import assert from 'node:assert/strict';
import test from 'node:test';
import { laad, leegBlad, opslaan, state } from './rondgang.testhulp.mjs';

const { shapeTool } = await import('../tools/tools/shape-tool.js');
const { cloudPolylineTool } = await import('../tools/tools/polyline-tool.js');
const { createAnnotationFromTool } = await import('../tools/annotation-creators.js');
const { createAnnotation } = await import('../annotations/factory.js');
const { applyMove } = await import('../annotations/transforms.js');

for (const type of ['cloud', 'cloudPolyline']) {
  test(type + ' places a linked note and retains its attachment through two saves', async () => {
    state.documents = [{ id: type, annotations: [], currentPage: 1, pageRotations: {} }];
    state.activeDocumentIndex = 0;
    state.currentTool = type;
    state.preferences.cloudAttachNote = true;
    state.preferences.keepToolActive = true;
    let preview, edited;
    const tool = type === 'cloud' ? shapeTool : cloudPolylineTool;
    const ctx = {
      state, scale: 1, pageNum: 1, snap: () => ({}), snapToGrid: v => v,
      recordAdd() {}, redraw() {}, showProperties() {}, drawShapePreview(...args) { preview = args; },
      startTextEditing(a) { edited = a; }, createAnnotation, createAnnotationFromTool,
      canvasCtx: new Proxy({}, { get: () => () => {} }), buildCloudPolylinePath() {},
    };
    const click = (x, y, button = 0) => {
      Object.assign(ctx, { x, y });
      Object.assign(state, { startX: x, startY: y });
      tool.onPointerDown(ctx, { button });
    };
    click(70, 70);
    if (type === 'cloud') {
      Object.assign(ctx, { x: 150, y: 170 });
      tool.onPointerUp(ctx, { button: 0 });
    } else {
      click(150, 70); click(130, 170); click(130, 170, 2);
      assert.equal(state._suppressNextContextmenu, true);
    }
    Object.assign(ctx, { x: 330, y: 60 });
    tool.onPointerMove(ctx, {});
    assert.equal(preview.at(-1), 'callout');
    click(ctx.x, ctx.y);
    assert.equal(edited.type, 'callout');
    assert.equal(edited.cloudVertex, 1);
    edited.text = 'Review detail';
    let bytes = await opslaan(await leegBlad(), state.documents[0].annotations);
    let models = await laad(bytes);
    let cloud = models.find(a => a.type === type), note = models.find(a => a.type === 'callout');
    assert.equal(note.inReplyTo, cloud.id);
    assert.equal(note.cloudVertex, 1);
    assert.equal(note.text, 'Review detail');
    assert.deepEqual([note.arrowX, note.arrowY], [150, 70]);
    const x = note.x;
    applyMove(note, 40, 0);
    assert.deepEqual([note.arrowX, note.arrowY], [150, 70]);
    applyMove(cloud, -20, 30);
    bytes = await opslaan(bytes, models);
    models = await laad(bytes);
    cloud = models.find(a => a.type === type);
    note = models.find(a => a.type === 'callout');
    assert.equal(note.inReplyTo, cloud.id);
    assert.equal(note.x, x + 40);
    assert.deepEqual([note.arrowX, note.arrowY], [130, 100]);
  });
}

test('plain clouds stay standalone, and Escape cancels only the pending note', () => {
  state.documents = [{ id: 'cancel', annotations: [], currentPage: 1, pageRotations: {} }];
  state.activeDocumentIndex = 0;
  state.currentTool = 'cloud';
  const ctx = {
    state, pageNum: 1, scale: 1, snap: () => ({}), snapToGrid: v => v,
    redraw() {}, recordAdd() {}, createAnnotationFromTool,
  };
  for (const enabled of [false, true]) {
    state.preferences.cloudAttachNote = enabled;
    Object.assign(state, { startX: 50, startY: 60 });
    Object.assign(ctx, { x: 50, y: 60 });
    shapeTool.onPointerDown(ctx, { button: 0 });
    Object.assign(ctx, { x: 100, y: 120 });
    shapeTool.onPointerUp(ctx, { button: 0 });
    if (enabled) shapeTool.onEscape(ctx);
    // The next left press starts a fresh cloud drag.
    shapeTool.onPointerDown(ctx, { button: 0 });
    assert.equal(state.isDrawing, true);
    state.isDrawing = false;
  }
  assert.deepEqual(state.documents[0].annotations.map(a => a.type), ['cloud', 'cloud']);
});
