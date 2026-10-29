// Het lettertype van een tekstvak of callout hoort bij de standaardstijl
// (GitHub #765: "The program doesn't seem to be able to change font from
// Arial").
//
// Met het tekstvak- of callout-gereedschap actief toont het
// eigenschappenpaneel de standaardstijl van het gereedschap. Een ander
// lettertype kiezen schreef de stijl weg via setAsDefaultStyle, maar die nam
// het lettertype niet mee, en het gereedschap maakte elk nieuw vak met een
// vaste 'Arial'. Het volgende vak was dus weer Arial, en bij het opnieuw
// kiezen van het gereedschap stond het paneel ook weer op Arial. Hetzelfde
// voor "Als standaardstijl instellen" vanuit een bestaand vak.
//
// De echte preferences.js, het echte eigenschappenpaneel (propertiesStore)
// en de echte annotatiemakers draaien hier.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./app-test-hooks.mjs', import.meta.url);
// De echte preferences.js in plaats van de stub van app-test-hooks.
register(`data:text/javascript,${encodeURIComponent(`
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('/js/core/preferences.js')) {
    return { format: 'module', shortCircuit: true, source: readFileSync(fileURLToPath(url), 'utf8') };
  }
  return nextLoad(url, context);
}`)}`);
const { installeerBrowserStubs } = await import('./app-test-hooks.mjs');
installeerBrowserStubs();
globalThis.window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const { state } = await import('./state.ts');
const { applyDefaultStyle, setAsDefaultStyle } = await import('./preferences.js');
const { buildAnnotationProps } = await import('../tools/annotation-creators.js');
const props = await import('../solid/stores/propertiesStore.js');

function openen() {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations: [],
    selectedAnnotation: null, selectedAnnotations: [], undoStack: [], redoStack: [],
    savedUndoStackLength: 0, modified: false, textEdits: [], watermarks: [], bookmarks: [],
    pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
}

const STANDAARD = JSON.parse(JSON.stringify(state.preferences));
function verseVoorkeuren() {
  for (const k of Object.keys(state.preferences)) delete state.preferences[k];
  Object.assign(state.preferences, JSON.parse(JSON.stringify(STANDAARD)));
}

// Wacht tot een voorwaarde klopt (de stijl wordt via een dynamische import
// weggeschreven); ruime grens, geen vaste korte wachttijd.
async function totDat(voorwaarde, grens = 5000) {
  const eind = Date.now() + grens;
  while (!voorwaarde()) {
    if (Date.now() > eind) return false;
    await new Promise((r) => setTimeout(r, 5));
  }
  return true;
}

test('een nieuw tekstvak of callout krijgt het lettertype van de standaardstijl', () => {
  verseVoorkeuren();
  openen();
  for (const type of ['textbox', 'callout']) {
    assert.equal(buildAnnotationProps(type, 10, 10, 200, 100).fontFamily, 'Arial', `${type}: standaard Arial`);
    setAsDefaultStyle({ type, fontFamily: 'Georgia', fontSize: 12, opacity: 1, lineWidth: 1, strokeColor: '#ff0000' });
    assert.equal(buildAnnotationProps(type, 10, 10, 200, 100).fontFamily, 'Georgia', `${type}: lettertype uit de stijl`);
  }
});

test('standaardstijl toepassen zet het lettertype', () => {
  verseVoorkeuren();
  setAsDefaultStyle({ type: 'textbox', fontFamily: 'Courier New', opacity: 1 });
  const vak = { type: 'textbox', fontFamily: 'Arial' };
  applyDefaultStyle(vak);
  assert.equal(vak.fontFamily, 'Courier New');
  // 'mixed' (meervoudige selectie) is geen lettertype en wordt geen stijl.
  setAsDefaultStyle({ type: 'textbox', fontFamily: 'mixed', opacity: 1 });
  assert.equal(state.preferences.textboxFontFamily, 'Courier New');
});

test('een lettertype kiezen bij een actief tekstvakgereedschap blijft staan voor het volgende vak', async () => {
  verseVoorkeuren();
  openen();
  assert.equal(await props.showToolDefaults('textbox'), true);
  assert.equal(props.annotProps.fontFamily, 'Arial');
  props.updateAnnotProp('fontFamily', 'Times New Roman');
  assert.ok(await totDat(() => state.preferences.textboxFontFamily === 'Times New Roman'),
    'de keuze staat in de voorkeuren');
  assert.equal(buildAnnotationProps('textbox', 10, 10, 200, 100).fontFamily, 'Times New Roman');

  // Het gereedschap opnieuw kiezen toont de gekozen letter, niet weer Arial.
  await props.showToolDefaults('callout');
  await props.showToolDefaults('textbox');
  assert.equal(props.annotProps.fontFamily, 'Times New Roman');
});
