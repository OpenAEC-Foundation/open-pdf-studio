// Pagina's uitnemen (#880): de uitgenomen pagina's moeten hun inhoud houden.
// Gemelde klacht: de pagina's van het nieuwe bestand waren leeg en het bestand
// was veel groter dan dezelfde pagina's afgedrukt naar PDF. Elke proef bouwt
// een bron met de hand (zoals scanners en andere programma's ze schrijven),
// neemt pagina's uit met bouwUittreksel en rendert het resultaat met MuPDF:
// een pagina met een (donkere) scan moet donker blijven.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import * as mupdf from 'mupdf';
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { laadBron, bouwUittreksel, bronVoorUittreksel } = await import('./splits-document.js');

// ── Een PDF uit losse objecten (met een kloppende xref) ──
function bouwPdf(objecten) {
  let uit = '%PDF-1.7\n';
  const plek = [];
  for (const [n, inhoud] of objecten) {
    plek[n] = uit.length;
    uit += `${n} 0 obj\n${inhoud}\nendobj\n`;
  }
  const max = Math.max(...objecten.map(([n]) => n));
  const xref = uit.length;
  uit += `xref\n0 ${max + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= max; i++) {
    uit += plek[i] != null ? `${String(plek[i]).padStart(10, '0')} 00000 n \n` : '0000000000 65535 f \n';
  }
  uit += `trailer\n<< /Size ${max + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(uit, 'latin1'));
}
const stroom = (dict, data) => `<< ${dict} /Length ${data.length} >>\nstream\n${data}\nendstream`;
// Een "scan": een grijs beeld van 4x4 pixels, bijna zwart.
const scan = (b = 4, h = 4) => stroom(
  `/Type /XObject /Subtype /Image /Width ${b} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8`,
  '\x10'.repeat(b * h),
);

