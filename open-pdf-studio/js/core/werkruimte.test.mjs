// Werkruimten en bewaarde indeling (#932): welke panelen en paletten open
// staan blijft over een herstart bewaard, en een indeling kan onder een naam
// worden opgeslagen, gekozen en teruggezet.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import {
  LAYOUT_SLEUTELS, isLayoutSleutel, normaliseerLayout, leesLayout, layoutWijzigingen,
  zelfdeLayout, normaliseerNaam, normaliseerWerkruimten, vindWerkruimte,
  bewaarWerkruimte, verwijderWerkruimte, begrensdeBreedte, MAX_WERKRUIMTEN, MAX_NAAM_LENGTE,
} from './werkruimte.js';

const lees = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// De standaarden zoals in constants.ts (dat is TypeScript en in CI op Node 20
// niet te importeren): de test hieronder bewaakt dat ze daar staan.
const STANDAARD = {
  ribbonCollapsed: false,
  leftPanelCollapsed: false,
  leftPanelTab: 'thumbnails',
  leftPanelWidth: null,
  propertiesPanelVisible: true,
  propertiesPanelCollapsed: false,
  toolPaletteVisible: true,
  toolPaletteMode: 'docked-left',
  toolPaletteFloatX: 200,
  toolPaletteFloatY: 150,
  symbolPaletteVisible: true,
  symbolPaletteMode: 'docked-right',
  symbolPaletteFloatX: 300,
  symbolPaletteFloatY: 150,
  paletteLeftOrder: [],
  paletteRightOrder: [],
};

test('elke indelingssleutel heeft een standaard in de voorkeuren', () => {
  const constants = lees('./constants.ts');
  const typen = lees('../types/preferences.ts');
  for (const sleutel of [...LAYOUT_SLEUTELS, 'workspaces', 'activeWorkspace']) {
    assert.match(constants, new RegExp(`^\\s+${sleutel}:`, 'm'), `constants.ts: ${sleutel}`);
    assert.match(typen, new RegExp(`^\\s+${sleutel}:`, 'm'), `preferences.ts: ${sleutel}`);
  }
  assert.deepEqual(Object.keys(STANDAARD).sort(), [...LAYOUT_SLEUTELS].sort());
});

test('serialiseren neemt alleen geldige indelingsvelden, als kopie', () => {
  const voorkeuren = {
    ...STANDAARD,
    theme: 'dark',
    uiScale: 125,
    leftPanelCollapsed: true,
    leftPanelWidth: 340,
    paletteLeftOrder: ['tool', 'symbols'],
    ext_meter_visible: true,
    ext_meter_mode: 'float',
    ext_meter_floatX: 12,
    ext_meter_kleur: 'rood',
  };
  const layout = leesLayout(voorkeuren);
  assert.equal(layout.theme, undefined);
  assert.equal(layout.uiScale, undefined, 'de interfacegrootte hoort niet bij een werkruimte');
  assert.equal(layout.ext_meter_kleur, undefined);
  assert.equal(layout.leftPanelCollapsed, true);
  assert.equal(layout.leftPanelWidth, 340);
  assert.equal(layout.ext_meter_mode, 'float');
  assert.deepEqual(layout.paletteLeftOrder, ['tool', 'symbols']);
  layout.paletteLeftOrder.push('x');
  assert.deepEqual(voorkeuren.paletteLeftOrder, ['tool', 'symbols'], 'geen gedeelde array');
  // Rondgang via JSON (zo staat het in het voorkeurenbestand).
  assert.deepEqual(normaliseerLayout(JSON.parse(JSON.stringify(leesLayout(voorkeuren)))), leesLayout(voorkeuren));
});

test('beschadigde of vreemde waarden vallen weg', () => {
  const uit = normaliseerLayout({
    ribbonCollapsed: 'ja',
    leftPanelWidth: 50,
    leftPanelTab: '<script>',
    toolPaletteMode: 'zijwaarts',
    toolPaletteFloatX: Infinity,
    symbolPaletteFloatY: '12',
    paletteRightOrder: ['ok', 3],
    ext__visible: true,
    propertiesPanelCollapsed: true,
  });
  assert.deepEqual(uit, { propertiesPanelCollapsed: true });
  for (const ruw of [null, undefined, 3, 'tekst', [], [1, 2]]) assert.deepEqual(normaliseerLayout(ruw), {});
  assert.equal(normaliseerLayout({ leftPanelWidth: null }).leftPanelWidth, null);
  assert.ok(isLayoutSleutel('ext_my.plugin-1_floatY'));
  assert.ok(!isLayoutSleutel('workspaces'));
});

