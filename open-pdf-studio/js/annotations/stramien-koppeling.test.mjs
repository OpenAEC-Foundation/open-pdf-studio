// Stramienkoppeling: de uiteinden van evenwijdige stramienlijnen liggen op één
// lijn en schuiven samen mee. Alles hier is puur rekenwerk op annotaties —
// geen draaiende app nodig.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  STRAMIEN_KOPPEL_PARAMS,
  isStramien, stramienAs, verlengUiteinde, uiteindeVanGreep, uiteindeVerschuiving,
  koppelingVan, zetKoppeling, groepsleden, herkenUitgelijnd,
  startMeeslepen, sleepMee, meesleepWijzigingen,
  planKoppeling, pasKoppelingToe, slotStatus, koppelingOverzicht,
  dichtstbijzijndUiteinde, bewaarKoppeling, nieuwGroepsId,
} from './stramien-koppeling.js';

const bijna = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const punt = (p, x, y, tol = 1e-6) => { bijna(p.x, x, tol); bijna(p.y, y, tol); };
const kloon = (a) => JSON.parse(JSON.stringify(a));

let volgnummer = 0;
function stramien({ id, x, y, width, height, rotation = 0, page = 1, params = {}, ...rest }) {
  volgnummer += 1;
  return {
    id: id || `s${volgnummer}`,
    type: 'parametricSymbol', symbolId: 'stramien', page,
    x, y, width, height, rotation,
    params: { label: '1', orientation: 'verticaal', bollen: 'begin', dashed: true, ...params },
    ...rest,
  };
}

/** Verticale stramienlijn met hartlijn op x = cx, van yBoven tot yOnder (bol boven). */
const verticaal = (id, cx, yBoven, yOnder, params = {}, extra = {}) =>
  stramien({ id, x: cx - 10, y: yBoven, width: 20, height: yOnder - yBoven, params, ...extra });

/** Horizontale stramienlijn met hartlijn op y = cy, van xLinks tot xRechts (bol links). */
const horizontaal = (id, cy, xLinks, xRechts, params = {}, extra = {}) =>
  stramien({ id, x: xLinks, y: cy - 10, width: xRechts - xLinks, height: 20,
    params: { orientation: 'horizontaal', ...params }, ...extra });

// ── Geometrie ──────────────────────────────────────────────────────────────

test('een verticale stramienlijn begint boven (bij de bol) en eindigt onder', () => {
  const a = stramienAs(verticaal('A', 100, 50, 450));
  punt(a.begin, 100, 50);
  punt(a.einde, 100, 450);
  punt(a.richting, 0, 1);
  bijna(a.lengte, 400);
  bijna(a.dwars, 20);
});

test('een horizontale stramienlijn begint links en eindigt rechts', () => {
  const a = stramienAs(horizontaal('1', 200, 30, 630));
  punt(a.begin, 30, 200);
  punt(a.einde, 630, 200);
  punt(a.richting, 1, 0);
  bijna(a.lengte, 600);
});

test('een gedraaide stramienlijn draait zijn uiteinden om het midden', () => {
  // Verticaal, 90 graden gedraaid: de lokale as (0,1) wijst naar (-1,0).
  const a = stramienAs(verticaal('A', 100, 50, 450, {}, { rotation: 90 }));
  punt(a.begin, 300, 250);
  punt(a.einde, -100, 250);
});

test('verlengen verschuift alleen het gevraagde uiteinde, langs de eigen lijn', () => {
  const s = verticaal('A', 100, 50, 450);
  verlengUiteinde(s, 'begin', 30);
  const a = stramienAs(s);
  punt(a.begin, 100, 20);
  punt(a.einde, 100, 450);
  bijna(s.width, 20, 1e-9);

  verlengUiteinde(s, 'einde', -50);
  const b = stramienAs(s);
  punt(b.begin, 100, 20);
  punt(b.einde, 100, 400);
});

