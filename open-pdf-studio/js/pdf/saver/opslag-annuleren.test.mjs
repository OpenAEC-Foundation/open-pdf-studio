// Een lopende save annuleren (#766): de annulering zelf en hoe ze door de
// fasen van de saver loopt (OCR-laag, tekstbewerkingen, watermerken, het
// opruimen van objecten). Klok en pauze zijn nep: niets hangt van timing af.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument } from 'pdf-lib';

register('../../core/app-test-hooks.mjs', import.meta.url);
// Schermonderdelen (.jsx) leeg, zoals bij de echte-saver-tests.
register('../saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const {
  maakOpslagAnnulering, isOpslagGeannuleerd, OpslagGeannuleerd, GEEN_ANNULERING, SCHRIJVEN_GEANNULEERD,
} = await import('./opslag-annuleren.js');
const { ruimOngebruikteObjectenOp, ruimOngebruikteObjectenOpMetPauzes } = await import('./objecten-opruimen.js');
const { writeOcrLayers } = await import('./ocr-text-layer.js');
const { saveTextEditsToPages } = await import('./text-edits.js');
const { saveWatermarksToPages } = await import('./watermarks.js');

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

/** Een nepklok die bij elke aflezing `stap` ms verder staat, en een pauze die telt. */
function nepKlok({ stap = 0 } = {}) {
  let t = 0;
  const pauzes = { n: 0, bij: null };
  return {
    pauzes,
    opties: {
      nu: () => (t += stap),
      pauze: async () => { pauzes.n++; pauzes.bij?.(pauzes.n); },
      pauzeNaMs: 30,
    },
  };
}

test('a cancelled token throws at the next checkpoint, and only once cancelled', async () => {
  const a = maakOpslagAnnulering(nepKlok().opties);
  a.controleer();
  await a.punt();
  assert.equal(a.kanAnnuleren, true);
  assert.equal(a.annuleer(), true);
  assert.equal(a.geannuleerd, true);
  assert.equal(a.kanAnnuleren, false);
  assert.throws(() => a.controleer(), (e) => e instanceof OpslagGeannuleerd && isOpslagGeannuleerd(e));
  await assert.rejects(a.punt(), OpslagGeannuleerd);
  assert.equal(a.annuleer(), false, 'a second cancel changes nothing');
});

test('punt() only yields to the event loop after the time budget', async () => {
  const klok = nepKlok({ stap: 10 });
  const a = maakOpslagAnnulering(klok.opties);
  for (let i = 0; i < 9; i++) await a.punt();
  // Every reading advances 10 ms: a pause roughly every third checkpoint.
  assert.ok(klok.pauzes.n >= 2 && klok.pauzes.n <= 4, `pauses: ${klok.pauzes.n}`);
  const stil = nepKlok({ stap: 0 });
  const b = maakOpslagAnnulering(stil.opties);
  for (let i = 0; i < 50; i++) await b.punt();
  assert.equal(stil.pauzes.n, 0, 'no pause while the budget is not used up');
});

test('a cancel that arrives during a pause is seen right after it', async () => {
  const klok = nepKlok({ stap: 100 });
  const a = maakOpslagAnnulering(klok.opties);
  klok.pauzes.bij = () => a.annuleer();
  await assert.rejects(a.punt(), OpslagGeannuleerd);
});

test('wacht() stops at once on cancel and ignores the late result', async () => {
  const a = maakOpslagAnnulering(nepKlok().opties);
  const werk = deferred();
  const wachten = a.wacht(werk.promise);
  a.annuleer();
  await assert.rejects(wachten, OpslagGeannuleerd);
  werk.resolve('late');
  // A late rejection is swallowed as well (no unhandled rejection).
  const b = maakOpslagAnnulering(nepKlok().opties);
  const mislukt = deferred();
  const w2 = b.wacht(mislukt.promise);
  b.annuleer();
  await assert.rejects(w2, OpslagGeannuleerd);
  mislukt.reject(new Error('ignored'));
  await new Promise((r) => setImmediate(r));
});

test('wacht() passes the result through when nobody cancels', async () => {
  const a = maakOpslagAnnulering(nepKlok().opties);
  assert.equal(await a.wacht(Promise.resolve(42)), 42);
  await assert.rejects(a.wacht(Promise.reject(new Error('disk'))), /disk/);
});

test('after the commit point a cancel is ignored and reported as too late', () => {
  const a = maakOpslagAnnulering(nepKlok().opties);
  const meldingen = [];
  a.opWijziging((s) => meldingen.push(s));
  a.vastleggen();
  assert.equal(a.vastgelegd, true);
  assert.equal(a.kanAnnuleren, false);
  assert.equal(a.annuleer(), false);
  assert.equal(a.teLaat, true);
  assert.equal(a.geannuleerd, false);
  a.controleer();
  assert.deepEqual(meldingen, ['vastgelegd']);
});

test('committing a cancelled save: before the write it throws, after the write it is "too late"', () => {
  const voor = maakOpslagAnnulering(nepKlok().opties);
  voor.annuleer();
  assert.throws(() => voor.vastleggen(), OpslagGeannuleerd);
  const na = maakOpslagAnnulering(nepKlok().opties);
  na.annuleer();
  na.vastleggen({ naSchrijven: true });
  assert.equal(na.vastgelegd, true);
  assert.equal(na.teLaat, true);
});

