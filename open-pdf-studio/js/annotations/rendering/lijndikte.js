// Lijndikte zoals een rendering hem tekent — puur, zonder app-state.
//
// Het scherm rekent een lijndikte om naar schermpixels: minstens één pixel
// bij uitzoomen (anders verdwijnt een dunne lijn in de anti-aliasing), een
// plafond tijdens slepen (anders wordt elk frame trager) en met de voorkeur
// "lijndikte niet tonen" altijd één pixel. Dat hoort bij het scherm alleen.
// Een afdruk, een export en een OPGESLAGEN appearance tekenen de echte
// lijndikte in paginapunten: die mogen niet afhangen van de zoomstand op het
// moment van opslaan. Een raam op 1:50 met een glaslijn van 0,35 pt kreeg
// anders bij 25 % zoom een lijn van 4 pt in de opgeslagen PDF.

/** Ondergrens voor een lijn die er moet zijn (paginapunten). */
export const MIN_LIJNDIKTE_PT = 0.25;

/** Plafond in schermpixels tijdens slepen, draaien en schalen. */
export const SLEEP_MAX_SCHERM_PX = 6;

/**
 * @param {number} breedte  lijndikte in paginapunten (0 = geen rand)
 * @param {{ scherm?: boolean, zoom?: number, dunneLijnen?: boolean, slepen?: boolean }} opties
 *   `scherm` false = afdruk, export of opgeslagen appearance: de echte dikte.
 * @returns {number} de te tekenen dikte in paginapunten
 */
export function weergaveLijndikte(breedte, opties = {}) {
  if (breedte === 0) return 0;
  const scherm = !!opties.scherm;
  const zoom = Number(opties.zoom) || 1;
  if (scherm && opties.dunneLijnen) return zoom > 0 ? 1 / zoom : 1;
  let lw = Math.max(breedte, MIN_LIJNDIKTE_PT);
  if (!scherm) return lw;
  if (zoom > 0 && zoom < 1) lw = Math.max(lw, 1 / zoom);
  if (zoom > 0 && opties.slepen) lw = Math.min(lw, SLEEP_MAX_SCHERM_PX / zoom);
  return lw;
}

/**
 * Lijndikte (paginapunten, vóór de weergaveregels) van één tekenopdracht van
 * een parametrisch symbool: een vaste `lineWidth`, of `lineWidthFactor` als
 * fractie van de lijndikte van het symbool.
 */
export function symboolOpdrachtLijndikte(opdracht, basis) {
  if (opdracht?.lineWidth != null) return opdracht.lineWidth;
  return opdracht?.lineWidthFactor > 0 ? basis * opdracht.lineWidthFactor : basis;
}
