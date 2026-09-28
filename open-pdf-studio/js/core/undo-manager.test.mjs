// Ongedaan maken en opnieuw uitvoeren na #491: een commando wordt in één
// Solid-batch toegepast (één herberekening per stap in plaats van één per
// geschreven veld) en de bulkcommando's zoeken annotaties op met één doorloop
// in plaats van een findIndex per item. De uitkomst moet precies blijven wat
// de oude code gaf; die staat hieronder als referentie (op gewone arrays).
//
// Echte state-store en undo-manager; Solid draait reactief zoals in de app
// (zie ./app-test-hooks.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('./app-test-hooks.mjs');
installeerBrowserStubs();

const { createRoot, createMemo } = await import('solid-js');
const { state } = await import('./state.ts');
const undo = await import('./undo-manager.js');

const kloon = (x) => JSON.parse(JSON.stringify(x));

// ── Referentie: de oude toepassing, per item een findIndex + splice ─────────

function oudVerwijderPerId(lijst, ids) {
  for (const id of ids) {
    const idx = lijst.findIndex((a) => a.id === id);
    if (idx !== -1) lijst.splice(idx, 1);
  }
  return lijst;
}

function oudTerugzetten(lijst, items) {
  for (const item of [...items].sort((a, b) => a.index - b.index)) {
    lijst.splice(Math.min(item.index, lijst.length), 0, item.annotation);
  }
  return lijst;
}

function oudHerstellen(lijst, items, veld) {
  for (const item of items) {
    const idx = lijst.findIndex((a) => a.id === item.id);
    if (idx === -1) continue;
    const doel = lijst[idx];
    for (const k of Object.keys(doel)) if (!(k in item[veld])) delete doel[k];
    Object.assign(doel, kloon(item[veld]));
  }
  return lijst;
}

// ── Testdocument ────────────────────────────────────────────────────────────

function vak(id, x = 0, extra = {}) {
  return { id, type: 'box', page: 1, x, y: 0, width: 5, height: 5, ...extra };
}

