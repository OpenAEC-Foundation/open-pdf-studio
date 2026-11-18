// Papiermaat in mm, cm, in of pt in het eigenschappenpaneel (GitHub #598).
//
// De echte state-store en het eigenschappenpaneel draaien hier onder node met
// de laadhaken van de app (zie ../../core/app-test-hooks.mjs); de voorkeuren-
// module is een stub die zijn aanroepen telt.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../core/state.ts');
const { DEFAULT_PREFERENCES } = await import('../../core/constants.ts');
const { storeShowProperties, annotProps, updateAnnotProp } = await import('./propertiesStore.js');
const { papierEenheid, kiesPapierEenheid, hydratePapierEenheid } = await import('./papierEenheidStore.js');
const { toonInEenheid } = await import('../../annotations/papiermaat-eenheid.js');

const bijna = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const wacht = () => new Promise(r => setTimeout(r, 0));
// Opslaan loopt via een dynamische import; onder volle testlast duurt die
// langer dan één timer-tik. Wacht tot de teller stil staat.
async function wachtTotStil(lees, ms = 2000) {
  let vorige = lees();
  for (let t = 0; t < ms; t += 25) {
    await new Promise(r => setTimeout(r, 25));
    const nu = lees();
    if (nu === vorige && t >= 100) return nu;
    vorige = nu;
  }
  return lees();
}
const opslagen = () => globalThis.__stubCalls?.savePreferences || 0;

