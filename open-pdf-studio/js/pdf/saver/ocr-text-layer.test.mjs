import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { embedOcrFont, writeOcrTextLayer } from './ocr-text-layer.js';
import { parseToUnicodeCMap } from '../../text/content-stream-text.js';

const fontBytes = readFileSync(new URL('../../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));

test('lettertype insluiten werkt ook bij een tweede document in dezelfde sessie', async () => {
  for (let i = 0; i < 2; i++) {
    const doc = await PDFDocument.create();
    const font = await embedOcrFont(doc, fontBytes);
    doc.addPage().drawText('ocr', { font, size: 10 });
    const bytes = await doc.save();
    assert.ok(bytes.length > 0, `document ${i + 1} opgeslagen`);
  }
});

// ── Echte opslagroute met het gebundelde OCR-lettertype ──
//
// Noto Sans TC is een CID-keyed OpenType/CFF-lettertype met 18 Font DICTs. Het
// staat niet in git maar wordt door `npm run prepare:ocr-runtime` opgehaald
// (predev/prebuild); zonder dat bestand worden deze tests overgeslagen.
const NOTO = new URL('../../../src-tauri/resources/fonts/NotoSansTC-Regular.ttf', import.meta.url);
const notoBytes = existsSync(NOTO) ? readFileSync(NOTO) : null;
const zonderNoto = notoBytes ? false : 'NotoSansTC-Regular.ttf ontbreekt — draai eerst npm run prepare:ocr-runtime';

// Wisselt bewust tussen schriften (Latijn → CJK → Latijn → CJK) en bevat tekens
// die in Noto Sans TC precies op de grens van een FDSelect-bereik liggen
// ('：', 'Ø', '±'): de twee plekken waar de subsetter het Font DICT verwisselde.
const WOORDEN = [
  { text: 'Hello', left: 72, top: 72, width: 60, height: 14 },
  { text: '繁體中文', left: 140, top: 72, width: 80, height: 16 },
  { text: 'Scan-2024', left: 72, top: 100, width: 90, height: 12 },
  { text: '圖紙編號：', left: 170, top: 100, width: 90, height: 16 },
  { text: 'Ø12±5', left: 72, top: 130, width: 60, height: 12 },
  { text: '測試文字', left: 140, top: 130, width: 80, height: 16 },
  { text: 'World', left: 72, top: 160, width: 60, height: 14 },
];

async function slaOcrPdfOp(woorden) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await embedOcrFont(doc, notoBytes);
  writeOcrTextLayer(page, woorden, font);
  return PDFDocument.load(await doc.save());
}

const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');
const streamBytes = (doc, ref) => decodePDFRawStream(doc.context.lookup(ref)).decode();

// Leest het ingebedde OCR-lettertype en de tekstlaag terug uit een opgeslagen PDF.
function leesOcrLaag(doc) {
  const type0 = [...doc.context.enumerateIndirectObjects()]
    .map(([, obj]) => obj)
    .find((obj) => obj instanceof PDFDict && obj.get(PDFName.of('Subtype'))?.toString() === '/Type0');
  assert.ok(type0, 'Type0-lettertype aanwezig');
  const cidFont = doc.context.lookup(type0.lookup(PDFName.of('DescendantFonts'), PDFArray).get(0), PDFDict);
  const descriptor = cidFont.lookup(PDFName.of('FontDescriptor'), PDFDict);
  const fontFile = doc.context.lookup(descriptor.get(PDFName.of('FontFile3')));
  assert.equal(fontFile.dict.get(PDFName.of('Subtype'))?.toString(), '/CIDFontType0C');
  const cff = streamBytes(doc, descriptor.get(PDFName.of('FontFile3')));
  const toUnicode = parseToUnicodeCMap(latin1(streamBytes(doc, type0.get(PDFName.of('ToUnicode'))))).map;

  const contents = doc.getPage(0).node.Contents();
  const delen = !contents ? [] : contents instanceof PDFArray ? contents.asArray() : [contents];
  const inhoud = delen.map((s) => latin1(decodePDFRawStream(doc.context.lookup(s)).decode())).join('\n');
  // Per getoond woord de 2-byte CID's (Identity-H) uit de <hex> Tj-operanden.
  const codes = [...inhoud.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)]
    .map(([, hex]) => hex.match(/.{4}/g).map((h) => parseInt(h, 16)));
  const woorden = codes.map((cids) => cids.map((cid) => toUnicode.get(cid) ?? '�').join(''));
  return { cff, codes, woorden };
}

// Een losse CFF in een minimale OpenType-schil, zodat fontkit hem kan openen.
function openCff(cff) {
  const sfnt = new Uint8Array(28 + cff.length);
  const dv = new DataView(sfnt.buffer);
  sfnt.set([0x4f, 0x54, 0x54, 0x4f]); // 'OTTO'
  dv.setUint16(4, 1); // numTables
  sfnt.set([0x43, 0x46, 0x46, 0x20], 12); // tabeltag 'CFF '
  dv.setUint32(20, 28); // offset
  dv.setUint32(24, cff.length);
  sfnt.set(cff, 28);
  return fontkit.create(sfnt);
}

