// node scripts/ribbon-expand-e2e.mjs [isolated Vite URL]
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.argv[2] || 'http://127.0.0.1:32860', { waitUntil: 'domcontentloaded' });
  const tab = id => page.locator(`.ribbon-tab[data-tab="${id}"]`);
  const toggle = page.locator('#ribbon-collapse-toggle');
  await tab('home').waitFor({ timeout: 90000 });
  const collapsed = () => page.evaluate(async () =>
    (await import('/js/core/state.ts')).state.preferences.ribbonCollapsed === true);
  const collapse = async () => {
    if (!await collapsed()) await toggle.click();
    assert.equal(await page.locator('.ribbon-container [role="tabpanel"]').count(), 0);
  };
  const expanded = async id => {
    assert.equal(await collapsed(), false, `Selecting ${id} must expand the ribbon`);
    await page.locator(`[id="tab-${id}"]`).waitFor({ state: 'visible' });
    assert.equal(await tab(id).getAttribute('aria-selected'), 'true');
  };

  // Re-selecting the active tab must work, even when the tab signal does not change.
  await tab('home').click();
  await collapse();
  await tab('home').click();
  await expanded('home');
  for (const id of ['view', 'drawing', 'comment', 'organize', 'help']) {
    await collapse();
    await tab(id).click();
    await expanded(id);
    await tab(id).click();
    await expanded(id); // A second click does not collapse it again.
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await tab('home').waitFor({ timeout: 90000 });
  await expanded('home'); // Expansion is saved by the real preference path.

  for (const key of ['Enter', 'Space', 'ArrowRight', 'End', 'Home']) {
    await tab('home').click();
    await collapse();
    await tab('home').focus();
    await page.keyboard.press(key);
    await expanded(key === 'ArrowRight' ? 'view' : key === 'End' ? 'help' : 'home');
  }

  await page.evaluate(async () => {
    const ribbon = await import('/js/solid/stores/ribbonStore.js');
    ribbon.setContextualTabsVisible(true);
  });
  for (const id of ['format', 'arrange']) {
    await collapse();
    await tab(id).click();
    await expanded(id);
  }
  await page.evaluate(async () =>
    (await import('/js/solid/stores/imageEditStore.js')).syncImageEditStore([{ type: 'image' }]));
  await collapse();
  await tab('image').click();
  await expanded('image');
  await page.evaluate(async () => {
    (await import('/js/solid/stores/imageEditStore.js')).syncImageEditStore([]);
    (await import('/js/solid/stores/ribbonStore.js')).setContextualTabsVisible(false);
    const { lintRegister } = await import('/js/plugins/ribbon-tab-registry.js');
    const { maakBijdrageScope } = await import('/js/plugins/extension-contributions.js');
    lintRegister.registreer(maakBijdrageScope('test.ribbon'), {
      id: 'main', label: 'Test ribbon',
      groups: [{ id: 'group', label: 'Group', items: [{ type: 'status', id: 'status', label: 'Status', text: 'Ready' }] }],
    });
  });
  await collapse();
  await tab('test.ribbon.main').click();
  await expanded('test.ribbon.main');

  await page.evaluate(async () => {
    const { lintRegister } = await import('/js/plugins/ribbon-tab-registry.js');
    const { maakBijdrageScope } = await import('/js/plugins/extension-contributions.js');
    for (let i = 0; i < 12; i++) {
      lintRegister.registreer(maakBijdrageScope(`test.overflow${i}`), {
        id: 'main', label: `Extra ribbon ${i}`,
        groups: [{ id: 'group', label: 'Group', items: [{ type: 'status', id: 'status', label: 'Status', text: 'Ready' }] }],
      });
    }
  });
  await collapse();
  await page.locator('.ribbon-ext-more').click();
  assert.equal(await collapsed(), true, 'Opening the overflow menu alone does not expand the ribbon');
  const menuItem = page.locator('[data-ext-tab-menu]').last();
  const overflowId = await menuItem.getAttribute('data-ext-tab-menu');
  await menuItem.click();
  await expanded(overflowId);

  await tab('home').click();
  await collapse();
  await tab('home').hover();
  await page.mouse.wheel(0, 100);
  await page.waitForFunction(() => document.querySelector('[data-tab="view"]')?.getAttribute('aria-selected') === 'true');
  await expanded('view');

  // Background tab changes must keep the user's collapsed preference.
  await collapse();
  await page.evaluate(async () => (await import('/js/solid/stores/ribbonStore.js')).setActiveTab('home'));
  assert.equal(await collapsed(), true);
  await page.locator('#file-tab').click();
  assert.equal(await collapsed(), true, 'File opens a menu, not a ribbon panel');
  await page.keyboard.press('Escape');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await tab('home').waitFor({ timeout: 90000 });
  assert.equal(await collapsed(), true, 'The collapse toggle still saves the collapsed preference');
  await toggle.click();
  await expanded('home');
  assert.deepEqual(errors, []);
  console.log('Ribbon: active/other tabs, repeated clicks, saved expansion/collapse, keyboard, contextual and extension tabs, wheel, File and background selection passed.');
} finally {
  await browser.close();
}
