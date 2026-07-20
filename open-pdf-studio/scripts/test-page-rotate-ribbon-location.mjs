import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');

try {
  const page = browser.contexts()
    .flatMap(context => context.pages())
    .find(candidate => candidate.url().startsWith('http://localhost:3041'));

  assert.ok(page, 'Open PDF Studio dev page is not available on CDP port 9222');

  const original = await page.evaluate(async () => {
    const { activeTab, setActiveTab } = await import('/js/solid/stores/ribbonStore.js');
    const { state } = await import('/js/core/state.ts');
    const snapshot = {
      activeTab: activeTab(),
      ribbonCollapsed: state.preferences.ribbonCollapsed,
    };

    state.preferences.ribbonCollapsed = false;
    setActiveTab('organize');
    return snapshot;
  });

  try {
    await page.waitForSelector('#tab-organize #rotate-left');

    const placement = await page.evaluate(() => {
      const groupFor = selector => document.querySelector(selector)?.closest('.ribbon-group');
      const editGroup = groupFor('#ep-edit-text');
      const pagesGroup = groupFor('#insert-page');
      const rotateLeftGroup = groupFor('#rotate-left');
      const rotateRightGroup = groupFor('#rotate-right');

      return {
        editLabel: editGroup?.querySelector('.ribbon-group-label')?.textContent?.trim(),
        pagesLabel: pagesGroup?.querySelector('.ribbon-group-label')?.textContent?.trim(),
        rotateLeftInEdit: rotateLeftGroup === editGroup,
        rotateRightInEdit: rotateRightGroup === editGroup,
        rotateLeftInPages: rotateLeftGroup === pagesGroup,
        rotateRightInPages: rotateRightGroup === pagesGroup,
        rotateLeftCount: document.querySelectorAll('#rotate-left').length,
        rotateRightCount: document.querySelectorAll('#rotate-right').length,
      };
    });

    assert.equal(placement.rotateLeftInEdit, true,
      `Rotate left must be in the Edit group, not ${placement.pagesLabel || 'another group'}`);
    assert.equal(placement.rotateRightInEdit, true,
      `Rotate right must be in the Edit group, not ${placement.pagesLabel || 'another group'}`);
    assert.equal(placement.rotateLeftInPages, false, 'Rotate left must be removed from the Pages group');
    assert.equal(placement.rotateRightInPages, false, 'Rotate right must be removed from the Pages group');
    assert.equal(placement.rotateLeftCount, 1, 'Rotate left must occur exactly once');
    assert.equal(placement.rotateRightCount, 1, 'Rotate right must occur exactly once');

    console.log(`Page rotate ribbon location test passed: both controls are in ${placement.editLabel}`);
  } finally {
    await page.evaluate(async snapshot => {
      const { setActiveTab } = await import('/js/solid/stores/ribbonStore.js');
      const { state } = await import('/js/core/state.ts');
      state.preferences.ribbonCollapsed = snapshot.ribbonCollapsed;
      setActiveTab(snapshot.activeTab);
    }, original);
  }
} finally {
  await browser.close();
}
