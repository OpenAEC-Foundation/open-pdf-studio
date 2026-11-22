// #1223: real renderer, property UI, selection, undo and style/default guards.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
const cache = await mkdtemp('/tmp/opds-line-patterns-test-');
const server = await createServer({ root: process.cwd(), cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`, { timeout: 90000 });
  await page.waitForSelector('#tool-select');
  const result = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const { drawAnnotation } = await import('/js/annotations/rendering.js');
    const { findAnnotationAt, isPointInsideAnnotation } = await import('/js/annotations/geometry.js');
    const { getAnnotationBounds } = await import('/js/core/stores/selection-helpers.ts');
    const { GEOMETRIC_LINE_STYLES } = await import('/js/annotations/geometric-line-styles.js');
    const { storeShowProperties, storeShowMultiSelection, showToolDefaults, updateAnnotProp } = await import('/js/solid/stores/propertiesStore.js');
    const { applyStyleToSelection } = await import('/js/solid/stores/stylePresetsStore.js');
    const { undo, redo, flushPropertyChange } = await import('/js/core/undo-manager.js');
    const { setActiveTab, setContextualTabsVisible } = await import('/js/solid/stores/ribbonStore.js');
    const { setTool } = await import('/js/tools/manager.js');
    const wait = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const annotations = GEOMETRIC_LINE_STYLES.map((borderStyle, i) => ({ id: `style-${i}`, type: 'line', page: 1,
      startX: 40, startY: 40 + i * 70, endX: 500, endY: 40 + i * 70,
      lineWidth: 1, opacity: 0.6, color: '#1144cc', strokeColor: '#1144cc', borderStyle }));
    state.documents = [{ id: 'patterns', pdfDoc: { numPages: 1 }, currentPage: 1, scale: 1, viewMode: 'single',
      annotations, selectedAnnotation: null, selectedAnnotations: [], undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false }];
    state.activeDocumentIndex = 0; state.currentTool = 'select';
    const doc = state.documents[0];
    const canvas = document.createElement('canvas'); canvas.width = 595; canvas.height = 842;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 595, 842);
    for (const ann of doc.annotations) drawAnnotation(ctx, ann);
    const image = canvas.toDataURL('image/png');
    const painted = [];
    for (let i = 0; i < 9; i++) {
      const data = ctx.getImageData(30, 30 + i * 70, 490, 20).data;
      let ink = 0; for (let j = 0; j < data.length; j += 4) if (data[j] < 245) ink++;
      painted.push(ink);
    }
    const choose = a => { doc.selectedAnnotation = a; doc.selectedAnnotations = [a]; storeShowProperties(a); };
    const options = () => [...document.querySelectorAll('#prop-border-style option')].map(o => o.value);
    choose(doc.annotations[0]); setContextualTabsVisible(true); setActiveTab('format'); await wait(); const lineOptions = options();
    const deadline = performance.now() + 15000;
    while (!document.querySelector('#fmt-border-style') && performance.now() < deadline) await wait();
    const ribbonOptions = [...document.querySelectorAll('#fmt-border-style option')].map(o => o.value);
    const select = document.querySelector('#prop-border-style');
    select.value = 'tracks'; select.dispatchEvent(new Event('change', { bubbles: true })); flushPropertyChange(); await wait();
    const applied = doc.annotations[0].borderStyle;
    await undo(); const undone = doc.annotations[0].borderStyle;
    await redo(); const redone = doc.annotations[0].borderStyle;
    doc.scale = 10; const picked = findAnnotationAt(52, 45, 1)?.id;
    const bounds = getAnnotationBounds(doc.annotations[0]);
    const wide = { ...doc.annotations[0], lineWidth: 5 };
    const outerTieMovable = isPointInsideAnnotation(100, 69, wide);
    doc.annotations.push({ id: 'box', type: 'box', page: 1, x: 10, y: 700, width: 100, height: 40, borderStyle: 'dotted' });
    choose(doc.annotations.at(-1)); await wait(); const boxOptions = options();
    applyStyleToSelection({ borderStyle: 'road' }); const boxStyle = doc.annotations.at(-1).borderStyle;
    doc.selectedAnnotations = [doc.annotations[0], doc.annotations.at(-1)]; storeShowMultiSelection(doc.selectedAnnotations); await wait();
    const mixedOptions = options();
    doc.selectedAnnotations = []; doc.selectedAnnotation = null; setTool('polyline'); showToolDefaults('polyline'); await wait();
    const defaultOptions = options(); updateAnnotProp('borderStyle', 'gas'); await wait();
    return { image, painted, lineOptions, ribbonOptions, applied, undone, redone, picked, bounds, outerTieMovable, boxOptions, boxStyle, mixedOptions, defaultOptions };
  });
  for (const [i, ink] of result.painted.entries()) assert.ok(ink > 300, `pattern ${i} visible in real renderer`);
  for (const style of ['fence-circle','fence-square','gas','hot-water','zigzag','insulation','double','tracks','road']) {
    assert.ok(result.ribbonOptions.includes(style), `ribbon option ${style}`);
    assert.ok(result.lineOptions.includes(style), `property option ${style}`);
    assert.ok(result.defaultOptions.includes(style), `polyline default ${style}`);
    assert.ok(!result.boxOptions.includes(style)); assert.ok(!result.mixedOptions.includes(style));
  }
  assert.equal(result.applied, 'tracks'); assert.equal(result.undone, 'fence-circle'); assert.equal(result.redone, 'tracks');
  assert.equal(result.picked, 'style-0'); assert.equal(result.outerTieMovable, true); assert.ok(result.bounds.height >= 12); assert.equal(result.boxStyle, 'dotted');
  if (process.env.OPDS_PATTERN_ARTIFACT) await writeFile(process.env.OPDS_PATTERN_ARTIFACT, Buffer.from(result.image.split(',')[1], 'base64'));
  delete result.image; console.log(JSON.stringify(result, null, 2)); console.log('Geometric line style browser checks passed.');
} finally {
  await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true });
}
