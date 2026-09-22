// De print-PDF met vectoren: het doel "Opslaan als PDF" in de printdialoog.
//
// De gewone printopdracht (print-job.js, `bouwPrintPdf`) rastert elke pagina
// tot een JPEG: een printer-DC krijgt toch pixels. Bewaar je zo'n opdracht via
// een PDF-stuurprogramma, dan is alle tekst en elke lijn een plaatje geworden,
// en bepaalt dat stuurprogramma hoe het vel wordt weggeschreven (een liggend
// vel komt er bij sommige als staand medium met gedraaide inhoud uit). Hier
// staat de weg zonder stuurprogramma: de bronpagina's gaan als Form XObject
// (pdf-lib `embedPages`) op een pagina met de maat en de stand van het vel.
// Tekst blijft tekst, lijnen blijven lijnen, en de MediaBox ligt zoals het vel
// ligt, met /Rotate 0 en de inhoud rechtop.
//
// Schaal en plek komen uit print-plaatsing.js: dezelfde regel als het
// voorbeeld en de printopdracht, inclusief de kwartslag linksom voor een
// pagina die haaks op een handmatig gekozen vel staat.
//
// De markeringen (en watermerken en tekstbewerkingen die nog niet in het
// bestand staan) leven in de app en worden op een canvas getekend; ze komen
// als doorzichtige beelden bovenop de vectoren, alleen waar iets staat
// (`maakTegelRaster`, `vakkenUitRaster`). Dat tekenen heeft een DOM nodig en
// gebeurt in print-job.js; deze module kent alleen pdf-lib en is in node te
// testen.

import {
  PDFDocument, PDFName, PDFRef, PDFDict, PDFArray, PDFStream,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject,
} from 'pdf-lib';
import { berekenPlaatsing } from './print-plaatsing.js';
import { knipselMatrix } from './vector-embed.js';

const PT_PER_MM = 72 / 25.4;

function kwartslag(graden) {
  return ((Math.round((Number(graden) || 0) / 90) * 90) % 360 + 360) % 360;
}

/**
 * Het zichtbare vak van een bronpagina in gebruikersruimte: de CropBox binnen
 * de MediaBox, zoals PDF.js de pagina toont. Een onbruikbare doorsnede → de
 * MediaBox.
 */
function bronVak(page) {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const rand = (k) => ({
    left: Math.min(k.x, k.x + k.width),
    right: Math.max(k.x, k.x + k.width),
    bottom: Math.min(k.y, k.y + k.height),
    top: Math.max(k.y, k.y + k.height),
  });
  const m = rand(media);
  const c = rand(crop);
  const vak = {
    left: Math.max(m.left, c.left),
    bottom: Math.max(m.bottom, c.bottom),
    right: Math.min(m.right, c.right),
    top: Math.min(m.top, c.top),
  };
  return vak.right - vak.left > 0 && vak.top - vak.bottom > 0 ? vak : m;
}

/**
 * De maat van een bronpagina zoals ze getoond wordt: het zichtbare vak, met de
 * /Rotate van de pagina plus de draaiing die alleen in de app bestaat.
 * `rotatie` is die som (0/90/180/270, met de klok mee).
 * @returns {{ breedtePt:number, hoogtePt:number, rotatie:number }}
 */
export function weergaveMaat(page, extraRotatie = 0) {
  const vak = bronVak(page);
  const rotatie = kwartslag(kwartslag(page.getRotation()?.angle ?? 0) + kwartslag(extraRotatie));
  const b = vak.right - vak.left;
  const h = vak.top - vak.bottom;
  const gewisseld = rotatie === 90 || rotatie === 270;
  return { breedtePt: gewisseld ? h : b, hoogtePt: gewisseld ? b : h, rotatie };
}

/**
 * De matrix die de rechtop gezette pagina (oorsprong linksonder, maat
 * `plaatsing.paginaPt`) op het vel zet: `plaatsing.pagina` staat in mm vanaf
 * de linkerbovenhoek van het vel, PDF rekent in pt vanaf linksonder.
 * @param {number} velHoogtePt  hoogte van de pagina in de print-PDF
 * @returns {number[]} [a b c d e f]
 */