test('verlengen van een schuine lijn houdt het andere uiteinde op zijn plaats', () => {
  const s = verticaal('A', 100, 50, 450, {}, { rotation: 30 });
  const voor = stramienAs(s);
  verlengUiteinde(s, 'begin', 40);
  const na = stramienAs(s);
  punt(na.einde, voor.einde.x, voor.einde.y);
  // Het begin schoof 40 punten verder naar buiten, precies langs de lijn.
  punt(na.begin, voor.begin.x - voor.richting.x * 40, voor.begin.y - voor.richting.y * 40);
  bijna(s.rotation, 30);
});

test('welke greep welk uiteinde verlengt', () => {
  const v = verticaal('A', 100, 50, 450);
  const h = horizontaal('1', 200, 30, 630);
  for (const g of ['t', 'tl', 'tr']) assert.equal(uiteindeVanGreep(v, g), 'begin');
  for (const g of ['b', 'bl', 'br']) assert.equal(uiteindeVanGreep(v, g), 'einde');
  for (const g of ['l', 'r', 'rect_center', 'rotate']) assert.equal(uiteindeVanGreep(v, g), null);
  for (const g of ['l', 'tl', 'bl']) assert.equal(uiteindeVanGreep(h, g), 'begin');
  for (const g of ['r', 'tr', 'br']) assert.equal(uiteindeVanGreep(h, g), 'einde');
  for (const g of ['t', 'b']) assert.equal(uiteindeVanGreep(h, g), null);
  assert.equal(uiteindeVanGreep({ type: 'box' }, 't'), null);
});

test('de verschuiving van een uiteinde telt naar buiten positief', () => {
  const orig = verticaal('A', 100, 50, 450);
  const nieuw = kloon(orig);
  verlengUiteinde(nieuw, 'begin', 25);
  bijna(uiteindeVerschuiving(orig, nieuw, 'begin'), 25);
  bijna(uiteindeVerschuiving(orig, nieuw, 'einde'), 0);
});

// ── Koppelingsgegevens ─────────────────────────────────────────────────────

test('de koppeling staat per uiteinde in de parameters van het symbool', () => {
  assert.deepEqual(STRAMIEN_KOPPEL_PARAMS, ['koppelBegin', 'koppelEinde', 'losBegin', 'losEinde']);
  const s = verticaal('A', 100, 50, 450);
  assert.deepEqual(koppelingVan(s, 'begin'), { groep: null, los: false });
  zetKoppeling(s, 'begin', { groep: 'g1' });
  zetKoppeling(s, 'einde', { groep: 'g2', los: true });
  assert.deepEqual(koppelingVan(s, 'begin'), { groep: 'g1', los: false });
  assert.deepEqual(koppelingVan(s, 'einde'), { groep: 'g2', los: true });
  assert.equal(s.params.koppelBegin, 'g1');
  assert.equal(s.params.losEinde, true);
  assert.equal(s.params.label, '1', 'de andere parameters blijven staan');
});

test('alleen stramiensymbolen doen mee', () => {
  assert.equal(isStramien(verticaal('A', 1, 1, 100)), true);
  assert.equal(isStramien({ type: 'parametricSymbol', symbolId: 'peilmaat' }), false);
  assert.equal(isStramien({ type: 'line' }), false);
  assert.equal(isStramien(null), false);
});

function rasterMetGroep() {
  const leden = [
    verticaal('A', 100, 50, 450, { koppelBegin: 'gx' }),
    verticaal('B', 250, 50, 450, { koppelBegin: 'gx' }),
    verticaal('C', 400, 50, 450, { koppelBegin: 'gx' }),
  ];
  const dwars = [
    horizontaal('1', 150, 20, 480, { koppelBegin: 'gy' }),
    horizontaal('2', 350, 20, 480, { koppelBegin: 'gy' }),
  ];
  return { leden, dwars, alle: [...leden, ...dwars] };
}

test('groepsleden: zelfde groep, zelfde pagina, niet los, niet zichzelf', () => {
  const { leden, alle } = rasterMetGroep();
  const anderePagina = verticaal('D', 550, 50, 450, { koppelBegin: 'gx' }, { page: 2 });
  const losLid = verticaal('E', 700, 50, 450, { koppelBegin: 'gx', losBegin: true });
  const lijst = [...alle, anderePagina, losLid];
  const ids = groepsleden(lijst, leden[0], 'begin').map(l => `${l.ann.id}:${l.eind}`);
  assert.deepEqual(ids, ['B:begin', 'C:begin']);
  const metLos = groepsleden(lijst, leden[0], 'begin', { ookLos: true }).map(l => l.ann.id);
  assert.deepEqual(metLos, ['B', 'C', 'E']);
  assert.deepEqual(groepsleden(lijst, leden[0], 'einde'), [], 'het einde hoort nergens bij');
});

