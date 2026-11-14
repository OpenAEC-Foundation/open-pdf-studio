// Formuliervelden in de afdruk: een ingevuld formulier mag op papier niet leeg
// zijn. Getoetst met de echte PDF.js: de lijst met tekenopdrachten van de
// afdruk moet het veld bevatten (met de ingevulde waarde) en geen andere
// annotatie uit het bestand, want die tekent de app zelf.
import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { formulierRenderOpties, heeftFormulierVelden } from './print-formulieren.js';

async function laad(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  return { pdfjs, pdf };
}

// Eén pagina met een tekstveld "naam" en een rechthoek-annotatie uit het bestand.
// `metLaag`: ook een laag (optionele inhoud) "Raster" die aan staat.
async function formulierPdf({ metVeld = true, metLaag = false } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  page.drawText('Formulier', { x: 20, y: 170, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
  if (metLaag) {
    const laag = doc.context.register(doc.context.obj({ Type: 'OCG', Name: PDFString.of('Raster') }));
    doc.catalog.set(PDFName.of('OCProperties'), doc.context.obj({
      OCGs: [laag], D: { ON: [laag], Order: [laag] },
    }));
  }
  if (metVeld) {
    const veld = doc.getForm().createTextField('naam');
    veld.addToPage(page, { x: 20, y: 100, width: 200, height: 24 });
  }
  const vierkant = doc.context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [20, 20, 120, 60], F: 4,
    C: [1, 0, 0], Contents: PDFString.of('markering'),
  });
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (annots) annots.push(doc.context.register(vierkant));
  else page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(vierkant)]));
  return doc.save();
}

// Ids van de annotaties in de tekenopdrachten, plus de getekende tekst.
async function afdruk(pdfjs, page, opties) {
  const lijst = await page.getOperatorList(opties);
  const ids = [];
  let tekst = '';
  lijst.fnArray.forEach((fn, i) => {
    if (fn === pdfjs.OPS.beginAnnotation) ids.push(lijst.argsArray[i][0]);
    if (fn === pdfjs.OPS.showText) {
      for (const g of lijst.argsArray[i][0]) if (g && typeof g === 'object' && g.unicode) tekst += g.unicode;
    }
  });
  return { ids, tekst };
}

test('een pagina met formuliervelden drukt het veld af met de ingevulde waarde', async () => {
  const { pdfjs, pdf } = await laad(await formulierPdf());
  const page = await pdf.getPage(1);
  const annotaties = await page.getAnnotations();
  const veld = annotaties.find((a) => a.subtype === 'Widget');
  const vierkant = annotaties.find((a) => a.subtype === 'Square');
  pdf.annotationStorage.setValue(veld.id, { value: 'Jansen' });

  const opties = await formulierRenderOpties(page, pdf);
  assert.equal(opties.intent, 'print');
  assert.equal(opties.annotationMode, pdfjs.AnnotationMode.ENABLE_STORAGE);
  const { ids, tekst } = await afdruk(pdfjs, page, opties);
  assert.deepEqual(ids, [veld.id], 'alleen het veld, niet de rechthoek uit het bestand');
  assert.ok(!ids.includes(vierkant.id));
  assert.match(tekst, /Jansen/);
});

test('de oude manier (geen annotaties) laat het formulier leeg', async () => {
  const { pdfjs, pdf } = await laad(await formulierPdf());
  const page = await pdf.getPage(1);
  const veld = (await page.getAnnotations()).find((a) => a.subtype === 'Widget');
  pdf.annotationStorage.setValue(veld.id, { value: 'Jansen' });
  const { ids, tekst } = await afdruk(pdfjs, page, { annotationMode: pdfjs.AnnotationMode.DISABLE });
  assert.deepEqual(ids, []);
  assert.doesNotMatch(tekst, /Jansen/);
});

test('een pagina zonder velden blijft zoals hij was: geen annotaties van het bestand', async () => {
  const { pdfjs, pdf } = await laad(await formulierPdf({ metVeld: false }));
  const page = await pdf.getPage(1);
  const opties = await formulierRenderOpties(page, pdf);
  assert.deepEqual(opties, { annotationMode: pdfjs.AnnotationMode.DISABLE });
  assert.equal(await heeftFormulierVelden(pdf, [1]), false);
});

test('het opslaan van de waarden in het document blijft onaangeroerd', async () => {
  const { pdf } = await laad(await formulierPdf());
  const page = await pdf.getPage(1);
  const veld = (await page.getAnnotations()).find((a) => a.subtype === 'Widget');
  pdf.annotationStorage.setValue(veld.id, { value: 'Jansen' });
  const voor = JSON.stringify([...pdf.annotationStorage.serializable.map]);
  await formulierRenderOpties(page, pdf);
  assert.equal(JSON.stringify([...pdf.annotationStorage.serializable.map]), voor);
  assert.equal(pdf.annotationStorage.getValue(veld.id, {}).value, 'Jansen');
});

test('heeftFormulierVelden kijkt alleen naar de gekozen pagina\'s', async () => {
  const doc = await PDFDocument.load(await formulierPdf());
  doc.addPage([300, 200]);
  const { pdf } = await laad(await doc.save());
  assert.equal(await heeftFormulierVelden(pdf, [2]), false);
  assert.equal(await heeftFormulierVelden(pdf, [2, 1]), true);
});

// Een echte render, zoals de afdruk hem doet: PDF.js weigert een lagenconfiguratie
// met een andere `intent` dan de render ("Must use the same `intent`-argument").
async function render(pdfjs, page, opties) {
  const { createCanvas } = await import('@napi-rs/canvas');
  const viewport = page.getViewport({ scale: 1 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport, ...opties }).promise;
}

test('de afdruk van een pagina met velden rendert echt, ook met lagen in het bestand', async () => {
  const { pdfjs, pdf } = await laad(await formulierPdf({ metLaag: true }));
  const page = await pdf.getPage(1);
  await render(pdfjs, page, await formulierRenderOpties(page, pdf));
});

test('de lagenkeuze van het scherm geldt ook op papier', async () => {
  const { pdfjs, pdf } = await laad(await formulierPdf({ metLaag: true }));
  const page = await pdf.getPage(1);
  const scherm = await pdf.getOptionalContentConfig({ intent: 'display' });
  const [laagId] = [...scherm].map(([id]) => id);
  scherm.setVisibility(laagId, false);

  const opties = await formulierRenderOpties(page, pdf, scherm);
  const afdruk = await opties.optionalContentConfigPromise;
  assert.equal(afdruk.getGroup(laagId).visible, false, 'uitgezette laag blijft uit');
  await render(pdfjs, page, opties);

  const standaard = await (await formulierRenderOpties(page, pdf)).optionalContentConfigPromise;
  assert.equal(standaard.getGroup(laagId).visible, true, 'zonder eigen keuze: de beginstand van het bestand');
});
