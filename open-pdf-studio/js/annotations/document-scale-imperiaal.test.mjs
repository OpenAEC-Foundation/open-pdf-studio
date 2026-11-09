// Imperiale schaal in de titelhoek (#999): `1/8" = 1'-0"` is 1:96 in voet,
// nooit metrisch 1:8. Een inchmaat die niet te lezen is geeft geen schaal.
import assert from 'node:assert/strict';
import test from 'node:test';

import { findScaleInText, matchImperialScale, measureScaleFromTitleBlock } from './document-scale.js';
import { IMPERIAL_SCALE_PRESETS } from './scale-presets.js';

const items = (...strs) => strs.map((str) => ({ str }));
const vind = (...strs) => findScaleInText(items(...strs));

test('architectural notation in a title block gives the ratio in feet', () => {
  assert.deepEqual(vind('SCALE: 1/8" = 1\'-0"'), { ratio: 96, unit: 'ft', scaleText: '1/8" = 1\'-0"' });
  assert.equal(vind('SCALE:', '3/16"=1\'-0"').ratio, 64);
  assert.equal(vind('SCALE: 1 1/2" = 1\'-0"').ratio, 8);
  assert.equal(vind('SCALE: 1-1/2" = 1\'-0"').ratio, 8);
  assert.equal(vind('3" = 1\'-0"').ratio, 4);
  assert.equal(vind('SCALE: 3/32" = 1\'-0"').ratio, 128);
  assert.equal(vind('1/4 in = 1 ft').ratio, 48);
  // Typografische inch- en voettekens.
  assert.equal(vind('SCALE: 1/4″ = 1′-0″').ratio, 48);
  assert.equal(vind('SCALE 1/4” = 1’-0”').ratio, 48);
});

test('engineering notation: one inch per N feet', () => {
  assert.deepEqual(vind('SCALE 1" = 20\''), { ratio: 240, unit: 'ft', scaleText: '1" = 20\'' });
  assert.equal(vind('1"=50\'-0"').ratio, 600);
  assert.equal(vind('SCALE: 1" = 100\'-0"').ratio, 1200);
});

test('full size is 1:1 in inches', () => {
  assert.deepEqual(vind('SCALE: 12" = 1\'-0"'), { ratio: 1, unit: 'in', scaleText: '12" = 1\'-0"' });
  assert.deepEqual(vind('SCALE:', 'FULL SIZE'), { ratio: 1, unit: 'in', scaleText: 'SCALE: FULL SIZE' });
  assert.equal(vind('SCALE: HALF SIZE').ratio, 2);
});

test('every imperial preset label is read back as its own ratio', () => {
  for (const preset of IMPERIAL_SCALE_PRESETS) {
    const tekst = preset.label.replace(/\s*\(1:\d+\)$/, '');
    const gevonden = vind(`SCALE: ${tekst}`);
    assert.ok(gevonden, tekst);
    assert.equal(`1:${gevonden.ratio}`, preset.ratio, tekst);
    assert.equal(gevonden.unit, 'ft', tekst);
  }
});

test('an inch fraction is never read as a metric ratio', () => {
  assert.equal(vind('SCALE: 1/8"'), null);
  assert.equal(vind('SCALE: 1/16"'), null);
  assert.equal(vind('SCALE 1/4 in'), null);
  // Een tekening met voet-inchmaten: een losse "1/50" is geen schaal.
  assert.equal(vind('12\'-6"', '1/50'), null);
});

test('metric title blocks are read as before', () => {
  assert.deepEqual(vind('Schaal 1:100'), { ratio: 100, scaleText: 'Schaal 1:100' });
  assert.deepEqual(vind('Maßstab 1/50'), { ratio: 50, scaleText: 'Maßstab 1/50' });
  // Een inch-leidingmaat naast een metrische schaal stoort niet.
  assert.equal(vind('leiding 1/2"', 'Schaal 1:50').ratio, 50);
  assert.equal(matchImperialScale('Schaal 1:100'), null);
});

test('the title-block scale keeps the detected unit', () => {
  const ft = measureScaleFromTitleBlock({ ratio: 96, unit: 'ft', userUnit: 1 });
  assert.equal(ft.unit, 'ft');
  assert.equal(ft.scaleRatio, '1:96');
  // 1 voet op 1:96 is 1/8 inch papier = 9 pt.
  assert.ok(Math.abs(ft.pixelsPerUnit - 9) < 1e-9, String(ft.pixelsPerUnit));
  assert.equal(measureScaleFromTitleBlock({ ratio: 100 }).unit, 'mm');
  assert.equal(measureScaleFromTitleBlock({ ratio: 1, unit: 'in' }).unit, 'in');
});
