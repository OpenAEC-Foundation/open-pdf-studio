// OpenAEC Linux (#863): de app als gewoon Linux-programma in de gestreamde
// SuperCloud-omgeving.
//
// De Rust-kant (src-tauri/src/openaec_omgeving.rs) zet via een init-script
// `window.__OPENAEC__ = { werkmap }`. Hier staat wat de frontend ermee doet:
// open- en opslagdialogen starten in de werkmap (`OPENAEC_MAP`), tenzij de
// aanroeper zelf een map meegeeft (bv. de map van het laatste document).
//
// De beheerde modus (`OPENAEC_BEHEERD=1`) staat hier bewust niet: die heeft
// één schakelaar, core/beheerd.js (via het commando `managed_mode`).
//
// Elke functie neemt het globale object als optionele parameter, zodat de
// tests zonder WebView draaien.

/** De omgeving zoals Rust hem doorgaf; zonder init-script: niets bijzonders. */
export function openaecOmgeving(g = globalThis) {
  const o = g?.__OPENAEC__;
  const werkmap = typeof o?.werkmap === 'string' && o.werkmap.trim() ? o.werkmap : null;
  return { werkmap };
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
