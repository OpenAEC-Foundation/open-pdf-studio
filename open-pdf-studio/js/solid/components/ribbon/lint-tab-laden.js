// Luie linttabbladen (#454). Alleen Start staat bij het opstarten in de
// entry-chunk; de andere ingebouwde tabbladen zijn eigen chunks die na de
// start in een rustig moment laden, of eerder als iemand ze nodig heeft
// (het tabblad aanklikken, een sneltoets voor een knop erop, de MCP-brug).
//
// Geen Solid hier: Ribbon.jsx geeft de componenten (solid `lazy()`, met
// `.preload()`) mee, zodat de logica los te testen is.

// 'measure' is de oude naam van 'comment'.
const ALIAS = { measure: 'comment' };

let _lader = null;

/**
 * Een lader over `{ tab: component }`. Componenten zonder `preload` (niet
 * lui) en onbekende tabbladen (extensies) gelden als geladen.
 */
export function maakTabLader(componenten = {}) {
  const geladen = new Set();
  const bezig = new Map();
  const idVan = (tab) => ALIAS[tab] || tab;
  const lui = (id) => typeof componenten[id]?.preload === 'function';

  function isGeladen(tab) {
    const id = idVan(tab);
    return !lui(id) || geladen.has(id);
  }

  /** Laadt de chunk van het tabblad; true als hij er (nu) is. */
  function laad(tab) {
    const id = idVan(tab);
    if (isGeladen(id)) return Promise.resolve(true);
    if (bezig.has(id)) return bezig.get(id);
    const p = Promise.resolve()
      .then(() => componenten[id].preload())
      .then(() => { geladen.add(id); return true; }, (fout) => {
        console.warn(`[lint] tabblad ${id} kon niet laden`, fout);
        return false;
      })
      .finally(() => bezig.delete(id));
    bezig.set(id, p);
    return p;
  }

  /** Alle luie tabbladen na elkaar, zodat het voorladen het venster niet ophoudt. */
  async function laadAlles() {
    for (const id of Object.keys(componenten)) {
      if (lui(id)) await laad(id);
    }
  }

  return { laad, isGeladen, laadAlles };
}

/** Ribbon.jsx zet de lader van het lint; anderen (MCP-brug) laden via hier. */
export function zetTabLader(lader) { _lader = lader; }

/** Laad een linttabblad; zonder lint (nog niet getekend) gebeurt er niets. */
export function laadLintTab(tab) {
  return _lader ? _lader.laad(tab) : Promise.resolve(true);
}

/** Is de inhoud van het tabblad al geladen (dus synchroon te tekenen)? */
export function lintTabGeladen(tab) {
  return _lader ? _lader.isGeladen(tab) : true;
}

/**
 * Voer `fn` uit in een rustig moment na de start: requestIdleCallback met
 * een bovengrens, anders een time-out. Geeft een opruimfunctie terug.
 */
export function naDeStart(fn, { wacht = 1500, uiterlijk = 5000, omgeving = globalThis } = {}) {
  let rust = null;
  let klok = null;
  let weg = false;
  const draai = () => { if (!weg) { weg = true; fn(); } };
  klok = omgeving.setTimeout(() => {
    klok = null;
    if (typeof omgeving.requestIdleCallback === 'function') {
      rust = omgeving.requestIdleCallback(draai, { timeout: uiterlijk });
    } else {
      draai();
    }
  }, wacht);
  return () => {
    weg = true;
    if (klok != null) omgeving.clearTimeout(klok);
    if (rust != null && typeof omgeving.cancelIdleCallback === 'function') omgeving.cancelIdleCallback(rust);
  };
}
