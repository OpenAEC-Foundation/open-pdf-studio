// Join-schakelaar van een wand (#476): schrijven naar de annotatie en
// teruglezen.
//
// Een wand staat in de PDF als /Line met eigen OPS_-sleutels (dikte,
// materiaal). De join per uiteinde reist mee als één tekstsleutel
// OPS_NoJoin met 'start', 'end' of 'both'. Staat de join aan beide uiteinden
// aan (de standaard), dan komt er niets bij — oudere bestanden en andere
// lezers merken dus niets.

import { PDFName } from 'pdf-lib';
import { pdfTextString } from './pdf-text.js';

/** De waarde voor OPS_NoJoin, of null als beide uiteinden mogen joinen. */
export function noJoinWaarde(ann) {
  const s = ann?.noJoinStart === true, e = ann?.noJoinEnd === true;
  if (s && e) return 'both';
  if (s) return 'start';
  if (e) return 'end';
  return null;
}

/** Zet OPS_NoJoin op de annotatie (niets als beide uiteinden mogen joinen). */
export function schrijfWandJoinMeta(annotDict, ann) {
  const waarde = noJoinWaarde(ann);
  if (!waarde) return false;
  annotDict.set(PDFName.of('OPS_NoJoin'), pdfTextString(waarde));
  return true;
}

/** De join-velden voor het wandmodel, uit de gelezen OPS_-sleutels. */
export function wandJoinUitExtra(extra) {
  const w = extra?.opsNoJoin;
  const uit = {};
  if (w === 'start' || w === 'both') uit.noJoinStart = true;
  if (w === 'end' || w === 'both') uit.noJoinEnd = true;
  return uit;
}
