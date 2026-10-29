// Gesplitste weergave (#715): het meldpunt tussen de bestaande viewer en de
// regelaar van de gesplitste weergave (split-view.js).
//
// Bewust zonder afhankelijkheden: renderer, tekenlaag, tabbladen en
// paginabeheer melden hier wat er gebeurde, zonder de regelaar (en daarmee
// zijn hele importboom) te hoeven laden. Zolang niemand luistert, kost een
// melding één Map-opzoeking; de gewone enkelvoudige weergave merkt er dus
// niets van.
//
// Gebeurtenissen:
//   'annotatiesHertekend'  de live weergave tekende zijn annotaties opnieuw
//   'weergaveGerenderd'    renderPage/renderContinuous is klaar
//   'actiefDocument'       een ander tabblad komt voor (vóór het renderen)
//   'documentGesloten'     een tabblad is gesloten (doc als gegeven)
//   'paginaStructuur'      pagina's ingevoegd/verwijderd/verplaatst
//                          ({ doc, pageMapping, numPages })
//   'spiegelKlik'          de gebruiker drukte in het tweede paneel

const _luisteraars = new Map();

/** Luister naar een gebeurtenis; geeft een functie terug die stopt. */
export function op(naam, fn) {
  let set = _luisteraars.get(naam);
  if (!set) { set = new Set(); _luisteraars.set(naam, set); }
  set.add(fn);
  return () => { set.delete(fn); };
}

/** Meld een gebeurtenis. Een falende luisteraar breekt de melder nooit. */
export function meld(naam, gegeven) {
  const set = _luisteraars.get(naam);
  if (!set || set.size === 0) return;
  for (const fn of [...set]) {
    try { fn(gegeven); } catch (e) { console.warn(`[split-view] luisteraar voor ${naam} faalde:`, e); }
  }
}

/** Luistert er iemand? (Voor tests en om werk te sparen.) */
export function heeftLuisteraars(naam) {
  return (_luisteraars.get(naam)?.size || 0) > 0;
}

// ── Klikken in het tweede paneel ─────────────────────────────────────────
// Het tweede paneel is een spiegel: alleen het actieve paneel heeft de echte
// viewer (#pdf-container met #pdf-canvas, #annotation-canvas, …) en dus de
// gereedschappen. Een klik in het tweede paneel maakt dat paneel actief en
// mag niet bij een gereedschap aankomen — veel daarvan luisteren in de
// capture-fase op window/document (middelmuis-pan, g-move, deselecteren bij
// een klik buiten het canvas). Deze luisteraar staat daarom zo vroeg mogelijk
// op window (dit bestand wordt bovenaan main.js geladen) en houdt de
// gebeurtenis daar tegen.
//
// Geen preventDefault op pointerdown/mousedown: de focus moet kunnen
// verspringen, zodat een open tekstbewerker zijn blur krijgt en de tekst
// vastlegt voordat het andere paneel actief wordt.

export const SPIEGEL_SELECTOR = '#split-pane';

/**
 * In welk deel van de gesplitste weergave ligt dit element?
 * 'spiegel' (het tweede paneel), 'scheiding' (de scheidingslijn), 'live'
 * (de echte viewer) of null (ergens anders).
 * @param {{closest?: (s: string) => any}|null} el
 */
export function paneelVoorDoel(el) {
  if (!el || typeof el.closest !== 'function') return null;
  if (el.closest(SPIEGEL_SELECTOR)) return 'spiegel';
  if (el.closest('#split-divider')) return 'scheiding';
  if (el.closest('#pdf-container')) return 'live';
  return null;
}

let _drukInSpiegel = false;

/**
 * Beslis wat er met een muis-/aanwijsgebeurtenis gebeurt. Puur, zodat de
 * routering te testen is. `drukInSpiegel`: begon de laatste druk (pointerdown/
 * mousedown) in het tweede paneel? Geeft { tegenhouden, activeren,
 * drukInSpiegel } met de nieuwe waarde van die vlag.
 */
export function routeerGebeurtenis(type, paneel, drukInSpiegel) {
  const inSpiegel = paneel === 'spiegel';
  if (type === 'pointerdown' || type === 'mousedown') {
    return { tegenhouden: inSpiegel, activeren: inSpiegel && type === 'pointerdown', drukInSpiegel: inSpiegel };
  }
  if (type === 'pointerup' || type === 'mouseup') {
    // Alleen tegenhouden wat in het tweede paneel begon: een sleep die in de
    // live viewer begon en boven het andere paneel wordt losgelaten, moet
    // gewoon eindigen.
    return { tegenhouden: drukInSpiegel, activeren: false, drukInSpiegel };
  }
  if (type === 'dblclick' || type === 'auxclick' || type === 'contextmenu') {
    return { tegenhouden: drukInSpiegel || inSpiegel, activeren: false, drukInSpiegel };
  }
  // 'click' gaat wel door: daar luisteren geen gereedschappen op het
  // document, wel de menu's en pop-ups die bij een klik ernaast sluiten.
  return { tegenhouden: false, activeren: false, drukInSpiegel };
}

function _opGebeurtenis(e) {
  const besluit = routeerGebeurtenis(e.type, paneelVoorDoel(e.target), _drukInSpiegel);
  _drukInSpiegel = besluit.drukInSpiegel;
  if (!besluit.tegenhouden) return;
  e.stopImmediatePropagation();
  if (e.type === 'contextmenu') e.preventDefault();
  if (besluit.activeren) meld('spiegelKlik', e);
}

if (typeof window !== 'undefined' && !window.__splitHakenGeinstalleerd) {
  window.__splitHakenGeinstalleerd = true;
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick', 'auxclick', 'contextmenu']) {
    window.addEventListener(type, _opGebeurtenis, { capture: true });
  }
}
