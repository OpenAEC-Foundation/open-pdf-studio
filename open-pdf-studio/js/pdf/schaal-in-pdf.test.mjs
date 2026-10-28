// Schalen van de app in het bestand (#629): schaalgebieden, viewport-
// annotaties en de documentschaal als /VP + /Measure, viewports van anderen
// blijven staan, de lezer slaat de eigen viewports over, en de
// schaalcontroles per blad gaan heen en terug. Eerst op pdf-lib-niveau, dan
// één keer met de echte saver en de echte lader.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString } from 'pdf-lib';
import {
  puntNaarPdfRuimte, naarPdfRuimte, eigenSchalen, schrijfEigenViewports, leesDocumentSchaal,
  schrijfControles, leesControles, schrijfSchalenInPdf, pasSchalenUitBestandToe, paginaRuimte,
  BRON_SLEUTEL, CONTROLES_SLEUTEL,
} from './schaal-in-pdf.js';
import { puntNaarAppRuimte, leesViewportsVanPagina, leesPdfViewports, viewportOp } from './pdf-viewports.js';
import { pixelsPerUnitFor } from '../annotations/scale-region-scale.js';
import { maakControle } from '../annotations/schaalcontrole.js';

const N = (s) => PDFName.of(s);
const PPU = (n, u = 'mm') => pixelsPerUnitFor(`1:${n}`, u);
const dicht = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('app-ruimte naar PDF en terug, bij elke rotatie en een verschoven CropBox', () => {
  const view = [20, 30, 620, 872];
  for (const rot of [0, 90, 180, 270]) {
    for (const [x, y] of [[0, 0], [12.5, 400], [300, 7]]) {
      const [u, v] = puntNaarPdfRuimte(x, y, view, rot);
      const [x2, y2] = puntNaarAppRuimte(u, v, view, rot);
      dicht(x2, x, 1e-9);
      dicht(y2, y, 1e-9);
    }
  }
  assert.deepEqual(naarPdfRuimte({ x: 10, y: 20, width: 100, height: 50 }, [0, 0, 595, 842], 0), [10, 772, 110, 822]);
});

const annotaties = [
  { id: 'groot', type: 'scaleRegion', page: 1, x: 0, y: 0, width: 500, height: 400, scaleString: '1:100', units: 'mm', label: 'Plattegrond' },
  { id: 'detail', type: 'scaleRegion', page: 1, x: 300, y: 50, width: 150, height: 100, scaleString: '1:20', units: 'mm', label: 'Detail A' },
  { id: 'vp', type: 'viewport', page: 1, x: 20, y: 500, width: 200, height: 200, pixelsPerUnit: PPU(50), unit: 'mm', name: 'Doorsnede' },
];

test('volgorde in /VP: documentschaal, viewports, gebieden van groot naar klein', () => {
  const s = eigenSchalen(annotaties, { pixelsPerUnit: PPU(10), unit: 'mm', scaleRatio: '1:10', method: 'ratio' }, { width: 595, height: 842 });
  assert.deepEqual(s.map((x) => x.bron), ['Document', 'Viewport', 'ScaleRegion', 'ScaleRegion']);
  assert.deepEqual(s.map((x) => x.id || null), [null, 'vp', 'groot', 'detail']);
  dicht(s[3].pixelsPerUnit, PPU(20), 1e-12);
  assert.deepEqual(eigenSchalen([], null, { width: 595, height: 842 }), []);
});

function vpLijst(pagina) {
  const vp = pagina.node.lookup(N('VP'));
  return vp instanceof PDFArray ? [...Array(vp.size()).keys()].map((i) => vp.lookup(i)) : [];
}

