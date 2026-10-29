// Customizable keyboard shortcuts (#714) in the real keyboard-handlers.js
// (stubs for its imports, keyboard-handlers-stubs.mjs) with the real
// shortcut registry (core/keybindings/app-shortcuts.js).
//
// 1. The defaults did not change: OUDE_STANDAARDEN is the list of keys as
//    keyboard-handlers.js handled them before #714, each with what it does.
//    The registry has exactly these defaults, and every key still does the
//    same thing.
// 2. A removed default does nothing, a reassigned default runs the other
//    command, a new key runs its command (built-in, ribbon, extension).
// 3. Single-key shortcuts never fire while typing; Find also works there.

import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

register('./keyboard-handlers-stubs.mjs', import.meta.url);

const app = await import('../core/keybindings/app-shortcuts.js');
const { extensieOpdrachten } = await import('../plugins/extension-commands.js');
const { isTextEntryTarget } = await import('../ui/chrome/tab-sneltoets.js');
const pagina = await import('../pdf/pagina-sneltoets.js');

const log = [];
const ann = { id: 'a1', type: 'box', page: 1, x: 100, y: 100, width: 50, height: 20 };
const doc = { pdfDoc: { numPages: 3 }, scale: 1, currentPage: 1, selectedAnnotations: [ann], annotations: [ann], viewMode: 'single' };
const state = { currentTool: 'select', preferences: {}, search: { isOpen: false } };
let gekozenAfbeelding = false;
let modaal = false;

const noteer = (naam) => (...a) => { log.push(a.length ? `${naam} ${a.join(',')}` : naam); };
globalThis.window = globalThis.window || {};
globalThis.confirm = () => { log.push('confirm'); return false; };

globalThis.__khStubs = {
  state,
  getActiveDocument: () => doc,
  isPdfAReadOnly: () => false,
  isModalOpen: () => modaal,
  isTextEntryTarget,
  typeLengthActive: () => false,
  isGMoveModeActive: () => false,
  isGRotateModeActive: () => false,
  wisselTagEnRuimte: () => false,
  tabDoorOnderdelen: () => false,
  getTool: () => ({}),
  expandCorrectionGroups: (_alle, gekozen) => gekozen,
  heeftGekozenAfbeelding: () => gekozenAfbeelding,
  deleteSelectedEmbeddedImage: noteer('deleteSelectedEmbeddedImage'),
  showNewDocDialog: noteer('showNewDocDialog'),
  openPDFFile: noteer('openPDFFile'),
  savePDF: noteer('savePDF'),
  savePDFAs: noteer('savePDFAs'),
  closeActiveTab: noteer('closeActiveTab'),
  showDocPropertiesDialog: noteer('showDocPropertiesDialog'),
  showPreferencesDialog: noteer('showPreferencesDialog'),
  showPrintDialog: noteer('showPrintDialog'),
  undo: noteer('undo'),
  redo: noteer('redo'),
  selectAllOnPage: noteer('selectAllOnPage'),
  copyAnnotation: (a) => log.push(`copyAnnotation ${a.id}`),
  copyAnnotations: noteer('copyAnnotations'),
  pasteAnnotation: noteer('pasteAnnotation'),
  pasteAnnotations: noteer('pasteAnnotations'),
  pasteAnnotationsInPlace: noteer('pasteAnnotationsInPlace'),
  deleteAnnotationsWithUndo: (_d, sel) => log.push(`delete ${sel.map((a) => a.id).join(',')}`),
  toggleFullscreen: noteer('toggleFullscreen'),
  draaiVanafKnop: noteer('draaiVanafKnop'),
  zoomIn: noteer('zoomIn'),
  zoomOut: noteer('zoomOut'),
  actualSize: noteer('actualSize'),
  fitWidth: noteer('fitWidth'),
  fitPage: noteer('fitPage'),
  toggleThinLines: noteer('toggleThinLines'),
  openFindBar: noteer('openFindBar'),
  onFindNext: noteer('onFindNext'),
  setTool: noteer('setTool'),
  openDialog: noteer('openDialog'),
  toggleLeftPanel: noteer('toggleLeftPanel'),
  togglePropertiesPanel: noteer('togglePropertiesPanel'),
  toggleAnnotationsListPanel: noteer('toggleAnnotationsListPanel'),
  toggleProofreading: noteer('toggleProofreading'),
  savePreferences: noteer('savePreferences'),
  // PageDown/PageUp (#751): the real key logic, goToPage logged; the
  // bladeraar jumps at once (its repeat brake is tested in pagina-sneltoets.test.mjs).
  paginaSneltoetsRichting: pagina.paginaSneltoetsRichting,
  paginaToetsVoorInvoer: pagina.paginaToetsVoorInvoer,
  paginaSprongDoel: pagina.paginaSprongDoel,
  maakPaginaBladeraar: ({ blader }) => ({ vraag: (richting) => { blader(richting); return true; } }),
  goToPage: noteer('goToPage'),
  // The registry: the real one.
  sneltoetsActief: app.sneltoetsActief,
  eigenSneltoetsVoor: app.eigenSneltoetsVoor,
  voerSneltoetsUit: app.voerSneltoetsUit,
  sneltoetsInInvoer: app.sneltoetsInInvoer,
  maakStandaardToets: app.maakStandaardToets,
  zetIngebouwdeUitvoerder: app.zetIngebouwdeUitvoerder,
  isSneltoetsOpname: app.isSneltoetsOpname,
};

