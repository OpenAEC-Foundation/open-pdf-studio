// Benchmark (#491): undo and delete with many annotations, against the REAL
// state store, undo manager, scale lookup and quantities store. Only the
// canvas renderer, the Tauri bridge and a few panels are stubbed, and Solid
// runs its reactive browser build like in the app (js/core/app-test-hooks.mjs),
// so every memo that watches the annotations recomputes as it would there.
//
//   node scripts/bench/undo-node.mjs [counts...] [--reps=N] [--panel=closed|open|both] [--json]
//
// Default counts: 100 500 1000 2000 synthetic 'box' annotations on page 1.
// --panel: with the quantities panel closed (the default state of the app),
// open (a view reads the schedule), or both (default).
// Reported per count (median of --reps runs, ms):
//   switch     activating the document
//   splice     a bare doc.annotations.splice() of one annotation
//   add        push + recordAdd of one box (what a drawing tool does)
//   undoAdd    undo() of that add (removes one annotation)
//   delete     recordDelete + filter, what the Delete key does
//   undoDel    undo() of that delete (puts it back)
//   move       moving one box (x and y) + recordModify
//   undoMove   undo() of that move (restores x and y)
//   builds     how often the schedule was built during undoMove

import { register } from 'node:module';

register('../../js/core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../js/core/app-test-hooks.mjs');
installeerBrowserStubs();

const args = process.argv.slice(2);
const counts = args.filter((a) => /^\d+$/.test(a)).map(Number);
const opt = (name, dflt) => (args.find((a) => a.startsWith(`--${name}=`)) || `--${name}=${dflt}`).slice(name.length + 3);
const REPS = Number(opt('reps', '3'));
const PANEL = opt('panel', 'both');
const asJson = args.includes('--json');
const COUNTS = counts.length ? counts : [100, 500, 1000, 2000];

const js = (p) => new URL(`../../js/${p}`, import.meta.url).href;
const solid = await import('solid-js');
const { state } = await import(js('core/state.ts'));
const { createAnnotation } = await import(js('annotations/factory.js'));
const undoManager = await import(js('core/undo-manager.js'));
const quantities = await import(js('solid/stores/quantitiesStore.js'));
const builds = () => globalThis.__buildScheduleCount || 0;

function box(i) {
  const col = i % 50;
  const row = Math.floor(i / 50);
  return createAnnotation({
    type: 'box', page: 1,
    x: 20 + col * 11, y: 20 + row * 11, width: 8, height: 6,
    color: '#ff0000', strokeColor: '#ff0000', fillColor: null, lineWidth: 1,
  });
}

function makeDoc(n) {
  return {
    id: `bench-${n}-${Math.random().toString(36).slice(2, 8)}`,
    filePath: null, fileName: 'bench.pdf', pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single',
    annotations: Array.from({ length: n }, (_, i) => box(i)),
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {},
    measureScale: null, pdfViewports: {},
  };
}

const now = () => performance.now();
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

async function runOnce(n) {
  const r = {};
  state.documents = [];
  state.activeDocumentIndex = -1;
  let t = now();
  state.documents = [makeDoc(n)];
  state.activeDocumentIndex = 0;
  r.switch = now() - t;
  const doc = state.documents[0];
  const mid = Math.floor(n / 2);

  // Bare removal from the list (what the issue timed as the bare removal).
  const removed = doc.annotations[mid];
  t = now();
  doc.annotations.splice(mid, 1);
  r.splice = now() - t;
  doc.annotations.splice(mid, 0, removed);

  // Draw one more box, then undo it.
  const extra = box(n + 1);
  t = now();
  doc.annotations.push(extra);
  undoManager.recordAdd(extra);
  r.add = now() - t;
  t = now();
  await undoManager.undo();
  r.undoAdd = now() - t;

  // Delete one box the way the Delete key does, then undo that.
  const victim = doc.annotations[mid];
  doc.selectedAnnotations = [victim];
  doc.selectedAnnotation = victim;
  t = now();
  undoManager.recordDelete(victim, doc.annotations.indexOf(victim));
  const gone = new Set([victim]);
  doc.annotations = doc.annotations.filter((a) => !gone.has(a));
  doc.selectedAnnotations = [];
  doc.selectedAnnotation = null;
  r.delete = now() - t;
  t = now();
  await undoManager.undo();
  r.undoDel = now() - t;

  // Move one box (x and y change) and undo the move.
  const target = doc.annotations[mid];
  const before = { ...target };
  t = now();
  target.x += 5;
  target.y += 5;
  undoManager.recordModify(target.id, before, target);
  r.move = now() - t;
  const buildsBefore = builds();
  t = now();
  await undoManager.undo();
  r.undoMove = now() - t;
  r.builds = builds() - buildsBefore;
  return r;
}

async function scenario(panel) {
  quantities.setScheduleVisible(panel === 'open');
  // An open panel reads the schedule, like SchedulePanel.jsx does.
  let dispose = () => {};
  if (panel === 'open') {
    solid.createRoot((d) => {
      dispose = d;
      solid.createComputed(() => { quantities.scheduleResult(); });
    });
  }
  const rows = [];
  for (const n of COUNTS) {
    const runs = [];
    for (let i = 0; i < REPS; i++) runs.push(await runOnce(n));
    const row = { panel, n };
    for (const k of Object.keys(runs[0])) row[k] = +median(runs.map((x) => x[k])).toFixed(1);
    rows.push(row);
    if (!asJson) console.log(JSON.stringify(row));
  }
  dispose();
  quantities.setScheduleVisible(false);
  return rows;
}

const all = [];
for (const panel of PANEL === 'both' ? ['closed', 'open'] : [PANEL]) all.push(...await scenario(panel));
if (asJson) console.log(JSON.stringify(all));
else console.table(all);
