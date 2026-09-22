// Proef voor het doel "Opslaan als PDF" in de printdialoog, deel 1 van 2: de
// print-PDF's zoals js/pdf/print-vector.js ze bouwt, voor een liggende
// A2-tekening met vectortekst en lijnen. Er wordt niets geprint: de bytes gaan
// rechtstreeks naar een bestand, zonder stuurprogramma.
//
//   1. node scripts/print-opslaan-als-pdf-proef.mjs     (vanuit open-pdf-studio/)
//   2. python scripts/meet-print-opslaan-als-pdf.py     meet met PyMuPDF: de
//      stand van het vel, /Rotate, of de tekst nog tekst is, of de lijnen nog
//      lijnen zijn, en of er geen paginavullende afbeelding in staat.
//
// Map: het eerste argument, anders %TEMP%/opds-print-als-pdf-proef.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { bouwVectorPrintPdf } from '../js/pdf/print-vector.js';
import { PAPIERFORMATEN } from '../js/pdf/print-pagina-instelling.js';

const map = process.argv[2] || join(tmpdir(), 'opds-print-als-pdf-proef');
const vel = (sleutel) => ({ breedteMm: PAPIERFORMATEN[sleutel].breedte, hoogteMm: PAPIERFORMATEN[sleutel].hoogte });

/** Een tekening: kader, diagonalen, maatlijnen en tekst. `rotate` = /Rotate van de bron. */
async function tekening(breedte, hoogte, rotate = 0) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([breedte, hoogte]);
  p.drawRectangle({ x: 20, y: 20, width: breedte - 40, height: hoogte - 40, borderWidth: 2 });
  p.drawLine({ start: { x: 20, y: 20 }, end: { x: breedte - 20, y: hoogte - 20 }, thickness: 0.5 });
  p.drawLine({ start: { x: 20, y: hoogte - 20 }, end: { x: breedte - 20, y: 20 }, thickness: 0.5 });
  for (let i = 0; i < 40; i++) {
    p.drawLine({ start: { x: 60 + i * 20, y: 80 }, end: { x: 60 + i * 20, y: 80 + (i % 5 === 0 ? 30 : 15) }, thickness: 0.35 });
  }
  p.drawText('PLATTEGROND BEGANE GROND', { x: 60, y: hoogte - 80, size: 28, font });
  p.drawText('schaal 1:100 - maten in mm', { x: 60, y: hoogte - 110, size: 12, font });
  if (rotate) p.setRotation(degrees(rotate));
  return doc.save();
}

/** Een doorzichtige PNG van b x h pixels met een rode rechthoek: een markering. */
function markering(b, h) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${b}" height="${h}">
    <rect x="4" y="4" width="${b - 8}" height="${h - 8}" fill="none" stroke="#e00000" stroke-width="6"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const A2_LIGGEND = [1684, 1191];
const KEUZES = { orientatie: 'auto', schaling: 'fit', zoom: 100, centreren: true };

// naam, bron [b, h, /Rotate], keuzes, met markering?
const GEVALLEN = [
  // De melding: een liggende A2 (1684 x 1191 pt, /Rotate 0) op een liggend A2-vel.
  ['a2-liggend-auto', [...A2_LIGGEND, 0], { ...KEUZES, papier: vel('a2') }, false],
  // Dezelfde tekening, opgeslagen staand met /Rotate 90 (getoond liggend).
  ['a2-rotate90-auto', [1191, 1684, 90], { ...KEUZES, papier: vel('a2') }, false],
  // Handmatig Liggend bij een staande pagina: een kwartslag linksom, het vel gevuld.
  ['a2-staand-op-liggend-vel', [1191, 1684, 0], { ...KEUZES, papier: vel('a2'), orientatie: 'landscape' }, false],
  // Groot en verlengd vel, zonder papiercode.
  ['a2-op-a0l', [...A2_LIGGEND, 0], { ...KEUZES, papier: vel('a0l') }, false],
  // Ware grootte op een kleiner vel: afgesneden, maar nog steeds vectoren.
  ['a2-op-a3-werkelijk', [...A2_LIGGEND, 0], { ...KEUZES, papier: vel('a3'), schaling: 'actual' }, false],
  // Met een markering: een klein doorzichtig beeld bovenop de vectoren.
  ['a2-liggend-met-markering', [...A2_LIGGEND, 0], { ...KEUZES, papier: vel('a2') }, true],
];

mkdirSync(map, { recursive: true });
const lijst = [];
for (const [naam, [b, h, rotate], keuzes, metMarkering] of GEVALLEN) {
  const bronBytes = await tekening(b, h, rotate);
  const png = metMarkering ? await markering(600, 300) : null;
  const gedraaid = [];
  const { pdf } = await bouwVectorPrintPdf({
    bronBytes,
    paginas: [{ index: 0 }],
    keuzes,
    beelden: async ({ plaatsing }) => {
      gedraaid.push(plaatsing.gedraaid);
      return png ? [{ png, opVel: { x: 100, y: 80, breedte: 60, hoogte: 30 } }] : [];
    },
  });
  const bytes = await pdf.save();
  writeFileSync(join(map, `${naam}.pdf`), bytes);
  writeFileSync(join(map, `${naam}.bron.pdf`), bronBytes);
  lijst.push({ naam, orientatie: keuzes.orientatie, markering: metMarkering, gedraaid: gedraaid.includes(true) });
  console.log(`${naam.padEnd(30)} bron ${bronBytes.length} bytes → print-PDF ${bytes.length} bytes`);
}
writeFileSync(join(map, 'proef.json'), JSON.stringify(lijst, null, 2));
console.log(`\n${lijst.length} print-PDF's in ${map}`);
