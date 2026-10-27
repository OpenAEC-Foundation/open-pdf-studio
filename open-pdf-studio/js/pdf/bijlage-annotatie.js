// Bijlage-annotaties (/FileAttachment, ISO 32000 12.5.6.15, #376): een
// pictogram op de pagina met een ingesloten bestand erachter.
//
// - bouwBijlageAnnotatie schrijft de annotatie: /Subtype /FileAttachment,
//   /FS naar een bestandsspecificatie met /EF (zie maakBestandsspecificatie
//   in bijlagen.js), /Name (het pictogram), /Contents (de beschrijving), /AF
//   (PDF 2.0: het bestand is aan deze annotatie geassocieerd) en een eigen
//   appearance, zodat elke lezer hetzelfde pictogram tekent.
// - leesBijlageAnnotatie leest dat terug, ook van een ander programma.
//
// Puur pdf-lib, geen app-imports: zo is het in node te testen.

import { PDFName, PDFString, PDFHexString, PDFDict } from 'pdf-lib';
import { maakBestandsspecificatie, leesBestandsspecificatie } from './bijlagen.js';
import { bijlageIcoonContent, bijlageIcoonNaarPdf, bijlageIcoonUitPdf } from '../annotations/bijlage-iconen.js';

/**
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {object} p
 * @param {number[]} p.rect           [x1, y1, x2, y2] in PDF-ruimte
 * @param {string} [p.icoon]          paperclip | pushpin | graph | tag
 * @param {string} [p.kleur]          #rrggbb
 * @param {number[]} [p.kleurArray]   /C
 * @param {number} [p.opacity]
 * @param {string} [p.tekst]          /Contents
 * @param {import('pdf-lib').PDFObject} [p.auteur]   /T
 * @param {number} [p.flags]          /F
 * @param {object} p.bestand          { naam, bytes | ruw, mime, beschrijving, aangemaakt, gewijzigd }
 * @param {(s:string)=>import('pdf-lib').PDFObject} p.tekstObj  tekst als PDF-tekenreeks
 * @returns {import('pdf-lib').PDFDict|null} null zonder bestandsnaam
 */
export function bouwBijlageAnnotatie(pdfDoc, p) {
  const { context } = pdfDoc;
  const b = p.bestand;
  if (!b || !b.naam) return null;
  // Zonder inhoud (een verwijzing naar een extern bestand, of een inhoud die
  // niet te lezen was) een bestandsspecificatie zonder /EF: /FS is verplicht.
  const fs = (b.bytes || b.ruw) ? maakBestandsspecificatie(pdfDoc, b) : context.register(context.obj({
    Type: 'Filespec', F: PDFHexString.fromText(b.naam), UF: PDFHexString.fromText(b.naam),
    Desc: PDFHexString.fromText(b.beschrijving || b.naam),
  }));
  const [x1, y1, x2, y2] = p.rect;
  const w = Math.abs(x2 - x1) || 24;
  const h = Math.abs(y2 - y1) || 24;
  const rect = [Math.min(x1, x2), Math.min(y1, y2), Math.min(x1, x2) + w, Math.min(y1, y2) + h];
  const ap = context.register(context.stream(bijlageIcoonContent(p.icoon, w, h, p.kleur), {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h],
  }));
  const dict = context.obj({
    Type: 'Annot',
    Subtype: 'FileAttachment',
    Rect: rect,
    FS: fs,
    Name: bijlageIcoonNaarPdf(p.icoon),
    Contents: p.tekstObj(p.tekst || b.beschrijving || b.naam),
    C: p.kleurArray || [0.17, 0.34, 0.6],
    CA: p.opacity ?? 1,
    M: PDFString.fromDate(new Date()),
    F: p.flags ?? 4,
    AF: [fs],
    AP: { N: ap },
  });
  if (p.auteur) dict.set(PDFName.of('T'), p.auteur);
  return dict;
}

/**
 * Het bestand en het pictogram van een /FileAttachment-woordenboek.
 * @returns {null|{icoon:string, bestand:ReturnType<typeof leesBestandsspecificatie>}}
 */
export function leesBijlageAnnotatie(context, annotDict) {
  if (!(annotDict instanceof PDFDict)) return null;
  if (annotDict.lookup(PDFName.of('Subtype'))?.toString() !== '/FileAttachment') return null;
  const bestand = leesBestandsspecificatie(context, annotDict.get(PDFName.of('FS')));
  if (!bestand) return null;
  const naam = annotDict.lookup(PDFName.of('Name'));
  return { icoon: bijlageIcoonUitPdf(naam instanceof PDFName ? naam.decodeText() : 'PushPin'), bestand };
}
