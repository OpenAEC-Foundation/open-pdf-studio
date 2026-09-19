// Gedraaide rechthoek, cirkel/ellips en parametrisch symbool: maat en positie
// blijven gelijk over meerdere opslaan-en-heropenen-rondgangen.
//
// De keten volgt de saver (/Rect = omhullende, /OPS_Rotation, appearance via
// generateAppearanceStream), schrijft echte PDF-bytes, leest ze terug met
// extractAnnotationColors en herstelt de maat zoals annotation-converter.js.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';

import { maatVanGedraaideVorm, omhullendeMaat } from './gedraaide-vorm-maat.js';
import { extractAnnotationColors } from './color-extraction.js';
import { generateAppearanceStream } from '../saver/utils.js';

const PAGINA_B = 842;
const PAGINA_H = 595;
const TOL = 0.01;

const bijna = (a, b, msg) => assert.ok(Math.abs(a - b) <= TOL, `${msg}: ${a} ≠ ${b}`);

// Weergave ↔ PDF voor /Rotate 0 en 90 (schaal 1), gelijk aan de saver-remap
// en de viewport van de lezer.
function naarPdf(paginaRotatie, vx, vy) {
  return paginaRotatie === 90 ? { x: vy, y: vx } : { x: vx, y: PAGINA_H - vy };
}
function naarWeergave(paginaRotatie, px, py) {
  return paginaRotatie === 90 ? { x: py, y: px } : { x: px, y: PAGINA_H - py };
}

/** Eén annotatie opslaan zoals de saver het doet; geeft PDF-bytes. */
async function slaOp(ann, paginaRotatie, { metOpsMaat = false } = {}) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([PAGINA_B, PAGINA_H]);
  if (paginaRotatie) pagina.node.set(PDFName.of('Rotate'), doc.context.obj(paginaRotatie));
  const context = doc.context;

  // Saver: model naar PDF-ruimte (op een 90°-blad wisselen breedte en hoogte).
  const a = naarPdf(paginaRotatie, ann.x, ann.y);
  const b = naarPdf(paginaRotatie, ann.x + ann.width, ann.y + ann.height);
  const pdfAnn = {
    ...ann,
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const o = ann.rotation
    ? omhullendeMaat(pdfAnn.width, pdfAnn.height, ann.rotation)
    : { width: pdfAnn.width, height: pdfAnn.height };
  const dict = {
    Type: 'Annot',
    Subtype: ann.type === 'circle' ? 'Circle' : 'Square',
    Rect: [cx - o.width / 2, cy - o.height / 2, cx + o.width / 2, cy + o.height / 2],
    C: [0, 0, 0],
  };
  if (ann.rotation) dict.OPS_Rotation = ann.rotation;
  if (metOpsMaat && ann.rotation) dict.OPS_Maat = [pdfAnn.width, pdfAnn.height];
  const annotDict = context.obj(dict);
  if (ann.type === 'parametricSymbol') {
    // Raster-appearance op de omhullende (geen vormmaat in de /BBox).
    const ap = context.stream('q Q', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, o.width, o.height] });
    annotDict.set(PDFName.of('AP'), context.obj({ N: context.register(ap) }));
  } else {
    const ap = generateAppearanceStream(context, pdfAnn, (y) => y);
    annotDict.set(PDFName.of('AP'), context.obj({ N: context.register(ap) }));
  }
  pagina.node.set(PDFName.of('Annots'), context.obj([context.register(annotDict)]));
  return doc.save();
}

/** Heropenen zoals loader + annotation-converter. `oud` = gedrag vóór de fix. */
async function laad(bytes, ann, paginaRotatie, { oud = false } = {}) {
  const doc = await PDFDocument.load(bytes);
  const kaart = await extractAnnotationColors(1, doc);
  assert.equal(kaart.size, 1);
  const [sleutel, extra] = [...kaart.entries()][0];
  const r = sleutel.split(',').map(Number);
  const p1 = naarWeergave(paginaRotatie, r[0], r[1]);
  const p2 = naarWeergave(paginaRotatie, r[2], r[3]);
  const omhullende = {
    x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y),
    width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y),
  };
  const rotatie = extra.rotation || 0;
  if (oud || !rotatie) return { ...ann, ...omhullende, rotation: rotatie };
  const m = maatVanGedraaideVorm({
    rotatie,
    omhullende,
    kandidaten: [
      extra.opsMaat || null,
      (extra.bboxWidth && extra.bboxHeight) ? { width: extra.bboxWidth, height: extra.bboxHeight } : null,
    ],
    paginaRotatie,
  });
  return { ...ann, x: m.x, y: m.y, width: m.width, height: m.height, rotation: rotatie };
}

async function rondgangen(ann, paginaRotatie, n, opties = {}) {
  const uit = [];
  let huidig = ann;
  for (let i = 0; i < n; i++) {
    const bytes = await slaOp(huidig, paginaRotatie, opties);
    huidig = await laad(bytes, huidig, paginaRotatie, opties);
    uit.push(huidig);
  }
  return uit;
}

function zelfdeMaat(terug, ann, label) {
  bijna(terug.width, ann.width, `${label} breedte`);
  bijna(terug.height, ann.height, `${label} hoogte`);
  bijna(terug.x + terug.width / 2, ann.x + ann.width / 2, `${label} middelpunt x`);
  bijna(terug.y + terug.height / 2, ann.y + ann.height / 2, `${label} middelpunt y`);
  assert.equal(terug.rotation, ann.rotation, `${label} rotatie`);
}