export function paginaOpVelMatrix(plaatsing, velHoogtePt) {
  // Onbekend papier: de pagina is het vel, zonder afrondingsverschil.
  if (plaatsing.bekend === false) return [1, 0, 0, 1, 0, 0];
  const r = plaatsing.pagina;
  const s = plaatsing.schaal;
  return [s, 0, 0, s, r.x * PT_PER_MM, velHoogtePt - (r.y + r.hoogte) * PT_PER_MM];
}

/**
 * Een vak in pixels van het beeld van `deel` (renderDeel) als rechthoek in mm
 * op het vel: het beeld wordt over `deel.opVel` uitgerekt, een uitsnede ervan
 * dus naar verhouding.
 */
export function vakOpVel(deel, vak) {
  const kx = deel.opVel.breedte / deel.px.breedte;
  const ky = deel.opVel.hoogte / deel.px.hoogte;
  return {
    x: deel.opVel.x + vak.x * kx,
    y: deel.opVel.y + vak.y * ky,
    breedte: vak.breedte * kx,
    hoogte: vak.hoogte * ky,
  };
}

// --- waar staat iets op het beeld van de markeringen? ------------------------------

/**
 * Raster van tegels van `tegel` pixels over een beeld van `breedte` x `hoogte`
 * pixels. `markeer` krijgt een band RGBA-pixels (rijen `bandY` tot
 * `bandY + bandHoogte`) en zet elke tegel met een niet-doorzichtige pixel op
 * bezet. Per band, zodat een beeld van een A0 op 300 dpi niet in één keer in
 * het geheugen hoeft.
 */
export function maakTegelRaster(breedte, hoogte, tegel = 256) {
  const kolommen = Math.max(1, Math.ceil(breedte / tegel));
  const rijen = Math.max(1, Math.ceil(hoogte / tegel));
  const bezet = new Uint8Array(kolommen * rijen);
  return {
    breedte, hoogte, tegel, kolommen, rijen, bezet,
    markeer(rgba, bandY, bandHoogte) {
      for (let y = 0; y < bandHoogte; y++) {
        const rij = Math.floor((bandY + y) / tegel);
        if (rij >= rijen) break;
        const basis = rij * kolommen;
        const begin = y * breedte * 4 + 3;
        for (let x = 0; x < breedte; x++) {
          const kolom = Math.floor(x / tegel);
          if (bezet[basis + kolom]) {
            // Deze tegel is al bezet: door naar de volgende tegel.
            x = (kolom + 1) * tegel - 1;
            continue;
          }
          if (rgba[begin + x * 4] !== 0) bezet[basis + kolom] = 1;
        }
      }
    },
  };
}

/**
 * De bezette tegels als rechthoeken in pixels die elkaar NIET overlappen: per
 * aaneengesloten groep tegels (ook schuin) de omhullende, en omhullenden die
 * elkaar raken samengevoegd tot er geen overlap meer is. Overlap zou een
 * doorzichtige markering twee keer tekenen, en dus donkerder.
 * Gesorteerd van boven naar beneden, van links naar rechts.
 * @returns {{x:number, y:number, breedte:number, hoogte:number}[]}
 */
