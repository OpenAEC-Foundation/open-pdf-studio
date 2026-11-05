// Camerafoto's op mobiel (#953): verkleinen, de paginamaat van een scan en
// welke bestanden door het canvas gaan.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  schaalBinnen, scanDpi, moetHercoderen, jpegNaam, SCAN_MAX_PX, SCAN_LANGE_ZIJDE_PT,
} from './foto.js';
import { pageSizePt } from '../pdf/scan-to-pdf.js';

test('verkleinen houdt de verhouding en vergroot nooit', () => {
  assert.deepEqual(schaalBinnen(4000, 3000, 2048), { breedte: 2048, hoogte: 1536 });
  assert.deepEqual(schaalBinnen(3000, 4000, 2048), { breedte: 1536, hoogte: 2048 });
  assert.deepEqual(schaalBinnen(800, 600, 2048), { breedte: 800, hoogte: 600 });
  assert.deepEqual(schaalBinnen(0, 0, 2048), { breedte: 1, hoogte: 1 });
});

test('een gescande foto wordt een pagina met de lange zijde van A4', () => {
  for (const [b, h] of [[3508, 2480], [2480, 3508], [1200, 1600]]) {
    const maat = pageSizePt(b, h, scanDpi(b, h));
    assert.ok(Math.abs(Math.max(maat.width, maat.height) - SCAN_LANGE_ZIJDE_PT) < 1e-6, `${b}x${h}`);
    // De verhouding van de foto blijft.
    assert.ok(Math.abs(maat.width / maat.height - b / h) < 1e-9);
  }
  assert.equal(scanDpi(0, 0), 300);
  assert.equal(SCAN_MAX_PX, 3508);
});

test('foto\'s gaan door het canvas, transparante afbeeldingen niet', () => {
  for (const m of ['image/jpeg', 'image/JPEG', 'image/heic', 'image/heif', '']) assert.equal(moetHercoderen(m), true, m);
  for (const m of ['image/png', 'image/gif', 'image/webp', 'image/svg+xml']) assert.equal(moetHercoderen(m), false, m);
});

test('de naam van een opnieuw gecodeerde foto', () => {
  assert.equal(jpegNaam('IMG_2026.HEIC'), 'IMG_2026.jpg');
  assert.equal(jpegNaam('foto.jpeg'), 'foto.jpg');
  assert.equal(jpegNaam(''), 'photo.jpg');
});
