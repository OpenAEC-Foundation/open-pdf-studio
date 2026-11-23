// Pagina's per vel en Automatisch draaien (#623). De regels:
//
// 1. Het VEL: een in de Pagina-instelling voor dit document bevestigde stand
//    ligt vast; anders kiest de app de stand waarin het raster het best past
//    (vellenStand + kiesBlad).
// 2. De PAGINA IN DE CEL: houdt altijd haar eigen stand op haar printpagina
//    (de stand van het vel draait de inhoud nooit mee). Automatisch draaien
//    AAN: een kwartslag linksom in de cel als ze daar echt groter in komt
//    (bij gelijke grootte blijft ze rechtop). UIT: nooit gedraaid.
// 3. Een boekje houdt zijn pagina's altijd rechtop.
// 4. Het voorbeeld en de afdruk volgen dezelfde regels.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

import {
  plaatsInCel, kiesBlad, velIndeling, voorbeeldMeerPerBlad, maakMeerPerBlad, rasterVan,
  flyerRaster, paginasOpVel, bronKeuzes, beeldInCel, celGeometrie, CEL_PAGINA_STAND, CEL_PAPIER,
} from './print-meerperblad.js';
import { voorbeeldBoekje } from './print-boekje.js';
import { berekenPlaatsing, printPaginaMaat } from './print-plaatsing.js';

const PT_PER_MM = 72 / 25.4;
const A4_VEL = { breedteMm: 210, hoogteMm: 297 };
const mmPagina = (b, h) => ({ breedtePt: b * PT_PER_MM, hoogtePt: h * PT_PER_MM });
const A4 = mmPagina(210, 297);
const A4_LIGGEND = mmPagina(297, 210);
// De pagina uit het issue: 245 x 210 mm, liggend.
const ISSUE = mmPagina(245, 210);
const KEUZES = { papier: A4_VEL, orientatie: 'auto', schaling: 'fit', zoom: 100, centreren: true };

function bijna(werkelijk, verwacht, speling = 1e-6, wat = '') {
  assert.ok(Math.abs(werkelijk - verwacht) <= speling, `${wat} ${werkelijk} ≠ ${verwacht} (±${speling})`);
}

const RASTERS = [
  { naam: '2', raster: () => ({ ...rasterVan({ perBlad: '2' }), draaibaar: true }) },
  { naam: '4', raster: () => ({ ...rasterVan({ perBlad: '4' }), draaibaar: true }) },
  { naam: '6', raster: () => ({ ...rasterVan({ perBlad: '6' }), draaibaar: true }) },
  { naam: '9', raster: () => ({ ...rasterVan({ perBlad: '9' }), draaibaar: true }) },
  { naam: 'eigen 2x1', raster: () => rasterVan({ perBlad: 'custom', kolommen: 2, rijen: 1 }) },
  { naam: 'eigen 1x3', raster: () => rasterVan({ perBlad: 'custom', kolommen: 1, rijen: 3 }) },
  { naam: 'folder 4', raster: () => flyerRaster(4) },
];

function voorbeeld({ raster, orientatie = 'auto', paginaDraaien, paginas, papier = A4_VEL }) {
  const lijst = paginas ?? Array(raster.kolommen * raster.rijen).fill(ISSUE);
  return voorbeeldMeerPerBlad({
    meerPerBlad: { ...raster, ...(paginaDraaien === undefined ? {} : { paginaDraaien }) },
    keuzes: { ...KEUZES, papier, orientatie },
    eerstePagina: lijst[0],
    paginas: lijst,
  });
}

/** Ligt de inhoud van deze cel gedraaid op het vel (op de printpagina of in de cel)? */
const inhoudGedraaid = (cel) => !!cel.plaatsing.gedraaid !== !!cel.kwartslag;

// --- plaatsInCel ---------------------------------------------------------------

test('plaatsInCel: zonder draaien nooit een kwartslag', () => {
  // Een liggende pagina in een smalle, hoge cel: gedraaid zou ze groter zijn.
  const p = plaatsInCel({ bladB: 595, bladH: 842, kolommen: 2, rijen: 1, kol: 0, rij: 0, paginaB: 842, paginaH: 595 });
  assert.equal(p.kwartslag, false);
  assert.ok(p.breedte > p.hoogte, 'liggend gebleven');
});

