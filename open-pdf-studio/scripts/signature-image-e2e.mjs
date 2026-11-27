// PNG/JPEG-import (#1267), via echte dialogen in een geïsoleerde Vite-app.
// Vanuit open-pdf-studio: node scripts/signature-image-e2e.mjs
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
const cacheDir = await mkdtemp(join(tmpdir(), 'opds-signature-e2e-'));
const server = await createServer({ cacheDir, server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0]);
  await page.locator('[data-tab="drawing"]').waitFor({ timeout: 90000 });
  const pdf = await PDFDocument.create(); pdf.addPage([600, 800]);
  await page.evaluate(async bytes => {
    const { cacheWebFile } = await import('/js/core/platform.js');
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDFIfNeeded } = await import('/js/pdf/loader.js');
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { openDialog, closeDialog } = await import('/js/solid/stores/dialogStore.js');
    const storage = await import('/js/annotations/signature-storage.js');
    const { schrijfOpslagJson } = await import('/js/core/opslag.js');
    schrijfOpslagJson('pdfEditorSignatures', []);
    cacheWebFile('signature-import.pdf', new Uint8Array(bytes));
    const { index } = createTab('signature-import.pdf'); await loadPDFIfNeeded('signature-import.pdf', index);
    const c = document.createElement('canvas'); c.width = 400; c.height = 100;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#0011dd'; ctx.fillRect(20, 30, 360, 40);
    window.sigTest = { openDialog, closeDialog, storage, getActiveDocument, png: c.toDataURL(), jpeg: c.toDataURL('image/jpeg') };
  }, [...await pdf.save()]);
  const open = name => page.evaluate(name => window.sigTest.openDialog(name, { x: 300, y: 400, page: 1, docId: window.sigTest.getActiveDocument().id }), name);
  const close = name => page.evaluate(name => window.sigTest.closeDialog(name), name);
  async function upload(kind, content) {
    const data = content || await page.evaluate(k => window.sigTest[k], kind);
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.signature-image-import button').click();
    await (await chooser).setFiles({ name: `signature.${kind === 'jpeg' ? 'jpg' : 'png'}`, mimeType: `image/${kind}`, buffer: Buffer.from(data.split(',')[1], 'base64') });
    await page.waitForFunction(() => !document.querySelector('.signature-image-import button')?.disabled);
  }
  await open('signature');
  await upload('png');
  assert.equal(await page.locator('.sig-saved-item').count(), 1);
  const pixels = await page.locator('.sig-saved-item img').evaluate(async img => {
    await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    return { w: c.width, h: c.height, alpha: x.getImageData(0, 0, 1, 1).data[3], blue: x.getImageData(30, 40, 1, 1).data[2] };
  });
  assert.deepEqual(pixels, { w: 400, h: 100, alpha: 0, blue: 221 });
  await page.locator('.sig-saved-item').click();
  await page.waitForFunction(() => window.sigTest.getActiveDocument().annotations.length === 1);
  assert.deepEqual(await page.evaluate(() => {
    const a = window.sigTest.getActiveDocument().annotations[0]; return [a.type, a.page, a.x, a.y, a.width, a.height];
  }), ['signature', 1, 200, 375, 200, 50]);
  console.log('PASS PNG transparency, aspect ratio and saved-signature placement');

  await open('digital-sign');
  await page.locator('input[name="digital-sign-zichtbaar"]').last().check();
  const select = page.locator('.digital-sign-dialog select').first();
  assert.equal(await select.locator('option').count(), 2);
  await upload('jpeg');
  assert.equal(await select.inputValue(), '1');
  assert.equal(await select.locator('option').count(), 3);
  assert.match(await page.locator('.digital-sign-voorbeeld').getAttribute('src'), /^data:image\/jpeg;/);
  const appearance = await page.evaluate(async () => {
    const { tekenWeergave, opgeslagenAfbeeldingen } = await import('/js/pdf/handtekeningen/ondertekenen.js');
    const image = opgeslagenAfbeeldingen()[1].dataUrl;
    const data = await tekenWeergave({ breedtePt: 200, hoogtePt: 50, regels: [], afbeeldingUrl: image });
    const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const p = x.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
    return p[2] > 150 && p[0] < 40;
  });
  assert.equal(appearance, true);
  console.log('PASS digital dialog selects imported JPEG and signing appearance contains it');

  // Quota failures leave the old list and selection intact; actual store throws.
  await page.evaluate(() => { window.sigTest.setItem = Storage.prototype.setItem; Storage.prototype.setItem = function(k,v) { if (k === 'opds:pdfEditorSignatures') throw new DOMException('Quota exceeded', 'QuotaExceededError'); return window.sigTest.setItem.call(this,k,v); }; });
  await upload('png');
  assert.match(await page.locator('.signature-image-import [role="alert"]').innerText(), /Quota/);
  assert.equal(await select.inputValue(), '1');
  assert.equal(await select.locator('option').count(), 3);
  await page.evaluate(() => { Storage.prototype.setItem = window.sigTest.setItem; });
  await upload('png', 'data:image/png;base64,' + Buffer.from('not an image').toString('base64'));
  assert.equal(await page.locator('.signature-image-import [role="alert"]').count(), 1);
  await upload('png', 'data:image/png;base64,' + Buffer.from([137,80,78,71,0,0,0,0]).toString('base64'));
  assert.equal(await page.locator('.signature-image-import [role="alert"]').count(), 1);
  assert.equal(await select.locator('option').count(), 3);
  console.log('PASS quota, wrong format and corrupt image preserve saved signatures');

  const count = await page.evaluate(() => window.sigTest.storage.getSavedSignatures().length);
  let chooser = page.waitForEvent('filechooser'); await page.locator('.signature-image-import button').click(); await chooser;
  await page.locator('input[type=file]').evaluate(el => el.dispatchEvent(new Event('cancel')));
  assert.equal(await page.locator('.signature-image-import button').isEnabled(), true);
  chooser = page.waitForEvent('filechooser'); await page.locator('.signature-image-import button').click(); const pending = await chooser;
  await close('digital-sign');
  await pending.setFiles({ name: 'late.png', mimeType: 'image/png', buffer: Buffer.from((await page.evaluate(() => window.sigTest.png)).split(',')[1], 'base64') });
  // Drain the picker/read microtasks before checking the disposed guard.
  await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
  assert.equal(await page.evaluate(() => window.sigTest.storage.getSavedSignatures().length), count);
  console.log('PASS cancel and close during file selection leave storage unchanged');

  const resized = await page.evaluate(async () => {
    const { signatureImageData } = await import('/js/annotations/signature-image.js');
    const c = document.createElement('canvas'); c.width = 2400; c.height = 600;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#0011dd'; ctx.fillRect(100,100,2200,400);
    const out = [];
    for (const mime of ['image/png', 'image/jpeg']) {
      const bytes = new Uint8Array(await (await fetch(c.toDataURL(mime))).arrayBuffer());
      const data = await signatureImageData(bytes); const img = new Image(); img.src = data; await img.decode();
      const dst = document.createElement('canvas'); dst.width = img.width; dst.height = img.height; const x = dst.getContext('2d'); x.drawImage(img,0,0);
      out.push([img.width,img.height,data.startsWith(`data:${mime};`),x.getImageData(0,0,1,1).data[3]]);
    }
    return out;
  });
  assert.deepEqual(resized, [[1024,256,true,0],[1024,256,true,255]]);
  console.log('PASS large PNG/JPEG bounded to 1024px with proportion and alpha preserved');

  await open('signature'); await page.locator('.sig-tab').last().click();
  assert.equal(await page.locator('.sig-saved-item').count(), 2);
  await page.locator('.sig-saved-del').first().click();
  assert.equal(await page.locator('.sig-saved-item').count(), 1);
  await close('signature'); await open('digital-sign');
  await page.locator('input[name="digital-sign-zichtbaar"]').last().check();
  assert.equal(await page.locator('.digital-sign-dialog select').first().locator('option').count(), 2);
  console.log('PASS both dialogs share saved-image history and deletion after reopening');
  assert.deepEqual(errors, []);
} finally {
  await browser?.close(); await server.close(); await rm(cacheDir, { recursive: true, force: true });
}
