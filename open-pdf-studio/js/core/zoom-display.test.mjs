import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scaleToPercent, percentToScale, cssPxPerPtAt100, normalizeZoomDpi, setZoomDpi, getZoomDpi,
  DEFAULT_ZOOM_DPI, nextZoomPercent, nextScaleStep,
} from './zoom-display.js';

test('standaard 110 dpi: 100% is 110/72 CSS px per pt', () => {
  assert.equal(DEFAULT_ZOOM_DPI, 110);
  assert.equal(cssPxPerPtAt100(), 110 / 72);
  assert.equal(percentToScale(100), 110 / 72);
  assert.equal(scaleToPercent(110 / 72), 100);
});

test('de oude schaal 1,5 toont 98% bij 110 dpi', () => {
  assert.equal(scaleToPercent(1.5), 98);
});

test('een hogere dpi maakt 100% groter (grotere pagina op hetzelfde scherm)', () => {
  assert.ok(Math.abs(percentToScale(100, 120) - 120 / 72) < 1e-12);
  assert.equal(scaleToPercent(120 / 72, 120), 100);
  assert.ok(percentToScale(100, 120) > percentToScale(100, 110));
});

test('dpi wordt begrensd en rommel valt terug op 96', () => {
  assert.equal(normalizeZoomDpi(10), 50);
  assert.equal(normalizeZoomDpi(9999), 300);
  assert.equal(normalizeZoomDpi('abc'), DEFAULT_ZOOM_DPI);
  assert.equal(normalizeZoomDpi(undefined), DEFAULT_ZOOM_DPI);
});

test('setZoomDpi stuurt de standaardwaarde van de omrekening', () => {
  setZoomDpi(96);
  assert.equal(getZoomDpi(), 96);
  assert.equal(scaleToPercent(96 / 72), 100);
  setZoomDpi(110);
});

test('heen en terug blijft op hetzelfde procent', () => {
  for (const p of [10, 25, 50, 75, 100, 125, 150, 200, 300, 500]) {
    assert.equal(scaleToPercent(percentToScale(p)), p);
  }
});

test('zoomknoppen springen van ronde stap naar ronde stap', () => {
  assert.equal(nextZoomPercent(100, +1), 125);
  assert.equal(nextZoomPercent(125, +1), 150);
  assert.equal(nextZoomPercent(150, +1), 200);
  assert.equal(nextZoomPercent(200, -1), 150);
  assert.equal(nextZoomPercent(100, -1), 75);
});

test('tussen twee stappen gaat het naar de volgende resp. vorige ronde stap', () => {
  assert.equal(nextZoomPercent(113, +1), 125);
  assert.equal(nextZoomPercent(113, -1), 100);
  assert.equal(nextZoomPercent(188, +1), 200);
  assert.equal(nextZoomPercent(188, -1), 150);
});

test('aan de uiteinden blijft het staan', () => {
  assert.equal(nextZoomPercent(6400, +1), 6400);
  assert.equal(nextZoomPercent(10, -1), 10);
});

test('nextScaleStep geeft een schaal die als ronde procenten wordt getoond', () => {
  for (const dpi of [96, 110]) {
    setZoomDpi(dpi);
    let scale = percentToScale(100);
    const seen = [];
    for (let i = 0; i < 4; i++) { scale = nextScaleStep(scale, +1); seen.push(scaleToPercent(scale)); }
    assert.deepEqual(seen, [125, 150, 200, 300]);
  }
  setZoomDpi(110);
});
