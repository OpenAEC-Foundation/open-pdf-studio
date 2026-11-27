// Het wandgereedschap op een blad in voet of inch (#1230).
//
// - De standaardwand volgt de conventie van het blad op het eerste klikpunt:
//   6 inch zonder arcering op een imperiaal blad, 100 mm metselwerk op een
//   metrisch blad. Een paletwand of een gekozen dikte wint.
// - De locatielijn (hartlijn, linkervlak, rechtervlak) bepaalt welke lijn de
//   klikken volgen; een loop op een vlak sluit in de hoeken, in een
//   ongedaan-stap per wand.
// - Metrische bladen en de hartlijn blijven precies zoals ze waren.
//
// Het echte gereedschap, de annotatiemaker, de schaalopzoeking en de
// undo-stapel draaien hier onder node (zie ../../core/app-test-hooks.mjs).

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
register('../../pdf/saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../core/state.ts');
const { createAnnotationFromTool } = await import('../annotation-creators.js');
const { recordAdd, undo, redo } = await import('../../core/undo-manager.js');
const { invalidateScaleRegionCache } = await import('../../annotations/scale-region.js');
const { stelSchaalSysteemBronIn } = await import('../../annotations/scale-presets.js');
const { isImperiaalBladOpPunt, isImperiaalBladOpPagina } = await import('../../plattegrond/blad-conventie-op-punt.js');
const { wandBladImperiaal, meldWandPagina } = await import('../../solid/stores/wandOptiesStore.js');
const { ruimtenUitWanden } = await import('../../plattegrond/ruimte.js');
const { lineTool } = await import('./line-tool.js');

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// 1/4" = 1'-0": 18 paginapunten per voet. 1:50 metrisch: 72 / 25,4 / 50 punt per mm.
const VOET = { pixelsPerUnit: 18, unit: 'ft' };
const METRISCH = { pixelsPerUnit: 72 / 25.4 / 50, unit: 'mm' };
const PX_PER_MM_VOET = 18 / 304.8;
const bijna = (a, b, wat, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${wat}: ${a} ≈ ${b}`);

function openen(measureScale, annotaties = []) {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations: annotaties,
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale,
  }];
  state.activeDocumentIndex = 0;
  state.currentTool = 'wall';
  state.toolOverrides = null;
  Object.assign(state.preferences, {
    enableObjectSnap: false, enableGridSnap: false, polarTrackingEnabled: false, enableAngleSnap: false,
    wallLocationLine: 'center',
  });
  invalidateScaleRegionCache();
}

const wand = (sx, sy, ex, ey) => createAnnotationFromTool('wall', sx, sy, ex, ey, {});

test('op een blad in voet tekent het gereedschap een kale wand van 6 inch', () => {
  openen(VOET);
  const w = wand(100, 200, 460, 200);
  assert.equal(w.type, 'wall');
  assert.equal(w.dikteMm, 152.4);
  assert.equal(w.hatchPattern, 'none');
  assert.deepEqual([w.startX, w.startY, w.endX, w.endY], [100, 200, 460, 200], 'op de hartlijn');
  assert.equal(w.ifcCategory, 'IfcWall');
  // Een blad in inch telt ook.
  openen({ pixelsPerUnit: 1.5, unit: 'in' });
  assert.equal(wand(100, 200, 460, 200).dikteMm, 152.4);
});

test('metrisch blijft: 100 mm metselwerk, ook zonder schaal', () => {
  for (const schaal of [METRISCH, { pixelsPerUnit: 2.8346, unit: 'm' }, null]) {
    openen(schaal);
    const w = wand(100, 200, 460, 200);
    assert.equal(w.dikteMm, 100);
    assert.equal(w.hatchPattern, 'nen47-metselwerk-baksteen');
    assert.deepEqual([w.startX, w.startY, w.endX, w.endY], [100, 200, 460, 200]);
    assert.equal(w.lineWidth, 0.7);
    assert.equal(w.strokeColor, '#000000');
  }
});

test('een paletwand of een gekozen dikte wint van de standaard', () => {
  openen(VOET);
  // Zoals SymbolPalette.jsx de paletwand start.
  state.toolOverrides = { wallPattern: 'nen47-metselwerk-baksteen', wallDikteMm: 100, ifcCategory: 'IfcWall', symbolInsert: true };
  let w = wand(100, 200, 460, 200);
  assert.equal(w.dikteMm, 100);
  assert.equal(w.hatchPattern, 'nen47-metselwerk-baksteen');
  // Alleen een dikte uit de lijst: de wand blijft kaal.
  state.toolOverrides = { wallDikteMm: 203.2 };
  w = wand(100, 200, 460, 200);
  assert.equal(w.dikteMm, 203.2);
  assert.equal(w.hatchPattern, 'none');
  // Alleen een materiaal: de dikte blijft 6 inch.
  state.toolOverrides = { wallPattern: 'nen47-beton-gewapend' };
  w = wand(100, 200, 460, 200);
  assert.equal(w.dikteMm, 152.4);
  assert.equal(w.hatchPattern, 'nen47-beton-gewapend');
  // Metrisch met alleen een dikte: metselwerk, zoals altijd.
  openen(METRISCH);
  state.toolOverrides = { wallDikteMm: 300 };
  w = wand(100, 200, 460, 200);
  assert.equal(w.dikteMm, 300);
  assert.equal(w.hatchPattern, 'nen47-metselwerk-baksteen');
  state.toolOverrides = null;
});

test('de voorkeur Imperiaal maakt ook een metrisch blad imperiaal', () => {
  openen(METRISCH);
  try {
    stelSchaalSysteemBronIn(() => 'imperial');
    assert.equal(isImperiaalBladOpPunt(1, 100, 200), true);
    const w = wand(100, 200, 460, 200);
    assert.equal(w.dikteMm, 152.4);
    assert.equal(w.hatchPattern, 'none');
    stelSchaalSysteemBronIn(() => 'metric');
    assert.equal(wand(100, 200, 460, 200).dikteMm, 100);
  } finally {
    stelSchaalSysteemBronIn(null);
  }
});

test('de schaal op het eerste klikpunt beslist: een schaalgebied in voet op een metrisch blad', () => {
  const gebied = {
    id: 'sr', type: 'scaleRegion', page: 1, x: 300, y: 0, width: 300, height: 400, scaleString: '1:48', units: 'ft',
  };
  openen(METRISCH, [gebied]);
  assert.equal(isImperiaalBladOpPunt(1, 400, 200), true);
  assert.equal(isImperiaalBladOpPunt(1, 100, 200), false);
  assert.equal(wand(400, 200, 500, 200).dikteMm, 152.4, 'in het gebied');
  assert.equal(wand(100, 200, 200, 200).dikteMm, 100, 'erbuiten');
  // Zonder cursor beslist het grootste schaalgebied van de pagina.
  assert.equal(isImperiaalBladOpPagina(1), true);
  meldWandPagina(1);
  assert.equal(wandBladImperiaal(), true);
  openen(METRISCH);
  assert.equal(isImperiaalBladOpPagina(1), false);
  openen(VOET);
  assert.equal(isImperiaalBladOpPagina(1), true);
});

test('linkervlak: van links naar rechts getekend ligt het lichaam onder de geklikte lijn', () => {
  openen(VOET);
  state.preferences.wallLocationLine = 'left';
  const w = wand(100, 200, 460, 200);
  // 6 inch op 1/4" = 1'-0" is 9 punt dik: de hartlijn ligt 4,5 punt lager.
  bijna(w.startY, 204.5, 'startY'); bijna(w.endY, 204.5, 'endY');
  assert.deepEqual([w.startX, w.endX], [100, 460]);
  state.preferences.wallLocationLine = 'right';
  bijna(wand(100, 200, 460, 200).startY, 195.5, 'rechtervlak');
  // Metrisch werkt het net zo, met de eigen dikte: 100 mm op 1:50 is 5,67 punt.
  openen(METRISCH);
  state.preferences.wallLocationLine = 'left';
  bijna(wand(100, 200, 460, 200).startY, 200 + (100 * METRISCH.pixelsPerUnit) / 2, 'metrisch linkervlak');
});

test('de hartlijn is de standaard en blijft zoals hij was', () => {
  assert.match(lees('../../core/constants.ts'), /\n\s*wallLocationLine: 'center',/);
  assert.match(lees('../../types/preferences.ts'), /wallLocationLine: 'center' \| 'left' \| 'right';/);
  for (const schaal of [VOET, METRISCH]) {
    openen(schaal);
    for (const lijn of ['center', undefined, 'onzin']) {
      state.preferences.wallLocationLine = lijn;
      const w = wand(100, 200, 460, 300);
      assert.deepEqual([w.startX, w.startY, w.endX, w.endY], [100, 200, 460, 300], String(lijn));
    }
  }
  state.preferences.wallLocationLine = 'center';
});

// ── het gereedschap zelf ─────────────────────────────────────────────────

function ctxBij(x, y) {
  return {
    x, y, state, pageNum: 1, scale: 1,
    snap: () => ({ snapped: false, x, y }),
    snapToGrid: (v) => v,
    snapAngle: (a) => a,
    setPolarAnchor() {}, clearPolarAnchor() {},
    redraw() {}, drawSnapIndicator() {}, drawShapePreview() {},
    createAnnotationFromTool,
    recordAdd,
  };
}

const ev = { button: 0, shiftKey: false, ctrlKey: false, altKey: false, preventDefault() {} };

function klik(x, y) {
  state.startX = x;
  state.startY = y;
  lineTool.onPointerDown(ctxBij(x, y), ev);
}

function stop() {
  lineTool.onPointerDown(ctxBij(0, 0), { ...ev, button: 2 });
}

const wanden = () => state.documents[0].annotations.filter((a) => a.type === 'wall');

test('een loop op de binnenvlakken, met het gereedschap getekend, sluit tot een ruimte', async () => {
  openen(VOET);
  state.preferences.wallLocationLine = 'left';
  // Binnenmaat 19'-6" x 13'-6" (351 x 243 punt), tegen de klok in.
  for (const [x, y] of [[100, 100], [100, 343], [451, 343], [451, 100], [100, 100]]) klik(x, y);
  stop();
  const lijst = wanden();
  assert.equal(lijst.length, 4);
  for (const w of lijst) {
    assert.equal(w.dikteMm, 152.4);
    assert.equal(w.hatchPattern, 'none');
  }
  const hoeken = [[95.5, 95.5], [95.5, 347.5], [455.5, 347.5], [455.5, 95.5]];
  lijst.forEach((w, i) => {
    const van = hoeken[i], naar = hoeken[(i + 1) % 4];
    bijna(w.startX, van[0], `wand ${i} startX`); bijna(w.startY, van[1], `wand ${i} startY`);
    bijna(w.endX, naar[0], `wand ${i} endX`); bijna(w.endY, naar[1], `wand ${i} endY`);
  });
  const { ruimten, losseEinden } = ruimtenUitWanden(lijst, { pxPerMm: PX_PER_MM_VOET });
  assert.equal(ruimten.length, 1);
  assert.deepEqual(losseEinden, []);
  bijna(ruimten[0].oppervlakteM2 / (0.3048 * 0.3048), 263.25, 'netto ft²', 1e-6);

  // Elke wand is een ongedaan-stap, met het bijgestelde uiteinde erbij.
  const stapel = state.documents[0].undoStack;
  assert.equal(stapel.length, 4);
  assert.equal(stapel[0].type, 'addAnnotation', 'de eerste wand raakt niets anders');
  assert.equal(stapel[1].type, 'compound');
  assert.deepEqual(stapel[3].commands.map((c) => c.type), ['addAnnotation', 'bulkModify']);
  assert.equal(stapel[3].commands[1].items.length, 2, 'de laatste wand sluit op de derde en op de eerste');

  // Ongedaan maken haalt de laatste wand weg en zet de buren terug.
  await undo();
  const na = wanden();
  assert.equal(na.length, 3);
  bijna(na[0].startX, 95.5, 'eerste wand begint weer op haar eigen hartlijn');
  bijna(na[0].startY, 100, 'eerste wand begint weer op het geklikte punt');
  bijna(na[2].endX, 455.5, 'derde wand op haar eigen hartlijn');
  bijna(na[2].endY, 100, 'derde wand eindigt weer op de hoogte van het geklikte punt');
  await redo();
  assert.equal(wanden().length, 4);
  bijna(wanden()[0].startY, 95.5, 'opnieuw gesloten');
});

test('hartlijn blijft: een loop op de hartlijn raakt geen andere wand en is een stap per wand', () => {
  for (const schaal of [VOET, METRISCH]) {
    openen(schaal);
    const punten = [[100, 100], [460, 100], [460, 352], [100, 352], [100, 100]];
    for (const [x, y] of punten) klik(x, y);
    stop();
    const lijst = wanden();
    assert.equal(lijst.length, 4);
    lijst.forEach((w, i) => {
      assert.deepEqual([w.startX, w.startY, w.endX, w.endY], [...punten[i], ...punten[i + 1]], `wand ${i}`);
    });
    assert.deepEqual(state.documents[0].undoStack.map((c) => c.type), Array(4).fill('addAnnotation'));
  }
});

test('een kamer van 20 x 14 voet op de hartlijnen, met het gereedschap getekend: 263 SF netto', () => {
  openen(VOET);
  for (const [x, y] of [[100, 100], [460, 100], [460, 352], [100, 352], [100, 100]]) klik(x, y);
  stop();
  const { ruimten } = ruimtenUitWanden(wanden(), { pxPerMm: PX_PER_MM_VOET });
  assert.equal(ruimten.length, 1);
  assert.equal(Math.round(ruimten[0].oppervlakteM2 / (0.3048 * 0.3048)), 263);
});

// ── de opties in het lint en het paneel ──────────────────────────────────

test('het lint toont de wandopties alleen bij het wandgereedschap', () => {
  const tab = lees('../../solid/components/ribbon/DrawingTab.jsx');
  assert.match(tab, /import WallRibbonControls from '\.\/WallRibbonControls\.jsx';/);
  assert.match(tab, /<Show when=\{state\.currentTool === 'wall'\}>\s*<RibbonGroup label=\{tProperties\('quantities\.type\.wall'\)\}>\s*<WallRibbonControls \/>/);
  const opties = lees('../../solid/components/ribbon/WallRibbonControls.jsx');
  // De diktelijst volgt het blad; de dikte gaat via toolOverrides, het kanaal
  // van de paletwand.
  assert.match(opties, /wanddikteKeuzes\(imperiaal\(\), soortNaam\)/);
  assert.match(opties, /state\.toolOverrides = \{ \.\.\.\(state\.toolOverrides \|\| \{\}\), wallDikteMm: mm \}/);
  // De locatielijn is een voorkeur met de hartlijn als standaard.
  assert.match(opties, /state\.preferences\.wallLocationLine = normaliseerLocatielijn\(waarde\);\s*savePreferences\(\);/);
  assert.match(opties, /id="wall-thickness-select"/);
  assert.match(opties, /id="wall-location-line-select"/);
  // Het eigenschappenpaneel biedt dezelfde lijst voor een bestaande wand.
  const paneel = lees('../../solid/components/properties-panel/WallSection.jsx');
  assert.match(paneel, /wanddikteKeuzes\(imperiaal\(\), soortNaam\)/);
  assert.match(paneel, /isImperiaalBladOpPunt\(w\.page, w\.startX, w\.startY\)/);
});

test('elke taal heeft de teksten van de wandopties', () => {
  const LOCALES = new URL('../../i18n/locales/', import.meta.url);
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  const json = (taal, bestand) => JSON.parse(readFileSync(new URL(`${taal}/${bestand}.json`, LOCALES), 'utf8'));
  const lint = ['wallThickness', 'wallThicknessTip', 'wallLocationLine', 'wallLocationLineTip',
    'wallLocationCenter', 'wallLocationLeft', 'wallLocationRight'];
  for (const taal of talen) {
    const r = json(taal, 'ribbon').drawing;
    for (const k of lint) assert.ok(typeof r?.[k] === 'string' && r[k].trim(), `${taal} ribbon drawing.${k}`);
    const w = json(taal, 'properties').wall;
    for (const k of ['thicknessPreset', 'thicknessCustom']) {
      assert.ok(typeof w?.[k] === 'string' && w[k].trim(), `${taal} properties wall.${k}`);
    }
    for (const k of ['partition', 'cmu']) {
      assert.ok(typeof w?.kinds?.[k] === 'string' && w.kinds[k].trim(), `${taal} properties wall.kinds.${k}`);
    }
  }
  assert.equal(json('en', 'ribbon').drawing.wallLocationLeft, 'Left face');
  assert.equal(json('nl', 'ribbon').drawing.wallLocationLeft, 'Linkervlak');
  assert.equal(json('en', 'properties').wall.kinds.cmu, 'CMU');
});