const { handleKeydown } = await import('./keyboard-handlers.js');

const canvas = { tagName: 'CANVAS', id: '', isContentEditable: false, closest: () => null };
const invoer = { tagName: 'INPUT', id: 'some-field', isContentEditable: false, closest: () => null };

function toets(key, code, { ctrl = false, shift = false, alt = false, meta = false, target = canvas } = {}) {
  return {
    key, code, target, ctrlKey: ctrl, shiftKey: shift, altKey: alt, metaKey: meta, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
  };
}
const ctrl = (key, code, extra = {}) => toets(key, code, { ctrl: true, ...extra });

// Some branches run their command after a dynamic import (zoom, Thin Lines,
// paste in place). Under module.register the loader hooks run on their own
// thread, so how long that import takes differs per machine: wait until the
// log has been quiet for a while instead of a fixed number of ticks, so a late
// call is neither missed nor counted in the next key.
const slaap = (ms) => new Promise((r) => setTimeout(r, ms));
async function totStil({ minstens = 0, stilMs = 80, maxMs = 5000 } = {}) {
  const eind = Date.now() + maxMs;
  let lengte = -1;
  let stilSinds = Date.now();
  while (Date.now() < eind) {
    if (log.length !== lengte) { lengte = log.length; stilSinds = Date.now(); }
    else if (log.length >= minstens && Date.now() - stilSinds >= stilMs) return;
    await slaap(5);
  }
}
// `verwacht`: how many log lines the key should give; waits for them (also
// when they come late), then until nothing more comes.
async function druk(e, verwacht = 0) {
  await totStil();
  log.length = 0;
  doc.selectedAnnotations = [ann];
  await handleKeydown(e);
  await totStil({ minstens: verwacht });
  return [...log];
}

function begin(overrides = {}) {
  app.pasSneltoetsVoorkeurToe(overrides);
  gekozenAfbeelding = false;
  modaal = false;
  state.search.isOpen = false;
  state.clipboardAnnotation = ann;
  state._internalCopyAt = 1;
  state._appBlurAt = 0;
}

