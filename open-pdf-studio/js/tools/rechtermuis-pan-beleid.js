// Panning with the right mouse button, as a choice (#1241).
//
// By default the right button does what it always did: a click opens the
// context menu, finishes a polyline, and with Shift places the 2D cursor.
// With the preference `rightButtonDrag` set to 'pan', DRAGGING with the right
// button moves the sheet. A click without a drag keeps all its meanings: the
// press is never held back, the pan only starts once the pointer has really
// moved, and only then is the context menu that would follow swallowed.
//
// Pure: the decisions only. rechtermuis-pan.js connects them to the app.

/** The values of the preference; anything else counts as the default. */
export const RECHTERKNOP_KEUZES = Object.freeze(['menu', 'pan']);

/** How far the pointer must move before a press becomes a drag (CSS px). */
export const SLEEP_DREMPEL_PX = 6;

/** The preference as one of RECHTERKNOP_KEUZES. */
export function rechterknopKeuze(waarde) {
  return waarde === 'pan' ? 'pan' : 'menu';
}

/**
 * May this right-button press become a pan?
 * @param {object} p
 * @param {string} p.keuze            the preference
 * @param {number} p.button           MouseEvent.button
 * @param {boolean} [p.shiftKey]      Shift + right places the 2D cursor
 * @param {boolean} p.binnenWeergave  the target lies in the document view
 * @param {boolean} [p.inVergelijking] the compare view has its own handling
 * @param {boolean} [p.alPannen]      a pan is already running
 */
export function magRechtsPannen({ keuze, button, shiftKey = false, binnenWeergave, inVergelijking = false, alPannen = false }) {
  if (rechterknopKeuze(keuze) !== 'pan') return false;
  if (button !== 2 || shiftKey) return false;
  if (!binnenWeergave || inVergelijking || alPannen) return false;
  return true;
}

/** Has the pointer moved far enough from the press to be a drag? */
export function isSleep(start, x, y, drempel = SLEEP_DREMPEL_PX) {
  if (!start) return false;
  return Math.hypot(x - start.x, y - start.y) >= drempel;
}

/**
 * The handlers, with everything of the app passed in so they can be tested
 * without a page.
 * @param {object} d
 * @param {() => string} d.keuze            the preference, read at each press
 * @param {() => boolean} d.heeftDocument
 * @param {() => boolean} d.isPanning
 * @param {(e: any) => void} d.startPan     start the pan at this pointer position
 * @param {() => void} d.slikMenu           swallow the context menu that follows the drag
 * @param {() => void} [d.sluitMenu]        close a context menu that is open
 */
export function maakRechtermuisHandlers(d) {
  let start = null; // { x, y, pointerId }
  let gepand = false;

  const doelVan = (e) => (e && e.target && typeof e.target.closest === 'function' ? e.target : null);

  function onPointerDown(e) {
    start = null;
    gepand = false;
    const doel = doelVan(e);
    if (!magRechtsPannen({
      keuze: d.keuze(),
      button: e.button,
      shiftKey: !!e.shiftKey,
      binnenWeergave: !!(doel && doel.closest('#pdf-container') && d.heeftDocument()),
      inVergelijking: !!(doel && doel.closest('.compare-view')),
      alPannen: !!d.isPanning(),
    })) return;
    // Only remembered: the press itself goes on to the tool as always.
    start = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  }

  function onPointerMove(e) {
    if (!start || gepand) return;
    // The right button is no longer down: the release was missed.
    if (typeof e.buttons === 'number' && (e.buttons & 2) === 0) { start = null; return; }
    if (!isSleep(start, e.clientX, e.clientY)) return;
    if (d.isPanning()) { start = null; return; }
    gepand = true;
    d.sluitMenu?.();
    d.slikMenu();
    // From the place of the press, so the sheet does not jump by the threshold.
    d.startPan({ clientX: start.x, clientY: start.y, pointerId: start.pointerId, preventDefault() {} });
  }

  /** @returns {boolean} whether this release ends a pan */
  function onPointerUp(e) {
    if (e.button !== 2) return false;
    const was = gepand;
    start = null;
    gepand = false;
    return was;
  }

  function onCancel() { start = null; gepand = false; }

  return { onPointerDown, onPointerMove, onPointerUp, onCancel };
}
