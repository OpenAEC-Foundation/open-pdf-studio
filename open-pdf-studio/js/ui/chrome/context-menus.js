import { areaVertexHit } from '../../annotations/area-vertices.js';
import { state, getActiveDocument, isSelected } from '../../core/state.js';
import { setTool } from '../../tools/manager.js';
import { resolvePointerCoords, getEffectiveScale } from '../../tools/tool-context.js';
import { recordAdd } from '../../core/undo-manager.js';
import { isBewerkbareVeelhoek, veelhoekDeelBij } from '../../annotations/veelhoek-punten.js';
import { HANDLE_SIZE } from '../../core/constants.js';
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
    // Right-dragging pans a 3D model (#599): no tool switch there.
    if (e.target instanceof Element && e.target.closest('.threed-inline-clip, .threed-view')) return;
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
      state.addHoleTargetId || state.dimChainTargetId;
    // Net afgerond met een rechtermuisklik (polylijn, veelhoek): die klik
    // hoort bij het tekenen en wisselt niet van gereedschap.
    if (!nonDrawTools.includes(state.currentTool) && !state.isDrawing && !isMultiClickActive
        && !state._suppressNextContextmenu) {
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
        state.addHoleTargetId || state.dimChainTargetId;
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
        if (getActiveDocument() !== doc) return;
        const selected = doc?.selectedAnnotations || [];
        const area = selected.length === 1 ? selected[0] : null;
        const areaHit = area?.page === doc?.currentPage
          ? areaVertexHit(area, x, y, (HANDLE_SIZE / 2 + 4) / (getEffectiveScale() || 1)) : null;
        if (areaHit) { showContextMenu(e, area, areaHit); return; }
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
        // Geselecteerde veelhoek (#622): rechtsklik op een hoekpunt of zijde
        // geeft de hoekpunt-acties (weghalen / hier toevoegen).
        {
          const _sel = getActiveDocument()?.selectedAnnotations || [];
          const pg = _sel.length === 1 ? _sel[0] : null;
          if (pg && isBewerkbareVeelhoek(pg)) {
            const deel = veelhoekDeelBij(pg, x, y, (HANDLE_SIZE / 2 + 4) / scale);
            if (deel) {
              showContextMenu(e, pg, deel.kind === 'vertex'
                ? { kind: 'veelhoekHoek', nodeIndex: deel.nodeIndex, annotationId: pg.id }
                : { kind: 'veelhoekZijde', edgeIndex: deel.edgeIndex, punt: deel.punt, annotationId: pg.id });
              return;
            }
          }
        }
        if (annotation) {
          // Systeem (raster/plafond): rechtsklik op een PANEEL geeft het
          // menu paneel-context mee, zodat het paneeltype (tegel/
          // ventilatie/licht) direct via het contextmenu wisselbaar is —
          // ontdekbaar naast de tweede-klik-selectie.
          let sgVertex = null;
          if (annotation.type === 'systeemraster') {
            try {
              const [{ buildSysteemraster, paneelAt }, { systeemrasterBuildOpts }] =
                await Promise.all([
                  import('../../annotations/systeemraster.js'),
                  import('../../annotations/systeemraster-scale.js'),
                ]);
              const sgGeom = buildSysteemraster(annotation, systeemrasterBuildOpts(annotation));
              const cel = sgGeom ? paneelAt(sgGeom, x, y) : null;
              // Paneel-context (raster-layout) of algemene systeem-context;
              // beide dragen de klikpositie mee voor "Sparing toevoegen".
              sgVertex = cel
                ? { kind: 'paneel', ix: cel.ix, iy: cel.iy, annotationId: annotation.id, appX: x, appY: y }
                : { kind: 'systeem', annotationId: annotation.id, appX: x, appY: y };
            } catch (_) { /* systeem-context optioneel — menu opent gewoon */ }
          }
          // Stramienlijn: de klikpositie gaat mee, zodat het menu de koppeling
          // van het dichtstbijzijnde uiteinde kan omzetten.
          if (annotation.type === 'parametricSymbol' && annotation.symbolId === 'stramien') {
            sgVertex = { kind: 'stramien', annotationId: annotation.id, appX: x, appY: y };
          }
          // Wand: het klikpunt gaat mee, zodat "Join (niet) toestaan" het
          // uiteinde bij de klik kan kiezen (#476).
          if (annotation.type === 'wall') {
            sgVertex = { kind: 'wand', annotationId: annotation.id, appX: x, appY: y };
          }
          // Gevelelement (vliesgevel/kozijn): het menu krijgt het onderdeel
          // onder de klik en de positie langs het element mee (stijl hier
          // toevoegen, dichtstbijzijnde stijl verwijderen, paneel wisselen).
          if (!sgVertex) {
            try {
              const [{ gevelPreset }, { onderdeelOnderPunt, positieOpElement }] = await Promise.all([
                import('../../gevelelement/herkenning.js'),
                import('../../gevelelement/element.js'),
              ]);
              const gvPreset = gevelPreset(annotation);
              if (gvPreset) {
                const pos = positieOpElement(annotation, gvPreset, { x, y });
                sgVertex = {
                  kind: 'gevelelement',
                  annotationId: annotation.id,
                  onderdeel: onderdeelOnderPunt(annotation, gvPreset, { x, y }, 6 / scale),
                  uMm: pos ? pos.uMm : null,
                };
              }
            } catch (_) { /* gevelelement-context optioneel */ }
          }
          showContextMenu(e, annotation, sgVertex);
        } else {
          showPageContextMenu(e);
        }
      });
    });
  }
}
