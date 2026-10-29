import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

// Twee dingen van de viewport rond de gesplitste weergave (#715):
//
// 1. Een gesloten ImageBitmap (breedte 0) mag nooit getekend worden: drawImage
//    gooit dan elk frame "the image source is detached". De viewport laat
//    hem los en vraagt een nieuwe aan.
// 2. Een tabwissel tussen een gesplitst en een niet-gesplitst document
//    verandert de maat van de viewer terwijl de viewport nog het vertrekkende
//    document toont. De weergavestand per document (#539) moet daarna nog
//    exact terugkomen, ook de zoom na bladeren (anker los: een maatwijziging
//    maakt de pagina dan opnieuw passend).
//
// De echte pdf-viewport.js draait hier onder node met een nep-canvas en
// vervangen app-modules (zie pdf-viewport-test-hooks.mjs).

const wachtrij = new Map();
let volgendId = 1;
globalThis.requestAnimationFrame = (cb) => { const id = volgendId++; wachtrij.set(id, cb); return id; };
globalThis.cancelAnimationFrame = (id) => { wachtrij.delete(id); };
function draaiFrames() {
  for (let i = 0; i < 5 && wachtrij.size; i++) {
    const nu = [...wachtrij.values()];
    wachtrij.clear();
    for (const cb of nu) cb(performance.now());
  }
}

const container = { clientWidth: 800, clientHeight: 600, querySelector: () => null };
globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
globalThis.document = {
  getElementById: (id) => (id === 'pdf-container' ? container : null),
  querySelector: () => null,
};

let orchestrator = 0;
globalThis.__vpTest = {
  impl: {
    ensureBitmapForCurrentView: () => { orchestrator++; },
    ensureTileForCurrentView: () => {},
  },
};

register('./pdf-viewport-test-hooks.mjs', import.meta.url);
const vp = await import('./pdf-viewport.js');
const { viewport } = vp;
// Dezelfde (vervangen) app-toestand als die van de viewport.
const { state } = await import('../core/state.js');

const getekend = [];
const nepCtx = new Proxy({}, {
  get: (doel, sleutel) => {
    if (sleutel === 'drawImage') return (beeld) => { getekend.push(beeld); if (!(beeld.width > 0)) throw new Error('the image source is detached'); };
    return sleutel in doel ? doel[sleutel] : () => {};
  },
  set: (doel, sleutel, waarde) => { doel[sleutel] = waarde; return true; },
});
const canvas = { width: 0, height: 0, style: {}, getContext: () => nepCtx };
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

function gesloten() {
  return { width: 0, height: 0 };
}

test('een gesloten paginabitmap wordt niet getekend maar losgelaten en opnieuw aangevraagd', async () => {
  container.clientWidth = 800;
  vp.initViewport(canvas, () => {});
  vp.setPage('raster.pdf', 1, 600, 800, 0, 0, 0, 0);
  viewport.pageType = 'raster';
  draaiFrames();
  await wacht(200);

  const dicht = gesloten();
  viewport.currentBitmap = dicht;
  getekend.length = 0;
  orchestrator = 0;
  viewport.dirty = true;
  assert.doesNotThrow(() => draaiFrames());
  assert.ok(!getekend.includes(dicht), 'de gesloten bitmap wordt niet getekend');
  assert.equal(viewport.currentBitmap, null, 'en losgelaten');
  await wacht(200);
  assert.ok(orchestrator > 0, 'er wordt een nieuwe aangevraagd');

  // Een open bitmap wordt gewoon getekend.
  const open = { width: 600, height: 800 };
  viewport.currentBitmap = open;
  getekend.length = 0;
  viewport.dirty = true;
  draaiFrames();
  assert.ok(getekend.includes(open));
});

test('een gesloten tegel wordt niet getekend maar losgelaten', () => {
  vp.setPage('raster.pdf', 1, 600, 800, 0, 0, 0, 0);
  viewport.pageType = 'raster';
  viewport.currentBitmap = { width: 600, height: 800 };
  const dicht = gesloten();
  viewport.currentTile = dicht;
  viewport.currentTileMeta = { regionXpt: 0, regionYpt: 0, regionWpt: 100, regionHpt: 100 };
  getekend.length = 0;
  viewport.dirty = true;
  assert.doesNotThrow(() => draaiFrames());
  assert.ok(!getekend.includes(dicht));
  assert.equal(viewport.currentTile, null);
  assert.equal(viewport.currentTileMeta, null);
});

// Tabwissel zoals tabs.js + split-view.js: de lay-out (en dus de maat van de
// viewer) wisselt vóór het renderen van het aankomende document.
function wissel(naar, breedte) {
  vp.bewaarStandVoorLayoutwissel(naar);
  container.clientWidth = breedte;
  vp.pasViewportMaatAan();
  vp.setPage(naar, 1, 600, 800, 0, 0, 0, 0);
}

test('tabwissel tussen een gesplitst en een niet-gesplitst document houdt de exacte stand (#539)', () => {
  state.documents = [{ filePath: 'gesplitst.pdf' }, { filePath: 'enkel.pdf' }];
  // Gesplitst document: de viewer is half zo breed.
  container.clientWidth = 400;
  vp.initViewport(canvas, () => {});
  vp.setPage('gesplitst.pdf', 1, 600, 800, 0, 0, 0, 0);
  vp.setZoomAtPoint(100, 100, 3);
  // Bladeren houdt de zoom maar laat het anker los.
  vp.setPage('gesplitst.pdf', 2, 600, 800, 0, 0, 0, 0);
  viewport.dirty = true;
  draaiFrames();
  const voor = { zoom: viewport.zoom, x: viewport.offsetX, y: viewport.offsetY, pagina: viewport.pageNum };
  assert.equal(voor.zoom, 3);

  // Naar het niet-gesplitste document (viewer op volle breedte) en terug.
  wissel('enkel.pdf', 800);
  draaiFrames();
  vp.bewaarStandVoorLayoutwissel('gesplitst.pdf');
  container.clientWidth = 400;
  vp.pasViewportMaatAan();
  vp.setPage('gesplitst.pdf', 2, 600, 800, 0, 0, 0, 0);

  assert.deepEqual(
    { zoom: viewport.zoom, x: viewport.offsetX, y: viewport.offsetY, pagina: viewport.pageNum },
    voor,
    'zoom en verschuiving exact zoals verlaten',
  );
});

test('zonder lay-outwissel bewaart setPage de stand zelf, zoals altijd', () => {
  state.documents = [{ filePath: 'a.pdf' }, { filePath: 'b.pdf' }];
  container.clientWidth = 800;
  vp.initViewport(canvas, () => {});
  vp.setPage('a.pdf', 1, 600, 800, 0, 0, 0, 0);
  vp.setZoomAtPoint(200, 200, 2);
  const voor = { zoom: viewport.zoom, x: viewport.offsetX, y: viewport.offsetY };
  // Zelfde document als de viewport toont: niets te bewaren.
  assert.equal(vp.bewaarStandVoorLayoutwissel('a.pdf'), false);
  vp.setPage('b.pdf', 1, 600, 800, 0, 0, 0, 0);
  vp.setPage('a.pdf', 1, 600, 800, 0, 0, 0, 0);
  assert.deepEqual({ zoom: viewport.zoom, x: viewport.offsetX, y: viewport.offsetY }, voor);
});
