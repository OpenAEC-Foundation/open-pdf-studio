// Secure redaction (#762): Apply Redactions must remove the covered content
// from the file, not cover it. Every check reads the written bytes
// independently: text extraction with pdf.js and MuPDF, decoded image
// samples, painted path geometry, every raw and inflated stream of the file,
// and a MuPDF render compared with the original outside the areas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream, PDFString, decodePDFRawStream } from 'pdf-lib';
import * as H from './redaction.testhulp.mjs';
import { redactPdfBytes, redactDocument, applyPendingRedactions, unreferencedObjects, PENDING_KEY } from './apply.js';
import { lexContent } from './lexer.js';
import { readObjects } from '../hidden-information-scan.js';

const fixture = await H.mainFixture();
const marks = H.mainMarks(fixture);
const result = await redactPdfBytes(fixture.bytes, marks);
const out = result.bytes;

/** Page text without the words that must stay: nothing else may be left. */
const residue = (text) => [...H.KEPT].sort((a, b) => b.length - a.length).reduce((t, w) => t.split(w).join(''), text).replace(/\s+/g, '');

test('redacted words are absent from the extracted text (pdf.js and MuPDF), surrounding words remain', async () => {
  const [p1, p2] = await H.pdfjsText(out);
  const [m1, m2] = H.mupdfText(out);
  for (const [name, text] of [['pdf.js', p1], ['mupdf', m1]]) {
    for (const s of H.TEXT_SECRETS) assert.ok(!text.includes(s), `${name}: ${s} still extractable`);
    for (const w of H.KEPT) assert.ok(text.includes(w), `${name}: ${w} missing`);
    assert.equal(residue(text), '', `${name}: no other text left on the page`);
  }
  // Page 2 uses the same Form XObject unredacted: its text stays.
  for (const t of [p2, m2]) for (const w of ['FORMSECRET', 'NESTEDSECRET', 'PAGETWO']) assert.ok(t.includes(w), w);
  // The original indeed had the secrets.
  const [o1] = await H.pdfjsText(fixture.bytes);
  for (const s of ['T1SECRET', 'CIDSECRET', 'TTHREESECRET', 'ROTSECRET', 'OCRSECRET', 'FORMSECRET', 'NESTEDSECRET']) assert.ok(o1.includes(s), s);
});

test('remaining glyphs keep their exact positions', async () => {
  const before = H.mupdfChars(fixture.bytes);
  const after = H.mupdfChars(out);
  for (const w of H.KEPT) {
    const a = H.wordOrigins(before, w), b = H.wordOrigins(after, w);
    assert.ok(a && b, w);
    for (let i = 0; i < a.length; i++) {
      assert.ok(Math.abs(a[i][0] - b[i][0]) < 0.01 && Math.abs(a[i][1] - b[i][1]) < 0.01, `${w}[${i}] moved: ${a[i]} → ${b[i]}`);
    }
  }
});

test('no secret remains anywhere in the file: raw bytes, inflated streams, earlier objects', () => {
  for (const s of H.SECRETS) assert.ok(H.containsSecret(fixture.bytes, s), `fixture contains ${s}`);
  for (const s of H.SECRETS) assert.ok(!H.containsSecret(out, s), `${s} left in the file`);
  assert.deepEqual(unreferencedObjects(out), []);
  assert.ok(!H.latin1(out).includes('/Prev'), 'no incremental section');
  assert.ok(!H.latin1(out).includes('/ObjStm'), 'no object streams');
});

