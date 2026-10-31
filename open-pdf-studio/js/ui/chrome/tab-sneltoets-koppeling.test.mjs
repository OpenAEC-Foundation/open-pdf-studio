// Koppeling van de tabwissel-sneltoetsen (#539) in de app: waar de handler
// hangt, dat een tabwissel de weergavestand van elk document hergebruikt in
// plaats van opnieuw passend te maken, en dat het sneltoetsenoverzicht de
// nieuwe toetsen in alle talen noemt. Deze bestanden laden in node niet
// (webview-afhankelijk), dus hier op de bron gecontroleerd.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = dirname(fileURLToPath(import.meta.url));
const js = join(hier, '../..');
const bron = (pad) => readFileSync(join(js, pad), 'utf8').replace(/\r\n/g, '\n');

const blok = (tekst, begin, eind) => {
  const start = tekst.indexOf(begin);
  assert.ok(start >= 0, `"${begin}" niet gevonden`);
  const stop = tekst.indexOf(eind, start + begin.length);
  return tekst.slice(start, stop >= 0 ? stop : undefined);
};

test('de sneltoets hangt in de capture-fase op window, vóór elke andere toetsafhandeling', () => {
  const kh = bron('tools/keyboard-handlers.js');
  const init = blok(kh, 'export function initKeyboardHandlers', '\n}\n');
  assert.match(init, /window\.addEventListener\('keydown',\s*handleTabSneltoets,\s*true\)/);
  assert.match(kh, /maakTabSneltoetsHandler\(/);
  assert.match(kh, /maakTabWisselaar\(/);
});

test('de bewaking kijkt naar dialogen, tekstbewerking en lopende sessies', () => {
  const kh = bron('tools/keyboard-handlers.js');
  const bewaking = blok(kh, 'const handleTabSneltoets = maakTabSneltoetsHandler(', '\n});\n');
  for (const naam of ['isModalOpen()', 'getDialogs()', 'state.isEditingText', 'state.pdfTextEditState',
    'isGMoveModeActive()', 'isGRotateModeActive()', 'state.imageCropMode', 'typeLengthActive()']) {
    assert.ok(bewaking.includes(naam), `${naam} ontbreekt in de bewaking`);
  }
});

test('de gewone toetsafhandeling laat de tabwissel-toetsen liggen', () => {
  const kh = bron('tools/keyboard-handlers.js');
  const handler = blok(kh, 'export async function handleKeydown', 'const isInInput');
  assert.match(handler, /if \(tabSneltoetsRichting\(e\)\) return;/);
});

test('de tekstinvoer-bewaking is één gedeelde functie', () => {
  const kh = bron('tools/keyboard-handlers.js');
  assert.doesNotMatch(kh, /function isTextEntryTarget/, 'geen tweede kopie in keyboard-handlers.js');
  assert.match(kh, /import \{[^}]*isTextEntryTarget[^}]*\} from '\.\.\/ui\/chrome\/tab-sneltoets\.js'/);
});

