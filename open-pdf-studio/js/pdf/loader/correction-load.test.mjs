// Laden van proefleescorrecties (#508) met nagemaakte pdf.js-annotaties.
//
// pdf.js levert subtype, rect, color, contentsObj, it, inReplyTo ('16R') en
// replyType ('Group'), maar geen /NM, /Subj, /Sy, /RD of eigen sleutels: die
// komen uit extractAnnotationColors (hier: `extra`).

import assert from 'node:assert/strict';
import test from 'node:test';

import { PDFDocument, PDFName } from 'pdf-lib';

import { caretPropsFromPdf, textEditPropsFromPdf, resolveGroupLinks } from './correction-load.js';
import { makePointMapper, buildCaretDict } from '../saver/correction-dicts.js';

const HOOGTE = 792;
// /Rotate 0: gebruikersruimte -> getoonde pagina.
const convertPoint = (x, y) => [x, HOOGTE - y];
const convertRect = (r) => ({
  x: Math.min(r[0], r[2]), y: HOOGTE - Math.max(r[1], r[3]),
  width: Math.abs(r[2] - r[0]), height: Math.abs(r[3] - r[1]),
});
// /Rotate 90 op een pagina van 612 x 792: getoond = (uy, ux).
const convertPoint90 = (x, y) => [y, x];
// /Rotate 270 op een pagina van 612 x 792: getoond = (792 - uy, 612 - ux).
const convertPoint270 = (x, y) => [792 - y, 612 - x];

test('het vak van een invoegteken is /Rect min /RD (links, boven, rechts, onder)', () => {
  const annot = { subtype: 'Caret', rect: [100, 200, 120, 230], contentsObj: { str: 'the' }, color: new Uint8ClampedArray([0, 102, 255]) };
  const props = caretPropsFromPdf(annot, { rd: [1, 2, 3, 4] }, convertRect, 0);
  assert.deepEqual({ x: props.x, y: props.y, width: props.width, height: props.height },
    convertRect([101, 204, 117, 228]));
  assert.equal(props.type, 'caret');
  assert.equal(props.text, 'the');
  assert.equal(props.symbol, 'None');
  assert.equal(props.textDir, undefined, 'zonder eigen sleutel: geen richting (tekent en schrijft als 0)');
  assert.equal(props.color.toUpperCase(), '#0066FF');
  assert.equal(props.intent, undefined);
});

test('een /RD die het vak opheft wordt genegeerd', () => {
  const annot = { subtype: 'Caret', rect: [100, 200, 104, 204], contentsObj: { str: '' } };
  const props = caretPropsFromPdf(annot, { rd: [3, 3, 3, 3] }, convertRect, 0);
  assert.equal(props.width, 4);
  assert.equal(props.height, 4);
});

test('/Sy /P blijft behouden, al het andere wordt None', () => {
  const annot = { subtype: 'Caret', rect: [0, 0, 5, 5] };
  assert.equal(caretPropsFromPdf(annot, { sy: 'P' }, convertRect, 0).symbol, 'P');
  assert.equal(caretPropsFromPdf(annot, { sy: 'None' }, convertRect, 0).symbol, 'None');
  assert.equal(caretPropsFromPdf(annot, { sy: 'Vreemd' }, convertRect, 0).symbol, 'None');
});

test('invoegteken: intent, /NM, /Subj en de eigen /Contents gaan mee', () => {
  // Als kind in een groep geeft pdf.js de /Contents van de ouder; de eigen
  // tekst komt dan uit extra.ownContents.
  const annot = { subtype: 'Caret', rect: [0, 0, 5, 5], it: 'Replace', contentsObj: { str: 'van de ouder' } };
  const props = caretPropsFromPdf(annot, { nm: 'nm-1', subj: 'Inserted Text', ownContents: 'eigen' }, convertRect, 0);
  assert.equal(props.intent, 'Replace');
  assert.equal(props.nm, 'nm-1');
  assert.equal(props.pdfSubject, 'Inserted Text');
  assert.equal(props.text, 'eigen');
  assert.equal(props.color.toUpperCase(), '#9900CC', 'standaardkleur van een vervanging');
});

test('textDir komt uit /OPS_TextDir plus de paginarotatie', () => {
  const annot = { subtype: 'Caret', rect: [0, 0, 5, 5] };
  assert.equal(caretPropsFromPdf(annot, { opsTextDir: 270 }, convertRect, 90).textDir, 0);
  assert.equal(caretPropsFromPdf(annot, { opsTextDir: 0 }, convertRect, 180).textDir, 180);
  const markering = { subtype: 'StrikeOut', rect: [0, 0, 5, 5] };
  assert.equal(textEditPropsFromPdf(markering, { opsTextDir: 90 }, convertPoint, 270).textDir, 0);
  assert.equal(textEditPropsFromPdf(markering, { opsTextDir: 0 }, convertPoint, 90).textDir, 90);
});