// ── Meeslepen ──────────────────────────────────────────────────────────────

/** Simuleer de sleep van een greep: de app past eerst de greep toe op de
 *  versleepte lijn, daarna gaan de gekoppelde uiteinden mee. */
function sleep(alle, bron, greep, verlenging) {
  const origBron = kloon(bron);
  const sessie = startMeeslepen(alle, origBron, greep, kloon);
  const eind = uiteindeVanGreep(bron, greep);
  verlengUiteinde(bron, eind, verlenging);
  const d = sessie ? sleepMee(sessie, origBron, bron) : null;
  return { sessie, origBron, d };
}

test('een gekoppeld uiteinde verslepen neemt alle gekoppelde uiteinden evenveel mee', () => {
  const { leden, dwars, alle } = rasterMetGroep();
  const voorDwars = dwars.map(kloon);
  const { sessie, d } = sleep(alle, leden[1], 't', 60);
  assert.ok(sessie);
  bijna(d, 60);
  for (const s of leden) {
    const a = stramienAs(s);
    bijna(a.begin.y, -10);
    bijna(a.einde.y, 450, 1e-9);
  }
  assert.deepEqual(dwars, voorDwars, 'de andere richting doet niet mee');
});

test('een losgezet uiteinde gaat niet mee en kan zelf los verslepen', () => {
  const { leden, alle } = rasterMetGroep();
  zetKoppeling(leden[2], 'begin', { los: true });
  sleep(alle, leden[0], 't', 40);
  bijna(stramienAs(leden[1]).begin.y, 10);
  bijna(stramienAs(leden[2]).begin.y, 50);

  // Het losse uiteinde zelf slepen: er gaat niets mee.
  const { sessie } = sleep(alle, leden[2], 't', 100);
  assert.equal(sessie, null);
  bijna(stramienAs(leden[0]).begin.y, 10);
  bijna(stramienAs(leden[2]).begin.y, -50);
});

test('het niet-gekoppelde uiteinde of het midden verslepen neemt niets mee', () => {
  const { leden, alle } = rasterMetGroep();
  assert.equal(startMeeslepen(alle, leden[0], 'b', kloon), null);
  assert.equal(startMeeslepen(alle, leden[0], 'rect_center', kloon), null);
  assert.equal(startMeeslepen(alle, leden[0], 'rotate', kloon), null);
});

test('elk lid schuift langs zijn EIGEN richting, ook als hij andersom getekend is', () => {
  // B is 180 graden gedraaid: zijn "einde" ligt boven, bij de andere bollen.
  const A = verticaal('A', 100, 50, 450, { koppelBegin: 'g' });
  const B = verticaal('B', 250, 50, 450, { koppelEinde: 'g' }, { rotation: 180 });
  punt(stramienAs(B).einde, 250, 50);
  sleep([A, B], A, 't', 30);
  punt(stramienAs(A).begin, 100, 20);
  punt(stramienAs(B).einde, 250, 20);
  punt(stramienAs(B).begin, 250, 450);
});

test('niet-evenwijdige leden verlengen evenveel langs hun eigen lijn', () => {
  const A = verticaal('A', 100, 50, 450, { koppelBegin: 'g' });
  const B = verticaal('B', 300, 50, 450, { koppelBegin: 'g' }, { rotation: 20 });
  const voorB = stramienAs(B);
  sleep([A, B], A, 't', 25);
  const naB = stramienAs(B);
  bijna(naB.lengte, voorB.lengte + 25);
  punt(naB.einde, voorB.einde.x, voorB.einde.y);
  punt(naB.begin, voorB.begin.x - voorB.richting.x * 25, voorB.begin.y - voorB.richting.y * 25);
});

