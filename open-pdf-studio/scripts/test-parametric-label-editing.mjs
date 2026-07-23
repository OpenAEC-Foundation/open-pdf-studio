// Gerichte test voor bewerkbare labels van parametrische symbolen.
// Draaien: node scripts/test-parametric-label-editing.mjs

import {
  existsSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'opds-parametric-label-'));

function stageMjs(relPath) {
  const source = readFileSync(join(appRoot, relPath), 'utf8')
    .replace(/(from\s*['"])(\.{1,2}\/[^'"]+)\.js(['"])/g, '$1$2.mjs$3')
    .replace(/(import\(\s*['"])(\.{1,2}\/[^'"]+)\.js(['"]\s*\))/g, '$1$2.mjs$3');
  const target = join(tmp, relPath).replace(/\.js$/, '.mjs');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
  return target;
}

function writeStub(relPath, contents) {
  const target = join(tmp, relPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return target;
}

stageMjs('js/annotations/stavenreeks.js');
const lineModule = await import(pathToFileURL(
  stageMjs('js/symbols/templates/wapening-lijn.js'),
).href);
const cageModule = await import(pathToFileURL(
  stageMjs('js/symbols/templates/wapeningskorf.js'),
).href);

const registryPath = join(tmp, 'js/symbols/registry.mjs');
writeFileSync(registryPath, `
import { wapeningsstaafTemplate, netwapeningTemplate } from './templates/wapening-lijn.mjs';
import { wapeningskorfTemplate } from './templates/wapeningskorf.mjs';
const templates = new Map([
  ['wapeningsstaaf', wapeningsstaafTemplate],
  ['netwapening', netwapeningTemplate],
  ['wapeningskorf', wapeningskorfTemplate],
]);
export function getTemplate(id) { return templates.get(id) || null; }
`);
const editingModule = await import(pathToFileURL(
  stageMjs('js/symbols/editable-labels.js'),
).href);

const {
  wapeningsstaafTemplate, netwapeningTemplate,
} = lineModule;
const { wapeningskorfTemplate } = cageModule;
const { findEditableLabel } = editingModule;

let checks = 0;
let failures = 0;
function ok(condition, message) {
  checks++;
  if (condition) return;
  failures++;
  console.error(`  FOUT: ${message}`);
}

const lineBox = { x: 100, y: 200, width: 320, height: 48 };
const barParams = {
  aantal: 3, diameter: 8, lengte: 1600,
  markerAantal: 1, markerPositie: 25, markerRichting: 'boven',
};
const netParams = {
  diameter: 8, afstand: 150, lengte: 1600,
  markerPositie: 25, markerRichting: 'boven',
};
const cageParams = {
  breedte: 400, hoogte: 400, dekking: 30,
  bovenAantal: 4, bovenDiameter: 12,
  zijAantal: 2, zijDiameter: 10,
  onderAantal: 6, onderDiameter: 16,
  beugelDiameter: 8, beugelAfstand: 150,
  naam: 'Korf A',
};
const cageBox = { x: 10, y: 20, width: 600, height: 500 };

console.log('\n== Labelcontract');
const barLabels = wapeningsstaafTemplate.editableLabels(barParams, lineBox);
const netLabels = netwapeningTemplate.editableLabels(netParams, lineBox);
const cageLabels = wapeningskorfTemplate.editableLabels(cageParams, cageBox);
ok(barLabels.length === 1, 'staaf levert één labelgebied');
ok(barLabels[0].fields.join(',') === 'aantal,diameter,lengte',
  'staaflabel koppelt drie velden');
ok(netLabels.length === 1, 'net levert één labelgebied');
ok(netLabels[0].fields.join(',') === 'diameter,afstand,lengte',
  'netlabel koppelt drie velden');
ok(cageLabels.map((label) => label.id).join(',') === 'boven,zij,onder,beugel,naam',
  'korf levert vijf bewerkbare labels');
ok(cageLabels.map((label) => label.fields.join('+')).join(',') ===
  'bovenAantal+bovenDiameter,zijAantal+zijDiameter,onderAantal+onderDiameter,'
  + 'beugelDiameter+beugelAfstand,naam',
  'korflabels koppelen de juiste veldgroepen');
ok([...barLabels, ...netLabels, ...cageLabels].every(({ rect }) =>
  Number.isFinite(rect.x) && Number.isFinite(rect.y)
  && rect.width > 0 && rect.height > 0),
'alle labelgebieden hebben geldige rechthoeken');
ok(wapeningskorfTemplate.editableLabels(
  { ...cageParams, toonLabels: false },
  cageBox,
).map((label) => label.id).join(',') === 'naam',
'verborgen korflabels leveren alleen het nog zichtbare onderschrift als hitgebied');
ok(!wapeningskorfTemplate.editableLabels(
  { ...cageParams, bovenAantal: 0 },
  cageBox,
).some((label) => label.id === 'boven'),
'een staafgroep zonder staven levert geen labelhitgebied');
ok(!wapeningskorfTemplate.editableLabels(
  { ...cageParams, naam: '' },
  cageBox,
).some((label) => label.id === 'naam'),
'een leeg onderschrift levert geen labelhitgebied');

console.log('\n== Geroteerde hit-testing');
const annotation = {
  type: 'parametricSymbol',
  symbolId: 'wapeningsstaaf',
  params: barParams,
  rotation: 45,
  ...lineBox,
};
const rect = barLabels[0].rect;
const local = {
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
};
const center = {
  x: annotation.x + annotation.width / 2,
  y: annotation.y + annotation.height / 2,
};
const angle = annotation.rotation * Math.PI / 180;
const dx = local.x - center.x;
const dy = local.y - center.y;
const rotated = {
  x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle),
  y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle),
};
ok(findEditableLabel(annotation, rotated.x, rotated.y)?.id === 'label',
  'inverse rotatie vindt het staaflabel');
