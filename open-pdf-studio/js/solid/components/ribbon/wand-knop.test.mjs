// De Wand-knop op het tabblad Tekenen (#864).
//
// De wand was alleen te kiezen uit de paletcategorie NL IFC Bouw, en die is
// weg bij een ander paletland. De knop start hetzelfde gereedschap ('wall')
// met de standaardwand van het palet, ongeacht het land, en krijgt zoals elke
// lintknop een eigen sneltoets met die toets in de tooltip.
//
// Het gereedschap zelf draait hier onder node (zie
// ../../../core/app-test-hooks.mjs), net als in tools/tools/polygon-tool.test.mjs.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { register } from 'node:module';

register('../../../core/app-test-hooks.mjs', import.meta.url);
register('../../../pdf/saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../../core/state.ts');
const { createAnnotationFromTool } = await import('../../../tools/annotation-creators.js');
const { NL_CATEGORIES } = await import('../../data/nlSymbolLibrary.js');
const { RIBBON_COMMANDS } = await import('../../../core/keybindings/ribbon-commands.generated.js');
const { sneltoetsen, sneltoetsTekst, opdrachtVoorKnop } = await import('../../../core/keybindings/app-shortcuts.js');
const { titleWithShortcut } = await import('../../../core/keybindings/labels.js');

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const LOCALES = new URL('../../../i18n/locales/', import.meta.url);

function openen() {
  state.documents = [{
    id: 'doc-wand', filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations: [],
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  Object.assign(state.preferences, { enableObjectSnap: false, enableGridSnap: false, polarTrackingEnabled: false, enableAngleSnap: false });
}

const paletWand = () => NL_CATEGORIES.flatMap((c) => c.symbols || []).find((s) => s.id === 'wand');

test('de knop staat in de groep Tekenen naast Lijn en Polylijn en start de standaardwand', () => {
  const tab = lees('./DrawingTab.jsx');
  const lijn = tab.indexOf('id="dr-line"');
  const poly = tab.indexOf('id="dr-polyline"');
  const wand = tab.indexOf('id="dr-wall"');
  assert.ok(lijn > 0 && lijn < poly && poly < wand, 'Lijn, Polylijn, Wand');
  assert.ok(wand < tab.indexOf('id="dr-arrow"'), 'vóór Pijl, in dezelfde groep');
  const knop = tab.slice(wand, tab.indexOf('/>', tab.indexOf("setTool('wall')", wand)));
  assert.match(knop, /title=\{tProperties\('quantities\.type\.wall'\)\} icon=\{wallIcon\}/);
  assert.match(knop, /disabled=\{ro\(\)\} active=\{state\.currentTool === 'wall'\}/);
  // Geen afwijking van een eerdere paletwand: eerst de overrides weg.
  assert.match(knop, /state\.toolOverrides = null;\s*setTool\('wall'\);/);
  // Niet afhankelijk van het paletland.
  assert.doesNotMatch(knop, /Country|nl-ifc-bouw/i);
  assert.match(tab, /const wallIcon = `<svg viewBox="0 0 24 24"[^`]*stroke="currentColor"/);
  // De paletwand blijft zijn eigen materiaal houden (manager.js wist ze niet).
  assert.match(lees('../../../tools/manager.js'), /if \(tool !== 'stamp' && tool !== 'wall'\) \{\s*state\.toolOverrides = null;/);
});

test('een wand van de knop is dezelfde wand als de standaardwand uit het palet', () => {
  openen();
  const palet = paletWand();
  assert.ok(palet?.wall, 'de paletregel Wand (IfcWall) bestaat nog');

  state.toolOverrides = null;
  const knop = createAnnotationFromTool('wall', 10, 20, 210, 20, {});
  // Zoals SymbolPalette.jsx (selectSymbol) de paletwand start.
  state.toolOverrides = { wallPattern: palet.wall.pattern, wallDikteMm: palet.wall.dikteMm || 100, ifcCategory: 'IfcWall', symbolInsert: true };
  const uitPalet = createAnnotationFromTool('wall', 10, 20, 210, 20, {});
  state.toolOverrides = null;

  assert.equal(knop.type, 'wall');
  for (const veld of ['type', 'dikteMm', 'hatchPattern', 'ifcCategory', 'color', 'strokeColor', 'lineWidth', 'startX', 'startY', 'endX', 'endY']) {
    assert.deepEqual(knop[veld], uitPalet[veld], veld);
  }
  assert.equal(knop.dikteMm, 100);
  assert.equal(knop.ifcCategory, 'IfcWall');
});

test('de knop heeft een eigen sneltoets, en de tooltip toont hem', () => {
  const def = RIBBON_COMMANDS.find((o) => o.id === 'dr-wall');
  assert.deepEqual(def, { id: 'dr-wall', tab: 'drawing', labelKey: 'properties:quantities.type.wall' });
  const opdracht = opdrachtVoorKnop({ id: 'dr-wall' });
  assert.equal(opdracht, 'ribbon:#dr-wall');
  assert.ok(sneltoetsen.has(opdracht), 'in te stellen bij Sneltoetsen');
  assert.equal(sneltoetsTekst(opdracht), '', 'standaard zonder toets, zoals Polylijn');
  sneltoetsen.setOverrides({ [opdracht]: ['Shift+W'] });
  try {
    const toets = sneltoetsTekst(opdracht);
    assert.ok(toets.includes('W'), toets);
    assert.equal(titleWithShortcut('Wall', toets), `Wall (${toets})`);
  } finally {
    sneltoetsen.setOverrides({});
  }
});

test('elke taal heeft de naam van de knop', () => {
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  const en = JSON.parse(readFileSync(new URL('en/properties.json', LOCALES), 'utf8')).quantities.type.wall;
  for (const taal of talen) {
    const naam = JSON.parse(readFileSync(new URL(`${taal}/properties.json`, LOCALES), 'utf8')).quantities?.type?.wall;
    assert.equal(typeof naam, 'string', taal);
    assert.ok(naam.trim(), taal);
    if (taal !== 'en') assert.notEqual(naam, en, `${taal}: vertaald`);
  }
});
