// Vectorknipsel — het leespad.
//
// Tegenhanger van saver/vector-snippet.js. Leest de bronpagina's terug uit het
// OPS_VectorSnippets-woordenboek op de catalogus, en de knipsel-gegevens uit
// een stempel-annotatie. Zonder deze stap zou een opgeslagen knipsel bij
// heropenen een gewone stempel zijn die je niet meer kunt verplaatsen of
// vastzetten.

import { CATALOGUS_SLEUTEL } from '../saver/vector-snippet.js';

/**
 * Haalt alle bronpagina's uit het document en zet ze in de store.
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {(bytes: Uint8Array) => string} bewaar  de store-functie
 * @returns {Promise<string[]>} de gevonden sleutels
 */
export async function leesKnipselBronnen(pdfDoc, bewaar) {
  const { PDFName, decodePDFRawStream } = await import('pdf-lib');
  const gevonden = [];
  let woordenboek;
  try {
    woordenboek = pdfDoc.catalog.lookup(PDFName.of(CATALOGUS_SLEUTEL));
  } catch {
    return gevonden;
  }
  if (!woordenboek || typeof woordenboek.keys !== 'function') return gevonden;

  for (const naam of woordenboek.keys()) {
    try {
      const stream = pdfDoc.context.lookup(woordenboek.get(naam));
      if (!stream) continue;
      const bytes = stream.dict && stream.dict.has(PDFName.of('Filter'))
        ? decodePDFRawStream(stream).decode()
        : stream.contents;
      if (!bytes || !bytes.length) continue;
      // De sleutel uit het bestand moet leidend zijn: de annotaties verwijzen
      // ernaar. bewaar() rekent zijn eigen sleutel uit; die hoort gelijk te
      // zijn, maar bij een bestand van een andere versie kan dat afwijken.
      const bestandssleutel = naam.asString().replace(/^\//, '');
      gevonden.push({ sleutel: bestandssleutel, bytes });
    } catch {
      // Een onleesbare stream slaat dit knipsel over; de rest blijft werken.
    }
  }
  for (const { bytes } of gevonden) bewaar(bytes);
  return gevonden.map((g) => g.sleutel);
}

/**
 * Leest de knipsel-velden van een stempel-annotatiewoordenboek.
 * @returns {{snippetKey: string, srcBox: object, srcLabel: string}|null}
 */
export async function leesKnipselVelden(annotDict, context) {
  const { PDFName } = await import('pdf-lib');
  const tekstVan = (raw) => {
    if (!raw) return null;
    const v = context.lookup(raw) || raw;
    if (v && typeof v.value === 'string') return v.value;
    if (v && typeof v.decodeText === 'function') return v.decodeText();
    return null;
  };

  const sleutel = tekstVan(annotDict.get(PDFName.of('OPS_SnippetKey')));
  if (!sleutel) return null;

  const vakRaw = annotDict.get(PDFName.of('OPS_SrcBox'));
  const vakArr = vakRaw ? (context.lookup(vakRaw) || vakRaw) : null;
  if (!vakArr || typeof vakArr.asArray !== 'function') return null;
  const g = vakArr.asArray().map((n) => n.asNumber());
  if (g.length !== 4 || !g.every(Number.isFinite)) return null;

  return {
    snippetKey: sleutel,
    srcBox: { left: g[0], bottom: g[1], right: g[2], top: g[3] },
    srcLabel: tekstVan(annotDict.get(PDFName.of('OPS_SrcLabel'))) || '',
  };
}
