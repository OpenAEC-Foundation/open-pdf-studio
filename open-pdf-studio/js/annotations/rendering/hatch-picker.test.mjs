// Hatch pickers (#279): swatches, names and translations.
//
// - Every engine pattern has a name (and every category a label) in every
//   locale, under the key the pattern picker actually looks up.
// - The renderer catalog and the PDF appearance catalog (saver) hold the same
//   line families, so a hatch looks the same before and after save/reopen.
// - The swatch is drawn by the same renderer as the annotation: same lines at
//   the same scale.
// - The Type picker (style types) uses that real swatch with the type's own
//   pattern/scale/colours, its keys exist in every locale, translated type
//   names resolve, and the line-only NEN 47 types differ from their coloured
//   twins.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

globalThis.window = globalThis.window || {};

// --- recording canvas ----------------------------------------------------
// No getTransform: the visible-area clamp is skipped, so the whole requested
// region is drawn — the same situation for swatch and annotation.
function maakRecorder() {
  const ops = { lijnen: [], stippen: [], vullingen: 0 };
  let cur = null;
  const ctx = {
    canvas: { width: 0, height: 0 },
    // The clip path (the area outline) is not hatch line work.
    clip() { ops.lijnen.length = 0; },
    save() {}, restore() {}, rect() {}, closePath() {},
    translate() {}, rotate() {}, scale() {}, setLineDash() {},
    fillRect() { ops.vullingen++; }, strokeRect() {},
    beginPath() {},
    moveTo(x, y) { cur = { x, y }; },
    lineTo(x, y) { if (cur) ops.lijnen.push([cur.x, cur.y, x, y]); cur = { x, y }; },
    quadraticCurveTo(_cx, _cy, x, y) { cur = { x, y }; },
    arc(x, y) { ops.stippen.push([x, y]); },
    fill() {}, stroke() {},
  };
  return { ctx, ops };
}

let laatsteSwatch = null;
globalThis.document = {
  createElement: () => {
    const rec = maakRecorder();
    laatsteSwatch = rec.ops;
    return {
      width: 0, height: 0,
      getContext: () => rec.ctx,
      toDataURL: () => 'data:image/png;base64,' + Math.random().toString(36).slice(2),
    };
  },
};

// The real sources, with the two app-wide imports (TypeScript state store)
// stubbed so the modules load outside the browser.
function laadModule(relPad, extra = (s) => s) {
  const url = new URL(relPad, import.meta.url);
  const bron = extra(readFileSync(url, 'utf8'))
    .replace(/^import \{ arcControlPoint \}.*$/m,
      'const arcControlPoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });')
    .replace(/^import \{ state \}.*$/m,
      'const state = { preferences: {}, documents: [], activeDocumentIndex: 0 };')
    .replace(/^import \{ state as _appState \}.*$/m,
      'const _appState = globalThis.__stijlState;')
    .replace(/from '(\.[^']*)'/g, (_m, spec) => `from '${new URL(spec, url).href}'`);
  return import('data:text/javascript;base64,' + Buffer.from(bron, 'utf8').toString('base64'));
}

globalThis.__stijlState = { preferences: {} };
const H = await laadModule('./hatch-patterns.js');
const S = await laadModule('../style-types.js');
const { HATCH_LINE_FAMILIES } = await import(new URL('../../pdf/saver/hatch-catalog.js', import.meta.url).href);

const LOCALES_DIR = new URL('../../i18n/locales/', import.meta.url);
const LOCALES = readdirSync(LOCALES_DIR).sort();
const props = Object.fromEntries(LOCALES.map((l) => [
  l, JSON.parse(readFileSync(new URL(`${l}/properties.json`, LOCALES_DIR), 'utf8')),
]));
const pad = (obj, sleutel) => sleutel.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

const PATROON_IDS = H.BUILTIN_HATCH_PATTERNS.map((p) => p.id);

