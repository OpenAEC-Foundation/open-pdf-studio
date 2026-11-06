// De lengte-kolom van een vlak in de hoeveelhedenstaat (GitHub #982).
//
// Een meetvlak van 4,7 x 5,2 m op een tekening 1:50 kwam met een lengte van
// 827,72 "m" in de staat: de puntlengte van de OPEN puntenlijst (drie zijden,
// zonder sluitende zijde) in pagina-eenheden, zonder schaal. De lengte van een
// vlak is zijn omtrek in de schaal-eenheid: 2 x (4,7 + 5,2) = 19,8 m.
//
// Echte state-store, meetschaal en staat (zie ../../core/app-test-hooks.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../core/state.ts');
const q = await import('./quantitiesStore.js');
const { buildResultForSchedule } = await import('./schedulesStore.js');
const { herberekenVlakMaat, calculateDistance, calculatePerimeter } = await import('../../annotations/measurement.js');
const { pixelsPerUnitFor } = await import('../../annotations/scale-region.js');
const { scheduleResultToCsv } = await import('../../quantities/schedule-csv.js');
const { formatCell } = await import('../../quantities/schedule-templates.js');
const { bindingValues, configSignature } = await import('../../quantities/workbook-bindings.js');

// 1:50 → 1 m = 20 mm op papier = 56,693 pt (bij /UserUnit 1).
const PT_PER_M = 72 / 25.4 * 1000 / 50;
const BREED = 4.7, DIEP = 5.2, OMTREK = 2 * (BREED + DIEP);

