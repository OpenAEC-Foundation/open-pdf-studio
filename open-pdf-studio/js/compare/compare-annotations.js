// Structurele annotatie-vergelijking voor de compare-modus.
//
// Vergelijkt de annotatie-lijsten van het OUD- en NIEUW-document (voor het
// huidige pagina-paar) en levert change-records op die compatibel zijn met de
// bestaande verschillenlijst: { type:'added'|'removed'|'modified', ... }.
//
// Dit is los van de pixel-diff van de PDF-inhoud: de app-annotaties zitten in
// een aparte overlay (doc.annotations), niet in het gerenderde PDF-raster, dus
// de pixel-diff ziet ze niet. Deze module vult dat gat.

import { state } from '../core/state.js';
import { getAnnotationBounds } from '../core/stores/selection-helpers.js';
import i18next from '../i18n/config.js';

// Twee annotaties "matchen" als ze hetzelfde type hebben én hun middelpunt
// binnen deze tolerantie ligt (in pagina-eenheden/punten). Ruim genoeg voor
// kleine herpositionering, krap genoeg om verschillende annotaties te scheiden.
const CENTER_TOL = 16;

function _annsForDoc(filePath, pageNum) {
  if (!filePath) return [];
  const doc = (state.documents || []).find(d => d && d.filePath === filePath);
  if (!doc || !Array.isArray(doc.annotations)) return [];
  // Annotaties zonder page-veld (page == null/undefined) tellen als pagina 1.
  return doc.annotations.filter(a => a && (a.page || 1) === (pageNum || 1) && a.type !== '__tool-defaults__');
}

function _centerAndBounds(ann) {
  const b = getAnnotationBounds(ann);
  if (!b) return null;
  return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, b };
}

// Vergelijkings-signatuur voor "gewijzigd": inhoud/kleur/lijndikte + globale maat.
function _sig(ann, b) {
  return [
    ann.text || ann.content || '',
    ann.color || ann.strokeColor || ann.fillColor || '',
    ann.lineWidth ?? ann.strokeWidth ?? ann.borderWidth ?? '',
    Math.round(b.width), Math.round(b.height),
    ann.rotation || 0,
  ].join('|');
}

function _label(ann) {
  const t = ann.type || 'annotation';
  const base = i18next.t(`compareAnnType.${t}`, { ns: 'ribbon', defaultValue: t });
  const txt = (ann.text || ann.content || '').trim();
  return txt ? `${base}: ${txt.slice(0, 30)}` : base;
}

function _rec(type, ann, b) {
  return {
    type,
    source: 'annotation',
    annType: ann.type,
    label: _label(ann),
    // Pagina-coördinaten (zelfde ruimte als de PDF-pagina op schaal 1). De UI
    // schaalt met visualScale, net als de inhouds-changes.
    x: b.x, y: b.y, width: b.width, height: b.height,
  };
}

/**
 * Vergelijk twee annotatie-lijsten (van hetzelfde pagina-paar).
 * @returns Array<change-record> met type added/removed/modified en source:'annotation'.
 */
export function diffAnnotationLists(oldAnns, newAnns) {
  const changes = [];
  const oldUsed = new Set();

  for (const na of (newAnns || [])) {
    const nc = _centerAndBounds(na);
    if (!nc) continue;
    let mi = -1, best = Infinity, mOld = null;
    for (let i = 0; i < oldAnns.length; i++) {
      if (oldUsed.has(i)) continue;
      const oa = oldAnns[i];
      if (oa.type !== na.type) continue;
      const oc = _centerAndBounds(oa);
      if (!oc) continue;
      const d = Math.hypot(nc.cx - oc.cx, nc.cy - oc.cy);
      if (d <= CENTER_TOL && d < best) { best = d; mi = i; mOld = oc; }
    }
    if (mi >= 0) {
      oldUsed.add(mi);
      if (_sig(oldAnns[mi], mOld.b) !== _sig(na, nc.b)) {
        changes.push(_rec('modified', na, nc.b));
      }
      // anders: ongewijzigd → geen record
    } else {
      changes.push(_rec('added', na, nc.b));
    }
  }
  for (let i = 0; i < oldAnns.length; i++) {
    if (oldUsed.has(i)) continue;
    const oc = _centerAndBounds(oldAnns[i]);
    if (!oc) continue;
    changes.push(_rec('removed', oldAnns[i], oc.b));
  }
  return changes;
}

/**
 * Bouw de annotatie-changes voor het huidige compare-pagina-paar.
 */
export function diffAnnotationsForPair(oldPath, oldPage, newPath, newPage) {
  const oldAnns = _annsForDoc(oldPath, oldPage);
  const newAnns = _annsForDoc(newPath, newPage);
  return diffAnnotationLists(oldAnns, newAnns);
}
