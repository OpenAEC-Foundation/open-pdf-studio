// Vensterstand onthouden tussen sessies (#1126).
//
// De regels zelf (terug in beeld, monitoren) staan in
// src-tauri/src/venstertoestand/regels.rs en hebben daar hun tests
// (rustc --test, zie .github/workflows/window-state-regression.yml). De
// Rust-tests van de app-crate draaien niet overal; daarom hier de afspraken
// waar het onthouden op steunt, als broncontrole.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const hier = path.dirname(fileURLToPath(import.meta.url));
const appMap = path.resolve(hier, '..', '..');
const lees = (rel) => readFileSync(path.join(appMap, rel), 'utf8');
// Alleen de code: commentaar mag de namen noemen die de code niet mag gebruiken.
const zonderCommentaar = (bron) => bron.split('\n').filter((r) => !/^\s*\/\//.test(r)).join('\n');

test('de app sluit haar venster met destroy(): er komt geen sluitverzoek', () => {
  // Hierom mag het bewaren niet van een sluitverzoek afhangen.
  const platform = lees('js/core/platform.js');
  const sluit = platform.match(/export async function closeWindow\(\) \{[\s\S]*?\n\}/);
  assert.ok(sluit, 'closeWindow gevonden');
  assert.match(sluit[0], /currentWindow\.destroy\(\)/);
});

test('Rust: de stand gaat naar schijf zodra die verandert, niet pas bij het sluiten', () => {
  const glue = zonderCommentaar(lees('src-tauri/src/venstertoestand.rs'));
  assert.match(glue, /WindowEvent::Resized\(_\) \| WindowEvent::Moved\(_\)/);
  assert.match(glue, /save_window_state\(vlaggen\(\)\)/);
  // Geminimaliseerd of volledig scherm is geen stand om te onthouden.
  assert.match(glue, /!venster\.is_minimized\(\)\.unwrap_or\(false\) && !venster\.is_fullscreen\(\)\.unwrap_or\(false\)/);
  assert.match(glue, /all\(\|v\| heeft_stand\(/);
  assert.doesNotMatch(glue, /CloseRequested/, 'bewaren mag niet op een sluitverzoek wachten');
  // Maximaliseren of herstellen: direct, zonder de rustpauze.
  assert.match(glue, /gemaximaliseerd\.swap\(nu, Ordering::Relaxed\) != nu/);
  // De rustpauze loopt op een eigen draad, het bewaren op de hoofddraad.
  assert.match(glue, /recv_timeout\(Duration::from_millis\(BEWAAR_WACHTTIJD_MS\)\)/);
  assert.match(glue, /run_on_main_thread\(move \|\| bewaar\(/);
  assert.match(glue, /StateFlags::SIZE \| StateFlags::POSITION \| StateFlags::MAXIMIZED/);
});

test('Rust: met OPDS_DATA_DIR staat het bestand in die map', () => {
  const glue = zonderCommentaar(lees('src-tauri/src/venstertoestand.rs'));
  assert.match(glue, /crate::datamap::override_map\(\)\?/);
  assert.match(glue, /tauri_map_onder\(&basis, identifier, crate::datamap::TauriMap::Data\)/);
  assert.match(glue, /with_filename\(pad\.to_string_lossy\(\)\.into_owned\(\)\)/);
  const regels = lees('src-tauri/src/venstertoestand/regels.rs');
  assert.match(regels, /pub const BESTANDSNAAM: &str = "\.window-state\.json";/);
});

test('Rust: een onbereikbaar venster schuift terug, een gemaximaliseerd venster niet', () => {
  const glue = zonderCommentaar(lees('src-tauri/src/venstertoestand.rs'));
  const terug = glue.slice(glue.indexOf('fn zet_terug_in_beeld'), glue.indexOf('pub fn bewaak_plugin'));
  assert.match(terug, /if venster\.is_maximized\(\)\? \{\s*return Ok\(\(\)\);/);
  assert.match(terug, /terug_in_beeld\(&nu, &werkgebieden\(venster\)\?\)/);
  assert.match(terug, /set_position\(PhysicalPosition::new\(doel\.x, doel\.y\)\)/);
  // Het terugzetten loopt na het herstellen, vóór het venster getoond wordt.
  const haak = glue.slice(glue.indexOf('.on_window_ready('));
  assert.ok(haak.indexOf('zet_terug_in_beeld(&venster)') < haak.indexOf('on_window_event('));
});

test('Rust: alleen de eerste, zichtbare instantie bewaart en herstelt', () => {
  const lib = lees('src-tauri/src/lib.rs');
  const code = zonderCommentaar(lib);
  // Eén plek, achter de toets op tweede instantie en headless; een headless
  // testinstantie staat buiten beeld en mag die plek bewaren noch herstellen.
  const plek = code.indexOf('venstertoestand::herstel_plugin(');
  assert.ok(plek > 0);
  assert.equal(code.indexOf('venstertoestand::herstel_plugin(', plek + 1), -1);
  const ervoor = code.slice(Math.max(0, plek - 400), plek);
  assert.match(ervoor, /if !tweede_instantie && !headless::actief\(\) \{/);
  // Het herstellen eerst: het terugzetten in beeld kijkt naar de herstelde plek.
  const erna = code.slice(plek, plek + 300);
  assert.match(erna, /herstel_plugin\(&identifier\)\)\s*\.plugin\(venstertoestand::bewaak_plugin\(\)\)/);
  // De plugin wordt nergens anders in lib.rs opgebouwd.
  assert.doesNotMatch(code, /tauri_plugin_window_state::/);
  // De identifier voor gegevenspaden, niet de sleutel van een draagbare map.
  assert.match(ervoor, /draagbaar::basis_identifier\(&context\.config\(\)\.identifier\)/);
});
