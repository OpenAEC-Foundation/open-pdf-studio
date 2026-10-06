import { cloneAnnotation } from './factory.js';
import { recordModify, recordDelete, recordBulkDelete } from '../core/undo-manager.js';
import { expandCorrectionGroups } from './corrections/model.js';

export function commitAnnotationMutation(annotation, mutate) {
  if (!annotation?.id || typeof mutate !== 'function') return false;
  const before = cloneAnnotation(annotation);
  mutate(annotation);
  annotation.modifiedAt = new Date().toISOString();
  recordModify(annotation.id, before, annotation);
  return true;
}

/**
 * Verwijdert annotaties uit het document met één ongedaan-stap. Een
 * vervanging (#508) gaat in haar geheel: de andere helft komt mee, zodat er
 * geen los invoegteken of losse doorhaling achterblijft. Eén annotatie blijft
 * een gewone verwijderstap, meer een bulkstap. Is een helft die niet gekozen
 * is vergrendeld, dan telt de hele vervanging als vergrendeld en gaat er niets.
 * @returns {object[]} de verwijderde annotaties
 */
export function deleteAnnotationsWithUndo(doc, selection) {
  if (!doc) return [];
  const weg = expandCorrectionGroups(doc.annotations, selection);
  const gekozen = new Set(selection || []);
  if (weg.some(a => a.locked && !gekozen.has(a))) return [];
  if (weg.length === 0) return [];
  if (weg.length === 1) recordDelete(weg[0], doc.annotations.indexOf(weg[0]));
  else recordBulkDelete(weg);
  const set = new Set(weg);
  doc.annotations = doc.annotations.filter(a => !set.has(a));
  return weg;
}
