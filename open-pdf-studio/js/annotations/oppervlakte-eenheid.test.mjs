// Acres en hectares als oppervlakte-eenheid (GitHub #1129): de pure regels
// (herkennen, omrekenen, weigeren) en de bedrading in MCP. mcp-bridge.js en
// het schema in mcp_server.rs, mcp-stdio/tools.json en de Python-tools worden
// uit de bron gelezen (in node niet te laden).

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  OPPERVLAKTE_KEUZES, SCHAAL_EENHEDEN, SCHAALGEBIED_EENHEDEN,
  oppervlakteEenheid, vlakWeergave, vlakUitkomst, vlakOmrekenbaar,
  decimalenAlleenOppervlakte, isAlleenOppervlakte,
  leesVlakEenheid, vlakEenheidUitProps, vlakEenheidFout, lengteEenheidFout, leesSchaalEenheid,
} from './oppervlakte-eenheid.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const bijna = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

test('acre and hectare are recognised in the forms people type', () => {
  for (const u of ['ac', 'AC', 'acre', 'Acres', ' ac ']) assert.equal(oppervlakteEenheid(u), 'ac', u);
  for (const u of ['ha', 'hectare', 'Hectares']) assert.equal(oppervlakteEenheid(u), 'ha', u);
  assert.equal(oppervlakteEenheid('m2'), 'm²');
  assert.equal(oppervlakteEenheid('sq ft'), 'ft²');
  assert.equal(oppervlakteEenheid('yd²'), 'yd²');
  // A length unit is not an area unit, unless the caller asks for its square.
  assert.equal(oppervlakteEenheid('ft'), null);
  assert.equal(oppervlakteEenheid('ft', { lengteAlsKwadraat: true }), 'ft²');
  for (const u of ['', null, undefined, 'px', 'px²', 'furlong', 'kg', 5]) assert.equal(oppervlakteEenheid(u), null, String(u));
  assert.equal(isAlleenOppervlakte('ac'), true);
  assert.equal(isAlleenOppervlakte('hectare'), true);
  assert.equal(isAlleenOppervlakte('m²'), false);
  assert.equal(isAlleenOppervlakte('ft'), false);
  assert.deepEqual([...OPPERVLAKTE_KEUZES], ['m²', 'ha', 'ft²', 'ac']);
});

test('an area on a sheet in feet is shown in acres: 1 ac = 43,560 ft² exactly', () => {
  assert.deepEqual(vlakWeergave({ value: 43_560, unit: 'ft²' }, 'ac'), { value: 1, unit: 'ac' });
  assert.deepEqual(vlakWeergave({ value: 100_188, unit: 'ft²' }, 'ac'), { value: 2.3, unit: 'ac' });
  // 1 ac = 4046.8564224 m², also from a sheet in metres or millimetres.
  assert.ok(bijna(vlakWeergave({ value: 4046.8564224, unit: 'm²' }, 'ac').value, 1));
  assert.ok(bijna(vlakWeergave({ value: 4046.8564224e6, unit: 'mm²' }, 'ac').value, 1));
  // Other fields of the measurement (pixels) are kept.
  assert.deepEqual(vlakWeergave({ value: 87_120, unit: 'ft²', pixels: 12 }, 'acres'), { value: 2, unit: 'ac', pixels: 12 });
});

test('an area on a sheet in metres is shown in hectares: 1 ha = 10,000 m²', () => {
  assert.deepEqual(vlakWeergave({ value: 25_000, unit: 'm²' }, 'ha'), { value: 2.5, unit: 'ha' });
  assert.deepEqual(vlakWeergave({ value: 1e10, unit: 'mm²' }, 'ha'), { value: 1, unit: 'ha' });
  assert.ok(bijna(vlakWeergave({ value: 1, unit: 'ac' }, 'ha').value, 0.40468564224));
  assert.ok(bijna(vlakWeergave({ value: 107_639.1041670972, unit: 'ft²' }, 'ha').value, 1, 1e-9));
});

test('without a display unit, or without a real-world scale, the measurement stays as it is', () => {
  const m = { value: 12, unit: 'ft²' };
  assert.equal(vlakWeergave(m, undefined), m);
  assert.equal(vlakWeergave(m, ''), m);
  assert.equal(vlakWeergave(m, 'ft'), m, 'a length unit is not a display unit');
  const px = { value: 500, unit: 'px²' };
  assert.equal(vlakWeergave(px, 'ac'), px, 'pixels have no fixed size');
  assert.equal(vlakOmrekenbaar('px²', 'ac'), false);
  assert.equal(vlakOmrekenbaar('pt²', 'ha'), false);
  assert.equal(vlakOmrekenbaar('ft²', 'ac'), true);
  assert.equal(vlakOmrekenbaar('mm²', 'ha'), true);
  assert.equal(vlakWeergave(null, 'ac'), null);
});

