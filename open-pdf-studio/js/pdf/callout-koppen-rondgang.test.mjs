// Opslaan en heropenen van de koppen van een callout (#612) met de echte saver
// en lader. End staat op de punt, Start waar de aanhaallijn het tekstvak
// verlaat. /LE is bij een FreeText één naam (de punt); beide koppen gaan ook
// in /OPS_LineHeads, de kopgrootte in /OPS_HeadSize.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { zetPaginaAnnotatiesOm } = await import('./loader/annotaties-omzetten.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');

async function leegBlad() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc.save();
}

async function laad(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pagina = await doc.getPage(1);
  const viewport = pagina.getViewport({ scale: 1 });
  const kaart = await extractAnnotationColors(1, await PDFDocument.load(bytes.slice()));
  const modellen = await zetPaginaAnnotatiesOm(await pagina.getAnnotations(), 1, viewport, new Map(), kaart);
  await doc.loadingTask.destroy();
  return modellen.filter(Boolean);
}

async function opslaan(bronBytes, modellen) {
  let uit = null;
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => bronBytes,
      writeBinaryFile: (_pad, bytes) => { uit = bytes; return true; },
      writeBinaryFileAtomic: (_pad, bytes) => { uit = bytes; return true; },
    },
  };
  state.documents = [{
    id: 'rondgang', filePath: 'C:/rondgang/bron.pdf', pdfDoc: {}, annotations: modellen,
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [],
  }];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF('C:/rondgang/uit.pdf', { zonderHandtekeningVraag: true }), true, 'opslaan gelukt');
  return uit;
}

async function freeTexts(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  return doc.getPage(0).node.Annots().asArray().map((ref) => ctx.lookup(ref))
    .filter((d) => d.get(PDFName.of('Subtype'))?.toString() === '/FreeText')
    .map((d) => {
      const n = ctx.lookup(ctx.lookup(d.get(PDFName.of('AP'))).get(PDFName.of('N')));
      const sleutel = d.get(PDFName.of('OPS_LineHeads'));
      return {
        le: d.get(PDFName.of('LE'))?.toString(),
        sleutel: sleutel ? ctx.lookup(sleutel).decodeText() : null,
        kopgrootte: ctx.lookup(d.get(PDFName.of('OPS_HeadSize')))?.asNumber(),
        rect: ctx.lookup(d.get(PDFName.of('Rect'))).asArray().map((x) => x.asNumber()),
        ap: new TextDecoder().decode(n.getContents()),
      };
    });
}

const callout = (extra = {}) => ({
  id: 'co', type: 'callout', page: 1, x: 300, y: 380, width: 170, height: 70, rotation: 0,
  text: 'tip', fontSize: 12, fontFamily: 'Arial', color: '#000000', strokeColor: '#000000',
  fillColor: '#FFFFD0', textColor: '#000000', lineWidth: 1, borderStyle: 'solid', opacity: 1,
  arrowX: 120, arrowY: 560, kneeX: 270, kneeY: 415, armOriginX: 300, armOriginY: 415,
  ...extra,
});

test('beide koppen en de kopgrootte gaan het bestand in en komen terug', async () => {
  const bron = await leegBlad();
  const uit = await opslaan(bron, [callout({ startHead: 'circle', endHead: 'stealth', headSize: 26 })]);
  const [ft] = await freeTexts(uit);
  assert.equal(ft.le, '/OpenArrow', '/LE: de dichtstbijzijnde naam voor de punt');
  assert.equal(ft.sleutel, 'circle,stealth');
  assert.equal(ft.kopgrootte, 26);
  const terug = await laad(uit);
  assert.equal(terug.length, 1, 'precies één annotatie, geen dubbele');
  assert.equal(terug[0].type, 'callout');
  assert.equal(terug[0].startHead, 'circle');
  assert.equal(terug[0].endHead, 'stealth');
  assert.equal(terug[0].headSize, 26);

  // Nog een keer opslaan en openen: niets verschuift of verdubbelt.
  const nogEens = await laad(await opslaan(bron, terug));
  assert.equal(nogEens.length, 1);
  assert.deepEqual([nogEens[0].startHead, nogEens[0].endHead, nogEens[0].headSize], ['circle', 'stealth', 26]);
});

