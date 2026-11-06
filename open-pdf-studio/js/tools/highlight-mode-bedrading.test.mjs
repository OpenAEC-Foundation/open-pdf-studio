// Markeren in gebieds- of tekstmodus (#927): de bedrading in de ribbon, het
// palet, de sneltoets, setTool en de tekstselectie. Die modules hangen aan de
// DOM en zijn in node niet te laden; deze test leest de bron. De rekenregels
// staan in text/tekst-markeren.test.mjs.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('highlight-mode.js bewaart de modus via core/opslag.js en zet tekstmodus na setTool aan', () => {
  const modus = bron('./highlight-mode.js');
  assert.match(modus, /from '\.\.\/core\/opslag\.js'/);
  assert.doesNotMatch(modus, /localStorage/);
  assert.match(modus, /setTool\('select'\);\s*state\.textHighlightMode = true;/);
  assert.match(modus, /kiesMarkering\(modusNaKlik\(highlightActive\(\), highlightMode\(\)\)\)/);
});

test('setTool zet de tekstmodus uit, vóór het wisselen van gereedschap', () => {
  const manager = bron('./manager.js');
  const uit = manager.indexOf('state.textHighlightMode = false;');
  assert.ok(uit > manager.indexOf('export function setTool(tool)'), 'in setTool');
  assert.ok(uit < manager.indexOf('// Deactivate the current tool via lifecycle'), 'vooraan');
});

test('de ribbon heeft een splitknop met een vaste RibbonButton tool-highlight en beide modi', () => {
  const tab = bron('../solid/components/ribbon/CommentTab.jsx');
  assert.match(tab, /<SplitButton[\s\S]{0,300}main=\{\s*<RibbonButton id="tool-highlight"[\s\S]{0,600}onClick=\{markeringKnop\}/);
  assert.match(tab, /id="highlight-menu-area"[\s\S]{0,200}onClick=\{\(\) => kiesMarkering\('area'\)\}/);
  assert.match(tab, /id="highlight-menu-text"[\s\S]{0,200}onClick=\{\(\) => kiesMarkering\('text'\)\}/);
  const knop = bron('../solid/components/ribbon/SplitButton.jsx');
  assert.match(knop, /\{props\.main \|\| \(/);
});

test('het palet wisselt van modus', () => {
  const palet = bron('../solid/components/ToolPalette.jsx');
  assert.match(palet, /onClick=\{\(\) => \(isHighlight \? markeringKnop\(\) : setTool\(props\.tool\)\)\}/);
  assert.match(palet, /highlightMode\(\) === 'text' \? textHighlightIcon : props\.icon/);
});

test('de tekstselectie markeert bij loslaten en bij dubbel- en driemaal klikken', () => {
  const sel = bron('../text/text-selection.js');
  assert.match(sel, /document\.addEventListener\('click', handleMeerklik, true\)/);
  assert.match(sel, /function handleMouseUp\(e\)[\s\S]{0,1500}gekruisteDelen\(bereik, lijn\)/);
  assert.match(sel, /createTextMarkupAnnotation\('textHighlight', '#FFFF00', 0\.3, schuin, \{ select: false, redraw: false \}\)/);
  assert.match(sel, /undo\.beginUndoTransaction\(\);[\s\S]{0,600}undo\.endUndoTransaction\(\);/);
  const markup = bron('../text/text-markup.js');
  assert.match(markup, /export function createTextMarkupAnnotation\(type, color, opacity, extra = null, opties = \{\}\)/);
  assert.match(markup, /opacity: opacity,\s*\.\.\.\(extra \|\| \{\}\)/);
});

test('elke taal heeft de teksten van de twee modi', () => {
  const map = new URL('../i18n/locales/', import.meta.url);
  const sleutels = ['textHighlight', 'textHighlightTitle', 'areaHighlight', 'areaHighlightTitle', 'highlightMode', 'highlightSwitchTip'];
  for (const taal of readdirSync(map)) {
    const ribbon = JSON.parse(readFileSync(new URL(`${taal}/ribbon.json`, map), 'utf8'));
    for (const k of sleutels) assert.equal(typeof ribbon.comment?.[k], 'string', `${taal}: comment.${k}`);
  }
  const nl = JSON.parse(readFileSync(new URL('nl/ribbon.json', map), 'utf8'));
  assert.equal(nl.comment.textHighlight, 'Tekst markeren');
});