test('herstellen geeft alleen wat verandert; ontbrekende vaste sleutels worden standaard', () => {
  const huidig = { ...STANDAARD, toolPaletteVisible: false, leftPanelCollapsed: true, ext_meter_visible: true };
  // Een werkruimte van vóór propertiesPanelCollapsed bestond.
  const oud = { toolPaletteVisible: true, leftPanelCollapsed: true, ribbonCollapsed: true };
  const wijzig = layoutWijzigingen({ ...huidig, propertiesPanelCollapsed: true }, oud, STANDAARD);
  assert.deepEqual(wijzig, { toolPaletteVisible: true, ribbonCollapsed: true, propertiesPanelCollapsed: false });
  assert.equal('ext_meter_visible' in wijzig, false, 'een extensie die de werkruimte niet noemt blijft staan');
  assert.deepEqual(layoutWijzigingen(huidig, { ext_meter_visible: false }, STANDAARD).ext_meter_visible, false);
  // Niets te doen als de indeling al zo is.
  assert.deepEqual(layoutWijzigingen(huidig, leesLayout(huidig), STANDAARD), {});
  // Arrays worden gekopieerd en vergeleken op inhoud.
  const metVolgorde = layoutWijzigingen({ ...STANDAARD, paletteLeftOrder: ['a'] }, { paletteLeftOrder: ['a'] }, STANDAARD);
  assert.equal('paletteLeftOrder' in metVolgorde, false);
  const doel = { paletteRightOrder: ['symbols'] };
  const w = layoutWijzigingen(STANDAARD, doel, STANDAARD);
  w.paletteRightOrder.push('x');
  assert.deepEqual(doel.paletteRightOrder, ['symbols']);
});

test('naar de standaardindeling: alles terug, de extensies ongemoeid', () => {
  const huidig = { ...STANDAARD, ribbonCollapsed: true, leftPanelWidth: 420, symbolPaletteMode: 'float', ext_x_visible: true };
  const wijzig = layoutWijzigingen(huidig, leesLayout(STANDAARD), STANDAARD);
  assert.deepEqual(wijzig, { ribbonCollapsed: false, leftPanelWidth: null, symbolPaletteMode: 'docked-right' });
});

test('zelfde indeling negeert sleutelvolgorde en onbekende velden', () => {
  assert.ok(zelfdeLayout({ a: 1, ribbonCollapsed: true, leftPanelTab: 'tags' }, { leftPanelTab: 'tags', ribbonCollapsed: true }));
  assert.ok(!zelfdeLayout({ ribbonCollapsed: true }, { ribbonCollapsed: false }));
  assert.ok(!zelfdeLayout({ paletteLeftOrder: ['a', 'b'] }, { paletteLeftOrder: ['b', 'a'] }));
});

test('namen: opgeschoond, ingekort, leeg is onbruikbaar', () => {
  assert.equal(normaliseerNaam('  Meten \n  en\ttekenen  '), 'Meten en tekenen');
  assert.equal(normaliseerNaam('a\u0000b'), 'ab');
  assert.equal(normaliseerNaam('x'.repeat(200)).length, MAX_NAAM_LENGTE);
  for (const n of ['', '   ', null, 3, {}]) assert.equal(normaliseerNaam(n), '');
});

test('werkruimte bewaren, overschrijven, zoeken en verwijderen', () => {
  let lijst = [];
  let r = bewaarWerkruimte(lijst, 'Meten', { leftPanelCollapsed: true, theme: 'dark' });
  assert.deepEqual(r, { lijst: [{ naam: 'Meten', layout: { leftPanelCollapsed: true } }], naam: 'Meten' });
  lijst = r.lijst;
  lijst = bewaarWerkruimte(lijst, 'Lezen', { ribbonCollapsed: true }).lijst;
  // Zelfde naam (andere hoofdletters): overschrijft op dezelfde plek.
  r = bewaarWerkruimte(lijst, ' meten ', { leftPanelCollapsed: false });
  assert.deepEqual(r.lijst.map(w => w.naam), ['meten', 'Lezen']);
  assert.equal(r.lijst[0].layout.leftPanelCollapsed, false);
  lijst = r.lijst;
  assert.equal(vindWerkruimte(lijst, 'LEZEN').naam, 'Lezen');
  assert.equal(vindWerkruimte(lijst, 'onbekend'), null);
  assert.equal(vindWerkruimte(lijst, '  '), null);
  assert.equal(bewaarWerkruimte(lijst, '   ', {}), null);
  assert.deepEqual(verwijderWerkruimte(lijst, 'Meten').map(w => w.naam), ['Lezen']);
  assert.deepEqual(verwijderWerkruimte(lijst, 'bestaat-niet').map(w => w.naam), ['meten', 'Lezen']);
});

