// Eigenschappen die elke annotatiesoort heeft, bij het opslaan (#619).
//
// Waar de PDF-specificatie een sleutel heeft, gaat het daarheen:
// - naam -> /NM (per pagina uniek);
// - onderwerp -> /Subj (zie onderwerpPlek in loader/annotatie-opmerking.js);
// - koppeling naar een andere annotatie -> /IRT, met /RT /Group bij een groep;
// - antwoorden -> elk een /Text met /IRT naar de annotatie;
// - reviewstatus en gemarkeerd -> een verborgen /Text met /IRT, /State en
//   /StateModel (Review of Marked). /F heeft geen bit voor 'gemarkeerd': bit
//   2 is Hidden en zou de annotatie in elke lezer onzichtbaar maken.
// Alleen wat de specificatie niet kent, krijgt een eigen sleutel: de
// alternatieve tekst (/OPS_AltText), de IFC-categorie (/OPS_IfcCategory) en
// het merkteken van een eigen antwoord (/OPS_Subtype reply), zodat de lader
// het weer onder de annotatie zet.
//
// De lader leest dit in loader/annotatie-algemeen.js en
// loader/annotaties-omzetten.js. Alleen pdf-lib: ook in node te testen.

import { zoneDefinition } from '../../annotations/spatial-zones.js';
import { PDFName, PDFString, PDFRef } from 'pdf-lib';
import { pdfTextString } from './pdf-text.js';
import { onderwerpPlek } from '../loader/annotatie-opmerking.js';

const N = (naam) => PDFName.of(naam);

function pdfDatum(iso) {
  const d = iso ? new Date(iso) : new Date();
  return PDFString.fromDate(Number.isNaN(d.getTime()) ? new Date() : d);
}

/**
 * /NM, /Subj, /OPS_AltText en /OPS_IfcCategory. Wat de tak van de soort al
 * schreef (een stempel zijn /Subj, een correctie haar /NM) blijft staan.
 * @param {Set<string>} [gebruikteNm]  de namen die al op de pagina staan
 */
export function schrijfAlgemeneSleutels(dict, ann, gebruikteNm) {
  if (!dict || typeof dict.set !== 'function' || !ann) return;
  const heeft = (sleutel) => dict.get(N(sleutel)) !== undefined;
  const nm = ann.nm != null ? String(ann.nm) : '';
  if (nm && !heeft('NM') && !gebruikteNm?.has(nm)) {
    gebruikteNm?.add(nm);
    dict.set(N('NM'), pdfTextString(nm));
  }
  if (!heeft('Subj')) {
    const plek = onderwerpPlek(ann.type);
    const onderwerp = plek === 'subj' ? ann.subject : plek === 'contents' ? ann.pdfSubject : '';
    if (onderwerp) dict.set(N('Subj'), pdfTextString(String(onderwerp)));
  }
  const zone = zoneDefinition(ann.spatialZone);
  if (zone) dict.set(N('OPS_SpatialZone'), pdfTextString(JSON.stringify(zone)));
  if (typeof ann.locationOverride === 'string') dict.set(N('OPS_LocationOverride'), pdfTextString(ann.locationOverride.slice(0, 1000)));
  if (ann.altText) dict.set(N('OPS_AltText'), pdfTextString(String(ann.altText)));
  if (ann.ifcCategory && !heeft('OPS_IfcCategory')) {
    dict.set(N('OPS_IfcCategory'), pdfTextString(String(ann.ifcCategory)));
  }
}

/**
 * De /Text-annotaties die bij een annotatie horen: haar reviewstatus, of ze
 * gemarkeerd is, en haar antwoorden. Elk met /IRT naar `ouderRef`.
 * @param {import('pdf-lib').PDFContext} context
 * @param {object} ann  het model
 * @param {PDFRef} ouderRef
 * @param {import('pdf-lib').PDFDict} ouderDict
 * @param {Set<string>} [gebruikteNm]  /NM per pagina uniek (een geplakte kopie
 *   draagt dezelfde antwoorden mee)
 * @param {{zonderStatus?: boolean, zonderAntwoorden?: boolean}} [opties]
 *   status of antwoorden niet maken: de saver liet die uit het bestand staan
 *   (#629, saver/bron-behoud.js)
 * @returns {import('pdf-lib').PDFDict[]}
 */
