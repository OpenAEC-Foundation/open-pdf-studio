// OCR-engines uit extensies (#970): het register, de keuze van de engine, de
// terugval op de ingebouwde Tesseract en de plug-in-API (registerOcrEngine,
// unregisterOcrEngine, readAsset) door de echte plugin-api.js heen.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../plugins/plugin-api-stubs.mjs', import.meta.url);

const laad = (pad) => import(new URL(pad, import.meta.url).href);
const ocr = await laad('./ocr-engines.js');
const { createPluginApi } = await laad('../plugins/plugin-api.js');
const { isVeiligAssetPad } = await laad('../plugins/plugin-assets.js');
const staat = globalThis.__stubState;

let ingebouwdAanroepen;
let waarschuwingen;
let tegels;
function opnieuw({ voorkeur = null } = {}) {
  ocr._wisOcrEngines();
  ingebouwdAanroepen = [];
  waarschuwingen = [];
  tegels = [];
  staat.preferences = { ocrEngine: voorkeur };
  ocr._zetOcrHost({
    ingebouwd: async (args) => { ingebouwdAanroepen.push(args); return [{ text: 'tess', left: 1, top: 2, width: 3, height: 4, confidence: 91 }]; },
    renderTile: async (...args) => { tegels.push(args); return { blob: null, width: 10, height: 10 }; },
    waarschuw: (...args) => waarschuwingen.push(args.join(' ')),
  });
}

function maakDocument(id = 'd1') {
  return {
    id, filePath: `C:/tmp/${id}.pdf`,
    pdfDoc: { numPages: 3, getPage: async () => ({ getViewport: ({ scale }) => ({ width: 600 * scale, height: 400 * scale }) }) },
  };
}

const engine = (extra = {}) => ({ id: 'vast', label: 'Fixed words', recognize: async () => [{ text: 'A1-1', left: 72, top: 70, width: 30, height: 12, confidence: 96 }], ...extra });

test('register: validation, full id, built-in first, removal and change notifications', () => {
  opnieuw();
  const meldingen = [];
  const af = ocr.onOcrEnginesChanged(() => meldingen.push(ocr.lijstOcrEngines().length));
  assert.throws(() => ocr.registreerOcrEngine('ext.a', { ...engine(), id: '../x' }), /id/);
  assert.throws(() => ocr.registreerOcrEngine('ext.a', { ...engine(), label: ' ' }), /label/);
  assert.throws(() => ocr.registreerOcrEngine('ext.a', { ...engine(), recognize: 'no' }), /recognize/);
  const id = ocr.registreerOcrEngine('ext.a', engine({ languages: ['eng', 5], region: true }));
  assert.equal(id, 'ext.a:vast');
  assert.throws(() => ocr.registreerOcrEngine('ext.a', engine()), /already registered/);
  // Een andere extensie mag hetzelfde korte id gebruiken.
  assert.equal(ocr.registreerOcrEngine('ext.b', engine()), 'ext.b:vast');
  const lijst = ocr.lijstOcrEngines();
  assert.deepEqual(lijst.map((e) => e.id), [ocr.INGEBOUWD, 'ext.a:vast', 'ext.b:vast']);
  assert.deepEqual(lijst[1], { id: 'ext.a:vast', label: 'Fixed words', languages: ['eng'], region: true });
  assert.equal(lijst[2].region, false);
  assert.equal(ocr.verwijderOcrEngine('ext.b:vast'), true);
  assert.equal(ocr.verwijderOcrEngine('ext.b:vast'), false);
  af();
  ocr.registreerOcrEngine('ext.c', engine());
  assert.deepEqual(meldingen, [2, 3, 2]);
});

test('without a preferred engine the built-in Tesseract runs exactly as before', async () => {
  opnieuw();
  ocr.registreerOcrEngine('ext.a', engine());
  const doc = maakDocument();
  globalThis.__actiefDocument = doc;
  const woorden = await ocr.herkenPagina(doc, 2, { lang: 'eng' });
  assert.deepEqual(ingebouwdAanroepen, [{ path: doc.filePath, pageIndex: 1, lang: 'eng' }]);
  assert.equal(woorden[0].text, 'tess');
  assert.equal(ocr.actieveOcrEngine(), null);
});

