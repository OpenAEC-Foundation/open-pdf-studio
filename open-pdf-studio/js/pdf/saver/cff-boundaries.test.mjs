// #901: kwalificeer de bestaande #416-wrapper met de gerapporteerde JP-fixture.
// De onbewerkte dependency is defect; de productiecode gebruikt laadFontkit().
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire, register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { PDFDocument, StandardFonts, PDFName } from 'pdf-lib';
import * as mupdf from 'mupdf';
import { metCffHerstel } from './cff-subset-herstel.js';
import { embedOcrFont, laadFontkit, writeOcrTextLayer } from './ocr-text-layer.js';
import { maakCjkFontKeten } from './cjk-fonts.js';

const require = createRequire(import.meta.url);
const directory = process.env.OPS_UNICODE_FONT_DIR;
const skip = directory ? false : 'Set OPS_UNICODE_FONT_DIR; CI provisions pinned fonts';
const manifest = JSON.parse(readFileSync(new URL('../../../scripts/unicode-fonts.json', import.meta.url)));
function fixture(name) {
  const bytes = readFileSync(path.join(directory, name));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.find(a => a.name === name).sha256);
  return bytes;
}
const kitDirectory = path.dirname(require.resolve('@pdf-lib/fontkit'));
const version = require('@pdf-lib/fontkit/package.json').version;
const characters = [...'・ー：Ａ㐂ぁ'];
const text = characters.join('');
const dimensions = [360, 110];
const position = { x: 20, y: 40, size: 40 };
const linearFD = (ranges, gid) => ranges.filter(r => r.first <= gid).at(-1)?.fd ?? null;

// Zowel de browser-ES-bouw als de Node-UMD-bouw, inclusief minified varianten.
// De wrapper is onafhankelijk van de verpakking; node_modules blijft origineel.
for (const build of ['es', 'es.min', 'umd', 'umd.min']) {
  test(`FDSelect boundaries in @pdf-lib/fontkit ${build}`, { skip }, async () => {
    assert.equal(version, '1.1.1', 'Requalify the workaround when upgrading fontkit');
    const { default: raw } = await import(pathToFileURL(path.join(kitDirectory, `fontkit.${build}.js`)));
    const bytes = fixture('NotoSansJP-Regular.otf');
    const broken = raw.create(bytes)['CFF '];
    const font = metCffHerstel(raw).create(bytes);
    const cff = font['CFF '];
    const { ranges, version: format } = cff.topDict.FDSelect;
    assert.equal(format, 3);
    assert.equal(font.numGlyphs, 17936);
    let mismatches = 0;
    for (let gid = 0; gid < font.numGlyphs; gid++) {
      const expected = linearFD(ranges, gid);
      if (broken.fdForGlyph(gid) !== expected) mismatches++;
      assert.equal(cff.fdForGlyph(gid), expected, `glyph ${gid}`);
    }
    assert.equal(mismatches, 63, 'Unwrapped dependency reproduces the report');
    for (const { first, fd } of ranges) assert.equal(cff.fdForGlyph(first), fd);
    assert.equal(cff.fdForGlyph(font.numGlyphs - 1), ranges.at(-1).fd);
    for (const char of characters) {
      const gid = font.glyphForCodePoint(char.codePointAt(0)).id;
      assert.ok(ranges.some(r => r.first === gid), `${char} is a real range boundary`);
    }
    assert.equal(cff.fdForGlyph(1388), 3, 'U+30FB');
  });
}

function inspect(bytes) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    return Array.from({ length: doc.countPages() }, (_, number) => {
      const page = doc.loadPage(number);
      let pix, structured;
      try {
        pix = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, false);
        structured = page.toStructuredText();
        return { text: structured.asText().trim(), pixels: Uint8Array.from(pix.getPixels()) };
      } finally { structured?.destroy(); pix?.destroy(); page.destroy(); }
    });
  } finally { doc.destroy(); }
}

// MuPDF leest het originele font rechtstreeks, zonder fontkit, pdf-lib,
// subsetting of een PDF-CID-mapping als gemeenschappelijke foutbron.
function originalPixels(bytes, strings) {
  const font = new mupdf.Font('reference', bytes);
  try {
    return strings.map(content => {
      const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, dimensions[0] * 2, dimensions[1] * 2], false);
      const device = new mupdf.DrawDevice(mupdf.Matrix.scale(2, 2), pix);
      const run = new mupdf.Text();
      try {
        pix.clear(255);
        run.showString(font, [40, 0, 0, -40, 20, dimensions[1] - 40], content);
        device.fillText(run, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, [0, 0, 0], 1);
        device.close();
        return { text: content, pixels: Uint8Array.from(pix.getPixels()) };
      } finally { run.destroy(); device.destroy(); pix.destroy(); }
    });
  } finally { font.destroy(); }
}

async function directPdf(bytes, subset, strings = characters) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(await laadFontkit());
  const font = await doc.embedFont(bytes, { subset });
  // Eén glyph per pagina: geen lege of fout gevormde glyph kan zich achter
  // inkt van een ander teken verschuilen. Full-font behoudt originele CFF-data.
  for (const char of strings) doc.addPage(dimensions).drawText(char, { ...position, font });
  return doc.save();
}

