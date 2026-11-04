// De systeemtype-registry (#567): elke bevestigde wijziging gaat door één
// commit — bibliotheekrevisie +1, preferences opslaan, hertekenen en precies
// één melding. Geen melding bij lezen, migreren, afwijzen of een uitkomst
// zonder wijziging.
//
// Echte state-store; preferences.js en rendering.js zijn stubs die hun
// aanroepen tellen in globalThis.__stubCalls (zie ../core/app-test-hooks.mjs).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.ts');
await import('../core/preferences.js');
await import('./rendering.js');
// De commit ververst het eigenschappenpaneel via een luie import; vooraf
// laden houdt de tellers voorspelbaar (geen koude import midden in een test).
await import('../solid/stores/propertiesStore.js');
const reg = await import('./systeem-typen-registry.js');
const { createDefaultSysteemTypen, findSysteemType } = await import('./systeem-typen.js');

const EXT = { kind: 'extension', extensionId: 'test.synthetisch' };
const DEF = { naam: 'Mineraalplaat', categorie: 'plafond', layout: 'raster', celXMm: 600, celYMm: 600 };
const ID = 'ext:test.synthetisch#mineraal';

const tellers = () => globalThis.__stubCalls || {};
const opgeslagen = () => tellers().savePreferences || 0;
const hertekend = () => (tellers().redrawAnnotations || 0) + (tellers().redrawContinuous || 0);
const kloon = (x) => JSON.parse(JSON.stringify(x));

