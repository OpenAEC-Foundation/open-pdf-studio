// De standaard pagina-indeling (#1289): de indeling waarin een document opent.
// Enkele pagina is de standaard. Doorlopend was dat alleen in 2026.47.1, toen
// de voorkeur nog nergens in te stellen was; een opgeslagen waarde van voor de
// instelling gaat daarom eenmalig terug naar enkele pagina. Wat de gebruiker
// daarna in Voorkeuren kiest blijft staan.
// Bron gelezen waar het .ts is: CI draait Node 20, dat geen .ts importeert.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import {
  PAGINA_INDELINGEN, STANDAARD_INDELING, normaliseerIndeling, beginWeergave, indelingVan,
  migreerStandaardWeergave,
} from './standaard-weergave.js';
import { voegSamenMetStandaarden } from './preferences-merge.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');

// De standaarden zoals constants.ts ze geeft, voor zover ze hier meetellen.
const STANDAARDEN = { defaultViewMode: 'single', viewModeDefaultSingle: true };

// Een keer laden zoals loadPreferences() het doet: overgang, dan samenvoegen.
const laad = (opgeslagen) => voegSamenMetStandaarden(STANDAARDEN, migreerStandaardWeergave(opgeslagen));
// Wat er na opslaan in het bestand staat en bij de volgende start terugkomt.
const herstart = (voorkeuren) => laad(JSON.parse(JSON.stringify(voorkeuren)));

test('een nieuw document opent in de enkele-paginaweergave', () => {
  const standaarden = bron('./constants.ts');
  assert.ok(standaarden.includes("defaultViewMode: 'single',"));
  assert.ok(!standaarden.includes("defaultViewMode: 'continuous',"));
  assert.equal(STANDAARD_INDELING, 'single');
  assert.deepEqual(beginWeergave(undefined), { viewMode: 'single', bookSpread: false, facingSpread: false });
  // Een nieuwe installatie (niets opgeslagen) hoeft niet over te gaan.
  assert.ok(standaarden.includes('viewModeDefaultSingle: true,'));
  assert.ok(bron('../types/preferences.ts').includes('viewModeDefaultSingle: boolean;'));
});

test('de vier indelingen die de app kan tonen zijn te kiezen', () => {
  assert.deepEqual(PAGINA_INDELINGEN, ['single', 'continuous', 'facing', 'book']);
  assert.deepEqual(beginWeergave('single'), { viewMode: 'single', bookSpread: false, facingSpread: false });
  assert.deepEqual(beginWeergave('continuous'), { viewMode: 'continuous', bookSpread: false, facingSpread: false });
  assert.deepEqual(beginWeergave('facing'), { viewMode: 'continuous', bookSpread: false, facingSpread: true });
  assert.deepEqual(beginWeergave('book'), { viewMode: 'continuous', bookSpread: true, facingSpread: false });
  // Elke naam is er een die setViewMode() kent.
  const renderer = bron('../pdf/renderer.js');
  for (const naam of ['book', 'facing']) assert.ok(renderer.includes(`mode === '${naam}'`), naam);
  const type = bron('../types/preferences.ts');
  assert.ok(type.includes("defaultViewMode: 'single' | 'continuous' | 'facing' | 'book';"));
});

test('de indeling van een document is de naam waarmee het begon', () => {
  for (const naam of PAGINA_INDELINGEN) assert.equal(indelingVan(beginWeergave(naam)), naam);
  assert.equal(indelingVan(null), 'single');
  // De vlaggen tellen alleen in de doorlopende weergave: wie van boek naar
  // enkele pagina ging, staat in enkele pagina.
  assert.equal(indelingVan({ viewMode: 'single', bookSpread: true }), 'single');
});

test('een onbekende opgeslagen waarde valt terug op enkele pagina', () => {
  for (const vreemd of [undefined, null, '', 'grid', 'Continuous', 2, true, {}]) {
    assert.equal(normaliseerIndeling(vreemd), 'single');
    assert.deepEqual(beginWeergave(vreemd), { viewMode: 'single', bookSpread: false, facingSpread: false });
  }
  // Ook na de overgang: een waarde die deze versie niet kent.
  assert.equal(laad({ defaultViewMode: 'grid', viewModeDefaultSingle: true }).defaultViewMode, 'single');
});

