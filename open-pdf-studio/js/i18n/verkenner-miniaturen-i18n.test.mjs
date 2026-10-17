// PDF-miniaturen in Verkenner (#605): elke taal heeft de teksten, echt
// vertaald, met de invulplek {{name}} intact.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const LOCALES = new URL('./locales/', import.meta.url);
const lees = (taal) => JSON.parse(readFileSync(new URL(`${taal}/preferences.json`, LOCALES), 'utf8'));
const SLEUTELS = ['title', 'show', 'help', 'unavailable', 'otherHandler', 'defaultApp', 'replaceTitle', 'replaceConfirm', 'failed'];

test('alle 40 talen hebben de miniatuurteksten, niet leeg', () => {
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  for (const taal of talen) {
    const d = lees(taal).explorerThumbnails;
    assert.ok(d, `${taal}: explorerThumbnails ontbreekt`);
    assert.deepEqual(Object.keys(d).sort(), [...SLEUTELS].sort(), taal);
    for (const k of SLEUTELS) {
      assert.ok(typeof d[k] === 'string' && d[k].trim().length > 0, `${taal} ${k} is leeg`);
    }
  }
});

test('geen taal kopieert de Engelse tekst', () => {
  const en = lees('en').explorerThumbnails;
  const gekopieerd = [];
  for (const taal of readdirSync(LOCALES)) {
    if (taal === 'en') continue;
    const d = lees(taal).explorerThumbnails;
    for (const k of SLEUTELS) if (d[k] === en[k]) gekopieerd.push(`${taal} ${k}`);
  }
  assert.deepEqual(gekopieerd, []);
});

test('de invulplek {{name}} staat waar het Engels hem heeft, en nergens anders', () => {
  const en = lees('en').explorerThumbnails;
  const fout = [];
  for (const taal of readdirSync(LOCALES)) {
    const d = lees(taal).explorerThumbnails;
    for (const k of SLEUTELS) {
      const verwacht = (en[k].match(/\{\{\w+\}\}/g) || []).sort();
      const echt = (d[k].match(/\{\{\w+\}\}/g) || []).sort();
      if (JSON.stringify(verwacht) !== JSON.stringify(echt)) fout.push(`${taal} ${k}: ${echt.join(',')}`);
    }
  }
  assert.deepEqual(fout, []);
});

test('de vraag noemt de productnaam en houdt de witregel', () => {
  for (const taal of readdirSync(LOCALES)) {
    const d = lees(taal).explorerThumbnails;
    assert.match(d.replaceConfirm, /Open PDF Studio/, taal);
    assert.match(d.replaceConfirm, /\n\n/, taal);
  }
});
