// Lettertype van een tekstvak wijzigen (#765).
//
// Een net getekend tekstvak kwam als het kale object in het eigenschappen-
// paneel en de editor. De weergave leest via de reactieve store van het
// document; schrijven op het kale object werkte die niet bij, dus het gekozen
// lettertype bleef Arial. Het paneel neemt nu het exemplaar uit het document,
// en een open editor volgt lettertype, grootte en kleur meteen.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const lees = (pad) => fs.readFileSync(new URL(pad, import.meta.url), 'utf8');

test('het paneel bewerkt het exemplaar uit het document', () => {
  const store = lees('./propertiesStore.js');
  const toon = store.slice(store.indexOf('export function storeShowProperties('));
  const zoek = toon.indexOf('_corrDoc.annotations.find(a => a.id === annotation.id)');
  const zet = toon.indexOf('currentAnnotation = annotation;');
  assert.ok(zoek > 0 && zoek < zet, 'eerst het exemplaar uit het document, dan currentAnnotation');
});

test('een open editor volgt lettertype, grootte en kleur', () => {
  const store = lees('./propertiesStore.js');
  assert.match(store, /key === 'fontFamily' \|\| key === 'textFontSize' \|\| key === 'fontSize' \|\| key === 'textColor'[\s\S]{0,200}werkEditorStijlBij/);
  const editor = lees('../../tools/text-editing.js');
  assert.match(editor, /export function werkEditorStijlBij\(annotation\)/);
  const bij = editor.slice(editor.indexOf('export function werkEditorStijlBij('));
  assert.match(bij.slice(0, 600), /state\.editingAnnotation\?\.id !== annotation\.id/);
  assert.match(bij.slice(0, 600), /'font-family': cssLettertype\(annotation\.fontFamily\)/);
  // De editor begint met dezelfde lettertypeketen.
  assert.match(editor, /const cssFontFamily = cssLettertype\(annotation\.fontFamily\);/);
});

test('ook lettertypen van Linux en macOS staan in de keuzelijst', () => {
  const fonts = lees('../../utils/fonts.js');
  assert.match(fonts, /detectAvailableFonts\(lettertypeKandidaten\(\)\)/);
  for (const naam of ['Liberation Sans', 'DejaVu Sans', 'Noto Sans', 'Helvetica Neue', 'Menlo']) {
    assert.ok(fonts.includes(`'${naam}'`), naam);
  }
});
