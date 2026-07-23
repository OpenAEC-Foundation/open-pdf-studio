// Gerichte regressietest voor de parametrische constructiesymbolen in
// NL IFC Bouw. Draaien: node scripts/test-nl-ifc-parametric-components.mjs

import {
  existsSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const required = [
  'js/symbols/templates/wapening-lijn.js',
  'js/symbols/templates/sondering.js',
  'js/symbols/templates/paalpuntniveau.js',
  'js/symbols/templates/overspanningspijl-vloer.js',
];

for (const rel of required) {
  if (!existsSync(join(appRoot, rel))) {
    console.error(`FOUT: verwacht componentbestand ontbreekt: ${rel}`);
    process.exit(1);
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'opds-nl-ifc-'));
function stageMjs(relPath) {
  const src = readFileSync(join(appRoot, relPath), 'utf8')
    .replace(/(from\s*['"])(\.{1,2}\/[^'"]+)\.js(['"])/g, '$1$2.mjs$3');
  const target = join(tmp, relPath).replace(/\.js$/, '.mjs');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, src);
  return target;
}

stageMjs('js/annotations/stavenreeks.js');
const staven = await import(pathToFileURL(join(tmp, 'js/annotations/stavenreeks.mjs')).href);
const wapening = await import(pathToFileURL(stageMjs(required[0])).href);
const sondering = await import(pathToFileURL(stageMjs(required[1])).href);
const paalpunt = await import(pathToFileURL(stageMjs(required[2])).href);
const overspanning = await import(pathToFileURL(stageMjs(required[3])).href);
const ifc = await import(pathToFileURL(stageMjs('js/solid/data/ifcCategoryMap.js')).href);

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
function paramKeys(template) {
  return template.params.map((p) => p.key);
}
function textCommands(commands) {
  return commands.filter((c) => c.kind === 'text').map((c) => c.text);
}

const {
  wapeningsstaafTemplate, netwapeningTemplate, wapeningsLabel,
} = wapening;
const { sonderingTemplate } = sondering;
const { paalpuntniveauTemplate, formatPaalpuntniveau } = paalpunt;
const { overspanningspijlVloerTemplate } = overspanning;
const templates = [
  wapeningsstaafTemplate,
  netwapeningTemplate,
  sonderingTemplate,
  paalpuntniveauTemplate,
  overspanningspijlVloerTemplate,
];

console.log('\n== Identiteit en parameters');
ok(new Set(templates.map((t) => t.id)).size === 5, 'vijf unieke template-id\'s');
ok(paramKeys(wapeningsstaafTemplate).join(',') ===
  'aantal,diameter,lengte,markerAantal,markerPositie,markerRichting',
  'wapeningsstaaf heeft alle instelbare waarden');
ok(paramKeys(netwapeningTemplate).join(',') ===
  'diameter,afstand,lengte,markerPositie,markerRichting',
  'netwapening heeft alle instelbare waarden');
ok(paramKeys(sonderingTemplate).includes('kleefmeting'), 'sondering heeft optie kleefmeting');
ok(paramKeys(paalpuntniveauTemplate).includes('niveau'), 'paalpuntniveau is numeriek instelbaar');
ok(paramKeys(overspanningspijlVloerTemplate).join(',') === 'lengte,tekst',
  'overspanningspijl heeft instelbare lengte en tekst');

console.log('\n== Wapeningsstaaf en netwapening');
ok(wapeningsLabel({ aantal: 3, diameter: 8, lengte: 1600 }) === '3 Ø8, lg=1600',
  'label wapeningsstaaf');
ok(wapeningsLabel({ net: true, diameter: 8, afstand: 150, lengte: 1600 }) ===
  'Ø8-150, lg=1600', 'label netwapening');
for (const [template, params, expected] of [
  [wapeningsstaafTemplate,
    { aantal: 3, diameter: 8, lengte: 1600, markerPositie: 25, markerRichting: 'boven' },
    '3 Ø8, lg=1600'],
  [netwapeningTemplate,
    { diameter: 8, afstand: 150, lengte: 1600, markerPositie: 75, markerRichting: 'onder' },
    'Ø8-150, lg=1600'],
]) {
  const bbox = { x: 10, y: 20, width: 800, height: 100 };
  const commands = template.render(params, bbox);
  ok(commands.some((c) => c.kind === 'line'), `${template.id}: basislijn`);
  ok(commands.some((c) => c.kind === 'polyline' && c.fill === true),
    `${template.id}: gevulde marker`);
  ok(wapeningsLabel({ ...params, net: template === netwapeningTemplate }) === expected,
    `${template.id}: samengesteld label`);
  ok(commands.filter((c) => c.role === 'diameterteken').length === 4,
    `${template.id}: vector-diameterteken (cirkel en drie lijnen)`);
  ok(!textCommands(commands).some((text) => /[Ø⌀]/u.test(text)),
    `${template.id}: diameterteken is niet van een lettertype afhankelijk`);
  near(template.realSizeMm(params).width, 1600, 1e-9, `${template.id}: werkelijke lengte`);
}
const boven = wapeningsstaafTemplate.layout(
  { aantal: 3, diameter: 8, lengte: 1000, markerPositie: 20, markerRichting: 'boven' },
  { x: 0, y: 0, width: 500, height: 100 },
);
const onder = wapeningsstaafTemplate.layout(
  { aantal: 3, diameter: 8, lengte: 1000, markerPositie: 80, markerRichting: 'onder' },
  { x: 0, y: 0, width: 500, height: 100 },
);
near(boven.markerX, 100, 1e-9, 'markerpositie 20%');
near(onder.markerX, 400, 1e-9, 'markerpositie 80%');
ok(boven.markerTipY < boven.lineY && onder.markerTipY > onder.lineY,
  'marker kan boven en onder de lijn staan');
