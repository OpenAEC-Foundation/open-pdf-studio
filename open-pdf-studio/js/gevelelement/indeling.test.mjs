import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRESETS, preset, stijlTypenVoor, paneelTypenVoor, registreerStijlType,
  registreerPaneelType, stijlTypeToegestaan, paneelTypeToegestaan,
} from './catalogus.js';
import {
  indeling, naarParams, voegStijlToe, splitsVeld, verwijderStijl, verschuifStijl,
  stijlBereik, wisselStijlType, wisselPaneel, verdeelGelijk, zetVeldbreedtes,
  rekUit, legVast, veldBij, normaliseerPaneel, zetVeldbreedte,
} from './indeling.js';

const bijna = (a, b, tol, wat) => assert.ok(Math.abs(a - b) <= tol, `${wat}: ${a} ≈ ${b}`);
const posities = (p) => p.stijlen.map((s) => s.pos);
const typen = (p) => p.panelen.map((x) => x.type);

// Een vliesgevel van 3600 mm met drie velden van 1200 (hart-op-hart).
const DRIE = {
  lengte: 3600,
  stijlen: [{ pos: 1200, type: 'alu-50x150' }, { pos: 2400, type: 'alu-50x150' }],
  panelen: ['glas', 'deur', 'glas'],
};

// ── catalogus ────────────────────────────────────────────────────────────

test('twee voorinstellingen met elk hun eigen stijl- en paneeltypes', () => {
  assert.deepEqual(Object.keys(PRESETS).sort(), ['kozijn', 'vliesgevel']);
  const vg = stijlTypenVoor('vliesgevel').map((t) => t.id);
  const kz = stijlTypenVoor('kozijn').map((t) => t.id);
  assert.ok(vg.includes('alu-50x150'), 'standaard vliesgevelstijl 50 × 150');
  assert.ok(kz.includes('hout-67x114'), 'standaard kozijnhout 67 × 114');
  assert.ok(!vg.some((id) => kz.includes(id)), 'een kozijn biedt andere stijlen dan een vliesgevel');
  assert.deepEqual(paneelTypenVoor('vliesgevel').map((t) => t.id).sort(), ['deur', 'dicht', 'glas', 'open']);
  assert.deepEqual(paneelTypenVoor('kozijn').map((t) => t.id).sort(), ['deur', 'dicht', 'draairaam', 'glas']);
  for (const p of Object.values(PRESETS)) {
    assert.ok(stijlTypeToegestaan(p.id, p.stijlType) && stijlTypeToegestaan(p.id, p.kaderType), p.id);
    assert.ok(paneelTypeToegestaan(p.id, p.paneelType), p.id);
  }
  assert.equal(preset('onzin').id, 'vliesgevel', 'onbekende voorinstelling valt terug');
});

test('de catalogus is uitbreidbaar: een nieuw type is meteen bruikbaar', () => {
  registreerStijlType({ id: 'test-hout-67x114-sponning', naam: 'Test', breedteMm: 67, diepteMm: 114, presets: ['kozijn'] });
  registreerPaneelType({ id: 'test-rooster', naam: 'Rooster', weergave: 'dicht', presets: ['kozijn'] });
  assert.ok(stijlTypenVoor('kozijn').some((t) => t.id === 'test-hout-67x114-sponning'));
  assert.ok(!stijlTypeToegestaan('vliesgevel', 'test-hout-67x114-sponning'));
  const r = wisselPaneel({ lengte: 1800 }, 'kozijn', 0, 'test-rooster');
  assert.equal(r.ok, true);
  assert.equal(r.params.panelen[0].type, 'test-rooster');
  assert.throws(() => registreerStijlType({ id: 'x', breedteMm: 0, diepteMm: 10 }));
  assert.throws(() => registreerPaneelType({ id: 'y', weergave: 'onbekend' }));
});

// ── indeling ─────────────────────────────────────────────────────────────