test('een opgeslagen doorlopende standaard gaat eenmalig terug naar enkele pagina', () => {
  // Opgeslagen door 2026.47.1: doorlopend, nog zonder vlaggetje.
  const na = laad({ theme: 'dark', defaultViewMode: 'continuous' });
  assert.equal(na.defaultViewMode, 'single');
  assert.equal(na.viewModeDefaultSingle, true);
  assert.equal(na.theme, 'dark');
  // Ook zonder opgeslagen waarde, en met een al goede waarde.
  assert.equal(laad({}).defaultViewMode, 'single');
  assert.equal(laad({ defaultViewMode: 'single' }).viewModeDefaultSingle, true);
  assert.equal(migreerStandaardWeergave(null), null);
});

test('een keuze in Voorkeuren na de overgang overleeft een herstart', () => {
  for (const keuze of ['continuous', 'facing', 'book', 'single']) {
    const voorkeuren = laad({ defaultViewMode: 'continuous' });
    assert.equal(voorkeuren.defaultViewMode, 'single');
    voorkeuren.defaultViewMode = keuze; // Voorkeuren, Opslaan
    const terug = herstart(voorkeuren);
    assert.equal(terug.defaultViewMode, keuze);
    assert.equal(herstart(terug).defaultViewMode, keuze);
  }
  // Een nieuwe installatie: de standaarden zelf worden opgeslagen.
  const nieuw = { ...STANDAARDEN, defaultViewMode: 'book' };
  assert.equal(herstart(nieuw).defaultViewMode, 'book');
});

test('de lader draait de overgang en forceert de waarde niet meer', () => {
  const lader = bron('./preferences.js');
  assert.ok(lader.includes('migreerStandaardWeergave(loaded);'));
  assert.ok(!lader.includes("loaded.defaultViewMode = 'single';"));
  assert.ok(!lader.includes("loaded.defaultViewMode = 'continuous';"));
  // De overgang staat voor het samenvoegen met de standaarden: daarna heeft
  // elke voorkeur het vlaggetje al.
  assert.ok(lader.indexOf('migreerStandaardWeergave(loaded);') < lader.indexOf('voegSamenMetStandaarden(DEFAULT_PREFERENCES, loaded)'));
});

test('een tabblad volgt de voorkeur, ook met twee pagina’s naast elkaar', () => {
  assert.ok(bron('../ui/chrome/tabs.js')
    .includes('Object.assign(doc, beginWeergave(state.preferences?.defaultViewMode));'));
  // De eerste weergave na het laden houdt de indeling van het tabblad aan;
  // setViewMode('continuous') zou de twee-paginavlaggen wissen.
  const lader = bron('../pdf/loader.js');
  assert.ok(!lader.includes('setViewMode(doc.viewMode)'));
  assert.equal(lader.split('setViewMode(indelingVan(doc))').length - 1, 2);
});

test('Voorkeuren biedt elke indeling aan, in elke taal met tekst', () => {
  const tab = bron('../solid/components/preferences/PageDisplayTab.jsx');
  assert.ok(tab.includes('id="pref-default-page-layout"'));
  assert.ok(tab.includes('p.defaultViewMode[1]'));
  const sleutels = ['pageLayout', 'defaultLayout', 'defaultLayoutHint',
    'layoutSingle', 'layoutContinuous', 'layoutFacing', 'layoutBook'];
  for (const naam of PAGINA_INDELINGEN) {
    const sleutel = `layout${naam[0].toUpperCase()}${naam.slice(1)}`;
    assert.ok(sleutels.includes(sleutel), sleutel);
    assert.ok(tab.includes(`${naam}: 'pageDisplay.${sleutel}'`), sleutel);
  }
  const locales = new URL('../i18n/locales/', import.meta.url);
  const talen = readdirSync(locales);
  assert.equal(talen.length, 40);
  for (const taal of talen) {
    const d = JSON.parse(readFileSync(new URL(`${taal}/preferences.json`, locales), 'utf8')).pageDisplay;
    for (const k of sleutels) assert.ok(typeof d?.[k] === 'string' && d[k].trim().length > 0, `${taal} ${k}`);
  }
  const en = JSON.parse(readFileSync(new URL('en/preferences.json', locales), 'utf8')).pageDisplay;
  const nl = JSON.parse(readFileSync(new URL('nl/preferences.json', locales), 'utf8')).pageDisplay;
  for (const k of sleutels) assert.notEqual(nl[k], en[k], `nl ${k} is niet vertaald`);
});
