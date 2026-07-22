// Regressietest voor het parametrische component Stenenrij.
// Draaien: node scripts/test-stenenrij.mjs

import {
  existsSync, readFileSync, writeFileSync, mkdtempSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const templatePath = join(appRoot, 'js/symbols/templates/stenenrij.js');
if (!existsSync(templatePath)) {
  console.error('FOUT: js/symbols/templates/stenenrij.js ontbreekt');
  process.exit(1);
}

const staged = join(mkdtempSync(join(tmpdir(), 'opds-stenenrij-')), 'stenenrij.mjs');
writeFileSync(staged, readFileSync(templatePath, 'utf8'));
const { stenenrijTemplate } = await import(pathToFileURL(staged).href);

let checks = 0;
let failures = 0;
function ok(condition, message) {
  checks++;
  if (condition) return;
  failures++;
  console.error(`FOUT: ${message}`);
}
function near(actual, expected, tolerance, message) {
  ok(Math.abs(actual - expected) <= tolerance,
    `${message} (${actual} != ${expected}, tolerantie ${tolerance})`);
}

console.log('\n== Parameters');
const keys = stenenrijTemplate.params.map((param) => param.key);
ok(keys.join(',') === 'maatType,totaleMaat,lagenmaat,koppenmaat,voeg,steenbreedte',
  'alle maatparameters zijn beschikbaar');
const maatType = stenenrijTemplate.params.find((param) => param.key === 'maatType');
const values = maatType.options.map((option) => typeof option === 'string' ? option : option.value);
ok(values.join(',') === 'lagenmaat,koppenmaat', 'keuze tussen lagenmaat en koppenmaat');

console.log('\n== Lagenmaat verticaal');
const lagen = stenenrijTemplate.layoutMm({
  maatType: 'lagenmaat', totaleMaat: 440, lagenmaat: 100,
  koppenmaat: 110, voeg: 10, steenbreedte: 100,
});
ok(lagen.orientation === 'vertical', 'lagenmaat is verticaal');
ok(lagen.stones.length === 5, '440 mm bevat vier hele en één gedeeltelijke laag');
near(lagen.stones[0].length, 90, 1e-9, 'volle steenhoogte = lagenmaat - voeg');
near(lagen.stones.at(-1).length, 40, 1e-9, 'laatste laag wordt op totale maat afgeknipt');
near(lagen.extent, 440, 1e-9, 'verticale eindmaat blijft exact');
const lagenSize = stenenrijTemplate.realSizeMm({
  maatType: 'lagenmaat', totaleMaat: 4400, lagenmaat: 100,
  koppenmaat: 110, voeg: 10, steenbreedte: 100,
});
near(lagenSize.width, 100, 1e-9, 'verticale rijbreedte');
near(lagenSize.height, 4400, 1e-9, 'verticale totale hoogte');

console.log('\n== Koppenmaat horizontaal');
const koppen = stenenrijTemplate.layoutMm({
  maatType: 'koppenmaat', totaleMaat: 350, lagenmaat: 62.5,
  koppenmaat: 110, voeg: 10, steenbreedte: 100,
});
ok(koppen.orientation === 'horizontal', 'koppenmaat is horizontaal');
ok(koppen.stones.length === 4, '350 mm bevat drie hele en één gedeeltelijke kop');
near(koppen.stones[0].length, 100, 1e-9, 'volle kopbreedte = koppenmaat - voeg');
near(koppen.stones.at(-1).length, 20, 1e-9, 'laatste kop wordt afgeknipt');
const koppenSize = stenenrijTemplate.realSizeMm({
  maatType: 'koppenmaat', totaleMaat: 350, lagenmaat: 62.5,
  koppenmaat: 110, voeg: 10, steenbreedte: 100,
});
near(koppenSize.width, 350, 1e-9, 'horizontale totale lengte');
near(koppenSize.height, 100, 1e-9, 'horizontale rijhoogte');

console.log('\n== Ongeldige en extreme invoer');
for (const voeg of [100, 120]) {
  const invalid = stenenrijTemplate.layoutMm({
    maatType: 'lagenmaat', totaleMaat: 1000, lagenmaat: 100,
    koppenmaat: 110, voeg, steenbreedte: 100,
  });
  ok(invalid.voeg === voeg, `voeg ${voeg} wordt niet stilzwijgend gewijzigd`);
  ok(invalid.valid === false, `voeg ${voeg} markeert de geometrie ongeldig`);
  ok(invalid.stones.length === 0, `voeg ${voeg} tekent geen kunstmatige steen`);
}
const stress = stenenrijTemplate.layoutMm({
  maatType: 'lagenmaat', totaleMaat: 5000, lagenmaat: 1,
  koppenmaat: 110, voeg: 0.1, steenbreedte: 100,
});
ok(stress.stoneCount === 5000, 'werkelijk aantal modules blijft bekend');
ok(stress.lod === true, 'grote stenenrij schakelt naar begrensde LOD');
if (stress.lod) {
  const stressCommands = stenenrijTemplate.render({
    maatType: 'lagenmaat', totaleMaat: 5000, lagenmaat: 1,
    koppenmaat: 110, voeg: 0.1, steenbreedte: 100,
  }, { x: 0, y: 0, width: 10, height: 500 });
  ok(stressCommands.length <= 260, 'LOD houdt het aantal tekencommando\'s begrensd');
}

console.log('\n== Render en integratie');
for (const [params, bbox] of [
  [{ maatType: 'lagenmaat', totaleMaat: 440, lagenmaat: 100, koppenmaat: 110, voeg: 10, steenbreedte: 100 },
    { x: 10, y: 20, width: 100, height: 440 }],
  [{ maatType: 'koppenmaat', totaleMaat: 350, lagenmaat: 62.5, koppenmaat: 110, voeg: 10, steenbreedte: 100 },
    { x: 10, y: 20, width: 350, height: 100 }],
]) {
  const commands = stenenrijTemplate.render(params, bbox);
  ok(commands.length === stenenrijTemplate.layoutMm(params).stones.length,
    `${params.maatType}: één rechthoek per steen`);
  ok(commands.every((command) => command.kind === 'polyline' && command.close),
    `${params.maatType}: alle stenen zijn gesloten contouren`);
  ok(commands.every((command) => command.points.every((point) =>
    point.x >= bbox.x - 1e-9 && point.x <= bbox.x + bbox.width + 1e-9
    && point.y >= bbox.y - 1e-9 && point.y <= bbox.y + bbox.height + 1e-9)),
  `${params.maatType}: geometrie blijft binnen de bbox`);
}

for (const scale of [50, 100, 200]) {
  const ptPerMm = 72 / 25.4 / scale;
  const params = {
    maatType: 'lagenmaat', totaleMaat: 4400, lagenmaat: 100,
    koppenmaat: 110, voeg: 10, steenbreedte: 100,
  };
  const bbox = {
    x: 10, y: 20,
    width: params.steenbreedte * ptPerMm,
    height: params.totaleMaat * ptPerMm,
  };
  const commands = stenenrijTemplate.render(params, bbox);
  ok(commands.every((command) => Number.isFinite(command.lineWidth) && command.lineWidth > 0),
    `1:${scale}: stenen hebben een expliciete schaallijndikte`);
  ok(commands.every((command) => {
    const half = command.lineWidth / 2;
    return command.points.every((point) =>
      point.x - half >= bbox.x - 1e-9 && point.x + half <= bbox.x + bbox.width + 1e-9
      && point.y - half >= bbox.y - 1e-9 && point.y + half <= bbox.y + bbox.height + 1e-9);
  }), `1:${scale}: strokes blijven volledig binnen de PDF-appearance`);
  ok(commands.every((command) => command.lineWidth * 2 < params.voeg * ptPerMm),
    `1:${scale}: twee contourlijnen lopen de voeg niet dicht`);
}

const registry = readFileSync(join(appRoot, 'js/symbols/registry.js'), 'utf8');
const palette = readFileSync(join(appRoot, 'js/solid/data/nlSymbolLibrary.js'), 'utf8');
const ifc = readFileSync(join(appRoot, 'js/solid/data/ifcCategoryMap.js'), 'utf8');
const rendering = readFileSync(join(appRoot, 'js/annotations/rendering.js'), 'utf8');
ok(registry.includes('register(stenenrijTemplate)'), 'template is geregistreerd');
ok(palette.includes("parametricId: 'stenenrij'"), 'component staat in NL IFC Bouw');
ok(ifc.includes("'stenenrij': 'IfcWall'"), 'stenenrij heeft IFC-wandclassificatie');
ok(rendering.includes('c.lineWidth ?? lw'),
  'parametrische renderer respecteert command-specifieke lijndikte');

if (failures) {
  console.error(`\n${failures} van ${checks} controles mislukt.`);
  process.exit(1);
}
console.log(`\nOK: ${checks} controles geslaagd.`);
