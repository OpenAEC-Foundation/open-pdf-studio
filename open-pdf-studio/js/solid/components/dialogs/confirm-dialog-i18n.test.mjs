// The confirmation dialog (showConfirm in ui/chrome/confirm-dialog.js, shown by
// ConfirmDialog.jsx) follows the interface language: its buttons, its checkbox
// and every caller that goes through the helper. In a Dutch interface it used
// to say Yes, No and "Don't show this again".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HERE, '../../../i18n/locales');
const JS = join(HERE, '../../..');
const langs = readdirSync(LOCALES).sort();
const common = (lang) => JSON.parse(readFileSync(join(LOCALES, lang, 'common.json'), 'utf8'));
const bron = (pad) => readFileSync(join(JS, pad), 'utf8');

const SLEUTELS = ['yes', 'no', 'confirm', 'areYouSure', 'dontShowAgain'];

test('every language has the texts of the confirmation dialog', () => {
  assert.equal(langs.length, 40);
  for (const lang of langs) {
    const c = common(lang);
    for (const k of SLEUTELS) assert.ok(c[k]?.trim(), `${lang}: common.${k}`);
  }
});

test('the new texts are translated in every language', () => {
  const en = common('en');
  const zelfde = (k) => langs.filter((l) => l !== 'en' && common(l)[k] === en[k]);
  assert.deepEqual(zelfde('dontShowAgain'), []);
  assert.deepEqual(zelfde('areYouSure'), []);
  assert.deepEqual(zelfde('confirm'), []);
});

test('Dutch says Ja, Nee and Dit niet meer tonen', () => {
  const nl = common('nl');
  assert.equal(nl.yes, 'Ja');
  assert.equal(nl.no, 'Nee');
  assert.equal(nl.dontShowAgain, 'Dit niet meer tonen');
});

test('the dialog takes all its texts from the common namespace', () => {
  const dialog = bron('solid/components/dialogs/ConfirmDialog.jsx');
  assert.match(dialog, /useTranslation\('common'\)/);
  for (const k of SLEUTELS) assert.ok(dialog.includes(`t('${k}')`), `t('${k}')`);
  // No text of its own left in the markup or as a fallback.
  for (const tekst of ['>Yes<', '>No<', "Don't show this again", "'Confirm'", 'Are you sure?']) {
    assert.ok(!dialog.includes(tekst), tekst);
  }
});

test('the Delete key asks in the interface language, like the context menu', () => {
  const toetsen = bron('tools/keyboard-handlers.js');
  for (const tekst of ['Delete this annotation?', 'Delete Annotation', 'annotations?']) {
    assert.ok(!toetsen.includes(tekst), tekst);
  }
  for (const sleutel of ['deleteAnnotation.title', 'deleteAnnotation.confirmSingle', 'multiSelect.deleteTitle', 'multiSelect.deleteConfirm']) {
    assert.ok(toetsen.includes(`context:${sleutel}`), sleutel);
  }
});
