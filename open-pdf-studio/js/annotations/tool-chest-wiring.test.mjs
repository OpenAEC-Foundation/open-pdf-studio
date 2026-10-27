// Tool Chest (#311): the pieces are wired into the app — sidebar tab, context
// menu, dialogs, the end of the session on a tool change, the preferences
// filter, the add-annotation hook — and every locale has the texts, really
// translated, with the same placeholders as English.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

// CRLF → LF: Windows CI checks the sources out with CRLF.
const source = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const LOCALES = new URL('../i18n/locales/', import.meta.url);
const json = (lang, file) => JSON.parse(readFileSync(new URL(`${lang}/${file}`, LOCALES), 'utf8').replace(/\r\n/g, '\n'));
const placeholders = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

test('the Tool Chest is a tab of the left sidebar, next to the other panels', () => {
  const left = source('../solid/components/left-panel/LeftPanel.jsx');
  assert.match(left, /panelId: 'tool-chest', title: \(\) => t\('leftPanel\.toolChest'\)/);
  assert.match(left, /<ToolChestPanel \/>/);
  const panel = source('../solid/components/left-panel/panels/ToolChestPanel.jsx');
  assert.match(panel, /activeTab\(\) === 'tool-chest'/);
  for (const action of ['createToolSet', 'renameToolSet', 'requestDeleteToolSet', 'renameToolChestItem',
    'deleteToolChestItem', 'moveToolChestItem', 'useToolChestItem', 'exportToolSet', 'importToolSetFromFile']) {
    assert.match(panel, new RegExp(`\\b${action}\\(`), action);
  }
});

test('right-click on a measurement offers "Save to Tool Chest"', () => {
  const menu = source('../solid/components/ContextMenu.jsx');
  assert.match(menu, /<Show when=\{canSaveToToolChest\(ann\(\)\)\}>/);
  assert.match(menu, /label=\{t\('annotation\.saveToToolChest'\)\}/);
  assert.match(menu, /saveAnnotationToToolChest\(a\)/);
});

test('the dialogs are registered and use the movable base window', () => {
  const host = source('../solid/components/DialogHost.jsx');
  assert.match(host, /'tool-chest-import': ToolChestImportDialog/);
  assert.match(host, /'tool-chest-confirm': ToolChestConfirmDialog/);
  const dialogs = source('../solid/components/dialogs/ToolChestDialogs.jsx');
  assert.match(dialogs, /import Dialog from '\.\.\/Dialog\.jsx'/);
  for (const mode of ['rename', 'overwrite', 'keepBoth']) assert.match(dialogs, new RegExp(`'${mode}'`));
});

test('choosing any tool ends the active item; saved preferences never contain it', () => {
  const manager = source('../tools/manager.js');
  const setTool = manager.slice(manager.indexOf('export function setTool('));
  assert.ok(setTool.indexOf('endToolChestSession()') > 0);
  assert.ok(setTool.indexOf('endToolChestSession()') < setTool.indexOf('state.currentTool = tool;'));
  const prefs = source('../core/preferences.js');
  const save = prefs.slice(prefs.indexOf('export function savePreferences()'));
  assert.match(save, /const opTeSlaan = prefsForStorage\(state\.preferences\);/);
  assert.match(save, /savePreferencesFile\(opTeSlaan\)/);
  assert.match(save, /preferencesMirrorJson\(opTeSlaan,/);
});

test('the add-annotation hook runs before the undo record is made', () => {
  const undo = source('../core/undo-manager.js');
  const add = undo.slice(undo.indexOf('export function recordAdd('));
  assert.ok(add.indexOf('_addAnnotationHook(annotation)') < add.indexOf('execute('));
  assert.match(source('../solid/stores/toolChestStore.js'), /setAddAnnotationHook\(\(ann\) => applyToolChestToNewAnnotation\(ann, state\.currentTool, getActiveDocument\(\)\)\)/);
});

test('the depth is a field of the measurement section and is saved in the PDF', () => {
  const section = source('../solid/components/properties-panel/MeasurementSection.jsx');
  assert.match(section, /updateAnnotProp\('measureDepth', e\.target\.value\)/);
  assert.match(source('../pdf/saver/plattegrond-meta.js'), /zet\('OPS_Depth'/);
  assert.match(source('../pdf/loader/plattegrond-meta.js'), /uit\.measureDepth = e\.opsDepth/);
});

// Words that really are the same as in English in that language.
const SAME_AS_ENGLISH = new Set(['OK', 'Volume', 'Tool set']);

test('every locale has the Tool Chest texts, translated, with the English placeholders', () => {
  const langs = readdirSync(LOCALES);
  assert.equal(langs.length, 40);
  const en = json('en', 'properties.json');
  const enKeys = Object.keys(en.toolChest).sort();
  assert.ok(enKeys.length >= 40);
  const mKeys = ['depth', 'depthUnit', 'depthNone', 'depthTooltip', 'surface', 'volume'];
  for (const lang of langs) {
    const p = json(lang, 'properties.json');
    const c = json(lang, 'context.json');
    assert.deepEqual(Object.keys(p.toolChest).sort(), enKeys, lang);
    const texts = [
      ['leftPanel.toolChest', p.leftPanel.toolChest, en.leftPanel.toolChest],
      ['annotation.saveToToolChest', c.annotation.saveToToolChest, json('en', 'context.json').annotation.saveToToolChest],
      ...mKeys.map((k) => [`measurement.${k}`, p.measurement[k], en.measurement[k]]),
      ...enKeys.map((k) => [`toolChest.${k}`, p.toolChest[k], en.toolChest[k]]),
    ];
    let same = 0;
    for (const [key, text, english] of texts) {
      assert.ok(typeof text === 'string' && text.trim(), `${lang} ${key} is empty`);
      assert.deepEqual(placeholders(text), placeholders(english), `${lang} ${key}: placeholders`);
      if (lang !== 'en' && text === english && !SAME_AS_ENGLISH.has(english)) same++;
    }
    assert.ok(same <= 2, `${lang}: ${same} texts still in English`);
  }
});
