// Gerichte test voor bewerkbare labels van parametrische symbolen.
// Draaien: node scripts/test-parametric-label-editing.mjs

import {
  readFileSync, writeFileSync, mkdtempSync, mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'opds-parametric-label-'));

function stageMjs(relPath) {
  const source = readFileSync(join(appRoot, relPath), 'utf8')
    .replace(/(from\s*['"])(\.{1,2}\/[^'"]+)\.js(['"])/g, '$1$2.mjs$3');
  const target = join(tmp, relPath).replace(/\.js$/, '.mjs');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
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
