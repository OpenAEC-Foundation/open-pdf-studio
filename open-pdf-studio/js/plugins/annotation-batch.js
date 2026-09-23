function assertSerializable(value, path = 'annotation', seen = new Set()) {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || seen.has(value)) {
    throw new TypeError(`${path} must contain only finite, serializable values`);
  }
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${path} must contain only serializable plain objects`);
  }
  seen.add(value);
  for (const [key, child] of Object.entries(value)) assertSerializable(child, `${path}.${key}`, seen);
  seen.delete(value);
}

function snapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateAnnotation(annotation, doc) {
  if (!annotation || typeof annotation !== 'object' || Array.isArray(annotation)) {
    throw new TypeError('annotation must be an object');
  }
  if (typeof annotation.id !== 'string' || !annotation.id) throw new TypeError('annotation id is required');
  if (typeof annotation.type !== 'string' || !annotation.type) throw new TypeError('annotation type is required');
  const pageCount = doc.numPages || doc.pdfDoc?.numPages || 0;
  if (!Number.isInteger(annotation.page) || annotation.page < 1 || annotation.page > pageCount) {
    throw new RangeError('annotation page is outside the document');
  }
  assertSerializable(annotation);
}

/** Apply validated annotation edits to the active document as one undoable operation. */
export function applyAnnotationBatch(doc, operations, host) {
  if (!doc || !Array.isArray(doc.annotations)) throw new Error('No active document');
  if (!Array.isArray(operations)) throw new TypeError('operations must be an array');
  const draft = new Map(doc.annotations.map(annotation => [annotation.id, snapshot(annotation)]));
  const planned = [];
  const result = { createdIds: [], updatedIds: [], deletedIds: [] };

  for (const operation of operations) {
    if (operation?.op === 'create') {
      const annotation = host.createAnnotation(operation.annotation);
      validateAnnotation(annotation, doc);
      if (draft.has(annotation.id)) throw new Error(`duplicate annotation id: ${annotation.id}`);
      draft.set(annotation.id, snapshot(annotation));
      planned.push({ op: 'create', annotation });
      result.createdIds.push(annotation.id);
    } else if (operation?.op === 'update') {
      const before = draft.get(operation.id);
      if (!before) throw new Error(`missing annotation: ${operation.id}`);
      if (!operation.changes || typeof operation.changes !== 'object' || Array.isArray(operation.changes)) {
        throw new TypeError('changes must be an object');
      }
      if ('id' in operation.changes || 'type' in operation.changes) {
        throw new Error('annotation id and type cannot be changed');
      }
      const after = { ...before, ...operation.changes };
      validateAnnotation(after, doc);
      draft.set(operation.id, snapshot(after));
      planned.push({ op: 'update', id: operation.id, changes: snapshot(operation.changes) });
      result.updatedIds.push(operation.id);
    } else if (operation?.op === 'delete') {
      if (!draft.has(operation.id)) throw new Error(`missing annotation: ${operation.id}`);
      draft.delete(operation.id);
      planned.push({ op: 'delete', id: operation.id });
      result.deletedIds.push(operation.id);
    } else {
      throw new TypeError(`unsupported annotation operation: ${operation?.op}`);
    }
  }

  if (doc._annotationPagesReady) {
    for (const operation of planned) {
      const page = operation.op === 'create' ? operation.annotation.page
        : operation.op === 'update' ? draft.get(operation.id)?.page || doc.annotations.find(a => a.id === operation.id)?.page
        : doc.annotations.find(a => a.id === operation.id)?.page;
      if (page && !doc._annotationPagesReady.has(page)) {
        throw new Error(`Page ${page} annotations are not ready; await waitForPageAnnotations(${page})`);
      }
    }
  }

  if (!planned.length) return result;
  host.beginUndoTransaction();
  try {
    for (const operation of planned) {
      if (operation.op === 'create') {
        doc.annotations.push(operation.annotation);
        host.recordAdd(operation.annotation);
      } else if (operation.op === 'update') {
        const annotation = doc.annotations.find(item => item.id === operation.id);
        const before = snapshot(annotation);
        Object.assign(annotation, operation.changes);
        host.recordModify(operation.id, before, annotation);
      } else {
        const index = doc.annotations.findIndex(item => item.id === operation.id);
        const [annotation] = doc.annotations.splice(index, 1);
        host.recordDelete(annotation, index);
      }
    }
  } finally {
    host.endUndoTransaction();
  }
  host.redraw();
  return result;
}
