// Gerichte regressietest voor de tweepuntsplaatsing van Wapeningsstaaf.
// Draaien: node scripts/test-wapeningsstaaf-two-point.mjs

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

if (failures) {
  console.error(`\n${failures} van ${checks} controles mislukt.`);
  process.exit(1);
}
console.log(`\nOK: ${checks} controles geslaagd.`);
