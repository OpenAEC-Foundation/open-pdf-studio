// Telmarkeringen in de echte app-modules (state-store, undo-manager,
// selecteergereedschap): het selectiekader pakt ze (#934); telgroepen
// toewijzen, hernummeren bij verwijderen en ongedaan maken (#935).
//
// De modules draaien onder node met de laadhaken van de app (zie
// core/app-test-hooks.mjs); rendering.js en de i18n-opzet zijn daar stubs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state, getAnnotationBounds } = await import('../../core/state.ts');
const undo = await import('../../core/undo-manager.js');
const { deleteAnnotationsWithUndo } = await import('../../annotations/mutations.js');
const { selectTool } = await import('../../tools/tools/select-tool.js');
const store = await import('./countStore.js');

const tel = (id, extra = {}) => ({
  id, type: 'count', page: 1, x: 100, y: 100, color: '#e11d48', strokeColor: '#e11d48', opacity: 1, ...extra,
});
const vak = (id, extra = {}) => ({ id, type: 'box', page: 1, x: 0, y: 0, width: 5, height: 5, ...extra });

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

const nummers = (doc) => doc.annotations.filter(a => a.type === 'count').map(a => [a.id, a.categoryId || '', a.number]);

test('a count marker has selection bounds around its point (#934)', () => {
  assert.deepEqual(getAnnotationBounds(tel('a', { x: 40, y: 60 })), { x: 29, y: 49, width: 22, height: 22 });
});

test('dragging a selection frame with the Select tool selects count markers like other markups (#934)', () => {
  const doc = openen([tel('a', { x: 100, y: 100 }), tel('b', { x: 140, y: 120 }), vak('v', { x: 110, y: 90, width: 10, height: 10 }), tel('ver', { x: 400, y: 400 })]);
  let getoond = 0;
  const ctx = {
    state, scale: 1, pageNum: 1, x: 200, y: 200,
    getAnnotationBounds,
    showProperties: () => { getoond++; }, showMultiSelectionProperties: () => { getoond++; },
    hideProperties: () => {}, redraw: () => {},
  };
  // Van linksboven naar rechtsonder: window-selectie.
  Object.assign(state, { isRubberBanding: true, rubberBandStartX: 50, rubberBandStartY: 50, rubberBandMode: null, rubberBandModifier: 'replace' });
  selectTool.onPointerUp(ctx, {});
  assert.deepEqual(doc.selectedAnnotations.map(a => a.id).sort(), ['a', 'b', 'v']);
  assert.ok(getoond > 0);
});

test('assigning markers to a group takes its format and renumbers both groups, in one undo step (#935)', async () => {
  const doc = openen([
    tel('a', { categoryId: 'deuren', categoryName: 'Deuren', number: 1 }),
    tel('b', { categoryId: 'deuren', categoryName: 'Deuren', number: 2 }),
    tel('c', { categoryId: 'deuren', categoryName: 'Deuren', number: 3 }),
    tel('d', { categoryId: 'ramen', categoryName: 'Ramen', number: 1, color: '#2563eb', strokeColor: '#2563eb' }),
  ]);
  const n = store.assignCountGroup([doc.annotations[1]], 'ramen');
  assert.equal(n, 1);
  assert.deepEqual(nummers(doc), [['a', 'deuren', 1], ['b', 'ramen', 1], ['c', 'deuren', 2], ['d', 'ramen', 2]]);
  assert.equal(doc.annotations[1].color, '#2563eb', 'the marker takes the colour of its new group');
  // De standaardgroepen heten in de taal van de app (#1004); hier de Engelse terugval.
  assert.equal(doc.annotations[1].categoryName, 'Windows');
  const ramen = store.countTallies().find(g => g.id === 'ramen');
  assert.equal(ramen.count, 2, 'the tally follows');
  assert.equal(doc.undoStack.length, 1);
  await undo.undo();
  assert.deepEqual(nummers(state.documents[0]), [['a', 'deuren', 1], ['b', 'deuren', 2], ['c', 'deuren', 3], ['d', 'ramen', 1]]);
});

