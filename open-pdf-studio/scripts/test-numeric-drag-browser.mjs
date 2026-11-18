import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const temp = await mkdtemp(path.join(tmpdir(), 'opds-number-drag-'));
const server = await createServer({ root, cacheDir: temp, logLevel: 'error',
  server: { host: '127.0.0.1', port: 18368, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1433, height: 1000 } });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  await page.evaluate(async () => {
    const { state, getActiveDocument } = await import('/js/core/state.ts');
    await (await import('/js/pdf/loader.js')).createBlankPDF(595, 842, 1);
    const doc = getActiveDocument();
    const { createAnnotation } = await import('/js/annotations/factory.js');
    const annotation = createAnnotation({ type: 'text', page: 1, x: 30, y: 30, width: 180, height: 50,
      text: 'Numeric drag', fontFamily: 'Arial', fontSize: 16, textColor: '#000000' });
    doc.annotations = [annotation]; doc.selectedAnnotations = [annotation]; doc.selectedAnnotation = annotation;
    state.currentTool = 'select'; doc.undoStack = []; doc.redoStack = [];
    (await import('/js/ui/panels/properties-panel.js')).showProperties(annotation);
  });
  const font = page.locator('#prop-content-section input[data-getal]'); await font.waitFor(); await font.scrollIntoViewIfNeeded();
  const box = await font.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y - 30, { steps: 6 });
  assert.equal(await font.inputValue(), '21', 'dragging up previews five steps');
  assert.equal(await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument().annotations[0].fontSize), 16, 'preview does not flood annotation history');
  await page.mouse.up();
  assert.equal(await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument().annotations[0].fontSize), 21);
  await page.evaluate(async () => (await import('/js/core/undo-manager.js')).undo());
  assert.equal(await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument().annotations[0].fontSize), 16, 'one undo restores the whole drag');
  await page.evaluate(async () => (await import('/js/core/undo-manager.js')).redo());
  assert.equal(await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument().annotations[0].fontSize), 21);
  console.log('PASS: Font Size drag preview, commit, single undo and redo');

  // Dynamic fields exercise the same delegated handlers without panel rerenders.
  await page.evaluate(async () => {
    const { default: i18n } = await import('/js/i18n/config.js');
    await i18n.changeLanguage('nl');
    const holder = document.createElement('div');
    holder.id = 'drag-fixture';
    holder.style.cssText = 'position:fixed;left:200px;top:200px;z-index:2147483647;background:white;padding:20px';
    holder.innerHTML = '<input id="drag-number" data-getal min="0" max="2" step="0.1" value="1" style="width:160px;height:30px">';
    document.body.append(holder);
    window.dragEvents = [];
    const input = holder.firstElementChild;
    for (const event of ['input', 'change']) input.addEventListener(event, () => window.dragEvents.push(event));
    input.addEventListener('pointerdown', (e) => { window.dragPointer = e.pointerId; });
  });
  const input = page.locator('#drag-number');
  const raw = () => input.evaluate((el) => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').get.call(el));
  const events = () => page.evaluate(() => window.dragEvents);
  async function reset(value = '1', attrs = {}) {
    await input.blur();
    await input.evaluate((el, { value, attrs }) => {
      el.disabled = false; el.readOnly = false;
      for (const [name, v] of Object.entries(attrs)) el.setAttribute(name, v);
      el.value = value;
      window.dragEvents = [];
    }, { value, attrs });
  }
  async function start(dy = -18, dx = 0) {
    const b = await input.boundingBox();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    await page.mouse.move(cx, cy); await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy, { steps: 6 });
  }
  await reset(); await start();
  assert.equal(await raw(), '1,3', 'preview uses the Dutch decimal separator');
  assert.deepEqual(await events(), [], 'preview dispatches no edits');
  await page.mouse.up();
  assert.equal(await input.evaluate((el) => el.value), '1.3', 'consumers still read canonical decimals');
  assert.deepEqual(await events(), ['input', 'change'], 'release commits once');
  await reset(); await start(-120); await page.mouse.up();
  assert.equal(await input.evaluate((el) => el.value), '2', 'maximum is enforced');
  await reset(); await start(120); await page.mouse.up();
  assert.equal(await input.evaluate((el) => el.value), '0', 'minimum is enforced');

  for (const cancel of ['Escape', 'pointercancel', 'blur', 'focusout']) {
    await reset(); await start();
    if (cancel === 'Escape') await page.keyboard.press('Escape');
    else if (cancel === 'focusout') await input.blur();
    else if (cancel === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else await input.evaluate((el) => el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: window.dragPointer })));
    await page.mouse.up();
    assert.equal(await input.evaluate((el) => el.value), '1', `${cancel} restores the original value`);
    assert.deepEqual(await events(), [], `${cancel} does not commit`);
  }
  await reset(); await start();
  await input.evaluate((el) => { el.value = '1.8'; });
  await page.mouse.up();
  assert.equal(await input.evaluate((el) => el.value), '1.8', 'a concurrent programmatic update is not overwritten');
  assert.deepEqual(await events(), []);
  for (const prop of ['disabled', 'readOnly']) {
    await reset(); await input.evaluate((el, prop) => { el[prop] = true; }, prop);
    await start(); await page.mouse.up();
    assert.equal(await input.evaluate((el) => el.value), '1', `${prop} field is untouched`);
    assert.deepEqual(await events(), []);
    await reset(); await start();
    await input.evaluate((el, prop) => { el[prop] = true; }, prop);
    await page.mouse.up();
    assert.equal(await input.evaluate((el) => el.value), '1', `becoming ${prop} cancels the preview`);
    assert.deepEqual(await events(), []);
  }
  await reset('1', { 'data-getal': 'lengte' });
  await input.evaluate((el) => { el.value = `12'-6"`; });
  await start(); await page.mouse.up();
  assert.equal(await input.evaluate((el) => el.value), `12'-6"`, 'foot-inch expressions have no numeric drag step');
  assert.deepEqual(await events(), []);
  await reset('12345', { 'data-getal': '', max: '99999' });
  const selectionBox = await input.boundingBox();
  await page.mouse.move(selectionBox.x + 5, selectionBox.y + selectionBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(selectionBox.x + 45, selectionBox.y + selectionBox.height / 2, { steps: 6 });
  await page.mouse.up();
  assert.ok(await input.evaluate((el) => el.selectionEnd > el.selectionStart), 'horizontal dragging selects text');
  assert.equal(await input.evaluate((el) => el.value), '12345');
  assert.deepEqual(await events(), []);
  await reset(); await input.click();
  await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('0,4');
  assert.equal(await input.evaluate((el) => el.value), '0.4', 'normal decimal typing still works');
  await page.keyboard.press('ArrowUp');
  assert.equal(await input.evaluate((el) => el.value), '0.5', 'keyboard stepping still works');
  await reset(); await start(-3); await page.mouse.up();
  assert.equal(await input.evaluate((el) => el.value), '1', 'small click jitter does not change the value');
  assert.deepEqual(await events(), []);
  await reset(); await start();
  await input.evaluate((el) => el.remove()); await page.mouse.up();
  assert.deepEqual(await events(), [], 'removing the field cancels without committing');
  console.log('PASS: locale, steps/bounds, single commit, cancellation, concurrent updates, disabled/read-only, foot-inch, text selection, typing, keyboard and removal');

} finally {
  await browser?.close(); await server.close(); await rm(temp, { recursive: true, force: true });
}
