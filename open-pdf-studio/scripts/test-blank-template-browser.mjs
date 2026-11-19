// Een nieuw document in de browserbouw: een zelf gemaakt leeg blad en een
// meegegeven sjabloon (een kader uit de huisstijl kan annotaties hebben).
// - Leeg blad: meteen annoteren en opslaan werkt in de doorlopende weergave.
// - Sjabloon: de annotaties die erin staan worden geladen en blijven bij het
//   opslaan behouden; de pagina's tellen pas als geladen wanneer dat klopt.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument, PDFName } from 'pdf-lib';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);

/** Een sjabloon van één blad met één bestaande rechthoek-annotatie. */
async function maakSjabloon() {
  const pdf = await PDFDocument.create();
  const blad = pdf.addPage([600, 400]);
  const annot = pdf.context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [50, 300, 150, 360],
    C: [0, 0, 1], Border: [0, 0, 2], F: 4, NM: pdf.context.obj('sjabloon-kader'),
    Contents: pdf.context.obj('from the template'),
  });
  blad.node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(annot)]));
  return Array.from(await pdf.save({ useObjectStreams: false }));
}

const cache = await mkdtemp(path.join(tmpdir(), 'opds-blank-template-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error',
  server: { host: '127.0.0.1', port: 18356, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });

  const result = await page.evaluate(async (sjabloon) => {
    const { runAppEvent } = await import('/js/mcp-bridge.js');
    const { getActiveDocument } = await import('/js/core/state.ts');
    // De doorlopende weergave is het pad dat hier getest wordt (de standaard is enkele pagina).
    (await import('/js/core/state.ts')).state.preferences.defaultViewMode = 'continuous';
    const loader = await import('/js/pdf/loader.js');
    const saver = await import('/js/pdf/saver.js');

    async function tekenEnBewaar() {
      const doc = getActiveDocument();
      const gereed = [...(doc._annotationPagesReady || [])];
      const vooraf = doc.annotations.map((a) => a.type);
      const gemaakt = await runAppEvent('mcp:create-annotation', {
        type: 'box', page: 1, props: { x: 300, y: 150, width: 100, height: 80 },
      });
      let bytes = null; let fout = null;
      try {
        const { pdfDocLib } = await saver.bouwAnnotatieDocument(doc);
        bytes = Array.from(await pdfDocLib.save());
      } catch (e) { fout = String(e?.message || e); }
      return { weergave: doc.viewMode, gereed, vooraf, gemaakt: gemaakt.ok, bytes, fout };
    }

    await loader.createBlankPDF(600, 400, 2);
    const leeg = await tekenEnBewaar();
    await loader.createBlankPDF(600, 400, 1, new Uint8Array(sjabloon));
    const metSjabloon = await tekenEnBewaar();
    return { leeg, metSjabloon };
  }, await maakSjabloon());

  const subtypes = async (bytes) => {
    const pdf = await PDFDocument.load(new Uint8Array(bytes));
    const annots = pdf.getPage(0).node.lookup(PDFName.of('Annots'));
    return annots ? annots.asArray().map((ref) => pdf.context.lookup(ref).lookup(PDFName.of('Subtype')).decodeText()) : [];
  };

  // Zelf gemaakt leeg blad: beide pagina's meteen gereed, opslaan lukt.
  assert.equal(result.leeg.weergave, 'continuous');
  assert.deepEqual(result.leeg.gereed.sort(), [1, 2]);
  assert.equal(result.leeg.gemaakt, true);
  assert.equal(result.leeg.fout, null, result.leeg.fout || '');
  assert.equal((await subtypes(result.leeg.bytes)).length, 1);

  // Sjabloon: de annotatie eruit is geladen vóór er iets bij getekend wordt,
  // de pagina is gereed, en na het opslaan staan er twee in het bestand.
  assert.deepEqual(result.metSjabloon.gereed, [1]);
  assert.equal(result.metSjabloon.vooraf.length, 1, `annotations loaded from the template: ${JSON.stringify(result.metSjabloon.vooraf)}`);
  assert.equal(result.metSjabloon.gemaakt, true);
  assert.equal(result.metSjabloon.fout, null, result.metSjabloon.fout || '');
  const naOpslaan = await subtypes(result.metSjabloon.bytes);
  assert.equal(naOpslaan.length, 2, `annotations after saving: ${JSON.stringify(naOpslaan)}`);

  console.log(JSON.stringify({ passed: true, leeg: result.leeg.gereed, sjabloonVooraf: result.metSjabloon.vooraf, naOpslaan }));
} finally {
  await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true });
}