test('inkorten stopt voor iedereen tegelijk bij de kortste lijn', () => {
  const A = verticaal('A', 100, 50, 450, { koppelBegin: 'g' });
  const B = verticaal('B', 250, 50, 150, { koppelBegin: 'g' }); // 100 lang
  const { d } = sleep([A, B], A, 't', -300);
  assert.ok(d >= -100 && d < -90, `verlenging ${d}`);
  // De bollen blijven op één lijn, ook de versleepte lijn zelf.
  bijna(stramienAs(A).begin.y, stramienAs(B).begin.y);
  assert.ok(stramienAs(B).lengte > 0);
});

test('vergrendelde annotaties en uitgesloten leden blijven staan', () => {
  const { leden, alle } = rasterMetGroep();
  leden[2].locked = true;
  const sessie = startMeeslepen(alle, leden[0], 't', kloon);
  assert.deepEqual(sessie.leden.map(l => l.ann.id), ['B']);
  const zonderB = startMeeslepen(alle, leden[0], 't', kloon, { magMee: a => a.id !== 'B' });
  assert.equal(zonderB, null, 'geen enkel lid over: geen sessie');
});

test('ongedaan maken: één stap met alle gewijzigde lijnen en hun originelen', () => {
  const { leden, alle } = rasterMetGroep();
  const voor = leden.map(kloon);
  const { sessie, origBron } = sleep(alle, leden[0], 't', 45);
  const stap = meesleepWijzigingen(sessie, leden[0], origBron);
  assert.deepEqual(stap.huidig.map(a => a.id), ['A', 'B', 'C']);
  assert.deepEqual(stap.origineel.map(a => a.id), ['A', 'B', 'C']);
  // Terugzetten van de originelen herstelt de hele groep.
  for (let i = 0; i < stap.huidig.length; i++) Object.assign(stap.huidig[i], kloon(stap.origineel[i]));
  assert.deepEqual(leden, voor);
});

test('een sleep die per saldo niets verplaatst, levert alleen de eigen lijn op', () => {
  const { leden, alle } = rasterMetGroep();
  const { sessie, origBron } = sleep(alle, leden[0], 't', 0);
  const stap = meesleepWijzigingen(sessie, leden[0], origBron);
  assert.deepEqual(stap.huidig.map(a => a.id), ['A']);
});

// ── Herkennen, los zetten en weer koppelen ─────────────────────────────────

test('uiteinden die op één lijn liggen worden herkend, binnen een tolerantie', () => {
  const A = verticaal('A', 100, 50, 450);
  const B = verticaal('B', 250, 51.5, 450);
  const C = verticaal('C', 400, 90, 450);          // te ver
  const D = verticaal('D', 550, 50, 450, {}, { page: 2 });
  const E = horizontaal('1', 50, 20, 480);          // andere richting
  const gevonden = herkenUitgelijnd([A, B, C, D, E], A, 'begin').map(l => `${l.ann.id}:${l.eind}`);
  assert.deepEqual(gevonden, ['B:begin']);
  // Onder: de einden liggen ook op één lijn.
  const onder = herkenUitgelijnd([A, B, C, D, E], A, 'einde').map(l => `${l.ann.id}:${l.eind}`);
  assert.deepEqual(onder, ['B:einde', 'C:einde']);
});

test('los zetten houdt de groep vast en zet alleen dit uiteinde los', () => {
  const { leden, alle } = rasterMetGroep();
  const plan = planKoppeling(alle, leden[1], 'begin', false);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.wijzigingen.map(w => w.ann.id), ['B']);
  pasKoppelingToe(plan);
  assert.deepEqual(koppelingVan(leden[1], 'begin'), { groep: 'gx', los: true });
  assert.equal(slotStatus(alle, leden[1], 'begin'), 'open');
  assert.equal(slotStatus(alle, leden[0], 'begin'), 'dicht');
});

test('weer koppelen zet het uiteinde terug op de lijn van de groep', () => {
  const { leden, alle } = rasterMetGroep();
  zetKoppeling(leden[1], 'begin', { los: true });
  verlengUiteinde(leden[1], 'begin', 70);  // los versleept
  const plan = planKoppeling(alle, leden[1], 'begin', true);
  assert.equal(plan.ok, true);
  pasKoppelingToe(plan);
  assert.deepEqual(koppelingVan(leden[1], 'begin'), { groep: 'gx', los: false });
  bijna(stramienAs(leden[1]).begin.y, 50);
  bijna(stramienAs(leden[1]).einde.y, 450);
});

