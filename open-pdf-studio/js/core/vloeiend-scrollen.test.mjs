// Vloeiend scrollen (#1007): voorkeur standaard uit, en elke bron van
// scroll-animatie die de app zelf regelt luistert ernaar.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';

import {
  VLOEIEND_SCROLLEN_STANDAARD,
  GEEN_VLOEIEND_SCROLLEN_KLASSE,
  VLOEIEND_SCROLLEN_OPDRACHT,
  vloeiendScrollenAan,
  scrollGedrag,
  zetVloeiendScrollen,
} from './vloeiend-scrollen.js';
import { maakWielScroller, maakElementVerschuiver } from '../pdf/wiel-scroll.js';

const JS = new URL('../', import.meta.url);
const APP = new URL('../../', import.meta.url);
const bron = (pad, basis = JS) => readFileSync(new URL(pad, basis), 'utf8').replace(/\r\n/g, '\n');

function nepDocument() {
  const klassen = new Set();
  return {
    klassen,
    documentElement: {
      classList: {
        toggle(naam, aan) { if (aan) klassen.add(naam); else klassen.delete(naam); return aan; },
      },
    },
  };
}

test('de voorkeur staat standaard uit, ook als ze ontbreekt of geen boolean is', () => {
  assert.equal(VLOEIEND_SCROLLEN_STANDAARD, false);
  assert.match(bron('core/constants.ts'), /\n {2}smoothScrolling: false,\n/);
  assert.match(bron('types/preferences.ts'), /\n {2}smoothScrolling: boolean;\n/);
  for (const waarde of [undefined, null, 'true', 1, false]) {
    assert.equal(zetVloeiendScrollen(waarde, { doc: nepDocument() }), false, String(waarde));
    assert.equal(vloeiendScrollenAan(), false);
    assert.equal(scrollGedrag(), 'auto');
  }
});

test('aan en uit: scrollgedrag, CSS-klasse op <html> en de Rust-opdracht volgen de voorkeur', async () => {
  const doc = nepDocument();
  const aanroepen = [];
  const roep = (cmd, args) => { aanroepen.push([cmd, args]); return Promise.resolve(true); };
  assert.equal(zetVloeiendScrollen(true, { doc, roep }), true);
  assert.equal(scrollGedrag(), 'smooth');
  assert.equal(doc.klassen.has(GEEN_VLOEIEND_SCROLLEN_KLASSE), false);
  assert.equal(zetVloeiendScrollen(false, { doc, roep }), false);
  assert.equal(scrollGedrag(), 'auto');
  assert.equal(doc.klassen.has(GEEN_VLOEIEND_SCROLLEN_KLASSE), true);
  assert.deepEqual(aanroepen, [
    ['zet_vloeiend_scrollen', { aan: true }],
    ['zet_vloeiend_scrollen', { aan: false }],
  ]);
  assert.equal(VLOEIEND_SCROLLEN_OPDRACHT, 'zet_vloeiend_scrollen');
});

test('een mislukte of ontbrekende Rust-opdracht breekt het toepassen niet', async () => {
  const doc = nepDocument();
  assert.equal(zetVloeiendScrollen(true, { doc, roep: () => Promise.reject(new Error('nee')) }), true);
  assert.equal(zetVloeiendScrollen(true, { doc, roep: () => { throw new Error('geen Tauri'); } }), true);
  assert.equal(zetVloeiendScrollen(false, { doc: null }), false);
  await new Promise((r) => setTimeout(r, 0));
});

test('wielscroller: met vloeiend uit schuift een muiswielklik direct en in één keer op', () => {
  let t = 0;
  let aan = true;
  const pos = { y: 0 };
  const frames = [];
  const s = maakWielScroller({
    nu: () => t,
    vraagFrame: (f) => frames.push(f),
    verschuif: (_dx, dy) => { pos.y += dy; },
    vloeiend: () => aan,
  });
  // Aan: de klik loopt uit over frames.
  s.wiel(0, 100, true);
  assert.equal(pos.y, 0);
  assert.equal(s.actief, true);
  // Uit tijdens de uitloop: de oude uitloop stopt, de nieuwe klik gaat direct.
  aan = false;
  s.wiel(0, 100, true);
  assert.equal(pos.y, 100);
  assert.equal(s.actief, false);
  t += 50;
  while (frames.length) frames.shift()();
  assert.equal(pos.y, 100, 'geen naijlende uitloop na het uitzetten');
  s.wiel(0, -40, true);
  assert.equal(pos.y, 60);
});

test('wielscroller: direct scrollen in een element klemt gewoon op de rand', () => {
  const el = { scrollTop: 950, scrollLeft: 0, scrollHeight: 1100, clientHeight: 100, scrollWidth: 100, clientWidth: 100 };
  Object.defineProperty(el, 'scrollTop', {
    get() { return this._top ?? 950; },
    set(v) { this._top = Math.max(0, Math.min(1000, Math.round(v))); },
  });
  const verschuif = maakElementVerschuiver(() => el);
  const s = maakWielScroller({ nu: () => 0, vraagFrame: () => {}, verschuif, ruimte: verschuif.ruimte, vloeiend: () => false });
  s.wiel(0, 100, true);
  assert.equal(el.scrollTop, 1000);
  s.wiel(0, -100, true);
  assert.equal(el.scrollTop, 900);
});