test('velden en stijlen: raster hart-op-hart, kader binnen de lengte', () => {
  const lay = indeling(DRIE, 'vliesgevel');
  assert.equal(lay.lengteMm, 3600);
  assert.equal(lay.velden.length, 3);
  assert.equal(lay.stijlen.length, 4, 'beginkader, twee tussenstijlen, eindkader');
  assert.deepEqual(lay.stijlen.map((s) => s.rol), ['begin', 'tussen', 'tussen', 'eind']);
  assert.deepEqual(lay.velden.map((v) => v.breedteMm), [1200, 1200, 1200]);
  // Beginkader 0..50, tussenstijl 1175..1225: vrij 50..1175 = 1125.
  assert.equal(lay.stijlen[0].vanMm, 0);
  assert.equal(lay.stijlen[3].totMm, 3600);
  assert.equal(lay.velden[0].dagVanMm, 50);
  assert.equal(lay.velden[0].dagTotMm, 1175);
  assert.equal(lay.velden[0].dagMm, 1125);
  assert.equal(lay.velden[1].dagMm, 1150, 'een middenveld verliest twee halve stijlen');
  assert.equal(lay.diepteMm, 150);
  assert.deepEqual(lay.velden.map((v) => v.paneel.type), ['glas', 'deur', 'glas']);
  assert.deepEqual(lay.velden[1].paneel, { type: 'deur', scharnier: 'begin', draaiNaar: 'binnen' });
});

test('zonder stijlen verdeelt het element zich automatisch', () => {
  const vg = indeling({ lengte: 5000 }, 'vliesgevel');
  assert.equal(vg.expliciet, false);
  assert.equal(vg.velden.length, 4, '5000 / 1200 ≈ 4 velden');
  vg.velden.forEach((v) => assert.equal(v.breedteMm, 1250));
  const kz = indeling({}, 'kozijn');
  assert.equal(kz.lengteMm, 1800, 'standaardlengte van een kozijn');
  assert.equal(kz.velden.length, 2);
  assert.equal(kz.stijlen[0].breedteMm, 67);
  assert.equal(kz.diepteMm, 114);
  assert.equal(indeling({ lengte: 150 }, 'vliesgevel').velden.length, 1, 'te kort: één veld');
});

test('ongeldige invoer valt terug op wat past, zonder te gooien', () => {
  const lay = indeling({
    lengte: 2000,
    stijlen: [1500, 'x', { pos: 1520 }, { pos: -5 }, { pos: 500, type: 'onbekend' }],
    panelen: ['glas', 'open', 'draairaam'],
  }, 'vliesgevel');
  assert.deepEqual(lay.stijlen.slice(1, -1).map((s) => s.posMm), [500, 1500], 'te dicht op elkaar en buiten het element vallen weg');
  assert.equal(lay.stijlen[1].type, 'alu-50x150', 'onbekend type → standaard');
  assert.equal(lay.velden[2].paneel.type, 'glas', 'draairaam hoort niet bij een vliesgevel → standaard');
  assert.equal(normaliseerPaneel({ type: 'deur', scharnier: 'eind', draaiNaar: 'buiten' }, 'vliesgevel').scharnier, 'eind');
  assert.equal(normaliseerPaneel({ type: 'glas', scharnier: 'eind' }, 'vliesgevel').scharnier, undefined, 'glas heeft geen scharnier');
});

test('legVast maakt een automatische verdeling expliciet zonder iets te verplaatsen', () => {
  const p = legVast({ lengte: 3600 }, 'vliesgevel');
  assert.deepEqual(posities(p), [1200, 2400]);
  assert.deepEqual(p.kader, ['alu-50x150', 'alu-50x150']);
  assert.equal(indeling(p, 'vliesgevel').expliciet, true);
  assert.deepEqual(naarParams({}, indeling(p, 'vliesgevel')), p);
});

// ── bewerkingen ──────────────────────────────────────────────────────────

test('stijl toevoegen splitst het veld; de lengte blijft gelijk', () => {
  const r = voegStijlToe(DRIE, 'vliesgevel', 600);
  assert.equal(r.ok, true);
  assert.equal(r.index, 1, 'de nieuwe stijl is stijl 1');
  assert.deepEqual(posities(r.params), [600, 1200, 2400]);
  assert.deepEqual(typen(r.params), ['glas', 'glas', 'deur', 'glas'], 'het nieuwe veld krijgt het paneel van het gesplitste veld');
  assert.equal(r.params.lengte, 3600);
  const inDeur = voegStijlToe(DRIE, 'vliesgevel', 1800);
  assert.deepEqual(typen(inDeur.params), ['glas', 'deur', 'glas', 'glas'], 'een deur wordt niet verdubbeld');
  assert.deepEqual(DRIE.stijlen.map((s) => s.pos), [1200, 2400], 'de invoer blijft ongemoeid');
});

