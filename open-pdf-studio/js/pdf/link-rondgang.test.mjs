// Hyperlinks van de app (#953) door de echte saver en lader: een link naar
// een webadres en een link naar een pagina (uit een tekstselectie, met quads)
// opslaan, in pdf.js en MuPDF bekijken, en weer als bewerkbare link laden. Een
// link van een ander programma blijft staan en wordt geen annotatie.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import * as mupdf from 'mupdf';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const { cloneAnnotation } = await import('../annotations/factory.js');

const N = (n) => PDFName.of(n);
const nu = '2026-11-06T12:00:00.000Z';

/** Twee pagina's van 400 x 500; op pagina 1 eventueel een link van een ander programma. */
async function blad({ vreemdeLink = false } = {}) {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([400, 500]);
  doc.addPage([400, 500]);
  if (vreemdeLink) {
    const link = doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 60, 30], Border: [0, 0, 0],
      A: doc.context.obj({ S: 'URI', URI: PDFString.of('https://example.org/vreemd') }),
    });
    p1.node.set(N('Annots'), doc.context.obj([doc.context.register(link)]));
  }
  return doc.save();
}

/** De modellen zoals js/pdf/loader.js ze aanmaakt, plus de pdf.js-annotaties. */
async function laad(bytes, pagina = 1) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const page = await doc.getPage(pagina);
  const viewport = page.getViewport({ scale: 1 });
  const kaart = await extractAnnotationColors(pagina, await PDFDocument.load(bytes.slice()));
  const pdfjsAnnots = await page.getAnnotations();
  const modellen = [];
  for (const annot of pdfjsAnnots) {
    const m = await convertPdfAnnotation(annot, pagina, viewport, new Map(), kaart);
    if (m) modellen.push(m);
  }
  // Het paginadoel als paginanummer, zoals link-layer.js het oplost.
  for (const a of pdfjsAnnots) {
    if (Array.isArray(a.dest) && a.dest[0] && typeof a.dest[0] === 'object') {
      // Een pagina die niet meer in de boom staat, heeft geen nummer.
      a.destPage = await doc.getPageIndex(a.dest[0]).then((i) => i + 1, () => null);
    }
  }
  await doc.loadingTask.destroy();
  return { modellen, pdfjsAnnots };
}

async function opslaan(bronBytes, modellen) {
  return opslaanMet(bronBytes, modellen, [1, 2]);
}

async function opslaanMet(bronBytes, modellen, gereed) {
  let uit = null;
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => bronBytes,
      writeBinaryFile: (_pad, bytes) => { uit = bytes; return true; },
      writeBinaryFileAtomic: (_pad, bytes) => { uit = bytes; return true; },
    },
  };
  state.documents = [{
    id: 'links', filePath: 'C:/links/bron.pdf', pdfDoc: {}, annotations: modellen,
    pageRotations: {}, _annotationPagesReady: new Set(gereed), textEdits: [],
  }];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF('C:/links/uit.pdf', { zonderHandtekeningVraag: true }), true, 'opslaan gelukt');
  return uit;
}

const basis = (extra) => ({
  page: 1, opacity: 1, author: 'Tester', subject: '', createdAt: nu, modifiedAt: nu,
  locked: false, printable: true, readOnly: false, marked: false, ...extra,
});

const webLink = () => basis({
  id: 'web1', type: 'link', x: 50, y: 40, width: 120, height: 20,
  linkTarget: { kind: 'uri', uri: 'https://openaec.org/pdf?a=1&b=(2)' },
  linkBorder: 'solid', color: '#ff0000', strokeColor: '#ff0000', lineWidth: 2, linkHighlight: 'I',
});

// Twee regels geselecteerde tekst: het klikvak is hun omhullende.
const tekstLink = () => basis({
  id: 'pag1', type: 'link', x: 30, y: 100, width: 200, height: 34,
  rects: [{ x: 30, y: 100, width: 200, height: 14 }, { x: 30, y: 120, width: 90, height: 14 }],
  linkTarget: { kind: 'page', page: 2, fit: 'xyz', left: null, top: null, zoom: null },
  linkBorder: 'underline', color: '#0000ff', strokeColor: '#0000ff', lineWidth: 1, linkHighlight: 'I',
});

