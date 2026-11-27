// Gehoste deuren en ramen in de app (#1229): de echte state-store en de echte
// undo-stapel, met de haak die elke stap langs de hosting leidt. De modules
// draaien onder node met de laadhaken van de app (zie
// core/app-test-hooks.mjs); alleen het tekenen is een stub.
//
// Elke test speelt een handeling na zoals de app haar uitvoert: het
// gereedschap of de MCP-opdracht plaatst (app_floorplan), slepen wijzigt de
// annotatie en legt daarna één stap vast, verwijderen gaat via
// deleteAnnotationsWithUndo. Daarna telt de test de stappen in de
// geschiedenis en maakt hij ongedaan.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.ts');
const undo = await import('../core/undo-manager.js');
const { createAnnotation, cloneAnnotation } = await import('../annotations/factory.js');
const { deleteAnnotationsWithUndo } = await import('../annotations/mutations.js');
const haak = await import('./hosting-haak.js');
const { plattegrondOpdracht } = await import('./mcp-plattegrond.js');
const { hartVanSymbool } = await import('./gehoste-opening.js');
const { openingIntervallen } = await import('../annotations/wand-openingen.js');
const { sluitVlakHoeken } = await import('./wand-tekenen.js');
const { isImperiaalBladOpPunt } = await import('./blad-conventie-op-punt.js');
const { pxPerMmAt } = await import('../symbols/real-size.js');
const { getTemplate } = await import('../symbols/registry.js');