test('deleting a count marker renumbers the rest of its group; undo restores both (#935)', async () => {
  const doc = openen([
    tel('a', { categoryId: 'deuren', number: 1 }),
    tel('b', { categoryId: 'deuren', number: 2 }),
    vak('v'),
    tel('c', { categoryId: 'deuren', number: 3 }),
    tel('d', { categoryId: 'ramen', number: 1 }),
  ]);
  deleteAnnotationsWithUndo(doc, [doc.annotations[0]]);
  assert.deepEqual(nummers(state.documents[0]), [['b', 'deuren', 1], ['c', 'deuren', 2], ['d', 'ramen', 1]]);
  assert.equal(state.documents[0].undoStack.length, 1, 'one undo step');
  await undo.undo();
  assert.deepEqual(nummers(state.documents[0]), [['a', 'deuren', 1], ['b', 'deuren', 2], ['c', 'deuren', 3], ['d', 'ramen', 1]]);
});

test('deleting something else stays a plain delete step', () => {
  const doc = openen([vak('v'), tel('a', { categoryId: 'deuren', number: 1 })]);
  deleteAnnotationsWithUndo(doc, [doc.annotations[0]]);
  assert.equal(state.documents[0].undoStack[0].type, 'deleteAnnotation');
});

test('changing the colour of a group recolours all its markers, in one undo step (#935)', async () => {
  const doc = openen([tel('a', { categoryId: 'deuren', number: 1 }), tel('b', { categoryId: 'deuren', number: 2 }), tel('c', { categoryId: 'ramen', number: 1 })]);
  store.updateCountGroup('deuren', { color: '#123456' });
  assert.deepEqual(doc.annotations.map(a => a.color), ['#123456', '#123456', '#e11d48']);
  assert.equal(store.countGroups().find(g => g.id === 'deuren').color, '#123456');
  assert.equal(doc.undoStack.length, 1);
  await undo.undo();
  assert.deepEqual(state.documents[0].annotations.map(a => a.color), ['#e11d48', '#e11d48', '#e11d48']);
  store.updateCountCategory('deuren', { color: '#e11d48' });
});

test('a group that only exists in an opened file can be picked as the active group', () => {
  openen([tel('a', { categoryId: 'kleppen-x1', categoryName: 'Valves DN100', color: '#00aa00', number: 1 })]);
  store.setActiveCountCategory('kleppen-x1');
  const actief = store.activeCountCategory();
  assert.equal(actief.id, 'kleppen-x1');
  assert.equal(actief.name, 'Valves DN100');
  assert.equal(store.nextCountNumber('kleppen-x1'), 2);
  store.setActiveCountCategory('deuren');
});

test('the count tool shows its group controls in the ribbon; every language has the texts', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const tekenen = readFileSync(new URL('../components/ribbon/DrawingTab.jsx', import.meta.url), 'utf8');
  assert.match(tekenen, /<Show when=\{state\.currentTool === 'count'\}>\s*<RibbonGroup label=\{t\('drawing\.countGroup'\)\}>[\s\S]*?<CountGroupRibbonControls \/>/);
  const paneel = readFileSync(new URL('../components/properties-panel/PropertiesPanel.jsx', import.meta.url), 'utf8');
  assert.match(paneel, /\['countGroup', CountGroupSection\]/);
  const locales = new URL('../../i18n/locales/', import.meta.url);
  for (const taal of readdirSync(locales)) {
    const lint = JSON.parse(readFileSync(new URL(`${taal}/ribbon.json`, locales), 'utf8'));
    const eig = JSON.parse(readFileSync(new URL(`${taal}/properties.json`, locales), 'utf8'));
    for (const k of ['countGroup', 'countGroupLabel', 'countGroupColor', 'countGroupNew', 'countGroupAdd']) {
      assert.ok(lint.drawing?.[k], `${taal}: drawing.${k}`);
    }
    for (const k of ['title', 'group', 'none', 'mixed', 'total', 'pieces', 'color', 'name']) {
      assert.ok(eig.countGroup?.[k], `${taal}: countGroup.${k}`);
    }
    assert.ok(eig.measurements?.counts && eig.measurements?.noCounts, `${taal}: measurements.counts`);
  }
});

// --- Nieuwe telling met een klik (#1004) ---

test('the default groups have translatable names, no fixed Dutch ones (#1004)', async () => {
  const { readFileSync } = await import('node:fs');
  const bron = readFileSync(new URL('./countStore.js', import.meta.url), 'utf8');
  assert.doesNotMatch(bron, /name: '(Deuren|Ramen|Stopcontacten|Categorie)'/);
  // De ids blijven: markeringen uit oudere bestanden horen er nog bij.
  assert.deepEqual(store.countCategories().slice(0, 3).map(c => [c.id, c.name]),
    [['deuren', 'Doors'], ['ramen', 'Windows'], ['stopcontacten', 'Sockets']]);
});