test('plaatsInCel: met draaien een kwartslag alleen als de pagina echt groter komt', () => {
  const smal = { bladB: 595, bladH: 842, kolommen: 2, rijen: 1, kol: 0, rij: 0, paginaB: 842, paginaH: 595 };
  const recht = plaatsInCel(smal);
  const gedraaid = plaatsInCel({ ...smal, draaien: true });
  assert.equal(gedraaid.kwartslag, true);
  assert.ok(gedraaid.schaal > recht.schaal, 'gedraaid groter');
  // Op het vel: breedte en hoogte gewisseld (staand in de staande cel).
  assert.ok(gedraaid.hoogte > gedraaid.breedte);
  bijna(gedraaid.breedte, 595 * gedraaid.schaal, 1e-9);
  bijna(gedraaid.hoogte, 842 * gedraaid.schaal, 1e-9);
  // Een staande pagina in dezelfde cel: rechtop is al het beste.
  const staand = plaatsInCel({ ...smal, paginaB: 595, paginaH: 842, draaien: true });
  assert.equal(staand.kwartslag, false);
  // Een vierkante pagina: gelijke grootte, dus rechtop.
  const vierkant = plaatsInCel({ ...smal, paginaB: 500, paginaH: 500, draaien: true });
  assert.equal(vierkant.kwartslag, false);
});

// --- kiesBlad --------------------------------------------------------------------

test('kiesBlad #623: vast staand vel, liggende pagina\'s, 2 per vel: onder elkaar, rechtop', () => {
  const pagina = { breedte: 297 * PT_PER_MM, hoogte: 210 * PT_PER_MM };
  for (const draaien of [false, true]) {
    const b = kiesBlad({
      papier: A4_VEL, orientatie: 'portrait', eerstePagina: pagina, kolommen: 2, rijen: 1, draaibaar: true, draaien,
    });
    assert.ok(b.bladB < b.bladH, 'staand vel');
    assert.deepEqual([b.kolommen, b.rijen], [1, 2], `onder elkaar (draaien ${draaien})`);
  }
});

test('kiesBlad: bij gelijke grootte wint een rechtop liggende pagina (geen onnodige kwartslag)', () => {
  // Twee staande pagina's, automatisch: naast elkaar op een liggend vel is
  // even groot als onder elkaar en gedraaid op een staand vel. Rechtop wint.
  const staand = kiesBlad({
    papier: A4_VEL, orientatie: 'auto', eerstePagina: { breedte: 595.28, hoogte: 841.89 },
    kolommen: 2, rijen: 1, draaibaar: true, draaien: true,
  });
  assert.ok(staand.bladB > staand.bladH, 'liggend vel');
  assert.deepEqual([staand.kolommen, staand.rijen], [2, 1]);
  const cel = velIndeling({ ...staand, draaien: true, maten: [{ breedte: 595.28, hoogte: 841.89 }] })[0];
  assert.equal(cel.kwartslag, false);
});

test('kiesBlad: een eigen raster blijft; draaien bepaalt of de pagina mag kantelen voor het beste vel', () => {
  const liggend = { breedte: 297 * PT_PER_MM, hoogte: 210 * PT_PER_MM };
  // Vast staand vel, eigen raster 2 x 1: zonder draaien blijft de pagina liggend.
  const uit = kiesBlad({ papier: A4_VEL, orientatie: 'portrait', eerstePagina: liggend, kolommen: 2, rijen: 1, draaien: false });
  assert.deepEqual([uit.kolommen, uit.rijen], [2, 1]);
  const cellenUit = velIndeling({ ...uit, maten: [liggend, liggend] });
  assert.ok(cellenUit.every((c) => !c.kwartslag && c.breedte > c.hoogte));
  // Met draaien: gedraaid komt ze groter in de smalle cellen.
  const cellenAan = velIndeling({ ...uit, draaien: true, maten: [liggend, liggend] });
  assert.ok(cellenAan.every((c) => c.kwartslag && c.hoogte > c.breedte));
});

// --- het voorbeeld: de regels in alle combinaties ------------------------------

