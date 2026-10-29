// Redacties toepassen legt alleen een zwart vlak over de inhoud (#762). De
// bevestiging mag dan geen veilige, permanente verwijdering beloven en moet
// zeggen dat de inhoud eronder blijft staan.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const bron = fs.readFileSync(new URL('./redaction.js', import.meta.url), 'utf8');
const lees = (taal) => JSON.parse(fs.readFileSync(new URL(`../i18n/locales/${taal}/common.json`, import.meta.url), 'utf8'));

test('de bevestiging belooft geen permanente verwijdering meer', () => {
  assert.doesNotMatch(bron, /permanently black out/);
  assert.doesNotMatch(bron, /cannot be undone/);
});

test('beide commando\'s tonen de waarschuwing dat de inhoud blijft staan', () => {
  for (const fn of ['applyRedactions', 'applyAllRedactions']) {
    const start = bron.indexOf(`export async function ${fn}(`);
    const lichaam = bron.slice(start, bron.indexOf('\n}\n', start));
    assert.match(lichaam, /bevestigRedactie\(vraag\)/, fn);
  }
  const bevestig = bron.slice(bron.indexOf('async function bevestigRedactie('));
  assert.match(bevestig, /applyRedactionsOverlayWarning/);
});

test('waarschuwing staat in en en nl en zegt dat de inhoud niet verwijderd wordt', () => {
  assert.match(lees('en').applyRedactionsOverlayWarning, /NOT removed/);
  assert.match(lees('nl').applyRedactionsOverlayWarning, /NIET uit de PDF verwijderd/);
  for (const taal of ['en', 'nl']) {
    const c = lees(taal);
    for (const k of ['applyRedactionsTitle', 'applyRedactionsPageConfirm', 'applyRedactionsAllConfirm']) {
      assert.ok(c[k], `${taal}: ${k}`);
    }
    assert.match(c.applyRedactionsPageConfirm, /\{\{count\}\}[\s\S]*\{\{page\}\}/);
    assert.match(c.applyRedactionsAllConfirm, /\{\{count\}\}[\s\S]*\{\{pages\}\}/);
  }
});
