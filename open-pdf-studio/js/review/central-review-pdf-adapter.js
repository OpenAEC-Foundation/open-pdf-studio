import { stablePdfIds, makeBaseline, applyDerived, withPdfNames, snapshotAnnotation, replaceContents } from './shared-review-core.js';

// Injectable renderer boundary. Only the newly created tab/temp file belongs
// to this adapter; cancellation must never close an existing user document.
export function createCentralPdfAdapter(title, io) {
  return {
    async open(bytes, allowed = () => true) {
      const path = await io.createFile(bytes);
      let doc, disposed = false, generation = null;
      let ids = new Map();
      const idOf = ann => ids.get(ann.id) || ann.id;
      const freshAnnotation = data => {
        const wireId = data.id;
        const localId = ids.has(wireId) ? `central:${crypto.randomUUID()}` : wireId;
        ids.set(localId, wireId);
        return { ...structuredClone(data), id: localId, nm: wireId };
      };
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
          read() {
            check();
            return new Map(doc.annotations.map(ann => {
              const data = snapshotAnnotation({ ...ann, id: idOf(ann) });
              // PDF export names are local bookkeeping, not an edit to publish.
              delete data.nm;
              return [data.id, data];
            }));
          },
          write(changes) {
            check();
            if ([...changes.values()].some(data => data && data.page > doc.pdfDoc.numPages)) throw new Error('INVALID_RESPONSE');
            const byId = new Map(doc.annotations.map(ann => [idOf(ann), ann]));
            for (const [id, data] of changes) {
              const ann = byId.get(id);
              if (data === null) doc.annotations = doc.annotations.filter(item => item !== ann);
              else if (ann) replaceContents(ann, { ...data, id: ann.id, nm: id });
              else doc.annotations.push(freshAnnotation(data));
            }
            if (changes.size) {
              doc.selectedAnnotations = (doc.selectedAnnotations || []).filter(ann => doc.annotations.includes(ann));
              if (!doc.annotations.includes(doc.selectedAnnotation)) doc.selectedAnnotation = null;
              // Old snapshots could otherwise undo a colleague's remote edits.
              doc.undoStack = []; doc.redoStack = [];
              io.modified(doc); io.redraw(doc);
            }
          },
          install(view) {
            check();
            if (view.annotations.some(row => row.data && row.data.page > doc.pdfDoc.numPages)) throw new Error('INVALID_RESPONSE');
            ids = stablePdfIds(doc.annotations);
            const derived = { annotations: new Map(view.annotations.map(row => [row.id,
              { head: row.base, data: row.data, deleted: row.data === null }])) };
            const original = new Set(doc.annotations);
            const result = applyDerived(doc.annotations, derived, new Map(), makeBaseline(doc.annotations, idOf), idOf);
            doc.annotations = withPdfNames(result.annotations.map(ann => original.has(ann) ? ann : freshAnnotation(ann)), idOf);
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
