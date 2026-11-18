// De ene instelling "Eenheden" (#1158): de regel die de standaarden uit het
// stelsel afleidt. Wie op Imperiaal zet, meet in voet en inch; een bestaand
// document of een opgeslagen schaal verandert er niet door.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  normaliseerStelsel, isImperiaalStelsel, standaardenVoorStelsel, standaardLengteEenheid,
  voorkeurenBijStelsel, handmatigeSchaal, meetZonderSchaal, migreerStelselStandaard,
} from './eenhedenstelsel.js';
import { stelSchaalSysteemBronIn, scaleSelectOptions, isImperialScalePreset } from './scale-presets.js';
import { measureScaleFromTitleBlock } from './document-scale.js';
import { pixelsPerUnitFor } from './scale-region-scale.js';

test('een onbruikbare waarde is het oude gedrag: beide lijsten, metrisch meten', () => {
  for (const s of [undefined, null, '', 'us', 42]) assert.equal(normaliseerStelsel(s), 'both');
  assert.equal(isImperiaalStelsel('both'), false);
  assert.equal(isImperiaalStelsel('metric'), false);
  assert.equal(isImperiaalStelsel('imperial'), true);
});

test('imperiaal: voet als eenheid, een imperiale standaardschaal, papier in inches', () => {
  const s = standaardenVoorStelsel('imperial');
  assert.equal(s.imperiaal, true);
  assert.equal(s.lengteEenheid, 'ft');
  assert.equal(s.papierEenheid, 'in');
  assert.ok(isImperialScalePreset(s.schaal), 'de standaardschaal is een imperiale preset');
  // Zonder schaal: de maat op papier in inches, 72 punten per inch.
  assert.deepEqual(s.zonderSchaal, { pixelsPerUnit: 72, unit: 'in' });
});

test('metrisch en beide: millimeters, 1:100, en zonder schaal zoals het was', () => {
  for (const stelsel of ['metric', 'both']) {
    const s = standaardenVoorStelsel(stelsel);
    assert.equal(s.imperiaal, false);
    assert.equal(s.lengteEenheid, 'mm');
    assert.equal(s.schaal, '1:100');
    assert.equal(s.papierEenheid, 'mm');
    assert.deepEqual(s.zonderSchaal, { pixelsPerUnit: 1, unit: 'mm' });
  }
});

test('de standaarden volgen de voorkeur als er geen stelsel wordt meegegeven', () => {
  try {
    stelSchaalSysteemBronIn(() => 'imperial');
    assert.equal(standaardLengteEenheid(), 'ft');
    assert.equal(isImperiaalStelsel(), true);
    // De standaardschaal staat in de lijst die de schaalvensters dan tonen.
    const lijst = scaleSelectOptions().map((o) => o.value);
    assert.ok(lijst.includes(standaardenVoorStelsel().schaal));
    assert.ok(lijst.every(isImperialScalePreset), 'alleen imperiale schalen in de lijst');
    stelSchaalSysteemBronIn(() => 'metric');
    assert.equal(standaardLengteEenheid(), 'mm');
    assert.ok(scaleSelectOptions().map((o) => o.value).includes(standaardenVoorStelsel().schaal));
  } finally {
    stelSchaalSysteemBronIn(null);
  }
  assert.equal(standaardLengteEenheid(), 'mm');
});

test('omzetten naar imperiaal neemt voet-inch-breuken en papier in inches mee', () => {
  assert.deepEqual(
    voorkeurenBijStelsel('imperial', { imperialLengthFormat: 'decimal', paperSizeUnit: 'pt' }),
    { imperialLengthFormat: 'feetInch', paperSizeUnit: 'in' },
  );
  // Wat al goed staat komt niet in de patch.
  assert.deepEqual(voorkeurenBijStelsel('imperial', { imperialLengthFormat: 'feetInch', paperSizeUnit: 'in' }), {});
});

test('omzetten naar metrisch haalt alleen de papiermaat uit inches', () => {
  assert.deepEqual(voorkeurenBijStelsel('metric', { imperialLengthFormat: 'feetInch', paperSizeUnit: 'in' }),
    { paperSizeUnit: 'mm' });
  assert.deepEqual(voorkeurenBijStelsel('metric', { paperSizeUnit: 'pt' }), {});
  assert.deepEqual(voorkeurenBijStelsel('both', { paperSizeUnit: 'in' }), {});
  assert.deepEqual(voorkeurenBijStelsel('onzin', { paperSizeUnit: 'in' }), {});
});

test('de patch raakt geen schaal- of documentvoorkeur', () => {
  const sleutels = new Set([
    ...Object.keys(voorkeurenBijStelsel('imperial', {})),
    ...Object.keys(voorkeurenBijStelsel('metric', { paperSizeUnit: 'in' })),
  ]);
  assert.deepEqual([...sleutels].sort(), ['imperialLengthFormat', 'paperSizeUnit']);
});

