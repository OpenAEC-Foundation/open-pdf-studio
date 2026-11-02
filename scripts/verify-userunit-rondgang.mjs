// Release gate: annotations keep their place on a page with /UserUnit, also
// after saving and reopening several times. /Rect and the app space count page
// units, while a PDF.js viewport multiplies by the /UserUnit. Read through that
// viewport, each save and reopen doubled the coordinates on a /UserUnit 2 page.
//
// Works on its own generated file, in a temp folder:
//  1. a PDF with /UserUnit 2 on page 1, none on page 2, and an annotation from
//     outside the app on both pages
//  2. the outside annotation lands on its /Rect at the first opening
//  3. annotations made in the app keep their place through 3 rounds of adding
//     one more, saving and reopening
//  4. in the file itself every /Rect is still the expected one, and no
//     annotation is duplicated
//
// Requires: test rig running (MCP_PORT, default 9223).
// Usage: node scripts/verify-userunit-rondgang.mjs
// Exit 0 = pass, 1 = fail.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const vereist = createRequire(new URL('../open-pdf-studio/package.json', import.meta.url));
const { PDFDocument, PDFName, PDFArray, PDFNumber } = vereist('pdf-lib');

const MCP = 'http://127.0.0.1:' + (process.env.MCP_PORT || '9223') + '/mcp';
const WERK = path.join(os.tmpdir(), 'opds-userunit-poort');
const PAD = path.join(WERK, 'userunit-poort.pdf').split(path.sep).join('/');
const HOOGTE = 600;
const RONDES = 3;
const MARGE = 0.51;

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

const fouten = [];
function controleer(ok, tekst) {
  console.log(`${ok ? 'GOED   ' : 'MISLUKT'} ${tekst}`);
  if (!ok) fouten.push(tekst);
}

async function maakBestand() {
  const doc = await PDFDocument.create();
  const eenheden = [2, null];
  for (const uu of eenheden) {
    const pagina = doc.addPage([400, HOOGTE]);
    if (uu) pagina.node.set(PDFName.of('UserUnit'), doc.context.obj(uu));
    const vierkant = doc.context.obj({
      Type: 'Annot', Subtype: 'Square', Rect: [100, 200, 180, 260], C: [1, 0, 0], F: 4,
    });
    pagina.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(vierkant)]));
  }
  fs.writeFileSync(PAD, await doc.save());
}

async function sluit() {
  const tabs = await mcp('app_list_tabs', {});
  const index = tabs?.tabs?.find((t) => t.active)?.index;
  if (index !== undefined) await mcp('app_close_tab', { index, force: true });
  await sleep(800);
}

async function open() {
  const r = await mcp('app_open_pdf', { path: PAD });
  if (!r?.ok) throw new Error('openen mislukt: ' + JSON.stringify(r).slice(0, 200));
  for (const pagina of [2, 1]) {
    await mcp('app_go_to_page', { page: pagina });
    await sleep(1200);
  }
}

const vakVan = (a) => [a.x, a.y, a.width, a.height].map(Number);
const lijst = async () => (await mcp('app_list_annotations', {}))?.annotations ?? [];
const gelijk = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= MARGE);

async function rectsInBestand() {
  const doc = await PDFDocument.load(fs.readFileSync(PAD));
  return doc.getPages().map((pagina) => {
    const annots = pagina.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) return [];
    const uit = [];
    for (let i = 0; i < annots.size(); i++) {
      const rect = annots.lookup(i)?.lookup?.(PDFName.of('Rect'));
      if (rect instanceof PDFArray) {
        uit.push([0, 1, 2, 3].map((j) => { const n = rect.lookup(j); return n instanceof PDFNumber ? n.asNumber() : NaN; }));
      }
    }
    return uit;
  });
}

fs.mkdirSync(WERK, { recursive: true });
await maakBestand();
await open();

// De annotatie van buiten de app, zonder dat de app het bestand ooit schreef.
const verwachtVierkant = [100, HOOGTE - 260, 80, 60];
const eerste = await lijst();
for (const p of [1, 2]) {
  const a = eerste.find((x) => x.page === p);
  controleer(a && gelijk(vakVan(a), verwachtVierkant),
    `pagina ${p}: annotatie van buiten staat bij de eerste keer openen op zijn /Rect (${a ? vakVan(a).join(', ') : 'niet gevonden'})`);
}

// Annotaties uit de app, per ronde één erbij op beide pagina's.
const verwacht = { 1: [verwachtVierkant], 2: [verwachtVierkant] };
for (let ronde = 1; ronde <= RONDES; ronde++) {
  for (const p of [1, 2]) {
    const vak = [40 + ronde * 20, 40 + ronde * 30, 50, 20];
    await mcp('app_create_annotation', { type: 'box', page: p, props: { x: vak[0], y: vak[1], width: vak[2], height: vak[3], color: '#0000cc' } });
    verwacht[p].push(vak);
  }
  await sleep(600);
  const opslag = await mcp('app_save_pdf', { path: PAD });
  if (opslag?.ok === false) throw new Error('opslaan mislukt: ' + JSON.stringify(opslag).slice(0, 200));
  await sleep(1800);
  await sluit();
  await open();

  const nu = await lijst();
  for (const p of [1, 2]) {
    const vakken = nu.filter((a) => a.page === p).map(vakVan);
    controleer(vakken.length === verwacht[p].length, `ronde ${ronde}, pagina ${p}: ${vakken.length} annotaties, verwacht ${verwacht[p].length}`);
    for (const vak of verwacht[p]) {
      controleer(vakken.some((v) => gelijk(v, vak)), `ronde ${ronde}, pagina ${p}: annotatie op ${vak.join(', ')} in [${vakken.map((v) => v.join(' ')).join(' | ')}]`);
    }
  }
  const rects = await rectsInBestand();
  for (const p of [1, 2]) {
    for (const [x, y, b, h] of verwacht[p]) {
      const r = [x, HOOGTE - y - h, x + b, HOOGTE - y];
      controleer(rects[p - 1].some((q) => gelijk(q, r)), `ronde ${ronde}, pagina ${p}: /Rect ${r.join(' ')} staat in het bestand`);
    }
    controleer(rects[p - 1].length === verwacht[p].length, `ronde ${ronde}, pagina ${p}: ${rects[p - 1].length} annotaties in het bestand, verwacht ${verwacht[p].length}`);
  }
}

await sluit();
console.log(fouten.length ? `\nMISLUKT: ${fouten.length} controles` : '\nGOED');
process.exit(fouten.length ? 1 : 0);
