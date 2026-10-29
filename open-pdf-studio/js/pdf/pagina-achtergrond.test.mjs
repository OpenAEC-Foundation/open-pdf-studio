// Achtergrondkleur rond de pagina (#859): een voorkeur onder Paginaweergave >
// Weergave, gebruikt overal rond en tussen de pagina's (enkele pagina,
// doorlopend, facing, beide panelen van de gesplitste weergave, Vergelijken),
// nooit op de pagina zelf, bij afdrukken, exporteren, miniaturen of in de PDF.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  STANDAARD_ACHTERGROND, CSS_VARIABELE, ACHTERGROND_GEWIJZIGD,
  normaliseerAchtergrond, achtergrondKleur, eigenAchtergrond, zetPaginaAchtergrond,
} from './pagina-achtergrond.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const JS = join(HIER, '..');
const lees = (rel) => readFileSync(join(JS, rel), 'utf8').replace(/\r\n/g, '\n');

function nepOmgeving() {
  const props = new Map();
  const root = { style: { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) } };
  const meldingen = [];
  const venster = { dispatchEvent: (ev) => { meldingen.push(ev.type); return true; }, __pdfViewport: { dirty: false } };
  return { props, root, venster, meldingen };
}

test('de standaard blijft het lichtgrijs van nu; de voorkeur is leeg tot de gebruiker kiest', () => {
  assert.equal(STANDAARD_ACHTERGROND, '#e0e0e0');
  assert.equal(CSS_VARIABELE, '--page-area-bg');
  assert.match(lees('core/constants.ts'), /\n\s+pageBackgroundColor: '',\n/);
  assert.match(lees('types/preferences.ts'), /\n\s+pageBackgroundColor: string;\n/);
});

test('een kleur wordt #rrggbb in kleine letters; iets anders is "standaard"', () => {
  assert.equal(normaliseerAchtergrond('#333333'), '#333333');
  assert.equal(normaliseerAchtergrond(' #3A3A3A '), '#3a3a3a');
  assert.equal(normaliseerAchtergrond('#abc'), '#aabbcc');
  assert.equal(normaliseerAchtergrond(''), '');
  assert.equal(normaliseerAchtergrond(null), '');
  assert.equal(normaliseerAchtergrond('rood'), '');
  assert.equal(normaliseerAchtergrond('#12345'), '');
  assert.equal(normaliseerAchtergrond('url(x)'), '');
});

test('kiezen zet de CSS-variabele, tekent de weergave opnieuw en meldt het; Standaard haalt hem weg', () => {
  const o = nepOmgeving();
  try {
    assert.equal(zetPaginaAchtergrond('#3a3a3a', o), true);
    assert.equal(o.props.get('--page-area-bg'), '#3a3a3a');
    assert.equal(achtergrondKleur(), '#3a3a3a');
    assert.equal(eigenAchtergrond(), '#3a3a3a');
    assert.equal(o.venster.__pdfViewport.dirty, true, 'de enkele-paginaweergave tekent opnieuw');
    assert.deepEqual(o.meldingen, [ACHTERGROND_GEWIJZIGD]);
    // Dezelfde kleur nog eens: niets te doen.
    o.venster.__pdfViewport.dirty = false;
    assert.equal(zetPaginaAchtergrond('#3A3A3A', o), false);
    assert.equal(o.venster.__pdfViewport.dirty, false);
    assert.equal(o.meldingen.length, 1);
    // Standaard: geen eigen kleur, de variabele weg (het thema bepaalt weer).
    assert.equal(zetPaginaAchtergrond('', o), true);
    assert.equal(o.props.has('--page-area-bg'), false);
    assert.equal(achtergrondKleur(), '#e0e0e0');
    assert.equal(eigenAchtergrond(), '');
    assert.equal(o.meldingen.length, 2);
  } finally {
    zetPaginaAchtergrond('', o);
  }
});

test('zonder DOM (node, worker) gaat zetten niet stuk', () => {
  try {
    assert.equal(zetPaginaAchtergrond('#101010', { root: null, venster: null }), true);
    assert.equal(achtergrondKleur(), '#101010');
  } finally {
    zetPaginaAchtergrond('', { root: null, venster: null });
  }
});

// ── Waar de kleur gebruikt wordt ─────────────────────────────────────────

