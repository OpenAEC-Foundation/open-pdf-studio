// De app-kant van gehoste deuren en ramen (#1229): het rekenwerk uit
// gehoste-opening.js op het geopende document, met de schaal van het blad.
// Laadt pas bij het eerste gebruik, via hosting-haak.js.

import { getActiveDocument } from '../core/state.js';
import { pxPerMmAt } from '../symbols/real-size.js';
import { hostingNaCommando, hostingLive, herstelHosting } from './gehoste-opening.js';

/** Paginapunten per werkelijke mm voor een wand: de schaal op haar beginpunt. */
export function pxPerMmVanWand(wand) {
  return pxPerMmAt(wand.page ?? 1, wand.startX, wand.startY);
}

const rond = (_k, v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);
function zelfde(a, b) {
  const tekst = (x) => JSON.stringify({ ...x, modifiedAt: undefined }, rond);
  return tekst(a) === tekst(b);
}

async function hertekenen() {
  try {
    const { redrawAnnotations, redrawContinuous } = await import('../annotations/rendering.js');
    if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
    else redrawAnnotations();
  } catch (e) {
    console.warn('[hosting] redraw failed:', e);
  }
}

function ruimSelectieOp(doc) {
  const selectie = doc.selectedAnnotations;
  if (!selectie || !selectie.length) return;
  const aanwezig = new Set(doc.annotations);
  const over = selectie.filter((a) => aanwezig.has(a));
  if (over.length === selectie.length) return;
  doc.selectedAnnotations = over;
  doc.selectedAnnotation = over[0] || null;
}

/**
 * Een stap die in de undo-geschiedenis komt (zie hostingBijCommando).
 * @returns {object|null|false} een samengestelde stap met de volgwijzigingen
 *   erbij, null als de stap zelf volstaat, of false als de stap door het
 *   terugzetten op de wand niets meer verandert en dus kan vervallen.
 */
export function naCommando(cmd, doc) {
  const voor = cmd.type === 'modifyAnnotation' ? JSON.stringify(cmd.newState) : null;
  const extra = hostingNaCommando(cmd, doc.annotations, pxPerMmVanWand);
  const eigenStapGewijzigd = voor !== null && voor !== JSON.stringify(cmd.newState);
  if (extra.some((c) => c.type === 'deleteAnnotation')) ruimSelectieOp(doc);
  if (extra.length || eigenStapGewijzigd) hertekenen();
  if (extra.length) return { type: 'compound', commands: [cmd, ...extra] };
  // Een kozijn dat alleen dwars op zijn wand is verschoven, staat terug waar
  // het stond: dat is geen stap.
  if (eigenStapGewijzigd && zelfde(cmd.oldState, cmd.newState)) return false;
  return null;
}

/** Tijdens het slepen of rekken van de selectie. */
export function tijdensSleep(doc) {
  return hostingLive(doc.selectedAnnotations || [], doc.annotations, pxPerMmVanWand);
}

/** De koppelingen van het actieve document nalopen (zonder geschiedenis). */
export function herstelActiefDocument() {
  const doc = getActiveDocument();
  if (!doc?.annotations) return false;
  const iets = herstelHosting(doc.annotations, pxPerMmVanWand);
  if (iets) hertekenen();
  return iets;
}
