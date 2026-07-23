import { getTemplate } from './registry.js';

export function toLocalPoint(annotation, x, y) {
  const angle = -(Number(annotation.rotation) || 0) * Math.PI / 180;
  const cx = annotation.x + annotation.width / 2;
  const cy = annotation.y + annotation.height / 2;
  const dx = x - cx;
  const dy = y - cy;
  return {
    x: cx + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: cy + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

export function findEditableLabel(annotation, x, y) {
  if (annotation?.type !== 'parametricSymbol') return null;
  const template = getTemplate(annotation.symbolId);
  if (typeof template?.editableLabels !== 'function') return null;
  const point = toLocalPoint(annotation, x, y);
  const labels = template.editableLabels(annotation.params || {}, annotation);
  return labels.find(({ rect }) =>
    point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height) || null;
}
