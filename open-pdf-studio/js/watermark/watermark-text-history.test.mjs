// The watermark text history (#850): the last text pre-fills the dialog,
// earlier texts are offered while typing, and entries can be removed. Kept
// in the app's browser storage (core/opslag.js), so it survives a restart.
import assert from 'node:assert/strict';
import test from 'node:test';

const winkel = new Map();
globalThis.localStorage = {
  getItem: (k) => (winkel.has(k) ? winkel.get(k) : null),
  setItem: (k, v) => { winkel.set(k, String(v)); },
  removeItem: (k) => { winkel.delete(k); },
};
globalThis.window = {};

const { opslagSleutel } = await import('../core/opslag.js');
const {
  WATERMARK_HISTORY_KEY, WATERMARK_HISTORY_MAX, readWatermarkHistory, lastWatermarkText,
  rememberWatermarkText, forgetWatermarkText, watermarkSuggestions, moveSuggestionIndex,
} = await import('./watermark-text-history.js');

test('the last used text comes back after a restart', () => {
  winkel.clear();
  assert.equal(lastWatermarkText(), null);
  rememberWatermarkText('DRAFT');
  rememberWatermarkText('Project 2026-114');
  assert.equal(lastWatermarkText(), 'Project 2026-114');
  // A new session reads the same storage.
  assert.ok(winkel.has(opslagSleutel(WATERMARK_HISTORY_KEY)));
  assert.deepEqual(readWatermarkHistory(), ['Project 2026-114', 'DRAFT']);
});

test('entries are de-duplicated (ignoring case and spaces around) and capped', () => {
  winkel.clear();
  rememberWatermarkText('DRAFT');
  rememberWatermarkText('Final');
  rememberWatermarkText('  draft ');
  assert.deepEqual(readWatermarkHistory(), ['draft', 'Final']);
  rememberWatermarkText('');
  rememberWatermarkText('   ');
  assert.deepEqual(readWatermarkHistory(), ['draft', 'Final']);
  for (let i = 0; i < WATERMARK_HISTORY_MAX + 10; i++) rememberWatermarkText(`Text ${i}`);
  const history = readWatermarkHistory();
  assert.equal(history.length, WATERMARK_HISTORY_MAX);
  assert.equal(history[0], `Text ${WATERMARK_HISTORY_MAX + 9}`);
});

test('an entry can be removed', () => {
  winkel.clear();
  for (const t of ['DRAFT', 'COPY', 'CONFIDENTIAL']) rememberWatermarkText(t);
  assert.deepEqual(forgetWatermarkText('copy'), ['CONFIDENTIAL', 'DRAFT']);
  assert.deepEqual(readWatermarkHistory(), ['CONFIDENTIAL', 'DRAFT']);
});

test('damaged or foreign storage reads as an empty history', () => {
  winkel.clear();
  winkel.set(opslagSleutel(WATERMARK_HISTORY_KEY), '{"not":"a list"');
  assert.deepEqual(readWatermarkHistory(), []);
  winkel.set(opslagSleutel(WATERMARK_HISTORY_KEY), JSON.stringify(['ok', 3, null, '', 'ok']));
  assert.deepEqual(readWatermarkHistory(), ['ok']);
});

test('a full storage does not break remembering', () => {
  winkel.clear();
  const echte = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = (k, v) => { if (k.includes(WATERMARK_HISTORY_KEY)) throw new Error('quota'); echte(k, v); };
  try {
    assert.deepEqual(rememberWatermarkText('DRAFT'), ['DRAFT']);
  } finally { globalThis.localStorage.setItem = echte; }
});

test('suggestions start at two typed characters and match anywhere, prefix first', () => {
  const history = ['Not for construction', 'DRAFT', 'Construction drawing', 'COPY', 'Draft 2'];
  assert.deepEqual(watermarkSuggestions(history, 'c'), []);
  assert.deepEqual(watermarkSuggestions(history, ' '), []);
  assert.deepEqual(watermarkSuggestions(history, 'co'), ['Construction drawing', 'COPY', 'Not for construction']);
  assert.deepEqual(watermarkSuggestions(history, 'dr'), ['DRAFT', 'Draft 2', 'Construction drawing']);
  assert.deepEqual(watermarkSuggestions(history, 'DRAFT'), ['Draft 2'], 'the exact text is not offered again');
  assert.equal(watermarkSuggestions(Array.from({ length: 20 }, (_, i) => `Item ${i}`), 'it').length, 8);
});

test('Up and Down move through the list and wrap around', () => {
  assert.equal(moveSuggestionIndex(-1, 3, 1), 0);
  assert.equal(moveSuggestionIndex(0, 3, 1), 1);
  assert.equal(moveSuggestionIndex(2, 3, 1), 0);
  assert.equal(moveSuggestionIndex(-1, 3, -1), 2);
  assert.equal(moveSuggestionIndex(0, 3, -1), 2);
  assert.equal(moveSuggestionIndex(5, 0, 1), -1);
});