async function wachtTot(voorwaarde) {
  for (let i = 0; i < 400; i++) {
    if (voorwaarde()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
}
const rust = () => new Promise((r) => setTimeout(r, 30));

function luister() {
  const events = [];
  const stop = reg.onSysteemTypenGewijzigd((e) => events.push(e));
  return { events, stop };
}

beforeEach(() => {
  state.preferences.systeemTypen = createDefaultSysteemTypen();
  globalThis.__stubCalls = {};
});

test('lezen met migratie: geen opslag, geen melding, wel genormaliseerd', async () => {
  state.preferences.systeemTypen = { version: 1, typen: [{ id: 'st-a', naam: 'A', celXMm: 600, celYMm: 600, rommel: 1 }] };
  const { events, stop } = luister();
  const d = reg.getSysteemTypenData();
  assert.equal(d.version, 2);
  assert.equal('rommel' in d.typen[0], false);
  assert.equal(reg.getSysteemTypenData(), d, 'tweede keer dezelfde referentie');
  assert.equal(reg.getSysteemTypeById('st-a').revisie, 1);
  await rust();
  stop();
  assert.equal(events.length, 0);
  assert.equal(opgeslagen(), 0);
  // Zonder bibliotheek: de standaardtypen.
  state.preferences.systeemTypen = undefined;
  assert.ok(reg.getSysteemTypeById('st-plafond-600x600'));
});

test('registreren: commit met revisie, opslaan, hertekenen en precies één melding', async () => {
  const { events, stop } = luister();
  const voor = reg.getSysteemTypenData().revisie;
  const r = reg.registreerSysteemType(EXT, 'mineraal', DEF);
  assert.equal(r.status, 'created');
  assert.equal(r.type.id, ID);
  assert.equal(r.type.owner.kind, 'extension');
  assert.equal(reg.getSysteemTypenData().revisie, voor + 1);
  assert.equal(events.length, 1, 'synchroon gemeld');
  assert.deepEqual(Object.keys(events[0]).sort(), ['changes', 'libraryRevision', 'source', 'sourceExtensionId']);
  assert.equal(events[0].libraryRevision, voor + 1);
  assert.equal(events[0].source, 'extension');
  assert.equal(events[0].sourceExtensionId, 'test.synthetisch');
  assert.equal(events[0].changes.length, 1);
  const c = events[0].changes[0];
  assert.equal(c.id, ID);
  assert.equal(c.change, 'added');
  assert.equal(c.revision, 1);
  assert.equal(c.previousRevision, null);
  assert.equal(c.type.id, ID);
  assert.equal(c.type.revision, 1);
  assert.ok(await wachtTot(() => opgeslagen() === 1), 'savePreferences aangeroepen');
  assert.ok(await wachtTot(() => hertekend() === 1), 'hertekend');
  stop();
});

test('geen melding en geen opslag bij unchanged, kept-user-edit en een afwijzing', async () => {
  reg.registreerSysteemType(EXT, 'mineraal', DEF);
  reg.updateSysteemType(ID, { celXMm: 650 }); // gebruikersbewerking via het paneel
  // De twee setup-commits gebruiken asynchrone imports. Onder CI-belasting
  // kunnen ze na 30 ms nog lopen; wis hun tellers pas na beide bijwerkingen.
  assert.ok(await wachtTot(() => opgeslagen() === 2 && hertekend() === 2), 'setup-commits afgerond');
  globalThis.__stubCalls = {};
  const revisie = reg.getSysteemTypenData().revisie;
  const { events, stop } = luister();
  assert.equal(reg.registreerSysteemType(EXT, 'mineraal', { ...DEF, celXMm: 650 }).status, 'unchanged');
  const k = reg.registreerSysteemType(EXT, 'mineraal', { ...DEF, celYMm: 1200 });
  assert.equal(k.status, 'kept-user-edit');
  assert.equal(k.type.definition.celXMm, 650);
  assert.throws(() => reg.registreerSysteemType(EXT, 'mineraal', { ...DEF, prijs: 3 }), { code: 'unknown-field' });
  assert.throws(() => reg.werkEigenSysteemTypeBij(EXT, ID, { celXMm: 700 }, { expectedRevision: 1 }), { code: 'stale-revision' });
  await rust();
  stop();
  assert.equal(events.length, 0);
  assert.equal(opgeslagen(), 0);
  assert.equal(hertekend(), 0);
  assert.equal(reg.getSysteemTypenData().revisie, revisie);
});

test('paneelbewerking via updateSysteemType: eigendomstype wordt bewerkt, bron properties-panel', () => {
  reg.registreerSysteemType(EXT, 'mineraal', DEF);
  const { events, stop } = luister();
  reg.updateSysteemType(ID, { celXMm: 650 });
  reg.updateSysteemType(ID, { celXMm: 650 }); // zelfde waarde: niets
  stop();
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'properties-panel');
  assert.equal('sourceExtensionId' in events[0], false);
  assert.deepEqual(
    [events[0].changes[0].change, events[0].changes[0].revision, events[0].changes[0].previousRevision],
    ['updated', 2, 1]);
  assert.equal(events[0].changes[0].type.userEdited, true);
  assert.equal(reg.systeemTypeSnapshot(ID).userEdited, true);
});

test('ensureSysteemType: een nieuw id meldt document, een bestaand id niets; de grafsteen vervalt', () => {
  const { events, stop } = luister();
  reg.ensureSysteemType({ id: 'st-uit-pdf', naam: 'Uit PDF', celXMm: 450, celYMm: 450 });
  reg.ensureSysteemType({ id: 'st-uit-pdf', naam: 'Anders', celXMm: 999, celYMm: 999 });
  reg.ensureSysteemType({ id: 'st-plafond-600x600', naam: 'Anders', celXMm: 999, celYMm: 999 });
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'document');
  assert.equal(events[0].changes[0].change, 'added');
  assert.equal(reg.getSysteemTypeById('st-uit-pdf').celXMm, 450);
  assert.equal(reg.getSysteemTypeById('st-plafond-600x600').celXMm, 600);
  // Grafsteen: de gebruiker verwijderde het type; een PDF brengt het terug.
  const d = reg.getSysteemTypenData();
  reg.commitSysteemTypen({ ...kloon(d), verwijderd: [{ id: ID, revisie: 1 }] }, [], 'editor');
  reg.ensureSysteemType({ id: ID, naam: 'Uit PDF', celXMm: 600, celYMm: 600, revisie: 1, eigenaarRevisie: 1 });
  assert.ok(reg.getSysteemTypeById(ID));
  assert.deepEqual(kloon(reg.getSysteemTypenData().verwijderd), [], 'de store geeft een proxy: vergelijk de inhoud');
  stop();
});

