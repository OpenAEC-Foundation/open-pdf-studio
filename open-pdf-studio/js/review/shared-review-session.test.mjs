import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('../core/app-test-hooks.mjs', import.meta.url, {
  data: { extraStubs: [
    '/js/core/state.ts', '/js/core/preferences.js', '/js/core/platform.js',
    '/js/review/shared-review-status.js', '/js/annotations/xfdf.js',
  ] },
});
const { state } = await import('../core/state.js');
const {
  startSharedReview, stopSharedReview, refreshSharedReview, publishSharedReview, sharedReviewInfo,
} = await import('./shared-review-service.js');

test('a disappearing file is retried and a replaced review cannot publish to the old folder', async () => {
  const doc = { id: 1, filePath: 'C:/project/plan.pdf', annotations: [] };
  Object.assign(state, { documents: [doc], activeDocumentIndex: 0, preferences: {} });
  let files = [];
  let contents = '';
  let nextList;
  const writes = [];
  const statuses = [];
  globalThis.__nep = {
    isTauri: () => true,
    setReviewStatus: (_path, status) => statuses.push(status),
    invoke: async (name, args) => {
      if (name === 'shared_review_list') {
        const pending = nextList;
        nextList = null;
        await pending;
        return files;
      }
      if (name === 'shared_review_read') return contents;
      if (name === 'shared_review_write') { writes.push(args); return; }
      throw new Error(name);
    },
  };
  await startSharedReview(doc);
  try {
    files = [{ name: 'plan_Annotation_Alice.jsonl', size: 2, mtimeMs: 4 }];
    await refreshSharedReview(doc);
    assert.equal(sharedReviewInfo(doc).error, 'READ_FAILED');
    contents = '{}';
    await refreshSharedReview(doc);
    assert.equal(sharedReviewInfo(doc).error, null);

    let release;
    nextList = new Promise(resolve => { release = resolve; });
    const oldPublish = publishSharedReview(doc);
    await new Promise(resolve => setImmediate(resolve));
    stopSharedReview(doc);
    await startSharedReview(doc, { folder: 'C:/review/new' });
    release();
    await oldPublish;
    assert.deepEqual(writes, []);
    assert.ok(statuses.at(-1));
  } finally {
    stopSharedReview(doc);
  }
});
