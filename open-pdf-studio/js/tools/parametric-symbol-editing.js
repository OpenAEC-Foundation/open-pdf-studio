import { getActiveDocument } from '../core/state.js';
import { annotationCanvas } from '../ui/dom-elements.js';
import { paginaNaarClient } from '../pdf/weergave-ruimte.js';
import { getTemplate } from '../symbols/registry.js';
import { findEditableLabel } from '../symbols/editable-labels.js';
import {
  showParametricLabelInput, hideParametricLabelInput,
  parametricLabelInputActive, updateAnnotProp, validateSymbolParams,
} from '../bridge.js';

let editingAnnotation = null;

function activeCanvas(annotation) {
  const documentState = getActiveDocument();
  if (documentState?.viewMode === 'continuous') {
    return document.querySelector(
      `.page-wrapper[data-page="${annotation.page || documentState.currentPage}"] .canvas-container-cont`,
    );
  }
  const annotationPage = annotation.page ?? documentState?.currentPage;
  if (annotationPage !== documentState?.currentPage) return null;
  return annotationCanvas || document.getElementById('annotation-canvas');
}

function rotatedLabelCenter(annotation, label) {
  const point = {
    x: label.rect.x + label.rect.width / 2,
    y: label.rect.y + label.rect.height / 2,
  };
  const angle = (Number(annotation.rotation) || 0) * Math.PI / 180;
  if (!angle) return point;
  const cx = annotation.x + annotation.width / 2;
  const cy = annotation.y + annotation.height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  return {
    x: cx + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: cy + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

function labelScreenPosition(annotation, label) {
  const canvas = activeCanvas(annotation);
  if (!canvas) return null;
  const documentState = getActiveDocument();
  const point = rotatedLabelCenter(annotation, label);
  // Centrale omrekening (pdf/weergave-ruimte.js): viewport, doorlopende
  // weergave en een gedraaide weergave (#200) in één.
  const opScherm = paginaNaarClient(annotation.page ?? documentState?.currentPage ?? 1, point.x, point.y, documentState);
  return opScherm ? { left: opScherm.x, top: opScherm.y } : null;
}

function stillAlive(annotation) {
  const documentState = getActiveDocument();
  return Array.isArray(documentState?.annotations)
    && documentState.annotations.includes(annotation);
}

export function startParametricSymbolInput(annotation, x, y) {
  if (!annotation || annotation.type !== 'parametricSymbol' || annotation.locked) return;
  const label = findEditableLabel(annotation, x, y);
  if (!label) return;
  const template = getTemplate(annotation.symbolId);
  const fieldKeys = new Set(label.fields);
  const fieldDefinitions = (template?.params || [])
    .filter((definition) => fieldKeys.has(definition.key));
  if (!fieldDefinitions.length) return;

  if (editingAnnotation || parametricLabelInputActive()) cancelParametricSymbolInput();
  const anchor = labelScreenPosition(annotation, label);
  if (!anchor) return;

  editingAnnotation = annotation;
  const values = Object.fromEntries(
    fieldDefinitions.map((definition) => [
      definition.key,
      annotation.params?.[definition.key] ?? definition.default ?? '',
    ]),
  );
  const locate = () => {
    if (!editingAnnotation || !stillAlive(editingAnnotation)) return null;
    return labelScreenPosition(editingAnnotation, label);
  };
  showParametricLabelInput({
    anchor,
    fields: fieldDefinitions,
    values,
    locate,
    returnFocusTarget: activeCanvas(annotation),
    commit: (inputValues) => {
      const current = editingAnnotation;
      if (!current || current.locked || locate() === null) {
        editingAnnotation = null;
        return;
      }
      editingAnnotation = null;
      const nextParams = {
        ...(current.params || {}),
        ...inputValues,
      };
      const validated = validateSymbolParams(annotation.symbolId, nextParams);
      updateAnnotProp('params', validated);
    },
    cancel: () => {
      editingAnnotation = null;
    },
  });
}

export function cancelParametricSymbolInput() {
  if (!editingAnnotation && !parametricLabelInputActive()) return;
  editingAnnotation = null;
  hideParametricLabelInput();
}

export function isParametricSymbolInputOpen() {
  return !!editingAnnotation && parametricLabelInputActive();
}
