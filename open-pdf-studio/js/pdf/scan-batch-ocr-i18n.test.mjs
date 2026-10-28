import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Batch OCR and scanning (#382): every locale has the texts, really
// translated, with the same placeholders as English.
const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HERE, '../i18n/locales');

const readJson = (locale, file) => JSON.parse(readFileSync(join(LOCALES, locale, file), 'utf8').replace(/\r\n/g, '\n'));
const placeholders = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
const RIBBON_KEYS = ['scanGroup', 'scan', 'scanTitle', 'batchOcr', 'batchOcrTitle'];

const blocks = (locale) => {
  const dialogs = readJson(locale, 'dialogs.json');
  const organize = readJson(locale, 'ribbon.json').organize || {};
  return {
    batchOcr: dialogs.batchOcr || {},
    scanner: dialogs.scanner || {},
    organize: Object.fromEntries(RIBBON_KEYS.map((k) => [k, organize[k]])),
  };
};

// Words that really are the same as in English in that language.
const SAME_AS_ENGLISH = {
  da: ['batchOcr.start', 'batchOcr.stop', 'scanner.title', 'scanner.device', 'scanner.scan', 'scanner.stop', 'organize.scan'],
  de: ['scanner.device'],
  fr: ['scanner.device'],
  it: ['scanner.device'],
  ms: ['batchOcr.output'],
  nb: ['batchOcr.start'],
  nl: ['scanner.device'],
  pt: ['scanner.device'],
};

test('all 40 locales have the batch OCR and scanner texts, none empty, same placeholders', () => {
  const locales = readdirSync(LOCALES);
  assert.equal(locales.length, 40);
  const en = blocks('en');
  assert.ok(Object.keys(en.batchOcr).length >= 40);
  assert.ok(Object.keys(en.scanner).length >= 30);
  for (const locale of locales) {
    const b = blocks(locale);
    for (const name of ['batchOcr', 'scanner', 'organize']) {
      assert.deepEqual(Object.keys(b[name]).sort(), Object.keys(en[name]).sort(), `${locale} ${name}`);
      for (const [key, text] of Object.entries(b[name])) {
        assert.ok(typeof text === 'string' && text.trim().length > 0, `${locale} ${name}.${key} is empty`);
        assert.deepEqual(placeholders(text), placeholders(en[name][key]), `${locale} ${name}.${key}: placeholders`);
      }
    }
  }
});

test('no locale copies the English', () => {
  const en = blocks('en');
  const copies = [];
  for (const locale of readdirSync(LOCALES)) {
    if (locale === 'en') continue;
    const allowed = new Set(SAME_AS_ENGLISH[locale] || []);
    const b = blocks(locale);
    for (const name of ['batchOcr', 'scanner', 'organize']) {
      for (const [key, text] of Object.entries(en[name])) {
        if (b[name][key] === text && !allowed.has(`${name}.${key}`)) copies.push(`${locale} ${name}.${key}`);
      }
    }
  }
  assert.deepEqual(copies, []);
});

test('the dialogs use only keys that exist', () => {
  const en = blocks('en');
  for (const [file, block, prefix] of [
    ['../solid/components/dialogs/BatchOcrDialog.jsx', en.batchOcr, 'b'],
    ['../solid/components/dialogs/ScanDialog.jsx', en.scanner, 's'],
  ]) {
    const src = readFileSync(join(HERE, file), 'utf8').replace(/\r\n/g, '\n');
    const used = [...src.matchAll(new RegExp(`\\b${prefix}\\('([A-Za-z]+)'`, 'g'))].map((m) => m[1]);
    assert.ok(used.length > 10, file);
    for (const key of used) assert.ok(key in block, `${file}: ${key}`);
  }
  // Skip reasons are looked up as reason + code (batch-ocr-plan.js REASON).
  for (const code of ['hasText', 'exists', 'openInEditor', 'sameAsSource', 'ownOutput']) {
    assert.ok(`reason${code[0].toUpperCase()}${code.slice(1)}` in en.batchOcr, code);
  }
});
