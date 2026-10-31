import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every locale carries the IFCX export strings (#876), really translated.
const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HERE, '../i18n/locales');

const readJson = (locale, file) => JSON.parse(readFileSync(join(LOCALES, locale, file), 'utf8'));
const block = (locale) => readJson(locale, 'dialogs.json').ifcxExport || {};
const menu = (locale) => readJson(locale, 'appMenu.json').exportPanel || {};
const placeholders = (s) => (s.match(/\{\{\w+\}\}/g) || []).sort();
const source = (rel) => readFileSync(join(HERE, rel), 'utf8').replace(/\r\n/g, '\n');

// Words that really are the same as in English in that language.
const SAME_AS_ENGLISH = {
  fr: ['Pages :'],
};

test('all 40 locales have the same IFCX export keys as English, none empty, same placeholders', () => {
  const locales = readdirSync(LOCALES);
  assert.equal(locales.length, 40);
  const en = block('en');
  assert.ok(Object.keys(en).length >= 20);
  for (const locale of locales) {
    const b = block(locale);
    assert.deepEqual(Object.keys(b).sort(), Object.keys(en).sort(), locale);
    for (const [key, text] of Object.entries(b)) {
      assert.ok(typeof text === 'string' && text.trim().length > 0, `${locale} ifcxExport.${key} is empty`);
      assert.deepEqual(placeholders(text), placeholders(en[key]), `${locale} ifcxExport.${key} placeholders`);
    }
    const m = menu(locale);
    assert.ok(m.exportIfcx && m.exportIfcxDesc, `${locale} appMenu exportPanel.exportIfcx`);
  }
});

test('no locale copies the English IFCX texts, and every menu entry says it is a beta', () => {
  const en = block('en');
  const copied = [];
  for (const locale of readdirSync(LOCALES)) {
    const m = menu(locale);
    assert.match(m.exportIfcx, /IFCX/, `${locale} names the format`);
    assert.match(m.exportIfcx, /[(（]/, `${locale} marks the beta in brackets`);
    if (locale === 'en') continue;
    const allowed = new Set(SAME_AS_ENGLISH[locale] || []);
    const b = block(locale);
    for (const [key, text] of Object.entries(en)) {
      if (b[key] === text && !allowed.has(text)) copied.push(`${locale} ifcxExport.${key}: ${text}`);
    }
    if (m.exportIfcx === menu('en').exportIfcx) copied.push(`${locale} exportPanel.exportIfcx`);
    if (m.exportIfcxDesc === menu('en').exportIfcxDesc) copied.push(`${locale} exportPanel.exportIfcxDesc`);
  }
  assert.deepEqual(copied, []);
});

test('every IFCX key used in the code exists in English', () => {
  const en = block('en');
  const code = [source('../solid/components/dialogs/IfcxExportDialog.jsx'), source('./ifcx-document.js')].join('\n');
  const used = [...code.matchAll(/'ifcxExport\.(\w+)'/g)].map((m) => m[1]);
  assert.ok(used.length >= 15);
  for (const key of used) assert.ok(en[key], `ifcxExport.${key}`);
  const panel = source('../solid/components/app-menu/ExportPanel.jsx');
  for (const key of ['exportIfcx', 'exportIfcxDesc']) {
    assert.match(panel, new RegExp(`'exportPanel\\.${key}'`));
    assert.ok(menu('en')[key]);
  }
});
