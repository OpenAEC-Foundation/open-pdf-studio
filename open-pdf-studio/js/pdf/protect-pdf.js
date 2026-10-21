// "Protect with password": a protected COPY of the open document, written with
// the PDF standard encryption (AES-256) by the Rust command protect_pdf_file.
// The open document itself is never changed.

import { getActiveDocument, state } from '../core/state.js';
import { saveFileDialog, invoke } from '../core/platform.js';
import i18next from '../i18n/config.js';
import { standaardDoelPad, doelIsGeopend } from './print-doel.js';
import { STANDAARD_RECHTEN, controleerWachtwoorden } from './protect-pdf-regels.js';

export const BEVEILIGD_ACHTERVOEGSEL = ' (protected)';

export { STANDAARD_RECHTEN, controleerWachtwoorden };

/**
 * Writes the protected copy. The document must be saved first: the copy is
 * made from the file on disk. Resolves to { ok, reden }.
 */
export async function maakBeveiligdeKopie({ gebruiker, eigenaar, rechten }) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return { ok: false, reden: 'geen-document' };

  if (doc.modified || doc.isUntitled || !doc.filePath) {
    const { showConfirm } = await import('../ui/chrome/confirm-dialog.js');
    const eerstOpslaan = await showConfirm({
      title: i18next.t('dialogs:protectPdf.title'),
      message: i18next.t('dialogs:protectPdf.saveFirst'),
    });
    if (!eerstOpslaan) return { ok: false, reden: 'afgebroken' };
    const { savePDF } = await import('./saver.js');
    if (!(await savePDF())) return { ok: false, reden: 'niet-opgeslagen' };
  }
  if (!doc.filePath || doc.isUntitled) return { ok: false, reden: 'niet-opgeslagen' };

  const doel = await saveFileDialog(standaardDoelPad(doc, null, BEVEILIGD_ACHTERVOEGSEL), [
    { name: 'PDF', extensions: ['pdf'] },
  ]);
  if (!doel) return { ok: false, reden: 'afgebroken' };
  if (doelIsGeopend(doel, state.documents)) return { ok: false, reden: 'doel-is-geopend' };

  try {
    await invoke('protect_pdf_file', {
      bron: doc.filePath,
      doel,
      gebruikerswachtwoord: gebruiker || '',
      eigenaarwachtwoord: eigenaar || '',
      rechten: { ...STANDAARD_RECHTEN, ...rechten },
    });
  } catch (e) {
    return { ok: false, reden: 'mislukt', fout: String(e?.message ?? e) };
  }
  return { ok: true, pad: doel };
}
