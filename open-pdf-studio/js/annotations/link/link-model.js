// Hyperlinks die de app zelf maakt en bewerkt (#953): het model, zonder DOM
// of app-state, zodat lader, saver, dialoog en tests dezelfde regels delen.
//
// Een link is een annotatie van de soort 'link':
//   page, x, y, width, height   het klikvak in app-ruimte (zoals een vorm)
//   rects                       per tekstregel een vak, als de link uit een
//                               tekstselectie komt (/QuadPoints in de PDF)
//   linkTarget                  waar de link heen gaat:
//     { kind: 'uri',  uri }                         webadres (/A /S /URI)
//     { kind: 'page', page, fit, left, top, zoom }  pagina in dit document
//                                                   (/Dest [pagina /XYZ ...]
//                                                   of [pagina /Fit])
//     { kind: 'file', file }                        bestand (/A /S /Launch),
//                                                   alleen op het bureaublad
//   linkBorder                  'none' | 'solid' | 'underline'
//   color, lineWidth            kleur en dikte van de zichtbare rand
//   linkHighlight               /H: 'I' (omkeren, standaard), 'N', 'O', 'P'
//
// In het bestand draagt zo'n link /OPS_Subtype (link). Alleen die links laadt
// de app als bewerkbare annotatie; links van andere programma's blijven wat ze
// waren (pdf/link-layer.js volgt ze, de saver laat ze staan).

export const LINK_SOORT = 'link';
export const LINK_DOELEN = Object.freeze(['uri', 'page', 'file']);
export const LINK_RANDEN = Object.freeze(['none', 'solid', 'underline']);
export const LINK_STANDAARD_KLEUR = '#0000FF';
const H_WAARDEN = new Set(['I', 'N', 'O', 'P']);

// Schema's die een link in het bestand mag krijgen en die de app opent.
const URI_SCHEMAS = new Set(['http:', 'https:', 'mailto:', 'tel:', 'ftp:', 'ftps:']);
const STANDAARD_SCHEMA = 'https:';

/** Is dit een link van de app? */
export function isLink(ann) {
  return !!ann && ann.type === LINK_SOORT;
}

/**
 * Het webadres zoals de gebruiker het typte, netjes gemaakt: spaties eraf,
 * zonder schema https: ervoor, een e-mailadres als mailto:. Geeft null als
 * het geen bruikbaar adres is (leeg, of een schema als javascript: of file:).
 * @param {string} tekst
 * @returns {string|null}
 */
export function normaliseerUri(tekst) {
  let s = String(tekst ?? '').trim();
  if (!s) return null;
  if (/\s/.test(s)) return null;
  const heeftSchema = /^[a-z][a-z0-9+.-]*:/i.test(s);
  if (!heeftSchema) {
    if (/^[^@/]+@[^@/]+\.[^@/]+$/.test(s)) s = `mailto:${s}`;
    else if (s.startsWith('//')) s = `${STANDAARD_SCHEMA}${s}`;
    else s = `${STANDAARD_SCHEMA}//${s}`;
  }
  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (!URI_SCHEMAS.has(url.protocol.toLowerCase())) return null;
  if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.hostname) return null;
  // De invoer zelf houden: URL zet er bijvoorbeeld een schuine streep achter.
  return s;
}

/** Een bestandspad voor /Launch: niet leeg, geen regeleinden. */
export function normaliseerBestand(tekst) {
  const s = String(tekst ?? '').trim();
  if (!s || /[\r\n\0]/.test(s)) return null;
  return s;
}

/**
 * Een geldig doel, of null. `aantalPaginas` begrenst een paginadoel.
 * @param {object} doel
 * @param {number} [aantalPaginas]
 */
