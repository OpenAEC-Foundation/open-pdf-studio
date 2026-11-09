// De NEN 1414-bibliotheek (102 symboolbeelden, de kleine als data-URL in de
// JS) is een eigen chunk (#454): hij hoort niet bij het opstarten. Het
// symbolenpalet start de lading na het tekenen van het venster
// (initSymbolPalette); tot dan zijn de NEN-groepen er nog niet, en een
// systeemraster met een NEN-symbool tekent zijn plaatshouder tot de
// hertekening na het laden (systeem-symbol-cache.js).
//
// De symbolen blijven precies dezelfde svg-tekst houden (de data-URL's
// staan erin): die tekst is de sleutel van bewerkte symbooltypen in de
// voorkeuren en staat in geplaatste stempels.

let _categorieen = null;
let _lading = null;
const _naLaden = new Set();

/** De NEN 1414-categorieën, of null zolang ze niet geladen zijn. */
export function nen1414Categorieen() {
  return _categorieen;
}

/** Laadt de bibliotheek (één keer); de belofte geeft de categorieën, of [] bij een fout. */
export function laadNen1414(laad = () => import('./nen1414Library.js')) {
  if (_categorieen) return Promise.resolve(_categorieen);
  if (_lading) return _lading;
  _lading = Promise.resolve()
    .then(laad)
    .then(({ NEN1414_CATEGORIES }) => {
      _categorieen = NEN1414_CATEGORIES;
      for (const fn of _naLaden) {
        try { fn(_categorieen); } catch (_) { /* luisteraar is optioneel */ }
      }
      return _categorieen;
    }, (fout) => {
      console.warn('[symbolen] NEN 1414-bibliotheek kon niet laden', fout);
      _lading = null;
      return [];
    });
  return _lading;
}

/** Laat `fn(categorieen)` lopen zodra de bibliotheek geladen is. */
export function bijNen1414Geladen(fn) {
  if (typeof fn === 'function') _naLaden.add(fn);
  return () => _naLaden.delete(fn);
}

/** Alleen voor tests. */
export function _vergeetNen1414() {
  _categorieen = null;
  _lading = null;
}
