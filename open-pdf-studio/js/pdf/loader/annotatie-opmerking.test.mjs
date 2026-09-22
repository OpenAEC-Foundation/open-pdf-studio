// De opmerking bij een vorm (/Contents) overleeft openen en opslaan.
//
// Een rechthoek of ellips uit een ander programma draagt zijn opmerking in
// /Contents (en de gereedschapsnaam in /T). De app bewaart die tekst in
// `subject` en de saver schrijft hem daar weer vandaan naar /Contents.
// pdf.js levert geen /Subject, dus zonder de vertaling hieronder bleef
// `subject` leeg en schreef de saver een lege tekenreeks terug: de opmerking
// was na één keer opslaan weg.
//
// De test bouwt echte PDF-bytes met pdf-lib, laat pdf.js ze lezen zoals de
// loader doet (js/pdf/loader.js -> annotation-converter.js), bepaalt het
// onderwerp met opmerkingUitAnnot(), en schrijft dat terug met de
// tekstcodering van de saver (pdfTextString) zoals de tak voor rechthoek en
// ellips in js/pdf/saver.js doet. De converter zelf is in node niet te laden
// (die hangt via core/state.ts aan de DOM); de laatste test bewaakt daarom
// dat de saver-takken hun /Contents nog steeds uit `subject` schrijven.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

import { opmerkingUitAnnot, zonderDubbeleOpmerking } from './annotatie-opmerking.js';
import { pdfTextString } from '../saver/pdf-text.js';

const RECT = [100, 100, 300, 200];
const OPMERKING = 'Ø88,9 leiding 1979 (8000)';
const GEREEDSCHAP = 'Tekengereedschap';

/** PDF-bytes met één annotatie-woordenboek per opgegeven beschrijving. */
async function pdfMet(dicts) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([612, 792]);
  const ctx = doc.context;
  const refs = dicts.map((d) => ctx.register(ctx.obj({ Type: 'Annot', Rect: RECT, ...d })));
  pagina.node.set(PDFName.of('Annots'), ctx.obj(refs));
  return doc.save();
}

/** De annotaties zoals de loader ze van pdf.js krijgt. */
async function gelezenDoorPdfJs(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const annots = await (await doc.getPage(1)).getAnnotations();
  await doc.destroy();
  return annots;
}

/** Opslaan zoals de saver: /Contents uit `subject`, /T uit `author`. */
async function opgeslagen(annotaties) {
  return pdfMet(annotaties.map((ann) => ({
    Subtype: ann.type === 'circle' ? 'Circle' : 'Square',
    Contents: pdfTextString(ann.subject || ''),
    T: pdfTextString(ann.author || 'User'),
  })));
}

// ── Rondgang: openen, opslaan, terugleggen ──────────────────────────────────

test('rechthoek en ellips houden hun opmerking na opslaan', async () => {
  const bron = await pdfMet([
    { Subtype: 'Square', Contents: PDFString.of(OPMERKING), T: PDFString.of(GEREEDSCHAP) },
    { Subtype: 'Circle', Contents: PDFString.of('60,3 ST bekleding 2001'), T: PDFString.of(GEREEDSCHAP) },
  ]);

  const geladen = (await gelezenDoorPdfJs(bron)).map((annot) => ({
    type: annot.subtype === 'Circle' ? 'circle' : 'box',
    subject: opmerkingUitAnnot(annot),
    author: annot.titleObj?.str || 'User',
  }));
  assert.deepEqual(geladen.map((a) => a.subject), [OPMERKING, '60,3 ST bekleding 2001']);

  const terug = await gelezenDoorPdfJs(await opgeslagen(geladen));
  assert.deepEqual(terug.map((a) => a.contentsObj?.str), [OPMERKING, '60,3 ST bekleding 2001']);
  assert.deepEqual(terug.map((a) => a.titleObj?.str), [GEREEDSCHAP, GEREEDSCHAP]);
});

test('een vorm zonder opmerking krijgt er geen', async () => {
  const bron = await pdfMet([{ Subtype: 'Square', T: PDFString.of(GEREEDSCHAP) }]);
  const [annot] = await gelezenDoorPdfJs(bron);
  assert.equal(opmerkingUitAnnot(annot), '');

  const [terug] = await gelezenDoorPdfJs(await opgeslagen([{ type: 'box', subject: opmerkingUitAnnot(annot) }]));
  assert.equal(terug.contentsObj?.str || '', '');
});

