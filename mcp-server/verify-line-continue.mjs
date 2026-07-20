// Verifieer 'doorgaan (aaneengesloten lijnen)' — KLIK-KLIK tool (geen sleep!).
// Elke lijn = 2 kliks. Met 'continue' aan wordt het eindpunt van lijn N meteen
// het beginpunt van lijn N+1 (zelfde keten-mechaniek als het wall-gereedschap).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pw = require('C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/playwright');
const MCP = 'http://127.0.0.1:9223/mcp';
async function tool(n, a) {
  const r = await fetch(MCP, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: n, arguments: a } }) });
  const j = await r.json(); const t = j?.result?.content?.[0]?.text;
  try { return JSON.parse(t); } catch { return t; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r1 = v => Math.round(v * 10) / 10;
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); ok ? pass++ : fail++; };
const curTool = async () => { const t = await tool('app_get_current_tool', {}); return t?.tool || t?.current; };
const lineAnns = async () => { const a = await tool('app_list_annotations', {}); const arr = Array.isArray(a) ? a : (a?.annotations || []); return arr.filter(x => x.type === 'line').map(x => ({ sx: x.startX, sy: x.startY, ex: x.endX, ey: x.endY })); };

(async () => {
  const b = await pw.chromium.connectOverCDP('http://localhost:9222');
  const p = b.contexts()[0].pages()[0];
  // Herlaad zodat Vite de nieuwe line-tool.js serveert.
  await p.reload({ waitUntil: 'load' }); await sleep(1500);

  await tool('app_clear_caches', {}); await sleep(300);
  await tool('app_open_pdf', { path: 'C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden/Tekst.pdf' }); await sleep(3500);
  await tool('app_set_tool', { tool: 'line' }); await sleep(500);
  check('lijn-gereedschap actief', (await curTool()) === 'line');

  // 'continue'-vinkje aanzetten via het echte change-event (state = createMutable → reactief).
  const cb = await p.evaluate(() => {
    const l = [...document.querySelectorAll('.property-group label')].find(x => /aaneengesloten|continue|doorgaan/i.test(x.textContent || ''));
    if (!l) return { found: false };
    const box = l.querySelector('input[type=checkbox]');
    if (box) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); box.dispatchEvent(new Event('input', { bubbles: true })); }
    return { found: true, box: !!box, checked: box?.checked, text: l.textContent.trim() };
  });
  check("'continue'-vinkje zichtbaar bij lijn-gereedschap", cb.found && cb.box, JSON.stringify(cb));
  check('vinkje aangezet', cb.checked === true);
  await sleep(300);

  const rect = await p.evaluate(() => { const c = document.getElementById('annotation-canvas') || document.getElementById('pdf-canvas'); const r = c.getBoundingClientRect(); return { left: r.left, top: r.top }; });
  const click = async (x, y) => { await p.mouse.move(rect.left + x, rect.top + y, { steps: 3 }); await sleep(120); await p.mouse.down(); await sleep(40); await p.mouse.up(); await sleep(220); };

  // Warm-up: eerste gebaar wordt soms opgeslokt. Klik + Escape + tool herstellen → schone start.
  await click(120, 120); await sleep(150);
  await p.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); await sleep(300);
  await tool('app_set_tool', { tool: 'line' }); await sleep(300);
  const base = (await lineAnns()).length; // negeer wat de warm-up eventueel maakte

  // 4 kliks = 3 aaneengesloten lijnen: P0→P1→P2→P3.
  const P = [[200, 220], [420, 220], [420, 380], [640, 380]];
  for (const [x, y] of P) await click(x, y);
  await sleep(400);

  let L = await lineAnns();
  L = L.slice(base); // alleen de nieuw getekende
  console.log('nieuwe lijnen: ' + JSON.stringify(L.map(l => ({ s: [r1(l.sx), r1(l.sy)], e: [r1(l.ex), r1(l.ey)] }))));
  check('drie aaneengesloten lijnen gemaakt', L.length === 3, `${L.length} lijnen`);
  if (L.length >= 2) check('lijn 2 begint exact op eind lijn 1', Math.abs(L[1].sx - L[0].ex) < 0.01 && Math.abs(L[1].sy - L[0].ey) < 0.01, `L2.s=(${r1(L[1].sx)},${r1(L[1].sy)}) L1.e=(${r1(L[0].ex)},${r1(L[0].ey)})`);
  if (L.length >= 3) check('lijn 3 begint exact op eind lijn 2', Math.abs(L[2].sx - L[1].ex) < 0.01 && Math.abs(L[2].sy - L[1].ey) < 0.01, `L3.s=(${r1(L[2].sx)},${r1(L[2].sy)}) L2.e=(${r1(L[1].ex)},${r1(L[1].ey)})`);
  check('gereedschap blijft lijn tijdens de reeks', (await curTool()) === 'line');

  // Escape stopt de reeks → terug naar select.
  await p.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); await sleep(400);
  check('Escape stopt reeks (terug naar select)', (await curTool()) === 'select');

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
