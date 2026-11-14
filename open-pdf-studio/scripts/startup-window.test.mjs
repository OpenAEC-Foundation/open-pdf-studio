import assert from 'node:assert/strict';
import test from 'node:test';
import { revealStartupWindow } from '../js/core/startup-window.js';

function fixture(ready = Promise.resolve()) {
  const events = [];
  return {
    events,
    host: { __TAURI__: { core: { invoke: async cmd => { events.push(cmd); if (cmd === 'startup_font_deadline') await new Promise(resolve => setTimeout(resolve, 5)); } } } },
    doc: { fonts: { ready }, getElementById: () => ({ getBoundingClientRect: () => events.push('layout') }) },
  };
}
test('waits for fonts and final layout before native reveal without rAF', async () => {
  let resolve;
  const f = fixture(new Promise(r => { resolve = r; }));
  const task = revealStartupWindow(f);
  assert.deepEqual(f.events, ['layout', 'startup_font_deadline']);
  resolve();
  await task;
  assert.deepEqual(f.events, ['layout', 'startup_font_deadline', 'layout', 'startup_window_ready']);
});
test('stalled fonts cannot prevent reveal', async () => {
  const f = fixture(new Promise(() => {}));
  await revealStartupWindow(f);
  assert.equal(f.events.at(-1), 'startup_window_ready');
});
test('failed fonts cannot prevent reveal', async () => {
  const f = fixture(Promise.reject(new Error('font failed')));
  await revealStartupWindow(f);
  assert.equal(f.events.at(-1), 'startup_window_ready');
});
for (const mode of ['browser', 'mobile', 'headless']) {
  test(`${mode} keeps its existing visibility policy`, async () => {
    const f = fixture();
    if (mode === 'browser') delete f.host.__TAURI__;
    if (mode === 'headless') f.host.__OPDS_HEADLESS__ = true;
    await revealStartupWindow({ ...f, mobile: mode === 'mobile' });
    assert.deepEqual(f.events, []);
  });
}
test('failed native IPC does not block command-line document loading', async t => {
  t.mock.method(console, 'warn', () => {});
  const f = fixture();
  f.host.__TAURI__.core.invoke = async () => { throw new Error('IPC failed'); };
  await assert.doesNotReject(revealStartupWindow(f));
});

for (const fonts of ['ready', 'stalled']) {
  test(`hidden WebView with suspended JS timers still reveals (${fonts} fonts)`, async t => {
    const { setTimeout: deadline } = await import('node:timers');
    // This models a hidden WebView suspending timeout callbacks. The native
    // deadline reply remains an IPC event, independent of those JS timers.
    t.mock.method(globalThis, 'setTimeout', () => 0);
    t.mock.method(globalThis, 'clearTimeout', () => {});
    const f = fixture(fonts === 'ready' ? Promise.resolve() : new Promise(() => {}));
    f.host.__TAURI__.core.invoke = async cmd => { f.events.push(cmd); };
    const completed = await Promise.race([
      revealStartupWindow(f).then(() => true),
      new Promise(resolve => deadline(() => resolve(false), 50)),
    ]);
    assert.equal(completed, true, 'normal reveal must not depend on a JS timer firing');
    assert.equal(f.events.at(-1), 'startup_window_ready');
  });
}
