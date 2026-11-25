// Run from open-pdf-studio. Own browser/server, no HMR or user-profile writes.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
const cacheDir = await mkdtemp(join(tmpdir(), 'opds-nen-labels-'));
const server = await createServer({ cacheDir, server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  await page.goto(server.resolvedUrls.local[0]);
  await page.locator('[data-tab="drawing"]').waitFor({ timeout: 90000 });
  const pdf = await PDFDocument.create(); pdf.addPage([600,800]);
  await page.evaluate(async bytes => {
    const { cacheWebFile } = await import('/js/core/platform.js');
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDFIfNeeded } = await import('/js/pdf/loader.js');
    cacheWebFile('nen-labels.pdf', new Uint8Array(bytes)); const { index } = createTab('nen-labels.pdf'); await loadPDFIfNeeded('nen-labels.pdf', index);
    const i18n = (await import('/js/i18n/config.js')).default; await i18n.changeLanguage('nl');
    const store = await import('/js/solid/stores/symbolStore.js'); store.setSymbolPaletteVisible(true); store.setSearchQuery('');
    const cats = await (await import('/js/solid/data/nen1414-laden.js')).laadNen1414();
    window.nenTest = { store, cats, i18n, state: (await import('/js/core/state.ts')).state };
  }, [...await pdf.save()]);
  for (const [group,title,id] of [
    ['Eerste hulp en redding','Eerste hulp','Tr01'], ['Verbodstekens','Lift niet gebruiken','Tv017'],
    ['Vluchtwegen','Verzamelplaats','Tn06'], ['Waarschuwingen','Elektrische spanning','Tw02'],
  ]) {
    const header = page.locator('.sp-cat-header').filter({ hasText: `NL NEN 1414 — ${group}` });
    // The library promise can settle before the palette's deferred store/DOM
    // update. Assert the rendered result after it becomes visible, also on CI.
    await header.waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(await header.count(),1,group); await header.click();
    // The tooltip belongs to the button itself, not the nested SVG.
    const item = page.locator(`.sp-symbol-btn[title="${title}"]`);
    await item.waitFor();
    const raster = await item.locator('image').getAttribute('href');
    assert.ok(raster, title);
    assert.equal(await page.evaluate(async src => { const im = new Image(); im.src = src; await im.decode(); return im.naturalWidth > 0; }, raster), true);
    await item.click();
    assert.deepEqual(await page.evaluate(() => {
      const o = window.nenTest.state.toolOverrides;
      return [o.symbolId,o.stampName,o.ifcCategory,o.ifcPredefinedType ?? null,o.stampSvg===o.stampBaseSvg];
    }), [`nen1414-${id}`,title,'IfcAnnotation',null,true]);
    console.log('PASS visible category, decoded image and selected stamp metadata: ' + id);
  }
  // Search follows corrected names. Persistent ids and exact SVG bytes remain
  // the same keys used by custom type overrides and saved stamp appearances.
  await page.evaluate(() => window.nenTest.store.setSearchQuery('Eerste hulp'));
  await page.locator('.sp-symbol-btn[title="Eerste hulp"]').waitFor();
  assert.equal(await page.locator('.sp-symbol-btn[title="Eerste hulp"]').count(),1);
  await page.evaluate(async () => { window.nenTest.store.setSearchQuery(''); await window.nenTest.i18n.changeLanguage('en'); });
  for (const name of ['Escape routes','First aid and rescue','Prohibition signs','Warnings']) {
    const header = page.locator('.sp-cat-header').filter({ hasText: `NL NEN 1414 — ${name}` });
    await header.waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(await header.count(),1);
  }
  assert.equal(await page.evaluate(() => window.nenTest.cats.flatMap(c => c.symbols).every(s => /<svg viewBox="0 0 64 64"/.test(s.svg) && s.id.startsWith('nen1414-'))), true);
  console.log('PASS search, English categories and stable symbol identities');
} finally { await browser?.close(); await server.close(); await rm(cacheDir,{ recursive:true,force:true }); }
