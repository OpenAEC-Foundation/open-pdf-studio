// De binnenmarge van een tekstvak. Andere programma's leggen die vast in /DS
// (`margin:3pt`); de app gebruikte altijd de randdikte als marge. Een vak met
// een rand van 1,5 pt en een marge van 3 pt kwam daardoor met zijn tekst
// 1,5 pt naar linksboven terug, en na opslaan stond die verschuiving ook in
// het bestand.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

import { textboxTekstInzet, textboxTekstBreedte } from '../../annotations/rendering/textbox-layout.js';
import { extractAnnotationColors } from './color-extraction.js';

const RECT = [100, 100, 300, 200];

async function extraVan(ds) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([612, 792]);
  const annotDict = doc.context.obj({
    Type: 'Annot', Subtype: 'FreeText', Rect: RECT, Contents: PDFString.of('23 mei 2008'),
    DA: PDFString.of('0 0 0 rg /Helv 12 Tf'), DS: PDFString.of(ds),
    BS: doc.context.obj({ W: 1.5 }),
  });
  pagina.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annotDict)]));
  const heropend = await PDFDocument.load(await doc.save());
  return (await extractAnnotationColors(1, heropend)).get(RECT.join(','));
}

test('een eigen tekstmarge wint van de randdikte', () => {
  const vak = { width: 100, lineWidth: 1.5, textPadding: 3 };
  assert.equal(textboxTekstInzet(vak), 3);
  assert.equal(textboxTekstBreedte(vak), 94);
});

test('zonder eigen tekstmarge blijft de randdikte de marge', () => {
  assert.equal(textboxTekstInzet({ lineWidth: 1.5 }), 1.5);
  assert.equal(textboxTekstInzet({}), 0);
  assert.equal(textboxTekstInzet({ lineWidth: 2, textPadding: 0 }), 0, 'een marge van 0 is een echte waarde');
});

test('de marge uit /DS wordt gelezen', async () => {
  const extra = await extraVan('font: Helvetica 12pt; text-align:left; margin:3pt; line-height:13.8pt; color:#000000');
  assert.equal(extra.dsMargin, 3);
});

test('bij meerdere margewaarden telt de eerste', async () => {
  const extra = await extraVan('font-size:12pt;margin:4.5pt 2pt;');
  assert.equal(extra.dsMargin, 4.5);
});

test('zonder margin in /DS is er geen marge', async () => {
  const extra = await extraVan('font-size:12pt;color:#000000;');
  assert.equal(extra.dsMargin, undefined);
});

test('een /DS die met margin begint wordt ook gelezen (letterlijke PDF-tekst)', async () => {
  const extra = await extraVan('margin:3pt; font-size:12pt');
  assert.equal(extra.dsMargin, 3);
});

test('een onleesbare marge levert geen NaN op', async () => {
  const extra = await extraVan('font-size:12pt; margin:.pt;');
  assert.equal(extra.dsMargin, undefined);
});

test('wie de randdikte wijzigt, krijgt de tekst weer met de rand mee', async () => {
  const { zetRanddikte } = await import('../../annotations/rendering/textbox-layout.js');
  const vak = { width: 100, lineWidth: 1.5, textPadding: 3 };
  zetRanddikte(vak, 4);
  assert.equal(vak.lineWidth, 4);
  assert.equal('textPadding' in vak, false);
  assert.equal(textboxTekstInzet(vak), 4);
});

// Gemeten in de appearances van bestanden met een /DS-marge: de tekst begint op
// randdikte + marge + 1 van de buitenrand (horizontaal en verticaal).
test('de inzet uit /DS is randdikte + marge + 1, zoals in de bestanden gemeten', async () => {
  const { inzetUitDsMarge, dsMargeUitInzet } = await import('../../annotations/rendering/textbox-layout.js');
  assert.equal(inzetUitDsMarge(1.5, 3), 5.5);
  assert.equal(inzetUitDsMarge(1, 1), 3);
  assert.equal(inzetUitDsMarge(0.5, 1), 2.5);
  assert.equal(inzetUitDsMarge(0.5, 0), 1.5);
  // terug naar /DS: dezelfde marge, nooit negatief
  assert.equal(dsMargeUitInzet(5.5, 1.5), 3);
  assert.equal(dsMargeUitInzet(1, 2), 0);
});
