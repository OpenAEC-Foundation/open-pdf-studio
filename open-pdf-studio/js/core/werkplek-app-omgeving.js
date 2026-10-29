// De omgeving van `window.__OPDS_APP__` (core/werkplek-app.js): het actieve
// document, pdf.js voor de tekst, de navigatie en de annotatie-handlers van de
// MCP-brug. Die handlers draaien hier rechtstreeks in de browser; de
// MCP-server van de desktop-app (Tauri) is er niet voor nodig.
//
// Alleen in de gastmodus (core/gehost.js): main.js laadt deze module dan na de
// eerste render. De brug van de werkplek wacht tot `__OPDS_APP__` er is.

import { getActiveDocument } from './state.js';
import { isGehost } from './gehost.js';
import { maakWerkplekApp } from './werkplek-app.js';
import { paginaMaat } from '../pdf/weergave-ruimte.js';
import { runAppEvent } from '../mcp-bridge.js';

/** Het actieve document in de vorm die werkplek-app.js verwacht, of null. */
function actiefDocument() {
  const doc = getActiveDocument();
  const pdf = doc?.pdfDoc;
  if (!pdf) return null;
  return {
    sleutel: pdf,
    paginas: pdf.numPages,
    pagina: doc.currentPage || 1,
    bestandsnaam: doc.fileName ?? null,
    gewijzigd: Boolean(doc.modified),
    geselecteerd: (doc.selectedAnnotations || []).map((a) => a.id),
    paginamaat: (pagina) => paginaMaat(pagina, doc),
    annotaties: doc.annotations || [],
  };
}

async function tekstItems(pagina) {
  const pdf = getActiveDocument()?.pdfDoc;
  if (!pdf) throw new Error('er is geen PDF geopend');
  const page = await pdf.getPage(pagina);
  const inhoud = await page.getTextContent();
  return inhoud.items;
}

async function naarPagina(pagina) {
  const uit = await runAppEvent('mcp:go-to-page', { page: pagina });
  if (!uit?.ok) throw new Error(uit?.error || 'naar de pagina gaan mislukte');
}

/** Zet `window.__OPDS_APP__` neer (alleen als gast). Geeft het object, of null. */
export function installeerWerkplekApp(venster = window) {
  if (!isGehost()) return null;
  if (venster.__OPDS_APP__) return venster.__OPDS_APP__;
  const app = maakWerkplekApp({ document: actiefDocument, tekstItems, naarPagina, opdracht: runAppEvent });
  Object.defineProperty(venster, '__OPDS_APP__', { value: Object.freeze(app), configurable: false, enumerable: false, writable: false });
  try {
    venster.dispatchEvent(new Event('opds-app-klaar'));
  } catch { /* geen Event in deze omgeving */ }
  return app;
}
