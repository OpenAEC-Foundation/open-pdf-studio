import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAnnotationBatch } from './annotation-batch.js';

function fixture() {
  const doc = {
    id: 'drawing-1', numPages: 2, currentPage: 1,
    annotations: [{ id: 'wall-1', type: 'wall', page: 1, x: 10, y: 20, width: 50 }],
  };
  const commands = [];
  let transaction = null;
  const host = {
    createAnnotation: (props) => ({ id: props.id || 'generated-1', ...props }),
    beginUndoTransaction: () => { transaction = []; },
    endUndoTransaction: () => { if (transaction?.length) commands.push(transaction); transaction = null; },
    recordAdd: (annotation) => transaction.push({ op: 'create', id: annotation.id }),
    recordModify: (id, before, after) => transaction.push({ op: 'update', id, before, after }),
    recordDelete: (annotation) => transaction.push({ op: 'delete', id: annotation.id }),
    redraw: () => {},
  };
  return { doc, host, commands };
}

test('batch creates, updates and deletes in one document mutation', () => {
  const { doc, host, commands } = fixture();
  const result = applyAnnotationBatch(doc, [
    { op: 'create', annotation: { id: 'door-1', type: 'door', page: 1, x: 15, y: 20 } },
    { op: 'update', id: 'wall-1', changes: { width: 60 } },
    { op: 'delete', id: 'door-1' },
  ], host);
  assert.deepEqual(result, { createdIds: ['door-1'], updatedIds: ['wall-1'], deletedIds: ['door-1'] });
  assert.deepEqual(doc.annotations.map(({ id, width }) => ({ id, width })), [{ id: 'wall-1', width: 60 }]);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].length, 3);
});

test('invalid later operation leaves the document and undo history untouched', () => {
  const { doc, host, commands } = fixture();
  const before = structuredClone(doc.annotations);
  assert.throws(() => applyAnnotationBatch(doc, [
    { op: 'create', annotation: { id: 'door-1', type: 'door', page: 1, x: 15, y: 20 } },
    { op: 'update', id: 'missing', changes: { x: 99 } },
  ], host), /missing/);
  assert.deepEqual(doc.annotations, before);
  assert.equal(commands.length, 0);
});

test('batch rejects duplicate ids, invalid pages and unsavable values', () => {
  const { doc, host } = fixture();
  assert.throws(() => applyAnnotationBatch(doc, [
    { op: 'create', annotation: { id: 'wall-1', type: 'wall', page: 1 } },
  ], host), /duplicate/i);
  assert.throws(() => applyAnnotationBatch(doc, [
    { op: 'create', annotation: { id: 'door-2', type: 'door', page: 3 } },
  ], host), /page/i);
  assert.throws(() => applyAnnotationBatch(doc, [
    { op: 'create', annotation: { id: 'door-2', type: 'door', page: 1, x: Infinity } },
  ], host), /finite|serializ/i);
});

test('batch requires a loaded page before inserting persistent annotations', () => {
  const { doc, host, commands } = fixture();
  delete doc.numPages;
  doc.pdfDoc = { numPages: 2 };
  doc._annotationPagesReady = new Set();
  assert.throws(() => applyAnnotationBatch(doc, [
    { op: 'create', annotation: { id: 'grid-1', type: 'ceilingGrid', page: 1 } },
  ], host), /not ready/);
  assert.equal(doc.annotations.length, 1);
  assert.equal(commands.length, 0);
  doc._annotationPagesReady.add(1);
  applyAnnotationBatch(doc, [
    { op: 'create', annotation: { id: 'grid-1', type: 'ceilingGrid', page: 1 } },
  ], host);
  assert.equal(doc.annotations.length, 2);
});

test('factory defaults with undefined fields are permitted and omitted on save', () => {
  const { doc, host } = fixture();
  host.createAnnotation = props => ({ icon: undefined, ...props });
  applyAnnotationBatch(doc, [
    { op: 'create', annotation: { id: 'grid-1', type: 'ceilingGrid', page: 1 } },
  ], host);
  assert.equal(doc.annotations[1].id, 'grid-1');
});
