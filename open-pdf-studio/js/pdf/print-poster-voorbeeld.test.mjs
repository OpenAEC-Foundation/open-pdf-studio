// Posterafdruk (#597): de echte print-PDF (maakPoster met pdf-lib) legt de
// tegels precies waar het voorbeeld (posterIndeling) ze toont: hetzelfde vel,
// hetzelfde venster (de knip), de pagina op dezelfde plek, de snijtekens en
// het label. Een A1 en een A4 in één document, op A4 en A3, met overlap.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

import { maakPoster, posterIndeling, posterVellen, aantalPosterVellen, posterLabel } from './print-poster.js';
import { berekenPlaatsing, printPaginaMaat } from './print-plaatsing.js';

const PT_PER_MM = 72 / 25.4;
const pagina = (bMm, hMm) => ({ breedtePt: bMm * PT_PER_MM, hoogtePt: hMm * PT_PER_MM });
const A1 = pagina(594, 841);
const A4_PAGINA = pagina(210, 297);
const A4_LIGGEND = pagina(297, 210);
const BEDRUKBAAR = {
  staand: { links: 4, boven: 5, rechts: 4, onder: 6 },
  liggend: { links: 5, boven: 4, rechts: 6, onder: 4 },
};

function bijna(werkelijk, verwacht, speling, wat) {
  assert.ok(Math.abs(werkelijk - verwacht) <= speling, `${wat}: ${werkelijk} ≠ ${verwacht} (±${speling})`);
}

function stroomTekst(stroom) {
  const bytes = stroom instanceof PDFRawStream ? decodePDFRawStream(stroom).decode() : stroom.getContents();
  return Buffer.from(bytes).toString('latin1');
}

