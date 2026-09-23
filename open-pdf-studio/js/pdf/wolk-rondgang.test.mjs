// Een wolk houdt zijn maat over opslaan → heropenen (#434).
//
// Een rechthoekige wolk staat in het model als vak (x/y/breedte/hoogte) en
// heeft geen eigen punten. De opslag viel daardoor terug op de tak voor een
// gewone veelhoek en schreef de hoekpunten van de INGESCHREVEN regelmatige
// zeshoek als /Vertices. De lader neemt de omhullende van /Vertices als nieuw
// vak, en die omhullende is cos(30°) = 86,6 % van de breedte: elke rondgang
// maakte de wolk 13,4 % smaller.
//
// De test schrijft echte PDF-bytes met de regel van de opslag
// (saver/veelhoek-grondvorm.js), leest ze terug met de lezer zoals
// js/pdf/loader.js dat doet, en herhaalt dat drie keer.
//
// De converter zelf is in node niet te laden (die hangt via core/state.ts aan
// de DOM), dus de laadstap hieronder volgt de tak voor /Polygon uit
// annotation-converter.js. De laatste test bewaakt dat de opslag en de lader
// die gedeelde regel ook echt gebruiken.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

import { veelhoekGrondvorm, wolkVakUitHoeken, wolkVakUitZeshoek } from './saver/veelhoek-grondvorm.js';
import { cloudRectOutlinePts, cloudPolyOutlinePts } from './saver/appearance-vectors.js';
import { extractAnnotationColors } from './loader/color-extraction.js';
import { zoekExtraKleuren } from './loader/extra-sleutel.js';

const PAGINA_B = 842;
const PAGINA_H = 595;
// Weergave ↔ PDF bij schaal 1 en /Rotate 0, gelijk aan convertX/convertY in
// de saver en viewport.convertToViewportPoint in de lader.
const naarPdf = (x, y) => [x, PAGINA_H - y];
const naarApp = (px, py) => [px, PAGINA_H - py];

const MARGE = 0.5; // punt

// ── opslaan ─────────────────────────────────────────────────────────────────

/** Eén veelhoek-annotatie als echte PDF-bytes, zoals js/pdf/saver.js hem schrijft. */
async function opgeslagen(ann, { eigenSleutel = true, wolkjesRand = false } = {}) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([PAGINA_B, PAGINA_H]);
  const ctx = doc.context;

  const vertices = [];
  for (const pt of veelhoekGrondvorm(ann)) vertices.push(...naarPdf(pt.x, pt.y));

  // /Rect van een wolk komt uit de GEBOLDE omtrek en is dus ruimer dan de
  // vorm zelf; de maat mag daar niet uit komen. Bij een gewone veelhoek is
  // het de omhullende van de punten plus de lijndikte.
  const rand = ann.lineWidth ?? 2;
  const omtrek = ann.type === 'cloud'
    ? cloudRectOutlinePts(ann.x, ann.y, ann.width, ann.height, 15)
    : ann.type === 'cloudPolyline' ? cloudPolyOutlinePts(ann.points, true) : null;
  const marge = omtrek ? 2 : rand;
  const rondom = (omtrek || veelhoekGrondvorm(ann)).map((p) => naarPdf(p.x, p.y));
  const rect = [
    Math.min(...rondom.map((p) => p[0])) - marge, Math.min(...rondom.map((p) => p[1])) - marge,
    Math.max(...rondom.map((p) => p[0])) + marge, Math.max(...rondom.map((p) => p[1])) + marge,
  ];

  const dict = {
    Type: 'Annot',
    Subtype: 'Polygon',
    Rect: rect,
    Vertices: vertices,
    C: [1, 0, 0],
    T: PDFString.of('User'),
    BS: ctx.obj({ W: ann.lineWidth ?? 2, S: PDFName.of('S') }),
  };
  // Onze eigen sleutel; een ander programma geeft zijn wolk een /BE-rand.
  if (eigenSleutel) dict.OPS_Subtype = PDFString.of(ann.type);
  if (wolkjesRand) dict.BE = ctx.obj({ S: PDFName.of('C'), I: 2 });
  if (ann.fillColor) dict.IC = [0, 0, 1];
  if (ann.strokeColor === 'none') {
    // Vorm zonder rand (#431): geen /C, lijndikte 0 en de eigen sleutel.
    delete dict.C;
    dict.BS = ctx.obj({ W: 0, S: PDFName.of('S') });
    dict.OPS_NoStroke = ctx.obj({ W: ann.lineWidth ?? 0, C: PDFString.of('#ff0000') });
  }

  pagina.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(ctx.obj(dict))]));
  return doc.save();
}

