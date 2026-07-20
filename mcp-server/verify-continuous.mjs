// Verificatie van de gereactiveerde doorlopende weergave (continuous scroll).
// Checks:
//   1. omschakelen: wrappers voor alle pagina's, lazy render (subset canvases)
//   2. scroll-sync: vrij scrollen werkt doc.currentPage bij
//   3. goToPage: scrollt de juiste wrapper in beeld
//   4. zoom: continuousZoomStep past scale + scrollTop aan zonder DOM-rebuild;
//      ctrl+wheel-event routeert naar dezelfde helper
//   5. annotatie: create-annotation is zichtbaar op het per-pagina canvas
//   6. terug naar single: vector-viewport weer actief
//
// Gebruik: node mcp-server/verify-continuous.mjs

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const playwright = require('C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/playwright');

const MCP = 'http://127.0.0.1:9223/mcp';
const PDF = 'C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden/3131-CLT-Set.pdf';
const SHOTS = 'C:/Users/rickd/Documents/GitHub/open-pdf-studio/mcp-server';

async function tool(name, args) {
  const r = await fetch(MCP, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }) });
  const j = await r.json(); const text = j?.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return text; }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
};

(async () => {
  const browser = await playwright.chromium.connectOverCDP('http://localhost:9222');
  const page = browser.contexts()[0].pages()[0];
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  const evalDoc = (fn) => page.evaluate(async (src) => {
    const s = await import('/js/core/state.ts');
    const doc = s.state.documents[s.state.activeDocumentIndex];
    return (new Function('state', 'doc', `return (${src})(state, doc)`))(s.state, doc);
  }, fn.toString());

  // ── open document ──────────────────────────────────────────────────────
  await tool('app_clear_caches', {}); await sleep(400);
  let pc = 0;
  for (let a = 1; a <= 3 && !pc; a++) {
    await tool('app_open_pdf', { path: PDF });
    for (let i = 0; i < 20 && !pc; i++) { await sleep(700); pc = await evalDoc((s, d) => d?.pdfDoc?.numPages || 0); }
  }
  if (!pc) { console.log('OPEN FAILED'); await browser.close(); process.exit(2); }
  console.log(`document open, ${pc} pagina's`);
  await sleep(3000); // p1 settle

  // ── 1. omschakelen naar continuous ─────────────────────────────────────
  const sv = await tool('app_set_view_mode', { mode: 'continuous' });
  check('set_view_mode continuous ok', sv?.ok === true && sv?.viewMode === 'continuous', JSON.stringify(sv));
  await sleep(2500);

  const layout = await page.evaluate(() => {
    const cont = document.getElementById('continuous-container');
    const wrappers = cont ? cont.querySelectorAll('.page-wrapper').length : 0;
    const canvases = cont ? cont.querySelectorAll('.pdf-canvas').length : 0;
    const visible = cont && getComputedStyle(cont).display !== 'none';
    const single = document.getElementById('canvas-container');
    const singleHidden = single && getComputedStyle(single).display === 'none';
    const vpActive = window.__pdfViewport ? window.__pdfViewport.active : null;
    return { wrappers, canvases, visible, singleHidden, vpActive };
  });
  check('alle pagina-wrappers aanwezig', layout.wrappers === pc, `${layout.wrappers}/${pc}`);
  check('lazy render (subset canvases)', layout.canvases >= 1 && layout.canvases <= pc, `${layout.canvases} canvases`);
  check('containers gewisseld', layout.visible === true && layout.singleHidden === true, JSON.stringify(layout));
  check('vector-viewport uit', layout.vpActive === false, `active=${layout.vpActive}`);
  await page.screenshot({ path: `${SHOTS}/cont-1-continuous.png` });

  // ── 2. scroll-sync ─────────────────────────────────────────────────────
  await page.evaluate(() => {
    const c = document.getElementById('pdf-container');
    const w = document.querySelector('#continuous-container .page-wrapper[data-page="5"]');
    if (c && w) c.scrollTop = w.offsetTop - 40;
  });
  await sleep(800); // sync-debounce 120ms + render
  const afterScroll = await evalDoc((s, d) => d.currentPage);
  check('scroll-sync: currentPage volgt', afterScroll === 5, `currentPage=${afterScroll} (verwacht 5)`);

  // ── 3. goToPage scrollt in beeld ───────────────────────────────────────
  const navTarget = Math.min(3, pc);
  await tool('app_go_to_page', { page: navTarget }); await sleep(1500);
  const nav = await page.evaluate((n) => {
    const c = document.getElementById('pdf-container');
    const w = document.querySelector(`#continuous-container .page-wrapper[data-page="${n}"]`);
    if (!c || !w) return null;
    const cr = c.getBoundingClientRect(); const wr = w.getBoundingClientRect();
    return { inView: wr.bottom > cr.top + 10 && wr.top < cr.bottom - 10 };
  }, navTarget);
  check(`goToPage ${navTarget} scrollt in beeld`, nav?.inView === true, JSON.stringify(nav));
  await sleep(1200);
  await page.screenshot({ path: `${SHOTS}/cont-2-nav.png` });

  // ── 4. zoom: helper + ctrl+wheel-routing ───────────────────────────────
  const z0 = await evalDoc((s, d) => ({ scale: d.scale, scrollTop: document.getElementById('pdf-container').scrollTop, wrappers: document.querySelectorAll('#continuous-container .page-wrapper').length }));
  await page.evaluate(async () => { const m = await import('/js/pdf/renderer.js'); await m.continuousZoomStep(+1, 300); });
  await sleep(400);
  const z1 = await evalDoc((s, d) => ({ scale: d.scale, scrollTop: document.getElementById('pdf-container').scrollTop, wrappers: document.querySelectorAll('#continuous-container .page-wrapper').length }));
  check('zoomstap verhoogt scale', z1.scale > z0.scale, `${z0.scale} -> ${z1.scale}`);
  check('zoom zonder DOM-rebuild', z1.wrappers === z0.wrappers, `${z1.wrappers} wrappers`);
  check('zoom herrekent scrollTop', Math.abs(z1.scrollTop - ((z0.scrollTop + 300) * (z1.scale / z0.scale) - 300)) < 3, `${z0.scrollTop} -> ${z1.scrollTop}`);

  const wheelBefore = await evalDoc((s, d) => d.scale);
  await page.evaluate(() => {
    const mv = document.querySelector('.main-view');
    const c = document.getElementById('pdf-container');
    const r = c.getBoundingClientRect();
    mv.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, clientX: r.left + 200, clientY: r.top + 200, bubbles: true, cancelable: true }));
  });
  await sleep(600);
  const wheelAfter = await evalDoc((s, d) => d.scale);
  check('ctrl+wheel zoomt in continuous', wheelAfter > wheelBefore, `${wheelBefore} -> ${wheelAfter}`);
  await sleep(2500); // zichtbare pagina's herrenderen
  await page.screenshot({ path: `${SHOTS}/cont-3-zoomed.png` });

  // ── 5. annotatie in continuous ─────────────────────────────────────────
  const curPage = await evalDoc((s, d) => d.currentPage);
  const created = await tool('app_create_annotation', { type: 'box', page: curPage, props: { x: 100, y: 100, width: 180, height: 90, color: '#ff0000' } });
  await sleep(900);
  const annVisible = await page.evaluate((pn) => {
    const w = document.querySelector(`#continuous-container .page-wrapper[data-page="${pn}"]`);
    const canvas = w ? w.querySelector('.annotation-canvas') : null;
    if (!canvas) return { found: false };
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let i = 3; i < img.length; i += 4) { if (img[i] > 0) painted++; }
    return { found: true, painted };
  }, curPage);
  check('annotatie zichtbaar op pagina-canvas', annVisible.found && annVisible.painted > 50, JSON.stringify({ created: created?.ok ?? created?.id ?? created, ...annVisible }));
  await page.screenshot({ path: `${SHOTS}/cont-4-annotation.png` });

  // ── 6. terug naar single ───────────────────────────────────────────────
  const back = await tool('app_set_view_mode', { mode: 'single' });
  await sleep(2500);
  const singleState = await page.evaluate(() => ({
    vpActive: window.__pdfViewport ? window.__pdfViewport.active : null,
    contHidden: getComputedStyle(document.getElementById('continuous-container')).display === 'none',
    singleVisible: getComputedStyle(document.getElementById('canvas-container')).display !== 'none',
  }));
  check('terug naar single: viewport actief', back?.ok === true && singleState.vpActive === true && singleState.contHidden && singleState.singleVisible, JSON.stringify(singleState));
  await page.screenshot({ path: `${SHOTS}/cont-5-back-single.png` });

  // ── resultaat ──────────────────────────────────────────────────────────
  const relevantErrors = errors.filter(t => !/favicon|ResizeObserver|Accounts|401/i.test(t));
  console.log(`\nconsole-errors tijdens run: ${relevantErrors.length}`);
  relevantErrors.slice(0, 6).forEach(t => console.log('  ERR: ' + t.slice(0, 160)));
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  await browser.close();
  process.exit(fail === 0 && relevantErrors.length === 0 ? 0 : 1);
})();