test('every pattern id is unique and has a known category', () => {
  assert.equal(new Set(PATROON_IDS).size, PATROON_IDS.length);
  for (const p of H.BUILTIN_HATCH_PATTERNS) assert.ok(H.HATCH_CATEGORIES.includes(p.category), p.id);
});

test('every pattern and category has a name in every locale', () => {
  assert.ok(LOCALES.length >= 39, `only ${LOCALES.length} locales`);
  for (const l of LOCALES) {
    const namen = pad(props[l], 'appearance.hatchPatterns') || {};
    const ontbreekt = PATROON_IDS.filter((id) => typeof namen[id] !== 'string' || !namen[id].trim());
    assert.deepEqual(ontbreekt, [], `${l}: pattern names missing`);
    const onbekend = Object.keys(namen).filter((k) => !PATROON_IDS.includes(k));
    assert.deepEqual(onbekend, [], `${l}: names for unknown patterns`);
    for (const cat of H.HATCH_CATEGORIES) {
      assert.ok(pad(props[l], `appearance.hatchCategories.${cat}`), `${l}: category ${cat}`);
    }
  }
});

test('pattern names are translated, not English copies', () => {
  // Proper nouns / international words may coincide with English; a locale
  // that copied the whole list would not.
  const en = pad(props.en, 'appearance.hatchPatterns');
  for (const l of LOCALES.filter((x) => x !== 'en')) {
    const namen = pad(props[l], 'appearance.hatchPatterns');
    const gelijk = PATROON_IDS.filter((id) => namen[id] === en[id]);
    assert.ok(gelijk.length <= 6, `${l}: ${gelijk.length} names identical to English (${gelijk.join(', ')})`);
  }
});

test('the pattern picker looks names up under appearance.*', () => {
  const bron = readFileSync(new URL('../../solid/components/properties-panel/HatchPatternSection.jsx', import.meta.url), 'utf8');
  assert.match(bron, /`appearance\.hatchPatterns\.\$\{id\}`/);
  assert.match(bron, /`appearance\.hatchCategories\.\$\{cat\}`/);
});

test('renderer and PDF appearance catalog hold the same line families', () => {
  const norm = (fams) => JSON.stringify(fams.map((f) => ({
    angle: f.angle, originX: f.originX || 0, originY: f.originY || 0, deltaX: f.deltaX || 0,
    deltaY: f.deltaY, dashPattern: f.dashPattern || null, strokeWidth: f.strokeWidth ?? null,
  })));
  for (const p of H.BUILTIN_HATCH_PATTERNS) {
    assert.ok(HATCH_LINE_FAMILIES[p.id], `${p.id} missing from saver catalog`);
    assert.equal(norm(HATCH_LINE_FAMILIES[p.id]), norm(p.lineFamilies), p.id);
  }
  assert.deepEqual(Object.keys(HATCH_LINE_FAMILIES).sort(), [...PATROON_IDS].sort());
});

// Lines (as infinite carriers: direction + perpendicular offset) and dots that
// fall inside a window. Dashes are ignored — only where the lines lie.
function dragers(ops, w, h) {
  const r = (v) => Math.round(v * 1000) / 1000;
  const lijnen = new Set();
  for (const [x1, y1, x2, y2] of ops.lijnen) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1e-9) continue;
    let dx = (x2 - x1) / len, dy = (y2 - y1) / len;
    if (dx < -1e-9 || (Math.abs(dx) < 1e-9 && dy < 0)) { dx = -dx; dy = -dy; }
    // Does the carrier cross the window? Signed distance of the corners.
    const d = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => (x - x1) * -dy + (y - y1) * dx);
    if (Math.min(...d) > -1e-3 || Math.max(...d) < 1e-3) continue;
    const off = x1 * -dy + y1 * dx;
    lijnen.add(`${r(dx)},${r(dy)},${r(off)}`);
  }
  const stippen = new Set(ops.stippen
    // Strictly inside (with a margin): a dot exactly on the edge may round
    // either way between two otherwise identical computations.
    .filter(([x, y]) => x > 1e-3 && x < w - 1e-3 && y > 1e-3 && y < h - 1e-3)
    .map(([x, y]) => `${r(x)},${r(y)}`));
  return { lijnen, stippen };
}