test('enkele pagina (viewportcanvas): beide achtergrondvlakken uit achtergrondKleur()', () => {
  const vp = lees('pdf/pdf-viewport.js');
  assert.match(vp, /import \{ achtergrondKleur \} from '\.\/pagina-achtergrond\.js';/);
  assert.equal((vp.match(/_ctx\.fillStyle = achtergrondKleur\(\);/g) || []).length, 2);
  assert.doesNotMatch(vp, /#e0e0e0/i);
});

test('doorlopend en facing (#pdf-container), het tweede paneel en Vergelijken: de CSS-variabele', () => {
  const css = lees('../styles/layout.css');
  assert.match(css, /\.main-view #pdf-container\.visible \{\s*background: var\(--page-area-bg, transparent\);\s*\}/);
  const paneel = css.slice(css.indexOf('.split-host.split-aan > .split-pane {'));
  assert.match(paneel.slice(0, paneel.indexOf('}')), /background: var\(--page-area-bg, #e0e0e0\);/);
  const cmp = lees('solid/components/compare/CompareView.jsx');
  assert.match(cmp, /class="compare-view"\s*\n\s*style=\{`[^`]*background:var\(--page-area-bg, #2a2a2a\);`\}/);
});

test('gesplitste weergave: tekent het tweede paneel met de gekozen kleur en volgt een wijziging', () => {
  const sv = lees('pdf/split-view/split-view.js');
  assert.doesNotMatch(sv, /#e0e0e0/i);
  assert.match(sv, /import \{ achtergrondKleur, eigenAchtergrond, ACHTERGROND_GEWIJZIGD \} from '\.\.\/pagina-achtergrond\.js';/);
  assert.match(sv, /ctx\.fillStyle = paneelAchtergrond\(s\);/);
  assert.match(sv, /window\.addEventListener\(ACHTERGROND_GEWIJZIGD, \(\) => planTekenen\(\)\)/);
});

test('alleen de weergave kent de kleur: niet afdrukken, exporteren, miniaturen of opslaan', () => {
  const toegestaan = new Set([
    'pdf/pagina-achtergrond.js', 'pdf/pagina-achtergrond.test.mjs', 'pdf/pdf-viewport.js', 'pdf/split-view/split-view.js',
    'core/preferences.js', 'solid/components/preferences/PageDisplayTab.jsx', 'solid/components/preferences/PreferencesDialog.jsx',
  ]);
  const gebruikers = [];
  const loop = (map) => {
    for (const d of readdirSync(map, { withFileTypes: true })) {
      const pad = join(map, d.name);
      if (d.isDirectory()) { if (d.name !== 'node_modules' && d.name !== 'locales') loop(pad); continue; }
      if (!/\.(m?js|jsx|ts)$/.test(d.name)) continue;
      const tekst = readFileSync(pad, 'utf8');
      if (/pagina-achtergrond|pageBackgroundColor|--page-area-bg/.test(tekst)) gebruikers.push(relative(JS, pad).replace(/\\/g, '/'));
    }
  };
  loop(JS);
  const vreemd = gebruikers.filter((g) => !toegestaan.has(g) && !g.endsWith('constants.ts') && !g.endsWith('types/preferences.ts')
    && g !== 'solid/components/compare/CompareView.jsx');
  assert.deepEqual(vreemd, []);
});

// ── Voorkeuren ───────────────────────────────────────────────────────────

test('Voorkeuren > Paginaweergave > Weergave: kleurkiezer en Standaard', () => {
  const tab = lees('solid/components/preferences/PageDisplayTab.jsx');
  const weergave = tab.slice(tab.indexOf("t('pageDisplay.rendering')"), tab.indexOf("t('pageDisplay.actualSize')"));
  assert.match(weergave, /t\('pageDisplay\.backgroundColor'\)/);
  assert.match(weergave, /id="pref-page-background"/);
  assert.match(weergave, /<PrefColorPicker value=\{\(\) => p\.pageBackgroundColor\[0\]\(\) \|\| STANDAARD_ACHTERGROND\} setValue=\{\(v\) => p\.pageBackgroundColor\[1\]\(normaliseerAchtergrond\(v\)\)\} \/>/);
  assert.match(weergave, /id="pref-page-background-default"[^>]*onClick=\{\(\) => p\.pageBackgroundColor\[1\]\(''\)\}/);
  assert.match(weergave, /t\('pageDisplay\.backgroundColorDefault'\)/);
  assert.match(weergave, /t\('pageDisplay\.backgroundColorHint'\)/);
});

test('direct zichtbaar: voorbeeld tijdens het kiezen, Annuleren zet terug, Opslaan en opstarten passen hem toe', () => {
  const dlg = lees('solid/components/preferences/PreferencesDialog.jsx');
  assert.match(dlg, /createEffect\(\(\) => zetPaginaAchtergrond\(prefs\.pageBackgroundColor\[0\]\(\)\)\);/);
  assert.match(dlg, /onCleanup\(\(\) => zetPaginaAchtergrond\(state\.preferences\.pageBackgroundColor\)\);/);
  const prefs = lees('core/preferences.js');
  const toepassen = prefs.slice(prefs.indexOf('export function applyPreferences'));
  assert.match(toepassen.slice(0, toepassen.indexOf('\n}\n')), /zetPaginaAchtergrond\(state\.preferences\.pageBackgroundColor\);/);
});

test('alle 40 talen hebben de teksten, echt vertaald', () => {
  const LOCALES = join(JS, 'i18n/locales');
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  const blok = (taal) => JSON.parse(readFileSync(join(LOCALES, taal, 'preferences.json'), 'utf8')).pageDisplay;
  const en = blok('en');
  assert.equal(en.backgroundColor, 'Background color');
  assert.equal(en.backgroundColorDefault, 'Default');
  assert.equal(blok('nl').backgroundColor, 'Achtergrondkleur');
  assert.equal(blok('nl').backgroundColorDefault, 'Standaard');
  const gekopieerd = [];
  for (const taal of talen) {
    for (const k of ['backgroundColor', 'backgroundColorDefault', 'backgroundColorHint']) {
      const v = blok(taal)[k];
      assert.ok(typeof v === 'string' && v.trim(), `${taal} ${k}`);
      if (taal !== 'en' && v === en[k]) gekopieerd.push(`${taal} ${k}`);
    }
  }
  assert.deepEqual(gekopieerd, []);
});
