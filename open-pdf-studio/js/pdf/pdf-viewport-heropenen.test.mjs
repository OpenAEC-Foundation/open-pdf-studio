import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

// Het laatste tabblad sluiten maakt de bitmapcaches leeg en sluit daarbij
// elke ImageBitmap. De viewport hield het pad en de getoonde bitmap van dat
// document vast; wie daarna hetzelfde bestand opnieuw opende, kreeg van
// setPage geen "nieuw document" (zelfde pad), dus bleef de gesloten bitmap
// staan en gaf elk frame "drawImage: the image source is detached" tot er een
// nieuwe binnen was. Sluiten laat de viewport het document nu vergeten.
//
// De echte pdf-viewport.js draait hier onder node met een nep-canvas en
// vervangen app-modules (zie pdf-viewport-test-hooks.mjs).

globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
const container = { clientWidth: 800, clientHeight: 600, querySelector: () => null };
globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
globalThis.document = {
  getElementById: (id) => (id === 'pdf-container' ? container : null),
  querySelector: () => null,
};

let cacheVragen = 0;
globalThis.__vpTest = {
  impl: {
    computeZoomBucket: (s) => s,
    getBestAvailableBitmap: () => { cacheVragen++; return null; },
  },
};

register('./pdf-viewport-test-hooks.mjs', import.meta.url);
const vp = await import('./pdf-viewport.js');
const { viewport } = vp;

const nepCtx = new Proxy({}, { get: (doel, k) => (k in doel ? doel[k] : () => {}), set: (d, k, w) => { d[k] = w; return true; } });
const canvas = { width: 0, height: 0, style: {}, getContext: () => nepCtx };

function toonMetBitmap(pad) {
  vp.initViewport(canvas, () => {});
  vp.setPage(pad, 1, 600, 800, 0, 0, 0, 0);
  const bitmap = { width: 600, height: 800 };
  viewport.currentBitmap = bitmap;
  viewport.currentTile = { width: 10, height: 10 };
  viewport.currentTileMeta = { regionXpt: 0 };
  return bitmap;
}

test('een leeggemaakte weergave houdt geen gesloten bitmap vast, maar wel het pad', () => {
  const oud = toonMetBitmap('b.pdf');
  vp.laatBitmapsLos();
  assert.equal(viewport.currentBitmap, null);
  assert.equal(viewport.currentTile, null);
  assert.equal(viewport.currentTileMeta, null);
  assert.equal(viewport.filePath, 'b.pdf', 'een tabwissel via een leeg tabblad houdt zijn zoom');

  vp.setPage('b.pdf', 1, 600, 800, 0, 0, 0, 0);
  assert.notEqual(viewport.currentBitmap, oud);
});

test('sluiten en hetzelfde pad heropenen toont niet meer de bitmap van het gesloten document', () => {
  const oud = toonMetBitmap('a.pdf');

  vp.vergeetGetoondDocument();
  assert.equal(viewport.active, false);
  assert.equal(viewport.filePath, null);
  assert.equal(viewport.currentBitmap, null);
  assert.equal(viewport.currentTile, null);
  assert.equal(viewport.currentTileMeta, null);

  cacheVragen = 0;
  vp.setPage('a.pdf', 1, 600, 800, 0, 0, 0, 0);
  assert.notEqual(viewport.currentBitmap, oud);
  assert.equal(cacheVragen, 1, 'heropenen telt als nieuw document en zoekt een eigen bitmap');
});
