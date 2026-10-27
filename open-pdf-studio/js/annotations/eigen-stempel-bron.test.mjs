// Bronbewaking voor #749 (stempel uit een afbeelding, de knop Afbeelding).
// De modules zelf vragen een DOM en de Tauri-brug; het gedrag van de
// afbeeldingsbron staat in afbeelding-bron.test.mjs en de rondgang in
// js/pdf/eigen-stempel-rondgang.test.mjs.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');

test('het eigen stempel laadt zijn afbeelding als data:-URL via de gedeelde lader', () => {
  const bron = lees('./stamps.js');
  const deel = bron.slice(bron.indexOf('async function loadCustomStamp('));
  assert.match(deel, /laadAfbeeldingUitPad\(filePath\)/);
  assert.match(deel, /imageData: dataUrl,/);
  assert.match(deel, /ann\._cachedImg = img;/);
  // Geen blob zonder mimetype meer (een SVG laadde daarmee niet) en geen
  // blob:-URL als imageData (alleen in deze sessie geldig).
  assert.doesNotMatch(deel, /new Blob\(\[data\]\)/);
  assert.doesNotMatch(deel, /createObjectURL/);
  assert.doesNotMatch(deel, /imageData: url/);
});

test('een geplaatste afbeelding laadt uit de data:-URL en trekt geen blob:-URL in', () => {
  const bron = lees('./image-drop.js');
  assert.doesNotMatch(bron, /revokeObjectURL/);
  assert.doesNotMatch(bron, /createObjectURL/);
  assert.match(bron, /return laadAfbeeldingBytes\(data, filePath\);/);
  const bronLader = lees('./afbeelding-bron.js');
  assert.doesNotMatch(bronLader, /createObjectURL/);
});

test('de knop Afbeelding en "Afbeelding toevoegen" kiezen een bestand en plaatsen het', () => {
  const lint = lees('../solid/components/ribbon/DrawingTab.jsx');
  const knop = lint.slice(lint.indexOf('id="dr-image"'), lint.indexOf('id="dr-remove-image"'));
  assert.match(knop, /kiesEnPlaatsAfbeelding/);
  assert.doesNotMatch(knop, /setTool\('image'\)/);
  const menu = lees('../solid/components/ContextMenu.jsx');
  const item = menu.slice(menu.indexOf("t('page.addImage')"), menu.indexOf("t('page.addQrCode')"));
  assert.match(item, /kiesEnPlaatsAfbeelding/);
  assert.doesNotMatch(item, /setTool\('image'\)/);
  // Er bestaat geen gereedschap 'image'.
  assert.doesNotMatch(lees('../tools/tools/index.js'), /\bimage:/);
  assert.match(lees('./image-drop.js'), /export async function kiesEnPlaatsAfbeelding\(\)/);
});

test('een afbeelding of beeldstempel zonder cache-beeld tekent uit imageData en hertekent na het laden', () => {
  const bron = lees('./rendering.js');
  const beeld = bron.slice(bron.indexOf("case 'image':"), bron.indexOf("case 'textHighlight':"));
  assert.match(beeld, /imageCache\.get\(annotation\.imageId\) \|\| beeldUitImageData\(annotation\)/);
  assert.match(beeld, /_redrawOnLoad/);
  assert.match(beeld, /hertekenActieveWeergave/);
  const stempel = bron.slice(bron.indexOf("case 'stamp': {"), bron.indexOf('if (stampImg && stampImg.complete)'));
  assert.match(stempel, /if \(!stampImg\) stampImg = beeldUitImageData\(annotation\);/);
});

test('de saver sluit elke afbeelding in via de afbeeldingsbron (PNG of JPEG)', () => {
  const bron = lees('../pdf/saver.js');
  assert.match(bron, /import \{ insluitBytes \} from '\.\.\/annotations\/afbeelding-bron\.js';/);
  const fn = bron.slice(bron.indexOf('async function imageBytesFromDataUrl('), bron.indexOf('// Gedeclareerd in het deel hieronder'));
  assert.match(fn, /return insluitBytes\(dataUrl\);/);
});
