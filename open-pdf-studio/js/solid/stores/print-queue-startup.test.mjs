import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { startPrintQueueWatcher, stopPrintQueueWatcher, printQueueJobs } from './printQueueStore.js';

function desktop(t, initial = [], existing = false) {
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.localStorage;
  const leeg = new Map();
  globalThis.localStorage = {
    getItem: (k) => (leeg.has(k) ? leeg.get(k) : null),
    setItem: (k, v) => { leeg.set(k, String(v)); },
    removeItem: (k) => { leeg.delete(k); },
    clear: () => { leeg.clear(); },
  };
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
  t.after(() => {
    stopPrintQueueWatcher();
    globalThis.window = previousWindow;
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  });
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
  // Zonder herinnering (opslag gewist) toont een herstart ze opnieuw; met
  // herinnering niet, zie de tests hieronder.
  globalThis.localStorage.clear();
  await startPrintQueueWatcher();
  assert.equal(state.created.length, 2);
  assert.ok(state.commands.every(c => !c.includes('delete')));
});

// ── remembered across app starts (print-queue-presented.js) ─────────────

function withStorage(state) {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
  };
  // core/opslag.js zet de sleutel van de module met het voorvoegsel 'opds:';
  // de tests lezen hem onder de naam van de module.
  return { get: (naam) => map.get(`opds:${naam}`) };
}

test('a job presented in an earlier session does not pop the window at start', async (t) => {
  const state = desktop(t, [oldJob]);
  withStorage(state);
  await startPrintQueueWatcher();
  assert.equal(state.created.length, 1);
  // Next app start: the job is still in the spool (e.g. opened in Studio).
  stopPrintQueueWatcher();
  await startPrintQueueWatcher();
  assert.equal(state.created.length, 1);
});

test('a job caught while the app was closed pops the window next to presented ones', async (t) => {
  const state = desktop(t, [oldJob]);
  withStorage(state);
  await startPrintQueueWatcher();
  stopPrintQueueWatcher();
  state.list = [oldJob, { ...oldJob, file: 'job_300.pdf' }];
  await startPrintQueueWatcher();
  assert.equal(state.created.length, 2);
  assert.equal(printQueueJobs().length, 2);
});

test('jobs that left the spool are forgotten; new polls still present new jobs', async (t) => {
  const state = desktop(t, [oldJob]);
  const map = withStorage(state);
  await startPrintQueueWatcher();
  state.list = [];
  state.tick();
  await setImmediate();
  assert.equal(map.get('opds.printQueue.presented'), '[]');
  state.list = [{ ...oldJob, file: 'job_400.pdf' }];
  state.tick();
  await setImmediate();
  assert.equal(state.created.length, 2);
  assert.equal(map.get('opds.printQueue.presented'), '["job_400.pdf"]');
});

test('when the window cannot be created the jobs are presented again next start', async (t) => {
  const state = desktop(t, [oldJob]);
  withStorage(state);
  const W = globalThis.window.__TAURI__.webviewWindow;
  const Original = W.WebviewWindow;
  W.WebviewWindow = class extends Original { constructor() { throw new Error('no window'); } };
  t.mock.method(console, 'warn', () => {});
  await startPrintQueueWatcher();
  stopPrintQueueWatcher();
  W.WebviewWindow = Original;
  await startPrintQueueWatcher();
  assert.equal(state.created.length, 1);
});

test('a failed sweep keeps the remembered jobs', async (t) => {
  const state = desktop(t, [oldJob]);
  const map = withStorage(state);
  await startPrintQueueWatcher();
  const remembered = map.get('opds.printQueue.presented');
  const invoke = globalThis.window.__TAURI__.core.invoke;
  globalThis.window.__TAURI__.core.invoke = async (c) => {
    if (c === 'virtual_printer_jobs') throw new Error('io');
    return invoke(c);
  };
  state.tick();
  await setImmediate();
  assert.equal(map.get('opds.printQueue.presented'), remembered);
});

test('concurrent starts share one poll timer and one window', async (t) => {
  const state = desktop(t, [oldJob]);
  let timers = 0;
  t.mock.method(globalThis, 'setInterval', (tick) => { timers++; state.tick = tick; return 7; });
  await Promise.all([startPrintQueueWatcher(), startPrintQueueWatcher()]);
  assert.equal(timers, 1);
  assert.equal(state.created.length, 1);
});
