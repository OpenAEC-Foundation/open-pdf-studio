// Read aloud, tags panel and accessibility report (#384): every locale has the
// texts, translated, with the placeholders of the English; the UI uses only
// keys that exist; and the feature is wired the lazy way (source checks, the
// UI itself runs in the app).

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const JS = join(HERE, '..');
const LOCALES = join(JS, 'i18n/locales');
const readJson = (locale, file) => JSON.parse(readFileSync(join(LOCALES, locale, file), 'utf8'));
const source = (p) => readFileSync(join(JS, p), 'utf8').replace(/\r\n/g, '\n');
const placeholders = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v && typeof v === 'object') Object.assign(out, flatten(v, `${prefix}${k}.`));
    else out[`${prefix}${k}`] = v;
  }
  return out;
}

const VIEW_KEYS = ['accessibilityGroup', 'readAloud', 'readAloudPause', 'readAloudTitle', 'tagsPanel',
  'tagsPanelTitle', 'accessibilityCheck', 'accessibilityCheckTitle'];

const blocks = (locale) => ({
  tagsPanel: flatten(readJson(locale, 'properties.json').tagsPanel),
  readAloud: flatten(readJson(locale, 'common.json').readAloud),
  accessibilityReport: flatten(readJson(locale, 'dialogs.json').accessibilityReport),
  view: Object.fromEntries(VIEW_KEYS.map((k) => [k, readJson(locale, 'ribbon.json').view?.[k]])),
});

// Words that are the same as in English in that language.
const SAME = new Set(['tagsPanel.role', 'readAloud.stop', 'readAloud.pause', 'view.readAloudPause',
  'view.tagsPanel', 'tagsPanel.annotationRef', 'accessibilityReport.page', 'readAloud.page']);

test('all 40 locales have the texts of the English, none empty, same placeholders', () => {
  const locales = readdirSync(LOCALES);
  assert.equal(locales.length, 40);
  const en = blocks('en');
  for (const locale of locales) {
    const b = blocks(locale);
    let same = 0;
    let total = 0;
    for (const [block, texts] of Object.entries(en)) {
      assert.deepEqual(Object.keys(b[block]).sort(), Object.keys(texts).sort(), `${locale} ${block}`);
      for (const [key, english] of Object.entries(texts)) {
        const text = b[block][key];
        assert.ok(typeof text === 'string' && text.trim(), `${locale} ${block}.${key} is empty`);
        assert.deepEqual(placeholders(text), placeholders(english), `${locale} ${block}.${key}: placeholders`);
        total++;
        if (locale !== 'en' && text === english && !SAME.has(`${block}.${key}`)) same++;
      }
    }
    assert.ok(same <= 2, `${locale}: ${same} of ${total} texts are still English`);
  }
});

test('the UI only uses keys that exist', () => {
  const en = blocks('en');
  const used = (file, re) => [...source(file).matchAll(re)].map((m) => m[1]);
  for (const k of used('solid/components/left-panel/panels/TagsPanel.jsx', /t\('tagsPanel\.(\w+)'/g)) assert.ok(en.tagsPanel[k], `tagsPanel.${k}`);
  for (const k of used('solid/components/dialogs/AccessibilityReportDialog.jsx', /t\('accessibilityReport\.(\w+)'/g)) assert.ok(en.accessibilityReport[k], `accessibilityReport.${k}`);
  for (const k of used('solid/components/ReadAloudBar.jsx', /t\('readAloud\.(\w+)'/g)) assert.ok(en.readAloud[k], `readAloud.${k}`);
  for (const k of used('solid/components/ribbon/ViewTab.jsx', /t\('view\.(accessibility\w*|readAloud\w*|tagsPanel\w*)'/g)) assert.ok(en.view[k], `view.${k}`);
  // Report kinds and read-aloud messages are built from data: all must exist.
  for (const kind of ['notTagged', 'notMarked', 'noLanguage', 'figureNoAlt', 'pageNotTagged', 'untaggedContent', 'annotationNoText']) {
    assert.ok(en.accessibilityReport[`kind.${kind}`], kind);
    assert.match(source('accessibility/report.js'), new RegExp(`kind: '${kind}'`));
  }
  for (const key of ['noEngine', 'noEngineLinux', 'speechFailed', 'nothingToRead', 'tagOrder', 'contentOrder']) {
    assert.ok(en.readAloud[key], key);
  }
});

test('the feature is loaded on demand and saved by the saver', () => {
  const host = source('solid/components/DialogHost.jsx');
  assert.match(host, /const AccessibilityReportDialog = lazy\(\(\) => import\('\.\/dialogs\/AccessibilityReportDialog\.jsx'\)\)/);
  assert.match(host, /'accessibility-report': AccessibilityReportDialog/);
  // Nothing in the load or render path reads the structure tree (#634).
  for (const file of ['pdf/loader.js', 'pdf/renderer.js', 'main.js']) {
    assert.doesNotMatch(source(file), /accessibility\/|getStructTree|readStructTree/, `${file} stays free of the struct tree`);
  }
  assert.doesNotMatch(source('ui/panels/tags.js'), /getStructTree/, 'no per-page pdf.js struct tree walk');
  const saver = source('pdf/saver.js');
  assert.match(saver, /applyEditsToPdf\(pdfDocLib, activeDoc\.structEdits\)/);
  assert.match(saver, /activeDoc\.structEdits = null;\s*notifyStructEditsSaved\(activeDoc\)/);
  assert.match(source('solid/App.jsx'), /<ReadAloudBar \/>/);
  assert.match(source('solid/components/ribbon/ViewTab.jsx'), /id="ribbon-read-aloud"/);
  // The read-aloud bar and the report keep square corners.
  const css = readFileSync(join(JS, '../styles/find-bar.css'), 'utf8').replace(/\r\n/g, '\n');
  const bar = css.slice(css.indexOf('.read-aloud-bar {'));
  assert.doesNotMatch(bar, /border-radius:\s*[1-9]/);
});
