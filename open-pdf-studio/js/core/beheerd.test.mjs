// Beheerde modus (OPENAEC_BEHEERD=1): geen eenmalige vragen bij het
// opstarten. Per melding: de beslisregel, en dat elke melding hem ook vraagt.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import {
  ONDERDRUKT_IN_BEHEERDE_MODUS, meldingToegestaan, leesBeheerd, magMelden, zetBeheerdVoorTest,
} from './beheerd.js';

test('zonder beheerde modus mag elke melding', () => {
  for (const m of [...ONDERDRUKT_IN_BEHEERDE_MODUS, 'herstel-aanbieden', 'iets-anders']) {
    assert.equal(meldingToegestaan(m, false), true, m);
  }
});

test('in de beheerde modus blijven de opstartvragen weg, de rest niet', () => {
  assert.deepEqual([...ONDERDRUKT_IN_BEHEERDE_MODUS].sort(),
    ['standaard-app', 'update-controle', 'vorige-versie', 'wat-is-nieuw']);
  for (const m of ONDERDRUKT_IN_BEHEERDE_MODUS) assert.equal(meldingToegestaan(m, true), false, m);
  // Het herstelaanbod na een onverwachte afsluiting beschermt werk: blijft.
  assert.equal(meldingToegestaan('herstel-aanbieden', true), true);
});

test('leesBeheerd: alleen een echte true van Rust zet de modus aan', async () => {
  const aanroepen = [];
  const invoke = (antwoord) => async (cmd) => { aanroepen.push(cmd); return antwoord; };
  assert.equal(await leesBeheerd(invoke(true)), true);
  assert.equal(await leesBeheerd(invoke(false)), false);
  assert.equal(await leesBeheerd(invoke('1')), false);
  assert.equal(await leesBeheerd(invoke(null)), false);
  assert.equal(await leesBeheerd(async () => { throw new Error('onbekend commando'); }), false);
  assert.equal(await leesBeheerd(undefined), false);
  assert.deepEqual([...new Set(aanroepen)], ['managed_mode']);
});

test('magMelden volgt de modus', async () => {
  zetBeheerdVoorTest(true);
  assert.equal(await magMelden('standaard-app'), false);
  assert.equal(await magMelden('herstel-aanbieden'), true);
  zetBeheerdVoorTest(false);
  assert.equal(await magMelden('standaard-app'), true);
  zetBeheerdVoorTest(null);
});

test('buiten Tauri (webversie) staat de modus uit', async () => {
  zetBeheerdVoorTest(null);
  assert.equal(await magMelden('wat-is-nieuw'), true);
});

test('standaard-app: de balk verschijnt niet in de beheerde modus, anders wel', async () => {
  const { showDefaultAppBar, hideDefaultAppBar, visible } = await import('../solid/stores/defaultAppBarStore.js');
  zetBeheerdVoorTest(true);
  await showDefaultAppBar();
  assert.equal(visible(), false);
  zetBeheerdVoorTest(false);
  await showDefaultAppBar();
  assert.equal(visible(), true);
  hideDefaultAppBar();
  zetBeheerdVoorTest(null);
});

const lees = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// Vóór al het andere in de functie: eerst vragen, dan pas iets doen.
function vraagtEerst(bron, functie, melding) {
  const start = bron.indexOf(functie);
  assert.ok(start >= 0, `${functie} niet gevonden`);
  const romp = bron.slice(start, start + 900);
  const vraag = romp.indexOf(`magMelden('${melding}')`);
  assert.ok(vraag >= 0, `${functie} vraagt magMelden('${melding}') niet`);
  return romp.slice(0, vraag);
}

test('wat-is-nieuw: geen venster en geen verzoek naar GitHub', () => {
  const voor = vraagtEerst(lees('../help/whats-new-trigger.js'), 'export async function checkForNewReleaseOnStartup', 'wat-is-nieuw');
  assert.doesNotMatch(voor, /fetchReleases|getAppVersion|openWhatsNew|savePreferences/);
});

test('update-controle: geen controle en geen updatevenster', () => {
  const voor = vraagtEerst(lees('../ui/chrome/updater.js'), 'export async function checkForUpdates', 'update-controle');
  assert.doesNotMatch(voor, /check\(\)|openDialog/);
});

test('vorige-versie: geen download', () => {
  const voor = vraagtEerst(lees('../help/previous-version.js'), 'export async function installPreviousVersion', 'vorige-versie');
  assert.doesNotMatch(voor, /fetchPreviousRelease|openExtern\(/);
});

test('standaard-app: de vraag gaat vóór het tonen', () => {
  const voor = vraagtEerst(lees('../solid/stores/defaultAppBarStore.js'), 'export async function showDefaultAppBar', 'standaard-app');
  assert.doesNotMatch(voor, /setVisible\(true\)/);
});

test('Rust leest OPENAEC_BEHEERD en geeft hem door', () => {
  const rs = lees('../../src-tauri/src/beheerd.rs');
  assert.match(rs, /OMGEVINGSVARIABELE: &str = "OPENAEC_BEHEERD"/);
  assert.match(rs, /pub fn managed_mode\(\) -> bool/);
  const lib = lees('../../src-tauri/src/lib.rs');
  assert.match(lib, /beheerd::managed_mode,/);
  // Ook Rust zelf: geen register- of xdg-mime-controle van de standaard-app.
  // is_default_pdf_app en default_pdf_app_status lezen allebei
  // standaard_app_status, dat in de beheerde modus meteen terugkeert.
  const romp = lib.slice(lib.indexOf('fn standaard_app_status'));
  assert.match(romp.slice(0, 500), /if beheerd::is_beheerd\(\) \{\s*return standaard_app::beheerd_status\(\);/);
  for (const cmd of ['async fn is_default_pdf_app', 'async fn default_pdf_app_status']) {
    const lijf = lib.slice(lib.indexOf(cmd), lib.indexOf('\n}', lib.indexOf(cmd)));
    assert.match(lijf, /standaard_app_status/, cmd);
  }
  const sa = lees('../../src-tauri/src/standaard_app.rs');
  assert.match(sa, /pub fn beheerd_status\(\) -> StandaardAppStatus \{\s*StandaardAppStatus \{ is_default: Some\(true\)/);
});

test('de melding "centraal beheerd" staat in elke taal', () => {
  const LOCALES = new URL('../i18n/locales/', import.meta.url);
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  const en = JSON.parse(readFileSync(new URL('en/ribbon.json', LOCALES), 'utf8')).help.updatesManaged;
  for (const taal of talen) {
    const v = JSON.parse(readFileSync(new URL(`${taal}/ribbon.json`, LOCALES), 'utf8')).help?.updatesManaged;
    assert.ok(typeof v === 'string' && v.trim(), `${taal} ontbreekt`);
    if (taal !== 'en') assert.notEqual(v, en, `${taal} is niet vertaald`);
  }
});
