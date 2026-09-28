// De hoeveelhedenstaat na #491: alleen met het paneel open houdt een memo hem
// bij, de schaalbronnen worden per herberekening één keer verzameld, en de
// uitkomst moet precies blijven wat de oude code gaf (die per element de hele
// annotatielijst doorzocht). De oude regel staat hieronder als referentie:
// meetschaal per punt = schaalgebied → viewport → schaalbalk op de pagina →
// PDF-viewport → documentschaal → schaalbalk elders → voorkeur → 1 px/mm.
//
// Echte state-store, undo-manager en staat; Solid draait reactief zoals in de
// app (zie ../../core/app-test-hooks.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { createRoot, createComputed } = await import('solid-js');
const { state } = await import('../../core/state.ts');
const undo = await import('../../core/undo-manager.js');
const q = await import('./quantitiesStore.js');
const { buildResultForSchedule } = await import('./schedulesStore.js');
const { countTallies } = await import('./countStore.js');
const { buildSchedule } = await import('../../quantities/engine.js');
const { viewportOp } = await import('../../pdf/pdf-viewports.js');
const { pixelsPerUnitFor } = await import('../../annotations/scale-region.js');

const PPU = (n) => 72 / (25.4 * n);
const builds = () => globalThis.__buildScheduleCount || 0;

// ── Referentie: de meetschaal en de elementen zoals vóór #491 ───────────────

function oudeSchaalOpPunt(doc, pageNum, x, y) {
  if (!doc) return null;
  const annotaties = Array.isArray(doc.annotations) ? doc.annotations : [];
  for (const a of annotaties) {
    if (a.type !== 'viewport' || a.page !== pageNum) continue;
    if (x >= a.x && x <= a.x + a.width && y >= a.y && y <= a.y + a.height) {
      return { pixelsPerUnit: a.pixelsPerUnit, unit: a.unit, method: 'viewport' };
    }
  }
  const schaalbalken = annotaties.filter((a) => a.type === 'scaleBar');
  const opPagina = schaalbalken.find((sb) => sb.page === pageNum);
  if (opPagina) return { pixelsPerUnit: opPagina.pixelsPerUnit, unit: opPagina.unit, method: 'scaleBar' };
  const vp = viewportOp(doc.pdfViewports?.[pageNum], x, y);
  if (vp) return { pixelsPerUnit: vp.pixelsPerUnit, unit: vp.unit, method: 'pdfViewport' };
  const docSchaal = doc.measureScale;
  if (docSchaal && docSchaal.pixelsPerUnit > 0) {
    return { pixelsPerUnit: docSchaal.pixelsPerUnit, unit: docSchaal.unit || 'mm', method: 'document' };
  }
  if (schaalbalken.length) {
    return { pixelsPerUnit: schaalbalken[0].pixelsPerUnit, unit: schaalbalken[0].unit, method: 'scaleBar' };
  }
  return null;
}

function oudSchaalgebied(doc, page, x, y) {
  const gebieden = (doc.annotations || []).filter((a) => a.type === 'scaleRegion' && a.page === page);
  gebieden.sort((a, b) => (a.width * a.height) - (b.width * b.height));
  const r = gebieden.find((g) => x >= g.x && x <= g.x + g.width && y >= g.y && y <= g.y + g.height);
  if (!r) return null;
  return {
    pixelsPerUnit: pixelsPerUnitFor(r.scaleString || '1:100', r.units || 'mm'),
    unit: r.units || 'mm', source: 'scaleRegion', regionId: r.id, method: 'scaleRegion',
  };
}

function oudeMeetschaal(doc, page, x, y) {
  const gebied = oudSchaalgebied(doc, page, x, y);
  if (gebied) return gebied;
  const punt = oudeSchaalOpPunt(doc, page, x, y);
  if (punt) return punt;
  const ds = doc.measureScale;
  if (ds && ds.pixelsPerUnit > 0) return { pixelsPerUnit: ds.pixelsPerUnit, unit: ds.unit || 'mm' };
  const ms = state.preferences.measureScale;
  if (ms && ms.pixelsPerUnit > 0) return { pixelsPerUnit: ms.pixelsPerUnit, unit: ms.unit || 'mm' };
  return { pixelsPerUnit: 1, unit: 'mm' };
}

const LENGTH_TYPES = new Set(['line', 'arrow', 'polyline', 'wall', 'spline', 'arc', 'draw']);
const AREA_TYPES = new Set(['filledArea', 'polygon', 'cloud', 'cloudPolyline', 'box', 'mask', 'redaction', 'highlight', 'circle', 'ellipse']);

