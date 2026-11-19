// De instelling "Eenheden" (#1158) blijft staan na herladen, ook in de
// webversie: daar is de browseropslag (core/opslag.js) de echte opslag van de
// voorkeuren. Zonder bruikbare browseropslag geldt de keuze tot herladen, en
// dat is te zien (opslagIsBlijvend) zodat het venster het erbij kan zeggen.

import assert from 'node:assert/strict';
import test from 'node:test';

const winkel = new Map();
const echteOpslag = {
  getItem: (k) => (winkel.has(k) ? winkel.get(k) : null),
  setItem: (k, v) => { winkel.set(k, String(v)); },
  removeItem: (k) => { winkel.delete(k); },
};
globalThis.localStorage = echteOpslag;
globalThis.window = {};

const {
  OPSLAG_PREFIX, leesOpslag, schrijfOpslag, opslagIsBlijvend, VOORKEUREN_NAAM,
} = await import('./opslag.js');
const { preferencesMirrorJson } = await import('./preferences-mirror.js');
const { voegSamenMetStandaarden } = await import('./preferences-merge.js');
const { voorkeurenBijStelsel, standaardenVoorStelsel } = await import('../annotations/eenhedenstelsel.js');

// De standaarden van de betrokken voorkeuren (core/constants.ts).
const STANDAARD = Object.freeze({
  theme: 'default',
  scaleUnitSystem: 'metric',
  imperialLengthFormat: 'decimal',
  imperialFractionPrecision: 16,
  paperSizeUnit: 'mm',
});

/** Wat het voorkeurenvenster doet bij Opslaan in de browser (savePreferences). */
function bewaar(prefs) {
  schrijfOpslag(VOORKEUREN_NAAM, preferencesMirrorJson(prefs, false));
}

/** Wat de app bij het starten doet (loadPreferences buiten Tauri). */
function laad() {
  const tekst = leesOpslag(VOORKEUREN_NAAM);
  return tekst ? voegSamenMetStandaarden(STANDAARD, JSON.parse(tekst)) : { ...STANDAARD };
}

function alsGast(fn) {
  window.__OPDS_HOST__ = {};
  try { return fn(); } finally { delete window.__OPDS_HOST__; }
}

test('Imperiaal blijft staan na herladen, met de voorkeuren die meegaan', () => {
  winkel.clear();
  const prefs = { ...STANDAARD, scaleUnitSystem: 'imperial', ...voorkeurenBijStelsel('imperial', STANDAARD) };
  bewaar(prefs);
  assert.ok(winkel.has(OPSLAG_PREFIX + VOORKEUREN_NAAM), 'onder de eigen sleutel van de app');

  const terug = laad();
  assert.equal(terug.scaleUnitSystem, 'imperial');
  assert.equal(terug.imperialLengthFormat, 'feetInch');
  assert.equal(terug.paperSizeUnit, 'in');
  assert.equal(terug.imperialFractionPrecision, 16);
  assert.equal(standaardenVoorStelsel(terug.scaleUnitSystem).lengteEenheid, 'ft');
});

test('ook als gast in een andere site (de gehoste webversie)', () => {
  winkel.clear();
  alsGast(() => {
    bewaar({ ...STANDAARD, scaleUnitSystem: 'imperial' });
    assert.equal(laad().scaleUnitSystem, 'imperial');
    assert.equal(opslagIsBlijvend(), true);
  });
  assert.deepEqual([...winkel.keys()], [OPSLAG_PREFIX + VOORKEUREN_NAAM]);
});

test('terug naar metrisch overschrijft de bewaarde keuze', () => {
  winkel.clear();
  bewaar({ ...STANDAARD, scaleUnitSystem: 'imperial', paperSizeUnit: 'in' });
  const nu = laad();
  bewaar({ ...nu, scaleUnitSystem: 'metric', ...voorkeurenBijStelsel('metric', nu) });
  const terug = laad();
  assert.equal(terug.scaleUnitSystem, 'metric');
  assert.equal(terug.paperSizeUnit, 'mm');
});

test('zonder bewaarde voorkeuren geldt de standaard', () => {
  winkel.clear();
  assert.equal(laad().scaleUnitSystem, 'metric');
});

test('zonder bruikbare browseropslag: de keuze werkt, maar is niet blijvend', () => {
  winkel.clear();
  assert.equal(opslagIsBlijvend(), true);
  const geblokkeerd = { getItem() { throw new Error('SecurityError'); }, setItem() {}, removeItem() {} };
  globalThis.localStorage = geblokkeerd;
  try {
    assert.equal(opslagIsBlijvend(), false);
    // Binnen de sessie blijft de keuze wel staan (opslag in het geheugen).
    bewaar({ ...STANDAARD, scaleUnitSystem: 'imperial' });
    assert.equal(laad().scaleUnitSystem, 'imperial');
  } finally {
    globalThis.localStorage = echteOpslag;
  }
  assert.equal(winkel.size, 0, 'niets in de echte opslag terechtgekomen');
  assert.equal(opslagIsBlijvend(), true);
});
