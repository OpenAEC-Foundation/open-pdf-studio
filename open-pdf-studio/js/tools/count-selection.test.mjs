import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state, getAnnotationBounds, getSelectionBounds } = await import('../core/state.ts');
const { selectTool } = await import('./tools/select-tool.js');

const count = (id, x, y, extra = {}) => ({ id, type: 'count', page: 1, x, y, ...extra });

beforeEach(() => {
  state.documents = [{ annotations: [], selectedAnnotations: [], selectedAnnotation: null, currentPage: 1 }];
  state.activeDocumentIndex = 0;
});

function marquee(annotations, from, to, mode = 'window', modifier = 'replace', selected = []) {
  const doc = state.documents[0];
  doc.annotations = annotations;
  doc.selectedAnnotations = selected;
  const pointerState = {
    documents: state.documents, activeDocumentIndex: 0,
    isRubberBanding: true, rubberBandStartX: from.x, rubberBandStartY: from.y,
    rubberBandMode: mode, rubberBandModifier: modifier,
  };
  const calls = [];
  assert.equal(selectTool.onPointerUp({
    x: to.x, y: to.y, state: pointerState, pageNum: 1, scale: 1,
    getAnnotationBounds,
    showProperties: () => calls.push('single'),
    showMultiSelectionProperties: () => calls.push('multiple'),
    hideProperties: () => calls.push('none'),
    redraw: () => {},
  }, {}), true);
  return { ids: doc.selectedAnnotations.map(a => a.id), calls };
}

test('count bounds cover the centered marker without stored width/height', () => {
  for (const markerStyle of ['dot', 'symbol']) {
    assert.deepEqual(getAnnotationBounds(count('c', 0, -10, { markerStyle })),
      { x: -11, y: -21, width: 22, height: 22 });
  }
});

test('window marquee selects count markers together with ordinary annotations', () => {
  const annotations = [count('dot', 30, 30), count('symbol', 60, 60, { markerStyle: 'symbol', symbolId: 'door' }),
    { id: 'box', type: 'box', page: 1, x: 20, y: 20, width: 10, height: 10 }, count('outside', 200, 200)];
  assert.deepEqual(marquee(annotations, { x: 0, y: 0 }, { x: 100, y: 100 }),
    { ids: ['dot', 'symbol', 'box'], calls: ['multiple'] });
  assert.deepEqual(getSelectionBounds(), { x: 19, y: 19, width: 52, height: 52 });
});

test('crossing selects a touched count; window requires its entire marker', () => {
  const annotations = [count('edge', 50, 50)];
  assert.deepEqual(marquee(annotations, { x: 35, y: 35 }, { x: 45, y: 65 }).ids, []);
  assert.deepEqual(marquee(annotations, { x: 45, y: 65 }, { x: 35, y: 35 }, 'crossing').ids, ['edge']);
  assert.deepEqual(marquee(annotations, { x: 0, y: 0 }, { x: 35, y: 35 }, 'crossing').ids, []);
});

test('marquee respects page and visibility filters for counts', () => {
  const annotations = [count('visible', 30, 30), count('hidden', 40, 40, { hidden: true }), count('other-page', 50, 50, { page: 2 })];
  assert.deepEqual(marquee(annotations, { x: 0, y: 0 }, { x: 100, y: 100 }), { ids: ['visible'], calls: ['single'] });
});

test('add and toggle marquee modes work for count markers', () => {
  const first = count('first', 30, 30), second = count('second', 150, 150);
  assert.deepEqual(marquee([first, second], { x: 0, y: 0 }, { x: 70, y: 70 }, 'window', 'add', [second]).ids, ['second', 'first']);
  assert.deepEqual(marquee([first, second], { x: 0, y: 0 }, { x: 70, y: 70 }, 'window', 'toggle', [first, second]).ids, ['second']);
});
