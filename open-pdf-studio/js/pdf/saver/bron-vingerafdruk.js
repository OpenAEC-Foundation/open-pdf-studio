// Vingerafdrukken van annotaties: van het woordenboek in het bestand en van
// het model, om bij opslaan te weten wat de gebruiker veranderde. Zie
// saver/bron-behoud.js voor het hele verhaal.
//
// Puur: geen app-imports, zodat de lader het zonder de rest kan gebruiken.

import { PDFDict } from 'pdf-lib';

// ── vingerafdrukken ─────────────────────────────────────────────────────────

/** 53-bits hash van een tekenreeks (cyrb53), als korte tekst. */
export function hashTekst(tekst) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < tekst.length; i++) {
    const c = tekst.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Vingerafdruk van een annotatiewoordenboek: zoals pdf-lib het schrijft
 * (verwijzingen als 'n g R'), dus gelijk na opnieuw inlezen.
 */
export function dictVingerafdruk(dict) {
  return dict instanceof PDFDict ? hashTekst(dict.toString()) : null;
}

// Velden die niets aan de annotatie zelf zeggen: tijdelijke velden van de app
// ('_'), de bron zelf en het tijdstip van de laatste wijziging.
const NIET_VERGELIJKEN = new Set(['pdfBron', 'modifiedAt']);
const rondGetal = (_k, v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);

/** Per modelveld een hash; getallen op 1e-6, zodat heen en terug schuiven gelijk is. */
export function veldVingerafdrukken(ann) {
  const uit = {};
  for (const k of Object.keys(ann || {})) {
    if (k.startsWith('_') || NIET_VERGELIJKEN.has(k)) continue;
    const v = ann[k];
    if (v === undefined || typeof v === 'function') continue;
    let s;
    try { s = JSON.stringify(v, rondGetal); } catch { s = String(Math.random()); }
    if (s !== undefined) uit[k] = hashTekst(s);
  }
  return uit;
}

/** De modelvelden die verschillen tussen twee vingerafdrukken. */
export function verschillendeVelden(oud, nieuw) {
  const uit = [];
  for (const k of new Set([...Object.keys(oud || {}), ...Object.keys(nieuw || {})])) {
    if ((oud || {})[k] !== (nieuw || {})[k]) uit.push(k);
  }
  return uit;
}

// Modelvelden die alleen de vorm of plaats beschrijven (zie applyMoveGeneric
// in annotations/transforms.js, plus maat en straal). Verandert alleen
// zoiets, dan blijft de rest van het woordenboek staan.
export const VORM_VELDEN = new Set([
  'x', 'y', 'width', 'height', 'startX', 'startY', 'endX', 'endY', 'leaderStartX', 'leaderStartY',
  'leaderEndX', 'leaderEndY', 'labelX', 'labelY', 'cx', 'cy', 'centerX', 'centerY', 'radius',
  'at', 'vertex', 'point1', 'point2', 'points', 'path', 'controlPoints', 'vertices', 'holes',
  'rects', 'quadPoints', 'leaders', 'arrowX', 'arrowY', 'kneeX', 'kneeY', 'armOriginX', 'armOriginY',
]);
// Wat de review- en markeerstatus beschrijft (zie antwoordAnnotaties).
export const STATUS_VELDEN = ['status', 'statusBy', 'statusAt', 'marked'];

// Modelvelden die niets aan de tekening veranderen, met de sleutels die de
// saver ervoor schrijft. Status en antwoorden staan in eigen annotaties.
export const META_VELDEN = new Map([
  ['author', ['T']],
  ['subject', ['Contents', 'Subj']],
  ['pdfSubject', ['Subj']],
  ['nm', ['NM']],
  ['locked', ['F']],
  ['readOnly', ['F']],
  ['printable', ['F']],
  ['layerId', ['OC']],
  ['altText', ['OPS_AltText']],
  ['ifcCategory', ['OPS_IfcCategory']],
  ['spatialZone', ['OPS_SpatialZone']],
  ['locationOverride', ['OPS_LocationOverride']],
  ['status', []], ['statusBy', []], ['statusAt', []], ['marked', []], ['replies', []],
]);

// Het eerste punt van de vorm, in de volgorde waarin we het zoeken.
export const ANKER_PAREN = [['x', 'y'], ['startX', 'startY'], ['endX', 'endY'], ['cx', 'cy'], ['centerX', 'centerY']];
const ANKER_LIJSTEN = ['points', 'path', 'controlPoints', 'vertices', 'rects'];

/** Het eerste punt van de vorm: { veld, x, y } of null. */
export function ankerVan(ann) {
  if (!ann) return null;
  for (const [kx, ky] of ANKER_PAREN) {
    if (typeof ann[kx] === 'number' && typeof ann[ky] === 'number') return { veld: kx, x: ann[kx], y: ann[ky] };
  }
  for (const k of ANKER_LIJSTEN) {
    const p = Array.isArray(ann[k]) ? ann[k][0] : null;
    if (p && typeof p.x === 'number' && typeof p.y === 'number') return { veld: k, x: p.x, y: p.y };
  }
  return null;
}

// ── bij het laden ───────────────────────────────────────────────────────────

/**
 * De bron van een omgezette annotatie, of undefined als het woordenboek niet
 * bekend is (geen pdf-lib-gegevens voor deze pagina).
 * @param {object} model  het model zoals de lader het oplevert
 * @param {string} ref  pdf.js-id van het woordenboek
 * @param {Map<string,string>|undefined} dfps  pdf.js-id -> dictVingerafdruk
 * @param {{status?: string[], antwoorden?: string[], leiders?: string[]}} [mee]
 */
export function maakBron(model, ref, dfps, mee = {}) {
  const dfp = dfps?.get?.(ref);
  if (!model || !ref || !dfp || model.id == null) return undefined;
  const bron = { ref, id: model.id, dfp, velden: veldVingerafdrukken(model) };
  const anker = ankerVan(model);
  if (anker) bron.anker = anker;
  const lijst = {};
  for (const [soort, refs] of Object.entries(mee || {})) {
    const met = (refs || []).map((r) => ({ ref: r, dfp: dfps.get(r) })).filter((m) => m.dfp);
    if (met.length !== (refs || []).length) return undefined; // onvolledig: niets beloven
    if (met.length) lijst[soort] = met;
  }
  if (Object.keys(lijst).length) bron.mee = lijst;
  return bron;
}
