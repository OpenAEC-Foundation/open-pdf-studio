import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-mcp-schedule-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error',
  server: { host: '127.0.0.1', port: 18353, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  const results = await page.evaluate(async () => {
    const { runAppEvent } = await import('/js/mcp-bridge.js');
    const { getActiveDocument, state } = await import('/js/core/state.ts');
    const store = await import('/js/solid/stores/schedulesStore.js');
    await (await import('/js/pdf/loader.js')).createBlankPDF(600, 800, 1);
    const doc = getActiveDocument();
    const snapshot = () => JSON.stringify({ schedules: store.schedules(), preferences: state.preferences.userSchedules,
      annotations: doc.annotations, undo: doc.undoStack });
    const invalid = [];
    async function reject(params) {
      const before = snapshot(); const input = JSON.stringify(params);
      const reply = await runAppEvent('mcp:place-schedule', params);
      invalid.push({ params, reply, unchanged: before === snapshot(), inputUnchanged: input === JSON.stringify(params) });
    }
    await reject({ name: 'no columns', config: { categories: ['area'], fields: ['not-a-field'] } });
    await reject({ name: 'bad page', page: 2 });
    for (const config of [null, [], 'invalid', 1]) await reject({ name: 'bad config', config });
    await reject({ templateId: 'unknown' });
    await reject({ scheduleId: 'missing', name: 'changed' });
    const first = await runAppEvent('mcp:place-schedule', { templateId: 'length', name: 'Original', x: 60, y: 90 });
    await reject({ scheduleId: first.scheduleId, name: 'Must not rename', page: 2 });
    await reject({ scheduleId: first.scheduleId, name: 'Must not rename', config: { fields: ['missing'], categories: ['area'] } });
    await reject({ scheduleId: first.scheduleId, name: 'Must not rename', config: { categories: 'invalid', fields: ['length'] } });
    const beforeCount = store.schedules().length, beforeUndo = doc.undoStack.length;
    const config = { categories: ['area'], fields: ['area', 'count'], filters: [], sort: [], itemize: true, format: {} };
    const originalInput = JSON.stringify(config);
    const reused = await runAppEvent('mcp:place-schedule', { scheduleId: first.scheduleId, name: 'Updated', config, x: 120, y: 180 });
    const current = store.getScheduleById(first.scheduleId);
    const addedUndo = doc.undoStack.length - beforeUndo;
    const drop = await import('/js/quantities/schedule-drop.js');
    const dropped = drop.placeScheduleAt(first.scheduleId, 20, 30, 1);
    return { invalid, first, reused, dropped: Boolean(dropped), configUnchanged: originalInput === JSON.stringify(config),
      current: JSON.parse(JSON.stringify(current)), config, countBefore: beforeCount, countAfter: store.schedules().length,
      annotations: doc.annotations.map(a => ({ type: a.type, title: a.title, x: a.x, y: a.y })),
      addedUndo, dropUndo: doc.undoStack.length - beforeUndo - addedUndo };
  });
  for (const item of results.invalid) {
    assert.equal(item.reply.ok, false, JSON.stringify(item.params));
    assert.equal(item.unchanged, true, `Rejected request mutated app state: ${JSON.stringify(item.params)}`);
    assert.equal(item.inputUnchanged, true);
  }
  assert.equal(results.first.ok, true);
  assert.equal(results.first.title, 'Original');
  assert.equal(results.reused.ok, true);
  assert.equal(results.reused.scheduleId, results.first.scheduleId);
  assert.equal(results.countAfter, results.countBefore);
  assert.equal(results.current.name, 'Updated');
  assert.deepEqual(results.current.config, results.config);
  assert.equal(results.configUnchanged, true);
  assert.equal(results.addedUndo, 1);
  assert.equal(results.dropped, true);
  assert.equal(results.dropUndo, 1);
  assert.deepEqual(results.annotations, [
    { type: 'scheduleTable', title: 'Original', x: 60, y: 90 },
    { type: 'scheduleTable', title: 'Updated', x: 120, y: 180 },
    { type: 'scheduleTable', title: 'Updated', x: 20, y: 30 },
  ]);
  console.log(JSON.stringify({ passed: true, rejectedWithoutMutation: results.invalid.length,
    validPlacements: results.annotations.length, reusedScheduleId: results.reused.scheduleId, addedUndo: results.addedUndo }));
} finally {
  await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true });
}
