import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
const pdf = await PDFDocument.create();
for (let i = 1; i <= 3; i++) pdf.addPage([600, 800]).drawText(`Page ${i}`, { x: 40, y: 400 });
const bytes = [...await pdf.save()];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 2200, height: 1100 } });
  const url = process.argv[2] || 'http://127.0.0.1:3065';
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-tab="drawing"]').waitFor({ timeout: 90000 });
  await page.evaluate(async bytes => {
    const { cacheWebFile } = await import('/js/core/platform.js');
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDFIfNeeded } = await import('/js/pdf/loader.js');
    cacheWebFile('wheel-fixture.pdf', new Uint8Array(bytes));
    const { index } = createTab('wheel-fixture.pdf');
    await loadPDFIfNeeded('wheel-fixture.pdf', index);
    window.__ribbon = await import('/js/solid/stores/ribbonStore.js');
    window.__state = await import('/js/core/state.ts');
    window.__state.state.preferences.wheelZoomWithoutCtrl = true;
    window.__ribbon.setActiveTab('home');
    window.__wheelEscaped = 0;
    window.addEventListener('wheel', () => window.__wheelEscaped++);
  }, bytes);
  const active = () => page.evaluate(() => window.__ribbon.activeTab());
  const docView = () => page.evaluate(() => {
    const d = window.__state.getActiveDocument(); const c = document.getElementById('pdf-container');
    return { scale: d.scale, page: d.currentPage, top: c.scrollTop, left: c.scrollLeft };
  });
  const before = await docView();
  const emit = (selector, deltaY = 120, extra = {}) => page.locator(selector).first().evaluate((el, args) => {
    const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: args.deltaY, ...args.extra });
    el.dispatchEvent(e); return e.defaultPrevented;
  }, { deltaY, extra });
  await page.locator('[data-tab="home"]').hover(); await page.mouse.wheel(0, 120);
  await page.waitForFunction(() => window.__ribbon.activeTab() === 'view');
  await page.locator('.ribbon-content').hover(); await page.mouse.wheel(0, 120);
  await page.waitForFunction(() => window.__ribbon.activeTab() === 'drawing');
  await emit('.ribbon-tabs', -120); assert.equal(await active(), 'view');
  await page.locator('#split-view-btn .ribbon-split-btn-arrow').click();
  assert.equal(await emit('#split-view-btn .ribbon-split-btn-menu'), false);
  assert.equal(await active(), 'view');
  await page.locator('#split-view-btn .ribbon-split-btn-arrow').click();
  for (const key of ['ctrlKey', 'shiftKey', 'altKey', 'metaKey']) {
    assert.equal(await emit('.ribbon-tabs', 120, { [key]: true }), false);
    assert.equal(await active(), 'view');
  }
  await page.evaluate(async () => {
    const { lintRegister } = await import('/js/plugins/ribbon-tab-registry.js');
    const { maakBijdrageScope } = await import('/js/plugins/extension-contributions.js');
    window.__wheelScope = maakBijdrageScope('test.wheel');
    lintRegister.registreer(window.__wheelScope, { id: 'main', label: 'Wheel test',
      groups: [{ id: 'group', label: 'Group', items: [{ type: 'status', id: 'status', label: 'Status', text: 'Ready' }] }] });
    window.__ribbon.setContextualTabsVisible(true);
    window.__ribbon.setActiveTab('home');
  });
  await page.locator('[data-tab="test.wheel.main"]').waitFor({ state: 'visible' });
  await page.locator('[data-tab="arrange"]').waitFor({ state: 'visible' });
  const tabs = await page.locator('.ribbon-tab[role="tab"]').evaluateAll(els => els.filter(e => e.getClientRects().length).map(e => e.dataset.tab));
  assert.ok(tabs.includes('test.wheel.main')); assert.ok(tabs.includes('format')); assert.ok(tabs.includes('arrange'));
  for (const expected of tabs.slice(1)) { await emit('.ribbon-tabs'); assert.equal(await active(), expected); }
  assert.equal(await emit('.ribbon-tabs'), true); assert.equal(await active(), tabs.at(-1));
  for (const expected of tabs.slice(0, -1).reverse()) { await emit('.ribbon-content', -120); assert.equal(await active(), expected); }
  assert.equal(await emit('.ribbon-tabs', -120), true); assert.equal(await active(), 'home');
  assert.deepEqual(await docView(), before); assert.equal(await page.evaluate(() => window.__wheelEscaped), 0);
  // Context tabs disappear; next events use the updated visible DOM order.
  await page.evaluate(() => { window.__ribbon.setContextualTabsVisible(false); window.__ribbon.setActiveTab('help'); });
  await emit('.ribbon-tabs'); assert.equal(await active(), 'test.wheel.main');
  await emit('.ribbon-tabs'); assert.equal(await active(), 'test.wheel.main');
  // Real input and real gallery popup keep their native/default wheel handling.
  await page.evaluate(() => { window.__ribbon.setContextualTabsVisible(true); window.__ribbon.setActiveTab('format'); });
  assert.equal(await emit('.ribbon-content input'), false); assert.equal(await active(), 'format');
  await page.locator('#fmt-style-more').click();
  assert.equal(await emit('#fmt-style-more-popup'), false); assert.equal(await active(), 'format');
  await page.locator('#fmt-style-more').click();
  // A custom extension list without known classes also keeps its scrolling.
  const listResult = await page.evaluate(() => {
    const list = document.createElement('div'); list.style.cssText = 'height:30px;overflow-y:auto';
    list.innerHTML = '<div style="height:300px">A scrollable extension list</div>';
    document.querySelector('.ribbon-content').append(list);
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 });
    list.firstChild.dispatchEvent(event); list.remove(); return event.defaultPrevented;
  });
  assert.equal(listResult, false); assert.equal(await active(), 'format');
  async function preference(value) {
    await page.evaluate(async () => (await import('/js/solid/stores/dialogStore.js')).openDialog('preferences', { tab: 'behavior' }));
    await page.locator('#pref-ribbon-wheel-tabs').setChecked(value);
    await page.locator('.pref-btn-primary').click();
    await page.locator('#pref-ribbon-wheel-tabs').waitFor({ state: 'detached' });
  }
  await preference(false);
  await page.evaluate(() => window.__ribbon.setActiveTab('home'));
  assert.equal(await emit('.ribbon-tabs'), false); assert.equal(await active(), 'home');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-tab="drawing"]').waitFor({ timeout: 90000 });
  await page.evaluate(async () => { window.__ribbon = await import('/js/solid/stores/ribbonStore.js'); window.__ribbon.setActiveTab('home'); });
  assert.equal(await emit('.ribbon-tabs'), false); assert.equal(await active(), 'home');
  await preference(true); await emit('.ribbon-tabs'); assert.equal(await active(), 'view');
  // Collapsed ribbon still navigates via the strip; tab focus follows activation.
  await page.locator('#ribbon-collapse-toggle').click();
  await page.locator('[data-tab="view"]').focus();
  await emit('[data-tab="view"]'); assert.equal(await active(), 'drawing');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'drawing');
  console.log('PASS: real wheel over tabs/body; hard ends; visible extension/context order; modifier/input/gallery/list exceptions; no document scroll/zoom; preference save/reload and re-enable; collapsed ribbon and keyboard focus');
} finally { await browser.close(); }
