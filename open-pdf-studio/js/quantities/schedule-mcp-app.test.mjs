// Staten via MCP, door de echte brug (#1130): met de echte state-store, de
// staten-store, de undo-manager en de engine (zie ../core/app-test-hooks.mjs).
//
// - een mislukte config laat geen staat achter;
// - een staat filtert op de annotatielaag;
// - een staat is van de hele app: dezelfde staat rekent uit het document dat
//   op dat moment actief is, en het antwoord noemt dat document;
// - verwijderen haalt de staat en zijn geplaatste tabellen in één
//   ongedaan-stap weg.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.ts');
const { DEFAULT_PREFERENCES } = await import('../core/constants.ts');
const { runAppEvent } = await import('../mcp-bridge.js');
const store = await import('../solid/stores/schedulesStore.js');
const undo = await import('../core/undo-manager.js');

const lijn = (id, lengte, laag) => ({
  id, type: 'line', page: 1, startX: 0, startY: 0, endX: lengte, endY: 0, ...(laag ? { layer: laag } : {}),
});

function documenten() {
  const basis = (id, fileName, annotations, annotationLayers = []) => ({
    id, fileName, pdfDoc: { numPages: 2 }, currentPage: 1, scale: 1, viewMode: 'single',
    annotations, annotationLayers, selectedAnnotations: [], selectedAnnotation: null,
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    measureScale: { pixelsPerUnit: 1, unit: 'mm' },
  });
  state.preferences = { ...DEFAULT_PREFERENCES };
  state.documents = [
    basis('doc-a', 'a.pdf', [lijn('a1', 100, 'L1'), lijn('a2', 50, 'L1'), lijn('a3', 30)],
      [{ id: 'L1', name: 'Walls' }]),
    basis('doc-b', 'b.pdf', [lijn('b1', 7)]),
  ];
  state.activeDocumentIndex = 0;
  store.setSchedules([]);
}

const actief = () => state.documents[state.activeDocumentIndex];
const tabellen = () => actief().annotations.filter((a) => a.type === 'scheduleTable');
const lengteTotaal = (r) => r.schedules[0].grandTotals.length;

test('een mislukte config laat geen staat achter', async () => {
  documenten();
  for (const config of [
    { categories: ['length'], fields: ['layer', 'length'] },
    { fields: ['laag', 'lengte'] },
    { fields: [] },
    { filters: [{ field: 'layer', op: 'equals', value: 'Walls' }] },
  ]) {
    const r = await runAppEvent('mcp:place-schedule', { templateId: 'length', name: 'Per layer', config });
    assert.equal(r.ok, false, JSON.stringify(config));
  }
  const pagina = await runAppEvent('mcp:place-schedule', { templateId: 'length', page: 9 });
  assert.match(pagina.error, /page 9 out of range/);
  assert.deepEqual(store.schedules(), [], 'geen staat aangemaakt');
  assert.deepEqual(tabellen(), [], 'geen tabel geplaatst');
  assert.equal(actief().undoStack.length, 0);
  assert.deepEqual((await runAppEvent('mcp:get-takeoff', {})).schedules, []);
});