// The keys as keyboard-handlers.js (and main.js, proofreading-mode.js)
// handled them before #714: [command, canonical key, event, what happens].
const OUDE_STANDAARDEN = [
  ['file.new', 'Ctrl+N', () => ctrl('n', 'KeyN'), ['showNewDocDialog']],
  ['file.open', 'Ctrl+O', () => ctrl('o', 'KeyO'), ['openPDFFile']],
  ['file.save', 'Ctrl+S', () => ctrl('s', 'KeyS'), ['savePDF']],
  ['file.saveAs', 'Ctrl+Shift+S', () => ctrl('S', 'KeyS', { shift: true }), ['savePDFAs']],
  ['file.print', 'Ctrl+P', null, null], // main.js
  ['file.close', 'Ctrl+W', () => ctrl('w', 'KeyW'), ['closeActiveTab']],
  ['file.properties', 'Ctrl+D', () => ctrl('d', 'KeyD'), ['showDocPropertiesDialog']],
  ['app.preferences', 'Ctrl+,', () => ctrl(',', 'Comma'), ['showPreferencesDialog']],
  ['edit.undo', 'Ctrl+Z', () => ctrl('z', 'KeyZ'), ['undo']],
  ['edit.redo', 'Ctrl+Y', () => ctrl('y', 'KeyY'), ['redo']],
  ['edit.redo', 'Ctrl+Shift+Z', () => ctrl('Z', 'KeyZ', { shift: true }), ['redo']],
  ['edit.cut', 'Ctrl+X', () => ctrl('x', 'KeyX'), ['copyAnnotation a1', 'delete a1']],
  ['edit.copy', 'Ctrl+C', () => ctrl('c', 'KeyC'), ['copyAnnotation a1']],
  ['edit.paste', 'Ctrl+V', () => ctrl('v', 'KeyV'), ['pasteAnnotation']],
  ['edit.pasteInPlace', 'Ctrl+Shift+V', () => ctrl('V', 'KeyV', { shift: true }), ['pasteAnnotationsInPlace']],
  ['edit.selectAll', 'Ctrl+A', () => ctrl('a', 'KeyA'), ['selectAllOnPage']],
  ['edit.delete', 'Delete', () => { gekozenAfbeelding = true; return toets('Delete', 'Delete'); }, ['deleteSelectedEmbeddedImage']],
  ['edit.clearPage', 'Ctrl+Shift+C', () => ctrl('C', 'KeyC', { shift: true }), ['confirm']],
  ['view.zoomIn', 'Ctrl+=', () => ctrl('=', 'Equal'), ['zoomIn']],
  ['view.zoomOut', 'Ctrl+-', () => ctrl('-', 'Minus'), ['zoomOut']],
  ['view.actualSize', 'Ctrl+0', () => ctrl('0', 'Digit0'), ['actualSize']],
  ['view.fitWidth', 'Ctrl+1', () => ctrl('1', 'Digit1'), ['fitWidth']],
  ['view.fitPage', 'Ctrl+2', () => ctrl('2', 'Digit2'), ['fitPage']],
  ['view.thinLines', 'Ctrl+5', () => ctrl('5', 'Digit5'), ['toggleThinLines']],
  ['view.fullscreen', 'Ctrl+L', () => ctrl('l', 'KeyL'), ['toggleFullscreen']],
  ['view.nextPage', 'PageDown', () => toets('PageDown', 'PageDown'), ['goToPage 2']],
  ['view.previousPage', 'PageUp', null, null], // page 1: nothing to go back to, see below
  ['view.rotatePageRight', 'Ctrl+Shift+=', () => ctrl('+', 'Equal', { shift: true }), ['draaiVanafKnop 90']],
  ['view.rotatePageRight', 'Ctrl+Shift+NumpadAdd', () => ctrl('+', 'NumpadAdd', { shift: true }), ['draaiVanafKnop 90']],
  ['view.rotatePageLeft', 'Ctrl+Shift+-', () => ctrl('_', 'Minus', { shift: true }), ['draaiVanafKnop -90']],
  ['view.rotatePageLeft', 'Ctrl+Shift+NumpadSubtract', () => ctrl('-', 'NumpadSubtract', { shift: true }), ['draaiVanafKnop -90']],
  ['search.find', 'Ctrl+F', () => ctrl('f', 'KeyF'), ['openFindBar']],
  ['search.findNext', 'F3', () => { state.search.isOpen = true; return toets('F3', 'F3'); }, ['onFindNext']],
  ['drafting.objectSnap', 'Shift+F3', () => toets('F3', 'F3', { shift: true }), ['savePreferences']],
  ['tool.select', 'V', () => toets('v', 'KeyV'), ['setTool select']],
  ['tool.hand', 'H', () => toets('h', 'KeyH'), ['setTool hand']],
  ['tool.highlight', '1', () => toets('1', 'Digit1'), ['setTool highlight']],
  ['tool.draw', '2', () => toets('2', 'Digit2'), ['setTool draw']],
  ['tool.line', '3', () => toets('3', 'Digit3'), ['setTool line']],
  ['tool.box', '4', () => toets('4', 'Digit4'), ['setTool box']],
  ['tool.circle', '5', () => toets('5', 'Digit5'), ['setTool circle']],
  ['tool.textbox', 'T', null, null], // the 't' chord, see below
  ['tool.comment', 'N', () => toets('n', 'KeyN'), ['setTool comment']],
  ['drafting.grid', 'F7', () => toets('F7', 'F7'), ['savePreferences']],
  ['drafting.gridSnap', 'F9', () => toets('F9', 'F9'), ['savePreferences']],
  ['drafting.polarTracking', 'F10', () => toets('F10', 'F10'), ['savePreferences']],
  ['panels.navigation', 'F8', () => toets('F8', 'F8'), ['toggleLeftPanel']],
  ['panels.annotationsList', 'F11', () => toets('F11', 'F11'), ['toggleAnnotationsListPanel']],
  ['panels.properties', 'F12', () => toets('F12', 'F12'), ['togglePropertiesPanel']],
  ['review.proofreading', 'F2', null, null], // proofreading-mode.js
  ['help.shortcuts', 'F1', () => toets('F1', 'F1'), ['openDialog shortcuts']],
];

