// Bijlage-annotaties (/FileAttachment, ISO 32000 12.5.6.15, #376): een
// pictogram op de pagina met een ingesloten bestand erachter.
//
// - bouwBijlageAnnotatie schrijft de annotatie: /Subtype /FileAttachment,
//   /FS naar een bestandsspecificatie met /EF (zie maakBestandsspecificatie
//   in bijlagen.js), /Name (het pictogram), /Contents (de beschrijving), /AF
//   (PDF 2.0: het bestand is aan deze annotatie geassocieerd) en een eigen
//   appearance, zodat elke lezer hetzelfde pictogram tekent.
// - leesBijlageAnnotatie leest dat terug, ook van een ander programma.
// - bijlageVingerafdruk en origineleBijlage: een geladen bijlage-annotatie
//   waarvan de inhoud niet te lezen is, mag bij het opslaan het ingesloten
//   bestand niet kwijtraken. Onbewerkt blijft het origineel ongemoeid (met
//   zijn eigen /FS, /AP en wat de app niet kent); bewerkt krijgt de nieuwe
//   annotatie de oorspronkelijke bestandsspecificatie.
//
// Puur pdf-lib, geen app-imports: zo is het in node te testen.

import { PDFName, PDFString, PDFHexString, PDFDict, PDFRef } from 'pdf-lib';
import { maakBestandsspecificatie, leesBestandsspecificatie } from './bijlagen.js';
import { bijlageIcoonContent, bijlageIcoonNaarPdf, bijlageIcoonUitPdf } from '../annotations/bijlage-iconen.js';
import { refVanPdfjsId } from './laag-ids.js';

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
 * @param {import('pdf-lib').PDFObject} [p.bestaandeFs]  de oorspronkelijke
 *   bestandsspecificatie, voor als de inhoud niet te lezen was
 * @returns {import('pdf-lib').PDFDict|null} null zonder bestandsnaam
 */
export function bouwBijlageAnnotatie(pdfDoc, p) {
  const { context } = pdfDoc;
  const b = p.bestand;
  if (!b || !b.naam) return null;
  // Zonder inhoud de oorspronkelijke bestandsspecificatie (zie de kop), en
  // anders (een verwijzing naar een extern bestand) een zonder /EF: /FS is
  // verplicht.
  const fs = (b.bytes || b.ruw) ? maakBestandsspecificatie(pdfDoc, b) : p.bestaandeFs ? p.bestaandeFs : context.register(context.obj({
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
  // /AF bevat bestandsspecificaties; een /FS als losse tekenreeks hoort er niet in.
  if (!(fs instanceof PDFRef || fs instanceof PDFDict)) dict.delete(PDFName.of('AF'));
  return dict;
}

const rond = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v ?? null);

// Wat de gebruiker aan een bijlage-annotatie kan veranderen en wat de saver
// ervan schrijft. Antwoorden en reviewstatus horen er niet bij: die gaan als
// eigen /Text-annotaties met /IRT het bestand in, ook naast een origineel.
const BEWERKBAAR = [
  'x', 'y', 'width', 'height', 'rotation', 'icon', 'color', 'opacity', 'text', 'subject', 'pdfSubject',
  'author', 'locked', 'printable', 'readOnly', 'hidden', 'layer', 'altText', 'ifcCategory', 'spatialZone',
  'locationOverride', 'blendMode', 'nm',
];
const BESTAND = ['name', 'description', 'mime', 'size', 'createdAt', 'modifiedAt', 'relationship', 'external'];

/** Vingerafdruk van wat aan een bijlage-annotatie te bewerken is (zie de kop). */
export function bijlageVingerafdruk(ann) {
  const a = ann || {};
  const b = a.attachment || {};
  return JSON.stringify([BEWERKBAAR.map((k) => rond(a[k])), BESTAND.map((k) => rond(b[k]))]);
}

/**
 * Waar een geladen bijlage-annotatie vandaan kwam: het object van de
 * annotatie (pdf.js-id) en de vingerafdruk zoals geladen. Ook de
 * bestandsspecificatie, als die een eigen object is.
 */
export function bijlageBron(ann, pdfjsId, fsRef = null) {
  return { ref: pdfjsId || null, fs: fsRef || null, staat: bijlageVingerafdruk(ann) };
}

/** Is een geladen bijlage-annotatie sinds het laden veranderd? Nieuw telt als veranderd. */
export function bijlageBewerkt(ann) {
  const bron = ann?.attachment?.bron;
  return !bron || bron.staat !== bijlageVingerafdruk(ann);
}

function refUitId(id) {
  const r = refVanPdfjsId(id);
  return r ? PDFRef.of(r.nummer, r.generatie) : null;
}

/**
 * Het origineel van een geladen bijlage-annotatie in het uitvoerdocument.
 * @param {import('pdf-lib').PDFContext} context
 * @param {PDFRef[]} kandidaten  de bijlage-annotaties van de pagina die het
 *   model vervangt (de saver haalt ze weg en schrijft het model opnieuw)
 * @param {object} ann  het model
 * @returns {null|{ref: PDFRef|null, fs: import('pdf-lib').PDFObject}}
 *   ref: de annotatie zelf als die nog op de pagina staat; fs: haar
 *   bestandsspecificatie (of die van het oorspronkelijke /FS-object)
 */
export function origineleBijlage(context, kandidaten, ann) {
  const bron = ann?.attachment?.bron;
  if (!bron) return null;
  const doel = refUitId(bron.ref);
  const nm = ann.nm != null ? String(ann.nm) : '';
  for (const ref of kandidaten || []) {
    if (!(ref instanceof PDFRef)) continue;
    const dict = context.lookup(ref);
    if (!(dict instanceof PDFDict) || dict.lookup(PDFName.of('Subtype'))?.toString() !== '/FileAttachment') continue;
    const opRef = doel && ref.objectNumber === doel.objectNumber && ref.generationNumber === doel.generationNumber;
    const nmVal = dict.lookup(PDFName.of('NM'));
    const opNaam = nm && typeof nmVal?.decodeText === 'function' && nmVal.decodeText() === nm;
    if (!opRef && !opNaam) continue;
    const fs = dict.get(PDFName.of('FS'));
    if (fs !== undefined) return { ref, fs };
  }
  // De annotatie zelf is er niet meer (bijvoorbeeld al eens herschreven):
  // dan nog haar bestandsspecificatie, als die nog een bestand met /EF is.
  const fsRef = refUitId(bron.fs);
  const fs = fsRef ? context.lookup(fsRef) : null;
  if (fs instanceof PDFDict && fs.lookup(PDFName.of('EF')) instanceof PDFDict) return { ref: null, fs: fsRef };
  return null;
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