test('stijl toevoegen weigert een te smal veld en een positie buiten het element', () => {
  assert.equal(voegStijlToe(DRIE, 'vliesgevel', 1230).ok, false);
  assert.match(voegStijlToe(DRIE, 'vliesgevel', 1230).error, /narrower than 100 mm/);
  assert.equal(voegStijlToe(DRIE, 'vliesgevel', 4000).ok, false);
  assert.equal(voegStijlToe(DRIE, 'vliesgevel', 600, 'hout-67x114').ok, false, 'kozijnhout hoort niet in een vliesgevel');
  const s = splitsVeld(DRIE, 'vliesgevel', 2);
  assert.deepEqual(posities(s.params), [1200, 2400, 3000], 'hart-op-hart gehalveerd');
});

test('stijl verwijderen voegt twee velden samen; het kader blijft staan', () => {
  const r = verwijderStijl(DRIE, 'vliesgevel', 1);
  assert.equal(r.ok, true);
  assert.deepEqual(posities(r.params), [2400]);
  assert.deepEqual(typen(r.params), ['glas', 'glas'], 'het samengevoegde veld houdt het paneel aan de beginkant');
  assert.equal(verwijderStijl(DRIE, 'vliesgevel', 0).ok, false);
  assert.equal(verwijderStijl(DRIE, 'vliesgevel', 3).ok, false);
  assert.match(verwijderStijl(DRIE, 'vliesgevel', 3).error, /outer frame/);
  assert.equal(verwijderStijl(DRIE, 'vliesgevel', 7).ok, false);
});

test('stijl verschuiven: buurvelden veranderen, grenzen worden bewaakt', () => {
  const r = verschuifStijl(DRIE, 'vliesgevel', 1, 1000);
  assert.equal(r.ok, true);
  assert.deepEqual(posities(r.params), [1000, 2400]);
  const lay = indeling(r.params, 'vliesgevel');
  assert.deepEqual(lay.velden.map((v) => v.breedteMm), [1000, 1400, 1200]);
  const bereik = stijlBereik(indeling(DRIE, 'vliesgevel'), 1);
  assert.deepEqual(bereik, { vanMm: 175, totMm: 2250 });
  assert.equal(verschuifStijl(DRIE, 'vliesgevel', 1, 100).ok, false, 'te dicht op het kader');
  const geklemd = verschuifStijl(DRIE, 'vliesgevel', 1, 100, { klem: true });
  assert.equal(geklemd.ok, true);
  assert.equal(geklemd.posMm, 175, 'slepen blijft tegen de grens staan');
  assert.equal(verschuifStijl(DRIE, 'vliesgevel', 0, 10).ok, false, 'het kader verschuift niet');
});

test('veldbreedte intypen verschuift de stijl aan de eindkant (laatste veld: beginkant)', () => {
  const r = zetVeldbreedte(DRIE, 'vliesgevel', 0, 900);
  assert.deepEqual(posities(r.params), [900, 2400]);
  const m = zetVeldbreedte(DRIE, 'vliesgevel', 1, 1500);
  assert.deepEqual(posities(m.params), [1200, 2700]);
  const l = zetVeldbreedte(DRIE, 'vliesgevel', 2, 1000);
  assert.deepEqual(posities(l.params), [1200, 2600], 'het laatste veld duwt zijn beginstijl');
  assert.equal(indeling(l.params, 'vliesgevel').lengteMm, 3600, 'de lengte blijft');
  assert.equal(zetVeldbreedte(DRIE, 'vliesgevel', 0, 3000).ok, false, 'het buurveld zou verdwijnen');
  assert.equal(zetVeldbreedte({ lengte: 900 }, 'vliesgevel', 0, 500).ok, false, 'één veld: de lengte bepaalt');
});

test('stijl wisselen voor een ander type, ook het kader', () => {
  const r = wisselStijlType(DRIE, 'vliesgevel', 2, 'alu-65x250');
  assert.equal(r.ok, true);
  assert.equal(r.params.stijlen[1].type, 'alu-65x250');
  assert.equal(indeling(r.params, 'vliesgevel').diepteMm, 250, 'de elementdiepte volgt de diepste stijl');
  const k = wisselStijlType(DRIE, 'vliesgevel', 0, 'alu-50x200');
  assert.deepEqual(k.params.kader, ['alu-50x200', 'alu-50x150']);
  assert.equal(wisselStijlType(DRIE, 'vliesgevel', 1, 'hout-67x114').ok, false);
  const krap = { lengte: 360, stijlen: [180], panelen: ['glas', 'glas'] };
  assert.equal(wisselStijlType(krap, 'vliesgevel', 1, 'alu-65x250').ok, false, 'te breed: veld wordt te smal');
});

