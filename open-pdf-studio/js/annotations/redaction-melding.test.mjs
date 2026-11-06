// Redacties toepassen verwijdert de inhoud onder de markeringen (#762). De
// bevestiging zegt dat ook, en belooft niet meer dan er gebeurt: de
// tijdelijke waarschuwing dat de inhoud bleef staan (#817) is vervallen.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const bron = fs.readFileSync(new URL('./redaction.js', import.meta.url), 'utf8');
const lees = (taal) => JSON.parse(fs.readFileSync(new URL(`../i18n/locales/${taal}/common.json`, import.meta.url), 'utf8'));

test('de bevestiging belooft geen onherroepelijke verwijdering', () => {
  assert.doesNotMatch(bron, /permanently black out/);
  assert.doesNotMatch(bron, /cannot be undone/);
});

test('beide commando\'s vragen eerst om bevestiging met de uitleg wat er verdwijnt', () => {
  for (const fn of ['applyRedactions', 'applyAllRedactions']) {
    const start = bron.indexOf(`export async function ${fn}(`);
    const lichaam = bron.slice(start, bron.indexOf('\n}\n', start));
    assert.match(lichaam, /runRedactions\(\{ all: (true|false) \}\)/, fn);
  }
  const run = bron.slice(bron.indexOf('export async function runRedactions('));
  assert.match(run, /redactConfirmBody/);
  assert.match(run, /confirmApply\(/);
  assert.doesNotMatch(bron, /applyRedactionsOverlayWarning/);
});

test('en en nl zeggen dat de inhoud onder de markeringen verwijderd wordt', () => {
  assert.match(lees('en').redactConfirmBody, /removed from the document/);
  assert.match(lees('nl').redactConfirmBody, /verwijder/i);
  for (const taal of ['en', 'nl']) {
    const c = lees(taal);
    assert.match(c.redactConfirmPage, /\{\{count\}\}[\s\S]*\{\{page\}\}/);
    assert.match(c.redactConfirmAll, /\{\{count\}\}[\s\S]*\{\{pages\}\}/);
    for (const k of ['applyRedactionsTitle', 'applyRedactionsPageConfirm', 'applyRedactionsAllConfirm', 'applyRedactionsOverlayWarning']) {
      assert.equal(c[k], undefined, `${taal}: ${k} is vervallen`);
    }
  }
});
