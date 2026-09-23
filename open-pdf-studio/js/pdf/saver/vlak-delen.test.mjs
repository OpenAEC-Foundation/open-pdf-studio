// Een vlak-annotatie met meer dan één ring, zoals hij in het BESTAND komt.
//
// De appearance (/AP /N) is wat een andere lezer schildert. Die gebruikte de
// even-oneven-regel op alle ringen samen, dus twee delen die elkaar overlappen
// verloren hun gedeelde stuk en een deel buiten de buitenring viel weg door de
// te krappe /Rect (GitHub #457). Deze test leest de geschreven operatoren en
// rekent uit welk gebied ze vullen, en doet de rondgang opslaan → heropenen
// met echte PDF-bytes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

import { buildFilledAreaAP, buildMeasureAreaAP } from './appearance-vectors.js';
import { vlakRect } from './utils.js';
import { extractAnnotationColors } from '../loader/color-extraction.js';
import { nettoVlakOppervlak } from '../../annotations/vlak-ringen.js';

const X = (x) => x;
const Y = (y) => 400 - y;
const terugX = (px) => px;
const terugY = (py) => 400 - py;

const rechthoek = (x, y, b, h) => [
  { x, y }, { x: x + b, y }, { x: x + b, y: y + h }, { x, y: y + h },
];
const GROOT = rechthoek(50, 50, 100, 100);

// ── content-stream lezen ────────────────────────────────────────────────────
// Levert de subpaden van de laatst opgebouwde vorm per schilder-operator.
function schilderingen(ops) {
  const uit = [];
  let paden = [];
  let huidig = null;
  const regels = ops.split('\n');
  for (const regel of regels) {
    const t = regel.trim().split(/\s+/);
    const op = t[t.length - 1];
    if (op === 'm') { huidig = [{ x: +t[0], y: +t[1] }]; paden.push(huidig); }
    else if (op === 'l' && huidig) { huidig.push({ x: +t[0], y: +t[1] }); }
    else if (op === 'f' || op === 'f*') { uit.push({ paden, regel: op === 'f*' ? 'evenodd' : 'nonzero' }); paden = []; huidig = null; }
    else if (op === 'n' && (t[0] === 'W' || t[0] === 'W*')) { uit.push({ paden, regel: t[0] === 'W*' ? 'evenodd' : 'nonzero', knip: true }); paden = []; huidig = null; }
    else if (op === 'S') { paden = []; huidig = null; }
  }
  return uit;
}

function geschilderd({ paden, regel }, x, y) {
  let wikkel = 0, pariteit = false;
  for (const pad of paden) {
    for (let i = 0, j = pad.length - 1; i < pad.length; j = i++) {
      const a = pad[j], b = pad[i];
      if ((a.y > y) !== (b.y > y)) {
        const snij = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
        if (snij > x) { pariteit = !pariteit; wikkel += b.y > a.y ? 1 : -1; }
      }
    }
  }
  return regel === 'evenodd' ? pariteit : wikkel !== 0;
}

const vulOps = (points, holes) => buildFilledAreaAP({
  points, holes, X, Y, fillColorHex: '#ff0000', strokeColorHex: '#000000',
  heeftRand: true, lineWidth: 1, borderStyle: 'solid', hatchPattern: 'none',
}).content;

// In PDF-ruimte: Y(y) = 400 - y, dus een app-punt (x,y) toetsen we op (x, 400-y).
const vulling = (points, holes) => schilderingen(vulOps(points, holes))[0];
const inVlak = (v, x, y) => geschilderd(v, X(x), Y(y));

// ── de vulling in het bestand ───────────────────────────────────────────────

test('een gat blijft een gat in de appearance', () => {
  const v = vulling(GROOT, [rechthoek(70, 70, 40, 40)]);
  assert.equal(inVlak(v, 60, 60), true);
  assert.equal(inVlak(v, 90, 90), false);
});

test('twee delen naast elkaar zijn allebei gevuld in de appearance', () => {
  const v = vulling(GROOT, [rechthoek(200, 50, 100, 100)]);
  assert.equal(inVlak(v, 100, 100), true);
  assert.equal(inVlak(v, 250, 100), true);
  assert.equal(inVlak(v, 175, 100), false);
});

