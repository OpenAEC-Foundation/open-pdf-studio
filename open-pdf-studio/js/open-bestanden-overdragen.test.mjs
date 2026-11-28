// Bestanden die een volgende start doorgeeft terwijl de app nog opstart, gaan
// niet verloren: ze werden weggegooid zodra de app zelf met een bestand
// startte, en wat vóór de luisteraar binnenkwam bereikte niemand. Bron gelezen:
// main.js laadt de hele app.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const instantie = readFileSync(new URL('../src-tauri/src/instantie.rs', import.meta.url), 'utf8');

test('wachtende bestanden openen ook als de app zelf met een bestand startte', () => {
  assert.ok(!/pendingOpenFiles\.length > 0 && !hasCommandLineFile/.test(main));
  assert.ok(main.includes('const wachtend = [...new Set([...pendingOpenFiles, ...await overgedragenBestanden()])];'));
  assert.ok(main.includes('if (wachtend.length > 0) openFiles(wachtend);'));
});

test('de native kant bewaart doorgegeven bestanden tot de frontend ze ophaalt', () => {
  assert.ok(main.includes("invoke('take_handed_over_files')"));
  assert.ok(lib.includes('fn take_handed_over_files('));
  assert.ok(lib.includes('take_handed_over_files,'));
  assert.ok(lib.includes('let state = app.state::<HandedOverFiles>();'));
});

test('een volgende start wacht tot de draaiende app bestanden kan ontvangen', () => {
  assert.ok(instantie.includes('pub fn wacht_op_ontvanger('));
  assert.ok(lib.includes('instantie::wacht_op_hoofdinstantie(&context.config().identifier);'));
  // De namen moeten die van de plugin zijn, anders wacht hij op niets.
  for (const naam of ['-sim', '-sic', '-siw']) assert.ok(instantie.includes(`{identifier}${naam}`));
});