test('schrijven: eigen viewports met /Measure, die van anderen blijven, herschrijven vervangt', async () => {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, 842]);
  // Een viewport uit een CAD-plot (geen /OPS_Bron).
  const vreemd = doc.context.obj({
    Type: 'Viewport', BBox: [0, 0, 595, 842], Name: PDFString.of('CAD'),
    Measure: doc.context.obj({ Type: 'Measure', Subtype: 'RL', X: [doc.context.obj({ U: 'mm', C: 1 / PPU(200) })] }),
  });
  pagina.node.set(N('VP'), doc.context.obj([vreemd]));
  const schalen = eigenSchalen(annotaties, { pixelsPerUnit: PPU(10), unit: 'mm', method: 'ratio' }, { width: 595, height: 842 });
  assert.equal(schrijfEigenViewports(pagina, schalen), 4);
  let lijst = vpLijst(pagina);
  assert.equal(lijst.length, 5);
  assert.deepEqual(lijst.map((d) => String(d.get(N(BRON_SLEUTEL)) || '')), ['/Document', '', '/Viewport', '/ScaleRegion', '/ScaleRegion']);
  // Het detail staat als laatste: een andere lezer kiest daar ook het detail.
  const detail = lijst[4];
  const c = detail.lookup(N('Measure')).lookup(N('X')).lookup(0).lookup(N('C')).asNumber();
  dicht(1 / c, PPU(20), 1e-12);
  assert.equal(String(detail.lookup(N('Measure')).lookup(N('Subtype'))), '/RL');
  // De lezer ziet alleen de viewport van het andere programma.
  const gelezen = leesViewportsVanPagina(pagina);
  assert.equal(gelezen.length, 1);
  assert.equal(gelezen[0].name, 'CAD');
  // Opnieuw schrijven zonder detail: geen dubbele, geen oude.
  schrijfEigenViewports(pagina, schalen.filter((s) => s.id !== 'detail'));
  lijst = vpLijst(pagina);
  assert.equal(lijst.length, 4);
  // Niets meer van de app: alleen de vreemde blijft; zonder vreemde gaat /VP weg.
  schrijfEigenViewports(pagina, []);
  assert.equal(vpLijst(pagina).length, 1);
  pagina.node.delete(N('VP'));
  schrijfEigenViewports(pagina, schalen);
  schrijfEigenViewports(pagina, []);
  assert.equal(pagina.node.get(N('VP')), undefined);
});

test('/BBox van een gebied ligt waar het gebied in de app ligt (ook gedraaid)', async () => {
  for (const rot of [0, 90]) {
    const doc = await PDFDocument.create();
    const pagina = doc.addPage([595, 842]);
    if (rot) pagina.node.set(N('Rotate'), doc.context.obj(rot));
    const { view, rot: r } = paginaRuimte(pagina.node);
    const rect = { x: 300, y: 50, width: 150, height: 100 };
    schrijfEigenViewports(pagina, [{ bron: 'ScaleRegion', rect, pixelsPerUnit: PPU(20), unit: 'mm', ratio: '1:20', naam: '' }]);
    const bbox = vpLijst(pagina)[0].lookup(N('BBox')).asArray().map((n) => n.asNumber());
    const a = puntNaarAppRuimte(bbox[0], bbox[1], view, r);
    const b = puntNaarAppRuimte(bbox[2], bbox[3], view, r);
    dicht(Math.min(a[0], b[0]), rect.x);
    dicht(Math.min(a[1], b[1]), rect.y);
    dicht(Math.abs(a[0] - b[0]), rect.width);
    dicht(Math.abs(a[1] - b[1]), rect.height);
  }
});

function controleRegel(bekend) {
  return maakControle({
    datum: '2026-10-28T10:00:00.000Z', auteur: 'Tester',
    bron: { method: 'document', sleutel: 'document' },
    p1: { x: 10, y: 10 }, p2: { x: 110, y: 10 }, punten: 100, bekend, eenheid: 'mm', pixelsPerUnit: PPU(100),
  });
}

test('documentschaal en controles: schrijven, opslaan, lezen', async () => {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([595, 842]);
  doc.addPage([842, 595]);
  const model = {
    annotations: [],
    measureScale: { pixelsPerUnit: PPU(50), unit: 'mm', method: 'reference', scaleRatio: 0 },
    scaleChecks: { 2: [controleRegel(3500)] },
  };
  schrijfSchalenInPdf(doc.getPages(), model);
  assert.equal(p1.node.get(N(CONTROLES_SLEUTEL)), undefined, 'geen regel in het model: niets geschreven');
  const terug = await PDFDocument.load(await doc.save());
  const schaal = leesDocumentSchaal(terug);
  dicht(schaal.pixelsPerUnit, PPU(50), 1e-12);
  assert.equal(schaal.unit, 'mm');
  assert.equal(schaal.method, 'reference');
  assert.deepEqual(leesControles(terug), { 2: [controleRegel(3500)] });
  // De documentschaal is geen viewport voor de lezer: die komt als schaal terug.
  assert.deepEqual(leesPdfViewports(terug), {});
  // Een lege lijst wist de sleutel; geen documentschaal haalt de viewports weg.
  schrijfSchalenInPdf(terug.getPages(), { annotations: [], measureScale: null, scaleChecks: { 2: [] } });
  assert.deepEqual(leesControles(terug), {});
  assert.equal(leesDocumentSchaal(terug), null);
  assert.equal(terug.getPages()[0].node.get(N('VP')), undefined);
});

