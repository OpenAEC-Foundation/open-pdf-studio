// Eén plek voor alles wat de app in de browseropslag bewaart (#547).
//
// In de OpenAEC-site delen alle gereedschappen één oorsprong (#544): wat het
// ene in localStorage zet, kan het andere lezen of overschrijven. Daarom:
//  - elke sleutel van deze app krijgt het voorvoegsel OPSLAG_PREFIX;
//  - alleen deze module raakt localStorage aan (opslag.test.mjs bewaakt dat).
//
// Sleutels van vóór het voorvoegsel verhuizen vanzelf: wie een naam leest die
// alleen nog zonder voorvoegsel bestaat, krijgt die waarde en vanaf dan staat
// hij onder de nieuwe sleutel. Schrijven en verwijderen ruimen de oude sleutel
// mee op. Als gast doen we dat geen van drieën: op een gedeelde oorsprong zijn
// sleutels zonder voorvoegsel van een ander.
//
// Lezen geeft nooit een fout; schrijven wel, net als localStorage.setItem,
// zodat een aanroeper een vol quotum ziet.
//
// Zonder bruikbare browseropslag (de werkplek, #704: een sandbox zonder
// allow-same-origin, waar al het opvragen van localStorage gooit) valt alles
// terug op een opslag in het geheugen: de app start en werkt gewoon, alleen
// blijft er na herladen niets over.

import { isGehost } from './gehost.js';

export const OPSLAG_PREFIX = 'opds:';

/** De echte sleutel in localStorage voor een naam van de app. */
export function opslagSleutel(naam) {
  return OPSLAG_PREFIX + naam;
}

const _geheugen = new Map();

/** De terugval: dezelfde vorm als localStorage, alleen in het geheugen. */
const geheugenOpslag = Object.freeze({
  getItem: (k) => (_geheugen.has(String(k)) ? _geheugen.get(String(k)) : null),
  setItem: (k, v) => { _geheugen.set(String(k), String(v)); },
  removeItem: (k) => { _geheugen.delete(String(k)); },
});

/** De echte localStorage als die bruikbaar is, anders de opslag in het geheugen. */
function opslag() {
  try {
    const s = globalThis.localStorage;
    if (s && typeof s.getItem === 'function') {
      s.getItem(OPSLAG_PREFIX); // geblokkeerde opslag gooit hier
      return s;
    }
  } catch {
    // bv. een sandbox-iframe: alleen al het opvragen gooit
  }
  return geheugenOpslag;
}

/**
 * Blijft wat de app bewaart na herladen staan? Nee in een omgeving zonder
 * bruikbare browseropslag: dan staat alles alleen in het geheugen. De
 * voorkeuren zeggen dat erbij (#1158).
 */
export function opslagIsBlijvend() {
  return opslag() !== geheugenOpslag;
}

/** @returns {string|null} */
export function leesOpslag(naam) {
  const s = opslag();
  try {
    const waarde = s.getItem(opslagSleutel(naam));
    if (waarde !== null || isGehost()) return waarde;
    const oud = s.getItem(naam);
    if (oud !== null) {
      try {
        s.setItem(opslagSleutel(naam), oud);
        s.removeItem(naam);
      } catch { /* quotum vol: de volgende lezing probeert het opnieuw */ }
    }
    return oud;
  } catch {
    return null;
  }
}

export function schrijfOpslag(naam, waarde) {
  const s = opslag();
  s.setItem(opslagSleutel(naam), String(waarde));
  if (!isGehost()) {
    try { s.removeItem(naam); } catch { /* niets op te ruimen */ }
  }
}

export function verwijderOpslag(naam) {
  const s = opslag();
  try {
    s.removeItem(opslagSleutel(naam));
    if (!isGehost()) s.removeItem(naam);
  } catch { /* niets te verwijderen */ }
}

/** Geparste JSON, of `standaard` als er niets (bruikbaars) staat. */
export function leesOpslagJson(naam, standaard = null) {
  const waarde = leesOpslag(naam);
  if (waarde === null) return standaard;
  try {
    return JSON.parse(waarde);
  } catch {
    return standaard;
  }
}

export function schrijfOpslagJson(naam, waarde) {
  schrijfOpslag(naam, JSON.stringify(waarde));
}

/** Naam van de voorkeuren-spiegel (core/preferences.js). */
export const VOORKEUREN_NAAM = 'pdfEditorPreferences';

/**
 * Het thema-script dat vóór de app-boot draait, zodat het verkeerde thema
 * niet even flitst. Het is een gewoon script in de pagina — het kan niets
 * importeren — en scripts/oude-webview.mjs zet het in het eigen bestand
 * vóór de app-boot (geen inline script, #596). De tekst
 * staat hier, zodat ook deze ene lezer de sleutel uit dezelfde bron haalt.
 * 'system' volgt de media-query: die volgt in de webview ook het OS-thema
 * (de vensterwaarde van Tauri is een belofte en dus hier niet te lezen).
 */
export function themaVoorafScript() {
  const sleutel = JSON.stringify(opslagSleutel(VOORKEUREN_NAAM));
  return `try{var p=JSON.parse(localStorage.getItem(${sleutel})||'{}');`
    + 'if(p.theme){var t=p.theme;'
    + "if(t==='system'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}"
    + "document.documentElement.setAttribute('data-theme',t);}}catch(e){}";
}