test('een lengtestaat op laag, en dezelfde staat rekent uit het actieve document', async () => {
  documenten();
  const r = await runAppEvent('mcp:place-schedule', {
    templateId: 'length', name: 'Walls',
    config: { fields: ['type', 'layer', 'length'], filters: [{ field: 'layer', op: '=', value: 'Walls' }] },
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.created, true);
  assert.equal(r.document, 'a.pdf');
  assert.equal(store.schedules().length, 1);
  assert.equal(tabellen().length, 1);
  assert.equal(tabellen()[0].scheduleId, r.scheduleId, 'de tabel weet van welke staat hij is');

  const a = await runAppEvent('mcp:get-takeoff', { scheduleId: r.scheduleId });
  assert.equal(a.document, 'a.pdf');
  assert.equal(a.schedules[0].count, 2, 'alleen de lijnen op de laag Walls');
  assert.equal(lengteTotaal(a), 150);

  // Zonder filter telt ook de lijn op de standaardlaag mee, onder zijn eigen naam.
  const los = await runAppEvent('mcp:update-schedule', {
    scheduleId: r.scheduleId, newName: 'Per layer',
    config: { filters: [], sort: [{ field: 'layer', dir: 'asc', group: true }] },
  });
  assert.equal(los.ok, true, JSON.stringify(los));
  assert.deepEqual(los.changed, ['config', 'name']);
  const alles = await runAppEvent('mcp:get-takeoff', { name: 'Per layer' });
  assert.deepEqual(alles.schedules[0].groups.map((g) => [g.key, g.subtotals.length]), [['Default', 30], ['Walls', 150]]);
  assert.equal(tabellen().length, 1, 'bijwerken plaatst niets');

  // De staat is van de hele app: op het andere tabblad dezelfde staat, andere cijfers.
  state.activeDocumentIndex = 1;
  const b = await runAppEvent('mcp:get-takeoff', { scheduleId: r.scheduleId });
  assert.equal(b.document, 'b.pdf');
  assert.equal(b.schedules[0].id, r.scheduleId);
  assert.equal(lengteTotaal(b), 7);
});

test('verwijderen: de staat en zijn tabellen in één ongedaan-stap', async () => {
  documenten();
  const walls = await runAppEvent('mcp:place-schedule', { templateId: 'length', name: 'Walls', x: 10, y: 10 });
  await runAppEvent('mcp:place-schedule', { scheduleId: walls.scheduleId, x: 10, y: 300, page: 2 });
  const rooms = await runAppEvent('mcp:place-schedule', { templateId: 'area', name: 'Rooms', config: { categories: ['area', 'line-based'] } });
  assert.equal(rooms.ok, true, JSON.stringify(rooms));
  const doc = actief();
  assert.equal(tabellen().length, 3);
  assert.equal(doc.undoStack.length, 3);
  doc.selectedAnnotation = tabellen()[0];
  doc.selectedAnnotations = [tabellen()[0]];
  const definitie = JSON.parse(JSON.stringify(store.getScheduleById(walls.scheduleId)));

  const weg = await runAppEvent('mcp:delete-schedule', { name: 'walls' });
  assert.equal(weg.ok, true, JSON.stringify(weg));
  assert.equal(weg.scheduleId, walls.scheduleId);
  assert.equal(weg.removedTables.length, 2);
  assert.deepEqual(weg.removedTables.map((t) => t.page), [1, 2]);
  assert.equal(weg.undoable, true);
  assert.deepEqual(weg.schedule, definitie);
  assert.deepEqual(store.schedules().map((s) => s.name), ['Rooms']);
  assert.deepEqual(tabellen().map((t) => t.scheduleId), [rooms.scheduleId], 'de tabel van de andere staat blijft');
  assert.equal(doc.annotations.filter((a) => a.type === 'line').length, 3, 'de markeringen zelf blijven');
  assert.equal(doc.undoStack.length, 4, 'één stap erbij');
  assert.equal(doc.selectedAnnotation, null, 'de verwijderde tabel is niet meer geselecteerd');
  assert.equal(doc.modified, true);

  // Eén keer ongedaan: de twee tabellen én de staat staan terug, op hun plek.
  await undo.undo();
  assert.deepEqual(store.schedules().map((s) => s.name), ['Walls', 'Rooms']);
  assert.deepEqual(JSON.parse(JSON.stringify(store.getScheduleById(walls.scheduleId))), definitie);
  assert.deepEqual(tabellen().map((t) => t.scheduleId), [walls.scheduleId, walls.scheduleId, rooms.scheduleId]);
  assert.equal(doc.undoStack.length, 3);
  // En opnieuw: beide weer weg.
  await undo.redo();
  assert.deepEqual(store.schedules().map((s) => s.name), ['Rooms']);
  assert.deepEqual(tabellen().map((t) => t.scheduleId), [rooms.scheduleId]);

  // Zonder geplaatste tabellen in het actieve document: geen stap, het
  // document blijft ongemoeid; de tabel in het andere document wordt geteld.
  state.activeDocumentIndex = 1;
  const stappen = actief().undoStack.length;
  const rest = await runAppEvent('mcp:delete-schedule', { scheduleId: rooms.scheduleId });
  assert.deepEqual([rest.ok, rest.removedTables.length, rest.undoable, rest.tablesInOtherDocuments], [true, 0, false, 1]);
  assert.deepEqual(store.schedules(), []);
  assert.equal(actief().undoStack.length, stappen);
  assert.equal(actief().modified, false);

  assert.match((await runAppEvent('mcp:delete-schedule', { scheduleId: rooms.scheduleId })).error, /schedule not found/);
  assert.match((await runAppEvent('mcp:delete-schedule', {})).error, /scheduleId or name is required/);
});
