// Regressietest voor het plattegrondaanzicht van de parametrische bout.
// Draaien: node scripts/test-bout-plattegrond.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../js/symbols/templates/bout.js'), 'utf8');
const staged = join(mkdtempSync(join(tmpdir(), 'opds-bout-')), 'bout.mjs');
writeFileSync(staged, source);
const { boutTemplate } = await import(pathToFileURL(staged).href);

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

const viewParam = boutTemplate.params.find((param) => param.key === 'aanzicht');
const ringParam = boutTemplate.params.find((param) => param.key === 'ringPlattegrond');
const viewValues = (viewParam?.options || []).map((option) =>
  typeof option === 'string' ? option : option.value);

console.log('\n== Parameters');
ok(viewValues.includes('plattegrond'), 'aanzicht bevat plattegrond');
ok(ringParam?.type === 'boolean', 'ring in plattegrond is een boolean');

console.log('\n== Werkelijke maat');
const zonderRing = boutTemplate.realSizeMm({
  maat: 'M12', aanzicht: 'plattegrond', ringPlattegrond: false, schaal: 1,
});
const metRing = boutTemplate.realSizeMm({
  maat: 'M12', aanzicht: 'plattegrond', ringPlattegrond: true, schaal: 1,
});
const hexAcrossCorners = 19 / Math.cos(Math.PI / 6);
near(zonderRing.width, hexAcrossCorners, 1e-9, 'zonder ring volgt de zeskantmaat');
near(zonderRing.height, hexAcrossCorners, 1e-9, 'plattegrond is vierkant');
near(metRing.width, 2.2 * 12, 1e-9, 'met ring volgt de buitendiameter');
near(metRing.height, 2.2 * 12, 1e-9, 'ringfootprint is vierkant');

console.log('\n== Geometrie');
const bbox = { x: 10, y: 20, width: 132, height: 132 };
const zonderCommands = boutTemplate.render({
  maat: 'M12', aanzicht: 'plattegrond', ringPlattegrond: false, schaal: 1,
}, bbox);
const metCommands = boutTemplate.render({
  maat: 'M12', aanzicht: 'plattegrond', ringPlattegrond: true, schaal: 1,
}, bbox);
ok(zonderCommands.some((command) => command.role === 'boutkop' && command.kind === 'polyline'),
  'plattegrond bevat een zeskante boutkop');
ok(!zonderCommands.some((command) => command.role === 'ring'),
  'ring uit verbergt de buitenring');
const ring = metCommands.find((command) => command.role === 'ring');
ok(ring?.kind === 'circle', 'ring aan tekent een cirkel');
ok(metCommands.some((command) => command.role === 'boutkop'),
  'boutkop blijft zichtbaar met ring');
ok(ring && ring.cx - ring.r >= bbox.x && ring.cx + ring.r <= bbox.x + bbox.width
  && ring.cy - ring.r >= bbox.y && ring.cy + ring.r <= bbox.y + bbox.height,
  'ring blijft volledig binnen de bbox');

// De nieuwe optie mag de bestaande zijaanzichten niet veranderen.
const sideWithout = boutTemplate.render({
  maat: 'M12', aanzicht: 'bout', lengte: 120, ringPlattegrond: false, schaal: 1,
}, { x: 0, y: 0, width: 400, height: 80 });
const sideWith = boutTemplate.render({
  maat: 'M12', aanzicht: 'bout', lengte: 120, ringPlattegrond: true, schaal: 1,
}, { x: 0, y: 0, width: 400, height: 80 });
ok(JSON.stringify(sideWithout) === JSON.stringify(sideWith),
  'ringoptie beïnvloedt het zijaanzicht niet');

if (failures) {
  console.error(`\n${failures} van ${checks} controles mislukt.`);
  process.exit(1);
}
console.log(`\nOK: ${checks} controles geslaagd.`);