const HOEKEN = [0, 30, 90, 135, -45, 17.5];
const VORMEN = [
  { type: 'circle', x: 200, y: 150, width: 280, height: 110 },
  { type: 'circle', x: 300, y: 200, width: 120, height: 120 },
  { type: 'box', x: 180, y: 120, width: 240, height: 90 },
];

for (const paginaRotatie of [0, 90]) {
  for (const vorm of VORMEN) {
    for (const rotation of HOEKEN) {
      const label = `${vorm.type} ${vorm.width}×${vorm.height} @${rotation}° blad ${paginaRotatie}°`;
      test(`rondgang: ${label} houdt maat en positie over 3 rondgangen`, async () => {
        const ann = { ...vorm, rotation, strokeColor: '#000000', lineWidth: 2 };
        const uit = await rondgangen(ann, paginaRotatie, 3);
        uit.forEach((terug, i) => zelfdeMaat(terug, ann, `${label} rondgang ${i + 1}`));
      });
    }
  }
}

test('reproductie: vóór de fix groeide een gedraaide ellips bij elke rondgang', async () => {
  const ann = { type: 'circle', x: 200, y: 150, width: 280, height: 110, rotation: 30, strokeColor: '#000000' };
  const uit = await rondgangen(ann, 0, 3, { oud: true });
  assert.ok(uit[0].width > 297 && uit[0].height > 235, `rondgang 1: ${uit[0].width}×${uit[0].height}`);
  assert.ok(uit[1].width > uit[0].width && uit[2].width > uit[1].width, 'groeit verder');
});

test('oud bestand: één keer opgeslagen met de foute versie wordt exact hersteld', async () => {
  // De foute versie schreef de /BBox nog met de echte maat; alleen het
  // inlezen ging mis. Zo'n bestand is dus volledig terug te lezen.
  const ann = { type: 'circle', x: 200, y: 150, width: 280, height: 110, rotation: 30, strokeColor: '#000000' };
  const bytes = await slaOp(ann, 0);
  const terug = await laad(bytes, ann, 0);
  zelfdeMaat(terug, ann, 'hersteld');
});

test('oud bestand: al opgeblazen door een foute rondgang groeit niet verder', async () => {
  const ann = { type: 'box', x: 200, y: 150, width: 280, height: 110, rotation: 30, strokeColor: '#000000' };
  // Foute rondgang: opgeslagen, verkeerd ingelezen (omhullende als maat).
  const opgeblazen = (await rondgangen(ann, 0, 1, { oud: true }))[0];
  const uit = await rondgangen(opgeblazen, 0, 3);
  uit.forEach((terug, i) => zelfdeMaat(terug, opgeblazen, `stabiel rondgang ${i + 1}`));
});

for (const rotation of [30, 90, 135]) {
  test(`parametrisch symbool @${rotation}°: OPS_Maat houdt de maat vast`, async () => {
    const ann = { type: 'parametricSymbol', x: 100, y: 100, width: 200, height: 60, rotation };
    const uit = await rondgangen(ann, 0, 3, { metOpsMaat: true });
    uit.forEach((terug, i) => zelfdeMaat(terug, ann, `symbool rondgang ${i + 1}`));
  });
}

test('parametrisch symbool zonder OPS_Maat (oud bestand) @30°: terugrekenen is exact', async () => {
  const ann = { type: 'parametricSymbol', x: 100, y: 100, width: 200, height: 60, rotation: 30 };
  const uit = await rondgangen(ann, 0, 3);
  uit.forEach((terug, i) => zelfdeMaat(terug, ann, `rondgang ${i + 1}`));
});

test('parametrisch symbool zonder OPS_Maat @45°: geen groei', async () => {
  const ann = { type: 'parametricSymbol', x: 100, y: 100, width: 200, height: 60, rotation: 45 };
  const uit = await rondgangen(ann, 0, 3);
  const o = omhullendeMaat(200, 60, 45);
  for (const terug of uit) assert.ok(terug.width <= o.width + TOL && terug.height <= o.height + TOL);
  bijna(uit[2].width, uit[1].width, 'stabiel breedte');
  bijna(uit[2].height, uit[1].height, 'stabiel hoogte');
});

// ── maatVanGedraaideVorm (puur) ─────────────────────────────────────────────

test('zonder rotatie is de omhullende de maat', () => {
  const o = { x: 10, y: 20, width: 100, height: 50 };
  assert.deepEqual(maatVanGedraaideVorm({ rotatie: 0, omhullende: o, kandidaten: [{ width: 5, height: 5 }] }),
    { ...o, bron: 'omhullende' });
  assert.equal(maatVanGedraaideVorm({ rotatie: 180, omhullende: o }).width, 100);
});

test('een /BBox gelijk aan /Rect geldt niet als vormmaat', () => {
  const o = { x: 0, y: 0, ...omhullendeMaat(100, 40, 30) };
  const m = maatVanGedraaideVorm({ rotatie: 30, omhullende: o, kandidaten: [{ width: o.width, height: o.height }] });
  assert.equal(m.bron, 'terugrekening');
  bijna(m.width, 100, 'breedte');
  bijna(m.height, 40, 'hoogte');
});

test('90°: breedte en hoogte liggen in de omhullende andersom', () => {
  const m = maatVanGedraaideVorm({ rotatie: 90, omhullende: { x: 0, y: 0, width: 40, height: 100 } });
  bijna(m.width, 100, 'breedte');
  bijna(m.height, 40, 'hoogte');
});