function openen(annotations) {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations,
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

/** Zet een commando klaar alsof het net is uitgevoerd. */
function klaarzetten(doc, cmd) {
  doc.undoStack = [cmd];
  doc.redoStack = [];
}

const inhoud = (doc) => kloon(doc.annotations);

// Vaste pseudo-willekeur.
function toeval(zaad) {
  let s = zaad >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('undo of a bulk add removes the first annotation per id, as before (also with duplicate ids)', async () => {
  const r = toeval(7);
  for (let ronde = 0; ronde < 40; ronde++) {
    const lijst = Array.from({ length: 30 }, (_, i) => vak(`a${Math.floor(r() * 20)}`, i));
    const items = Array.from({ length: 1 + Math.floor(r() * 8) }, () => ({ annotation: vak(`a${Math.floor(r() * 25)}`) }));
    const verwacht = oudVerwijderPerId(kloon(lijst), items.map((it) => it.annotation.id));
    const doc = openen(kloon(lijst));
    klaarzetten(doc, { type: 'bulkAdd', items });
    await undo.undo();
    assert.deepEqual(inhoud(doc), verwacht);
  }
});

test('undo of a bulk delete puts every item back at its old index, as before', async () => {
  const r = toeval(11);
  for (let ronde = 0; ronde < 40; ronde++) {
    const lijst = Array.from({ length: Math.floor(r() * 25) }, (_, i) => vak(`b${i}`, i));
    const items = Array.from({ length: 1 + Math.floor(r() * 10) }, (_, i) => ({
      annotation: vak(`weg${i}`, 100 + i), index: Math.floor(r() * 40),
    }));
    const verwacht = oudTerugzetten(kloon(lijst), kloon(items));
    const doc = openen(kloon(lijst));
    klaarzetten(doc, { type: 'bulkDelete', items });
    await undo.undo();
    assert.deepEqual(inhoud(doc), verwacht);
    // Opnieuw uitvoeren haalt precies die items weer weg.
    await undo.redo();
    assert.deepEqual(inhoud(doc), oudVerwijderPerId(kloon(verwacht), items.map((it) => it.annotation.id)));
  }
});

test('bulk modify restores the first annotation with each id, for undo and redo', async () => {
  const lijst = [vak('x', 1), vak('y', 2), vak('x', 3), vak('z', 4)];
  const items = [
    { id: 'x', oldState: vak('x', 10, { color: '#f00' }), newState: vak('x', 20) },
    { id: 'z', oldState: vak('z', 40), newState: vak('z', 50, { label: 'nieuw' }) },
    { id: 'weg', oldState: vak('weg', 1), newState: vak('weg', 2) },
  ];
  const doc = openen(kloon(lijst));
  klaarzetten(doc, { type: 'bulkModify', items: kloon(items) });
  await undo.undo();
  assert.deepEqual(inhoud(doc), oudHerstellen(kloon(lijst), items, 'oldState'));
  await undo.redo();
  assert.deepEqual(inhoud(doc), oudHerstellen(oudHerstellen(kloon(lijst), items, 'oldState'), items, 'newState'));
});

test('a transaction of adds, changes and deletes is undone and redone exactly', async () => {
  const doc = openen([vak('p', 1), vak('q', 2), vak('r', 3)]);
  const voor = inhoud(doc);
  undo.beginUndoTransaction();
  const nieuw = vak('n', 9);
  doc.annotations.push(nieuw);
  undo.recordAdd(nieuw);
  const q = doc.annotations[1];
  const qVoor = { ...q };
  q.x = 22;
  undo.recordModify(q.id, qVoor, q);
  const r = doc.annotations[2];
  undo.recordDelete(r, 2);
  doc.annotations.splice(2, 1);
  const n = doc.annotations.find((a) => a.id === 'n');
  const nVoor = { ...n };
  n.width = 50;
  undo.recordModify(n.id, nVoor, n);
  const q2 = doc.annotations[1];
  const q2Voor = { ...q2 };
  q2.y = 7;
  undo.recordModify(q2.id, q2Voor, q2);
  undo.endUndoTransaction();
  const na = inhoud(doc);
  assert.equal(doc.undoStack.length, 1);
  assert.equal(doc.undoStack[0].type, 'compound');

  await undo.undo();
  assert.deepEqual(inhoud(doc), voor);
  await undo.redo();
  assert.deepEqual(inhoud(doc), na);
  await undo.undo();
  assert.deepEqual(inhoud(doc), voor);
});

test('after an undo that removes annotations nothing stays selected, as before', async () => {
  const doc = openen([vak('s1', 1), vak('s2', 2)]);
  const extra = vak('s3', 3);
  doc.annotations.push(extra);
  undo.recordAdd(extra);
  const [s1, , s3] = doc.annotations;
  doc.selectedAnnotations = [s3, s1];
  doc.selectedAnnotation = s3;
  await undo.undo();
  assert.deepEqual(doc.annotations.map((a) => a.id), ['s1', 's2']);
  // Het eigenschappenpaneel sluit (hideProperties) en heft de selectie op.
  assert.equal(doc.selectedAnnotations.length, 0);
  assert.equal(doc.selectedAnnotation, null);
});

test('one undo is one reactive update, however many fields and annotations it restores', async () => {
  const doc = openen(Array.from({ length: 60 }, (_, i) => vak(`m${i}`, i)));
  let runs = 0;
  const dispose = createRoot((d) => {
    const som = createMemo(() => {
      runs++;
      return doc.annotations.reduce((s, a) => s + a.x + a.y + a.width, 0);
    });
    som();
    return d;
  });
  try {
    // 40 annotaties verplaatst en vergroot in één stap.
    const originelen = doc.annotations.slice(0, 40).map((a) => kloon(a));
    for (const a of doc.annotations.slice(0, 40)) { a.x += 5; a.y += 5; a.width += 1; }
    undo.recordBulkModify(doc.annotations.slice(0, 40), originelen);
    runs = 0;
    await undo.undo();
    assert.equal(runs, 1, 'bulk modify terugzetten');
    runs = 0;
    await undo.redo();
    assert.equal(runs, 1, 'bulk modify opnieuw');

    // 30 annotaties in één keer verwijderd, en terug.
    const weg = doc.annotations.slice(10, 40);
    undo.recordBulkDelete(weg);
    doc.annotations = doc.annotations.filter((a) => !weg.includes(a));
    runs = 0;
    await undo.undo();
    assert.equal(runs, 1, 'bulk delete terugzetten');
    assert.equal(doc.annotations.length, 60);
    runs = 0;
    await undo.redo();
    assert.equal(runs, 1, 'bulk delete opnieuw');
    assert.equal(doc.annotations.length, 30);
  } finally {
    dispose();
  }
});

test('one undo or redo draws the canvas once', async () => {
  const tekeningen = () => globalThis.__stubCalls?.redrawAnnotations || 0;
  const doc = openen([vak('d1', 1), vak('d2', 2)]);

  // Een toevoeging terugdraaien: de selectie gaat weg (hideProperties).
  const extra = vak('d3', 3);
  doc.annotations.push(extra);
  undo.recordAdd(extra);
  let voor = tekeningen();
  await undo.undo();
  assert.equal(tekeningen() - voor, 1, 'undo van een toevoeging');
  voor = tekeningen();
  await undo.redo();
  assert.equal(tekeningen() - voor, 1, 'redo van een toevoeging');

  // Een wijziging terugdraaien: de selectie blijft (showProperties).
  const d1 = doc.annotations[0];
  doc.selectedAnnotations = [d1];
  doc.selectedAnnotation = d1;
  const oud = { ...d1 };
  d1.x = 40;
  undo.recordModify(d1.id, oud, d1);
  voor = tekeningen();
  await undo.undo();
  assert.equal(tekeningen() - voor, 1, 'undo van een wijziging');
  assert.equal(doc.selectedAnnotation, doc.annotations[0], 'de selectie blijft staan');
  voor = tekeningen();
  await undo.redo();
  assert.equal(tekeningen() - voor, 1, 'redo van een wijziging');
});
