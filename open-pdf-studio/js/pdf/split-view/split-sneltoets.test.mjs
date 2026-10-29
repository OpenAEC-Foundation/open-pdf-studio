// Gesplitste weergave (#858): sneltoetsen om te splitsen en op te heffen, de
// scheidingslijn met het toetsenbord verschuiven, en een scheidingslijn die
// beter te pakken is.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SPLIT_OPDRACHTEN, VERHOUDING_STAP, splitToetsOpdracht, splitOpdrachtActie, splitToetsGeblokkeerd,
} from './split-sneltoets.js';
import { CORE_COMMANDS } from '../../core/keybindings/default-commands.js';
import { RIBBON_COMMANDS } from '../../core/keybindings/ribbon-commands.generated.js';
import { createKeybindingRegistry } from '../../core/keybindings/registry.js';
import { RESERVED } from '../../core/keybindings/dispatch.js';
import { parseBinding } from '../../core/keybindings/binding.js';
import { MIN_VERHOUDING, MAX_VERHOUDING } from './split-staat.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const JS = join(HIER, '../..');
const lees = (rel) => readFileSync(join(JS, rel), 'utf8').replace(/\r\n/g, '\n');

const opdracht = (id) => CORE_COMMANDS.find((c) => c.id === id);

// ── De opdrachten in de sneltoetsenlijst ─────────────────────────────────

test('Split Vertical, Split Horizontal, Unsplit en Groter/Kleiner staan in de categorie View', () => {
  assert.deepEqual(SPLIT_OPDRACHTEN, [
    'view.splitVertical', 'view.splitHorizontal', 'view.unsplit', 'view.splitPaneLarger', 'view.splitPaneSmaller',
  ]);
  for (const id of SPLIT_OPDRACHTEN) {
    const c = opdracht(id);
    assert.ok(c, id);
    assert.equal(c.category, 'view', id);
    assert.ok(c.labelKey && c.label, id);
    assert.notEqual(c.allowInInput, true, `${id} werkt niet tijdens het typen`);
  }
  assert.deepEqual(opdracht('view.splitVertical').defaults, ['Ctrl+\\']);
  assert.deepEqual(opdracht('view.splitHorizontal').defaults, ['Ctrl+Shift+\\']);
  for (const id of ['view.unsplit', 'view.splitPaneLarger', 'view.splitPaneSmaller']) {
    assert.deepEqual(opdracht(id).defaults || [], [], `${id} heeft geen standaardtoets`);
  }
  // De namen van het lint voor de drie bestaande menu-items.
  assert.equal(opdracht('view.splitVertical').labelKey, 'ribbon:view.splitVertical');
  assert.equal(opdracht('view.splitHorizontal').labelKey, 'ribbon:view.splitHorizontal');
  assert.equal(opdracht('view.unsplit').labelKey, 'ribbon:view.unsplit');
});

test('Ctrl+\\ en Ctrl+Shift+\\ waren vrij: geen andere opdracht, geen vaste toets', () => {
  const r = createKeybindingRegistry();
  for (const def of CORE_COMMANDS) r.define(def);
  assert.equal(r.ownerOf('Ctrl+\\'), 'view.splitVertical');
  assert.equal(r.ownerOf('Ctrl+Shift+\\'), 'view.splitHorizontal');
  const anderen = CORE_COMMANDS.filter((c) => !SPLIT_OPDRACHTEN.includes(c.id)).flatMap((c) => (c.defaults || []).map(parseBinding));
  assert.ok(!anderen.includes('Ctrl+\\'));
  assert.ok(!anderen.includes('Ctrl+Shift+\\'));
  assert.ok(!RESERVED.includes('Ctrl+\\') && !RESERVED.includes('Ctrl+Shift+\\'));
  // Lintknoppen hebben geen standaardtoetsen; de lijst noemt de splitsknoppen niet apart.
  assert.ok(RIBBON_COMMANDS.every((o) => !o.defaults));
  // Geen andere toetsafhandeling die al op de backslash reageert.
  const toetsen = lees('tools/keyboard-handlers.js');
  assert.equal((toetsen.match(/Backslash/g) || []).length, 0, 'keyboard-handlers gebruikt splitToetsOpdracht, niet zelf Backslash');
  assert.doesNotMatch(lees('main.js'), /Backslash|e\.key === '\\\\'/);
});

// ── Welke toets is welke opdracht ────────────────────────────────────────

const toets = (extra) => ({ key: '\\', code: 'Backslash', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, ...extra });