test('covered image pixels are the fill colour in the decoded image data; others unchanged', async () => {
  const pdf = await PDFDocument.load(out);
  const res = pdf.getPage(0).node.Resources();
  const xo = res.lookup(PDFName.of('XObject'), PDFDict);
  const names = xo.keys().map((k) => k.decodeText());
  const content = await H.contentOf(out);
  const used = lexContent(Buffer.from(content, 'latin1')).filter((o) => o.op === 'Do').map((o) => o.operands[0].v);
  const imgName = used.find((n) => n.startsWith('RdIm'));
  assert.ok(imgName && names.includes(imgName), 'image replaced by a redacted copy');
  assert.ok(!used.includes('Im1'), 'original image no longer drawn');
  const img = xo.lookup(PDFName.of(imgName));
  const data = decodePDFRawStream(img).decode();
  const W = 32;
  for (let j = 0; j < 32; j++) {
    for (let i = 0; i < 32; i++) {
      const k = (j * W + i) * 3;
      const inside = i >= 8 && i < 20 && j >= 12 && j < 24;
      if (inside) assert.deepEqual([data[k], data[k + 1], data[k + 2]], [0, 0, 0], `pixel ${i},${j}`);
      else assert.deepEqual([data[k], data[k + 1], data[k + 2]], [200, i * 4, 60 + j * 4], `pixel ${i},${j} kept`);
    }
  }
  // The soft mask was redacted with the same pixels (as a copy).
  const sm = img.dict.lookup(PDFName.of('SMask'));
  assert.ok(sm instanceof PDFRawStream);
  assert.equal(decodePDFRawStream(sm).decode().length, 32 * 32);
  // Inline image: covered samples are 0 (black), others unchanged.
  const ops = lexContent(Buffer.from(content, 'latin1'));
  const bi = ops.find((o) => o.op === 'BI');
  assert.ok(bi, 'inline image kept');
  const filt = bi.inline.dict.get('Filter');
  assert.ok(Array.isArray(filt));
  const hex = H.latin1(bi.inline.data).replace(/[\s>]/g, '');
  const { inflateSync } = await import('node:zlib');
  const samples = inflateSync(Buffer.from(hex, 'hex'));
  for (let j = 0; j < 16; j++) {
    for (let i = 0; i < 16; i++) {
      const inside = i >= 4 && i < 8 && j >= 4 && j < 8;
      assert.equal(samples[j * 16 + i], inside ? 0 : 40 + i * 10, `inline ${i},${j}`);
    }
  }
});

test('painted vector geometry inside the area is gone; outside it is kept', async () => {
  const area = marks[8].quad;
  const before = H.paintedSegments(await H.contentOf(fixture.bytes));
  const after = H.paintedSegments(await H.contentOf(out));
  assert.ok(H.segmentsInside(before, area).length >= 4, 'fixture paints in the area');
  assert.deepEqual(H.segmentsInside(after, area), [], 'no painted segment crosses the area');
  // The horizontal line survives on both sides, ending at the area edge.
  const horiz = after.filter((s) => s.length === 2 && Math.abs(s[0][1] - 200) < 1e-6 && Math.abs(s[1][1] - 200) < 1e-6);
  const xs = horiz.flatMap((s) => [s[0][0], s[1][0]]);
  assert.ok(xs.some((x) => Math.abs(x - 50) < 1e-6) && xs.some((x) => Math.abs(x - 550) < 1e-6), 'line ends kept');
  assert.ok(xs.some((x) => Math.abs(x - 250) < 1e-6) && xs.some((x) => Math.abs(x - 350) < 1e-6), 'line cut at the area');
});

test('annotations, popups, links and form fields in the area are removed; others kept', async () => {
  const pdf = await PDFDocument.load(out);
  const annots = pdf.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).asArray().map((r) => pdf.context.lookup(r));
  const subtypes = annots.map((d) => d.get(PDFName.of('Subtype')).decodeText());
  assert.ok(!subtypes.includes('Text') && !subtypes.includes('Popup') && !subtypes.includes('Link'));
  assert.ok(subtypes.includes('FreeText'), 'annotation outside the area kept');
  const fields = pdf.getForm().getFields().map((f) => f.getName());
  assert.deepEqual(fields, ['keepField']);
  assert.equal(pdf.getForm().getTextField('keepField').getText(), 'KEEPFIELD');
});

test('alternate text of cut marked content and structure elements is dropped', async () => {
  const pdf = await PDFDocument.load(out);
  const root = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  const se = pdf.context.lookup(root.lookup(PDFName.of('K'), PDFArray).get(0));
  assert.equal(se.get(PDFName.of('Alt')), undefined);
  assert.equal(se.get(PDFName.of('ActualText')), undefined);
  const content = await H.contentOf(out);
  assert.ok(/\/Span\s*<<\s*\/MCID 0\s*>>\s*BDC/.test(content), 'marked content kept with its MCID only');
});

