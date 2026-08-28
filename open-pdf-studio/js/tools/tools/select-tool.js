import { getActiveDocument } from '../../core/state.js';
import { applyToolTransform, getEffectiveScale } from '../tool-context.js';
import { HANDLE_TYPES } from '../../core/constants.js';
import { recordModify } from '../../core/undo-manager.js';
import { tryStartInlineNumberEdit } from '../inline-number-editing.js';
import { buildSysteemraster, subElementAt } from '../../annotations/systeemraster.js';
import { isAnnotationHiddenInView } from '../../annotations/view-filters.js';
import { systeemrasterBuildOpts } from '../../annotations/systeemraster-scale.js';
import { updateStatusMessage } from '../../ui/chrome/status-bar.js';

/**
 * Select tool — click-select, rubber band, drag, resize, Ctrl+drag copy
 * Unified select tool — handles both annotation selection and text selection
 */
export const selectTool = {
  name: 'select',
  cursor: 'default',

  onPointerDown(ctx, e) {
    const { x, y, state } = ctx;
    const pdfaLocked = ctx.isPdfAReadOnly();
    const doc = getActiveDocument();
    const selAnns = doc ? doc.selectedAnnotations : [];

    // Check resize handle on selected annotation.
    // Cursor is driven by state.isResizing + state.activeHandle (see js/ui/cursor.js).
    const selAnn = selAnns.length === 1 ? selAnns[0] : null;
    if (!pdfaLocked && selAnn) {
      const handleType = ctx.findHandleAt(x, y, selAnn);
      if (handleType) {
        // Edit-contour mode: clicking an edge midpoint inserts a new vertex
        // there and immediately enters drag mode for that new vertex.
        if (state.editingContour === selAnn.id && typeof handleType === 'string' &&
            handleType.startsWith('polyline_edge_')) {
          const before = ctx.cloneAnnotation(selAnn);
          const holeMatch = handleType.match(/^polyline_edge_hole_(\d+)_(\d+)$/);
          if (holeMatch && Array.isArray(selAnn.holes)) {
            const hi = parseInt(holeMatch[1], 10);
            const ei = parseInt(holeMatch[2], 10);
            const hole = selAnn.holes[hi];
            if (hole && ei >= 0 && ei < hole.length) {
              const a = hole[ei];
              const b = hole[(ei + 1) % hole.length];
              const newPt = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
              if (state._editArcMode) {
                newPt.arc = true;
                newPt.bulge = 0.5;
                state._editArcMode = false;
              }
              hole.splice(ei + 1, 0, newPt);
              const newNodeIdx = ei + 1;
              state.isResizing = true;
              state.activeHandle = `polyline_node_hole_${hi}_${newNodeIdx}`;
              state.originalAnnotation = ctx.cloneAnnotation(selAnn);
              state._editContourBefore = before;
              ctx.redraw();
              return;
            }
          } else {
            const ei = parseInt(handleType.split('_').pop(), 10);
            const pts = selAnn.points || [];
            if (!isNaN(ei) && ei >= 0 && ei < pts.length) {
              const a = pts[ei];
              const b = pts[(ei + 1) % pts.length];
              const newPt = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
              if (state._editArcMode) {
                newPt.arc = true;
                newPt.bulge = 0.5;
                state._editArcMode = false;
              }
              pts.splice(ei + 1, 0, newPt);
              const newNodeIdx = ei + 1;
              state.isResizing = true;
              state.activeHandle = `polyline_node_${newNodeIdx}`;
              state.originalAnnotation = ctx.cloneAnnotation(selAnn);
              state._editContourBefore = before;
              ctx.redraw();
              return;
            }
          }
        }
        // Textbox leader: + add button — append a new leader and commit undo
        if (selAnn.type === 'textbox' && handleType === HANDLE_TYPES.LEADER_ADD) {
          const before = ctx.cloneAnnotation(selAnn);
          const bw = selAnn.width || 150;
          const bh = selAnn.height || 50;
          const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
          const tipX = selAnn.x + bw + 80;
          const tipY = selAnn.y + bh / 2;
          const kneeX = selAnn.x + bw + 40;
          const kneeY = selAnn.y + bh / 2;
          if (!Array.isArray(selAnn.leaders)) selAnn.leaders = [];
          selAnn.leaders.push({ id, tipX, tipY, kneeX, kneeY, endStyle: 'arrow' });
          selAnn.modifiedAt = new Date().toISOString();
          recordModify(selAnn.id, before, ctx.cloneAnnotation(selAnn));
          ctx.redraw();
          return;
        }
        // Textbox leader: × delete button — splice that leader and commit undo
        if (selAnn.type === 'textbox' && typeof handleType === 'string' &&
            handleType.startsWith(HANDLE_TYPES.LEADER_DELETE + '_')) {
          const leaderId = handleType.substring((HANDLE_TYPES.LEADER_DELETE + '_').length);
          const before = ctx.cloneAnnotation(selAnn);
          if (Array.isArray(selAnn.leaders)) {
            selAnn.leaders = selAnn.leaders.filter(l => l.id !== leaderId);
            selAnn.modifiedAt = new Date().toISOString();
            recordModify(selAnn.id, before, ctx.cloneAnnotation(selAnn));
          }
          ctx.redraw();
          return;
        }
        state.isResizing = true;
        state.activeHandle = handleType;
        state.originalAnnotation = ctx.cloneAnnotation(selAnn);
        return;
      }
    }

    // "Armed marquee": when the user clicked the Select button in the ribbon,
    // the next pointerdown unconditionally starts a rubber-band selection,
    // even if it lands on an annotation. The flag is consumed here.
    const armedMarquee = !!state.armedMarquee;
    if (armedMarquee) state.armedMarquee = false;

    const clickedAnnotation = armedMarquee ? null : ctx.findAnnotationAt(x, y);
    // Auto-exit edit-contour mode when clicking outside the currently edited annotation
    if (state.editingContour && (!clickedAnnotation || clickedAnnotation.id !== state.editingContour)) {
      state.editingContour = null;
    }
    if (clickedAnnotation) {
      // Double-click to edit textbox/callout
      if (!pdfaLocked && e.detail === 2 && ['textbox', 'callout'].includes(clickedAnnotation.type)) {
        ctx.startTextEditing(clickedAnnotation);
        return;
      }

      // Click on comment: open popup
      if (clickedAnnotation.type === 'comment') {
        if (doc) { doc.selectedAnnotations = [clickedAnnotation]; doc.selectedAnnotation = clickedAnnotation; }
        ctx.showProperties(clickedAnnotation);
        ctx.openStickyPopup(clickedAnnotation);
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        // Re-read after potential addToSelection
        const selAnns2 = () => doc ? doc.selectedAnnotations : [];
        if (ctx.isSelected(clickedAnnotation)) {
          // Ctrl+click on already selected: initiate Ctrl+drag copy
          if (!pdfaLocked) {
            state.isDragging = true;
            state._ctrlDragCopy = true;
            state._ctrlCopiesCreated = false;
            state.originalAnnotations = selAnns2().map(a => ctx.cloneAnnotation(a));
            if (selAnns2().length === 1) {
              state.originalAnnotation = ctx.cloneAnnotation(selAnns2()[0]);
            }
            state.dragCursor = 'copy';
          }
        } else {
          // Ctrl+click on unselected: add and allow drag
          ctx.addToSelection(clickedAnnotation);
          if (!pdfaLocked) {
            state.isDragging = true;
            state._ctrlDragCopy = true;
            state._ctrlCopiesCreated = false;
            state.originalAnnotations = selAnns2().map(a => ctx.cloneAnnotation(a));
            if (selAnns2().length === 1) {
              state.originalAnnotation = ctx.cloneAnnotation(selAnns2()[0]);
            }
            state.dragCursor = 'copy';
          }
        }
        if (selAnns2().length === 1) {
          ctx.showProperties(selAnns2()[0]);
        } else if (selAnns2().length > 1) {
          ctx.showMultiSelectionProperties();
        } else {
          ctx.hideProperties();
        }
        ctx.redraw();
      } else if (e.shiftKey) {
        // Shift+click: additive selection (do not start drag)
        if (ctx.isSelected(clickedAnnotation)) {
          // Already selected — leave as is (additive doesn't remove)
        } else {
          ctx.addToSelection(clickedAnnotation);
        }
        const selAnnsNow = doc ? doc.selectedAnnotations : [];
        if (selAnnsNow.length === 1) {
          ctx.showProperties(selAnnsNow[0]);
        } else if (selAnnsNow.length > 1) {
          ctx.showMultiSelectionProperties();
        } else {
          ctx.hideProperties();
        }
        ctx.redraw();
      } else {
        // Inline getalbewerking: klik op een (blauw gemarkeerd) bewerkbaar
        // getal van de reeds geselecteerde annotatie opent direct het
        // invoerveld — géén sleep starten. Alleen bij een enkelvoudige
        // selectie: dat is precies de situatie waarin rendering.js de
        // getallen blauw kleurt (zie annotations/editable-numbers.js).
        if (!pdfaLocked && ctx.isSelected(clickedAnnotation) && selAnns.length === 1) {
          let inlineHandled = false;
          try {
            inlineHandled = tryStartInlineNumberEdit(clickedAnnotation, x, y);
          } catch (err) {
            console.error('[select] inline number edit error', err);
          }
          if (inlineHandled) {
            ctx.redraw();
            return;
          }
          // Systeemraster/-plafond: tweede klik binnen het geselecteerde
          // component selecteert het SUB-ELEMENT onder de cursor — rand
          // vóór rasterlijn vóór paneel (subElementAt). De selectie is
          // transient (selectedSub wordt niet opgeslagen); de sleep start
          // gewoon mee — klik-zonder-beweging selecteert, klik-en-sleep
          // verplaatst het component zoals altijd.
          if (clickedAnnotation.type === 'systeemraster') {
            try {
              const geom = buildSysteemraster(clickedAnnotation,
                systeemrasterBuildOpts(clickedAnnotation));
              const sub = geom
                ? subElementAt(geom, x, y, 6 / (ctx.scale || 1)) : null;
              const prev = clickedAnnotation.selectedSub || null;
              if (JSON.stringify(sub) !== JSON.stringify(prev)) {
                clickedAnnotation.selectedSub = sub;
                ctx.showProperties(clickedAnnotation);
              }
            } catch (err) {
              console.error('[select] sub-element-selectie', err);
            }
          }
        }
        const isTextMarkup = ['textHighlight', 'textStrikethrough', 'textUnderline'].includes(clickedAnnotation.type);
        if (ctx.isSelected(clickedAnnotation) && selAnns.length > 1) {
          if (!pdfaLocked && !isTextMarkup) {
            state.isDragging = true;
            state.originalAnnotations = selAnns.map(a => ctx.cloneAnnotation(a));
            state.dragCursor = 'move';
          }
        } else {
          // Collection: clicking any grouped member selects the WHOLE group so
          // the collection moves and edits as a single unit. Ungroup via the
          // "Ontbinden" button in the Verzameling ribbon group.
          // Verse selectie van een systeemraster: sub-element-selectie
          // wissen — die hoort bij de "tweede klik" op een al geselecteerd
          // component. ALLEEN bij een écht verse selectie: bij een herhaalde
          // klik op het al geselecteerde component loopt deze tak óók
          // (herselectie vóór de sleepstart) en zou de zojuist gezette
          // selectie meteen weer gewist worden.
          if (clickedAnnotation.type === 'systeemraster'
              && !ctx.isSelected(clickedAnnotation)) {
            clickedAnnotation.selectedSub = null;
            clickedAnnotation._hoverSub = null;
            // Ontdekbaarheid: statusbalk-hint voor de tweede klik.
            try {
              updateStatusMessage('Klik nogmaals om een onderdeel te selecteren (paneel, rand of rasterlijn)');
            } catch (_) { /* statusbalk optioneel */ }
          }
          let toSelect = [clickedAnnotation];
          if (clickedAnnotation.groupId && doc) {
            const members = doc.annotations.filter(a => a.groupId === clickedAnnotation.groupId);
            if (members.length > 1) toSelect = members;
          }
          if (doc) { doc.selectedAnnotations = toSelect; doc.selectedAnnotation = clickedAnnotation; }
          if (toSelect.length > 1) ctx.showMultiSelectionProperties();
          else ctx.showProperties(clickedAnnotation);
          if (!pdfaLocked && !isTextMarkup) {
            state.isDragging = true;
            state.originalAnnotation = ctx.cloneAnnotation(clickedAnnotation);
            state.originalAnnotations = toSelect.map(a => ctx.cloneAnnotation(a));
            state.dragCursor = 'move';
          }
        }
      }
    } else {
      // Start rubber band selection. Modifier from initial pointerdown
      // determines how the resulting set is combined with current selection.
      state.isRubberBanding = true;
      state.rubberBandStartX = x;
      state.rubberBandStartY = y;
      state.rubberBandEndX = x;
      state.rubberBandEndY = y;
      state.rubberBandPage = ctx.pageNum;
      state.rubberBandMode = 'window'; // updated live during pointermove
      state.rubberBandModifier = (e.shiftKey)
        ? 'add'
        : ((e.ctrlKey || e.metaKey) ? 'toggle' : 'replace');
      if (state.rubberBandModifier === 'replace') {
        ctx.clearSelection();
        ctx.hideProperties();
      }
      ctx.redraw();

      // No annotation hit — temporarily enable text layer for text selection
      const textLayers = document.querySelectorAll('.textLayer');
      textLayers.forEach(layer => {
        layer.style.pointerEvents = 'auto';
        layer.querySelectorAll('span').forEach(span => {
          span.style.pointerEvents = 'auto';
          span.style.cursor = 'text';
        });
      });
    }
  },

  onPointerMove(ctx, e) {
    const { x, y, state, canvas, canvasCtx } = ctx;

    // Rubber band: update the live end-point and let the render overlay pass
    // (rendering.js drawRubberBand) paint the marquee. Drawing it there —
    // driven by state, as the last step of every frame — means it survives
    // each redraw, instead of being hand-painted right after redraw() where
    // the following frame could erase it (the marquee then showed on some
    // gestures but not others).
    if (state.isRubberBanding) {
      // AutoCAD-style: drag right → window (blue, solid),
      // drag left → crossing (green, dashed).
      state.rubberBandMode = x < state.rubberBandStartX ? 'crossing' : 'window';
      state.rubberBandEndX = x;
      state.rubberBandEndY = y;
      ctx.redraw();
      return;
    }

    // Hover state — write to state.hoverAnnotation / state.hoverHandle.
    // The reactive cursor module (js/ui/cursor.js) reads these and updates
    // the visible cursor automatically; tools NEVER set canvas.style.cursor.
    const doc = getActiveDocument();
    const selAnns = doc ? doc.selectedAnnotations : [];
    const hoverAnn = selAnns.length === 1 ? selAnns[0] : null;
    let hoverHandle = null;
    if (hoverAnn) {
      hoverHandle = ctx.findHandleAt(x, y, hoverAnn);
    }
    state.hoverHandle = hoverHandle;
    // Sub-element-hover op een geselecteerd systeemraster: licht oplichten
    // van het onderdeel dat een tweede klik zou pakken (ontdekbaarheid).
    const setHoverSub = (ann, sub) => {
      if (!ann) return;
      if (JSON.stringify(ann._hoverSub || null) !== JSON.stringify(sub)) {
        ann._hoverSub = sub;
        ctx.redraw();
      }
    };
    if (hoverHandle) {
      // Hovering a resize handle — clear annotation hover so the handle wins.
      if (hoverAnn?.type === 'systeemraster') setHoverSub(hoverAnn, null);
      state.hoverAnnotation = null;
      canvas.title = '';
      return;
    }
    const hoverAnnotation = ctx.findAnnotationAt(x, y);
    if (hoverAnn?.type === 'systeemraster') {
      let sub = null;
      if (hoverAnnotation === hoverAnn) {
        try {
          const geom = buildSysteemraster(hoverAnn, systeemrasterBuildOpts(hoverAnn));
          sub = geom ? subElementAt(geom, x, y, 6 / (ctx.scale || 1)) : null;
        } catch (_) { sub = null; }
      }
      setHoverSub(hoverAnn, sub);
    }
    state.hoverAnnotation = hoverAnnotation || null;
    canvas.title = (hoverAnnotation?.type === 'comment' && !hoverAnnotation.popupOpen && hoverAnnotation.text)
      ? hoverAnnotation.text.split('\n').slice(0, 5).join('\n') : '';
  },

  // Escape: één niveau terug — sub-element → component → (dispatcher wist
  // daarna de selectie zelf). Alleen handelen als er echt een sub-element
  // geselecteerd is; anders valt Escape door naar het standaardgedrag.
  onEscape(ctx) {
    const doc = getActiveDocument();
    const selAnns = doc ? doc.selectedAnnotations : [];
    const ann = selAnns.length === 1 ? selAnns[0] : null;
    if (ann && ann.type === 'systeemraster' && ann.selectedSub) {
      ann.selectedSub = null;
      ann._hoverSub = null;
      ctx.showProperties(ann);
      ctx.redraw();
      return true;
    }
    return false;
  },

  onPointerUp(ctx, e) {
    const { x, y, state } = ctx;

    // Rubber band selection end
    if (state.isRubberBanding) {
      state.isRubberBanding = false;
      const mode = state.rubberBandMode || (x < state.rubberBandStartX ? 'crossing' : 'window');
      const modifier = state.rubberBandModifier || 'replace';

      const rbX = Math.min(state.rubberBandStartX, x);
      const rbY = Math.min(state.rubberBandStartY, y);
      const rbW = Math.abs(x - state.rubberBandStartX);
      const rbH = Math.abs(y - state.rubberBandStartY);

      if (rbW > 3 || rbH > 3) {
        const selected = [];
        const doc = state.documents[state.activeDocumentIndex];
        for (const ann of (doc?.annotations || [])) {
          if (ann.page !== ctx.pageNum) continue;
          // Onzichtbaar door een weergavefilter (hidden-vlag, Zichtbaarheid
          // Elementen, statusfilter #333) = ook niet marquee-selecteerbaar.
          if (isAnnotationHiddenInView(ann)) continue;
          const bounds = ctx.getAnnotationBounds(ann);
          if (!bounds) continue;
          const fullyInside =
            bounds.x >= rbX && bounds.x + bounds.width <= rbX + rbW &&
            bounds.y >= rbY && bounds.y + bounds.height <= rbY + rbH;
          const intersects =
            bounds.x < rbX + rbW && bounds.x + bounds.width > rbX &&
            bounds.y < rbY + rbH && bounds.y + bounds.height > rbY;
          const hit = mode === 'window' ? fullyInside : intersects;
          if (hit) selected.push(ann);
        }
        if (doc) {
          if (modifier === 'add') {
            for (const a of selected) {
              if (!doc.selectedAnnotations.includes(a)) doc.selectedAnnotations.push(a);
            }
          } else if (modifier === 'toggle') {
            for (const a of selected) {
              const idx = doc.selectedAnnotations.indexOf(a);
              if (idx >= 0) doc.selectedAnnotations.splice(idx, 1);
              else doc.selectedAnnotations.push(a);
            }
          } else {
            // replace
            doc.selectedAnnotations = selected;
          }
          const selNow = doc.selectedAnnotations;
          doc.selectedAnnotation = selNow.length > 0 ? selNow[selNow.length - 1] : null;
          if (selNow.length === 1) ctx.showProperties(selNow[0]);
          else if (selNow.length > 1) ctx.showMultiSelectionProperties();
          else ctx.hideProperties();
        }
      }
      ctx.redraw();

      // Restore text layer to non-interactive after rubber band
      setTimeout(() => {
        if (state.currentTool === 'select') {
          const textLayers = document.querySelectorAll('.textLayer');
          textLayers.forEach(layer => {
            layer.style.pointerEvents = 'none';
            layer.querySelectorAll('span').forEach(span => {
              span.style.pointerEvents = 'none';
              span.style.cursor = 'default';
            });
          });
        }
      }, 100);

      return true; // handled
    }

    // Restore text layer to non-interactive after pointer up
    setTimeout(() => {
      if (state.currentTool === 'select') {
        const textLayers = document.querySelectorAll('.textLayer');
        textLayers.forEach(layer => {
          layer.style.pointerEvents = 'none';
          layer.querySelectorAll('span').forEach(span => {
            span.style.pointerEvents = 'none';
            span.style.cursor = 'default';
          });
        });
      }
    }, 100);

    return false; // not handled — let dispatcher do drag/resize finalization
  },
};
