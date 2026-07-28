// Bewerkbare getallen op parametrische componenten — PURE kernmodule.
//
// Eén mechanisme waarmee elk parametrisch component (stavenreeks, betonbalk,
// parametrische symbolen, …) zijn direct-bewerkbare getallen/teksten kan
// aanmelden. Een provider levert per annotatie een lijst "entries": waar het
// getal op het canvas staat (een — eventueel geroteerd — vak in
// app-coördinaten), wat de huidige waarde is en via welk eigenschaps-pad een
// nieuwe waarde moet worden toegepast.
//
// Consumenten:
//  - annotations/rendering.js kleurt de aangemelde getallen BLAUW zodra de
//    annotatie (als enige) geselecteerd is — de klik-affordance;
//  - tools/inline-number-editing.js hit-test een klik tegen de vakken en
//    opent de bijpassende inline invoer.
//
// GEEN DOM- of state-imports: alles hier is los testbaar in node.

/**
 * Affordance-kleur van bewerkbare getallen bij selectie. Zelfde blauw als de
 * selectiekaders elders in de app.
 */
export const EDITABLE_NUMBER_COLOR = '#0066cc';

/** @type {Map<string, Function>} annotatie-type → provider */
const providers = new Map();

/**
 * Meld een provider aan voor een annotatie-type.
 *
 * @param {string} type Annotatie-type ('stavenreeks', 'betonbalk', …).
 * @param {(annotation:object, opts:object) => Array} provider
 *        Levert entries: {
 *          id: string,            — stabiel per getal ('count', 'diameter', …)
 *          value: string|number,  — huidige waarde
 *          box: {cx, cy, w, h, angle}, — vak in app-coördinaten; angle in rad,
 *                                        rotatie om het middelpunt (cx, cy)
 *          fields?: string[],     — parametrische veld-sleutels (symbolen)
 *          prop?: string,         — updateAnnotProp-sleutel (stavenreeks e.d.)
 *        }
 */
export function registerEditableNumbers(type, provider) {
  if (typeof type === 'string' && typeof provider === 'function') {
    providers.set(type, provider);
  }
}

/** Is er voor dit type een provider aangemeld? */
export function hasEditableNumbers(annotation) {
  return !!annotation && providers.has(annotation.type);
}

/**
 * Alle bewerkbare getallen van een annotatie.
 * @param {object} annotation
 * @param {object} [opts] Doorgegeven aan de provider (measureText, pxPerMm, …).
 * @returns {Array} entries (leeg als er geen provider is of de provider faalt).
 */
export function getEditableNumbers(annotation, opts = {}) {
  const provider = annotation ? providers.get(annotation.type) : null;
  if (!provider) return [];
  try {
    const entries = provider(annotation, opts);
    return Array.isArray(entries) ? entries.filter(e => e && e.box) : [];
  } catch (_) {
    return [];
  }
}

/**
 * Ligt punt (x, y) binnen een — eventueel geroteerd — vak?
 * Het punt wordt naar het lokale frame van het vak teruggedraaid.
 */
export function pointInBox(box, x, y) {
  if (!box) return false;
  const dx = x - box.cx;
  const dy = y - box.cy;
  const a = -(Number(box.angle) || 0);
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= box.w / 2 && Math.abs(ly) <= box.h / 2;
}

/**
 * Hit-test: welk bewerkbaar getal ligt onder (x, y)?
 * @returns {object|null} De entry, of null.
 */
export function hitTestEditableNumber(annotation, x, y, opts = {}) {
  const entries = getEditableNumbers(annotation, opts);
  for (const entry of entries) {
    if (pointInBox(entry.box, x, y)) return entry;
  }
  return null;
}

/**
 * Moeten de getallen van deze annotatie blauw oplichten?
 * Alleen wanneer de annotatie de ENIGE selectie is, niet vergrendeld is en er
 * een provider voor bestaat — precies de situatie waarin een klik de inline
 * invoer opent.
 * @param {object} annotation
 * @param {Array} selectedAnnotations Huidige selectie (doc.selectedAnnotations).
 */
export function shouldHighlightNumbers(annotation, selectedAnnotations) {
  if (!annotation || annotation.locked) return false;
  if (!Array.isArray(selectedAnnotations) || selectedAnnotations.length !== 1) return false;
  if (selectedAnnotations[0] !== annotation) return false;
  return providers.has(annotation.type);
}

/** Alleen voor tests: registry leegmaken. */
export function _clearEditableNumberProviders() {
  providers.clear();
}
