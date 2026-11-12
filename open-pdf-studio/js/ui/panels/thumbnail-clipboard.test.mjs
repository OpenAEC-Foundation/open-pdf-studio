import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThumbnailClipboardHandler } from './thumbnail-clipboard.js';

function setup() {
  const calls = [];
  const env = {
    doc: { pdfDoc: {}, currentPage: 2 }, selection: [1, 3], readOnly: false, enabled: true,
    manager: { copyPages: async pages => calls.push(['copy', pages]),
      pastePage: async page => calls.push(['paste', page]), getPageClipboard: () => ({ bytes: [1] }) },
  };
  env.load = async () => env.manager;
  const handle = createThumbnailClipboardHandler({ getDocument: () => env.doc,
    getSelection: () => env.selection, loadManager: () => env.load(),
    isReadOnly: () => env.readOnly, shortcutEnabled: () => env.enabled });
  return { env, calls, handle };
}
function event(key, extra = {}) {
  return { key, ctrlKey: true, target: { tagName: 'DIV' },
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
}

test('copy captures selection and consumes key synchronously before annotation shortcuts', async () => {
  const { handle, calls, env } = setup();
  const e = event('C'); const pending = handle(e);
  assert.equal(e.prevented, true); assert.equal(e.stopped, true);
  env.selection = [2]; await pending;
  assert.deepEqual(calls, [['copy', [1, 3]]]);
});
test('paste after last selected page, or current page when selection is empty', async () => {
  const { handle, calls, env } = setup();
  await handle(event('v')); env.selection = []; await handle(event('v', { ctrlKey: false, metaKey: true }));
  assert.deepEqual(calls, [['paste', 3], ['paste', 2]]);
});
test('text controls, modified combinations, composition and disabled bindings retain their keys', () => {
  const { handle, calls, env } = setup();
  for (const extra of [{target:{tagName:'INPUT'}}, {target:{tagName:'TEXTAREA'}},
    {target:{tagName:'SELECT'}}, {target:{isContentEditable:true}}, {shiftKey:true},
    {altKey:true}, {ctrlKey:false}, {isComposing:true}, {defaultPrevented:true}]) {
    const e = event('v', extra); assert.equal(handle(e), false); assert.equal(e.prevented, undefined);
  }
  env.enabled = false; assert.equal(handle(event('c')), false);
  assert.deepEqual(calls, []);
});
test('read-only destination, empty clipboard and repeated keys do not paste annotations or pages', async () => {
  const { handle, calls, env } = setup();
  env.readOnly = true; const locked = event('v'); await handle(locked); assert.equal(locked.stopped, true);
  await handle(event('c'));
  env.readOnly = false; env.manager.getPageClipboard = () => null;
  const empty = event('v'); await handle(empty); assert.equal(empty.stopped, true);
  await handle(event('c', {repeat:true})); assert.deepEqual(calls, [['copy', [1, 3]]]);
});
test('concurrent requests are consumed; switching or closing a document during import cancels operation', async () => {
  for (const change of [env => { env.doc = {pdfDoc:{}}; }, env => { env.doc.pdfDoc = null; }]) {
    const {handle, calls, env} = setup(); let release;
    env.load = () => new Promise(resolve => {release=resolve;});
    const pending = handle(event('v')); const second = event('v'); await handle(second);
    assert.equal(second.stopped, true); change(env); release(env.manager); await pending;
    assert.deepEqual(calls, []);
  }
});
test('read-only is checked again after import and errors release the busy guard', async () => {
  const {handle, calls, env} = setup();
  env.load = async () => {env.readOnly=true; return env.manager;};
  await handle(event('v')); assert.deepEqual(calls, []);
  env.load = async () => {throw new Error('load failed');};
  await assert.rejects(handle(event('c')), /load failed/);
  env.load = async () => env.manager; await handle(event('c'));
  assert.deepEqual(calls, [['copy', [1, 3]]]);
});
