// Document splitsen (#381): de pure regels, zonder pdf-lib of app.
//
// - Welke pagina's samen een deel worden: per N pagina's, per bladwijzer op
//   het hoogste niveau, of zo veel pagina's als onder een maximale
//   bestandsgrootte passen (gemeten met een meegegeven functie).
// - Hoe de delen heten: een patroon met {name}, {n}, {bookmark}, {start} en
//   {end}, opgeschoond tot een naam die Windows, macOS en Linux accepteren.
// - Wat er per deel meegaat: de bladwijzers, paginalabels en draaiingen van
//   de pagina's in dat deel, naar hun nieuwe paginanummers.
//
// Een deel is { start, eind } met paginanummers vanaf 1, beide inclusief.

import { leesGetal } from '../core/getal-invoer.js';

/** Langste bestandsnaam (zonder .pdf) die we maken; ruim binnen 255 en MAX_PATH. */
export const MAX_NAAM_LENGTE = 120;

/** De drie manieren van splitsen, zoals de dialoog ze kent. */
export const SPLITS_MODI = Object.freeze(['pages', 'bookmarks', 'size']);

/** Een geheel aantal pagina's per deel, minstens 1. */
export function geldigAantal(waarde, terugval = 1) {
  const n = Math.round(leesGetal(String(waarde ?? '')));
  return Number.isFinite(n) && String(waarde ?? '').trim() !== '' ? Math.max(1, n) : terugval;
}

/** Een maximale grootte in MB, minstens 0,1 MB. Een komma telt als decimaalteken. */
export function geldigeMb(waarde, terugval = 10) {
  const tekst = String(waarde ?? '').trim();
  const n = leesGetal(tekst);
  if (tekst === '' || !Number.isFinite(n)) return terugval;
  return Math.max(0.1, Math.round(n * 100) / 100);
}

/** MB (zoals Verkenner ze toont, 1024 x 1024 bytes) naar bytes. */
export function mbNaarBytes(mb) {
  return Math.round(Number(mb) * 1024 * 1024);
}

/** Elke `n` pagina's een deel; het laatste deel krijgt de rest. */
export function bereikenPerAantal(totaal, n) {
  const stap = geldigAantal(n, 1);
  const delen = [];
  for (let start = 1; start <= totaal; start += stap) {
    delen.push({ start, eind: Math.min(totaal, start + stap - 1) });
  }
  return delen;
}

/**
 * Delen die de aanroeper zelf koos (de splitsmarkeringen van Pagina's
 * bewerken, #764), gecontroleerd: gehele paginanummers binnen het document,
 * start <= eind, oplopend en zonder overlap. Wat niet klopt valt weg.
 * @param {{start:number, eind:number}[]} delen
 */
export function bereikenUitDelen(delen, totaal) {
  const uit = [];
  let vorige = 0;
  for (const d of Array.isArray(delen) ? delen : []) {
    const start = Number(d?.start);
    const eind = Number(d?.eind);
    if (!Number.isInteger(start) || !Number.isInteger(eind)) continue;
    if (start < 1 || eind > totaal || start > eind || start <= vorige) continue;
    uit.push({ start, eind });
    vorige = eind;
  }
  return uit;
}

/**
 * De bladwijzers op het hoogste niveau (geen ouder, of een ouder die niet
 * bestaat), in de volgorde van het bladwijzerpaneel.
 * @param {{id:string, parentId?:string|null, sortOrder?:number, page:number, title:string}[]} bladwijzers
 */
export function bovensteBladwijzers(bladwijzers) {
  const lijst = Array.isArray(bladwijzers) ? bladwijzers.filter(Boolean) : [];
  const ids = new Set(lijst.map((b) => b.id));
  return lijst
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => !b.parentId || !ids.has(b.parentId))
    .sort((x, y) => ((x.b.sortOrder ?? x.i) - (y.b.sortOrder ?? y.i)) || (x.i - y.i))
    .map(({ b }) => b);
}

/**
 * Een deel per bladwijzer op het hoogste niveau: van zijn pagina tot vlak
 * vóór de volgende. Pagina's vóór de eerste bladwijzer worden een eigen deel
 * zonder titel. Twee bladwijzers op dezelfde pagina: de eerste geeft de naam.
 * Bladwijzers buiten het document tellen niet.
 * @returns {{start:number, eind:number, titel:string|null}[]}
 */