function vermenigvuldig(m, n) {
  // m na n: punt p → n(m(p))... in PDF: CTM' = m × CTM.
  return [
    m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

/**
 * Wat er op een vel getekend is: de knip (re W n), elke ingebedde pagina
 * (Do, als rechthoek in pt met oorsprong linksonder, en haar draaiing), de
 * lijnen (m l S) en de tekst (Tj).
 */
function leesVel(blad, paginaMaten) {
  const c = blad.node.Contents();
  const stromen = c instanceof PDFArray ? c.asArray().map((r) => blad.doc.context.lookup(r)) : [c];
  const tokens = stromen.map(stroomTekst).join('\n').match(/<[0-9A-Fa-f]*>|\/[^\s/<>[\]()]+|[^\s/<>[\]()]+/g);
  const uit = { knippen: [], paginas: [], lijnen: [], teksten: [] };
  let ctm = [1, 0, 0, 1, 0, 0];
  const stapel = [];
  let args = [];
  let laatsteRe = null;
  let punt = null;
  for (const t of tokens) {
    if (/^-?[\d.]+(e-?\d+)?$/.test(t) || t.startsWith('/') || t.startsWith('<')) { args.push(t); continue; }
    const n = args.map(Number);
    switch (t) {
      case 'q': stapel.push(ctm); break;
      case 'Q': ctm = stapel.pop(); break;
      case 'cm': ctm = vermenigvuldig(n, ctm); break;
      case 're': laatsteRe = n; break;
      case 'W': if (laatsteRe) uit.knippen.push(laatsteRe); break;
      case 'm': punt = n; break;
      case 'l': uit.lijnen.push({ van: punt, naar: n }); break;
      case 'Do': {
        if (args[0].startsWith('/EmbeddedPdfPage')) {
          const [b, h] = paginaMaten;
          const hoeken = [[0, 0], [b, 0], [0, h], [b, h]].map(([x, y]) => [
            ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5],
          ]);
          const xs = hoeken.map((p) => p[0]);
          const ys = hoeken.map((p) => p[1]);
          uit.paginas.push({
            x: Math.min(...xs), y: Math.min(...ys),
            breedte: Math.max(...xs) - Math.min(...xs), hoogte: Math.max(...ys) - Math.min(...ys),
            gedraaid: Math.abs(ctm[0]) < 1e-9,
          });
        }
        break;
      }
      case 'Tj': {
        const hex = args[0].slice(1, -1);
        uit.teksten.push(Buffer.from(hex, 'hex').toString('latin1'));
        break;
      }
      default: break;
    }
    args = [];
  }
  return uit;
}

async function printPdf(paginas) {
  // Zoals bouwPrintPdf/bouwVectorPrintPdf met papier null: elke pagina op haar
  // eigen maat (de posterafdruk vraagt de print-PDF zo aan).
  const doc = await PDFDocument.create();
  const maten = [];
  for (const p of paginas) {
    const plaatsing = berekenPlaatsing({ papier: null, orientatie: 'auto', pagina: p, schaling: 'fit' });
    const maat = printPaginaMaat(plaatsing);
    maten.push(maat);
    doc.addPage(maat).drawRectangle({ x: 10, y: 10, width: 20, height: 20 });
  }
  return { doc, maten };
}

const vertaal = ({ file, page, row, col, rows, cols }) => `${file} - pagina ${page} - tegel ${row},${col} (${rows} × ${cols})`;

test('afdruk = voorbeeld: elke tegel op het vel waar posterIndeling haar toont', async () => {
  const gevallen = [
    { naam: 'A1 → A3, randen niet afsnijden', papier: { breedteMm: 297, hoogteMm: 420 },
      orientatie: 'portrait', opties: { schaal: 100, overlap: 0, snijtekens: false, labels: false, alleenGroot: false, randAfsnijden: false } },
    { naam: 'A1 → A4, 100 %, overlap 10, tekens + labels, alleen groot', papier: { breedteMm: 210, hoogteMm: 297, bedrukbaar: BEDRUKBAAR },
      orientatie: 'auto', opties: { schaal: 100, overlap: 10, snijtekens: true, labels: true, alleenGroot: true } },
    { naam: 'A1 → A3, 100 %, geen overlap, kaal', papier: { breedteMm: 297, hoogteMm: 420 },
      orientatie: 'auto', opties: { schaal: 100, overlap: 0, snijtekens: false, labels: false, alleenGroot: true } },
    { naam: 'A1 → A3 staand, 75 %, alles getegeld', papier: { breedteMm: 297, hoogteMm: 420, bedrukbaar: BEDRUKBAAR },
      orientatie: 'portrait', opties: { schaal: 75, overlap: 5, snijtekens: true, labels: true, alleenGroot: false } },
    { naam: 'onbekend papier → A4', papier: null,
      orientatie: 'portrait', opties: { schaal: 100, overlap: 10, snijtekens: true, labels: true, alleenGroot: true } },
  ];
  const paginas = [A4_PAGINA, A1, A4_LIGGEND];
  const paginaNummers = [1, 2, 5];
  for (const g of gevallen) {
    const { doc, maten } = await printPdf(paginas);
    const uit = await maakPoster(doc, {
      papier: g.papier, orientatie: g.orientatie, opties: g.opties, paginaNummers, bestand: 'plattegrond.pdf', vertaal,
    });
    // Het voorbeeld van de hele afdruk, uit de getoonde paginamaten.
    const indelingen = paginas.map((p) => posterIndeling({ papier: g.papier, orientatie: g.orientatie, pagina: p, opties: g.opties }));
    const vellen = posterVellen(indelingen);
    assert.equal(uit.getPageCount(), aantalPosterVellen(indelingen), `${g.naam}: aantal vellen`);
    const herladen = await PDFDocument.load(await uit.save());
    vellen.forEach(({ paginaIndex, indeling, vel: v }, i) => {
      const wat = `${g.naam} vel ${i + 1} (pagina ${paginaIndex + 1}, tegel ${v.rij},${v.kol})`;
      const blad = herladen.getPage(i);
      const H = v.vel.hoogteMm * PT_PER_MM;
      bijna(blad.getWidth(), v.vel.breedteMm * PT_PER_MM, 1e-3, `${wat} velbreedte`);
      bijna(blad.getHeight(), H, 1e-3, `${wat} velhoogte`);
      const gelezen = leesVel(blad, maten[paginaIndex]);

      // De pagina op het vel.
      assert.equal(gelezen.paginas.length, 1, `${wat}: één pagina getekend`);
      const p = gelezen.paginas[0];
      const r = v.plaatsing.pagina;
      bijna(p.x, r.x * PT_PER_MM, 1e-2, `${wat} x`);
      bijna(p.y, H - (r.y + r.hoogte) * PT_PER_MM, 1e-2, `${wat} y`);
      bijna(p.breedte, r.breedte * PT_PER_MM, 1e-2, `${wat} breedte`);
      bijna(p.hoogte, r.hoogte * PT_PER_MM, 1e-2, `${wat} hoogte`);
      assert.equal(p.gedraaid, v.plaatsing.gedraaid, `${wat} draaiing`);

      if (indeling.getegeld) {
        // De knip is het venster van de tegel.
        assert.equal(gelezen.knippen.length, 1, `${wat}: één knip`);
        const [kx, ky, kb, kh] = gelezen.knippen[0];
        const w = v.venster;
        bijna(kx, w.x * PT_PER_MM, 1e-2, `${wat} knip x`);
        bijna(ky, H - (w.y + w.hoogte) * PT_PER_MM, 1e-2, `${wat} knip y`);
        bijna(kb, w.breedte * PT_PER_MM, 1e-2, `${wat} knip breedte`);
        bijna(kh, w.hoogte * PT_PER_MM, 1e-2, `${wat} knip hoogte`);
      } else {
        assert.equal(gelezen.knippen.length, 0, `${wat}: geen knip`);
      }

      // Snijtekens: dezelfde lijnen.
      assert.equal(gelezen.lijnen.length, v.snijtekens.length, `${wat}: snijtekens`);
      v.snijtekens.forEach((s, j) => {
        const l = gelezen.lijnen[j];
        bijna(l.van[0], s.x1 * PT_PER_MM, 1e-2, `${wat} teken ${j} x1`);
        bijna(l.van[1], H - s.y1 * PT_PER_MM, 1e-2, `${wat} teken ${j} y1`);
        bijna(l.naar[0], s.x2 * PT_PER_MM, 1e-2, `${wat} teken ${j} x2`);
        bijna(l.naar[1], H - s.y2 * PT_PER_MM, 1e-2, `${wat} teken ${j} y2`);
      });

      // Label: dezelfde tekst als het voorbeeld.
      if (v.label) {
        const verwacht = posterLabel({
          vertaal, bestand: 'plattegrond.pdf', pagina: paginaNummers[paginaIndex],
          rij: v.rij, kol: v.kol, rijen: indeling.rijen, kolommen: indeling.kolommen,
        });
        assert.deepEqual(gelezen.teksten, [verwacht], `${wat}: label`);
        assert.match(verwacht, new RegExp(`tegel ${v.rij},${v.kol} `));
      } else {
        assert.deepEqual(gelezen.teksten, [], `${wat}: geen label`);
      }
    });
  }
});

test('acceptatie: A1 in tegels, overlap herhaald, tekens en labels, A4 niet getegeld', async () => {
  const papier = { breedteMm: 210, hoogteMm: 297, bedrukbaar: BEDRUKBAAR };
  const opties = { schaal: 100, overlap: 10, snijtekens: true, labels: true, alleenGroot: true };
  const { doc } = await printPdf([A4_PAGINA, A1]);
  const uit = await maakPoster(doc, { papier, opties, paginaNummers: [1, 2], bestand: 'plan.pdf' });
  const a1 = posterIndeling({ papier, pagina: A1, opties });
  assert.ok(a1.getegeld && a1.vellen.length > 1, 'A1 over meerdere A4-vellen');
  assert.equal(uit.getPageCount(), 1 + a1.vellen.length, 'A4 op één vel, A1 in tegels');
  // Overlap: twee buren tonen 10 mm van dezelfde tekening.
  const [a, b] = a1.vellen;
  bijna(a.tegel.x + a.tegel.breedte - b.tegel.x, 10, 1e-9, 'overlap');
  const herladen = await PDFDocument.load(await uit.save());
  const eerste = leesVel(herladen.getPage(0), [A4_PAGINA.breedtePt, A4_PAGINA.hoogtePt]);
  assert.equal(eerste.lijnen.length, 0, 'A4: geen snijtekens');
  assert.deepEqual(eerste.teksten, [], 'A4: geen label');
  const tegel = leesVel(herladen.getPage(1), [A1.breedtePt, A1.hoogtePt]);
  assert.equal(tegel.lijnen.length, 8, 'A1: snijtekens');
  assert.deepEqual(tegel.teksten, [`plan.pdf - page 2 - tile 1,1 (${a1.rijen} x ${a1.kolommen})`]);
});
