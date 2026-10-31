// Render scheduler (#506): renders of a document that is closed or no longer
// shown must not hold up the page of the document that is shown now. Fake
// workers with controllable promises; no timers.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RENDER_PRIORITY,
  RenderCancelledError,
  createRenderQueue,
  documentShown,
  isRenderCancelled,
} from './render-queue.js';
import { createSceneAttemptCoordinator } from './progressive-render.js';

const { PAGE, TILE, PREFETCH } = RENDER_PRIORITY;

/** Lets the scheduler's promise callbacks run. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/**
 * Fake PDFium pool: every started render is recorded and waits until the test
 * finishes it. The "bitmap" is an object that counts whether it was freed.
 */
function fakeWorkers() {
  const started = [];
  const freed = [];
  const job = (label) => () => new Promise((resolve, reject) => {
    started.push({
      label,
      finish: () => resolve({ label, close: () => freed.push(label) }),
      fail: (error) => reject(error),
    });
  });
  const find = (label) => {
    const s = started.find((x) => x.label === label);
    assert.ok(s, `${label} was started`);
    return s;
  };
  return { started, freed, job, find, labels: () => started.map((s) => s.label) };
}

/** The shown document is whatever `view.shown` says. */
function setup(options = {}) {
  const view = { shown: 'A.pdf' };
  const queue = createRenderQueue({
    isDocumentShown: (doc) => doc === view.shown,
    ...options,
  });
  const workers = fakeWorkers();
  // A fake canvas: what a render callback draws, guarded like the callers do
  // (they only draw a bitmap they actually received).
  const canvas = { drawn: [] };
  const request = (label, docKey, priority, extra = {}) => {
    const outcome = { label, value: null, error: null };
    outcome.promise = queue.schedule(workers.job(label), {
      docKey, priority, dispose: (bmp) => bmp?.close?.(), ...extra,
    }).then(
      (bmp) => { outcome.value = bmp; canvas.drawn.push(bmp.label); },
      (error) => { outcome.error = error; },
    );
    return outcome;
  };
  return { view, queue, workers, canvas, request };
}

test('at most four renders are with the workers; the rest wait in the scheduler', async () => {
  const { queue, workers, request } = setup();
  for (let i = 1; i <= 7; i++) request(`A-tile${i}`, 'A.pdf', TILE);
  await flush();
  assert.deepEqual(workers.labels(), ['A-tile1', 'A-tile2', 'A-tile3', 'A-tile4']);
  assert.deepEqual(queue.stats(), { queued: 3, inFlight: 4, prefetchRunning: 0 });

  workers.find('A-tile1').finish();
  await flush();
  assert.deepEqual(workers.labels().slice(4), ['A-tile5']);
});

test('switching documents mid-queue: stale tiles are dropped and the new page renders first', async () => {
  const { view, queue, workers, canvas, request } = setup();
  const tilesA = [];
  for (let i = 1; i <= 8; i++) tilesA.push(request(`A-tile${i}`, 'A.pdf', TILE));
  await flush();
  assert.equal(workers.started.length, 4);

  // The user opens B: A is hidden from now on.
  view.shown = 'B.pdf';
  queue.activeDocumentChanged();
  const pageB = request('B-page1', 'B.pdf', PAGE);
  const tileB = request('B-tile1', 'B.pdf', TILE);
  await flush();

  // B's page starts at once, although four A tiles still occupy the workers;
  // none of A's queued tiles ever starts.
  assert.deepEqual(workers.labels().slice(4), ['B-page1']);
  for (const t of tilesA.slice(4)) {
    assert.ok(isRenderCancelled(t.error), `${t.label} dropped`);
    assert.ok(t.error instanceof RenderCancelledError);
  }

  workers.find('B-page1').finish();
  await flush();
  assert.deepEqual(canvas.drawn, ['B-page1'], 'the new page is drawn first');

  // The A tiles that were already running finish: their callers get no
  // bitmap (nothing stale is drawn) and the bitmaps are freed.
  for (const t of tilesA.slice(0, 4)) workers.find(t.label).finish();
  await flush();
  for (const t of tilesA.slice(0, 4)) {
    assert.ok(isRenderCancelled(t.error), `${t.label} discarded`);
    assert.equal(t.value, null);
  }
  assert.deepEqual(workers.freed.sort(), ['A-tile1', 'A-tile2', 'A-tile3', 'A-tile4']);

  // B's tile follows once a worker is free.
  assert.ok(workers.labels().includes('B-tile1'));
  workers.find('B-tile1').finish();
  await flush();
  assert.deepEqual(canvas.drawn, ['B-page1', 'B-tile1']);
  assert.equal(tileB.error, null);
  assert.equal(pageB.error, null);
  assert.deepEqual(workers.labels().filter((l) => l.startsWith('A-')), ['A-tile1', 'A-tile2', 'A-tile3', 'A-tile4']);
  assert.deepEqual(queue.stats(), { queued: 0, inFlight: 0, prefetchRunning: 0 });
});

