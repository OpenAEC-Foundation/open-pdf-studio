// Writing an annotation's style into the per-type style preferences.
//
// Shared by "Set as Default Style" (core/preferences.js setAsDefaultStyle) and
// the Tool Sets feature (#311), which uses the same keys as a TEMPORARY overlay while
// one of its items is the active tool. Pure: no app imports besides the style
// table and the stroke helper, so it is node-testable.

import { getStyleMapping } from './stijl-mapping.js';
import { randkleurVoorVoorkeur } from '../annotations/fill-utils.js';

/**
 * Write the style of `annotation` into `prefs` (the per-type keys from
 * stijl-mapping.js). Returns false when the type has no style preferences.
 * `touched` (a Set, optional) receives every key that was written or
 * removed, also when the new value equals the old one.
 */
export function writeStylePrefs(annotation, prefs, touched = null) {
  if (!annotation || !prefs) return false;
  const m = getStyleMapping(annotation.type);
  if (!m) return false;
  if (touched) prefs = recordKeys(prefs, touched);

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
  if (m.fontFamily && annotation.fontFamily && annotation.fontFamily !== 'mixed') prefs[p + m.fontFamily] = annotation.fontFamily;
  if (m.textColor && annotation.textColor && annotation.textColor !== 'mixed') prefs[p + m.textColor] = annotation.textColor;
  schrijfTekststijl(annotation, prefs, m);
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
  // Weergave-eenheid van de oppervlakte (#1129): '' volgt de schaal.
  if (m.areaUnit) prefs[p + m.areaUnit] = annotation.measureAreaUnit || '';

  // Vrije hand (#385): pendruk, minimale breedte en gladheid.
  if (m.ink) {
    prefs[p + 'Pressure'] = annotation.inkPressure !== false;
    if (annotation.inkMinWidth != null) prefs[p + 'PressureMinWidth'] = annotation.inkMinWidth;
    if (annotation.inkSmoothing != null) prefs[p + 'Smoothing'] = annotation.inkSmoothing;
  }

  return true;
}

const UITLIJNING = ['left', 'center', 'right'];
const VERTICAAL = ['top', 'middle', 'bottom'];
const TEKEN_VELDEN = ['fontBold', 'fontItalic', 'fontUnderline', 'fontStrikethrough'];

const isRegelafstand = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

// Teken- en alineastijl van een tekstvak of callout (#1150). De stijl is
// VOLLEDIG: een annotatie zonder het veld heeft de gewone waarde (niet vet,
// links, boven), en die wordt dan ook de standaard. Zonder eigen regelafstand
// vervalt de voorkeur en geldt de regelafstand van het tekenen. 'mixed' (een
// meervoudige selectie) is geen waarde en laat de voorkeur staan.
function schrijfTekststijl(annotation, prefs, m) {
  const p = m.prefix;
  for (const veld of TEKEN_VELDEN) {
    if (m[veld] && annotation[veld] !== 'mixed') prefs[p + m[veld]] = annotation[veld] === true;
  }
  if (m.textAlign && annotation.textAlign !== 'mixed') {
    prefs[p + m.textAlign] = UITLIJNING.includes(annotation.textAlign) ? annotation.textAlign : 'left';
  }
  if (m.textVAlign && annotation.textVAlign !== 'mixed') {
    prefs[p + m.textVAlign] = VERTICAAL.includes(annotation.textVAlign) ? annotation.textVAlign : 'top';
  }
  if (m.lineSpacing && annotation.lineSpacing !== 'mixed') {
    const regel = Number(annotation.lineSpacing);
    if (isRegelafstand(regel)) prefs[p + m.lineSpacing] = regel;
    else delete prefs[p + m.lineSpacing];
  }
}

/**
 * De teken- en alineastijl uit de stijlvoorkeuren, als velden voor een NIEUWE
 * annotatie van dit type (#1150). Alleen wat afwijkt van de gewone waarde
 * komt mee, zodat een vak zonder eigen stijl dezelfde velden houdt als
 * voorheen. Leeg voor een soort zonder tekststijl.
 */
export function tekststijlUitVoorkeur(prefs, type) {
  const m = getStyleMapping(type);
  const uit = {};
  if (!m || !prefs) return uit;
  const p = m.prefix;
  for (const veld of TEKEN_VELDEN) {
    if (m[veld] && prefs[p + m[veld]] === true) uit[veld] = true;
  }
  if (m.textAlign && UITLIJNING.includes(prefs[p + m.textAlign]) && prefs[p + m.textAlign] !== 'left') {
    uit.textAlign = prefs[p + m.textAlign];
  }
  if (m.textVAlign && VERTICAAL.includes(prefs[p + m.textVAlign]) && prefs[p + m.textVAlign] !== 'top') {
    uit.textVAlign = prefs[p + m.textVAlign];
  }
  if (m.lineSpacing && isRegelafstand(prefs[p + m.lineSpacing])) uit.lineSpacing = prefs[p + m.lineSpacing];
  return uit;
}

/**
 * De teken- en alineastijl uit de stijlvoorkeuren op een BESTAANDE annotatie
 * zetten ("Standaardstijl toepassen", en het paneel van een actief
 * gereedschap). Anders dan bij een nieuwe annotatie wordt ook de gewone
 * waarde gezet: een vet vak wordt weer gewoon als de standaard niet vet is.
 * Een voorkeur die ontbreekt, laat het veld met rust.
 */
export function pasTekststijlToe(annotation, prefs) {
  const m = getStyleMapping(annotation?.type);
  if (!m || !prefs) return;
  const p = m.prefix;
  const RUN_VELD = { fontBold: 'bold', fontItalic: 'italic' };
  for (const veld of TEKEN_VELDEN) {
    if (!m[veld] || typeof prefs[p + m[veld]] !== 'boolean') continue;
    const waarde = prefs[p + m[veld]];
    annotation[veld] = waarde;
    // Vlak-brede vet/cursief: ook de inline runs volgen (zoals het paneel).
    const run = RUN_VELD[veld];
    if (run && Array.isArray(annotation.textRuns)) {
      annotation.textRuns = annotation.textRuns.map(regel => (regel || []).map(r => ({ ...r, [run]: waarde })));
    }
  }
  if (m.textAlign && UITLIJNING.includes(prefs[p + m.textAlign])) annotation.textAlign = prefs[p + m.textAlign];
  if (m.textVAlign && VERTICAAL.includes(prefs[p + m.textVAlign])) {
    // 'top' is de gewone waarde en staat niet als veld op de annotatie.
    if (prefs[p + m.textVAlign] === 'top') delete annotation.textVAlign;
    else annotation.textVAlign = prefs[p + m.textVAlign];
  }
  if (m.lineSpacing && isRegelafstand(prefs[p + m.lineSpacing])) annotation.lineSpacing = prefs[p + m.lineSpacing];
}

// `prefs`, with every write and delete of a key noted in `touched`.
function recordKeys(prefs, touched) {
  return new Proxy(prefs, {
    set(target, key, value) {
      touched.add(key);
      target[key] = value;
      return true;
    },
    deleteProperty(target, key) {
      touched.add(key);
      delete target[key];
      return true;
    },
  });
}