let volgnummer = 0;
function annotatie(props) {
  volgnummer++;
  return { id: `o${volgnummer}`, author: 'Test', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z', ...props };
}

/** Rechthoek als puntenlijst (zoals het meetvlak-gereedschap hem maakt), in pagina-eenheden. */
function rechthoek(x, y, wM, hM, userUnit = 1) {
  const s = PT_PER_M / userUnit;
  return [
    { x, y }, { x: x + wM * s, y }, { x: x + wM * s, y: y + hM * s }, { x, y: y + hM * s },
  ];
}

/** Meetvlak met zijn waarde berekend zoals de app dat doet (herberekenVlakMaat). */
function meetvlak(page, points, extra = {}) {
  const a = annotatie({ type: 'measureArea', page, points, ...extra });
  herberekenVlakMaat(a);
  return a;
}

function document({ measureScale = null, pageUserUnits, pdfViewports = {} } = {}) {
  return {
    id: 'doc', filePath: null, fileName: 'plan.pdf', pdfDoc: { numPages: 2 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations: [],
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {},
    measureScale, pdfViewports, ...(pageUserUnits ? { pageUserUnits } : {}),
  };
}

function openen(doc) {
  state.documents = [doc];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

const CFG = {
  categories: ['area', 'line-based', 'count'],
  fields: ['type', 'page', 'label', 'area', 'length', 'count'],
  filters: [], sort: [], itemize: true, format: {},
};

function paneel() {
  q.setSelectedCategories(CFG.categories);
  q.setScheduledFields(CFG.fields);
  q.setSortLevels([]);
  q.setFilters([]);
  return q.scheduleResult();
}

const rijen = (r) => r.groups.flatMap((g) => g.rows);
const rij = (r, label) => rijen(r).find((x) => x.vals.label === label);
const kolom = (r, key) => r.columns.find((c) => c.key === key);
const bijna = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} ≠ ${b}`);

test('#982: an area on a 1:50 plan with a metre viewport shows its perimeter, not 827.72', () => {
  // Het demoplan draagt een PDF-viewport (/VP /Measure) van 1:50 in meter.
  const doc = openen(document({
    pdfViewports: { 1: [{ x: 0, y: 0, width: 2000, height: 2000, pixelsPerUnit: PT_PER_M, unit: 'm' }] },
  }));
  doc.annotations.push(meetvlak(1, rechthoek(100, 100, BREED, DIEP), { measureName: 'Woonkamer' }));
  for (const r of [paneel(), buildResultForSchedule({ config: CFG })]) {
    const v = rij(r, 'Woonkamer').vals;
    bijna(v.area, BREED * DIEP, 1e-9, 'oppervlakte in m²');
    bijna(v.length, OMTREK, 1e-9, 'omtrek in m');
    assert.equal(kolom(r, 'length').unit, 'm');
    assert.ok(v.length < 100, 'niet de puntlengte in pagina-eenheden');
  }
});

test('area, perimeter, distance and count rows on a 1:50 document scale in mm', () => {
  const ppu = pixelsPerUnitFor('1:50', 'mm');
  const doc = openen(document({ measureScale: { pixelsPerUnit: ppu, unit: 'mm', method: 'ratio', scaleRatio: '1:50' } }));
  doc.annotations.push(meetvlak(1, rechthoek(100, 100, BREED, DIEP), { measureName: 'vlak' }));
  const afstand = annotatie({ type: 'measureDistance', page: 1, startX: 0, startY: 0, endX: 3 * PT_PER_M, endY: 0, label: 'afstand' });
  const d = calculateDistance(afstand.startX, afstand.startY, afstand.endX, afstand.endY, 1);
  Object.assign(afstand, { measureValue: d.value, measureUnit: d.unit });
  const omtrekPts = [{ x: 0, y: 500 }, { x: 2 * PT_PER_M, y: 500 }, { x: 2 * PT_PER_M, y: 500 + PT_PER_M }];
  const p = calculatePerimeter(omtrekPts, 1);
  doc.annotations.push(afstand, annotatie({ type: 'measurePerimeter', page: 1, points: omtrekPts, measureValue: p.value, measureUnit: p.unit, label: 'omtrek' }));
  doc.annotations.push(annotatie({ type: 'line', page: 1, startX: 0, startY: 700, endX: 0, endY: 700 + 1.5 * PT_PER_M, label: 'lijn' }));
  doc.annotations.push(annotatie({ type: 'box', page: 1, x: 600, y: 100, width: 2 * PT_PER_M, height: PT_PER_M, label: 'kader' }));
  doc.annotations.push(annotatie({ type: 'count', page: 1, x: 5, y: 5, categoryId: 'deuren', label: 'deur' }));

  const r = paneel();
  bijna(rij(r, 'vlak').vals.area, BREED * DIEP, 1e-9, 'mm² wordt m²');
  bijna(rij(r, 'vlak').vals.length, OMTREK * 1000, 1e-6, 'omtrek in mm, de tekeneenheid');
  bijna(rij(r, 'afstand').vals.length, 3000, 1e-6, 'afstand');
  bijna(rij(r, 'omtrek').vals.length, 3000, 1e-6, 'meet-omtrek (open lijn)');
  bijna(rij(r, 'lijn').vals.length, 1500, 1e-6, 'gewone lijn');
  bijna(rij(r, 'kader').vals.length, 6000, 1e-6, 'getekend vlak: omtrek van het vak');
  bijna(rij(r, 'kader').vals.area, 2, 1e-9, 'getekend vlak: oppervlakte');
  assert.equal(rij(r, 'deur').vals.length, null, 'een telling heeft geen lengte');
  assert.equal(rij(r, 'deur').vals.count, 1);
  assert.equal(kolom(r, 'length').unit, 'mm', 'één eenheid voor de hele kolom');
  bijna(r.grandTotals.length, OMTREK * 1000 + 3000 + 3000 + 1500 + 6000, 1e-6, 'eindtotaal');

  // De opgeslagen staat rekent hetzelfde als het paneel.
  const staat = buildResultForSchedule({ config: CFG });
  assert.deepEqual(rijen(staat).map((x) => x.vals), rijen(r).map((x) => x.vals));

  // CSV-export: dezelfde cellen, geen pagina-eenheden.
  const csv = scheduleResultToCsv(r);
  assert.match(csv.split('\n')[0], /Length \(mm\)/);
  const vlakRegel = csv.split('\n').find((l) => l.includes('vlak'));
  const cel = formatCell(rij(r, 'vlak').vals.length, kolom(r, 'length'));
  assert.ok(vlakRegel.includes(cel), `${vlakRegel} mist ${cel}`);
  assert.ok(!/827/.test(csv), 'geen puntlengte in de CSV');

  // Werkmapkoppeling op het lengtetotaal: geen MIXED_UNITS meer door het vlak.
  const schedule = { id: 's', name: 'Lengte', config: CFG };
  const binding = {
    version: 1, id: 'b', name: 'Begroting', sourcePath: 'plan.pdf', scheduleId: 's', scheduleName: 'Lengte',
    config: configSignature(schedule), workbookPath: 'b.xlsx', sheet: 'Blad1',
    mappings: [{ field: 'length', cell: 'B2', unit: 'mm' }],
  };
  bijna(bindingValues(binding, r, schedule)[0].value, r.grandTotals.length, 1e-9, 'werkmap krijgt het eindtotaal');
});

test('/UserUnit: the same area on a page with UserUnit 2 has the same perimeter', () => {
  const ppu = pixelsPerUnitFor('1:50', 'mm');
  const doc = openen(document({
    measureScale: { pixelsPerUnit: ppu, unit: 'mm', method: 'ratio', scaleRatio: '1:50' },
    pageUserUnits: { 1: 1, 2: 2 },
  }));
  doc.annotations.push(meetvlak(1, rechthoek(100, 100, BREED, DIEP, 1), { measureName: 'p1' }));
  doc.annotations.push(meetvlak(2, rechthoek(50, 50, BREED, DIEP, 2), { measureName: 'p2' }));
  doc.annotations.push(annotatie({ type: 'polygon', page: 2, label: 'veelhoek', points: rechthoek(400, 50, BREED, DIEP, 2) }));
  const r = paneel();
  for (const label of ['p1', 'p2', 'veelhoek']) {
    bijna(rij(r, label).vals.area, BREED * DIEP, 1e-9, `${label}: oppervlakte`);
    bijna(rij(r, label).vals.length, OMTREK * 1000, 1e-6, `${label}: omtrek`);
  }
});

test('a calibrated (own) scale on the area wins over the document scale', () => {
  // Documentschaal 1:100, maar het vlak is gekalibreerd op 1:50 (eigen schaal,
  // eenheden per punt).
  const doc = openen(document({ measureScale: { pixelsPerUnit: pixelsPerUnitFor('1:100', 'mm'), unit: 'mm', method: 'ratio', scaleRatio: '1:100' } }));
  const mmPerPt = 1 / pixelsPerUnitFor('1:50', 'mm');
  doc.annotations.push(meetvlak(1, rechthoek(100, 100, BREED, DIEP), { measureName: 'gekalibreerd', measureScale: mmPerPt, measureUnit: 'mm²' }));
  doc.annotations.push(meetvlak(1, rechthoek(500, 100, BREED / 2, DIEP / 2), { measureName: 'document' }));
  // Zonder opgeslagen waarde valt de omtrek terug op dezelfde schaalregel.
  doc.annotations.push(annotatie({ type: 'measureArea', page: 1, points: rechthoek(100, 600, BREED, DIEP), measureScale: mmPerPt, measureUnit: 'mm²', measureName: 'zonder waarde' }));
  const r = paneel();
  bijna(rij(r, 'gekalibreerd').vals.area, BREED * DIEP, 1e-9, 'eigen schaal: oppervlakte');
  bijna(rij(r, 'gekalibreerd').vals.length, OMTREK * 1000, 1e-6, 'eigen schaal: omtrek');
  // Op 1:100 is dezelfde papiermaat twee keer zo groot.
  bijna(rij(r, 'document').vals.area, BREED * DIEP, 1e-9, 'documentschaal: oppervlakte');
  bijna(rij(r, 'document').vals.length, OMTREK * 1000, 1e-6, 'documentschaal: omtrek');
  bijna(rij(r, 'zonder waarde').vals.length, OMTREK * 1000, 1e-6, 'terugval op de vlakschaal');
});
