// Bezier segments on a polyline and a polygon in the real app (Chromium),
// issue #1169: convert a segment to a curve and back from the context menu,
// drag a curve handle (smooth node keeps both handles in line, Alt toggles),
// Alt+drag a segment to bend it, insert and delete a node on a curve, undo and
// redo, on a rotated polygon and in the continuous view.
//   node scripts/test-bezier-editing-browser.mjs
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
const cache = await mkdtemp(path.join(tmpdir(), 'opds-bezier-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 18369, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });

  const pdf = await PDFDocument.create();
  for (let i = 0; i < 2; i++) pdf.addPage([800, 900]).drawText(`Bezier test ${i + 1}`, { x: 40, y: 860 });
  await page.evaluate(async (bytes) => {
    const { state, getActiveDocument } = await import('/js/core/state.ts');
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const renderer = await import('/js/pdf/renderer.js');
    const view = await import('/js/pdf/pdf-viewport.js');
    const ruimte = await import('/js/pdf/weergave-ruimte.js');
    const { setTool } = await import('/js/tools/manager.js');
    const { createAnnotation } = await import('/js/annotations/factory.js');
    const rendering = await import('/js/annotations/rendering.js');
    const vorm = await import('/js/annotations/curve-shape.js');
    const pad = await import('/js/annotations/curve-path.js');
    const veelhoek = await import('/js/annotations/veelhoek-punten.js');
    const i18n = (await import('/js/i18n/config.js')).default;
    const tab = createTab('/bezier-test.pdf');
    await loadPDF('/bezier-test.pdf', tab.index, new Uint8Array(bytes));
    await getActiveDocument()._annotationCompletion;
    window.bz = { state, getActiveDocument, renderer, view, ruimte, setTool, createAnnotation, rendering, vorm, pad, veelhoek, i18n };
  }, Array.from(await pdf.save()));

  const rust = () => page.waitForTimeout(250);
  // A page point (page units, y down) as a client position.
  let naarClient = (x, y, pagina = 1) => page.evaluate(([x, y, pagina]) => {
    const { getActiveDocument, view, ruimte } = window.bz;
    const doc = getActiveDocument();
    if (doc.viewMode === 'continuous') {
      const el = document.querySelector(`#continuous-container .canvas-container-cont[data-page="${pagina}"]`)
        || [...document.querySelectorAll('#continuous-container .page-wrapper .canvas-container-cont')][pagina - 1];
      const r = el.getBoundingClientRect();
      const w = ruimte.paginaNaarWeergave(pagina, x, y, doc);
      return { x: r.left + w.x * doc.scale, y: r.top + w.y * doc.scale };
    }
    const r = document.getElementById('annotation-canvas').getBoundingClientRect();
    if (view.viewport.active && doc.filePath) {
      const s = view.worldToScreen(x, y);
      return { x: r.left + s.x, y: r.top + s.y };
    }
    const w = ruimte.paginaNaarWeergave(doc.currentPage, x, y, doc);
    return { x: r.left + w.x * doc.scale, y: r.top + w.y * doc.scale };
  }, [x, y, pagina]);
  const maak = (props) => page.evaluate((props) => {
    const t = window.bz;
    const doc = t.getActiveDocument();
    const extra = props.type === 'polygon' ? t.veelhoek.veelhoekUitPunten(props.points) : {};
    const ann = t.createAnnotation({ color: '#cc0000', strokeColor: '#cc0000', lineWidth: 2, opacity: 1, ...props, ...extra });
    doc.annotations.push(ann);
    if (doc.viewMode === 'continuous') t.rendering.redrawContinuous(); else t.rendering.redrawAnnotations();
    return ann.id;
  }, props);
  // The live state of an annotation, with its path on the page.
  const lees = (id) => page.evaluate((id) => {
    const t = window.bz;
    const doc = t.getActiveDocument();
    const a = doc.annotations.find((q) => q.id === id);
    if (!a) return null;
    const p = t.vorm.padOpScherm(a);
    return JSON.parse(JSON.stringify({
      punten: p.points, krommen: p.curves || null, gesloten: p.closed,
      heeftVeld: 'curves' in a, aantal: a.points.length, zijden: a.sides, hoek: a.rotation || 0,
      stuur: t.vorm.stuurpunten(a),
      lengte: t.pad.pathLength(p.points, p.curves, { closed: p.closed }),
      vloeiend: p.points.map((_, i) => t.vorm.isVloeiendeKnoop(a, i)),
      geselecteerd: (doc.selectedAnnotations || []).some((q) => q.id === id),
      midden: (p.curves || []).map((s, i) => (s ? t.pad.cubicPoint(t.pad.segmentCubic(p.points, p.curves, i, p.closed), 0.5) : null)),
    }));
  }, id);
  const label = (sleutel) => page.evaluate((s) => window.bz.i18n.t(s, { ns: 'context' }), sleutel);
  // Every position the scenario uses must be on the page itself, not under a
  // side panel that opened in the meantime.
  const ruwNaarClient = naarClient;
  naarClient = async (x, y, pagina = 1) => {
    const c = await ruwNaarClient(x, y, pagina);
    const raak = await page.evaluate(([cx, cy]) => {
      const el = document.elementFromPoint(cx, cy);
      return el ? (!!el.closest('#pdf-container') || el.closest('.context-menu') ? 'ok' : (el.id || el.className || el.tagName)) : 'nothing';
    }, [c.x, c.y]);
    assert.equal(raak, 'ok', `page point (${x}, ${y}) is covered by ${raak}`);
    return c;
  };
  const klik = async (x, y, pagina, opties) => { const c = await naarClient(x, y, pagina); await page.mouse.click(c.x, c.y, opties); await rust(); };
  const sleep = async (van, naar, pagina, toets) => {
    const a = await naarClient(van.x, van.y, pagina), b = await naarClient(naar.x, naar.y, pagina);
    await page.mouse.move(a.x, a.y);
    if (toets) await page.keyboard.down(toets);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
    if (toets) await page.keyboard.up(toets);
    await rust();
  };
  const menu = async (x, y, pagina, sleutel) => {
    const c = await naarClient(x, y, pagina);
    await page.mouse.click(c.x, c.y, { button: 'right' });
    const tekst = await label(sleutel);
    const item = page.locator('.context-menu-item', { hasText: tekst }).first();
    await item.waitFor({ state: 'visible', timeout: 10000 });
    await item.click();
    await rust();
  };
  const bijna = (a, b, tol, wat) => assert.ok(Math.abs(a - b) <= tol, `${wat}: ${a} vs ${b}`);
  const zoom = () => page.evaluate(() => {
    const t = window.bz; const doc = t.getActiveDocument();
    return t.view.viewport.active && doc.filePath ? t.view.viewport.zoom : doc.scale;
  });

  for (const mode of ['single', 'continuous']) {
    await page.evaluate(async (mode) => {
      const t = window.bz;
      await t.renderer.setViewMode(mode);
      await t.renderer.setZoom(1);
      t.setTool('select');
      document.activeElement?.blur();
      const c = document.getElementById('pdf-container');
      c.scrollTop = 0;
    }, mode);
    await rust();
    const tol = 2.5 / (await zoom());   // a couple of screen pixels, in page units

    // ── Polyline ──────────────────────────────────────────────────────────
    const id = await maak({ type: 'polyline', page: 1, points: [{ x: 100, y: 200 }, { x: 300, y: 200 }, { x: 300, y: 400 }] });
    await klik(200, 200, 1);
    let s = await lees(id);
    assert.equal(s.geselecteerd, true, `${mode}: a click on the line selects the polyline`);
    assert.equal(s.heeftVeld, false, `${mode}: a polyline without curves has no curves field`);
    assert.equal(s.stuur.length, 0);

    // Context menu on a segment: convert to a curve.
    await menu(200, 200, 1, 'contextMenu.convertToCurve');
    s = await lees(id);
    assert.ok(s.krommen && s.krommen[0] && !s.krommen[1], `${mode}: segment 0 is a curve, segment 1 is straight`);
    assert.equal(s.stuur.length, 2, `${mode}: two handles`);
    assert.deepEqual(s.punten, [{ x: 100, y: 200 }, { x: 300, y: 200 }, { x: 300, y: 400 }], `${mode}: the nodes stay`);
    const naOmzetten = s;

    // Undo and redo.
    await page.keyboard.press('Control+z'); await rust();
    assert.equal((await lees(id)).heeftVeld, false, `${mode}: undo makes the segment straight again`);
    await page.keyboard.press('Control+y'); await rust();
    s = await lees(id);
    assert.deepEqual(s.krommen, naOmzetten.krommen, `${mode}: redo restores the curve`);

    // Drag the first handle: it follows the mouse, the other handle stays.
    let h = s.stuur[0];
    await sleep(h, { x: h.x + 10, y: h.y - 60 }, 1);
    s = await lees(id);
    bijna(s.stuur[0].x, h.x + 10, tol, `${mode}: handle x`);
    bijna(s.stuur[0].y, h.y - 60, tol, `${mode}: handle y`);
    assert.deepEqual([s.stuur[1].x, s.stuur[1].y], [naOmzetten.stuur[1].x, naOmzetten.stuur[1].y], `${mode}: the other handle stays`);
    await page.keyboard.press('Control+z'); await rust();
    assert.deepEqual((await lees(id)).krommen, naOmzetten.krommen, `${mode}: undo of the handle drag`);
    await page.keyboard.press('Control+y'); await rust();

    // A plain drag on the line still moves the shape; Alt+drag on a straight
    // segment bends it into a curve.
    await sleep({ x: 300, y: 300 }, { x: 350, y: 300 }, 1, 'Alt');
    s = await lees(id);
    assert.ok(s.krommen[1], `${mode}: Alt+drag turns the straight segment into a curve`);
    assert.deepEqual(s.punten[1], { x: 300, y: 200 }, `${mode}: bending leaves the nodes`);
    bijna(s.midden[1].x, 350, tol, `${mode}: the bent segment follows the mouse (x)`);
    bijna(s.midden[1].y, 300, tol, `${mode}: the bent segment follows the mouse (y)`);

    // Node 1 has two handles now and is a corner. Alt+drag lines them up
    // (smooth); after that a plain drag keeps them in line.
    assert.equal(s.vloeiend[1], false, `${mode}: node 1 starts as a corner`);
    h = s.stuur.find((q) => q.segment === 1 && q.which === 1);
    const overkantVoor = s.stuur.find((q) => q.segment === 0 && q.which === 2);
    await sleep(h, { x: h.x + 40, y: h.y + 30 }, 1, 'Alt');
    s = await lees(id);
    assert.equal(s.vloeiend[1], true, `${mode}: Alt+drag makes the node smooth`);
    h = s.stuur.find((q) => q.segment === 1 && q.which === 1);
    await sleep(h, { x: h.x - 25, y: h.y + 45 }, 1);
    s = await lees(id);
    assert.equal(s.vloeiend[1], true, `${mode}: a smooth node stays smooth`);
    const overkant = s.stuur.find((q) => q.segment === 0 && q.which === 2);
    assert.ok(Math.hypot(overkant.x - overkantVoor.x, overkant.y - overkantVoor.y) > 5, `${mode}: the opposite handle turns along`);
    bijna(Math.hypot(overkant.x - 300, overkant.y - 200), Math.hypot(overkantVoor.x - 300, overkantVoor.y - 200), 0.01, `${mode}: the opposite handle keeps its length`);
    // Alt again: the handle moves on its own, the node becomes a corner.
    h = s.stuur.find((q) => q.segment === 1 && q.which === 1);
    await sleep(h, { x: h.x + 60, y: h.y - 10 }, 1, 'Alt');
    s = await lees(id);
    assert.equal(s.vloeiend[1], false, `${mode}: Alt+drag on a smooth node breaks it into a corner`);
    const o2 = s.stuur.find((q) => q.segment === 0 && q.which === 2);
    assert.deepEqual([o2.x, o2.y], [overkant.x, overkant.y], `${mode}: the opposite handle stays when broken`);

    // Drag a node: its handles travel along.
    const voorKnoop = s;
    await sleep({ x: 300, y: 400 }, { x: 340, y: 440 }, 1);
    s = await lees(id);
    bijna(s.punten[2].x, 340, tol, `${mode}: node x`);
    bijna(s.punten[2].y, 440, tol, `${mode}: node y`);
    assert.deepEqual(s.krommen, voorKnoop.krommen, `${mode}: the handles keep their place relative to the node`);

    // Insert a node on the curve: the shape stays the same.
    const lengteVoor = s.lengte;
    const m = s.midden[0];
    await menu(m.x, m.y, 1, 'contextMenu.insertVertex');
    s = await lees(id);
    assert.equal(s.aantal, 4, `${mode}: a node is added on the curve`);
    bijna(s.lengte, lengteVoor, 0.01, `${mode}: inserting a node keeps the length`);
    assert.ok(s.krommen[0] && s.krommen[1], `${mode}: the curve is split in two curves`);
    bijna(s.punten[1].x, m.x, tol * 2, `${mode}: the new node is where the click was (x)`);
    assert.equal(s.vloeiend[1], true, `${mode}: the new node is smooth`);

    // Delete that node again.
    await menu(s.punten[1].x, s.punten[1].y, 1, 'contextMenu.deleteVertex');
    s = await lees(id);
    assert.equal(s.aantal, 3, `${mode}: the node is removed`);
    bijna(s.lengte, lengteVoor, 0.5, `${mode}: deleting the inserted node gives the curve back`);

    // Back to a straight segment.
    await menu(s.midden[0].x, s.midden[0].y, 1, 'contextMenu.convertToStraight');
    s = await lees(id);
    assert.equal(s.krommen[0], null, `${mode}: segment 0 is straight again`);
    assert.ok(s.krommen[1], `${mode}: segment 1 keeps its curve`);

    // ── Polygon, rotated ─────────────────────────────────────────────────
    const pid = await maak({ type: 'polygon', page: 1, fillColor: '#ffeeaa', points: [{ x: 100, y: 500 }, { x: 260, y: 500 }, { x: 260, y: 620 }, { x: 100, y: 620 }] });
    await page.evaluate((pid) => {
      const t = window.bz; const doc = t.getActiveDocument();
      doc.annotations.find((q) => q.id === pid).rotation = 30;
      if (doc.viewMode === 'continuous') t.rendering.redrawContinuous(); else t.rendering.redrawAnnotations();
    }, pid);
    await klik(180, 560, 1);
    let p = await lees(pid);
    assert.equal(p.geselecteerd, true, `${mode}: a click inside selects the polygon`);
    assert.equal(p.hoek, 30);
    // The closing side (node 3 back to node 0) becomes a curve.
    const zijde = { x: (p.punten[3].x + p.punten[0].x) / 2, y: (p.punten[3].y + p.punten[0].y) / 2 };
    const hoekpunten = p.punten;
    await menu(zijde.x, zijde.y, 1, 'contextMenu.convertToCurve');
    p = await lees(pid);
    assert.ok(p.krommen && p.krommen[3], `${mode}: the closing side of the polygon is a curve`);
    assert.equal(p.hoek, 30, `${mode}: the polygon keeps its rotation`);
    p.punten.forEach((q, i) => { bijna(q.x, hoekpunten[i].x, 1e-6, `${mode}: corner ${i} x`); bijna(q.y, hoekpunten[i].y, 1e-6, `${mode}: corner ${i} y`); });
    // Drag a handle of the rotated polygon: it lands under the mouse.
    h = p.stuur.find((q) => q.segment === 3 && q.which === 1);
    await sleep(h, { x: h.x - 50, y: h.y + 20 }, 1);
    p = await lees(pid);
    const h2 = p.stuur.find((q) => q.segment === 3 && q.which === 1);
    bijna(h2.x, h.x - 50, tol, `${mode}: polygon handle x`);
    bijna(h2.y, h.y + 20, tol, `${mode}: polygon handle y`);
    p.punten.forEach((q, i) => { bijna(q.x, hoekpunten[i].x, 1e-6, `${mode}: corner ${i} stays (x)`); bijna(q.y, hoekpunten[i].y, 1e-6, `${mode}: corner ${i} stays (y)`); });
    // A node on the curve of the polygon, and away again.
    await menu(p.midden[3].x, p.midden[3].y, 1, 'contextMenu.insertVertex');
    p = await lees(pid);
    assert.equal(p.aantal, 5, `${mode}: the polygon has a fifth corner`);
    assert.equal(p.zijden, 5);
    await page.keyboard.press('Control+z'); await rust();
    p = await lees(pid);
    assert.equal(p.aantal, 4, `${mode}: undo removes the corner`);
    assert.ok(p.krommen[3], `${mode}: and keeps the curve`);

    // Clean up for the next view mode.
    await page.evaluate(([a, b]) => {
      const t = window.bz; const doc = t.getActiveDocument();
      doc.selectedAnnotations = []; doc.selectedAnnotation = null;
      for (const id of [a, b]) {
        const i = doc.annotations.findIndex((q) => q.id === id);
        if (i >= 0) doc.annotations.splice(i, 1);
      }
      if (doc.viewMode === 'continuous') t.rendering.redrawContinuous(); else t.rendering.redrawAnnotations();
    }, [id, pid]);
    console.log(`PASS ${mode}: convert to curve and back, undo/redo, handle drag, Alt+drag bend, smooth and corner nodes, node drag, insert and delete a node on a curve, rotated polygon`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS no browser errors');
} finally { await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true }); }
