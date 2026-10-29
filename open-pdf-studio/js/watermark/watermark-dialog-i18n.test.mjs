// The strings of the watermark dialog (font size and auto-fit, #849) are in
// every locale, translated, with the English placeholders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const map = fileURLToPath(new URL('../i18n/locales/', import.meta.url));
const talen = readdirSync(map);
const dialogs = (taal) => JSON.parse(readFileSync(`${map}${taal}/dialogs.json`, 'utf8')).watermark;
const plaatshouders = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

const SLEUTELS = ['autoFit', 'autoFitHint', 'increaseFontSize', 'decreaseFontSize'];

test('every locale has the watermark dialog strings', () => {
  assert.ok(talen.length >= 40);
  const en = dialogs('en');
  for (const taal of talen) {
    const t = dialogs(taal);
    for (const s of SLEUTELS) {
      assert.equal(typeof t[s], 'string', `${taal}: ${s}`);
      assert.ok(t[s].trim(), `${taal}: ${s} is empty`);
      assert.deepEqual(plaatshouders(t[s]), plaatshouders(en[s]), `${taal}: ${s} placeholders`);
      if (taal !== 'en') assert.notEqual(t[s], en[s], `${taal}: ${s} is not translated`);
    }
  }
});

test('English and Dutch wording', () => {
  assert.equal(dialogs('en').autoFit, 'Auto-fit to page');
  assert.equal(dialogs('nl').autoFit, 'Automatisch passend op pagina');
});
