import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPageInfoForDocument, readPageContentForDocument, renderPageTileForDocument } from './page-access.js';

function fixture() {
  const viewport = {
    width: 1000, height: 600, rotation: 90,
    transform: [0, 1, 1, 0, 10, 20],
    convertToViewportPoint: (x, y) => [x + 10, y + 20],
    convertToPdfPoint: (x, y) => [x - 10, y - 20],
  };
  const page = {
    rotate: 90,
    getViewport: () => viewport,
    getTextContent: async () => ({ items: [{ str: 'ROOM 103', transform: [1, 0, 0, 1, 40, 50], width: 80, height: 10 }] }),
  };
  const doc = { id: 'drawing-1', numPages: 2, pdfDoc: { getPage: async () => page } };
  return { doc, page };
}

test('page info exposes stable identity, rotation and two-way coordinates', async () => {
  const { doc } = fixture();
  const info = await getPageInfoForDocument(doc, 1, { rotation: 0 });
  assert.equal(info.documentId, 'drawing-1');
  assert.deepEqual([info.width, info.height, info.rotation], [1000, 600, 90]);
  assert.deepEqual(info.pdfToAnnotation(4, 5), { x: 14, y: 25 });
  assert.deepEqual(info.annotationToPdf(14, 25), { x: 4, y: 5 });
});

test('page reader returns positioned text and vectors for same document', async () => {
  const { doc } = fixture();
  const content = await readPageContentForDocument(doc, 1, {
    extractVectors: async () => ({ edges: [{ x1: 1, y1: 2, x2: 3, y2: 4 }], points: [] }),
  });
  assert.equal(content.documentId, 'drawing-1');
  assert.equal(content.text[0].text, 'ROOM 103');
  assert.deepEqual(content.text[0].transform, [0, 1, 1, 0, 60, 60]);
  assert.deepEqual(content.edges, [{ x1: 1, y1: 2, x2: 3, y2: 4 }]);
});

test('cancelled and invalid page requests fail before reading content', async () => {
  const { doc } = fixture();
  await assert.rejects(getPageInfoForDocument(doc, 3), /page/i);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readPageContentForDocument(doc, 1, { signal: controller.signal }), /abort/i);
});

test('raster tiles are clipped to a bounded region', async () => {
  const { doc, page } = fixture();
  let renderOptions;
  page.render = options => { renderOptions = options; return { promise: Promise.resolve(), cancel() {} }; };
  const createCanvas = () => ({ getContext: () => ({}), convertToBlob: async () => new Blob(['png']) });
  const tile = await renderPageTileForDocument(doc, 1,
    { x: 120, y: 80, width: 200, height: 100 }, { scale: 2, createCanvas });
  assert.deepEqual(renderOptions.transform, [1, 0, 0, 1, -240, -160]);
  assert.deepEqual([tile.width, tile.height], [400, 200]);
  await assert.rejects(renderPageTileForDocument(doc, 1,
    { x: 0, y: 0, width: 1000, height: 600 }, { scale: 4, createCanvas }), /tile/i);
});
