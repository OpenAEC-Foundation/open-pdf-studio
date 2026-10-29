// node scripts/postscript-browser-e2e.mjs <isolated-vite-url>
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/postscript-control-worker.mjs', route => route.fulfill({
    contentType: 'text/javascript', body: readFileSync(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8'),
  }));
  await page.goto(process.argv[2] || 'http://127.0.0.1:3061', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-tab="drawing"]').waitFor({ timeout: 90000 });
  const render = (program, url, cancel = false) => Promise.race([
    page.evaluate(async ({program, url, cancel}) => {
      const {renderFixture} = await import('/scripts/postscript-browser-probe.mjs');
      return renderFixture(program, url, cancel);
    }, {program, url, cancel}),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error(`Render deadline: ${program}`)), 15000); timer.unref(); }),
  ]);
  const control = await render('{ 0 0 }', '/postscript-control-worker.mjs');
  const fixed = await render('{ 0 0 }');
  assert.deepEqual(fixed, control, 'valid gradient pixels unchanged');
  assert.ok(fixed.right[0] > fixed.left[0] + 100, 'red gradient was actually rendered');
  for (const token of ['+', '-', '1e999', 'foo', '@']) {
    const image = await render(`{ pop ${token} 0 0 }`);
    assert.deepEqual(image.left, [0, 0, 0, 255]);
    assert.deepEqual(image.right, [0, 0, 0, 255]);
    console.log('PASS malformed token:', token);
  }
  const reopened = await render('{ 0 0 }', undefined, true);
  assert.deepEqual(reopened, control, 'cancel then rerender/reopen still works');
  console.log('PASS: valid Type 4 pixels unchanged; malformed PDFs complete; cancellation and reopening work');
} finally { await browser.close(); }
