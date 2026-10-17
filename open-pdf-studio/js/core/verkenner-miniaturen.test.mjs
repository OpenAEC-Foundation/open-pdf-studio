// PDF-miniaturen in Windows Verkenner (#605): de keuze in de voorkeuren, de
// aanroep van de Rust-commando's, en dat app, DLL, installer en CI dezelfde
// namen gebruiken.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GEEN_MINIATUREN,
  bepaalActie,
  leesMiniatuurStatus,
  normaliseerStatus,
  zetMiniaturen,
} from './verkenner-miniaturen.js';

const hier = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(hier, '../..');
const repo = path.resolve(app, '..');
const lees = (...p) => fs.readFileSync(path.join(...p), 'utf8').replace(/\r\n/g, '\n');

const BASIS = { supported: true, available: true, enabled: false, otherHandler: null, defaultAppHandler: null };

function nepInvoke(antwoord = {}) {
  const aanroepen = [];
  const invoke = async (cmd, args) => {
    aanroepen.push([cmd, args]);
    if (antwoord instanceof Error) throw antwoord;
    return antwoord;
  };
  return { invoke, aanroepen };
}

test('normaliseerStatus maakt van alles een volledige toestand', () => {
  assert.deepEqual(normaliseerStatus(null), GEEN_MINIATUREN);
  assert.deepEqual(normaliseerStatus('x'), GEEN_MINIATUREN);
  assert.deepEqual(
    normaliseerStatus({ supported: true, available: 1, enabled: true, otherHandler: '  ', defaultAppHandler: ' Viewer ' }),
    { supported: true, available: false, enabled: true, otherHandler: null, defaultAppHandler: 'Viewer' },
  );
});

test('bepaalActie', () => {
  assert.equal(bepaalActie(GEEN_MINIATUREN, true), 'niets', 'niet ondersteund');
  assert.equal(bepaalActie(BASIS, true), 'aan');
  assert.equal(bepaalActie(BASIS, false), 'niets', 'staat al uit');
  assert.equal(bepaalActie({ ...BASIS, enabled: true }, true), 'niets', 'staat al aan');
  assert.equal(bepaalActie({ ...BASIS, enabled: true }, false), 'uit');
  assert.equal(bepaalActie({ ...BASIS, available: false }, true), 'niets', 'build zonder DLL');
  assert.equal(bepaalActie({ ...BASIS, available: false, enabled: true }, false), 'uit', 'uitzetten kan altijd');
  assert.equal(bepaalActie({ ...BASIS, otherHandler: 'Other Viewer' }, true), 'vragen');
  // Een handler via de standaard-app vervangen we nooit; geen vraag nodig.
  assert.equal(bepaalActie({ ...BASIS, defaultAppHandler: 'Other Viewer' }, true), 'aan');
});

test('aanzetten roept explorer_thumbnails_set aan zonder iets te vervangen', async () => {
  const { invoke, aanroepen } = nepInvoke({ ...BASIS, enabled: true });
  const s = await zetMiniaturen(true, BASIS, { invoke, vraag: async () => assert.fail('geen vraag verwacht') });
  assert.deepEqual(aanroepen, [['explorer_thumbnails_set', { enabled: true, replaceOther: false }]]);
  assert.equal(s.enabled, true);
});

test('uitzetten', async () => {
  const { invoke, aanroepen } = nepInvoke(BASIS);
  const s = await zetMiniaturen(false, { ...BASIS, enabled: true }, { invoke });
  assert.deepEqual(aanroepen, [['explorer_thumbnails_set', { enabled: false, replaceOther: false }]]);
  assert.equal(s.enabled, false);
});

test('een ander programma: eerst vragen, en alleen met ja vervangen', async () => {
  const status = { ...BASIS, otherHandler: 'Other Viewer' };
  const gevraagd = [];

  const nee = nepInvoke({});
  const s = await zetMiniaturen(true, status, { invoke: nee.invoke, vraag: async (naam) => { gevraagd.push(naam); return false; } });
  assert.deepEqual(nee.aanroepen, [], 'bij nee wordt niets geregistreerd');
  assert.equal(s.enabled, false);

  const ja = nepInvoke({ ...BASIS, enabled: true });
  await zetMiniaturen(true, status, { invoke: ja.invoke, vraag: async (naam) => { gevraagd.push(naam); return true; } });
  assert.deepEqual(ja.aanroepen, [['explorer_thumbnails_set', { enabled: true, replaceOther: true }]]);
  assert.deepEqual(gevraagd, ['Other Viewer', 'Other Viewer']);

  // Zonder vraagfunctie nooit stilzwijgend vervangen.
  const zonder = nepInvoke({});
  await zetMiniaturen(true, status, { invoke: zonder.invoke });
  assert.deepEqual(zonder.aanroepen, []);
});

