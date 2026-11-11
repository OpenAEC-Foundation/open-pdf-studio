// Vangnet voor een pan die zijn loslaten mist (#1013).
//
// Een pan (hand-gereedschap links slepen, of de middelknop) begint op
// pointerdown en eindigt op pointerup. Gaat de focus tijdens het slepen naar
// een ander venster, dan levert de webview die pointerup soms niet meer af.
// De pan bleef dan "aan" staan (state.isPanning, de document-luisteraars van
// pan-handler.js, _isPanning in pdf-viewport.js) tot de volgende
// gereedschapswissel. Dit vangnet breekt de pan af zodra duidelijk is dat de
// knop niet meer ingedrukt is: bij focusverlies van het venster, als de
// pagina verborgen raakt, en bij een beweging zonder ingedrukte knop.
//
// Het gereedschap zelf blijft staan; alleen de tijdelijke sleepstatus gaat weg.

const LINKS = 1;
const MIDDEN = 4;

/**
 * Is er bij deze beweging geen pan-knop (links of midden) meer ingedrukt?
 * Een event zonder `buttons` (oude of synthetische events) telt niet als
 * losgelaten: liever een pan te veel dan een die halverwege afbreekt.
 * @param {{buttons?: number} | null | undefined} e
 */
export function geenPanKnopMeer(e) {
  if (!e || typeof e.buttons !== 'number') return false;
  return (e.buttons & (LINKS | MIDDEN)) === 0;
}

/**
 * Breek een lopende pan af bij focusverlies van het venster of als de pagina
 * verborgen raakt. Geeft een functie terug die de luisteraars weer weghaalt.
 *
 * @param {object} o
 * @param {EventTarget} o.win      window
 * @param {EventTarget & {visibilityState?: string}} o.doc  document
 * @param {() => void} o.breekAf  pan afbreken (idempotent)
 */
export function installeerPanVangnet({ win, doc, breekAf }) {
  const opBlur = () => breekAf();
  const opZichtbaarheid = () => {
    if (doc && doc.visibilityState === 'hidden') breekAf();
  };
  win?.addEventListener?.('blur', opBlur);
  doc?.addEventListener?.('visibilitychange', opZichtbaarheid);
  return () => {
    win?.removeEventListener?.('blur', opBlur);
    doc?.removeEventListener?.('visibilitychange', opZichtbaarheid);
  };
}
