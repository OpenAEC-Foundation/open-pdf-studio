// Bewerkbare documentgegevens (#1017): titel, auteur, onderwerp, trefwoorden
// en maker uit het eigenschappen-paneel.
//
// Het model is een overlay op het document (`doc.documentgegevens`): alleen
// de velden die de gebruiker invulde, als gewone tekst; '' betekent "leeg
// gemaakt". De saver schrijft ze bij elke save in /Info én, als het document
// een XMP-pakket (/Metadata in de catalogus) heeft, in dat pakket, zodat
// programma's die het XMP voorrang geven dezelfde waarden tonen. Schrijven is
// idempotent: een veld dat al zo in het bestand staat, blijft ongemoeid (een
// incrementele save ziet dan geen wijziging).
//
// Geen DOM-parsing: het XMP wordt als tekst bewerkt (ook onder node).

// Dit bestand laadt geen pdf-lib (het paneel gebruikt het); het schrijven in
// het pdf-lib-document staat in saver/documentgegevens-opslaan.js.

import { xmpDatum } from './pdfa/xmp.js';

/** De velden die het paneel laat bewerken, in weergavevolgorde. */
export const BEWERKBARE_VELDEN = Object.freeze(['title', 'author', 'subject', 'keywords', 'creator']);

/** Veld → /Info-sleutel. */
export const INFO_SLEUTEL = Object.freeze({
  title: 'Title', author: 'Author', subject: 'Subject', keywords: 'Keywords', creator: 'Creator',
});

// Veld → XMP-eigenschap, zoals ISO 19005-1 6.7.3 ze aan /Info koppelt.
// `soort`: 'alt' (taalalternatieven, x-default), 'seq' (geordende lijst) of
// 'tekst' (eenvoudige waarde, ook als attribuut toegestaan).
const XMP_VELD = Object.freeze({
  title: { prop: 'dc:title', soort: 'alt', ns: 'dc' },
  author: { prop: 'dc:creator', soort: 'seq', ns: 'dc' },
  subject: { prop: 'dc:description', soort: 'alt', ns: 'dc' },
  keywords: { prop: 'pdf:Keywords', soort: 'tekst', ns: 'pdf' },
  creator: { prop: 'xmp:CreatorTool', soort: 'tekst', ns: 'xmp' },
});

const NAMESPACES = Object.freeze({
  dc: 'http://purl.org/dc/elements/1.1/',
  pdf: 'http://ns.adobe.com/pdf/1.3/',
  xmp: 'http://ns.adobe.com/xap/1.0/',
});

const isVeld = (v) => BEWERKBARE_VELDEN.includes(v);

/** Tekst zoals hij in het bestand komt: geen null, geen regeleinden. */
export function normaliseerWaarde(waarde) {
  return String(waarde ?? '').replace(/[\r\n]+/g, ' ');
}

/**
 * De overlay met één veld erbij of gewijzigd. `origineel` is wat het bestand
 * zelf heeft: is de nieuwe waarde daaraan gelijk, dan valt het veld uit de
 * overlay (terug naar het bestand). Geeft altijd een nieuw object (het
 * document kopieert bij toewijzen).
 * @returns {Record<string,string>|null} null als er niets meer overblijft
 */
export function overlayMet(overlay, veld, waarde, origineel) {
  if (!isVeld(veld)) throw new Error(`unknown document info field: ${veld}`);
  const uit = { ...(overlay || {}) };
  const w = normaliseerWaarde(waarde);
  if (origineel !== undefined && w === normaliseerWaarde(origineel)) delete uit[veld];
  else uit[veld] = w;
  return Object.keys(uit).length ? uit : null;
}

/**
 * De waarden zoals het paneel ze toont: wat het bestand heeft (`info`, de
 * /Info-sleutels zoals pdf.js ze geeft) met de overlay eroverheen.
 * @returns {Record<string,string>} per veld, '' als het leeg is
 */
export function zichtbareWaarden(info, overlay) {
  const uit = {};
  for (const veld of BEWERKBARE_VELDEN) {
    if (overlay && Object.prototype.hasOwnProperty.call(overlay, veld)) uit[veld] = normaliseerWaarde(overlay[veld]);
    else {
      const v = info?.[INFO_SLEUTEL[veld]];
      uit[veld] = typeof v === 'string' ? v : '';
    }
  }
  return uit;
}

// ── XMP ──────────────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function element(prop, soort, waarde) {
  const w = esc(waarde);
  if (soort === 'alt') return `<${prop}><rdf:Alt><rdf:li xml:lang="x-default">${w}</rdf:li></rdf:Alt></${prop}>`;
  if (soort === 'seq') return `<${prop}><rdf:Seq><rdf:li>${w}</rdf:li></rdf:Seq></${prop}>`;
  return `<${prop}>${w}</${prop}>`;
}