test('the area of a measureArea as a number, in the unit the sheet shows', () => {
  assert.deepEqual(vlakUitkomst({ measureValue: 87_120, measureUnit: 'ft²', measureAreaUnit: 'ac' }), { value: 2, unit: 'ac' });
  assert.deepEqual(vlakUitkomst({ measureValue: 45, measureUnit: 'ft²' }), { value: 45, unit: 'ft²' });
  // Without a choice mm² is shown as m², as the label does.
  assert.deepEqual(vlakUitkomst({ measureValue: 20_000_000, measureUnit: 'mm²' }), { value: 20, unit: 'm²' });
  assert.deepEqual(vlakUitkomst({ measureValue: 3e10, measureUnit: 'mm²', measureAreaUnit: 'ha' }), { value: 3, unit: 'ha' });
  assert.deepEqual(vlakUitkomst({ measureValue: 10 }), { value: 10, unit: null });
  assert.equal(vlakUitkomst({ measureUnit: 'ft²' }), null);
  assert.equal(vlakUitkomst(null), null);
});

test('acres and hectares get enough decimals for a lot', () => {
  assert.equal(decimalenAlleenOppervlakte(0.253), 3);
  assert.equal(decimalenAlleenOppervlakte(9.999), 3);
  assert.equal(decimalenAlleenOppervlakte(12.47), 2);
});

// ── MCP: invoer ─────────────────────────────────────────────────────────────

test('MCP: the area unit of a measureArea is read, and an unsupported one is refused', () => {
  assert.deepEqual(leesVlakEenheid('ac'), { ok: true, unit: 'ac' });
  assert.deepEqual(leesVlakEenheid('ha'), { ok: true, unit: 'ha' });
  assert.deepEqual(leesVlakEenheid('hectares'), { ok: true, unit: 'ha' });
  assert.deepEqual(leesVlakEenheid('m2'), { ok: true, unit: 'm²' });
  assert.deepEqual(leesVlakEenheid('ft'), { ok: true, unit: 'ft²' }, 'a length unit means its square');
  for (const auto of [null, undefined, '', 'auto', 'Default']) {
    assert.deepEqual(leesVlakEenheid(auto), { ok: true, unit: null }, String(auto));
  }
  for (const fout of ['furlong', 'px', 'kg', 'm³']) {
    const r = leesVlakEenheid(fout);
    assert.equal(r.ok, false, fout);
    assert.match(r.error, /unsupported area unit/);
    assert.ok(r.error.includes(`'${fout}'`), 'the error names the unit');
    assert.match(r.error, /ac, ha/);
  }
  assert.equal(leesVlakEenheid(5).ok, false);
});

test('MCP: `units` and `measureAreaUnit` are the same setting; no key means no change', () => {
  assert.deepEqual(vlakEenheidUitProps({ units: 'ac' }), { ok: true, heeft: true, unit: 'ac' });
  assert.deepEqual(vlakEenheidUitProps({ measureAreaUnit: 'ha' }), { ok: true, heeft: true, unit: 'ha' });
  assert.deepEqual(vlakEenheidUitProps({ measureAreaUnit: 'ha', units: 'ac' }), { ok: true, heeft: true, unit: 'ha' });
  assert.deepEqual(vlakEenheidUitProps({ units: 'auto' }), { ok: true, heeft: true, unit: null });
  assert.deepEqual(vlakEenheidUitProps({ points: [] }), { ok: true, heeft: false, unit: null });
  assert.deepEqual(vlakEenheidUitProps(null), { ok: true, heeft: false, unit: null });
  assert.equal(vlakEenheidUitProps({ units: 'parsec' }).ok, false);
});

test('MCP: acres on a sheet without a real-world scale is an error, not a silent fallback', () => {
  assert.equal(vlakEenheidFout('ft²', 'ac'), null);
  assert.equal(vlakEenheidFout('mm²', 'ha'), null);
  assert.equal(vlakEenheidFout('px²', null), null, 'no unit asked');
  const fout = vlakEenheidFout('px²', 'ac');
  assert.match(fout, /cannot report this area in 'ac'/);
  assert.match(fout, /app_set_measure_scale/);
});

test('MCP: a length or perimeter follows the scale; another unit is refused with a reason', () => {
  assert.equal(lengteEenheidFout(undefined, 'ft', 'measureDistance'), null);
  assert.equal(lengteEenheidFout('ft', 'ft', 'measureDistance'), null);
  assert.equal(lengteEenheidFout("'", 'ft', 'measureDistance'), null);
  assert.match(lengteEenheidFout('ac', 'ft', 'measurePerimeter'), /is an area unit and measurePerimeter measures a length/);
  assert.match(lengteEenheidFout('m', 'ft', 'measureDistance'), /not supported for measureDistance.*'ft'/);
  assert.match(lengteEenheidFout(3, 'ft', 'measureDistance'), /must be a string/);
});