export function bereikenOpBladwijzers(bladwijzers, totaal) {
  const begin = [];
  const gezien = new Set();
  const boven = bovensteBladwijzers(bladwijzers)
    .map((b, volgorde) => ({ b, volgorde }))
    .filter(({ b }) => Number.isInteger(b.page) && b.page >= 1 && b.page <= totaal)
    .sort((x, y) => (x.b.page - y.b.page) || (x.volgorde - y.volgorde));
  for (const { b } of boven) {
    if (gezien.has(b.page)) continue;
    gezien.add(b.page);
    begin.push({ start: b.page, titel: typeof b.title === 'string' ? b.title : null });
  }
  if (begin.length === 0) return [];
  if (begin[0].start > 1) begin.unshift({ start: 1, titel: null });
  return begin.map((d, i) => ({
    start: d.start,
    eind: i + 1 < begin.length ? begin[i + 1].start - 1 : totaal,
    titel: d.titel,
  }));
}

/**
 * Zo veel opeenvolgende pagina's per deel als onder `maxBytes` passen.
 * `grootteVan(start, eind)` geeft de echte grootte in bytes van een bestand
 * met die pagina's (gedeelde lettertypen en beelden tellen één keer). Per
 * deel eerst verdubbelend zoeken, dan halverend: zo blijft het aantal
 * metingen klein. Een pagina die alleen al groter is wordt een eigen deel met
 * `teGroot`.
 * @param {number} totaal
 * @param {number} maxBytes
 * @param {(start:number, eind:number) => Promise<number>} grootteVan
 * @returns {Promise<{start:number, eind:number, teGroot:boolean}[]>}
 */
export async function bereikenOpGrootte(totaal, maxBytes, grootteVan) {
  const gemeten = new Map();
  const past = async (start, eind) => {
    const sleutel = `${start}-${eind}`;
    if (!gemeten.has(sleutel)) gemeten.set(sleutel, await grootteVan(start, eind));
    return gemeten.get(sleutel) <= maxBytes;
  };
  const delen = [];
  let start = 1;
  while (start <= totaal) {
    if (!(await past(start, start))) {
      delen.push({ start, eind: start, teGroot: true });
      start += 1;
      continue;
    }
    // lo past zeker; hi past niet (of ligt voorbij het eind).
    let lo = start;
    let stap = 1;
    while (lo + stap <= totaal && (await past(start, lo + stap))) {
      lo += stap;
      stap *= 2;
    }
    let hi = Math.min(lo + stap, totaal + 1);
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (await past(start, mid)) lo = mid;
      else hi = mid;
    }
    delen.push({ start, eind: lo, teGroot: false });
    start = lo + 1;
  }
  return delen;
}

const GERESERVEERD = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Een bestandsnaam (zonder map) die Windows, macOS en Linux accepteren:
 * geen < > : " / \ | ? * of stuurtekens, witruimte samengevoegd, geen punt of
 * spatie aan het begin of eind, geen gereserveerde Windows-naam (CON, NUL,
 * COM1...), hooguit MAX_NAAM_LENGTE tekens. Blijft er niets over, dan
 * `terugval`.
 */
export function veiligeBestandsnaam(tekst, terugval = 'document') {
  let naam = String(tekst ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[\x00-\x1f\x7f]+/g, '_')
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim()
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');
  if (naam.length > MAX_NAAM_LENGTE) naam = naam.slice(0, MAX_NAAM_LENGTE).replace(/[.\s]+$/, '');
  if (!naam || /^[_.\s]+$/.test(naam)) return terugval;
  if (GERESERVEERD.test(naam)) naam = `_${naam}`.slice(0, MAX_NAAM_LENGTE);
  return naam;
}

/** Het standaardpatroon voor een manier van splitsen. */
export function standaardPatroon(modus) {
  return modus === 'bookmarks' ? '{bookmark}' : '{name}-{n}';
}

/** Documentnaam zonder map en zonder .pdf. */
function kaleNaam(naam) {
  const zonderMap = String(naam ?? '').split(/[\\/]/).pop() || '';
  return zonderMap.replace(/\.pdf$/i, '') || 'document';
}

/**
 * Het patroon ingevuld voor één deel. {n} krijgt voorloopnullen tot de
 * breedte van het aantal delen (01..12), zodat de bestanden op volgorde
 * staan. {bookmark} zonder titel wordt de documentnaam. Een leeg patroon is
 * {name}-{n}. Hoofdletters in de plaatshouders maken niet uit.
 * @param {string} patroon
 * @param {{naam:string, n:number, aantal:number, titel?:string|null, start:number, eind:number}} w
 */
export function vulPatroon(patroon, { naam, n, aantal, titel = null, start, eind }) {
  const kaal = kaleNaam(naam);
  const breedte = String(Math.max(1, aantal || 1)).length;
  const waarden = {
    name: kaal,
    n: String(n).padStart(breedte, '0'),
    bookmark: titel && String(titel).trim() ? String(titel) : kaal,
    start: String(start),
    end: String(eind),
  };
  const bron = String(patroon ?? '').trim() || '{name}-{n}';
  return bron.replace(/\{(name|n|bookmark|start|end)\}/gi, (_, sleutel) => waarden[sleutel.toLowerCase()]);
}