test('koppelen zonder groep maakt er een van de uitgelijnde uiteinden', () => {
  const A = verticaal('A', 100, 50, 450);
  const B = verticaal('B', 250, 51, 450);
  const C = verticaal('C', 400, 50, 450, { losBegin: true, koppelBegin: 'oud' });
  const plan = planKoppeling([A, B, C], A, 'begin', true, { nieuwGroepsId: () => 'nieuw' });
  assert.equal(plan.ok, true);
  pasKoppelingToe(plan);
  assert.deepEqual(koppelingVan(A, 'begin'), { groep: 'nieuw', los: false });
  assert.deepEqual(koppelingVan(B, 'begin'), { groep: 'nieuw', los: false });
  // Een uiteinde dat bewust is losgezet, blijft los.
  assert.deepEqual(koppelingVan(C, 'begin'), { groep: 'oud', los: true });
  // B lag een punt naast de lijn en is erop gezet.
  bijna(stramienAs(B).begin.y, 50);
});

test('koppelen voegt een nieuw uiteinde bij een bestaande groep', () => {
  const { leden, alle } = rasterMetGroep();
  const D = verticaal('D', 550, 50.8, 450);
  const plan = planKoppeling([...alle, D], D, 'begin', true, { nieuwGroepsId: () => 'mag-niet' });
  pasKoppelingToe(plan);
  assert.deepEqual(koppelingVan(D, 'begin'), { groep: 'gx', los: false });
  bijna(stramienAs(D).begin.y, 50);
  // Slepen neemt D nu ook mee.
  sleep([...alle, D], leden[0], 't', 10);
  bijna(stramienAs(D).begin.y, 40);
});

test('koppelen zonder iets om mee te koppelen wordt geweigerd', () => {
  const A = verticaal('A', 100, 50, 450);
  const B = verticaal('B', 250, 200, 450);
  const plan = planKoppeling([A, B], A, 'begin', true);
  assert.equal(plan.ok, false);
  assert.equal(plan.reden, 'geen-uitgelijnde-uiteinden');
  assert.equal(slotStatus([A, B], A, 'begin'), null);
  assert.equal(slotStatus([A, B], A, 'einde'), 'open', 'de einden liggen wel op één lijn');
});

test('los zetten van een uiteinde zonder groep doet niets', () => {
  const A = verticaal('A', 100, 50, 450);
  const plan = planKoppeling([A], A, 'begin', false);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.wijzigingen, []);
});

test('het slotje: dicht, open of weg', () => {
  const { leden, alle } = rasterMetGroep();
  assert.equal(slotStatus(alle, leden[0], 'begin'), 'dicht');
  assert.equal(slotStatus(alle, leden[0], 'einde'), 'open', 'de onderkanten liggen op één lijn');
  const eenzaam = verticaal('Z', 900, 700, 800);
  assert.equal(slotStatus([eenzaam], eenzaam, 'begin'), null);
});

test('het overzicht voor de MCP-kant noemt per uiteinde groep, slot en aantal', () => {
  const { leden, alle } = rasterMetGroep();
  zetKoppeling(leden[2], 'begin', { los: true });
  const o = koppelingOverzicht(alle, leden[0]);
  assert.deepEqual(o.start, { group: 'gx', locked: true, linkedEnds: 1, canLock: true });
  assert.deepEqual(o.end, { group: null, locked: false, linkedEnds: 0, canLock: true });
  const c = koppelingOverzicht(alle, leden[2]);
  assert.equal(c.start.locked, false);
  assert.equal(c.start.group, 'gx');
});

test('het dichtstbijzijnde uiteinde bij een klik', () => {
  const A = verticaal('A', 100, 50, 450);
  assert.equal(dichtstbijzijndUiteinde(A, { x: 100, y: 60 }), 'begin');
  assert.equal(dichtstbijzijndUiteinde(A, { x: 110, y: 400 }), 'einde');
});

