// Browser regression for #1022: real stamp manager, confirmation and message dialogs.
// Uses an isolated browser profile and ephemeral Vite server; no native file/printer calls.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = await mkdtemp(path.join(tmpdir(), 'opds-dialog-test-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { waitUntil: 'load' });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  // Let initial dependency optimization finish before importing app modules.
  await page.evaluate(async () => {
    const { openDialog } = await import('/js/solid/stores/dialogStore.js');
    openDialog('stamp-templates');
  });
  const manager = page.locator('.stamp-templates-dialog');
  await manager.waitFor();
  const buttons = manager.locator('.stamp-templates-side-buttons button');
  await buttons.nth(1).click(); // Duplicate a built-in into this disposable profile.
  await buttons.nth(2).waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelectorAll('.stamp-templates-side-buttons button')[2].disabled);
  await buttons.nth(2).click();
  const confirm = page.locator('.confirm-dialog');
  await confirm.waitFor();
  async function assertFront(locator, message) {
    const front = await locator.evaluate(el => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    });
    assert.equal(front, true, message);
  }
  await assertFront(confirm, 'delete confirmation must receive pointer input above the stamp manager');
  await confirm.locator('.confirm-dialog-btn-no').click();
  assert.equal(await manager.count(), 1, 'cancel keeps the manager open');
  await buttons.nth(2).click();
  await assertFront(confirm, 'reopened confirmation remains in front');
  await confirm.locator('.confirm-dialog-btn-yes').click();
  await confirm.waitFor({ state: 'detached' });
  assert.equal(await manager.count(), 1, 'deleting does not require closing the manager');
  // The import success/failure handlers use this exact message path.
  for (const text of ['Imported fixture', 'Invalid fixture']) {
    await page.evaluate(async message => {
      const { showMessage } = await import('/js/solid/stores/dialogStore.js');
      showMessage(message, 'Stamp import');
    }, text);
    const message = page.locator('.message-dialog');
    await message.waitFor();
    await assertFront(message, 'import result must receive pointer input above the stamp manager');
    await message.locator('.message-dialog-footer button').click();
    await message.waitFor({ state: 'detached' });
  }
  await buttons.nth(1).click();
  await page.waitForFunction(() => !document.querySelectorAll('.stamp-templates-side-buttons button')[2].disabled);
  await buttons.nth(2).click();
  await confirm.waitFor();
  await page.keyboard.press('Escape');
  await confirm.waitFor({ state: 'detached' });
  assert.equal(await manager.count(), 1, 'Escape closes only the top dialog');
  await assertFront(manager, 'manager becomes reachable after the child closes');
  await page.keyboard.press('Escape');
  await manager.waitFor({ state: 'detached' });
  console.log('PASS: delete cancel/accept, repeat open, import messages, Escape and parent recovery');
} finally {
  await browser?.close();
  await server.close();
  await rm(cache, { recursive: true, force: true });
}