test('the preferred engine gets the request in built-in word space and its output is validated', async () => {
  opnieuw({ voorkeur: 'ext.a:vast' });
  let verzoek;
  ocr.registreerOcrEngine('ext.a', engine({
    region: true,
    async recognize(request) {
      verzoek = request;
      await request.renderTile({ x: 0, y: 0, width: 100, height: 50 }, { scale: 2 });
      return [
        { text: 'A1-1', left: 72, top: 70, width: 30, height: 12, confidence: 96 },
        { text: 'hoog', left: 1, top: 1, width: 1, height: 1, confidence: 250 },
        { text: 'geen zekerheid', left: 1, top: 1, width: 1, height: 1 },
        { text: '  ', left: 1, top: 1, width: 1, height: 1, confidence: 50 },
        { text: 'NaN', left: Number.NaN, top: 1, width: 1, height: 1 },
        { text: 'negatief', left: 1, top: 1, width: -1, height: 1 },
        null,
      ];
    },
  }));
  const doc = maakDocument();
  globalThis.__actiefDocument = doc;
  const signal = new AbortController().signal;
  const woorden = await ocr.herkenPagina(doc, 1, { lang: 'auto', region: { x: 10, y: 20, width: 30, height: 40, extra: 1 }, signal });
  assert.equal(ingebouwdAanroepen.length, 0);
  assert.deepEqual(woorden.map((w) => [w.text, w.confidence]), [['A1-1', 96], ['hoog', 100], ['geen zekerheid', 0]]);
  assert.equal(verzoek.documentId, 'd1');
  assert.equal(verzoek.pageNum, 1);
  assert.equal(verzoek.lang, 'auto');
  assert.deepEqual(verzoek.page, { width: 600, height: 400 });
  assert.deepEqual(verzoek.region, { x: 10, y: 20, width: 30, height: 40 });
  assert.equal(verzoek.signal, signal);
  // renderTile: hetzelfde document en dezelfde pagina, zonder app-draaiing.
  const [tDoc, tPagina, tRect, tOpties] = tegels[0];
  assert.equal(tDoc, doc);
  assert.equal(tPagina, 1);
  assert.deepEqual(tRect, { x: 0, y: 0, width: 100, height: 50 });
  assert.equal(tOpties.scale, 2);
  assert.equal(tOpties.rotation, 0);
  assert.equal(tOpties.signal, signal);
  assert.equal(tOpties.isCurrent(doc), true);
  assert.equal(tOpties.isCurrent(maakDocument('ander')), false);
});

test('engines without region support read the whole page', async () => {
  opnieuw({ voorkeur: 'ext.a:vast' });
  let verzoek;
  ocr.registreerOcrEngine('ext.a', engine({ async recognize(r) { verzoek = r; return []; } }));
  const doc = maakDocument();
  globalThis.__actiefDocument = doc;
  assert.deepEqual(await ocr.herkenPagina(doc, 1, { region: { x: 1, y: 1, width: 1, height: 1 } }), []);
  assert.equal(verzoek.region, null);
});

