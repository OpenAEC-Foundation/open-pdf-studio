// Verplichte release-poorttest: tekstrotatie overleeft de opslag-rondgang.
//
// Achtergrond: geroteerde tekstvakken zijn meermaals stukgegaan rond releases
// (tekst plat in een AABB-doos na heropenen). Deze test borgt twee dingen:
//   1. REFERENTIE: een door een eerdere generatie opgeslagen bestand
//      ("test pdf-bestanden/tekstrotatie-referentie.pdf", tekstvakken op
//      0/90/-90/45/-55 graden) laadt met de juiste rotaties.
//   2. RONDGANG: de huidige build maakt zelf geroteerde tekstvakken, slaat op,
//      heropent, en de rotaties (en afmetingen) zijn intact.
//
// Voorwaarden: testrig draait (--mcp-server; MCP op poort 9223 of via
// MCP_PORT). Gebruik:
//   node scripts/verify-tekstrotatie.mjs
// Exit 0 = GOED, exit 1 = MISLUKT (met details op stdout).

const POORT = process.env.MCP_PORT || '9223';
const MCP = `http://127.0.0.1:${POORT}/mcp`;
const REFERENTIE = (process.env.ROTATIE_REF
  || 'C:/Users/rickd/Documents/GitHub/open-pdf-studio/test pdf-bestanden/tekstrotatie-referentie.pdf').replace(/\\/g, '/');
const EXTERN = (process.env.ROTATIE_EXTERN
  || 'C:/Users/rickd/Documents/GitHub/open-pdf-studio/test pdf-bestanden/tekstrotatie-extern.pdf').replace(/\\/g, '/');
const RONDGANG_UIT = 'C:/Users/rickd/AppData/Local/Temp/tekstrotatie-rondgang-uit.pdf';
const HOEKEN = [0, 90, -90, 45, -55];
const TOLERANTIE = 1; // graden

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

// app_list_annotations verzwijgt het rotatieveld — per annotatie ophalen.
async function volledigeLijst() {
  const l = await mcp('app_list_annotations', {});
  const uit = [];
  for (const a of (l?.annotations || l || [])) {
    const g = await mcp('app_get_annotation', { id: a.id });
    const ann = g?.annotation || g;
    uit.push({ id: ann.id, type: ann.type, rot: ann.rotation ?? 0, tekst: ann.text, w: ann.width, h: ann.height });
  }
  return uit;
}

function controleer(label, lijst, fouten) {
  for (const hoek of HOEKEN) {
    const verwacht = `rot ${hoek}`;
    const ann = lijst.find((x) => x.tekst === verwacht);
    if (!ann) { fouten.push(`${label}: '${verwacht}' ontbreekt`); continue; }
    let delta = Math.abs((ann.rot || 0) - hoek) % 360;
    if (delta > 180) delta = 360 - delta;
    if (delta > TOLERANTIE) fouten.push(`${label}: '${verwacht}' rotatie ${ann.rot} (verwacht ${hoek})`);
    // Doosafmetingen mogen niet stilletjes de AABB van de rotatie worden.
    if (ann.w != null && Math.abs(ann.w - 140) > 3) fouten.push(`${label}: '${verwacht}' breedte ${ann.w} (verwacht ~140 — AABB-reconstructie?)`);
    if (ann.h != null && Math.abs(ann.h - 34) > 3) fouten.push(`${label}: '${verwacht}' hoogte ${ann.h} (verwacht ~34)`);
  }
}

const fouten = [];

// ── Deel 1: referentiebestand van een eerdere generatie ─────────────────────
console.log('deel 1: referentie openen —', REFERENTIE.split('/').pop());
await mcp('app_open_pdf', { path: REFERENTIE });
await sleep(3500);
controleer('referentie', await volledigeLijst(), fouten);

// ── Deel 1b: extern aangemaakt bestand (rotatie in de AP-/Matrix) ───────────
// Conventie van een externe editor: /Rotation-metadata + rotatie volledig in
// de appearance-/Matrix (content-stream zonder rotatie-cm, Rect = AABB).
// Regressie die hierop is gevangen: de AP-guard nulde de rotatie omdat de
// content geen rotatie-operator bevat — labels kwamen plat binnen.
console.log('deel 1b: extern bestand openen —', EXTERN.split('/').pop());
await mcp('app_open_pdf', { path: EXTERN });
await sleep(3500);
{
  const lijst = await volledigeLijst();
  const verwachtExtern = [
    { rot: 0, n: 2 },     // twee ongeroteerde vakken
    { rot: -60, n: 1 },
    { rot: -120, n: 1 },
  ];
  for (const v of verwachtExtern) {
    const gevonden = lijst.filter((x) => {
      let d = Math.abs((x.rot || 0) - v.rot) % 360;
      if (d > 180) d = 360 - d;
      return d <= TOLERANTIE;
    }).length;
    if (gevonden < v.n) fouten.push(`extern: ${v.n}x rotatie ${v.rot} verwacht, ${gevonden} gevonden (${JSON.stringify(lijst.map((x) => x.rot))})`);
  }
  // Doosmaten: origineel ~120x18, niet de AABB (~76x113).
  const geroteerd = lijst.filter((x) => Math.abs(x.rot || 0) > 1);
  for (const g of geroteerd) {
    if (g.w != null && Math.abs(g.w - 120) > 5) fouten.push(`extern: rot ${g.rot} breedte ${g.w} (verwacht ~120 — AABB-reconstructie?)`);
  }
}

// ── Deel 2: eigen rondgang met de huidige build ─────────────────────────────
console.log('deel 2: eigen rondgang (aanmaken → opslaan → heropenen)');
await mcp('app_new_blank_pdf', { pages: 1, widthPt: 595, heightPt: 842 });
await sleep(1500);
for (let i = 0; i < HOEKEN.length; i++) {
  const hoek = HOEKEN[i];
  const r = await mcp('app_create_annotation', {
    page: 1,
    type: 'text',
    props: { x: 60 + i * 100, y: 120 + i * 120, width: 140, height: 34, text: `rot ${hoek}`, fontSize: 14, color: '#cc0000' },
  });
  const aid = r?.id || r?.annotation?.id;
  if (hoek && aid) await mcp('app_update_annotation', { id: aid, props: { rotation: hoek } });
}
await sleep(500);
controleer('vóór opslaan', await volledigeLijst(), fouten);
await mcp('app_save_pdf', { path: RONDGANG_UIT });
await sleep(1500);
await mcp('app_open_pdf', { path: RONDGANG_UIT });
await sleep(3500);
controleer('na heropenen', await volledigeLijst(), fouten);

if (fouten.length) {
  for (const f of fouten) console.log('FOUT —', f);
  console.log(`MISLUKT: ${fouten.length} afwijkingen`);
  process.exit(1);
}
console.log('GOED — tekstrotaties intact (referentie + extern bestand + rondgang)');
process.exit(0);
