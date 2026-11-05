// Het menu "Meer" van de mobiele werkbalk (#953): de dagelijkse functies die
// op het bureaublad in het lint en het contextmenu staan, maar op mobiel
// (zonder toetsenbord en rechtermuisknop) niet te bereiken waren: delen,
// een afbeelding of foto invoegen, een document scannen met de camera, en
// markeringen kopiëren, plakken en verwijderen.
//
// Elk item heeft een eigen handler in MobileApp.jsx en een label in
// common.json van elke taal; mobiele-acties.test.mjs bewaakt beide. Wanneer
// een item uit staat, is puur en ook daar getest.

export const MOBIELE_ACTIES = Object.freeze([
  Object.freeze({ id: 'share', label: 'share.share' }),
  Object.freeze({ id: 'insertImage', label: 'mobileMore.insertImage' }),
  Object.freeze({ id: 'takePhoto', label: 'mobileMore.takePhoto' }),
  Object.freeze({ id: 'scanDocument', label: 'mobileMore.scanDocument' }),
  Object.freeze({ id: 'copyMarkup', label: 'mobileMore.copyMarkup' }),
  Object.freeze({ id: 'pasteMarkup', label: 'mobileMore.pasteMarkup' }),
  Object.freeze({ id: 'deleteMarkup', label: 'mobileMore.deleteMarkup' }),
]);

/** De geselecteerde markeringen van een document (meervoudig of enkel). */
export function geselecteerdeMarkeringen(doc) {
  if (!doc) return [];
  const veel = Array.isArray(doc.selectedAnnotations) ? doc.selectedAnnotations.filter(Boolean) : [];
  if (veel.length > 0) return veel;
  return doc.selectedAnnotation ? [doc.selectedAnnotation] : [];
}

/** Staat er iets op het interne klembord voor markeringen? */
export function heeftKlembord(state) {
  return !!(state?.clipboardAnnotations?.length || state?.clipboardAnnotation);
}

/**
 * Staat een actie uit?
 * @param {string} id
 * @param {{ doc: object|null, state: object }} o
 */
export function actieUit(id, { doc, state }) {
  if (id === 'scanDocument') return false; // maakt zo nodig een nieuw document
  if (!doc?.pdfDoc) return true;
  if (id === 'copyMarkup') return geselecteerdeMarkeringen(doc).length === 0;
  if (id === 'deleteMarkup') {
    const sel = geselecteerdeMarkeringen(doc);
    return sel.length === 0 || sel.every((a) => a.locked);
  }
  if (id === 'pasteMarkup') return !heeftKlembord(state);
  return false;
}
