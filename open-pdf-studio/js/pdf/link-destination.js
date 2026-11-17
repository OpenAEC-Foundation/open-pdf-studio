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

/**
 * Een punt uit de PDF-gebruikersruimte naar de pagina zoals hij op het scherm
 * ligt: oorsprong linksboven, in pagina-eenheden. `view` is de zichtbare
 * rechthoek van de pagina ([x0, y0, x1, y1], de CropBox; de oorsprong hoeft
 * niet 0 te zijn), `rotatie` de totale draaiing rechtsom (0/90/180/270:
 * /Rotate plus wat de app erbij draait). Zelfde uitkomst als de viewport van
 * PDF.js op schaal 1 in pagina-eenheden (zie pagina-viewport.js: /UserUnit
 * telt in deze ruimte niet mee).
 * @returns {{x: number, y: number}}
 */
export function pdfNaarWeergave(view, rotatie, x, y) {
  const [x0, y0, x1, y1] = view;
  switch ((((Number(rotatie) || 0) % 360) + 360) % 360) {
    case 90: return { x: y - y0, y: x - x0 };
    case 180: return { x: x1 - x, y: y - y0 };
    case 270: return { x: y1 - y, y: x1 - x };
    default: return { x: x - x0, y: y1 - y };
  }
}

/**
 * Het omgekeerde van pdfNaarWeergave: een punt van de pagina zoals hij op het
 * scherm ligt (oorsprong linksboven) terug naar de PDF-gebruikersruimte.
 * @returns {{x: number, y: number}}
 */
export function weergaveNaarPdf(view, rotatie, x, y) {
  const [x0, y0, x1, y1] = view;
  switch ((((Number(rotatie) || 0) % 360) + 360) % 360) {
    case 90: return { x: x0 + y, y: y0 + x };
    case 180: return { x: x1 - x, y: y0 + y };
    case 270: return { x: x1 - y, y: y1 - x };
    default: return { x: x0 + x, y: y1 - y };
  }
}

/**
 * De /XYZ-bestemming die het punt (x, y) van de getoonde pagina linksboven in
 * het venster zet: het omgekeerde van destDoelbeeld voor /XYZ. Een punt buiten
 * de pagina schuift naar haar rand. Null bij een onbruikbare pagina.
 * @param {{view: number[], rotatie?: number}} pagina
 * @returns {{left: number, top: number}|null}
 */
export function xyzVoorWeergavepunt(pagina, x, y) {
  if (!Array.isArray(pagina?.view) || pagina.view.length < 4 || !pagina.view.every(isGetal)) return null;
  const maat = weergaveMaatVan(pagina.view, pagina.rotatie);
  if (!(maat.breedte > 0 && maat.hoogte > 0)) return null;
  const klem = (v, max) => Math.min(max, Math.max(0, isGetal(v) ? v : 0));
  const p = weergaveNaarPdf(pagina.view, pagina.rotatie, klem(x, maat.breedte), klem(y, maat.hoogte));
  return { left: p.x, top: p.y };
}

/** Maat van de pagina zoals hij op het scherm ligt, in pagina-eenheden. */
export function weergaveMaatVan(view, rotatie) {
  const b = Math.abs(view[2] - view[0]);
  const h = Math.abs(view[3] - view[1]);
  const kwart = Math.abs(Number(rotatie) || 0) % 180 === 90;
  return kwart ? { breedte: h, hoogte: b } : { breedte: b, hoogte: h };
}

const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Het beeld dat een bestemming vraagt: de zoom en het punt van de pagina dat
 * in het venster moet komen, voor elke expliciete bestemmingsvorm.
 *
 *   /XYZ left top zoom   (left, top) linksboven in het venster; een ontbrekende
 *                        waarde (null) of zoom 0 betekent: laten zoals het is
 *   /Fit, /FitB          de hele pagina passend, in het midden
 *   /FitH, /FitBH top    de paginabreedte passend, `top` bovenaan
 *   /FitV, /FitBV left   de paginahoogte passend, `left` links
 *   /FitR l b r t        die rechthoek passend, in het midden
 *
 * Uitkomst in de weergaveruimte van de pagina (pdfNaarWeergave):
 *   zoom    CSS-pixels per pagina-eenheid, of null: de zoom laten staan
 *   x, y    het punt; x null: horizontaal niets doen. y is er altijd (zonder
 *           eigen hoogte de bovenkant van de pagina)
 *   ankerX, ankerY  'begin': het punt aan de linker-/bovenrand van het
 *           venster; 'midden': in het midden
 * Null als de bestemming geen beeld geeft (onbekende vorm, lege rechthoek);
 * de aanroeper toont dan alleen de pagina.
 *
 * @param {ReturnType<typeof parseDestinationArray>} destInfo
 * @param {{view: number[], rotatie?: number}} pagina
 * @param {{breedte: number, hoogte: number, honderd?: number}} venster
 *   maat van het venster in CSS-pixels; `honderd` is de zoom bij 100%
 *   (CSS-pixels per punt), waartegen de zoomfactor van /XYZ telt
 */
