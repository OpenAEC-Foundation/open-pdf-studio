import { ok, strictEqual, deepStrictEqual } from 'node:assert';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url);
const sourcePath = (path) => new URL(path, root);
const preferencesSource = await readFile(sourcePath('js/types/preferences.ts'), 'utf8');
const constantsSource = await readFile(sourcePath('js/core/constants.ts'), 'utf8');
const storeSource = await readFile(sourcePath('js/solid/stores/parametricSymbolStore.js'), 'utf8');
const managerSource = await readFile(sourcePath('js/tools/manager.js'), 'utf8');
const creatorSource = await readFile(sourcePath('js/tools/annotation-creators.js'), 'utf8');

ok(preferencesSource.includes('parametricSymbolDefaults'),
  'voorkeurenschema bevat parametrische symboolwaarden');
ok(constantsSource.includes('parametricSymbolDefaults: {}'),
  'standaardvoorkeuren starten met lege parametrische symboolwaarden');
ok(storeSource.includes('export function resolveSymbolParams'),
  'store levert gevalideerde effectieve parameters');
ok(managerSource.includes("tool === 'parametricSymbol'"),
  'manager toont voor parametrische plaatsing eigenschappen');
ok(creatorSource.includes('pendingParams()'),
  'creator gebruikt actieve waarden in plaats van kale sjabloondefaults');

const tempDir = await mkdtemp(join(tmpdir(), 'parametric-symbol-defaults-'));
const stubDir = join(tempDir, 'stubs');

