// Real saver, loader, rotation and undo; only native filesystem/render IPC mocked.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PDFDocument, PDFName, degrees, rgb } from 'pdf-lib';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const cache = await mkdtemp(path.join(tmpdir(), 'opds-save-rotation-'));
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), cacheDir: cache,
  logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  for (const intrinsic of [0, 90, 180, 270]) {
    const pdf = await PDFDocument.create(); const sheet = pdf.addPage([300, 400]);
    sheet.setRotation(degrees(intrinsic));
    sheet.drawRectangle({ x: 0, y: 0, width: 100, height: 150, color: rgb(1, 0, 0) });
    const unseen = pdf.addPage([300, 400]);
    unseen.node.set(PDFName.of('Annots'), pdf.context.obj([{ Type: 'Annot', Subtype: 'Text', Rect: [10, 20, 30, 40], Contents: 'Unseen note' }]));
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`, { timeout: 120000 });
    await page.waitForSelector('#tool-select', { timeout: 120000 });
    await page.evaluate(async bytes => {
      const { createTab } = await import('/js/ui/chrome/tabs.js');
      const { loadPDF } = await import('/js/pdf/loader.js');
      const { index } = createTab('rotation.pdf');
      await loadPDF('/original.pdf', index, new Uint8Array(bytes));
      const { getActiveDocument } = await import('/js/core/state.ts');
      const doc = getActiveDocument(); await doc._annotationCompletion;
      // Simulate a page the lazy annotation loader has not visited yet.
      (await import('/js/pdf/loader.js')).cancelAnnotationLoading(doc);
      doc.annotations = doc.annotations.filter(a => a.page !== 2);
      doc._annotationPagesReady.add(1); doc._loadedAnnotationPages.add(1);
      const t = window.testSave = { doc, files: new Map([['/original.pdf', new Uint8Array(bytes)]]), calls: [] };
      window.__TAURI__ = {
        path: { tempDir: async () => '/temp' },
        fs: {
          writeFile: async (path, bytes) => t.files.set(path, bytes.slice()),
          readFile: async path => t.files.get(path)?.slice(),
          remove: async path => t.files.delete(path),
        },
        core: { invoke: async (cmd, args, options) => {
          t.calls.push({ cmd, path: args?.path });
          if (cmd === 'write_file_atomic') {
            if (t.failWrite) throw new Error('simulated write error');
            t.files.set(decodeURIComponent(options.headers['x-opds-path']), new Uint8Array(args).slice()); return true;
          }
          if (cmd.startsWith('render_')) throw new Error('native render unavailable in browser test');
          if (cmd === 'page_content_size') return 1000;
          return null;
        } },
      };
      const { PDFDocument } = await import('/node_modules/pdf-lib/dist/pdf-lib.esm.js');
      t.orientation = async path => {
        const pdf = await PDFDocument.load(t.files.get(path).slice());
        return ((pdf.getPage(0).getRotation().angle % 360) + 360) % 360;
      };
      t.render = async (pdf, extra, scale) => {
        const p = await pdf.getPage(1), viewport = p.getViewport({ scale, rotation: (p.rotate + extra) % 360 });
        const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await p.render({ canvasContext: ctx, viewport, annotationMode: 0 }).promise;
        return { size: [canvas.width, canvas.height], pixels: [...ctx.getImageData(0, 0, canvas.width, canvas.height).data] };
      };
      t.inspect = async () => {
        const p = await doc.pdfDoc.getPage(1), extra = doc.pageRotations?.[1] || 0;
        const saved = await PDFDocument.load(t.files.get(doc.saveTargetPath || doc.filePath).slice());
        const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
        const disk = await pdfjs.getDocument({ data: t.files.get(doc.filePath).slice(), isEvalSupported: false }).promise;
        const nativePixels = [];
        for (const scale of [0.5, 3]) {
          const live = await t.render(doc.pdfDoc, extra, scale), fresh = await t.render(disk, extra, scale);
          nativePixels.push(JSON.stringify(live) === JSON.stringify(fresh));
        }
        await disk.loadingTask.destroy();
        return { nativePixels, unseen: saved.getPage(1).node.Annots()?.size(), output: await t.orientation(doc.saveTargetPath || doc.filePath),
          pdfjs: (p.rotate + extra) % 360, native: ((await t.orientation(doc.filePath)) + extra) % 360,
          undo: doc.undoStack.length, path: doc.filePath, target: doc.saveTargetPath, extra };
      };
    }, [...await pdf.save()]);
    const result = await page.evaluate(async () => {
      const t = window.testSave;
      const { draaiPaginas } = await import('/js/pdf/pagina-draaien.js');
      const { savePDF, savePDFAs } = await import('/js/pdf/saver.js');
      const { undo, redo } = await import('/js/core/undo-manager.js');
      await draaiPaginas(180, [1]);
      t.failWrite = true;
      const failed = await savePDF();
      const afterFailure = { path: t.doc.filePath, output: await t.orientation('/original.pdf'), extra: t.doc.pageRotations[1] };
      t.failWrite = false;
      const saved = await savePDF(), first = await t.inspect();
      await savePDF(); const second = await t.inspect();
      await undo(); await savePDF(); const undone = await t.inspect();
      await redo(); const copied = await savePDFAs(t.doc, '/copy.pdf'), copy = await t.inspect();
      await savePDF(); const repeatedCopy = await t.inspect();
      return { failed, afterFailure, saved, copied, first, second, undone, copy, repeatedCopy };
    });
    assert.equal(result.failed, false);
    assert.deepEqual(result.afterFailure, { path: '/original.pdf', output: intrinsic, extra: 180 });
    assert.equal(result.saved, true); assert.equal(result.copied, true);
    for (const name of ['first', 'second', 'copy', 'repeatedCopy']) {
      for (const engine of ['output', 'pdfjs', 'native'])
        assert.equal(result[name][engine], (intrinsic + 180) % 360, `${intrinsic} ${name} ${engine}: ${JSON.stringify(result)}`);
      assert.equal(result[name].unseen, 1, 'unseen page annotation survives repeated saves');
      assert.deepEqual(result[name].nativePixels, [true, true], 'fresh disk render agrees at fit and detail scales');
      assert.ok(result[name].undo > 0, 'save preserves rotation undo history');
    }
    for (const engine of ['output', 'pdfjs', 'native']) assert.equal(result.undone[engine], intrinsic, `undo ${engine}`);
    assert.equal(result.copy.target, '/copy.pdf');
    assert.notEqual(result.copy.path, '/copy.pdf', 'native renders the unbaked working copy');
    console.log(`PASS /Rotate ${intrinsic}: save, repeat, undo/save, redo/Save As, repeat copy; both render baselines`);
    await page.close();
  }
  // Browser downloads also keep the loaded rotation frame after Save As.
  const web = await browser.newPage();
  await web.goto(`http://127.0.0.1:${server.httpServer.address().port}`, { timeout: 120000 });
  await web.waitForSelector('#tool-select', { timeout: 120000 });
  const input = await PDFDocument.create(); input.addPage([300, 400]).setRotation(degrees(90));
  await web.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    await loadPDF('web.pdf', createTab('web.pdf').index, new Uint8Array(bytes));
    await (await import('/js/pdf/pagina-draaien.js')).draaiPaginas(90, [1]);
  }, [...await input.save()]);
  for (const copy of [false, true, false]) {
    const downloaded = web.waitForEvent('download');
    assert.equal(await web.evaluate(async copy => {
      const { savePDF, savePDFAs } = await import('/js/pdf/saver.js');
      const { getActiveDocument } = await import('/js/core/state.ts');
      return copy ? savePDFAs(getActiveDocument(), 'web-copy.pdf') : savePDF();
    }, copy), true);
    const file = await downloaded; const outputPath = path.join(cache, 'download.pdf');
    await file.saveAs(outputPath);
    const saved = await PDFDocument.load(await readFile(outputPath));
    assert.equal(saved.getPage(0).getRotation().angle, 180, 'web repeat/save-as must not bake rotation twice');
  }
  await web.close();
  console.log('PASS browser download, Save As and repeated save');
} finally { await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true }); }
