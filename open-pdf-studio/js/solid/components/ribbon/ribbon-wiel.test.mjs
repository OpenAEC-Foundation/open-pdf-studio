// Mouse wheel over the ribbon switches ribbon tabs (#852). Pure rules: one
// notch is one tab, no wrap-around, touchpads and high-resolution wheels do
// not race, modifiers and controls with their own wheel are left alone.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

import {
  wielTab, maakWielStapper, wielInPixels, heeftEigenWiel, lintTabs,
  WIEL_DREMPEL_PX, WIEL_RUST_MS, WIEL_PAUZE_MS,
} from './ribbon-wiel.js';

const TABS = ['home', 'view', 'drawing', 'comment', 'organize', 'help', 'nl.a.main', 'format', 'arrange'];

test('wielTab: one step, no wrap-around', () => {
  assert.equal(wielTab(TABS, 'home', 1), 'view');
  assert.equal(wielTab(TABS, 'view', -1), 'home');
  assert.equal(wielTab(TABS, 'home', -1), null);
  assert.equal(wielTab(TABS, 'arrange', 1), null);
  assert.equal(wielTab(TABS, 'help', 1), 'nl.a.main');
  assert.equal(wielTab(TABS, 'nl.a.main', 1), 'format');
  assert.equal(wielTab(TABS, 'home', 0), null);
  assert.equal(wielTab([], 'home', 1), null);
  assert.equal(wielTab(TABS, 'gone', 1), null);
});

test('wielInPixels: lines and pages count as notches', () => {
  assert.equal(wielInPixels({ deltaY: 100, deltaMode: 0 }), 100);
  assert.equal(wielInPixels({ deltaY: 3, deltaMode: 1 }), 100);
  assert.equal(wielInPixels({ deltaY: -1, deltaMode: 2 }), -WIEL_DREMPEL_PX);
  assert.equal(wielInPixels({ deltaY: Number.NaN, deltaMode: 0 }), 0);
});

function stapper() {
  let nu = 1000;
  const s = maakWielStapper({ nu: () => nu });
  return {
    stap: (deltaY, extra = {}) => s.stap({ deltaY, deltaX: 0, deltaMode: 0, ...extra }),
    wacht: (ms) => { nu += ms; },
  };
}

test('stapper: each mouse notch is one tab, also when spun quickly', () => {
  const s = stapper();
  assert.equal(s.stap(100), 1);
  s.wacht(16);
  assert.equal(s.stap(100), 1);
  s.wacht(16);
  assert.equal(s.stap(-100), -1);
  // A coalesced event of three notches still moves one tab.
  s.wacht(16);
  assert.equal(s.stap(300), 1);
  // Line mode (three lines per notch).
  s.wacht(16);
  assert.equal(s.stap(3, { deltaMode: 1 }), 1);
});

test('stapper: small deltas add up to one tab, then pause', () => {
  const s = stapper();
  const kleine = [];
  for (let i = 0; i < 6; i++) { kleine.push(s.stap(10)); s.wacht(8); }
  // 6 x 10 px: the threshold is reached once.
  assert.deepEqual(kleine.filter(Boolean), [1]);
  // A touchpad swipe keeps sending small deltas: no racing through the tabs.
  let stappen = 0;
  for (let i = 0; i < 20; i++) { stappen += Math.abs(s.stap(30)); s.wacht(8); }
  assert.ok(stappen <= 1, `touchpad stepped ${stappen} tabs in 160 ms`);
  // After the pause a new swipe moves the next tab.
  s.wacht(WIEL_PAUZE_MS);
  let na = 0;
  for (let i = 0; i < 3; i++) { na += s.stap(30); s.wacht(8); }
  assert.equal(na, 1);
});

test('stapper: a half gesture is forgotten after a rest, and a direction change resets', () => {
  const s = stapper();
  assert.equal(s.stap(WIEL_DREMPEL_PX - 10), 0);
  s.wacht(WIEL_RUST_MS + 1);
  assert.equal(s.stap(20), 0);
  const t = stapper();
  assert.equal(t.stap(WIEL_DREMPEL_PX - 10), 0);
  assert.equal(t.stap(-20), 0);
  assert.equal(t.stap(-(WIEL_DREMPEL_PX - 20)), -1);
});

test('stapper: mostly horizontal scrolling does not switch tabs', () => {
  const s = stapper();
  assert.equal(s.stap(20, { deltaX: 120 }), 0);
  assert.equal(s.stap(0, { deltaX: -120 }), 0);
});

// A minimal element tree for heeftEigenWiel.
function el(tag, { parent = null, attrs = {}, stijl = {}, scrollHeight = 0, clientHeight = 0, editable = false } = {}) {
  return {
    tagName: tag.toUpperCase(), parentElement: parent, isContentEditable: editable,
    scrollHeight, clientHeight, stijl,
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    hasAttribute: (n) => n in attrs,
  };
}
const stijlVan = (e) => ({ overflowY: 'visible', position: 'static', ...e.stijl });

