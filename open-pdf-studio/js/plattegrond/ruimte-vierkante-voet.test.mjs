// Ruimtetags in vierkante voet (#1230): op een blad in voet of inch toont de
// tag de netto oppervlakte in hele vierkante voet (`264 SF`). Metrische
// bladen houden `24.5 m²`; die uitkomsten liggen hier ook vast.

import assert from 'node:assert/strict';
import test from 'node:test';

import { ruimtenUitWanden, ruimteLabel, ruimteOppervlakteTekst } from './ruimte.js';
import { oppervlakteM2Van, tagOppervlakteEenheid, tagWeergaveParams } from './ruimte-koppeling.js';
import { ruimteTagRegels, ruimteTagVak, ruimteTagTemplate } from '../symbols/templates/ruimtetag.js';
import { plattegrondOpdracht } from './mcp-plattegrond.js';

// 1/4" = 1'-0": 18 paginapunten per voet.
const PT_PER_FT = 18;
const PX_PER_MM = PT_PER_FT / 304.8;
const M2_PER_FT2 = 0.3048 * 0.3048;

/** Vier wanden van 6 inch met de hartlijnen op een rechthoek van b x h voet. */
function kamerOpHartlijnen(bFt, hFt, dikteMm = 152.4) {
  const x0 = 100, y0 = 100, x1 = x0 + bFt * PT_PER_FT, y1 = y0 + hFt * PT_PER_FT;
  const w = (id, sx, sy, ex, ey) => ({
    id, type: 'wall', page: 1, dikteMm, hatchPattern: 'none', startX: sx, startY: sy, endX: ex, endY: ey,
  });
  return [w('n', x0, y0, x1, y0), w('o', x1, y0, x1, y1), w('z', x1, y1, x0, y1), w('w', x0, y1, x0, y0)];
}

const tekstVan = (params) => ruimteTagRegels(params).map((r) => r.tekst);

test('de oppervlaktetekst: hele vierkante voet met SF', () => {
  assert.equal(ruimteOppervlakteTekst(264 * M2_PER_FT2, 1, 'ft²'), '264 SF');
  assert.equal(ruimteOppervlakteTekst(263.25 * M2_PER_FT2, 1, 'ft²'), '263 SF');
  assert.equal(ruimteOppervlakteTekst(263.75 * M2_PER_FT2, 1, 'ft²'), '264 SF');
  // Het aantal decimalen geldt alleen voor m².
  assert.equal(ruimteOppervlakteTekst(263.25 * M2_PER_FT2, 3, 'ft²'), '263 SF');
  assert.equal(ruimteLabel('Office', 263.25 * M2_PER_FT2, 1, 'ft²'), 'Office\n263 SF');
  assert.equal(ruimteLabel(null, 100 * M2_PER_FT2, 1, 'ft²'), '100 SF');
});

test('metrisch blijft: de oppervlaktetekst in m²', () => {
  assert.equal(ruimteOppervlakteTekst(24.46), '24.5 m²');
  assert.equal(ruimteOppervlakteTekst(24.46, 2), '24.46 m²');
  assert.equal(ruimteOppervlakteTekst(24.46, 0), '24 m²');
  assert.equal(ruimteLabel('Woonkamer', 24.5), 'Woonkamer\n24.5 m²');
  assert.equal(ruimteLabel('', 24.46, 2), '24.46 m²');
  assert.equal(ruimteLabel('Hal', 6, 1, 'm²'), 'Hal\n6.0 m²');
});

test('een kamer van 20 x 14 voet op de hartlijnen van 6 inch wanden is 263 SF', () => {
  const { ruimten, losseEinden } = ruimtenUitWanden(kamerOpHartlijnen(20, 14), { pxPerMm: PX_PER_MM });
  assert.equal(ruimten.length, 1);
  assert.deepEqual(losseEinden, []);
  // Binnenwerks 19'-6" x 13'-6" = 263,25 ft², netto.
  const ft2 = ruimten[0].oppervlakteM2 / M2_PER_FT2;
  assert.ok(Math.abs(ft2 - 263.25) < 1e-6, `netto ${ft2} ft²`);
  assert.equal(ruimteOppervlakteTekst(ruimten[0].oppervlakteM2, 1, 'ft²'), '263 SF');
  // Bruto (op de hartlijnen) zou 280 SF zijn: de tag toont de netto maat.
  assert.notEqual(ruimteOppervlakteTekst(ruimten[0].oppervlakteM2, 1, 'ft²'), '280 SF');
});

