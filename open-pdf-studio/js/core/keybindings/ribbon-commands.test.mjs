// The ribbon buttons that can get a keyboard shortcut (#714), the labels and
// tooltips, and the wiring in the app.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { RIBBON_COMMANDS } from './ribbon-commands.generated.js';
import { CORE_COMMANDS, RIBBON_ALIASES, FIXED_SHORTCUTS, CATEGORY_ORDER } from './default-commands.js';
import { stripShortcutText, titleWithShortcut, commandLabel, categoryLabel, matchesSearch, groupCommands } from './labels.js';
import { genereer, DOEL } from '../../../scripts/genereer-lint-sneltoetsen.mjs';

// Windows checks the sources out with CRLF.
const lf = (tekst) => tekst.replace(/\r\n/g, '\n');
const bron = (pad) => lf(readFileSync(new URL(pad, import.meta.url), 'utf8'));
const LOCALES = new URL('../../i18n/locales/', import.meta.url);
const json = (locale, ns) => JSON.parse(readFileSync(new URL(`${locale}/${ns}.json`, LOCALES), 'utf8'));
const opzoeken = (locale, sleutel) => {
  const [ns, pad] = sleutel.split(':');
  return pad.split('.').reduce((o, k) => o?.[k], json(locale, ns));
};

test('the generated list of ribbon buttons is up to date (node scripts/genereer-lint-sneltoetsen.mjs)', () => {
  assert.equal(lf(readFileSync(DOEL, 'utf8')), genereer());
});

test('the list has the ribbon buttons, each with a tab and a name', () => {
  assert.ok(RIBBON_COMMANDS.length > 100);
  const ids = RIBBON_COMMANDS.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const id of ['insert-page', 'first-page', 'next-page-ribbon', 'dr-trim', 'ribbon-compare', 'arr-dist-left']) assert.ok(ids.includes(id), id);
  for (const o of RIBBON_COMMANDS) {
    assert.ok(CATEGORY_ORDER.includes(`ribbon:${o.tab}`), o.tab);
    assert.ok(o.labelKey || o.label, o.id);
    if (o.labelKey) assert.equal(typeof opzoeken('en', o.labelKey), 'string', `${o.id}: ${o.labelKey}`);
  }
});

test('ribbon buttons that run a built-in command share its shortcut', () => {
  const ids = new Set(RIBBON_COMMANDS.map((o) => o.id));
  const kern = new Set(CORE_COMMANDS.map((c) => c.id));
  for (const [knop, opdracht] of Object.entries(RIBBON_ALIASES)) {
    assert.ok(ids.has(knop), `ribbon button ${knop} exists`);
    assert.ok(kern.has(opdracht), `command ${opdracht} exists`);
  }
});

test('every built-in command and fixed key has a name in English', () => {
  for (const c of [...CORE_COMMANDS, ...FIXED_SHORTCUTS]) {
    assert.equal(typeof opzoeken('en', c.labelKey), 'string', c.labelKey);
    assert.ok(c.label, c.labelKey);
  }
});

test('shortcuts written in a text are removed, the current one is added', () => {
  assert.equal(stripShortcutText('Fit Page (Ctrl+2)'), 'Fit Page');
  assert.equal(stripShortcutText('Fullscreen (Ctrl+L / F11)'), 'Fullscreen');
  assert.equal(stripShortcutText('Navigation Panel (F9)'), 'Navigation Panel');
  assert.equal(stripShortcutText('Proofreading mode (F2): mark insertions'), 'Proofreading mode: mark insertions');
  assert.equal(stripShortcutText('Radius (R)'), 'Radius (R)', 'a letter in brackets is not a shortcut');
  assert.equal(stripShortcutText('Distance (mm)'), 'Distance (mm)');
  assert.equal(stripShortcutText('ページに合わせる（Ctrl+2）'), 'ページに合わせる');
  assert.equal(titleWithShortcut('Fit Page (Ctrl+2)', 'Ctrl+K'), 'Fit Page (Ctrl+K)');
  assert.equal(titleWithShortcut('Fit Page (Ctrl+2)', ''), 'Fit Page');
  assert.equal(titleWithShortcut('Insert page', 'F6'), 'Insert page (F6)');
});

test('names: from the translation, without the old key, with a fallback', () => {
  const t = (key, o) => ({ 'ribbon:home.fitPage': 'Pagina passend (Ctrl+2)' }[key] ?? o?.defaultValue ?? key);
  assert.equal(commandLabel({ id: 'x', labelKey: 'ribbon:home.fitPage', label: 'Fit Page' }, t), 'Pagina passend');
  assert.equal(commandLabel({ id: 'x', labelKey: 'ribbon:missing', label: 'Fit Page' }, t), 'Fit Page');
  assert.equal(commandLabel({ id: 'ext:a:b', label: (taal) => (taal === 'nl' ? 'Hallo' : 'Hello') }, t, 'nl'), 'Hallo');
  const tc = (key, o) => (key === 'ribbon:tabs.organize' ? 'Organiseren' : key === 'preferences:keyboardShortcuts.categories.ribbon' ? `Lint: ${o.tab}` : o?.defaultValue);
  assert.equal(categoryLabel('ribbon:organize', tc), 'Lint: Organiseren');
});

