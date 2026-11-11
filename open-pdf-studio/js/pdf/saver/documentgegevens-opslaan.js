// Documentgegevens (#1017) in het pdf-lib-document schrijven: /Info en het
// XMP-pakket van de catalogus. Het model en de XMP-bewerking staan in
// ../documentgegevens.js.

import { PDFName, PDFString, PDFHexString, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';
import { leesPdfDatum } from '../pdfa/xmp.js';
import { BEWERKBARE_VELDEN, INFO_SLEUTEL, normaliseerWaarde, werkXmpBij } from '../documentgegevens.js';

function tekstVan(obj) {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    try { return obj.decodeText(); } catch { return null; }
  }
  return null;
}

function leesXmp(pdfDocLib) {
  const ref = pdfDocLib.catalog.get(PDFName.of('Metadata'));
  if (!ref) return null;
  const obj = ref instanceof PDFRef ? pdfDocLib.context.lookup(ref) : ref;
  let bytes = null;
  if (obj instanceof PDFRawStream) bytes = decodePDFRawStream(obj).decode();
  else if (typeof obj?.getContents === 'function') bytes = obj.getContents();
  if (!bytes) return null;
  return { ref, xml: new TextDecoder().decode(bytes) };
}

/**
 * Schrijft de overlay in /Info en het XMP-pakket van een pdf-lib-document.
 * Velden die al zo in /Info staan, en een XMP dat niet verandert, blijven
 * ongemoeid.
 * @param {import('pdf-lib').PDFDocument} pdfDocLib
 * @param {Record<string,string>|null|undefined} overlay
 * @returns {{ info: string[], xmp: boolean }} wat er veranderde
 */
export function schrijfDocumentgegevens(pdfDocLib, overlay) {
  const uitkomst = { info: [], xmp: false };
  const velden = overlay ? BEWERKBARE_VELDEN.filter((v) => Object.prototype.hasOwnProperty.call(overlay, v)) : [];
  if (!velden.length) return uitkomst;
  const info = pdfDocLib.getInfoDict();
  const waarden = {};
  for (const veld of velden) {
    const waarde = normaliseerWaarde(overlay[veld]);
    waarden[veld] = waarde;
    const sleutel = PDFName.of(INFO_SLEUTEL[veld]);
    const huidig = tekstVan(info.lookup(sleutel));
    if (waarde === '') {
      if (info.has(sleutel)) { info.delete(sleutel); uitkomst.info.push(veld); }
    } else if (huidig !== waarde) {
      // Zoals pdf-lib zelf (setTitle e.d.): UTF-16 met BOM, elk teken veilig.
      info.set(sleutel, PDFHexString.fromText(waarde));
      uitkomst.info.push(veld);
    }
  }
  try {
    const xmp = leesXmp(pdfDocLib);
    if (xmp) {
      const modDate = leesPdfDatum(tekstVan(info.lookup(PDFName.of('ModDate'))) || '');
      const nieuw = werkXmpBij(xmp.xml, waarden, { wijzigTijd: modDate || new Date() });
      if (nieuw !== xmp.xml) {
        // Onversleuteld en ongecomprimeerd, zoals XMP hoort; pdf-lib-stromen
        // zijn niet ter plekke te wijzigen, dus een nieuwe stroom op dezelfde ref.
        const stroom = pdfDocLib.context.stream(new TextEncoder().encode(nieuw), { Type: 'Metadata', Subtype: 'XML' });
        if (xmp.ref instanceof PDFRef) pdfDocLib.context.assign(xmp.ref, stroom);
        else pdfDocLib.catalog.set(PDFName.of('Metadata'), pdfDocLib.context.register(stroom));
        uitkomst.xmp = true;
      }
    }
  } catch (e) {
    console.warn('[documentgegevens] XMP niet bijgewerkt:', e?.message || e);
  }
  return uitkomst;
}
