// Pure tests for shared-session persistence.
//
// The OPFS calls themselves need a browser, so the logic that decides WHAT to
// store, what is safe to restore, and what to sweep is kept separate and
// tested here. Those are the parts that can silently lose someone's work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidKey, snapshotFromDocument, isRestorable, keysToPrune, countByAuthor,
  MAX_SNAPSHOT_AGE_MS,
} from './session-persistence.js';

const CODE = 'G9R5PXV02Y7SD09FGC9J52';

test('only relay-shaped codes may become file names', () => {
  assert.equal(isValidKey(CODE), true);
  // The alphabet excludes I, L, O and U, and the key reaches a path.
  assert.equal(isValidKey('../../etc/passwd'), false);
  assert.equal(isValidKey('has/slash'), false);
  assert.equal(isValidKey('has.dot'), false);
  assert.equal(isValidKey('lowercase'), false);
  assert.equal(isValidKey(''), false);
  assert.equal(isValidKey(null), false);
  assert.equal(isValidKey('SHORT'), false, 'too short to be a session code');
});

test('a snapshot carries what a reload needs and nothing more', () => {
  const doc = {
    fileName: 'A-01.pdf', isUntitled: true, currentPage: 2, undoFloor: 40,
    pageDims: { 1: { widthPt: 1224, heightPt: 792 } },
    annotations: [{ id: 'a1', type: 'box', author: 'Grok' }],
    pdfDoc: { huge: true },        // must not be serialised
    undoStack: [{ type: 'add' }],  // rebuilt empty on restore
  };
  const s = snapshotFromDocument(doc);

  assert.equal(s.fileName, 'A-01.pdf');
  assert.equal(s.currentPage, 2);
  assert.equal(s.undoFloor, 40, 'a committed batch must stay committed');
  assert.deepEqual(s.pageDims, doc.pageDims);
  assert.equal(s.annotations.length, 1);
  assert.equal('pdfDoc' in s, false, 'the pdf.js handle is not serialisable');
  assert.equal('undoStack' in s, false);
  assert.ok(Number.isFinite(s.savedAt));

  // It has to survive a JSON round trip — that is how it is stored.
  assert.deepEqual(JSON.parse(JSON.stringify(s)).annotations, s.annotations);
});

test('snapshotFromDocument tolerates a half-built document', () => {
  const s = snapshotFromDocument({});
  assert.deepEqual(s.annotations, []);
  assert.equal(s.undoFloor, 0);
  assert.equal(s.currentPage, 1);
  assert.equal(snapshotFromDocument(null), null);
});

test('a snapshot from a future version is not restored', () => {
  // Restoring a shape this build does not understand is worse than starting
  // clean: it would half-apply and look like corruption.
  const good = snapshotFromDocument({ annotations: [] });
  assert.equal(isRestorable(good), true);
  assert.equal(isRestorable({ ...good, version: 999 }), false);
  assert.equal(isRestorable({ ...good, version: undefined }), false);
});

test('a torn or empty snapshot reads as nothing to restore', () => {
  assert.equal(isRestorable(null), false);
  assert.equal(isRestorable('{'), false);
  assert.equal(isRestorable({ version: 1 }), false, 'no annotations array');
  assert.equal(isRestorable({ version: 1, annotations: [] }), false, 'no savedAt');
  assert.equal(isRestorable({ version: 1, annotations: {}, savedAt: 1 }), false);
});

test('the live session is never pruned, however old', () => {
  const ancient = Date.now() - MAX_SNAPSHOT_AGE_MS * 10;
  const doomed = keysToPrune([{ key: CODE, savedAt: ancient }], CODE);
  assert.deepEqual(doomed, [], 'the session in use must survive its own sweep');
});

test('old and unreadable snapshots are swept', () => {
  const now = Date.now();
  const entries = [
    { key: CODE, savedAt: now },
    { key: 'AAAAAAAAAAAAAAAAAAAAAA', savedAt: now - 1000 },                    // recent
    { key: 'BBBBBBBBBBBBBBBBBBBBBB', savedAt: now - MAX_SNAPSHOT_AGE_MS - 1 }, // stale
    { key: 'CCCCCCCCCCCCCCCCCCCCCC', savedAt: NaN },                           // unreadable
  ];
  assert.deepEqual(
    keysToPrune(entries, CODE, now).sort(),
    ['BBBBBBBBBBBBBBBBBBBBBB', 'CCCCCCCCCCCCCCCCCCCCCC'],
  );
});

test('the restore summary splits the agent\'s work from the person\'s', () => {
  const annotations = [
    { id: '1', author: 'Grok' },
    { id: '2', author: 'Grok' },
    { id: '3', author: 'Ivan' },
    { id: '4' }, // pre-attribution annotation from an opened document
  ];
  const counts = countByAuthor(annotations, 'Grok');

  assert.equal(counts.agent, 2);
  assert.equal(counts.person, 2, 'unattributed marks count as the person\'s');
  assert.equal(counts.total, 4);
});

test('countByAuthor handles an empty or missing list', () => {
  assert.deepEqual(countByAuthor([], 'Grok'), { agent: 0, person: 0, total: 0 });
  assert.deepEqual(countByAuthor(null, 'Grok'), { agent: 0, person: 0, total: 0 });
});