ok(findEditableLabel(annotation, annotation.x - 100, annotation.y - 100) === null,
  'punt buiten het geroteerde label levert null');
ok(findEditableLabel({ ...annotation, type: 'line' }, rotated.x, rotated.y) === null,
  'niet-parametrische annotatie levert null');

console.log('\n== Paginawissel annuleert zonder commit');
globalThis.__parametricTestCanvas = {
  getBoundingClientRect() {
    return { left: 20, top: 30, width: 800, height: 600 };
  },
};
globalThis.document = {
  querySelector: () => null,
  getElementById: () => globalThis.__parametricTestCanvas,
};
writeStub('js/core/state.mjs', `
export const documentState = {
  id: 'document-1',
  viewMode: 'single',
  currentPage: 1,
  scale: 1,
  filePath: null,
  pdfDoc: {},
  annotations: [],
  selectedAnnotation: null,
  selectedAnnotations: [],
  undoStack: [],
  redoStack: [],
  savedUndoStackLength: 0,
  modified: false,
};
export const state = {
  documents: [documentState],
  activeDocumentIndex: 0,
  defaultAuthor: 'Test',
};
export function getActiveDocument() { return documentState; }
export function getPageRotation() { return 0; }
export function setPageRotation() {}
`);
writeStub('js/ui/dom-elements.mjs',
  'export const annotationCanvas = globalThis.__parametricTestCanvas;\n');
writeStub('js/pdf/pdf-viewport.mjs',
  'export const viewport = { active: false, zoom: 1, offsetX: 0, offsetY: 0 };\n');
stageMjs('js/annotations/factory.js');
stageMjs('js/core/undo-manager.js');
writeStub('js/ui/panels/left-panel.mjs',
  'export function invalidateThumbnails() {}\n');
writeStub('js/ui/panels/properties-panel.mjs', `
export function showProperties() {}
export function showMultiSelectionProperties() {}
export function hideProperties() {}
`);
writeStub('js/annotations/rendering.mjs', `
export function redrawAnnotations() {}
export function redrawContinuous() {}
export function updateQuickAccessButtons() {}
`);
writeStub('js/solid/stores/leftPanelStore.mjs',
  "export function activeTab() { return 'none'; }\n");
writeStub('js/ui/panels/bookmarks.mjs',
  'export function updateBookmarksList() {}\n');
writeStub('js/bridge.mjs', `
import { recordPropertyChange } from './core/undo-manager.mjs';
import { documentState } from './core/state.mjs';
let active = false;
export let lastInput = null;
export let updateCount = 0;
export function showParametricLabelInput(options) {
  active = true;
  lastInput = options;
}
export function hideParametricLabelInput() { active = false; }
export function parametricLabelInputActive() { return active; }
export function updateAnnotProp(key, value) {
  updateCount++;
  const annotation = documentState.selectedAnnotation;
  recordPropertyChange(annotation);
  annotation[key] = value;
}
export function validateSymbolParams(_symbolId, params) {
  return {
    ...params,
    aantal: Number(params.aantal),
  };
}
`);
const pageEditing = await import(pathToFileURL(
  stageMjs('js/tools/parametric-symbol-editing.js'),
).href);
const pageState = await import(pathToFileURL(join(tmp, 'js/core/state.mjs')).href);
const pageBridge = await import(pathToFileURL(join(tmp, 'js/bridge.mjs')).href);
const pageAnnotation = {
  id: 'staaf-op-pagina-1',
  type: 'parametricSymbol',
  symbolId: 'wapeningsstaaf',
  page: 1,
  params: { ...barParams },
  rotation: 0,
  ...lineBox,
};
pageState.documentState.annotations = [pageAnnotation];
pageState.documentState.selectedAnnotation = pageAnnotation;
pageState.documentState.selectedAnnotations = [pageAnnotation];
pageEditing.startParametricSymbolInput(pageAnnotation, local.x, local.y);
ok(!!pageBridge.lastInput, 'labelinvoer opent op de actuele pagina');
pageState.documentState.currentPage = 2;
ok(pageBridge.lastInput?.locate() === null,
  'locator verdwijnt zodra enkelpaginaweergave naar een andere pagina wisselt');
