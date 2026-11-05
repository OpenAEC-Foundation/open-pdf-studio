// Palettecategorie GD&T en bewerking (#971): unieke id's, elk teken heeft
// geometrie, de stempels zijn zelfstandige SVG's en het kenmerkkader is een
// werkend parametrisch symbool met bewerkbare cellen.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GDT_CATEGORIES } from './gdtSymbolLibrary.js';
import { NL_CATEGORIES } from './nlSymbolLibrary.js';
import { ifcCategoryForSymbol } from './ifcCategoryMap.js';
import { getTemplate, defaultParams } from '../../symbols/registry.js';
import {
  GDT_KENMERKEN, GDT_AANVULLEND, BEWERKING_SYMBOLEN, kaderIndeling, gdtSvg,
} from '../../symbols/templates/gdt.js';

const cat = GDT_CATEGORIES[0];
const VORM = /<(path|circle|line|rect|polyline|polygon|text)\b/;

test('één ingebouwde categorie met alle gevraagde tekens', () => {
  assert.equal(GDT_CATEGORIES.length, 1);
  assert.equal(cat.id, 'gdt-bewerking');
  assert.equal(cat.builtin, true);
  // Internationaal: zonder sector/land altijd zichtbaar.
  assert.equal(cat.industry, undefined);
  assert.equal(cat.country, undefined);
  const ids = cat.symbols.map((s) => s.id);
  for (const id of [
    'rechtheid', 'vlakheid', 'rondheid', 'cilindriciteit', 'lijnprofiel', 'vlakprofiel',
    'haaksheid', 'hoekigheid', 'evenwijdigheid', 'positie', 'concentriciteit', 'symmetrie',
    'slag', 'totale-slag', 'referentie', 'oppervlak', 'oppervlak-verspanen',
    'oppervlak-niet-verspanen', 'verzinking', 'verzinkboring', 'diepte', 'diameter',
    'vierkant', 'bol-diameter', 'rondom',
  ]) assert.ok(ids.includes(`gdt-${id}`), id);
  assert.ok(ids.includes('param-gdt-kenmerkkader'));
});

test('id\'s zijn uniek, ook over alle ingebouwde categorieën heen', () => {
  const ids = cat.symbols.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  const alle = [...NL_CATEGORIES, ...GDT_CATEGORIES].flatMap((c) => c.symbols.map((s) => s.id));
  assert.equal(new Set(alle).size, alle.length);
  const catIds = [...NL_CATEGORIES, ...GDT_CATEGORIES].map((c) => c.id);
  assert.equal(new Set(catIds).size, catIds.length);
});

test('elk teken heeft geometrie en een zelfstandige 64×64-SVG', () => {
  for (const s of [...GDT_KENMERKEN, ...GDT_AANVULLEND, ...BEWERKING_SYMBOLEN]) {
    assert.ok(Array.isArray(s.geo) && s.geo.length > 0, s.id);
    for (const p of s.geo) {
      assert.ok(['L', 'C', 'P', 'A', 'T'].includes(p[0]), `${s.id}: ${p[0]}`);
      const getallen = p.flat(2).filter((v) => typeof v === 'number');
      assert.ok(getallen.every(Number.isFinite), s.id);
    }
    assert.ok(s.name && s.nameEn, s.id);
  }
  for (const s of cat.symbols) {
    assert.ok(s.name, s.id);
    assert.match(s.svg, /^<svg viewBox="0 0 64 64" xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, s.id);
    assert.match(s.svg, VORM, `${s.id}: geen vorm`);
    assert.ok(s.svg.endsWith('</svg>'), s.id);
    assert.ok(!/NaN|undefined/.test(s.svg), s.id);
  }
  const svgs = cat.symbols.map((s) => s.svg);
  assert.equal(new Set(svgs).size, svgs.length, 'geen twee tekens met dezelfde tekening');
  // Coördinaten blijven binnen het raster.
  for (const s of cat.symbols) {
    for (const m of s.svg.matchAll(/[MLAHVZ ](-?\d+(?:\.\d+)?)/g)) {
      const v = Number(m[1]);
      assert.ok(v >= 0 && v <= 64, `${s.id}: ${v}`);
    }
  }
});

