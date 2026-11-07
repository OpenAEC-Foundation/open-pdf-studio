// Eén kolom, verschillende eenheden (vervolg op GitHub #982).
//
// Een schaalgebied in meter naast een documentschaal in millimeter, of een
// meting in voet naast een in millimeter: de kolomkop nam de eenheid van de
// eerste rij en subtotaal en eindtotaal telden de ruwe getallen op. Nu krijgt
// elke kolom één eenheid en wordt elke cel daarin omgerekend, voor weergave,
// subtotaal, eindtotaal, CSV en werkmapkoppeling.
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
const { pixelsPerUnitFor } = await import('../../annotations/scale-region.js');
const { scheduleResultToCsv } = await import('../../quantities/schedule-csv.js');
const { formatCell, fmtTotal } = await import('../../quantities/schedule-templates.js');
const { bindingValues, configSignature } = await import('../../quantities/workbook-bindings.js');

// 1:50 → 1 m = 20 mm op papier.
const PT_PER_M = 72 / 25.4 * 1000 / 50;

let volgnummer = 0;
function annotatie(props) {
  volgnummer++;
  return { id: `g${volgnummer}`, author: 'Test', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z', ...props };
}

function openen({ unit = 'mm' } = {}) {
  const doc = {
    id: 'doc', filePath: null, fileName: 'plan.pdf', pdfDoc: { numPages: 2 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations: [],
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {},
    measureScale: { pixelsPerUnit: pixelsPerUnitFor('1:50', unit), unit, method: 'ratio', scaleRatio: '1:50' },
    pdfViewports: {},
  };
  state.documents = [doc];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

/** Schaalgebied 1:50 in meter over het linkerdeel van pagina 1. */
const gebiedInMeter = () => annotatie({ type: 'scaleRegion', page: 1, x: 0, y: 0, width: 400, height: 400, scaleString: '1:50', units: 'm' });
/** Horizontale lijn van `m` meter (op 1:50) vanaf (x, y). */
const lijn = (x, y, m, label, page = 1) => annotatie({ type: 'line', page, startX: x, startY: y, endX: x + m * PT_PER_M, endY: y, label });
const afstand = (value, unit, label, page = 1) => annotatie({ type: 'measureDistance', page, measureValue: value, measureUnit: unit, label });

const LENGTE = {
  categories: ['line-based', 'count'],
  fields: ['label', 'length', 'count'],
  filters: [], sort: [], itemize: true, format: {},
};

function paneel(cfg = LENGTE) {
  q.setSelectedCategories(cfg.categories);
  q.setScheduledFields(cfg.fields);
  q.setSortLevels(cfg.sort || []);
  q.setFilters(cfg.filters || []);
  q.setFormat(cfg.format || {});
  return q.scheduleResult();
}

const rijen = (r) => r.groups.flatMap((g) => g.rows);
const rij = (r, label) => rijen(r).find((x) => x.vals.label === label);
const kolom = (r, key) => r.columns.find((c) => c.key === key);
const bijna = (a, b, msg, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} ≠ ${b}`);

function koppeling(cfg, unit, field = 'length') {
  const schedule = { id: 's', name: 'Staat', config: cfg };
  return {
    schedule,
    binding: {
      version: 1, id: 'b', name: 'Begroting', sourcePath: 'plan.pdf', scheduleId: 's', scheduleName: 'Staat',
      config: configSignature(schedule), workbookPath: 'b.xlsx', sheet: 'Blad1',
      mappings: [{ field, cell: 'B2', unit }],
    },
  };
}

test('m next to mm: the column takes the most common unit and converts the rest', () => {
  const doc = openen();
  doc.annotations.push(gebiedInMeter());
  doc.annotations.push(lijn(10, 100, 2, 'in gebied'));         // m
  doc.annotations.push(lijn(500, 100, 1.5, 'buiten 1'));       // mm
  doc.annotations.push(lijn(500, 200, 3, 'buiten 2'));         // mm

  for (const r of [paneel(), buildResultForSchedule({ config: LENGTE })]) {
    assert.equal(kolom(r, 'length').unit, 'mm', 'twee rijen in mm tegen één in m');
    bijna(rij(r, 'in gebied').vals.length, 2000, 'm omgerekend naar mm');
    bijna(rij(r, 'buiten 1').vals.length, 1500, 'mm blijft mm');
    bijna(r.grandTotals.length, 6500, 'eindtotaal in mm, niet 2 + 4500');
    assert.equal(r.grandTotals.count, 3, 'een telling rekent niet om');
    assert.ok(!rijen(r).some((x) => x.foreignUnits), 'alles omrekenbaar');
  }

  // Twee rijen in het gebied: nu wint de meter.
  doc.annotations.push(lijn(10, 200, 1, 'in gebied 2'));
  doc.annotations.push(lijn(10, 300, 0.5, 'in gebied 3'));
  const r = paneel();
  assert.equal(kolom(r, 'length').unit, 'm');
  bijna(rij(r, 'buiten 2').vals.length, 3, 'mm omgerekend naar m');
  bijna(r.grandTotals.length, 2 + 1 + 0.5 + 1.5 + 3, 'eindtotaal in m');
});

test('a tie goes to the unit of the document scale', () => {
  const doc = openen();
  doc.annotations.push(gebiedInMeter());
  doc.annotations.push(lijn(10, 100, 2, 'in gebied'));
  doc.annotations.push(lijn(500, 100, 1.5, 'buiten'));
  const r = paneel();
  assert.equal(kolom(r, 'length').unit, 'mm');
  bijna(r.grandTotals.length, 3500, 'eindtotaal');

  // Dezelfde rijen in een document met een schaal in meter: dan de meter.
  const m = openen({ unit: 'm' });
  m.annotations.push(afstand(2, 'm', 'a'), afstand(1500, 'mm', 'b'));
  const rm = paneel();
  assert.equal(kolom(rm, 'length').unit, 'm');
  bijna(rm.grandTotals.length, 3.5, 'eindtotaal in m');
});

test('mm next to ft: exact conversion in cells, subtotals, grand total and CSV', () => {
  const doc = openen();
  doc.annotations.push(afstand(10, 'ft', 'voet', 1));
  doc.annotations.push(afstand(1000, 'mm', 'mm 1', 1));
  doc.annotations.push(afstand(500, 'mm', 'mm 2', 2));
  const cfg = { ...LENGTE, fields: ['label', 'page', 'length', 'count'], sort: [{ field: 'page', dir: 'asc', group: true }] };

  const r = paneel(cfg);
  assert.equal(kolom(r, 'length').unit, 'mm');
  assert.equal(rij(r, 'voet').vals.length, 3048, '10 ft = 3048 mm, exact');
  const [p1, p2] = r.groups;
  assert.equal(p1.subtotals.length, 4048, 'subtotaal pagina 1: 3048 + 1000');
  assert.equal(p2.subtotals.length, 500, 'subtotaal pagina 2');
  assert.equal(r.grandTotals.length, 4548);
  assert.equal(p1.subtotals.count, 2);

  const opgeslagen = buildResultForSchedule({ config: cfg });
  assert.deepEqual(rijen(opgeslagen).map((x) => x.vals), rijen(r).map((x) => x.vals));
  assert.deepEqual(opgeslagen.grandTotals, r.grandTotals);

  const regels = scheduleResultToCsv(r).split('\n');
  assert.match(regels[0], /Length \(mm\)/);
  const col = kolom(r, 'length');
  const voet = regels.find((l) => l.startsWith('voet,'));
  assert.ok(voet.includes(`,${formatCell(3048, col)},`), `${voet}: de ft-rij staat in mm`);
  assert.ok(regels.some((l) => l.includes(fmtTotal(4048, col))), 'subtotaal pagina 1 in de CSV');
  assert.ok(regels.at(-1).includes(fmtTotal(4548, col)), `eindtotaal in de CSV: ${regels.at(-1)}`);
  assert.ok(!regels.some((l) => /\b1510\b/.test(l)), 'geen ruwe som 10 + 1000 + 500');

  // Werkmapkoppeling: geen MIXED_UNITS meer, het totaal in de eenheid van de koppeling.
  const mm = koppeling(cfg, 'mm');
  assert.equal(bindingValues(mm.binding, r, mm.schedule)[0].value, 4548);
  const ft = koppeling(cfg, 'ft');
  bijna(bindingValues(ft.binding, r, ft.schedule)[0].value, 4548 / 304.8, 'totaal omgerekend naar ft', 1e-12);
  const opp = koppeling(cfg, 'm²');
  assert.throws(() => bindingValues(opp.binding, r, opp.schedule), /UNIT_CHANGED/, 'lengte naar oppervlakte kan niet');
});

test('a unit chosen in the schedule wins and converts every row', () => {
  const doc = openen();
  doc.annotations.push(afstand(10, 'ft', 'voet'), afstand(1000, 'mm', 'mm'));
  const cfg = { ...LENGTE, format: { length: { unit: 'm' } } };
  for (const r of [paneel(cfg), buildResultForSchedule({ config: cfg })]) {
    assert.equal(kolom(r, 'length').unit, 'm');
    assert.equal(rij(r, 'voet').vals.length, 3.048);
    assert.equal(rij(r, 'mm').vals.length, 1);
    assert.equal(r.grandTotals.length, 4.048);
  }
  // Een opschrift dat geen maat is ("stuks") rekent niets om, zoals vroeger.
  const r = paneel({ ...LENGTE, format: { count: { unit: 'stuks' } } });
  assert.equal(kolom(r, 'count').unit, 'stuks');
  assert.equal(r.grandTotals.count, 2);
});

test('areas: ft² next to m² convert, the column follows the majority', () => {
  const doc = openen();
  doc.annotations.push(annotatie({ type: 'measureArea', page: 1, measureValue: 100, measureUnit: 'ft²', measureName: 'voet' }));
  doc.annotations.push(annotatie({ type: 'measureArea', page: 1, measureValue: 10, measureUnit: 'm²', measureName: 'm 1' }));
  doc.annotations.push(annotatie({ type: 'measureArea', page: 1, measureValue: 20_000_000, measureUnit: 'mm²', measureName: 'mm' }));
  const cfg = { categories: ['area'], fields: ['label', 'area'], filters: [], sort: [], itemize: true, format: {} };
  const r = paneel(cfg);
  assert.equal(kolom(r, 'area').unit, 'm²');
  bijna(rij(r, 'voet').vals.area, 9.290304, '100 ft² in m²', 1e-12);
  bijna(r.grandTotals.area, 9.290304 + 10 + 20, 'eindtotaal in m²', 1e-12);
});

test('an incompatible unit is not added: it keeps its own unit and blocks the workbook total', () => {
  const doc = openen();
  doc.annotations.push(afstand(1000, 'mm', 'a'), afstand(2000, 'mm', 'b'), afstand(5, 'px', 'pagina'));
  const r = paneel();
  assert.equal(kolom(r, 'length').unit, 'mm');
  assert.deepEqual(rij(r, 'pagina').foreignUnits, { length: 'px' });
  assert.equal(rij(r, 'pagina').vals.length, 5, 'waarde ongewijzigd');
  assert.equal(r.grandTotals.length, 3000, 'px telt niet mee in mm');
  assert.equal(r.grandTotals.count, 3, 'de telling wel');

  const regel = scheduleResultToCsv(r).split('\n').find((l) => l.startsWith('pagina,'));
  assert.ok(regel.includes(`${formatCell(5, kolom(r, 'length'))} px`), `${regel}: eigen eenheid erbij`);

  const k = koppeling(LENGTE, 'mm');
  assert.throws(() => bindingValues(k.binding, r, k.schedule), /MIXED_UNITS/);
  // De telling heeft geen eenheid en blijft koppelbaar.
  const c = koppeling(LENGTE, '', 'count');
  assert.equal(bindingValues(c.binding, r, c.schedule)[0].value, 3);
});
