// Verify compare-view sync: side-by-side panes mirror scroll (programmatic +
// drag-pan) and shared zoom keeps the view anchored. Also checks overlay
// drag-pan. Drives the rig (MCP :9223 + CDP :9222) and writes screenshots
// next to this script.
//
// Usage: node mcp-server/verify-compare-sync.mjs

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const playwright = require('C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/playwright');

const MCP = 'http://127.0.0.1:9223/mcp';
const OLD_PDF = 'C:/Users/rickd/Documents/GitHub/open-pdf-studio/test pdf-bestanden/Originele bestanden/Technische tekening.pdf';
const NEW_PDF = 'C:/Users/rickd/Documents/GitHub/open-pdf-studio/test pdf-bestanden/Testbestanden/Technische tekening.pdf';
const SHOTS = 'C:/Users/rickd/Documents/GitHub/open-pdf-studio/mcp-server';

async function tool(name, args) {
  const r = await fetch(MCP, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }) });
  const j = await r.json(); const text = j?.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return text ?? j; }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await playwright.chromium.connectOverCDP('http://localhost:9222');
  const page = browser.contexts()[0].pages()[0];
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail || ''}`); };

  // 1. Open both PDFs as tabs.
  await tool('app_open_pdf', { path: OLD_PDF }); await sleep(2500);
  await tool('app_open_pdf', { path: NEW_PDF }); await sleep(2500);
  const tabs = await tool('app_list_tabs', {});
  console.log('tabs:', JSON.stringify(tabs).slice(0, 300));

  // 2. Start compare in side-by-side mode directly via the store.
  await page.evaluate(async ([o, n]) => {
    const cs = await import('/js/compare/compare-store.js');
    cs.startCompare({ oldFilePath: o, newFilePath: n, mode: 'side', oldPage: 1, newPage: 1 });
  }, [OLD_PDF, NEW_PDF]);
  await sleep(4000); // initial HQ render

  const paneState = () => page.evaluate(() => {
    const o = document.querySelector('.compare-pane-old');
    const n = document.querySelector('.compare-pane-new');
    const co = o?.querySelector('canvas'); const cn = n?.querySelector('canvas');
    return o && n ? {
      old: { sl: o.scrollLeft, st: o.scrollTop, sw: o.scrollWidth, sh: o.scrollHeight, cw: o.clientWidth, ch: o.clientHeight },
      neu: { sl: n.scrollLeft, st: n.scrollTop, sw: n.scrollWidth, sh: n.scrollHeight },
      canvas: { ow: co?.width, oh: co?.height, nw: cn?.width, nh: cn?.height },
    } : null;
  });

  let st = await paneState();
  check('side: panes aanwezig', !!st, JSON.stringify(st?.canvas));
  if (!st) { await browser.close(); process.exit(2); }

  // 3. Zoom in (shared zoom) so panes become scrollable.
  await page.evaluate(async () => {
    const cs = await import('/js/compare/compare-store.js');
    cs.setCompareZoom(cs.compareZoom() * 2.5);
  });
  await sleep(1200); // debounce 150ms + HQ re-render
  st = await paneState();
  const scrollable = st.old.sw > st.old.cw + 10 && st.old.sh > st.old.ch + 10;
  check('side: ingezoomd → scrollbaar', scrollable, `scroll ${st.old.sw}x${st.old.sh} client ${st.old.cw}x${st.old.ch}`);

  // 4. Programmatic scroll on OLD pane → NEW pane must follow (scroll event + rAF).
  await page.evaluate(() => {
    const o = document.querySelector('.compare-pane-old');
    o.scrollLeft = 300; o.scrollTop = 220;
  });
  await sleep(300);
  st = await paneState();
  check('side: scroll old → new volgt', Math.abs(st.neu.sl - st.old.sl) <= 1 && Math.abs(st.neu.st - st.old.st) <= 1,
    `old(${st.old.sl},${st.old.st}) new(${st.neu.sl},${st.neu.st})`);

  // 5. Reverse: scroll NEW pane → OLD follows.
  await page.evaluate(() => {
    const n = document.querySelector('.compare-pane-new');
    n.scrollLeft = 80; n.scrollTop = 40;
  });
  await sleep(300);
  st = await paneState();
  check('side: scroll new → old volgt', Math.abs(st.neu.sl - st.old.sl) <= 1 && Math.abs(st.neu.st - st.old.st) <= 1,
    `old(${st.old.sl},${st.old.st}) new(${st.neu.sl},${st.neu.st})`);

  // 6. Drag-pan on OLD pane (pointerdown + moves + up) → both move together.
  const before = await paneState();
  await page.evaluate(() => {
    const o = document.querySelector('.compare-pane-old');
    const r = o.getBoundingClientRect();
    const cx = r.left + 100, cy = r.top + 100;
    const opts = (x, y, extra) => ({ bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra });
    o.dispatchEvent(new PointerEvent('pointerdown', opts(cx, cy, { buttons: 1 })));
    for (let i = 1; i <= 5; i++) {
      window.dispatchEvent(new PointerEvent('pointermove', opts(cx - i * 20, cy - i * 10, { buttons: 1 })));
    }
    window.dispatchEvent(new PointerEvent('pointerup', opts(cx - 100, cy - 50, { buttons: 0 })));
  });
  await sleep(300);
  st = await paneState();
  const dragged = st.old.sl - before.old.sl;
  check('side: drag-pan verschuift beide', dragged >= 90 && Math.abs(st.neu.sl - st.old.sl) <= 1 && Math.abs(st.neu.st - st.old.st) <= 1,
    `Δold=${dragged} old(${st.old.sl},${st.old.st}) new(${st.neu.sl},${st.neu.st})`);

  await page.screenshot({ path: `${SHOTS}/compare-sync-side-zoomed.png` });

  // 7. Zoom-anchor: remember center, zoom 1.5x, center fraction must be ~stable.
  const centerFrac = (s) => ({
    fx: (s.old.sl + s.old.cw / 2) / s.old.sw,
    fy: (s.old.st + s.old.ch / 2) / s.old.sh,
  });
  const fBefore = centerFrac(st);
  await page.evaluate(async () => {
    const cs = await import('/js/compare/compare-store.js');
    cs.setCompareZoom(cs.compareZoom() * 1.5);
  });
  await sleep(1400);
  st = await paneState();
  const fAfter = centerFrac(st);
  check('side: zoom houdt anker (centrum-fractie stabiel)',
    Math.abs(fAfter.fx - fBefore.fx) < 0.06 && Math.abs(fAfter.fy - fBefore.fy) < 0.06,
    `voor(${fBefore.fx.toFixed(3)},${fBefore.fy.toFixed(3)}) na(${fAfter.fx.toFixed(3)},${fAfter.fy.toFixed(3)})`);
  check('side: zoom → panes nog synchroon', Math.abs(st.neu.sl - st.old.sl) <= 1 && Math.abs(st.neu.st - st.old.st) <= 1,
    `old(${st.old.sl},${st.old.st}) new(${st.neu.sl},${st.neu.st})`);

  await page.screenshot({ path: `${SHOTS}/compare-sync-side-zoom-anchor.png` });

  // 8. Overlay mode: drag-pan must scroll the body.
  await page.evaluate(async () => {
    const cs = await import('/js/compare/compare-store.js');
    cs.setCompareMode('overlay');
  });
  await sleep(2500);
  const ovBefore = await page.evaluate(() => {
    const b = document.querySelector('.compare-body');
    return { sl: b.scrollLeft, st: b.scrollTop, sw: b.scrollWidth, cw: b.clientWidth };
  });
  await page.evaluate(() => {
    const b = document.querySelector('.compare-body');
    const r = b.getBoundingClientRect();
    const cx = r.left + 200, cy = r.top + 200;
    const opts = (x, y, extra) => ({ bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra });
    b.dispatchEvent(new PointerEvent('pointerdown', opts(cx, cy, { buttons: 1 })));
    for (let i = 1; i <= 5; i++) {
      window.dispatchEvent(new PointerEvent('pointermove', opts(cx - i * 15, cy - i * 15, { buttons: 1 })));
    }
    window.dispatchEvent(new PointerEvent('pointerup', opts(cx - 75, cy - 75, { buttons: 0 })));
  });
  await sleep(300);
  const ovAfter = await page.evaluate(() => {
    const b = document.querySelector('.compare-body');
    return { sl: b.scrollLeft, st: b.scrollTop };
  });
  const ovScrollable = ovBefore.sw > ovBefore.cw + 10;
  check('overlay: drag-pan scrolt', !ovScrollable || (ovAfter.sl > ovBefore.sl || ovAfter.st > ovBefore.st),
    `scrollable=${ovScrollable} voor(${ovBefore.sl},${ovBefore.st}) na(${ovAfter.sl},${ovAfter.st})`);
  await page.screenshot({ path: `${SHOTS}/compare-sync-overlay.png` });

  // Console errors during the run?
  const cons = await tool('app_get_recent_console', { limit: 40 });
  const errs = (Array.isArray(cons) ? cons : cons?.entries || []).filter(e => /error/i.test(e.level || e.type || ''));
  check('geen console-errors', errs.length === 0, errs.slice(0, 3).map(e => e.text || e.message).join(' | '));

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('SCRIPT_ERR:', e.message); process.exit(3); });
