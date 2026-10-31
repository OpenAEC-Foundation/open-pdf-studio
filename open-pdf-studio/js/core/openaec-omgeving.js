// OpenAEC Linux (#863): de app als gewoon Linux-programma in de gestreamde
// SuperCloud-omgeving.
//
// De Rust-kant (src-tauri/src/openaec_omgeving.rs) zet via een init-script
// `window.__OPENAEC__ = { beheerd, werkmap, container, softwareRendering }`.
// Hier staat wat de frontend ermee doet:
//
//  - beheerde modus (`OPENAEC_BEHEERD=1`): geen updatecontrole, geen
//    updatemelding, geen download van een andere versie en geen automatische
//    release-notes bij de start. De SuperCloud ververst het image.
//  - werkmap (`OPENAEC_MAP`): open- en opslagdialogen starten daar, tenzij de
//    aanroeper zelf een map meegeeft (bv. de map van het laatste document).
//
// Elke functie neemt het globale object als optionele parameter, zodat de
// tests zonder WebView draaien.

/** Lintknoppen die in beheerde modus uit staan. */
export const BEHEERD_UIT = Object.freeze([
  'ribbon-check-updates',
  'ribbon-previous-version',
]);

/** De omgeving zoals Rust hem doorgaf; zonder init-script: niets bijzonders. */
export function openaecOmgeving(g = globalThis) {
  const o = g?.__OPENAEC__;
  const werkmap = typeof o?.werkmap === 'string' && o.werkmap.trim() ? o.werkmap : null;
  return {
    beheerd: o?.beheerd === true,
    werkmap,
    container: o?.container === true,
    softwareRendering: o?.softwareRendering === true,
  };
}

/** Beheert de SuperCloud deze installatie? */
export function isBeheerd(g = globalThis) {
  return openaecOmgeving(g).beheerd;
}

/** Staat deze knop uit omdat de installatie beheerd wordt? */
export function knopUitBeheerd(id, g = globalThis) {
  return !!id && BEHEERD_UIT.includes(id) && isBeheerd(g);
}

function heeftMap(pad) {
  return /[\\/]/.test(pad);
}

/**
 * Opties voor dialog.open/save met de werkmap als startpunt.
 *  - geen defaultPath: de werkmap
 *  - alleen een bestandsnaam ("document.pdf"): die naam in de werkmap
 *  - een pad met map: ongewijzigd (de aanroeper koos bewust)
 * Zonder werkmap komt hetzelfde object terug.
 */
export function metWerkmap(opties, werkmap) {
  if (!werkmap) return opties;
  const o = { ...(opties || {}) };
  const pad = typeof o.defaultPath === 'string' ? o.defaultPath.trim() : '';
  if (!pad) {
    o.defaultPath = werkmap;
  } else if (!heeftMap(pad)) {
    o.defaultPath = `${werkmap.replace(/[\\/]+$/, '')}/${pad}`;
  }
  return o;
}

/**
 * Laat window.__TAURI__.dialog.open/save in de werkmap beginnen. Eén keer per
 * venster; zonder werkmap of zonder dialoog-plugin gebeurt er niets.
 * @returns {boolean} of de dialogen nu de werkmap gebruiken
 */
export function installeerWerkmapDialogen(g = globalThis) {
  const { werkmap } = openaecOmgeving(g);
  const dialoog = g?.__TAURI__?.dialog;
  if (!werkmap || !dialoog || dialoog.__openaecWerkmap) return false;
  for (const naam of ['open', 'save']) {
    const origineel = dialoog[naam];
    if (typeof origineel !== 'function') continue;
    dialoog[naam] = (opties) => origineel.call(dialoog, metWerkmap(opties, werkmap));
  }
  try {
    Object.defineProperty(dialoog, '__openaecWerkmap', { value: true });
  } catch { /* bevroren object: dan ook geen tweede keer inpakken mogelijk */ }
  return true;
}