for (const markerAantal of [1, 2, 3, 4]) {
  for (const markerRichting of ['boven', 'onder']) {
    const commands = wapeningsstaafTemplate.render({
      aantal: 3, diameter: 8, lengte: 1600,
      markerAantal, markerPositie: 50, markerRichting,
    }, { x: 0, y: 0, width: 320, height: 48 });
    const markers = commands.filter((command) => command.role === 'marker');
    ok(markers.length === markerAantal, `${markerAantal} vlaggen ${markerRichting}`);
    ok(markers.every((command) => command.points.every((point) => point.x >= 0 && point.x <= 320)),
      'vlaggen blijven binnen de staaf');
  }
}
function commandExtents(command) {
  if (command.kind === 'line') {
    return { minX: Math.min(command.x1, command.x2), maxX: Math.max(command.x1, command.x2),
      minY: Math.min(command.y1, command.y2), maxY: Math.max(command.y1, command.y2) };
  }
  if (command.kind === 'circle') {
    return { minX: command.cx - command.r, maxX: command.cx + command.r,
      minY: command.cy - command.r, maxY: command.cy + command.r };
  }
  if (command.kind === 'polyline') {
    const xs = command.points.map((p) => p.x);
    const ys = command.points.map((p) => p.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys) };
  }
  if (command.kind === 'text') {
    const halfWidth = staven.approxTextWidth(command.text, command.size) / 2;
    return { minX: command.x - halfWidth, maxX: command.x + halfWidth,
      minY: command.y - command.size * 0.6, maxY: command.y + command.size * 0.6 };
  }
  return null;
}
for (const scale of [50, 100, 200]) {
  const ptPerMm = 72 / 25.4 / scale;
  for (const markerPositie of [0, 100]) {
    const bbox = { x: 10, y: 20, width: 1600 * ptPerMm, height: 240 * ptPerMm };
    const commands = wapeningsstaafTemplate.render(
      { aantal: 3, diameter: 8, lengte: 1600, markerPositie, markerRichting: 'boven' },
      bbox,
    );
    const extents = commands.map(commandExtents).filter(Boolean);
    ok(extents.every((e) => e.minX >= bbox.x - 1e-9 && e.maxX <= bbox.x + bbox.width + 1e-9
      && e.minY >= bbox.y - 1e-9 && e.maxY <= bbox.y + bbox.height + 1e-9),
    `volledige geometrie blijft in bbox bij 1:${scale}, marker ${markerPositie}%`);
  }
}

console.log('\n== Sondering');
const sondBBox = { x: 0, y: 0, width: 160, height: 180 };
const met = sonderingTemplate.render({ nummer: '1', kleefmeting: true }, sondBBox);
const zonder = sonderingTemplate.render({ nummer: '2', kleefmeting: false }, sondBBox);
ok(met.some((c) => c.role === 'kleeflijn' && c.kind === 'line'),
  'met kleefmeting bevat horizontale kleeflijn');
ok(met.some((c) => c.role === 'conus' && c.fill === true),
  'met kleefmeting bevat gevulde conus');
ok(!zonder.some((c) => c.role === 'kleeflijn'),
  'zonder kleefmeting bevat geen horizontale kleeflijn');
ok(zonder.some((c) => c.role === 'conus' && !c.fill),
  'zonder kleefmeting blijft de conus leeg');
ok(textCommands(zonder).includes('2'), 'sonderingsnummer is instelbaar');

console.log('\n== Paalpuntniveau');
ok(formatPaalpuntniveau(14, 1, 'N.A.P.') === 'PUNTNIVEAU: 14.0 m+ N.A.P.',
  'positief paalpuntniveau');
ok(formatPaalpuntniveau(-2.5, 2, 'N.A.P.') === 'PUNTNIVEAU: 2.50 m- N.A.P.',
  'negatief paalpuntniveau');
