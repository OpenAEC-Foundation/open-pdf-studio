import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
window.location = { search: '' };
const platform = await import('../core/platform.js');
const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' });

test('desktop screenshot copies after async rendering even when browser image writes are denied', async () => {
  const native = [];
  window.__TAURI__ = { os: { type: () => 'linux' }, core: { invoke: async (...args) => { native.push(args); } } };
  let overlay = 0, status = 0;
  const source = readFileSync(new URL('./screenshot.js', import.meta.url), 'utf8');
  const body = source.match(/export async function kopieerSchermafbeelding\(gebied, dpi\) \{([\s\S]*?)\n\}/)[1];
  // Execute the actual action; only rendering and status/overlay UI are stubs.
  const copy = new Function('renderSchermafbeelding', '_blob', 'writeClipboardPng', 'navigator', 'ClipboardItem', '_bewaarVoorOverlay', 'updateStatusMessage', 'i18next',
    `return async (gebied, dpi) => {${body}}`)(
    async () => { await Promise.resolve(); return { canvas: {}, paginaCanvas: {}, maat: { breedte: 2, hoogte: 1, dpi: 300 } }; },
    async () => png, platform.writeClipboardPng,
    { clipboard: { write: async () => { throw new DOMException('User activation expired', 'NotAllowedError'); } } },
    class { constructor(data) { this.data = data; } },
    () => overlay++, () => status++, { t: () => 'copied' });
  assert.deepEqual(await copy({}, 300), { breedte: 2, hoogte: 1, dpi: 300 });
  assert.equal(native.length, 1);
  assert.equal(native[0][0], 'plugin:clipboard-manager|write_image');
  assert.deepEqual(Array.from(native[0][1].image), Array.from(new Uint8Array(await png.arrayBuffer())));
  assert.equal(overlay, 1);
  assert.equal(status, 1);
  window.__TAURI__.core.invoke = async () => { throw new Error('Clipboard busy'); };
  await assert.rejects(() => copy({}, 300), /Clipboard busy/);
  assert.equal(overlay, 1, 'failed copy must not update the overlay');
  assert.equal(status, 1, 'failed copy must not report success');
});

test('native clipboard failure propagates without falling back to the blocked web API', async () => {
  const denied = new Error('Clipboard unavailable');
  window.__TAURI__ = { core: { invoke: async () => { throw denied; } } };
  await assert.rejects(() => platform.writeClipboardPng(png), error => error === denied);
});

test('browser keeps the PNG ClipboardItem route and propagates browser errors', async () => {
  delete window.__TAURI__;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousItem = globalThis.ClipboardItem;
  const writes = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { write: async items => { writes.push(items); } } } });
  globalThis.ClipboardItem = class { constructor(data) { this.data = data; } };
  try {
    await platform.writeClipboardPng(png);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0].data['image/png'], png);
    const denied = new DOMException('Denied', 'NotAllowedError');
    navigator.clipboard.write = async () => { throw denied; };
    await assert.rejects(() => platform.writeClipboardPng(png), error => error === denied);
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
    if (previousItem === undefined) delete globalThis.ClipboardItem;
    else globalThis.ClipboardItem = previousItem;
  }
});

test('image writes are granted only in desktop capability, without clipboard reads', () => {
  const load = file => JSON.parse(readFileSync(new URL(`../../src-tauri/capabilities/${file}.json`, import.meta.url)));
  const desktop = load('default'), mobile = load('mobile');
  assert.ok(desktop.permissions.includes('clipboard-manager:allow-write-image'));
  assert.deepEqual(desktop.platforms, ['linux', 'macOS', 'windows']);
  assert.ok(!mobile.permissions.some(p => p.startsWith('clipboard-manager:')));
  assert.ok(!desktop.permissions.some(p => /^clipboard-manager:(default|allow-read)/.test(p)));
});

test('mobile Tauri keeps browser image writes instead of invoking the unsupported native command', async () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousItem = globalThis.ClipboardItem;
  let writes = 0;
  window.__TAURI__ = { os: { type: () => 'android' }, core: { invoke: () => assert.fail('native mobile image write') } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { write: async () => { writes++; } } } });
  globalThis.ClipboardItem = class {};
  try {
    // Fresh platform detection, like starting the app on a different OS.
    const mobile = await import('../core/platform.js?mobile-clipboard-test');
    await mobile.writeClipboardPng(png);
    assert.equal(writes, 1);
  } finally {
    delete window.__TAURI__;
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
    if (previousItem === undefined) delete globalThis.ClipboardItem;
    else globalThis.ClipboardItem = previousItem;
  }
});