test('parameters vervangen via de MCP-brug laat de koppeling staan', () => {
  const oud = { label: 'A', orientation: 'verticaal', koppelBegin: 'gx', losBegin: true };
  assert.deepEqual(
    bewaarKoppeling(oud, { label: 'B', orientation: 'verticaal' }),
    { koppelBegin: 'gx', losBegin: true, label: 'B', orientation: 'verticaal' },
  );
  // Wie de koppeling expliciet meegeeft, krijgt die.
  assert.equal(bewaarKoppeling(oud, { label: 'B', koppelBegin: '' }).koppelBegin, '');
});

test('nieuwe groeps-ids zijn uniek', () => {
  const ids = new Set(Array.from({ length: 50 }, () => nieuwGroepsId()));
  assert.equal(ids.size, 50);
});

// ── Symboolschema en vertalingen ───────────────────────────────────────────

test('het stramiensymbool kent de koppelparameters, verborgen voor het paneel', async () => {
  const { getTemplate, defaultParams } = await import('../symbols/registry.js');
  const tpl = getTemplate('stramien');
  for (const sleutel of STRAMIEN_KOPPEL_PARAMS) {
    const veld = tpl.params.find(p => p.key === sleutel);
    assert.ok(veld, `${sleutel} ontbreekt in het schema`);
    assert.equal(veld.hidden, true, `${sleutel} hoort niet als los veld in het paneel`);
  }
  const d = defaultParams(tpl);
  assert.equal(d.koppelBegin, '');
  assert.equal(d.losBegin, false);
});

test('verborgen parameters worden geen gereedschapsstandaard', () => {
  const bron = readFileSync(new URL('../solid/stores/parametricSymbolStore.js', import.meta.url), 'utf8');
  assert.match(bron, /def\.hidden/);
  const paneel = readFileSync(new URL('../solid/components/properties-panel/ParametricSymbolSection.jsx', import.meta.url), 'utf8');
  assert.match(paneel, /!p\.hidden/);
});

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
const leesJson = (pad) => JSON.parse(lees(pad));

test('de vertaalsleutels bestaan in het Engels en het Nederlands', () => {
  for (const taal of ['en', 'nl']) {
    const ctx = leesJson(`../i18n/locales/${taal}/context.json`);
    assert.ok(ctx.annotation.gridEndLock, `${taal} context annotation.gridEndLock`);
    assert.ok(ctx.annotation.gridEndUnlock, `${taal} context annotation.gridEndUnlock`);
    const props = leesJson(`../i18n/locales/${taal}/properties.json`);
    for (const k of ['gridAlignment', 'gridStartLinked', 'gridEndLinked', 'gridLinkHint']) {
      assert.ok(props.parametricSymbol[k], `${taal} properties parametricSymbol.${k}`);
    }
  }
  const nl = leesJson('../i18n/locales/nl/context.json');
  const en = leesJson('../i18n/locales/en/context.json');
  assert.notEqual(nl.annotation.gridEndLock, en.annotation.gridEndLock, 'nl is vertaald');
});

test('menu, paneel, greep en sleep gebruiken de koppeling', () => {
  const menu = lees('../solid/components/ContextMenu.jsx');
  assert.match(menu, /slotLabelSleutel\(/);
  assert.match(menu, /kind === 'stramien'/);
  const slot = lees('./stramien-slot.js');
  assert.match(slot, /annotation\.gridEndLock/);
  assert.match(slot, /annotation\.gridEndUnlock/);
  const rechtsklik = lees('../ui/chrome/context-menus.js');
  assert.match(rechtsklik, /kind: 'stramien'/);
  const paneel = lees('../solid/components/properties-panel/ParametricSymbolSection.jsx');
  assert.match(paneel, /parametricSymbol\.gridStartLinked/);
  const grepen = lees('./handles.js');
  assert.match(grepen, /stramien_slot_/);
  const kiezen = lees('../tools/tools/select-tool.js');
  assert.match(kiezen, /stramien_slot_/);
  const dispatcher = lees('../tools/tool-dispatcher.js');
  assert.match(dispatcher, /startMeeslepen/);
  assert.match(dispatcher, /meesleepWijzigingen/);
});
