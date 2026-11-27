import { getActiveDocument } from '../../core/state.js';
import { isPdfAReadOnly } from '../../pdf/loader.js';
import { normalizeContentView, DEFAULT_CONTENT_VIEW } from '../../pdf/content-view.js';
export const contentView = () => normalizeContentView(getActiveDocument()?.pdfContentView);
export const canEditContentView = () => !!getActiveDocument()?.pdfDoc && !isPdfAReadOnly();
function applyContentView(value) {
  if (!canEditContentView()) return;
  const doc = getActiveDocument();
  doc.pdfContentView = normalizeContentView(value);
  doc.modified = true;
  doc.savedUndoStackLength = -1;
  import('../../ui/chrome/tabs.js').then(m => m.markDocumentModified(doc));
}

export function setContentView(key, value) {
  if (Object.hasOwn(DEFAULT_CONTENT_VIEW, key)) applyContentView({ ...contentView(), [key]: value });
}
export function resetContentView() { applyContentView(DEFAULT_CONTENT_VIEW); }