test('heeftEigenWiel: controls, lists and popups keep their own wheel', () => {
  const lint = el('div');
  const groep = el('div', { parent: lint });
  const knop = el('button', { parent: groep });
  const icoon = el('span', { parent: knop });
  assert.equal(heeftEigenWiel(icoon, lint, stijlVan), false);
  for (const tag of ['input', 'select', 'textarea']) {
    assert.equal(heeftEigenWiel(el(tag, { parent: groep }), lint, stijlVan), true, tag);
  }
  assert.equal(heeftEigenWiel(el('div', { parent: groep, editable: true }), lint, stijlVan), true);
  for (const role of ['listbox', 'menu', 'spinbutton', 'slider', 'combobox']) {
    assert.equal(heeftEigenWiel(el('div', { parent: groep, attrs: { role } }), lint, stijlVan), true, role);
  }
  // A gallery that scrolls.
  const galerij = el('div', { parent: groep, stijl: { overflowY: 'auto' }, scrollHeight: 400, clientHeight: 120 });
  assert.equal(heeftEigenWiel(el('button', { parent: galerij }), lint, stijlVan), true);
  // overflow: auto with nothing to scroll is not a list.
  const vol = el('div', { parent: groep, stijl: { overflowY: 'auto' }, scrollHeight: 100, clientHeight: 100 });
  assert.equal(heeftEigenWiel(el('button', { parent: vol }), lint, stijlVan), false);
  // An open dropdown or flyout (position: fixed) under the pointer.
  const popup = el('div', { parent: groep, stijl: { position: 'fixed' } });
  assert.equal(heeftEigenWiel(el('button', { parent: popup }), lint, stijlVan), true);
  // Explicit opt-out.
  const eigen = el('div', { parent: groep, attrs: { 'data-eigen-wiel': '' } });
  assert.equal(heeftEigenWiel(el('span', { parent: eigen }), lint, stijlVan), true);
  // Nothing above the ribbon container counts.
  const buiten = el('div', { stijl: { position: 'fixed' } });
  const lint2 = el('div', { parent: buiten });
  assert.equal(heeftEigenWiel(el('button', { parent: lint2 }), lint2, stijlVan), false);
  assert.equal(heeftEigenWiel(null, lint, stijlVan), false);
});

test('lintTabs: visible tab buttons in display order, without the file button', () => {
  const knop = (tab, { verborgen = false, klasse = '' } = {}) => ({
    dataset: { tab }, classList: { contains: (c) => klasse.split(' ').includes(c) },
    getClientRects: () => (verborgen ? [] : [{}]),
  });
  const knoppen = [knop('home'), knop('view'), knop('nl.a.main'),
    knop('nl.b.main', { klasse: 'ribbon-ext-tab-verborgen' }), knop('format'), knop('weg', { verborgen: true })];
  assert.deepEqual(lintTabs(knoppen), ['home', 'view', 'nl.a.main', 'format']);
});

// --- wiring, preference and translations -----------------------------------------

const bron = (pad) => readFileSync(new URL(`../../../${pad}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the preference is on by default and has a type and a checkbox', () => {
  assert.match(bron('core/constants.ts'), /ribbonWheelSwitchesTabs: true,/);
  assert.match(bron('types/preferences.ts'), /ribbonWheelSwitchesTabs: boolean;/);
  const tab = bron('solid/components/preferences/BehaviorTab.jsx');
  assert.match(tab, /id="pref-ribbon-wheel-tabs"/);
  assert.match(tab, /p\.ribbonWheelSwitchesTabs\[1\]\(e\.target\.checked\)/);
  assert.match(tab, /t\('behavior\.ribbonWheelSwitchesTabs'\)/);
});

test('the ribbon listens to the wheel on its container, non-passive, and clicks the tab', () => {
  const s = bron('solid/components/ribbon/Ribbon.jsx');
  assert.match(s, /addEventListener\('wheel', opWiel, \{ passive: false \}\)/);
  assert.match(s, /removeEventListener\('wheel', opWiel\)/);
  assert.match(s, /ribbonWheelSwitchesTabs === false/);
  assert.match(s, /e\.ctrlKey \|\| e\.shiftKey/);
  assert.match(s, /heeftEigenWiel\(e\.target, houder/);
  assert.match(s, /e\.preventDefault\(\)/);
  assert.match(s, /knopVan\(volgende\)\?\.click\(\)/);
});

test('every language has its own text for the preference', () => {
  const LOCALES = new URL('../../../i18n/locales/', import.meta.url);
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  const lees = (taal) => JSON.parse(readFileSync(new URL(`${taal}/preferences.json`, LOCALES), 'utf8'));
  const en = lees('en').behavior.ribbonWheelSwitchesTabs;
  assert.equal(en, 'Switch ribbon tabs with the mouse wheel');
  assert.equal(lees('nl').behavior.ribbonWheelSwitchesTabs, 'Linttabbladen wisselen met het muiswiel');
  for (const taal of talen) {
    const raw = readFileSync(new URL(`${taal}/preferences.json`, LOCALES), 'utf8');
    assert.equal(raw.split('"ribbonWheelSwitchesTabs"').length - 1, 1, `${taal}: key occurs once`);
    const v = lees(taal).behavior?.ribbonWheelSwitchesTabs;
    assert.ok(typeof v === 'string' && v.trim(), `${taal} is missing`);
    if (taal !== 'en') assert.notEqual(v, en, `${taal} is not translated`);
  }
});