function openen(annotations) {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations,
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

/** Afbeelding van 216 x 108 pt (3 x 1,5 in), origineel 400 x 200 (2:1). */
function afbeelding(extra = {}) {
  return {
    id: `img-${Math.random().toString(36).slice(2, 8)}`, type: 'image', page: 1,
    x: 50, y: 60, width: 216, height: 108, originalWidth: 400, originalHeight: 200,
    rotation: 0, opacity: 1, lockAspectRatio: false,
    createdAt: '2026-10-01T10:00:00.000Z', modifiedAt: '2026-10-01T10:00:00.000Z',
    ...extra,
  };
}

function selecteer(ann) {
  const doc = openen([ann]);
  doc.selectedAnnotation = ann;
  doc.selectedAnnotations = [ann];
  storeShowProperties(ann);
  return doc;
}

test.beforeEach(() => {
  state.preferences = { ...DEFAULT_PREFERENCES };
  hydratePapierEenheid();
});

test('standaard mm; het paneelmodel blijft in paginapunten', () => {
  assert.equal(DEFAULT_PREFERENCES.paperSizeUnit, 'mm');
  assert.equal(papierEenheid(), 'mm');
  const ann = afbeelding();
  selecteer(ann);
  assert.equal(annotProps.imageWidth, 216);
  assert.equal(annotProps.imageHeight, 108);
});

test('eenheid wisselen verandert maat en positie van de afbeelding niet', async () => {
  const ann = afbeelding();
  const doc = selecteer(ann);
  const voor = JSON.stringify(ann);
  const undo = doc.undoStack.length;
  for (const u of ['mm', 'cm', 'in', 'pt', 'mm']) {
    kiesPapierEenheid(u);
    assert.equal(papierEenheid(), u);
    assert.equal(JSON.stringify(ann), voor, u);
    assert.equal(annotProps.imageWidth, 216, u);
    assert.equal(annotProps.imageHeight, 108, u);
  }
  await wacht();
  assert.equal(doc.undoStack.length, undo, 'geen ongedaan-stap voor een weergavekeuze');
  assert.equal(toonInEenheid(annotProps.imageWidth, 'mm'), 76.2);
  assert.equal(toonInEenheid(annotProps.imageWidth, 'in'), 3);
});

test('de keuze wordt een voorkeur en overleeft een herstart', async () => {
  const voor = await wachtTotStil(opslagen);   // opslagen uit eerdere tests eerst afronden
  kiesPapierEenheid('cm');
  assert.equal(state.preferences.paperSizeUnit, 'cm');
  assert.equal(await wachtTotStil(opslagen), voor + 1, 'voorkeuren opgeslagen');
  kiesPapierEenheid('cm');
  assert.equal(await wachtTotStil(opslagen), voor + 1, 'dezelfde keuze slaat niet opnieuw op');
  // "Herstart": voorkeuren opnieuw geladen, signaal opnieuw gezet.
  const geladen = JSON.parse(JSON.stringify(state.preferences));
  state.preferences = { ...DEFAULT_PREFERENCES, ...geladen };
  hydratePapierEenheid();
  assert.equal(papierEenheid(), 'cm');
  // Onzin in het bestand wordt de standaard.
  state.preferences.paperSizeUnit = 'parsec';
  hydratePapierEenheid();
  assert.equal(papierEenheid(), 'pt');
});

test('de keuze blijft bij een andere selectie staan', () => {
  kiesPapierEenheid('in');
  selecteer(afbeelding());
  selecteer(afbeelding({ width: 72, height: 36 }));
  assert.equal(papierEenheid(), 'in');
  assert.equal(toonInEenheid(annotProps.imageWidth, papierEenheid()), 1);
});

test('getypte breedte in de gekozen eenheid geeft de juiste fysieke maat', () => {
  for (const [u, invoer] of [['mm', '50.8'], ['cm', '5.08'], ['in', '2'], ['pt', '144']]) {
    kiesPapierEenheid(u);
    const ann = afbeelding();
    selecteer(ann);
    updateAnnotProp('imageWidth', invoer);
    assert.ok(bijna(ann.width, 144), `${u}: ${ann.width}`);
    assert.equal(ann.height, 108, `${u}: zonder vaste verhouding blijft de hoogte`);
    assert.equal(ann.x, 50); assert.equal(ann.y, 60);
    assert.ok(bijna(annotProps.imageWidth, 144), 'store in paginapunten, niet de getypte tekst');
  }
});

test('met vaste verhouding volgt de partner-as in elke eenheid', () => {
  for (const [u, invoer] of [['mm', '25.4'], ['cm', '2.54'], ['in', '1'], ['pt', '72']]) {
    kiesPapierEenheid(u);
    const ann = afbeelding({ lockAspectRatio: true });
    selecteer(ann);
    updateAnnotProp('imageHeight', invoer);
    assert.ok(bijna(ann.height, 72), `${u}: ${ann.height}`);
    assert.ok(bijna(ann.width, 144), `${u}: ${ann.width}`);
    assert.ok(bijna(annotProps.imageWidth, 144), u);
    assert.ok(bijna(annotProps.imageHeight, 72), u);
    assert.ok(bijna(toonInEenheid(annotProps.imageWidth, u), Number(invoer) * 2), u);

    updateAnnotProp('imageWidth', invoer);
    assert.ok(bijna(ann.width, 72), u);
    assert.ok(bijna(ann.height, 36), u);
  }
});

test('decimalen, en tussenstanden tijdens het typen laten het model met rust', () => {
  kiesPapierEenheid('mm');
  const ann = afbeelding({ lockAspectRatio: true });
  selecteer(ann);
  for (const tussen of ['', '0', '0.', '0,']) {
    updateAnnotProp('imageWidth', tussen);
    assert.equal(ann.width, 216, JSON.stringify(tussen));
    assert.equal(ann.height, 108, JSON.stringify(tussen));
    assert.equal(annotProps.imageWidth, 216, JSON.stringify(tussen));
  }
  updateAnnotProp('imageWidth', '12,7');
  assert.ok(bijna(ann.width, 36));
  assert.ok(bijna(ann.height, 18));
});

test('een heel kleine afbeelding toont in inch geen 0', () => {
  kiesPapierEenheid('in');
  selecteer(afbeelding({ width: 0.4, height: 0.2 }));
  assert.ok(toonInEenheid(annotProps.imageWidth, 'in') > 0);
  assert.ok(toonInEenheid(annotProps.imageHeight, 'in') > 0);
});

test('vaste verhouding aanzetten zet de hoogte in paginapunten in de store', () => {
  kiesPapierEenheid('mm');
  const ann = afbeelding({ width: 200, height: 50 });
  selecteer(ann);
  updateAnnotProp('lockAspectRatio', true);
  assert.equal(ann.height, 100);
  assert.equal(annotProps.imageHeight, 100);
});

test('schaalbalk: balkhoogte in paginapunten met decimalen, ondergrens 4 pt', () => {
  const balk = { id: 'sb-1', type: 'scaleBar', page: 1, x: 10, y: 10, width: 200, height: 14, unit: 'mm', totalUnits: 5000, divisions: 5 };
  selecteer(balk);
  assert.equal(annotProps.scaleBarHeight, 14);
  updateAnnotProp('scaleBarHeight', 5 * 72 / 25.4);   // 5 mm
  assert.ok(bijna(balk.height, 14.173228346456693));
  assert.ok(bijna(annotProps.scaleBarHeight, balk.height));
  updateAnnotProp('scaleBarHeight', 1);
  assert.equal(balk.height, 4);
  assert.equal(annotProps.scaleBarHeight, 4, 'store toont de geklemde waarde');
});