export function vakkenUitRaster(raster) {
  const { kolommen, rijen, bezet, tegel, breedte, hoogte } = raster;
  const gezien = new Uint8Array(bezet.length);
  let vakken = [];
  for (let start = 0; start < bezet.length; start++) {
    if (!bezet[start] || gezien[start]) continue;
    const vak = { k0: kolommen, r0: rijen, k1: -1, r1: -1 };
    const stapel = [start];
    gezien[start] = 1;
    while (stapel.length) {
      const i = stapel.pop();
      const k = i % kolommen;
      const r = (i - k) / kolommen;
      vak.k0 = Math.min(vak.k0, k); vak.k1 = Math.max(vak.k1, k);
      vak.r0 = Math.min(vak.r0, r); vak.r1 = Math.max(vak.r1, r);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dk = -1; dk <= 1; dk++) {
          const nk = k + dk;
          const nr = r + dr;
          if (nk < 0 || nr < 0 || nk >= kolommen || nr >= rijen) continue;
          const n = nr * kolommen + nk;
          if (bezet[n] && !gezien[n]) { gezien[n] = 1; stapel.push(n); }
        }
      }
    }
    vakken.push(vak);
  }
  // Samenvoegen tot niets meer overlapt.
  const overlapt = (a, b) => a.k0 <= b.k1 && b.k0 <= a.k1 && a.r0 <= b.r1 && b.r0 <= a.r1;
  let samengevoegd = true;
  while (samengevoegd) {
    samengevoegd = false;
    const uit = [];
    for (const vak of vakken) {
      const ander = uit.find((u) => overlapt(u, vak));
      if (ander) {
        ander.k0 = Math.min(ander.k0, vak.k0); ander.k1 = Math.max(ander.k1, vak.k1);
        ander.r0 = Math.min(ander.r0, vak.r0); ander.r1 = Math.max(ander.r1, vak.r1);
        samengevoegd = true;
      } else {
        uit.push({ ...vak });
      }
    }
    vakken = uit;
  }
  return vakken
    .sort((a, b) => a.r0 - b.r0 || a.k0 - b.k0)
    .map((v) => {
      const x = v.k0 * tegel;
      const y = v.r0 * tegel;
      return {
        x,
        y,
        breedte: Math.min(breedte, (v.k1 + 1) * tegel) - x,
        hoogte: Math.min(hoogte, (v.r1 + 1) * tegel) - y,
      };
    });
}

// --- geen resten van de bron ---------------------------------------------------------

/**
 * Haalt elk object weg dat vanaf de trailer niet te bereiken is. pdf-lib
 * kopieert bij `embedPages` de hele bronpagina (met haar annotaties, en via
 * koppelingen ook andere pagina's) en gebruikt daarna alleen de inhoud en de
 * hulpbronnen; de rest blijft als wees in het bestand staan en wordt gewoon
 * weggeschreven. Aanroepen NA `await pdf.flush()`: pas dan staan de ingebedde
 * pagina's in de context.
 * @returns {number} het aantal verwijderde objecten
 */
export function verwijderOnbereikbaar(pdf) {
  const { context } = pdf;
  const info = context.trailerInfo;
  const gezien = new Set();
  const stapel = [info.Root, info.Info, info.Encrypt, info.ID].filter(Boolean);
  while (stapel.length) {
    let o = stapel.pop();
    if (o instanceof PDFRef) {
      if (gezien.has(o.tag)) continue;
      gezien.add(o.tag);
      o = context.lookup(o);
      if (!o) continue;
    }
    if (o instanceof PDFDict) for (const [, v] of o.entries()) stapel.push(v);
    else if (o instanceof PDFArray) for (const v of o.asArray()) stapel.push(v);
    else if (o instanceof PDFStream) for (const [, v] of o.dict.entries()) stapel.push(v);
  }
  let weg = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!gezien.has(ref.tag)) {
      context.delete(ref);
      weg++;
    }
  }
  return weg;
}

// --- de print-PDF ------------------------------------------------------------------------

/**
 * Bouwt de print-PDF met de bronpagina's als vectoren. Print niets en schrijft
 * niets weg; de aanroeper bewaart `pdf.save()`.
 *
 * @param {{
 *   bronBytes: Uint8Array,
 *   paginas: { index:number, extraRotatie?:number }[],
 *     index = 0-gebaseerd in de bron; extraRotatie = draaiing die alleen in de
 *     app bestaat (0/90/180/270);
 *   keuzes: { papier: {breedteMm:number, hoogteMm:number, bedrukbaar?:object}|null,
 *             orientatie?: 'auto'|'portrait'|'landscape',
 *             schaling?: string, zoom?: number, centreren?: boolean },
 *     dezelfde keuzes als het voorbeeld (berekenPlaatsing); papier null = elke
 *     pagina op haar eigen maat;
 *   beelden?: (p: { index:number, volgnummer:number, plaatsing:object }) =>
 *             Promise<{ png:Uint8Array, opVel:{x:number,y:number,breedte:number,hoogte:number} }[]>,
 *     de markeringen van die pagina als doorzichtige PNG's met hun plek in mm
 *     op het vel (linksboven); ze komen bovenop de vectoren;
 *   voortgang?: (volgnummer:number, index:number) => void,
 * }} opts
 * @returns {Promise<{ pdf: PDFDocument, opVel: boolean }>}
 */