test('listeners zijn geïsoleerd en af te melden', () => {
  const ontvangen = [];
  const waarschuwingen = [];
  const oud = console.warn;
  console.warn = (...a) => waarschuwingen.push(a);
  try {
    const stop1 = reg.onSysteemTypenGewijzigd(() => { throw new Error('kapot'); });
    const stop2 = reg.onSysteemTypenGewijzigd((e) => ontvangen.push(e));
    reg.registreerSysteemType(EXT, 'mineraal', DEF);
    assert.equal(ontvangen.length, 1, 'de tweede listener krijgt de melding toch');
    assert.ok(waarschuwingen.length >= 1);
    stop1();
    stop2();
    reg.registreerSysteemType(EXT, 'tweede', DEF);
    assert.equal(ontvangen.length, 1, 'na afmelden niets meer');
  } finally {
    console.warn = oud;
  }
  assert.throws(() => reg.onSysteemTypenGewijzigd('geen functie'), TypeError);
});

test('een listener die zelf commit: elke listener krijgt de meldingen in volgorde', () => {
  const volgorde = [];
  let eerste = true;
  const stop1 = reg.onSysteemTypenGewijzigd((e) => {
    volgorde.push(['L1', e.libraryRevision, e.changes[0].id]);
    if (eerste) {
      eerste = false;
      // De geneste commit is meteen doorgevoerd; alleen de melding wacht.
      const r = reg.registreerSysteemType(EXT, 'tweede', DEF);
      assert.equal(r.status, 'created');
      assert.ok(reg.getSysteemTypeById('ext:test.synthetisch#tweede'));
    }
  });
  const stop2 = reg.onSysteemTypenGewijzigd((e) => volgorde.push(['L2', e.libraryRevision, e.changes[0].id]));
  const r0 = reg.getSysteemTypenData().revisie;
  reg.registreerSysteemType(EXT, 'mineraal', DEF);
  stop1();
  stop2();
  const tweede = 'ext:test.synthetisch#tweede';
  assert.deepEqual(volgorde, [
    ['L1', r0 + 1, ID], ['L2', r0 + 1, ID],
    ['L1', r0 + 2, tweede], ['L2', r0 + 2, tweede],
  ], 'geen listener ziet revisie 2 vóór revisie 1');
  // Na afloop is de wachtrij leeg: een volgende commit meldt gewoon.
  const late = luister();
  reg.registreerSysteemType(EXT, 'derde', DEF);
  late.stop();
  assert.equal(late.events.length, 1);
});

test('een commit ververst het paneel alleen bij één geselecteerd systeem, zonder selectiemelding', async () => {
  const props = await import('../solid/stores/propertiesStore.js');
  const selectie = await import('../plugins/selection-listener-registry.js');
  const box = { id: 'b1', type: 'box', page: 1, color: '#ff0000', x: 0, y: 0, width: 10, height: 10 };
  const sg = {
    id: 's1', type: 'systeemraster', page: 1, systeemTypeId: 'st-plafond-600x600',
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
  };
  const meldingen = [];
  const luisteraar = (a) => meldingen.push(a ? a.id : null);
  selectie.registerSelectionListener('systeemraster', luisteraar);
  try {
    // Meervoudige selectie: een commit (hier een extensie) laat het paneel staan.
    props.storeShowMultiSelection([box, sg]);
    meldingen.length = 0;
    reg.registreerSysteemType(EXT, 'mineraal', DEF);
    await rust();
    assert.equal(props.annotProps.multiCount, 2, 'de meervoudige selectie blijft');
    assert.equal(props.getCurrentAnnotation(), null);
    assert.deepEqual(meldingen, [], 'geen selectiemelding');
    // Eén systeem geselecteerd: alleen de typevelden worden ververst.
    props.storeShowProperties(sg);
    assert.equal(props.annotProps.plaatBreedteMm, 600);
    meldingen.length = 0;
    reg.updateSysteemType('st-plafond-600x600', { celXMm: 625 });
    assert.ok(await wachtTot(() => props.annotProps.plaatBreedteMm === 625), 'typemaat ververst');
    assert.equal(props.getCurrentAnnotation(), sg);
    assert.equal(props.annotProps.multiCount, 0);
    assert.deepEqual(meldingen, [], 'geen selectiemelding bij verversen');
    // Een ander type dan het geselecteerde systeem verandert niets aan het paneel.
    props.storeShowProperties(box);
    meldingen.length = 0;
    reg.updateSysteemType('st-plafond-600x600', { celXMm: 650 });
    await rust();
    assert.equal(props.getCurrentAnnotation(), box);
    assert.deepEqual(meldingen, []);
  } finally {
    selectie.unregisterSelectionListener('systeemraster', luisteraar);
    props.storeHideProperties();
  }
});

