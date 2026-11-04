// Project regression test; uses its own browser and isolated Vite server.
// Optional second argument: local upstream #22433 sample (not redistributed).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { bidiMarksFixture, ARABIC_CGJ } from './bidi-marks-fixture.mjs';
import { unzip } from '../js/bcf/bcf-zip.js';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1500, height: 1000 } });
  const page = await context.newPage();
  await page.goto(process.argv[2] || 'http://127.0.0.1:32857', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('[data-tab="view"]').waitFor({ timeout: 90000 });
  const fixtures = [{ bytes: await bidiMarksFixture(), name: 'generated-bidi.pdf' }];
  if (process.argv[3]) fixtures.push({ bytes: readFileSync(process.argv[3]), name: 'upstream-bidi.pdf' });
  for (const fixture of fixtures) {
    const result = await page.evaluate(async ({ bytes, name }) => {
      const { cacheWebFile } = await import('/js/core/platform.js');
      const { createTab } = await import('/js/ui/chrome/tabs.js');
      const { loadPDFIfNeeded } = await import('/js/pdf/loader.js');
      const { getActiveDocument } = await import('/js/core/state.ts');
      cacheWebFile(name, new Uint8Array(bytes));
      const { index } = createTab(name);
      await loadPDFIfNeeded(name, index);
      const doc = getActiveDocument(), p = await doc.pdfDoc.getPage(1);
      const search = await (await import('/js/search/find-controller.js')).extractPageText(doc.pdfDoc, 1, doc);
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:0;top:0;width:400px;height:200px';
      document.body.append(host);
      const layer = await (await import('/js/text/text-layer.js')).createTextLayer(p, p.getViewport({ scale: 1 }), host, 1);
      const span = [...layer.querySelectorAll('span')].find(s => s.textContent.startsWith('\u0645'));
      if (!span) throw Error('Arabic text missing from selectable layer');
      const range = document.createRange(); range.selectNodeContents(span);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      const selected = (await import('/js/text/text-selection.js')).getSelectedText();
      // ContextMenu and MobileApp copy this exact selected value to the clipboard.
      await navigator.clipboard.writeText(selected);
      const copied = await navigator.clipboard.readText();
      host.remove();
      return { search: search.text, selected, copied };
    }, { bytes: [...fixture.bytes], name: fixture.name });
    for (const field of ['search', 'selected', 'copied']) assert.equal(result[field].trim(), ARABIC_CGJ, `${fixture.name}: ${field}`);
    for (const [format, xmlName] of [['docx', 'word/document.xml'], ['odt', 'content.xml']]) {
      const [download, ok] = await Promise.all([page.waitForEvent('download'), page.evaluate(async format => (await import('/js/pdf/office-export.js')).exportOffice({ format, pages: [1] }), format)]);
      assert.equal(ok, true);
      const files = await unzip(new Uint8Array(readFileSync(await download.path())));
      assert.ok(new TextDecoder().decode(files.get(xmlName)).includes(ARABIC_CGJ), `${fixture.name}: ${format}`);
    }
    console.log(`PASS ${fixture.name}: app loader, search, selection, clipboard API, actual DOCX/ODT downloads`);
  }
} finally { await browser.close(); }
