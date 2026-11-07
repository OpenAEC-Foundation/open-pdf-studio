// Taal en thema van de OpenAEC SuperCloud (#977): de waarden van het contract
// naar de taal- en thema-ids van de app, onbekende waarden genegeerd, en het
// event openaec-host-preferences.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  taalUitHost, themaUitHost, leesHostVoorkeuren, neemHostVoorkeurenOver, volgHostVoorkeuren,
  HOST_VOORKEUREN_EVENT, HOST_THEMAS,
} from './host-voorkeuren.js';
import { HOST_KLAAR_EVENT } from './site-host.js';

const lees = (pad) => fs.readFileSync(new URL(pad, import.meta.url), 'utf8');
// De taalcodes van de app, uit i18n/config.js (zonder i18next te laden).
const TALEN = [...lees('../i18n/config.js').matchAll(/\{ code: '([a-z]+)'/g)].map((m) => m[1]).filter((c) => c !== 'auto');

test('de talen van het contract bestaan in de app', () => {
  assert.ok(TALEN.length > 30, 'talen gelezen');
  for (const taal of ['nl', 'en', 'de', 'fr', 'es', 'tr']) assert.equal(taalUitHost(taal, TALEN), taal);
});

test('taal: regio en hoofdletters weg, onbekend genegeerd', () => {
  assert.equal(taalUitHost('nl-NL', TALEN), 'nl');
  assert.equal(taalUitHost(' EN_us ', TALEN), 'en');
  assert.equal(taalUitHost('xx', TALEN), null);
  assert.equal(taalUitHost('auto', TALEN), null);
  assert.equal(taalUitHost('', TALEN), null);
  assert.equal(taalUitHost('javascript:alert(1)', TALEN), null);
  assert.equal(taalUitHost(42, TALEN), null);
  assert.equal(taalUitHost('nl', undefined), null);
});

test('thema: light en dark naar de thema-ids van de app, de rest genegeerd', () => {
  assert.deepEqual(Object.keys(HOST_THEMAS), ['light', 'dark']);
  // De ids bestaan in de themakiezer van de app.
  const kiezer = lees('../solid/components/ribbon/ThemePicker.jsx');
  for (const id of Object.values(HOST_THEMAS)) assert.match(kiezer, new RegExp(`value: '${id}'`));
  assert.equal(themaUitHost('light'), 'light');
  assert.equal(themaUitHost('Dark '), 'dark');
  assert.equal(themaUitHost('blueprint'), null);
  assert.equal(themaUitHost('system'), null);
  assert.equal(themaUitHost(null), null);
});

test('leesHostVoorkeuren: host eerst (taal/thema, of locale/theme), dan de hash; zonder host niets', () => {
  assert.deepEqual(leesHostVoorkeuren({ host: { taal: 'nl', thema: 'dark' }, talen: TALEN }), { language: 'nl', theme: 'dark' });
  assert.deepEqual(leesHostVoorkeuren({ host: { locale: 'de', theme: 'light' }, talen: TALEN }), { language: 'de', theme: 'light' });
  assert.deepEqual(leesHostVoorkeuren({ host: {}, hash: '#app=pdf&taal=fr&thema=light', talen: TALEN }), { language: 'fr', theme: 'light' });
  assert.deepEqual(leesHostVoorkeuren({ host: { taal: 'tr' }, hash: '#taal=fr&thema=dark', talen: TALEN }), { language: 'tr', theme: 'dark' });
  assert.deepEqual(leesHostVoorkeuren({ host: { taal: 'xx', thema: 'paars' }, talen: TALEN }), {});
  assert.deepEqual(leesHostVoorkeuren({ host: null, hash: '#taal=nl&thema=dark', talen: TALEN }), {}, 'losse webversie: hash genegeerd');
});

test('neemHostVoorkeurenOver: alleen wat anders is, en meldt of er iets veranderde', () => {
  const v = { language: 'auto', theme: 'default', zoomDpi: 96 };
  assert.equal(neemHostVoorkeurenOver(v, { language: 'nl', theme: 'dark' }), true);
  assert.deepEqual(v, { language: 'nl', theme: 'dark', zoomDpi: 96 });
  assert.equal(neemHostVoorkeurenOver(v, { language: 'nl', theme: 'dark' }), false);
  assert.equal(neemHostVoorkeurenOver(v, {}), false);
  assert.equal(neemHostVoorkeurenOver(null, { language: 'nl' }), false);
});

function nepVenster({ host, hash = '' } = {}) {
  const doel = new EventTarget();
  return Object.assign(doel, { openaecHost: host, location: { hash } });
}

test('volgHostVoorkeuren: bij de start, bij openaec-host-preferences en bij een late host', () => {
  const prefs = { language: 'en', theme: 'default' };
  let toegepast = 0;
  const venster = nepVenster({ host: { open() {}, save() {}, taal: 'nl', thema: 'dark' } });
  const stop = volgHostVoorkeuren({ venster, talen: TALEN, voorkeuren: () => prefs, pasToe: () => { toegepast += 1; } });
  assert.deepEqual(prefs, { language: 'nl', theme: 'dark' });
  assert.equal(toegepast, 1);

  // Dezelfde host, nieuwe waarden.
  venster.openaecHost.taal = 'de';
  venster.openaecHost.thema = 'light';
  venster.dispatchEvent(new Event(HOST_VOORKEUREN_EVENT));
  assert.deepEqual(prefs, { language: 'de', theme: 'light' });
  assert.equal(toegepast, 2);

  // Een onbekende waarde laat staan wat er was; niets toe te passen.
  venster.openaecHost.thema = 'neon';
  venster.dispatchEvent(new Event(HOST_VOORKEUREN_EVENT));
  assert.deepEqual(prefs, { language: 'de', theme: 'light' });
  assert.equal(toegepast, 2);

  stop();
  venster.openaecHost.taal = 'fr';
  venster.dispatchEvent(new Event(HOST_VOORKEUREN_EVENT));
  assert.equal(prefs.language, 'de', 'na stop geen wijzigingen meer');

  // Zonder host bij de start: niets; komt hij later (openaec-host-ready), dan wel.
  const later = { language: 'en', theme: 'default' };
  const v2 = nepVenster({ hash: '#taal=es&thema=dark' });
  volgHostVoorkeuren({ venster: v2, talen: TALEN, voorkeuren: () => later, pasToe: () => {} });
  assert.deepEqual(later, { language: 'en', theme: 'default' });
  v2.openaecHost = { open() {}, save() {} };
  v2.dispatchEvent(new Event(HOST_KLAAR_EVENT));
  assert.deepEqual(later, { language: 'es', theme: 'dark' }, 'hash als terugval van de host');
});

test('volgHostVoorkeuren: een fout bij het toepassen breekt de app niet', () => {
  const prefs = { language: 'en', theme: 'default' };
  const waarschuw = console.warn;
  console.warn = () => {};
  try {
    assert.doesNotThrow(() => volgHostVoorkeuren({
      venster: nepVenster({ host: { taal: 'nl' } }), talen: TALEN, voorkeuren: () => prefs,
      pasToe: () => { throw new Error('kapot'); },
    }));
  } finally {
    console.warn = waarschuw;
  }
  assert.equal(prefs.language, 'nl');
  assert.doesNotThrow(() => volgHostVoorkeuren({ venster: null, talen: TALEN, voorkeuren: () => prefs, pasToe: () => {} })());
});

test('main.js past taal en thema van de host alleen in de gehoste bouw toe, na loadPreferences', () => {
  const main = lees('../main.js').replace(/\r\n/g, '\n');
  const laden = main.indexOf('await loadPreferences();\n  // In de werkplek');
  assert.ok(laden > 0, 'loadPreferences gevonden');
  const aanroep = main.indexOf("if (import.meta.env.MODE === 'hosted') startHostVoorkeuren();");
  assert.ok(aanroep > laden, 'startHostVoorkeuren na loadPreferences');
});