test('the registry has exactly the old default keys, each for its old command', () => {
  begin();
  const oud = OUDE_STANDAARDEN.map(([id, combo]) => `${id} ${combo}`).sort();
  const nu = app.sneltoetsen.commands().flatMap((c) => c.defaults.map((combo) => `${c.id} ${combo}`)).sort();
  assert.deepEqual(nu, oud);
  for (const [id, combo] of OUDE_STANDAARDEN) {
    assert.equal(app.sneltoetsen.ownerOf(combo), id, combo);
    assert.equal(app.sneltoetsActief(id, combo), true, combo);
  }
});

test('every old key still does what it did', async () => {
  for (const [id, combo, maakToets, verwacht] of OUDE_STANDAARDEN) {
    if (!maakToets) continue;
    begin();
    assert.deepEqual(await druk(maakToets(), verwacht.length), verwacht, `${combo} (${id})`);
  }
});

test('T (the one-letter command-line chord) still opens the text box tool, unless the user removed it', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    begin();
    log.length = 0;
    await handleKeydown(toets('t', 'KeyT'));
    mock.timers.tick(1300);
    assert.deepEqual(log, ['setTool textbox']);

    begin({ 'tool.textbox': [] });
    log.length = 0;
    await handleKeydown(toets('t', 'KeyT'));
    mock.timers.tick(1300);
    assert.deepEqual(log, []);
  } finally {
    mock.timers.reset();
    begin();
  }
});