test('within the shown document: visible page, then visible tiles, then prefetch', async () => {
  const { workers, request } = setup();
  for (let i = 1; i <= 4; i++) request(`busy${i}`, 'A.pdf', TILE);
  await flush();
  request('thumb', 'A.pdf', PREFETCH);
  request('tile', 'A.pdf', TILE);
  request('page', 'A.pdf', PAGE);
  await flush();
  // The page uses the reserve for the shown page; the others wait.
  assert.deepEqual(workers.labels().slice(4), ['page']);

  // The page counts towards the four as well: one finished worker is not
  // yet room for more.
  workers.find('busy1').finish();
  await flush();
  assert.deepEqual(workers.labels().slice(5), []);
  workers.find('page').finish();
  await flush();
  assert.deepEqual(workers.labels().slice(5), ['tile']);
  workers.find('busy2').finish();
  await flush();
  assert.deepEqual(workers.labels().slice(6), ['thumb']);
});

test('prefetch never takes every worker', async () => {
  const { workers, request } = setup();
  for (let i = 1; i <= 4; i++) request(`thumb${i}`, 'A.pdf', PREFETCH);
  request('tile', 'A.pdf', TILE);
  await flush();
  assert.deepEqual(workers.labels(), ['thumb1', 'thumb2', 'tile']);
});

test('tiles pinned to one worker go one at a time', async () => {
  const { workers, request } = setup();
  for (let i = 1; i <= 3; i++) request(`pinned${i}`, 'A.pdf', TILE, { group: 'A.pdf|0', groupLimit: 1 });
  request('other', 'A.pdf', TILE);
  await flush();
  assert.deepEqual(workers.labels(), ['pinned1', 'other']);
  workers.find('pinned1').finish();
  await flush();
  assert.deepEqual(workers.labels(), ['pinned1', 'other', 'pinned2']);
});

test('closing a document discards its running renders, also when the file is reopened at once', async () => {
  const { queue, workers, canvas, request } = setup();
  const old = request('A-old', 'A.pdf', PAGE);
  const queuedOld = [];
  for (let i = 1; i <= 6; i++) queuedOld.push(request(`A-tile${i}`, 'A.pdf', TILE));
  await flush();
  queue.releaseDocument('A.pdf');
  await flush();
  for (const t of queuedOld.slice(3)) assert.ok(isRenderCancelled(t.error), `${t.label} dropped`);

  // Reopened: A is shown again; its new render is delivered, the old one not.
  const fresh = request('A-new', 'A.pdf', PAGE);
  await flush();
  workers.find('A-old').finish();
  workers.find('A-new').finish();
  await flush();
  assert.ok(isRenderCancelled(old.error));
  assert.equal(fresh.error, null);
  assert.deepEqual(canvas.drawn, ['A-new']);
  assert.ok(workers.freed.includes('A-old'), 'the stale bitmap is freed');
});

test('a render for a hidden document is refused before it reaches a worker', async () => {
  const { workers, request } = setup();
  const r = request('B-thumb', 'B.pdf', PREFETCH);
  await flush();
  assert.ok(isRenderCancelled(r.error));
  assert.equal(workers.started.length, 0);
});

test('keepWhenHidden delivers to a hidden document, closing still cancels', async () => {
  const { view, queue, workers, request } = setup();
  const kept = request('A-shot', 'A.pdf', TILE, { keepWhenHidden: true });
  const closed = request('A-shot2', 'A.pdf', TILE, { keepWhenHidden: true });
  await flush();
  view.shown = 'B.pdf';
  queue.activeDocumentChanged();
  workers.find('A-shot').finish();
  await flush();
  assert.equal(kept.error, null);
  queue.releaseDocument('A.pdf');
  workers.find('A-shot2').finish();
  await flush();
  assert.ok(isRenderCancelled(closed.error));
});

