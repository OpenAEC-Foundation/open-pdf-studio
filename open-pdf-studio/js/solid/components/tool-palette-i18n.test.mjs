// The "Tool Palette" button in the View tab opens the symbol palette (#882).
// Its title ("Toolpalette"), tooltips, settings dialog and built-in category
// names were fixed text in the component and data files, so with a German
// system locale and English chosen in Settings that panel did not follow the
// app language while the rest of the interface did.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initialLanguage } from '../../i18n/initial-language.js';
import { categoryLabel } from '../data/symbolLocales.js';

const lees = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const LOCALES = new URL('../../i18n/locales/', import.meta.url);
const ribbon = (taal) => JSON.parse(fs.readFileSync(new URL(`${taal}/ribbon.json`, LOCALES), 'utf8'));

// Run the real startup module (as initial-language.test.mjs does): Vite's glob
// and the stored preference come from the harness, locale JSON is real.
async function start(t, browser, stored) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: browser });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  });
  const modules = new Proxy({}, { get: (_, path) => async () => (
    { default: JSON.parse(await readFile(new URL(`../../i18n/${path}`, import.meta.url), 'utf8')) }
  ) });
  const source = (await readFile(new URL('../../i18n/config.js', import.meta.url), 'utf8'))
    .replace(/\r\n/g, '\n')
    .replace(/^import .*;\n/gm, '')
    .replace("import.meta.glob('./locales/*/*.json')", 'modules')
    .replace(/export default i18next;/, '')
    .replace(/export /g, '');
  const instance = i18next.createInstance();
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const loadLocale = await new AsyncFunction('i18next', 'LanguageDetector', 'leesOpslag', 'modules', 'initialLanguage',
    `${source}\nreturn loadLocale;`)(instance, LanguageDetector, () => stored, modules, initialLanguage);
  // What applyPreferences() does through changeLanguage(): load, then switch.
  const kies = async (taal) => { await loadLocale(taal); await instance.changeLanguage(taal); };
  return { instance, kies };
}

const deuren = { id: 'nen1414-td', name: 'NL NEN 1414 — Deuren', builtin: true };

test('German system locale, English preference: palette texts are English', async (t) => {
  const { instance, kies } = await start(t, { languages: ['de-DE', 'de'], language: 'de-DE' });
  const tr = (k, o) => instance.t(k, { ns: 'ribbon', ...o });
  assert.equal(instance.language, 'de');
  assert.equal(tr('view.toolPaletteLabel'), 'Werkzeugpalette');
  assert.equal(categoryLabel(tr, deuren), 'NL NEN 1414 — Türen');

  await kies('en');
  assert.equal(tr('view.toolPaletteLabel'), 'Tool Palette');
  assert.equal(tr('symbolPalette.search'), 'Search symbols...');
  assert.equal(tr('symbolPalette.settingsTitle'), 'Symbol Library Settings');
  assert.equal(tr('palette.smallIcons'), 'Small Icons');
  assert.equal(categoryLabel(tr, deuren), 'NL NEN 1414 — Doors');
  assert.equal(tr('symbolPalette.downloading', { current: 2, total: 5, label: 'x' }), 'Downloading 2/5: x');

  await kies('fr');
  assert.equal(categoryLabel(tr, deuren), 'NL NEN 1414 — Portes');
});

test('custom and downloaded groups keep their own name', () => {
  const tr = () => { throw new Error('not looked up'); };
  assert.equal(categoryLabel(tr, { id: 'mijn-groep', name: 'Mijn groep', builtin: false }), 'Mijn groep');
  // Unknown built-in id: the data name is the fallback.
  const echo = (k, o) => o.defaultValue;
  assert.equal(categoryLabel(echo, { id: 'nieuw', name: 'NL Nieuw', builtin: true }), 'NL Nieuw');
});