test('#623: Automatisch draaien UIT draait nooit de inhoud, in geen enkele combinatie', () => {
  for (const { naam, raster } of RASTERS) {
    for (const orientatie of ['auto', 'portrait', 'landscape']) {
      for (const pagina of [A4, A4_LIGGEND, ISSUE]) {
        const r = raster();
        const v = voorbeeld({ raster: r, orientatie, paginaDraaien: false, paginas: Array(r.kolommen * r.rijen).fill(pagina) });
        for (const cel of v.cellen) {
          const wat = `${naam}/${orientatie}/${pagina.breedtePt.toFixed(0)}x${pagina.hoogtePt.toFixed(0)} cel ${cel.k}`;
          assert.equal(cel.plaatsing.gedraaid, false, `${wat}: printpagina niet gedraaid`);
          assert.equal(!!cel.kwartslag, false, `${wat}: geen kwartslag in de cel`);
          // De stand van de pagina op het vel is die van het document.
          assert.equal(cel.opVel.breedte > cel.opVel.hoogte, pagina.breedtePt > pagina.hoogtePt, `${wat}: stand`);
        }
        // De gekozen stand van het vel blijft gelden.
        if (orientatie !== 'auto') assert.equal(v.vel.orientatie, orientatie, `${naam}/${orientatie}: vel`);
      }
    }
  }
});

test('#623: Automatisch draaien AAN geeft elke pagina de beste van beide standen in haar cel', () => {
  for (const { naam, raster } of RASTERS) {
    for (const orientatie of ['auto', 'portrait', 'landscape']) {
      for (const pagina of [A4, A4_LIGGEND, ISSUE]) {
        const r = raster();
        const lijst = Array(r.kolommen * r.rijen).fill(pagina);
        const aan = voorbeeld({ raster: r, orientatie, paginaDraaien: true, paginas: lijst });
        for (const cel of aan.cellen) {
          const wat = `${naam}/${orientatie}/${pagina.breedtePt.toFixed(0)} cel ${cel.k}`;
          // Nooit via de printpagina: alleen een kwartslag in de cel.
          assert.equal(cel.plaatsing.gedraaid, false, `${wat}: printpagina rechtop`);
          // De cel van dit vel: rechtop en gedraaid passend, de grootste wint.
          const [pb, ph] = printPaginaMaat(cel.plaatsing);
          const { celB, celH } = celGeometrie({
            bladB: aan.vel.breedteMm * PT_PER_MM, bladH: aan.vel.hoogteMm * PT_PER_MM,
            kolommen: aan.kolommen, rijen: aan.rijen,
          });
          const rechtop = Math.min(celB / pb, celH / ph);
          const gedraaid = Math.min(celB / ph, celH / pb);
          bijna(cel.schaal, Math.max(rechtop, gedraaid), 1e-9, `${wat}: schaal`);
          assert.equal(!!cel.kwartslag, gedraaid > rechtop * (1 + 1e-6), `${wat}: kwartslag`);
        }
        if (orientatie !== 'auto') assert.equal(aan.vel.orientatie, orientatie, `${naam}/${orientatie}: vel`);
      }
    }
  }
});

test('#623 (het issue): staand vel, liggende pagina 245 x 210 mm, 2/4/6 per vel, Automatisch draaien uit: de inhoud blijft liggend', () => {
  for (const perBlad of ['2', '4', '6']) {
    const raster = { ...rasterVan({ perBlad }), draaibaar: true };
    const v = voorbeeld({ raster, orientatie: 'portrait', paginaDraaien: false });
    assert.equal(v.vel.orientatie, 'portrait', `${perBlad}: staand vel`);
    for (const cel of v.cellen) {
      assert.equal(inhoudGedraaid(cel), false, `${perBlad} cel ${cel.k}: niet gedraaid`);
      assert.ok(cel.opVel.breedte > cel.opVel.hoogte, `${perBlad} cel ${cel.k}: liggend op het vel`);
    }
  }
  // 2 per vel: onder elkaar, zoals de schermafdruk het vel toont.
  const twee = voorbeeld({ raster: { ...rasterVan({ perBlad: '2' }), draaibaar: true }, orientatie: 'portrait', paginaDraaien: false });
  assert.deepEqual([twee.kolommen, twee.rijen], [1, 2]);
});

