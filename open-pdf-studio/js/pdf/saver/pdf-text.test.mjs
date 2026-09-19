// Tekst naar PDF: tekst-strings in woordenboeken en tekst in appearance-streams.
//
// Aanleiding: een tekstvak met 'verdien in ook € 22 bruto' kwam na opslaan
// terug als '¬ 22 bruto'. pdf-lib schreef van elk teken de lage byte, zowel
// in /Contents als in de '(...) Tj' van de appearance.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString, PDFHexString } from 'pdf-lib';

import {
  pdfTextString, decodePdfTextObject, toWinAnsiText, winAnsiLiteral, asciiPdfName,
} from './pdf-text.js';
import { tokenizeContentStream } from '../../text/content-stream-text.js';
import { extractAnnotationColors } from '../loader/color-extraction.js';
import { buildMeasureDistanceAP } from './appearance-vectors.js';

/** De bytes zoals pdf-lib het object in het bestand zet, als latin1-tekst. */
function geschreven(obj) {
  const buf = new Uint8Array(obj.sizeInBytes());
  obj.copyBytesInto(buf, 0);
  return Buffer.from(buf).toString('latin1');
}

/** Zet waarden als sleutels op een annotatie, slaat op en leest ze terug. */
async function rondgang(waarden) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([200, 200]);
  const annot = doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [0, 0, 10, 10], ...waarden });
  pagina.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annot)]));
  const heropend = await PDFDocument.load(await doc.save());
  const annots = heropend.getPage(0).node.lookup(PDFName.of('Annots'));
  const terug = heropend.context.lookup(annots.get(0));
  return (sleutel) => terug.get(PDFName.of(sleutel));
}

// ── pdfTextString ──────────────────────────────────────────────────────────

test('ASCII blijft een PDFString met dezelfde bytes als PDFString.of', () => {
  for (const tekst of ['', 'User', 'verdien in ook 22 bruto', '{"a":"b\\"c"}', '1:100']) {
    const obj = pdfTextString(tekst);
    assert.ok(obj instanceof PDFString, `geen PDFString voor ${JSON.stringify(tekst)}`);
    assert.equal(geschreven(obj), geschreven(PDFString.of(tekst)));
  }
});

test('niet-strings worden eerst tekst', () => {
  assert.equal(geschreven(pdfTextString(0.01)), '(0.01)');
  assert.equal(geschreven(pdfTextString(null)), '()');
  assert.equal(geschreven(pdfTextString(undefined)), '()');
});

test('€, é en CJK worden UTF-16BE-hex met BOM', () => {
  assert.equal(geschreven(pdfTextString('€ 22')), '<FEFF20AC002000320032>');
  assert.equal(geschreven(pdfTextString('é')), '<FEFF00E9>');
  assert.equal(geschreven(pdfTextString('中文')), '<FEFF4E2D6587>');
  for (const tekst of ['verdien in ook € 22 bruto', 'café', '中文', 'm²', '😀']) {
    const obj = pdfTextString(tekst);
    assert.ok(obj instanceof PDFHexString, `geen hex voor ${tekst}`);
    assert.equal(obj.decodeText(), tekst);
  }
});

test('de tekst overleeft opslaan en heropenen', async () => {
  const lees = await rondgang({
    Contents: pdfTextString('verdien in ook € 22 bruto'),
    T: pdfTextString('Jérôme'),
    OPS_Label: pdfTextString('中文 label'),
    OPS_Unit: pdfTextString('mm'),
  });
  assert.equal(decodePdfTextObject(lees('Contents')), 'verdien in ook € 22 bruto');
  assert.equal(decodePdfTextObject(lees('T')), 'Jérôme');
  assert.equal(decodePdfTextObject(lees('OPS_Label')), '中文 label');
  assert.ok(lees('OPS_Unit') instanceof PDFString);
  assert.equal(decodePdfTextObject(lees('OPS_Unit')), 'mm');
});

// ── decodePdfTextObject ────────────────────────────────────────────────────

test('decodePdfTextObject leest PDFString en PDFHexString', () => {
  assert.equal(decodePdfTextObject(PDFString.of('Draft')), 'Draft');
  assert.equal(decodePdfTextObject(PDFHexString.fromText('€ 22')), '€ 22');
  assert.equal(decodePdfTextObject(PDFString.of('\u00FE\u00FF\u0000A\u0000B')), 'AB');
});

test('decodePdfTextObject geeft undefined voor andere objecten', () => {
  assert.equal(decodePdfTextObject(PDFName.of('curved')), undefined);
  assert.equal(decodePdfTextObject(undefined), undefined);
  assert.equal(decodePdfTextObject(null), undefined);
  assert.equal(decodePdfTextObject('tekst'), undefined);
});

