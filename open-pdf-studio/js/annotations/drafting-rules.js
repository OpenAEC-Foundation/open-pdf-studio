// Schaalgebied-bewuste brug tussen de PURE tekeningtype-module
// (js/drafting/tekeningtype.js) en de app-state.
//
// RESOLUTIE "welke regels gelden voor dit component op deze positie"
// (ontwerpbesluit 2026-07-28):
//   1. ligt het referentiepunt van het component in een schaalgebied met een
//      toegewezen tekeningtype (region.tekeningtypeId) → dat tekeningtype;
//   2. anders → de STANDAARD-regelset (data.defaultId) — géén apart gedrag
//      buiten schaalgebieden.
// Een EXPLICIET op de annotatie gezette waarde (ann.lineWidth, ann.fontSize,
// ann.tagFontSize) wint altijd van de geërfde regelset-waarde; dat regelen de
// effective*-helpers hieronder.
//
// Importdiscipline: alleen de LICHTE bronnen (scale-region.js: state +
// factory) — zelfde patroon als stavenreeks-scale.js, zodat rendering.js,
// saver.js én stores deze module zonder cyclus kunnen gebruiken.

import { state } from '../core/state.js';
import { getScaleRegionAt } from './scale-region.js';
import { DRAFTING_LINE_WIDTH } from './drafting.js';
import { ifcCategoryForAnnotation } from '../solid/data/ifcCategoryMap.js';
import {
  MM_TO_PX, DEFAULT_SCALE_KEY,
  migrateTekeningtypen, scaleKeyFromScaleString,
  resolveLineWidthMm, resolveTextHeightMm,
} from '../drafting/tekeningtype.js';

/** Annotatietypen die door de tekeningtype-regelset gestuurd worden. */
export const DRAFTING_RULE_TYPES = new Set([
  'parametricSymbol', 'stavenreeks', 'betonbalk',
]);

/**
 * Actuele (gemigreerde) tekeningtype-data uit de preferences. Seedt de
 * standaard-regelset bij eerste gebruik en schrijft migraties terug.
 */
export function getTekeningtypenData() {
  const cur = state.preferences?.tekeningtypen;
  const next = migrateTekeningtypen(cur);
  if (next !== cur && state.preferences) {
    state.preferences.tekeningtypen = next;
  }
  return next;
}

/** Regelset op id, of null. */
export function getRegelsetById(id) {
  if (!id) return null;
  return getTekeningtypenData().regelsets.find(r => r.id === id) || null;
}

/** De standaard-regelset (geldt buiten schaalgebieden — besluit gebruiker). */
export function getDefaultRegelset() {
  const d = getTekeningtypenData();
  return d.regelsets.find(r => r.id === d.defaultId) || d.regelsets[0] || null;
}

/** Persisteer wijzigingen aan de tekeningtype-data (preferences-mechanisme). */
export function saveTekeningtypen(next) {
  if (next && state.preferences) state.preferences.tekeningtypen = next;
  // Lazy import: preferences.js trekt bridge/ui mee — een statische import
  // vanuit deze (door rendering.js gebruikte) module zou een cyclus vormen.
  import('../core/preferences.js')
    .then(m => m.savePreferences && m.savePreferences())
    .catch(() => { /* buiten Tauri geen file-backend */ });
}

/**
 * Regels op een punt: { regelset, scaleKey }.
 * Het schaalgebied bepaalt zowel het tekeningtype (toewijzing) als de
 * schaal-kolom (scaleKey uit zijn scaleString); buiten elk gebied geldt de
 * standaard-regelset op de standaardschaal 1:100.
 */
export function rulesAtPoint(pageNum, x, y) {
  const region = getScaleRegionAt(pageNum, x, y);
  const regelset = (region && region.tekeningtypeId
    ? getRegelsetById(region.tekeningtypeId) : null) || getDefaultRegelset();
  const scaleKey = region
    ? scaleKeyFromScaleString(region.scaleString || '1:100')
    : DEFAULT_SCALE_KEY;
  return { regelset, scaleKey, region };
}

// Referentiepunt van een annotatie: midden van het lijnstuk (lijnvormige
// componenten) of het bbox-midden — rotatie-onafhankelijk en consistent met
// stavenreeksPxPerMm/betonbalk-scale.
function annAnchor(ann) {
  if (Number.isFinite(Number(ann?.startX)) && Number.isFinite(Number(ann?.endX))) {
    return {
      x: (Number(ann.startX) + Number(ann.endX)) / 2,
      y: (Number(ann.startY) + Number(ann.endY)) / 2,
    };
  }
  return {
    x: (Number(ann?.x) || 0) + (Number(ann?.width) || 0) / 2,
    y: (Number(ann?.y) || 0) + (Number(ann?.height) || 0) / 2,
  };
}

/** Regels voor een ANNOTATIE (referentiepunt-bewust). */
export function rulesForAnnotation(ann) {
  const p = annAnchor(ann);
  return rulesAtPoint(ann?.page, p.x, p.y);
}

/**
 * Effectieve lijndikte (app-px) van een NL-tekenwerkcomponent.
 * Expliciete annotatie-waarde ("eigen instelling") wint; anders de
 * regelset-lijndikte voor de IFC-categorie van het component (papier-mm →
 * px); als laatste terugval de vaste tekenpen DRAFTING_LINE_WIDTH.
 */
export function effectiveDraftingLineWidth(ann) {
  const explicit = Number(ann?.lineWidth);
  if (ann?.lineWidth != null && Number.isFinite(explicit)) return explicit;
  try {
    const { regelset, scaleKey } = rulesForAnnotation(ann);
    const mm = resolveLineWidthMm(regelset, ifcCategoryForAnnotation(ann), scaleKey);
    if (mm != null) return mm * MM_TO_PX;
  } catch (_) { /* regelset onbruikbaar → vaste pen */ }
  return DRAFTING_LINE_WIDTH;
}

/**
 * Teksthoogte (app-px) voor tags/labels (tekstsoort 'labels') volgens de
 * regelset op een PUNT. Gebruikt bij het PLAATSEN van een component: de
 * geresolvede waarde wordt op de annotatie gestempeld, zodat álle
 * geometrie-consumenten (render, hit-test, AABB, saver) dezelfde
 * label-maat zien. Een expliciete gebruikers-override wint (aanroeper);
 * `fallback` is de bestaande component-default voor als de regelset niets
 * voorschrijft.
 */
export function labelFontSizeAt(pageNum, x, y, fallback) {
  try {
    const { regelset } = rulesAtPoint(pageNum, x, y);
    const mm = resolveTextHeightMm(regelset, 'labels');
    if (mm != null) return mm * MM_TO_PX;
  } catch (_) { /* regelset onbruikbaar → component-default */ }
  return fallback;
}