const puntCommands = paalpuntniveauTemplate.render(
  { niveau: 14, decimalen: 1, referentie: 'N.A.P.' },
  { x: 0, y: 0, width: 500, height: 90 },
);
ok(puntCommands.some((c) => c.kind === 'polyline' && c.close), 'paalpuntniveau heeft kader');
ok(puntCommands.some((c) => c.kind === 'text' && c.bold === true),
  'paalpuntniveau gebruikt vet opschrift');

console.log('\n== Overspanningspijl vloer');
const spanParams = { lengte: 7200, tekst: 'Breedplaat overspanning' };
const spanCommands = overspanningspijlVloerTemplate.render(
  spanParams, { x: 0, y: 0, width: 720, height: 100 },
);
ok(textCommands(spanCommands).includes('Breedplaat overspanning'), 'vrije tekst wordt getoond');
ok(spanCommands.filter((c) => c.role === 'pijlpunt').length === 2,
  'overspanningspijl heeft twee pijlkoppen');
near(overspanningspijlVloerTemplate.realSizeMm(spanParams).width, 7200, 1e-9,
  'overspanningspijl volgt ingestelde lengte');
ok(overspanningspijlVloerTemplate.snapPoints(spanParams,
  { x: 0, y: 0, width: 720, height: 100 }).length === 3,
  'pijl levert begin-, midden- en eindsnappunt');

console.log('\n== Registratie, palette en IFC');
const registrySource = readFileSync(join(appRoot, 'js/symbols/registry.js'), 'utf8');
const paletteSource = readFileSync(join(appRoot, 'js/solid/data/nlSymbolLibrary.js'), 'utf8');
const ifcSource = readFileSync(join(appRoot, 'js/solid/data/ifcCategoryMap.js'), 'utf8');
const ifcExportSource = readFileSync(join(appRoot, 'js/pdf/ifc-export.js'), 'utf8');
const pdfSaverSource = readFileSync(join(appRoot, 'js/pdf/saver.js'), 'utf8');
const pdfColorsSource = readFileSync(join(appRoot, 'js/pdf/loader/color-extraction.js'), 'utf8');
const pdfConverterSource = readFileSync(join(appRoot, 'js/pdf/loader/annotation-converter.js'), 'utf8');
const xfdfSource = readFileSync(join(appRoot, 'js/annotations/xfdf.js'), 'utf8');
for (const id of templates.map((t) => t.id)) {
  ok(registrySource.includes(`register(${id === 'overspanningspijl-vloer'
    ? 'overspanningspijlVloerTemplate'
    : id.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + 'Template'})`),
  `${id}: geregistreerd`);
  ok(paletteSource.includes(`parametricId: '${id}'`), `${id}: zichtbaar in NL IFC Bouw`);
  ok(ifcSource.includes(`'${id}'`), `${id}: expliciete IFC-mapping`);
}
for (const [id, expected] of [
  ['wapeningsstaaf', 'IfcReinforcingBar'],
  ['netwapening', 'IfcReinforcingBar'],
  ['sondering', 'IfcAnnotation'],
  ['paalpuntniveau', 'IfcAnnotation'],
  ['overspanningspijl-vloer', 'IfcAnnotation'],
]) {
  ok(ifc.ifcCategoryForParametric(id) === expected,
    `${id}: IFC-mapping retourneert ${expected}`);
}
ok(typeof ifc.ifcCategoryForAnnotation === 'function',
  'centrale IFC-classificatie voor annotaties bestaat');
if (typeof ifc.ifcCategoryForAnnotation === 'function') {
  ok(ifc.ifcCategoryForAnnotation({
    type: 'parametricSymbol', symbolId: 'wapeningsstaaf',
  }) === 'IfcReinforcingBar', 'IFC-export kan classificatie uit symbolId herstellen');
  ok(ifc.ifcCategoryForAnnotation({
    type: 'parametricSymbol', symbolId: 'wapeningsstaaf', ifcCategory: 'IfcMember',
  }) === 'IfcMember', 'handmatig gewijzigde IFC-categorie heeft voorrang');
}
ok(ifcExportSource.includes('ifcCategoryForAnnotation(ann)'),
  'IFC-report gebruikt centrale annotatieclassificatie');
ok(pdfSaverSource.includes('OPS_IfcCategory'), 'PDF bewaart IFC-categorie in private metadata');
ok(pdfColorsSource.includes("PDFName.of('OPS_IfcCategory')"),
  'PDF-loader leest IFC-categorie uit private metadata');
ok(pdfConverterSource.includes('ifcCategoryForParametric(symbolId)'),
  'PDF-loader herstelt classificatie uit symbolId als metadata ontbreekt');
ok(xfdfSource.includes('opsifccategory='), 'XFDF bewaart IFC-categorie');
ok(xfdfSource.includes('ifcCategoryForParametric(symbolId)'),
  'XFDF-loader herstelt classificatie uit symbolId als attribuut ontbreekt');

if (failures) {
  console.error(`\n${failures} van ${checks} controles mislukt.`);
  process.exit(1);
}
console.log(`\nOK: ${checks} controles geslaagd.`);
