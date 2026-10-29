// De achtergrondkleur rond en tussen de pagina's (#859).
//
// Voorkeur `pageBackgroundColor`: '' = standaard (wat de app altijd deed:
// lichtgrijs #e0e0e0 op het canvas van de enkele-paginaweergave en het tweede
// paneel, het thema rond doorlopende pagina's, donker in Vergelijken), of een
// eigen kleur '#rrggbb' die overal rond de pagina geldt.
//
// Alleen de weergave leest de kleur: het canvas van de viewport en het tweede
// paneel via achtergrondKleur(), de rest via de CSS-variabele --page-area-bg
// op <html>. De pagina zelf, afdrukken, exporteren, miniaturen en het
// opgeslagen bestand kennen hem niet.
//
// Geen imports: ook in node te testen.

export const STANDAARD_ACHTERGROND = '#e0e0e0';
export const CSS_VARIABELE = '--page-area-bg';
/** window-gebeurtenis na een andere kleur (het tweede paneel tekent dan opnieuw). */
export const ACHTERGROND_GEWIJZIGD = 'opds:pagina-achtergrond';

let _eigen = '';

/** '#rrggbb' in kleine letters, of '' (standaard) voor alles wat geen kleur is. */
export function normaliseerAchtergrond(waarde) {
  if (typeof waarde !== 'string') return '';
  const v = waarde.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const kort = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (kort) return `#${kort[1]}${kort[1]}${kort[2]}${kort[2]}${kort[3]}${kort[3]}`;
  return '';
}

/** De eigen kleur van de gebruiker, of '' als hij de standaard heeft. */
export function eigenAchtergrond() {
  return _eigen;
}

/** De kleur om rond de pagina op een canvas te vullen. */
export function achtergrondKleur() {
  return _eigen || STANDAARD_ACHTERGROND;
}

/**
 * Pas de kleur toe (bij het laden en opslaan van de voorkeuren, en als
 * voorbeeld terwijl de voorkeuren open staan). Geeft true als hij veranderde.
 */
export function zetPaginaAchtergrond(kleur, {
  root = globalThis.document?.documentElement ?? null,
  venster = typeof window !== 'undefined' ? window : null,
} = {}) {
  const nieuw = normaliseerAchtergrond(kleur);
  try {
    if (root?.style) {
      if (nieuw) root.style.setProperty(CSS_VARIABELE, nieuw);
      else root.style.removeProperty(CSS_VARIABELE);
    }
  } catch { /* geen DOM */ }
  if (nieuw === _eigen) return false;
  _eigen = nieuw;
  // De enkele-paginaweergave tekent het canvas opnieuw (de render-lus wordt
  // wakker van dirty); het tweede paneel luistert naar de gebeurtenis.
  if (venster?.__pdfViewport) venster.__pdfViewport.dirty = true;
  try {
    if (venster?.dispatchEvent && typeof CustomEvent !== 'undefined') venster.dispatchEvent(new CustomEvent(ACHTERGROND_GEWIJZIGD));
  } catch { /* geen DOM */ }
  return true;
}
