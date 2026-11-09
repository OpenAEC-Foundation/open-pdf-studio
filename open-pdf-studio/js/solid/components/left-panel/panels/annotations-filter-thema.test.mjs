// Filterbalk van het opmerkingenoverzicht in donkere thema's (#1002).
//
// De keuzelijsten hadden `var(--theme-input-bg, #ffffff)` als achtergrond.
// Die variabele bestaat in geen enkel thema, dus werd het vlak wit met de
// lichte tekstkleur van het donkere thema: de opties waren onleesbaar.
// Alle kleuren van de filterbalk moeten uit themavariabelen komen die elk
// thema ook echt definieert.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
const css = lees('../../../../../styles/panels.css').replace(/\/\*[\s\S]*?\*\//g, '');
const themas = lees('../../../../../styles/themes.css');
const paneel = lees('./AnnotationsPanel.jsx');

const regels = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ kiezer: m[1].trim(), romp: m[2] }))
  .filter((r) => r.kiezer.includes('annotations-filter'));

// Themablokken: [data-theme="..."] { ... } (plus :root als standaard).
const themaBlokken = [...themas.matchAll(/((?::root,\s*)?\[data-theme="([\w-]+)"\])\s*\{([^}]*)\}/g)]
  .map((m) => ({ naam: m[2], romp: m[3] }));

const KLEUR_EIGENSCHAPPEN = /^(color|background|background-color|border|border-color|outline)$/;

test('de filterbalk heeft regels voor balk, velden, opties en knop', () => {
  const kiezers = regels.map((r) => r.kiezer).join('\n');
  assert.match(kiezers, /\.annotations-filter-bar select/);
  assert.match(kiezers, /\.annotations-filter-bar option/);
  assert.match(kiezers, /\.annotations-filter-clear/);
});

test('geen vaste (lichte) kleuren in de filterbalk, alleen themavariabelen', () => {
  for (const { kiezer, romp } of regels) {
    for (const decl of romp.split(';')) {
      const [eig, ...rest] = decl.split(':');
      const naam = eig?.trim();
      const waarde = rest.join(':').trim();
      if (!naam || !KLEUR_EIGENSCHAPPEN.test(naam)) continue;
      // Vaste kleuren, ook als terugval in var(): #fff, rgb(), 'white'.
      assert.doesNotMatch(waarde, /#[0-9a-f]{3,8}\b|rgba?\(|\bwhite\b/i, `${kiezer} { ${naam}: ${waarde} }`);
      if (naam === 'color' || /^background/.test(naam)) {
        assert.match(waarde, /var\(--theme-/, `${kiezer} { ${naam} } gebruikt een themavariabele`);
      }
    }
  }
});

test('elke gebruikte themavariabele bestaat in elk thema (behalve een optionele met terugval)', () => {
  const gebruikt = new Set();
  for (const { romp } of regels) {
    for (const m of romp.matchAll(/var\((--theme-[\w-]+)(\s*,)?/g)) {
      if (!m[2]) gebruikt.add(m[1]); // zonder terugval: moet overal bestaan
    }
  }
  assert.ok(themaBlokken.length >= 7, 'alle themablokken gevonden');
  for (const v of gebruikt) {
    for (const thema of themaBlokken) {
      assert.match(thema.romp, new RegExp(`${v}\\s*:`), `${v} in thema ${thema.naam}`);
    }
  }
  // De optionele invoervariabele valt terug op een bestaande themavariabele.
  assert.ok(regels.some((r) => /var\(--theme-input-bg,\s*var\(--theme-surface\)\)/.test(r.romp)));
});

test('donkere thema\'s krijgen een donkere systeemkeuzelijst en datumkiezer', () => {
  assert.ok(regels.some((r) => /\[data-theme\]:not\(\[data-theme="light"\]\)\s+\.annotations-filter-bar/.test(r.kiezer)
    && /color-scheme:\s*dark/.test(r.romp)));
});

test('de gekozen auteur en soort blijven gekozen na een lijstverversing', () => {
  assert.match(paneel, /<option value=\{a\} selected=\{a === listFilter\(\)\.auteur\}>/);
  assert.match(paneel, /<option value=\{o\.type\} selected=\{o\.type === listFilter\(\)\.type\}>/);
  const store = lees('../../../stores/panels/annotationsStore.js');
  assert.match(store, /createSignal\(\{ authors: \[\], types: \[\] \}, \{\s*equals:/);
});