test('de lijst heeft een grens; overschrijven mag ook als hij vol is', () => {
  let lijst = [];
  for (let i = 0; i < MAX_WERKRUIMTEN; i++) lijst = bewaarWerkruimte(lijst, `W${i}`, {}).lijst;
  assert.equal(lijst.length, MAX_WERKRUIMTEN);
  assert.equal(bewaarWerkruimte(lijst, 'nog een', {}), null);
  assert.ok(bewaarWerkruimte(lijst, 'w3', { ribbonCollapsed: true }));
});

test('een beschadigde opgeslagen lijst wordt opgeschoond', () => {
  const ruw = [
    { naam: 'A', layout: { ribbonCollapsed: true, rommel: 1 } },
    { naam: 'a', layout: {} },
    { naam: '', layout: {} },
    null,
    'tekst',
    { naam: 'B' },
  ];
  assert.deepEqual(normaliseerWerkruimten(ruw), [
    { naam: 'A', layout: { ribbonCollapsed: true } },
    { naam: 'B', layout: {} },
  ]);
  for (const r of [null, undefined, {}, 'x']) assert.deepEqual(normaliseerWerkruimten(r), []);
});

test('bewaarde breedte van het linkerpaneel blijft binnen het venster', () => {
  assert.equal(begrensdeBreedte(null, 1920), null);
  assert.equal(begrensdeBreedte('300', 1920), null);
  assert.equal(begrensdeBreedte(340.4, 1920), 340);
  assert.equal(begrensdeBreedte(40, 1920), 120);
  // Een breed paneel uit een grotere monitor past in een kleiner venster.
  assert.equal(begrensdeBreedte(1500, 1000), 600);
});

// Bedrading: zonder de app te starten nagaan dat de panelen hun stand bewaren
// en bij de opstart terugzetten.
test('panelen bewaren hun stand en de opstart zet hem terug', () => {
  const links = lees('../solid/stores/leftPanelStore.js');
  assert.match(links, /bewaarLayoutVoorkeur\('leftPanelTab'/);
  assert.match(links, /bewaarLayoutVoorkeur\('leftPanelCollapsed'/);
  const setup = lees('../ui/setup.js');
  assert.match(setup, /bewaarLayoutVoorkeur\('leftPanelWidth'/);
  const eigenschappen = lees('../solid/stores/propertiesStore.js');
  assert.match(eigenschappen, /bewaarLayoutVoorkeur\('propertiesPanelCollapsed'/);
  const init = lees('../ui/panels/properties-panel.js');
  assert.match(init, /herstelPanelCollapsed\(state\.preferences\?\.propertiesPanelCollapsed === true\)/);
  const main = lees('../main.js');
  assert.match(main, /herstelLinkerPaneel\(\)/);
  const lint = lees('../solid/components/ribbon/Ribbon.jsx');
  assert.match(lint, /state\.preferences\.ribbonCollapsed = !ribbonCollapsed\(\);\s*savePreferences\(\);/);
});

test('standaardwaarden in de voorkeuren wissen de werkruimten niet', () => {
  const dialoog = lees('../solid/components/preferences/PreferencesDialog.jsx');
  assert.match(dialoog, /if \(key === 'workspaces'\) continue;/);
  assert.match(dialoog, /pasHuidigeLayoutToe\(\)/);
});

test('het werkruimtemenu staat op het tabblad Beeld en elke taal heeft de teksten', () => {
  assert.match(lees('../solid/components/ribbon/ViewTab.jsx'), /<WorkspaceMenu \/>/);
  assert.match(lees('../solid/components/DialogHost.jsx'), /'workspaces': WorkspaceDialog/);
  const locales = new URL('../i18n/locales/', import.meta.url);
  const en = JSON.parse(readFileSync(new URL('en/ribbon.json', locales), 'utf8')).workspace;
  for (const taal of readdirSync(locales)) {
    const w = JSON.parse(readFileSync(new URL(`${taal}/ribbon.json`, locales), 'utf8')).workspace;
    assert.deepEqual(Object.keys(w).sort(), Object.keys(en).sort(), taal);
  }
  const nl = JSON.parse(readFileSync(new URL('nl/ribbon.json', locales), 'utf8')).workspace;
  assert.equal(nl.button, 'Werkruimte');
  assert.equal(en.button, 'Workspace');
});
