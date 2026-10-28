// De standaard-PDF-app in een Flatpak/Snap of zonder xdg-mime: de app zegt
// waar de standaard gekozen wordt in plaats van stil te falen, en vraagt niet
// bij elke start om iets wat ze niet kan.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

import {
  leesStandaardAppStatus, moetBalkTonen, huidigeAppTekst, zetAlsStandaard, platformUit,
} from './standaard-pdf-app.js';

const lees = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function nepInvoke(antwoorden) {
  const aanroepen = [];
  const invoke = async (cmd, args) => {
    aanroepen.push(cmd);
    const a = antwoorden[cmd];
    if (a instanceof Error) throw a;
    if (a === undefined) throw new Error(`unknown command ${cmd}`);
    return typeof a === 'function' ? a(args) : a;
  };
  return { invoke, aanroepen };
}

const t = (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k);
const tCommon = (k) => `common.${k}`;

test('status van de Rust-kant, genormaliseerd', async () => {
  const { invoke } = nepInvoke({
    default_pdf_app_status: { isDefault: null, current: '', canSet: false, reason: 'flatpak' },
  });
  assert.deepEqual(await leesStandaardAppStatus(invoke), { isDefault: null, current: null, canSet: false, reason: 'flatpak' });
});

test('oudere backend: terugval op is_default_pdf_app; niets bereikbaar: onbekend', async () => {
  const oud = nepInvoke({ is_default_pdf_app: false });
  assert.deepEqual(await leesStandaardAppStatus(oud.invoke), { isDefault: false, current: null, canSet: true, reason: null });
  assert.deepEqual(oud.aanroepen, ['default_pdf_app_status', 'is_default_pdf_app']);
  const niets = nepInvoke({});
  const s = await leesStandaardAppStatus(niets.invoke);
  assert.equal(s.isDefault, null);
  assert.equal(s.canSet, false);
});

test('de balk bij het opstarten alleen als het zeker en te verhelpen is', () => {
  assert.equal(moetBalkTonen({ isDefault: false, canSet: true }), true);
  assert.equal(moetBalkTonen({ isDefault: true, canSet: true }), false);
  // Flatpak/Snap of geen xdg-mime: niet na te gaan, dus niet bij elke start vragen.
  assert.equal(moetBalkTonen({ isDefault: null, canSet: false, reason: 'flatpak' }), false);
  assert.equal(moetBalkTonen({ isDefault: null, canSet: false, reason: 'xdg-mime-missing' }), false);
  assert.equal(moetBalkTonen(null), false);
});

test('huidige standaard in Voorkeuren', () => {
  const o = { t, tCommon, platform: 'linux' };
  assert.equal(huidigeAppTekst({ isDefault: true }, o), 'common.appName');
  assert.equal(huidigeAppTekst({ isDefault: null, reason: 'flatpak' }, o), 'fileAssoc.chosenInSystemSettings');
  assert.equal(huidigeAppTekst({ isDefault: null, reason: 'snap' }, o), 'fileAssoc.chosenInSystemSettings');
  assert.equal(huidigeAppTekst({ isDefault: false, current: 'org.gnome.Evince' }, o), 'org.gnome.Evince');
  assert.equal(huidigeAppTekst({ isDefault: false, current: null }, o), 'fileAssoc.notSet');
  assert.equal(huidigeAppTekst({ isDefault: null, reason: 'xdg-mime-missing' }, o), 'common.unableToDetect');
  assert.equal(huidigeAppTekst({ isDefault: null, reason: 'unsupported' }, { ...o, platform: 'mac' }), 'fileAssoc.checkFinder');
});

test('instellen in een sandbox: uitleg, geen aanroep die toch faalt', async () => {
  for (const [reason, pakket] of [['flatpak', 'Flatpak'], ['snap', 'Snap']]) {
    const { invoke, aanroepen } = nepInvoke({ open_default_apps_settings: true });
    const m = await zetAlsStandaard({ invoke, status: { isDefault: null, canSet: false, reason }, platform: 'linux' });
    assert.deepEqual(m, { sleutel: 'fileAssoc.sandboxInstructions', opties: { package: pakket } });
    assert.deepEqual(aanroepen, []);
  }
  const { invoke, aanroepen } = nepInvoke({});
  assert.deepEqual(
    await zetAlsStandaard({ invoke, status: { reason: 'xdg-mime-missing' }, platform: 'linux' }),
    { sleutel: 'fileAssoc.xdgMimeMissing' },
  );
  assert.deepEqual(aanroepen, []);
});

