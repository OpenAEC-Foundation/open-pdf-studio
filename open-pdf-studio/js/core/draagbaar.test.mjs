// Draagbare modus (#881), frontendkant: de toestand uit Rust, wat er dan
// niet kan, en dat bijwerker, "vorige versie", de standaard-app-vraag en de
// voorkeuren erop letten.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ALLEEN_GEINSTALLEERD, GEEN_DRAAGBAAR, RELEASES_URL, _vergeetDraagbaar, functieBeschikbaar,
  isDraagbaar, leesDraagbaar, normaliseerDraagbaar, zipNaam,
} from './draagbaar.js';
import { pickAssets, pickDownloadUrl } from '../help/previous-version.js';

const hier = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(hier, '../..');
const lees = (...p) => fs.readFileSync(path.join(app, ...p), 'utf8').replace(/\r\n/g, '\n');

const DRAAGBAAR = { portable: true, dataDir: 'E:/OPDS/data', exeDir: 'E:/OPDS', fixedRuntime: false, dataDirError: null };

test('normaliseer: alleen echte waarden, de rest valt terug op "niet draagbaar"', () => {
  assert.deepEqual(normaliseerDraagbaar(null), GEEN_DRAAGBAAR);
  assert.deepEqual(normaliseerDraagbaar('ja'), GEEN_DRAAGBAAR);
  assert.deepEqual(normaliseerDraagbaar({ portable: 'true' }), GEEN_DRAAGBAAR);
  assert.deepEqual(normaliseerDraagbaar(DRAAGBAAR), DRAAGBAAR);
  assert.deepEqual(
    normaliseerDraagbaar({ portable: true, dataDir: '  ', exeDir: 3, dataDirError: ' E:\\ alleen-lezen ' }),
    { portable: true, dataDir: null, exeDir: null, fixedRuntime: false, dataDirError: 'E:\\ alleen-lezen' },
  );
});

test('wat een installatie vraagt, staat uit in de draagbare modus en nergens anders', () => {
  assert.deepEqual([...ALLEEN_GEINSTALLEERD].sort(), ['autoUpdate', 'defaultAppPrompt', 'explorerThumbnails', 'virtualPrinter']);
  for (const naam of ALLEEN_GEINSTALLEERD) {
    assert.equal(functieBeschikbaar(naam, DRAAGBAAR), false, naam);
    assert.equal(functieBeschikbaar(naam, GEEN_DRAAGBAAR), true, naam);
    assert.equal(functieBeschikbaar(naam, undefined), true, naam);
  }
  assert.equal(functieBeschikbaar('ocr', DRAAGBAAR), true);
});

test('leesDraagbaar: één keer gevraagd, met het juiste commando', async () => {
  _vergeetDraagbaar();
  const aanroepen = [];
  const invoke = async (cmd, args) => { aanroepen.push([cmd, args]); return DRAAGBAAR; };
  assert.deepEqual(await leesDraagbaar(invoke), DRAAGBAAR);
  assert.equal(await isDraagbaar(invoke), true);
  assert.deepEqual(aanroepen, [['portable_status', {}]]);
  _vergeetDraagbaar();
});

test('leesDraagbaar: een fout (oudere backend, browser) telt als niet draagbaar', async () => {
  _vergeetDraagbaar();
  const status = await leesDraagbaar(async () => { throw new Error('command portable_status not found'); });
  assert.deepEqual(status, GEEN_DRAAGBAAR);
  _vergeetDraagbaar();
  // Zonder Tauri (Node, browser) vraagt de standaard-invoke niets aan Rust.
  assert.deepEqual(await leesDraagbaar(), GEEN_DRAAGBAAR);
  _vergeetDraagbaar();
});

test('zipnaam en releasepagina', () => {
  assert.equal(zipNaam('v2026.45.1'), 'Open.PDF.Studio_2026.45.1_x64_portable.zip');
  assert.match(RELEASES_URL, /^https:\/\/github\.com\/OpenAEC-Foundation\/open-pdf-studio\/releases\/latest$/);
});

