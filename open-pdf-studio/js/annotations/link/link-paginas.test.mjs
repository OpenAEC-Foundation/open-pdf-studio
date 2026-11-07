// Een link van de app naar een pagina in dit document volgt die pagina bij
// structurele bewerkingen in page-manager.js (verplaatsen, invoegen,
// verwijderen, vervangen, Pagina's bewerken). Is de doelpagina weg, dan is de
// link gebroken in plaats van stil naar een andere pagina te wijzen.
// De app-modules rond page-manager.js zijn vervangen door doorgeefluiken
// (pdf/page-manager-test-hooks.mjs); page-manager.js en pdf-lib zijn echt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { PDFDocument } from 'pdf-lib';
import { createPlan, moveEntriesToGap, deleteEntries } from '../../pdf/page-edit-plan.js';

register('../../pdf/page-manager-test-hooks.mjs', import.meta.url);
const pm = await import('../../pdf/page-manager.js');

const SLEUTEL = 'geheugen/links.pdf';

async function bron(aantal = 4) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < aantal; i++) doc.addPage([100 * (i + 1), 500]);
  return new Uint8Array(await doc.save());
}

const naarPagina = (id, page, doelPagina, extra = {}) => ({
  id, type: 'link', page, x: 10, y: 10, width: 50, height: 20,
  linkTarget: { kind: 'page', page: doelPagina, fit: 'xyz', left: null, top: 500, zoom: null, ...extra },
});

async function opstelling({ aantal = 4, bestanden = {}, gekozen = null } = {}) {
  const bytes = await bron(aantal);
  const cache = new Map([[SLEUTEL, bytes]]);
  const doc = {
    id: 'doc-links',
    filePath: SLEUTEL,
    pdfDoc: { numPages: aantal, destroy() {} },
    currentPage: 1,
    pageRotations: {},
    annotations: [
      naarPagina('naar3', 1, 3),
      naarPagina('naar4', 2, 4, { fit: 'fit' }),
      { id: 'web', type: 'link', page: 1, x: 0, y: 0, width: 5, height: 5, linkTarget: { kind: 'uri', uri: 'https://openaec.org' } },
      { id: 'vak', type: 'box', page: 3 },
    ],
  };
  const undo = [];
  globalThis.window = { __TAURI__: { dialog: { open: async () => gekozen } } };
  globalThis.__pmTest = {
    impl: {
      getActiveDocument: () => doc,
      getCachedPdfBytes: (k) => cache.get(k),
      setCachedPdfBytes: (k, b) => { cache.set(k, b); },
      isTauri: () => true,
      readBinaryFile: async (pad) => {
        if (!bestanden[pad]) throw new Error(`onbekend bestand ${pad}`);
        return bestanden[pad];
      },
      getDocument: ({ data }) => ({
        promise: PDFDocument.load(data).then((d) => ({ numPages: d.getPageCount(), destroy() {} })),
      }),
      recordPageStructure: (...a) => { undo.push(a); },
      showMessage: () => {},
    },
  };
  return { doc, undo };
}

const doel = (doc, id) => doc.annotations.find((a) => a.id === id)?.linkTarget;

test('reordering pages: a page target follows its page', async () => {
  const { doc } = await opstelling();
  await pm.reorderPages([3, 1, 4, 2]); // oud 3 -> 1, oud 4 -> 3
  assert.equal(doel(doc, 'naar3').page, 1);
  assert.equal(doel(doc, 'naar4').page, 3);
  assert.equal(doel(doc, 'naar4').fit, 'fit', 'the view stays');
  assert.equal(doel(doc, 'naar3').top, 500, 'the position stays');
  assert.deepEqual(doel(doc, 'web'), { kind: 'uri', uri: 'https://openaec.org' });
});

test('inserting pages before the target moves the target along', async () => {
  const { doc } = await opstelling();
  await pm.insertBlankPages('before', 3, 2, 100, 100);
  assert.equal(doel(doc, 'naar3').page, 5);
  assert.equal(doel(doc, 'naar4').page, 6);
  assert.equal(doc.annotations.find((a) => a.id === 'naar3').page, 1, 'the link itself stays on page 1');
});

test('deleting the target page marks the link broken instead of retargeting it', async () => {
  const { doc, undo } = await opstelling();
  await pm.deletePages([3]);
  const t = doel(doc, 'naar3');
  assert.equal(t.kind, 'page');
  assert.equal(t.broken, true);
  assert.equal(t.page, null);
  assert.equal(doel(doc, 'naar4').page, 3, 'the other link follows its page');
  // De stand voor ongedaan maken heeft het oude doel nog.
  const oud = undo[0][1];
  assert.equal(oud.find((a) => a.id === 'naar3').linkTarget.page, 3);
  assert.equal(oud.find((a) => a.id === 'naar3').linkTarget.broken, undefined);

  // Een volgende bewerking laat een gebroken link gebroken.
  await pm.reorderPages([3, 2, 1]);
  assert.equal(doel(doc, 'naar3').broken, true);
  assert.equal(doel(doc, 'naar3').page, null);
});

test('deleting another page renumbers the target; a link on a deleted page goes with it', async () => {
  const { doc } = await opstelling();
  await pm.deletePages([2]);
  assert.equal(doel(doc, 'naar3').page, 2);
  assert.equal(doc.annotations.find((a) => a.id === 'naar4'), undefined, 'naar4 lived on page 2');
});

test('replacing the target page breaks the link', async () => {
  const vervanging = await bron(1);
  const { doc } = await opstelling({ bestanden: { 'v.pdf': vervanging }, gekozen: 'v.pdf' });
  await pm.replacePages(3);
  assert.equal(doel(doc, 'naar3').broken, true);
  assert.equal(doel(doc, 'naar4').page, 4);
});

test('the Edit Pages organizer: moved and deleted targets in one go', async () => {
  const { doc } = await opstelling();
  let plan = createPlan(4);
  plan = moveEntriesToGap(plan, ['p4'], 0);   // 4 1 2 3
  plan = deleteEntries(plan, ['p3']).plan;     // 4 1 2
  assert.equal(await pm.applyPageEdits(plan), true);
  assert.equal(doel(doc, 'naar4').page, 1);
  assert.equal(doel(doc, 'naar3').broken, true);
});
