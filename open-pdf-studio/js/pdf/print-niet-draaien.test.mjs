// Printing a landscape page on portrait paper (#1234): with Auto-rotate off
// the page stays upright, and with several pages per sheet the page itself
// fills its cell.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { berekenPlaatsing } from './print-plaatsing.js';
import { voorbeeldMeerPerBlad, rasterVan, bronKeuzes, celGeometrie, CEL_PAPIER } from './print-meerperblad.js';

const PT = 72 / 25.4;
const mm = (b, h) => ({ breedtePt: b * PT, hoogtePt: h * PT });
const A4 = { breedteMm: 210, hoogteMm: 297 };
// The slide from the report: 245 x 210 mm.
const DIA = mm(245, 210);

test('Auto-rotate on: the landscape page lies a quarter turn on the portrait paper, as before', () => {
  const p = berekenPlaatsing({ papier: A4, orientatie: 'portrait', pagina: DIA, schaling: 'fit' });
  assert.equal(p.gedraaid, true);
  const auto = berekenPlaatsing({ papier: A4, orientatie: 'auto', pagina: DIA, schaling: 'fit' });
  assert.equal(auto.gedraaid, false, 'auto: the sheet follows the page');
  assert.ok(auto.schaal > 0.95, 'and the page fills it');
});

test('Auto-rotate off: the page stays upright on a portrait sheet and is fitted smaller', () => {
  for (const orientatie of ['auto', 'portrait']) {
    const p = berekenPlaatsing({ papier: A4, orientatie, pagina: DIA, schaling: 'fit', draaien: false });
    assert.equal(p.gedraaid, false, orientatie);
    assert.equal(p.draaiing, 0, orientatie);
    // 210 mm wide paper for a 245 mm wide page.
    assert.ok(Math.abs(p.schaal - 210 / 245) < 1e-6, `${orientatie}: ${p.schaal}`);
    assert.ok(Math.abs(p.pagina.breedte - 210) < 1e-6 && p.pagina.hoogte < 297);
  }
});

test('Auto-rotate off leaves a page on its own sheet alone (Save as PDF without a paper size)', () => {
  const p = berekenPlaatsing({ papier: 'pagina', orientatie: 'auto', pagina: DIA, schaling: 'fit', draaien: false });
  assert.equal(p.gedraaid, false);
  assert.ok(Math.abs(p.schaal - 1) < 1e-6);
});

test('six slides per portrait sheet: each slide fills the width of its cell', () => {
  const raster = { ...rasterVan({ perBlad: '6' }), draaibaar: true };
  const lijst = Array(6).fill(DIA);
  const v = voorbeeldMeerPerBlad({
    meerPerBlad: { ...raster, paginaDraaien: false },
    keuzes: { papier: A4, orientatie: 'portrait', schaling: 'fit', zoom: 100, centreren: true },
    eerstePagina: lijst[0], paginas: lijst,
  });
  assert.deepEqual([v.kolommen, v.rijen], [2, 3]);
  const { celB } = celGeometrie({ bladB: 210 * PT, bladH: 297 * PT, kolommen: 2, rijen: 3 });
  const verwacht = celB / DIA.breedtePt;
  assert.ok(Math.abs(v.schaal - verwacht) < 1e-6, `${v.schaal} of ${verwacht}`);
  // It was 0.31: the slide was first fitted on a whole sheet, and that sheet went into the cell.
  assert.ok(v.schaal > 0.38, `scale ${v.schaal}`);
  for (const cel of v.cellen) assert.ok(Math.abs(cel.opVel.breedte - celB / PT) < 1e-6, 'the slide is as wide as its cell');
});

test('the print job builds the cell pages the same way as the preview', () => {
  const bron = bronKeuzes({ vel: A4, meerPerBlad: rasterVan({ perBlad: '6' }), schaling: 'actual', zoom: 250, centreren: false });
  assert.equal(bron.vel, CEL_PAPIER);
  assert.equal(bron.schaling, 'fit');
  // One page per sheet keeps the chosen paper.
  assert.equal(bronKeuzes({ vel: A4, meerPerBlad: null, schaling: 'fit', zoom: 100, centreren: true }).vel, A4);
});

test('the dialog passes Auto-rotate to the preview and to the print job', () => {
  const dialoog = fs.readFileSync(new URL('../solid/components/dialogs/PrintDialog.jsx', import.meta.url), 'utf8');
  assert.match(dialoog, /draaien: autoRotate\(\),/);
  assert.equal((dialoog.match(/draaien: keuzes\.draaien,/g) || []).length, 2);
  const job = fs.readFileSync(new URL('./print-job.js', import.meta.url), 'utf8');
  assert.match(job, /const bronDraaien = poster \|\| boekje \|\| meerPerBlad \? true : draaien;/);
});
