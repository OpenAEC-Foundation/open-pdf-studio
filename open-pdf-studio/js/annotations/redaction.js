import { state, getActiveDocument } from '../core/state.js';
import { createAnnotation } from './factory.js';
import { redrawAnnotations } from './rendering.js';
import { recordAdd } from '../core/undo-manager.js';
import i18next from '../i18n/config.js';
import { showMessage } from '../bridge.js';

// Redacties toepassen legt een vergrendeld zwart vlak over het gemarkeerde
// gebied. De pagina-inhoud eronder (tekst, OCR-tekst, afbeeldingen, vectoren)
// wordt NIET verwijderd en blijft uit het opgeslagen bestand te halen (#762).
// De bevestiging mag daarom geen veilige, permanente verwijdering beloven.
async function bevestigRedactie(vraag) {
  const waarschuwing = i18next.t('applyRedactionsOverlayWarning', {
    defaultValue: 'Note: this only covers the marked areas. The text, images and graphics underneath are NOT removed from the PDF and can still be copied, searched or extracted. Do not rely on this to remove sensitive information.',
  });
  const msg = `${vraag}\n\n${waarschuwing}`;
  const titel = i18next.t('applyRedactionsTitle', { defaultValue: 'Apply Redactions' });
  if (window.__TAURI__?.dialog?.ask) {
    return !!(await window.__TAURI__.dialog.ask(msg, { title: titel, kind: 'warning' }));
  }
  return confirm(msg);
}

// Apply the redaction marks as locked black boxes (an overlay, see above)
export async function applyRedactions() {
  const doc = getActiveDocument();
  if (!doc) return;
  const curPage = doc.currentPage;
  const redactions = doc.annotations.filter(a => a.page === curPage && a.type === 'redaction');
  if (redactions.length === 0) {
    showMessage(i18next.t('noRedactionsOnPage'));
    return;
  }

  const count = redactions.length;
  const vraag = i18next.t('applyRedactionsPageConfirm', {
    count, page: curPage,
    defaultValue: 'Cover {{count}} redaction mark(s) on page {{page}} with a black box?',
  });
  if (!(await bevestigRedactie(vraag))) return;

  // Convert redaction marks to permanent black rectangles (type 'box' with black fill)
  for (const r of redactions) {
    const idx = doc.annotations.indexOf(r);
    if (idx !== -1) {
      doc.annotations.splice(idx, 1);
    }
    // Add a permanent black filled box in its place
    doc.annotations.push(createAnnotation({
      type: 'box',
      page: r.page,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      color: r.overlayColor || '#000000',
      strokeColor: r.overlayColor || '#000000',
      fillColor: r.overlayColor || '#000000',
      lineWidth: 0,
      opacity: 1,
      locked: true,
      redacted: true // Mark as applied redaction
    }));
  }

  redrawAnnotations();
}

// Apply all redactions across all pages
export async function applyAllRedactions() {
  const doc = getActiveDocument();
  if (!doc) return;
  const allRedactions = doc.annotations.filter(a => a.type === 'redaction');
  if (allRedactions.length === 0) {
    showMessage(i18next.t('noRedactionsInDocument'));
    return;
  }

  const count = allRedactions.length;
  const pages = [...new Set(allRedactions.map(a => a.page))].sort((a, b) => a - b);
  const vraag = i18next.t('applyRedactionsAllConfirm', {
    count, pages: pages.length,
    defaultValue: 'Cover {{count}} redaction mark(s) on {{pages}} page(s) with a black box?',
  });
  if (!(await bevestigRedactie(vraag))) return;

  for (const r of allRedactions) {
    const idx = doc.annotations.indexOf(r);
    if (idx !== -1) {
      doc.annotations.splice(idx, 1);
    }
    doc.annotations.push(createAnnotation({
      type: 'box',
      page: r.page,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      color: r.overlayColor || '#000000',
      strokeColor: r.overlayColor || '#000000',
      fillColor: r.overlayColor || '#000000',
      lineWidth: 0,
      opacity: 1,
      locked: true,
      redacted: true
    }));
  }

  redrawAnnotations();
}