try {
  await mkdir(stubDir);
  const statePath = join(stubDir, 'state.mjs');
  const preferencesPath = join(stubDir, 'preferences.mjs');
  const registryPath = join(stubDir, 'registry.mjs');
  const solidPath = join(stubDir, 'solid.mjs');
  const stagedStorePath = join(tempDir, 'parametricSymbolStore.mjs');

  await writeFile(solidPath, `
export function createSignal(initial) {
  let value = initial;
  return [() => value, (next) => { value = typeof next === 'function' ? next(value) : next; return value; }];
}
`);
  await writeFile(statePath, 'export const state = { preferences: { parametricSymbolDefaults: {} } };\n');
  await writeFile(preferencesPath, 'export function savePreferences() {}\n');
  await writeFile(registryPath, `
const templates = {
  door: { params: [
    { key: 'width', type: 'number', default: 900, min: 100, max: 4000 },
    { key: 'showWall', type: 'boolean', default: false },
  ] },
  window: { params: [
    { key: 'width', type: 'number', default: 1200, min: 200, max: 6000 },
  ] },
};
export const getTemplate = (id) => templates[id] || null;
export const listTemplates = () => Object.values(templates);
export const defaultParams = (template) => Object.fromEntries((template?.params || []).map((param) => [param.key, param.default]));
`);

  const stagedStore = storeSource
    .replace("from 'solid-js'", `from '${pathToFileURL(solidPath).href}'`)
    .replace("from '../../core/state.js'", `from '${pathToFileURL(statePath).href}'`)
    .replace("from '../../core/preferences.js'", `from '${pathToFileURL(preferencesPath).href}'`)
    .replace("from '../../symbols/registry.js'", `from '${pathToFileURL(registryPath).href}'`)
    .replace("import('../../core/preferences.js')", `import('${pathToFileURL(preferencesPath).href}')`);
  await writeFile(stagedStorePath, stagedStore);

  const store = await import(`${pathToFileURL(stagedStorePath).href}?${Date.now()}`);
  const state = await import(pathToFileURL(statePath).href);
  store.setPendingSymbolId('door');
  store.setPendingParams({ width: 1200, showWall: true });
  store.setPendingSymbolId('window');
  store.setPendingParams({ width: 1800 });

  deepStrictEqual(store.resolveSymbolParams('door'), { width: 1200, showWall: true },
    'elke sjabloon bewaart eigen gevalideerde waarden');
  strictEqual(store.resolveSymbolParams('window').width, 1800,
    'een tweede symbool gebruikt zijn eigen opgeslagen waarde');
  state.state.preferences.parametricSymbolDefaults.door.width = 'ongeldig';
  strictEqual(store.resolveSymbolParams('door').width, 900,
    'ongeldige numerieke waarden vallen terug op de sjabloonstandaard');

  const managerDir = join(tempDir, 'manager', 'js', 'tools');
  const managerStoresDir = join(tempDir, 'manager', 'js', 'solid', 'stores');
  const managerCoreDir = join(tempDir, 'manager', 'js', 'core');
  await mkdir(managerDir, { recursive: true });
  await mkdir(managerStoresDir, { recursive: true });
  await mkdir(managerCoreDir, { recursive: true });

  const managerDepsPath = join(tempDir, 'manager', 'deps.mjs');
  await writeFile(managerDepsPath, `
export const state = globalThis.__managerState;
export function getActiveDocument() { return globalThis.__managerDocument; }
export function hideProperties() { globalThis.__managerPanel.current = null; }
export function redrawAnnotations() {}
export function redrawContinuous() {}
export function updateStatusTool() {}
export function isPdfAReadOnly() { return false; }
export function getAnnotationType() { return null; }
export function getTool() { return null; }
export function buildToolContext() { return {}; }
export function resolvePointerCoords() { return { x: 0, y: 0 }; }
export function findAnnotationAt() { return null; }
export function findHandleAt() { return null; }
export function cancelParametricSymbolInput() {}
`);
  await writeFile(join(managerStoresDir, 'parametricSymbolStore.mjs'), `
export function pendingSymbolId() { return 'wapeningsstaaf'; }
export function pendingParams() { return { markerAantal: 4, markerRichting: 'onder' }; }
`);
  await writeFile(join(managerStoresDir, 'propertiesStore.mjs'), `
async function waitForGate() {
  const gate = globalThis.__managerDefaultsGate;
  if (gate) await gate;
}
export async function showToolDefaults(tool, overrides, shouldShow) {
  await waitForGate();
  if (typeof shouldShow === 'function' && !shouldShow()) return false;
  globalThis.__managerPanel.current = {
    id: '__tool-defaults__',
    type: tool,
    ...overrides,
  };
  return true;
}
export function hideToolDefaults() {
  if (globalThis.__managerPanel.current?.id !== '__tool-defaults__') return false;
  globalThis.__managerPanel.current = null;
  return true;
}
`);
  await writeFile(join(managerCoreDir, 'preferences.mjs'), `
export function getStyleMapping() { return null; }
`);
  await writeFile(join(managerDir, 'stavenreeks-editing.mjs'),
    'export function cancelStavenreeksInput() {}\n');
  await writeFile(join(managerDir, 'text-edit-tool.mjs'),
    'export function deactivateEditTextTool() {}\nexport function activateEditTextTool() {}\n');

  const stagedManagerSource = managerSource
    .replace(/from\s+['"][^'"]+['"]/g, `from '${pathToFileURL(managerDepsPath).href}'`)
    .replace(/(import\(\s*['"])(\.{1,2}\/[^'"]+)\.js(['"]\s*\))/g, '$1$2.mjs$3');
  const stagedManagerPath = join(managerDir, 'manager.mjs');
  await writeFile(stagedManagerPath, stagedManagerSource);

  globalThis.__managerState = {
    currentTool: 'select',
    preferences: {},
    toolOverrides: null,
  };
  globalThis.__managerDocument = {
    viewMode: 'single',
    selectedAnnotation: null,
    selectedAnnotations: [],
  };
  globalThis.__managerPanel = { current: null };
  globalThis.__managerDefaultsGate = null;
  globalThis.document = {
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = {};

  const manager = await import(`${pathToFileURL(stagedManagerPath).href}?${Date.now()}`);
  const settleManager = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  manager.setTool('parametricSymbol');
  await settleManager();
  strictEqual(globalThis.__managerPanel.current?.id, '__tool-defaults__',
    'parametrische keuze toont een synthetisch eigenschappenobject');
  manager.setTool('select');
  await settleManager();
  strictEqual(globalThis.__managerPanel.current, null,
    'terugschakelen naar select ruimt het actuele synthetische object op');

  const realSelection = { id: 'annotatie-1', type: 'line' };
  globalThis.__managerPanel.current = realSelection;
  manager.setTool('select');
  await settleManager();
  strictEqual(globalThis.__managerPanel.current, realSelection,
    'select bewaart een werkelijk geselecteerd eigenschappenobject');

  let releaseDefaults;
  globalThis.__managerPanel.current = null;
  globalThis.__managerDefaultsGate = new Promise((resolve) => {
    releaseDefaults = resolve;
  });
  manager.setTool('parametricSymbol');
  manager.setTool('select');
  releaseDefaults();
  await settleManager();
  strictEqual(globalThis.__managerPanel.current, null,
    'een vertraagde defaults-aanvraag mag na een toolwissel niet terugkeren');

  const creatorDepsPath = join(tempDir, 'annotation-creator-deps.mjs');
  await writeFile(creatorDepsPath, `
export const state = {
  preferences: { enableAngleSnap: false },
  toolOverrides: null,
  currentPath: [],
};
export function getActiveDocument() {
  return globalThis.__creatorDocument;
}
export function getColorPickerValue() { return '#000000'; }
export function getLineWidthValue() { return 1; }
export function createAnnotation(props) { return { id: 'created', ...props }; }
export function snapAngle(value) { return value; }
export function calculateDistance() { return { value: 0, unit: 'mm', pixels: 0 }; }
export function calculateArea() { return { value: 0, unit: 'mm2' }; }
export function calculatePerimeter() { return { value: 0, unit: 'mm' }; }
export function formatMeasurement() { return '0 mm'; }
export function snapDistanceTo10(value) { return value; }
export function getAnnotationType() { return null; }
export function applyDynamicScaling() {}
export function getTemplate() { return null; }
export function pxPerMmAt() { return 1; }
export function syncTwoPointGeometry() {}
export function syncTwoPointLengthParam() {}
export function pendingParams() { return {}; }
export function pendingSymbolId() { return 'onbekend-sjabloon'; }
export function activeCountCategory() { return null; }
export function nextCountNumber() { return 1; }
export function ifcCategoryForParametric() { return ''; }
export function ifcCategoryForAnnotationType() { return ''; }
export const STAVENREEKS_DEFAULTS = {};
`);
  const stagedCreatorPath = join(tempDir, 'annotation-creators.mjs');
  await writeFile(stagedCreatorPath, creatorSource.replace(
    /from\s+['"][^'"]+['"]/g,
    `from '${pathToFileURL(creatorDepsPath).href}'`,
  ));
  globalThis.__creatorDocument = { currentPage: 1, annotations: [] };
  const creators = await import(`${pathToFileURL(stagedCreatorPath).href}?${Date.now()}`);
  strictEqual(
    creators.buildAnnotationProps('parametricSymbol', 10, 20, 10, 20, null),
    null,
    'een onbekend parametrisch sjabloon levert geen plaatsbare eigenschappen',
  );
  deepStrictEqual(globalThis.__creatorDocument.annotations, [],
    'een onbekend parametrisch sjabloon muteert het document niet');
} finally {
  delete globalThis.__managerState;
  delete globalThis.__managerDocument;
  delete globalThis.__managerPanel;
  delete globalThis.__managerDefaultsGate;
  delete globalThis.__creatorDocument;
  await rm(tempDir, { recursive: true, force: true });
}

console.log('PASS test-parametric-symbol-defaults');
