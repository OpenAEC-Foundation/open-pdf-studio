// De NEN 1414-bibliotheek als eigen chunk (#454): laden, luisteraars en de
// symboolbeelden-cache van het systeemraster, die een NEN-symbool vóór het
// laden niet als ontbrekend onthoudt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nen1414Categorieen, laadNen1414, bijNen1414Geladen, _vergeetNen1414 } from './nen1414-laden.js';

const NEP = [{ id: 'nen1414-tb', name: 'NL NEN 1414 — Brand', symbols: [{ id: 'nen1414-Tb01', name: 'BMC', svg: '<svg><image href="data:image/png;base64,AA" /></svg>' }] }];
const nepLader = () => Promise.resolve({ NEN1414_CATEGORIES: NEP });

test('laadNen1414 laadt één keer, meldt het aan de luisteraars en houdt de categorieën vast', async () => {
  _vergeetNen1414();
  assert.equal(nen1414Categorieen(), null);
  let gemeld = null;
  const weg = bijNen1414Geladen((cats) => { gemeld = cats; });
  let geladen = 0;
  const lader = () => { geladen++; return nepLader(); };
  const [a, b] = await Promise.all([laadNen1414(lader), laadNen1414(lader)]);
  weg();
  assert.equal(geladen, 1);
  assert.equal(a, NEP);
  assert.equal(b, NEP);
  assert.equal(gemeld, NEP);
  assert.equal(nen1414Categorieen(), NEP);
  assert.equal(await laadNen1414(() => { throw new Error('niet opnieuw'); }), NEP);
});

test('een mislukte lading geeft [] en mag opnieuw', async () => {
  _vergeetNen1414();
  const oud = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(await laadNen1414(() => Promise.reject(new Error('weg'))), []);
  } finally {
    console.warn = oud;
  }
  assert.equal(nen1414Categorieen(), null);
  assert.equal(await laadNen1414(nepLader), NEP);
});

test('systeem-symbol-cache: een NEN-symbool vóór het laden is niet ontbrekend; erna wel te vinden', async () => {
  _vergeetNen1414();
  // Zonder echte bibliotheek (import.meta.glob werkt alleen in Vite) faalt de
  // lading die de cache zelf start; daarna komt de nepbibliotheek.
  const oud = console.warn;
  console.warn = () => {};
  const g = globalThis;
  const vorigImage = g.Image;
  const vorigRaf = g.requestAnimationFrame;
  const geladenBeelden = [];
  g.Image = class { constructor() { geladenBeelden.push(this); this.naturalWidth = 0; } };
  let hertekend = 0;
  g.requestAnimationFrame = (fn) => { fn(); return 1; };
  try {
    const cache = await import('../../annotations/rendering/systeem-symbol-cache.js');
    cache.registerSysteemSymbolRedraw(() => { hertekend++; });
    assert.equal(cache.findSysteemSymbol('nen1414-Tb01'), null);
    assert.equal(cache.getSysteemSymbolImage('nen1414-Tb01'), null);
    assert.equal(geladenBeelden.length, 0);
    // Wacht tot de mislukte eigen lading klaar is, dan de nepbibliotheek.
    for (let i = 0; i < 50 && (await laadNen1414(nepLader)) !== NEP; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(nen1414Categorieen(), NEP);
    assert.equal(hertekend, 1, 'hertekenen na het laden');
    assert.equal(cache.findSysteemSymbol('nen1414-Tb01')?.name, 'BMC');
    assert.equal(cache.getSysteemSymbolImage('nen1414-Tb01'), null, 'beeld laadt nu');
    assert.equal(geladenBeelden.length, 1);
    assert.equal(geladenBeelden[0].src, 'data:image/png;base64,AA');
    assert.deepEqual(cache.systeemSymbolList().map((s) => s.id), ['nen1414-Tb01']);
  } finally {
    console.warn = oud;
    g.Image = vorigImage;
    g.requestAnimationFrame = vorigRaf;
  }
});

test('alleen nen1414-laden.js importeert de bibliotheek, en dan dynamisch', () => {
  const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  for (const pad of ['../stores/symbolStore.js', '../../annotations/rendering/systeem-symbol-cache.js']) {
    assert.doesNotMatch(lees(pad), /from '[^']*nen1414Library\.js'/, pad);
  }
  assert.match(lees('./nen1414-laden.js'), /import\('\.\/nen1414Library\.js'\)/);
  const store = lees('../stores/symbolStore.js');
  assert.match(store, /\.\.\.nen1414Groepen\(\),/);
  assert.match(store, /laadNen1414Groepen\(\);\n\}/);
});