test('zonder eigen sleutel: een correctie krijgt textDir uit de rauwe quad (p1 -> p2)', () => {
  const markering = { subtype: 'StrikeOut', rect: [0, 0, 1, 1], it: 'StrikeOutTextEdit' };
  // Gewone horizontale tekst in referentie-volgorde.
  const horizontaal = [72, 701.6, 90, 701.6, 72, 689.6, 90, 689.6];
  assert.equal(textEditPropsFromPdf(markering, { rawQuadPoints: horizontaal }, convertPoint, 0).textDir, 0);
  // Verticale tekst (leesrichting omlaag) op /Rotate 0: p1 -> p2 wijst omlaag.
  const omlaag = [702, 700, 702, 682, 690, 700, 690, 682];
  assert.equal(textEditPropsFromPdf(markering, { rawQuadPoints: omlaag }, convertPoint, 0).textDir, 90);
  // Een kort woord in verticale tekst: p1 -> p2 is korter dan de regelhoogte,
  // maar blijft de leesrichting.
  const kortOmlaag = [702, 700, 702, 695, 690, 700, 690, 695];
  assert.equal(textEditPropsFromPdf(markering, { rawQuadPoints: kortOmlaag }, convertPoint, 0).textDir, 90);
  // Dezelfde horizontale tekst op /Rotate 90 in referentie-volgorde.
  const gedraaid = [90.4, 72, 90.4, 90, 102.4, 72, 102.4, 90];
  assert.equal(textEditPropsFromPdf(markering, { rawQuadPoints: gedraaid }, convertPoint90, 90).textDir, 0);
  // Het kind van een groep zonder /IT telt ook als correctie.
  const kind = { subtype: 'StrikeOut', rect: [0, 0, 1, 1], inReplyTo: '16R', replyType: 'Group' };
  assert.equal(textEditPropsFromPdf(kind, { rawQuadPoints: omlaag }, convertPoint, 0).textDir, 90);
  // Scheef (meer dan 1 graad van een kwartslag): geen richting.
  const scheef = [0, 0, 100, 10, 0, -12, 100, -2];
  assert.equal(textEditPropsFromPdf(markering, { rawQuadPoints: scheef }, convertPoint, 0).textDir, undefined);
  // Geen quads: geen richting.
  assert.equal(textEditPropsFromPdf(markering, {}, convertPoint, 0).textDir, undefined);
});

test('een gewone markering zonder /IT of groep krijgt geen richting uit de quad', () => {
  // Eerdere app-versies schreven op een gedraaide pagina altijd (minX,maxY),
  // (maxX,maxY), (minX,minY), (maxX,minY). Bij een kort woord ('a', 5 x 12
  // getoond) is p1 -> p2 dan de regelhoogte: niet te onderscheiden van tekst.
  const gewoon = { subtype: 'StrikeOut', rect: [0, 0, 1, 1] };
  const lang90 = [90.4, 90, 102.4, 90, 90.4, 72, 102.4, 72];
  assert.equal(textEditPropsFromPdf(gewoon, { rawQuadPoints: lang90 }, convertPoint90, 90).textDir, undefined);
  const kort90 = [90.4, 90, 102.4, 90, 90.4, 85, 102.4, 85];
  assert.equal(textEditPropsFromPdf(gewoon, { rawQuadPoints: kort90 }, convertPoint90, 90).textDir, undefined);
  const woord90 = [90, 90, 102, 90, 90, 85, 102, 85];
  assert.equal(textEditPropsFromPdf(gewoon, { rawQuadPoints: woord90 }, convertPoint90, 90).textDir, undefined);
  const kort270 = [500, 305, 512, 305, 500, 300, 512, 300];
  assert.equal(textEditPropsFromPdf(gewoon, { rawQuadPoints: kort270 }, convertPoint270, 270).textDir, undefined);
  // Ook op /Rotate 0 tekent een gewone markering zoals voorheen.
  const horizontaal = [72, 701.6, 90, 701.6, 72, 689.6, 90, 689.6];
  assert.equal(textEditPropsFromPdf(gewoon, { rawQuadPoints: horizontaal }, convertPoint, 0).textDir, undefined);
  // Een gewoon antwoord (/RT /R) maakt er geen correctie van.
  const antwoord = { ...gewoon, inReplyTo: '9R', replyType: 'R' };
  assert.equal(textEditPropsFromPdf(antwoord, { rawQuadPoints: kort90 }, convertPoint90, 90).textDir, undefined);
  // Met een /IT komt de markering niet uit een eerdere app-versie: de quad telt.
  const notitie = { subtype: 'Highlight', rect: [0, 0, 1, 1], it: 'HighlightNote' };
  assert.equal(textEditPropsFromPdf(notitie, { rawQuadPoints: horizontaal }, convertPoint, 0).textDir, 0);
});

