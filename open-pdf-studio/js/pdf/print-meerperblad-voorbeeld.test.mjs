// Het voorbeeld in de printdialoog bij meerdere pagina's per vel (#590): het
// vel en de cellen zoals de printopdracht ze echt neerlegt, voor elk aantal
// per vel, elke paginavolgorde, met of zonder rand en in beide standen.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

import {
  voorbeeldMeerPerBlad, aantalVellen, paginasOpVel, schaalVoorMeerPerBlad, maakMeerPerBlad,
  rasterVan, kiesBlad, BLAD_MARGE_PT,
} from './print-meerperblad.js';
import { berekenPlaatsing, printPaginaMaat } from './print-plaatsing.js';

const MM_PER_PT = 25.4 / 72;
const PT_PER_MM = 72 / 25.4;
const A4_VEL = { breedteMm: 210, hoogteMm: 297 };
const A4 = { breedtePt: 210 * PT_PER_MM, hoogtePt: 297 * PT_PER_MM };
const A4_LIGGEND = { breedtePt: A4.hoogtePt, hoogtePt: A4.breedtePt };
const KEUZES = { papier: A4_VEL, orientatie: 'auto', schaling: 'fit', zoom: 100, centreren: true };
const MARGE_MM = BLAD_MARGE_PT * MM_PER_PT;

function bijna(werkelijk, verwacht, speling = 1e-6, wat = '') {
  assert.ok(Math.abs(werkelijk - verwacht) <= speling, `${wat} ${werkelijk} ≠ ${verwacht} (±${speling})`);
}

function voorbeeld({ perBlad = 4, kolommen, rijen, volgorde = 'horizontal', rand = false, keuzes = {}, paginas, eerste } = {}) {
  const raster = rasterVan({ perBlad, kolommen, rijen });
  const lijst = paginas ?? Array.from({ length: raster.kolommen * raster.rijen }, () => A4);
  return voorbeeldMeerPerBlad({
    meerPerBlad: { ...raster, volgorde, rand },
    keuzes: { ...KEUZES, ...keuzes },
    eerstePagina: eerste ?? lijst[0],
    paginas: lijst,
  });
}

test('1 per vel: geen n-up-voorbeeld (het gewone voorbeeld blijft)', () => {
  assert.equal(voorbeeld({ perBlad: 1 }), null);
  assert.equal(voorbeeldMeerPerBlad({ meerPerBlad: null, keuzes: KEUZES, eerstePagina: A4, paginas: [A4] }), null);
});

test('aantalVellen en paginasOpVel: de pagina\'s per vel in printvolgorde', () => {
  const twee = { kolommen: 2, rijen: 1 };
  assert.equal(aantalVellen(5, twee), 3);
  assert.equal(aantalVellen(4, twee), 2);
  assert.equal(aantalVellen(0, twee), 0);
  assert.equal(aantalVellen(5, null), 5);
  assert.deepEqual(paginasOpVel([3, 4, 5, 6, 7], 0, twee), [3, 4]);
  assert.deepEqual(paginasOpVel([3, 4, 5, 6, 7], 2, twee), [7]);
  assert.deepEqual(paginasOpVel([3, 4, 5], 1, null), [4]);
});

test('elk aantal per vel: zoveel cellen, binnen de rand van het vel, niet overlappend', () => {
  for (const perBlad of ['2', '4', '6', '9', '16']) {
    const v = voorbeeld({ perBlad });
    const { kolommen, rijen } = rasterVan({ perBlad });
    assert.equal(v.cellen.length, kolommen * rijen, `${perBlad} per vel`);
    for (const c of v.cellen) {
      const r = c.opVel;
      assert.ok(r.x >= MARGE_MM - 1e-6 && r.y >= MARGE_MM - 1e-6, `${perBlad}: binnen de marge`);
      assert.ok(r.x + r.breedte <= v.vel.breedteMm - MARGE_MM + 1e-6, `${perBlad}: rechts binnen het vel`);
      assert.ok(r.y + r.hoogte <= v.vel.hoogteMm - MARGE_MM + 1e-6, `${perBlad}: onder binnen het vel`);
      // Een A4-pagina op een A4-vel: de cel houdt de verhouding van A4.
      bijna(r.hoogte / r.breedte, 297 / 210, 1e-6, `${perBlad}: verhouding`);
    }
    for (let i = 0; i < v.cellen.length; i++) {
      for (let j = i + 1; j < v.cellen.length; j++) {
        const a = v.cellen[i].opVel;
        const b = v.cellen[j].opVel;
        const los = a.x + a.breedte <= b.x + 1e-6 || b.x + b.breedte <= a.x + 1e-6
          || a.y + a.hoogte <= b.y + 1e-6 || b.y + b.hoogte <= a.y + 1e-6;
        assert.ok(los, `${perBlad}: cel ${i} en ${j} overlappen`);
      }
    }
  }
});

