// Schaalcontrole in de app (#629): de rekenkant staat in schaalcontrole.js,
// hier komt het samen met het document. Een controle gaat in de geschiedenis
// van het blad en, als de gebruiker dat kiest, wordt de bron van de schaal
// bijgesteld (vervangen of gemiddeld). Eén ongedaan-stap voor alles.

import { state, getActiveDocument } from '../core/state.js';
import { cloneAnnotation } from './factory.js';
import { recalculateAllMeasurements, saveDocumentScale } from './measurement.js';
import { invalidateScaleRegionCache } from './scale-region.js';
import {
  recordBulkModify, recordMeasureScale, recordScaleChecks,
  beginUndoTransaction, endUndoTransaction,
} from '../core/undo-manager.js';
import {
  maakControle, voegControleToe, herkalibreer, schaalTekstVoorPpu, kanHerkalibreren,
  normaliseerDrempels,
} from './schaalcontrole.js';

const MEETSOORTEN = ['measureDistance', 'measureArea', 'measurePerimeter', 'measureAngle'];

/** De drempels uit de voorkeuren. */
export function drempelsUitVoorkeuren(prefs = state.preferences) {
  return normaliseerDrempels({ ok: prefs?.scaleCheckOkPercent, waarschuwing: prefs?.scaleCheckWarnPercent });
}

/**
 * Leg een controle vast en stel de schaal eventueel bij.
 * @param {object} invoer
 * @param {object} invoer.bron      schaalBronOpPunt-resultaat (of null zonder schaal)
 * @param {number} invoer.page
 * @param {{x:number,y:number}} invoer.p1
 * @param {{x:number,y:number}} invoer.p2
 * @param {number} invoer.punten    gemeten afstand in PDF-punten
 * @param {number} invoer.bekend    echte lengte in `eenheid`
 * @param {string} invoer.eenheid   de eenheid van de bron (of de gekozen eenheid zonder bron)
 * @param {'none'|'vervang'|'gemiddeld'} [invoer.actie]
 * @returns {object|null} de vastgelegde controle
 */
export function legControleVast({ bron, page, p1, p2, punten, bekend, eenheid, actie = 'none' }, doc = getActiveDocument()) {
  if (!doc) return null;
  const ppu = bron?.pixelsPerUnit > 0 ? bron.pixelsPerUnit : null;
  // Zonder schaal valt er niets na te meten: alleen "vervangen" kan, en dan
  // zet deze meting de documentschaal (de controle is daarna 0 %).
  if (!ppu && actie === 'none') return null;
  const effectieveActie = !ppu ? 'vervang' : (actie !== 'none' && kanHerkalibreren(bron) ? actie : 'none');
  const controle = maakControle({
    auteur: state.preferences?.authorName || '',
    bron: bron ? { ...bron, label: bronLabel(bron) } : null,
    p1, p2, punten, bekend, eenheid,
    // De afwijking tegen de schaal die gold toen er gemeten werd.
    pixelsPerUnit: ppu || (Number(punten) / Number(bekend)),
    drempels: drempelsUitVoorkeuren(),
    actie: effectieveActie,
  });
  if (!controle) return null;

  const oudeControles = doc.scaleChecks ? JSON.parse(JSON.stringify(doc.scaleChecks)) : doc.scaleChecks ?? null;
  const metingen = doc.annotations.filter((a) => MEETSOORTEN.includes(a.type));
  const origineel = metingen.map((a) => cloneAnnotation(a));

  beginUndoTransaction();
  try {
    doc.scaleChecks = voegControleToe(doc.scaleChecks || {}, page, controle);
    recordScaleChecks(oudeControles, doc.scaleChecks);

    if (effectieveActie !== 'none') {
      const nieuw = herkalibreer(ppu, punten, bekend, effectieveActie);
      if (nieuw > 0) {
        pasBronAan(doc, bron, nieuw, eenheid);
        invalidateScaleRegionCache();
        recalculateAllMeasurements();
        recordBulkModify(metingen, origineel);
      }
    }
  } finally {
    endUndoTransaction();
  }
  return controle;
}

function pasBronAan(doc, bron, ppu, eenheid) {
  const method = bron?.method;
  if (method === 'scaleRegion' || method === 'viewport') {
    const ann = doc.annotations.find((a) => a === bron.bron || a.id === bron.bron?.id);
    if (!ann) return;
    const voor = cloneAnnotation(ann);
    if (method === 'scaleRegion') {
      ann.scaleString = schaalTekstVoorPpu(ppu, ann.units || eenheid);
    } else {
      ann.pixelsPerUnit = ppu;
      ann.scaleRatio = schaalTekstVoorPpu(ppu, ann.unit || eenheid);
    }
    ann.modifiedAt = new Date().toISOString();
    recordBulkModify([ann], [voor]);
    return;
  }
  // Documentschaal (of nog geen schaal).
  const oud = doc.measureScale == null ? doc.measureScale : JSON.parse(JSON.stringify(doc.measureScale));
  doc.measureScale = {
    pixelsPerUnit: ppu,
    unit: eenheid || 'mm',
    method: 'scale-check',
    scaleRatio: schaalTekstVoorPpu(ppu, eenheid || 'mm') || 0,
  };
  recordMeasureScale(oud, doc.measureScale);
  saveDocumentScale(doc);
}

/** Een korte naam voor de bron: het label van het gebied, de naam van de viewport. */
export function bronLabel(bron) {
  const b = bron?.bron;
  if (!b) return '';
  if (bron.method === 'scaleRegion') return b.label || b.scaleString || '';
  if (bron.method === 'viewport') return b.name || b.scaleRatio || '';
  if (bron.method === 'pdfViewport') return b.name || b.ratio || '';
  if (bron.method === 'document') return typeof b.scaleRatio === 'string' ? b.scaleRatio : '';
  return '';
}
