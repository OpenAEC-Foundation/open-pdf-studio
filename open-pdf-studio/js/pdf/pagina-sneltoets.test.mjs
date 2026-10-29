// Bladeren met PageUp / PageDown in de hoofdweergave (#751, #713).
// Getest: welke toetsen meetellen, het doel (enkel/doorlopend en facing, geen
// omloop), de rem op toetsherhaling, en de koppeling in de app: de handler in
// handleKeydown, het sneltoetsenoverzicht en de vertalingen. De app-bestanden
// laden in node niet (webview-afhankelijk), die worden op de bron gecontroleerd.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  paginaSneltoetsRichting,
  paginaToetsVoorInvoer,
  paginaSprongDoel,
  maakPaginaBladeraar,
} from './pagina-sneltoets.js';

const toets = (key, mods = {}) => ({
  key,
  ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
  ...mods,
});

// ── Welke toetsen ───────────────────────────────────────────────────────────

test('kale PageDown/PageUp bladeren naar volgende/vorige', () => {
  assert.equal(paginaSneltoetsRichting(toets('PageDown')), 1);
  assert.equal(paginaSneltoetsRichting(toets('PageUp')), -1);
});

test('met Ctrl, Shift, Alt of Meta erbij is het geen paginasprong', () => {
  for (const mod of ['ctrlKey', 'shiftKey', 'altKey', 'metaKey']) {
    assert.equal(paginaSneltoetsRichting(toets('PageDown', { [mod]: true })), 0, mod);
    assert.equal(paginaSneltoetsRichting(toets('PageUp', { [mod]: true })), 0, mod);
  }
  assert.equal(paginaSneltoetsRichting(toets('ArrowDown')), 0);
  assert.equal(paginaSneltoetsRichting(null), 0);
});