test('commit door de editor: bron editor, een event per commit met alle wijzigingen', () => {
  const { events, stop } = luister();
  const d = kloon(reg.getSysteemTypenData());
  findSysteemType(d, 'st-plafond-600x600').celXMm = 625;
  findSysteemType(d, 'st-plafond-600x600').revisie = 2;
  d.typen = d.typen.filter(t => t.id !== 'st-bandraster-300x1200');
  reg.commitSysteemTypen(d, [
    { id: 'st-plafond-600x600', change: 'updated', revision: 2, previousRevision: 1 },
    { id: 'st-bandraster-300x1200', change: 'removed', revision: null, previousRevision: 1 },
  ], 'editor');
  stop();
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'editor');
  assert.equal(events[0].changes[0].type.definition.celXMm, 625);
  assert.equal(events[0].changes[1].type, null);
  assert.equal(reg.getSysteemTypeById('st-bandraster-300x1200'), null);
});

test('melding draagt losgekoppelde snapshots', () => {
  const { events, stop } = luister();
  reg.registreerSysteemType(EXT, 'mineraal', DEF);
  stop();
  events[0].changes[0].type.definition.celXMm = 1;
  assert.equal(reg.getSysteemTypeById(ID).celXMm, 600);
});

test('tool-selectie is runtime-state en wordt niet bewaard', () => {
  reg.zetToolSysteemType(null);
  assert.equal(reg.getToolSysteemTypeId(), null);
  reg.zetToolSysteemType('st-plafond-600x1200');
  assert.equal(reg.getToolSysteemTypeId(), 'st-plafond-600x1200');
  assert.equal(JSON.stringify(state.preferences).includes('toolSysteemTypeId'), false);
  reg.zetToolSysteemType(null);
});

test('tool-selectie: alleen de activering die de keuze start, houdt het type', () => {
  const T = 'st-plafond-600x1200';
  // De keuze overleeft precies één activering (die van selectSystemTypeForTool).
  assert.equal(reg.kiesToolSysteemType(T, () => reg.toolSysteemGeactiveerd()), true);
  assert.equal(reg.getToolSysteemTypeId(), T);
  // Opnieuw activeren (lint, bibliotheek, app_set_tool): terug naar de standaard.
  reg.toolSysteemGeactiveerd();
  assert.equal(reg.getToolSysteemTypeId(), null);
  // Een wissel naar een ander gereedschap: ook terug naar de standaard.
  reg.kiesToolSysteemType(T, () => reg.toolSysteemGeactiveerd());
  reg.toolSysteemGedeactiveerd();
  assert.equal(reg.getToolSysteemTypeId(), null);
  // Activeert de tool niet, dan blijft er geen claim hangen.
  assert.equal(reg.kiesToolSysteemType(T, () => {}), false);
  assert.equal(reg.getToolSysteemTypeId(), null);
  reg.toolSysteemGeactiveerd();
  assert.equal(reg.getToolSysteemTypeId(), null, 'een latere native activering krijgt de standaard');
  // Wissen bij het opruimen van een extensie: alleen haar eigen keuze.
  reg.kiesToolSysteemType(ID, () => reg.toolSysteemGeactiveerd());
  reg.wisToolSysteemTypeVanExtensie('test.ander');
  assert.equal(reg.getToolSysteemTypeId(), ID);
  reg.wisToolSysteemTypeVanExtensie('test.synthetisch');
  assert.equal(reg.getToolSysteemTypeId(), null);
});

test('geladen-markering per extensie: actief tussen activatie en opruimen', () => {
  assert.equal(reg.isExtensieGeladen('test.geladen'), false);
  const los1 = reg.meldExtensieActief('test.geladen');
  const los2 = reg.meldExtensieActief('test.geladen');
  assert.equal(reg.isExtensieGeladen('test.geladen'), true);
  los1();
  los1(); // twee keer loslaten telt één keer
  assert.equal(reg.isExtensieGeladen('test.geladen'), true);
  los2();
  assert.equal(reg.isExtensieGeladen('test.geladen'), false);
});