test('de overlap van twee delen blijft gevuld in de appearance', () => {
  const v = vulling(GROOT, [rechthoek(120, 120, 100, 100)]);
  assert.equal(inVlak(v, 80, 80), true);
  assert.equal(inVlak(v, 135, 135), true, 'de overlap hoort gevuld te blijven');
  assert.equal(inVlak(v, 200, 200), true);
});

test('de vulling gebruikt de niet-nul-regel, niet even-oneven', () => {
  const v = vulling(GROOT, [rechthoek(70, 70, 40, 40)]);
  assert.equal(v.regel, 'nonzero');
});

test('de arcering knipt op dezelfde vorm als de vulling', () => {
  const ops = buildFilledAreaAP({
    points: GROOT, holes: [rechthoek(120, 120, 100, 100)], X, Y,
    fillColorHex: null, strokeColorHex: '#000000', heeftRand: false,
    lineWidth: 1, borderStyle: 'solid', hatchPattern: 'diagonal-left',
    hatchColorHex: '#ff0000', hatchScale: 100, hatchAngle: 0,
  }).content;
  const knip = schilderingen(ops).find(s => s.knip);
  assert.ok(knip, 'de arcering zet een knippad');
  assert.equal(knip.regel, 'nonzero');
  assert.equal(geschilderd(knip, X(135), Y(135)), true);
});

test('het meetvlak volgt dezelfde regel', () => {
  const ops = buildMeasureAreaAP({
    points: GROOT, holes: [rechthoek(120, 120, 100, 100)], X, Y,
    fillColorHex: '#00ff00', strokeColorHex: '#ff0000', heeftRand: true,
    lineWidth: 1, borderStyle: 'dashed', hatchPattern: 'none',
  }).content;
  const v = schilderingen(ops)[0];
  assert.equal(v.regel, 'nonzero');
  assert.equal(geschilderd(v, X(135), Y(135)), true);
});

// ── /Rect: de omhullende over álle ringen ───────────────────────────────────

test('de /Rect omsluit ook een deel buiten de buitenring', () => {
  const rect = vlakRect({ points: GROOT, holes: [rechthoek(200, 50, 100, 100)] }, X, Y, 2);
  const [x1, y1, x2, y2] = rect;
  assert.ok(x1 <= 48 && x2 >= 302, `x-bereik te krap: ${x1}..${x2}`);
  assert.ok(y1 <= Y(150) - 2 + 1e-9 && y2 >= Y(50) + 2 - 1e-9, `y-bereik te krap: ${y1}..${y2}`);
});

test('zonder extra ringen blijft de /Rect wat hij was', () => {
  assert.deepEqual(vlakRect({ points: GROOT }, X, Y, 2), [48, Y(150) - 2, 152, Y(50) + 2]);
});

// ── rondgang: opslaan → heropenen ───────────────────────────────────────────

test('opslaan en heropenen geeft dezelfde vorm en dezelfde oppervlakte', async () => {
  const points = GROOT;
  const holes = [rechthoek(200, 50, 100, 100), rechthoek(220, 70, 40, 40)];
  const rect = vlakRect({ points, holes }, X, Y, 2);

  const doc = await PDFDocument.create();
  const pagina = doc.addPage([400, 400]);
  const context = doc.context;
  const vertices = [];
  for (const p of points) vertices.push(X(p.x), Y(p.y));
  const annotDict = context.obj({
    Type: 'Annot', Subtype: 'Polygon', Rect: rect, Vertices: vertices,
    OPS_Subtype: PDFString.of('filledArea'),
  });
  annotDict.set(PDFName.of('OPS_Holes'), context.obj(holes.map(h => {
    const hv = [];
    for (const p of h) hv.push(X(p.x), Y(p.y));
    return context.obj(hv);
  })));
  pagina.node.set(PDFName.of('Annots'), context.obj([context.register(annotDict)]));

  const heropend = await PDFDocument.load(await doc.save());
  const extra = (await extractAnnotationColors(1, heropend)).get(rect.join(','));
  assert.ok(extra && extra.holes, 'de extra ringen komen terug uit het bestand');

  const terug = extra.holes.map(h => h.map(p => ({ x: terugX(p.x), y: terugY(p.y) })));
  assert.deepEqual(terug, holes);
  assert.equal(nettoVlakOppervlak(points, terug), nettoVlakOppervlak(points, holes));
  // 100x100 + 100x100 - 40x40: het tweede deel telt op, zijn eigen gat eraf.
  assert.equal(nettoVlakOppervlak(points, terug), 100 * 100 + 100 * 100 - 40 * 40);
});