test('Ctrl+P (main.js) and F2 (proofreading mode) ask the registry too', () => {
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(main, /if \(!sneltoetsActief\('file\.print', 'Ctrl\+P'\)\) return;\n\s*e\.stopImmediatePropagation\(\);/);
  const pm = readFileSync(new URL('./proofreading-mode.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(pm, /e\.key === 'F2'[^\n]*\n\s*&& sneltoetsActief\('review\.proofreading', 'F2'\)/);
  assert.match(pm, /if \(isSneltoetsOpname\(\)\) return;/);
});

test('a removed default does nothing; after reset it works again', async () => {
  begin({ 'file.save': [] });
  assert.deepEqual(await druk(ctrl('s', 'KeyS')), []);
  // Ctrl+Shift+S does not fall through to Save either.
  begin({ 'file.saveAs': [] });
  assert.deepEqual(await druk(ctrl('S', 'KeyS', { shift: true })), []);
  begin({ 'tool.select': [] });
  assert.deepEqual(await druk(toets('v', 'KeyV')), []);
  begin({ 'help.shortcuts': [] });
  assert.deepEqual(await druk(toets('F1', 'F1')), []);
  begin({ 'search.find': [] });
  assert.deepEqual(await druk(ctrl('f', 'KeyF')), []);
  begin();
  assert.deepEqual(await druk(ctrl('s', 'KeyS')), ['savePDF']);
});

test('a new key for a built-in command works at once, with the same handling as its default key', async () => {
  begin({ 'view.fitPage': ['Ctrl+2', 'F6'] });
  assert.deepEqual(await druk(toets('F6', 'F6')), ['fitPage']);
  assert.deepEqual(await druk(ctrl('2', 'Digit2')), ['fitPage'], 'the default key still works');
  begin({ 'edit.copy': ['Ctrl+C', 'Ctrl+Alt+K'] });
  assert.deepEqual(await druk(ctrl('k', 'KeyK', { alt: true })), ['copyAnnotation a1']);
  begin({ 'view.rotatePageRight': ['Ctrl+Shift+=', 'Ctrl+Shift+NumpadAdd', 'Alt+R'] });
  assert.deepEqual(await druk(toets('r', 'KeyR', { alt: true })), ['draaiVanafKnop 90']);
  begin({ 'help.shortcuts': ['F1', 'Ctrl+Alt+Shift+K'] });
  assert.deepEqual(await druk(ctrl('K', 'KeyK', { alt: true, shift: true })), ['openDialog shortcuts']);
  begin({ 'file.print': ['Ctrl+P', 'Ctrl+Alt+P'] });
  assert.deepEqual(await druk(ctrl('p', 'KeyP', { alt: true })), ['showPrintDialog']);
  begin({ 'review.proofreading': ['F2', 'Ctrl+Alt+R'] });
  assert.deepEqual(await druk(ctrl('r', 'KeyR', { alt: true })), ['toggleProofreading']);
});

test('a reassigned default key runs the other command; the old command keeps its other keys', async () => {
  begin({ 'file.save': [], 'view.fitPage': ['Ctrl+2', 'Ctrl+S'] });
  assert.deepEqual(await druk(ctrl('s', 'KeyS')), ['fitPage']);
  begin({ 'edit.redo': ['Ctrl+Shift+Z'], 'tool.hand': ['H', 'Ctrl+Y'] });
  assert.deepEqual(await druk(ctrl('y', 'KeyY')), ['setTool hand']);
  assert.deepEqual(await druk(ctrl('Z', 'KeyZ', { shift: true })), ['redo']);
});

test('next/previous page (PageDown/PageUp, #751) can get another key or be removed', async () => {
  begin({ 'view.nextPage': ['Ctrl+Alt+J'] });
  assert.deepEqual(await druk(ctrl('j', 'KeyJ', { alt: true })), ['goToPage 2']);
  assert.deepEqual(await druk(toets('PageDown', 'PageDown')), [], 'PageDown no longer belongs to the command');
  doc.currentPage = 2;
  try {
    begin();
    assert.deepEqual(await druk(toets('PageUp', 'PageUp')), ['goToPage 1']);
    begin({ 'view.previousPage': [] });
    assert.deepEqual(await druk(toets('PageUp', 'PageUp')), []);
  } finally {
    doc.currentPage = 1;
    begin();
  }
});

test('a letter the user assigned wins over the command-line chords', async () => {
  begin({ 'view.fitWidth': ['Ctrl+1', 'C'] });
  assert.deepEqual(await druk(toets('c', 'KeyC')), ['fitWidth']);
});

test('ribbon and extension commands get a key', async () => {
  const geklikt = [];
  app.zetLintUitvoerder((knop, tab) => { geklikt.push(`${tab}:${knop}`); return true; });
  begin({ 'ribbon:#insert-page': ['Ctrl+Alt+I'] });
  await druk(ctrl('i', 'KeyI', { alt: true }));
  assert.deepEqual(geklikt, ['organize:insert-page']);

  const gelopen = [];
  extensieOpdrachten.registreer({
    id: 'ext:demo:hello', extId: 'demo', tab: null, kind: 'action',
    lees: () => ({ label: 'Hello' }), voerUit: () => { gelopen.push('hello'); },
  });
  try {
    assert.ok(app.sneltoetsen.has('ext:demo:hello'), 'the extension command is listed');
    begin({ 'ext:demo:hello': ['Ctrl+Alt+H'] });
    await druk(ctrl('h', 'KeyH', { alt: true }));
    assert.deepEqual(gelopen, ['hello']);
  } finally {
    extensieOpdrachten.verwijder('ext:demo:hello');
  }
  assert.equal(app.sneltoetsen.has('ext:demo:hello'), false);
});

test('single-key shortcuts do not fire while typing; Find with a modifier does', async () => {
  begin({ 'view.fitPage': ['Ctrl+2', 'K', 'Ctrl+K'], 'search.find': ['Ctrl+F', 'Ctrl+Alt+F'] });
  assert.deepEqual(await druk(toets('k', 'KeyK', { target: invoer })), []);
  assert.deepEqual(await druk(ctrl('k', 'KeyK', { target: invoer })), [], 'not even with Ctrl: only Find runs in a text field');
  assert.deepEqual(await druk(toets('v', 'KeyV', { target: invoer })), [], 'built-in single keys neither');
  assert.deepEqual(await druk(ctrl('f', 'KeyF', { alt: true, target: invoer })), ['openFindBar']);
  assert.deepEqual(await druk(ctrl('f', 'KeyF', { target: invoer })), ['openFindBar'], 'the default Ctrl+F as before');
  assert.deepEqual(await druk(toets('k', 'KeyK')), ['fitPage'], 'outside a text field it runs');
});

test('user keys do not fire while a modal dialog is open or a key is being recorded', async () => {
  begin({ 'view.fitPage': ['Ctrl+2', 'F6'] });
  modaal = true;
  assert.deepEqual(await druk(toets('F6', 'F6')), []);
  modaal = false;
  app.zetSneltoetsOpname(true);
  try {
    assert.deepEqual(await druk(toets('F6', 'F6')), []);
    assert.deepEqual(await druk(ctrl('s', 'KeyS')), []);
  } finally {
    app.zetSneltoetsOpname(false);
  }
});

test('Cmd on macOS works like Ctrl, for the built-in and for new keys', async () => {
  begin({ 'view.fitPage': ['Ctrl+2', 'Ctrl+K'] });
  assert.deepEqual(await druk(toets('s', 'KeyS', { meta: true })), ['savePDF']);
  assert.deepEqual(await druk(toets('k', 'KeyK', { meta: true })), ['fitPage']);
});
