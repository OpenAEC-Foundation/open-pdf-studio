import { cloneAnnotation } from './factory.js';
import { recordModify } from '../core/undo-manager.js';

export function commitAnnotationMutation(annotation, mutate) {
  if (!annotation?.id || typeof mutate !== 'function') return false;
  const before = cloneAnnotation(annotation);
  mutate(annotation);
  annotation.modifiedAt = new Date().toISOString();
  recordModify(annotation.id, before, annotation);
  return true;
}
