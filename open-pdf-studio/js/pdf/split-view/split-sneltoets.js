// Sneltoetsen van de gesplitste weergave (#858).
//
//   Ctrl+\        Split Vertical    (nog eens: opheffen)
//   Ctrl+Shift+\  Split Horizontal  (nog eens: opheffen)
//   Unsplit, Make Active Pane Larger/Smaller: zonder standaardtoets, in
//   Voorkeuren > Sneltoetsen een toets te geven.
//
// De toets van de splitsing die er al staat, heft hem op; die van de andere
// richting wisselt de richting (elk paneel houdt zijn pagina en zoom, zie
// splitsWeergave). Groter/Kleiner verschuiven de scheidingslijn 5% voor het
// actieve paneel, binnen dezelfde grenzen als slepen.
//
// De backslash wordt op de fysieke toets herkend (code Backslash, op een
// ISO-toetsenbord ook IntlBackslash): met Shift typt hij '|', en op andere
// indelingen staat er een ander teken op.
//
// Puur: geen DOM, geen app-staat.

import { klemVerhouding } from './split-staat.js';

export const SPLIT_OPDRACHTEN = Object.freeze([
  'view.splitVertical', 'view.splitHorizontal', 'view.unsplit', 'view.splitPaneLarger', 'view.splitPaneSmaller',
]);

export const VERHOUDING_STAP = 0.05;

export function isSplitOpdracht(id) {
  return SPLIT_OPDRACHTEN.includes(id);
}

/**
 * De splitsopdracht van de standaardtoets in dit toetsenbordevent, of null.
 * @param {any} e  toetsenbordevent
 */
export function splitToetsOpdracht(e) {
  if (!e || !(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const backslash = e.code === 'Backslash' || e.code === 'IntlBackslash' || (!e.code && (e.key === '\\' || e.key === '|'));
  if (!backslash) return null;
  return e.shiftKey ? 'view.splitHorizontal' : 'view.splitVertical';
}

const rond = (v) => Math.round(v * 10000) / 10000;

/**
 * Wat een splitsopdracht doet bij de huidige splitsing (null = niet gesplitst):
 *   { soort: 'splitsen', richting }  splitsen of de richting wisselen
 *   { soort: 'opheffen' }
 *   { soort: 'verhouding', verhouding }  nieuwe verhouding van paneel 0
 *   null  niets te doen
 */
export function splitOpdrachtActie(id, staat) {
  if (id === 'view.splitVertical' || id === 'view.splitHorizontal') {
    const richting = id === 'view.splitVertical' ? 'vertical' : 'horizontal';
    if (staat && staat.richting === richting) return { soort: 'opheffen' };
    return { soort: 'splitsen', richting };
  }
  if (id === 'view.unsplit') return staat ? { soort: 'opheffen' } : null;
  if (id === 'view.splitPaneLarger' || id === 'view.splitPaneSmaller') {
    if (!staat) return null;
    const groter = id === 'view.splitPaneLarger';
    // De verhouding is die van paneel 0 (links/boven).
    const richting = (staat.actief === 1 ? -1 : 1) * (groter ? 1 : -1);
    const nu = klemVerhouding(staat.verhouding);
    const nieuw = rond(klemVerhouding(nu + richting * VERHOUDING_STAP));
    if (Math.abs(nieuw - nu) < 1e-9) return null;
    return { soort: 'verhouding', verhouding: nieuw };
  }
  return null;
}

/**
 * Mag een splitssneltoets hier niet? Tijdens het typen (tekstvak,
 * formulierveld, keuzelijst, contenteditable) en in een dialoog niet.
 * @param {any} doel  het doel van het toetsenbordevent
 * @param {{ modaalOpen?: boolean }} [opties]
 */
export function splitToetsGeblokkeerd(doel, { modaalOpen = false } = {}) {
  if (modaalOpen) return true;
  if (!doel) return false;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(doel.tagName)) return true;
  if (doel.isContentEditable) return true;
  return typeof doel.closest === 'function'
    && !!doel.closest('[contenteditable="true"], [role="dialog"], .modal-overlay, dialog');
}