test('een pagina waarvan de annotaties nog niet geladen zijn blijft ongemoeid', async () => {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, 842]);
  schrijfSchalenInPdf([pagina], { annotations: annotaties, measureScale: null });
  assert.equal(vpLijst(pagina).length, 3);
  schrijfSchalenInPdf([pagina], { annotations: [], measureScale: null, scaleChecks: { 1: [] } }, () => false);
  assert.equal(vpLijst(pagina).length, 3);
});

test('na het openen: de schaal uit het bestand wint, behalve van een eigen wijziging', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  schrijfSchalenInPdf(doc.getPages(), {
    annotations: [], measureScale: { pixelsPerUnit: PPU(20, 'cm'), unit: 'cm', method: 'ratio', scaleRatio: '1:20' },
    scaleChecks: { 1: [controleRegel(3600)] },
  });
  const lib = await PDFDocument.load(await doc.save());
  const geopend = { measureScale: { pixelsPerUnit: PPU(100), unit: 'mm', method: 'auto-detect' }, undoStack: [] };
  assert.deepEqual(pasSchalenUitBestandToe(geopend, lib), { schaal: true, controles: 1 });
  dicht(geopend.measureScale.pixelsPerUnit, PPU(20, 'cm'), 1e-12);
  assert.equal(geopend.measureScale.unit, 'cm');
  assert.equal(geopend.measureScale.scaleRatio, '1:20');
  assert.equal(geopend.scaleChecks[1].length, 1);
  const bewerkt = { measureScale: { pixelsPerUnit: 1, unit: 'mm' }, undoStack: [{}], scaleChecks: { 1: [] } };
  assert.deepEqual(pasSchalenUitBestandToe(bewerkt, lib), { schaal: false, controles: 0 });
  assert.equal(bewerkt.measureScale.pixelsPerUnit, 1);
});

test('met de echte saver: schaalgebieden als /VP, controles en documentschaal heen en terug', async () => {
  const { opslaan, laad, leegBlad } = await import('./rondgang.testhulp.mjs');
  const bron = await leegBlad();
  const modellen = [
    { id: 'g1', type: 'scaleRegion', page: 1, x: 40, y: 60, width: 300, height: 200, scaleString: '1:50', units: 'mm', label: 'Detail', color: '#ff9800' },
  ];
  const controles = { 1: [controleRegel(3550)] };
  const uit = await opslaan(bron, modellen, {
    document: { measureScale: { pixelsPerUnit: PPU(100), unit: 'mm', method: 'ratio', scaleRatio: '1:100' }, scaleChecks: controles },
  });
  const lib = await PDFDocument.load(uit.slice());
  const pagina = lib.getPages()[0];
  const lijst = vpLijst(pagina);
  assert.deepEqual(lijst.map((d) => String(d.get(N(BRON_SLEUTEL)))), ['/Document', '/ScaleRegion']);
  // Wat een andere lezer op dit blad ziet: in het gebied 1:50, erbuiten 1:100.
  const { view, rot } = paginaRuimte(pagina.node);
  const alsVreemd = lijst.map((d) => {
    const bb = d.lookup(N('BBox')).asArray().map((n) => n.asNumber());
    const a = puntNaarAppRuimte(bb[0], bb[1], view, rot);
    const b = puntNaarAppRuimte(bb[2], bb[3], view, rot);
    const c = d.lookup(N('Measure')).lookup(N('X')).lookup(0).lookup(N('C')).asNumber();
    return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]), pixelsPerUnit: 1 / c };
  });
  dicht(viewportOp(alsVreemd, 100, 100).pixelsPerUnit, PPU(50), 1e-9);
  dicht(viewportOp(alsVreemd, 500, 700).pixelsPerUnit, PPU(100), 1e-9);
  // De app leest geen dubbele viewports, wel het gebied, de schaal en de controles.
  assert.deepEqual(leesPdfViewports(lib), {});
  const geladen = await laad(uit);
  const gebieden = geladen.filter((a) => a.type === 'scaleRegion');
  assert.equal(gebieden.length, 1);
  assert.equal(gebieden[0].scaleString, '1:50');
  const doc = { undoStack: [] };
  pasSchalenUitBestandToe(doc, lib);
  dicht(doc.measureScale.pixelsPerUnit, PPU(100), 1e-12);
  assert.deepEqual(doc.scaleChecks, controles);
  // Nog een keer opslaan: niets verdubbelt.
  const nogEens = await opslaan(uit, geladen, { document: { measureScale: doc.measureScale, scaleChecks: doc.scaleChecks } });
  const lib2 = await PDFDocument.load(nogEens.slice());
  assert.equal(vpLijst(lib2.getPages()[0]).length, 2);
  assert.deepEqual(leesControles(lib2), controles);
  assert.ok(lijst.every((d) => d instanceof PDFDict));
});
