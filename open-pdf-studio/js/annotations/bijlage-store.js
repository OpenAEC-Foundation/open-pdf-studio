// De bytes van de bestanden achter bijlage-annotaties (#376).
//
// Het model van een annotatie wordt bij ongedaan maken, kopiëren en in de
// store als JSON gekloond; een Uint8Array overleeft dat niet. De annotatie
// draagt daarom alleen een sleutel (`attachment.key`), de bytes staan hier.
// Een opgeslagen inhoud verandert nooit: een kopie van de annotatie deelt
// dezelfde sleutel zonder dat er iets misgaat.
//
// Een item is óf { bytes } (de echte inhoud), óf { ruw: { bytes, filter,
// decodeParms } } voor een stroom die niet te decoderen was: die gaat bij het
// opslaan ongewijzigd terug het bestand in.
//
// Puur: geen app-imports.

const items = new Map();
let teller = 0;

/** Bewaart een inhoud en geeft de sleutel. */
export function bewaarBijlageInhoud(item) {
  teller += 1;
  const key = `bijlage_${Date.now().toString(36)}_${teller.toString(36)}`;
  items.set(key, item);
  return key;
}

/** Het item achter een sleutel, of null. */
export function bijlageItem(key) {
  return (key && items.get(key)) || null;
}

/** De gedecodeerde bytes achter een sleutel, of null. */
export function bijlageBytes(key) {
  return bijlageItem(key)?.bytes || null;
}

/** Voor tests. */
export function wisBijlageStore() {
  items.clear();
}

/**
 * De inhoud achter een bijlage-annotatie: uit de store, anders via pdf.js
 * (`attachment.pdfjsId`, als de lader het bestand nog niet met pdf-lib las).
 * Wat pdf.js levert, komt in de store; de annotatie krijgt die sleutel.
 * @param {{attachment?: {key?: string|null, pdfjsId?: string|null}}} ann
 * @param {{pdfDoc?: {getAttachmentContent?: (id: string) => Promise<Uint8Array|null>}}} [doc]
 * @returns {Promise<null|{bytes?: Uint8Array, ruw?: object}>}
 */
export async function bijlageInhoud(ann, doc) {
  const a = ann?.attachment;
  if (!a) return null;
  const item = bijlageItem(a.key);
  if (item) return item;
  if (a.pdfjsId && typeof doc?.pdfDoc?.getAttachmentContent === 'function') {
    try {
      const b = await doc.pdfDoc.getAttachmentContent(a.pdfjsId);
      if (b) {
        const nieuw = { bytes: b instanceof Uint8Array ? b : new Uint8Array(b) };
        a.key = bewaarBijlageInhoud(nieuw);
        return nieuw;
      }
    } catch (e) {
      console.warn('[bijlage] content could not be read:', e?.message || e);
    }
  }
  return null;
}