test('eigen raster: kolommen x rijen', () => {
  const v = voorbeeld({ perBlad: 'custom', kolommen: 3, rijen: 5 });
  assert.equal(v.cellen.length, 15);
  const xs = new Set(v.cellen.map((c) => c.opVel.x.toFixed(3)));
  const ys = new Set(v.cellen.map((c) => c.opVel.y.toFixed(3)));
  assert.equal(xs.size, 3);
  assert.equal(ys.size, 5);
});

test('automatische stand: twee staande pagina\'s naast elkaar op een liggend vel', () => {
  const v = voorbeeld({ perBlad: '2' });
  assert.equal(v.vel.orientatie, 'landscape');
  bijna(v.vel.breedteMm, 297);
  bijna(v.vel.hoogteMm, 210);
  const [links, rechts] = v.cellen;
  assert.ok(rechts.opVel.x > links.opVel.x + links.opVel.breedte, 'tweede pagina rechts van de eerste');
  bijna(links.opVel.y, rechts.opVel.y);
  // Vier staande pagina's: staand vel.
  assert.equal(voorbeeld({ perBlad: '4' }).vel.orientatie, 'portrait');
});

test('vaste stand: staand en liggend vel, zoals de printopdracht', () => {
  const staand = voorbeeld({ perBlad: '2', keuzes: { orientatie: 'portrait' } });
  assert.equal(staand.vel.orientatie, 'portrait');
  bijna(staand.vel.breedteMm, 210);
  const liggend = voorbeeld({ perBlad: '4', keuzes: { orientatie: 'landscape' } });
  assert.equal(liggend.vel.orientatie, 'landscape');
  bijna(liggend.vel.breedteMm, 297);
  // Een liggende pagina op een staand vel: in de cel ligt ze gedraaid, net als
  // bij het afdrukken (berekenPlaatsing met dezelfde keuzes).
  const gedraaid = voorbeeld({
    perBlad: '2', keuzes: { orientatie: 'portrait' }, paginas: [A4_LIGGEND, A4_LIGGEND],
  });
  assert.equal(gedraaid.cellen[0].plaatsing.gedraaid, true);
});

test('paginavolgorde: de k-de pagina in de juiste cel', () => {
  const plek = (volgorde) => voorbeeld({ perBlad: '4', volgorde }).cellen.map((c) => c.opVel);
  const h = plek('horizontal');
  assert.ok(h[1].x > h[0].x && Math.abs(h[1].y - h[0].y) < 1e-6, 'horizontaal: 2 rechts van 1');
  assert.ok(h[2].y > h[0].y && Math.abs(h[2].x - h[0].x) < 1e-6, 'horizontaal: 3 onder 1');
  const hr = plek('horizontal-reversed');
  assert.ok(hr[0].x > hr[1].x, 'horizontaal omgekeerd: 1 rechtsboven');
  assert.ok(Math.abs(hr[0].y - h[0].y) < 1e-6);
  const v = plek('vertical');
  assert.ok(v[1].y > v[0].y && Math.abs(v[1].x - v[0].x) < 1e-6, 'verticaal: 2 onder 1');
  assert.ok(v[2].x > v[0].x, 'verticaal: 3 rechts van 1');
  const vr = plek('vertical-reversed');
  assert.ok(vr[0].x > vr[2].x && vr[1].y > vr[0].y, 'verticaal omgekeerd: begint rechtsboven, naar beneden');
});

