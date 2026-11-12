// Opmaak van het actieve tekengereedschap (issue #668).
//
// Zolang er niets geselecteerd is en een tekengereedschap aan staat, stellen
// kleur en lijndikte in het lint (en de opmaakwerkbalk) de opmaak in van de
// VOLGENDE annotatie van dat gereedschap. Die opmaak staat in de
// stijlvoorkeuren per soort (stijl-mapping.js: dezelfde sleutels als "Als
// standaardstijl instellen" en het eigenschappenpaneel bij een actief
// gereedschap), dus ze blijft staan voor het volgende object van hetzelfde
// gereedschap, ook na een herstart.
//
// Pure module: alleen de stijltabel en twee pure hulpjes, zodat alles
// node-testbaar is.

import { getStyleMapping } from '../core/stijl-mapping.js';
import { hasFill } from '../annotations/fill-utils.js';
import { lintZetLijnkoppen } from '../pdf/lijnkoppen.js';

/** De opties van de werkbalk die een tekengereedschap kan krijgen. */
export const GEREEDSCHAP_OPMAAK_SLEUTELS = Object.freeze([
  'textColor', 'strokeColor', 'lineWidth', 'opacity', 'borderStyle', 'fillColor', 'fillOpacity', 'startHead', 'endHead',
]);

const MAX_LIJNDIKTE = 50;

// Gereedschappen die een ander annotatietype tekenen dan hun naam zegt. De
// ellips is een cirkel en leest de cirkelvoorkeuren (annotation-creators.js).
const GEREEDSCHAP_TYPE = Object.freeze({ rectangle: 'box', rect: 'box', ellipse: 'circle' });

// Voorkeuren die wel in de stijltabel staan, maar die het gereedschap bij het
// tekenen NIET leest. Die opties blijven uit: anders lijken ze opnieuw geen
// effect te hebben. De test zet elke aangeboden optie en kijkt of ze op de
// nieuwe annotatie terechtkomt.
const NIET_BIJ_TEKENEN = Object.freeze({
  highlight: ['opacity'],              // markeren tekent met een vaste dekking
  ellipse: ['opacity', 'fillOpacity'], // de ellips tekent op de halve cirkeldekking
  arrow: ['fillColor'],                // de pijlpunt negeert "geen vulling"
  cloud: ['fillColor', 'fillOpacity', 'borderStyle'], // de wolk tekent zonder vulling
  polyline: ['borderStyle'],
  measureDistance: ['borderStyle'],  // de maatlijn-tool tekent altijd doorgetrokken
});

/** Het annotatietype (en dus de stijlvoorkeuren) dat dit gereedschap tekent. */
export function stijlTypeVanGereedschap(tool) {
  if (typeof tool !== 'string' || !tool) return null;
  return GEREEDSCHAP_TYPE[tool] || tool;
}

function stijlVan(tool) {
  const type = stijlTypeVanGereedschap(tool);
  return type ? getStyleMapping(type) : null;
}

/** De opties die de werkbalk voor dit gereedschap kan instellen. */
export function gereedschapOpmaakOpties(tool) {
  const m = stijlVan(tool);
  if (!m) return [];
  const koppen = lintZetLijnkoppen(stijlTypeVanGereedschap(tool));
  const opties = [];
  if (m.textColor) opties.push('textColor');
  if (m.stroke || m.color) opties.push('strokeColor');
  if (m.width) opties.push('lineWidth');
  if (m.opacity) opties.push('opacity');
  if (m.borderStyle) opties.push('borderStyle');
  if (m.fill) opties.push('fillColor');
  if (m.fillOpacity) opties.push('fillOpacity');
  if (m.startHead && koppen) opties.push('startHead');
  if (m.endHead && koppen) opties.push('endHead');
  const uit = NIET_BIJ_TEKENEN[tool] || [];
  return opties.filter((k) => !uit.includes(k));
}

/** Ondersteunt dit gereedschap deze optie van de werkbalk? */
export function gereedschapOndersteunt(tool, key) {
  return gereedschapOpmaakOpties(tool).includes(key);
}

/**
 * Het gereedschap waarvan de werkbalk nu de opmaak instelt, of null: alleen
 * zonder selectie (een selectie gaat voor) en alleen voor een gereedschap
 * met ten minste één instelbare optie.
 */
export function gereedschapMetOpmaak(tool, aantalGeselecteerd = 0) {
  if (aantalGeselecteerd > 0) return null;
  return gereedschapOpmaakOpties(tool).length > 0 ? tool : null;
}

