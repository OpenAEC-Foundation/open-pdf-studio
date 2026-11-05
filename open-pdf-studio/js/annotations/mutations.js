import { cloneAnnotation } from './factory.js';
import {
  recordModify, recordDelete, recordBulkDelete, recordBulkModify,
  beginUndoTransaction, endUndoTransaction,
} from '../core/undo-manager.js';
import { expandCorrectionGroups } from './corrections/model.js';
import { hernummerTellingen, telGroepSleutel } from './telling.js';

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
  // Telmarkeringen (#935): de rest van hun groep telt opnieuw, in dezelfde stap.
  const telGroepen = weg.filter(a => a.type === 'count').map(telGroepSleutel);
  if (telGroepen.length > 0) beginUndoTransaction();
  try {
    if (weg.length === 1) recordDelete(weg[0], doc.annotations.indexOf(weg[0]));
    else recordBulkDelete(weg);
    const set = new Set(weg);
    doc.annotations = doc.annotations.filter(a => !set.has(a));
    if (telGroepen.length > 0) {
      const nieuw = hernummerTellingen(doc.annotations, telGroepen);
      if (nieuw.length > 0) {
        const voor = nieuw.map(w => cloneAnnotation(w.ann));
        for (const w of nieuw) w.ann.number = w.number;
        recordBulkModify(nieuw.map(w => w.ann), voor);
      }
    }
  } finally {
    if (telGroepen.length > 0) endUndoTransaction();
  }
  return weg;
}