test('rand: gaat mee naar het voorbeeld', () => {
  assert.equal(voorbeeld({ perBlad: '4', rand: true }).rand, true);
  assert.equal(voorbeeld({ perBlad: '4', rand: false }).rand, false);
});

test('de schaalkeuze telt niet bij meer per vel: zelfde plaatsing als passend', () => {
  const zoom = voorbeeld({ perBlad: '2', keuzes: { schaling: 'custom-scale', zoom: 400, centreren: false } });
  const passend = voorbeeld({ perBlad: '2' });
  assert.deepEqual(zoom.cellen.map((c) => c.opVel), passend.cellen.map((c) => c.opVel));
  bijna(zoom.cellen[0].plaatsing.schaal, passend.cellen[0].plaatsing.schaal);
  assert.deepEqual(schaalVoorMeerPerBlad({ kolommen: 2, rijen: 1 }, 'actual', 250, false),
    { schaling: 'fit', zoom: 100, centreren: true });
  assert.deepEqual(schaalVoorMeerPerBlad(null, 'actual', 250, false),
    { schaling: 'actual', zoom: 250, centreren: false });
});

test('kop: vel en schaal van de getoonde pagina op het papier', () => {
  const v = voorbeeld({ perBlad: '4' });
  assert.equal(v.bekend, true);
  // De schaal van de pagina op het papier: binnenste plaatsing x cel.
  bijna(v.schaal, v.cellen[0].plaatsing.schaal * v.cellen[0].schaal);
  assert.ok(v.schaal > 0.4 && v.schaal < 0.5);
});

test('onbekend papier: het vel volgt de eerste pagina', () => {
  const v = voorbeeld({ perBlad: '2', keuzes: { papier: null } });
  assert.equal(v.bekend, false);
  bijna(v.vel.breedteMm, 297, 1e-6);
  bijna(v.vel.hoogteMm, 210, 1e-6);
  // "Opslaan als PDF" zonder formaat: de pagina is het vel.
  const pdf = voorbeeld({ perBlad: '2', keuzes: { papier: 'pagina' } });
  assert.equal(pdf.bekend, true);
  bijna(pdf.vel.breedteMm, 297, 1e-6);
});

test('printbaar gebied van de printer op het n-up-vel', () => {
  const bedrukbaar = {
    staand: { links: 5, boven: 6, rechts: 5, onder: 6 },
    liggend: { links: 6, boven: 5, rechts: 6, onder: 5 },
  };
  const v = voorbeeld({ perBlad: '2', keuzes: { papier: { ...A4_VEL, bedrukbaar } } });
  assert.deepEqual(v.marges, bedrukbaar.liggend);
  bijna(v.bedrukbaar.breedte, 297 - 12);
});

// --- het voorbeeld en de afdruk leggen de pagina's op dezelfde plek -----------

function stroomTekst(stroom) {
  const bytes = stroom instanceof PDFRawStream ? decodePDFRawStream(stroom).decode() : stroom.getContents();
  return Buffer.from(bytes).toString('latin1');
}

/** Per getekende pagina op het vel: [x, y, breedte, hoogte] in pt (PDF, linksonder). */
function getekendePaginas(pagina, ingebed) {
  const c = pagina.node.Contents();
  const stromen = c instanceof PDFArray ? c.asArray().map((r) => pagina.doc.context.lookup(r)) : [c];
  const tekst = stromen.map(stroomTekst).join('\n');
  const uit = [];
  for (const blok of tekst.split(/\bQ\b/)) {
    if (!/ Do\b/.test(blok)) continue;
    const cms = [...blok.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm/g)]
      .map((m) => m.slice(1, 7).map(Number));
    const verschuiving = cms[0];
    const schaal = cms.find((m, i) => i > 0 && m[1] === 0 && m[2] === 0 && (m[0] !== 1 || m[3] !== 1)) || [1, 0, 0, 1];
    const [b, h] = ingebed;
    uit.push([verschuiving[4], verschuiving[5], schaal[0] * b, schaal[3] * h]);
  }
  return uit;
}

