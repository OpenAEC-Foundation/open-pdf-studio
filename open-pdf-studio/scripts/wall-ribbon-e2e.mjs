// Run against an isolated Vite server: node scripts/wall-ribbon-e2e.mjs [url]
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';

const pdf = await PDFDocument.create(); pdf.addPage([600, 800]);
const bytes = [...await pdf.save()];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.argv[2] || 'http://127.0.0.1:3069', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('[data-tab="drawing"]').waitFor({ timeout: 90000 });
  await page.locator('[data-tab="drawing"]').click();
  const wall = page.locator('#dr-wall');
  assert.equal(await wall.isDisabled(), true, 'No document: wall must be disabled');
  await page.evaluate(async bytes => {
    const { cacheWebFile } = await import('/js/core/platform.js');
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDFIfNeeded } = await import('/js/pdf/loader.js');
    const { state, getActiveDocument } = await import('/js/core/state.ts');
    const symbols = await import('/js/solid/stores/symbolStore.js');
    window.fixture = { state, getActiveDocument, symbols };
    cacheWebFile('wall-fixture.pdf', new Uint8Array(bytes));
    const { index } = createTab('wall-fixture.pdf'); await loadPDFIfNeeded('wall-fixture.pdf', index);
    getActiveDocument().measureScale = { pixelsPerUnit: 72 / 25.4 / 100, unit: 'mm' };
    symbols.setSelectedCountry('de');
    state.preferences.enableObjectSnap = false;
    state.toolOverrides = { wallDikteMm: 250, wallPattern: 'isolatie', wallIsolatieType: 'glaswol', symbolInsert: true };
  }, bytes);
  await page.locator('[data-tab="drawing"]').click();
  assert.equal(await wall.isEnabled(), true);
  assert.equal(await page.evaluate(() => window.fixture.symbols.filteredCategories().some(c => c.id === 'nl-ifc-bouw')), false);
  await wall.click();
  assert.deepEqual(await page.evaluate(() => ({ tool: window.fixture.state.currentTool, overrides: window.fixture.state.toolOverrides })), { tool: 'wall', overrides: null });
  const canvas = page.locator('#annotation-canvas');
  await canvas.waitFor({ state: 'visible' });
  const box = await canvas.boundingBox();
  const click = (x, y, options) => page.mouse.click(box.x + x, box.y + y, options);
  await click(100, 100); await click(300, 100); await click(300, 300);
  const walls = await page.evaluate(() => window.fixture.getActiveDocument().annotations.map(a => ({ type: a.type, dikteMm: a.dikteMm, hatchPattern: a.hatchPattern, ifcCategory: a.ifcCategory, startX:a.startX,startY:a.startY,endX:a.endX,endY:a.endY })));
  assert.equal(walls.length, 2);
  for (const a of walls) {
    assert.equal(a.type, 'wall'); assert.equal(a.dikteMm, 100);
    assert.equal(a.hatchPattern, 'nen47-metselwerk-baksteen'); assert.equal(a.ifcCategory, 'IfcWall');
  }
  assert.equal(walls[0].endX, walls[1].startX); assert.equal(walls[0].endY, walls[1].startY);
  assert.equal(await page.evaluate(() => window.fixture.state.isDrawing), true);
  assert.deepEqual(await page.evaluate(async () => {
    const { computeWallShape } = await import('/js/annotations/rendering/walls.js');
    const a = window.fixture.getActiveDocument().annotations;
    return [computeWallShape(a[0], a).joinedEnd, computeWallShape(a[1], a).joinedStart];
  }), [true, true]);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.fixture.state.isDrawing), false);
  await wall.click(); await click(100, 350); await click(200, 350, { button: 'right' });
  assert.equal(await page.evaluate(() => window.fixture.state.isDrawing), false);
  assert.equal(await page.evaluate(() => window.fixture.getActiveDocument().annotations.length), 2);
  // The original NL palette entry remains available and shares the wall tool.
  await page.evaluate(() => {
    const s = window.fixture.symbols; s.setSelectedCountry('nl');
    s.setSymbolPaletteVisible(true); s.setSymbolPaletteMode('docked-right');
    if (!s.isCategoryExpanded('nl-ifc-bouw')) s.toggleCategory('nl-ifc-bouw');
  });
  await page.locator('.sp-symbol-btn[title="Wand (IfcWall)"]:visible').click();
  assert.deepEqual(await page.evaluate(() => ({ tool:window.fixture.state.currentTool, symbolInsert:window.fixture.state.toolOverrides.symbolInsert })), { tool:'wall', symbolInsert:true });
  await page.evaluate(() => window.fixture.symbols.setSymbolPaletteVisible(false));
  const paletteBox = await canvas.boundingBox();
  await page.mouse.click(paletteBox.x + 200, paletteBox.y + 250);
  await page.mouse.click(paletteBox.x + 200, paletteBox.y + 100);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.fixture.getActiveDocument().annotations.length), 3);
  assert.equal(await page.evaluate(async () => {
    const { computeWallShape } = await import('/js/annotations/rendering/walls.js');
    const a = window.fixture.getActiveDocument().annotations;
    return computeWallShape(a[2], a).joinedEnd;
  }), true, 'Palette wall forms a T-join with the ribbon wall');
  await page.evaluate(async () => {
    const { showProperties } = await import('/js/ui/panels/properties-panel.js');
    const { addToSelection } = await import('/js/core/stores/selection-helpers.ts');
    const a = window.fixture.getActiveDocument().annotations[0];
    addToSelection(a); showProperties(a);
  });
  const thickness = page.locator('#prop-wall-section input[data-getal]');
  await thickness.fill('150'); await thickness.press('Tab');
  await page.locator('#prop-wall-section select').first().selectOption('nen47-beton-prefab');
  await page.locator('#prop-wall-join-start').uncheck();
  await page.locator('#prop-wall-join-end').uncheck();
  assert.deepEqual(await page.evaluate(() => {
    const a = window.fixture.getActiveDocument().annotations[0];
    return [a.dikteMm, a.hatchPattern, a.noJoinStart, a.noJoinEnd];
  }), [150, 'nen47-beton-prefab', true, true]);
  await page.evaluate(() => { window.fixture.getActiveDocument().pdfaCompliance = 'PDF/A-1b'; window.fixture.getActiveDocument().pdfADismissed = false; });
  await page.locator('[data-tab="drawing"]').click();
  assert.equal(await wall.isDisabled(), true, 'Read-only PDF/A: wall must be disabled');
  await page.evaluate(() => { window.fixture.getActiveDocument().pdfaCompliance = null; });
  await page.screenshot({ path: '/tmp/opds-864-wall.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: country-independent wall button, standard defaults, chained drawing and corner joins, Escape/right-click cancellation, NL palette and T-join, thickness/material/join properties, read-only guards');
} finally { await browser.close(); }
