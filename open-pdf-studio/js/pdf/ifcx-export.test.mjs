// PDF to IFCX (#876, beta): structure of the document and the mapping of
// sheets, vectors, text, images, PDF layers and annotations, on PDFs that are
// generated here with pdf-lib.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFOperator, StandardFonts, rgb, degrees, PDFArray } from 'pdf-lib';

import { bouwIfcx, valideerIfcx, IfcxSchrijver, PT_M, SCHEMAS, IMPORTS, padMaker, waarschuwingTeksten } from './ifcx-document.js';
import { leesPaginaInhoud, bladKader } from './ifcx-inhoud.js';
import { maakPng, zetAfbeeldingOm, ontPredictor } from './ifcx-afbeelding.js';
import { leesIfcxOpdracht, ifcxUitkomst } from './ifcx-opdracht.js';
import { ifcEntityFor } from './ifc-entity.js';

const lees = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const bijna = (a, b, eps = 1e-5, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≉ ${b}`);
const m = (pt) => pt * PT_M;

/** Index of the parsed document: nodes by path, plus helpers. */
function index(doc) {
  const knopen = new Map(doc.data.map((n) => [n.path, n]));
  const wortel = doc.data.find((n) => n.attributes?.['opds::pdf::document']);
  const bladen = Object.values(wortel.children).map((p) => knopen.get(p));
  const kind = (n, naam) => knopen.get(n?.children?.[naam]);
  const kinderen = (n) => Object.values(n?.children || {}).map((p) => knopen.get(p));
  // A node's attributes including what it inherits (one level, as written).
  const attr = (n) => {
    const uit = {};
    for (const p of Object.values(n.inherits || {})) Object.assign(uit, knopen.get(p).attributes);
    return { ...uit, ...n.attributes };
  };
  // All leaves below a node (through PDF-layer groups).
  const bladeren = (n) => kinderen(n).flatMap((k) => (k.children ? bladeren(k) : [k]));
  return { knopen, wortel, bladen, kind, kinderen, attr, bladeren };
}

async function testPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const p1 = pdf.addPage([400, 300]);
  p1.drawLine({ start: { x: 10, y: 20 }, end: { x: 110, y: 20 }, thickness: 2, color: rgb(1, 0, 0) });
  p1.drawRectangle({ x: 50, y: 50, width: 100, height: 40, color: rgb(0, 0, 1) });
  p1.drawSvgPath('M 0 0 C 10 -10 20 -10 30 0', { x: 200, y: 200, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  p1.drawText('Hello IFCX', { x: 20, y: 250, size: 12, font });
  // A 2x2 RGB image, placed 40 x 20 pt at (300, 100).
  const png = await maakPng({ breedte: 2, hoogte: 2, bpc: 8, kleurType: 2, rijen: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]) });
  const img = await pdf.embedPng(png);
  p1.drawImage(img, { x: 300, y: 100, width: 40, height: 20 });
  const p2 = pdf.addPage([300, 200]);
  p2.setRotation(degrees(90));
  p2.drawText('Turned', { x: 10, y: 10, size: 10, font });
  p2.drawImage(img, { x: 0, y: 0, width: 10, height: 10 });
  return PDFDocument.load(await pdf.save());
}

async function bouw(pdf, o = {}) {
  const { tekst, verslag } = await bouwIfcx(pdf, { zaad: 'abcdef', tijd: '2026-10-31T12:00:00.000Z', bron: 'test.pdf', ...o });
  return { tekst, verslag, doc: JSON.parse(tekst) };
}

test('the output is well-formed IFCX: header, imports, unique paths, children and inherits resolve', async () => {
  const { doc } = await bouw(await testPdf(), {
    annotaties: [{ id: 'a1', type: 'box', page: 1, x: 10, y: 10, width: 20, height: 10 }],
  });
  assert.deepEqual(valideerIfcx(doc), []);
  assert.equal(doc.header.ifcxVersion, 'ifcx_alpha');
  for (const k of ['id', 'dataVersion', 'author', 'timestamp']) assert.ok(doc.header[k], k);
  assert.deepEqual(doc.imports.map((i) => i.uri), [...IMPORTS]);
  for (const naam of Object.keys(SCHEMAS)) assert.ok(doc.schemas[naam]?.value, naam);
  const paden = doc.data.map((n) => n.path);
  assert.equal(new Set(paden).size, paden.length, 'unique paths');
  for (const p of paden) assert.match(p, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  // The root is the one node no one points to that has children.
  const aangewezen = new Set(doc.data.flatMap((n) => Object.values(n.children || {})));
  const wortels = doc.data.filter((n) => n.children && !aangewezen.has(n.path));
  assert.equal(wortels.length, 1);
  assert.equal(wortels[0].attributes['bsi::ifc::class'].code, 'IfcProject');
});

test('the validator catches broken structure', () => {
  const goed = { header: { id: 'x', ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: 'a', timestamp: 't' }, imports: [], schemas: {}, data: [{ path: 'a' }] };
  assert.deepEqual(valideerIfcx(goed), []);
  assert.ok(valideerIfcx({ ...goed, header: {} }).some((f) => f.includes('header.id')));
  assert.ok(valideerIfcx({ ...goed, data: [{ path: 'a' }, { path: 'a' }] }).some((f) => f.includes('duplicate')));
  assert.ok(valideerIfcx({ ...goed, data: [{ path: 'a', children: { b: 'zz' } }] }).some((f) => f.includes('does not resolve')));
  assert.ok(valideerIfcx({ ...goed, data: [{ path: 'a', children: { b: 'b' } }, { path: 'b', children: { a: 'a' } }] }).some((f) => f.includes('cycle')));
  assert.ok(valideerIfcx({ ...goed, data: [{ path: 'a', attributes: { 'x::y': 1 } }] }).some((f) => f.includes('no schema')));
  const metSchema = { ...goed, schemas: { 'opds::pdf::layer': { value: SCHEMAS['opds::pdf::layer'] } } };
  assert.ok(valideerIfcx({ ...metSchema, data: [{ path: 'a', attributes: { 'opds::pdf::layer': { kind: 1, name: 'n', source: 's' } } }] }).some((f) => f.includes('not a string')));
});

test('one sheet per page with size, label, rotation and scale; the scale goes into the sheet transform', async () => {
  const { doc } = await bouw(await testPdf(), {
    labels: ['A-101', null],
    schaalVoor: (nr) => (nr === 1 ? 100 : null),
  });
  const { bladen } = index(doc);
  assert.equal(bladen.length, 2);
  const [s1, s2] = bladen.map((b) => b.attributes['opds::pdf::sheet']);
  assert.equal(s1.pageNumber, 1);
  assert.equal(s1.label, 'A-101');
  assert.equal(s1.widthPt, 400);
  assert.equal(s1.heightPt, 300);
  assert.equal(s1.rotation, 0);
  assert.equal(s1.scaleDenominator, 100);
  assert.equal(s1.scale, '1:100');
  const t1 = bladen[0].attributes['usd::xformop'].transform;
  assert.deepEqual([t1[0][0], t1[1][1], t1[2][2]], [100, 100, 100], 'scale 1:100 applied');
  // A 100 pt line at 1:100 is 100 * 100 pt in the composed model.
  bijna(m(100) * t1[0][0], 3.527778, 1e-5, 'real length in metres');
  // Page 2 is shown turned: its sheet size swaps, it has no scale and lies next to sheet 1.
  assert.equal(s2.rotation, 90);
  assert.equal(s2.widthPt, 200);
  assert.equal(s2.heightPt, 300);
  assert.equal(s2.scaleDenominator, undefined);
  const t2 = bladen[1].attributes['usd::xformop'].transform;
  assert.equal(t2[0][0], 1);
  assert.ok(t2[3][0] > m(400) * 100, 'sheet 2 is placed after the scaled sheet 1');
  assert.deepEqual(s2.origin, [t2[3][0], 0, 0]);
});

test('vector paths: lines and curves as polylines, fills as meshes, with colour and line width', async () => {
  const { doc } = await bouw(await testPdf());
  const { bladen, kind, bladeren, attr } = index(doc);
  const tekening = kind(bladen[0], 'drawing');
  assert.equal(tekening.attributes['opds::pdf::layer'].kind, 'drawing');
  const items = bladeren(tekening).map(attr);
  const lijnen = items.filter((a) => a['usd::usdgeom::basiscurves']);
  const vlakken = items.filter((a) => a['usd::usdgeom::mesh']);

  const rood = lijnen.find((a) => a['opds::pdf::style'].stroke?.join() === '1,0,0');
  assert.ok(rood, 'the red line');
  assert.deepEqual(rood['bsi::ifc::class'].code, 'IfcAnnotation');
  const [a, b] = rood['usd::usdgeom::basiscurves'].points;
  bijna(a[0], m(10)); bijna(a[1], m(20)); bijna(b[0], m(110)); bijna(b[1], m(20));
  bijna(rood['opds::pdf::style'].lineWidth, m(2));

  const blauw = vlakken.find((a) => a['opds::pdf::style'].fill?.join() === '0,0,1');
  assert.ok(blauw, 'the blue fill');
  const mesh = blauw['usd::usdgeom::mesh'];
  assert.deepEqual(mesh.faceVertexCounts, [4]);
  const xs = mesh.points.map((p) => p[0]); const ys = mesh.points.map((p) => p[1]);
  bijna(Math.min(...xs), m(50)); bijna(Math.max(...xs), m(150));
  bijna(Math.min(...ys), m(50)); bijna(Math.max(...ys), m(90));
  assert.equal(blauw['opds::pdf::style'].fillRule, 'nonzero');

  const boog = lijnen.find((l) => l['usd::usdgeom::basiscurves'].points.length > 4);
  assert.ok(boog, 'the curve is flattened into many points');
  const pts = boog['usd::usdgeom::basiscurves'].points;
  // drawSvgPath flips y: the curve runs from (200,200) to (230,200) and bulges upwards.
  bijna(pts[0][0], m(200)); bijna(pts.at(-1)[0], m(230));
  bijna(pts[0][1], m(200)); bijna(pts.at(-1)[1], m(200));
  assert.ok(Math.max(...pts.map((p) => p[1])) > m(205));
});

test('text runs: string, position on the sheet and font size; a turned page turns its text', async () => {
  const { doc } = await bouw(await testPdf());
  const { bladen, kind, bladeren, attr } = index(doc);
  const t1 = bladeren(kind(bladen[0], 'text')).map(attr);
  assert.equal(t1.length, 1);
  assert.equal(t1[0]['opds::pdf::text'].value, 'Hello IFCX');
  bijna(t1[0]['opds::pdf::text'].fontSize, m(12));
  assert.equal(t1[0]['opds::pdf::text'].font, 'Helvetica');
  const tr = t1[0]['usd::xformop'].transform;
  bijna(tr[3][0], m(20)); bijna(tr[3][1], m(250));

  const t2 = bladeren(kind(bladen[1], 'text')).map(attr);
  assert.equal(t2[0]['opds::pdf::text'].value, 'Turned');
  // /Rotate 90: user (10,10) lands at (10, 300 - 10) on the shown sheet and reads downwards.
  const tr2 = t2[0]['usd::xformop'].transform;
  bijna(tr2[3][0], m(10)); bijna(tr2[3][1], m(290));
  bijna(t2[0]['opds::pdf::text'].rotation, -90, 1e-6);
});

test('text can be left out', async () => {
  const { doc } = await bouw(await testPdf(), { opties: { tekst: false } });
  const { bladen, kind } = index(doc);
  assert.equal(kind(bladen[0], 'text'), undefined);
  assert.equal(doc.data.filter((n) => n.attributes?.['opds::pdf::text']).length, 0);
});

test('raster: an image is embedded once as PNG and placed per use with its matrix', async () => {
  const { doc } = await bouw(await testPdf());
  const { bladen, kind, bladeren, knopen } = index(doc);
  const r1 = bladeren(kind(bladen[0], 'raster'));
  const r2 = bladeren(kind(bladen[1], 'raster'));
  assert.equal(r1.length, 1);
  assert.equal(r2.length, 1);
  assert.equal(r1[0].inherits.image, r2[0].inherits.image, 'the same image data is shared');
  const bron = knopen.get(r1[0].inherits.image).attributes['opds::pdf::image'];
  assert.equal(bron.mimeType, 'image/png');
  assert.equal(bron.widthPx, 2);
  assert.equal(bron.heightPx, 2);
  const bytes = Buffer.from(bron.data, 'base64');
  assert.equal(bron.byteLength, bytes.length);
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const mat = r1[0].attributes['opds::pdf::placement'].matrix;
  bijna(mat[0], m(40)); bijna(mat[3], m(20)); bijna(mat[4], m(300)); bijna(mat[5], m(100));
  const quad = r1[0].attributes['usd::usdgeom::mesh'].points;
  bijna(quad[2][0], m(340)); bijna(quad[2][1], m(120));
  assert.equal(doc.data.filter((n) => n.attributes?.['opds::pdf::image']).length, 1);
});

test('raster can be left out, and a raster budget keeps the placement without the pixels', async () => {
  const zonder = await bouw(await testPdf(), { opties: { raster: false } });
  assert.equal(zonder.doc.data.filter((n) => n.attributes?.['opds::pdf::image']).length, 0);
  const krap = await bouw(await testPdf(), { opties: { maxRasterBytes: 10 } });
  const bron = krap.doc.data.find((n) => n.attributes?.['opds::pdf::image']).attributes['opds::pdf::image'];
  assert.equal(bron.data, undefined);
  assert.equal(bron.omitted, 'rasterBudget');
  assert.ok(krap.verslag.warnings.some((w) => w.code === 'image' && w.reason === 'rasterBudget'));
  assert.deepEqual(valideerIfcx(krap.doc), []);
});

test('image conversion: PNG rows survive, predictors are undone, JPEG passes through, CCITT keeps a reason', async () => {
  const rijen = new Uint8Array([0b10100000, 0b01010000]);
  const png = await maakPng({ breedte: 4, hoogte: 2, bpc: 1, kleurType: 0, rijen });
  const idat = png.indexOf(0x49, 33); // 'I' of IDAT after the IHDR
  const lengte = new DataView(png.buffer).getUint32(idat - 4);
  const ruw = inflateSync(Buffer.from(png.subarray(idat + 4, idat + 4 + lengte)));
  assert.deepEqual([...ruw], [0, 0b10100000, 0, 0b01010000]);
  // PNG "Up" predictor: row 2 adds row 1.
  assert.deepEqual([...ontPredictor(new Uint8Array([0, 5, 6, 2, 1, 1]), 2, 1, 8)], [5, 6, 6, 7]);

  const pdf = await PDFDocument.create();
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const ctx = pdf.context;
  const dct = ctx.stream(jpeg, { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' });
  const uitJpeg = await zetAfbeeldingOm(ctx, dct);
  assert.equal(uitJpeg.mimeType, 'image/jpeg');
  assert.deepEqual([...uitJpeg.bytes], [...jpeg]);
  const ccitt = ctx.stream(new Uint8Array([0]), { Type: 'XObject', Subtype: 'Image', Width: 8, Height: 1, BitsPerComponent: 1, Filter: 'CCITTFaxDecode' });
  const uitCcitt = await zetAfbeeldingOm(ctx, ccitt);
  assert.equal(uitCcitt.bytes, null);
  assert.equal(uitCcitt.reden, 'unsupportedFilter');
  const groot = ctx.stream(new Uint8Array([0]), { Type: 'XObject', Subtype: 'Image', Width: 100000, Height: 100000, ColorSpace: 'DeviceGray', BitsPerComponent: 8 });
  assert.equal((await zetAfbeeldingOm(ctx, groot)).reden, 'tooLarge');
});

test('annotations go to a layer of their own, with the IFC class of the existing mapping and measure values', async () => {
  const annotaties = [
    { id: 'w1', type: 'wall', page: 1, startX: 0, startY: 0, endX: 72, endY: 0, dikteMm: 200 },
    { id: 'm1', type: 'measureDistance', page: 1, startX: 10, startY: 100, endX: 82, endY: 100, measureValue: 2540, measureUnit: 'mm', measureText: '2540 mm' },
    { id: 'c1', type: 'comment', page: 1, x: 30, y: 40, text: 'Check this', author: 'Ann', replies: [{ id: 'r', author: 'Bob', text: 'OK', createdAt: '2026-10-01' }] },
    { id: 's1', type: 'stamp', page: 2, x: 5, y: 5, width: 50, height: 20, stampName: 'Approved' },
  ];
  const { doc } = await bouw(await testPdf(), { annotaties });
  const { bladen, kind, kinderen, attr, knopen } = index(doc);
  const laag1 = kind(bladen[0], 'annotations');
  assert.equal(laag1.attributes['opds::pdf::layer'].kind, 'annotations');
  const a1 = kinderen(laag1).map(attr);
  assert.equal(a1.length, 3);
  const muur = a1.find((a) => a['opds::pdf::annotation'].id === 'w1');
  assert.equal(muur['bsi::ifc::class'].code, ifcEntityFor(annotaties[0]).class);
  assert.equal(muur['bsi::ifc::class'].code, 'IfcWall');
  assert.equal(muur['opds::pdf::annotation'].properties.dikteMm, 200);
  // App coordinates are top-left: y 0 is the top of a 300 pt sheet.
  const [p, q] = muur['usd::usdgeom::basiscurves'].points;
  bijna(p[1], m(300)); bijna(q[0], m(72));
  const maat = a1.find((a) => a['opds::pdf::annotation'].id === 'm1')['opds::pdf::annotation'];
  assert.deepEqual(maat.measure, { value: 2540, unit: 'mm', text: '2540 mm' });
  const opmerking = a1.find((a) => a['opds::pdf::annotation'].id === 'c1');
  assert.equal(opmerking['opds::pdf::annotation'].text, 'Check this');
  assert.deepEqual(opmerking['opds::pdf::annotation'].replies, [{ author: 'Bob', text: 'OK', createdAt: '2026-10-01' }]);
  bijna(opmerking['usd::xformop'].transform[3][1], m(260));
  assert.equal(kinderen(kind(bladen[1], 'annotations')).length, 1);

  // Separate from the drawing: no annotation anywhere under the drawing, text or raster layers.
  for (const blad of bladen) {
    for (const naam of ['drawing', 'text', 'raster']) {
      const onder = (n) => [n, ...Object.values(n?.children || {}).flatMap((c) => onder(knopen.get(c)))];
      for (const n of onder(kind(blad, naam)).filter(Boolean)) assert.equal(n.attributes?.['opds::pdf::annotation'], undefined);
    }
  }
  assert.deepEqual(valideerIfcx(doc), []);
});

test('annotation layers of the app become groups with their visibility; the layer can be switched off', async () => {
  const annotatieLagen = [
    { id: 'default', name: '', visible: true },
    { id: 'l2', name: 'Structure', visible: false },
  ];
  const annotaties = [
    { id: 'a', type: 'line', page: 1, startX: 0, startY: 0, endX: 10, endY: 10 },
    { id: 'b', type: 'line', page: 1, startX: 0, startY: 0, endX: 10, endY: 10, layer: 'l2' },
  ];
  const { doc } = await bouw(await testPdf(), { annotaties, annotatieLagen });
  const { bladen, kind, kinderen } = index(doc);
  const groepen = kinderen(kind(bladen[0], 'annotations'));
  assert.equal(groepen.length, 2);
  const structuur = groepen.find((g) => g.attributes['opds::pdf::layer'].name === 'Structure');
  assert.deepEqual(structuur.attributes['usd::usdgeom::visibility'], { visibility: 'invisible' });
  assert.equal(kinderen(structuur)[0].attributes['opds::pdf::annotation'].layer, 'Structure');

  const uit = await bouw(await testPdf(), { annotaties, annotatieLagen, opties: { annotaties: false } });
  const u = index(uit.doc);
  assert.equal(u.kind(u.bladen[0], 'annotations'), undefined);
  assert.equal(uit.doc.data.filter((n) => n.attributes?.['opds::pdf::annotation']).length, 0);
});

test('PDF layers (optional content) become group nodes, hidden ones invisible', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  const ctx = pdf.context;
  const ocgAan = ctx.register(ctx.obj({ Type: 'OCG', Name: 'Walls' }));
  const ocgUit = ctx.register(ctx.obj({ Type: 'OCG', Name: 'Furniture' }));
  pdf.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: [ocgAan, ocgUit], D: { OFF: [ocgUit] } }));
  page.node.Resources().set(PDFName.of('Properties'), ctx.obj({ oc1: ocgAan, oc2: ocgUit }));
  const op = (naam, ...args) => PDFOperator.of(naam, args);
  page.pushOperators(
    op('BDC', PDFName.of('OC'), PDFName.of('oc1')), op('m', ctx.obj(0), ctx.obj(0)), op('l', ctx.obj(100), ctx.obj(0)), op('S'), op('EMC'),
    op('BDC', PDFName.of('OC'), PDFName.of('oc2')), op('m', ctx.obj(0), ctx.obj(50)), op('l', ctx.obj(100), ctx.obj(50)), op('S'), op('EMC'),
    op('m', ctx.obj(0), ctx.obj(90)), op('l', ctx.obj(100), ctx.obj(90)), op('S'),
  );
  const { doc } = await bouw(await PDFDocument.load(await pdf.save()));
  const { bladen, kind, kinderen } = index(doc);
  const groepen = kinderen(kind(bladen[0], 'drawing'));
  const naam = (g) => g.attributes['opds::pdf::layer'].name;
  assert.deepEqual(groepen.map(naam).sort(), ['', 'Furniture', 'Walls']);
  const meubels = groepen.find((g) => naam(g) === 'Furniture');
  assert.equal(meubels.attributes['opds::pdf::layer'].source, 'pdf-ocg');
  assert.deepEqual(meubels.attributes['usd::usdgeom::visibility'], { visibility: 'invisible' });
  assert.equal(groepen.find((g) => naam(g) === 'Walls').attributes['usd::usdgeom::visibility'], undefined);
  for (const g of groepen) assert.equal(kinderen(g).length, 1);
});

test('Form XObjects are followed with their matrix', async () => {
  const src = await PDFDocument.create();
  src.addPage([100, 100]).drawLine({ start: { x: 0, y: 0 }, end: { x: 50, y: 0 }, thickness: 1 });
  const pdf = await PDFDocument.create();
  const [vorm] = await pdf.embedPdf(await src.save());
  pdf.addPage([300, 300]).drawPage(vorm, { x: 100, y: 100, xScale: 2, yScale: 2 });
  const doel = await PDFDocument.load(await pdf.save());
  const inhoud = leesPaginaInhoud(doel, doel.getPage(0));
  const lijn = inhoud.paden.find((p) => p.stroke);
  const [a, b] = lijn.subpaden[0].punten;
  bijna(a[0], 100, 1e-6); bijna(a[1], 100, 1e-6); bijna(b[0], 200, 1e-6);
  bijna(lijn.lijnBreedte, 2, 1e-6);
});

test('a heavy page is capped: the first paths are kept, the rest is counted and reported', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 600]);
  for (let i = 0; i < 300; i++) page.drawLine({ start: { x: 0, y: i }, end: { x: 100, y: i }, thickness: 0.5 });
  const geladen = await PDFDocument.load(await pdf.save());
  const { doc, verslag } = await bouw(geladen, { opties: { limieten: { maxPaden: 100 } } });
  const { bladen, kind, bladeren } = index(doc);
  assert.equal(bladeren(kind(bladen[0], 'drawing')).length, 100);
  const blad = bladen[0].attributes['opds::pdf::sheet'];
  assert.deepEqual(blad.truncated, { paths: 300 });
  assert.equal(blad.counts.paths, 100);
  assert.deepEqual(verslag.warnings, [{ code: 'cap', page: 1, kind: 'paths', kept: 100, total: 300 }]);
  assert.deepEqual(valideerIfcx(doc), []);
  // The warning reaches the user as a sentence.
  const t = (k, o) => `${k}|${o.page}|${o.kept}|${o.total}`;
  assert.deepEqual(waarschuwingTeksten(t, verslag), ['ifcxExport.capPaths|1|100|300']);
  // Without the cap everything is there.
  const vol = await bouw(geladen);
  assert.equal(vol.verslag.warnings.length, 0);
  assert.equal(vol.verslag.counts.paths, 300);
});

test('pages are read one at a time and only the selected ones are exported', async () => {
  const pdf = await testPdf();
  const gezien = [];
  const { doc, verslag } = await bouw(pdf, { paginas: [2], voortgang: (k, t) => gezien.push([k, t]) });
  assert.deepEqual(verslag.pages, [2]);
  assert.deepEqual(gezien, [[1, 1]]);
  assert.deepEqual(doc.data.find((n) => n.attributes?.['opds::pdf::document']).attributes['opds::pdf::document'].exportedPages, [2]);
  const afgebroken = await bouwIfcx(pdf, { afgebroken: () => true });
  assert.equal(afgebroken.tekst, null);
  assert.equal(afgebroken.verslag.cancelled, true);
});

test('the sheet frame follows CropBox and /Rotate', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 300]);
  page.setCropBox(50, 20, 200, 100);
  page.setRotation(degrees(270));
  const k = bladKader(page);
  assert.deepEqual([k.breedte, k.hoogte, k.rotatie], [100, 200, 270]);
  assert.deepEqual(k.cropBox, [50, 20, 250, 120]);
});

test('node paths are unique UUIDs, also without a seed', () => {
  const maak = padMaker();
  const a = maak(), b = maak();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  const s = new IfcxSchrijver({ zaad: '1234' });
  assert.match(s.wortel, /^12340000-/);
});

test('MCP arguments are checked strictly and the answer lists counts and warnings', () => {
  assert.deepEqual(leesIfcxOpdracht({ path: '/tmp/a.ifcx' }), { ok: true, pad: '/tmp/a.ifcx', paginas: 'all', opties: { raster: true, tekst: true, annotaties: true } });
  const vol = leesIfcxOpdracht({ path: 'C:\\x\\b.IFCX', pages: '1-3', raster: false, text: false, annotations: false, maxPathsPerPage: 10 });
  assert.equal(vol.ok, true);
  assert.deepEqual(vol.opties, { raster: false, tekst: false, annotaties: false, limieten: { maxPaden: 10 } });
  assert.match(leesIfcxOpdracht({ path: '/tmp/a.ifcx', foo: 1 }).error, /unknown argument: foo/);
  assert.match(leesIfcxOpdracht({ path: '/tmp/a.dxf' }).error, /\.ifcx/);
  assert.match(leesIfcxOpdracht({ path: 'rel/a.ifcx' }).error, /absolute/);
  assert.match(leesIfcxOpdracht({ path: '/tmp/a.ifcx', raster: 'yes' }).error, /raster/);
  assert.match(leesIfcxOpdracht({ path: '/tmp/a.ifcx', maxPathsPerPage: 0 }).error, /maxPathsPerPage/);
  assert.match(leesIfcxOpdracht([]).error, /object/);
  const uit = ifcxUitkomst({ pad: '/tmp/a.ifcx' }, {
    bytes: 1234,
    verslag: { pages: [1], counts: { sheets: 1 }, warnings: [{ code: 'cap', page: 1, kind: 'paths', kept: 5, total: 9 }, { code: 'image', reason: 'tooLarge' }] },
  }, ['unsaved']);
  assert.equal(uit.ok, true);
  assert.equal(uit.beta, true);
  assert.equal(uit.bytes, 1234);
  assert.equal(uit.warnings.length, 3);
  assert.match(uit.warnings[1], /page 1: 5 of 9 paths/);
});

test('the existing .ifcreport export is unchanged', () => {
  const bron = lees('./ifc-export.js');
  assert.match(bron, /format: 'ifcx-report'/);
  assert.match(bron, /extensions: \['ifcreport'\]/);
  assert.match(bron, /\.replace\(\/\\\.pdf\$\/i, ''\) \+ '\.ifcreport'/);
  assert.doesNotMatch(bron, /ifcx-document|ifcx-export|ifcx-inhoud/);
  // The entity mapping the report uses still gives the same shape.
  const e = ifcEntityFor({ id: 'w', type: 'wall', page: 2, startX: 1, startY: 2, endX: 3, endY: 4, dikteMm: 150, strokeColor: '#ff0000', lineWidth: 2 });
  assert.deepEqual(e, {
    id: 'w', class: 'IfcWall', page: 2, name: null,
    geometry: { startX: 1, startY: 2, endX: 3, endY: 4 },
    style: { color: '#ff0000', lineWidth: 2, hatchPattern: null },
    properties: { dikteMm: 150, materiaal: null },
    createdAt: null, modifiedAt: null,
  });
  // The ribbon button still exports the report.
  assert.match(lees('../solid/components/ribbon/HomeTab.jsx'), /exportIfcReport\(\)/);
});

test('the export is wired: menu card, dialog, MCP bridge, Rust server and tool catalogue', () => {
  const paneel = lees('../solid/components/app-menu/ExportPanel.jsx');
  assert.match(paneel, /openDialog\('ifcx-export'\)/);
  assert.match(paneel, /t\('exportPanel\.exportIfcx'\)/);
  assert.match(lees('../solid/components/DialogHost.jsx'), /'ifcx-export': IfcxExportDialog/);
  const venster = lees('../solid/components/dialogs/IfcxExportDialog.jsx');
  assert.match(venster, /kiesIfcxDoel\(doc\)/);
  assert.match(venster, /exporteerIfcx\(doc,/);
  assert.match(lees('../mcp-bridge.js'), /'mcp:export-ifcx':\s+handleExportIfcx/);
  const rs = lees('../../src-tauri/src/mcp_server.rs');
  assert.match(rs, /"app_export_ifcx"\s+=> tool_app_request\(state, "mcp:export-ifcx",\s+&arguments, Duration::from_secs\(300\)\)/);
  assert.match(lees('../../src-tauri/src/mcp_tool_meta.rs'), /wijzigt\("app_export_ifcx", "Export to IFCX \(beta\)"\)/);
  const tools = JSON.parse(lees('../../../mcp-stdio/tools.json'));
  const tool = tools.find((t) => t.name === 'app_export_ifcx');
  assert.ok(tool, 'in tools.json');
  assert.deepEqual(tool.inputSchema.required, ['path']);
  assert.equal(tool.annotations.destructiveHint, true);
  assert.equal(tools[tools.findIndex((t) => t.name === 'app_export_cad') + 1].name, 'app_export_ifcx');
  assert.ok(JSON.parse(lees('../../../mcpb/manifest.json')).tools.some((t) => t.name === 'app_export_ifcx'));
});

test('the design document exists and names what the beta covers', () => {
  const doc = lees('../../../docs/ifcx-export.md');
  for (const kop of ['Document structure', 'Sheets', 'Vector data', 'Text', 'Raster', 'Annotations', 'Coordinates and units', 'Lossy', 'Open questions']) {
    assert.match(doc, new RegExp(`^#+ .*${kop}`, 'm'), kop);
  }
  for (const naam of Object.keys(SCHEMAS)) assert.ok(doc.includes(naam), naam);
});
