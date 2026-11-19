// De standaard-weergavemodus is enkele pagina. Doorlopend was dat alleen in
// 2026.47.1; een opgeslagen 'continuous' gaat bij het laden mee terug, omdat
// de voorkeur nergens in de interface in te stellen is.
// Bron gelezen: CI draait Node 20, dat geen .ts importeert.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');

test('een nieuw document opent in de enkele-paginaweergave', () => {
  assert.ok(bron('./constants.ts').includes("defaultViewMode: 'single',"));
  assert.ok(!bron('./constants.ts').includes("defaultViewMode: 'continuous',"));
});

test('een opgeslagen doorlopende standaard gaat mee terug naar enkele pagina', () => {
  const lader = bron('./preferences.js');
  assert.ok(lader.includes("if (loaded.defaultViewMode !== 'single') {"));
  assert.ok(lader.includes("loaded.defaultViewMode = 'single';"));
  assert.ok(!lader.includes("loaded.defaultViewMode = 'continuous';"));
});

test('een tabblad volgt de voorkeur en valt anders terug op enkele pagina', () => {
  assert.ok(bron('../ui/chrome/tabs.js')
    .includes("doc.viewMode = state.preferences?.defaultViewMode === 'continuous' ? 'continuous' : 'single';"));
});