test('JSON en Latin-1 uit oude bestanden (PDFString.of) blijven exact leesbaar', async () => {
  const json = JSON.stringify({ naam: 'x"y', pad: 'C:\\map', regels: 'a\nb', m2: 'm²' });
  const lees = await rondgang({ OPS_Params: PDFString.of(json), OPS_Label: PDFString.of('café') });
  const params = decodePdfTextObject(lees('OPS_Params'));
  assert.equal(params, json);
  assert.deepEqual(JSON.parse(params), { naam: 'x"y', pad: 'C:\\map', regels: 'a\nb', m2: 'm²' });
  assert.equal(decodePdfTextObject(lees('OPS_Label')), 'café');
});

test('JSON met niet-ASCII-tekst gaat als hex en komt heel terug', async () => {
  const data = { kop: 'Oppervlakte (m²)', naam: 'Wand "€ 22"', pad: 'C:\\map' };
  const lees = await rondgang({ OPS_ScheduleData: pdfTextString(JSON.stringify(data)) });
  assert.ok(lees('OPS_ScheduleData') instanceof PDFHexString);
  assert.deepEqual(JSON.parse(decodePdfTextObject(lees('OPS_ScheduleData'))), data);
});

// ── winAnsiLiteral ─────────────────────────────────────────────────────────

test('gewone ASCII-tekst blijft ongewijzigd', () => {
  assert.equal(winAnsiLiteral('verdien in ook 22 bruto'), 'verdien in ook 22 bruto');
  assert.equal(winAnsiLiteral(''), '');
  assert.equal(winAnsiLiteral(null), '');
  assert.equal(winAnsiLiteral('a\tb'), 'a\tb');
});

test('haakjes en backslashes krijgen een backslash, zoals voorheen', () => {
  const oud = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  for (const tekst of ['1) eerste', '(concept', 'C:\\temp\\nieuw', 'f(x) = (a)']) {
    assert.equal(winAnsiLiteral(tekst), oud(tekst));
  }
  assert.equal(winAnsiLiteral('a(b)c\\d'), 'a\\(b\\)c\\\\d');
});

test('regeleinden: behouden of samenvoegen tot één spatie', () => {
  assert.equal(winAnsiLiteral('a\r\nb'), 'a\r\nb');
  assert.equal(winAnsiLiteral('a\r\n\nb', { newlines: 'space' }), 'a b');
});

test('€ en é worden octale WinAnsi-escapes', () => {
  assert.equal(winAnsiLiteral('verdien in ook € 22 bruto'), 'verdien in ook \\200 22 bruto');
  assert.equal(winAnsiLiteral('café'), 'caf\\351');
  assert.equal(winAnsiLiteral('12,5 m²'), '12,5 m\\262');
  assert.equal(winAnsiLiteral('45°'), '45\\260');
  assert.equal(winAnsiLiteral('\u00A0'), '\\240');
});

test('de WinAnsi-tekens uit 0x80-0x9F krijgen hun eigen code', () => {
  const verwacht = {
    '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
    'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E,
    '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
    '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F,
  };
  for (const [teken, code] of Object.entries(verwacht)) {
    assert.equal(winAnsiLiteral(teken), '\\' + code.toString(8), `${teken} (U+${teken.codePointAt(0).toString(16)})`);
  }
});

test('tekens buiten WinAnsi worden zichtbaar vervangen', () => {
  assert.equal(winAnsiLiteral('中文'), '??');
  assert.equal(winAnsiLiteral('ok 😀'), 'ok ?');
  assert.equal(winAnsiLiteral('x ≤ 3'), 'x <= 3');
  assert.equal(winAnsiLiteral('ā'), 'a');
});

test('het resultaat is puur ASCII en decodeert naar de WinAnsi-bytes', () => {
  const lit = winAnsiLiteral('“€ 22” – café (net) 中');
  assert.match(lit, /^[\x20-\x7E]*$/);
  const ops = tokenizeContentStream(`BT (${lit}) Tj ET`);
  const str = ops.find((t) => t.t === 'str');
  assert.ok(str, 'geen string-token');
  assert.deepEqual([...str.v], [
    0x93, 0x80, 0x20, 0x32, 0x32, 0x94, 0x20, 0x96, 0x20, 0x63, 0x61, 0x66, 0xE9,
    0x20, 0x28, 0x6E, 0x65, 0x74, 0x29, 0x20, 0x3F,
  ]);
});

