// Inline getalbewerking bij SELECTIE — de klik-laag van het generieke
// mechanisme uit annotations/editable-numbers.js.
//
// Werking: is een component (stavenreeks, betonbalk, parametrisch symbool)
// als enige geselecteerd, dan kleuren zijn bewerkbare getallen blauw
// (rendering.js) en opent één klik op zo'n getal direct de bijpassende
// inline invoer. De select-tool roept tryStartInlineNumberEdit() SYNCROON
// aan vóór hij een sleep start: raak = invoer openen en NIET slepen.
//
// De providers leveren de hit-vakken (zie editable-numbers-providers.js);
// dit bestand kiest per component alleen de juiste editor:
//  - stavenreeks      → bestaande StavenreeksInlineEditor (focus op het
//                       aangeklikte veld: aantal of diameter);
//  - parametricSymbol → bestaande ParametricLabelInlineEditor (rotatiebewust);
//  - betonbalk        → ParametricLabelInlineEditor met één synthetisch
//                       tekstveld voor de tag (zelfde undo-pad als het paneel).
import { getActiveDocument } from '../core/state.js';
import { paginaNaarClient } from '../pdf/weergave-ruimte.js';
import { hitTestEditableNumber } from '../annotations/editable-numbers.js';
// Side-effect: providers aanmelden (ook als rendering.js nog niet laadde).
import '../annotations/editable-numbers-providers.js';
import { stavenreeksPxPerMm } from '../annotations/stavenreeks-scale.js';
import { betonbalkBuildOpts } from '../annotations/betonbalk-scale.js';
import { buildBetonbalk, resolveBetonbalkParams } from '../annotations/betonbalk.js';
import { systeemrasterBuildOpts } from '../annotations/systeemraster-scale.js';
import { buildSysteemraster, resolveSysteemrasterParams } from '../annotations/systeemraster.js';
import { startStavenreeksInput } from './stavenreeks-editing.js';
import { startParametricSymbolInput } from './parametric-symbol-editing.js';
import {
  showParametricLabelInput, updateAnnotProp, storeShowProperties,
} from '../bridge.js';

/** Provider-opties per type (schaal/siblings voor de geometrie). */
function providerOpts(annotation) {
  if (annotation.type === 'stavenreeks') {
    return { pxPerMm: stavenreeksPxPerMm(annotation) };
  }
  if (annotation.type === 'betonbalk') {
    const doc = getActiveDocument();
    return betonbalkBuildOpts(annotation, doc ? (doc.annotations || []) : []);
  }
  if (annotation.type === 'systeemraster') {
    return systeemrasterBuildOpts(annotation);
  }
  return {};
}

/**
 * Ligt er op (x, y) een bewerkbaar getal van deze annotatie?
 * Puur en synchroon — geschikt om vóór het starten van een sleep te beslissen.
 */
export function hitInlineNumberAt(annotation, x, y) {
  if (!annotation || annotation.locked) return null;
  return hitTestEditableNumber(annotation, x, y, providerOpts(annotation));
}

// ── Betonbalk-tag: schermpositie + editor ─────────────────────────────────

// Schermpositie van een punt op de pagina van de annotatie, 10 px eronder:
// via de centrale omrekening (weergave-ruimte.js), dus in elke weergave en
// ook met een gedraaide weergave (#200).
function schermPosOnder(ann, x, y) {
  const doc = getActiveDocument();
  const p = paginaNaarClient(ann.page ?? doc?.currentPage ?? 1, x, y, doc);
  return p ? { left: p.x, top: p.y + 10 } : null;
}

function betonbalkTagScreenPos(ann) {
  const geom = buildBetonbalk(ann, providerOpts(ann));
  if (!geom || !geom.tag) return null;
  return schermPosOnder(ann, geom.tag.x, geom.tag.y);
}

function stillAlive(ann) {
  const doc = getActiveDocument();
  return Array.isArray(doc?.annotations) && doc.annotations.includes(ann);
}

function startBetonbalkTagInput(annotation) {
  const anchor = betonbalkTagScreenPos(annotation);
  if (!anchor) return false;
  const params = resolveBetonbalkParams(annotation);
  showParametricLabelInput({
    anchor,
    fields: [{ key: 'tagTekst', label: 'Tag', type: 'string' }],
    values: { tagTekst: params.tagTekst },
    locate: () => (stillAlive(annotation) ? betonbalkTagScreenPos(annotation) : null),
    commit: (values) => {
      if (!stillAlive(annotation) || annotation.locked) return;
      const next = String(values?.tagTekst ?? '');
      if (next === params.tagTekst) return;
      // Zelfde pad als het eigenschappen-paneel → één undo-stap en de
      // paneelvelden lopen automatisch mee.
      updateAnnotProp('tagTekst', next);
      storeShowProperties(annotation);
    },
    cancel: () => {},
  });
  return true;
}

// ── Systeemraster-plaatmaat: schermpositie + editor ───────────────────────

// Zelfde rekenwijze als betonbalkTagScreenPos hierboven.
function systeemrasterMaatScreenPos(ann) {
  const geom = buildSysteemraster(ann, providerOpts(ann));
  if (!geom || !geom.tag) return null;
  return schermPosOnder(ann, geom.tag.x, geom.tag.y);
}

function startSysteemrasterMaatInput(annotation) {
  const anchor = systeemrasterMaatScreenPos(annotation);
  if (!anchor) return false;
  const params = resolveSysteemrasterParams(annotation);
  showParametricLabelInput({
    anchor,
    fields: [
      { key: 'plaatBreedteMm', label: 'Breedte (mm)', type: 'number' },
      { key: 'plaatHoogteMm', label: 'Hoogte (mm)', type: 'number' },
    ],
    values: {
      plaatBreedteMm: params.plaatBreedteMm,
      plaatHoogteMm: params.plaatHoogteMm,
    },
    locate: () => (stillAlive(annotation) ? systeemrasterMaatScreenPos(annotation) : null),
    commit: (values) => {
      if (!stillAlive(annotation) || annotation.locked) return;
      // Zelfde pad als het eigenschappen-paneel → één undo-stap en de
      // paneelvelden lopen automatisch mee.
      if (values?.plaatBreedteMm != null) {
        updateAnnotProp('plaatBreedteMm', values.plaatBreedteMm);
      }
      if (values?.plaatHoogteMm != null) {
        updateAnnotProp('plaatHoogteMm', values.plaatHoogteMm);
      }
      storeShowProperties(annotation);
    },
    cancel: () => {},
  });
  return true;
}

/**
 * Klik op een bewerkbaar getal? Dan de bijpassende inline invoer openen.
 * @returns {boolean} true = afgehandeld (aanroeper mag géén sleep starten).
 */
export function tryStartInlineNumberEdit(annotation, x, y) {
  const entry = hitInlineNumberAt(annotation, x, y);
  if (!entry) return false;
  // De inline editors schrijven via updateAnnotProp op de annotatie die het
  // eigenschappen-paneel als 'huidige' kent — paneel dus eerst bijwerken.
  storeShowProperties(annotation);
  if (annotation.type === 'stavenreeks') {
    startStavenreeksInput(annotation, { focusField: entry.id });
    return true;
  }
  if (annotation.type === 'parametricSymbol') {
    startParametricSymbolInput(annotation, x, y);
    return true;
  }
  if (annotation.type === 'betonbalk') {
    return startBetonbalkTagInput(annotation);
  }
  if (annotation.type === 'systeemraster') {
    return startSysteemrasterMaatInput(annotation);
  }
  return false;
}