function sameGlyphs(actual, reference, strings) {
  assert.equal(actual.length, reference.length);
  for (let i = 0; i < actual.length; i++) {
    assert.equal(actual[i].text, strings[i]);
    assert.equal(reference[i].text, strings[i]);
    assert.ok(reference[i].pixels.some(v => v < 100), `${strings[i]} has reference ink`);
    assert.equal(actual[i].pixels.reduce((n, v, k) => n + (v !== reference[i].pixels[k]), 0), 0, `${strings[i]} matches original font pixels in MuPDF`);
  }
}

test('saved CFF subsets render each boundary glyph like the original font in MuPDF', { skip }, async t => {
  const bytes = fixture('NotoSansJP-Regular.otf');
  const full = await directPdf(bytes, false);
  const subset = await directPdf(bytes, true);
  sameGlyphs(inspect(subset), originalPixels(bytes, characters), characters);
  assert.ok(subset.length < full.length / 10, 'Production keeps subsetting, not whole CJK fonts');
  t.diagnostic(`Six glyphs: subset ${subset.length} bytes; full font ${full.length} bytes`);
});

// Alleen platform-I/O is vervangen. De daadwerkelijke tekstbewerkingsroute,
// fontkeuze, CJK-keten, laadFontkit, pdf-lib en MuPDF blijven echt.
register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { saveTextEditsToPages } = await import('./text-edits.js');

test('CJK text edit and font chain save the same glyphs as the original font', { skip }, async t => {
  const bytes = fixture('NotoSansJP-Regular.otf');
  const latin = readFileSync(new URL('../../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));
  t.mock.method(globalThis, 'fetch', async () => new Response(latin));
  // De JP-fixture neemt in deze proef de plaats in van de TC/SC-resource.
  // Dit kwalificeert de CFF-route; het verandert de gebundelde fonts niet.
  const oldTauri = globalThis.__TAURI__;
  t.after(() => { globalThis.__TAURI__ = oldTauri; });
  globalThis.__TAURI__ = {
    path: { resourceDir: async () => '/fixtures', join: async (...parts) => path.join(...parts) },
    core: { invoke: async () => undefined },
    fs: { readFile: async () => bytes },
  };
  const source = await PDFDocument.create();
  const old = await source.embedFont(StandardFonts.Helvetica);
  const page = source.addPage(dimensions);
  page.node.setFontDictionary(PDFName.of('F1'), old.ref);
  page.node.set(PDFName.of('Contents'), source.context.register(source.context.flateStream(
    'BT /F1 40 Tf 20 40 Td (old) Tj ET\n')));
  const edited = await PDFDocument.load(await source.save());
  await saveTextEditsToPages(edited, edited.getPages(), { textEdits: [{
    id: 'cff-boundaries', page: 1, originalText: 'old', newText: text,
    pdfX: 20, pdfY: 40, pdfWidth: 60, fontSize: 40, lineSpacing: 48, numOriginalLines: 1,
    fontFamily: 'Helvetica', loadedFontName: '', color: '#000000', textAngle: 0,
    originalLineInfo: [{ x: 20, y: 40, width: 60, fontSize: 40, angle: 0, text: 'old' }],
    originalSpanTexts: [['old']],
  }] });
  const expected = originalPixels(bytes, [text]);
  sameGlyphs(inspect(await edited.save()), expected, [text]);

  const chained = await PDFDocument.create();
  const chain = maakCjkFontKeten(chained, { laadBytes: async () => bytes });
  const chainPage = chained.addPage(dimensions);
  const runs = await chain.runs(text);
  assert.equal(runs.length, 1);
  chainPage.drawText(runs[0].tekst, { ...position, font: runs[0].font });
  sameGlyphs(inspect(await chained.save()), expected, [text]);
});

for (const [name, content] of [['NotoSansJP-Regular.otf', text], ['Inter-Regular.ttf', 'OCR Latin 123']]) {
  test(`OCR stays invisible and extractable: ${name}`, { skip }, async () => {
    const bytes = fixture(name);
    const doc = await PDFDocument.create();
    const font = await embedOcrFont(doc, bytes, { unicodeGuard: true });
    const page = doc.addPage(dimensions);
    writeOcrTextLayer(page, [{ text: content, left: 20, top: 30, width: 280, height: 40 }], font);
    const [result] = inspect(await doc.save());
    assert.equal(result.text, content);
    assert.ok(result.pixels.every(v => v === 255), 'Invisible OCR must not paint');
  });
}

// TrueType ondersteunt zowel volledige insluiting als subsets; beide blijven
// gelijk aan het originele font en aan elkaar (geen CFF-wrapper nodig).
test('TrueType full-font and subset exports retain the original glyph shapes', { skip }, async () => {
  const bytes = fixture('Inter-Regular.ttf');
  const strings = ['OCR Latin 123'];
  const full = inspect(await directPdf(bytes, false, strings));
  const subset = inspect(await directPdf(bytes, true, strings));
  sameGlyphs(subset, full, strings);
  sameGlyphs(full, originalPixels(bytes, strings), strings);
});
