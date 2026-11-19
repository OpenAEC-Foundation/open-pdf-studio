import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./app-test-hooks.mjs', import.meta.url, {
  data: { extraStubs: ['/js/core/platform.js', '/js/pdf/samenvoegen.js', '/js/pdf/cad-import-logica.js'] },
});
const { combineerNaastBron } = await import('./shell-combineer-hier.js');
const { startShellActies } = await import('./shell-acties.js');
const { PDFDocument } = await import('pdf-lib');

test('direct combineren schrijft pas wanneer alle geselecteerde bronnen bruikbaar zijn', async (t) => {
  const uitvoer = new Map();
  const paden = ['map/1.pdf', 'map/2.pdf'];
  let ondertekend = true;
  t.mock.method(PDFDocument, 'load', async ([nummer]) => ({
    nummer,
    paginas: [nummer],
    getPageCount() { return this.paginas.length; },
    save() { return this.paginas.slice(); },
  }));
  globalThis.__nep = {
    readBinaryFile: (pad) => [paden.indexOf(pad) + 1],
    telHandtekeningen: (doc) => ondertekend && doc.nummer === 2,
    voegPdfsSamen: (doel, bronnen) => {
      for (const bron of bronnen) doel.paginas.push(...bron.doc.paginas);
    },
    writeBinaryFileNew: (pad, bytes) => {
      if (uitvoer.has(pad)) throw new Error('CHOOSE_NEW_FILE');
      uitvoer.set(pad, bytes);
    },
  };
  await assert.rejects(combineerNaastBron(paden));
  assert.equal(uitvoer.size, 0);
  ondertekend = false;
  const eerste = await combineerNaastBron(paden);
  const tweede = await combineerNaastBron(paden);
  assert.deepEqual(uitvoer.get(eerste), [1, 2]);
  assert.equal(tweede, eerste.replace(/\.pdf$/, ' (2).pdf'));
});

test('afbeelding omzetten geeft het geschreven bestand door aan de openwachtrij', { timeout: 5000 }, async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1EAAAAASUVORK5CYII=', 'base64');
  let geschreven;
  globalThis.__nep = {
    isTauri: () => true,
    invoke: (naam) => naam === 'get_shell_action' ? [{ mode: 'convert', files: ['map/foto.png'] }] : undefined,
    readBinaryFile: () => png,
    writeBinaryFileNew: (pad, bytes) => {
      if (pad === 'map/foto.pdf') throw new Error('CHOOSE_NEW_FILE');
      geschreven = { pad, bytes };
    },
  };
  let meldGeopend;
  const geopend = new Promise(resolve => { meldGeopend = resolve; });
  await startShellActies({ openFiles: meldGeopend });
  assert.deepEqual(await geopend, ['map/foto (2).pdf']);
  assert.equal(geschreven.pad, 'map/foto (2).pdf');
  assert.equal(Buffer.from(geschreven.bytes.subarray(0, 5)).toString(), '%PDF-');
});