test('Ctrl+\\ is Split Vertical, Ctrl+Shift+\\ Split Horizontal (ook als Shift er | van maakt)', () => {
  assert.equal(splitToetsOpdracht(toets()), 'view.splitVertical');
  assert.equal(splitToetsOpdracht(toets({ shiftKey: true, key: '|' })), 'view.splitHorizontal');
  assert.equal(splitToetsOpdracht(toets({ shiftKey: true })), 'view.splitHorizontal');
  // Cmd op macOS telt als Ctrl, zoals bij de andere sneltoetsen.
  assert.equal(splitToetsOpdracht(toets({ ctrlKey: false, metaKey: true })), 'view.splitVertical');
  // Een ISO-toetsenbord: de backslash naast de linker Shift.
  assert.equal(splitToetsOpdracht(toets({ code: 'IntlBackslash' })), 'view.splitVertical');
  // Een indeling waar de backslash-toets iets anders typt: de fysieke toets telt.
  assert.equal(splitToetsOpdracht(toets({ key: '#' })), 'view.splitVertical');
});

test('zonder Ctrl, met Alt (AltGr) of een andere toets: geen splitsopdracht', () => {
  assert.equal(splitToetsOpdracht(toets({ ctrlKey: false })), null);
  assert.equal(splitToetsOpdracht(toets({ altKey: true })), null);
  assert.equal(splitToetsOpdracht(toets({ key: '/', code: 'Slash' })), null);
  assert.equal(splitToetsOpdracht(toets({ key: 'a', code: 'KeyA' })), null);
  assert.equal(splitToetsOpdracht(null), null);
});

// ── Wat een opdracht doet ────────────────────────────────────────────────

test('de toets van de splitsing die er al staat heft hem op; de andere wisselt de richting', () => {
  assert.deepEqual(splitOpdrachtActie('view.splitVertical', null), { soort: 'splitsen', richting: 'vertical' });
  assert.deepEqual(splitOpdrachtActie('view.splitHorizontal', null), { soort: 'splitsen', richting: 'horizontal' });
  assert.deepEqual(splitOpdrachtActie('view.splitVertical', { richting: 'vertical', verhouding: 0.5, actief: 0 }), { soort: 'opheffen' });
  assert.deepEqual(splitOpdrachtActie('view.splitHorizontal', { richting: 'horizontal', verhouding: 0.5, actief: 0 }), { soort: 'opheffen' });
  assert.deepEqual(splitOpdrachtActie('view.splitHorizontal', { richting: 'vertical', verhouding: 0.5, actief: 1 }), { soort: 'splitsen', richting: 'horizontal' });
  assert.deepEqual(splitOpdrachtActie('view.splitVertical', { richting: 'horizontal', verhouding: 0.5, actief: 0 }), { soort: 'splitsen', richting: 'vertical' });
});

test('Unsplit heft alleen een splitsing op die er is', () => {
  assert.equal(splitOpdrachtActie('view.unsplit', null), null);
  assert.deepEqual(splitOpdrachtActie('view.unsplit', { richting: 'vertical', verhouding: 0.5, actief: 0 }), { soort: 'opheffen' });
});

test('Groter/Kleiner: de scheidingslijn in stappen van 5%, voor het actieve paneel', () => {
  assert.equal(VERHOUDING_STAP, 0.05);
  const st = (verhouding, actief = 0) => ({ richting: 'vertical', verhouding, actief, sync: false });
  // Paneel 0 (links/boven) actief: groter = de lijn naar rechts/onder.
  assert.deepEqual(splitOpdrachtActie('view.splitPaneLarger', st(0.5, 0)), { soort: 'verhouding', verhouding: 0.55 });
  assert.deepEqual(splitOpdrachtActie('view.splitPaneSmaller', st(0.5, 0)), { soort: 'verhouding', verhouding: 0.45 });
  // Paneel 1 (rechts/onder) actief: groter = de lijn naar links/boven.
  assert.deepEqual(splitOpdrachtActie('view.splitPaneLarger', st(0.5, 1)), { soort: 'verhouding', verhouding: 0.45 });
  assert.deepEqual(splitOpdrachtActie('view.splitPaneSmaller', st(0.5, 1)), { soort: 'verhouding', verhouding: 0.55 });
  // Geen afrondingsruis na een paar stappen.
  let s = st(0.5, 0);
  for (let i = 0; i < 3; i++) s = { ...s, verhouding: splitOpdrachtActie('view.splitPaneLarger', s).verhouding };
  assert.equal(s.verhouding, 0.65);
  // Na slepen staat de lijn ergens tussenin: de stap is nog steeds 5%.
  assert.deepEqual(splitOpdrachtActie('view.splitPaneLarger', st(0.5372, 0)), { soort: 'verhouding', verhouding: 0.5872 });
  // Zonder splitsing: niets.
  assert.equal(splitOpdrachtActie('view.splitPaneLarger', null), null);
  assert.equal(splitOpdrachtActie('view.splitPaneSmaller', null), null);
});