test('the Rust write error counts as a cancelled save', () => {
  assert.equal(isOpslagGeannuleerd(new Error(SCHRIJVEN_GEANNULEERD)), true);
  assert.equal(isOpslagGeannuleerd(SCHRIJVEN_GEANNULEERD), true);
  assert.equal(isOpslagGeannuleerd(new Error('disk full')), false);
  assert.equal(isOpslagGeannuleerd(null), false);
});

test('the snapshot token can never be cancelled', async () => {
  assert.equal(GEEN_ANNULERING.annuleer(), false);
  GEEN_ANNULERING.controleer();
  await GEEN_ANNULERING.punt();
  assert.equal(await GEEN_ANNULERING.wacht(Promise.resolve(1)), 1);
  assert.ok(Object.isFrozen(GEEN_ANNULERING));
});

/** Een document met veel losse, onbereikbare objecten. */
async function rommeligDocument(n = 6000) {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  for (let i = 0; i < n; i++) pdf.context.register(pdf.context.obj({ Ballast: i }));
  return pdf;
}

test('object cleanup: checkpoints per batch, and a cancel stops it', async () => {
  const klok = nepKlok({ stap: 100 });
  const a = maakOpslagAnnulering(klok.opties);
  klok.pauzes.bij = (n) => { if (n === 2) a.annuleer(); };
  const pdf = await rommeligDocument();
  await assert.rejects(ruimOngebruikteObjectenOpMetPauzes(pdf, { annulering: a }), OpslagGeannuleerd);
  assert.equal(klok.pauzes.n, 2, 'stopped at the batch where it was cancelled');
});

test('object cleanup with checkpoints gives the same result as without', async () => {
  const pdfA = await rommeligDocument();
  const pdfB = await rommeligDocument();
  const klok = nepKlok({ stap: 100 });
  const a = maakOpslagAnnulering(klok.opties);
  const uitA = await ruimOngebruikteObjectenOpMetPauzes(pdfA, { nieuwVanaf: 3, annulering: a });
  const uitB = ruimOngebruikteObjectenOp(pdfB, { nieuwVanaf: 3 });
  assert.deepEqual(uitA, uitB);
  assert.ok(uitA.verwijderd >= 6000);
  assert.ok(klok.pauzes.n >= 3, `batches with a checkpoint: ${klok.pauzes.n}`);
  const nummers = (pdf) => pdf.context.enumerateIndirectObjects().map(([ref]) => ref.tag);
  assert.deepEqual(nummers(pdfA), nummers(pdfB));
});

/** Telt de veilige punten; annuleert bij het n-de. */
function telAnnulering(annulerenBij = Infinity) {
  const a = maakOpslagAnnulering(nepKlok().opties);
  const punt = a.punt;
  let n = 0;
  a.punt = async () => { n++; if (n >= annulerenBij) a.annuleer(); return punt(); };
  return { a, aantal: () => n };
}

test('OCR text layer: one checkpoint per page, a cancel stops before the next page', async () => {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 3; i++) pdf.addPage([200, 200]);
  // Undone OCR runs: no font needed, every page is visited.
  const doc = { ocrResults: { 1: [], 2: [], 3: [] }, ocrLayerPages: [1, 2, 3] };
  const vrij = telAnnulering();
  const uit = await writeOcrLayers(pdf, pdf.getPages(), doc, { annulering: vrij.a });
  assert.equal(vrij.aantal(), 3);
  assert.deepEqual(uit.layerPages, []);
  const gestopt = telAnnulering(2);
  await assert.rejects(writeOcrLayers(pdf, pdf.getPages(), doc, { annulering: gestopt.a }), OpslagGeannuleerd);
  assert.equal(gestopt.aantal(), 2);
  assert.deepEqual(doc.ocrLayerPages, [1, 2, 3], 'the model is not touched');
});

test('text edits: a cancel stops before the next edit, past the per-edit error guard', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  const edits = [1, 2].map((id) => ({ id, page: 1, baked: false, originalText: 'a', newText: 'b', x: 10, y: 10, width: 20, height: 10 }));
  const doc = { textEdits: edits };
  const t = telAnnulering(1);
  await assert.rejects(saveTextEditsToPages(pdf, pdf.getPages(), doc, { annulering: t.a }), OpslagGeannuleerd);
  assert.equal(t.aantal(), 1);
  assert.ok(edits.every((e) => !e.baked && !e._pendingBakeInfo), 'no edit was baked or prepared');
});

test('watermarks: one checkpoint per page, a cancel stops the loop', async () => {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 4; i++) pdf.addPage([200, 200]);
  const doc = { watermarks: [{ id: 'w', type: 'text', enabled: false, text: 'X' }] };
  const vrij = telAnnulering();
  await saveWatermarksToPages(pdf, pdf.getPages(), doc, { annulering: vrij.a });
  assert.equal(vrij.aantal(), 8, 'two layers of four pages');
  const gestopt = telAnnulering(3);
  await assert.rejects(saveWatermarksToPages(pdf, pdf.getPages(), doc, { annulering: gestopt.a }), OpslagGeannuleerd);
  assert.equal(gestopt.aantal(), 3);
});