test('de appearance tekent de koppen op kopgrootte en de /Rect omvat ze', async () => {
  const bron = await leegBlad();
  const [ft] = await freeTexts(await opslaan(bron, [callout({ startHead: 'square', endHead: 'closed', headSize: 26 })]));
  // Punt (120, 560) in app-ruimte = (120, 842 - 560) in PDF.
  const [x1, y1] = ft.rect;
  assert.ok(x1 <= 120 - 26, `de /Rect omvat de kop van 26 bij de punt (x1 ${x1})`);
  assert.ok(y1 <= 282 - 26 * Math.tan(Math.PI / 6), `y1 ${y1}`);
  // Dichte punt: gevulde driehoek (B), vierkant aan het tekstvak: gevuld vlak.
  const leider = ft.ap.split('Q\n')[0];
  const gevuld = leider.match(/\nB\n/g) || [];
  assert.equal(gevuld.length, 2, `twee gevulde koppen in de appearance:\n${leider}`);
  assert.match(ft.ap, /^q\n/, 'de aanhaallijn staat in q/Q');
});

test('zonder koppen: /LE /None en geen kop in de appearance', async () => {
  const bron = await leegBlad();
  const uit = await opslaan(bron, [callout({ startHead: 'none', endHead: 'none' })]);
  const [ft] = await freeTexts(uit);
  assert.equal(ft.le, '/None');
  assert.doesNotMatch(ft.ap.split('Q\n')[0], /\nB\n/);
  const [terug] = await laad(uit);
  assert.equal(terug.endHead, 'none');
  assert.equal(terug.startHead, 'none');
});

test('een nieuwe callout zonder eigen koppen blijft de dichte punt van 7', async () => {
  const bron = await leegBlad();
  const uit = await opslaan(bron, [callout()]);
  const [ft] = await freeTexts(uit);
  assert.equal(ft.le, '/ClosedArrow');
  const [terug] = await laad(uit);
  assert.deepEqual([terug.startHead, terug.endHead, terug.headSize], ['none', 'closed', 7]);
});

/** Een FreeText-callout zoals een ander programma (of de app vóór #612) hem schreef. */
async function vreemdeCallout(sleutels) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, 842]);
  const ctx = doc.context;
  const annot = ctx.obj({
    Type: 'Annot', Subtype: 'FreeText', Rect: [100, 300, 400, 500], Contents: PDFString.of('x'),
    DA: PDFString.of('0 0 0 rg /Helv 12 Tf'), F: 4, IT: PDFName.of('FreeTextCallout'),
    CL: [110, 310, 200, 400, 250, 400], RD: [140, 60, 10, 10],
    ...sleutels(ctx),
  });
  pagina.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(annot)]));
  return doc.save();
}

test('een ander programma: /LE als losse naam of als rij', async () => {
  const [naam] = await laad(await vreemdeCallout(() => ({ LE: PDFName.of('Diamond') })));
  assert.equal(naam.type, 'callout');
  assert.deepEqual([naam.startHead, naam.endHead], ['none', 'diamond']);
  const [rij] = await laad(await vreemdeCallout((ctx) => ({ LE: ctx.obj([PDFName.of('Circle')]) })));
  assert.deepEqual([rij.startHead, rij.endHead], ['none', 'circle']);
  const [zonder] = await laad(await vreemdeCallout(() => ({})));
  assert.deepEqual([zonder.startHead, zonder.endHead], ['none', 'none']);
});

test('een callout die de app vóór #612 opsloeg, houdt de dichte punt die het scherm toonde', async () => {
  const [oud] = await laad(await vreemdeCallout(() => ({ LE: PDFName.of('OpenArrow'), OPS_Rotation: 0 })));
  assert.deepEqual([oud.startHead, oud.endHead], ['none', 'closed']);
});

test('twee callouts op dezelfde plek behouden elk hun eigen vertakking bij opslaan en heropenen', async () => {
  const { newLinkedLeader } = await import('../annotations/linked-leaders.js');
  const callouts = ['eerste', 'tweede'].map(id => {
    const ann = callout({ id, text: id });
    ann.leaders = [newLinkedLeader(ann, id + '-tak', 'callout_knee')];
    return ann;
  });
  const terug = await laad(await opslaan(await leegBlad(), callouts));
  assert.equal(terug.length, 2);
  for (const ann of terug) {
    const origineel = callouts.find(a => a.text === ann.text);
    assert.equal(ann.type, 'callout');
    assert.deepEqual(ann.leaders, origineel.leaders);
  }
});
