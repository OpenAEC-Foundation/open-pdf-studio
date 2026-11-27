import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument, PDFName } from 'pdf-lib';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-mcp-perimeter-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error',
  server: { host: '127.0.0.1', port: 18348, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  const result = await page.evaluate(async () => {
    const { runAppEvent } = await import('/js/mcp-bridge.js');
    const { getActiveDocument } = await import('/js/core/state.ts');
    await (await import('/js/pdf/loader.js')).createBlankPDF(1200, 800, 1);
    const scale = await runAppEvent('mcp:set-measure-scale', { pixelsPerUnit: 18, unit: 'ft' });
    if (!scale.ok) throw new Error(JSON.stringify(scale));
    const doc = getActiveDocument();
    const points = [{ x: 150, y: 112 }, { x: 1050, y: 112 }, { x: 1050, y: 652 }, { x: 150, y: 652 }];
    async function create(props) {
      const before = doc.annotations.length, undoBefore = doc.undoStack.length;
      const input = JSON.stringify(props);
      const reply = await runAppEvent('mcp:create-annotation', { type: 'measurePerimeter', page: 1, props });
      const ann = doc.annotations.at(-1);
      return { reply, added: doc.annotations.length - before, undoAdded: doc.undoStack.length - undoBefore,
        inputUnchanged: JSON.stringify(props) === input, value: ann?.measureValue,
        points: ann?.points?.map(p => ({ x: p.x, y: p.y })), hasClosed: Object.hasOwn(ann || {}, 'closed') };
    }
    const reports = [];
    for (const props of [{ points, closed: true }, { points }, { points, closed: false },
      { points: [...points, points[0]], closed: true }, { points: [...points, points[0]] }]) reports.push(await create(props));
    const invalid = [];
    for (const closed of ['true', 1, null, {}]) invalid.push(await create({ points, closed }));
    invalid.push(await create({ points: points.slice(0, 2), closed: true }));
    doc.annotations = [doc.annotations[0]];
    const { pdfDocLib } = await (await import('/js/pdf/saver.js')).bouwAnnotatieDocument(doc);
    return { reports, invalid, bytes: Array.from(await pdfDocLib.save()) };
  });
  const saved = await PDFDocument.load(new Uint8Array(result.bytes));
  const dict = saved.getPage(0).node.lookup(PDFName.of('Annots')).lookup(0);
  result.vertices = dict.lookup(PDFName.of('Vertices')).asArray().map(n => n.asNumber());
  result.content = dict.lookup(PDFName.of('Contents')).decodeText();
  assert.deepEqual(result.reports.map(r => r.value), [160, 130, 130, 160, 160]);
  for (const report of result.reports) {
    assert.equal(report.reply.ok, true);
    assert.equal(report.added, 1);
    assert.equal(report.undoAdded, 1);
    assert.equal(report.inputUnchanged, true);
    assert.equal(report.hasClosed, false, 'closed is a creation option, not persisted state');
  }
  assert.deepEqual(result.reports.map(r => r.points.length), [5, 4, 4, 5, 5]);
  assert.deepEqual(result.reports[0].points[0], result.reports[0].points.at(-1));
  for (const invalid of result.invalid) {
    assert.equal(invalid.reply.ok, false);
    assert.match(invalid.reply.error, /closed/);
    assert.equal(invalid.added, 0);
    assert.equal(invalid.undoAdded, 0);
  }
  assert.equal(result.vertices.length, 10);
  assert.deepEqual(result.vertices.slice(0, 2), result.vertices.slice(-2));
  assert.match(result.content, /160[.,]00\s*ft/);
  // #1286: real Properties dropdown, undo/redo, edited geometry and PDF reload.
  await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { createMeasurePerimeterAnnotation } = await import('/js/tools/annotation-creators.js');
    const props = await import('/js/solid/stores/propertiesStore.js');
    const doc = getActiveDocument();
    doc.annotations = []; doc.undoStack = []; doc.redoStack = [];
    doc.measureScale = { pixelsPerUnit: 0.1, unit: 'mm' };
    const ann = createMeasurePerimeterAnnotation([{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 250 }]);
    doc.annotations = [ann]; doc.selectedAnnotation = doc.annotations[0]; doc.selectedAnnotations = [doc.annotations[0]];
    props.storeShowProperties(doc.annotations[0]);
  });
  const unitSelect = page.locator('#prop-measurement-section select').filter({ has: page.locator('option[value="mm"]') });
  await unitSelect.selectOption('m');
  const units = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const doc = getActiveDocument();
    const current = () => doc.annotations[0];
    const report = () => ({ unit: current().measureUnit, value: current().measureValue, text: current().measureText });
    const changed = report();
    const { undo, redo } = await import('/js/core/undo-manager.js');
    await undo(); const undone = report();
    await redo(); const redone = report();
    current().points[2].y += 50;
    (await import('/js/annotations/transforms.js')).syncMeasurementAfterEdit(current());
    const edited = report();
    const { pdfDocLib } = await (await import('/js/pdf/saver.js')).bouwAnnotatieDocument(doc);
    const bytes = await pdfDocLib.save();
    const path = '/perimeter-unit-roundtrip.pdf';
    const { index } = (await import('/js/ui/chrome/tabs.js')).createTab(path);
    await (await import('/js/pdf/loader.js')).loadPDF(path, index, bytes.slice());
    await getActiveDocument()._annotationCompletion;
    const reopened = getActiveDocument().annotations.find(a => a.type === 'measurePerimeter');
    return { changed, undone, redone, edited, reopened: reopened && {
      unit: reopened.measureUnit, value: reopened.measureValue, scale: reopened.measureScale, text: reopened.measureText } };
  });
  for (const result of Object.values(units)) if (result?.text) result.text = result.text.replace(',', '.');
  assert.deepEqual(units.changed, { unit: 'm', value: 2.5, text: '2.50 m' });
  assert.equal(units.undone.unit, 'mm'); assert.equal(units.undone.value, 2500);
  assert.deepEqual(units.redone, units.changed);
  assert.deepEqual(units.edited, { unit: 'm', value: 3, text: '3.00 m' });
  assert.deepEqual(units.reopened, { unit: 'm', value: 3, scale: 0.01, text: '3.00 m' });
  console.log('Perimeter unit dropdown, undo/redo, geometry and PDF reload passed.', JSON.stringify(units));
  console.log(JSON.stringify({ passed: true, values: result.reports.map(r => r.value), rejected: result.invalid.length,
    savedVertices: result.vertices.length / 2, savedLabel: result.content }));
} finally {
  await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true });
}
