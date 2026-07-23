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
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log('PASS test-parametric-symbol-defaults');