// ── heropenen ───────────────────────────────────────────────────────────────

/** De annotatie zoals pdf.js hem aan de lader geeft, plus de eigen sleutels. */
async function gelezen(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const [annot] = await (await doc.getPage(1)).getAnnotations();
  await doc.destroy();
  const viaPdfLib = await PDFDocument.load(bytes.slice());
  const extra = zoekExtraKleuren(await extractAnnotationColors(1, viaPdfLib), annot.rect) || {};
  return { annot, extra };
}

/** De tak voor /Polygon uit annotation-converter.js: vak en punten uit /Vertices. */
function modelUitVeelhoek({ annot, extra }) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const punten = [];
  for (let i = 0; i < annot.vertices.length; i += 2) {
    const [vx, vy] = naarApp(annot.vertices[i], annot.vertices[i + 1]);
    punten.push({ x: vx, y: vy });
    minX = Math.min(minX, vx); maxX = Math.max(maxX, vx);
    minY = Math.min(minY, vy); maxY = Math.max(maxY, vy);
  }
  const type = extra.opsSubtype === 'cloudPolyline' ? 'cloudPolyline'
    : extra.opsSubtype === 'cloud' ? 'cloud'
      : extra.borderCloudy ? 'cloud' : 'polygon';
  const model = {
    type,
    x: minX, y: minY, width: maxX - minX, height: maxY - minY,
    points: punten,
    sides: Math.floor(annot.vertices.length / 2),
    lineWidth: extra.borderWidth ?? 2,
    strokeColor: extra.opsNoStroke ? 'none' : '#ff0000',
    fillColor: extra.ic || null,
  };
  if (type === 'cloud') {
    const vak = wolkVakUitHoeken(punten)
      || (extra.opsSubtype === 'cloud' ? wolkVakUitZeshoek(punten) : null);
    if (vak) {
      Object.assign(model, vak, { sides: 4 });
      delete model.points;
    }
  }
  return model;
}

/** n keer opslaan en heropenen. */
async function rondgangen(ann, n) {
  let huidig = ann;
  for (let i = 0; i < n; i++) huidig = modelUitVeelhoek(await gelezen(await opgeslagen(huidig)));
  return huidig;
}

const gelijkeMaat = (uit, in_, wat) => {
  assert.ok(Math.abs(uit.width - in_.width) <= MARGE, `${wat}: breedte ${in_.width} → ${uit.width}`);
  assert.ok(Math.abs(uit.height - in_.height) <= MARGE, `${wat}: hoogte ${in_.height} → ${uit.height}`);
  assert.ok(Math.abs(uit.x - in_.x) <= MARGE, `${wat}: x ${in_.x} → ${uit.x}`);
  assert.ok(Math.abs(uit.y - in_.y) <= MARGE, `${wat}: y ${in_.y} → ${uit.y}`);
};

// ── rechthoekige wolk ───────────────────────────────────────────────────────

const WOLK = {
  type: 'cloud', x: 120, y: 90, width: 240, height: 160,
  color: '#ff0000', strokeColor: '#ff0000', lineWidth: 2,
};