// Referentie: het bronlettertype met een lineaire FDSelect-opzoeking (TN5176
// §19: een glyph hoort bij het laatste bereik met first <= gid), los van de
// binaire zoektocht in fontkit die hier juist onder verdenking staat.
function bronlettertype() {
  const font = fontkit.create(notoBytes);
  const cff = font['CFF '];
  const { ranges } = cff.topDict.FDSelect;
  cff.fdForGlyph = (gid) => {
    let fd = null;
    for (const r of ranges) {
      if (r.first > gid) break;
      fd = r.fd;
    }
    return fd;
  };
  return font;
}

const omtrek = (font, gid) => {
  try {
    return font.getGlyph(gid).path.toSVG();
  } catch (fout) {
    return `fout: ${fout.message}`;
  }
};
const privateKern = (p) => JSON.stringify([
  p.BlueValues, p.OtherBlues, p.StdHW, p.StdVW, p.defaultWidthX, p.nominalWidthX, (p.Subrs || []).length,
]);

test('OCR-laag met Noto Sans TC: ingebedde CFF heeft een geldige kop en de tekst blijft terugleesbaar', { skip: zonderNoto }, async () => {
  const { cff, woorden } = leesOcrLaag(await slaOcrPdfOp(WOORDEN));
  // TN5176 tabel 2: major 1, hdrSize 4 (fontkit schrijft vier kopbytes), offSize 1..4
  assert.equal(cff[0], 1, 'CFF major');
  assert.equal(cff[2], 4, 'CFF hdrSize');
  assert.ok(cff[3] >= 1 && cff[3] <= 4, `CFF offSize ${cff[3]} valt buiten 1..4`);
  assert.deepEqual(woorden, WOORDEN.map((w) => w.text));
});

test('OCR-laag met Noto Sans TC: elke glyph houdt zijn eigen Font DICT en tekent als in het bronlettertype', { skip: zonderNoto }, async () => {
  const { cff, codes } = leesOcrLaag(await slaOcrPdfOp(WOORDEN));
  const subset = openCff(cff);
  const subCff = subset['CFF '];
  const bron = bronlettertype();
  const bronCff = bron['CFF '];

  const [registry, ordering, supplement] = subCff.topDict.ROS;
  assert.deepEqual([subCff.string(registry), subCff.string(ordering), supplement], ['Adobe', 'Identity', 0]);
  assert.equal(subCff.topDict.CIDCount, subCff.topDict.CharStrings.length);
  assert.equal(subCff.topDict.FDSelect.fds.length, subCff.topDict.CharStrings.length, 'FDSelect dekt elke glyph');

  // Subset-CID → bronglyph: pdf-lib codeert elk woord als font.layout(tekst),
  // dus de CID's in de content stream lopen één-op-één met die glyphs mee
  // (inclusief contextuele varianten, zoals de proportionele cijfers).
  const bronGlyph = new Map([[0, 0]]);
  codes.forEach((cids, i) => {
    const glyphs = bron.layout(WOORDEN[i].text).glyphs;
    assert.equal(cids.length, glyphs.length, `glyphs van ${WOORDEN[i].text}`);
    cids.forEach((cid, k) => bronGlyph.set(cid, glyphs[k].id));
  });
  assert.equal(bronGlyph.size, subCff.topDict.CharStrings.length, 'elke subset-glyph komt uit de tekst');

  const afwijkingen = [];
  for (const [cid, bronGid] of bronGlyph) {
    const subPrivate = subCff.topDict.FDArray[subCff.fdForGlyph(cid)].Private;
    const bronPrivate = bronCff.topDict.FDArray[bronCff.fdForGlyph(bronGid)].Private;
    if (privateKern(subPrivate) !== privateKern(bronPrivate)) afwijkingen.push(`cid ${cid} (gid ${bronGid}): ander Font DICT`);
    else if (omtrek(subset, cid) !== omtrek(bron, bronGid)) afwijkingen.push(`cid ${cid} (gid ${bronGid}): andere omtrek`);
  }
  assert.deepEqual(afwijkingen, []);
});

test('OCR-laag met Noto Sans TC: een pagina zonder herkende woorden slaat gewoon op', { skip: zonderNoto, timeout: 30000 }, async () => {
  const { cff, woorden } = leesOcrLaag(await slaOcrPdfOp([]));
  assert.deepEqual(woorden, []);
  assert.equal(cff[2], 4, 'CFF hdrSize');
  assert.ok(cff[3] >= 1 && cff[3] <= 4, `CFF offSize ${cff[3]} valt buiten 1..4`);
  assert.ok(openCff(cff)['CFF '].topDict.CharStrings.length >= 2, 'charset heeft een geldig bereik');
});
