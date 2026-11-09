import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

import { heeftFormuliervelden } from './formuliervelden.js';

const laad = (taal) => JSON.parse(readFileSync(new URL(`../i18n/locales/${taal}/appMenu.json`, import.meta.url), 'utf8'));

test('de gevlakte kopie heeft een titel en uitleg in en en nl', () => {
  for (const taal of ['en', 'nl']) {
    const p = laad(taal).exportPanel;
    assert.ok(p.exportFlat && p.exportFlat.length > 3, taal);
    assert.ok(p.exportFlatDesc && p.exportFlatDesc.length > 20, taal);
  }
});

test('het ExportPanel start de gevlakte kopie vanuit flattened-copy.js', () => {
  const bron = readFileSync(new URL('../solid/components/app-menu/ExportPanel.jsx', import.meta.url), 'utf8');
  assert.ok(bron.includes("pdf/flattened-copy.js"));
  assert.ok(bron.includes('maakGevlakteKopie'));
  const kopie = readFileSync(new URL('./flattened-copy.js', import.meta.url), 'utf8');
  assert.ok(kopie.includes("vel: 'pagina'") && kopie.includes("inhoud: 'doc-and-markups'"));
});

// Formuliervelden komen niet mee in de gevlakte kopie (geen widgets, geen
// /AcroForm): de gebruiker krijgt eerst een waarschuwing.

async function pdfjsLaad(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
}

test('heeftFormuliervelden: een ingevuld tekstveld telt, een pagina zonder velden niet', async () => {
  const metVeld = await PDFDocument.create();
  const pagina = metVeld.addPage([300, 200]);
  const veld = metVeld.getForm().createTextField('naam');
  veld.setText('Filled value');
  veld.addToPage(pagina, { x: 20, y: 100, width: 200, height: 24 });
  const zonder = await PDFDocument.create();
  zonder.addPage([300, 200]).drawText('geen velden', { x: 20, y: 100 });

  const a = await pdfjsLaad(await metVeld.save());
  const b = await pdfjsLaad(await zonder.save());
  try {
    assert.equal(await heeftFormuliervelden(await a.promise), true);
    assert.equal(await heeftFormuliervelden(await b.promise), false);
  } finally {
    await a.destroy();
    await b.destroy();
  }
});

test('heeftFormuliervelden: Map of object van pdf.js, en onbruikbare invoer', async () => {
  const doc = (velden) => ({ getFieldObjects: async () => velden });
  assert.equal(await heeftFormuliervelden(doc(new Map([['naam', [{ type: 'text' }]]]))), true);
  assert.equal(await heeftFormuliervelden(doc({ naam: [{ type: 'checkbox' }] })), true);
  assert.equal(await heeftFormuliervelden(doc({ naam: [] })), false);
  assert.equal(await heeftFormuliervelden(doc(null)), false);
  assert.equal(await heeftFormuliervelden({ getFieldObjects: async () => { throw new Error('x'); } }), false);
  assert.equal(await heeftFormuliervelden({}), false);
  assert.equal(await heeftFormuliervelden(null), false);
});

// Sinds #629 via het gedeelde venster met wat een export niet meeneemt: de
// formuliervelden staan daar als verlies (pdf/export-verlies.js), en de
// samenvatting vraagt heeftFormuliervelden (pdf/export-verlies-inhoud.js).
test('de gevlakte kopie waarschuwt voor formuliervelden voordat er een bestand gekozen wordt', () => {
  const kopie = readFileSync(new URL('./flattened-copy.js', import.meta.url), 'utf8');
  const controle = kopie.indexOf("await bevestigExportVerlies('flattened', doc)");
  const opslaan = kopie.indexOf('await saveFileDialog(');
  assert.ok(controle > 0 && opslaan > controle, 'eerst de controle, dan het opslagvenster');
  const inhoud = readFileSync(new URL('./export-verlies-inhoud.js', import.meta.url), 'utf8');
  assert.ok(inhoud.includes('heeftFormuliervelden(pdfDoc)'));
});
