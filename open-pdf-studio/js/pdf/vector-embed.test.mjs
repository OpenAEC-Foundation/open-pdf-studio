// Vectorknipsel — de pure inbedbewerking.
//
// Twee dingen worden hier bewaakt. Ten eerste de valkuil die ook in
// titleblock-compose.js staat: embedPage normaliseert de BBox naar de oorsprong
// maar verschuift de inhoud niet, dus zonder expliciete matrix wordt het
// knipsel leeg geclipt. Ten tweede dat de /Rotate van de bronpagina in die
// matrix verwerkt wordt — pdf-lib doet dat zelf niet.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';

import {
  normaliseerVak, knipselMatrix, paginaRotatie, bedKnipselIn, knipselAlsMiniPdf, MIN_VAK_PT,
} from './vector-embed.js';

const VAK = { left: 100, bottom: 80, right: 220, top: 140 };  // 120 x 60

async function bronMetVak({ rotatie = 0 } = {}) {
  const d = await PDFDocument.create();
  const p = d.addPage([600, 400]);
  p.drawRectangle({ x: 100, y: 80, width: 120, height: 60 });
  if (rotatie) p.node.set(PDFName.of('Rotate'), d.context.obj(rotatie));
  return d.save();
}

/** Bed in, teken op een pagina, sla op en lees het XObject terug uit het
 *  resultaat — pas na opslaan staat het echt in de resources. */
async function ingebedXObject(bronBytes, vak = VAK) {
  const doel = await PDFDocument.create();
  const r = await bedKnipselIn(doel, bronBytes, vak);
  const pagina = doel.addPage([800, 600]);
  pagina.drawPage(r.ingebed, { x: 0, y: 0, width: r.breedte, height: r.hoogte });
  const heropend = await PDFDocument.load(await doel.save());
  const xobjs = heropend.getPage(0).node.Resources().lookup(PDFName.of('XObject'));
  const namen = xobjs.keys();
  const form = heropend.context.lookup(xobjs.get(namen[0]));
  return {
    aantal: namen.length,
    bbox: form.dict.get(PDFName.of('BBox')).asArray().map((n) => n.asNumber()),
    matrix: form.dict.get(PDFName.of('Matrix')).asArray().map((n) => n.asNumber()),
    breedte: r.breedte,
    hoogte: r.hoogte,
    rotatie: r.rotatie,
  };
}

// --- vak ------------------------------------------------------------------

test('normaliseerVak draait omgekeerde hoeken om', () => {
  assert.deepEqual(
    normaliseerVak({ left: 200, bottom: 150, right: 100, top: 50 }),
    { left: 100, bottom: 50, right: 200, top: 150 },
  );
});

test('normaliseerVak weigert een ontaard vak', () => {
  assert.equal(normaliseerVak({ left: 10, bottom: 10, right: 10 + MIN_VAK_PT / 2, top: 40 }), null);
  assert.equal(normaliseerVak({ left: 10, bottom: 10, right: 40, top: 10 }), null);
  assert.equal(normaliseerVak({ left: NaN, bottom: 0, right: 40, top: 40 }), null);
  assert.equal(normaliseerVak(null), null);
});

// --- matrix ---------------------------------------------------------------

test('zonder rotatie is de matrix een zuivere verschuiving naar de oorsprong', () => {
  const m = knipselMatrix(VAK, 0);
  assert.deepEqual(m.matrix, [1, 0, 0, 1, -100, -80]);
  assert.deepEqual([m.breedte, m.hoogte], [120, 60]);
});