test('swatch draws the same lines as the annotation renderer', () => {
  const W = 64, Hh = 24;
  for (const p of H.BUILTIN_HATCH_PATTERNS) {
    for (const scale of [0.28, 1, 2.13]) {
      laatsteSwatch = null;
      const url = H.getHatchSwatchDataUrl(p.id, '#123456', W, '#ffffff',
        { width: W, height: Hh, scale, border: false });
      assert.ok(url.startsWith('data:'), p.id);
      const swatch = dragers(laatsteSwatch, W, Hh);

      // The same window as a filled area, centred identically (the pattern's
      // phase anchor is the centre of the area).
      const { ctx, ops } = maakRecorder();
      const punten = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: Hh }, { x: 0, y: Hh }];
      H.applyHatchFillPolygon(ctx, punten, null, p.id, '#123456', scale * 100, 0);
      const vlak = dragers(ops, W, Hh);

      if (p.lineFamilies.length === 0) {
        assert.ok(laatsteSwatch.vullingen > 0 && ops.vullingen > 0, `${p.id}: solid fill`);
        continue;
      }
      assert.deepEqual([...swatch.lijnen].sort(), [...vlak.lijnen].sort(), `${p.id} @${scale}: lines`);
      assert.deepEqual([...swatch.stippen].sort(), [...vlak.stippen].sort(), `${p.id} @${scale}: dots`);
    }
  }
});

// ---- Type picker (style types) ------------------------------------------

const TYPEN = S.STYLE_TYPES.filledArea;

test('every filled-area type uses a pattern the renderer and saver know', () => {
  for (const t of TYPEN) {
    const pat = t.props.hatchPattern;
    assert.ok(H.getHatchPattern(pat), `${t.id}: unknown pattern ${pat}`);
    assert.ok(HATCH_LINE_FAMILIES[pat], `${t.id}: ${pat} not in saver catalog`);
  }
  assert.equal(new Set(TYPEN.map((t) => t.id)).size, TYPEN.length, 'duplicate type ids');
});

test('type swatch parameters are exactly what applying the type sets', () => {
  for (const t of TYPEN) {
    const sp = H.styleTypeSwatchParams(t);
    assert.equal(sp.pattern, t.props.hatchPattern, t.id);
    assert.equal(sp.line, t.props.hatchColor, t.id);
    assert.equal(sp.scale, t.props.hatchScale / 100, t.id);
    assert.equal(sp.fill, t.props.fillColor || null, t.id);
    assert.equal(sp.angle, t.props.hatchAngle || 0, t.id);
  }
  const sp = H.styleTypeSwatchParams({ props: { hatchPattern: 'grid', hatchColor: '#ff0000', hatchScale: 50, hatchAngle: 30, fillColor: null } });
  assert.deepEqual(sp, { pattern: 'grid', line: '#ff0000', fill: null, tint: '#ff0000', scale: 0.5, angle: 30 });
});

