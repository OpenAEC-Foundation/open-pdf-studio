// Bedrading van de Verkenner-acties (#945), als broncontrole: Rust zet elke
// start in de wachtrij en geeft een seintje, de frontend haalt de rij op na
// de start, en het samenvoegvenster gebruikt de modus voor een nieuw
// document. Het gedrag zelf: shell-acties-logica.test.mjs en de Rust-tests in
// verkenner_acties.rs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const APP = new URL('../../', import.meta.url);
const lees = (pad) => readFileSync(new URL(pad, APP), 'utf8').replace(/\r\n/g, '\n');

test('Rust: start en volgende starts gaan door de wachtrij', () => {
  const lib = lees('src-tauri/src/lib.rs');
  assert.match(lib, /pub mod verkenner_acties;/);
  assert.match(lib, /let start_shell_actie = verkenner_acties::actie_uit_args\(&args, startmap\.as_deref\(\)\);/);
  // Een actie is geen "openen".
  assert.match(lib, /let opened_files: Vec<String> = if start_shell_actie\.is_some\(\) \{ Vec::new\(\) \}/);
  assert.match(lib, /\.manage\(verkenner_acties::ShellActieWachtrij::met\(start_shell_actie\)\)/);
  // Single-instance: in de rij, seintje, en niet ook nog als open-files.
  const m = lib.match(/tauri_plugin_single_instance::init\(([\s\S]*?)let files: Vec<String> = argv/);
  assert.ok(m, 'single-instance-callback gevonden');
  assert.match(m[1], /verkenner_acties::actie_uit_args\(&argv, basis\)/);
  assert.match(m[1], /allow_file\(path\)/);
  assert.match(m[1], /ShellActieWachtrij>\(\)\.voeg_toe\(actie\)/);
  assert.match(m[1], /app\.emit\("shell-action", \(\)\)/);
  assert.match(m[1], /return;/);
  assert.match(lib, /verkenner_acties::get_shell_action,/);
  assert.match(lib, /ShellActieWachtrij>\(\)\.paden\(\)/);
});

test('frontend: luistert vanaf de start en haalt de rij op als de app klaar is', () => {
  const main = lees('js/main.js');
  assert.match(main, /import \{ startShellActies \} from '\.\/core\/shell-acties\.js';/);
  assert.match(main, /appReady = true;\n\s*startShellActies\(\{ openFiles \}\)/);
  const acties = lees('js/core/shell-acties.js');
  assert.match(acties, /invoke\('get_shell_action'\)/);
  assert.match(acties, /event\.listen\('shell-action'/);
  assert.match(acties, /openDialog\('merge-pdfs', \{ files, combineNew: true \}\)/);
  assert.match(acties, /openAlsCadTekening\(pad\)/);
  assert.match(acties, /writeBinaryFileNew/);
  assert.doesNotMatch(acties, /writeBinaryFile\(/, 'omzetten overschrijft nooit');
});

test('samenvoegvenster: modus voor een nieuw document', () => {
  const d = lees('js/solid/components/dialogs/MergePdfsDialog.jsx');
  assert.match(d, /export default function MergePdfsDialog\(props\)/);
  assert.match(d, /const modus = mergeVensterModus\(props\?\.data\);/);
  assert.match(d, /title=\{t\(modus\.titelSleutel\)\}/);
  assert.match(d, /modus\.knopSleutel \? t\(modus\.knopSleutel\) : tCommon\('merge'\)/);
  assert.match(d, /<Show when=\{modus\.toonInvoegpositie\}>\s*<div class="merge-pdfs-row">/);
  assert.match(d, /onMount\(\(\) => \{\s*if \(modus\.beginBestanden\.length\) addPaths\(modus\.beginBestanden\);/);
  assert.match(d, /if \(modus\.combineNew\) \{[\s\S]*?combineerTotNieuwDocument\(entries,/);
  // Op- en neer schuiven blijft in beide modi.
  assert.match(d, /function moveUp\(\)/);
  assert.match(d, /function moveDown\(\)/);
});

test('de twee venstertekst-sleutels staan in elke taal', () => {
  const map = new URL('js/i18n/locales/', APP);
  for (const taal of readdirSync(map)) {
    const json = JSON.parse(lees(`js/i18n/locales/${taal}/dialogs.json`).replace(/^﻿/, ''));
    assert.equal(typeof json.mergePdfs?.combineTitle, 'string', `${taal} combineTitle`);
    assert.equal(typeof json.mergePdfs?.combineButton, 'string', `${taal} combineButton`);
  }
  const nl = JSON.parse(lees('js/i18n/locales/nl/dialogs.json'));
  assert.equal(nl.mergePdfs.combineTitle, 'Combineren tot één PDF');
  const en = JSON.parse(lees('js/i18n/locales/en/dialogs.json'));
  assert.equal(en.mergePdfs.combineTitle, 'Combine into one PDF');
  assert.equal(en.mergePdfs.combineButton, 'Combine');
});
