// Opslag-rondgang van gedraaide markeringen (#944, #927).
//
// Een gedraaide vlakmarkering en een tekstmarkering met schuine quads worden
// opgeslagen zoals saver.js dat doet (buildTextMarkupDict met de NIET
// omgerekende annotatie), teruggelezen met pdf.js + extractAnnotationColors en
// omgezet zoals annotation-converter.js (gedraaideMarkeringUitBestand). De
// vlakmarkering moet hetzelfde vak en dezelfde draaiing terugkrijgen, de
// tekstmarkering dezelfde quads; op elke /Rotate en met een verschoven
// CropBox. Alles blijft in het geheugen.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, degrees } from 'pdf-lib';

import { makePointMapper, addLoadedMarkupKeys } from './saver/correction-dicts.js';
import { buildTextMarkupDict } from './saver/text-markup-dict.js';
import { zetDoorzichtigheidInAp } from './saver/utils.js';
import { extractAnnotationColors } from './loader/color-extraction.js';
import { extraVoorAnnotatie } from './loader/extra-sleutel.js';
import { vlakQuad, gedraaideMarkeringUitBestand } from '../annotations/markering-quads.js';

const PAGINAS = [
  { rotate: 0, cropBox: { x: 0, y: 0, width: 612, height: 792 } },
  { rotate: 90, cropBox: { x: 36, y: 48, width: 540, height: 720 } },
  { rotate: 180, cropBox: { x: 20, y: 30, width: 560, height: 700 } },
  { rotate: 270, cropBox: { x: 0, y: 0, width: 612, height: 792 } },
];

const dichtbij = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

const SCHUIN = [
  vlakQuad({ x: 100, y: 200, width: 80, height: 12, rotation: 30 }),
  vlakQuad({ x: 190, y: 250, width: 40, height: 12, rotation: 30 }),
];

function modellen() {
  return [
    { id: 'vlak40', nm: 'vlak40', type: 'highlight', page: 1, x: 150, y: 300, width: 160, height: 40, rotation: 40, color: '#FFFF00', opacity: 0.3 },
    { id: 'vlak90', nm: 'vlak90', type: 'highlight', page: 1, x: 120, y: 450, width: 100, height: 20, rotation: 90, color: '#00FF00', opacity: 0.3 },
    { id: 'recht', nm: 'recht', type: 'highlight', page: 1, x: 300, y: 500, width: 80, height: 30, color: '#FFFF00', opacity: 0.3 },
    {
      id: 'tekst', nm: 'tekst', type: 'textHighlight', page: 1, quads: SCHUIN,
      rects: [{ x: 0, y: 0, width: 1, height: 1 }], x: 0, y: 0, width: 1, height: 1, color: '#FFEE00', opacity: 0.4,
    },
  ];
}

async function rondgang({ rotate, cropBox }) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([612, 792]);
  pagina.setRotation(degrees(rotate));
  pagina.setCropBox(cropBox.x, cropBox.y, cropBox.width, cropBox.height);
  const map = makePointMapper(rotate, pagina.getCropBox());
  const anns = modellen();
  const dicts = anns.map((ann) => {
    const d = buildTextMarkupDict(doc.context, ann, map, { opacity: ann.opacity, pageRot: rotate });
    addLoadedMarkupKeys(d, ann);
    zetDoorzichtigheidInAp(doc.context, d, ann.opacity);
    return d;
  });
  pagina.node.set(PDFName.of('Annots'), doc.context.obj(dicts.map((d) => doc.context.register(d))));
  const bytes = await doc.save();

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const lezer = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pdfPagina = await lezer.getPage(1);
  const viewport = pdfPagina.getViewport({ scale: 1 });
  const kaart = await extractAnnotationColors(1, await PDFDocument.load(bytes));
  const convertPoint = (x, y) => viewport.convertToViewportPoint(x, y);
  const terug = new Map();
  for (const annot of await pdfPagina.getAnnotations()) {
    const extra = extraVoorAnnotatie(kaart, annot) || {};
    terug.set(extra.nm, {
      annot, extra,
      gedraaid: gedraaideMarkeringUitBestand({
        subtype: annot.subtype, rawQuadPoints: extra.rawQuadPoints, rotatie: extra.rotation, convertPoint,
      }),
    });
  }
  return { anns, dicts, terug, ctx: doc.context };
}

test('een gedraaide vlakmarkering komt terug met hetzelfde vak en dezelfde draaiing (#944)', async () => {
  for (const instelling of PAGINAS) {
    const { anns, terug } = await rondgang(instelling);
    for (const ann of anns.filter((a) => a.type === 'highlight' && a.rotation)) {
      const label = `${ann.nm} op /Rotate ${instelling.rotate}`;
      const t = terug.get(ann.nm);
      assert.ok(t, `${label}: teruggelezen`);
      assert.equal(t.extra.rotation, ann.rotation, `${label}: /OPS_Rotation`);
      const vlak = t.gedraaid?.vlak;
      assert.ok(vlak, `${label}: een vlak, geen tekstmarkering`);
      assert.equal(vlak.rotation, ann.rotation, `${label}: draaiing`);
      for (const k of ['x', 'y', 'width', 'height']) dichtbij(vlak[k], ann[k], 1e-3, `${label}: ${k}`);
    }
  }
});

