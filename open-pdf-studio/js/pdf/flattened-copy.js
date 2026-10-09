// "Gevlakte kopie om te delen": een kopie waarin de annotaties (polygonen,
// maten, tekeningen) deel van de pagina zijn, zodat ze ook verschijnen in
// weergaven die annotaties overslaan (de PDF-weergave van een telefoon, een
// voorbeeld in een chat-app). Hergebruikt het doel "Opslaan als PDF" van de
// printdialoog: elke pagina op haar eigen formaat, tekst blijft tekst, de
// markeringen komen als beeld mee.

import { getActiveDocument, state } from '../core/state.js';
import { saveFileDialog } from '../core/platform.js';
import { standaardDoelPad, doelIsGeopend } from './print-doel.js';
import { slaPrintOpAlsPdf } from './print-job.js';

export const GEVLAKT_ACHTERVOEGSEL = ' (flattened)';

async function openOpgeslagen(pad) {
  try {
    const { createTab } = await import('../ui/chrome/tabs.js');
    const { loadPDFIfNeeded } = await import('./loader.js');
    const { index } = createTab(pad);
    await loadPDFIfNeeded(pad, index);
  } catch (e) {
    console.error('Could not open the flattened copy:', e);
  }
}

/**
 * Vraag waar de kopie heen moet en schrijf hem op de achtergrond weg.
 * @returns {Promise<{ok:boolean, reden?:'geen-document'|'doel-is-geopend'|'afgebroken'}>}
 */
export async function maakGevlakteKopie() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return { ok: false, reden: 'geen-document' };
  const pad = await saveFileDialog(standaardDoelPad(doc, null, GEVLAKT_ACHTERVOEGSEL), [
    { name: 'PDF', extensions: ['pdf'] },
  ]);
  if (!pad) return { ok: false, reden: 'afgebroken' };
  if (doelIsGeopend(pad, state.documents)) return { ok: false, reden: 'doel-is-geopend' };

  const pages = [];
  for (let i = 1; i <= doc.pdfDoc.numPages; i++) pages.push(i);
  // Niet wachten: de voortgangsbalk meldt het resultaat.
  slaPrintOpAlsPdf({
    pages,
    pad,
    orientatie: 'auto',
    vel: 'pagina',
    schaling: 'fit',
    zoom: 100,
    centreren: true,
    inhoud: 'doc-and-markups',
    openen: openOpgeslagen,
  });
  return { ok: true };
}
