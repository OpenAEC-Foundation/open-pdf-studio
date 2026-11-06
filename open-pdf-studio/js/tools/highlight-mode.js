// Markeren heeft twee modi (#927), gedeeld door de ribbon en het
// gereedschapspalet: 'area' trekt een vak (het gereedschap 'highlight'),
// 'text' markeert de tekst waar je overheen sleept (het selectiegereedschap,
// dat paginatekst selecteert, met state.textHighlightMode aan; zie
// text/text-selection.js). De laatst gekozen modus blijft bewaard.

import { createSignal } from 'solid-js';
import { state } from '../core/state.js';
import { setTool } from './manager.js';
import { leesOpslag, schrijfOpslag } from '../core/opslag.js';
import { leesMarkeerModus, modusNaKlik } from '../text/tekst-markeren.js';

const OPSLAG = 'highlightMode';
const [highlightMode, zetModusSignaal] = createSignal(leesMarkeerModus(leesOpslag(OPSLAG)));

export { highlightMode };

/** Staat Markeren aan, in een van beide modi? */
export function highlightActive() {
  return state.currentTool === 'highlight'
    || (state.currentTool === 'select' && !!state.textHighlightMode);
}

/** Kies een modus en zet zijn gereedschap aan. */
export function kiesMarkering(modus) {
  const m = leesMarkeerModus(modus);
  zetModusSignaal(m);
  try { schrijfOpslag(OPSLAG, m); } catch { /* alleen deze sessie */ }
  if (m === 'text') {
    // setTool zet de tekstmodus uit; daarna pas aanzetten.
    setTool('select');
    state.textHighlightMode = true;
  } else {
    setTool('highlight');
  }
}

/** De knop Markeren: zet de laatste modus aan, of wisselt als hij al aan staat. */
export function markeringKnop() {
  kiesMarkering(modusNaKlik(highlightActive(), highlightMode()));
}