test('niets doen als het niet kan of al zo staat', async () => {
  const { invoke, aanroepen } = nepInvoke({});
  await zetMiniaturen(true, GEEN_MINIATUREN, { invoke });
  await zetMiniaturen(true, { ...BASIS, available: false }, { invoke });
  await zetMiniaturen(true, { ...BASIS, enabled: true }, { invoke });
  assert.deepEqual(aanroepen, []);
});

test('een fout van Rust komt bij de aanroeper; status lezen faalt stil', async () => {
  const fout = nepInvoke(new Error('registry: 5'));
  await assert.rejects(zetMiniaturen(true, BASIS, { invoke: fout.invoke }), /registry: 5/);
  assert.deepEqual(await leesMiniatuurStatus(fout.invoke), GEEN_MINIATUREN);
  const ok = nepInvoke({ ...BASIS, otherHandler: 'X' });
  assert.equal((await leesMiniatuurStatus(ok.invoke)).otherHandler, 'X');
  assert.deepEqual(ok.aanroepen, [['explorer_thumbnails_status', {}]]);
});

// ---------------------------------------------------------------------------
// Bedrading: Rust-commando's, tabblad, installer, CI.
// ---------------------------------------------------------------------------

test('de Rust-commando\'s bestaan en zijn geregistreerd', () => {
  const lib = lees(app, 'src-tauri/src/lib.rs');
  assert.match(lib, /async fn explorer_thumbnails_status\(app: tauri::AppHandle\)/);
  assert.match(lib, /async fn explorer_thumbnails_set\(\s*app: tauri::AppHandle,\s*enabled: bool,\s*replace_other: bool,?\s*\)/);
  const handler = lib.slice(lib.indexOf('generate_handler!['));
  assert.match(handler, /\bexplorer_thumbnails_status,/);
  assert.match(handler, /\bexplorer_thumbnails_set,/);
  assert.match(lib, /pub mod verkenner_miniaturen;/);
  const mod = lees(app, 'src-tauri/src/verkenner_miniaturen.rs');
  assert.match(mod, /#\[path = "\.\.\/\.\.\/\.\.\/open-pdf-thumbnails\/src\/registratie\.rs"\]/);
  assert.ok(fs.existsSync(path.join(app, 'src-tauri/src', '../../../open-pdf-thumbnails/src/registratie.rs')));
  // De JSON-velden die de JS leest.
  assert.match(mod, /#\[serde\(rename_all = "camelCase"\)\]/);
  for (const veld of ['supported', 'available', 'enabled', 'other_handler', 'default_app_handler']) {
    assert.match(mod, new RegExp(`pub ${veld}:`), veld);
  }
});

test('het tabblad Bestandskoppeling gebruikt de module', () => {
  const tab = lees(app, 'js/solid/components/preferences/FileAssocTab.jsx');
  assert.match(tab, /from '\.\.\/\.\.\/\.\.\/core\/verkenner-miniaturen\.js'/);
  assert.match(tab, /data-testid="prefs-explorer-thumbnails"/);
  assert.match(tab, /zetMiniaturen\(aan, miniaturen\(\), \{ vraag: vraagVervangen \}\)/);
  assert.match(tab, /<Show when=\{miniaturen\(\)\.supported\}>/);
  for (const k of ['title', 'show', 'help', 'unavailable', 'otherHandler', 'defaultApp', 'replaceTitle', 'replaceConfirm', 'failed']) {
    assert.match(tab, new RegExp(`'explorerThumbnails\\.${k}'`), k);
  }
});

function rustConst(bron, naam) {
  const m = bron.match(new RegExp(`pub const ${naam}: &str = "([^"]+)";`));
  assert.ok(m, `${naam} niet gevonden`);
  return m[1];
}

function nsisDefine(bron, naam) {
  const m = bron.match(new RegExp(`^!define ${naam} "([^"]+)"`, 'm'));
  assert.ok(m, `${naam} niet gevonden`);
  return m[1];
}

test('DLL, app, installer en bundel gebruiken dezelfde namen', () => {
  const reg = lees(repo, 'open-pdf-thumbnails/src/registratie.rs');
  const hooks = lees(app, 'src-tauri/nsis/hooks.nsh');
  const clsid = rustConst(reg, 'CLSID');
  assert.match(clsid, /^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/);
  // De numerieke vorm (voor DllGetClassObject) hoort bij de tekst.
  const waarde = reg.match(/pub const CLSID_WAARDE: u128 = 0x([0-9A-F_]+);/)[1].replace(/_/g, '');
  assert.equal(waarde, clsid.replace(/[{}-]/g, ''));
  assert.equal(nsisDefine(hooks, 'OPDS_THUMB_CLSID'), clsid);
  assert.equal(nsisDefine(hooks, 'OPDS_THUMB_DLL'), rustConst(reg, 'DLL_NAAM'));
  assert.equal(nsisDefine(hooks, 'OPDS_THUMB_PREVIOUS'), rustConst(reg, 'VORIGE_WAARDE'));
  const shellex = rustConst(reg, 'MINIATUUR_SHELLEX');
  assert.equal(shellex, '{E357FCCD-A995-4576-B01F-234630154E96}');
  assert.equal(nsisDefine(hooks, 'OPDS_THUMB_SHELLEX_KEY'), `Software\\Classes\\.pdf\\ShellEx\\${shellex}`);

  const win = JSON.parse(lees(app, 'src-tauri/tauri.windows.conf.json'));
  assert.equal(win.bundle.resources['binaries/open-pdf-thumbnails.dll'], rustConst(reg, 'DLL_NAAM'));
  // Naast pdfium.dll: de DLL laadt hem uit zijn eigen map.
  assert.equal(win.bundle.resources['binaries/win-x64/pdfium.dll'], 'pdfium.dll');
});

test('de installer zet de miniaturen nooit aan en ruimt ze op bij verwijderen', () => {
  const hooks = lees(app, 'src-tauri/nsis/hooks.nsh');
  // Alleen HKCU, nooit HKLM of SHCTX voor de miniaturen.
  const blok = hooks.slice(hooks.indexOf('!define OPDS_THUMB_DLL'), hooks.indexOf('!macro NSIS_HOOK_PREINSTALL'));
  assert.doesNotMatch(blok, /\b(HKLM|SHCTX)\b/);
  assert.match(blok, /!macro OPDS_THUMB_UNREGISTER/);
  // Alleen de registratie die naar deze installatie wijst.
  assert.match(blok, /\$\{If\} \$R1 == "\$INSTDIR\\\$\{OPDS_THUMB_DLL\}"/);
  // Een vervangen handler gaat terug.
  assert.match(blok, /WriteRegStr HKCU "\$\{OPDS_THUMB_SHELLEX_KEY\}" "" "\$R3"/);
  // Lege sleutels alleen als ze echt leeg zijn (geen DeleteRegKey \/ifempty op .pdf).
  assert.doesNotMatch(hooks, /DeleteRegKey \/ifempty HKCU "Software\\Classes\\\.pdf"/);
  const install = hooks.slice(hooks.indexOf('!macro NSIS_HOOK_POSTINSTALL'));
  assert.doesNotMatch(install.slice(0, install.indexOf('!macroend')), /OPDS_THUMB/);
  // Bij verwijderen, niet bij een update of herinstallatie.
  const pre = hooks.slice(hooks.indexOf('!macro NSIS_HOOK_PREUNINSTALL'));
  const deel = pre.slice(pre.indexOf('File Explorer thumbnails (#605)'));
  assert.match(deel, /"\/KEEPPRINTER"[\s\S]*\$UpdateMode = 1[\s\S]*\$\{Else\}\s*!insertmacro OPDS_THUMB_UNREGISTER/);
  assert.match(hooks, /!macro NSIS_HOOK_PREINSTALL\s*!insertmacro OPDS_THUMB_MOVE_ASIDE/);
});

test('bouwen: werkruimte, build.rs, npm-voorscripts, release en gitignore', () => {
  const cargo = lees(repo, 'Cargo.toml');
  assert.match(cargo, /"open-pdf-thumbnails",/);
  const build = lees(app, 'src-tauri/build.rs');
  assert.match(build, /"open_pdf_thumbnails\.dll"/);
  assert.match(build, /join\("open-pdf-thumbnails\.dll"\)/);
  const pkg = JSON.parse(lees(app, 'package.json'));
  assert.match(pkg.scripts.predev, /cargo build -p pdfium-worker -p open-pdf-thumbnails$/);
  assert.match(pkg.scripts.prebuild, /cargo build --release -p pdfium-worker -p open-pdf-thumbnails$/);
  const release = lees(repo, '.github/workflows/release.yml');
  assert.match(release, /cargo build --release -p pdfium-worker -p open-pdf-thumbnails/);
  assert.match(release, /Copy-Item target\/release\/open_pdf_thumbnails\.dll open-pdf-studio\/src-tauri\/binaries\/open-pdf-thumbnails\.dll -Force/);
  assert.match(release, /files-folder-filter: exe,dll/);
  assert.match(release, /'open-pdf-thumbnails\.dll', 'uninstall\.exe'/);
  // Het bouwen en kopiëren gebeurt vóór het ondertekenen.
  assert.ok(release.indexOf('open_pdf_thumbnails.dll') < release.indexOf('azure/trusted-signing-action'));
  const ignore = lees(repo, '.gitignore');
  assert.match(ignore, /^open-pdf-studio\/src-tauri\/binaries\/open-pdf-thumbnails\.dll$/m);
});
