import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
const root = fileURLToPath(new URL('../', import.meta.url)); process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-central-live-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
let browser;
try {
  const pdf = await PDFDocument.create(); pdf.addPage([300, 300]); const source = Array.from(await pdf.save());
  await server.listen(); browser = await chromium.launch({ headless: true });
  const tab = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  await tab.addInitScript(() => localStorage.setItem('opds:pdfEditorPreferences', JSON.stringify({ language: 'en', theme: 'light' })));
  const errors = []; tab.on('pageerror', e => errors.push(e.message));
  await tab.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await tab.waitForSelector('#tool-select', { timeout: 120000 });
  const initial = await tab.evaluate(async source => {
    const { state } = await import('/js/core/state.ts');
    const { changeLanguage } = await import('/js/i18n/useTranslation.js'); await changeLanguage('en');
    const { createTab, closeTab, markDocumentModified } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { redrawAnnotations } = await import('/js/annotations/rendering.js');
    const { createCentralPdfAdapter } = await import('/js/review/central-review-pdf-adapter.js');
    const { createCentralReviewOpening } = await import('/js/review/central-review-opening.js');
    const { startCentralReview } = await import('/js/review/central-review-service.js');
    const log = [], heads = new Map();
    async function open(name) {
      let active = true;
      const lease = { isCurrent: () => active, dispose: async () => { active = false; }, download: async () => new Uint8Array(source),
        snapshot: async () => ({ cursor: log.length, annotations: [...heads.values()] }),
        events: async (_, after) => ({ events: log.slice(after), cursor: log.length, head: log.length, hasMore: false }),
        append: async (_, request) => {
          const old = log.find(e => e.id === request.id); if (old) return old;
          if ((heads.get(request.ann)?.base ?? null) !== request.base) throw Object.assign(new Error('CONFLICT'), { current: heads.get(request.ann)?.base });
          const revision = log.length + 1;
          const e = { ...request, revision, seq: revision, clock: revision, v: 1, uk: name, user: name, at: new Date().toISOString() };
          log.push(e); heads.set(e.ann, { id: e.ann, base: e.id, data: e.data }); return e;
        } };
      const adapter = createCentralPdfAdapter(`${name}.pdf`, {
        createFile: async () => `/central-live-${name}.pdf`, removeFile: async () => {},
        createTab: path => state.documents[createTab(path).index], contains: doc => state.documents.includes(doc),
        close: doc => closeTab(state.documents.indexOf(doc), true),
        load: (doc, path, bytes) => loadPDF(path, state.documents.indexOf(doc), bytes), annotationsReady: doc => doc._annotationCompletion,
        modified: markDocumentModified, redraw: doc => { if (state.documents[state.activeDocumentIndex] === doc) redrawAnnotations(); },
      });
      const opening = createCentralReviewOpening({ retain: () => lease }, '1'.repeat(32), adapter);
      const { resource } = await opening.open(); const service = startCentralReview(opening.connect(), 'editor');
      await opening.close(); await service.retry();
      return { doc: resource.doc, service, lease };
    }
    const a = await open('Alice'), b = await open('Bob');
    a.doc.annotations.push({ id: 'box', type: 'box', page: 1, x: 30, y: 40, width: 80, height: 60, color: '#ff0000', lineWidth: 2, opacity: 100 });
    await a.service.retry(); await b.service.retry();
    const received = b.doc.annotations.find(ann => ann.id === 'box');
    a.doc.annotations[0].color = '#0000ff'; received.color = '#008000';
    await a.service.retry(); await b.service.retry();
    window.liveTest = { a, b, state, closeTab, log };
    return { conflict: b.doc.centralReview.conflicts.length, local: received.color, remote: b.doc.centralReview.conflicts[0]?.remote.color, active: a.lease.isCurrent() && b.lease.isCurrent() };
  }, source);
  assert.deepEqual(initial, { conflict: 1, local: '#008000', remote: '#0000ff', active: true });
  await tab.getByRole('button', { name: /Live central review:/ }).click();
  await tab.getByRole('button', { name: 'Share my current version' }).click();
  await tab.waitForFunction(() => window.liveTest.b.doc.centralReview.conflicts.length === 0 && !window.liveTest.b.doc.centralReview.busy);
  const resolved = await tab.evaluate(async () => { const { a, b, log } = window.liveTest; await a.service.retry(); return { color: a.doc.annotations[0].color, events: log.length, pending: b.doc.centralReview.pending }; });
  assert.deepEqual(resolved, { color: '#008000', events: 3, pending: 0 });
  if (process.env.OPDS_REVIEW_SCREENSHOT) await tab.screenshot({ path: process.env.OPDS_REVIEW_SCREENSHOT });
  await tab.getByRole('button', { name: 'Disconnect and keep local copy' }).click();
  const stopped = await tab.evaluate(async () => {
    const { a, b, state, closeTab } = window.liveTest;
    const preserved = state.documents.includes(b.doc) && b.doc.annotations[0].color === '#008000';
    await closeTab(state.documents.indexOf(a.doc), true);
    return { preserved, aliceReleased: !a.lease.isCurrent(), bobReleased: !b.lease.isCurrent() };
  });
  assert.deepEqual(stopped, { preserved: true, aliceReleased: true, bobReleased: true });
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: two real PDF tabs, automatic publication/replay, reactive conflict UI, explicit resolution, disconnect preservation and tab-close lease disposal');
} finally { await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true }); }