test('paneel wisselen, en alleen de eigenschappen van een deur wijzigen', () => {
  const r = wisselPaneel(DRIE, 'vliesgevel', 0, 'dicht');
  assert.deepEqual(typen(r.params), ['dicht', 'deur', 'glas']);
  const d = wisselPaneel(DRIE, 'vliesgevel', 1, { scharnier: 'eind' });
  assert.deepEqual(d.params.panelen[1], { type: 'deur', scharnier: 'eind', draaiNaar: 'binnen' });
  assert.equal(wisselPaneel(DRIE, 'vliesgevel', 0, 'draairaam').ok, false, 'geen draairaam in een vliesgevel');
  assert.equal(wisselPaneel(DRIE, 'vliesgevel', 9, 'glas').ok, false);
  const kz = wisselPaneel({}, 'kozijn', 1, 'draairaam');
  assert.equal(kz.params.panelen[1].type, 'draairaam');
});

test('opnieuw verdelen en veldbreedtes vastleggen', () => {
  const r = verdeelGelijk(DRIE, 'vliesgevel', 4);
  assert.deepEqual(posities(r.params), [900, 1800, 2700]);
  assert.deepEqual(typen(r.params), ['glas', 'deur', 'glas', 'glas'], 'panelen blijven per veldnummer');
  assert.equal(verdeelGelijk(DRIE, 'vliesgevel', 40).ok, false, 'te veel velden');
  const b = zetVeldbreedtes({ panelen: ['dicht'] }, 'vliesgevel', [900, 1200, 1200, 900]);
  assert.equal(b.ok, true);
  assert.equal(b.params.lengte, 4200);
  assert.deepEqual(posities(b.params), [900, 2100, 3300]);
  assert.deepEqual(typen(b.params), ['dicht', 'glas', 'glas', 'glas']);
  assert.equal(zetVeldbreedtes({}, 'vliesgevel', [1000, 50]).ok, false);
  assert.equal(zetVeldbreedtes({}, 'vliesgevel', []).ok, false);
});

test('uitrekken aan het eind: stijlen blijven staan, het laatste veld groeit', () => {
  const r = rekUit(DRIE, 'vliesgevel', 4000, 'begin');
  assert.deepEqual(posities(r.params), [1200, 2400]);
  assert.equal(r.params.lengte, 4000);
  const lay = indeling(r.params, 'vliesgevel');
  assert.deepEqual(lay.velden.map((v) => v.breedteMm), [1200, 1200, 1600]);
});

test('uitrekken aan het begin: stijlen houden hun afstand tot het eind', () => {
  const r = rekUit(DRIE, 'vliesgevel', 4000, 'eind');
  assert.deepEqual(posities(r.params), [1600, 2800]);
  assert.deepEqual(typen(r.params), ['glas', 'deur', 'glas']);
  const lay = indeling(r.params, 'vliesgevel');
  assert.deepEqual(lay.velden.map((v) => v.breedteMm), [1600, 1200, 1200]);
});

test('inkorten laat stijlen die niet meer passen vallen', () => {
  const eind = rekUit(DRIE, 'vliesgevel', 2450, 'begin');
  assert.deepEqual(posities(eind.params), [1200], 'de stijl op 2400 past niet meer');
  assert.deepEqual(typen(eind.params), ['glas', 'deur']);
  const begin = rekUit(DRIE, 'vliesgevel', 2450, 'eind');
  assert.deepEqual(posities(begin.params), [1250], 'aan de beginkant valt de eerste stijl weg');
  assert.deepEqual(typen(begin.params), ['glas', 'glas']);
  const auto = rekUit({ lengte: 3600 }, 'vliesgevel', 4800, 'begin');
  assert.deepEqual(posities(auto.params), [1200, 2400], 'een automatische verdeling wordt eerst vastgelegd');
});

test('veldBij: het veld op een positie', () => {
  const lay = indeling(DRIE, 'vliesgevel');
  assert.equal(veldBij(lay, 0), 0);
  assert.equal(veldBij(lay, 1199), 0);
  assert.equal(veldBij(lay, 1201), 1);
  assert.equal(veldBij(lay, 3600), 2);
  assert.equal(veldBij(lay, 3601), -1);
  bijna(lay.velden[2].dagMm, 1125, 1e-9, 'laatste dag');
});