test('vorige versie: draagbaar kiest de zip, nooit een installer', () => {
  const assets = pickAssets({
    html_url: 'pagina',
    assets: [
      { name: 'Open.PDF.Studio_2026.44.4_x64-setup.exe', browser_download_url: 'sys' },
      { name: 'Open.PDF.Studio_2026.44.4_x64_user-setup.exe', browser_download_url: 'usr' },
      { name: 'Open.PDF.Studio_2026.44.4_x64_portable.zip', browser_download_url: 'zip' },
      { name: 'Open.PDF.Studio_2026.44.4_x64_portable.zip.sha256', browser_download_url: 'hash' },
    ],
  });
  assert.equal(assets.winPortable, 'zip');
  assert.equal(pickDownloadUrl(assets, 'Windows NT', { portable: true }), 'zip');
  assert.equal(pickDownloadUrl(assets, 'Windows NT'), 'usr');
  // Een release van vóór de zip: de pagina, geen installer.
  assert.equal(pickDownloadUrl({ ...assets, winPortable: null }, 'Windows NT', { portable: true }), 'pagina');
});

test('Rust registreert portable_status en weigert wat een installatie vraagt', () => {
  const lib = lees('src-tauri', 'src', 'lib.rs');
  assert.match(lib, /draagbaar::portable_status,/);
  assert.match(lib, /fn install_virtual_printer[^{]*\{\s*(\/\/[^\n]*\n\s*)*draagbaar::weiger_als_draagbaar\(\)\?;/);
  assert.match(lib, /if enabled \{\s*draagbaar::weiger_als_draagbaar\(\)\?;/);
  assert.match(lib, /draagbaar::pas_context_aan\(&mut context\);/);
  const main = lees('src-tauri', 'src', 'main.rs');
  // Als eerste in main(): vóór alles wat omgevingsvariabelen leest.
  const lijf = main.slice(main.indexOf('fn main()'));
  assert.ok(lijf.indexOf('draagbaar::activeer()') < lijf.indexOf('configure_appimage_gio_modules'));
  assert.ok(lijf.indexOf('draagbaar::activeer()') < lijf.indexOf('app_lib::run('));
});

test('bijwerker: draagbaar alleen melden en naar de zip verwijzen, nooit installeren', () => {
  const src = lees('js', 'ui', 'chrome', 'updater.js');
  const tak = src.indexOf('if (update && await isDraagbaar())');
  assert.ok(tak > 0, 'draagbare tak ontbreekt');
  assert.ok(tak < src.indexOf("openDialog('update'"), 'de draagbare tak komt vóór het updatevenster');
  const melding = src.slice(src.indexOf('async function showPortableUpdateMessage'));
  assert.match(melding, /common:portable\.updateAvailable/);
  assert.match(melding, /openExtern\(RELEASES_URL\)/);
  assert.doesNotMatch(melding.slice(0, melding.indexOf('\n}\n')), /downloadAndInstall|openDialog/);
});

test('geen vraag om standaard-PDF-app te worden en een melding bij een alleen-lezen map', () => {
  const main = lees('js', 'main.js');
  const check = main.slice(main.indexOf('async function checkDefaultPdfApp'));
  assert.ok(check.indexOf("functieBeschikbaar('defaultAppPrompt'") < check.indexOf('isDefaultPdfApp()'));
  assert.match(main, /common:portable\.notWritable/);
});

test('voorkeuren: uitleg in plaats van knoppen voor koppeling, miniaturen en printer', () => {
  const assoc = lees('js', 'solid', 'components', 'preferences', 'FileAssocTab.jsx');
  assert.match(assoc, /tCommon\('portable\.fileAssoc'\)/);
  assert.match(assoc, /tCommon\('portable\.explorerThumbnails'\)/);
  assert.match(assoc, /<Show when=\{miniaturen\(\)\.supported && !draagbaar\(\)\.portable\}>/);
  const printer = lees('js', 'solid', 'components', 'preferences', 'VirtualPrinterTab.jsx');
  assert.match(printer, /tCommon\('portable\.virtualPrinter'\)/);
  assert.match(printer, /if \(!s\.portable\) checkStatus\(\);/);
});