test('New count makes a new active group with its own name and colour; numbering starts at 1 (#1004)', () => {
  const doc = openen([
    tel('a', { categoryId: 'deuren', categoryName: 'Doors', number: 1 }),
    tel('b', { categoryId: 'deuren', categoryName: 'Doors', number: 2 }),
    tel('c', { categoryId: 'deuren', categoryName: 'Doors', number: 3 }),
  ]);
  store.setActiveCountCategory('deuren');
  const voor = store.countGroups().map(g => g.color);
  const nieuw = store.startNewCount();
  assert.equal(store.activeCountCategory().id, nieuw.id, 'the new group is active');
  assert.match(nieuw.name, /^Count \d+$/);
  assert.ok(!voor.includes(nieuw.color), 'a colour no other group has');
  assert.equal(store.nextCountNumber(nieuw.id), 1, 'numbering starts again at 1');
  assert.deepEqual(nummers(doc), [['a', 'deuren', 1], ['b', 'deuren', 2], ['c', 'deuren', 3]], 'earlier counts keep their numbers');
  assert.deepEqual(doc.annotations.map(a => a.color), ['#e11d48', '#e11d48', '#e11d48'], 'and their colour');
  assert.equal(doc.undoStack.length, 0, 'no document change');

  const tweede = store.startNewCount();
  assert.notEqual(tweede.id, nieuw.id);
  assert.notEqual(tweede.name, nieuw.name);
  assert.notEqual(tweede.color, nieuw.color);
  assert.equal(store.activeCountCategory().id, tweede.id);
  // Een markering in de vorige telling verandert niets aan de nieuwe.
  doc.annotations.push(tel('d', { categoryId: nieuw.id, number: 1 }));
  assert.equal(store.nextCountNumber(nieuw.id), 2);
  assert.equal(store.nextCountNumber(tweede.id), 1);
  store.setActiveCountCategory('deuren');
});

test('New count is one click in the ribbon, Enter while counting, and shown in the status bar (#1004)', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
  const tekenen = lees('../components/ribbon/DrawingTab.jsx');
  assert.match(tekenen, /<RibbonGroup label=\{t\('drawing\.countGroup'\)\}>\s*<RibbonButton id="dr-count-new"[^>]*label=\{t\('drawing\.countNew'\)\}[^>]*onClick=\{\(\) => startNewCount\(\)\} \/>\s*<CountGroupRibbonControls \/>/);
  const toetsen = lees('../../tools/keyboard-handlers.js');
  assert.match(toetsen, /e\.key === 'Enter' && state\.currentTool === 'count'[\s\S]{0,200}startNewCount\(\);/);
  const balk = lees('../components/StatusBar.jsx');
  assert.match(balk, /state\.currentTool === 'count' \? activeCountCategory\(\) : null/);
  assert.match(balk, /<Show when=\{telGroep\(\)\}>[\s\S]*?background: telGroep\(\)\.color[\s\S]*?\{telGroep\(\)\.name\}/);
  const gegenereerd = lees('../../core/keybindings/ribbon-commands.generated.js');
  assert.match(gegenereerd, /"id":"dr-count-new"/, 'a shortcut can be assigned to the button');

  const locales = new URL('../../i18n/locales/', import.meta.url);
  const sleutels = ['countNew', 'countNewTip', 'countNewName', 'countNewStarted', 'countDefaultDoors', 'countDefaultWindows', 'countDefaultSockets'];
  for (const taal of readdirSync(locales)) {
    const lint = JSON.parse(readFileSync(new URL(`${taal}/ribbon.json`, locales), 'utf8'));
    const balkTekst = JSON.parse(readFileSync(new URL(`${taal}/statusbar.json`, locales), 'utf8'));
    for (const k of sleutels) assert.ok(lint.drawing?.[k], `${taal}: drawing.${k}`);
    assert.match(lint.drawing.countNewStarted, /\{\{name\}\}/, `${taal}: countNewStarted names the group`);
    assert.ok(balkTekst.tools?.count && balkTekst.countGroupTip, `${taal}: statusbar count`);
  }
  const nl = JSON.parse(readFileSync(new URL('nl/ribbon.json', locales), 'utf8')).drawing;
  const en = JSON.parse(readFileSync(new URL('en/ribbon.json', locales), 'utf8')).drawing;
  for (const k of sleutels) assert.notEqual(nl[k], en[k], `nl is translated: ${k}`);
});
