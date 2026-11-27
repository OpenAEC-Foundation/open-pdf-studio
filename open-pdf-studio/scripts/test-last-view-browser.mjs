// Reopening a PDF brings back the view it was closed with (#1245): page, zoom,
// place on the page and view mode. Closes and reopens documents in the real
// page view and compares what is on screen before and after; also the cases
// in which the stored view must not be shown.
//   node scripts/test-last-view-browser.mjs
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PDFDocument, rgb } from 'pdf-lib';
const root = fileURLToPath(new URL('../', import.meta.url)); process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-weergaveproef-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 18393, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('[data-tab="view"]', { timeout: 120000 });

  // A call into the page that never returns must fail with its name, not hang.
  // OPDS_PROEF_UITLEG=1 prints every step.
  const stap = (naam, belofte) => {
    if (process.env.OPDS_PROEF_UITLEG) console.log(`  ${naam}`);
    let klok;
    const grens = new Promise((_, weiger) => { klok = setTimeout(() => weiger(new Error(`${naam}: no answer within 90 s`)), 90000); });
    return Promise.race([belofte, grens]).finally(() => clearTimeout(klok));
  };

  const maakPdf = async (paginas) => {
    const pdf = await PDFDocument.create();
    for (let i = 0; i < paginas; i++) {
      const p = pdf.addPage([595, 842]);
      p.drawRectangle({ x: 40, y: 40, width: 515, height: 762, color: rgb(0.9, 0.9 - i * 0.1, 0.6) });
    }
    return Array.from(await pdf.save());
  };
  const zes = await maakPdf(6);
  const twee = await maakPdf(2);

  // Open a file in a tab; `opts.front` false loads it in a background tab,
  // `opts.explicit` marks it as opened for a specific target.
  const open = (naam, bytes, opts = {}) => stap(`open ${naam}`, page.evaluate(async ([naam, bytes, opts]) => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { state } = await import('/js/core/state.ts');
    const tab = createTab(`/${naam}.pdf`, opts.front !== false);
    if (opts.explicit) (await import('/js/core/last-view.js')).markExplicitTarget(state.documents[tab.index]);
    await loadPDF(`/${naam}.pdf`, tab.index, new Uint8Array(bytes));
    return tab.index;
  }, [naam, bytes, opts]));
  const sluit = (naam) => stap(`close ${naam}`, page.evaluate(async (naam) => {
    const { closeTab } = await import('/js/ui/chrome/tabs.js');
    const { state } = await import('/js/core/state.ts');
    const i = state.documents.findIndex(d => d.filePath === `/${naam}.pdf`);
    if (i < 0) throw new Error(`${naam} is not open`);
    return closeTab(i, true);
  }, naam));
  const rust = (ms = 900) => page.waitForTimeout(ms);
  // What is on screen for the document in front.
  const beeld = () => page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { viewModeOf } = await import('/js/core/last-view.js');
    const d = getActiveDocument();
    const vp = window.__pdfViewport;
    const c = document.getElementById('pdf-container');
    return {
      naam: d.fileName, pagina: d.currentPage, modus: viewModeOf(d), schaal: d.scale, wacht: !!d._lastViewRestore,
      vp: !!vp?.active, zoom: vp?.zoom, offsetX: vp?.offsetX, offsetY: vp?.offsetY,
      scrollTop: c.scrollTop, scrollLeft: c.scrollLeft,
    };
  });
  const bewaard = (naam) => page.evaluate(async (naam) => {
    const { findView, LAST_VIEWS_NAME } = await import('/js/core/last-view.js');
    const { leesOpslagJson } = await import('/js/core/opslag.js');
    return findView(leesOpslagJson(LAST_VIEWS_NAME, []), `/${naam}.pdf`);
  }, naam);
  const render = (fn, ...args) => stap(`${fn}(${args.join(', ')})`, page.evaluate(async ([fn, args]) => (await import('/js/pdf/renderer.js'))[fn](...args), [fn, args]));
  // Move the view off-centre, the way panning or scrolling does.
  const verschuif = (dx, dy) => page.evaluate(async ([dx, dy]) => {
    const vp = window.__pdfViewport;
    if (vp?.active) {
      const m = await import('/js/pdf/pdf-viewport.js');
      m.zetViewportStand({ zoom: vp.zoom, offsetX: vp.offsetX - dx, offsetY: vp.offsetY - dy, verankerd: true });
    } else {
      const c = document.getElementById('pdf-container');
      c.scrollLeft += dx; c.scrollTop += dy;
    }
  }, [dx, dy]);
  const zoomVan = (b) => (b.vp ? b.zoom : b.schaal);
  const bijna = (a, b, marge, tekst) => assert.ok(Math.abs(a - b) <= marge, `${tekst}: ${a} vs ${b}`);
  const zelfdeBeeld = (voor, na, tekst) => {
    assert.equal(na.pagina, voor.pagina, `${tekst}: page`);
    assert.equal(na.modus, voor.modus, `${tekst}: view mode`);
    assert.equal(na.vp, voor.vp, `${tekst}: same kind of page view`);
    bijna(zoomVan(na), zoomVan(voor), zoomVan(voor) * 0.002, `${tekst}: zoom`);
    if (voor.vp) {
      bijna(na.offsetX, voor.offsetX, 2, `${tekst}: horizontal place`);
      bijna(na.offsetY, voor.offsetY, 2, `${tekst}: vertical place`);
    } else {
      bijna(na.scrollLeft, voor.scrollLeft, 3, `${tekst}: horizontal scroll`);
      bijna(na.scrollTop, voor.scrollTop, 3, `${tekst}: vertical scroll`);
    }
  };

  // ── 1. A new file opens as always; nothing is stored until it closes. ──────
  await open('plan', zes); await rust();
  const begin = await beeld();
  assert.equal(begin.pagina, 1);
  assert.equal(begin.modus, 'single');
  assert.equal(await bewaard('plan'), null);

  // ── 2. Zoomed in on page 4, off-centre: back exactly there. ────────────────
  await render('goToPage', 4); await rust(400);
  await render('setZoom', zoomVan(begin) * 2.5); await rust(400);
  await verschuif(130, 210); await rust(400);
  const ingezoomd = await beeld();
  assert.equal(ingezoomd.pagina, 4);
  // The view really differs from how a document opens, so "the same again"
  // below says something.
  assert.ok(zoomVan(ingezoomd) > zoomVan(begin) * 2, 'zoomed in');
  if (ingezoomd.vp) assert.ok(Math.abs(ingezoomd.offsetY - begin.offsetY) > 100, 'moved off-centre');
  else assert.ok(ingezoomd.scrollTop > 100, 'scrolled down');
  assert.equal(await sluit('plan'), true);
  const opgeslagen = await bewaard('plan');
  assert.equal(opgeslagen?.page, 4, 'closing stores the page');
  assert.equal(opgeslagen.mode, 'single');
  assert.equal(opgeslagen.fit, undefined, 'a zoomed view is not a fit');
  await open('plan', zes); await rust();
  zelfdeBeeld(ingezoomd, await beeld(), 'zoomed in on page 4');

  // ── 3. Fit Page on another page: fitted again. ─────────────────────────────
  await render('goToPage', 2); await rust(400);
  await render('fitPage'); await rust(400);
  const passend = await beeld();
  await sluit('plan');
  if (passend.vp) assert.equal((await bewaard('plan')).fit, 'page', 'a fitted view is stored as a fit');
  await open('plan', zes); await rust();
  zelfdeBeeld(passend, await beeld(), 'fit page on page 2');

  // ── 4. Continuous view, scrolled into page 5. ──────────────────────────────
  await render('setViewMode', 'continuous'); await rust(600);
  await render('setZoom', 1.3); await rust(600);
  await render('goToPage', 5); await rust(900);
  await verschuif(0, 170); await rust(500);
  const doorlopend = await beeld();
  assert.equal(doorlopend.modus, 'continuous');
  assert.equal(doorlopend.pagina, 5);
  assert.ok(doorlopend.scrollTop > 1000, 'scrolled well into the document');
  await sluit('plan');
  assert.equal((await bewaard('plan')).mode, 'continuous');
  await open('plan', zes); await rust(1500);
  zelfdeBeeld(doorlopend, await beeld(), 'continuous, scrolled into page 5');

  // ── 5. The file lost pages: the last page, zoom and view mode still hold. ──
  await sluit('plan');
  await open('plan', twee); await rust(1500);
  const korter = await beeld();
  assert.equal(korter.pagina, 2, 'a page beyond the page count becomes the last page');
  assert.equal(korter.modus, 'continuous');
  bijna(korter.schaal, doorlopend.schaal, 0.01, 'zoom of the shorter file');
  await sluit('plan');
  assert.equal((await bewaard('plan')).page, 2);

  // ── 6. An explicit target wins. ────────────────────────────────────────────
  await open('plan', zes, { explicit: true }); await rust();
  const doel = await beeld();
  assert.equal(doel.pagina, 1, 'explicit target: not the stored page');
  assert.equal(doel.modus, 'single', 'explicit target: not the stored view mode');
  assert.equal(doel.wacht, false);
  // It still stores where it is closed.
  await render('goToPage', 3); await rust(400);
  await sluit('plan');
  assert.equal((await bewaard('plan')).page, 3);

  // ── 7. The preference off: nothing is shown and nothing is stored. ─────────
  const voorkeur = (aan) => page.evaluate(async (aan) => { (await import('/js/core/state.ts')).state.preferences.reopenAtLastView = aan; }, aan);
  await voorkeur(false);
  await open('plan', zes); await rust();
  assert.equal((await beeld()).pagina, 1, 'preference off: opens on page 1');
  await render('goToPage', 6); await rust(400);
  await sluit('plan');
  assert.equal((await bewaard('plan')).page, 3, 'preference off: the stored view is left alone');
  await voorkeur(true);
  await open('plan', zes); await rust();
  assert.equal((await beeld()).pagina, 3, 'preference on again: the stored view is shown');
  await sluit('plan');

  // ── 8. Closed from the background: the view it had when it left the front. ─
  await open('a', zes); await rust();
  await render('goToPage', 3); await rust(400);
  await render('setZoom', zoomVan(await beeld()) * 1.8); await rust(400);
  await verschuif(60, 90); await rust(400);
  const aVoor = await beeld();
  await open('b', zes); await rust();
  assert.equal((await beeld()).naam, 'b.pdf');
  await sluit('a');
  assert.equal((await bewaard('a'))?.page, 3, 'a background tab stores its view');
  await sluit('b');
  await open('a', zes); await rust();
  zelfdeBeeld(aVoor, await beeld(), 'closed from the background');

  // ── 9. Loaded in a background tab: shown when the tab comes to the front. ──
  await sluit('a');
  await open('b', zes); await rust();
  const iA = await open('a', zes, { front: false }); await rust();
  assert.equal((await beeld()).naam, 'b.pdf', 'the other tab stays in front');
  await stap('switch to a', page.evaluate(async (i) => { await (await import('/js/ui/chrome/tabs.js')).switchToTab(i); }, iA)); await rust(1500);
  zelfdeBeeld(aVoor, await beeld(), 'shown on the first activation');

  // ── 10. Never on screen: nothing is stored for it. ─────────────────────────
  await open('c', zes, { front: false }); await rust();
  await sluit('c');
  assert.equal(await bewaard('c'), null, 'a document that was never in front has no view');

  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log(`PASS: a reopened document comes back at its last view; explicit targets and the preference are honoured (single page: ${begin.vp ? 'viewport' : 'scrolling canvas'})`);
} finally { await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true }); }
