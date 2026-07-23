// Gerichte regressietest voor de tweepuntsplaatsing van Wapeningsstaaf.
// Draaien: node scripts/test-wapeningsstaaf-two-point.mjs

import {
  existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const geometryPath = join(appRoot, 'js/symbols/two-point.js');

let failures = 0;
let checks = 0;
function ok(condition, message) {
  checks++;
  if (condition) return;
  failures++;
  console.error(`  FOUT: ${message}`);
}
function near(actual, expected, tolerance, message) {
  ok(Math.abs(actual - expected) <= tolerance,
    `${message} (${actual} != ${expected}, tolerantie ${tolerance})`);
}

console.log('\n== Pure tweepuntsgeometrie');
ok(existsSync(geometryPath), 'gedeelde tweepuntsgeometrie bestaat');
if (existsSync(geometryPath)) {
  const source = readFileSync(geometryPath, 'utf8');
  const geometry = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const ann = { type: 'parametricSymbol', symbolId: 'wapeningsstaaf', height: 24 };
  geometry.syncTwoPointGeometry(ann, 10, 20, 110, 120, 24);
  near(ann.startX, 10, 1e-9, 'beginpunt blijft exact');
  near(ann.startY, 20, 1e-9, 'beginpunt-y blijft exact');
  near(ann.endX, 110, 1e-9, 'eindpunt blijft exact');
  near(ann.endY, 120, 1e-9, 'eindpunt-y blijft exact');
  near(ann.width, Math.sqrt(20000), 1e-9, 'bbox-breedte volgt puntafstand');
  near(ann.rotation, 45, 1e-9, 'vrije richting wordt uit punten afgeleid');
  near(ann.x + ann.width / 2, 60, 1e-9, 'bbox staat rond lijnmidden');
  near(ann.y + ann.height / 2, 70, 1e-9, 'bbox-y staat rond lijnmidden');
  const angle = ann.rotation * Math.PI / 180;
  const cx = ann.x + ann.width / 2;
  const cy = ann.y + ann.height / 2;
  const rotate = (x, y) => ({
    x: cx + (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle),
    y: cy + (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle),
  });
  const renderedStart = rotate(ann.x, cy);
  const renderedEnd = rotate(ann.x + ann.width, cy);
  near(renderedStart.x, ann.startX, 1e-9, 'geroteerde basislijn begint op punt 1');
  near(renderedStart.y, ann.startY, 1e-9, 'geroteerde basislijn begint op punt 1-y');
  near(renderedEnd.x, ann.endX, 1e-9, 'geroteerde basislijn eindigt op punt 2');
  near(renderedEnd.y, ann.endY, 1e-9, 'geroteerde basislijn eindigt op punt 2-y');

  const restored = geometry.twoPointEndpoints({
    x: ann.x, y: ann.y, width: ann.width, height: ann.height, rotation: ann.rotation,
  });
  near(restored.startX, 10, 1e-9, 'legacy bbox herstelt beginpunt');
  near(restored.endY, 120, 1e-9, 'legacy bbox herstelt eindpunt');

  geometry.resizeTwoPointGeometry(ann, 200, 30);
  near(Math.hypot(ann.endX - ann.startX, ann.endY - ann.startY), 200, 1e-9,
    'parametrische lengte vergroot de afstand rond het midden');
  near(ann.height, 30, 1e-9, 'parametrische hoogte wordt bijgewerkt');
}

console.log('\n== Integratie plaatsing en bewerking');
const templateSource = readFileSync(join(appRoot, 'js/symbols/templates/wapening-lijn.js'), 'utf8');
const creatorSource = readFileSync(join(appRoot, 'js/tools/annotation-creators.js'), 'utf8');
const handlesSource = readFileSync(join(appRoot, 'js/annotations/handles.js'), 'utf8');
const transformsSource = readFileSync(join(appRoot, 'js/annotations/transforms.js'), 'utf8');
const realSizeSource = readFileSync(join(appRoot, 'js/symbols/real-size.js'), 'utf8');
const snapSource = readFileSync(join(appRoot, 'js/tools/snap-engine.js'), 'utf8');
const propertiesSource = readFileSync(join(appRoot, 'js/solid/stores/propertiesStore.js'), 'utf8');
const renderingSource = readFileSync(join(appRoot, 'js/annotations/rendering.js'), 'utf8');

ok(/wapeningsstaafTemplate\s*=\s*\{[\s\S]*?placement:\s*'two-point'/.test(templateSource),
  'alleen de wapeningsstaaf declareert tweepuntsplaatsing');
ok(!templateSource.split('export const netwapeningTemplate = {')[1].includes("placement: 'two-point'"),
  'netwapening blijft een bbox-symbool');
ok(creatorSource.includes('syncTwoPointGeometry'),
  'creator bewaart begin- en eindpunt');
ok(handlesSource.includes('twoPointEndpoints'),
  'selectie gebruikt twee eindpunt-grips');
ok(transformsSource.includes('syncTwoPointGeometry'),
  'slepen van een grip synchroniseert hoek, bbox en punten');
ok(realSizeSource.includes('resizeTwoPointGeometry'),
  'lengte-invoer schaalt het tweepuntselement');
ok(snapSource.includes("tpl?.placement === 'two-point'"),
  'object snap gebruikt de echte twee punten');
ok(propertiesSource.includes("import { applyTemplateRealSize } from '../../symbols/real-size.js'"),
  'lengtewijziging synchroniseert geometrie voor de undo-snapshot');
ok(renderingSource.includes('rotatedRectAabb(annotation)'),
  'viewport-culling gebruikt de geroteerde zichtbare begrenzing');

const mathSource = readFileSync(join(appRoot, 'js/utils/math.js'), 'utf8');
const math = await import(`data:text/javascript;base64,${Buffer.from(mathSource).toString('base64')}`);
ok(typeof math.rotatedRectAabb === 'function', 'geroteerde AABB-helper bestaat');
if (typeof math.rotatedRectAabb === 'function') {
  const vertical = math.rotatedRectAabb({
    x: -900, y: 990, width: 2000, height: 20, rotation: 90,
  });
  near(vertical.x, 90, 1e-9, 'verticale staaf krijgt smalle zichtbare x-AABB');
  near(vertical.y, 0, 1e-9, 'verticale staaf reikt zichtbaar tot bovenaan');
  near(vertical.width, 20, 1e-9, 'verticale AABB gebruikt banddikte');
  near(vertical.height, 2000, 1e-9, 'verticale AABB gebruikt staaflengte');
}

console.log('\n== PDF- en XFDF-rondreis');
const saverSource = readFileSync(join(appRoot, 'js/pdf/saver.js'), 'utf8');
const colorsSource = readFileSync(join(appRoot, 'js/pdf/loader/color-extraction.js'), 'utf8');
const converterSource = readFileSync(join(appRoot, 'js/pdf/loader/annotation-converter.js'), 'utf8');
const xfdfSource = readFileSync(join(appRoot, 'js/annotations/xfdf.js'), 'utf8');
ok(saverSource.includes('OPS_TwoPoint'), 'PDF bewaart beide punten in PDF-coordinaten');
ok(colorsSource.includes("PDFName.of('OPS_TwoPoint')"), 'PDF-loader leest beide punten');
ok(converterSource.includes('extraColors.opsTwoPoint'), 'PDF-converter herstelt beide punten');
ok(xfdfSource.includes('opstwopoint='), 'XFDF bewaart beide punten');
ok(xfdfSource.includes("getAttribute('opstwopoint')"), 'XFDF-loader herstelt beide punten');

console.log('\n== Werkelijke parameter-rondreis');
const markerFixture = {
  aantal: 3,
  diameter: 8,
  lengte: 1600,
  markerAantal: 4,
  markerPositie: 50,
  markerRichting: 'onder',
};
const persistenceTmp = mkdtempSync(join(tmpdir(), 'opds-parametric-persistence-'));

function stageWithDependencies(name, relPath, dependencies, append = '') {
  const depsPath = join(persistenceTmp, `${name}-deps.mjs`);
  const modulePath = join(persistenceTmp, `${name}.mjs`);
  writeFileSync(depsPath, dependencies);
  const staged = readFileSync(join(appRoot, relPath), 'utf8')
    .replace(/from\s+['"][^'"]+['"]/g, `from '${pathToFileURL(depsPath).href}'`);
  writeFileSync(modulePath, `${staged}${append}`);
  return modulePath;
}

try {
  const converterPath = stageWithDependencies(
    'annotation-converter',
    'js/pdf/loader/annotation-converter.js',
    `
export const state = {};
export const imageCache = new Map();
export function createAnnotation(props) { return { id: 'pdf-restored', ...props }; }
export function generateImageId() { return 'image-id'; }
export function colorArrayToHex(_value, fallback) { return fallback; }
export function mapPdfFontName(value) { return value; }
export function mapBorderStyle(value) { return value; }
export function calculateDistance() { return { value: 0, unit: 'mm', pixels: 0 }; }
export function calculateArea() { return { value: 0, unit: 'mm2' }; }
export function calculatePerimeter() { return { value: 0, unit: 'mm' }; }
export function formatMeasurement() { return '0 mm'; }
export function findImageForAnnotation() { return null; }
export function ifcCategoryForAnnotationType() { return ''; }
export function ifcCategoryForParametric() { return 'IfcReinforcingBar'; }
export const STAVENREEKS_DEFAULTS = {};
export function syncTwoPointGeometry(annotation, startX, startY, endX, endY, height) {
  Object.assign(annotation, { startX, startY, endX, endY, height });
}
`,
  );
  const converter = await import(pathToFileURL(converterPath).href);
  const pdfMetadata = {
    opsSubtype: 'parametricSymbol',
    opsSymbolId: 'wapeningsstaaf',
    opsParams: JSON.stringify(markerFixture),
    opsIfcCategory: 'IfcReinforcingBar',
  };
  const pdfRestored = await converter.convertPdfAnnotation(
    {
      subtype: 'Square',
      rect: [0, 0, 320, 48],
      color: [0, 0, 0],
      annotationFlags: 4,
      borderStyle: { width: 1 },
    },
    1,
    {
      convertToViewportPoint: (x, y) => [x, y],
      convertToViewportRectangle: (rect) => rect,
    },
    new Map(),
    new Map([['0,0,320,48', pdfMetadata]]),
  );
  ok(pdfRestored.params.markerAantal === 4,
    'PDF-metadataherstel bewaart markerAantal 4');
  ok(pdfRestored.params.markerRichting === 'onder',
    'PDF-metadataherstel bewaart markerRichting onder');

  globalThis.__xfdfDocument = {
    filePath: 'wapening.pdf',
    annotations: [{
      id: 'staaf-1',
      type: 'parametricSymbol',
      page: 1,
      x: 0,
      y: 0,
      width: 320,
      height: 48,
      symbolId: 'wapeningsstaaf',
      params: { ...markerFixture },
      strokeColor: '#000000',
      lineWidth: 1,
      rotation: 0,
      opacity: 1,
      printable: true,
    }],
  };
  const xfdfPath = stageWithDependencies(
    'xfdf',
    'js/annotations/xfdf.js',
    `
export const state = {};
export function getActiveDocument() { return globalThis.__xfdfDocument; }
export function createAnnotation(props) { return { id: 'xfdf-restored', ...props }; }
export function cloneAnnotation(value) { return JSON.parse(JSON.stringify(value)); }
export function recordBulkAdd() {}
export function redrawAnnotations() {}
export function redrawContinuous() {}
export function updateStatusMessage() {}
export const isTauri = false;
export async function readBinaryFile() { return null; }
export async function writeBinaryFile() {}
export async function saveFileDialog() { return null; }
export async function openFileDialog() { return null; }
export default { t(key) { return key; } }
export function showMessage() {}
export function ifcCategoryForParametric() { return 'IfcReinforcingBar'; }
export function syncTwoPointGeometry(annotation, startX, startY, endX, endY, height) {
  Object.assign(annotation, { startX, startY, endX, endY, height });
}
`,
    '\nexport { xfdfElementToAnnotation };\n',
  );
  const xfdf = await import(pathToFileURL(xfdfPath).href);
  const xml = xfdf.exportToXFDF();
  const squareTag = xml.match(/<square\s+[^>]*opstype="parametricSymbol"[^>]*>/)?.[0] || '';
  const attrs = {};
  for (const match of squareTag.matchAll(/([\w-]+)="([^"]*)"/g)) {
    attrs[match[1]] = match[2]
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&');
  }
  const xfdfRestored = xfdf.xfdfElementToAnnotation({
    localName: 'square',
    getAttribute: (name) => attrs[name] ?? null,
    querySelector: (name) => (name === 'contents' ? { textContent: '' } : null),
    querySelectorAll: () => [],
  });
  ok(xfdfRestored.params.markerAantal === 4,
    'XFDF-export en -import bewaren markerAantal 4');
  ok(xfdfRestored.params.markerRichting === 'onder',
    'XFDF-export en -import bewaren markerRichting onder');

  globalThis.__clipboardState = {
    defaultAuthor: 'Test',
    clipboardAnnotation: null,
    clipboardAnnotations: null,
    _pasteSeq: 0,
  };
  globalThis.__clipboardDocument = {
    pdfDoc: {},
    currentPage: 1,
    viewMode: 'single',
    annotations: [],
    selectedAnnotation: null,
    selectedAnnotations: [],
  };
  const clipboardPath = stageWithDependencies(
    'clipboard',
    'js/annotations/clipboard.js',
    `
export const state = globalThis.__clipboardState;
export function getActiveDocument() { return globalThis.__clipboardDocument; }
export const imageCache = new Map();
export function cloneAnnotation(value) { return JSON.parse(JSON.stringify(value)); }
export function cloneAnnotationsInPlace(values) {
  return values.map((value) => JSON.parse(JSON.stringify(value)));
}
export function generateImageId() { return 'image-id'; }
export function updateStatusMessage() {}
export function showProperties() {}
export function showMultiSelectionProperties() {}
export function redrawAnnotations() {}
export function redrawContinuous() {}
export const annotationCanvas = null;
export const pdfContainer = null;
export function recordAdd() {}
export function recordBulkAdd() {}
`,
  );
  const clipboard = await import(pathToFileURL(clipboardPath).href);
  clipboard.copyAnnotation(globalThis.__xfdfDocument.annotations[0]);
  clipboard.pasteAnnotation();
  const pasted = globalThis.__clipboardDocument.annotations[0];
  ok(pasted.params.markerAantal === 4,
    'kopiëren en plakken bewaren markerAantal 4');
  ok(pasted.params.markerRichting === 'onder',
    'kopiëren en plakken bewaren markerRichting onder');
} finally {
  delete globalThis.__xfdfDocument;
  delete globalThis.__clipboardState;
  delete globalThis.__clipboardDocument;
  rmSync(persistenceTmp, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} van ${checks} controles mislukt.`);
  process.exit(1);
}
console.log(`\nOK: ${checks} controles geslaagd.`);
