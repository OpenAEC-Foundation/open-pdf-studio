import test from 'node:test';
import assert from 'node:assert/strict';
import { firstVisiblePage, currentViewSize, currentViewSource, rotateViewCanvas } from './print-current-view.js';
import { berekenPlaatsing, renderDeel, ongedraaidDeel } from './print-plaatsing.js';

const view = { rect: { x: 100, y: 200, width: 120, height: 80 }, rotation: 0 };
test('clips background and selects the first visible page, not the largest overlap', () => {
  const viewport = { x: 20, y: 40, width: 300, height: 200 };
  assert.deepEqual(firstVisiblePage(viewport, [
    { pageNum: 3, rect: { x: 30, y: 100, width: 400, height: 300 } },
    { pageNum: 2, rect: { x: 30, y: -300, width: 400, height: 360 } },
    { pageNum: 1, rect: { x: 30, y: -700, width: 400, height: 350 } },
  ]), { pageNum: 2, rect: { x: 30, y: 40, width: 290, height: 20 } });
});
test('background-only or edge-touching views offer no printable area', () => {
  assert.equal(firstVisiblePage({ x: 100, y: 0, width: 100, height: 50 }, [{ pageNum: 1, rect: { x: 0, y: 0, width: 100, height: 50 } }]), null);
});
for (const rotation of [0, 90, 180, 270]) {
  test(`fit preview and printer map the same cropped source at view rotation ${rotation}`, () => {
    const v = { ...view, rotation };
    for (const orientatie of ['portrait', 'landscape']) {
      const p = berekenPlaatsing({ papier: { breedteMm: 210, hoogteMm: 297 }, orientatie, schaling: 'fit', centreren: true, pagina: currentViewSize(v) });
      assert.equal(p.afgesneden, false);
      for (const scale of [0.5, 2, 4]) {
        const d = renderDeel(p, scale);
        const source = currentViewSource(v, scale, ongedraaidDeel(p, scale, d.px));
        assert.deepEqual(source, { x: 100 * scale, y: 200 * scale, breedte: 120 * scale, hoogte: 80 * scale });
      }
    }
  });
}
test('a subregion of a rotated crop maps back with its crop offset', () => {
  assert.deepEqual(currentViewSource({ ...view, rotation: 90 }, 2, { x: 20, y: 40, breedte: 50, hoogte: 60 }), { x: 240, y: 490, breedte: 60, hoogte: 50 });
});
test('output canvas turns the rendered page and markup together without stretching', () => {
  const canvas = { width: 240, height: 160 };
  let matrix, drawn;
  const out = { getContext: () => ({ setTransform: (...m) => { matrix = m; }, drawImage: (...args) => { drawn = args; } }) };
  assert.equal(rotateViewCanvas(canvas, 90, () => out), out);
  assert.deepEqual([out.width, out.height], [160, 240]);
  assert.deepEqual(matrix, [0, 1, -1, 0, 160, 0]);
  assert.deepEqual(drawn, [canvas, 0, 0]);
  assert.equal(rotateViewCanvas(canvas, 0), canvas);
});