test('de intent komt alleen van pdf.js, niet uit de extra gegevens onder dezelfde /Rect', () => {
  // pdf.js geeft /IT van elke annotatie door; een intent in `extra` kan van
  // een buur met dezelfde /Rect zijn.
  const markering = { subtype: 'Highlight', rect: [0, 0, 1, 1] };
  const props = textEditPropsFromPdf(markering, { intent: 'StrikeOutTextEdit' }, convertPoint, 0);
  assert.equal(props.intent, undefined);
  const karet = caretPropsFromPdf({ subtype: 'Caret', rect: [0, 0, 5, 5] }, { intent: 'Replace' }, convertRect, 0);
  assert.equal(karet.intent, undefined);
});

test('markeringen krijgen intent, /NM, /Subj en gemarkeerde tekst alleen als het bestand ze heeft', () => {
  const kaal = textEditPropsFromPdf({ subtype: 'Highlight', rect: [0, 0, 1, 1] }, {}, convertPoint, 0);
  assert.deepEqual(kaal, {});
  const vol = textEditPropsFromPdf({ subtype: 'StrikeOut', rect: [0, 0, 1, 1], it: 'StrikeOutTextEdit' },
    { nm: 'x', subj: 'Cross-Out', opsMarkedText: 'teh', opsTextDir: 0 }, convertPoint, 0);
  assert.deepEqual(vol, { intent: 'StrikeOutTextEdit', nm: 'x', pdfSubject: 'Cross-Out', markedText: 'teh', textDir: 0 });
});

test('de lijndikte komt alleen uit de eigen sleutel /OPS_LineWidth (#527)', () => {
  const lijn = { subtype: 'Underline', rect: [0, 0, 1, 1] };
  assert.deepEqual(textEditPropsFromPdf(lijn, { opsLineWidth: 3 }, convertPoint, 0), { lineWidth: 3 });
  // Zonder de sleutel, of met een onbruikbare waarde: geen lineWidth.
  assert.deepEqual(textEditPropsFromPdf(lijn, {}, convertPoint, 0), {});
  assert.deepEqual(textEditPropsFromPdf(lijn, { opsLineWidth: 0 }, convertPoint, 0), {});
  assert.deepEqual(textEditPropsFromPdf(lijn, { opsLineWidth: -1 }, convertPoint, 0), {});
  // Een /BS uit een ander programma (borderWidth) telt niet.
  assert.deepEqual(textEditPropsFromPdf(lijn, { borderWidth: 2 }, convertPoint, 0), {});
});

function paar() {
  const karet = { id: 'k', type: 'caret', page: 1, intent: 'Replace' };
  const door = { id: 'd', type: 'textStrikethrough', page: 1, intent: 'StrikeOutTextEdit' };
  return { karet, door };
}

test('resolveGroupLinks: invoegteken als ouder in het bestand', () => {
  const { karet, door } = paar();
  const byPdfId = new Map([['16R', karet], ['15R', door]]);
  const n = resolveGroupLinks([{ converted: door, inReplyTo: '16R', replyType: 'Group' }], byPdfId);
  assert.equal(n, 1);
  assert.equal(door.inReplyTo, 'k');
  assert.equal(door.replyType, 'group');
  assert.equal(door.groupId, 'k');
  assert.equal(karet.groupId, 'k');
  assert.equal(karet.inReplyTo, undefined);
});

test('resolveGroupLinks: omgekeerd paar wordt invoegteken-ouder in het model', () => {
  const { karet, door } = paar();
  delete karet.intent; // ander programma: geen /IT op het invoegteken-kind
  const byPdfId = new Map([['20R', door], ['21R', karet]]);
  resolveGroupLinks([{ converted: karet, inReplyTo: '20R', replyType: 'Group' }], byPdfId);
  assert.equal(door.inReplyTo, 'k', 'de doorhaling wijst naar het invoegteken');
  assert.equal(door.replyType, 'group');
  assert.equal(karet.inReplyTo, undefined);
  assert.equal(karet.replyType, undefined);
  assert.equal(karet.groupId, 'k');
  assert.equal(door.groupId, 'k');
  assert.equal(karet.intent, 'Replace', 'een gekoppeld paar is een vervanging');
});

