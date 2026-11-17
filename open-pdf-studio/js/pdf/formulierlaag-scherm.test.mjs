// Formulierlaag op het scherm (#1101). Op het bureaublad tekent PDFium de
// pagina en ligt de HTML-formulierlaag van PDF.js erboven. De bewerkbare velden
// horen alleen in die laag; handtekeningvelden en drukknoppen heeft die laag
// niet, die blijven in de paginabitmap. De miniaturen hebben geen
// formulierlaag: zij vragen de pagina met alle velden.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const calls = [];
globalThis.__TAURI__ = {
  core: {
    invoke: async (cmd, args) => {
      calls.push({ cmd, args });
      const out = new Uint8Array(8 + 4);
      new DataView(out.buffer).setUint32(0, 1, true);
      new DataView(out.buffer).setUint32(4, 1, true);
      return out;
    },
  },
};

const { renderPdfPage } = await import('./engine-router.js');
const { isBewerkbaarVeld, heeftBewerkbareVelden, heeftVeldWidgets } = await import('./formulierlaag-scherm.js');
const { formulierRenderOpties } = await import('./print-formulieren.js');

async function laad(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  return { pdfjs, pdf };
}

// Een widget met een eigen weergave (blauw vlak), zoals een zichtbare
// handtekening van open-pdf-signatures.
function widget(doc, page, velden, rect, extra) {
  const [x0, y0, x1, y1] = rect;
  const ap = doc.context.stream('0 0 1 rg 0 0 ' + (x1 - x0) + ' ' + (y1 - y0) + ' re f', {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, x1 - x0, y1 - y0],
  });
  const ref = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Widget', F: 4, Rect: rect, P: page.ref,
    AP: { N: doc.context.register(ap) }, ...extra,
  }));
  velden.push(ref);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (annots) annots.push(ref);
  else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
  return ref;
}

// Pagina 1: tekstveld + handtekening + drukknop; pagina 2: alleen handtekening
// en drukknop; pagina 3: een selectievakje.
async function formulierPdf() {
  const doc = await PDFDocument.create();
  const velden = [];
  const een = doc.addPage([400, 400]);
  widget(doc, een, velden, [100, 100, 200, 150], { FT: 'Tx', T: PDFString.of('naam'), V: PDFString.of('oud') });
  widget(doc, een, velden, [220, 200, 340, 250], { FT: 'Sig', T: PDFString.of('handtekening') });
  widget(doc, een, velden, [60, 260, 160, 300], { FT: 'Btn', Ff: 65536, T: PDFString.of('knop') });
  const twee = doc.addPage([400, 400]);
  widget(doc, twee, velden, [220, 200, 340, 250], { FT: 'Sig', T: PDFString.of('handtekening2') });
  widget(doc, twee, velden, [60, 260, 160, 300], { FT: 'Btn', Ff: 65536, T: PDFString.of('knop2') });
  const drie = doc.addPage([400, 400]);
  widget(doc, drie, velden, [100, 100, 120, 120], { FT: 'Btn', T: PDFString.of('vinkje'), V: PDFName.of('Off'), AS: PDFName.of('Off') });
  doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({ Fields: velden }));
  return doc.save();
}

test('bewerkbaar zijn de velden die de HTML-laag tekent, niet handtekening en drukknop', async () => {
  const { pdf } = await laad(await formulierPdf());
  const soorten = (await (await pdf.getPage(1)).getAnnotations()).map((a) => [a.fieldType, !!a.pushButton, isBewerkbaarVeld(a)]);
  assert.deepEqual(soorten, [['Tx', false, true], ['Sig', false, false], ['Btn', true, false]]);
  const vinkje = (await (await pdf.getPage(3)).getAnnotations())[0];
  assert.equal(isBewerkbaarVeld(vinkje), true);
  assert.equal(isBewerkbaarVeld({ subtype: 'Square' }), false);
});

test('alleen een pagina met bewerkbare velden heeft er een', async () => {
  const { pdf } = await laad(await formulierPdf());
  assert.equal(await heeftBewerkbareVelden(pdf, 1), true);
  assert.equal(await heeftBewerkbareVelden(pdf, 2), false, 'handtekening en drukknop staan al in de schermbitmap');
  assert.equal(await heeftBewerkbareVelden(pdf, 3), true);
  assert.equal(await heeftBewerkbareVelden(null, 1), false);
  assert.equal(await heeftVeldWidgets(pdf, 2), true, 'wel velden, al zijn ze niet bewerkbaar');
});

test('een pagina zonder velden heeft geen veldwidgets', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const { pdf } = await laad(await doc.save());
  assert.equal(await heeftVeldWidgets(pdf, 1), false);
  assert.equal(await heeftBewerkbareVelden(pdf, 1), false);
});

test('een schermrender vraagt geen formuliervelden, een miniatuur wel', async () => {
  calls.length = 0;
  await renderPdfPage({ path: 'a.pdf', pageIndex: 0, scale: 1, rotation: 0 });
  await renderPdfPage({ path: 'a.pdf', pageIndex: 0, scale: 0.2, rotation: 0, forms: true });
  assert.deepEqual(calls.map((c) => [c.cmd, c.args.forms]), [
    ['render_pdf_page', undefined],
    ['render_pdf_page', true],
  ]);
});

test('de miniaturen van het paginapaneel tekenen de formuliervelden', () => {
  const bron = fs.readFileSync(new URL('../ui/panels/left-panel.js', import.meta.url), 'utf8');
  // De losse render voor de miniatuur vraagt alle velden.
  assert.match(bron, /renderPdfPage\(\s*\{[^}]*forms:\s*true[^}]*\}/);
  // De schermbitmap hergebruiken mag alleen zonder bewerkbare velden: daarin
  // staan ze niet.
  assert.match(bron, /heeftBewerkbareVelden\(/);
});

test('een afdruk tekent elk veld precies één keer, handtekening en drukknop inbegrepen', async () => {
  const { pdfjs, pdf } = await laad(await formulierPdf());
  const page = await pdf.getPage(1);
  const velden = (await page.getAnnotations()).filter((a) => a.subtype === 'Widget');
  const opties = await formulierRenderOpties(page, pdf);
  const lijst = await page.getOperatorList(opties);
  const ids = [];
  lijst.fnArray.forEach((fn, i) => { if (fn === pdfjs.OPS.beginAnnotation) ids.push(lijst.argsArray[i][0]); });
  assert.deepEqual([...ids].sort(), velden.map((v) => v.id).sort());
});
