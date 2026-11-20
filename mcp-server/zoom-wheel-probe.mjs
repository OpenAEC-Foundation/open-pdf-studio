import { verificationPath } from '../scripts/verification-path.mjs';
// CDP probe: simulate REAL ctrl+wheel events on BARN to reproduce the
// "zoom werkt niet goed" symptom. Captures full state at every phase.
//
// Unlike zoom-race-probe.mjs which called zoomIn() directly (bypassing
// the navigation-events wheel handler), this dispatches actual WheelEvent
// objects to .main-view — exercising the FULL chain including the
// cursor-anchor scrollLeft adjustment.

import { createRequire } from 'module';
import http from 'http';

const require = createRequire(import.meta.url);
const { WebSocket } = require('C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/ws');

const BARN = verificationPath('PDF-bestanden/20260316 - Barn Relocation - 389 E Hemenway Lane - for Permit.pdf');

async function main() {
  const targets = await fetchJson('http://localhost:9222/json/list');
  const pageTarget = targets.find(t => t.type === 'page');
  if (!pageTarget) { console.error('No page'); process.exit(3); }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  const consoleLog = [];

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.method === 'Runtime.consoleAPICalled') {
      const args = (msg.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
      consoleLog.push({ t: Date.now(), type: msg.params.type, text: args });
    }
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  await new Promise(r => ws.on('open', r));

  function send(method, params = {}) {
    const id = ++msgId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expr) {
    const result = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }

  await send('Runtime.enable');
  console.log('CDP connected');

  const path = JSON.stringify(BARN);

  // Open BARN if not already
  console.log('Loading BARN...');
  await evaluate(`(async () => {
    await window.__TAURI__.core.invoke('allow_fs_scope', { path: ${path} });
    const stateMod = await import('/js/core/state.ts');
    const tabsMod = await import('/js/ui/chrome/tabs.js');
    const loaderMod = await import('/js/pdf/loader.js');
    const idx = stateMod.state.documents.findIndex(d => d.filePath === ${path});
    if (idx >= 0) stateMod.state.activeDocumentIndex = idx;
    else { tabsMod.createTab(${path}); await loaderMod.loadPDF(${path}, stateMod.state.activeDocumentIndex); }
    return true;
  })()`);
  await sleep(3000);

  // Snapshot state helper
  async function snapshot() {
    return await evaluate(`(async () => {
      const stateMod = await import('/js/core/state.ts');
      const doc = stateMod.state.documents[stateMod.state.activeDocumentIndex];
      const pdfCanvas = document.getElementById('pdf-canvas');
      const container = document.getElementById('pdf-container');
      const r = pdfCanvas?.getBoundingClientRect();
      return {
        scale: doc?.scale,
        bw: pdfCanvas?.width,
        bh: pdfCanvas?.height,
        cssW: pdfCanvas?.style?.width,
        cssH: pdfCanvas?.style?.height,
        scrollLeft: container?.scrollLeft,
        scrollTop: container?.scrollTop,
        rectLeft: r?.left,
        rectTop: r?.top,
        rectW: r?.width,
        rectH: r?.height,
      };
    })()`);
  }

  console.log('\nInitial state:', JSON.stringify(await snapshot()));
  consoleLog.length = 0;

  // Reset zoom to known state
  await evaluate(`(async () => {
    const r = await import('/js/pdf/renderer.js');
    await r.setZoom(1.0);
  })()`);
  await sleep(1500);
  console.log('After setZoom(1.0):', JSON.stringify(await snapshot()));
  consoleLog.length = 0;

  // Burst: 5 rapid ctrl+wheel events at fixed cursor location
  console.log('\n=== BURST: 5 ctrl+wheel events at cursor (600, 400), 30ms apart ===');
  const tBurst = Date.now();
  await evaluate(`(async () => {
    const mainView = document.querySelector('.main-view') || document.body;
    for (let i = 0; i < 5; i++) {
      const ev = new WheelEvent('wheel', {
        deltaY: -100,           // negative = zoom in
        deltaMode: 0,
        clientX: 600,
        clientY: 400,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      mainView.dispatchEvent(ev);
      // Don't await — fire-and-forget like real rapid wheel input
      await new Promise(r => setTimeout(r, 30));
    }
    return true;
  })()`);

  // Snapshot immediately after burst
  await sleep(100);
  const afterBurst = await snapshot();
  console.log('\nImmediately after burst (100ms):', JSON.stringify(afterBurst));

  // Wait for everything to settle
  await sleep(5000);

  const final = await snapshot();
  console.log('\nFinal state (after 5s settle):', JSON.stringify(final));

  console.log('\n=== CONSOLE LOG (filtered to render/STALE/wheel-zoom/zoom) ===');
  const relevant = consoleLog.filter(l => /render|STALE|zoom|gen|scale|wheel/i.test(l.text));
  for (const l of relevant.slice(0, 80)) {
    console.log(`[+${l.t - tBurst}ms ${l.type}] ${l.text}`);
  }

  console.log('\n=== VERDICT ===');
  // Each ctrl+wheel deltaY=-100 with abs(dy) >= ZOOM_DELTA_THRESHOLD=50 fires zoomStepAtPoint OR legacy zoomIn.
  // 5 zoomIns × 0.25 = 1.25 increment from 1.0 → 2.25 expected.
  const expected = 2.25;
  if (final.scale && Math.abs(final.scale - expected) < 0.001) {
    console.log(`✅ Final scale ${final.scale} matches expected ${expected}`);
  } else {
    console.log(`⚠️ Final scale ${final.scale}, expected ${expected}`);
  }
  // BARN p1 at scale=1 is ~2448 wide. At scale=2.25 → ~5508 (or with DPR=1.5: ~8262)
  console.log(`bitmap=${final.bw}x${final.bh}, css=${final.cssW}×${final.cssH}, scrollLeft=${final.scrollLeft}, rectLeft=${final.rectLeft}`);

  // Save to file for analysis
  const summary = {
    initial: await snapshot.toString,
    afterBurst,
    final,
    consoleLogRelevant: relevant.map(l => ({ deltaMs: l.t - tBurst, type: l.type, text: l.text })),
  };
  const fs = await import('fs');
  fs.writeFileSync('C:/Users/rickd/Documents/GitHub/open-pdf-studio/mcp-server/zoom-wheel-probe-output.json', JSON.stringify(summary, null, 2));
  console.log('\nFull log saved to mcp-server/zoom-wheel-probe-output.json');

  ws.close();
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error('FATAL:', e); process.exit(99); });
