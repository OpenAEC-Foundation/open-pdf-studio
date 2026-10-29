// Tool Sets (#311): the pieces are wired into the app — sidebar tab, context
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

test('Tool Sets is a tab of the left sidebar, next to the other panels', () => {
  const left = source('../solid/components/left-panel/LeftPanel.jsx');
  assert.match(left, /panelId: 'tool-sets', title: \(\) => t\('leftPanel\.toolSets'\)/);
  assert.match(left, /<ToolSetsPanel \/>/);
  const panel = source('../solid/components/left-panel/panels/ToolSetsPanel.jsx');
  assert.match(panel, /activeTab\(\) === 'tool-sets'/);
  for (const action of ['createToolSet', 'renameToolSet', 'requestDeleteToolSet', 'renameToolSetItem',
    'deleteToolSetItem', 'moveToolSetItem', 'useToolSetItem', 'exportToolSet', 'importToolSetFromFile']) {
    assert.match(panel, new RegExp(`\\b${action}\\(`), action);
  }
});

test('right-click on a measurement offers "Save to Tool Set"', () => {
  const menu = source('../solid/components/ContextMenu.jsx');
  assert.match(menu, /<Show when=\{canSaveToToolSet\(ann\(\)\)\}>/);
  assert.match(menu, /label=\{t\('annotation\.saveToToolSet'\)\}/);
  assert.match(menu, /saveAnnotationToToolSet\(a\)/);
});

test('the dialogs are registered and use the movable base window', () => {
  const host = source('../solid/components/DialogHost.jsx');
  assert.match(host, /'tool-sets-import': ToolSetImportDialog/);
  assert.match(host, /'tool-sets-confirm': ToolSetConfirmDialog/);
  const dialogs = source('../solid/components/dialogs/ToolSetsDialogs.jsx');
  assert.match(dialogs, /import Dialog from '\.\.\/Dialog\.jsx'/);
  for (const mode of ['rename', 'overwrite', 'keepBoth']) assert.match(dialogs, new RegExp(`'${mode}'`));
});

test('choosing any tool ends the active item; saved preferences never contain it', () => {
  const manager = source('../tools/manager.js');
  const setTool = manager.slice(manager.indexOf('export function setTool('));
  assert.ok(setTool.indexOf('endToolSetSession()') > 0);
  assert.ok(setTool.indexOf('endToolSetSession()') < setTool.indexOf('state.currentTool = tool;'));
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
  assert.match(source('../solid/stores/toolSetsStore.js'), /setAddAnnotationHook\(\(ann\) => applyToolSetToNewAnnotation\(ann, state\.currentTool, getActiveDocument\(\)\)\)/);
});

test('a paste or an automation add is recorded as a copy, without the add hook', () => {
  const undo = source('../core/undo-manager.js');
  const add = undo.slice(undo.indexOf('export function recordAdd('));
  assert.match(add.slice(0, add.indexOf('execute(')), /!options\?\.copy/);
  const clipboard = source('./clipboard.js');
  assert.doesNotMatch(clipboard, /recordAdd\((annotation|newAnnotation|newAnnotations\[0\])\);/);
  assert.equal((clipboard.match(/recordAdd\([^)]*\{ copy: true \}\)/g) || []).length, 3);
  const bridge = source('../mcp-bridge.js');
  assert.ok(!/undoMod\.recordAdd\(ann\);/.test(bridge), 'MCP-created annotations are fully described by the caller');
});

test('the catalog file is written atomically (temporary file + rename)', () => {
  const lib = source('../../src-tauri/src/lib.rs');
  const save = lib.slice(lib.indexOf('fn save_catalog('), lib.indexOf('fn load_catalog('));
  assert.match(save, /atomic_file::write\(&path, data\.as_bytes\(\)\)/);
  assert.doesNotMatch(save, /fs::write/);
});

test('the depth is a field of the measurement section and is saved in the PDF', () => {
  const section = source('../solid/components/properties-panel/MeasurementSection.jsx');
  assert.match(section, /updateAnnotProp\('measureDepth', e\.target\.value\)/);
  assert.match(source('../pdf/saver/plattegrond-meta.js'), /zet\('OPS_Depth'/);
  assert.match(source('../pdf/loader/plattegrond-meta.js'), /uit\.measureDepth = e\.opsDepth/);
});

// Words that really are the same as in English in that language.
const SAME_AS_ENGLISH = new Set(['OK', 'Volume', 'Tool set']);

test('every locale has Tool Sets texts, translated, with the English placeholders', () => {
  const langs = readdirSync(LOCALES);
  assert.equal(langs.length, 40);
  const en = json('en', 'properties.json');
  const enKeys = Object.keys(en.toolSets).sort();
  assert.ok(enKeys.length >= 40);
  const mKeys = ['depth', 'depthUnit', 'depthNone', 'depthTooltip', 'surface', 'volume'];
  for (const lang of langs) {
    const p = json(lang, 'properties.json');
    const c = json(lang, 'context.json');
    assert.deepEqual(Object.keys(p.toolSets).sort(), enKeys, lang);
    const texts = [
      ['leftPanel.toolSets', p.leftPanel.toolSets, en.leftPanel.toolSets],
      ['annotation.saveToToolSet', c.annotation.saveToToolSet, json('en', 'context.json').annotation.saveToToolSet],
      ...mKeys.map((k) => [`measurement.${k}`, p.measurement[k], en.measurement[k]]),
      ...enKeys.map((k) => [`toolSets.${k}`, p.toolSets[k], en.toolSets[k]]),
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