test('#623 (het issue) met Automatisch draaien aan: alleen gedraaid waar dat echt groter is', () => {
  const per = (perBlad) => voorbeeld({
    raster: { ...rasterVan({ perBlad }), draaibaar: true }, orientatie: 'portrait', paginaDraaien: true,
  });
  // 2 en 6 per vel: het raster draait mee (1 x 2, 2 x 3) en de pagina past
  // rechtop het best; ze blijft liggend.
  for (const perBlad of ['2', '6']) {
    for (const cel of per(perBlad).cellen) assert.equal(inhoudGedraaid(cel), false, `${perBlad} cel ${cel.k}`);
  }
  // 4 per vel (2 x 2 op een staand vel): de cellen zijn staand, gedraaid komt
  // de pagina ruim groter; dat is de beste stand.
  const vier = per('4');
  const uit = voorbeeld({ raster: { ...rasterVan({ perBlad: '4' }), draaibaar: true }, orientatie: 'portrait', paginaDraaien: false });
  assert.ok(vier.cellen.every((c) => c.kwartslag));
  // De pagina zelf vult haar cel (#1234), dus rechtop verliest ze minder dan
  // toen een heel vel in de cel kwam: 0,452 gedraaid tegen 0,388 rechtop.
  assert.ok(vier.schaal > uit.schaal * 1.1);
});

test('#623: Automatisch draaien aan, staand vel, eigen raster 2 x 1, liggende pagina\'s: gedraaid in de smalle cel', () => {
  const raster = rasterVan({ perBlad: 'custom', kolommen: 2, rijen: 1 });
  const aan = voorbeeld({ raster, orientatie: 'portrait', paginaDraaien: true, paginas: [A4_LIGGEND, A4_LIGGEND] });
  const uit = voorbeeld({ raster, orientatie: 'portrait', paginaDraaien: false, paginas: [A4_LIGGEND, A4_LIGGEND] });
  for (const cel of aan.cellen) {
    assert.equal(cel.kwartslag, true);
    assert.ok(cel.opVel.hoogte > cel.opVel.breedte);
  }
  assert.ok(aan.schaal > uit.schaal, 'gedraaid groter');
  for (const cel of uit.cellen) assert.equal(inhoudGedraaid(cel), false);
});

test('het vel volgt nog steeds de gekozen stand; zonder keuze de beste', () => {
  const raster = { ...rasterVan({ perBlad: '2' }), draaibaar: true };
  assert.equal(voorbeeld({ raster, orientatie: 'landscape', paginaDraaien: false }).vel.orientatie, 'landscape');
  assert.equal(voorbeeld({ raster, orientatie: 'portrait', paginaDraaien: true }).vel.orientatie, 'portrait');
  // Automatisch: twee staande pagina's naast elkaar op een liggend vel,
  // twee liggende onder elkaar op een staand vel; nooit gedraaid.
  for (const paginaDraaien of [false, true]) {
    const staand = voorbeeld({ raster, paginaDraaien, paginas: [A4, A4] });
    assert.equal(staand.vel.orientatie, 'landscape');
    assert.ok(staand.cellen.every((c) => !inhoudGedraaid(c)));
    const liggend = voorbeeld({ raster, paginaDraaien, paginas: [A4_LIGGEND, A4_LIGGEND] });
    assert.equal(liggend.vel.orientatie, 'portrait');
    assert.ok(liggend.cellen.every((c) => !inhoudGedraaid(c)));
  }
});

// --- beeldInCel: waar het paginabeeld in het voorbeeld komt --------------------

test('beeldInCel: rechtop, een halve slag (boekje) en een kwartslag linksom', () => {
  const cel = { opVel: { x: 10, y: 20, breedte: 100, hoogte: 50 }, schaal: 0.5 };
  // De hele printpagina (200 x 100 mm) vult de cel.
  assert.deepEqual(beeldInCel(cel, { x: 0, y: 0, breedte: 200, hoogte: 100 }),
    { x: 10, y: 20, breedte: 100, hoogte: 50, hoek: 0 });
  // Een deel linksboven op de printpagina.
  assert.deepEqual(beeldInCel(cel, { x: 0, y: 0, breedte: 20, hoogte: 10 }),
    { x: 10, y: 20, breedte: 10, hoogte: 5, hoek: 0 });
  assert.deepEqual(beeldInCel({ ...cel, gedraaid: true }, { x: 0, y: 0, breedte: 20, hoogte: 10 }),
    { x: 100, y: 65, breedte: 10, hoogte: 5, hoek: 180 });
  // Kwartslag: de printpagina (100 x 200 mm, staand) ligt liggend in de cel.
  // Haar bovenrand komt links; linksboven op de pagina wordt linksonder.
  const kw = { opVel: { x: 10, y: 20, breedte: 100, hoogte: 50 }, schaal: 0.5, kwartslag: true };
  assert.deepEqual(beeldInCel(kw, { x: 0, y: 0, breedte: 100, hoogte: 200 }),
    { x: 10, y: 20, breedte: 100, hoogte: 50, hoek: 90 });
  assert.deepEqual(beeldInCel(kw, { x: 0, y: 0, breedte: 20, hoogte: 10 }),
    { x: 10, y: 60, breedte: 5, hoogte: 10, hoek: 90 });
});

