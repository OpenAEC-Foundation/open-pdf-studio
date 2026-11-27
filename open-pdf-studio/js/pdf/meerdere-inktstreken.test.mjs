import assert from 'node:assert/strict';
import test from 'node:test';
import mupdf from 'mupdf';
import { PDFDocument, PDFName } from 'pdf-lib';
import { laad, opslaan, woordenboeken } from './rondgang.testhulp.mjs';

const streken = [[20, 100, 60, 100], [100, 100, 140, 100], [180, 100, 220, 100]];

async function bewerkInkt(paths = streken) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([250, 200]);
  page.node.addAnnot(doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Ink', Rect: [18, 98, 222, 102],
    C: [0, 0, 0], InkList: paths, BS: { W: 2 },
  })));
  const bron = await doc.save();
  const modellen = await laad(bron);
  assert.equal(modellen.length, 1);
  modellen[0].lineWidth = 6;
  return opslaan(bron, modellen);
}

test('lijndikte wijzigen en heropenen behoudt alle drie de afzonderlijke inktstreken', async () => {
  const bytes = await bewerkInkt();
  const modellen = await laad(bytes);
  const { applyMoveGeneric } = await import('../annotations/transforms.js');
  applyMoveGeneric(modellen[0], 4, -8);
  modellen[0].lineWidth = 4;
  const lijst = await woordenboeken(await opslaan(bytes, modellen));
  assert.equal(lijst.length, 1);
  const ink = lijst[0].dict.lookup(PDFName.of('InkList'));
  assert.deepEqual(ink.asArray().map(s => s.asArray().map(n => n.asNumber())),
    [[24, 108, 64, 108], [104, 108, 144, 108], [184, 108, 224, 108]]);
});

test('de opgeslagen PDF toont iedere streek en laat beide tussenruimten wit', async () => {
  const doc = mupdf.Document.openDocument(await bewerkInkt(), 'application/pdf');
  const page = doc.loadPage(0);
  const pix = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
  try {
    const pixels = pix.getPixels();
    for (const x of [40, 120, 200]) assert.ok(pixels[100 * pix.getStride() + x * 3] < 50, 'inkt op x=' + x);
    for (const x of [80, 160]) assert.ok(pixels[100 * pix.getStride() + x * 3] > 245, 'wit op x=' + x);
  } finally {
    pix.destroy();
    page.destroy();
    doc.destroy();
  }
});

const canvas = await import('@napi-rs/canvas').catch(() => null);
test('het bewerkte model tekent drie streken met twee openingen op het editorcanvas',
  { skip: !canvas && 'optionele canvasmodule ontbreekt' }, async () => {
    const { drawInk } = await import('../annotations/rendering/ink.js');
    const [ink] = await laad(await bewerkInkt());
    const ctx = canvas.createCanvas(250, 200).getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 250, 200);
    ctx.lineWidth = ink.lineWidth;
    drawInk(ctx, ink, '#000000', ink.lineWidth);
    const pixel = x => ctx.getImageData(x, 100, 1, 1).data[0];
    assert.deepEqual([40, 80, 120, 160, 200].map(pixel), [0, 255, 0, 255, 0]);
  });

test('een penstip en een lijn blijven samen zichtbaar na wijzigen van de lijndikte', async () => {
  const bytes = await bewerkInkt([[20, 100], [100, 100, 140, 100]]);
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const page = doc.loadPage(0);
  const pix = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
  try {
    const pixels = pix.getPixels();
    assert.ok(pixels[100 * pix.getStride() + 20 * 3] < 50, 'de losse penstip');
  } finally {
    pix.destroy();
    page.destroy();
    doc.destroy();
  }
});