const vierkant = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }];
const tag = {
  id: 't1', type: 'parametricSymbol', symbolId: 'room-tag', page: 1,
  x: 30, y: 30, width: 40, height: 20,
  params: { naam: 'Oud', nummer: '', oppervlakteM2: 1, decimalen: 1, toonOppervlakte: true, zaadX: 50, zaadY: 40 },
};
const ruimteIn = (measureValue, measureUnit) => ({
  id: 'r1', type: 'measureArea', page: 1, points: vierkant,
  opsRuimteZaad: { x: 50, y: 40 }, opsRuimteNaam: 'Office', opsRuimteNummer: '101',
  measureValue, measureUnit,
});

test('de oppervlakte van een ruimte in ft² of in² wordt exact omgerekend', () => {
  assert.equal(oppervlakteM2Van(ruimteIn(263.25, 'ft²')), Math.round(263.25 * M2_PER_FT2 * 1e6) / 1e6);
  assert.equal(oppervlakteM2Van(ruimteIn(144, 'in²')), Math.round(M2_PER_FT2 * 1e6) / 1e6);
  assert.equal(oppervlakteM2Van(ruimteIn(9, 'yd²')), Math.round(81 * M2_PER_FT2 * 1e6) / 1e6);
  // Zonder echte eenheid is er geen oppervlakte.
  assert.equal(oppervlakteM2Van(ruimteIn(500, 'px²')), null);
  assert.equal(oppervlakteM2Van(ruimteIn(500, undefined)), null);
  assert.equal(oppervlakteM2Van(ruimteIn('x', 'ft²')), null);
});

test('metrisch blijft: de oppervlakte van een ruimte in mm², cm², dm² en m²', () => {
  assert.equal(oppervlakteM2Van(ruimteIn(24_500_000, 'mm²')), 24.5);
  assert.equal(oppervlakteM2Van(ruimteIn(245_000, 'cm²')), 24.5);
  assert.equal(oppervlakteM2Van(ruimteIn(2450, 'dm²')), 24.5);
  assert.equal(oppervlakteM2Van(ruimteIn(24.5, 'm²')), 24.5);
});

test('de tag van een ruimte op een blad in voet toont vierkante voet', () => {
  const ruimte = ruimteIn(263.25, 'ft²');
  assert.equal(tagOppervlakteEenheid(ruimte, 'metric'), 'ft²');
  const p = tagWeergaveParams(tag, [ruimte, tag], 'metric');
  assert.equal(p.oppervlakteEenheid, 'ft²');
  assert.deepEqual(tekstVan(p), ['101', 'Office', '263 SF']);
  // Een blad in inch telt ook als imperiaal.
  assert.deepEqual(tekstVan(tagWeergaveParams(tag, [ruimteIn(264 * 144, 'in²'), tag], 'metric')), ['101', 'Office', '264 SF']);
  // De template tekent die regels.
  const tekst = ruimteTagTemplate.render(p, { x: 0, y: 0, width: 90, height: 36 }).map((c) => c.text);
  assert.deepEqual(tekst, ['101', 'Office', '263 SF']);
});

test('de voorkeur Imperiaal zet ook een metrisch gemeten ruimte in vierkante voet', () => {
  const ruimte = ruimteIn(24_456_724.704, 'mm²');           // 263,25 ft²
  assert.equal(tagOppervlakteEenheid(ruimte, 'imperial'), 'ft²');
  assert.deepEqual(tekstVan(tagWeergaveParams(tag, [ruimte, tag], 'imperial')), ['101', 'Office', '263 SF']);
});

