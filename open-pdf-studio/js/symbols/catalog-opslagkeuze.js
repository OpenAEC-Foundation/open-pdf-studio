// Opslagkeuze voor gedownloade symboolcatalogi — pure module, geen
// app-imports (#354).
//
// Twee opties bestaan naast elkaar:
// - INLINE in preferences.lineworkCatalogs (bestaand gedrag): klein spul,
//   en altijd buiten Tauri (daar is localStorage de enige opslag).
// - LOS BESTAND in <appdata>/OpenPDFStudio/catalogs/ met alleen een
//   verwijzing in de voorkeuren: grote catalogi, zodat preferences.json
//   klein blijft en het localStorage-quotum (~5 MB) buiten beeld blijft.

// Boven deze omvang (JSON-tekens) gaat een catalogus naar een eigen
// bestand. Ruim onder het localStorage-quotum, ruim boven een doorsnee
// kleine collectie.
export const CATALOGUS_BESTAND_DREMPEL = 256 * 1024;

/** Verwijzing die in de voorkeuren staat voor een catalogus-op-bestand. */
export function isCatalogusVerwijzing(v) {
  return !!v && typeof v === 'object' && v.extern === true;
}

/**
 * Kies de opslagvorm voor een catalogus.
 * @returns {'bestand'|'inline'}
 */
export function catalogusOpslagkeuze(jsonLengte, inTauri, drempel = CATALOGUS_BESTAND_DREMPEL) {
  if (!inTauri) return 'inline';
  return jsonLengte > drempel ? 'bestand' : 'inline';
}