const K = 0.5;                                    // paginapunten per mm
const kloon = (x) => JSON.parse(JSON.stringify(x));
const bijna = (a, b, wat, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${wat}: ${a} ≈ ${b}`);

function openen(annotations = []) {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations,
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {},
    measureScale: { pixelsPerUnit: K, unit: 'mm' },
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

/** De app-kant van app_floorplan, zoals plattegrondInApp in mcp-bridge.js. */
function omgeving(doc) {
  return {
    doc: { currentPage: 1, annotations: doc.annotations, paginas: 1 },
    pxPerMmAt: () => K,
    async maak(type, page, props) {
      const ann = createAnnotation({ ...props, type, page });
      doc.annotations.push(ann);
      undo.recordAdd(ann, { copy: true });
      return { ok: true, id: ann.id };
    },
    async werkBij(id, props) {
      const ann = doc.annotations.find((a) => a.id === id);
      const oud = cloneAnnotation(ann);
      Object.assign(ann, props);
      undo.recordModify(id, oud, ann);
      return { ok: true };
    },
    async transactie(fn) {
      undo.beginUndoTransaction();
      try { await fn(); } finally { undo.endUndoTransaction(); }
    },
  };
}

/** Een wand van 8000 mm langs y = 300 met (standaard) een deur op 3000 mm. */
async function tekening(openingen = [{ kind: 'door', widthMm: 900, alongMm: 3000 }]) {
  await haak.laadHostingKern();
  const doc = openen();
  const o = omgeving(doc);
  const r = await plattegrondOpdracht({
    action: 'wall', start: { x: 0, y: 300 }, end: { x: 4000, y: 300 }, thicknessMm: 200, material: 'nen47-metselwerk-kunststeen',
  }, o);
  const ids = [];
  for (const opening of openingen) {
    const p = await plattegrondOpdracht({ action: 'opening', wallId: r.wallIds[0], ...opening }, o);
    assert.equal(p.ok, true, p.error);
    ids.push(p.openingId);
  }
  const wand = () => doc.annotations.find((a) => a.id === r.wallIds[0]);
  const kozijn = (i = 0) => doc.annotations.find((a) => a.id === ids[i]);
  return { doc, o, wand, kozijn, ids };
}

/** Een annotatie wijzigen zoals slepen dat doet: muteren, dan één stap vastleggen. */
function sleep(doc, ann, muteer) {
  const oud = cloneAnnotation(ann);
  muteer(ann);
  undo.recordModify(ann.id, oud, ann);
}
const stappen = (doc) => doc.undoStack.length;
/** Het hart van het kozijn langs en dwars op de wand, in mm. */
function opWand(kozijn, wand) {
  const hart = hartVanSymbool(kozijn, K, wand.dikteMm);
  const len = Math.hypot(wand.endX - wand.startX, wand.endY - wand.startY);
  const u = { x: (wand.endX - wand.startX) / len, y: (wand.endY - wand.startY) / len };
  return {
    langs: ((hart.x - wand.startX) * u.x + (hart.y - wand.startY) * u.y) / K,
    dwars: ((hart.x - wand.startX) * -u.y + (hart.y - wand.startY) * u.x) / K,
  };
}
const gaten = (wand) => openingIntervallen(Math.hypot(wand.endX - wand.startX, wand.endY - wand.startY), wand.openingen, K)
  .map((i) => [Math.round(i.t0 / K), Math.round(i.t1 / K)]);

test('een deur plaatsen laat één wand-annotatie over, in één ongedaan-stap', async () => {
  const { doc, wand, kozijn } = await tekening();
  assert.equal(doc.annotations.filter((a) => a.type === 'wall').length, 1, 'een wand, niet twee');
  assert.equal(doc.annotations.length, 2);
  assert.deepEqual(gaten(wand()), [[2550, 3450]]);
  assert.equal(kozijn().params.hostWallId, wand().id);
  assert.equal(stappen(doc), 2, 'de wand tekenen en de deur plaatsen: elk een stap');
  // Ongedaan maken haalt de deur weg en sluit de wand.
  await undo.undo();
  assert.deepEqual(doc.annotations.map((a) => a.type), ['wall']);
  assert.equal(wand().openingen, undefined);
  await undo.redo();
  assert.equal(doc.annotations.length, 2);
  assert.deepEqual(gaten(wand()), [[2550, 3450]]);
});

test('de deur 1 m langs de wand slepen: het gat gaat 1 m mee, de oude plek is weer wand', async () => {
  const { doc, wand, kozijn } = await tekening();
  const voor = stappen(doc);
  sleep(doc, kozijn(), (a) => { a.x += 1000 * K; });
  assert.deepEqual(gaten(wand()), [[3550, 4450]], 'het gat schoof 1000 mm op; op 2550..3450 is weer wand');
  bijna(opWand(kozijn(), wand()).langs, 4000, 'het kozijn staat in het gat');
  assert.equal(stappen(doc), voor + 1, 'één stap');
  await undo.undo();
  assert.deepEqual(gaten(wand()), [[2550, 3450]]);
  bijna(opWand(kozijn(), wand()).langs, 3000, 'terug');
  await undo.redo();
  assert.deepEqual(gaten(wand()), [[3550, 4450]]);
  bijna(opWand(kozijn(), wand()).langs, 4000, 'opnieuw');
});

test('de deur van de wand af slepen houdt haar op de wandlijn', async () => {
  const { doc, wand, kozijn } = await tekening();
  const voor = stappen(doc);
  sleep(doc, kozijn(), (a) => { a.x += 250; a.y += 600; });
  const plek = opWand(kozijn(), wand());
  bijna(plek.dwars, 0, 'op de hartlijn');
  bijna(plek.langs, 3500, '500 mm langs de wand');
  assert.equal(stappen(doc), voor + 1);
  // Alleen dwars slepen is geen stap: er verandert niets.
  const y = kozijn().y;
  sleep(doc, kozijn(), (a) => { a.y -= 900; });
  assert.equal(kozijn().y, y);
  assert.equal(stappen(doc), voor + 1, 'geen lege stap in de geschiedenis');
});

test('de wand 500 mm verplaatsen neemt de deur 500 mm mee; 90 graden draaien draait haar mee', async () => {
  const { doc, wand, kozijn } = await tekening();
  const voor = stappen(doc);
  const hart = hartVanSymbool(kozijn(), K, 200);
  sleep(doc, wand(), (a) => { a.startY += 250; a.endY += 250; });
  const na = hartVanSymbool(kozijn(), K, 200);
  bijna(na.y - hart.y, 250, 'de deur ging 500 mm mee');
  bijna(na.x - hart.x, 0, 'niet opzij');
  assert.equal(stappen(doc), voor + 1, 'één stap voor wand en deur samen');
  await undo.undo();
  bijna(hartVanSymbool(kozijn(), K, 200).y, hart.y, 'ongedaan: de deur staat terug');
  bijna(wand().startY, 300, 'en de wand ook');

  // Draaien om het beginpunt: het eind van (4000, 300) naar (0, 4300).
  const hoek = kozijn().rotation;
  sleep(doc, wand(), (a) => { a.endX = 0; a.endY = 4300; });
  bijna((((kozijn().rotation - hoek) % 360) + 360) % 360, 90, 'de deur draaide 90 graden mee');
  const gedraaid = hartVanSymbool(kozijn(), K, 200);
  bijna(gedraaid.x, 0, 'op de gedraaide wand');
  bijna(gedraaid.y, 300 + 1500, '3000 mm van het begin');
  assert.equal(stappen(doc), voor + 1);
});

test('de wand korter maken dan de deur staat schuift de deur terug zodat ze past', async () => {
  const { doc, wand, kozijn } = await tekening();
  const voor = stappen(doc);
  sleep(doc, wand(), (a) => { a.endX = 1500; });                // 3000 mm lang; de deur stond op 3000
  assert.deepEqual(gaten(wand()), [[2100, 3000]]);
  bijna(opWand(kozijn(), wand()).langs, 2550, 'de deur schoof terug');
  assert.equal(stappen(doc), voor + 1);
  await undo.undo();
  assert.deepEqual(gaten(wand()), [[2550, 3450]]);
  bijna(opWand(kozijn(), wand()).langs, 3000, 'ongedaan');
});

test('wand en deur samen slepen: de deur houdt haar plaats op de wand', async () => {
  const { doc, wand, kozijn } = await tekening();
  const voor = stappen(doc);
  const origineel = [cloneAnnotation(wand()), cloneAnnotation(kozijn())];
  wand().startX += 120; wand().endX += 120; wand().startY += 80; wand().endY += 80;
  kozijn().x += 120; kozijn().y += 80;
  undo.recordBulkModify([wand(), kozijn()], origineel);
  assert.deepEqual(gaten(wand()), [[2550, 3450]]);
  bijna(opWand(kozijn(), wand()).langs, 3000, 'zelfde plaats op de wand');
  bijna(opWand(kozijn(), wand()).dwars, 0, 'op de wand');
  assert.equal(stappen(doc), voor + 1);
});

test('de deur verwijderen sluit de wand; Ctrl+Z brengt de deur en het gat terug', async () => {
  const { doc, wand, kozijn, ids } = await tekening();
  const voor = stappen(doc);
  doc.selectedAnnotations = [kozijn()];
  deleteAnnotationsWithUndo(doc, [kozijn()]);
  assert.deepEqual(doc.annotations.map((a) => a.type), ['wall'], 'geen resten');
  assert.equal(wand().openingen, undefined, 'de wand is dicht');
  assert.deepEqual(gaten(wand()), []);
  assert.equal(stappen(doc), voor + 1, 'één stap');
  await undo.undo();
  assert.equal(doc.annotations.length, 2);
  assert.equal(doc.annotations.find((a) => a.id === ids[0]).symbolId, 'door');
  assert.deepEqual(gaten(wand()), [[2550, 3450]]);
  await undo.redo();
  assert.equal(doc.annotations.length, 1);
  assert.deepEqual(gaten(wand()), []);
});

test('de wand verwijderen neemt haar deur en raam mee; Ctrl+Z zet alles terug', async () => {
  const { doc, wand, ids } = await tekening([
    { kind: 'door', widthMm: 900, alongMm: 3000 }, { kind: 'window', widthMm: 1200, alongMm: 6000 },
  ]);
  const voor = stappen(doc);
  const inhoud = kloon(doc.annotations);
  doc.selectedAnnotations = [wand()];
  deleteAnnotationsWithUndo(doc, [wand()]);
  assert.equal(state.documents[0].annotations.length, 0, 'de wand en haar twee kozijnen zijn weg');
  assert.equal(stappen(doc), voor + 1, 'in dezelfde stap');
  assert.deepEqual(state.documents[0].selectedAnnotations.length <= 1, true);
  await undo.undo();
  assert.deepEqual(kloon(state.documents[0].annotations), inhoud, 'alles terug, in de oude volgorde');
  assert.deepEqual(state.documents[0].annotations.map((a) => a.id).slice(1), ids);
  await undo.redo();
  assert.equal(state.documents[0].annotations.length, 0);
});

test('een tweede deur die de eerste overlapt wordt geweigerd; er komt geen stap bij', async () => {
  const { doc, o, wand } = await tekening();
  const voor = stappen(doc);
  const inhoud = kloon(doc.annotations);
  const r = await plattegrondOpdracht({ action: 'opening', wallId: wand().id, kind: 'door', widthMm: 900, alongMm: 3400 }, o);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'overlap');
  assert.deepEqual(kloon(doc.annotations), inhoud, 'niets veranderd');
  assert.equal(stappen(doc), voor);
});

test('een andere wanddikte of kozijnmaat uit het eigenschappenpaneel werkt door, in dezelfde stap', async () => {
  const { doc, wand, kozijn } = await tekening();
  const voor = stappen(doc);
  // Het paneel legt een wijziging vertraagd vast (recordPropertyChange).
  undo.recordPropertyChange(wand());
  wand().dikteMm = 300;
  undo.flushPropertyChange();
  assert.equal(kozijn().params.wallThickness, 300, 'het kozijn is net zo diep als de wand');
  assert.equal(stappen(doc), voor + 1);
  undo.recordPropertyChange(kozijn());
  kozijn().params = { ...kozijn().params, width: 1100 };
  undo.flushPropertyChange();
  assert.deepEqual(gaten(wand()), [[2450, 3550]], 'het gat is nu 1100 breed, om hetzelfde hart');
  assert.equal(stappen(doc), voor + 2);
  await undo.undo();
  assert.deepEqual(gaten(wand()), [[2550, 3450]]);
  assert.equal(kozijn().params.width, 900);
});

test('tijdens het slepen loopt het gat mee en eindigt het in één stap', async () => {
  const { doc, wand, kozijn } = await tekening();
  const voor = stappen(doc);
  doc.selectedAnnotations = [kozijn()];
  const origineel = cloneAnnotation(kozijn());
  for (const dx of [50, 200, 400]) {
    Object.assign(kozijn(), cloneAnnotation(origineel));
    kozijn().x += dx; kozijn().y += dx / 2;
    haak.hostingTijdensSleep(doc);
    bijna(opWand(kozijn(), wand()).dwars, 0, 'blijft op de wand');
    assert.deepEqual(gaten(wand()), [[2550 + dx / K, 3450 + dx / K]], 'het gat loopt mee');
  }
  undo.recordModify(kozijn().id, origineel, kozijn());
  assert.equal(stappen(doc), voor + 1);
  await undo.undo();
  assert.deepEqual(gaten(wand()), [[2550, 3450]], 'ongedaan zet ook het gat terug');
  bijna(opWand(kozijn(), wand()).langs, 3000, 'en de deur');
});

test('een wand die op een vlak wordt getekend en de hoek sluit, neemt de openingen van de bijgestelde wand mee (#1230)', async () => {
  // De deur staat tegen het eind van de wand: 7100..8000 mm.
  const { doc, wand, kozijn } = await tekening([{ kind: 'door', widthMm: 900, alongMm: 7550 }]);
  const voor = stappen(doc);
  const inhoud = kloon(doc.annotations);
  // Een nieuwe wand van 200 mm, getekend op haar rechtervlak vanaf de
  // onderhoek (4000, 350) van het eind van de bestaande wand, naar beneden.
  // Haar hartlijn ligt 50 pt links van de geklikte lijn.
  const nieuw = createAnnotation({
    type: 'wall', page: 1, startX: 3950, startY: 350, endX: 3950, endY: 2000, dikteMm: 200, hatchPattern: 'none',
  });
  const hoeken = sluitVlakHoeken(nieuw, { x: 4000, y: 350 }, doc.annotations);
  assert.ok(hoeken, 'de hoek wordt gesloten');
  assert.deepEqual(hoeken.geraakt.map((w) => w.id), [wand().id]);
  // Zoals het wandgereedschap: de nieuwe wand en de bijgestelde uiteinden in één stap.
  doc.annotations.push(nieuw);
  undo.beginUndoTransaction();
  try {
    undo.recordAdd(nieuw);
    undo.recordBulkModify(hoeken.geraakt, hoeken.voor);
  } finally {
    undo.endUndoTransaction();
  }
  assert.equal(wand().endX, 3950, 'het eind van de bestaande wand ging naar de hoek van de hartlijnen');
  assert.deepEqual(gaten(wand()), [[7000, 7900]], 'de deur schoof mee terug: de wand is 100 mm korter');
  bijna(opWand(kozijn(), wand()).langs, 7450, 'het kozijn staat in het gat');
  bijna(opWand(kozijn(), wand()).dwars, 0, 'op de wand');
  assert.equal(stappen(doc), voor + 1, 'alles in één ongedaan-stap');
  await undo.undo();
  assert.deepEqual(kloon(doc.annotations), inhoud, 'ongedaan: de wand, het gat en de deur zoals ze waren');
});

test('op een blad in voet (1/4" = 1\'-0") komt een deur van 36 inch en een raam van 48 inch met het Amerikaanse symbool (#1230)', async () => {
  await haak.laadHostingKern();
  const doc = openen();
  // 1/4 inch op papier is 1 voet: 18 paginapunten per voet.
  doc.measureScale = { pixelsPerUnit: 18, unit: 'ft' };
  const k = 18 / 304.8;
  bijna(pxPerMmAt(1, 100, 300), k, 'de schaal van het blad');
  assert.equal(isImperiaalBladOpPunt(1, 100, 300), true);
  // De app-kant zoals plattegrondInApp haar levert: schaal en conventie op het punt.
  const o = {
    ...omgeving(doc),
    pxPerMmAt: (page, x, y) => pxPerMmAt(page, x, y),
    imperiaalOp: (page, x, y) => isImperiaalBladOpPunt(page, x, y),
  };
  // Een wand van 20 voet zonder verdere opgave: 6 inch, geen arcering.
  const w = await plattegrondOpdracht({ action: 'wall', start: { x: 100, y: 300 }, end: { x: 460, y: 300 } }, o);
  const wand = () => doc.annotations.find((a) => a.id === w.wallIds[0]);
  assert.deepEqual([wand().dikteMm, wand().hatchPattern], [152.4, 'none']);
  const voor = stappen(doc);
  // De deur: geklikt op 5 voet van het begin, net onder de hartlijn.
  const d = await plattegrondOpdracht({ action: 'opening', wallId: wand().id, kind: 'door', point: { x: 190, y: 303 } }, o);
  assert.equal(d.ok, true, d.error);
  assert.deepEqual([d.widthMm, d.symbolStyle, d.openSide], [914.4, 'us', 'right']);
  const deur = () => doc.annotations.find((a) => a.id === d.openingId);
  assert.equal(deur().params.symboolStijl, 'us');
  // Blad en draaicirkel, geen stijlen.
  const tekening = getTemplate('door').render(deur().params, { x: deur().x, y: deur().y, width: deur().width, height: deur().height });
  assert.deepEqual(tekening.map((c) => c.kind), ['polyline', 'arc']);
  bijna(deur().width, 36 * 18 / 12, 'het vak is 36 inch breed op het blad (54 pt)');
  // Het raam, 48 inch.
  const r = await plattegrondOpdracht({ action: 'opening', wallId: wand().id, kind: 'window', point: { x: 370, y: 300 } }, o);
  assert.deepEqual([r.widthMm, r.symbolStyle], [1219.2, 'us']);
  const raam = doc.annotations.find((a) => a.id === r.openingId);
  assert.deepEqual(getTemplate('window').render(raam.params, { x: raam.x, y: raam.y, width: raam.width, height: raam.height }).map((c) => c.kind),
    ['line', 'line', 'line', 'line', 'line'], 'twee wandvlakken, twee dagkanten, een glaslijn');
  bijna(raam.width, 48 * 18 / 12, 'het raam is 48 inch breed (72 pt)');
  bijna(raam.height, 6 * 18 / 12, 'en de wand van 6 inch diep (9 pt)');
  assert.equal(stappen(doc), voor + 2, 'elke opening een ongedaan-stap');
  // Een getypte breedte: 32 inch (zoals het gereedschap haar doorgeeft).
  const smal = await plattegrondOpdracht({ action: 'opening', wallId: wand().id, kind: 'door', widthMm: 812.8, point: { x: 280, y: 297 } }, o);
  assert.deepEqual([smal.widthMm, smal.symbolStyle, smal.openSide], [812.8, 'us', 'left']);
  // Slepen houdt de deur op de wand en het symbool Amerikaans; ongedaan maken zet haar terug.
  const plek = wand().openingen.find((x) => x.id === d.openingId).afstandMm;
  sleep(doc, deur(), (a) => { a.x += 18; a.y += 40; });                 // 1 voet langs de wand
  bijna(wand().openingen.find((x) => x.id === d.openingId).afstandMm, plek + 304.8, 'het gat ging een voet mee');
  assert.equal(deur().params.symboolStijl, 'us');
  await undo.undo();
  bijna(wand().openingen.find((x) => x.id === d.openingId).afstandMm, plek, 'ongedaan');
});

test('op een metrisch blad (1:50) geven dezelfde stappen de metrische uitkomst (#1230, punt 8)', async () => {
  await haak.laadHostingKern();
  const doc = openen();
  doc.measureScale = { pixelsPerUnit: 2.8346 / 50, unit: 'mm' };
  assert.equal(isImperiaalBladOpPunt(1, 100, 300), false);
  const o = {
    ...omgeving(doc),
    pxPerMmAt: (page, x, y) => pxPerMmAt(page, x, y),
    imperiaalOp: (page, x, y) => isImperiaalBladOpPunt(page, x, y),
  };
  const w = await plattegrondOpdracht({ action: 'wall', start: { x: 100, y: 300 }, end: { x: 460, y: 300 } }, o);
  const wand = doc.annotations.find((a) => a.id === w.wallIds[0]);
  assert.deepEqual([wand.dikteMm, wand.hatchPattern], [100, 'nen47-metselwerk-baksteen']);
  const d = await plattegrondOpdracht({ action: 'opening', wallId: wand.id, kind: 'door', point: { x: 190, y: 303 } }, o);
  const r = await plattegrondOpdracht({ action: 'opening', wallId: wand.id, kind: 'window', point: { x: 370, y: 300 } }, o);
  assert.deepEqual([d.widthMm, d.symbolStyle, r.widthMm, r.symbolStyle], [900, 'nen', 1200, 'nen']);
  const deur = doc.annotations.find((a) => a.id === d.openingId);
  assert.equal(deur.params.symboolStijl, undefined);
  assert.equal(deur.params.deurbladDikteMm, 40);
  // Het kozijn met stijlen: twee stijlen, het blad en de draaicirkel.
  assert.deepEqual(getTemplate('door').render(deur.params, { x: deur.x, y: deur.y, width: deur.width, height: deur.height }).map((c) => c.kind),
    ['polyline', 'polyline', 'polyline', 'arc']);
});

test('kopiëren en plakken: wand met deur blijft een stel, een losse kopie van de deur is los', async () => {
  const { doc, wand, kozijn } = await tekening();
  const kopie = (a, dy) => {
    const k = cloneAnnotation(a);
    k.id = `kopie-${a.id}`;
    for (const veld of ['y', 'startY', 'endY']) if (k[veld] !== undefined) k[veld] += dy;
    return k;
  };
  const w2 = kopie(wand(), 500), d2 = kopie(kozijn(), 500);
  doc.annotations.push(w2, d2);
  undo.recordBulkAdd([w2, d2]);
  const wand2 = doc.annotations.find((a) => a.id === w2.id);
  const deur2 = doc.annotations.find((a) => a.id === d2.id);
  assert.deepEqual(wand2.openingen.map((x) => x.id), [deur2.id]);
  assert.equal(deur2.params.hostWallId, wand2.id);
  assert.notEqual(wand2.openingen[0].key, wand().openingen[0].key);
  assert.deepEqual(wand().openingen.map((x) => x.id), [kozijn().id], 'het origineel is ongemoeid');
  // De kopie gedraagt zich gehost.
  sleep(doc, deur2, (a) => { a.x += 100; a.y += 300; });
  assert.deepEqual(gaten(wand2), [[2750, 3650]]);
  // Opnieuw uitvoeren na ongedaan maken zet de gekoppelde kopieën terug.
  await undo.undo();
  await undo.undo();
  assert.equal(doc.annotations.length, 2);
  await undo.redo();
  assert.deepEqual(doc.annotations.find((a) => a.id === w2.id).openingen.map((x) => x.id), [d2.id]);
});

test('een document zonder gehoste openingen: de haak doet niets en verandert geen stap', async () => {
  const doc = openen([
    { id: 'w', type: 'wall', page: 1, startX: 0, startY: 0, endX: 700, endY: 0, dikteMm: 100 },
    { id: 'los', type: 'parametricSymbol', symbolId: 'door', page: 1, x: 700, y: -25, width: 450, height: 475, rotation: 0, params: { hostWallId: 'run:0:0', width: 900, wallThickness: 100 } },
    { id: 'vak', type: 'box', page: 1, x: 5, y: 5, width: 50, height: 50 },
  ]);
  const los = doc.annotations[1];
  sleep(doc, los, (a) => { a.x += 40; a.y += 70; });
  assert.deepEqual([los.x, los.y], [740, 45], 'een los kozijn gaat waar je het neerzet');
  assert.equal(doc.undoStack.at(-1).type, 'modifyAnnotation');
  sleep(doc, doc.annotations[0], (a) => { a.endX = 900; });
  assert.equal(doc.undoStack.at(-1).type, 'modifyAnnotation');
  assert.deepEqual([los.x, los.y], [740, 45], 'en volgt de wand niet');
  deleteAnnotationsWithUndo(doc, [doc.annotations[0]]);
  assert.deepEqual(state.documents[0].annotations.map((a) => a.id), ['los', 'vak']);
});
