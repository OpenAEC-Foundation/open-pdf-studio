// Gehoste openingen (#1229): het rekenwerk, zonder de app.
//
// Een kozijn hoort bij zijn wand. Deze tests gaan over de regels zelf: waar
// een opening past, waar het kozijn dan staat, en wat er aan de andere kant
// verandert als de wand of het kozijn wijzigt (met de extra stappen die in
// dezelfde ongedaan-stap horen). De stappen worden hier nagespeeld met een
// kleine eigen geschiedenis; hosting-app.test.mjs doet hetzelfde met de echte
// undo-stapel.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  vrijePlek, controleerNieuweOpening, kozijnVak, hartVanSymbool, isKozijnSymbool, gehosteWand,
  hostingNaCommando, hostingLive, herstelHosting, nieuweOpening, lijstMetOpening,
} from './gehoste-opening.js';
import { kozijnProps } from './mcp-plattegrond.js';
import { sparingPlaatsing, normaliseerSparing } from './sparing.js';

const K = 0.5;                                    // paginapunten per mm
const pxPerMmVan = () => K;
const kloon = (x) => JSON.parse(JSON.stringify(x));
const bijna = (a, b, wat, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${wat}: ${a} ≈ ${b}`);

/** Wand van (0, 100) naar (4000 mm verder), 100 mm dik. */
function maakWand(extra = {}) {
  return {
    id: 'W', type: 'wall', page: 1, startX: 0, startY: 100, endX: 2000, endY: 100,
    dikteMm: 100, hatchPattern: 'nen47-metselwerk-kunststeen', ...extra,
  };
}

/** Een kozijn op de wand zetten zoals app_floorplan dat doet. */
function plaats(annotaties, wand, { id, soort = 'deur', afstandMm, breedteMm = 900, zijde = 1, us = false }) {
  const s = normaliseerSparing({ id, soort, dagmaatMm: breedteMm, hartMm: afstandMm });
  s.draaizijde = zijde;
  // Het Amerikaanse plansymbool (#1230): de stijl staat in het symbool.
  if (us) { s.symboolStijl = 'us'; s.kozijn = { deurbladDikteMm: 44.45 }; }
  const props = kozijnProps(wand, sparingPlaatsing(wand, s, K), s, K);
  const key = `key-${id}`;
  props.params.hostKey = key;
  const symbool = { id, type: 'parametricSymbol', page: 1, ...props };
  annotaties.push(symbool);
  wand.openingen = lijstMetOpening(wand, nieuweOpening({ id, key, afstandMm, breedteMm, soort, zijde }));
  return symbool;
}

function opstelling(openingen = [{ id: 'D', afstandMm: 2000 }], wandExtra = {}) {
  const wand = maakWand(wandExtra);
  const annotaties = [wand];
  const kozijnen = openingen.map((o) => plaats(annotaties, wand, o));
  return { wand, annotaties, kozijnen };
}

// ── een kleine geschiedenis, zoals de undo-stapel ───────────────────────

function herstel(annotaties, id, staat) {
  const a = annotaties.find((x) => x.id === id);
  if (!a) return;
  for (const k of Object.keys(a)) if (!(k in staat)) delete a[k];
  Object.assign(a, kloon(staat));
}
function ongedaan(annotaties, cmd) {
  switch (cmd.type) {
    case 'compound': for (const c of [...cmd.commands].reverse()) ongedaan(annotaties, c); break;
    case 'modifyAnnotation': herstel(annotaties, cmd.id, cmd.oldState); break;
    case 'bulkModify': for (const it of cmd.items) herstel(annotaties, it.id, it.oldState); break;
    case 'deleteAnnotation': annotaties.splice(Math.min(cmd.index, annotaties.length), 0, kloon(cmd.annotation)); break;
    case 'bulkDelete':
      for (const it of [...cmd.items].sort((a, b) => a.index - b.index)) annotaties.splice(Math.min(it.index, annotaties.length), 0, kloon(it.annotation));
      break;
    case 'addAnnotation': annotaties.splice(annotaties.findIndex((a) => a.id === cmd.annotation.id), 1); break;
    default: throw new Error(cmd.type);
  }
}
function opnieuw(annotaties, cmd) {
  switch (cmd.type) {
    case 'compound': for (const c of cmd.commands) opnieuw(annotaties, c); break;
    case 'modifyAnnotation': herstel(annotaties, cmd.id, cmd.newState); break;
    case 'bulkModify': for (const it of cmd.items) herstel(annotaties, it.id, it.newState); break;
    case 'deleteAnnotation': annotaties.splice(annotaties.findIndex((a) => a.id === cmd.annotation.id), 1); break;
    case 'bulkDelete': for (const it of cmd.items) annotaties.splice(annotaties.findIndex((a) => a.id === it.annotation.id), 1); break;
    default: throw new Error(cmd.type);
  }
}
/** Eén stap: de wijziging is al toegepast; de hosting volgt en alles wordt één stap. */
function stap(annotaties, cmd) {
  const extra = hostingNaCommando(cmd, annotaties, pxPerMmVan);
  return extra.length ? { type: 'compound', commands: [cmd, ...extra] } : cmd;
}
function wijzig(annotaties, id, muteer) {
  const a = annotaties.find((x) => x.id === id);
  const oud = kloon(a);
  muteer(a);
  return stap(annotaties, { type: 'modifyAnnotation', id, oldState: oud, newState: kloon(a) });
}
function verwijder(annotaties, id) {
  const index = annotaties.findIndex((x) => x.id === id);
  const [a] = annotaties.splice(index, 1);
  return stap(annotaties, { type: 'deleteAnnotation', annotation: kloon(a), index });
}
/** Zoals deleteAnnotationsWithUndo: eerst de stap vastleggen, dan pas uit de lijst halen. */
function verwijderNaVastleggen(annotaties, id) {
  const index = annotaties.findIndex((x) => x.id === id);
  const cmd = stap(annotaties, { type: 'deleteAnnotation', annotation: kloon(annotaties[index]), index });
  annotaties.splice(annotaties.findIndex((x) => x.id === id), 1);
  return cmd;
}
const midden = (a) => ({ x: a.x + a.width / 2, y: a.y + a.height / 2 });
/** Het hart van de opening volgens het symbool, langs de wand in mm. */
function langsWandMm(symbool, wand) {
  const hart = hartVanSymbool(symbool, K, wand.dikteMm);
  const len = Math.hypot(wand.endX - wand.startX, wand.endY - wand.startY);
  const u = { x: (wand.endX - wand.startX) / len, y: (wand.endY - wand.startY) / len };
  const dwars = (hart.x - wand.startX) * -u.y + (hart.y - wand.startY) * u.x;
  return { langs: ((hart.x - wand.startX) * u.x + (hart.y - wand.startY) * u.y) / K, dwars };
}

// ── waar past een opening ───────────────────────────────────────────────

test('vrijePlek: binnen de wand en nooit over een andere opening', () => {
  assert.equal(vrijePlek(4000, 900, 2000), 2000);
  assert.equal(vrijePlek(4000, 900, 100), 450, 'stopt aan het begin van de wand');
  assert.equal(vrijePlek(4000, 900, 9000), 3550, 'stopt aan het eind van de wand');
  assert.equal(vrijePlek(800, 900, 400), null, 'breder dan de wand');
  const ander = [{ afstandMm: 2000, breedteMm: 900 }];        // 1550 .. 2450
  assert.equal(vrijePlek(4000, 900, 1500, ander), 1100, 'schuift tot tegen de andere opening');
  assert.equal(vrijePlek(4000, 900, 2100, ander), 2900, 'de dichtstbijzijnde vrije plek aan de andere kant');
  assert.equal(vrijePlek(4000, 900, 1900, ander), 1100);
  // Tussen twee openingen is te weinig ruimte: dan ervoor of erna.
  const twee = [{ afstandMm: 1000, breedteMm: 900 }, { afstandMm: 2200, breedteMm: 900 }];   // 550..1450, 1750..2650
  assert.equal(vrijePlek(4000, 900, 1600, twee), 3100);
  assert.equal(vrijePlek(3000, 900, 1600, twee), null, 'nergens plaats');
});

test('een nieuwe opening: passend, buiten de wand of overlappend', () => {
  const { wand } = opstelling();                                // deur op 2000, 900 breed
  assert.deepEqual(controleerNieuweOpening(wand, { afstandMm: 3200, breedteMm: 900 }, K), { ok: true, afstandMm: 3200 });
  const overlap = controleerNieuweOpening(wand, { afstandMm: 2600, breedteMm: 900 }, K);
  assert.equal(overlap.ok, false);
  assert.equal(overlap.code, 'overlap');
  assert.match(overlap.reden, /overlaps another opening/);
  assert.equal(controleerNieuweOpening(wand, { afstandMm: 3800, breedteMm: 900 }, K).code, 'outside');
  // Een aangewezen punt bij het eind schuift tot de opening past.
  assert.deepEqual(controleerNieuweOpening(wand, { afstandMm: 3800, breedteMm: 900 }, K, { passend: true }), { ok: true, afstandMm: 3550 });
  assert.equal(controleerNieuweOpening(wand, { afstandMm: 2000, breedteMm: 4500 }, K).code, 'outside');
  assert.equal(controleerNieuweOpening(wand, { afstandMm: 2000, breedteMm: 0 }, K).code, 'width');
  assert.equal(controleerNieuweOpening({ ...wand, endX: 0, endY: 100 }, { afstandMm: 0, breedteMm: 900 }, K).code, 'wall');
});

// ── het vak van het kozijn ──────────────────────────────────────────────

test('kozijnVak geeft precies het vak dat app_floorplan plaatst, voor deur en raam, beide kanten', () => {
  for (const wand of [maakWand(), maakWand({ endX: 1200, endY: 1700 }), maakWand({ endX: 0, endY: 2100, dikteMm: 300 })]) {
    for (const soort of ['deur', 'raam']) {
      for (const zijde of [1, -1]) {
        // Het kozijn en het Amerikaanse plansymbool (#1230).
        for (const us of [false, true]) {
          const s = normaliseerSparing({ id: 'x', soort, dagmaatMm: 900, hartMm: 1500 });
          s.draaizijde = zijde;
          if (us) s.symboolStijl = 'us';
          const props = kozijnProps(wand, sparingPlaatsing(wand, s, K), s, K);
          assert.equal(props.params.symboolStijl, us ? 'us' : undefined);
          const vak = kozijnVak(wand, { afstandMm: 1500, breedteMm: 900, zijde }, props.params, K, props.symbolId);
          for (const k of ['x', 'y', 'width', 'height', 'rotation']) bijna(vak[k], props[k], `${soort} zijde ${zijde} us ${us} ${k}`);
          // En terug: het hart van het symbool ligt op de hartlijn, 1500 mm van het begin.
          const { langs, dwars } = langsWandMm({ ...props }, wand);
          bijna(langs, 1500, 'hart langs de wand');
          bijna(dwars, 0, 'hart op de hartlijn');
        }
      }
    }
  }
});

test('gehost is alleen wie aan beide kanten gekoppeld is', () => {
  const { wand, annotaties, kozijnen: [deur] } = opstelling();
  const perId = new Map(annotaties.map((a) => [a.id, a]));
  assert.equal(isKozijnSymbool(deur), true);
  assert.equal(gehosteWand(deur, perId), wand);
  // Een kopie van het kozijn wijst naar de wand, maar staat niet in haar lijst.
  const kopie = { ...kloon(deur), id: 'kopie' };
  assert.equal(gehosteWand(kopie, perId), null);
  // Een kozijn uit een ouder bestand (wand in stukken): een los symbool.
  assert.equal(gehosteWand({ ...kloon(deur), id: 'oud', params: { ...deur.params, hostWallId: 'run:0:0' } }, perId), null);
  assert.equal(gehosteWand(wand, perId), null);
});

// ── het Amerikaanse plansymbool (#1230) ─────────────────────────────────

test('een Amerikaanse deur en raam horen net zo bij hun wand: schuiven, meedraaien, en de stijl blijft', () => {
  // Wand van 6 inch; deur van 36 inch die naar rechts van de wandrichting draait, raam van 48 inch.
  const { wand, annotaties, kozijnen: [deur, raam] } = opstelling(
    [{ id: 'D', afstandMm: 1200, breedteMm: 914.4, zijde: -1, us: true }, { id: 'R', soort: 'raam', afstandMm: 3000, breedteMm: 1219.2, us: true }],
    { dikteMm: 152.4, hatchPattern: 'none' },
  );
  assert.deepEqual([deur.params.symboolStijl, raam.params.symboolStijl], ['us', 'us']);
  // Het vak van de deur: de opening breed, de wand plus de draaicirkel hoog; het raam: opening x wand.
  bijna(deur.width, 914.4 * K, 'deurvak breed');
  bijna(deur.height, (152.4 + 914.4) * K, 'deurvak hoog');
  bijna(raam.height, 152.4 * K, 'raamvak');
  // De draaicirkel ligt aan de aangewezen kant: rechts van de wandrichting is onder de wand (y groter).
  assert.ok(deur.y + deur.height / 2 > wand.startY, 'de deur draait naar de aangeklikte kant');
  // Het gat is precies de deurbreedte.
  assert.deepEqual(wand.openingen.map((o) => [o.id, o.breedteMm]), [['D', 914.4], ['R', 1219.2]]);

  // Schuiven langs de wand: het gat gaat mee, het symbool blijft Amerikaans.
  const cmd = wijzig(annotaties, 'D', (a) => { a.x += 200 * K; a.y += 77; });
  assert.equal(cmd.type, 'compound');
  bijna(wand.openingen.find((o) => o.id === 'D').afstandMm, 1400, 'het gat schoof 200 mm op');
  bijna(langsWandMm(deur, wand).dwars, 0, 'op de wandlijn');
  assert.equal(deur.params.symboolStijl, 'us');
  assert.equal(deur.params.deurbladDikteMm, 44.45);

  // Tegen het raam aan: de deur stopt ervoor (raam van 2390,4 tot 3609,6).
  wijzig(annotaties, 'D', (a) => { a.x += 2000 * K; });
  bijna(wand.openingen.find((o) => o.id === 'D').afstandMm, 3000 - 609.6 - 457.2, 'tot tegen het raam');

  // De wand een kwartslag draaien: beide symbolen draaien mee en houden hun plaats en stijl.
  const hoek = [deur.rotation, raam.rotation];
  wijzig(annotaties, 'W', (a) => { a.endX = 0; a.endY = 2100; });
  bijna((((deur.rotation - hoek[0]) % 360) + 360) % 360, 90, 'deur draait mee');
  bijna((((raam.rotation - hoek[1]) % 360) + 360) % 360, 90, 'raam draait mee');
  bijna(langsWandMm(raam, wand).langs, 3000, 'het raam houdt zijn afstand');
  bijna(langsWandMm(raam, wand).dwars, 0, 'op de gedraaide wand');
  assert.deepEqual([deur.params.symboolStijl, raam.params.symboolStijl], ['us', 'us']);

  // Een andere breedte (32 inch): het gat volgt.
  wijzig(annotaties, 'D', (a) => { a.params = { ...a.params, width: 812.8 }; });
  assert.equal(wand.openingen.find((o) => o.id === 'D').breedteMm, 812.8);
  bijna(deur.width, 812.8 * K, 'het vak volgt de breedte');

  // Verwijderen sluit de wand, zoals bij elk gehost kozijn.
  verwijder(annotaties, 'D');
  assert.deepEqual(wand.openingen.map((o) => o.id), ['R']);
});

// ── het kozijn verslepen ────────────────────────────────────────────────

test('het kozijn 1 m langs de wand: het gat gaat 1 m mee, in één stap', () => {
  const { wand, annotaties, kozijnen: [deur] } = opstelling();
  const begin = kloon(annotaties);
  const cmd = wijzig(annotaties, 'D', (a) => { a.x += 1000 * K; });
  assert.equal(wand.openingen[0].afstandMm, 3000, 'de opening in de wand schoof 1000 mm op');
  assert.equal(deur.params.hostAfstandMm, 3000);
  bijna(langsWandMm(deur, wand).langs, 3000, 'het kozijn staat op de nieuwe plaats');
  // Eén stap: de wijziging van het kozijn plus die van de wand.
  assert.equal(cmd.type, 'compound');
  assert.deepEqual(cmd.commands.map((c) => [c.type, c.id]), [['modifyAnnotation', 'D'], ['modifyAnnotation', 'W']]);
  ongedaan(annotaties, cmd);
  assert.deepEqual(annotaties, begin, 'ongedaan maken zet kozijn en gat terug');
  opnieuw(annotaties, cmd);
  assert.equal(annotaties[0].openingen[0].afstandMm, 3000);
  bijna(langsWandMm(annotaties[1], annotaties[0]).langs, 3000, 'opnieuw');
});

test('het kozijn van de wand af slepen: het blijft op de wandlijn', () => {
  const { wand, annotaties, kozijnen: [deur] } = opstelling();
  const cmd = wijzig(annotaties, 'D', (a) => { a.x += 300; a.y += 400; });
  const { langs, dwars } = langsWandMm(deur, wand);
  bijna(dwars, 0, 'geen verschuiving dwars op de wand');
  bijna(langs, 2600, 'wel de verschuiving langs de wand (300 pt = 600 mm)');
  assert.equal(wand.openingen[0].afstandMm, 2600);
  // De vastgelegde nieuwe toestand is die op de wand, niet die van de muis.
  bijna(cmd.commands[0].newState.y, deur.y, 'vastgelegd op de wand');
  bijna(midden(cmd.commands[0].newState).x, midden(deur).x, 'vastgelegd op de wand');
});

test('alleen dwars op de wand verschuiven verandert niets', () => {
  const { annotaties } = opstelling();
  const begin = kloon(annotaties);
  const cmd = wijzig(annotaties, 'D', (a) => { a.y -= 250; });
  assert.deepEqual(annotaties, begin);
  assert.equal(cmd.type, 'modifyAnnotation', 'geen extra stap');
  assert.deepEqual(cmd.newState, cmd.oldState, 'de stap is leeg (de app laat hem vallen)');
});

test('het kozijn stopt aan de uiteinden van de wand', () => {
  const { wand, annotaties, kozijnen: [deur] } = opstelling();
  wijzig(annotaties, 'D', (a) => { a.x += 5000; });
  assert.equal(wand.openingen[0].afstandMm, 3550, 'tot het eind: 4000 - 450');
  bijna(langsWandMm(deur, wand).langs, 3550, 'kozijn');
  wijzig(annotaties, 'D', (a) => { a.x -= 9000; });
  assert.equal(wand.openingen[0].afstandMm, 450, 'tot het begin');
});

test('het kozijn schuift niet over een ander kozijn in dezelfde wand', () => {
  const { wand, annotaties } = opstelling([{ id: 'D', afstandMm: 1000 }, { id: 'R', soort: 'raam', afstandMm: 3000 }]);
  // De deur naar 2700 mm slepen zou het raam (2550..3450) raken.
  wijzig(annotaties, 'D', (a) => { a.x += 1700 * K; });
  const deur = wand.openingen.find((o) => o.id === 'D');
  assert.equal(deur.afstandMm, 2100, 'tot tegen het raam: 2550 - 450');
  assert.equal(wand.openingen.find((o) => o.id === 'R').afstandMm, 3000, 'het raam blijft staan');
});

test('een gedraaid of vervormd kozijn krijgt zijn vak op de wand terug', () => {
  const { wand, annotaties, kozijnen: [deur] } = opstelling();
  const vak = kloon({ x: deur.x, y: deur.y, width: deur.width, height: deur.height, rotation: deur.rotation });
  wijzig(annotaties, 'D', (a) => { a.width *= 2; a.height *= 3; });
  bijna(deur.width, vak.width, 'breedte');
  bijna(deur.height, vak.height, 'hoogte');
  assert.equal(wand.openingen[0].breedteMm, 900);
});

test('een andere kozijnmaat: het gat volgt; past ze niet, dan blijft de oude', () => {
  const { wand, annotaties, kozijnen: [deur] } = opstelling();
  const cmd = wijzig(annotaties, 'D', (a) => { a.params = { ...a.params, width: 1200 }; });
  assert.equal(wand.openingen[0].breedteMm, 1200);
  assert.equal(wand.openingen[0].afstandMm, 2000, 'het hart blijft staan');
  assert.equal(deur.params.dagmaatMm, 1200);
  bijna(deur.width, kozijnVak(wand, wand.openingen[0], deur.params, K, 'door').width, 'vak past bij de nieuwe maat');
  assert.equal(cmd.type, 'compound');
  // Breder dan de wand: geweigerd, alles blijft zoals het was.
  wijzig(annotaties, 'D', (a) => { a.params = { ...a.params, width: 9000 }; });
  assert.equal(wand.openingen[0].breedteMm, 1200);
  assert.equal(deur.params.width, 1200);
});

// ── de wand wijzigen ────────────────────────────────────────────────────

test('de wand 500 mm verplaatsen neemt het kozijn 500 mm mee, in één stap', () => {
  const { wand, annotaties, kozijnen: [deur] } = opstelling();
  const begin = kloon(annotaties);
  const voor = midden(deur);
  const cmd = wijzig(annotaties, 'W', (a) => { a.startY += 250; a.endY += 250; });    // 250 pt = 500 mm
  bijna(midden(deur).y - voor.y, 250, 'kozijn 500 mm mee');
  bijna(midden(deur).x - voor.x, 0, 'niet opzij');
  assert.equal(wand.openingen[0].afstandMm, 2000, 'de afstand tot het begin blijft');
  assert.deepEqual(cmd.commands.map((c) => [c.type, c.id]), [['modifyAnnotation', 'W'], ['modifyAnnotation', 'D']]);
  ongedaan(annotaties, cmd);
  assert.deepEqual(annotaties, begin);
});

test('de wand 90 graden draaien draait het kozijn mee', () => {
  const { wand, annotaties, kozijnen: [deur] } = opstelling();
  const hoekVoor = deur.rotation;
  // Om het beginpunt (0, 100): het eind gaat van (2000, 100) naar (0, 2100).
  wijzig(annotaties, 'W', (a) => { a.endX = 0; a.endY = 2100; });
  bijna(((deur.rotation - hoekVoor) % 360 + 360) % 360, 90, 'het kozijn draait 90 graden mee');
  const { langs, dwars } = langsWandMm(deur, wand);
  bijna(langs, 2000, 'zelfde afstand tot het begin');
  bijna(dwars, 0, 'op de hartlijn van de gedraaide wand');
  // Het hart ligt nu op (0, 100 + 1000).
  const hart = hartVanSymbool(deur, K, 100);
  bijna(hart.x, 0, 'hart x');
  bijna(hart.y, 1100, 'hart y');
});

test('de wand korter maken dan de deur staat: de deur schuift terug tot ze past', () => {
  const { wand, annotaties, kozijnen: [deur] } = opstelling([{ id: 'D', afstandMm: 3000 }]);
  const begin = kloon(annotaties);
  const cmd = wijzig(annotaties, 'W', (a) => { a.endX = 1500; });     // 3000 mm lang
  assert.equal(wand.openingen[0].afstandMm, 2550, '3000 - 450');
  bijna(langsWandMm(deur, wand).langs, 2550, 'kozijn');
  assert.equal(deur.params.hostAfstandMm, 2550);
  ongedaan(annotaties, cmd);
  assert.deepEqual(annotaties, begin, 'ongedaan maken zet de deur op 3000 terug');
});

test('het beginpunt verslepen: de afstand tot het (nieuwe) begin blijft', () => {
  const { wand, annotaties, kozijnen: [deur] } = opstelling();
  wijzig(annotaties, 'W', (a) => { a.startX = 400; });                // begin 800 mm opgeschoven
  assert.equal(wand.openingen[0].afstandMm, 2000);
  bijna(hartVanSymbool(deur, K, 100).x, 400 + 1000, 'het kozijn schoof mee met het begin');
});

test('een andere wanddikte: het kozijn wordt net zo diep als de wand', () => {
  const { wand, annotaties, kozijnen: [deur] } = opstelling();
  const cmd = wijzig(annotaties, 'W', (a) => { a.dikteMm = 300; });
  assert.equal(deur.params.wallThickness, 300);
  bijna(langsWandMm(deur, wand).dwars, 0, 'nog steeds op de hartlijn');
  assert.equal(cmd.type, 'compound');
});

test('wand en kozijn samen verplaatsen: het kozijn houdt zijn plaats op de wand', () => {
  const { wand, annotaties, kozijnen: [deur] } = opstelling();
  const oud = [kloon(wand), kloon(deur)];
  // Samen 300 pt opzij en 150 pt omlaag (schuin: het kozijn zou anders langs de wand opschuiven).
  wand.startX += 300; wand.endX += 300; wand.startY += 150; wand.endY += 150;
  deur.x += 300; deur.y += 150;
  const cmd = stap(annotaties, {
    type: 'bulkModify',
    items: [{ id: 'W', oldState: oud[0], newState: kloon(wand) }, { id: 'D', oldState: oud[1], newState: kloon(deur) }],
  });
  assert.equal(wand.openingen[0].afstandMm, 2000, 'de plaats op de wand is niet veranderd');
  bijna(deur.x - oud[1].x, 300, 'x');
  bijna(deur.y - oud[1].y, 150, 'y');
  assert.equal(cmd.type, 'bulkModify', 'geen extra stappen nodig');
});

// ── tijdens het slepen ──────────────────────────────────────────────────

test('tijdens het slepen loopt alles mee, en de stap aan het eind is toch volledig', () => {
  const { wand, annotaties, kozijnen: [deur] } = opstelling();
  const begin = kloon(annotaties);
  const oudDeur = kloon(deur);
  // Drie muisbewegingen: steeds origineel + totale verschuiving, daarna meelopen.
  for (const [dx, dy] of [[100, 40], [300, -80], [500, 200]]) {
    Object.assign(deur, kloon(oudDeur));
    deur.x += dx; deur.y += dy;
    assert.equal(hostingLive([deur], annotaties, pxPerMmVan), true);
    bijna(langsWandMm(deur, wand).dwars, 0, 'blijft op de wand');
    assert.equal(wand.openingen[0].afstandMm, 2000 + dx / K, 'het gat loopt mee');
  }
  // Loslaten: de app legt de stap vast met het kozijn van vóór de sleep.
  const cmd = stap(annotaties, { type: 'modifyAnnotation', id: 'D', oldState: oudDeur, newState: kloon(deur) });
  assert.equal(cmd.type, 'compound', 'de wand zit in dezelfde stap, ook al liep ze al mee');
  assert.equal(cmd.commands[1].oldState.openingen[0].afstandMm, 2000, 'met de toestand van vóór de sleep');
  ongedaan(annotaties, cmd);
  assert.deepEqual(annotaties, begin);
});

test('tijdens het slepen van de wand lopen haar kozijnen mee; de stap herstelt ze', () => {
  const { wand, annotaties, kozijnen: [deur] } = opstelling([{ id: 'D', afstandMm: 3000 }]);
  const begin = kloon(annotaties);
  const oudWand = kloon(wand);
  // Het eindpunt naar binnen slepen (korter dan de deur staat) en weer terug naar 3600 mm.
  for (const eindX of [1700, 1200, 1800]) {
    wand.endX = eindX;
    hostingLive([wand], annotaties, pxPerMmVan);
    assert.equal(wand.openingen[0].afstandMm, 3000, 'de lijst verandert tijdens het rekken niet');
    bijna(langsWandMm(deur, wand).langs, Math.min(3000, eindX / K - 450), 'het kozijn schuift alleen in beeld terug');
  }
  const cmd = stap(annotaties, { type: 'modifyAnnotation', id: 'W', oldState: oudWand, newState: kloon(wand) });
  assert.equal(wand.openingen[0].afstandMm, 3000, '3600 mm is lang genoeg: de deur staat weer op 3000');
  bijna(langsWandMm(deur, wand).langs, 3000, 'kozijn');
  // Hier veranderde het kozijn uiteindelijk niet: de stap is alleen de wand.
  assert.equal(cmd.type, 'modifyAnnotation');
  ongedaan(annotaties, cmd);
  assert.deepEqual(annotaties, begin);

  // Nu echt verplaatsen tijdens het slepen: de stap legt het kozijn van vooraf vast.
  const oud2 = kloon(wand);
  wand.startY += 90; wand.endY += 90;
  hostingLive([wand], annotaties, pxPerMmVan);
  const cmd2 = stap(annotaties, { type: 'modifyAnnotation', id: 'W', oldState: oud2, newState: kloon(wand) });
  assert.equal(cmd2.type, 'compound');
  bijna(cmd2.commands[1].newState.y - cmd2.commands[1].oldState.y, 90, 'het kozijn van vóór de sleep staat in de stap');
  ongedaan(annotaties, cmd2);
  assert.deepEqual(annotaties, begin);
});

test('samen slepen: het kozijn volgt de wand, niet de muis', () => {
  const { wand, annotaties, kozijnen: [deur] } = opstelling();
  wand.startX += 70; wand.endX += 70; wand.startY += 30; wand.endY += 30;
  deur.x += 70; deur.y += 30;
  hostingLive([wand, deur], annotaties, pxPerMmVan);
  assert.equal(wand.openingen[0].afstandMm, 2000);
  bijna(langsWandMm(deur, wand).langs, 2000, 'plaats op de wand');
});

// ── verwijderen ─────────────────────────────────────────────────────────

test('het kozijn verwijderen sluit de wand; ongedaan maken brengt kozijn en gat terug', () => {
  const { wand, annotaties } = opstelling();
  const begin = kloon(annotaties);
  const cmd = verwijder(annotaties, 'D');
  assert.equal(annotaties.length, 1, 'alleen de wand is er nog');
  assert.equal(wand.openingen, undefined, 'geen gat, geen resten');
  assert.deepEqual(cmd.commands.map((c) => [c.type, c.id ?? c.annotation.id]), [['deleteAnnotation', 'D'], ['modifyAnnotation', 'W']]);
  ongedaan(annotaties, cmd);
  assert.deepEqual(annotaties, begin);
  opnieuw(annotaties, cmd);
  assert.equal(annotaties.length, 1);
  assert.equal(annotaties[0].openingen, undefined);
});

test('een van twee kozijnen verwijderen laat het andere staan', () => {
  const { wand, annotaties } = opstelling([{ id: 'D', afstandMm: 1000 }, { id: 'R', soort: 'raam', afstandMm: 3000 }]);
  verwijder(annotaties, 'D');
  assert.deepEqual(wand.openingen.map((o) => o.id), ['R']);
});

test('de wand verwijderen neemt haar kozijnen mee, in dezelfde stap; ongedaan maken herstelt alles', () => {
  const { annotaties } = opstelling([{ id: 'D', afstandMm: 1000 }, { id: 'R', soort: 'raam', afstandMm: 3000 }]);
  annotaties.unshift({ id: 'onder', type: 'box', page: 1, x: 0, y: 0, width: 5, height: 5 });
  annotaties.push({ id: 'boven', type: 'box', page: 1, x: 9, y: 9, width: 5, height: 5 });
  const begin = kloon(annotaties);
  const cmd = verwijder(annotaties, 'W');
  assert.deepEqual(annotaties.map((a) => a.id), ['onder', 'boven']);
  assert.equal(cmd.type, 'compound');
  assert.deepEqual(cmd.commands.map((c) => c.annotation.id), ['W', 'D', 'R']);
  ongedaan(annotaties, cmd);
  assert.deepEqual(annotaties, begin, 'alles terug, in de oude tekenvolgorde');
  opnieuw(annotaties, cmd);
  assert.deepEqual(annotaties.map((a) => a.id), ['onder', 'boven']);
});

test('de tekenvolgorde komt terug, in welke volgorde wand en kozijnen ook stonden', () => {
  const vak = (id) => ({ id, type: 'box', page: 1, x: 0, y: 0, width: 5, height: 5 });
  // Elke volgorde van wand W, deur D en raam R tussen andere annotaties, en
  // beide manieren waarop de app een verwijdering vastlegt.
  const volgordes = [
    ['W', 'D', 'R'], ['D', 'W', 'R'], ['D', 'R', 'W'], ['R', 'W', 'D'],
    ['a', 'W', 'b', 'D', 'c', 'R', 'd'], ['a', 'R', 'b', 'D', 'c', 'W', 'd'], ['D', 'a', 'W', 'b', 'R'],
  ];
  for (const volgorde of volgordes) {
    for (const manier of [verwijder, verwijderNaVastleggen]) {
      const { annotaties: basis } = opstelling([{ id: 'D', afstandMm: 1000 }, { id: 'R', soort: 'raam', afstandMm: 3000 }]);
      const perId = new Map(basis.map((a) => [a.id, a]));
      const annotaties = volgorde.map((id) => perId.get(id) || vak(id));
      const begin = kloon(annotaties);
      const cmd = manier(annotaties, 'W');
      assert.deepEqual(annotaties.map((a) => a.id), volgorde.filter((id) => !['W', 'D', 'R'].includes(id)));
      ongedaan(annotaties, cmd);
      assert.deepEqual(annotaties, begin, `${volgorde.join(',')} (${manier.name})`);
    }
  }
});

test('wand en kozijn samen verwijderen: niets dubbel', () => {
  const { annotaties } = opstelling();
  const begin = kloon(annotaties);
  const items = annotaties.map((a, index) => ({ annotation: kloon(a), index }));
  annotaties.splice(0, annotaties.length);
  const cmd = stap(annotaties, { type: 'bulkDelete', items });
  assert.equal(cmd.type, 'bulkDelete');
  ongedaan(annotaties, cmd);
  assert.deepEqual(annotaties, begin);
});

test('een los kozijn of een wand uit een ouder bestand: de hosting doet niets', () => {
  const stuk = { id: 'S1', type: 'wall', page: 1, startX: 0, startY: 0, endX: 700, endY: 0, dikteMm: 100 };
  const los = { id: 'L', type: 'parametricSymbol', symbolId: 'door', page: 1, x: 700, y: -25, width: 450, height: 475, rotation: 0, params: { hostWallId: 'run:0:0', hostAfstandMm: 2000, width: 900, wallThickness: 100 } };
  const annotaties = [stuk, los];
  const begin = kloon(annotaties);
  const cmd = wijzig(annotaties, 'L', (a) => { a.x += 200; a.y += 300; });
  assert.equal(cmd.type, 'modifyAnnotation');
  assert.equal(los.x, 900, 'het kozijn gaat waar je het neerzet, zoals voorheen');
  assert.equal(los.y, 275);
  assert.deepEqual(annotaties[0], begin[0]);
  assert.equal(verwijder(annotaties, 'S1').type, 'deleteAnnotation');
  assert.deepEqual(annotaties.map((a) => a.id), ['L'], 'het losse kozijn blijft staan');
  assert.equal(hostingLive([los], annotaties, pxPerMmVan), false);
  assert.equal(herstelHosting(annotaties, pxPerMmVan), false);
});

// ── kopiëren en plakken ─────────────────────────────────────────────────

function kopieVan(a, id, dx = 50) {
  const k = kloon(a);
  k.id = id;
  for (const veld of ['x', 'startX', 'endX']) if (k[veld] !== undefined) k[veld] += dx;
  return k;
}

test('wand en kozijn samen plakken: de kopieën horen bij elkaar, met een eigen sleutel', () => {
  const { wand, annotaties, kozijnen: [deur] } = opstelling();
  const w2 = kopieVan(wand, 'W2'), d2 = kopieVan(deur, 'D2');
  annotaties.push(w2, d2);
  const cmd = { type: 'bulkAdd', items: [{ annotation: kloon(w2) }, { annotation: kloon(d2) }] };
  assert.deepEqual(hostingNaCommando(cmd, annotaties, pxPerMmVan), []);
  assert.deepEqual(w2.openingen.map((o) => o.id), ['D2']);
  assert.equal(d2.params.hostWallId, 'W2');
  assert.equal(d2.params.hostKey, w2.openingen[0].key);
  assert.notEqual(w2.openingen[0].key, wand.openingen[0].key, 'niet te verwarren met het origineel bij heropenen');
  // Het origineel is ongemoeid.
  assert.deepEqual(wand.openingen.map((o) => o.id), ['D']);
  assert.equal(deur.params.hostWallId, 'W');
  // De vastgelegde stap bevat de gekoppelde kopieën (voor opnieuw uitvoeren).
  assert.equal(cmd.items[0].annotation.openingen[0].id, 'D2');
  assert.equal(cmd.items[1].annotation.params.hostWallId, 'W2');
  // En de kopie gedraagt zich gehost.
  wijzig(annotaties, 'D2', (a) => { a.x += 100; a.y += 500; });
  assert.equal(w2.openingen[0].afstandMm, 2200);
});

test('alleen de wand plakken: de kopie is dicht', () => {
  const { wand, annotaties } = opstelling();
  const w2 = kopieVan(wand, 'W2');
  annotaties.push(w2);
  const cmd = { type: 'addAnnotation', annotation: kloon(w2) };
  hostingNaCommando(cmd, annotaties, pxPerMmVan);
  assert.equal(w2.openingen, undefined);
  assert.equal(cmd.annotation.openingen, undefined);
  assert.deepEqual(wand.openingen.map((o) => o.id), ['D'], 'het origineel houdt zijn deur');
});

test('alleen het kozijn plakken: de kopie is een los symbool', () => {
  const { wand, annotaties, kozijnen: [deur] } = opstelling();
  const d2 = kopieVan(deur, 'D2');
  annotaties.push(d2);
  const cmd = { type: 'addAnnotation', annotation: kloon(d2) };
  hostingNaCommando(cmd, annotaties, pxPerMmVan);
  assert.equal(d2.params.hostKey, undefined, 'geen sleutel meer: bij heropenen niet te verwarren met het origineel');
  assert.equal(d2.params.hostWallId, undefined);
  assert.equal(cmd.annotation.params.hostKey, undefined);
  assert.equal(d2.params.width, 900, 'de rest van het kozijn blijft');
  assert.deepEqual(wand.openingen.map((o) => o.id), ['D']);
  // Een los symbool gaat waar je het neerzet.
  wijzig(annotaties, 'D2', (a) => { a.y += 400; });
  assert.equal(d2.y, deur.y + 400);
});

test('een kozijn dat net gemaakt is (de wand volgt in dezelfde opdracht) houdt zijn koppeling', () => {
  const wand = maakWand();
  const annotaties = [wand];
  const deur = plaats(annotaties, kloon(wand), { id: 'D', afstandMm: 2000 });    // de wand kent het nog niet
  const cmd = { type: 'addAnnotation', annotation: kloon(deur) };
  hostingNaCommando(cmd, annotaties, pxPerMmVan);
  assert.equal(deur.params.hostWallId, 'W');
  assert.equal(deur.params.hostKey, 'key-D');
  // Daarna krijgt de wand haar lijst: geen extra stappen, alles klopt al.
  const stapWand = wijzig(annotaties, 'W', (a) => {
    a.openingen = [nieuweOpening({ id: 'D', key: 'key-D', afstandMm: 2000, breedteMm: 900 })];
  });
  assert.equal(stapWand.type, 'modifyAnnotation');
  assert.equal(gehosteWand(deur, new Map(annotaties.map((a) => [a.id, a]))), wand);
});

// ── nalopen ─────────────────────────────────────────────────────────────

test('herstelHosting: een opening zonder kozijn vervalt, een scheef kozijn gaat op zijn plaats', () => {
  const { wand, annotaties, kozijnen: [deur] } = opstelling([{ id: 'D', afstandMm: 1000 }, { id: 'R', soort: 'raam', afstandMm: 3000 }]);
  annotaties.splice(annotaties.findIndex((a) => a.id === 'R'), 1);      // het raam is weg zonder stap
  deur.x += 33; deur.y -= 12;
  assert.equal(herstelHosting(annotaties, pxPerMmVan), true);
  assert.deepEqual(wand.openingen.map((o) => o.id), ['D']);
  bijna(langsWandMm(deur, wand).langs, 1000, 'terug op zijn plaats');
  bijna(langsWandMm(deur, wand).dwars, 0, 'op de wand');
  assert.equal(herstelHosting(annotaties, pxPerMmVan), false, 'daarna is er niets meer te doen');
});