test('MCP: a scale needs a length unit; ac and ha are refused there', () => {
  for (const u of SCHAAL_EENHEDEN) assert.deepEqual(leesSchaalEenheid(u), { ok: true, unit: u });
  assert.deepEqual(leesSchaalEenheid('"'), { ok: true, unit: 'in' });
  for (const u of ['ac', 'ha', 'm²']) {
    const r = leesSchaalEenheid(u);
    assert.equal(r.ok, false, u);
    assert.match(r.error, /is an area unit; a scale needs a length unit/);
  }
  assert.match(leesSchaalEenheid('furlong').error, /unsupported unit 'furlong'/);
  assert.equal(leesSchaalEenheid('').ok, false);
  assert.equal(leesSchaalEenheid(undefined).ok, false);
  // A scale region counts in mm, cm, m, in or ft only.
  assert.deepEqual(leesSchaalEenheid('ft', SCHAALGEBIED_EENHEDEN), { ok: true, unit: 'ft' });
  assert.equal(leesSchaalEenheid('px', SCHAALGEBIED_EENHEDEN).ok, false);
  assert.equal(leesSchaalEenheid('ac', SCHAALGEBIED_EENHEDEN).ok, false);
});

// ── MCP: bedrading en schema ────────────────────────────────────────────────

test('the bridge uses the unit on create and update, and refuses instead of falling back', () => {
  const brug = bron('../mcp-bridge.js');
  // Create: units → measureAreaUnit, checked against the scale before the annotation is added.
  assert.match(brug, /vlakEenheid = eenheden\.vlakEenheidUitProps\(props\);\s*\n\s*if \(!vlakEenheid\.ok\) return \{ ok: false, error: vlakEenheid\.error \};/);
  assert.match(brug, /if \(eenheidFout\) return \{ ok: false, error: eenheidFout \};[\s\S]*?doc\.annotations\.push\(ann\);/);
  assert.match(brug, /eenheden\.lengteEenheidFout\(props\.units, ann\.measureUnit, type\)/);
  // Update: checked before anything changes on the annotation.
  const update = brug.slice(brug.indexOf('async function handleUpdateAnnotation'));
  assert.ok(update.indexOf('eenheden.vlakEenheidFout(meas.vlakMeting(ann).unit, vlakEenheid.unit)') > 0);
  assert.ok(update.indexOf('eenheden.vlakEenheidFout(') < update.indexOf('Object.assign(ann, patch);'), 'validated before the patch is applied');
  assert.match(update, /if \(isMeasure && \(geometryTouched \|\| vlakEenheid\)\)/);
  // The label is written in the display unit; the result carries the number.
  assert.match(brug, /ann\.measureText = meas\.vlakTekst\(ann, a\);/);
  assert.match(brug, /if \(area\) s\.area = area;/);
  // The scale and the take-off.
  assert.match(brug, /const gelezen = eenheden\.leesSchaalEenheid\(params\?\.unit\);/);
  assert.match(brug, /eenheden\.leesVlakEenheid\(params\.areaUnit\)/);
  assert.match(brug, /configMetOppervlakteEenheid\(s\.config, areaUnit\)/);
});

test('the tool descriptions and schemas name ac and ha in every place', () => {
  const rust = bron('../../src-tauri/src/mcp_server.rs');
  const tools = JSON.parse(bron('../../../mcp-stdio/tools.json'));
  const python = bron('../../../python/src/open_pdf_studio/_tools.py');
  const tool = (naam) => tools.find((t) => t.name === naam);

  const maak = tool('app_create_annotation').description;
  assert.match(maak, /measureArea: `units` \(or `measureAreaUnit`\) sets the unit its area is reported in: ac \(acres, 1 ac = 43,560 ft2\), ha \(hectares, 1 ha = 10,000 m2\)/);
  assert.match(maak, /is an error and nothing is created/);
  assert.match(tool('app_update_annotation').description, /`units` \(or `measureAreaUnit`\) changes the unit its area is reported in \(ac, ha/);
  assert.match(tool('app_get_annotation').description, /`area: \{value, unit\}`/);
  assert.match(tool('app_list_annotations').description, /`area: \{value, unit\}`/);
  assert.match(tool('app_set_measure_scale').description, /LENGTH unit/);
  assert.match(tool('app_set_measure_scale').inputSchema.properties.unit.description, /An area unit \(ac, ha\) or an unknown unit is rejected/);
  assert.match(tool('app_place_schedule').description, /totals the areas in acres/);
  const takeoff = tool('app_get_takeoff');
  assert.equal(takeoff.inputSchema.properties.areaUnit.type, 'string');
  assert.match(takeoff.description, /`areaUnit` reports every area column in that unit/);

  // Rust and Python carry the same texts (the Rust source escapes the quotes).
  const inRust = (s) => rust.includes(s.replace(/\\/g, '\\\\').replace(/"/g, '\\"'));
  for (const naam of ['app_create_annotation', 'app_update_annotation', 'app_get_annotation',
    'app_list_annotations', 'app_set_measure_scale', 'app_get_takeoff', 'app_place_schedule']) {
    assert.ok(inRust(tool(naam).description), `${naam}: mcp_server.rs has the same description`);
  }
  assert.ok(inRust(takeoff.inputSchema.properties.areaUnit.description));
  assert.match(python, /area_unit: Optional\[str\] = None/);
  assert.match(python, /"areaUnit": area_unit/);
});
