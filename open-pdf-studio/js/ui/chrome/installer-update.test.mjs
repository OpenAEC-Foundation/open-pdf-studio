// Bijwerken via de OpenAEC Installer (installer-update.js) en de keuze tussen
// installer, eigen updater, beheerde modus en draagbare kopie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { maakInstallerUpdate, updateRoute, WACHT_OP_INSTALLER_MS } from './installer-update.js';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const lees = (...p) => fs.readFileSync(path.join(app, ...p), 'utf8');

test('route: beheerd en draagbaar gaan voor de installer; alleen Windows met installer', () => {
  assert.equal(updateRoute({ beheerd: true, draagbaar: true, platform: 'windows', installerAanwezig: true }), 'beheerd');
  assert.equal(updateRoute({ draagbaar: true, platform: 'windows', installerAanwezig: true }), 'draagbaar');
  assert.equal(updateRoute({ platform: 'windows', installerAanwezig: true }), 'installer');
  assert.equal(updateRoute({ platform: 'windows', installerAanwezig: false }), 'eigen');
  assert.equal(updateRoute({ platform: 'macos', installerAanwezig: true }), 'eigen');
  assert.equal(updateRoute({ platform: 'linux', installerAanwezig: true }), 'eigen');
  assert.equal(updateRoute(), 'eigen');
});

function deps(over = {}) {
  const log = [];
  return {
    log,
    invoke: async (cmd) => { log.push(cmd); },
    bestaat: async () => true,
    sluitAlleTabs: async () => { log.push('tabs'); },
    meldSchoonAfsluiten: async () => { log.push('schoon'); },
    eigenUpdate: async () => null,
    wacht: async (ms) => { log.push(`wacht ${ms}`); },
    ...over,
  };
}

const BESCHIKBAAR = { latest: '2026.45.0', current: '2026.44.6', installer: 'C:\OpenAEC\openaec-installer.exe' };

test('update uit het statusbestand: versies voor het venster, geen release-notes', () => {
  const u = maakInstallerUpdate(BESCHIKBAAR, deps());
  assert.equal(u.version, '2026.45.0');
  assert.equal(u.currentVersion, '2026.44.6');
  assert.equal(u.body, '');
});

test('installer aanwezig: eerst tabbladen dicht en schoon afsluiten, dan de installer', async () => {
  const d = deps();
  const u = maakInstallerUpdate(BESCHIKBAAR, d);
  // De installer sluit de app; leeft hij na het wachten nog, dan een fout in
  // plaats van een venster dat eeuwig "installeren" toont.
  await assert.rejects(u.downloadAndInstall(), /did not take over/);
  assert.deepEqual(d.log, ['tabs', 'schoon', 'plugin:openaec-update|update_now', `wacht ${WACHT_OP_INSTALLER_MS}`]);
});

test('annuleren bij het sluiten van een tabblad: de installer start niet', async () => {
  const d = deps({ sluitAlleTabs: async () => { throw new Error('cancelled'); } });
  await assert.rejects(maakInstallerUpdate(BESCHIKBAAR, d).downloadAndInstall(), /cancelled/);
  assert.ok(!d.log.includes('plugin:openaec-update|update_now'));
  assert.ok(!d.log.includes('schoon'));
});

test('installer uit het statusbestand verdwenen: eigen updater, geen tabbladen dicht', async () => {
  let eigenGeinstalleerd = false;
  const eigen = { downloadAndInstall: async () => { eigenGeinstalleerd = true; } };
  for (const beschikbaar of [
    BESCHIKBAAR, // pad bestaat niet meer
    { ...BESCHIKBAAR, installer: null }, // statusbestand noemt geen installer
  ]) {
    eigenGeinstalleerd = false;
    const d = deps({ bestaat: async () => false, eigenUpdate: async () => eigen });
    await maakInstallerUpdate(beschikbaar, d).downloadAndInstall();
    assert.ok(eigenGeinstalleerd, 'de eigen updater installeert');
    assert.deepEqual(d.log, [], 'geen tabbladen dicht en geen update_now');
  }
});

test('installer weg en ook de eigen updater heeft niets: een fout, geen tabbladen dicht', async () => {
  const d = deps({ bestaat: async () => { throw new Error('io'); } });
  await assert.rejects(maakInstallerUpdate(BESCHIKBAAR, d).downloadAndInstall(), /not found/);
  assert.deepEqual(d.log, []);
});

test('updater.js: beheerde modus eerst, draagbaar nooit via de installer', () => {
  const src = lees('js', 'ui', 'chrome', 'updater.js');
  const fn = src.slice(src.indexOf('export async function checkForUpdates'));
  assert.ok(fn.indexOf("magMelden('update-controle')") < fn.indexOf('updateRoute('));
  assert.match(fn, /installerAanwezig: !draagbaar && platform === 'windows'/);
  assert.match(fn, /route === 'installer' \? await checkViaInstaller\(\) : await check\(\)/);
  assert.match(src, /bestaat: \(path\) => invoke\('file_exists', \{ path \}\)/);
});

test('Rust: de installer-plugin alleen op Windows, niet beheerd, draagbaar of headless', () => {
  const lib = lees('src-tauri', 'src', 'lib.rs');
  assert.match(lib, /pub fn openaec_installer_plugin\(windows: bool, beheerd: bool, draagbaar: bool, headless: bool\) -> bool \{\s*windows && !beheerd && !draagbaar && !headless\s*\}/);
  const registratie = lib.indexOf('builder = builder.plugin(openaec_update::init("open-pdf-studio"))');
  assert.ok(registratie > 0);
  const voor = lib.slice(lib.lastIndexOf('if openaec_installer_plugin(', registratie), registratie);
  assert.match(voor, /cfg!\(windows\),\s*beheerd::is_beheerd\(\),\s*draagbaar::actief\(\),\s*headless::actief\(\),/);
  const caps = JSON.parse(lees('src-tauri', 'capabilities', 'default.json'));
  assert.ok(caps.permissions.includes('openaec-update:default'));
});