async function printPdf(paginas, keuzes) {
  // Zoals bouwPrintPdf/bouwVectorPrintPdf: per bronpagina een pagina op de maat
  // van haar plaatsing.
  const doc = await PDFDocument.create();
  const maten = [];
  for (const p of paginas) {
    const plaatsing = berekenPlaatsing({ ...keuzes, pagina: p });
    const maat = printPaginaMaat(plaatsing);
    maten.push(maat);
    doc.addPage(maat).drawRectangle({ x: 1, y: 1, width: 2, height: 2 });
  }
  return { doc, maten };
}

test('voorbeeld = afdruk: elke cel ligt waar maakMeerPerBlad de pagina tekent', async () => {
  const gevallen = [
    { perBlad: '2', volgorde: 'horizontal', orientatie: 'auto' },
    { perBlad: '4', volgorde: 'vertical', orientatie: 'landscape' },
    { perBlad: '6', volgorde: 'horizontal-reversed', orientatie: 'portrait' },
    { perBlad: '9', volgorde: 'vertical-reversed', orientatie: 'auto' },
    { perBlad: 'custom', kolommen: 2, rijen: 3, volgorde: 'horizontal', orientatie: 'landscape' },
  ];
  const paginas = [A4, A4_LIGGEND, A4, A4, A4_LIGGEND, A4, A4, A4, A4];
  for (const g of gevallen) {
    const raster = rasterVan(g);
    const keuzes = { ...KEUZES, orientatie: g.orientatie, ...schaalVoorMeerPerBlad(raster, 'fit', 100, true) };
    const { doc, maten } = await printPdf(paginas, keuzes);
    const uit = await maakMeerPerBlad(doc, {
      ...raster, volgorde: g.volgorde, papier: A4_VEL, orientatie: g.orientatie,
    });
    assert.equal(uit.getPageCount(), aantalVellen(paginas.length, raster), `${g.perBlad}: aantal vellen`);
    // Opgeslagen en opnieuw gelezen: dan staan de tekenopdrachten in de stroom.
    const herladen = await PDFDocument.load(await uit.save());
    for (let vel = 0; vel < herladen.getPageCount(); vel++) {
      const opVel = paginasOpVel(paginas.map((_, i) => i), vel, raster);
      const v = voorbeeldMeerPerBlad({
        meerPerBlad: { ...raster, volgorde: g.volgorde, rand: false },
        keuzes: { ...KEUZES, orientatie: g.orientatie },
        eerstePagina: paginas[0],
        paginas: opVel.map((i) => paginas[i]),
      });
      const blad = herladen.getPage(vel);
      bijna(v.vel.breedteMm * PT_PER_MM, blad.getWidth(), 1e-3, `${g.perBlad}: velbreedte`);
      bijna(v.vel.hoogteMm * PT_PER_MM, blad.getHeight(), 1e-3, `${g.perBlad}: velhoogte`);
      const getekend = opVel.map((i, k) => getekendePaginas(blad, maten[i])[k]);
      v.cellen.forEach((c, k) => {
        const [x, y, b, h] = getekend[k];
        const wat = `${g.perBlad}/${g.volgorde}/${g.orientatie} vel ${vel} cel ${k}`;
        bijna(c.opVel.x * PT_PER_MM, x, 1e-2, `${wat} x`);
        bijna((v.vel.hoogteMm - c.opVel.y - c.opVel.hoogte) * PT_PER_MM, y, 1e-2, `${wat} y`);
        bijna(c.opVel.breedte * PT_PER_MM, b, 1e-2, `${wat} breedte`);
        bijna(c.opVel.hoogte * PT_PER_MM, h, 1e-2, `${wat} hoogte`);
      });
    }
  }
});

const pt = (p) => ({ breedte: p.breedtePt, hoogte: p.hoogtePt });

// --- #606: een vaste stand blijft vast, ook bij een vast aantal per vel ---------

