import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

// Inpassen op een verborgen viewer (GitHub #675). Na het sluiten van het
// laatste tabblad is #pdf-container display:none: clientWidth/-Height zijn 0
// en _resizeCanvas() maakt het canvas 0×0. De fit die daarop volgde klemde de
// beschikbare ruimte op 1 px en zette de zoom op 1/paginahoogte (0,0011878
// voor A4); _render() nam die over in doc.scale en het volgende document
// bouwde zijn lagen daarmee op. Nu slaat de fit over zolang het canvas geen
// maat heeft en blijft de vorige zoom staan.
//
// De echte pdf-viewport.js draait hier onder node met een nep-canvas en
// vervangen app-modules (zie pdf-viewport-test-hooks.mjs).

globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

const container = { clientWidth: 800, clientHeight: 600, querySelector: () => null };
const luisteraars = new Map();
globalThis.window = {
  devicePixelRatio: 1,
  addEventListener(naam, fn) { luisteraars.set(naam, fn); },
  removeEventListener(naam) { luisteraars.delete(naam); },
};
globalThis.document = {
  getElementById: (id) => (id === 'pdf-container' ? container : null),
  querySelector: () => null,
};
globalThis.__vpTest = { impl: {} };

register('./pdf-viewport-test-hooks.mjs', import.meta.url);
const vp = await import('./pdf-viewport.js');
const { viewport } = vp;

const nepCtx = new Proxy({}, {
  get: (doel, sleutel) => (sleutel in doel ? doel[sleutel] : () => {}),
  set: (doel, sleutel, waarde) => { doel[sleutel] = waarde; return true; },
});
const canvas = { width: 0, height: 0, style: {}, getContext: () => nepCtx };

const A4 = { w: 595.28, h: 841.89 };
const FIT_A4 = Math.min(800 / A4.w, 600 / A4.h);

function containerMaat(w, h) {
  container.clientWidth = w;
  container.clientHeight = h;
  luisteraars.get('resize')?.();
}

function opzet() {
  containerMaat(800, 600);
  vp.initViewport(canvas, () => {});
  vp.setPage(`doc-${Math.random()}.pdf`, 1, A4.w, A4.h, 0, 0, 0, 0);
}

test('verbergen van de viewer houdt de zoom van de pagina vast', () => {
  opzet();
  assert.equal(viewport.zoom, FIT_A4, 'eerst gewoon ingepast');
  const offset = [viewport.offsetX, viewport.offsetY];

  containerMaat(0, 0);
  assert.equal(canvas.width, 0, 'het canvas is 0×0 zoals in de app');
  assert.equal(canvas.height, 0);
  assert.notEqual(viewport.zoom, 1 / A4.h, 'geen ontaarde zoom van 1/paginahoogte');
  assert.equal(viewport.zoom, FIT_A4, 'de vorige zoom blijft staan');
  assert.deepEqual([viewport.offsetX, viewport.offsetY], offset);
});

test('inpassen zonder canvasmaat doet niets, in elke modus', () => {
  opzet();
  containerMaat(0, 0);
  for (const modus of ['page', 'width', 'height']) {
    vp.fitToViewport(modus);
    assert.equal(viewport.zoom, FIT_A4, `fitToViewport('${modus}') houdt de zoom vast`);
  }
  // Eén as zonder maat is net zo ontaard.
  containerMaat(800, 0);
  vp.fitToViewport('width');
  assert.equal(viewport.zoom, FIT_A4);
});

test('een nieuw document in een verborgen viewer krijgt geen ontaarde zoom', () => {
  opzet();
  containerMaat(0, 0);
  vp.setPage('nieuw.pdf', 1, A4.w, A4.h, 0, 0, 0, 0);
  assert.ok(viewport.zoom > 0.1, `zoom ${viewport.zoom} is geen ontaarde fit`);
});

test('weer zichtbaar: de viewer past opnieuw in', () => {
  opzet();
  containerMaat(0, 0);
  containerMaat(1000, 500);
  assert.equal(viewport.zoom, Math.min(1000 / A4.w, 500 / A4.h));
  vp.setPage('ander.pdf', 1, A4.h, A4.w, 0, 0, 0, 0);
  assert.equal(viewport.zoom, Math.min(1000 / A4.h, 500 / A4.w), 'nieuw document wordt ingepast');
});

test('een overgeslagen fit volgt zodra de viewer weer een maat heeft, ook na eigen zoom', () => {
  opzet();
  // De gebruiker zoomde zelf in op het vorige document: verankerd.
  vp.setZoomAtPoint(400, 300, 2);
  assert.equal(viewport.zoom, 2);
  containerMaat(0, 0);
  assert.equal(viewport.zoom, 2, 'verbergen laat de eigen zoom staan');
  vp.setPage('volgend.pdf', 1, A4.w, A4.h, 0, 0, 0, 0);
  assert.equal(viewport.zoom, 2, 'verborgen: nog niets ingepast');
  containerMaat(800, 600);
  assert.equal(viewport.zoom, FIT_A4, 'het nieuwe document wordt alsnog ingepast');
  // Daarna gewoon weer de eigen zoom bij een volgende maatwissel.
  vp.setZoomAtPoint(400, 300, 3);
  containerMaat(900, 600);
  assert.equal(viewport.zoom, 3);
});

test('computeFitZoom zelf blijft zuivere rekenkunde', () => {
  assert.equal(vp.computeFitZoom('page', 100, 200, 400, 400), 2);
  assert.equal(vp.computeFitZoom('width', 100, 200, 400, 100), 4);
  assert.equal(vp.computeFitZoom('height', 100, 200, 400, 100), 0.5);
});

test('de openingszoom past de breedte in en volgt de canvasmaat', () => {
  opzet();
  vp.setPage('breed.pdf', 1, 400, 1000, 0, 0, 0, 0, 'width');
  assert.equal(viewport.zoom, 2);
  assert.equal(viewport.offsetY, 0);
  containerMaat(1000, 500);
  assert.equal(viewport.zoom, 2.5);
});

test('vast openingspercentage gebruikt de schermresolutie, ook na verbergen', async () => {
  const { percentToScale } = await import('../core/zoom-display.js');
  opzet();
  containerMaat(0, 0);
  vp.setPage('percentage.pdf', 1, 400, 1000, 0, 0, 0, 0, 150);
  containerMaat(1000, 500);
  assert.equal(viewport.zoom, percentToScale(150));
  assert.equal(viewport.offsetY, 0);
  containerMaat(900, 450);
  assert.equal(viewport.zoom, percentToScale(150));
});

test('een expliciete leeszoom gaat voor de wachtende openingszoom', () => {
  opzet();
  containerMaat(0, 0);
  vp.setPage('lezen.pdf', 1, 400, 1000, 0, 0, 0, 0, 'width');
  const savedZoom = viewport.zoom;
  vp.setZoomAtPoint(0, 0, savedZoom);
  containerMaat(1000, 500);
  assert.equal(viewport.zoom, savedZoom);
});
