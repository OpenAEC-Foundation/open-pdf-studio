// De app-kant van het gevelelement: een bewerking op de annotatie toepassen
// als ÉÉN ongedaan-stap, en de onderdeelselectie (Tab, Delete, Escape).
// Gedeeld door het toetsenbord, de selectietool, het contextmenu en het
// eigenschappenpaneel, zodat ze allemaal precies hetzelfde doen.
//
// De rekenkunde staat in de pure modules ernaast (indeling.js,
// onderdelen.js, element.js); hier alleen document, undo en verversen.

import { state, getActiveDocument } from '../core/state.js';
import {
  recordModify, recordAdd, recordDelete, flushPropertyChange,
  beginUndoTransaction, endUndoTransaction,
} from '../core/undo-manager.js';
import { cloneAnnotation, createAnnotation } from '../annotations/factory.js';
import { pxPerMmAt } from '../symbols/real-size.js';
import { gevelPreset } from './herkenning.js';
import { preset } from './catalogus.js';
import { indeling, verwijderStijl, wisselPaneel } from './indeling.js';
import { volgendOnderdeel, geldigOnderdeel } from './onderdelen.js';
import { onderdeelOnderPunt, geometrieNaParams, elementLijn, ptPerMm } from './element.js';
import { zoekHostWand, plaatsInWand, wandSnedePlan } from './wand-hosting.js';

/** Eigenschappenpaneel en canvas bijwerken na een wijziging. */
export async function ververs(ann) {
  try {
    const [{ showProperties }, r] = await Promise.all([
      import('../ui/panels/properties-panel.js'),
      import('../annotations/rendering.js'),
    ]);
    const doc = getActiveDocument();
    if (ann && doc && (doc.selectedAnnotations || []).includes(ann)) showProperties(ann);
    if (doc?.viewMode === 'continuous') r.redrawContinuous();
    else r.redrawAnnotations();
  } catch (e) {
    console.warn('[gevelelement] verversen mislukt', e);
  }
}

/**
 * Pas een pure bewerking toe: `bewerk(params, presetId)` → { ok, params } of
 * { ok: false, error }. De lijn blijft liggen (het beginpunt vast), het vak
 * volgt de nieuwe indeling, en de hele wijziging is één stap op de
 * ongedaan-stapel. `opties.onderdeel` kiest het onderdeel dat daarna
 * geselecteerd is: een onderdeel, null (het geheel), een functie van het
 * resultaat, of undefined (het huidige, als dat nog bestaat).
 */
export function pasToe(ann, bewerk, opties = {}) {
  const presetId = gevelPreset(ann);
  if (!presetId) return { ok: false, error: 'not a facade element' };
  if (ann.locked) return { ok: false, error: 'the element is locked' };
  // Een lopende, nog niet vastgelegde paneelwijziging eerst afsluiten, zodat
  // die niet in deze stap opgaat.
  flushPropertyChange();
  const voor = cloneAnnotation(ann);
  const r = bewerk(ann.params || {}, presetId);
  if (!r?.ok) return r || { ok: false, error: 'edit failed' };
  // De schaal van het element zelf (getekende lengte / lengte in mm), zodat
  // een bewerking die de lengte niet raakt ook de eindpunten niet verschuift.
  let k = ptPerMm(voor, presetId);
  if (!(k > 0)) {
    const l = elementLijn(ann);
    k = pxPerMmAt(ann.page, (l.startX + l.endX) / 2, (l.startY + l.endY) / 2);
  }
  ann.params = r.params;
  geometrieNaParams(ann, presetId, k);
  const lay = indeling(ann.params, presetId);
  const gekozen = typeof opties.onderdeel === 'function' ? opties.onderdeel(r) : opties.onderdeel;
  ann.selectedSub = gekozen !== undefined
    ? geldigOnderdeel(lay, gekozen)
    : geldigOnderdeel(lay, ann.selectedSub);
  ann._hoverSub = null;
  ann.modifiedAt = new Date().toISOString();
  recordModify(ann.id, voor, cloneAnnotation(ann));
  ververs(ann);
  return r;
}

/** Selecteer een onderdeel (null = het geheel). Geen ongedaan-stap. */
export function zetOnderdeel(ann, sub) {
  const presetId = gevelPreset(ann);
  if (!presetId) return;
  ann.selectedSub = geldigOnderdeel(indeling(ann.params, presetId), sub);
  ann._hoverSub = null;
  ververs(ann);
}

/** De enige geselecteerde annotatie als die een gevelelement is. */
export function geselecteerdGevelelement() {
  const sel = getActiveDocument()?.selectedAnnotations || [];
  return sel.length === 1 && gevelPreset(sel[0]) ? sel[0] : null;
}

/**
 * Tab / Shift+Tab: loop door de onderdelen van het geselecteerde element, of
 * van het element onder de aanwijzer als er niets geselecteerd is. De eerste
 * Tab met de aanwijzer boven het element pakt het onderdeel eronder.
 * @returns {boolean} true als de toets is afgehandeld.
 */
