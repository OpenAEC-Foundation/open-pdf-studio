import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { startPrintQueueWatcher, stopPrintQueueWatcher, printQueueJobs } from './printQueueStore.js';

function desktop(t, initial = [], existing = false) {
  const previousWindow = globalThis.window;
  const state = { list: initial, installed: true, created: [], shown: 0, focused: 0, commands: [], tick: null };
  const queueWindow = { show: async () => { state.shown++; }, setFocus: async () => { state.focused++; } };
  class WebviewWindow {
    static async getByLabel(label) { assert.equal(label, 'print-queue'); return existing ? queueWindow : null; }
    constructor(label, options) { state.created.push({ label, options }); }
    once() {}
  }
  globalThis.window = { __TAURI__: {
    webviewWindow: { WebviewWindow },
    core: { invoke: async (command) => {
      state.commands.push(command);
      if (command === 'is_virtual_printer_installed') return state.installed;
      if (command === 'virtual_printer_collect') return false;
      if (command === 'virtual_printer_jobs') return state.list;
      throw new Error(`Unexpected command ${command}`);
    } },
  } };
  t.mock.method(globalThis, 'setInterval', (tick, ms) => {
    assert.equal(ms, 2500); state.tick = tick; return 123;
  });
  t.mock.method(globalThis, 'clearInterval', () => { state.tick = null; });
  t.after(() => { stopPrintQueueWatcher(); globalThis.window = previousWindow; });
  return state;
}

const oldJob = { file: 'job_100.pdf', path: 'fixture/job_100.pdf', pages: 1 };

test('startup presents jobs captured while the app was closed', async (t) => {
  const state = desktop(t, [oldJob]);
  await startPrintQueueWatcher();
  assert.equal(state.created.length, 1);
  assert.equal(state.created[0].options.url, 'index.html?view=printqueue');
  assert.deepEqual(printQueueJobs(), [oldJob]);
  assert.deepEqual(state.commands, ['is_virtual_printer_installed', 'virtual_printer_collect', 'virtual_printer_jobs']);
});

test('startup focuses an existing queue window instead of creating another', async (t) => {
  const state = desktop(t, [oldJob], true);
  await startPrintQueueWatcher();
  assert.equal(state.created.length, 0);
  assert.equal(state.shown, 1);
  assert.equal(state.focused, 1);
});

test('an empty queue or missing printer does not open a window', async (t) => {
  const state = desktop(t);
  state.installed = false;
  await startPrintQueueWatcher();
  assert.equal(state.tick, null);
  state.installed = true;
  await startPrintQueueWatcher();
  assert.equal(state.created.length, 0);
  assert.ok(state.tick);
});

test('acknowledged startup jobs do not reopen every poll; new jobs still do', async (t) => {
  const state = desktop(t, [oldJob]);
  await startPrintQueueWatcher();
  assert.equal(state.created.length, 1);
  state.tick();
  await setImmediate();
  assert.equal(state.created.length, 1);
  state.list = [oldJob, { ...oldJob, file: 'job_200.pdf' }];
  state.tick();
  await setImmediate();
  assert.equal(state.created.length, 2);
  assert.equal(printQueueJobs().length, 2);
});

test('restarting the watcher presents still-pending jobs once again', async (t) => {
  const state = desktop(t, [oldJob]);
  await startPrintQueueWatcher();
  await startPrintQueueWatcher();
  assert.equal(state.created.length, 1);
  stopPrintQueueWatcher();
  await startPrintQueueWatcher();
  assert.equal(state.created.length, 2);
  assert.ok(state.commands.every(c => !c.includes('delete')));
});
