// Het opmerkingenoverzicht (#383): filteren, sorteren en de status van veel
// opmerkingen tegelijk zetten, plus de uitsnede van een opmerking voor het
// PDF-rapport.
//
// Puur: geen DOM, geen app-state. Het paneel (annotations-list.js) en het
// rapport (opmerkingen-rapport.js) rekenen allebei hiermee, zodat lijst, CSV
// en rapport dezelfde opmerkingen in dezelfde volgorde tonen.

import { csvDatum } from './opmerkingen-export.js';

/** De auteur zoals de lijst hem toont: zonder auteur heet hij 'User'. */
export function auteurVan(ann) {
  return (ann && ann.author) || 'User';
}

/** De review-status in kleine letters; geen status telt als 'none'. */
export function statusSleutel(ann) {
  return String((ann && ann.status) || 'none').toLowerCase();
}

/** De datum waarop de datumfilter kijkt: gewijzigd, anders aangemaakt. */
function filterDatum(ann) {
  return csvDatum(ann.modifiedAt || ann.createdAt).slice(0, 10);
}

/** Een leeg filter: alles zichtbaar. */
export function leegFilter() {
  return { auteur: '', type: '', paginaVan: null, paginaTot: null, datumVan: '', datumTot: '' };
}

function heelGetal(waarde) {
  if (waarde === null || waarde === undefined || waarde === '') return null;
  const n = Number(waarde);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;
const datumOfLeeg = (waarde) => (typeof waarde === 'string' && ISO_DATUM.test(waarde) ? waarde : '');

/**
 * Maakt een filter schoon: lege of ongeldige waarden vallen weg, een
 * omgekeerd bereik (van > tot) wordt omgedraaid.
 */
export function normaliseerFilter(filter) {
  const f = { ...leegFilter(), ...(filter || {}) };
  const uit = {
    auteur: f.auteur ? String(f.auteur) : '',
    type: f.type ? String(f.type) : '',
    paginaVan: heelGetal(f.paginaVan),
    paginaTot: heelGetal(f.paginaTot),
    datumVan: datumOfLeeg(f.datumVan),
    datumTot: datumOfLeeg(f.datumTot),
  };
  if (uit.paginaVan && uit.paginaTot && uit.paginaVan > uit.paginaTot) {
    [uit.paginaVan, uit.paginaTot] = [uit.paginaTot, uit.paginaVan];
  }
  if (uit.datumVan && uit.datumTot && uit.datumVan > uit.datumTot) {
    [uit.datumVan, uit.datumTot] = [uit.datumTot, uit.datumVan];
  }
  return uit;
}

/** Staat er iets in het filter? */
export function filterActief(filter) {
  const f = normaliseerFilter(filter);
  return !!(f.auteur || f.type || f.paginaVan || f.paginaTot || f.datumVan || f.datumTot);
}

/**
 * Voldoet een opmerking aan het filter? Over alle pagina's: het filter kent
 * geen huidige pagina, alleen een paginabereik.
 * @param {object} ann
 * @param {object} filter  zie leegFilter()
 * @param {{ verborgenStatussen?: Set<string> }} [opties]  statussen (kleine
 *   letters) die Tonen > Status heeft uitgevinkt
 */
export function voldoetAanFilter(ann, filter, opties = {}) {
  return voldoetGenormaliseerd(ann, normaliseerFilter(filter), opties);
}

function voldoetGenormaliseerd(ann, f, opties) {
  if (!ann) return false;
  if (f.auteur && auteurVan(ann) !== f.auteur) return false;
  if (f.type && ann.type !== f.type) return false;
  const verborgen = opties.verborgenStatussen;
  if (verborgen && verborgen.size > 0 && verborgen.has(statusSleutel(ann))) return false;
  const pagina = Number(ann.page);
  if (f.paginaVan && !(pagina >= f.paginaVan)) return false;
  if (f.paginaTot && !(pagina <= f.paginaTot)) return false;
  if (f.datumVan || f.datumTot) {
    const datum = filterDatum(ann);
    if (!datum) return false;
    if (f.datumVan && datum < f.datumVan) return false;
    if (f.datumTot && datum > f.datumTot) return false;
  }
  return true;
}

/** De opmerkingen die aan het filter voldoen, in hun oorspronkelijke volgorde. */
export function filterOpmerkingen(annotations, filter, opties = {}) {
  const f = normaliseerFilter(filter);
  return (annotations || []).filter((a) => voldoetGenormaliseerd(a, f, opties));
}

/** De auteurs in het document, alfabetisch (hoofdletter-ongevoelig), uniek. */
export function auteursIn(annotations) {
  const set = new Set((annotations || []).filter(Boolean).map(auteurVan));
  return [...set].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b));
}