export function antwoordAnnotaties(context, ann, ouderRef, ouderDict, gebruikteNm, { zonderStatus = false, zonderAntwoorden = false } = {}) {
  const uit = [];
  if (!ann || !(ouderRef instanceof PDFRef) || !ouderDict) return uit;
  const ouderRect = ouderDict.get(N('Rect'));

  // Reviewstatus (#308): verborgen, de status hoort bij de annotatie zelf.
  if (!zonderStatus && ann.status && ann.status !== 'none') {
    const stateStr = String(ann.status).charAt(0).toUpperCase() + String(ann.status).slice(1);
    const datum = pdfDatum(ann.statusAt);
    const st = context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Contents: pdfTextString(stateStr),
      T: pdfTextString(ann.statusBy || ann.author || 'User'),
      M: datum,
      CreationDate: datum,
      F: 30, // Hidden + Print + NoZoom + NoRotate — niet los tonen
      State: pdfTextString(stateStr),
      StateModel: PDFString.of('Review'),
    });
    st.set(N('Rect'), ouderRect);
    st.set(N('IRT'), ouderRef);
    uit.push(st);
  }

  // Gemarkeerd: het statusmodel Marked, net zo verborgen.
  if (!zonderStatus && ann.marked) {
    const datum = pdfDatum(ann.modifiedAt);
    const mk = context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Contents: PDFString.of('Marked'),
      T: pdfTextString(ann.author || 'User'),
      M: datum,
      CreationDate: datum,
      F: 30,
      State: PDFString.of('Marked'),
      StateModel: PDFString.of('Marked'),
    });
    mk.set(N('Rect'), ouderRect);
    mk.set(N('IRT'), ouderRef);
    uit.push(mk);
  }

  // Antwoorden: een notitie in de linkerbovenhoek van de annotatie, zoals een
  // lezer zonder discussievenster haar toont.
  const replies = !zonderAntwoorden && Array.isArray(ann.replies) ? ann.replies : [];
  if (replies.length) {
    const r = Array.isArray(ouderRect?.asArray?.()) ? ouderRect.asArray().map((v) => v.asNumber?.() ?? 0) : null;
    const links = r ? Math.min(r[0], r[2]) : 0;
    const boven = r ? Math.max(r[1], r[3]) : 0;
    for (const reply of replies) {
      if (!reply) continue;
      const datum = pdfDatum(reply.createdAt);
      const rp = context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [links, boven - 24, links + 24, boven],
        Contents: pdfTextString(String(reply.text ?? '')),
        T: pdfTextString(String(reply.author || 'User')),
        M: datum,
        CreationDate: datum,
        Name: 'Comment',
        F: 28, // Print + NoZoom + NoRotate
        OPS_Subtype: PDFString.of('reply'),
      });
      const nm = reply.id != null ? String(reply.id) : '';
      if (nm && !gebruikteNm?.has(nm)) {
        gebruikteNm?.add(nm);
        rp.set(N('NM'), pdfTextString(nm));
      }
      rp.set(N('IRT'), ouderRef);
      uit.push(rp);
    }
  }
  return uit;
}

// Proefleescorrecties koppelt applyGroupLinks (correction-dicts.js).
const CORRECTIE_SOORTEN = new Set(['caret', 'textStrikethrough']);

/**
 * /IRT (en /RT /Group bij een groep) voor annotaties met `inReplyTo`, als
 * hun doel op dezelfde pagina geschreven is. Een koppeling die er al staat
 * (een vervanging, een aanhaallijn) blijft zoals hij is.
 * @param {object[]} annotaties  de modellen van de pagina
 * @param {Map<string, PDFRef>} refById
 * @param {Map<string, import('pdf-lib').PDFDict>} dictById
 * @returns {number} aantal gekoppelde annotaties
 */
export function schrijfKoppelingen(annotaties, refById, dictById) {
  let aantal = 0;
  for (const ann of annotaties || []) {
    if (!ann || ann.inReplyTo == null || CORRECTIE_SOORTEN.has(ann.type)) continue;
    const dict = dictById.get(ann.id);
    const doel = refById.get(ann.inReplyTo);
    if (!dict || !(doel instanceof PDFRef) || ann.inReplyTo === ann.id) continue;
    if (dict.get(N('IRT')) !== undefined) continue;
    dict.set(N('IRT'), doel);
    if (String(ann.replyType || '').toLowerCase() === 'group') dict.set(N('RT'), N('Group'));
    aantal++;
  }
  return aantal;
}