test('toWinAnsiText geeft de getoonde tekst: één eenheid per byte', () => {
  assert.equal(toWinAnsiText('€ 22'), '€ 22');
  assert.equal(toWinAnsiText('ok 😀').length, 4);
  assert.equal(toWinAnsiText('ﬃ'), 'ffi');
  assert.equal(toWinAnsiText('a\nb', { newlines: 'space' }), 'a b');
});

// ── asciiPdfName ───────────────────────────────────────────────────────────

// ── gebruik: loader en appearance-builders ─────────────────────────────────

test('de loader leest hex-sleutels als tekst en oude sleutels ongewijzigd', async () => {
  const schedule = { kop: 'Oppervlakte (m²)', rij: 'Wand "€ 22"' };
  const oudeParams = JSON.stringify({ tekst: 'a"b', pad: 'C:\\map' });
  const typeDef = { naam: 'Plafond café', id: 'x1' };
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([400, 400]);
  const ctx = doc.context;
  const annots = [
    ctx.obj({
      Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 60, 60],
      OPS_Label: pdfTextString('中文 label €'),
      OPS_Unit: pdfTextString('m²'),
      OPS_ScheduleData: pdfTextString(JSON.stringify(schedule)),
      OPS_Params: PDFString.of(oudeParams),
      OPS_BbTagTekst: pdfTextString('300×500 €'),
      OPS_SgTypeDef: pdfTextString(JSON.stringify(typeDef)),
      OPS_LeaderStyle: PDFName.of('curved'),
    }),
    ctx.obj({
      Type: 'Annot', Subtype: 'Stamp', Rect: [100, 100, 150, 150],
      OPS_StampName: pdfTextString('Goedgekeurd €'),
    }),
    ctx.obj({
      Type: 'Annot', Subtype: 'FreeText', Rect: [200, 200, 300, 260],
      DS: pdfTextString('font-family:Überschrift Sans;font-size:17pt;color:#000000;'),
    }),
  ];
  pagina.node.set(PDFName.of('Annots'), ctx.obj(annots.map((a) => ctx.register(a))));
  const heropend = await PDFDocument.load(await doc.save());
  const kaart = await extractAnnotationColors(1, heropend);

  const vlak = kaart.get('10,10,60,60');
  assert.ok(vlak, 'geen gegevens voor het vlak');
  assert.equal(vlak.opsLabel, '中文 label €');
  assert.equal(vlak.opsUnit, 'm²');
  assert.deepEqual(JSON.parse(vlak.opsScheduleData), schedule);
  assert.equal(vlak.opsParams, oudeParams);
  assert.equal(vlak.bbTagTekst, '300×500 €');
  assert.deepEqual(JSON.parse(vlak.sgTypeDefJson), typeDef);
  assert.equal(vlak.opsLeaderStyle, 'curved');

  assert.equal(kaart.get('100,100,150,150')?.stampName, 'Goedgekeurd €');

  const tekstvak = kaart.get('200,200,300,260');
  assert.ok(tekstvak, 'geen gegevens voor het tekstvak');
  assert.equal(tekstvak.dsFontSize, 17);
  assert.equal(tekstvak.fontFamily, 'Überschrift Sans');
});

test('maatlabels: WinAnsi-escapes in de Tj en de breedte over de getoonde tekst', () => {
  const label = (text) => buildMeasureDistanceAP({
    startX: 0, startY: 0, endX: 100, endY: 0, X: (x) => x, Y: (y) => y,
    strokeColorHex: '#ff0000', lineWidth: 1, text,
  }).content;
  // '€ 22': 4 getoonde tekens -> 4 * 11 * 0.5 = 22 breed, plus 2 * 2 marge.
  const euro = label('€ 22');
  assert.ok(euro.includes('(\\200 22) Tj'), euro);
  assert.ok(euro.includes(' 26 15 re f'), euro);
  assert.match(euro, /^[\x09\x0A\x0D\x20-\x7E]*$/);
  // ASCII met haakjes: zelfde breedte als voorheen (escapes tellen mee).
  const ascii = label('L (a)');
  assert.ok(ascii.includes('(L \\(a\\)) Tj'), ascii);
  assert.ok(ascii.includes(' 42.5 15 re f'), ascii);
  assert.ok(label('12,5 m²').includes('(12,5 m\\262) Tj'));
});

test('asciiPdfName laat ASCII staan en valt terug zonder bruikbare tekens', () => {
  assert.equal(asciiPdfName('For Review', 'Draft'), 'For Review');
  assert.equal(asciiPdfName('Prijs € 22', 'Draft'), 'Prijs  22');
  assert.equal(asciiPdfName('中文', 'Draft'), 'Draft');
  assert.equal(asciiPdfName(undefined, 'Image'), 'Image');
});
