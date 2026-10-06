// Bij het opstarten op Windows start de app geen hulpprogramma's van het
// systeem (#524). Beveiligingssoftware ziet "documentprogramma start
// powershell.exe of reg.exe" als aanvalspatroon en sluit de app dan af.
// De controle of Open PDF Studio de standaard-PDF-app is (3 s na de start)
// leest het register daarom met de Windows-API in plaats van met reg.exe.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const tauri = path.resolve(hier, '../../src-tauri');
const lees = (p) => fs.readFileSync(path.join(tauri, p), 'utf8').replace(/\r\n/g, '\n');

function functieBlok(bron, naam) {
  const begin = bron.indexOf(`fn ${naam}(`);
  assert.ok(begin >= 0, `${naam} niet gevonden`);
  let diepte = 0;
  for (let i = bron.indexOf('{', begin); i < bron.length; i++) {
    if (bron[i] === '{') diepte++;
    else if (bron[i] === '}' && --diepte === 0) return bron.slice(begin, i + 1);
  }
  throw new Error(`einde van ${naam} niet gevonden`);
}

function windowsTak(blok) {
  const begin = blok.indexOf('#[cfg(target_os = "windows")]');
  assert.ok(begin >= 0, 'geen Windows-tak');
  const eind = blok.indexOf('#[cfg(', begin + 10);
  return blok.slice(begin, eind < 0 ? undefined : eind);
}

test('is_default_pdf_app start op Windows geen proces (geen reg.exe)', () => {
  const tak = windowsTak(functieBlok(lees('src/lib.rs'), 'is_default_pdf_app'));
  assert.doesNotMatch(tak, /no_window_command|Command::new/, 'de Windows-tak start een proces');
  assert.match(tak, /standaard_app::/, 'de Windows-tak gebruikt de registermodule');
});

test('de registermodule leest alleen, met RegGetValueW', () => {
  const bron = lees('src/standaard_app.rs');
  assert.match(bron, /RegGetValueW/);
  assert.doesNotMatch(bron, /RegSetValue|RegCreateKey|RegDeleteKey|RegDeleteValue|Command::new/);
});

test('de beslisregel is gelijk aan die van de oude reg.exe-versie', () => {
  const bron = lees('src/standaard_app.rs');
  // ProgId met de appnaam, of een open-opdracht die de app of het eigen pad noemt.
  assert.match(bron, /fn is_onze_pdf_app\(/);
  assert.match(bron, /openpdfstudio/);
});

test('windows-sys heeft de registerfeature', () => {
  assert.match(lees('Cargo.toml'), /"Win32_System_Registry"/);
});
