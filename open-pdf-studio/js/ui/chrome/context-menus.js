import { state, getActiveDocument, isSelected } from '../../core/state.js';
import { setTool } from '../../tools/manager.js';
import { resolvePointerCoords } from '../../tools/tool-context.js';
import { recordAdd } from '../../core/undo-manager.js';
import {
  showAnnotationMenu, showMultiAnnotationMenu, showPageMenu,
  showTextSelectionMenu, hideMenu,
} from '../../bridge.js';

export function showContextMenu(e, annotation, vertex = null) {
  e.preventDefault();
  const _cmDoc = getActiveDocument();
  const _cmSel = _cmDoc ? _cmDoc.selectedAnnotations : [];
  const isMultiSelect = _cmSel.length > 1 && isSelected(annotation);
  if (isMultiSelect) {
    showMultiAnnotationMenu(e.clientX, e.clientY, _cmSel.length);
  } else {
    showAnnotationMenu(e.clientX, e.clientY, annotation, vertex);
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
    // Shift+right-click = 2D-cursor gesture (tool-dispatcher) — never a menu
    // and never a tool switch.
    if (e.shiftKey) {
      e.preventDefault();
      return;
    }
    const nonDrawTools = ['select', 'hand'];
    // Check if any multi-click tool is in progress
    const isMultiClickActive = state.isDrawingPolyline || state.isDrawingCloudPolyline ||
      state.isDrawingDimension || (state.measurePoints && state.measurePoints.length >= 1) ||
      state.addHoleTargetId;
    if (!nonDrawTools.includes(state.currentTool) && !state.isDrawing && !isMultiClickActive) {
      e.preventDefault();
      e.stopPropagation();
      setTool('hand');
    }
  }, true);

  // Gedelegeerd op document-niveau: de doorlopende weergave heeft per pagina
  // een eigen `.annotation-canvas` die pas na init bestaat — een listener op
  // alleen het enkelpagina-canvas betekent dat rechtsklikken op een annotatie
  // in de doorlopende weergave helemaal geen menu geeft.
  {
    document.addEventListener('contextmenu', (e) => {
      const canvasEl = e.target instanceof Element
        ? e.target.closest('#annotation-canvas, .annotation-canvas')
        : null;
      if (!canvasEl) return;
      if (!getActiveDocument()?.pdfDoc) return;
      // Shift+right-click = 2D-cursor placement, no context menu.
      if (e.shiftKey) {
        e.preventDefault();
        return;
      }

      // Let tool handle its own right-click behavior (polyline finish, measurement finish, etc.)
      // These are handled via the pointerdown handler with e.button === 2
      const isMultiClickActive = state.isDrawingPolyline || state.isDrawingCloudPolyline ||
        state.isDrawingDimension || (state.measurePoints && state.measurePoints.length >= 1) ||
        state.addHoleTargetId;
      if (isMultiClickActive) {
        e.preventDefault();
        return;
      }
      // Tool just finished via right-click (polyline sluit-operatie). Slik
      // dit ene contextmenu-event in zodat de gebruiker niet onmiddellijk
      // het selectie-menu krijgt nadat hij de scheur/polygoon afsloot.
      // Volgende rechtermuisklik werkt weer normaal.
      if (state._suppressNextContextmenu) {
        state._suppressNextContextmenu = false;
        e.preventDefault();
        return;
      }

      // Zelfde scherm→app-mapping als alle tools (enkelpagina-viewport-
      // transform + doorlopende per-pagina-canvassen). De oude inline-formule
      // negeerde de viewport-offsets, waardoor de hit-test bij gepande/
      // gezoomde enkelpagina-weergave naast de annotatie prikte.
      const coords = resolvePointerCoords(e);
      const doc = getActiveDocument();
      const scale = doc?.scale || 1.5;
      if (doc?.viewMode === 'continuous' && coords.pageNum) {
        // findAnnotationAt filtert op doc.currentPage — zelfde afspraak als de
        // dubbelklik-dispatcher.
        doc.currentPage = coords.pageNum;
      }
      const x = coords.x;
      const y = coords.y;

      import('../../annotations/geometry.js').then(async ({ findAnnotationAt }) => {
        const annotation = findAnnotationAt(x, y);
        // In edit-contour mode, detect right-click on a vertex/edge handle so the
        // context menu can offer vertex-specific actions.
        let vertex = null;
        const editingId = state.editingContour;
        if (editingId) {
          const _doc2 = getActiveDocument();
          const editAnn = (_doc2?.annotations || []).find(a => a.id === editingId);
          if (editAnn) {
            const { findHandleAt } = await import('../../annotations/handles.js');
            const handleType = findHandleAt(x, y, editAnn, scale);
            if (typeof handleType === 'string') {
              const holeNode = handleType.match(/^polyline_node_hole_(\d+)_(\d+)$/);
              const polyNode = handleType.match(/^polyline_node_(\d+)$/);
              const holeEdge = handleType.match(/^polyline_edge_hole_(\d+)_(\d+)$/);
              const polyEdge = handleType.match(/^polyline_edge_(\d+)$/);
              if (holeNode) vertex = { kind: 'vertex', holeIndex: +holeNode[1], nodeIndex: +holeNode[2], annotationId: editingId };
              else if (polyNode) vertex = { kind: 'vertex', holeIndex: null, nodeIndex: +polyNode[1], annotationId: editingId };
              else if (holeEdge) vertex = { kind: 'edge', holeIndex: +holeEdge[1], edgeIndex: +holeEdge[2], annotationId: editingId };
              else if (polyEdge) vertex = { kind: 'edge', holeIndex: null, edgeIndex: +polyEdge[1], annotationId: editingId };
              if (vertex) {
                showContextMenu(e, editAnn, vertex);
                return;
              }
            }
          }
        }
        if (annotation) {
          showContextMenu(e, annotation);
        } else {
          showPageContextMenu(e);
        }
      });
    });
  }
}
