// Verify the parametricSymbol cross-viewer /AP fix via MCP (CDP not required):
// create several NL/IFC symbols (covering line/arc, text+fill, hatch, profile),
// save, then re-load the PDF with pdf-lib and confirm each symbol annot got an
// /AP appearance stream (+ a Form XObject + an embedded Image).
//
// Usage: node mcp-server/verify-symbol-ap.mjs

import { createRequire } from 'module';
import { readFileSync, existsSync, rmSync } from 'fs';
const require = createRequire(import.meta.url);
const NM = 'C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/';
const { PDFDocument, PDFName, PDFDict } = require(NM + 'pdf-lib');

const MCP = 'http://127.0.0.1:9223/mcp';
const SAVE = 'C:/Users/rickd/AppData/Local/Temp/symbol-ap-test.pdf';

async function tool(name, args) {
  const r = await fetch(MCP, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }) });
  const j = await r.json(); const t = j?.result?.content?.[0]?.text; try { return JSON.parse(t); } catch { return t; }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  await tool('app_new_blank_pdf', {}); await sleep(2500);

  const symbols = [
    { symbolId: 'door',         x: 80,  y: 80,  width: 120, height: 90 },   // line + arc
    { symbolId: 'ifc-space',    x: 300, y: 80,  width: 150, height: 110 },  // text + fill
    { symbolId: 'wandarcering', x: 80,  y: 300, width: 150, height: 110 },  // hatch
    { symbolId: 'staal-koker',  x: 320, y: 300, width: 110, height: 110 },  // profile (rings/fill)
  ];
  let createdOk = 0;
  for (const s of symbols) {
    const r = await tool('app_create_annotation', { type: 'parametricSymbol', page: 1, props: { symbolId: s.symbolId, x: s.x, y: s.y, width: s.width, height: s.height, params: {} } });
    const ok = r && !r.error;
    if (ok) createdOk++;
    console.log(`  create ${s.symbolId}: ${ok ? 'OK' : 'ERR ' + JSON.stringify(r)?.slice(0, 140)}`);
    await sleep(350);
  }
  await sleep(800);

  if (existsSync(SAVE)) rmSync(SAVE);
  const saved = await tool('app_save_pdf', { path: SAVE });
  console.log(`  save: ${JSON.stringify(saved)?.slice(0, 140)}`);
  await sleep(1800);
  if (!existsSync(SAVE)) { console.log('NO FILE saved — check app_save_pdf'); process.exit(2); }

  const bytes = readFileSync(SAVE);
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false });
  const page = pdf.getPages()[0];
  const annots = page.node.Annots();
  let total = 0, symCount = 0, symWithAP = 0;
  const details = [];
  if (annots) {
    for (let i = 0; i < annots.size(); i++) {
      const d = pdf.context.lookup(annots.get(i));
      if (!(d instanceof PDFDict)) continue;
      total++;
      const isSym = !!d.get(PDFName.of('OPS_SymbolId'));
      const hasAP = !!d.get(PDFName.of('AP'));
      if (isSym) { symCount++; if (hasAP) symWithAP++; details.push(`sym ap=${hasAP}`); }
    }
  }
  // Count embedded Image + Form XObjects across the doc (sanity: one each per symbol).
  let imgX = 0, formX = 0;
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict) {
      const st = obj.get(PDFName.of('Subtype'));
      const s = st && st.toString();
      if (s === '/Image') imgX++;
      else if (s === '/Form') formX++;
    }
  }
  console.log(`\nsaved PDF: ${bytes.length} bytes | annots=${total} | parametricSymbols=${symCount} | withAP=${symWithAP}`);
  console.log(`XObjects: Image=${imgX}, Form=${formX}`);
  const pass = createdOk > 0 && symCount === createdOk && symWithAP === symCount && imgX >= symCount;
  console.log(`VERDICT: ${pass ? 'ALL parametricSymbols got a raster /AP ✓' : 'symbols MISSING /AP ✗'}`);
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('PROBE_ERR:', e.message); process.exit(1); });