test('resolveGroupLinks houdt een bestaand groupId van het invoegteken', () => {
  const { karet, door } = paar();
  karet.groupId = 'g1';
  resolveGroupLinks([{ converted: door, inReplyTo: '1R', replyType: 'Group' }], new Map([['1R', karet]]));
  assert.equal(door.groupId, 'g1');
  assert.equal(karet.groupId, 'g1');
});

test('resolveGroupLinks negeert vierkant+notitie-groepen, andere paginas en gewone antwoorden', () => {
  const vierkant = { id: 'v', type: 'box', page: 1 };
  const notitie = { id: 'n', type: 'comment', page: 1 };
  const { karet, door } = paar();
  door.page = 2;
  const antwoord = { id: 'a', type: 'textStrikethrough', page: 1 };
  const byPdfId = new Map([['1R', vierkant], ['2R', notitie], ['3R', karet], ['4R', door], ['5R', antwoord]]);
  const n = resolveGroupLinks([
    { converted: notitie, inReplyTo: '1R', replyType: 'Group' },
    { converted: door, inReplyTo: '3R', replyType: 'Group' },
    { converted: antwoord, inReplyTo: '3R', replyType: 'R' },
    { converted: antwoord, inReplyTo: '99R', replyType: 'Group' },
  ], byPdfId);
  assert.equal(n, 0);
  for (const a of [vierkant, notitie, karet, door, antwoord]) {
    assert.equal(a.inReplyTo, undefined, a.id);
    assert.equal(a.groupId, undefined, a.id);
  }
});

test('een invoegteken zonder /OPS_TextDir neemt de richting van zijn doorhaling over', async () => {
  // Vervanging uit een ander programma op verticale tekst (leesrichting omlaag
  // op /Rotate 0): de doorhaling heeft de richting uit haar quad, het
  // invoegteken heeft geen eigen sleutel.
  const omlaag = [702, 700, 702, 682, 690, 700, 690, 682];
  const karetAnnot = { subtype: 'Caret', rect: [698, 676, 704, 682], it: 'Replace', contentsObj: { str: 'the' } };
  const doorAnnot = { subtype: 'StrikeOut', rect: [690, 682, 702, 700], it: 'StrikeOutTextEdit', inReplyTo: '16R', replyType: 'Group' };
  const karet = { id: 'k', page: 1, ...caretPropsFromPdf(karetAnnot, {}, convertRect, 0) };
  const door = { id: 'd', page: 1, type: 'textStrikethrough',
    ...textEditPropsFromPdf(doorAnnot, { rawQuadPoints: omlaag }, convertPoint, 0) };
  assert.equal(karet.textDir, undefined);
  assert.equal(door.textDir, 90);
  resolveGroupLinks([{ converted: door, inReplyTo: '16R', replyType: 'Group' }], new Map([['16R', karet]]));
  assert.equal(karet.textDir, 90, 'het invoegteken volgt de tekst van zijn doorhaling');

  // Opslaan schrijft die richting en de top van het teken wijst naar +x (de
  // bovenkant van tekst die omlaag leest).
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const map = makePointMapper(0, { x: 0, y: 0, width: 612, height: 792 });
  const dict = buildCaretDict(ctx, karet, map, { rgb: [0.6, 0, 0.8], opacity: 1, pageRot: 0 });
  assert.equal(dict.lookup(PDFName.of('OPS_TextDir')).asNumber(), 90);
  const ap = ctx.lookup(ctx.lookup(dict.get(PDFName.of('AP'))).get(PDFName.of('N')));
  const inhoud = Buffer.from(ap.getContents()).toString('latin1');
  const punten = [...inhoud.matchAll(/(-?[\d.]+) (-?[\d.]+) [ml]\b/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
  assert.equal(punten.length, 4, inhoud);
  const top = punten[0];
  assert.ok(punten.slice(1).every((p) => top.x > p.x), `top het verst naar +x: ${inhoud}`);

  // Een eigen /OPS_TextDir blijft staan; zonder richting bij de doorhaling ook niets.
  const eigen = { id: 'k2', page: 1, ...caretPropsFromPdf(karetAnnot, { opsTextDir: 0 }, convertRect, 0) };
  const door2 = { id: 'd2', page: 1, type: 'textStrikethrough', textDir: 90 };
  resolveGroupLinks([{ converted: door2, inReplyTo: '1R', replyType: 'Group' }], new Map([['1R', eigen]]));
  assert.equal(eigen.textDir, 0);
  const kaal = { id: 'k3', page: 1, ...caretPropsFromPdf(karetAnnot, {}, convertRect, 0) };
  const door3 = { id: 'd3', page: 1, type: 'textStrikethrough' };
  resolveGroupLinks([{ converted: door3, inReplyTo: '2R', replyType: 'Group' }], new Map([['2R', kaal]]));
  assert.equal(kaal.textDir, undefined);
});
