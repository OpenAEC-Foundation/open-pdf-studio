import test from 'node:test';
import assert from 'node:assert/strict';
import { destinationView, linkBorder } from './link-view.js';
const viewport = { viewBox: [50, 100, 650, 900], width: 600, height: 800, rotation: 0, scale: 1,
  convertToViewportPoint: (x, y) => [x - 50, 900 - y] };
test('FitR fits and centres the full rectangle relative to the CropBox', () => {
  assert.deepEqual(destinationView({ type: 'FitR', left: 250, bottom: 400, right: 450, top: 600 }, viewport, 824, 624, 1),
    { x: 300, y: 400, center: true, scale: 3 });
});
test('XYZ retains null axes and zero/null zoom; explicit zoom uses the display unit', () => {
  assert.deepEqual(destinationView({ type: 'XYZ', left: null, top: 600, zoom: 0 }, viewport, 824, 624, 2),
    { x: null, y: 300, center: false, scale: 2 });
  assert.equal(destinationView({ type: 'XYZ', left: 250, top: null, zoom: 2 }, viewport, 824, 624, 1, 1.5).scale, 3);
});
test('rotated destinations swap coordinates using the actual viewport', () => {
  const rotated = { ...viewport, rotation: 90, width: 800, height: 600, convertToViewportPoint: (x, y) => [y - 100, x - 50] };
  assert.deepEqual(destinationView({ type: 'FitR', left: 250, bottom: 400, right: 450, top: 600 }, rotated, 824, 624, 1),
    { x: 400, y: 300, center: true, scale: 3 });
  assert.equal(destinationView({ type: 'XYZ', left: null, top: 600, zoom: null }, rotated, 824, 624, 1).x, 500);
});
test('Fit/FitH/FitV and malformed rectangles never produce an invalid zoom', () => {
  assert.equal(destinationView({ type: 'Fit' }, viewport, 624, 824, 2).scale, 1);
  assert.equal(destinationView({ type: 'FitH' }, viewport, 624, 200, 2).scale, 1);
  assert.equal(destinationView({ type: 'FitV' }, viewport, 200, 824, 2).scale, 1);
  assert.equal(destinationView({ type: 'FitR', left: 10, right: 10, top: 20, bottom: 10 }, viewport, 624, 824, 2).scale, 2);
});
test('declared dashed and underline borders follow viewport geometry; invisible stays invisible', () => {
  const ann = { rect: [50, 100, 150, 120], color: new Uint8Array([255, 0, 0]), borderStyle: { width: 2, style: 2, dashArray: [4, 2] } };
  assert.deepEqual(linkBorder(ann, viewport, 0, 780), { path: 'M0,20 L100,20 L100,0 L0,0 Z', width: 2, color: 'rgb(255,0,0)', dash: '4 2' });
  assert.equal(linkBorder({ ...ann, borderStyle: { width: 2, style: 5 } }, viewport, 0, 780).path, 'M0,20 L100,20');
  assert.equal(linkBorder({ ...ann, color: null }, viewport, 0, 780), null);
  assert.equal(linkBorder({ ...ann, borderStyle: { width: 0 } }, viewport, 0, 780), null);
});