const linkDicts = (pdf, i = 0) => {
  const annots = pdf.getPage(i).node.Annots();
  return (annots ? annots.asArray() : []).map((r) => pdf.context.lookup(r))
    .filter((d) => d.lookup(N('Subtype'))?.toString() === '/Link');
};

test('a web link and a page link are saved as standard /Link annotations', async () => {
  const bytes = await opslaan(await blad(), [webLink(), tekstLink()]);
  const pdf = await PDFDocument.load(bytes);
  const [web, pag] = linkDicts(pdf);
  assert.ok(web && pag, 'two links');

  // App y = 40 vanaf de bovenkant van 500 hoog: PDF y van 440 tot 460.
  assert.deepEqual(web.lookup(N('Rect')).asArray().map((n) => n.asNumber()), [50, 440, 170, 460]);
  assert.equal(web.lookup(N('A')).lookup(N('S')).toString(), '/URI');
  assert.equal(web.lookup(N('BS')).lookup(N('S')).toString(), '/S');
  assert.equal(web.lookup(N('H')).toString(), '/I');
  assert.ok(web.lookup(N('AP')), 'an appearance');
  assert.equal(web.lookup(N('QuadPoints')), undefined, 'a drawn rectangle has no quads');

  const dest = pag.lookup(N('Dest')).asArray();
  assert.equal(dest[0].toString(), pdf.getPage(1).ref.toString(), 'points at page 2');
  assert.equal(dest[1].toString(), '/XYZ');
  assert.equal(dest[3].asNumber(), 500, 'top of the target page');
  assert.equal(pag.lookup(N('BS')).lookup(N('S')).toString(), '/U');
  // Twee regels: 16 getallen, linksboven-rechtsboven-linksonder-rechtsonder.
  const q = pag.lookup(N('QuadPoints')).asArray().map((n) => n.asNumber());
  assert.deepEqual(q, [30, 400, 230, 400, 30, 386, 230, 386, 30, 380, 120, 380, 30, 366, 120, 366]);
  assert.deepEqual(pag.lookup(N('Rect')).asArray().map((n) => n.asNumber()), [30, 366, 230, 400]);
});

test('other viewers see the target: pdf.js url/dest and MuPDF', async () => {
  const bytes = await opslaan(await blad(), [webLink(), tekstLink()]);
  const { pdfjsAnnots } = await laad(bytes);
  const links = pdfjsAnnots.filter((a) => a.subtype === 'Link');
  assert.equal(links.length, 2);
  assert.equal(links[0].url, 'https://openaec.org/pdf?a=1&b=(2)');
  assert.equal(links[1].destPage, 2);
  assert.equal(links[1].dest[1].name, 'XYZ');
  assert.equal(links[1].quadPoints.length, 16, 'pdf.js keeps both lines');

  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const mupdfLinks = doc.loadPage(0).getLinks();
  assert.equal(mupdfLinks.length, 2);
  assert.equal(mupdfLinks[0].getURI(), 'https://openaec.org/pdf?a=1&b=(2)');
  assert.equal(doc.resolveLink(mupdfLinks[1]), 1, 'MuPDF jumps to page 2 (0-based 1)');
});