test('Groter/Kleiner blijven binnen dezelfde grenzen als slepen', () => {
  const st = (verhouding, actief = 0) => ({ richting: 'horizontal', verhouding, actief, sync: false });
  assert.equal(MIN_VERHOUDING, 0.15);
  assert.equal(MAX_VERHOUDING, 0.85);
  assert.deepEqual(splitOpdrachtActie('view.splitPaneLarger', st(0.83, 0)), { soort: 'verhouding', verhouding: MAX_VERHOUDING });
  assert.deepEqual(splitOpdrachtActie('view.splitPaneSmaller', st(0.17, 0)), { soort: 'verhouding', verhouding: MIN_VERHOUDING });
  // Al op de grens: niets meer te doen.
  assert.equal(splitOpdrachtActie('view.splitPaneLarger', st(0.85, 0)), null);
  assert.equal(splitOpdrachtActie('view.splitPaneLarger', st(0.15, 1)), null);
  assert.equal(splitOpdrachtActie('view.splitPaneSmaller', st(0.15, 0)), null);
  assert.equal(splitOpdrachtActie('onbekend', st(0.5)), null);
});

// ── Niet tijdens het typen of in een dialoog ─────────────────────────────

const el = (tagName, { editable = false, binnen = [] } = {}) => ({
  tagName, isContentEditable: editable,
  closest: (sel) => (binnen.some((b) => sel.split(',').map((s) => s.trim()).includes(b)) ? {} : null),
});

test('de sneltoetsen doen niets in een tekstvak, formulierveld, contenteditable of dialoog', () => {
  assert.equal(splitToetsGeblokkeerd(el('CANVAS')), false);
  assert.equal(splitToetsGeblokkeerd(el('BODY')), false);
  assert.equal(splitToetsGeblokkeerd(null), false);
  assert.equal(splitToetsGeblokkeerd(el('INPUT')), true);
  assert.equal(splitToetsGeblokkeerd(el('TEXTAREA')), true);
  assert.equal(splitToetsGeblokkeerd(el('SELECT')), true);
  assert.equal(splitToetsGeblokkeerd(el('DIV', { editable: true })), true);
  assert.equal(splitToetsGeblokkeerd(el('SPAN', { binnen: ['[contenteditable="true"]'] })), true);
  assert.equal(splitToetsGeblokkeerd(el('BUTTON', { binnen: ['[role="dialog"]'] })), true);
  assert.equal(splitToetsGeblokkeerd(el('DIV', { binnen: ['.modal-overlay'] })), true);
  assert.equal(splitToetsGeblokkeerd(el('CANVAS'), { modaalOpen: true }), true);
});

test('de toetsafhandeling: standaardtoets en zelf gekozen toets lopen via split-sneltoets.js', () => {
  const kh = lees('tools/keyboard-handlers.js');
  assert.match(kh, /import \{[^}]*splitToetsOpdracht[^}]*\} from '\.\.\/pdf\/split-view\/split-sneltoets\.js'/);
  // De standaardtoets: eerst of de toets nog bij de opdracht hoort, dan of hij hier mag.
  assert.match(kh, /splitToetsOpdracht\(e\)/);
  assert.match(kh, /aan\(e, splitId, splitId === 'view\.splitHorizontal' \? 'Ctrl\+Shift\+\\\\' : 'Ctrl\+\\\\'\)/);
  assert.match(kh, /splitToetsGeblokkeerd\(e\.target, \{ modaalOpen: modaalOpen\(\) \}\)/);
  // Een zelf gekozen toets (ook Groter/Kleiner, die geen standaardtoets hebben).
  assert.match(kh, /if \(isSplitOpdracht\(id\)\) \{/);
  const sv = lees('pdf/split-view/split-view.js');
  assert.match(sv, /export function voerSplitOpdrachtUit\(id\)/);
  assert.match(sv, /splitOpdrachtActie\(id, splitStaatVan\(doc\)\)/);
});

test('richting wisselen houdt de zoom van beide panelen vast (ook een passende)', () => {
  const sv = lees('pdf/split-view/split-view.js');
  const blok = sv.slice(sv.indexOf('export function splitsWeergave'), sv.indexOf('export function hefSplitsingOp'));
  assert.match(blok, /markAnchored\(\)/);
  assert.match(blok, /S\.zetVerankerd\(bestaand\.stand\)/);
});