test('the palette components contain no fixed interface text', () => {
  const symbool = lees('./SymbolPalette.jsx');
  for (const vast of ['Toolpalette', 'Search symbols', 'No symbols found', 'title="Tekeninstellingen"', 'title="Systeemtypen beheren"',
    'Symbol Library Settings', '<span>Industrie</span>', '<span>Land</span>', 'Online bibliotheek', 'Downloaden {',
    'Download mislukt', '>Built-in<', '>+ Add Symbol<', '>Export<', '>Remove<', 'No symbols yet', 'New group name',
    'Add Group', 'Import Group', 'Catalogus \'', 'Bestand niet herkend', 'Import mislukt', 'title="Settings"']) {
    assert.ok(!symbool.includes(vast), `SymbolPalette.jsx still contains "${vast}"`);
  }
  assert.equal(symbool.match(/\{t\('view\.toolPaletteLabel'\)\}/g)?.length, 2, 'docked and floating title');
  assert.equal(symbool.match(/categoryLabel\(t, cat\)/g)?.length, 2, 'palette header and settings list');

  const gereedschap = lees('./ToolPalette.jsx');
  for (const vast of ['Small Icons', 'Large Icons', 'title="Settings"']) {
    assert.ok(!gereedschap.includes(vast), `ToolPalette.jsx still contains "${vast}"`);
  }
  // Plugin palette tooltips are read inside the render, not once at mount.
  const ext = lees('./ExtensionToolPalette.jsx');
  assert.match(ext, /<ExtToolBtn tool=\{item\.tool\} title=\{title\(\)\}/);
  assert.match(ext, /<ExtToolGroupBtn groupDef=\{item\} title=\{title\(\)\}/);
});

test('every language has every palette text, with the same placeholders', () => {
  const talen = fs.readdirSync(LOCALES);
  assert.ok(talen.length >= 40);
  const en = ribbon('en');
  const plat = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (
    typeof v === 'object' ? plat(v, `${pre}${k}.`) : [[`${pre}${k}`, v]]));
  const engels = new Map([...plat(en.symbolPalette, 'symbolPalette.'), ...plat(en.palette, 'palette.')]);
  const vars = (s) => (s.match(/\{\{\w+\}\}/g) || []).sort().join();
  for (const taal of talen) {
    const d = ribbon(taal);
    const eigen = new Map([...plat(d.symbolPalette || {}, 'symbolPalette.'), ...plat(d.palette || {}, 'palette.')]);
    let gelijk = 0;
    for (const [sleutel, tekst] of engels) {
      const vertaald = eigen.get(sleutel);
      assert.ok(typeof vertaald === 'string' && vertaald.trim(), `${taal}: ${sleutel}`);
      assert.equal(vars(vertaald), vars(tekst), `${taal}: ${sleutel} placeholders`);
      if (vertaald === tekst) gelijk++;
    }
    // A real translation, not a copy of English (loanwords such as "Online").
    if (taal !== 'en') assert.ok(gelijk <= 3, `${taal}: ${gelijk} texts identical to English`);
  }
});

test('Dutch category names match the names in the data files', () => {
  const nl = ribbon('nl').symbolPalette.categories;
  const data = lees('../data/nlSymbolLibrary.js');
  let gevonden = 0;
  for (const [, id, naam] of data.matchAll(/id: '(nl-[a-z-]+)',\n(?:\s*\/\/.*\n|\s*builtin: true,\n)*\s*name: '([^']+)'/g)) {
    assert.equal(nl[id], naam, id);
    gevonden++;
  }
  assert.equal(gevonden, 5);
  const nen = lees('../data/nen1414Library.js');
  for (const [, prefix, naam] of nen.matchAll(/'(T[a-z]+)': \{ name: '([^']+)'/g)) {
    assert.equal(nl[`nen1414-${prefix.toLowerCase()}`], naam, prefix);
    gevonden++;
  }
  assert.equal(gevonden, 12);
  assert.equal(Object.keys(nl).length, 12);
});