test('the Type picker renders swatches with the real hatch renderer', () => {
  const bron = readFileSync(new URL('../../solid/components/properties-panel/DimensionTypeSection.jsx', import.meta.url), 'utf8');
  assert.match(bron, /getHatchSwatchDataUrl\(/);
  assert.match(bron, /styleTypeSwatchParams\(/);
  assert.doesNotMatch(bron, /_hatchFamily/, 'hand-drawn approximation still present');
});

test('every translation key used by the hatch pickers exists in every locale', () => {
  const bestanden = [
    '../../solid/components/properties-panel/DimensionTypeSection.jsx',
    '../../solid/components/properties-panel/HatchPatternSection.jsx',
  ];
  const sleutels = new Set();
  for (const b of bestanden) {
    const bron = readFileSync(new URL(b, import.meta.url), 'utf8');
    for (const m of bron.matchAll(/\bt\('([a-zA-Z0-9_.]+)'\)/g)) sleutels.add(m[1]);
  }
  for (const k of ['measurement.searchType', 'measurement.editTypes', 'measurement.noTypesFound']) {
    assert.ok(sleutels.has(k), `picker no longer uses ${k}?`);
  }
  for (const l of LOCALES) {
    const ontbreekt = [...sleutels].filter((k) => typeof pad(props[l], k) !== 'string');
    assert.deepEqual(ontbreekt, [], `${l}: missing picker keys`);
  }
});

test('translated type names exist in every locale and resolve', () => {
  const metSleutel = TYPEN.filter((t) => t.labelKey);
  assert.equal(metSleutel.length, 5 + S.TRANSLATED_INB_HATCH_IDS.size);
  for (const id of S.TRANSLATED_INB_HATCH_IDS) assert.ok(TYPEN.find((t) => t.id === id && t.labelKey), id);
  for (const l of LOCALES) {
    for (const t of metSleutel) {
      const v = pad(props[l], t.labelKey);
      assert.ok(typeof v === 'string' && v.trim(), `${l}: ${t.labelKey}`);
    }
    const namen = Object.keys(pad(props[l], 'styleTypeNames.filledArea'));
    assert.deepEqual(namen.sort(), metSleutel.map((t) => t.id).sort(), `${l}: stray type names`);
  }
  // Dutch keys match the built-in Dutch labels.
  for (const t of metSleutel) assert.equal(pad(props.nl, t.labelKey), t.label, t.id);
});

test('styleTypeLabel: translation, missing-key fallback, user rename', () => {
  const entry = TYPEN.find((t) => t.id === 'inb-diagonaal-smal');
  const tDe = (k) => pad(props.de, k) ?? k;
  assert.equal(S.styleTypeLabel(entry, tDe), 'Diagonal eng');
  // i18next returns the key itself when it is missing → Dutch label.
  assert.equal(S.styleTypeLabel(entry, (k) => k), entry.label);
  // Untranslated (NEN 47) entries keep their label.
  const nen = TYPEN.find((t) => t.id === 'inb-nen47-12-naaldhout');
  assert.equal(nen.labelKey, undefined);
  assert.equal(S.styleTypeLabel(nen, tDe), nen.label);
  // A rename in the type editor wins over the translation.
  globalThis.__stijlState.preferences = { customStyleTypes: { filledArea: { 'inb-diagonaal-smal': { label: 'Mijn arcering' } } } };
  try {
    const merged = S.styleTypesFor('filledArea').find((t) => t.id === 'inb-diagonaal-smal');
    assert.equal(S.styleTypeLabel(merged, tDe), 'Mijn arcering');
  } finally {
    globalThis.__stijlState.preferences = {};
  }
});

test('line-only NEN 47 types differ from their coloured twins', () => {
  const sig = (t) => JSON.stringify(t.props);
  for (const t of TYPEN.filter((x) => /^inb-nen47-\d\d-.*gekleurd$/.test(x.id))) {
    const nr = t.id.slice(0, 'inb-nen47-00'.length);
    const tweeling = TYPEN.find((x) => x.id.startsWith(nr + '-') && !x.id.endsWith('gekleurd'));
    assert.ok(tweeling, `${t.id}: no line-only twin`);
    assert.notEqual(sig(tweeling), sig(t), `${t.id} duplicates ${tweeling.id}`);
    assert.equal(tweeling.props.fillColor, null, `${tweeling.id} should be line work only`);
    assert.ok(t.props.fillColor, `${t.id} should carry a background colour`);
  }
});
