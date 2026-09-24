// Het lagenpaneel (#468) is een Solid-component en draait niet onder kale
// node. De logica staat in annotations/annotatie-lagen.js (getoetst); dit zijn
// vangrails op de bron: waar het paneel staat, de huisstijl, en de teksten.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
const paneel = lees('./AnnotationLayersPanel.jsx');
const dialoog = lees('../dialogs/AnnotationLayerDeleteDialog.jsx');
const store = lees('../../stores/annotationLayersStore.js');
const app = lees('../../App.jsx');
const lint = lees('../ribbon/ViewTab.jsx');
const dialogHost = lees('../DialogHost.jsx');
const css = lees('../../../../styles/layout.css');

const LOCALES = '../../../i18n/locales';
const blok = (taal) => JSON.parse(lees(`${LOCALES}/${taal}/ribbon.json`)).annotationLayers;

test('het paneel staat naast Zichtbaarheid Elementen en heeft een knop in Beeld > Panelen', () => {
  assert.match(app, /<ElementVisibilityPanel \/>\s*<AnnotationLayersPanel \/>/);
  assert.match(lint, /id="ribbon-annotation-layers"/);
  assert.match(lint, /toggleAnnotationLayersPanel/);
  assert.match(dialogHost, /'annotation-layer-delete': AnnotationLayerDeleteDialog/);
});

test('het paneel toont naam, aantal, zichtbaar, afdrukbaar en vergrendeld', () => {
  for (const sleutel of ['colName', 'colCount', 'colVisible', 'colPrintable', 'colLocked', 'colCurrent']) {
    assert.match(paneel, new RegExp(`annotationLayers\\.${sleutel}`), sleutel);
  }
  for (const actie of ['add', 'rename', 'delete', 'moveUp', 'moveDown']) {
    assert.match(paneel, new RegExp(`annotationLayers\\.${actie}'`), actie);
  }
});

test('verwijderen vraagt wat er met de markeringen gebeurt, in een echte dialoog', () => {
  // Het basisvenster Dialog is verplaatsbaar en sluit niet bij een klik ernaast.
  assert.match(dialoog, /import Dialog from '\.\.\/Dialog\.jsx'/);
  assert.match(dialoog, /<Dialog[\s>]/);
  assert.match(dialoog, /annotationLayers\.deleteMove/);
  assert.match(dialoog, /annotationLayers\.deleteRemove/);
  // Een lege laag gaat zonder vraag weg; een volle laag opent de dialoog.
  assert.match(store, /openDialog\('annotation-layer-delete'/);
});

test('huisstijl: standaardcursor, geen afgeronde hoeken, geen animaties', () => {
  for (const [naam, bron] of [['paneel', paneel], ['dialoog', dialoog]]) {
    assert.doesNotMatch(bron, /cursor\s*:/, `${naam}: geen eigen cursor`);
    assert.doesNotMatch(bron, /border-radius|transition|animation/, `${naam}: geen rondingen of animaties`);
  }
  const begin = css.indexOf('/* Markeringslagen');
  const eind = css.indexOf('/* einde Markeringslagen */');
  assert.ok(begin >= 0 && eind > begin, 'de stijlen van het paneel staan in één blok');
  const stijl = css.slice(begin, eind);
  assert.doesNotMatch(stijl, /cursor\s*:(?!\s*default\b)/, 'alleen de standaardcursor');
  assert.doesNotMatch(stijl, /border-radius|transition|animation/);
  // Sluitknop rood bij aanwijzen, zoals elke titelbalk in de app.
  assert.match(stijl, /#e81123/);
});

test('Engels en Nederlands hebben dezelfde sleutels, geen enkele leeg', () => {
  const en = blok('en');
  const nl = blok('nl');
  assert.ok(en && nl, 'blok annotationLayers ontbreekt');
  assert.deepEqual(Object.keys(nl).sort(), Object.keys(en).sort());
  for (const [taal, b] of [['en', en], ['nl', nl]]) {
    for (const [k, v] of Object.entries(b)) assert.ok(typeof v === 'string' && v.trim(), `${taal}.${k} is leeg`);
  }
  const plek = (s) => (s.match(/\{\{\w+\}\}/g) || []).sort().join();
  for (const k of Object.keys(en)) assert.equal(plek(nl[k]), plek(en[k]), `plaatshouders van ${k}`);
});

test('elke gebruikte sleutel bestaat in het Engels', () => {
  const en = blok('en');
  const bronnen = [paneel, dialoog, store, lint, lees('../ContextMenu.jsx')];
  const gebruikt = new Set();
  for (const bron of bronnen) {
    for (const m of bron.matchAll(/annotationLayers\.(\w+)/g)) gebruikt.add(m[1]);
  }
  assert.ok(gebruikt.size > 10);
  for (const k of gebruikt) assert.ok(k in en, `annotationLayers.${k} ontbreekt in en/ribbon.json`);
});

test('geselecteerde markeringen naar een laag: vanuit het paneel en het contextmenu', () => {
  assert.match(paneel, /moveSelectionToAnnotationLayer\(/);
  assert.match(paneel, /annotationLayers\.moveSelection'/);
  const menu = lees('../ContextMenu.jsx');
  // Het oude "geen lagen beschikbaar" is vervangen door de echte lagen, in het
  // menu van één annotatie én in dat van een meervoudige selectie.
  assert.doesNotMatch(menu, /noLayersAvailable/);
  assert.equal((menu.match(/<LayerSubmenu /g) || []).length, 2);
  assert.match(menu, /moveAnnotationsToAnnotationLayer\(/);
  // Eén undo-stap voor de hele verplaatsing.
  assert.match(store, /recordBulkModify\(/);
});