export function destDoelbeeld(destInfo, pagina, venster) {
  if (!destInfo || !Array.isArray(pagina?.view) || pagina.view.length < 4) return null;
  if (!pagina.view.every(isGetal)) return null;
  const view = pagina.view;
  const rot = (((Number(pagina.rotatie) || 0) % 360) + 360) % 360;
  const kwart = rot % 180 === 90;
  const maat = weergaveMaatVan(view, rot);
  if (!(maat.breedte > 0 && maat.hoogte > 0)) return null;
  const vb = Number(venster?.breedte);
  const vh = Number(venster?.hoogte);
  const heeftVenster = vb > 0 && vh > 0;
  const [x0, , , y1] = view;

  switch (destInfo.type) {
    case 'XYZ': {
      const heeftL = isGetal(destInfo.left);
      const heeftT = isGetal(destInfo.top);
      const p = pdfNaarWeergave(view, rot, heeftL ? destInfo.left : x0, heeftT ? destInfo.top : y1);
      // Bij een kwartslag ligt de PDF-x langs de hoogte van het scherm.
      const heeftX = kwart ? heeftT : heeftL;
      const heeftY = kwart ? heeftL : heeftT;
      const honderd = Number(venster?.honderd) > 0 ? Number(venster.honderd) : 1;
      return {
        zoom: isGetal(destInfo.zoom) && destInfo.zoom > 0 ? destInfo.zoom * honderd : null,
        x: heeftX ? p.x : null,
        y: heeftY ? p.y : 0,
        ankerX: 'begin',
        ankerY: 'begin',
      };
    }
    case 'Fit':
    case 'FitB':
      return {
        zoom: heeftVenster ? Math.min(vb / maat.breedte, vh / maat.hoogte) : null,
        x: maat.breedte / 2, y: maat.hoogte / 2, ankerX: 'midden', ankerY: 'midden',
      };
    case 'FitH':
    case 'FitBH': {
      // Alleen zonder kwartslag loopt `top` langs de hoogte van het scherm.
      const y = !kwart && isGetal(destInfo.top) ? pdfNaarWeergave(view, rot, x0, destInfo.top).y : 0;
      return {
        zoom: heeftVenster ? vb / maat.breedte : null,
        x: maat.breedte / 2, y, ankerX: 'midden', ankerY: 'begin',
      };
    }
    case 'FitV':
    case 'FitBV': {
      const x = !kwart && isGetal(destInfo.left) ? pdfNaarWeergave(view, rot, destInfo.left, y1).x : null;
      return {
        zoom: heeftVenster ? vh / maat.hoogte : null,
        x, y: maat.hoogte / 2, ankerX: 'begin', ankerY: 'midden',
      };
    }
    case 'FitR': {
      const { left, bottom, right, top } = destInfo;
      if (![left, bottom, right, top].every(isGetal)) return null;
      const a = pdfNaarWeergave(view, rot, left, bottom);
      const b = pdfNaarWeergave(view, rot, right, top);
      const breedte = Math.abs(b.x - a.x);
      const hoogte = Math.abs(b.y - a.y);
      if (!(breedte > 0 && hoogte > 0)) return null;
      return {
        zoom: heeftVenster ? Math.min(vb / breedte, vh / hoogte) : null,
        x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, ankerX: 'midden', ankerY: 'midden',
      };
    }
    default:
      return null;
  }
}

/**
 * Waar de linkerbovenhoek van de pagina (in de weergave) hoort te komen,
 * gemeten vanaf de linkerbovenhoek van het venster, zodat het punt van
 * `beeld` op zijn anker ligt. Een as zonder punt geeft null (laten staan).
 * @param {NonNullable<ReturnType<typeof destDoelbeeld>>} beeld
 * @param {number} zoom  de zoom die werkelijk geldt (CSS-pixels per eenheid)
 * @param {{breedte: number, hoogte: number}} venster
 * @param {number} [marge]  ruimte boven een punt dat bovenaan komt
 * @returns {{x: number|null, y: number|null}}
 */
export function paginaPlekInVenster(beeld, zoom, venster, marge = 0) {
  const as = (punt, anker, maat, m) => {
    if (!isGetal(punt)) return null;
    return (anker === 'midden' ? maat / 2 : m) - punt * zoom;
  };
  return {
    x: as(beeld.x, beeld.ankerX, Number(venster.breedte) || 0, 0),
    y: as(beeld.y, beeld.ankerY, Number(venster.hoogte) || 0, marge),
  };
}

/**
 * Houd de pagina in het venster, zoals een schuivend venster dat vanzelf
 * doet: past de pagina op een as, dan in het midden; anders niet verder dan
 * haar randen. Voor de viewport, waar de pagina vrij te verschuiven is.
 * @param {{x: number|null, y: number|null}} plek  uit paginaPlekInVenster
 * @param {{breedte: number, hoogte: number}} paginaPx  maat van de pagina op het scherm
 * @param {{breedte: number, hoogte: number}} venster
 * @returns {{x: number|null, y: number|null}}
 */
export function klemPaginaPlek(plek, paginaPx, venster) {
  const as = (waarde, pagina, maat) => {
    if (!isGetal(waarde)) return null;
    if (pagina <= maat) return (maat - pagina) / 2;
    return Math.min(0, Math.max(maat - pagina, waarde));
  };
  return {
    x: as(plek.x, paginaPx.breedte, Number(venster.breedte) || 0),
    y: as(plek.y, paginaPx.hoogte, Number(venster.hoogte) || 0),
  };
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