test('handmatige voorkeursschaal: de onaangeroerde standaard telt imperiaal niet', () => {
  const standaard = { measureDistDimScale: 1, measureDistDimUnit: 'mm' };
  assert.deepEqual(handmatigeSchaal(standaard, 'measureDist', 'metric'), { scale: 1, unit: 'mm' });
  assert.deepEqual(handmatigeSchaal(standaard, 'measureDist', 'both'), { scale: 1, unit: 'mm' });
  assert.equal(handmatigeSchaal(standaard, 'measureDist', 'imperial'), null);
  // Een eigen schaal of eenheid van de gebruiker blijft gelden.
  assert.deepEqual(handmatigeSchaal({ measureDistDimScale: 0.5, measureDistDimUnit: 'mm' }, 'measureDist', 'imperial'),
    { scale: 0.5, unit: 'mm' });
  assert.deepEqual(handmatigeSchaal({ measurePerimDimScale: 1, measurePerimDimUnit: 'ft' }, 'measurePerim', 'imperial'),
    { scale: 1, unit: 'ft' });
  // Geen schaal: geen handmatige schaal.
  for (const scale of [0, undefined, null, -1, 'x']) {
    assert.equal(handmatigeSchaal({ measureDistDimScale: scale }, 'measureDist', 'metric'), null);
  }
  assert.equal(handmatigeSchaal(null, 'measureDist', 'metric'), null);
});

test('meten zonder schaal: alleen zonder schaalbron en zonder oude globale schaal', () => {
  assert.equal(meetZonderSchaal({ heeftSchaalbron: false }), true);
  assert.equal(meetZonderSchaal({ heeftSchaalbron: true }), false);
  assert.equal(meetZonderSchaal({ heeftSchaalbron: false, legacySchaal: { pixelsPerUnit: 2.8 } }), false);
  assert.equal(meetZonderSchaal({ heeftSchaalbron: false, legacySchaal: { pixelsPerUnit: 0 } }), true);
});

test('een kale 1:N uit het titelblok krijgt de eenheid van de instelling', () => {
  const metrisch = measureScaleFromTitleBlock({ ratio: 100 });
  assert.equal(metrisch.unit, 'mm');
  const imperiaal = measureScaleFromTitleBlock({ ratio: 100 }, 'ft');
  assert.equal(imperiaal.unit, 'ft');
  assert.equal(imperiaal.scaleRatio, '1:100');
  assert.equal(imperiaal.pixelsPerUnit, pixelsPerUnitFor('1:100', 'ft'));
  // Dezelfde werkelijke lengte: 1 ft = 304,8 mm.
  assert.ok(Math.abs(imperiaal.pixelsPerUnit / metrisch.pixelsPerUnit - 304.8) < 1e-9);
  // Een schaal die zelf imperiaal is houdt zijn eenheid, wat de instelling ook is.
  assert.equal(measureScaleFromTitleBlock({ ratio: 96, unit: 'ft' }).unit, 'ft');
  assert.equal(measureScaleFromTitleBlock({ ratio: 1, unit: 'in' }, 'ft').unit, 'in');
  assert.equal(measureScaleFromTitleBlock({ ratio: 50 }, 'onzin').unit, 'mm');
});

test('de oude standaard both wordt eenmalig metrisch; een eigen keuze blijft', () => {
  // Opgeslagen voorkeuren van voor de overgang: geen vlaggetje.
  assert.equal(migreerStelselStandaard({ scaleUnitSystem: 'both' }).scaleUnitSystem, 'metric');
  assert.equal(migreerStelselStandaard({}).scaleUnitSystem, 'metric');
  assert.equal(migreerStelselStandaard({ scaleUnitSystem: 'imperial' }).scaleUnitSystem, 'imperial');
  assert.equal(migreerStelselStandaard({ scaleUnitSystem: 'metric' }).scaleUnitSystem, 'metric');
  // Daarna staat het vlaggetje: wie zelf weer both kiest, houdt dat.
  const na = migreerStelselStandaard({ scaleUnitSystem: 'both' });
  assert.equal(na.unitsDefaultMetric, true);
  na.scaleUnitSystem = 'both';
  assert.equal(migreerStelselStandaard(na).scaleUnitSystem, 'both');
  assert.equal(migreerStelselStandaard(null), null);
});

test('nieuwe installatie: metrisch, zonder imperiale schalen of inches', () => {
  // Bron gelezen: CI draait Node 20, dat geen .ts importeert.
  const bron = readFileSync(new URL('../core/constants.ts', import.meta.url), 'utf8');
  assert.ok(bron.includes("scaleUnitSystem: 'metric',"));
  assert.ok(bron.includes('unitsDefaultMetric: true,'));
  assert.ok(bron.includes("measureDistDimUnit: 'mm',"));
  assert.ok(bron.includes("measureAreaDimUnit: 'mm',"));
  assert.ok(bron.includes("measurePerimDimUnit: 'mm',"));
  const lader = readFileSync(new URL('../core/preferences.js', import.meta.url), 'utf8');
  assert.ok(lader.includes('migreerStelselStandaard(loaded);'));
  assert.equal(scaleSelectOptions(undefined, { system: 'metric' }).some((o) => isImperialScalePreset(o.value)), false);
});
