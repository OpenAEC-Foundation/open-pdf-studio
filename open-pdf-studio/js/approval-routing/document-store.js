// Goedkeuringsroutes (#651): aanvragen bewaren bij het document.
//
// De aanvragen van een document staan in de PDF zelf, als privésleutel in de
// catalogus (zoals OPS_StylePresets):
//
//   /Root -> /OPS_ApprovalRequests (hex string, JSON)
//            { version: 1, requests: [ { record, kept: [...] } ] }
//
// `record` is het volledige auditrecord (model.js), `kept` de metadata van
// teruggekomen kopieën (de kopieën zelf staan als bijlage in het document).
// Lezen controleert alleen de vorm; verifyRequest controleert de keten.
//
// Daarnaast: wanneer telt een opslag als "het document is gewijzigd"? Het
// vastleggen van een aanvraag of beslissing markeert het document zelf als
// gewijzigd (de gegevens moeten opgeslagen worden), maar is geen nieuwe
// documentversie. Content-wijzigingen lopen via de undo-geschiedenis
// (inhoudRevisie) of via markDocumentModified, dat de vlag
// `_alleenGoedkeuringGewijzigd` weer wist.
//
// Puur pdf-lib, geen app-imports: in Node te testen.

import { PDFName, PDFString, PDFHexString } from 'pdf-lib';

export const APPROVAL_CATALOG_KEY = 'OPS_ApprovalRequests';
const LIMIT = 100;

function catalogOf(pdfDocLib) {
  const context = pdfDocLib.context;
  return context.lookup(context.trailerInfo.Root) || null;
}

/** De bewaarde vorm van een entry: alleen record en kept. */
export function storedEntries(entries) {
  return (entries || []).slice(0, LIMIT).map((e) => ({ record: e.record, kept: Array.isArray(e.kept) ? e.kept : [] }));
}

/** Schrijf de aanvragen in de catalogus; geen aanvragen = sleutel weg. */
export function writeApprovalRequests(pdfDocLib, entries) {
  const catalog = catalogOf(pdfDocLib);
  if (!catalog) return;
  const stored = storedEntries(entries);
  if (!stored.length) {
    catalog.delete(PDFName.of(APPROVAL_CATALOG_KEY));
    return;
  }
  catalog.set(PDFName.of(APPROVAL_CATALOG_KEY), PDFHexString.fromText(JSON.stringify({ version: 1, requests: stored })));
}

/** Lees de aanvragen terug; [] bij ontbreken of een kapotte waarde. */
export function readApprovalRequests(pdfDocLib) {
  try {
    const catalog = catalogOf(pdfDocLib);
    if (!catalog) return [];
    const raw = catalog.lookup(PDFName.of(APPROVAL_CATALOG_KEY));
    const tekst = raw instanceof PDFHexString || raw instanceof PDFString ? raw.decodeText() : null;
    if (!tekst) return [];
    const data = JSON.parse(tekst);
    if (data?.version !== 1 || !Array.isArray(data.requests)) return [];
    return data.requests
      .filter((e) => e && typeof e === 'object' && e.record && typeof e.record === 'object' && typeof e.record.id === 'string')
      .slice(0, LIMIT)
      .map((e) => ({
        record: e.record,
        kept: Array.isArray(e.kept) ? e.kept.filter((k) => k && typeof k.hash === 'string') : [],
      }));
  } catch {
    return [];
  }
}

/**
 * Heeft het document sinds de laatste keer laden of opslaan een inhoudelijke
 * wijziging (niet alleen goedkeuringsgegevens)?
 */
export function contentChanged(doc) {
  if (!doc?.modified) return false;
  if (!doc._alleenGoedkeuringGewijzigd) return true;
  return (doc.inhoudRevisie || 0) !== (doc._goedkeuringBasis || 0);
}

/**
 * Markeer dat alleen goedkeuringsgegevens veranderden. `markModified` is
 * markDocumentModified (wist de vlag); daarna zetten we hem, tenzij het
 * document al inhoudelijk gewijzigd was.
 */
export function markApprovalModified(doc, markModified) {
  const clean = !doc.modified;
  const onlyApproval = clean || doc._alleenGoedkeuringGewijzigd === true;
  // Een ongewijzigd document is gelijk aan het bestand: dit is de basis, ook
  // als de revisie door bewerken en ongedaan maken is opgelopen.
  if (clean) doc._goedkeuringBasis = doc.inhoudRevisie || 0;
  markModified(doc);
  doc._alleenGoedkeuringGewijzigd = onlyApproval;
}

/** Na laden of opslaan: dit is de nieuwe basisversie. */
export function resetApprovalBaseline(doc) {
  if (!doc) return;
  doc._goedkeuringBasis = doc.inhoudRevisie || 0;
  doc._alleenGoedkeuringGewijzigd = false;
}
