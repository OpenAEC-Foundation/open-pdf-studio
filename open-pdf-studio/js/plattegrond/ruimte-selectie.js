// Van ruimtetag naar ruimte en terug (#477). Een ruimte is met een klik niet
// te pakken (ruimte-koppeling.js); via haar tag wel: het contextmenu van de
// tag ("Ruimte selecteren") of Tab met een tag of ruimte geselecteerd.

import { getActiveDocument } from '../core/state.js';
import { showProperties } from '../ui/panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { isRuimteTag, isRuimteVlak, ruimteVanTag, tagsVanRuimte } from './ruimte-koppeling.js';

function selecteer(doc, ann) {
  doc.selectedAnnotations = [ann];
  doc.selectedAnnotation = ann;
  showProperties(ann);
  if (doc.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

/** Selecteer de ruimte van deze tag. Geeft true als dat lukte. */
export function selecteerRuimteVanTag(tag) {
  const doc = getActiveDocument();
  const ruimte = doc ? ruimteVanTag(tag, doc.annotations) : null;
  if (!ruimte) return false;
  selecteer(doc, ruimte);
  return true;
}

/**
 * Tab: is er precies een ruimtetag geselecteerd, dan gaat de selectie naar
 * zijn ruimte; is er een ruimte geselecteerd, dan naar haar (eerste) tag.
 * Geeft true als de toets gebruikt is.
 */
export function wisselTagEnRuimte() {
  const doc = getActiveDocument();
  const sel = doc?.selectedAnnotations || [];
  if (sel.length !== 1) return false;
  if (isRuimteTag(sel[0])) return selecteerRuimteVanTag(sel[0]);
  if (isRuimteVlak(sel[0])) {
    const tag = tagsVanRuimte(sel[0], doc.annotations)[0];
    if (!tag) return false;
    selecteer(doc, tag);
    return true;
  }
  return false;
}