// --- bronKeuzes: de printpagina's draaien nooit mee met het vel ----------------

test('bronKeuzes: bij pagina\'s per vel en een boekje krijgen de printpagina\'s hun eigen stand', () => {
  const raster = { ...rasterVan({ perBlad: '2' }), draaibaar: true, paginaDraaien: false };
  const basis = { poster: null, vel: A4_VEL, schaling: 'actual', zoom: 150, centreren: false };
  for (const orientatie of ['auto', 'portrait', 'landscape']) {
    const meer = bronKeuzes({ ...basis, meerPerBlad: raster, boekje: false, orientatie });
    assert.equal(meer.orientatie, CEL_PAGINA_STAND, `per vel/${orientatie}`);
    assert.equal(meer.schaling, 'fit');
    assert.equal(meer.meerPerBlad, raster);
    const boekje = bronKeuzes({ ...basis, meerPerBlad: null, boekje: { katern: 0 }, orientatie });
    assert.equal(boekje.orientatie, CEL_PAGINA_STAND, `boekje/${orientatie}`);
    assert.equal(boekje.meerPerBlad, null);
    // Eén pagina per vel: de gekozen stand en schaal, zoals altijd.
    const gewoon = bronKeuzes({ ...basis, meerPerBlad: null, boekje: false, orientatie });
    assert.deepEqual(gewoon, { vel: A4_VEL, meerPerBlad: null, schaling: 'actual', zoom: 150, centreren: false, orientatie });
  }
  assert.equal(CEL_PAGINA_STAND, 'auto');
  // Een poster: papier onbekend en de gekozen stand (maakPoster legt de vellen).
  const poster = bronKeuzes({ ...basis, poster: { schaal: 2 }, meerPerBlad: raster, boekje: false, orientatie: 'portrait' });
  assert.equal(poster.vel, null);
  assert.equal(poster.meerPerBlad, null);
});

// --- boekje: nooit gedraaid ------------------------------------------------------

test('boekje: liggende pagina\'s met een gekozen staande stand liggen niet gedraaid op hun printpagina', () => {
  for (const orientatie of ['auto', 'portrait', 'landscape']) {
    const v = voorbeeldBoekje({
      keuzes: { ...KEUZES, orientatie }, eerstePagina: A4_LIGGEND, paginas: [A4_LIGGEND, A4_LIGGEND],
    });
    for (const cel of v.cellen) assert.equal(cel.plaatsing.gedraaid, false, `${orientatie} cel ${cel.k}`);
  }
});

// --- voorbeeld = afdruk, ook met een kwartslag ----------------------------------

function stroomTekst(stroom) {
  const bytes = stroom instanceof PDFRawStream ? decodePDFRawStream(stroom).decode() : stroom.getContents();
  return Buffer.from(bytes).toString('latin1');
}

const maal = (m, n) => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];

/** Per getekende pagina: de samengestelde matrix (a b c d e f) uit alle cm's in haar blok. */
function getekendeMatrices(pagina) {
  const c = pagina.node.Contents();
  const stromen = c instanceof PDFArray ? c.asArray().map((r) => pagina.doc.context.lookup(r)) : [c];
  const tekst = stromen.map(stroomTekst).join('\n');
  const uit = [];
  for (const blok of tekst.split(/\bQ\b/)) {
    if (!/ Do\b/.test(blok)) continue;
    const cms = [...blok.matchAll(/(-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) cm/g)]
      .map((m) => m.slice(1, 7).map(Number));
    // In PDF geldt de laatste cm eerst: punt x M_n x ... x M_1.
    uit.push(cms.reduce((acc, m) => maal(m, acc), [1, 0, 0, 1, 0, 0]));
  }
  return uit;
}