test('the rendered page is unchanged outside the areas', () => {
  const s = 2, margin = 5; // margin covers image pixels (4 pt) partly in an area
  const a = H.render(fixture.bytes, 0, s), b = H.render(out, 0, s);
  assert.equal(a.w, b.w);
  // Annotation and field appearances are removed on purpose: skip the popup rectangle too.
  const boxes = marks.map(({ quad }) => {
    const xs = quad.map((p) => p[0]), ys = quad.map((p) => p[1]);
    return [Math.min(...xs) - margin, Math.min(...ys) - margin, Math.max(...xs) + margin, Math.max(...ys) + margin];
  }).concat([[300 - margin, 740 - margin, 450 + margin, 792]]);
  const near = (x, y) => boxes.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
  let compared = 0, differing = 0, maxDiff = 0;
  for (let py = 0; py < a.h; py++) {
    for (let px = 0; px < a.w; px++) {
      const x = (px + 0.5) / s, y = 792 - (py + 0.5) / s;
      if (near(x, y)) continue;
      compared++;
      const k = (py * a.w + px) * a.n;
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.px[k + c] - b.px[k + c]));
      if (d > 24) differing++;
      if (d > maxDiff) maxDiff = d;
    }
  }
  assert.ok(compared > a.w * a.h * 0.5);
  console.log(`render compare: ${differing} of ${compared} pixels differ by more than 24 (max ${maxDiff})`);
  assert.ok(differing <= compared * 0.0002, `${differing} of ${compared} pixels differ (max ${maxDiff})`);
});

test('without the overlay, nothing of the original shows inside the areas', async () => {
  // Remove the overlay block (as a reader could) and render.
  const pdf = await PDFDocument.load(out);
  const page = pdf.getPage(0);
  const refs = page.node.lookup(PDFName.of('Contents'), PDFArray).asArray();
  const last = pdf.context.lookup(refs[refs.length - 1]);
  const src = H.latin1(decodePDFRawStream(last).decode());
  assert.ok(src.includes('/OPSRedact BMC'));
  pdf.context.assign(refs[refs.length - 1], pdf.context.flateStream(src.replace(/\/OPSRedact BMC[\s\S]*?EMC/, '')));
  const bare = await pdf.save();
  const s = 2;
  const r = H.render(bare, 0, s);
  for (const { quad } of marks.slice(0, 13)) {
    const xs = quad.map((p) => p[0]), ys = quad.map((p) => p[1]);
    for (let py = 0; py < r.h; py++) {
      const y = 792 - (py + 0.5) / s;
      if (y < Math.min(...ys) + 1 || y > Math.max(...ys) - 1) continue;
      for (let px = 0; px < r.w; px++) {
        const x = (px + 0.5) / s;
        if (x < Math.min(...xs) + 1 || x > Math.max(...xs) - 1) continue;
        // Inside (rotated areas: test against the quad itself).
        const q = quad;
        let inside = true;
        for (let i = 0; i < 4; i++) {
          const [x0, y0] = q[i], [x1, y1] = q[(i + 1) % 4];
          const cr = (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0);
          if (i === 0) inside = cr;
          else if (Math.sign(cr) !== Math.sign(inside) || Math.abs(cr) < 2) { inside = false; break; }
        }
        if (!inside) continue;
        const k = (py * r.w + px) * r.n;
        const [R, G, B] = [r.px[k], r.px[k + 1], r.px[k + 2]];
        const chroma = Math.max(R, G, B) - Math.min(R, G, B);
        assert.ok(chroma < 24, `coloured original content at ${x.toFixed(1)},${y.toFixed(1)}: ${R},${G},${B}`);
      }
    }
  }
});

test('an incremental-update input: the earlier revision and unreferenced objects are not written', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 300]);
  const font = pdf.context.register(pdf.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
  page.node.set(PDFName.of('Resources'), pdf.context.obj({ Font: pdf.context.obj({ F1: font }) }));
  const content = pdf.context.register(pdf.context.stream('BT /F1 12 Tf 20 200 Td (OLDREVSECRET) Tj ET'));
  page.node.set(PDFName.of('Contents'), content);
  const base = await pdf.save({ useObjectStreams: false });
  const size = pdf.context.largestObjectNumber + 1;
  const upd = H.appendIncrementalUpdate(base, content.objectNumber, 'BT /F1 12 Tf 20 200 Td (NEWREVISION) Tj ET', pdf.context.trailerInfo.Root.toString(), size);
  assert.ok(H.containsSecret(upd, 'OLDREVSECRET'));
  assert.ok((await H.pdfjsText(upd))[0].includes('NEWREVISION'));
  const { bytes } = await redactPdfBytes(upd, [{ pageIndex: 0, quad: H.rectQuad(10, 10, 60, 60), fill: [0, 0, 0] }]);
  assert.ok(!H.containsSecret(bytes, 'OLDREVSECRET'));
  assert.ok((await H.pdfjsText(bytes))[0].includes('NEWREVISION'));
  assert.deepEqual(unreferencedObjects(bytes), []);
  const { trailers } = readObjects(bytes);
  assert.ok(trailers.every((t) => !t.has('Prev')));
});

