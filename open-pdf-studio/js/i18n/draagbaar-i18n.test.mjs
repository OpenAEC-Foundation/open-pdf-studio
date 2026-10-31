// Draagbare modus (#881): elke taal heeft de teksten, echt vertaald, met de
// invulplekken intact en de programmanaam letterlijk.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const LOCALES = new URL('./locales/', import.meta.url);
const lees = (taal) => JSON.parse(readFileSync(new URL(`${taal}/common.json`, LOCALES), 'utf8'));
const SLEUTELS = ['updateTitle', 'updateAvailable', 'fileAssoc', 'explorerThumbnails', 'virtualPrinter', 'notWritable'];
const talen = readdirSync(LOCALES);

test('alle 40 talen hebben de draagbare teksten, niet leeg', () => {
  assert.equal(talen.length, 40);
  for (const taal of talen) {
    const d = lees(taal).portable;
    assert.ok(d, `${taal}: portable ontbreekt`);
    assert.deepEqual(Object.keys(d).sort(), [...SLEUTELS].sort(), taal);
    for (const k of SLEUTELS) assert.ok(typeof d[k] === 'string' && d[k].trim(), `${taal} ${k} is leeg`);
  }
});

test('geen taal kopieert de Engelse tekst', () => {
  const en = lees('en').portable;
  const gekopieerd = [];
  for (const taal of talen) {
    if (taal === 'en') continue;
    for (const k of SLEUTELS) if (lees(taal).portable[k] === en[k]) gekopieerd.push(`${taal} ${k}`);
  }
  assert.deepEqual(gekopieerd, []);
});

test('invulplekken staan waar het Engels ze heeft', () => {
  const en = lees('en').portable;
  const fout = [];
  for (const taal of talen) {
    const d = lees(taal).portable;
    for (const k of SLEUTELS) {
      const verwacht = (en[k].match(/\{\{\w+\}\}/g) || []).sort();
      const echt = (d[k].match(/\{\{\w+\}\}/g) || []).sort();
      if (JSON.stringify(verwacht) !== JSON.stringify(echt)) fout.push(`${taal} ${k}`);
    }
  }
  assert.deepEqual(fout, []);
  assert.deepEqual((en.updateAvailable.match(/\{\{\w+\}\}/g) || []).sort(), ['{{file}}', '{{version}}']);
  assert.deepEqual(en.notWritable.match(/\{\{\w+\}\}/g), ['{{dir}}']);
});

test('de uitleg over "Openen met" noemt het programma letterlijk', () => {
  for (const taal of talen) assert.match(lees(taal).portable.fileAssoc, /open-pdf-studio\.exe/, taal);
});