test('reopened, the links are editable annotations with their target and lines', async () => {
  const bytes = await opslaan(await blad(), [webLink(), tekstLink()]);
  const { modellen } = await laad(bytes);
  assert.equal(modellen.length, 2);
  const [web, pag] = modellen;
  assert.equal(web.type, 'link');
  assert.deepEqual(web.linkTarget, { kind: 'uri', uri: 'https://openaec.org/pdf?a=1&b=(2)' });
  assert.equal(web.linkBorder, 'solid');
  assert.equal(web.lineWidth, 2);
  assert.equal(web.color.toLowerCase(), '#ff0000');
  assert.deepEqual([web.x, web.y, web.width, web.height], [50, 40, 120, 20]);

  assert.equal(pag.type, 'link');
  assert.equal(pag.linkTarget.kind, 'page');
  assert.equal(pag.linkTarget.page, 2);
  assert.equal(pag.linkTarget.fit, 'xyz');
  assert.equal(pag.linkTarget.top, 500);
  assert.equal(pag.linkBorder, 'underline');
  assert.equal(pag.rects.length, 2, 'the text lines come back');
  assert.deepEqual(pag.rects.map((r) => [r.x, r.y, r.width, r.height]), [[30, 100, 200, 14], [30, 120, 90, 14]]);
  assert.ok(pag.pdfLinkId, 'the pdf.js id, so the link layer leaves it to the app');
  // Het model blijft JSON (ongedaan maken kloont het).
  assert.deepEqual(cloneAnnotation(pag).linkTarget, pag.linkTarget);
});

test('saving again without changes keeps one link each; an edited target is written', async () => {
  const eerste = await opslaan(await blad(), [webLink(), tekstLink()]);
  const { modellen } = await laad(eerste);
  modellen[0].linkTarget = { kind: 'page', page: 1, fit: 'fit' };
  modellen[0].linkBorder = 'none';
  const tweede = await opslaan(eerste, modellen);
  const pdf = await PDFDocument.load(tweede);
  const links = linkDicts(pdf);
  assert.equal(links.length, 2, 'no duplicates');
  const dest = links[0].lookup(N('Dest')).asArray();
  assert.equal(dest[1].toString(), '/Fit');
  assert.equal(links[0].lookup(N('A')), undefined, 'the old URI action is gone');
  assert.deepEqual(links[0].lookup(N('Border')).asArray().map((n) => n.asNumber()), [0, 0, 0]);
  assert.equal(links[0].lookup(N('BS')), undefined);

  const { modellen: terug } = await laad(tweede);
  assert.deepEqual(terug[0].linkTarget, { kind: 'page', page: 1, fit: 'fit' });
  assert.equal(terug[0].linkBorder, 'none');
});

test('a file link is a Launch action', async () => {
  const ann = basis({
    id: 'bestand', type: 'link', x: 10, y: 10, width: 40, height: 20,
    linkTarget: { kind: 'file', file: 'C:\\Projecten\\Tekening (B).pdf' },
    linkBorder: 'none', color: '#0000ff', lineWidth: 1,
  });
  const bytes = await opslaan(await blad(), [ann]);
  const pdf = await PDFDocument.load(bytes);
  const [d] = linkDicts(pdf);
  const a = d.lookup(N('A'));
  assert.equal(a.lookup(N('S')).toString(), '/Launch');
  assert.equal(a.lookup(N('F')).lookup(N('UF')).decodeText(), 'C:\\Projecten\\Tekening (B).pdf');
  const { modellen } = await laad(bytes);
  assert.deepEqual(modellen[0].linkTarget, { kind: 'file', file: 'C:\\Projecten\\Tekening (B).pdf' });
});

test('a link from another program stays as it was and is not loaded as an annotation', async () => {
  const bron = await blad({ vreemdeLink: true });
  const { modellen, pdfjsAnnots } = await laad(bron);
  assert.equal(modellen.length, 0, 'read-only, followed by the link layer');
  assert.equal(pdfjsAnnots[0].url, 'https://example.org/vreemd');

  const bytes = await opslaan(bron, [webLink()]);
  const pdf = await PDFDocument.load(bytes);
  const links = linkDicts(pdf);
  assert.equal(links.length, 2);
  const vreemd = links.find((d) => !d.get(N('OPS_Subtype')));
  assert.ok(vreemd, 'the foreign link is kept');
  assert.equal(vreemd.lookup(N('A')).lookup(N('URI')).decodeText(), 'https://example.org/vreemd');
});

