// Tool Sets (#311, #629): een werkkist maken uit de markeringen in een
// XFDF-bestand.
//
// XFDF (ISO 19444-1) is het open uitwisselformaat voor markeringen dat veel
// markeerprogramma's kunnen exporteren. Een "werkset" uit zo'n programma komt
// zo binnen: exporteer de voorbeeldmarkeringen (één per gereedschap) als
// XFDF, en elke markering wordt een item met haar kleur, lijndikte, vulling,
// lijnstijl, pijlpunten en naam (het attribuut subject). Getekende geometrie,
// auteur en datums reizen niet mee, net als bij een eigen item.
//
// Herkend worden de elementen en intents die de specificatie definieert:
//   line (LineArrow, LineDimension), polyline (PolyLineDimension),
//   polygon (PolygonCloud, PolygonDimension), square, circle.
// Twee markeringen met precies dezelfde instellingen geven één item.
//
// Puur: werkt op een geparseerd XML-document (DOMParser in de app, de kleine
// DOM uit review/mini-xml-dom.testhulp.mjs in de tests). Het resultaat gaat
// door parseToolSetFile, zodat dezelfde controles en grenzen gelden als voor
// een eigen uitwisselbestand.

import { TOOL_SET_FORMAT, TOOL_SET_VERSION, parseToolSetFile, uniqueName, isToolSetType } from './tool-sets.js';

// PDF-lijneinden (/LE) -> pijlpunt in de app, zoals de lader ze leest.
const KOPPEN = {
  OpenArrow: 'open', ClosedArrow: 'closed', Diamond: 'diamond', Circle: 'circle', Square: 'square',
  Slash: 'slash', Butt: 'butt', ROpenArrow: 'openReversed', RClosedArrow: 'closedReversed', None: 'none',
};

const HEX = /^#[0-9a-f]{6}$/i;

function kleur(waarde) {
  const s = String(waarde ?? '').trim();
  return HEX.test(s) ? s.toLowerCase() : null;
}

function getal(waarde, min, max) {
  const n = Number.parseFloat(waarde);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Het type in de app voor een XFDF-element, of null. */
function typeVan(tag, intent, stijl, kop, staart) {
  const i = String(intent || '');
  switch (tag) {
    case 'line':
      if (i === 'LineDimension') return 'measureDistance';
      if (i === 'LineArrow') return 'arrow';
      return (kop && kop !== 'None') || (staart && staart !== 'None') ? 'arrow' : 'line';
    case 'polyline':
      return i === 'PolyLineDimension' ? 'measurePerimeter' : 'polyline';
    case 'polygon':
      if (i === 'PolygonDimension') return 'measureArea';
      if (i === 'PolygonCloud' || stijl === 'cloudy') return 'cloud';
      return 'polygon';
    case 'square': return 'box';
    case 'circle': return 'circle';
    default: return null;
  }
}

/** De instellingen van één XFDF-element als annotatie-eigenschappen. */
function eigenschappenVan(el, type) {
  const props = {};
  const c = kleur(el.getAttribute('color'));
  if (c) { props.color = c; props.strokeColor = c; }
  const vul = kleur(el.getAttribute('interior-color'));
  if (vul && !/^(line|arrow|polyline|measureDistance|measurePerimeter)$/.test(type)) props.fillColor = vul;
  const breedte = getal(el.getAttribute('width'), 0, 100);
  if (breedte !== null) props.lineWidth = breedte;
  const dekking = getal(el.getAttribute('opacity'), 0, 1);
  if (dekking !== null) props.opacity = dekking;
  const stijl = el.getAttribute('style');
  if (stijl === 'dash') {
    const eerste = getal(String(el.getAttribute('dashes') || '').split(/[,\s]+/)[0], 0, 1000);
    props.borderStyle = eerste !== null && eerste <= 1 ? 'dotted' : 'dashed';
  } else if (stijl === 'solid') props.borderStyle = 'solid';
  if (type === 'cloud') {
    const sterkte = getal(el.getAttribute('intensity'), 0, 10);
    if (sterkte !== null && sterkte > 0) props.cloudIntensity = sterkte;
  }
  if (type === 'arrow' || type === 'line' || type === 'measureDistance') {
    const kop = KOPPEN[el.getAttribute('head')];
    const staart = KOPPEN[el.getAttribute('tail')];
    if (kop) props.startHead = kop;
    if (staart) props.endHead = staart;
  }
  return props;
}

const vingerafdruk = (type, props, laag) => JSON.stringify([type, Object.keys(props).sort().map((k) => [k, props[k]]), laag || '']);

/**
 * Een werkkist uit een geparseerd XFDF-document.
 * @param {Document|object} xml  uitkomst van DOMParser.parseFromString
 * @param {{name?: string, typeName?: (type: string) => string}} [opties]
 *   name: de naam van de werkkist (bijvoorbeeld de bestandsnaam);
 *   typeName: naam van een item zonder eigen naam
 * @returns {{ok: true, set: object, skipped: number} | {ok: false, error: string}}
 *   error: 'not-xfdf' | 'no-items' of een fout van parseToolSetFile
 */
export function toolSetFromXfdf(xml, { name = '', typeName = (t) => t } = {}) {
  if (!xml || typeof xml.querySelector !== 'function' || xml.querySelector('parsererror')) {
    return { ok: false, error: 'not-xfdf' };
  }
  const annots = xml.querySelector('annots');
  if (!annots) return { ok: false, error: 'not-xfdf' };

  const items = [];
  const gezien = new Set();
  const namen = [];
  let overgeslagen = 0;
  for (const el of annots.children || []) {
    const tag = el.localName || el.tagName;
    const type = typeVan(tag, el.getAttribute('intent'), el.getAttribute('style'), el.getAttribute('head'), el.getAttribute('tail'));
    if (!type || !isToolSetType(type)) { overgeslagen++; continue; }
    const props = eigenschappenVan(el, type);
    const laagNaam = String(el.getAttribute('opslayer') || '').trim();
    const sleutel = vingerafdruk(type, props, laagNaam);
    if (gezien.has(sleutel)) continue;
    gezien.add(sleutel);
    const eigen = String(el.getAttribute('subject') || '').trim();
    const naam = uniqueName(eigen || typeName(type) || type, namen);
    namen.push(naam);
    const item = { name: naam, type, props };
    if (laagNaam) item.layer = { name: laagNaam, color: null };
    items.push(item);
  }
  if (items.length === 0) return { ok: false, error: 'no-items' };

  const r = parseToolSetFile(JSON.stringify({
    format: TOOL_SET_FORMAT,
    version: TOOL_SET_VERSION,
    toolSet: { name: name || 'XFDF', items },
  }));
  return r.ok ? { ...r, skipped: r.skipped + overgeslagen } : r;
}