function middenVoorStaat(a) {
  if (typeof a.startX === 'number' && typeof a.endX === 'number') return { x: (a.startX + a.endX) / 2, y: (a.startY + a.endY) / 2 };
  if (typeof a.x === 'number' && typeof a.y === 'number' && typeof a.width === 'number' && typeof a.height === 'number') {
    return { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  }
  const pts = Array.isArray(a.points) ? a.points : (Array.isArray(a.path) ? a.path : null);
  if (pts && pts.length) {
    return { x: pts.reduce((s, p) => s + (p.x ?? 0), 0) / pts.length, y: pts.reduce((s, p) => s + (p.y ?? 0), 0) / pts.length };
  }
  return { x: 0, y: 0 };
}

function middenVoorStaten(a) {
  if (typeof a.startX === 'number' && typeof a.endX === 'number') return { x: (a.startX + a.endX) / 2, y: (a.startY + a.endY) / 2 };
  const pts = Array.isArray(a.points) ? a.points : (Array.isArray(a.path) ? a.path : null);
  if (pts && pts.length) {
    return { x: pts.reduce((s, p) => s + (p.x ?? 0), 0) / pts.length, y: pts.reduce((s, p) => s + (p.y ?? 0), 0) / pts.length };
  }
  return { x: 0, y: 0 };
}

function metOudeSchaal(doc, a, midden) {
  const m = midden(a);
  const s = oudeMeetschaal(doc, a.page || 1, m.x, m.y);
  return { ...a, __pxPerUnit: s.pixelsPerUnit, __unit: s.unit };
}

const telNaam = (id) => countTallies().find((c) => c.id === id)?.name ?? (id || '');

function oudeElementen(doc) {
  return doc.annotations.map((a) => {
    if (a.type === 'count') return { ...a, __countCatName: telNaam(a.categoryId) };
    if (LENGTH_TYPES.has(a.type) && typeof a.measureValue !== 'number') return metOudeSchaal(doc, a, middenVoorStaat);
    if (AREA_TYPES.has(a.type)) return metOudeSchaal(doc, a, middenVoorStaat);
    if (a.type === 'measureArea' || a.type === 'measureDistance' || a.type === 'measurePerimeter') {
      return a.measureUnit ? a : metOudeSchaal(doc, a, middenVoorStaat);
    }
    return a;
  });
}

function oudeStatenElementen(doc) {
  return doc.annotations.map((a) => {
    if (a.type === 'count') return { ...a, __countCatName: telNaam(a.categoryId) };
    if (LENGTH_TYPES.has(a.type) && typeof a.measureValue !== 'number') return metOudeSchaal(doc, a, middenVoorStaten);
    return a;
  });
}

const config = () => ({
  categories: q.selectedCategories(), fields: q.scheduledFields(), filters: q.filters(),
  sort: q.sortLevels(), itemize: q.itemize(), format: q.format(),
});

/** Vergelijkbare vorm: kolommen, per groep de waarden per rij, totalen. */
function vorm(r) {
  return JSON.parse(JSON.stringify({
    columns: r.columns.map((c) => ({ key: c.key, label: c.label, unit: c.unit, decimals: c.decimals })),
    groups: r.groups.map((g) => ({ key: g.key, rows: g.rows.map((row) => row.vals), subtotals: g.subtotals })),
    grandTotals: r.grandTotals, count: r.count, itemize: r.itemize,
  }));
}

const verwacht = (doc) => vorm(buildSchedule(oudeElementen(doc), config()));

// ── Testdocumenten ──────────────────────────────────────────────────────────

let volgnummer = 0;
function annotatie(props) {
  volgnummer++;
  return { id: `q${volgnummer}`, author: 'Test', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z', ...props };
}

function document(naam) {
  const annotations = [];
  for (let i = 0; i < 24; i++) {
    annotations.push(annotatie({ type: 'box', page: 1 + (i % 2), x: 10 + (i % 6) * 40, y: 10 + Math.floor(i / 6) * 40, width: 20 + i, height: 10 + (i % 5) * 3, label: `vak ${i}` }));
  }
  for (let i = 0; i < 8; i++) {
    annotations.push(annotatie({ type: 'line', page: 1 + (i % 2), startX: 15 + i * 30, startY: 200, endX: 45 + i * 30, endY: 240 }));
  }
  annotations.push(annotatie({ type: 'polyline', page: 2, points: [{ x: 10, y: 300 }, { x: 60, y: 300 }, { x: 60, y: 350 }] }));
  annotations.push(annotatie({ type: 'measureDistance', page: 1, startX: 20, startY: 260, endX: 120, endY: 260, measureValue: 35.2 }));
  annotations.push(annotatie({ type: 'count', page: 1, x: 5, y: 5, categoryId: 'deuren' }));
  return {
    id: naam, filePath: null, fileName: `${naam}.pdf`, pdfDoc: { numPages: 2 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations,
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {},
    measureScale: null, pdfViewports: {},
  };
}

function openen(...docs) {
  state.documents = docs;
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

/** Paneel open met een lezer, zoals SchedulePanel.jsx. */
function paneelOpen() {
  let stop;
  q.setScheduleVisible(true);
  createRoot((dispose) => {
    stop = dispose;
    createComputed(() => { q.scheduleResult(); });
  });
  return () => { stop(); q.setScheduleVisible(false); };
}

/** Voer een wijziging uit en geef terug hoe vaak de staat daarbij opnieuw werd opgebouwd. */
async function opbouwenBij(fn) {
  const voor = builds();
  await fn();
  return builds() - voor;
}

const areaVan = (r, label) => {
  for (const g of r.groups) for (const row of g.rows) if (row.vals.label === label) return row.vals.area;
  return undefined;
};

// ── Tests ───────────────────────────────────────────────────────────────────

test('with the panel open the schedule follows every scale source change, exactly as before', async () => {
  const doc = openen(document('A'));
  const sluit = paneelOpen();
  try {
    assert.deepEqual(vorm(q.scheduleResult()), verwacht(doc));
    const zonder = areaVan(q.scheduleResult(), 'vak 0');

    const stappen = [
      ['schaalbalk toegevoegd', () => doc.annotations.push(annotatie({ type: 'scaleBar', page: 1, x: 300, y: 500, width: 100, height: 14, pixelsPerUnit: PPU(50), unit: 'mm' }))],
      ['schaal van de balk gewijzigd', () => { doc.annotations.at(-1).pixelsPerUnit = PPU(20); }],
      ['viewport toegevoegd', () => doc.annotations.push(annotatie({ type: 'viewport', page: 1, x: 0, y: 0, width: 100, height: 100, pixelsPerUnit: PPU(10), unit: 'mm' }))],
      ['viewport verplaatst', () => { doc.annotations.at(-1).x = 60; }],
      ['schaalgebied toegevoegd', () => doc.annotations.push(annotatie({ type: 'scaleRegion', page: 2, x: 0, y: 0, width: 200, height: 200, scaleString: '1:20', units: 'm' }))],
      ['schaalgebied verkleind', () => { doc.annotations.at(-1).width = 70; }],
      ['schaalgebied met andere schaal', () => { doc.annotations.at(-1).scaleString = '1:5'; }],
      ['schaalbalk naar pagina 2', () => { doc.annotations.find((a) => a.type === 'scaleBar').page = 2; }],
      ['documentschaal gezet', () => { doc.measureScale = { pixelsPerUnit: PPU(200), unit: 'mm' }; }],
      ['PDF-viewports gezet', () => { doc.pdfViewports = { 1: [{ x: 150, y: 0, width: 200, height: 200, pixelsPerUnit: PPU(25), unit: 'cm' }] }; }],
      ['schaalgebied verwijderd', () => doc.annotations.splice(doc.annotations.findIndex((a) => a.type === 'scaleRegion'), 1)],
      ['viewport verwijderd', () => doc.annotations.splice(doc.annotations.findIndex((a) => a.type === 'viewport'), 1)],
      ['vak verplaatst', () => { doc.annotations[0].x += 200; }],
    ];
    for (const [naam, stap] of stappen) {
      assert.equal(await opbouwenBij(stap), 1, `${naam}: één herberekening`);
      assert.deepEqual(vorm(q.scheduleResult()), verwacht(doc), naam);
    }
    assert.notEqual(areaVan(q.scheduleResult(), 'vak 0'), zonder, 'de schaal telt echt mee');
  } finally {
    sluit();
  }
});

test('undo and redo of scale changes give the schedule of that moment', async () => {
  const doc = openen(document('B'));
  const sluit = paneelOpen();
  try {
    const balk = annotatie({ type: 'scaleBar', page: 1, x: 300, y: 500, width: 100, height: 14, pixelsPerUnit: PPU(50), unit: 'mm' });
    doc.annotations.push(balk);
    undo.recordAdd(balk);
    const metBalk = vorm(q.scheduleResult());
    assert.deepEqual(metBalk, verwacht(doc));

    const levend = doc.annotations.at(-1);
    const voor = { ...levend };
    levend.pixelsPerUnit = PPU(10);
    levend.unit = 'cm';
    undo.recordModify(levend.id, voor, levend);
    const gewijzigd = vorm(q.scheduleResult());
    assert.deepEqual(gewijzigd, verwacht(doc));

    assert.equal(await opbouwenBij(() => undo.undo()), 1, 'één herberekening voor twee teruggezette velden');
    assert.deepEqual(vorm(q.scheduleResult()), metBalk);
    assert.deepEqual(vorm(q.scheduleResult()), verwacht(doc));

    await undo.redo();
    assert.deepEqual(vorm(q.scheduleResult()), gewijzigd);

    // Een schaalgebied toevoegen en dat ongedaan maken: het gebied mag daarna
    // niet meer meetellen.
    const gebied = annotatie({ type: 'scaleRegion', page: 1, x: 0, y: 0, width: 300, height: 300, scaleString: '1:20', units: 'mm' });
    doc.annotations.push(gebied);
    undo.recordAdd(gebied);
    assert.deepEqual(vorm(q.scheduleResult()), verwacht(doc));
    await undo.undo();
    assert.deepEqual(vorm(q.scheduleResult()), gewijzigd);
    await undo.redo();
    assert.deepEqual(vorm(q.scheduleResult()), verwacht(doc));
    assert.ok(doc.annotations.some((a) => a.type === 'scaleRegion'));
  } finally {
    sluit();
  }
});

test('switching document or page gives the schedule of what is shown', async () => {
  openen(document('C'), document('D'));
  const c = state.documents[0];
  const d = state.documents[1];
  d.annotations.push(annotatie({ type: 'scaleBar', page: 2, x: 0, y: 0, width: 50, height: 10, pixelsPerUnit: PPU(100), unit: 'mm' }));
  const sluit = paneelOpen();
  try {
    assert.deepEqual(vorm(q.scheduleResult()), verwacht(c));
    state.activeDocumentIndex = 1;
    assert.deepEqual(vorm(q.scheduleResult()), verwacht(d));
    d.currentPage = 2;
    assert.deepEqual(vorm(q.scheduleResult()), verwacht(d));
    state.activeDocumentIndex = 0;
    assert.deepEqual(vorm(q.scheduleResult()), verwacht(c));
  } finally {
    sluit();
  }
});

test('with the panel closed a change builds nothing, and opening shows the current schedule', async () => {
  const doc = openen(document('E'));
  q.setScheduleVisible(false);
  const gebouwd = await opbouwenBij(async () => {
    doc.annotations.push(annotatie({ type: 'scaleBar', page: 1, x: 0, y: 0, width: 50, height: 10, pixelsPerUnit: PPU(20), unit: 'mm' }));
    doc.annotations[3].x += 10;
    doc.annotations[3].color = '#00ff00';
    const extra = annotatie({ type: 'box', page: 1, x: 1, y: 1, width: 5, height: 5 });
    doc.annotations.push(extra);
    undo.recordAdd(extra);
    await undo.undo();
  });
  assert.equal(gebouwd, 0, 'geen staat opgebouwd zolang het paneel dicht is');

  const sluit = paneelOpen();
  try {
    assert.deepEqual(vorm(q.scheduleResult()), verwacht(doc));
  } finally {
    sluit();
  }
  // Een aanroeper zonder open paneel (plaatsen, export) krijgt hem op verzoek.
  assert.deepEqual(vorm(q.scheduleResult()), verwacht(doc));
});

test('a saved schedule (staten) keeps the lengths of before', () => {
  const doc = openen(document('F'));
  doc.annotations.push(annotatie({ type: 'viewport', page: 1, x: 0, y: 150, width: 200, height: 150, pixelsPerUnit: PPU(10), unit: 'mm' }));
  doc.annotations.push(annotatie({ type: 'scaleBar', page: 2, x: 0, y: 0, width: 50, height: 10, pixelsPerUnit: PPU(50), unit: 'mm' }));
  const cfg = { categories: ['line-based'], fields: ['type', 'page', 'length'], filters: [], sort: [{ field: 'page', dir: 'asc', group: true }], itemize: true, format: {} };
  assert.deepEqual(vorm(buildResultForSchedule({ config: cfg })), vorm(buildSchedule(oudeStatenElementen(doc), cfg)));
});