test('a deleted link of the app is removed from the file', async () => {
  const eerste = await opslaan(await blad(), [webLink(), tekstLink()]);
  const { modellen } = await laad(eerste);
  const tweede = await opslaan(eerste, modellen.filter((m) => m.linkTarget.kind !== 'uri'));
  const links = linkDicts(await PDFDocument.load(tweede));
  assert.equal(links.length, 1);
  assert.ok(links[0].get(N('Dest')));
});

test('on a rotated page the link comes back where it was drawn', async () => {
  const doc = await PDFDocument.create();
  const { degrees } = await import('pdf-lib');
  doc.addPage([400, 500]).setRotation(degrees(90));
  doc.addPage([400, 500]);
  const bron = await doc.save();
  const ann = { ...tekstLink(), id: 'gedraaid' };
  const bytes = await opslaan(bron, [ann]);
  const { modellen, pdfjsAnnots } = await laad(bytes);
  assert.equal(pdfjsAnnots[0].destPage, 2);
  const [terug] = modellen;
  const r = (v) => Math.round(v * 100) / 100;
  assert.deepEqual([terug.x, terug.y, terug.width, terug.height].map(r), [30, 100, 200, 34]);
  assert.deepEqual(terug.rects.map((q) => [q.x, q.y, q.width, q.height].map(r)), [[30, 100, 200, 14], [30, 120, 90, 14]]);
});

test('a broken page target is saved without /Dest and reopens broken', async () => {
  const ann = { ...tekstLink(), id: 'gebroken', linkTarget: { kind: 'page', page: null, broken: true, fit: 'xyz' } };
  const bytes = await opslaan(await blad(), [ann]);
  const pdf = await PDFDocument.load(bytes);
  const [d] = linkDicts(pdf);
  assert.equal(d.get(N('Dest')), undefined, 'no target, not silently page 1');
  assert.equal(d.get(N('A')), undefined);
  assert.equal(d.lookup(N('OPS_BrokenDest')).asBoolean(), true);
  const { modellen, pdfjsAnnots } = await laad(bytes);
  assert.equal(pdfjsAnnots[0].dest, undefined, 'other viewers do not jump anywhere');
  assert.equal(modellen[0].linkTarget.kind, 'page');
  assert.equal(modellen[0].linkTarget.broken, true);
  assert.equal(modellen[0].linkTarget.page, null);
});

test('/Dest holds the page itself: pages moved by another program keep the link on its page', async () => {
  const bytes = await opslaan(await blad(), [tekstLink()]);
  // Een ander programma zet pagina 2 vooraan.
  const pdf = await PDFDocument.load(bytes);
  const [p1, p2] = pdf.getPages();
  const dest = linkDicts(pdf)[0].lookup(N('Dest')).asArray();
  assert.equal(dest[0].toString(), p2.ref.toString(), 'an indirect reference, not a number');
  pdf.removePage(1);
  pdf.insertPage(0, p2);
  assert.equal(pdf.getPages()[1], p1);
  const verplaatst = await pdf.save();
  // De link staat nu op pagina 2 en wijst naar pagina 1.
  const { modellen, pdfjsAnnots } = await laad(new Uint8Array(verplaatst), 2);
  assert.equal(pdfjsAnnots[0].destPage, 1);
  assert.equal(modellen[0].linkTarget.page, 1);
});

test('a link of the app whose target page was removed elsewhere reopens broken', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 500]); doc.addPage([400, 500]); doc.addPage([400, 500]);
  const bron = await doc.save();
  const ann = { ...tekstLink(), id: 'naar3', linkTarget: { kind: 'page', page: 3, fit: 'fit' } };
  const bytes = await opslaanMet(bron, [ann], [1, 2, 3]);
  const pdf = await PDFDocument.load(bytes);
  pdf.removePage(2);
  const zonder = new Uint8Array(await pdf.save());
  const { modellen } = await laad(zonder);
  assert.equal(modellen[0].linkTarget.broken, true, 'not silently another page');
});
