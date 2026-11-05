// Browser smoke check: real symbol palette, canvas appearances and PDF save.
// Run against an isolated Vite server with HMR disabled.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PDFDocument, PDFName } from 'pdf-lib';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const url = process.argv[2] || 'http://127.0.0.1:32836';
const output = process.argv[3] || '/tmp/opds-936-round-browser';
await mkdir(output, { recursive: true });
const source = await PDFDocument.create(); source.addPage([600, 800]);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('[data-tab="view"]').waitFor({ timeout: 90000 });
  const names = await page.evaluate(async bytes => {
    const { cacheWebFile } = await import('/js/core/platform.js');
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDFIfNeeded } = await import('/js/pdf/loader.js');
    const { getActiveDocument, state } = await import('/js/core/state.ts');
    const { getTemplate, defaultParams } = await import('/js/symbols/registry.js');
    const { NL_CATEGORIES } = await import('/js/solid/data/nlSymbolLibrary.js');
    const symbols = await import('/js/solid/stores/symbolStore.js');
    cacheWebFile('round-sections.pdf', new Uint8Array(bytes));
    const { index } = createTab('round-sections.pdf');
    await loadPDFIfNeeded('round-sections.pdf', index);
    const ids = ['staal-chs', 'beton-rond', 'hout-rond', 'paal-plattegrond', 'overspanningsharpoen-vloer'];
    const doc = getActiveDocument();
    doc.annotations = ids.map((symbolId, i) => ({
      id: `round-${i}`, type: 'parametricSymbol', symbolId, page: 1,
      x: 120, y: 50 + i * 140, width: i === 4 ? 300 : 100, height: 100,
      params: defaultParams(getTemplate(symbolId)), color: '#000000', strokeColor: '#000000',
      lineWidth: 0.7, opacity: 1, rotation: i === 2 ? 30 : 0,
    }));
    // No centre lines in the hollow-section pixel check.
    doc.annotations[0].params.hartlijn = false;
    doc.modified = true;
    state.preferences.language = 'en';
    await (await import('/js/i18n/config.js')).default.changeLanguage('en');
    symbols.setSymbolPaletteVisible(true);
    symbols.setSelectedIndustry('aec'); symbols.setSelectedCountry('nl');
    if (!symbols.isCategoryExpanded('nl-ifc-bouw')) symbols.toggleCategory('nl-ifc-bouw');
    (await import('/js/annotations/rendering.js')).redrawAnnotations();
    window.roundTest = { doc, state };
    return NL_CATEGORIES.find(g => g.id === 'nl-ifc-bouw').symbols.filter(s => ids.includes(s.parametricId)).map(s => ({name:s.name,id:s.parametricId}));
  }, [...await source.save()]);
  for (const {name,id} of names) {
    await page.getByTitle(name, {exact:true}).click();
    assert.equal(await page.evaluate(async () => (await import('/js/solid/stores/parametricSymbolStore.js')).pendingSymbolId()), id);
  }
  console.log('PASS all five palette buttons select the correct editable template');
  const pngs = await page.evaluate(async () => {
    const { renderParametricSymbolToPng } = await import('/js/annotations/rendering.js');
    return window.roundTest.doc.annotations.map(a => ({id:a.symbolId, png:renderParametricSymbolToPng(a)?.dataUrl}));
  });
  for (const {id,png} of pngs) {
    assert.ok(png?.startsWith('data:image/png;base64,'), id);
    await writeFile(`${output}/${id}.png`, Buffer.from(png.split(',')[1], 'base64'));
    const pixels = await page.evaluate(async png => {
      const img = new Image(); img.src = png; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width=img.width; canvas.height=img.height;
      const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0);
      const data=ctx.getImageData(0,0,img.width,img.height).data;
      let visible=0; for(let i=3;i<data.length;i+=4) if(data[i]>0) visible++;
      return {visible,center:ctx.getImageData(img.width/2,img.height/2,1,1).data[3]};
    },png);
    assert.ok(pixels.visible > 100, `${id}: nonempty rendered appearance`);
    if(id==='staal-chs') assert.equal(pixels.center,0,'CHS is hollow');
  }
  const gallery = await browser.newPage({viewport:{width:1200,height:450}});
  await gallery.setContent(`<html><body style="margin:20px;background:white;color:black;font:14px sans-serif;display:flex;gap:24px">${pngs.map(({id,png}) => `<div><p>${id}</p><img style="width:${id.includes('harpoen') ? 300 : 150}px" src="${png}"></div>`).join('')}</body></html>`);
  await gallery.locator('img').evaluateAll(async images => Promise.all(images.map(image => image.decode())));
  await gallery.screenshot({path:`${output}/gallery.png`});
  await gallery.close();
  await page.keyboard.press('Escape');
  await page.screenshot({path:`${output}/app.png`});
  const downloadPromise=page.waitForEvent('download',{timeout:60000});
  const saved=await page.evaluate(async()=> (await import('/js/pdf/saver.js')).savePDF('round-sections-result.pdf',{zonderHandtekeningVraag:true}));
  assert.equal(saved,true);
  const download=await downloadPromise;
  await download.saveAs(`${output}/round-sections.pdf`);
  const savedBytes=await readFile(`${output}/round-sections.pdf`);
  const pdf=await PDFDocument.load(savedBytes);
  const refs=pdf.getPage(0).node.Annots().asArray(); assert.equal(refs.length,5);
  for(const ref of refs) {
    const ann=pdf.context.lookup(ref);
    const ap=pdf.context.lookup(ann.get(PDFName.of('AP')));
    assert.ok(ap?.get(PDFName.of('N')),'each annotation has a real saved appearance');
  }
  console.log('PASS real canvas appearances, hollow CHS centre, rotated timber, and five saved PDF appearances');
  assert.deepEqual(errors,[]);
} finally { await browser.close(); }
