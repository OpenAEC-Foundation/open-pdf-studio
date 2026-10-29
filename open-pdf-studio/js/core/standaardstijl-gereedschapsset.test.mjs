// "Set as Default Style" while a tool set item is active (#311).
//
// While an item is the active tool, its style is a temporary overlay on the
// style preferences. Saving and ending the item give back the user's own
// value for every key that still holds the overlay value. Choosing "Set as
// Default Style" on an annotation drawn with the item wrote exactly those
// values, so the user's choice was silently thrown away twice: the saved
// file got the old value, and choosing another tool put the old value back.
//
// The real preferences.js and the real tool set session run here.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./app-test-hooks.mjs', import.meta.url);
// The real preferences.js instead of the stub of app-test-hooks.
register(`data:text/javascript,${encodeURIComponent(`
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('/js/core/preferences.js')) {
    return { format: 'module', shortCircuit: true, source: readFileSync(fileURLToPath(url), 'utf8') };
  }
  return nextLoad(url, context);
}`)}`);
const { installeerBrowserStubs } = await import('./app-test-hooks.mjs');
installeerBrowserStubs();
globalThis.window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const { state } = await import('./state.ts');
const { setAsDefaultStyle, savePreferences } = await import('./preferences.js');
const { leesOpslag, VOORKEUREN_NAAM } = await import('./opslag.js');
const { armToolSetItem, endToolSetSession } = await import('../tools/tool-set-session.js');

const STANDAARD = JSON.parse(JSON.stringify(state.preferences));
function verseVoorkeuren() {
  endToolSetSession();
  for (const k of Object.keys(state.preferences)) delete state.preferences[k];
  Object.assign(state.preferences, JSON.parse(JSON.stringify(STANDAARD)), {
    measureDistStrokeColor: '#FF0000', measureDistLineWidth: 1, measureDistDimPrecision: 0,
  });
}

// What savePreferences stored (outside the desktop app: browser storage).
const opgeslagen = () => JSON.parse(leesOpslag(VOORKEUREN_NAAM));

const item = {
  id: 'i1', name: 'Wall', type: 'measureDistance',
  props: { strokeColor: '#1565C0', color: '#1565C0', lineWidth: 0.7, measurePrecision: 2 },
};

// The dimension the user drew with the item: it has the item's style.
const getekend = () => ({
  type: 'measureDistance', strokeColor: '#1565C0', color: '#1565C0', lineWidth: 0.7,
  measurePrecision: 2, opacity: 1,
});

test('without "Set as Default Style" the item never becomes a preference', () => {
  verseVoorkeuren();
  armToolSetItem(item, state.preferences);
  assert.equal(state.preferences.measureDistStrokeColor, '#1565C0', 'the overlay is active');
  savePreferences();
  assert.equal(opgeslagen().measureDistStrokeColor, '#FF0000', 'the own value is saved');
  endToolSetSession();
  assert.equal(state.preferences.measureDistStrokeColor, '#FF0000');
  assert.equal(state.preferences.measureDistLineWidth, 1);
});

test('"Set as Default Style" during an item session is saved and kept after the item ends', () => {
  verseVoorkeuren();
  armToolSetItem(item, state.preferences);
  setAsDefaultStyle(getekend());
  const bewaard = opgeslagen();
  assert.equal(bewaard.measureDistStrokeColor, '#1565C0', 'saved, although it equals the overlay');
  assert.equal(bewaard.measureDistLineWidth, 0.7);
  assert.equal(bewaard.measureDistDimPrecision, 2);

  endToolSetSession();
  assert.equal(state.preferences.measureDistStrokeColor, '#1565C0', 'not put back when the item ends');
  assert.equal(state.preferences.measureDistLineWidth, 0.7);
  assert.equal(state.preferences.measureDistDimPrecision, 2);
  savePreferences();
  assert.equal(opgeslagen().measureDistStrokeColor, '#1565C0');
});

test('"Set as Default Style" with another value than the item also stays', () => {
  verseVoorkeuren();
  armToolSetItem(item, state.preferences);
  setAsDefaultStyle({ ...getekend(), strokeColor: '#00AA00', color: '#00AA00' });
  endToolSetSession();
  assert.equal(state.preferences.measureDistStrokeColor, '#00AA00');
  // A key "Set as Default Style" did not write is still given back.
  assert.equal(state.preferences.language, STANDAARD.language);
});

test('"Set as Default Style" on another type leaves the item overlay to end normally', () => {
  verseVoorkeuren();
  armToolSetItem(item, state.preferences);
  setAsDefaultStyle({ type: 'line', strokeColor: '#123456', lineWidth: 3, opacity: 1 });
  endToolSetSession();
  assert.equal(state.preferences.lineStrokeColor, '#123456');
  assert.equal(state.preferences.measureDistStrokeColor, '#FF0000', 'the item style is given back');
});
