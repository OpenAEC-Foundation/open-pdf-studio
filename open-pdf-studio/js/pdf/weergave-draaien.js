// Weergave draaien (#200): de knoppen "Weergave linksom/rechtsom draaien".
//
// Draait alleen hoe de pagina's van het actieve tabblad op het scherm staan.
// Het document verandert niet: niets wordt als gewijzigd gemarkeerd, er komt
// geen stap in ongedaan maken en opslaan, afdrukken, exporteren en de
// miniaturen gebruiken alleen de eigen paginarotaties (getPageRotation).
// Pagina's echt draaien (een documentbewerking) staat op het tabblad
// Bewerken & combineren, zie pagina-draaien.js.

import { normaliseerRotatie } from './weergave-rotatie.js';

/**
 * Venster-event nadat de weergave gedraaid is én het beeld in de nieuwe stand
 * staat. Wat zelf een schermpositie bijhoudt (zoals een open notitie-popup)
 * rekent die dan opnieuw uit; eerder klopt de geometrie van het beeld nog niet.
 */
export const WEERGAVE_GEDRAAID = 'opds:weergave-gedraaid';

async function appOmgeving() {
  const [st, renderer, viewportMod, rendering] = await Promise.all([
    import('../core/state.js'),
    import('./renderer.js'),
    import('./pdf-viewport.js'),
    import('../annotations/rendering.js'),
  ]);
  return {
    document: () => st.getActiveDocument(),
    // De viewport tekent een document met een pad zelf (PDFium); die draait
    // de pagina bij het tekenen en hoeft niets opnieuw te renderen.
    viewportToontDocument: (doc) => !!(viewportMod.viewport.active && doc.filePath
      && viewportMod.viewport.filePath === doc.filePath),
    draaiViewport: (rotatie) => {
      viewportMod.stelWeergaveRotatieIn(rotatie);
      rendering.redrawAnnotations(true);
    },
    tekenEnkelePagina: (pagina) => renderer.renderPage(pagina),
    tekenDoorlopend: () => renderer.tekenDoorlopendOpnieuw(),
    naWijziging: () => {
      import('../ui/chrome/status-bar.js').then((m) => m.updateAllStatus?.()).catch(() => {});
      window.dispatchEvent(new CustomEvent(WEERGAVE_GEDRAAID));
    },
  };
}

/**
 * Zet de weergaverotatie van het actieve document op `rotatie` en tekent het
 * beeld in de nieuwe stand.
 * @param {number} rotatie  graden; wordt 0/90/180/270
 * @param {object} [omgeving]  de app zelf; de tests geven een nagebootste
 * @returns {Promise<boolean>} of er iets veranderd is
 */
export async function zetWeergaveRotatie(rotatie, omgeving) {
  const o = omgeving || await appOmgeving();
  const doc = o.document();
  if (!doc?.pdfDoc) return false;
  const nieuw = normaliseerRotatie(rotatie);
  if (normaliseerRotatie(doc.viewRotation) === nieuw) return false;
  // Geen doc.modified, geen ongedaan-maakstap: alleen de weergave.
  doc.viewRotation = nieuw;
  if (doc.viewMode === 'continuous') {
    await o.tekenDoorlopend();
  } else if (o.viewportToontDocument(doc)) {
    o.draaiViewport(nieuw);
  } else {
    await o.tekenEnkelePagina(doc.currentPage || 1);
  }
  o.naWijziging();
  return true;
}

/**
 * Draai de weergave van het actieve document over `delta` graden (±90).
 * @returns {Promise<boolean>}
 */
export async function draaiWeergave(delta, omgeving) {
  const o = omgeving || await appOmgeving();
  const doc = o.document();
  if (!doc?.pdfDoc) return false;
  return zetWeergaveRotatie(normaliseerRotatie(doc.viewRotation) + delta, o);
}
