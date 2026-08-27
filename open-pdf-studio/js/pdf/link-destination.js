/**
 * Pure helpers voor PDF-linkbestemmingen.
 *
 * Word-inhoudsopgaven leveren /Link-annotaties met een expliciete /Dest-array
 * (`[pageRef, /XYZ, left, top, zoom]`) of een /A /S /GoTo-actie met dezelfde
 * array. Deze module bevat alleen de rekenkundige/lexicale kant daarvan zodat
 * ze los te testen is: geen app-imports, geen DOM.
 */

/** Schema's die in een destination-array na het naamobject volgen. */
const DEST_ARGS = {
  XYZ: ['left', 'top', 'zoom'],
  Fit: [],
  FitB: [],
  FitH: ['top'],
  FitBH: ['top'],
  FitV: ['left'],
  FitBV: ['left'],
  FitR: ['left', 'bottom', 'right', 'top'],
};

/**
 * Haalt de bestemmingsnaam uit het tweede element van een destination-array.
 * PDF.js levert daar `{ name: 'XYZ' }`; rauwe pdf-lib/pypdf-achtige bronnen
 * kunnen '/XYZ' of 'XYZ' geven.
 * @param {*} entry
 * @returns {string|null}
 */
function readDestName(entry) {
  if (!entry) return null;
  const raw = typeof entry === 'string' ? entry : entry.name;
  if (typeof raw !== 'string' || !raw) return null;
  return raw.startsWith('/') ? raw.slice(1) : raw;
}

/**
 * Ontleedt een expliciete destination-array.
 * Het eerste element (de paginaverwijzing) blijft ongemoeid — dat lost de
 * aanroeper op via `pdfDoc.getPageIndex()`.
 * @param {Array} dest
 * @returns {{type: string, pageRef: *, left: number|null, top: number|null,
 *            bottom: number|null, right: number|null, zoom: number|null}|null}
 */
export function parseDestinationArray(dest) {
  if (!Array.isArray(dest) || dest.length === 0) return null;

  const type = readDestName(dest[1]) || 'Fit';
  const result = {
    type,
    pageRef: dest[0],
    left: null,
    top: null,
    bottom: null,
    right: null,
    zoom: null,
  };

  const schema = DEST_ARGS[type];
  if (!schema) return result; // onbekend type: alleen de pagina telt

  for (let i = 0; i < schema.length; i++) {
    const value = dest[2 + i];
    if (typeof value === 'number' && Number.isFinite(value)) {
      result[schema[i]] = value;
    }
  }
  return result;
}

/**
 * Rekent een bestemming om naar de afstand vanaf de BOVENkant van de pagina,
 * in PDF-punten. PDF-coördinaten hebben hun oorsprong linksonder, de
 * schermweergave linksboven.
 *
 * `null` betekent "geen verticale voorkeur" — de aanroeper toont dan gewoon de
 * bovenkant van de pagina (Fit, FitV, of een /XYZ zonder top-waarde).
 * @param {ReturnType<typeof parseDestinationArray>} destInfo
 * @param {number} pageHeightPt Paginahoogte in punten (MediaBox-hoogte)
 * @returns {number|null}
 */
export function destTopOffsetPt(destInfo, pageHeightPt) {
  if (!destInfo) return null;
  if (!Number.isFinite(pageHeightPt) || pageHeightPt <= 0) return null;

  let top = null;
  switch (destInfo.type) {
    case 'XYZ':
    case 'FitH':
    case 'FitBH':
    case 'FitR':
      top = destInfo.top;
      break;
    case 'Fit':
    case 'FitB':
      return 0;
    default:
      // FitV/FitBV en onbekende types sturen niet verticaal.
      return null;
  }

  if (typeof top !== 'number' || !Number.isFinite(top)) return null;

  const offset = pageHeightPt - top;
  if (offset <= 0) return 0;
  if (offset >= pageHeightPt) return pageHeightPt;
  return offset;
}

/** Schema's die we in de standaardbrowser mogen openen. */
const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:', 'ftp:', 'ftps:']);

/**
 * Bewaakt welke URL's uit een PDF naar de buitenwereld mogen. Een PDF is
 * onvertrouwde invoer: `javascript:`, `data:` en `file:` mogen nooit in de
 * WebView of via de shell terechtkomen.
 * @param {*} url
 * @returns {boolean}
 */
export function isSafeLinkUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return SAFE_LINK_SCHEMES.has(parsed.protocol.toLowerCase());
}