test('a failing, missing or inapplicable engine falls back to the built-in one', async () => {
  const doc = maakDocument();
  globalThis.__actiefDocument = doc;

  opnieuw({ voorkeur: 'ext.a:vast' });
  ocr.registreerOcrEngine('ext.a', engine({ async recognize() { throw new Error('model missing'); } }));
  assert.equal((await ocr.herkenPagina(doc, 1))[0].text, 'tess');
  assert.equal(ingebouwdAanroepen.length, 1);
  assert.match(waarschuwingen[0], /Fixed words failed, using the built-in engine: model missing/);

  // Geen woordenlijst terug: ook terugvallen.
  opnieuw({ voorkeur: 'ext.a:vast' });
  ocr.registreerOcrEngine('ext.a', engine({ async recognize() { return 'tekst'; } }));
  assert.equal((await ocr.herkenPagina(doc, 1))[0].text, 'tess');
  assert.match(waarschuwingen[0], /no word list/);

  // Voorkeur voor een engine die niet (meer) geïnstalleerd is.
  opnieuw({ voorkeur: 'ext.weg:vast' });
  assert.equal((await ocr.herkenPagina(doc, 1))[0].text, 'tess');
  assert.equal(waarschuwingen.length, 0);

  // Gedraaid lezen (#954) en een niet-actief document: altijd ingebouwd.
  opnieuw({ voorkeur: 'ext.a:vast' });
  let aangeroepen = 0;
  ocr.registreerOcrEngine('ext.a', engine({ async recognize() { aangeroepen++; return []; } }));
  await ocr.herkenPagina(doc, 3, { lang: 'auto', rotation: 90 });
  assert.deepEqual(ingebouwdAanroepen[0], { path: doc.filePath, pageIndex: 2, lang: 'auto', rotation: 90 });
  globalThis.__actiefDocument = maakDocument('ander');
  await ocr.herkenPagina(doc, 1);
  assert.equal(ingebouwdAanroepen.length, 2);
  assert.equal(aangeroepen, 0);

  // Zonder bestand geen ingebouwde OCR.
  assert.deepEqual(await ocr.herkenPagina({ ...doc, filePath: null }, 1), []);
});

test('an aborted request is not hidden by the fallback', async () => {
  opnieuw({ voorkeur: 'ext.a:vast' });
  const doc = maakDocument();
  globalThis.__actiefDocument = doc;
  const ctrl = new AbortController();
  ocr.registreerOcrEngine('ext.a', engine({ async recognize() { ctrl.abort(); throw new DOMException('stop', 'AbortError'); } }));
  await assert.rejects(ocr.herkenPagina(doc, 1, { signal: ctrl.signal }), /stop/);
  assert.equal(ingebouwdAanroepen.length, 0);
});

test('plugin API: feature flags, registration in the contribution scope, unload removes the engine', async () => {
  opnieuw();
  const api = createPluginApi('nl.test.ocr');
  assert.equal(api.features.ocrEngines, true);
  assert.equal(api.features.assets, true);
  const id = await api.registerOcrEngine(engine());
  assert.equal(id, 'nl.test.ocr:vast');
  assert.ok(ocr.lijstOcrEngines().some((e) => e.id === id));
  await assert.rejects(api.registerOcrEngine(engine()), /already registered/);
  assert.equal(api.unregisterOcrEngine('vast'), true);
  assert.equal(api.unregisterOcrEngine('vast'), false);
  assert.ok(!ocr.lijstOcrEngines().some((e) => e.id === id));
  // Een andere extensie kan de engine van deze niet weghalen.
  await api.registerOcrEngine(engine());
  const ander = createPluginApi('nl.test.ander');
  assert.equal(ander.unregisterOcrEngine('nl.test.ocr:vast'), false);
  assert.ok(ocr.lijstOcrEngines().some((e) => e.id === id));
  // Uitladen (en herladen) ruimt de engine op; daarna weigert de API.
  api._cleanup();
  assert.ok(!ocr.lijstOcrEngines().some((e) => e.id === id));
  await assert.rejects(api.registerOcrEngine(engine()), (e) => e.code === 'EXTENSION_INACTIVE');
  assert.ok(!ocr.lijstOcrEngines().some((e) => e.id === id));
  ander._cleanup();
});

test('readAsset refuses paths outside the extension before calling the host', async () => {
  const api = createPluginApi('nl.test.asset');
  for (const pad of ['../x', 'a/../../x', '/abs', '\\abs', 'C:/x', 'C:x', 'a\\..\\b', './a', 'a//b', '', 'a\0b', 5, null]) {
    await assert.rejects(api.readAsset(pad), /relative path inside the extension/, String(pad));
  }
  api._cleanup();
  for (const pad of ['model.onnx', 'models/det.onnx', 'wasm\\ort.wasm', 'a.b/c..d']) assert.equal(isVeiligAssetPad(pad), true, pad);
  assert.equal(isVeiligAssetPad('x'.repeat(513)), false);
});