test('metrisch blijft: de tag toont m² en draagt geen eenheid', () => {
  const ruimte = ruimteIn(24_500_000, 'mm²');
  for (const stelsel of ['metric', 'both']) {
    assert.equal(tagOppervlakteEenheid(ruimte, stelsel), 'm²');
    const p = tagWeergaveParams(tag, [ruimte, tag], stelsel);
    assert.deepEqual(p, { ...tag.params, naam: 'Office', nummer: '101', oppervlakteM2: 24.5 });
    assert.deepEqual(tekstVan(p), ['101', 'Office', '24.5 m²']);
  }
  // Een tag die ooit op een blad in voet stond en nu een metrische ruimte heeft.
  const oud = { ...tag, params: { ...tag.params, oppervlakteEenheid: 'ft²' } };
  const p = tagWeergaveParams(oud, [ruimte, oud], 'metric');
  assert.equal('oppervlakteEenheid' in p, false);
  assert.deepEqual(tekstVan(p), ['101', 'Office', '24.5 m²']);
  // Decimalen van de tag gelden nog steeds.
  assert.deepEqual(tekstVan({ naam: 'Hal', oppervlakteM2: 6.04, decimalen: 2 }), ['Hal', '6.04 m²']);
  assert.deepEqual(tekstVan({ naam: 'Hal', oppervlakteM2: 6.04 }), ['Hal', '6.0 m²']);
});

test('een tag zonder ruimte toont zijn eigen reservekopie, in zijn eigen eenheid', () => {
  const los = { ...tag, params: { naam: 'Lobby', oppervlakteM2: 100 * M2_PER_FT2, oppervlakteEenheid: 'ft²' } };
  assert.equal(tagWeergaveParams(los, [los], 'metric'), los.params);
  assert.deepEqual(tekstVan(los.params), ['Lobby', '100 SF']);
  // Het vak van een nieuwe tag past om de kortere tekst.
  const sf = ruimteTagVak({ x: 0, y: 0 }, { naam: 'A', oppervlakteM2: 24.5, oppervlakteEenheid: 'ft²' }, 9);
  const m2 = ruimteTagVak({ x: 0, y: 0 }, { naam: 'A', oppervlakteM2: 24.5 }, 9);
  assert.equal(sf.width, '264 SF'.length * 9 * 0.6 + 9);
  assert.equal(m2.width, '24.5 m²'.length * 9 * 0.6 + 9);
});

// ── de MCP-opdracht ──────────────────────────────────────────────────────

/** App-kant als stub; `imperiaal` zegt of het blad in voet of inch staat. */
function omgevingMet(annotaties, imperiaal) {
  const doc = { currentPage: 1, annotations: annotaties, paginas: 1 };
  let teller = 0;
  return {
    doc,
    pxPerMmAt: () => PX_PER_MM,
    ...(imperiaal === undefined ? {} : { imperiaalOp: () => imperiaal }),
    async maak(type, page, props) {
      const ann = { id: `a${++teller}`, type, page, ...props };
      doc.annotations.push(ann);
      return { ok: true, id: ann.id };
    },
    async werkBij(id, props) {
      const a = doc.annotations.find((x) => x.id === id);
      if (!a) return { ok: false };
      Object.assign(a, props);
      return { ok: true };
    },
    async verwijder() { return { ok: true }; },
    async herorden() { return { ok: true }; },
    async transactie(fn) { await fn(); },
  };
}

test('MCP: een wand zonder opgave is op een blad in voet 6 inch zonder arcering', async () => {
  const o = omgevingMet([], true);
  const r = await plattegrondOpdracht({ action: 'wall', start: { x: 100, y: 100 }, end: { x: 460, y: 100 } }, o);
  assert.equal(r.ok, true);
  const [wand] = o.doc.annotations;
  assert.equal(wand.type, 'wall');
  assert.equal(wand.dikteMm, 152.4);
  assert.equal(wand.hatchPattern, 'none');
  // Een opgegeven dikte of materiaal wint.
  const o2 = omgevingMet([], true);
  await plattegrondOpdracht({
    action: 'wall', start: { x: 100, y: 100 }, end: { x: 460, y: 100 },
    thicknessMm: 203.2, material: 'nen47-beton-gewapend',
  }, o2);
  assert.equal(o2.doc.annotations[0].dikteMm, 203.2);
  assert.equal(o2.doc.annotations[0].hatchPattern, 'nen47-beton-gewapend');
});