test('tekstvelden, keuzelijsten en contenteditable houden de toets', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
    assert.equal(paginaToetsVoorInvoer({ tagName }), true, tagName);
  }
  assert.equal(paginaToetsVoorInvoer({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(paginaToetsVoorInvoer({ tagName: 'SPAN', closest: (s) => (s.includes('contenteditable') ? {} : null) }), true);
  assert.equal(paginaToetsVoorInvoer({ tagName: 'CANVAS', closest: () => null }), false);
  assert.equal(paginaToetsVoorInvoer({ tagName: 'BODY' }), false);
  assert.equal(paginaToetsVoorInvoer(null), false);
});

// ── Doel ────────────────────────────────────────────────────────────────────

test('enkele en doorlopende weergave: één pagina per toets', () => {
  assert.equal(paginaSprongDoel({ huidig: 3, totaal: 10 }, 1), 4);
  assert.equal(paginaSprongDoel({ huidig: 3, totaal: 10 }, -1), 2);
});

test('geen omloop op de eerste en laatste pagina', () => {
  assert.equal(paginaSprongDoel({ huidig: 1, totaal: 10 }, -1), null);
  assert.equal(paginaSprongDoel({ huidig: 10, totaal: 10 }, 1), null);
  assert.equal(paginaSprongDoel({ huidig: 1, totaal: 1 }, 1), null);
  assert.equal(paginaSprongDoel({ huidig: 1, totaal: 1 }, -1), null);
  assert.equal(paginaSprongDoel({ huidig: 3, totaal: 10 }, 0), null);
});

test('facing: een hele spread per toets (1 | 2-3 | 4-5 | ...)', () => {
  const f = (huidig, totaal, richting) => paginaSprongDoel({ huidig, totaal, facing: true }, richting);
  assert.equal(f(1, 10, 1), 2);
  assert.equal(f(2, 10, 1), 4);
  assert.equal(f(3, 10, 1), 4, 'rechterpagina telt als haar spread');
  assert.equal(f(4, 10, -1), 2);
  assert.equal(f(2, 10, -1), 1);
  assert.equal(f(1, 10, -1), null);
});

test('facing: stopt op de laatste spread', () => {
  const f = (huidig, totaal, richting) => paginaSprongDoel({ huidig, totaal, facing: true }, richting);
  assert.equal(f(10, 11, 1), null, 'spread 10-11 is de laatste');
  assert.equal(f(10, 10, 1), null, 'pagina 10 alleen is de laatste');
  assert.equal(f(8, 10, 1), 10);
  assert.equal(f(1, 1, 1), null);
});

// ── Rem op toetsherhaling ────────────────────────────────────────────────────

function uitgesteld() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
const rust = () => new Promise((r) => setImmediate(r));

function maakProef() {
  const sprongen = [];
  const renders = [];
  const beelden = [];
  const bladeraar = maakPaginaBladeraar({
    blader: (richting) => {
      sprongen.push(richting);
      const r = uitgesteld();
      renders.push(r);
      return r.promise;
    },
    naBeeld: () => {
      const b = uitgesteld();
      beelden.push(b);
      return b.promise;
    },
    wacht: () => new Promise(() => {}),
  });
  return { bladeraar, sprongen, renders, beelden };
}

test('ingedrukt houden: herhalingen tijdens een lopende sprong vallen weg', async () => {
  const { bladeraar, sprongen, renders, beelden } = maakProef();
  assert.equal(bladeraar.vraag(1, false), true);
  for (let i = 0; i < 20; i++) assert.equal(bladeraar.vraag(1, true), false);
  assert.equal(bladeraar.wachtend, 0, 'geen opgespaarde sprong');
  renders[0].resolve();
  await rust();
  beelden[0].resolve();
  await rust();
  assert.deepEqual(sprongen, [1], 'precies één stap');
  assert.equal(bladeraar.bezig, false);
  // De volgende herhaling na het beeld bladert weer één stap.
  assert.equal(bladeraar.vraag(1, true), true);
  assert.deepEqual(sprongen, [1, 1]);
});

test('een losse aanslag tijdens een sprong wacht, hoogstens één (de laatste)', async () => {
  const { bladeraar, sprongen, renders, beelden } = maakProef();
  bladeraar.vraag(1, false);
  bladeraar.vraag(1, false);
  bladeraar.vraag(-1, false);
  assert.equal(bladeraar.wachtend, -1);
  renders[0].resolve();
  await rust();
  beelden[0].resolve();
  await rust();
  assert.deepEqual(sprongen, [1, -1]);
  renders[1].resolve();
  await rust();
  beelden[1].resolve();
  await rust();
  assert.deepEqual(sprongen, [1, -1]);
  assert.equal(bladeraar.bezig, false);
});

// ── Koppeling in de app ──────────────────────────────────────────────────────

const hier = dirname(fileURLToPath(import.meta.url));
const js = join(hier, '..');
const bron = (pad) => readFileSync(join(js, pad), 'utf8').replace(/\r\n/g, '\n');
const blok = (tekst, begin, eind) => {
  const start = tekst.indexOf(begin);
  assert.ok(start >= 0, `"${begin}" niet gevonden`);
  const stop = tekst.indexOf(eind, start + begin.length);
  return tekst.slice(start, stop >= 0 ? stop : undefined);
};

test('handleKeydown bladert met PageUp/PageDown via goToPage, na de tabwissel', () => {
  const kh = bron('tools/keyboard-handlers.js');
  const handler = blok(kh, 'export async function handleKeydown', '\n}\n');
  assert.match(handler, /if \(handlePaginaSneltoets\(e\)\) return;/);
  assert.ok(handler.indexOf('tabSneltoetsRichting(e)') < handler.indexOf('handlePaginaSneltoets(e)'),
    'Ctrl+PageUp/PageDown blijft de tabwissel');
  const sneltoets = blok(kh, 'function handlePaginaSneltoets', '\n}\n');
  for (const naam of ['paginaSneltoetsRichting(e)', 'paginaToetsVoorInvoer(e.target)', 'isModalOpen()',
    'getDialogs()', 'state.isEditingText', 'state.pdfTextEditState', 'e.preventDefault()', 'e.repeat']) {
    assert.ok(sneltoets.includes(naam), `${naam} ontbreekt in handlePaginaSneltoets`);
  }
  const bladeraar = blok(kh, 'const _paginaBladeraar = maakPaginaBladeraar(', '\n});\n');
  assert.match(bladeraar, /goToPage\(doel\)/);
  assert.match(bladeraar, /facing: !!doc\.facingSpread/);
});

test('de vergelijkingsweergave houdt haar eigen PageUp/PageDown in de capture-fase', () => {
  const cv = bron('solid/components/compare/CompareView.jsx');
  const toetsen = blok(cv, 'const onKey = (e) => {', "document.addEventListener('keydown', onKey, true);");
  assert.match(toetsen, /e\.key === 'PageDown'[\s\S]*e\.stopPropagation\(\)/);
});

test('het sneltoetsenoverzicht noemt PgDn en PgUp', () => {
  const dialoog = bron('solid/components/dialogs/ShortcutsDialog.jsx');
  assert.match(dialoog, /'pageNav\.nextPage'[^\n]*keys: \['PgDn'\]/);
  assert.match(dialoog, /'pageNav\.previousPage'[^\n]*keys: \['PgUp'\]/);
});

const LOCALES = join(js, 'i18n/locales');
const pageNavVan = (locale) => JSON.parse(readFileSync(join(LOCALES, locale, 'common.json'), 'utf8')).pageNav || {};

test('alle talen hebben de namen voor volgende en vorige pagina', () => {
  const locales = readdirSync(LOCALES);
  assert.equal(locales.length, 40);
  const en = pageNavVan('en');
  assert.equal(en.nextPage, 'Next Page');
  assert.equal(en.previousPage, 'Previous Page');
  for (const locale of locales) {
    const t = pageNavVan(locale);
    for (const key of ['nextPage', 'previousPage']) {
      assert.equal(typeof t[key], 'string', `${locale} pageNav.${key} ontbreekt`);
      assert.ok(t[key].trim().length > 0, `${locale} pageNav.${key} is leeg`);
      if (locale !== 'en') assert.notEqual(t[key], en[key], `${locale} pageNav.${key} is de Engelse tekst`);
    }
    assert.notEqual(t.nextPage, t.previousPage, `${locale}: volgende en vorige verschillen`);
  }
});
