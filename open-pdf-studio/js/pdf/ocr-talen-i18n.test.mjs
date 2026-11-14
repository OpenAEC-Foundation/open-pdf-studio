import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// OCR languages (#1083): every locale has the same OCR language texts as
// English, none empty, the placeholders kept; Dutch, German, French and
// Spanish are translated; every key the language picker uses exists.
const HIER = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HIER, '../i18n/locales');

const plat = (obj, prefix = '') => Object.entries(obj || {}).flatMap(([k, v]) =>
  (v && typeof v === 'object' ? plat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));
const blok = (taal) => Object.fromEntries(plat(
  JSON.parse(readFileSync(join(LOCALES, taal, 'dialogs.json'), 'utf8')).ocrLanguage,
));
const plaatshouders = (tekst) => [...String(tekst).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

const NIEUW = ['alsoEnglish', 'addLanguage', 'download', 'downloading', 'downloaded', 'downloadFailed',
  'invalidFile', 'folderNotWritable', 'openFolder', 'hint'];

test('all 40 locales have the same OCR language keys as English, none empty, same placeholders', () => {
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  const en = blok('en');
  for (const k of [...NIEUW, 'variants.vertical', 'variants.historic', 'variants.fraktur', 'variants.equations']) {
    assert.ok(en[k], `en ocrLanguage.${k}`);
  }
  for (const taal of talen) {
    const b = blok(taal);
    assert.deepEqual(Object.keys(b).sort(), Object.keys(en).sort(), taal);
    for (const [sleutel, tekst] of Object.entries(b)) {
      assert.ok(typeof tekst === 'string' && tekst.trim(), `${taal} ${sleutel} is empty`);
      assert.deepEqual(plaatshouders(tekst), plaatshouders(en[sleutel]), `${taal} ${sleutel} placeholders`);
    }
  }
});

test('the new OCR language texts are translated in Dutch, German, French and Spanish', () => {
  const en = blok('en');
  for (const taal of ['nl', 'de', 'fr', 'es']) {
    const b = blok(taal);
    assert.deepEqual(NIEUW.filter((k) => b[k] === en[k]), [], `${taal} keeps English text`);
  }
});

test('every ocrLanguage key the language picker uses exists', () => {
  const en = blok('en');
  const bron = readFileSync(join(HIER, '../solid/components/dialogs/OcrLanguagePicker.jsx'), 'utf8');
  const gebruikt = [...new Set([...bron.matchAll(/\bo\('([A-Za-z.]+)'/g)].map((m) => m[1]))];
  for (const k of [...NIEUW, 'language', 'options.auto']) {
    assert.ok(gebruikt.includes(k), `ocrLanguage.${k} is used`);
  }
  for (const k of gebruikt) assert.ok(en[k], `ocrLanguage.${k} exists in en`);
});
