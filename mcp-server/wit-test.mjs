// Objectieve wit-pagina-test voor Originele/Technische tekening.pdf p1:
// telt niet-witte pixels op het canvas binnen het paginagebied + vangt
// paint-exceptions. Exit-print: INHOUD of WIT.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const playwright = require('C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/playwright');
const MCP = 'http://127.0.0.1:9223/mcp';
async function tool(name, args) {
  const r = await fetch(MCP, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }) });
  const j = await r.json(); const t = j?.result?.content?.[0]?.text; try { return JSON.parse(t); } catch { return t; }
}
(async () => {
  const b = await playwright.chromium.connectOverCDP('http://localhost:9222');
  const page = b.contexts()[0].pages()[0];
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 9000));
  await tool('app_open_pdf', { path: 'C:/Users/rickd/Documents/GitHub/open-pdf-studio/test pdf-bestanden/Originele bestanden/Technische tekening.pdf' });
  await new Promise((r) => setTimeout(r, 8000));
  const r = await page.evaluate(() => {
    const c = document.getElementById('pdf-canvas');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(Math.round(c.width * 0.25), Math.round(c.height * 0.25), Math.round(c.width * 0.5), Math.round(c.height * 0.5)).data;
    let nonwhite = 0;
    for (let i = 0; i < d.length; i += 40) {
      if (d[i + 3] > 200 && (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235)) nonwhite++;
    }
    return { nonwhite, sampled: Math.floor(d.length / 40) };
  });
  console.log(r.nonwhite > 50 ? 'INHOUD' : 'WIT', JSON.stringify(r), 'errors:', JSON.stringify(errs.slice(0, 3)));
  await b.close();
})().catch((e) => console.error('ERR', e.message));