test('voorbeeld = afdruk: maakMeerPerBlad draait en plaatst elke pagina zoals het voorbeeld', async () => {
  const gevallen = [
    { raster: rasterVan({ perBlad: 'custom', kolommen: 2, rijen: 1 }), orientatie: 'portrait', paginaDraaien: true },
    { raster: rasterVan({ perBlad: 'custom', kolommen: 2, rijen: 1 }), orientatie: 'portrait', paginaDraaien: false },
    { raster: { ...rasterVan({ perBlad: '6' }), draaibaar: true }, orientatie: 'portrait', paginaDraaien: true },
    { raster: { ...rasterVan({ perBlad: '2' }), draaibaar: true }, orientatie: 'portrait', paginaDraaien: false },
    { raster: { ...rasterVan({ perBlad: '4' }), draaibaar: true }, orientatie: 'landscape', paginaDraaien: true },
    { raster: { ...flyerRaster(2) }, orientatie: 'landscape', paginaDraaien: true },
  ];
  const paginas = [A4_LIGGEND, ISSUE, A4, A4_LIGGEND, A4, ISSUE];
  for (const g of gevallen) {
    const wat = `${g.raster.kolommen}x${g.raster.rijen}/${g.orientatie}/${g.paginaDraaien}`;
    // Zoals bouwPrintPdf: elke pagina op haar printpagina, in haar eigen stand.
    const keuzes = { ...KEUZES, papier: CEL_PAPIER, orientatie: CEL_PAGINA_STAND };
    const doc = await PDFDocument.create();
    for (const p of paginas) {
      doc.addPage(printPaginaMaat(berekenPlaatsing({ ...keuzes, pagina: p }))).drawRectangle({ x: 1, y: 1, width: 2, height: 2 });
    }
    const uit = await maakMeerPerBlad(doc, {
      ...g.raster, papier: A4_VEL, orientatie: g.orientatie, paginaDraaien: g.paginaDraaien,
    });
    const herladen = await PDFDocument.load(await uit.save());
    const indexen = paginas.map((_, i) => i);
    for (let vel = 0; vel < herladen.getPageCount(); vel++) {
      const opVel = paginasOpVel(indexen, vel, g.raster);
      const v = voorbeeldMeerPerBlad({
        meerPerBlad: { ...g.raster, paginaDraaien: g.paginaDraaien },
        keuzes: { ...KEUZES, orientatie: g.orientatie },
        eerstePagina: paginas[0],
        paginas: opVel.map((i) => paginas[i]),
      });
      const blad = herladen.getPage(vel);
      const bladH = blad.getHeight();
      const matrices = getekendeMatrices(blad);
      v.cellen.forEach((cel, k) => {
        const m = matrices[k];
        const [pb, ph] = printPaginaMaat(cel.plaatsing);
        // De hoeken van de printpagina op het vel (pt, linksonder).
        const hoeken = [[0, 0], [pb, 0], [0, ph], [pb, ph]]
          .map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
        const xs = hoeken.map((h) => h[0]);
        const ys = hoeken.map((h) => h[1]);
        const w = `${wat} vel ${vel} cel ${k}`;
        bijna(Math.min(...xs), cel.opVel.x * PT_PER_MM, 1e-2, `${w} x`);
        bijna(bladH - Math.max(...ys), cel.opVel.y * PT_PER_MM, 1e-2, `${w} y`);
        bijna(Math.max(...xs) - Math.min(...xs), cel.opVel.breedte * PT_PER_MM, 1e-2, `${w} breedte`);
        bijna(Math.max(...ys) - Math.min(...ys), cel.opVel.hoogte * PT_PER_MM, 1e-2, `${w} hoogte`);
        // Gedraaid = een kwartslag linksom: de x-as van de pagina wijst omhoog.
        if (cel.kwartslag) {
          assert.ok(Math.abs(m[0]) < 1e-6 && m[1] > 0 && m[2] < 0 && Math.abs(m[3]) < 1e-6, `${w}: linksom`);
        } else {
          assert.ok(m[0] > 0 && Math.abs(m[1]) < 1e-6 && Math.abs(m[2]) < 1e-6 && m[3] > 0, `${w}: rechtop`);
        }
      });
    }
  }
});