test('elke kwartslag legt de vier hoeken van het vak precies op [0,b] x [0,h]', () => {
  for (const rot of [0, 90, 180, 270]) {
    const { matrix: [a, b, c, d, e, f], breedte, hoogte } = knipselMatrix(VAK, rot);
    const punten = [
      [VAK.left, VAK.bottom], [VAK.right, VAK.bottom],
      [VAK.right, VAK.top], [VAK.left, VAK.top],
    ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
    const xs = punten.map((p) => p[0]);
    const ys = punten.map((p) => p[1]);
    assert.ok(Math.abs(Math.min(...xs)) < 1e-9 && Math.abs(Math.max(...xs) - breedte) < 1e-9,
      `rotatie ${rot}: x-bereik ${Math.min(...xs)}..${Math.max(...xs)}, verwacht 0..${breedte}`);
    assert.ok(Math.abs(Math.min(...ys)) < 1e-9 && Math.abs(Math.max(...ys) - hoogte) < 1e-9,
      `rotatie ${rot}: y-bereik ${Math.min(...ys)}..${Math.max(...ys)}, verwacht 0..${hoogte}`);
  }
});

test('een kwartslag wisselt breedte en hoogte om, een halve niet', () => {
  assert.deepEqual([knipselMatrix(VAK, 90).breedte, knipselMatrix(VAK, 90).hoogte], [60, 120]);
  assert.deepEqual([knipselMatrix(VAK, 180).breedte, knipselMatrix(VAK, 180).hoogte], [120, 60]);
  assert.deepEqual([knipselMatrix(VAK, 270).breedte, knipselMatrix(VAK, 270).hoogte], [60, 120]);
});

test('rare rotatiewaarden worden op een kwartslag afgerond', () => {
  assert.equal(knipselMatrix(VAK, -90).rotatie, 270);
  assert.equal(knipselMatrix(VAK, 450).rotatie, 90);
  assert.equal(knipselMatrix(VAK, 3).rotatie, 0);
});

// --- inbedden -------------------------------------------------------------

test('het knipsel wordt een Form XObject met het vak als BBox', async () => {
  const r = await ingebedXObject(await bronMetVak());
  assert.equal(r.aantal, 1, 'één ingebed knipsel');
  assert.deepEqual(r.bbox, [100, 80, 220, 140]);
  assert.deepEqual([r.breedte, r.hoogte], [120, 60]);
});

test('de matrix in het opgeslagen bestand haalt de inhoud naar de oorsprong', async () => {
  const r = await ingebedXObject(await bronMetVak());
  assert.deepEqual(r.matrix, [1, 0, 0, 1, -100, -80]);
});

test('een geroteerde bronpagina levert een knipsel in de stand die je ziet', async () => {
  const r = await ingebedXObject(await bronMetVak({ rotatie: 90 }));
  assert.equal(r.rotatie, 90);
  assert.deepEqual([r.breedte, r.hoogte], [60, 120], 'gedraaid: breedte en hoogte wisselen om');
  assert.deepEqual(r.matrix, [0, -1, 1, 0, -80, 220]);
});

test('paginaRotatie leest de /Rotate van de bronpagina', async () => {
  const d = await PDFDocument.load(await bronMetVak({ rotatie: 270 }));
  assert.equal(paginaRotatie(d.getPage(0)), 270);
  const e = await PDFDocument.load(await bronMetVak());
  assert.equal(paginaRotatie(e.getPage(0)), 0);
});

test('een ontaard vak wordt geweigerd in plaats van stilletjes leeg ingebed', async () => {
  const doel = await PDFDocument.create();
  const bron = await bronMetVak();
  await assert.rejects(
    () => bedKnipselIn(doel, bron, { left: 100, bottom: 80, right: 100.2, top: 140 }),
    /vak te klein of ontaard/,
  );
});

// --- mini-PDF -------------------------------------------------------------

test('knipselAlsMiniPdf levert een zelfstandige eenpagina-PDF', async () => {
  const mini = await knipselAlsMiniPdf(await bronMetVak(), 0);
  const d = await PDFDocument.load(mini);
  assert.equal(d.getPageCount(), 1);
  const { width, height } = d.getPage(0).getSize();
  assert.deepEqual([width, height], [600, 400]);
});

test('de mini-PDF houdt de rotatie van de bronpagina vast', async () => {
  const mini = await knipselAlsMiniPdf(await bronMetVak({ rotatie: 90 }), 0);
  const d = await PDFDocument.load(mini);
  assert.equal(paginaRotatie(d.getPage(0)), 90);
});

test('uit de mini-PDF inbedden geeft hetzelfde resultaat als uit de bron', async () => {
  const bron = await bronMetVak();
  const a = await ingebedXObject(bron);
  const b = await ingebedXObject(await knipselAlsMiniPdf(bron, 0));
  assert.deepEqual(a.bbox, b.bbox);
  assert.deepEqual(a.matrix, b.matrix);
  assert.deepEqual([a.breedte, a.hoogte], [b.breedte, b.hoogte]);
});

test('twee knipsels uit dezelfde bron in één document delen niets stiekem', async () => {
  const bron = await bronMetVak();
  const doel = await PDFDocument.create();
  const een = await bedKnipselIn(doel, bron, VAK);
  const twee = await bedKnipselIn(doel, bron, { left: 0, bottom: 0, right: 300, top: 200 });
  const p = doel.addPage([800, 600]);
  p.drawPage(een.ingebed, { x: 0, y: 0, width: een.breedte, height: een.hoogte });
  p.drawPage(twee.ingebed, { x: 300, y: 300, width: twee.breedte, height: twee.hoogte });
  const heropend = await PDFDocument.load(await doel.save());
  const xobjs = heropend.getPage(0).node.Resources().lookup(PDFName.of('XObject'));
  assert.equal(xobjs.keys().length, 2, 'twee verschillende vakken, twee XObjects');
});
