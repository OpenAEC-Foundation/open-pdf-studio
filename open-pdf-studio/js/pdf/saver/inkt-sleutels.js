// Eigen sleutels van drukgevoelige inkt (#385), heen en terug.
//
// /InkList houdt de middellijn (de standaard; andere lezers tekenen hem met
// de vaste breedte uit /BS). Wat de app nodig heeft om de streek na
// heropenen weer precies zo te tekenen en te bewerken, gaat in eigen
// sleutels mee (andere lezers negeren ze):
//   /OPS_InkPressure     de pendruk 0..1 per punt van de eerste /InkList
//   /OPS_InkMinWidth     breedte bij druk 0, in % van de lijndikte
//   /OPS_InkSmoothing    gladheid 0..100
//   /OPS_InkPressureOff  true: de druk staat uit (maar blijft bewaard)
//
// Alleen pdf-lib-waarden: ook in node te testen.

import { PDFName } from 'pdf-lib';
import { klemDruk, klemGladheid, klemMinBreedte } from '../../annotations/pressure-ink.js';

/** De sleutels voor het Ink-woordenboek (gewone JS-waarden voor context.obj). */
export function inktSleutels(ann) {
  const uit = {};
  if (!ann || !Array.isArray(ann.path)) return uit;
  const drukGeldig = Array.isArray(ann.pressures) && ann.pressures.length === ann.path.length
    && ann.pressures.length > 0;
  if (drukGeldig) {
    uit.OPS_InkPressure = ann.pressures.map((p) => Math.round(klemDruk(p) * 1000) / 1000);
    if (ann.inkMinWidth !== undefined) uit.OPS_InkMinWidth = klemMinBreedte(ann.inkMinWidth);
    if (ann.inkPressure === false) uit.OPS_InkPressureOff = true;
  }
  if (ann.inkSmoothing !== undefined && ann.inkSmoothing !== null) {
    uit.OPS_InkSmoothing = klemGladheid(ann.inkSmoothing);
  }
  return uit;
}

function getal(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v.asNumber === 'function') return v.asNumber();
  if (typeof v.numberValue === 'number') return v.numberValue;
  return null;
}

/**
 * Leest de sleutels uit een Ink-woordenboek (pdf-lib). Geeft alleen wat er
 * staat; de lader legt de druk pas aan het model als het aantal punten klopt.
 * @returns {{ inkPressures?: number[], inkMinWidth?: number, inkSmoothing?: number, inkPressureOff?: boolean }}
 */
export function leesInktSleutels(annotDict, context) {
  const uit = {};
  const zoek = (naam) => {
    const raw = annotDict.get(PDFName.of(naam));
    return raw === undefined ? undefined : (context.lookup(raw) || raw);
  };
  const druk = zoek('OPS_InkPressure');
  if (druk && typeof druk.asArray === 'function') {
    const reeks = druk.asArray().map((v) => getal(context.lookup(v) || v));
    if (reeks.length > 0 && reeks.every((v) => v !== null)) uit.inkPressures = reeks.map(klemDruk);
  }
  const min = getal(zoek('OPS_InkMinWidth'));
  if (min !== null) uit.inkMinWidth = klemMinBreedte(min);
  const glad = getal(zoek('OPS_InkSmoothing'));
  if (glad !== null) uit.inkSmoothing = klemGladheid(glad);
  const uitgezet = zoek('OPS_InkPressureOff');
  if (uitgezet === true || (uitgezet && (uitgezet.value === true || String(uitgezet) === 'true'))) uit.inkPressureOff = true;
  return uit;
}
