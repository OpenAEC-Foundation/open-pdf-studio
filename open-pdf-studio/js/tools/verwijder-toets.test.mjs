import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isVerwijderToets } from './verwijder-toets.js';

test('Delete verwijdert, ook met modifiers zoals voorheen', () => {
  assert.equal(isVerwijderToets({ key: 'Delete' }), true);
  assert.equal(isVerwijderToets({ key: 'Delete', shiftKey: true }), true);
});

test('Backspace zonder modifiers verwijdert (Mac-toetsenbord, #951)', () => {
  assert.equal(isVerwijderToets({ key: 'Backspace' }), true);
  for (const mod of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
    assert.equal(isVerwijderToets({ key: 'Backspace', [mod]: true }), false, mod);
  }
});

test('andere toetsen niet', () => {
  assert.equal(isVerwijderToets({ key: 'x' }), false);
  assert.equal(isVerwijderToets(null), false);
});

test('de toetsafhandeling gebruikt de regel voor de verwijdertak', () => {
  const bron = readFileSync(new URL('./keyboard-handlers.js', import.meta.url), 'utf8');
  assert.match(bron, /import \{ isVerwijderToets \} from '\.\/verwijder-toets\.js';/);
  assert.match(bron, /else if \(isVerwijderToets\(e\)\) \{\s*\n\s*if \(!aan\(e, 'edit\.delete', 'Delete'\)\) return;/);
  // Het gereedschap krijgt Backspace eerst (laatste punt weg).
  assert.ok(bron.indexOf('_activeTool.onKeyDown(_keyCtx, e);') < bron.indexOf('else if (isVerwijderToets(e))'));
});