export function tabDoorOnderdelen(richting = 1) {
  const doc = getActiveDocument();
  if (!doc) return false;
  const aanwijzer = state._gevelAanwijzer || null;
  let ann = geselecteerdGevelelement();
  if (!ann) {
    if ((doc.selectedAnnotations || []).length > 0) return false;
    const h = aanwijzer ? (doc.annotations || []).find((a) => a.id === aanwijzer.id) : null;
    if (!h || !gevelPreset(h) || (h.page ?? 1) !== (doc.currentPage || 1)) return false;
    ann = h;
    ann.selectedSub = null;
    doc.selectedAnnotations = [ann];
    doc.selectedAnnotation = ann;
  }
  const presetId = gevelPreset(ann);
  const lay = indeling(ann.params, presetId);
  const onder = aanwijzer && aanwijzer.id === ann.id
    ? onderdeelOnderPunt(ann, presetId, aanwijzer, aanwijzer.margePt || 0) : null;
  ann.selectedSub = volgendOnderdeel(lay, ann.selectedSub, richting, onder);
  ann._hoverSub = null;
  ververs(ann);
  return true;
}

/**
 * Delete op een geselecteerd onderdeel: een tussenstijl wordt verwijderd
 * (velden samengevoegd, daarna is het samengevoegde paneel geselecteerd),
 * een paneel krijgt het standaardpaneel terug. Het kader blijft staan; de
 * toets wordt dan wel afgevangen, zodat niet per ongeluk het hele element
 * verdwijnt.
 * @returns {boolean} true als de toets is afgehandeld.
 */
export function verwijderOnderdeel(ann) {
  const presetId = gevelPreset(ann);
  if (!presetId || !ann.selectedSub) return false;
  const lay = indeling(ann.params, presetId);
  const sub = geldigOnderdeel(lay, ann.selectedSub);
  if (!sub) { ann.selectedSub = null; return false; }
  if (sub.soort === 'stijl') {
    if (sub.index === 0 || sub.index === lay.stijlen.length - 1) return true;
    pasToe(ann, (p, id) => verwijderStijl(p, id, sub.index), { onderdeel: { soort: 'paneel', index: sub.index - 1 } });
    return true;
  }
  pasToe(ann, (p, id) => wisselPaneel(p, id, sub.index, preset(id).paneelType));
  return true;
}

/** Escape: van een onderdeel terug naar het geheel. */
export function naarGeheel(ann) {
  if (!gevelPreset(ann) || !ann.selectedSub) return false;
  ann.selectedSub = null;
  ann._hoverSub = null;
  ververs(ann);
  return true;
}

/**
 * Een los getekend element in de wand eronder zetten: de wand wordt over de
 * lengte van het element onderbroken (zie wand-hosting.js). Alles in één
 * ongedaan-stap.
 * @returns {{ ok, error? }}
 */
export function zetInWand(ann) {
  const presetId = gevelPreset(ann);
  if (!presetId) return { ok: false, error: 'not a facade element' };
  if (ann.locked) return { ok: false, error: 'the element is locked' };
  if (ann.params?.host) return { ok: false, error: 'already placed in a wall' };
  const doc = getActiveDocument();
  if (!doc) return { ok: false, error: 'no document' };
  const page = ann.page ?? 1;
  const l = elementLijn(ann);
  const k = pxPerMmAt(page, (l.startX + l.endX) / 2, (l.startY + l.endY) / 2);
  const wanden = (doc.annotations || [])
    .filter((a) => a?.type === 'wall' && (a.page ?? 1) === page && !a.locked)
    .map((a) => ({ id: a.id, startX: a.startX, startY: a.startY, endX: a.endX, endY: a.endY, dikteMm: a.dikteMm }));
  const host = zoekHostWand(l, wanden, k);
  if (!host) return { ok: false, error: 'no wall under the element' };
  const wandAnn = doc.annotations.find((a) => a.id === host.wand.id);
  const plek = plaatsInWand(host.wand, { vanMm: host.vanMm, lengteMm: host.lengteMm, offsetMm: host.offsetMm }, k);
  if (!plek.ok) return plek;
  const plan = wandSnedePlan(wandAnn, plek.stukken);
  flushPropertyChange();
  beginUndoTransaction();
  try {
    if (plan.wijzig) {
      const voor = cloneAnnotation(wandAnn);
      Object.assign(wandAnn, plan.wijzig.props, { modifiedAt: new Date().toISOString() });
      recordModify(wandAnn.id, voor, cloneAnnotation(wandAnn));
    }
    for (const props of plan.nieuw) {
      const nieuw = createAnnotation({ ...props, type: 'wall', page });
      doc.annotations.push(nieuw);
      recordAdd(nieuw);
    }
    if (plan.verwijder) {
      const i = doc.annotations.findIndex((a) => a.id === plan.verwijder);
      if (i >= 0) {
        const weg = doc.annotations[i];
        doc.annotations.splice(i, 1);
        recordDelete(weg, i);
      }
    }
    const voor = cloneAnnotation(ann);
    ann.params = { ...(ann.params || {}), host: plek.host };
    ann.modifiedAt = new Date().toISOString();
    recordModify(ann.id, voor, cloneAnnotation(ann));
  } finally {
    endUndoTransaction();
  }
  ververs(ann);
  return { ok: true, host: plek.host };
}
