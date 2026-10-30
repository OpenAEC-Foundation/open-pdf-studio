import { getActiveDocument } from '../core/state.js';
import { isPdfAReadOnly } from '../pdf/loader.js';
import { isAnnotationPickableInView } from '../annotations/view-filters.js';
import { editAreaVertex } from '../annotations/area-vertices.js';
import { cloneAnnotation } from '../annotations/factory.js';
import { herberekenVlakMaat } from '../annotations/measurement.js';
import { recordModify } from '../core/undo-manager.js';

export function canEditAreaVertex(ann, hit) {
  const doc = getActiveDocument();
  return !!doc && !isPdfAReadOnly() && doc.annotations.includes(ann)
    && ann.page === doc.currentPage && isAnnotationPickableInView(ann)
    && !!editAreaVertex(ann, hit);
}

export function applyAreaVertexEdit(ann, hit, midpoint = false) {
  if (!canEditAreaVertex(ann, hit)) return false;
  const change = editAreaVertex(ann, hit, midpoint);
  if (!change) return false;
  const before = cloneAnnotation(ann);
  Object.assign(ann, change);
  herberekenVlakMaat(ann);
  ann.modifiedAt = new Date().toISOString();
  recordModify(ann.id, before, cloneAnnotation(ann));
  return true;
}