test('kiesBlad: een vaste staande stand geeft altijd een staand vel', () => {
  for (const perBlad of ['2', '4', '6', '9', '16']) {
    const { kolommen, rijen } = rasterVan({ perBlad });
    for (const pagina of [A4, A4_LIGGEND]) {
      const b = kiesBlad({ papier: A4_VEL, orientatie: 'portrait', eerstePagina: pt(pagina), kolommen, rijen, draaibaar: true });
      assert.ok(b.bladB < b.bladH, `${perBlad} per vel: staand`);
      const l = kiesBlad({ papier: A4_VEL, orientatie: 'landscape', eerstePagina: pt(pagina), kolommen, rijen, draaibaar: true });
      assert.ok(l.bladB > l.bladH, `${perBlad} per vel: liggend`);
    }
  }
});

test('kiesBlad: een vast raster draait mee met het vel (6 per vel staand = 2 x 3)', () => {
  const staand = kiesBlad({ papier: A4_VEL, orientatie: 'portrait', eerstePagina: pt(A4), kolommen: 3, rijen: 2, draaibaar: true });
  assert.deepEqual([staand.kolommen, staand.rijen], [2, 3]);
  const liggend = kiesBlad({ papier: A4_VEL, orientatie: 'landscape', eerstePagina: pt(A4), kolommen: 3, rijen: 2, draaibaar: true });
  assert.deepEqual([liggend.kolommen, liggend.rijen], [3, 2]);
  // Twee staande pagina's op een staand vel: onder elkaar komen ze iets
  // groter dan naast elkaar.
  const twee = kiesBlad({ papier: A4_VEL, orientatie: 'portrait', eerstePagina: pt(A4), kolommen: 2, rijen: 1, draaibaar: true });
  assert.deepEqual([twee.kolommen, twee.rijen], [1, 2]);
  // Vier per vel: vierkant raster, er valt niets te draaien.
  const vier = kiesBlad({ papier: A4_VEL, orientatie: 'portrait', eerstePagina: pt(A4), kolommen: 2, rijen: 2, draaibaar: true });
  assert.deepEqual([vier.kolommen, vier.rijen], [2, 2]);
  // Een eigen raster blijft zoals getypt.
  const eigen = kiesBlad({ papier: A4_VEL, orientatie: 'portrait', eerstePagina: pt(A4), kolommen: 3, rijen: 2 });
  assert.deepEqual([eigen.kolommen, eigen.rijen], [3, 2]);
});

test('kiesBlad automatisch: de beste stand én de beste richting van het raster', () => {
  // Twee staande pagina's: naast elkaar op een liggend vel (zoals altijd).
  const staand = kiesBlad({ papier: A4_VEL, orientatie: 'auto', eerstePagina: pt(A4), kolommen: 2, rijen: 1, draaibaar: true });
  assert.ok(staand.bladB > staand.bladH);
  assert.deepEqual([staand.kolommen, staand.rijen], [2, 1]);
  // Twee liggende pagina's: onder elkaar op een staand vel.
  const liggend = kiesBlad({ papier: A4_VEL, orientatie: 'auto', eerstePagina: pt(A4_LIGGEND), kolommen: 2, rijen: 1, draaibaar: true });
  assert.ok(liggend.bladB < liggend.bladH);
  assert.deepEqual([liggend.kolommen, liggend.rijen], [1, 2]);
});

test('voorbeeld bij 2 per vel en gekozen staande stand: een staand vel (#606)', () => {
  const v = voorbeeldMeerPerBlad({
    meerPerBlad: { ...rasterVan({ perBlad: '2' }), draaibaar: true },
    keuzes: { ...KEUZES, orientatie: 'portrait' },
    eerstePagina: A4,
    paginas: [A4, A4],
  });
  assert.equal(v.vel.orientatie, 'portrait');
  bijna(v.vel.breedteMm, 210);
  const zes = voorbeeldMeerPerBlad({
    meerPerBlad: { ...rasterVan({ perBlad: '6' }), draaibaar: true },
    keuzes: { ...KEUZES, orientatie: 'portrait' },
    eerstePagina: A4,
    paginas: Array(6).fill(A4),
  });
  assert.equal(zes.vel.orientatie, 'portrait');
  assert.equal(new Set(zes.cellen.map((c) => c.opVel.x.toFixed(3))).size, 2, 'twee kolommen');
  assert.equal(new Set(zes.cellen.map((c) => c.opVel.y.toFixed(3))).size, 3, 'drie rijen');
});