pageBridge.lastInput?.commit({ aantal: 9 });
ok(pageBridge.updateCount === 0,
  'buitenklikcommit na paginawissel voert geen annotatie-update uit');
ok(pageAnnotation.params.aantal === barParams.aantal,
  'paginawissel laat de bestaande labelparameters ongemoeid');

console.log('\n== Undo, annuleren en redo');
const undoManager = await import(pathToFileURL(
  join(tmp, 'js/core/undo-manager.mjs'),
).href);
pageState.documentState.currentPage = 1;
pageState.documentState.undoStack = [];
pageState.documentState.redoStack = [];
pageAnnotation.params = { ...barParams };
pageEditing.startParametricSymbolInput(pageAnnotation, local.x, local.y);
pageBridge.lastInput?.commit({ aantal: '9' });
await Promise.resolve();
undoManager.flushPropertyChange();
ok(pageState.documentState.undoStack.length === 1,
  'labelbevestiging maakt precies één undo-snapshot');
ok(pageAnnotation.params.aantal === 9,
  'labelbevestiging schrijft de genormaliseerde parameter');
await undoManager.undo();
ok(pageAnnotation.params.aantal === barParams.aantal,
  'undo herstelt de parameter van vóór labelbevestiging');
await undoManager.redo();
ok(pageAnnotation.params.aantal === 9,
  'redo herstelt de bevestigde labelparameter');

pageState.documentState.undoStack = [];
pageState.documentState.redoStack = [];
pageAnnotation.params = { ...barParams };
pageEditing.startParametricSymbolInput(pageAnnotation, local.x, local.y);
pageBridge.lastInput?.cancel();
pageBridge.hideParametricLabelInput();
await Promise.resolve();
undoManager.flushPropertyChange();
ok(pageState.documentState.undoStack.length === 0,
  'Escape-annulering maakt geen undo-snapshot');
ok(pageAnnotation.params.aantal === barParams.aantal,
  'Escape-annulering laat de parameter ongemoeid');

console.log('\n== Buitenklik- en toolwisseleventvolgorde');
const { createOutsideCommitController } = await import(pathToFileURL(
  stageMjs('js/solid/components/parametric-label-outside-events.js'),
).href);
let editorActive = true;
let commitCount = 0;
const editorRoot = {
  contains(target) {
    return target?.area === 'editor';
  },
};
const outsideController = createOutsideCommitController({
  isActive: () => editorActive,
  commit: () => { commitCount++; },
  isCanvasTarget: (target) => target?.area === 'canvas',
});
const toolbarTarget = { area: 'toolbar' };
outsideController.pointerDown({ target: toolbarTarget }, editorRoot);
editorActive = false; // setTool annuleert tijdens de toolbar-clickhandler.
outsideController.click({ target: toolbarTarget }, editorRoot);
ok(commitCount === 0,
  'pointerdown gevolgd door toolwissel annuleert zonder voorafgaande commit');

editorActive = true;
const panelTarget = { area: 'panel' };
outsideController.pointerDown({ target: panelTarget }, editorRoot);
outsideController.click({ target: panelTarget }, editorRoot);
ok(commitCount === 1, 'gewone niet-canvas-buitenklik commit na de clickhandler');

const canvasTarget = { area: 'canvas' };
outsideController.pointerDown({ target: canvasTarget }, editorRoot);
ok(commitCount === 2, 'canvas-buitenklik commit vóór de canvashandler');
outsideController.click({ target: canvasTarget }, editorRoot);
ok(commitCount === 2, 'canvas-buitenklik commit niet dubbel op click');

