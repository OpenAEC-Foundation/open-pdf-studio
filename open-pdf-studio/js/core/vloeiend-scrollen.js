// Voorkeur "Vloeiend scrollen" (#1007) — kleine module zonder app-imports.
//
// Standaard UIT: een wielklik schuift de pagina meteen op en staat stil
// zodra het wiel stilstaat. Aan geeft het vroegere gedrag terug. De voorkeur
// regelt alle scroll-animatie die de app zelf in de hand heeft:
//  - de korte uitloop van een muiswielklik in alle weergaven (wiel-scroll.js,
//    via vloeiendScrollenAan() in pdf-viewport.js en navigation-events.js);
//  - sprongen naar een pagina, zoektreffer, opmerking of miniatuur
//    (scrollIntoView/scrollTo met behavior scrollGedrag());
//  - CSS scroll-behavior: uit = de klasse GEEN_VLOEIEND_SCROLLEN_KLASSE op
//    <html>, die styles.css op 'auto' vastzet;
//  - op Linux de WebKitGTK-instelling enable-smooth-scrolling (wiel, toetsen,
//    schuifbalk), via de Rust-opdracht zet_vloeiend_scrollen. Bij het
//    aanmaken van een venster leest Rust de opgeslagen voorkeur zelf
//    (linux_runtime.rs).
// Touchpad- en aanraakscrollen gaan zoals het besturingssysteem ze levert
// (inclusief diens doorglijden): de app voegt daar zelf geen traagheid aan toe.
// WebView2 (Windows) en WKWebView (macOS) hebben geen instelling hiervoor die
// tijdens het draaien te wijzigen is.

export const VLOEIEND_SCROLLEN_STANDAARD = false;
export const GEEN_VLOEIEND_SCROLLEN_KLASSE = 'geen-vloeiend-scrollen';
export const VLOEIEND_SCROLLEN_OPDRACHT = 'zet_vloeiend_scrollen';

let _aan = VLOEIEND_SCROLLEN_STANDAARD;

/** Staat vloeiend scrollen aan? */
export function vloeiendScrollenAan() {
  return _aan;
}

/** `behavior` voor scrollIntoView/scrollTo: 'smooth' alleen als de voorkeur aan staat. */
export function scrollGedrag() {
  return _aan ? 'smooth' : 'auto';
}

/**
 * Pas de voorkeur toe. Alleen `true` zet hem aan; al het andere (ook een
 * ontbrekende waarde) is uit.
 * @param {unknown} aan
 * @param {{ doc?: Document | null, roep?: ((cmd: string, args: object) => Promise<unknown>) | null }} [o]
 *        doc: het document voor de CSS-klasse; roep: Tauri-invoke (Linux-webview)
 * @returns {boolean} de toegepaste stand
 */
export function zetVloeiendScrollen(aan, { doc = globalThis.document ?? null, roep = null } = {}) {
  _aan = aan === true;
  doc?.documentElement?.classList?.toggle(GEEN_VLOEIEND_SCROLLEN_KLASSE, !_aan);
  if (roep) {
    try {
      Promise.resolve(roep(VLOEIEND_SCROLLEN_OPDRACHT, { aan: _aan })).catch(() => {});
    } catch {
      // Oudere backend of geen Tauri: alleen de JS-kant geldt.
    }
  }
  return _aan;
}
