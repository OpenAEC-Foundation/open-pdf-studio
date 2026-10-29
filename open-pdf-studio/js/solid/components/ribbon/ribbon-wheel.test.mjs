import assert from 'node:assert/strict';
import test from 'node:test';
import { wheelTab } from './ribbon-wheel.js';
import { voegSamenMetStandaarden } from '../../../core/preferences-merge.js';
import { readFileSync, readdirSync } from 'node:fs';

const tabs = ['home', 'view', 'drawing', 'comment', 'example.extension', 'format', 'arrange'];
const wheel = (deltaY, extra = {}) => ({ deltaY, ...extra });
test('one vertical wheel event advances one visible tab, including extensions and context tabs', () => {
  let active = tabs[0];
  for (const expected of tabs.slice(1)) {
    active = wheelTab(tabs, active, wheel(120));
    assert.equal(active, expected);
  }
  for (const expected of tabs.slice(0, -1).reverse()) {
    active = wheelTab(tabs, active, wheel(-120));
    assert.equal(active, expected);
  }
});
test('hard ends; wheel magnitude and delta units do not skip tabs', () => {
  assert.equal(wheelTab(tabs, 'home', wheel(-120)), 'home');
  assert.equal(wheelTab(tabs, 'arrange', wheel(120)), 'arrange');
  for (const deltaMode of [0, 1, 2]) for (const delta of [1, 3, 100, 120, 1000]) {
    assert.equal(wheelTab(tabs, 'home', wheel(delta, { deltaMode })), 'view');
  }
});
test('modifiers, handled events and horizontal-only gestures do not activate tabs', () => {
  for (const key of ['ctrlKey', 'shiftKey', 'altKey', 'metaKey', 'defaultPrevented']) {
    assert.equal(wheelTab(tabs, 'home', wheel(120, { [key]: true })), null);
  }
  for (const deltaY of [0, NaN, Infinity]) assert.equal(wheelTab(tabs, 'home', wheel(deltaY)), null);
  assert.equal(wheelTab(tabs, 'home', wheel(1, { deltaX: 120 })), null);
});
test('legacy measure alias, disappearing tabs and an empty ribbon', () => {
  assert.equal(wheelTab(tabs, 'measure', wheel(-120)), 'drawing');
  assert.equal(wheelTab(['home', 'view'], 'home', wheel(120)), 'view');
  assert.equal(wheelTab(tabs, 'removed', wheel(120)), null);
  assert.equal(wheelTab([], 'home', wheel(120)), null);
});
test('existing preferences get the default but a saved opt-out survives loading', () => {
  assert.equal(voegSamenMetStandaarden({ ribbonWheelTabs: true }, {}).ribbonWheelTabs, true);
  assert.equal(voegSamenMetStandaarden({ ribbonWheelTabs: true }, { ribbonWheelTabs: false }).ribbonWheelTabs, false);
});
test('the preference label is available in every supported locale', () => {
  const root = new URL('../../../i18n/locales/', import.meta.url);
  for (const locale of readdirSync(root)) {
    const prefs = JSON.parse(readFileSync(new URL(`${locale}/preferences.json`, root), 'utf8'));
    assert.ok(prefs.behavior.ribbonWheelTabs?.trim(), locale);
  }
});