/**
 * De bestandsnamen (met .pdf) van alle delen: het patroon ingevuld en
 * opgeschoond, en uniek zonder op hoofdletters te letten (Windows) door er
 * " (2)", " (3)" ... achter te zetten.
 * @param {{start:number, eind:number, titel?:string|null}[]} delen
 * @param {{patroon:string, naam:string}} opties
 */
export function bestandsnamenVoorDelen(delen, { patroon, naam }) {
  const gebruikt = new Set();
  const kaal = kaleNaam(naam);
  return delen.map((deel, i) => {
    const gevuld = vulPatroon(patroon, {
      naam, n: i + 1, aantal: delen.length, titel: deel.titel ?? null, start: deel.start, eind: deel.eind,
    }).replace(/\.pdf$/i, '');
    const basis = veiligeBestandsnaam(gevuld, `${kaal}-${i + 1}`);
    let kandidaat = basis;
    for (let volg = 2; gebruikt.has(kandidaat.toLowerCase()); volg++) kandidaat = `${basis} (${volg})`;
    gebruikt.add(kandidaat.toLowerCase());
    return `${kandidaat}.pdf`;
  });
}

/**
 * De bladwijzers die in een deel vallen, met hun paginanummer in het deel.
 * Valt de ouder buiten het deel, dan hangt de bladwijzer aan de eerste
 * voorouder die er wel in valt, of op het hoogste niveau. Kopieën: het
 * origineel blijft zoals het is.
 */
export function bladwijzersVoorDeel(bladwijzers, start, eind) {
  const lijst = Array.isArray(bladwijzers) ? bladwijzers.filter(Boolean) : [];
  const perId = new Map(lijst.map((b) => [b.id, b]));
  const binnen = (b) => Number.isInteger(b.page) && b.page >= start && b.page <= eind;
  const houd = new Set(lijst.filter(binnen).map((b) => b.id));
  return lijst.filter(binnen).map((b) => {
    let ouder = b.parentId ? perId.get(b.parentId) : null;
    const bezocht = new Set([b.id]);
    while (ouder && !houd.has(ouder.id) && !bezocht.has(ouder.id)) {
      bezocht.add(ouder.id);
      ouder = ouder.parentId ? perId.get(ouder.parentId) : null;
    }
    return { ...b, page: b.page - start + 1, parentId: ouder && houd.has(ouder.id) ? ouder.id : null };
  });
}

/** De paginalabels van een deel, of null als het document geen eigen labels heeft. */
export function labelsVoorDeel(labels, start, eind) {
  if (!Array.isArray(labels) || labels.length < start) return null;
  return labels.slice(start - 1, eind).map((l) => (typeof l === 'string' ? l : String(l ?? '')));
}

/** De draaiingen van de app ({pagina: graden}) voor een deel, naar de nieuwe nummers. */
export function rotatiesVoorDeel(rotaties, start, eind) {
  const uit = {};
  if (!rotaties || typeof rotaties !== 'object') return uit;
  for (let p = start; p <= eind; p++) {
    const graden = (((Number(rotaties[p]) || 0) % 360) + 360) % 360;
    if (graden) uit[p - start + 1] = graden;
  }
  return uit;
}

/** Een bestandsnaam in een map, met het scheidingsteken dat de map al gebruikt. */
export function padInMap(map, naam) {
  if (!map) return naam;
  const sep = map.includes('\\') && !map.includes('/') ? '\\' : (map.includes('/') ? '/' : '\\');
  return /[\\/]$/.test(map) ? `${map}${naam}` : `${map}${sep}${naam}`;
}

/** De map van een pad ('' zonder map). */
export function mapVanPad(pad) {
  if (!pad) return '';
  const snede = Math.max(pad.lastIndexOf('/'), pad.lastIndexOf('\\'));
  return snede > 0 ? pad.slice(0, snede) : '';
}

/**
 * De documentnaam waar {name} voor staat: van het echte bestand (niet van een
 * werkkopie of het tijdelijke bestand van een naamloos document).
 * @param {{isUntitled?:boolean, saveTargetPath?:string, filePath?:string, fileName?:string}|null} doc
 */
export function documentNaam(doc) {
  const echt = doc && !doc.isUntitled ? (doc.saveTargetPath || doc.filePath) : null;
  return (echt ? echt.split(/[\\/]/).pop() : doc?.fileName) || 'document';
}
