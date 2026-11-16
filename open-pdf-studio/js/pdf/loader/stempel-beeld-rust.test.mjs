// Stempelbeelden uit de PDFium-worker: het paginadeel dat gevraagd wordt, het
// antwoord, en de terugval naar PDF.js.

import assert from 'node:assert/strict';
import test from 'node:test';
import { stempelUitsnede, decodeGebied, createStempelRender } from './stempel-beeld-rust.js';

test('één stempel: de uitsnede is de stempel met een pixel eromheen', () => {
  assert.deepEqual(stempelUitsnede([[100.4, 200.6, 300.2, 260.9]], 2000, 1400),
    { x: 99, y: 199, width: 203, height: 63 });
});

test('hoeken in willekeurige volgorde, en meer stempels geven het omhullende vlak', () => {
  assert.deepEqual(stempelUitsnede([[300, 260, 100, 200]], 2000, 1400),
    { x: 99, y: 199, width: 202, height: 62 });
  assert.deepEqual(stempelUitsnede([[10, 10, 50, 40], [900, 700, 1000, 760]], 2000, 1400),
    { x: 9, y: 9, width: 992, height: 752 });
});

test('de uitsnede blijft binnen de pagina; niets op de pagina geeft geen render', () => {
  assert.deepEqual(stempelUitsnede([[-40, -10, 60, 30], [1950, 1380, 2100, 1500]], 2000, 1400),
    { x: 0, y: 0, width: 2000, height: 1400 });
  assert.equal(stempelUitsnede([[2100, 10, 2200, 40]], 2000, 1400), null);
  assert.equal(stempelUitsnede([], 2000, 1400), null);
  assert.equal(stempelUitsnede([[NaN, 0, 10, 10]], 2000, 1400), null);
  assert.deepEqual(stempelUitsnede([[NaN, 0, 10, 10], [100, 100, 120, 120]], 2000, 1400),
    { x: 99, y: 99, width: 22, height: 22 });
});

function antwoord(width, height, vul = 7) {
  const b = new Uint8Array(8 + width * height * 4).fill(vul);
  new DataView(b.buffer).setUint32(0, width, true);
  new DataView(b.buffer).setUint32(4, height, true);
  return b;
}

test('het antwoord: breedte, hoogte en de pixels; een verkeerde lengte is een fout', () => {
  const g = decodeGebied(antwoord(3, 2));
  assert.equal(g.width, 3);
  assert.equal(g.height, 2);
  assert.equal(g.rgba.length, 24);
  assert.equal(g.rgba[0], 7);
  // Ook als ArrayBuffer, zoals de IPC hem geeft.
  assert.equal(decodeGebied(antwoord(3, 2).buffer).rgba.length, 24);
  assert.throws(() => decodeGebied(antwoord(3, 2).subarray(0, 20)), /STAMP_REGION_ANSWER/);
  assert.throws(() => decodeGebied(new Uint8Array(4)), /STAMP_REGION_ANSWER/);
});

test('de aanvraag: het deel in punten van de getoonde pagina, pagina vanaf nul', async () => {
  const gezien = [];
  const render = createStempelRender({
    pad: 'C:\\map\\tekening.pdf',
    invoke: async (naam, args) => { gezien.push([naam, args]); return antwoord(203, 63); },
  });
  const g = await render(3, 2, { x: 99, y: 199, width: 203, height: 63 });
  assert.equal(g.width, 203);
  assert.deepEqual(gezien, [['render_annotated_region', {
    path: 'C:\\map\\tekening.pdf', pageIndex: 2, scale: 2,
    regionXPt: 49.5, regionYPt: 99.5, regionWPt: 101.5, regionHPt: 31.5,
  }]]);
});

test('zonder bestand op schijf of zonder backend is er geen worker-route', () => {
  assert.equal(createStempelRender({ invoke: async () => null, pad: null }), null);
  assert.equal(createStempelRender({ invoke: async () => null, pad: 'blob:abc' }), null);
  assert.equal(createStempelRender({ invoke: null, pad: 'C:/a.pdf' }), null);
  assert.notEqual(createStempelRender({ invoke: async () => null, pad: '/home/a.pdf' }), null);
});

test('na een fout: null (PDF.js neemt het over), één waarschuwing, en niet opnieuw proberen', async () => {
  let aanroepen = 0;
  const gewaarschuwd = [];
  const render = createStempelRender({
    pad: 'C:/a.pdf', warn: (...a) => gewaarschuwd.push(a),
    invoke: async () => { aanroepen++; throw new Error('PDF_WORKER_UNSUPPORTED: region with annotations'); },
  });
  const deel = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(await render(1, 2, deel), null);
  assert.equal(await render(1, 2, deel), null);
  assert.equal(aanroepen, 1);
  assert.equal(gewaarschuwd.length, 1);
});

test('uitgezet met OPDS_RUST_STAMPS=0: null zonder waarschuwing', async () => {
  const gewaarschuwd = [];
  const render = createStempelRender({
    pad: 'C:/a.pdf', warn: (...a) => gewaarschuwd.push(a),
    invoke: async () => { throw 'PDF_STAMPS_DISABLED'; },
  });
  assert.equal(await render(1, 2, { x: 0, y: 0, width: 10, height: 10 }), null);
  assert.equal(gewaarschuwd.length, 0);
});
