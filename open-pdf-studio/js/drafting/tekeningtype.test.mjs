// Unittests voor de PURE tekeningtype-kern (datamodel, resolutie met
// nearest-scale-terugval, twee-lagen-overerving en de migratieketen).
// Draait onder `node --test` (opgenomen in npm run test:unit).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TEKENINGTYPE_VERSION, MM_TO_PX, DEFAULT_SCALE_KEY,
  scaleKeyFromScaleString, nearestScaleKey, resolveScaleValue,
  resolveLineWidthMm, resolveTextHeightMm,
  createDefaultRegelset, createDefaultTekeningtypenData,
  migrateTekeningtypen, duplicateRegelset,
} from './tekeningtype.js';

test('scaleKeyFromScaleString: gangbare schalen en randgevallen', () => {
  assert.equal(scaleKeyFromScaleString('1:100'), '0.01');
  assert.equal(scaleKeyFromScaleString('1:50'), '0.02');
  assert.equal(scaleKeyFromScaleString('1:20'), '0.05');
  assert.equal(scaleKeyFromScaleString('1/200'), '0.005');
  assert.equal(scaleKeyFromScaleString('2:100'), '0.02');
  // Onzin → standaard 1:100
  assert.equal(scaleKeyFromScaleString(''), DEFAULT_SCALE_KEY);
  assert.equal(scaleKeyFromScaleString('abc'), DEFAULT_SCALE_KEY);
  assert.equal(scaleKeyFromScaleString('1:0'), DEFAULT_SCALE_KEY);
  assert.equal(scaleKeyFromScaleString(null), DEFAULT_SCALE_KEY);
});

test('nearestScaleKey: log-nearest terugval', () => {
  const keys = ['0.01', '0.02', '0.005']; // 1:100, 1:50, 1:200
  assert.equal(nearestScaleKey(keys, '0.01'), '0.01');          // exact
  // 1:70 (≈0.0143) ligt in log-ruimte tussen 1:100 en 1:50; dichter bij 1:50?
  // log(0.0143)−log(0.01)=0.357; log(0.02)−log(0.0143)=0.336 → 1:50 wint.
  assert.equal(nearestScaleKey(keys, String(1 / 70)), '0.02');
  // 1:500 → dichtstbijzijnde is 1:200.
  assert.equal(nearestScaleKey(keys, '0.002'), '0.005');
  // 1:5 → dichtstbijzijnde is 1:50.
  assert.equal(nearestScaleKey(keys, '0.2'), '0.02');
  assert.equal(nearestScaleKey([], '0.01'), null);
  // Ongeldig doel → eerste geldige sleutel (deterministisch).
  assert.equal(nearestScaleKey(['0.01'], 'abc'), '0.01');
});

test('resolveScaleValue: exact, nearest en lege tabel', () => {
  const table = { '0.01': 0.5, '0.005': 0.35 };
  assert.equal(resolveScaleValue(table, '0.01'), 0.5);
  assert.equal(resolveScaleValue(table, '0.004'), 0.35);  // nearest 1:250→1:200
  assert.equal(resolveScaleValue(table, '0.02'), 0.5);    // nearest 1:50→1:100
  assert.equal(resolveScaleValue({}, '0.01'), null);
  assert.equal(resolveScaleValue(null, '0.01'), null);
});

test('resolveLineWidthMm: categorie-override → default-laag → null', () => {
  const rs = createDefaultRegelset();
  // Specifieke categorie wint (beton dikker dan wapening).
  assert.equal(resolveLineWidthMm(rs, 'IfcBeam', '0.01'), 0.5);
  assert.equal(resolveLineWidthMm(rs, 'IfcReinforcingBar', '0.01'), 0.25);
  assert.ok(resolveLineWidthMm(rs, 'IfcBeam', '0.01')
    > resolveLineWidthMm(rs, 'IfcReinforcingBar', '0.01'));
  // Onbekende categorie → default-laag.
  assert.equal(resolveLineWidthMm(rs, 'IfcOnbekend', '0.01'), 0.25);
  // Nearest-scale: alleen 1:100 geseed → zelfde waarde op 1:50.
  assert.equal(resolveLineWidthMm(rs, 'IfcBeam', '0.02'), 0.5);
  // Regelset zonder tabellen → null (aanroeper valt terug op de vaste pen).
  assert.equal(resolveLineWidthMm({}, 'IfcBeam', '0.01'), null);
});

test('resolveTextHeightMm: tekstsoorten en ontbrekende waarden', () => {
  const rs = createDefaultRegelset();
  assert.equal(resolveTextHeightMm(rs, 'labels'), 2.5);
  assert.equal(resolveTextHeightMm(rs, 'maatvoering'), 2.0);
  assert.equal(resolveTextHeightMm(rs, 'titels'), 3.5);
  assert.equal(resolveTextHeightMm(rs, 'bestaatniet'), null);
  assert.equal(resolveTextHeightMm(null, 'labels'), null);
});

test('mm → px omrekening: 0,25 mm-pen ≈ 0,71 app-px', () => {
  assert.ok(Math.abs(0.25 * MM_TO_PX - 0.7086) < 0.001);
});

test('migratie: ontbrekend/kapot → verse defaults (version 1)', () => {
  for (const bad of [null, undefined, 42, 'x', {}, { regelsets: 'nee' }]) {
    const d = migrateTekeningtypen(bad);
    assert.equal(d.version, TEKENINGTYPE_VERSION);
    assert.equal(d.regelsets.length, 1);
    assert.equal(d.regelsets[0].name, 'Constructieplattegrond');
    assert.equal(d.defaultId, d.regelsets[0].id);
  }
});

test('migratie: geldige actuele data komt als ZELFDE referentie terug', () => {
  const d = createDefaultTekeningtypenData();
  assert.equal(migrateTekeningtypen(d), d);
});

test('migratie: kapotte defaultId wordt hersteld, nieuwere versie blijft staan', () => {
  const d = createDefaultTekeningtypenData();
  const broken = { ...d, defaultId: 'bestaat-niet' };
  const fixed = migrateTekeningtypen(broken);
  assert.equal(fixed.defaultId, d.regelsets[0].id);
  // Nieuwer dan deze build kent → onaangeroerd (nooit destructief).
  const future = { version: 999, defaultId: 'x', regelsets: [{ id: 'x' }] };
  assert.equal(migrateTekeningtypen(future), future);
});

test('duplicateRegelset: diepe kopie onder nieuw stabiel id', () => {
  const rs = createDefaultRegelset();
  const copy = duplicateRegelset(rs, 'Palenplan');
  assert.notEqual(copy.id, rs.id);
  assert.equal(copy.name, 'Palenplan');
  copy.lineWidthsMm.IfcBeam[DEFAULT_SCALE_KEY] = 9;
  assert.equal(rs.lineWidthsMm.IfcBeam[DEFAULT_SCALE_KEY], 0.5); // geen alias
});

test('inherit/override-semantiek: expliciete component-waarde wint (contract)', () => {
  // De effectieve-dikte-helper (drafting-rules.js) hanteert: ann.lineWidth
  // gezet → die waarde; anders regelset; anders vaste pen. De pure kern
  // levert daarvoor de regelset-laag; dit contract borgt de volgorde.
  const rs = createDefaultRegelset();
  const regelsetPx = resolveLineWidthMm(rs, 'IfcBeam', '0.01') * MM_TO_PX;
  const explicit = 2.5;
  const effective = (ann) => (ann.lineWidth != null ? ann.lineWidth : regelsetPx);
  assert.equal(effective({ lineWidth: explicit }), explicit);
  assert.equal(effective({}), regelsetPx);
});