test('beide app-wielscrollers (viewport en #pdf-container) volgen de voorkeur', () => {
  for (const pad of ['pdf/pdf-viewport.js', 'ui/setup/navigation-events.js']) {
    const s = bron(pad);
    assert.match(s, /import \{ vloeiendScrollenAan \} from '[./]+\/core\/vloeiend-scrollen\.js';/, pad);
    assert.match(s, /maakWielScroller\(\{[^}]*vloeiend: vloeiendScrollenAan,[^}]*\}\)/s, pad);
  }
});

test('applyPreferences past de voorkeur live toe, met de Rust-opdracht alleen in Tauri', () => {
  const s = bron('core/preferences.js');
  const begin = s.indexOf('export function applyPreferences()');
  const eind = s.indexOf('\n}\n', begin);
  assert.ok(begin > 0 && eind > begin);
  assert.match(s.slice(begin, eind),
    /zetVloeiendScrollen\(state\.preferences\.smoothScrolling, \{ roep: isTauri\(\) \? invoke : null \}\);/);
});

// Alle bronbestanden onder js/ (zonder tests en vertalingen).
function bronbestanden(map = JS, uit = []) {
  for (const naam of readdirSync(map)) {
    const url = new URL(naam, map);
    if (statSync(url).isDirectory()) {
      if (naam !== 'i18n' && naam !== 'node_modules') bronbestanden(new URL(`${naam}/`, map), uit);
    } else if (/\.(m?js|jsx|ts|tsx)$/.test(naam) && !/\.test\.m?js$/.test(naam)) {
      uit.push(url);
    }
  }
  return uit;
}

test('geen enkele sprong scrolt nog hard-gecodeerd vloeiend: altijd via scrollGedrag()', () => {
  const overtreders = [];
  let viaVoorkeur = 0;
  for (const url of bronbestanden()) {
    const regels = readFileSync(url, 'utf8').split(/\r?\n/);
    regels.forEach((regel, i) => {
      if (/^\s*(\/\/|\*)/.test(regel)) return;
      if (/behavior:\s*['"]smooth['"]/.test(regel)) overtreders.push(`${url.pathname}:${i + 1}`);
      if (/behavior:[^,}]*scrollGedrag\(\)/.test(regel)) viaVoorkeur++;
    });
  }
  assert.deepEqual(overtreders, []);
  assert.ok(viaVoorkeur >= 7, `verwacht minstens 7 sprongen via scrollGedrag(), gevonden ${viaVoorkeur}`);
});

test('CSS: uit zet scroll-behavior overal op auto, en <html> start in die stand', () => {
  const css = bron('styles/base.css', APP);
  assert.match(css, /:root\.geen-vloeiend-scrollen,\n:root\.geen-vloeiend-scrollen \* \{\n {2}scroll-behavior: auto !important;\n\}/);
  assert.match(bron('index.html', APP), /<html [^>]*class="geen-vloeiend-scrollen"/);
  // Nergens anders in de stylesheets wordt vloeiend scrollen aangezet.
  const stijlen = new URL('styles/', APP);
  for (const naam of readdirSync(stijlen)) {
    if (!naam.endsWith('.css')) continue;
    assert.doesNotMatch(bron(naam, stijlen), /scroll-behavior:\s*smooth/, naam);
  }
});

test('de voorkeur staat in Gedrag > Navigatie, met vertaling en uitleg in elke taal', () => {
  const tab = bron('solid/components/preferences/BehaviorTab.jsx');
  assert.match(tab, /p\.smoothScrolling\[1\]\(e\.target\.checked\)/);
  assert.match(tab, /t\('behavior\.smoothScrolling'\)/);
  assert.match(tab, /t\('behavior\.smoothScrollingHint'\)/);
  const locales = new URL('i18n/locales/', JS);
  const lees = (taal) => JSON.parse(readFileSync(new URL(`${taal}/preferences.json`, locales), 'utf8'));
  const en = lees('en').behavior;
  assert.equal(en.smoothScrolling, 'Smooth scrolling');
  assert.equal(lees('nl').behavior.smoothScrolling, 'Vloeiend scrollen');
  for (const taal of readdirSync(locales)) {
    const b = lees(taal).behavior;
    for (const sleutel of ['smoothScrolling', 'smoothScrollingHint']) {
      assert.ok(typeof b?.[sleutel] === 'string' && b[sleutel].trim(), `${taal}: ${sleutel} ontbreekt`);
      if (taal !== 'en') assert.notEqual(b[sleutel], en[sleutel], `${taal}: ${sleutel} is niet vertaald`);
    }
  }
});

test('Rust: de opdracht zet_vloeiend_scrollen is geregistreerd en werkt alleen op Linux iets bij', () => {
  const lib = bron('src-tauri/src/lib.rs', APP);
  assert.match(lib, /#\[tauri::command\]\nfn zet_vloeiend_scrollen\(app: tauri::AppHandle, aan: bool\) -> bool \{/);
  assert.match(lib, /generate_handler!\[[\s\S]*\n {12}zet_vloeiend_scrollen,\n/);
  assert.match(lib, /app\.webview_windows\(\)\.values\(\)/);
  assert.match(lib, /linux_runtime::zet_vloeiend_scrollen::<tauri::Wry>\(venster\.as_ref\(\), aan\);/);
  assert.match(lib, /pub\(crate\) fn get_preferences_file_path\(\) -> String/);
});
