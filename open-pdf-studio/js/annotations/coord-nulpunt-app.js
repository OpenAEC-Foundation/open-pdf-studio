// Het nulpunt van de coördinaatlabels in de app: zetten, wissen en het
// aanbod uit de onderlegger. De rekenkant staat in coord-nulpunt.js. Een ander
// nulpunt bouwt alle coördinaatlabels van het blad opnieuw op (zoals een andere
// schaal de maten herberekent), en alles samen is één ongedaan-stap. Nieuwe
// labels op dat blad gebruiken het nulpunt meteen.

import { getActiveDocument } from '../core/state.js';
import { cloneAnnotation } from './factory.js';
import { recalculateAllMeasurements } from './measurement.js';
import { isSpotCoord } from './spot-coord.js';
import {
  recordBulkModify, recordCoordOrigins, beginUndoTransaction, endUndoTransaction,
} from '../core/undo-manager.js';
import {
  normaliseerNulpunt, nulpuntLinksonder, nulpuntUitOnderlegger, paginaNulpunt,
} from './coord-nulpunt.js';
import { paginaMaat } from '../pdf/weergave-ruimte.js';

/**
 * Zet (of wis, bij null) het nulpunt van een blad en werk de coördinaatlabels
 * van dat blad bij.
 * @returns {number} hoeveel labels zijn bijgewerkt
 */
export function zetPaginaNulpunt(pageNum, nulpunt) {
  const doc = getActiveDocument();
  if (!doc) return 0;
  const nieuw = normaliseerNulpunt(nulpunt);
  const oud = doc.coordOrigins ? JSON.parse(JSON.stringify(doc.coordOrigins)) : null;
  const labels = doc.annotations.filter((a) => isSpotCoord(a) && (a.page || 1) === pageNum);
  const voor = labels.map((a) => cloneAnnotation(a));

  beginUndoTransaction();
  try {
    const kaart = { ...(doc.coordOrigins || {}) };
    if (nieuw) kaart[pageNum] = nieuw; else delete kaart[pageNum];
    doc.coordOrigins = Object.keys(kaart).length ? kaart : null;
    recordCoordOrigins(oud, doc.coordOrigins);
    recalculateAllMeasurements();
    if (labels.length) recordBulkModify(labels, voor);
  } finally {
    endUndoTransaction();
  }
  return labels.length;
}

/** Het nulpunt linksonder van het blad (CAD-gewijs, y omhoog). */
export function zetNulpuntLinksonder(pageNum) {
  const maat = paginaMaat(pageNum);
  const n = nulpuntLinksonder(maat?.hoogte);
  return n ? zetPaginaNulpunt(pageNum, n) : -1;
}

/** Het nulpunt van de onderlegger (modelmatrix), als die er is. */
export function onderleggerNulpunt(pageNum, doc = getActiveDocument()) {
  return nulpuntUitOnderlegger(doc?.pdfViewports?.[pageNum]);
}

/** Neem het nulpunt van de onderlegger over; -1 als die er niet is. */
export function neemNulpuntOverVanOnderlegger(pageNum) {
  const n = onderleggerNulpunt(pageNum);
  return n ? zetPaginaNulpunt(pageNum, n) : -1;
}

/** Het huidige nulpunt van het blad (of null). */
export function huidigNulpunt(pageNum, doc = getActiveDocument()) {
  return paginaNulpunt(doc, pageNum);
}
