// Writing an annotation's style into the per-type style preferences.
//
// Shared by "Set as Default Style" (core/preferences.js setAsDefaultStyle) and
// the Tool Chest (#311), which uses the same keys as a TEMPORARY overlay while
// one of its items is the active tool. Pure: no app imports besides the style
// table and the stroke helper, so it is node-testable.

import { getStyleMapping } from './stijl-mapping.js';
import { randkleurVoorVoorkeur } from '../annotations/fill-utils.js';

/**
 * Write the style of `annotation` into `prefs` (the per-type keys from
 * stijl-mapping.js). Returns false when the type has no style preferences.
 */
export function writeStylePrefs(annotation, prefs) {
  if (!annotation || !prefs) return false;
  const m = getStyleMapping(annotation.type);
  if (!m) return false;

  const p = m.prefix;

  // "Geen rand" blijft alleen staan voor soorten waarvan de omtrek weg kan;
  // voor de rest zou de voorkeur op 'none' een onzichtbare lijn geven (#433).
  if (m.stroke) prefs[p + m.stroke] = randkleurVoorVoorkeur(annotation) || prefs[p + m.stroke];
  if (m.color) prefs[p + m.color] = annotation.color || annotation.fillColor || prefs[p + m.color];
  if (m.fill) {
    prefs[p + m.fill] = annotation.fillColor || prefs[p + m.fill];
    if (m.fillNone) prefs[p + m.fillNone] = !annotation.fillColor || annotation.fillColor === 'transparent' || annotation.fillColor === 'none' || annotation.fillColor === null;
  }
  if (m.width) prefs[p + m.width] = annotation.lineWidth ?? prefs[p + m.width];
  if (m.borderStyle && annotation.borderStyle) prefs[p + m.borderStyle] = annotation.borderStyle;
  if (m.opacity && annotation.opacity !== undefined) prefs[p + m.opacity] = Math.round(annotation.opacity * 100);
  // Eigen vul-dekking (#685); zonder eigen waarde volgt de vulling de dekking.
  if (m.fillOpacity) {
    if (typeof annotation.fillOpacity === 'number') prefs[p + m.fillOpacity] = Math.round(annotation.fillOpacity * 100);
    else delete prefs[p + m.fillOpacity];
  }
  if (m.startHead && annotation.startHead) prefs[p + m.startHead] = annotation.startHead;
  if (m.endHead && annotation.endHead) prefs[p + m.endHead] = annotation.endHead;
  if (m.headSize && annotation.headSize) prefs[p + m.headSize] = annotation.headSize;
  if (m.fontSize && annotation.fontSize) prefs[p + m.fontSize] = annotation.fontSize;
  if (m.icon && annotation.icon) prefs[p + m.icon] = annotation.icon;
  if (m.overlayColor) prefs[p + m.overlayColor] = annotation.overlayColor || prefs[p + m.overlayColor];

  // Hatch properties
  if (m.hatch) {
    if (annotation.hatchPattern) prefs[p + 'HatchPattern'] = annotation.hatchPattern;
    if (annotation.hatchColor) prefs[p + 'HatchColor'] = annotation.hatchColor;
    if (annotation.hatchScale != null) prefs[p + 'HatchScale'] = annotation.hatchScale;
  }

  // Generic style-type preset id (see annotations/style-types.js) — '' = custom.
  prefs[p + 'StyleType'] = annotation.styleType || '';

  // Dimension measurement properties (use 'Dim' prefix to avoid clash with global measureScale object)
  if (m.dimension) {
    if (!m.noDimScale) {
      if (annotation.measureScale != null) prefs[p + 'DimScale'] = annotation.measureScale;
      if (annotation.measureUnit) prefs[p + 'DimUnit'] = annotation.measureUnit;
    }
    if (annotation.measurePrecision != null) prefs[p + 'DimPrecision'] = annotation.measurePrecision;
    // Dimension type preset (1.8/2.5/3.5/5.0 mm) — '' means custom.
    prefs[p + 'DimType'] = annotation.dimType || '';
    prefs[p + 'DimExtension'] = !!annotation.dimExtension;
  }

  // Zijdematen van een meetvlak (#536): aan of uit, standaard uit.
  if (m.edgeLengths) prefs[p + m.edgeLengths] = annotation.measureShowEdgeLengths === true;

  return true;
}