// ── De scheidingslijn ────────────────────────────────────────────────────

test('scheidingslijn: dunne zichtbare lijn, grijpvlak van 4 px aan elke kant, oplichten bij aanwijzen, geen eigen cursor', () => {
  const css = lees('../styles/layout.css');
  const regels = (sel) => {
    const i = css.indexOf(`${sel} {`);
    assert.ok(i >= 0, sel);
    return css.slice(i, css.indexOf('}', i));
  };
  const lijn = regels('.split-host.split-aan > .split-divider');
  assert.match(lijn, /flex: 0 0 2px;/);
  assert.match(lijn, /position: relative;/);
  assert.match(lijn, /cursor: default;/);
  const grip = regels('.split-host.split-aan > .split-divider::before');
  assert.match(grip, /left: -4px;/);
  assert.match(grip, /right: -4px;/);
  const gripH = regels('.split-host.split-aan.split-horizontaal > .split-divider::before');
  assert.match(gripH, /top: -4px;/);
  assert.match(gripH, /bottom: -4px;/);
  assert.match(gripH, /left: 0;/);
  assert.match(css, /\.split-host\.split-aan > \.split-divider:hover,\s*\n\.split-host\.split-aan > \.split-divider\.split-divider-slepen \{\s*background: var\(--theme-accent, #0078d4\);/);
  // Geen resize- of verplaatscursor op de lijn (projectregel).
  const blok = css.slice(css.indexOf('.split-host.split-aan > .split-divider {'), css.indexOf('/* Het actieve paneel'));
  assert.doesNotMatch(blok, /cursor: (?!default)/);
  // Het grijpvlak ligt boven het kader van het actieve paneel en de panelen.
  assert.match(lijn, /z-index: 36;/);
  const sv = lees('pdf/split-view/split-view.js');
  assert.match(sv, /scheiding\.classList\.add\('split-divider-slepen'\)/);
  assert.match(sv, /scheiding\.classList\.remove\('split-divider-slepen'\)/);
});

// ── Vertalingen ──────────────────────────────────────────────────────────

test('alle 40 talen noemen Groter/Kleiner, echt vertaald', () => {
  const LOCALES = join(JS, 'i18n/locales');
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  const tekst = (taal, k) => JSON.parse(readFileSync(join(LOCALES, taal, 'preferences.json'), 'utf8')).keyboardShortcuts.commands[k];
  for (const k of ['splitPaneLarger', 'splitPaneSmaller']) {
    assert.equal(opdracht(k === 'splitPaneLarger' ? 'view.splitPaneLarger' : 'view.splitPaneSmaller').labelKey, `preferences:keyboardShortcuts.commands.${k}`);
    for (const taal of talen) {
      const v = tekst(taal, k);
      assert.ok(typeof v === 'string' && v.trim(), `${taal} ${k}`);
      if (taal !== 'en') assert.notEqual(v, tekst('en', k), `${taal} ${k}`);
    }
  }
  assert.equal(tekst('en', 'splitPaneLarger'), 'Make Active Pane Larger');
  assert.equal(tekst('en', 'splitPaneSmaller'), 'Make Active Pane Smaller');
  assert.equal(tekst('nl', 'splitPaneLarger'), 'Actief paneel groter maken');
  assert.equal(tekst('nl', 'splitPaneSmaller'), 'Actief paneel kleiner maken');
});

test('zetVerankerd: een passend paneel houdt zijn zoom bij een andere paneelmaat', async () => {
  const S = await import('./split-staat.js');
  const stand = { modus: 'single', page: 2, scale: 0.8, cssW: 400, cssH: 800, vp: { zoom: 0.8, offsetX: 10, offsetY: 20, pageW: 600, pageH: 800, verankerd: false, strikt: false }, layout: null };
  const vast = S.zetVerankerd(stand);
  assert.equal(vast.vp.verankerd, true);
  assert.equal(stand.vp.verankerd, false, 'het origineel blijft ongewijzigd');
  const na = S.pasViewportAanMaat(vast.vp, { cssW: 400, cssH: 800 }, { cssW: 800, cssH: 400 }, { w: 600, h: 800 });
  assert.equal(na.zoom, 0.8);
  // Een doorlopende stand heeft geen viewport: die houdt zijn schaal toch al.
  const kolomStand = { modus: 'continuous', page: 1, scale: 1.3, vp: null, layout: null };
  assert.deepEqual(S.zetVerankerd(kolomStand), kolomStand);
  assert.equal(S.zetVerankerd(null), null);
});