test('invalid areas are rejected and nothing is changed', async () => {
  for (const quad of [
    [[10, 10], [10, 10], [10, 10], [10, 10]], // empty
    [[0, 0], [NaN, 0], [5, 5], [0, 5]], // not finite
    [[0, 0], [10, 10], [10, 0], [0, 10]], // self-intersecting
    'nonsense',
  ]) {
    await assert.rejects(redactPdfBytes(fixture.bytes, [{ pageIndex: 0, quad, fill: [0, 0, 0] }]), { code: 'REDACTION_INVALID_AREA' });
  }
  await assert.rejects(redactPdfBytes(fixture.bytes, [{ pageIndex: 9, quad: H.rectQuad(0, 0, 5, 5), fill: [0, 0, 0] }]), { code: 'REDACTION_INVALID_AREA' });
  await assert.rejects(redactPdfBytes(fixture.bytes, []), { code: 'REDACTION_NO_AREAS' });
});

test('text in a font with unknown metrics near an area is refused, not left behind', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 300]);
  // /F9 is missing from the resources: glyph widths are unknown.
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.stream('BT /F9 12 Tf 20 200 Td (UNKNOWNFONT) Tj ET BT /F9 12 Tf 20 20 Td (FAR) Tj ET')));
  const bytes = await pdf.save();
  await assert.rejects(redactPdfBytes(bytes, [{ pageIndex: 0, quad: H.rectQuad(60, 195, 80, 210), fill: [0, 0, 0] }]), { code: 'REDACTION_UNSUPPORTED_FONT' });
  // Far enough away (beyond any glyph width) it is left alone.
  const ok = await redactPdfBytes(bytes, [{ pageIndex: 0, quad: H.rectQuad(200, 100, 250, 120), fill: [0, 0, 0] }]);
  assert.ok(H.latin1(ok.bytes).length > 0);
});

test('a JPEG image is redacted in its pixels and written as a JPEG again', async () => {
  const { mupdf } = H;
  const W = 40, Hh = 40;
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, W, Hh], false);
  const px = pix.getPixels();
  for (let i = 0; i < W * Hh; i++) { px[i * 3] = 30; px[i * 3 + 1] = 180; px[i * 3 + 2] = 60; }
  const jpg = pix.asJPEG(95);
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  const img = pdf.context.register(pdf.context.stream(jpg, { Type: 'XObject', Subtype: 'Image', Width: W, Height: Hh, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' }));
  page.node.set(PDFName.of('Resources'), pdf.context.obj({ XObject: pdf.context.obj({ J: img }) }));
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.stream('q 160 0 0 160 20 20 cm /J Do Q')));
  const src = await pdf.save();
  // Area: image columns 10..19, rows (from the top) 20..29 (4 pt per pixel).
  const { bytes } = await redactPdfBytes(src, [{ pageIndex: 0, quad: H.rectQuad(60, 60, 100, 100), fill: [0, 0, 0] }]);
  const doc = await PDFDocument.load(bytes);
  const xo = doc.getPage(0).node.Resources().lookup(PDFName.of('XObject'), PDFDict);
  const name = xo.keys().map((k) => k.decodeText()).find((n) => n.startsWith('RdIm'));
  const red = xo.lookup(PDFName.of(name));
  assert.equal(red.dict.get(PDFName.of('Filter')).decodeText(), 'DCTDecode');
  const dec = new mupdf.Image(red.contents).toPixmap().getPixels();
  const at = (i, j) => Array.from(dec.slice((j * W + i) * 3, (j * W + i) * 3 + 3));
  for (const [i, j] of [[12, 22], [15, 25], [18, 28]]) assert.ok(at(i, j).every((v) => v < 24), `covered ${i},${j}: ${at(i, j)}`);
  for (const [i, j] of [[2, 2], [35, 35], [5, 30]]) { const [r, g, b] = at(i, j); assert.ok(Math.abs(r - 30) < 16 && Math.abs(g - 180) < 16 && Math.abs(b - 60) < 16, `kept ${i},${j}: ${r},${g},${b}`); }
});

