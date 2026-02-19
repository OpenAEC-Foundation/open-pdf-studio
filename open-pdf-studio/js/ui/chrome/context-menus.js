import { state, isSelected } from '../../core/state.js';
import { annotationCanvas } from '../dom-elements.js';
import { setTool } from '../../tools/manager.js';
import { recordAdd } from '../../core/undo-manager.js';
import {
  showAnnotationMenu, showMultiAnnotationMenu, showPageMenu,
  showTextSelectionMenu, hideMenu
} from '../../solid/stores/contextMenuStore.js';

export function showContextMenu(e, annotation) {
  e.preventDefault();
  const isMultiSelect = state.selectedAnnotations.length > 1 && isSelected(annotation);
  if (isMultiSelect) {
    showMultiAnnotationMenu(e.clientX, e.clientY, state.selectedAnnotations.length);
  } else {
    showAnnotationMenu(e.clientX, e.clientY, annotation);
  }
}

export function showPageContextMenu(e) {
  e.preventDefault();
  showPageMenu(e.clientX, e.clientY);
}

export function showTextSelectionContextMenu(e) {
  e.preventDefault();
  showTextSelectionMenu(e.clientX, e.clientY);
}

export function hideContextMenu() {
  hideMenu();
}

export function initContextMenus() {
  document.addEventListener('contextmenu', (e) => {
    const nonDrawTools = ['select', 'hand'];
    if (!nonDrawTools.includes(state.currentTool) && !state.isDrawing && !state.isDrawingPolyline && !(state.measurePoints && state.measurePoints.length >= 1)) {
      e.preventDefault();
      e.stopPropagation();
      setTool('hand');
    }
  }, true);

  if (annotationCanvas) {
    annotationCanvas.addEventListener('contextmenu', (e) => {
      if (!state.pdfDoc) return;

      if ((state.currentTool === 'measureArea' || state.currentTool === 'measurePerimeter') && state.measurePoints && state.measurePoints.length >= 2) {
        e.preventDefault();
        import('../../annotations/factory.js').then(({ createAnnotation }) => {
          import('../../annotations/measurement.js').then(({ calculateArea, calculatePerimeter, formatMeasurement }) => {
            const points = [...state.measurePoints];
            let ann;
            const mPrefs = state.preferences;
            if (state.currentTool === 'measureArea' && points.length >= 3) {
              const area = calculateArea(points);
              ann = createAnnotation({
                type: 'measureArea',
                page: state.currentPage,
                points: points,
                color: mPrefs.measureStrokeColor,
                strokeColor: mPrefs.measureStrokeColor,
                lineWidth: mPrefs.measureLineWidth,
                opacity: (mPrefs.measureOpacity || 100) / 100,
                measureText: formatMeasurement(area),
                measureValue: area.value,
                measureUnit: area.unit
              });
            } else if (state.currentTool === 'measurePerimeter' && points.length >= 2) {
              const perim = calculatePerimeter(points);
              ann = createAnnotation({
                type: 'measurePerimeter',
                page: state.currentPage,
                points: points,
                color: mPrefs.measureStrokeColor,
                strokeColor: mPrefs.measureStrokeColor,
                lineWidth: mPrefs.measureLineWidth,
                opacity: (mPrefs.measureOpacity || 100) / 100,
                measureText: formatMeasurement(perim),
                measureValue: perim.value,
                measureUnit: perim.unit
              });
            }
            if (ann) {
              state.annotations.push(ann);
              recordAdd(ann);
            }
            state.measurePoints = null;
            import('../../annotations/rendering.js').then(({ redrawAnnotations }) => {
              redrawAnnotations();
            });
          });
        });
        return;
      }

      if (state.currentTool === 'polyline' && state.isDrawingPolyline) {
        e.preventDefault();
        import('../../annotations/factory.js').then(({ createAnnotation }) => {
          if (state.polylinePoints.length >= 2) {
            const pPrefs = state.preferences;
            const ann = createAnnotation({
              type: 'polyline',
              page: state.currentPage,
              points: [...state.polylinePoints],
              color: pPrefs.polylineStrokeColor,
              strokeColor: pPrefs.polylineStrokeColor,
              lineWidth: pPrefs.polylineLineWidth,
              opacity: (pPrefs.polylineOpacity || 100) / 100
            });
            state.annotations.push(ann);
            recordAdd(ann);
          }
          state.polylinePoints = [];
          state.isDrawingPolyline = false;
          import('../../annotations/rendering.js').then(({ redrawAnnotations }) => {
            redrawAnnotations();
          });
        });
        return;
      }

      const rect = annotationCanvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / state.scale;
      const y = (e.clientY - rect.top) / state.scale;

      import('../../annotations/geometry.js').then(({ findAnnotationAt }) => {
        const annotation = findAnnotationAt(x, y);
        if (annotation) {
          showContextMenu(e, annotation);
        } else {
          showPageContextMenu(e);
        }
      });
    });
  }
}
