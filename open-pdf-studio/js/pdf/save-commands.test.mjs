import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('../core/app-test-hooks.mjs', import.meta.url, {
  data: { extraStubs: ['/js/core/state.ts', '/js/pdf/saver.js'] },
});
const { savePDF, savePDFAs } = await import('./save-commands.js');

test('first Save and Save As retain the tab selected before asynchronous loading', async () => {
  const first = { id: 'first' }, second = { id: 'second' };
  let active = first;
  const calls = [];
  globalThis.__nep = {
    getActiveDocument: () => active,
    savePDF: (...args) => { calls.push(['save', ...args]); return true; },
    savePDFAs: (...args) => { calls.push(['save-as', ...args]); return false; },
  };
  const save = savePDF();
  const saveAs = savePDFAs();
  active = second;
  assert.equal(await save, true);
  assert.equal(await saveAs, false);
  assert.deepEqual(calls, [['save', null, {}, first], ['save-as', first, null, {}]]);
});

test('explicit document, path and cancellation options reach the saver unchanged', async () => {
  const doc = { id: 'explicit' }, options = { annulering: {}, zonderHandtekeningVraag: true };
  const calls = [];
  globalThis.__nep = {
    getActiveDocument: () => { throw new Error('must not resolve an explicit document again'); },
    savePDF: (...args) => { calls.push(args); return false; },
    savePDFAs: (...args) => { calls.push(args); return true; },
  };
  assert.equal(await savePDF('/copy.pdf', options, doc), false);
  assert.equal(await savePDFAs(doc, '/as.pdf', options), true);
  assert.deepEqual(calls, [['/copy.pdf', options, doc], [doc, '/as.pdf', options]]);
  assert.equal(calls[0][1], options);
  assert.equal(calls[1][2], options);
});

test('save rejection propagates, and a later attempt still runs', async () => {
  const error = new Error('write failed');
  globalThis.__nep = { savePDF: () => { throw error; } };
  await assert.rejects(savePDF(null, {}, { id: 'doc' }), e => e === error);
  globalThis.__nep.savePDF = () => true;
  assert.equal(await savePDF(null, {}, { id: 'doc' }), true);
});
