// Schaalcontrole en getalnotatie (#629): elke taal heeft de teksten, echt
// vertaald, met de invulplekken intact, en elke sleutel in de code bestaat.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const LOCALES = new URL('../i18n/locales/', import.meta.url);
const lees = (taal, ns) => JSON.parse(readFileSync(new URL(`${taal}/${ns}.json`, LOCALES), 'utf8'));
const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const VOORKEUREN = ['decimalNotation', 'decimalAuto', 'decimalComma', 'decimalPoint', 'digitGrouping',
  'scaleCheck', 'scaleCheckOk', 'scaleCheckWarn'];

function teksten(taal) {
  const uit = {};
  for (const [k, v] of Object.entries(lees(taal, 'dialogs').scaleCheck || {})) uit[`dialogs:scaleCheck.${k}`] = v;
  const ribbon = lees(taal, 'ribbon').measure || {};
  uit['ribbon:measure.scaleCheck'] = ribbon.scaleCheck;
  uit['ribbon:measure.scaleCheckTitle'] = ribbon.scaleCheckTitle;
  uit['context:annotation.checkScale'] = lees(taal, 'context').annotation?.checkScale;
  const pref = lees(taal, 'preferences').measurement || {};
  for (const k of VOORKEUREN) uit[`preferences:measurement.${k}`] = pref[k];
  return uit;
}

// Woorden die in veel talen gewoon hetzelfde zijn als in het Engels.
const MAG_GELIJK = new Set([
  'dialogs:scaleCheck.page', 'dialogs:scaleCheck.status_ok', 'dialogs:scaleCheck.source_viewport',
  'dialogs:scaleCheck.horizontal', 'dialogs:scaleCheck.vertical', 'dialogs:scaleCheck.diagonal',
  'dialogs:scaleCheck.colDate',
  // Frans: "Point (2.50)" is ook daar het woord.
  'preferences:measurement.decimalPoint',
]);

test('alle 40 talen hebben dezelfde sleutels als het Engels, niet leeg', () => {
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  const en = teksten('en');
  assert.equal(Object.keys(en).length, 42 + 2 + 1 + VOORKEUREN.length);
  for (const taal of talen) {
    const t = teksten(taal);
    assert.deepEqual(Object.keys(t).sort(), Object.keys(en).sort(), taal);
    for (const [k, v] of Object.entries(t)) {
      assert.ok(typeof v === 'string' && v.trim().length > 0, `${taal} ${k} is leeg`);
    }
  }
});

test('geen taal kopieert de Engelse zinnen', () => {
  const en = teksten('en');
  const gekopieerd = [];
  for (const taal of readdirSync(LOCALES)) {
    if (taal === 'en') continue;
    const t = teksten(taal);
    for (const [k, v] of Object.entries(en)) {
      if (t[k] === v && !MAG_GELIJK.has(k)) gekopieerd.push(`${taal} ${k}: ${v}`);
    }
  }
  assert.deepEqual(gekopieerd, []);
});

test('de invulplekken staan in elke vertaling', () => {
  const en = teksten('en');
  const fout = [];
  for (const taal of readdirSync(LOCALES)) {
    const t = teksten(taal);
    for (const [k, v] of Object.entries(en)) {
      for (const plek of v.match(/\{\{\w+\}\}/g) || []) if (!t[k].includes(plek)) fout.push(`${taal} ${k} mist ${plek}`);
    }
  }
  assert.deepEqual(fout, []);
});

test('elke sleutel in de code bestaat in het Engels', () => {
  const en = teksten('en');
  const dialoog = bron('../solid/components/dialogs/ScaleCheckDialog.jsx');
  const gebruikt = new Set([...dialoog.matchAll(/t\('(scaleCheck\.\w+)'/g)].map((m) => `dialogs:${m[1]}`));
  // Opgebouwde sleutels: de bron en de status.
  for (const s of ['scaleRegion', 'viewport', 'scaleBar', 'pdfViewport', 'document']) gebruikt.add(`dialogs:scaleCheck.source_${s}`);
  for (const s of ['ok', 'warn', 'fail']) gebruikt.add(`dialogs:scaleCheck.status_${s}`);
  assert.ok(gebruikt.size >= 40, `${gebruikt.size} sleutels`);
  for (const sleutel of gebruikt) assert.ok(sleutel in en, `${sleutel} ontbreekt`);
  assert.match(bron('../solid/components/ribbon/DrawingTab.jsx'), /t\('measure\.scaleCheck'\)/);
  assert.match(bron('../solid/components/ContextMenu.jsx'), /t\('annotation\.checkScale'\)/);
  const tab = bron('../solid/components/preferences/AnnotationsTab.jsx');
  for (const k of VOORKEUREN) assert.ok(tab.includes(`t('measurement.${k}')`), k);
});