test('rechthoekige wolk met rand houdt zijn maat over drie rondgangen', async () => {
  const uit = await rondgangen(WOLK, 3);
  assert.equal(uit.type, 'cloud');
  gelijkeMaat(uit, WOLK, 'wolk met rand');
});

test('rechthoekige wolk zonder rand houdt zijn maat over drie rondgangen', async () => {
  const zonderRand = { ...WOLK, strokeColor: 'none', lineWidth: 0 };
  const uit = await rondgangen(zonderRand, 3);
  assert.equal(uit.type, 'cloud');
  assert.equal(uit.strokeColor, 'none', 'zonder rand blijft zonder rand');
  gelijkeMaat(uit, zonderRand, 'wolk zonder rand');
});

test('gebolde wolk met vulling houdt zijn maat over drie rondgangen', async () => {
  const gevuld = { ...WOLK, fillColor: '#0000ff' };
  gelijkeMaat(await rondgangen(gevuld, 3), gevuld, 'gevulde wolk');
});

test('een wolk van één rondgang is al op maat', async () => {
  gelijkeMaat(await rondgangen(WOLK, 1), WOLK, 'eerste rondgang');
});

test('een heropende wolk houdt een nieuwe maat', async () => {
  // Een maatgreep zet x/y/breedte/hoogte (zie annotations/transforms.js) en
  // raakt `points` niet aan. Bleven die punten op de wolk staan, dan schreef
  // de opslag ze terug en was de nieuwe maat na het heropenen weer weg.
  const heropend = await rondgangen(WOLK, 1);
  assert.equal(heropend.points, undefined, 'een rechthoekige wolk houdt geen punten over');
  const groter = { ...heropend, width: 300, height: 200 };
  gelijkeMaat(await rondgangen(groter, 2), groter, 'na een maatwijziging');
});

// ── vrije wolk (cloudPolyline) ──────────────────────────────────────────────

const VRIJE_WOLK = {
  type: 'cloudPolyline',
  points: [{ x: 100, y: 100 }, { x: 300, y: 130 }, { x: 260, y: 280 }, { x: 110, y: 240 }],
  x: 100, y: 100, width: 200, height: 180,
  color: '#ff0000', strokeColor: '#ff0000', lineWidth: 2,
};

test('vrije wolk houdt punten en maat over drie rondgangen', async () => {
  const uit = await rondgangen(VRIJE_WOLK, 3);
  assert.equal(uit.type, 'cloudPolyline');
  gelijkeMaat(uit, VRIJE_WOLK, 'vrije wolk');
  assert.equal(uit.points.length, VRIJE_WOLK.points.length);
  for (let i = 0; i < uit.points.length; i++) {
    assert.ok(Math.abs(uit.points[i].x - VRIJE_WOLK.points[i].x) <= MARGE, `punt ${i} x`);
    assert.ok(Math.abs(uit.points[i].y - VRIJE_WOLK.points[i].y) <= MARGE, `punt ${i} y`);
  }
});

// ── wolk uit een eerder opgeslagen bestand ──────────────────────────────────

/** De ingeschreven zeshoek van het vak: zo schreef de opslag vóór #434. */
function zeshoekVanVak({ x, y, width, height }) {
  const cx = x + width / 2, cy = y + height / 2;
  return [...Array(6)].map((_, i) => {
    const hoek = (i * 2 * Math.PI / 6) - Math.PI / 2;
    return { x: cx + (width / 2) * Math.cos(hoek), y: cy + (height / 2) * Math.sin(hoek) };
  });
}

test('een wolk uit een eerder opgeslagen bestand komt op zijn oude maat terug', async () => {
  // Het bestand van vóór #434: de zeshoek staat erin, het vak niet.
  const oud = { ...WOLK, points: zeshoekVanVak(WOLK) };
  const uit = modelUitVeelhoek(await gelezen(await opgeslagen(oud)));
  assert.equal(uit.type, 'cloud');
  gelijkeMaat(uit, WOLK, 'oud bestand');
  assert.equal(uit.points, undefined, 'de zeshoek hoort niet in het model te blijven');
});

