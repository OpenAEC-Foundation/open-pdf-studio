import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
let page;

try {
  const context = browser.contexts()[0];
  assert.ok(context, 'Open PDF Studio browser context is not available on CDP port 9222');
  page = await context.newPage();
  await page.goto('http://localhost:3041');
  await page.waitForSelector('#annotation-canvas', { state: 'attached' });

  const result = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const {
      undo,
      redo,
      recordAdd,
      recordModify,
      recordBulkDelete,
      recordPropertyChange,
      flushPropertyChange,
      beginUndoTransaction,
      endUndoTransaction,
      recordMeasureScale,
    } =
      await import('/js/core/undo-manager.js');
    const { handleKeydown } = await import('/js/tools/keyboard-handlers.js');
    const { bringToFront } = await import('/js/annotations/z-order.js');
    const { alignAnnotations } = await import('/js/annotations/smart-guides.js');
    const { commitAnnotationMutation } = await import('/js/annotations/mutations.js');
    const { explodeSelection } = await import('/js/annotations/segment-ops.js');
    const originalState = {
      documents: state.documents,
      activeDocumentIndex: state.activeDocumentIndex,
    };

    const makeDoc = (annotations) => ({
      id: `undo-coverage-${Math.random()}`,
      pdfDoc: { numPages: 1 }, filePath: null,
      currentPage: 1, scale: 1, viewMode: 'single', annotations,
      selectedAnnotation: annotations[0] || null,
      selectedAnnotations: annotations.slice(),
      undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    });
    const triggerUndo = async () => {
      let prevented = false;
      await handleKeydown({
        key: 'z', code: 'KeyZ', ctrlKey: true,
        metaKey: false, shiftKey: false, altKey: false,
        target: document.body,
        preventDefault() { prevented = true; },
        stopPropagation() {},
      });
      await new Promise(resolve => setTimeout(resolve, 80));
      return prevented;
    };

    try {
      const propertyAnnotation = {
        id: 'property', type: 'rectangle', page: 1,
        x: 10, y: 10, width: 20, height: 20, opacity: 1,
      };
      const propertyDoc = makeDoc([propertyAnnotation]);
      state.documents = [propertyDoc];
      state.activeDocumentIndex = 0;
      const activePropertyAnnotation = state.documents[0].annotations[0];
      recordPropertyChange(activePropertyAnnotation);
      activePropertyAnnotation.opacity = 0.4;
      await undo();
      const property = {
        opacity: activePropertyAnnotation.opacity,
        undoLength: state.documents[0].undoStack.length,
        redoLength: state.documents[0].redoStack.length,
      };
      // Ensure a failed scenario cannot leak its debounce into the next one.
      flushPropertyChange();

      const orderedEdit = {
        id: 'ordered-edit', type: 'rectangle', page: 1,
        x: 10, y: 10, width: 20, height: 20, opacity: 1,
      };
      state.documents = [makeDoc([orderedEdit])];
      const activeOrderedEdit = state.documents[0].annotations[0];
      recordPropertyChange(activeOrderedEdit);
      activeOrderedEdit.opacity = 0.4;
      await Promise.resolve();
      const beforeMove = { ...activeOrderedEdit };
      activeOrderedEdit.x = 30;
      recordModify(activeOrderedEdit.id, beforeMove, activeOrderedEdit);
      await undo();
      const orderedAfterMoveUndo = { x: activeOrderedEdit.x, opacity: activeOrderedEdit.opacity };
      await undo();
      const orderedEdits = {
        afterMoveUndo: orderedAfterMoveUndo,
        afterPropertyUndo: { x: activeOrderedEdit.x, opacity: activeOrderedEdit.opacity },
        undoLength: state.documents[0].undoStack.length,
        redoLength: state.documents[0].redoStack.length,
      };

      const back = { id: 'back', type: 'rectangle', page: 1, x: 0, y: 0, width: 10, height: 10 };
      const middle = { id: 'middle', type: 'rectangle', page: 1, x: 20, y: 0, width: 10, height: 10 };
      const front = { id: 'front', type: 'rectangle', page: 1, x: 40, y: 0, width: 10, height: 10 };
      const orderDoc = makeDoc([back, middle, front]);
      orderDoc.selectedAnnotation = back;
      orderDoc.selectedAnnotations = [back];
      state.documents = [orderDoc];
      bringToFront(state.documents[0].annotations[0]);
      const orderAfterEdit = state.documents[0].annotations.map(annotation => annotation.id);
      await triggerUndo();
      const order = {
        afterEdit: orderAfterEdit,
        afterUndo: state.documents[0].annotations.map(annotation => annotation.id),
        undoLength: state.documents[0].undoStack.length,
        redoLength: state.documents[0].redoStack.length,
      };

      const left = { id: 'left', type: 'rectangle', page: 1, x: 10, y: 0, width: 10, height: 10 };
      const right = { id: 'right', type: 'rectangle', page: 1, x: 50, y: 20, width: 10, height: 10 };
      const alignDoc = makeDoc([left, right]);
      state.documents = [alignDoc];
      alignAnnotations('left');
      const alignmentAfterEdit = state.documents[0].annotations.map(annotation => annotation.x);
      await triggerUndo();
      const alignment = {
        afterEdit: alignmentAfterEdit,
        afterUndo: state.documents[0].annotations.map(annotation => annotation.x),
        undoLength: state.documents[0].undoStack.length,
        redoLength: state.documents[0].redoStack.length,
      };

      const original = {
        id: 'compound-original', type: 'line', page: 1,
        startX: 0, startY: 0, endX: 100, endY: 0,
      };
      const compoundDoc = makeDoc([original]);
      state.documents = [compoundDoc];
      const activeOriginal = state.documents[0].annotations[0];
      const beforeOriginal = { ...activeOriginal };
      const added = {
        id: 'compound-added', type: 'line', page: 1,
        startX: 50, startY: 0, endX: 100, endY: 0,
      };
      beginUndoTransaction();
      activeOriginal.endX = 50;
      recordModify(activeOriginal.id, beforeOriginal, activeOriginal);
      state.documents[0].annotations.push(added);
      recordAdd(added);
      endUndoTransaction();
      const compoundAfterEdit = state.documents[0].annotations.map(annotation => ({
        id: annotation.id,
        endX: annotation.endX,
      }));
      await undo();
      const compound = {
        afterEdit: compoundAfterEdit,
        afterUndo: state.documents[0].annotations.map(annotation => ({
          id: annotation.id,
          endX: annotation.endX,
        })),
        undoLength: state.documents[0].undoStack.length,
        redoLength: state.documents[0].redoStack.length,
      };

      const mutationTarget = {
        id: 'mutation-target', type: 'rectangle', page: 1,
        x: 0, y: 0, width: 10, height: 10, locked: false,
      };
      const mutationDoc = makeDoc([mutationTarget]);
      state.documents = [mutationDoc];
      commitAnnotationMutation(state.documents[0].annotations[0], annotation => {
        annotation.locked = true;
        annotation.flattened = true;
      });
      await undo();
      const mutation = {
        locked: state.documents[0].annotations[0].locked,
        flattenedPresent: Object.prototype.hasOwnProperty.call(state.documents[0].annotations[0], 'flattened'),
        undoLength: state.documents[0].undoStack.length,
        redoLength: state.documents[0].redoStack.length,
      };

      const scaleDoc = makeDoc([]);
      scaleDoc.measureScale = { pixelsPerUnit: 2, unit: 'mm' };
      state.documents = [scaleDoc];
      const oldScale = { ...state.documents[0].measureScale };
      state.documents[0].measureScale = { pixelsPerUnit: 4, unit: 'mm' };
      recordMeasureScale(oldScale, state.documents[0].measureScale);
      await undo();
      const scale = {
        measureScale: { ...state.documents[0].measureScale },
        undoLength: state.documents[0].undoStack.length,
        redoLength: state.documents[0].redoStack.length,
      };

      const polyline = {
        id: 'explode-source', type: 'polyline', page: 1,
        points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }],
      };
      const explodeDoc = makeDoc([polyline]);
      state.documents = [explodeDoc];
      explodeSelection();
      const explodeAfterEdit = state.documents[0].annotations.map(annotation => annotation.type);
      const explodeSelectionAfterEdit = state.documents[0].selectedAnnotations.map(annotation => annotation.id);
      await undo();
      const explodeAfterUndo = state.documents[0].annotations.map(annotation => ({
        id: annotation.id,
        type: annotation.type,
        pointCount: annotation.points?.length,
      }));
      const explodeSelectionAfterUndo = state.documents[0].selectedAnnotations.map(annotation => annotation.id);
      await redo();
      const explode = {
        afterEdit: explodeAfterEdit,
        selectionAfterEdit: explodeSelectionAfterEdit,
        afterUndo: explodeAfterUndo,
        selectionAfterUndo: explodeSelectionAfterUndo,
        afterRedo: state.documents[0].annotations.map(annotation => annotation.type),
        selectionAfterRedo: state.documents[0].selectedAnnotations.map(annotation => annotation.id),
        undoLength: state.documents[0].undoStack.length,
        redoLength: state.documents[0].redoStack.length,
      };

      const deleteItems = ['a', 'b', 'c', 'd'].map((id, index) => ({
        id, type: 'rectangle', page: 1, x: index * 20, y: 0, width: 10, height: 10,
      }));
      state.documents = [makeDoc(deleteItems)];
      const liveDeleteItems = state.documents[0].annotations;
      const reverseSelection = [liveDeleteItems[2], liveDeleteItems[1]];
      recordBulkDelete(reverseSelection);
      const deletedIds = new Set(reverseSelection.map(annotation => annotation.id));
      state.documents[0].annotations = liveDeleteItems.filter(annotation => !deletedIds.has(annotation.id));
      await undo();
      const bulkDeleteOrder = state.documents[0].annotations.map(annotation => annotation.id);

      return { property, orderedEdits, order, alignment, compound, mutation, scale, explode, bulkDeleteOrder };
    } finally {
      flushPropertyChange();
      state.documents = originalState.documents;
      state.activeDocumentIndex = originalState.activeDocumentIndex;
    }
  });

  assert.deepEqual(result.property, {
    opacity: 1,
    undoLength: 0,
    redoLength: 1,
  });
  assert.deepEqual(result.orderedEdits, {
    afterMoveUndo: { x: 10, opacity: 0.4 },
    afterPropertyUndo: { x: 10, opacity: 1 },
    undoLength: 0,
    redoLength: 2,
  });
  assert.deepEqual(result.order, {
    afterEdit: ['middle', 'front', 'back'],
    afterUndo: ['back', 'middle', 'front'],
    undoLength: 0,
    redoLength: 1,
  });
  assert.deepEqual(result.alignment, {
    afterEdit: [10, 10],
    afterUndo: [10, 50],
    undoLength: 0,
    redoLength: 1,
  });
  assert.deepEqual(result.compound, {
    afterEdit: [
      { id: 'compound-original', endX: 50 },
      { id: 'compound-added', endX: 100 },
    ],
    afterUndo: [{ id: 'compound-original', endX: 100 }],
    undoLength: 0,
    redoLength: 1,
  });
  assert.deepEqual(result.mutation, {
    locked: false,
    flattenedPresent: false,
    undoLength: 0,
    redoLength: 1,
  });
  assert.deepEqual(result.scale, {
    measureScale: { pixelsPerUnit: 2, unit: 'mm' },
    undoLength: 0,
    redoLength: 1,
  });
  assert.deepEqual(result.explode, {
    afterEdit: ['line', 'line'],
    selectionAfterEdit: result.explode.selectionAfterRedo,
    afterUndo: [{ id: 'explode-source', type: 'polyline', pointCount: 3 }],
    selectionAfterUndo: ['explode-source'],
    afterRedo: ['line', 'line'],
    selectionAfterRedo: result.explode.selectionAfterRedo,
    undoLength: 1,
    redoLength: 0,
  });
  assert.equal(result.explode.selectionAfterRedo.length, 2);
  assert.deepEqual(result.bulkDeleteOrder, ['a', 'b', 'c', 'd']);

  console.log('annotation edit undo coverage test passed');
} finally {
  if (page) await page.close();
  await browser.close();
}