test('een vorm in een groep pikt de tekst van de groepsleider niet op', async () => {
  // /IRT met /RT /Group: pdf.js zet de tekst van de leider op elk lid van de
  // groep. Het lid zelf heeft geen /Contents en hoort die ook niet te krijgen.
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([612, 792]);
  const ctx = doc.context;
  const leider = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Line', Rect: RECT, L: [100, 100, 300, 200],
    Contents: PDFString.of('2.400 mm'), T: PDFString.of(GEREEDSCHAP),
  }));
  const lid = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Square', Rect: RECT,
    IRT: leider, RT: PDFName.of('Group'), T: PDFString.of(GEREEDSCHAP),
  }));
  pagina.node.set(PDFName.of('Annots'), ctx.obj([leider, lid]));

  const gelezen = await gelezenDoorPdfJs(await doc.save());
  const vorm = gelezen.find((a) => a.subtype === 'Square');
  assert.equal(vorm.contentsObj?.str, '2.400 mm', 'pdf.js leent de tekst van de leider');
  assert.equal(opmerkingUitAnnot(vorm), '', 'die tekst hoort niet op het groepslid');
  assert.equal(opmerkingUitAnnot(gelezen.find((a) => a.subtype === 'Line')), '2.400 mm');
});

// ── Soorten met een eigen tekstveld ─────────────────────────────────────────

test('een tekstvak houdt zijn eigen tekst en krijgt geen onderwerp', async () => {
  const bron = await pdfMet([{
    Subtype: 'FreeText', Contents: PDFString.of('Tekst in het vak'),
    DA: PDFString.of('0 0 0 rg /Helv 14 Tf'), T: PDFString.of(GEREEDSCHAP),
  }]);
  const [annot] = await gelezenDoorPdfJs(bron);
  const tekstvak = zonderDubbeleOpmerking({
    type: 'textbox',
    text: annot.contentsObj?.str || '',
    subject: opmerkingUitAnnot(annot),
  });
  assert.equal(tekstvak.text, 'Tekst in het vak', 'de tekst van het vak zelf blijft');
  assert.equal(tekstvak.subject, '', 'dezelfde tekst hoort niet ook in het onderwerp');
});

test('notitie, stempel en meetsoorten laten hun tekst in hun eigen veld', () => {
  const notitie = zonderDubbeleOpmerking({ type: 'comment', text: 'Let op', subject: 'Let op' });
  assert.equal(notitie.subject, '');
  assert.equal(notitie.text, 'Let op');

  const meting = zonderDubbeleOpmerking({ type: 'measureDistance', measureText: '12,50 m', subject: '12,50 m' });
  assert.equal(meting.subject, '');
  assert.equal(meting.measureText, '12,50 m');

  for (const type of ['measureArea', 'measurePerimeter', 'measureAngle', 'stamp', 'vectorSnippet',
    'stavenreeks', 'callout', 'scaleRegion', 'viewport', 'scaleBar', 'scheduleTable']) {
    assert.equal(zonderDubbeleOpmerking({ type, subject: 'x' }).subject, '', type);
  }
});

test('vormen houden hun onderwerp wel', () => {
  for (const type of ['box', 'circle', 'line', 'arrow', 'polygon', 'cloud', 'draw', 'polyline',
    'filledArea', 'wall', 'image', 'textHighlight', 'parametricSymbol']) {
    assert.equal(zonderDubbeleOpmerking({ type, subject: OPMERKING }).subject, OPMERKING, type);
  }
});

// ── Afspraak met de saver ───────────────────────────────────────────────────

test('de saver schrijft /Contents van vormen nog steeds uit `subject`', () => {
  const bron = readFileSync(new URL('../saver.js', import.meta.url), 'utf8');
  for (const soort of ['textHighlight', 'box', 'circle', 'line', 'draw', 'polygon', 'filledArea', 'wall']) {
    const start = bron.indexOf(`case '${soort}':`);
    assert.ok(start > 0, `tak voor ${soort} niet gevonden`);
    const eerste = bron.slice(start).match(/Contents: pdfTextString\(([^\n]*?)\),/);
    assert.equal(eerste?.[1], "ann.subject || ''", soort);
  }
});
