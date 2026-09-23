// De tabel met functies zonder webvariant, en de ene melding die erbij hoort.

import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = {};

const {
  BUREAUBLAD_KNOPPEN,
  MELDING_SLEUTEL,
  bureaubladFunctie,
  knopUitInBrowser,
  meldingTekst,
  vangAlleenBureaublad,
} = await import('./webfuncties.js');
const { NietInBrowserError } = await import('./platform.js');

test('elke functie uit de melding heeft een knop in de tabel', () => {
  const functies = new Set(Object.values(BUREAUBLAD_KNOPPEN));
  for (const f of ['print', 'ocr', 'cadImport', 'cadExport', 'signatures',
    'compress', 'pdfx', 'ifc', 'attachments', 'plugins', 'updater', 'mcp']) {
    assert.ok(functies.has(f), `geen knop gekoppeld aan "${f}"`);
  }
});

test('een knop uit de tabel staat uit in de browser en aan op het bureaublad', () => {
  assert.equal(knopUitInBrowser('ep-ocr', false), true);
  assert.equal(knopUitInBrowser('ep-ocr', true), false);
  assert.equal(bureaubladFunctie('ep-ocr'), 'ocr');
});

test('een gewone knop blijft overal aan', () => {
  for (const id of ['rotate-left', 'tool-select', undefined, null, '', 'toString']) {
    assert.equal(knopUitInBrowser(id, false), false, `id ${id}`);
    assert.equal(bureaubladFunctie(id), null, `id ${id}`);
  }
});

test('de melding is er één, met de naam die op de knop staat', () => {
  const gezien = [];
  const t = (sleutel, opties) => { gezien.push([sleutel, opties]); return `${sleutel}:${opties.feature}`; };
  assert.equal(meldingTekst(t, 'OCR'), 'desktopOnly:OCR');
  assert.deepEqual(gezien, [[MELDING_SLEUTEL, { feature: 'OCR' }]]);
});

test('vangAlleenBureaublad laat een echte fout door', async () => {
  // Een fout van de Rust-kant of van de schijf hoort NIET als "alleen op het
  // bureaublad" weggemoffeld te worden; de aanroeper moet hem zelf melden.
  // (Alleen deze tak is hier te lopen: de andere opent een venster.)
  assert.equal(await vangAlleenBureaublad(new Error('schijf vol'), 'OCR'), false);
  assert.equal(await vangAlleenBureaublad(null, 'OCR'), false);
  assert.equal(await vangAlleenBureaublad('NIET_IN_BROWSER', 'OCR'), false);
});

test('de fout van invoke() draagt de opdrachtnaam mee', () => {
  const fout = new NietInBrowserError('ocr_page');
  assert.equal(fout.command, 'ocr_page');
  assert.equal(fout.name, 'NietInBrowserError');
});