console.log('\n== Focusteruggave');
const focusHelperPath = join(
  appRoot,
  'js/solid/components/parametric-label-focus.js',
);
ok(existsSync(focusHelperPath), 'geteste focushulp bestaat');
if (existsSync(focusHelperPath)) {
  const focusModule = await import(pathToFileURL(
    stageMjs('js/solid/components/parametric-label-focus.js'),
  ).href);
  let previousFocusCount = 0;
  const previousFocus = {
    isConnected: true,
    focus(options) {
      if (options?.preventScroll) previousFocusCount++;
    },
  };
  const fallbackCanvas = {
    isConnected: true,
    focus() {},
  };
  const focusDocument = {
    activeElement: previousFocus,
    body: {},
    querySelector: () => fallbackCanvas,
  };
  const rememberedFocus = focusModule.captureParametricLabelReturnFocus(focusDocument);
  focusModule.restoreParametricLabelFocus(rememberedFocus);
  ok(previousFocusCount === 1,
    'sluiten na Enter of Escape geeft focus terug aan het vorige element');
  focusDocument.activeElement = focusDocument.body;
  ok(focusModule.captureParametricLabelReturnFocus(focusDocument) === fallbackCanvas,
    'zonder bruikbare vorige focus wordt het annotatiecanvas onthouden');
}

console.log('\n== Editor- en lifecyclecontract');
const source = (relPath) => readFileSync(join(appRoot, relPath), 'utf8');
const storeSource = source('js/solid/stores/parametricLabelInputStore.js');
const editorSource = source('js/solid/components/ParametricLabelInlineEditor.jsx');
const bridgeSource = source('js/tools/parametric-symbol-editing.js');
const dispatcherSource = source('js/tools/tool-dispatcher.js');
const managerSource = source('js/tools/manager.js');
const dialogHostSource = source('js/solid/components/DialogHost.jsx');
const cssSource = source('styles/dialogs.css');
const solidBridgeSource = source('js/bridge.ts');

for (const signal of ['active', 'anchor', 'fields', 'values', 'onCommit', 'onCancel', 'locator']) {
  ok(storeSource.includes(`const [${signal},`), `store bewaart ${signal}`);
}
ok(editorSource.includes('<For each={fields()}>'), 'editor rendert generieke velddefinities');
ok(editorSource.includes("e.key === 'Enter'") && editorSource.includes('commit()'),
  'Enter bevestigt de editor');
ok(editorSource.includes("e.key === 'Escape'") && editorSource.includes('cancel()'),
  'Escape annuleert de editor');
ok(editorSource.includes('e.stopPropagation()'), 'toetsen lekken niet naar canvassneltoetsen');
ok(editorSource.includes('captureParametricLabelReturnFocus')
  && editorSource.includes('restoreParametricLabelFocus'),
'editor herstelt focus via de geteste focushulp');
ok(editorSource.includes("document.addEventListener('pointerdown', onOutsidePointerDown, true)")
  && editorSource.includes("window.addEventListener('click', onOutsideClick)"),
'editor onderscheidt directe canvascommit van toolwisselgevoelige click');
ok(editorSource.includes('requestAnimationFrame(tick)') && editorSource.includes('if (!pos)'),
  'editor volgt de locator en sluit als die verdwijnt');
ok(bridgeSource.includes('findEditableLabel(annotation, x, y)'),
  'vanilla brug zoekt het aangeklikte label');
ok(bridgeSource.includes('validateSymbolParams(annotation.symbolId, nextParams)'),
  'commit normaliseert alle parameters');
ok((bridgeSource.match(/updateAnnotProp\('params',/g) || []).length === 1,
  'brug bevat één volledige params-update');
ok(dispatcherSource.includes("clicked.type === 'parametricSymbol'")
  && dispatcherSource.includes('startParametricSymbolInput(clicked, coords.x, coords.y)'),
'dubbelklik opent parametrische labelinvoer');
ok(managerSource.includes('cancelParametricSymbolInput()'),
  'toolwissel annuleert parametrische labelinvoer');
ok(managerSource.includes(
  "import { cancelParametricSymbolInput } from './parametric-symbol-editing.js';",
), 'toolwissel heeft een synchrone cancelimport');
ok(dialogHostSource.includes('<ParametricLabelInlineEditor />'),
  'generieke editor is in DialogHost gemonteerd');
ok(cssSource.includes('.parametric-label-inline-editor'),
  'generieke editor heeft thema-opmaak');
ok(solidBridgeSource.includes('showParametricLabelInput')
  && solidBridgeSource.includes('hideParametricLabelInput'),
'Solid-store is via de vanilla bridge ontsloten');
ok(solidBridgeSource.includes('validateSymbolParams'),
  'parametervalidatie is via de vanilla bridge ontsloten');
ok(!bridgeSource.includes(
  "from '../solid/stores/parametricSymbolStore.js'",
), 'vanilla editing importeert geen Solid-store rechtstreeks');

if (failures) {
  console.error(`\n${failures} van ${checks} controles mislukt.`);
  process.exit(1);
}
console.log(`\nOK: ${checks} controles geslaagd.`);