test('search by name ("fit" finds Fit Page) or by key', () => {
  const fit = { label: 'Fit Page', bindings: ['Ctrl+2'] };
  assert.ok(matchesSearch(fit, 'fit'));
  assert.ok(matchesSearch(fit, 'FIT'));
  assert.ok(matchesSearch(fit, 'ctrl+2'));
  assert.ok(matchesSearch(fit, 'Strg+2'));
  assert.ok(matchesSearch(fit, 'ctrl+'));
  assert.ok(matchesSearch(fit, ''));
  assert.equal(matchesSearch(fit, 'zoom'), false);
  assert.equal(matchesSearch(fit, 'ctrl+3'), false);
  assert.ok(matchesSearch({ label: 'Find Next', bindings: ['F3'] }, 'f3'));
  assert.ok(matchesSearch({ label: 'Mise à l’échelle', bindings: [] }, 'echelle'), 'accents do not matter');
});

test('commands are grouped in the fixed category order', () => {
  const g = groupCommands([
    { id: 'b', category: 'ribbon:home', order: 2 }, { id: 'a', category: 'file', order: 1 },
    { id: 'c', category: 'extensions', order: 3 }, { id: 'd', category: 'file', order: 0 },
  ]);
  assert.deepEqual(g.map((x) => x.category), ['file', 'ribbon:home', 'extensions']);
  assert.deepEqual(g[0].commands.map((c) => c.id), ['d', 'a']);
});

test('tooltips, menus and the F1 overview show the current shortcuts', () => {
  const knop = bron('../../solid/components/ribbon/RibbonButton.jsx');
  assert.match(knop, /knopTitel\(\{ id: props\.id, extCommand: props\.extCommand, title: props\.title, label: props\.label \}\)/);
  const menu = bron('../../solid/components/app-menu/AppMenu.jsx');
  for (const id of ['file.new', 'file.open', 'file.save', 'file.saveAs', 'file.print', 'file.properties', 'app.preferences']) {
    assert.match(menu, new RegExp(`shortcut=\\{sneltoetsVoor\\('${id.replace('.', '\\.')}'\\)\\}`), id);
  }
  assert.doesNotMatch(menu, /shortcut="Ctrl/, 'no fixed Ctrl texts left in the menu');
  const f1 = bron('../../solid/components/dialogs/ShortcutsDialog.jsx');
  assert.match(f1, /sneltoetsen\.bindingsOf\(c\.id\)/);
  assert.match(f1, /openDialog\('preferences', \{ tab: 'shortcuts' \}\)/, 'Customize… opens the preferences page');
  for (const pad of ['../../solid/components/ribbon/DrawingTab.jsx', '../../solid/components/ribbon/ViewTab.jsx']) {
    assert.doesNotMatch(bron(pad), /\(Ctrl\+/, `${pad}: no shortcut written into a tooltip`);
  }
});

test('preferences: the page, the stored value, applied at once', () => {
  const dlg = bron('../../solid/components/preferences/PreferencesDialog.jsx');
  assert.match(dlg, /\{ id: 'shortcuts', key: 'tabs\.keyboardShortcuts' \}/);
  assert.match(dlg, /<KeyboardShortcutsTab prefs=\{prefs\} \/>/);
  assert.match(bron('../constants.ts'), /\n\s+keyboardShortcuts: \{\},\n/);
  assert.match(bron('../../types/preferences.ts'), /keyboardShortcuts: Record<string, string\[\]>;/);
  const prefs = bron('../preferences.js');
  const toepassen = prefs.slice(prefs.indexOf('export function applyPreferences'));
  assert.match(toepassen, /pasSneltoetsVoorkeurToe\(state\.preferences\.keyboardShortcuts\)/);
  const pagina = bron('../../solid/components/preferences/KeyboardShortcutsTab.jsx');
  for (const naam of ['saveFileDialog(', 'openFileDialog(', 'writeBinaryFile(', 'readBinaryFile(', 'parseShortcutsFile(', 'serializeShortcutsFile(',
    'assignBinding(', 'removeBinding(', 'resetCommand(', 'zetSneltoetsOpname(true)', "window.addEventListener('keydown', opToets, true)"]) {
    assert.ok(pagina.includes(naam), naam);
  }
});

// ── Translations ─────────────────────────────────────────────────────────────

const blok = (locale) => json(locale, 'preferences').keyboardShortcuts || {};
const plat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? plat(v, `${p}${k}.`) : [[`${p}${k}`, v]]));
// Words that really are the same as in English in that language.
const ZELFDE = {
  it: ['File'], ms: ['Edit', 'Import…'], ca: ['Extensions'], fr: ['Extensions'], nl: ['Help'],
};

test('all 40 locales have every keyboard shortcuts text, translated, with the placeholders', () => {
  const locales = readdirSync(LOCALES);
  assert.equal(locales.length, 40);
  const en = new Map(plat(blok('en')));
  assert.ok(en.size >= 40);
  const gekopieerd = [];
  for (const locale of locales) {
    const hier = new Map(plat(blok(locale)));
    assert.deepEqual([...hier.keys()].sort(), [...en.keys()].sort(), locale);
    for (const [k, v] of hier) {
      assert.ok(typeof v === 'string' && v.trim(), `${locale} ${k}`);
      for (const ph of (en.get(k).match(/\{\{\w+\}\}/g) || [])) assert.ok(v.includes(ph), `${locale} ${k} misses ${ph}`);
      if (locale !== 'en' && v === en.get(k) && !(ZELFDE[locale] || []).includes(v)) gekopieerd.push(`${locale} ${k}: ${v}`);
    }
    assert.equal(json(locale, 'preferences').tabs.keyboardShortcuts, hier.get('title'), `${locale} tab name`);
  }
  assert.deepEqual(gekopieerd, []);
});

test('every category used has a name', () => {
  const cats = blok('en').categories;
  for (const c of CATEGORY_ORDER) if (!c.startsWith('ribbon:')) assert.ok(cats[c], c);
  for (const c of CORE_COMMANDS) assert.ok(cats[c.category], c.category);
});
