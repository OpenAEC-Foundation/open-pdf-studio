// Het doel van een bladwijzer (#1157): een plek op een pagina, niet alleen de
// pagina. Pure functies zonder app-imports: de lader, de saver, het paneel en
// de tests gebruiken dezelfde omzetting.
//
// In het model (doc.bookmarks) staat het doel zo:
//   page                 de pagina (1 = eerste)
//   left, top, zoom      de gewone vorm /XYZ; null = "laten zoals het is".
//                        Alle drie null: alleen de pagina.
//   destType, destArgs   alleen bij een andere vorm uit een bestaand bestand
//                        (/Fit, /FitH top, /FitR l b r t ...): de naam en de
//                        getallen erna, zodat de bladwijzer hetzelfde beeld
//                        geeft en onveranderd teruggeschreven wordt.

import { parseDestinationArray } from './link-destination.js';

/** Getallen die na de naam volgen, per vorm (PDF 32000-1, tabel 151). */
const ARGUMENTEN = {
  Fit: [],
  FitB: [],
  FitH: ['top'],
  FitBH: ['top'],
  FitV: ['left'],
  FitBV: ['left'],
  FitR: ['left', 'bottom', 'right', 'top'],
};

const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * De doelvelden van een bladwijzer uit een expliciete bestemming
 * ([pagina, /Vorm, ...getallen], van pdf.js of rauw). De pagina zelf lost de
 * aanroeper op. Een onleesbare bestemming geeft alleen de pagina.
 * @returns {{left: number|null, top: number|null, zoom: number|null,
 *   destType?: string, destArgs?: Array<number|null>}}
 */
export function doelVeldenUitDest(dest) {
  const leeg = { left: null, top: null, zoom: null };
  const info = parseDestinationArray(dest);
  if (!info) return leeg;
  if (info.type === 'XYZ') {
    // Zoom 0 betekent hetzelfde als geen zoom: laten staan.
    return { left: info.left, top: info.top, zoom: info.zoom > 0 ? info.zoom : null };
  }
  const schema = ARGUMENTEN[info.type];
  if (!schema) return leeg;
  return { ...leeg, destType: info.type, destArgs: schema.map((naam) => info[naam]) };
}

/** De vorm van het doel: 'XYZ' tenzij het bestand een andere vorm gaf. */
export function doelVorm(bm) {
  return bm && typeof bm.destType === 'string' && ARGUMENTEN[bm.destType] ? bm.destType : 'XYZ';
}

/**
 * Naam en getallen van de bestemming zoals ze in het bestand komen:
 * { vorm, args }. /XYZ krijgt altijd drie waarden (null = niet opgegeven).
 */
export function doelOnderdelen(bm) {
  const vorm = doelVorm(bm);
  if (vorm === 'XYZ') return { vorm, args: [getal(bm?.left), getal(bm?.top), getal(bm?.zoom)] };
  const args = Array.isArray(bm.destArgs) ? bm.destArgs : [];
  return { vorm, args: ARGUMENTEN[vorm].map((_, i) => getal(args[i])) };
}

/**
 * Wijst de bladwijzer naar een plek, of alleen naar de pagina? Alleen de
 * pagina: de gewone vorm zonder left, top en zoom.
 */
export function heeftPlek(bm) {
  const { vorm, args } = doelOnderdelen(bm);
  return vorm !== 'XYZ' || args.some((v) => v !== null);
}

/**
 * De bestemming als expliciete array voor de gedeelde linknavigatie
 * (handleInternalLink): [pagina-index vanaf 0, { name }, ...getallen].
 */
export function destVanBladwijzer(bm) {
  const { vorm, args } = doelOnderdelen(bm);
  return [Math.max(0, (Number(bm?.page) || 1) - 1), { name: vorm }, ...args];
}

/**
 * De velden die een bladwijzer naar een nieuwe plek laten wijzen: altijd de
 * gewone vorm, de zoom blijft zoals hij is. Zonder `left`/`top`: de bovenkant
 * van de pagina.
 */
export function doelVelden({ page, left = null, top = null }) {
  const rond = (v) => (getal(v) === null ? null : Math.round(v * 100) / 100);
  return { page, left: rond(left), top: rond(top), zoom: null, destType: null, destArgs: null };
}

export const MAX_TITEL_UIT_SELECTIE = 80;

/**
 * Titel van een bladwijzer uit geselecteerde tekst: witruimte en regeleinden
 * worden één spatie, en een lange selectie wordt op een woordgrens afgekort
 * met een beletselteken. Lege selectie: ''.
 */
export function titelUitSelectie(tekst, max = MAX_TITEL_UIT_SELECTIE) {
  // Stuurtekens (regeleinden, tabs) horen niet in een titel.
  const schoon = String(tekst ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
  const tekens = [...schoon];
  if (tekens.length <= max) return schoon;
  let kort = tekens.slice(0, max).join('');
  const spatie = kort.lastIndexOf(' ');
  // Alleen op een woordgrens afbreken als er dan nog genoeg overblijft.
  if (spatie >= max * 0.6) kort = kort.slice(0, spatie);
  return kort.replace(/[\s.,;:!?\-–—]+$/u, '') + '…';
}
