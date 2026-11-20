// Welke Rust-route standaard aan staat, en de schakelaar om haar in de
// ontwikkelconsole om te zetten. Dit is de ene plek voor de standaard; de
// meting en de reden staan in docs/rust-stappen.md ("PNG insluiten in Rust,
// en wat de echte app verder liet zien").
//
// De regel: Rust alleen waar het in de echte app, met de echte oversteek
// tussen WebView en Rust erbij, ongeveer 1,3 keer sneller is én hetzelfde
// resultaat geeft. Anders is JavaScript de route.
//
//   route    standaard  schakelaar                 wat
//   png      aan        window.__opdsRustPng       PNG insluiten (embed-png-rust.js), binnen de gemeten grenzen
//
// Waarden van een schakelaar:
//   true      de route aan, met haar eigen grenzen per beeld
//   'altijd'  aan zonder de gemeten grenzen (alles wat de route kan), om te vergelijken
//   false     JavaScript
//   iets anders of niet gezet: de standaard hierboven
// De schakelaar wordt bij elke aanroep gelezen, dus omzetten werkt zonder
// herstart. Hij kan een route alleen aanzetten als de backend haar aanbiedt:
// OPDS_RUST_PNG_EMBED=0 in de omgeving van de app dwingt JavaScript af, wat
// de schakelaar ook zegt.

export const RUST_STANDAARD = Object.freeze({
  png: true,
});

export const RUST_SCHAKELAAR = Object.freeze({
  png: '__opdsRustPng',
});

/**
 * De keuze voor een route: de schakelaar als die gezet is, anders de standaard.
 * @param {'png'} naam
 * @returns {boolean|'altijd'}
 */
export function rustRoute(naam) {
  const waarde = globalThis[RUST_SCHAKELAAR[naam]];
  if (waarde === true || waarde === false || waarde === 'altijd') return waarde;
  return RUST_STANDAARD[naam] === true;
}