/** De soorten in het document, uniek, gesorteerd op hun getoonde naam. */
export function typesIn(annotations, typeNaam = (t) => t) {
  const set = new Set((annotations || []).filter((a) => a && a.type).map((a) => a.type));
  return [...set]
    .map((type) => ({ type, naam: typeNaam(type) }))
    .sort((a, b) => a.naam.localeCompare(b.naam));
}

const tijd = (waarde) => {
  const t = new Date(waarde).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/** De auteur van de laatste reactie, anders de auteur van de opmerking. */
export function laatsteStatusAuteur(ann) {
  const replies = (ann && ann.replies) || [];
  for (let i = replies.length - 1; i >= 0; i--) {
    if (replies[i] && replies[i].author) return replies[i].author;
  }
  return auteurVan(ann);
}

const paginaDanDatum = (a, b) => {
  if (a.page !== b.page) return a.page - b.page;
  return tijd(a.createdAt) - tijd(b.createdAt);
};

const opTekst = (sleutel) => (a, b) => {
  const sa = sleutel(a);
  const sb = sleutel(b);
  if (sa !== sb) return sa.localeCompare(sb);
  return paginaDanDatum(a, b);
};

/**
 * De vergelijker voor een sorteer-/groeperingswijze van het paneel.
 * @param {string} wijze  page | type | modifiedDate | creationDate | author |
 *   color | subject | status | statusAndAuthor | lastStatusAuthor
 * @param {{ typeNaam?: (type: string) => string }} [opties]
 */
export function vergelijkerVoor(wijze, opties = {}) {
  const typeNaam = opties.typeNaam || ((t) => String(t || ''));
  switch (wijze) {
    case 'type': return opTekst((a) => typeNaam(a.type));
    case 'modifiedDate': return (a, b) => tijd(b.modifiedAt) - tijd(a.modifiedAt);
    case 'creationDate': return (a, b) => tijd(b.createdAt) - tijd(a.createdAt);
    case 'author': return opTekst((a) => auteurVan(a).toLowerCase());
    case 'color': return opTekst((a) => String(a.color || a.strokeColor || '#000').toLowerCase());
    case 'subject': return opTekst((a) => String(a.subject || '').toLowerCase());
    case 'status': return opTekst(statusSleutel);
    case 'statusAndAuthor': return (a, b) => {
      const sa = statusSleutel(a);
      const sb = statusSleutel(b);
      if (sa !== sb) return sa.localeCompare(sb);
      return opTekst((x) => auteurVan(x).toLowerCase())(a, b);
    };
    case 'lastStatusAuthor': return opTekst((a) => laatsteStatusAuteur(a).toLowerCase());
    default: return paginaDanDatum;
  }
}

/** Een gesorteerde kopie; de invoer blijft zoals hij was. */
export function sorteerOpmerkingen(annotations, wijze, opties = {}) {
  return [...(annotations || [])].filter(Boolean).sort(vergelijkerVoor(wijze, opties));
}

/** De statussen die het paneel in bulk kan zetten (kleine letters). */
export const BULK_STATUSSEN = Object.freeze(['none', 'accepted', 'cancelled', 'completed', 'rejected']);

/**
 * De opmerkingen waarvan de status echt verandert: vergrendelde vallen af,
 * net als opmerkingen die de status al hebben. Elke opmerking één keer.
 */
export function statusDoelen(annotations, status) {
  const doel = String(status || 'none').toLowerCase();
  const gezien = new Set();
  const uit = [];
  for (const ann of annotations || []) {
    if (!ann || gezien.has(ann)) continue;
    gezien.add(ann);
    if (ann.locked) continue;
    if (statusSleutel(ann) === doel) continue;
    uit.push(ann);
  }
  return uit;
}

/**
 * Zet de status van één opmerking zoals het eigenschappenpaneel dat doet:
 * 'none' haalt de status en haar stempel weg, een andere status legt vast
 * door wie en wanneer.
 */
export function zetStatus(ann, status, { door = 'User', nu = new Date().toISOString() } = {}) {
  const doel = String(status || 'none').toLowerCase();
  if (doel === 'none') {
    ann.status = undefined;
    delete ann.statusBy;
    delete ann.statusAt;
  } else {
    ann.status = doel;
    ann.statusBy = door;
    ann.statusAt = nu;
  }
  ann.modifiedAt = nu;
  return ann;
}

/**
 * Het stuk van de pagina dat het rapport bij een opmerking toont, in pixels
 * van de pagina op `schaal` (zoals renderPageOffscreen het als `deel` wil).
 * Rond de opmerking komt een marge, zodat te zien is waar ze ligt; het gebied
 * blijft binnen de pagina. De schaal kiest zo dat de langste zijde ongeveer
 * `maxPx` pixels wordt, begrensd tussen `minSchaal` en `maxSchaal`.
 * @param {{x:number, y:number, width:number, height:number}|null} bounds
 *   in paginapunten (schaal 1, oorsprong linksboven)
 * @param {{ breedte:number, hoogte:number }} pagina  paginamaat in punten
 * @returns {{ schaal:number, deel:{x:number, y:number, breedte:number, hoogte:number},
 *            kader:{x:number, y:number, breedte:number, hoogte:number} } | null}
 *   kader: de opmerking zelf binnen het deel, in pixels van het deel
 */
export function uitsnedeVoor(bounds, pagina, { maxPx = 480, minSchaal = 0.5, maxSchaal = 4, minMarge = 24 } = {}) {
  const pw = Number(pagina && pagina.breedte);
  const ph = Number(pagina && pagina.hoogte);
  if (!(pw > 0) || !(ph > 0)) return null;
  let b = bounds;
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return null;
  // Een negatieve maat (van rechts naar links getekend) eerst rechtzetten.
  b = {
    x: Math.min(b.x, b.x + b.width), y: Math.min(b.y, b.y + b.height),
    width: Math.abs(b.width), height: Math.abs(b.height),
  };
  const marge = Math.max(minMarge, Math.max(b.width, b.height) * 0.15);
  let x0 = Math.max(0, b.x - marge);
  let y0 = Math.max(0, b.y - marge);
  let x1 = Math.min(pw, b.x + b.width + marge);
  let y1 = Math.min(ph, b.y + b.height + marge);
  if (x1 - x0 < 1 || y1 - y0 < 1) {
    // Helemaal buiten de pagina: toon de hoek waar ze het dichtst bij ligt.
    x0 = Math.max(0, Math.min(pw - 1, b.x));
    y0 = Math.max(0, Math.min(ph - 1, b.y));
    x1 = Math.min(pw, x0 + Math.max(1, 2 * marge));
    y1 = Math.min(ph, y0 + Math.max(1, 2 * marge));
  }
  const langste = Math.max(x1 - x0, y1 - y0);
  const schaal = Math.min(maxSchaal, Math.max(minSchaal, maxPx / langste));
  const deel = {
    x: Math.floor(x0 * schaal),
    y: Math.floor(y0 * schaal),
    breedte: Math.max(1, Math.ceil((x1 - x0) * schaal)),
    hoogte: Math.max(1, Math.ceil((y1 - y0) * schaal)),
  };
  const kader = {
    x: b.x * schaal - deel.x,
    y: b.y * schaal - deel.y,
    breedte: b.width * schaal,
    hoogte: b.height * schaal,
  };
  return { schaal, deel, kader };
}
