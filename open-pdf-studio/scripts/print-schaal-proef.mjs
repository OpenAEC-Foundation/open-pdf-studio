// Proef voor de schaal uit de printdialoog, deel 1 van 3: de tijdelijke
// print-PDF's zoals runPrintJob (js/pdf/print-job.js) ze bouwt, met dezelfde
// functies uit js/pdf/print-plaatsing.js en pdf-lib, voor een A4-pagina op
// A3-papier bij elk schaaltype (en een paar randgevallen).
//
//   1. node scripts/print-schaal-proef.mjs            (vanuit open-pdf-studio/)
//   2. de Rust-proef print_windows::proef::schaal_op_vel_naar_pdf_bestand
//      (#[ignore]) print elke bron naar een bestand, uitsluitend op de
//      virtuele pdf-printer "Open PDF Studio";
//   3. python scripts/meet-print-schaal-proef.py meet plek en grootte van de
//      inhoud in de uitvoer (PyMuPDF).
//
// Map: het eerste argument, anders %TEMP%/opds-printschaal-probe.
//
// De bronpagina is wit met een zwarte rand van 2 mm langs de paginarand,
// zodat de omhullende van het donker in de uitvoer de pagina op het vel is.
// Het paginabeeld wordt gemaakt zoals renderPageOffscreen het doet: alleen
// het zichtbare deel (renderDeel), op printPxPerPt pixels per punt, als JPEG.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import {
  berekenPlaatsing, renderDeel, printPxPerPt, voegPrintPaginaToe,
} from '../js/pdf/print-plaatsing.js';
import { PAPIERFORMATEN } from '../js/pdf/print-pagina-instelling.js';

const MM = 72 / 25.4;
const map = process.argv[2] || join(tmpdir(), 'opds-printschaal-probe');

/** A4 met een zwarte rand van 2 mm langs de paginarand en een blok linksboven. */
function randPagina(bMm, hMm) {
  return `<rect x="1" y="1" width="${bMm - 2}" height="${hMm - 2}" fill="none" stroke="#000" stroke-width="2"/>
    <rect x="10" y="10" width="30" height="20" fill="#000"/>`;
}

/**
 * A2 waarvan op A3 op ware grootte alleen het midden zichtbaar is: de rand
 * langs de paginarand valt buiten het vel, een tweede rand staat op
 * (111,5 ; 137) mm met 197 x 320 mm, dus op het vel op (50 ; 50) mm.
 */
function a2MetBinnenrand(bMm, hMm) {
  return `${randPagina(bMm, hMm)}
    <rect x="112.5" y="138" width="195" height="318" fill="none" stroke="#000" stroke-width="2"/>`;
}

const A4 = { breedteMm: 210, hoogteMm: 297, inhoud: randPagina };
const A4_LIGGEND = { breedteMm: 297, hoogteMm: 210, inhoud: randPagina };
const A2 = { breedteMm: 420, hoogteMm: 594, inhoud: a2MetBinnenrand };
const A3 = { breedteMm: PAPIERFORMATEN.a3.breedte, hoogteMm: PAPIERFORMATEN.a3.hoogte };

// naam, bronpagina, vel (null = onbekend papier: het oude gedrag), schaal, zoom, centreren
const GEVALLEN = [
  ['a4-a3-werkelijk', A4, A3, 'actual', 100, true],
  ['a4-a3-schaal-50', A4, A3, 'custom-scale', 50, true],
  ['a4-a3-schaal-10', A4, A3, 'custom-scale', 10, true],
  ['a4-a3-passend', A4, A3, 'fit', 100, true],
  ['a4-a3-schaal-50-linksboven', A4, A3, 'custom-scale', 50, false],
  ['a4-liggend-a3-werkelijk', A4_LIGGEND, A3, 'actual', 100, true],
  ['a2-a3-werkelijk-afgesneden', A2, A3, 'actual', 100, true],
  ['a4-onbekend-papier', A4, null, 'custom-scale', 10, true],
];

/** Het paginabeeld van `deel` (hele pixels van de pagina op pxPerPt), als JPEG. */
async function paginaBeeld(pagina, pxPerPt, deel) {
  const b = pagina.breedteMm * MM;
  const h = pagina.hoogteMm * MM;
  const volB = Math.ceil(b * pxPerPt - 1e-6);
  const volH = Math.ceil(h * pxPerPt - 1e-6);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${volB}" height="${volH}"
      viewBox="0 0 ${pagina.breedteMm} ${pagina.hoogteMm}" preserveAspectRatio="none">
    <rect x="0" y="0" width="${pagina.breedteMm}" height="${pagina.hoogteMm}" fill="#fff"/>
    ${pagina.inhoud(pagina.breedteMm, pagina.hoogteMm)}
  </svg>`;
  return sharp(Buffer.from(svg), { limitInputPixels: false })
    .flatten({ background: '#ffffff' })
    .extract({ left: deel.x, top: deel.y, width: deel.breedte, height: deel.hoogte })
    .jpeg({ quality: 92 })
    .toBuffer();
}

mkdirSync(map, { recursive: true });
const lijst = [];
for (const [naam, pagina, vel, schaling, zoom, centreren] of GEVALLEN) {
  const plaatsing = berekenPlaatsing({
    papier: vel,
    orientatie: 'auto',
    pagina: { breedtePt: pagina.breedteMm * MM, hoogtePt: pagina.hoogteMm * MM },
    schaling,
    zoom,
    centreren,
  });
  const pxPerPt = printPxPerPt(plaatsing);
  const deel = renderDeel(plaatsing, pxPerPt);
  const pdf = await PDFDocument.create();
  voegPrintPaginaToe(pdf, plaatsing, deel, await pdf.embedJpg(await paginaBeeld(pagina, pxPerPt, deel.px)));
  const bron = `bron-${naam}.pdf`;
  writeFileSync(join(map, bron), await pdf.save());
  lijst.push({ naam, bron, plaatsing: plaatsing.bekend ? 'vel' : 'passend' });
  const r = plaatsing.pagina;
  console.log(
    `${naam.padEnd(28)} vel ${plaatsing.vel.breedteMm} x ${plaatsing.vel.hoogteMm} mm, pagina op`
    + ` (${r.x.toFixed(2)}; ${r.y.toFixed(2)}) ${r.breedte.toFixed(2)} x ${r.hoogte.toFixed(2)} mm,`
    + ` schaal ${plaatsing.schaal.toFixed(4)}, beeld ${deel.px.breedte} x ${deel.px.hoogte} px`
    + `${plaatsing.afgesneden ? ', afgesneden' : ''}`,
  );
}
writeFileSync(join(map, 'proef.json'), JSON.stringify(lijst, null, 2));
console.log(`\n${lijst.length} bronnen in ${map}`);