/**
 * De opmaak van het gereedschap zoals de werkbalk haar toont; dekking in
 * procenten, zoals de schuif. null voor een gereedschap zonder stijl.
 */
export function leesGereedschapOpmaak(prefs, tool) {
  const m = stijlVan(tool);
  if (!m) return null;
  const p = prefs || {};
  const lees = (achtervoegsel) => (achtervoegsel ? p[m.prefix + achtervoegsel] : undefined);
  const dikte = Number(lees(m.width));
  const dekking = lees(m.opacity);
  const vulling = lees(m.fill);
  const vulDekking = lees(m.fillOpacity);
  const lijnPct = typeof dekking === 'number' && Number.isFinite(dekking) ? Math.round(dekking) : 100;
  return {
    textColor: lees(m.textColor) || '#000000',
    strokeColor: lees(m.stroke) || lees(m.color) || '#000000',
    lineWidth: Number.isFinite(dikte) && dikte > 0 ? dikte : 1,
    opacity: lijnPct,
    // Zonder eigen voorkeur volgt de vulling de dekking (#685).
    fillOpacity: typeof vulDekking === 'number' && Number.isFinite(vulDekking) ? Math.round(vulDekking) : lijnPct,
    borderStyle: lees(m.borderStyle) || 'solid',
    fillColor: m.fill && !lees(m.fillNone) && hasFill(vulling) ? vulling : null,
    startHead: lees(m.startHead) || 'none',
    endHead: lees(m.endHead) || 'none',
  };
}

/**
 * Schrijf een wijziging van de werkbalk in de voorkeuren van het gereedschap.
 * Alleen ondersteunde opties met een bruikbare waarde tellen; de rest blijft
 * zoals hij was. `opacity` loopt van 0 tot 1 (zoals de werkbalk hem geeft),
 * `fillColor` null (of 'none') is "geen vulling". Muteert `prefs`; geeft
 * terug of er iets veranderde.
 */
export function zetGereedschapOpmaak(prefs, tool, patch) {
  const m = stijlVan(tool);
  if (!m || !prefs || !patch || typeof patch !== 'object') return false;
  const opties = new Set(gereedschapOpmaakOpties(tool));
  const p = m.prefix;
  let veranderd = false;
  const zet = (sleutel, waarde) => {
    if (prefs[sleutel] === waarde) return;
    prefs[sleutel] = waarde;
    veranderd = true;
  };

  if (opties.has('textColor') && typeof patch.textColor === 'string' && patch.textColor.trim() && patch.textColor !== 'mixed') {
    zet(p + m.textColor, patch.textColor.trim());
  }
  if (opties.has('strokeColor') && typeof patch.strokeColor === 'string' && patch.strokeColor.trim()) {
    zet(p + (m.stroke || m.color), patch.strokeColor.trim());
  }
  if (opties.has('lineWidth') && 'lineWidth' in patch) {
    const dikte = Number(patch.lineWidth);
    if (patch.lineWidth !== null && Number.isFinite(dikte) && dikte > 0 && dikte <= MAX_LIJNDIKTE) {
      zet(p + m.width, dikte);
    }
  }
  const geldigeDekking = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  if (opties.has('opacity') && geldigeDekking(patch.opacity)) {
    // Met een aparte vul-dekking houdt de vulling de dekking die ze had
    // (#685), net als bij een geselecteerde vorm (zetLijnDekking).
    if (opties.has('fillOpacity') && typeof prefs[p + m.fillOpacity] !== 'number') {
      const oud = prefs[p + m.opacity];
      zet(p + m.fillOpacity, typeof oud === 'number' && Number.isFinite(oud) ? Math.round(oud) : 100);
    }
    zet(p + m.opacity, Math.round(patch.opacity * 100));
  }
  if (opties.has('fillOpacity') && geldigeDekking(patch.fillOpacity)) {
    zet(p + m.fillOpacity, Math.round(patch.fillOpacity * 100));
  }
  if (opties.has('borderStyle') && typeof patch.borderStyle === 'string' && patch.borderStyle) {
    zet(p + m.borderStyle, patch.borderStyle);
  }
  if (opties.has('fillColor') && 'fillColor' in patch) {
    if (hasFill(patch.fillColor)) {
      zet(p + m.fill, patch.fillColor);
      if (m.fillNone) zet(p + m.fillNone, false);
    } else if (m.fillNone) {
      zet(p + m.fillNone, true);
    }
  }
  for (const kop of ['startHead', 'endHead']) {
    if (opties.has(kop) && typeof patch[kop] === 'string' && patch[kop]) zet(p + m[kop], patch[kop]);
  }
  return veranderd;
}