test('de boog van het lijnprofiel loopt over de bovenkant', () => {
  const svg = gdtSvg(GDT_KENMERKEN.find((k) => k.id === 'lijnprofiel').geo);
  assert.match(svg, /M12 44A20 20 0 0 1 52 44/);
});

test('GD&T-tekens zijn annotaties, geen bouwelementen', () => {
  for (const s of cat.symbols) assert.equal(ifcCategoryForSymbol(s), 'IfcAnnotation', s.id);
});

test('kenmerkkader: geregistreerd template met bewerkbare velden', () => {
  const tpl = getTemplate('gdt-kenmerkkader');
  assert.ok(tpl);
  const keys = tpl.params.map((p) => p.key);
  assert.deepEqual(keys, ['kenmerk', 'diameter', 'tolerantie', 'materiaal', 'referentie1', 'referentie2', 'referentie3']);
  const kenmerk = tpl.params.find((p) => p.key === 'kenmerk');
  assert.deepEqual(kenmerk.options.map((o) => o.value), GDT_KENMERKEN.map((k) => k.id));

  const p = defaultParams(tpl);
  const cmds = tpl.render(p, { x: 0, y: 0, width: 248, height: 40 });
  const teksten = cmds.filter((c) => c.kind === 'text').map((c) => c.text);
  assert.deepEqual(teksten, ['0.1', 'A', 'B', 'C']);
  assert.ok(cmds.some((c) => c.role === 'diameter'));
  assert.ok(cmds.some((c) => c.role === 'kenmerk'));
  for (const c of cmds) {
    const v = [c.x, c.y, c.x1, c.y1, c.x2, c.y2, c.cx, c.cy, ...(c.points || []).flatMap((q) => [q.x, q.y])]
      .filter((n) => n !== undefined);
    assert.ok(v.every(Number.isFinite), JSON.stringify(c));
    // Alles binnen het vak (de cellen schalen mee).
    assert.ok(v.every((n) => n >= -0.01 && n <= 248.01), JSON.stringify(c));
  }
});

test('kenmerkkader: breedte volgt de inhoud, lege referenties vallen weg', () => {
  const tpl = getTemplate('gdt-kenmerkkader');
  const basis = defaultParams(tpl);
  const w = (p) => tpl.breedteBijHoogte({ ...basis, ...p }, 40);
  assert.ok(Math.abs(w({}) - 40 * kaderIndeling(basis).breedte) < 1e-9);
  assert.ok(w({ tolerantie: '0.025' }) > w({}), 'langere tolerantie, breder kader');
  assert.ok(w({ referentie2: '', referentie3: '' }) < w({}), 'minder referenties, smaller kader');
  assert.equal(kaderIndeling({ ...basis, referentie1: '', referentie2: '', referentie3: '' }).cellen.length, 2);

  const mmc = tpl.render({ ...basis, materiaal: 'M' }, { x: 0, y: 0, width: 400, height: 40 });
  assert.ok(mmc.some((c) => c.role === 'materiaal' && c.text === 'M'));
  const zonder = tpl.render({ ...basis, diameter: false }, { x: 0, y: 0, width: 400, height: 40 });
  assert.ok(!zonder.some((c) => c.role === 'diameter'));
});

test('kenmerkkader: elk kenmerk tekent zijn eigen teken', () => {
  const tpl = getTemplate('gdt-kenmerkkader');
  const tekens = GDT_KENMERKEN.map((k) => JSON.stringify(
    tpl.render({ ...defaultParams(tpl), kenmerk: k.id }, { x: 0, y: 0, width: 248, height: 40 })
      .filter((c) => c.role === 'kenmerk'),
  ));
  assert.equal(new Set(tekens).size, GDT_KENMERKEN.length);
});