test('switchToTab geeft de render-belofte terug en de sneltoets gebruikt de tabbladvolgorde', () => {
  const tabs = bron('ui/chrome/tabs.js');
  const wissel = blok(tabs, 'export function switchToTab', '\n}\n');
  assert.match(wissel, /return eersteRender;/);
  const sneltoets = blok(tabs, 'export function wisselTabMetSneltoets', '\n}\n');
  assert.match(sneltoets, /volgendTabDoel\(/);
  assert.match(sneltoets, /voerTabWisselUit\(/);
  assert.match(sneltoets, /compareActive\(\)/);
});

test('de doorlopende weergave zet de scrollpositie terug zodra de pagina\'s staan', () => {
  const tabs = bron('ui/chrome/tabs.js');
  // De wissel zelf staat sinds #893 in toonTab (switchToTab rondt daaromheen
  // een paneelwissel van de gesplitste weergave af).
  const wissel = blok(tabs, 'function toonTab', '\n}\n');
  assert.doesNotMatch(wissel, /setTimeout\(\(\) => \{\s*pdfContainer\.scrollLeft/, 'geen vertraagde scrollsprong meer');
  assert.match(wissel, /Promise\.resolve\(firstRender\)/);
});

test('setPage zet bij een documentwissel de bewaarde stand terug in plaats van altijd passend te maken', () => {
  const vp = bron('pdf/pdf-viewport.js');
  const setPage = blok(vp, 'export function setPage', '\n}\n');
  assert.match(setPage, /wisselWeergave\(/);
  assert.match(setPage, /getBestAvailableBitmap\(/, 'de gecachte bitmap staat direct klaar');
  assert.match(setPage, /return hersteld;/);
  // Alleen nog passend maken als er niets terug te zetten valt.
  assert.match(setPage, /else if \(isNewDocument \|\| isRotationChange \|\| isViewRotationChange\)/);
  const renderer = bron('pdf/renderer.js');
  assert.match(renderer, /const _hersteld = setPage\(/);
  assert.match(renderer, /if \(_hersteld\) _orch\.ensureTileForCurrentView\(pdfCanvas\)/);
});

test('sluiten vergeet de weergavestand van het document', () => {
  const release = bron('pdf/document-release.js');
  const vrij = blok(release, 'async function geefPadVrij', '\n}\n');
  assert.match(vrij, /vergeetWeergaveStand\(pad\)/);
});

test('in de vergelijkingsweergave bladert alleen PageUp/PageDown zonder Ctrl', () => {
  const cv = bron('solid/components/compare/CompareView.jsx');
  const toetsen = blok(cv, 'const onKey = (e) => {', "document.addEventListener('keydown', onKey, true);");
  const ctrlRegel = toetsen.indexOf('e.ctrlKey');
  assert.ok(ctrlRegel >= 0 && ctrlRegel < toetsen.indexOf("e.key === 'PageDown'"), 'Ctrl+PageDown is de tabwissel');
});

test('het sneltoetsenoverzicht noemt de nieuwe toetsen', async () => {
  // Sinds #714 komt het overzicht uit het sneltoetsenregister; de vaste
  // toetsen van de tabwissel staan in FIXED_SHORTCUTS.
  const dialoog = bron('solid/components/dialogs/ShortcutsDialog.jsx');
  assert.match(dialoog, /FIXED_SHORTCUTS\.map\(/);
  const { FIXED_SHORTCUTS } = await import('../../core/keybindings/default-commands.js');
  const volgende = FIXED_SHORTCUTS.find((f) => f.labelKey === 'common:tabs.nextTab');
  const vorige = FIXED_SHORTCUTS.find((f) => f.labelKey === 'common:tabs.previousTab');
  assert.deepEqual(volgende.keys, ['Ctrl+Tab', 'Ctrl+PageDown']);
  assert.deepEqual(vorige.keys, ['Ctrl+Shift+Tab', 'Ctrl+PageUp']);
});

// ── Vertalingen ──────────────────────────────────────────────────────────────

const LOCALES = join(js, 'i18n/locales');
const KEYS = ['nextTab', 'previousTab'];
const ENGELS = { nextTab: 'Next Tab', previousTab: 'Previous Tab' };
const tabsVan = (locale) => JSON.parse(readFileSync(join(LOCALES, locale, 'common.json'), 'utf8')).tabs || {};

test('alle 40 talen hebben de namen van de tabwissel', () => {
  const locales = readdirSync(LOCALES);
  assert.equal(locales.length, 40);
  for (const locale of locales) {
    const t = tabsVan(locale);
    for (const key of KEYS) {
      assert.equal(typeof t[key], 'string', `${locale} tabs.${key} ontbreekt`);
      assert.ok(t[key].trim().length > 0, `${locale} tabs.${key} is leeg`);
    }
    assert.notEqual(t.nextTab, t.previousTab, `${locale}: volgende en vorige verschillen`);
  }
});

test('Engels is leidend en geen andere taal valt terug op het Engels', () => {
  const en = tabsVan('en');
  for (const key of KEYS) assert.equal(en[key], ENGELS[key]);
  for (const locale of readdirSync(LOCALES)) {
    if (locale === 'en') continue;
    const t = tabsVan(locale);
    for (const key of KEYS) assert.notEqual(t[key], ENGELS[key], `${locale} tabs.${key} is de Engelse tekst`);
  }
});
