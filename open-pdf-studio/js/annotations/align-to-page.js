import { getActiveDocument } from '../core/state.js';
import { recordBulkModify } from '../core/undo-manager.js';
import { cloneAnnotation } from './factory.js';
import { annotationBounds } from './spatial-index.js';
import { applyMoveGeneric } from './transforms.js';
import { correctionKind } from './corrections/model.js';
import { isAnnotationPickableInView } from './view-filters.js';
import { isAlleenLezen } from '../pdf/wachtwoord-pdf.js';
import { weergaveRotatie } from '../pdf/weergave-ruimte.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';
import { pageAlignmentMoves } from './page-alignment.js';

function selection(doc) {
  return doc.selectedAnnotations.length ? [...doc.selectedAnnotations] : doc.selectedAnnotation ? [doc.selectedAnnotation] : [];
}

export async function alignSelectionToPage(edge, individually = false) {
  const doc = getActiveDocument(), pdf = doc?.pdfDoc;
  if (!pdf || isAlleenLezen(doc)) return;
  const selected = selection(doc);
  // Keep a group intact: do not move only its unlocked/pickable members.
  if (!selected.length || selected.some(a => a.locked || correctionKind(a) !== null || !isAnnotationPickableInView(a))) return;
  const originals = selected.map(cloneAnnotation);
  const signature = JSON.stringify(originals);
  const viewRotation = weergaveRotatie(doc);
  const pageRotations = JSON.stringify(doc.pageRotations);
  const pages = [...new Set(selected.map(a => a.page))];
  let dimensions;
  try {
    dimensions = await Promise.all(pages.map(async number => {
      const page = await pdf.getPage(number);
      const unit = Number(page.userUnit) > 0 ? Number(page.userUnit) : 1;
      const viewport = page.getViewport({ scale: 1 / unit, rotation: page.rotate + (doc.pageRotations?.[number] || 0) });
      return { number, width: viewport.width, height: viewport.height };
    }));
  } catch { return; }
  // Loading dimensions must never redirect an edit to another tab/selection.
  if (getActiveDocument() !== doc || doc.pdfDoc !== pdf || isAlleenLezen(doc) ||
      weergaveRotatie(doc) !== viewRotation || JSON.stringify(doc.pageRotations) !== pageRotations ||
      selection(doc).length !== selected.length || selection(doc).some((a, i) => a !== selected[i]) ||
      selected.some(a => !doc.annotations.includes(a) || a.locked || !isAnnotationPickableInView(a)) ||
      JSON.stringify(selected.map(cloneAnnotation)) !== signature) return;
  const entries = selected.map(ann => ({ ann, bounds: annotationBounds(ann) }));
  if (entries.some(e => !e.bounds || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(e.bounds[k])))) return;
  const moves = dimensions.flatMap(({ number, width, height }) => pageAlignmentMoves(
    entries.filter(e => e.ann.page === number),
    width, height, viewRotation, edge, individually));
  if (!moves.length) return;
  for (const { ann, dx, dy } of moves) {
    applyMoveGeneric(ann, dx, dy);
    ann.modifiedAt = new Date().toISOString();
  }
  const moved = moves.map(m => m.ann);
  recordBulkModify(moved, moved.map(a => originals[selected.indexOf(a)]));
  if (doc.viewMode === 'continuous') redrawContinuous(); else redrawAnnotations();
}
