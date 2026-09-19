// Reader Mode texts: present and translated in all 39 locales. The tooltip is
// the only place that tells the user a file is kept next to the PDF, so that
// sentence has to be there in every language, not only in English.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES = join(dirname(fileURLToPath(import.meta.url)), '../i18n/locales');
const KEYS = ['readerMode', 'readerModeTip', 'readerModeSaveFailed'];

const view = (locale) => JSON.parse(readFileSync(join(LOCALES, locale, 'ribbon.json'), 'utf8')).view || {};

test('all 39 locales have the Reader Mode texts', () => {
  const locales = readdirSync(LOCALES);
  assert.equal(locales.length, 39);
  for (const locale of locales) {
    const v = view(locale);
    for (const key of KEYS) {
      assert.equal(typeof v[key], 'string', `${locale} view.${key} missing`);
      assert.ok(v[key].trim().length > 0, `${locale} view.${key} empty`);
    }
  }
});

test('no locale falls back to the English sentences', () => {
  const en = view('en');
  for (const locale of readdirSync(LOCALES)) {
    if (locale === 'en') continue;
    const v = view(locale);
    for (const key of ['readerModeTip', 'readerModeSaveFailed']) {
      assert.notEqual(v[key], en[key], `${locale} view.${key} is the English text`);
    }
  }
});

test('every tooltip discloses the file next to the PDF and the cloud-folder consequence', () => {
  for (const locale of readdirSync(LOCALES)) {
    const tip = view(locale).readerModeTip;
    assert.match(tip, /OneDrive/, `${locale}: cloud-folder disclosure missing`);
    assert.match(tip, /Dropbox/, `${locale}: cloud-folder disclosure missing`);
  }
});

test('the English tooltip describes this PDF, not every PDF', () => {
  const tip = view('en').readerModeTip;
  assert.match(tip, /this PDF/);
  assert.doesNotMatch(tip, /each PDF/);
});