test('a real failure of the shown document stays a failure', async () => {
  const { workers, request } = setup();
  const r = request('A-page', 'A.pdf', PAGE);
  await flush();
  workers.find('A-page').fail(new Error('worker died'));
  await flush();
  assert.equal(r.error.message, 'worker died');
  assert.equal(isRenderCancelled(r.error), false);
});

test('rapid A -> B -> C switching ends with C rendered and nothing of A or B drawn', async () => {
  const { view, queue, workers, canvas, request } = setup();
  const all = [];
  for (const doc of ['A', 'B', 'C']) {
    view.shown = `${doc}.pdf`;
    queue.activeDocumentChanged();
    all.push(request(`${doc}-page1`, `${doc}.pdf`, PAGE));
    for (let i = 1; i <= 6; i++) all.push(request(`${doc}-tile${i}`, `${doc}.pdf`, TILE));
    await flush();
  }
  // The workers finish in the order they received work.
  for (let round = 0; round < 20 && queue.stats().inFlight > 0; round++) {
    for (const s of workers.started.slice()) s.finish();
    await flush();
  }
  assert.deepEqual(queue.stats(), { queued: 0, inFlight: 0, prefetchRunning: 0 });
  assert.equal(canvas.drawn[0], 'C-page1', 'C\'s page is the first thing drawn');
  assert.ok(canvas.drawn.every((l) => l.startsWith('C-')), `only C drawn: ${canvas.drawn}`);
  assert.equal(canvas.drawn.length, 7, 'C page and all its tiles');
  // At most the four tiles that were already running per earlier document
  // ever reached a worker.
  assert.ok(workers.labels().filter((l) => l.startsWith('B-')).length <= 4);
  for (const r of all.filter((x) => !x.label.startsWith('C-'))) assert.ok(isRenderCancelled(r.error), r.label);
  // Every stale bitmap that did come back was freed.
  const staleFinished = workers.labels().filter((l) => !l.startsWith('C-'));
  assert.deepEqual(workers.freed.sort(), staleFinished.sort());
});

test('only an open tab other than the active one counts as hidden', () => {
  const docs = [
    { filePath: 'A.pdf' },
    { filePath: 'C:/tmp/opds-edit-1.pdf', saveTargetPath: 'B.pdf' },
  ];
  assert.equal(documentShown('A.pdf', docs, 0), true);
  assert.equal(documentShown('C:/tmp/opds-edit-1.pdf', docs, 0), false);
  assert.equal(documentShown('B.pdf', docs, 0), false);
  assert.equal(documentShown('B.pdf', docs, 1), true);
  assert.equal(documentShown('A.pdf', docs, 1), false);
  // A file no tab uses (preview, compare source, a file being opened).
  assert.equal(documentShown('elsewhere.pdf', docs, 0), true);
  assert.equal(documentShown('A.pdf', [], -1), true);
  // Two tabs on the same file: shown when either is active.
  assert.equal(documentShown('A.pdf', [{ filePath: 'A.pdf' }, { filePath: 'A.pdf' }], 1), true);
});

test('a cancelled scene tile does not mark the page as unfit for the scene engine', async () => {
  const coordinator = createSceneAttemptCoordinator();
  const failures = [];
  const cancelled = () => Promise.reject(new RenderCancelledError());
  await assert.rejects(
    coordinator.tryRegion('A|0|0', {}, cancelled, (e) => failures.push(e)),
    (e) => isRenderCancelled(e),
  );
  assert.deepEqual(failures, []);
  // The next attempt still goes to the scene engine.
  const value = await coordinator.tryRegion('A|0|0', {}, async () => 'scene', (e) => failures.push(e));
  assert.equal(value, 'scene');
  // Also once the scene is known to work.
  await assert.rejects(
    coordinator.tryRegion('A|0|0', {}, cancelled, (e) => failures.push(e)),
    (e) => isRenderCancelled(e),
  );
  assert.equal(await coordinator.tryRegion('A|0|0', {}, async () => 'again', () => {}), 'again');
  assert.deepEqual(failures, []);
});
