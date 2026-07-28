// Providers voor bewerkbare getallen — registreert per component-type WAAR de
// direct-bewerkbare getallen op het canvas staan.
//
// Pure geometrie (geen DOM/state): de posities komen uit dezelfde
// geometrie-modules als de rendering (buildStavenreeks, buildBetonbalk,
// template.editableLabels), zodat de blauwe markering en de klik-hit-test per
// definitie samenvallen met wat er getekend wordt.
//
// Importeren van deze module (side-effect) is genoeg om de providers aan te
// melden; annotations/rendering.js en tools/inline-number-editing.js doen dat.

import {
  registerEditableNumbers,
} from './editable-numbers.js';
import { buildStavenreeks, resolveParams } from './stavenreeks.js';
import { buildBetonbalk, resolveBetonbalkParams } from './betonbalk.js';
import { getTemplate } from '../symbols/registry.js';

/**
 * Stavenreeks: het AANTAL (parts[0]) en de DIAMETER (parts[2]) uit het label
 * "N ⌀ D". De vakken volgen de labelrotatie (schuine reeksen).
 */
registerEditableNumbers('stavenreeks', (annotation, opts = {}) => {
  const geom = buildStavenreeks(annotation, {
    measureText: opts.measureText,
    pxPerMm: opts.pxPerMm,
  });
  const lbl = geom.label;
  const params = resolveParams(annotation);
  const x0 = lbl.align === 'right' ? -lbl.width : 0;
  const cosA = Math.cos(lbl.angle);
  const sinA = Math.sin(lbl.angle);
  // Wat lucht rond het glyph-vak zodat de klik niet pixel-precies hoeft.
  const pad = lbl.fontSize * 0.25;
  const boxFor = (part) => {
    // Middelpunt van het tekstdeel in het lokale (geroteerde) labelframe,
    // baseline = middellijn (textBaseline 'middle' in de renderer).
    const lx = x0 + part.dx + part.w / 2;
    return {
      cx: lbl.x + cosA * lx,
      cy: lbl.y + sinA * lx,
      w: part.w + pad * 2,
      h: lbl.fontSize * 1.2 + pad,
      angle: lbl.angle,
    };
  };
  const textParts = lbl.parts.filter(p => p.kind === 'text');
  const entries = [];
  if (textParts[0]) {
    entries.push({
      id: 'count', prop: 'srCount', value: params.count, box: boxFor(textParts[0]),
    });
  }
  if (textParts[1]) {
    entries.push({
      id: 'diameter', prop: 'srDiameter', value: params.diameter, box: boxFor(textParts[1]),
    });
  }
  return entries;
});

/**
 * Betonbalk: de tag ("300x400" of eigen tekst) boven de hartlijn — alleen als
 * hij getoond wordt. De tag is gecentreerd getekend (textAlign 'center',
 * baseline 'alphabetic'), dus het vak ligt iets bóven het ankerpunt.
 */
registerEditableNumbers('betonbalk', (annotation, opts = {}) => {
  const geom = buildBetonbalk(annotation, {
    measureText: opts.measureText,
    others: opts.others,
    halfWidth: opts.halfWidth,
  });
  if (!geom || !geom.tag) return [];
  const t = geom.tag;
  const params = resolveBetonbalkParams(annotation);
  const pad = t.fontSize * 0.25;
  // Baseline 'alphabetic': het glyph-vak ligt grofweg [-0.8, +0.2] × fontSize
  // rond de baseline; middelpunt dus ~0.3 × fontSize erboven, LOODRECHT op de
  // tekstrichting (de tag is meegeroteerd).
  const up = t.fontSize * 0.3;
  return [{
    id: 'tag',
    prop: 'tagTekst',
    value: params.tagTekst,
    box: {
      cx: t.x + Math.sin(t.angle) * up,
      cy: t.y - Math.cos(t.angle) * up,
      w: t.width + pad * 2,
      h: t.fontSize * 1.2 + pad,
      angle: t.angle,
    },
  }];
});

/** Bevat een editable-label van een template minstens één GETAL-veld? */
export function labelHasNumericField(template, label) {
  const keys = new Set(label?.fields || []);
  return (template?.params || []).some(
    (p) => keys.has(p.key) && p.type === 'number',
  );
}

/**
 * Parametrische symbolen: alle editable labels met minstens één getal-veld.
 * De rects komen uit template.editableLabels (ongeroteerde app-coördinaten);
 * de annotatierotatie wordt hier om het bbox-middelpunt toegepast — dezelfde
 * conventie als symbols/editable-labels.js.
 */
registerEditableNumbers('parametricSymbol', (annotation) => {
  const template = getTemplate(annotation.symbolId);
  if (typeof template?.editableLabels !== 'function') return [];
  const labels = template.editableLabels(annotation.params || {}, annotation) || [];
  const angle = (Number(annotation.rotation) || 0) * Math.PI / 180;
  const cx0 = annotation.x + annotation.width / 2;
  const cy0 = annotation.y + annotation.height / 2;
  const entries = [];
  for (const label of labels) {
    if (!label?.rect || !labelHasNumericField(template, label)) continue;
    const r = label.rect;
    const mx = r.x + r.width / 2;
    const my = r.y + r.height / 2;
    const dx = mx - cx0;
    const dy = my - cy0;
    entries.push({
      id: label.id,
      fields: label.fields,
      value: null,
      box: {
        cx: cx0 + dx * Math.cos(angle) - dy * Math.sin(angle),
        cy: cy0 + dx * Math.sin(angle) + dy * Math.cos(angle),
        w: r.width,
        h: r.height,
        angle,
      },
    });
  }
  return entries;
});
