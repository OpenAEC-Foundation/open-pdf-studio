// De lijst met unit-tests staat in scripts/unit-testlijst.txt, één pad per
// regel. Als één lange regel in package.json werd hij te lang voor de
// Windows-opdrachtregel (cmd.exe kapt af bij 8191 tekens), en twee branches
// die elk een test toevoegden botsten altijd op die ene regel.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { leesTestlijst, inPartijen } from '../scripts/draai-unit-tests.mjs';

const hier = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(hier, '..');

test('npm run test:unit gaat via het script, niet via een lange opdrachtregel', () => {
  const pakket = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
  assert.equal(pakket.scripts['test:unit'], 'node scripts/draai-unit-tests.mjs',
    'nieuwe tests horen in scripts/unit-testlijst.txt, niet in package.json');
});

test('elke regel van de testlijst is een bestaand bestand, zonder dubbele', () => {
  const lijst = leesTestlijst();
  assert.ok(lijst.length > 100, 'de lijst is gevuld');
  for (const pad of lijst) assert.ok(fs.existsSync(path.join(app, pad)), `${pad} bestaat niet`);
  assert.equal(new Set(lijst).size, lijst.length, 'dubbele regels');
});

test('lege regels en commentaar tellen niet mee', () => {
  assert.deepEqual(leesTestlijst('# kop\n\n  js/a.test.mjs  \r\n# ander\nscripts/b.mjs\n'), ['js/a.test.mjs', 'scripts/b.mjs']);
});

test('een lange lijst gaat in partijen die elk onder de grens blijven', () => {
  const bestanden = Array.from({ length: 50 }, (_, i) => `js/map/bestand-${String(i).padStart(2, '0')}.test.mjs`);
  const partijen = inPartijen(bestanden, 400);
  assert.ok(partijen.length > 1);
  assert.deepEqual(partijen.flat(), bestanden, 'volgorde en inhoud blijven gelijk');
  for (const p of partijen) assert.ok(p.join(' ').length <= 400);
  assert.deepEqual(inPartijen(bestanden.slice(0, 3), 400), [bestanden.slice(0, 3)], 'een korte lijst blijft één partij');
});
