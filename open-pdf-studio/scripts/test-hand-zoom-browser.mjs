// Zooming with the Hand tool in the real app (Chromium), issue #1161:
// drag pans, Ctrl+click / Ctrl+Shift+click zoom one step about the clicked
// point, Ctrl+drag zooms to a rectangle, and a plain click zooms only when
// the preference is on. Links and form fields keep their own click.
//   node scripts/test-hand-zoom-browser.mjs
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PDFDocument } from 'pdf-lib';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-hand-zoom-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 18362, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });

  const pdf = await PDFDocument.create();
  for (let i = 0; i < 3; i++) pdf.addPage([1200, 1600]).drawText(`Hand zoom test ${i + 1}`, { x: 400, y: 800 });
  await page.evaluate(async (bytes) => {
    const { state, getActiveDocument } = await import('/js/core/state.ts');
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const renderer = await import('/js/pdf/renderer.js');
    const view = await import('/js/pdf/pdf-viewport.js');
    const { setTool } = await import('/js/tools/manager.js');
    const tab = createTab('/hand-zoom-test.pdf');
    await loadPDF('/hand-zoom-test.pdf', tab.index, new Uint8Array(bytes));
    await getActiveDocument()._annotationCompletion;
    window.hz = { state, getActiveDocument, renderer, view, setTool };
  }, Array.from(await pdf.save()));

  const stand = () => page.evaluate(() => {
    const { state, getActiveDocument, view } = window.hz;
    const c = document.getElementById('pdf-container');
    const vp = view.viewport.active && !!getActiveDocument().filePath;
    const r = document.getElementById('hand-zoom-rechthoek');
    const rr = r && getComputedStyle(r).display !== 'none' ? r.getBoundingClientRect() : null;
    return {
      x: vp ? view.viewport.offsetX : c.scrollLeft, y: vp ? view.viewport.offsetY : c.scrollTop,
      zoom: vp ? view.viewport.zoom : getActiveDocument().scale,
      pan: state.isPanning, tool: state.currentTool, annotations: getActiveDocument().annotations.length,
      rechthoek: rr ? { x: rr.left, y: rr.top, w: rr.width, h: rr.height } : null,
    };
  });
  // The page point under a client position: page coordinates in the vector
  // viewport, otherwise the fraction of the page element under the cursor.
  const paginaPunt = (x, y) => page.evaluate(([x, y]) => {
    const { getActiveDocument, view } = window.hz;
    const doc = getActiveDocument();
    if (view.viewport.active && doc.filePath) {
      const r = document.getElementById('pdf-canvas').getBoundingClientRect();
      const w = view.screenToWorld(x - r.left, y - r.top);
      return { fx: w.x / view.viewport.pageW, fy: w.y / view.viewport.pageH, pagina: 0 };
    }
    let els = [document.getElementById('pdf-canvas')];
    if (doc.viewMode === 'continuous') els = [...document.querySelectorAll('#continuous-container .page-wrapper .canvas-container-cont')];
    const i = Math.max(0, els.findIndex((e) => { const r = e.getBoundingClientRect(); return y >= r.top && y <= r.bottom; }));
    const r = els[i].getBoundingClientRect();
    return { fx: (x - r.left) / r.width, fy: (y - r.top) / r.height, pagina: i };
  }, [x, y]);
  const zelfdePunt = (a, b, wat, marge = 0.008) => {
    assert.equal(a.pagina, b.pagina, `${wat}: same page`);
    assert.ok(Math.abs(a.fx - b.fx) < marge && Math.abs(a.fy - b.fy) < marge, `${wat}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  };
  const wachtOpZoom = (vorige) => page.waitForFunction((z) => {
    const t = window.hz; const doc = t.getActiveDocument();
    return (t.view.viewport.active && doc.filePath ? t.view.viewport.zoom : doc.scale) !== z;
  }, vorige, { timeout: 15000 });
  const rust = () => page.waitForTimeout(350);
  const zetVoorkeur = (aan) => page.evaluate((aan) => { window.hz.state.preferences.handClickZoom = aan; }, aan);
  const midden = () => page.evaluate(() => {
    const c = document.getElementById('pdf-container'); const r = c.getBoundingClientRect();
    return { x: r.left + c.clientLeft + c.clientWidth / 2, y: r.top + c.clientTop + c.clientHeight / 2, w: c.clientWidth, h: c.clientHeight };
  });

  for (const mode of ['single', 'continuous']) {
    await page.evaluate(async (mode) => {
      const t = window.hz;
      await t.renderer.setViewMode(mode);
      await t.renderer.setZoom(1.5);
      t.setTool('hand');
      t.state.preferences.handClickZoom = false;
      document.activeElement?.blur();
      const c = document.getElementById('pdf-container');
      c.scrollTop = 400;
      c.scrollLeft = Math.max(0, (c.scrollWidth - c.clientWidth) / 2);
    }, mode);
    await rust();
    const m = await midden();
    const x = Math.round(m.x), y = Math.round(m.y);
    await page.mouse.move(x, y);

    // Default: a plain click with the hand does not zoom.
    let voor = await stand();
    await page.mouse.click(x, y); await rust();
    let na = await stand();
    assert.equal(na.zoom, voor.zoom, `${mode}: plain click keeps the zoom by default`);
    assert.equal(na.pan, false);

    // Drag pans, as before.
    await page.mouse.down(); assert.equal((await stand()).pan, true, `${mode}: drag starts a pan`);
    await page.mouse.move(x - 60, y - 80, { steps: 5 });
    await page.mouse.up(); await rust();
    na = await stand();
    assert.ok(na.x !== voor.x || na.y !== voor.y, `${mode}: drag moves the document`);
    assert.equal(na.zoom, voor.zoom, `${mode}: drag does not zoom`);
    assert.equal(na.pan, false);

    // Ctrl+click zooms in one step about the clicked point.
    voor = await stand(); let punt = await paginaPunt(x, y);
    await page.keyboard.down('Control'); await page.mouse.click(x, y); await page.keyboard.up('Control');
    await wachtOpZoom(voor.zoom); await rust();
    na = await stand();
    assert.ok(na.zoom > voor.zoom, `${mode}: Ctrl+click zooms in`);
    zelfdePunt(punt, await paginaPunt(x, y), `${mode}: Ctrl+click keeps the clicked point`);
    const ingezoomd = na.zoom;

    // Ctrl+Shift+click zooms out again.
    punt = await paginaPunt(x, y);
    await page.keyboard.down('Control'); await page.keyboard.down('Shift');
    await page.mouse.click(x, y);
    await page.keyboard.up('Shift'); await page.keyboard.up('Control');
    await wachtOpZoom(ingezoomd); await rust();
    na = await stand();
    assert.ok(na.zoom < ingezoomd, `${mode}: Ctrl+Shift+click zooms out`);
    zelfdePunt(punt, await paginaPunt(x, y), `${mode}: Ctrl+Shift+click keeps the clicked point`);

    // Preference on: click zooms in, Shift+click zooms out, drag still pans,
    // a long press does nothing.
    await zetVoorkeur(true);
    voor = await stand(); punt = await paginaPunt(x, y);
    await page.mouse.click(x, y); await wachtOpZoom(voor.zoom); await rust();
    na = await stand();
    assert.ok(na.zoom > voor.zoom, `${mode}: click zooms in with the preference on`);
    zelfdePunt(punt, await paginaPunt(x, y), `${mode}: click keeps the clicked point`);
    voor = na;
    await page.keyboard.down('Shift'); await page.mouse.click(x, y); await page.keyboard.up('Shift');
    await wachtOpZoom(voor.zoom); await rust();
    assert.ok((await stand()).zoom < voor.zoom, `${mode}: Shift+click zooms out with the preference on`);
    voor = await stand();
    await page.mouse.down(); await page.mouse.move(x + 50, y + 40, { steps: 4 }); await page.mouse.up(); await rust();
    na = await stand();
    assert.equal(na.zoom, voor.zoom, `${mode}: drag still only pans with the preference on`);
    assert.ok(na.x !== voor.x || na.y !== voor.y, `${mode}: drag still pans with the preference on`);
    await page.mouse.move(x, y);
    await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up(); await rust();
    assert.equal((await stand()).zoom, voor.zoom, `${mode}: a long press is not a click`);

    // A link and a form field keep their own click (no zoom).
    await page.evaluate(([x, y]) => {
      const laag = document.createElement('div'); laag.className = 'linkLayer'; laag.id = 'hz-test-laag';
      laag.style.cssText = `position:fixed;left:${x - 20}px;top:${y - 20}px;width:40px;height:40px;z-index:5000;`;
      const link = document.createElement('div'); link.className = 'pdf-link';
      link.style.cssText = 'position:absolute;inset:0;pointer-events:auto;';
      laag.append(link); document.getElementById('pdf-container').append(laag);
    }, [x, y]);
    await page.mouse.click(x, y); await rust();
    assert.equal((await stand()).zoom, voor.zoom, `${mode}: a click on a link does not zoom`);
    await page.evaluate(() => {
      const laag = document.getElementById('hz-test-laag'); laag.className = 'formLayer';
      laag.innerHTML = '<section style="inset:0"><input id="hz-test-veld" style="width:40px;height:40px"></section>';
    });
    await page.mouse.click(x, y); await rust();
    assert.equal((await stand()).zoom, voor.zoom, `${mode}: a click in a form field does not zoom`);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'hz-test-veld', `${mode}: the form field gets the focus`);
    await page.evaluate(() => { document.activeElement?.blur(); document.getElementById('hz-test-laag').remove(); });
    await zetVoorkeur(false);

    // Ctrl+drag draws a zoom rectangle (no pan) and zooms to it.
    await page.evaluate(async () => { await window.hz.renderer.setZoom(1); });
    await rust();
    await page.evaluate(() => {
      const c = document.getElementById('pdf-container');
      c.scrollTop = 300; c.scrollLeft = Math.max(0, (c.scrollWidth - c.clientWidth) / 2);
    });
    await rust();
    // Half the view wide, off-centre, well inside the page.
    const rw = Math.round(m.w * 0.5), rh = Math.round(m.h * 0.4);
    const a = { x: x - Math.round(m.w * 0.3), y: y - Math.round(m.h * 0.25) }, b = { x: a.x + rw, y: a.y + rh };
    const rc = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    voor = await stand(); punt = await paginaPunt(rc.x, rc.y);
    await page.keyboard.down('Control');
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    const tijdens = await stand();
    assert.deepEqual(tijdens.rechthoek, { x: a.x, y: a.y, w: rw, h: rh }, `${mode}: the zoom rectangle is shown`);
    assert.equal(tijdens.pan, false, `${mode}: Ctrl+drag does not pan`);
    assert.deepEqual([tijdens.x, tijdens.y, tijdens.zoom], [voor.x, voor.y, voor.zoom], `${mode}: the view stands still while drawing`);
    // Escape cancels.
    await page.keyboard.press('Escape');
    assert.equal((await stand()).rechthoek, null, `${mode}: Escape hides the rectangle`);
    await page.mouse.up(); await rust();
    assert.equal((await stand()).zoom, voor.zoom, `${mode}: Escape cancels the zoom rectangle`);
    // Again, now released.
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.keyboard.up('Control');
    await page.mouse.up();
    await wachtOpZoom(voor.zoom); await rust();
    na = await stand();
    assert.equal(na.rechthoek, null, `${mode}: the rectangle is gone after release`);
    const factor = Math.min(m.w / rw, m.h / rh);
    assert.ok(Math.abs(na.zoom / voor.zoom - factor) < 0.02 * factor, `${mode}: rectangle zoom ${na.zoom / voor.zoom} should be ${factor}`);
    zelfdePunt(punt, await paginaPunt(m.x, m.y), `${mode}: the rectangle centre is in the middle of the view`, 0.012);
    assert.equal(na.tool, 'hand'); assert.equal(na.annotations, voor.annotations); assert.equal(na.pan, false);
    console.log(`PASS ${mode}: drag pans, Ctrl+click / Ctrl+Shift+click zoom about the point, click zoom preference, link and form field untouched, Ctrl+drag zoom rectangle`);
  }

  // Other tools are not affected: Ctrl+click with Select does not zoom.
  await page.evaluate(() => { window.hz.setTool('select'); window.hz.state.preferences.handClickZoom = true; });
  const m = await midden();
  const voor = await stand();
  await page.mouse.click(m.x, m.y);
  await page.keyboard.down('Control'); await page.mouse.click(m.x, m.y); await page.keyboard.up('Control');
  await rust();
  assert.equal((await stand()).zoom, voor.zoom, 'the Select tool does not zoom on click');
  assert.deepEqual(errors, []);
  console.log('PASS other tools unaffected; no browser errors');
} finally { await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true }); }