export function normaliseerDoel(doel, aantalPaginas = Infinity) {
  if (!doel || typeof doel !== 'object') return null;
  switch (doel.kind) {
    case 'uri': {
      const uri = normaliseerUri(doel.uri);
      return uri ? { kind: 'uri', uri } : null;
    }
    case 'page': {
      const page = Math.round(Number(doel.page));
      if (!Number.isFinite(page) || page < 1 || page > aantalPaginas) return null;
      const fit = doel.fit === 'fit' ? 'fit' : 'xyz';
      const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      const uit = { kind: 'page', page, fit };
      if (fit === 'xyz') {
        uit.left = getal(doel.left);
        uit.top = getal(doel.top);
        uit.zoom = getal(doel.zoom) && doel.zoom > 0 ? doel.zoom : null;
      }
      return uit;
    }
    case 'file': {
      const file = normaliseerBestand(doel.file);
      return file ? { kind: 'file', file } : null;
    }
    default:
      return null;
  }
}

/** De zichtbare rand: altijd een van LINK_RANDEN. */
export function linkRand(ann) {
  return LINK_RANDEN.includes(ann?.linkBorder) ? ann.linkBorder : 'none';
}

/** /H van de link: een van I, N, O, P (standaard I). */
export function linkMarkering(ann) {
  return H_WAARDEN.has(ann?.linkHighlight) ? ann.linkHighlight : 'I';
}

/** Randdikte in punten (0,5 tot 12), standaard 1. */
export function linkRanddikte(ann) {
  const w = Number(ann?.lineWidth);
  if (!Number.isFinite(w) || w <= 0) return 1;
  return Math.min(12, Math.max(0.5, w));
}

/**
 * Korte tekst voor wat een link doet, voor tooltips en het paneel.
 * @param {object} doel
 * @param {(sleutel: string, opties?: object) => string} [t]
 */
export function doelOmschrijving(doel, t = null) {
  if (!doel) return '';
  if (doel.kind === 'uri') return doel.uri;
  if (doel.kind === 'file') return doel.file;
  if (doel.kind === 'page') {
    return t ? t('link.toPage', { page: doel.page }) : `Page ${doel.page}`;
  }
  return '';
}

/**
 * Het klikvak en de regelvakken van een link uit vakken van een
 * tekstselectie (app-ruimte). Null zonder bruikbare vakken.
 * @param {Array<{x:number,y:number,width:number,height:number}>} vakken
 */
export function vakUitRegels(vakken) {
  const goed = (vakken || []).filter((r) => r && [r.x, r.y, r.width, r.height].every(Number.isFinite)
    && r.width > 0 && r.height > 0);
  if (goed.length === 0) return null;
  const minX = Math.min(...goed.map((r) => r.x));
  const minY = Math.min(...goed.map((r) => r.y));
  const maxX = Math.max(...goed.map((r) => r.x + r.width));
  const maxY = Math.max(...goed.map((r) => r.y + r.height));
  return {
    x: minX, y: minY, width: maxX - minX, height: maxY - minY,
    rects: goed.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })),
  };
}

/**
 * De velden van een nieuwe link (zonder id en metagegevens: die zet
 * createAnnotation). `vak` is { x, y, width, height, rects? } in app-ruimte.
 */
export function nieuweLinkVelden({ page, vak, doel, rand = 'none', kleur = LINK_STANDAARD_KLEUR, dikte = 1 }) {
  const velden = {
    type: LINK_SOORT,
    page,
    x: vak.x, y: vak.y, width: vak.width, height: vak.height,
    linkTarget: doel,
    linkBorder: LINK_RANDEN.includes(rand) ? rand : 'none',
    color: kleur || LINK_STANDAARD_KLEUR,
    strokeColor: kleur || LINK_STANDAARD_KLEUR,
    lineWidth: dikte,
    linkHighlight: 'I',
  };
  if (Array.isArray(vak.rects) && vak.rects.length > 0) velden.rects = vak.rects.map((r) => ({ ...r }));
  return velden;
}

/** De vakken die getekend en geraakt worden: de regels, anders het klikvak. */
export function linkVakken(ann) {
  if (Array.isArray(ann?.rects) && ann.rects.length > 0) return ann.rects;
  return [{ x: ann.x, y: ann.y, width: ann.width, height: ann.height }];
}

/** Ligt (x, y) op de link (binnen een van haar vakken, met marge `tol`)? */
export function raaktLink(ann, x, y, tol = 0) {
  return linkVakken(ann).some((r) => x >= r.x - tol && x <= r.x + r.width + tol
    && y >= r.y - tol && y <= r.y + r.height + tol);
}