// Alleen een paginagrote afbeelding, de afbeelding zonder q/Q (zoals veel scanners).
const alleenScan = () => bouwPdf([
  [1, '<< /Type /Catalog /Pages 2 0 R >>'],
  [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
  [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>'],
  [4, stroom('', '200 0 0 300 0 0 cm /Im0 Do')],
  [5, scan()],
]);

// Bronnen, paginamaat en draaiing geërfd van de paginaboom (twee niveaus),
// en twee pagina's die dezelfde inhoudsstroom en hetzelfde beeld delen.
const geerfd = () => bouwPdf([
  [1, '<< /Type /Catalog /Pages 2 0 R >>'],
  [2, '<< /Type /Pages /Kids [6 0 R] /Count 2 /Resources << /XObject << /Im0 5 0 R >> >> /MediaBox [0 0 200 300] /Rotate 90 >>'],
  [6, '<< /Type /Pages /Parent 2 0 R /Kids [3 0 R 7 0 R] /Count 2 >>'],
  [3, '<< /Type /Page /Parent 6 0 R /Contents 4 0 R >>'],
  [7, '<< /Type /Page /Parent 6 0 R /Contents 4 0 R >>'],
  [4, stroom('', '200 0 0 300 0 0 cm /Im0 Do')],
  [5, scan()],
]);

// De scan in een Form XObject, en de inhoud als reeks van twee stromen.
const viaFormulier = () => bouwPdf([
  [1, '<< /Type /Catalog /Pages 2 0 R >>'],
  [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
  [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << /XObject << /Fm0 8 0 R >> >> /Contents [4 0 R 9 0 R] >>'],
  [4, stroom('', 'q')],
  [9, stroom('', '/Fm0 Do Q')],
  [8, stroom('/Type /XObject /Subtype /Form /BBox [0 0 200 300] /Resources << /XObject << /Im0 5 0 R >> >>', '200 0 0 300 0 0 cm /Im0 Do')],
  [5, scan()],
]);

// Drie pagina's: pagina 1 heeft een koppeling naar pagina 3, een koppeling
// (GoTo-actie) naar pagina 2 en een notitie met /P; pagina's 2 en 3 dragen een
// groot beeld dat bij het uitnemen van pagina 1 niet mee mag komen.
const GROOT = 40000;
const metKoppelingen = () => bouwPdf([
  [1, '<< /Type /Catalog /Pages 2 0 R >>'],
  [2, '<< /Type /Pages /Kids [3 0 R 10 0 R 11 0 R] /Count 3 >>'],
  [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R /Annots [20 0 R 21 0 R 22 0 R] >>'],
  [4, stroom('', 'q 200 0 0 300 0 0 cm /Im0 Do Q')],
  [5, scan()],
  [10, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << /XObject << /Im1 12 0 R >> >> /Contents 13 0 R >>'],
  [11, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << /XObject << /Im1 12 0 R >> >> /Contents 13 0 R >>'],
  [12, stroom('/Type /XObject /Subtype /Image /Width 200 /Height 200 /ColorSpace /DeviceGray /BitsPerComponent 8', 'A'.repeat(GROOT))],
  [13, stroom('', 'q 200 0 0 300 0 0 cm /Im1 Do Q')],
  [20, '<< /Type /Annot /Subtype /Link /Rect [0 0 50 50] /Dest [11 0 R /Fit] /P 3 0 R >>'],
  [21, '<< /Type /Annot /Subtype /Link /Rect [0 60 50 110] /A << /S /GoTo /D [10 0 R /Fit] >> /P 3 0 R >>'],
  [22, '<< /Type /Annot /Subtype /Square /Rect [60 60 90 90] /P 3 0 R /C [1 0 0] >>'],
]);

/** Aandeel donkere pixels van pagina `i` (MuPDF), en de getoonde maat. */
function inkt(bytes, i = 0) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const pagina = doc.loadPage(i);
  const pix = pagina.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceGray, false, true);
  const pixels = pix.getPixels();
  let donker = 0;
  for (const v of pixels) if (v < 128) donker++;
  const [x0, y0, x1, y1] = pagina.getBounds();
  return { paginas: doc.countPages(), donker: donker / pixels.length, breed: x1 - x0, hoog: y1 - y0 };
}

async function neemUit(bytes, nummers, opties) {
  const uit = await bouwUittreksel(await laadBron(bytes), nummers, opties);
  return new Uint8Array(await uit.save());
}

test('een gescande pagina (alleen een beeld) blijft gevuld', async () => {
  const r = inkt(await neemUit(alleenScan(), [1]));
  assert.equal(r.paginas, 1);
  assert.ok(r.donker > 0.95, `de scan staat op de pagina (donker ${r.donker})`);
});

test('bronnen, maat en draaiing geërfd van de paginaboom gaan mee; gedeelde inhoud ook', async () => {
  const bron = geerfd();
  assert.ok(inkt(bron, 1).donker > 0.95, 'de bron zelf toont de scan');
  for (const nummers of [[2], [1, 2]]) {
    const bytes = await neemUit(bron, nummers);
    for (let i = 0; i < nummers.length; i++) {
      const r = inkt(bytes, i);
      assert.ok(r.donker > 0.95, `pagina ${i + 1} van ${nummers} houdt de scan (donker ${r.donker})`);
      assert.deepEqual([r.breed, r.hoog], [300, 200], 'de geërfde /Rotate 90 en MediaBox staan op de pagina');
    }
  }
});

test('inhoud in een Form XObject en als reeks stromen blijft zichtbaar', async () => {
  const r = inkt(await neemUit(viaFormulier(), [1]));
  assert.ok(r.donker > 0.95, `donker ${r.donker}`);
});

test('koppelingen slepen geen andere pagina\'s mee: het bestand blijft klein', async () => {
  const bytes = await neemUit(metKoppelingen(), [1]);
  assert.ok(inkt(bytes).donker > 0.95);
  assert.ok(bytes.length < GROOT / 4, `alleen pagina 1 en haar eigen beeld (${bytes.length} bytes)`);
  const doc = await PDFDocument.load(bytes);
  let paginaObjecten = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of('Type')) === PDFName.of('Page')) paginaObjecten++;
  }
  assert.equal(paginaObjecten, 1, 'geen verborgen kopie van een andere pagina');
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).asArray().map((r) => doc.context.lookup(r, PDFDict));
  assert.deepEqual(annots.map((a) => a.get(PDFName.of('Subtype')).decodeText()), ['Square'],
    'koppelingen naar pagina\'s die niet meekomen vallen weg; de notitie blijft');
  assert.equal(annots[0].get(PDFName.of('P')), doc.getPage(0).ref, '/P wijst naar de eigen, nieuwe pagina');
});

test('een koppeling naar een pagina die meekomt wijst naar die pagina, ook in een andere volgorde', async () => {
  const bytes = await neemUit(metKoppelingen(), [3, 1]);
  const doc = await PDFDocument.load(bytes);
  const [eerste, tweede] = doc.getPages();
  const annots = tweede.node.lookup(PDFName.of('Annots'), PDFArray).asArray().map((r) => doc.context.lookup(r, PDFDict));
  const link = annots.find((a) => a.get(PDFName.of('Subtype')).decodeText() === 'Link');
  assert.ok(link, 'de koppeling naar (oude) pagina 3 blijft');
  assert.equal(link.lookup(PDFName.of('Dest'), PDFArray).get(0), eerste.ref, 'en wijst naar de eerste pagina van het uittreksel');
  assert.equal(annots.length, 2, 'de koppeling naar pagina 2 viel weg');
});

test('de draaiing van de app komt bovenop de eigen /Rotate', async () => {
  const bytes = await neemUit(alleenScan(), [1], { rotaties: { 1: 90 } });
  const r = inkt(bytes);
  assert.deepEqual([r.breed, r.hoog], [300, 200]);
  assert.ok(r.donker > 0.95);
});

test('nog versleutelde bytes: geweigerd in plaats van een bestand met lege pagina\'s', async () => {
  const versleuteld = mupdf.Document.openDocument(alleenScan(), 'application/pdf').asPDF()
    .saveToBuffer('encrypt=aes-256,user-password=,owner-password=geheim').asUint8Array();
  assert.ok(inkt(versleuteld).donker > 0.95, 'de bron zelf is leesbaar');

  // Zo deed extractPages het eerst: copyPages over de versleutelde bytes.
  const oud = await PDFDocument.load(versleuteld, { ignoreEncryption: true });
  const kopie = await PDFDocument.create();
  for (const p of await kopie.copyPages(oud, [0])) kopie.addPage(p);
  const vroeger = inkt(new Uint8Array(await kopie.save()));
  assert.ok(vroeger.donker < 0.05, 'de oude weg gaf een lege pagina');

  await assert.rejects(laadBron(versleuteld), (e) => e.code === 'encrypted');
});

test('ongeldige paginanummers worden geweigerd', async () => {
  const bron = await laadBron(alleenScan());
  await assert.rejects(bouwUittreksel(bron, [2]), RangeError);
  await assert.rejects(bouwUittreksel(bron, []), RangeError);
  await assert.rejects(bouwUittreksel(bron, [0]), RangeError);
});

// Niet-opgeslagen wijzigingen (OCR-tekstlaag, nieuwe annotaties) staan nog niet
// in de opgeslagen bytes: uitnemen gebruikt dan de stand die opslaan zou
// schrijven. Zonder wijzigingen, of als die stand niet te bouwen is (een
// beveiligd document), de opgeslagen bytes.
test('bron: met wijzigingen de momentopname (met de draaiingen al erin), anders de opgeslagen bytes', async () => {
  const opgeslagen = new Uint8Array([1]);
  const moment = new Uint8Array([2]);
  let gebouwd = 0;
  const maakMomentopname = async () => { gebouwd++; return moment; };

  assert.deepEqual(await bronVoorUittreksel({ opgeslagen, gewijzigd: true, maakMomentopname }), { bytes: moment, uitApp: true });
  assert.deepEqual(await bronVoorUittreksel({ opgeslagen, gewijzigd: false, maakMomentopname }), { bytes: opgeslagen, uitApp: false });
  assert.equal(gebouwd, 1, 'zonder wijzigingen geen momentopname');

  const weigert = async () => { throw new Error('password-protected documents are not snapshotted'); };
  const oudeWaarschuwing = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(await bronVoorUittreksel({ opgeslagen, gewijzigd: true, maakMomentopname: weigert }), { bytes: opgeslagen, uitApp: false });
  } finally {
    console.warn = oudeWaarschuwing;
  }
});

test('bedrading: extractPages gebruikt de bron, laadBron en bouwUittreksel, en meldt versleutelde bytes', async () => {
  const { readFileSync } = await import('node:fs');
  const bron = readFileSync(new URL('./page-manager.js', import.meta.url), 'utf8');
  const extract = bron.slice(bron.indexOf('export async function extractPages'), bron.indexOf('export async function reorderPages'));
  assert.match(extract, /bronVoorUittreksel\(/);
  assert.match(extract, /bouwMomentopname\(doc\)/);
  assert.match(extract, /bouwUittreksel\(await laadBron\(bronBytes\)/);
  assert.match(extract, /extractEncrypted/);
  assert.doesNotMatch(extract, /copyPages\(/, 'geen kale copyPages meer');
});
