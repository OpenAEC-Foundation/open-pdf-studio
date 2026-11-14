import { stablePdfIds, makeBaseline, applyDerived, withPdfNames } from './shared-review-core.js';

// Injectable renderer boundary. Only the newly created tab/temp file belongs
// to this adapter; cancellation must never close an existing user document.
export function createCentralPdfAdapter(title, io) {
  return {
    async open(bytes, allowed = () => true) {
      const path = await io.createFile(bytes);
      let doc, disposed = false, generation = null;
      const current = () => !disposed && !!doc && io.contains(doc) &&
        (generation === null || doc._annotationLoadId === generation);
      const check = () => { if (!allowed() || !current()) throw new Error('STALE'); };
      const dispose = async () => {
        if (disposed) return;
        disposed = true;
        try { if (doc && io.contains(doc)) await io.close(doc); }
        finally { await io.removeFile(path); }
      };
      try {
        if (!allowed()) throw new Error('STALE');
        doc = io.createTab(path);
        doc.isUntitled = true;
        doc._centralReviewOpening = true;
        doc.fileName = title;
        return {
          doc, isCurrent: current, dispose,
          async ready() {
            check();
            await io.load(doc, path, bytes.slice()); check();
            if (!doc.pdfDoc) throw new Error('PDF_LOAD_FAILED');
            generation = doc._annotationLoadId;
            await io.annotationsReady(doc); check();
            if (doc._annotationPagesReady?.size !== doc.pdfDoc.numPages || doc._pagesNeedingColorUpdate?.size) throw new Error('PDF_LOAD_FAILED');
          },
          install(view) {
            check();
            if (view.annotations.some(row => row.data && row.data.page > doc.pdfDoc.numPages)) throw new Error('INVALID_RESPONSE');
            const ids = stablePdfIds(doc.annotations);
            const idOf = ann => ids.get(ann.id) || ann.id;
            const derived = { annotations: new Map(view.annotations.map(row => [row.id,
              { head: row.base, data: row.data, deleted: row.data === null }])) };
            const result = applyDerived(doc.annotations, derived, new Map(), makeBaseline(doc.annotations, idOf), idOf);
            doc.annotations = withPdfNames(result.annotations, idOf);
            doc.selectedAnnotation = null; doc.selectedAnnotations = [];
            doc.undoStack = []; doc.redoStack = [];
            doc.fileName = title;
            doc._centralReviewOpening = false;
            io.modified(doc);
            io.redraw(doc);
          },
        };
      } catch (error) { await dispose(); throw error; }
    },
  };
}
