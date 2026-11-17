// Save as IFCX: the IFCX export (ifcx-export.js, #876) offered where saving
// happens — the save button in the title bar and the File menu — next to
// File > Export. One starter for all three places.

/**
 * The menu label, built from the translated "Save As" so every language has
 * it: "Save As IFCX…".
 */
export function ifcxOpslaanLabel(opslaanAls) {
  const basis = String(opslaanAls || 'Save As').replace(/[\s.…]+$/u, '');
  return `${basis} IFCX…`;
}

/** What stands in the way of saving this document as IFCX, or null. */
export function ifcxOpslaanBezwaar(doc, { beveiligd = false } = {}) {
  if (!doc?.pdfDoc) return 'noDocumentOpen';
  // Protected (#378): its decrypted content is not copied out.
  if (beveiligd) return 'protectedPdfReadOnly';
  return null;
}

/** Open the IFCX options (pages, content); they lead to the save dialog. */
export async function opslaanAlsIfcx() {
  const [{ getActiveDocument }, dialogs, wachtwoord, i18n] = await Promise.all([
    import('../core/state.js'),
    import('../solid/stores/dialogStore.js'),
    import('./wachtwoord-pdf.js'),
    import('i18next'),
  ]);
  const doc = getActiveDocument();
  const bezwaar = ifcxOpslaanBezwaar(doc, { beveiligd: !!doc && wachtwoord.heeftBeveiligdeInhoud(doc) });
  if (bezwaar) {
    dialogs.showMessage((i18n.default || i18n).t(`common:${bezwaar}`));
    return false;
  }
  dialogs.openDialog('ifcx-export');
  return true;
}
