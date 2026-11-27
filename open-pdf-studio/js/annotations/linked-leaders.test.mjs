import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { MiniDOMParser } from '../review/mini-xml-dom.testhulp.mjs';

register('../core/app-test-hooks.mjs', import.meta.url, { data: { extraStubs: ['/js/ui/panels/properties-panel.js'] } });
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
globalThis.DOMParser = MiniDOMParser;
const { leaderAnchor, newLinkedLeader } = await import('./linked-leaders.js');
const { getAnnotationHandles } = await import('./handles.js');
const { applyResize, applyMove } = await import('./transforms.js');
const { annotationsToXfdf, parseXfdfAnnotations } = await import('./xfdf.js');
const { selectTool } = await import('../tools/tools/select-tool.js');
const { state, getActiveDocument } = await import('../core/state.js');

function callout() {
  return { type: 'callout', id: 'parent', page: 1, x: 100, y: 90, width: 100, height: 20,
    arrowX: 0, arrowY: 140, kneeX: 70, kneeY: 100, armOriginX: 100, armOriginY: 100 };
}

test('Shift-klik vertakt op de gekozen knik en de plus voegt een zelfstandige pijl toe', async () => {
  const ann = callout();
  state.documents = [{ id: 'doc', currentPage: 1, annotations: [ann], selectedAnnotations: [ann] }];
  state.activeDocumentIndex = 0;
  const geselecteerd = getActiveDocument().selectedAnnotations[0];
  const click = (handle, shiftKey = false) => selectTool.onPointerDown({
    x: 70, y: 100, state, isPdfAReadOnly: () => false, findHandleAt: () => handle,
    cloneAnnotation: a => JSON.parse(JSON.stringify(a)), redraw() {},
  }, { shiftKey, button: 0 });
  click('callout_knee', true);
  const tak = geselecteerd.leaders[0];
  assert.equal(tak.anchorNode, 'callout_knee');
  assert.deepEqual(leaderAnchor(geselecteerd, tak), { x: 70, y: 100 });
  click('leader_tip_' + tak.id, true);
  click('leader_add');
  assert.equal(geselecteerd.leaders.length, 3);
  assert.equal(geselecteerd.leaders[2].anchorNode, undefined);
  assert.ok(getAnnotationHandles(geselecteerd).some(h => h.type === 'leader_tip_' + tak.id));
  click('leader_delete_' + geselecteerd.leaders[2].id);
  assert.equal(geselecteerd.leaders.length, 2);
  const { undo, redo } = await import('../core/undo-manager.js');
  await undo();
  assert.equal(getActiveDocument().annotations[0].leaders.length, 3);
  await redo();
  assert.equal(getActiveDocument().annotations[0].leaders.length, 2);

});

test('verplaatsen aan het lijf of de middengreep neemt alle pijlen mee, ook op coördinaat nul', () => {
  const orig = callout();
  orig.leaders = [newLinkedLeader(orig, 'tak', 'callout_knee')];
  const tak = orig.leaders[0];
  for (const verplaats of [
    a => applyMove(a, 11, -4, orig),
    a => applyResize(a, 'callout_move', 11, -4, orig),
  ]) {
    const a = structuredClone(orig);
    verplaats(a);
    assert.deepEqual([a.x, a.y, a.arrowX, a.arrowY], [111, 86, 11, 136]);
    assert.deepEqual(leaderAnchor(a, a.leaders[0]), { x: 81, y: 96 });
    assert.deepEqual(a.leaders[0], { ...tak, tipX: tak.tipX + 11, tipY: tak.tipY - 4,
      kneeX: tak.kneeX + 11, kneeY: tak.kneeY - 4 });
    const voor = structuredClone(a);
    applyResize(a, 'leader_tip_tak', -3, 9, voor);
    assert.equal(a.leaders[0].tipX, voor.leaders[0].tipX - 3);
    assert.equal(a.leaders[0].tipY, voor.leaders[0].tipY + 9);
    assert.equal(a.arrowX, 11);
  }
});

test('XFDF bewaart de oorspronkelijke callout en een pijl die op een andere pijl vertakt', () => {
  const a = callout();
  a.leaders = [newLinkedLeader(a, 'een', 'callout_arrow')];
  a.leaders.push(newLinkedLeader(a, 'twee', 'leader_tip_een'));
  const [terug] = parseXfdfAnnotations(annotationsToXfdf([a], { doc: null }));
  assert.equal(terug.type, 'callout');
  assert.deepEqual([terug.arrowX, terug.arrowY, terug.kneeX, terug.kneeY], [0, 140, 70, 100]);
  assert.deepEqual(terug.leaders, a.leaders);
});

test('een geplakte kopie heeft eigen pijlen met dezelfde relatieve posities', async () => {
  const { copyAnnotation, pasteAnnotation } = await import('./clipboard.js');
  const a = callout();
  a.leaders = [newLinkedLeader(a, 'tak', 'callout_knee')];
  state.documents = [{ id: 'doc', pdfDoc: {}, currentPage: 1, scale: 1, selectedAnnotations: [], annotations: [a] }];
  state.activeDocumentIndex = 0;
  copyAnnotation(a, { geschiedenis: false });
  pasteAnnotation({ bijMuis: false });
  const [orig, kopie] = getActiveDocument().annotations;
  assert.notEqual(kopie.id, orig.id);
  const dx = kopie.x - orig.x, dy = kopie.y - orig.y;
  assert.ok(dx > 0 && dy > 0);
  assert.deepEqual([kopie.arrowX, kopie.arrowY], [a.arrowX + dx, a.arrowY + dy]);
  assert.deepEqual([kopie.leaders[0].tipX, kopie.leaders[0].tipY], [a.leaders[0].tipX + dx, a.leaders[0].tipY + dy]);
  kopie.leaders[0].tipX = -999;
  assert.equal(orig.leaders[0].tipX, a.leaders[0].tipX);
});