test('pdf.js geeft de quads als rechte vakken; de eigen /QuadPoints houden de draaiing (#944)', async () => {
  const { anns, terug } = await rondgang(PAGINAS[0]);
  const ann = anns.find((a) => a.nm === 'vlak40');
  const { annot, extra } = terug.get('vlak40');
  const q = Array.from(annot.quadPoints);
  // Het vak van pdf.js: assen-uitgelijnd, dus groter dan de markering.
  const xs = [q[0], q[2], q[4], q[6]];
  assert.equal(new Set(xs.map((v) => v.toFixed(3))).size, 2, 'pdf.js: twee x-waarden, een recht vak');
  assert.notDeepEqual(extra.rawQuadPoints.slice(0, 8).map((v) => v.toFixed(3)), q.slice(0, 8).map((v) => v.toFixed(3)));
  // /Rect is de omhullende van de gedraaide quad.
  const hoeken = vlakQuad(ann);
  const breed = Math.max(...hoeken.map((p) => p.x)) - Math.min(...hoeken.map((p) => p.x));
  dichtbij(annot.rect[2] - annot.rect[0], breed, 1e-3, '/Rect-breedte = omhullende');
});

test('een rechte vlakmarkering blijft zoals ze was: geen /OPS_Rotation, rechte quad (#944)', async () => {
  for (const instelling of PAGINAS) {
    const { anns, dicts, terug } = await rondgang(instelling);
    const i = anns.findIndex((a) => a.nm === 'recht');
    assert.equal(dicts[i].get(PDFName.of('OPS_Rotation')), undefined, `/Rotate ${instelling.rotate}`);
    assert.equal(terug.get('recht').gedraaid, null, `/Rotate ${instelling.rotate}: de lader houdt de vakken`);
  }
});

test('een markering op schuine tekst komt terug met dezelfde quads (#927)', async () => {
  for (const instelling of PAGINAS) {
    const { dicts, anns, terug, ctx } = await rondgang(instelling);
    const label = `/Rotate ${instelling.rotate}`;
    const t = terug.get('tekst');
    assert.equal(t.gedraaid?.vlak, undefined, `${label}: geen vlak`);
    const quads = t.gedraaid?.quads;
    assert.equal(quads?.length, SCHUIN.length, `${label}: alle quads`);
    quads.forEach((q, i) => q.forEach((p, k) => {
      dichtbij(p.x, SCHUIN[i][k].x, 1e-3, `${label}: quad ${i} punt ${k} x`);
      dichtbij(p.y, SCHUIN[i][k].y, 1e-3, `${label}: quad ${i} punt ${k} y`);
    }));
    // De /AP vult precies de quads (vier hoeken per vlak).
    const d = dicts[anns.findIndex((a) => a.nm === 'tekst')];
    const n = ctx.lookup(d.lookup(PDFName.of('AP')).get(PDFName.of('N')));
    const tekst = Buffer.from(n instanceof PDFRawStream ? decodePDFRawStream(n).decode() : n.getContents()).toString('latin1');
    assert.equal((tekst.match(/ m /g) || []).length, SCHUIN.length, `${label}: één vlak per quad`);
    assert.equal((tekst.match(/ l /g) || []).length, 3 * SCHUIN.length, `${label}: vier hoeken per vlak`);
  }
});

// annotation-converter.js, rendering.js en transforms.js zijn in node niet te
// laden; deze controle leest de bron, zoals correction-wiring.test.mjs.
test('de lader, de weergave en het verplaatsen gebruiken de gedraaide quads', async () => {
  const { readFileSync } = await import('node:fs');
  const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const lader = bron('./loader/annotation-converter.js');
  assert.match(lader, /gedraaideMarkeringUitBestand\(\{\s*subtype: annot\.subtype, rawQuadPoints: extraColors\.rawQuadPoints,\s*rotatie: extraColors\.rotation, convertPoint,/);
  assert.match(lader, /if \(gedraaid\?\.vlak\) \{[\s\S]{0,200}type: 'highlight',[\s\S]{0,40}\.\.\.gedraaid\.vlak,/);
  assert.match(lader, /\.\.\.\(gedraaid\?\.quads \? \{ quads: gedraaid\.quads \} : \{\}\)/);
  const weergave = bron('../annotations/rendering.js');
  assert.match(weergave, /case 'highlight':[\s\S]{0,600}ctx\.rotate\(annotation\.rotation \* Math\.PI \/ 180\)/);
  assert.match(weergave, /case 'textHighlight':[\s\S]{0,600}Array\.isArray\(annotation\.quads\)/);
  const transforms = bron('../annotations/transforms.js');
  assert.match(transforms, /annotation\.quads = annotation\.quads\.map\(q => Array\.isArray\(q\) \? q\.map\(p => _movePoint\(p, dx, dy\)\) : q\)/);
});