test('the saver re-applies the recorded areas to content written after applying, then drops the record', async () => {
  const pdf = await PDFDocument.load(fixture.bytes);
  await redactDocument(pdf, marks.slice(0, 1), { pending: true });
  const page = pdf.getPage(0);
  assert.ok(page.node.get(PDFName.of(PENDING_KEY)) instanceof PDFArray);
  // A text edit / OCR layer written at save time into the redacted area.
  const font = page.node.Resources().lookup(PDFName.of('Font'), PDFDict).get(PDFName.of('F1'));
  void font;
  const extra = pdf.context.register(pdf.context.flateStream('q BT /F1 12 Tf 0 0 0 rg 1 0 0 1 72 700 Tm (XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX) Tj ET Q', { OPS_OCRLayer: true }));
  page.node.lookup(PDFName.of('Contents'), PDFArray).push(extra);
  await applyPendingRedactions(pdf);
  assert.equal(page.node.get(PDFName.of(PENDING_KEY)), undefined);
  const bytes = await pdf.save({ useObjectStreams: false });
  const [m1] = H.mupdfText(bytes);
  const line = m1.split('\n').find((l) => l.includes('XXX'));
  assert.ok(line, 'text outside the area kept');
  // Characters on the area are gone: the run of X is split.
  assert.ok(!/X{35}/.test(m1.replace(/\s/g, '')), 'the X under the area were removed');
  // The overlay of the first application is still there exactly once.
  const content = await H.contentOf(bytes);
  assert.equal(content.split('/OPSRedact BMC').length - 1, 1);
  // The OCR-layer stream keeps its marker key (the OCR writer recognises its own layer).
  const refs = pdf.getPage(0).node.lookup(PDFName.of('Contents'), PDFArray).asArray();
  assert.ok(refs.some((r) => pdf.context.lookup(r).dict.get(PDFName.of('OPS_OCRLayer'))));
});

test('a vector path wholly inside an area and shared forms on other pages', async () => {
  const pdf = await PDFDocument.create();
  const p1 = pdf.addPage([200, 200]);
  const fx = pdf.context.register(pdf.context.flateStream('0 0 1 rg 10 10 30 30 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 100] }));
  p1.node.set(PDFName.of('Resources'), pdf.context.obj({ XObject: pdf.context.obj({ F: fx }) }));
  p1.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.stream('1 0 0 rg 50 50 20 20 re f /F Do q 1 0 0 1 100 100 cm /F Do Q')));
  const src = await pdf.save();
  const { bytes } = await redactPdfBytes(src, [{ pageIndex: 0, quad: H.rectQuad(45, 5, 75, 75), fill: null }]);
  const after = H.paintedSegments(await H.contentOf(bytes));
  assert.deepEqual(H.segmentsInside(after, H.rectQuad(45, 45, 75, 75)), []);
  // The form drawn at the origin is partly in the area? No: 10..40 — untouched.
  const doc = await PDFDocument.load(bytes);
  const xo = doc.getPage(0).node.Resources().lookup(PDFName.of('XObject'), PDFDict);
  assert.deepEqual(xo.keys().map((k) => k.decodeText()), ['F']);
  // No overlay without a fill colour.
  assert.ok(!(await H.contentOf(bytes)).includes('OPSRedact'));
});

test('a shading is not painted inside the area; a clipped fill is cut but its clip kept', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  const sh = pdf.context.obj({ ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: [0, 0, 200, 0], Function: pdf.context.obj({ FunctionType: 2, Domain: [0, 1], C0: [1, 0, 0], C1: [0, 0, 1], N: 1 }) });
  page.node.set(PDFName.of('Resources'), pdf.context.obj({ Shading: pdf.context.obj({ S1: sh }) }));
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.stream('q 0 0 200 100 re W n /S1 sh Q q 0 100 200 100 re W n 0 1 0 rg 0 100 200 100 re f Q')));
  const src = await pdf.save();
  const { bytes } = await redactPdfBytes(src, [{ pageIndex: 0, quad: H.rectQuad(80, 60, 120, 140), fill: null }]);
  const r = H.render(bytes, 0, 1);
  const at = (x, y) => { const k = ((200 - y) * r.w + x) * r.n; return [r.px[k], r.px[k + 1], r.px[k + 2]]; };
  assert.deepEqual(at(100, 80), [255, 255, 255], 'shading not painted in the area');
  assert.deepEqual(at(100, 120), [255, 255, 255], 'fill cut in the area');
  assert.ok(at(40, 50)[0] > 100, 'shading kept outside');
  assert.deepEqual(at(40, 150), [0, 255, 0], 'fill kept outside');
  const content = await H.contentOf(bytes);
  assert.ok(content.includes('W n') || content.includes('W\nn'), 'clip kept');
});

void PDFString;
