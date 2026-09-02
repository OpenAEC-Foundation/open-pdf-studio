// Release-poorttest: opslaan verdubbelt geen annotaties — ook niet via
// sluiten-met-opslaan. Aanleiding: de sluitroute wiste de gereedheids-sets
// vóór de opslaan-dialoog, waarna de saver alle bestaande annotaties in het
// bestand liet staan én het model er nog eens bij schreef; elke
// opslag-bij-sluiten verdubbelde zo alle annotaties.
//
// Werkwijze (synthetisch, geen extern bestand nodig):
//  1. nieuw blanco PDF, 3 annotaties, opslaan-als (rondgang-basis)
//  2. heropenen, 1 annotatie erbij, tab sluiten met save:true (MCP-route =
//     zelfde code-pad als de UI-dialoogkeuze "Opslaan")
//  3. nogmaals heropenen + sluiten-met-opslaan zonder wijziging vooraf
//  4. bestand telt exact 4 annotaties, geen twee met dezelfde
//     (subtype, rect) — en het model telt er na heropenen ook 4
//
// Voorwaarden: testrig draait (MCP_PORT default 9223).
// Gebruik: node scripts/verify-opslag-duplicaten.mjs
// Exit 0 = GOED, 1 = MISLUKT.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MCP = 'http://127.0.0.1:' + (process.env.MCP_PORT || '9223') + '/mcp';
const WERK = path.join(os.tmpdir(), 'opds-duplicaat-poort');
const PAD = path.join(WERK, 'duplicaat-poort.pdf').replace(/\\/g, '/');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mcpId = 0;
async function mcp(naam, args = {}) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++mcpId, method: 'tools/call', params: { name: naam, arguments: args } }),
  });
  const j = JSON.parse(await res.text());
  if (j.error) throw new Error(naam + ': ' + (j.error.message || JSON.stringify(j.error)));
  const c = j?.result?.content?.[0];
  if (c?.type === 'text') { try { return JSON.parse(c.text); } catch { return c.text; } }
  return j.result;
}

async function sluitActieveTab(opties) {
  const tabs = await mcp('app_list_tabs', {});
  const idx = tabs?.tabs?.find((t) => t.active)?.index;
  if (idx === undefined) return;
  await mcp('app_close_tab', { index: idx, ...opties });
}

async function telAnnotaties() {
  const l = await mcp('app_list_annotations', {});
  return l?.annotations?.length ?? -1;
}

const fouten = [];
fs.mkdirSync(WERK, { recursive: true });
if (fs.existsSync(PAD)) fs.rmSync(PAD);

// Stap 1: basisbestand met 3 annotaties
await mcp('app_new_blank_pdf', { widthPt: 595, heightPt: 842 });
await sleep(1500);
await mcp('app_create_annotation', { type: 'box', page: 1, props: { x: 50, y: 50, width: 80, height: 40, color: '#cc0000' } });
await mcp('app_create_annotation', { type: 'circle', page: 1, props: { x: 200, y: 120, width: 60, height: 60, color: '#0000cc' } });
await mcp('app_create_annotation', { type: 'textbox', page: 1, props: { x: 60, y: 200, width: 150, height: 30, text: 'duplicaat-poort', color: '#000000' } });
await sleep(800);
await mcp('app_save_pdf', { path: PAD });
await sleep(2000);
await sluitActieveTab({ force: true });
await sleep(800);

// Stap 2: heropenen, +1, sluiten met opslaan
await mcp('app_open_pdf', { path: PAD });
await sleep(3000);
const n1 = await telAnnotaties();
if (n1 !== 3) fouten.push(`na eerste heropenen: ${n1} annotaties (verwacht 3)`);
await mcp('app_create_annotation', { type: 'box', page: 1, props: { x: 300, y: 300, width: 40, height: 40, color: '#00aa00' } });
await sleep(800);
await sluitActieveTab({ save: true });
await sleep(2500);

// Stap 3: heropenen, direct sluiten-met-opslaan na een minimale wijziging
await mcp('app_open_pdf', { path: PAD });
await sleep(3000);
const n2 = await telAnnotaties();
if (n2 !== 4) fouten.push(`na tweede heropenen: ${n2} annotaties (verwacht 4)`);
const lijst = await mcp('app_list_annotations', {});
const eerste = lijst?.annotations?.[0];
if (eerste?.id) await mcp('app_update_annotation', { id: eerste.id, props: { color: '#cc00cc' } });
await sleep(800);
await sluitActieveTab({ save: true });
await sleep(2500);

// Stap 4: eindcontrole in het model én op posities
await mcp('app_open_pdf', { path: PAD });
await sleep(3000);
const eind = await mcp('app_list_annotations', {});
const annots = eind?.annotations || [];
if (annots.length !== 4) fouten.push(`eindstand: ${annots.length} annotaties (verwacht 4)`);
const posities = new Map();
for (const a of annots) {
  const sleutel = `${a.type}@${Math.round(a.x)},${Math.round(a.y)}`;
  posities.set(sleutel, (posities.get(sleutel) || 0) + 1);
}
for (const [sleutel, n] of posities) {
  if (n > 1) fouten.push(`duplicaat op dezelfde positie: ${n}x ${sleutel}`);
}
await sluitActieveTab({ force: true });

if (fouten.length) {
  for (const f of fouten) console.log('FOUT —', f);
  console.log('MISLUKT: opslag-duplicaten-poort');
  process.exit(1);
}
console.log('GOED — geen annotatie-duplicaten bij opslaan of sluiten-met-opslaan');
process.exit(0);