test('MCP, metrisch blijft: een wand zonder opgave is 100 mm metselwerk', async () => {
  for (const imperiaal of [false, undefined]) {
    const o = omgevingMet([], imperiaal);
    const r = await plattegrondOpdracht({ action: 'wall', start: { x: 100, y: 100 }, end: { x: 460, y: 100 } }, o);
    assert.equal(r.ok, true);
    assert.equal(o.doc.annotations[0].dikteMm, 100);
    assert.equal(o.doc.annotations[0].hatchPattern, 'nen47-metselwerk-baksteen');
  }
});

test('MCP: een geplaatste ruimte op een blad in voet krijgt een tag in vierkante voet', async () => {
  const o = omgevingMet(kamerOpHartlijnen(20, 14), true);
  const r = await plattegrondOpdracht({ action: 'rooms', place: true, seeds: [{ x: 200, y: 200, name: 'Office' }] }, o);
  assert.equal(r.ok, true);
  assert.equal(r.placed.length, 1);
  assert.equal(r.placed[0].label, 'Office\n263 SF');
  assert.equal(r.placed[0].areaSqFt, 263.25);
  assert.equal(r.placed[0].areaM2, 24.46);
  const tagAnn = o.doc.annotations.find((a) => a.symbolId === 'room-tag');
  assert.equal(tagAnn.params.oppervlakteEenheid, 'ft²');
  assert.deepEqual(tekstVan(tagAnn.params), ['Office', '263 SF']);
  // Alleen opvragen geeft dezelfde tekst.
  const lijst = await plattegrondOpdracht({ action: 'rooms' }, o);
  assert.equal(lijst.rooms[0].label, 'Office\n263 SF');
  const inspect = await plattegrondOpdracht({ action: 'inspect' }, o);
  assert.equal(inspect.rooms[0].areaSqFt, 263.25);
  // Verversen houdt de eenheid.
  const vers = await plattegrondOpdracht({ action: 'rooms', refresh: true }, o);
  assert.equal(vers.ok, true);
  assert.equal(o.doc.annotations.find((a) => a.symbolId === 'room-tag').params.oppervlakteEenheid, 'ft²');
});

test('MCP, metrisch blijft: de tag en het verslag in m², zonder eenheid op de tag', async () => {
  for (const imperiaal of [false, undefined]) {
    const o = omgevingMet(kamerOpHartlijnen(20, 14), imperiaal);
    const r = await plattegrondOpdracht({ action: 'rooms', place: true, seeds: [{ x: 200, y: 200, name: 'Kantoor' }] }, o);
    assert.equal(r.placed[0].label, 'Kantoor\n24.5 m²');
    assert.equal(r.placed[0].areaM2, 24.46);
    assert.equal('areaSqFt' in r.placed[0], false);
    const tagAnn = o.doc.annotations.find((a) => a.symbolId === 'room-tag');
    assert.deepEqual(Object.keys(tagAnn.params).sort(), [
      'ankerX', 'ankerY', 'decimalen', 'naam', 'nummer', 'oppervlakteM2', 'toonOppervlakte', 'zaadX', 'zaadY',
    ]);
    assert.equal(tagAnn.params.oppervlakteM2, 24.46);
    assert.deepEqual(tekstVan(tagAnn.params), ['Kantoor', '24.5 m²']);
    const inspect = await plattegrondOpdracht({ action: 'inspect' }, o);
    assert.equal('areaSqFt' in inspect.rooms[0], false);
  }
});

test('MCP: een tag die van een blad in voet naar een metrisch blad gaat, verliest zijn eenheid bij verversen', async () => {
  const o = omgevingMet(kamerOpHartlijnen(20, 14), true);
  await plattegrondOpdracht({ action: 'rooms', place: true, seeds: [{ x: 200, y: 200, name: 'Office' }] }, o);
  o.imperiaalOp = () => false;
  await plattegrondOpdracht({ action: 'rooms', refresh: true }, o);
  const tagAnn = o.doc.annotations.find((a) => a.symbolId === 'room-tag');
  assert.equal('oppervlakteEenheid' in tagAnn.params, false);
  assert.equal(tagAnn.params.oppervlakteM2, 24.46);
});