test('zo n wolk krimpt daarna niet meer', async () => {
  const oud = { ...WOLK, points: zeshoekVanVak(WOLK) };
  const eerste = modelUitVeelhoek(await gelezen(await opgeslagen(oud)));
  gelijkeMaat(await rondgangen(eerste, 3), WOLK, 'na het herstel');
});

test('een wolk met echte punten blijft zoals hij is', async () => {
  // Zes punten die GEEN ingeschreven zeshoek zijn: niets herstellen.
  const eigen = {
    ...WOLK, type: 'cloud',
    points: [{ x: 100, y: 100 }, { x: 240, y: 90 }, { x: 320, y: 180 },
      { x: 250, y: 280 }, { x: 140, y: 270 }, { x: 90, y: 190 }],
    x: 90, y: 90, width: 230, height: 190,
  };
  const uit = modelUitVeelhoek(await gelezen(await opgeslagen(eigen)));
  assert.equal(uit.points.length, 6, 'de punten blijven');
  gelijkeMaat(uit, eigen, 'eigen punten');
  gelijkeMaat(await rondgangen(eigen, 3), eigen, 'eigen punten na drie rondgangen');
});

test('een zeshoekige wolk uit een ander programma blijft onaangeroerd', async () => {
  // Zonder onze eigen sleutel, met een /BE-wolkjesrand: een echte zeshoek van
  // dat programma. Die mag niet groter gemaakt worden.
  const vreemd = { ...WOLK, points: zeshoekVanVak(WOLK) };
  const bytes = await opgeslagen(vreemd, { eigenSleutel: false, wolkjesRand: true });
  const uit = modelUitVeelhoek(await gelezen(bytes));
  assert.equal(uit.type, 'cloud', 'een /BE-rand blijft een wolk');
  assert.equal(uit.points.length, 6, 'de zeshoek blijft de vorm');
  assert.ok(Math.abs(uit.width - WOLK.width * Math.cos(Math.PI / 6)) <= MARGE, `breedte ${uit.width}`);
});

// ── gewone veelhoek: ongewijzigd ────────────────────────────────────────────

test('een gewone veelhoek zonder punten blijft de ingeschreven veelhoek', async () => {
  const zeshoek = { type: 'polygon', x: 120, y: 90, width: 240, height: 160, lineWidth: 2 };
  const uit = await rondgangen(zeshoek, 1);
  assert.equal(uit.type, 'polygon');
  assert.equal(uit.sides, 6);
  // De ingeschreven zeshoek raakt links en rechts niet aan het vak.
  assert.ok(Math.abs(uit.width - 240 * Math.cos(Math.PI / 6)) <= MARGE, `breedte ${uit.width}`);
  assert.ok(Math.abs(uit.height - 160) <= MARGE, `hoogte ${uit.height}`);
});

// ── de opslag en de lader gebruiken dezelfde regel ──────────────────────────

test('opslag en lader halen de regel uit saver/veelhoek-grondvorm.js', () => {
  const opslag = readFileSync(new URL('./saver.js', import.meta.url), 'utf8');
  assert.match(opslag, /veelhoekGrondvorm\(ann\)/, 'de opslag bouwt /Vertices niet meer zelf');
  assert.match(opslag, /from '\.\/saver\/veelhoek-grondvorm\.js'/);
  const lader = readFileSync(new URL('./loader/annotation-converter.js', import.meta.url), 'utf8');
  assert.match(lader, /wolkVakUitHoeken\(polyPoints\)/, 'de lader haalt het vak niet uit de punten');
  assert.match(lader, /wolkVakUitZeshoek\(polyPoints\)/, 'de lader herstelt geen oude wolk');
  assert.match(lader, /from '\.\.\/saver\/veelhoek-grondvorm\.js'/);
});
