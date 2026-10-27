// Exporteren vanuit het opmerkingenpaneel (#383).
//
// - De lijst zoals het paneel haar toont (filter, groepering, sortering) als
//   CSV: UTF-8 met BOM, zodat spreadsheetprogramma's accenten goed lezen;
//   velden volgens RFC 4180 (komma's, aanhalingstekens en regeleinden binnen
//   aanhalingstekens, CRLF tussen de regels).
// - De selectie als XFDF: welke annotaties meegaan.
//
// Puur: geen DOM, geen app-state. Vertalingen en laagnamen komen als
// functies binnen.

import { expandCorrectionGroups } from './corrections/model.js';

/** De kolommen van de CSV, in deze volgorde. */
export const CSV_KOLOMMEN = Object.freeze([
  'id', 'page', 'type', 'author', 'created', 'modified', 'status', 'statusBy', 'statusAt',
  'subject', 'contents', 'replyCount', 'replies', 'color', 'layer', 'x', 'y', 'width', 'height',
]);

// Een tekstveld dat zo begint leest een spreadsheet als formule. Uit een PDF
// van een ander komt willekeurige tekst; een apostrof ervoor houdt het tekst.
const FORMULE_START = /^[=+\-@\t\r]/;
const MOET_OMSLOTEN = /[",\r\n]|^\s|\s$/;

/** Eén CSV-veld. Getallen blijven getallen; tekst wordt veilig omsloten. */
export function csvVeld(waarde) {
  if (waarde === null || waarde === undefined) return '';
  if (typeof waarde === 'number') return Number.isFinite(waarde) ? String(waarde) : '';
  let tekst = String(waarde);
  if (FORMULE_START.test(tekst)) tekst = "'" + tekst;
  if (MOET_OMSLOTEN.test(tekst)) return '"' + tekst.replace(/"/g, '""') + '"';
  return tekst;
}

/** Het hele CSV-bestand als tekst, met BOM vooraan. */
export function bouwCsv(koppen, rijen) {
  const regels = [koppen, ...(rijen || [])].map((rij) => rij.map(csvVeld).join(','));
  return '﻿' + regels.join('\r\n') + '\r\n';
}

const tweeCijfers = (n) => String(n).padStart(2, '0');

/** Een datum in lokale tijd als `JJJJ-MM-DD UU:MM`; ongeldig of leeg geeft ''. */
export function csvDatum(datum) {
  if (!datum) return '';
  const d = datum instanceof Date ? datum : new Date(datum);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${tweeCijfers(d.getMonth() + 1)}-${tweeCijfers(d.getDate())} `
    + `${tweeCijfers(d.getHours())}:${tweeCijfers(d.getMinutes())}`;
}

export function inhoudVan(ann) {
  for (const veld of [ann.text, ann.stampText, ann.contents]) {
    if (typeof veld === 'string' && veld !== '') return veld;
  }
  return '';
}

/** De reacties als tekst: één regel per reactie, `auteur (datum): tekst`. */
export function reactiesTekst(replies) {
  return (Array.isArray(replies) ? replies : [])
    .filter((r) => r && (r.text || r.author))
    .map((r) => {
      const datum = csvDatum(r.createdAt || r.modifiedAt);
      const wie = r.author || 'User';
      return `${wie}${datum ? ` (${datum})` : ''}: ${r.text || ''}`;
    })
    .join('\n');
}

const tweeDecimalen = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : '');

/**
 * De waarden van één annotatie in de volgorde van CSV_KOLOMMEN.
 * @param {object} ann
 * @param {{ typeNaam?: (ann) => string, statusNaam?: (status) => string,
 *           laagNaam?: (ann) => string,
 *           omhullende?: (ann) => ({x:number, y:number, width:number, height:number}|null) }} [namen]
 */
export function opmerkingRij(ann, namen = {}) {
  const status = ann.status && String(ann.status).toLowerCase() !== 'none' ? String(ann.status) : '';
  const replies = Array.isArray(ann.replies) ? ann.replies.filter(Boolean) : [];
  const b = (namen.omhullende ? namen.omhullende(ann) : null)
    || (Number.isFinite(ann.x) && Number.isFinite(ann.y)
      ? { x: ann.x, y: ann.y, width: ann.width, height: ann.height } : null);
  return [
    ann.id ?? '',
    ann.page ?? '',
    namen.typeNaam ? namen.typeNaam(ann) : (ann.type || ''),
    ann.author || '',
    csvDatum(ann.createdAt),
    csvDatum(ann.modifiedAt || ann.createdAt),
    status && namen.statusNaam ? namen.statusNaam(status) : status,
    status ? (ann.statusBy || '') : '',
    status ? csvDatum(ann.statusAt) : '',
    ann.subject || '',
    inhoudVan(ann),
    replies.length,
    reactiesTekst(replies),
    ann.color || ann.strokeColor || '',
    namen.laagNaam ? (namen.laagNaam(ann) || '') : '',
    b ? tweeDecimalen(b.x) : '',
    b ? tweeDecimalen(b.y) : '',
    b ? tweeDecimalen(b.width) : '',
    b ? tweeDecimalen(b.height) : '',
  ];
}

/**
 * De annotaties in de volgorde van de rijen van het paneel (na filter,
 * groepering en sortering). Kopregels vallen weg, elke annotatie telt één
 * keer, een rij zonder annotatie in het document ook.
 * @param {object[]} items  de rijen uit annotationsStore
 * @param {object[]} annotations  alle annotaties van het document
 */
export function opmerkingenInLijstvolgorde(items, annotations) {
  const opId = new Map((annotations || []).filter(Boolean).map((a) => [a.id, a]));
  const uit = [];
  const gezien = new Set();
  for (const item of items || []) {
    if (!item || item.isHeader) continue;
    const ann = opId.get(item.id);
    if (!ann || gezien.has(ann)) continue;
    gezien.add(ann);
    uit.push(ann);
  }
  return uit;
}

/**
 * De geselecteerde annotaties voor een XFDF-export, in documentvolgorde. Op
 * id, want de selectie kan kopieën bevatten. Een vervanging (#508) gaat in
 * haar geheel mee, net als bij knippen en verwijderen.
 * @param {object[]} annotations  alle annotaties van het document
 * @param {object[]} selectie
 */
export function geselecteerdVoorExport(annotations, selectie) {
  const lijst = (annotations || []).filter(Boolean);
  const ids = new Set((selectie || []).filter(Boolean).map((a) => a.id));
  if (ids.size === 0) return [];
  const gekozen = lijst.filter((a) => ids.has(a.id));
  const metPartners = new Set(expandCorrectionGroups(lijst, gekozen));
  return lijst.filter((a) => metPartners.has(a));
}