/** Element- of attribuutvorm van `prop` vervangen, weghalen of toevoegen. */
function zetEigenschap(xml, prop, soort, ns, waarde) {
  const p = reEsc(prop);
  const leeg = waarde === '';
  // Elementvorm (met of zonder inhoud).
  const el = new RegExp(`[ \\t]*<${p}(\\s[^>]*?)?(?:/>|>[\\s\\S]*?</${p}>)[ \\t]*\\r?\\n?`);
  if (el.test(xml)) {
    return xml.replace(el, (m) => {
      if (leeg) return '';
      const inspring = /^[ \t]*/.exec(m)[0];
      const einde = /\r?\n$/.exec(m)?.[0] || '';
      return inspring + element(prop, soort, waarde) + einde;
    });
  }
  // Attribuutvorm op een rdf:Description (alleen eenvoudige waarden).
  const attr = new RegExp(`(\\s)${p}\\s*=\\s*(["'])[\\s\\S]*?\\2`);
  if (attr.test(xml)) {
    return xml.replace(attr, (m, wit) => (leeg ? '' : `${wit}${prop}="${esc(waarde)}"`));
  }
  if (leeg) return xml;
  // Ontbreekt: in een rdf:Description die de namespace al declareert, anders
  // in een nieuwe.
  const nieuw = element(prop, soort, waarde);
  const uri = NAMESPACES[ns];
  const descRe = new RegExp(`<rdf:Description\\b[^>]*xmlns:${ns}\\s*=\\s*(["'])${reEsc(uri)}\\1[^>]*?(/?)>`);
  const desc = descRe.exec(xml);
  if (desc) {
    const start = desc.index;
    if (desc[2] === '/') {
      const open = desc[0].replace(/\s*\/>$/, '>');
      return xml.slice(0, start) + open + nieuw + '</rdf:Description>' + xml.slice(start + desc[0].length);
    }
    const sluit = xml.indexOf('</rdf:Description>', start + desc[0].length);
    if (sluit !== -1) return xml.slice(0, sluit) + nieuw + xml.slice(sluit);
  }
  const blok = `<rdf:Description rdf:about="" xmlns:${ns}="${uri}">${nieuw}</rdf:Description>`;
  const rdfEinde = xml.lastIndexOf('</rdf:RDF>');
  if (rdfEinde === -1) return xml; // geen RDF: niet aan te vullen
  return xml.slice(0, rdfEinde) + blok + '\n' + xml.slice(rdfEinde);
}

/** Een bestaande tijd-eigenschap (xmp:ModifyDate, xmp:MetadataDate) bijwerken. */
function werkTijdBij(xml, prop, tijd) {
  const p = reEsc(prop);
  const el = new RegExp(`(<${p}(?:\\s[^>]*)?>)[^<]*(</${p}>)`);
  if (el.test(xml)) return xml.replace(el, (m, a, b) => `${a}${tijd}${b}`);
  const attr = new RegExp(`(\\s${p}\\s*=\\s*)(["'])[^"']*\\2`);
  if (attr.test(xml)) return xml.replace(attr, (m, a) => `${a}"${tijd}"`);
  return xml;
}

/**
 * Het XMP-pakket met de gegeven velden bijgewerkt. Alleen velden die in
 * `waarden` staan, worden aangeraakt; '' haalt een eigenschap weg. Met
 * `wijzigTijd` (Date) krijgen een bestaande xmp:ModifyDate en
 * xmp:MetadataDate die tijd, maar alleen als er iets veranderde.
 * @param {string} xml
 * @param {Record<string,string>} waarden
 * @param {{ wijzigTijd?: Date|null }} [opties]
 */
export function werkXmpBij(xml, waarden, { wijzigTijd = null } = {}) {
  if (typeof xml !== 'string' || !/<rdf:RDF[\s>]/.test(xml)) return xml;
  let uit = xml;
  for (const veld of BEWERKBARE_VELDEN) {
    if (!waarden || !Object.prototype.hasOwnProperty.call(waarden, veld)) continue;
    const { prop, soort, ns } = XMP_VELD[veld];
    uit = zetEigenschap(uit, prop, soort, ns, normaliseerWaarde(waarden[veld]));
  }
  if (uit !== xml && wijzigTijd instanceof Date && !Number.isNaN(wijzigTijd.getTime())) {
    const t = xmpDatum(wijzigTijd);
    uit = werkTijdBij(uit, 'xmp:ModifyDate', t);
    uit = werkTijdBij(uit, 'xmp:MetadataDate', t);
  }
  return uit;
}