export async function bouwVectorPrintPdf({
  bronBytes, paginas, keuzes, beelden = async () => [], voortgang = () => {},
}) {
  const bron = await PDFDocument.load(bronBytes);
  const pdf = await PDFDocument.create();
  const aantal = bron.getPageCount();

  // Per pagina: het vak, de draaiing en de plaatsing op het vel.
  const werk = paginas.map(({ index, extraRotatie = 0 }) => {
    if (!Number.isInteger(index) || index < 0 || index >= aantal) {
      throw new Error(`page ${index + 1} does not exist in the source document`);
    }
    const page = bron.getPage(index);
    const maat = weergaveMaat(page, extraRotatie);
    const plaatsing = berekenPlaatsing({
      ...keuzes,
      pagina: { breedtePt: maat.breedtePt, hoogtePt: maat.hoogtePt },
    });
    if (!plaatsing) throw new Error(`page ${index + 1} has no usable size`);
    // De annotaties van de bron horen niet in de vorm (de app tekent haar eigen
    // markeringen) en zouden bij het kopiëren andere pagina's meeslepen.
    page.node.delete(PDFName.of('Annots'));
    const vak = bronVak(page);
    // Rechtop zetten: de draaiing van de getoonde pagina plus de kwartslag
    // voor een pagina die haaks op het vel staat.
    const { matrix } = knipselMatrix(vak, kwartslag(maat.rotatie + plaatsing.draaiing));
    return { index, page, vak, matrix, plaatsing };
  });

  // Eén aanroep voor alle pagina's: zo deelt pdf-lib één kopieerder en komt
  // een lettertype of beeld dat op meer pagina's staat maar één keer mee.
  const vormen = werk.length
    ? await pdf.embedPages(werk.map((w) => w.page), werk.map((w) => w.vak), werk.map((w) => w.matrix))
    : [];

  let opVel = false;
  for (let i = 0; i < werk.length; i++) {
    const { index, plaatsing } = werk[i];
    voortgang(i, index);
    opVel = plaatsing.bekend;
    const maat = plaatsing.bekend
      ? [plaatsing.vel.breedteMm * PT_PER_MM, plaatsing.vel.hoogteMm * PT_PER_MM]
      : [plaatsing.paginaPt.breedtePt, plaatsing.paginaPt.hoogtePt];
    const pagina = pdf.addPage(maat);

    // Niet via page.drawPage: die schaalt met de maat van het ongedraaide vak
    // en vervormt dus een gedraaide pagina (zie saver/vector-snippet.js).
    const naam = pagina.node.newXObject('OPSPagina', vormen[i].ref);
    pagina.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(...paginaOpVelMatrix(plaatsing, maat[1])),
      drawObject(naam),
      popGraphicsState(),
    );

    const k = maat[0] / plaatsing.vel.breedteMm;
    for (const beeld of await beelden({ index, volgnummer: i, plaatsing })) {
      const png = await pdf.embedPng(beeld.png);
      const r = beeld.opVel;
      const beeldNaam = pagina.node.newXObject('OPSMarkering', png.ref);
      pagina.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(r.breedte * k, 0, 0, r.hoogte * k, r.x * k, maat[1] - (r.y + r.hoogte) * k),
        drawObject(beeldNaam),
        popGraphicsState(),
      );
    }
  }

  // Pas na flush staan de vormen in de context; daarna de wezen weg.
  await pdf.flush();
  verwijderOnbereikbaar(pdf);
  return { pdf, opVel };
}
