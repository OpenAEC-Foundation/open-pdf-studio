// Delen / verzenden (#952): welke route, wat er verstuurd wordt, en dat elke
// route aan een echt commando hangt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  deelRoute, deelBron, stapNaKeuze, verzendNaam, routeVraagtBytes, isGeenMailprogramma,
} from './delen-keuze.js';

const bron = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const pdf = {}; // een geladen document heeft een pdfDoc

test('de route volgt het platform', () => {
  assert.equal(deelRoute({ tauri: true, os: 'android', androidBrug: true }), 'android');
  // Een oude Android-build zonder de deelbrug: geen deelvenster.
  assert.equal(deelRoute({ tauri: true, os: 'android', androidBrug: false }), 'tonen');
  assert.equal(deelRoute({ tauri: true, os: 'windows' }), 'mapi');
  assert.equal(deelRoute({ tauri: true, os: 'linux' }), 'xdg-email');
  assert.equal(deelRoute({ tauri: true, os: 'macos' }), 'tonen');
  assert.equal(deelRoute({ tauri: false, webShare: true }), 'web-share');
  assert.equal(deelRoute({ tauri: false, webShare: false }), 'mailto');
});

test('alleen Android en de browser hebben de bytes nodig', () => {
  assert.equal(routeVraagtBytes('android'), true);
  assert.equal(routeVraagtBytes('web-share'), true);
  for (const r of ['mapi', 'xdg-email', 'tonen', 'mailto']) assert.equal(routeVraagtBytes(r), false, r);
});

test('een ongewijzigd bestand gaat zoals het is (handtekeningen blijven geldig)', () => {
  assert.deepEqual(deelBron({ pdfDoc: pdf, filePath: 'C:\\a\\b.pdf' }), { soort: 'bestand', pad: 'C:\\a\\b.pdf' });
  // Na tekstbewerkingen staat het echte bestand in saveTargetPath.
  assert.deepEqual(
    deelBron({ pdfDoc: pdf, filePath: 'C:\\tmp\\werk.pdf', saveTargetPath: 'C:\\a\\b.pdf' }),
    { soort: 'bestand', pad: 'C:\\a\\b.pdf' });
});

test('niet-opgeslagen wijzigingen: eerst vragen', () => {
  assert.deepEqual(deelBron({ pdfDoc: pdf, filePath: 'C:\\a\\b.pdf', modified: true }), { soort: 'vraag' });
  assert.deepEqual(deelBron({ pdfDoc: pdf, isUntitled: true, filePath: 'C:\\tmp\\x.pdf', modified: true }), { soort: 'vraag' });
});

test('een naamloos document zonder wijzigingen gaat zonder vraag als kopie', () => {
  assert.deepEqual(deelBron({ pdfDoc: pdf, isUntitled: true, filePath: 'C:\\tmp\\opds-untitled-1.pdf' }), { soort: 'kopie' });
  assert.deepEqual(deelBron({ pdfDoc: pdf }), { soort: 'kopie' });
});

test('zonder document niets', () => {
  assert.deepEqual(deelBron(null), { soort: 'geen' });
  assert.deepEqual(deelBron({ filePath: 'x.pdf' }), { soort: 'geen' });
});

test('de knop uit de vraag wordt een stap', () => {
  assert.equal(stapNaKeuze('opslaan'), 'opslaan');
  assert.equal(stapNaKeuze('kopie'), 'kopie');
  assert.equal(stapNaKeuze(null), null);
  assert.equal(stapNaKeuze(undefined), null);
  assert.equal(stapNaKeuze('iets anders'), null);
});

test('de naam van de bijlage', () => {
  assert.equal(verzendNaam({ filePath: 'C:\\map\\Offerte 12.pdf' }), 'Offerte 12.pdf');
  assert.equal(verzendNaam({ filePath: '/home/u/plan.PDF' }), 'plan.pdf');
  assert.equal(verzendNaam({ isUntitled: true, filePath: 'C:\\tmp\\opds-untitled-1.pdf', fileName: 'Scan 2026-11-05 10.00.pdf' }),
    'Scan 2026-11-05 10.00.pdf');
  // Een content://-URI van Android: de tabbladnaam.
  assert.equal(verzendNaam({ filePath: 'content://com.android.providers/document/1234', fileName: 'Contratto.pdf' }), 'Contratto.pdf');
  assert.equal(verzendNaam({}), 'document.pdf');
});

test('de foutcode van email.rs zet de terugval aan, een andere fout niet', () => {
  assert.equal(isGeenMailprogramma('OPDS_NO_MAIL_CLIENT: no default email program (MAPI code 2)'), true);
  assert.equal(isGeenMailprogramma(new Error('OPDS_NO_MAIL_CLIENT: xdg-email is not available')), true);
  assert.equal(isGeenMailprogramma('File not found: C:\\x.pdf'), false);
  assert.equal(isGeenMailprogramma(null), false);
});

test('elke route hangt aan een bestaand commando', () => {
  const delen = bron('./delen.js');
  const email = bron('../../src-tauri/src/email.rs');
  const lib = bron('../../src-tauri/src/lib.rs');
  const kotlin = bron('../../src-tauri/android/MainActivity.kt');
  assert.match(delen, /invoke\('email_pdf', \{ path: pad, subject: naam \}\)/);
  assert.match(delen, /invoke\('verzendkopie_schrijven'/);
  assert.match(delen, /OpdsAndroid\.share\(pad, 'application\/pdf'/);
  assert.match(delen, /bouwMomentopname\(doc\)/);
  assert.match(lib, /email::email_pdf,/);
  assert.match(lib, /email::verzendkopie_schrijven,/);
  assert.match(email, /fn MAPISendMailW\(/);
  assert.match(email, /pub const GEEN_MAILPROGRAMMA: &str = "OPDS_NO_MAIL_CLIENT";/);
  assert.match(kotlin, /@JavascriptInterface\s+fun share\(path: String\?, mime: String\?, title: String\?\): String/);
  assert.match(kotlin, /Intent\.ACTION_SEND/);
  assert.match(kotlin, /FLAG_GRANT_READ_URI_PERMISSION/);
});

test('de knop E-mail van het lint en Delen op mobiel gaan door hetzelfde pad', () => {
  assert.match(bron('./email-pdf.js'), /deelHuidigDocument\(\)/);
  assert.match(bron('../solid/components/ribbon/HomeTab.jsx'), /emailCurrentPdf\(\)/);
  assert.match(bron('../solid/MobileApp.jsx'), /deelHuidigDocument\(\)/);
});