test('instellen op Linux met xdg-mime: gelukt of de fout in beeld', async () => {
  const ok = nepInvoke({ open_default_apps_settings: true });
  assert.deepEqual(
    await zetAlsStandaard({ invoke: ok.invoke, status: { isDefault: false, canSet: true, reason: null }, platform: 'linux' }),
    { sleutel: 'fileAssoc.linuxDone' },
  );
  assert.deepEqual(ok.aanroepen, ['open_default_apps_settings']);
  const mis = nepInvoke({ open_default_apps_settings: new Error('xdg-mime exited with status 1') });
  assert.deepEqual(
    await zetAlsStandaard({ invoke: mis.invoke, status: { isDefault: false, canSet: true }, platform: 'linux' }),
    { sleutel: 'fileAssoc.linuxFailed', opties: { error: 'xdg-mime exited with status 1' } },
  );
});

test('instellen op Windows en macOS', async () => {
  const ok = nepInvoke({ open_default_apps_settings: true });
  assert.deepEqual(await zetAlsStandaard({ invoke: ok.invoke, status: {}, platform: 'windows' }), { sleutel: 'fileAssoc.windowsInstructions' });
  const mis = nepInvoke({ open_default_apps_settings: new Error('x') });
  assert.deepEqual(await zetAlsStandaard({ invoke: mis.invoke, status: {}, platform: 'windows' }), { sleutel: 'fileAssoc.windowsFailed' });
  const mac = nepInvoke({});
  assert.deepEqual(await zetAlsStandaard({ invoke: mac.invoke, status: {}, platform: 'mac' }), { sleutel: 'fileAssoc.macInstructions' });
  assert.deepEqual(mac.aanroepen, []);
});

test('platform uit navigator', () => {
  assert.equal(platformUit('Win32'), 'windows');
  assert.equal(platformUit('MacIntel'), 'mac');
  assert.equal(platformUit('Linux x86_64'), 'linux');
  assert.equal(platformUit(''), 'linux');
});

test('bedrading: opstartbalk, meldingsbalk, Voorkeuren en platform.js gebruiken de module', () => {
  const main = lees('../main.js');
  assert.match(main, /import \{ moetBalkTonen \} from '\.\/core\/standaard-pdf-app\.js';/);
  assert.match(main, /if \(!moetBalkTonen\(await defaultPdfAppStatus\(\)\)\) return;/);
  const platform = lees('./platform.js');
  assert.match(platform, /export async function defaultPdfAppStatus\(\) \{\n\s*return leesStandaardAppStatus\(invoke\);/);
  const balk = lees('../solid/components/NotificationBar.jsx');
  assert.match(balk, /zetAlsStandaard\(\{/);
  assert.match(balk, /showMessage\(tPrefs\(melding\.sleutel, melding\.opties\)\)/);
  const tab = lees('../solid/components/preferences/FileAssocTab.jsx');
  assert.doesNotMatch(tab, /require\(/, 'geen Node-API in de webview');
  assert.doesNotMatch(tab, /xdg-mime query/);
  assert.match(tab, /huidigeAppTekst\(status, \{ t, tCommon, platform \}\)/);
  assert.match(tab, /zetAlsStandaard\(\{ invoke, status, platform \}\)/);
  assert.match(tab, /showMessage\(t\(melding\.sleutel, melding\.opties\)\)/);
  // De Rust-kant registreert de opdracht.
  const lib = readFileSync(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  assert.match(lib, /\n\s+default_pdf_app_status,\n/);
  assert.match(lib, /async fn default_pdf_app_status\(\) -> standaard_app::StandaardAppStatus/);
});

test('alle 40 talen hebben de nieuwe meldingen, vertaald en met hun plaatshouders', () => {
  const map = new URL('../i18n/locales/', import.meta.url);
  const talen = readdirSync(map);
  assert.equal(talen.length, 40);
  const fa = (taal) => JSON.parse(readFileSync(new URL(`${taal}/preferences.json`, map), 'utf8')).fileAssoc;
  const en = fa('en');
  const sleutels = ['chosenInSystemSettings', 'sandboxInstructions', 'xdgMimeMissing', 'linuxDone', 'linuxFailed'];
  for (const taal of talen) {
    const blok = fa(taal);
    for (const k of sleutels) {
      assert.ok(typeof blok[k] === 'string' && blok[k].trim(), `${taal} fileAssoc.${k}`);
      if (taal !== 'en') assert.notEqual(blok[k], en[k], `${taal} fileAssoc.${k} is English`);
    }
    assert.match(blok.sandboxInstructions, /\{\{package\}\}/, taal);
    assert.match(blok.linuxFailed, /\{\{error\}\}/, taal);
    assert.match(blok.xdgMimeMissing, /xdg-utils/, taal);
  }
});
